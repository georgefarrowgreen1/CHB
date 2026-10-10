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

function wp_b64url($bin)
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

// ECDSA DER signature -> raw 64-byte R||S (what JWS ES256 expects).
function wp_der_to_raw($der)
{
    $off = 0;
    if (!isset($der[1]) || ord($der[$off++]) !== 0x30) {
        return false;
    }
    $lenByte = ord($der[$off++]);
    if ($lenByte & 0x80) {
        $off += $lenByte & 0x7f;
    } // skip long-form length
    if (ord($der[$off++]) !== 0x02) {
        return false;
    }
    $rlen = ord($der[$off++]);
    $r = substr($der, $off, $rlen);
    $off += $rlen;
    if (ord($der[$off++]) !== 0x02) {
        return false;
    }
    $slen = ord($der[$off++]);
    $s = substr($der, $off, $slen);
    $r = str_pad(ltrim($r, "\x00"), 32, "\x00", STR_PAD_LEFT);
    $s = str_pad(ltrim($s, "\x00"), 32, "\x00", STR_PAD_LEFT);
    return $r . $s;
}

function wp_vapid_configured()
{
    return defined('VAPID_PUBLIC_KEY') &&
        VAPID_PUBLIC_KEY !== '' &&
        defined('VAPID_PRIVATE_KEY') &&
        wp_private_pem() !== '';
}

// The private key may be stored as a raw PEM or (preferred, paste-safe) as a
// single base64 line of that PEM. Return the PEM either way, or '' if unset.
function wp_private_pem()
{
    if (!defined('VAPID_PRIVATE_KEY')) {
        return '';
    }
    $k = trim((string) VAPID_PRIVATE_KEY);
    if ($k === '') {
        return '';
    }
    if (strpos($k, 'BEGIN') !== false) {
        return $k;
    } // already a PEM
    $dec = base64_decode($k, true); // else base64-of-PEM
    return $dec !== false && strpos($dec, 'BEGIN') !== false ? $dec : '';
}

