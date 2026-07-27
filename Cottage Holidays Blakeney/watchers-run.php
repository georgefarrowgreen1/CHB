<?php
// ============================================================
//  watchers-run.php — fires the owner's standing queries. Daily, from cron.php.
//
//    https://YOURDOMAIN/watchers-run.php?cron=APP_SECRET
//
//  A watcher only ever speaks if it is BOTH due and STILL TRUE. "Tell me if the
//  Jollyboat gap hasn't sold by Friday" must say nothing at all when the gap sold
//  on Wednesday — an alert about a problem that solved itself is exactly the noise
//  that teaches an owner to ignore notifications.
//
//  Delivery reuses alert_owner() (webpush.php); the rules come from
//  watchers-lib.php, which is pure and unit-tested. Nothing new is invented here.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/watchers-lib.php';
require_once __DIR__ . '/webpush.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron) {
    // Same guard as enquiry-nudge.php / self-repair.php: a manual run must be a
    // POST so require_admin() enforces CSRF, and a cross-site GET in the owner's
    // browser can never fire it through their session.
    require_admin();
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        json_out(['error' => 'Run this from the back office, or use the cron URL with your secret.'], 405);
    }
}

$today = date('Y-m-d');
$list = watchers_all();

// ---- 1. Clear the ones whose window has passed. Silently: "that gap you asked
// about is now in the past" is not news.
$expired = watchers_expired($list, $today);
if ($expired) {
    $goneIds = array_map(function ($w) { return (string) ($w['id'] ?? ''); }, $expired);
    foreach ($goneIds as $id) {
        $list = watchers_remove($list, $id);
    }
}

// ---- 2. Is a gap-unsold watcher STILL true? End-exclusive overlap, the same rule
// the calendar and the clash checks use, so a checkout on the arrival day is not a
// conflict. Owner blocks count as "not sold" — they are deliberately held, so a
// watcher on a blocked window is still unsold and still worth mentioning.
$stillEmpty = function ($pk, $from, $to) {
    if ($pk === '' || $from === '' || $to === '') {
        return false;
    }
    try {
        $q = db()->prepare(
            'SELECT COUNT(*) FROM bookings
              WHERE prop_key = ? AND check_in < ? AND check_out > ?'
        );
        $q->execute([$pk, $to, $from]);
        return ((int) $q->fetchColumn()) === 0;
    } catch (Throwable $e) {
        // Unknown beats wrong: on a DB error say nothing rather than claim a gap
        // is still empty and send the owner chasing something already booked.
        return false;
    }
};

$sent = 0;
$skipped = 0;
foreach (watchers_due($list, $today) as $w) {
    $id = (string) ($w['id'] ?? '');
    $fire = false;
    if (($w['kind'] ?? '') === 'gap-unsold') {
        $fire = $stillEmpty((string) ($w['pk'] ?? ''), (string) ($w['from'] ?? ''), (string) ($w['to'] ?? ''));
    }
    if (!$fire) {
        // Resolved itself, or we could not confirm. Either way the watcher is done
        // — it asked a question that no longer has an interesting answer.
        $skipped++;
        $list = watchers_remove($list, $id);
        continue;
    }
    $name = prop_display($w['pk'] ?? '') ?: ($w['pk'] ?? 'a cottage');
    $say = trim((string) ($w['say'] ?? ''));
    if ($say === '') {
        $say = $name . ' ' . uk_date((string) ($w['from'] ?? '')) . '–' . uk_date((string) ($w['to'] ?? '')) . ' is still free.';
    }
    alert_owner('Still unsold', $say);
    $sent++;
    // Mark spoken rather than deleting, so the record of what was asked survives
    // until its window passes and step 1 clears it.
    foreach ($list as $i => $x) {
        if ((string) ($x['id'] ?? '') === $id) {
            $list[$i]['done'] = $today;
        }
    }
}

watchers_save($list);
json_out(['ok' => true, 'alerts' => $sent, 'resolved' => $skipped, 'expired' => count($expired), 'watching' => count($list)]);
