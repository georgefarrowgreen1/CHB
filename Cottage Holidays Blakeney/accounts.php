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
function tax_year_start($dateStr) {
    if (!$dateStr) return null;
    [$y,$m,$d] = array_map('intval', explode('-', $dateStr));
    if ($m < 4 || ($m === 4 && $d < 6)) return $y - 1;
    return $y;
}

// All payments actually received (a positive deposit_paid with a date).
// agreed_total = full price the guest pays; agreed_booking_fee = the refundable
// damages deposit portion (held, not income). agreed_rental = total − deposit.
$rows = db()->query(
    'SELECT b.id, b.name, b.prop_key, b.deposit_paid, b.payment_method, b.payment_date,
            b.agreed_total, b.agreed_booking_fee,
            p.name AS property_name
     FROM bookings b JOIN properties p ON p.prop_key = b.prop_key
     WHERE b.deposit_paid > 0'
)->fetchAll();

$years = [];
$undatedIncome = 0; $undatedHeld = 0; $undatedCount = 0;
foreach ($rows as &$r) {
    $received   = (float)$r['deposit_paid'];
    $heldDep    = (float)($r['agreed_booking_fee'] ?? 0);   // damages deposit (held)
    $fullTotal  = (float)($r['agreed_total'] ?? $received);
    $rentalPrice = max(0.0, $fullTotal - $heldDep);

    // Attribute money received to rental income FIRST; only the excess above the
    // rental price counts as the held damages deposit.
    $incomePart = min($received, $rentalPrice);
    $heldPart   = max(0.0, $received - $rentalPrice);

    $r['received']     = round($received, 2);
    $r['income_part']  = round($incomePart, 2);
    $r['held_part']    = round($heldPart, 2);
    $r['tax_year']     = tax_year_start($r['payment_date']);
    if ($r['tax_year'] === null) {
        $undatedIncome += $incomePart; $undatedHeld += $heldPart; $undatedCount++;
    } else {
        $years[$r['tax_year']] = true;
    }
}
unset($r);

// Always include the current tax year as an option
$years[tax_year_start(date('Y-m-d'))] = true;
$yearList = array_keys($years);
rsort($yearList);

$requested = isset($_GET['year']) ? (int)$_GET['year'] : null;
if ($requested === null) {
    json_out(['years' => $yearList]); // dropdown options
}

$inYear = array_values(array_filter($rows, fn($r) => $r['tax_year'] === $requested));
usort($inYear, fn($a,$b) => strcmp($a['payment_date'] ?? '', $b['payment_date'] ?? ''));

$incomeTotal = array_sum(array_map(fn($r) => $r['income_part'], $inYear));
$heldTotal   = array_sum(array_map(fn($r) => $r['held_part'], $inYear));
$byProp = [];
foreach ($inYear as $r) {
    $byProp[$r['prop_key']] = ($byProp[$r['prop_key']] ?? 0) + $r['income_part'];
}

json_out([
    'year' => $requested,
    'years' => $yearList,
    'total' => round($incomeTotal, 2),          // rental income only
    'held_deposits' => round($heldTotal, 2),    // refundable, held — NOT income
    'count' => count($inYear),
    'by_property' => $byProp,
    'payments' => $inYear,
    'undated' => ['count' => $undatedCount, 'total' => round($undatedIncome, 2), 'held' => round($undatedHeld, 2)],
]);
