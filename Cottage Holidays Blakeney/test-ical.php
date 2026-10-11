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

// A UTC DATE-TIME whose time is late enough that its UTC date TRAILS the local
// one (summer, ≥23:00Z) must convert to the quay's clock, or the checkout-day
// block ends a night early and that final night reads FREE — a double-booking
// window. DTEND 20260814T230000Z = 15 Aug 00:00 BST, so the block ends 2026-08-15.
$bst = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:utc-dt\r\nDTSTART:20260810T230000Z\r\nDTEND:20260814T230000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
$bf = parse_ical($bst);
ick('a UTC DATE-TIME converts to the London date, not the UTC one (no lost final night)',
    ($bf[0]['end'] ?? '') === '2026-08-15', 'end=' . ($bf[0]['end'] ?? ''));

// Anything half-formed is dropped rather than guessed at — a half-read event
// would block or free the wrong dates.
$partial = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:no-dates\r\nEND:VEVENT\r\n"
    . "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260501\r\nUID:start-only\r\nEND:VEVENT\r\n"
    . "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260601\r\nDTEND;VALUE=DATE:20260604\r\nUID:good\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
$p = parse_ical($partial);
ick('an event with no dates is dropped', !array_filter($p, fn($e) => ($e['uid'] ?? '') === 'no-dates'), json_encode($p));
// A date with no end is the ONE day RFC 5545 says it is (it used to be dropped,
// freeing a night the platform holds).
$so = array_values(array_filter($p, fn($e) => ($e['uid'] ?? '') === 'start-only'));
ick('…a date-only start with no end is one night, as the RFC says', $so && $so[0]['start'] === '2026-05-01' && $so[0]['end'] === '2026-05-02', json_encode($so));
ick('…and the event with no dates is COUNTED as unreadable, so the sync refuses rather than drops it', ical_parse_feed($partial)['unreadable'] === 1);
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
    $body = $i === false ? '' : substr($src, $i, 9000);
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


// ---- 5. A BOOKING OR A BLOCK? (ical_classify — never a guess) ----------------
echo "\n5. is it a booking or the host blocking dates out\n";
$AB_RES = "Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMXYZ\\nPhone Number (Last 4 Digits): 4471";
ick('Airbnb reservation (link + last 4 digits) is a booking', ical_classify('Reserved', ical_unescape($AB_RES)) === 'booking');
ick('…even if its label looked like a block', ical_classify('Not available', ical_unescape($AB_RES)) === 'booking');
ick('Airbnb (Not available) is a block', ical_classify('Airbnb (Not available)', '') === 'blocked');
ick('Vrbo "Blocked" / "Unavailable" / "Closed" are blocks', ical_classify('Blocked', '') === 'blocked' && ical_classify('Unavailable', '') === 'blocked' && ical_classify('Closed', '') === 'blocked');
// Booking.com titles every unavailable period this way, its own guests included, so
// the label cannot say which: unknown, i.e. a stay (changeovers, the key safe).
ick('Booking.com\'s "CLOSED - Not available" is UNKNOWN — it labels its guests that way too', ical_classify('CLOSED - Not available', '') === 'unknown' && ical_classify('Closed - Not available', '') === 'unknown');
ick('a plain "Reserved" label is a booking', ical_classify('Reserved', '') === 'booking');
ick('a guest\'s name is UNKNOWN, never guessed', ical_classify('Jane Smith', '') === 'unknown');
ick('a guest whose name merely starts like a word is not a block', ical_classify('Blocksidge family', '') === 'unknown');
ick('an empty event is UNKNOWN (and so keeps counting as a stay, as before)', ical_classify('', '') === 'unknown');
$cal = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a1\r\nDTSTART;VALUE=DATE:20261010\r\nDTEND;VALUE=DATE:20261014\r\nSUMMARY:Airbnb (Not available)\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:a2\r\nDTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261024\r\nSUMMARY:Reserved\r\nDESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HM1\\nPhone Number (Last 4\r\n  Digits): 9921\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
$ev = parse_ical($cal);
ick('parse keeps the summary and the (folded, unescaped) description', count($ev) === 2 && $ev[0]['summary'] === 'Airbnb (Not available)' && strpos($ev[1]['description'], "\n") !== false && stripos($ev[1]['description'], 'Last 4 Digits') !== false);
ick('…and classifying what was parsed gives block then booking', ical_classify($ev[0]['summary'], $ev[0]['description']) === 'blocked' && ical_classify($ev[1]['summary'], $ev[1]['description']) === 'booking');
ick('the dates are untouched by the new fields (10→14 is still four nights)', $ev[0]['start'] === '2026-10-10' && $ev[0]['end'] === '2026-10-14');
ick('the stored label is plain, short text', ical_label("A\x01B" . str_repeat('x', 200)) === 'A B' . str_repeat('x', 77));
// THE WIRING: a lib-only gate misses the route. The sync must write what it classified,
// but only where the column exists, and must never let a missing column stop it.
$imp = file_get_contents(__DIR__ . '/ical-import.php');
ick('the sync stores kind + label through ical_classify', strpos($imp, "ical_classify(\$e['summary']") !== false && strpos($imp, 'kind, label) VALUES') !== false);
ick('…guarded by a column probe, so an un-migrated install still syncs', strpos($imp, 'ical_has_kind()') !== false && strpos($imp, 'SHOW COLUMNS FROM ical_blocks LIKE') !== false);


