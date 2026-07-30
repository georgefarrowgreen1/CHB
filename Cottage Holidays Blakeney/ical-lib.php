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

// Is this an http(s) URL to a PUBLIC host? Blocks SSRF to internal/loopback/
// link-local targets (169.254.x, 127.x, 10.x, 192.168.x, …) even though only an
// admin sets the feed URL — trusted-user SSRF is still worth closing.
function ical_url_public($url)
{
    $u = parse_url((string) $url);
    if (!$u || !in_array(strtolower($u['scheme'] ?? ''), ['http', 'https'], true) || empty($u['host'])) {
        return false;
    }
    $host = $u['host'];
    // Collect EVERY address this host resolves to (IPv4 + IPv6). A bare IP is
    // checked as-is. If nothing resolves, fail CLOSED — an unresolvable or
    // IPv6-only name must never skip the private-range check (the old
    // gethostbyname-only path let those through).
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
            $g = gethostbyname($host); // fallback where dns_get_record is unavailable
            if ($g !== $host) {
                $ips[] = $g;
            }
        }
    }
    if (!$ips) {
        return false; // could not resolve — refuse rather than trust cURL's own lookup
    }
    foreach ($ips as $ip) {
        if (
            !filter_var($ip, FILTER_VALIDATE_IP) ||
            !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)
        ) {
            return false; // unparseable, private, or reserved — refuse
        }
    }
    return true;
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
    if (stripos((string) ($res['body'] ?? ''), 'BEGIN:VCALENDAR') === false) {
        return ['ok' => false, 'error' => 'not a calendar feed — check the link'];
    }
    return ['ok' => true, 'error' => ''];
}

function parse_ical($text)
{
    // Unfold folded lines (continuation lines begin with a space or tab).
    $text = preg_replace("/\r\n[ \t]/", '', $text);
    $text = preg_replace("/\n[ \t]/", '', $text);
    $lines = preg_split("/\r\n|\n|\r/", $text);
    $events = [];
    $cur = null;
    foreach ($lines as $line) {
        if (strpos($line, 'BEGIN:VEVENT') === 0) {
            $cur = ['uid' => null, 'start' => null, 'end' => null];
            continue;
        }
        if (strpos($line, 'END:VEVENT') === 0) {
            if ($cur && $cur['start'] && $cur['end']) {
                $events[] = $cur;
            }
            $cur = null;
            continue;
        }
        if ($cur === null) {
            continue;
        }
        if (strpos($line, 'UID') === 0) {
            $cur['uid'] = substr($line, strpos($line, ':') + 1);
        } elseif (strpos($line, 'DTSTART') === 0) {
            $cur['start'] = ical_date(substr($line, strpos($line, ':') + 1));
        } elseif (strpos($line, 'DTEND') === 0) {
            $cur['end'] = ical_date(substr($line, strpos($line, ':') + 1));
        }
    }
    return $events;
}

// Normalise an iCal date/datetime value to YYYY-MM-DD.
function ical_date($v)
{
    $v = trim($v);
    if (preg_match('/(\d{4})(\d{2})(\d{2})/', $v, $m)) {
        return $m[1] . '-' . $m[2] . '-' . $m[3];
    }
    return null;
}
