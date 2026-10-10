<?php
// ============================================================
//  tides.php — high/low tide times for Blakeney, for the cottage-page widget
//  and the trip planner. Public GET (tide data isn't sensitive).
//
//    GET ?start=YYYY-MM-DD&days=1..14  -> { ok, extremes:[{time,type,height}] }
//
//  The fetch + caching live in tide-data.php.
//  Degrades gracefully: { ok:false, reason } when no key / fetch fails.
// ============================================================
require_once __DIR__ . '/tide-data.php';
header('Content-Type: application/json; charset=utf-8');
// private: this response can carry the visitor's session cookie, which a shared
// cache must never store and hand to someone else. The browser still caches it.
header('Cache-Control: private, max-age=1800');

// Public, and each cache miss spends paid credits: a per-visitor ceiling
// (generous — a page asks once or twice) on top of the date clamp in tide-data.
if (function_exists('rate_limit')) {
    rate_limit('tides', 60, 10);
}
$start = $_GET['start'] ?? null;
$days = $_GET['days'] ?? 2;
echo json_encode(tide_extremes($start, $days));
