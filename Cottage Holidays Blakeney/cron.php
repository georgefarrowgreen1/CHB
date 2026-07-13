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
$provided = (string) ($_GET['cron'] ?? '');
if ($provided === '' && !empty($_SERVER['PATH_INFO'])) {
    $provided = ltrim((string) $_SERVER['PATH_INFO'], '/');
}
$isCron = $provided !== '' && hash_equals(APP_SECRET, $provided);
if (!$isCron) {
    // A manual run by a signed-in admin must be a POST so require_admin() enforces
    // the CSRF token — otherwise a GET <img>/link in the owner's browser could fire
    // the whole automation (guest emails and all) via their session. The automated
    // loopback cron authorises with the secret above and is unaffected; an owner can
    // still run it in a browser via cron.php?cron=SECRET.
    require_admin();
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        json_out(['error' => 'Run this from the back office, or use the cron URL with your secret.'], 405);
    }
}

// Build an absolute base URL to this folder from the current request, so the
// dispatcher works at the domain root or in any subfolder.
$scheme = request_is_https() ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
$base = $scheme . '://' . $host . $dir . '/';
$secret = rawurlencode(APP_SECRET);

// The daily jobs, in order. Each is a relative URL; the cron secret is appended.
$jobs = [
    'ical-import.php?cron=' => 'Airbnb/Vrbo calendar sync (avoid double-bookings)',
    'conflict-audit.php?cron=' => 'Double-booking safety check',
    'self-repair.php?cron=' => 'Self-repair (state checks & safe fixes)',
    'pre-arrival.php?cron=' => 'Pre-arrival & review emails',
    'payments-due.php?cron=' => 'Balance requests, chasers & deposit recovery',
    'enquiry-nudge.php?cron=' => 'Enquiry follow-ups',
    'anniversary-nudge.php?cron=' => 'Anniversary re-invites (past guests)',
    'direct-followup.php?cron=' => 'Book-direct re-invites (external reviewers)',
    'mailbox-read.php?cron=' => 'Reply-by-email: pull emailed replies',
    'owner-digest.php?cron=' => 'Owner weekly digest (Mondays)',
    'weekly-analytics.php?cron=' => 'Weekly analytics digest (Sundays)',
    'backup.php?cron=' => 'Weekly database backup (Mondays)',
];

$results = [];
foreach ($jobs as $path => $label) {
    $url = $base . $path . $secret;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_FOLLOWLOCATION => true,
        // Same-origin loopback: some shared hosts present mismatched certs.
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
    ]);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    $body = $raw ? json_decode($raw, true) : null;
    $results[] = [
        'job' => $label,
        'script' => strtok($path, '?'),
        'status' => $status,
        'ok' => $status >= 200 && $status < 300,
        'result' => is_array($body) ? $body : ($err ?: substr((string) $raw, 0, 200)),
    ];
}

// Surface any automation job that failed so it shows in the "Needs attention"
// stream rather than failing silently in the background.
foreach ($results as $r) {
    if (empty($r['ok'])) {
        log_activity('system', 'cron.job_fail', 'Automation job failed — ' . $r['job'], [
            'severity' => 'warn',
            'actor' => $isCron ? 'cron' : 'owner',
            'entity' => 'cron',
            'meta' => ['detail' => 'HTTP ' . $r['status']],
        ]);
    }
}

