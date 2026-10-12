<?php
// ============================================================
//  test-photo.php — private photos and their signed links (photo-lib.php). Dev/CI
//  only, deploy-excluded. No database, no network: the library runs from a copy in
//  the system temp dir, so the files it moves are the copy's, never the app's.
//
//  What it holds: a link works for at least its life and stops after it; a link
//  cannot be forged, stretched or pointed at any other file; every photo in the
//  private folder is encrypted (AES-256-GCM, its name bound in, a key of its own),
//  opens only as itself and is decrypted only on the way out or when approval
//  publishes it; a chat or deposit photo is moved out of public uploads/ the first
//  time it is asked for, and an approved wall photo never is; and the wiring (the
//  chat, the emails, the wall, suggestions, deposit photos, the resizer, the
//  deploy's move, the .htaccess rules) uses it.
//
//  Run:  php test-photo.php
// ============================================================
define('APP_SECRET', 'test-photo-secret');

$pass = 0;
$fail = 0;
function ph_ok($name, $cond)
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "  \u{2713} $name\n";
    } else {
        $fail++;
        echo "  \u{2717} $name\n";
    }
}

$tmp = sys_get_temp_dir() . '/chb-photo-' . bin2hex(random_bytes(4));
mkdir($tmp . '/uploads/pending', 0700, true);
copy(__DIR__ . '/photo-lib.php', $tmp . '/photo-lib.php');
require $tmp . '/photo-lib.php';

echo "== Names ==\n";
ph_ok('a chat photo, a wall photo, a suggestion\'s picture and a deposit photo are names it keeps', photo_name_ok('chat-0123456789ab.jpg') && photo_name_ok('guest-0123456789ab.PNG') && photo_name_ok('chat-0123456789ab.webp') && photo_name_ok('experience-0123456789ab.jpg') && photo_name_ok('deposit-evidence-42-0123456789ab.jpg'));
ph_ok('…and nothing else: a gallery photo, a script, a path, a second dot', !photo_name_ok('gallery-0123456789ab.jpg') && !photo_name_ok('hero-0123456789ab.jpg') && !photo_name_ok('chat-0123.php') && !photo_name_ok('../chat-0123.jpg') && !photo_name_ok('chat-a.b.jpg') && !photo_name_ok('chat-.jpg') && !photo_name_ok('deposit-0123.jpg'));
ph_ok('chat and deposit photos are never public; wall photos and suggestion pictures may be once approved', photo_never_public('chat-0123456789ab.jpg') && photo_never_public('deposit-evidence-1-0123456789ab.jpg') && !photo_never_public('guest-0123456789ab.jpg') && !photo_never_public('experience-0123456789ab.jpg'));
ph_ok('a stored path, a staged path and a bare name all give the name', photo_name_of('uploads/chat-0123456789ab.jpg') === 'chat-0123456789ab.jpg' && photo_name_of('uploads/pending/chat-0123456789ab.jpg') === 'chat-0123456789ab.jpg' && photo_name_of('uploads/gallery-1.jpg') === '');

