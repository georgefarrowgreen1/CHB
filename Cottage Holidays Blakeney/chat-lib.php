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
    function mailbox_pop_host()
    {
        if (defined('MAIL_POP_HOST') && MAIL_POP_HOST) {
            return MAIL_POP_HOST;
        }
        $h = defined('SMTP_HOST') ? SMTP_HOST : '';
        if ($h === '') {
            return '';
        }
        if (stripos($h, 'smtp.') === 0) {
            return 'pop.' . substr($h, 5);
        }
        if (stripos($h, 'smtp') === 0) {
            return 'pop' . substr($h, 4);
        }
        return 'pop.' . $h;
    }
}
if (!function_exists('mailbox_auto_enabled')) {
    function mailbox_auto_enabled()
    {
        return defined('MAIL_ENABLED') &&
            MAIL_ENABLED &&
            defined('SMTP_USER') &&
            SMTP_USER &&
            defined('SMTP_PASS') &&
            SMTP_PASS &&
            SMTP_PASS !== 'CHANGE_ME' &&
            !(defined('REPLY_INBOX') && REPLY_INBOX);
    }
}

// Keep only what the owner typed above the quoted history / signature when they
// reply to a notification email. Pure + unit-tested (test-reply.php).
if (!function_exists('strip_quoted_reply')) {
    function strip_quoted_reply($text)
    {
        $text = str_replace(["\r\n", "\r"], "\n", (string) $text);
        $len = strlen($text);
        $cut = $len;

        // (a) The attribution line that precedes a quote — matched across a possible
        //     line-wrap ("On 4 Jul 2026, at 19:59, Cottage Holidays Blakeney\n
        //     <bookings@…> wrote:"), which is why the old single-line regex missed it.
        if (preg_match('/(^|\n)(On .{0,300}?wrote:)/si', $text, $m, PREG_OFFSET_CAPTURE)) {
            $cut = min($cut, $m[2][1]);
        }
        // (b) Other client dividers before the quoted original.
        foreach (
            [
                '-----Original Message-----',
                'Begin forwarded message:',
                '________________________________',
                'Reply above this line',
            ]
            as $sep
        ) {
            $p = stripos($text, $sep);
            if ($p !== false) {
                $cut = min($cut, $p);
            }
        }
        // (b2) Outlook top-post: a "From: … / Sent:|Date: … / [To/Cc: …] / Subject: …"
        //      header block introduces the quoted original with no ">" or attribution.
        //      The full block is a strong signature (a genuine reply won't contain it),
        //      so cutting at the "From:" is safe from over-trimming.
        if (
            preg_match(
                '/(^|\n)\s*From:\s.+\n\s*(Sent|Date):\s.+\n(\s*(To|Cc):\s.+\n)*\s*Subject:\s/i',
                $text,
                $m,
                PREG_OFFSET_CAPTURE,
            )
        ) {
            $cut = min($cut, $m[1][1] + strlen($m[1][0]));
        }
        // (c) Belt-and-braces: the exact FIRST LINE of a quoted copy of one of our
        //     own notification/relay emails — so even an odd client that quotes with
        //     no ">" prefix and no attribution still gets trimmed. Only these
        //     unambiguous openers (a real reply would never contain them); the softer
        //     phrases were dropped so they can't clip a genuine reply. The cut is at
        //     the start of the opener's LINE, because a named reply's opener starts
        //     with the name ("Sophia replied in your chat with …").
        foreach (
            [
                'Someone has sent you a message via the website chat',
                'You have a new message from Cottage Holidays Blakeney',
                'replied in your chat with Cottage Holidays Blakeney',
            ]
            as $mk
        ) {
            $p = stripos($text, $mk);
            if ($p !== false) {
                $nl = strrpos(substr($text, 0, $p), "\n");
                $cut = min($cut, $nl === false ? 0 : $nl + 1);
            }
        }
        $text = substr($text, 0, $cut);

        // Line cleanup on what's left: drop any ">" quoted lines and the signature.
        $out = [];
        foreach (explode("\n", $text) as $ln) {
            $t = trim($ln);
            if ($t === '-- ' || $t === '--') {
                break;
            } // signature delimiter
            if ($t === '_' || preg_match('/^_{5,}$/', $t)) {
                break;
            } // divider
            // Common mail-client sign-offs (no "-- " delimiter): "Sent from my
            // iPhone/iPad/Samsung…", "Get Outlook for iOS", "Sent from Mail for
            // Windows", etc. Everything from such a line down is auto-signature.
            if (
                preg_match(
                    '/^(sent from (my |mail for |outlook|yahoo|samsung|the all-new )|sent using |sent via |get outlook for )/i',
                    $t,
                )
            ) {
                break;
            }
            if (strpos($t, '>') === 0) {
                continue;
            } // quoted line
            $out[] = $ln;
        }
        while ($out && trim($out[count($out) - 1]) === '') {
            array_pop($out);
        }
        return trim(implode("\n", $out));
    }
}

