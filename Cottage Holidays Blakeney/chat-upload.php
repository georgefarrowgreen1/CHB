<?php
// ============================================================
//  chat-upload.php — image attachment upload for owner↔guest chat.
//  POST (multipart/form-data) field "image" (+ "token" for anonymous visitors).
//  Reuses save_uploaded_image() (validates by content, strips EXIF/GPS, makes a
//  WebP companion, random filename, size-capped). Returns the saved path; the
//  caller then sends a normal chat message carrying it as `attachment`.
//
//  Auth mirrors messages.php: the owner (admin session + CSRF), a logged-in
//  guest (session), or an anonymous visitor holding a chat token (rate-limited).
//  Returns { ok:true, url:"uploads/pending/chat-xxxx.jpg" } — staged until sent.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/image-save.php';

$isAdmin = !empty($_SESSION['admin_id']);
$guestId = current_guest_id();
$token = preg_replace('/[^a-f0-9]/i', '', (string) ($_POST['token'] ?? ''));

if ($isAdmin) {
    require_admin(); // owner: enforce CSRF
} elseif ($guestId) {
    // logged-in guest: the session is enough to send, but each upload keeps up to
    // 6MB for good, so an account (free to make) gets 12 an hour.
    rate_limit_key('chat-upload:g' . (int) $guestId, 12, 60);
} elseif (strlen($token) >= 16) {
    // anonymous visitor with a chat token — curb abuse (per-IP), images only.
    // A token is only a string the visitor made up, so one with NO conversation
    // behind it yet (the photo-as-first-message case) gets a much tighter ceiling:
    // otherwise any 16 hex chars bought 8 x 6MB an hour, kept for ever in uploads/.
    $hasThread = false;
    try {
        $tq = db()->prepare('SELECT 1 FROM chat_threads WHERE token = ? LIMIT 1');
        $tq->execute([$token]);
        $hasThread = (bool) $tq->fetchColumn();
    } catch (\Throwable $e) {
    }
    rate_limit($hasThread ? 'chatupload' : 'chatupload-new', $hasThread ? 8 : 2, 60);
} else {
    json_out(['error' => 'Not authorised'], 401);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || empty($_FILES['image'])) {
    json_out(['error' => 'No image received'], 400);
}

// Chat photos: 6 MB cap (a touch smaller than the 8 MB admin gallery cap).
// STAGED, NOT PUBLISHED: the photo stays in the private staging folder until a
// message carries it (messages.php publishes it then). A visitor with nothing more
// than a made-up token could otherwise keep images on the site's own address that
// no conversation shows and nobody can delete; one never sent is swept away.
$res = save_uploaded_image($_FILES['image'], 'chat', 6 * 1024 * 1024, true, false);
if (!empty($res['error'])) {
    json_out(['error' => $res['error']], $res['code'] ?? 400);
}
json_out(['ok' => true, 'url' => $res['url']]);
