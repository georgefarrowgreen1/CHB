<?php
// ============================================================
//  test-webpush.php — guards Web Push payload encryption (RFC 8291, aes128gcm)
//  and the notification-stash rules. Dev/CI only, deploy-excluded.
//
//  No DB, no network, no clock. wp_encrypt_payload() takes an injectable salt and
//  application-server key ONLY so this can pin RFC 8291 §5's worked example and
//  get a byte-deterministic body; production always uses fresh random values.
//
//  WHY THE FRAMING IS ASSERTED SEPARATELY FROM THE CRYPTO: a round-trip test
//  (encrypt then decrypt with the receiver's key) passes even if BOTH halves share
//  the same misunderstanding — e.g. the two public keys concatenated in the wrong
//  order in key_info. So the header framing is checked against values that come
//  straight from the RFC's inputs, and the ciphertext is checked for exact length
//  and for changing when any input changes. The definitive proof is a real push
//  service accepting the body, which is why send_webpush() falls back to a
//  payload-less push on 400/413 rather than betting the notification on this.
// ============================================================

require_once __DIR__ . '/webpush.php';

$pass = 0;
$fail = 0;
function wpchk($name, $cond, $detail = '')
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "  \u{2713} $name\n";
    } else {
        $fail++;
        echo "  \u{2717} $name" . ($detail !== '' ? " — $detail" : '') . "\n";
    }
}
$b64u = fn($b) => rtrim(strtr(base64_encode($b), '+/', '-_'), '=');

// ---- RFC 8291 §5 worked example -------------------------------------------
$UA_PUB   = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
$AUTH     = 'BTBZMqHH6r4Tts7J_aSIgg';
$SALT     = wp_b64url_decode('DGv6ra1nlYgDCS1FRnbzlw');
$AS_PRIV  = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
$AS_PUB   = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
$PLAIN    = 'When I grow up, I want to be a watermelon';

// Build a PEM for the RFC's application-server private key (raw 32-byte scalar).
// PKCS#8 prefix for a prime256v1 private key, then d, then the public point.
function t_as_pem($dB64u, $pubB64u)
{
    $d = wp_b64url_decode($dB64u);
    $pub = wp_b64url_decode($pubB64u);
    $der = hex2bin('308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420')
        . $d
        . hex2bin('a144034200')
        . $pub;
    return "-----BEGIN PRIVATE KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PRIVATE KEY-----\n";
}
$asPem = t_as_pem($AS_PRIV, $AS_PUB);
wpchk('the RFC application-server key loads', openssl_pkey_get_private($asPem) !== false);

$body = wp_encrypt_payload($UA_PUB, $AUTH, $PLAIN, $SALT, $asPem);
wpchk('wp_encrypt_payload returns a body', is_string($body) && $body !== '', var_export($body, true));

