<?php
// ============================================================
//  test-error-status.php — an endpoint must not answer a FAILURE with a 2xx
//  status. Dev/CI only, deploy-excluded. No DB, no network: it TOKENISES every
//  shipped .php and inspects each json_out() call literally.
//
//  Why this gate exists: apiPost (app.js) throws only on a NON-2xx response, so
//  `json_out(['error' => …], 200)` — or the same with no status, since json_out
//  defaults to 200 — is an error the client CANNOT SEE. It has bitten this
//  codebase repeatedly: the £NaN "Balance request sent" toast, the "Sent 2 of 3"
//  over a batch that sent none, and (PR #992) the location save that reported
//  "the money screens now read this location" over stale figures because the
//  failed refresh came back 200. Each was found and fixed by hand; this converts
//  "we keep finding these" into "CI finds them for free."
//
//  THE RULE: a json_out() whose FIRST argument is an array literal with a BARE
//  top-level `'error' =>` key — and NO `'ok' =>` key — must carry an explicit
//  NON-2xx status. Absent status (defaults 200) or a literal 2xx fails.
//   · An `'ok' =>` key is the deliberate `['ok' => false, 'error' => …]`
//     convention (diagnostics, sms_test, the digest crons) — the client reads
//     `.ok`, so the failure is not invisible. Allowed at 2xx.
//   · A dynamic status (a variable/expression, e.g. `(int) ($r['code'] ?? 400)`)
//     is allowed — it propagates a lib's own code and can't be judged statically.
//   · A payload that is a VARIABLE rather than a literal is out of static reach
//     and skipped; the bug shape lives in the literal arrays.
//
//  Tokeniser, not regex, for two reasons the £NaN-era greps got wrong: a
//  `// json_out(['error' => …], 200)` COMMENT must not match (db.php has one
//  documenting the very rule), and a nested array inside the payload must not be
//  mistaken for the status argument.
//
//  Run:  php test-error-status.php
// ============================================================

$pass = 0;
$fail = 0;
$violations = [];
function es_ok($name, $cond)
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "  \u{2713} $name\n";
    } else {
        $fail++;
        echo "  \u{2717} $name\n";
    }
}

// Every shipped .php, minus the dev/CI-only test harnesses (which define their
// own stubs and fixtures) and this file. config.php is the host's, not ours.
$dir = __DIR__;
$files = [];
foreach (glob($dir . '/*.php') as $f) {
    $base = basename($f);
    if (strpos($base, 'test-') === 0 || $base === 'config.php') {
        continue;
    }
    $files[] = $f;
}