// Build a VAPID JWT for a push service origin (e.g. https://fcm.googleapis.com).
function wp_vapid_jwt($audience)
{
    $header = wp_b64url(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $claims = wp_b64url(
        json_encode([
            'aud' => $audience,
            'exp' => time() + 12 * 3600,
            'sub' => defined('VAPID_SUBJECT') && VAPID_SUBJECT !== '' ? VAPID_SUBJECT : 'mailto:admin@localhost',
        ]),
    );
    $input = $header . '.' . $claims;
    $pkey = openssl_pkey_get_private(wp_private_pem());
    if (!$pkey) {
        return false;
    }
    $der = '';
    if (!openssl_sign($input, $der, $pkey, OPENSSL_ALGO_SHA256)) {
        return false;
    }
    $raw = wp_der_to_raw($der);
    if ($raw === false) {
        return false;
    }
    return $input . '.' . wp_b64url($raw);
}

// A push endpoint must be HTTPS at a known push-service domain. Clients supply the
// endpoint, so without this a subscription (or the ?action=test loop) could point
// curl at an internal/loopback address — a blind SSRF probe. Restricting to the
// real providers (FCM, Mozilla, Apple, WNS) rules out IP-literal and internal hosts
// entirely. Used at store time (push.php) and again here as the send chokepoint.
function wp_endpoint_allowed($endpoint)
{
    $u = parse_url((string) $endpoint);
    if (!$u || ($u['scheme'] ?? '') !== 'https' || empty($u['host'])) {
        return false;
    }
    $host = strtolower($u['host']);
    foreach (
        ['googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com', 'wns.windows.com']
        as $suf
    ) {
        if ($host === $suf || substr($host, -strlen($suf) - 1) === '.' . $suf) {
            return true;
        }
    }
    return false;
}

// ---- Payload encryption (RFC 8291, aes128gcm) ------------------------------
// Pushes used to carry NO body, so sw.js had to fetch the text from
// push.php?action=sw_notify before it could show anything — a network round trip
// and a live admin session at the exact moment the notification fires. On a phone
// with poor signal that yields the generic "You have a new notification", and on
// iOS the service worker has only a short budget to show something. Encrypting the
// body removes the round trip entirely.
//
// Pure openssl + hash_hkdf: ECDH P-256 to a shared secret, HKDF to a content key
// and nonce, AES-128-GCM over the padded plaintext, then the aes128gcm framing
// (salt ‖ rs ‖ idlen ‖ app-server public key ‖ ciphertext).
//
// $salt/$asPem are injectable ONLY so the tests can pin the RFC's example inputs
// and get a deterministic body; production always uses fresh random values.
function wp_raw_to_pem_pubkey($raw65)
{
    if (strlen($raw65) !== 65 || $raw65[0] !== "\x04") {
        return false;
    }
    // SubjectPublicKeyInfo for an uncompressed prime256v1 point — fixed prefix.
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raw65;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

function wp_ec_raw_public($keyResource)
{
    $d = openssl_pkey_get_details($keyResource);
    if (!$d || empty($d['ec']['x']) || empty($d['ec']['y'])) {
        return false;
    }
    return "\x04" . str_pad($d['ec']['x'], 32, "\x00", STR_PAD_LEFT) . str_pad($d['ec']['y'], 32, "\x00", STR_PAD_LEFT);
}

// Returns the aes128gcm body, or null if anything is missing/unsupported (the
// caller then sends payload-less, which is exactly the old behaviour).
function wp_encrypt_payload($p256dhB64u, $authB64u, $plaintext, $salt = null, $asPem = null)
{
    if (!function_exists('hash_hkdf') || !function_exists('openssl_pkey_derive')) {
        return null;
    }
    $ua = wp_b64url_decode($p256dhB64u);
    $authSecret = wp_b64url_decode($authB64u);
    if (strlen($ua) !== 65 || strlen($authSecret) < 16) {
        return null;
    }
    $uaPem = wp_raw_to_pem_pubkey($ua);
    if ($uaPem === false) {
        return null;
    }
    $peer = openssl_pkey_get_public($uaPem);
    if (!$peer) {
        return null;
    }
    $as = $asPem !== null
        ? openssl_pkey_get_private($asPem)
        : openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if (!$as) {
        return null;
    }
    $asPub = wp_ec_raw_public($as);
    if ($asPub === false) {
        return null;
    }
    $shared = openssl_pkey_derive($peer, $as, 32);
    if ($shared === false || $shared === '') {
        return null;
    }
    if ($salt === null) {
        $salt = random_bytes(16);
    }
    // PRK: the auth secret is the HKDF salt here, and the info binds BOTH public
    // keys (receiver first, then sender) so the key can't be reused elsewhere.
    $keyInfo = "WebPush: info\x00" . $ua . $asPub;
    $prk = hash_hkdf('sha256', $shared, 32, $keyInfo, $authSecret);
    $cek = hash_hkdf('sha256', $prk, 16, "Content-Encoding: aes128gcm\x00", $salt);
    $nonce = hash_hkdf('sha256', $prk, 12, "Content-Encoding: nonce\x00", $salt);
    // 0x02 is the last-record delimiter; there is exactly one record.
    $tag = '';
    $ct = openssl_encrypt($plaintext . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    if ($ct === false) {
        return null;
    }
    $rs = 4096;
    return $salt . pack('N', $rs) . chr(strlen($asPub)) . $asPub . $ct . $tag;
}

function wp_b64url_decode($s)
{
    $s = strtr((string) $s, '-_', '+/');
    $pad = strlen($s) % 4;
    if ($pad) {
        $s .= str_repeat('=', 4 - $pad);
    }
    $d = base64_decode($s, true);
    return $d === false ? '' : $d;
}

// Send a push to one endpoint, with an ENCRYPTED body when the subscription's keys
// allow it and payload-less otherwise (older rows stored before the keys were
// captured). $opts: ttl (seconds), urgency ('very-low'|'low'|'normal'|'high').
// Returns ['ok'=>bool, 'status'=>int]; status 404/410 means the subscription is dead.
function send_webpush($endpoint, $payload = null, $p256dh = '', $auth = '', $opts = [])
{
    if (!wp_vapid_configured()) {
        return ['ok' => false, 'status' => 0, 'error' => 'vapid_not_configured'];
    }
    $u = parse_url($endpoint);
    if (!$u || empty($u['scheme']) || empty($u['host'])) {
        return ['ok' => false, 'status' => 0, 'error' => 'bad_endpoint'];
    }
    if (!wp_endpoint_allowed($endpoint)) {
        return ['ok' => false, 'status' => 0, 'error' => 'blocked_endpoint'];
    }
    $jwt = wp_vapid_jwt($u['scheme'] . '://' . $u['host']);
    if ($jwt === false) {
        return ['ok' => false, 'status' => 0, 'error' => 'jwt_failed'];
    }

    // TTL is per-message now. It was a flat 28 days, which is wrong for anything
    // time-sensitive: a phone that was off could be handed a week-old "£900 paid"
    // long after it mattered. Urgency:high asks the push service not to sit on it
    // (Apple in particular batches low-urgency pushes to save battery).
    $ttl = isset($opts['ttl']) ? max(0, (int) $opts['ttl']) : 86400;
    $urgency = isset($opts['urgency']) ? (string) $opts['urgency'] : 'high';

    $body = '';
    $extra = [];
    if ($payload !== null && $payload !== '' && $p256dh !== '' && $auth !== '') {
        $enc = wp_encrypt_payload($p256dh, $auth, $payload);
        if ($enc !== null) {
            $body = $enc;
            $extra = ['Content-Encoding: aes128gcm', 'Content-Type: application/octet-stream'];
        }
    }

    $post = function ($body, $extra) use ($endpoint, $jwt, $ttl, $urgency) {
        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => array_merge(
                [
                    'Authorization: vapid t=' . $jwt . ', k=' . VAPID_PUBLIC_KEY,
                    'TTL: ' . $ttl,
                    'Urgency: ' . $urgency,
                    'Content-Length: ' . strlen($body),
                ],
                $extra,
            ),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ]);
        curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return $status;
    };

    $status = $post($body, $extra);
    // SAFE ROLLOUT: if a push service refuses the encrypted body (400 malformed,
    // 413 too large), fall straight back to the payload-less push — which is
    // exactly the behaviour that worked before. The service worker still has its
    // fetch fallback, so the owner is never worse off than they were.
    if ($body !== '' && in_array($status, [400, 413], true)) {
        $status = $post('', []);
    }
    return ['ok' => $status >= 200 && $status < 300, 'status' => $status];
}

// ---- Owner (admin) alerts -------------------------------------------------
// Because pushes are payload-less, we stash the latest owner notification in the
// content table; the service worker fetches it (push.php?action=sw_notify) when a
// ping arrives and shows it once. Best-effort throughout — never throws.
function owner_ping_set($title, $body, $reload = false, $url = './', $tag = 'chb-owner')
{
    try {
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value) VALUES ('owner-ping', ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
            )
            ->execute([
                json_encode(
                    ['title' => (string) $title, 'body' => (string) $body, 'reload' => (bool) $reload, 'url' => (string) $url, 'tag' => (string) $tag, 'at' => time()],
                    JSON_UNESCAPED_UNICODE,
                ),
            ]);
    } catch (\Throwable $e) {
    }
}
// READ, never TAKE. This used to DELETE the row, and alert_owner() wakes EVERY
// admin device — so the first device to fetch consumed the message and every other
// one fell through to the generic "You have a new notification". An owner with an
// iPhone and an iPad got the real text on exactly one of them, at random.
//
// Nothing consumes it now; freshness does the job instead. A ping is only written
// immediately before a push, so any device woken by that push finds it. One older
// than $maxAge is ignored, which also fixes the other half: a push delivered days
// late (phone off, TTL was 28 days) used to pick up whatever the CURRENT message
// happened to be and show it as if it were the reason for the alert.
function owner_ping_read($maxAge = 300)
{
    try {
        $s = db()->prepare("SELECT item_value FROM content WHERE item_key = 'owner-ping'");
        $s->execute();
        $v = $s->fetchColumn();
        if ($v === false) {
            return null;
        }
        $d = json_decode((string) $v, true);
        if (!is_array($d)) {
            return null;
        }
        $at = (int) ($d['at'] ?? 0);
        if ($maxAge > 0 && $at > 0 && time() - $at > $maxAge) {
            return null; // stale — an old push, not this message
        }
        return $d;
    } catch (\Throwable $e) {
        return null;
    }
}

