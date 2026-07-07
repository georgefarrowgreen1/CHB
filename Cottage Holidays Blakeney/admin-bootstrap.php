<?php
// ============================================================
//  admin-bootstrap.php — everything the back office needs to open, in ONE
//  round-trip: { ok, rates, bookings, enquiries, blocks, cron }.
//  loadData() previously fired four parallel requests on EVERY admin screen
//  open (rates, bookings, enquiries, iCal blocks) plus cron-status on the
//  dashboard — each its own PHP process + DB connection on shared hosting.
//
//  Zero drift: each part is built by the SAME payload function its own
//  endpoint serves (the endpoints early-return before routing when included
//  — the bootstrap.php pattern). The blocks query is the one exception: it
//  mirrors ical-import.php's 'blocks' action (a plain table read) because
//  that file runs auth/routing at include time. The individual endpoints
//  stay live as the front end's fallback.
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

require_once __DIR__ . '/rates.php';
require_once __DIR__ . '/bookings.php';
require_once __DIR__ . '/enquiries.php';
require_once __DIR__ . '/cron-status.php';

// Imported OTA blocks — mirrors ical-import.php action 'blocks' exactly.
$blocks = [];
try {
    $blocks = db()
        ->query('SELECT id, prop_key, source, check_in, check_out FROM ical_blocks ORDER BY check_in ASC')
        ->fetchAll();
} catch (\Throwable $e) {
}

json_out([
    'ok' => true,
    'rates' => rates_public_payload(),
    'bookings' => bookings_admin_payload(),
    'enquiries' => enquiries_admin_payload(),
    'blocks' => ['ok' => true, 'blocks' => $blocks],
    'cron' => cron_status_payload(),
]);
