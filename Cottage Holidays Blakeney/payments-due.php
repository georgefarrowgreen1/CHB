<?php
// ============================================================
//  payments-due.php — scheduled balance chaser (Square).
//  When a booking's check-in is within the balance window (default 30 days)
//  and it isn't fully paid, automatically email the guest a secure link to
//  pay the remaining balance — once per booking (tracked by balance_requested_at).
//
//  Auth (same as push.php / migrate.php): a logged-in admin, OR a cron secret.
//  Set up a DAILY cron job at:
//    https://YOURDOMAIN/payments-due.php?cron=APP_SECRET
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php';
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/webpush.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) {
    json_out(['error' => 'Not authorised'], 401);
}

if (!square_enabled()) {
    json_out(['ok' => true, 'skipped' => 'Square payments are off']);
}

$days = payment_balance_days();

// Upcoming, not-fully-paid bookings with a guest email that we haven't already
// chased, whose check-in falls inside the window. (Past stays are ignored.)
try {
    $stmt = db()->prepare(
        "SELECT * FROM bookings
         WHERE balance_requested_at IS NULL
           AND payment <> 'paid'
           AND email IS NOT NULL AND email <> ''
           AND check_in >= CURDATE()
           AND check_in <= (CURDATE() + INTERVAL ? DAY)",
    );
    $stmt->execute([$days]);
    $due = $stmt->fetchAll();
} catch (\Throwable $e) {
    json_out(['error' => 'Could not read bookings — has migrate.php been run? (' . $e->getMessage() . ')'], 500);
}

$sent = 0;
$skipped = 0;
$report = [];
foreach ($due as $b) {
    // Claim the send BEFORE emailing: for a money-chaser a duplicate email is
    // worse than a day's delay, and stamping first means a crash mid-send can
    // never re-ask tomorrow. A CLEAN send failure un-stamps below so it IS
    // retried next run; only an ambiguous post-payload failure (the server may
    // have delivered it) keeps the claim.
    try {
        db()
            ->prepare('UPDATE bookings SET balance_requested_at = NOW() WHERE id = ?')
            ->execute([(int) $b['id']]);
    } catch (\Throwable $e) {
    }
    // 'balance' asks for everything still outstanding (covers guests who never
    // paid the deposit too — they simply get asked for the full amount).
    $res = request_booking_payment($b, 'balance');
    if (empty($res['ok']) && strpos($res['error'] ?? '', 'Message not accepted') !== 0 && ($res['error'] ?? '') !== 'Nothing left to pay.') {
        try {
            db()
                ->prepare('UPDATE bookings SET balance_requested_at = NULL WHERE id = ?')
                ->execute([(int) $b['id']]);
        } catch (\Throwable $e) {
        }
    }
    if (!empty($res['ok'])) {
        try {
            notify_guest_email(
                $b['email'],
                'Balance due',
                'Your stay is coming up — tap to pay your balance' .
                    (isset($res['amount']) ? ' of £' . number_format((float) $res['amount'], 2) : '') .
                    '.',
                './',
            );
        } catch (\Throwable $e) {
        }
        // Optional SMS nudge (no-op unless configured + the guest opted in).
        try {
            require_once __DIR__ . '/sms.php';
            sms_notify_booking(
                $b,
                'Cottage Holidays Blakeney: the balance' .
                    (isset($res['amount']) ? ' of £' . number_format((float) $res['amount'], 2) : '') .
                    ' for your ' .
                    uk_date($b['check_in']) .
                    ' stay is now due — please check your email for the secure payment link.',
            );
        } catch (\Throwable $e) {
        }
        $sent++;
        // 'payment.request' is picked up by the per-booking email log.
        log_activity('payment', 'payment.request', 'Balance requested — £' . number_format((float) ($res['amount'] ?? 0), 2) . ($b['name'] ? ' · ' . $b['name'] : ''), [
            'actor' => 'cron',
            'prop_key' => $b['prop_key'] ?? '',
            'entity' => 'booking',
            'entity_id' => (string) $b['id'],
        ]);
        $report[] = ['id' => (int) $b['id'], 'status' => 'requested', 'amount' => $res['amount'] ?? null];
    } else {
        // Already stamped above. 'Nothing left to pay.' (settled since) keeps the
        // stamp so we don't re-check every night; other failures were un-stamped.
        $skipped++;
        $report[] = ['id' => (int) $b['id'], 'status' => 'skipped', 'reason' => $res['error'] ?? 'unknown'];
    }
}

