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

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail PAYOUT CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass PAYOUT CHECKS PASSED \u{2705}\n";
