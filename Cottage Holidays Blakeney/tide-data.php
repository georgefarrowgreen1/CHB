<?php
// ============================================================
//  tide-data.php — shared tide-extremes fetch for Blakeney, used by the public
//  endpoint (tides.php) and the in-stay tide push (tide-push.php).
//
//  tide_extremes($start, $days) -> ['ok'=>true, 'extremes'=>[{time,type,height}], 'cached'=>?]
//                               or ['ok'=>false, 'reason'=>'no_key'|'fetch_failed']
//
//  Uses the owner-pasted WorldTides key (content key `apikey-tides`, encrypted)
//  and caches results in tide_cache (~12h) to respect the free quota.
// ============================================================
require_once __DIR__ . '/db.php';

if (!function_exists('tide_extremes')) {
    function tide_extremes($start = null, $days = 2) {
        $BLAKENEY_LAT = 52.9536;
        $BLAKENEY_LON = 1.0206;

        $key = content_value('apikey-tides');
        if ($key === '') return ['ok' => false, 'reason' => 'no_key'];

        $start = (is_string($start) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $start)) ? $start : gmdate('Y-m-d');
        $days  = max(1, min(14, (int)$days));
        $cacheKey = "tides-$start-$days";

        // Cache hit (fresh < 12h)
        try {
            $s = db()->prepare('SELECT payload, updated_at FROM tide_cache WHERE cache_key = ?');
            $s->execute([$cacheKey]);
            $row = $s->fetch();
            if ($row && (time() - strtotime($row['updated_at']) < 43200)) {
                $d = json_decode($row['payload'], true);
                if (is_array($d)) return ['ok' => true, 'extremes' => $d, 'cached' => true];
            }
        } catch (\Throwable $e) { /* table not migrated yet — fetch live */ }

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
                'time'   => $e['date'] ?? null,
                'type'   => $e['type'] ?? '',
                'height' => round((float)($e['height'] ?? 0), 2),
            ], $j['extremes']);
            try {
                db()->prepare('INSERT INTO tide_cache (cache_key, payload, updated_at) VALUES (?,?,NOW())
                               ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = NOW()')
                    ->execute([$cacheKey, json_encode($extremes)]);
            } catch (\Throwable $e) {}
            return ['ok' => true, 'extremes' => $extremes];
        }

        return ['ok' => false, 'reason' => 'fetch_failed'];
    }
}
