<?php
// ============================================================
//  sweep-lib.php — "how much can I move out of the Square account?"
//
//  THE MECHANICS THIS MODELS (owner-confirmed for this Square account):
//    1. A card charge settles to the bank MINUS Square's processing fee.
//    2. When a damage deposit is refunded, Square direct-debits the refund from
//       the bank AND credits back the fee it charged on that portion.
//
//  So the cash that LEAVES on a refund is the same net figure that ARRIVED for
//  that deposit — deposit minus its share of the fee. That is the amount that has
//  to stay in the account, and it is why ring-fencing the gross deposit leaves
//  too much sitting idle while ring-fencing nothing leaves the account short.
//
//  WHY A FEE SHARE AND NOT JUST THE FEE. pay.php charges the rental portion and
//  the refundable deposit as ONE Square payment, but the ledger row records the
//  RENTAL only (the deposit lives on bookings.hold_*). The stored `fee` therefore
//  belongs to a gross that is LARGER than the row's `amount`, so the deposit's
//  share has to be apportioned: fee x deposit / (rental + deposit). Using the fee
//  as-is would over-state the credit and leave the account short.
//
//  Pure functions only — no DB, no clock, no I/O — so test-sweep.php can drive
//  the arithmetic directly. accounts.php supplies the rows.
// ============================================================

// Square's effective rate, OBSERVED from settled charges rather than hard-coded,
// so it follows the real account (and a rate change) without an edit. $rows are
// ['gross' => float, 'fee' => float|null]; rows with no settled fee are ignored.
// Clamped to a sane band so one odd row (a £0.01 test, a refund mis-keyed) cannot
// skew every estimate, and falls back to $default when there is nothing to learn
// from.
const SWEEP_RATE_MIN = 0.005; // 0.5%
const SWEEP_RATE_MAX = 0.05; // 5%
const SWEEP_RATE_DEFAULT = 0.0175; // 1.75% — only used until real fees land
function sweep_observed_rate(array $rows, $default = SWEEP_RATE_DEFAULT)
{
    $gross = 0.0;
    $fee = 0.0;
    foreach ($rows as $r) {
        $g = (float) ($r['gross'] ?? 0);
        $f = $r['fee'] ?? null;
        if ($g > 0 && $f !== null && (float) $f >= 0) {
            $gross += $g;
            $fee += (float) $f;
        }
    }
    if ($gross <= 0) {
        return $default;
    }
    $rate = $fee / $gross;
    if ($rate < SWEEP_RATE_MIN || $rate > SWEEP_RATE_MAX) {
        return $default; // implausible — don't let it drive real money
    }
    return $rate;
}

// The fee Square will credit back when $outstanding of a deposit is refunded.
// $rentalPart + $outstanding is the charge's gross; $chargeFee is the fee for the
// WHOLE charge (null until Square settles it, in which case estimate from $rate).
function sweep_fee_share($outstanding, $rentalPart, $chargeFee, $rate = SWEEP_RATE_DEFAULT)
{
    $outstanding = round(max(0, (float) $outstanding), 2);
    if ($outstanding <= 0) {
        return 0.0;
    }
    if ($chargeFee === null || (float) $chargeFee < 0) {
        return round(min($outstanding, $outstanding * (float) $rate), 2);
    }
    $gross = round($outstanding + max(0, (float) $rentalPart), 2);
    if ($gross <= 0) {
        return 0.0;
    }
    $share = (float) $chargeFee * ($outstanding / $gross);
    // A fee share can never exceed the money being refunded.
    return round(max(0, min($outstanding, $share)), 2);
}

// One outstanding deposit → what the bank actually does when it is refunded.
//   gross   the debit Square takes
//   feeBack the fee it credits back at the same time
//   net     the cash that genuinely leaves (what must stay in the account)
function sweep_row($outstanding, $rentalPart, $chargeFee, $rate = SWEEP_RATE_DEFAULT)
{
    $gross = round(max(0, (float) $outstanding), 2);
    $feeBack = sweep_fee_share($gross, $rentalPart, $chargeFee, $rate);
    return ['gross' => $gross, 'feeBack' => $feeBack, 'net' => round(max(0, $gross - $feeBack), 2)];
}

// Sum the outstanding deposits. $items are ['outstanding','rental','fee'] (+ any
// extra keys, which are carried through untouched for display).
function sweep_totals(array $items, $rate = SWEEP_RATE_DEFAULT)
{
    $gross = 0.0;
    $feeBack = 0.0;
    $net = 0.0;
    $out = [];
    foreach ($items as $it) {
        $r = sweep_row($it['outstanding'] ?? 0, $it['rental'] ?? 0, $it['fee'] ?? null, $rate);
        if ($r['gross'] <= 0) {
            continue; // nothing outstanding — not a liability
        }
        $gross += $r['gross'];
        $feeBack += $r['feeBack'];
        $net += $r['net'];
        $out[] = array_merge($it, $r);
    }
    return [
        'gross' => round($gross, 2),
        'feeBack' => round($feeBack, 2),
        'net' => round($net, 2),
        'count' => count($out),
        'items' => $out,
        'rate' => round($rate, 5),
    ];
}

