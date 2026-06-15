<?php
// ============================================================
//  messages.php — two-way messaging between the owner (admin) and guests.
//  One thread per guest.
//
//  GUEST (logged in):
//    GET  / POST {action:'thread'}      -> my messages (marks owner replies read)
//    POST {action:'send', body}         -> add a message; emails the owner
//
//  ADMIN (logged in):
//    GET  / POST {action:'threads'}     -> all threads (latest + unread count)
//    POST {action:'thread', guest_id}   -> one guest's messages (marks read)
//    POST {action:'send', guest_id, body} -> reply; emails the guest
//    POST {action:'unread'}             -> { count } unread guest messages
//
//  Table created by migration-messages.sql (via migrate.php).
// ============================================================
require_once __DIR__ . '/db.php';

$in = body();
$action = $in['action'] ?? '';
$isAdmin = !empty($_SESSION['admin_id']);
$guestId = current_guest_id();

function msg_rows($gid) {
    $s = db()->prepare('SELECT id, sender_role, body, created_at FROM messages WHERE guest_id = ? ORDER BY id ASC');
    $s->execute([$gid]);
    return array_map(fn($r) => [
        'id' => (int)$r['id'], 'role' => $r['sender_role'],
        'body' => $r['body'], 'at' => $r['created_at'],
    ], $s->fetchAll());
}

// ---------------- ADMIN ----------------
if ($isAdmin) {
    try {
        if ($action === 'thread') {
            $gid = (int)($in['guest_id'] ?? 0);
            if ($gid <= 0) json_out(['error' => 'guest_id required'], 400);
            db()->prepare("UPDATE messages SET read_by_admin = 1 WHERE guest_id = ? AND sender_role = 'guest'")->execute([$gid]);
            $g = db()->prepare('SELECT name, email FROM guests WHERE id = ?'); $g->execute([$gid]); $guest = $g->fetch() ?: [];
            json_out(['ok' => true, 'guest' => ['id' => $gid, 'name' => $guest['name'] ?? '', 'email' => $guest['email'] ?? ''], 'messages' => msg_rows($gid)]);
        }
        if ($action === 'send') {
            $gid = (int)($in['guest_id'] ?? 0);
            $bodyTxt = trim((string)($in['body'] ?? ''));
            if ($gid <= 0 || $bodyTxt === '') json_out(['error' => 'A guest and a message are required'], 400);
            $bodyTxt = mb_substr($bodyTxt, 0, 4000);
            db()->prepare("INSERT INTO messages (guest_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?, 'admin', ?, 1, 0)")->execute([$gid, $bodyTxt]);
            // Best-effort: email the guest that the host replied.
            try {
                $g = db()->prepare('SELECT name, email FROM guests WHERE id = ?'); $g->execute([$gid]); $guest = $g->fetch();
                if ($guest && !empty($guest['email']) && function_exists('smtp_send')) {
                    require_once __DIR__ . '/mailer.php';
                    smtp_send($guest['email'], $guest['name'] ?: 'Guest', 'A message from Cottage Holidays Blakeney',
                        "Hello " . ($guest['name'] ?: 'there') . ",\n\nYou have a new message from your host:\n\n\"" . $bodyTxt . "\"\n\nLog in to your account to reply.\nCottage Holidays Blakeney");
                }
            } catch (\Throwable $e) {}
            json_out(['ok' => true]);
        }
        if ($action === 'unread') {
            $c = (int)db()->query("SELECT COUNT(*) FROM messages WHERE sender_role = 'guest' AND read_by_admin = 0")->fetchColumn();
            json_out(['ok' => true, 'count' => $c]);
        }
        // default: list threads
        $rows = db()->query("SELECT m.guest_id gid, g.name, g.email,
                MAX(m.created_at) last_at,
                SUM(m.sender_role = 'guest' AND m.read_by_admin = 0) unread,
                SUBSTRING_INDEX(GROUP_CONCAT(m.body ORDER BY m.id DESC SEPARATOR '\\n\\n'), '\\n\\n', 1) last_body
            FROM messages m JOIN guests g ON g.id = m.guest_id
            GROUP BY m.guest_id, g.name, g.email
            ORDER BY last_at DESC")->fetchAll();
        json_out(['ok' => true, 'threads' => array_map(fn($r) => [
            'guest_id' => (int)$r['gid'], 'name' => $r['name'], 'email' => $r['email'],
            'last_at' => $r['last_at'], 'unread' => (int)$r['unread'],
            'last_body' => mb_substr((string)$r['last_body'], 0, 120),
        ], $rows)]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Messages not ready — has migration-messages.sql been run?'], 500);
    }
}

// ---------------- GUEST ----------------
if ($guestId) {
    try {
        if ($action === 'send') {
            $bodyTxt = trim((string)($in['body'] ?? ''));
            if ($bodyTxt === '') json_out(['error' => 'Type a message first'], 400);
            $bodyTxt = mb_substr($bodyTxt, 0, 4000);
            db()->prepare("INSERT INTO messages (guest_id, sender_role, body, read_by_admin, read_by_guest) VALUES (?, 'guest', ?, 0, 1)")->execute([$guestId, $bodyTxt]);
            // Best-effort: notify the owner.
            try {
                if (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL && function_exists('smtp_send')) {
                    require_once __DIR__ . '/mailer.php';
                    $g = db()->prepare('SELECT name, email FROM guests WHERE id = ?'); $g->execute([$guestId]); $guest = $g->fetch() ?: [];
                    smtp_send(OWNER_NOTIFY_EMAIL, 'Owner', 'New guest message — Cottage Holidays Blakeney',
                        "A guest has sent you a message.\n\nGuest: " . ($guest['name'] ?? '—') . " (" . ($guest['email'] ?? '') . ")\n\n\"" . $bodyTxt . "\"\n\nOpen the back office → Guest messages to reply.");
                }
            } catch (\Throwable $e) {}
            json_out(['ok' => true]);
        }
        // default / 'thread': my messages (mark the owner's replies as read)
        db()->prepare("UPDATE messages SET read_by_guest = 1 WHERE guest_id = ? AND sender_role = 'admin'")->execute([$guestId]);
        json_out(['ok' => true, 'messages' => msg_rows($guestId)]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Messages not ready — has migration-messages.sql been run?'], 500);
    }
}

json_out(['error' => 'Please log in'], 401);
