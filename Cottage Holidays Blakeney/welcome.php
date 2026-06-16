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

$in = body();
$action = $in['action'] ?? '';

if ($action !== 'get') json_out(['error' => 'Unknown action'], 400);

require_guest();
$guestId = (int)$_SESSION['guest_id'];

$prop = clean($in['prop'] ?? '');
if ($prop === '') json_out(['error' => 'Missing property'], 400);

// Only a guest who has booked this cottage may read its welcome book.
$g = db()->prepare('SELECT email FROM guests WHERE id = ?');
$g->execute([$guestId]);
$email = $g->fetchColumn();
if (!$email) json_out(['error' => 'Please log in first'], 401);

$own = db()->prepare("SELECT COUNT(*) FROM bookings WHERE prop_key = ? AND email IS NOT NULL AND LOWER(email) = LOWER(?)");
$own->execute([$prop, $email]);
if ((int)$own->fetchColumn() < 1) json_out(['error' => 'No booking found for this cottage.'], 403);

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
                if (!is_array($row)) continue;
                $title = trim((string)($row['title'] ?? ''));
                $bodyT = trim((string)($row['body'] ?? ''));
                if ($title === '' && $bodyT === '') continue;
                $sections[] = ['title' => $title, 'body' => $bodyT];
            }
        }
    }
} catch (\Throwable $e) { $sections = []; }

json_out(['ok' => true, 'sections' => $sections]);
