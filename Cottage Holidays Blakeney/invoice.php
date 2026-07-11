<?php
// ============================================================
//  invoice.php — guest-facing HTML invoice for a booking.
//
//  URL:  invoice.php?b=<id>&token=<invoice_token>
//  The token is HMAC(APP_SECRET) over the booking id (db.php invoice_token),
//  so the page needs no login but isn't guessable. Linked from the booking
//  confirmation email; the guest can read it and use their browser's
//  "Print / Save as PDF" for a paper copy. (The owner's Invoice button still
//  generates a jsPDF download in the back office — this is the guest path.)
//
//  render_invoice_html() is a PURE function (no DB) so it can be unit-tested;
//  the bootstrap below only runs when this file IS the request.
// ============================================================

// Build the full invoice page from a plain data array. $d keys:
//   ref, guest_name, guest_email, issued, prop_name, address,
//   check_in, check_out, check_in_time, check_out_time, nights, party,
//   per_night, nightly, tx_pct, tx_fee, damages, total, grand_total,
//   paid, balance, accent
function render_invoice_html($d)
{
    $e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $accent = preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($d['accent'] ?? '')) ? $d['accent'] : '#8FB3C7';
    $damages = (float) ($d['damages'] ?? 0);
    $paid = (float) ($d['paid'] ?? 0);
    $balance = (float) ($d['balance'] ?? 0);

    $row = fn($l, $v, $bold = false) =>
        '<tr><td style="padding:9px 0;color:#57524A;' . ($bold ? 'font-weight:700;' : '') . '">' . $e($l) .
        '</td><td align="right" style="padding:9px 0;color:#2b2b2b;' . ($bold ? 'font-weight:700;' : '') . '">' . $v . '</td></tr>';

    $priceRows =
        $row($e($money($d['per_night'] ?? 0)) . ' × ' . (int) ($d['nights'] ?? 0) . ' night' . ((int) ($d['nights'] ?? 0) === 1 ? '' : 's'), $money($d['nightly'] ?? 0)) .
        $row('Transaction fee (' . $e($d['tx_pct'] ?? 0) . '%)', $money($d['tx_fee'] ?? 0)) .
        ($damages > 0 ? $row('Refundable damages deposit', $money($damages)) : '') .
        '<tr><td colspan="2" style="border-top:1px solid #e6ddca;font-size:0;line-height:0;padding:0;">&nbsp;</td></tr>' .
        $row('Total', $money($d['grand_total'] ?? 0), true) .
        ($paid > 0 ? $row('Paid', '− ' . $money($paid)) : '') .
        ($balance > 0.001 ? $row('Balance due', $money($balance), true) : ($paid > 0 ? $row('Balance', 'Paid in full', true) : ''));

    $depositNote = $damages > 0
        ? '<p style="font-size:12px;color:#8a8378;margin:14px 0 0;line-height:1.5;">The refundable damages deposit of ' . $e($money($damages)) .
          ' is charged together with your first payment and returned in full after checkout, provided there is no damage.</p>'
        : '';

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' .
        '<meta name="viewport" content="width=device-width, initial-scale=1">' .
        '<meta name="robots" content="noindex">' .
        '<title>Invoice ' . $e($d['ref'] ?? '') . ' — Cottage Holidays Blakeney</title>' .
        '<style>' .
        '*{box-sizing:border-box}' .
        'body{margin:0;background:#f5f1e9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1b2a34;padding:24px 16px;}' .
        '.sheet{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.08);}' .
        '.top{padding:26px 32px 6px;border-top:5px solid ' . $accent . ';text-align:center;}' .
        '.crown{display:block;margin:0 auto 10px;width:64px;height:auto;}' .
        '.brand{font-family:Georgia,\'Times New Roman\',serif;font-size:24px;font-weight:700;letter-spacing:-0.01em;color:#1b2a34;}' .
        '.sub{color:#8a8378;font-size:13px;margin-top:2px;}' .
        '.tag{color:' . $accent . ';font-size:11px;letter-spacing:4px;font-weight:700;margin-top:10px;}' .
        '.body{padding:8px 32px 32px;}' .
        'h2{font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:#8a8378;margin:26px 0 8px;}' .
        'table{width:100%;border-collapse:collapse;font-size:14px;}' .
        '.meta td{padding:6px 0;font-size:14px;} .meta td:first-child{color:#8a8378;} .meta td:last-child{text-align:right;}' .
        '.pricebox{background:#faf6ec;border:1px solid #ece4d3;border-radius:12px;padding:6px 18px;margin-top:6px;}' .
        '.foot{text-align:center;color:#8a8378;font-size:12px;padding:22px 32px 30px;line-height:1.6;}' .
        '.actions{text-align:center;margin:22px 0 4px;}' .
        '.btn{display:inline-block;background:' . $accent . ';color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border:0;border-radius:999px;cursor:pointer;}' .
        '@media print{body{background:#fff;padding:0;} .sheet{box-shadow:none;border-radius:0;max-width:none;} .actions{display:none;}}' .
        '</style></head><body>' .
        '<div class="sheet">' .
        '<div class="top"><img class="crown" src="logo.svg" alt="" width="64" height="38"><div class="brand">Cottage Holidays Blakeney</div><div class="sub">North Norfolk Coastal Retreats</div><div class="tag">INVOICE</div></div>' .
        '<div class="body">' .
        '<table class="meta">' .
        '<tr><td>Invoice reference</td><td>' . $e($d['ref'] ?? '') . '</td></tr>' .
        '<tr><td>Issued</td><td>' . $e($d['issued'] ?? '') . '</td></tr>' .
        '<tr><td>Guest</td><td>' . $e($d['guest_name'] ?? '') . '</td></tr>' .
        (!empty($d['guest_email']) ? '<tr><td>Email</td><td>' . $e($d['guest_email']) . '</td></tr>' : '') .
        '</table>' .
        '<h2>Your stay</h2>' .
        '<table class="meta">' .
        '<tr><td>Property</td><td>' . $e($d['prop_name'] ?? '') . '</td></tr>' .
        (!empty($d['address']) ? '<tr><td>Address</td><td>' . $e($d['address']) . '</td></tr>' : '') .
        '<tr><td>Check in</td><td>' . $e($d['check_in'] ?? '') . ' · ' . $e($d['check_in_time'] ?? '15:00') . '</td></tr>' .
        '<tr><td>Check out</td><td>' . $e($d['check_out'] ?? '') . ' · ' . $e($d['check_out_time'] ?? '10:00') . '</td></tr>' .
        '<tr><td>Guests</td><td>' . $e($d['party'] ?? '') . '</td></tr>' .
        '</table>' .
        '<h2>Charges</h2>' .
        '<div class="pricebox"><table>' . $priceRows . '</table></div>' .
        $depositNote .
        '<div class="actions"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>' .
        '</div>' .
        '<div class="foot">Cottage Holidays Blakeney · Any questions? Just reply to your confirmation email.<br>This invoice was generated for booking ' . $e($d['ref'] ?? '') . '.</div>' .
        '</div></body></html>';
}

