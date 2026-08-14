<?php
// ============================================================
//  api/accounts.php — financial reporting (admin only).
//  GET ?year=2025  -> income received in the 2025/26 UK tax year
//                     (6 Apr 2025 – 5 Apr 2026), allocated by payment_date.
//  GET (no year)   -> list of available tax years + current.
//  Money "taken" = deposit_paid where payment_date falls in the year.
// ============================================================
require_once __DIR__ . '/db.php';
require_admin();

// UK tax year start year for a date (6 Apr boundary)
function tax_year_start($dateStr)
{
    if (!$dateStr) {
        return null;
    }
    [$y, $m, $d] = array_map('intval', explode('-', $dateStr));
    if ($m < 4 || ($m === 4 && $d < 6)) {
        return $y - 1;
    }
    return $y;
}

// All payments actually received (a positive deposit_paid with a date).
// agreed_total = full price the guest pays; agreed_booking_fee = the refundable
// damages deposit portion (held, not income). agreed_rental = total − deposit.
$bookings = db()
    ->query(
        'SELECT b.id, b.name, b.prop_key, b.deposit_paid, b.payment_method, b.payment_date,
            b.agreed_total, b.agreed_booking_fee, b.agreed_nightly, b.agreed_txn_fee, b.price_override,
            p.name AS property_name
     FROM bookings b JOIN properties p ON p.prop_key = b.prop_key
     WHERE b.deposit_paid > 0',
    )
    ->fetchAll();

// Ledger card payments per booking, oldest first (kind deposit/balance, settled).
// Cash-basis income belongs to the tax year each payment was RECEIVED, so a
// deposit taken before 6 Apr and a balance paid after it split across two years —
// the old model keyed the WHOLE booking to the single (and reconcile-rewritten)
// payment_date, so paying the balance retroactively migrated the deposit's income
// into the next tax year. We allocate each booking's income across these dates.
$cardByBooking = [];
try {
    $lq = db()->query(
        "SELECT booking_id, DATE(created_at) d, ROUND(SUM(amount),2) a
           FROM payments
          WHERE kind IN ('deposit','balance') AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED')
          GROUP BY booking_id, DATE(created_at)
          ORDER BY booking_id, d",
    );
    foreach ($lq->fetchAll() as $lr) {
        $cardByBooking[(int) $lr['booking_id']][] = [$lr['d'], (float) $lr['a']];
    }
} catch (\Throwable $e) {
    // payments table not migrated — every booking falls back to payment_date below.
}

// Split $income across the card-payment dates oldest-first (each date absorbs up
// to its own amount); any remainder (manual bank/cash money that has no ledger
// row) is attributed to the booking's payment_date. Returns [taxYear => portion].
function allocate_income_by_year($income, $cardDates, $paymentDate)
{
    $byYear = [];
    $remaining = $income;
    foreach ($cardDates as [$d, $amt]) {
        if ($remaining <= 0.005) {
            break;
        }
        $take = min($remaining, $amt);
        if ($take > 0.005) {
            $ty = tax_year_start($d);
            $byYear[$ty === null ? 'null' : $ty] = ($byYear[$ty === null ? 'null' : $ty] ?? 0) + $take;
            $remaining -= $take;
        }
    }
    if ($remaining > 0.005) {
        $ty = tax_year_start($paymentDate);
        $byYear[$ty === null ? 'null' : $ty] = ($byYear[$ty === null ? 'null' : $ty] ?? 0) + $remaining;
    }
    return $byYear;
}

