<?php
// ============================================================
//  webpush.php — minimal, dependency-free Web Push sender (VAPID, payload-less).
//
//  Sends a "wake" push authorised with a VAPID JWT (ES256, signed via openssl).
//  No message body is encrypted — the service worker (sw.js) shows a fixed
//  notification — which keeps this to standard PHP (openssl + curl), no Composer.
//
//  Requires in config.php (generate with vapid-keygen.php):
//    VAPID_PUBLIC_KEY   base64url, uncompressed P-256 point
//    VAPID_PRIVATE_KEY  EC private key in PEM
//    VAPID_SUBJECT      'mailto:you@yourdomain' or your site URL
// ============================================================

function wp_b64url($bin) { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }

// ECDSA DER signature -> raw 64-byte R||S (what JWS ES256 expects).
function wp_der_to_raw($der) {
    $off = 0;
    if (!isset($der[1]) || ord($der[$off++]) !== 0x30) return false;
    $lenByte = ord($der[$off++]);
    if ($lenByte & 0x80) { $off += ($lenByte & 0x7f); }   // skip long-form length
    if (ord($der[$off++]) !== 0x02) return false;
    $rlen = ord($der[$off++]); $r = substr($der, $off, $rlen); $off += $rlen;
    if (ord($der[$off++]) !== 0x02) return false;
    $slen = ord($der[$off++]); $s = substr($der, $off, $slen);
    $r = str_pad(ltrim($r, "\x00"), 32, "\x00", STR_PAD_LEFT);
    $s = str_pad(ltrim($s, "\x00"), 32, "\x00", STR_PAD_LEFT);
    return $r . $s;
}

function wp_vapid_configured() {
    return defined('VAPID_PUBLIC_KEY') && VAPID_PUBLIC_KEY !== ''
        && defined('VAPID_PRIVATE_KEY') && wp_private_pem() !== '';
}

// The private key may be stored as a raw PEM or (preferred, paste-safe) as a
// single base64 line of that PEM. Return the PEM either way, or '' if unset.
function wp_private_pem() {
    if (!defined('VAPID_PRIVATE_KEY')) return '';
    $k = trim((string)VAPID_PRIVATE_KEY);
    if ($k === '') return '';
    if (strpos($k, 'BEGIN') !== false) return $k;            // already a PEM
    $dec = base64_decode($k, true);                          // else base64-of-PEM
    return ($dec !== false && strpos($dec, 'BEGIN') !== false) ? $dec : '';
}

// Build a VAPID JWT for a push service origin (e.g. https://fcm.googleapis.com).
function wp_vapid_jwt($audience) {
    $header = wp_b64url(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $claims = wp_b64url(json_encode([
        'aud' => $audience,
        'exp' => time() + 12 * 3600,
        'sub' => defined('VAPID_SUBJECT') && VAPID_SUBJECT !== '' ? VAPID_SUBJECT : 'mailto:admin@localhost',
    ]));
    $input = $header . '.' . $claims;
    $pkey = openssl_pkey_get_private(wp_private_pem());
    if (!$pkey) return false;
    $der = '';
    if (!openssl_sign($input, $der, $pkey, OPENSSL_ALGO_SHA256)) return false;
    $raw = wp_der_to_raw($der);
    if ($raw === false) return false;
    return $input . '.' . wp_b64url($raw);
}

// Send a payload-less push to one endpoint.
// Returns ['ok'=>bool, 'status'=>int]; status 404/410 means the subscription is dead.
function send_webpush($endpoint) {
    if (!wp_vapid_configured()) return ['ok' => false, 'status' => 0, 'error' => 'vapid_not_configured'];
    $u = parse_url($endpoint);
    if (!$u || empty($u['scheme']) || empty($u['host'])) return ['ok' => false, 'status' => 0, 'error' => 'bad_endpoint'];
    $jwt = wp_vapid_jwt($u['scheme'] . '://' . $u['host']);
    if ($jwt === false) return ['ok' => false, 'status' => 0, 'error' => 'jwt_failed'];

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => '',
        CURLOPT_HTTPHEADER => [
            'Authorization: vapid t=' . $jwt . ', k=' . VAPID_PUBLIC_KEY,
            'TTL: 2419200',
            'Content-Length: 0',
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
    ]);
    curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['ok' => $status >= 200 && $status < 300, 'status' => $status];
}
