<?php
// ============================================================
//  ical-import.php — pulls external iCal feeds (Airbnb / Vrbo / Booking.com)
//  and stores their blocked date ranges in ical_blocks, so the public booking
//  form treats those dates as unavailable.
//
//  POST {action:'save_feeds', prop, feeds:[{source,url}, ...]}  (admin)
//      -> save the feed URLs for a property (stored in content table)
//  POST {action:'sync'}                                          (admin)
//  POST {action:'sync', prop:'21a'}                              (admin)
//      -> fetch + parse the feeds now and refresh ical_blocks
//  POST {action:'list', prop}                                    (admin)
//      -> return saved feeds + current block count for a property
//
//  Can also be triggered by a cron job using a secret:
//  ical-import.php?cron=SECRET   (SECRET = APP_SECRET) -> runs sync for all
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php'; // get_rate() for the manual-block property check
require_once __DIR__ . '/ical-lib.php'; // URL/response/parse judgement, unit-tested

// ---- helpers ----
// ical_token() lives in db.php (shared with ical-export.php).
function feeds_key($prop)
{
    return 'ical-feeds-' . $prop;
}

function get_feeds($prop)
{
    $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
    $s->execute([feeds_key($prop)]);
    $row = $s->fetch();
    if (!$row) {
        return [];
    }
    // Feed URLs are encrypted at rest (legacy plaintext passes through).
    $d = json_decode(decrypt_value($row['item_value']), true);
    return is_array($d) ? $d : [];
}


// Fetch a URL (cURL preferred, falls back to file_get_contents).
function fetch_url($url)
{
    if (!ical_url_public($url)) {
        return ['ok' => false, 'error' => 'blocked URL'];
    }
    if (!function_exists('curl_init')) {
        $body = @file_get_contents($url);
        if ($body === false) {
            return ['ok' => false, 'error' => 'fetch failed'];
        }
        return ['ok' => true, 'body' => $body];
    }
    // Follow redirects MANUALLY so EVERY hop is re-validated against the SSRF
    // allow-check. cURL's own FOLLOWLOCATION only validated the first URL — a
    // public host answering "302 → http://169.254.169.254/…" would be followed
    // to an internal target with no IP re-check.
    $current = $url;
    for ($hop = 0; ; $hop++) {
        $ch = curl_init($current);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false, // we follow by hand, re-validating each hop
            // Only ever speak HTTP(S), so a feed can't send us to file://, gopher://, etc.
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_USERAGENT => 'CHB-Calendar-Sync/1.0',
            // Verify the platform's TLS certificate. These feeds gate the public
            // booking form + Pricing Coach, so a MITM mustn't be able to forge them.
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $redir = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL); // absolute, relative Locations resolved
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            return ['ok' => false, 'error' => $err ?: 'fetch failed'];
        }
        if ($code >= 300 && $code < 400 && $redir !== '') {
            if ($hop >= 3) {
                return ['ok' => false, 'error' => 'too many redirects'];
            }
            if (!ical_url_public($redir)) {
                return ['ok' => false, 'error' => 'blocked redirect'];
            }
            $current = $redir;
            continue;
        }
        // An error page is NOT a calendar: without this check a 404/500 body
        // would parse to zero events and wipe the source's blocks — silently
        // reopening dates that are booked on the platform.
        if ($code >= 400) {
            return ['ok' => false, 'error' => 'HTTP ' . $code];
        }
        return ['ok' => true, 'body' => $body];
    }
}




