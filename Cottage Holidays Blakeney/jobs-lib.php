<?php
// ============================================================
//  jobs-lib.php — when a scheduled job is due, and whether it worked. Pure (no
//  database, no clock of its own) so test-jobs.php can drive it; required by
//  cron.php and the weekly jobs (owner-digest, weekly-analytics, backup).
// ============================================================

// IS A WEEKLY JOB DUE? It runs on its day, and on the first run after it when that
// day was missed — a Monday with no cron run used to mean no off-site backup and no
// digest that week. Due when nothing has been sent since the latest $dayN (1 Monday
// … 7 Sunday) on or before $today. $last is the date it last went ('' = never).
function weekly_due(string $last, string $today, int $dayN): bool
{
    $t = strtotime($today . ' 12:00:00');
    if ($t === false || $dayN < 1 || $dayN > 7) {
        return false;
    }
    $back = ((int) date('N', $t) - $dayN + 7) % 7;
    $start = date('Y-m-d', strtotime($today . ' 12:00:00 -' . $back . ' days'));
    $last = substr(trim($last), 0, 10);
    return $last === '' || $last < $start;
}

// DID A JOB WORK? A 2xx is not always success: migrate.php reports each file on its
// own, and a job that could not do its work answers {ok:false, error:…} — no owner
// email for the digest, bookings it could not read, plans it could not query — which
// the cron recorded as a job that went fine. An ok:false WITHOUT an error is a job
// with nothing to do (the mailbox switched off, no Square), not a failure.
// Returns ['ok' => bool, 'note' => why not].
function cron_result_ok(int $status, $body): array
{
    if ($status < 200 || $status >= 300) {
        return ['ok' => false, 'note' => ''];
    }
    if (is_array($body) && is_array($body['migrations'] ?? null)) {
        $bad = array_values(array_filter($body['migrations'], fn($m) => is_array($m) && ($m['status'] ?? '') === 'ERROR'));
        if ($bad) {
            return ['ok' => false, 'note' => count($bad) . ' migration(s) failed to apply — ' . (string) ($bad[0]['file'] ?? '?')];
        }
    }
    if (is_array($body) && ($body['ok'] ?? null) === false && is_string($body['error'] ?? null) && trim($body['error']) !== '') {
        return ['ok' => false, 'note' => mb_substr(trim($body['error']), 0, 160)];
    }
    return ['ok' => true, 'note' => ''];
}
