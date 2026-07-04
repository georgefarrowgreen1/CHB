<?php
// ============================================================
//  welcome.php — the in-stay "welcome book" for a cottage (Wi-Fi, appliances,
//  bins, heating, local tips, checkout…). Owner-editable per cottage and stored
//  privately (content key welcome-<prop>, encrypted, never in the public feed).
//
//  POST {action:'get', prop}  -> guest: the cottage's welcome book, but only for
//                                a guest who has a booking for that cottage.
//
//  The owner edits it from Settings → Preferences → Welcome book (saved via
//  content.php with the private welcome-<prop> key).
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php'; // booking_amount_due() for the payment gate

$in = body();
$action = $in['action'] ?? '';

if ($action !== 'get') {
    json_out(['error' => 'Unknown action'], 400);
}

require_guest();
$guestId = (int) $_SESSION['guest_id'];

$prop = clean($in['prop'] ?? '');
if ($prop === '') {
    json_out(['error' => 'Missing property'], 400);
}

// Only a guest who has booked this cottage may read its welcome book.
$g = db()->prepare('SELECT email FROM guests WHERE id = ?');
$g->execute([$guestId]);
$email = $g->fetchColumn();
if (!$email) {
    json_out(['error' => 'Please log in first'], 401);
}

// Only a guest who has booked this cottage may read its welcome book — AND the
// holiday must be paid in full. (Trip information is gated behind payment just
// like the key code.) Allow it if ANY of their bookings here is settled.
$own = db()->prepare('SELECT * FROM bookings WHERE prop_key = ? AND email IS NOT NULL AND LOWER(email) = LOWER(?)');
$own->execute([$prop, $email]);
$bookings = $own->fetchAll();
if (!$bookings) {
    json_out(['error' => 'No booking found for this cottage.'], 403);
}
$paid = false;
foreach ($bookings as $b) {
    $d = booking_amount_due($b, 'balance');
    if ((float) ($d['due'] ?? 0) <= 0.005) {
        $paid = true;
        break;
    }
}
if (!$paid) {
    json_out(['error' => 'Your welcome book unlocks once your holiday balance is paid.', 'reason' => 'unpaid'], 402);
}

// Read + decrypt the stored welcome book (a JSON array of {title, body}).
$sections = [];
try {
    $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
    $s->execute(['welcome-' . $prop]);
    $raw = $s->fetchColumn();
    if ($raw !== false) {
        $json = is_private_content_key('welcome-' . $prop) ? decrypt_value($raw) : $raw;
        $d = json_decode($json, true);
        if (is_array($d)) {
            foreach ($d as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $title = trim((string) ($row['title'] ?? ''));
                $bodyT = trim((string) ($row['body'] ?? ''));
                if ($title === '' && $bodyT === '') {
                    continue;
                }
                $sections[] = ['title' => $title, 'body' => $bodyT];
            }
        }
    }
} catch (\Throwable $e) {
    $sections = [];
}

json_out(['ok' => true, 'sections' => $sections]);
