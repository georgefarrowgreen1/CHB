<?php
// ============================================================
//  tide-push.php — tide-timed in-stay push.
//  Once a day, push today's Blakeney tide window to guests who are mid-stay and
//  have a subscribed device. Reuses the tide data (tide-data.php) and the
//  payload-less push + per-guest ping stash (webpush.php / sw_notify).
//
//  Add to the SAME daily cron as the others (best mid-morning):
//    https://YOURDOMAIN/tide-push.php?cron=APP_SECRET
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/webpush.php';
require_once __DIR__ . '/tide-data.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string)$_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) json_out(['error' => 'Not authorised'], 401);

if (!wp_vapid_configured()) json_out(['ok' => true, 'skipped' => 'push not configured']);

$tz = new DateTimeZone('Europe/London');
$todayLocal = (new DateTime('now', $tz))->format('Y-m-d');

$t = tide_extremes(gmdate('Y-m-d'), 2);
if (empty($t['ok']) || empty($t['extremes'])) json_out(['ok' => true, 'skipped' => 'no tide data (key set?)']);

$lows = []; $highs = [];
foreach ($t['extremes'] as $e) {
    if (empty($e['time'])) continue;
    try { $dt = new DateTime($e['time']); } catch (\Throwable $ex) { continue; }
    $dt->setTimezone($tz);
    if ($dt->format('Y-m-d') !== $todayLocal) continue;
    $hm = $dt->format('H:i');
    if (stripos($e['type'], 'low') !== false) $lows[] = $hm;
    elseif (stripos($e['type'], 'high') !== false) $highs[] = $hm;
}
if (!$lows && !$highs) json_out(['ok' => true, 'skipped' => 'no extremes today']);

$parts = [];
if ($lows)  $parts[] = 'Low ' . implode(' & ', $lows);
if ($highs) $parts[] = 'High ' . implode(' & ', $highs);
$title = 'Tide times for your Blakeney day';
$body  = "Today's tides: " . implode(' · ', $parts)
       . '. Around low tide is lovely for the beach & coast path; seal-trip boats sail near high water.';

// Mid-stay bookings we haven't pushed today, whose guest has a subscribed device.
// Arrival day is excluded (check_in < today): that day gets the "cottage ready"
// check-in push, and both share the payload-less sw_notify path — so tide pushes
// begin the morning after arrival. The in-stay card still shows tides on day one.
try {
    $rows = db()->query("SELECT id, email FROM bookings
        WHERE check_in < CURDATE() AND check_out > CURDATE()
          AND email IS NOT NULL AND email <> ''
          AND (tide_push_sent IS NULL OR tide_push_sent < CURDATE())")->fetchAll();
} catch (\Throwable $e) {
    json_out(['error' => 'Could not read bookings — has migrate.php been run?'], 500);
}

$pushed = 0;
foreach ($rows as $bk) {
    $subs = db()->prepare("SELECT ps.id, ps.endpoint, ps.guest_id FROM push_subscriptions ps
        JOIN guests g ON g.id = ps.guest_id WHERE LOWER(g.email) = LOWER(?)");
    $subs->execute([$bk['email']]);
    $list = $subs->fetchAll();

    // Stash the message for each guest id so sw_notify shows tides (not check-in).
    $guestIds = [];
    foreach ($list as $sub) { $guestIds[(int)$sub['guest_id']] = true; }
    foreach (array_keys($guestIds) as $gid) guest_ping_set($gid, $title, $body, './');

    $delivered = false;
    foreach ($list as $sub) {
        $r = send_webpush($sub['endpoint']);
        if (!empty($r['ok'])) $delivered = true;
        elseif (in_array($r['status'] ?? 0, [404, 410], true)) {
            try { db()->prepare('DELETE FROM push_subscriptions WHERE id = ?')->execute([(int)$sub['id']]); } catch (\Throwable $e) {}
        }
    }
    // Mark sent regardless, so we never re-run all day (even with no device).
    try { db()->prepare('UPDATE bookings SET tide_push_sent = CURDATE() WHERE id = ?')->execute([(int)$bk['id']]); } catch (\Throwable $e) {}
    if ($delivered) $pushed++;
}

json_out(['ok' => true, 'stays' => count($rows), 'pushed' => $pushed, 'tides' => $parts]);