// Per-guest ping stash (mirrors owner_ping_*): because pushes are payload-less,
// stash the guest's next notification text keyed by their id; sw.js fetches it
// (push.php?action=sw_notify) when the ping lands, and it's consumed once.
function guest_ping_set($guestId, $title, $body, $url = './')
{
    try {
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value) VALUES (?, ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
            )
            ->execute([
                'guest-ping-' . (int) $guestId,
                json_encode(
                    ['title' => (string) $title, 'body' => (string) $body, 'url' => (string) $url, 'at' => time()],
                    JSON_UNESCAPED_UNICODE,
                ),
            ]);
    } catch (\Throwable $e) {
    }
}
// READ, never TAKE — the guest half of the same bug owner_ping_read fixes: a guest
// with a phone and a tablet had the message consumed by whichever woke first.
function guest_ping_read($guestId, $maxAge = 300)
{
    try {
        $k = 'guest-ping-' . (int) $guestId;
        $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
        $s->execute([$k]);
        $v = $s->fetchColumn();
        if ($v === false) {
            return null;
        }
        $d = json_decode((string) $v, true);
        if (!is_array($d)) {
            return null;
        }
        $at = (int) ($d['at'] ?? 0);
        if ($maxAge > 0 && $at > 0 && time() - $at > $maxAge) {
            return null;
        }
        return $d;
    } catch (\Throwable $e) {
        return null;
    }
}

