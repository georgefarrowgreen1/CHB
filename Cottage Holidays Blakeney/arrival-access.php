<?php
// ============================================================
//  arrival-access.php — reveal a guest's key code / arrival info
//  ONLY when they are physically at the cottage during their stay.
//  POST {prop_key, lat, lng}  (guest must be logged in).
//
//  The arrival info (which may contain the key-safe code) is returned
//  ONLY when ALL of these hold:
//    1. the guest has a booking at that property whose dates include today,
//    2. the property has saved coordinates (geo-<propKey>), and
//    3. the guest is within 25 metres of those coordinates.
//  Otherwise the code is never sent to the browser.
// ============================================================
require_once __DIR__ . '/db.php';
require_guest();

$in = body();
$propKey = clean($in['prop_key'] ?? '');
$lat = isset($in['lat']) && is_numeric($in['lat']) ? (float)$in['lat'] : null;
$lng = isset($in['lng']) && is_numeric($in['lng']) ? (float)$in['lng'] : null;
if ($propKey === '' || $lat === null || $lng === null) {
    json_out(['error' => 'Missing location data'], 400);
}

// Which guest is this?
$g = db()->prepare('SELECT email FROM guests WHERE id = ?');
$g->execute([$_SESSION['guest_id']]);
$guest = $g->fetch();
if (!$guest) json_out(['error' => 'Guest not found'], 404);

// 1) Must have a CURRENT booking here (today falls within the stay). We also work
//    out two time gates, in the database's own clock so they match CURDATE():
//      • map_allowed  — from 15 minutes before the arrival (check-in date + time)
//      • info_allowed — from the arrival time onwards
$b = db()->prepare('SELECT check_in_time,
        (NOW() >= (CAST(CONCAT(check_in, " ", check_in_time) AS DATETIME) - INTERVAL 15 MINUTE)) AS map_allowed,
        (NOW() >=  CAST(CONCAT(check_in, " ", check_in_time) AS DATETIME))                        AS info_allowed
    FROM bookings
    WHERE prop_key = ? AND LOWER(email) = LOWER(?)
      AND CURDATE() >= check_in
      AND NOW() < CAST(CONCAT(check_out, " ", check_out_time) AS DATETIME)
    ORDER BY check_in ASC LIMIT 1');
$b->execute([$propKey, $guest['email']]);
$bk = $b->fetch();
if (!$bk) {
    json_out(['ok' => true, 'unlocked' => false, 'reason' => 'no_active_stay']);
}
$mapAllowed  = (int)$bk['map_allowed'] === 1;
$infoAllowed = (int)$bk['info_allowed'] === 1;
$arrivalHm   = substr((string)$bk['check_in_time'], 0, 5);

// 2) Property coordinates (geo-<propKey>, stored as plain JSON {lat,lng}).
$cs = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
$cs->execute(['geo-' . $propKey]);
$crow = $cs->fetch();
$geo = $crow ? json_decode($crow['item_value'], true) : null;
if (!is_array($geo) || !isset($geo['lat'], $geo['lng'])) {
    json_out(['ok' => true, 'unlocked' => false, 'reason' => 'no_location']);
}

// 3) Distance in metres (haversine).
$R = 6371000.0;
$dLat = deg2rad((float)$geo['lat'] - $lat);
$dLng = deg2rad((float)$geo['lng'] - $lng);
$a = sin($dLat / 2) ** 2 + cos(deg2rad($lat)) * cos(deg2rad((float)$geo['lat'])) * sin($dLng / 2) ** 2;
$dist = $R * 2 * atan2(sqrt($a), sqrt(1 - $a));

// Within 25m — the key-code zone. But the arrival info (key code) is only handed
// over once the guest's arrival time has actually been reached.
if ($dist <= 25.0) {
    if (!$infoAllowed) {
        json_out(['ok' => true, 'unlocked' => false, 'reason' => 'before_arrival', 'arrival_time' => $arrivalHm]);
    }
    $as = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
    $as->execute(['arrival-' . $propKey]);
    $arow = $as->fetch();
    $info = '';
    if ($arow) {
        $decoded = json_decode(decrypt_value($arow['item_value']), true);
        $info = is_string($decoded) ? $decoded : '';
    }
    json_out(['ok' => true, 'unlocked' => true, 'distance_m' => (int)round($dist), 'info' => $info]);
}

// More than 25m away — the map only becomes available from 15 minutes before the
// arrival time. Before that, reveal nothing (not even the coordinates).
if (!$mapAllowed) {
    json_out(['ok' => true, 'unlocked' => false, 'reason' => 'too_early', 'arrival_time' => $arrivalHm]);
}

// 25m–1km within the map window: reveal the coordinates so the account can show a
// live map guiding them in. Beyond 1km, reveal only the distance.
if ($dist <= 1000.0) {
    json_out([
        'ok' => true, 'unlocked' => false, 'reason' => 'nearby',
        'distance_m' => (int)round($dist),
        'prop_lat' => (float)$geo['lat'], 'prop_lng' => (float)$geo['lng'],
    ]);
}
json_out(['ok' => true, 'unlocked' => false, 'reason' => 'too_far', 'distance_m' => (int)round($dist)]);
