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
// The sweep lists charges from the last 90 days (plus any still holding a deposit),
// and a payout follows its charge by a day or two, so the fetch reaches back past 90.
// At 60 a charge between 60 and 90 days old could never be matched to its payout and
// read as "with Square" however long ago it reached the bank.
const PAYOUTS_LOOKBACK_DAYS = 100;
const PAYOUTS_MAX = 60; // payouts per fetch; a PAID one already read is never re-read
// What Square has said about a charge is KEPT after its payout leaves the fetch window,
// for this long: a PAID payout does not change, and dropping the fact turned money the
// owner had already moved out back into "with Square" (reported live, £1,291.97).
const PAYOUTS_KEEP_DAYS = 400;
const PAYOUTS_KEEP_MAX = 1500;
const PAYOUTS_TTL = 21600; // 6h — how old a cache has to be before a refresh is due
// The balance the owner last stated, WITH its date. Written by the client through the
// ordinary content save (no new endpoint), classified internal in db.php.
const SWEEP_BALANCE_KEY = 'sweep-balance';
// Charges the owner has told us they have ALREADY transferred out of the bank.
// There is no bank feed — Square can say what it paid IN, never what the owner
// moved OUT — so without this the movable figure counts the same money on every
// visit until a fresh balance is typed. A map of charge id => unix seconds,
// written by the client through the ordinary content save; classified internal
// in db.php.
const SWEEP_MOVED_KEY = 'sweep-moved';
// Bounded like the other owner-written lists. Older marks fall off the end; a
// charge that has dropped out of the payout window is no longer shown anyway.
const SWEEP_MOVED_MAX = 200;
// Card payments the owner has told us ARE in their bank when Square's payout data
// does not say so (a charge older than the data, or one Square never reported).
// Same shape and same reader as the moved marks. Square's own word wins whenever it
// has one: a mark only changes a charge Square has not called landed, and never one
// in a payout Square says FAILED.
const SWEEP_LANDED_KEY = 'sweep-landed';

// The owner's record of what they have already transferred out. Bounded and
// sanitised on read: this is owner-written JSON reaching money arithmetic, so a
// malformed value must degrade to "nothing marked" rather than to an exception.
function payouts_moved_map()
{
    return payouts_mark_map(SWEEP_MOVED_KEY, SWEEP_MOVED_MAX);
}
function payouts_landed_marks()
{
    return payouts_mark_map(SWEEP_LANDED_KEY, SWEEP_MOVED_MAX);
}
function payouts_mark_map($key, $max)
{
    $raw = function_exists('content_value') ? content_value($key) : '';
    if ($raw === '') {
        return [];
    }
    $d = json_decode($raw, true);
    if (!is_array($d)) {
        return [];
    }
    $out = [];
    foreach ($d as $k => $v) {
        $k = (string) $k;
        $ts = (int) $v;
        if ($k !== '' && $ts > 0) {
            $out[$k] = $ts;
        }
    }
    if (count($out) > $max) {
        arsort($out); // newest marks win
        $out = array_slice($out, 0, $max, true);
    }
    return $out;
}

// ---- PURE: what the payout data MEANS --------------------------------------

