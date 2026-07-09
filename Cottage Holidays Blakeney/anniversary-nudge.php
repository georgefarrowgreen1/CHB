<?php
// ============================================================
//  anniversary-nudge.php — invite last year's guests back, once.
//  Runs daily via cron.php. Sends ONE warm re-invite per past booking, timed
//  SMARTLY to each guest's own booking-window: it lands the invite ~2 weeks
//  before the point (relative to next year's same dates) at which that guest
//  historically started looking — i.e. their check-in-minus-lead-time. A guest
//  who books 3 months ahead is invited ~3 months before the dates; a last-minute
//  booker is invited much closer in, so the nudge arrives when they'd actually
//  act rather than a blanket 11 months out. Skips guests who already have a
//  future booking. Sent-tracking lives in the content table ('anniv-sent':
//  {booking_id: date}) so nobody is emailed twice, even across re-runs.
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

// Widen the candidate window to the whole run-up to each stay's anniversary
// (30–360 days ago); the exact send day is computed per booking from its lead
// time below. `booked` = when the booking was made (agreed_on, else the row's
// created date) — the basis for that guest's lead time.
$rows = [];
try {
    $q = db()->query("SELECT id, prop_key, name, email, check_in, check_out,
                             COALESCE(agreed_on, DATE(created_at)) AS booked
                      FROM bookings
                      WHERE email IS NOT NULL AND email <> ''
                        AND check_in BETWEEN DATE_SUB(CURDATE(), INTERVAL 360 DAY)
                                         AND DATE_SUB(CURDATE(), INTERVAL 30 DAY)");
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
$today = strtotime(date('Y-m-d'));
$emailedThisRun = []; // don't double-invite a guest who has two past stays in-window
foreach ($rows as $b) {
    if (isset($sent[$b['id']])) {
        continue;
    } // already invited
    // Smart timing: land the invite ~2 weeks before this guest would start
    // looking for next year's same dates — i.e. anniversary minus their lead time.
    $checkIn = strtotime($b['check_in']);
    $booked = strtotime($b['booked'] ?: $b['check_in']);
    $lead = max(7, min(300, (int) round(($checkIn - $booked) / 86400)));
    $target = strtotime('+1 year', $checkIn) - ($lead + 14) * 86400;
    // A ~2-week send window so a missed cron day never skips anyone.
    if ($today < $target || $today > $target + 13 * 86400) {
        continue; // not this guest's moment yet (or already past it)
    }
    $emailKey = strtolower($b['email']);
    if (isset($emailedThisRun[$emailKey])) {
        continue;
    }
    // Honour the one-click unsubscribe (email-optout.php suppression list).
    if (function_exists('email_optout_has') && email_optout_has($b['email'])) {
        $sent[$b['id']] = date('Y-m-d') . ' (skipped: opted out)';
        $persist();
        continue;
    }
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
        $emailedThisRun[$emailKey] = 1;
        $n++;
        // Visible in the per-booking email log (entity booking + category comms).
        log_activity('comms', 'email.anniversary', 'Return-invite emailed — ' . ($b['name'] ?: $b['email']), [
            'actor' => 'cron',
            'prop_key' => $b['prop_key'] ?? '',
            'entity' => 'booking',
            'entity_id' => (string) $b['id'],
        ]);
    }
    $results[] = ['id' => (int) $b['id'], 'ok' => !empty($r['ok']), 'error' => $r['error'] ?? null];
}

json_out(['ok' => true, 'sent' => $n, 'checked' => count($rows), 'results' => $results]);
