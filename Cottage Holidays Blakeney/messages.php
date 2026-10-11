<?php
// ============================================================
//  messages.php — owner ↔ visitor messaging, thread-based.
//  A thread belongs to a logged-in guest (guest_id) OR an anonymous visitor
//  (random token kept in their browser). Anonymous threads capture where the
//  visitor came from, a rough location, and their device at first contact.
//
//  PUBLIC (anonymous):
//    POST {action:'thread', token}              -> messages for that token
//    POST {action:'send', token, body, name, email, ref}  -> add (creates thread)
//  GUEST (logged in):
//    POST {action:'thread'} / {action:'send', body}
//  ADMIN:
//    POST {action:'threads'}                    -> all threads (latest + unread + context)
//    POST {action:'needs_reply_count'}          -> {count}: conversations waiting on a reply
//    POST {action:'thread', thread_id}          -> one thread + context + bookings
//    POST {action:'send', thread_id, body}      -> reply
//    POST {action:'unread'}                     -> { count }
//
//  Tables: migration-messages.sql + migration-chat-threads.sql (via migrate.php).
// ============================================================
require_once __DIR__ . '/db.php';

$in = body();
$action = $in['action'] ?? '';
$isAdmin = !empty($_SESSION['admin_id']);
$guestId = current_guest_id();

