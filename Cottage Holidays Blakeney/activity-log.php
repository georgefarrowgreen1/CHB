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
if ($action !== 'list') {
    json_out(['error' => 'Unknown action'], 400);
}

$events = activity_merged([
    'category' => (string) ($in['category'] ?? 'all'),
    'q' => (string) ($in['q'] ?? ''),
    'limit' => (int) ($in['limit'] ?? 150),
]);

json_out(['ok' => true, 'events' => $events, 'count' => count($events)]);
