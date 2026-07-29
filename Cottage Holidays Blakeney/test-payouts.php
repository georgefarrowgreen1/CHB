<?php
// ============================================================
//  test-payouts.php — guards the "has it actually reached the bank?" decisions
//  (payouts-lib.php). Dev/CI only, deploy-excluded. No DB, no clock, no network:
//  every case passes an explicit "today" and a literal Square response shape.
//
//  What makes these worth writing: getting them wrong offers the owner money that
//  is not in the account yet. So the cases that matter most are the ones where the
//  honest answer is "no" or "I don't know" — a payout that failed, one that has not
//  arrived, a charge Square has said nothing about.
// ============================================================

// STUB SQUARE AND THE CONTENT STORE **BEFORE** the require, so payouts_refresh()'s
// own body — the part that pulls the shapes out of Square's response — is driven for
// real with no network and no DB. That code was the one thing the first version of
// this file could not see: get the nesting wrong and the charge map comes back empty,
// which reads on screen as the legitimate "Square hasn't said" state. PHP resolves
// function calls at call time, so these definitions win.
$SQ_CALLS = [];      // every request the library made, in order
$SQ_REPLY = [];      // path fragment => ['status'=>int,'body'=>array]
$SQ_STORE = [];      // the fake content table
$SQ_ENABLED = true;
function square_enabled()
{
    global $SQ_ENABLED;
    return $SQ_ENABLED;
}
function square_api($method, $path, $payload = null)
{
    global $SQ_CALLS, $SQ_REPLY;
    $SQ_CALLS[] = $method . ' ' . $path;
    foreach ($SQ_REPLY as $frag => $res) {
        if (strpos($path, $frag) !== false) {
            return $res;
        }
    }
    return ['status' => 404, 'body' => []];
}
function content_value($key)
{
    global $SQ_STORE;
    return $SQ_STORE[$key] ?? '';
}
function content_set_scalar($key, $val)
{
    global $SQ_STORE;
    $SQ_STORE[$key] = $val;
}

require_once __DIR__ . '/payouts-lib.php';

$pass = 0;
$fail = 0;
function pochk($name, $cond, $detail = '')
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "  \u{2713} $name\n";
    } else {
        $fail++;
        echo "  \u{2717} $name" . ($detail !== '' ? " — $detail" : '') . "\n";
    }
}
$eq = fn($a, $b) => abs((float) $a - (float) $b) < 0.005;
$TODAY = '2026-07-29';
// ONE reader for the fake content row. Inline json_decode(... ?? '{}') let PHPStan
// narrow the result to an empty array, so every offset read was an error; the
// docblock is what states the shape it really has.
/** @return array<string,mixed> */
function po_cache()
{
    global $SQ_STORE;
    $d = json_decode((string) ($SQ_STORE[PAYOUTS_CACHE_KEY] ?? ''), true);
    return is_array($d) ? $d : [];
}

// ---- IS IT IN THE BANK? ---------------------------------------------------
pochk('PAID is in the bank', payouts_landed(['status' => 'PAID'], $TODAY) === true);
pochk('SENT arriving yesterday is in the bank',
    payouts_landed(['status' => 'SENT', 'arrival_date' => '2026-07-28'], $TODAY) === true);
pochk('SENT arriving TODAY counts as landed (the date is when it lands)',
    payouts_landed(['status' => 'SENT', 'arrival_date' => $TODAY], $TODAY) === true);
pochk('SENT arriving tomorrow is NOT in the bank yet',
    payouts_landed(['status' => 'SENT', 'arrival_date' => '2026-07-30'], $TODAY) === false);
pochk('FAILED is not in the bank, and never will be',
    payouts_landed(['status' => 'FAILED'], $TODAY) === false);
// The two "don't guess" cases. Unknown must stay unknown: promoting it to spendable
// is the whole defect this file exists to prevent.
pochk('SENT with no arrival date is UNKNOWN, not assumed landed',
    payouts_landed(['status' => 'SENT'], $TODAY) === null);
pochk('a malformed arrival date is UNKNOWN, not string-compared',
    payouts_landed(['status' => 'SENT', 'arrival_date' => 'soon'], $TODAY) === null);
