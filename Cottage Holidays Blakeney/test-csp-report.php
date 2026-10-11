<?php
// ============================================================
//  test-csp-report.php — guards the CSP-report severity decision (csp-lib.php).
//  Dev/CI only, deploy-excluded. No DB, no HTTP, no clock: the whole point of the
//  lib is that the decision is a pure function of (directive, blocked-uri, policy),
//  and this drives it against the REAL live policy string and the EXACT reports
//  that prompted the work, plus a genuine attack that must stay 'warn'.
// ============================================================

require_once __DIR__ . '/csp-lib.php';

// --update regenerates csp-policy.php from htaccess.txt (the parity check below
// tells you to run it). Kept HERE rather than in a separate script so the
// generator and the assertion that uses it can never disagree.
$GEN = __DIR__ . '/csp-policy.php';
$GEN_TRIAL = __DIR__ . '/csp-trial.php';
$htRaw = (string) @file_get_contents(__DIR__ . '/htaccess.txt');
$livePolicy = $htRaw === '' ? null : csp_extract_policy($htRaw);
$trialPolicy = $htRaw === '' ? null : csp_extract_trial_policy($htRaw);
if (in_array('--update', $argv ?? [], true)) {
    if (!$livePolicy) {
        fwrite(STDERR, "cannot extract the CSP from htaccess.txt\n");
        exit(1);
    }
    // The rule on trial (Report-Only), or '' when none runs: the Status page reads it
    // to know whether to show the trial's findings.
    file_put_contents($GEN_TRIAL, "<?php\n"
        . "// AUTO-GENERATED from htaccess.txt — do NOT edit by hand.\n"
        . "// Regenerate:  php test-csp-report.php --update\n"
        . "//\n"
        . "// The Content-Security-Policy-Report-Only header (the narrower rule on trial),\n"
        . "// or '' when no trial runs. Read by diagnostics.php; parity is gated.\n"
        . 'return ' . var_export((string) $trialPolicy, true) . ";\n");
    file_put_contents($GEN, "<?php\n"
        . "// AUTO-GENERATED from htaccess.txt — do NOT edit by hand.\n"
        . "// Regenerate:  php test-csp-report.php --update\n"
        . "//\n"
        . "// csp-report.php needs the live policy to tell a genuine block from a\n"
        . "// stale-client straggler, and reading it from the filesystem at request\n"
        . "// time does not work in production: deploy.yml renames htaccess.txt to\n"
        . "// .htaccess, so only a dotfile remains and PHP may not be permitted to\n"
        . "// read it. An include always works. Parity with htaccess.txt is gated by\n"
        . "// test-csp-report.php, so this file cannot drift from the real header.\n"
        . 'return ' . var_export($livePolicy, true) . ";\n");
    echo "regenerated csp-policy.php and csp-trial.php\n";
    exit(0);
}

$fails = 0;
function ok($cond, $msg)
{
    global $fails;
    echo ($cond ? "  \xE2\x9C\x93 " : "  \xE2\x9C\x97 ") . $msg . "\n";
    if (!$cond) {
        $fails++;
    }
}

// The policy under test is the one actually shipped — read from htaccess.txt, the
// same source Apache serves — so this test cannot pass against a policy the site
// does not enforce. (csp-report.php reads .htaccess live; the string is identical.)
$polStr = $livePolicy;
ok(is_string($polStr) && $polStr !== '', 'the live CSP is extracted from htaccess.txt');
$P = $polStr ? csp_parse_policy($polStr) : [];
ok(isset($P['form-action']) && isset($P['connect-src']), 'policy parses into directives (form-action, connect-src present)');

// ---- The GENERATED policy must equal the real header, or the downgrade would be
// judging reports against a policy the site no longer serves.
$gen = is_file($GEN) ? include $GEN : null;
ok(is_string($gen) && $gen !== '', 'csp-policy.php exists and returns a string (run: php test-csp-report.php --update)');
ok($gen === $polStr, 'csp-policy.php matches the CSP in htaccess.txt (run: php test-csp-report.php --update)');