// Square Money → pounds, or NULL when it is not this account's currency.
// Deliberately strict: mixing a EUR amount into a sterling total silently reports a
// wrong figure, and "unknown" is a state this file already handles honestly
// everywhere else. Absent currency is accepted (older payloads) — only a currency
// that is present and DIFFERENT is refused.
const PAYOUTS_CURRENCY = 'GBP';
function payouts_money($m, $currency = PAYOUTS_CURRENCY)
{
    if (!is_array($m) || !isset($m['amount'])) {
        return null;
    }
    $cur = strtoupper((string) ($m['currency'] ?? ''));
    if ($cur !== '' && $cur !== strtoupper((string) $currency)) {
        return null;
    }
    return round((int) $m['amount'] / 100, 2); // Square money is in minor units
}

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
            // abs() because Square reports a fee as a deduction and the sign
            // convention is not worth depending on. A non-GBP amount reads as null
            // (no fee known) rather than as a wrong number.
            $fee = payouts_money($e['fee_amount_money'] ?? null);
            $map[$payment] = [
                'payout_id' => $pid,
                'status' => $status,
                'arrival' => $arrival,
                'landed' => $landed,
                'fee' => $fee === null ? null : round(abs($fee), 2),
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
//
// $todayIso, when given, re-judges `landed` from the payout's status and date: the
// cache holds the verdict as of its last refresh, so a payout cached as "arriving
// Thursday" otherwise read "on its way" all Thursday until the next one.
function payouts_apply(array $txns, array $map, $todayIso = null)
{
    $out = [];
    foreach ($txns as $t) {
        $id = (string) ($t['square_payment_id'] ?? '');
        $known = $id !== '' && isset($map[$id]) ? $map[$id] : null;
        unset($t['square_payment_id']);
        if ($known === null) {
            $t['landed'] = null;
            $t['arrival'] = '';
            $t['payout_status'] = '';
            $out[] = $t;
            continue;
        }
        $t['landed'] = $known['landed'];
        if ($todayIso !== null && (string) ($known['status'] ?? '') !== '') {
            $t['landed'] = payouts_landed(['status' => $known['status'], 'arrival_date' => $known['arrival'] ?? ''], $todayIso);
        }
        $t['arrival'] = $known['arrival'];
        $t['payout_status'] = strtoupper((string) ($known['status'] ?? ''));
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
// The charge id a mark is keyed on. `txn_id` is the payments-table row and is
// what sweep_txn carries; fall back to Square's own id so a payload shape that
// omits one is not silently unmarkable.
function payouts_charge_key(array $it)
{
    foreach (['txn_id', 'square_payment_id', 'payment_id'] as $k) {
        if (isset($it[$k]) && (string) $it[$k] !== '') {
            return (string) $it[$k];
        }
    }
    return '';
}
// A FOURTH BUCKET: money that HAS landed but the owner has already moved on.
// Kept separate rather than dropped, because "you have already transferred this"
// is a different statement from "Square never paid it", and the owner has to be
// able to see what they marked — and unmark it.
//
// $owner is the owner's "it's in my bank" marks (payouts_landed_marks): a charge
// Square has not called landed counts as landed on the owner's word, carrying WHEN
// they said so. Never one in a FAILED payout — Square knows that money did not arrive.
function payouts_split_totals(array $items, array $moved = [], array $owner = [])
{
    $sum = ['inBank' => 0.0, 'onWay' => 0.0, 'unknown' => 0.0, 'moved' => 0.0];
    $lists = ['inBank' => [], 'onWay' => [], 'unknown' => [], 'moved' => []];
    $nextArrival = '';
    foreach ($items as $it) {
        $landed = $it['landed'] ?? null;
        $movable = round((float) ($it['movable'] ?? 0), 2);
        $key = payouts_charge_key($it);
        if ($landed !== true && $key !== '' && isset($owner[$key])
            && strtoupper((string) ($it['payout_status'] ?? '')) !== 'FAILED') {
            $landed = true;
            $it['landed'] = true;
            $it['landed_by_owner'] = (int) $owner[$key];
        }
        // Only a LANDED charge can have been transferred: money Square has not
        // paid out cannot have left the bank, so a stale mark on one must not
        // quietly remove it from the figure.
        if ($landed === true && $key !== '' && isset($moved[$key])) {
            $it['moved_at'] = (int) $moved[$key];
            $bucket = 'moved';
        } elseif ($landed === true) {
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
        'moved' => round($sum['moved'], 2),
        'nextArrival' => $nextArrival,
        'items' => $lists,
        'counts' => [
            'inBank' => count($lists['inBank']),
            'onWay' => count($lists['onWay']),
            'unknown' => count($lists['unknown']),
            'moved' => count($lists['moved']),
        ],
    ];
}

// MONEY UNDER DISPUTE. A chargeback on a £900 stay dwarfs a £75 deposit, and Square
// can pull it back — so it belongs in the ring fence, as its OWN figure rather than
// folded into the deposits (whether Square has already withheld it depends on the
// dispute's stage, and the owner needs to see which it is).
//
// Only OPEN states count. WON leaves the money; LOST and ACCEPTED mean it has gone
// already, so fencing it would hold back money twice. INQUIRY_CLOSED is over.
// Fencing an open dispute is the conservative reading either way: if Square has
// already taken it the balance is lower and the owner simply keeps more, which is
// the failure worth having on this screen.
const PAYOUTS_DISPUTE_OPEN = ['EVIDENCE_REQUIRED', 'PROCESSING', 'INQUIRY_EVIDENCE_REQUIRED', 'INQUIRY_PROCESSING'];
function payouts_disputes_open(array $disputes)
{
    $total = 0.0;
    $items = [];
    foreach ($disputes as $d) {
        $state = strtoupper((string) ($d['state'] ?? ''));
        if (!in_array($state, PAYOUTS_DISPUTE_OPEN, true)) {
            continue;
        }
        $amt = payouts_money($d['amount_money'] ?? null);
        if ($amt === null || $amt <= 0) {
            continue; // an amount we cannot read is not a figure we will fence
        }
        $total += $amt;
        $items[] = [
            'id' => (string) ($d['id'] ?? ($d['dispute_id'] ?? '')),
            'amount' => round($amt, 2),
            'state' => $state,
            'reason' => (string) ($d['reason'] ?? ''),
            'due_at' => (string) ($d['due_at'] ?? ''),
        ];
    }
    return ['amount' => round($total, 2), 'count' => count($items), 'items' => $items];
}

// THE BALANCE, ROLLED FORWARD. The owner types what the account holds; there is no
// bank feed, so a bare remembered figure would be stale. A DATED one is not: given
// "£2,000 on Tuesday" we can add what Square has paid in since and subtract what it
// has debited since, and show the result as an estimate WITH its basis.
//
// $stored is ['amount'=>float,'at'=>ts]. Only movements strictly AFTER $stored['at']
// count, so the figure the owner typed is never adjusted by something already in it.
// Returns null when there is nothing to roll forward from — the field then starts
// empty rather than pre-filled with a guess.
function payouts_balance_estimate($stored, array $payouts, array $refunds, $nowTs, $maxAgeDays = 30)
{
    if (!is_array($stored) || !isset($stored['amount'], $stored['at']) || !is_numeric($stored['amount'])) {
        // A corrupted stored amount must REFUSE (field starts empty), never
        // (float)-coerce to £0 and roll a confident wrong estimate forward —
        // the same owner-written-JSON discipline the sweep-moved read follows.
        return null;
    }
    $at = (int) $stored['at'];
    if ($at <= 0 || (int) $nowTs - $at > $maxAgeDays * 86400) {
        return null; // too old to roll forward honestly — ask again
    }
    $in = 0.0;
    $inCount = 0;
    foreach ($payouts as $p) {
        $ts = (int) ($p['landed_at'] ?? 0);
        $amt = (float) ($p['amount'] ?? 0);
        // Only money that has ARRIVED, and only after the stated balance.
        if ($ts > $at && $amt > 0 && strtoupper((string) ($p['status'] ?? '')) !== 'FAILED') {
            $in += $amt;
            $inCount++;
        }
    }
    $out = 0.0;
    $outCount = 0;
    foreach ($refunds as $r) {
        $ts = (int) ($r['at'] ?? 0);
        $amt = (float) ($r['amount'] ?? 0);
        if ($ts > $at && $amt > 0) {
            $out += $amt;
            $outCount++;
        }
    }
    return [
        'from' => round((float) $stored['amount'], 2),
        'at' => $at,
        'in' => round($in, 2),
        'inCount' => $inCount,
        'out' => round($out, 2),
        'outCount' => $outCount,
        'estimate' => round((float) $stored['amount'] + $in - $out, 2),
    ];
}

// A FAILED payout is a PROBLEM, not merely money that isn't movable — it usually
// means the bank details are wrong, and every later payout will fail the same way.
// Excluding it from the movable total (which payouts_split_totals does) is correct
// but silent, so it is also handed to the owner's duty list.
function payouts_failed(array $payouts)
{
    $out = [];
    $total = 0.0;
    foreach ($payouts as $p) {
        if (strtoupper((string) ($p['status'] ?? '')) !== 'FAILED') {
            continue;
        }
        $amt = (float) ($p['amount'] ?? 0);
        $total += abs($amt);
        $out[] = ['id' => (string) ($p['id'] ?? ''), 'amount' => round(abs($amt), 2), 'arrival' => (string) ($p['arrival_date'] ?? '')];
    }
    return ['count' => count($out), 'amount' => round($total, 2), 'items' => $out];
}

// KEEP WHAT SQUARE HAS ALREADY SAID. Each refresh rebuilt the charge map from the
// fetch window alone, so a charge whose payout aged out of it lost its "landed" — and
// with it any "moved out" mark, which only applies to landed money — and went back to
// reading "with Square". A PAID or SENT payout's charges are carried forward while
// their arrival date is within PAYOUTS_KEEP_DAYS; the fresh fetch always wins where it
// has an answer. A FAILED one is not carried: Square re-pays failed money as an
// adjustment, not against the same charges, so keeping it would say "didn't arrive"
// about money that later did.
function payouts_charge_merge(array $fresh, array $prev, $todayIso, $keepDays = PAYOUTS_KEEP_DAYS)
{
    $out = $fresh;
    $floor = gmdate('Y-m-d', (int) strtotime($todayIso . ' 12:00:00 UTC') - (int) $keepDays * 86400);
    foreach ($prev as $pid => $c) {
        $pid = (string) $pid;
        if ($pid === '' || isset($out[$pid]) || !is_array($c)) {
            continue;
        }
        $status = strtoupper((string) ($c['status'] ?? ''));
        $arrival = (string) ($c['arrival'] ?? '');
        if (!in_array($status, ['PAID', 'SENT'], true) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $arrival) || $arrival < $floor) {
            continue;
        }
        $fee = $c['fee'] ?? null;
        $out[$pid] = [
            'payout_id' => (string) ($c['payout_id'] ?? ''),
            'status' => $status,
            'arrival' => $arrival,
            'landed' => payouts_landed(['status' => $status, 'arrival_date' => $arrival], $todayIso),
            'fee' => $fee === null ? null : round(abs((float) $fee), 2),
        ];
    }
    if (count($out) > PAYOUTS_KEEP_MAX) {
        uasort($out, fn($a, $b) => strcmp((string) ($b['arrival'] ?? ''), (string) ($a['arrival'] ?? '')));
        $out = array_slice($out, 0, PAYOUTS_KEEP_MAX, true);
    }
    return $out;
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
        // SCOPED TO THE LOCATION THIS SITE TRADES UNDER. Omitting location_id does not
        // mean "everywhere" — Square's own words: "By default, payouts are returned for
        // the default (main) location associated with the seller". So on a multi-location
        // account this asked about the wrong shop and got a confident empty answer:
        // measured, sixty days of "no payouts at all" while the money was moving under a
        // location called Online CHB. Empty setting keeps the old default-location
        // behaviour, and the screen says which it read.
        $loc = function_exists('square_location_id') ? square_location_id() : '';
        $res = square_api('GET', '/v2/payouts?limit=' . PAYOUTS_MAX . '&sort_order=DESC&begin_time=' . rawurlencode($begin)
            . ($loc !== '' ? '&location_id=' . rawurlencode($loc) : ''));
        if ((int) $res['status'] === 403) {
            // The one predictable refusal: a token without PAYOUTS_READ. Named, so
            // the owner is told what to do rather than seeing an empty screen.
            return $fail("Square refused the request — the access token can't read payouts");
        }
        if ((int) $res['status'] < 200 || (int) $res['status'] >= 300) {
            return $fail('Square didn\'t answer (' . (int) $res['status'] . ')');
        }
        $raw = $res['body']['payouts'] ?? [];
        $payouts = [];
        $today = gmdate('Y-m-d');
        $fees = 0.0;
        foreach ($raw as $p) {
            if (!is_array($p) || (string) ($p['id'] ?? '') === '') {
                continue;
            }
            $landed = payouts_landed($p, $today);
            // A payout-level fee (an instant deposit, say) is Square's cut of the
            // TRANSFER, not of any one charge, so it cannot be apportioned per
            // payment. Reported as its own figure rather than silently reallocated.
            foreach (($p['payout_fee'] ?? []) as $pf) {
                $f = payouts_money($pf['amount_money'] ?? null);
                if ($f !== null) {
                    $fees += abs($f);
                }
            }
            $payouts[] = [
                'id' => (string) $p['id'],
                'status' => strtoupper((string) ($p['status'] ?? '')),
                'arrival_date' => (string) ($p['arrival_date'] ?? ''),
                'amount' => payouts_money($p['amount_money'] ?? null),
                // When it reached the bank, for the rolled-forward balance. Only set
                // once it actually has; noon UTC so a timezone cannot move the day.
                'landed_at' => $landed === true && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($p['arrival_date'] ?? ''))
                    ? strtotime($p['arrival_date'] . ' 12:00:00 UTC')
                    : 0,
            ];
            if (count($payouts) >= PAYOUTS_MAX) {
                break;
            }
        }
        // NO SILENT CAPS: if the window or the cap dropped payouts, the screen says
        // so rather than reading as full coverage.
        $truncated = count($raw) > count($payouts) || !empty($res['body']['cursor']);

        // A PAID payout whose entries were read in full last time cannot change, so it
        // is not asked about again: its charges come forward through the merge below and
        // its refund lines are copied. That keeps a hundred days of payouts to a handful
        // of calls once the first refresh has read them.
        // Only a cache about THIS location is carried forward: after the owner picks a
        // different one, the old answer is about another shop's payouts.
        $same = is_array($prev) && (string) ($prev['location'] ?? '') === $loc;
        $prevRead = [];
        foreach (($same ? ($prev['payouts'] ?? []) : []) as $pp) {
            if (is_array($pp) && !empty($pp['entries_read']) && strtoupper((string) ($pp['status'] ?? '')) === 'PAID') {
                $prevRead[(string) ($pp['id'] ?? '')] = true;
            }
        }
        $entries = [];
        $refunds = [];
        foreach ($payouts as $i => $p) {
            if ($p['status'] === 'PAID' && isset($prevRead[$p['id']])) {
                $payouts[$i]['entries_read'] = true;
                foreach (($prev['refunds'] ?? []) as $rf) {
                    if (is_array($rf) && (string) ($rf['payout'] ?? '') === $p['id']) {
                        $refunds[] = $rf;
                    }
                }
                continue;
            }
            $r = square_api('GET', '/v2/payouts/' . rawurlencode($p['id']) . '/payout-entries?limit=100');
            if ((int) $r['status'] < 200 || (int) $r['status'] >= 300) {
                continue; // one unreadable payout must not lose the others
            }
            $list = $r['body']['payout_entries'] ?? [];
            $entries[$p['id']] = $list;
            // Read in full only when Square says there is no further page.
            $payouts[$i]['entries_read'] = empty($r['body']['cursor']);
            // Refund lines are collected ONLY to roll the balance forward (money that
            // has left since a stated figure). They are deliberately NOT used to
            // compute the deposit liability — our own ledger owns that, and a second
            // source for the same fact is a way to double-count it.
            foreach ($list as $e) {
                if (strtoupper((string) ($e['type'] ?? '')) !== 'REFUND') {
                    continue;
                }
                $net = payouts_money($e['net_amount_money'] ?? null);
                if ($net === null || $p['landed_at'] <= 0) {
                    continue;
                }
                $refunds[] = [
                    'amount' => round(abs($net), 2),
                    'at' => (int) $p['landed_at'],
                    'refund_id' => (string) ($e['type_refund_details']['refund_id'] ?? ''),
                    'payout' => $p['id'],
                ];
            }
        }
        $map = payouts_charge_merge(
            payouts_charge_map($payouts, $entries, $today),
            $same && is_array($prev['charges'] ?? null) ? $prev['charges'] : [],
            $today,
        );

        // Open disputes: money Square may pull back. A failure here must not lose the
        // payout data we already have, so it degrades to "unknown" on its own.
        $disputes = ['amount' => 0.0, 'count' => 0, 'items' => [], 'error' => null];
        $dr = square_api('GET', '/v2/disputes');
        if ((int) $dr['status'] >= 200 && (int) $dr['status'] < 300) {
            $disputes = payouts_disputes_open($dr['body']['disputes'] ?? []);
            $disputes['error'] = null;
        } else {
            $disputes['error'] = (int) $dr['status'] === 403
                ? "the access token can't read disputes"
                : 'Square didn\'t answer (' . (int) $dr['status'] . ')';
        }

        $now = time();
        try {
            content_set_scalar(PAYOUTS_CACHE_KEY, json_encode([
                'at' => $now,
                'checked' => $now,
                'error' => null,
                'payouts' => $payouts,
                'charges' => $map,
                'refunds' => array_slice($refunds, 0, 200),
                'disputes' => $disputes,
                'payoutFees' => round($fees, 2),
                'truncated' => $truncated,
                // WHICH LOCATION THIS ANSWER IS ABOUT. Without it the screen cannot say
                // whose payouts it is reporting, and a silent default is exactly what
                // made sixty days of nothing look like a fact about the business.
                'location' => $loc,
            ]));
        } catch (\Throwable $e) {
            return ['ok' => false, 'reason' => 'Couldn\'t store the payout data', 'payouts' => count($payouts), 'charges' => count($map)];
        }
        return ['ok' => true, 'reason' => '', 'payouts' => count($payouts), 'charges' => count($map)];
    }
}
