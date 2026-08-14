<?php
// ============================================================
//  pricing.php — server-side price calculation (authoritative).
//  Mirrors the front-end couple-based model.
// ============================================================

function nights_between($checkIn, $checkOut)
{
    $a = strtotime($checkIn);
    $b = strtotime($checkOut);
    if (!$a || !$b) {
        return 0;
    }
    $d = (int) round(($b - $a) / 86400);
    return $d > 0 ? $d : 0;
}

// Seasonal rates for a property: date ranges with their own couple rate.
// Returns [] if the table doesn't exist yet (migration not run) — never throws.
function get_seasons($propKey)
{
    try {
        $s = db()->prepare(
            'SELECT label, start_date, end_date, couple_rate FROM rate_seasons WHERE prop_key = ? ORDER BY start_date, id',
        );
        $s->execute([$propKey]);
        return $s->fetchAll();
    } catch (\Throwable $e) {
        return [];
    }
}

// Couple rate that applies on a given night (Y-m-d). First matching season wins
// (inclusive of both start and end dates); otherwise the property's base rate.
function couple_rate_for_night($date, $baseRate, $seasons)
{
    foreach ($seasons as $s) {
        if ($date >= $s['start_date'] && $date <= $s['end_date']) {
            return (float) $s['couple_rate'];
        }
    }
    return (float) $baseRate;
}

// Weekend uplift % that applies on a given night, from a properties row.
// weekend_days is a CSV of day-of-week numbers (0=Sun … 6=Sat); default Fri,Sat.
// MUST mirror weekendPctFor() in app.js exactly (lockstep, guarded by the tests).
function weekend_pct_for_night($date, $rate)
{
    $pct = (float) ($rate['weekend_pct'] ?? 0);
    if ($pct <= 0) {
        return 0.0;
    }
    $days = array_map('intval', array_filter(explode(',', (string) ($rate['weekend_days'] ?? '5,6')), 'strlen'));
    return in_array((int) date('w', strtotime($date)), $days, true) ? $pct : 0.0;
}

// The full nightly rate for a date: season/base, then weekend uplift if applicable.
function nightly_rate_for($date, $rate, $seasons)
{
    $base = couple_rate_for_night($date, $rate['couple_rate'], $seasons);
    $pct = weekend_pct_for_night($date, $rate);
    return $pct > 0 ? $base * (1 + $pct / 100) : $base;
}

// Last-minute discount multiplier: PCT% off the nightly rental when check-in is
// within DAYS days of TODAY (both 0 = off). Returns 1.0 (no discount) otherwise.
// MUST mirror lastMinuteFactor() in app.js exactly (lockstep, guarded by tests).
function last_minute_factor($checkIn, $today, $pct, $days)
{
    $pct = (float) $pct;
    $days = (int) $days;
    if ($pct <= 0 || $days <= 0) {
        return 1.0;
    }
    // Parse both dates at UTC midnight so the day-count is DST-immune and matches
    // app.js's lastMinuteFactor() exactly (it uses `T00:00:00Z`). Using local time
    // here would drift a day across the spring clock change (a 23-hour "day").
    $lead = (int) floor((strtotime($checkIn . ' UTC') - strtotime($today . ' UTC')) / 86400);
    if ($lead < 0 || $lead > $days) {
        return 1.0;
    }
    return 1 - min(90.0, $pct) / 100; // never discount more than 90%
}

// Round to 2dp EXACTLY like the JS engine's Math.round(x*100)/100, on EVERY PHP
// version. PHP's native round() pre-rounds on < 8.4 (8.3 is the production pin),
// so round(28433.4999…) → 28434 while JS Math.round → 28433 — a 1p divergence
// between the stored/charged price (PHP) and the on-screen quote (JS). floor(x+0.5)
// has no pre-rounding step and is bit-identical to Math.round for the non-negative
// money values here. Keep in lockstep with app.js priceBreakdown().
function price_round2($x)
{
    return floor((float) $x * 100 + 0.5) / 100;
}