// ---- THE NARROWER RULE ON TRIAL (the security leftovers, Step 5). The enforced rule
// lets a page run anything on jsDelivr and cdnjs; the trial pins the six packages the
// site uses. These checks hold the trial to "the enforced rule, narrowed, and nothing
// else", and every address the code loads to being inside it.
$genTrial = is_file($GEN_TRIAL) ? include $GEN_TRIAL : null;
ok(is_string($genTrial), 'csp-trial.php exists and returns a string (run: php test-csp-report.php --update)');
ok($genTrial === (string) $trialPolicy, 'csp-trial.php matches the Report-Only header in htaccess.txt (run: php test-csp-report.php --update)');
$T = $trialPolicy ? csp_parse_policy($trialPolicy) : [];
ok($T !== [], 'a narrower rule is on trial (Content-Security-Policy-Report-Only)');
$WIDE = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'];
$DROPPED = ['https://tessdata.projectnaptha.com']; // tesseract.js 5 reads its language data from jsDelivr
$pinned = fn($s) => (bool) preg_match('#^https://(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)/.+/$#', $s);
$sameElse = true;
$why = [];
foreach ($P as $dir => $srcs) {
    if ($dir === 'upgrade-insecure-requests') {
        continue; // ignored in a Report-Only policy, so left out
    }
    if ($dir === 'report-uri') {
        continue;
    }
    $want = array_values(array_diff($srcs, $WIDE, $DROPPED));
    $got = array_values(array_filter($T[$dir] ?? ['(missing)'], fn($s) => !$pinned($s)));
    sort($want);
    sort($got);
    if ($want !== $got) {
        $sameElse = false;
        $why[] = $dir;
    }
}
ok($sameElse && count($T) === count($P) - 1, 'the trial is the enforced rule with only the two libraries narrowed (' . (implode(', ', $why) ?: 'every directive') . ')');
ok(($T['report-uri'] ?? []) === ['/csp-report.php?trial=1'], 'the trial reports to csp-report.php?trial=1, apart from real blocks');
$bare = 0;
foreach ($T as $srcs) {
    foreach ($srcs as $s) {
        $bare += in_array($s, $WIDE, true) ? 1 : 0;
    }
}
ok($bare === 0, 'no directive of the trial allows a whole library host');
$unversioned = array_filter(array_merge(...array_values($T)), fn($s) => $pinned($s) && !preg_match('#@v?\d+\.\d+\.\d+/|/\d+\.\d+\.\d+/|/@tesseract\.js-data/eng/$#', $s));
ok($unversioned === [], 'every pinned path names an exact version (' . implode(' ', $unversioned) . ')');
// Every library address the shipped code loads is inside the trial, so switching it on
// cannot break a feature. An updated library changes its address in the code, and this
// fails until the rule follows.
$cdnUrls = [];
foreach (['app.js', 'admin.js', 'guest-app.js'] as $f) {
    preg_match_all('#https://(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)/[^\'"`\s)]+#', (string) file_get_contents(__DIR__ . '/' . $f), $um);
    $cdnUrls = array_merge($cdnUrls, $um[0]);
}
$cdnUrls = array_values(array_unique($cdnUrls));
ok(count($cdnUrls) >= 7, '(the code\'s library addresses were found: ' . count($cdnUrls) . ')');
$outside = array_filter($cdnUrls, fn($u) => !csp_policy_permits($T, preg_match('/\.css$/', $u) ? 'style-src-elem' : 'script-src-elem', $u));
ok($outside === [], 'every library address in the code is allowed by the trial (' . implode(' ', $outside) . ')');
// What the libraries fetch at run time, measured in Chromium with the trial ENFORCED:
// all six worked with no violation.
$runtime = [
    ['script-src-elem', 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.1.1/dist/worker.min.js'],
    ['script-src-elem', 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.1/tesseract-core-simd-lstm.wasm.js'],
    ['connect-src', 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'],
    ['script-src-elem', 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.mjs'],
    ['connect-src', 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js'],
    ['connect-src', 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.wasm'],
    ['img-src', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png'],
    ['img-src', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png'],
];
$blockedRt = array_filter($runtime, fn($r) => !csp_policy_permits($T, $r[0], $r[1]));
ok($blockedRt === [], 'everything the libraries fetch at run time is allowed (' . implode(' ', array_column($blockedRt, 1)) . ')');
// …and what the narrowing is for: three addresses the enforced rule allows today.
foreach ([
    ['anyone\'s project on GitHub', 'https://cdn.jsdelivr.net/gh/anyone/anything@main/script.js'],
    ['an old library known for slipping past rules like these', 'https://cdnjs.cloudflare.com/ajax/libs/angular.js/1.8.2/angular.min.js'],
    ['our PDF maker from a different address', 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'],
] as [$what, $u]) {
    ok(csp_policy_permits($P, 'script-src-elem', $u) && !csp_policy_permits($T, 'script-src-elem', $u), "$what: allowed today, stopped by the trial");
}

// ---- The matcher reads paths and the newer sub-directives as browsers do.
$pp = csp_parse_policy("script-src https://cdn.example.com/lib/1.0/ https://cdn.example.com/one.js; worker-src blob:");
ok(csp_policy_permits($pp, 'script-src', 'https://cdn.example.com/lib/1.0/a/b.js?x=1'), 'a source ending in / allows everything under it');
ok(!csp_policy_permits($pp, 'script-src', 'https://cdn.example.com/lib/1.01/a.js'), '…and nothing beside it');
ok(csp_policy_permits($pp, 'script-src', 'https://cdn.example.com/one.js') && !csp_policy_permits($pp, 'script-src', 'https://cdn.example.com/one.js.map'), 'a source without the slash allows that file exactly');
ok(!csp_policy_permits($pp, 'script-src', 'https://cdn.example.com'), 'a report naming only the origin is not shown to sit under a pinned path');
ok(csp_policy_permits(csp_parse_policy('script-src https://cdn.example.com/npm/x@1.0.0/'), 'script-src', 'https://cdn.example.com/npm/x%401.0.0/y.js'), 'an encoded @ is read as @');
ok(csp_policy_permits($pp, 'script-src-elem', 'https://cdn.example.com/one.js'), 'script-src-elem falls back to script-src (what browsers report now)');
ok(csp_policy_permits(csp_parse_policy('child-src https://w.example.com'), 'worker-src', 'https://w.example.com/x.js') && csp_policy_permits(csp_parse_policy('script-src https://w.example.com'), 'worker-src', 'https://w.example.com/x.js'), 'worker-src falls back to child-src, then script-src');
ok(csp_policy_permits(csp_parse_policy("style-src 'self' https://s.example.com"), 'style-src-elem', 'https://s.example.com/a.css'), 'style-src-elem falls back to style-src');
ok(csp_policy_permits($pp, 'worker-src', 'blob:https://site.example/1') && !csp_policy_permits($pp, 'worker-src', 'https://cdn.example.com/one.js'), 'a stated worker-src is the one that applies');

// ---- Which trial reports are kept: only what the narrowing itself would stop.
ok(csp_trial_worth_recording('script-src-elem', 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', $P), 'a script the enforced rule allows but the trial stops is kept');
ok(!csp_trial_worth_recording('script-src-elem', 'https://evil.example.com/x.js', $P), 'a block the enforced rule also makes is not (it is reported already)');
ok(!csp_trial_worth_recording('script-src-elem', 'inline', $P) && !csp_trial_worth_recording('img-src', '', $P), 'inline and empty are not addresses');
ok(csp_trial_sig('script-src-elem', 'https://cdn.jsdelivr.net/gh/a/b@main/c.js?t=123') === 'script-src-elem → cdn.jsdelivr.net/gh/a/b@main/c.js', 'a trial report is known by its directive and address, without the query');
// Trial reports are machine reports: pruned and capped like the rest (two lists).
$noiseSrc = (string) file_get_contents(__DIR__ . '/activity-lib.php');
$cronSrc = (string) file_get_contents(__DIR__ . '/cron.php');
preg_match("/const ACTIVITY_NOISE_ACTIONS = \\[([^\\]]*)\\]/", $noiseSrc, $nm);
preg_match_all("/'([a-z.]+)'/", $nm[1] ?? '', $nn);
ok(in_array('csp.trial', $nn[1], true), 'csp.trial is a machine report in activity-lib.php');
ok(array_filter($nn[1], fn($a) => strpos($cronSrc, "'" . $a . "'") === false) === [], 'cron.php prunes every machine report the activity log reads apart');

// ---- RESOLUTION MUST SURVIVE THE PRODUCTION FILESYSTEM. This is the check whose
// absence let the first version ship broken: it read '.htaccess' with
// 'htaccess.txt' as a fallback, and deploy.yml RENAMES htaccess.txt to .htaccess —
// so live, the fallback is a 404 and the only source is a dotfile PHP may not be
// allowed to read. Recreate that layout in a temp dir: ONLY csp-policy.php, no
// htaccess of any kind. If resolution depends on reading a file that isn't there,
// this fails.
$tmp = sys_get_temp_dir() . '/chb-csp-' . getmypid();
@mkdir($tmp, 0777, true);
@copy($GEN, $tmp . '/csp-policy.php');
$prod = csp_live_policy($tmp);
ok(is_array($prod) && isset($prod['form-action']),
    'policy resolves with NO htaccess present at all (the real production layout)');
ok(is_array($prod) && csp_report_severity('form-action', 'https://methodurl.vcas.visa.com/x', $prod) === 'info',
    "…and the 3-D Secure straggler downgrades under that layout \xE2\x86\x92 info");
// …and with NOTHING at all it must fail SAFE (warn), never silently permit.
$empty = sys_get_temp_dir() . '/chb-csp-empty-' . getmypid();
@mkdir($empty, 0777, true);
ok(csp_live_policy($empty) === null, 'no policy source at all → null (never a permissive empty policy)');
ok(csp_report_severity('form-action', 'https://methodurl.vcas.visa.com/x', null) === 'warn',
    'a null policy fails SAFE — reports stay warn rather than being silently hidden');
@unlink($tmp . '/csp-policy.php');
@rmdir($tmp);
@rmdir($empty);

// ---- The two reports from the screenshot: both are things the CURRENT policy
// permits, so both can only be stale-client artifacts → 'info', not 'warn'. If
// either came back 'warn' the owner would keep being nagged by an old shell.
ok(csp_report_severity('form-action', 'https://methodurl.vcas.visa.com/DeviceFingerprint?id=688a69e24', $P) === 'info',
    "3-D Secure form-action to an https ACS is permitted now → info (was the nagging report)");
ok(csp_report_severity('connect-src', 'https://spay.samsung.com/', $P) === 'info',
    "the Samsung Pay probe host is allow-listed now → info");
ok(csp_report_severity('connect-src', 'https://google.com/pay', $P) === 'info',
    "Google Pay apex is allow-listed now → info");

// ---- A GENUINE block must still reach the owner. A host the live policy forbids
// is a real signal (a rogue resource, a CSP-stopped exfiltration) and stays 'warn'.
ok(csp_report_severity('connect-src', 'https://evil.example.com/steal', $P) === 'warn',
    "an un-allow-listed connect-src host stays warn (a real signal is never hidden)");
ok(csp_report_severity('script-src', 'https://evil.example.com/x.js', $P) === 'warn',
    'an un-allow-listed script-src host stays warn');

// ---- Scheme-sources are scheme-SPECIFIC. form-action is 'self' https:, so an
// http:// (insecure) form target is NOT permitted and stays warn — proving the
// downgrade is not a blanket "form-action is always fine".
ok(csp_report_severity('form-action', 'http://methodurl.vcas.visa.com/x', $P) === 'warn',
    'an http (insecure) form-action target is NOT permitted → warn');

// ---- Inline / eval / data are their own class regardless of policy.
ok(csp_report_severity('script-src-elem', 'inline', $P) === 'info', 'blocked inline → info');
ok(csp_report_severity('script-src', 'eval', $P) === 'info', 'blocked eval → info');
ok(csp_report_severity('img-src', '', $P) === 'info', 'empty blocked-uri → info');

// ---- Telemetry stays info even though we deliberately do NOT allow-list it (so a
// stale client that lacks it would report it, and an up-to-date one blocks+reports
// it too — either way it is noise, matched on host so a path lookalike can't sneak).
ok(csp_report_severity('connect-src', 'https://o160250.ingest.sentry.io/api/1/envelope', $P) === 'info',
    "Square's Sentry telemetry → info (matched on host)");
ok(csp_report_severity('connect-src', 'https://ingest.sentry.io.evil.com/x', $P) === 'warn',
    'a sentry.io lookalike in a different host stays warn (suffix match, not substring)');

// ---- form-action has NO default-src fallback: if the policy omitted it entirely,
// an https target must NOT be silently permitted by default-src 'self'.
$noFA = csp_parse_policy("default-src 'self'; connect-src https://ok.example.com");
ok(csp_policy_permits($noFA, 'connect-src', 'https://ok.example.com/x') === true,
    'connect-src source matches (host-source)');
ok(csp_policy_permits($noFA, 'connect-src', 'https://other.example.com/x') === false,
    'connect-src falls back to default-src (self) → external host not permitted');
ok(csp_policy_permits($noFA, 'form-action', 'https://anywhere.example.com/x') === false,
    'form-action does NOT fall back to default-src — absent directive never auto-permits');

// ---- Wildcard host matching: '*.google.com' matches a subdomain, not the apex.
$wild = csp_parse_policy('connect-src https://*.google.com');
ok(csp_policy_permits($wild, 'connect-src', 'https://pay.google.com/x') === true, "'*.google.com' matches a subdomain");
ok(csp_policy_permits($wild, 'connect-src', 'https://google.com/x') === false, "'*.google.com' does NOT match the bare apex");
ok(csp_policy_permits($wild, 'connect-src', 'https://evilgoogle.com/x') === false, "'*.google.com' does NOT match a suffix-spoof host");

// ---- DEPLOYMENT OBSERVABILITY. version.php?csp=1 must report what the deployed
// code actually resolves and decides — the thing whose absence made two inert CSP
// fixes indistinguishable from working ones. Drive the real endpoint.
// In a SUBPROCESS, not an include: version.php sends headers and exits, which
// would abort this run (it did — the suite silently stopped mid-way and printed no
// summary, which is exactly the kind of quiet skip these gates exist to prevent).
$probeRaw = (string) shell_exec(
    escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg('$_GET["csp"]=1; include "version.php";')
    . ' 2>/dev/null'
);
$probe = json_decode(trim($probeRaw), true);
ok(is_array($probe) && isset($probe['csp']), 'version.php?csp=1 returns a csp block');
// …and it still reports the build the deployed app.js carries, read from the
// file's tail now rather than the whole 1MB bundle.
$appBuild = preg_match("/const BUILD = '([^']+)'/", (string) file_get_contents(__DIR__ . '/app.js'), $bm) ? $bm[1] : '';
ok($appBuild !== '' && is_array($probe) && ($probe['build'] ?? '') === $appBuild, 'version.php reports app.js\'s BUILD (' . $appBuild . ')');
ok(($probe['csp']['lib'] ?? false) === true, 'it reports csp-lib.php is present');
ok(($probe['csp']['source'] ?? '') === 'csp-policy.php',
    'it names the policy SOURCE it actually used (' . ($probe['csp']['source'] ?? '?') . ')');
ok(($probe['csp']['probe']['3ds'] ?? '') === 'info' && ($probe['csp']['probe']['samsung'] ?? '') === 'info',
    'it reports how THIS deploy would grade the two nagging reports (info)');
ok(($probe['csp']['probe']['evil'] ?? '') === 'warn',
    '…and that a genuine block would still be warn');
ok(($probe['csp']['trial'] ?? null) === true, 'it says the narrower rule is on trial in this deploy');
ok(!str_contains(strtolower($probeRaw), 'password') && !str_contains($probeRaw, 'DB_'),
    'the diagnostic leaks no configuration');

echo $fails ? "\n  $fails CSP-REPORT CHECK(S) FAILED \xE2\x9D\x8C\n" : "\n  CSP-REPORT SUITE PASSED \xE2\x9C\x85\n";
exit($fails ? 1 : 0);
