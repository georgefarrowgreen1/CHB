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
//
//  split_sql() / is_idempotent_error() below are PURE (declared unconditionally,
//  so PHP hoists them); the request bootstrap only runs when this file IS the
//  request, letting test-migrate.php unit-test the SQL splitter without a DB.
// ============================================================

// ---- Bootstrap: only when this file IS the request (not when unit-tested) ----
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'migrate.php') {
    // still expose the pure helpers (hoisted) to the includer, then stop.
    return;
}

require_once __DIR__ . '/db.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron) {
    // A signed-in admin's manual run must be a POST so require_admin() enforces the
    // CSRF token — a cross-site GET link in the owner's browser must not be able to
    // fire this job via their session (same guard as cron.php / self-repair.php).
    require_admin();
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        json_out(['error' => 'Run this from the back office, or use the cron URL with your secret.'], 405);
    }
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

// The ledger is ALWAYS read, even under force. Without force it decides what
// runs at all; WITH force it decides which files are re-runs, which is what
// makes the data-backfill rule below possible.
$ledger = [];
try {
    foreach (db()->query('SELECT filename FROM schema_migrations')->fetchAll() as $r) {
        $ledger[$r['filename']] = true;
    }
} catch (\Throwable $e) {
}
$applied = $force ? [] : $ledger;

$files = migration_sort(glob(__DIR__ . '/migration-*.sql'));

// Split a .sql file into individual statements. Strips full-line comments up
// front, then walks the SQL splitting on ';' — but only OUTSIDE string literals /
// quoted identifiers AND outside inline '-- ' / '#' comments, so a semicolon that
// appears inside seed text ("...sail daily; check tide times...") or an inline
// column comment ("-- checkout + 12 months; purged after") doesn't chop a
// statement in half. Handles '' / "" doubling and backslash escapes.
// Apply order for migration files. The legacy names (migration-<word>… /
// migration-zz*…) predate a numbering convention and rely on plain byte order —
// they keep EXACTLY that order, first. NEW migrations use a numeric prefix
// (migration-NNN-<slug>.sql, NNN ≥ 100 — see smoke-test.js's naming gate) and
// run AFTER all legacy files in numeric order, so on a fresh database a new
// ALTER always follows the legacy CREATE it depends on. Pure (unit-tested by
// test-migrate.php).
function migration_sort($files)
{
    usort($files, function ($a, $b) {
        $ka = migration_sort_key(basename($a));
        $kb = migration_sort_key(basename($b));
        return $ka <=> $kb;
    });
    return $files;
}
function migration_sort_key($name)
{
    if (preg_match('/^migration-(\d+)-/', $name, $m)) {
        return [1, (int) $m[1], $name];
    }
    return [0, 0, $name];
}

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
        } elseif ($ch === '-' && $i + 1 < $len && $sql[$i + 1] === '-' && ($i + 2 >= $len || ctype_space($sql[$i + 2]))) {
            // inline "-- " comment (outside quotes): skip to end of line so a
            // semicolon inside the comment can't chop the statement in half.
            while ($i + 1 < $len && $sql[$i + 1] !== "\n") {
                $i++;
            }
        } elseif ($ch === '#') {
            // inline "#" comment (outside quotes): skip to end of line.
            while ($i + 1 < $len && $sql[$i + 1] !== "\n") {
                $i++;
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
// Is this statement pure SCHEMA — safe to re-apply to a database that already
// has it? Used only to decide what a force=1 RE-RUN redoes (see the loop
// below). Deliberately an ALLOWLIST of the DDL these migrations actually use,
// so anything unrecognised — an UPDATE, an INSERT, a DELETE, or some future
// shape nobody thought about — counts as DATA and is skipped on a re-run. The
// conservative direction: skipping a statement on a re-run leaves the database
// exactly as it was, while running one wrongly can overwrite live values.
function migration_stmt_is_schema($stmt)
{
    // Strip leading comments/whitespace so the first WORD is the verb.
    $s = trim(preg_replace('/^\s*(--[^\n]*\n|\/\*.*?\*\/|\s)+/s', '', (string) $stmt));
    return (bool) preg_match('/^(CREATE|ALTER|DROP|RENAME|TRUNCATE\s+TABLE)\b/i', $s);
}
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
$pending = [];
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
    $pending[] = $path;
}

// Apply in rounds: a file that hard-errors is retried after the others, and the
// rounds repeat while they make progress. Some LEGACY files depend on a file
// that sorts after them — measured on a fresh database, migration-analytics-v2
// ALTERs the pageviews table that migration-pageviews.sql (later in byte order)
// creates — so a single alphabetical pass can never bring an empty database up.
// Production databases never hit this (they applied each file as it shipped);
// fresh installs, staging and the CI integration DB do. Numeric migrations
// (migration-NNN-*) can't need this — they always run after all legacy files.
$errored = [];
do {
    $progress = false;
    $errored = [];
    foreach ($pending as $path) {
        $name = basename($path);
        $hardError = null;
        $ran = 0;
        $skipped = 0;
        // A RE-RUN REDOES SCHEMA, NEVER DATA. force=1 exists to repair a
        // wrongly-baselined database — to make sure the TABLES and COLUMNS are
        // really there — and its safety argument is that the DDL is idempotent
        // (CREATE TABLE IF NOT EXISTS, guarded ADD COLUMN). That argument does
        // not cover the DATA backfills two migrations carry, and re-running
        // those on a live database is destructive in a way nothing announces:
        // migration-111's `UPDATE guests SET email_verified_at = NOW() WHERE
        // email_verified_at IS NULL` re-verifies every account that has since
        // registered and NOT proved its address — silently undoing the control
        // that migration exists to impose — and migration-damages-deposit's
        // `UPDATE properties SET booking_fee = 75` resets each original
        // cottage's refundable deposit to £75 over whatever the owner has since
        // set. A backfill is for the moment its migration FIRST runs; on a file
        // the ledger already records, it is skipped and counted as such.
        $isRerun = $force && isset($ledger[$name]);
        foreach (split_sql($path) as $stmt) {
            if ($isRerun && !migration_stmt_is_schema($stmt)) {
                $skipped++;
                continue;
            }
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
            // Not recorded — retried next round; already-run statements are idempotent.
            $errored[$path] = ['file' => $name, 'status' => 'ERROR', 'ran' => $ran, 'error' => $hardError];
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
        $progress = true;
    }
    $pending = array_keys($errored);
} while ($pending && $progress);
foreach ($errored as $row) {
    $report[] = $row;
}

$appliedNow = array_filter($report, fn($r) => in_array($r['status'] ?? '', ['applied', 're-applied'], true));
if ($appliedNow) {
    log_activity('system', 'migrate.run', 'Database updates applied (' . count($appliedNow) . ')', ['entity' => 'migration']);
}
$failed = array_filter($report, fn($r) => ($r['status'] ?? '') === 'ERROR');
if ($failed) {
    $first = reset($failed);
    log_activity('system', 'migrate.fail', 'Database update FAILED — ' . ($first['file'] ?? ''), ['severity' => 'action', 'entity' => 'migration', 'meta' => ['detail' => mb_substr((string) ($first['error'] ?? ''), 0, 150)]]);
}
json_out(
    [
        'ok' => empty($failed),
        'mode' => $baseline ? 'baseline' : ($force ? 'force' : 'apply'),
        'migrations' => $report,
    ],
    empty($failed) ? 200 : 500,
);
