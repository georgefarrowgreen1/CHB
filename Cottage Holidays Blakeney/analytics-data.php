<?php
// ============================================================
//  analytics-data.php — the one place the analytics summary is computed.
//
//  analytics_summary(int $days, array $opt = []): array
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
function pv_classify_ref($host)
{
    $host = strtolower((string) $host);
    $engines = [
        'google' => 'Google',
        'bing' => 'Bing',
        'duckduckgo' => 'DuckDuckGo',
        'yahoo' => 'Yahoo',
        'yandex' => 'Yandex',
        'ecosia' => 'Ecosia',
        'brave' => 'Brave',
        'baidu' => 'Baidu',
        'startpage' => 'Startpage',
        'qwant' => 'Qwant',
        'aol' => 'AOL',
    ];
    foreach ($engines as $needle => $name) {
        if (strpos($host, $needle) !== false) {
            return ['channel' => 'Search', 'name' => $name];
        }
    }
    $social = [
        'instagram' => 'Instagram',
        'facebook' => 'Facebook',
        'fb.' => 'Facebook',
        't.co' => 'X / Twitter',
        'twitter' => 'X / Twitter',
        'x.com' => 'X / Twitter',
        'pinterest' => 'Pinterest',
        'tiktok' => 'TikTok',
        'linkedin' => 'LinkedIn',
        'youtube' => 'YouTube',
        'reddit' => 'Reddit',
        'whatsapp' => 'WhatsApp',
    ];
    foreach ($social as $needle => $name) {
        if (strpos($host, $needle) !== false) {
            return ['channel' => 'Social', 'name' => $name];
        }
    }
    return ['channel' => 'Referral', 'name' => $host];
}

// How long the raw rows are kept. The page offers a 12-month window, and the rows
// were cut at 180 days, so "12 months" showed six months of visits beside twelve
// months of bookings. 400 days holds a full year with room to spare.
const ANALYTICS_KEEP_DAYS = 400;

// ---- DAILY TOTALS (see CLAUDE.md "Analytics from daily totals") ----
// Every figure is a sum over page views, a count of distinct visitors or each visitor's
// last page, and each of those splits by day. A finished day is summed once
// (analytics_rollup → pv_day, pv_visit, pv_exit), and a window reads its whole days from
// there and only the raw rows of the days it cuts through: the day it opens on (from the
// hour it opens) and the days not summed yet. The figures are the same as counting every
// raw row, which test-integration §99 asserts on random data. A day is summed once it
// cannot change: a view's time on page is written up to an hour after the view
// (track.php), so a day waits two hours past its end. A different
// ANALYTICS_ROLLUP_VERSION is rebuilt from the raw rows.
const ANALYTICS_ROLLUP_VERSION = 1;
const ANALYTICS_SETTLE_HOURS = 2;
// One row of pv_day per day, per figure, per value. Each is [dim, column, which rows];
// the column '' is a plain count, and 'p' also sums the time on page.
const PV_DIMS = [
    ['v', '', 'event IS NULL'],
    ['d', '', "event IS NULL AND (referrer_host IS NULL OR referrer_host = '')"],
    ['r', 'referrer_host', "event IS NULL AND referrer_host IS NOT NULL AND referrer_host <> ''"],
    ['c', 'prop_key', "event IS NULL AND prop_key IS NOT NULL AND prop_key <> ''"],
    ['p', 'path', "event IS NULL AND path <> ''"],
    ['s', 'source', "event IS NULL AND source IS NOT NULL AND source <> ''"],
    ['m', 'device', 'event IS NULL AND device IS NOT NULL'],
    ['e', 'event', 'event IS NOT NULL'],
];

// A wall-clock date or time moved by whole days, as MySQL moves a DATETIME (no zone).
function pv_shift(string $at, int $days): string
{
    $d = new DateTimeImmutable($at, new DateTimeZone('UTC'));
    $d = $d->modify(($days >= 0 ? '+' : '') . $days . ' days');
    return strlen($at) <= 10 ? $d->format('Y-m-d') : $d->format('Y-m-d H:i:s');
}