// ---- 6. AN UNCHANGED CALENDAR IS NOT REWRITTEN (ical_block_sig) -------------
// The sync compares what the feed would write with what is stored and leaves an
// unchanged source alone (and tells the back office not to reload). Two ways that
// goes wrong, both expensive: a real change read as "same" leaves a stale block
// (or a freed night still blocked), and "same" read as a change is the old cost.
echo "\n6. an unchanged calendar is left alone\n";
$A = ['check_in' => '2026-10-10', 'check_out' => '2026-10-14', 'uid' => 'a1', 'kind' => 'booking', 'label' => 'Reserved'];
$B = ['check_in' => '2026-10-20', 'check_out' => '2026-10-24', 'uid' => 'a2', 'kind' => 'blocked', 'label' => 'Airbnb (Not available)'];
$same = fn($x, $y) => ical_block_sig($x) === ical_block_sig($y);
ick('the same stays in another order are the same calendar', $same([$A, $B], [$B, $A]));
ick('a moved check-out is a change', !$same([$A, $B], [['check_out' => '2026-10-15'] + $A, $B]));
ick('a new stay is a change', !$same([$A], [$A, $B]));
ick('a cancelled stay is a change (it frees nights)', !$same([$A, $B], [$A]));
ick('two identical blocks are not one', !$same([$A, $A], [$A]));
ick('a relabelled block is a change (the owner sees the label)', !$same([$A], [['label' => 'Reserved - 2 guests'] + $A]));
ick('…and a re-classified one (booking ↔ blocked)', !$same([$A], [['kind' => 'blocked'] + $A]));
ick('a stored NULL label or uid reads as the empty one the feed writes', $same([['label' => null, 'uid' => null] + $A], [['label' => '', 'uid' => ''] + $A]));
ick('an empty feed against an empty table is unchanged', $same([], []));
ick('the column order a SELECT returns does not matter',
    $same([['uid' => 'a1', 'label' => 'Reserved', 'check_out' => '2026-10-14', 'kind' => 'booking', 'check_in' => '2026-10-10']], [$A]));
// THE WIRING: the comparison has to sit BEFORE the rewrite, and an unreadable
// snapshot has to count as a change (rewrite) rather than as "same" (skip).
$imp = file_get_contents(__DIR__ . '/ical-import.php');
$cmpAt = strpos($imp, 'ical_block_sig($oldRows) === ical_block_sig($newRows)');
$delAt = strpos($imp, "DELETE FROM ical_blocks WHERE prop_key = ? AND source = ?");
ick('the sync compares before it deletes', $cmpAt !== false && $delAt !== false && $cmpAt < $delAt);
ick('…an unreadable snapshot is never taken as "unchanged"', strpos($imp, '$oldRows !== null && ical_block_sig(') !== false);
ick('…and every source says whether it changed', strpos($imp, "'changed' => false]") !== false && strpos($imp, "'changed' => true]") !== false);
ick('…the rows written are the rows compared', strpos($imp, 'foreach ($newRows as $nr)') !== false);

