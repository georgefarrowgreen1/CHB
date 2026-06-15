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

function chat_msgs($threadId) {
    $s = db()->prepare('SELECT id, sender_role, body, created_at FROM messages WHERE thread_id = ? ORDER BY id ASC');
    $s->execute([$threadId]);
    return array_map(fn($r) => ['id' => (int)$r['id'], 'role' => $r['sender_role'], 'body' => $r['body'], 'at' => $r['created_at']], $s->fetchAll());
}
function chat_source($ref) {
    $ref = trim((string)$ref);
    if ($ref === '') $ref = $_SERVER['HTTP_REFERER'] ?? '';
    if ($ref === '') return 'Direct / unknown';
    $h = parse_url($ref, PHP_URL_HOST);
    if (!$h) return 'Direct / unknown';
    $h = strtolower(preg_replace('/^www\./', '', $h));
    $self = strtolower(preg_replace('/^www\./', '', (string)parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST)));
    return ($h === $self) ? 'Direct' : mb_substr($h, 0, 190);
}
function chat_location() {
    $country = $_SERVER['GEOIP_COUNTRY_NAME'] ?? $_SERVER['HTTP_CF_IPCOUNTRY'] ?? $_SERVER['GEOIP_COUNTRY_CODE'] ?? '';
    $city = $_SERVER['GEOIP_CITY'] ?? $_SERVER['HTTP_CF_IPCITY'] ?? '';
    $loc = trim(trim($city) . (($city && $country) ? ', ' : '') . trim($country));
    return $loc !== '' ? mb_substr($loc, 0, 120) : null;
}
function chat_notify_owner($name, $email, $bodyTxt) {
    try {
        if (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL && function_exists('smtp_send')) {
            require_once __DIR__ . '/mailer.php';
            smtp_send(OWNER_NOTIFY_EMAIL, 'Owner', 'New website message — Cottage Holidays Blakeney',
                "Someone has sent you a message via the website chat.\n\nFrom: " . ($name ?: '—') . " (" . ($email ?: 'no email') . ")\n\n\"" . $bodyTxt . "\"\n\nOpen the back office → Guest messages to reply.");
        }
    } catch (\Throwable $e) {}
    // Wake the owner's devices (best-effort).
    try { require_once __DIR__ . '/webpush.php'; alert_owner('New message', ($name ?: 'A visitor') . ': ' . mb_substr($bodyTxt, 0, 80)); } catch (\Throwable $e) {}
}

