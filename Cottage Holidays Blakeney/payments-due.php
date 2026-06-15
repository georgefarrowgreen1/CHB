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
        $reminded++;
        $remReport[] = ['id' => (int)$b['id'], 'status' => 'reminded', 'amount' => $res['amount'] ?? null];
    } elseif (($res['error'] ?? '') === 'Nothing left to pay.') {
        // Settled since the request — stop reminding.
        try { db()->prepare('UPDATE bookings SET balance_reminded_at = NOW() WHERE id = ?')->execute([(int)$b['id']]); } catch (\Throwable $e) {}
    }
}

json_out([
    'ok' => true, 'window_days' => $days,
    'found' => count($due), 'requested' => $sent, 'skipped' => $skipped,
    'reminders_sent' => $reminded, 'reminder_window' => [$stopDays, $fromDays],
    'detail' => $report, 'reminders' => $remReport,
]);
