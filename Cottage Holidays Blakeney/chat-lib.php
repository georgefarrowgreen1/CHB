<?php
// ============================================================
//  chat-lib.php — shared owner↔guest messaging helpers, safe to include
//  anywhere (no top-level side effects). Used by messages.php (the endpoint)
//  and inbound-mail.php (the reply-by-email gateway).
// ============================================================

// Keep only what the owner typed above the quoted history / signature when they
// reply to a notification email. Pure + unit-tested (test-reply.php).
if (!function_exists('strip_quoted_reply')) {
    function strip_quoted_reply($text) {
        $text = str_replace(["\r\n", "\r"], "\n", (string)$text);
        $out = [];
        foreach (explode("\n", $text) as $ln) {
            $t = trim($ln);
            if (preg_match('/^On .+wrote:$/', $t)) break;                 // Gmail/Apple "On … wrote:"
            if (preg_match('/^-{2,}\s*Original Message\s*-{2,}/i', $t)) break;
            if (preg_match('/^={2,}\s*Reply above this line/i', $t)) break;
            if (preg_match('/^_{5,}$/', $t)) break;                        // Outlook divider
            if ($t === '-- ' || $t === '--') break;                        // signature delimiter
            if (preg_match('/^(From|Sent|To|Subject):\s/i', $t) && count($out) > 2) break;  // quoted header block
            if (strpos($t, '>') === 0) continue;                           // drop quoted lines
            $out[] = $ln;
        }
        while ($out && trim($out[count($out) - 1]) === '') array_pop($out);
        return trim(implode("\n", $out));
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
