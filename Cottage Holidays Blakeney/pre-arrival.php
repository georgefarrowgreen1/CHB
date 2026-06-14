<?php
// ============================================================
//  pre-arrival.php — automatic "arrival info" emails.
//  Sends each guest their arrival details a few days before
//  check-in (default 3 days; set PRE_ARRIVAL_DAYS in config.php
//  to change). One email per booking, never repeated.
//
//  Set up a DAILY cron job in IONOS pointing at:
//    https://YOURDOMAIN/YOURFOLDER/pre-arrival.php?cron=APP_SECRET
//  (replace APP_SECRET with the value from config.php)
//
//  A logged-in admin can also trigger a run by visiting the same
//  URL without the cron parameter.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';

// Auth: cron secret OR logged-in admin
$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string)$_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) {
    json_out(['error' => 'Not authorised'], 401);
}

$days = defined('PRE_ARRIVAL_DAYS') ? max(1, (int)PRE_ARRIVAL_DAYS) : 3;

try {
    $s = db()->prepare(
        'SELECT * FROM bookings
         WHERE check_in = DATE_ADD(CURDATE(), INTERVAL ? DAY)
           AND email <> \'\' AND pre_arrival_sent IS NULL'
    );
    $s->execute([$days]);
    $due = $s->fetchAll();
} catch (\Throwable $e) {
    json_out(['error' => 'Could not check bookings — has migration-pre-arrival.sql been run?'], 500);
}

$results = [];
foreach ($due as $b) {
    $res = send_arrival_for_booking($b);
    $results[] = [
        'booking' => (int)$b['id'], 'guest' => $b['name'],
        'ok' => !empty($res['ok']), 'error' => $res['error'] ?? null,
    ];
}

json_out(['ok' => true, 'days_before' => $days, 'sent' => count(array_filter($results, fn($r) => $r['ok'])), 'details' => $results]);