// Days from one date to another, counted on the calendar (a DST day is still one day).
function pv_days_between(string $a, string $b): int
{
    $tz = new DateTimeZone('UTC');
    return (int) (new DateTimeImmutable($a, $tz))->diff(new DateTimeImmutable($b, $tz))->format('%r%a');
}

// The last day summed, or null when nothing usable is (no tables yet, another version).
function analytics_rollup_through(): ?string
{
    try {
        $r = db()->query('SELECT through_day, version FROM pv_rollup WHERE id = 1')->fetch();
    } catch (\Throwable $e) {
        return null;
    }
    if (!$r || (int) $r['version'] !== ANALYTICS_ROLLUP_VERSION || empty($r['through_day'])) {
        return null;
    }
    return (string) $r['through_day'];
}

// The window [from, to) (to null: no end) as the summed days it may read (d1..d2, or none)
// and the raw rows it must count (a SQL condition on created_at, with its parameters).
function pv_window(string $from, ?string $to, ?string $through, string $col = 'created_at'): array
{
    $d1 = pv_shift(substr($from, 0, 10), 1);
    $d2 = $through;
    if ($d2 !== null && $to !== null && $d2 >= substr($to, 0, 10)) {
        $d2 = pv_shift(substr($to, 0, 10), -1);
    }
    if ($d2 === null || $d2 < $d1) {
        $pre = [$from, $to];
        $post = null;
        $d1 = $d2 = null;
    } else {
        $pre = [$from, $d1 . ' 00:00:00'];
        $post = [pv_shift($d2, 1) . ' 00:00:00', $to];
    }
    [$s1, $p1] = pv_range($pre, $col);
    [$s2, $p2] = $post ? pv_range($post, $col) : ['', []];
    return ['d1' => $d1, 'd2' => $d2, 'pre' => $pre, 'post' => $post, 'toEnd' => $d1 !== null && $d2 === $through,
        'raw' => '(' . $s1 . ($post ? ' OR ' . $s2 : '') . ')', 'rawP' => array_merge($p1, $p2)];
}
// A raw range [a, b) of created_at (b null: no end), as SQL and its parameters.
function pv_range(array $r, string $col = 'created_at'): array
{
    return $r[1] === null ? ["$col >= ?", [$r[0]]] : ["($col >= ? AND $col < ?)", [$r[0], $r[1]]];
}

function pv_rows(string $sql, array $params): array
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
}

// Rows of one kind in a window: the summed days' count plus the raw rows'.
function pv_count(array $w, string $dim): int
{
    $where = array_values(array_filter(PV_DIMS, fn($d) => $d[0] === $dim))[0][2];
    $n = 0;
    if ($w['d1'] !== null) {
        $n += (int) pv_rows('SELECT COALESCE(SUM(n), 0) c FROM pv_day WHERE dim = ? AND day BETWEEN ? AND ?', [$dim, $w['d1'], $w['d2']])[0]['c'];
    }
    return $n + (int) pv_rows("SELECT COUNT(*) c FROM pageviews WHERE $where AND " . $w['raw'], $w['rawP'])[0]['c'];
}