// Heartbeat: stamp the last successful run so the back office can warn the owner
// if the daily cron ever stops (Health check + a dashboard banner read this).
// Only stamp on a real cron invocation, not an admin's manual "run now" click.
if ($isCron) {
    try {
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value) VALUES ('cron-last-run', ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
            )
            ->execute([json_encode(gmdate('c'))]);
    } catch (\Throwable $e) {
        /* never fail the cron over the heartbeat */
    }

    // Rolling uptime record for the public /status page: one entry per UTC day —
    // 'ok' when every job ran clean, 'warn' when any failed. A day with NO entry
    // means the cron never ran (site or automation down) and /status shows it as
    // a gap; that absence is the signal, so only a real cron run writes here.
    try {
        $day = gmdate('Y-m-d');
        $allOk = true;
        foreach ($results as $r) {
            if (empty($r['ok'])) {
                $allOk = false;
                break;
            }
        }
        // Stores a date→state MAP (JSON object) — must be read with content_json();
        // content_value() returns '' for a non-scalar, which would reset the history
        // every run and leave /status showing only the current day.
        $hist = content_json('uptime-history', []);
        if (!is_array($hist)) {
            $hist = [];
        }
        // A failure earlier in the day sticks — a later clean re-run doesn't hide it.
        $hist[$day] = ($hist[$day] ?? '') === 'warn' ? 'warn' : ($allOk ? 'ok' : 'warn');
        ksort($hist);
        $hist = array_slice($hist, -40, null, true); // keep a little over the 30 shown
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value) VALUES ('uptime-history', ?)
                 ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
            )
            ->execute([json_encode($hist)]);
    } catch (\Throwable $e) {
        /* history is a nicety; never fail the cron over it */
    }

    // Activity log: one summary line of what the automation did today (incl. how
    // many guest emails each job sent), and keep the log bounded to ~5000 rows.
    try {
        $sentBits = [];
        foreach ($results as $r) {
            if (is_array($r['result']) && !empty($r['result']['sent'])) {
                $sentBits[] = (int) $r['result']['sent'] . ' ' . preg_replace('/\.php$/', '', $r['script']);
            }
        }
        log_activity(
            'system',
            'cron.run',
            'Daily automation ran' . (count($sentBits) ? ' — sent ' . implode(', ', $sentBits) : ' (' . count($results) . ' jobs)'),
            ['actor' => 'cron'],
        );
    } catch (\Throwable $e) {
    }
    try {
        db()->exec(
            'DELETE FROM activity_log WHERE id <= (SELECT cutoff FROM (SELECT id AS cutoff FROM activity_log ORDER BY id DESC LIMIT 1 OFFSET 5000) x)',
        );
    } catch (\Throwable $e) {
    }

    // Config drift: config.php is edited out-of-band (host panel/FTP), so changes to
    // payments (Square live↔sandbox / on-off) or email settings never pass through an
    // endpoint we could log. Fingerprint them daily and flag any change — the answer
    // to "why did payments/email stop last week?" belongs in the log.
    try {
        $cfg = json_encode([
            'square' => function_exists('square_enabled') ? (bool) square_enabled() : false,
            'square_env' =>
                function_exists('square_api_base') && stripos(square_api_base(), 'sandbox') !== false
                    ? 'sandbox'
                    : 'live',
            'smtp' => defined('SMTP_HOST') ? SMTP_HOST : '',
            'mail' => defined('MAIL_ENABLED') && MAIL_ENABLED ? 1 : 0,
        ]);
        $prevCfg = content_value('config-fingerprint');
        if ($prevCfg !== '' && $prevCfg !== $cfg) {
            log_activity('settings', 'config.change', 'Site configuration changed (payments / email settings)', [
                'actor' => 'system',
                'severity' => 'warn',
                'entity' => 'config',
            ]);
        }
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value) VALUES ('config-fingerprint', ?)
                 ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
            )
            ->execute([json_encode($cfg)]);
    } catch (\Throwable $e) {
    }

    // Optional external dead-man's-switch: if the owner set CRON_HEARTBEAT_URL in
    // config.php (e.g. a free healthchecks.io ping URL), tell it we ran. That
    // service emails the owner if the ping DOESN'T arrive — the only alert that
    // still fires when the whole cron is down. Best-effort, short timeout.
    if (defined('CRON_HEARTBEAT_URL') && CRON_HEARTBEAT_URL) {
        try {
            $hb = curl_init(CRON_HEARTBEAT_URL);
            curl_setopt_array($hb, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_NOBODY => true]);
            curl_exec($hb);
            curl_close($hb);
        } catch (\Throwable $e) {
        }
    }
}

json_out([
    'ok' => true,
    'ran' => count($results),
    'jobs' => $results,
]);
