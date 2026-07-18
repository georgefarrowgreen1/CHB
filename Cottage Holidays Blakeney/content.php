<?php
// ============================================================
//  content.php — editable site content (text, images, galleries).
//  GET                          -> public: all content as { key: value }
//  POST {action:'set', key, value}   -> admin: save one item
//  POST {action:'delete', key}       -> admin: remove one item (revert to default)
//  Values are stored as JSON strings; galleries are JSON arrays of URLs.
// ============================================================
require_once __DIR__ . '/db.php';

// The GET payload, as a function so bootstrap.php can serve the SAME data in
// its combined first-paint response without duplicating this logic.
function content_public_payload()
{
    // Admin sessions get everything (the Settings UI reads chat-away-*/
    // admin-2fa-enabled from siteContent). Public visitors get only editor
    // content — never encrypted secrets or operational/internal keys. This
    // list-and-skip fails CLOSED against the internal keys below because the
    // GET always excludes both key classes for the public.
    $isAdmin = !empty($_SESSION['admin_id']);
    $rows = db()->query('SELECT item_key, item_value FROM content')->fetchAll();
    $out = [];
    foreach ($rows as $r) {
        $key = $r['item_key'];
        // Encrypted-at-rest secrets (iCal feed URLs, arrival codes, API keys,
        // in-stay welcome book): never expose the ciphertext to ANYONE here.
        // Admin reads + decrypts these via the get_all action below.
        if (is_private_content_key($key)) {
            continue;
        }
        // Operational/internal keys (owner IP/browser, last correspondent,
        // deployment fingerprint, alert recipients, cron watermarks, away/2FA
        // toggles): admin only, never public.
        if (!$isAdmin && is_internal_content_key($key)) {
            continue;
        }
        // Cottage GPS coordinates (geo-<propKey>) ARE exposed publicly so the cottage
        // page can show an exact-pin "Where you'll be" map. They're still used
        // server-side for the on-arrival key-code unlock too.
        // Values are stored as JSON; decode so the client gets real types.
        $decoded = json_decode($r['item_value'], true);
        $out[$key] = $decoded === null && $r['item_value'] !== 'null' ? $r['item_value'] : $decoded;
    }
    return ['content' => $out];
}

// When bootstrap.php includes this file for the payload helper, stop before the
// HTTP routing — the routes below run only when this file IS the request.
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'content.php') {
    return;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Public traffic doubles as the cron dead-man's-switch heartbeat: if the daily
    // automation has silently stopped, this pushes the owner an alert even when
    // they're not in the back office. Throttled + best-effort (see db.php); runs
    // after building the payload so it can never delay or break the response.
    $payload = content_public_payload();
    cron_watchdog_maybe_alert();
    json_out($payload);
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
        // Server-only secrets that have NO editor field (the Square webhook signing
        // key is captured + used entirely server-side) are never decrypted into the
        // browser payload — the Settings UI never needs them, so don't ship them.
        if ($r['item_key'] === 'apikey-square-webhook') {
            continue;
        }
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
    // The search assistant's sync keys update quietly in the background on every
    // taught phrasing / dead-end — logging each write would drown the activity
    // feed. Real content edits keep their audit line.
    if (!in_array($key, ['nlu-learned', 'nlu-suppressed', 'search-misses'], true)) {
        log_activity('content', 'content.set', 'Website content updated: ' . $key, ['entity' => 'content', 'entity_id' => $key]);
    }
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
