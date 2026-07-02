<?php
// ============================================================
//  activity.php — "what happened while I was away" feed (admin).
//  Merges the most recent events from tables that already exist —
//  new bookings, card payments, enquiries, guest reviews/photos and
//  newsletter sign-ups — into one reverse-chronological list.
//  Every query is individually guarded: a missing table (migration not
//  run yet) just contributes nothing rather than breaking the feed.
//
//  POST {action:'recent'}  →  {events:[{type,label,detail,at,prop_key}…]}
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

$in = body();
if (($in['action'] ?? '') !== 'recent') json_out(['error' => 'Unknown action'], 400);

$events = [];
$push = function ($type, $label, $detail, $at, $propKey = '') use (&$events) {
    if (!$at) return;
    $events[] = ['type' => $type, 'label' => $label, 'detail' => $detail, 'at' => $at, 'prop_key' => $propKey];
};

// New bookings (direct + back office)
try {
    foreach (db()->query('SELECT id, name, prop_key, check_in, check_out, agreed_total, created_at
                          FROM bookings ORDER BY created_at DESC LIMIT 12')->fetchAll() as $r) {
        $amount = $r['agreed_total'] !== null ? ('£' . number_format((float)$r['agreed_total'], 2)) : '';
        $push('booking', 'New booking — ' . $r['name'],
              trim($r['check_in'] . ' → ' . $r['check_out'] . ($amount ? ' · ' . $amount : '')),
              $r['created_at'], $r['prop_key']);
    }
} catch (\Throwable $e) {}

// Card payments through Square (deposit / balance / refunds)
try {
    foreach (db()->query('SELECT p.kind, p.amount, p.created_at, b.name, b.prop_key
                          FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id
                          ORDER BY p.created_at DESC LIMIT 12')->fetchAll() as $r) {
        $kind = $r['kind'] === 'refund' ? 'Refund issued' : ($r['kind'] === 'balance' ? 'Balance paid' : 'Deposit paid');
        $push('payment', $kind . ($r['name'] ? ' — ' . $r['name'] : ''),
              '£' . number_format((float)$r['amount'], 2), $r['created_at'], $r['prop_key'] ?? '');
    }
} catch (\Throwable $e) {}

// New enquiries
try {
    foreach (db()->query('SELECT name, prop_key, check_in, check_out, created_at
                          FROM enquiries ORDER BY created_at DESC LIMIT 8')->fetchAll() as $r) {
        $push('enquiry', 'Enquiry — ' . $r['name'], $r['check_in'] . ' → ' . $r['check_out'], $r['created_at'], $r['prop_key']);
    }
} catch (\Throwable $e) {}

// Guest reviews submitted
try {
    foreach (db()->query('SELECT r.stars, r.status, r.created_at, r.prop_key, g.name
                          FROM guest_reviews r JOIN guests g ON g.id = r.guest_id
                          ORDER BY r.created_at DESC LIMIT 8')->fetchAll() as $r) {
        $push('review', 'Review — ' . $r['name'] . ' · ' . (int)$r['stars'] . '★',
              $r['status'] === 'pending' ? 'waiting for approval' : $r['status'], $r['created_at'], $r['prop_key']);
    }
} catch (\Throwable $e) {}

// Guest photos shared
try {
    foreach (db()->query("SELECT guest_name, status, created_at, prop_key
                          FROM guest_photos WHERE status <> 'rejected'
                          ORDER BY created_at DESC LIMIT 6")->fetchAll() as $r) {
        $push('photo', 'Guest photo — ' . $r['guest_name'],
              $r['status'] === 'pending' ? 'waiting for approval' : $r['status'], $r['created_at'], $r['prop_key']);
    }
} catch (\Throwable $e) {}

// Newsletter sign-ups
try {
    foreach (db()->query('SELECT email, created_at FROM newsletter_subscribers
                          ORDER BY created_at DESC LIMIT 6')->fetchAll() as $r) {
        $push('signup', 'Newsletter sign-up', $r['email'], $r['created_at']);
    }
} catch (\Throwable $e) {}

usort($events, fn($a, $b) => strcmp($b['at'], $a['at']));
json_out(['events' => array_slice($events, 0, 25)]);
