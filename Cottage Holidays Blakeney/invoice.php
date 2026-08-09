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
//  ONE DOCUMENT, TWO PRESENTATIONS. On screen it is the app's grouped-card
//  anatomy — the ask at the top, a pay button in thumb reach, one fact per
//  row. In print (@media print) the same DOM becomes a formal statement: the
//  crest and the amount split into a masthead, the cards flatten to ruled
//  tables, the actions disappear. Same markup, restyled for paper — NOT two
//  compositions, because two would drift the way the two invoices already had.
//
//  render_invoice_html() is a PURE function (no DB, no clock) so it can be
//  unit-tested; the bootstrap below only runs when this file IS the request.
//  test-invoice.php drives it in every deposit state.
// ============================================================

// ── THE INKS ARE THE EMAIL DESIGN SYSTEM'S, restated here because this function
//    is pure and mailer.php is not required on a guest page. test-invoice.php
//    asserts each equals its mailer.php definition, so the pair cannot drift —
//    the same discipline that keeps priceBreakdown and price_breakdown honest.
//    What they replace, measured on this document's white:
//      #8a8378 (every label, heading and note) 3.75:1  → INK_MUTED  6.49:1
//      the per-cottage accent AS TEXT          2.55:1  → INK_ACCENT 5.87:1
//      white on the accent fill                2.55:1  → ON_ACCENT  8.2:1
const INV_INK = '#1b2a34';        // body
const INV_INK_2 = '#46525b';      // secondary prose
const INV_MUTED = '#655D50';      // labels, captions, notes  (email_muted_ink)
const INV_ACCENT_INK = '#8A5A2B'; // the accent as WORDS       (email_accent_ink)
const INV_WARN_INK = '#8A5000';   // a due date                (email_warn_ink)
const INV_ALERT_INK = '#A3291C';  // a deposit retained        (email_alert_ink)
const INV_OK_INK = '#1f6b3a';     // settled, a credit
const INV_ON_ACCENT = '#3a2e1e';  // ink ON the accent fill
const INV_HAIR = '#e4dbc8';       // the hairline a printed card needs, having no fill

// The Save-a-copy handler. It is a hashed inline <script> and not an onclick
// ATTRIBUTE, because the site's CSP is `script-src 'self' 'unsafe-eval'
// 'sha256-…'` with NO 'unsafe-inline' and NO 'unsafe-hashes' — so the
// `onclick="window.print()"` this page shipped with was BLOCKED, and the only
// action on the guest's invoice had silently done nothing since the policy
// landed. A hash allowlists an inline <script> ELEMENT (attributes it cannot
// cover), which is the pattern index.html's theme-boot script already uses.
// test-invoice.php hashes this constant and fails if the policy doesn't carry
// it, so editing the script tells you to update the header.
const INV_PRINT_JS = "document.getElementById('inv-print').addEventListener('click',function(){window.print();});";

// The one-line status shown under the refundable-deposit figure. Mirror of
// app.js's depositInvoiceStatus (the owner's PDF) — both are driven by
// invoice-deposit-fixtures.json so the guest's two documents cannot say
// opposite things about the same money, which is exactly what they used to do.
function invoice_deposit_status($depAmt, $holdStatus, $returnedAmt, $settledDate)
{
    $dep = (float) $depAmt;
    if (!($dep > 0)) {
        return '';
    }
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $returned = round((float) $returnedAmt, 2);
    $when = $settledDate !== '' && $settledDate !== null ? ' on ' . $settledDate : '';
    $st = (string) ($holdStatus === '' || $holdStatus === null ? 'none' : $holdStatus);

    if ($st === 'returned' || (($st === 'charged' || $st === 'captured') && $returned >= $dep - 0.01)) {
        return 'Refunded in full' . $when . '.';
    }
    if ($st === 'kept') {
        return 'Retained after checkout for damage or loss.';
    }
    // 'captured' is a LEGACY card hold that was captured, i.e. the money was
    // taken — so it belongs here and not with the holds below, where it used to
    // sit telling the guest their money was "held (not charged)".
    if ($st === 'charged' || $st === 'captured') {
        return $returned > 0.01
            ? $money($returned) . ' of ' . $money($dep) . ' refunded' . $when .
              '. Balance refundable after your stay.'
            : 'Paid — refunded in full after your stay, provided there is no damage.';
    }
    if ($st === 'released' || $st === 'expired') {
        return 'The hold on your card has been released.';
    }
    if ($st === 'authorized') {
        return 'Held on your card (not charged) — released after checkout.';
    }
    return 'Charged with your first payment and refunded after your stay.';
}