pochk('a status this code has never seen is UNKNOWN',
    payouts_landed(['status' => 'PENDING_SOMETHING'], $TODAY) === null);
pochk('status matching is case-insensitive', payouts_landed(['status' => 'paid'], $TODAY) === true);
pochk('an empty payout is UNKNOWN', payouts_landed([], $TODAY) === null);

// ---- READING SQUARE'S ENTRIES ---------------------------------------------
// Square money is in MINOR units and a fee is a deduction, so the sign convention
// is not depended on — abs() then pence-to-pounds.
$payouts = [
    ['id' => 'po_paid', 'status' => 'PAID', 'arrival_date' => '2026-07-27'],
    ['id' => 'po_soon', 'status' => 'SENT', 'arrival_date' => '2026-07-31'],
];
$entries = [
    'po_paid' => [
        ['type' => 'CHARGE', 'fee_amount_money' => ['amount' => 656, 'currency' => 'GBP'], 'type_charge_details' => ['payment_id' => 'sq_a']],
        // Not a charge: fees, refunds and adjustments are deliberately ignored here
        // (our own ledger owns deposit returns; a second source double-counts them).
        ['type' => 'REFUND', 'fee_amount_money' => ['amount' => -108], 'type_refund_details' => ['payment_id' => 'sq_a', 'refund_id' => 'rf_1']],
        ['type' => 'PROCESSING_FEE_REFUND', 'fee_amount_money' => ['amount' => -108]],
        // The case that makes the CHARGE filter load-bearing rather than decorative:
        // an entry of another type that ALSO references the payment. Square's
        // ActivityType list includes several (ADJUSTMENT, DISPUTE, FEE...), and this
        // one arrives AFTER the charge — so without the filter it would overwrite
        // the charge's real fee with an unrelated amount. Break-tested.
        ['type' => 'ADJUSTMENT', 'fee_amount_money' => ['amount' => 9900], 'type_charge_details' => ['payment_id' => 'sq_a']],
    ],
    'po_soon' => [
        ['type' => 'CHARGE', 'fee_amount_money' => ['amount' => -1225], 'type_charge_details' => ['payment_id' => 'sq_b']],
    ],
];
$map = payouts_charge_map($payouts, $entries, $TODAY);
pochk('only CHARGE entries become charge facts', count($map) === 2, 'got ' . count($map) . ': ' . implode(',', array_keys($map)));
pochk('a charge in a PAID payout is landed', ($map['sq_a']['landed'] ?? null) === true);
pochk('the REAL fee comes back in pounds', $eq($map['sq_a']['fee'] ?? -1, 6.56), 'got ' . ($map['sq_a']['fee'] ?? 'null'));
pochk('a non-CHARGE entry referencing the same payment cannot overwrite its fee',
    $eq($map['sq_a']['fee'] ?? -1, 6.56), 'got ' . ($map['sq_a']['fee'] ?? 'null') . ' — an ADJUSTMENT leaked in');
pochk('a negative (deduction) fee is read as a positive amount', $eq($map['sq_b']['fee'] ?? -1, 12.25));
pochk('a charge in a not-yet-arrived payout is NOT landed', ($map['sq_b']['landed'] ?? null) === false);
pochk('…and carries the date it is due', ($map['sq_b']['arrival'] ?? '') === '2026-07-31');
pochk('a CHARGE entry with no payment id is skipped, not keyed on empty',
    count(payouts_charge_map([['id' => 'p', 'status' => 'PAID']], ['p' => [['type' => 'CHARGE']]], $TODAY)) === 0);
pochk('a payout with no id is skipped', count(payouts_charge_map([['status' => 'PAID']], [], $TODAY)) === 0);
pochk('a charge with no fee yet reports null rather than £0',
    payouts_charge_map([['id' => 'p', 'status' => 'PAID']], ['p' => [['type' => 'CHARGE', 'type_charge_details' => ['payment_id' => 'x']]]], $TODAY)['x']['fee'] === null);