// ---- 7. EVERY EVENT READ, OR THE CALENDAR LEFT ALONE ------------------------
// parse_ical used to drop what it could not read and the sync rebuilt from what
// survived — measured end to end, two Airbnb blocks became none and the waitlist was
// told the nights were free. Each standard form below was one of those drops.
echo "\n7. every event read, or the calendar left alone\n";
$wrap = fn($events) => "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" . $events . "END:VCALENDAR\r\n";
$one = function ($vevent) use ($wrap) {
    $f = ical_parse_feed($wrap("BEGIN:VEVENT\r\n" . $vevent . "END:VEVENT\r\n"));
    return ['n' => count($f['events']), 'e' => $f['events'][0] ?? null, 'bad' => $f['unreadable'], 'skip' => $f['skipped']];
};
$r = $one("UID:d1\r\nDTSTART;VALUE=DATE:20261101\r\nDURATION:P3D\r\n");
ick('DURATION:P3D on a date is three nights', $r['e'] && $r['e']['end'] === '2026-11-04' && $r['bad'] === 0, json_encode($r));
$r = $one("UID:d2\r\nDTSTART:20261101T150000Z\r\nDURATION:P1W\r\n");
ick('DURATION on a date-time runs from the instant (one week)', $r['e'] && $r['e']['start'] === '2026-11-01' && $r['e']['end'] === '2026-11-08', json_encode($r));
$r = $one("UID:d3\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261101\r\n");
ick('DTEND equal to DTSTART still blocks its night', $r['e'] && $r['e']['end'] === '2026-11-02', json_encode($r));
$r = $one("uid:d4\r\ndtstart;value=date:20261101\r\ndtend;value=date:20261105\r\nsummary:Reserved\r\n");
ick('property names are case-insensitive', $r['e'] && $r['e']['end'] === '2026-11-05' && $r['e']['summary'] === 'Reserved' && $r['e']['uid'] === 'd4', json_encode($r));
$r = $one("UID:d5\r\nDTSTART;VALUE=DATE:2026-11-01\r\nDTEND;VALUE=DATE:2026-11-03\r\n");
ick('a dashed date is read', $r['e'] && $r['e']['start'] === '2026-11-01' && $r['e']['end'] === '2026-11-03', json_encode($r));
$r = $one("UID:d6\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261103\r\nSUMMARY:Reserved\r\nDESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HM9\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nSUMMARY:Alarm\r\nEND:VALARM\r\n");
ick('an alarm inside the event does not overwrite its description or label', $r['e'] && $r['e']['summary'] === 'Reserved' && stripos($r['e']['description'], 'reservation url') !== false, json_encode($r));
ick('…so the reservation is still classified as one', $r['e'] && ical_classify($r['e']['summary'], $r['e']['description']) === 'booking');
$r = $one("UID:d7\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261103\r\nSTATUS:CANCELLED\r\n");
ick('a CANCELLED event is skipped — its nights are free again — and is not "unreadable"', $r['n'] === 0 && $r['skip'] === 1 && $r['bad'] === 0, json_encode($r));
$r = $one("UID:d8\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\n");
ick('a repeating event is UNREADABLE (only its first night would block)', $r['n'] === 0 && $r['bad'] === 1, json_encode($r));
$r = $one("UID:d9\r\nDTSTART;VALUE=DATE:20261105\r\nDTEND;VALUE=DATE:20261101\r\n");
ick('an end before its start is unreadable, never a guess', $r['n'] === 0 && $r['bad'] === 1, json_encode($r));
$r = $one("UID:d10\r\nDTSTART;TZID=\"(UTC+00:00) Dublin, Edinburgh, Lisbon, London\":20261101T150000\r\nDTEND;TZID=\"(UTC+00:00) Dublin, Edinburgh, Lisbon, London\":20261104T100000\r\n");
ick('an Outlook TZID with colons in quotes is read', $r['e'] && $r['e']['start'] === '2026-11-01' && $r['e']['end'] === '2026-11-04', json_encode($r));
$r = $one("UID:d11\r\nDTSTART;TZID=America/New_York:20261101T220000\r\nDTEND;TZID=America/New_York:20261104T220000\r\n");
ick('a known TZID converts to the quay\'s clock (22:00 New York is the next day here)', $r['e'] && $r['e']['start'] === '2026-11-02' && $r['e']['end'] === '2026-11-05', json_encode($r));
$r = $one("UID:d12\r\nDTSTART;VALUE=DATE:20261340\r\nDTEND;VALUE=DATE:20261342\r\n");
ick('a date that does not exist is unreadable', $r['n'] === 0 && $r['bad'] === 1, json_encode($r));
$ind = ical_parse_feed("BEGIN:VCALENDAR\r\n  BEGIN:VEVENT\r\n  DTSTART;VALUE=DATE:20261101\r\n  DTEND;VALUE=DATE:20261103\r\n  END:VEVENT\r\nEND:VCALENDAR\r\n");
ick('an event the line reader never saw (indented lines) is still COUNTED, so the sync refuses', $ind['unreadable'] >= 1 && count($ind['events']) === 0, json_encode($ind));
$open = ical_parse_feed("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261103\r\n");
ick('an event the body ended inside is unreadable', $open['unreadable'] === 1, json_encode($open));
$two = ical_parse_feed($wrap("BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261103\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT\r\n"));
ick('one good event and one with no dates: one read, one unreadable', count($two['events']) === 1 && $two['unreadable'] === 1, json_encode($two));
ick('a calendar cut off before END:VCALENDAR is not usable', !ical_feed_usable(['ok' => true, 'body' => "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261101\r\n"])['ok']);
ick('…and says so in the owner\'s terms', stripos(ical_feed_usable(['ok' => true, 'body' => "BEGIN:VCALENDAR\r\n"])['error'], 'incomplete') !== false);
ick('the real Airbnb shape still reads in full with nothing unreadable', ical_parse_feed($feed)['unreadable'] === 0 && count(ical_parse_feed($feed)['events']) === 2);
$imp = file_get_contents(__DIR__ . '/ical-import.php');
$impCode = (string) preg_replace('~^\s*//.*$~m', '', $imp);
$pAt = strpos($impCode, 'ical_parse_feed($res[\'body\'])');
$refuseAt = strpos($impCode, "\$parsed['unreadable'] > 0");
$delAt = strpos($impCode, 'DELETE FROM ical_blocks WHERE prop_key = ? AND source = ?');
ick('THE WIRING: the sync parses the whole feed and refuses before it deletes anything', $pAt !== false && $refuseAt !== false && $refuseAt < $delAt, "parse=$pAt refuse=$refuseAt delete=$delAt");

