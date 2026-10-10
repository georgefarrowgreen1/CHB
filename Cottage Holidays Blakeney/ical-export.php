<?php
// ============================================================
//  ical-export.php — publishes a property's confirmed bookings AND the
//  owner's manual blocks as an iCalendar (.ics) feed, so Airbnb / Vrbo /
//  Booking.com can import it and block those dates on their side.
//
//  URL:  ical-export.php?prop=21a&token=XXXX
//  The token is derived from APP_SECRET + prop key, so the feed isn't
//  guessable but needs no login (the platforms fetch it unauthenticated).
//  Get the correct URL for each property from the back office (Settings →
//  Calendar Sync), which shows the ready-made links.
//
//  Privacy: events contain only dates + a generic "Booked" summary — no
//  guest names or details are exposed in the public feed.
// ============================================================
require_once __DIR__ . '/db.php';
// ical_token() lives in db.php (shared with ical-import.php).

$prop = isset($_GET['prop']) ? preg_replace('/[^a-z0-9_]/i', '', (string) $_GET['prop']) : '';
$token = isset($_GET['token']) ? (string) (is_array($_GET['token']) ? '' : $_GET['token']) : ''; // ?token[]=x must not reach hash_equals as an array

if ($prop === '' || !hash_equals(ical_token($prop), $token)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Forbidden — invalid calendar link.';
    exit();
}

// Fetch confirmed bookings for this property: what is to come and the last month.
// The platforms only block what is ahead, and with no window the feed carried every
// stay since the first — polled many times a day by each platform.
$since = date('Y-m-d', strtotime('-30 days'));
$stmt = db()->prepare('SELECT id, check_in, check_out FROM bookings WHERE prop_key = ? AND check_out >= ? ORDER BY check_in ASC');
$stmt->execute([$prop, $since]);
$rows = $stmt->fetchAll();

// Build the .ics. DTSTART = check-in (date), DTEND = check-out (date). iCal
// treats DTEND as exclusive, which matches hotel-style "nights" perfectly:
// a stay 19th->21st blocks the 19th and 20th nights, free again on the 21st.
$nl = "\r\n";
$now = gmdate('Ymd\THis\Z');
$host = $_SERVER['SERVER_NAME'] ?? 'cottage-holidays-blakeney';

$lines = [];
$lines[] = 'BEGIN:VCALENDAR';
$lines[] = 'VERSION:2.0';
$lines[] = 'PRODID:-//Cottage Holidays Blakeney//Booking Calendar//EN';
$lines[] = 'CALSCALE:GREGORIAN';
$lines[] = 'METHOD:PUBLISH';
$lines[] = 'X-WR-CALNAME:CHB ' . strtoupper($prop) . ' Bookings';

$addEvent = function ($uid, $checkIn, $checkOut, $summary) use (&$lines, $now) {
    $ci = str_replace('-', '', $checkIn); // YYYYMMDD
    $co = str_replace('-', '', $checkOut);
    if ($ci === '' || $co === '') {
        return;
    }
    $lines[] = 'BEGIN:VEVENT';
    $lines[] = 'UID:' . $uid;
    $lines[] = 'DTSTAMP:' . $now;
    $lines[] = 'DTSTART;VALUE=DATE:' . $ci;
    $lines[] = 'DTEND;VALUE=DATE:' . $co;
    $lines[] = 'SUMMARY:' . $summary;
    $lines[] = 'STATUS:CONFIRMED';
    $lines[] = 'TRANSP:OPAQUE';
    $lines[] = 'END:VEVENT';
};

foreach ($rows as $r) {
    $addEvent('chb-' . $prop . '-' . $r['id'] . '@' . $host, $r['check_in'], $r['check_out'], 'Booked');
}

// Owner manual blocks (maintenance / personal use) must block the platforms
// too — otherwise Airbnb/Vrbo keep selling dates the owner has closed here.
// Only source='owner' is exported: echoing IMPORTED platform blocks back into
// the platforms' own imports would breed circular phantom blocks.
try {
    $bl = db()->prepare("SELECT id, check_in, check_out FROM ical_blocks WHERE prop_key = ? AND source = 'owner' AND check_out >= ? ORDER BY check_in ASC");
    $bl->execute([$prop, $since]);
    foreach ($bl->fetchAll() as $r) {
        $addEvent('chb-block-' . $prop . '-' . $r['id'] . '@' . $host, $r['check_in'], $r['check_out'], 'Not available');
    }
} catch (\Throwable $e) {
    // Pre-migration host without ical_blocks — the feed still serves bookings.
}

$lines[] = 'END:VCALENDAR';

// DTSTAMP changes every second, so the tag is taken over the events alone: a feed
// whose stays have not changed answers 304 and sends nothing.
$body = implode($nl, $lines) . $nl;
require_once __DIR__ . '/shell-etag.php';
$etag = '"ics-' . substr(sha1((string) preg_replace('/^DTSTAMP:.*$/m', '', $body)), 0, 20) . '"';
header('Content-Type: text/calendar; charset=utf-8');
header('Content-Disposition: inline; filename="chb-' . $prop . '.ics"');
header('Cache-Control: no-cache, must-revalidate');
header('ETag: ' . $etag);
header('Vary: Accept-Encoding');
if (shell_etag_matches((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''), $etag)) {
    http_response_code(304);
    exit();
}
echo $body;
