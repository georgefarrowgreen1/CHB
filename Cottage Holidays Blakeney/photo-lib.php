<?php
// ============================================================
//  photo-lib.php — the photos nobody but their people should see: a photo sent in
//  the chat, a guest's photo for a cottage's page or the picture with their
//  suggestion while it waits for approval, and the photo the owner takes of a
//  deposit decision. They are kept in a private folder, ENCRYPTED, and open only
//  through photo.php with a signed link that expires. Pure apart from moving
//  files: no database and no session, so photo.php can serve a picture without
//  starting either. Needs APP_SECRET.
//
//  A photo is named by its LOGICAL path, 'uploads/<name>' (what messages,
//  guest_photos, experiences and the activity log store). Where the file really is
//  (the private folder, the staging folder, or public uploads/ once a wall photo or
//  a suggestion is approved) is this file's business.
// ============================================================

const UPLOAD_PRIVATE_DIR = 'uploads/private';

// EVERY PHOTO IN THE PRIVATE FOLDER IS ENCRYPTED (AES-256-GCM, the owner's choice
// over end-to-end encryption, which would lose every photo with a forgotten
// passphrase). The key comes from APP_SECRET, the secret the door codes are
// encrypted under too, so a copy of the folder on its own (a host's backup, the
// Backups page's files archive, a web server that stopped honouring the deny-all)
// is unreadable. The file's own name is the associated data: a file renamed or
// swapped for another fails to open. A file without the marker is plaintext from
// before, or from a host without OpenSSL; it is still served, and the daily sweep
// (photos_seal_private, db.php) encrypts it.
// Format: PHOTO_SEAL_MAGIC, a 12-byte IV, the 16-byte tag, then the ciphertext.
const PHOTO_SEAL_MAGIC = 'CHBSEAL1';

function photo_seal_key(): string
{
    return hash_hmac('sha256', 'private-photo|v1', hash('sha256', APP_SECRET . '|at-rest-v1', true), true);
}
function photo_is_sealed(string $bytes): bool
{
    return strncmp($bytes, PHOTO_SEAL_MAGIC, 8) === 0;
}
// The bytes encrypted for the file named $name, or '' when they can't be.
function photo_seal(string $plain, string $name): string
{
    if (!function_exists('openssl_encrypt')) {
        return '';
    }
    try {
        $iv = random_bytes(12);
        $tag = '';
        $ct = openssl_encrypt($plain, 'aes-256-gcm', photo_seal_key(), OPENSSL_RAW_DATA, $iv, $tag, $name);
        return $ct === false || strlen($tag) !== 16 ? '' : PHOTO_SEAL_MAGIC . $iv . $tag . $ct;
    } catch (\Throwable $e) {
        return '';
    }
}
// The photo inside the bytes of the file named $name. Plaintext comes back as it
// is; null when they were encrypted and do not open (another key, a damaged file,
// a file under another name).
function photo_unseal(string $bytes, string $name): ?string
{
    if (!photo_is_sealed($bytes)) {
        return $bytes;
    }
    if (strlen($bytes) < 36 || !function_exists('openssl_decrypt')) {
        return null;
    }
    $pt = openssl_decrypt(substr($bytes, 36), 'aes-256-gcm', photo_seal_key(), OPENSSL_RAW_DATA, substr($bytes, 8, 12), substr($bytes, 20, 16), $name);
    return $pt === false ? null : $pt;
}
// The photo in a file, decrypted with the file's own name; null when it can't be read.
function photo_read(string $path): ?string
{
    $raw = is_file($path) ? @file_get_contents($path) : false;
    return is_string($raw) ? photo_unseal($raw, basename($path)) : null;
}
// Write bytes to a file through a temporary one beside it, so a request that dies
// half-way never leaves half a photo under the real name.
function photo_put(string $path, string $bytes): bool
{
    $tmp = dirname($path) . '/.' . basename($path) . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $bytes) !== strlen($bytes) || !@rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    return true;
}
// Keep a photo in the private folder under $name, encrypted. Without OpenSSL it is
// kept as it is (still private, as before encryption).
function photo_put_private(string $plain, string $name): bool
{
    $dir = upload_private_dir();
    if ($dir === '' || !preg_match('/^[A-Za-z0-9._-]+$/', $name)) {
        return false;
    }
    $sealed = photo_seal($plain, $name);
    if (!photo_put($dir . '/' . $name, $sealed !== '' ? $sealed : $plain)) {
        return false;
    }
    @chmod($dir . '/' . $name, 0600);
    return true;
}
// Move a photo and its WebP companion INTO the private folder, encrypting them on
// the way. The copy is written before the original goes, so a failure leaves the
// original where it was rather than no photo at all. It keeps the original's date:
// the daily sweeps judge a photo's age by it. True when the photo moved.
function photo_take_private(string $from, string $name): bool
{
    $raw = is_file($from) ? @file_get_contents($from) : false;
    if (!is_string($raw)) {
        return false;
    }
    $plain = photo_unseal($raw, basename($from));
    $mt = @filemtime($from);
    if ($plain === null || !photo_put_private($plain, $name)) {
        return false;
    }
    if ($mt !== false) {
        @touch(__DIR__ . '/' . UPLOAD_PRIVATE_DIR . '/' . $name, $mt);
    }
    @unlink($from);
    if (is_file($from . '.webp')) {
        $web = @file_get_contents($from . '.webp');
        $webPlain = is_string($web) ? photo_unseal($web, basename($from) . '.webp') : null;
        if ($webPlain !== null) {
            photo_put_private($webPlain, $name . '.webp');
        }
        // A copy that could not move must not stay behind in the open; photo.php
        // serves the photo itself when there is no WebP one.
        @unlink($from . '.webp');
    }
    return true;
}
// Move a photo and its WebP companion OUT of the private folder to $to, decrypted:
// an approved wall photo or suggestion goes public. True when the photo moved.
function photo_release(string $from, string $to): bool
{
    $plain = photo_read($from);
    if ($plain === null || !photo_put($to, $plain)) {
        return false;
    }
    @chmod($to, 0644);
    @unlink($from);
    if (is_file($from . '.webp')) {
        $web = photo_read($from . '.webp');
        if ($web !== null && photo_put($to . '.webp', $web)) {
            @chmod($to . '.webp', 0644);
        }
        @unlink($from . '.webp');
    }
    return true;
}
// How long a link shown in the chat, the Inbox or the moderation list works: at
// least this, and up to an hour more, because the expiry is rounded up to the next
// whole hour so a link stays the same for an hour and the browser keeps its copy.
const PHOTO_LINK_SECONDS = 3 * 3600;
// The link in a guest's email: a week.
const PHOTO_MAIL_SECONDS = 7 * 86400;

