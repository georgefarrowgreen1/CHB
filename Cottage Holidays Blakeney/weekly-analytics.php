<?php
// ============================================================
//  weekly-analytics.php — a Sunday-evening "your week online" email to the
//  owner: people, pages viewed, enquiries sent, bookings through the site, top channel/page and any unmet
//  search demand — plus a heads-up alert if visits dropped sharply.
//
//  Add it to the SAME daily cron as the others — it only actually sends on a
//  Sunday, and at most once per day, so a daily trigger is safe:
//    https://YOURDOMAIN/weekly-analytics.php?cron=APP_SECRET
//
//  A logged-in admin can preview/force a send any day with ?force=1.
//  The owner can switch it off with the content key analytics-digest-off = "1".
//  Numbers come from analytics_summary() — the SAME source as the dashboard.
// ============================================================
require_once __DIR__ . '/analytics-data.php'; // analytics_summary() (+ db.php)
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/jobs-lib.php'; // weekly_due

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron) {
    // A signed-in admin's manual run must be a POST so require_admin() enforces the
    // CSRF token — a cross-site GET link in the owner's browser must not be able to
    // fire this job via their session (same guard as cron.php / self-repair.php).
    require_admin();
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        json_out(['error' => 'Run this from the back office, or use the cron URL with your secret.'], 405);
    }
}

$force = !empty($_GET['force']);
// Asked for from the back office: it comes to the person who asked.
if (!$isCron && $force && function_exists('admin_contact_email') && admin_me()) {
    people_mail_only(admin_contact_email(admin_me()));
}

// Sundays, or the first run after a missed one; once a week, one run at a time (the
// owner digest's rules — see weekly_due).
$today = date('Y-m-d');
if (!$force) {
    if (!weekly_due((string) content_value('analytics-digest-last'), $today, 7)) {
        json_out(['ok' => true, 'sent' => false, 'reason' => 'already sent this week']);
    }
    try {
        if ((string) db()->query("SELECT GET_LOCK('chb_weekly_analytics', 0)")->fetchColumn() !== '1') {
            json_out(['ok' => true, 'sent' => false, 'reason' => 'another run is sending it']);
        }
    } catch (\Throwable $e) {
    }
    if (!weekly_due((string) content_value('analytics-digest-last'), $today, 7)) {
        json_out(['ok' => true, 'sent' => false, 'reason' => 'already sent this week']);
    }
}
// Owner opt-out.
if (!$force && content_value('analytics-digest-off') === '1') {
    json_out(['ok' => true, 'sent' => false, 'reason' => 'opted out']);
}
// Gate on who would actually get it: the people who chose it and the extra
// addresses, not the config constant alone.
if (!owner_recipients('analytics')) {
    json_out(['ok' => false, 'error' => 'No owner email — set OWNER_NOTIFY_EMAIL in config.php or add a recipient in Settings → Notifications']);
}

// ---- Pull the same numbers the dashboard shows (last 7 days) ----
try {
    $a = analytics_summary(7);
} catch (\Throwable $e) {
    json_out(['ok' => false, 'error' => 'Analytics not ready (run migrations).']);
}

$views = (int) ($a['totalViews'] ?? 0);
$uniq = (int) ($a['uniqueVisitors'] ?? 0);
$prevUniq = (int) ($a['prevUniqueVisitors'] ?? 0);
// Manage → Analytics' figures: enquiries SENT (the site's own event — approval
// deletes the enquiry row) and bookings made through the site.
$sent = (int) (($a['events'] ?? [])['enquiry_submit'] ?? 0);
$booked = (int) ($a['siteBookings'] ?? 0);
$dropPct = $prevUniq > 0 ? (int) round((($uniq - $prevUniq) / $prevUniq) * 100) : null;
$arrow = $dropPct === null ? '' : ($dropPct >= 0 ? '▲' : '▼');
$deltaTxt = $dropPct === null ? '' : $arrow . abs($dropPct) . '%';

$channels = is_array($a['channels'] ?? null) ? $a['channels'] : [];
$topChannel = $channels ? $channels[0]['channel'] : '—';
$pageLabels = [
    'view-main' => 'Home',
    'view-cottages' => 'All cottages',
    'view-experiences' => 'Experiences',
    'view-guest-bookings' => 'My stays',
    'view-pay' => 'Payment',
    'view-account' => 'Account',
];
$pageLabel = function ($p) use ($pageLabels) {
    return $pageLabels[$p] ?? ($p ? ucfirst(trim(str_replace(['view-', '-'], ['', ' '], $p))) : 'Home');
};
$pages = is_array($a['topPages'] ?? null) ? $a['topPages'] : [];
$topPage = $pages ? $pageLabel($pages[0]['path']) : '—';
$sd = is_array($a['searchDemand'] ?? null) ? $a['searchDemand'] : [];
$noResult = (int) ($sd['noResult'] ?? 0);

$siteUrl = function_exists('site_base_url') ? site_base_url() : '/';

// ---- Subject + plain text ----
// Composed by weekly_analytics_body() in mailer.php — one payload, so the template can
// be previewed and render-gated instead of only existing inside this cron run.
$m = weekly_analytics_body([
    'views' => $views, 'uniq' => $uniq, 'sent' => $sent, 'booked' => $booked,
    'topChannel' => $topChannel, 'topPage' => $topPage,
    'noResult' => $noResult, 'dropPct' => $dropPct, 'deltaTxt' => $deltaTxt,
    'siteUrl' => $siteUrl,
]);
[$subject, $text, $html] = [$m['subject'], $m['text'], $m['html']];

$res = send_people('analytics', $subject, $text, $html);

// Stamp on delivered OR queued (see owner-digest.php): a queued copy must
// suppress a same-day resend, or it delivers twice.
// (A copy only for the person who asked must not stop Sunday's.)
if (people_mail_only() === '' && (!empty($res['ok']) || $res === true || !empty($res['queued']))) {
    try {
        db()
            ->prepare(
                'INSERT INTO content (item_key, item_value) VALUES (?, ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP',
            )
            ->execute(['analytics-digest-last', json_encode($today)]);
    } catch (\Throwable $e) {
    }
}

json_out([
    'ok' => true,
    'sent' => true,
    'views' => $views,
    'unique' => $uniq,
    'enquiries_sent' => $sent,
    'booked' => $booked,
    'drop_pct' => $dropPct,
    'mail' => $res,
]);