// Walk a json_out() call's argument tokens (already stripped of the outer
// parens) and decide whether it is the banned shape. Returns null if fine, or a
// short reason string if it violates.
function es_judge_call(array $argTokens)
{
    // Split into top-level comma-separated arguments, tracking (){}[ ] depth.
    $args = [];
    $cur = [];
    $depth = 0;
    foreach ($argTokens as $t) {
        $s = is_array($t) ? $t[1] : $t;
        if ($s === '(' || $s === '[' || $s === '{') {
            $depth++;
        } elseif ($s === ')' || $s === ']' || $s === '}') {
            $depth--;
        }
        if ($s === ',' && $depth === 0) {
            $args[] = $cur;
            $cur = [];
            continue;
        }
        $cur[] = $t;
    }
    if ($cur) {
        $args[] = $cur;
    }
    if (!$args) {
        return null;
    }

    // ---- Argument 0: is it a literal array carrying a top-level `'error' =>`? ----
    $payload = $args[0];
    // Skip leading whitespace/comments to find the first real token.
    $first = null;
    foreach ($payload as $t) {
        if (is_array($t) && ($t[0] === T_WHITESPACE || $t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT)) {
            continue;
        }
        $first = $t;
        break;
    }
    // Only a literal array opener ( [ or array( ) can be inspected; a variable
    // payload is out of static reach.
    $isArrayLiteral = ($first === '[') || (is_array($first) && $first[0] === T_ARRAY);
    if (!$isArrayLiteral) {
        return null;
    }
    // Find the top-level KEYS: a constant string at bracket depth 1 (inside the
    // outermost array) immediately followed by =>. We care about two — 'error'
    // and 'ok'.
    $d = 0;
    $hasError = false;
    $hasOk = false;
    $n = count($payload);
    for ($i = 0; $i < $n; $i++) {
        $t = $payload[$i];
        $s = is_array($t) ? $t[1] : $t;
        if ($s === '[' || $s === '(') {
            $d++;
            continue;
        }
        if ($s === ']' || $s === ')') {
            $d--;
            continue;
        }
        // Depth 1 = directly inside the outer array literal.
        if ($d === 1 && is_array($t) && $t[0] === T_CONSTANT_ENCAPSED_STRING) {
            $key = trim($t[1], "'\"");
            if ($key !== 'error' && $key !== 'ok') {
                continue;
            }
            // Confirm it is a KEY (=> follows), not a value.
            for ($j = $i + 1; $j < $n; $j++) {
                $nt = $payload[$j];
                if (is_array($nt) && ($nt[0] === T_WHITESPACE || $nt[0] === T_COMMENT)) {
                    continue;
                }
                if (is_array($nt) && $nt[0] === T_DOUBLE_ARROW) {
                    if ($key === 'error') {
                        $hasError = true;
                    } else {
                        $hasOk = true;
                    }
                }
                break;
            }
        }
    }
    if (!$hasError) {
        return null;
    }
    // An 'ok' key means the response signals success/failure through `ok`, which
    // the client reads directly — the deliberate `['ok' => false, 'error' => …]`
    // convention (diagnostics, sms_test, the digest crons). The error is not the
    // sole, invisible signal there, so it is allowed at 2xx. The BANNED shape is
    // a BARE `['error' => …]` at a success status: the only failure signal is a
    // key at a status apiPost reads as success, and callers forget to check it —
    // which is precisely what bit #992 and the £NaN toast.
    if ($hasOk) {
        return null;
    }

    // ---- Argument 1: the status. Absent → default 200. Literal 2xx → banned.
    // A variable/expression → allowed (propagates a lib code; not statically 2xx).
    if (count($args) < 2) {
        return 'error payload with no status (json_out defaults to 200)';
    }
    $status = $args[1];
    $real = [];
    foreach ($status as $t) {
        if (is_array($t) && ($t[0] === T_WHITESPACE || $t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT)) {
            continue;
        }
        $real[] = $t;
    }
    if (count($real) === 1 && is_array($real[0]) && $real[0][0] === T_LNUMBER) {
        $code = (int) $real[0][1];
        if ($code >= 200 && $code < 300) {
            return "error payload with a 2xx status ($code)";
        }
    }
    return null; // non-2xx literal, or a dynamic status — allowed
}

// Tokenise one file and judge every json_out() call in it.
function es_scan_file($path, &$count)
{
    $src = (string) file_get_contents($path);
    $tokens = @token_get_all($src);
    if (!$tokens) {
        return [];
    }
    $out = [];
    $n = count($tokens);
    for ($i = 0; $i < $n; $i++) {
        $t = $tokens[$i];
        if (!(is_array($t) && $t[0] === T_STRING && $t[1] === 'json_out')) {
            continue;
        }
        // Next real token must be '(' — otherwise it's not a call (e.g. a name in
        // a comment slipped through, or `function json_out`).
        $j = $i + 1;
        while ($j < $n && is_array($tokens[$j]) && ($tokens[$j][0] === T_WHITESPACE || $tokens[$j][0] === T_COMMENT)) {
            $j++;
        }
        if ($j >= $n || $tokens[$j] !== '(') {
            continue;
        }
        // Capture the balanced argument list between this '(' and its match.
        $depth = 0;
        $args = [];
        $line = is_array($t) ? $t[2] : 0;
        for ($k = $j; $k < $n; $k++) {
            $tk = $tokens[$k];
            $s = is_array($tk) ? $tk[1] : $tk;
            if ($s === '(') {
                $depth++;
                if ($depth === 1) {
                    continue; // skip the opening paren itself
                }
            } elseif ($s === ')') {
                $depth--;
                if ($depth === 0) {
                    break; // matched close
                }
            }
            $args[] = $tk;
        }
        $count++;
        $reason = es_judge_call($args);
        if ($reason !== null) {
            $out[] = basename($path) . ':' . $line . ' — ' . $reason;
        }
    }
    return $out;
}

