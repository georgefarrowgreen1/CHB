<?php
// ============================================================
//  mailbox.php — the back office's email client (Manage → Email).
//  Reads the SAME mailbox the site sends from (SMTP_USER over POP3-SSL,
//  reusing mailbox-read.php's tested socket + MIME helpers) and sends
//  through the same smtp_send() every other email uses — so there is no
//  new mail configuration at all.
//
//  Actions (all admin-only; require_admin() enforces session + CSRF):
//    list    — newest messages (headers only, via TOP): from/subject/date
//              + a seen flag (POP3 has no read-state; ours lives in the
//              content table under 'mailbox-seen').
//    read    — one full message; the TEXT part only. Received HTML is never
//              rendered (a hostile email must not become script in the
//              owner's admin session) — the client shows escaped text.
//    send    — compose/reply. Plain text + the branded email_shell HTML
//              part, exactly like the site's transactional emails.
//    delete  — DELE one message (client confirms first; QUIT commits).
//
//  POP3 numbering is per-session, so every mutating action re-lists UIDLs
//  and locates the message by its stable UIDL — never by a stale number.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/chat-lib.php';
require_once __DIR__ . '/mailbox-read.php';

require_admin();

$in = body();
$action = $in['action'] ?? '';

// ---- helpers ---------------------------------------------------------------

function mbx_seen_uids()
{
    $v = content_json('mailbox-seen', []);
    return is_array($v['uids'] ?? null) ? $v['uids'] : [];
}
function mbx_seen_save($uids)
{
    if (count($uids) > 1000) {
        $uids = array_slice($uids, -1000);
    }
    try {
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value) VALUES ('mailbox-seen', ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
            )
            ->execute([json_encode(['uids' => array_values($uids)])]);
    } catch (\Throwable $e) {
    }
}
// Extract one header from a raw (unfolded) header block.
function mbx_header($head, $name)
{
    $head = preg_replace('/\n[ \t]+/', ' ', str_replace("\r\n", "\n", (string) $head));
    return preg_match('/^' . preg_quote($name, '/') . ':\s*(.+)$/mi', $head, $m) ? trim($m[1]) : '';
}
// RFC date → ISO (client formats DD/MM/YYYY); '' when unparsable.
function mbx_date_iso($raw)
{
    $t = $raw !== '' ? strtotime($raw) : false;
    return $t ? date('Y-m-d H:i:s', $t) : '';
}
// Open + login + UIDL, or json_out an error the UI can show verbatim.
function mbx_open_listed()
{
    $conn = pop3_open();
    if (isset($conn['error'])) {
        json_out(['error' => $conn['error']], 502);
    }
    $fp = $conn['fp'];
    fwrite($fp, "UIDL\r\n");
    $first = fgets($fp, 1024);
    if (!is_string($first) || $first === '' || $first[0] !== '+') {
        fclose($fp);
        json_out(['error' => 'Mailbox does not support UIDL'], 502);
    }
    $clean = false;
    $uidl = pop3_parse_uidl(pop3_multiline($fp, $clean, 1024 * 1024));
    if (!$clean) {
        fclose($fp);
        json_out(['error' => 'Mailbox read timed out — try again'], 502);
    }
    return [$fp, $uidl];
}
function mbx_quit($fp)
{
    @fwrite($fp, "QUIT\r\n");
    @fgets($fp, 512);
    @fclose($fp);
}

// ---- actions ----------------------------------------------------------------

if ($action === 'list') {
    [$fp, $uidl] = mbx_open_listed();
    // Newest last in POP3 numbering — show the most recent 30.
    $nos = array_keys($uidl);
    rsort($nos);
    $nos = array_slice($nos, 0, 30);
    $seen = mbx_seen_uids();
    $out = [];
    foreach ($nos as $no) {
        fwrite($fp, "TOP {$no} 0\r\n");
        $first = fgets($fp, 1024);
        if (!is_string($first) || $first === '' || $first[0] !== '+') {
            continue; // TOP unsupported for this message — skip it, keep going
        }
        $clean = false;
        $head = pop3_multiline($fp, $clean, 64 * 1024);
        if (!$clean) {
            break; // stream desynced — return what we have
        }
        $out[] = [
            'uid' => $uidl[$no],
            'from' => mailbox_from_addr(mbx_header($head, 'From')),
            'fromRaw' => mailbox_decode_subject(mbx_header($head, 'From')),
            'subject' => mailbox_decode_subject(mbx_header($head, 'Subject')) ?: '(no subject)',
            'date' => mbx_date_iso(mbx_header($head, 'Date')),
            'seen' => in_array($uidl[$no], $seen, true),
        ];
    }
    mbx_quit($fp);
    json_out(['ok' => true, 'messages' => $out, 'total' => count($uidl)]);
}

