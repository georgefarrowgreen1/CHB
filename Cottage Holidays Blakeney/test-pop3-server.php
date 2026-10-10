<?php
// ============================================================
//  test-pop3-server.php — a fake POP3 mailbox over TLS, for test-integration.
//  usage: php test-pop3-server.php <port> <maildir> <log>
//
//  Serves the .eml files in <maildir> as one mailbox, sorted by name (the first is
//  message 1), with the file's name (less .eml) as its UIDL. One connection at a
//  time, the way the app talks to it (pop3_lock): greeting, USER, PASS, STAT, LIST,
//  UIDL, TOP, RETR, DELE, RSET, NOOP and QUIT, where a QUIT removes what DELE marked.
//  Every command is written to <log>, so a suite can count what the app asked for.
//
//  TLS with a certificate made here, so the app's own ssl:// connection is the one
//  exercised (it does not verify the peer). Excluded from deploy like every test-*.php.
// ============================================================
error_reporting(E_ALL & ~E_DEPRECATED);
[, $port, $dir, $log] = $argv + [null, '0', '', ''];
$port = (int) $port;
if ($port <= 0 || !is_dir($dir)) {
    fwrite(STDERR, "usage: php test-pop3-server.php <port> <maildir> <log>\n");
    exit(2);
}
$say = function ($line) use ($log) {
    if ($log !== '') {
        file_put_contents($log, $line . "\n", FILE_APPEND);
    }
};

// A self-signed certificate for 127.0.0.1, made fresh for this run.
$key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
$csr = openssl_csr_new(['commonName' => '127.0.0.1'], $key, ['digest_alg' => 'sha256']);
$crt = openssl_csr_sign($csr, null, $key, 1, ['digest_alg' => 'sha256']);
$pem = sys_get_temp_dir() . '/chb-pop3-' . getmypid() . '.pem';
openssl_x509_export($crt, $certOut);
openssl_pkey_export($key, $keyOut);
file_put_contents($pem, $certOut . $keyOut);
register_shutdown_function(fn() => @unlink($pem));

$ctx = stream_context_create(['ssl' => ['local_cert' => $pem, 'allow_self_signed' => true, 'verify_peer' => false]]);
$srv = @stream_socket_server("ssl://127.0.0.1:$port", $errno, $errstr, STREAM_SERVER_BIND | STREAM_SERVER_LISTEN, $ctx);
if (!$srv) {
    fwrite(STDERR, "bind failed: $errstr\n");
    exit(1);
}
$say('LISTEN');

// The mailbox as it stands when a session opens: [number => [uid, path]].
$box = function () use ($dir) {
    $files = glob(rtrim($dir, '/') . '/*.eml') ?: [];
    sort($files, SORT_STRING);
    $out = [];
    foreach ($files as $i => $f) {
        $out[$i + 1] = [basename($f, '.eml'), $f];
    }
    return $out;
};
// A message as POP3 sends it: CRLF lines, a leading dot doubled, then ".".
$dotted = function ($text) {
    $text = str_replace(["\r\n", "\r"], "\n", (string) $text);
    $lines = explode("\n", $text);
    if (end($lines) === '') {
        array_pop($lines);
    }
    $out = '';
    foreach ($lines as $l) {
        $out .= ($l !== '' && $l[0] === '.' ? '.' : '') . $l . "\r\n";
    }
    return $out . ".\r\n";
};

while (true) {
    $c = @stream_socket_accept($srv, 300);
    if (!$c) {
        continue;
    }
    $say('CONNECT');
    stream_set_timeout($c, 30);
    $msgs = $box();
    $dele = [];
    fwrite($c, "+OK fake POP3 ready\r\n");
    while (($line = fgets($c, 8192)) !== false) {
        $line = rtrim($line, "\r\n");
        $parts = explode(' ', $line);
        $cmd = strtoupper($parts[0] ?? '');
        $arg = $parts[1] ?? '';
        $say($cmd === 'PASS' ? 'PASS ***' : $line);
        $n = (int) $arg;
        $has = $n > 0 && isset($msgs[$n]) && !isset($dele[$n]);
        if ($cmd === 'USER' || $cmd === 'PASS' || $cmd === 'NOOP') {
            fwrite($c, "+OK\r\n");
        } elseif ($cmd === 'STAT') {
            $live = array_diff_key($msgs, $dele);
            $size = array_sum(array_map(fn($m) => filesize($m[1]), $live));
            fwrite($c, '+OK ' . count($live) . ' ' . $size . "\r\n");
        } elseif ($cmd === 'LIST' || $cmd === 'UIDL') {
            if ($arg !== '') {
                fwrite($c, $has ? '+OK ' . $n . ' ' . ($cmd === 'UIDL' ? $msgs[$n][0] : filesize($msgs[$n][1])) . "\r\n" : "-ERR no such message\r\n");
                continue;
            }
            $out = "+OK\r\n";
            foreach ($msgs as $i => $m) {
                if (!isset($dele[$i])) {
                    $out .= $i . ' ' . ($cmd === 'UIDL' ? $m[0] : filesize($m[1])) . "\r\n";
                }
            }
            fwrite($c, $out . ".\r\n");
        } elseif ($cmd === 'RETR') {
            fwrite($c, $has ? "+OK\r\n" . $dotted(file_get_contents($msgs[$n][1])) : "-ERR no such message\r\n");
        } elseif ($cmd === 'TOP') {
            if (!$has) {
                fwrite($c, "-ERR no such message\r\n");
                continue;
            }
            $raw = str_replace(["\r\n", "\r"], "\n", (string) file_get_contents($msgs[$n][1]));
            [$head, $body] = array_pad(explode("\n\n", $raw, 2), 2, '');
            $keep = implode("\n", array_slice(explode("\n", $body), 0, max(0, (int) ($parts[2] ?? 0))));
            fwrite($c, "+OK\r\n" . $dotted($head . "\n\n" . $keep));
        } elseif ($cmd === 'DELE') {
            if ($has) {
                $dele[$n] = true;
            }
            fwrite($c, $has ? "+OK\r\n" : "-ERR no such message\r\n");
        } elseif ($cmd === 'RSET') {
            $dele = [];
            fwrite($c, "+OK\r\n");
        } elseif ($cmd === 'QUIT') {
            foreach (array_keys($dele) as $i) {
                @unlink($msgs[$i][1]);
            }
            fwrite($c, "+OK bye\r\n");
            break;
        } else {
            fwrite($c, "-ERR unknown command\r\n");
        }
    }
    @fclose($c);
    $say('CLOSE');
}
