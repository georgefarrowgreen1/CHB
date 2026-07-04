<?php
// ============================================================
//  diagnostics.php — admin "System check". Runs a read-only health check across
//  every feature (tables, migrations, config) and returns a pass/warn/fail
//  report. Also supports a one-off test email.
//
//  POST {action:'run'}         -> the full report (admin only)
//  POST {action:'test_email'}  -> send a test email to OWNER_NOTIFY_EMAIL
//
//  Read-only: it never writes data (other than the optional test email send).
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/webpush.php';
require_admin();

$in = body();
$action = $in['action'] ?? 'run';

if ($action === 'test_email') {
    require_once __DIR__ . '/mailer.php';
    if (!defined('OWNER_NOTIFY_EMAIL') || !OWNER_NOTIFY_EMAIL) json_out(['ok' => false, 'error' => 'No owner email is set in config.php (OWNER_NOTIFY_EMAIL).']);
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) json_out(['ok' => false, 'error' => 'Email is switched off (MAIL_ENABLED is false).']);
    $res = smtp_send(OWNER_NOTIFY_EMAIL, 'Owner', 'Cottage Holidays Blakeney — test email',
        "This is a test email from your System check. If you're reading this, outgoing email works.",
        '<p style="font-family:Arial,sans-serif;">This is a test email from your <strong>System check</strong>. If you\'re reading this, outgoing email works. 🎉</p>');
    json_out(['ok' => !empty($res['ok']), 'error' => $res['error'] ?? null, 'to' => OWNER_NOTIFY_EMAIL]);
}

// ---- gather schema ------------------------------------------------------
$tables = [];
try { foreach (db()->query('SHOW TABLES')->fetchAll(PDO::FETCH_NUM) as $r) $tables[strtolower($r[0])] = true; }
catch (\Throwable $e) { json_out(['ok' => false, 'error' => 'Database unreachable: ' . $e->getMessage()], 500); }

function table_cols($t) {
    try { $o = []; foreach (db()->query("SHOW COLUMNS FROM `$t`")->fetchAll() as $c) $o[strtolower($c['Field'])] = true; return $o; }
    catch (\Throwable $e) { return []; }
}
$bcols = isset($tables['bookings']) ? table_cols('bookings') : [];

$checks = [];
function add(&$checks, $cat, $label, $status, $detail, $hint = '') {
    $checks[] = ['category' => $cat, 'label' => $label, 'status' => $status, 'detail' => $detail, 'hint' => $hint];
}
// Helper: a feature backed by one or more tables.
function tcheck(&$checks, $tables, $cat, $label, $needed, $okMsg) {
    $missing = array_values(array_filter($needed, fn($t) => empty($tables[strtolower($t)])));
    if ($missing) add($checks, $cat, $label, 'fail', 'Missing table(s): ' . implode(', ', $missing), 'Run migrate.php (deploys do this automatically).');
    else add($checks, $cat, $label, 'ok', $okMsg);
}
// Helper: a feature backed by booking column(s).
function ccheck(&$checks, $bcols, $cat, $label, $needed, $okMsg) {
    $missing = array_values(array_filter($needed, fn($c) => empty($bcols[strtolower($c)])));
    if ($missing) add($checks, $cat, $label, 'fail', 'Missing column(s): ' . implode(', ', $missing), 'Run migrate.php to apply the latest migrations.');
    else add($checks, $cat, $label, 'ok', $okMsg);
}

// ---- Core data ----------------------------------------------------------
tcheck($checks, $tables, 'Core', 'Database & core tables', ['bookings','enquiries','guests','content','payments','properties'], 'All core tables present.');

// ---- Feature tables -----------------------------------------------------
tcheck($checks, $tables, 'Features', 'Guest messages & chat', ['messages','chat_threads'], 'Messaging tables present.');
tcheck($checks, $tables, 'Features', 'Guest reviews', ['guest_reviews'], 'Reviews table present.');
tcheck($checks, $tables, 'Features', 'Guest photo wall', ['guest_photos'], 'Photos table present.');
tcheck($checks, $tables, 'Features', 'Newsletter', ['newsletter_subscribers'], 'Subscribers table present.');
tcheck($checks, $tables, 'Features', 'Waitlist', ['waitlist'], 'Waitlist table present.');
tcheck($checks, $tables, 'Features', 'Calendar (iCal) sync', ['ical_blocks'], 'Calendar-block table present.');
tcheck($checks, $tables, 'Features', 'Analytics', ['pageviews'], 'Analytics table present.');
tcheck($checks, $tables, 'Features', 'Expenses', ['expenses'], 'Expenses table present.');
tcheck($checks, $tables, 'Features', 'Seasonal rates', ['rate_seasons'], 'Seasons table present.');
tcheck($checks, $tables, 'Features', 'Passkeys', ['admin_passkeys','guest_passkeys'], 'Passkey tables present.');
tcheck($checks, $tables, 'Features', 'Tide widget cache', ['tide_cache'], 'Tide-cache table present.');

// ---- Migration-backed booking columns -----------------------------------
ccheck($checks, $bcols, 'Migrations', 'Payment schedule & reminders', ['balance_requested_at','balance_reminded_at'], 'Columns present.');
ccheck($checks, $bcols, 'Migrations', 'Abandoned-payment recovery', ['deposit_requested_at','deposit_reminded_at'], 'Columns present.');
ccheck($checks, $bcols, 'Migrations', 'Review request email', ['review_request_sent'], 'Column present.');
ccheck($checks, $bcols, 'Migrations', 'Pre-arrival emails', ['pre_arrival_sent'], 'Column present.');
ccheck($checks, $bcols, 'Migrations', 'Locked price snapshot', ['agreed_total','price_override'], 'Columns present.');

