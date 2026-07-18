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

// Build the account payload for a given email. `$preview` strips the login-free
// action tokens so an admin preview is look-only. Keyed on the email so it serves
// both the signed-in guest (their own) and an admin preview (a target customer).
function my_bookings_payload(string $email, bool $preview = false): array
{
    $stmt = db()->prepare(
        'SELECT b.*, p.name AS property_name, p.address AS property_address
         FROM bookings b JOIN properties p ON p.prop_key = b.prop_key
         WHERE LOWER(b.email) = LOWER(?)
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
            $ph = implode(',', array_fill(0, count($ids), '?'));
            $rs = db()->prepare(
                "SELECT booking_id, COALESCE(SUM(amount),0) t FROM payments
                 WHERE kind = 'damages_return' AND booking_id IN ($ph) GROUP BY booking_id",
            );
            $rs->execute($ids);
            foreach ($rs->fetchAll() as $row) {
                $returnedByBooking[(int) $row['booking_id']] = round((float) $row['t'], 2);
            }
        }
    } catch (\Throwable $e) {
    }

    // Attach a login-free pay token + guest-registration link to each booking (so
    // the guest can pay a balance / add details straight from My Stays) — UNLESS
    // this is a read-only admin preview, where those actionable tokens are stripped.
    $sqOn = square_enabled();
    foreach ($bookings as &$bk) {
        $bk['pay_token'] = ($preview || !$sqOn) ? null : pay_token((int) $bk['id']);
        $bk['damages_returned'] = $returnedByBooking[(int) $bk['id']] ?? 0;
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
    // can show them as cards in the same layout.
    $eq = db()->prepare(
        'SELECT e.*, p.name AS property_name, p.address AS property_address
         FROM enquiries e JOIN properties p ON p.prop_key = e.prop_key
         WHERE LOWER(e.email) = LOWER(?)
         ORDER BY e.check_in ASC',
    );
    $eq->execute([$email]);

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
