<?php
// ════════════════════════════════════════════════════════════════════════════
//  test-invoice.php — the guest's invoice, driven for real. No DB, no clock.
//
//  Why this exists: invoice.php's render_invoice_html() has always been pure and
//  unit-testable and nothing unit-tested it, so three defects shipped on the one
//  document a guest files and may show an insurer:
//    * a KEPT deposit was described as "returned in full after checkout" — the
//      owner's PDF said "Retained after checkout for damage or loss" about the
//      same money, so one booking had two documents making opposite claims;
//    * a REFUNDED deposit was deleted from the page outright, so nothing recorded
//      that £75 had been taken and given back;
//    * every label, heading and note was #8a8378 (3.75:1) and the word INVOICE
//      was the accent as text (2.55:1) — under AA on a document about money.
//  And the only control on it, `onclick="window.print()"`, was blocked by the
//  site's own CSP.
//
//  §1 the deposit sentence, from the shared fixtures (app.js drives the same file)
//  §2 the four states through the REAL composer
//  §3 the money is untouched: display changes must not move a figure
//  §4 contrast by arithmetic on the rendered output
//  §5 the affordances: pay link, print script, CSP hash, print stylesheet
//  §6 the inks are the email design system's, not a second definition
// ════════════════════════════════════════════════════════════════════════════

$fails = 0;
$checks = 0;
function inv_ok(bool $cond, string $label, string $extra = ''): void
{
    global $fails, $checks;
    $checks++;
    if ($cond) {
        echo "  ✓ $label" . ($extra !== '' ? "  · $extra" : '') . "\n";
    } else {
        $fails++;
        echo "  ✗ $label" . ($extra !== '' ? "  — $extra" : '') . "\n";
    }
}

// booking_price_is_custom lives in db.php, which routes and connects; the pure
// composer only needs the decision, so define it exactly as db.php does.
if (!function_exists('booking_price_is_custom')) {
    function booking_price_is_custom($nightly, $txFee, $rentalTotal)
    {
        return abs(((float) $nightly + (float) $txFee) - (float) $rentalTotal) > 0.005;
    }
}
$_SERVER['SCRIPT_NAME'] = 'test-invoice.php'; // keep the bootstrap from running
require __DIR__ . '/invoice.php';

// ════════════════════════════════════ §1 ════════════════════════════════════
echo "\n§1 the deposit's state in words — shared fixtures\n";
$fx = json_decode((string) file_get_contents(__DIR__ . '/invoice-deposit-fixtures.json'), true);
inv_ok(is_array($fx) && count($fx['cases'] ?? []) >= 12, 'fixtures load', count($fx['cases'] ?? []) . ' cases');
foreach ($fx['cases'] as $c) {
    $got = invoice_deposit_status($c['dep'], $c['hold'], $c['returned'], $c['settled']);
    inv_ok($got === $c['want'], $c['why'], $got === $c['want'] ? '“' . $got . '”' : 'got “' . $got . '” want “' . $c['want'] . '”');
}
// The one thing no state may ever do.
foreach (['kept'] as $st) {
    $s = invoice_deposit_status(75, $st, 0, '14/09/2026');
    inv_ok(stripos($s, 'refund') === false && stripos($s, 'returned in full') === false,
        "a $st deposit is never described as refunded", '“' . $s . '”');
}

