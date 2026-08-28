<?php
// ============================================================
//  my-bookings.php — the logged-in guest's own bookings.
//  GET -> bookings whose email matches the logged-in guest, plus
//         the property address for each (for display + invoice).
//  GET ?acctpreview=<bookingId> -> ADMIN-only: the SAME payload for the
//         customer who owns that booking, so the owner can view a
//         customer's account read-only in a sandboxed preview. The
//         login-free action tokens (pay / guest-details) are stripped —
//         a preview can look but never act.
// ============================================================
require_once __DIR__ . '/db.php';
// booking_balance_due_date — the guest's account states WHEN the balance is due,
// the same derivation the pay screen and the owner's plan panel use.
require_once __DIR__ . '/pricing.php';

// Build the account payload for a given email. `$preview` strips the login-free
// action tokens so an admin preview is look-only. Keyed on the email so it serves
// both the signed-in guest (their own) and an admin preview (a target customer).
function my_bookings_payload(string $email, bool $preview = false): array
{
    // PLAIN EQUALITY, DELIBERATELY — do not "fix" this back to LOWER(b.email) =
    // LOWER(?). `bookings.email` collates utf8mb4_general_ci (stated outright by
    // migration-112, not inherited), so `=` already matches any case; wrapping the
    // column in a function only makes idx_email unusable. Measured on 5,036 rows:
    // ref/idx_email/1 row against index-scan/no key/5,036 — on the query that runs
    // every time a guest opens their stays. test-integration §21 asserts both the
    // collation and the plan, so the assumption fails loudly if a host differs.
    $stmt = db()->prepare(
        'SELECT b.*, p.name AS property_name, p.address AS property_address
         FROM bookings b JOIN properties p ON p.prop_key = b.prop_key
         WHERE b.email = ?
         ORDER BY b.check_in ASC',
    );
    $stmt->execute([$email]);
    $bookings = $stmt->fetchAll();

    $name = '';
    foreach ($bookings as $bk) {
        if (!empty($bk['name'])) {
            $name = $bk['name'];
            break;
        }
    }

    // How much of each booking's refundable damages deposit has been refunded to
    // the guest (sum of 'damages_return' ledger rows).
    $ids = array_map(fn($b) => (int) $b['id'], $bookings);
    $returnedByBooking = [];
    try {
        if ($ids) {
            // The SHARED figure — this used to count every damages_return row whatever
            // its status, so a refund that FAILED showed the guest money back they had
            // never received.
            $returnedByBooking = damages_returned_map($ids);
        }
    } catch (\Throwable $e) {
    }

    // Attach a login-free pay token + guest-registration link to each booking (so
    // the guest can pay a balance / add details straight from My Stays) — UNLESS
    // this is a read-only admin preview, where those actionable tokens are stripped.
    $sqOn = square_enabled();
    // THE DOOR CODE, released only by the owner's own confirm. keysafe.php's
    // record says what the safe is PHYSICALLY set to and which booking it was
    // set FOR; a stay is shown the code only when both match AND arrival is
    // near (keysafe_reveal_window — from 2 days out through check-out). Never
    // emailed: this reveal is what the arrival email's "your entry details
    // appear on your booking page" sentence points at. One decrypt per
    // cottage per request; a failed decrypt degrades to "no code".
    require_once __DIR__ . '/keysafe-lib.php';
    $ksToday = date('Y-m-d');
    $ksByProp = [];
    $ksFor = function ($pk) use (&$ksByProp) {
        if (!array_key_exists($pk, $ksByProp)) {
            $ksByProp[$pk] = keysafe_read(content_secret_json('keysafe-' . $pk, null));
        }
        return $ksByProp[$pk];
    };
    foreach ($bookings as &$bk) {
        // THE STAFF NOTE IS NOT THE GUEST'S TO READ. This payload is built with
        // `SELECT b.*` and handed straight to json_out, so `bookings.notes` — the
        // field the hub calls "Add a private note — only you see it" — was shipped
        // verbatim to the guest whose booking it is, visible in DevTools. Whatever
        // the owner wrote about them ("left it filthy last year", "friends rate")
        // went with it. Stripped here rather than narrowing the SELECT, because
        // every other consumer of that row is owner-side and still needs it.
        unset($bk['notes']);
        $bk['pay_token'] = ($preview || !$sqOn) ? null : pay_token((int) $bk['id']);
        $ks = $ksFor($bk['prop_key']);
        // The cottage's on/off switch gates the reveal too — a keeper the
        // owner turned off must not go on serving codes it no longer tracks.
        $ksMine = $ks['enabled'] && $ks['code'] !== '' && (int) $ks['forBooking'] === (int) $bk['id'];
        $bk['door_code'] = $ksMine && keysafe_reveal_window($bk['check_in'], $bk['check_out'], $ksToday)
            ? $ks['code']
            : null;
        // The date the code will appear, so the pre-arrival card can say so —
        // only once a confirmed code exists for THIS stay (never a promise the
        // owner hasn't yet made good on).
        $bk['door_code_from'] = $ksMine && $bk['door_code'] === null && $bk['check_in'] >= $ksToday
            ? date('Y-m-d', strtotime($bk['check_in'] . ' 12:00:00 UTC') - KEYSAFE_REVEAL_DAYS * 86400)
            : null;
        // THE HELD-BACK STATE — the keeper is ON for this cottage but no code is
        // confirmed for THIS stay yet, so the guest page may say a code is coming
        // WITHOUT a date (the dated promise stays door_code_from's, minted only by
        // a real confirm). Keeper OFF sends nothing at all: the cottage may have
        // no safe, and a held-back card would assert one.
        $bk['door_code_pending'] = $ks['enabled'] && !$ksMine && $bk['check_in'] >= $ksToday;
        $bk['damages_returned'] = $returnedByBooking[(int) $bk['id']] ?? 0;
        // WHEN the balance is due, DERIVED — deliberately its own field, not the
        // raw `balance_due_date` column beside it. That column is the per-booking
        // OVERRIDE and NULL means "site standard", which is exactly what the owner
        // side reads it for (bookingPlanDueDate, the custom-plan filter, the edit
        // form's "pick a different day to make it custom" hint). Writing a derived
        // date into it would make every booking look like it carries a custom plan.
        $bk['balance_due_by'] = booking_balance_due_date($bk);
        // WHAT THE CARD WOULD TAKE NEXT, and what to call it — the SAME derivation
        // pay.php makes when the guest arrives there. The account's Pay buttons
        // used to hardcode 'balance' and label themselves with the whole
        // outstanding sum, so a guest on a 25% plan standing 60 days out was
        // offered the entire stay: the emailed link followed the plan and the
        // button in their account did not. Sent per booking so the label and the
        // charge come from one place; the button still states no stage of its own.
        $bk['next_payment'] = booking_next_payment($bk);
        // WHETHER ANYTHING IS GOING TO HAPPEN BY ITSELF. A standing permission
        // to charge a card must be visible to the person who gave it, on their
        // own screen — and it is the state, not the raw columns, because the
        // state is the only thing that knows whether it still holds.
        $ap = booking_autopay_state($bk);
        $bk['autopay_state'] = $ap[0];
        $bk['autopay_says'] = $ap[1];
        // A MONTHLY plan is shown as the schedule the guest agreed to, with live
        // states — done / next / still to come — and figures that SUM to what is
        // actually left (the final row absorbs any manual payments), so the card
        // can never promise money the ledger disagrees with.
        $apN = (int) ($bk['autopay_instalments'] ?? 0);
        // A plan in TROUBLE still renders — 'failed' (stopped at the try cap)
        // and armed-with-failed-tries both carry the schedule plus why and what
        // happens next, because a plan that silently vanishes from the guest's
        // own screen the moment it needs them is the worst version of this
        // card. 'revoked' stays hidden: they turned it off on purpose.
        if (in_array($ap[0], ['armed', 'failed'], true) && $apN > 1 && !empty($bk['autopay_due'])) {
            $apDue = substr((string) $bk['autopay_due'], 0, 10);
            $apNext = substr((string) ($bk['autopay_next_at'] ?? ''), 0, 10);
            $apKind = booking_payment_kind($bk);
            $apAmt = booking_amount_due($bk, $apKind === 'hold' ? 'deposit' : $apKind);
            $apRest = round(max(0, (float) $apAmt['due']), 2);
            $apPer = round((float) ($bk['autopay_amount'] ?? 0), 2);
            $apDates = [];
            foreach (booking_instalment_schedule($apDue, $apN) as $d) {
                $st = $apNext === '' ? 'done' : ($d < $apNext ? 'done' : ($d === $apNext ? 'next' : 'todo'));
                $apDates[] = ['date' => $d, 'state' => $st, 'fig' => $apPer];
            }
            // EACH remaining row shows what the collector will actually TAKE —
            // min(per, running remainder) — not the agreed ceiling. The old code
            // put the whole shrink on the FINAL row only, so after a manual
            // part-payment the NEXT row still announced the full £per while the
            // collector (min(rest, per)) would take less: a card promising £150
            // when £60 is owed is the alarm this card exists to avoid. Walking
            // the not-done rows in order keeps the rows summing to $apRest AND
            // makes the "next" figure the one that will really be charged.
            $apRun = $apRest;
            foreach ($apDates as &$apRow) {
                if ($apRow['state'] === 'done') {
                    continue;
                }
                $apTake = round(min($apPer, max(0, $apRun)), 2);
                $apRow['fig'] = $apTake;
                $apRun = round($apRun - $apTake, 2);
            }
            unset($apRow);
            $apPlan = ['n' => $apN, 'per' => $apPer, 'toGo' => $apRest, 'next' => $apNext, 'dates' => $apDates];
            // The plan's own weather: 'on' (nothing wrong), 'retrying' (a try
            // failed, more to come — the collector's cadence names the day) or
            // 'stopped' (the try cap). why is autopay_square_why's prose.
            $apAtt = (int) ($bk['autopay_attempts'] ?? 0);
            $apPlan['state'] = $ap[0] === 'failed' ? 'stopped' : ($apAtt > 0 ? 'retrying' : 'on');
            if ($apAtt > 0) {
                $apPlan['why'] = (string) ($bk['autopay_last_error'] ?? '');
                $apLastTry = substr((string) ($bk['autopay_last_try'] ?? ''), 0, 10);
                if ($apPlan['state'] === 'retrying' && $apLastTry !== '') {
                    $apRetryDays = defined('AUTOPAY_RETRY_DAYS') ? AUTOPAY_RETRY_DAYS : 1;
                    $apPlan['retry'] = date('Y-m-d', strtotime($apLastTry . ' +' . $apRetryDays . ' days'));
                }
            }
            $bk['autopay_plan'] = $apPlan;
        }
        // A SINGLE "one payment" consent in trouble has no schedule block, but it
        // must not read as healthy — the failure email sends the guest here, and
        // without this a retrying single collection showed the green "on the way"
        // line and a stopped one fell to "balance due" + a bare Pay button, as
        // though nothing had ever been arranged. A lightweight descriptor drives
        // the same warn line + repair route the monthly block carries. Only for
        // n <= 1 (the monthly plan block already owns the n > 1 case) and only
        // when a try has actually failed.
        $bk['autopay_trouble'] = null;
        $apAtt1 = (int) ($bk['autopay_attempts'] ?? 0);
        if (in_array($ap[0], ['armed', 'failed'], true) && $apN <= 1 && $apAtt1 > 0) {
            $apK1 = booking_payment_kind($bk);
            $apA1 = booking_amount_due($bk, $apK1 === 'hold' ? 'deposit' : $apK1);
            $tr = [
                'state' => $ap[0] === 'failed' ? 'stopped' : 'retrying',
                'why' => (string) ($bk['autopay_last_error'] ?? ''),
                'fig' => round((float) $apA1['due'] + booking_damages_due($bk), 2),
            ];
            $apLastTry1 = substr((string) ($bk['autopay_last_try'] ?? ''), 0, 10);
            if ($tr['state'] === 'retrying' && $apLastTry1 !== '') {
                $apRetryDays1 = defined('AUTOPAY_RETRY_DAYS') ? AUTOPAY_RETRY_DAYS : 1;
                $tr['retry'] = date('Y-m-d', strtotime($apLastTry1 . ' +' . $apRetryDays1 . ' days'));
            }
            $bk['autopay_trouble'] = $tr;
        }
        // The token URL is login-free (guest-details.php verifies the HMAC), so a
        // preview must NOT carry it. Never carries the PII itself — only whether
        // it's been submitted.
        $bk['reg_url'] = $preview
            ? ''
            : site_base_url() . 'guest-details.php?b=' . (int) $bk['id'] . '&token=' . guest_reg_token((int) $bk['id']);
        $bk['reg_submitted'] = false;
    }
    unset($bk);

    // Which bookings have had their party details submitted (one grouped query;
    // robust to the guest_registrations table not existing pre-migration).
    if ($ids) {
        try {
            $ph2 = implode(',', array_fill(0, count($ids), '?'));
            $rg = db()->prepare("SELECT booking_id, submitted_at FROM guest_registrations WHERE booking_id IN ($ph2)");
            $rg->execute($ids);
            $regSub = [];
            foreach ($rg->fetchAll() as $r) {
                $regSub[(int) $r['booking_id']] = !empty($r['submitted_at']);
            }
            foreach ($bookings as &$bk) {
                $bk['reg_submitted'] = $regSub[(int) $bk['id']] ?? false;
            }
            unset($bk);
        } catch (\Throwable $e) {
        }
    }

    // Also return PENDING enquiries (submitted, not yet confirmed) so the account
    // can show them as cards in the same layout. DECLINED ones are excluded
    // (declined_at IS NULL, the owner list's own filter): a soft-deleted enquiry
    // was rendering on the guest's account as "Awaiting confirmation" forever, and
    // since an admin edit is decline+resubmit it also left TWO pending cards for
    // one request. Guarded for pre-migration installs without the column.
    try {
        $eq = db()->prepare(
            'SELECT e.*, p.name AS property_name, p.address AS property_address
             FROM enquiries e JOIN properties p ON p.prop_key = e.prop_key
             WHERE e.email = ? AND e.declined_at IS NULL
             ORDER BY e.check_in ASC',
        );
        $eq->execute([$email]);
    } catch (\Throwable $e) {
        $eq = db()->prepare(
            'SELECT e.*, p.name AS property_name, p.address AS property_address
             FROM enquiries e JOIN properties p ON p.prop_key = e.prop_key
             WHERE e.email = ?
             ORDER BY e.check_in ASC',
        );
        $eq->execute([$email]);
    }

    // Loyalty: completed stays (check-out in the past). Counted from the rows we
    // already have — no extra query.
    $today = date('Y-m-d');
    $completedStays = 0;
    foreach ($bookings as $bk) {
        if (!empty($bk['check_out']) && $bk['check_out'] < $today) {
            $completedStays++;
        }
    }

    return [
        'bookings' => $bookings,
        'enquiries' => $eq->fetchAll(),
        'completed_stays' => $completedStays,
        'guest' => ['name' => $name, 'email' => $email],
    ];
}

