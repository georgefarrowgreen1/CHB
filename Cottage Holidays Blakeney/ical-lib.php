<?php
// ============================================================
//  ical-lib.php — the pure parts of the platform-calendar sync: is a URL safe
//  to fetch, is a RESPONSE safe to rebuild a cottage's blocks from, and what
//  does an .ics actually say. Split out of ical-import.php so they can be
//  tested (that file routes and calls require_admin(), so requiring it from a
//  test exits) — the same reason sweep-lib / payouts-lib / bank-lib exist.
//
//  Nothing here touches the database or the network. ical-import.php keeps
//  fetch_url(), sync_property() and the endpoint itself.
//  Gated by test-ical.php. Deploys (ical-import.php requires it).
// ============================================================

// The most a calendar may weigh. A year of stays is a few kilobytes; anything near
// this is not a holiday-let calendar, and reading it all could take the nightly
// sync down for every cottage after it.
const ICAL_MAX_BYTES = 5 * 1024 * 1024;

// Ranges that are not the public internet, beyond what PHP's NO_PRIV/NO_RES flags
// refuse: carrier-grade NAT (a cloud's metadata service lives there), the benchmark
// range, protocol/documentation/multicast blocks, and the IPv6 forms that carry an
// IPv4 address inside them (NAT64, 6to4, Teredo) — any of which can reach an
// internal host by another name.
const ICAL_DENY_CIDRS = [
    '100.64.0.0/10', '198.18.0.0/15', '192.0.0.0/24', '192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '255.255.255.255/32',
    '64:ff9b::/96', '64:ff9b:1::/48', '2002::/16', '2001::/32', '2001:db8::/32', 'fc00::/7', 'fe80::/10', 'ff00::/8', '::ffff:0:0/96',
];

// Is $ip inside $cidr? Whole bytes compared as strings, the last partial byte by
// mask (no loop: CI's JIT once miscompiled a hand-written character loop).
function ical_cidr_match($ip, $cidr)
{
    [$net, $bits] = array_pad(explode('/', (string) $cidr, 2), 2, '');
    $a = @inet_pton((string) $ip);
    $b = @inet_pton($net);
    $bits = (int) $bits;
    if ($a === false || $b === false || strlen($a) !== strlen($b) || $bits < 0 || $bits > strlen($a) * 8) {
        return false;
    }
    $whole = intdiv($bits, 8);
    if (substr($a, 0, $whole) !== substr($b, 0, $whole)) {
        return false;
    }
    $rem = $bits % 8;
    if ($rem === 0) {
        return true;
    }
    $mask = (0xFF << (8 - $rem)) & 0xFF;
    return (ord($a[$whole]) & $mask) === (ord($b[$whole]) & $mask);
}

// May the server connect to this address?
function ical_ip_public($ip)
{
    if (!filter_var($ip, FILTER_VALIDATE_IP) || !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        return false;
    }
    foreach (ICAL_DENY_CIDRS as $c) {
        if (ical_cidr_match($ip, $c)) {
            return false;
        }
    }
    return true;
}

// Where would a fetch of this URL connect? ['ok', 'host', 'port', 'ips'], ok only
// when it is http(s) to a host whose EVERY address is public. The fetch then pins
// the connection to one of these addresses (CURLOPT_RESOLVE), so a name that
// answers differently a moment later (DNS rebinding) cannot send it inside.
// Unresolvable fails CLOSED. Blocks SSRF even though only an admin sets the URL.
function ical_url_resolve($url)
{
    $no = ['ok' => false, 'host' => '', 'port' => 0, 'ips' => []];
    $u = parse_url((string) $url);
    $scheme = strtolower((string) ($u['scheme'] ?? ''));
    if (!$u || !in_array($scheme, ['http', 'https'], true) || empty($u['host'])) {
        return $no;
    }
    $host = trim((string) $u['host'], '[]');
    $port = (int) ($u['port'] ?? ($scheme === 'https' ? 443 : 80));
    $ips = [];
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        $ips[] = $host;
    } else {
        foreach ((array) @dns_get_record($host, DNS_A) as $r) {
            if (!empty($r['ip'])) {
                $ips[] = $r['ip'];
            }
        }
        foreach ((array) @dns_get_record($host, DNS_AAAA) as $r) {
            if (!empty($r['ipv6'])) {
                $ips[] = $r['ipv6'];
            }
        }
        if (!$ips) {
            $g = gethostbyname($host); // where dns_get_record is unavailable
            if ($g !== $host) {
                $ips[] = $g;
            }
        }
    }
    if (!$ips) {
        return $no;
    }
    foreach ($ips as $ip) {
        if (!ical_ip_public($ip)) {
            return $no;
        }
    }
    return ['ok' => true, 'host' => $host, 'port' => $port, 'ips' => array_values(array_unique($ips))];
}