// ---- TAGGING OUR OWN TRANSACTIONS ----------------------------------------
$txns = [
    ['square_payment_id' => 'sq_a', 'rental' => 300, 'deposit' => 75, 'returned' => 0, 'fee' => 9.99, 'name' => 'Landed'],
    ['square_payment_id' => 'sq_b', 'rental' => 700, 'deposit' => 0, 'returned' => 0, 'fee' => 9.99, 'name' => 'On its way'],
    ['square_payment_id' => 'sq_unknown', 'rental' => 500, 'deposit' => 0, 'returned' => 0, 'fee' => 8.75, 'name' => 'Not in the payout data'],
    ['rental' => 200, 'deposit' => 0, 'returned' => 0, 'fee' => 3.50, 'name' => 'No Square id at all'],
];
$tagged = payouts_apply($txns, $map);
pochk('every transaction survives the tagging', count($tagged) === 4);
pochk('Square\'s real fee REPLACES our estimate', $eq($tagged[0]['fee'], 6.56) && !empty($tagged[0]['fee_actual']), 'fee ' . $tagged[0]['fee']);
pochk('…and the row says the figure is Square\'s, not ours', !empty($tagged[1]['fee_actual']) && $eq($tagged[1]['fee'], 12.25));
pochk('a charge Square has not mentioned keeps OUR fee and is UNKNOWN',
    $eq($tagged[2]['fee'], 8.75) && $tagged[2]['landed'] === null && empty($tagged[2]['fee_actual']));
pochk('a transaction with no Square id is UNKNOWN, not landed', $tagged[3]['landed'] === null);
// The Square payment id is machinery: it is consumed here and must not travel on to
// the client with the rest of the row.
pochk('the Square payment id is stripped on the way out',
    !array_key_exists('square_payment_id', $tagged[0]) && !array_key_exists('square_payment_id', $tagged[2]));

// ---- SPLITTING BY WHERE THE MONEY IS -------------------------------------
// Priced rows (what sweep_txn_totals hands back) carrying the tags above.
$priced = [
    ['name' => 'Landed', 'movable' => 294.75, 'landed' => true, 'arrival' => '2026-07-27'],
    ['name' => 'Soon', 'movable' => 687.75, 'landed' => false, 'arrival' => '2026-07-31'],
    ['name' => 'Sooner', 'movable' => 100.00, 'landed' => false, 'arrival' => '2026-07-30'],
    ['name' => 'Unknown', 'movable' => 491.25, 'landed' => null, 'arrival' => ''],
];
$split = payouts_split_totals($priced);
pochk('only landed money is offered as movable', $eq($split['inBank'], 294.75), 'got ' . $split['inBank']);
pochk('money on its way is its own figure', $eq($split['onWay'], 787.75), 'got ' . $split['onWay']);
pochk('money Square has not vouched for is its own figure too, not folded in',
    $eq($split['unknown'], 491.25));
pochk('the three buckets account for every penny',
    $eq($split['inBank'] + $split['onWay'] + $split['unknown'], 294.75 + 687.75 + 100 + 491.25));
pochk('the SOONEST arrival is the one reported', $split['nextArrival'] === '2026-07-30', 'got ' . $split['nextArrival']);
pochk('each bucket keeps its rows for the screen',
    $split['counts'] === ['inBank' => 1, 'onWay' => 2, 'unknown' => 1], json_encode($split['counts']));
// A FAILED payout is landed=false with no arrival date. It must NOT be movable, and
// calling it "on its way" would be a lie — it goes to unknown, which is honest.
$failed = payouts_split_totals([['movable' => 50, 'landed' => false, 'arrival' => '']]);
pochk('a FAILED payout is never movable', $eq($failed['inBank'], 0));
pochk('…and is not announced as arriving, because it is not', $eq($failed['onWay'], 0) && $eq($failed['unknown'], 50));
pochk('an empty list totals zero rather than erroring', $eq(payouts_split_totals([])['inBank'], 0));

// ---- WHEN TO REFRESH -----------------------------------------------------
pochk('no cache at all is stale', payouts_stale(null, 1000) === true);
pochk('a cache with no timestamp is stale', payouts_stale(['charges' => []], 1000) === true);
pochk('a fresh cache is not stale', payouts_stale(['at' => 1000], 1000 + PAYOUTS_TTL - 1) === false);
pochk('a cache exactly at the TTL is stale', payouts_stale(['at' => 1000], 1000 + PAYOUTS_TTL) === true);
pochk('a garbage cache is stale rather than trusted', payouts_stale('not an array', 1000) === true);

