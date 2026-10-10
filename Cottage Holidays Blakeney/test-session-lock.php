<?php
// ============================================================
//  test-session-lock.php — who may hold the session lock, and the
//  sweep of the session folder. DEV/CI only (deploy-excluded with
//  the other test-*.php).
//
//      php test-session-lock.php
//
//  PHP's file sessions hold an exclusive lock from session_start() until the
//  request ends. Nothing ever let go of it, so one slow request (the POP3
//  mailbox, a Square refresh, a calendar sync) queued every other request from
//  the same browser behind it. db.php now releases the lock straight after its
//  own checks unless the endpoint declared define('CHB_KEEPS_SESSION', true)
//  before requiring it. The danger in that is a SILENT one: a session write made
//  after the release is simply lost — a sign-in that does not stick. So this
//  gate holds the rule from both ends:
//   §1  the scanner that finds session writes, checked against known snippets
//       (it must not be blind, and must not see writes in comments);
//   §2  every file that writes the session declares itself, and every file that
//       declares itself writes it (a needless declaration holds the lock for
//       nothing), with the declaration before the require of db.php;
//   §3  db.php releases AFTER its own writes (the signed-out check, the CSRF
//       token) and only for undeclared endpoints;
//   §4  the behaviour on a real multi-worker php -S: a fast request is not held
//       up by a slow one, a declared writer still holds the lock (the control
//       that proves the measurement can see blocking at all), and a write after
//       the release is lost — which is exactly why §2 exists;
//   §5  the sweep: empty files a day old and files past the session lifetime go,
//       everything else stays, and self-repair calls it on the app's own folder.
// ============================================================
require_once __DIR__ . '/session-lib.php';

$fails = 0;
function slk($name, $cond, $extra = '')
{
    global $fails;
    if ($cond) {
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fails++;
        echo "  \xE2\x9C\x97 $name" . ($extra !== '' ? " — $extra" : '') . "\n";
    }
}

// Tokens without comments or whitespace, so a sentence ABOUT a session write
// (there are several, explaining the rule) is never read as one.
function slk_tokens(string $src): array
{
    $out = [];
    foreach (token_get_all($src) as $t) {
        if (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT, T_WHITESPACE], true)) {
            continue;
        }
        $out[] = $t;
    }
    return $out;
}

// Helpers in db.php that write the session, and PHP's own session calls.
const SLK_WRITER_CALLS = [
    'session_start', 'session_regenerate_id', 'session_destroy', 'session_unset', 'session_reset', 'session_decode',
    'admin_session_begin', 'guest_session_begin', 'reauth_stamp', 'csrf_token', 'csrf_issue_cookie',
];
// Built-ins that write through a by-reference argument.
const SLK_BYREF_CALLS = [
    'array_push', 'array_pop', 'array_shift', 'array_unshift', 'array_splice', 'array_walk', 'sort', 'rsort', 'usort',
    'uasort', 'uksort', 'ksort', 'krsort', 'asort', 'arsort', 'natsort', 'natcasesort', 'shuffle', 'settype',
    'preg_match', 'preg_match_all', 'parse_str', 'str_replace', 'preg_replace', 'end', 'reset', 'next', 'prev',
];