// ---- Configuration / integrations ---------------------------------------
$placeholderEmails = ['bookings@yourdomain.co.uk', 'sophia@yourdomain.co.uk', 'you@yourdomain.co.uk'];
$mailOn = defined('MAIL_ENABLED') && MAIL_ENABLED
    && defined('SMTP_USER') && SMTP_USER && !in_array(SMTP_USER, $placeholderEmails, true)
    && defined('SMTP_PASS') && SMTP_PASS && SMTP_PASS !== 'CHANGE_ME';
add($checks, 'Email', 'Outgoing email (SMTP)', $mailOn ? 'ok' : 'warn',
    $mailOn ? 'Configured — try the test email.' : 'Not configured: confirmations, reminders, digest, newsletter & review emails won\'t send.',
    $mailOn ? '' : 'Fill in the SMTP settings in config.php and set MAIL_ENABLED to true (SETUP-EMAIL.md).');

$ownerEmail = defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL && !in_array(OWNER_NOTIFY_EMAIL, $placeholderEmails, true);
add($checks, 'Email', 'Owner notifications & weekly digest', $ownerEmail ? 'ok' : 'warn',
    $ownerEmail ? 'Owner email set.' : 'OWNER_NOTIFY_EMAIL is unset/placeholder — you won\'t get owner alerts or the Monday digest.',
    $ownerEmail ? '' : 'Set OWNER_NOTIFY_EMAIL in config.php.');

$square = function_exists('square_enabled') && square_enabled();
add($checks, 'Payments', 'Card payments (Square)', $square ? 'ok' : 'warn',
    $square ? 'Square is on — guests can pay deposits/balances by card.' : 'Off (optional). Deposit/balance requests and recovery emails are skipped.',
    $square ? '' : 'Fill in Square keys in config.php and set SQUARE_PAYMENTS_ENABLED to true (SETUP-SQUARE.md).');

$push = function_exists('wp_vapid_configured') && wp_vapid_configured();
add($checks, 'Notifications', 'Web push (check-in & tide pushes)', $push ? 'ok' : 'warn',
    $push ? 'VAPID keys configured.' : 'Off (optional). The check-in and tide pushes won\'t be delivered.',
    $push ? '' : 'Generate VAPID keys with vapid-keygen.php and paste them into config.php (SETUP-PUSH.md).');

$tideKey = trim(content_value('apikey-tides'));
add($checks, 'Integrations', 'Tide data (WorldTides)', $tideKey !== '' ? 'ok' : 'warn',
    $tideKey !== '' ? 'API key set — tide widget & in-stay tides active.' : 'No key (optional). The tide widget and tide push stay hidden/idle.',
    $tideKey !== '' ? '' : 'Paste a free WorldTides key in Settings → API keys.');

$gReview = trim(content_value('google-review-url'));
add($checks, 'Integrations', 'Google review link', $gReview !== '' ? 'ok' : 'warn',
    $gReview !== '' ? 'Set — review emails lead with a Google button.' : 'Not set (optional). Review emails use the on-site form only.',
    $gReview !== '' ? '' : 'Paste your Google "write a review" link in Settings → Reviews.');

// ---- Daily automation heartbeat -----------------------------------------
// The single most important thing to know is silent: is the daily cron running?
// If it stops, pre-arrival emails, balance chasers, backups and re-invites all
// quietly stop with it. cron.php stamps 'cron-last-run' on every real run.
$cronLast = content_value('cron-last-run');
$cronTs = $cronLast !== '' ? strtotime($cronLast) : false;
if ($cronTs === false) {
    add($checks, 'Automation', 'Daily jobs (cron)', 'warn',
        'No cron run recorded yet. If you have only just set it up, this clears after the first nightly run.',
        'Point a DAILY scheduled task at cron.php?cron=APP_SECRET (see the setup notes).');
} else {
    $ageH = (time() - $cronTs) / 3600;
    $when = gmdate('D j M, H:i', $cronTs) . ' UTC';
    if ($ageH > 36) {
        add($checks, 'Automation', 'Daily jobs (cron)', 'fail',
            'Last ran ' . round($ageH) . 'h ago (' . $when . ') — automation looks stopped. Pre-arrival emails, balance chasers, backups & re-invites are paused.',
            'Check the scheduled task at your host still points at cron.php?cron=APP_SECRET.');
    } else {
        add($checks, 'Automation', 'Daily jobs (cron)', 'ok', 'Last ran ' . $when . '.');
    }
}

$secretOk = defined('APP_SECRET') && APP_SECRET && APP_SECRET !== 'change-this-to-a-long-random-string' && strlen(APP_SECRET) >= 16;
add($checks, 'Security', 'APP_SECRET', $secretOk ? 'ok' : 'fail',
    $secretOk ? 'A strong secret is set.' : 'APP_SECRET is the default/too short — cron links, pay tokens and iCal links are guessable.',
    $secretOk ? '' : 'Set a long random APP_SECRET in config.php.');

// ---- Welcome book (content-backed, no table) ----------------------------
add($checks, 'Features', 'Welcome book', isset($tables['content']) ? 'ok' : 'fail',
    isset($tables['content']) ? 'Content storage available (edit per cottage in Preferences).' : 'Content table missing.',
    isset($tables['content']) ? '' : 'Run migrate.php.');

$summary = ['ok' => 0, 'warn' => 0, 'fail' => 0];
foreach ($checks as $c) { $summary[$c['status']] = ($summary[$c['status']] ?? 0) + 1; }

json_out(['ok' => true, 'summary' => $summary, 'checks' => $checks, 'mail_ready' => $mailOn]);