// Build the full invoice page from a plain data array. $d keys:
//   ref, guest_name, guest_email, issued, prop_name, address,
//   check_in, check_out, check_in_time, check_out_time, nights, party,
//   per_night, nightly, tx_pct, tx_fee, damages, total, grand_total,
//   paid, balance, balance_due_date, accent, business, phone,
//   deposit_amount, deposit_status, deposit_state, payments, pay_url
//
//  DISPLAY AND ARITHMETIC ARE DIFFERENT QUESTIONS, and conflating them is what
//  erased a refunded deposit from this document. `damages` is what sits IN the
//  total, and is correctly 0 once the money has gone back; `deposit_amount` is
//  what the deposit WAS, and never goes to zero — so the page can still record
//  that £75 was taken and returned. One of those is money, the other is a fact.
function render_invoice_html($d)
{
    $e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $accent = preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($d['accent'] ?? '')) ? $d['accent'] : '#8FB3C7';
    $damages = (float) ($d['damages'] ?? 0);
    $depAmt = (float) ($d['deposit_amount'] ?? $damages);
    $depStatus = (string) ($d['deposit_status'] ?? '');
    $depState = (string) ($d['deposit_state'] ?? '');
    $paid = (float) ($d['paid'] ?? 0);
    $balance = (float) ($d['balance'] ?? 0);
    $grand = (float) ($d['grand_total'] ?? 0);
    $settled = $balance <= 0.001;
    $ref = (string) ($d['ref'] ?? '');
    $business = trim((string) ($d['business'] ?? '')) !== '' ? (string) $d['business'] : 'Cottage Holidays Blakeney';
    $nightsLbl = (int) ($d['nights'] ?? 0) . ' night' . ((int) ($d['nights'] ?? 0) === 1 ? '' : 's');

    // ── rows ────────────────────────────────────────────────────────────────
    $row = fn($label, $value, $sub = '', $cls = '') =>
        '<tr' . ($cls !== '' ? ' class="' . $cls . '"' : '') . '><td class="d">' . $label .
        ($sub !== '' ? '<small>' . $sub . '</small>' : '') . '</td><td class="a">' . $value . '</td></tr>';
    $kv = fn($label, $value) =>
        '<div class="kv"><span class="k">' . $e($label) . '</span><span class="v">' . $e($value) . '</span></div>';

    // A custom price (override / agreed enquiry price) is ONE line — the standard
    // per-night + fee snapshot cannot reach the agreed total, and this invoice and
    // the confirmation email are one booking's documents (booking_price_is_custom
    // is the shared decision, db.php).
    $charge = booking_price_is_custom($d['nightly'] ?? 0, $d['tx_fee'] ?? 0, $d['total'] ?? 0)
        ? $row('Agreed price for your stay', $money($d['total'] ?? 0), $e($nightsLbl))
        : $row(
            $e($money($d['per_night'] ?? 0)) . ' &times; ' . $e($nightsLbl),
            $money($d['nightly'] ?? 0),
            $e(($d['prop_name'] ?? '') . ' · ' . ($d['check_in'] ?? '') . ' – ' . ($d['check_out'] ?? '')),
        ) . $row('Transaction fee (' . $e($d['tx_pct'] ?? 0) . '%)', $money($d['tx_fee'] ?? 0));
    // CHARGES ADD UP TO THEIR OWN TOTAL, so this line carries what is IN the total
    // ($damages), not what the deposit was. The deposit is a HOLDING, not a charge:
    // once it has gone back it leaves the total, and a line for it here would leave
    // the table summing to £770.25 under a stated total of £695.25. Its history is
    // then in Payments — the dated return row, plus the sentence below the card.
    if ($damages > 0) {
        $charge .= $row('Refundable damages deposit', $money($damages), $e($depStatus));
    }

    // MONEY IN reduces what is outstanding, so it reads as a credit; money going
    // BACK to the guest reads as a charge again. The rows plus the balance must
    // equal the total — see the note on the carrying row below, and §3's
    // coherence check, which is what a guest does with a calculator.
    $payRows = '';
    foreach ((array) ($d['payments'] ?? []) as $p) {
        $sub = trim(($p['date'] ?? '') . (!empty($p['note']) ? ' · ' . $p['note'] : ''), ' ·');
        $payRows .= $row(
            $e($p['label'] ?? ''),
            ($p['credit'] ?? false ? '&minus; ' : '') . $money($p['amount'] ?? 0),
            $e($sub),
            $p['credit'] ?? false ? 'cr' : '',
        );
    }
    if ($payRows === '') {
        $payRows = $row('Nothing received yet', $money(0), '');
    }

    // ── the hero: what this document is ASKING, or what it RECORDS ───────────
    //  When there is a balance the headline figure is the balance; when there
    //  isn't, it is the total received. Two different facts, so the caption
    //  above it names which — an invoice with a big £0.00 on it states nothing.
    $stateChip = $depState === 'kept'
        ? '<p class="chip kept">Deposit retained</p>'
        : ($depState === 'returned' ? '<p class="chip ok">Deposit returned</p>' : '');
    //  Said ONCE: the caption "Paid in full" over the figure and a "Nothing
    //  outstanding" chip beneath it were the same fact on adjacent lines, and the
    //  Payments card's own footer states it a third time where it reconciles.
    $hero = $settled
        ? '<p class="cap ok">Paid in full</p>' .
          '<p class="fig">' . $money($paid) . '</p>'
        : '<p class="cap accent">Balance due</p>' .
          '<p class="fig">' . $money($balance) . '</p>' .
          (!empty($d['balance_due_date']) ? '<p class="chip due">by ' . $e($d['balance_due_date']) . '</p>' : '') .
          ($paid > 0.001 ? '<p class="sub">' . $money($paid) . ' of ' . $money($grand) . ' received</p>' : '');

    // ── the actions. Pay is a real <a>, so no script and no CSP involvement;
    //    Save a copy needs one line of JS and gets the hashed <script> above. ──
    $payBtn = !$settled && !empty($d['pay_url'])
        ? '<a class="btn" href="' . $e($d['pay_url']) . '">Pay ' . $money($balance) . '</a>'
        : '';
    // THE BAR EXISTS TO PAY, so a settled invoice does not get one: a fixed bar
    // carrying no action is chrome for nothing, and it covers the last rows of
    // the document to say "Settled" directly under a page that already says it.
    // Save a copy lives in the flow at the foot in both states — beside it in the
    // bar it wrapped to a second line and took 121px of a 390px screen.
    $bar = $settled || $payBtn === '' ? '' :
        '<div class="bar"><div class="bar-in">' .
        '<span class="bar-lbl">' .
        '<span class="cap">' . (!empty($d['balance_due_date']) ? 'Due ' . $e($d['balance_due_date']) : 'Still to pay') .
        '</span><span class="bar-fig">' . $money($balance) . '</span>' .
        '</span>' . $payBtn . '</div></div>';

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' .
        '<meta name="viewport" content="width=device-width, initial-scale=1">' .
        '<meta name="robots" content="noindex">' .
        '<title>Invoice ' . $e($ref) . ' — ' . $e($business) . '</title>' .
        '<style>' .
        '*{box-sizing:border-box}' .
        'body{margin:0;background:#f5f1e9;color:' . INV_INK . ';' .
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' .
        'font-size:15px;line-height:1.5;padding:24px 16px 32px;-webkit-font-smoothing:antialiased}'
        . '.has-bar{padding-bottom:104px}' .
        '.sheet{max-width:640px;margin:0 auto}' .
        // the accent stays a FILL — it is 2.55:1 as words and fails AA outright
        '.band{height:4px;background:' . $accent . ';border-radius:4px 4px 0 0}' .
        '.hd{background:#fff;border-radius:0 0 14px 14px;padding:22px 22px 26px;text-align:center;' .
        'box-shadow:0 1px 2px rgba(20,30,40,.06),0 6px 18px rgba(20,30,40,.05)}' .
        '.brand{display:flex;align-items:center;justify-content:center;gap:9px;margin:0 0 18px}' .
        '.crest{width:32px;height:auto;display:block}' .
        '.bn{font-family:Georgia,"Times New Roman",serif;font-size:16px;letter-spacing:-.01em}' .
        '.cap{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:' . INV_MUTED . ';margin:0}' .
        '.cap.accent{color:' . INV_ACCENT_INK . '}' .
        '.cap.ok{color:' . INV_OK_INK . '}' .
        '.fig{font-family:Georgia,"Times New Roman",serif;font-size:38px;line-height:1.05;margin:6px 0 10px;' .
        'font-variant-numeric:tabular-nums;letter-spacing:-.02em}' .
        '.sub{color:' . INV_MUTED . ';font-size:13px;margin:8px 0 0}' .
        '.ref{color:' . INV_MUTED . ';font-size:12.5px;margin:10px 0 0}' .
        '.chip{display:inline-block;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;' .
        'padding:4px 9px;border-radius:5px;margin:0}' .
        '.chip.due{background:#fbf0da;color:' . INV_WARN_INK . '}' .
        '.chip.ok{background:#e6f1e9;color:' . INV_OK_INK . '}' .
        '.chip.kept{background:#fae9e6;color:' . INV_ALERT_INK . '}' .
        '.chip+.chip{margin-left:6px}' .
        'h2{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:' . INV_MUTED . ';' .
        'font-weight:600;margin:26px 0 7px;padding-left:4px}' .
        '.grp{background:#fff;border-radius:13px;overflow:hidden;width:100%;border-collapse:collapse;' .
        'box-shadow:0 1px 2px rgba(20,30,40,.06),0 5px 14px rgba(20,30,40,.05)}' .
        '.grp td{padding:12px 15px;vertical-align:top;font-size:14.5px}' .
        '.grp tr+tr td{border-top:1px solid #efe9dc}' .
        '.grp td.a{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;width:1%}' .
        '.grp td.d small{display:block;font-size:12.5px;color:' . INV_MUTED . ';margin-top:2px;line-height:1.45}' .
        '.grp tr.cr td.a{color:' . INV_OK_INK . '}' .
        '.grp tfoot td{background:#faf6ec;font-weight:700}' .
        '.kvs{background:#fff;border-radius:13px;overflow:hidden;' .
        'box-shadow:0 1px 2px rgba(20,30,40,.06),0 5px 14px rgba(20,30,40,.05)}' .
        '.kv{display:flex;gap:14px;align-items:baseline;padding:12px 15px}' .
        '.kv+.kv{border-top:1px solid #efe9dc}' .
        '.kv .k{flex:0 0 auto;color:' . INV_MUTED . ';font-size:12.5px}' .
        '.kv .v{flex:1 1 auto;min-width:0;text-align:right;font-size:14.5px}' .
        '.who{padding:12px 15px;font-size:14px;line-height:1.6}' .
        '.who .nm{font-weight:600}' .
        '.who .l{color:' . INV_INK_2 . '}' .
        '.fine{color:' . INV_MUTED . ';font-size:12.5px;line-height:1.6;margin:20px 4px 0}' .
        // the action bar rides the bottom of the screen the whole way down: the
        // pay affordance must not be something you have to scroll to find
        '.acts{margin:16px 4px 0}'
        . '.bar{position:fixed;left:0;right:0;bottom:0;background:rgba(245,241,233,.96);' .
        'border-top:1px solid #e4dbc8;padding:10px 16px calc(10px + env(safe-area-inset-bottom))}' .
        '.bar-in{max-width:640px;margin:0 auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}' .
        '.bar-lbl{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}' .
        '.bar-fig{font-family:Georgia,"Times New Roman",serif;font-size:19px;font-variant-numeric:tabular-nums}' .
        '.btn,.btn2{display:inline-flex;align-items:center;justify-content:center;min-height:44px;' .
        'padding:11px 20px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;cursor:pointer;' .
        'font-family:inherit;flex:0 0 auto}' .
        // ink ON the accent, never white: white on this fill measures 2.55:1
        '.btn{background:' . $accent . ';color:' . INV_ON_ACCENT . ';border:0}' .
        '.btn2{background:transparent;color:' . INV_ACCENT_INK . ';border:1px solid #e4dbc8}' .
        'a:focus-visible,button:focus-visible{outline:2px solid ' . INV_ACCENT_INK . ';outline-offset:2px}' .
        // ── the same DOM as a printed statement ──────────────────────────────
        // an explicit page margin rather than whatever the browser happens to default
        '@page{margin:14mm}' .
        // ── PRINT KEEPS THE CARD ANATOMY. It used to flip the header into a
        //    masthead and flatten every card to a ruled table — which made the
        //    guest's SAVED PDF a THIRD look, different from both this screen and
        //    the owner's jsPDF download, on the one document all three are of.
        //    The reason it flattened is real: a printer drops tinted fills by
        //    default, so a white card on linen prints as white on white. So the
        //    cards keep their shape and take a HAIRLINE instead of relying on the
        //    fill, and every tinted thing states a border of its own.
        '@media print{' .
        '.acts{display:none}' .
        'body{background:#fff;padding:0;font-size:11pt}' .
        '.bar{display:none}' .
        '.sheet{max-width:none}' .
        '.hd,.grp,.kvs{box-shadow:none;border:1px solid ' . INV_HAIR . '}' .
        '.fig{font-size:24pt}' .
        '.grp tfoot td{border-top:1px solid ' . INV_INK . '}' .
        // a tinted chip or total row is invisible once the printer drops backgrounds
        '.chip{border:1px solid currentColor;background:none!important}' .
        'h2{margin:16px 0 5px}' .
        '}' .
        '</style></head><body' . ($bar !== '' ? ' class="has-bar"' : '') . '>' .
        '<main class="sheet">' .
        '<div class="band"></div>' .
        '<header class="hd">' .
        '<p class="brand"><img class="crest" src="logo.svg" alt="" width="32" height="19">' .
        '<span class="bn">' . $e($business) . '</span></p>' .
        '<div class="hero">' .
        '<h1 class="sr-only" hidden>Invoice ' . $e($ref) . '</h1>' .
        $hero .
        '<p class="ref">Invoice ' . $e($ref) . ' · issued ' . $e($d['issued'] ?? '') . '</p>' .
        ($stateChip !== '' ? '<p class="ref">' . $stateChip . '</p>' : '') .
        '</div></header>' .

        '<h2>Charges</h2>' .
        '<table class="grp"><tbody>' . $charge . '</tbody>' .
        '<tfoot>' . $row('Total', $money($grand)) . '</tfoot></table>' .

        '<h2>Payments</h2>' .
        '<table class="grp"><tbody>' . $payRows . '</tbody>' .
        '<tfoot>' . $row($settled ? 'Nothing outstanding' : 'Still to pay', $money($balance)) . '</tfoot></table>' .
        // the deposit has left the total, so it is no longer a charge — but it was
        // taken, and the document says so in words where the movement is recorded
        ($depAmt > 0 && $damages <= 0.005 && $depStatus !== ''
            ? '<p class="fine">Refundable damages deposit of ' . $money($depAmt) . ' — ' . $e($depStatus) . '</p>'
            : '') .

        '<h2>Your stay</h2>' .
        '<div class="kvs">' .
        $kv('Cottage', (string) ($d['prop_name'] ?? '')) .
        (!empty($d['address']) ? $kv('Address', (string) $d['address']) : '') .
        $kv('Check in', ($d['check_in'] ?? '') . ' · ' . ($d['check_in_time'] ?? '15:00')) .
        $kv('Check out', ($d['check_out'] ?? '') . ' · ' . ($d['check_out_time'] ?? '10:00')) .
        $kv('Nights', (string) ($d['nights'] ?? '')) .
        $kv('Guests', (string) ($d['party'] ?? '')) .
        '</div>' .

        '<h2>Billed to</h2>' .
        '<div class="kvs"><div class="who">' .
        '<div class="nm">' . $e($d['guest_name'] ?? '') . '</div>' .
        (!empty($d['guest_email']) ? '<div class="l">' . $e($d['guest_email']) . '</div>' : '') .
        '</div></div>' .

        // ── AN INVOICE THAT STATES A BALANCE MUST SAY HOW TO PAY IT. The pay
        //    button is correctly withheld off the card rail (payment_rail — the
        //    decision the chase emails already follow), and nothing replaced it:
        //    a guest who paid by transfer got "Balance due £446.44" and no
        //    instructions at all. The chase emails print bacs-details; the
        //    document the guest FILES did not.
        ($balance > 0.001 && empty($d['pay_url'])
            ? '<h2>How to pay</h2><div class="kvs"><div class="who">' .
              (trim((string) ($d['bank_details'] ?? '')) !== ''
                  ? '<div class="l">' . nl2br($e($d['bank_details'])) . '</div>'
                  : '<div class="l">Reply to your confirmation email and we will send you our bank details.</div>') .
              '</div></div>'
            : '') .

        '<h2>Issued by</h2>' .
        '<div class="kvs"><div class="who">' .
        '<div class="nm">' . $e($business) . '</div>' .
        '<div class="l">North Norfolk Coastal Retreats' .
        (!empty($d['phone']) ? ' · ' . $e($d['phone']) : '') . '</div>' .
        '</div></div>' .

        '<p class="fine">This invoice relates to booking ' . $e($ref) . '. ' .
        'Any questions? Just reply to your confirmation email and we will answer.</p>' .
        '<p class="acts"><button type="button" class="btn2" id="inv-print">Save a copy</button></p>' .
        '</main>' .
        $bar .
        '<script>' . INV_PRINT_JS . '</script>' .
        '</body></html>';
}