echo "== Links ==\n";
$H = 3600;
$now = 1791720000 + 25 * 60; // 25 minutes into an hour
$link = photo_link('uploads/chat-0123456789ab.jpg', PHOTO_LINK_SECONDS, $now);
parse_str((string) parse_url($link, PHP_URL_QUERY), $q);
ph_ok('a link has the shape photo.php?f=<name>&exp=<time>&sig=<32 hex>', preg_match('/^photo\.php\?f=chat-0123456789ab\.jpg&exp=\d+&sig=[0-9a-f]{32}$/', $link) === 1);
ph_ok('its expiry is the next whole hour plus the life: between 3 and 4 hours', (int) $q['exp'] === (intdiv($now, $H) + 1) * $H + 3 * $H && (int) $q['exp'] - $now >= 3 * $H && (int) $q['exp'] - $now <= 4 * $H);
ph_ok('the same link all hour, so the browser keeps its copy', photo_link('uploads/chat-0123456789ab.jpg', PHOTO_LINK_SECONDS, $now + 30 * 60) === $link);
ph_ok('…and a new one the next hour', photo_link('uploads/chat-0123456789ab.jpg', PHOTO_LINK_SECONDS, $now + $H) !== $link);
ph_ok('it works until its time', photo_check($q['f'], $q['exp'], $q['sig'], (int) $q['exp']) === 'ok');
ph_ok('…and is expired a second later', photo_check($q['f'], $q['exp'], $q['sig'], (int) $q['exp'] + 1) === 'expired');
ph_ok('a forged signature is invalid', photo_check($q['f'], $q['exp'], str_repeat('ab', 16), $now) === 'invalid');
ph_ok('a stretched expiry is invalid', photo_check($q['f'], (string) ((int) $q['exp'] + 86400), $q['sig'], $now) === 'invalid');
ph_ok('the signature of one photo opens no other', photo_check('chat-ba9876543210.jpg', $q['exp'], $q['sig'], $now) === 'invalid');
$gExp = $now + 3600;
ph_ok('a file that is not a private photo is invalid even correctly signed', photo_check('gallery-0123456789ab.jpg', (string) $gExp, photo_sig('gallery-0123456789ab.jpg', $gExp), $now) === 'invalid' && photo_check('../config.php', (string) $gExp, photo_sig('../config.php', $gExp), $now) === 'invalid');
ph_ok('a malformed expiry or signature is invalid', photo_check($q['f'], 'soon', $q['sig'], $now) === 'invalid' && photo_check($q['f'], $q['exp'], 'abc', $now) === 'invalid' && photo_check($q['f'], $q['exp'], strtoupper($q['sig']), $now) === 'invalid');
ph_ok('no link for anything that is not a private photo', photo_link('uploads/gallery-0123456789ab.jpg') === '' && photo_link('') === '');
$mail = photo_link('uploads/chat-0123456789ab.jpg', PHOTO_MAIL_SECONDS, $now);
parse_str((string) parse_url($mail, PHP_URL_QUERY), $mq);
ph_ok('the link in an email works for a week', photo_check($mq['f'], $mq['exp'], $mq['sig'], $now + 7 * 86400) === 'ok' && photo_check($mq['f'], $mq['exp'], $mq['sig'], $now + 7 * 86400 + 2 * $H) === 'expired');

echo "== Encrypted at rest ==\n";
$photo = "\xFF\xD8\xFF\xE0" . str_repeat('a photo of the sea wall ', 40);
$sealed = photo_seal($photo, 'chat-0123456789ab.jpg');
ph_ok('a sealed photo starts with the marker and carries none of the picture', photo_is_sealed($sealed) && strpos($sealed, 'a photo of the sea wall') === false && strpos($sealed, "\xFF\xD8\xFF") === false);
ph_ok('…and opens back to the very same bytes', photo_unseal($sealed, 'chat-0123456789ab.jpg') === $photo);
ph_ok('two sealings of one photo differ (a fresh IV each time)', photo_seal($photo, 'chat-0123456789ab.jpg') !== $sealed);
ph_ok('a sealed photo opens only under its own name (a renamed or swapped file does not)', photo_unseal($sealed, 'chat-ba9876543210.jpg') === null);
$flip = $sealed;
$flip[60] = chr(ord($flip[60]) ^ 1);
ph_ok('one changed byte and it does not open', photo_unseal($flip, 'chat-0123456789ab.jpg') === null);
ph_ok('…nor does a cut-short file', photo_unseal(substr($sealed, 0, 30), 'chat-0123456789ab.jpg') === null && photo_unseal(substr($sealed, 0, -5), 'chat-0123456789ab.jpg') === null);
ph_ok('a plaintext file from before passes through as it is', photo_unseal($photo, 'chat-0123456789ab.jpg') === $photo && !photo_is_sealed($photo));
ph_ok('the key is the photos\' own, not the door codes\' (same secret, its own derivation)', strlen(photo_seal_key()) === 32 && photo_seal_key() !== hash('sha256', APP_SECRET . '|at-rest-v1', true));