// Counts by value (most first), the values grouped as the database compares text
// (utf8mb4_general_ci, named, so both halves group alike) and each shown as its
// smallest spelling byte for byte. With $dwell, the average time on page beside each.
function pv_keyed(array $w, string $dim, int $limit = 0, bool $dwell = false): array
{
    [, $col, $where] = array_values(array_filter(PV_DIMS, fn($d) => $d[0] === $dim))[0];
    $parts = [];
    $params = [];
    if ($w['d1'] !== null) {
        $parts[] = 'SELECT k, n, dwell_sum ds, dwell_n dn FROM pv_day WHERE dim = ? AND day BETWEEN ? AND ?';
        array_push($params, $dim, $w['d1'], $w['d2']);
    }
    $parts[] = "SELECT CAST($col AS BINARY) k, COUNT(*) n, SUM(dwell_ms) ds, COUNT(dwell_ms) dn FROM pageviews WHERE $where AND " . $w['raw'] . " GROUP BY CAST($col AS BINARY)";
    array_push($params, ...$w['rawP']);
    $sql = 'SELECT MIN(k) label, SUM(n) c' . ($dwell ? ', SUM(ds) / NULLIF(SUM(dn), 0) a' : '') . ' FROM (' . implode(' UNION ALL ', $parts) . ') u'
        . ' GROUP BY CONVERT(k USING utf8mb4) COLLATE utf8mb4_general_ci ORDER BY c DESC, label ASC' . ($limit > 0 ? ' LIMIT ' . $limit : '');
    return array_map(fn($r) => ['k' => (string) $r['label'], 'c' => (int) $r['c'], 'a' => $dwell && $r['a'] !== null ? (int) round((float) $r['a']) : null], pv_rows($sql, $params));
}

// Visitors in a window: those in the summed days, plus those in the raw rows that the
// summed days do not hold (a visitor is one ip_hash, lowercase hex by construction, so
// the bytes and the text compare alike).
function pv_unique(array $w): int
{
    $raw = 'SELECT COUNT(DISTINCT CAST(ip_hash AS BINARY)) c FROM pageviews p WHERE event IS NULL AND ip_hash IS NOT NULL AND ' . $w['raw'];
    if ($w['d1'] === null) {
        return (int) pv_rows($raw, $w['rawP'])[0]['c'];
    }
    $n = (int) pv_rows('SELECT COUNT(DISTINCT ip_hash) c FROM pv_visit WHERE day BETWEEN ? AND ?', [$w['d1'], $w['d2']])[0]['c'];
    return $n + (int) pv_rows($raw . ' AND NOT EXISTS (SELECT 1 FROM pv_visit v WHERE v.ip_hash = CAST(p.ip_hash AS BINARY) AND v.day BETWEEN ? AND ?)', array_merge($w['rawP'], [$w['d1'], $w['d2']]))[0]['c'];
}
// Visitors who saw one page in the window: one view in the summed days and none in the raw
// rows, or one raw view and none in the summed days.
function pv_single_view(array $w): int
{
    $raw = 'SELECT COUNT(*) c FROM (SELECT CAST(ip_hash AS BINARY) h FROM pageviews WHERE event IS NULL AND ip_hash IS NOT NULL AND ' . $w['raw'] . ' GROUP BY CAST(ip_hash AS BINARY) HAVING COUNT(*) = 1) r';
    if ($w['d1'] === null) {
        return (int) pv_rows($raw, $w['rawP'])[0]['c'];
    }
    $n = (int) pv_rows($raw . ' WHERE NOT EXISTS (SELECT 1 FROM pv_visit v WHERE v.ip_hash = r.h AND v.day BETWEEN ? AND ?)', array_merge($w['rawP'], [$w['d1'], $w['d2']]))[0]['c'];
    return $n + (int) pv_rows('SELECT COUNT(*) c FROM (SELECT ip_hash FROM pv_visit WHERE day BETWEEN ? AND ? GROUP BY ip_hash HAVING SUM(views) = 1) b'
        . ' WHERE b.ip_hash NOT IN (SELECT CAST(ip_hash AS BINARY) FROM pageviews WHERE event IS NULL AND ip_hash IS NOT NULL AND ' . $w['raw'] . ')', array_merge([$w['d1'], $w['d2']], $w['rawP']))[0]['c'];
}