// Every place this source writes the session: [description, line].
function slk_writes(string $src): array
{
    $t = slk_tokens($src);
    $n = count($t);
    $hits = [];
    $assignOps = [
        T_PLUS_EQUAL, T_MINUS_EQUAL, T_CONCAT_EQUAL, T_MUL_EQUAL, T_DIV_EQUAL, T_MOD_EQUAL, T_COALESCE_EQUAL,
        T_AND_EQUAL, T_OR_EQUAL, T_XOR_EQUAL, T_SL_EQUAL, T_SR_EQUAL, T_POW_EQUAL, T_INC, T_DEC,
    ];
    for ($i = 0; $i < $n; $i++) {
        $tok = $t[$i];
        $line = is_array($tok) ? $tok[2] : 0;
        if (is_array($tok) && $tok[0] === T_VARIABLE && $tok[1] === '$_SESSION') {
            $prev = $t[$i - 1] ?? null;
            // PHP 8.1+ tokenises the & of a reference as its own token, not '&'.
            if ($prev === '&' || (is_array($prev) && in_array($prev[0], [T_INC, T_DEC, T_AMPERSAND_FOLLOWED_BY_VAR_OR_VARARG, T_AMPERSAND_NOT_FOLLOWED_BY_VAR_OR_VARARG], true))) {
                $hits[] = ['changes $_SESSION', $line];
                continue;
            }
            $j = $i + 1;
            while ($j < $n && $t[$j] === '[') {
                $depth = 0;
                for (; $j < $n; $j++) {
                    if ($t[$j] === '[') {
                        $depth++;
                    } elseif ($t[$j] === ']' && --$depth === 0) {
                        $j++;
                        break;
                    }
                }
            }
            $next = $t[$j] ?? null;
            if ($next === '=' || (is_array($next) && in_array($next[0], $assignOps, true))) {
                $hits[] = ['assigns $_SESSION', $line];
            }
            continue;
        }
        $isUnset = is_array($tok) && $tok[0] === T_UNSET;
        $name = is_array($tok) && $tok[0] === T_STRING ? strtolower($tok[1]) : '';
        $prev = $t[$i - 1] ?? null;
        $isDef = is_array($prev) && $prev[0] === T_FUNCTION;
        $isMember = is_array($prev) && in_array($prev[0], [T_OBJECT_OPERATOR, T_DOUBLE_COLON, T_NULLSAFE_OBJECT_OPERATOR], true);
        if (($t[$i + 1] ?? null) !== '(' || $isDef || $isMember) {
            continue;
        }
        if ($name !== '' && in_array($name, SLK_WRITER_CALLS, true)) {
            $hits[] = ['calls ' . $name . '()', $line];
            continue;
        }
        if ($isUnset || in_array($name, SLK_BYREF_CALLS, true)) {
            $depth = 0;
            for ($j = $i + 1; $j < $n; $j++) {
                if ($t[$j] === '(') {
                    $depth++;
                } elseif ($t[$j] === ')' && --$depth === 0) {
                    break;
                } elseif (is_array($t[$j]) && $t[$j][0] === T_VARIABLE && $t[$j][1] === '$_SESSION') {
                    $hits[] = [($isUnset ? 'unset' : $name) . '() on $_SESSION', $line];
                    break;
                }
            }
        }
    }
    return $hits;
}

// Does this file declare that it keeps the lock, and does it do so before db.php?
function slk_declares(string $src): array
{
    $t = slk_tokens($src);
    $decl = -1;
    $req = -1;
    foreach ($t as $i => $tok) {
        if ($decl < 0 && is_array($tok) && $tok[0] === T_STRING && strtolower($tok[1]) === 'define'
            && ($t[$i + 1] ?? null) === '(' && is_array($t[$i + 2] ?? null) && $t[$i + 2][0] === T_CONSTANT_ENCAPSED_STRING
            && trim($t[$i + 2][1], '\'"') === 'CHB_KEEPS_SESSION') {
            $decl = $i;
        }
        if ($req < 0 && is_array($tok) && in_array($tok[0], [T_REQUIRE_ONCE, T_REQUIRE, T_INCLUDE, T_INCLUDE_ONCE], true)) {
            for ($k = $i + 1; $k < $i + 5 && isset($t[$k]); $k++) {
                if (is_array($t[$k]) && $t[$k][0] === T_CONSTANT_ENCAPSED_STRING && trim($t[$k][1], '\'"') === '/db.php') {
                    $req = $i;
                    break;
                }
            }
        }
    }
    return ['declares' => $decl >= 0, 'beforeDb' => $decl >= 0 && ($req < 0 || $decl < $req)];
}

echo "\n== 1. The scanner finds writes, and only writes ==\n";
$cases = [
    ["<?php \$_SESSION['a'] = 1;", 1],
    ["<?php \$_SESSION['a']['b'] = 1;", 1],
    ["<?php \$_SESSION['n']++;", 1],
    ["<?php ++\$_SESSION['n'];", 1],
    ["<?php \$_SESSION['s'] .= 'x';", 1],
    ["<?php \$_SESSION['ids'][] = 4;", 1],
    ["<?php \$_SESSION = [];", 1],
    ["<?php unset(\$_SESSION['a'], \$x);", 1],
    ["<?php array_push(\$_SESSION['l'], 1);", 1],
    ["<?php \$r = &\$_SESSION['a'];", 1],
    ["<?php reauth_stamp();", 1],
    ["<?php guest_session_begin(4);", 1],
    ["<?php session_regenerate_id(true);", 1],
    ["<?php if (\$_SESSION['a'] === 1) {}", 0],
    ["<?php \$x = \$_SESSION['y'] ?? null; \$z = empty(\$_SESSION['q']);", 0],
    ["<?php // \$_SESSION['x'] = 1;\n/* unset(\$_SESSION['y']); reauth_stamp(); */", 0],
    ["<?php function reauth_stamp() {} \$o->csrf_token();", 0],
    ["<?php \$a = in_array(\$k, \$_SESSION['enq_ids'] ?? [], true);", 0],
];
$scanOk = 0;
foreach ($cases as [$src, $want]) {
    $got = count(slk_writes($src));
    if (($got > 0) === ($want > 0)) {
        $scanOk++;
    } else {
        slk('scanner: ' . str_replace("\n", ' ', $src), false, "found $got write(s), expected " . ($want ? 'one' : 'none'));
    }
}
slk("the scanner reads " . count($cases) . " known snippets correctly (writes, reads, comments, definitions)", $scanOk === count($cases), "$scanOk of " . count($cases));