// $rate is a properties row. Returns the full breakdown.
// $depositOverride: optional per-booking damages deposit (null = use property standard).
// $seasons: optional pre-fetched seasonal rates (null = fetch from DB).
// The refundable damages deposit is NOT income: it is excluded from the
// rental subtotal, the transaction-fee calculation and `total` (RENTAL ONLY).
// It is CHARGED together with the guest's first payment (pay.php) and
// refunded after checkout (bookings.php return_deposit / keep_deposit).
function price_breakdown($rate, $adults, $children, $checkIn, $checkOut, $depositOverride = null, $seasons = null, $today = null)
{
    $today = $today ?: date('Y-m-d');
    $nights = nights_between($checkIn, $checkOut);
    $extraAdults = max(0, (int) $adults - 2);
    $extrasPerNight = $extraAdults * (float) $rate['extra_adult_rate'] + (int) $children * (float) $rate['child_rate'];
    if ($seasons === null) {
        $seasons = get_seasons($rate['prop_key'] ?? '');
    }
    // Sum night-by-night: each night's couple rate can differ by season.
    // NOTE: step by "+N days" (DST-safe), not +86400s — the October clock change
    // has a 25-hour day which would otherwise repeat a date and mis-price.
    $nightly = 0.0;
    for ($i = 0; $i < $nights; $i++) {
        $d = date('Y-m-d', strtotime($checkIn . ' +' . $i . ' days'));
        $nightly += nightly_rate_for($d, $rate, $seasons) + $extrasPerNight;
    }
    // Last-minute discount on the nightly rental (never the damages deposit).
    // price_round2 (below) mirrors JS Math.round(x*100)/100 EXACTLY on every PHP
    // version. round($x, 2) — and even round($x*100)/100 — diverges by 1p from JS
    // at a "just below .xx5" float boundary on PHP < 8.4 (8.3, the production pin),
    // whose round() pre-rounds 28433.4999… up to 28434; $nightly feeds perNight,
    // txFee AND total, so any drift lands the snapshot/charge off the guest's
    // on-screen quote.
    $nightly = price_round2(
        $nightly * last_minute_factor($checkIn, $today, $rate['lastmin_pct'] ?? 0, $rate['lastmin_days'] ?? 0),
    );
    // Average per-night figure (for display and the agreed snapshot) — same
    // JS-identical rounding so the snapshot never drifts off the quote.
    $perNight = $nights > 0 ? price_round2($nightly / $nights) : (float) $rate['couple_rate'] + $extrasPerNight;
    // Damages deposit: per-booking override if given, else the property standard
    // (stored in the booking_fee column, which is repurposed for this).
    $depBase =
        $depositOverride !== null && $depositOverride !== '' ? (float) $depositOverride : (float) $rate['booking_fee'];
    $damagesDeposit = $nights > 0 ? max(0.0, $depBase) : 0.0;
    $txPct = (float) $rate['transaction_pct'];
    // JS-identical rounding (see $perNight note above) — this fee is part of
    // `total`, which is snapshotted/emailed/charged, so a 1p drift from the
    // guest's quote must never happen.
    $txFee = price_round2($nightly * ($txPct / 100)); // income only
    $rentalTotal = $nightly + $txFee; // what the owner earns
    // `total` is RENTAL ONLY. The refundable damages deposit is returned
    // separately as damagesDeposit — pay.php charges it alongside the guest's
    // FIRST payment and it is refunded after checkout, so it never counts as
    // income and never joins this total.
    $total = $rentalTotal;
    return [
        'nights' => $nights,
        'perNight' => $perNight,
        'nightly' => $nightly,
        'damagesDeposit' => round($damagesDeposit, 2),
        'transactionPct' => $txPct,
        'txFee' => $txFee,
        'rentalTotal' => round($rentalTotal, 2),
        'total' => round($total, 2),
        'extraAdults' => $extraAdults,
    ];
}

function get_rate($propKey)
{
    $stmt = db()->prepare('SELECT * FROM properties WHERE prop_key = ?');
    $stmt->execute([$propKey]);
    return $stmt->fetch();
}

// ---- Payment-schedule helpers (Square deposit + balance) ----
// Days-before-check-in window: deposit on approval, balance this many days out,
// and full-amount-upfront if a booking is approved inside the window.
function payment_balance_days()
{
    return defined('PAYMENT_BALANCE_DAYS') && (int) PAYMENT_BALANCE_DAYS > 0 ? (int) PAYMENT_BALANCE_DAYS : 30;
}
// When does THIS booking's balance fall due? The per-booking payment plan
// (migration-103) may name a date; otherwise it is the site standard, check-in
// minus the balance window. Returns 'Y-m-d', or null when there is no check-in
// to anchor on. ONE definition — the window test below, the chaser's SQL and
// the hub's plan panel all describe the same date, and stating it here is what
// lets them agree.
function booking_balance_due_date($b)
{
    if (!empty($b['balance_due_date'])) {
        return substr((string) $b['balance_due_date'], 0, 10);
    }
    if (empty($b['check_in'])) {
        return null;
    }
    return date('Y-m-d', strtotime($b['check_in'] . ' -' . payment_balance_days() . ' days'));
}

// ONE validator for a payment plan's fields, wherever they arrive — the Add
// Booking form and the hub's Edit-plan dialog must refuse the same things in
// the same words. Reads deposit_pct / deposit_amount / balance_due_date off
// $in; refusals json_out in words; returns [$pct, $amt, $due] (nulls = the
// site standard). $total may be 0 when unknown (the cap check then stands down).
function payment_plan_parse(array $in, string $checkIn, float $total): array
{
    $pctIn = trim((string) ($in['deposit_pct'] ?? ''));
    $amtIn = trim((string) ($in['deposit_amount'] ?? ''));
    $dateIn = trim((string) ($in['balance_due_date'] ?? ''));
    if ($pctIn !== '' && $amtIn !== '') {
        json_out(['error' => 'Give the custom deposit as a percentage OR a £ amount, not both.'], 400);
    }
    $pct = null;
    if ($pctIn !== '') {
        $pct = (float) $pctIn;
        if (!($pct > 0 && $pct <= 100)) {
            json_out(['error' => 'The deposit percentage must be between 0 and 100.'], 400);
        }
    }
    $amt = null;
    if ($amtIn !== '') {
        $amt = round((float) $amtIn, 2);
        if ($amt <= 0) {
            json_out(['error' => 'The deposit amount must be more than £0.'], 400);
        }
        if ($total > 0 && $amt > $total + 0.005) {
            json_out(['error' => 'That deposit is more than the stay costs (£' . number_format($total, 2) . ').'], 400);
        }
    }
    $due = null;
    if ($dateIn !== '') {
        $d = DateTime::createFromFormat('Y-m-d', $dateIn);
        if (!$d || $d->format('Y-m-d') !== $dateIn) {
            json_out(['error' => 'The balance due date must be a real date (YYYY-MM-DD).'], 400);
        }
        if ($dateIn < date('Y-m-d')) {
            json_out(['error' => 'That due date has already passed — leave it blank for the standard schedule, or pick a future date.'], 400);
        }
        if ($checkIn !== '' && $dateIn > substr($checkIn, 0, 10)) {
            json_out(['error' => 'The balance must be due by check-in (' . uk_date($checkIn) . ') at the latest.'], 400);
        }
        $due = $dateIn;
    }
    return [$pct, $amt, $due];
}

