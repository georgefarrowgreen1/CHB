<?php
// ============================================================
//  bank-lib.php — "is there anywhere for the money to GO?"
//
//  The Move-money-out screen could tell the owner that Square had reported no
//  payouts at all, and then had to GUESS why: "usually a Square-side setting
//  (payouts paused, or no bank account linked)". That sentence was written
//  because the app had no way to know — and it is the question that matters,
//  because a Square account with no linked bank account never pays out, and
//  nothing else on the screen can tell you so. Reported live: 60 days with no
//  payouts, a clean fetch, and £1,151.16 the owner could not account for.
//
//  Square's BANK ACCOUNTS API answers it exactly:
//    GET /v2/bank-accounts   — status, creditable, bank_name, account_number_suffix
//  Scope BANK_ACCOUNTS_READ. Same posture as payouts-lib: a Developer-Dashboard
//  access token carries its scopes wholesale, but if this one does not the call
//  403s and bank_refresh() NAMES that rather than reporting "no bank account",
//  which would be a different and much more alarming claim.
//
//  WHAT IT CANNOT TELL US, and this was got wrong first time round. Square keeps ONE
//  primary payout account, but ListBankAccounts does NOT say which of the linked
//  accounts that is — there is no default/primary flag on the object (the
//  `primary_bank_identification_number` field is a sort code, not a "this is the
//  primary account" marker, and reads deceptively like one). So naming a single
//  account as "your bank account" is only honest when exactly ONE is linked. With two,
//  the first version picked whichever came back first and asserted it: reported live,
//  it named a Lloyds account on a business paid out to Monzo. More than one linked ⇒
//  list them and say Square does not tell us which it pays into.
//
//  THE TWO FIELDS THAT DECIDE IT, and they are not interchangeable:
//    status      VERIFICATION_IN_PROGRESS | VERIFIED | DISABLED
//    creditable  whether Square can SEND money to it — the payout direction.
//                (`debitable` is the opposite direction and is NOT the question:
//                an account Square can take money from but not send it to still
//                pays out nothing.)
//  So "ready" means VERIFIED *and* creditable. Either one alone is not enough,
//  and a DISABLED account that is still creditable is not ready either.
//
//  Everything above bank_cached() is PURE — no DB, no clock, no network — so
//  test-bank.php drives the real decision. The fetch is a daily cron job plus the
//  owner's own "Check Square now", never a page load: a screen that waits on
//  Square is the poor-signal bug again.
// ============================================================

const BANK_CACHE_KEY = 'square-bank';
const BANK_TTL = 21600; // 6h — how old a cache has to be before a refresh is due
const BANK_MAX = 20; // an owner has one or two; this only bounds a pathological reply

// WHAT THE LIST MEANS, as one decision. Returns a state plus the words for it, so
// the screen never re-derives the reasoning and the two cannot drift.
//
//   ready     at least one account Square can pay into
//   verifying linked, Square is still checking it — money will not move yet
//   blocked   linked but disabled or not creditable — money cannot move
//   none      no bank account at all: the account can take payments and will
//             never pay them out
//
// $err is whatever bank_refresh() recorded. An error is NOT "none": failing to
// ask is a different fact from asking and being told there are none, and only one
// of them justifies telling the owner their bank account is missing.
function bank_read($accounts, $err = null)
{
    if ($err !== null && $err !== '') {
        return ['state' => 'unknown', 'count' => 0, 'why' => (string) $err, 'label' => '', 'all' => []];
    }
    if (!is_array($accounts)) {
        return ['state' => 'unknown', 'count' => 0, 'why' => 'never checked', 'label' => '', 'all' => []];
    }
    $count = count($accounts);
    if ($count === 0) {
        return ['state' => 'none', 'count' => 0, 'why' => '', 'label' => '', 'all' => []];
    }
    $ready = null;
    $verifying = null;
    foreach ($accounts as $a) {
        if (!is_array($a)) {
            continue;
        }
        $status = strtoupper((string) ($a['status'] ?? ''));
        // Square sends real booleans; a cache round trip through JSON keeps them.
        // Anything absent is treated as NOT creditable — the cautious direction,
        // since claiming an account is ready is the assertion that misleads.
        $creditable = !empty($a['creditable']);
        if ($status === 'VERIFIED' && $creditable && $ready === null) {
            $ready = $a;
        }
        if ($status === 'VERIFICATION_IN_PROGRESS' && $verifying === null) {
            $verifying = $a;
        }
    }
    // Every account, each with its own verdict, so the screen can name them ALL when
    // there is more than one — Square will not say which it pays into, and picking one
    // is how the first version came to name the wrong bank.
    $all = [];
    foreach ($accounts as $a) {
        if (!is_array($a)) {
            continue;
        }
        $st = strtoupper((string) ($a['status'] ?? ''));
        $all[] = [
            'label' => bank_label($a),
            'state' => $st === 'VERIFIED' && !empty($a['creditable'])
                ? 'ready'
                : ($st === 'VERIFICATION_IN_PROGRESS' ? 'verifying' : 'blocked'),
        ];
    }
    if ($ready !== null) {
        return ['state' => 'ready', 'count' => $count, 'why' => '', 'label' => bank_label($ready), 'all' => $all];
    }
    if ($verifying !== null) {
        return ['state' => 'verifying', 'count' => $count, 'why' => '', 'label' => bank_label($verifying), 'all' => $all];
    }
    return ['state' => 'blocked', 'count' => $count, 'why' => '', 'label' => bank_label($accounts[0]), 'all' => $all];
}

