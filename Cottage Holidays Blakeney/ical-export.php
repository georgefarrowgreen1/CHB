<?php
// ============================================================
//  ical-export.php — publishes a property's confirmed bookings as an
//  iCalendar (.ics) feed, so Airbnb / Vrbo can import it and block those
//  dates on their side.
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

// Derive the expected token for a property (no secrets leak; one-way hash).
function ical_token($propKey) {
    return substr(hash_hmac('sha256', 'ical:' . $propKey, APP_SECRET), 0, 24);
}

$prop  = isset($_GET['prop']) ? preg_replace('/[^a-z0-9_]/i', '', $_GET['prop']) : '';
$token = isset($_GET['token']) ? $_GET['token'] : '';

if ($prop === '' || !hash_equals(ical_token($prop), $token)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Forbidden — invalid calendar link.";
    exit;
}

// Fetch confirmed bookings for this property (future + recent past).
$stmt = db()->prepare('SELECT id, check_in, check_out FROM bookings WHERE prop_key = ? ORDER BY check_in ASC');
$stmt->execute([$prop]);
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

foreach ($rows as $r) {
    $ci = str_replace('-', '', $r['check_in']);   // YYYYMMDD
    $co = str_replace('-', '', $r['check_out']);
    if ($ci === '' || $co === '') continue;
    $uid = 'chb-' . $prop . '-' . $r['id'] . '@' . $host;
    $lines[] = 'BEGIN:VEVENT';
    $lines[] = 'UID:' . $uid;
    $lines[] = 'DTSTAMP:' . $now;
    $lines[] = 'DTSTART;VALUE=DATE:' . $ci;
    $lines[] = 'DTEND;VALUE=DATE:' . $co;
    $lines[] = 'SUMMARY:Booked';
    $lines[] = 'STATUS:CONFIRMED';
    $lines[] = 'TRANSP:OPAQUE';
    $lines[] = 'END:VEVENT';
}

$lines[] = 'END:VCALENDAR';

header('Content-Type: text/calendar; charset=utf-8');
header('Content-Disposition: inline; filename="chb-' . $prop . '.ics"');
header('Cache-Control: no-cache, must-revalidate');
echo implode($nl, $lines) . $nl;
