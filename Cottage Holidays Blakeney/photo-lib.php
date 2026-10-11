<?php
// ============================================================
//  photo-lib.php — photos a guest or the owner sends in the chat, and the photos
//  guests send for a cottage's page while they wait for approval. They are kept
//  in a private folder and open only through photo.php with a signed link that
//  expires. Pure apart from moving files: no database and no session, so
//  photo.php can serve a picture without starting either. Needs APP_SECRET.
//
//  A photo is named by its LOGICAL path, 'uploads/<name>' (what messages and
//  guest_photos store). Where the file really is (the private folder, the staging
//  folder, or public uploads/ once a wall photo is approved) is this file's
//  business.
// ============================================================

const UPLOAD_PRIVATE_DIR = 'uploads/private';
// How long a link shown in the chat, the Inbox or the moderation list works: at
// least this, and up to an hour more, because the expiry is rounded up to the next
// whole hour so a link stays the same for an hour and the browser keeps its copy.
const PHOTO_LINK_SECONDS = 3 * 3600;
// The link in a guest's email: a week.
const PHOTO_MAIL_SECONDS = 7 * 86400;

// Only what a guest or the chat sends is kept private: chat photos and wall photos.
function photo_name_ok($name): bool
{
    $name = (string) $name;
    return (bool) preg_match('/^(chat|guest)-[A-Za-z0-9_-]+\.(jpe?g|png|gif|webp)$/i', $name);
}

// 'uploads/chat-x.jpg', 'uploads/pending/chat-x.jpg' or 'chat-x.jpg' → 'chat-x.jpg';
// anything else → ''.
function photo_name_of($rel): string
{
    $base = basename(str_replace('\\', '/', (string) $rel));
    return photo_name_ok($base) ? $base : '';
}

function photo_sig($name, $exp): string
{
    return substr(hash_hmac('sha256', 'photo|' . $name . '|' . (int) $exp, APP_SECRET), 0, 32);
}

// A signed link to a private photo, relative to the site ('photo.php?…'), or ''
// for a name that is not one. $life is the least time it works for.
function photo_link($rel, $life = PHOTO_LINK_SECONDS, $now = null): string
{
    $name = photo_name_of($rel);
    if ($name === '') {
        return '';
    }
    $now = (int) ($now ?? time());
    $exp = (intdiv($now, 3600) + 1) * 3600 + (int) $life;
    return 'photo.php?f=' . rawurlencode($name) . '&exp=' . $exp . '&sig=' . photo_sig($name, $exp);
}

// What a link says: 'ok', 'expired' (genuine, past its time) or 'invalid'.
function photo_check($name, $exp, $sig, $now = null): string
{
    $name = (string) $name;
    if (!photo_name_ok($name) || !preg_match('/^\d{1,12}$/', (string) $exp) || !preg_match('/^[0-9a-f]{32}$/', (string) $sig)) {
        return 'invalid';
    }
    if (!hash_equals(photo_sig($name, (int) $exp), (string) $sig)) {
        return 'invalid';
    }
    return (int) $exp >= (int) ($now ?? time()) ? 'ok' : 'expired';
}

// The private folder, made on first use with a deny-all rule of its own (the
// site's .htaccess refuses uploads/private/ too, in case this one is ever lost).
function upload_private_dir(): string
{
    $dir = __DIR__ . '/' . UPLOAD_PRIVATE_DIR;
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        return '';
    }
    if (!is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n");
    }
    return $dir;
}

// Move a file and its WebP companion. True when the file itself moved.
function photo_move($from, $to): bool
{
    if (!is_file($from) || !@rename($from, $to)) {
        return false;
    }
    if (is_file($from . '.webp')) {
        @rename($from . '.webp', $to . '.webp');
    }
    return true;
}

// Where a private photo is on disk, or ''. A chat photo still in public uploads/
// (sent before photos were private) is moved into the private folder first, so its
// old address stops working the first time anyone asks for it. A wall photo found
// in public uploads/ is served from there and never moved here: it may be an
// approved one, which is public on purpose (the sweep moves the waiting ones).
function photo_file($rel): string
{
    $name = photo_name_of($rel);
    if ($name === '') {
        return '';
    }
    $priv = __DIR__ . '/' . UPLOAD_PRIVATE_DIR . '/' . $name;
    if (is_file($priv)) {
        return $priv;
    }
    $pub = __DIR__ . '/uploads/' . $name;
    if (!is_file($pub)) {
        return '';
    }
    if (strncasecmp($name, 'chat-', 5) === 0) {
        return upload_private_dir() !== '' && photo_move($pub, $priv) ? $priv : '';
    }
    return $pub;
}

// A staged upload ('uploads/pending/<name>') is kept privately: it moves into the
// private folder and the logical path ('uploads/<name>') comes back, or '' when
// nothing is staged under that name.
function upload_hold($rel): string
{
    if (!preg_match('#^uploads/pending/([A-Za-z0-9._-]+)$#', (string) $rel, $m) || photo_name_of($m[1]) === '') {
        return '';
    }
    if (upload_private_dir() === '') {
        return '';
    }
    $to = __DIR__ . '/' . UPLOAD_PRIVATE_DIR . '/' . $m[1];
    return photo_move(__DIR__ . '/uploads/pending/' . $m[1], $to) ? 'uploads/' . $m[1] : '';
}