// Is this an http(s) URL to a PUBLIC host? (ical_url_resolve, answered as yes/no.)
function ical_url_public($url)
{
    return ical_url_resolve($url)['ok'];
}

// Parse an iCal string into [['uid'=>, 'start'=>'YYYY-MM-DD', 'end'=>'YYYY-MM-DD'], ...]
// IS THIS RESPONSE SAFE TO REBUILD A COTTAGE'S BLOCKS FROM? The most dangerous
// decision in the app: sync_property DELETEs a source's blocks and re-inserts from
// the feed, so answering "yes" to a bad response empties the calendar and the
// cottage instantly reads as free for every Airbnb stay — a double booking that no
// endpoint guard can prevent, because the block simply is not there.
//
// Two ways to fail. The fetch itself failed (network, DNS, blocked URL, non-2xx),
// or it returned 200 with something that is not a calendar — a login page, an HTML
// error, a moved link. A REAL feed with no bookings still contains BEGIN:VCALENDAR,
// so "everything is free now" is a legitimate answer and passes through: that is
// how an external cancellation frees the dates, and the waitlist is told.
//
// It was two inline conditions inside sync_property with no test of either. Named
// so the rule can be stated once, and gated by test-ical.php.
function ical_feed_usable($res)
{
    if (empty($res['ok'])) {
        return ['ok' => false, 'error' => (string) ($res['error'] ?? 'fetch failed')];
    }
    $body = (string) ($res['body'] ?? '');
    if (stripos($body, 'BEGIN:VCALENDAR') === false) {
        return ['ok' => false, 'error' => 'not a calendar feed — check the link'];
    }
    // A body cut off in transit is still a calendar, with its tail missing: the
    // events after the cut would vanish and their nights read as free.
    if (stripos($body, 'END:VCALENDAR') === false) {
        return ['ok' => false, 'error' => 'the calendar arrived incomplete — nothing was changed'];
    }
    return ['ok' => true, 'error' => ''];
}

