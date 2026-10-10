<?php
// ============================================================
//  test-jobs.php — when a scheduled job is due, and whether it worked
//  (jobs-lib.php). DEV/CI only, deploy-excluded with the other test-*.php.
//
//      php test-jobs.php
//
//  The weekly jobs ran only on their exact day, so a Monday with no cron run
//  meant no off-site backup and no digest that week; and the cron recorded any
//  2xx as success, so a job answering {ok:false, error} never reached Needs
//  attention. No database and no clock: every date is passed in.
// ============================================================
require_once __DIR__ . '/jobs-lib.php';

$fails = 0;
function jbk($name, $cond, $extra = '')
{
    global $fails;
    if ($cond) {
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fails++;
        echo "  \xE2\x9C\x97 $name" . ($extra !== '' ? " — $extra" : '') . "\n";
    }
}

echo "\n== 1. A weekly job is due on its day, or on the first run after it ==\n";
// 2026-10-12 is a Monday, 2026-10-18 the Sunday after it.
jbk('Monday, never sent → due', weekly_due('', '2026-10-12', 1));
jbk('Monday, sent this morning → not due', !weekly_due('2026-10-12', '2026-10-12', 1));
jbk('Monday, last sent the Monday before → due', weekly_due('2026-10-05', '2026-10-12', 1));
jbk('Tuesday after a missed Monday → due (the catch-up)', weekly_due('2026-10-05', '2026-10-13', 1));
jbk('…and once it has gone on Tuesday, not again that week', !weekly_due('2026-10-13', '2026-10-17', 1));
jbk('Sunday, last sent Monday → not due (same week)', !weekly_due('2026-10-12', '2026-10-18', 1));
jbk('the next Monday → due again', weekly_due('2026-10-13', '2026-10-19', 1));
jbk('a Sunday job: Sunday, last sent the Sunday before → due', weekly_due('2026-10-11', '2026-10-18', 7));
jbk('…Monday after a missed Sunday → due', weekly_due('2026-10-11', '2026-10-19', 7));
jbk('…and Saturday, sent on Sunday → not due', !weekly_due('2026-10-18', '2026-10-24', 7));
jbk('a stored value with a time still reads as its date', !weekly_due('2026-10-12 08:01:00', '2026-10-14', 1));
jbk('a nonsense day number is never due', !weekly_due('', '2026-10-12', 0) && !weekly_due('', '2026-10-12', 8));
// Across the clocks going back (25 Oct 2026) and a year end.
jbk('across the clock change: Monday 26 Oct, sent 19 Oct → due', weekly_due('2026-10-19', '2026-10-26', 1));
jbk('across a year end: Friday 1 Jan 2027, sent Mon 28 Dec → not due', !weekly_due('2026-12-28', '2027-01-01', 1));

echo "\n== 2. Whether a job worked is not just its HTTP status ==\n";
jbk('a 2xx with ok:true worked', cron_result_ok(200, ['ok' => true])['ok']);
jbk('a 500 did not', !cron_result_ok(500, ['ok' => false, 'error' => 'x'])['ok']);
jbk('no answer at all did not', !cron_result_ok(0, null)['ok']);
$r = cron_result_ok(200, ['ok' => false, 'error' => 'No owner email — set OWNER_NOTIFY_EMAIL']);
jbk('a 2xx saying ok:false with an error did NOT work, and says why', !$r['ok'] && strpos($r['note'], 'No owner email') === 0, json_encode($r));
jbk('ok:false with nothing to do (the mailbox switched off) is not a failure', cron_result_ok(200, ['ok' => false, 'skipped' => 'not-enabled'])['ok']);
jbk('…nor Square not set up (no error)', cron_result_ok(200, ['ok' => false, 'collected' => 0, 'error' => null])['ok']);
$m = cron_result_ok(200, ['migrations' => [['file' => 'a.sql', 'status' => 'OK'], ['file' => 'b.sql', 'status' => 'ERROR']]]);
jbk('a failed migration inside a 200 is a failure naming the file', !$m['ok'] && strpos($m['note'], 'b.sql') !== false, json_encode($m));
jbk('a non-JSON 2xx body still counts as worked (the old rule)', cron_result_ok(200, null)['ok']);

echo "\n== 3. The wiring ==\n";
$src = fn($f) => (string) preg_replace('~^\s*//.*$~m', '', (string) file_get_contents(__DIR__ . '/' . $f));
$cron = $src('cron.php');
jbk('cron.php judges each job through cron_result_ok', strpos($cron, 'cron_result_ok($status, $body)') !== false);
$dg = $src('owner-digest.php');
jbk('the digest is due by weekly_due on Mondays, not on the exact day', strpos($dg, "weekly_due((string) content_value('owner-digest-last'), \$today, 1)") !== false && strpos($dg, "date('N') !== 1") === false);
jbk('…one run at a time', strpos($dg, "GET_LOCK('chb_owner_digest', 0)") !== false);
$wa = $src('weekly-analytics.php');
jbk('the analytics email is due by weekly_due on Sundays', strpos($wa, "weekly_due((string) content_value('analytics-digest-last'), \$today, 7)") !== false && strpos($wa, "date('N') !== 7") === false);
jbk('…one run at a time', strpos($wa, "GET_LOCK('chb_weekly_analytics', 0)") !== false);
$bk = $src('backup.php');
jbk('the backup runs on the first run of the ISO week, not only on Monday', strpos($bk, "content_value('backup-last-week') === \$week") !== false && strpos($bk, "date('N') !== 1") === false);
jbk('…one run at a time', strpos($bk, "GET_LOCK('chb_backup_run', 0)") !== false);
$ar = $src('autopay-run.php');
jbk('the collector says why when it could not run', strpos($ar, "'error' => \$res['error'] ?? null") !== false);
$wr = $src('watchers-run.php');
jbk('the watchers run once at a time and save against the list as it is then', strpos($wr, "GET_LOCK('chb_watchers_run', 0)") !== false && strpos($wr, 'content_locked(WATCHERS_KEY') !== false);

// AN UNCERTAIN SEND KEEPS ITS CLAIM: the mail server went quiet after taking the
// message, so it may have been delivered, and a job that handed its claim back sent the
// guest the same email again on its next run. Every release of a send claim in the
// guest-emailing jobs must first ask (payments-due's word for it is the transport's
// "Message not accepted" sentence). Comments are stripped, so the explanation can't pass.
$claims = 0;
$bad = [];
foreach (['pre-arrival.php', 'enquiry-nudge.php', 'payments-due.php'] as $f) {
    $s = $src($f);
    if (preg_match_all('/SET (\w+) = NULL WHERE id = \?/', $s, $m, PREG_OFFSET_CAPTURE)) {
        foreach ($m[0] as $i => $hit) {
            $claims++;
            $before = substr($s, max(0, $hit[1] - 420), 420);
            if (strpos($before, 'sent_uncertain') === false && strpos($before, "'Message not accepted'") === false) {
                $bad[] = $f . ' ' . $m[1][$i][0];
            }
        }
    }
}
jbk('every released send claim first asks whether the email may have gone (vacuity: ≥8 releases)', $claims >= 8 && !$bad, $claims . ' releases; not asking: ' . implode(', ', $bad));
jbk('…and the anniversary nudge records an uncertain send instead of retrying it', strpos($src('anniversary-nudge.php'), "!empty(\$r['sent_uncertain'])") !== false);

echo "\n== Summary ==\n";
if ($fails) {
    echo "  $fails CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL JOB CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