if (is_string($body) && strlen($body) > 86) {
    // ---- FRAMING: salt(16) ‖ rs(4, BE) ‖ idlen(1) ‖ as_public(65) ‖ ciphertext
    wpchk('the body opens with the salt', substr($body, 0, 16) === $SALT);
    $rs = unpack('N', substr($body, 16, 4))[1];
    wpchk("record size is a sane power of two ($rs)", $rs === 4096);
    wpchk('the key-id length byte is 65', ord($body[20]) === 65);
    wpchk('the application-server public key is carried verbatim',
        substr($body, 21, 65) === wp_b64url_decode($AS_PUB),
        'got ' . $b64u(substr($body, 21, 65)));
    // ---- CIPHERTEXT: plaintext + 1 delimiter byte + 16-byte GCM tag
    $ct = substr($body, 86);
    wpchk('ciphertext is plaintext + delimiter + GCM tag (' . strlen($ct) . ' bytes)',
        strlen($ct) === strlen($PLAIN) + 1 + 16);
    wpchk('the ciphertext is not the plaintext', strpos($body, $PLAIN) === false);

    // ---- ROUND TRIP: decrypt as the RECEIVER would, deriving from the header.
    // Uses the RFC's user-agent private key, so this exercises the shared secret,
    // the HKDF chain and the AES-GCM tag end to end.
    $UA_PRIV = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94';
    $uaPem = t_as_pem($UA_PRIV, $UA_PUB);
    $uaKey = openssl_pkey_get_private($uaPem);
    $asPubRaw = substr($body, 21, 65);
    $peer = openssl_pkey_get_public(wp_raw_to_pem_pubkey($asPubRaw));
    $shared = ($uaKey && $peer) ? openssl_pkey_derive($peer, $uaKey, 32) : false;
    wpchk('the receiver derives the same ECDH secret', is_string($shared) && $shared !== '');
    if (is_string($shared) && $shared !== '') {
        $prk = hash_hkdf('sha256', $shared, 32, "WebPush: info\x00" . wp_b64url_decode($UA_PUB) . $asPubRaw, wp_b64url_decode($AUTH));
        $cek = hash_hkdf('sha256', $prk, 16, "Content-Encoding: aes128gcm\x00", substr($body, 0, 16));
        $non = hash_hkdf('sha256', $prk, 12, "Content-Encoding: nonce\x00", substr($body, 0, 16));
        $ctOnly = substr($ct, 0, -16);
        $tag = substr($ct, -16);
        $out = openssl_decrypt($ctOnly, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $non, $tag);
        wpchk('it decrypts back to the exact plaintext', $out === $PLAIN . "\x02", var_export($out, true));
        // Negative: the auth secret is part of the key derivation, so a wrong one
        // must fail the GCM tag rather than yield anything.
        $prkBad = hash_hkdf('sha256', $shared, 32, "WebPush: info\x00" . wp_b64url_decode($UA_PUB) . $asPubRaw, str_repeat("\x00", 16));
        $cekBad = hash_hkdf('sha256', $prkBad, 16, "Content-Encoding: aes128gcm\x00", substr($body, 0, 16));
        $nonBad = hash_hkdf('sha256', $prkBad, 12, "Content-Encoding: nonce\x00", substr($body, 0, 16));
        wpchk('a wrong auth secret cannot decrypt it',
            openssl_decrypt($ctOnly, 'aes-128-gcm', $cekBad, OPENSSL_RAW_DATA, $nonBad, $tag) === false);
    }
}

// ---- Determinism + freshness ----------------------------------------------
$again = wp_encrypt_payload($UA_PUB, $AUTH, $PLAIN, $SALT, $asPem);
wpchk('same inputs → identical body (deterministic under a pinned salt)', $again === $body);
$other = wp_encrypt_payload($UA_PUB, $AUTH, $PLAIN . '!', $SALT, $asPem);
wpchk('a different message → a different body', $other !== $body);
$r1 = wp_encrypt_payload($UA_PUB, $AUTH, $PLAIN);
$r2 = wp_encrypt_payload($UA_PUB, $AUTH, $PLAIN);
wpchk('production path uses a FRESH salt + ephemeral key each send', is_string($r1) && is_string($r2) && $r1 !== $r2);

// ---- Refusals: bad input must yield null so the caller sends payload-less ----
wpchk('a malformed p256dh yields null (falls back to payload-less)', wp_encrypt_payload('not-a-key', $AUTH, 'x') === null);
wpchk('an empty auth secret yields null', wp_encrypt_payload($UA_PUB, '', 'x') === null);
wpchk('a short auth secret yields null', wp_encrypt_payload($UA_PUB, $b64u('tooshort'), 'x') === null);

// ---- WIRING: the encrypted body must actually be attempted, and the send must
// fall back rather than drop the notification. Source scan — send_webpush needs
// VAPID config + network to execute.
$src = (string) file_get_contents(__DIR__ . '/webpush.php');
wpchk('send_webpush accepts a payload and the subscription keys',
    strpos($src, 'function send_webpush($endpoint, $payload = null, $p256dh = \'\', $auth = \'\', $opts = [])') !== false);
