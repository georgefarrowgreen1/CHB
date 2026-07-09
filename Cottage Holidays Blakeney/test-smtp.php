<?php
// End-to-end tests of mailer.php's SMTP transport against the fake server.
// Each scenario boots the server in a mode, runs the client call, then asserts
// on the client result AND the server's event log.
error_reporting(E_ALL & ~E_DEPRECATED);
$SCRATCH = sys_get_temp_dir();
$MAILER = __DIR__ . '/mailer.php';
$PORT = 2529;

define('MAIL_ENABLED', true);
define('SMTP_HOST', '127.0.0.1');
define('SMTP_PORT', $PORT);
define('SMTP_SECURE', ''); // plain (fake server has no TLS)
define('SMTP_USER', 'test@example.com');
define('SMTP_PASS', 'secret');
define('MAIL_FROM', 'bookings@example.com');
define('MAIL_FROM_NAME', 'Cottage Holidays Blakeney');
require $MAILER;

$pass = 0;
$failCnt = 0;
function ok($label, $cond)
{
    global $pass, $failCnt;
    if ($cond) {
        $pass++;
        echo "  ok  $label\n";
    } else {
        $failCnt++;
        echo "  FAIL $label\n";
    }
}

function with_server($mode, $fn)
{
    global $SCRATCH, $PORT;
    $log = "$SCRATCH/smtp-fake.log";
    $proc = proc_open(
        ['php', __DIR__ . '/test-smtp-server.php', (string) $PORT, $mode, $log],
        [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
        $pipes,
    );
    usleep(400000); // let it bind
    try {
        $fn($log);
    } finally {
        proc_terminate($proc);
        proc_close($proc);
        usleep(200000);
    }
}

echo "== 1. single send, happy path ==\n";
with_server('ok', function ($log) {
    $r = smtp_send('guest@example.org', 'Guest', 'Hello ✓ subject', "plain body", '<p>html body</p>', [], null, null, ['X-Test-Header' => 'yes']);
    ok('send ok', !empty($r['ok']));
    $ev = file_get_contents($log);
    ok('exactly 1 connection', substr_count($ev, 'CONNECT') === 1);
    ok('1 DATA payload', substr_count($ev, 'DATA-OK') === 1);
    $msg = glob(dirname($log) . '/smtp-fake.log.msg*');
    $payload = $msg ? file_get_contents(end($msg)) : '';
    ok('payload has To', strpos($payload, 'To: ') !== false);
    ok('payload has extra header', strpos($payload, 'X-Test-Header: yes') !== false);
    ok('payload multipart', strpos($payload, 'multipart/alternative') !== false);
    array_map('unlink', glob(dirname($log) . '/smtp-fake.log.msg*'));
});

echo "== 2. transient greylist (451 on first MAIL FROM) → retried, succeeds ==\n";
with_server('greylist-once', function ($log) {
    $r = smtp_send('guest@example.org', 'Guest', 'Retry test', 'body');
    ok('send ok after retry', !empty($r['ok']));
    $ev = file_get_contents($log);
    ok('2 connections (retry reconnected)', substr_count($ev, 'CONNECT') === 2);
    ok('1 message delivered', substr_count($ev, 'DATA-OK') === 1);
    array_map('unlink', glob(dirname($log) . '/smtp-fake.log.msg*'));
});

echo "== 3. dropped connection after greeting → retried, succeeds ==\n";
with_server('drop-once', function ($log) {
    $r = smtp_send('guest@example.org', 'Guest', 'Drop test', 'body');
    ok('send ok after reconnect', !empty($r['ok']));
    $ev = file_get_contents($log);
    ok('2 connections', substr_count($ev, 'CONNECT') === 2);
    array_map('unlink', glob(dirname($log) . '/smtp-fake.log.msg*'));
});

echo "== 4. post-DATA rejection → FAILS with NO retry (no double-send risk) ==\n";
with_server('reject-data', function ($log) {
    $r = smtp_send('guest@example.org', 'Guest', 'PostData test', 'body');
    ok('send failed', empty($r['ok']));
    ok('error mentions rejection', strpos($r['error'] ?? '', 'Message not accepted') !== false);
    $ev = file_get_contents($log);
    ok('exactly 1 connection (never retried)', substr_count($ev, 'CONNECT') === 1);
    ok('exactly 1 payload transmitted', substr_count($ev, 'DATA-OK') === 1);
    array_map('unlink', glob(dirname($log) . '/smtp-fake.log.msg*'));
});

echo "== 5. batch: 3 messages over ONE connection ==\n";
with_server('ok', function ($log) {
    $msgs = [];
    foreach (['a@x.org', 'b@x.org', 'c@x.org'] as $i => $to) {
        $msgs[] = ['to' => $to, 'name' => 'G' . $i, 'subject' => 'Batch ' . $i, 'text' => 'body ' . $i];
    }
    $rs = smtp_send_batch($msgs);
    ok('3 results, all ok', count($rs) === 3 && !array_filter($rs, fn($r) => empty($r['ok'])));
    $ev = file_get_contents($log);
    ok('exactly 1 connection for 3 messages', substr_count($ev, 'CONNECT') === 1);
    ok('3 payloads', substr_count($ev, 'DATA-OK') === 3);
    ok('rcpts in order', strpos($ev, 'a@x.org') < strpos($ev, 'b@x.org') && strpos($ev, 'b@x.org') < strpos($ev, 'c@x.org'));
    array_map('unlink', glob(dirname($log) . '/smtp-fake.log.msg*'));
});

echo "== 6. batch: 2nd recipient rejected (550) → others still delivered on same connection ==\n";
with_server('rcpt2-550', function ($log) {
    $msgs = [
        ['to' => 'a@x.org', 'name' => 'A', 'subject' => 'S1', 'text' => 'b1'],
        ['to' => 'dead@x.org', 'name' => 'B', 'subject' => 'S2', 'text' => 'b2'],
        ['to' => 'c@x.org', 'name' => 'C', 'subject' => 'S3', 'text' => 'b3'],
    ];
    $rs = smtp_send_batch($msgs);
    ok('msg1 ok', !empty($rs[0]['ok']));
    ok('msg2 failed with RCPT error', empty($rs[1]['ok']) && strpos($rs[1]['error'], 'RCPT TO rejected') !== false);
    ok('msg3 ok', !empty($rs[2]['ok']));
    $ev = file_get_contents($log);
    ok('still exactly 1 connection', substr_count($ev, 'CONNECT') === 1);
    ok('RSET after the rejection', strpos($ev, 'RSET') !== false);
    ok('2 payloads delivered', substr_count($ev, 'DATA-OK') === 2);
    array_map('unlink', glob(dirname($log) . '/smtp-fake.log.msg*'));
});

echo "== 7. preview mode still captures (no SMTP at all) ==\n";
with_server('ok', function ($log) {
    mail_preview_start();
    $r1 = smtp_send('p@x.org', 'P', 'Prev', 'text', '<b>h</b>');
    $rs = smtp_send_batch([['to' => 'q@x.org', 'name' => 'Q', 'subject' => 'PrevB', 'text' => 't']]);
    $caps = mail_preview_take();
    ok('both captured', count($caps) === 2 && !empty($r1['preview']) && !empty($rs[0]['preview']));
    $ev = file_get_contents($log);
    ok('zero connections made', substr_count($ev, 'CONNECT') === 0);
});

echo "\n" . ($failCnt === 0 ? "ALL {$pass} SMTP TRANSPORT CHECKS PASSED ✅" : "{$failCnt} FAILURES ❌") . "\n";
exit($failCnt === 0 ? 0 : 1);
