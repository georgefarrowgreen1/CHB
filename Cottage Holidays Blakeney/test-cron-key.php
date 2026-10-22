<?php
// ============================================================
//  test-cron-key.php — the scheduled jobs' own key (cron-lib.php). Dev/CI only,
//  deploy-excluded. No database, no web server: the decisions are pure, the deploy's
//  derivation is run with the real openssl, and the rest are source scans that keep
//  the master key out of every address.
// ============================================================

define('APP_SECRET', 'test-master-key-0123456789abcdef-not-real');
require_once __DIR__ . '/cron-lib.php';

$fails = 0;
$passes = 0;
function ckc($cond, $msg)
{
    global $fails, $passes;
    echo ($cond ? "  \xE2\x9C\x93 " : "  \xE2\x9C\x97 ") . $msg . "\n";
    if ($cond) {
        $passes++;
    } else {
        $fails++;
    }
}
// Source with comments removed, so a scan never reads its own explanation.
// The code without its comments, found by PHP's own tokenizer: a pattern read
// glob(__DIR__ . '/*.php') in db.php as a comment opener and dropped everything up to
// the next '*/', cron_request_ok included.
function ckc_code(string $file): string
{
    $out = '';
    foreach (token_get_all((string) @file_get_contents(__DIR__ . '/' . $file)) as $t) {
        if (is_array($t) && ($t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT)) {
            continue;
        }
        $out .= is_array($t) ? $t[1] : $t;
    }
    return $out;
}

echo "\n== The job key ==\n";
$key = cron_key();
$expect = substr(hash_hmac('sha256', 'cron|v1', APP_SECRET), 0, 40);
ckc($key === $expect, 'the job key is HMAC-SHA256 of "cron|v1" under APP_SECRET, first 40 hex');
ckc(preg_match('/^[0-9a-f]{40}$/', $key) === 1, 'it is 40 hex characters, safe in a path or a header');
ckc($key !== APP_SECRET && strpos($key, APP_SECRET) === false && strpos(APP_SECRET, $key) === false, 'it is not the master key, nor a piece of it');
ckc(cron_key() === $key, 'it is the same every time (the scheduler keeps one address)');

// CRON_SECRET from config.php, in a separate PHP each time (a constant is defined once).
$withConfig = function (string $defines) {
    $code = $defines . ' require ' . var_export(__DIR__ . '/cron-lib.php', true) . '; echo cron_key();';
    return (string) shell_exec(escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg($code) . ' 2>&1');
};
$own = 'my-own-job-key-that-is-long-enough';
ckc($withConfig("define('APP_SECRET', 'm'); define('CRON_SECRET', '$own');") === $own, 'CRON_SECRET from config.php is the job key when it is set');
ckc($withConfig("define('APP_SECRET', 'm'); define('CRON_SECRET', 'short');") === substr(hash_hmac('sha256', 'cron|v1', 'm'), 0, 40), '…but not when it is under 20 characters');
ckc($withConfig("define('APP_SECRET', 'the-master-key-is-long-enough'); define('CRON_SECRET', 'the-master-key-is-long-enough');") === substr(hash_hmac('sha256', 'cron|v1', 'the-master-key-is-long-enough'), 0, 40), '…nor when it is the master key itself');
ckc($withConfig('') === '', 'with no APP_SECRET at all there is no job key (never a key anyone could work out)');