// ---- Reminder pass --------------------------------------------------------
// Chase still-unpaid balances we've already requested, while arrival is between
// STOP and FROM days away, at most once every ~3 days, then stop before arrival.
$fromDays =
    defined('PAYMENT_REMINDER_FROM_DAYS') && (int) PAYMENT_REMINDER_FROM_DAYS > 0
        ? (int) PAYMENT_REMINDER_FROM_DAYS
        : 14;
$stopDays =
    defined('PAYMENT_REMINDER_STOP_DAYS') && (int) PAYMENT_REMINDER_STOP_DAYS >= 0
        ? (int) PAYMENT_REMINDER_STOP_DAYS
        : 3;
$reminded = 0;
$remReport = [];
try {
    $rs = db()->prepare(
        "SELECT * FROM bookings
         WHERE payment <> 'paid'
           AND email IS NOT NULL AND email <> ''
           AND balance_requested_at IS NOT NULL
           AND balance_requested_at < CURDATE()
           AND check_in >= (CURDATE() + INTERVAL ? DAY)
           AND check_in <= (CURDATE() + INTERVAL ? DAY)
           AND (balance_reminded_at IS NULL OR balance_reminded_at < (NOW() - INTERVAL 3 DAY))",
    );
    $rs->execute([$stopDays, $fromDays]);
    $toRemind = $rs->fetchAll();
} catch (\Throwable $e) {
    $toRemind = [];
}

foreach ($toRemind as $b) {
    // Stamp-before-send, same reasoning as the request pass above: a duplicate
    // reminder is worse than one skipped 3-day cycle. Clean failures un-stamp.
    try {
        db()
            ->prepare('UPDATE bookings SET balance_reminded_at = NOW() WHERE id = ?')
            ->execute([(int) $b['id']]);
    } catch (\Throwable $e) {
    }
    $res = request_booking_payment($b, 'balance', true); // reminder = true
    if (empty($res['ok']) && strpos($res['error'] ?? '', 'Message not accepted') !== 0 && ($res['error'] ?? '') !== 'Nothing left to pay.') {
        try {
            db()
                ->prepare('UPDATE bookings SET balance_reminded_at = NULL WHERE id = ?')
                ->execute([(int) $b['id']]);
        } catch (\Throwable $e) {
        }
    }
    if (!empty($res['ok'])) {
        try {
            notify_guest_email(
                $b['email'],
                'Balance reminder',
                'A friendly reminder to pay your remaining balance before your stay.',
                './',
            );
        } catch (\Throwable $e) {
        }
        $reminded++;
        log_activity('payment', 'payment.request', 'Balance reminder emailed — £' . number_format((float) ($res['amount'] ?? 0), 2) . ($b['name'] ? ' · ' . $b['name'] : ''), [
            'actor' => 'cron',
            'prop_key' => $b['prop_key'] ?? '',
            'entity' => 'booking',
            'entity_id' => (string) $b['id'],
        ]);
        $remReport[] = ['id' => (int) $b['id'], 'status' => 'reminded', 'amount' => $res['amount'] ?? null];
    }
    // 'Nothing left to pay.' (settled since the request) keeps the stamp — stop reminding.
}

