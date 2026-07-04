<?php
// ============================================================
//  inbound-mail.php — reply-by-email gateway (inbound webhook).
//  When the owner (or a co-host) REPLIES to a "New website message"
//  notification, their mail provider's inbound route POSTs the parsed reply
//  here. We match it to the conversation, post it into the website chat, and
//  email it to the guest — so one email reply reaches the customer both ways.
//
//  Set up a free inbound route (ImprovMX / Mailgun Routes / CloudMailin /
//  SendGrid Inbound Parse) for the REPLY_INBOX address that forwards to:
//     https://YOURDOMAIN/inbound-mail.php?key=INBOUND_SECRET
//  See SETUP-REPLY-EMAIL.md.
//
//  Security: the shared secret authenticates the webhook, AND the reply's FROM
//  must be one of the owner recipients — so only the owner/co-hosts can inject
//  an admin reply, never a stranger who guessed the URL.
//  Always returns 200 (even when ignoring) so providers don't retry forever.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/chat-lib.php';

// ---- Auth: shared secret (dedicated INBOUND_SECRET, else APP_SECRET) ----
$secret = defined('INBOUND_SECRET') && INBOUND_SECRET ? INBOUND_SECRET : (defined('APP_SECRET') ? APP_SECRET : '');
$given = (string)($_GET['key'] ?? $_POST['key'] ?? '');
if ($secret === '' || !hash_equals($secret, $given)) { http_response_code(403); echo 'forbidden'; exit; }

// ---- Read the parsed email from whichever provider fields are present ----
// Common shapes: Mailgun (sender, subject, stripped-text, recipient, In-Reply-To),
// SendGrid Inbound Parse (from, subject, text, to, headers), CloudMailin (similar).
function inb($keys) {
    foreach ((array)$keys as $k) {
        if (isset($_POST[$k]) && $_POST[$k] !== '') return (string)$_POST[$k];
    }
    return '';
}
$from       = inb(['sender', 'from', 'From']);
$subject    = inb(['subject', 'Subject']);
$recipient  = inb(['recipient', 'to', 'To']);
$inReplyTo  = inb(['In-Reply-To', 'in-reply-to', 'in_reply_to']);
$headersRaw = inb(['headers', 'message-headers']);
// Prefer a provider's already-stripped reply text; fall back to the full body.
$bodyRaw    = inb(['stripped-text', 'text', 'body-plain', 'plain', 'body']);

// Some providers only send the raw MIME — pull a plain-text body + headers out.
if ($bodyRaw === '') {
    $raw = inb(['email', 'body-mime', 'message', 'raw']);
    if ($raw !== '') {
        if ($inReplyTo === '' && preg_match('/^In-Reply-To:\s*(.+)$/mi', $raw, $m)) $inReplyTo = trim($m[1]);
        if ($from === '' && preg_match('/^From:\s*(.+)$/mi', $raw, $m)) $from = trim($m[1]);
        if ($subject === '' && preg_match('/^Subject:\s*(.+)$/mi', $raw, $m)) $subject = trim($m[1]);
        $parts = preg_split("/\r?\n\r?\n/", $raw, 2);
        $bodyRaw = $parts[1] ?? $raw;
    }
}

// A bare "email@x" or a "Name <email@x>" → the address only.
function inb_addr($s) {
    if (preg_match('/<([^>]+)>/', $s, $m)) return strtolower(trim($m[1]));
    return strtolower(trim($s));
}

// ---- Find the thread token: plus-address, In-Reply-To, or subject ----
$token = '';
foreach ([$recipient, $inReplyTo, $headersRaw, $subject] as $hay) {
    if ($hay === '') continue;
    // reply+<tid>x<sig>@…  |  <msg.<tid>x<sig>@…>  |  anywhere the pattern appears
    if (preg_match('/\+(\d+x[0-9a-f]{16})@/', $hay, $m)) { $token = $m[1]; break; }
    if (preg_match('/(\d+x[0-9a-f]{16})/', $hay, $m))    { $token = $m[1]; break; }
}
$threadId = $token !== '' ? msg_reply_verify($token) : 0;
if ($threadId <= 0) { echo 'no thread'; exit; }   // 200 — nothing to do

// ---- Only the owner / co-hosts may post an admin reply ----
$fromAddr = inb_addr($from);
$allowed = array_map('strtolower', function_exists('owner_recipients') ? owner_recipients() : []);
if ($fromAddr === '' || !in_array($fromAddr, $allowed, true)) { echo 'sender not allowed'; exit; }

// ---- Clean the reply: keep only what the owner typed above the quoted history.
// strip_quoted_reply() lives in chat-lib.php (pure + unit-tested). ----
$body = strip_quoted_reply($bodyRaw);
if ($body === '') { echo 'empty reply'; exit; }

// ---- Post to the website thread + email the guest (shared helper) ----
// Idempotency: a provider retry (or a double-fire) re-POSTs the same reply, so
// skip it if it's already the newest message in the thread.
if (!chat_last_message_is($threadId, $body)) chat_admin_reply($threadId, $body);
echo 'ok';
