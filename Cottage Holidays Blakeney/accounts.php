<?php
// ============================================================
//  api/accounts.php — financial reporting (admin only).
//  GET ?year=2025  -> income received in the 2025/26 UK tax year
//                     (6 Apr 2025 – 5 Apr 2026), allocated by payment_date.
//  GET (no year)   -> list of available tax years + current.
//  Money "taken" = deposit_paid where payment_date falls in the year.
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

// UK tax year start year for a date (6 Apr boundary)
function tax_year_start($dateStr)
{
    if (!$dateStr) {
        return null;
    }
    [$y, $m, $d] = array_map('intval', explode('-', $dateStr));
    if ($m < 4 || ($m === 4 && $d < 6)) {
        return $y - 1;
    }
    return $y;
}

// All payments actually received (a positive deposit_paid with a date).
// agreed_total = full price the guest pays; agreed_booking_fee = the refundable
// damages deposit portion (held, not income). agreed_rental = total − deposit.
$bookings = db()
    ->query(
        'SELECT b.id, b.name, b.prop_key, b.deposit_paid, b.payment_method, b.payment_date,
            b.agreed_total, b.agreed_booking_fee, b.agreed_nightly, b.agreed_txn_fee, b.price_override,
            p.name AS property_name
     FROM bookings b JOIN properties p ON p.prop_key = b.prop_key
     WHERE b.deposit_paid > 0',
    )
    ->fetchAll();

// Ledger card payments per booking, oldest first (kind deposit/balance, settled).
// Cash-basis income belongs to the tax year each payment was RECEIVED, so a
// deposit taken before 6 Apr and a balance paid after it split across two years —
// the old model keyed the WHOLE booking to the single (and reconcile-rewritten)
// payment_date, so paying the balance retroactively migrated the deposit's income
// into the next tax year. We allocate each booking's income across these dates.
$cardByBooking = [];
try {
    $lq = db()->query(
        "SELECT booking_id, DATE(created_at) d, ROUND(SUM(amount),2) a
           FROM payments
          WHERE kind IN ('deposit','balance') AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED')
          GROUP BY booking_id, DATE(created_at)
          ORDER BY booking_id, d",
    );
    foreach ($lq->fetchAll() as $lr) {
        $cardByBooking[(int) $lr['booking_id']][] = [$lr['d'], (float) $lr['a']];
    }
} catch (\Throwable $e) {
    // payments table not migrated — every booking falls back to payment_date below.
}

// Split $income across the card-payment dates oldest-first (each date absorbs up
// to its own amount); any remainder (manual bank/cash money that has no ledger
// row) is attributed to the booking's payment_date. Returns [taxYear => portion].
function allocate_income_by_year($income, $cardDates, $paymentDate)
{
    $byYear = [];
    $remaining = $income;
    foreach ($cardDates as [$d, $amt]) {
        if ($remaining <= 0.005) {
            break;
        }
        $take = min($remaining, $amt);
        if ($take > 0.005) {
            $ty = tax_year_start($d);
            $byYear[$ty === null ? 'null' : $ty] = ($byYear[$ty === null ? 'null' : $ty] ?? 0) + $take;
            $remaining -= $take;
        }
    }
    if ($remaining > 0.005) {
        $ty = tax_year_start($paymentDate);
        $byYear[$ty === null ? 'null' : $ty] = ($byYear[$ty === null ? 'null' : $ty] ?? 0) + $remaining;
    }
    return $byYear;
}