// ---- 8. OUR OWN BOOKING COMING BACK, OR SOMEBODY ELSE'S GUEST? ----------------
echo "\n8. an echo of our booking, or a platform guest\n";
ick('a feed\'s reservation (kind booking, "Reserved") is a platform guest', ical_block_is_reservation(['kind' => 'booking', 'label' => 'Reserved']));
ick('…our own "Booked" coming back through a feed is NOT proof', !ical_block_is_reservation(['kind' => 'booking', 'label' => 'Booked']) && !ical_block_is_reservation(['kind' => 'booking', 'label' => ' booked ']));
ick('…nor is a block or an unknown event', !ical_block_is_reservation(['kind' => 'blocked', 'label' => 'Airbnb (Not available)']) && !ical_block_is_reservation(['kind' => 'unknown', 'label' => 'CLOSED - Not available']));
ick('…nor a row from before kinds were stored', !ical_block_is_reservation(['source' => 'airbnb']));
ick('the clash dialog names what blocks the dates', ical_block_phrase('airbnb') === 'an Airbnb stay' && ical_block_phrase('owner') === 'your own block' && ical_block_phrase('bookingcom') === 'a Booking.com stay');
$bk = (string) preg_replace('~^\s*//.*$~m', '', (string) file_get_contents(__DIR__ . '/bookings.php'));
$cm = substr($bk, (int) strpos($bk, 'function clash_message'), 4000);
ick('clash_message skips an echo only on the booking\'s OWN cottage', strpos($cm, "(string) \$mrow['prop_key'] === (string) \$propKey") !== false);
ick('…and never when the feed proves a platform guest', strpos($cm, '!ical_block_is_reservation($b)') !== false);
ick('…and a database error is not read as free', strpos($cm, 'db_schema_missing($e)') !== false);
$dbs = (string) preg_replace('~^\s*//.*$~m', '', (string) file_get_contents(__DIR__ . '/db.php'));
$dc = substr($dbs, (int) strpos($dbs, 'function dates_clash'), 1400);
ick('dates_clash too: only a missing table reads as free, any other failure is thrown', strpos($dc, 'db_schema_missing($e)') !== false && strpos($dc, 'throw $e;') !== false);
$ca = (string) preg_replace('~^\s*//.*$~m', '', (string) file_get_contents(__DIR__ . '/conflict-audit.php'));
ick('the nightly audit reports a proven guest even at the exact dates', (bool) preg_match('~\$a\[\'check_out\'\] === \$bk\[\'check_out\'\] && !\$real~', $ca));

