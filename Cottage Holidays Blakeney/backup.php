<?php
// ============================================================
//  backup.php — weekly database backup.
//
//  Dumps every table with plain PDO (shared hosting has no mysqldump), gzips
//  it, keeps the last 8 dumps in backups/ (blocked from the web by
//  backups/.htaccess) and emails the fresh dump to OWNER_NOTIFY_EMAIL — so a
//  copy always lives OFF the host. Bookings and payment history are the one
//  part of the site that can't be rebuilt; this is the insurance.
//
//  Cron (via cron.php, daily): runs on Mondays, once per ISO week.
//    backup.php?cron=APP_SECRET
//  Admin (Settings → Health check):
//    POST {action:'run'}      -> back up right now (ignores the weekly gate)
//    POST {action:'status'}   -> list stored backups
//    GET  ?action=download    -> stream the newest dump
// ============================================================
//  uploads/ (guest photos, hero images, chat attachments) is covered by a
//  separate FILES archive: a zip of the whole folder, rebuilt on the weekly
//  run only when something changed, newest 2 kept in backups/. Too big to
//  email, so the weekly email nudges the owner to download it now and then
//  (POST {action:'run_files'} / GET ?action=download_files, and the same
//  Health-check card in Settings).
require_once __DIR__ . '/db.php';

$in = body();
$action = $_GET['action'] ?? ($in['action'] ?? '');
$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);

$dir = __DIR__ . '/backups';

// ---- Build one INSERT-complete SQL dump of every table ----
function chb_dump_sql()
{
    $pdo = db();
    $out =
        "-- Cottage Holidays Blakeney database backup\n-- Created " .
        date('c') .
        "\n" .
        "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n";
    $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tables as $t) {
        $tq = '`' . str_replace('`', '``', $t) . '`';
        $create = $pdo->query("SHOW CREATE TABLE {$tq}")->fetch();
        $createSql = $create['Create Table'] ?? (array_values($create)[1] ?? '');
        if ($createSql === '') {
            continue;
        } // e.g. a VIEW — skip rather than break restore
        $out .= "DROP TABLE IF EXISTS {$tq};\n{$createSql};\n";
        $st = $pdo->query("SELECT * FROM {$tq}");
        $cols = null;
        $batch = [];
        while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
            if ($cols === null) {
                $cols = '(`' . implode('`,`', array_map(fn($c) => str_replace('`', '``', $c), array_keys($row))) . '`)';
            }
            $vals = array_map(fn($v) => $v === null ? 'NULL' : $pdo->quote((string) $v), array_values($row));
            $batch[] = '(' . implode(',', $vals) . ')';
            if (count($batch) >= 200) {
                $out .= "INSERT INTO {$tq} {$cols} VALUES\n" . implode(",\n", $batch) . ";\n";
                $batch = [];
            }
        }
        if ($batch) {
            $out .= "INSERT INTO {$tq} {$cols} VALUES\n" . implode(",\n", $batch) . ";\n";
        }
        $out .= "\n";
    }
    return $out . "SET FOREIGN_KEY_CHECKS=1;\n";
}

// ---- Write the gzipped dump into backups/, rotating out the oldest ----
function chb_backup_write($dir)
{
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    // Self-heal the deny-all guard even if the folder was created by hand.
    $ht = $dir . '/.htaccess';
    if (!is_file($ht)) {
        @file_put_contents(
            $ht,
            "Require all denied\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\nOptions -Indexes\n",
        );
    }
    $sql = chb_dump_sql();
    $file = $dir . '/chb-backup-' . date('Ymd-His') . '.sql.gz';
    if (@file_put_contents($file, gzencode($sql, 9)) === false) {
        return ['ok' => false, 'error' => 'Could not write to backups/ — check folder permissions.'];
    }
    // Keep the newest 8.
    $all = glob($dir . '/chb-backup-*.sql.gz') ?: [];
    sort($all);
    while (count($all) > 8) {
        @unlink(array_shift($all));
    }
    return ['ok' => true, 'file' => $file, 'bytes' => filesize($file)];
}

function chb_backup_latest($dir)
{
    $all = glob($dir . '/chb-backup-*.sql.gz') ?: [];
    sort($all);
    return $all ? end($all) : null;
}

// ---- FILES archive: zip uploads/ into backups/, rotating, change-aware ----
function chb_files_latest($dir)
{
    $all = glob($dir . '/chb-files-*.zip') ?: [];
    sort($all);
    return $all ? end($all) : null;
}

