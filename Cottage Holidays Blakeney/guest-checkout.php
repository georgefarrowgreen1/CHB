<?php
// ============================================================
//  guest-checkout.php — the guest's own "we've left the cottage" tap.
//
//  ONE write, its own door. My Stays' read endpoint (my-bookings.php) is
//  deliberately read-only — a POST there is a tested 405 — so the tap lives
//  behind its own guard rather than reopening that decision. The rules:
//
//  · GUEST-SCOPED: require_guest(), and the booking must belong to the
//    session's own email (plain equality — the migration-112 collation rule;
//    wrapping the column in LOWER() throws away idx_email).
//  · THE WINDOW IS THE SERVER'S: the last morning only. The button appears
//    client-side on checkout day, and this refusal is what makes a stale tab
//    unable to check out on the wrong day. Before the day: the button hasn't
//    unlocked. After the day: the stay has already ended — the fact is moot
//    (the date says it) and a late tap must not re-notify the owner.
//  · ONCE, EXACTLY: the write rides the op ledger (a poor-signal retry of the
//    same request replays the stored answer), the UPDATE is COALESCE so two
//    devices racing keep the FIRST time, and a fresh second tap is answered
//    gracefully with the original time — never an error at a guest who is
//    standing in a car park doing the right thing.
//  · A SIGNAL, NEVER A CLAIM: what is recorded and told is that the GUEST
//    TAPPED — the owner's push says "tapped \"we've left\" at 9:41", not that
//    the cottage is empty or inspected, because the app cannot know that.
//  · THE TELL IS BEST-EFFORT: the record stands whatever happens to the
//    notification (alert_owner already falls back to email when no device is
//    listening, and its 'checkout' category is mutable in notify-prefs).
// ============================================================
require_once __DIR__ . '/db.php';
require_guest();

route_actions([
    'left' => function ($in) {
        $opTok = op_claim($in);
        $bid = (int) ($in['booking_id'] ?? 0);
        if ($bid <= 0) {
            json_out(['error' => 'Which booking?'], 400);
        }
        $g = db()->prepare('SELECT email FROM guests WHERE id = ?');
        $g->execute([$_SESSION['guest_id']]);
        $email = (string) $g->fetchColumn();
        if ($email === '') {
            json_out(['error' => 'Please log in'], 401);
        }
        $s = db()->prepare('SELECT * FROM bookings WHERE id = ? AND email = ?');
        $s->execute([$bid, $email]);
        $b = $s->fetch();
        if (!$b) {
            json_out(['error' => "We couldn't find that booking on your account."], 404);
        }
        $today = date('Y-m-d');
        if ($today < (string) $b['check_out']) {
            json_out(['error' => 'The check-out button unlocks on your last morning.'], 409);
        }
        if ($today > (string) $b['check_out']) {
            json_out(['error' => 'That stay has already ended — nothing needs doing.'], 409);
        }
        // Already tapped (this device earlier, or the other half of the party):
        // the answer is the ORIGINAL time, said as success. A guest doing the
        // right thing twice must never read an error.
        if (!empty($b['guest_checked_out_at'])) {
            json_out(op_finish($opTok, ['ok' => true, 'already' => true, 'at' => $b['guest_checked_out_at']]));
        }
        $now = date('Y-m-d H:i:s');
        db()->prepare('UPDATE bookings SET guest_checked_out_at = COALESCE(guest_checked_out_at, ?) WHERE id = ?')
            ->execute([$now, $bid]);
        // Re-read: with two devices racing, COALESCE means the stored value may
        // not be ours — the time TOLD must be the time KEPT.
        $s2 = db()->prepare('SELECT guest_checked_out_at FROM bookings WHERE id = ?');
        $s2->execute([$bid]);
        $at = (string) $s2->fetchColumn();

        // The tell — best-effort, never blocks the record.
        try {
            require_once __DIR__ . '/webpush.php';
            $prop = prop_display((string) $b['prop_key'])['name'];
            $who = trim((string) ($b['name'] ?? '')) !== '' ? $b['name'] : 'Your guest';
            $tapT = strtotime($at);
            $when = $tapT ? strtolower(date((int) date('i', $tapT) === 0 ? 'ga' : 'g:ia', $tapT)) : '';
            // Headroom before the checkout hour, only when there genuinely is
            // some — a late tap just states its time.
            $outMins = 0;
            $parts = explode(':', (string) ($b['check_out_time'] ?: '10:00'));
            $outMins = ((int) ($parts[0] ?? 10)) * 60 + ((int) ($parts[1] ?? 0));
            $tapMins = $tapT ? ((int) date('G', $tapT)) * 60 + (int) date('i', $tapT) : 0;
            $head = $outMins - $tapMins;
            $body = $who . ' tapped "we\'ve left" at ' . $when .
                ($head > 0 ? ' — ' . $head . ' minute' . ($head === 1 ? '' : 's') . ' before checkout.' : '.') .
                ' The changeover can start.';
            alert_owner($prop . ' is yours again', $body, [
                'url' => './?open=booking-' . $bid,
                'category' => 'checkout',
                'tag' => 'checkout-' . $bid,
                'email' => true,
            ]);
            log_activity('booking', 'guest.checkout', $who . ' tapped "we\'ve left" — ' . $prop, [
                'actor' => 'guest', 'entity' => 'booking', 'entity_id' => (string) $bid,
            ]);
        } catch (\Throwable $e) {
        }
        json_out(op_finish($opTok, ['ok' => true, 'at' => $at]));
    },
]);
