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

// ---- CORS (only needed if API is on a different origin) ----
if (ALLOWED_ORIGIN !== '') {
    header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type');
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
            try { $pdo->exec("SET time_zone = '" . (new DateTime('now', new DateTimeZone('Europe/London')))->format('P') . "'"); } catch (\Throwable $e) {}
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
function require_admin() {
    if (empty($_SESSION['admin_id'])) {
        json_out(['error' => 'Not authorised'], 401);
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

// ---- Simple input sanitising ----
function clean($v) { return is_string($v) ? trim($v) : $v; }

// ---- Shared business rules (single source of truth) ----
// Per-property occupancy caps. Used by the public enquiry validation (enquiries.php)
// AND served to the front end via rates.php, so the two can never disagree.
function occupancy_limits() {
    return [
        '21a'       => ['maxAdults' => 2, 'maxChildren' => 0, 'maxTotal' => 2],
        'jollyboat' => ['maxAdults' => 2, 'maxChildren' => 0, 'maxTotal' => 2],
        'pimpernel' => ['maxAdults' => 3, 'maxChildren' => 1, 'maxTotal' => 3],
    ];
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
    return strpos($key, 'ical-feeds-') === 0 || strpos($key, 'arrival-') === 0;
}

// Token for a property's iCal export feed: unguessable, needs no login, derived
// one-way from APP_SECRET so nothing secret leaks. Shared by ical-export.php
// (validates it) and ical-import.php (builds the ready-made feed URL).
function ical_token($propKey) {
    return substr(hash_hmac('sha256', 'ical:' . $propKey, APP_SECRET), 0, 24);
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
