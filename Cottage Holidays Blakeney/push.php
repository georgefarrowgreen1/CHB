<?php
// ============================================================
//  push.php — Web Push subscriptions + the time-based check-in push.
//
//  Public:
//    GET  ?action=key                 -> { key: VAPID_PUBLIC_KEY }  (client needs it to subscribe)
//  Guest (logged in):
//    POST {action:'subscribe', subscription:{...}}     -> store this device
//    POST {action:'unsubscribe', endpoint:'...'}       -> remove this device
//  Cron / admin:
//    ?action=send_checkin&cron=APP_SECRET  -> push "cottage ready" to guests whose
//                                              check-in time has just passed (once).
//
//  Set up a cron job (every ~15 min) at:
//    https://YOURDOMAIN/push.php?action=send_checkin&cron=APP_SECRET
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/webpush.php';

$in = body();
$action = $_GET['action'] ?? ($in['action'] ?? '');

// ---- Public: hand the client the VAPID public key (empty if not configured) ----
if ($action === 'key') {
    json_out(['key' => defined('VAPID_PUBLIC_KEY') ? VAPID_PUBLIC_KEY : '']);
}

// ---- Cron/admin: send the one-time check-in push ----
if ($action === 'send_checkin') {
    $isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string)$_GET['cron']);
    if (!$isCron && empty($_SESSION['admin_id'])) json_out(['error' => 'Not authorised'], 401);

    try {
        $s = db()->query("SELECT id, email FROM bookings
            WHERE check_in = CURDATE()
              AND NOW() >= CAST(CONCAT(check_in, ' ', check_in_time) AS DATETIME)
              AND checkin_push_sent IS NULL");
        $due = $s->fetchAll();
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not read bookings — has migration-push.sql been run? (try migrate.php)'], 500);
    }

    $pushed = 0;
    foreach ($due as $bk) {
        $subs = db()->prepare('SELECT ps.id, ps.endpoint FROM push_subscriptions ps
            JOIN guests g ON g.id = ps.guest_id WHERE LOWER(g.email) = LOWER(?)');
        $subs->execute([$bk['email']]);
        $delivered = false;
        foreach ($subs->fetchAll() as $sub) {
            $r = send_webpush($sub['endpoint']);
            if ($r['ok']) $delivered = true;
            elseif (in_array($r['status'], [404, 410], true)) {
                db()->prepare('DELETE FROM push_subscriptions WHERE id = ?')->execute([(int)$sub['id']]);
            }
        }
        // Mark sent so we never spam — even if the guest had no device subscribed.
        db()->prepare('UPDATE bookings SET checkin_push_sent = NOW() WHERE id = ?')->execute([(int)$bk['id']]);
        if ($delivered) $pushed++;
    }
    json_out(['ok' => true, 'due' => count($due), 'pushed' => $pushed]);
}

// ---- Guest-only: manage this device's subscription ----
require_guest();
$guestId = (int)$_SESSION['guest_id'];

if ($action === 'subscribe') {
    $sub = $in['subscription'] ?? null;
    if (!is_array($sub) || empty($sub['endpoint'])) json_out(['error' => 'Invalid subscription'], 400);
    $endpoint = (string)$sub['endpoint'];
    $p256dh = (string)($sub['keys']['p256dh'] ?? '');
    $auth   = (string)($sub['keys']['auth'] ?? '');
    try {
        // One row per endpoint; re-subscribing just refreshes ownership.
        db()->prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')->execute([$endpoint]);
        db()->prepare('INSERT INTO push_subscriptions (guest_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,NOW())')
            ->execute([$guestId, $endpoint, $p256dh, $auth]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not save subscription — has migration-push.sql been run? (try migrate.php)'], 500);
    }
    json_out(['ok' => true]);
}

if ($action === 'unsubscribe') {
    $endpoint = (string)($in['endpoint'] ?? '');
    if ($endpoint !== '') {
        try { db()->prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND guest_id = ?')->execute([$endpoint, $guestId]); }
        catch (\Throwable $e) {}
    }
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
