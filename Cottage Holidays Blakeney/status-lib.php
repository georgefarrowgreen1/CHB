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
        'server.check' => ['Files on the server need a look', 'Needs you — the server file check names them', true],
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

// PHP2Shell (CVE-2026-109618 and CVE-2026-109619, announced 21/10/2026): the first release
// on each supported branch with the fix. A branch older than these gets no official fix.
// When the next PHP security release matters, this table is what changes.
const STATUS_PHP_FIXED = ['8.2' => 35, '8.3' => 36, '8.4' => 27, '8.5' => 12];

// true: this PHP has the fix (or is a newer branch); false: a supported branch without it;
// null: a branch that no longer gets security fixes at all.
function status_php_patched(int $major, int $minor, int $release): ?bool
{
    $branch = $major . '.' . $minor;
    if (isset(STATUS_PHP_FIXED[$branch])) {
        return $release >= STATUS_PHP_FIXED[$branch];
    }
    $newest = array_key_last(STATUS_PHP_FIXED);
    return version_compare($branch, (string) $newest, '>') ? true : null;
}

// The Status rows for the PHP the site runs on, each [label, status, detail]. The host
// (IONOS) installs PHP, so the row asks for their update. While it is missing, a second
// row says whether the temporary workaround for CVE-2026-109619 is in force: session
// upload progress switched off by .user.ini. $wa: off (it is off), file (.user.ini is in
// the top folder), reads (this PHP reads .user.ini files), ttl (seconds it caches them).
// A first sentence is all the Status card shows, and an ok detail of 26 characters or
// fewer is the row's note, so each one is said in that space.
function status_php_rows(int $major, int $minor, int $release, array $wa): array
{
    $v = $major . '.' . $minor . '.' . $release;
    $patched = status_php_patched($major, $minor, $release);
    if ($patched === true) {
        return [['PHP version', 'ok', 'PHP ' . $v . ' has the fix.']];
    }
    $rows = [];
    if ($patched === false) {
        $fix = $major . '.' . $minor . '.' . STATUS_PHP_FIXED[$major . '.' . $minor];
        $rows[] = ['PHP version', 'fail', 'PHP ' . $v . ' needs IONOS to update it to ' . $fix . ', the release that fixes two critical flaws announced on 21/10/2026.'];
    } else {
        $rows[] = ['PHP version', 'fail', 'PHP ' . $v . ' gets no security fixes any more, so choose PHP 8.3 or newer in the IONOS control panel.'];
    }
    if (!empty($wa['off'])) {
        $rows[] = ['PHP workaround', 'ok', 'On for one of two flaws.'];
    } elseif (empty($wa['file'])) {
        $rows[] = ['PHP workaround', 'warn', 'The temporary fix for one of the two flaws is missing its settings file, .user.ini, from the website\'s top folder.'];
    } elseif (empty($wa['reads'])) {
        $rows[] = ['PHP workaround', 'warn', 'This PHP does not read the settings file, so ask IONOS to switch off session.upload_progress for the website.'];
    } else {
        $mins = max(1, (int) ceil(((int) ($wa['ttl'] ?? 300)) / 60));
        $rows[] = ['PHP workaround', 'warn', 'The temporary fix for one of the two flaws is not on yet, which can take up to ' . $mins . ' minute' . ($mins === 1 ? '' : 's') . ' after an update.'];
    }
    return $rows;
}