// The events a sync can trust, and a count of the ones it could not read. Every
// VEVENT is one of three: READ (dates it can use), SKIPPED (cancelled — it no longer
// exists), or UNREADABLE. sync_property refuses to rebuild while anything is
// unreadable, because rebuilding from what survived frees the nights of every event
// it dropped. The count starts from the raw BEGIN:VEVENT markers, so an event the
// line parser never saw at all (indented, mangled) is still counted.
function ical_parse_feed($text)
{
    $text = (string) preg_replace('/^\xEF\xBB\xBF/', '', (string) $text); // a byte-order mark is not part of the first line
    // Unfold folded lines: a line break followed by ONE space or tab continues the line.
    $text = (string) preg_replace("/\r\n[ \t]/", '', $text);
    $text = (string) preg_replace("/\n[ \t]/", '', $text);
    $text = (string) preg_replace("/\r[ \t]/", '', $text);
    $lines = preg_split("/\r\n|\n|\r/", $text) ?: [];
    $events = [];
    $skipped = 0;
    $unreadable = 0;
    $cur = null;
    $depth = 0;
    foreach ($lines as $raw) {
        $p = ical_split_line(rtrim((string) $raw));
        if ($p === null) {
            continue;
        }
        [$name, $params, $value] = $p;
        if ($name === 'BEGIN') {
            if (strtoupper(trim($value)) === 'VEVENT') {
                if ($cur !== null) {
                    $unreadable++; // the previous event never ended
                }
                $cur = ['uid' => null, 'dtstart' => null, 'dtend' => null, 'duration' => null, 'summary' => '', 'description' => '', 'status' => '', 'repeats' => false];
                $depth = 0;
            } elseif ($cur !== null) {
                $depth++; // a nested component (VALARM): its properties are not the event's
            }
            continue;
        }
        if ($name === 'END') {
            if ($cur === null) {
                continue;
            }
            if (strtoupper(trim($value)) === 'VEVENT') {
                $r = ical_event_finish($cur);
                if ($r['event']) {
                    $events[] = $r['event'];
                } elseif ($r['skip']) {
                    $skipped++;
                } else {
                    $unreadable++;
                }
                $cur = null;
                $depth = 0;
            } elseif ($depth > 0) {
                $depth--;
            }
            continue;
        }
        if ($cur === null || $depth > 0) {
            continue;
        }
        if ($name === 'UID') {
            $cur['uid'] = $value;
        } elseif ($name === 'DTSTART') {
            $cur['dtstart'] = [$value, $params];
        } elseif ($name === 'DTEND') {
            $cur['dtend'] = [$value, $params];
        } elseif ($name === 'DURATION') {
            $cur['duration'] = $value;
        } elseif ($name === 'SUMMARY') {
            $cur['summary'] = ical_unescape($value);
        } elseif ($name === 'DESCRIPTION') {
            $cur['description'] = ical_unescape($value);
        } elseif ($name === 'STATUS') {
            $cur['status'] = strtoupper(trim($value));
        } elseif ($name === 'RRULE' || $name === 'RDATE') {
            $cur['repeats'] = true;
        }
    }
    if ($cur !== null) {
        $unreadable++; // the body ended inside an event
    }
    $markers = preg_match_all('/BEGIN:VEVENT/i', $text);
    $unreadable += max(0, (int) $markers - (count($events) + $skipped + $unreadable));
    return ['events' => $events, 'skipped' => $skipped, 'unreadable' => $unreadable];
}

// The readable events alone, for callers that only want the dates.
function parse_ical($text)
{
    return ical_parse_feed($text)['events'];
}

// One content line → [NAME (upper case), params (upper-case keys), value], or null.
// Names are case-insensitive (RFC 5545), and the value starts at the first colon
// OUTSIDE a quoted parameter: Outlook writes TZID="(UTC+00:00) Dublin, …":… . Regex,
// not a character loop (CI's JIT once miscompiled one of those). A line the strict
// form refuses falls back to the first colon, as the parser always read it.
function ical_split_line($line)
{
    $line = (string) $line;
    if ($line === '' || strpos($line, ':') === false) {
        return null;
    }
    $param = '"[^"]*"|[^";:,]*';
    if (preg_match('/^([A-Za-z0-9-]+)((?:;[A-Za-z0-9-]+=(?:' . $param . ')(?:,(?:' . $param . '))*)*):(.*)$/s', $line, $m)) {
        $params = [];
        if (preg_match_all('/;([A-Za-z0-9-]+)=("[^"]*"|[^";:,]*)/', $m[2], $pm, PREG_SET_ORDER)) {
            foreach ($pm as $x) {
                $params[strtoupper($x[1])] = trim($x[2], '"');
            }
        }
        return [strtoupper($m[1]), $params, $m[3]];
    }
    $i = strpos($line, ':');
    $head = substr($line, 0, $i);
    $name = strtoupper((string) preg_replace('/;.*$/s', '', $head));
    return [trim($name), [], substr($line, $i + 1)];
}

