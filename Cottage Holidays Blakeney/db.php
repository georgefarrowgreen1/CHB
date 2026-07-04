<?php
// ============================================================
//  db.php — shared bootstrap: DB connection, session, helpers.
//  Every API endpoint includes this first.
// ============================================================

// ---- Keep API responses clean JSON on shared hosting. ----
// Display errors would otherwise print HTML before our JSON and break the
// front end's JSON.parse(). We log them instead (visible in IONOS error logs).
@ini_set('display_errors', '0');
@ini_set('log_errors', '1');
error_reporting(E_ALL);

require_once __DIR__ . '/config.php';

// Pin all server date/time logic to UK time (the business operates in the UK),
// so PHP date() and MySQL NOW()/CURDATE() agree regardless of the server locale.
date_default_timezone_set('Europe/London');

// ---- Detect HTTPS robustly (IONOS terminates SSL at a proxy, so $_SERVER['HTTPS']
//      is often unset even on https://). Check forwarded headers too. ----
function request_is_https() {
    if (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off') return true;
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') return true;
    if (!empty($_SERVER['HTTP_X_FORWARDED_SSL']) && strtolower($_SERVER['HTTP_X_FORWARDED_SSL']) === 'on') return true;
    if (!empty($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443) return true;
    return false;
}

// ---- Session cookie. The Secure flag must match the real scheme, or the browser
//      silently drops the cookie and logins won't "stick". ----
if (session_status() === PHP_SESSION_NONE) {
    $secure = request_is_https();
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => $secure,   // matches actual scheme (proxy-aware)
        'httponly' => true,      // not readable by JavaScript
        'samesite' => 'Lax',
    ]);
    @session_start();
}
// Give a logged-in admin a CSRF token in a JS-readable cookie (the token also lives
// in the session). The admin UI echoes it back in an X-CSRF-Token header on writes;
// require_admin() checks they match — defence-in-depth on top of SameSite cookies.
csrf_issue_cookie();

// ---- CORS (only needed if API is on a different origin) ----
if (ALLOWED_ORIGIN !== '') {
    header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
}

header('Content-Type: application/json; charset=utf-8');

// ---- PDO connection ----
function db() {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
            // Align MySQL NOW()/CURDATE() with UK time (handles BST/GMT via the
            // current Europe/London offset). Ignored silently if not permitted.
            $tzOffset = (new DateTime('now', new DateTimeZone('Europe/London')))->format('P');
            if (!preg_match('/^[+-]\d{2}:\d{2}$/', $tzOffset)) $tzOffset = '+00:00';   // validate before use
            try { $pdo->exec("SET time_zone = '" . $tzOffset . "'"); } catch (\Throwable $e) {}
        } catch (PDOException $e) {
            json_out(['error' => 'Database connection failed'], 500);
        }
    }
    return $pdo;
}

// ---- Per-property write lock (race safety for bookings) ----
// Serialises booking creation/edit per property so two near-simultaneous
// confirmations can't both pass the clash check. The lock is connection-scoped,
// so it auto-frees if a request dies; no-ops gracefully without GET_LOCK.
function book_lock($propKey) {
    $name = 'chb_book_' . preg_replace('/[^a-z0-9_]/i', '', (string)$propKey);
    try { $s = db()->prepare('SELECT GET_LOCK(?, 10)'); $s->execute([$name]); return (int)$s->fetchColumn() === 1; }
    catch (\Throwable $e) { return false; }
}
function book_unlock($propKey) {
    $name = 'chb_book_' . preg_replace('/[^a-z0-9_]/i', '', (string)$propKey);
    try { db()->prepare('SELECT RELEASE_LOCK(?)')->execute([$name]); } catch (\Throwable $e) {}
}

