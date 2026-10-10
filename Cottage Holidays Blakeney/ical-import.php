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

// The whole list, encrypted at rest. Callers hold content_locked(feeds_key($prop)).
function feeds_save($prop, array $feeds)
{
    db()
        ->prepare(
            'INSERT INTO content (item_key, item_value) VALUES (?, ?)
                   ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP',
        )
        ->execute([feeds_key($prop), encrypt_value(json_encode($feeds, JSON_UNESCAPED_SLASHES))]);
}


// Fetch a calendar. Every hop (redirects are followed by hand) is checked by
// ical_url_resolve and the connection PINNED to the address that was checked, the
// body is capped at ICAL_MAX_BYTES, and an error status is a failure, never a body.
// cURL only: the app already needs it (square_api, cron), and the old
// file_get_contents fallback followed redirects without checking them.
function fetch_url($url)
{
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'error' => 'this server cannot fetch calendars (cURL is missing)'];
    }
    $current = $url;
    for ($hop = 0; ; $hop++) {
        $where = ical_url_resolve($current);
        if (!$where['ok']) {
            return ['ok' => false, 'error' => $hop === 0 ? 'blocked URL' : 'blocked redirect'];
        }
        $ch = curl_init($current);
        $buf = '';
        $tooBig = false;
        $opts = [
            CURLOPT_FOLLOWLOCATION => false, // followed by hand, each hop re-checked
            // Only ever speak HTTP(S), so a feed can't send us to file://, gopher://, etc.
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_USERAGENT => 'CHB-Calendar-Sync/1.0',
            // Verify the platform's TLS certificate. These feeds gate the public
            // booking form + Pricing Coach, so a MITM mustn't be able to forge them.
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$buf, &$tooBig) {
                if (strlen($buf) + strlen($chunk) > ICAL_MAX_BYTES) {
                    $tooBig = true;
                    return 0; // stops the transfer
                }
                $buf .= $chunk;
                return strlen($chunk);
            },
        ];
        if (!filter_var($where['host'], FILTER_VALIDATE_IP)) {
            $ip = $where['ips'][0];
            $opts[CURLOPT_RESOLVE] = [$where['host'] . ':' . $where['port'] . ':' . (strpos($ip, ':') !== false ? '[' . $ip . ']' : $ip)];
        }
        curl_setopt_array($ch, $opts);
        $done = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $redir = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL); // absolute, relative Locations resolved
        $err = curl_error($ch);
        curl_close($ch);
        if ($tooBig) {
            return ['ok' => false, 'error' => 'the calendar is too large (over ' . (ICAL_MAX_BYTES >> 20) . ' MB) — check the link'];
        }
        if ($done === false) {
            return ['ok' => false, 'error' => $err ?: 'fetch failed'];
        }
        if ($code >= 300 && $code < 400 && $redir !== '') {
            if ($hop >= 3) {
                return ['ok' => false, 'error' => 'too many redirects'];
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
        return ['ok' => true, 'body' => $buf];
    }
}




// Has migration-124 added `kind`/`label`? Probed once per request.
function ical_has_kind()
{
    static $has = null;
    if ($has === null) {
        try {
            $has = db()->query("SHOW COLUMNS FROM ical_blocks LIKE 'kind'")->fetch() ? true : false;
        } catch (\Throwable $e) {
            $has = false;
        }
    }
    return $has;
}

