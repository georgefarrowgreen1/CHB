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
require_once __DIR__ . '/webpush.php';

// Auth: cron secret OR logged-in admin
$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) {
    json_out(['error' => 'Not authorised'], 401);
}

$days = defined('PRE_ARRIVAL_DAYS') ? max(1, (int) PRE_ARRIVAL_DAYS) : 3;

try {
    // A RANGE (not exact day) so a skipped cron day catches up: any upcoming
    // booking within the next $days that hasn't been emailed yet. The
    // pre_arrival_sent guard prevents repeats.
    $s = db()->prepare(
        'SELECT * FROM bookings
         WHERE check_in BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
           AND email <> \'\' AND pre_arrival_sent IS NULL',
    );
    $s->execute([$days]);
    $due = $s->fetchAll();
} catch (\Throwable $e) {
    json_out(['error' => 'Could not check bookings — has migration-pre-arrival.sql been run?'], 500);
}

$results = [];
foreach ($due as $b) {
    $res = send_arrival_for_booking($b);
    // Optional SMS nudge to check the arrival email (never puts key codes in a
    // text). Only when the email actually SENT — otherwise the booking re-enters
    // the due window and the guest would get a daily text pointing at an email
    // that never arrived. No-op unless SMS is configured and the guest opted in.
    if (!empty($res['ok'])) {
        try {
            require_once __DIR__ . '/sms.php';
            sms_notify_booking(
                $b,
                'Cottage Holidays Blakeney: your stay starts ' .
                    $b['check_in'] .
                    '. We\'ve emailed your arrival info, directions and key details — see you soon!',
            );
        } catch (\Throwable $e) {
        }
    }
    $results[] = [
        'booking' => (int) $b['id'],
        'guest' => $b['name'],
        'ok' => !empty($res['ok']),
        'error' => $res['error'] ?? null,
    ];
}

// ---- Post-checkout review requests --------------------------------------
// A few days after checkout, ask the guest for a review (once per booking).
$reviewDays = defined('REVIEW_REQUEST_DAYS') ? max(1, (int) REVIEW_REQUEST_DAYS) : 2;
$reviewsSent = 0;
try {
    // Range (not exact day) so a missed cron day still catches up, capped at a
    // week so we never ask about an old stay. review_request_sent prevents repeats.
    $rs = db()->prepare(
        "SELECT b.*, p.name AS property_name FROM bookings b JOIN properties p ON p.prop_key = b.prop_key
         WHERE b.check_out <= DATE_SUB(CURDATE(), INTERVAL ? DAY)
           AND b.check_out >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
           AND b.email <> '' AND b.review_request_sent IS NULL",
    );
    $rs->execute([$reviewDays, $reviewDays + 7]);
    $toAsk = $rs->fetchAll();
} catch (\Throwable $e) {
    $toAsk = [];
} // column not migrated yet

if ($toAsk) {
    $scheme = request_is_https() ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    $base = $scheme . '://' . $host . $dir . '/';
    $googleUrl = trim(content_value('google-review-url')); // owner-set, optional
    foreach ($toAsk as $b) {
        $res = send_review_request_email([
            'name' => $b['name'],
            'email' => $b['email'],
            'prop_key' => $b['prop_key'],
            'prop_name' => $b['property_name'] ?? $b['prop_key'],
            'reviewUrl' => $base . 'index.html?review=' . rawurlencode($b['prop_key']),
            'googleUrl' => $googleUrl,
        ]);
        if (!empty($res['ok'])) {
            try {
                db()
                    ->prepare('UPDATE bookings SET review_request_sent = NOW() WHERE id = ?')
                    ->execute([(int) $b['id']]);
            } catch (\Throwable $e) {
            }
            try {
                notify_guest_email(
                    $b['email'],
                    'How was your stay?',
                    'We\'d love a quick review of your time at ' . ($b['property_name'] ?? 'the cottage') . '.',
                    './index.html?review=' . rawurlencode($b['prop_key']),
                );
            } catch (\Throwable $e) {
            }
            $reviewsSent++;
        }
    }
}

json_out([
    'ok' => true,
    'days_before' => $days,
    'sent' => count(array_filter($results, fn($r) => $r['ok'])),
    'details' => $results,
    'review_requests_sent' => $reviewsSent,
    'review_days_after' => $reviewDays,
]);