// One event's dates, or why it has none. ['event' => [...]|null, 'skip' => bool].
//   - STATUS:CANCELLED is SKIPPED: the event no longer exists, so its nights are free.
//   - A repeating event (RRULE/RDATE) is UNREADABLE: only its first night would be
//     blocked. Platforms never send one; refusing beats under-blocking.
//   - No DTEND: DURATION if given, else the RFC's one day for a date (and a zero-length
//     event, or DTEND equal to DTSTART, blocks its night: freeing it could sell a
//     night a guest holds). An end BEFORE the start is unreadable.
// TRANSP:TRANSPARENT still blocks, deliberately: a feed marking its stays "free" would
// otherwise empty the calendar, and an over-blocked night costs less than a double booking.
function ical_event_finish(array $c)
{
    $none = ['event' => null, 'skip' => false];
    if (($c['status'] ?? '') === 'CANCELLED') {
        return ['event' => null, 'skip' => true];
    }
    if (!empty($c['repeats']) || empty($c['dtstart'])) {
        return $none;
    }
    $s = ical_dt($c['dtstart'][0], $c['dtstart'][1]);
    if ($s === null) {
        return $none;
    }
    $endDate = null;
    if (!empty($c['dtend'])) {
        $e = ical_dt($c['dtend'][0], $c['dtend'][1]);
        if ($e === null) {
            return $none;
        }
        $endDate = $e['date'];
    } elseif ($c['duration'] !== null && $c['duration'] !== '') {
        $d = ical_duration((string) $c['duration']);
        if ($d === null) {
            return $none;
        }
        if ($s['at'] === null) {
            $endDate = ical_add_days($s['date'], $d['days']);
        } else {
            $endDate = $s['at']->modify('+' . $d['days'] . ' days')->modify('+' . $d['secs'] . ' seconds')->format('Y-m-d');
        }
    } else {
        $endDate = $s['at'] === null ? ical_add_days($s['date'], 1) : $s['date'];
    }
    if ($endDate === null || $endDate < $s['date']) {
        return $none;
    }
    if ($endDate === $s['date']) {
        $endDate = ical_add_days($s['date'], 1);
    }
    return ['event' => [
        'uid' => $c['uid'],
        'start' => $s['date'],
        'end' => $endDate,
        'summary' => (string) $c['summary'],
        'description' => (string) $c['description'],
    ], 'skip' => false];
}

function ical_add_days($ymd, $n)
{
    try {
        return (new DateTimeImmutable($ymd . ' 12:00:00', new DateTimeZone('Europe/London')))->modify('+' . (int) $n . ' days')->format('Y-m-d');
    } catch (\Throwable $e) {
        return null;
    }
}

// A DURATION (P3D, P1W, PT36H …) → whole days + leftover seconds; null when negative or malformed.
function ical_duration($d)
{
    if (!preg_match('/^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i', trim((string) $d), $m) || trim((string) $d, "+Pp \t") === '') {
        return null;
    }
    $days = 7 * (int) ($m[1] ?? 0) + (int) ($m[2] ?? 0);
    $secs = 3600 * (int) ($m[3] ?? 0) + 60 * (int) ($m[4] ?? 0) + (int) ($m[5] ?? 0);
    return ['days' => $days, 'secs' => $secs];
}

// A DTSTART/DTEND value → ['date' => Y-m-d on the quay's clock, 'at' => the instant
// for a DATE-TIME (null for a DATE)], or null. UTC (…Z) and a known TZID convert to
// London; a floating time, or a TZID PHP doesn't know (Outlook's names), is read as
// written. Anything else falls back to ical_date's old reading, as a date.
function ical_dt($value, array $params = [])
{
    $v = trim((string) $value);
    $london = new DateTimeZone('Europe/London');
    if (preg_match('/^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2}):?(\d{2})(Z?)$/i', $v, $m)) {
        if (!checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return null;
        }
        $tz = $london;
        if ($m[7] !== '') {
            $tz = new DateTimeZone('UTC');
        } elseif (!empty($params['TZID'])) {
            try {
                $tz = new DateTimeZone((string) $params['TZID']);
            } catch (\Throwable $e) {
                $tz = $london;
            }
        }
        try {
            $at = (new DateTimeImmutable("{$m[1]}-{$m[2]}-{$m[3]}T{$m[4]}:{$m[5]}:{$m[6]}", $tz))->setTimezone($london);
        } catch (\Throwable $e) {
            return null;
        }
        return ['date' => $at->format('Y-m-d'), 'at' => $at];
    }
    if (preg_match('/^(\d{4})-?(\d{2})-?(\d{2})$/', $v, $m)) {
        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? ['date' => "{$m[1]}-{$m[2]}-{$m[3]}", 'at' => null] : null;
    }
    $d = ical_date($v);
    return $d === null ? null : ['date' => $d, 'at' => null];
}

