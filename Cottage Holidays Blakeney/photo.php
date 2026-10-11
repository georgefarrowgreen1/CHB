<?php
// ============================================================
//  photo.php — a private photo, through a signed link that expires.
//  GET ?f=<name>&exp=<unix time>&sig=<32 hex>   (made by photo_link, photo-lib.php)
//
//  Serves the photos sent in the guest chat and the guest photos waiting for
//  approval, which live in uploads/private/. The link is the permission: the chat
//  and the Inbox ask for fresh links each time they load, so a link copied out of
//  them works for a few hours, and one in a guest's email for a week.
//
//  No database and no session (config.php and photo-lib.php only): a picture
//  never starts a session, and the answer is marked private, so a shared cache
//  (an office or hotel network) keeps no copy.
// ============================================================
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/photo-lib.php';

function photo_refuse($code, $title, $line)
{
    http_response_code($code);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    echo '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' . $title . '</title>'
        . '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F5F1E9;color:#1F2A30;font:16px/1.5 system-ui,sans-serif}main{max-width:340px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#52646E}'
        . '@media (prefers-color-scheme: dark){body{background:#121316;color:#ECEDEE}p{color:#A6ADB3}}</style></head>'
        . '<body><main><h1>' . $title . '</h1><p>' . $line . '</p></main></body></html>';
    exit();
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'HEAD') {
    http_response_code(405);
    header('Allow: GET, HEAD');
    exit();
}

$name = (string) ($_GET['f'] ?? '');
$exp = (string) ($_GET['exp'] ?? '');
$sig = (string) ($_GET['sig'] ?? '');
$state = photo_check($name, $exp, $sig);
if ($state === 'expired') {
    photo_refuse(410, 'This photo link has expired', 'Ask the person who sent it for a new one.');
}
if ($state !== 'ok') {
    photo_refuse(404, 'Photo not found', 'This link isn’t one we recognise.');
}
$file = photo_file('uploads/' . $name);
if ($file === '') {
    photo_refuse(404, 'Photo not found', 'It may have been deleted.');
}

// The smaller WebP copy when the browser takes it and one was made.
$ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
$types = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp'];
$type = $types[$ext] ?? 'application/octet-stream';
if ($ext !== 'webp' && strpos((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'image/webp') !== false && is_file($file . '.webp')) {
    $file .= '.webp';
    $type = 'image/webp';
}
header('Vary: Accept');
header('Content-Type: ' . $type);
header('Content-Length: ' . (string) filesize($file));
// Kept by this browser only, and never past the link's own time.
header('Cache-Control: private, max-age=' . max(0, min(86400, (int) $exp - time())));
header('Content-Disposition: inline');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');
header('Referrer-Policy: no-referrer');
if ($method === 'GET') {
    readfile($file);
}