echo "== test-error-status.php ==\n";
$total = 0;
foreach ($files as $f) {
    foreach (es_scan_file($f, $total) as $v) {
        $violations[] = $v;
    }
}

// VACUITY GUARD: if the tokeniser stops finding json_out calls, the gate would
// pass by covering nothing. json_out is the app's one response function and
// there are hundreds of calls; a floor well below that catches a broken walk.
es_ok("the scan actually inspected json_out calls (found $total)", $total >= 150);

echo "\n-- no endpoint answers a failure with a 2xx status --\n";
if ($violations) {
    foreach ($violations as $v) {
        echo "    \u{2717} $v\n";
    }
}
es_ok('every error payload carries a non-2xx status', count($violations) === 0);

// SELF-TEST: the judge must actually fire on the banned shapes and stay quiet on
// the allowed ones — otherwise the clean sweep above proves nothing. Drives the
// real es_judge_call() with hand-tokenised argument lists.
echo "\n-- the judge fires on the shapes it must (and only those) --\n";
$tok = function ($code) {
    // Tokenise `json_out(<code>);` and hand back just the inner arg tokens.
    $all = token_get_all("<?php json_out(" . $code . ");");
    $depth = 0;
    $args = [];
    $started = false;
    foreach ($all as $t) {
        $s = is_array($t) ? $t[1] : $t;
        if ($s === '(') {
            $depth++;
            if ($depth === 1) {
                $started = true;
                continue;
            }
        } elseif ($s === ')') {
            $depth--;
            if ($depth === 0) {
                break;
            }
        }
        if ($started) {
            $args[] = $t;
        }
    }
    return $args;
};
es_ok('bare error + explicit 200 is caught', es_judge_call($tok("['error' => 'x'], 200")) !== null);
es_ok('bare error + no status is caught (defaults 200)', es_judge_call($tok("['error' => 'x']")) !== null);
es_ok('bare error + 201 is caught', es_judge_call($tok("['error' => 'x'], 201")) !== null);
es_ok('bare error + 400 is allowed', es_judge_call($tok("['error' => 'x'], 400")) === null);
es_ok('bare error + 500 is allowed', es_judge_call($tok("['error' => 'x'], 500")) === null);
es_ok('bare error + a dynamic status is allowed', es_judge_call($tok("['error' => 'x'], (int) (\$r['code'] ?? 400)")) === null);
es_ok('a success payload at 200 is fine', es_judge_call($tok("['ok' => true, 'data' => 1]")) === null);
es_ok("an ok:false 'reason' at 200 is fine (the preview shape)", es_judge_call($tok("['ok' => false, 'reason' => 'x']")) === null);
// The deliberate convention: ok:false + error at 200 — the client reads .ok, so
// the failure is visible. Allowed regardless of the error key beside it.
es_ok("ok:false + error at 200 is the allowed convention", es_judge_call($tok("['ok' => false, 'error' => 'x']")) === null);
es_ok("...even with the ok key AFTER the error key", es_judge_call($tok("['error' => 'x', 'ok' => false]")) === null);
// A NESTED array whose inner key happens to be 'error' must not trip the
// top-level check (the reason the tokeniser tracks depth).
es_ok('a nested inner error key does not count', es_judge_call($tok("['ok' => true, 'meta' => ['error' => 'x']], 200")) === null);
// 'error' as a VALUE, not a key, must not count.
es_ok("'error' as a value is not a key", es_judge_call($tok("['status' => 'error'], 200")) === null);