// $forAdmin: the back office's copy, which names every author. A guest's copy names
// only the people shown in the chat (chat_team_ids); anyone else's message is
// signed with the crown, so a person switched off is never named by an old reply.
function chat_msgs($threadId, $forAdmin = false)
{
    // SELECT * so a pre-migration DB (no `attachment` column yet) still reads
    // fine — the key is simply absent and defaults to ''.
    $s = db()->prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY id ASC');
    $s->execute([$threadId]);
    $rows = $s->fetchAll();
    $shown = null;
    $names = [];
    $out = [];
    foreach ($rows as $r) {
        $by = (int) ($r['admin_id'] ?? 0);
        if ($by > 0 && $r['sender_role'] === 'admin') {
            if ($forAdmin) {
                if (!array_key_exists($by, $names)) {
                    $ar = function_exists('admin_row') ? admin_row($by) : null;
                    $names[$by] = $ar ? people_first_name($ar) : '';
                }
            } else {
                if ($shown === null) {
                    $shown = chat_team_ids();
                }
                if (empty($shown[$by])) {
                    $by = 0;
                }
            }
        } else {
            $by = 0;
        }
        $m = [
            'id' => (int) $r['id'],
            'role' => $r['sender_role'],
            'body' => $r['body'],
            'at' => $r['created_at'],
            // Whether the guest has opened the thread since this was sent — drives
            // the owner-side read receipt on their own replies ('seen').
            'seen' => (int) $r['read_by_guest'] === 1,
            // Whether someone in the back office has read a guest's message: the
            // guest's "Seen" under their own latest message.
            'read' => (int) $r['read_by_admin'] === 1,
            // Optional image attachment (path under uploads/), '' if none.
            'attachment' => $r['attachment'] ?? '',
            // Who wrote an owner-side message (0: the crown) and what it is: '' typed,
            // 'auto' the away reply, 'event' something emailed from the chat.
            'by' => $by,
            'kind' => (string) ($r['kind'] ?? ''),
        ];
        if ($forAdmin) {
            $m['by_name'] = $by > 0 ? $names[$by] : '';
        }
        $out[] = $m;
    }
    return $out;
}
// Accept an attachment path only if it's one our uploader produced and the file
// is really on disk — never trust a client-supplied path beyond that shape.
function chat_valid_attachment($v)
{
    $v = trim((string) $v);
    if ($v === '') {
        return '';
    }
    // A photo uploaded for this message has waited, private, in the staging folder:
    // sending it is what makes it public. A retry of a send that published it but
    // lost its answer finds it already published.
    // ONLY A CHAT PHOTO (chat-upload.php names every one chat-…). Any other file in
    // uploads/ (a cottage's gallery, the hero, a wall photo: their paths are public)
    // named here would ride the message, and deleting the conversation or the
    // account deletes a message's photo, so it would vanish from the site.
    if (preg_match('#^uploads/pending/(chat-[A-Za-z0-9._-]+\.(?:jpe?g|png|gif|webp))$#i', $v, $pm)) {
        $pub = upload_publish($v);
        return $pub !== '' ? $pub : (is_file(__DIR__ . '/uploads/' . $pm[1]) ? 'uploads/' . $pm[1] : '');
    }
    if (!preg_match('#^uploads/chat-[A-Za-z0-9._-]+\.(jpe?g|png|gif|webp)$#i', $v)) {
        return '';
    }
    return is_file(__DIR__ . '/' . $v) ? $v : '';
}
// Set a message's attachment via a guarded UPDATE — kept off the INSERT so the
// core send never breaks on a DB where the column hasn't migrated yet (there it's
// simply a silent no-op; the message still sends, just without the image).
function chat_attach_message($messageId, $att)
{
    if ($att === '' || $messageId <= 0) {
        return;
    }
    try {
        db()->prepare('UPDATE messages SET attachment = ? WHERE id = ?')->execute([$att, $messageId]);
    } catch (\Throwable $e) {
    }
}
// The away reply's standard words. admin.js's GC_AWAY_STD is the same sentence
// (smoke-test holds the two equal): the page shows it, this sends it.
const CHAT_AWAY_DEFAULT = 'Thanks for your message — we’re not at the desk right now, but we’ll reply as soon as we can, usually within a few hours.';
// Away auto-reply: acknowledge a guest who messages when the owner isn't around.
// Gated on the owner's Settings (enabled + message + optional office hours), fires
// at most once per few hours per thread, and never when the owner has just replied.
// Deliberately does NOT mark the guest's message read, so the thread still counts
// as needing a real reply.
function chat_maybe_autoreply($tid)
{
    if ((int) $tid <= 0) {
        return;
    }
    // Optional office hours: if BOTH set, only auto-reply OUTSIDE [from, to)
    // (handles a window that wraps past midnight). chat_away_at is the one rule:
    // the chat's header reads it too, to say "Away until 7am".
    $state = chat_away_at(
        content_value('chat-away-enabled'),
        content_value('chat-away-from'),
        content_value('chat-away-to'),
        (int) date('G'),
    );
    if ($state !== 'away' && $state !== 'always') {
        return; // switched off, or within office hours: the owner's around
    }
    // An empty box sends the standard words. The switch is the owner's decision
    // to reply, and Manage → Guest chat shows these words as the reply; before
    // this an empty box sent NOTHING while the page showed them as if it would.
    $msg = trim((string) content_value('chat-away-msg'));
    if ($msg === '') {
        $msg = CHAT_AWAY_DEFAULT;
    }
    // Cool-down: skip if any admin message (a real reply OR a prior auto-reply)
    // landed in this thread in the last few hours.
    try {
        $c = db()->prepare(
            "SELECT COUNT(*) FROM messages WHERE thread_id = ? AND sender_role = 'admin' AND created_at >= (NOW() - INTERVAL 4 HOUR)",
        );
        $c->execute([(int) $tid]);
        if ((int) $c->fetchColumn() > 0) {
            return;
        }
    } catch (\Throwable $e) {
        return;
    }
    try {
        // Nobody wrote it: the guest's chat draws it as an automatic reply.
        chat_insert_owner_message((int) $tid, mb_substr($msg, 0, 1000), 0, 'auto');
        db()->prepare('UPDATE chat_threads SET updated_at = NOW() WHERE id = ?')->execute([(int) $tid]);
    } catch (\Throwable $e) {
        return;
    }
    // Email it too (best-effort) so an away guest gets it in their inbox.
    try {
        $t = db()->prepare('SELECT name, email FROM chat_threads WHERE id = ?');
        $t->execute([(int) $tid]);
        $th = $t->fetch() ?: [];
        if (!empty($th['email'])) {
            require_once __DIR__ . '/mailer.php';
            if (function_exists('smtp_send')) {
                $name = $th['name'] ?: 'there';
                // Composed by guest_message_body() in mailer.php — previewable, gated.
                $m = guest_message_body($th['name'] ?? '', $msg);
                smtp_send($th['email'], $name, $m['subject'], $m['text'], $m['html']);
            }
        }
    } catch (\Throwable $e) {
    }
}
// IS THIS THREAD'S ADDRESS THE GUEST'S OWN? Only when it belongs to a signed-in
// account whose email has been PROVEN. A website visitor types any name and email
// they like, and an unproven account was registered by whoever typed the address —
// so either could be someone posing as a guest, and the owner must see that before
// replying with a door code. Unreadable reads as not proven.
function chat_thread_verified(array $thread): bool
{
    $gid = (int) ($thread['guest_id'] ?? 0);
    if ($gid <= 0) {
        return false;
    }
    try {
        $q = db()->prepare('SELECT email_verified_at FROM guests WHERE id = ?');
        $q->execute([$gid]);
        return !empty($q->fetchColumn());
    } catch (\Throwable $e) {
        return false;
    }
}
// Is the OTHER party typing right now? $col is a fixed literal — 'admin_typing_at'
// (the guest is reading) or 'guest_typing_at' (the owner is reading). Isolated so a
// pre-migration DB (no typing columns yet) just reports false rather than erroring.
function chat_peer_typing($tid, $col)
{
    try {
        return (bool) db()
            ->query("SELECT ($col >= (NOW() - INTERVAL 8 SECOND)) FROM chat_threads WHERE id = " . (int) $tid)
            ->fetchColumn();
    } catch (\Throwable $e) {
        return false;
    }
}
// Who in the back office is typing to this guest: their id while they are shown in
// the chat ("Sophia is typing"), 0 for anyone else or no one. Only asked once the
// guest's poll already knows someone is typing.
function chat_typing_by($tid)
{
    try {
        $q = db()->prepare('SELECT admin_typing_by FROM chat_threads WHERE id = ?');
        $q->execute([(int) $tid]);
        $by = (int) $q->fetchColumn();
    } catch (\Throwable $e) {
        return 0;
    }
    return $by > 0 && !empty(chat_team_ids()[$by]) ? $by : 0;
}
// What a guest's chat is told beside its messages: who is typing, and, when the page
// asks (it does as the chat opens), who answers and whether they are away now.
function chat_guest_payload($tid, array $in, array $out)
{
    $typing = $tid > 0 && chat_peer_typing($tid, 'admin_typing_at');
    $out['peer_typing'] = $typing;
    $out['typing_by'] = $typing ? chat_typing_by($tid) : 0;
    if (!empty($in['team'])) {
        $out['team'] = chat_team();
        $out['away'] = chat_away_state();
    }
    return $out;
}
function chat_source($ref)
{
    $ref = trim((string) $ref);
    if ($ref === '') {
        $ref = $_SERVER['HTTP_REFERER'] ?? '';
    }
    if ($ref === '') {
        return 'Direct / unknown';
    }
    $h = parse_url($ref, PHP_URL_HOST);
    if (!$h) {
        return 'Direct / unknown';
    }
    $h = strtolower(preg_replace('/^www\./', '', $h));
    $self = strtolower(
        preg_replace('/^www\./', '', (string) parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST)),
    );
    return $h === $self ? 'Direct' : mb_substr($h, 0, 190);
}
function chat_location()
{
    $country =
        $_SERVER['GEOIP_COUNTRY_NAME'] ?? ($_SERVER['HTTP_CF_IPCOUNTRY'] ?? ($_SERVER['GEOIP_COUNTRY_CODE'] ?? ''));
    $city = $_SERVER['GEOIP_CITY'] ?? ($_SERVER['HTTP_CF_IPCITY'] ?? '');
    $loc = trim(trim($city) . ($city && $country ? ', ' : '') . trim($country));
    return $loc !== '' ? mb_substr($loc, 0, 120) : null;
}
function chat_notify_owner($name, $email, $bodyTxt, $threadId = 0)
{
    log_activity('comms', 'message.guest', 'New chat message from ' . ($name ?: 'a visitor'), [
        'actor' => 'guest',
        'entity' => 'thread',
        'entity_id' => (string) $threadId,
        'meta' => ['detail' => mb_substr($bodyTxt, 0, 120)],
    ]);
    // At most 20 owner alerts an hour from one conversation. Every message is
    // still saved and logged; past that, the email and the buzz stop until it calms.
    if ($threadId > 0) {
        try {
            $q = db()->prepare("SELECT COUNT(*) FROM activity_log WHERE action = 'message.guest' AND entity = 'thread' AND entity_id = ? AND created_at > (NOW() - INTERVAL 1 HOUR)");
            $q->execute([(string) $threadId]);
            if ((int) $q->fetchColumn() > 20) {
                return;
            }
        } catch (\Throwable $e) {
        }
    }
    try {
        require_once __DIR__ . '/mailer.php';
        if (function_exists('send_owner')) {
            // If reply-by-email is configured, route replies to the inbound mailbox
            // (plus-addressed with the thread token) and echo the token in the
            // Message-ID so the reply's In-Reply-To carries it back to us. The extra
            // line tells the owner they can just reply.
            $replyAddr = $threadId > 0 && function_exists('msg_reply_address') ? msg_reply_address($threadId) : '';
            $msgId = $replyAddr && function_exists('msg_reply_token') ? 'msg.' . msg_reply_token($threadId) : null;
            // Zero-setup (POP3) route matches the token from headers/subject, so tag
            // the subject as a fallback; the webhook route uses the plus-address.
            $subjTag =
                $replyAddr && function_exists('msg_reply_needs_subject_tag') && msg_reply_needs_subject_tag()
                    ? ' [#' . msg_reply_token($threadId) . ']'
                    : '';
            $m = owner_note_chat_new($name, $email, $bodyTxt, $replyAddr !== '', $subjTag);
            send_people('messages', $m['subject'], $m['text'], null, ['reply_to' => $replyAddr ?: null, 'message_id' => $msgId]);
        }
    } catch (\Throwable $e) {
    }
    // Wake the owner's devices (best-effort).
    try {
        require_once __DIR__ . '/webpush.php';
        // One tag PER CONVERSATION: with one shared tag, a second guest's message
        // replaced the first's notification, so one of them was never seen.
        alert_owner('New message', ($name ?: 'A visitor') . ': ' . mb_substr($bodyTxt, 0, 80), ['category' => 'messages', 'tag' => 'messages-' . (int) $threadId, 'url' => './?open=messages']);
    } catch (\Throwable $e) {
    }
}