// Sync one property's feeds: refresh ical_blocks from all its feed URLs.
function sync_property($prop)
{
    $feeds = get_feeds($prop);
    $summary = [];
    // Blocks that existed BEFORE this refresh. When an Airbnb/Vrbo reservation is
    // cancelled its block simply vanishes from the feed, so we diff old vs. new to
    // spot the freed dates and notify the waitlist — an external cancellation
    // becomes a direct-booking opportunity.
    $oldRanges = [];
    foreach ($feeds as $f) {
        $source = preg_replace('/[^a-z0-9_]/i', '', $f['source'] ?? 'feed');
        $url = trim($f['url'] ?? '');
        if ($url === '') {
            continue;
        }
        // One decision, stated in ical_feed_usable: anything short of a real
        // calendar KEEPS the blocks we already hold rather than replacing them
        // with nothing.
        $res = fetch_url($url);
        $usable = ical_feed_usable($res);
        if (!$usable['ok']) {
            $summary[] = ['source' => $source, 'ok' => false, 'error' => $usable['error']];
            continue;
        }
        $events = parse_ical($res['body']);
        // Snapshot this source's current blocks (only for feeds we actually refresh,
        // so a failed fetch above never looks like a cancellation).
        try {
            $os = db()->prepare('SELECT check_in, check_out FROM ical_blocks WHERE prop_key = ? AND source = ?');
            $os->execute([$prop, $source]);
            foreach ($os->fetchAll() as $ob) {
                $oldRanges[] = [$ob['check_in'], $ob['check_out']];
            }
        } catch (\Throwable $e) {
        }
        // Replace this source's blocks for this property (clean refresh).
        db()
            ->prepare('DELETE FROM ical_blocks WHERE prop_key = ? AND source = ?')
            ->execute([$prop, $source]);
        $ins = db()->prepare('INSERT INTO ical_blocks (prop_key, source, uid, check_in, check_out) VALUES (?,?,?,?,?)');
        $count = 0;
        foreach ($events as $e) {
            if (!$e['start'] || !$e['end'] || $e['end'] <= $e['start']) {
                continue;
            }
            $ins->execute([$prop, $source, $e['uid'], $e['start'], $e['end']]);
            $count++;
        }
        $summary[] = ['source' => $source, 'ok' => true, 'events' => $count];
    }
    // After every feed is rebuilt, notify the waitlist for any previously-blocked
    // range that is now genuinely free (dates_clash re-checks bookings + all feeds,
    // so a date still held elsewhere won't false-notify). Only future ranges.
    if ($oldRanges) {
        try {
            require_once __DIR__ . '/waitlist.php';
            $today = date('Y-m-d');
            $seen = [];
            foreach ($oldRanges as [$ci, $co]) {
                if (!$ci || !$co || $co <= $today) {
                    continue;
                }
                $key = $ci . '|' . $co;
                if (isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = 1;
                if (!dates_clash($prop, $ci, $co)) {
                    waitlist_notify_freed($prop, $ci, $co);
                }
            }
        } catch (\Throwable $e) {
        }
    }
    ical_record_status($prop, $summary);
    return $summary;
}

// Persist a per-feed health snapshot (owner-only content key, see
// is_internal_content_key) so the back office can show "checked X ago /
// failing since Y" — and nudge the owner when a feed KEEPS failing. A dead
// feed means the imported availability quietly goes stale, which is exactly
// how a double-booking happens; the daily cron discards sync_property()'s
// summary, so without this nobody would ever know.
function ical_record_status($prop, $summary)
{
    try {
        $key = 'ical-status-' . $prop;
        $prev = content_json($key, []);
        $prevSources = is_array($prev['sources'] ?? null) ? $prev['sources'] : [];
        $now = date('Y-m-d H:i:s');
        $sources = [];
        foreach ($summary as $r) {
            $src = $r['source'];
            $fails = $r['ok'] ? 0 : (int) ($prevSources[$src]['fails'] ?? 0) + 1;
            $sources[$src] = [
                'ok' => (bool) $r['ok'],
                'fails' => $fails,
                'at' => $now,
                // Keep the last good figures through a failure, so the UI can
                // say "still using the 4 ranges from Tuesday".
                'events' => $r['ok'] ? (int) $r['events'] : (int) ($prevSources[$src]['events'] ?? 0),
                'ok_at' => $r['ok'] ? $now : (string) ($prevSources[$src]['ok_at'] ?? ''),
                'error' => $r['ok'] ? '' : mb_substr((string) $r['error'], 0, 160),
            ];
            // Alert on the SECOND consecutive failure (platforms hiccup; one
            // blip self-heals tomorrow), then re-nudge weekly while broken.
            if ($fails === 2 || ($fails > 2 && ($fails - 2) % 7 === 0)) {
                $name = prop_display($prop)['name'];
                log_activity(
                    'calendar',
                    'ical.feed.failing',
                    ucfirst($src) . ' calendar feed for ' . $name . ' has failed ' . $fails . ' syncs in a row (' . $sources[$src]['error'] . ') — its imported availability is stale',
                    ['severity' => 'warn', 'prop_key' => $prop, 'entity' => 'ical'],
                );
                try {
                    require_once __DIR__ . '/webpush.php';
                    alert_owner('Calendar sync failing', $name . ': the ' . $src . ' link isn\'t working — check it in Manage → Calendar sync.', ['category' => 'urgent', 'email' => true, 'tag' => 'ical', 'url' => './?open=calendar']);
                } catch (\Throwable $e) {
                }
            }
        }
        $val = json_encode(['at' => $now, 'sources' => $sources], JSON_UNESCAPED_SLASHES);
        db()
            ->prepare(
                'INSERT INTO content (item_key, item_value) VALUES (?, ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP',
            )
            ->execute([$key, $val]);
    } catch (\Throwable $e) {
        // Status is best-effort — never let bookkeeping break the sync itself.
    }
}

// ---- cron entry (no login; protected by secret) ----
if (isset($_GET['cron'])) {
    header('Content-Type: text/plain; charset=utf-8');
    if (!hash_equals(APP_SECRET, (string) ($_GET['cron'] ?? ''))) {
        http_response_code(403);
        echo 'Forbidden';
        exit();
    }
    $props = db()->query('SELECT prop_key FROM properties WHERE archived_at IS NULL')->fetchAll(PDO::FETCH_COLUMN);
    foreach ($props as $p) {
        sync_property($p);
    }
    log_activity('calendar', 'ical.sync', 'External calendars synced (' . count($props) . ' cottages)', ['actor' => 'cron']);
    echo 'Synced ' . count($props) . ' properties at ' . date('Y-m-d H:i:s');
    exit();
}

// ---- admin actions ----
$in = body();
$action = $in['action'] ?? '';
require_admin();

if ($action === 'save_feeds') {
    $prop = preg_replace('/[^a-z0-9_]/i', '', $in['prop'] ?? '');
    if ($prop === '') {
        json_out(['error' => 'Property required'], 400);
    }
    $feeds = [];
    foreach ($in['feeds'] ?? [] as $f) {
        $url = trim($f['url'] ?? '');
        $source = preg_replace('/[^a-z0-9_]/i', '', $f['source'] ?? 'feed');
        if ($url !== '') {
            $feeds[] = ['source' => $source, 'url' => $url];
        }
    }
    $val = encrypt_value(json_encode($feeds, JSON_UNESCAPED_SLASHES));
    db()
        ->prepare(
            'INSERT INTO content (item_key, item_value) VALUES (?, ?)
                   ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP',
        )
        ->execute([feeds_key($prop), $val]);
    json_out(['ok' => true]);
}

if ($action === 'sync') {
    $prop = preg_replace('/[^a-z0-9_]/i', '', $in['prop'] ?? '');
    if ($prop !== '') {
        $result = sync_property($prop);
        log_activity('calendar', 'ical.sync', 'External calendar refreshed', ['prop_key' => $prop, 'entity' => 'ical']);
        json_out(['ok' => true, 'result' => $result]);
    }
    $props = db()->query('SELECT prop_key FROM properties WHERE archived_at IS NULL')->fetchAll(PDO::FETCH_COLUMN);
    $all = [];
    foreach ($props as $p) {
        $all[$p] = sync_property($p);
    }
    log_activity('calendar', 'ical.sync', 'External calendars refreshed (' . count($props) . ' cottages)', ['entity' => 'ical']);
    json_out(['ok' => true, 'result' => $all]);
}

if ($action === 'blocks') {
    // Return every imported external block so the back-office calendar can show
    // them as "taken", colour-coded by property.
    $rows = db()
        ->query('SELECT id, prop_key, source, check_in, check_out FROM ical_blocks ORDER BY check_in ASC')
        ->fetchAll();
    json_out(['ok' => true, 'blocks' => $rows]);
}

if ($action === 'add_block') {
    // Owner-created manual block (maintenance / personal use). Stored like an
    // imported block with source 'owner' so the calendar shows the dates as taken.
    $prop = preg_replace('/[^a-z0-9_]/i', '', $in['prop'] ?? '');
    $checkIn = clean($in['check_in'] ?? '');
    $checkOut = clean($in['check_out'] ?? '');
    if (!get_rate($prop)) {
        json_out(['error' => 'Unknown property'], 400);
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $checkIn) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $checkOut)) {
        json_out(['error' => 'Valid from/to dates are required'], 400);
    }
    if ($checkOut <= $checkIn) {
        json_out(['error' => 'The end date must be after the start date'], 400);
    }
    if (dates_clash($prop, $checkIn, $checkOut)) {
        json_out(['error' => 'Those dates overlap an existing booking or block.'], 409);
    }
    $uid = 'owner-' . bin2hex(random_bytes(8));
    db()
        ->prepare('INSERT INTO ical_blocks (prop_key, source, uid, check_in, check_out) VALUES (?,?,?,?,?)')
        ->execute([$prop, 'owner', $uid, $checkIn, $checkOut]);
    json_out(['ok' => true]);
}

