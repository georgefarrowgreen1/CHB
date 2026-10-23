<?php
// ============================================================
//  perf-lib.php — how fast the site is for the people using it.
//
//  Each page view sends what the visitor's own browser measured (app.js chbPerf):
//  when the page appeared, when the app could be used, the largest paint, how far
//  the layout jumped and how long a tap took to answer. perf.php stores it, the
//  nightly job sums each finished day (perf_rollup), and Manage → Status shows the
//  week (perf_status). Nothing personal is kept: no address, no browser string, no
//  page beyond home / a cottage / other.
//
//  The pure half (cleaning a sample, the percentiles, the judgements) is gated by
//  test-perf.php with no database; the rest is gated by test-integration §103.
// ============================================================
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(404);
    exit();
}

const PERF_KEEP_DAYS = 30;       // raw samples
const PERF_DAY_KEEP_DAYS = 400;  // the daily figures
const PERF_MIN_N = 20;           // a figure is judged only with this many in the week
const PERF_IP_PER_HOUR = 40;     // samples one address may add in an hour
const PERF_ALL_PER_HOUR = 3000;  // and everyone together
const PERF_TRACE_DAYS = 14;

// Each figure: [good at or under, poor over, the largest value kept]. Milliseconds,
// except cls (layout shift x1000). The good/poor lines are Google's Core Web Vitals
// where one exists; "shown" takes first paint's and "ready" the old time-to-interactive.
const PERF_METRICS = [
    'ttfb' => [800, 1800, 60000],
    'fcp' => [1800, 3000, 60000],
    'lcp' => [2500, 4000, 60000],
    'shown' => [1800, 3000, 60000],
    'ready' => [3800, 7300, 120000],
    'inp' => [200, 500, 60000],
    'cls' => [100, 250, 10000],
];

// What the Status page shows of each group, in order (perf_status judges these).
const PERF_GROUPS = [
    'sp' => ['Phones', ['shown', 'lcp', 'ready', 'inp', 'cls']],
    'sc' => ['Computers and tablets', ['shown', 'lcp', 'ready', 'inp', 'cls']],
    'bo' => ['Your back office', ['ready', 'inp']],
];

// A coarse device class from the browser string (only this letter is kept).
function perf_device(string $ua): string
{
    $u = strtolower($ua);
    if (preg_match('/ipad|tablet|kindle|silk|playbook/', $u) || (strpos($u, 'android') !== false && strpos($u, 'mobile') === false)) {
        return 't';
    }
    if (preg_match('/mobi|iphone|ipod|android|windows phone|opera mini/', $u)) {
        return 'p';
    }
    return 'd';
}

// The browser family: e Edge, a Samsung, f Firefox, c Chrome, s Safari (and an iPhone
// app's own web view), o anything else. Order matters: Edge and Samsung say Chrome too.
function perf_browser(string $ua): string
{
    $u = strtolower($ua);
    if (preg_match('/\bedg(e|a|ios)?\//', $u)) {
        return 'e';
    }
    if (strpos($u, 'samsungbrowser/') !== false) {
        return 'a';
    }
    if (preg_match('/\bopr\/|opera/', $u)) {
        return 'o';
    }
    if (preg_match('/firefox\/|fxios\//', $u)) {
        return 'f';
    }
    if (preg_match('/chrome\/|crios\/|chromium\//', $u)) {
        return 'c';
    }
    if (strpos($u, 'applewebkit') !== false && preg_match('/iphone|ipad|ipod|macintosh|mac os x/', $u)) {
        return 's';
    }
    return 'o';
}

// The group a sample is shown in: the back office, else the site by device.
function perf_group(string $kind, string $device): string
{
    return $kind === 'o' ? 'bo' : ($device === 'p' ? 'sp' : 'sc');
}

// A sample as it may be stored, or null when it carries no figure. $kind comes from
// the session (perf.php), never from the request.
function perf_sample_clean(array $in, string $ua, string $kind): ?array
{
    $row = [
        'kind' => in_array($kind, ['v', 'g', 'o'], true) ? $kind : 'v',
        'device' => perf_device($ua),
        'browser' => perf_browser($ua),
        'land' => in_array($in['land'] ?? null, ['h', 'c', 'o'], true) ? $in['land'] : 'o',
        'early' => ($in['early'] ?? false) === true ? 1 : 0,
        'pwa' => ($in['pwa'] ?? false) === true ? 1 : 0,
    ];
    $any = false;
    foreach (PERF_METRICS as $m => $t) {
        $v = $in[$m] ?? null;
        $row[$m] = null;
        if ((is_int($v) || is_float($v)) && is_finite((float) $v) && $v >= 0 && $v <= $t[2]) {
            $row[$m] = (int) round((float) $v);
            $any = true;
        }
    }
    return $any ? $row : null;
}