// The same allocation, kept per DAY. The tax-YEAR total was already split across
// the real card dates, but the ROW carrying it is stamped with the booking's single
// `payment_date` — a field pay.php and the reconciler restamp on EVERY payment — and
// the client's MTD quarter buckets filter on that. So £200 in May and £600 in
// November reported Q1 £0.00 / Q3 £800.00, and a row allocated to one tax year but
// dated inside the next fell outside all four quarter bounds and vanished from the
// table entirely. Shipping the days lets the quarters be summed from what actually
// happened, exactly as fee_days and kept_days already are.
function allocate_income_by_day($income, $cardDates, $paymentDate)
{
    $out = [];
    $remaining = $income;
    foreach ($cardDates as [$d, $amt]) {
        if ($remaining <= 0.005) {
            break;
        }
        $take = min($remaining, $amt);
        if ($take > 0.005) {
            $out[] = ['d' => $d, 'a' => round($take, 2)];
            $remaining -= $take;
        }
    }
    // Whatever the card cannot account for is cash/bank money whose only date is
    // the booking's own — the same fallback allocate_income_by_year() uses.
    if ($remaining > 0.005 && $paymentDate) {
        $out[] = ['d' => substr((string) $paymentDate, 0, 10), 'a' => round($remaining, 2)];
    }
    return $out;
}

$rows = []; // one entry per (booking, tax-year contribution) — held sits on the payment_date year
$incomeDays = []; // ['d' => Y-m-d, 'a' => float] — income on the day it really arrived
$years = [];
$undatedIncome = 0;
$undatedHeld = 0;
$undatedCount = 0;
foreach ($bookings as $b) {
    $received = (float) $b['deposit_paid'];
    // The rental price EXCLUDES the damages deposit in BOTH eras, so derive it from
    // the rental components (nightly + txn fee, override raising the floor) exactly
    // like damages_collected() — NOT as `agreed_total − deposit`. agreed_total is
    // already rental-only in the current model, so that old formula double-removed
    // the deposit: it under-reported taxable rental income by the deposit amount and
    // invented a phantom "held" deposit for every fully-paid modern booking.
    $rentalPrice = booking_rental_price($b); // shared derivation (db.php)
    // Legacy rows with no price snapshot: we can't split out a deposit we have no
    // figure for, so treat everything received as income (never a phantom deposit).
    if ($rentalPrice <= 0) {
        $rentalPrice = $received;
    }
    // Attribute money received to rental income FIRST; only the excess above the
    // rental price counts as the held damages deposit.
    $incomePart = min($received, $rentalPrice);
    $heldPart = max(0.0, $received - $rentalPrice);
    $paymentYear = tax_year_start($b['payment_date']); // where the held deposit + display date sit

    $byYear = allocate_income_by_year($incomePart, $cardByBooking[(int) $b['id']] ?? [], $b['payment_date']);
    foreach (allocate_income_by_day($incomePart, $cardByBooking[(int) $b['id']] ?? [], $b['payment_date']) as $dayRow) {
        $incomeDays[] = $dayRow;
    }
    if (!$byYear) {
        $byYear = [$paymentYear === null ? 'null' : $paymentYear => 0.0]; // no income (edge) — still surface held
    }
    foreach ($byYear as $tyKey => $portion) {
        $ty = $tyKey === 'null' ? null : (int) $tyKey;
        // Held deposit is not income and belongs once, on the payment_date year.
        $rowHeld = $ty === $paymentYear ? $heldPart : 0.0;
        $r = [
            'id' => $b['id'],
            'name' => $b['name'],
            'prop_key' => $b['prop_key'],
            'property_name' => $b['property_name'],
            'payment_method' => $b['payment_method'],
            'payment_date' => $b['payment_date'],
            'received' => round($received, 2),
            'income_part' => round($portion, 2),
            'held_part' => round($rowHeld, 2),
            'tax_year' => $ty,
        ];
        $rows[] = $r;
        if ($ty === null) {
            $undatedIncome += $portion;
            $undatedHeld += $rowHeld;
            $undatedCount++;
        } else {
            $years[$ty] = true;
        }
    }
}