// Every imported block for the back office — with what it is, where the column exists.
function ical_blocks_rows()
{
    $cols = ical_has_kind() ? 'id, prop_key, source, check_in, check_out, kind, label' : 'id, prop_key, source, check_in, check_out';
    return db()->query("SELECT $cols FROM ical_blocks ORDER BY check_in ASC")->fetchAll();
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
        // Every event read, or none: rebuilding from the events that parsed would free
        // the nights of every one that did not, and tell the waitlist they were free.
        $parsed = ical_parse_feed($res['body']);
        if ($parsed['unreadable'] > 0) {
            $n = (int) $parsed['unreadable'];
            $summary[] = ['source' => $source, 'ok' => false, 'error' => 'couldn\'t read ' . $n . ' event' . ($n === 1 ? '' : 's') . ' in this calendar — nothing was changed'];
            continue;
        }
        $events = $parsed['events'];
        // `kind`/`label` only where migration-124 has run — a missing column must
        // never stop the sync (it is what keeps the calendar from reading free).
        $hasKind = ical_has_kind();
        // The rows this feed would write. An over-long UID from a non-platform
        // feed would abort the whole write; the column is the identity, not the
        // payload.
        $newRows = [];
        foreach ($events as $e) {
            if (!$e['start'] || !$e['end'] || $e['end'] <= $e['start']) {
                continue;
            }
            $newRows[] = [
                'uid' => mb_substr((string) ($e['uid'] ?? ''), 0, 190),
                'check_in' => $e['start'],
                'check_out' => $e['end'],
                'kind' => $hasKind ? ical_classify($e['summary'] ?? '', $e['description'] ?? '') : '',
                'label' => $hasKind ? ical_label($e['summary'] ?? '') : '',
            ];
        }
        // Snapshot this source's current blocks (only for feeds we actually refresh,
        // so a failed fetch above never looks like a cancellation). Unreadable
        // reads as "different", so the sync rewrites rather than trusting nothing.
        $oldRows = null;
        try {
            $os = db()->prepare('SELECT check_in, check_out, uid' . ($hasKind ? ', kind, label' : '') . ' FROM ical_blocks WHERE prop_key = ? AND source = ?');
            $os->execute([$prop, $source]);
            $oldRows = $os->fetchAll();
        } catch (\Throwable $e) {
        }
        // A CALENDAR THAT HAS NOT CHANGED IS LEFT ALONE. The sync runs from the
        // daily cron, every back-office visit and Sync now, and almost every run
        // finds the same stays: rewriting them was a delete and an insert per stay
        // for nothing, and it made the back office reload everything it had just
        // loaded. `changed` tells it whether to.
        if ($oldRows !== null && ical_block_sig($oldRows) === ical_block_sig($newRows)) {
            $summary[] = ['source' => $source, 'ok' => true, 'events' => count($newRows), 'changed' => false];
            continue;
        }
        foreach ((array) $oldRows as $ob) {
            $oldRanges[] = [$ob['check_in'], $ob['check_out']];
        }
        // Replace this source's blocks for this property — ATOMICALLY. This was a
        // bare DELETE followed by N INSERTs, and it is the one write deciding
        // availability that did not take a lock: every reader of ical_blocks
        // (dates_clash, availability.php, the enquiry guard) sees the table
        // mid-rebuild, so a clash check landing in that window reads a live Airbnb
        // stay as FREE and lets a booking through. The window is not theoretical —
        // the sync fires from the daily cron, from autoSyncIcalBlocks on every back
        // office load, and from "Sync now", i.e. while the owner is using the app.
        // A transaction also means a mid-loop failure ROLLS BACK to the previous
        // blocks rather than leaving the source deleted, which is the same
        // never-empty-the-calendar rule ical_feed_usable enforces on the fetch.
        $pdo = db();
        try {
            $pdo->beginTransaction();
            $pdo->prepare('DELETE FROM ical_blocks WHERE prop_key = ? AND source = ?')->execute([$prop, $source]);
            $ins = $hasKind
                ? $pdo->prepare('INSERT INTO ical_blocks (prop_key, source, uid, check_in, check_out, kind, label) VALUES (?,?,?,?,?,?,?)')
                : $pdo->prepare('INSERT INTO ical_blocks (prop_key, source, uid, check_in, check_out) VALUES (?,?,?,?,?)');
            $count = 0;
            foreach ($newRows as $nr) {
                $row = [$prop, $source, $nr['uid'], $nr['check_in'], $nr['check_out']];
                if ($hasKind) {
                    $row[] = $nr['kind'];
                    $row[] = $nr['label'];
                }
                $ins->execute($row);
                $count++;
            }
            $pdo->commit();
        } catch (\Throwable $ex) {
            try {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
            } catch (\Throwable $e2) {
            }
            // The feed reads as failing rather than as empty, and the OLD blocks
            // stand. ical_record_status is called ONCE with the whole summary at the
            // foot of this function, so a failing row here is all that is needed —
            // calling it per source would overwrite the other feeds' entries.
            $summary[] = ['source' => $source, 'ok' => false, 'error' => 'could not rebuild blocks'];
            continue;
        }
        $summary[] = ['source' => $source, 'ok' => true, 'events' => $count, 'changed' => true];
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
        // Decided and stored as ONE step: two syncs finishing together (the cron and
        // a device's) each read the old stamps and both alerted.
        $due = content_locked($key, function () use ($key, $summary) {
            $prev = content_json($key, []);
            $prevSources = is_array($prev['sources'] ?? null) ? $prev['sources'] : [];
            $now = date('Y-m-d H:i:s');
            $sources = [];
            $due = [];
            foreach ($summary as $r) {
                $src = $r['source'];
                $prevSrc = is_array($prevSources[$src] ?? null) ? $prevSources[$src] : [];
                $fails = $r['ok'] ? 0 : (int) ($prevSrc['fails'] ?? 0) + 1;
                // When to tell the owner is decided by TIME, not by how many syncs ran
                // (ical_feed_alert): once a failure has lasted, then weekly.
                $alert = ical_feed_alert($prevSrc, (bool) $r['ok'], $now);
                $sources[$src] = [
                    'ok' => (bool) $r['ok'],
                    'fails' => $fails,
                    'at' => $now,
                    // Keep the last good figures through a failure, so the UI can
                    // say "still using the 4 ranges from Tuesday".
                    'events' => $r['ok'] ? (int) $r['events'] : (int) ($prevSrc['events'] ?? 0),
                    'ok_at' => $r['ok'] ? $now : (string) ($prevSrc['ok_at'] ?? ''),
                    'error' => $r['ok'] ? '' : mb_substr((string) $r['error'], 0, 160),
                    'fail_since' => $alert['fail_since'],
                    'alerted_at' => $alert['alerted_at'],
                ];
                if ($alert['due']) {
                    $due[] = $sources[$src] + ['source' => $src];
                }
            }
            $val = json_encode(['at' => $now, 'sources' => $sources], JSON_UNESCAPED_SLASHES);
            db()
                ->prepare(
                    'INSERT INTO content (item_key, item_value) VALUES (?, ?)
                           ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP',
                )
                ->execute([$key, $val]);
            return $due;
        });
        foreach ((array) $due as $d) {
            $src = (string) $d['source'];
            $name = prop_display($prop)['name'];
            log_activity(
                'calendar',
                'ical.feed.failing',
                ucfirst($src) . ' calendar feed for ' . $name . ' has been failing since ' . $d['fail_since'] . ' (' . $d['error'] . ') — its imported availability is stale',
                ['severity' => 'warn', 'prop_key' => $prop, 'entity' => 'ical'],
            );
            try {
                require_once __DIR__ . '/webpush.php';
                alert_owner('Calendar sync failing', $name . ': the ' . $src . ' link isn\'t working — check it in Manage → Calendar sync.', ['category' => 'urgent', 'email' => true, 'tag' => 'ical', 'url' => './?open=calendar']);
            } catch (\Throwable $e) {
            }
        }
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

// SAVING A LINK ADDS OR REPLACES THAT LINK, and never drops another. The list used to
// be replaced whole from the page's copy, which is often stale (a second device, or
// a link added on another screen since the page loaded), and every source missing
// from it was dropped with its stays: those dates read as free here while the
// platform still had the guests. Removing one is unlink_feed, its own question.
if ($action === 'save_feeds') {
    $prop = preg_replace('/[^a-z0-9_]/i', '', $in['prop'] ?? '');
    if ($prop === '') {
        json_out(['error' => 'Property required'], 400);
    }
    $posted = [];
    foreach ($in['feeds'] ?? [] as $f) {
        $url = trim((string) ($f['url'] ?? ''));
        $source = preg_replace('/[^a-z0-9_]/i', '', (string) ($f['source'] ?? 'feed'));
        if ($url !== '' && $source !== '') {
            $posted[$source] = $url;
        }
    }
    content_locked(feeds_key($prop), function () use ($prop, $posted) {
        $feeds = [];
        foreach (get_feeds($prop) as $f) {
            $src = (string) ($f['source'] ?? '');
            if ($src !== '') {
                $feeds[$src] = ['source' => $src, 'url' => (string) ($posted[$src] ?? ($f['url'] ?? ''))];
                unset($posted[$src]);
            }
        }
        foreach ($posted as $src => $url) {
            $feeds[$src] = ['source' => $src, 'url' => $url];
        }
        feeds_save($prop, array_values($feeds));
    });
    json_out(['ok' => true]);
}

// Unlinking ONE platform: its link goes and its stays come off this calendar (dates a
// sync can no longer refresh would otherwise stay refused for ever).
if ($action === 'unlink_feed') {
    $prop = preg_replace('/[^a-z0-9_]/i', '', $in['prop'] ?? '');
    $source = preg_replace('/[^a-z0-9_]/i', '', (string) ($in['source'] ?? ''));
    if ($prop === '' || $source === '' || $source === 'owner') {
        json_out(['error' => 'Say which platform to unlink.'], 400);
    }
    content_locked(feeds_key($prop), function () use ($prop, $source) {
        feeds_save($prop, array_values(array_filter(get_feeds($prop), fn($f) => (string) ($f['source'] ?? '') !== $source)));
    });
    try {
        db()->prepare('DELETE FROM ical_blocks WHERE prop_key = ? AND source = ?')->execute([$prop, $source]);
    } catch (\Throwable $e) {
        /* table not migrated yet — nothing to clean */
    }
    log_activity('calendar', 'ical.unlink', 'Unlinked ' . $source . ' from ' . $prop, ['prop_key' => $prop, 'entity' => 'ical']);
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
    json_out(['ok' => true, 'blocks' => ical_blocks_rows()]);
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
    // Serialise the check-and-insert under the same lock add/update/approval hold,
    // or a block could land over a booking whose row was still in flight on another
    // device (the clash check passing against an uncommitted booking).
    if (!book_lock($prop)) {
        json_out(['error' => 'The calendar is busy for this cottage — please try again in a moment.'], 409);
    }
    if (dates_clash($prop, $checkIn, $checkOut)) {
        book_unlock($prop);
        json_out(['error' => 'Those dates overlap an existing booking or block.'], 409);
    }
    $uid = 'owner-' . bin2hex(random_bytes(8));
    db()
        ->prepare('INSERT INTO ical_blocks (prop_key, source, uid, check_in, check_out) VALUES (?,?,?,?,?)')
        ->execute([$prop, 'owner', $uid, $checkIn, $checkOut]);
    book_unlock($prop);
    // Blocks never left a record before — worth one regardless.
    log_activity('booking', 'block.add', 'Dates blocked — ' . $prop . ' ' . $checkIn . ' → ' . $checkOut, ['prop_key' => $prop]);
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
    // A block partially covered by a booking is shown as SEGMENTS on the timeline
    // (suppressBlocksUnderLocalBookings), so the tap may mean "free just this
    // segment". When a from/to range is given, free only that span: delete the row
    // and re-insert the parts outside it — without this, freeing one segment
    // deleted the whole block and put the un-named remainder back on sale, and the
    // synthetic-id second segment freed nothing at all.
    $from = clean($in['from'] ?? '');
    $to = clean($in['to'] ?? '');
    $ranged = preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) && $to > $from;
    $row = db()->prepare("SELECT prop_key, check_in, check_out FROM ical_blocks WHERE id = ? AND source = 'owner'");
    $row->execute([$id]);
    $blk = $row->fetch();
    if (!$blk) {
        json_out(['error' => "Those dates are held by a connected calendar, so they can't be freed here — they clear when that booking does."], 409);
    }
    // One step: a reader between the delete and the re-insert would see the held
    // remainder as free.
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $pdo->prepare("DELETE FROM ical_blocks WHERE id = ? AND source = 'owner'")->execute([$id]);
        if ($ranged) {
            // Re-insert the held remainder either side of the freed span.
            $ins = $pdo->prepare('INSERT INTO ical_blocks (prop_key, source, uid, check_in, check_out) VALUES (?,?,?,?,?)');
            if ((string) $blk['check_in'] < $from) {
                $ins->execute([$blk['prop_key'], 'owner', 'owner-' . bin2hex(random_bytes(8)), $blk['check_in'], $from]);
            }
            if ($to < (string) $blk['check_out']) {
                $ins->execute([$blk['prop_key'], 'owner', 'owner-' . bin2hex(random_bytes(8)), $to, $blk['check_out']]);
            }
        }
        $pdo->commit();
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
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

if ($action === 'overview') {
    // Every live cottage's links + per-platform health in ONE round trip, so the
    // Calendar sync page can show each platform's state without a request per
    // cottage. Same reads as 'list', looped.
    $props = db()->query('SELECT prop_key FROM properties WHERE archived_at IS NULL')->fetchAll(PDO::FETCH_COLUMN);
    $out = [];
    foreach ($props as $p) {
        $out[$p] = [
            'feeds' => get_feeds($p),
            'status' => content_json('ical-status-' . $p, []),
            'export_url' => site_base_url() . 'ical-export.php?prop=' . $p . '&token=' . ical_token($p),
        ];
    }
    json_out(['ok' => true, 'props' => (object) $out]);
}

json_out(['error' => 'Unknown action'], 400);
