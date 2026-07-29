<?php
// ============================================================
//  test-sweep.php — guards the "safe to move" arithmetic (sweep-lib.php).
//  Dev/CI only, deploy-excluded. No DB, no clock, no network.
//
//  This decides how much real money the owner moves out of the account that
//  Square direct-debits, so the cases that matter most are the ones where being
//  wrong costs something: ring-fencing too little (the account goes short when a
//  refund lands) and ring-fencing too much (money sits idle).
// ============================================================

require_once __DIR__ . '/sweep-lib.php';

$pass = 0;
$fail = 0;
function swchk($name, $cond, $detail = '')
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

// ---- THE FEE SHARE ---------------------------------------------------------
// A £900 rental + £75 deposit charged together = £975 gross. Square's fee on the
// whole charge is £17.06. The deposit's share is 75/975 of that = £1.31, so
// refunding the deposit takes £75 out and puts £1.31 back — £73.69 net.
$r = sweep_row(75, 900, 17.06);
swchk('a deposit riding a rental charge is apportioned its share of the fee', $eq($r['feeBack'], 1.31), 'got ' . $r['feeBack']);
swchk('…so the NET cash leaving the account is deposit minus that share', $eq($r['net'], 73.69), 'got ' . $r['net']);
swchk('…and the gross debit is still the full deposit', $eq($r['gross'], 75));

// THE BUG THIS APPORTIONMENT PREVENTS: pay.php records the RENTAL only on the
// ledger row while the stored fee covers rental + deposit. Treating that fee as
// the deposit's own would credit back £17.06 on a £75 refund — ring-fencing
// £57.94 instead of £73.69 and leaving the account £15.75 short per deposit.
swchk('using the whole charge fee would ring-fence far too little (the trap)',
    $eq(75 - 17.06, 57.94) && $r['net'] > 75 - 17.06);

// A deposit charged ON ITS OWN (no rental in the same charge) → the whole fee is
// the deposit's.
$solo = sweep_row(75, 0, 1.31);
swchk('a deposit charged alone takes the whole fee as its share', $eq($solo['feeBack'], 1.31) && $eq($solo['net'], 73.69));

// ---- NOT YET SETTLED ------------------------------------------------------
// Square computes the fee a day or two later, so `fee` is NULL at first. Estimate
// from the rate rather than assuming zero fee (which would ring-fence the gross —
// too much) or the full deposit (absurd).
$pending = sweep_row(75, 900, null, 0.0175);
swchk('an unsettled charge estimates the fee from the rate', $eq($pending['feeBack'], 1.31), 'got ' . $pending['feeBack']);
swchk('…and still nets out sensibly', $eq($pending['net'], 73.69));

// ---- PARTIAL RETURNS -----------------------------------------------------
// £75 taken, £25 already handed back → £50 outstanding, and the fee credit
// follows the amount actually being refunded.
$part = sweep_row(50, 900, 17.06);
swchk('a partly-returned deposit apportions on what is still outstanding',
    $eq($part['gross'], 50) && $part['feeBack'] < $r['feeBack'], 'feeBack ' . $part['feeBack']);

// ---- FLOORS: a fee share can never exceed the money moving ---------------
$absurd = sweep_row(10, 0, 500);
swchk('a fee larger than the deposit is clamped, never negative net',
    $eq($absurd['feeBack'], 10) && $eq($absurd['net'], 0));
swchk('a zero/settled deposit is not a liability', sweep_row(0, 900, 17.06)['gross'] === 0.0);
swchk('a negative outstanding is treated as nothing', sweep_row(-40, 900, 17.06)['net'] === 0.0);

// ---- THE OBSERVED RATE ---------------------------------------------------
// Learned from settled charges so it follows the real account. Unsettled rows
// (fee null) contribute nothing.
$rate = sweep_observed_rate([
    ['gross' => 975, 'fee' => 17.06],
    ['gross' => 500, 'fee' => 8.75],
    ['gross' => 300, 'fee' => null], // not settled — ignored
]);
swchk('the rate is observed from settled charges only', $rate > 0.0170 && $rate < 0.0180, 'got ' . $rate);
swchk('no settled data → the documented default', sweep_observed_rate([['gross' => 100, 'fee' => null]]) === SWEEP_RATE_DEFAULT);
swchk('an implausible rate is refused, not used on real money',
    sweep_observed_rate([['gross' => 100, 'fee' => 40]]) === SWEEP_RATE_DEFAULT);
swchk('a suspiciously tiny rate is refused too',
    sweep_observed_rate([['gross' => 100000, 'fee' => 1]]) === SWEEP_RATE_DEFAULT);