// ════════════════════════════════════ §2 ════════════════════════════════════
// One booking, four states — the same fixture the mockups used, so the numbers
// here are the numbers that were reviewed.
$base = [
    'ref' => 'CHB-000042', 'guest_name' => 'Sarah Pemberton', 'guest_email' => 'sarah@example.co.uk',
    'issued' => '08/08/2026', 'prop_name' => 'Jollyboat', 'address' => '4 Westgate Street, Blakeney',
    'check_in' => '06/09/2026', 'check_out' => '11/09/2026', 'check_in_time' => '15:00',
    'check_out_time' => '10:00', 'nights' => 5, 'party' => '2 adults, 1 child',
    'per_night' => 135.0, 'nightly' => 675.0, 'tx_pct' => 3, 'tx_fee' => 20.25,
    'total' => 695.25, 'accent' => '#7FA88A', 'phone' => '01263 000000',
];
// hold_status, returned, damages-in-the-total, deposit-as-a-fact, paid, balance
// paid is booking_paid_so_far (RENTAL) + the deposit once charged — the
// bootstrap's own derivation. 'part' has had only the first payment: £248.81 of
// rental, and the card took the £75 deposit with it, so £323.81 is in.
$STATES = [
    'part' => ['hold' => 'charged',  'ret' => 0.0,  'damages' => 75.0, 'dep' => 75.0,
               'rental' => 248.81, 'settledOn' => '', 'rows' => [[248.81, 'Deposit received', true]]],
    'paid' => ['hold' => 'charged',  'ret' => 0.0,  'damages' => 75.0, 'dep' => 75.0,
               'rental' => 695.25, 'settledOn' => '', 'rows' => [[248.81, 'Deposit received', true], [446.44, 'Balance received', true]]],
    'ret'  => ['hold' => 'returned', 'ret' => 75.0, 'damages' => 0.0,  'dep' => 75.0,
               'rental' => 695.25, 'settledOn' => '14/09/2026',
               'rows' => [[248.81, 'Deposit received', true], [446.44, 'Balance received', true], [75.0, 'Refundable deposit returned', false]]],
    'kept' => ['hold' => 'kept',     'ret' => 0.0,  'damages' => 75.0, 'dep' => 75.0,
               'rental' => 695.25, 'settledOn' => '14/09/2026',
               'rows' => [[248.81, 'Deposit received', true], [446.44, 'Balance received', true]]],
];
// Mirrors the bootstrap: the FIRST payment's row is shown at the sum the card
// actually took (rental + the deposit), with the deposit named underneath.
$payload = function (string $key) use ($STATES) {
    $s = $STATES[$key];
    $depositCharged = in_array($s['hold'], ['charged', 'captured', 'kept'], true);
    $depWasTaken = in_array($s['hold'], ['charged', 'captured', 'kept', 'returned'], true);
    $grand = round(695.25 + $s['damages'], 2);
    $paid = round($s['rental'] + ($depositCharged ? $s['damages'] : 0), 2);
    $balance = max(0, round($grand - $paid, 2));
    $rows = [];
    foreach ($s['rows'] as $i => [$amt, $label, $credit]) {
        $carried = $i === 0 && $depWasTaken && $credit;
        $rows[] = [
            'date' => $credit ? '20/07/2026' : '14/09/2026',
            'label' => $label,
            'amount' => $carried ? round($amt + $s['dep'], 2) : $amt,
            'note' => $carried ? 'includes the £' . number_format($s['dep'], 2) . ' refundable deposit' : '',
            'credit' => $credit,
        ];
    }
    return [
        'damages' => $s['damages'],
        'deposit_amount' => $s['dep'],
        'deposit_state' => $s['hold'],
        'deposit_status' => invoice_deposit_status($s['dep'], $s['hold'], $s['ret'], $s['settledOn']),
        'grand_total' => $grand,
        'paid' => $paid,
        'balance' => $balance,
        'balance_due_date' => $balance > 0.001 ? '07/08/2026' : '',
        'payments' => $rows,
        'pay_url' => $balance > 0.001 ? 'index.html?pay=tok&b=42' : '',
    ];
};
$render = fn(string $key, array $over = []) => render_invoice_html(array_merge($base, $payload($key), $over));

echo "\n§2 the four states, through the real composer\n";
$html = [];
foreach (array_keys($STATES) as $k) {
    $html[$k] = $render($k);
    inv_ok(str_starts_with($html[$k], '<!doctype html>') && str_contains($html[$k], '</html>'),
        "$k renders a whole document", strlen($html[$k]) . ' bytes');
}
// the headline defect
inv_ok(str_contains($html['kept'], 'Retained after checkout for damage or loss'),
    'kept: the page says the deposit was retained');
inv_ok(!str_contains($html['kept'], 'returned in full after checkout'),
    'kept: and does NOT promise it back');