echo "== Where the photo is ==\n";
$put = function ($rel, $body = 'img') use ($tmp) {
    @mkdir(dirname($tmp . '/' . $rel), 0700, true);
    file_put_contents($tmp . '/' . $rel, $body);
};
$raw = function ($rel) use ($tmp) {
    return (string) @file_get_contents($tmp . '/' . $rel);
};
$put('uploads/chat-aaaaaaaaaaaa.jpg', 'chat photo bytes');
$put('uploads/chat-aaaaaaaaaaaa.jpg.webp', 'chat webp bytes');
$f = photo_file('uploads/chat-aaaaaaaaaaaa.jpg');
ph_ok('a chat photo still in public uploads/ is moved into the private folder when asked for', $f === $tmp . '/uploads/private/chat-aaaaaaaaaaaa.jpg' && is_file($f) && !is_file($tmp . '/uploads/chat-aaaaaaaaaaaa.jpg'));
ph_ok('…encrypted on the way, and still the same photo when read', photo_is_sealed($raw('uploads/private/chat-aaaaaaaaaaaa.jpg')) && photo_read($f) === 'chat photo bytes');
ph_ok('…its WebP copy with it, encrypted under its own name', is_file($tmp . '/uploads/private/chat-aaaaaaaaaaaa.jpg.webp') && !is_file($tmp . '/uploads/chat-aaaaaaaaaaaa.jpg.webp') && photo_read($tmp . '/uploads/private/chat-aaaaaaaaaaaa.jpg.webp') === 'chat webp bytes');
ph_ok('…readable by nobody else on the server (0600)', (fileperms($f) & 0777) === 0600);
$put('uploads/chat-abababababab.jpg', 'an old chat photo');
touch($tmp . '/uploads/chat-abababababab.jpg', time() - 3 * 86400);
photo_file('uploads/chat-abababababab.jpg');
clearstatcache();
ph_ok('…and it keeps its date, which the daily sweeps judge its age by', abs((int) filemtime($tmp . '/uploads/private/chat-abababababab.jpg') - (time() - 3 * 86400)) <= 2);
$put('uploads/deposit-evidence-7-aaaaaaaaaaaa.jpg', 'deposit photo bytes');
$df = photo_file('uploads/deposit-evidence-7-aaaaaaaaaaaa.jpg');
ph_ok('a deposit photo still in public uploads/ is moved in and encrypted the same way', $df === $tmp . '/uploads/private/deposit-evidence-7-aaaaaaaaaaaa.jpg' && !is_file($tmp . '/uploads/deposit-evidence-7-aaaaaaaaaaaa.jpg') && photo_is_sealed($raw('uploads/private/deposit-evidence-7-aaaaaaaaaaaa.jpg')) && photo_read($df) === 'deposit photo bytes');
ph_ok('a photo written straight into the private folder is encrypted too', photo_put_private('fresh deposit photo', 'deposit-evidence-8-bbbbbbbbbbbb.jpg') && photo_is_sealed($raw('uploads/private/deposit-evidence-8-bbbbbbbbbbbb.jpg')) && photo_read($tmp . '/uploads/private/deposit-evidence-8-bbbbbbbbbbbb.jpg') === 'fresh deposit photo');
ph_ok('…and the private folder refuses every request by its own rule', strpos((string) @file_get_contents($tmp . '/uploads/private/.htaccess'), 'Require all denied') !== false);
$put('uploads/guest-bbbbbbbbbbbb.jpg');
ph_ok('a wall photo in public uploads/ is served from there and never moved (it may be on the wall)', photo_file('uploads/guest-bbbbbbbbbbbb.jpg') === $tmp . '/uploads/guest-bbbbbbbbbbbb.jpg' && is_file($tmp . '/uploads/guest-bbbbbbbbbbbb.jpg'));
ph_ok('a photo that is nowhere is nothing', photo_file('uploads/chat-cccccccccccc.jpg') === '' && photo_file('uploads/gallery-1.jpg') === '');
$put('uploads/pending/chat-dddddddddddd.jpg', 'staged chat photo');
ph_ok('a staged chat photo is held privately and named by its stored path', upload_hold('uploads/pending/chat-dddddddddddd.jpg') === 'uploads/chat-dddddddddddd.jpg' && is_file($tmp . '/uploads/private/chat-dddddddddddd.jpg') && !is_file($tmp . '/uploads/pending/chat-dddddddddddd.jpg'));
ph_ok('…encrypted', photo_is_sealed($raw('uploads/private/chat-dddddddddddd.jpg')) && photo_read($tmp . '/uploads/private/chat-dddddddddddd.jpg') === 'staged chat photo');
ph_ok('…once: holding it again finds nothing staged', upload_hold('uploads/pending/chat-dddddddddddd.jpg') === '');
$put('uploads/pending/experience-eeeeeeeeeeee.jpg', 'suggestion picture');
$put('uploads/pending/experience-eeeeeeeeeeee.jpg.webp', 'suggestion webp');
ph_ok('a staged suggestion picture is held privately too, encrypted', upload_hold('uploads/pending/experience-eeeeeeeeeeee.jpg') === 'uploads/experience-eeeeeeeeeeee.jpg' && photo_is_sealed($raw('uploads/private/experience-eeeeeeeeeeee.jpg')) && !is_file($tmp . '/uploads/pending/experience-eeeeeeeeeeee.jpg.webp'));
$put('uploads/pending/gallery-ffffffffffff.jpg');
ph_ok('a staged file that is not a private photo is not held', upload_hold('uploads/pending/gallery-ffffffffffff.jpg') === '' && is_file($tmp . '/uploads/pending/gallery-ffffffffffff.jpg'));
ph_ok('approving one releases it into public uploads/ decrypted, WebP copy and all', photo_release($tmp . '/uploads/private/experience-eeeeeeeeeeee.jpg', $tmp . '/uploads/experience-eeeeeeeeeeee.jpg') && $raw('uploads/experience-eeeeeeeeeeee.jpg') === 'suggestion picture' && $raw('uploads/experience-eeeeeeeeeeee.jpg.webp') === 'suggestion webp' && !is_file($tmp . '/uploads/private/experience-eeeeeeeeeeee.jpg') && !is_file($tmp . '/uploads/private/experience-eeeeeeeeeeee.jpg.webp'));
ph_ok('a photo that will not open is never released (nothing half-written goes public)', (function () use ($tmp, $put) {
    $put('uploads/private/guest-cccccccccccc.jpg', PHOTO_SEAL_MAGIC . str_repeat("\0", 40));
    return !photo_release($tmp . '/uploads/private/guest-cccccccccccc.jpg', $tmp . '/uploads/guest-cccccccccccc.jpg') && !is_file($tmp . '/uploads/guest-cccccccccccc.jpg') && is_file($tmp . '/uploads/private/guest-cccccccccccc.jpg');
})());