echo "\n== The workflows work out the same key (.github/scripts/site-job.sh) ==\n";
// The deploy's post-deploy steps and the server file check all source site-job.sh, which
// works the key out in bash: run it, and hold it equal to cron_key() case by case.
$lib = __DIR__ . '/../.github/scripts/site-job.sh';
$sourced = function (array $env, string $then) use ($lib): string {
    $e = '';
    foreach ($env as $k => $v) {
        $e .= $k . '=' . escapeshellarg($v) . ' ';
    }
    $script = '. ' . escapeshellarg($lib) . '; ' . $then;
    return (string) shell_exec('env -i PATH=' . escapeshellarg((string) getenv('PATH')) . ' ' . $e . 'bash -c ' . escapeshellarg($script) . ' 2>/dev/null');
};
$keyOf = fn(array $env) => trim(preg_replace('/^::add-mask::.*$/m', '', $sourced($env, 'printf "%s" "$KEY"')));
$bash = $keyOf(['APP_SECRET' => APP_SECRET]);
ckc($bash === $key, 'site-job.sh works out exactly cron_key() from APP_SECRET (' . ($bash === '' ? 'no output — is openssl installed?' : ($bash === $key ? 'same' : 'it differs')) . ')');
ckc($keyOf(['APP_SECRET' => 'm', 'CRON_SECRET' => $own]) === $own, '…CRON_SECRET when it is set');
ckc($keyOf(['APP_SECRET' => 'm', 'CRON_SECRET' => 'short']) === substr(hash_hmac('sha256', 'cron|v1', 'm'), 0, 40), '…but not when it is under 20 characters, as the PHP');
ckc($keyOf(['APP_SECRET' => 'the-master-key-is-long-enough', 'CRON_SECRET' => 'the-master-key-is-long-enough']) === substr(hash_hmac('sha256', 'cron|v1', 'the-master-key-is-long-enough'), 0, 40), '…nor when it is the master key itself');
ckc($keyOf([]) === '', 'with no APP_SECRET there is no key at all');
ckc(strpos($sourced(['APP_SECRET' => APP_SECRET], 'true'), '::add-mask::' . $key) !== false, 'it masks the key, because this repository\'s logs are public');
ckc(strpos((string) file_get_contents($lib), 'X-CHB-Cron: $KEY') !== false, 'it sends the key in the X-CHB-Cron header');
$deploy = (string) @file_get_contents(__DIR__ . '/../.github/workflows/deploy.yml');
$check = (string) @file_get_contents(__DIR__ . '/../.github/scripts/server-check.sh');
ckc(substr_count($deploy, '. .github/scripts/site-job.sh') === 2 && strpos($check, 'site-job.sh') !== false, 'the live and staging post-deploy steps and the server check all use it');
$wfAll = '';
foreach (glob(__DIR__ . '/../.github/workflows/*.yml') ?: [] as $wf) {
    $wfAll .= (string) file_get_contents($wf);
}
ckc(strpos($wfAll, 'openssl dgst') === false && strpos($wfAll, 'X-CHB-Cron') === false, '…and no workflow works the key out, or asks for a job, any other way');
ckc(preg_match('/cron=\$\{?APP_SECRET\}?|cron=\$\{\{\s*secrets\.(STAGING_)?APP_SECRET/', $wfAll . $check) === 0, 'no address in a workflow carries APP_SECRET');

// site-job.sh's job() run in bash against a stand-in curl, which logs each call and
// answers the next status code in a scripted sequence ("fail" = no answer at all). The key
// may move into the address only after a 401 or 403: a timeout or a 5xx is not retried,
// because the job may still be running (a second migrate beside the first).
$fake = sys_get_temp_dir() . '/chb-cronkey-' . getmypid();
@mkdir($fake, 0700, true);
file_put_contents($fake . '/curl', "#!/bin/bash\n"
    . "printf '%s\\n' \"\$*\" >> \"\$FAKE/calls\"\n"
    . "n=\$(( \$(cat \"\$FAKE/n\" 2>/dev/null || echo 0) + 1 )); echo \$n > \"\$FAKE/n\"\n"
    . "code=\$(echo \"\$FAKE_CODES\" | cut -d' ' -f\$n)\n"
    . "out=''; while [ \$# -gt 0 ]; do [ \"\$1\" = -o ] && out=\"\$2\"; shift; done\n"
    . "if [ \"\$code\" = fail ]; then printf 000; exit 28; fi\n"
    . "[ -n \"\$out\" ] && printf 'job answered %s' \"\$code\" > \"\$out\"\n"
    . "printf '%s' \"\$code\"\n");