// ---- TOTALS ---------------------------------------------------------------
$t = sweep_totals([
    ['outstanding' => 75, 'rental' => 900, 'fee' => 17.06, 'name' => 'Sarah'],
    ['outstanding' => 75, 'rental' => 400, 'fee' => 8.31, 'name' => 'Dan'],
    ['outstanding' => 0, 'rental' => 300, 'fee' => 5.25, 'name' => 'Settled already'],
]);
swchk('only outstanding deposits count toward the liability', $t['count'] === 2);
swchk('the gross total is the sum of the debits', $eq($t['gross'], 150));
swchk('the net total is what must stay in the account', $t['net'] < $t['gross'] && $t['net'] > 145, 'net ' . $t['net']);
swchk('gross = net + fee credited back (the books balance)', $eq($t['gross'], $t['net'] + $t['feeBack']));
swchk('display fields are carried through for the owner to read',
    ($t['items'][0]['name'] ?? '') === 'Sarah' && ($t['items'][1]['name'] ?? '') === 'Dan');

// ---- THE PLAN: the actual answer -----------------------------------------
$p = sweep_plan(2000, $t['net'], 0);
swchk('safe to move = balance minus the ring fence', $eq($p['safe'], round(2000 - $t['net'], 2)));
swchk('the ring fence is stated so it can be checked', $eq($p['ringFence'], $t['net']));
swchk('nothing is flagged short when the balance covers it', $eq($p['short'], 0));

$withBuffer = sweep_plan(2000, $t['net'], 250);
swchk('a chosen buffer raises the ring fence and lowers what is safe',
    $eq($withBuffer['ringFence'], round($t['net'] + 250, 2)) && $eq($withBuffer['safe'], round($p['safe'] - 250, 2)));

// ALREADY TOO LOW: the account is below what the refunds will need. Saying
// "safe: £0" alone would hide that — the shortfall is the actionable number.
$tight = sweep_plan(100, 300, 0);
swchk('an account already below the ring fence reports the SHORTFALL', $eq($tight['short'], 200));
swchk('…and never suggests moving money out of it', $eq($tight['safe'], 0));
swchk('a zero balance is handled, not divided by', $eq(sweep_plan(0, 300, 0)['short'], 300));
swchk('no liability at all → the whole balance is free', $eq(sweep_plan(500, 0, 0)['safe'], 500));

// ---- A RETURN THAT HASN'T LEFT YET ---------------------------------------
// return_deposit marks hold_status='returned' the moment the refund is ISSUED, but
// Square debits the bank a day or two later. Dropping it out of the ring fence then
// is the mirror of counting an un-paid-out charge as movable: refund £75, be told
// £75 more is movable, go short on Thursday.
$fresh = sweep_outstanding(75, 0, 75, 0);
swchk('a refund that is issued but not settled STAYS in the ring fence', $eq($fresh['outstanding'], 75), 'got ' . $fresh['outstanding']);
swchk('…and is flagged as already refunded, not as a job still to do', $eq($fresh['awaiting'], 75));
$done = sweep_outstanding(75, 75, 0, 0);
swchk('a SETTLED return leaves the ring fence', $eq($done['outstanding'], 0) && $eq($done['awaiting'], 0));
$partly = sweep_outstanding(75, 25, 50, 0);
swchk('a part-settled return fences only what is left', $eq($partly['outstanding'], 50) && $eq($partly['awaiting'], 50));
// A row nobody will ever confirm must not fence money forever — the owner could
// never clear it. Old unconfirmed returns are assumed to have landed.
$stale = sweep_outstanding(75, 0, 0, 75);
swchk('an old unconfirmed return is assumed landed, not fenced for ever', $eq($stale['outstanding'], 0));
swchk('awaiting can never exceed what is outstanding',
    $eq(sweep_outstanding(75, 50, 75, 0)['awaiting'], 25), 'got ' . sweep_outstanding(75, 50, 75, 0)['awaiting']);
swchk('over-returning cannot make the fence negative', $eq(sweep_outstanding(75, 200, 0, 0)['outstanding'], 0));
swchk('an untouched deposit is fenced in full, nothing awaiting',
    $eq(sweep_outstanding(75, 0, 0, 0)['outstanding'], 75) && $eq(sweep_outstanding(75, 0, 0, 0)['awaiting'], 0));

// ---- PER TRANSACTION -----------------------------------------------------
// The same question asked of ONE settled charge: £900 rental + £75 deposit, fee
// £17.06 → £957.94 landed, £73.69 of it is going back out, so £884.25 is movable.
$tx = sweep_txn(900, 75, 0, 17.06);
swchk('a charge reports what actually settled', $eq($tx['settled'], 957.94), 'got ' . $tx['settled']);
swchk('…what is held back for its deposit', $eq($tx['ringFence'], 73.69), 'got ' . $tx['ringFence']);
swchk('…and what is movable, deposit excluded', $eq($tx['movable'], 884.25), 'got ' . $tx['movable']);
// THE IDENTITY: movable is the RENTAL net of its own fee share, because every
// penny of the deposit either has left or is going to. Nothing else can be true.
swchk('movable == rental net of its share of the fee (the identity)',
    $eq($tx['movable'], 900 - 17.06 * (900 / 975)), 'got ' . $tx['movable']);
