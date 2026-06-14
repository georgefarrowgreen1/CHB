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

// Also return this guest's PENDING enquiries (submitted, not yet confirmed by
// the owner) so the account can show them as cards in the same layout.
$eq = db()->prepare(
    'SELECT e.*, p.name AS property_name, p.address AS property_address
     FROM enquiries e JOIN properties p ON p.prop_key = e.prop_key
     WHERE LOWER(e.email) = LOWER(?)
     ORDER BY e.check_in ASC'
);
$eq->execute([$guest['email']]);

json_out(['bookings' => $bookings, 'enquiries' => $eq->fetchAll()]);
