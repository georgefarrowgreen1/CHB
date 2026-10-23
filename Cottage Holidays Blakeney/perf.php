<?php
// ============================================================
//  perf.php — where a page sends how fast it was (app.js chbPerf, by sendBeacon).
//
//  PUBLIC POST {ttfb, fcp, lcp, shown, ready, inp, cls, land, early, pwa} — times in
//  milliseconds, layout shift x1000, any of them missing. Whose page it was (a
//  visitor, a signed-in guest or the back office) is read from the session, never
//  from the request. Nothing personal is stored (perf-lib.php). At most
//  PERF_IP_PER_HOUR samples from one address and PERF_ALL_PER_HOUR in all; past
//  either the answer is the same and nothing is kept.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/perf-lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_out(['error' => 'Send figures with a POST.'], 405);
}
$raw = (string) file_get_contents('php://input', false, null, 0, 2048);
$in = json_decode($raw, true);
$kind = !empty($_SESSION['admin_id']) ? 'o' : (!empty($_SESSION['guest_id']) ? 'g' : 'v');
$row = is_array($in) ? perf_sample_clean($in, (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), $kind) : null;
if ($row === null) {
    json_out(['error' => 'No figures in that.'], 400);
}
$all = PERF_ALL_PER_HOUR; // an hour that cannot be counted (not migrated yet) keeps nothing
try {
    $all = (int) db()->query('SELECT COUNT(*) FROM perf_samples WHERE created_at > (NOW() - INTERVAL 1 HOUR)')->fetchColumn();
} catch (\Throwable $e) {
}
if ($all < PERF_ALL_PER_HOUR && rate_allow('perf', PERF_IP_PER_HOUR, 60)) {
    perf_record($row);
}
json_out(['ok' => true]);