// Where people leave: each visitor's last page view in the window (every page they opened
// in that same second), counted by page. The window's parts are in time order (its opening
// part-day, the summed days, the days after), so a visitor's last view is in the latest
// part they appear in: the days after if they were seen there, else their latest summed
// day, else the opening part-day. pv_exit keeps only each visitor's latest summed day, so
// it answers a window whose summed days run to the last one summed (the current window);
// any other is counted from its raw rows.
function pv_exits(array $w, int $limit): array
{
    if ($w['d1'] !== null && !$w['toEnd']) {
        $w = ['d1' => null, 'pre' => [$w['pre'][0], $w['post'][1] ?? null], 'post' => null];
    }
    $parts = [];
    $params = [];
    // Raw rows of one range: each visitor's last second there, minus visitors seen later.
    $raw = function (array $range, string $later, array $laterP) use (&$parts, &$params) {
        [$rs, $rp] = pv_range($range);
        $parts[] = "SELECT CAST(p.path AS BINARY) k, COUNT(*) n FROM pageviews p
            JOIN (SELECT ip_hash, MAX(created_at) mx FROM pageviews WHERE event IS NULL AND ip_hash IS NOT NULL AND $rs GROUP BY ip_hash) m
              ON m.ip_hash = p.ip_hash AND m.mx = p.created_at
            WHERE p.event IS NULL AND p.path <> ''$later GROUP BY CAST(p.path AS BINARY)";
        array_push($params, ...$rp, ...$laterP);
    };
    if ($w['post']) {
        $raw($w['post'], '', []);
    }
    [$ps, $pp] = $w['post'] ? pv_range($w['post'], 'q.created_at') : ['', []];
    $seenAfter = $w['post'] ? " AND NOT EXISTS (SELECT 1 FROM pageviews q WHERE q.ip_hash = m.ip_hash AND q.event IS NULL AND $ps)" : '';
    if ($w['d1'] !== null) {
        $parts[] = 'SELECT k, n FROM pv_exit WHERE day BETWEEN ? AND ?'
            . ($w['post'] ? " AND ip_hash NOT IN (SELECT CAST(q.ip_hash AS BINARY) FROM pageviews q WHERE q.event IS NULL AND q.ip_hash IS NOT NULL AND $ps)" : '');
        array_push($params, $w['d1'], $w['d2'], ...$pp);
        $raw($w['pre'], $seenAfter . ' AND NOT EXISTS (SELECT 1 FROM pv_visit v WHERE v.ip_hash = CAST(m.ip_hash AS BINARY) AND v.day BETWEEN ? AND ?)', array_merge($pp, [$w['d1'], $w['d2']]));
    } else {
        $raw($w['pre'], $seenAfter, $pp);
    }
    $sql = 'SELECT MIN(k) label, SUM(n) c FROM (' . implode(' UNION ALL ', $parts) . ') u'
        . ' GROUP BY CONVERT(k USING utf8mb4) COLLATE utf8mb4_general_ci ORDER BY c DESC, label ASC LIMIT ' . (int) $limit;
    return array_map(fn($r) => ['path' => (string) $r['label'], 'count' => (int) $r['c']], pv_rows($sql, $params));
}