echo "== The private folder's own sweep ==\n";
$put('uploads/private/guest-dddddddddddd.jpg', 'waiting wall photo, plaintext from before');
$put('uploads/private/guest-dddddddddddd.jpg.webp', 'its webp, plaintext');
touch($tmp . '/uploads/private/guest-dddddddddddd.jpg', time() - 2 * 86400);
$put('uploads/private/notes.txt', 'not a photo');
$put('uploads/private/.guest-x.jpg.0a0b0c0d.tmp', 'left by a dying request');
touch($tmp . '/uploads/private/.guest-x.jpg.0a0b0c0d.tmp', time() - 7200);
$put('uploads/private/.guest-y.jpg.0a0b0c0e.tmp', 'a write in flight');
$n = photos_seal_private();
ph_ok('photos made private before encryption are encrypted where they lie (photo and WebP copy)', $n === 2 && abs((int) filemtime($tmp . '/uploads/private/guest-dddddddddddd.jpg') - (time() - 2 * 86400)) <= 2 && photo_is_sealed($raw('uploads/private/guest-dddddddddddd.jpg')) && photo_is_sealed($raw('uploads/private/guest-dddddddddddd.jpg.webp')) && photo_read($tmp . '/uploads/private/guest-dddddddddddd.jpg') === 'waiting wall photo, plaintext from before');
ph_ok('…nothing that is not a photo is touched, and what is sealed is not sealed twice', $raw('uploads/private/notes.txt') === 'not a photo' && photos_seal_private() === 0);
ph_ok('…a temporary file a dying request left is cleared after an hour, one in flight is not', !is_file($tmp . '/uploads/private/.guest-x.jpg.0a0b0c0d.tmp') && is_file($tmp . '/uploads/private/.guest-y.jpg.0a0b0c0e.tmp'));

