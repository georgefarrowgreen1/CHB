<?php
// ============================================================
//  payouts-lib.php — "has this money actually reached the bank yet?"
//
//  sweep-lib.php works out how much of a charge is the owner's to move. It
//  cannot know WHEN it arrives: Square settles a card charge, then pays out to
//  the bank a day or two later, so a charge taken this morning is real money that
//  is not in the account yet. Counting it as movable invites moving money that
//  has not landed — which is what the first version of the Move-money-out screen
//  did (measured on the owner's own data: a charge dated the same day, listed as
//  £604.05 movable).
//
//  Square's PAYOUTS API answers it exactly, so none of this has to be guessed:
//    GET /v2/payouts                        — id, status, amount, arrival_date
//    GET /v2/payouts/{id}/payout-entries    — one line per activity, with the
//                                             REAL fee and the payment it belongs
//                                             to (type_charge_details.payment_id)
//  Scope PAYOUTS_READ, which a Developer-Dashboard access token already carries
//  (unlike OAuth, scopes are not granted per authorisation) — but if it does not,
//  the call 403s and payouts_refresh() reports that rather than failing quietly.
//
//  Two things it gives us, and only two — a wider reading of the entries (matching
//  refunds, disputes, adjustments) was deliberately left out, because our own
//  ledger already tracks deposit returns and a second source for the same fact is
//  a way to double-count it:
//    1. LANDED vs ON ITS WAY, per charge — the correctness fix.
//    2. The ACTUAL fee per charge, replacing sweep-lib's observed-rate estimate.
//
//  Everything above payouts_refresh() is PURE — no DB, no clock, no network — so
//  test-payouts.php drives the real decisions. The fetch is deliberately NOT on
//  the Income & tax path: it is a daily cron job plus an explicit owner refresh,
//  because a page that waits on Square is the poor-signal bug all over again.
// ============================================================

const PAYOUTS_CACHE_KEY = 'square-payouts';
const PAYOUTS_LOOKBACK_DAYS = 60; // enough to cover anything the sweep screen lists
const PAYOUTS_MAX = 30; // bounds the per-payout entry calls (one a day, so ~31 total)
const PAYOUTS_TTL = 21600; // 6h — how old a cache has to be before a refresh is due

// ---- PURE: what the payout data MEANS --------------------------------------

