<?php
// ============================================================
//  vapid-keygen.php — RUN ONCE to generate your Web Push (VAPID) keys, paste
//  the three lines into config.php, then DELETE this file.
//
//  Visit (logged in as admin):   https://YOURDOMAIN/vapid-keygen.php
//  or with the cron secret:      https://YOURDOMAIN/vapid-keygen.php?cron=APP_SECRET
// ============================================================
require_once __DIR__ . '/db.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string)$_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) {
    json_out(['error' => 'Not authorised — log in as admin first.'], 401);
}

$res = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
if (!$res) json_out(['error' => 'OpenSSL EC (prime256v1) is not available on this server.'], 500);

openssl_pkey_export($res, $pem);
$d = openssl_pkey_get_details($res);
$x = str_pad($d['ec']['x'], 32, "\x00", STR_PAD_LEFT);
$y = str_pad($d['ec']['y'], 32, "\x00", STR_PAD_LEFT);
$pub = "\x04" . $x . $y;                                   // uncompressed P-256 point
$pubB64 = rtrim(strtr(base64_encode($pub), '+/', '-_'), '=');
$pemEsc = str_replace(["\r\n", "\n"], '\n', trim($pem));   // newlines escaped for a PHP "string"

json_out([
    'instructions' => 'Paste these three lines into config.php (replacing any existing VAPID_* lines), set VAPID_SUBJECT to your email, then DELETE vapid-keygen.php.',
    'config' =>
        "define('VAPID_PUBLIC_KEY', '" . $pubB64 . "');\n" .
        "define('VAPID_PRIVATE_KEY', \"" . $pemEsc . "\");\n" .
        "define('VAPID_SUBJECT', 'mailto:you@yourdomain.co.uk');",
]);
