<?php
// ============================================================
//  tides.php — high/low tide times for Blakeney, for the cottage-page widget
//  and the trip planner. Public GET (tide data isn't sensitive).
//
//    GET ?start=YYYY-MM-DD&days=1..14  -> { ok, extremes:[{time,type,height}] }
//
//  Uses a tide-extremes API keyed by the owner-pasted key stored in the
//  Settings → APIs page (content key `apikey-tides`, encrypted at rest).
//  Responses are cached (tide_cache table, ~12h) to respect the free quota.
//  Degrades gracefully: { ok:false, reason } when no key / fetch fails.
//  Default provider: WorldTides (worldtides.info). Swap PROVIDER_URL to change.
// ============================================================
require_once __DIR__ . '/db.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=1800');

$BLAKENEY_LAT = 52.9536;
$BLAKENEY_LON = 1.0206;

$key = content_value('apikey-tides');
if ($key === '') { echo json_encode(['ok' => false, 'reason' => 'no_key']); exit; }

$start = (isset($_GET['start']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['start'])) ? $_GET['start'] : gmdate('Y-m-d');
$days  = max(1, min(14, (int)($_GET['days'] ?? 2)));
$cacheKey = "tides-$start-$days";

// ---- Cache hit (fresh < 12h) ----
try {
    $s = db()->prepare('SELECT payload, updated_at FROM tide_cache WHERE cache_key = ?');
    $s->execute([$cacheKey]);
    $row = $s->fetch();
    if ($row && (time() - strtotime($row['updated_at']) < 43200)) {
        $d = json_decode($row['payload'], true);
        if (is_array($d)) { echo json_encode(['ok' => true, 'extremes' => $d, 'cached' => true]); exit; }
    }
} catch (\Throwable $e) { /* table not migrated yet — fetch live */ }

// ---- Fetch from the provider ----
$startUnix = strtotime($start . ' 00:00:00 UTC');
$length = $days * 86400;
$url = 'https://www.worldtides.info/api/v3?extremes'
     . '&lat=' . $BLAKENEY_LAT . '&lon=' . $BLAKENEY_LON
     . '&start=' . $startUnix . '&length=' . $length
     . '&key=' . urlencode($key);

$ch = curl_init($url);
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12]);
$raw = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$j = $raw ? json_decode($raw, true) : null;
if ($code === 200 && isset($j['extremes']) && is_array($j['extremes'])) {
    $extremes = array_map(fn($e) => [
        'time'   => $e['date'] ?? null,                 // ISO 8601
        'type'   => $e['type'] ?? '',                   // "High" | "Low"
        'height' => round((float)($e['height'] ?? 0), 2),
    ], $j['extremes']);
    try {
        db()->prepare('INSERT INTO tide_cache (cache_key, payload, updated_at) VALUES (?,?,NOW())
                       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = NOW()')
            ->execute([$cacheKey, json_encode($extremes)]);
    } catch (\Throwable $e) {}
    echo json_encode(['ok' => true, 'extremes' => $extremes]);
    exit;
}

echo json_encode(['ok' => false, 'reason' => 'fetch_failed']);