// Idempotency guard: is $body already the most recent message in this thread?
// Used by BOTH inbound paths (POP3 poll + webhook) so a provider retry or a poll
// race can't post the same reply twice. Back-office sends stay unguarded (those
// are intentional).
if (!function_exists('chat_last_message_is')) {
    function chat_last_message_is($threadId, $body)
    {
        try {
            $s = db()->prepare('SELECT body FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1');
            $s->execute([(int) $threadId]);
            $last = $s->fetchColumn();
            return $last !== false && trim((string) $last) === trim((string) $body);
        } catch (\Throwable $e) {
            return false;
        }
    }
}

// ---- Who answers the guest chat ----
// The away reply's state at an hour: 'off' (the switch is off), 'always' (on, with
// no hours set), 'away' (outside the owner's hours) or 'in' (inside them). $from and
// $to are the stored hours ('07', '22'), both set or neither; a window that runs
// past midnight wraps. Pure: chat_maybe_autoreply and the chat's header both ask it.
if (!function_exists('chat_away_at')) {
    function chat_away_at($enabled, $from, $to, $hour)
    {
        if ((string) $enabled !== '1') {
            return 'off';
        }
        $from = (string) $from;
        $to = (string) $to;
        if ($from === '' || $to === '') {
            return 'always';
        }
        $h = (int) $hour;
        $f = (int) $from;
        $t = (int) $to;
        $in = $f <= $t ? $h >= $f && $h < $t : $h >= $f || $h < $t;
        return $in ? 'in' : 'away';
    }
}
// What the chat's header says about now. Only an away reply WITH hours knows when
// someone is back, so only that reads "Away until 7am"; the hour is sent as a number
// and the page words it.
if (!function_exists('chat_away_state')) {
    function chat_away_state()
    {
        $s = chat_away_at(
            content_value('chat-away-enabled'),
            content_value('chat-away-from'),
            content_value('chat-away-to'),
            (int) date('G'),
        );
        return ['on' => $s === 'away', 'until' => $s === 'away' ? (int) content_value('chat-away-to') : null];
    }
}
// Every back-office person, once a request ($fresh after a change).
if (!function_exists('chat_team_rows')) {
    function chat_team_rows($fresh = false)
    {
        static $rows = null;
        if ($rows === null || $fresh) {
            try {
                $rows = db()->query('SELECT * FROM admins ORDER BY id')->fetchAll();
            } catch (\Throwable $e) {
                $rows = [];
            }
        }
        return $rows;
    }
}
// Is this person shown to guests in the chat? Signed in (not invited, not removed),
// allowed to reply to guests, named (a first owner with no name set would read as
// their username), and with "Show me in the guest chat" on. A database without the
// switch yet shows nobody, so the chat reads as it always has: signed with the crown.
if (!function_exists('chat_team_member_ok')) {
    function chat_team_member_ok($row)
    {
        return is_array($row) &&
            empty($row['removed_at']) &&
            empty($row['invited_at']) &&
            trim((string) ($row['name'] ?? '')) !== '' &&
            array_key_exists('chat_show', $row) &&
            (int) $row['chat_show'] === 1 &&
            people_can($row, 'gu.reply');
    }
}
// Is this the host the cottage pages name (content 'host-name', its first word)?
if (!function_exists('chat_team_is_host')) {
    function chat_team_is_host($row, $hostName)
    {
        $h = preg_split('/\s+/', trim((string) $hostName));
        return is_array($h) && $h[0] !== '' && strcasecmp(people_first_name($row), $h[0]) === 0;
    }
}
// The line under a name: the person's own, else "Host" for the host, else none.
if (!function_exists('chat_team_line')) {
    function chat_team_line($row, $hostName)
    {
        $line = trim((string) ($row['chat_line'] ?? ''));
        if ($line !== '') {
            return $line;
        }
        return chat_team_is_host($row, $hostName) ? 'Host' : '';
    }
}
// A person's photo version ('' when they have none): the photo itself is served by
// avatar.php?team=<id>, which asks chat_team_member_ok again.
if (!function_exists('chat_team_photo_v')) {
    function chat_team_photo_v($row)
    {
        $p = (string) ($row['photo'] ?? '');
        return preg_match('/^[a-f0-9]{32}\.jpg$/', $p) ? substr($p, 0, 10) : '';
    }
}
// What a guest is shown: each person's first name, line and photo version. The host
// comes first, then everyone else in the order they joined.
if (!function_exists('chat_team')) {
    function chat_team($fresh = false)
    {
        $host = (string) content_value('host-name');
        $out = [];
        foreach (chat_team_rows($fresh) as $r) {
            if (!chat_team_member_ok($r)) {
                continue;
            }
            $out[] = [
                'id' => (int) $r['id'],
                'name' => people_first_name($r),
                'line' => chat_team_line($r, $host),
                'v' => chat_team_photo_v($r),
                'host' => chat_team_is_host($r, $host),
            ];
        }
        usort($out, fn($a, $b) => $a['host'] === $b['host'] ? $a['id'] <=> $b['id'] : ($a['host'] ? -1 : 1));
        return array_map(fn($m) => ['id' => $m['id'], 'name' => $m['name'], 'line' => $m['line'], 'v' => $m['v']], $out);
    }
}
// The ids a guest may see as an author: the team's. Anyone else's message (someone
// switched off, removed, or from before this) is signed with the crown.
if (!function_exists('chat_team_ids')) {
    function chat_team_ids()
    {
        $ids = [];
        foreach (chat_team_rows() as $r) {
            if (chat_team_member_ok($r)) {
                $ids[(int) $r['id']] = true;
            }
        }
        return $ids;
    }
}
// The first name a guest's reply email is signed with: the author's, while they are
// shown in the chat; '' otherwise (the email then speaks for the business).
if (!function_exists('chat_author_name')) {
    function chat_author_name($adminId)
    {
        $adminId = (int) $adminId;
        if ($adminId <= 0 || !function_exists('admin_row')) {
            return '';
        }
        $r = admin_row($adminId);
        return chat_team_member_ok($r) ? people_first_name($r) : '';
    }
}
// Write an owner-side message: typed by $adminId (0: no one's sign-in), of $kind ''
// (typed), 'auto' (the away reply) or 'event' (something emailed from the chat). On a
// database without the two columns yet it is written as before, unsigned, rather
// than not at all. Returns the new message's id.
if (!function_exists('chat_insert_owner_message')) {
    function chat_insert_owner_message($threadId, $body, $adminId = 0, $kind = '')
    {
        try {
            db()
                ->prepare(
                    "INSERT INTO messages (thread_id, sender_role, body, read_by_admin, read_by_guest, admin_id, kind) VALUES (?, 'admin', ?, 1, 0, ?, ?)",
                )
                ->execute([(int) $threadId, $body, (int) $adminId > 0 ? (int) $adminId : null, (string) $kind]);
        } catch (\Throwable $e) {
            if (!db_schema_missing($e)) {
                throw $e;
            }
            db()
                ->prepare(
                    "INSERT INTO messages (thread_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?, 'admin', ?, 1, 0)",
                )
                ->execute([(int) $threadId, $body]);
        }
        return (int) db()->lastInsertId();
    }
}

