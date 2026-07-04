<?php
// ============================================================
//  activity.php — "what happened while I was away" feed (admin dashboard).
//  The compact recent-events strip on the back-office dashboard: the newest
//  inbound business events (bookings, payments, enquiries, reviews, photos,
//  sign-ups). The event-gathering lives in activity-lib.php, shared with the
//  full Activity log page (activity-log.php).
//
//  POST {action:'recent'}  →  {events:[{type,label,detail,at,prop_key}…]}
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/activity-lib.php';
require_admin();

$in = body();
if (($in['action'] ?? '') !== 'recent') {
    json_out(['error' => 'Unknown action'], 400);
}

$events = activity_business_events(12);
usort($events, fn($a, $b) => strcmp((string) $b['at'], (string) $a['at']));
json_out(['events' => array_slice($events, 0, 25)]);