// Retained income on CANCELLED bookings. `cancel` HARD-DELETES the booking row
// (to free the calendar), but a limited-refund cancellation keeps rental money;
// the card ledger rows survive the delete, so that genuinely-taxable income was
// vanishing from the report entirely. Count the net settled card-in for any
// booking_id no longer present, per received date. (Bank/cash-only cancellations
// leave no ledger row and are unrecoverable — inherent to a hard delete.)
try {
    $liveIds = [];
    foreach ($bookings as $b) {
        $liveIds[(int) $b['id']] = true;
    }
    // NET PER BOOKING, NOT PER DATE. A cancellation refund is stamped NOW(), which
    // is almost never the day the charge landed — so grouping the net by DATE put
    // the refund in its own negative group, `HAVING net > 0.005` dropped it, and the
    // charge's own day still reported its full gross. A booking charged £800 in May
    // and fully refunded in June was reported as £800 of taxable rental income for a
    // stay the owner kept nothing from, and that flowed into net profit, the Money
    // landing, the statement PDF and the CSV. Net the whole booking first, floor at
    // zero, then allocate whatever survives across its own charge dates oldest-first
    // — the same shape the kept-damages block below already uses.
    $orphanRows = db()->query(
        "SELECT booking_id, DATE(created_at) d,
              ROUND(COALESCE(SUM(CASE WHEN kind IN ('deposit','balance') AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED') THEN amount ELSE 0 END),0),2) charged,
              ROUND(COALESCE(SUM(CASE WHEN kind='refund' AND (status IS NULL OR UPPER(status) NOT IN ('FAILED','REJECTED')) THEN amount ELSE 0 END),0),2) refunded
           FROM payments
          GROUP BY booking_id, DATE(created_at)
          ORDER BY booking_id, d",
    )->fetchAll();
    $orphanBk = [];
    foreach ($orphanRows as $o) {
        $bid = (int) $o['booking_id'];
        if (isset($liveIds[$bid])) {
            continue; // live booking — already counted above
        }
        if (!isset($orphanBk[$bid])) {
            $orphanBk[$bid] = ['charges' => [], 'refunded' => 0.0];
        }
        if ((float) $o['charged'] > 0.005) {
            $orphanBk[$bid]['charges'][] = ['d' => $o['d'], 'amt' => (float) $o['charged']];
        }
        $orphanBk[$bid]['refunded'] += (float) $o['refunded'];
    }
    foreach ($orphanBk as $bid => $info) {
        $gross = 0.0;
        foreach ($info['charges'] as $c) {
            $gross += $c['amt'];
        }
        $left = round($gross - $info['refunded'], 2);
        if ($left <= 0.005) {
            continue; // fully refunded — the owner kept nothing, so there is no income
        }
        foreach ($info['charges'] as $c) {
            if ($left <= 0.005) {
                break;
            }
            $take = round(min($left, $c['amt']), 2);
            $left = round($left - $take, 2);
            $incomeDays[] = ['d' => $c['d'], 'a' => $take];
            $ty = tax_year_start($c['d']);
            $rows[] = [
                'id' => $bid,
                'name' => '(cancelled booking)',
                'prop_key' => '',
                'property_name' => '',
                'payment_method' => 'Square card',
                'payment_date' => $c['d'],
                'received' => $take,
                'income_part' => $take,
                'held_part' => 0.0,
                'tax_year' => $ty,
            ];
            if ($ty === null) {
                $undatedIncome += $take;
                $undatedCount++;
            } else {
                $years[$ty] = true;
            }
        }
    }
} catch (\Throwable $e) {
    // payments table not migrated — no orphan income to recover.
}
unset($r);

// Card processing fees (Square keeps these — the owner never receives them, so
// they are deducted from the profit automatically as a cost). Summed per charge
// DATE (payments.created_at) so the client can also split them into MTD
// quarters; card-IN rows only (a refund's row carries no fee of its own), live
// statuses only. Guarded: the payments table / fee column may predate the
// migration on a not-yet-migrated database.
$feeDays = [];
try {
    $feeDays = db()
        ->query(
            "SELECT DATE(created_at) d, ROUND(SUM(fee),2) f FROM payments
              WHERE fee IS NOT NULL AND fee > 0
                AND kind NOT IN ('refund','damages_return')
                AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED')
              GROUP BY DATE(created_at)",
        )
        ->fetchAll();
} catch (\Throwable $e) {
    /* payments table / fee column not migrated yet */
}

// Kept damage deposits are TAXABLE income the moment the owner retains them for
// damage — but they live in the payments ledger as kind='damages' rows (booked by
// keep_deposit / hold_capture), NOT in bookings.deposit_paid (which is rental
// only), so the rental-derived income above never sees them. Sum them per settle
// DATE (created_at) so they allocate to the right UK tax year like the fees.
// Guarded for a not-yet-migrated DB (the 'damages' enum value arrives in zz8).
$keptDays = [];
try {
    // Captured damages MINUS any damages_return refunded against them (net kept).
    // hold_capture's flow directs the owner to refund the excess via the normal
    // refund flow (kind='damages_return'), so a £250 capture later £150-returned is
    // only £100 of taxable kept income. FAILED/REJECTED returns don't count as
    // money handed back (parity with the rental-refund status filter).
    //
    // NETTED PER BOOKING AND FLOORED AT ZERO, and this is the whole point: the
    // netting used to happen per DATE across every booking, which went NEGATIVE in
    // the current charge-upfront model. There, pay.php bundles the deposit into the
    // rental charge and records it on bookings.hold_* with NO kind='damages' ledger
    // row, so returning it wrote a lone damages_return with nothing to net against —
    // a £75 deposit handed back became −£75 of "kept income" and quietly took £75
    // off net profit. A returned deposit was never income; it must not move profit
    // at all. You also cannot retain less than nothing, so per-booking max(0, …) is
    // the correct floor, and a return can only ever offset ITS OWN booking's capture.
    // Allocation is to the CAPTURE date, because retaining the money is the taxable
    // event (netting on the return's date could also push it into another tax year).
    $keptRows = db()
        ->query(
            "SELECT booking_id, DATE(created_at) d, kind, amount FROM payments
              WHERE (kind = 'damages' AND UPPER(status) IN ('COMPLETED','APPROVED','CAPTURED'))
                 OR (kind = 'damages_return' AND (status IS NULL OR UPPER(status) NOT IN ('FAILED','REJECTED')))
              ORDER BY created_at",
        )
        ->fetchAll();
    $perBooking = [];
    foreach ($keptRows as $kr) {
        $bid = (int) $kr['booking_id'];
        if (!isset($perBooking[$bid])) {
            $perBooking[$bid] = ['captures' => [], 'returned' => 0.0];
        }
        if ($kr['kind'] === 'damages') {
            $perBooking[$bid]['captures'][] = [$kr['d'], (float) $kr['amount']];
        } else {
            $perBooking[$bid]['returned'] += (float) $kr['amount'];
        }
    }
    $keptByDay = [];
    foreach ($perBooking as $p) {
        $captured = array_sum(array_map(fn($c) => $c[1], $p['captures']));
        $kept = round(max(0.0, $captured - $p['returned']), 2);
        if ($kept <= 0.005) {
            continue; // fully returned, or (charge-upfront) never captured as income
        }
        // Spread what's left across this booking's capture dates oldest-first, each
        // absorbing up to its own amount — same shape as allocate_income_by_year().
        $left = $kept;
        foreach ($p['captures'] as [$cd, $camt]) {
            if ($left <= 0.005) {
                break;
            }
            $take = min($left, $camt);
            $keptByDay[$cd] = ($keptByDay[$cd] ?? 0) + $take;
            $left -= $take;
        }
    }
    foreach ($keptByDay as $kd => $ka) {
        $keptDays[] = ['d' => $kd, 'a' => round($ka, 2)];
    }
} catch (\Throwable $e) {
    /* payments table / 'damages' kind not migrated yet */
}

// Always include the current tax year as an option
$years[tax_year_start(date('Y-m-d'))] = true;
$yearList = array_keys($years);
rsort($yearList);

$requested = isset($_GET['year']) ? (int) $_GET['year'] : null;
if ($requested === null) {
    json_out(['years' => $yearList]); // dropdown options
}

$inYear = array_values(array_filter($rows, fn($r) => $r['tax_year'] === $requested));
usort($inYear, fn($a, $b) => strcmp($a['payment_date'] ?? '', $b['payment_date'] ?? ''));

$incomeTotal = array_sum(array_map(fn($r) => $r['income_part'], $inYear));
$heldTotal = array_sum(array_map(fn($r) => $r['held_part'], $inYear));
$byProp = [];
foreach ($inYear as $r) {
    $byProp[$r['prop_key']] = ($byProp[$r['prop_key']] ?? 0) + $r['income_part'];
}

// This tax year's card fees (per-day rows so the client can quarter them).
$feesInYear = array_values(array_filter($feeDays, fn($r) => tax_year_start($r['d']) === $requested));
$feesTotal = array_sum(array_map(fn($r) => (float) $r['f'], $feesInYear));

// This tax year's kept damage deposits (income, per settle date).
$keptInYear = array_values(array_filter($keptDays, fn($r) => tax_year_start($r['d']) === $requested));
$keptTotal = array_sum(array_map(fn($r) => (float) $r['a'], $keptInYear));

// ---- SAFE TO MOVE: the deposits Square will claw back ----------------------
// Independent of the tax year (held_deposits above is year-filtered, which is the
// wrong basis for "what is still owed back"): every deposit currently outstanding,
// whenever it was taken, is money the bank account will lose again.
//
// Joined to the charge the deposit RODE so its share of the fee can be worked out
// (see sweep-lib.php — the ledger row's amount is rental-only while its fee covers
// rental + deposit). LEFT JOIN because a legacy card-hold deposit, or one whose
// charge predates the ledger, still has to be counted; sweep_row() then estimates
// from the observed rate rather than dropping it.
//
// The join is restricted to RENTAL kinds on purpose. A legacy CAPTURED hold writes its
// ledger row as kind='damages' keyed on the same hold_payment_id, with the DEPOSIT as
// its amount — so an unrestricted join read that deposit as the charge's rental
// portion and apportioned the fee against a doubled gross (over-fencing, the safe
// direction, but wrong). With no rental row the deposit rode its own charge, which is
// exactly what a captured hold is, and the fee estimate is then correct.
require_once __DIR__ . '/sweep-lib.php';
$sweep = ['gross' => 0.0, 'feeBack' => 0.0, 'net' => 0.0, 'count' => 0, 'items' => [], 'rate' => SWEEP_RATE_DEFAULT];
try {
    // The rate the account really pays, learned from settled charges. The gross
    // has to have any deposit that rode the charge ADDED BACK — payments.amount is
    // rental-only while its fee covers both, so reading amount as the gross biases
    // the learned rate HIGH on exactly the charges that carry deposits. Included
    // for 'returned'/'kept' deposits too: the charge did contain the deposit even
    // if the money has since gone back, and this is history, not a liability.
    $rateRows = db()
        ->query("SELECT p.amount + CASE
                            WHEN b.hold_payment_id = p.square_payment_id
                             AND b.hold_status IN ('charged','captured','returned','kept')
                            THEN COALESCE(b.hold_amount, 0) ELSE 0 END AS gross,
                        p.fee
                   FROM payments p
                   LEFT JOIN bookings b ON b.id = p.booking_id
                  WHERE p.kind IN ('deposit','balance')
                    AND UPPER(p.status) IN ('COMPLETED','APPROVED','CAPTURED')
                  ORDER BY p.id DESC LIMIT 200")
        ->fetchAll();
    $rate = sweep_observed_rate(array_map(fn($r) => ['gross' => (float) $r['gross'], 'fee' => $r['fee'] === null ? null : (float) $r['fee']], $rateRows));

    // A return only reduces the liability once it has SETTLED — see sweep_outstanding().
    // 'MANUAL' is a return booked by hand (cash/transfer), which is settled by
    // definition. A NULL/unrecognised status counts as PENDING, i.e. still fenced:
    // unknown must not be promoted to gone on a money screen. The 14-day line stops
    // a row nobody will ever confirm from fencing money forever.
    $liab = db()
        ->query("SELECT b.id, b.name, b.prop_key, b.check_in, b.check_out, b.hold_amount, b.hold_status,
                        p.amount AS charge_rental, p.fee AS charge_fee, p.square_payment_id,
                        COALESCE((SELECT SUM(r.amount) FROM payments r
                                  WHERE r.booking_id = b.id AND r.kind = 'damages_return'
                                    AND UPPER(COALESCE(r.status,'')) IN ('COMPLETED','MANUAL')), 0) AS ret_settled,
                        COALESCE((SELECT SUM(r.amount) FROM payments r
                                  WHERE r.booking_id = b.id AND r.kind = 'damages_return'
                                    AND UPPER(COALESCE(r.status,'')) NOT IN ('COMPLETED','MANUAL','FAILED','REJECTED')
                                    AND r.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)), 0) AS ret_pending,
                        COALESCE((SELECT SUM(r.amount) FROM payments r
                                  WHERE r.booking_id = b.id AND r.kind = 'damages_return'
                                    AND UPPER(COALESCE(r.status,'')) NOT IN ('COMPLETED','MANUAL','FAILED','REJECTED')
                                    AND r.created_at < DATE_SUB(NOW(), INTERVAL 14 DAY)), 0) AS ret_stale
                   FROM bookings b
                   LEFT JOIN payments p ON p.square_payment_id = b.hold_payment_id
                                       AND p.kind IN ('deposit','balance')
                  WHERE COALESCE(b.hold_amount, 0) > 0
                    AND (b.hold_status IN ('charged','captured')
                         OR (b.hold_status = 'returned' AND EXISTS (
                                 SELECT 1 FROM payments r2
                                  WHERE r2.booking_id = b.id AND r2.kind = 'damages_return'
                                    AND UPPER(COALESCE(r2.status,'')) NOT IN ('COMPLETED','MANUAL','FAILED','REJECTED')
                                    AND r2.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY))))
                  ORDER BY b.check_out ASC")
        ->fetchAll();
    $items = [];
    foreach ($liab as $r) {
        $split = sweep_outstanding($r['hold_amount'], $r['ret_settled'], $r['ret_pending'], $r['ret_stale']);
        $outstanding = $split['outstanding'];
        if ($outstanding <= 0) {
            continue;
        }
        $items[] = [
            'outstanding' => $outstanding,
            // Already refunded, just not debited yet — the screen says so, because
            // "still to return" would read as a job the owner still has to do.
            'awaiting' => $split['awaiting'],
            'rental' => (float) ($r['charge_rental'] ?? 0),
            'fee' => $r['charge_fee'] === null ? null : (float) $r['charge_fee'],
            'booking_id' => (int) $r['id'],
            'name' => (string) ($r['name'] ?? ''),
            'prop_key' => (string) ($r['prop_key'] ?? ''),
            // Both ends of the stay: a deposit on a booking that has not STARTED is a
            // different state from one mid-stay, and the screen said "Still staying" for
            // both. check_out alone cannot tell them apart.
            'check_in' => (string) ($r['check_in'] ?? ''),
            'check_out' => (string) ($r['check_out'] ?? ''),
        ];
    }
    $sweep = sweep_totals($items, $rate);

    // PER TRANSACTION: the same question asked of each settled charge, because
    // that is how a Square payout list reads — this £975 landed, £73.69 of it is
    // going back out, so the rest is mine to move. A charge is matched to the
    // deposit it CARRIED via bookings.hold_payment_id (pay.php bundles the deposit
    // with the guest's FIRST payment), so a later balance payment on the same
    // booking is movable in full rather than double-counting the same deposit.
    //
    // Recent charges plus, whenever they were taken, any still holding a deposit —
    // an old charge with money still to go back is exactly what must not fall off
    // the end of the list.
    $txnRows = db()
        ->query("SELECT p.id, p.amount AS rental, p.fee, DATE(p.created_at) AS paid_on,
                        p.square_payment_id,
                        b.id AS booking_id, b.name, b.prop_key,
                        b.hold_amount, b.hold_status, b.hold_payment_id,
                        COALESCE((SELECT SUM(r.amount) FROM payments r
                                  WHERE r.booking_id = b.id AND r.kind = 'damages_return'
                                    AND (r.status IS NULL OR UPPER(r.status) NOT IN ('FAILED','REJECTED'))), 0) AS returned
                   FROM payments p
                   JOIN bookings b ON b.id = p.booking_id
                  WHERE p.kind IN ('deposit','balance')
                    AND UPPER(p.status) IN ('COMPLETED','APPROVED','CAPTURED')
                    AND (p.created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                         OR (b.hold_status IN ('charged','captured') AND COALESCE(b.hold_amount, 0) > 0))
                  ORDER BY p.created_at DESC, p.id DESC
                  LIMIT 60")
        ->fetchAll();
    $txns = [];
    foreach ($txnRows as $r) {
        $carried = (string) ($r['hold_payment_id'] ?? '') !== ''
            && (string) $r['hold_payment_id'] === (string) $r['square_payment_id']
            && in_array((string) $r['hold_status'], ['charged', 'captured'], true);
        $txns[] = [
            'rental' => (float) $r['rental'],
            'deposit' => $carried ? (float) ($r['hold_amount'] ?? 0) : 0.0,
            'returned' => $carried ? (float) $r['returned'] : 0.0,
            'fee' => $r['fee'] === null ? null : (float) $r['fee'],
            // Consumed by payouts_apply() and stripped there — it is machinery, so
            // it never reaches the client.
            'square_payment_id' => (string) ($r['square_payment_id'] ?? ''),
            'txn_id' => (int) $r['id'],
            'booking_id' => (int) $r['booking_id'],
            'name' => (string) ($r['name'] ?? ''),
            'prop_key' => (string) ($r['prop_key'] ?? ''),
            'paid_on' => (string) ($r['paid_on'] ?? ''),
        ];
    }
    // WHERE THE MONEY ACTUALLY IS. Square settles a charge, then pays out to the
    // bank a day or two later, so a charge taken this morning is not spendable yet.
    // payouts-lib.php reads that from Square's Payouts API (cached; the fetch is a
    // cron job, never this request) and hands back the REAL fee per charge, so the
    // sweep arithmetic runs on Square's own figure rather than an observed rate.
    require_once __DIR__ . '/payouts-lib.php';
    $poCache = payouts_cached();
    $poMap = is_array($poCache) ? ($poCache['charges'] ?? []) : [];
    $txns = payouts_apply($txns, is_array($poMap) ? $poMap : []);
    $sweep['transactions'] = sweep_txn_totals($txns, $rate);
    // Charges the owner has said they already moved out of the bank drop into
    // their own bucket rather than counting towards movable a second time.
    $movedMap = payouts_moved_map();
    $sweep['payouts'] = payouts_split_totals($sweep['transactions']['items'], $movedMap);
    // The WHOLE stored record, not just the marks whose charge is still in the
    // payout window. The client amends this map and saves it back, so rebuilding it
    // from the visible rows would silently forget every mark that has aged out —
    // one recorded transfer quietly erasing an older one.
    $sweep['payouts']['movedMap'] = (object) $movedMap;
    $sweep['payouts']['checked'] = is_array($poCache) ? (int) ($poCache['checked'] ?? 0) : 0;
    $sweep['payouts']['error'] = is_array($poCache) ? ($poCache['error'] ?? null) : null;
    $sweep['payouts']['known'] = is_array($poMap) ? count($poMap) : 0;
    // The window the fetch actually covers, sent rather than re-typed in JS — the
    // screen names it when it reports that Square returned nothing at all.
    $sweep['payouts']['lookback'] = PAYOUTS_LOOKBACK_DAYS;
    // IS THERE ANYWHERE FOR THE MONEY TO GO? Rides the same payload — the screen
    // used to GUESS at this ("usually payouts paused, or no bank account linked")
    // because nothing could tell it. Cached like the payouts, so no page waits on
    // Square. bank_read() is the one place the states are decided.
    require_once __DIR__ . '/bank-lib.php';
    $bankCache = bank_cached();
    // Which location these figures are about, and what else there was to choose from.
    // Without this the screen cannot say whose payouts it is reporting — and a silent
    // default is what made sixty days of nothing look like a fact about the business.
    $sweep['location'] = [
        'id' => function_exists('square_location_id') ? square_location_id() : '',
        'all' => is_array($bankCache) ? ($bankCache['locations'] ?? []) : [],
    ];
    $sweep['bank'] = bank_read(
        is_array($bankCache) ? ($bankCache['accounts'] ?? null) : null,
        is_array($bankCache) ? ($bankCache['error'] ?? null) : null,
    );
    $sweep['payouts']['fees'] = is_array($poCache) ? (float) ($poCache['payoutFees'] ?? 0) : 0.0;
    $sweep['payouts']['truncated'] = is_array($poCache) ? !empty($poCache['truncated']) : false;
    $sweep['payouts']['failed'] = payouts_failed(is_array($poCache) ? ($poCache['payouts'] ?? []) : []);
    // Money Square may pull back. Its own figure beside the deposits, never folded in.
    $sweep['disputes'] = is_array($poCache) && is_array($poCache['disputes'] ?? null)
        ? $poCache['disputes']
        : ['amount' => 0.0, 'count' => 0, 'items' => [], 'error' => null];
    // The balance the owner last stated, rolled forward by what Square has done
    // since. An ESTIMATE, and the screen says so — never presented as fact.
    $stored = null;
    try {
        $rawBal = content_value(SWEEP_BALANCE_KEY);
        $decoded = is_string($rawBal) && $rawBal !== '' ? json_decode($rawBal, true) : null;
        $stored = is_array($decoded) ? $decoded : null;
    } catch (\Throwable $e) {
    }
    $sweep['balance'] = [
        'stored' => $stored,
        'estimate' => payouts_balance_estimate(
            $stored,
            is_array($poCache) ? ($poCache['payouts'] ?? []) : [],
            is_array($poCache) ? ($poCache['refunds'] ?? []) : [],
            time(),
        ),
    ];
} catch (\Throwable $e) {
    // Never let this break Income & tax — an empty liability is reported as
    // 'unknown' by the client rather than as a confident £0.
    $sweep['error'] = true;
}

json_out([
    'year' => $requested,
    'years' => $yearList,
    'deposit_liability' => $sweep,
    'total' => round($incomeTotal, 2), // rental income only (gross of card fees)
    'held_deposits' => round($heldTotal, 2), // refundable, held — NOT income
    'card_fees' => round($feesTotal, 2), // kept by Square — auto-deducted cost
    'fee_days' => array_map(fn($r) => ['date' => $r['d'], 'fee' => (float) $r['f']], $feesInYear),
    'kept_deposits' => round($keptTotal, 2), // damage deposits retained — taxable income
    'kept_days' => array_map(fn($r) => ['date' => $r['d'], 'amount' => (float) $r['a']], $keptInYear),
    // Income on the day it ACTUALLY arrived, for the MTD quarter buckets — the rows
    // above carry the booking's restamped payment_date, which put income in the
    // wrong quarter or in none at all.
    'income_days' => array_map(
        fn($r) => ['date' => $r['d'], 'amount' => (float) $r['a']],
        array_values(array_filter($incomeDays, fn($r) => tax_year_start($r['d']) === $requested)),
    ),
    'count' => count($inYear),
    'by_property' => $byProp,
    'payments' => $inYear,
    'undated' => ['count' => $undatedCount, 'total' => round($undatedIncome, 2), 'held' => round($undatedHeld, 2)],
]);
