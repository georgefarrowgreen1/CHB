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

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string)$_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) json_out(['error' => 'Not authorised'], 401);

if (!square_enabled()) json_out(['ok' => true, 'skipped' => 'Square payments are off']);

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
           AND check_in <= (CURDATE() + INTERVAL ? DAY)"
    );
    $stmt->execute([$days]);
    $due = $stmt->fetchAll();
} catch (\Throwable $e) {
    json_out(['error' => 'Could not read bookings — has migrate.php been run? (' . $e->getMessage() . ')'], 500);
}

$sent = 0; $skipped = 0; $report = [];
foreach ($due as $b) {
    // 'balance' asks for everything still outstanding (covers guests who never
    // paid the deposit too — they simply get asked for the full amount).
    $res = request_booking_payment($b, 'balance');
    if (!empty($res['ok'])) {
        try { db()->prepare('UPDATE bookings SET balance_requested_at = NOW() WHERE id = ?')->execute([(int)$b['id']]); } catch (\Throwable $e) {}
        try { notify_guest_email($b['email'], 'Balance due', 'Your stay is coming up — tap to pay your balance' . (isset($res['amount']) ? ' of £' . number_format((float)$res['amount'], 2) : '') . '.', './'); } catch (\Throwable $e) {}
        $sent++;
        $report[] = ['id' => (int)$b['id'], 'status' => 'requested', 'amount' => $res['amount'] ?? null];
    } else {
        // Nothing due (already settled) — mark it so we don't retry every night.
        if (($res['error'] ?? '') === 'Nothing left to pay.') {
            try { db()->prepare('UPDATE bookings SET balance_requested_at = NOW() WHERE id = ?')->execute([(int)$b['id']]); } catch (\Throwable $e) {}
        }
        $skipped++;
        $report[] = ['id' => (int)$b['id'], 'status' => 'skipped', 'reason' => $res['error'] ?? 'unknown'];
    }
}

// ---- Reminder pass --------------------------------------------------------
// Chase still-unpaid balances we've already requested, while arrival is between
// STOP and FROM days away, at most once every ~3 days, then stop before arrival.
$fromDays = (defined('PAYMENT_REMINDER_FROM_DAYS') && (int)PAYMENT_REMINDER_FROM_DAYS > 0) ? (int)PAYMENT_REMINDER_FROM_DAYS : 14;
$stopDays = (defined('PAYMENT_REMINDER_STOP_DAYS') && (int)PAYMENT_REMINDER_STOP_DAYS >= 0) ? (int)PAYMENT_REMINDER_STOP_DAYS : 3;
$reminded = 0; $remReport = [];
try {
    $rs = db()->prepare(
        "SELECT * FROM bookings
         WHERE payment <> 'paid'
           AND email IS NOT NULL AND email <> ''
           AND balance_requested_at IS NOT NULL
           AND check_in >= (CURDATE() + INTERVAL ? DAY)
           AND check_in <= (CURDATE() + INTERVAL ? DAY)
           AND (balance_reminded_at IS NULL OR balance_reminded_at < (NOW() - INTERVAL 3 DAY))"
    );
    $rs->execute([$stopDays, $fromDays]);
    $toRemind = $rs->fetchAll();
} catch (\Throwable $e) { $toRemind = []; }

foreach ($toRemind as $b) {
    $res = request_booking_payment($b, 'balance', true);   // reminder = true
    if (!empty($res['ok'])) {
        try { db()->prepare('UPDATE bookings SET balance_reminded_at = NOW() WHERE id = ?')->execute([(int)$b['id']]); } catch (\Throwable $e) {}
        try { notify_guest_email($b['email'], 'Balance reminder', 'A friendly reminder to pay your remaining balance before your stay.', './'); } catch (\Throwable $e) {}
        $reminded++;
        $remReport[] = ['id' => (int)$b['id'], 'status' => 'reminded', 'amount' => $res['amount'] ?? null];
    } elseif (($res['error'] ?? '') === 'Nothing left to pay.') {
        // Settled since the request — stop reminding.
        try { db()->prepare('UPDATE bookings SET balance_reminded_at = NOW() WHERE id = ?')->execute([(int)$b['id']]); } catch (\Throwable $e) {}
    }
}

// ---- Abandoned-deposit recovery -------------------------------------------
// A deposit was requested on approval (check-in far off) but never paid. A few
// days later, send ONE gentle nudge with a fresh pay link. We only touch bookings
// OUTSIDE the balance window (check-in further away than $days), so this never
// overlaps the balance request/reminder passes above. Tracked by
// deposit_reminded_at so each booking is recovered at most once.
$recoverDays = (defined('PAYMENT_RECOVERY_DAYS') && (int)PAYMENT_RECOVERY_DAYS > 0) ? (int)PAYMENT_RECOVERY_DAYS : 3;
$recovered = 0; $recReport = [];
try {
    $rc = db()->prepare(
        "SELECT * FROM bookings
         WHERE payment = 'unpaid'
           AND email IS NOT NULL AND email <> ''
           AND deposit_requested_at IS NOT NULL
           AND deposit_reminded_at IS NULL
           AND deposit_requested_at <= (NOW() - INTERVAL ? DAY)
           AND check_in > (CURDATE() + INTERVAL ? DAY)"
    );
    $rc->execute([$recoverDays, $days]);
    $toRecover = $rc->fetchAll();
} catch (\Throwable $e) { $toRecover = []; }   // columns not migrated yet

foreach ($toRecover as $b) {
    $res = request_booking_payment($b, 'deposit', true);   // reminder = true
    if (!empty($res['ok'])) {
        try { db()->prepare('UPDATE bookings SET deposit_reminded_at = NOW() WHERE id = ?')->execute([(int)$b['id']]); } catch (\Throwable $e) {}
        $recovered++;
        $recReport[] = ['id' => (int)$b['id'], 'status' => 'recovered', 'amount' => $res['amount'] ?? null];
    } elseif (($res['error'] ?? '') === 'Nothing left to pay.') {
        // Paid since (status not yet flipped, or edge case) — stop chasing.
        try { db()->prepare('UPDATE bookings SET deposit_reminded_at = NOW() WHERE id = ?')->execute([(int)$b['id']]); } catch (\Throwable $e) {}
    }
}

json_out([
    'ok' => true, 'window_days' => $days,
    'found' => count($due), 'requested' => $sent, 'skipped' => $skipped,
    'reminders_sent' => $reminded, 'reminder_window' => [$stopDays, $fromDays],
    'deposits_recovered' => $recovered, 'recovery_after_days' => $recoverDays,
    'detail' => $report, 'reminders' => $remReport, 'recovery' => $recReport,
]);