// Post an owner/admin reply into a thread AND deliver it to the guest: it shows
// on the website chat (an 'admin' message) and is emailed to the guest. If
// reply-by-email is configured, the guest's email carries a Reply-To that routes
// their reply straight back into this same thread.
if (!function_exists('chat_admin_reply')) {
    // $actor: who replied ('admin:<id>'), which signs the message. '' leaves it signed
    // by the business (the crown), and the activity log then credits whoever is
    // signed in, else the owner.
    function chat_admin_reply($threadId, $bodyTxt, $attachment = '', $actor = '')
    {
        $threadId = (int) $threadId;
        $bodyTxt = mb_substr(trim((string) $bodyTxt), 0, 4000);
        // Shape-check the attachment defensively (belt-and-braces on top of the
        // endpoint's own validation); a reply may be image-only.
        $attachment = trim((string) $attachment);
        if ($attachment !== '' && !preg_match('#^uploads/[A-Za-z0-9._-]+\.(jpe?g|png|gif|webp)$#i', $attachment)) {
            $attachment = '';
        }
        if ($threadId <= 0 || ($bodyTxt === '' && $attachment === '')) {
            return false;
        }
        // Who wrote it, as the caller names them: the back office passes the person
        // signed in, a reply by email the person it came from. Never guessed from the
        // session: a reply by email from an extra address, polled while someone else
        // is signed in, would otherwise go out under their name. Unknown is the crown.
        $adminId = preg_match('/^admin:(\d+)$/', (string) $actor, $am) ? (int) $am[1] : 0;
        $mid = chat_insert_owner_message($threadId, $bodyTxt, $adminId);
        if ($attachment !== '') {
            // Guarded so a pre-migration DB (no attachment column) still delivers the reply.
            try {
                db()->prepare('UPDATE messages SET attachment = ? WHERE id = ?')->execute([$attachment, $mid]);
            } catch (\Throwable $e) {
            }
        }
        db()
            ->prepare('UPDATE chat_threads SET updated_at = NOW() WHERE id = ?')
            ->execute([$threadId]);
        $logBody = $bodyTxt !== '' ? $bodyTxt : '📷 Photo';
        if (function_exists('log_activity')) {
            // Whoever is signed in replied; a reply by EMAIL names the person whose
            // address it came from, and one from no one's sign-in is the owner's.
            log_activity('comms', 'message.reply', 'Replied to a guest chat', [
                'actor' => $actor !== '' ? (string) $actor : (!empty($_SESSION['admin_id']) ? 'admin:' . (int) $_SESSION['admin_id'] : 'owner'),
                'entity' => 'thread',
                'entity_id' => (string) $threadId,
                'meta' => ['detail' => mb_substr($logBody, 0, 120)],
            ]);
        }
        try {
            $t = db()->prepare('SELECT name, email FROM chat_threads WHERE id = ?');
            $t->execute([$threadId]);
            $thread = $t->fetch();
            if ($thread && !empty($thread['email'])) {
                require_once __DIR__ . '/mailer.php';
                if (function_exists('smtp_send')) {
                    // The GUEST's copy carries a GUEST token — it routes their reply back as
                    // a guest message and can never authorise one in the owner's name.
                    $replyAddr = function_exists('msg_reply_address') ? msg_reply_address($threadId, 'guest') : '';
                    $msgId =
                        $replyAddr && function_exists('msg_reply_token') ? 'msg.' . msg_reply_token($threadId, 'guest') : null;
                    $photoUrl =
                        $attachment !== '' && function_exists('site_base_url')
                            ? rtrim(site_base_url(), '/') . '/' . $attachment
                            : '';
                    // Composed by guest_chat_body() in mailer.php — previewable, and the
                    // render gate proves it builds. Signed by the author while they are
                    // shown in the chat ("Sophia replied"), else by the business.
                    $m = guest_chat_body($thread['name'] ?? '', $logBody, $photoUrl, $replyAddr !== '', chat_author_name($adminId));
                    smtp_send(
                        $thread['email'],
                        $thread['name'] ?: 'there',
                        $m['subject'],
                        $m['text'],
                        $m['html'],
                        [],
                        $replyAddr ?: null,
                        $msgId,
                    );
                }
            }
        } catch (\Throwable $e) {
        }
        return true;
    }
}

