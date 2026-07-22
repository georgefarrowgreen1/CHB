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
function request_is_https()
{
    if (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') {
        return true;
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_SSL']) && strtolower($_SERVER['HTTP_X_FORWARDED_SSL']) === 'on') {
        return true;
    }
    if (!empty($_SERVER['SERVER_PORT']) && (int) $_SERVER['SERVER_PORT'] === 443) {
        return true;
    }
    return false;
}

// ---- Session cookie. The Secure flag must match the real scheme, or the browser
//      silently drops the cookie and logins won't "stick". ----
if (session_status() === PHP_SESSION_NONE) {
    $secure = request_is_https();
    // "Stay logged in" — keep the owner AND guests signed in across app/browser
    // closes, spells of inactivity, and site updates. Without this the cookie was a
    // browser-session cookie (gone on close) and PHP's default ~24-min idle GC could
    // expire the session server-side, so a post-deploy reload looked like a logout.
    // (Logging out still clears the session; login still regenerates the id.)
    $sess_ttl = 60 * 60 * 24 * 60; // 60 days

    // Store our session files in an app-local, web-denied folder (see sessions/
    // .htaccess) so the shared host's own GC of the server-default path can't quietly
    // sign people out. Only switch to it if it's genuinely writable — otherwise stay
    // on the default path rather than risk breaking login.
    $sess_dir = __DIR__ . '/sessions';
    if (!is_dir($sess_dir)) {
        @mkdir($sess_dir, 0700, true);
    }
    // Belt-and-braces: if the folder was created fresh (shipped .htaccess missing),
    // drop a deny-all .htaccess so session files can never be served over the web.
    if (is_dir($sess_dir) && !is_file($sess_dir . '/.htaccess')) {
        @file_put_contents(
            $sess_dir . '/.htaccess',
            "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n",
        );
    }
    if (is_dir($sess_dir) && is_writable($sess_dir)) {
        @ini_set('session.save_path', $sess_dir);
    }
    @ini_set('session.gc_maxlifetime', (string) $sess_ttl);

    session_set_cookie_params([
        'lifetime' => $sess_ttl,
        'path' => '/',
        'secure' => $secure, // matches actual scheme (proxy-aware)
        'httponly' => true, // not readable by JavaScript
        'samesite' => 'Lax',
    ]);
    @session_start();

    // Sliding expiry: push the cookie's clock forward on every visit so an active
    // user never lapses (session_start likewise refreshes the file's mtime, keeping
    // it clear of GC).
    if (session_id() !== '' && isset($_COOKIE[session_name()])) {
        @setcookie(session_name(), session_id(), [
            'expires' => time() + $sess_ttl,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
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
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit();
    }
}

header('Content-Type: application/json; charset=utf-8');

// ---- PDO connection ----
function db()
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            // Align MySQL NOW()/CURDATE() with UK time (handles BST/GMT via the
            // current Europe/London offset). Ignored silently if not permitted.
            $tzOffset = (new DateTime('now', new DateTimeZone('Europe/London')))->format('P');
            if (!preg_match('/^[+-]\d{2}:\d{2}$/', $tzOffset)) {
                $tzOffset = '+00:00';
            } // validate before use
            try {
                $pdo->exec("SET time_zone = '" . $tzOffset . "'");
            } catch (\Throwable $e) {
            }
        } catch (PDOException $e) {
            json_out(['error' => 'Database connection failed'], 500);
        }
        // Lets the error-capture handlers (end of this file) know a connection
        // EXISTS — they must never be the first db() caller, because a failed
        // connect json_out+exits, which inside a shutdown handler would corrupt
        // whatever response is already on the wire.
        $GLOBALS['__chb_db_up'] = true;
    }
    return $pdo;
}

// ---- Per-property write lock (race safety for bookings) ----
// Serialises booking creation/edit per property so two near-simultaneous
// confirmations can't both pass the clash check. The lock is connection-scoped,
// so it auto-frees if a request dies; no-ops gracefully without GET_LOCK.
function book_lock($propKey)
{
    $name = 'chb_book_' . preg_replace('/[^a-z0-9_]/i', '', (string) $propKey);
    try {
        // Wait longer than the Square API timeout (20s) so the lock can't lapse while
        // the holder is mid-charge — otherwise a second request could slip past it.
        $s = db()->prepare('SELECT GET_LOCK(?, 30)');
        $s->execute([$name]);
        $r = $s->fetchColumn();
        // 1 = acquired; 0 = genuine timeout (contention) → false; NULL = GET_LOCK not
        // available on this host → treat as acquired so the flow still proceeds
        // (best-effort, as before). Callers that care reject only on a real timeout.
        return $r === null ? true : (int) $r === 1;
    } catch (\Throwable $e) {
        return true; // GET_LOCK unsupported/unavailable — proceed unprotected (best-effort)
    }
}
function book_unlock($propKey)
{
    $name = 'chb_book_' . preg_replace('/[^a-z0-9_]/i', '', (string) $propKey);
    try {
        db()
            ->prepare('SELECT RELEASE_LOCK(?)')
            ->execute([$name]);
    } catch (\Throwable $e) {
    }
}