swchk('settled = movable + already-out + ring fence (the books balance)',
    $eq($tx['settled'], $tx['movable'] + $tx['alreadyOut'] + $tx['ringFence']));

// A charge with NO deposit riding it — a later balance payment — is movable in
// full, less its fee. This is the case that must NOT re-hold a deposit already
// held against the guest's first payment.
$plain = sweep_txn(400, 0, 0, 7.00);
swchk('a charge carrying no deposit is movable in full, less the fee',
    $eq($plain['movable'], 393) && $eq($plain['ringFence'], 0));

// ALREADY RETURNED: that money has left the bank, so it is neither movable nor
// still ring-fenced — counting it as either would be wrong in both directions.
$done = sweep_txn(900, 75, 75, 17.06);
swchk('a fully-returned deposit holds nothing back', $eq($done['ringFence'], 0));
swchk('…and the money it took is not offered as movable',
    $eq($done['movable'], 884.25) && $eq($done['alreadyOut'], 73.69), 'movable ' . $done['movable']);
$half = sweep_txn(900, 75, 25, 17.06);
swchk('a part-returned deposit holds back only the rest',
    $eq($half['ringFence'], 49.13) && $eq($half['alreadyOut'], 24.56), 'ring ' . $half['ringFence']);
swchk('…and movable is unchanged by WHEN the deposit leaves', $eq($half['movable'], 884.25));

// Unsettled fee, and the guards.
$pend = sweep_txn(900, 75, 0, null, 0.0175);
swchk('an unsettled charge estimates its fee before reporting movable',
    $pend['movable'] > 870 && $pend['movable'] < 900, 'got ' . $pend['movable']);
swchk('a fee bigger than the charge cannot make movable negative',
    sweep_txn(100, 0, 0, 5000)['movable'] === 0.0);
// A `returned` bigger than the deposit should be impossible (the server caps a
// refund at what is left), so the clamp is defensive — and what it defends is
// MOVABLE, not the ring fence: unclamped, £500 "already out" against a £75 deposit
// eats £425 of the rental and reports £466.69 movable instead of £884.25. Asserting
// the ring fence here proves nothing, since a negative outstanding floors at 0 either
// way — which is how the first version of this check passed with the clamp deleted.
swchk('a returned amount beyond the deposit cannot eat the rental',
    $eq(sweep_txn(900, 75, 500, 17.06)['movable'], 884.25), 'got ' . sweep_txn(900, 75, 500, 17.06)['movable']);

$tt = sweep_txn_totals([
    ['rental' => 900, 'deposit' => 75, 'returned' => 0, 'fee' => 17.06, 'name' => 'Sarah'],
    ['rental' => 400, 'deposit' => 0, 'returned' => 0, 'fee' => 7.00, 'name' => 'Dan balance'],
], 0.0175);
swchk('transaction totals count every charge', $tt['count'] === 2);
swchk('the movable total is the sum of the movable parts', $eq($tt['movable'], 884.25 + 393), 'got ' . $tt['movable']);
swchk('the ring fence total only counts charges carrying a deposit', $eq($tt['ringFence'], 73.69));
swchk('settled total = movable + ring fence when nothing has gone back yet',
    $eq($tt['settled'], $tt['movable'] + $tt['ringFence']));
swchk('transaction display fields are carried through',
    ($tt['items'][1]['name'] ?? '') === 'Dan balance');

// ---- WIRING ---------------------------------------------------------------
// The arithmetic above passes just as happily when nothing calls it. These read
// the real call sites, because the previous version of this feature could have
// shipped with a correct library and a screen that computed its own figures.
$acct = (string) file_get_contents(__DIR__ . '/accounts.php');
$adm = (string) file_get_contents(__DIR__ . '/admin.js');
$views = (string) file_get_contents(__DIR__ . '/admin-views.html');

swchk('accounts.php uses the shared library, not its own copy of the maths',
    strpos($acct, "require_once __DIR__ . '/sweep-lib.php'") !== false
    && strpos($acct, 'sweep_totals(') !== false
    && strpos($acct, 'sweep_observed_rate(') !== false);
swchk('…and returns it in the payload the screen already fetches (no extra round trip)',
    preg_match("/'deposit_liability'\s*=>\s*\\\$sweep/", $acct) === 1);

