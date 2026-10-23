<?php
// ============================================================
//  test-perf.php — real visitors' speed (perf-lib.php) driven whole: no database,
//  no browser, no clock.
//
//  What it holds: a sample keeps only figures in range and nothing personal; whose
//  page it was comes from the session, never the request; the percentiles are the
//  nearest-rank ones; a figure is judged only with enough visits; the Status check
//  warns only for a poor figure. The endpoint, the roll-up and the Status read run
//  for real in test-integration §103; the wiring scans at the foot catch a reverted
//  call where there is no database. CI-wired, deploy-excluded. The counter is pfc():
//  PHPStan reads every test file as one set.
// ============================================================
require_once __DIR__ . '/perf-lib.php';

$pfFail = 0;
$pfN = 0;
function pfc(string $name, bool $cond): void
{
    global $pfFail, $pfN;
    $pfN++;
    echo '  ' . ($cond ? "\u{2713}" : "\u{2717}") . " $name\n";
    if (!$cond) {
        $pfFail++;
    }
}

echo "\n-- device and browser, from the browser string (only the letter is kept) --\n";
$UA = [
    'iphone' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    'iphone-app' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'iphone-chrome' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
    'ipad' => 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    'android' => 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
    'android-tab' => 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'samsung' => 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
    'mac-safari' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
    'mac-chrome' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'edge' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.3351.95',
    'firefox' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
    'opera' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 OPR/120.0.0.0',
];
$want = [
    'iphone' => ['p', 's'], 'iphone-app' => ['p', 's'], 'iphone-chrome' => ['p', 'c'], 'ipad' => ['t', 's'],
    'android' => ['p', 'c'], 'android-tab' => ['t', 'c'], 'samsung' => ['p', 'a'], 'mac-safari' => ['d', 's'],
    'mac-chrome' => ['d', 'c'], 'edge' => ['d', 'e'], 'firefox' => ['d', 'f'], 'opera' => ['d', 'o'],
];
foreach ($want as $k => [$dev, $br]) {
    pfc("$k: device $dev, browser $br", perf_device($UA[$k]) === $dev && perf_browser($UA[$k]) === $br);
}
pfc('no browser string: a computer and another browser', perf_device('') === 'd' && perf_browser('') === 'o');

echo "\n-- a sample keeps only figures in range, and nothing personal --\n";
$s = perf_sample_clean(['ttfb' => 210, 'fcp' => 812.4, 'lcp' => 1460, 'shown' => 812, 'ready' => 2410, 'inp' => 96, 'cls' => 42, 'land' => 'h', 'early' => true, 'pwa' => false], $UA['iphone'], 'v');
pfc('a full sample is kept, times rounded to whole milliseconds', $s !== null && $s['fcp'] === 812 && $s['ready'] === 2410 && $s['cls'] === 42);
pfc('it says a visitor on an iPhone in Safari, landing on home, the page written early', $s !== null && $s['kind'] === 'v' && $s['device'] === 'p' && $s['browser'] === 's' && $s['land'] === 'h' && $s['early'] === 1 && $s['pwa'] === 0);
$keys = $s !== null ? array_keys($s) : [];
sort($keys);
$allowed = ['browser', 'cls', 'device', 'early', 'fcp', 'inp', 'kind', 'land', 'lcp', 'pwa', 'ready', 'shown', 'ttfb'];
pfc('nothing else is kept: no address, no browser string, no page', $keys === $allowed);
$t = perf_sample_clean(['kind' => 'o', 'ttfb' => 100, 'ip' => '1.2.3.4', 'path' => '/cottages/x', 'ua' => 'x'], $UA['iphone'], 'v');
pfc('a "kind" in the request is ignored: whose page it was is the session\'s word', $t !== null && $t['kind'] === 'v');
pfc('…and so are an address, a page and a browser string sent by the page', $t !== null && !array_key_exists('ip', $t) && !array_key_exists('path', $t) && !array_key_exists('ua', $t));
pfc('an unknown kind from the session reads as a visitor', (perf_sample_clean(['ttfb' => 1], '', 'x') ?? [])['kind'] === 'v');
pfc('the back office and a guest keep their own kind', (perf_sample_clean(['ttfb' => 1], '', 'o') ?? [])['kind'] === 'o' && (perf_sample_clean(['ttfb' => 1], '', 'g') ?? [])['kind'] === 'g');
$b = perf_sample_clean(['ttfb' => -5, 'fcp' => 60001, 'lcp' => '900', 'shown' => [1], 'ready' => true, 'inp' => null, 'cls' => 10001, 'land' => 'z', 'early' => 1, 'pwa' => 'yes'], '', 'v');
pfc('every out-of-range, text, list or yes/no figure is dropped, so the sample is refused', $b === null);
$c = perf_sample_clean(['ready' => 120000, 'cls' => 0, 'land' => 'z', 'early' => 1], '', 'v');
pfc('the largest kept values and a layout shift of 0 are kept', $c !== null && $c['ready'] === 120000 && $c['cls'] === 0);
pfc('an unknown place reads as "other"; "early" must be true itself', $c !== null && $c['land'] === 'o' && $c['early'] === 0);
pfc('a sample with no figure at all is refused', perf_sample_clean(['land' => 'h', 'early' => true], $UA['iphone'], 'v') === null);
pfc('NaN and infinity never reach a row', perf_sample_clean(['fcp' => NAN, 'lcp' => INF], '', 'v') === null);