// RFC 5545 text escapes (\n \, \; \\) back to plain text.
function ical_unescape($v)
{
    return str_replace(['\\n', '\\N', '\\,', '\\;', '\\\\'], ["\n", "\n", ',', ';', '\\'], (string) $v);
}

// IS THIS EVENT A GUEST'S BOOKING OR THE HOST BLOCKING DATES OUT? The feed carries a
// label and a description, and the platforms use them differently — but never a
// guess: anything not recognised is 'unknown', and 'unknown' is treated EXACTLY as
// every imported event was before this existed (a stay). Only a clear block is
// treated as not-a-stay, and even then it still blocks the calendar everywhere.
//   booking — a reservation link / id / "last 4 digits of the phone" in the
//             description (Airbnb), or a label that is plainly a reservation
//   blocked — a label that is plainly the host's block ("Airbnb (Not available)",
//             "Blocked", "Unavailable", "Closed")
// Reservation evidence wins over a blocked-looking label.
function ical_classify($summary, $description)
{
    $s = strtolower(trim((string) $summary));
    $d = strtolower((string) $description);
    if (preg_match('/(reservation|booking)\s*(url|id|number|code)|\/reservations\/details|last\s*4\s*digits/', $d)) {
        return 'booking';
    }
    // Booking.com titles EVERY unavailable period "CLOSED - Not available", its guests
    // included, so that label cannot tell a stay from a closure: unknown, i.e. a stay.
    // Read as a block, every Booking.com guest dropped out of changeovers, the day
    // sheet and the key-safe rotation (their code never changed for them).
    if (preg_match('/^closed\s*-\s*not available\b/', $s)) {
        return 'unknown';
    }
    if (preg_match('/^(airbnb\s*)?\(?(not available|unavailable|blocked|closed)\b/', $s)) {
        return 'blocked';
    }
    if (preg_match('/^(reserved|reservation|booked|booking)\b/', $s)) {
        return 'booking';
    }
    return 'unknown';
}

// IS THIS IMPORTED EVENT PROVABLY SOMEONE ELSE'S RESERVATION? A two-way sync brings
// our own bookings back as blocks at their own dates (we export them, the platform
// re-exports them), so a block exactly matching a booking is normally that echo and
// is skipped by the clash check, the nightly audit and the timeline. A REAL guest on
// the platform at exactly those dates is the double booking that rule would hide.
// The proof is ical_classify's 'booking' — but not on the label 'Booked', which is
// what our own export writes and what a feed that passes titles through hands back.
function ical_block_is_reservation(array $row): bool
{
    return (string) ($row['kind'] ?? '') === 'booking' && strtolower(trim((string) ($row['label'] ?? ''))) !== 'booked';
}

// What an imported or owner block IS, said on the dialog the owner decides from ("a
// Owner booking" called their own block somebody's booking).
function ical_block_phrase(string $source): string
{
    $names = ['airbnb' => 'an Airbnb stay', 'bookingcom' => 'a Booking.com stay', 'vrbo' => 'a Vrbo stay', 'owner' => 'your own block'];
    return $names[strtolower($source)] ?? ('a stay from ' . ($source !== '' ? $source : 'another calendar'));
}