// HOW MUCH OF A DEPOSIT IS STILL TO LEAVE THE ACCOUNT.
//
// bookings.php's return_deposit marks hold_status='returned' the moment a refund is
// ISSUED — but Square's refund starts PENDING and the bank debit lands a day or two
// later (which is why reconcile_pending_refunds() exists at all). So "returned" does
// NOT mean "gone", and treating it as gone dropped the money out of the ring fence
// while it was still sitting in the account: refund £73.92, be told £73.92 more is
// movable, then go short when Square debits it. The exact mirror of counting an
// un-paid-out charge as movable.
//
// So a return only reduces the liability once it has SETTLED. Three inputs:
//   $settled       returns Square has confirmed (COMPLETED), or booked by hand
//   $pendingRecent returns issued but not yet confirmed
//   $pendingStale  ditto, but old enough that they have almost certainly landed and
//                  simply were never confirmed — assumed settled, because fencing
//                  money forever on a row nobody will ever update is its own bug
//                  (the owner can never clear it). accounts.php draws that line at
//                  14 days; reconcile_pending_refunds only looks back 60.
// Returns:
//   outstanding  what still has to leave (the ring fence)
//   awaiting     of that, how much is already refunded and just waiting on Square
function sweep_outstanding($hold, $settled, $pendingRecent = 0, $pendingStale = 0)
{
    $hold = round(max(0, (float) $hold), 2);
    $gone = round(max(0, (float) $settled) + max(0, (float) $pendingStale), 2);
    $outstanding = round(max(0, $hold - $gone), 2);
    return [
        'outstanding' => $outstanding,
        'awaiting' => round(min(max(0, (float) $pendingRecent), $outstanding), 2),
    ];
}

// ONE SETTLED CHARGE → how much of what it brought in is movable.
// The aggregate above answers "what must stay in the account"; this answers it per
// transaction, which is how the owner reads a Square payout list: this £975 landed,
// £73.69 of it is going back out, so £899.03 is mine to move.
//
//   $rentalPart      the charge's rental portion (payments.amount — rental only)
//   $depositCharged  the refundable deposit that rode THIS charge (0 if none did)
//   $depositReturned how much of it has already gone back
//   $chargeFee       Square's fee for the whole charge (null → estimate from $rate)
//
//   gross      what the guest was charged
//   fee        Square's cut
//   settled    what actually reached the bank
//   alreadyOut the deposit money that has already left again
//   ringFence  the deposit's net still to leave
//   movable    settled - alreadyOut - ringFence
//
// The identity worth knowing (and asserted in test-sweep.php): movable always
// equals the RENTAL portion net of its own share of the fee, because every penny
// of the deposit either has left or is going to. So a transaction carrying no
// deposit is movable in full, less its fee — no special case needed.
function sweep_txn($rentalPart, $depositCharged, $depositReturned, $chargeFee, $rate = SWEEP_RATE_DEFAULT)
{
    $rentalPart = round(max(0, (float) $rentalPart), 2);
    $charged = round(max(0, (float) $depositCharged), 2);
    $returned = round(min($charged, max(0, (float) $depositReturned)), 2);
    $gross = round($rentalPart + $charged, 2);
    $fee = $chargeFee === null || (float) $chargeFee < 0
        ? round($gross * (float) $rate, 2)
        : round(min($gross, max(0, (float) $chargeFee)), 2);
    $outstanding = round($charged - $returned, 2);
    // Both halves are apportioned against the TRUE gross, so the fee splits
    // exactly between what has gone and what is still to go.
    $outNet = round($returned - sweep_fee_share($returned, $gross - $returned, $fee, $rate), 2);
    $ring = round($outstanding - sweep_fee_share($outstanding, $gross - $outstanding, $fee, $rate), 2);
    $settled = round(max(0, $gross - $fee), 2);
    return [
        'gross' => $gross,
        'fee' => $fee,
        'settled' => $settled,
        'alreadyOut' => max(0.0, $outNet),
        'ringFence' => max(0.0, $ring),
        'movable' => round(max(0, $settled - max(0.0, $outNet) - max(0.0, $ring)), 2),
    ];
}

// Sum a list of transactions. $items are ['rental','deposit','returned','fee'] (+
// any display keys, carried through untouched).
function sweep_txn_totals(array $items, $rate = SWEEP_RATE_DEFAULT)
{
    $settled = 0.0;
    $ring = 0.0;
    $movable = 0.0;
    $out = [];
    foreach ($items as $it) {
        $t = sweep_txn($it['rental'] ?? 0, $it['deposit'] ?? 0, $it['returned'] ?? 0, $it['fee'] ?? null, $rate);
        $settled += $t['settled'];
        $ring += $t['ringFence'];
        $movable += $t['movable'];
        $out[] = array_merge($it, $t);
    }
    return [
        'settled' => round($settled, 2),
        'ringFence' => round($ring, 2),
        'movable' => round($movable, 2),
        'count' => count($out),
        'items' => $out,
    ];
}

// The answer to the actual question. $balance is what the account holds right now
// (the owner types it — no bank feed), $net the ring-fenced deposit liability,
// $buffer a cushion the owner chooses for the unpredictable (a chargeback, a
// rental refund).
//   ringFence  keep at least this much
//   safe       move up to this much
//   short      by how much the account is ALREADY below the ring fence (0 if fine)
function sweep_plan($balance, $net, $buffer = 0.0)
{
    $balance = round((float) $balance, 2);
    $net = round(max(0, (float) $net), 2);
    $buffer = round(max(0, (float) $buffer), 2);
    $ringFence = round($net + $buffer, 2);
    return [
        'balance' => $balance,
        'ringFence' => $ringFence,
        'safe' => round(max(0, $balance - $ringFence), 2),
        'short' => round(max(0, $ringFence - $balance), 2),
    ];
}