// When another file includes this for the payload helper, stop before routing.
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'my-bookings.php') {
    return;
}

// READ-ONLY. "When will you arrive?" was the one field a guest could set on
// their own booking, and it went with the feature — so a POST is REFUSED
// rather than falling through to the read below. That fall-through is the
// trap the gate caught: it answered 200 with the whole payload, so a stale
// tab's write looked to it exactly like a write that worked.
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    json_out(['error' => 'This page only reads your bookings.'], 405);
}
// ---- Admin, read-only: view a customer's account (sandboxed preview) ----
// ?acctpreview=<bookingId> — resolve the booking's email under admin auth and
// return that customer's account payload (action tokens stripped). Admin-only.
$acctPreview = isset($_GET['acctpreview']) ? (int) $_GET['acctpreview'] : 0;
if ($acctPreview > 0) {
    require_admin(); // admin session (GET → no CSRF requirement)
    $q = db()->prepare('SELECT email FROM bookings WHERE id = ? LIMIT 1');
    $q->execute([$acctPreview]);
    $email = $q->fetchColumn();
    if ($email === false || $email === null || $email === '') {
        json_out(['error' => 'Unknown booking'], 404);
    }
    json_out(my_bookings_payload((string) $email, true));
}

// ---- Normal: the signed-in guest's own bookings ----
require_guest();
$g = db()->prepare('SELECT email FROM guests WHERE id = ?');
$g->execute([$_SESSION['guest_id']]);
$guest = $g->fetch();
if (!$guest) {
    json_out(['bookings' => []]);
}
json_out(my_bookings_payload((string) $guest['email'], false));