// A MOVED BOOKING TAKES ITS PLAN WITH IT.
//
// set_payment_plan refuses a due date that is in the past or after check-in —
// but `update` writes check_in and never revisited the plan, so a booking could
// be MOVED INTO the state the validator exists to prevent. Reproduced against
// these functions: a guest arriving five days ago with a due date three weeks
// out reads within_balance_window false, so the app asks a guest standing in
// the cottage for a 25% deposit, and payments-due.php will not chase the
// balance until a fortnight after they have gone home.
//
// The owner's intent when they set "30 September" for an arrival on 1 November
// was the INTERVAL — a month before you come — not that square on the calendar.
// So the date travels with the stay by the same number of days. Shifting
// preserves "due on or before check-in" by construction (old due <= old
// check-in, so old due + delta <= new check-in), and the clamp is defensive
// cover for legacy rows that were already out of shape.
//
// Returns ['due' => 'Y-m-d'|null, 'changed' => bool, 'reason' => string]:
//   'none'    nothing to do — no custom date, or the stay did not move
//   'shifted' the date travelled with the stay
//   'past'    it would now be behind us, so the plan drops to the site standard
//             rather than being silently kept in an impossible state
function booking_replan_on_move($oldCheckIn, $newCheckIn, $customDue, $today = null)
{
    $old = substr((string) $oldCheckIn, 0, 10);
    $new = substr((string) $newCheckIn, 0, 10);
    $due = $customDue === null || $customDue === '' ? null : substr((string) $customDue, 0, 10);
    if ($due === null || $old === '' || $new === '' || $old === $new) {
        return ['due' => $due, 'changed' => false, 'reason' => 'none'];
    }
    $delta = (int) round((strtotime($new) - strtotime($old)) / 86400);
    $moved = date('Y-m-d', strtotime($due . ' ' . ($delta >= 0 ? '+' : '-') . abs($delta) . ' days'));
    if ($moved > $new) {
        $moved = $new; // legacy row that was already past check-in
    }
    $todayStr = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    if ($moved < $todayStr) {
        return ['due' => null, 'changed' => true, 'reason' => 'past'];
    }
    return ['due' => $moved, 'changed' => $moved !== $due, 'reason' => $moved !== $due ? 'shifted' : 'none'];
}

// Is this booking INSIDE the balance window (check-in closer than the window, or
// already begun)? Inside it the FULL amount is due, so a deposit makes no sense:
// the balance would fall due immediately after, and the guest would be asked to
// pay twice in a few days.
//
// ONE DEFINITION, because it was previously inline in exactly one of the places
// that needed it. enquiry-actions.php computed it on approval and asked for the
// full amount correctly; bookings.php's request_payment did NOT — it took `kind`
// from the client, defaulting to 'deposit', so a booking made inside the window
// and paid from the booking hub emailed "Pay your deposit — £X" (25%) even though
// the hub's own banner beside the button read "Nothing received yet — £Y due" with
// the FULL figure. Same expression as enquiry-actions used, kept identical so the
// two paths cannot answer differently.
//
// A CUSTOM due date is "due BY that day" — the window opens ON it (inclusive), so
// the day the owner named is the day the full amount is asked. The STANDARD path
// keeps its original boundary exactly (a booking made precisely 30 days out is
// still asked for a deposit — gated from both sides in test-payrail), which is
// strictly after the derived date; the two comparisons are deliberate, not drift.
function booking_within_balance_window($b)
{
    $due = booking_balance_due_date($b);
    if ($due === null) {
        return false;
    }
    if (!empty($b['balance_due_date'])) {
        return date('Y-m-d') >= $due;
    }
    return date('Y-m-d') > $due;
}

// Has the plan's DEPOSIT stage been settled? Read off the same helper that
// quotes it, so "what is the deposit" is asked once. A booking with no price at
// all is NOT settled — its deposit is 0 and so is what's been paid, which would
// otherwise read as done (pay.php 404s that row anyway, but the arithmetic
// should not be the thing standing between a guest and a wrong screen).
function booking_deposit_settled($b)
{
    $amt = booking_amount_due($b, 'deposit');
    return $amt['total'] > 0 && $amt['due'] <= 0.005;
}

