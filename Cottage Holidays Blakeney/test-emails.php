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

echo "== A booking says where its money stands, never the price again ==\n";
$price = booking_price($rateToday, $b);
$m = build_enquiry_reply_email(array_merge($b, ['price' => $price, 'pay_paid' => 214.05, 'pay_due' => 417.15, 'pay_due_by' => '2026-07-02']), 'About your stay', 'A quick note.', 'booking', ['from' => 'George']);
$all = $m['html'] . "\n" . $m['text'];
chk('what is paid so far (£214.05)', strpos($all, '214.05') !== false);
chk('what is still to pay (£417.15), and by when', strpos($all, '417.15') !== false && strpos($m['text'], 'by Thu 2 Jul') !== false);
chk('no total or nightly price restated (556.20 / 135.00)', strpos($all, '556.20') === false && strpos($all, '135.00') === false);
chk("no live-rate total leaks in (£679.80)", strpos($all, '679.80') === false);
chk("no live per-night leaks in (£165.00)", strpos($all, '165.00') === false);
chk('the link back into the booking', strpos($all, 'open=stay') !== false);
chk('signed by the person who wrote it', strpos($m['text'], "George\nCottage Holidays Blakeney") !== false);
chk('the subject is the title', strpos($m['html'], 'About your stay') !== false);
$paidUp = build_enquiry_reply_email(array_merge($b, ['pay_paid' => 631.2, 'pay_due' => 0]), '', 'Note.', 'booking');
chk('paid in full says so', strpos($paidUp['text'], 'Payment: paid in full') !== false && strpos($paidUp['html'], 'Paid in full') !== false);
chk('an empty subject reads "Your stay at <cottage>"', $paidUp['subject'] === 'Your stay at jollyboat' || strpos($paidUp['subject'], 'Your stay at ') === 0);

echo "== The two switches ==\n";
$noStay = build_enquiry_reply_email(array_merge($b, ['pay_paid' => 214.05, 'pay_due' => 417.15]), 'S', 'Note.', 'booking', ['stay' => false]);
chk('stay off: no Arrive / Leave', strpos($noStay['text'], 'Arrive:') === false && strpos($noStay['html'], 'Arrive') === false);
chk('…the payment still there', strpos($noStay['text'], '417.15') !== false);
$noMoney = build_enquiry_reply_email(array_merge($b, ['pay_paid' => 214.05, 'pay_due' => 417.15]), 'S', 'Note.', 'booking', ['money' => false]);
chk('money off: no figures at all', strpos($noMoney['html'] . $noMoney['text'], '417.15') === false && strpos($noMoney['html'] . $noMoney['text'], '214.05') === false);
chk('…the stay still there', strpos($noMoney['text'], 'Arrive:') !== false);
$bare = build_enquiry_reply_email(array_merge($b, ['pay_paid' => 214.05, 'pay_due' => 417.15]), 'S', 'Note.', 'booking', ['stay' => false, 'money' => false]);
chk('both off: just the message', strpos($bare['text'], '---') === false && strpos($bare['html'], 'open=stay') === false);

echo "== An enquiry's quote adds up to itself ==\n";
$q = build_enquiry_reply_email(array_merge($b, ['price' => booking_price($rateToday, $b)]), 'Your dates', 'Note.', 'enquiry');
$qa = $q['html'] . "\n" . $q['text'];
chk('nights at the agreed rate (4 at £135.00 = £540.00)', strpos($q['text'], '4 nights at £135.00: £540.00') !== false);
chk('the fee is its own line (£16.20)', strpos($q['text'], 'Transaction fee (3%): £16.20') !== false);
chk('the total (£556.20)', strpos($q['text'], 'Total: £556.20') !== false);
chk('the refundable deposit (£75.00)', strpos($qa, '75.00') !== false);
$custom = booking_price($rateToday, array_merge($b, ['price_override' => 500]));
$qc = build_enquiry_reply_email(array_merge($b, ['price' => $custom]), 'Your dates', 'Note.', 'enquiry');
chk('a custom price is one agreed line (£500.00)', strpos($qc['text'], 'Agreed price for your stay: £500.00') !== false);
chk('…never "nights at" lines that cannot add up to it', strpos($qc['html'] . $qc['text'], 'nights at') === false);
$bOld = array_merge($b, ['agreed_total' => null]);
$qOld = build_enquiry_reply_email(array_merge($bOld, ['price' => booking_price($rateToday, $bOld)]), '', 'Note.', 'enquiry');
chk('no snapshot: the live quote (679.80)', strpos($qOld['html'] . $qOld['text'], '679.80') !== false);
chk('an empty subject reads "Your enquiry about <cottage>"', strpos($qOld['subject'], 'Your enquiry about ') === 0);

echo "\n";
exit($fail ? 1 : 0);