// ---- JSON helpers ----
function json_out($data, $code = 200)
{
    http_response_code($code);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        // Encoding failed (e.g. invalid UTF-8) — return a safe error instead of an empty body
        $json = json_encode(['error' => 'Response encoding error']);
    }
    echo $json;
    exit();
}
function body()
{
    $raw = file_get_contents('php://input');
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

// ---- Auth helpers ----
// CSRF token for the current session (minted on demand, kept server-side).
function csrf_token()
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}
// Mirror the token into a JS-readable cookie so the admin UI can send it back as a
// header. Only for logged-in admins; no-op once the cookie already matches.
function csrf_issue_cookie()
{
    if (empty($_SESSION['admin_id']) || headers_sent()) {
        return;
    }
    $t = csrf_token();
    if (($_COOKIE['csrf'] ?? '') !== $t) {
        setcookie('csrf', $t, [
            'expires' => 0,
            'path' => '/',
            'secure' => request_is_https(),
            'httponly' => false,
            'samesite' => 'Lax',
        ]);
        $_COOKIE['csrf'] = $t;
    }
}
function require_admin()
{
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
function current_guest_id()
{
    return $_SESSION['guest_id'] ?? null;
}
function require_guest()
{
    if (empty($_SESSION['guest_id'])) {
        json_out(['error' => 'Please log in'], 401);
    }
}

// Declarative action router for the JSON endpoints — the PATTERN for new ones
// (customers.php is the exemplar; the legacy if-chains migrate opportunistically
// when touched). Each handler receives the decoded body and must json_out() its
// reply; an unknown/missing action is always a 400, so a typo'd client action
// can never fall through into later code.
//      route_actions(['directory' => fn($in) => ..., 'audit' => fn($in) => ...]);
function route_actions(array $map, $in = null)
{
    $in = $in ?? body();
    $action = (string) ($in['action'] ?? '');
    if (!isset($map[$action])) {
        json_out(['error' => 'Unknown action'], 400);
    }
    $map[$action]($in);
    json_out(['error' => 'Handler for "' . $action . '" returned without replying'], 500);
}

// ---- Generic per-IP rate limiter for public POSTs (anti-spam / anti-flood) ----
// Reuses the login_attempts ledger (ip, identifier, success, attempted_at). Records
// one row per call under $key; once $max rows exist for this IP+key within the
// window it replies 429 and exits. Resilient: if the table is missing (migration
// not run) it allows the request rather than ever hard-blocking a public action.
function rate_limit($key, $max = 8, $windowMin = 10)
{
    try {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        $win = (int) $windowMin; // not user-controlled; safe to inline in INTERVAL
        $s = db()->prepare("SELECT COUNT(*) c FROM login_attempts
                            WHERE ip = ? AND identifier = ?
                              AND attempted_at > (NOW() - INTERVAL $win MINUTE)");
        $s->execute([$ip, $key]);
        if ((int) ($s->fetch() ?: ['c' => 0])['c'] >= $max) {
            json_out(['error' => 'Too many requests. Please wait a few minutes and try again.'], 429);
        }
        db()
            ->prepare('INSERT INTO login_attempts (ip, identifier, success) VALUES (?,?,0)')
            ->execute([$ip, $key]);
        if (random_int(1, 20) === 1) {
            db()->prepare('DELETE FROM login_attempts WHERE attempted_at < (NOW() - INTERVAL 1 DAY)')->execute();
        }
    } catch (\Throwable $e) {
        /* table missing — don't block public actions */
    }
}

// ---- Simple input sanitising ----
function clean($v)
{
    return is_string($v) ? trim($v) : $v;
}

// ---- Shared business rules (single source of truth) ----
// Per-property occupancy caps. Used by the public enquiry validation (enquiries.php)
// AND served to the front end via rates.php, so the two can never disagree.
function occupancy_limits()
{
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
        $rows = db()
            ->query('SELECT prop_key, max_adults, max_children, max_total FROM properties WHERE archived_at IS NULL AND unlisted = 0')
            ->fetchAll();
        foreach ($rows as $row) {
            $limits[$row['prop_key']] = [
                'maxAdults' => max(1, (int) ($row['max_adults'] ?? 2)),
                'maxChildren' => max(0, (int) ($row['max_children'] ?? 0)),
                'maxTotal' => max(1, (int) ($row['max_total'] ?? 2)),
            ];
        }
    } catch (\Throwable $e) {
        /* properties table / columns not migrated yet */
    }
    if (!$limits) {
        // Pre-migration fallback so the original three keep working unchanged.
        $limits = [
            '21a' => ['maxAdults' => 2, 'maxChildren' => 0, 'maxTotal' => 2],
            'jollyboat' => ['maxAdults' => 2, 'maxChildren' => 0, 'maxTotal' => 2],
            'pimpernel' => ['maxAdults' => 3, 'maxChildren' => 1, 'maxTotal' => 3],
        ];
    }
    try {
        $rows = db()->query("SELECT item_key, item_value FROM content WHERE item_key LIKE 'occupancy-%'")->fetchAll();
        foreach ($rows as $row) {
            $key = substr($row['item_key'], strlen('occupancy-'));
            if (!isset($limits[$key])) {
                continue;
            } // ignore overrides for archived/unknown cottages
            $v = json_decode($row['item_value'], true);
            if (is_array($v) && isset($v['maxAdults'], $v['maxChildren'], $v['maxTotal'])) {
                $limits[$key] = [
                    'maxAdults' => max(1, (int) $v['maxAdults']),
                    'maxChildren' => max(0, (int) $v['maxChildren']),
                    'maxTotal' => max(1, (int) $v['maxTotal']),
                ];
            }
        }
    } catch (\Throwable $e) {
        /* content table unavailable — fall back to defaults */
    }
    return $limits;
}

// Per-cottage display info (name, accent colour, URL slug) for emails/crons, so
// they label/colour/link correctly for ANY cottage the owner has added — not just
// the original three. Reads the property row; falls back to a fixed map (and finally
// to the key itself) so it never breaks pre-migration.
function prop_display($key)
{
    static $cache = null;
    if ($cache === null) {
        $cache = [];
        try {
            foreach (db()->query('SELECT prop_key, name, accent, slug FROM properties')->fetchAll() as $r) {
                $cache[$r['prop_key']] = [
                    'name' => $r['name'] ?: $r['prop_key'],
                    'accent' => $r['accent'] ?: '#8FB3C7',
                    'slug' => $r['slug'] ?: $r['prop_key'],
                ];
            }
        } catch (\Throwable $e) {
            /* table/columns missing — use the fallback below */
        }
    }
    if (isset($cache[$key])) {
        return $cache[$key];
    }
    $fallback = [
        '21a' => ['name' => '21A Westgate', 'accent' => '#42A5F5', 'slug' => '21a-westgate'],
        'jollyboat' => ['name' => 'Jollyboat', 'accent' => '#43A047', 'slug' => 'jollyboat'],
        'pimpernel' => ['name' => 'Pimpernel', 'accent' => '#9C27B0', 'slug' => 'pimpernel'],
    ];
    return $fallback[$key] ?? ['name' => $key, 'accent' => '#8FB3C7', 'slug' => $key];
}

// Is this cottage archived (removed from the site)? The public enquiry form
// already rejects archived cottages; the booking-creation paths (manual add,
// enquiry approval) must too — get_rate() alone happily returns a rate for one.
// Tolerates the pre-migration schema (no column → not archived).
function prop_is_archived($propKey)
{
    try {
        $s = db()->prepare('SELECT archived_at FROM properties WHERE prop_key = ?');
        $s->execute([$propKey]);
        $row = $s->fetch();
        return $row && !empty($row['archived_at']);
    } catch (\Throwable $e) {
        return false;
    }
}

// True if the whole value IS a UK postcode (used for the dedicated postcode field).
// 'YYYY-MM-DD' → 'DD/MM/YYYY' — the UK display format used wherever a date
// reaches a guest or the owner (screens, emails, invoices). Storage stays ISO.
function uk_date($iso)
{
    return preg_match('/^(\d{4})-(\d{2})-(\d{2})/', (string) $iso, $m) ? "{$m[3]}/{$m[2]}/{$m[1]}" : (string) $iso;
}
// First name only, for email SALUTATIONS ("Hi John," not "Hi John Smith,").
// Falls back to $fallback when there's no name to greet.
function first_name($full, $fallback = '')
{
    $full = trim((string) $full);
    if ($full === '') {
        return $fallback;
    }
    $parts = preg_split('/\s+/', $full);
    return isset($parts[0]) && $parts[0] !== '' ? $parts[0] : $fallback;
}
function uk_postcode_valid($s)
{
    return (bool) preg_match('/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i', trim((string) $s));
}

// Does a domain have somewhere to deliver mail? True if it has an MX record
// (or, as a fallback, an A/AAAA record — RFC 5321 implicit MX). Cached per
// request. A "@ntl-world.com"-style dead domain returns false here.
function domain_accepts_mail($domain)
{
    static $cache = [];
    $domain = strtolower(trim((string) $domain));
    if ($domain === '') {
        return false;
    }
    if (array_key_exists($domain, $cache)) {
        return $cache[$domain];
    }
    $ok = false;
    if (function_exists('checkdnsrr')) {
        $ok = @checkdnsrr($domain, 'MX') || @checkdnsrr($domain, 'A') || @checkdnsrr($domain, 'AAAA');
    }
    return $cache[$domain] = $ok;
}

// Is the resolver even reachable? If a lookup for a domain we KNOW is live
// fails, DNS is broken/unavailable here — so deliverability checks must
// fail-open rather than cry wolf on every address. Cached per request.
function dns_resolver_working()
{
    static $w = null;
    if ($w === null) {
        $w = function_exists('checkdnsrr') ? (@checkdnsrr('gmail.com', 'MX') ?: false) : false;
    }
    return $w;
}

// "Smart" email check used before saving/sending to a recipient. Returns:
//   ['ok' => true]                                       deliverable (or DNS unavailable → fail-open)
//   ['ok' => false, 'reason' => 'format']                not a valid address shape
//   ['ok' => false, 'reason' => 'no_mail',
//    'suggest' => 'jo@ntlworld.com'|null]                domain has no mail server; suggest is a
//                                                         near-miss domain that DOES, if one is found
// Fails OPEN when the resolver is down so a flaky host never blocks real sends.
function email_deliverability($email)
{
    $email = trim((string) $email);
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'reason' => 'format'];
    }
    $at = strrpos($email, '@');
    $local = substr($email, 0, $at);
    $domain = strtolower(substr($email, $at + 1));

    // Disposable / throwaway addresses are technically deliverable but useless
    // for a booking (the guest can't be reached later). Flag them regardless of
    // MX. Checked BEFORE the MX short-circuit because these domains DO accept mail.
    if (is_disposable_email_domain($domain)) {
        return ['ok' => false, 'reason' => 'disposable', 'suggest' => null];
    }

    // Known misspellings of the big providers. These fire EVEN when the typo
    // domain resolves — many (gmial.com, hotmial.co.uk, yahooo.com, iclould.com)
    // are registered typosquatters WITH mail servers, so a guest's mail silently
    // lands there instead of their real inbox. A pure MX check can't catch that;
    // this curated map can. Only unambiguous misspellings of major providers.
    $known = [
        'gmial.com' => 'gmail.com', 'gmai.com' => 'gmail.com', 'gmal.com' => 'gmail.com',
        'gnail.com' => 'gmail.com', 'gmail.co' => 'gmail.com', 'gmail.con' => 'gmail.com',
        'gmail.cm' => 'gmail.com', 'googlemail.co' => 'googlemail.com',
        'hotmial.com' => 'hotmail.com', 'hotmal.com' => 'hotmail.com', 'hotmai.com' => 'hotmail.com',
        'hotmail.con' => 'hotmail.com', 'hotmial.co.uk' => 'hotmail.co.uk', 'hotmai.co.uk' => 'hotmail.co.uk',
        'yahooo.com' => 'yahoo.com', 'yaho.com' => 'yahoo.com', 'yahoo.con' => 'yahoo.com',
        'yahooo.co.uk' => 'yahoo.co.uk', 'yaho.co.uk' => 'yahoo.co.uk',
        'iclould.com' => 'icloud.com', 'iclod.com' => 'icloud.com', 'icloud.con' => 'icloud.com',
        'icloud.co' => 'icloud.com', 'outlok.com' => 'outlook.com', 'outllok.com' => 'outlook.com',
        'outlook.con' => 'outlook.com', 'ntl-world.com' => 'ntlworld.com', 'ntlwrld.com' => 'ntlworld.com',
        'ntlworld.co' => 'ntlworld.com', 'btinternet.co' => 'btinternet.com', 'btintenet.com' => 'btinternet.com',
        'sky.co' => 'sky.com', 'live.co' => 'live.com',
    ];
    if (isset($known[$domain])) {
        $corr = $known[$domain];
        // Offer it if we can't check DNS (high-confidence map) or the correction resolves.
        if (!dns_resolver_working() || domain_accepts_mail($corr)) {
            return ['ok' => false, 'reason' => 'typo', 'suggest' => $local . '@' . $corr];
        }
    }

    if (!dns_resolver_working()) {
        return ['ok' => true]; // can't check reliably — don't false-alarm
    }
    if (domain_accepts_mail($domain)) {
        return ['ok' => true];
    }

    // No mail server for this domain — almost always a typo. Build correction
    // candidates and suggest the first that CAN actually receive mail (only a
    // resolving candidate is ever offered, so a real address is never nagged).
    $candidates = [];
    if (strpos($domain, '-') !== false) {
        $candidates[] = str_replace('-', '', $domain); // ntl-world.com → ntlworld.com
    }
    // Bare TLD typos (.con/.cmo/.co → .com; .cok → .co.uk handled via fuzzy list).
    $candidates[] = preg_replace('/\.(con|cmo|comm|cim|vom|som)$/', '.com', $domain);
    $candidates[] = preg_replace('/\.co$/', '.com', $domain);

    // Fuzzy match against the domains guests actually use: if the typo is within
    // a small edit distance of a known provider, offer that provider. This
    // generalises far beyond a fixed typo table (gmial/gmai/gmal/gnail/gmail.con
    // … all collapse to gmail.com; iclould→icloud, ntlwrld→ntlworld, etc.).
    $common = [
        'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.co.uk', 'hotmail.com',
        'hotmail.co.uk', 'live.com', 'live.co.uk', 'msn.com', 'yahoo.com', 'yahoo.co.uk',
        'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'btinternet.com',
        'ntlworld.com', 'virginmedia.com', 'sky.com', 'talktalk.net', 'protonmail.com',
        'proton.me', 'gmx.com', 'gmx.co.uk',
    ];
    foreach ($common as $c) {
        if ($c === $domain) {
            continue;
        }
        // Distance scaled to length: allow 1 edit for short domains, 2 for longer.
        $max = strlen($c) >= 10 ? 2 : 1;
        if (levenshtein($domain, $c) <= $max) {
            $candidates[] = $c;
        }
    }

    $suggest = null;
    foreach (array_values(array_unique($candidates)) as $cand) {
        if ($cand !== '' && $cand !== $domain && domain_accepts_mail($cand)) {
            $suggest = $local . '@' . $cand;
            break;
        }
    }
    return ['ok' => false, 'reason' => 'no_mail', 'suggest' => $suggest];
}