if ($action === 'delete_block') {
    // Free an OWNER block. Restricted to source='owner' on purpose: an imported
    // platform block is owned by the sync, and deleting one would read the cottage
    // as FREE to dates_clash and availability.php until the next import — a real
    // double-booking window opened by a mis-fired id. (The sync re-imports it
    // anyway, so the delete would achieve nothing but that window.)
    $id = (int) ($in['id'] ?? 0);
    if ($id <= 0) {
        json_out(['error' => 'A block id is required'], 400);
    }
    $del = db()->prepare("DELETE FROM ical_blocks WHERE id = ? AND source = 'owner'");
    $del->execute([$id]);
    if ($del->rowCount() < 1) {
        json_out(['error' => "Those dates are held by a connected calendar, so they can't be freed here — they clear when that booking does."], 409);
    }
    log_activity('booking', 'block.removed', 'Blocked dates freed', ['entity' => 'block', 'entity_id' => (string) $id]);
    json_out(['ok' => true]);
}

if ($action === 'list') {
    $prop = preg_replace('/[^a-z0-9_]/i', '', $in['prop'] ?? '');
    $s = db()->prepare('SELECT COUNT(*) c FROM ical_blocks WHERE prop_key = ?');
    $s->execute([$prop]);
    // The absolute export URL the owner pastes into Airbnb/Booking.com —
    // site_base_url() (trusted-host + proxy-aware), because a URL built off a
    // wrong Host header hands the platform a feed address that never resolves.
    $exportUrl = site_base_url() . 'ical-export.php?prop=' . $prop . '&token=' . ical_token($prop);
    json_out([
        'ok' => true,
        'feeds' => get_feeds($prop),
        'blocks' => (int) $s->fetch()['c'],
        'export_url' => $exportUrl,
        'status' => content_json('ical-status-' . $prop, []),
    ]);
}

json_out(['error' => 'Unknown action'], 400);
