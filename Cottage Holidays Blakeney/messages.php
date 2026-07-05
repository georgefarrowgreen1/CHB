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

function chat_msgs($threadId)
{
    // SELECT * so a pre-migration DB (no `attachment` column yet) still reads
    // fine — the key is simply absent and defaults to ''.
    $s = db()->prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY id ASC');
    $s->execute([$threadId]);
    return array_map(
        fn($r) => [
            'id' => (int) $r['id'],
            'role' => $r['sender_role'],
            'body' => $r['body'],
            'at' => $r['created_at'],
            // Whether the guest has opened the thread since this was sent — drives
            // the owner-side read receipt on their own replies ('seen').
            'seen' => (int) $r['read_by_guest'] === 1,
            // Optional image attachment (path under uploads/), '' if none.
            'attachment' => $r['attachment'] ?? '',
        ],
        $s->fetchAll(),
    );
}
// Accept an attachment path only if it's one our uploader produced and the file
// is really on disk — never trust a client-supplied path beyond that shape.
function chat_valid_attachment($v)
{
    $v = trim((string) $v);
    if ($v === '') {
        return '';
    }
    if (!preg_match('#^uploads/[A-Za-z0-9._-]+\.(jpe?g|png|gif|webp)$#i', $v)) {
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
    try {
        require_once __DIR__ . '/mailer.php';
        if (function_exists('send_owner')) {
            // If reply-by-email is configured, route replies to the inbound mailbox
            // (plus-addressed with the thread token) and echo the token in the
            // Message-ID so the reply's In-Reply-To carries it back to us. The extra
            // line tells the owner they can just reply.
            $replyAddr = $threadId > 0 && function_exists('msg_reply_address') ? msg_reply_address($threadId) : '';
            $msgId = $replyAddr && function_exists('msg_reply_token') ? 'msg.' . msg_reply_token($threadId) : null;
            $replyHint = $replyAddr
                ? "\nJust reply to this email and the guest gets it on the website and by email."
                : '';
            // Zero-setup (POP3) route matches the token from headers/subject, so tag
            // the subject as a fallback; the webhook route uses the plus-address.
            $subjTag =
                $replyAddr && function_exists('msg_reply_needs_subject_tag') && msg_reply_needs_subject_tag()
                    ? ' [#' . msg_reply_token($threadId) . ']'
                    : '';
            $body =
                "Someone has sent you a message via the website chat.\n\nFrom: " .
                ($name ?: '—') .
                ' (' .
                ($email ?: 'no email') .
                ")\n\n\"" .
                $bodyTxt .
                "\"\n" .
                $replyHint .
                "\nOr open the back office → Guest messages to reply.";
            send_owner(
                'New website message — Cottage Holidays Blakeney' . $subjTag,
                $body,
                null,
                [],
                $replyAddr ?: null,
                $msgId,
            );
        }
    } catch (\Throwable $e) {
    }
    // Wake the owner's devices (best-effort).
    try {
        require_once __DIR__ . '/webpush.php';
        alert_owner('New message', ($name ?: 'A visitor') . ': ' . mb_substr($bodyTxt, 0, 80));
    } catch (\Throwable $e) {
    }
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
                    db()
                        ->prepare('UPDATE chat_threads SET admin_typing_at = NOW() WHERE id = ?')
                        ->execute([$tid]);
                } catch (\Throwable $e) {
                    // typing columns not migrated yet — silently no-op
                }
            }
            json_out(['ok' => true]);
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
            if ($action === 'send_arrival') {
                $res = send_arrival_for_booking($b);
                if (empty($res['ok'])) {
                    json_out(['error' => $res['error'] ?? 'The arrival email failed to send.'], 500);
                }
                $note = "📋 I've emailed your arrival information — check-in details, directions and your door code.";
                log_activity('comms', 'email.arrival', 'Arrival info emailed from chat — ' . ($b['name'] ?? ''), [
                    'prop_key' => $b['prop_key'] ?? '',
                    'entity' => 'booking',
                    'entity_id' => (string) $bid,
                ]);
            } else {
                $res = request_booking_payment($b, 'balance');
                if (empty($res['ok'])) {
                    json_out(['error' => $res['error'] ?? 'Could not send the payment link.'], 400);
                }
                try {
                    db()
                        ->prepare('UPDATE bookings SET balance_requested_at = NOW() WHERE id = ?')
                        ->execute([$bid]);
                } catch (\Throwable $e) {
                }
                $amt = isset($res['amount']) ? ' of £' . number_format((float) $res['amount'], 2) : '';
                $note = "💳 I've sent a secure link to pay your balance" . $amt . ' by email.';
                log_activity('payment', 'email.balance', 'Balance link sent from chat — ' . ($b['name'] ?? ''), [
                    'prop_key' => $b['prop_key'] ?? '',
                    'entity' => 'booking',
                    'entity_id' => (string) $bid,
                ]);
            }
            // Post the note as an admin message (no separate email — the info email
            // already went). read_by_admin=1 so it doesn't count as unread to us.
            try {
                db()
                    ->prepare(
                        "INSERT INTO messages (thread_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?, 'admin', ?, 1, 0)",
                    )
                    ->execute([$tid, $note]);
                db()
                    ->prepare('UPDATE chat_threads SET updated_at = NOW() WHERE id = ?')
                    ->execute([$tid]);
            } catch (\Throwable $e) {
            }
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
            // Their bookings (matched by email), if any.
            $bookings = [];
            if (!empty($thread['email'])) {
                try {
                    $b = db()->prepare(
                        'SELECT id, prop_key, check_in, check_out, payment FROM bookings WHERE LOWER(email) = LOWER(?) ORDER BY check_in DESC LIMIT 10',
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
                    'archived' => !empty($thread['archived']),
                ],
                'bookings' => $bookings,
                'messages' => chat_msgs($tid),
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
            db()
                ->prepare('DELETE FROM messages WHERE thread_id = ?')
                ->execute([$tid]);
            db()
                ->prepare('DELETE FROM chat_threads WHERE id = ?')
                ->execute([$tid]);
            json_out(['ok' => true]);
        }
        if ($action === 'send') {
            $tid = (int) ($in['thread_id'] ?? 0);
            $bodyTxt = mb_substr(trim((string) ($in['body'] ?? '')), 0, 4000);
            $att = chat_valid_attachment($in['attachment'] ?? '');
            if ($tid <= 0 || ($bodyTxt === '' && $att === '')) {
                json_out(['error' => 'A thread and a message are required'], 400);
            }
            chat_admin_reply($tid, $bodyTxt, $att);
            // Reply sent → clear our typing stamp so the guest doesn't see "typing…"
            // linger under the message that just arrived.
            try {
                db()->prepare('UPDATE chat_threads SET admin_typing_at = NULL WHERE id = ?')->execute([$tid]);
            } catch (\Throwable $e) {
            }
            json_out(['ok' => true]);
        }
        if ($action === 'unread') {
            $c = (int) db()
                ->query("SELECT COUNT(*) FROM messages WHERE sender_role = 'guest' AND read_by_admin = 0")
                ->fetchColumn();
            json_out(['ok' => true, 'count' => $c]);
        }
        // default: list threads (only those with at least one message).
        // Active by default; pass archived:1 to list the archived ones instead.
        $showArchived = !empty($in['archived']) ? 1 : 0;
        $hasArch = true;
        try {
            $q = db()->prepare("SELECT t.id tid, t.guest_id, t.name, t.email, t.source, t.location, t.archived,
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
            chat_notify_owner($gg['name'] ?? '', $gg['email'] ?? '', $bodyTxt !== '' ? $bodyTxt : '📷 Photo', $tid);
            json_out(['ok' => true]);
        }
        // Guest is polling their thread — pull any emailed owner reply in the background.
        chat_nudge_mailbox();
        db()
            ->prepare("UPDATE messages SET read_by_guest = 1 WHERE thread_id = ? AND sender_role = 'admin'")
            ->execute([$tid]);
        json_out([
            'ok' => true,
            'messages' => chat_msgs($tid),
            'peer_typing' => chat_peer_typing($tid, 'admin_typing_at'),
        ]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Messages not ready — has migration-chat-threads.sql been run?'], 500);
    }
}

// ---------------- ANONYMOUS VISITOR (token-based) ----------------
$token = preg_replace('/[^a-f0-9]/i', '', (string) ($in['token'] ?? ''));
if (strlen($token) < 16) {
    // No usable token: only a 'send' that supplies name/email can start a thread.
    if ($action !== 'send') {
        json_out(['ok' => true, 'messages' => []]);
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
        chat_notify_owner($th['name'] ?? '', $th['email'] ?? '', $bodyTxt !== '' ? $bodyTxt : '📷 Photo', $tid);
        json_out(['ok' => true, 'token' => $token]);
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
        json_out(['ok' => true, 'messages' => []]);
    }
    // Active anonymous thread polling → pull any emailed owner reply in the background.
    chat_nudge_mailbox();
    db()
        ->prepare("UPDATE messages SET read_by_guest = 1 WHERE thread_id = ? AND sender_role = 'admin'")
        ->execute([$tid]);
    json_out([
        'ok' => true,
        'messages' => chat_msgs($tid),
        'peer_typing' => chat_peer_typing($tid, 'admin_typing_at'),
    ]);
} catch (\Throwable $e) {
    json_out(['error' => 'Messages not ready — has migration-chat-threads.sql been run?'], 500);
}
