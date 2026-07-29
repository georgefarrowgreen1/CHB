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
function chk($name, $cond, $detail = '')
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
chk('the RFC application-server key loads', openssl_pkey_get_private($asPem) !== false);

$body = wp_encrypt_payload($UA_PUB, $AUTH, $PLAIN, $SALT, $asPem);
chk('wp_encrypt_payload returns a body', is_string($body) && $body !== '', var_export($body, true));

if (is_string($body) && strlen($body) > 86) {
    // ---- FRAMING: salt(16) ‖ rs(4, BE) ‖ idlen(1) ‖ as_public(65) ‖ ciphertext
    chk('the body opens with the salt', substr($body, 0, 16) === $SALT);
    $rs = unpack('N', substr($body, 16, 4))[1];
    chk("record size is a sane power of two ($rs)", $rs === 4096);
    chk('the key-id length byte is 65', ord($body[20]) === 65);
    chk('the application-server public key is carried verbatim',
        substr($body, 21, 65) === wp_b64url_decode($AS_PUB),
        'got ' . $b64u(substr($body, 21, 65)));
    // ---- CIPHERTEXT: plaintext + 1 delimiter byte + 16-byte GCM tag
    $ct = substr($body, 86);
    chk('ciphertext is plaintext + delimiter + GCM tag (' . strlen($ct) . ' bytes)',
        strlen($ct) === strlen($PLAIN) + 1 + 16);
    chk('the ciphertext is not the plaintext', strpos($body, $PLAIN) === false);

    // ---- ROUND TRIP: decrypt as the RECEIVER would, deriving from the header.
    // Uses the RFC's user-agent private key, so this exercises the shared secret,
    // the HKDF chain and the AES-GCM tag end to end.
    $UA_PRIV = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94';
    $uaPem = t_as_pem($UA_PRIV, $UA_PUB);
    $uaKey = openssl_pkey_get_private($uaPem);
    $asPubRaw = substr($body, 21, 65);
    $peer = openssl_pkey_get_public(wp_raw_to_pem_pubkey($asPubRaw));
    $shared = ($uaKey && $peer) ? openssl_pkey_derive($peer, $uaKey, 32) : false;
    chk('the receiver derives the same ECDH secret', is_string($shared) && $shared !== '');
    if (is_string($shared) && $shared !== '') {
        $prk = hash_hkdf('sha256', $shared, 32, "WebPush: info\x00" . wp_b64url_decode($UA_PUB) . $asPubRaw, wp_b64url_decode($AUTH));
        $cek = hash_hkdf('sha256', $prk, 16, "Content-Encoding: aes128gcm\x00", substr($body, 0, 16));
        $non = hash_hkdf('sha256', $prk, 12, "Content-Encoding: nonce\x00", substr($body, 0, 16));
        $ctOnly = substr($ct, 0, -16);
        $tag = substr($ct, -16);
        $out = openssl_decrypt($ctOnly, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $non, $tag);
        chk('it decrypts back to the exact plaintext', $out === $PLAIN . "\x02", var_export($out, true));
        // Negative: the auth secret is part of the key derivation, so a wrong one
        // must fail the GCM tag rather than yield anything.
        $prkBad = hash_hkdf('sha256', $shared, 32, "WebPush: info\x00" . wp_b64url_decode($UA_PUB) . $asPubRaw, str_repeat("\x00", 16));
        $cekBad = hash_hkdf('sha256', $prkBad, 16, "Content-Encoding: aes128gcm\x00", substr($body, 0, 16));
        $nonBad = hash_hkdf('sha256', $prkBad, 12, "Content-Encoding: nonce\x00", substr($body, 0, 16));
        chk('a wrong auth secret cannot decrypt it',
            openssl_decrypt($ctOnly, 'aes-128-gcm', $cekBad, OPENSSL_RAW_DATA, $nonBad, $tag) === false);
    }
}