// What a booking should ACTUALLY be asked for. Three routes to 'balance':
//   · inside the balance window, the whole amount is due whatever was asked;
//   · NOBODY STATED A STAGE and the deposit is settled, so what is left to pay
//     IS the balance — this is what lets ONE pay link follow the plan, instead
//     of the link having to name a stage that was true when the email was sent;
//   · 'balance' was asked for explicitly (the Pay-balance buttons, Pay in full).
// 'hold' is the legacy card-authorisation flow and passes through untouched.
//
// $requested === null means "no preference", which a pay LINK now always is.
// An explicit 'deposit' is honoured, and that is deliberate rather than
// leftover: it is what the pay SCREEN posts back at charge time, carrying the
// stage the guest was actually quoted. Deriving freely on both requests would
// let a payment landing between the two (a second device, the owner recording
// cash) silently move the stage, so the card takes the balance off a screen
// that quoted the deposit. The window rule still overrides even that, because
// it cannot fire without the calendar itself having moved.
//
// MONOTONIC BY CONSTRUCTION: every route only ever turns 'deposit' into
// 'balance', and balance-due (total − paid) is always ≥ deposit-due
// (deposit − paid) because the deposit cannot exceed the total. So no link can
// start asking for LESS than it did, at any stage, however old it is.
function booking_payment_kind($b, $requested = null)
{
    if ($requested === 'hold') {
        return 'hold';
    }
    if (booking_within_balance_window($b)) {
        return 'balance';
    }
    if ($requested === null && booking_deposit_settled($b)) {
        return 'balance';
    }
    return $requested === 'balance' ? 'balance' : 'deposit';
}

// Global deposit policy (percentage of the total). Owner-editable in Settings
// (content key 'square-deposit-pct'); defaults to 25%.
function square_deposit_pct()
{
    try {
        $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
        $s->execute(['square-deposit-pct']);
        $r = $s->fetch();
        if ($r) {
            $v = (float) json_decode($r['item_value'], true);
            if ($v > 0 && $v <= 100) {
                return $v;
            }
        }
    } catch (\Throwable $e) {
    }
    return 25.0;
}
// THE deposit figure for one booking, given its rental total. The per-booking
// plan wins: a fixed £ override first (capped at the total — a deposit larger
// than the stay is a typo, not a plan), then a per-booking percentage, then the
// site-wide square_deposit_pct(). Zero/blank overrides mean "not set", never
// "0% deposit" — waiving the deposit is what the balance-window upgrade already
// does honestly, and a silent £0 ask would read as settled. Every caller that
// asks "what deposit?" goes through here (booking_amount_due, pay.php's
// under-lock recompute), so the email, the pay screen and the charge cannot
// quote three different shares of the same stay.
function booking_deposit_amount($b, $total)
{
    $amt = isset($b['deposit_amount_override']) && $b['deposit_amount_override'] !== null && $b['deposit_amount_override'] !== '' ? (float) $b['deposit_amount_override'] : 0.0;
    if ($amt > 0) {
        return round(min($amt, (float) $total), 2);
    }
    $pct = isset($b['deposit_pct_override']) && $b['deposit_pct_override'] !== null && $b['deposit_pct_override'] !== '' ? (float) $b['deposit_pct_override'] : 0.0;
    if ($pct > 0 && $pct <= 100) {
        return round((float) $total * ($pct / 100), 2);
    }
    return round((float) $total * (square_deposit_pct() / 100), 2);
}

// ============================================================
//  AUTOPAY — governed by one rule: THE APP NEVER TAKES MONEY IT WAS NOT GIVEN
//  PERMISSION TO TAKE.
//
//  A stored card is NOT permission. Square can keep the card the guest paid
//  their deposit with; that records that they paid once, not that they agreed
//  to be charged again. Permission is a separate recorded fact — and it is
//  permission for A SUM ON A DATE, never a standing licence.
//
//  booking_autopay_state() is the ONE place that decides, written so that every
//  answer except 'armed' behaves exactly as the app did before autopay existed.
//  That is the safety property: absent an explicit, current, matching agreement,
//  nothing is taken and the owner asks as they always did.
//
//  Returns [state, why] where `why` is a sentence fit to show a person:
//    off      never agreed — the default for every booking that already exists
//    revoked  agreed, then switched it off
//    stale    agreed, but the SUM or the DATE has moved since; the agreement
//             does not cover what would now be charged, so it must be re-asked
//    nocard   agreed, but no saved card to charge
//    settled  agreed, but there is nothing left to collect
//    armed    agreed, current, matching, with a card and a sum — the ONLY state
//             in which a charge may be made
// How many goes the collector gets before it stops and hands back to the ordinary
// chase. Three: enough to ride out a temporary failure, few enough that a card
// which is genuinely refusing is not presented over and over.
const AUTOPAY_MAX_TRIES = 3;

