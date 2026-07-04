<?php
// ============================================================
//  webp-backfill.php — admin: generate WebP companions for EXISTING uploads.
//
//  New uploads already get an optimised .webp next to them (image-save.php).
//  This backfills photos uploaded before that, or where the server's GD lacked
//  WebP at the time — so the .htaccess WebP negotiation serves the smaller file
//  for every image, not just future ones. Idempotent: files that already have a
//  .webp are skipped, so it's safe to re-run. Processes in batches to avoid
//  timeouts on large libraries — re-run until `remaining` is 0.
//
//  POST (admin session) -> { ok, webp_supported, scanned, created, skipped, failed, remaining }
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/image-save.php'; // make_webp_copy()

require_admin();

$res = [
    'ok' => true,
    'webp_supported' => function_exists('imagewebp'),
    'scanned' => 0,
    'created' => 0,
    'skipped' => 0,
    'failed' => 0,
    'remaining' => 0,
];

if (!$res['webp_supported']) {
    $res['ok'] = false;
    $res['error'] = "This server's PHP (GD) has no WebP support, so companions can't be generated.";
    json_out($res);
}

$dir = __DIR__ . '/uploads';
if (!is_dir($dir)) {
    json_out($res);
}

@set_time_limit(120);
$batch = 400; // cap work per call; re-run to finish a large library
$files = glob($dir . '/*.{jpg,jpeg,png,JPG,JPEG,PNG}', GLOB_BRACE) ?: [];

foreach ($files as $path) {
    $res['scanned']++;
    if (is_file($path . '.webp')) {
        $res['skipped']++;
        continue;
    } // already done
    if ($res['created'] + $res['failed'] >= $batch) {
        $res['remaining']++;
        continue;
    }
    $info = @getimagesize($path);
    if ($info === false) {
        $res['failed']++;
        continue;
    }
    $type = $info[2];
    if ($type !== IMAGETYPE_JPEG && $type !== IMAGETYPE_PNG) {
        $res['skipped']++;
        continue;
    }
    if (make_webp_copy($path, $type, $path . '.webp')) {
        $res['created']++;
    } else {
        $res['failed']++;
    }
}

json_out($res);