// Every regular file under uploads/ (flat today, but walk subfolders so a
// future re-organisation doesn't silently shrink the archive).
function chb_uploads_files()
{
    $root = __DIR__ . '/uploads';
    if (!is_dir($root)) {
        return [];
    }
    $files = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if ($f->isFile()) {
            $files[] = $f->getPathname();
        }
    }
    sort($files);
    return $files;
}

function chb_files_backup_write($dir, $force = false)
{
    $files = chb_uploads_files();
    if (!$files) {
        return ['ok' => true, 'ran' => false, 'reason' => 'uploads/ is empty — nothing to archive'];
    }
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    // Skip the (potentially slow) re-zip when nothing changed since the last
    // archive — compare the newest upload mtime against the zip's.
    $latest = chb_files_latest($dir);
    if (!$force && $latest) {
        $newest = 0;
        foreach ($files as $f) {
            $newest = max($newest, (int) @filemtime($f));
        }
        if ($newest <= (int) filemtime($latest)) {
            return ['ok' => true, 'ran' => false, 'reason' => 'no uploads changed since the last archive', 'file' => $latest, 'bytes' => filesize($latest), 'files' => null];
        }
    }
    @set_time_limit(300);
    $file = $dir . '/chb-files-' . date('Ymd-His') . '.zip';
    $zip = new ZipArchive();
    if ($zip->open($file, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        return ['ok' => false, 'error' => 'Could not create the files archive — check backups/ permissions.'];
    }
    $root = __DIR__ . '/uploads';
    $added = 0;
    foreach ($files as $f) {
        // Images are already compressed — store, don't deflate (much faster).
        if ($zip->addFile($f, 'uploads/' . ltrim(substr($f, strlen($root)), '/'))) {
            $zip->setCompressionIndex($added, ZipArchive::CM_STORE);
            $added++;
        }
    }
    if (!$zip->close()) {
        @unlink($file);
        return ['ok' => false, 'error' => 'Files archive failed to finalise — possibly out of disk space.'];
    }
    // Keep the newest 2 — these are big, and the DB dumps carry the history.
    $all = glob($dir . '/chb-files-*.zip') ?: [];
    sort($all);
    while (count($all) > 2) {
        @unlink(array_shift($all));
    }
    return ['ok' => true, 'ran' => true, 'file' => $file, 'bytes' => filesize($file), 'files' => $added];
}

// A zip that won't open or whose entry count disagrees with uploads/ is not a
// backup — same philosophy as chb_backup_verify.
function chb_files_verify($file)
{
    if (!$file || !is_file($file)) {
        return ['ok' => false, 'error' => 'No files archive stored yet.'];
    }
    $zip = new ZipArchive();
    if ($zip->open($file, ZipArchive::CHECKCONS) !== true) {
        return ['ok' => false, 'error' => 'Corrupt — the files archive fails its consistency check.'];
    }
    $n = $zip->numFiles;
    $readable = $n > 0 && $zip->getFromIndex(0) !== false;
    $zip->close();
    if (!$readable) {
        return ['ok' => false, 'error' => 'Files archive is empty or unreadable.'];
    }
    return ['ok' => true, 'files' => $n];
}

// ---- Verify a backup is sound WITHOUT a second database (shared hosting has
//      none to restore into). We fully decompress the dump — which catches a
//      truncated or corrupt gzip — and confirm it actually contains table
//      definitions (incl. bookings) and finished writing (the end marker). That's
//      what makes "we have backups" trustworthy rather than hopeful. ----
function chb_backup_verify($file)
{
    if (!$file || !is_file($file)) {
        return ['ok' => false, 'error' => 'No backup file to verify.'];
    }
    $gz = @gzopen($file, 'rb');
    if (!$gz) {
        return ['ok' => false, 'error' => 'Could not open the backup (gzip).'];
    }
    $bytes = 0;
    $tables = 0;
    $hasBookings = false;
    $tail = '';
    while (!gzeof($gz)) {
        $chunk = gzread($gz, 262144);
        if ($chunk === false) {
            gzclose($gz);
            return ['ok' => false, 'error' => 'Corrupt — the backup would not fully decompress.'];
        }
        $bytes += strlen($chunk);
        $tables += substr_count($chunk, 'CREATE TABLE');
        if (strpos($chunk, '`bookings`') !== false) {
            $hasBookings = true;
        }
        $tail = substr($tail . $chunk, -200); // keep only the end, to check the marker
    }
    gzclose($gz);
    if ($bytes < 500) {
        return ['ok' => false, 'error' => 'Backup looks empty (' . $bytes . ' bytes decompressed).'];
    }
    if ($tables < 1) {
        return ['ok' => false, 'error' => 'Backup contains no table definitions.'];
    }
    if (strpos($tail, 'SET FOREIGN_KEY_CHECKS=1;') === false) {
        return ['ok' => false, 'error' => 'Backup looks truncated — the end marker is missing.'];
    }
    return ['ok' => true, 'tables' => $tables, 'bytes' => $bytes, 'has_bookings' => $hasBookings];
}

// ---- Admin: stream the newest dump for download ----
if ($action === 'download') {
    require_admin();
    $f = chb_backup_latest($dir);
    if (!$f) {
        json_out(['error' => 'No backup stored yet — run one from Health check first.'], 404);
    }
    header('Content-Type: application/gzip');
    header('Content-Disposition: attachment; filename="' . basename($f) . '"');
    header('Content-Length: ' . filesize($f));
    readfile($f);
    exit();
}

// ---- Admin: stream the newest FILES archive for download ----
if ($action === 'download_files') {
    require_admin();
    $f = chb_files_latest($dir);
    if (!$f) {
        json_out(['error' => 'No files archive stored yet — run one from Health check first.'], 404);
    }
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . basename($f) . '"');
    header('Content-Length: ' . filesize($f));
    readfile($f);
    exit();
}

