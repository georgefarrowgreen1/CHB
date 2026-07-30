<?php
// ============================================================
//  test-ical.php — the platform-calendar sync's judgement. DEV/CI only
//  (deploy-excluded with the other test-*.php).
//
//      php test-ical.php
//
//  WHY THIS ONE MATTERS MOST. Every other double-booking guard is a REFUSAL:
//  the endpoints check dates_clash and say no. This one is different, because
//  sync_property DELETEs a source's blocks and re-inserts from the feed — so if
//  a bad response is treated as a good one, the blocks are gone and the cottage
//  reads as free for every Airbnb stay. No endpoint guard can save that: the
//  clash check faithfully finds no clash, because there is nothing left to find.
//
//  The guards were all present and correct, and NOTHING tested them — the same
//  gap the clash guards had. No network here (a test that depends on Airbnb's
//  uptime fails for reasons that are nothing to do with this codebase), so the
//  pure judgement lives in ical-lib.php and is driven directly.
// ============================================================
require_once __DIR__ . '/ical-lib.php';

$fails = 0;
function ick($name, $cond, $extra = '')
{
    global $fails;
    if ($cond) {
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fails++;
        echo "  \xE2\x9C\x97 $name" . ($extra !== '' ? " — $extra" : '') . "\n";
    }
}

echo "\n== 1. Is this response safe to rebuild a calendar from? ==\n";
// The two ways a feed can betray you, and the one way it legitimately says
// "everything is free now".
$bad = ical_feed_usable(['ok' => false, 'error' => 'HTTP 500']);
ick('a failed fetch is NOT usable — the blocks we hold stay', !$bad['ok']);
ick('…and it carries the reason through, for the feed-health panel', $bad['error'] === 'HTTP 500', $bad['error']);
ick('a fetch with no error string still refuses', !ical_feed_usable(['ok' => false])['ok']);

// The dangerous one: a 200 that is not a calendar. Airbnb answering with a login
// page, a moved link, an HTML error — all parse to ZERO events, which would look
// exactly like "no bookings" and wipe the source.
$html = ical_feed_usable(['ok' => true, 'body' => "<!doctype html><html><body>Please log in</body></html>"]);
ick('a 200 that is an HTML login page is NOT usable', !$html['ok']);
ick('…and says so in the owner\'s terms', stripos($html['error'], 'not a calendar') !== false, $html['error']);
ick('an empty body is NOT usable', !ical_feed_usable(['ok' => true, 'body' => ''])['ok']);
ick('a body that merely mentions the word calendar is NOT usable',
    !ical_feed_usable(['ok' => true, 'body' => 'Your calendar has moved'])['ok']);

// …and the legitimate empty answer. This one MUST pass through: it is how an
// external cancellation frees the dates, and the waitlist gets told.
$empty = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
ick('a REAL calendar with no bookings IS usable — "all free" is an answer', ical_feed_usable(['ok' => true, 'body' => $empty])['ok']);
ick('…and parses to no events, so the blocks clear', count(parse_ical($empty)) === 0);
// Case-insensitive, because the check is a substring match on a wire format.
ick('the calendar marker is matched case-insensitively', ical_feed_usable(['ok' => true, 'body' => "begin:vcalendar\r\nend:vcalendar"])['ok']);

echo "\n== 2. What an .ics actually says ==\n";
// A real Airbnb export: all-day VALUE=DATE, DTEND is the CHECKOUT day, so it is
// end-exclusive exactly like everything else in this app.
$feed = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Airbnb//EN\r\n"
    . "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260810\r\nDTEND;VALUE=DATE:20260814\r\nUID:abc-1\r\nSUMMARY:Reserved\r\nEND:VEVENT\r\n"
    . "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260901\r\nDTEND;VALUE=DATE:20260903\r\nUID:abc-2\r\nEND:VEVENT\r\n"
    . "END:VCALENDAR\r\n";
$ev = parse_ical($feed);
ick('both reservations are read', count($ev) === 2, 'got ' . count($ev));
ick('dates are normalised to YYYY-MM-DD', ($ev[0]['start'] ?? '') === '2026-08-10' && ($ev[0]['end'] ?? '') === '2026-08-14', json_encode($ev[0] ?? null));
ick('the UID rides along (it is the row\'s identity)', ($ev[0]['uid'] ?? '') === 'abc-1', (string) ($ev[0]['uid'] ?? ''));
ick('a second event is read independently', ($ev[1]['start'] ?? '') === '2026-09-01' && ($ev[1]['end'] ?? '') === '2026-09-03');

// DTEND is the checkout day, so the LAST NIGHT is the day before — the same
// end-exclusive rule dates_clash and the guest picker use. If this drifted, an
// Airbnb guest's last night would read as free and could be sold twice.
$nights = (strtotime($ev[0]['end']) - strtotime($ev[0]['start'])) / 86400;
ick('10th to 14th is FOUR nights, end-exclusive like every other date in the app', (int) $nights === 4, (string) $nights);

// Real feeds fold long lines and use timestamp form; both must survive.
$folded = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:long-uid-that-was\r\n folded-across-lines\r\n"
    . "DTSTART:20260701T150000Z\r\nDTEND:20260705T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
$f = parse_ical($folded);
ick('a folded line is rejoined before parsing', ($f[0]['uid'] ?? '') === 'long-uid-that-wasfolded-across-lines', (string) ($f[0]['uid'] ?? ''));
ick('a date-TIME value still yields the calendar date', ($f[0]['start'] ?? '') === '2026-07-01' && ($f[0]['end'] ?? '') === '2026-07-05');

// Anything half-formed is dropped rather than guessed at — a half-read event
// would block or free the wrong dates.
$partial = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:no-dates\r\nEND:VEVENT\r\n"
    . "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260501\r\nUID:start-only\r\nEND:VEVENT\r\n"
    . "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260601\r\nDTEND;VALUE=DATE:20260604\r\nUID:good\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
$p = parse_ical($partial);
ick('an event with no dates is dropped', count($p) === 1 && ($p[0]['uid'] ?? '') === 'good', json_encode($p));
ick('…and one with only a start is dropped too', !array_filter($p, fn($e) => ($e['uid'] ?? '') === 'start-only'));
ick('text outside any VEVENT is ignored', count(parse_ical("BEGIN:VCALENDAR\r\nDTSTART;VALUE=DATE:20260101\r\nEND:VCALENDAR")) === 0);

echo "\n== 3. Which URLs may be fetched at all ==\n";
// Trusted-user SSRF is still SSRF: only an admin sets a feed URL, but the server
// is the one making the request. Bare IPs need no DNS, so these are hermetic.
foreach ([
    ['127.0.0.1 (loopback)', 'http://127.0.0.1/cal.ics'],
    ['10.x (private)', 'http://10.0.0.5/cal.ics'],
    ['192.168.x (private)', 'https://192.168.1.20/cal.ics'],
    ['169.254.x (cloud metadata)', 'http://169.254.169.254/latest/meta-data/'],
    ['IPv6 loopback', 'http://[::1]/cal.ics'],
] as [$label, $url]) {
    ick("$label is blocked", !ical_url_public($url), $url);
}
ick('a non-http scheme is blocked', !ical_url_public('file:///etc/passwd'));
ick('a URL with no host is blocked', !ical_url_public('http://'));
ick('nonsense is blocked', !ical_url_public('not a url'));
ick('a public IP is allowed', ical_url_public('https://93.184.216.34/cal.ics'));

echo "\n== Summary ==\n";
if ($fails) {
    echo "  $fails CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL ICAL CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
