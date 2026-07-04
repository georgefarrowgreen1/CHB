<?php
// ============================================================
//  enquiry-nudge.php — sends ONE gentle follow-up email to guests whose enquiry
//  has been pending for a couple of days (and whose dates are still in the
//  future), then records nudge_sent_at so they're never nudged twice.
//
//  Run daily (alongside the other crons):
//    https://YOURDOMAIN/enquiry-nudge.php?cron=APP_SECRET
//
//  The owner can switch it off in Settings → Enquiries (content key
//  'enquiry-nudge-off' = '1'). Table column added by migration-enquiry-nudge.sql.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) {
    json_out(['error' => 'Not authorised'], 401);
}

// Owner opt-out.
if (content_value('enquiry-nudge-off') === '1') {
    json_out(['ok' => true, 'sent' => 0, 'off' => true]);
}

require_once __DIR__ . '/mailer.php';

try {
    $rows = db()
        ->query(
            "SELECT * FROM enquiries
        WHERE email <> '' AND nudge_sent_at IS NULL
          AND created_at <= (NOW() - INTERVAL 2 DAY)
          AND check_in >= CURDATE()",
        )
        ->fetchAll();
} catch (\Throwable $e) {
    json_out(['error' => 'Could not read enquiries — has migrate.php been run?'], 500);
}

$sent = 0;
foreach ($rows as $e) {
    $rate = get_rate($e['prop_key']);
    $propName = $rate['name'] ?? '' ?: $e['prop_key'];
    $name = $e['name'] ?: 'there';
    // A direct link back to the cottage so they can pick up and book in one tap.
    $base = function_exists('site_base_url') ? site_base_url() : '';
    $slug = prop_display($e['prop_key'])['slug']; // pretty URL for any cottage, owner-added included
    $link = $base ? $base . ($slug ? 'cottages/' . $slug : '') : '';
    $subject = 'Still thinking about your Blakeney stay?';
    $text =
        'Hello ' .
        $name .
        ",\n\n" .
        'Thanks for your enquiry about ' .
        $propName .
        ' for ' .
        $e['check_in'] .
        ' to ' .
        $e['check_out'] .
        ".\n\n" .
        "We're still holding those dates for you. " .
        ($link ? "You can pick up where you left off here:\n" . $link . "\n\n" : '') .
        "Or just reply to this email (or message us on the website) and we'll get your booking confirmed.\n\n" .
        "Warm wishes,\nCottage Holidays Blakeney";
    try {
        if (function_exists('smtp_send')) {
            smtp_send($e['email'], $name, $subject, $text);
        }
        db()
            ->prepare('UPDATE enquiries SET nudge_sent_at = NOW() WHERE id = ?')
            ->execute([(int) $e['id']]);
        $sent++;
    } catch (\Throwable $ex) {
        /* skip this one, continue with the rest */
    }
}

json_out(['ok' => true, 'sent' => $sent, 'candidates' => count($rows)]);
