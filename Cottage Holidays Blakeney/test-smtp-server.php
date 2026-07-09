<?php
// Minimal scriptable SMTP server for testing mailer.php's transport.
// Usage: php smtp-fake-server.php <port> <mode> <logfile>
// Modes:
//   ok             — accept everything
//   greylist-once  — first connection: 451 on MAIL FROM, then accept on later connections
//   drop-once      — first connection: close socket right after greeting
//   reject-data    — accept payload then answer 550 (post-DATA failure)
//   rcpt2-550      — 550 the SECOND RCPT seen across the whole run (batch test)
// Log: one line per event (CONNECT / MAIL / RCPT <addr> / DATA-OK <bytes> / RSET / QUIT).
error_reporting(E_ALL);
$port = (int) ($argv[1] ?? 2525);
$mode = $argv[2] ?? 'ok';
$logf = $argv[3] ?? '/tmp/smtp-fake.log';
file_put_contents($logf, '');
$log = function ($line) use ($logf) {
    file_put_contents($logf, $line . "\n", FILE_APPEND);
};
$srv = stream_socket_server("tcp://127.0.0.1:{$port}", $errno, $errstr);
if (!$srv) {
    fwrite(STDERR, "listen failed: $errstr\n");
    exit(1);
}
$connSeen = 0;
$rcptSeen = 0;
$deadline = time() + 60; // auto-exit
while (time() < $deadline) {
    $c = @stream_socket_accept($srv, 2);
    if (!$c) {
        continue;
    }
    $connSeen++;
    $log('CONNECT ' . $connSeen);
    stream_set_timeout($c, 10);
    $w = function ($s) use ($c) { fwrite($c, $s . "\r\n"); };
    $w('220 fake.test ESMTP');
    if ($mode === 'drop-once' && $connSeen === 1) {
        $log('DROP');
        fclose($c);
        continue;
    }
    $inData = false;
    $dataBuf = '';
    $authStep = 0;
    while (($line = fgets($c, 4096)) !== false) {
        if ($inData) {
            $dataBuf .= $line;
            if (rtrim($line, "\r\n") === '.') {
                $inData = false;
                $log('DATA-OK ' . strlen($dataBuf));
                file_put_contents($logf . '.msg' . $connSeen . '-' . $rcptSeen, $dataBuf);
                if ($mode === 'reject-data') {
                    $w('550 Message rejected after DATA');
                } else {
                    $w('250 OK queued');
                }
            }
            continue;
        }
        $t = rtrim($line, "\r\n");
        $u = strtoupper($t);
        if (strpos($u, 'EHLO') === 0) {
            $w('250-fake.test');
            $w('250 AUTH LOGIN');
        } elseif ($u === 'AUTH LOGIN') {
            $w('334 VXNlcm5hbWU6');
        } elseif ($u === 'STARTTLS') {
            $w('454 TLS not available');
        } elseif (strpos($u, 'MAIL FROM') === 0) {
            if ($mode === 'greylist-once' && $connSeen === 1) {
                $log('MAIL-451');
                $w('451 4.7.1 Greylisted, try again');
            } else {
                $log('MAIL');
                $w('250 OK');
            }
        } elseif (strpos($u, 'RCPT TO') === 0) {
            $rcptSeen++;
            $log('RCPT ' . $t);
            if ($mode === 'rcpt2-550' && $rcptSeen === 2) {
                $w('550 5.1.1 No such user');
            } else {
                $w('250 OK');
            }
        } elseif ($u === 'DATA') {
            $inData = true;
            $dataBuf = '';
            $w('354 Go ahead');
        } elseif ($u === 'RSET') {
            $log('RSET');
            $w('250 OK');
        } elseif ($u === 'QUIT') {
            $log('QUIT');
            $w('221 Bye');
            break;
        } elseif ($t !== '') {
            // AUTH username/password lines (base64) — accept both.
            if (preg_match('/^[A-Za-z0-9+\/=]+$/', $t)) {
                $authStep++;
                $w($authStep === 1 ? '334 UGFzc3dvcmQ6' : '235 Authenticated');
            } else {
                $w('500 Unknown command');
            }
        }
    }
    @fclose($c);
    // Exit once idle after at least one conversation in single-shot tests.
}
