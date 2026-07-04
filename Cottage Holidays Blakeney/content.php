<?php
// ============================================================
//  content.php — editable site content (text, images, galleries).
//  GET                          -> public: all content as { key: value }
//  POST {action:'set', key, value}   -> admin: save one item
//  POST {action:'delete', key}       -> admin: remove one item (revert to default)
//  Values are stored as JSON strings; galleries are JSON arrays of URLs.
// ============================================================
require_once __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $rows = db()->query('SELECT item_key, item_value FROM content')->fetchAll();
    $out = [];
    foreach ($rows as $r) {
        // Never expose private/internal keys publicly: iCal feed URLs (secret
        // calendar links) and per-property arrival info (may contain key-safe
        // codes etc). Admin reads these via the get_all action below.
        if (strpos($r['item_key'], 'ical-feeds-') === 0) {
            continue;
        }
        if (strpos($r['item_key'], 'arrival-') === 0) {
            continue;
        }
        if (strpos($r['item_key'], 'apikey-') === 0) {
            continue;
        } // secret API keys (e.g. tides)
        if (strpos($r['item_key'], 'welcome-') === 0) {
            continue;
        } // in-stay welcome book (may hold Wi-Fi password etc.)
        if ($r['item_key'] === 'notify-emails') {
            continue;
        } // owner alert recipients — never public
        // Cottage GPS coordinates (geo-<propKey>) ARE exposed publicly so the cottage
        // page can show an exact-pin "Where you'll be" map. They're still used
        // server-side for the on-arrival key-code unlock too.
        // Values are stored as JSON; decode so the client gets real types.
        $decoded = json_decode($r['item_value'], true);
        $out[$r['item_key']] = $decoded === null && $r['item_value'] !== 'null' ? $r['item_value'] : $decoded;
    }
    json_out(['content' => $out]);
}

$in = body();
$action = $in['action'] ?? '';
require_admin();

if ($action === 'get_all') {
    // Admin-only: full content including private keys (ical-feeds-*, arrival-*),
    // used by the Settings page editors. Private values are decrypted here.
    $rows = db()->query('SELECT item_key, item_value FROM content')->fetchAll();
    $out = [];
    foreach ($rows as $r) {
        $val = is_private_content_key($r['item_key']) ? decrypt_value($r['item_value']) : $r['item_value'];
        $decoded = json_decode($val, true);
        $out[$r['item_key']] = $decoded === null && $val !== 'null' ? $val : $decoded;
    }
    json_out(['content' => $out]);
}

if ($action === 'set') {
    $key = clean($in['key'] ?? '');
    if ($key === '' || strlen($key) > 190) {
        json_out(['error' => 'Invalid key'], 400);
    }
    // Store the value as JSON so arrays/objects round-trip cleanly.
    $value = json_encode($in['value'] ?? null, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    // Secrets-like keys (arrival info, iCal feed URLs) are encrypted at rest.
    if (is_private_content_key($key)) {
        $value = encrypt_value($value);
    }
    db()
        ->prepare(
            'INSERT INTO content (item_key, item_value) VALUES (?, ?)
                   ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP',
        )
        ->execute([$key, $value]);
    log_activity('content', 'content.set', 'Website content updated: ' . $key, ['entity' => 'content', 'entity_id' => $key]);
    json_out(['ok' => true]);
}

if ($action === 'delete') {
    $key = clean($in['key'] ?? '');
    db()
        ->prepare('DELETE FROM content WHERE item_key = ?')
        ->execute([$key]);
    log_activity('content', 'content.delete', 'Website content removed: ' . $key, ['entity' => 'content', 'entity_id' => $key]);
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