// the deposit survives being refunded
inv_ok(str_contains($html['ret'], 'Refundable damages deposit') && str_contains($html['ret'], '£75.00'),
    'refunded: the £75 is still recorded on the document');
inv_ok(str_contains($html['ret'], 'Refunded in full on 14/09/2026'),
    'refunded: dated, not implied');
inv_ok(str_contains($html['ret'], 'Deposit returned'),
    'refunded: and the state is chipped at the top');
inv_ok(str_contains($html['kept'], 'Deposit retained'), 'kept: chipped at the top too');
inv_ok(!str_contains($html['part'], 'Deposit returned') && !str_contains($html['part'], 'Deposit retained'),
    'part paid: no state chip, because nothing has happened yet');
// the hero says which figure it is showing
inv_ok(str_contains($html['part'], 'Balance due') && str_contains($html['part'], '£446.44'),
    'part paid: the balance leads', '£446.44');
inv_ok(str_contains($html['paid'], 'Paid in full') && !str_contains($html['paid'], 'Balance due'),
    'paid: the caption changes with the figure');
// a booking with no deposit must not print a £0.00 deposit line
$noDep = $render('part', ['damages' => 0.0, 'deposit_amount' => 0.0, 'deposit_status' => '']);
inv_ok(!str_contains($noDep, 'Refundable damages deposit'), 'no deposit: no deposit line at all');
// a custom (agreed) price renders as one coherent line
$custom = $render('part', ['total' => 600.0]);
inv_ok(str_contains($custom, 'Agreed price for your stay') && !str_contains($custom, '&times; 5 nights'),
    'a custom price is one line, not a sum that cannot add up');
// escaping at the boundary
$xss = $render('part', ['guest_name' => '<script>alert(1)</script>']);
inv_ok(!str_contains($xss, '<script>alert(1)</script>') && str_contains($xss, '&lt;script&gt;'),
    'the guest name is escaped exactly once');

// ════════════════════════════════════ §3 ════════════════════════════════════
// A REDESIGN MUST NOT MOVE A NUMBER. These are the figures the previous
// composer produced for the same inputs; the arithmetic lives in the bootstrap
// and is unchanged, so any drift here is a display bug reaching the money.
echo "\n§3 the money is untouched\n";
$want = [
    'part' => ['grand' => '£770.25', 'paid' => '£323.81', 'bal' => '£446.44'],
    'paid' => ['grand' => '£770.25', 'paid' => '£770.25', 'bal' => '£0.00'],
    'ret'  => ['grand' => '£695.25', 'paid' => '£695.25', 'bal' => '£0.00'],
    'kept' => ['grand' => '£770.25', 'paid' => '£770.25', 'bal' => '£0.00'],
];
foreach ($want as $k => $w) {
    $h = $html[$k];
    inv_ok(str_contains($h, $w['grand']), "$k: total is {$w['grand']}");
    inv_ok(str_contains($h, $w['bal']), "$k: still to pay is {$w['bal']}");
}
// THE ROWS MUST ADD UP TO THE TOTAL. A guest with a calculator is the check that
// cannot be argued with, and the trap is that payments.amount is RENTAL-only —
// the deposit rides the first payment and is recorded nowhere in that column, so
// listing the rows raw leaves the card £75 short of its own footer.
foreach (array_keys($STATES) as $k) {
    $d = $payload($k);
    $net = 0.0;
    foreach ($d['payments'] as $r) {
        $net += ($r['credit'] ? 1 : -1) * (float) $r['amount'];
    }
    $lhs = round($net + (float) $d['balance'], 2);
    inv_ok(abs($lhs - (float) $d['grand_total']) < 0.005,
        "$k: the payment rows plus what is still to pay equal the total",
        sprintf('%.2f + %.2f = %.2f vs %.2f', $net, $d['balance'], $lhs, $d['grand_total']));
}
// and the carrying row names the deposit rather than quietly differing from the
// guest's bank statement
inv_ok(str_contains($html['part'], 'includes the £75.00 refundable deposit'),
    'the first payment says it carried the deposit');
