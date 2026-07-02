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
require_once __DIR__ . '/db.php';

$in = body();
$action = $_GET['action'] ?? ($in['action'] ?? '');
$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string)$_GET['cron']);

$dir = __DIR__ . '/backups';

// ---- Build one INSERT-complete SQL dump of every table ----
function chb_dump_sql() {
    $pdo = db();
    $out = "-- Cottage Holidays Blakeney database backup\n-- Created " . date('c') . "\n"
         . "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n";
    $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tables as $t) {
        $tq = '`' . str_replace('`', '``', $t) . '`';
        $create = $pdo->query("SHOW CREATE TABLE {$tq}")->fetch();
        $createSql = $create['Create Table'] ?? (array_values($create)[1] ?? '');
        if ($createSql === '') continue;   // e.g. a VIEW — skip rather than break restore
        $out .= "DROP TABLE IF EXISTS {$tq};\n{$createSql};\n";
        $st = $pdo->query("SELECT * FROM {$tq}");
        $cols = null; $batch = [];
        while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
            if ($cols === null) $cols = '(`' . implode('`,`', array_map(fn($c) => str_replace('`', '``', $c), array_keys($row))) . '`)';
            $vals = array_map(fn($v) => $v === null ? 'NULL' : $pdo->quote((string)$v), array_values($row));
            $batch[] = '(' . implode(',', $vals) . ')';
            if (count($batch) >= 200) { $out .= "INSERT INTO {$tq} {$cols} VALUES\n" . implode(",\n", $batch) . ";\n"; $batch = []; }
        }
        if ($batch) $out .= "INSERT INTO {$tq} {$cols} VALUES\n" . implode(",\n", $batch) . ";\n";
        $out .= "\n";
    }
    return $out . "SET FOREIGN_KEY_CHECKS=1;\n";
}

// ---- Write the gzipped dump into backups/, rotating out the oldest ----
function chb_backup_write($dir) {
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    // Self-heal the deny-all guard even if the folder was created by hand.
    $ht = $dir . '/.htaccess';
    if (!is_file($ht)) @file_put_contents($ht, "Require all denied\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\nOptions -Indexes\n");
    $sql = chb_dump_sql();
    $file = $dir . '/chb-backup-' . date('Ymd-His') . '.sql.gz';
    if (@file_put_contents($file, gzencode($sql, 9)) === false) {
        return ['ok' => false, 'error' => 'Could not write to backups/ — check folder permissions.'];
    }
    // Keep the newest 8.
    $all = glob($dir . '/chb-backup-*.sql.gz') ?: [];
    sort($all);
    while (count($all) > 8) { @unlink(array_shift($all)); }
    return ['ok' => true, 'file' => $file, 'bytes' => filesize($file)];
}

function chb_backup_latest($dir) {
    $all = glob($dir . '/chb-backup-*.sql.gz') ?: [];
    sort($all);
    return $all ? end($all) : null;
}

// ---- Admin: stream the newest dump for download ----
if ($action === 'download') {
    require_admin();
    $f = chb_backup_latest($dir);
    if (!$f) json_out(['error' => 'No backup stored yet — run one from Health check first.'], 404);
    header('Content-Type: application/gzip');
    header('Content-Disposition: attachment; filename="' . basename($f) . '"');
    header('Content-Length: ' . filesize($f));
    readfile($f);
    exit;
}

// ---- Admin: list what's stored ----
if ($action === 'status') {
    require_admin();
    $files = array_map(fn($f) => ['file' => basename($f), 'bytes' => filesize($f), 'at' => date('Y-m-d H:i', filemtime($f))],
                       array_reverse(glob($dir . '/chb-backup-*.sql.gz') ?: []));
    json_out(['ok' => true, 'backups' => array_slice($files, 0, 8)]);
}

// ---- Run a backup: cron (weekly gate) or admin (forced) ----
if (!$isCron && empty($_SESSION['admin_id'])) json_out(['error' => 'Not authorised'], 401);
$force = ($action === 'run') || !empty($_GET['force']);

// Cron path: Mondays only, once per ISO week (cron.php pings daily).
$week = date('o-\WW');
if (!$force) {
    if ((int)date('N') !== 1) json_out(['ok' => true, 'ran' => false, 'reason' => 'runs on Mondays']);
    if (content_value('backup-last-week') === $week) json_out(['ok' => true, 'ran' => false, 'reason' => 'already ran this week']);
}

$res = chb_backup_write($dir);
if (empty($res['ok'])) json_out(['ok' => false, 'error' => $res['error'] ?? 'Backup failed'], 500);

try {
    db()->prepare("INSERT INTO content (item_key, item_value) VALUES ('backup-last-week', ?)
                   ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP")
        ->execute([json_encode($week)]);
} catch (\Throwable $e) {}

// Email the dump to the owner so a copy lives off the host (best-effort; the
// stored copy above already succeeded). Attachments cap out well below what
// this database produces, but guard anyway.
$emailed = false; $emailErr = null;
try {
    if (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL && $res['bytes'] < 8 * 1024 * 1024) {
        require_once __DIR__ . '/mailer.php';
        $nice = number_format($res['bytes'] / 1024, 0) . ' KB';
        $r = smtp_send(OWNER_NOTIFY_EMAIL, 'Owner',
            'Weekly database backup — Cottage Holidays Blakeney',
            "Attached is this week's database backup ({$nice}).\n\nKeep a few of these somewhere safe (they contain all bookings, payments and guest details). To restore, unzip and import the .sql via your host's phpMyAdmin.",
            null,
            [['filename' => basename($res['file']), 'mime' => 'application/gzip', 'content' => file_get_contents($res['file'])]]
        );
        $emailed = !empty($r['ok']); $emailErr = $r['error'] ?? null;
    }
} catch (\Throwable $e) { $emailErr = $e->getMessage(); }

json_out(['ok' => true, 'ran' => true, 'file' => basename($res['file']), 'bytes' => $res['bytes'], 'emailed' => $emailed, 'email_error' => $emailErr]);
