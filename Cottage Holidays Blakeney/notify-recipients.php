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
require_admin();

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

$in = body();
$action = $in['action'] ?? '';
$primary = (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL) ? OWNER_NOTIFY_EMAIL : '';

if ($action === 'list') {
    json_out(['ok' => true, 'primary' => $primary, 'extras' => nr_load(), 'max' => NOTIFY_MAX]);
}

if ($action === 'add') {
    $email = trim((string)($in['email'] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_out(['ok' => false, 'error' => 'That doesn\'t look like a valid email address.'], 400);
    if ($primary !== '' && strtolower($email) === strtolower($primary)) json_out(['ok' => false, 'error' => 'That\'s already your primary notification address.'], 400);
    $list = nr_load();
    if (count($list) >= NOTIFY_MAX) json_out(['ok' => false, 'error' => 'You can add up to ' . NOTIFY_MAX . ' extra addresses.'], 400);
    foreach ($list as $e) if (strtolower($e) === strtolower($email)) json_out(['ok' => true, 'extras' => $list]);  // already there
    $list[] = $email;
    nr_save($list);
    json_out(['ok' => true, 'extras' => $list]);
}

if ($action === 'remove') {
    $email = strtolower(trim((string)($in['email'] ?? '')));
    $list = array_values(array_filter(nr_load(), fn($e) => strtolower($e) !== $email));
    nr_save($list);
    json_out(['ok' => true, 'extras' => $list]);
}

json_out(['error' => 'Unknown action'], 400);
