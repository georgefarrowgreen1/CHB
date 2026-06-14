<?php
// ============================================================
//  health.php — diagnostic. Visit in your browser:
//  https://YOURDOMAIN/health.php
//  Tells you if PHP, the database, the tables and an admin user
//  are all in place. DELETE this file once everything works.
// ============================================================
require_once __DIR__ . '/db.php';

// Privacy: full diagnostics (table presence, counts, setup hints) are only shown
// to a logged-in admin OR when no admin exists yet (the genuine first-time setup
// case). Once the site is set up, anonymous visitors get a minimal status only,
// so this file can't be left up and leak internal details.
$isAdmin = !empty($_SESSION['admin_id']);
$adminExists = false;
try { $adminExists = ((int)db()->query('SELECT COUNT(*) c FROM admins')->fetch()['c']) > 0; } catch (Exception $e) {}
$detailed = $isAdmin || !$adminExists;

if (!$detailed) {
    json_out(['status' => 'ok', 'php_version' => PHP_VERSION, 'https_detected' => request_is_https()]);
}

$report = [
    'php_version' => PHP_VERSION,
    'https_detected' => request_is_https(),
    'session_works' => false,
    'db_connects' => false,
    'tables_present' => [],
    'admin_count' => null,
    'properties_count' => null,
];

// Session round-trip
$_SESSION['__health'] = 'ok';
$report['session_works'] = (($_SESSION['__health'] ?? '') === 'ok');

try {
    $pdo = db();
    $report['db_connects'] = true;
    $tables = ['admins','guests','bookings','enquiries','properties','content'];
    foreach ($tables as $t) {
        try {
            $pdo->query("SELECT 1 FROM `$t` LIMIT 1");
            $report['tables_present'][$t] = true;
        } catch (Exception $e) {
            $report['tables_present'][$t] = false;
        }
    }
    try { $report['admin_count'] = (int)$pdo->query('SELECT COUNT(*) c FROM admins')->fetch()['c']; } catch (Exception $e) {}
    try { $report['properties_count'] = (int)$pdo->query('SELECT COUNT(*) c FROM properties')->fetch()['c']; } catch (Exception $e) {}
} catch (Exception $e) {
    $report['db_error'] = 'connection failed — check config.php credentials';
}

// Uploads folder writability (needed for the Live Editor photo upload)
$uploadsDir = __DIR__ . '/uploads';
if (is_dir($uploadsDir)) {
    $report['uploads_writable'] = is_writable($uploadsDir);
} else {
    // Can we create it?
    $report['uploads_writable'] = @mkdir($uploadsDir, 0755) ? true : false;
}

// Plain-language guidance
$hints = [];
if (!$report['db_connects']) $hints[] = 'Database will not connect: re-check the four DB_* values in includes/config.php.';
if ($report['db_connects'] && in_array(false, $report['tables_present'], true)) $hints[] = 'Some tables are missing: import schema.sql via phpMyAdmin.';
if ($report['admin_count'] === 0) $hints[] = 'No admin user yet: run setup.php?username=admin&password=YourPass (then delete it).';
if (!$report['https_detected']) $hints[] = 'HTTPS not detected — if your site IS on https://, logins should still work now, but enable Force HTTPS in IONOS.';
if (isset($report['uploads_writable']) && !$report['uploads_writable']) $hints[] = 'The uploads/ folder is not writable: set its permissions to 755 (or 775) so photo uploads work.';
$report['next_steps'] = $hints ?: ['Everything looks good. Try logging in, then DELETE health.php.'];

json_out($report);
