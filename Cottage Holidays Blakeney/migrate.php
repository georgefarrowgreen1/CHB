<?php
// ============================================================
//  migrate.php — applies any pending migration-*.sql files and records
//  which ones have run, so you never have to guess in phpMyAdmin again.
//
//  Auth (same pattern as pre-arrival.php): a logged-in admin, OR a cron
//  secret:  migrate.php?cron=APP_SECRET
//
//  First run on a database whose migrations were ALREADY applied by hand:
//  use  migrate.php?baseline=1  (admin) to record every current migration
//  file as "applied" WITHOUT re-running it. After that, just visit
//  migrate.php after each deploy that adds a new migration.
//
//  Idempotent: "already exists / duplicate column" errors are treated as
//  already-applied, so re-running is safe.
// ============================================================
require_once __DIR__ . '/db.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string)$_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) {
    json_out(['error' => 'Not authorised'], 401);
}
$baseline = isset($_GET['baseline']) && $_GET['baseline'] == '1';

// Ledger of applied migrations.
db()->exec('CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(190) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');

$applied = [];
$st = db()->query('SELECT filename FROM schema_migrations');
foreach ($st->fetchAll() as $r) { $applied[$r['filename']] = true; }

$files = glob(__DIR__ . '/migration-*.sql');
sort($files);

// Split a .sql file into individual statements (strips comments; DDL only, so
// no semicolons inside string literals to worry about).
function split_sql($path) {
    $raw = (string)file_get_contents($path);
    $raw = preg_replace('!/\*.*?\*/!s', '', $raw);              // block comments
    $kept = [];
    foreach (preg_split('/\r?\n/', $raw) as $line) {
        $t = ltrim($line);
        if ($t === '' || strpos($t, '--') === 0 || strpos($t, '#') === 0) continue;
        $kept[] = $line;
    }
    $parts = array_map('trim', explode(';', implode("\n", $kept)));
    return array_values(array_filter($parts, fn($s) => $s !== ''));
}

// MySQL errors that simply mean "this change is already in place".
function is_idempotent_error($msg) {
    $m = strtolower($msg);
    foreach (['duplicate column', 'already exists', 'duplicate key name',
              'multiple primary key', "check that column/key exists"] as $needle) {
        if (strpos($m, $needle) !== false) return true;
    }
    return false;
}

$report = [];
foreach ($files as $path) {
    $name = basename($path);
    if (isset($applied[$name])) { $report[] = ['file' => $name, 'status' => 'already-recorded']; continue; }

    if ($baseline) {
        $ins = db()->prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, NOW())');
        $ins->execute([$name]);
        $report[] = ['file' => $name, 'status' => 'baselined (not run)'];
        continue;
    }

    $hardError = null; $ran = 0; $skipped = 0;
    foreach (split_sql($path) as $stmt) {
        try { db()->exec($stmt); $ran++; }
        catch (\Throwable $e) {
            if (is_idempotent_error($e->getMessage())) { $skipped++; }
            else { $hardError = $e->getMessage(); break; }
        }
    }
    if ($hardError) {
        // Not recorded — fix and re-run; already-run statements are idempotent.
        $report[] = ['file' => $name, 'status' => 'ERROR', 'ran' => $ran, 'error' => $hardError];
        continue;
    }
    db()->prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, NOW())')
        ->execute([$name]);
    $report[] = ['file' => $name, 'status' => 'applied', 'statements_run' => $ran, 'already_present' => $skipped];
}

$failed = array_filter($report, fn($r) => ($r['status'] ?? '') === 'ERROR');
json_out([
    'ok' => empty($failed),
    'mode' => $baseline ? 'baseline' : 'apply',
    'migrations' => $report,
], empty($failed) ? 200 : 500);