echo "\n-- the percentiles (nearest rank) and the good/poor lines --\n";
$ten = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
$sorted = $ten;
sort($sorted);
pfc('of 1..10: half 5, three in four 8, nine in ten 9, all 10', perf_pct($sorted, 50) === 5 && perf_pct($sorted, 75) === 8 && perf_pct($sorted, 90) === 9 && perf_pct($sorted, 100) === 10);
pfc('one value is every percentile; none is 0', perf_pct([42], 75) === 42 && perf_pct([], 75) === 0);
$sm = perf_summarise('inp', [200, 201, 500, 501, 50, 120]);
pfc('a figure ON the good line is good, ON the poor line is not poor', $sm['good'] === 3 && $sm['poor'] === 1 && $sm['n'] === 6);
pfc('the summary sorts before it ranks', $sm['p50'] === 200 && $sm['p75'] === 500 && $sm['p90'] === 501);
pfc('rates: 200ms good, 201 could be faster, 500 still, 501 poor', perf_rate('inp', 200) === 'good' && perf_rate('inp', 201) === 'mid' && perf_rate('inp', 500) === 'mid' && perf_rate('inp', 501) === 'poor');
pfc('layout shift is judged x1000: 0.10 good, 0.26 poor', perf_rate('cls', 100) === 'good' && perf_rate('cls', 260) === 'poor');
pfc('said as people read them', perf_say('shown', 812) === '812ms' && perf_say('shown', 2410) === '2.4s' && perf_say('cls', 42) === '0.04');

echo "\n-- the groups and the week, judged --\n";
$row = fn(string $kind, string $dev, array $f) => array_merge(['kind' => $kind, 'device' => $dev], array_fill_keys(array_keys(PERF_METRICS), null), $f);
pfc('the back office is one group; a visitor or guest is a phone or a computer', perf_group('o', 'p') === 'bo' && perf_group('v', 'p') === 'sp' && perf_group('g', 'p') === 'sp' && perf_group('v', 't') === 'sc' && perf_group('g', 'd') === 'sc');
[$vals, $views] = perf_bucket([$row('v', 'p', ['shown' => 900, 'ready' => 2000]), $row('v', 'p', ['inp' => 80]), $row('o', 'd', ['ready' => 3000, 'inp' => 300])]);
pfc('a later stretch with only a tap is not counted as a visit', ($views['sp'] ?? 0) === 1 && ($views['bo'] ?? 0) === 1);
pfc('each figure lands in its own group', ($vals['sp']['shown'] ?? []) === [900] && ($vals['sp']['inp'] ?? []) === [80] && ($vals['bo']['inp'] ?? []) === [300]);

$few = perf_judge($vals, $views);
pfc('below the minimum a figure is shown but not judged, and nothing is claimed', $few['judged'] === false && $few['groups']['sp']['tone'] === 'few' && $few['groups']['sp']['figs']['shown']['rate'] === null);
pfc('every group is listed in the Status order, even with no visits', array_keys($few['groups']) === ['sp', 'sc', 'bo'] && $few['groups']['sc']['views'] === 0);