function booking_autopay_state($b, $today = null)
{
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    if (empty($b['autopay_consent_at'])) {
        return ['off', 'Not set up — the balance is collected the usual way.'];
    }
    if (!empty($b['autopay_revoked_at'])) {
        return ['revoked', 'Automatic payment was switched off.'];
    }
    if (empty($b['autopay_card_id'])) {
        return ['nocard', 'No saved card to charge — ask for the balance as usual.'];
    }
    // GIVEN UP. A card that has been tried AUTOPAY_MAX_TRIES times and not paid
    // is not going to pay on the next tick either, and the only retry policy
    // available without a counter is "for ever" — which on a declined card is
    // how a guest collects bank fees. Consent is deliberately NOT cleared: they
    // did agree, and 'revoked' has to keep meaning "they changed their mind".
    if ((int) ($b['autopay_attempts'] ?? 0) >= AUTOPAY_MAX_TRIES) {
        return [
            'failed',
            'Automatic payment didn\'t go through' .
                (!empty($b['autopay_last_error']) ? ' — ' . $b['autopay_last_error'] : '') .
                ' Ask for the balance as usual.',
        ];
    }
    // WHAT IS OWED NOW. The stage is derived with no hint, exactly as a pay link
    // is, so this asks the same question the guest's own link would ask today.
    $kind = booking_payment_kind($b);
    $amt = booking_amount_due($b, $kind === 'hold' ? 'deposit' : $kind);
    $charge = round($amt['due'] + booking_damages_due($b), 2);
    if ($charge <= 0.005) {
        return ['settled', 'Nothing left to collect.'];
    }
    // THE TERMS MUST STILL MATCH. A plan the owner edited, or a price that
    // moved, means the figure or the day is no longer the one the guest saw when
    // they agreed — and consent does not stretch to cover it.
    $agreedAmt = round((float) ($b['autopay_amount'] ?? 0), 2);
    $agreedDue = substr((string) ($b['autopay_due'] ?? ''), 0, 10);
    $dueNow = (string) booking_balance_due_date($b);
    if ($agreedDue === '' || $dueNow === '' || $agreedDue !== $dueNow) {
        return ['stale', 'The due date has changed since they agreed — ask them again.'];
    }
    // A MONTHLY plan's consent is the SCHEDULE — n collections of at most the
    // agreed ceiling, final by the agreed day. The single-collection equality
    // test is wrong for it twice over: a mid-plan remainder never equals the
    // ceiling, and a guest who pays some by hand SHRINKS what is left, which
    // must never stand the plan down. What does: the owner raising the price
    // until the remaining collections can no longer cover what is owed — the
    // guest agreed a total, and charging past it needs asking again.
    $n = (int) ($b['autopay_instalments'] ?? 0);
    if ($n > 1) {
        $next = substr((string) ($b['autopay_next_at'] ?? ''), 0, 10);
        // An empty NEXT date means the plan is COMPLETE — zero collections left,
        // not n. Counting all n here re-armed a finished plan the instant the
        // owner raised the price before check-in (an added night, a pet fee):
        // charge > 0 so not 'settled', the due date unchanged so not date-stale,
        // and left = n made the top-up look covered — so the collector charged
        // the stored card an amount the guest never agreed to. next '' → left 0
        // → stale → ask again, matching what the single-collection branch below
        // already does for the same edit.
        $left = 0;
        if ($next !== '') {
            foreach (booking_instalment_schedule($agreedDue, $n) as $d) {
                if ($d >= $next) {
                    $left++;
                }
            }
        }
        if ($left <= 0 || $charge > $agreedAmt * $left + 0.01) {
            return ['stale', 'The plan no longer covers what is owed — ask them again.'];
        }
        return ['armed', 'Scheduled — £' . number_format($agreedAmt, 2) . ' monthly, next on ' . uk_date($next !== '' ? $next : $agreedDue) . '.'];
    }
    if (abs($charge - $agreedAmt) > 0.005) {
        return ['stale', 'The amount has changed since they agreed — ask them again.'];
    }
    return ['armed', 'Scheduled — £' . number_format($charge, 2) . ' on ' . uk_date($agreedDue) . '.'];
}

// May a charge be taken RIGHT NOW, with nobody pressing anything? Only when
// armed AND the agreed day has arrived. Split from the state so a screen can say
// "scheduled" long before this is true, and so the collector has exactly one
// question to ask. Deliberately `>=`: a pass that fails on the due date must
// still collect the next day rather than skip the payment altogether — the same
// reasoning watchers_due uses.
function booking_autopay_may_charge($b, $today = null)
{
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    $state = booking_autopay_state($b, $today);
    if ($state[0] !== 'armed') {
        return false;
    }
    // A monthly plan charges on its NEXT scheduled date; a single collection
    // keeps keying on the due date exactly as it always did.
    $gate = substr((string) ($b['autopay_next_at'] ?? ''), 0, 10);
    if ($gate === '') {
        $gate = substr((string) ($b['autopay_due'] ?? ''), 0, 10);
    }
    return $gate !== '' && $today >= $gate;
}

// What the guest would be agreeing TO, at the moment they are asked. Recorded
// verbatim on consent so booking_autopay_state can later tell whether the terms
// still hold. Derived the same way the pay screen quotes them, so the checkbox
// can never promise a different figure from the one printed above it.
// Returns null when there is nothing to schedule — and the checkbox must not be
// offered at all then, rather than offered and quietly doing nothing.
function booking_autopay_terms($b, $instalments = 1, $kindHint = null)
{
    // The stage the SCREEN resolved wins when it is given. Deriving it here instead
    // answered a different question than the one being asked: on "rather settle the
    // whole stay now" the screen is charging the BALANCE while this helper, reading
    // the not-yet-paid row, still said 'deposit' — so the screen offered to schedule
    // the very money it was collecting, and paying left a vaulted card and a consent
    // against a settled stay (harmless until a later partial refund re-armed it).
    $kind = $kindHint !== null && $kindHint !== '' ? $kindHint : booking_payment_kind($b);
    // Only a BALANCE is ever scheduled. The legacy authorise-only hold is not a
    // schedule, and asking someone to agree to be charged the deposit they are
    // in the middle of paying is nonsense.
    if ($kind !== 'deposit') {
        return null;
    }
    $due = booking_balance_due_date($b);
    if ($due === null) {
        return null;
    }
    // MONTHLY terms come from the offer, and ONLY when the requested count is
    // the count the offer derives — the client picks from what it was shown,
    // and anything else vaults nothing rather than guessing a consent the
    // guest never saw. `amount` is the agreed PER-INSTALMENT ceiling.
    if ((int) $instalments > 1) {
        $offer = booking_instalment_offer($b);
        if (!$offer || (int) $offer['n'] !== (int) $instalments) {
            return null;
        }
        return ['amount' => $offer['per'], 'due' => $offer['due'], 'instalments' => $offer['n'], 'next' => $offer['dates'][0]];
    }
    $amt = booking_amount_due($b, 'deposit');
    // What is left AFTER the payment being made right now — plus nothing else:
    // the refundable deposit rides this first payment, so it is not owed later.
    $rest = round(max(0, $amt['total'] - $amt['alreadyPaid'] - $amt['due']), 2);
    return $rest > 0.005 ? ['amount' => $rest, 'due' => $due] : null;
}