// Known disposable / temporary-inbox providers. Not exhaustive (it can't be),
// but it catches the ones people actually reach for. Match the exact domain or
// any subdomain of it.
function is_disposable_email_domain($domain)
{
    static $set = null;
    if ($set === null) {
        $set = array_flip([
            'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com',
            '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org',
            'tempmailo.com', 'throwawaymail.com', 'yopmail.com', 'getnada.com', 'nada.email',
            'dispostable.com', 'trashmail.com', 'maildrop.cc', 'mailnesia.com', 'fakeinbox.com',
            'mintemail.com', 'mohmal.com', 'emailondeck.com', 'spamgourmet.com', 'mailcatch.com',
            'moakt.com', 'tempinbox.com', 'burnermail.io', 'inboxbear.com', 'harakirimail.com',
        ]);
    }
    $domain = strtolower(trim((string) $domain));
    if (isset($set[$domain])) {
        return true;
    }
    // A subdomain of a listed provider (e.g. foo.guerrillamail.com) also counts.
    foreach (array_keys($set) as $d) {
        if (substr($domain, -(strlen($d) + 1)) === '.' . $d) {
            return true;
        }
    }
    return false;
}

// ---- At-rest encryption for secrets-like values (AES-256-GCM) ----
// Used for content values that contain secrets (arrival info with key-safe
// codes, private iCal feed URLs). Key is derived from APP_SECRET.
// Format: "enc1:" + base64( 12-byte IV | 16-byte auth tag | ciphertext ).
// decrypt_value() passes legacy plaintext through unchanged, so existing
// rows keep working and become encrypted the next time they are saved.
function enc_key()
{
    return hash('sha256', APP_SECRET . '|at-rest-v1', true);
}
function encrypt_value($plain)
{
    if (!is_string($plain)) {
        return $plain;
    }
    try {
        $iv = random_bytes(12);
        $tag = '';
        $ct = openssl_encrypt($plain, 'aes-256-gcm', enc_key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($ct === false) {
            return $plain;
        } // openssl unavailable — store as-is
        return 'enc1:' . base64_encode($iv . $tag . $ct);
    } catch (\Throwable $e) {
        return $plain;
    }
}
function decrypt_value($stored)
{
    if (!is_string($stored) || strpos($stored, 'enc1:') !== 0) {
        return $stored;
    } // legacy plaintext
    try {
        $raw = base64_decode(substr($stored, 5), true);
        if ($raw === false || strlen($raw) < 29) {
            return '';
        }
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $ct = substr($raw, 28);
        $pt = openssl_decrypt($ct, 'aes-256-gcm', enc_key(), OPENSSL_RAW_DATA, $iv, $tag);
        return $pt === false ? '' : $pt;
    } catch (\Throwable $e) {
        return '';
    }
}
// Content keys whose values are encrypted at rest.
function is_private_content_key($key)
{
    return strpos($key, 'ical-feeds-') === 0 ||
        strpos($key, 'arrival-') === 0 ||
        strpos($key, 'apikey-') === 0 ||
        strpos($key, 'welcome-') === 0;
}

// Operational/internal content keys: written by server code (never the content
// editor), and several carry owner-only data — owner IP + browser
// (admin-last-login-fp), the last email correspondent (mailbox-poll), the
// deployment fingerprint (config-fingerprint), alert recipients (notify-emails),
// cron/digest watermarks, and the owner-only away-reply + 2FA toggles. The public
// GET in content.php must never return these; admin sessions still get them (the
// Settings UI reads chat-away-*/admin-2fa-enabled from siteContent).
function is_internal_content_key($key)
{
    if (strpos($key, 'chat-away-') === 0) {
        return true;
    }
    if (strpos($key, 'ical-status-') === 0) {
        return true; // per-cottage feed sync health (ical-import.php) — owner-only
    }
    return in_array($key, [
        'notify-emails',
        'admin-2fa-enabled',
        'admin-last-login-fp',
        'mailbox-poll',
        'config-fingerprint',
        'anniv-sent',
        'cron-last-run',
        'cron-watchdog-seen',
        'cron-alert-sent',
        'email-optout',
        'owner-digest-last',
        'analytics-digest-last',
        'backup-last-week',
        'conflict-audit-state',
        'uptime-history',
        'error-alert-last',
        'self-repair-state',
        // The search assistant's cross-device learning (admin.js chbAssistSync*):
        // owner-taught phrasings, suppressed phrasings and the dead-end query
        // list. Owner-behaviour data — never exposed to public visitors.
        'nlu-learned',
        'nlu-suppressed',
        'search-misses',
        // Guest questions the on-device FAQ assistant couldn't answer
        // (guest-faq.php) — owner-only, surfaced on the Search learning page so
        // the recurring ones can become instant answers.
        'guest-faq-misses',
        // The Square webhook subscription id the app self-provisioned (square-
        // setup.php) — operational, not secret, but owner-only (the signing key
        // itself is the encrypted 'apikey-square-webhook', never exposed).
        'square-webhook-sub-id',
        // Found by test-content-keys.php's classification gate — all three were
        // written by server code but missing here, so the public content GET
        // served them to any visitor. owner-ping is the worst: it holds the
        // owner's LATEST push notification (title/body can carry guest names
        // and amounts) between webpush.php's set and the service worker's take.
        'owner-ping',
        'mailbox-seen', // IMAP UID watermark (mailbox.php)
        'testcentre-seeded', // demo-data manifest (testcentre.php)
    ], true);
}

// Read a single content value as a plain string (decrypting private keys), '' if unset.
// Used server-side (e.g. tides.php reads the owner-pasted tide API key).
function content_value($key)
{
    try {
        $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
        $s->execute([$key]);
        $v = $s->fetchColumn();
        if ($v === false) {
            return '';
        }
        if (is_private_content_key($key)) {
            $v = decrypt_value($v);
        }
        $d = json_decode($v, true);
        if (is_string($d)) {
            return $d;
        }
        return is_scalar($d) ? (string) $d : '';
    } catch (\Throwable $e) {
        return '';
    }
}

// Read a content value that stores an ARRAY/object (watermarks, sent-maps).
// content_value() only ever returns strings/scalars — decoding an array-valued
// key there yields '' — so those keys MUST be read with this instead. Tolerates
// a legacy double-encoded value (a JSON string of JSON) by decoding twice.
function content_json($key, $default = [])
{
    try {
        $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
        $s->execute([$key]);
        $v = $s->fetchColumn();
        if ($v === false || $v === null || $v === '') {
            return $default;
        }
        $d = json_decode($v, true);
        if (is_string($d)) {
            $d = json_decode($d, true);
        } // unwrap legacy double-encoding
        return is_array($d) ? $d : $default;
    } catch (\Throwable $e) {
        return $default;
    }
}

// Store a scalar content value (json-encoded, matching content_value()'s read).
function content_set_scalar($key, $val)
{
    db()
        ->prepare(
            'INSERT INTO content (item_key, item_value) VALUES (?, ?)
                   ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP',
        )
        ->execute([$key, json_encode($val)]);
}
// Store a SECRET content value ENCRYPTED at rest (for a private 'apikey-'/'arrival-'
// key), matching content_value()'s decrypt-then-decode read. Mirrors content.php's
// 'set' path so a self-captured key (e.g. the Square webhook signing key) round-trips.
function content_set_secret($key, $val)
{
    $enc = encrypt_value(json_encode($val, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    db()
        ->prepare(
            'INSERT INTO content (item_key, item_value) VALUES (?, ?)
                   ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP',
        )
        ->execute([$key, $enc]);
}

// Dead-man's-switch for the daily cron. The dashboard banner only shows when the
// owner opens the back office; this pushes them an alert even while they're away.
// It can't run from cron (cron being dead is the thing we're detecting), so it
// piggybacks on ordinary PUBLIC traffic — throttled to one real check per 6h, so
// it costs a single content read on almost every call. Fires at most once/24h.
function cron_watchdog_maybe_alert()
{
    try {
        $seen = content_value('cron-watchdog-seen');
        if ($seen !== '' && strtotime($seen) !== false && time() - strtotime($seen) < 6 * 3600) {
            return; // checked recently — stay cheap
        }
        content_set_scalar('cron-watchdog-seen', gmdate('c'));

        $last = content_value('cron-last-run');
        if ($last === '' || strtotime($last) === false) {
            return; // never run yet (fresh install / pre-heartbeat) — don't cry wolf
        }
        $ageHours = (time() - strtotime($last)) / 3600;
        if ($ageHours <= 36) {
            return; // healthy (a daily job should reappear within ~26h)
        }
        $alerted = content_value('cron-alert-sent');
        if ($alerted !== '' && strtotime($alerted) !== false && time() - strtotime($alerted) < 24 * 3600) {
            return; // already nudged in the last day
        }
        require_once __DIR__ . '/webpush.php';
        alert_owner(
            'Automation stopped',
            'Your daily automation hasn’t run in ' . round($ageHours) . 'h — pre-arrival emails, balance chasers, calendar sync and backups are paused. Check the scheduled task at your host points at cron.php.',
        );
        content_set_scalar('cron-alert-sent', gmdate('c'));
        log_activity('system', 'cron.watchdog', 'Daily automation has not run in ' . round($ageHours) . 'h — owner alerted', [
            'severity' => 'warn',
            'entity' => 'cron',
            'actor' => 'system',
        ]);
    } catch (\Throwable $e) {
        // Watchdog is best-effort — never let it disturb the page that triggered it.
    }
}

// Record one line in the back-office activity log (audit trail of owner/admin
// actions + site changes). Best-effort and fully guarded: the log is a
// convenience, so a missing table or a write error must NEVER break the action
// being logged. $opts may carry actor / prop_key / entity / entity_id / meta
// (array) / severity ('info' | 'warn' | 'action'). Read by activity-log.php.
function log_activity($category, $action, $summary, $opts = [])
{
    try {
        $actor = isset($opts['actor']) && $opts['actor'] !== ''
            ? (string) $opts['actor']
            : (!empty($_SESSION['admin_id'])
                ? 'owner'
                : (!empty($_SESSION['guest_id'])
                    ? 'guest:' . (int) $_SESSION['guest_id']
                    : (defined('CHB_CRON') && CHB_CRON
                        ? 'cron'
                        : 'system')));
        $sev = in_array($opts['severity'] ?? 'info', ['info', 'warn', 'action'], true) ? $opts['severity'] : 'info';
        $vals = [
            mb_substr((string) $actor, 0, 120),
            mb_substr((string) $category, 0, 32),
            mb_substr((string) $action, 0, 64),
            mb_substr((string) $summary, 0, 255),
            isset($opts['prop_key']) && $opts['prop_key'] !== '' ? mb_substr((string) $opts['prop_key'], 0, 40) : null,
            isset($opts['entity']) && $opts['entity'] !== '' ? mb_substr((string) $opts['entity'], 0, 40) : null,
            isset($opts['entity_id']) && $opts['entity_id'] !== '' ? mb_substr((string) $opts['entity_id'], 0, 64) : null,
            isset($opts['meta']) ? mb_substr((string) json_encode($opts['meta']), 0, 4000) : null,
            $_SERVER['REMOTE_ADDR'] ?? null,
        ];
        try {
            db()
                ->prepare(
                    'INSERT INTO activity_log (actor, category, action, summary, prop_key, entity, entity_id, meta, ip, severity)
                     VALUES (?,?,?,?,?,?,?,?,?,?)',
                )
                ->execute([...$vals, $sev]);
        } catch (\Throwable $eSev) {
            // severity column not migrated yet — record without it so logging still works.
            db()
                ->prepare(
                    'INSERT INTO activity_log (actor, category, action, summary, prop_key, entity, entity_id, meta, ip)
                     VALUES (?,?,?,?,?,?,?,?,?)',
                )
                ->execute($vals);
        }
    } catch (\Throwable $e) {
    }
}

// Token for a property's iCal export feed: unguessable, needs no login, derived
// one-way from APP_SECRET so nothing secret leaks. Shared by ical-export.php
// (validates it) and ical-import.php (builds the ready-made feed URL).
function ical_token($propKey)
{
    return substr(hash_hmac('sha256', 'ical:' . $propKey, APP_SECRET), 0, 24);
}

// ---- Reply-by-email: signed thread tokens ----
// A guest-message notification email carries this token in its Reply-To
// plus-address + Message-ID, so a reply the owner sends can be matched back to
// the exact conversation (inbound-mail.php verifies it). One-way HMAC — a
// forged token can't select an arbitrary thread.
function msg_reply_token($threadId)
{
    $tid = (int) $threadId;
    return $tid . 'x' . substr(hash_hmac('sha256', 'msg-reply|' . $tid, APP_SECRET), 0, 32);
}
function msg_reply_verify($token)
{
    // 32-hex is current (128-bit, matching the other tokens); 16-hex tokens
    // still ride in the Reply-To of ALREADY-SENT emails, so verify accepts
    // both — each against its own full-strength recomputation.
    if (!preg_match('/(\d+)x([0-9a-f]{16,32})/', (string) $token, $m)) {
        return 0;
    }
    $tid = (int) $m[1];
    $mac = hash_hmac('sha256', 'msg-reply|' . $tid, APP_SECRET);
    $want = strlen($m[2]) >= 32 ? substr($mac, 0, 32) : substr($mac, 0, 16);
    return hash_equals($want, $m[2]) ? $tid : 0;
}
// The reply address a message-notification email points at:
//  1. If REPLY_INBOX is set → its plus-address (the webhook route).
//  2. Else, zero-setup: the mailbox the site already sends from (MAIL_FROM /
//     SMTP_USER), which mailbox-read.php polls over POP3. Replies there are
//     matched by the token in the Message-ID (In-Reply-To) + subject.
//  3. Else '' → notifications behave as before (Reply-To = owner's own address).
function msg_reply_address($threadId)
{
    if (defined('REPLY_INBOX') && REPLY_INBOX && strpos(REPLY_INBOX, '@') !== false) {
        [$local, $domain] = explode('@', REPLY_INBOX, 2);
        return $local . '+' . msg_reply_token($threadId) . '@' . $domain;
    }
    if (function_exists('mailbox_auto_enabled') && mailbox_auto_enabled()) {
        $addr = defined('MAIL_FROM') && MAIL_FROM ? MAIL_FROM : (defined('SMTP_USER') ? SMTP_USER : '');
        if ($addr && strpos($addr, '@') !== false) {
            return $addr;
        }
    }
    return '';
}
// True when replies are matched by header/subject token rather than a plus-
// address (the zero-setup POP3 route) — the notification then also tags the
// subject so a client that drops In-Reply-To still matches.
function msg_reply_needs_subject_tag()
{
    return !(defined('REPLY_INBOX') && REPLY_INBOX) &&
        function_exists('mailbox_auto_enabled') &&
        mailbox_auto_enabled();
}

// ---- Square online payments helpers ----
// True only when the owner has switched payments on AND filled in the keys.
function square_enabled()
{
    return defined('SQUARE_PAYMENTS_ENABLED') &&
        SQUARE_PAYMENTS_ENABLED &&
        defined('SQUARE_ACCESS_TOKEN') &&
        SQUARE_ACCESS_TOKEN !== '' &&
        defined('SQUARE_LOCATION_ID') &&
        SQUARE_LOCATION_ID !== '';
}
// Square REST host for the configured environment.
function square_api_base()
{
    return defined('SQUARE_ENVIRONMENT') && SQUARE_ENVIRONMENT === 'production'
        ? 'https://connect.squareup.com'
        : 'https://connect.squareupsandbox.com';
}
// The public URL Square POSTs webhook events to. A config.php constant wins (for
// installs that pinned it), else it's derived from the live host so the app can
// self-provision the subscription with no manual config. NB square-webhook.php
// recomputes the HMAC over THIS exact string, so it must match what we register.
function square_webhook_url()
{
    if (defined('SQUARE_WEBHOOK_URL') && SQUARE_WEBHOOK_URL !== '') {
        return SQUARE_WEBHOOK_URL;
    }
    return site_base_url() . 'square-webhook.php';
}
// The webhook signing key. A config.php constant wins; otherwise the key the app
// captured when it created the subscription, stored encrypted at rest under the
// private 'apikey-' content key. Empty string when the webhook isn't wired up yet.
function square_webhook_signing_key()
{
    if (defined('SQUARE_WEBHOOK_SIGNATURE_KEY') && SQUARE_WEBHOOK_SIGNATURE_KEY !== '') {
        return SQUARE_WEBHOOK_SIGNATURE_KEY;
    }
    try {
        return content_value('apikey-square-webhook');
    } catch (\Throwable $e) {
        return '';
    }
}
// Verify a Square webhook signature: base64( HMAC-SHA256( notificationUrl + rawBody,
// signingKey ) ), constant-time. Pure — unit-tested by test-webhook.php.
function square_webhook_signature_ok($url, $rawBody, $signingKey, $sig)
{
    if ($signingKey === '' || $url === '' || $sig === '') {
        return false;
    }
    $expected = base64_encode(hash_hmac('sha256', $url . $rawBody, $signingKey, true));
    return hash_equals($expected, (string) $sig);
}
// ---- Shared money primitives (ONE definition; every caller agrees) ----------
// The net card money a booking has received: settled charges MINUS refunds that
// haven't failed. This exact SQL used to live copy-pasted in reconcile_booking_
// payment(), the refund cap, pay.php and square-webhook.php — the audit's
// FAILED-refund fix had to be applied to all four by hand, and a fifth copy would
// have silently diverged. Now there is one. Callers apply their own cap/floor
// (min at $total, floor at prior−refund) on top; this returns the raw net ≥ 0,
// rounded to 2dp. Throws on a DB error so a caller with a fallback can catch it —
// matching the original inline behaviour (reconcile ran it bare; pay.php wrapped
// it and fell back to the bookings figure).
function booking_ledger_net($bookingId)
{
    $s = db()->prepare(
        "SELECT COALESCE(SUM(CASE WHEN kind IN ('deposit','balance') AND status IN ('COMPLETED','APPROVED') THEN amount ELSE 0 END),0)
              - COALESCE(SUM(CASE WHEN kind = 'refund' AND (status IS NULL OR status NOT IN ('FAILED','REJECTED')) THEN amount ELSE 0 END),0) AS net
           FROM payments WHERE booking_id = ?",
    );
    $s->execute([(int) $bookingId]);
    return round(max(0, (float) $s->fetchColumn()), 2);
}

// The RENTAL price of a booking from its agreed snapshot (nightly + txn fee, a
// manual override raising the floor) — the figure the damages deposit sits above
// and accounts.php attributes income up to. Duplicated in accounts.php and
// damages_collected(); one definition keeps them from drifting. accounts.php adds
// its own legacy "no snapshot → treat everything as income" fallback on top.
function booking_rental_price($b)
{
    $rental = (float) ($b['agreed_nightly'] ?? 0) + (float) ($b['agreed_txn_fee'] ?? 0);
    if (($b['price_override'] ?? null) !== null && $b['price_override'] !== '') {
        $rental = max($rental, (float) $b['price_override']);
    }
    return $rental;
}

// Unguessable, login-free token that authorises PAYING a specific booking.
// One-way from APP_SECRET (same idea as ical_token) — leaks nothing if seen.
function pay_token($bookingId)
{
    return substr(hash_hmac('sha256', 'pay:' . (int) $bookingId, APP_SECRET), 0, 32);
}
// Unguessable, login-free token for a booking's guest invoice page (invoice.php).
// Same one-way HMAC as pay_token but a distinct purpose so the two links can't be
// swapped; leaks nothing if seen.
function invoice_token($bookingId)
{
    return substr(hash_hmac('sha256', 'invoice:' . (int) $bookingId, APP_SECRET), 0, 32);
}
// Unguessable, login-free token for a booking's guest-registration form
// (guest-details.php) where the lead guest records the party for the UK hotel
// records duty. Distinct purpose so it can't be swapped with the pay/invoice
// links; leaks nothing if seen.
function guest_reg_token($bookingId)
{
    return substr(hash_hmac('sha256', 'guestreg:' . (int) $bookingId, APP_SECRET), 0, 32);
}
// ---- Marketing-email opt-out (anniversary re-invites etc.) ----------------
// Past guests aren't newsletter subscribers, so they need their own one-click
// unsubscribe: a signed link (email-optout.php) adds their address to a small
// suppression list in the content table; marketing-ish senders check it.
function email_optout_token($email)
{
    return substr(hash_hmac('sha256', 'optout:' . strtolower(trim((string) $email)), APP_SECRET), 0, 32);
}
function email_optout_has($email)
{
    $email = strtolower(trim((string) $email));
    return $email !== '' && in_array($email, content_json('email-optout', []), true);
}
function email_optout_add($email)
{
    $email = strtolower(trim((string) $email));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    $list = content_json('email-optout', []);
    if (in_array($email, $list, true)) {
        return true; // idempotent
    }
    $list[] = $email;
    if (count($list) > 2000) {
        $list = array_slice($list, -2000); // bounded — never balloons
    }
    content_set_scalar('email-optout', $list);
    return true;
}
// Unguessable token for a passwordless email sign-in link. Binds a guest id to
// an issue-time so it expires (checked in auth.php), and leaks nothing if seen —
// same one-way HMAC idea as pay_token. The timestamp travels in the link too.
function login_token($guestId, $ts)
{
    return substr(hash_hmac('sha256', 'login:' . (int) $guestId . ':' . (int) $ts, APP_SECRET), 0, 32);
}
// The canonical public host for THIS environment, chosen from a SERVER-SIDE signal
// (an explicit CANONICAL_HOST constant, else staging-vs-production via the
// STAGING_SANDBOX constant) — never the client-controlled Host header.
function site_canonical_host()
{
    if (defined('CANONICAL_HOST') && CANONICAL_HOST) {
        return strtolower(CANONICAL_HOST);
    }
    $base = 'cottageholidaysblakeney.co.uk';
    return defined('STAGING_SANDBOX') && STAGING_SANDBOX ? 'staging.' . $base : $base;
}
// Is a request Host header one of OURS (apex / www / staging / localhost)? The
// Host header is attacker-controlled, so anything else must not be trusted.
function site_host_trusted($host)
{
    $host = strtolower(preg_replace('/:\d+$/', '', (string) $host)); // strip :port
    if ($host === '') {
        return false;
    }
    if ($host === 'localhost' || $host === '127.0.0.1' || $host === '[::1]') {
        return true; // dev
    }
    $canon = site_canonical_host();
    $apex = preg_replace('/^staging\./', '', $canon);
    return $host === $apex || $host === 'www.' . $apex || $host === 'staging.' . $apex;
}
// Public site root (scheme + host + the folder this script runs from), used to
// build the guest links we EMAIL (sign-in / pay / invoice / guest-reg). Because
// those links carry capability tokens, an attacker who could spoof the Host header
// would otherwise mint genuine-looking emails pointing at their own domain
// (phishing / token capture). So we only honour the request Host when it is one of
// ours; any other value falls back to the canonical host over https.
// Proxy-aware HTTPS via request_is_https().
function site_base_url()
{
    $host = $_SERVER['HTTP_HOST'] ?? '';
    $scheme = request_is_https() ? 'https' : 'http';
    if (!site_host_trusted($host)) {
        $host = site_canonical_host();
        $scheme = 'https';
    }
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return $scheme . '://' . $host . $dir . '/';
}
// Minimal Square REST call over cURL (no Composer/SDK needed on shared hosting,
// matching the raw SMTP/webpush approach). Returns ['status'=>int,'body'=>array].
// Never throws; a transport failure comes back as status 0 with an 'error' body.
function square_api($method, $path, $payload = null)
{
    $url = square_api_base() . $path;
    $headers = [
        'Authorization: Bearer ' . SQUARE_ACCESS_TOKEN,
        'Square-Version: ' . (defined('SQUARE_API_VERSION') ? SQUARE_API_VERSION : '2024-01-18'),
        'Content-Type: application/json',
        'Accept: application/json',
    ];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    if ($payload !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
    $raw = curl_exec($ch);
    if ($raw === false) {
        $err = curl_error($ch);
        curl_close($ch);
        return ['status' => 0, 'body' => ['error' => 'Square unreachable: ' . $err]];
    }
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $body = json_decode($raw, true);
    return ['status' => $status, 'body' => is_array($body) ? $body : []];
}

// True if [checkIn, checkOut) overlaps a confirmed booking OR an imported
// platform (Airbnb/Vrbo) block for this property. Overlap test:
// existing.start < new.end AND existing.end > new.start. The ical_blocks table
// may not exist on older installs, so that check degrades gracefully.
function dates_clash($propKey, $checkIn, $checkOut, $ignoreId = null)
{
    $sql = 'SELECT COUNT(*) c FROM bookings WHERE prop_key = ? AND check_in < ? AND check_out > ?';
    $args = [$propKey, $checkOut, $checkIn];
    if ($ignoreId) {
        $sql .= ' AND id <> ?';
        $args[] = $ignoreId;
    }
    $s = db()->prepare($sql);
    $s->execute($args);
    if ((int) $s->fetch()['c'] > 0) {
        return true;
    }
    try {
        $s2 = db()->prepare('SELECT COUNT(*) c FROM ical_blocks WHERE prop_key = ? AND check_in < ? AND check_out > ?');
        $s2->execute([$propKey, $checkOut, $checkIn]);
        return (int) $s2->fetch()['c'] > 0;
    } catch (\Throwable $e) {
        return false;
    }
}

// ---- Server-side error capture --------------------------------------------
// display_errors is off, so an uncaught exception or fatal in any endpoint was
// a blank 500 the owner never heard about. These handlers put it in the
// activity log (severity warn → the "Needs attention" stream + weekly digest)
// and nudge the owner's devices — deduped and throttled so a hot loop can't
// flood either. Logging is skipped entirely if this request never reached the
// database (a failed connect inside a handler would corrupt the response).
function chb_log_server_error($kind, $msg, $file, $line)
{
    static $loggedThisRequest = 0;
    if ($loggedThisRequest >= 3) {
        return; // one broken request must not spam the log
    }
    if (empty($GLOBALS['__chb_db_up'])) {
        return; // DB never connected — nothing safe to do
    }
    $loggedThisRequest++;
    try {
        $script = basename((string) ($_SERVER['SCRIPT_NAME'] ?? 'php'));
        $summary = mb_substr('Server error in ' . $script . ' — ' . trim((string) $msg), 0, 255);
        // Dedup: the same error within the last hour is logged once, however
        // many visitors hit the broken page.
        try {
            $s = db()->prepare(
                "SELECT 1 FROM activity_log WHERE action = 'server.error' AND summary = ?
                   AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) LIMIT 1",
            );
            $s->execute([$summary]);
            if ($s->fetchColumn()) {
                return;
            }
        } catch (\Throwable $e) {
        }
        log_activity('system', 'server.error', $summary, [
            'actor' => 'system',
            'severity' => 'warn',
            'entity' => 'server',
            'meta' => ['detail' => $kind . ' at ' . basename((string) $file) . ':' . (int) $line],
        ]);
        chb_maybe_alert_owner_error($summary);
    } catch (\Throwable $e) {
        /* the error handler must never error the request further */
    }
}

// Push "Site error detected" to the owner's devices — at most one per 6 hours
// (a reporting aid, not a pager; the log keeps every deduped occurrence).
function chb_maybe_alert_owner_error($summary)
{
    try {
        $last = content_value('error-alert-last');
        if ($last !== '' && strtotime($last) !== false && time() - strtotime($last) < 6 * 3600) {
            return;
        }
        db()
            ->prepare(
                "INSERT INTO content (item_key, item_value) VALUES ('error-alert-last', ?)
                 ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
            )
            ->execute([json_encode(gmdate('c'))]);
        require_once __DIR__ . '/webpush.php';
        if (function_exists('alert_owner')) {
            alert_owner('Site error detected', mb_substr((string) $summary, 0, 120));
        }
    } catch (\Throwable $e) {
    }
}

set_exception_handler(function ($e) {
    chb_log_server_error(get_class($e), $e->getMessage(), $e->getFile(), $e->getLine());
    // Only shape the response when nothing has been sent — non-JSON endpoints
    // (sitemap XML, iCal, backup download) mid-stream just get the log entry.
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Something went wrong on our side — please try again.']);
    }
});

register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        chb_log_server_error('Fatal', $err['message'], $err['file'], $err['line']);
    }
});