// Is this payout's money in the bank?
//   PAID                              → yes
//   SENT, arrival_date today or before → yes (Square has sent it; the date is when
//                                        it lands, and today counts as landed)
//   SENT, arrival_date in the future   → no, on its way
//   SENT, no arrival_date              → NULL — unknown, and unknown must not be
//                                        promoted to spendable
//   FAILED                            → false, and it never will arrive
// Returns true / false / null (unknown), never a guess.
function payouts_landed($payout, $todayIso)
{
    $status = strtoupper((string) ($payout['status'] ?? ''));
    if ($status === 'PAID') {
        return true;
    }
    if ($status === 'FAILED') {
        return false;
    }
    if ($status !== 'SENT') {
        return null; // a status this code has never seen — say so
    }
    $arrival = (string) ($payout['arrival_date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $arrival)) {
        return null;
    }
    return $arrival <= (string) $todayIso;
}

// Flatten payouts + their entries into: payment_id => what we know about the
// charge. $entriesByPayout is [payout_id => [entry, ...]].
//
// Only CHARGE entries are read (see the header). `fee` is Square's real fee for
// that charge, which is what makes the sweep arithmetic exact rather than modelled
// — and it is taken as an ABSOLUTE value because Square reports fees as a
// deduction and the sign convention is not worth depending on.
function payouts_charge_map(array $payouts, array $entriesByPayout, $todayIso)
{
    $map = [];
    foreach ($payouts as $p) {
        $pid = (string) ($p['id'] ?? '');
        if ($pid === '') {
            continue;
        }
        $landed = payouts_landed($p, $todayIso);
        $arrival = (string) ($p['arrival_date'] ?? '');
        $status = strtoupper((string) ($p['status'] ?? ''));
        foreach ($entriesByPayout[$pid] ?? [] as $e) {
            if (strtoupper((string) ($e['type'] ?? '')) !== 'CHARGE') {
                continue;
            }
            $payment = (string) ($e['type_charge_details']['payment_id'] ?? '');
            if ($payment === '') {
                continue;
            }
            $fee = $e['fee_amount_money']['amount'] ?? null;
            $map[$payment] = [
                'payout_id' => $pid,
                'status' => $status,
                'arrival' => $arrival,
                'landed' => $landed,
                // Square money is in MINOR units (pence).
                'fee' => $fee === null ? null : round(abs((int) $fee) / 100, 2),
            ];
        }
    }
    return $map;
}

// Tag each of our transactions with what the payout data says, and let the REAL
// fee replace the estimate. $txns carry 'square_payment_id'; anything the map does
// not know keeps `landed => null` (unknown), which the caller must not treat as
// spendable. The Square id is consumed here and NOT copied into the result — it is
// machinery, and the screen has no use for it.
function payouts_apply(array $txns, array $map)
{
    $out = [];
    foreach ($txns as $t) {
        $id = (string) ($t['square_payment_id'] ?? '');
        $known = $id !== '' && isset($map[$id]) ? $map[$id] : null;
        unset($t['square_payment_id']);
        if ($known === null) {
            $t['landed'] = null;
            $t['arrival'] = '';
            $out[] = $t;
            continue;
        }
        $t['landed'] = $known['landed'];
        $t['arrival'] = $known['arrival'];
        if ($known['fee'] !== null) {
            $t['fee'] = $known['fee']; // Square's real figure beats our estimate
            $t['fee_actual'] = true;
        }
        $out[] = $t;
    }
    return $out;
}

// Split priced transactions (sweep_txn_totals output items) by where the money
// actually is. Only 'inBank' may be offered as movable; 'onWay' is real money with
// a date on it, and 'unknown' is money we cannot vouch for — reported as its own
// figure rather than folded into either, because silently rounding it down to
// "not yours" is as wrong as rounding it up.
function payouts_split_totals(array $items)
{
    $sum = ['inBank' => 0.0, 'onWay' => 0.0, 'unknown' => 0.0];
    $lists = ['inBank' => [], 'onWay' => [], 'unknown' => []];
    $nextArrival = '';
    foreach ($items as $it) {
        $landed = $it['landed'] ?? null;
        $movable = round((float) ($it['movable'] ?? 0), 2);
        if ($landed === true) {
            $bucket = 'inBank';
        } elseif ($landed === false && (string) ($it['arrival'] ?? '') !== '') {
            // A dated payout that has not arrived. A FAILED payout also lands here
            // by status, and that is right: the money is not in the account.
            $bucket = 'onWay';
            if ($nextArrival === '' || (string) $it['arrival'] < $nextArrival) {
                $nextArrival = (string) $it['arrival'];
            }
        } else {
            $bucket = 'unknown';
        }
        $sum[$bucket] += $movable;
        $lists[$bucket][] = $it;
    }
    return [
        'inBank' => round($sum['inBank'], 2),
        'onWay' => round($sum['onWay'], 2),
        'unknown' => round($sum['unknown'], 2),
        'nextArrival' => $nextArrival,
        'items' => $lists,
        'counts' => ['inBank' => count($lists['inBank']), 'onWay' => count($lists['onWay']), 'unknown' => count($lists['unknown'])],
    ];
}

// Is the cache old enough to be worth a refresh? An absent//unreadable cache
// always is. Pure so the cron's decision is testable without a clock.
function payouts_stale($cache, $now, $ttl = PAYOUTS_TTL)
{
    if (!is_array($cache) || !isset($cache['at'])) {
        return true;
    }
    return ((int) $now - (int) $cache['at']) >= (int) $ttl;
}

// ---- IMPURE: read the cache, and (from cron / an explicit refresh) fill it ----

if (!function_exists('payouts_cached')) {
    // The stored cache, or null. Never throws — a missing/corrupt row just means
    // "no payout data", which the screen states plainly rather than guessing.
    function payouts_cached()
    {
        try {
            $raw = content_value(PAYOUTS_CACHE_KEY);
        } catch (\Throwable $e) {
            return null;
        }
        if (!is_string($raw) || $raw === '') {
            return null;
        }
        $d = json_decode($raw, true);
        return is_array($d) ? $d : null;
    }

    // Ask Square, and store the flattened charge map. Bounded: one ListPayouts
    // plus one ListPayoutEntries per payout, capped at PAYOUTS_MAX.
    //
    // KEEPS THE LAST GOOD COPY on any failure (the loadContent rule) and records
    // why, so the screen can say "last checked Tuesday, Square wouldn't answer"
    // instead of showing an empty list as though nothing had settled. Returns
    // ['ok'=>bool,'reason'=>string,'payouts'=>int,'charges'=>int].
    function payouts_refresh()
    {
        $prev = payouts_cached();
        $fail = function ($reason) use ($prev) {
            $keep = is_array($prev) ? $prev : ['charges' => [], 'payouts' => []];
            $keep['checked'] = time();
            $keep['error'] = $reason;
            if (!isset($keep['at'])) {
                $keep['at'] = 0; // never successfully filled — still stale
            }
            try {
                content_set_scalar(PAYOUTS_CACHE_KEY, json_encode($keep));
            } catch (\Throwable $e) {
            }
            return ['ok' => false, 'reason' => $reason, 'payouts' => 0, 'charges' => 0];
        };
        if (!function_exists('square_enabled') || !square_enabled()) {
            return $fail('Square payments are not switched on');
        }
        $begin = gmdate('Y-m-d\TH:i:s\Z', time() - PAYOUTS_LOOKBACK_DAYS * 86400);
        $res = square_api('GET', '/v2/payouts?limit=' . PAYOUTS_MAX . '&sort_order=DESC&begin_time=' . rawurlencode($begin));
        if ((int) $res['status'] === 403) {
            // The one predictable refusal: a token without PAYOUTS_READ. Named, so
            // the owner is told what to do rather than seeing an empty screen.
            return $fail("Square refused the request — the access token can't read payouts");
        }
        if ((int) $res['status'] < 200 || (int) $res['status'] >= 300) {
            return $fail('Square didn\'t answer (' . (int) $res['status'] . ')');
        }
        $payouts = [];
        foreach (($res['body']['payouts'] ?? []) as $p) {
            if (!is_array($p) || (string) ($p['id'] ?? '') === '') {
                continue;
            }
            $payouts[] = [
                'id' => (string) $p['id'],
                'status' => strtoupper((string) ($p['status'] ?? '')),
                'arrival_date' => (string) ($p['arrival_date'] ?? ''),
                'amount' => isset($p['amount_money']['amount']) ? round((int) $p['amount_money']['amount'] / 100, 2) : null,
            ];
            if (count($payouts) >= PAYOUTS_MAX) {
                break;
            }
        }
        $entries = [];
        foreach ($payouts as $p) {
            $r = square_api('GET', '/v2/payouts/' . rawurlencode($p['id']) . '/payout-entries?limit=100');
            if ((int) $r['status'] < 200 || (int) $r['status'] >= 300) {
                continue; // one unreadable payout must not lose the other twenty-nine
            }
            $entries[$p['id']] = $r['body']['payout_entries'] ?? [];
        }
        $map = payouts_charge_map($payouts, $entries, gmdate('Y-m-d'));
        $now = time();
        try {
            content_set_scalar(PAYOUTS_CACHE_KEY, json_encode([
                'at' => $now,
                'checked' => $now,
                'error' => null,
                'payouts' => $payouts,
                'charges' => $map,
            ]));
        } catch (\Throwable $e) {
            return ['ok' => false, 'reason' => 'Couldn\'t store the payout data', 'payouts' => count($payouts), 'charges' => count($map)];
        }
        return ['ok' => true, 'reason' => '', 'payouts' => count($payouts), 'charges' => count($map)];
    }
}
