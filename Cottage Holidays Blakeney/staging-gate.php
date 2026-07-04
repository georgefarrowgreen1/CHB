<?php
// ============================================================
//  staging-gate.php — gate for the staging site (staging.<domain> only).
//
//  Lets the owner in, blocks everyone else. Two ways to authenticate, so it
//  works everywhere — including in-app browsers (Mail/Instagram/etc.) that don't
//  show the native HTTP Basic-Auth password dialog:
//    1) HTTP Basic Auth (the OS prompt, where the browser shows it), OR
//    2) the on-page login form below, which sets a signed cookie.
//  Credentials live in the staging config.php (STAGING_GATE_USER / _PASS). If
//  they're absent the gate fails CLOSED (locked), never open.
// ============================================================

// Ships to production too, but is never routed to there. If hit on a non-staging
// host, just send the visitor to the homepage.
$host = $_SERVER['HTTP_HOST'] ?? '';
if (!preg_match('/(^|\.)staging\./i', $host)) {
    header('Location: /');
    exit();
}

@include_once __DIR__ . '/config.php';
$realm = 'Staging — authorised access only';
$user = defined('STAGING_GATE_USER') ? (string) STAGING_GATE_USER : '';
$pass = defined('STAGING_GATE_PASS') ? (string) STAGING_GATE_PASS : '';
$secret = defined('APP_SECRET') ? (string) APP_SECRET : '';
$cookieName = 'chb_staging_gate';
// Cookie token is an HMAC of the username with APP_SECRET — unforgeable, and the
// password is never stored on the device.
$cookieVal = $secret !== '' ? hash_hmac('sha256', 'staging-gate|' . $user, $secret) : '';

$serve = function () {
    header('Content-Type: text/html; charset=utf-8');
    header('X-Robots-Tag: noindex, nofollow');
    readfile(__DIR__ . '/index.html');
    exit();
};

// ---- 1) Form login (fallback when the native dialog doesn't appear) ----------
$loginError = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $u = (string) ($_POST['u'] ?? '');
    $p = (string) ($_POST['p'] ?? '');
    if ($user !== '' && $cookieVal !== '' && hash_equals($user, $u) && hash_equals($pass, $p)) {
        setcookie($cookieName, $cookieVal, [
            'expires' => time() + 60 * 60 * 24 * 30,
            'path' => '/',
            'secure' => true,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        header('Location: /');
        exit(); // reload → now authorised via the cookie
    }
    $loginError = 'Wrong username or password — please try again.';
}

// ---- 2) Already authorised? Basic Auth header OR a valid cookie --------------
$bu = $_SERVER['PHP_AUTH_USER'] ?? null;
$bp = $_SERVER['PHP_AUTH_PW'] ?? null;
if ($bu === null) {
    $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/Basic\s+(.+)/i', $hdr, $m)) {
        $dec = base64_decode($m[1], true);
        if ($dec !== false && strpos($dec, ':') !== false) {
            [$bu, $bp] = explode(':', $dec, 2);
        }
    }
}
$basicOk = $user !== '' && is_string($bu) && is_string($bp) && hash_equals($user, $bu) && hash_equals($pass, $bp);
$cookieOk =
    $cookieVal !== '' && isset($_COOKIE[$cookieName]) && hash_equals($cookieVal, (string) $_COOKIE[$cookieName]);
if ($basicOk || $cookieOk) {
    $serve();
}

// ---- 3) Not authorised → 401 page with a login form + button -----------------
// Still offer the native Basic dialog (works on desktop); the form covers the rest.
header('WWW-Authenticate: Basic realm="' . $realm . '"');
header('HTTP/1.1 401 Unauthorized');
header('X-Robots-Tag: noindex, nofollow');
header('Content-Type: text/html; charset=utf-8');
$esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
?><!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Staging — restricted</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#1b1d23;color:#e8e9ee;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
  .box{width:100%;max-width:360px;text-align:center}
  h1{font-weight:600;margin:0 0 8px;font-size:1.6rem}
  p.sub{color:#aeb2c0;margin:0 0 22px;font-size:0.95rem;line-height:1.5}
  label{display:block;text-align:left;font-size:0.8rem;color:#aeb2c0;margin:0 0 4px}
  input{width:100%;box-sizing:border-box;padding:13px 14px;margin:0 0 14px;border-radius:12px;border:1px solid #2c2f38;background:#15161b;color:#f4f5f7;font-size:1rem}
  button{width:100%;padding:14px;border:0;border-radius:12px;background:#D6A785;color:#1a191b;font-weight:700;font-size:1rem;cursor:pointer}
  .err{color:#ff9b9b;font-size:0.85rem;margin:0 0 14px}
</style></head>
<body>
  <form class="box" method="POST" action="/staging-gate.php">
    <h1>Staging — restricted</h1>
    <p class="sub">This is a private test environment. Authorised access only — sign in to continue.</p>
    <?php if ($loginError) {
        echo '<p class="err">' . $esc($loginError) . '</p>';
    } ?>
    <label for="u">Username</label>
    <input id="u" name="u" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" required>
    <label for="p">Password</label>
    <input id="p" name="p" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
</body></html>