// Notify the owner of a new guest message AFTER the guest has been told their
// message was sent. The owner email + web push can each be slow, and making the
// guest wait on them risks a host gateway timeout (a 500) even though the message
// was already saved. So we flush the guest's response first (fastcgi_finish_request)
// and do the notify + any auto-reply in the background. Mirrors chat_nudge_mailbox.
function chat_notify_owner_deferred($name, $email, $bodyTxt, $tid)
{
    register_shutdown_function(function () use ($name, $email, $bodyTxt, $tid) {
        if (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        }
        try {
            chat_notify_owner($name, $email, $bodyTxt, $tid);
        } catch (\Throwable $e) {
        }
        try {
            chat_maybe_autoreply($tid);
        } catch (\Throwable $e) {
        }
    });
}

// chat_admin_reply() (posts an owner reply to the thread + emails the guest) is
// shared with the reply-by-email gateway; it lives in chat-lib.php.
require_once __DIR__ . '/chat-lib.php';

// Reply-by-email is normally pulled from the mailbox only when the owner opens the
// back office or by the daily cron — so an owner replying from their phone could sit
// unseen for hours. When a GUEST is actively in the chat (it polls every ~8s), nudge
// the mailbox read in the BACKGROUND after we've answered them: poll_mailbox_replies()
// is throttled + advisory-locked, so this stays cheap (≤1 POP3 fetch per throttle
// window) yet pulls an emailed reply into the thread within seconds of them looking.
function chat_nudge_mailbox()
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    require_once __DIR__ . '/mailbox-read.php'; // endpoint block is basename-guarded → just defines functions
    if (!function_exists('mailbox_auto_enabled') || !mailbox_auto_enabled()) {
        return;
    }
    register_shutdown_function(function () {
        if (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request(); // send the guest their thread first; poll after
        }
        try {
            poll_mailbox_replies();
        } catch (\Throwable $e) {
        }
    });
}

