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

require_once __DIR__ . '/waitlist-lib.php';

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
        // Book by the night before, as a minimum (the enquiries.php rule): a
        // dated wait for a stay starting today or earlier could only ever
        // notify the guest about dates the booking form refuses. Open-date
        // joins ("any time these free up") are untouched.
        if ($ci && $ci <= date('Y-m-d')) {
            json_out(['error' => 'Online bookings need at least a day’s notice — the earliest check-in is tomorrow. For a same-day stay, please get in touch.'], 400);
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