inv_ok(str_contains($html['part'], '£323.81'), 'and is shown at the sum the card took', '£323.81');
// the refunded state's total DROPS by the deposit, because the money went back —
// that is the arithmetic, and it is what the display fix must not have altered
inv_ok(str_contains($html['ret'], '£695.25') && !str_contains($html['ret'], '£770.25'),
    'refunded: the total is net of the returned deposit');
// the charges must add up to the total in every state that shows a sum
foreach (['part', 'paid', 'kept'] as $k) {
    inv_ok(str_contains($html[$k], '£675.00') && str_contains($html[$k], '£20.25') && str_contains($html[$k], '£75.00'),
        "$k: 675 + 20.25 + 75 are all on the page and total 770.25");
}

// ════════════════════════════════════ §4 ════════════════════════════════════
// CONTRAST BY ARITHMETIC on the rendered output — the same method
// test-emails-render §2 uses, and the reason the retired inks are gone.
echo "\n§4 no ink on this document is illegible\n";
$lum = function (string $hex): float {
    $hex = ltrim($hex, '#');
    $f = function ($v) { $v /= 255; return $v <= 0.03928 ? $v / 12.92 : (($v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * $f(hexdec(substr($hex, 0, 2))) + 0.7152 * $f(hexdec(substr($hex, 2, 2))) + 0.0722 * $f(hexdec(substr($hex, 4, 2)));
};
$ratio = function (string $a, string $b) use ($lum): float {
    $la = $lum($a); $lb = $lum($b);
    return (max($la, $lb) + 0.05) / (min($la, $lb) + 0.05);
};
// the grounds an ink can actually sit on in this document
$GROUNDS = ['white' => '#ffffff', 'tint' => '#faf6ec', 'desk' => '#f5f1e9',
            'due' => '#fbf0da', 'ok' => '#e6f1e9', 'kept' => '#fae9e6'];
$INKS = [
    'body' => [INV_INK, ['white', 'tint', 'desk']],
    'secondary' => [INV_INK_2, ['white']],
    'muted (labels, captions, notes)' => [INV_MUTED, ['white', 'tint', 'desk']],
    'accent as words' => [INV_ACCENT_INK, ['white', 'desk']],
    'a due date' => [INV_WARN_INK, ['due', 'desk']],
    'a retained deposit' => [INV_ALERT_INK, ['kept']],
    'settled / a credit' => [INV_OK_INK, ['white', 'ok', 'desk']],
];
foreach ($INKS as $name => [$hex, $grounds]) {
    $worst = 99.0; $where = '';
    foreach ($grounds as $g) {
        $r = $ratio($hex, $GROUNDS[$g]);
        if ($r < $worst) { $worst = $r; $where = $g; }
    }
    inv_ok($worst >= 4.5, "$name clears AA everywhere it appears",
        sprintf('%s worst %.2f:1 on %s', $hex, $worst, $where));
}
// the accent FILL only ever carries the dark ink — white on it is 2.55:1, which
// is what the old Print button did
foreach (['#C79A64', '#8FB3C7', '#7FA88A'] as $acc) {
    inv_ok($ratio(INV_ON_ACCENT, $acc) >= 4.5, "ink on the $acc fill clears AA",
        sprintf('%.2f:1 (white would be %.2f:1)', $ratio(INV_ON_ACCENT, $acc), $ratio('#ffffff', $acc)));
}
// the retired inks must not come back
foreach (['#8a8378', '#8E877A', '#9A927F', '#A0987F', '#A79E8A'] as $dead) {
    inv_ok(stripos($html['part'], $dead) === false, "the retired ink $dead is not on the page");
}

// ════════════════════════════════════ §5 ════════════════════════════════════
echo "\n§5 the affordances\n";
// THE BALANCE NAMES ITS DEADLINE, in the rendered output rather than in the shape
// of the string that built it (this check moved here from test-payrail, which was
// pattern-matching the old concatenation). Twice on purpose: beside the figure at
// the top, and in the bar that follows you down the page.
inv_ok(substr_count($html['part'], '07/08/2026') >= 2,
    'the due date is on the page beside the figure AND in the pay bar',
    substr_count($html['part'], '07/08/2026') . ' occurrences');
inv_ok(str_contains($html['part'], 'by 07/08/2026') && str_contains($html['part'], 'Due 07/08/2026'),
    '…in both wordings');
inv_ok(!str_contains($html['paid'], '07/08/2026'), 'a settled invoice names no deadline');
inv_ok(str_contains($html['part'], 'href="index.html?pay=tok&amp;b=42"'), 'a balance can be paid from the invoice');
inv_ok(!str_contains($html['paid'], 'index.html?pay='), 'a settled invoice offers no pay link');
$noRail = $render('part', ['pay_url' => '']);
inv_ok(!str_contains($noRail, 'class="btn" href'), 'no pay link when the guest is not on the card rail');
inv_ok(str_contains($noRail, 'id="inv-print"'), '…but Save a copy is still there');
// the print control must not be an inline handler: the CSP forbids those, which
// is why the button this page shipped with did nothing at all
inv_ok(!preg_match('/\son[a-z]+=/i', $html['part']), 'no inline event-handler attribute anywhere', 'CSP would block it');
inv_ok(str_contains($html['part'], '<script>' . INV_PRINT_JS . '</script>'), 'the handler ships as a hashed <script>');
$policy = (function () {
    $p = __DIR__ . '/csp-policy.php';
    return is_file($p) ? (string) include $p : (string) file_get_contents(__DIR__ . '/htaccess.txt');
})();
$hash = 'sha256-' . base64_encode(hash('sha256', INV_PRINT_JS, true));
inv_ok(str_contains($policy, $hash), "the policy allows that exact script ($hash)",
    str_contains($policy, $hash) ? 'allowlisted' : 'ADD IT to htaccess.txt + csp-policy.php');
inv_ok(!str_contains($policy, "'unsafe-inline'") || !preg_match("/script-src[^;]*'unsafe-inline'/", $policy),
    'and the policy still has no unsafe-inline on script-src');
// print really is styled, and drops what makes no sense on paper
inv_ok(str_contains($html['part'], '@media print{'), 'there is a print stylesheet');
inv_ok(str_contains($html['part'], '@page{margin:14mm}'), 'the printed page has a stated margin, not a browser default');
inv_ok(preg_match('/@media print\{.*\.bar\{display:none\}/s', $html['part']) === 1,
    'print hides the action bar');
inv_ok(preg_match('/@media print\{.*background:none!important/s', $html['part']) === 1,
    'print gives the chips a border, because a printer drops tinted fills');
// the sticky bar must clear the notch, like every other fixed element here
inv_ok(str_contains($html['part'], 'env(safe-area-inset-bottom)'), 'the action bar clears the home indicator');
// tap targets
inv_ok(preg_match('/\.btn,\.btn2\{[^}]*min-height:44px/', $html['part']) === 1, 'both controls take the 44px floor');

// ════════════════════════════════════ §6 ════════════════════════════════════
// TWO DEFINITIONS OF A COLOUR, KEPT IN LOCKSTEP BY THIS CHECK. invoice.php
// cannot require mailer.php (the composer is pure and this is a guest page), so
// the inks are restated — and restated values drift unless something compares
// them. Same contract as the JS/PHP price model.
echo "\n§6 the inks are the email design system's\n";
require_once __DIR__ . '/mailer.php';
inv_ok(strtoupper(INV_MUTED) === strtoupper(email_muted_ink()), 'INV_MUTED == email_muted_ink()', INV_MUTED);
inv_ok(strtoupper(INV_ACCENT_INK) === strtoupper(email_accent_ink()), 'INV_ACCENT_INK == email_accent_ink()', INV_ACCENT_INK);
inv_ok(strtoupper(INV_WARN_INK) === strtoupper(email_warn_ink()), 'INV_WARN_INK == email_warn_ink()', INV_WARN_INK);
inv_ok(strtoupper(INV_ALERT_INK) === strtoupper(email_alert_ink()), 'INV_ALERT_INK == email_alert_ink()', INV_ALERT_INK);

echo "\n" . ($fails ? "✗ $fails of $checks checks failed\n" : "✓ all $checks checks passed\n");
exit($fails ? 1 : 0);
