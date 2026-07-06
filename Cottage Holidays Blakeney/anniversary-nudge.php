<?php
// ============================================================
//  anniversary-nudge.php — invite last year's guests back, once.
//  Runs daily via cron.php. Finds bookings whose check-in was ~11 months
//  ago (a month before their "anniversary", when the same weeks for next
//  year start to book) and sends ONE warm re-invite per booking, skipping
//  guests who already have a future booking. Sent-tracking lives in the
//  content table ('anniv-sent': {booking_id: date}) so nobody is emailed
//  twice, even across re-runs.
//
//  Owner opt-out: content key 'anniversary-nudge-off' = '1'.
//  Run: https://YOURDOMAIN/anniversary-nudge.php?cron=APP_SECRET
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) {
    json_out(['error' => 'Not authorised'], 401);
}

if (content_value('anniversary-nudge-off') === '1') {
    json_out(['ok' => true, 'sent' => 0, 'off' => true]);
}
if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) {
    json_out(['ok' => true, 'sent' => 0, 'mail_off' => true]);
}

// One re-invite per booking, ever.
$sent = content_json('anniv-sent', []); // array-valued key — read with content_json()

// Stays whose check-in was 328–340 days ago — a ~2-week window so a missed
// cron day never silently skips anyone.
$rows = [];
try {
    $q = db()->query("SELECT id, prop_key, name, email, check_in, check_out
                      FROM bookings
                      WHERE email IS NOT NULL AND email <> ''
                        AND check_in BETWEEN DATE_SUB(CURDATE(), INTERVAL 340 DAY)
                                         AND DATE_SUB(CURDATE(), INTERVAL 328 DAY)");
    $rows = $q->fetchAll();
} catch (\Throwable $e) {
    json_out(['ok' => false, 'error' => 'Could not read bookings']);
}

$futureQ = db()->prepare('SELECT COUNT(*) FROM bookings WHERE email = ? AND check_in >= CURDATE()');

// Persist the sent map (pruned to the newest ~600 so it never balloons). Called
// after EACH send — not once at the end — so a fatal part-way through the loop
// can't lose the record of who was already emailed and re-invite them tomorrow.
$persist = function () use (&$sent) {
    if (count($sent) > 600) {
        $sent = array_slice($sent, -600, null, true);
    }
    try {
        db()
            ->prepare(
                'INSERT INTO content (item_key, item_value, updated_at) VALUES (?,?,NOW())
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = NOW()',
            )
            ->execute(['anniv-sent', json_encode($sent)]);
    } catch (\Throwable $e) {
    }
};

$results = [];
$n = 0;
foreach ($rows as $b) {
    if (isset($sent[$b['id']])) {
        continue;
    } // already invited
    $futureQ->execute([$b['email']]);
    if ((int) $futureQ->fetchColumn() > 0) {
        // they're already coming back
        $sent[$b['id']] = date('Y-m-d') . ' (skipped: rebooked)';
        $persist();
        continue;
    }
    $d = prop_display($b['prop_key']);
    $b['prop_name'] = $d['name'] ?: $b['prop_key'];
    $r = send_anniversary_email($b);
    if (!empty($r['ok'])) {
        // Only mark as invited on a REAL send. A soft mail failure must not burn
        // the re-invite — leave it unrecorded so tomorrow's run retries it
        // (mirrors enquiry-nudge.php). Recording on success BEFORE moving on still
        // stops a later fatal from re-sending this one.
        $sent[$b['id']] = date('Y-m-d');
        $persist();
        $n++;
    }
    $results[] = ['id' => (int) $b['id'], 'ok' => !empty($r['ok']), 'error' => $r['error'] ?? null];
}

json_out(['ok' => true, 'sent' => $n, 'checked' => count($rows), 'results' => $results]);