// ---- JSON helpers ----
function json_out($data, $code = 200) {
    http_response_code($code);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        // Encoding failed (e.g. invalid UTF-8) — return a safe error instead of an empty body
        $json = json_encode(['error' => 'Response encoding error']);
    }
    echo $json;
    exit;
}
function body() {
    $raw = file_get_contents('php://input');
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

// ---- Auth helpers ----
// CSRF token for the current session (minted on demand, kept server-side).
function csrf_token() {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}
// Mirror the token into a JS-readable cookie so the admin UI can send it back as a
// header. Only for logged-in admins; no-op once the cookie already matches.
function csrf_issue_cookie() {
    if (empty($_SESSION['admin_id']) || headers_sent()) return;
    $t = csrf_token();
    if (($_COOKIE['csrf'] ?? '') !== $t) {
        setcookie('csrf', $t, ['expires' => 0, 'path' => '/', 'secure' => request_is_https(), 'httponly' => false, 'samesite' => 'Lax']);
        $_COOKIE['csrf'] = $t;
    }
}
function require_admin() {
    if (empty($_SESSION['admin_id'])) {
        json_out(['error' => 'Not authorised'], 401);
    }
    // On state-changing requests, require a matching CSRF token (header vs session).
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method !== 'GET' && $method !== 'HEAD' && $method !== 'OPTIONS') {
        $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (empty($_SESSION['csrf']) || !is_string($sent) || $sent === '' || !hash_equals($_SESSION['csrf'], $sent)) {
            json_out(['error' => 'Your session needs refreshing — please reload the page and try again.'], 403);
        }
    }
}
function current_guest_id() {
    return $_SESSION['guest_id'] ?? null;
}
function require_guest() {
    if (empty($_SESSION['guest_id'])) {
        json_out(['error' => 'Please log in'], 401);
    }
}