$fast = [];
for ($i = 0; $i < PERF_MIN_N; $i++) {
    $fast[] = $row('v', 'p', ['shown' => 800 + $i, 'lcp' => 1500, 'ready' => 2000, 'inp' => 90, 'cls' => 20]);
}
[$fv, $fw] = perf_bucket($fast);
$j = perf_judge($fv, $fw);
pfc('at the minimum a phone week of good figures is "fast" and judged', $j['judged'] === true && $j['groups']['sp']['tone'] === 'fast' && !$j['poor']);
pfc('…and the Status sentence says so', $j['sentence'] === 'Fast for real visitors this week.');
$mid = $fast;
foreach ($mid as &$m) {
    $m['inp'] = 300;
}
unset($m);
[$mv, $mw] = perf_bucket($mid);
pfc('one figure past the good line makes the group "could be faster", never a warning', perf_judge($mv, $mw)['groups']['sp']['tone'] === 'mid' && !perf_judge($mv, $mw)['poor']);
$slow = $fast;
foreach ($slow as $k => &$m) {
    $m['shown'] = $k < 5 ? 900 : 3400; // 3 in 4 slower than the poor line
}
unset($m);
[$sv, $sw] = perf_bucket($slow);
$js = perf_judge($sv, $sw);
pfc('a poor three-in-four makes the group "slow" and names the figure', $js['groups']['sp']['tone'] === 'slow' && $js['poor'] && $js['poor'][0][0] === 'sp' && $js['poor'][0][1] === 'shown');
pfc('…in words the owner can repeat', $js['sentence'] === 'For visitors on phones, pages appeared in 3.4s or longer for 1 in 4 visits this week.');
$bo = [];
for ($i = 0; $i < PERF_MIN_N; $i++) {
    $bo[] = $row('o', 'd', ['ready' => 2500, 'inp' => 650]);
}
[$bv, $bw] = perf_bucket($bo);
$jb = perf_judge($bv, $bw);
pfc('a slow back office is said as such', $jb['groups']['bo']['tone'] === 'slow' && $jb['sentence'] === 'In your back office, a tap was answered in 650ms or longer for 1 in 4 visits this week.');
pfc('the back office is judged on its own figures only (no page or picture figures)', !isset($jb['groups']['bo']['figs']['shown']) && isset($jb['groups']['bo']['figs']['inp']));

echo "\n-- the wiring (where there is no database to run it) --\n";
$code = function (string $f): string {
    $s = (string) file_get_contents(__DIR__ . '/' . $f);
    return (string) preg_replace('~^\s*//.*$~m', '', $s);
};
$pp = $code('perf.php');
pfc('perf.php reads whose page it was from the session', preg_match("/\\\$kind = !empty\\(\\\$_SESSION\\['admin_id'\\]\\) \\? 'o' : \\(!empty\\(\\\$_SESSION\\['guest_id'\\]\\) \\? 'g' : 'v'\\)/", $pp) === 1);
pfc('…never from the request', strpos($pp, "\$in['kind']") === false);
pfc('…takes only a POST, and reads at most 2KB', strpos($pp, "!== 'POST'") !== false && strpos($pp, "file_get_contents('php://input', false, null, 0, 2048)") !== false);
pfc('…keeps a sample only under both the hourly cap and the per-address cap', preg_match('/\$all < PERF_ALL_PER_HOUR && rate_allow\(\'perf\', PERF_IP_PER_HOUR, 60\)\)\s*\{\s*perf_record\(\$row\);/', $pp) === 1);
$mig = (string) file_get_contents(__DIR__ . '/migration-150-perf.sql');
pfc('the table holds no address, browser string or page', !preg_match('/\b(ip|ip_hash|ua|user_agent|path|referrer|email|session)\b/i', (string) preg_replace('~--.*$~m', '', $mig)));
$sr = $code('self-repair.php');
pfc('the daily job sums the finished days', strpos($sr, 'perf_rollup()') !== false);
$dg = $code('diagnostics.php');
pfc('Status adds the check only once something is judged, and warns only for a poor figure', preg_match("/if \(\\\$perf && \\\$perf\['judged'\]\) \{\s*add\(\\\$checks, 'Website', 'Real visitors', \\\$perf\['poor'\] \? 'warn' : 'ok', \\\$perf\['sentence'\]\);/", $dg) === 1);
$app = $code('app.js');
pfc('a preview frame sends nothing', preg_match('/function chbPerfSend\(\)\s*\{[^}]*if \(PREVIEW_MODE \|\| !navigator\.sendBeacon\) return;/s', $app) === 1);
pfc('the page sends by beacon to perf.php', strpos($app, "navigator.sendBeacon(API_BASE + 'perf.php'") !== false);
pfc('"ready" is marked when the app takes over, "shown" when the cover lifts', preg_match("/__revealed = true;\s*chbPerfMark\('ready'\);/", $app) === 1 && preg_match("/classList\.add\('hero-go'\);\s*chbPerfMark\('shown'\);/", $app) === 1);
pfc('a load figure after the page was first hidden is not sent', strpos($app, "const before = (t) => (t != null && t < P.hid ? t : null);") !== false && strpos($app, "put('fcp', before(P.fcp), 60000);") !== false);

echo $pfFail ? "\n  $pfFail of $pfN SPEED CHECK(S) FAILED \u{274C}\n" : "\n  ALL $pfN SPEED CHECKS PASSED \u{2705}\n";
exit($pfFail ? 1 : 0);