// Does this reply's From address belong to the thread's own guest? Used to route
// a GUEST reply-by-email (they were invited to "just reply to this email") into
// the thread as a guest message instead of dropping it as sender-not-owner.
if (!function_exists('mailbox_reply_is_guest')) {
    function mailbox_reply_is_guest($threadId, $fromAddr)
    {
        $fromAddr = strtolower(trim((string) $fromAddr));
        if ($fromAddr === '' || (int) $threadId <= 0) {
            return false;
        }
        try {
            $s = db()->prepare('SELECT email FROM chat_threads WHERE id = ?');
            $s->execute([(int) $threadId]);
            $em = strtolower(trim((string) $s->fetchColumn()));
            return $em !== '' && $em === $fromAddr;
        } catch (\Throwable $e) {
            return false;
        }
    }
}

// Post a GUEST reply (arrived by email) into the thread + alert the owner, exactly
// as if the guest had typed it in the website chat. Mirrors messages.php's
// chat_notify_owner (which we can't include — it runs the endpoint on include).
if (!function_exists('chat_guest_reply')) {
    function chat_guest_reply($threadId, $bodyTxt)
    {
        $threadId = (int) $threadId;
        $bodyTxt = mb_substr(trim((string) $bodyTxt), 0, 4000);
        if ($threadId <= 0 || $bodyTxt === '') {
            return false;
        }
        db()
            ->prepare(
                "INSERT INTO messages (thread_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?, 'guest', ?, 0, 1)",
            )
            ->execute([$threadId, $bodyTxt]);
        db()
            ->prepare('UPDATE chat_threads SET updated_at = NOW() WHERE id = ?')
            ->execute([$threadId]);
        if (function_exists('log_activity')) {
            log_activity('comms', 'message.guest', 'Guest replied by email', [
                'actor' => 'guest',
                'entity' => 'thread',
                'entity_id' => (string) $threadId,
                'meta' => ['detail' => mb_substr($bodyTxt, 0, 120)],
            ]);
        }
        try {
            $t = db()->prepare('SELECT name, email FROM chat_threads WHERE id = ?');
            $t->execute([$threadId]);
            $th = $t->fetch();
            require_once __DIR__ . '/mailer.php';
            if (function_exists('send_owner')) {
                $replyAddr = function_exists('msg_reply_address') ? msg_reply_address($threadId) : '';
                $msgId = $replyAddr && function_exists('msg_reply_token') ? 'msg.' . msg_reply_token($threadId) : null;
                $subjTag =
                    $replyAddr && function_exists('msg_reply_needs_subject_tag') && msg_reply_needs_subject_tag()
                        ? ' [#' . msg_reply_token($threadId) . ']'
                        : '';
                $m = owner_note_chat_reply(
                    $th['name'] ?? '',
                    $th['email'] ?? '',
                    $bodyTxt,
                    $replyAddr !== '',
                    $subjTag,
                );
                send_people('messages', $m['subject'], $m['text'], null, ['reply_to' => $replyAddr ?: null, 'message_id' => $msgId]);
            }
        } catch (\Throwable $e) {
        }
        try {
            require_once __DIR__ . '/webpush.php';
            if (function_exists('alert_owner')) {
                alert_owner('New message', mb_substr($bodyTxt, 0, 80), ['category' => 'messages', 'tag' => 'messages-' . (int) $threadId, 'url' => './?open=messages']);
            }
        } catch (\Throwable $e) {
        }
        return true;
    }
}