// ---- Abandoned-deposit recovery -------------------------------------------
// A deposit was requested on approval (check-in far off) but never paid. A few
// days later, send ONE gentle nudge with a fresh pay link. We only touch bookings
// OUTSIDE the balance window (check-in further away than $days), so this never
// overlaps the balance request/reminder passes above. Tracked by
// deposit_reminded_at so each booking is recovered at most once.
$recoverDays = defined('PAYMENT_RECOVERY_DAYS') && (int) PAYMENT_RECOVERY_DAYS > 0 ? (int) PAYMENT_RECOVERY_DAYS : 3;
$recovered = 0;
$recReport = [];
try {
    $rc = db()->prepare(
        "SELECT * FROM bookings
         WHERE payment = 'unpaid'
           AND email IS NOT NULL AND email <> ''
           AND deposit_requested_at IS NOT NULL
           AND deposit_reminded_at IS NULL
           AND deposit_requested_at <= (NOW() - INTERVAL ? DAY)
           AND check_in > (CURDATE() + INTERVAL ? DAY)",
    );
    $rc->execute([$recoverDays, $days]);
    $toRecover = $rc->fetchAll();
} catch (\Throwable $e) {
    $toRecover = [];
} // columns not migrated yet

foreach ($toRecover as $b) {
    // Stamp-before-send (same reasoning as the passes above: a duplicate
    // money-chaser is worse than a missed cycle). Clean failures un-stamp.
    try {
        db()
            ->prepare('UPDATE bookings SET deposit_reminded_at = NOW() WHERE id = ?')
            ->execute([(int) $b['id']]);
    } catch (\Throwable $e) {
    }
    $res = request_booking_payment($b, 'deposit', true); // reminder = true
    if (empty($res['ok']) && strpos($res['error'] ?? '', 'Message not accepted') !== 0 && ($res['error'] ?? '') !== 'Nothing left to pay.') {
        try {
            db()
                ->prepare('UPDATE bookings SET deposit_reminded_at = NULL WHERE id = ?')
                ->execute([(int) $b['id']]);
        } catch (\Throwable $e) {
        }
    }
    if (!empty($res['ok'])) {
        $recovered++;
        log_activity('payment', 'payment.request', 'Deposit chased — £' . number_format((float) ($res['amount'] ?? 0), 2) . ($b['name'] ? ' · ' . $b['name'] : ''), [
            'actor' => 'cron',
            'prop_key' => $b['prop_key'] ?? '',
            'entity' => 'booking',
            'entity_id' => (string) $b['id'],
        ]);
        $recReport[] = ['id' => (int) $b['id'], 'status' => 'recovered', 'amount' => $res['amount'] ?? null];
    }
    // 'Nothing left to pay.' (paid since) keeps the stamp — stop chasing.
}

// Damage-deposit holds that expired before capture: a Square auth lasts ~6 days,
// so an 'authorized' hold older than that is dead — the owner has lost that
// safety net and should know. Log once (severity: action) and mark it expired so
// it isn't re-flagged tomorrow.
$holdsExpired = 0;
try {
    $stale = db()
        ->query(
            "SELECT id, name, prop_key, hold_amount FROM bookings
             WHERE hold_status = 'authorized' AND hold_authorized_at IS NOT NULL
               AND hold_authorized_at < (NOW() - INTERVAL 6 DAY)",
        )
        ->fetchAll();
    foreach ($stale as $h) {
        log_activity(
            'payment',
            'hold.expired',
            'Damage-deposit hold EXPIRED uncaptured — £' .
                number_format((float) ($h['hold_amount'] ?? 0), 2) .
                ($h['name'] ? ' · ' . $h['name'] : ''),
            ['severity' => 'action', 'prop_key' => $h['prop_key'] ?? '', 'entity' => 'booking', 'entity_id' => (string) $h['id']],
        );
        db()
            ->prepare("UPDATE bookings SET hold_status = 'expired' WHERE id = ?")
            ->execute([(int) $h['id']]);
        $holdsExpired++;
    }
} catch (\Throwable $e) {
}

json_out([
    'ok' => true,
    'window_days' => $days,
    'found' => count($due),
    'holds_expired' => $holdsExpired,
    'requested' => $sent,
    'skipped' => $skipped,
    'reminders_sent' => $reminded,
    'reminder_window' => [$stopDays, $fromDays],
    'deposits_recovered' => $recovered,
    'recovery_after_days' => $recoverDays,
    'detail' => $report,
    'reminders' => $remReport,
    'recovery' => $recReport,
]);
