<?php
// ============================================================
//  setup.php — RUN ONCE to create the first admin user, then DELETE.
//  Visit https://yourdomain/setup.php?username=admin&password=YOURPASS
//  After it confirms success, DELETE this file from the server.
// ============================================================
require_once __DIR__ . '/db.php';

// Keep this one-time tool out of search engines even if it's left on the server.
header('X-Robots-Tag: noindex, nofollow');

// The admin password is passed in the URL, so it would be logged/visible in clear
// text over plain HTTP. Refuse unless the request is HTTPS (proxy-aware — see
// request_is_https() in db.php). Enable Force HTTPS (deploy step 4) before this step.
if (!request_is_https()) {
    json_out(['error' => 'Load this over https:// (not http://) so your password stays encrypted. Enable Force HTTPS in IONOS first.'], 400);
}

$username = clean($_GET['username'] ?? '');
$password = $_GET['password'] ?? '';

if ($username === '' || strlen($password) < 4) {
    json_out(['error' => 'Provide ?username=...&password=... (min 4 chars)'], 400);
}

// Refuse if an admin already exists (so this can't be abused to add admins)
$count = db()->query('SELECT COUNT(*) AS c FROM admins')->fetch()['c'];
if ((int)$count > 0) {
    json_out(['error' => 'An admin already exists. Delete setup.php.'], 403);
}

$hash = password_hash($password, PASSWORD_DEFAULT);
$stmt = db()->prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)');
$stmt->execute([$username, $hash]);

json_out(['ok' => true, 'message' => 'Admin created. Now DELETE setup.php from the server.']);