chmod($fake . '/curl', 0700);
$runJob = function (string $codes, string $call = "job 60 'migrate.php?cron'") use ($fake, $lib): array {
    @unlink($fake . '/calls');
    @unlink($fake . '/n');
    $script = '. ' . escapeshellarg($lib) . "\n" . $call . "; echo \"rc=\$?\"\n";
    $env = 'PATH=' . escapeshellarg($fake . ':' . getenv('PATH')) . ' FAKE=' . escapeshellarg($fake) . ' FAKE_CODES=' . escapeshellarg($codes)
        . ' RUNNER_TEMP=' . escapeshellarg($fake) . ' APP_SECRET=' . escapeshellarg(APP_SECRET) . ' SITE_URL=https://example.co.uk';
    $out = (string) shell_exec($env . ' bash -c ' . escapeshellarg($script) . ' 2>&1');
    $calls = array_values(array_filter(explode("\n", (string) @file_get_contents($fake . '/calls'))));
    preg_match('/rc=(\d+)/', $out, $rc);
    return ['calls' => $calls, 'rc' => (int) ($rc[1] ?? -1), 'out' => $out];
};
$r = $runJob('200');
ckc(count($r['calls']) === 1 && strpos($r['calls'][0], 'X-CHB-Cron: ' . $key) !== false && strpos($r['calls'][0], 'example.co.uk/migrate.php?cron=header') !== false && strpos($r['calls'][0], 'cron=' . $key) === false && $r['rc'] === 0, 'a job is asked once, the key in the header and a placeholder in the address (' . count($r['calls']) . ' call, rc ' . $r['rc'] . ')');
ckc(strpos($r['out'], 'job answered 200') !== false, '…and its answer is printed to the log');
foreach (['401', '403'] as $refused) {
    $r = $runJob($refused . ' 200');
    $second = $r['calls'][1] ?? '';
    ckc(count($r['calls']) === 2 && strpos($second, 'migrate.php?cron=' . $key) !== false && strpos($second, 'X-CHB-Cron') === false && $r['rc'] === 0, "a $refused (the header dropped) is asked once more with the job key in the address (" . count($r['calls']) . ' calls, rc ' . $r['rc'] . ')');
}
foreach (['500' => 'a 500', 'fail' => 'no answer (a timeout)'] as $codes => $what) {
    $r = $runJob($codes . ' 200');
    ckc(count($r['calls']) === 1 && $r['rc'] !== 0, "$what is not asked again, and the step says it failed (" . count($r['calls']) . ' call, rc ' . $r['rc'] . ')');
}
$r = $runJob('401 401');
ckc(count($r['calls']) === 2 && $r['rc'] !== 0, 'refused both ways: two calls and a failure, never a third (' . count($r['calls']) . ' calls)');
$r = $runJob('200', "job 30 'server-check.php?cron' -X POST --data-binary @/dev/null");
ckc(count($r['calls']) === 1 && strpos($r['calls'][0], '-X POST --data-binary @/dev/null') !== false && strpos($r['calls'][0], 'server-check.php?cron=header') !== false, 'anything after the path reaches curl (the server check posts what it found)');
array_map('unlink', glob($fake . '/*') ?: []);
@rmdir($fake);

echo "\n== Who a request is ==\n";
$s = fn(array $server = [], array $get = [], bool $path = false) => cron_auth($server, $get, $path);
ckc($s(['HTTP_X_CHB_CRON' => $key]) === 'key', 'the job key in the X-CHB-Cron header is the scheduler');
ckc($s([], ['cron' => $key]) === 'key', 'the job key in ?cron= is the scheduler');
ckc($s(['PATH_INFO' => '/' . $key], [], true) === 'key', 'the job key as cron.php/<key> is the scheduler');
ckc($s(['PATH_INFO' => '/' . $key], [], false) === '', '…but a path is only read where the caller allows it (cron.php)');
ckc($s([], ['cron' => APP_SECRET]) === 'master', 'the master key in an old address still works, and says so');
ckc($s(['HTTP_X_CHB_CRON' => APP_SECRET]) === 'master', '…in the header too');
ckc($s(['HTTP_X_CHB_CRON' => 'wrong'], ['cron' => $key]) === 'key', 'a wrong header beside the right address is still the scheduler');
ckc($s([], ['cron' => APP_SECRET], false) !== 'key' && $s(['HTTP_X_CHB_CRON' => $key], ['cron' => APP_SECRET]) === 'key', 'the job key wins when both arrive');
ckc($s([], ['cron' => 'header']) === '' && $s([], ['cron' => 'nope']) === '' && $s([], []) === '', 'a placeholder, a wrong key or nothing is not the scheduler');
ckc($s([], ['cron' => ['x']]) === '' && $s(['HTTP_X_CHB_CRON' => ''], ['cron' => '']) === '', 'an array or an empty value is not the scheduler (and does not throw)');
ckc($s([], ['cron' => substr($key, 0, 39)]) === '' && $s([], ['cron' => $key . 'x']) === '', 'a key one character short or long is not the scheduler');

echo "\n== What Status says ==\n";
ckc(cron_master_in_use([]) === true, 'nothing noted yet: the scheduler still has the old address');
ckc(cron_master_in_use(['master_at' => 100]) === true, 'a run with the master key: still the old address');
ckc(cron_master_in_use(['key_at' => 100]) === false, 'a run with the job key: moved');
ckc(cron_master_in_use(['master_at' => 100, 'key_at' => 200]) === false, 'the job key more recently: moved');
ckc(cron_master_in_use(['master_at' => 300, 'key_at' => 200]) === true, 'the master key more recently: back on the old address');
ckc(cron_master_in_use(['master_at' => 'junk', 'key_at' => []]) === true, 'unreadable notes read as not moved');
$addr = cron_address('https://example.co.uk/');
ckc($addr === 'https://example.co.uk/cron.php/' . $key && cron_address('https://example.co.uk') === $addr, 'the address to schedule is <site>/cron.php/<job key>, with or without a trailing slash');
ckc(strpos($addr, APP_SECRET) === false && strpos($addr, '?') === false, '…carries no master key, and no "?" (the IONOS panel refuses one)');

