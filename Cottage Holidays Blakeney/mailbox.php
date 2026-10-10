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

// The attachment download is a plain GET link (an <a download> can't POST);
// everything else stays JSON-POST. require_admin() only checks the CSRF token
// on non-GET methods, so a mutating action reachable by GET would ride the
// SameSite=Lax session cookie with no token — genuine CSRF (send mail from the
// business mailbox, delete a message). Only 'attachment' legitimately needs
// GET; every other action MUST arrive by POST so the header check applies.
$in = $_SERVER['REQUEST_METHOD'] === 'GET' ? $_GET : body();
$action = $in['action'] ?? '';

$MBX_MUTATING = ['send', 'delete', 'delete_sent', 'mark_unread'];
if ($_SERVER['REQUEST_METHOD'] === 'GET' && in_array($action, $MBX_MUTATING, true)) {
    json_out(['error' => 'This action must be sent as a POST.'], 405);
}

// ---- helpers ---------------------------------------------------------------

// One definition, in db.php — mailbox_new_pending() asks the same question and
// cannot require this routed file to do it.
function mbx_seen_uids()
{
    return mailbox_seen_uids();
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
    pop3_release();
}

// Walk a (possibly nested) multipart body and collect NON-text parts that
// carry a filename — the attachments. Returns [{name, mime, size, body}]
// with body still ENCODED; decode on download only (list stays cheap).
function mbx_parse_attachments($body, $ctype)
{
    $out = [];
    if (stripos((string) $ctype, 'multipart/') === false) {
        return $out;
    }
    if (!preg_match('/boundary="?([^";]+)"?/i', $ctype, $m)) {
        return $out;
    }
    $parts = explode('--' . $m[1], str_replace("\r\n", "\n", (string) $body));
    foreach ($parts as $part) {
        $part = ltrim($part, "\n");
        if ($part === '' || $part[0] === '-') {
            continue;
        }
        [$phead, $pbody] = array_pad(explode("\n\n", $part, 2), 2, '');
        $phead = preg_replace('/\n[ \t]+/', ' ', $phead);
        $h = function ($name) use ($phead) {
            return preg_match('/^' . preg_quote($name, '/') . ':\s*(.+)$/mi', $phead, $mm) ? trim($mm[1]) : '';
        };
        $pct = $h('Content-Type');
        // Nested containers recurse; leaves with a filename are attachments.
        if (stripos($pct, 'multipart/') !== false) {
            foreach (mbx_parse_attachments($pbody, $pct) as $a) {
                $out[] = $a;
            }
            continue;
        }
        $disp = $h('Content-Disposition');
        $name = '';
        if (preg_match('/filename\*?="?([^\";]+)"?/i', $disp . ' ' . $pct, $fm)) {
            $name = mailbox_decode_subject(trim($fm[1]));
        }
        if ($name === '') {
            continue; // inline text/html alternatives are not attachments
        }
        $out[] = [
            'name' => $name,
            'mime' => trim(explode(';', $pct)[0]) ?: 'application/octet-stream',
            'cte' => strtolower($h('Content-Transfer-Encoding')),
            'body' => $pbody,
        ];
    }
    return $out;
}
// Fetch one raw message by UIDL (shared by read / attachment).
// The first words of a message, for the Inbox row: TOP fetches the headers and a
// few dozen body lines, the tested MIME parser decodes them, and the reply's own
// words are kept (quoted history and signatures dropped). Never fatal: a
// message that does not parse this way simply has no preview.
function mbx_preview($fp, $no)
{
    try {
        fwrite($fp, "TOP {$no} 40\r\n");
        $first = fgets($fp, 1024);
        if (!is_string($first) || $first === '' || $first[0] !== '+') {
            return '';
        }
        $clean = false;
        $raw = pop3_multiline($fp, $clean, 96 * 1024);
        if (!$clean) {
            return '';
        }
        $parsed = parse_email_message($raw);
        $body = str_replace("\r\n", "\n", (string) ($parsed['body'] ?? ''));
        $keep = [];
        foreach (explode("\n", $body) as $line) {
            $t = trim($line);
            if ($t === '') {
                continue;
            }
            if ($t[0] === '>' || preg_match('/^(On .{6,200} wrote:|-{2,}\s*Original Message|From:\s|Sent from my |--\s*$)/i', $t)) {
                break;
            }
            $keep[] = $t;
            if (strlen(implode(' ', $keep)) > 200) {
                break;
            }
        }
        return mb_substr(implode(' ', $keep), 0, 180);
    } catch (\Throwable $e) {
        return '';
    }
}
function mbx_retr($uid)
{
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
    $raw = pop3_multiline($fp, $clean, 12 * 1024 * 1024);
    mbx_quit($fp);
    if (!$clean) {
        json_out(['error' => 'Mailbox read timed out — try again'], 502);
    }
    return $raw;
}

