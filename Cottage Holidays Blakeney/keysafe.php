<?php
// ============================================================
//  keysafe.php — the key safe keeper's server side. Admin-only.
//
//  POST {action:'state'}  -> every live cottage's record: what the safe is set
//        to, when, which booking it was set FOR, and the rotation history.
//        Codes decrypt server-side only for the signed-in owner.
//
//  POST {action:'confirm', prop_key, code, booking_id, op_id?} -> the owner's
//        "I've set the safe to X". The ONLY writer: generating a code records
//        nothing (the app can't turn a dial), and this is also what releases
//        the code to the guest — my-bookings.php shows it on their My Stays
//        only once forBooking matches their stay and arrival is near. Rides
//        the op ledger so an offline capture's replay applies exactly once.
//
//  Storage: keysafe-<prop_key>, PRIVATE (encrypted at rest — these codes
//  physically open the cottages). The activity log records THAT a rotation
//  happened, never the code: log rows are plaintext.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/keysafe-lib.php';
require_admin();

route_actions([
    'state' => function ($in) {
        $props = [];
        try {
            $st = db()->query("SELECT prop_key, name FROM properties WHERE archived_at IS NULL ORDER BY sort_order, name");
            $props = $st->fetchAll();
        } catch (\Throwable $e) {
            json_out(['error' => 'Could not read the cottage list'], 500);
        }
        $out = [];
        foreach ($props as $p) {
            $rec = keysafe_read(content_secret_json('keysafe-' . $p['prop_key'], null));
            $out[$p['prop_key']] = $rec + ['name' => $p['name']];
        }
        json_out(['ok' => true, 'safes' => $out, 'revealDays' => KEYSAFE_REVEAL_DAYS]);
    },

    'confirm' => function ($in) {
        $opTok = op_claim($in);
        $propKey = clean($in['prop_key'] ?? '');
        $code = trim((string) ($in['code'] ?? ''));
        $bookingId = (int) ($in['booking_id'] ?? 0);
        // The stay ref — how a PLATFORM stay (no bookings row) is identified;
        // sanitised to the 'b:'/'o:' vocabulary, anything else reads as none.
        $stayRef = is_string($in['stay_ref'] ?? null) && preg_match('/^[bo]:[\w:-]{1,40}$/', $in['stay_ref']) ? $in['stay_ref'] : '';
        try {
            $st = db()->prepare('SELECT name FROM properties WHERE prop_key = ?');
            $st->execute([$propKey]);
            $propName = $st->fetchColumn();
        } catch (\Throwable $e) {
            $propName = false;
        }
        if ($propName === false) {
            json_out(['error' => 'Unknown property'], 400);
        }
        if (keysafe_bad($code)) {
            json_out(['error' => 'That code is too guessable — four digits, not a run or a repeat.'], 400);
        }
        // Which guest was the OLD code live for — the history names people, so
        // the dispute record reads "who had which code", not bare ids.
        $guestFor = function ($id) {
            if ($id <= 0) {
                return '';
            }
            try {
                $g = db()->prepare('SELECT name FROM bookings WHERE id = ?');
                $g->execute([$id]);
                return (string) ($g->fetchColumn() ?: '');
            } catch (\Throwable $e) {
                return '';
            }
        };
        if ($bookingId > 0 && $guestFor($bookingId) === '') {
            $bookingId = 0; // a vanished booking is not an error — the SAFE was still set
        }
        $key = 'keysafe-' . $propKey;
        $rec = keysafe_read(content_secret_json($key, null));
        if ($rec['code'] !== '') {
            array_unshift($rec['history'], [
                'code' => $rec['code'],
                'setAt' => $rec['setAt'],
                'forBooking' => $rec['forBooking'],
                'forStay' => $rec['forStay'],
                'guest' => $guestFor($rec['forBooking']),
            ]);
            $rec['history'] = array_slice($rec['history'], 0, KEYSAFE_HISTORY_MAX);
        }
        $rec['code'] = $code;
        $rec['setAt'] = gmdate('c');
        $rec['forBooking'] = $bookingId;
        $rec['forStay'] = $stayRef;
        content_set_secret($key, $rec);
        // THAT it rotated, for whom — never the code (activity_log is plaintext).
        log_activity('keysafe', 'keysafe.rotate', 'Key safe rotated — ' . $propName
            . ($bookingId > 0 ? ' (set for booking #' . $bookingId . ')'
                : ($stayRef !== '' && $stayRef[0] === 'o' ? ' (set for the platform stay arriving ' . substr($stayRef, 2) . ')' : '')));
        json_out(op_finish($opTok, ['ok' => true, 'safe' => $rec]));
    },
]);
