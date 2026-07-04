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
//    The aggregation itself lives in analytics-data.php (analytics_summary())
//    so the weekly email digest reports the SAME numbers — no duplicated SQL.
//
//  Tables: pageviews (migration-pageviews.sql + migration-analytics-v2.sql),
//          search_log (migration-analytics-v2.sql).
// ============================================================
require_once __DIR__ . '/analytics-data.php'; // pulls in db.php; provides analytics_summary() + pv_classify_ref()

// A salted one-way fingerprint of the visitor (never stored in the clear).
function pv_ip_hash()
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $salt = defined('APP_SECRET') ? APP_SECRET : 'chb';
    return hash('sha256', $ip . '|' . $ua . '|' . $salt);
}

// Coarse device class from the User-Agent (the raw UA is never stored, only this).
function pv_device()
{
    $ua = strtolower((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    if ($ua === '') {
        return null;
    }
    if (
        preg_match('/ipad|tablet|kindle|silk|playbook|nexus 7|nexus 10/', $ua) ||
        (strpos($ua, 'android') !== false && strpos($ua, 'mobile') === false)
    ) {
        return 'tablet';
    }
    if (preg_match('/mobi|iphone|ipod|android|windows phone|blackberry|opera mini|iemobile/', $ua)) {
        return 'mobile';
    }
    return 'desktop';
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ---- Admin summary ----  (aggregation lives in analytics-data.php so the email digest shares it)
if ($method === 'GET' && ($_GET['action'] ?? '') === 'summary') {
    require_admin();
    $days = max(1, min(365, (int) ($_GET['days'] ?? 30)));
    try {
        json_out(analytics_summary($days));
    } catch (\Throwable $e) {
        json_out(
            ['error' => 'Analytics not ready — has migration-pageviews.sql / migration-analytics-v2.sql been run?'],
            500,
        );
    }
}

// ---- Public: record a view / event / search ----
if ($method === 'POST') {
    // Never count the owner's own activity.
    if (!empty($_SESSION['admin_id'])) {
        json_out(['ok' => true]);
    }

    $in = body();

    // --- Time-on-page beacon: attach a dwell to the visitor's most recent view ---
    if (isset($in['dwell'])) {
        $dwell = (int) $in['dwell'];
        $p = substr(preg_replace('/[?#].*$/', '', clean($in['path'] ?? '')), 0, 255);
        if ($dwell > 0 && $dwell <= 1800000 && $p !== '') {
            try {
                db()
                    ->prepare(
                        'UPDATE pageviews SET dwell_ms = ? WHERE ip_hash = ? AND path = ? AND event IS NULL AND dwell_ms IS NULL AND created_at > (NOW() - INTERVAL 1 HOUR) ORDER BY created_at DESC LIMIT 1',
                    )
                    ->execute([$dwell, pv_ip_hash(), $p]);
            } catch (\Throwable $e) {
                /* column may not be migrated yet; never break */
            }
        }
        json_out(['ok' => true]);
    }

    // --- Search-demand log ---
    if (isset($in['search']) && is_array($in['search'])) {
        $s = $in['search'];
        $mode = in_array($s['mode'] ?? '', ['exact', 'flex'], true) ? $s['mode'] : 'exact';
        $adults = max(0, min(99, (int) ($s['adults'] ?? 0)));
        $children = max(0, min(99, (int) ($s['children'] ?? 0)));
        $nights = isset($s['nights']) && $s['nights'] !== '' ? max(0, min(366, (int) $s['nights'])) : null;
        $month = preg_match('/^\d{4}-\d{2}$/', (string) ($s['month'] ?? '')) ? $s['month'] : null;
        $checkIn = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($s['check_in'] ?? '')) ? $s['check_in'] : null;
        $results = max(0, min(999, (int) ($s['results'] ?? 0)));
        $found = !empty($s['found']) ? 1 : 0;
        try {
            db()
                ->prepare(
                    'INSERT INTO search_log (mode, adults, children, nights, month, check_in, results, found, ip_hash) VALUES (?,?,?,?,?,?,?,?,?)',
                )
                ->execute([$mode, $adults, $children, $nights, $month, $checkIn, $results, $found, pv_ip_hash()]);
        } catch (\Throwable $e) {
            /* analytics must never break the page */
        }
        json_out(['ok' => true]);
    }

    // --- Named intent event OR a page view ---
    $event = preg_replace('/[^a-z_]/', '', strtolower((string) ($in['event'] ?? '')));
    $event = $event === '' ? null : substr($event, 0, 40);
    // Only a known set of events may be stored (so the column can't be spammed).
    if ($event !== null && !in_array($event, ['book_click', 'enquiry_open', 'enquiry_submit', 'pay_start'], true)) {
        json_out(['ok' => true]);
    }

    $path = clean($in['path'] ?? '/');
    $path = substr(preg_replace('/[?#].*$/', '', $path), 0, 255); // drop query/hash, cap length
    if ($path === '') {
        $path = '/';
    }
    $prop = preg_replace('/[^a-z0-9_]/i', '', (string) ($in['prop'] ?? ''));
    $prop = $prop === '' ? null : substr($prop, 0, 32);

    // Campaign attribution: utm_source (letters/digits/space/.-_), capped.
    $source = trim((string) ($in['source'] ?? ''));
    $source = $source === '' ? null : substr(preg_replace('/[^a-z0-9 ._\-]/i', '', $source), 0, 60);

    // Referrer: bare host only (no path/query), and never our own domain.
    $refHost = null;
    $ref = (string) ($in['ref'] ?? ($_SERVER['HTTP_REFERER'] ?? ''));
    if ($ref !== '') {
        $h = parse_url($ref, PHP_URL_HOST);
        if ($h) {
            $h = strtolower(preg_replace('/^www\./', '', $h));
            $self = strtolower(
                preg_replace(
                    '/^www\./',
                    '',
                    (string) parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST),
                ),
            );
            if ($h !== $self) {
                $refHost = substr($h, 0, 190);
            }
        }
    }

    $ipHash = pv_ip_hash();

    try {
        // Light rate-limit: at most ~60 recorded rows per visitor per minute.
        $rl = db()->prepare(
            'SELECT COUNT(*) FROM pageviews WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL 1 MINUTE)',
        );
        $rl->execute([$ipHash]);
        if ((int) $rl->fetchColumn() < 60) {
            // Device class only on ordinary page views; NULL on intent-event rows.
            $device = $event === null ? pv_device() : null;
            db()
                ->prepare(
                    'INSERT INTO pageviews (prop_key, path, referrer_host, ip_hash, event, source, device) VALUES (?,?,?,?,?,?,?)',
                )
                ->execute([$prop, $path, $refHost, $ipHash, $event, $source, $device]);
        }
    } catch (\Throwable $e) {
        /* analytics must never break the page */
    }

    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
