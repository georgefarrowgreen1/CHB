<?php
// ============================================================
//  autopay-run.php — collects the balances the guest agreed we could take.
//  Daily, from cron.php.
//
//    https://YOURDOMAIN/autopay-run.php?cron=APP_SECRET
//
//  Ordered BEFORE payments-due.php in cron.php on purpose: collect first, chase
//  second. The other way round emails a guest asking for money that is taken ten
//  seconds later — and being asked for money you have already arranged to pay is
//  exactly the experience this feature exists to remove.
//
//  Every decision lives in autopay-lib.php / pricing.php, which are pure enough
//  to drive from a test. Nothing is invented here.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/autopay-lib.php';
require_once __DIR__ . '/webpush.php';
require_once __DIR__ . '/mailer.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron) {
    // Same guard as watchers-run.php / self-repair.php: a manual run must be a
    // POST so require_admin() enforces CSRF, and a cross-site GET in the owner's
    // browser can never fire it through their session.
    require_admin();
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        json_out(['error' => 'Run this from the back office, or use the cron URL with your secret.'], 405);
    }
}

$today = date('Y-m-d');
$res = autopay_run($today);

// THEN warn whoever is next. After the collection, not before, so a booking
// whose money was taken today is never also told it is coming — autopay_run
// settles it, and autopay_notice_due then reads 'settled' rather than 'armed'.
$notice = autopay_notice_run($today);

// TELL THE OWNER, both ways round. A collection is money in and worth knowing
// about; a failure is money NOT in, and the ordinary chase has just become their
// job again. Silence on a quiet day, so the notification keeps meaning something.
if ($res['collected'] > 0) {
    try {
        alert_owner(
            'Balance collected automatically',
            $res['collected'] === 1 ? $res['lines'][0] : $res['collected'] . ' balances collected',
            ['category' => 'money', 'tag' => 'autopay-' . $today],
        );
    } catch (\Throwable $e) {
    }
}
if ($res['failed'] > 0) {
    try {
        alert_owner(
            "Automatic payment didn't go through",
            $res['failed'] === 1 ? $res['lines'][count($res['lines']) - 1] : $res['failed'] . " automatic payments failed — they'll need chasing",
            // 'urgent' so a mute cannot swallow it: a failed collection means a
            // balance nobody is now chasing, and the whole point of arranging it
            // was that the owner stopped watching.
            ['category' => 'urgent', 'email' => true, 'tag' => 'autopay-fail-' . $today],
        );
    } catch (\Throwable $e) {
    }
}
if ($res['truncated']) {
    // The cap is declared rather than swallowed — the rest are collected on the
    // next pass, and `>=` on the due date is what makes that safe.
    try {
        log_activity('payment', 'autopay.capped', 'Automatic collections hit the per-run cap — the rest go on the next pass', ['severity' => 'info']);
    } catch (\Throwable $e) {
    }
}

json_out([
    'ok' => $res['ok'],
    'notices' => $notice['sent'],
    'collected' => $res['collected'],
    'failed' => $res['failed'],
    'skipped' => $res['skipped'],
    'truncated' => $res['truncated'],
]);
