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
//  Returns { ok:true, url:"uploads/chat-xxxx.jpg" }.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/image-save.php';

$isAdmin = !empty($_SESSION['admin_id']);
$guestId = current_guest_id();
$token = preg_replace('/[^a-f0-9]/i', '', (string) ($_POST['token'] ?? ''));

if ($isAdmin) {
    require_admin(); // owner: enforce CSRF
} elseif ($guestId) {
    // logged-in guest — session is enough (parity with messages.php's guest path)
} elseif (strlen($token) >= 16) {
    // anonymous visitor with a chat token — curb abuse (per-IP), images only
    rate_limit('chatupload', 8, 60);
} else {
    json_out(['error' => 'Not authorised'], 401);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || empty($_FILES['image'])) {
    json_out(['error' => 'No image received'], 400);
}

// Chat photos: 6 MB cap (a touch smaller than the 8 MB admin gallery cap).
$res = save_uploaded_image($_FILES['image'], 'chat', 6 * 1024 * 1024);
if (!empty($res['error'])) {
    json_out(['error' => $res['error']], $res['code'] ?? 400);
}
json_out(['ok' => true, 'url' => $res['url']]);
