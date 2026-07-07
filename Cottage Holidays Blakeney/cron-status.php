<?php
// ============================================================
//  cron-status.php — has the daily cron been running? (admin, read-only)
//  The dashboard polls this and shows a warning banner if the automation
//  has gone quiet, so the owner notices BEFORE a guest misses a pre-arrival
//  email, a balance chaser, or a backup.
//
//  GET/POST → {ok, lastRun, ageHours|null, stale, everRan, heartbeat}
//  stale = true once it's been more than ~36h (a daily cron should be <26h).
// ============================================================
require_once __DIR__ . '/db.php';

// The payload, as a function so admin-bootstrap.php can serve the SAME data in
// its combined back-office boot response. Caller must require_admin.
function cron_status_payload()
{
    $last = content_value('cron-last-run'); // ISO-8601 UTC, or '' if never
    $ageHours = null;
    $stale = true;
    $everRan = false;
    if ($last !== '') {
        $ts = strtotime($last);
        if ($ts !== false) {
            $everRan = true;
            $ageHours = round((time() - $ts) / 3600, 1);
            $stale = $ageHours > 36; // a daily job should reappear within ~26h
        }
    }
    return [
        'ok' => true,
        'lastRun' => $last ?: null,
        'ageHours' => $ageHours,
        'stale' => $stale,
        'everRan' => $everRan,
        'heartbeat' => defined('CRON_HEARTBEAT_URL') && CRON_HEARTBEAT_URL ? true : false,
    ];
}

// Serve only when this file is the request (admin-bootstrap.php includes it as a lib).
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'cron-status.php') {
    return;
}

require_admin();
json_out(cron_status_payload());
