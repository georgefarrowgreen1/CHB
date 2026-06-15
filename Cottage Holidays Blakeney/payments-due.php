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

json_out(['ok' => true, 'window_days' => $days, 'found' => count($due), 'requested' => $sent, 'skipped' => $skipped, 'detail' => $report]);