// ---- CURRENCY ------------------------------------------------------------
// Mixing a EUR amount into a sterling total reports a wrong figure silently, and
// "unknown" is a state this file already handles honestly everywhere else.
pochk('a GBP amount reads as pounds', $eq(payouts_money(['amount' => 1234, 'currency' => 'GBP']), 12.34));
pochk('a missing currency is accepted (older payloads)', $eq(payouts_money(['amount' => 500]), 5.00));
pochk('a DIFFERENT currency is refused, not converted', payouts_money(['amount' => 1000, 'currency' => 'EUR']) === null);
pochk('a missing amount is null, not zero', payouts_money(['currency' => 'GBP']) === null && payouts_money(null) === null);
pochk('…so a foreign-currency fee leaves the fee UNKNOWN rather than wrong',
    payouts_charge_map([['id' => 'p', 'status' => 'PAID']],
        ['p' => [['type' => 'CHARGE', 'fee_amount_money' => ['amount' => 900, 'currency' => 'USD'], 'type_charge_details' => ['payment_id' => 'x']]]],
        $TODAY)['x']['fee'] === null);

// ---- A FAILED PAYOUT IS A PROBLEM ---------------------------------------
$fp = payouts_failed([
    ['id' => 'po1', 'status' => 'FAILED', 'amount' => 604.05, 'arrival_date' => '2026-07-28'],
    ['id' => 'po2', 'status' => 'PAID', 'amount' => 100],
    ['id' => 'po3', 'status' => 'FAILED', 'amount' => -50], // sign not depended on
]);
pochk('failed payouts are counted and totalled', $fp['count'] === 2 && $eq($fp['amount'], 654.05), json_encode($fp));
pochk('a healthy account reports no payout trouble', payouts_failed([['id' => 'x', 'status' => 'PAID', 'amount' => 10]])['count'] === 0);

// ---- MONEY UNDER DISPUTE -------------------------------------------------
$dsp = payouts_disputes_open([
    ['id' => 'd1', 'state' => 'EVIDENCE_REQUIRED', 'amount_money' => ['amount' => 90000, 'currency' => 'GBP'], 'reason' => 'NO_KNOWLEDGE'],
    ['id' => 'd2', 'state' => 'PROCESSING', 'amount_money' => ['amount' => 5000, 'currency' => 'GBP']],
    ['id' => 'd3', 'state' => 'WON', 'amount_money' => ['amount' => 20000, 'currency' => 'GBP']],
    ['id' => 'd4', 'state' => 'LOST', 'amount_money' => ['amount' => 30000, 'currency' => 'GBP']],
    ['id' => 'd5', 'state' => 'ACCEPTED', 'amount_money' => ['amount' => 10000, 'currency' => 'GBP']],
    ['id' => 'd6', 'state' => 'INQUIRY_CLOSED', 'amount_money' => ['amount' => 7000, 'currency' => 'GBP']],
]);
pochk('open disputes are fenced', $dsp['count'] === 2 && $eq($dsp['amount'], 950.00), json_encode(['c' => $dsp['count'], 'a' => $dsp['amount']]));
// WON keeps the money; LOST and ACCEPTED already took it, so fencing either would
// hold the same money back twice.
pochk('a WON dispute is not fenced — the money stayed', !in_array('d3', array_column($dsp['items'], 'id'), true));
pochk('LOST and ACCEPTED are not fenced — that money has already gone',
    !in_array('d4', array_column($dsp['items'], 'id'), true) && !in_array('d5', array_column($dsp['items'], 'id'), true));
pochk('a closed inquiry is not fenced', !in_array('d6', array_column($dsp['items'], 'id'), true));
pochk('an inquiry still open IS fenced',
    payouts_disputes_open([['id' => 'i', 'state' => 'INQUIRY_EVIDENCE_REQUIRED', 'amount_money' => ['amount' => 1000, 'currency' => 'GBP']]])['count'] === 1);