echo "\n== 2. Every session writer declares itself, and only they do ==\n";
$writers = [];
$declared = [];
$late = [];
$scanned = 0;
foreach (glob(__DIR__ . '/*.php') as $path) {
    $f = basename($path);
    if (strpos($f, 'test-') === 0 || $f === 'db.php' || $f === 'session-lib.php') {
        continue;
    }
    $src = (string) file_get_contents($path);
    $scanned++;
    $w = slk_writes($src);
    if ($w) {
        $writers[$f] = $w;
    }
    $d = slk_declares($src);
    if ($d['declares']) {
        $declared[] = $f;
        if (!$d['beforeDb']) {
            $late[] = $f;
        }
    }
}
ksort($writers);
sort($declared);
slk("scanned the app's PHP files (vacuity: at least 100)", $scanned >= 100, (string) $scanned);
slk('found the session writers at all (auth.php among them)', isset($writers['auth.php']) && count($writers) >= 4, implode(', ', array_keys($writers)));
$undeclared = array_diff(array_keys($writers), $declared);
$needless = array_diff($declared, array_keys($writers));
$detail = [];
foreach ($undeclared as $f) {
    $detail[] = $f . ' (' . $writers[$f][0][0] . ' at line ' . $writers[$f][0][1] . ')';
}
slk('every file that writes the session declares CHB_KEEPS_SESSION — otherwise its writes are lost', !$undeclared, implode('; ', $detail));
slk('no file declares it without writing the session — that would hold the lock for nothing', !$needless, implode(', ', $needless));
slk('each declaration comes before the require of db.php, where the decision is made', !$late, implode(', ', $late));

echo "\n== 3. db.php releases after its own writes, and only for undeclared endpoints ==\n";
$db = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/db.php')) as $tok) {
    $db .= is_array($tok) ? (in_array($tok[0], [T_COMMENT, T_DOC_COMMENT], true) ? '' : $tok[1]) : $tok;
}
$pStart = preg_match('/^\s*@session_start\(\);/m', $db, $m, PREG_OFFSET_CAPTURE) ? $m[0][1] : -1;
$pCheck = preg_match('/^admin_session_check\(\);/m', $db, $m, PREG_OFFSET_CAPTURE) ? $m[0][1] : -1;
$pCsrf = preg_match('/^csrf_issue_cookie\(\);/m', $db, $m, PREG_OFFSET_CAPTURE) ? $m[0][1] : -1;
$pRel = preg_match("/^if \(session_status\(\) === PHP_SESSION_ACTIVE && !defined\('CHB_KEEPS_SESSION'\)\) \{\s*session_write_close\(\);\s*\}/m", $db, $m, PREG_OFFSET_CAPTURE) ? $m[0][1] : -1;
slk('db.php releases the lock, guarded by the declaration', $pRel > 0);
slk('…after the session starts, the signed-out check and the CSRF token (both write)', $pStart > 0 && $pCheck > $pStart && $pCsrf > $pCheck && $pRel > $pCsrf, "start $pStart, check $pCheck, csrf $pCsrf, release $pRel");
slk('…and nothing else at the top level of db.php releases or restarts the session', substr_count($db, 'session_write_close(') === 1 && substr_count($db, 'session_start(') === 1);
slk('db.php takes its session lifetime from session-lib.php', strpos($db, "require_once __DIR__ . '/session-lib.php';") !== false && strpos($db, '$sess_ttl = CHB_SESSION_TTL;') !== false);

