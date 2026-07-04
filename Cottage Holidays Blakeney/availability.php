<?php
// ============================================================
//  availability.php — public: returns blocked date ranges for a property,
//  combining confirmed bookings on this site AND imported iCal blocks
//  (Airbnb / Vrbo). Used by the booking form to show/enforce availability.
//
//  GET ?prop=21a  ->  { ranges: [ {start:'YYYY-MM-DD', end:'YYYY-MM-DD'}, ... ] }
//  (end is exclusive — the checkout day is free again, hotel-style)
// ============================================================
require_once __DIR__ . '/db.php';

// ?all=1 — every live cottage's blocked ranges in one call. Powers the homepage
// availability chips + the late-availability spotlight without three round-trips.
if (isset($_GET['all'])) {
    $keys = [];
    try {
        $keys = db()->query('SELECT prop_key FROM properties WHERE archived_at IS NULL')->fetchAll(PDO::FETCH_COLUMN);
    } catch (\Throwable $e) {
        $keys = ['21a', 'jollyboat', 'pimpernel'];
    } // pre-migration fallback
    $out = [];
    foreach ($keys as $k) {
        $rs = [];
        $s = db()->prepare('SELECT check_in, check_out FROM bookings WHERE prop_key = ? AND check_out >= CURDATE()');
        $s->execute([$k]);
        foreach ($s->fetchAll() as $r) {
            $rs[] = ['start' => $r['check_in'], 'end' => $r['check_out']];
        }
        try {
            $s = db()->prepare(
                'SELECT check_in, check_out FROM ical_blocks WHERE prop_key = ? AND check_out >= CURDATE()',
            );
            $s->execute([$k]);
            foreach ($s->fetchAll() as $r) {
                $rs[] = ['start' => $r['check_in'], 'end' => $r['check_out']];
            }
        } catch (\Throwable $e) {
        }
        $out[$k] = $rs;
    }
    json_out(['props' => $out]);
}

$prop = isset($_GET['prop']) ? preg_replace('/[^a-z0-9_]/i', '', $_GET['prop']) : '';
if ($prop === '') {
    json_out(['ranges' => []]);
}

$ranges = [];

// Confirmed bookings on this site
$s = db()->prepare('SELECT check_in, check_out FROM bookings WHERE prop_key = ? AND check_out >= CURDATE()');
$s->execute([$prop]);
foreach ($s->fetchAll() as $r) {
    $ranges[] = ['start' => $r['check_in'], 'end' => $r['check_out']];
}

// Imported iCal blocks (Airbnb/Vrbo) — table may not exist on older installs.
try {
    $s = db()->prepare('SELECT check_in, check_out FROM ical_blocks WHERE prop_key = ? AND check_out >= CURDATE()');
    $s->execute([$prop]);
    foreach ($s->fetchAll() as $r) {
        $ranges[] = ['start' => $r['check_in'], 'end' => $r['check_out']];
    }
} catch (\Throwable $e) {
    /* table not migrated yet — ignore */
}

json_out(['ranges' => $ranges]);
