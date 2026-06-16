<?php
// ============================================================
//  owner-digest.php — a Monday-morning summary email to the owner: the week
//  just gone, the week ahead, money in and money owed, pending enquiries and
//  near-term occupancy. One glance at how things stand.
//
//  Add it to the SAME daily cron as the others — it only actually sends on a
//  Monday, and at most once per day, so a daily trigger is safe:
//    https://YOURDOMAIN/owner-digest.php?cron=APP_SECRET
//
//  A logged-in admin can preview/force a send any day with ?force=1.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string)$_GET['cron']);
if (!$isCron && empty($_SESSION['admin_id'])) json_out(['error' => 'Not authorised'], 401);

$force = !empty($_GET['force']);

// Only send on Mondays (date('N')===1), unless forced.
if (!$force && (int)date('N') !== 1) {
    json_out(['ok' => true, 'sent' => false, 'reason' => 'not Monday']);
}
// At most once per calendar day (idempotent across multiple cron pings / deploys).
$today = date('Y-m-d');
if (!$force && content_value('owner-digest-last') === $today) {
    json_out(['ok' => true, 'sent' => false, 'reason' => 'already sent today']);
}

if (!defined('OWNER_NOTIFY_EMAIL') || !OWNER_NOTIFY_EMAIL) {
    json_out(['ok' => false, 'error' => 'OWNER_NOTIFY_EMAIL is not set in config.php']);
}

$money = fn($n) => '£' . number_format((float)$n, 2);
$totalExpr = 'COALESCE(price_override, agreed_total, 0)';