// The liability is "what is still owed back", which has nothing to do with a tax
// year — held_deposits above IS year-filtered and would be the wrong basis.
if (preg_match('/SAFE TO MOVE(.*?)json_out\(/s', $acct, $m)) {
    swchk('the liability query is NOT filtered to a tax year',
        strpos($m[1], '$requested') === false && strpos($m[1], 'tax_year') === false);
    swchk('only deposits actually taken are counted', strpos($m[1], "hold_status IN ('charged','captured')") !== false);
    // Case-folded like the other two ledger queries in this file: a lowercase
    // 'failed' slipping through would count as already returned, understate the
    // ring fence and leave the account short — the expensive direction.
    swchk('a failed refund does not count as already returned',
        strpos($m[1], "UPPER(r.status) NOT IN ('FAILED','REJECTED')") !== false);
    swchk('a failed query reports unknown rather than a confident zero',
        preg_match("/catch[^}]*\\\$sweep\['error'\]\s*=\s*true/s", $m[1]) === 1);
    // The three-way split is what keeps an issued-but-undebited refund fenced.
    // Matched on the CALL's arguments, not the bare name: the comment above the query
    // says "see sweep_outstanding()", so a name-only check passed with the call
    // replaced by an inline (wrong) subtraction — prose satisfying a code check.
    swchk('the query separates settled returns from pending ones',
        strpos($m[1], 'ret_settled') !== false && strpos($m[1], 'ret_pending') !== false && strpos($m[1], 'ret_stale') !== false
        && strpos($m[1], "sweep_outstanding(\$r['hold_amount']") !== false);
    swchk('a booking already marked returned is still selected while its refund is pending',
        preg_match("/hold_status = 'returned' AND EXISTS/", $m[1]) === 1);
    swchk("'MANUAL' counts as settled — a return booked by hand has already happened",
        preg_match("/IN \('COMPLETED','MANUAL'\)/", $m[1]) === 1);
} else {
    swchk('the liability block is present in accounts.php', false, 'block not found');
    $fail += 3;
}

// The per-transaction half. Its two real hazards are both in the query.
if (preg_match('/PER TRANSACTION(.*?)\} catch/s', $acct, $mt)) {
    swchk('the per-transaction list uses the shared library too',
        strpos($mt[1], 'sweep_txn_totals(') !== false
        && preg_match("/\\\$sweep\['transactions'\]\s*=/", $mt[1]) === 1);
    // A deposit rides the guest's FIRST payment. Without this match, a later
    // balance payment on the same booking would hold the same deposit back twice.
    swchk('a deposit is matched to the charge that CARRIED it',
        strpos($mt[1], 'hold_payment_id') !== false
        && strpos($mt[1], 'square_payment_id') !== false);
    // An old charge with money still to go back is exactly what must not fall off
    // the end of a recency window.
    swchk('an older charge still holding a deposit is not dropped by the date window',
        preg_match('/created_at >= DATE_SUB.*?OR \(b\.hold_status IN/s', $mt[1]) === 1);
    swchk('only settled charges are counted', strpos($mt[1], "UPPER(p.status) IN ('COMPLETED','APPROVED','CAPTURED')") !== false);
} else {
    swchk('the per-transaction block is present in accounts.php', false, 'block not found');
    $fail += 3;
}
swchk('the screen shows the movable figure per payment and a total',
    strpos($adm, 'L.transactions') !== false
    && preg_match('/gbp\(it\.movable\)/', $adm) === 1
    && preg_match('/gbp\(T\.movable\)/', $adm) === 1);

swchk('the screen exists and is reachable from the Payments index',
    strpos($adm, 'function renderSweep(') !== false
    && preg_match("/section === 'sweep'\s*\)\s*\{\s*renderSweep\(\)/", $adm) === 1
    && preg_match("/sweep:\s*'Move money out'/", $adm) === 1
    && strpos($views, 'asec-sweep') !== false
    && strpos($views, 'sweep-body') !== false
    && preg_match('/data-act="accountsOpen"[^>]*data-arg="sweep"/', $views) === 1);
swchk('the screen renders the SERVER figure, never its own fee maths',
    strpos($adm, 'rep.deposit_liability') !== false
    && preg_match('/__sweepBalance[^\n]*(saveContent|localStorage|sessionStorage)/', $adm) === 0
    && preg_match('/(saveContent|localStorage|sessionStorage)[^\n]*__sweepBalance/', $adm) === 0);
swchk('typing a balance recomputes from cache instead of re-querying',
    preg_match('/renderSweep\(false\)/', $adm) === 1 && strpos($adm, 'if (refetch !== false) __sweepLiab = null;') !== false);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail SWEEP CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass SWEEP CHECKS PASSED \u{2705}\n";
