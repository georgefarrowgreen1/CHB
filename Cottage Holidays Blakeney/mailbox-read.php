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
function pop3_parse_uidl($text)
{
    $out = [];
    foreach (preg_split('/\r?\n/', (string) $text) as $ln) {
        $ln = trim($ln);
        if ($ln === '' || $ln === '.' || $ln[0] === '+') {
            continue;
        }
        if (preg_match('/^(\d+)\s+(\S+)$/', $ln, $m)) {
            $out[(int) $m[1]] = $m[2];
        }
    }
    return $out;
}

// Pull the plain-text body + the headers we need out of a raw RFC822 message.
// Handles quoted-printable / base64 transfer-encodings and multipart/* (takes
// the first text/plain part). Good enough for real mail-client replies.
function parse_email_message($raw)
{
    $raw = str_replace("\r\n", "\n", (string) $raw);
    [$head, $body] = array_pad(explode("\n\n", $raw, 2), 2, '');
    // Unfold folded header lines (continuations start with whitespace).
    $head = preg_replace('/\n[ \t]+/', ' ', $head);
    $h = function ($name) use ($head) {
        return preg_match('/^' . preg_quote($name, '/') . ':\s*(.+)$/mi', $head, $m) ? trim($m[1]) : '';
    };
    $ctype = $h('Content-Type');
    $cte = strtolower($h('Content-Transfer-Encoding'));
    // Multipart → dig out the text body (recursing through nested containers, e.g.
    // multipart/mixed → multipart/alternative → text/plain). Returns already-decoded
    // text (or '' if none) — either beats leaking the raw MIME blob as the "reply".
    if (stripos($ctype, 'multipart/') !== false) {
        $extracted = mailbox_extract_text($body, $ctype);
        if (is_string($extracted)) {
            $body = $extracted;
            $cte = '';
        }
    }
    $body = mailbox_decode_body($body, $cte);
    return [
        'from' => $h('From'),
        'subject' => mailbox_decode_subject($h('Subject')),
        'in_reply_to' => $h('In-Reply-To'),
        'references' => $h('References'),
        'body' => $body,
    ];
}

function mailbox_decode_body($body, $cte)
{
    $body = (string) $body;
    if ($cte === 'base64') {
        return base64_decode(preg_replace('/\s+/', '', $body)) ?: '';
    }
    if ($cte === 'quoted-printable') {
        return quoted_printable_decode($body);
    }
    return $body;
}

