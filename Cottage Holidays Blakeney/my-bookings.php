<?php
// ============================================================
//  api/my-bookings.php — the logged-in guest's own bookings.
//  GET -> bookings whose email matches the logged-in guest, plus
//         the property address for each (for display + invoice).
// ============================================================
require_once __DIR__ . '/db.php';
require_guest();

$g = db()->prepare('SELECT email FROM guests WHERE id = ?');
$g->execute([$_SESSION['guest_id']]);
$guest = $g->fetch();
if (!$guest) {
    json_out(['bookings' => []]);
}

$stmt = db()->prepare(
    'SELECT b.*, p.name AS property_name, p.address AS property_address
     FROM bookings b JOIN properties p ON p.prop_key = b.prop_key
     WHERE LOWER(b.email) = LOWER(?)
     ORDER BY b.check_in ASC',
);
$stmt->execute([$guest['email']]);
$bookings = $stmt->fetchAll();

// How much of each booking's refundable damages deposit has been refunded to the
// guest (sum of 'damages_return' ledger rows) — so the invoice can show "Refunded"
// with the exact amount, not just the hold_status flag (which can't express a
// partial return). One grouped query for all this guest's bookings.
$returnedByBooking = [];
try {
    $ids = array_map(fn($b) => (int) $b['id'], $bookings);
    if ($ids) {
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $rs = db()->prepare(
            "SELECT booking_id, COALESCE(SUM(amount),0) t FROM payments
             WHERE kind = 'damages_return' AND booking_id IN ($ph) GROUP BY booking_id",
        );
        $rs->execute($ids);
        foreach ($rs->fetchAll() as $row) {
            $returnedByBooking[(int) $row['booking_id']] = round((float) $row['t'], 2);
        }
    }
} catch (\Throwable $e) {
}

// Attach a login-free pay token to each booking so the guest can pay an
// outstanding balance straight from My Bookings (only their own bookings).
$sqOn = square_enabled();
foreach ($bookings as &$bk) {
    $bk['pay_token'] = $sqOn ? pay_token((int) $bk['id']) : null;
    $bk['damages_returned'] = $returnedByBooking[(int) $bk['id']] ?? 0;
}
unset($bk);

// Also return this guest's PENDING enquiries (submitted, not yet confirmed by
// the owner) so the account can show them as cards in the same layout.
$eq = db()->prepare(
    'SELECT e.*, p.name AS property_name, p.address AS property_address
     FROM enquiries e JOIN properties p ON p.prop_key = e.prop_key
     WHERE LOWER(e.email) = LOWER(?)
     ORDER BY e.check_in ASC',
);
$eq->execute([$guest['email']]);

// Loyalty: how many stays this guest has already completed with us (check-out in
// the past). Drives the returning-guest welcome offer in the account. Counted
// from the rows we already have — no extra query.
$today = date('Y-m-d');
$completedStays = 0;
foreach ($bookings as $bk) {
    if (!empty($bk['check_out']) && $bk['check_out'] < $today) {
        $completedStays++;
    }
}

json_out(['bookings' => $bookings, 'enquiries' => $eq->fetchAll(), 'completed_stays' => $completedStays]);