// Wake the back office's devices. Each device belongs to the person who turned
// alerts on there (admin_id; NULL = a device from before people existed, the
// first owner's). $who decides, per person, whether their phones get this one
// (null = every device). Dead subscriptions (404/410) are pruned. Returns count;
// $reached gets how many of EACH person's devices it reached (by person id).
function ping_admin_devices($payload = null, $opts = [], $who = null, &$reached = [])
{
    if (!wp_vapid_configured()) {
        return 0;
    }
    try {
        try {
            $rows = db()->query("SELECT id, endpoint, p256dh, auth, admin_id FROM push_subscriptions WHERE role = 'admin'")->fetchAll();
        } catch (\Throwable $e) {
            $rows = db()->query("SELECT id, endpoint, p256dh, auth, NULL AS admin_id FROM push_subscriptions WHERE role = 'admin'")->fetchAll();
        }
    } catch (\Throwable $e) {
        return 0;
    }
    $people = notify_people();
    $sent = 0;
    foreach ($rows as $sub) {
        if ($who !== null) {
            $aid = $sub['admin_id'] === null ? admin_original_owner_id() : (int) $sub['admin_id'];
            // Before the people migration there is one owner and every device is theirs.
            $row = $people === null ? ['id' => $aid] : ($people[$aid] ?? null);
            if (!$row || !$who($row)) {
                continue;
            }
        }
        $r = send_webpush($sub['endpoint'], $payload, (string) ($sub['p256dh'] ?? ''), (string) ($sub['auth'] ?? ''), $opts);
        if (!empty($r['ok'])) {
            $sent++;
            $aid = $sub['admin_id'] === null ? admin_original_owner_id() : (int) $sub['admin_id'];
            $reached[$aid] = ($reached[$aid] ?? 0) + 1;
        } elseif (in_array($r['status'] ?? 0, [404, 410], true)) {
            try {
                db()
                    ->prepare('DELETE FROM push_subscriptions WHERE id = ?')
                    ->execute([(int) $sub['id']]);
            } catch (\Throwable $e) {
            }
        }
    }
    return $sent;
}
// The people whose phones may be woken (signed-in kind: not removed, not still
// invited), by id. null when the people columns are not migrated yet.
function notify_people()
{
    static $people = false;
    if ($people !== false) {
        return $people;
    }
    try {
        $people = [];
        foreach (db()->query('SELECT * FROM admins WHERE removed_at IS NULL AND invited_at IS NULL')->fetchAll() as $r) {
            $people[(int) $r['id']] = $r;
        }
    } catch (\Throwable $e) {
        $people = null;
    }
    return $people;
}
// Convenience: set the owner alert text AND wake their devices.
// ---- Alert settings ----------------------------------------------------------
// Each person's own: what interrupts them and their quiet hours, in their row
// (admins.notify_prefs). The first owner's predate that and lived in ONE internal
// content key, which is still their settings until they change one. Absent or
// unparseable = everything on, which is the behaviour before any of this existed.
//   { money:bool, enquiries:bool, messages:bool, checkout:bool, system:bool,
//     quietFrom:'HH:MM', quietTo:'HH:MM' }
const NOTIFY_DEFAULTS = ['money' => true, 'enquiries' => true, 'messages' => true, 'checkout' => true, 'system' => true, 'quietFrom' => '', 'quietTo' => ''];
// Someone added later starts with the guest-facing alerts on.
const NOTIFY_DEFAULTS_LIMITED = ['money' => false, 'enquiries' => true, 'messages' => true, 'checkout' => true, 'system' => false, 'quietFrom' => '', 'quietTo' => ''];
function notify_prefs()
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $d = [];
    try {
        $s = db()->prepare("SELECT item_value FROM content WHERE item_key = 'notify-prefs'");
        $s->execute();
        $v = $s->fetchColumn();
        if ($v !== false) {
            $j = json_decode((string) $v, true);
            if (is_array($j)) {
                $d = $j;
            }
        }
    } catch (\Throwable $e) {
    }
    $cache = $d + NOTIFY_DEFAULTS;
    return $cache;
}
function notify_prefs_for($row)
{
    $own = is_array($row) && isset($row['notify_prefs']) && $row['notify_prefs'] !== '' ? json_decode((string) $row['notify_prefs'], true) : null;
    if (is_array($own)) {
        return $own + (people_is_full($row) ? NOTIFY_DEFAULTS : NOTIFY_DEFAULTS_LIMITED);
    }
    if (!is_array($row) || (int) ($row['id'] ?? 0) === admin_original_owner_id()) {
        return notify_prefs();
    }
    return people_is_full($row) ? NOTIFY_DEFAULTS : NOTIFY_DEFAULTS_LIMITED;
}
// Is $p muting this category, or inside its quiet hours, right now?
function notify_prefs_allow($p, $category)
{
    if (isset($p[$category]) && !$p[$category]) {
        return false;
    }
    $from = (string) ($p['quietFrom'] ?? '');
    $to = (string) ($p['quietTo'] ?? '');
    if ($from === '' || $to === '' || $from === $to) {
        return true;
    }
    $now = (int) date('H') * 60 + (int) date('i');
    $mins = function ($hhmm) {
        $parts = explode(':', $hhmm);
        return ((int) ($parts[0] ?? 0)) * 60 + ((int) ($parts[1] ?? 0));
    };
    $a = $mins($from);
    $b = $mins($to);
    // Quiet hours normally WRAP midnight (22:00 → 07:00), so the inside test is
    // the union of the two ends, not a simple between.
    $quiet = $a < $b ? ($now >= $a && $now < $b) : ($now >= $a || $now < $b);
    return !$quiet;
}
// Should a PUSH be sent for this category right now (the old shared settings)?
// A muted category or a quiet hour suppresses the push ONLY — the activity log
// and the email fallback are untouched, so nothing is lost. 'urgent' ignores
// both: a failing calendar sync that will double-book you is worth it.
function notify_should_push($category)
{
    return $category === 'urgent' || notify_prefs_allow(notify_prefs(), $category);
}
// …and for one person: never an area switched off for them (payment alerts need
// Record payments, system notices a Super User), then their own settings. 'urgent'
// reaches everyone, whatever is switched off.
function notify_should_push_for($row, $category)
{
    if ($category === 'urgent') {
        return true;
    }
    if (!notify_area_ok($row, $category)) {
        return false;
    }
    return notify_prefs_allow(notify_prefs_for($row), $category);
}
// May this person be told about this category at all? (Their areas, not their
// settings: the email fallback follows this.)
function notify_area_ok($row, $category)
{
    if ($category === 'urgent') {
        return true;
    }
    $cap = ['money' => 'mo.record', 'system' => 'owner'][$category] ?? 'all';
    return !isset($row['full_access']) || people_can($row, $cap);
}

