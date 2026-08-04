<?php
// ============================================================
//  waitlist-lib.php — WHO gets told a space has opened, and when NOBODY does.
//
//  Pure judgement + its two data reads, split out of waitlist.php for the reason
//  ical-lib / sweep-lib / payouts-lib / bank-lib were: waitlist.php ROUTES and
//  calls require_admin(), so a test that required it would exit. Gated by
//  test-waitlist.php, which stubs db()/dates_clash()/smtp_send() and drives the
//  real functions.
//
//  The checks worth having are the SILENCES. This code emails guests unprompted
//  about somebody else's cancellation, so the failure that costs something is
//  not "nobody was told" — it is telling them a falsehood, which burns the
//  invitation for the one time it would have worked.
// ============================================================

// Friendly cottage name from the properties table (falls back to the key).
function wl_prop_name($prop)
{
    try {
        $s = db()->prepare('SELECT name FROM properties WHERE prop_key = ?');
        $s->execute([$prop]);
        $n = $s->fetchColumn();
        if ($n) {
            return $n;
        }
    } catch (\Throwable $e) {
    }
    return $prop;
}
// Returns smtp_send's result (['ok'=>bool,...]) so the caller only marks an entry
// notified when the email actually went — a soft mail failure must NOT burn the
// re-invite (mirrors enquiry-nudge.php / anniversary-nudge.php).
function wl_send($row)
{
    if (empty($row['email']) || !function_exists('smtp_send')) {
        return ['ok' => false, 'error' => 'no mailer'];
    }
    $name = wl_prop_name($row['prop_key']);
    // Dates read DD/MM/YYYY like every other guest email (raw ISO leaked here).
    $prettyDates =
        $row['check_in'] && $row['check_out']
            ? ' for ' . uk_date($row['check_in']) . ' to ' . uk_date($row['check_out'])
            : '';
    $guest = $row['name'] ?: 'there';
    $text =
        'Hi ' .
        $guest .
        ",\n\nA space has just opened at {$name}{$prettyDates}. Popular dates can go quickly, so book soon to secure them.\n\nVisit our website to check availability and enquire.\nCottage Holidays Blakeney";
    // Branded HTML part like every other guest email (this one was bare text).
    $html = null;
    if (function_exists('email_shell')) {
        $esc = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
        $accent = function_exists('prop_display') ? prop_display($row['prop_key'])['accent'] : '#C79A64';
        $inner =
            email_h('A space has opened up') .
            email_p('Hello ' . $esc($guest) . ', good news — availability has just opened at <strong style="color:#2A2622;">' . $esc($name) . '</strong>' . $esc($prettyDates) . '.') .
            email_p('Popular dates can go quickly, so book soon to secure them.') .
            email_btn(site_base_url() . '/', 'Check availability');
        $html = email_shell('Availability at ' . $name, $inner, $accent);
    }
    return smtp_send($row['email'], $guest, "Good news — availability at {$name}", $text, $html);
}

// Email every un-notified waitlist entry for $prop whose dates overlap the freed
// range (entries with no dates match any freeing). Returns how many were emailed.
function waitlist_notify_freed($prop, $from, $to)
{
    // A FREEING WITH NO DATES IS NOT A FREEING. The guard below and the query
    // below THAT disagreed about what a missing date meant: the clash check was
    // skipped (`if ($from && $to)`) while the SQL fell back to 1970–9999, which
    // matches EVERY waiting entry for the cottage. So one caller passing an empty
    // date would have emailed the whole waitlist "a space has opened" with the
    // one check that could have refused it switched off — and a guest emailed a
    // falsehood is a guest burned. No caller does today (bookings and
    // ical-import all pass a real range); the two halves now read the range the
    // same way, so none can. NB an ENTRY with no dates still matches any
    // freeing — that is about what the guest asked to hear about, not about
    // whether anything was freed.
    if (!$prop || !$from || !$to) {
        return 0;
    }
    // Don't fire "a space has opened" if the range is still covered by another
    // booking or an OTA block — protects callers (bookings delete/cancel) that
    // don't pre-check, so guests aren't emailed a falsehood (and burned).
    try {
        if (function_exists('dates_clash') && dates_clash($prop, $from, $to)) {
            return 0;
        }
    } catch (\Throwable $e) {
    }
    try {
        $s = db()->prepare("SELECT * FROM waitlist WHERE prop_key = ? AND notified_at IS NULL AND (
                check_in IS NULL OR check_out IS NULL OR (check_in < ? AND check_out > ?))");
        $s->execute([$prop, $to, $from]);
        $rows = $s->fetchAll();
        if (!$rows) {
            return 0;
        }
        // Guarded on the function rather than the file: the callers that matter
        // (bookings.php cancel/delete, ical-import) have already loaded the
        // mailer, and stating the dependency as "do I have smtp_send" is what
        // lets test-waitlist.php supply one instead.
        if (!function_exists('smtp_send')) {
            require_once __DIR__ . '/mailer.php';
        }
        $n = 0;
        foreach ($rows as $w) {
            $r = ['ok' => false];
            try {
                $r = wl_send($w);
            } catch (\Throwable $e) {
            }
            // Only mark as notified on a REAL send — a soft mail failure leaves the
            // entry so a later run retries it (dates that freed up aren't silently lost).
            if (!empty($r['ok'])) {
                db()
                    ->prepare('UPDATE waitlist SET notified_at = NOW() WHERE id = ?')
                    ->execute([$w['id']]);
                $n++;
            }
        }
        return $n;
    } catch (\Throwable $e) {
        return 0;
    }
}