$rows = []; // one entry per (booking, tax-year contribution) — held sits on the payment_date year
$years = [];
$undatedIncome = 0;
$undatedHeld = 0;
$undatedCount = 0;
foreach ($bookings as $b) {
    $received = (float) $b['deposit_paid'];
    // The rental price EXCLUDES the damages deposit in BOTH eras, so derive it from
    // the rental components (nightly + txn fee, override raising the floor) exactly
    // like damages_collected() — NOT as `agreed_total − deposit`. agreed_total is
    // already rental-only in the current model, so that old formula double-removed
    // the deposit: it under-reported taxable rental income by the deposit amount and
    // invented a phantom "held" deposit for every fully-paid modern booking.
    $rentalPrice = booking_rental_price($b); // shared derivation (db.php)
    // Legacy rows with no price snapshot: we can't split out a deposit we have no
    // figure for, so treat everything received as income (never a phantom deposit).
    if ($rentalPrice <= 0) {
        $rentalPrice = $received;
    }
    // Attribute money received to rental income FIRST; only the excess above the
    // rental price counts as the held damages deposit.
    $incomePart = min($received, $rentalPrice);
    $heldPart = max(0.0, $received - $rentalPrice);
    $paymentYear = tax_year_start($b['payment_date']); // where the held deposit + display date sit

    $byYear = allocate_income_by_year($incomePart, $cardByBooking[(int) $b['id']] ?? [], $b['payment_date']);
    if (!$byYear) {
        $byYear = [$paymentYear === null ? 'null' : $paymentYear => 0.0]; // no income (edge) — still surface held
    }
    foreach ($byYear as $tyKey => $portion) {
        $ty = $tyKey === 'null' ? null : (int) $tyKey;
        // Held deposit is not income and belongs once, on the payment_date year.
        $rowHeld = $ty === $paymentYear ? $heldPart : 0.0;
        $r = [
            'id' => $b['id'],
            'name' => $b['name'],
            'prop_key' => $b['prop_key'],
            'property_name' => $b['property_name'],
            'payment_method' => $b['payment_method'],
            'payment_date' => $b['payment_date'],
            'received' => round($received, 2),
            'income_part' => round($portion, 2),
            'held_part' => round($rowHeld, 2),
            'tax_year' => $ty,
        ];
        $rows[] = $r;
        if ($ty === null) {
            $undatedIncome += $portion;
            $undatedHeld += $rowHeld;
            $undatedCount++;
        } else {
            $years[$ty] = true;
        }
    }
}

