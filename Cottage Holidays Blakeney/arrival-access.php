<?php
// ============================================================
//  arrival-access.php — return a cottage's location so a guest can get
//  DIRECTIONS to where they're staying. POST {prop_key}  (guest logged in).
//
//  NOTE: the on-arrival key-code reveal has been removed. This endpoint no
//  longer hands over any door code or private arrival text — it only returns
//  the cottage's public coordinates (geo-<propKey>) for a guest who has a
//  booking there, so the app can open a maps directions link. Directions to a
//  cottage you've booked are not sensitive, so no proximity / payment gate.
// ============================================================
require_once __DIR__ . '/db.php';
require_guest();

$in = body();
$propKey = clean($in['prop_key'] ?? '');
if ($propKey === '') {
    json_out(['error' => 'Missing property'], 400);
}

// Which guest is this?
$g = db()->prepare('SELECT email FROM guests WHERE id = ?');
$g->execute([$_SESSION['guest_id']]);
$guest = $g->fetch();
if (!$guest) {
    json_out(['error' => 'Guest not found'], 404);
}

// Must have a booking at this cottage (any — past, current or upcoming).
$own = db()->prepare(
    'SELECT 1 FROM bookings WHERE prop_key = ? AND email IS NOT NULL AND LOWER(email) = LOWER(?) LIMIT 1',
);
$own->execute([$propKey, $guest['email']]);
if (!$own->fetchColumn()) {
    json_out(['error' => 'No booking found for this cottage.'], 403);
}

// Cottage coordinates (geo-<propKey>, stored as plain JSON {lat,lng}).
$cs = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
$cs->execute(['geo-' . $propKey]);
$crow = $cs->fetch();
$geo = $crow ? json_decode($crow['item_value'], true) : null;
if (!is_array($geo) || !isset($geo['lat'], $geo['lng'])) {
    // No coordinates saved — the app falls back to a name search.
    json_out(['ok' => true, 'lat' => null, 'lng' => null]);
}

json_out(['ok' => true, 'lat' => (float) $geo['lat'], 'lng' => (float) $geo['lng']]);