// SHOULD A FAILING FEED INTERRUPT THE OWNER NOW? The alert went on the second
// failure in a row and every seventh after — counted in SYNC RUNS, which happen
// nightly, from every back-office device every few minutes and on Sync now, so one
// broken link pushed "urgent" several times a day through quiet hours. Now it is
// TIME: the first alert once a feed has been failing for ICAL_ALERT_AFTER (a
// platform's blip clears itself), then once a week while it stays broken. Pure:
// $prev is the source's stored status, $now 'Y-m-d H:i:s'. Returns the two stamps
// to store and whether to alert.
const ICAL_ALERT_AFTER = 6 * 3600;
const ICAL_ALERT_EVERY = 7 * 86400;
function ical_feed_alert(array $prev, $ok, $now)
{
    if ($ok) {
        return ['fail_since' => '', 'alerted_at' => '', 'due' => false];
    }
    $wasFailing = $prev && empty($prev['ok']);
    $since = $wasFailing ? (string) ($prev['fail_since'] ?? '') : '';
    $alerted = $wasFailing ? (string) ($prev['alerted_at'] ?? '') : '';
    if ($wasFailing && !array_key_exists('fail_since', $prev)) {
        // A status stored before these stamps: the failure began after the last good
        // sync, and the old rule had already alerted once it had failed twice.
        $since = (string) ($prev['ok_at'] ?? '');
        $alerted = (int) ($prev['fails'] ?? 0) >= 2 ? (string) ($prev['at'] ?? '') : '';
    }
    if ($since === '' || strtotime($since) === false) {
        $since = $now;
    }
    $t = strtotime($now);
    $due = $t - strtotime($since) >= ICAL_ALERT_AFTER
        && ($alerted === '' || strtotime($alerted) === false || $t - strtotime($alerted) >= ICAL_ALERT_EVERY);
    return ['fail_since' => $since, 'alerted_at' => $due ? $now : $alerted, 'due' => $due];
}

// The label kept for display: plain text, no control characters, short.
function ical_label($summary)
{
    $t = trim(preg_replace('/[\x00-\x1F\x7F]+/', ' ', (string) $summary));
    return function_exists('mb_substr') ? mb_substr($t, 0, 80) : substr($t, 0, 80);
}

// Normalise an iCal date/datetime value to YYYY-MM-DD.
// A UTC DATE-TIME (…THHMMSSZ) must be converted to the quay's own clock before
// the date is taken, or a checkout at 00:00 local (23:00Z the previous day in
// summer) is stored a night early and that final night reads FREE — a
// double-booking window. Airbnb/Vrbo/Booking use all-day VALUE=DATE and are
// unaffected; this bites a channel-manager or personal feed emitting a UTC time.
function ical_date($v)
{
    $v = trim($v);
    if (preg_match('/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/', $v, $m)) {
        try {
            $dt = new DateTime("{$m[1]}-{$m[2]}-{$m[3]}T{$m[4]}:{$m[5]}:{$m[6]}Z");
            $dt->setTimezone(new DateTimeZone('Europe/London'));
            return $dt->format('Y-m-d');
        } catch (\Throwable $e) {
            /* fall through to the plain date extraction */
        }
    }
    if (preg_match('/(\d{4})-?(\d{2})-?(\d{2})/', $v, $m) && checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
        return $m[1] . '-' . $m[2] . '-' . $m[3];
    }
    return null;
}

// A feed's blocks as the comparable thing they are: one string per block, made
// of every column the sync stores, sorted. Two feeds with the same strings are
// the same calendar, so the sync can leave the table alone and tell the back
// office there is nothing to reload. Duplicates are kept (two identical blocks
// are not one), and `kind`/`label` count, because the owner sees both.
function ical_block_sig(array $rows)
{
    $out = [];
    foreach ($rows as $r) {
        $out[] = implode("\x1F", [
            (string) ($r['check_in'] ?? ''),
            (string) ($r['check_out'] ?? ''),
            (string) ($r['uid'] ?? ''),
            (string) ($r['kind'] ?? ''),
            (string) ($r['label'] ?? ''),
        ]);
    }
    sort($out, SORT_STRING);
    return $out;
}