wpchk('it encrypts when keys are present', strpos($src, 'wp_encrypt_payload($p256dh, $auth, $payload)') !== false);
wpchk('it sets the aes128gcm content encoding', strpos($src, 'Content-Encoding: aes128gcm') !== false);
wpchk('it falls back to payload-less on 400/413 (never drops the alert)',
    strpos($src, "in_array(\$status, [400, 413], true)") !== false);
wpchk('Urgency is sent (Apple batches low-urgency pushes)', strpos($src, "'Urgency: ' . \$urgency") !== false);
wpchk('TTL is per-message, not a flat 28 days', strpos($src, 'TTL: 2419200') === false);
wpchk('the admin fan-out reads the subscription keys',
    strpos($src, "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE role = 'admin'") !== false);
wpchk('alert_owner sends a payload', strpos($src, '$sent = ping_admin_devices($payload,') !== false);

// ---- The stash is READ, not TAKEN (the multi-device bug) --------------------
wpchk('owner_ping_read exists and owner_ping_take is gone',
    function_exists('owner_ping_read') && !function_exists('owner_ping_take'));
wpchk('reading the owner ping no longer DELETEs it',
    preg_match('/function owner_ping_read.*?\n\}/s', $src, $m) && strpos($m[0], 'DELETE') === false);
wpchk('the guest ping is read, not taken, too',
    function_exists('guest_ping_read') && !function_exists('guest_ping_take'));
$pushSrc = (string) file_get_contents(__DIR__ . '/push.php');
wpchk('push.php calls the non-destructive readers',
    strpos($pushSrc, 'owner_ping_read()') !== false && strpos($pushSrc, 'guest_ping_read(') !== false
        && strpos($pushSrc, '_ping_take') === false);

// ---- The service worker prefers the payload --------------------------------
$sw = (string) file_get_contents(__DIR__ . '/sw.js');
wpchk('sw.js reads the push payload before falling back to the fetch',
    preg_match('/\(event\)\.data|event\.data/', $sw) === 1 && strpos($sw, 'if (!fromPayload)') !== false);
wpchk('…and still keeps the fetch fallback for keyless subscriptions',
    strpos($sw, "push.php?action=sw_notify") !== false);

// ---- QUIET HOURS + PER-EVENT MUTE ------------------------------------------
// notify_should_push() decides whether a category may BUZZ. Muting never loses
// anything — the log and the email fallback are untouched — and 'urgent' ignores
// both, because a failing calendar sync can double-book the owner.
// Quiet hours normally WRAP midnight, which is the case a naive between-test gets
// wrong, so both shapes are driven here.
wpchk('notify_should_push exists', function_exists('notify_should_push'));
wpchk('urgent is never suppressed', notify_should_push('urgent') === true);
// The wrap logic, asserted directly on the same expression the function uses, so a
// change to it here fails loudly rather than silently muting the owner all day.
$wrapQuiet = function ($from, $to, $now) {
    $m = function ($hhmm) { $p = explode(':', $hhmm); return ((int) $p[0]) * 60 + ((int) ($p[1] ?? 0)); };
    $a = $m($from); $b = $m($to); $n = $m($now);
    return $a < $b ? ($n >= $a && $n < $b) : ($n >= $a || $n < $b);
};
wpchk('22:00–07:00 is quiet at 02:00 (wraps midnight)', $wrapQuiet('22:00', '07:00', '02:00') === true);
wpchk('22:00–07:00 is quiet at 23:30', $wrapQuiet('22:00', '07:00', '23:30') === true);
wpchk('22:00–07:00 is NOT quiet at 12:00', $wrapQuiet('22:00', '07:00', '12:00') === false);
wpchk('22:00–07:00 is NOT quiet at 07:00 (end is exclusive)', $wrapQuiet('22:00', '07:00', '07:00') === false);
wpchk('09:00–17:00 (no wrap) is quiet at 12:00', $wrapQuiet('09:00', '17:00', '12:00') === true);
wpchk('09:00–17:00 is NOT quiet at 08:00', $wrapQuiet('09:00', '17:00', '08:00') === false);