pochk('a dispute whose amount cannot be read is not fenced on a guess',
    payouts_disputes_open([['id' => 'x', 'state' => 'PROCESSING', 'amount_money' => ['amount' => 1000, 'currency' => 'EUR']]])['count'] === 0);
pochk('the evidence deadline is carried through for the owner', ($dsp['items'][0]['reason'] ?? '') === 'NO_KNOWLEDGE');

// ---- THE ROLLED-FORWARD BALANCE -----------------------------------------
// "£2,000 on Tuesday" plus what Square has done since is not a stale figure; it is a
// running one with its basis stated.
$T0 = 1785000000;
$poList = [
    ['id' => 'a', 'status' => 'PAID', 'amount' => 604.05, 'landed_at' => $T0 + 86400],
    ['id' => 'b', 'status' => 'PAID', 'amount' => 100.00, 'landed_at' => $T0 - 86400], // BEFORE — already in the stated figure
    ['id' => 'c', 'status' => 'SENT', 'amount' => 500.00, 'landed_at' => 0],           // not arrived
    ['id' => 'd', 'status' => 'FAILED', 'amount' => 250.00, 'landed_at' => $T0 + 3600], // never arrived
];
$rfList = [
    ['amount' => 73.92, 'at' => $T0 + 7200],
    ['amount' => 10.00, 'at' => $T0 - 7200], // before the stated figure
];
$be = payouts_balance_estimate(['amount' => 2000, 'at' => $T0], $poList, $rfList, $T0 + 3 * 86400);
pochk('only payouts that landed AFTER the stated balance are added', $eq($be['in'], 604.05), 'got ' . $be['in']);
pochk('a payout that has not arrived is not added', $be['inCount'] === 1);
pochk('a FAILED payout is never added — that money did not arrive', $eq($be['in'], 604.05));
pochk('only debits after the stated balance are subtracted', $eq($be['out'], 73.92) && $be['outCount'] === 1);
pochk('the estimate is the stated figure plus in, minus out', $eq($be['estimate'], 2000 + 604.05 - 73.92), 'got ' . $be['estimate']);
pochk('the basis is reported so the screen can show its working', $eq($be['from'], 2000) && $be['at'] === $T0);
// Refusals — an estimate with no honest basis is worse than an empty field.
pochk('no stored balance → no estimate', payouts_balance_estimate(null, $poList, $rfList, $T0) === null);
pochk('a malformed stored balance → no estimate', payouts_balance_estimate(['amount' => 5], $poList, $rfList, $T0) === null);
pochk('a balance older than the limit is NOT rolled forward', payouts_balance_estimate(['amount' => 2000, 'at' => $T0], $poList, $rfList, $T0 + 31 * 86400) === null);
pochk('…but one inside it is', is_array(payouts_balance_estimate(['amount' => 2000, 'at' => $T0], $poList, $rfList, $T0 + 29 * 86400)));

