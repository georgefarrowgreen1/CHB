<?php
// ============================================================
//  mailbox-read.php — ZERO-SETUP reply-by-email.
//  Reads owner replies straight from the mailbox the site ALREADY sends from
//  (SMTP_USER / SMTP_PASS) over POP3-SSL — no external inbound route, no extra
//  config. The read host is derived from SMTP_HOST (smtp.* -> pop.*), overridable
//  with MAIL_POP_HOST. Non-destructive: nothing is deleted; a watermark of
//  processed message UIDLs (content 'mailbox-poll') stops re-processing.
//
//  poll_mailbox_replies() is called opportunistically when the owner opens the
//  message inbox (fire-and-forget) and by the daily cron as a backstop. Every
//  path is guarded — a mail-read problem never breaks a page or the cron.
//
//  The protocol I/O is thin; the parsing (UIDL list, MIME text extraction) is
//  pure and unit-tested in test-reply.php.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/chat-lib.php';

// mailbox_pop_host() + mailbox_auto_enabled() live in chat-lib.php (pure config
// helpers, needed both here and where the reply address is built).

// ---- Pure parsers (unit-tested) --------------------------------------------

// Parse a POP3 UIDL multiline listing ("1 abc\r\n2 def\r\n.") into [msgNo => uidl].
function pop3_parse_uidl($text) {
    $out = [];
    foreach (preg_split('/\r?\n/', (string)$text) as $ln) {
        $ln = trim($ln);
        if ($ln === '' || $ln === '.' || $ln[0] === '+') continue;
        if (preg_match('/^(\d+)\s+(\S+)$/', $ln, $m)) $out[(int)$m[1]] = $m[2];
    }
    return $out;
}

// Pull the plain-text body + the headers we need out of a raw RFC822 message.
// Handles quoted-printable / base64 transfer-encodings and multipart/* (takes
// the first text/plain part). Good enough for real mail-client replies.
function parse_email_message($raw) {
    $raw = str_replace("\r\n", "\n", (string)$raw);
    [$head, $body] = array_pad(explode("\n\n", $raw, 2), 2, '');
    // Unfold folded header lines (continuations start with whitespace).
    $head = preg_replace('/\n[ \t]+/', ' ', $head);
    $h = function ($name) use ($head) {
        return preg_match('/^' . preg_quote($name, '/') . ':\s*(.+)$/mi', $head, $m) ? trim($m[1]) : '';
    };
    $ctype = $h('Content-Type');
    $cte   = strtolower($h('Content-Transfer-Encoding'));
    // Multipart → dig out the first text/plain section.
    if (stripos($ctype, 'multipart/') !== false && preg_match('/boundary="?([^";]+)"?/i', $ctype, $bm)) {
        $parts = preg_split('/--' . preg_quote($bm[1], '/') . '(?:--)?\s*\n/', $body);
        foreach ($parts as $part) {
            [$phead, $pbody] = array_pad(explode("\n\n", $part, 2), 2, '');
            if (stripos($phead, 'text/plain') !== false) {
                $pcte = preg_match('/Content-Transfer-Encoding:\s*(\S+)/i', $phead, $pm) ? strtolower($pm[1]) : '';
                $body = mailbox_decode_body($pbody, $pcte);
                $cte = '';   // already decoded
                break;
            }
        }
    }
    $body = mailbox_decode_body($body, $cte);
    return [
        'from'          => $h('From'),
        'subject'       => mailbox_decode_subject($h('Subject')),
        'in_reply_to'   => $h('In-Reply-To'),
        'references'    => $h('References'),
        'body'          => $body,
    ];
}

function mailbox_decode_body($body, $cte) {
    $body = (string)$body;
    if ($cte === 'base64') return base64_decode(preg_replace('/\s+/', '', $body)) ?: '';
    if ($cte === 'quoted-printable') return quoted_printable_decode($body);
    return $body;
}

