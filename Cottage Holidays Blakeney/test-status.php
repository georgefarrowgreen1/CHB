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

echo "== PHP version (PHP2Shell, 21/10/2026) ==\n";
// The Status card shows a detail's first sentence (admin.js spFirstSentence) and a row
// lists an ok detail of 26 characters or fewer as its note (spNote): both said here.
$first = fn($t) => preg_replace('/[:.]$/', '', preg_split('/(?<=[.:])\s| — /', (string) $t)[0]);
$note = fn($t) => mb_strlen(preg_replace('/\.$/', '', trim((string) $t))) <= 26;
$wa = ['off' => false, 'file' => true, 'reads' => true, 'ttl' => 300];
$row = function (array $rows, string $label) {
    foreach ($rows as $r) {
        if ($r[0] === $label) {
            return $r;
        }
    }
    return null;
};
foreach (STATUS_PHP_FIXED as $branch => $fix) {
    [$maj, $min] = array_map('intval', explode('.', (string) $branch));
    $before = status_php_rows($maj, $min, $fix - 1, $wa);
    $at = status_php_rows($maj, $min, $fix, $wa);
    sts("$branch." . ($fix - 1) . " needs the update and $branch.$fix has it", $before[0][1] === 'fail' && $at[0][1] === 'ok' && status_php_patched($maj, $min, $fix + 5) === true);
}
sts('the fixed releases are the ones PHP published', STATUS_PHP_FIXED === ['8.2' => 35, '8.3' => 36, '8.4' => 27, '8.5' => 12]);
$r = status_php_rows(8, 3, 35, $wa);
sts('the card says what is missing, from whom, and why, in its first sentence', $first($r[0][2]) === 'PHP 8.3.35 needs IONOS to update it to 8.3.36, the release that fixes two critical flaws announced on 21/10/2026');
$ok = status_php_rows(8, 3, 36, $wa);
sts('with the fix it is one row, short enough to be its own note', count($ok) === 1 && $ok[0] === ['PHP version', 'ok', 'PHP 8.3.36 has the fix.'] && $note($ok[0][2]) && $note('PHP 8.10.100 has the fix.'));
sts('a newer branch than any listed has the fix', status_php_patched(8, 6, 0) === true && status_php_patched(9, 0, 0) === true && status_php_rows(8, 6, 0, $wa)[0][1] === 'ok');
$eol = status_php_rows(8, 1, 33, $wa);
sts('a branch with no fix at all says to choose a newer PHP', status_php_patched(8, 1, 33) === null && status_php_patched(7, 4, 33) === null && $eol[0][1] === 'fail' && $first($eol[0][2]) === 'PHP 8.1.33 gets no security fixes any more, so choose PHP 8.3 or newer in the IONOS control panel');
sts('…and still says whether the workaround is in force', $row($eol, 'PHP workaround') !== null);
sts('no workaround row once PHP has the fix', $row($ok, 'PHP workaround') === null);
$w = $row(status_php_rows(8, 3, 35, ['off' => true] + $wa), 'PHP workaround');
sts('the workaround in force is ok, and its note fits', $w[1] === 'ok' && $note($w[2]));
$w = $row(status_php_rows(8, 3, 35, ['file' => false] + $wa), 'PHP workaround');
sts('a missing settings file is named', $w[1] === 'warn' && strpos($first($w[2]), '.user.ini') !== false);
$w = $row(status_php_rows(8, 3, 35, ['reads' => false] + $wa), 'PHP workaround');
sts('a PHP that does not read it sends the owner to IONOS', $w[1] === 'warn' && strpos($first($w[2]), 'ask IONOS to switch off session.upload_progress') !== false);
$w = $row(status_php_rows(8, 3, 35, $wa), 'PHP workaround');
$w1 = $row(status_php_rows(8, 3, 35, ['ttl' => 60] + $wa), 'PHP workaround');
sts('…and one that reads it but has not yet says how long it takes', $w[1] === 'warn' && strpos($w[2], 'up to 5 minutes') !== false && strpos($w1[2], 'up to 1 minute after') !== false);
$all = array_merge(status_php_rows(8, 3, 35, $wa), status_php_rows(8, 1, 33, ['reads' => false] + $wa), status_php_rows(8, 3, 35, ['file' => false] + $wa));
sts('every warning is one sentence, so the card shows all of it', array_reduce($all, fn($c, $x) => $c && $x[1] === 'ok' || $c && $first($x[2]) . '.' === $x[2], true));

