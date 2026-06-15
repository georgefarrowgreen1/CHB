<?php
// ============================================================
//  track.php — built-in, first-party, cookie-free page-view analytics.
//
//  PUBLIC:  POST {path, prop, ref}
//      -> records one page view. No cookies. No raw IP/UA stored — only a
//         salted one-way hash so unique visitors can be estimated. Owner
//         (logged-in admin) views are NOT counted. Lightly rate-limited.
//
//  ADMIN:   GET ?action=summary&days=30   (logged-in admin)
//      -> { totalViews, uniqueVisitors, daily:[{date,views}],
//           topReferrers:[{host,count}], byCottage:[{prop_key,views}] }
//
//  The pageviews table is created by migration-pageviews.sql (via migrate.php).
// ============================================================
require_once __DIR__ . '/db.php';

// A salted one-way fingerprint of the visitor (never stored in the clear).
function pv_ip_hash() {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $salt = defined('APP_SECRET') ? APP_SECRET : 'chb';
    return hash('sha256', $ip . '|' . $ua . '|' . $salt);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ---- Admin summary ----
if ($method === 'GET' && ($_GET['action'] ?? '') === 'summary') {
    require_admin();
    $days = max(1, min(365, (int)($_GET['days'] ?? 30)));
    try {
        // Opportunistic retention: keep ~180 days of raw rows.
        db()->exec('DELETE FROM pageviews WHERE created_at < (NOW() - INTERVAL 180 DAY)');

        $since = "(NOW() - INTERVAL $days DAY)";
        $total = (int)db()->query("SELECT COUNT(*) FROM pageviews WHERE created_at >= $since")->fetchColumn();
        $uniq  = (int)db()->query("SELECT COUNT(DISTINCT ip_hash) FROM pageviews WHERE created_at >= $since")->fetchColumn();

        // Last 7 days ("this week") — counted independently of the $days window.
        $weekViews  = (int)db()->query("SELECT COUNT(*) FROM pageviews WHERE created_at >= (NOW() - INTERVAL 7 DAY)")->fetchColumn();
        $weekUnique = (int)db()->query("SELECT COUNT(DISTINCT ip_hash) FROM pageviews WHERE created_at >= (NOW() - INTERVAL 7 DAY)")->fetchColumn();

        $daily = db()->query("SELECT DATE(created_at) d, COUNT(*) c FROM pageviews
                              WHERE created_at >= $since GROUP BY DATE(created_at) ORDER BY d ASC")->fetchAll();
        $refs = db()->query("SELECT referrer_host h, COUNT(*) c FROM pageviews
                             WHERE created_at >= $since AND referrer_host IS NOT NULL AND referrer_host <> ''
                             GROUP BY referrer_host ORDER BY c DESC LIMIT 8")->fetchAll();
        $byProp = db()->query("SELECT prop_key p, COUNT(*) c FROM pageviews
                               WHERE created_at >= $since AND prop_key IS NOT NULL AND prop_key <> ''
                               GROUP BY prop_key ORDER BY c DESC")->fetchAll();

        json_out([
            'ok' => true,
            'days' => $days,
            'totalViews' => $total,
            'uniqueVisitors' => $uniq,
            'weekViews' => $weekViews,
            'weekUnique' => $weekUnique,
            'daily' => array_map(fn($r) => ['date' => $r['d'], 'views' => (int)$r['c']], $daily),
            'topReferrers' => array_map(fn($r) => ['host' => $r['h'], 'count' => (int)$r['c']], $refs),
            'byCottage' => array_map(fn($r) => ['prop_key' => $r['p'], 'views' => (int)$r['c']], $byProp),
        ]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Analytics not ready — has migration-pageviews.sql been run?'], 500);
    }
}

// ---- Public: record a view ----
if ($method === 'POST') {
    // Never count the owner's own browsing.
    if (!empty($_SESSION['admin_id'])) json_out(['ok' => true]);

    $in = body();
    $path = clean($in['path'] ?? '/');
    $path = substr(preg_replace('/[?#].*$/', '', $path), 0, 255);   // drop query/hash, cap length
    if ($path === '') $path = '/';
    $prop = preg_replace('/[^a-z0-9_]/i', '', (string)($in['prop'] ?? ''));
    $prop = $prop === '' ? null : substr($prop, 0, 32);

    // Referrer: bare host only (no path/query), and never our own domain.
    $refHost = null;
    $ref = (string)($in['ref'] ?? ($_SERVER['HTTP_REFERER'] ?? ''));
    if ($ref !== '') {
        $h = parse_url($ref, PHP_URL_HOST);
        if ($h) {
            $h = strtolower(preg_replace('/^www\./', '', $h));
            $self = strtolower(preg_replace('/^www\./', '', (string)parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST)));
            if ($h !== $self) $refHost = substr($h, 0, 190);
        }
    }

    $ipHash = pv_ip_hash();

    try {
        // Light rate-limit: at most ~60 recorded views per visitor per minute.
        $rl = db()->prepare('SELECT COUNT(*) FROM pageviews WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL 1 MINUTE)');
        $rl->execute([$ipHash]);
        if ((int)$rl->fetchColumn() < 60) {
            db()->prepare('INSERT INTO pageviews (prop_key, path, referrer_host, ip_hash) VALUES (?,?,?,?)')
                ->execute([$prop, $path, $refHost, $ipHash]);
        }
    } catch (\Throwable $e) { /* analytics must never break the page */ }

    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