echo "== The wiring ==\n";
// Code only: a comment saying what the code does must not pass for the code.
$code = function ($file) {
    $out = '';
    foreach (token_get_all((string) file_get_contents(__DIR__ . '/' . $file)) as $t) {
        $out .= is_array($t) ? (in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true) ? '' : $t[1]) : $t;
    }
    return $out;
};
$msg = $code('messages.php');
ph_ok('every message the chat hands out carries a signed link for its photo', strpos($msg, "'attachment' => chat_photo_out(") !== false && strpos($msg, 'photo_link($att)') !== false);
ph_ok('sending a chat photo holds it privately, never publishes it', strpos($msg, 'upload_hold($v)') !== false && strpos($msg, 'upload_publish(') === false);
ph_ok('the guest\'s email links to the photo for a week', strpos($code('chat-lib.php'), 'photo_link($attachment, PHOTO_MAIL_SECONDS)') !== false);
$ph = $code('photos.php');
ph_ok('a wall photo is held privately when it arrives', preg_match("/save_uploaded_image\\(\\\$_FILES\\['image'\\], 'guest', null, true, false\\)/", $ph) === 1 && strpos($ph, 'upload_hold($res[\'url\'])') !== false);
ph_ok('…the owner\'s list shows a waiting one through a signed link', strpos($ph, 'photo_link($r[\'url\'])') !== false);
ph_ok('…and approving it is what publishes it', strpos($ph, 'upload_publish($url)') !== false);
$db = $code('db.php');
ph_ok('publishing takes a wall photo or a suggestion\'s picture, never a chat or deposit photo', strpos($db, "((?:guest|experience)-[A-Za-z0-9._-]+") !== false && strpos($db, 'photo_release(') !== false);
ph_ok('a deposit photo is written straight into the private folder, never public uploads/', preg_match('/function deposit_evidence_store.*?photo_put_private\(\$raw, \$name\)/s', $db) === 1 && preg_match('/function deposit_evidence_store[^}]*file_put_contents/s', $db) === 0);
ph_ok('deleting a photo looks in the private folder too', preg_match("/foreach \\(\\['uploads', UPLOAD_PENDING_DIR, UPLOAD_PRIVATE_DIR\\]/", $db) === 1);
ph_ok('the deploy and the daily repair move photos kept before, and encrypt the private ones', strpos($code('migrate.php'), 'photos_make_private()') !== false && strpos($code('self-repair.php'), 'photos_make_private()') !== false && strpos($code('migrate.php'), 'photos_seal_private()') !== false && strpos($code('self-repair.php'), 'photos_seal_private()') !== false);
ph_ok('…and a waiting suggestion\'s picture moves with the waiting wall photos', strpos($db, "SELECT image_url FROM experiences WHERE status = 'pending'") !== false);
ph_ok('the image resizer refuses a chat or deposit photo', strpos($code('img.php'), "preg_match('#^uploads/(chat|deposit-evidence)-#i', \$src)") !== false);
$ex = $code('experiences.php');
ph_ok('a suggestion\'s picture is held privately when it arrives', strpos($ex, "save_uploaded_image(\$_FILES['image'], 'experience', null, true, false)") !== false && strpos($ex, 'upload_hold((string) $res[\'url\'])') !== false);
ph_ok('…the owner\'s list shows a waiting one through a signed link', strpos($ex, 'photo_link($img)') !== false);
ph_ok('…and approving or saving the card is what publishes it', preg_match("/action === 'approve'.*?exp_publish_image\(/s", $ex) === 1 && preg_match("/action === 'save'.*?exp_publish_image\(/s", $ex) === 1);
$bk = $code('bookings.php');
ph_ok('the booking\'s page shows a deposit photo through a signed link', preg_match("/'deposit\.evidence'.*?photo_link\(\\\$rel\)/s", $bk) === 1 && strpos($bk, "'meta' => ['photo' => \$evidence]") !== false);
$hta = (string) file_get_contents(__DIR__ . '/htaccess.txt');
ph_ok('.htaccess refuses the private and staging folders and the old chat and deposit addresses', strpos($hta, 'RewriteRule (?i)^uploads/(private|pending)/ - [F,L]') !== false && strpos($hta, 'RewriteRule (?i)^uploads/(cache/uploads_)?(chat|deposit-evidence)- - [F,L]') !== false);
// …and BEFORE the WebP rule, which would otherwise answer a .jpg with its .webp copy.
ph_ok('…before the rule that serves WebP copies', strpos($hta, '^uploads/(private|pending)/') < strpos($hta, 'RewriteCond %{HTTP_ACCEPT} image/webp'));
$pp = $code('photo.php');
ph_ok('photo.php loads no database and starts no session', strpos($pp, "require_once __DIR__ . '/db.php'") === false && strpos($pp, 'session_start') === false);
ph_ok('…and sends the photo decrypted, never the file as it lies on disk', strpos($pp, '$bytes = photo_read($file);') !== false && strpos($pp, 'readfile(') === false && strpos($pp, "'Content-Length: ' . (string) strlen(\$bytes)") !== false);
ph_ok('…and marks a photo private, never longer than the link lasts', strpos($pp, "'Cache-Control: private, max-age=' . max(0, min(86400, (int) \$exp - time()))") !== false);
ph_ok('the service worker never stores a photo.php answer (every .php but img.php passes through)', preg_match("/if \\(url\\.pathname\\.endsWith\\('\\.php'\\) && !isImgPhp\\) return;/", (string) file_get_contents(__DIR__ . '/sw.js')) === 1);

// Tidy the copy away.
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tmp, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
foreach ($it as $p) {
    $p->isDir() ? @rmdir($p->getPathname()) : @unlink($p->getPathname());
}
@rmdir($tmp);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail PHOTO CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass PHOTO CHECKS PASSED \u{2705}\n";