// How an account is NAMED to the owner: the bank and the last few digits, which is
// how their own statement identifies it. Never the full number — Square only ever
// returns a suffix, and this is rendered into the back office.
function bank_label($a)
{
    if (!is_array($a)) {
        return '';
    }
    $bank = trim((string) ($a['bank_name'] ?? ''));
    $tail = trim((string) ($a['account_number_suffix'] ?? ''));
    if ($bank !== '' && $tail !== '') {
        return $bank . ' ending ' . $tail;
    }
    if ($tail !== '') {
        return 'ending ' . $tail;
    }
    return $bank;
}

// Only the fields the screen uses. Square's reply carries the holder's name and
// the bank identification numbers; none of that is needed to answer "can money
// move?", so it is dropped rather than cached in the content table.
function bank_slim($accounts)
{
    $out = [];
    foreach (is_array($accounts) ? $accounts : [] as $a) {
        if (!is_array($a)) {
            continue;
        }
        // SELLER accounts only. ListBankAccounts returns customer bank accounts as
        // well, told apart by customer_id (seller rows carry location_id instead) —
        // and putting a GUEST's bank on the owner's money screen would be worse than
        // any of the confusions this file exists to prevent. Excluding on customer_id
        // rather than requiring location_id is the safe direction: it only drops rows
        // we are certain belong to someone else.
        if (trim((string) ($a['customer_id'] ?? '')) !== '') {
            continue;
        }
        $out[] = [
            'status' => strtoupper((string) ($a['status'] ?? '')),
            'creditable' => !empty($a['creditable']),
            'bank_name' => (string) ($a['bank_name'] ?? ''),
            'account_number_suffix' => (string) ($a['account_number_suffix'] ?? ''),
            'currency' => strtoupper((string) ($a['currency'] ?? '')),
        ];
        if (count($out) >= BANK_MAX) {
            break;
        }
    }
    return $out;
}

// Is the cache old enough to be worth a refresh? Same shape as payouts_stale().
function bank_stale($cache, $now = null)
{
    $now = $now === null ? time() : $now;
    if (!is_array($cache) || empty($cache['at'])) {
        return true;
    }
    return ($now - (int) $cache['at']) > BANK_TTL;
}

// ---- Impure below: DB + network. Guarded so the pure half above is testable
// ---- without a database, exactly as payouts-lib.php is.
if (function_exists('content_value')) {
    function bank_cached()
    {
        try {
            $raw = content_value(BANK_CACHE_KEY);
        } catch (\Throwable $e) {
            return null;
        }
        if (!is_string($raw) || $raw === '') {
            return null;
        }
        $d = json_decode($raw, true);
        return is_array($d) ? $d : null;
    }

    // Ask Square which bank accounts are linked. KEEPS THE LAST GOOD COPY on any
    // failure and records why — so a screen can say "we could not check" instead of
    // "you have no bank account", which is the same distinction bank_read() draws.
    function bank_refresh()
    {
        $prev = bank_cached();
        $fail = function ($reason) use ($prev) {
            $keep = is_array($prev) ? $prev : ['accounts' => []];
            $keep['checked'] = time();
            $keep['error'] = $reason;
            if (!isset($keep['at'])) {
                $keep['at'] = 0; // never successfully filled — still stale
            }
            try {
                content_set_scalar(BANK_CACHE_KEY, json_encode($keep));
            } catch (\Throwable $e) {
            }
            return ['ok' => false, 'reason' => $reason, 'accounts' => 0];
        };
        if (!function_exists('square_enabled') || !square_enabled()) {
            return $fail('Square payments are not switched on');
        }
        $res = square_api('GET', '/v2/bank-accounts?limit=' . BANK_MAX);
        if ((int) $res['status'] === 403) {
            // The predictable refusal, named for the same reason payouts does it:
            // "can't read bank accounts" is actionable, "no bank account" is a lie.
            return $fail("Square refused the request — the access token can't read bank accounts");
        }
        if ((int) $res['status'] < 200 || (int) $res['status'] >= 300) {
            return $fail('Square didn\'t answer (' . (int) $res['status'] . ')');
        }
        $accounts = bank_slim($res['body']['bank_accounts'] ?? []);
        $store = ['accounts' => $accounts, 'at' => time(), 'checked' => time(), 'error' => null];
        try {
            content_set_scalar(BANK_CACHE_KEY, json_encode($store));
        } catch (\Throwable $e) {
        }
        return ['ok' => true, 'accounts' => count($accounts)];
    }
}
