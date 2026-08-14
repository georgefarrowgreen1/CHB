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

// ---- 4. THE REBUILD IS ATOMIC, AND A FAILURE KEEPS THE OLD BLOCKS ----------
// sync_property replaces a source's blocks with a DELETE + N INSERTs, and it is the
// one write deciding availability that took no lock. Every reader of ical_blocks
// (dates_clash, availability.php, the enquiry guard) sees the table mid-rebuild, so
// a clash check landing in that window reads a live Airbnb stay as FREE and lets a
// booking through — and the window is not theoretical: the sync fires from the
// cron, from autoSyncIcalBlocks on every back-office load, and from "Sync now".
//
// This is a real-database property, so what is checked here is the SOURCE: the
// transaction exists, the insert loop is inside it, and a failure rolls back rather
// than leaving the source deleted. test-integration is where a live rebuild runs.
echo "\n== 4. The block rebuild is atomic ==\n";
{
    $src = (string) file_get_contents(__DIR__ . '/ical-import.php');
    $i = strpos($src, 'function sync_property');
    $body = $i === false ? '' : substr($src, $i, 6000);
    // Strip comments before asserting an absence — the notes here describe the very
    // shapes being forbidden (this repo's own negative-scan rule).
    $code = (string) preg_replace('~^\s*//.*$~m', '', $body);
    ick('sync_property was found', strlen($body) > 500);
    ick('the rebuild opens a transaction', strpos($code, 'beginTransaction()') !== false);
    ick('…the DELETE is inside it', strpos($code, 'beginTransaction()') < strpos($code, 'DELETE FROM ical_blocks'));
    ick('…and so is the INSERT loop', strpos($code, 'beginTransaction()') < strpos($code, 'INSERT INTO ical_blocks'));
    ick('…which commits only after the loop', strpos($code, 'INSERT INTO ical_blocks') < strpos($code, 'commit()'));
    ick('a failure rolls back rather than leaving the source empty', strpos($code, 'rollBack()') !== false);
    ick('…and reports the feed as FAILING, not as zero events',
        (bool) preg_match("~'ok'\s*=>\s*false~", substr($code, (int) strpos($code, 'rollBack()'), 400)));
    // An over-long UID from a non-platform feed must not abort the loop.
    ick('the UID is truncated to the column', strpos($code, 'mb_substr') !== false);
}

// ---- 5. THE CROSS-LISTING MIRROR IS NOT A CONFLICT, AND A FEED IS NOT MISSING --
// Two readers of the same sync, each contradicting it. Source checks, because both
// files route (require_admin / a cron secret) and would exit on require; the
// judgement each states is exact and one line long.
echo "\n== 5. What the sync's own readers say about it ==\n";
{
    $ca = (string) file_get_contents(__DIR__ . '/conflict-audit.php');
    $caCode = (string) preg_replace('~^\s*//.*$~m', '', $ca); // never scan for an absence in its own explanation
    ick('conflict-audit was found', strpos($ca, 'ca_overlap') !== false);
    // ical-export publishes each booking as a busy range, the platform republishes
    // it, and our sync imports it back — so on a cross-listed cottage EVERY direct
    // booking produced an exact-range booking↔block overlap, logged at warn into
    // Needs attention. The documented setup reporting itself as a double booking.
    // The file already skips OTA↔OTA overlaps as mirrors for the same reason.
    // Single-quoted so PHP does not interpolate $a/$bk, and a plain string search
    // rather than a regex — the pattern is a literal comparison.
    ick(
        'an EXACT-range booking↔block overlap is skipped as the mirror it is',
        strpos(preg_replace('~\s+~', ' ', $caCode), '$a[\'check_in\'] === $bk[\'check_in\'] && $a[\'check_out\'] === $bk[\'check_out\']') !== false,
    );
    ick('…and a real overlap is still reported', strpos($caCode, "'sig' => \"bo|") !== false || strpos($caCode, 'bo|') !== false);

    // Strip comments BEFORE windowing: the note explaining this fix is ~290
    // characters long and pushed the line it describes outside a 400-char window.
    $dg = (string) preg_replace('~^\s*//.*$~m', '', (string) file_get_contents(__DIR__ . '/diagnostics.php'));
    $i = strpos($dg, 'ical-feeds-%');
    $near = $i === false ? '' : substr($dg, $i, 300);
    ick('the Status page counts configured feeds', $i !== false);
    // `ical-feeds-*` is written with content_set_secret, so the raw column is
    // ciphertext: json_decode returned null on every row and Status reported "No
    // external feeds connected" while the feeds were syncing normally — on the one
    // page an owner opens to find out whether they are.
    ick('…by DECRYPTING the private value, not reading the ciphertext', strpos($near, 'decrypt_value(') !== false);
}

echo "\n== Summary ==\n";
if ($fails) {
    echo "  $fails CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL ICAL CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
