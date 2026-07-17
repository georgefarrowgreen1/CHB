<?php
// End-to-end probe: an owner-composed email for a CONFIRMED booking with an
// agreed snapshot must show the LOCKED figures (£556.20, £135/night), never
// today's rates (£679.80, £165) — exactly the pipeline bookings.php
// email_preview / email_guest now run: booking_price() → build_enquiry_reply_email().
// No db.php on purpose: db() exits with JSON on connection failure, and this
// probe runs without a database. Define the two tiny helpers mailer.php needs
// (guarded so the analyser doesn't see them as redeclaring db.php's).
if (!function_exists('uk_date')) {
    function uk_date($iso)
    {
        $t = strtotime((string) $iso);
        return $t ? date('d/m/Y', $t) : (string) $iso;
    }
}
if (!function_exists('site_base_url')) {
    function site_base_url()
    {
        return 'https://example.test/';
    }
}
if (!function_exists('first_name')) {
    function first_name($full, $fallback = '')
    {
        $full = trim((string) $full);
        if ($full === '') {
            return $fallback;
        }
        $parts = preg_split('/\s+/', $full);
        return isset($parts[0]) && $parts[0] !== '' ? $parts[0] : $fallback;
    }
}
require_once __DIR__ . '/pricing.php';
require_once __DIR__ . '/mailer.php';

$fail = 0;
function chk($name, $cond)
{
    global $fail;
    echo '  ' . ($cond ? "\u{2713}" : "\u{2717}") . " $name\n";
    if (!$cond) { $fail++; }
}

$rateToday = [
    'prop_key' => 'jollyboat', 'couple_rate' => 165, 'extra_adult_rate' => 0, 'child_rate' => 0,
    'booking_fee' => 75, 'transaction_pct' => 3, 'weekend_pct' => 0, 'weekend_days' => '',
];
$b = [
    'name' => 'Richard Berry', 'email' => 'r@example.com', 'prop_key' => 'jollyboat',
    'check_in' => '2026-08-01', 'check_out' => '2026-08-05', 'check_in_time' => '15:00',
    'check_out_time' => '10:00', 'adults' => 2, 'children' => 0,
    'agreed_total' => 556.2, 'agreed_per_night' => 135, 'agreed_nights' => 4,
    'agreed_nightly' => 540, 'agreed_booking_fee' => 75, 'agreed_txn_pct' => 3,
    'agreed_txn_fee' => 16.2, 'price_override' => null,
];

echo "== Booking with an agreed snapshot ==\n";
$price = booking_price($rateToday, $b);
$m = build_enquiry_reply_email(array_merge($b, ['price' => $price]), 'About your stay', 'Hello — a quick note.', 'booking');
$all = $m['html'] . "\n" . $m['text'];
chk('email shows the locked total £556.20', strpos($all, '556.20') !== false);
chk('email shows the locked £135.00/night', strpos($all, '135.00') !== false);
chk("no live-rate total leaks in (£679.80)", strpos($all, '679.80') === false);
chk("no live per-night leaks in (£165.00)", strpos($all, '165.00') === false);
chk('deposit line intact (£75.00 refundable)', strpos($all, '75.00') !== false);
chk('booking context label is "Price", not an estimate', strpos($m['text'], 'Price: ') !== false && strpos($m['text'], 'Estimated price:') === false);

echo "== Old booking with NO snapshot (live fallback) ==\n";
$bOld = array_merge($b, ['agreed_total' => null]);
$mOld = build_enquiry_reply_email(array_merge($bOld, ['price' => booking_price($rateToday, $bOld)]), '', 'Note.', 'booking');
chk('falls back to live rates (679.80)', strpos($mOld['html'] . $mOld['text'], '679.80') !== false);

echo "\n";
exit($fail ? 1 : 0);
