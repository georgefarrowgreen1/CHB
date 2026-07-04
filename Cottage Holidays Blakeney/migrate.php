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

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) {
    json_out(['error' => 'Not authorised'], 401);
}
$baseline = isset($_GET['baseline']) && $_GET['baseline'] == '1';
// force=1 re-runs EVERY migration regardless of the ledger. Safe because the
// migrations are idempotent (CREATE TABLE IF NOT EXISTS, guarded ADD COLUMN).
// Use this to repair a database that was wrongly baselined (migrations marked
// "applied" without their tables actually being created).
$force = isset($_GET['force']) && $_GET['force'] == '1';

// Ledger of applied migrations.
db()->exec('CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(190) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');

$applied = [];
if (!$force) {
    $st = db()->query('SELECT filename FROM schema_migrations');
    foreach ($st->fetchAll() as $r) {
        $applied[$r['filename']] = true;
    }
}

$files = glob(__DIR__ . '/migration-*.sql');
sort($files);

// Split a .sql file into individual statements. Strips comments, then splits on
// ';' — but only OUTSIDE string literals / quoted identifiers, so semicolons that
// appear inside seed text (e.g. "...sail daily; check tide times...") don't chop a
// statement in half. Handles '' / "" doubling and backslash escapes.
function split_sql($path)
{
    $raw = (string) file_get_contents($path);
    $raw = preg_replace('!/\*.*?\*/!s', '', $raw); // block comments
    $kept = [];
    foreach (preg_split('/\r?\n/', $raw) as $line) {
        $t = ltrim($line);
        if ($t === '' || strpos($t, '--') === 0 || strpos($t, '#') === 0) {
            continue;
        }
        $kept[] = $line;
    }
    $sql = implode("\n", $kept);
    $parts = [];
    $buf = '';
    $q = '';
    $len = strlen($sql);
    for ($i = 0; $i < $len; $i++) {
        $ch = $sql[$i];
        if ($q !== '') {
            // inside a quoted string / identifier
            $buf .= $ch;
            if ($ch === '\\' && $q !== '`' && $i + 1 < $len) {
                $buf .= $sql[++$i];
            }
            // backslash escape
            elseif ($ch === $q) {
                if ($i + 1 < $len && $sql[$i + 1] === $q) {
                    $buf .= $sql[++$i];
                }
                // doubled = literal quote
                else {
                    $q = '';
                } // string closed
            }
        } elseif ($ch === ';') {
            $parts[] = trim($buf);
            $buf = '';
        } else {
            $buf .= $ch;
            if ($ch === "'" || $ch === '"' || $ch === '`') {
                $q = $ch;
            } // string opened
        }
    }
    if (trim($buf) !== '') {
        $parts[] = trim($buf);
    }

    return array_values(array_filter($parts, fn($s) => $s !== ''));
}

// MySQL errors that simply mean "this change is already in place".
function is_idempotent_error($msg)
{
    $m = strtolower($msg);
    foreach (
        [
            'duplicate column',
            'already exists',
            'duplicate key name',
            'multiple primary key',
            'check that column/key exists',
        ]
        as $needle
    ) {
        if (strpos($m, $needle) !== false) {
            return true;
        }
    }
    return false;
}

$report = [];
foreach ($files as $path) {
    $name = basename($path);
    if (isset($applied[$name])) {
        $report[] = ['file' => $name, 'status' => 'already-recorded'];
        continue;
    }

    if ($baseline) {
        $ins = db()->prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, NOW())');
        $ins->execute([$name]);
        $report[] = ['file' => $name, 'status' => 'baselined (not run)'];
        continue;
    }

    $hardError = null;
    $ran = 0;
    $skipped = 0;
    foreach (split_sql($path) as $stmt) {
        try {
            db()->exec($stmt);
            $ran++;
        } catch (\Throwable $e) {
            if (is_idempotent_error($e->getMessage())) {
                $skipped++;
            } else {
                $hardError = $e->getMessage();
                break;
            }
        }
    }
    if ($hardError) {
        // Not recorded — fix and re-run; already-run statements are idempotent.
        $report[] = ['file' => $name, 'status' => 'ERROR', 'ran' => $ran, 'error' => $hardError];
        continue;
    }
    db()
        ->prepare(
            'INSERT INTO schema_migrations (filename, applied_at) VALUES (?, NOW())
                   ON DUPLICATE KEY UPDATE applied_at = NOW()',
        )
        ->execute([$name]);
    $report[] = [
        'file' => $name,
        'status' => $force ? 're-applied' : 'applied',
        'statements_run' => $ran,
        'already_present' => $skipped,
    ];
}

$appliedNow = array_filter($report, fn($r) => in_array($r['status'] ?? '', ['applied', 're-applied'], true));
if ($appliedNow) {
    log_activity('system', 'migrate.run', 'Database updates applied (' . count($appliedNow) . ')', ['entity' => 'migration']);
}
$failed = array_filter($report, fn($r) => ($r['status'] ?? '') === 'ERROR');
json_out(
    [
        'ok' => empty($failed),
        'mode' => $baseline ? 'baseline' : ($force ? 'force' : 'apply'),
        'migrations' => $report,
    ],
    empty($failed) ? 200 : 500,
);