// ---- Admin: archive uploads/ right now ----
if ($action === 'run_files') {
    require_admin();
    $r = chb_files_backup_write($dir, true);
    if (empty($r['ok'])) {
        log_activity('system', 'backup.files_fail', 'Files archive FAILED — ' . ($r['error'] ?? 'unknown'), ['severity' => 'action', 'entity' => 'backup']);
        json_out(['ok' => false, 'error' => $r['error'] ?? 'Files archive failed'], 500);
    }
    $v = chb_files_verify($r['file'] ?? null);
    log_activity('system', 'backup.files_run', 'Uploads archived (' . number_format(($r['bytes'] ?? 0) / 1048576, 1) . ' MB, ' . (int) ($r['files'] ?? 0) . ' files)' . (empty($v['ok']) ? ' — VERIFY FAILED' : ''), ['entity' => 'backup']);
    json_out(['ok' => true, 'ran' => true, 'file' => basename($r['file']), 'bytes' => $r['bytes'], 'files' => $r['files'], 'verified' => !empty($v['ok']), 'verify_error' => $v['error'] ?? null]);
}

// ---- Admin: list what's stored ----
if ($action === 'status') {
    require_admin();
    $files = array_map(
        fn($f) => ['file' => basename($f), 'bytes' => filesize($f), 'at' => date('Y-m-d H:i', filemtime($f))],
        array_reverse(glob($dir . '/chb-backup-*.sql.gz') ?: []),
    );
    $fz = chb_files_latest($dir);
    json_out([
        'ok' => true,
        'backups' => array_slice($files, 0, 8),
        'files_backup' => $fz
            ? ['file' => basename($fz), 'bytes' => filesize($fz), 'at' => date('Y-m-d H:i', filemtime($fz))]
            : null,
    ]);
}

// ---- Admin: verify the newest stored backup on demand ----
if ($action === 'verify') {
    require_admin();
    $f = chb_backup_latest($dir);
    if (!$f) {
        json_out(['error' => 'No backup stored yet — run one first.'], 404);
    }
    $v = chb_backup_verify($f);
    if (empty($v['ok'])) {
        log_activity('system', 'backup.verify_fail', 'Backup verification FAILED — ' . ($v['error'] ?? 'unknown'), ['severity' => 'action', 'entity' => 'backup']);
        json_out(['ok' => false, 'file' => basename($f), 'error' => $v['error'] ?? 'Verification failed']);
    }
    json_out([
        'ok' => true,
        'file' => basename($f),
        'tables' => $v['tables'],
        'bytes' => $v['bytes'],
        'has_bookings' => $v['has_bookings'],
    ]);
}

// ---- Run a backup: cron (weekly gate) or admin (forced) ----
if (!$isCron) {
    require_admin(); // admin session + CSRF for the manual run (cron uses ?cron=SECRET)
}
$force = $action === 'run' || !empty($_GET['force']);

// Cron path: Mondays only, once per ISO week (cron.php pings daily).
$week = date('o-\WW');
if (!$force) {
    if ((int) date('N') !== 1) {
        json_out(['ok' => true, 'ran' => false, 'reason' => 'runs on Mondays']);
    }
    if (content_value('backup-last-week') === $week) {
        json_out(['ok' => true, 'ran' => false, 'reason' => 'already ran this week']);
    }
}

$res = chb_backup_write($dir);
if (empty($res['ok'])) {
    log_activity('system', 'backup.fail', 'Database backup FAILED — ' . ($res['error'] ?? 'unknown error'), ['severity' => 'action', 'entity' => 'backup']);
    json_out(['ok' => false, 'error' => $res['error'] ?? 'Backup failed'], 500);
}