// Decode an RFC2047 =?UTF-8?B?…?= subject just enough to read a token inside it.
function mailbox_decode_subject($s) {
    if (function_exists('iconv_mime_decode')) {
        $d = @iconv_mime_decode($s, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');
        if ($d !== false) return $d;
    }
    return $s;
}

// A "Name <addr@x>" or bare address → lowercase address.
function mailbox_from_addr($s) {
    if (preg_match('/<([^>]+)>/', $s, $m)) return strtolower(trim($m[1]));
    if (preg_match('/([^\s<>]+@[^\s<>]+)/', $s, $m)) return strtolower(trim($m[1]));
    return strtolower(trim((string)$s));
}

// Find our signed thread token anywhere in the reply's routing fields.
function mailbox_token_in($parsed) {
    foreach ([$parsed['in_reply_to'] ?? '', $parsed['references'] ?? '', $parsed['subject'] ?? ''] as $hay) {
        if ($hay === '') continue;
        if (preg_match('/(\d+x[0-9a-f]{16})/', $hay, $m)) return $m[1];
    }
    return '';
}

// ---- POP3-SSL socket read (best-effort) ------------------------------------
// Returns [msgNo => uidl] and a fetcher, or ['error'=>…]. Non-destructive.
function pop3_open() {
    $host = mailbox_pop_host();
    if ($host === '' || !defined('SMTP_USER') || !defined('SMTP_PASS')) return ['error' => 'No mailbox configured'];
    $ctx = stream_context_create(['ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true]]);
    $errno = 0; $errstr = '';
    $fp = @stream_socket_client("ssl://{$host}:995", $errno, $errstr, 12, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) return ['error' => "Connect failed: {$errstr}"];
    stream_set_timeout($fp, 12);
    $line = fn() => fgets($fp, 8192);
    $ok = fn($r) => is_string($r) && strlen($r) && $r[0] === '+';
    if (!$ok($line())) { fclose($fp); return ['error' => 'No greeting']; }
    fwrite($fp, 'USER ' . SMTP_USER . "\r\n"); if (!$ok($line())) { fclose($fp); return ['error' => 'USER rejected']; }
    fwrite($fp, 'PASS ' . SMTP_PASS . "\r\n"); if (!$ok($line())) { fclose($fp); return ['error' => 'Login failed (check the mailbox allows POP3)']; }
    return ['fp' => $fp];
}
function pop3_multiline($fp) {
    $data = '';
    while (($ln = fgets($fp, 8192)) !== false) {
        if ($ln === ".\r\n" || $ln === ".\n") break;
        if (strlen($ln) > 1 && $ln[0] === '.') $ln = substr($ln, 1);   // un-dot-stuff
        $data .= $ln;
    }
    return $data;
}

// ---- The poll: pull new replies and route them ------------------------------
// Throttled + watermarked via content 'mailbox-poll' = {at, uids:[…]}.
function poll_mailbox_replies($force = false) {
    if (!mailbox_auto_enabled()) return ['ok' => false, 'skipped' => 'not-enabled'];
    // Throttle: at most once every 90s unless forced (cron passes force).
    $state = json_decode(content_value('mailbox-poll') ?: '{}', true);
    if (!is_array($state)) $state = [];
    $processed = isset($state['uids']) && is_array($state['uids']) ? $state['uids'] : [];
    if (!$force && !empty($state['at']) && (time() - (int)$state['at']) < 90) return ['ok' => true, 'skipped' => 'throttled'];

    $conn = pop3_open();
    if (isset($conn['error'])) { mailbox_poll_save($processed, $conn['error']); return ['ok' => false, 'error' => $conn['error']]; }
    $fp = $conn['fp'];
    $handled = 0; $seen = 0;
    try {
        fwrite($fp, "UIDL\r\n");
        // First line is the +OK status; then the multiline listing.
        fgets($fp, 8192);
        $uidls = pop3_parse_uidl(pop3_multiline($fp));
        $known = array_fill_keys($processed, true);
        $allowed = array_map('strtolower', function_exists('owner_recipients') ? owner_recipients() : []);
        // Newest first, cap the work per poll.
        krsort($uidls);
        foreach ($uidls as $no => $uid) {
            if (isset($known[$uid])) continue;         // already processed
            if ($seen++ >= 25) break;                  // don't fetch the whole mailbox
            $processed[] = $uid;                       // mark seen even if we ignore it
            fwrite($fp, "RETR {$no}\r\n");
            fgets($fp, 8192);                          // +OK
            $raw = pop3_multiline($fp);
            $p = parse_email_message($raw);
            $tid = msg_reply_verify(mailbox_token_in($p));
            if ($tid <= 0) continue;                   // not a reply to one of our threads
            if (!in_array(mailbox_from_addr($p['from']), $allowed, true)) continue;   // only owner/co-hosts
            $body = strip_quoted_reply($p['body']);
            if ($body === '') continue;
            chat_admin_reply($tid, $body);
            $handled++;
        }
        fwrite($fp, "QUIT\r\n");
    } catch (\Throwable $e) { /* fall through to save + return */ }
    @fclose($fp);
    mailbox_poll_save($processed, $handled ? '' : ($state['error'] ?? ''));
    return ['ok' => true, 'handled' => $handled];
}
function mailbox_poll_save($processed, $error) {
    // Keep the newest ~300 UIDLs so the watermark can't grow unbounded.
    if (count($processed) > 300) $processed = array_slice($processed, -300);
    $val = json_encode(['at' => time(), 'uids' => array_values($processed), 'error' => $error]);
    try {
        db()->prepare("INSERT INTO content (item_key, item_value) VALUES ('mailbox-poll', ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP")
            ->execute([$val]);
    } catch (\Throwable $e) {}
}

// A read-only connection self-test for the Health check: does login work?
function mailbox_selftest() {
    if (!mailbox_auto_enabled()) return ['ok' => false, 'reason' => 'off'];
    $conn = pop3_open();
    if (isset($conn['error'])) return ['ok' => false, 'reason' => $conn['error'], 'host' => mailbox_pop_host()];
    $fp = $conn['fp'];
    fwrite($fp, "STAT\r\n"); $stat = fgets($fp, 8192);
    fwrite($fp, "QUIT\r\n"); @fclose($fp);
    return ['ok' => true, 'host' => mailbox_pop_host(), 'stat' => trim((string)$stat)];
}

// ---- Endpoint (admin fire-and-forget + cron) -------------------------------
if (basename($_SERVER['SCRIPT_NAME'] ?? '') === 'mailbox-read.php') {
    $isCron = isset($_GET['cron']) && defined('APP_SECRET') && hash_equals(APP_SECRET, (string)$_GET['cron']);
    if (!$isCron) require_admin();
    // Don't make the admin wait on the mail round-trip.
    if (function_exists('fastcgi_finish_request')) { echo json_encode(['ok' => true, 'queued' => true]); @ob_flush(); @flush(); fastcgi_finish_request(); poll_mailbox_replies($isCron); exit; }
    json_out(poll_mailbox_replies($isCron));
}