if ($action === 'read') {
    $uid = clean($in['uid'] ?? '');
    if ($uid === '') {
        json_out(['error' => 'Missing message id'], 400);
    }
    [$fp, $uidl] = mbx_open_listed();
    $no = array_search($uid, $uidl, true);
    if ($no === false) {
        mbx_quit($fp);
        json_out(['error' => 'That message is no longer in the mailbox.'], 404);
    }
    fwrite($fp, "RETR {$no}\r\n");
    $first = fgets($fp, 1024);
    if (!is_string($first) || $first === '' || $first[0] !== '+') {
        mbx_quit($fp);
        json_out(['error' => 'Could not fetch the message'], 502);
    }
    $clean = false;
    $raw = pop3_multiline($fp, $clean, 1024 * 1024);
    mbx_quit($fp);
    if (!$clean) {
        json_out(['error' => 'Mailbox read timed out — try again'], 502);
    }
    [$head] = array_pad(explode("\n\n", str_replace("\r\n", "\n", $raw), 2), 1, '');
    $parsed = parse_email_message($raw); // tested MIME → decoded TEXT part
    $seen = mbx_seen_uids();
    if (!in_array($uid, $seen, true)) {
        $seen[] = $uid;
        mbx_seen_save($seen);
    }
    json_out([
        'ok' => true,
        'uid' => $uid,
        'from' => mailbox_from_addr($parsed['from']),
        'fromRaw' => mailbox_decode_subject($parsed['from']),
        'to' => mailbox_decode_subject(mbx_header($head, 'To')),
        'date' => mbx_date_iso(mbx_header($head, 'Date')),
        'subject' => $parsed['subject'] !== '' ? $parsed['subject'] : '(no subject)',
        'body' => $parsed['body'], // text only — the client escapes it
    ]);
}

if ($action === 'send') {
    $to = clean($in['to'] ?? '');
    $subject = trim((string) ($in['subject'] ?? ''));
    $bodyText = trim((string) ($in['body'] ?? ''));
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        json_out(['error' => 'Please enter a valid "To" email address.'], 400);
    }
    if ($subject === '' || $bodyText === '') {
        json_out(['error' => 'A subject and a message are both required.'], 400);
    }
    if (strlen($subject) > 300 || strlen($bodyText) > 20000) {
        json_out(['error' => 'That message is too long.'], 400);
    }
    // The branded HTML part — same coastal shell as every site email.
    $esc = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
    $paras = array_filter(array_map('trim', preg_split('/\n{2,}/', $bodyText)));
    $inner = '';
    foreach ($paras as $p) {
        $inner .= email_p(nl2br($esc($p)));
    }
    $html = email_shell($subject, $inner);
    $r = smtp_send($to, '', $subject, $bodyText, $html);
    if (empty($r['ok'])) {
        json_out(['error' => "Couldn't send: " . ($r['error'] ?? 'unknown error')], 502);
    }
    log_activity('email', 'email.mailbox_send', 'Email sent from the admin mailbox to ' . $to, [
        'actor' => 'owner',
        'entity' => 'mailbox',
        'entity_id' => $to,
    ]);
    json_out(['ok' => true]);
}

if ($action === 'delete') {
    $uid = clean($in['uid'] ?? '');
    if ($uid === '') {
        json_out(['error' => 'Missing message id'], 400);
    }
    [$fp, $uidl] = mbx_open_listed();
    $no = array_search($uid, $uidl, true);
    if ($no === false) {
        mbx_quit($fp);
        json_out(['error' => 'That message is no longer in the mailbox.'], 404);
    }
    fwrite($fp, "DELE {$no}\r\n");
    $first = fgets($fp, 1024);
    $ok = is_string($first) && $first !== '' && $first[0] === '+';
    mbx_quit($fp); // QUIT commits the deletion
    if (!$ok) {
        json_out(['error' => 'The mailbox refused the delete.'], 502);
    }
    log_activity('email', 'email.mailbox_delete', 'Email deleted from the admin mailbox', [
        'actor' => 'owner',
        'entity' => 'mailbox',
        'entity_id' => $uid,
    ]);
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
