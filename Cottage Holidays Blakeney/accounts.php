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
$rows = db()
    ->query(
        'SELECT b.id, b.name, b.prop_key, b.deposit_paid, b.payment_method, b.payment_date,
            b.agreed_total, b.agreed_booking_fee, b.agreed_nightly, b.agreed_txn_fee, b.price_override,
            p.name AS property_name
     FROM bookings b JOIN properties p ON p.prop_key = b.prop_key
     WHERE b.deposit_paid > 0',
    )
    ->fetchAll();

$years = [];
$undatedIncome = 0;
$undatedHeld = 0;
$undatedCount = 0;
foreach ($rows as &$r) {
    $received = (float) $r['deposit_paid'];
    // The rental price EXCLUDES the damages deposit in BOTH eras, so derive it from
    // the rental components (nightly + txn fee, override raising the floor) exactly
    // like damages_collected() — NOT as `agreed_total − deposit`. agreed_total is
    // already rental-only in the current model, so that old formula double-removed
    // the deposit: it under-reported taxable rental income by the deposit amount and
    // invented a phantom "held" deposit for every fully-paid modern booking.
    $rentalPrice = (float) ($r['agreed_nightly'] ?? 0) + (float) ($r['agreed_txn_fee'] ?? 0);
    if ($r['price_override'] !== null && $r['price_override'] !== '') {
        $rentalPrice = max($rentalPrice, (float) $r['price_override']);
    }
    // Legacy rows with no price snapshot: we can't split out a deposit we have no
    // figure for, so treat everything received as income (never a phantom deposit).
    if ($rentalPrice <= 0) {
        $rentalPrice = $received;
    }

    // Attribute money received to rental income FIRST; only the excess above the
    // rental price counts as the held damages deposit.
    $incomePart = min($received, $rentalPrice);
    $heldPart = max(0.0, $received - $rentalPrice);

    $r['received'] = round($received, 2);
    $r['income_part'] = round($incomePart, 2);
    $r['held_part'] = round($heldPart, 2);
    $r['tax_year'] = tax_year_start($r['payment_date']);
    if ($r['tax_year'] === null) {
        $undatedIncome += $incomePart;
        $undatedHeld += $heldPart;
        $undatedCount++;
    } else {
        $years[$r['tax_year']] = true;
    }
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
    $keptDays = db()
        ->query(
            "SELECT DATE(created_at) d, ROUND(SUM(amount),2) a FROM payments
              WHERE kind = 'damages'
                AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED')
              GROUP BY DATE(created_at)",
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
