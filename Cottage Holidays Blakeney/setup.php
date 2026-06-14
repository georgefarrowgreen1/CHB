<?php
// ============================================================
//  setup.php — RUN ONCE to create the first admin user, then DELETE.
//  Visit https://yourdomain/setup.php?username=admin&password=YOURPASS
//  After it confirms success, DELETE this file from the server.
// ============================================================
require_once __DIR__ . '/db.php';

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