// $opts: url (where a tap lands), category (money|enquiries|messages|system|urgent),
// tag (per-record, so distinct alerts STACK instead of replacing each other),
// reload, email (fall back to an email when no device is reachable).
function alert_owner($title, $body, $opts = [])
{
    $url = (string) ($opts['url'] ?? './');
    $category = (string) ($opts['category'] ?? 'system');
    // ONE TAG PER RECORD. Every owner alert used to be tagged 'chb-owner', so the
    // second notification REPLACED the first — two enquiries while you were out
    // showed as one, and a payment could erase a message. Distinct records now get
    // distinct tags (repeats of the SAME record still collapse, which is right).
    $tag = 'chb-owner-' . preg_replace('/[^a-z0-9_-]+/i', '-', (string) ($opts['tag'] ?? $category));
    $reload = !empty($opts['reload']);

    owner_ping_set($title, $body, $reload, $url, $tag);
    $payload = json_encode(
        ['title' => (string) $title, 'body' => (string) $body, 'url' => $url, 'tag' => $tag, 'reload' => $reload],
        JSON_UNESCAPED_UNICODE,
    );
    // EACH PERSON'S PHONES, BY THEIR OWN SETTINGS: muted categories and quiet hours
    // are per person, and nobody is buzzed about an area switched off for them.
    // 'only' narrows it to one person's devices (their own test alert).
    $only = (int) ($opts['only'] ?? 0);
    $reached = [];
    $sent = ping_admin_devices($payload, ['urgency' => 'high', 'ttl' => 86400], function ($row) use ($category, $only) {
        return ($only === 0 || (int) $row['id'] === $only) && notify_should_push_for($row, $category);
    }, $reached);
    // NOBODY IS LISTENING. alert_owner has always returned the device count and
    // only the test button ever read it — so with permission revoked, the last
    // subscription pruned, or a replaced phone, "Payment received" went nowhere
    // and nothing said so. Anything that asks for the email fallback now gets one —
    // PER PERSON: if it can't reach your phone, it comes to your email instead.
    // Muting or quiet hours stop the buzz, not this (nothing is lost by muting);
    // an area switched off for you takes its alerts, and this, with it.
    if (!empty($opts['email'])) {
        try {
            require_once __DIR__ . '/mailer.php';
            // The email lands where the notification would have: the push's own target.
            $open = preg_match('/[?&]open=([a-z0-9:-]+)/', (string) ($opts['url'] ?? ''), $om) ? $om[1] : '';
            $m = owner_note_push_fallback($title, $body, $open);
            $people = notify_people();
            if ($people === null) {
                if ($sent === 0) {
                    send_owner($m['subject'], $m['text']); // before people existed
                }
            } else {
                $to = [];
                foreach ($people as $id => $row) {
                    if (($reached[$id] ?? 0) === 0 && notify_area_ok($row, $category)) {
                        $to[] = ['to' => admin_contact_email($row), 'name' => people_display_name($row)];
                    }
                }
                // The extra addresses on Notifications, as before: when it reached no one at all.
                if ($sent === 0) {
                    foreach (people_mail_extras() as $e) {
                        $to[] = ['to' => $e, 'name' => 'Owner'];
                    }
                }
                $seen = [];
                $msgs = [];
                foreach ($to as $t) {
                    $k = strtolower(trim((string) $t['to']));
                    if ($k !== '' && !isset($seen[$k])) {
                        $seen[$k] = true;
                        $msgs[] = ['to' => $k, 'name' => $t['name'], 'subject' => $m['subject'], 'text' => $m['text'], 'html' => owner_alert_text_html($m['subject'], $m['text'])];
                    }
                }
                if ($msgs) {
                    smtp_send_batch($msgs);
                }
            }
        } catch (\Throwable $e) {
        }
    }
    return $sent;
}