// ---------------- ADMIN ----------------
// Admin *tools* never carry a visitor token. If a token is present the request
// is coming from the floating chat widget (e.g. the owner testing it while also
// logged in), so let it fall through to the visitor path instead of erroring.
if ($isAdmin && empty($in['token'])) {
    require_admin(); // admin session + CSRF token (the inline $isAdmin check skipped CSRF)
    try {
        if ($action === 'typing') {
            // Owner is composing → stamp the thread so the guest's poll shows "typing…".
            $tid = (int) ($in['thread_id'] ?? 0);
            if ($tid > 0) {
                try {
                    // Who is typing, so the guest reads "Sophia is typing".
                    db()
                        ->prepare('UPDATE chat_threads SET admin_typing_at = NOW(), admin_typing_by = ? WHERE id = ?')
                        ->execute([(int) $_SESSION['admin_id'], $tid]);
                } catch (\Throwable $e) {
                    try {
                        db()
                            ->prepare('UPDATE chat_threads SET admin_typing_at = NOW() WHERE id = ?')
                            ->execute([$tid]);
                    } catch (\Throwable $e2) {
                        // typing columns not migrated yet — silently no-op
                    }
                }
            }
            json_out(['ok' => true]);
        }
        // Who answers the guest chat: everyone who may reply to guests, with their
        // "Show me in the guest chat" switch and the line under their name, plus
        // exactly what a guest is shown (the same composer the guest's chat reads).
        if ($action === 'team' || $action === 'set_member') {
            $me = admin_me();
            if ($action === 'set_member') {
                $id = (int) ($in['id'] ?? 0);
                $target = $id > 0 ? admin_row($id, true) : null;
                if (!$target || !empty($target['removed_at'])) {
                    json_out(['error' => 'That person isn’t in the back office any more.'], 404);
                }
                // Your own row is yours; anyone else's is a Super User's.
                if ($id !== (int) ($me['id'] ?? 0) && !people_is_full($me)) {
                    json_out(['error' => people_refusal(admin_owner_first()), 'code' => 'not_allowed'], 403);
                }
                if (!array_key_exists('chat_show', $target)) {
                    json_out(['error' => 'Run the migrations first (Manage → System check).'], 409);
                }
                $sets = [];
                $vals = [];
                if (array_key_exists('show', $in)) {
                    $sets[] = 'chat_show = ?';
                    $vals[] = !empty($in['show']) ? 1 : 0;
                }
                if (array_key_exists('line', $in)) {
                    // One line of plain text: runs of space (a pasted newline among
                    // them) become one, and other control characters go.
                    $line = trim((string) preg_replace(['/\s+/u', '/[\x00-\x1F\x7F]/u'], [' ', ''], field_text($in['line'] ?? '')));
                    if (mb_strlen($line) > 40) {
                        json_out(['error' => 'Keep the line under the name to 40 characters.'], 400);
                    }
                    $sets[] = 'chat_line = ?';
                    $vals[] = $line;
                }
                if (!$sets) {
                    json_out(['error' => 'Nothing to change.'], 400);
                }
                $vals[] = $id;
                db()->prepare('UPDATE admins SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
                $target = admin_row($id, true);
                log_activity('account', 'people.chat', people_first_name($me ?: []) . ' changed how ' . ($id === (int) ($me['id'] ?? 0) ? 'they appear' : people_first_name($target ?: []) . ' appears') . ' in the guest chat', [
                    'entity' => 'admin',
                    'entity_id' => (string) $id,
                    'meta' => ['shown' => (int) ($target['chat_show'] ?? 0) === 1, 'line' => (string) ($target['chat_line'] ?? '')],
                ]);
            }
            $host = (string) content_value('host-name');
            $members = [];
            foreach (chat_team_rows(true) as $r) {
                if (!empty($r['removed_at']) || !empty($r['invited_at']) || !people_can($r, 'gu.reply')) {
                    continue;
                }
                $members[] = [
                    'id' => (int) $r['id'],
                    'name' => people_display_name($r),
                    'first' => people_first_name($r),
                    'named' => trim((string) ($r['name'] ?? '')) !== '',
                    'show' => (int) ($r['chat_show'] ?? 0) === 1,
                    'line' => chat_team_line($r, $host),
                    'lineSet' => (string) ($r['chat_line'] ?? ''),
                    'host' => chat_team_is_host($r, $host),
                    'v' => chat_team_photo_v($r),
                    'shown' => chat_team_member_ok($r),
                    'you' => (int) $r['id'] === (int) ($me['id'] ?? 0),
                    'canEdit' => (int) $r['id'] === (int) ($me['id'] ?? 0) || people_is_full($me),
                ];
            }
            // The order a guest meets them in: the host first.
            usort($members, fn($a, $b) => $a['host'] === $b['host'] ? $a['id'] <=> $b['id'] : ($a['host'] ? -1 : 1));
            json_out([
                'ok' => true,
                'members' => $members,
                'team' => chat_team(),
                'away' => chat_away_state(),
                'ready' => array_key_exists('chat_show', admin_row((int) ($me['id'] ?? 0)) ?: []),
            ]);
        }
        // Booking-aware one-tap replies: email the guest their arrival info or a
        // secure balance-payment link (reusing the normal senders), then drop a
        // note into the conversation so it's on the record.
        if ($action === 'send_arrival' || $action === 'send_balance') {
            $tid = (int) ($in['thread_id'] ?? 0);
            $bid = (int) ($in['booking_id'] ?? 0);
            if ($tid <= 0 || $bid <= 0) {
                json_out(['error' => 'A thread and a booking are required'], 400);
            }
            require_once __DIR__ . '/mailer.php';
            require_once __DIR__ . '/pricing.php';
            $bk = db()->prepare('SELECT * FROM bookings WHERE id = ?');
            $bk->execute([$bid]);
            $b = $bk->fetch();
            if (!$b) {
                json_out(['error' => 'Booking not found'], 404);
            }
            if (empty($b['email'])) {
                json_out(['error' => 'This booking has no guest email on file.'], 400);
            }
            // ONE GUARD PER EMAIL, WHICHEVER SCREEN SENDS IT. These two sends had none, and
            // the balance logged under a name of its own, so two taps here, or one here and
            // one on the booking page, sent the guest the same email two or three times.
            // The booking page's own guard and log names now (resend_guard, a 409 the chat
            // reads as "they already have it").
            if ($action === 'send_arrival') {
                resend_guard($bid, 'email.arrival', (string) ($b['name'] ?? ''), 'arrival email');
                $res = send_arrival_for_booking($b);
                if (empty($res['ok'])) {
                    json_out(['error' => $res['error'] ?? 'The arrival email failed to send.'], 500);
                }
                // The email never carries the code; it appears on their booking
                // page inside its reveal window, so the note must not promise it.
                // An EVENT: the guest's chat reads "Sophia emailed you the arrival
                // information…", so the note starts with its verb.
                $note = 'Emailed you the arrival information: check-in details and directions. Your entry details will be on your booking page.';
                log_activity('comms', 'email.arrival', 'Arrival info emailed from chat — ' . ($b['name'] ?? ''), [
                    'prop_key' => $b['prop_key'] ?? '',
                    'entity' => 'booking',
                    'entity_id' => (string) $bid,
                ]);
            } else {
                resend_guard($bid, 'payment.request', (string) ($b['name'] ?? ''), 'payment request');
                // The plan's stage (null), as the booking page's request takes: the link
                // carries none, so a 'balance' named here emailed the whole stay over a
                // link that charged the deposit.
                $res = request_booking_payment($b, null);
                if (empty($res['ok'])) {
                    json_out(['error' => $res['error'] ?? 'Could not send the payment link.'], 400);
                }
                $askKind = ($res['kind'] ?? 'balance') === 'deposit' ? 'deposit' : 'balance';
                try {
                    db()
                        ->prepare($askKind === 'deposit'
                            ? 'UPDATE bookings SET deposit_requested_at = COALESCE(deposit_requested_at, NOW()) WHERE id = ?'
                            : 'UPDATE bookings SET balance_requested_at = NOW() WHERE id = ?')
                        ->execute([$bid]);
                } catch (\Throwable $e) {
                }
                $amt = isset($res['amount']) ? ' of £' . number_format((float) $res['amount'], 2) : '';
                $note = 'Emailed you a secure link to pay your ' . $askKind . $amt . '.';
                log_activity('payment', 'payment.request', ucfirst($askKind) . ' payment request emailed from chat — ' . ($b['name'] ?? ''), [
                    'prop_key' => $b['prop_key'] ?? '',
                    'entity' => 'booking',
                    'entity_id' => (string) $bid,
                ]);
            }
            // Post the note as an admin message (no separate email — the info email
            // already went). read_by_admin=1 so it doesn't count as unread to us.
            // An 'event', signed by whoever sent it: one line in the guest's chat,
            // not a bubble pretending to be typed.
            try {
                chat_insert_owner_message($tid, $note, (int) $_SESSION['admin_id'], 'event');
                db()
                    ->prepare('UPDATE chat_threads SET updated_at = NOW() WHERE id = ?')
                    ->execute([$tid]);
            } catch (\Throwable $e) {
            }
            json_out(['ok' => true]);
        }
        if ($action === 'mark_all_read') {
            // One tap from the Inbox: every guest message read (admin side only —
            // guests' own read state is untouched).
            db()->prepare("UPDATE messages SET read_by_admin = 1 WHERE sender_role = 'guest'")->execute();
            json_out(['ok' => true]);
        }
        if ($action === 'thread') {
            $tid = (int) ($in['thread_id'] ?? 0);
            if ($tid <= 0) {
                json_out(['error' => 'thread_id required'], 400);
            }
            db()
                ->prepare("UPDATE messages SET read_by_admin = 1 WHERE thread_id = ? AND sender_role = 'guest'")
                ->execute([$tid]);
            $t = db()->prepare('SELECT * FROM chat_threads WHERE id = ?');
            $t->execute([$tid]);
            $thread = $t->fetch() ?: [];
            $verified = chat_thread_verified($thread);
            // Their bookings (matched by email), if any — and only when the address is
            // PROVEN: anyone can type a guest's email into the website chat, and the
            // bookings beside it would make an impostor read as that guest.
            $bookings = [];
            if ($verified && !empty($thread['email'])) {
                try {
                    $b = db()->prepare(
                        'SELECT id, prop_key, check_in, check_out, payment FROM bookings WHERE email = ? ORDER BY check_in DESC LIMIT 10',
                    );
                    $b->execute([$thread['email']]);
                    $bookings = array_map(
                        fn($r) => [
                            'id' => (int) $r['id'],
                            'prop_key' => $r['prop_key'],
                            'check_in' => $r['check_in'],
                            'check_out' => $r['check_out'],
                            'payment' => $r['payment'],
                        ],
                        $b->fetchAll(),
                    );
                } catch (\Throwable $e) {
                }
            }
            json_out([
                'ok' => true,
                'thread' => [
                    'id' => $tid,
                    'name' => $thread['name'] ?? '',
                    'email' => $thread['email'] ?? '',
                    'source' => $thread['source'] ?? '',
                    'location' => $thread['location'] ?? '',
                    'user_agent' => $thread['user_agent'] ?? '',
                    'is_guest' => !empty($thread['guest_id']),
                    'verified' => $verified,
                    'archived' => !empty($thread['archived']),
                ],
                'bookings' => $bookings,
                'messages' => chat_msgs($tid, true),
                'peer_typing' => chat_peer_typing($tid, 'guest_typing_at'),
            ]);
        }
        if ($action === 'archive' || $action === 'unarchive') {
            $tid = (int) ($in['thread_id'] ?? 0);
            if ($tid <= 0) {
                json_out(['error' => 'thread_id required'], 400);
            }
            try {
                db()
                    ->prepare('UPDATE chat_threads SET archived = ? WHERE id = ?')
                    ->execute([$action === 'archive' ? 1 : 0, $tid]);
            } catch (\Throwable $e) {
                json_out(['error' => 'Run migrate.php to enable archiving.'], 500);
            }
            json_out(['ok' => true]);
        }
        if ($action === 'delete') {
            $tid = (int) ($in['thread_id'] ?? 0);
            if ($tid <= 0) {
                json_out(['error' => 'thread_id required'], 400);
            }
            // The photos go with the conversation: a deleted chat's pictures stayed
            // on the site at their old address, which its emails still carry.
            $atts = [];
            try {
                $aq = db()->prepare("SELECT attachment FROM messages WHERE thread_id = ? AND attachment IS NOT NULL AND attachment <> ''");
                $aq->execute([$tid]);
                $atts = $aq->fetchAll(PDO::FETCH_COLUMN);
            } catch (\Throwable $e) {
            }
            db()
                ->prepare('DELETE FROM messages WHERE thread_id = ?')
                ->execute([$tid]);
            foreach ($atts as $att) {
                upload_delete($att);
            }
            db()
                ->prepare('DELETE FROM chat_threads WHERE id = ?')
                ->execute([$tid]);
            json_out(['ok' => true]);
        }
        if ($action === 'send') {
            // Replay-safe (op ledger): a re-sent chat message is a duplicate the
            // guest reads twice — the INSERT class of replay bug.
            $opTok = op_claim($in);
            $tid = (int) ($in['thread_id'] ?? 0);
            $bodyTxt = mb_substr(trim((string) ($in['body'] ?? '')), 0, 4000);
            $att = chat_valid_attachment($in['attachment'] ?? '');
            if ($tid <= 0 || ($bodyTxt === '' && $att === '')) {
                json_out(['error' => 'A thread and a message are required'], 400);
            }
            // Signed by whoever is sending it: the guest sees their name and photo
            // while they are shown in the chat.
            chat_admin_reply($tid, $bodyTxt, $att, 'admin:' . (int) $_SESSION['admin_id']);
            // Reply sent → clear our typing stamp so the guest doesn't see "typing…"
            // linger under the message that just arrived.
            try {
                db()->prepare('UPDATE chat_threads SET admin_typing_at = NULL WHERE id = ?')->execute([$tid]);
            } catch (\Throwable $e) {
            }
            json_out(op_finish($opTok, ['ok' => true]));
        }
        // How many conversations need a reply — the ONE number Today's strip and the
        // dock read. It used to download every thread there has ever been to count
        // it on the phone (283 KB raw for a five-year business, every Today visit).
        // The same rule as the client's msgNeedsReply: not archived, and the guest
        // spoke last or something they sent is unread.
        if ($action === 'needs_reply_count') {
            $needs = "EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id)
                AND ((SELECT mr.sender_role FROM messages mr WHERE mr.thread_id = t.id ORDER BY mr.id DESC LIMIT 1) = 'guest'
                     OR EXISTS (SELECT 1 FROM messages mu WHERE mu.thread_id = t.id AND mu.sender_role = 'guest' AND mu.read_by_admin = 0))";
            try {
                $c = (int) db()->query("SELECT COUNT(*) FROM chat_threads t WHERE t.archived = 0 AND $needs")->fetchColumn();
            } catch (\Throwable $e3) {
                // archived column not migrated yet — there are no archived threads.
                $c = (int) db()->query("SELECT COUNT(*) FROM chat_threads t WHERE $needs")->fetchColumn();
            }
            json_out(['ok' => true, 'count' => $c]);
        }
        if ($action === 'unread') {
            // Only count unread in NON-archived threads — the thread list hides
            // archived ones, so counting them left the badge lit with no visible
            // thread to clear. (INNER JOIN also drops any legacy thread-less
            // message, which the thread list can't show either — consistent.)
            $c = (int) db()
                ->query("SELECT COUNT(*) FROM messages m JOIN chat_threads t ON t.id = m.thread_id
                         WHERE m.sender_role = 'guest' AND m.read_by_admin = 0 AND t.archived = 0")
                ->fetchColumn();
            json_out(['ok' => true, 'count' => $c]);
        }
        // default: list threads (only those with at least one message).
        // Active by default; pass archived:1 to list the archived ones instead.
        $showArchived = !empty($in['archived']) ? 1 : 0;
        $hasArch = true;
        try {
            $q = db()->prepare("SELECT t.id tid, t.guest_id, t.name, t.email, t.source, t.location, t.archived,
                    (SELECT g.email_verified_at FROM guests g WHERE g.id = t.guest_id) proven_at,
                    COALESCE(MAX(m.created_at), t.created_at) last_at,
                    SUM(m.sender_role = 'guest' AND m.read_by_admin = 0) unread,
                    (SELECT body FROM messages mm WHERE mm.thread_id = t.id ORDER BY mm.id DESC LIMIT 1) last_body,
                    (SELECT sender_role FROM messages mr WHERE mr.thread_id = t.id ORDER BY mr.id DESC LIMIT 1) last_role
                FROM chat_threads t JOIN messages m ON m.thread_id = t.id
                WHERE t.archived = ?
                GROUP BY t.id, t.guest_id, t.name, t.email, t.source, t.location, t.archived
                ORDER BY last_at DESC");
            $q->execute([$showArchived]);
            $rows = $q->fetchAll();
        } catch (\Throwable $e2) {
            // archived column not migrated yet — there are no archived threads.
            if ($showArchived) {
                json_out(['ok' => true, 'threads' => []]);
            }
            $hasArch = false;
            $rows = db()
                ->query(
                    "SELECT t.id tid, t.guest_id, t.name, t.email, t.source, t.location,
                    (SELECT g.email_verified_at FROM guests g WHERE g.id = t.guest_id) proven_at,
                    COALESCE(MAX(m.created_at), t.created_at) last_at,
                    SUM(m.sender_role = 'guest' AND m.read_by_admin = 0) unread,
                    (SELECT body FROM messages mm WHERE mm.thread_id = t.id ORDER BY mm.id DESC LIMIT 1) last_body,
                    (SELECT sender_role FROM messages mr WHERE mr.thread_id = t.id ORDER BY mr.id DESC LIMIT 1) last_role
                FROM chat_threads t JOIN messages m ON m.thread_id = t.id
                GROUP BY t.id, t.guest_id, t.name, t.email, t.source, t.location
                ORDER BY last_at DESC",
                )
                ->fetchAll();
        }
        json_out([
            'ok' => true,
            'threads' => array_map(
                fn($r) => [
                    'thread_id' => (int) $r['tid'],
                    'name' => $r['name'],
                    'email' => $r['email'],
                    'source' => $r['source'],
                    'location' => $r['location'],
                    'is_guest' => !empty($r['guest_id']),
                    // Whether the address is the guest's own (see chat_thread_verified).
                    'verified' => !empty($r['guest_id']) && !empty($r['proven_at']),
                    'archived' => $hasArch ? (int) ($r['archived'] ?? 0) : 0,
                    'last_at' => $r['last_at'],
                    'unread' => (int) $r['unread'],
                    'last_body' => mb_substr((string) $r['last_body'], 0, 120),
                    // Whose message is last — drives the "Needs reply" flag/filter
                    // in the owner inbox (a guest message left unanswered).
                    'last_role' => $r['last_role'] ?? '',
                ],
                $rows,
            ),
        ]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Messages not ready — has migration-chat-threads.sql been run?'], 500);
    }
}

// ---------------- LOGGED-IN GUEST ----------------
if ($guestId) {
    try {
        // Find or create this guest's thread.
        $s = db()->prepare('SELECT id FROM chat_threads WHERE guest_id = ? LIMIT 1');
        $s->execute([$guestId]);
        $tid = (int) ($s->fetchColumn() ?: 0);
        if (!$tid) {
            $g = db()->prepare('SELECT name, email FROM guests WHERE id = ?');
            $g->execute([$guestId]);
            $gg = $g->fetch() ?: [];
            db()
                ->prepare('INSERT INTO chat_threads (guest_id, name, email) VALUES (?,?,?)')
                ->execute([$guestId, $gg['name'] ?? '', $gg['email'] ?? '']);
            $tid = (int) db()->lastInsertId();
        }
        if ($action === 'typing') {
            // Guest is composing → stamp the thread so the owner's poll shows "typing…".
            try {
                db()
                    ->prepare('UPDATE chat_threads SET guest_typing_at = NOW() WHERE id = ?')
                    ->execute([$tid]);
            } catch (\Throwable $e) {
            }
            json_out(['ok' => true]);
        }
        if ($action === 'send') {
            // Replay-safe (op ledger): this is queueOrPost's oldest customer, and
            // its replay path could double-post a guest's message on an ambiguous
            // timeout since the day it was built.
            $opTok = op_claim($in);
            // An account costs nothing to make, and each message emails and pushes
            // the owner: a lively chat stays well inside 30 in ten minutes.
            rate_limit_key('chat-send:g' . (int) $guestId, 30, 10);
            $bodyTxt = mb_substr(trim((string) ($in['body'] ?? '')), 0, 4000);
            $att = chat_valid_attachment($in['attachment'] ?? '');
            if ($bodyTxt === '' && $att === '') {
                json_out(['error' => 'Type a message first'], 400);
            }
            db()
                ->prepare(
                    "INSERT INTO messages (thread_id, guest_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?, ?, 'guest', ?, 0, 1)",
                )
                ->execute([$tid, $guestId, $bodyTxt]);
            $mid = (int) db()->lastInsertId();
            chat_attach_message($mid, $att); // guarded: no-op pre-migration
            db()
                ->prepare('UPDATE chat_threads SET updated_at = NOW() WHERE id = ?')
                ->execute([$tid]);
            try {
                db()->prepare('UPDATE chat_threads SET guest_typing_at = NULL WHERE id = ?')->execute([$tid]);
            } catch (\Throwable $e) {
            }
            $g = db()->prepare('SELECT name, email FROM guests WHERE id = ?');
            $g->execute([$guestId]);
            $gg = $g->fetch() ?: [];
            chat_notify_owner_deferred($gg['name'] ?? '', $gg['email'] ?? '', $bodyTxt !== '' ? $bodyTxt : '📷 Photo', $tid);
            json_out(op_finish($opTok, ['ok' => true]));
        }
        // Guest is polling their thread — pull any emailed owner reply in the background.
        chat_nudge_mailbox();
        db()
            ->prepare("UPDATE messages SET read_by_guest = 1 WHERE thread_id = ? AND sender_role = 'admin'")
            ->execute([$tid]);
        json_out(chat_guest_payload($tid, $in, ['ok' => true, 'messages' => chat_msgs($tid)]));
    } catch (\Throwable $e) {
        json_out(['error' => 'Messages not ready — has migration-chat-threads.sql been run?'], 500);
    }
}

// ---------------- ANONYMOUS VISITOR (token-based) ----------------
$token = preg_replace('/[^a-f0-9]/i', '', (string) ($in['token'] ?? ''));
if (strlen($token) < 16) {
    // No usable token: only a 'send' that supplies name/email can start a thread.
    // A first visit still meets who answers.
    if ($action !== 'send') {
        json_out(chat_guest_payload(0, $in, ['ok' => true, 'messages' => []]));
    }
}
try {
    $tid = 0;
    if (strlen($token) >= 16) {
        $s = db()->prepare('SELECT id FROM chat_threads WHERE token = ? LIMIT 1');
        $s->execute([$token]);
        $tid = (int) ($s->fetchColumn() ?: 0);
    }
    if ($action === 'send') {
        // Anonymous visitor chat — rate-limit per IP (a new thread also emails the
        // owner, so this curbs spam/flooding without affecting logged-in guests).
        rate_limit('chat', 20, 10);
        // Replay-safe (op ledger) — AFTER the rate limit, so a replay still pays
        // the toll and a flood can't ride stored responses around it.
        $opTok = op_claim($in);
        $bodyTxt = mb_substr(trim((string) ($in['body'] ?? '')), 0, 4000);
        $att = chat_valid_attachment($in['attachment'] ?? '');
        if ($bodyTxt === '' && $att === '') {
            json_out(['error' => 'Type a message first'], 400);
        }
        if (!$tid) {
            $name = mb_substr(clean($in['name'] ?? ''), 0, 120);
            $email = mb_substr(clean($in['email'] ?? ''), 0, 190);
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                json_out(['error' => 'Please enter a valid email address.'], 400);
            }
            if (strlen($token) < 16) {
                json_out(['error' => 'Could not start the chat — please reload and try again.'], 400);
            }
            db()
                ->prepare(
                    'INSERT INTO chat_threads (token, name, email, source, location, user_agent) VALUES (?,?,?,?,?,?)',
                )
                ->execute([
                    $token,
                    $name,
                    $email,
                    chat_source($in['ref'] ?? ''),
                    chat_location(),
                    mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
                ]);
            $tid = (int) db()->lastInsertId();
        }
        db()
            ->prepare(
                "INSERT INTO messages (thread_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?, 'guest', ?, 0, 1)",
            )
            ->execute([$tid, $bodyTxt]);
        chat_attach_message((int) db()->lastInsertId(), $att); // guarded: no-op pre-migration
        db()
            ->prepare('UPDATE chat_threads SET updated_at = NOW() WHERE id = ?')
            ->execute([$tid]);
        try {
            db()->prepare('UPDATE chat_threads SET guest_typing_at = NULL WHERE id = ?')->execute([$tid]);
        } catch (\Throwable $e) {
        }
        $t = db()->prepare('SELECT name, email FROM chat_threads WHERE id = ?');
        $t->execute([$tid]);
        $th = $t->fetch() ?: [];
        chat_notify_owner_deferred($th['name'] ?? '', $th['email'] ?? '', $bodyTxt !== '' ? $bodyTxt : '📷 Photo', $tid);
        json_out(op_finish($opTok, ['ok' => true, 'token' => $token]));
    }
    if ($action === 'typing') {
        // Visitor is composing → stamp the thread so the owner's poll shows "typing…".
        if ($tid) {
            try {
                db()
                    ->prepare('UPDATE chat_threads SET guest_typing_at = NOW() WHERE id = ?')
                    ->execute([$tid]);
            } catch (\Throwable $e) {
            }
        }
        json_out(['ok' => true]);
    }
    // thread / default
    if (!$tid) {
        json_out(chat_guest_payload(0, $in, ['ok' => true, 'messages' => []]));
    }
    // Active anonymous thread polling → pull any emailed owner reply in the background.
    chat_nudge_mailbox();
    db()
        ->prepare("UPDATE messages SET read_by_guest = 1 WHERE thread_id = ? AND sender_role = 'admin'")
        ->execute([$tid]);
    json_out(chat_guest_payload($tid, $in, ['ok' => true, 'messages' => chat_msgs($tid)]));
} catch (\Throwable $e) {
    json_out(['error' => 'Messages not ready — has migration-chat-threads.sql been run?'], 500);
}
