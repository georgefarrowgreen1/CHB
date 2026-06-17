<?php
// ============================================================
//  version.php — reports the currently-deployed BUILD id (read from app.js, where
//  `const BUILD` now lives — it used to be inline in index.html). The app polls
//  this so a signed-in admin's open page can auto-refresh to a new release without
//  clicking anything. No auth (a build id isn't sensitive).
// ============================================================
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

$build = '';
// BUILD lives in app.js; fall back to index.html for older deploys.
foreach (['/app.js', '/index.html'] as $f) {
    $src = @file_get_contents(__DIR__ . $f);
    if ($src !== false && preg_match("/const BUILD = '([^']+)'/", $src, $m)) { $build = $m[1]; break; }
}
echo json_encode(['build' => $build]);