// ---- actions ----------------------------------------------------------------

// The CHEAP question: how many customer emails are waiting, from the store the
// reply-poll already keeps (mailbox-new minus mailbox-seen). DB only — no POP3
// round trip — so the client's periodic check can ask it freely; the poll
// itself is nudged separately (mailbox-read.php, throttled server-side).
if ($action === 'new') {
    json_out(['ok' => true, 'new' => mailbox_new_pending()]);
}

if ($action === 'list') {
    [$fp, $uidl] = mbx_open_listed();
    // Newest last in POP3 numbering — page through 30 at a time.
    $offset = max(0, (int) ($in['offset'] ?? 0));
    $nos = array_keys($uidl);
    rsort($nos);
    $hasMore = count($nos) > $offset + 30;
    $nos = array_slice($nos, $offset, 30);
    $seen = mbx_seen_uids();
    $out = [];
    $ownHidden = 0;
    $robotHidden = 0;
    $mbxSenders = null;
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
        $fromAddr = mailbox_from_addr(mbx_header($head, 'From'));
        // ONLY CUSTOMER MAIL. The owner reads the same inbox the site sends
        // from, so every alert the site raises lands here too — the list was
        // half our own voice ("New confirmed booking", "New enquiry: …",
        // "Payment received: £612.85"), which is news the back office already
        // shows. They are counted, not silently swallowed: the client says how
        // many were set aside, so an owner who wonders where a mail went has an
        // answer on screen (the no-silent-caps rule).
        if (mailbox_is_self_notification($fromAddr, $head)) {
            $ownHidden++;
            continue;
        }
        // An email the owner wrote answering a guest-chat alert becomes a chat
        // message: mailbox-read.php routes it on the same two facts (an OWNER
        // token, a sender on the allow-list), whichever of their addresses it came
        // from. It is in that guest's conversation already, so listing it too would
        // read as a new person waiting — the owner's own reply. Only this address
        // was covered, and the usual reply comes from the owner's own inbox, where
        // the alert went. One the poll would NOT route stays listed, including a
        // reply to a chat since deleted, which the poll leaves as ordinary mail.
        if ($fromAddr !== '' && in_array($fromAddr, $mbxSenders ??= people_mail_senders(), true)) {
            [$rTid, $rAud] = msg_reply_parse(mailbox_token_in([
                'in_reply_to' => mbx_header($head, 'In-Reply-To'),
                'references' => mbx_header($head, 'References'),
                'subject' => mailbox_decode_subject(mbx_header($head, 'Subject')),
            ]));
            $rLive = false;
            if ($rAud === 'owner' && (int) $rTid > 0) {
                try {
                    $tq = db()->prepare('SELECT 1 FROM chat_threads WHERE id = ?');
                    $tq->execute([(int) $rTid]);
                    $rLive = (bool) $tq->fetchColumn();
                } catch (\Throwable $e) {
                    $rLive = true; // unreadable: as before
                }
            }
            if ($rLive) {
                $ownHidden++;
                continue;
            }
        }
        // …and the same for automated authentication reports (DMARC and friends
        // — mailbox_is_report_robot). Counted on their OWN tally, not folded into
        // $ownHidden: that one means "our own voice", and a report from Google is
        // not our voice. Two facts, two numbers.
        if (mailbox_is_report_robot($fromAddr)) {
            $robotHidden++;
            continue;
        }
        $out[] = [
            'uid' => $uidl[$no],
            'preview' => mbx_preview($fp, $no),
            'from' => $fromAddr,
            'fromRaw' => mailbox_decode_subject(mbx_header($head, 'From')),
            'subject' => mailbox_decode_subject(mbx_header($head, 'Subject')) ?: '(no subject)',
            'date' => mbx_date_iso(mbx_header($head, 'Date')),
            'seen' => in_array($uidl[$no], $seen, true),
        ];
    }
    mbx_quit($fp);
    json_out([
        'ok' => true,
        'messages' => $out,
        'total' => count($uidl),
        'hasMore' => $hasMore,
        'ownHidden' => $ownHidden,
        'robotHidden' => $robotHidden,
    ]);
}