// ---- Generic per-IP rate limiter for public POSTs (anti-spam / anti-flood) ----
// Reuses the login_attempts ledger (ip, identifier, success, attempted_at). Records
// one row per call under $key; once $max rows exist for this IP+key within the
// window it replies 429 and exits. Resilient: if the table is missing (migration
// not run) it allows the request rather than ever hard-blocking a public action.
function rate_limit($key, $max = 8, $windowMin = 10) {
    try {
        $ip  = $_SERVER['REMOTE_ADDR'] ?? '';
        $win = (int)$windowMin;   // not user-controlled; safe to inline in INTERVAL
        $s = db()->prepare("SELECT COUNT(*) c FROM login_attempts
                            WHERE ip = ? AND identifier = ?
                              AND attempted_at > (NOW() - INTERVAL $win MINUTE)");
        $s->execute([$ip, $key]);
        if ((int)(($s->fetch() ?: ['c' => 0])['c']) >= $max) {
            json_out(['error' => 'Too many requests. Please wait a few minutes and try again.'], 429);
        }
        db()->prepare('INSERT INTO login_attempts (ip, identifier, success) VALUES (?,?,0)')->execute([$ip, $key]);
        if (random_int(1, 20) === 1) {
            db()->prepare('DELETE FROM login_attempts WHERE attempted_at < (NOW() - INTERVAL 1 DAY)')->execute();
        }
    } catch (\Throwable $e) { /* table missing — don't block public actions */ }
}

// ---- Simple input sanitising ----
function clean($v) { return is_string($v) ? trim($v) : $v; }

// ---- Shared business rules (single source of truth) ----
// Per-property occupancy caps. Used by the public enquiry validation (enquiries.php)
// AND served to the front end via rates.php, so the two can never disagree.
function occupancy_limits() {
    // The cottages themselves are the single source of truth, so this works for
    // however many the owner has added — not just the original three. Each live
    // property's caps come from its row (max_adults/max_children/max_total, added
    // by migration-accommodations.sql); a saved override in content('occupancy-<key>')
    // wins when present (back office → Preferences → cottage → House rules), so
    // existing owner edits are kept. Falls back to a fixed map for the original
    // three if the properties table / new columns aren't there yet.
    $limits = [];
    try {
        // Only live (non-archived) cottages constrain the public enquiry form.
        $rows = db()->query("SELECT prop_key, max_adults, max_children, max_total FROM properties WHERE archived_at IS NULL")->fetchAll();
        foreach ($rows as $row) {
            $limits[$row['prop_key']] = [
                'maxAdults'   => max(1, (int)($row['max_adults']   ?? 2)),
                'maxChildren' => max(0, (int)($row['max_children'] ?? 0)),
                'maxTotal'    => max(1, (int)($row['max_total']    ?? 2)),
            ];
        }
    } catch (\Throwable $e) { /* properties table / columns not migrated yet */ }
    if (!$limits) {
        // Pre-migration fallback so the original three keep working unchanged.
        $limits = [
            '21a'       => ['maxAdults' => 2, 'maxChildren' => 0, 'maxTotal' => 2],
            'jollyboat' => ['maxAdults' => 2, 'maxChildren' => 0, 'maxTotal' => 2],
            'pimpernel' => ['maxAdults' => 3, 'maxChildren' => 1, 'maxTotal' => 3],
        ];
    }
    try {
        $rows = db()->query("SELECT item_key, item_value FROM content WHERE item_key LIKE 'occupancy-%'")->fetchAll();
        foreach ($rows as $row) {
            $key = substr($row['item_key'], strlen('occupancy-'));
            if (!isset($limits[$key])) continue;   // ignore overrides for archived/unknown cottages
            $v = json_decode($row['item_value'], true);
            if (is_array($v) && isset($v['maxAdults'], $v['maxChildren'], $v['maxTotal'])) {
                $limits[$key] = [
                    'maxAdults'   => max(1, (int)$v['maxAdults']),
                    'maxChildren' => max(0, (int)$v['maxChildren']),
                    'maxTotal'    => max(1, (int)$v['maxTotal']),
                ];
            }
        }
    } catch (\Throwable $e) { /* content table unavailable — fall back to defaults */ }
    return $limits;
}

// Per-cottage display info (name, accent colour, URL slug) for emails/crons, so
// they label/colour/link correctly for ANY cottage the owner has added — not just
// the original three. Reads the property row; falls back to a fixed map (and finally
// to the key itself) so it never breaks pre-migration.
function prop_display($key) {
    static $cache = null;
    if ($cache === null) {
        $cache = [];
        try {
            foreach (db()->query("SELECT prop_key, name, accent, slug FROM properties")->fetchAll() as $r) {
                $cache[$r['prop_key']] = [
                    'name'   => $r['name'] ?: $r['prop_key'],
                    'accent' => $r['accent'] ?: '#8FB3C7',
                    'slug'   => $r['slug'] ?: $r['prop_key'],
                ];
            }
        } catch (\Throwable $e) { /* table/columns missing — use the fallback below */ }
    }
    if (isset($cache[$key])) return $cache[$key];
    $fallback = [
        '21a'       => ['name' => '21A Westgate', 'accent' => '#42A5F5', 'slug' => '21a-westgate'],
        'jollyboat' => ['name' => 'Jollyboat',    'accent' => '#43A047', 'slug' => 'jollyboat'],
        'pimpernel' => ['name' => 'Pimpernel',    'accent' => '#9C27B0', 'slug' => 'pimpernel'],
    ];
    return $fallback[$key] ?? ['name' => $key, 'accent' => '#8FB3C7', 'slug' => $key];
}

// True if the text contains a UK postcode (used where a postcode sits inside a
// free-text address).
function uk_postcode_present($s) {
    return (bool)preg_match('/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i', (string)$s);
}
// True if the whole value IS a UK postcode (used for the dedicated postcode field).
function uk_postcode_valid($s) {
    return (bool)preg_match('/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i', trim((string)$s));
}

// ---- At-rest encryption for secrets-like values (AES-256-GCM) ----
// Used for content values that contain secrets (arrival info with key-safe
// codes, private iCal feed URLs). Key is derived from APP_SECRET.
// Format: "enc1:" + base64( 12-byte IV | 16-byte auth tag | ciphertext ).
// decrypt_value() passes legacy plaintext through unchanged, so existing
// rows keep working and become encrypted the next time they are saved.
function enc_key() { return hash('sha256', APP_SECRET . '|at-rest-v1', true); }
function encrypt_value($plain) {
    if (!is_string($plain)) return $plain;
    try {
        $iv = random_bytes(12);
        $tag = '';
        $ct = openssl_encrypt($plain, 'aes-256-gcm', enc_key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($ct === false) return $plain;   // openssl unavailable — store as-is
        return 'enc1:' . base64_encode($iv . $tag . $ct);
    } catch (\Throwable $e) { return $plain; }
}
function decrypt_value($stored) {
    if (!is_string($stored) || strpos($stored, 'enc1:') !== 0) return $stored;  // legacy plaintext
    try {
        $raw = base64_decode(substr($stored, 5), true);
        if ($raw === false || strlen($raw) < 29) return '';
        $iv = substr($raw, 0, 12); $tag = substr($raw, 12, 16); $ct = substr($raw, 28);
        $pt = openssl_decrypt($ct, 'aes-256-gcm', enc_key(), OPENSSL_RAW_DATA, $iv, $tag);
        return $pt === false ? '' : $pt;
    } catch (\Throwable $e) { return ''; }
}
// Content keys whose values are encrypted at rest.
function is_private_content_key($key) {
    return strpos($key, 'ical-feeds-') === 0 || strpos($key, 'arrival-') === 0 || strpos($key, 'apikey-') === 0 || strpos($key, 'welcome-') === 0;
}

// Read a single content value as a plain string (decrypting private keys), '' if unset.
// Used server-side (e.g. tides.php reads the owner-pasted tide API key).
function content_value($key) {
    try {
        $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
        $s->execute([$key]);
        $v = $s->fetchColumn();
        if ($v === false) return '';
        if (is_private_content_key($key)) $v = decrypt_value($v);
        $d = json_decode($v, true);
        if (is_string($d)) return $d;
        return is_scalar($d) ? (string)$d : '';
    } catch (\Throwable $e) { return ''; }
}

// Token for a property's iCal export feed: unguessable, needs no login, derived
// one-way from APP_SECRET so nothing secret leaks. Shared by ical-export.php
// (validates it) and ical-import.php (builds the ready-made feed URL).
function ical_token($propKey) {
    return substr(hash_hmac('sha256', 'ical:' . $propKey, APP_SECRET), 0, 24);
}

// ---- Reply-by-email: signed thread tokens ----
// A guest-message notification email carries this token in its Reply-To
// plus-address + Message-ID, so a reply the owner sends can be matched back to
// the exact conversation (inbound-mail.php verifies it). One-way HMAC — a
// forged token can't select an arbitrary thread.
function msg_reply_token($threadId) {
    $tid = (int)$threadId;
    return $tid . 'x' . substr(hash_hmac('sha256', 'msg-reply|' . $tid, APP_SECRET), 0, 16);
}
function msg_reply_verify($token) {
    if (!preg_match('/(\d+)x([0-9a-f]{16})/', (string)$token, $m)) return 0;
    $tid = (int)$m[1];
    return hash_equals(msg_reply_token($tid), $m[1] . 'x' . $m[2]) ? $tid : 0;
}
// The plus-addressed inbound address for a thread, or '' if reply-by-email is
// not configured (REPLY_INBOX unset) — in which case notifications behave as
// before (Reply-To = the owner's own address).
function msg_reply_address($threadId) {
    if (!defined('REPLY_INBOX') || !REPLY_INBOX || strpos(REPLY_INBOX, '@') === false) return '';
    [$local, $domain] = explode('@', REPLY_INBOX, 2);
    return $local . '+' . msg_reply_token($threadId) . '@' . $domain;
}

// ---- Square online payments helpers ----
// True only when the owner has switched payments on AND filled in the keys.
function square_enabled() {
    return defined('SQUARE_PAYMENTS_ENABLED') && SQUARE_PAYMENTS_ENABLED
        && defined('SQUARE_ACCESS_TOKEN') && SQUARE_ACCESS_TOKEN !== ''
        && defined('SQUARE_LOCATION_ID') && SQUARE_LOCATION_ID !== '';
}
// Square REST host for the configured environment.
function square_api_base() {
    return (defined('SQUARE_ENVIRONMENT') && SQUARE_ENVIRONMENT === 'production')
        ? 'https://connect.squareup.com'
        : 'https://connect.squareupsandbox.com';
}
// Unguessable, login-free token that authorises PAYING a specific booking.
// One-way from APP_SECRET (same idea as ical_token) — leaks nothing if seen.
function pay_token($bookingId) {
    return substr(hash_hmac('sha256', 'pay:' . (int)$bookingId, APP_SECRET), 0, 32);
}
// Unguessable token for a passwordless email sign-in link. Binds a guest id to
// an issue-time so it expires (checked in auth.php), and leaks nothing if seen —
// same one-way HMAC idea as pay_token. The timestamp travels in the link too.
function login_token($guestId, $ts) {
    return substr(hash_hmac('sha256', 'login:' . (int)$guestId . ':' . (int)$ts, APP_SECRET), 0, 32);
}
// Public site root (scheme + host + the folder this script runs from), used to
// build guest links (e.g. the pay link). Proxy-aware HTTPS via request_is_https().
function site_base_url() {
    $scheme = request_is_https() ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return $scheme . '://' . $host . $dir . '/';
}
// Minimal Square REST call over cURL (no Composer/SDK needed on shared hosting,
// matching the raw SMTP/webpush approach). Returns ['status'=>int,'body'=>array].
// Never throws; a transport failure comes back as status 0 with an 'error' body.
function square_api($method, $path, $payload = null) {
    $url = square_api_base() . $path;
    $headers = [
        'Authorization: Bearer ' . SQUARE_ACCESS_TOKEN,
        'Square-Version: ' . (defined('SQUARE_API_VERSION') ? SQUARE_API_VERSION : '2024-01-18'),
        'Content-Type: application/json',
        'Accept: application/json',
    ];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    if ($payload !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
    $raw = curl_exec($ch);
    if ($raw === false) {
        $err = curl_error($ch); curl_close($ch);
        return ['status' => 0, 'body' => ['error' => 'Square unreachable: ' . $err]];
    }
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $body = json_decode($raw, true);
    return ['status' => $status, 'body' => is_array($body) ? $body : []];
}

// True if [checkIn, checkOut) overlaps a confirmed booking OR an imported
// platform (Airbnb/Vrbo) block for this property. Overlap test:
// existing.start < new.end AND existing.end > new.start. The ical_blocks table
// may not exist on older installs, so that check degrades gracefully.
function dates_clash($propKey, $checkIn, $checkOut, $ignoreId = null) {
    $sql = 'SELECT COUNT(*) c FROM bookings WHERE prop_key = ? AND check_in < ? AND check_out > ?';
    $args = [$propKey, $checkOut, $checkIn];
    if ($ignoreId) { $sql .= ' AND id <> ?'; $args[] = $ignoreId; }
    $s = db()->prepare($sql); $s->execute($args);
    if ((int)$s->fetch()['c'] > 0) return true;
    try {
        $s2 = db()->prepare('SELECT COUNT(*) c FROM ical_blocks WHERE prop_key = ? AND check_in < ? AND check_out > ?');
        $s2->execute([$propKey, $checkOut, $checkIn]);
        return (int)$s2->fetch()['c'] > 0;
    } catch (\Throwable $e) { return false; }
}