// THE RESPONSE FUNCTION ITSELF, run for real. json_out used to refuse the WHOLE
// response over one invalid UTF-8 byte (one bad email would turn a whole list
// into an error), and it answered that error with the caller's 200. Driven in a
// subprocess because json_out exits; the subprocess removes its own session file.
echo "\n-- json_out: one bad byte never blanks the answer, and a real failure is a 500 --\n";
$es_run = function ($payloadPhp) {
    $code = '$_SERVER["SCRIPT_FILENAME"] = "probe.php"; require ' . var_export(__DIR__ . '/db.php', true) . ';'
        . ' register_shutdown_function(function () { $f = session_save_path() . "/sess_" . session_id(); if (session_id() !== "" && is_file($f)) { @unlink($f); } });'
        . ' json_out(' . $payloadPhp . ');';
    return (string) shell_exec(escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg($code) . ' 2>/dev/null');
};
$bad = json_decode($es_run('["rows" => ["fine", "cut mid-character \xC3", "also fine"], "n" => 3]'), true);
es_ok('a bad byte in one row leaves every other row in the answer', is_array($bad) && ($bad['n'] ?? 0) === 3 && ($bad['rows'][2] ?? '') === 'also fine');
es_ok('…and the bad byte itself becomes U+FFFD, not a refusal', is_array($bad) && ($bad['rows'][1] ?? '') === "cut mid-character \u{FFFD}" && !isset($bad['error']));
$nan = json_decode($es_run('["total" => NAN]'), true);
es_ok('a genuinely unencodable answer (NAN) still says so rather than sending garbage', is_array($nan) && ($nan['error'] ?? '') === 'Response encoding error');
$jsrc = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/db.php')) as $t) {
    $jsrc .= is_array($t) ? (in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true) ? '' : $t[1]) : $t;
}
es_ok('…and answers it with a 500, not the caller\'s 2xx', (bool) preg_match('/if \(\$json === false\) \{\s*http_response_code\(500\);/', $jsrc));

// A CRASH FROM THE COMMAND LINE MUST FAIL THE RUN. db.php's exception handler
// logs the error and stops the script — and from the command line PHP then exits
// with status 0. Six test gates load db.php, so a crash partway through one of
// them ended its checks early and still reported a pass.
echo "\n-- an uncaught exception after db.php is loaded fails the command-line run --\n";
// From a FILE: `php -r` never calls a user exception handler, so a probe run that
// way passes whatever db.php does. The file lives in the system temp dir, never
// beside the app.
$probe = tempnam(sys_get_temp_dir(), 'es-crash-') . '.php';
file_put_contents($probe, '<?php $_SERVER["SCRIPT_FILENAME"] = "probe.php"; require ' . var_export(__DIR__ . '/db.php', true) . ';'
    . ' register_shutdown_function(function () { $f = session_save_path() . "/sess_" . session_id(); if (session_id() !== "" && is_file($f)) { @unlink($f); } });'
    . ' echo "loaded\n"; throw new RuntimeException("es-probe-crash");');
$proc = proc_open([PHP_BINARY, $probe], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
$out = stream_get_contents($pipes[1]);
$err = stream_get_contents($pipes[2]);
fclose($pipes[1]);
fclose($pipes[2]);
$rc = proc_close($proc);
@unlink($probe);
@unlink(substr($probe, 0, -4));
es_ok('the probe really loaded db.php before it crashed', strpos((string) $out, 'loaded') !== false);
es_ok('the run exits non-zero', $rc !== 0);
es_ok('…and says what crashed on stderr', strpos((string) $err, 'es-probe-crash') !== false);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail ERROR-STATUS CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass ERROR-STATUS CHECKS PASSED \u{2705}\n";