// THE SERVER FILE CHECK (.github/workflows/server-check.yml) reports each run to
// server-check.php, which logs it as 'server.check'. $row is the newest such row
// (summary, severity, meta, created_at) or null; returns the Status row, or null before
// the check has ever run (nothing to say yet). A run more than 15 days old is a
// warning: the check runs weekly, and one that has stopped says nothing at all.
//
// BETWEEN RUNS THE SITE CHECKS WHAT IT CAN FOR ITSELF. The report carries `open`: the
// files whose removal resolves their finding (`gone`), the files that should be there
// (`back`), and how many findings it cannot judge (`other`: a changed file, a stand-in
// name). With $exists (path → is it on disk here) a finding already dealt with stops
// counting, so "Fix safe issues" clears the row at once rather than next Monday. The
// row names up to three files; $removable is what "Fix safe issues" deletes
// (retired-lib.php), so the fourth element can say whether that button will help.
// Returns [label, status, sentence, hint].
function status_server_check_row(?array $row, int $now, ?callable $exists = null, array $removable = []): ?array
{
    if (!$row) {
        return null;
    }
    $gh = 'The check\'s run on GitHub (Actions, "Check the server\'s files") names each file.';
    $at = strtotime((string) ($row['created_at'] ?? '')) ?: 0;
    $day = $at ? date('d/m/Y', $at) : 'an unknown date';
    if ($now - $at > 15 * 86400) {
        return ['Server files', 'warn', 'The weekly server file check last reported on ' . $day . ', so it may have stopped running.', ''];
    }
    $meta = json_decode((string) ($row['meta'] ?? ''), true);
    $found = is_array($meta) ? (int) ($meta['found'] ?? 0) : 0;
    if (($row['severity'] ?? '') !== 'warn' && $found <= 0) {
        return ['Server files', 'ok', 'Checked ' . $day . '.', ''];
    }
    $found = max(1, $found);
    $open = is_array($meta) && is_array($meta['open'] ?? null) ? $meta['open'] : null;
    if (!$exists || !$open) {
        return ['Server files', 'warn', $found . ' thing' . ($found === 1 ? '' : 's') . ' on the server need' . ($found === 1 ? 's' : '') . ' a look, found on ' . $day . ' by the server file check, which names them.', $gh];
    }
    // A path the site will look up: plain, relative, no dot folders. Anything else
    // counts as still open.
    $plain = fn($p) => is_string($p) && preg_match('#^[A-Za-z0-9._@+-]+(/[A-Za-z0-9._@+-]+)*$#', $p) && !preg_match('#(^|/)\.\.?(/|$)#', $p);
    $gone = array_values(array_filter(is_array($open['gone'] ?? null) ? $open['gone'] : [], $plain));
    $back = array_values(array_filter(is_array($open['back'] ?? null) ? $open['back'] : [], $plain));
    // What the lists leave out (they stop at 200, and an odd name was dropped above) is
    // still open; so is everything the site cannot judge.
    $unseen = max(0, (int) ($open['goneAll'] ?? 0) - count($gone)) + max(0, (int) ($open['backAll'] ?? 0) - count($back));
    $other = max(0, (int) ($open['other'] ?? 0));
    $here = array_values(array_filter($gone, $exists));
    $absent = array_values(array_filter($back, fn($p) => !$exists($p)));
    $n = count($here) + count($absent) + $unseen + $other;
    if ($n === 0) {
        return ['Server files', 'ok', 'Checked ' . $day . '; what it found has since been dealt with.', ''];
    }
    $names = array_slice(array_merge($here, $absent), 0, 3);
    $verb = $n === 1 ? 'needs' : 'need';
    if (!$names) {
        $text = $n . ' thing' . ($n === 1 ? '' : 's') . ' on the server ' . $verb . ' a look, found on ' . $day . ' by the server file check, which names them.';
    } else {
        $more = $n - count($names);
        $list = count($names) === 1 ? $names[0] : implode(', ', array_slice($names, 0, -1)) . ($more ? ', ' : ' and ') . end($names);
        $text = $list . ($more ? ' and ' . $more . ' more' : '') . ' ' . $verb . ' a look on the server, found on ' . $day . ' by the server file check.';
    }
    $fixable = count(array_intersect($here, $removable));
    $hint = $fixable === 0 ? $gh
        : ($fixable === $n ? '"Fix safe issues" removes ' . ($n === 1 ? 'it' : 'them') . ': the site no longer uses ' . ($n === 1 ? 'that file' : 'those files') . '.'
            : '"Fix safe issues" removes ' . $fixable . ' of them (files the site no longer uses). ' . $gh);
    return ['Server files', 'warn', $text, $hint];
}