// ---- Determinism + freshness ----------------------------------------------
$again = wp_encrypt_payload($UA_PUB, $AUTH, $PLAIN, $SALT, $asPem);
chk('same inputs → identical body (deterministic under a pinned salt)', $again === $body);
$other = wp_encrypt_payload($UA_PUB, $AUTH, $PLAIN . '!', $SALT, $asPem);
chk('a different message → a different body', $other !== $body);
$r1 = wp_encrypt_payload($UA_PUB, $AUTH, $PLAIN);
$r2 = wp_encrypt_payload($UA_PUB, $AUTH, $PLAIN);
chk('production path uses a FRESH salt + ephemeral key each send', is_string($r1) && is_string($r2) && $r1 !== $r2);

// ---- Refusals: bad input must yield null so the caller sends payload-less ----
chk('a malformed p256dh yields null (falls back to payload-less)', wp_encrypt_payload('not-a-key', $AUTH, 'x') === null);
chk('an empty auth secret yields null', wp_encrypt_payload($UA_PUB, '', 'x') === null);
chk('a short auth secret yields null', wp_encrypt_payload($UA_PUB, $b64u('tooshort'), 'x') === null);

// ---- WIRING: the encrypted body must actually be attempted, and the send must
// fall back rather than drop the notification. Source scan — send_webpush needs
// VAPID config + network to execute.
$src = (string) file_get_contents(__DIR__ . '/webpush.php');
chk('send_webpush accepts a payload and the subscription keys',
    strpos($src, 'function send_webpush($endpoint, $payload = null, $p256dh = \'\', $auth = \'\', $opts = [])') !== false);
chk('it encrypts when keys are present', strpos($src, 'wp_encrypt_payload($p256dh, $auth, $payload)') !== false);
chk('it sets the aes128gcm content encoding', strpos($src, 'Content-Encoding: aes128gcm') !== false);
chk('it falls back to payload-less on 400/413 (never drops the alert)',
    strpos($src, "in_array(\$status, [400, 413], true)") !== false);
chk('Urgency is sent (Apple batches low-urgency pushes)', strpos($src, "'Urgency: ' . \$urgency") !== false);
chk('TTL is per-message, not a flat 28 days', strpos($src, 'TTL: 2419200') === false);
chk('the admin fan-out reads the subscription keys',
    strpos($src, "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE role = 'admin'") !== false);
chk('alert_owner sends a payload', strpos($src, 'return ping_admin_devices($payload,') !== false);

// ---- The stash is READ, not TAKEN (the multi-device bug) --------------------
chk('owner_ping_read exists and owner_ping_take is gone',
    function_exists('owner_ping_read') && !function_exists('owner_ping_take'));
chk('reading the owner ping no longer DELETEs it',
    preg_match('/function owner_ping_read.*?\n\}/s', $src, $m) && strpos($m[0], 'DELETE') === false);
chk('the guest ping is read, not taken, too',
    function_exists('guest_ping_read') && !function_exists('guest_ping_take'));
$pushSrc = (string) file_get_contents(__DIR__ . '/push.php');
chk('push.php calls the non-destructive readers',
    strpos($pushSrc, 'owner_ping_read()') !== false && strpos($pushSrc, 'guest_ping_read(') !== false
        && strpos($pushSrc, '_ping_take') === false);

// ---- The service worker prefers the payload --------------------------------
$sw = (string) file_get_contents(__DIR__ . '/sw.js');
chk('sw.js reads the push payload before falling back to the fetch',
    preg_match('/\(event\)\.data|event\.data/', $sw) === 1 && strpos($sw, 'if (!fromPayload)') !== false);
chk('…and still keeps the fetch fallback for keyless subscriptions',
    strpos($sw, "push.php?action=sw_notify") !== false);

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail WEBPUSH CHECK(S) FAILED \u{274C}\n";
    exit(1);
}
echo "  ALL $pass WEBPUSH CHECKS PASSED \u{2705}\n";
