<?php
// ============================================================
//  push.php — Web Push subscriptions + the session-aware sw_notify tickle.
//
//  Public:
//    GET  ?action=key                 -> { key: VAPID_PUBLIC_KEY }  (client needs it to subscribe)
//  Guest (logged in):
//    POST {action:'subscribe', subscription:{...}}     -> store this device
//    POST {action:'unsubscribe', endpoint:'...'}       -> remove this device
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/webpush.php';

$in = body();
$action = $_GET['action'] ?? ($in['action'] ?? '');

// ---- Public: hand the client the VAPID public key (empty if not configured) ----
if ($action === 'key') {
    json_out(['key' => defined('VAPID_PUBLIC_KEY') ? VAPID_PUBLIC_KEY : '']);
}

// ---- Service worker tickle: what should THIS device show? (session-aware) ----
// Called by sw.js on every push. Admin device -> the latest owner alert (or a
// generic). Guest device -> the check-in message. No session -> safe default.
if ($action === 'sw_notify') {
    if (!empty($_SESSION['admin_id'])) {
        $p = owner_ping_take();
        if ($p) json_out(['title' => $p['title'] ?: 'Cottage Holidays Blakeney', 'body' => $p['body'] ?? '', 'url' => './', 'tag' => 'chb-owner', 'reload' => !empty($p['reload'])]);
        json_out(['title' => 'Cottage Holidays Blakeney', 'body' => 'You have a new notification — tap to open the back office.', 'url' => './', 'tag' => 'chb-owner']);
    }
    // Logged-in guest: a pending contextual ping (e.g. a payment update) wins;
    // otherwise fall back to a generic notification.
    if (!empty($_SESSION['guest_id'])) {
        $gp = guest_ping_take((int)$_SESSION['guest_id']);
        if ($gp) json_out(['title' => $gp['title'] ?: 'Cottage Holidays Blakeney', 'body' => $gp['body'] ?? '', 'url' => $gp['url'] ?? './', 'tag' => 'chb-guest']);
    }
    json_out(['title' => 'Cottage Holidays Blakeney', 'body' => 'You have a new notification — tap to open.', 'url' => './', 'tag' => 'chb-guest']);
}

// ---- Admin: subscribe this device for owner alerts / test / release ping ----
if ($action === 'subscribe_admin' || $action === 'test_admin' || $action === 'unsubscribe_admin') {
    if (empty($_SESSION['admin_id'])) json_out(['error' => 'Not authorised'], 401);
    if ($action === 'subscribe_admin') {
        $sub = $in['subscription'] ?? null;
        if (!is_array($sub) || empty($sub['endpoint'])) json_out(['error' => 'Invalid subscription'], 400);
        $endpoint = (string)$sub['endpoint'];
        try {
            db()->prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')->execute([$endpoint]);
            db()->prepare("INSERT INTO push_subscriptions (guest_id, role, endpoint, p256dh, auth, created_at) VALUES (NULL, 'admin', ?, ?, ?, NOW())")
                ->execute([$endpoint, (string)($sub['keys']['p256dh'] ?? ''), (string)($sub['keys']['auth'] ?? '')]);
        } catch (\Throwable $e) { json_out(['error' => 'Could not save — run migrate.php (migration-push2-admin.sql).'], 500); }
        json_out(['ok' => true]);
    }
    if ($action === 'unsubscribe_admin') {
        $endpoint = (string)($in['endpoint'] ?? '');
        if ($endpoint !== '') { try { db()->prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND role = 'admin'")->execute([$endpoint]); } catch (\Throwable $e) {} }
        json_out(['ok' => true]);
    }
    // test_admin
    if (!wp_vapid_configured()) json_out(['error' => 'VAPID keys not set in config.php yet'], 400);
    $sent = alert_owner('Test alert', 'Owner push is working 🎉');
    json_out(['ok' => true, 'sent' => $sent]);
}

// ---- New-release ping (called by the deploy workflow, or an admin) ----
if ($action === 'notify_release') {
    $isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string)$_GET['cron']);
    if (!$isCron && empty($_SESSION['admin_id'])) json_out(['error' => 'Not authorised'], 401);
    $sent = alert_owner('Cottage Holidays Blakeney', 'A new version of your website is now live.', true);
    json_out(['ok' => true, 'sent' => $sent]);
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

// Verification: send an immediate push to THIS logged-in guest's own device(s).
// Visit while logged in as a guest:  /push.php?action=test
if ($action === 'test') {
    if (!wp_vapid_configured()) json_out(['error' => 'VAPID keys not set in config.php yet'], 400);
    try {
        $q = db()->prepare('SELECT id, endpoint FROM push_subscriptions WHERE guest_id = ?');
        $q->execute([$guestId]);
        $rows = $q->fetchAll();
    } catch (\Throwable $e) {
        json_out(['error' => 'Could not read subscriptions — has migration-push.sql been run?'], 500);
    }
    $sent = 0; $statuses = [];
    foreach ($rows as $sub) {
        $r = send_webpush($sub['endpoint']);
        $statuses[] = $r['status'];
        if ($r['ok']) $sent++;
        elseif (in_array($r['status'], [404, 410], true)) {
            db()->prepare('DELETE FROM push_subscriptions WHERE id = ?')->execute([(int)$sub['id']]);
        }
    }
    json_out(['ok' => true, 'devices' => count($rows), 'sent' => $sent, 'statuses' => $statuses]);
}

json_out(['error' => 'Unknown action'], 400);