if ($action === 'read') {
    $uid = clean($in['uid'] ?? '');
    if ($uid === '') {
        json_out(['error' => 'Missing message id'], 400);
    }
    $raw = mbx_retr($uid);
    [$head, $rawBody] = array_pad(explode("\n\n", str_replace("\r\n", "\n", $raw), 2), 2, '');
    $atts = mbx_parse_attachments($rawBody, mbx_header($head, 'Content-Type'));
    $parsed = parse_email_message($raw); // tested MIME → decoded TEXT part
    content_locked('mailbox-seen', function () use ($uid) {
        $seen = mbx_seen_uids();
        if (!in_array($uid, $seen, true)) {
            $seen[] = $uid;
            mbx_seen_save($seen);
        }
    });
    json_out([
        'ok' => true,
        'uid' => $uid,
        'from' => mailbox_from_addr($parsed['from']),
        'fromRaw' => mailbox_decode_subject($parsed['from']),
        'to' => mailbox_decode_subject(mbx_header($head, 'To')),
        'date' => mbx_date_iso(mbx_header($head, 'Date')),
        'subject' => $parsed['subject'] !== '' ? $parsed['subject'] : '(no subject)',
        'body' => $parsed['body'], // text only — the client escapes it
        'attachments' => array_map(
            fn($a, $i) => ['i' => $i, 'name' => $a['name'], 'mime' => $a['mime'], 'size' => strlen($a['body'])],
            $atts,
            array_keys($atts),
        ),
    ]);
}

if ($action === 'attachment') {
    $uid = clean($in['uid'] ?? '');
    $idx = max(0, (int) ($in['i'] ?? -1));
    if ($uid === '') {
        json_out(['error' => 'Missing message id'], 400);
    }
    $raw = mbx_retr($uid);
    [$head, $rawBody] = array_pad(explode("\n\n", str_replace("\r\n", "\n", $raw), 2), 2, '');
    $atts = mbx_parse_attachments($rawBody, mbx_header($head, 'Content-Type'));
    if (!isset($atts[$idx])) {
        json_out(['error' => 'No such attachment'], 404);
    }
    $a = $atts[$idx];
    $data = mailbox_decode_body($a['body'], $a['cte']);
    if (strlen($data) > 15 * 1024 * 1024) {
        json_out(['error' => 'Attachment too large to download here'], 413);
    }
    // Force a plain download regardless of the claimed type — never let a
    // hostile attachment render inline in the admin origin.
    $safeName = preg_replace('/[^A-Za-z0-9. _()\-]/', '_', $a['name']) ?: 'attachment';
    header('Content-Type: application/octet-stream');
    header('X-Content-Type-Options: nosniff');
    header('Content-Disposition: attachment; filename="' . $safeName . '"');
    header('Content-Length: ' . strlen($data));
    echo $data;
    exit();
}

if ($action === 'mark_unread') {
    $uid = clean($in['uid'] ?? '');
    if ($uid === '') {
        json_out(['error' => 'Missing message id'], 400);
    }
    content_locked('mailbox-seen', function () use ($uid) {
        mbx_seen_save(array_values(array_diff(mbx_seen_uids(), [$uid])));
    });
    json_out(['ok' => true]);
}

if ($action === 'sent') {
    try {
        $rows = db()
            ->query('SELECT id, to_email, cc_email, subject, body, sent_at FROM mail_sent ORDER BY sent_at DESC, id DESC LIMIT 200')
            ->fetchAll();
    } catch (\Throwable $e) {
        // Table appears after the next migrate run — an empty Sent beats a 500.
        $rows = [];
    }
    json_out(['ok' => true, 'messages' => $rows]);
}