// ---- THE REAL REFRESH, WITH SQUARE STUBBED ------------------------------
// Everything above tests decisions about shapes handed to it. This drives
// payouts_refresh() itself, which is where those shapes are EXTRACTED — get the
// nesting wrong and the map is empty, which looks exactly like a legitimate state.
$SQ_STORE = [];
$SQ_CALLS = [];
$SQ_REPLY = [
    '/v2/payouts?' => ['status' => 200, 'body' => ['payouts' => [
        ['id' => 'po_ok', 'status' => 'PAID', 'arrival_date' => gmdate('Y-m-d', time() - 86400),
            'amount_money' => ['amount' => 36844, 'currency' => 'GBP'],
            'payout_fee' => [['amount_money' => ['amount' => 150, 'currency' => 'GBP'], 'type' => 'TRANSFER_FEE']]],
        ['id' => 'po_bad', 'status' => 'FAILED', 'arrival_date' => gmdate('Y-m-d', time() - 3 * 86400),
            'amount_money' => ['amount' => 5000, 'currency' => 'GBP']],
    ]]],
    // Keyed per PAYOUT: a charge belongs to exactly one, and handing the same one to
    // two payouts let the FAILED payout overwrite the paid one's landed=true — a
    // fixture artefact that read as a real bug.
    'po_ok/payout-entries' => ['status' => 200, 'body' => ['payout_entries' => [
        ['type' => 'CHARGE', 'fee_amount_money' => ['amount' => 656, 'currency' => 'GBP'], 'type_charge_details' => ['payment_id' => 'sq_live']],
        ['type' => 'REFUND', 'net_amount_money' => ['amount' => -7392, 'currency' => 'GBP'], 'type_refund_details' => ['payment_id' => 'sq_live', 'refund_id' => 'rf_live']],
    ]]],
    'po_bad/payout-entries' => ['status' => 200, 'body' => ['payout_entries' => [
        ['type' => 'CHARGE', 'fee_amount_money' => ['amount' => 100, 'currency' => 'GBP'], 'type_charge_details' => ['payment_id' => 'sq_failed']],
    ]]],
    '/v2/disputes' => ['status' => 200, 'body' => ['disputes' => [
        ['id' => 'd_live', 'state' => 'EVIDENCE_REQUIRED', 'amount_money' => ['amount' => 90000, 'currency' => 'GBP']],
    ]]],
];
$r = payouts_refresh();
pochk('the refresh reports success', !empty($r['ok']), json_encode($r));
pochk('it asked Square for payouts, their entries AND disputes',
    count(array_filter($SQ_CALLS, fn($c) => strpos($c, '/v2/payouts?') !== false)) === 1
    && count(array_filter($SQ_CALLS, fn($c) => strpos($c, '/payout-entries') !== false)) === 2
    && count(array_filter($SQ_CALLS, fn($c) => strpos($c, '/v2/disputes') !== false)) === 1,
    implode(' | ', $SQ_CALLS));
$cache = po_cache();
pochk('the charge map is actually built from the response shape',
    isset($cache['charges']['sq_live']) && $eq($cache['charges']['sq_live']['fee'], 6.56),
    json_encode($cache['charges'] ?? null));
pochk('…and the charge is marked landed from its payout', ($cache['charges']['sq_live']['landed'] ?? null) === true);
pochk('refund lines are captured for the balance roll-forward',
    count($cache['refunds'] ?? []) === 1 && $eq($cache['refunds'][0]['amount'], 73.92), json_encode($cache['refunds'] ?? null));
// A charge inside a FAILED payout is known but NOT landed — the money never arrived.
pochk('a charge in the failed payout is known and not landed',
    isset($cache['charges']['sq_failed']) && $cache['charges']['sq_failed']['landed'] === false);
pochk('payout-level transfer fees are totalled, not apportioned', $eq($cache['payoutFees'] ?? -1, 1.50));
pochk('open disputes are stored', ($cache['disputes']['count'] ?? 0) === 1 && $eq($cache['disputes']['amount'] ?? 0, 900.00));
pochk('the failed payout is in the cache for the duty list',
    payouts_failed($cache['payouts'] ?? [])['count'] === 1);
pochk('a landed payout carries WHEN it landed, for the roll-forward',
    (int) ($cache['payouts'][0]['landed_at'] ?? 0) > 0 && (int) ($cache['payouts'][1]['landed_at'] ?? -1) === 0);
pochk('the cache is stamped so staleness can be judged',
    ($cache['at'] ?? 0) > 0 && array_key_exists('error', $cache) && $cache['error'] === null);

// A REFUSAL the owner must be told about in words, not as a status code.
$SQ_REPLY['/v2/payouts?'] = ['status' => 403, 'body' => []];
$prevCache = $SQ_STORE[PAYOUTS_CACHE_KEY];
$r403 = payouts_refresh();
pochk('a 403 is named as a permission problem', empty($r403['ok']) && strpos($r403['reason'], 'read payouts') !== false, json_encode($r403));
$after = po_cache();
pochk('a failed refresh KEEPS the last good data (the loadContent rule)',
    isset($after['charges']['sq_live']), json_encode(array_keys($after)));