// Recursively pull the text body out of a multipart container. Prefers text/plain
// (recursing into nested multipart/*), falls back to text/html flattened to text.
// Returns decoded text (possibly ''), or null if $ctype isn't parseable multipart.
function mailbox_extract_text($body, $ctype)
{
    if (stripos($ctype, 'multipart/') === false || !preg_match('/boundary="?([^";]+)"?/i', $ctype, $bm)) {
        return null;
    }
    $parts = preg_split('/--' . preg_quote($bm[1], '/') . '(?:--)?\s*\n/', (string) $body);
    $html = '';
    foreach ($parts as $part) {
        [$phead, $pbody] = array_pad(explode("\n\n", $part, 2), 2, '');
        if (trim($phead) === '') {
            continue;
        }
        // Full Content-Type value (keep its params — a nested boundary lives there).
        $pct = preg_match('/Content-Type:\s*(.+)/i', $phead, $cm) ? trim($cm[1]) : '';
        $pcte = preg_match('/Content-Transfer-Encoding:\s*(\S+)/i', $phead, $pm) ? strtolower($pm[1]) : '';
        if (stripos($pct, 'multipart/') !== false) {
            $r = mailbox_extract_text($pbody, $pct); // nested container (has its own boundary)
            if (is_string($r) && trim($r) !== '') {
                return $r;
            }
        } elseif (stripos($pct, 'text/plain') !== false) {
            return mailbox_decode_body($pbody, $pcte); // best: plain text
        } elseif ($html === '' && stripos($pct, 'text/html') !== false) {
            $html = mailbox_decode_body($pbody, $pcte); // remember as fallback
        }
    }
    if ($html !== '') {
        $t = preg_replace('/<(br|\/p|\/div)\b[^>]*>/i', "\n", $html);
        return trim(html_entity_decode(strip_tags($t), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }
    return '';
}

// Decode an RFC2047 =?UTF-8?B?…?= subject just enough to read a token inside it.
function mailbox_decode_subject($s)
{
    if (function_exists('iconv_mime_decode')) {
        $d = @iconv_mime_decode($s, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');
        if ($d !== false) {
            return $d;
        }
    }
    return $s;
}

// A "Name <addr@x>" or bare address → lowercase address. Take the LAST <…>
// group: a spoof like `"a <owner@allowed>" <evil@x>` has the real address last,
// so picking the first would let it impersonate an allowed sender.
function mailbox_from_addr($s)
{
    if (preg_match_all('/<([^>]+)>/', (string) $s, $m) && !empty($m[1])) {
        return strtolower(trim(end($m[1])));
    }
    if (preg_match('/([^\s<>]+@[^\s<>]+)/', $s, $m)) {
        return strtolower(trim($m[1]));
    }
    return strtolower(trim((string) $s));
}

// Find our signed thread token anywhere in the reply's routing fields.
function mailbox_token_in($parsed)
{
    foreach ([$parsed['in_reply_to'] ?? '', $parsed['references'] ?? '', $parsed['subject'] ?? ''] as $hay) {
        if ($hay === '') {
            continue;
        }
        if (preg_match('/(\d+x[0-9a-f]{16})/', $hay, $m)) {
            return $m[1];
        }
    }
    return '';
}

// ---- POP3-SSL socket read (best-effort) ------------------------------------
// Returns [msgNo => uidl] and a fetcher, or ['error'=>…]. Non-destructive.
function pop3_open()
{
    $host = mailbox_pop_host();
    if ($host === '' || !defined('SMTP_USER') || !defined('SMTP_PASS')) {
        return ['error' => 'No mailbox configured'];
    }
    $ctx = stream_context_create([
        'ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true],
    ]);
    $errno = 0;
    $errstr = '';
    $fp = @stream_socket_client("ssl://{$host}:995", $errno, $errstr, 12, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        return ['error' => "Connect failed: {$errstr}"];
    }
    stream_set_timeout($fp, 12);
    $line = fn() => fgets($fp, 8192);
    $ok = fn($r) => is_string($r) && strlen($r) && $r[0] === '+';
    if (!$ok($line())) {
        fclose($fp);
        return ['error' => 'No greeting'];
    }
    fwrite($fp, 'USER ' . SMTP_USER . "\r\n");
    if (!$ok($line())) {
        fclose($fp);
        return ['error' => 'USER rejected'];
    }
    fwrite($fp, 'PASS ' . SMTP_PASS . "\r\n");
    if (!$ok($line())) {
        fclose($fp);
        return ['error' => 'Login failed (check the mailbox allows POP3)'];
    }
    return ['fp' => $fp];
}
// Reads a dot-terminated POP3 multiline reply. $clean is set true ONLY if the
// terminating "." line was reached — a false $clean means the socket timed out
// or closed mid-reply, so the caller must abort (the stream is now desynced and
// the data is partial). Body is capped so a huge email can't exhaust memory, but
// we keep draining to the dot so the stream stays in sync.
function pop3_multiline($fp, &$clean = null, $maxBytes = 262144)
{
    $data = '';
    $clean = false;
    while (($ln = fgets($fp, 8192)) !== false) {
        if ($ln === ".\r\n" || $ln === ".\n") {
            $clean = true;
            break;
        }
        if (strlen($ln) > 1 && $ln[0] === '.') {
            $ln = substr($ln, 1);
        } // un-dot-stuff
        if (strlen($data) < $maxBytes) {
            $data .= $ln;
        } // cap memory, keep draining
        $meta = stream_get_meta_data($fp);
        if (!empty($meta['timed_out'])) {
            break;
        } // timeout → not clean → abort
    }
    return $data;
}

// ---- The poll: pull new replies and route them ------------------------------
// Throttled + watermarked via content 'mailbox-poll' = {at, uids:[…]}.
// $preview = true → read-only: don't deliver, don't mark processed, and return a
// per-message trace (used by the ?debug view to see exactly what's arriving).
function poll_mailbox_replies($force = false, $preview = false)
{
    if (!mailbox_auto_enabled()) {
        return ['ok' => false, 'skipped' => 'not-enabled'];
    }
    $state = content_json('mailbox-poll', []); // array-valued key — NOT content_value()
    $processed = isset($state['uids']) && is_array($state['uids']) ? $state['uids'] : [];
    // Throttle: at most one POP3 fetch per 25s. Low enough that a guest actively
    // waiting in the chat (their poll nudges this) sees an emailed reply within ~half
    // a minute, high enough not to hammer the mailbox.
    if (!$preview && !$force && !empty($state['at']) && time() - (int) $state['at'] < 25) {
        return ['ok' => true, 'skipped' => 'throttled'];
    }

    // Serialize concurrent polls (a cron run and an inbox-open, or two tabs) so a
    // reply can never be double-delivered by a race. Non-blocking: if another poll
    // holds the lock, skip this one. Skipped for the read-only preview.
    $lock = false;
    if (!$preview) {
        try {
            $st = db()->query("SELECT GET_LOCK('chb_mailbox_poll', 0)");
            $lock = (int) $st->fetchColumn() === 1;
        } catch (\Throwable $e) {
            $lock = true;
        } // no advisory-lock support → proceed (guard below still applies)
        if (!$lock) {
            return ['ok' => true, 'skipped' => 'locked'];
        }
    }

    $conn = pop3_open();
    if (isset($conn['error'])) {
        if (!$preview) {
            mailbox_poll_save($processed, $conn['error'], null);
            poll_unlock($lock);
        }
        return ['ok' => false, 'error' => $conn['error']];
    }
    $fp = $conn['fp'];
    $handled = 0;
    $seen = 0;
    $trace = [];
    $last = null;
    $fresh = []; // new CUSTOMER mail that did not become a chat reply
    try {
        fwrite($fp, "UIDL\r\n");
        $u = fgets($fp, 8192); // +OK / -ERR
        $uclean = false;
        $uidls = is_string($u) && $u !== '' && $u[0] === '+' ? pop3_parse_uidl(pop3_multiline($fp, $uclean)) : [];
        if (!$uclean) {
            $uidls = [];
        } // partial UIDL read → don't act this round
        $known = array_fill_keys($processed, true);
        $allowed = array_map('strtolower', function_exists('owner_recipients') ? owner_recipients() : []);
        krsort($uidls); // newest first
        foreach ($uidls as $no => $uid) {
            // In preview we look at the newest few regardless of the watermark.
            if (!$preview && isset($known[$uid])) {
                continue;
            }
            if ($seen++ >= ($preview ? 5 : 25)) {
                break;
            }
            fwrite($fp, "RETR {$no}\r\n");
            $ok = fgets($fp, 8192); // +OK / -ERR
            if (!is_string($ok) || $ok === '' || $ok[0] !== '+') {
                break;
            } // RETR failed → stop cleanly
            $rclean = false;
            $raw = pop3_multiline($fp, $rclean);
            if (!$rclean) {
                break;
            } // partial read / desync → stop; uid NOT marked, retry next poll
            $p = parse_email_message($raw);
            $tok = mailbox_token_in($p);
            $tid = msg_reply_verify($tok);
            $fromAddr = mailbox_from_addr($p['from']);
            $senderOk = in_array($fromAddr, $allowed, true);
            $body = $tid > 0 ? strip_quoted_reply($p['body']) : '';
            // Route: the owner/co-host → admin reply; the thread's OWN guest (they
            // were invited to "just reply to this email") → guest message; else drop.
            // NEVER INGEST OUR OWN VOICE. The site sends as the same address the
            // owner reads, and that address is on the allow-list — so a
            // notification carrying a thread token would route as an "admin
            // reply" and post the site's own alert into the guest's chat. The
            // sender test comes first, before any routing.
            $isSelf = mailbox_is_self_notification($fromAddr);
            $route = 'drop';
            if ($tid > 0 && $body !== '' && !$isSelf) {
                if ($senderOk) {
                    $route = 'admin';
                } elseif (mailbox_reply_is_guest($tid, $fromAddr)) {
                    $route = 'guest';
                }
            }
            $reason = $isSelf
                ? 'self-notification'
                : ($tid <= 0
                    ? 'no-thread-token'
                    : ($body === ''
                        ? 'empty-after-strip'
                        : ($route === 'admin'
                            ? 'delivered'
                            : ($route === 'guest'
                                ? 'delivered-guest'
                                : 'sender-not-recognised'))));
            $info = [
                'from' => $fromAddr,
                'subject' => mb_substr($p['subject'], 0, 120),
                'tokenFound' => $tok !== '',
                'thread' => $tid,
                'senderOk' => $senderOk,
                'route' => $route,
                'bodyLen' => strlen($p['body']),
                'strippedLen' => strlen($body),
                'reason' => $reason,
            ];
            if ($preview) {
                $info['strippedPreview'] = mb_substr($body ?: $p['body'], 0, 200);
                $trace[] = $info;
                continue;
            }
            // Deliver, then mark the UID processed ONLY if delivery didn't throw — a
            // transient DB error must retry next poll, not silently lose the reply.
            // Idempotency guard: never post a reply that's already the thread's newest
            // message (covers a watermark hiccup or a webhook+poll overlap).
            $deliverOk = true;
            if (($route === 'admin' || $route === 'guest') && !chat_last_message_is($tid, $body)) {
                try {
                    if ($route === 'admin') {
                        chat_admin_reply($tid, $body);
                    } else {
                        chat_guest_reply($tid, $body);
                    }
                    $handled++;
                } catch (\Throwable $e) {
                    $deliverOk = false;
                }
            }
            // NEW CUSTOMER MAIL. Not our own voice, not an automated report
            // robot (DMARC and friends — see mailbox_is_report_robot; a duty
            // saying "google.com emailed you" is one the owner learns to ignore),
            // and not something that just became a chat message (chat-lib alerts
            // about those — telling the owner twice about one email is worse than
            // the silence this fixes).
            if ($deliverOk && !$isSelf && !mailbox_is_report_robot($fromAddr) && $route === 'drop') {
                $fresh[] = [
                    'uid' => $uid,
                    'from' => $fromAddr,
                    'name' => mailbox_sender_name($p['from']),
                    'subject' => $p['subject'],
                    'at' => time(),
                ];
            }
            if ($deliverOk) {
                $processed[] = $uid;
            } // mark seen only once safely handled
            if ($last === null && $tid > 0) {
                $last = $info;
            } // remember the newest of OUR threads
        }
        fwrite($fp, "QUIT\r\n");
    } catch (\Throwable $e) {
        @fclose($fp);
        if ($preview) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
        mailbox_poll_save($processed, '', $last);
        poll_unlock($lock);
        return ['ok' => false, 'error' => $e->getMessage(), 'handled' => $handled];
    }
    @fclose($fp);
    if ($preview) {
        return ['ok' => true, 'messages' => $trace, 'host' => mailbox_pop_host(), 'allowed' => $allowed ?? []];
    }
    mailbox_poll_save($processed, '', $last);
    $noticed = mailbox_new_record($fresh);
    poll_unlock($lock);
    return ['ok' => true, 'handled' => $handled, 'last' => $last, 'noticed' => $noticed];
}
function poll_unlock($lock)
{
    if (!$lock) {
        return;
    }
    try {
        db()->query("SELECT RELEASE_LOCK('chb_mailbox_poll')");
    } catch (\Throwable $e) {
    }
}
// ---- NEW CUSTOMER MAIL ------------------------------------------------------
// The poll already reads every new message and decides what to do with it. A
// message that is a REPLY becomes a chat message, and chat-lib alerts the owner
// about that — but plain new mail from a customer was simply marked seen and
// dropped, so the one thing arriving from outside the system that nobody had
// been told about was an actual email. It is recorded here and surfaced as a
// duty; the site's OWN notifications never reach this code (the caller tests
// mailbox_is_self_notification first), which is the whole point: the owner
// reads the same inbox the site sends from, and being paged about your own
// "Payment received" email is worse than not being paged at all.
//
// PURE, so test-reply.php can drive it: merge fresh arrivals into the stored
// list, newest first, deduped by uid, capped.
function mailbox_new_merge($stored, $fresh, $cap = 40)
{
    $out = [];
    $byUid = [];
    foreach (array_merge(is_array($fresh) ? $fresh : [], is_array($stored) ? $stored : []) as $m) {
        if (!is_array($m)) {
            continue;
        }
        $uid = (string) ($m['uid'] ?? '');
        if ($uid === '' || isset($byUid[$uid])) {
            continue;
        }
        $byUid[$uid] = true;
        $out[] = [
            'uid' => $uid,
            'from' => (string) ($m['from'] ?? ''),
            'name' => (string) ($m['name'] ?? ''),
            'subject' => mb_substr((string) ($m['subject'] ?? ''), 0, 120),
            'at' => (int) ($m['at'] ?? 0),
        ];
    }
    usort($out, function ($a, $z) {
        return $z['at'] <=> $a['at'];
    });
    return array_slice($out, 0, max(1, (int) $cap));
}

// "Anne Betts <anne@x>" → "Anne Betts"; a bare address has no name to give and
// says so with '', so the caller can fall back to the address rather than
// printing a half-parsed header at the owner.
function mailbox_sender_name($from)
{
    $s = trim((string) $from);
    if (preg_match('/^"?([^"<]*?)"?\s*<[^>]+>$/', $s, $m)) {
        return trim($m[1]);
    }
    return '';
}

// How the alert reads. One sentence, naming who it is from when there is one
// sender, counting when there are several — the chbSay discipline applied to a
// push notification.
function mailbox_new_alert_text($fresh)
{
    $n = count($fresh);
    if ($n < 1) {
        return ['', ''];
    }
    $who = trim((string) ($fresh[0]['name'] ?? '')) ?: (string) ($fresh[0]['from'] ?? 'someone');
    $title = $n === 1 ? 'New email from ' . $who : $n . ' new emails';
    $body = $n === 1
        ? (string) ($fresh[0]['subject'] ?? '')
        : $who . ' and ' . ($n - 1 === 1 ? '1 other' : ($n - 1) . ' others');
    return [$title, $body];
}

// Store the arrivals and wake the owner once for the batch. Wrapped whole: a
// mail-read problem must never break the cron or the page that nudged the poll,
// which is this file's standing rule.
function mailbox_new_record($fresh)
{
    if (empty($fresh)) {
        return 0;
    }
    try {
        $stored = content_json('mailbox-new', []);
        content_set_scalar('mailbox-new', mailbox_new_merge($stored, $fresh));
    } catch (\Throwable $e) {
        return 0; // nothing recorded → say nothing, rather than alert about a list we lost
    }
    try {
        [$title, $body] = mailbox_new_alert_text($fresh);
        if ($title !== '' && function_exists('alert_owner')) {
            alert_owner($title, $body, [
                'category' => 'messages',
                // Per BATCH, not per record: several emails in one poll are one
                // piece of news ("3 new emails"), and a later batch should stack
                // rather than replace it.
                'tag' => 'new-mail-' . (int) (($fresh[0]['at'] ?? 0)),
                'url' => './?open=inbox:email',
            ]);
        }
    } catch (\Throwable $e) {
    }
    return count($fresh);
}

// What is still WAITING: the stored arrivals minus anything the owner has since
// opened. mailbox.php marks a message seen when it is read, so the count clears
// itself through machinery that already exists — no "mark all read" button to
// forget to press, and no second definition of what counts as read.
function mailbox_new_pending()
{
    try {
        $stored = content_json('mailbox-new', []);
        if (empty($stored)) {
            return ['count' => 0, 'items' => []];
        }
        $seen = mailbox_seen_uids();
        $seenMap = array_fill_keys(is_array($seen) ? $seen : [], true);
        $out = [];
        foreach ($stored as $m) {
            if (is_array($m) && !isset($seenMap[(string) ($m['uid'] ?? '')])) {
                $out[] = $m;
            }
        }
        return ['count' => count($out), 'items' => array_slice($out, 0, 5)];
    } catch (\Throwable $e) {
        return ['count' => 0, 'items' => []];
    }
}

function mailbox_poll_save($processed, $error, $last)
{
    // Keep a large watermark so a busy mailbox can't evict an already-handled
    // reply's UIDL and re-deliver it (POP3 UIDL re-lists the whole INBOX each poll).
    if (count($processed) > 2000) {
        $processed = array_slice($processed, -2000);
    }
    $val = ['at' => time(), 'uids' => array_values($processed), 'error' => $error];
    if ($last !== null) {
        $val['last'] = $last;
        $val['lastAt'] = time();
    } else {
        $prev = content_json('mailbox-poll', []);
        if (isset($prev['last'])) {
            $val['last'] = $prev['last'];
            $val['lastAt'] = $prev['lastAt'] ?? null;
        }
    }
    try {
        // Stored SINGLE-encoded and read back with content_json() (content_value()
        // can't return arrays). Do NOT double-encode.
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value) VALUES ('mailbox-poll', ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
            )
            ->execute([json_encode($val)]);
    } catch (\Throwable $e) {
    }
}
// chat_last_message_is() (idempotency guard) lives in chat-lib.php so the webhook
// (inbound-mail.php) shares it.

// A read-only connection self-test for the Health check: does login work?
function mailbox_selftest()
{
    if (!mailbox_auto_enabled()) {
        return ['ok' => false, 'reason' => 'off'];
    }
    $conn = pop3_open();
    if (isset($conn['error'])) {
        return ['ok' => false, 'reason' => $conn['error'], 'host' => mailbox_pop_host()];
    }
    $fp = $conn['fp'];
    fwrite($fp, "STAT\r\n");
    $stat = fgets($fp, 8192);
    fwrite($fp, "QUIT\r\n");
    @fclose($fp);
    return ['ok' => true, 'host' => mailbox_pop_host(), 'stat' => trim((string) $stat)];
}

// ---- Endpoint (admin fire-and-forget + cron + debug) -----------------------
if (basename($_SERVER['SCRIPT_NAME'] ?? '') === 'mailbox-read.php') {
    $isCron = isset($_GET['cron']) && defined('APP_SECRET') && hash_equals(APP_SECRET, (string) $_GET['cron']);
    if (!$isCron) {
        require_admin();
    }
    // Read-only diagnostics: connect + show what the newest messages look like and
    // why each would (not) be delivered — nothing is delivered or marked processed.
    if (isset($_GET['debug'])) {
        json_out([
            'enabled' => mailbox_auto_enabled(),
            'host' => mailbox_pop_host(),
            'reply_to' => defined('MAIL_FROM') ? MAIL_FROM : (defined('SMTP_USER') ? SMTP_USER : ''),
            'selftest' => mailbox_selftest(),
            'preview' => poll_mailbox_replies(true, true),
        ]);
    }
    // Don't make the admin wait on the mail round-trip.
    if (function_exists('fastcgi_finish_request')) {
        echo json_encode(['ok' => true, 'queued' => true]);
        @ob_flush();
        @flush();
        fastcgi_finish_request();
        poll_mailbox_replies($isCron);
        exit();
    }
    json_out(poll_mailbox_replies($isCron));
}
