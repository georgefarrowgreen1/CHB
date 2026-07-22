<?php
// ============================================================
//  waitlist.php — "notify me" waitlist for sold-out dates.
//
//  PUBLIC:  POST {action:'join', prop, name, email, check_in?, check_out?, note?}
//  ADMIN:   GET / POST {action:'list'}        -> all entries
//           POST {action:'notify', id}        -> email this guest now (+ mark)
//           POST {action:'delete', id}
//
//  Also exposes waitlist_notify_freed($prop,$from,$to) so bookings.php can
//  auto-email matching guests when a cancellation frees those dates.
//
//  Table created by migration-waitlist.sql (via migrate.php).
// ============================================================
require_once __DIR__ . '/db.php';

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
    if (!$prop) {
        return 0;
    }
    // Don't fire "a space has opened" if the range is still covered by another
    // booking or an OTA block — protects callers (bookings delete/cancel) that
    // don't pre-check, so guests aren't emailed a falsehood (and burned).
    if ($from && $to) {
        try {
            if (function_exists('dates_clash') && dates_clash($prop, $from, $to)) {
                return 0;
            }
        } catch (\Throwable $e) {
        }
    }
    try {
        $s = db()->prepare("SELECT * FROM waitlist WHERE prop_key = ? AND notified_at IS NULL AND (
                check_in IS NULL OR check_out IS NULL OR (check_in < ? AND check_out > ?))");
        $s->execute([$prop, $to ?: '9999-12-31', $from ?: '1970-01-01']);
        $rows = $s->fetchAll();
        if (!$rows) {
            return 0;
        }
        require_once __DIR__ . '/mailer.php';
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

// ---- HTTP routing (only when this file is the requested script) ----
if (basename($_SERVER['SCRIPT_NAME'] ?? '') === 'waitlist.php') {
    $in = body();
    $action = $in['action'] ?? '';

    if ($action === 'join') {
        rate_limit('waitlist', 12); // curb unauthenticated row-flooding (no email sent here)
        $prop = preg_replace('/[^a-z0-9_]/i', '', (string) ($in['prop'] ?? ''));
        $name = substr(clean($in['name'] ?? ''), 0, 120);
        $email = substr(clean($in['email'] ?? ''), 0, 190);
        $ci = clean($in['check_in'] ?? '');
        $co = clean($in['check_out'] ?? '');
        $note = substr(clean($in['note'] ?? ''), 0, 500);
        if ($prop === '') {
            json_out(['error' => 'Please choose a cottage.'], 400);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_out(['error' => 'Please enter a valid email address.'], 400);
        }
        $ci = preg_match('/^\d{4}-\d{2}-\d{2}$/', $ci) ? $ci : null;
        $co = preg_match('/^\d{4}-\d{2}-\d{2}$/', $co) ? $co : null;
        if ($ci && $co && $co <= $ci) {
            json_out(['error' => 'Check-out must be after check-in.'], 400);
        }
        // Already waiting for this exact cottage + dates? Idempotent — don't pile
        // up a duplicate the owner would email twice. (The uniq_join index from
        // migration-100 race-proofs the dated case; this pre-check also covers
        // open-date joins and returns a friendly result rather than a 500 on the
        // duplicate-key error. NULL dates compare via COALESCE.)
        try {
            $dup = db()->prepare(
                "SELECT id FROM waitlist
                  WHERE prop_key = ? AND email = ?
                    AND COALESCE(check_in, '') = ? AND COALESCE(check_out, '') = ?
                    AND notified_at IS NULL LIMIT 1",
            );
            $dup->execute([$prop, $email, (string) ($ci ?? ''), (string) ($co ?? '')]);
            if ($dup->fetchColumn()) {
                json_out(['ok' => true, 'already' => true]);
            }
        } catch (\Throwable $e) {
            // table not migrated / column missing — fall through to the insert.
        }
        try {
            // ON DUPLICATE KEY collapses a genuinely-simultaneous dated race (the
            // pre-check can't) into one row instead of erroring.
            db()
                ->prepare(
                    'INSERT INTO waitlist (prop_key, name, email, check_in, check_out, note) VALUES (?,?,?,?,?,?)
                     ON DUPLICATE KEY UPDATE name = VALUES(name), note = VALUES(note)',
                )
                ->execute([$prop, $name, $email, $ci, $co, $note]);
            log_activity('calendar', 'waitlist.join', 'Waitlist join — ' . ($name ?: 'a guest'), ['actor' => 'guest', 'prop_key' => (string) $prop, 'entity' => 'waitlist']);
            json_out(['ok' => true]);
        } catch (\Throwable $e) {
            json_out(['error' => 'Could not join the waitlist — please try again.'], 500);
        }
    }

    // Everything below is admin-only.
    require_admin();

    if ($action === 'delete') {
        $id = (int) ($in['id'] ?? 0);
        db()
            ->prepare('DELETE FROM waitlist WHERE id = ?')
            ->execute([$id]);
        json_out(['ok' => true]);
    }
    if ($action === 'notify') {
        $id = (int) ($in['id'] ?? 0);
        $s = db()->prepare('SELECT * FROM waitlist WHERE id = ?');
        $s->execute([$id]);
        $row = $s->fetch();
        if (!$row) {
            json_out(['error' => 'Entry not found'], 404);
        }
        $r = ['ok' => false, 'error' => 'send failed'];
        try {
            require_once __DIR__ . '/mailer.php';
            $r = wl_send($row);
        } catch (\Throwable $e) {
        }
        if (empty($r['ok'])) {
            json_out(['error' => $r['error'] ?? 'Could not send the email'], 400);
        }
        db()
            ->prepare('UPDATE waitlist SET notified_at = NOW() WHERE id = ?')
            ->execute([$id]);
        log_activity('calendar', 'waitlist.notify', 'Waitlist guest notified — ' . ($row['name'] ?? ''), ['prop_key' => $row['prop_key'] ?? '', 'entity' => 'waitlist', 'entity_id' => (string) $id]);
        json_out(['ok' => true]);
    }

    // default: list
    try {
        $rows = db()
            ->query(
                'SELECT id, prop_key, name, email, check_in, check_out, note, notified_at, created_at FROM waitlist ORDER BY created_at DESC',
            )
            ->fetchAll();
        json_out([
            'ok' => true,
            'waitlist' => array_map(
                fn($r) => [
                    'id' => (int) $r['id'],
                    'prop_key' => $r['prop_key'],
                    'name' => $r['name'],
                    'email' => $r['email'],
                    'check_in' => $r['check_in'],
                    'check_out' => $r['check_out'],
                    'note' => $r['note'],
                    'notified_at' => $r['notified_at'],
                    'created_at' => $r['created_at'],
                ],
                $rows,
            ),
        ]);
    } catch (\Throwable $e) {
        json_out(['ok' => true, 'waitlist' => []]);
    }
}
