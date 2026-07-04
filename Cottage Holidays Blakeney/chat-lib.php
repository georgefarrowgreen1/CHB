<?php
// ============================================================
//  chat-lib.php — shared owner↔guest messaging helpers, safe to include
//  anywhere (no top-level side effects). Used by messages.php (the endpoint)
//  and inbound-mail.php (the reply-by-email gateway).
// ============================================================

// Zero-setup reply-by-email helpers (pure config; the POP3 socket work lives in
// mailbox-read.php). Derive the mail-read host from the SMTP host, and decide
// whether auto reply-by-email applies (SMTP creds present, mail on, and the
// owner hasn't opted into the REPLY_INBOX webhook route instead).
if (!function_exists('mailbox_pop_host')) {
    function mailbox_pop_host() {
        if (defined('MAIL_POP_HOST') && MAIL_POP_HOST) return MAIL_POP_HOST;
        $h = defined('SMTP_HOST') ? SMTP_HOST : '';
        if ($h === '') return '';
        if (stripos($h, 'smtp.') === 0) return 'pop.' . substr($h, 5);
        if (stripos($h, 'smtp') === 0)  return 'pop' . substr($h, 4);
        return 'pop.' . $h;
    }
}
if (!function_exists('mailbox_auto_enabled')) {
    function mailbox_auto_enabled() {
        return defined('MAIL_ENABLED') && MAIL_ENABLED
            && defined('SMTP_USER') && SMTP_USER && defined('SMTP_PASS') && SMTP_PASS
            && SMTP_PASS !== 'CHANGE_ME'
            && !(defined('REPLY_INBOX') && REPLY_INBOX);
    }
}

// Keep only what the owner typed above the quoted history / signature when they
// reply to a notification email. Pure + unit-tested (test-reply.php).
if (!function_exists('strip_quoted_reply')) {
    function strip_quoted_reply($text) {
        $text = str_replace(["\r\n", "\r"], "\n", (string)$text);
        $len = strlen($text);
        $cut = $len;

        // (a) The attribution line that precedes a quote — matched across a possible
        //     line-wrap ("On 4 Jul 2026, at 19:59, Cottage Holidays Blakeney\n
        //     <bookings@…> wrote:"), which is why the old single-line regex missed it.
        if (preg_match('/(^|\n)(On .{0,300}?wrote:)/si', $text, $m, PREG_OFFSET_CAPTURE)) {
            $cut = min($cut, $m[2][1]);
        }
        // (b) Other client dividers before the quoted original.
        foreach (["-----Original Message-----", "Begin forwarded message:", "________________________________", "Reply above this line"] as $sep) {
            $p = stripos($text, $sep);
            if ($p !== false) $cut = min($cut, $p);
        }
        // (c) Belt-and-braces: the exact FIRST LINE of a quoted copy of one of our
        //     own notification/relay emails — so even an odd client that quotes with
        //     no ">" prefix and no attribution still gets trimmed. Only these two
        //     unambiguous openers (a real reply would never contain them); the softer
        //     phrases were dropped so they can't clip a genuine reply.
        foreach ([
            'Someone has sent you a message via the website chat',
            'You have a new message from Cottage Holidays Blakeney',
        ] as $mk) {
            $p = stripos($text, $mk);
            if ($p !== false) $cut = min($cut, $p);
        }
        $text = substr($text, 0, $cut);

        // Line cleanup on what's left: drop any ">" quoted lines and the signature.
        $out = [];
        foreach (explode("\n", $text) as $ln) {
            $t = trim($ln);
            if ($t === '-- ' || $t === '--') break;               // signature delimiter
            if ($t === '_' || preg_match('/^_{5,}$/', $t)) break;  // divider
            if (strpos($t, '>') === 0) continue;                   // quoted line
            $out[] = $ln;
        }
        while ($out && trim($out[count($out) - 1]) === '') array_pop($out);
        return trim(implode("\n", $out));
    }
}

// Idempotency guard: is $body already the most recent message in this thread?
// Used by BOTH inbound paths (POP3 poll + webhook) so a provider retry or a poll
// race can't post the same reply twice. Back-office sends stay unguarded (those
// are intentional).
if (!function_exists('chat_last_message_is')) {
    function chat_last_message_is($threadId, $body) {
        try {
            $s = db()->prepare('SELECT body FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1');
            $s->execute([(int)$threadId]);
            $last = $s->fetchColumn();
            return $last !== false && trim((string)$last) === trim((string)$body);
        } catch (\Throwable $e) { return false; }
    }
}

// Post an owner/admin reply into a thread AND deliver it to the guest: it shows
// on the website chat (an 'admin' message) and is emailed to the guest. If
// reply-by-email is configured, the guest's email carries a Reply-To that routes
// their reply straight back into this same thread.
if (!function_exists('chat_admin_reply')) {
    function chat_admin_reply($threadId, $bodyTxt) {
        $threadId = (int)$threadId;
        $bodyTxt = mb_substr(trim((string)$bodyTxt), 0, 4000);
        if ($threadId <= 0 || $bodyTxt === '') return false;
        db()->prepare("INSERT INTO messages (thread_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?, 'admin', ?, 1, 0)")->execute([$threadId, $bodyTxt]);
        db()->prepare('UPDATE chat_threads SET updated_at = NOW() WHERE id = ?')->execute([$threadId]);
        try {
            $t = db()->prepare('SELECT name, email FROM chat_threads WHERE id = ?'); $t->execute([$threadId]); $thread = $t->fetch();
            if ($thread && !empty($thread['email'])) {
                require_once __DIR__ . '/mailer.php';
                if (function_exists('smtp_send')) {
                    $replyAddr = function_exists('msg_reply_address') ? msg_reply_address($threadId) : '';
                    $msgId = ($replyAddr && function_exists('msg_reply_token')) ? 'msg.' . msg_reply_token($threadId) : null;
                    smtp_send($thread['email'], $thread['name'] ?: 'there', 'A message from Cottage Holidays Blakeney',
                        "Hello " . ($thread['name'] ?: 'there') . ",\n\nYou have a new message from Cottage Holidays Blakeney:\n\n\"" . $bodyTxt . "\"\n\nReply on our website chat" . ($replyAddr ? ' — or just reply to this email' : '') . ".\nCottage Holidays Blakeney",
                        null, [], $replyAddr ?: null, $msgId);
                }
            }
        } catch (\Throwable $e) {}
        return true;
    }
}
