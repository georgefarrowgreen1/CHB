<?php
// ============================================================
//  notify-recipients.php — manage WHO gets the owner/admin activity emails
//  (new bookings, enquiries, guest messages, payments, reviews…). The primary
//  OWNER_NOTIFY_EMAIL from config.php is always included and can't be removed
//  here; this manages the EXTRA addresses, stored as content 'notify-emails'
//  (a JSON array). mailer.php's owner_recipients() reads the same key.
//
//  POST {action:'list'}            -> {ok, primary, extras:[…], max}
//  POST {action:'add', email}      -> {ok, extras:[…]}   (validates + dedupes)
//  POST {action:'remove', email}   -> {ok, extras:[…]}
//  Admin only. The list is never exposed on the public content feed.
// ============================================================
require_once __DIR__ . '/db.php';

const NOTIFY_MAX = 15;   // a sensible cap so the list can't grow unbounded

function nr_load() {
    $raw = content_value('notify-emails');
    $arr = $raw ? json_decode($raw, true) : [];
    if (!is_array($arr)) $arr = [];
    // Clean: valid emails, deduped case-insensitively, primary excluded.
    $primary = (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL) ? strtolower(OWNER_NOTIFY_EMAIL) : '';
    $seen = []; $out = [];
    foreach ($arr as $e) {
        $e = trim((string)$e);
        $k = strtolower($e);
        if ($e === '' || !filter_var($e, FILTER_VALIDATE_EMAIL)) continue;
        if ($k === $primary || isset($seen[$k])) continue;
        $seen[$k] = true; $out[] = $e;
    }
    return $out;
}

function nr_save($list) {
    db()->prepare("INSERT INTO content (item_key, item_value) VALUES ('notify-emails', ?)
                   ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP")
        ->execute([json_encode(array_values($list))]);
}

// Pure decision for add/remove — no I/O, so it's unit-testable (test-reply.php).
// Returns ['list'=>[…], 'changed'=>bool, 'error'=>null|string, 'code'=>200|400].
function nr_apply($action, $email, $list, $primary, $max = NOTIFY_MAX) {
    $email = trim((string)$email);
    if ($action === 'add') {
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return ['list' => $list, 'changed' => false, 'error' => "That doesn't look like a valid email address.", 'code' => 400];
        if ($primary !== '' && strtolower($email) === strtolower($primary)) return ['list' => $list, 'changed' => false, 'error' => "That's already your primary notification address.", 'code' => 400];
        foreach ($list as $e) if (strtolower($e) === strtolower($email)) return ['list' => $list, 'changed' => false, 'error' => null, 'code' => 200];   // already there
        if (count($list) >= $max) return ['list' => $list, 'changed' => false, 'error' => 'You can add up to ' . $max . ' extra addresses.', 'code' => 400];
        $list[] = $email;
        return ['list' => $list, 'changed' => true, 'error' => null, 'code' => 200];
    }
    if ($action === 'remove') {
        $lc = strtolower($email);
        $new = array_values(array_filter($list, fn($e) => strtolower($e) !== $lc));
        return ['list' => $new, 'changed' => count($new) !== count($list), 'error' => null, 'code' => 200];
    }
    return ['list' => $list, 'changed' => false, 'error' => 'Unknown action', 'code' => 400];
}

// ---- Endpoint (admin) — guarded so the file can be included in tests ----
if (basename($_SERVER['SCRIPT_NAME'] ?? '') === 'notify-recipients.php') {
    require_admin();
    $in = body();
    $action = $in['action'] ?? '';
    $primary = (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL) ? OWNER_NOTIFY_EMAIL : '';

    if ($action === 'list') json_out(['ok' => true, 'primary' => $primary, 'extras' => nr_load(), 'max' => NOTIFY_MAX]);

    if ($action === 'add' || $action === 'remove') {
        $r = nr_apply($action, $in['email'] ?? '', nr_load(), $primary);
        if ($r['error']) json_out(['ok' => false, 'error' => $r['error']], $r['code']);
        if ($r['changed']) nr_save($r['list']);
        json_out(['ok' => true, 'extras' => $r['list']]);
    }

    json_out(['error' => 'Unknown action'], 400);
}
