<?php
// ============================================================
//  cron.php — one daily cron entry point that runs ALL scheduled jobs.
//  Instead of creating a separate IONOS cron job per task, point a single
//  DAILY cron at this file and it pings each job in turn. The secret can be
//  passed EITHER as a query string OR as a path segment — handy for cron
//  panels (like IONOS) that don't allow "?" in the URL:
//
//    https://YOURDOMAIN/YOURFOLDER/cron.php/APP_SECRET     (no "?")
//    https://YOURDOMAIN/YOURFOLDER/cron.php?cron=APP_SECRET
//
//  Each job is independently safe to run daily (acts only when there's work,
//  never repeats itself). A logged-in admin can also run it while signed in.
//  Returns a per-job summary.
// ============================================================
require_once __DIR__ . '/db.php';

// Accept the secret from ?cron=… OR from the path (/cron.php/APP_SECRET),
// so it works even where a cron panel forbids query strings.
$provided = (string)($_GET['cron'] ?? '');
if ($provided === '' && !empty($_SERVER['PATH_INFO'])) {
    $provided = ltrim((string)$_SERVER['PATH_INFO'], '/');
}
$isCron = $provided !== '' && hash_equals(APP_SECRET, $provided);
if (!$isCron && empty($_SESSION['admin_id'])) json_out(['error' => 'Not authorised'], 401);

// Build an absolute base URL to this folder from the current request, so the
// dispatcher works at the domain root or in any subfolder.
$scheme = request_is_https() ? 'https' : 'http';
$host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
$dir    = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
$base   = $scheme . '://' . $host . $dir . '/';
$secret = rawurlencode(APP_SECRET);

// The daily jobs, in order. Each is a relative URL; the cron secret is appended.
$jobs = [
    'pre-arrival.php?cron='                    => 'Pre-arrival & review emails',
    'payments-due.php?cron='                   => 'Balance requests, chasers & deposit recovery',
    'enquiry-nudge.php?cron='                  => 'Enquiry follow-ups',
    'anniversary-nudge.php?cron='              => 'Anniversary re-invites (past guests)',
    'mailbox-read.php?cron='                   => 'Reply-by-email: pull emailed replies',
    'owner-digest.php?cron='                   => 'Owner weekly digest (Mondays)',
    'weekly-analytics.php?cron='               => 'Weekly analytics digest (Sundays)',
    'backup.php?cron='                         => 'Weekly database backup (Mondays)',
];

$results = [];
foreach ($jobs as $path => $label) {
    $url = $base . $path . $secret;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_FOLLOWLOCATION => true,
        // Same-origin loopback: some shared hosts present mismatched certs.
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
    ]);
    $raw    = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    $body = $raw ? json_decode($raw, true) : null;
    $results[] = [
        'job'    => $label,
        'script' => strtok($path, '?'),
        'status' => $status,
        'ok'     => ($status >= 200 && $status < 300),
        'result' => is_array($body) ? $body : ($err ?: substr((string)$raw, 0, 200)),
    ];
}

// Heartbeat: stamp the last successful run so the back office can warn the owner
// if the daily cron ever stops (Health check + a dashboard banner read this).
// Only stamp on a real cron invocation, not an admin's manual "run now" click.
if ($isCron) {
    try {
        db()->prepare("INSERT INTO content (item_key, item_value) VALUES ('cron-last-run', ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP")
            ->execute([json_encode(gmdate('c'))]);
    } catch (\Throwable $e) { /* never fail the cron over the heartbeat */ }

    // Optional external dead-man's-switch: if the owner set CRON_HEARTBEAT_URL in
    // config.php (e.g. a free healthchecks.io ping URL), tell it we ran. That
    // service emails the owner if the ping DOESN'T arrive — the only alert that
    // still fires when the whole cron is down. Best-effort, short timeout.
    if (defined('CRON_HEARTBEAT_URL') && CRON_HEARTBEAT_URL) {
        try {
            $hb = curl_init(CRON_HEARTBEAT_URL);
            curl_setopt_array($hb, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_NOBODY => true]);
            curl_exec($hb); curl_close($hb);
        } catch (\Throwable $e) {}
    }
}

json_out([
    'ok'   => true,
    'ran'  => count($results),
    'jobs' => $results,
]);