// ---------------- ADMIN ----------------
// Admin *tools* never carry a visitor token. If a token is present the request
// is coming from the floating chat widget (e.g. the owner testing it while also
// logged in), so let it fall through to the visitor path instead of erroring.
if ($isAdmin && empty($in['token'])) {
    try {
        if ($action === 'thread') {
            $tid = (int)($in['thread_id'] ?? 0);
            if ($tid <= 0) json_out(['error' => 'thread_id required'], 400);
            db()->prepare("UPDATE messages SET read_by_admin = 1 WHERE thread_id = ? AND sender_role = 'guest'")->execute([$tid]);
            $t = db()->prepare('SELECT * FROM chat_threads WHERE id = ?'); $t->execute([$tid]); $thread = $t->fetch() ?: [];
            // Their bookings (matched by email), if any.
            $bookings = [];
            if (!empty($thread['email'])) {
                try {
                    $b = db()->prepare('SELECT prop_key, check_in, check_out, payment FROM bookings WHERE LOWER(email) = LOWER(?) ORDER BY check_in DESC LIMIT 10');
                    $b->execute([$thread['email']]);
                    $bookings = array_map(fn($r) => ['prop_key' => $r['prop_key'], 'check_in' => $r['check_in'], 'check_out' => $r['check_out'], 'payment' => $r['payment']], $b->fetchAll());
                } catch (\Throwable $e) {}
            }
            json_out(['ok' => true, 'thread' => [
                'id' => $tid, 'name' => $thread['name'] ?? '', 'email' => $thread['email'] ?? '',
                'source' => $thread['source'] ?? '', 'location' => $thread['location'] ?? '',
                'user_agent' => $thread['user_agent'] ?? '', 'is_guest' => !empty($thread['guest_id']),
            ], 'bookings' => $bookings, 'messages' => chat_msgs($tid)]);
        }
        if ($action === 'send') {
            $tid = (int)($in['thread_id'] ?? 0);
            $bodyTxt = mb_substr(trim((string)($in['body'] ?? '')), 0, 4000);
            if ($tid <= 0 || $bodyTxt === '') json_out(['error' => 'A thread and a message are required'], 400);
            db()->prepare("INSERT INTO messages (thread_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?, 'admin', ?, 1, 0)")->execute([$tid, $bodyTxt]);
            db()->prepare('UPDATE chat_threads SET updated_at = NOW() WHERE id = ?')->execute([$tid]);
            try {
                $t = db()->prepare('SELECT name, email FROM chat_threads WHERE id = ?'); $t->execute([$tid]); $thread = $t->fetch();
                if ($thread && !empty($thread['email']) && function_exists('smtp_send')) {
                    require_once __DIR__ . '/mailer.php';
                    smtp_send($thread['email'], $thread['name'] ?: 'there', 'A message from Cottage Holidays Blakeney',
                        "Hello " . ($thread['name'] ?: 'there') . ",\n\nYou have a new message from Cottage Holidays Blakeney:\n\n\"" . $bodyTxt . "\"\n\nReply on our website chat.\nCottage Holidays Blakeney");
                }
            } catch (\Throwable $e) {}
            json_out(['ok' => true]);
        }
        if ($action === 'unread') {
            $c = (int)db()->query("SELECT COUNT(*) FROM messages WHERE sender_role = 'guest' AND read_by_admin = 0")->fetchColumn();
            json_out(['ok' => true, 'count' => $c]);
        }
        // default: list threads (only those with at least one message)
        $rows = db()->query("SELECT t.id tid, t.guest_id, t.name, t.email, t.source, t.location,
                COALESCE(MAX(m.created_at), t.created_at) last_at,
                SUM(m.sender_role = 'guest' AND m.read_by_admin = 0) unread,
                (SELECT body FROM messages mm WHERE mm.thread_id = t.id ORDER BY mm.id DESC LIMIT 1) last_body
            FROM chat_threads t JOIN messages m ON m.thread_id = t.id
            GROUP BY t.id, t.guest_id, t.name, t.email, t.source, t.location
            ORDER BY last_at DESC")->fetchAll();
        json_out(['ok' => true, 'threads' => array_map(fn($r) => [
            'thread_id' => (int)$r['tid'], 'name' => $r['name'], 'email' => $r['email'],
            'source' => $r['source'], 'location' => $r['location'], 'is_guest' => !empty($r['guest_id']),
            'last_at' => $r['last_at'], 'unread' => (int)$r['unread'], 'last_body' => mb_substr((string)$r['last_body'], 0, 120),
        ], $rows)]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Messages not ready — has migration-chat-threads.sql been run?'], 500);
    }
}

// ---------------- LOGGED-IN GUEST ----------------
if ($guestId) {
    try {
        // Find or create this guest's thread.
        $s = db()->prepare('SELECT id FROM chat_threads WHERE guest_id = ? LIMIT 1'); $s->execute([$guestId]);
        $tid = (int)($s->fetchColumn() ?: 0);
        if (!$tid) {
            $g = db()->prepare('SELECT name, email FROM guests WHERE id = ?'); $g->execute([$guestId]); $gg = $g->fetch() ?: [];
            db()->prepare('INSERT INTO chat_threads (guest_id, name, email) VALUES (?,?,?)')->execute([$guestId, $gg['name'] ?? '', $gg['email'] ?? '']);
            $tid = (int)db()->lastInsertId();
        }
        if ($action === 'send') {
            $bodyTxt = mb_substr(trim((string)($in['body'] ?? '')), 0, 4000);
            if ($bodyTxt === '') json_out(['error' => 'Type a message first'], 400);
            db()->prepare("INSERT INTO messages (thread_id, guest_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?, ?, 'guest', ?, 0, 1)")->execute([$tid, $guestId, $bodyTxt]);
            db()->prepare('UPDATE chat_threads SET updated_at = NOW() WHERE id = ?')->execute([$tid]);
            $g = db()->prepare('SELECT name, email FROM guests WHERE id = ?'); $g->execute([$guestId]); $gg = $g->fetch() ?: [];
            chat_notify_owner($gg['name'] ?? '', $gg['email'] ?? '', $bodyTxt);
            json_out(['ok' => true]);
        }
        db()->prepare("UPDATE messages SET read_by_guest = 1 WHERE thread_id = ? AND sender_role = 'admin'")->execute([$tid]);
        json_out(['ok' => true, 'messages' => chat_msgs($tid)]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Messages not ready — has migration-chat-threads.sql been run?'], 500);
    }
}

// ---------------- ANONYMOUS VISITOR (token-based) ----------------
$token = preg_replace('/[^a-f0-9]/i', '', (string)($in['token'] ?? ''));
if (strlen($token) < 16) {
    // No usable token: only a 'send' that supplies name/email can start a thread.
    if ($action !== 'send') json_out(['ok' => true, 'messages' => []]);
}
try {
    $tid = 0;
    if (strlen($token) >= 16) {
        $s = db()->prepare('SELECT id FROM chat_threads WHERE token = ? LIMIT 1'); $s->execute([$token]);
        $tid = (int)($s->fetchColumn() ?: 0);
    }
    if ($action === 'send') {
        $bodyTxt = mb_substr(trim((string)($in['body'] ?? '')), 0, 4000);
        if ($bodyTxt === '') json_out(['error' => 'Type a message first'], 400);
        if (!$tid) {
            $name = mb_substr(clean($in['name'] ?? ''), 0, 120);
            $email = mb_substr(clean($in['email'] ?? ''), 0, 190);
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) json_out(['error' => 'Please enter a valid email address.'], 400);
            if (strlen($token) < 16) json_out(['error' => 'Could not start the chat — please reload and try again.'], 400);
            db()->prepare('INSERT INTO chat_threads (token, name, email, source, location, user_agent) VALUES (?,?,?,?,?,?)')
                ->execute([$token, $name, $email, chat_source($in['ref'] ?? ''), chat_location(), mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255)]);
            $tid = (int)db()->lastInsertId();
        }
        db()->prepare("INSERT INTO messages (thread_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?, 'guest', ?, 0, 1)")->execute([$tid, $bodyTxt]);
        db()->prepare('UPDATE chat_threads SET updated_at = NOW() WHERE id = ?')->execute([$tid]);
        $t = db()->prepare('SELECT name, email FROM chat_threads WHERE id = ?'); $t->execute([$tid]); $th = $t->fetch() ?: [];
        chat_notify_owner($th['name'] ?? '', $th['email'] ?? '', $bodyTxt);
        json_out(['ok' => true, 'token' => $token]);
    }
    // thread / default
    if (!$tid) json_out(['ok' => true, 'messages' => []]);
    db()->prepare("UPDATE messages SET read_by_guest = 1 WHERE thread_id = ? AND sender_role = 'admin'")->execute([$tid]);
    json_out(['ok' => true, 'messages' => chat_msgs($tid)]);
} catch (\Throwable $e) {
    json_out(['error' => 'Messages not ready — has migration-chat-threads.sql been run?'], 500);
}