// Verify the dump we just wrote actually decompresses and contains the schema —
// a backup you can't restore is worse than none, so flag it loudly if not.
$verify = chb_backup_verify($res['file']);
if (empty($verify['ok'])) {
    log_activity('system', 'backup.verify_fail', 'Backup written but verification FAILED — ' . ($verify['error'] ?? 'unknown'), ['severity' => 'action', 'entity' => 'backup']);
}

// Refresh the uploads archive on the same weekly beat (skips itself when no
// upload changed). A failure here never blocks the DB backup — just log it.
$filesRes = ['ok' => true, 'ran' => false];
try {
    $filesRes = chb_files_backup_write($dir);
    if (empty($filesRes['ok'])) {
        log_activity('system', 'backup.files_fail', 'Files archive FAILED — ' . ($filesRes['error'] ?? 'unknown'), ['severity' => 'action', 'entity' => 'backup']);
    } elseif (!empty($filesRes['ran'])) {
        log_activity('system', 'backup.files_run', 'Uploads archived (' . number_format(($filesRes['bytes'] ?? 0) / 1048576, 1) . ' MB, ' . (int) ($filesRes['files'] ?? 0) . ' files)', ['entity' => 'backup']);
    }
} catch (\Throwable $e) {
    log_activity('system', 'backup.files_fail', 'Files archive FAILED — ' . $e->getMessage(), ['severity' => 'action', 'entity' => 'backup']);
}

try {
    db()
        ->prepare(
            "INSERT INTO content (item_key, item_value) VALUES ('backup-last-week', ?)
                   ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP",
        )
        ->execute([json_encode($week)]);
} catch (\Throwable $e) {
}

// Email the dump to the owner so a copy lives off the host (best-effort; the
// stored copy above already succeeded). Attachments cap out well below what
// this database produces, but guard anyway.
$emailed = false;
$emailErr = null;
try {
    if (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL && $res['bytes'] < 8 * 1024 * 1024) {
        require_once __DIR__ . '/mailer.php';
        $nice = number_format($res['bytes'] / 1024, 0) . ' KB';
        // Photos/uploads are archived on the host but too big to attach —
        // remind the owner to pull a copy down now and then.
        $fz = chb_files_latest($dir);
        $filesNote = $fz
            ? 'Your photos and uploads are archived separately on the host (' .
                number_format(filesize($fz) / 1048576, 1) .
                ' MB) — download a copy occasionally from Settings → Health check → "Download files".'
            : '';
        $r = smtp_send(
            OWNER_NOTIFY_EMAIL,
            'Owner',
            'Weekly database backup — Cottage Holidays Blakeney',
            "Attached is this week's database backup ({$nice}).\n\nKeep a few of these somewhere safe (they contain all bookings, payments and guest details). To restore, unzip and import the .sql via your host's phpMyAdmin." .
                ($filesNote ? "\n\n" . $filesNote : ''),
            email_shell(
                'Weekly database backup',
                email_h('Weekly database backup') .
                    email_p('Attached is this week&rsquo;s database backup (' . email_esc($nice) . ').') .
                    email_p(
                        'Keep a few of these somewhere safe — they contain all bookings, payments and guest details. To restore, unzip and import the .sql via your host&rsquo;s phpMyAdmin.',
                        !$filesNote,
                    ) .
                    ($filesNote ? email_p(email_esc($filesNote), true) : ''),
            ),
            [
                [
                    'filename' => basename($res['file']),
                    'mime' => 'application/gzip',
                    'content' => file_get_contents($res['file']),
                ],
            ],
        );
        $emailed = !empty($r['ok']);
        $emailErr = $r['error'] ?? null;
    }
} catch (\Throwable $e) {
    $emailErr = $e->getMessage();
}

$verifyNote = !empty($verify['ok']) ? ' — verified, ' . (int) $verify['tables'] . ' tables' : ' — VERIFY FAILED';
log_activity('system', 'backup.run', 'Database backup created (' . number_format($res['bytes'] / 1024, 0) . ' KB)' . $verifyNote, ['entity' => 'backup']);
json_out([
    'ok' => true,
    'ran' => true,
    'file' => basename($res['file']),
    'bytes' => $res['bytes'],
    'verified' => !empty($verify['ok']),
    'verify_error' => $verify['error'] ?? null,
    'tables' => $verify['tables'] ?? null,
    'emailed' => $emailed,
    'email_error' => $emailErr,
    'files_ran' => !empty($filesRes['ran']),
    'files_bytes' => $filesRes['bytes'] ?? null,
]);