pochk('…and records why, so the screen can say the data may be stale', ($after['error'] ?? '') !== '' && $after['error'] !== null);
// Square off is not an error to shout about, but it is not success either.
$SQ_ENABLED = false;
$rOff = payouts_refresh();
pochk('with Square switched off it declines rather than pretending', empty($rOff['ok']) && strpos($rOff['reason'], 'not switched on') !== false);
$SQ_ENABLED = true;
// One unreadable payout must not lose the others.
$SQ_STORE = [];
$SQ_REPLY['/v2/payouts?'] = ['status' => 200, 'body' => ['payouts' => [
    ['id' => 'po_ok', 'status' => 'PAID', 'arrival_date' => gmdate('Y-m-d', time() - 86400), 'amount_money' => ['amount' => 100, 'currency' => 'GBP']],
]]];
$SQ_REPLY['po_ok/payout-entries'] = ['status' => 500, 'body' => []];
$rPart = payouts_refresh();
pochk('an unreadable entry list still stores the payout it belongs to',
    !empty($rPart['ok']) && count(po_cache()['payouts']) === 1);
// Disputes failing separately must not lose the payout data.
$SQ_REPLY['po_ok/payout-entries'] = ['status' => 200, 'body' => ['payout_entries' => []]];
$SQ_REPLY['/v2/disputes'] = ['status' => 403, 'body' => []];
payouts_refresh();
$dspFail = po_cache();
pochk('a dispute read that fails says so without losing the payouts',
    strpos((string) ($dspFail['disputes']['error'] ?? ''), 'read disputes') !== false && count($dspFail['payouts']) === 1);

// ---- WIRING --------------------------------------------------------------
// The decisions above are worth nothing if nothing consults them.
$acct = (string) file_get_contents(__DIR__ . '/accounts.php');
$adm = (string) file_get_contents(__DIR__ . '/admin.js');
$rep = (string) file_get_contents(__DIR__ . '/self-repair.php');
$setup = (string) file_get_contents(__DIR__ . '/square-setup.php');

pochk('accounts.php tags its transactions and splits them',
    strpos($acct, "require_once __DIR__ . '/payouts-lib.php'") !== false
    && strpos($acct, 'payouts_apply($txns') !== false
    && strpos($acct, 'payouts_split_totals(') !== false);
// The order matters: the real fee has to land BEFORE the money is priced, or the
// arithmetic runs on the estimate and Square's figure is decoration.
pochk('the real fee is applied BEFORE the money is priced',
    strpos($acct, 'payouts_apply($txns') < strpos($acct, 'sweep_txn_totals($txns'));
// The page must never wait on Square. The fetch belongs to the cron and the
// explicit refresh; accounts.php may only READ the cache.
pochk('accounts.php never fetches from Square on the request path',
    strpos($acct, 'payouts_refresh(') === false && strpos($acct, 'payouts_cached(') !== false);
pochk('the daily cron is what fills the cache, and only when it is stale',
    strpos($rep, 'payouts_stale(payouts_cached()') !== false && strpos($rep, 'payouts_refresh()') !== false);
pochk('the owner can also ask Square directly',
    strpos($setup, "\$action === 'payouts_refresh'") !== false
    && strpos($adm, 'sweepRefreshPayouts') !== false
    && strpos($adm, "action: 'payouts_refresh'") !== false);
pochk('the screen counts only the in-the-bank total as movable',
    preg_match('/txGroup\(P\.items\.inBank[^)]*P\.inBank/', $adm) === 1
    && preg_match('/txGroup\(P\.items\.onWay[^)]*P\.onWay/', $adm) === 1
    && preg_match('/txGroup\(P\.items\.unknown[^)]*P\.unknown/', $adm) === 1);
pochk('…and says how fresh the payout data is', strpos($adm, 'Payouts checked') !== false && strpos($adm, 'have not been checked yet') !== false);
// An install with Square off, or before the first cron run, still has to show
// something — with the caveat stated rather than implied.
pochk('with no payout data the flat list still renders, caveat stated',
    strpos($adm, 'No payout data yet') !== false && strpos($adm, 'txFlat') !== false);
pochk('the cache key is classified internal so the public content GET cannot serve it',
    strpos((string) file_get_contents(__DIR__ . '/db.php'), "\$key === 'square-payouts'") !== false);