// ---- MONTHLY INSTALMENTS ----------------------------------------------------
// The floor an instalment may not go under (scheduling £12 charges helps
// nobody), the most collections a plan may hold, and the clearance the FIRST
// collection needs from today — room for the 3-day advance notice plus a
// working day either side.
const AUTOPAY_INSTALMENT_MIN = 50.0;
const AUTOPAY_INSTALMENTS_MAX = 4;
const AUTOPAY_FIRST_GAP_DAYS = 7;

// A calendar-month step with the day CLAMPED into the target month (31 Jan + 1
// month = 28/29 Feb, never 2/3 Mar). Pure date-part arithmetic — no time
// component, so there is no DST hour to trip over.
function ukShiftMonthsPhp($iso, $months)
{
    $p = explode('-', substr((string) $iso, 0, 10));
    if (count($p) !== 3) {
        return (string) $iso;
    }
    [$y, $m, $d] = [(int) $p[0], (int) $p[1], (int) $p[2]];
    $m0 = $m - 1 + (int) $months;
    $y += intdiv($m0, 12);
    $m = ($m0 % 12) + 1;
    if ($m < 1) {
        $m += 12;
        $y -= 1;
    }
    $last = (int) date('t', mktime(12, 0, 0, $m, 1, $y));
    return sprintf('%04d-%02d-%02d', $y, $m, min($d, $last));
}

// THE OWNER'S FLOOR under the monthly offer (content key
// 'instalment-floor-months', Manage → Payments): monthly instalments are only
// OFFERED while the balance due date is at least this many months away.
// 0/absent/garbage = no floor — offered whenever a plan fits, the behaviour
// before the setting existed. Read like square_deposit_pct (a direct content
// query under try/catch, so a stubbed or unreadable table degrades to the
// default rather than throwing inside a price calculation).
function instalment_floor_months()
{
    try {
        $s = db()->prepare('SELECT item_value FROM content WHERE item_key = ?');
        $s->execute(['instalment-floor-months']);
        $r = $s->fetch();
        if ($r) {
            $v = (int) json_decode((string) $r['item_value'], true);
            if ($v >= 1 && $v <= 6) {
                return $v;
            }
        }
    } catch (\Throwable $e) {
    }
    return 0;
}

// The schedule is ANCHORED ON THE DUE DATE and steps back a month at a time —
// the final collection always lands on the day the balance was always due, so
// instalments can never push money later than the plan the owner set.
function booking_instalment_schedule($due, $n)
{
    $dates = [];
    for ($i = (int) $n - 1; $i >= 0; $i--) {
        $dates[] = ukShiftMonthsPhp($due, -$i);
    }
    return $dates;
}

// THE ONE DERIVATION of what monthly collection this booking could be offered —
// read by the pay screen that shows it, the charge that validates the guest's
// pick, and the owner's Edit-plan preview, so the three can never disagree.
// Returns null (no offer) or ['n','per','last','due','dates'] where `per` is
// the per-instalment ceiling (rest ÷ n, rounded UP to the penny) and `last` is
// the final collection's figure — per × (n−1) + last = rest exactly.
// Constraints, largest workable n wins: the owner's autopay_offer (0 = never,
// 2..4 = at most that many, NULL = automatic), every instalment ≥ the £50
// floor, and the first collection ≥ 7 days out so its notice can precede it.
function booking_instalment_offer($b, $today = null)
{
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    $ownerSay = $b['autopay_offer'] ?? null;
    if ($ownerSay !== null && (int) $ownerSay === 0) {
        return null;
    }
    $base = booking_autopay_terms($b); // the single-collection terms gate eligibility
    if (!$base) {
        return null;
    }
    $due = $base['due'];
    $rest = (float) $base['amount'];
    // The owner's floor: with less than N months of runway before the due
    // date, monthly is not offered at all — even where a 2-payment plan would
    // still physically fit. Inclusive boundary: due exactly N months out IS
    // offered ("at least"). Gating here gates everything — the pay screen's
    // summary reads this offer, and booking_autopay_terms routes back through
    // it for n > 1, so a consent posted from a stale tab inside the floor is
    // refused where it would be RECORDED, not just hidden. A plan already
    // agreed is untouched: the collector reads the stored consent, never this.
    $floorM = instalment_floor_months();
    if ($floorM > 0 && $due < ukShiftMonthsPhp($today, $floorM)) {
        return null;
    }
    $maxN = $ownerSay !== null ? min((int) $ownerSay, AUTOPAY_INSTALMENTS_MAX) : AUTOPAY_INSTALMENTS_MAX;
    for ($n = $maxN; $n >= 2; $n--) {
        $per = ceil(($rest / $n) * 100) / 100;
        $dates = booking_instalment_schedule($due, $n);
        $first = $dates[0];
        if ($per < AUTOPAY_INSTALMENT_MIN) {
            continue;
        }
        // NB day-shift via strtotime on a date-only string — the same shape
        // booking_balance_due_date uses; ukShiftDaysPhp lives in autopay-lib,
        // which is not loaded everywhere pricing.php is.
        if ($first < date('Y-m-d', strtotime($today . ' +' . AUTOPAY_FIRST_GAP_DAYS . ' days'))) {
            continue;
        }
        $last = round($rest - $per * ($n - 1), 2);
        if ($last <= 0.005) {
            continue; // over-rounded away — a schedule whose final collects nothing is not n instalments
        }
        return ['n' => $n, 'per' => $per, 'last' => $last, 'due' => $due, 'dates' => $dates];
    }
    return null;
}

