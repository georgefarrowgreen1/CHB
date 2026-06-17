<?php
// ============================================================
//  staging-gate.php — HTTP Basic-Auth gate for the staging site.
//
//  Reached ONLY on the staging.<domain> host (routed there by .htaccess). It
//  demands the staging password, then serves the app shell (index.html). Everyone
//  else gets a 401 error page, so the test environment stays private to the owner.
//
//  Set the credentials in the STAGING copy of config.php:
//      define('STAGING_GATE_USER', 'owner');
//      define('STAGING_GATE_PASS', 'a-staging-password');
//  If they're absent the gate fails CLOSED (locked), never open.
// ============================================================

// Safety: this file ships to production too but is never routed to there. If it's
// ever hit on a non-staging host, just send the visitor to the homepage.
$host = $_SERVER['HTTP_HOST'] ?? '';
if (!preg_match('/(^|\.)staging\./i', $host)) { header('Location: /'); exit; }

@include_once __DIR__ . '/config.php';
$realm = 'Staging — authorised access only';
$user  = defined('STAGING_GATE_USER') ? (string) STAGING_GATE_USER : '';
$pass  = defined('STAGING_GATE_PASS') ? (string) STAGING_GATE_PASS : '';

// Read the submitted credentials. Under CGI/FastCGI PHP_AUTH_* is usually empty,
// so fall back to parsing the Authorization header forwarded by .htaccess.
$u = isset($_SERVER['PHP_AUTH_USER']) ? $_SERVER['PHP_AUTH_USER'] : null;
$p = isset($_SERVER['PHP_AUTH_PW'])   ? $_SERVER['PHP_AUTH_PW']   : null;
if ($u === null) {
    $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/Basic\s+(.+)/i', $hdr, $m)) {
        $dec = base64_decode($m[1], true);
        if ($dec !== false && strpos($dec, ':') !== false) { list($u, $p) = explode(':', $dec, 2); }
    }
}

$ok = $user !== '' && $pass !== '' && is_string($u) && is_string($p)
   && hash_equals($user, $u) && hash_equals($pass, $p);

if (!$ok) {
    header('WWW-Authenticate: Basic realm="' . $realm . '"');
    header('HTTP/1.1 401 Unauthorized');
    header('X-Robots-Tag: noindex, nofollow');
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex">'
       . '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Staging — restricted</title></head>'
       . '<body style="margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#1b1d23;color:#e8e9ee;display:grid;place-items:center;min-height:100vh">'
       . '<div style="text-align:center;padding:24px;max-width:420px">'
       . '<h1 style="font-weight:600;margin:0 0 10px">Staging — restricted</h1>'
       . '<p style="color:#aeb2c0;margin:0">This is a private test environment. Authorised access only — please enter the staging credentials.</p>'
       . '</div></body></html>';
    exit;
}

// Authorised — serve the app shell exactly as a normal page load would.
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
readfile(__DIR__ . '/index.html');
