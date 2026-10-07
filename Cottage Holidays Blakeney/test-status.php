<?php
// Manage → Status's pure judgements (status-lib.php): every warning is said in
// plain words with a verdict, an unknown one is never waved through, and the
// week buckets by day. No DB, no clock — today is passed in. Deploy-excluded.
$_SERVER['SCRIPT_FILENAME'] = __FILE__;
require __DIR__ . '/status-lib.php';

$stsFails = 0;
$stsN = 0;
function sts($label, $cond)
{
    global $stsFails, $stsN;
    $stsN++;
    if ($cond) {
        echo "  ✓ $label\n";
    } else {
        $stsFails++;
        echo "  ✗ $label\n";
    }
}

echo "== warn kinds ==\n";
$k = status_warn_kind('csp.violation', 'CSP blocked x');
sts('a known kind is titled in plain words', $k['known'] && $k['title'] === 'A browser blocked something on the site');
sts('csp is not the owner\'s to fix', $k['needs'] === false);
sts('a gave-up email needs the owner', status_warn_kind('email.gaveup')['needs'] === true);
$u = status_warn_kind('mystery.thing', 'Something odd happened');
sts('an unknown kind keeps its own summary', $u['title'] === 'Something odd happened' && !$u['known']);
sts('an unknown kind is never waved through', $u['needs'] === true);
$long = status_warn_kind('x', str_repeat('a', 120));
sts('a long summary is cut to 70', mb_strlen($long['title']) === 70 && str_ends_with($long['title'], '…'));
sts('an empty unknown still has a title', status_warn_kind('x', '')['title'] === 'A logged warning');

echo "== week ==\n";
$today = '2026-10-07';
$rows = [
    ['action' => 'csp.violation', 'summary' => '', 'day' => '2026-10-07'],
    ['action' => 'csp.violation', 'summary' => '', 'day' => '2026-10-07 10:00:00'],
    ['action' => 'csp.violation', 'summary' => '', 'day' => '2026-10-01'],
    ['action' => 'email.gaveup', 'summary' => '', 'day' => '2026-10-05'],
    ['action' => 'csp.violation', 'summary' => '', 'day' => '2026-09-30'], // 8 days ago: out
    ['action' => 'odd', 'summary' => 'A', 'day' => '2026-10-06'],
    ['action' => 'odd', 'summary' => 'B', 'day' => '2026-10-06'],
];
$w = status_week($rows, $today);
sts('seven days, oldest first, ending today', count($w['days']) === 7 && $w['days'][0]['date'] === '2026-10-01' && $w['days'][6]['date'] === '2026-10-07');
sts('a day is labelled by its weekday', $w['days'][6]['label'] === 'Wed');
sts('out-of-window rows are dropped', $w['total'] === 6);
sts('per-day counts', $w['days'][6]['n'] === 2 && $w['days'][0]['n'] === 1 && $w['days'][5]['n'] === 2);
sts('what needs you sorts first', $w['groups'][0]['needs'] === true);
sts('needs counts only needs-you groups', $w['needs'] === 3);
$csp = array_values(array_filter($w['groups'], fn($g) => $g['action'] === 'csp.violation'))[0];
sts('a group carries its count and per-day split', $csp['n'] === 3 && $csp['byDay'][6] === 2 && $csp['byDay'][0] === 1);
sts('unknown kinds with different summaries stay apart', count(array_filter($w['groups'], fn($g) => $g['action'] === 'odd')) === 2);
$empty = status_week([], $today);
sts('an empty week says nothing needs you', $empty['total'] === 0 && $empty['needs'] === 0 && $empty['groups'] === []);
$dst = status_week([], '2026-10-26');
sts('the week survives the clocks going back', $dst['days'][0]['date'] === '2026-10-20' && $dst['days'][6]['date'] === '2026-10-26');

echo "== daily ==\n";
$d = status_daily(['2026-10-07 01:00:00', '2026-10-07', '2026-10-03 09:00', '2026-09-01', 'junk'], $today);
sts('daily counts land on their day', $d === [0, 0, 1, 0, 0, 0, 2]);

echo "\n== Summary ==\n";
echo $stsFails ? "  $stsFails of $stsN FAILED ❌\n" : "  ALL $stsN CHECKS PASSED ✅\n";
exit($stsFails ? 1 : 0);