// ---- The week just gone -------------------------------------------------
$newBookings = 0; $newValue = 0.0;
try {
    $r = db()->query("SELECT COUNT(*) c, COALESCE(SUM($totalExpr),0) v FROM bookings
                      WHERE created_at >= (NOW() - INTERVAL 7 DAY)")->fetch();
    $newBookings = (int)($r['c'] ?? 0); $newValue = (float)($r['v'] ?? 0);
} catch (\Throwable $e) {}

$received = 0.0;
try {
    $r = db()->query("SELECT COALESCE(SUM(deposit_paid),0) v FROM bookings
                      WHERE payment_date >= (CURDATE() - INTERVAL 7 DAY)")->fetch();
    $received = (float)($r['v'] ?? 0);
} catch (\Throwable $e) {}

// ---- The week ahead: arrivals -------------------------------------------
$arrivals = [];
try {
    $s = db()->query("SELECT name, prop_key, check_in, check_out FROM bookings
                      WHERE check_in >= CURDATE() AND check_in <= (CURDATE() + INTERVAL 7 DAY)
                      ORDER BY check_in ASC");
    $arrivals = $s->fetchAll();
} catch (\Throwable $e) {}

// ---- Money owed: future, not fully paid ---------------------------------
$owedCount = 0; $owedSum = 0.0;
try {
    $s = db()->query("SELECT $totalExpr AS total, deposit_paid FROM bookings
                      WHERE payment <> 'paid' AND check_in >= CURDATE()");
    foreach ($s->fetchAll() as $b) {
        $out = round((float)$b['total'] - (float)$b['deposit_paid'], 2);
        if ($out > 0.009) { $owedCount++; $owedSum += $out; }
    }
} catch (\Throwable $e) {}

// ---- Pending enquiries --------------------------------------------------
$pending = 0;
try { $pending = (int)db()->query("SELECT COUNT(*) FROM enquiries")->fetchColumn(); } catch (\Throwable $e) {}

// ---- Occupancy over the next 30 days ------------------------------------
$occPct = null;
try {
    $cottages = (int)db()->query("SELECT COUNT(*) FROM properties")->fetchColumn();
    if ($cottages < 1) $cottages = 3;
    // Count booked nights in [today, today+30) across all cottages.
    $s = db()->query("SELECT check_in, check_out FROM bookings
                      WHERE check_out > CURDATE() AND check_in < (CURDATE() + INTERVAL 30 DAY)");
    $start = strtotime($today);
    $end = strtotime('+30 day', $start);
    $bookedNights = 0;
    foreach ($s->fetchAll() as $b) {
        $ci = max($start, strtotime($b['check_in']));
        $co = min($end, strtotime($b['check_out']));
        if ($co > $ci) $bookedNights += (int)round(($co - $ci) / 86400);
    }
    $capacity = $cottages * 30;
    if ($capacity > 0) $occPct = round($bookedNights / $capacity * 100);
} catch (\Throwable $e) {}

// ---- Compose ------------------------------------------------------------
$names = ['21a' => '21A Westgate', 'jollyboat' => 'Jollyboat', 'pimpernel' => 'Pimpernel'];
$nameOf = fn($k) => $names[$k] ?? $k;
$pretty = fn($d) => date('D j M', strtotime($d));

$subject = 'Your Blakeney week: ' . $newBookings . ' new booking' . ($newBookings === 1 ? '' : 's')
         . ', ' . $money($received) . ' in';

$arrivalsTxt = $arrivals
    ? implode("\n", array_map(fn($a) => '  • ' . $pretty($a['check_in']) . ' — ' . $a['name'] . ' (' . $nameOf($a['prop_key']) . ')', $arrivals))
    : '  • No arrivals in the next 7 days.';

$text = "Good morning,\n\n"
      . "Here's how Cottage Holidays Blakeney is looking.\n\n"
      . "THE WEEK JUST GONE\n"
      . "  • New bookings: {$newBookings} (" . $money($newValue) . " of stays)\n"
      . "  • Money received: " . $money($received) . "\n\n"
      . "THE WEEK AHEAD — arrivals\n{$arrivalsTxt}\n\n"
      . "TO KEEP AN EYE ON\n"
      . "  • Balances owed: {$owedCount} booking" . ($owedCount === 1 ? '' : 's') . " (" . $money($owedSum) . ")\n"
      . "  • Pending enquiries: {$pending}\n"
      . ($occPct !== null ? "  • Occupancy (next 30 days): {$occPct}%\n" : "")
      . "\nHave a good week,\nyour website";

$row = fn($label, $val) => '<tr><td style="padding:7px 0;font-size:14px;color:#555;">' . htmlspecialchars($label) . '</td>'
    . '<td style="padding:7px 0;font-size:14px;color:#222;font-weight:700;text-align:right;">' . htmlspecialchars($val) . '</td></tr>';
$arrivalsHtml = $arrivals
    ? implode('', array_map(fn($a) => '<li style="margin:4px 0;font-size:14px;color:#333;">' . htmlspecialchars($pretty($a['check_in'])) . ' — <strong>' . htmlspecialchars($a['name']) . '</strong> · ' . htmlspecialchars($nameOf($a['prop_key'])) . '</li>', $arrivals))
    : '<li style="margin:4px 0;font-size:14px;color:#999;">No arrivals in the next 7 days.</li>';

$html = '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f6;">'
  . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:24px 0;"><tr><td align="center">'
  . '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">'
  . email_crown_header('#ffffff')
  . '<tr><td style="padding:24px 30px 6px;">'
  . '<h2 style="font-size:18px;color:#222;margin:0 0 2px;">Your week at a glance</h2>'
  . '<p style="font-size:13px;color:#888;margin:0 0 14px;">' . htmlspecialchars(date('l j F Y')) . '</p>'
  . '<h3 style="font-size:13px;letter-spacing:.5px;text-transform:uppercase;color:#aaa;margin:14px 0 2px;">The week just gone</h3>'
  . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
  . $row('New bookings', $newBookings . ' (' . $money($newValue) . ')')
  . $row('Money received', $money($received))
  . '</table>'
  . '<h3 style="font-size:13px;letter-spacing:.5px;text-transform:uppercase;color:#aaa;margin:18px 0 2px;">The week ahead — arrivals</h3>'
  . '<ul style="margin:6px 0 0;padding-left:18px;">' . $arrivalsHtml . '</ul>'
  . '<h3 style="font-size:13px;letter-spacing:.5px;text-transform:uppercase;color:#aaa;margin:18px 0 2px;">To keep an eye on</h3>'
  . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
  . $row('Balances owed', $owedCount . ' (' . $money($owedSum) . ')')
  . $row('Pending enquiries', (string)$pending)
  . ($occPct !== null ? $row('Occupancy (next 30 days)', $occPct . '%') : '')
  . '</table>'
  . '<p style="font-size:13px;color:#777;margin:22px 0 6px;">Have a good week.</p>'
  . '</td></tr></table></td></tr></table></body></html>';

$res = smtp_send(OWNER_NOTIFY_EMAIL, 'Owner', $subject, $text, $html);

if (!empty($res['ok']) || ($res === true)) {
    // Record the send so we don't repeat today (store as JSON so content_value reads it back).
    try {
        db()->prepare('INSERT INTO content (item_key, item_value) VALUES (?, ?)
                       ON DUPLICATE KEY UPDATE item_value = VALUES(item_value), updated_at = CURRENT_TIMESTAMP')
            ->execute(['owner-digest-last', json_encode($today)]);
    } catch (\Throwable $e) {}
}

json_out(['ok' => true, 'sent' => true, 'new_bookings' => $newBookings, 'received' => $received,
          'arrivals' => count($arrivals), 'owed' => $owedCount, 'pending' => $pending, 'occupancy_pct' => $occPct,
          'mail' => $res]);
