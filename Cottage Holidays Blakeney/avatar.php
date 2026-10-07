<?php
// A guest's profile photo, served to the only two people who may see it: the guest
// themselves (their own session) and the owner (?email=<the guest's address>).
// Never public, never by path — the files sit under a deny-all directory.
require_once __DIR__ . '/db.php';

$name = '';
if (isset($_GET['email'])) {
    require_admin();
    $email = strtolower(trim((string) $_GET['email']));
    try {
        $q = db()->prepare('SELECT avatar FROM guests WHERE email = ?');
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
// Versioned by ?v= on every URL the app builds, so a long private cache is safe.
header('Cache-Control: private, max-age=31536000');
header('X-Content-Type-Options: nosniff');
header('Content-Length: ' . filesize($path));
readfile($path);
