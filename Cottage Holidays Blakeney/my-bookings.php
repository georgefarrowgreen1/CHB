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
if (!$guest) json_out(['bookings' => []]);

$stmt = db()->prepare(
    'SELECT b.*, p.name AS property_name, p.address AS property_address
     FROM bookings b JOIN properties p ON p.prop_key = b.prop_key
     WHERE LOWER(b.email) = LOWER(?)
     ORDER BY b.check_in ASC'
);
$stmt->execute([$guest['email']]);
$bookings = $stmt->fetchAll();

// Attach a login-free pay token to each booking so the guest can pay an
// outstanding balance straight from My Bookings (only their own bookings).
$sqOn = square_enabled();
foreach ($bookings as &$bk) {
    $bk['pay_token'] = $sqOn ? pay_token((int)$bk['id']) : null;
}
unset($bk);

// Also return this guest's PENDING enquiries (submitted, not yet confirmed by
// the owner) so the account can show them as cards in the same layout.
$eq = db()->prepare(
    'SELECT e.*, p.name AS property_name, p.address AS property_address
     FROM enquiries e JOIN properties p ON p.prop_key = e.prop_key
     WHERE LOWER(e.email) = LOWER(?)
     ORDER BY e.check_in ASC'
);
$eq->execute([$guest['email']]);

// Loyalty: how many stays this guest has already completed with us (check-out in
// the past). Drives the returning-guest welcome offer in the account. Counted
// from the rows we already have — no extra query.
$today = date('Y-m-d');
$completedStays = 0;
foreach ($bookings as $bk) {
    if (!empty($bk['check_out']) && $bk['check_out'] < $today) $completedStays++;
}

json_out(['bookings' => $bookings, 'enquiries' => $eq->fetchAll(), 'completed_stays' => $completedStays]);