// ---- Bootstrap: only when this file IS the request (not when unit-tested) ----
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'invoice.php') {
    return;
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php';

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex');

$id = (int) ($_GET['b'] ?? 0);
$token = (string) ($_GET['token'] ?? '');
if ($id <= 0 || !hash_equals(invoice_token($id), $token)) {
    http_response_code(403);
    echo '<!doctype html><meta charset="utf-8"><title>Invoice</title><p style="font-family:sans-serif;padding:40px;">Sorry — this invoice link is invalid.</p>';
    exit();
}

try {
    $s = db()->prepare('SELECT * FROM bookings WHERE id = ?');
    $s->execute([$id]);
    $b = $s->fetch();
} catch (\Throwable $ex) {
    $b = null;
}
if (!$b) {
    http_response_code(404);
    echo '<!doctype html><meta charset="utf-8"><title>Invoice</title><p style="font-family:sans-serif;padding:40px;">Sorry — we couldn’t find that booking.</p>';
    exit();
}

$rate = get_rate($b['prop_key']);

// Prefer the locked agreed figures (frozen at booking time); fall back to a live
// calc — mirrors send_booking_confirmation so the invoice matches the email.
if ($b['agreed_total'] !== null) {
    $nights = (int) $b['agreed_nights'];
    $perNight = (float) $b['agreed_per_night'];
    $nightly = (float) $b['agreed_nightly'];
    $txPct = (float) $b['agreed_txn_pct'];
    $txFee = (float) $b['agreed_txn_fee'];
    $damages = (float) $b['agreed_booking_fee'];
    $total = $b['price_override'] !== null ? (float) $b['price_override'] : (float) $b['agreed_total'];
} elseif ($rate) {
    $p = price_breakdown($rate, (int) $b['adults'], (int) $b['children'], $b['check_in'], $b['check_out']);
    $nights = $p['nights'];
    $perNight = $p['perNight'];
    $nightly = $p['nightly'];
    $txPct = $p['transactionPct'];
    $txFee = $p['txFee'];
    $damages = $p['damagesDeposit'];
    $total = $p['total'];
} else {
    $nights = 0; $perNight = 0; $nightly = 0; $txPct = 0; $txFee = 0; $damages = 0; $total = (float) ($b['agreed_total'] ?? 0);
}

// Mirror the client's displayGrand() (app.js): the refundable damages deposit
// shows in the grand total only until refunded, and counts as PAID only once
// genuinely collected — Square charges it with the first payment
// (hold_status 'charged'; legacy card-holds settle to 'captured'; 'kept' =
// collected and retained after damage). deposit_paid is RENTAL-only, so
// without this the invoice understates Paid / overstates Balance the moment
// the deposit is charged, and re-bills a refunded deposit after checkout.
$holdStatus = (string) ($b['hold_status'] ?? 'none');
if (in_array($holdStatus, ['returned', 'released'], true)) $damages = 0.0;
$depositCharged = in_array($holdStatus, ['charged', 'captured', 'kept'], true);
$grand = round($total + $damages, 2);
$paid = round((float) ($b['deposit_paid'] ?? 0) + ($depositCharged ? $damages : 0), 2);
$balance = max(0, round($grand - $paid, 2));

$disp = prop_display($b['prop_key']);
$adults = (int) $b['adults'];
$children = (int) $b['children'];
$party = $adults . ' adult' . ($adults === 1 ? '' : 's') .
    ($children > 0 ? ', ' . $children . ' child' . ($children === 1 ? '' : 'ren') : '');
$ref = 'CHB-' . str_pad(substr(preg_replace('/\D/', '', (string) $id), -6), 6, '0', STR_PAD_LEFT);

echo render_invoice_html([
    'ref' => $ref,
    'guest_name' => $b['name'],
    'guest_email' => $b['email'],
    'issued' => date('j M Y'),
    'prop_name' => $disp['name'] ?? ($rate['name'] ?? $b['prop_key']),
    'address' => $rate['address'] ?? '',
    'check_in' => uk_date($b['check_in']),
    'check_out' => uk_date($b['check_out']),
    'check_in_time' => $b['check_in_time'] ?? '15:00',
    'check_out_time' => $b['check_out_time'] ?? '10:00',
    'nights' => $nights,
    'party' => $party,
    'per_night' => $perNight,
    'nightly' => $nightly,
    'tx_pct' => $txPct,
    'tx_fee' => $txFee,
    'damages' => $damages,
    'total' => $total,
    'grand_total' => $grand,
    'paid' => $paid,
    'balance' => $balance,
    'accent' => $disp['accent'] ?? '#8FB3C7',
]);