// Wake every device belonging to one guest. Mirrors ping_admin_devices: dead
// subscriptions (404/410) are pruned. Returns the number woken. Best-effort.
function ping_guest_devices($guestId, $payload = null, $opts = [])
{
    if (!wp_vapid_configured()) {
        return 0;
    }
    try {
        $q = db()->prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE guest_id = ?');
        $q->execute([(int) $guestId]);
        $rows = $q->fetchAll();
    } catch (\Throwable $e) {
        return 0;
    }
    $sent = 0;
    foreach ($rows as $sub) {
        $r = send_webpush($sub['endpoint'], $payload, (string) ($sub['p256dh'] ?? ''), (string) ($sub['auth'] ?? ''), $opts);
        if (!empty($r['ok'])) {
            $sent++;
        } elseif (in_array($r['status'] ?? 0, [404, 410], true)) {
            try {
                db()
                    ->prepare('DELETE FROM push_subscriptions WHERE id = ?')
                    ->execute([(int) $sub['id']]);
            } catch (\Throwable $e) {
            }
        }
    }
    return $sent;
}
// Convenience: stash a guest's notification text (sw.js fetches it via
// push.php?action=sw_notify) AND wake their devices. Mirrors alert_owner.
function notify_guest($guestId, $title, $body, $url = './')
{
    // Same shape as alert_owner: payload first, stash as the fallback. A guest with
    // a phone AND a tablet hit the identical first-device-wins bug.
    guest_ping_set($guestId, $title, $body, $url);
    $payload = json_encode(
        ['title' => (string) $title, 'body' => (string) $body, 'url' => (string) $url, 'tag' => 'chb-guest'],
        JSON_UNESCAPED_UNICODE,
    );
    return ping_guest_devices($guestId, $payload, ['urgency' => 'high', 'ttl' => 86400]);
}

// Resolve a guest id from an email so booking/payment flows that only know the
// guest's email can target their devices. Returns 0 if no account. Best-effort.
function guest_id_for_email($email)
{
    if (!$email) {
        return 0;
    }
    // Only an account whose address is PROVEN: registering an email is not owning
    // it, and an unproven account's phones would otherwise get the real guest's
    // confirmation (cottage and dates) and payment alerts.
    try {
        $s = db()->prepare('SELECT id FROM guests WHERE email = ? AND email_verified_at IS NOT NULL LIMIT 1');
        $s->execute([(string) $email]);
        return (int) ($s->fetchColumn() ?: 0);
    } catch (\Throwable $e) {
        return 0;
    }
}
// Notify a guest by email — a no-op if that email has no account or no devices.
function notify_guest_email($email, $title, $body, $url = './')
{
    $gid = guest_id_for_email($email);
    return $gid ? notify_guest($gid, $title, $body, $url) : 0;
}
