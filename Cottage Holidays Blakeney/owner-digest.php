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
// Names + accents come from the cottage rows, so any owner-added cottage is labelled correctly.
$nameOf   = fn($k) => prop_display($k)['name'];
$accentOf = fn($k) => prop_display($k)['accent'];
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

$sectionLabel = fn($t) => '<div style="font-family:' . email_sans() . ';font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#8a8f9e;margin:22px 0 2px;">' . htmlspecialchars($t) . '</div>';
$arrivalsHtml = $arrivals
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">' . implode('', array_map(fn($a) =>
        '<tr><td style="padding:7px 0;border-bottom:1px solid #2c2f38;font-family:' . email_sans() . ';font-size:14px;color:#d7dae3;">'
        . '<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:' . $accentOf($a['prop_key']) . ';margin-right:9px;"></span>'
        . htmlspecialchars($pretty($a['check_in'])) . ' — <strong style="color:#f4f5f7;">' . htmlspecialchars($a['name']) . '</strong> · ' . htmlspecialchars($nameOf($a['prop_key'])) . '</td></tr>', $arrivals)) . '</table>'
    : email_p('No arrivals in the next 7 days.', true);

$inner = email_h('Your week at a glance', '#D6A785')
  . email_p(htmlspecialchars(date('l j F Y')), true)
  . $sectionLabel('The week just gone')
  . email_rows([
      ['New bookings', $newBookings . ' <span style="color:#a7acbb;">(' . $money($newValue) . ')</span>'],
      ['Money received', $money($received)],
  ])
  . $sectionLabel('The week ahead — arrivals')
  . $arrivalsHtml
  . $sectionLabel('To keep an eye on')
  . email_rows(array_filter([
      ['Balances owed', $owedCount . ' <span style="color:#a7acbb;">(' . $money($owedSum) . ')</span>'],
      ['Pending enquiries', (string)$pending],
      $occPct !== null ? ['Occupancy (next 30 days)', $occPct . '%'] : null,
  ]))
  . email_p('Have a good week.', true);
$html = email_shell('Your Blakeney week at a glance', $inner, '#D6A785');

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
