<?php
// ============================================================
//  direct-followup.php — book-direct re-invite for EXTERNAL reviewers.
//  Runs daily via cron.php. Emails each direct_leads guest ONCE, when their
//  follow_up_at date arrives (~11 months after they left a review via a
//  /review/<slug> link), inviting them to book DIRECT next time and skip the
//  OTA fees. Skips:
//    - guests the owner privately rated poorly (admin_rating 1–2),
//    - anyone who has opted out (email-optout suppression list),
//    - anyone who already has a future booking under their email (coming back).
//  follow_up_sent_at is stamped as soon as each lead is handled, so nobody is
//  ever emailed twice — even if the run dies part-way or the cron re-fires.
//
//  Owner opt-out: content key 'direct-followup-off' = '1'.
//  Run: https://YOURDOMAIN/direct-followup.php?cron=APP_SECRET
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) {
    json_out(['error' => 'Not authorised'], 401);
}

if (content_value('direct-followup-off') === '1') {
    json_out(['ok' => true, 'sent' => 0, 'off' => true]);
}
if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) {
    json_out(['ok' => true, 'sent' => 0, 'mail_off' => true]);
}

// Leads due a follow-up: reached their date, not yet sent, and NOT flagged as a
// difficult guest (a 1–2 private rating drops them; unrated or 3+ is fine).
$rows = [];
try {
    $rows = db()
        ->query(
            "SELECT id, prop_key, name, email
             FROM direct_leads
             WHERE email <> '' AND follow_up_at IS NOT NULL
               AND follow_up_at <= CURDATE() AND follow_up_sent_at IS NULL
               AND (admin_rating IS NULL OR admin_rating >= 3)
             ORDER BY follow_up_at ASC
             LIMIT 60",
        )
        ->fetchAll();
} catch (\Throwable $e) {
    // Table missing (pre-migration) — nothing to do.
    json_out(['ok' => true, 'sent' => 0]);
}

$stamp = db()->prepare('UPDATE direct_leads SET follow_up_sent_at = NOW() WHERE id = ?');
$futureQ = db()->prepare('SELECT COUNT(*) FROM bookings WHERE LOWER(email) = LOWER(?) AND check_in >= CURDATE()');

$sent = 0;
$emailedThisRun = []; // don't email the same address twice in one run
$results = [];
foreach ($rows as $l) {
    $emailKey = strtolower(trim($l['email']));
    // Close out (mark handled) without emailing when we shouldn't send:
    // opted out, already emailed this run, or already returning.
    if (isset($emailedThisRun[$emailKey])) {
        $stamp->execute([$l['id']]);
        continue;
    }
    if (function_exists('email_optout_has') && email_optout_has($l['email'])) {
        $stamp->execute([$l['id']]);
        continue;
    }
    try {
        $futureQ->execute([$l['email']]);
        if ((int) $futureQ->fetchColumn() > 0) {
            $stamp->execute([$l['id']]); // already coming back — don't nudge
            continue;
        }
    } catch (\Throwable $e) {
    }

    $r = send_direct_followup_email(['name' => $l['name'], 'email' => $l['email'], 'prop_key' => $l['prop_key']]);
    // Stamp regardless of a soft send failure so a permanently-bad address can't
    // wedge the queue; a true retry would need re-queuing, which we don't do here.
    $stamp->execute([$l['id']]);
    $emailedThisRun[$emailKey] = true;
    if (is_array($r) && !empty($r['ok'])) {
        $sent++;
    }
    $results[] = ['id' => $l['id'], 'ok' => is_array($r) ? !empty($r['ok']) : false];
}

if ($sent) {
    log_activity('email', 'direct.followup', 'Book-direct follow-ups sent: ' . $sent, ['actor' => $isCron ? 'cron' : 'owner']);
}

json_out(['ok' => true, 'sent' => $sent, 'considered' => count($rows)]);