// ---- 9. THE FETCH REACHES ONLY THE PUBLIC INTERNET --------------------------
echo "\n9. the fetch reaches only the public internet\n";
foreach ([
    ['carrier-grade NAT (a cloud metadata service lives there)', 'http://100.100.100.200/latest/meta-data/'],
    ['the start of 100.64/10', 'http://100.64.0.1/cal.ics'],
    ['the benchmark range', 'http://198.18.0.1/cal.ics'],
    ['NAT64 to 10.0.0.1', 'http://[64:ff9b::a00:1]/cal.ics'],
    ['6to4 wrapping 10.0.0.1', 'http://[2002:a00:1::1]/cal.ics'],
    ['Teredo', 'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/cal.ics'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/cal.ics'],
    ['multicast', 'http://224.0.0.1/cal.ics'],
] as [$label, $url]) {
    ick("$label is blocked", !ical_url_public($url), $url);
}
ick('a public IPv6 address is allowed', ical_url_public('https://[2606:4700:4700::1111]/cal.ics'));
ick('the range test reads partial bytes: 100.127.255.255 is in 100.64/10, 100.128.0.0 is not',
    ical_cidr_match('100.127.255.255', '100.64.0.0/10') && !ical_cidr_match('100.128.0.0', '100.64.0.0/10'));
ick('an IPv4 address is never matched against an IPv6 range', !ical_cidr_match('10.0.0.1', '64:ff9b::/96'));
$res = ical_url_resolve('https://93.184.216.34:8443/cal.ics');
ick('a resolved URL carries the host, port and addresses the fetch pins to', $res['ok'] && $res['port'] === 8443 && $res['ips'] === ['93.184.216.34'], json_encode($res));
$imp = (string) preg_replace('~^\s*//.*$~m', '', (string) file_get_contents(__DIR__ . '/ical-import.php'));
$fu = substr($imp, (int) strpos($imp, 'function fetch_url'), 3500);
ick('THE WIRING: every hop is resolved and the connection pinned to that address', strpos($fu, 'ical_url_resolve($current)') !== false && strpos($fu, 'CURLOPT_RESOLVE') !== false);
ick('…the body is capped as it arrives', strpos($fu, 'CURLOPT_WRITEFUNCTION') !== false && strpos($fu, 'ICAL_MAX_BYTES') !== false);
ick('…and there is no unchecked fallback fetch', strpos($fu, 'file_get_contents') === false);

// ---- 10. A FAILING FEED INTERRUPTS THE OWNER BY TIME, NOT BY SYNC COUNT -------
echo "\n10. a failing feed interrupts by time, not by how many syncs ran\n";
$t0 = '2026-11-01 08:00:00';
$at = fn($h) => date('Y-m-d H:i:s', strtotime($t0) + (int) round($h * 3600));
$a = ical_feed_alert([], true, $t0);
ick('a working feed carries no failure stamps', $a['fail_since'] === '' && !$a['due']);
$a = ical_feed_alert(['ok' => true], false, $t0);
ick('the first failure starts the clock and says nothing', $a['fail_since'] === $t0 && !$a['due']);
$st = ['ok' => false, 'fails' => 40, 'fail_since' => $t0, 'alerted_at' => ''];
ick('forty quick syncs in an hour are still one failing hour — no alert', !ical_feed_alert($st, false, $at(1))['due']);
$a = ical_feed_alert($st, false, $at(7));
ick('…a failure that has lasted past six hours alerts once', $a['due'] && $a['alerted_at'] === $at(7));
ick('…then not again two days later', !ical_feed_alert(['alerted_at' => $at(7)] + $st, false, $at(7 + 48))['due']);
ick('…but again after a week', ical_feed_alert(['alerted_at' => $at(7)] + $st, false, $at(7 + 24 * 7))['due']);
ick('a recovery clears both stamps', ical_feed_alert(['alerted_at' => $at(7)] + $st, true, $at(9)) === ['fail_since' => '', 'alerted_at' => '', 'due' => false]);
$old = ['ok' => false, 'fails' => 1, 'at' => $at(-1), 'ok_at' => $at(-10)];
ick('a status stored before the stamps dates the failure from its last good sync', ical_feed_alert($old, false, $t0)['due'] && ical_feed_alert($old, false, $t0)['fail_since'] === $at(-10));
ick('…and counts the old rule\'s alert (fails ≥ 2) as already sent', !ical_feed_alert(['fails' => 3] + $old, false, $t0)['due']);
$rs = substr($imp, (int) strpos($imp, 'function ical_record_status'), 3000);
ick('THE WIRING: the status decides through ical_feed_alert, under one lock', strpos($rs, 'ical_feed_alert(') !== false && strpos($rs, 'content_locked($key') !== false && strpos($rs, '% 7 === 0') === false);

echo "\n11. a sync that changed nothing is not news\n";
$same = [['source' => 'airbnb', 'ok' => true, 'events' => 4, 'changed' => false], ['source' => 'vrbo', 'ok' => true, 'events' => 1, 'changed' => false]];
ick('an unchanged sync, after today\'s row: no new row', !ical_sync_worth_logging($same, true));
ick('…but the first of the day still logs (the Status trace keeps its mark)', ical_sync_worth_logging($same, false));
ick('a source that changed is logged whatever the hour', ical_sync_worth_logging([['source' => 'airbnb', 'ok' => true, 'changed' => true]], true));
ick('a source that failed is logged too', ical_sync_worth_logging([['source' => 'vrbo', 'ok' => false, 'error' => 'no']], true));
ick('the all-cottages shape (a map of lists) is read the same way', ical_sync_worth_logging(['21a' => $same, 'jollyboat' => [['source' => 'airbnb', 'ok' => true, 'changed' => true]]], true) && !ical_sync_worth_logging(['21a' => $same, 'jollyboat' => $same], true));
ick('a cottage with no feeds (an empty list) is not news', !ical_sync_worth_logging(['21a' => []], true));
$syncSrc = substr($imp, (int) strpos($imp, "if (\$action === 'sync')"), 1400);
ick('THE WIRING: both device syncs ask before logging', substr_count($syncSrc, 'ical_sync_worth_logging(') === 2 && substr_count($syncSrc, "log_activity('calendar', 'ical.sync'") === 2);

echo "\n== Summary ==\n";
if ($fails) {
    echo "  $fails CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL ICAL CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
