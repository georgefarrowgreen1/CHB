<?php
// ============================================================
//  ical-import.php — pulls external iCal feeds (Airbnb / Vrbo) and stores
//  their blocked date ranges in ical_blocks, so the public booking form
//  treats those dates as unavailable.
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

// Is this an http(s) URL to a PUBLIC host? Blocks SSRF to internal/loopback/
// link-local targets (169.254.x, 127.x, 10.x, 192.168.x, …) even though only an
// admin sets the feed URL — trusted-user SSRF is still worth closing.
function ical_url_public($url)
{
    $u = parse_url((string) $url);
    if (!$u || !in_array(strtolower($u['scheme'] ?? ''), ['http', 'https'], true) || empty($u['host'])) {
        return false;
    }
    $host = $u['host'];
    $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : gethostbyname($host);
    if (
        filter_var($ip, FILTER_VALIDATE_IP) &&
        !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)
    ) {
        return false; // resolves to a private/reserved address
    }
    return true;
}

// Fetch a URL (cURL preferred, falls back to file_get_contents).
function fetch_url($url)
{
    if (!ical_url_public($url)) {
        return ['ok' => false, 'error' => 'blocked URL'];
    }
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            // Only ever speak HTTP(S) — and only follow redirects to HTTP(S), so a
            // feed can't redirect us to file://, gopher://, etc.
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_USERAGENT => 'CHB-Calendar-Sync/1.0',
            // Verify the platform's TLS certificate. These feeds gate the public
            // booking form + Pricing Coach, so a MITM mustn't be able to forge them.
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $body = curl_exec($ch);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            return ['ok' => false, 'error' => $err ?: 'fetch failed'];
        }
        return ['ok' => true, 'body' => $body];
    }
    $body = @file_get_contents($url);
    if ($body === false) {
        return ['ok' => false, 'error' => 'fetch failed'];
    }
    return ['ok' => true, 'body' => $body];
}

// Parse an iCal string into [['uid'=>, 'start'=>'YYYY-MM-DD', 'end'=>'YYYY-MM-DD'], ...]
function parse_ical($text)
{
    // Unfold folded lines (continuation lines begin with a space or tab).
    $text = preg_replace("/\r\n[ \t]/", '', $text);
    $text = preg_replace("/\n[ \t]/", '', $text);
    $lines = preg_split("/\r\n|\n|\r/", $text);
    $events = [];
    $cur = null;
    foreach ($lines as $line) {
        if (strpos($line, 'BEGIN:VEVENT') === 0) {
            $cur = ['uid' => null, 'start' => null, 'end' => null];
            continue;
        }
        if (strpos($line, 'END:VEVENT') === 0) {
            if ($cur && $cur['start'] && $cur['end']) {
                $events[] = $cur;
            }
            $cur = null;
            continue;
        }
        if ($cur === null) {
            continue;
        }
        if (strpos($line, 'UID') === 0) {
            $cur['uid'] = substr($line, strpos($line, ':') + 1);
        } elseif (strpos($line, 'DTSTART') === 0) {
            $cur['start'] = ical_date(substr($line, strpos($line, ':') + 1));
        } elseif (strpos($line, 'DTEND') === 0) {
            $cur['end'] = ical_date(substr($line, strpos($line, ':') + 1));
        }
    }
    return $events;
}

// Normalise an iCal date/datetime value to YYYY-MM-DD.
function ical_date($v)
{
    $v = trim($v);
    if (preg_match('/(\d{4})(\d{2})(\d{2})/', $v, $m)) {
        return $m[1] . '-' . $m[2] . '-' . $m[3];
    }
    return null;
}

// Sync one property's feeds: refresh ical_blocks from all its feed URLs.
function sync_property($prop)
{
    $feeds = get_feeds($prop);
    $summary = [];
    foreach ($feeds as $f) {
        $source = preg_replace('/[^a-z0-9_]/i', '', $f['source'] ?? 'feed');
        $url = trim($f['url'] ?? '');
        if ($url === '') {
            continue;
        }
        $res = fetch_url($url);
        if (!$res['ok']) {
            $summary[] = ['source' => $source, 'ok' => false, 'error' => $res['error']];
            continue;
        }
        $events = parse_ical($res['body']);
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
    return $summary;
}

// ---- cron entry (no login; protected by secret) ----
if (isset($_GET['cron'])) {
    header('Content-Type: text/plain; charset=utf-8');
    if (!hash_equals(APP_SECRET, $_GET['cron'])) {
        http_response_code(403);
        echo 'Forbidden';
        exit();
    }
    $props = db()->query('SELECT prop_key FROM properties')->fetchAll(PDO::FETCH_COLUMN);
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
    $props = db()->query('SELECT prop_key FROM properties')->fetchAll(PDO::FETCH_COLUMN);
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
    // Remove a single imported block by id. Note: if the booking still exists on
    // the platform's feed, a future sync may re-import it.
    $id = (int) ($in['id'] ?? 0);
    if ($id <= 0) {
        json_out(['error' => 'A block id is required'], 400);
    }
    db()
        ->prepare('DELETE FROM ical_blocks WHERE id = ?')
        ->execute([$id]);
    json_out(['ok' => true]);
}

if ($action === 'list') {
    $prop = preg_replace('/[^a-z0-9_]/i', '', $in['prop'] ?? '');
    $s = db()->prepare('SELECT COUNT(*) c FROM ical_blocks WHERE prop_key = ?');
    $s->execute([$prop]);
    // Build the absolute export URL for this property's feed.
    $scheme = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    $dir = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? ''), '/');
    $exportUrl = $scheme . '://' . $host . $dir . '/ical-export.php?prop=' . $prop . '&token=' . ical_token($prop);
    json_out([
        'ok' => true,
        'feeds' => get_feeds($prop),
        'blocks' => (int) $s->fetch()['c'],
        'export_url' => $exportUrl,
    ]);
}

json_out(['error' => 'Unknown action'], 400);