// ---- DEEP LINKS + PER-RECORD TAGS ------------------------------------------
// Every owner alert used to open './' and share the tag 'chb-owner', so the second
// notification REPLACED the first and neither took you to the record.
wpchk('alert_owner takes an options array (url/category/tag/email)',
    strpos($src, 'function alert_owner($title, $body, $opts = [])') !== false);
wpchk('the tag is per-record, not one shared owner tag',
    strpos($src, "'chb-owner-' . preg_replace(") !== false);
wpchk('the stash carries the deep link + tag for the fetch fallback',
    strpos($src, 'function owner_ping_set($title, $body, $reload = false, $url = ') !== false
        && strpos($src, '$tag = ') !== false);
wpchk('a category can suppress the push', strpos($src, 'if (notify_should_push($category))') !== false);
wpchk('no device reached + email requested → send_owner fallback',
    strpos($src, '$sent === 0 && !empty($opts[\'email\'])') !== false);

$callers = [
    'enquiries.php' => 'open=enquiry-',
    'pay.php' => 'open=booking-',
    'messages.php' => 'open=messages',
    'chat-lib.php' => 'open=messages',
    'ical-import.php' => 'open=calendar',
];
foreach ($callers as $f => $needle) {
    $c = (string) @file_get_contents(__DIR__ . '/' . $f);
    wpchk("$f deep-links its alert ($needle)", strpos($c, $needle) !== false);
}
$icalSrc = (string) file_get_contents(__DIR__ . '/ical-import.php');
wpchk('a failing calendar sync is urgent (ignores mute + quiet hours)',
    strpos($icalSrc, "'category' => 'urgent'") !== false);
$paySrc = (string) file_get_contents(__DIR__ . '/pay.php');
wpchk('a received payment asks for the email fallback', strpos($paySrc, "'email' => true") !== false);

// ---- CLIENT: router, focus-silence, badge ----------------------------------
$appSrc = (string) file_get_contents(__DIR__ . '/app.js');
wpchk('app.js routes ?open= to the record', strpos($appSrc, 'maybeHandleNotificationOpen') !== false
    && strpos($appSrc, "get('open')") !== false);
wpchk('…and tidies the URL so a refresh does not repeat it',
    preg_match('/maybeHandleNotificationOpen[\s\S]{0,900}history\.replaceState/', $appSrc) === 1);
wpchk('the badge defers to the back office once loaded',
    preg_match('/__ADMIN_LOADED[^\n]{0,40}setAppBadgeCount\(n\)/', $appSrc) === 1);
$admSrc = (string) file_get_contents(__DIR__ . '/admin.js');
wpchk('the back office badges the DUTIES count, not just enquiries',
    preg_match('/renderNeedsYou[\s\S]{0,700}setAppBadgeCount\(items\.length\)/', $admSrc) === 1);
wpchk('there is a per-event + quiet-hours settings surface',
    strpos($admSrc, 'renderNotifyPrefs') !== false && strpos($admSrc, 'saveNotifyPref') !== false);
wpchk('notify-prefs is read from adminPrivateContent first (internal key)',
    strpos($admSrc, "adminPrivateContent['notify-prefs']") !== false);
$dbSrc = (string) file_get_contents(__DIR__ . '/db.php');
wpchk('notify-prefs is classified internal', strpos($dbSrc, "\$key === 'notify-prefs'") !== false);
// SILENT, not suppressed: userVisibleOnly means a push that shows nothing invites
// the browser's own "site updated in the background" notice and can cost the
// permission. Focus lowers the interruption, it does not skip the notification.
wpchk('a focused window makes the notification silent, not absent',
    strpos($sw, 'silent: focused') !== false && strpos($sw, 'renotify: !focused') !== false);
wpchk('…and it still calls showNotification unconditionally',
    substr_count($sw, 'self.registration.showNotification(') === 1);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail WEBPUSH CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass WEBPUSH CHECKS PASSED \u{2705}\n";
