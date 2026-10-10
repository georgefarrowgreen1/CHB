<?php
// ============================================================
//  activity-log.php — the full back-office Activity log (admin).
//  Merges owner/admin actions + site changes (the activity_log table) with the
//  inbound guest business events, newest first, with optional category + text
//  filters. Powers the "Activity log" page (view-activity-log in app.js).
//
//  POST {action:'list', category?, q?, limit?}  →  {events:[…], total}
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/activity-lib.php';
require_admin();

$in = body();
$action = $in['action'] ?? 'list';

// The owner's "Seen it" record: activity_log ids, newest kept (internal key).
function activity_seen_ids()
{
    $v = content_json('activity-seen', []);
    return is_array($v) ? array_values(array_filter(array_map('intval', $v))) : [];
}

if ($action === 'summary') {
    json_out(['ok' => true] + activity_summary(date('Y-m-d'), activity_seen_ids()));
}
if ($action === 'seen') {
    $ids = array_values(array_filter(array_map('intval', (array) ($in['ids'] ?? []))));
    if (!$ids) {
        json_out(['error' => 'Nothing to mark as seen.'], 400);
    }
    // Locked: "Seen it" on two rows in quick succession arrives as two requests.
    content_locked('activity-seen', function () use ($ids) {
        $all = array_values(array_unique(array_merge(activity_seen_ids(), $ids)));
        content_set_scalar('activity-seen', array_slice($all, -400));
    });
    json_out(['ok' => true, 'seen' => count($ids)]);
}
if ($action !== 'list') {
    json_out(['error' => 'Unknown action'], 400);
}

$events = activity_merged([
    'category' => (string) ($in['category'] ?? 'all'),
    'q' => (string) ($in['q'] ?? ''),
    'limit' => (int) ($in['limit'] ?? 150),
]);

json_out(['ok' => true, 'events' => $events, 'count' => count($events)]);