// The nearest-rank percentile of an ascending list (p in 1..100).
function perf_pct(array $sorted, int $p): int
{
    $n = count($sorted);
    if ($n === 0) {
        return 0;
    }
    $rank = (int) ceil(($p / 100) * $n);
    return (int) $sorted[max(1, min($n, $rank)) - 1];
}

// One figure's values summed: how many, the 50th/75th/90th percentiles, and how many
// were good and how many poor by the figure's own lines.
function perf_summarise(string $metric, array $values): array
{
    sort($values, SORT_NUMERIC);
    [$good, $poor] = PERF_METRICS[$metric];
    $g = 0;
    $b = 0;
    foreach ($values as $v) {
        if ($v <= $good) {
            $g++;
        } elseif ($v > $poor) {
            $b++;
        }
    }
    return ['n' => count($values), 'p50' => perf_pct($values, 50), 'p75' => perf_pct($values, 75), 'p90' => perf_pct($values, 90), 'good' => $g, 'poor' => $b];
}

// good | mid | poor for a figure at a value.
function perf_rate(string $metric, int $v): string
{
    [$good, $poor] = PERF_METRICS[$metric];
    return $v <= $good ? 'good' : ($v > $poor ? 'poor' : 'mid');
}

// A figure as words: "1.3s", "180ms", a layout shift as "0.05".
function perf_say(string $metric, int $v): string
{
    if ($metric === 'cls') {
        return number_format($v / 1000, 2);
    }
    return $v < 1000 ? $v . 'ms' : number_format($v / 1000, 1) . 's';
}

// Samples (rows of perf_samples) summed by group and figure: [grp => [metric => values]],
// plus how many page views each group saw (a sample with a load figure is one).
function perf_bucket(array $rows): array
{
    $vals = [];
    $views = [];
    foreach ($rows as $r) {
        $g = perf_group((string) $r['kind'], (string) $r['device']);
        foreach (array_keys(PERF_METRICS) as $m) {
            if ($r[$m] !== null) {
                $vals[$g][$m][] = (int) $r[$m];
            }
        }
        if ($r['shown'] !== null || $r['ready'] !== null || $r['fcp'] !== null || $r['ttfb'] !== null) {
            $views[$g] = ($views[$g] ?? 0) + 1;
        }
    }
    return [$vals, $views];
}

// The week, judged. For each group and each figure it shows: the summary, and a rating
// once at least PERF_MIN_N visits measured it. A group is 'fast' when every judged
// figure is good, 'slow' when any is poor, 'mid' otherwise, 'few' when none is judged.
// The Status check exists only once something is judged, and warns only for poor.
function perf_judge(array $vals, array $views): array
{
    $groups = [];
    $poor = [];
    $judged = 0;
    foreach (PERF_GROUPS as $g => [$label, $metrics]) {
        $figs = [];
        $rates = [];
        foreach ($metrics as $m) {
            $v = $vals[$g][$m] ?? [];
            if (!$v) {
                continue;
            }
            $s = perf_summarise($m, $v);
            $s['rate'] = $s['n'] >= PERF_MIN_N ? perf_rate($m, $s['p75']) : null;
            if ($s['rate'] !== null) {
                $rates[] = $s['rate'];
                if ($s['rate'] === 'poor') {
                    $poor[] = [$g, $m, $s['p75']];
                }
            }
            $figs[$m] = $s;
        }
        $judged += count($rates);
        $tone = !$rates ? 'few' : (in_array('poor', $rates, true) ? 'slow' : (in_array('mid', $rates, true) ? 'mid' : 'fast'));
        $groups[$g] = ['label' => $label, 'views' => (int) ($views[$g] ?? 0), 'tone' => $tone, 'figs' => $figs];
    }
    return ['groups' => $groups, 'judged' => $judged > 0, 'poor' => $poor, 'sentence' => perf_sentence($groups, $poor)];
}

// One sentence for the Status check: what is slow, or that it is fast.
function perf_sentence(array $groups, array $poor): string
{
    static $say = ['shown' => 'pages appeared', 'lcp' => 'the main picture showed', 'ready' => 'it was ready to use', 'inp' => 'a tap was answered', 'cls' => 'the layout jumped', 'fcp' => 'something showed', 'ttfb' => 'the server answered'];
    if (!$poor) {
        return 'Fast for real visitors this week.';
    }
    [$g, $m, $p75] = $poor[0];
    $who = $g === 'bo' ? 'In your back office' : 'For visitors on ' . ($g === 'sp' ? 'phones' : 'computers and tablets');
    $how = $m === 'cls' ? 'the layout jumped by ' . perf_say($m, $p75) : $say[$m] . ' in ' . perf_say($m, $p75);
    $more = count($poor) > 1 ? ' (and ' . (count($poor) - 1) . ' more figure' . (count($poor) > 2 ? 's' : '') . ')' : '';
    return $who . ', ' . $how . ' or longer for 1 in 4 visits this week' . $more . '.';
}

// ---- Reading and writing (perf.php, self-repair.php, diagnostics.php) ----------

