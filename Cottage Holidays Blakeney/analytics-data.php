<?php
// ============================================================
//  analytics-data.php — the one place the analytics summary is computed.
//
//  analytics_summary(int $days): array
//    Aggregates the cookie-free pageviews / search_log tables into the same
//    shape the owner analytics panel consumes. Shared so track.php (the admin
//    JSON endpoint) AND weekly-analytics.php (the email digest) report the SAME
//    numbers — no duplicated SQL. Throws on a hard DB failure; the caller
//    decides how to respond. Individual optional sections (devices, search
//    demand, enquiries/bookings) are guarded and default gracefully.
// ============================================================
require_once __DIR__ . '/db.php';

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

// Build the full analytics summary for the trailing $days window.
function analytics_summary($days) {
    $days = max(1, min(365, (int)$days));

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

    // Engagement depth — derived from existing rows, no extra tracking:
    //   bounce = visitors with exactly one page view in the window.
    //   exit pages = each visitor's LAST page view path ("where people leave").
    $bounceRate = 0; $exitPages = [];
    try {
        $bounced = (int)$qDays("SELECT COUNT(*) FROM (SELECT ip_hash FROM pageviews
                                    WHERE event IS NULL AND ip_hash IS NOT NULL AND created_at >= $sinceSql
                                    GROUP BY ip_hash HAVING COUNT(*) = 1) b")->fetchColumn();
        $bounceRate = $uniq > 0 ? (int)round(($bounced / $uniq) * 100) : 0;
        $exitPages = array_map(fn($r) => ['path' => $r['path'], 'count' => (int)$r['c']],
            $qDays("SELECT lp.path path, COUNT(*) c FROM (
                        SELECT p.ip_hash, p.path FROM pageviews p
                        JOIN (SELECT ip_hash, MAX(created_at) mx FROM pageviews
                              WHERE event IS NULL AND ip_hash IS NOT NULL AND created_at >= $sinceSql
                              GROUP BY ip_hash) last
                          ON last.ip_hash = p.ip_hash AND last.mx = p.created_at
                        WHERE p.event IS NULL AND p.path <> ''
                    ) lp GROUP BY lp.path ORDER BY c DESC LIMIT 6")->fetchAll());
    } catch (\Throwable $e) { /* leave defaults */ }

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

    return [
        'ok' => true,
        'days' => $days,
        'totalViews' => $total,
        'uniqueVisitors' => $uniq,
        'prevTotalViews' => $prevTotal,
        'prevUniqueVisitors' => $prevUniq,
        'visitorMix' => $visitorMix,
        'bounceRate' => $bounceRate,
        'exitPages' => $exitPages,
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
    ];
}