echo "== PHP version: the wiring and the workaround file ==\n";
$dg = preg_replace('#^\s*//[^\n]*#m', '', (string) file_get_contents(__DIR__ . '/diagnostics.php'));
sts('Status reads the PHP running the site', strpos($dg, 'status_php_rows(PHP_MAJOR_VERSION, PHP_MINOR_VERSION, PHP_RELEASE_VERSION') !== false);
sts('…whether upload progress is off, the file, whether this PHP reads it and how long it caches it', strpos($dg, "ini_get('session.upload_progress.enabled')") !== false && strpos($dg, "is_file(__DIR__ . '/.user.ini')") !== false && strpos($dg, "ini_get('user_ini.filename') === '.user.ini'") !== false && strpos($dg, "ini_get('user_ini.cache_ttl')") !== false);
sts('…and lists the rows under Security', preg_match("/foreach \(\\\$phpRows as \[\\\$phpLabel, \\\$phpStatus, \\\$phpDetail\]\) \{\s*add\(\\\$checks, 'Security', \\\$phpLabel, \\\$phpStatus, \\\$phpDetail\);/", $dg) === 1);
$ini = @parse_ini_file(__DIR__ . '/.user.ini');
sts('.user.ini switches session upload progress off', is_array($ini) && array_key_exists('session.upload_progress.enabled', $ini) && in_array($ini['session.upload_progress.enabled'], ['', '0'], true));
$ht = (string) file_get_contents(__DIR__ . '/htaccess.txt');
preg_match_all('/<FilesMatch "(\(\^config\\\\\.php[^"]*)">/', $ht, $fm);
$deniesAll = count($fm[1]) === 2;
foreach ($fm[1] as $p) {
    $deniesAll = $deniesAll && preg_match('/' . str_replace('/', '\/', $p) . '/', '.user.ini') === 1 && preg_match('/' . str_replace('/', '\/', $p) . '/', 'php.ini') === 1 && preg_match('/' . str_replace('/', '\/', $p) . '/', 'config.php') === 1 && preg_match('/' . str_replace('/', '\/', $p) . '/', 'index.html') === 0;
}
sts('a browser cannot read it: both deny rules refuse .user.ini and php.ini (' . count($fm[1]) . ' rules)', $deniesAll);
$dy = (string) file_get_contents(__DIR__ . '/../.github/workflows/deploy.yml');
sts('the deploy ships it: both steps copy the top folder\'s dotfiles, and nothing strips it', substr_count($dy, 'cp -r "$SRC"/. "$OUT"/') === 2 && strpos($dy, 'user.ini') === false);
// Using the feature means a form field named PHP_SESSION_UPLOAD_PROGRESS (its default
// name) and reading the upload_progress_* session keys it writes.
$uses = [];
$scanned = 0;
foreach (array_merge(glob(__DIR__ . '/*.php'), glob(__DIR__ . '/*.js'), glob(__DIR__ . '/*.html')) as $f) {
    if (strpos(basename($f), 'test-') === 0 || strpos(basename($f), 'ui-test') === 0) {
        continue;
    }
    $scanned++;
    if (preg_match('/PHP_SESSION_UPLOAD_PROGRESS|upload_progress_/', (string) file_get_contents($f))) {
        $uses[] = basename($f);
    }
}
sts('nothing on the site uses session upload progress, so switching it off changes nothing (' . $scanned . ' files; ' . implode(', ', $uses) . ')', $scanned > 100 && $uses === []);

echo "\n== Summary ==\n";
echo $stsFails ? "  $stsFails of $stsN FAILED ❌\n" : "  ALL $stsN CHECKS PASSED ✅\n";
exit($stsFails ? 1 : 0);
