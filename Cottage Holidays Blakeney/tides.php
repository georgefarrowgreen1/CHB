<?php
// ============================================================
//  tides.php — high/low tide times for Blakeney, for the cottage-page widget
//  and the trip planner. Public GET (tide data isn't sensitive).
//
//    GET ?start=YYYY-MM-DD&days=1..14  -> { ok, extremes:[{time,type,height}] }
//
//  The fetch + caching live in tide-data.php (shared with tide-push.php).
//  Degrades gracefully: { ok:false, reason } when no key / fetch fails.
// ============================================================
require_once __DIR__ . '/tide-data.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=1800');

$start = $_GET['start'] ?? null;
$days  = $_GET['days'] ?? 2;
echo json_encode(tide_extremes($start, $days));
