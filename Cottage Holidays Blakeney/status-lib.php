<?php
// Manage → Status: the PURE judgements behind "This week". Each logged warning
// type is said in plain words with a verdict — whether it needs the owner or
// sorted itself out — so the page can say "none need you" only when that is
// true. No I/O: diagnostics.php reads the rows, test-status.php drives these.
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(404);
    exit();
}

// [title, verdict, needs-you]. An action not listed is shown by its own logged
// summary and counted as NEEDING the owner: an unknown warning must never be
// waved through as "nothing to do".
function status_warn_kind($action, $summary = '')
{
    static $K = [
        'csp.violation' => ['A browser blocked something on the site', 'No action — usually an old copy of the app, which clears as phones update', false],
        'client.error' => ['A page error on someone’s device', 'No action unless it repeats — the log has the details', false],
        'server.error' => ['A server error', 'Worth a look — the log has the details', true],
        'email.fail' => ['An email didn’t send first time', 'No action — it is retried automatically', false],
        'email.gaveup' => ['An email gave up after retrying', 'Needs you — the guest didn’t get it', true],
        'ical.feed.failing' => ['A calendar feed stopped answering', 'Needs you — check its link in Calendar sync', true],
        'cron.job_fail' => ['A daily job failed', 'Worth a look — it runs again tomorrow', true],
        'cron.watchdog' => ['The daily jobs ran late', 'Worth a look if it happens again', true],
        'admin.login_fail' => ['A wrong password on your sign-in', 'No action if it was you', false],
        'admin.login_new' => ['A sign-in from a new device', 'No action if it was you', false],
        'admin.2fa_sent' => ['A sign-in code was sent', 'No action if it was you', false],
        'admin.2fa_fail' => ['A wrong sign-in code', 'No action if it was you', false],
        'admin.reauth_fail' => ['A refund confirmation was refused', 'No action if it was you', false],
        'payment.declined' => ['A guest’s card was declined', 'No action — they can try again', false],
        'autopay.failed' => ['An automatic payment failed', 'Worth a look — the guest has been told', true],
        'booking.conflict' => ['Two bookings overlap', 'Needs you — open the bookings', true],
        'deposit.owed' => ['A deposit is owed back', 'Needs you — return it from the booking', true],
        'deposit.kept' => ['A deposit was kept', 'No action — recorded', false],
        'selfrepair.orphans' => ['Something isn’t linked up', 'Worth a look — the log names it', true],
        'selfrepair.square_orphan' => ['A payment isn’t linked to a booking', 'Needs you — record it on the booking', true],
        'night.reject' => ['The Mac assistant sent something that was refused', 'No action — nothing was stored', false],
        'config.change' => ['A setting changed', 'No action if it was you', false],
        'guest_save_failed' => ['A guest’s details didn’t save', 'Worth a look — ask them to try again', true],
    ];
    if (isset($K[$action])) {
        return ['title' => $K[$action][0], 'verdict' => $K[$action][1], 'needs' => $K[$action][2], 'known' => true];
    }
    $t = trim((string) $summary);
    if (mb_strlen($t) > 70) {
        $t = rtrim(mb_substr($t, 0, 69)) . '…';
    }
    return ['title' => $t !== '' ? $t : 'A logged warning', 'verdict' => 'Worth a look — open the activity log', 'needs' => true, 'known' => false];
}

// The last seven days (oldest first, ending today) and the warnings grouped by
// type, each with its count per day. $rows: [['action','summary','day' => Y-m-d]].
function status_week($rows, $today)
{
    $days = [];
    $base = strtotime($today . ' 12:00:00 UTC');
    for ($i = 6; $i >= 0; $i--) {
        $d = gmdate('Y-m-d', $base - $i * 86400);
        $days[] = ['date' => $d, 'label' => gmdate('D', $base - $i * 86400), 'n' => 0];
    }
    $idx = [];
    foreach ($days as $i => $d) {
        $idx[$d['date']] = $i;
    }
    $groups = [];
    foreach ($rows as $r) {
        $day = substr((string) ($r['day'] ?? ''), 0, 10);
        if (!isset($idx[$day])) {
            continue;
        }
        $a = (string) ($r['action'] ?? '');
        $kind = status_warn_kind($a, (string) ($r['summary'] ?? ''));
        $key = $kind['known'] ? $a : $a . '|' . $kind['title'];
        if (!isset($groups[$key])) {
            $groups[$key] = ['action' => $a, 'title' => $kind['title'], 'verdict' => $kind['verdict'], 'needs' => $kind['needs'], 'n' => 0, 'byDay' => array_fill(0, 7, 0)];
        }
        $groups[$key]['n']++;
        $groups[$key]['byDay'][$idx[$day]]++;
        $days[$idx[$day]]['n']++;
    }
    $groups = array_values($groups);
    usort($groups, fn($x, $y) => ($y['needs'] <=> $x['needs']) ?: ($y['n'] <=> $x['n']));
    $needs = 0;
    foreach ($groups as $g) {
        if ($g['needs']) {
            $needs += $g['n'];
        }
    }
    return ['days' => $days, 'groups' => $groups, 'total' => array_sum(array_column($days, 'n')), 'needs' => $needs];
}

// Count per day over the same seven days, from a list of Y-m-d(…) stamps.
function status_daily($stamps, $today)
{
    $out = array_fill(0, 7, 0);
    $base = strtotime($today . ' 12:00:00 UTC');
    $idx = [];
    for ($i = 6; $i >= 0; $i--) {
        $idx[gmdate('Y-m-d', $base - $i * 86400)] = 6 - $i;
    }
    foreach ($stamps as $s) {
        $d = substr((string) $s, 0, 10);
        if (isset($idx[$d])) {
            $out[$idx[$d]]++;
        }
    }
    return $out;
}