// The photos kept private, by their names: a chat photo, a guest's wall photo, the
// picture with a guest's suggestion (both public once approved), and a deposit
// photo (private for good).
function photo_name_ok($name): bool
{
    $name = (string) $name;
    return (bool) preg_match('/^(chat|guest|experience|deposit-evidence)-[A-Za-z0-9_-]+\.(jpe?g|png|gif|webp)$/i', $name);
}
// The kinds that are never public: no approval ever publishes them.
function photo_never_public($name): bool
{
    return (bool) preg_match('/^(chat|deposit-evidence)-/i', (string) $name);
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

// Where a private photo is on disk, or ''. A chat or deposit photo still in public
// uploads/ (kept before photos were private) is moved into the private folder
// first, encrypted, so its old address stops working the first time anyone asks
// for it. A wall photo or a suggestion's picture found in public uploads/ is served
// from there and never moved here: it may be an approved one, which is public on
// purpose (the sweep moves the waiting ones).
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
    if (photo_never_public($name)) {
        return photo_take_private($pub, $name) ? $priv : '';
    }
    return $pub;
}

// A staged upload ('uploads/pending/<name>') is kept privately: it moves into the
// private folder, encrypted, and the logical path ('uploads/<name>') comes back,
// or '' when nothing is staged under that name.
function upload_hold($rel): string
{
    if (!preg_match('#^uploads/pending/([A-Za-z0-9._-]+)$#', (string) $rel, $m) || photo_name_of($m[1]) === '') {
        return '';
    }
    return photo_take_private(__DIR__ . '/uploads/pending/' . $m[1], $m[1]) ? 'uploads/' . $m[1] : '';
}

// PHOTOS MADE PRIVATE BEFORE THEY WERE ENCRYPTED are encrypted where they lie, and
// a temporary file a dying request left behind (photo_put) is cleared after an
// hour. Run with photos_make_private (db.php) after each deploy and daily. Returns
// how many photos it encrypted.
function photos_seal_private(): int
{
    $dir = __DIR__ . '/' . UPLOAD_PRIVATE_DIR;
    if (!is_dir($dir)) {
        return 0;
    }
    $sealed = 0;
    foreach (scandir($dir) ?: [] as $f) {
        $p = $dir . '/' . $f;
        if ($f[0] === '.' && substr($f, -4) === '.tmp') {
            $mt = @filemtime($p);
            if ($mt !== false && $mt < time() - 3600) {
                @unlink($p);
            }
            continue;
        }
        // A photo, or the WebP companion of one ('chat-x.jpg.webp').
        $own = photo_name_ok($f) || (strcasecmp(substr($f, -5), '.webp') === 0 && photo_name_ok(substr($f, 0, -5)));
        if (!$own || !is_file($p)) {
            continue;
        }
        $raw = @file_get_contents($p);
        if (!is_string($raw) || photo_is_sealed($raw)) {
            continue;
        }
        $mt = @filemtime($p);
        $seal = photo_seal($raw, $f);
        if ($seal !== '' && photo_put($p, $seal)) {
            @chmod($p, 0600);
            if ($mt !== false) {
                @touch($p, $mt); // the sweeps judge a photo's age by its date
            }
            $sealed++;
        }
    }
    return $sealed;
}