// ---- Bootstrap: only when this file IS the request (not when unit-tested) ----
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'invoice.php') {
    return;
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php';

header('Content-Type: text/html; charset=utf-8');

$id = (int) ($_GET['b'] ?? 0);
$token = (string) ($_GET['token'] ?? '');
if ($id <= 0 || !hash_equals(invoice_token($id), $token)) {
    echo token_link_error_page(
        'Invoice',
        'Sorry — this invoice link doesn’t work any more.',
        403,
    );
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
    echo token_link_error_page(
        'Invoice',
        'Sorry — we couldn’t find that booking. It may have been cancelled.',
        404,
    );
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
$depositCharged = in_array($holdStatus, ['charged', 'captured', 'kept'], true);
// BILL WHAT WAS ACTUALLY TAKEN. $damages above comes from agreed_booking_fee, but the
// update action RE-SNAPSHOTS that field whenever the stay changes while hold_amount —
// the sum genuinely charged — stays put. So extending a booking whose deposit had
// already been charged made this invoice show the new figure as both the deposit and
// as money paid, overstating both. damages_collected() reads hold_amount for exactly
// this reason; so does this now, once the deposit is charged.
if ($depositCharged && (float) ($b['hold_amount'] ?? 0) > 0) {
    $damages = round((float) $b['hold_amount'], 2);
}
// THE FACT vs THE MONEY. $depAmt is what the deposit was and stays on the
// document for ever; $damages is what is still in the total, and drops to zero
// once the money has gone back — which is right for the arithmetic and was
// wrong for the page, because it deleted the deposit's whole history.
$depAmt = $damages;
if (in_array($holdStatus, ['returned', 'released'], true)) {
    $damages = 0.0;
}
$grand = round($total + $damages, 2);
// The SHARED paid-so-far figure (booking_paid_so_far), not deposit_paid alone: with
// the card ledger ahead of the reconciled column, an invoice reading the column
// understated Paid and overstated Balance due — on a document the guest opens. The
// email, the pay screen and the charge were unified; this was the fourth site.
$paid = round(booking_paid_so_far($b) + ($depositCharged ? $damages : 0), 2);
$balance = max(0, round($grand - $paid, 2));

// How much of the deposit has actually gone back, and when — damages_returned()
// correctly ignores FAILED and REJECTED refunds, so a refund that never landed
// can never read as money returned on the guest's own invoice.
// damages_returned_map() is the ONE definition and never throws — it already
// excludes FAILED and REJECTED, so a refund that never landed can never read as
// money returned on the guest's own invoice.
$depReturned = damages_returned_map([$id])[$id] ?? 0.0;
$depSettled = !empty($b['hold_settled_at']) ? uk_date(substr((string) $b['hold_settled_at'], 0, 10)) : '';

// THE GUEST'S OWN PAYMENT HISTORY, DATED — and it has to reconcile: the rows
// plus what is still to pay must equal the total, because that is what a guest
// does with a calculator. Two things make that non-obvious.
//
//   * payments.amount is RENTAL-ONLY. pay.php charges rental + the refundable
//     deposit as ONE Square payment and records only the rental part, so the row
//     for the guest's first payment is smaller than their bank statement. It is
//     shown at the sum the CARD took, with the deposit named underneath — the
//     same fact booking_payments_rows() flags to the owner as deposit_carried.
//   * a FAILED or REJECTED refund is not money returned and must never appear as
//     one; damages_returned_map() takes the same line for the figures.
// The Square id and the owner's private note are not the guest's business.
$depWasTaken = in_array($holdStatus, ['charged', 'captured', 'kept', 'returned'], true);
$holdPid = (string) ($b['hold_payment_id'] ?? '');
$holdAmt = round((float) ($b['hold_amount'] ?? 0), 2);
$payments = [];
try {
    $ps = db()->prepare(
        "SELECT square_payment_id, kind, amount, created_at FROM payments
          WHERE booking_id = ? AND (status IS NULL OR UPPER(status) NOT IN ('FAILED','REJECTED','CANCELED'))
          ORDER BY id ASC",
    );
    $ps->execute([$id]);
    foreach ($ps->fetchAll() as $r) {
        $isRefund = in_array((string) $r['kind'], ['refund', 'damages_return'], true);
        $amount = round((float) $r['amount'], 2);
        $note = '';
        $carried = $depWasTaken && $holdAmt > 0 && $holdPid !== ''
            && (string) $r['square_payment_id'] === $holdPid
            && in_array((string) $r['kind'], ['deposit', 'balance'], true);
        if ($carried) {
            $amount = round($amount + $holdAmt, 2);
            $note = 'includes the ' . '£' . number_format($holdAmt, 2) . ' refundable deposit';
        }
        $payments[] = [
            'date' => uk_date(substr((string) $r['created_at'], 0, 10)),
            'label' => [
                'deposit' => 'Deposit received',
                'balance' => 'Balance received',
                'damages' => 'Refundable deposit received',
                'refund' => 'Refunded to you',
                'damages_return' => 'Refundable deposit returned',
            ][(string) $r['kind']] ?? 'Payment received',
            'amount' => $amount,
            'note' => $note,
            'credit' => !$isRefund,
        ];
    }
} catch (\Throwable $ex) {
    $payments = [];
}
// No ledger rows but the booking says money is in (cash, bank transfer, or a
// charge recorded before the ledger existed) — say so rather than showing an
// empty Payments card under a header claiming £X received.
if (!$payments && $paid > 0.001) {
    $payments[] = [
        'date' => '',
        'label' => payment_rail($b) === 'card' ? 'Received' : 'Received — ' . strtolower((string) $b['payment_method']),
        'amount' => $paid,
        'credit' => true,
    ];
}

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
    // The house form, DD/MM/YYYY, like every other date on this document —
    // it printed '7 Aug 2026' directly above a uk_date() check-in.
    'issued' => uk_date(date('Y-m-d')),
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
    'deposit_amount' => $depAmt,
    'deposit_state' => $holdStatus,
    'deposit_status' => invoice_deposit_status($depAmt, $holdStatus, $depReturned, $depSettled),
    'total' => $total,
    'grand_total' => $grand,
    'paid' => $paid,
    'payments' => $payments,
    // booking_balance_due_date is the ONE derivation (custom date, else check-in
    // minus the window) the confirmation and the deposit ask both read.
    'balance_due_date' => $balance > 0.001 ? uk_date(booking_balance_due_date($b)) : '',
    'balance' => $balance,
    // A guest on the CARD rail can settle from the document they are reading.
    // On the bank/cash rail there is nothing to link to — payment_rail is the
    // one decision the chase emails already follow, so the invoice follows it
    // too rather than pushing a card link at someone who paid by transfer.
    'pay_url' => $balance > 0.001 && payment_rail($b) === 'card'
        ? site_base_url() . 'index.html?pay=' . pay_token($id) . '&b=' . $id
        : '',
    'phone' => content_value('contact-phone'),
    // Only when there is a balance and no card link: the bank rail's own answer.
    // bacs-details is an INTERNAL content key, so this is the one surface that can
    // always resolve it — a guest's app.js never receives it.
    'bank_details' => $balance > 0.001 && payment_rail($b) !== 'card' ? content_value('bacs-details') : '',
    'accent' => $disp['accent'] ?? '#8FB3C7',
]);
