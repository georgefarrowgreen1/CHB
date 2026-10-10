<?php
// A guest's profile photo, served to the only two people who may see it: the guest
// themselves (their own session) and the owner (?email=<the guest's address>).
// Also the photo of someone who signs in to the back office (?admin=<id>).
// Never by path — the files sit under a deny-all directory. The one public photo
// is a back-office person's while they are shown in the guest chat (?team=<id>):
// guests see who answers, and the switch that shows them is theirs.
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/chat-lib.php';

$name = '';
$public = false;
if (isset($_GET['team'])) {
    $row = admin_row((int) $_GET['team']);
    $name = chat_team_member_ok($row) ? (string) ($row['photo'] ?? '') : '';
    $public = true;
} elseif (isset($_GET['admin'])) {
    // A back-office person's own photo: seen inside the back office only.
    require_admin();
    $row = admin_row((int) $_GET['admin']);
    $name = $row ? (string) ($row['photo'] ?? '') : '';
} elseif (isset($_GET['email'])) {
    require_admin();
    $email = strtolower(trim((string) $_GET['email']));
    try {
        $q = db()->prepare('SELECT avatar FROM guests WHERE email = ? AND email_verified_at IS NOT NULL'); // a confirmed account only — never a squatter's picture
        $q->execute([$email]);
        $name = (string) $q->fetchColumn();
    } catch (\Throwable $e) {
        $name = '';
    }
} else {
    require_guest();
    $name = guest_avatar_name((int) $_SESSION['guest_id']);
}
$path = avatar_name_ok($name) ? __DIR__ . '/' . AVATAR_DIR . '/' . $name : '';
if ($path === '' || !is_file($path)) {
    http_response_code(404);
    header('Content-Type: text/plain');
    echo 'No photo';
    exit();
}
header('Content-Type: image/jpeg');
// Versioned by ?v=; kept for a day only, so a shared browser does not hold a guest's
// photo long after they sign out. A chat face is already public, so any cache may
// keep it for the day — and so it carries no cookie (db.php's session, or its sliding
// expiry, would otherwise be stored beside the picture) and none of the session's
// no-cache headers.
if ($public) {
    header_remove('Set-Cookie');
    header_remove('Pragma');
    header_remove('Expires');
}
header('Cache-Control: ' . ($public ? 'public' : 'private') . ', max-age=86400');
header('X-Content-Type-Options: nosniff');
header('Content-Length: ' . filesize($path));
readfile($path);