// Stores one cleaned sample. Never throws: a figure must never cost a page anything.
function perf_record(array $row): bool
{
    try {
        $cols = array_merge(['kind', 'device', 'browser', 'land', 'early', 'pwa'], array_keys(PERF_METRICS));
        $sql = 'INSERT INTO perf_samples (' . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')';
        db()->prepare($sql)->execute(array_map(fn($c) => $row[$c] ?? null, $cols));
        return true;
    } catch (\Throwable $e) {
        return false;
    }
}

// Sums every finished day not summed yet into perf_day, then drops samples past
// PERF_KEEP_DAYS and daily figures past PERF_DAY_KEEP_DAYS. One run at a time; each
// day is one transaction, so a reader sees a day whole or not at all. A sample's day
// is the day it ARRIVED, so a finished day never gains a sample. Returns days summed.
function perf_rollup(): int
{
    try {
        if ((int) db()->query("SELECT GET_LOCK('chb_perf_rollup', 0)")->fetchColumn() !== 1) {
            return 0;
        }
    } catch (\Throwable $e) {
        return 0;
    }
    $done = 0;
    try {
        try {
            $days = db()->query('SELECT DISTINCT DATE(created_at) FROM perf_samples
                WHERE created_at < CURDATE() AND created_at >= CURDATE() - INTERVAL ' . PERF_KEEP_DAYS . ' DAY
                  AND DATE(created_at) NOT IN (SELECT day FROM perf_day) ORDER BY 1')->fetchAll(PDO::FETCH_COLUMN);
        } catch (\Throwable $e) {
            return 0; // not migrated yet
        }
        $cols = implode(', ', array_keys(PERF_METRICS));
        $read = db()->prepare("SELECT kind, device, $cols FROM perf_samples WHERE created_at >= ? AND created_at < ?");
        $put = db()->prepare('INSERT INTO perf_day (day, grp, metric, n, p50, p75, p90, good, poor) VALUES (?,?,?,?,?,?,?,?,?)');
        foreach ($days as $d) {
            $d = (string) $d;
            $read->execute([$d . ' 00:00:00', (new DateTimeImmutable($d))->modify('+1 day')->format('Y-m-d') . ' 00:00:00']);
            [$vals] = perf_bucket($read->fetchAll(PDO::FETCH_ASSOC));
            db()->beginTransaction();
            try {
                db()->prepare('DELETE FROM perf_day WHERE day = ?')->execute([$d]);
                foreach ($vals as $g => $byMetric) {
                    foreach ($byMetric as $m => $v) {
                        $s = perf_summarise($m, $v);
                        $put->execute([$d, $g, $m, $s['n'], $s['p50'], $s['p75'], $s['p90'], $s['good'], $s['poor']]);
                    }
                }
                db()->commit();
            } catch (\Throwable $e) {
                if (db()->inTransaction()) {
                    db()->rollBack();
                }
                throw $e;
            }
            $done++;
        }
        db()->exec('DELETE FROM perf_samples WHERE created_at < CURDATE() - INTERVAL ' . PERF_KEEP_DAYS . ' DAY');
        db()->exec('DELETE FROM perf_day WHERE day < CURDATE() - INTERVAL ' . PERF_DAY_KEEP_DAYS . ' DAY');
    } finally {
        try {
            db()->query("SELECT RELEASE_LOCK('chb_perf_rollup')");
        } catch (\Throwable $e) {
        }
    }
    return $done;
}

// What Manage → Status shows: the last seven days judged from the raw samples (exact
// percentiles), and each group's daily 75th percentiles for the last PERF_TRACE_DAYS
// finished days from perf_day. Null when the tables are not there yet.
function perf_status(): ?array
{
    try {
        $cols = implode(', ', array_keys(PERF_METRICS));
        $rows = db()->query("SELECT kind, device, $cols FROM perf_samples WHERE created_at >= NOW() - INTERVAL 7 DAY")->fetchAll(PDO::FETCH_ASSOC);
        $days = db()->query('SELECT day, grp, metric, n, p75 FROM perf_day WHERE day >= CURDATE() - INTERVAL ' . PERF_TRACE_DAYS . ' DAY AND day < CURDATE() ORDER BY day')->fetchAll(PDO::FETCH_ASSOC);
        $first = db()->query('SELECT MIN(day) FROM perf_day')->fetchColumn();
    } catch (\Throwable $e) {
        return null;
    }
    [$vals, $views] = perf_bucket($rows);
    $out = perf_judge($vals, $views);
    $trace = [];
    foreach ($days as $r) {
        $trace[(string) $r['grp']][(string) $r['metric']][(string) $r['day']] = [(int) $r['p75'], (int) $r['n']];
    }
    $out['trace'] = $trace;
    $out['since'] = $first ?: null;
    $out['traceDays'] = PERF_TRACE_DAYS;
    $out['minN'] = PERF_MIN_N;
    $out['lines'] = array_map(fn($t) => [$t[0], $t[1]], PERF_METRICS);
    return $out;
}