// Retained income on CANCELLED bookings. `cancel` HARD-DELETES the booking row
// (to free the calendar), but a limited-refund cancellation keeps rental money;
// the card ledger rows survive the delete, so that genuinely-taxable income was
// vanishing from the report entirely. Count the net settled card-in for any
// booking_id no longer present, per received date. (Bank/cash-only cancellations
// leave no ledger row and are unrecoverable — inherent to a hard delete.)
try {
    $liveIds = [];
    foreach ($bookings as $b) {
        $liveIds[(int) $b['id']] = true;
    }
    $orphans = db()->query(
        "SELECT booking_id, DATE(created_at) d,
              ROUND(COALESCE(SUM(CASE WHEN kind IN ('deposit','balance') AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED') THEN amount ELSE 0 END),0)
                  - COALESCE(SUM(CASE WHEN kind='refund' AND (status IS NULL OR UPPER(status) NOT IN ('FAILED','REJECTED')) THEN amount ELSE 0 END),0),2) net
           FROM payments
          GROUP BY booking_id, DATE(created_at)
         HAVING net > 0.005",
    )->fetchAll();
    foreach ($orphans as $o) {
        if (isset($liveIds[(int) $o['booking_id']])) {
            continue; // live booking — already counted above
        }
        $ty = tax_year_start($o['d']);
        $rows[] = [
            'id' => (int) $o['booking_id'],
            'name' => '(cancelled booking)',
            'prop_key' => '',
            'property_name' => '',
            'payment_method' => 'Square card',
            'payment_date' => $o['d'],
            'received' => (float) $o['net'],
            'income_part' => (float) $o['net'],
            'held_part' => 0.0,
            'tax_year' => $ty,
        ];
        if ($ty === null) {
            $undatedIncome += (float) $o['net'];
            $undatedCount++;
        } else {
            $years[$ty] = true;
        }
    }
} catch (\Throwable $e) {
    // payments table not migrated — no orphan income to recover.
}
unset($r);

// Card processing fees (Square keeps these — the owner never receives them, so
// they are deducted from the profit automatically as a cost). Summed per charge
// DATE (payments.created_at) so the client can also split them into MTD
// quarters; card-IN rows only (a refund's row carries no fee of its own), live
// statuses only. Guarded: the payments table / fee column may predate the
// migration on a not-yet-migrated database.
$feeDays = [];
try {
    $feeDays = db()
        ->query(
            "SELECT DATE(created_at) d, ROUND(SUM(fee),2) f FROM payments
              WHERE fee IS NOT NULL AND fee > 0
                AND kind NOT IN ('refund','damages_return')
                AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED')
              GROUP BY DATE(created_at)",
        )
        ->fetchAll();
} catch (\Throwable $e) {
    /* payments table / fee column not migrated yet */
}

// Kept damage deposits are TAXABLE income the moment the owner retains them for
// damage — but they live in the payments ledger as kind='damages' rows (booked by
// keep_deposit / hold_capture), NOT in bookings.deposit_paid (which is rental
// only), so the rental-derived income above never sees them. Sum them per settle
// DATE (created_at) so they allocate to the right UK tax year like the fees.
// Guarded for a not-yet-migrated DB (the 'damages' enum value arrives in zz8).
$keptDays = [];
try {
    // Captured damages MINUS any damages_return refunded against them (net kept),
    // per settle date. hold_capture's own flow directs the owner to refund the
    // excess via the normal refund flow (kind='damages_return'), so a £250 capture
    // later £150-returned is only £100 of taxable kept income — the old query
    // summed the gross £250 forever. FAILED/REJECTED returns don't count as
    // money handed back (parity with the rental-refund status filter).
    $keptDays = db()
        ->query(
            "SELECT d, ROUND(SUM(a),2) a FROM (
                SELECT DATE(created_at) d, amount a FROM payments
                  WHERE kind = 'damages' AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED')
                UNION ALL
                SELECT DATE(created_at) d, -amount a FROM payments
                  WHERE kind = 'damages_return' AND (status IS NULL OR UPPER(status) NOT IN ('FAILED','REJECTED'))
             ) k GROUP BY d HAVING ROUND(SUM(a),2) <> 0",
        )
        ->fetchAll();
} catch (\Throwable $e) {
    /* payments table / 'damages' kind not migrated yet */
}

// Always include the current tax year as an option
$years[tax_year_start(date('Y-m-d'))] = true;
$yearList = array_keys($years);
rsort($yearList);

$requested = isset($_GET['year']) ? (int) $_GET['year'] : null;
if ($requested === null) {
    json_out(['years' => $yearList]); // dropdown options
}

$inYear = array_values(array_filter($rows, fn($r) => $r['tax_year'] === $requested));
usort($inYear, fn($a, $b) => strcmp($a['payment_date'] ?? '', $b['payment_date'] ?? ''));

$incomeTotal = array_sum(array_map(fn($r) => $r['income_part'], $inYear));
$heldTotal = array_sum(array_map(fn($r) => $r['held_part'], $inYear));
$byProp = [];
foreach ($inYear as $r) {
    $byProp[$r['prop_key']] = ($byProp[$r['prop_key']] ?? 0) + $r['income_part'];
}

// This tax year's card fees (per-day rows so the client can quarter them).
$feesInYear = array_values(array_filter($feeDays, fn($r) => tax_year_start($r['d']) === $requested));
$feesTotal = array_sum(array_map(fn($r) => (float) $r['f'], $feesInYear));

// This tax year's kept damage deposits (income, per settle date).
$keptInYear = array_values(array_filter($keptDays, fn($r) => tax_year_start($r['d']) === $requested));
$keptTotal = array_sum(array_map(fn($r) => (float) $r['a'], $keptInYear));

json_out([
    'year' => $requested,
    'years' => $yearList,
    'total' => round($incomeTotal, 2), // rental income only (gross of card fees)
    'held_deposits' => round($heldTotal, 2), // refundable, held — NOT income
    'card_fees' => round($feesTotal, 2), // kept by Square — auto-deducted cost
    'fee_days' => array_map(fn($r) => ['date' => $r['d'], 'fee' => (float) $r['f']], $feesInYear),
    'kept_deposits' => round($keptTotal, 2), // damage deposits retained — taxable income
    'kept_days' => array_map(fn($r) => ['date' => $r['d'], 'amount' => (float) $r['a']], $keptInYear),
    'count' => count($inYear),
    'by_property' => $byProp,
    'payments' => $inYear,
    'undated' => ['count' => $undatedCount, 'total' => round($undatedIncome, 2), 'held' => round($undatedHeld, 2)],
]);