echo "\n== 4. On a real multi-worker server ==\n";
$tmp = sys_get_temp_dir() . '/chb-slk-' . bin2hex(random_bytes(4));
@mkdir($tmp, 0700, true);
$dbPath = var_export(__DIR__ . '/db.php', true);
$SLOW_US = 2500000;
file_put_contents("$tmp/keep.php", "<?php define('CHB_KEEPS_SESSION', true); require $dbPath; \$_SESSION['probe'] = (string) (\$_GET['v'] ?? ''); json_out(['ok' => true]);");
file_put_contents("$tmp/keepslow.php", "<?php define('CHB_KEEPS_SESSION', true); require $dbPath; usleep($SLOW_US); json_out(['ok' => true]);");
file_put_contents("$tmp/slow.php", "<?php require $dbPath; usleep($SLOW_US); json_out(['ok' => true]);");
file_put_contents("$tmp/lost.php", "<?php require $dbPath; \$_SESSION['probe'] = 'changed after the release'; json_out(['ok' => true]);");
file_put_contents("$tmp/fast.php", "<?php require $dbPath; json_out(['probe' => \$_SESSION['probe'] ?? null]);");

$sock = stream_socket_server('tcp://127.0.0.1:0');
$port = (int) substr(strrchr((string) stream_socket_get_name($sock, false), ':'), 1);
fclose($sock);
$env = getenv();
$env['PHP_CLI_SERVER_WORKERS'] = '4';
$log = "$tmp/server.log";
$srv = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', $tmp], [0 => ['pipe', 'r'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']], $pipes, $tmp, $env);
$base = "http://127.0.0.1:$port";
$seen = []; // every session id a response handed out, so the files can be removed after
$get = function (string $path, string $cookie = '') use ($base, &$seen) {
    $ch = curl_init($base . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 20]);
    if ($cookie !== '') {
        curl_setopt($ch, CURLOPT_COOKIE, $cookie);
    }
    $raw = (string) curl_exec($ch);
    $hs = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if (preg_match_all('/^Set-Cookie:\s*PHPSESSID=([^;\s]+)/mi', substr($raw, 0, $hs), $mm)) {
        foreach ($mm[1] as $sid) {
            $seen[$sid] = true;
        }
    }
    return [$code, substr($raw, 0, $hs), substr($raw, $hs)];
};
$up = false;
for ($i = 0; $i < 60 && !$up; $i++) {
    usleep(100000);
    $up = $get('/fast.php')[0] === 200;
}
slk('the probe server is up', $up, @file_get_contents($log) ?: '');

// Fire $first, wait $gapMs, fire $second; return how long $second took and its body.
$race = function (string $first, string $second, string $cookie, int $gapMs = 300) use ($base) {
    $mh = curl_multi_init();
    $mk = function (string $p) use ($base, $cookie) {
        $ch = curl_init($base . $p);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_COOKIE => $cookie]);
        return $ch;
    };
    $a = $mk($first);
    curl_multi_add_handle($mh, $a);
    $t0 = microtime(true);
    $b = null;
    $tb = 0.0;
    do {
        curl_multi_exec($mh, $running);
        if ($b === null && (microtime(true) - $t0) * 1000 >= $gapMs) {
            $b = $mk($second);
            $tb = microtime(true);
            curl_multi_add_handle($mh, $b);
            $running = 1;
        }
        if ($b !== null) {
            $done = curl_multi_info_read($mh);
            while ($done) {
                if ($done['handle'] === $b) {
                    $elapsed = microtime(true) - $tb;
                    $body = (string) curl_multi_getcontent($b);
                    curl_multi_exec($mh, $running);
                    while ($running) {
                        curl_multi_select($mh, 0.1);
                        curl_multi_exec($mh, $running);
                    }
                    curl_multi_close($mh);
                    return [$elapsed, $body];
                }
                $done = curl_multi_info_read($mh);
            }
        }
        curl_multi_select($mh, 0.02);
    } while (true);
};