// Sums every finished day not summed yet, oldest first, at most $maxDays of them (null:
// all). One run at a time (GET_LOCK, not waited for: a page that finds it busy reads the
// raw rows of the days not summed yet, which is slower and the same). Each batch of days
// and the new watermark are one transaction, so a reader sees all of a batch or none of
// it. Returns how many days it summed.
function analytics_rollup(?int $maxDays = null): int
{
    try {
        $got = (int) db()->query("SELECT GET_LOCK('chb_pv_rollup', 0)")->fetchColumn();
    } catch (\Throwable $e) {
        return 0;
    }
    if ($got !== 1) {
        return 0;
    }
    $done = 0;
    try {
        try {
            $st = db()->query('SELECT through_day, version FROM pv_rollup WHERE id = 1')->fetch();
        } catch (\Throwable $e) {
            return 0; // not migrated yet: every figure reads the raw rows
        }
        $through = $st && (int) $st['version'] === ANALYTICS_ROLLUP_VERSION ? ($st['through_day'] ?: null) : null;
        if (!$st || (int) $st['version'] !== ANALYTICS_ROLLUP_VERSION) {
            db()->beginTransaction();
            db()->exec('DELETE FROM pv_day');
            db()->exec('DELETE FROM pv_visit');
            db()->exec('DELETE FROM pv_exit');
            db()->prepare('INSERT INTO pv_rollup (id, through_day, version) VALUES (1, NULL, ?) ON DUPLICATE KEY UPDATE through_day = NULL, version = VALUES(version)')
                ->execute([ANALYTICS_ROLLUP_VERSION]);
            db()->commit();
        }
        [$last, $oldest, $keep] = array_values(db()->query('SELECT DATE(NOW() - INTERVAL ' . ANALYTICS_SETTLE_HOURS . ' HOUR) - INTERVAL 1 DAY, DATE(MIN(created_at)), DATE(NOW() - INTERVAL ' . ANALYTICS_KEEP_DAYS . ' DAY) FROM pageviews')->fetch(PDO::FETCH_NUM));
        $first = $through !== null ? pv_shift((string) $through, 1) : (string) ($oldest ?: $last);
        if ($first < (string) $keep) {
            $first = (string) $keep;
        }
        while ($first <= $last && ($maxDays === null || $done < $maxDays)) {
            $n = min(31, $maxDays === null ? 31 : $maxDays - $done);
            $end = min((string) $last, pv_shift($first, $n - 1));
            $a = $first . ' 00:00:00';
            $b = pv_shift($end, 1) . ' 00:00:00';
            db()->beginTransaction();
            try {
                foreach (['pv_day', 'pv_visit', 'pv_exit'] as $t) {
                    db()->prepare("DELETE FROM $t WHERE day BETWEEN ? AND ?")->execute([$first, $end]);
                }
                foreach (PV_DIMS as [$dim, $col, $where]) {
                    $k = $col === '' ? "''" : "CAST($col AS BINARY)";
                    db()->prepare("INSERT INTO pv_day (day, dim, k, n, dwell_sum, dwell_n)
                        SELECT DATE(created_at), '$dim', $k, COUNT(*), COALESCE(SUM(dwell_ms), 0), COUNT(dwell_ms)
                        FROM pageviews WHERE $where AND created_at >= ? AND created_at < ?
                        GROUP BY DATE(created_at)" . ($col === '' ? '' : ", $k"))->execute([$a, $b]);
                }
                db()->prepare('INSERT INTO pv_visit (day, ip_hash, views, last_at)
                    SELECT DATE(created_at), CAST(ip_hash AS BINARY), COUNT(*), MAX(created_at)
                    FROM pageviews WHERE event IS NULL AND ip_hash IS NOT NULL AND created_at >= ? AND created_at < ?
                    GROUP BY DATE(created_at), CAST(ip_hash AS BINARY)')->execute([$a, $b]);
                db()->prepare("INSERT INTO pv_exit (day, ip_hash, k, n)
                    SELECT DATE(p.created_at), CAST(p.ip_hash AS BINARY), CAST(p.path AS BINARY), COUNT(*)
                    FROM pageviews p JOIN (
                        SELECT ip_hash, MAX(created_at) mx FROM pageviews
                        WHERE event IS NULL AND ip_hash IS NOT NULL AND created_at >= ? AND created_at < ?
                        GROUP BY ip_hash, DATE(created_at)
                    ) m ON m.ip_hash = p.ip_hash AND m.mx = p.created_at
                    WHERE p.event IS NULL AND p.path <> ''
                    GROUP BY DATE(p.created_at), CAST(p.ip_hash AS BINARY), CAST(p.path AS BINARY)")->execute([$a, $b]);
                // Only each visitor's latest day keeps its exits.
                db()->prepare('DELETE x FROM pv_exit x JOIN pv_visit v ON v.ip_hash = x.ip_hash AND v.day > x.day WHERE v.day BETWEEN ? AND ?')->execute([$first, $end]);
                db()->prepare('UPDATE pv_rollup SET through_day = ? WHERE id = 1')->execute([$end]);
                db()->commit();
            } catch (\Throwable $e) {
                if (db()->inTransaction()) {
                    db()->rollBack();
                }
                throw $e;
            }
            $done += pv_days_between($first, $end) + 1;
            $first = pv_shift($end, 1);
        }
        foreach (['pv_day', 'pv_visit', 'pv_exit'] as $t) {
            db()->prepare("DELETE FROM $t WHERE day < ?")->execute([$keep]);
        }
    } finally {
        try {
            db()->query("SELECT RELEASE_LOCK('chb_pv_rollup')");
        } catch (\Throwable $e) {
        }
    }
    return $done;
}

// Build the full analytics summary for the trailing $days window. For the tests:
// $opt['now'] fixes the clock (a database time, so two answers compare at one instant),
// $opt['rollup'] false counts every raw row (what the summed days must equal), and
// $opt['roll'] false reads the days summed so far without summing more.
function analytics_summary($days, array $opt = [])
{
    $days = max(1, min(365, (int) $days));
    $useRollup = ($opt['rollup'] ?? true) !== false;

    // Opportunistic retention, then any finished days not summed yet (a few at a time:
    // the daily job does the rest).
    db()->exec('DELETE FROM pageviews WHERE created_at < (NOW() - INTERVAL ' . ANALYTICS_KEEP_DAYS . ' DAY)');
    try {
        db()->exec('DELETE FROM search_log WHERE created_at < (NOW() - INTERVAL ' . ANALYTICS_KEEP_DAYS . ' DAY)');
    } catch (\Throwable $e) {
    }
    if ($useRollup && ($opt['roll'] ?? true) !== false) {
        try {
            analytics_rollup(62);
        } catch (\Throwable $e) {
        }
    }
    $now = isset($opt['now']) ? (string) $opt['now'] : (string) db()->query('SELECT NOW()')->fetchColumn();
    $since = pv_shift($now, -$days);

    // One snapshot, so the watermark and the summed days it vouches for agree.
    $tx = !db()->inTransaction() && db()->beginTransaction();
    try {
        $through = $useRollup ? analytics_rollup_through() : null;
        $win = fn(int $back, int $upTo = 0) => pv_window(pv_shift($now, -$back), $upTo > 0 ? pv_shift($now, -$upTo) : null, $through);
        $cur = $win($days);
        // The first row kept: a window reaching back before it is only partly counted,
        // and the page says so rather than presenting the part as the whole.
        $firstSeen = '';
        try {
            $firstSeen = (string) (db()->query('SELECT DATE(MIN(created_at)) FROM pageviews')->fetchColumn() ?: '');
        } catch (\Throwable $e) {
        }

        // Page views only (event IS NULL) for all the "traffic" figures.
        $total = pv_count($cur, 'v');
        $uniq = pv_unique($cur);
        // The immediately preceding window of equal length, for a period-over-period delta.
        // A window before this one that the kept rows do not wholly cover is no
        // comparison: a year against the 35 days left of the year before would read
        // as a tenfold rise. No delta beats a false one.
        $prevTotal = 0;
        $prevUniq = 0;
        if ($days * 2 <= ANALYTICS_KEEP_DAYS) {
            $prev = $win($days * 2, $days);
            $prevTotal = pv_count($prev, 'v');
            $prevUniq = pv_unique($prev);
        }

        // Engagement depth — derived from existing rows, no extra tracking:
        //   bounce = visitors with exactly one page view in the window.
        //   exit pages = each visitor's LAST page view path ("where people leave").
        $bounceRate = 0;
        $exitPages = [];
        try {
            $bounceRate = $uniq > 0 ? (int) round((pv_single_view($cur) / $uniq) * 100) : 0;
            $exitPages = pv_exits($cur, 6);
        } catch (\Throwable $e) {
            /* leave defaults */
        }

        // Last 7 days ("this week") + the 7 days before that (for a trend %).
        $week = $win(7);
        $weekViews = pv_count($week, 'v');
        $weekUnique = pv_unique($week);
        $prevWeek = pv_count($win(14, 7), 'v');

        $byDay = [];
        if ($cur['d1'] !== null) {
            foreach (pv_rows("SELECT day d, n c FROM pv_day WHERE dim = 'v' AND day BETWEEN ? AND ?", [$cur['d1'], $cur['d2']]) as $r) {
                $byDay[(string) $r['d']] = (int) $r['c'];
            }
        }
        foreach (pv_rows('SELECT DATE(created_at) d, COUNT(*) c FROM pageviews WHERE event IS NULL AND ' . $cur['raw'] . ' GROUP BY DATE(created_at)', $cur['rawP']) as $r) {
            $byDay[(string) $r['d']] = ($byDay[(string) $r['d']] ?? 0) + (int) $r['c'];
        }
        ksort($byDay);
        $daily = array_map(fn($d, $c) => ['d' => $d, 'c' => $c], array_keys($byDay), $byDay);

        // Channels + search engines: classify every referrer'd page view.
        $allRefs = pv_keyed($cur, 'r');
        $direct = pv_count($cur, 'd');
        $channels = ['Direct' => $direct, 'Search' => 0, 'Social' => 0, 'Referral' => 0];
        $engines = [];
        foreach ($allRefs as $r) {
            $cl = pv_classify_ref($r['k']);
            $channels[$cl['channel']] += $r['c'];
            if ($cl['channel'] === 'Search') {
                $engines[$cl['name']] = ($engines[$cl['name']] ?? 0) + $r['c'];
            }
        }
        arsort($engines);
        $channelsOut = [];
        foreach ($channels as $name => $c) {
            if ($c > 0) {
                $channelsOut[] = ['channel' => $name, 'count' => $c];
            }
        }
        usort($channelsOut, fn($a, $b) => $b['count'] - $a['count']);
        $enginesOut = [];
        foreach ($engines as $name => $c) {
            $enginesOut[] = ['name' => $name, 'count' => $c];
        }

        // In-page events (the conversion funnel within the site).
        $events = ['book_click' => 0, 'enquiry_open' => 0, 'enquiry_submit' => 0, 'pay_start' => 0];
        foreach (pv_keyed($cur, 'e') as $r) {
            if (isset($events[$r['k']])) {
                $events[$r['k']] = $r['c'];
            }
        }

        // Device split (mobile / tablet / desktop) — guarded: the column may not
        // exist yet on a DB that hasn't run migration-analytics-v3.sql.
        $devices = [];
        try {
            $devices = array_map(fn($r) => ['device' => $r['k'], 'count' => $r['c']], pv_keyed($cur, 'm'));
        } catch (\Throwable $e) {
            /* device column not migrated yet */
        }

        // Funnel against real outcomes (enquiries + bookings in the same window).
        $enquiriesN = 0;
        $bookingsN = 0;
        try {
            $enquiriesN = (int) pv_rows('SELECT COUNT(*) c FROM enquiries WHERE created_at >= ?', [$since])[0]['c'];
        } catch (\Throwable $e) {
        }
        try {
            $bookingsN = (int) pv_rows('SELECT COUNT(*) c FROM bookings WHERE created_at >= ?', [$since])[0]['c'];
        } catch (\Throwable $e) {
        }
        // Bookings that came THROUGH THE SITE: an approved enquiry carries the terms
        // the guest accepted on the form; a booking the owner added by hand (a phone
        // call, a repeat guest) never does. `bookings` above counts both, so it is no
        // measure of what the site turned into stays.
        $siteBookingsN = 0;
        try {
            $siteBookingsN = (int) pv_rows('SELECT COUNT(*) c FROM bookings WHERE created_at >= ? AND terms_accepted_at IS NOT NULL', [$since])[0]['c'];
        } catch (\Throwable $e) {
        }

        // Search demand (own table; default gracefully if the migration hasn't run).
        $searchDemand = ['total' => 0, 'noResult' => 0, 'topMonths' => [], 'recentNoResult' => []];
        try {
            $searchDemand['total'] = (int) pv_rows('SELECT COUNT(*) c FROM search_log WHERE created_at >= ?', [$since])[0]['c'];
            $searchDemand['noResult'] = (int) pv_rows('SELECT COUNT(*) c FROM search_log WHERE created_at >= ? AND found = 0', [$since])[0]['c'];
            $searchDemand['topMonths'] = array_map(
                fn($r) => ['month' => $r['month'], 'count' => (int) $r['c'], 'found' => (int) $r['f']],
                pv_rows('SELECT month, COUNT(*) c, SUM(found) f FROM search_log WHERE created_at >= ? AND month IS NOT NULL GROUP BY month ORDER BY c DESC, month ASC LIMIT 6', [$since]),
            );
            $searchDemand['recentNoResult'] = array_map(
                fn($r) => [
                    'mode' => $r['mode'],
                    'adults' => (int) $r['adults'],
                    'children' => (int) $r['children'],
                    'nights' => $r['nights'] !== null ? (int) $r['nights'] : null,
                    'month' => $r['month'],
                    'check_in' => $r['check_in'],
                    'created_at' => $r['created_at'],
                ],
                pv_rows('SELECT mode, adults, children, nights, month, check_in, created_at FROM search_log WHERE created_at >= ? AND found = 0 ORDER BY created_at DESC, id DESC LIMIT 8', [$since]),
            );
        } catch (\Throwable $e) {
            /* search_log not migrated yet */
        }

        $pages = pv_keyed($cur, 'p', 8, true);
        return [
            'ok' => true,
            'days' => $days,
            'totalViews' => $total,
            'uniqueVisitors' => $uniq,
            'prevTotalViews' => $prevTotal,
            'prevUniqueVisitors' => $prevUniq,
            'bounceRate' => $bounceRate,
            'exitPages' => $exitPages,
            'weekViews' => $weekViews,
            'weekUnique' => $weekUnique,
            'prevWeekViews' => $prevWeek,
            'daily' => analytics_daily_filled($daily, $days, $now),
            'firstSeen' => $firstSeen,
            'topReferrers' => array_map(fn($r) => ['host' => $r['k'], 'count' => $r['c']], array_slice($allRefs, 0, 8)),
            'byCottage' => array_map(fn($r) => ['prop_key' => $r['k'], 'views' => $r['c']], pv_keyed($cur, 'c')),
            'topPages' => array_map(fn($r) => ['path' => $r['k'], 'views' => $r['c'], 'dwellMs' => $r['a']], $pages),
            'channels' => $channelsOut,
            'searchEngines' => $enginesOut,
            'sources' => array_map(fn($r) => ['source' => $r['k'], 'count' => $r['c']], pv_keyed($cur, 's', 8)),
            'events' => $events,
            'devices' => $devices,
            'enquiries' => $enquiriesN,
            'bookings' => $bookingsN,
            'siteBookings' => $siteBookingsN,
            'searchDemand' => $searchDemand,
        ];
    } finally {
        if ($tx && db()->inTransaction()) {
            db()->commit();
        }
    }
}

// Every day of the window, a quiet day as 0: the chart skipped days with no views,
// so "each week" grouped seven ROWS (sometimes ten days) and a gap vanished. The
// dates are the database's own (the rows were grouped on its clock), from the day
// the window opens to today.
function analytics_daily_filled(array $rows, int $days, ?string $now = null): array
{
    $byDate = [];
    foreach ($rows as $r) {
        $byDate[(string) $r['d']] = (int) $r['c'];
    }
    try {
        $now = $now ?? (string) db()->query('SELECT NOW()')->fetchColumn();
        $d = new DateTimeImmutable(substr(pv_shift($now, -$days), 0, 10), new DateTimeZone('UTC'));
        $end = new DateTimeImmutable(substr($now, 0, 10), new DateTimeZone('UTC'));
    } catch (\Throwable $e) {
        return array_map(fn($k) => ['date' => $k, 'views' => $byDate[$k]], array_keys($byDate));
    }
    $out = [];
    for ($i = 0; $d <= $end && $i < 400; $i++, $d = $d->modify('+1 day')) {
        $k = $d->format('Y-m-d');
        $out[] = ['date' => $k, 'views' => $byDate[$k] ?? 0];
    }
    return $out;
}