// What THIS collection may take, decided in one place for the state machine,
// the collector and the tests. For a monthly plan: the agreed per-instalment
// ceiling — or whatever remains once the FINAL date has arrived, so the plan
// always completes by the day the guest agreed. Either way it is capped by
// what is actually owed: a guest who pays some by hand shrinks the next
// collection (we may take less than agreed, never more). Instalments collect
// the RENTAL only — the refundable deposit rode the first payment, and on the
// rare row where it did not, bundling it onto an instalment would make the sum
// not the one the guest agreed.
function booking_autopay_collect_amount($b, $today = null)
{
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    $kind = booking_payment_kind($b);
    $amt = booking_amount_due($b, $kind === 'hold' ? 'deposit' : $kind);
    $n = (int) ($b['autopay_instalments'] ?? 0);
    if ($n > 1) {
        $rest = round(max(0, (float) $amt['due']), 2);
        $per = round((float) ($b['autopay_amount'] ?? 0), 2);
        $due = substr((string) ($b['autopay_due'] ?? ''), 0, 10);
        $final = $due !== '' && $today >= $due;
        return ['charge' => $final ? $rest : round(min($rest, $per), 2), 'rental' => $final ? $rest : round(min($rest, $per), 2), 'damages' => 0.0, 'final' => $final];
    }
    $damages = booking_damages_due($b);
    $charge = round($amt['due'] + $damages, 2);
    return ['charge' => $charge, 'rental' => round((float) $amt['due'], 2), 'damages' => $damages, 'final' => true];
}

// After a successful collection: the next schedule date STRICTLY AFTER the one
// just collected, or null when the plan is done. Derived from the same schedule
// the offer showed, so advancing can never invent a date the guest was not shown.
function booking_autopay_next_after($b, $collectedOn)
{
    $n = (int) ($b['autopay_instalments'] ?? 0);
    if ($n <= 1) {
        return null;
    }
    $due = substr((string) ($b['autopay_due'] ?? ''), 0, 10);
    if ($due === '') {
        return null;
    }
    foreach (booking_instalment_schedule($due, $n) as $d) {
        if ($d > substr((string) $collectedOn, 0, 10)) {
            return $d;
        }
    }
    return null;
}