$hook = (string) file_get_contents(__DIR__ . '/square-webhook.php');
$boot = (string) file_get_contents(__DIR__ . '/admin-bootstrap.php');
$db = (string) file_get_contents(__DIR__ . '/db.php');
// LIVE, not nightly. Without the subscription the cache is only as fresh as the cron,
// so money that landed this morning reads as still on its way until tomorrow.
pochk('Square is asked to send payout events',
    strpos($setup, "'payout.sent'") !== false && strpos($setup, "'payout.paid'") !== false && strpos($setup, "'payout.failed'") !== false);
pochk('…and a payout event refreshes the cache',
    preg_match("/strpos\(\\\$type, 'payout\.'\) === 0/", $hook) === 1 && preg_match("/payout\.[\s\S]{0,400}payouts_refresh\(\)/", $hook) === 1);
// A dispute changes the fenced amount too, so it must not wait for the cron either.
pochk('a dispute event also refreshes it', preg_match("/dispute\.[\s\S]{0,900}payouts_refresh\(\)/", $hook) === 1);

// A FAILED payout is a problem the owner cannot see anywhere else. Carried on the
// bootstrap payload (the $feeds precedent) so it costs no request of its own.
// Both matched on the payload KEY and the READ, not the identifier: the variable
// $payoutTrouble and the global __payoutTroublePre both survive their own deletion,
// so a name-only check passed with the key dropped and the read hardcoded to null.
pochk('failed payouts and disputes ride the bootstrap payload, not a new request',
    strpos($boot, "'payoutTrouble' => \$payoutTrouble") !== false && strpos($boot, 'payouts_failed(') !== false
    && strpos($boot, 'payouts_cached()') !== false && strpos($boot, 'payouts_refresh(') === false);
pochk('the client keeps them for the duty list',
    preg_match('/__payoutTroublePre = \(ab && ab\.payoutTrouble\)/', (string) file_get_contents(__DIR__ . '/app.js')) === 1);
pochk('a failed payout becomes a DUTY, not just an excluded total',
    preg_match("/kind: 'payout'[\s\S]{0,200}couldn.{0,3}t pay/", $adm) === 1);
pochk('money under dispute becomes a duty too', preg_match("/kind: 'dispute'[\s\S]{0,160}under dispute/", $adm) === 1);

// The ring fence must actually INCLUDE the disputed money, or fencing it is a label.
pochk('the disputed amount is added to what must stay in the account',
    preg_match('/const ring = Number\(L\.net \|\| 0\) \+ disp \+ buf;/', $adm) === 1);
pochk('an issued-but-undebited refund is labelled, not shown as a job still to do',
    strpos($adm, 'Already refunded — waiting for Square to take it') !== false);

// The balance: stored WITH its date, rolled forward, and never overwritten mid-type.
pochk('the balance is stored with its date under the internal key',
    strpos($adm, "saveContent('sweep-balance'") !== false && strpos($adm, 'at: Math.floor(Date.now() / 1000)') !== false
    && strpos($db, "\$key === 'sweep-balance'") !== false);
pochk('the field starts from the rolled-forward estimate, labelled as one',
    strpos($adm, '__sweepBalTouched') !== false && strpos($adm, '<strong>estimate</strong>') !== false);
pochk('…and typing is never overwritten by a re-render',
    preg_match('/__sweepBalance === .{2} && est && !__sweepBalTouched/', $adm) === 1);
pochk('accounts.php rolls it forward server-side', strpos($acct, 'payouts_balance_estimate(') !== false);

// Search ANSWERS the question rather than opening the screen that holds the answer.
pochk('a move-money question is answered in the window',
    strpos($adm, 'CHB_SWEEP_Q') !== false && strpos($adm, 'cmdkSweepMerge') !== false
    && preg_match('/if \(CHB_SWEEP_Q\.test\(ql\)\) \{ try \{ cmdkSweepMerge\(\)/', $adm) === 1);
pochk('…stamp-guarded, so a late answer never lands over a newer query',
    preg_match('/__cmdkSweepStamp[\s\S]{0,600}stamp !== __cmdkSweepStamp \|\| gen !== __cmdkQueryGen/', $adm) === 1);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail PAYOUT CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass PAYOUT CHECKS PASSED \u{2705}\n";
