<?php
// ============================================================
//  content.php — editable site content (text, images, galleries).
//  GET                          -> public: all content as { key: value }
//  POST {action:'set', key, value}   -> admin: save one item
//  POST {action:'delete', key}       -> admin: remove one item (revert to default)
//  Values are stored as JSON strings; galleries are JSON arrays of URLs.
// ============================================================
require_once __DIR__ . '/db.php';

// The operational caches and lists a VISITOR's read leaves in the database (see
// content_public_payload). Every name and prefix here is one the public filter drops
// anyway, so leaving it out cannot change what a visitor gets: integration §72 asserts
// that of each, so a public key can never be listed by mistake. An internal key missing
// from the list is merely fetched and dropped, as every key used to be.
const CONTENT_VISITOR_SKIP = [
    'square-payouts', 'square-bank', 'mailbox-seen', 'mailbox-new', 'mailbox-poll',
    'email-optout', 'inbox-state', 'activity-seen', 'uptime-history', 'weather-cache',
    'nlu-learned', 'nlu-suppressed', 'search-misses', 'search-undo', 'search-pins',
    'search-watchers', 'search-canon', 'guest-faq-misses', 'mail-sent-days', 'notify-prefs',
    'mac-chat', 'mac-chat-memory', 'mac-chat-imports', 'mac-chat-sum', 'night-shift',
    'chat-handoff', 'email-templates', 'sweep-moved', 'sweep-landed', 'duty-dismissed',
    'testcentre-staged', 'bank-statements', 'money-split', 'conflict-audit-state', 'self-repair-state',
    'anniv-sent',
];
const CONTENT_VISITOR_SKIP_PREFIX = ['welcome-', 'arrival-', 'ops-', 'keysafe-', 'ical-feeds-', 'guest-ping-'];
// THE SERVER'S OWN CACHES never reach a browser, the owner's included: no client file
// reads them (test-integration §76 checks that), and on a few years' data they were most
// of the owner's content payload (the mailbox's handled list alone ran to 149KB). Every
// one is internal, so the visitor's read leaves them out already.
const CONTENT_SERVER_ONLY = [
    'mailbox-poll', 'mailbox-seen', 'mailbox-new', 'square-payouts', 'square-bank', 'email-optout',
    'uptime-history', 'anniv-sent', 'weather-cache', 'mail-sent-days', 'self-repair-state',
    'conflict-audit-state', 'testcentre-staged', 'activity-seen', 'owner-ping',
    'mac-chat', 'mac-chat-memory', 'mac-chat-imports', 'mac-chat-sum', 'night-shift', 'chat-handoff',
];
const CONTENT_SERVER_ONLY_PREFIX = ['guest-ping-'];

function content_server_only($key): bool
{
    if (in_array($key, CONTENT_SERVER_ONLY, true)) {
        return true;
    }
    foreach (CONTENT_SERVER_ONLY_PREFIX as $p) {
        if (strpos((string) $key, $p) === 0) {
            return true;
        }
    }
    return false;
}

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
    // Someone with LIMITED access gets the internal keys their areas cover and
    // no others (bank details, payout figures and the like stay full-access).
    $me = $isAdmin ? admin_me() : null;
    $limited = $me !== null && !people_is_full($me);
    // A VISITOR'S READ LEAVES THE OPERATIONAL CACHES IN THE DATABASE. The table also
    // holds the payout cache, the mailbox's handled list, the opt-out list and the like:
    // read on every visitor's 30-second poll and thrown away below. Still ONE query (the
    // public bootstrap's statement count is a ratchet, test-integration §24), with those
    // keys left out by name; the memo is told, so a later read of one in this request
    // asks for itself rather than reading "not set".
    $skip = $isAdmin ? CONTENT_SERVER_ONLY : CONTENT_VISITOR_SKIP;
    $skipPrefix = $isAdmin ? CONTENT_SERVER_ONLY_PREFIX : CONTENT_VISITOR_SKIP_PREFIX;
    $q = db()->prepare('SELECT item_key, item_value FROM content WHERE item_key NOT IN (' . implode(',', array_fill(0, count($skip), '?')) . ')'
        . str_repeat(' AND item_key NOT LIKE ?', count($skipPrefix)));
    $q->execute(array_merge($skip, array_map(fn($p) => $p . '%', $skipPrefix)));
    $rows = $q->fetchAll();
    // Every other content read in this request can now be answered from memory —
    // this is the ONLY caller that warms the memo, which is what keeps it safe:
    // no write path ever populates it, so there is nothing to invalidate.
    $raw = [];
    foreach ($rows as $r) {
        $raw[$r['item_key']] = $r['item_value'];
    }
    content_memo_warm($raw, $skip, $skipPrefix);
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
        if ($limited && is_internal_content_key($key) && !people_content_readable($me, $key)) {
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
    $rows = array_values(array_filter($rows, fn($r) => !content_server_only($r['item_key'])));
    $me = admin_me();
    $out = [];
    foreach ($rows as $r) {
        // A limited person gets only the private and internal keys their areas
        // cover: never the backup passphrase, API keys, bank or payout figures.
        if ($me !== null && !people_is_full($me)
            && (is_private_content_key($r['item_key']) || is_internal_content_key($r['item_key']))
            && !people_content_readable($me, $r['item_key'])) {
            continue;
        }
        // WRITE-ONLY secrets are never decrypted into the browser payload. The
        // Square webhook signing key is captured + used entirely server-side and
        // has no editor field at all; the Twilio auth token HAS one, but it is
        // write-only by design — the settings page shows whether a token is
        // stored (sms_status()) and treats a blank field as "leave it alone", so
        // the secret has no route back out of the server. Contrast the WorldTides
        // key, which is round-tripped into its input on purpose.
        // The Mac app's own key joins them: it is SHOWN ONCE when it is
        // generated and never again, so serving it back on every admin load
        // would put it in the boot payload of every back-office page — which
        // is precisely the "no route back out of the server" this list is for.
        if ($r['item_key'] === 'apikey-square-webhook'
            || $r['item_key'] === 'apikey-twilio-token'
            || $r['item_key'] === 'apikey-nightshift') {
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
    // A photo key holds a link the pages print inside url('…'); anything else in one
    // could end the link and the attribute around it.
    if (content_image_key($key) && !content_image_value_ok($key, $in['value'] ?? null)) {
        json_out(['error' => 'A photo must be an uploaded image.'], 400);
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
    // The Inbox's own record and Today's dismissals are saved on every tick or swipe.
    if (!in_array($key, ['nlu-learned', 'nlu-suppressed', 'search-misses', 'inbox-state', 'duty-dismissed'], true)) {
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