// The booking's refundable damages deposit, WHATEVER its state — the frozen
// snapshot, falling back to a live calc ONLY for a legacy row with no snapshot at
// all. A modern row carrying a deliberately-waived £0 deposit must be honoured as
// £0, not second-guessed into the property standard.
function booking_damages_amount($b, $rate = null)
{
    if (($b['agreed_total'] ?? null) === null) {
        $r = $rate !== null ? $rate : get_rate($b['prop_key']);
        if ($r) {
            $pp = price_breakdown($r, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
            return round((float) $pp['damagesDeposit'], 2);
        }
    }
    return round((float) ($b['agreed_booking_fee'] ?? 0), 2);
}

// …and how much of it rides the NEXT payment: all of it, or nothing once it has
// been taken. Charged ONCE, with the guest's first rental payment, so there is
// nothing left to take the moment hold_status leaves 'none'. Both of these were
// inline in pay.php and moved here so the screen that CHARGES the deposit and the
// account that ANNOUNCES the charge cannot disagree about what the card will take.
function booking_damages_due($b, $rate = null)
{
    return ($b['hold_status'] ?? 'none') === 'none' ? booking_damages_amount($b, $rate) : 0.0;
}

// WHAT THE CARD WILL TAKE NEXT, and what to call it — one derivation for every
// surface that offers to take a payment. The stage comes from
// booking_payment_kind with NO hint, so the plan decides; `due` is the rental
// portion for that stage and `damages` the refundable deposit riding it, which
// pay.php bundles into the same charge. `charge` is what actually leaves the
// card, and is therefore the only honest figure for a button's label.
function booking_next_payment($b, $rate = null)
{
    $kind = booking_payment_kind($b);
    $amt = booking_amount_due($b, $kind);
    $dam = booking_damages_due($b, $rate);
    return [
        'kind' => $kind,
        'due' => $amt['due'],
        'damages' => $dam,
        'charge' => round($amt['due'] + $dam, 2),
    ];
}

// Effective total + amount due for a kind ('deposit'|'balance'), server-authoritative.
// 'balance' = everything still outstanding; 'deposit' = the deposit % minus anything paid.
// DOES THIS BOOKING CARRY A PRICE OF ITS OWN?
//
// The rate-card fallback below exists for LEGACY PRE-SNAPSHOT rows, where
// agreed_total is NULL and there is genuinely no price to read — bookings.php
// says so in its own copy of this guard. What it must never do is treat a
// recorded price of ZERO as "no price yet", because zero IS a price: it is how
// an owner comps a stay.
//
// Measured before the fix: a booking with price_override = 0 was quoted £910 by
// booking_amount_due — the full rate card — while booking_rental_price said
// £0.00 for the same stay. pay.php derives its charge from the first, so the
// guest would have been asked for, and charged, the whole price of a stay the
// owner had given away. Two definitions, disagreeing by the entire value.
//
// One predicate now, used by all three sites that fall back (this one,
// square-webhook.php, and bookings.php — which already had the distinction and
// was the outlier that revealed the other two were missing it).
// ---- PAYING PART OF IT --------------------------------------------------
// A guest who can manage £200 now and the rest next week had only "all" or
// "nothing", so they paid nothing and got chased. The floor exists because a
// card fee makes a tiny payment mostly cost: below this it is worth more to
// everyone to wait. Capped at the amount owed, so a balance under the floor is
// simply paid in full rather than being refused for being too small.
const PART_PAYMENT_MIN = 20.0;

// The bounds, stated once, so the screen that OFFERS a part payment and the
// charge that CLAMPS one cannot disagree about what is allowed.
// Returns null when a part payment makes no sense — there is nothing owed, or
// what is owed is at or under the floor and should just be paid.
function booking_part_bounds($amountDue)
{
    $due = round((float) $amountDue, 2);
    if ($due <= PART_PAYMENT_MIN + 0.005) {
        return null;
    }
    return ['min' => PART_PAYMENT_MIN, 'max' => $due];
}

// What a REQUESTED part payment actually charges. The client may ask; the
// server decides — the same rule as every other figure on this path. An amount
// outside the bounds is clamped rather than refused, because a guest who typed
// £5 or £5000 meant "some of it" either way and a refusal at the last step is
// the experience this feature exists to remove.
function booking_part_amount($requested, $amountDue)
{
    $b = booking_part_bounds($amountDue);
    if (!$b) {
        return null; // no part payment available — charge the stage as usual
    }
    $r = round((float) $requested, 2);
    if ($r <= 0) {
        return null;
    }
    return max($b['min'], min($b['max'], $r));
}

function booking_has_price($b)
{
    $o = $b['price_override'] ?? null;
    $a = $b['agreed_total'] ?? null;
    return ($o !== null && $o !== '') || ($a !== null && $a !== '');
}

function booking_amount_due($b, $kind)
{
    $total =
        $b['agreed_total'] !== null
            ? ($b['price_override'] !== null
                ? (float) $b['price_override']
                : (float) $b['agreed_total'])
            : 0.0;
    // A price_override of 0 leaves agreed_total 0 too (the add/update paths copy
    // it across), so the guard has to ask the PREDICATE rather than the figure.
    if ($total <= 0 && !booking_has_price($b)) {
        $rate = get_rate($b['prop_key']);
        if ($rate) {
            $p = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
            $total = $p['total'];
        }
    }
    $total = round($total, 2);
    // The shared definition — see booking_paid_so_far(). Reading deposit_paid alone
    // here asked the guest for more than the card would take whenever the ledger was
    // ahead of the reconciled figure.
    $alreadyPaid = booking_paid_so_far($b);
    $depositAmount = booking_deposit_amount($b, $total);
    $due = $kind === 'balance' ? max(0, $total - $alreadyPaid) : max(0, $depositAmount - $alreadyPaid);
    return ['total' => $total, 'alreadyPaid' => $alreadyPaid, 'due' => round($due, 2)];
}

// The price a CONFIRMED booking shows anywhere a guest can see it (emails,
// previews): the LOCKED agreed snapshot (honouring a manual price override),
// falling back to a live calculation only for legacy pre-snapshot rows.
// Same shape as price_breakdown() so consumers can swap it in directly.
function booking_price($rate, $b)
{
    if (isset($b['agreed_total']) && $b['agreed_total'] !== null) {
        $total =
            isset($b['price_override']) && $b['price_override'] !== null && $b['price_override'] !== ''
                ? (float) $b['price_override']
                : (float) $b['agreed_total'];
        return [
            'total' => $total,
            'perNight' => (float) $b['agreed_per_night'],
            'nights' => (int) $b['agreed_nights'],
            'nightly' => (float) $b['agreed_nightly'],
            'damagesDeposit' => (float) $b['agreed_booking_fee'],
            'transactionPct' => (float) $b['agreed_txn_pct'],
            'txFee' => (float) $b['agreed_txn_fee'],
            'agreed' => true,
        ];
    }
    if (!$rate) {
        return null;
    }
    return price_breakdown($rate, (int) $b['adults'], (int) $b['children'], $b['check_in'], $b['check_out']);
}