if ($up) {
    [$code, $hdr] = $get('/keep.php?v=hello');
    $cookie = preg_match('/^Set-Cookie:\s*(PHPSESSID=[^;\s]+)/mi', $hdr, $cm) ? $cm[1] : '';
    slk('a declared writer starts a session and stores in it', $code === 200 && $cookie !== '', "HTTP $code");
    if ($cookie !== '') {
        [$tFast, $body] = $race('/slow.php', '/fast.php', $cookie);
        $probe = (json_decode($body, true) ?: [])['probe'] ?? null;
        slk('a fast request answers while a slow one from the same browser is still running', $tFast < 1.2, sprintf('%.2fs (the slow one takes %.1fs)', $tFast, $SLOW_US / 1e6));
        slk('…and it still read the session the writer stored', $probe === 'hello', var_export($probe, true));
        [$tCtl] = $race('/keepslow.php', '/fast.php', $cookie);
        slk('CONTROL: a declared writer still holds the lock, so this harness can see blocking at all', $tCtl >= 1.8, sprintf('%.2fs', $tCtl));
        $get('/lost.php', $cookie);
        $probe2 = (json_decode($get('/fast.php', $cookie)[2], true) ?: [])['probe'] ?? null;
        slk('a write after the release is LOST — the reason every writer must declare itself', $probe2 === 'hello', var_export($probe2, true));
    }
}
if (is_resource($srv)) {
    proc_terminate($srv);
    proc_close($srv);
}
foreach (array_keys($seen) as $sid) {
    if (preg_match('/^[A-Za-z0-9,-]+$/', $sid)) {
        @unlink(__DIR__ . '/sessions/sess_' . $sid);
    }
}
foreach (glob("$tmp/*") ?: [] as $f) {
    @unlink($f);
}
@rmdir($tmp);

echo "\n== 5. The session folder's sweep ==\n";
$dir = sys_get_temp_dir() . '/chb-slk-sess-' . bin2hex(random_bytes(4));
@mkdir($dir, 0700, true);
$now = 1800000000;
$mkf = function (string $name, string $body, int $age) use ($dir, $now) {
    file_put_contents("$dir/$name", $body);
    touch("$dir/$name", $now - $age);
};
$day = 86400;
$id = fn(string $c) => str_repeat($c, 26);
$mkf('sess_' . $id('a'), '', 2 * $day); // empty, two days old → goes
$mkf('sess_' . $id('b'), '', 3600); // empty, an hour old → stays (a visitor mid-page)
$mkf('sess_' . $id('c'), 'guest_id|i:4;', CHB_SESSION_TTL + $day); // past the lifetime → goes
$mkf('sess_' . $id('d'), 'guest_id|i:5;', 10 * $day); // live → stays
$mkf('.htaccess', 'Require all denied', 400 * $day); // not a session file → stays, however old
$mkf('notes.txt', '', 400 * $day); // not a session file → stays
@mkdir("$dir/sess_" . $id('e')); // a directory with a session name → untouched
touch("$dir/sess_" . $id('e'), $now - 400 * $day);
@symlink("$dir/notes.txt", "$dir/sess_" . $id('f')); // a link with a session name → untouched
$r = session_files_prune($dir, $now);
slk('an empty session file a day old goes', !file_exists("$dir/sess_" . $id('a')));
slk('an empty one an hour old stays (a visitor still mid-page)', file_exists("$dir/sess_" . $id('b')));
slk('a session untouched past the lifetime goes', !file_exists("$dir/sess_" . $id('c')));
slk('a live session stays', file_exists("$dir/sess_" . $id('d')));
slk('files that are not sessions are never touched', file_exists("$dir/.htaccess") && file_exists("$dir/notes.txt"));
slk('a directory or a link with a session name is never touched', is_dir("$dir/sess_" . $id('e')) && is_link("$dir/sess_" . $id('f')));
slk('it reports what it did', $r === ['empty' => 1, 'expired' => 1, 'kept' => 2], json_encode($r));
slk('a missing folder is a quiet no-op', session_files_prune("$dir/nope", $now) === ['empty' => 0, 'expired' => 0, 'kept' => 0]);
@unlink("$dir/sess_" . $id('f'));
@rmdir("$dir/sess_" . $id('e'));
foreach (glob("$dir/{,.}*", GLOB_BRACE) ?: [] as $f) {
    if (is_file($f)) {
        @unlink($f);
    }
}
@rmdir($dir);
// THE WIRING: a helper tested alone passes with its only caller deleted.
$sr = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/self-repair.php')) as $tok) {
    $sr .= is_array($tok) ? (in_array($tok[0], [T_COMMENT, T_DOC_COMMENT], true) ? '' : $tok[1]) : $tok;
}
slk("self-repair sweeps the app's own session folder daily", strpos($sr, "session_files_prune(__DIR__ . '/sessions', time())") !== false);

echo "\n== Summary ==\n";
if ($fails) {
    echo "  $fails CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL SESSION-LOCK CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
