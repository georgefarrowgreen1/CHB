<?php
// ============================================================
//  version.php — reports the currently-deployed BUILD id (read from index.html).
//  The app polls this so a signed-in admin's open page can auto-refresh to a new
//  release without clicking anything. No auth (a build id isn't sensitive).
// ============================================================
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

$build = '';
$html = @file_get_contents(__DIR__ . '/index.html');
if ($html !== false && preg_match("/const BUILD = '([^']+)'/", $html, $m)) {
    $build = $m[1];
}
echo json_encode(['build' => $build]);