if ($action === 'send') {
    $opTok = op_claim($in); // one email for a retried send (bookings.php's email_guest)
    $to = clean($in['to'] ?? '');
    $subject = trim((string) ($in['subject'] ?? ''));
    $bodyText = trim((string) ($in['body'] ?? ''));
    $cc = clean($in['cc'] ?? '');
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        json_out(['error' => 'Please enter a valid "To" email address.'], 400);
    }
    if ($cc !== '' && !filter_var($cc, FILTER_VALIDATE_EMAIL)) {
        json_out(['error' => 'The CC address doesn’t look right — please check it.'], 400);
    }
    if ($subject === '' || $bodyText === '') {
        json_out(['error' => 'A subject and a message are both required.'], 400);
    }
    if (strlen($subject) > 300 || strlen($bodyText) > 20000) {
        json_out(['error' => 'That message is too long.'], 400);
    }
    // Composed by mailbox_reply_body() in mailer.php — previewable, and the render gate
    // proves it builds.
    $m = mailbox_reply_body($subject, $bodyText);
    $html = $m['html'];
    $r = smtp_send($to, '', $m['subject'], $m['text'], $html);
    if (empty($r['ok'])) {
        json_out(['error' => "Couldn't send: " . ($r['error'] ?? 'unknown error')], 502);
    }
    if ($cc !== '') {
        smtp_send($cc, '', $subject, $bodyText, $html); // best-effort copy
    }
    try {
        db()
            ->prepare('INSERT INTO mail_sent (to_email, cc_email, subject, body) VALUES (?, ?, ?, ?)')
            ->execute([$to, $cc !== '' ? $cc : null, $subject, $bodyText]);
    } catch (\Throwable $e) {
        // Sent ledger appears after the next migrate run; the send itself succeeded.
    }
    log_activity('email', 'email.mailbox_send', 'Email sent from the admin mailbox to ' . $to, [
        'entity' => 'mailbox',
        'entity_id' => $to,
    ]);
    json_out(op_finish($opTok, ['ok' => true]));
}

// Several at once (the Inbox deleting a whole conversation): one session, so the
// mailbox is opened once however many there are. A message already gone counts
// as deleted, because what the owner asked for is already true.
if ($action === 'delete' && is_array($in['uids'] ?? null)) {
    $uids = array_values(array_unique(array_filter(array_map(fn($u) => clean((string) $u), array_slice($in['uids'], 0, 100)))));
    if (!$uids) {
        json_out(['error' => 'Missing message ids'], 400);
    }
    [$fp, $uidl] = mbx_open_listed();
    $refused = 0;
    foreach ($uids as $uid) {
        $no = array_search($uid, $uidl, true);
        if ($no === false) {
            continue;
        }
        fwrite($fp, "DELE {$no}\r\n");
        $first = fgets($fp, 1024);
        if (!(is_string($first) && $first !== '' && $first[0] === '+')) {
            $refused++;
        }
    }
    mbx_quit($fp); // QUIT commits the deletions
    $done = count($uids) - $refused;
    if ($done > 0) {
        log_activity('email', 'email.mailbox_delete', $done === 1 ? 'Email deleted from the admin mailbox' : $done . ' emails deleted from the admin mailbox', [
            'entity' => 'mailbox',
            'entity_id' => $uids[0],
        ]);
    }
    if ($refused) {
        json_out(['error' => 'The mailbox refused to delete ' . ($refused === 1 ? 'one email' : $refused . ' emails') . '.', 'deleted' => $done], 502);
    }
    json_out(['ok' => true, 'deleted' => $done]);
}

// Forget what was sent to one address (the Inbox deleting a conversation). Only
// the Sent list's copies go: a booking's own email history is part of the
// booking and stays with it. No index on to_email, and old rows may carry
// capitals, so the comparison is folded on both sides.
if ($action === 'delete_sent') {
    $to = strtolower(trim((string) ($in['to'] ?? '')));
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        json_out(['error' => 'Missing email address'], 400);
    }
    $n = 0;
    try {
        $st = db()->prepare('DELETE FROM mail_sent WHERE LOWER(to_email) = ?');
        $st->execute([$to]);
        $n = $st->rowCount();
    } catch (\Throwable $e) {
        json_out(['ok' => true, 'deleted' => 0]);
    }
    if ($n > 0) {
        log_activity('email', 'email.sent_delete', ($n === 1 ? 'A sent email' : $n . ' sent emails') . ' to ' . $to . ' deleted', [
            'entity' => 'mailbox',
            'entity_id' => $to,
        ]);
    }
    json_out(['ok' => true, 'deleted' => $n]);
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
        'entity' => 'mailbox',
        'entity_id' => $uid,
    ]);
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
