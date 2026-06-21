<?php
// ============================================================
//  track.php — built-in, first-party, cookie-free analytics.
//
//  PUBLIC POST — one of:
//    {path, prop, ref, source}     -> record a page view
//    {event, prop, source}         -> record a named intent event
//                                     (book_click|enquiry_open|enquiry_submit|pay_start)
//    {search:{mode,adults,children,nights,month,check_in,results,found}}
//                                  -> record a homepage availability search
//    No cookies. No raw IP/UA stored — only a salted one-way hash so unique
//    visitors can be estimated. Owner (logged-in admin) activity is NOT counted.
//
//  ADMIN GET ?action=summary&days=30  (logged-in admin)
//    -> traffic, funnel (visitors->enquiries->bookings), in-page events,
//       channels + search engines, top pages, campaign sources, search demand.
//
//  Tables: pageviews (migration-pageviews.sql + migration-analytics-v2.sql),
//          search_log (migration-analytics-v2.sql).
// ============================================================
require_once __DIR__ . '/db.php';

// A salted one-way fingerprint of the visitor (never stored in the clear).
function pv_ip_hash() {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $salt = defined('APP_SECRET') ? APP_SECRET : 'chb';
    return hash('sha256', $ip . '|' . $ua . '|' . $salt);
}

// Coarse device class from the User-Agent (the raw UA is never stored, only this).
function pv_device() {
    $ua = strtolower((string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
    if ($ua === '') return null;
    if (preg_match('/ipad|tablet|kindle|silk|playbook|nexus 7|nexus 10/', $ua)
        || (strpos($ua, 'android') !== false && strpos($ua, 'mobile') === false)) return 'tablet';
    if (preg_match('/mobi|iphone|ipod|android|windows phone|blackberry|opera mini|iemobile/', $ua)) return 'mobile';
    return 'desktop';
}

// Classify a bare referrer host into a marketing channel + a friendly source name.
// Search engines hide the actual query terms (HTTPS referrer policy), so we can
// only name the engine, not the keywords — real keywords need Search Console.
function pv_classify_ref($host) {
    $host = strtolower((string)$host);
    $engines = ['google' => 'Google', 'bing' => 'Bing', 'duckduckgo' => 'DuckDuckGo',
        'yahoo' => 'Yahoo', 'yandex' => 'Yandex', 'ecosia' => 'Ecosia', 'brave' => 'Brave',
        'baidu' => 'Baidu', 'startpage' => 'Startpage', 'qwant' => 'Qwant', 'aol' => 'AOL'];
    foreach ($engines as $needle => $name) if (strpos($host, $needle) !== false) return ['channel' => 'Search', 'name' => $name];
    $social = ['instagram' => 'Instagram', 'facebook' => 'Facebook', 'fb.' => 'Facebook',
        't.co' => 'X / Twitter', 'twitter' => 'X / Twitter', 'x.com' => 'X / Twitter',
        'pinterest' => 'Pinterest', 'tiktok' => 'TikTok', 'linkedin' => 'LinkedIn',
        'youtube' => 'YouTube', 'reddit' => 'Reddit', 'whatsapp' => 'WhatsApp'];
    foreach ($social as $needle => $name) if (strpos($host, $needle) !== false) return ['channel' => 'Social', 'name' => $name];
    return ['channel' => 'Referral', 'name' => $host];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ---- Admin summary ----
if ($method === 'GET' && ($_GET['action'] ?? '') === 'summary') {
    require_admin();
    $days = max(1, min(365, (int)($_GET['days'] ?? 30)));
    try {
        // Opportunistic retention: keep ~180 days of raw rows.
        db()->exec('DELETE FROM pageviews WHERE created_at < (NOW() - INTERVAL 180 DAY)');
        try { db()->exec('DELETE FROM search_log WHERE created_at < (NOW() - INTERVAL 180 DAY)'); } catch (\Throwable $e) {}

        // Bind the window into every query instead of interpolating it (hygiene /
        // defence-in-depth — $days is already int-cast + clamped to 1..365 above).
        // $qDays prepares a single-placeholder query and binds $days as an int.
        $sinceSql = '(NOW() - INTERVAL ? DAY)';
        $qDays = function ($sql) use ($days) {
            $st = db()->prepare($sql);
            $st->bindValue(1, $days, PDO::PARAM_INT);
            $st->execute();
            return $st;
        };
        // Same idea for a two-window query (current vs the equal-length window before it):
        // binds the FIRST '?' as 2*days (start of the previous window) and the SECOND as days.
        $qDays2 = function ($sql) use ($days) {
            $st = db()->prepare($sql);
            $st->bindValue(1, $days * 2, PDO::PARAM_INT);
            $st->bindValue(2, $days, PDO::PARAM_INT);
            $st->execute();
            return $st;
        };
        // Page views only (event IS NULL) for all the "traffic" figures.
        $pv = "FROM pageviews WHERE event IS NULL AND created_at >= $sinceSql";
        $total = (int)$qDays("SELECT COUNT(*) $pv")->fetchColumn();
        $uniq  = (int)$qDays("SELECT COUNT(DISTINCT ip_hash) $pv")->fetchColumn();

        // The immediately preceding window of equal length, for a period-over-period delta.
        $prevWindow = "FROM pageviews WHERE event IS NULL AND created_at >= (NOW() - INTERVAL ? DAY) AND created_at < (NOW() - INTERVAL ? DAY)";
        $prevTotal  = (int)$qDays2("SELECT COUNT(*) $prevWindow")->fetchColumn();
        $prevUniq   = (int)$qDays2("SELECT COUNT(DISTINCT ip_hash) $prevWindow")->fetchColumn();

        // New vs returning: a visitor is "new" if their first-ever page view falls in the
        // window. Guarded so a query hiccup can never break the whole summary.
        $visitorMix = ['new' => 0, 'returning' => 0];
        try {
            $newN = (int)$qDays("SELECT COUNT(*) FROM (SELECT ip_hash, MIN(created_at) m FROM pageviews
                                      WHERE event IS NULL AND ip_hash IS NOT NULL GROUP BY ip_hash
                                      HAVING m >= $sinceSql) t")->fetchColumn();
            $visitorMix = ['new' => $newN, 'returning' => max(0, $uniq - $newN)];
        } catch (\Throwable $e) { /* leave the zero default */ }

        // Last 7 days ("this week") + the 7 days before that (for a trend %).
        $weekViews  = (int)db()->query("SELECT COUNT(*) FROM pageviews WHERE event IS NULL AND created_at >= (NOW() - INTERVAL 7 DAY)")->fetchColumn();
        $weekUnique = (int)db()->query("SELECT COUNT(DISTINCT ip_hash) FROM pageviews WHERE event IS NULL AND created_at >= (NOW() - INTERVAL 7 DAY)")->fetchColumn();
        $prevWeek   = (int)db()->query("SELECT COUNT(*) FROM pageviews WHERE event IS NULL AND created_at >= (NOW() - INTERVAL 14 DAY) AND created_at < (NOW() - INTERVAL 7 DAY)")->fetchColumn();

        $daily = $qDays("SELECT DATE(created_at) d, COUNT(*) c FROM pageviews
                              WHERE event IS NULL AND created_at >= $sinceSql GROUP BY DATE(created_at) ORDER BY d ASC")->fetchAll();
        $refs = $qDays("SELECT referrer_host h, COUNT(*) c FROM pageviews
                             WHERE event IS NULL AND created_at >= $sinceSql AND referrer_host IS NOT NULL AND referrer_host <> ''
                             GROUP BY referrer_host ORDER BY c DESC LIMIT 8")->fetchAll();
        $byProp = $qDays("SELECT prop_key p, COUNT(*) c FROM pageviews
                               WHERE event IS NULL AND created_at >= $sinceSql AND prop_key IS NOT NULL AND prop_key <> ''
                               GROUP BY prop_key ORDER BY c DESC")->fetchAll();

        // Top pages (by SPA path) — page views only.
        $pages = $qDays("SELECT path, COUNT(*) c FROM pageviews
                              WHERE event IS NULL AND created_at >= $sinceSql AND path <> ''
                              GROUP BY path ORDER BY c DESC LIMIT 8")->fetchAll();

        // Channels + search engines: classify every referrer'd page view.
        $allRefs = $qDays("SELECT referrer_host h, COUNT(*) c FROM pageviews
                                WHERE event IS NULL AND created_at >= $sinceSql AND referrer_host IS NOT NULL AND referrer_host <> ''
                                GROUP BY referrer_host")->fetchAll();
        $direct = (int)$qDays("SELECT COUNT(*) FROM pageviews
                                    WHERE event IS NULL AND created_at >= $sinceSql AND (referrer_host IS NULL OR referrer_host = '')")->fetchColumn();
        $channels = ['Direct' => $direct, 'Search' => 0, 'Social' => 0, 'Referral' => 0];
        $engines = [];
        foreach ($allRefs as $r) {
            $cl = pv_classify_ref($r['h']);
            $channels[$cl['channel']] += (int)$r['c'];
            if ($cl['channel'] === 'Search') $engines[$cl['name']] = ($engines[$cl['name']] ?? 0) + (int)$r['c'];
        }
        arsort($engines);
        $channelsOut = [];
        foreach ($channels as $name => $c) if ($c > 0) $channelsOut[] = ['channel' => $name, 'count' => $c];
        usort($channelsOut, fn($a, $b) => $b['count'] - $a['count']);
        $enginesOut = [];
        foreach ($engines as $name => $c) $enginesOut[] = ['name' => $name, 'count' => $c];

        // Campaign sources (utm_source).
        $sources = $qDays("SELECT source s, COUNT(*) c FROM pageviews
                                WHERE event IS NULL AND created_at >= $sinceSql AND source IS NOT NULL AND source <> ''
                                GROUP BY source ORDER BY c DESC LIMIT 8")->fetchAll();

        // In-page events (the conversion funnel within the site).
        $events = ['book_click' => 0, 'enquiry_open' => 0, 'enquiry_submit' => 0, 'pay_start' => 0];
        foreach ($qDays("SELECT event e, COUNT(*) c FROM pageviews WHERE event IS NOT NULL AND created_at >= $sinceSql GROUP BY event")->fetchAll() as $r) {
            if (isset($events[$r['e']])) $events[$r['e']] = (int)$r['c'];
        }

        // Device split (mobile / tablet / desktop) — guarded: the column may not
        // exist yet on a DB that hasn't run migration-analytics-v3.sql.
        $devices = [];
        try {
            $devices = array_map(fn($r) => ['device' => $r['d'], 'count' => (int)$r['c']],
                $qDays("SELECT device d, COUNT(*) c FROM pageviews
                             WHERE event IS NULL AND device IS NOT NULL AND created_at >= $sinceSql
                             GROUP BY device ORDER BY c DESC")->fetchAll());
        } catch (\Throwable $e) { /* device column not migrated yet */ }

        // Funnel against real outcomes (enquiries + bookings in the same window).
        $enquiriesN = 0; $bookingsN = 0;
        try { $enquiriesN = (int)$qDays("SELECT COUNT(*) FROM enquiries WHERE created_at >= $sinceSql")->fetchColumn(); } catch (\Throwable $e) {}
        try { $bookingsN  = (int)$qDays("SELECT COUNT(*) FROM bookings  WHERE created_at >= $sinceSql")->fetchColumn(); } catch (\Throwable $e) {}

        // Search demand (own table; default gracefully if the migration hasn't run).
        $searchDemand = ['total' => 0, 'noResult' => 0, 'topMonths' => [], 'recentNoResult' => []];
        try {
            $searchDemand['total']    = (int)$qDays("SELECT COUNT(*) FROM search_log WHERE created_at >= $sinceSql")->fetchColumn();
            $searchDemand['noResult'] = (int)$qDays("SELECT COUNT(*) FROM search_log WHERE created_at >= $sinceSql AND found = 0")->fetchColumn();
            $tm = $qDays("SELECT month, COUNT(*) c, SUM(found) f FROM search_log
                               WHERE created_at >= $sinceSql AND month IS NOT NULL GROUP BY month ORDER BY c DESC LIMIT 6")->fetchAll();
            $searchDemand['topMonths'] = array_map(fn($r) => [
                'month' => $r['month'], 'count' => (int)$r['c'], 'found' => (int)$r['f']], $tm);
            $rn = $qDays("SELECT mode, adults, children, nights, month, check_in, created_at FROM search_log
                               WHERE created_at >= $sinceSql AND found = 0 ORDER BY created_at DESC LIMIT 8")->fetchAll();
            $searchDemand['recentNoResult'] = array_map(fn($r) => [
                'mode' => $r['mode'], 'adults' => (int)$r['adults'], 'children' => (int)$r['children'],
                'nights' => $r['nights'] !== null ? (int)$r['nights'] : null,
                'month' => $r['month'], 'check_in' => $r['check_in'], 'created_at' => $r['created_at']], $rn);
        } catch (\Throwable $e) { /* search_log not migrated yet */ }

        json_out([
            'ok' => true,
            'days' => $days,
            'totalViews' => $total,
            'uniqueVisitors' => $uniq,
            'prevTotalViews' => $prevTotal,
            'prevUniqueVisitors' => $prevUniq,
            'visitorMix' => $visitorMix,
            'weekViews' => $weekViews,
            'weekUnique' => $weekUnique,
            'prevWeekViews' => $prevWeek,
            'daily' => array_map(fn($r) => ['date' => $r['d'], 'views' => (int)$r['c']], $daily),
            'topReferrers' => array_map(fn($r) => ['host' => $r['h'], 'count' => (int)$r['c']], $refs),
            'byCottage' => array_map(fn($r) => ['prop_key' => $r['p'], 'views' => (int)$r['c']], $byProp),
            'topPages' => array_map(fn($r) => ['path' => $r['path'], 'views' => (int)$r['c']], $pages),
            'channels' => $channelsOut,
            'searchEngines' => $enginesOut,
            'sources' => array_map(fn($r) => ['source' => $r['s'], 'count' => (int)$r['c']], $sources),
            'events' => $events,
            'devices' => $devices,
            'enquiries' => $enquiriesN,
            'bookings' => $bookingsN,
            'searchDemand' => $searchDemand,
        ]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Analytics not ready — has migration-pageviews.sql / migration-analytics-v2.sql been run?'], 500);
    }
}

// ---- Public: record a view / event / search ----
if ($method === 'POST') {
    // Never count the owner's own activity.
    if (!empty($_SESSION['admin_id'])) json_out(['ok' => true]);

    $in = body();

    // --- Search-demand log ---
    if (isset($in['search']) && is_array($in['search'])) {
        $s = $in['search'];
        $mode = in_array(($s['mode'] ?? ''), ['exact', 'flex'], true) ? $s['mode'] : 'exact';
        $adults = max(0, min(99, (int)($s['adults'] ?? 0)));
        $children = max(0, min(99, (int)($s['children'] ?? 0)));
        $nights = isset($s['nights']) && $s['nights'] !== '' ? max(0, min(366, (int)$s['nights'])) : null;
        $month = preg_match('/^\d{4}-\d{2}$/', (string)($s['month'] ?? '')) ? $s['month'] : null;
        $checkIn = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($s['check_in'] ?? '')) ? $s['check_in'] : null;
        $results = max(0, min(999, (int)($s['results'] ?? 0)));
        $found = !empty($s['found']) ? 1 : 0;
        try {
            db()->prepare('INSERT INTO search_log (mode, adults, children, nights, month, check_in, results, found, ip_hash) VALUES (?,?,?,?,?,?,?,?,?)')
                ->execute([$mode, $adults, $children, $nights, $month, $checkIn, $results, $found, pv_ip_hash()]);
        } catch (\Throwable $e) { /* analytics must never break the page */ }
        json_out(['ok' => true]);
    }

    // --- Named intent event OR a page view ---
    $event = preg_replace('/[^a-z_]/', '', strtolower((string)($in['event'] ?? '')));
    $event = $event === '' ? null : substr($event, 0, 40);
    // Only a known set of events may be stored (so the column can't be spammed).
    if ($event !== null && !in_array($event, ['book_click', 'enquiry_open', 'enquiry_submit', 'pay_start'], true)) {
        json_out(['ok' => true]);
    }

    $path = clean($in['path'] ?? '/');
    $path = substr(preg_replace('/[?#].*$/', '', $path), 0, 255);   // drop query/hash, cap length
    if ($path === '') $path = '/';
    $prop = preg_replace('/[^a-z0-9_]/i', '', (string)($in['prop'] ?? ''));
    $prop = $prop === '' ? null : substr($prop, 0, 32);

    // Campaign attribution: utm_source (letters/digits/space/.-_), capped.
    $source = trim((string)($in['source'] ?? ''));
    $source = $source === '' ? null : substr(preg_replace('/[^a-z0-9 ._\-]/i', '', $source), 0, 60);

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
        // Light rate-limit: at most ~60 recorded rows per visitor per minute.
        $rl = db()->prepare('SELECT COUNT(*) FROM pageviews WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL 1 MINUTE)');
        $rl->execute([$ipHash]);
        if ((int)$rl->fetchColumn() < 60) {
            // Device class only on ordinary page views; NULL on intent-event rows.
            $device = $event === null ? pv_device() : null;
            db()->prepare('INSERT INTO pageviews (prop_key, path, referrer_host, ip_hash, event, source, device) VALUES (?,?,?,?,?,?,?)')
                ->execute([$prop, $path, $refHost, $ipHash, $event, $source, $device]);
        }
    } catch (\Throwable $e) { /* analytics must never break the page */ }

    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