echo "\n== How the job runner asks ==\n";
$h = cron_job_request('https://example.co.uk/', 'migrate.php?cron=', $key, false);
ckc($h['url'] === 'https://example.co.uk/migrate.php?cron=header' && $h['headers'] === ['X-CHB-Cron: ' . $key], 'a job is asked with the key in the header and a placeholder in the address');
$u = cron_job_request('https://example.co.uk/', 'migrate.php?cron=', $key, true);
ckc($u['url'] === 'https://example.co.uk/migrate.php?cron=' . $key && $u['headers'] === [], '…or, for a host that drops the header, with the job key in the address');
ckc(strpos($h['url'] . implode('', $h['headers']) . $u['url'], APP_SECRET) === false, 'neither way carries the master key');
ckc(cron_job_refused(401) && cron_job_refused(403) && !cron_job_refused(200) && !cron_job_refused(500) && !cron_job_refused(0), 'only a 401 or 403 means the key was not accepted');

echo "\n== The master key is in no address and compared in one place ==\n";
$php = array_values(array_filter(array_map('basename', glob(__DIR__ . '/*.php')), fn($f) => strpos($f, 'test-') !== 0));
ckc(count($php) > 100, '(the app\'s PHP files were found: ' . count($php) . ')');
$cmp = $url = $get = [];
foreach ($php as $f) {
    $c = ckc_code($f);
    if (preg_match('/hash_equals\(\s*\(?(string\)\s*)?APP_SECRET/', $c)) {
        $cmp[] = $f;
    }
    if (preg_match('/rawurlencode\(\s*APP_SECRET|cron=\'\s*\.\s*(rawurlencode\()?APP_SECRET|cron\.php\/\'\s*\.\s*APP_SECRET/', $c)) {
        $url[] = $f;
    }
    if ($f !== 'cron-lib.php' && preg_match('/\$_GET\[\'cron\'\]/', preg_replace('/isset\(\$_GET\[\'cron\'\]\)/', '', $c))) {
        $get[] = $f;
    }
}
ckc($cmp === [], 'no file compares APP_SECRET with what a request sent (' . implode(', ', $cmp) . ')');
ckc($url === [], 'no file puts APP_SECRET in an address (' . implode(', ', $url) . ')');
ckc($get === [], 'no file reads ?cron= itself: cron_auth does (' . implode(', ', $get) . ')');
$cron = ckc_code('cron.php');
ckc(strpos($cron, 'APP_SECRET') === false, 'cron.php never names APP_SECRET');
ckc(strpos($cron, 'cron_job_request($base, $path, $jobKey, $inAddress)') !== false && strpos($cron, 'CURLOPT_HTTPHEADER => $req[\'headers\']') !== false, 'cron.php asks each job through cron_job_request, header included');
ckc(preg_match('/cron_job_refused\(\$status\)\)\s*\{\s*\$keyInAddress = true;/', $cron) === 1, '…and moves the key into the address only after a refusal');
ckc(strpos($cron, '$cronVia = cron_auth($_SERVER, $_GET, true);') !== false && strpos($cron, 'cron_auth_note($cronVia);') !== false, 'cron.php reads its own path and notes which key started it');
$db = ckc_code('db.php');
ckc(preg_match('/function cron_request_ok\(.*?cron_auth\(\$_SERVER, \$_GET, \$allowPath\).*?cron_auth_note\(\'master\'\)/s', $db) === 1, 'every job endpoint\'s check (cron_request_ok) notes a master-key run');
$diag = ckc_code('diagnostics.php');
ckc(strpos($diag, 'cron_master_in_use(') !== false && strpos($diag, "['copy' => \$jobAddress]") !== false, 'Status warns while the master key is in use and hands over the new address');
$docs = [];
foreach (array_merge(glob(__DIR__ . '/*.md'), glob(__DIR__ . '/../*.md')) as $md) {
    if (basename($md) !== 'CLAUDE.md' && preg_match('/cron=APP_SECRET|cron\.php\/APP_SECRET/', (string) file_get_contents($md))) {
        $docs[] = basename($md);
    }
}
ckc($docs === [], 'no setup guide tells anyone to put APP_SECRET in a cron address (' . implode(', ', $docs) . ')');

echo $fails ? "\n  $fails CRON-KEY CHECK(S) FAILED \xE2\x9D\x8C\n" : "\n  CRON-KEY SUITE PASSED ($passes) \xE2\x9C\x85\n";
exit($fails ? 1 : 0);
