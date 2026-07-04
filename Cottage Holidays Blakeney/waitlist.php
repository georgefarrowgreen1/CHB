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
function wl_send($row)
{
    if (empty($row['email']) || !function_exists('smtp_send')) {
        return;
    }
    $name = wl_prop_name($row['prop_key']);
    $dates = $row['check_in'] && $row['check_out'] ? " for {$row['check_in']} to {$row['check_out']}" : '';
    smtp_send(
        $row['email'],
        $row['name'] ?: 'there',
        "Good news — availability at {$name}",
        'Hi ' .
            ($row['name'] ?: 'there') .
            ",\n\nA space has just opened at {$name}{$dates}. Popular dates can go quickly, so book soon to secure them.\n\nVisit our website to check availability and enquire.\nCottage Holidays Blakeney",
    );
}

// Email every un-notified waitlist entry for $prop whose dates overlap the freed
// range (entries with no dates match any freeing). Returns how many were emailed.
function waitlist_notify_freed($prop, $from, $to)
{
    if (!$prop) {
        return 0;
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
            try {
                wl_send($w);
            } catch (\Throwable $e) {
            }
            db()
                ->prepare('UPDATE waitlist SET notified_at = NOW() WHERE id = ?')
                ->execute([$w['id']]);
            $n++;
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
        try {
            db()
                ->prepare(
                    'INSERT INTO waitlist (prop_key, name, email, check_in, check_out, note) VALUES (?,?,?,?,?,?)',
                )
                ->execute([$prop, $name, $email, $ci, $co, $note]);
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
        try {
            require_once __DIR__ . '/mailer.php';
            wl_send($row);
        } catch (\Throwable $e) {
        }
        db()
            ->prepare('UPDATE waitlist SET notified_at = NOW() WHERE id = ?')
            ->execute([$id]);
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
