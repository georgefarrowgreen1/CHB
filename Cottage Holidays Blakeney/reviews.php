<?php
// ============================================================
//  reviews.php — guest-submitted reviews (moderated).
//  GET                          -> approved reviews (public)
//  POST {action:'submit'}       -> guest submits/updates their review
//                                  (must have a completed stay; goes to PENDING)
//  POST {action:'mine'}         -> the logged-in guest's own reviews
//  POST {action:'list_admin'}   -> all reviews + status (admin)
//  POST {action:'set_status'}   -> approve / decline (admin)
//  POST {action:'delete'}       -> remove a review (admin)
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';

// The public GET payload, as a function so bootstrap.php can serve the SAME data
// in its combined first-paint response without duplicating this logic.
function reviews_public_payload()
{
    $out = [];
    // Registered-guest reviews (guest_reviews, keyed to an account).
    try {
        $rows = db()
            ->query(
                "SELECT r.prop_key, r.stars, r.review_text, g.name
             FROM guest_reviews r JOIN guests g ON g.id = r.guest_id
             WHERE r.status = 'approved' ORDER BY r.created_at DESC",
            )
            ->fetchAll();
        foreach ($rows as $r) {
            $out[] = [
                'name' => $r['name'],
                'stars' => (int) $r['stars'],
                'text' => $r['review_text'],
                'prop' => $r['prop_key'],
            ];
        }
    } catch (\Throwable $e) {
    } // table missing — no reviews yet
    // External-guest reviews left via the /review/<slug> links (direct_leads),
    // once the owner has approved them. Same public shape as above.
    try {
        $rows = db()
            ->query(
                "SELECT prop_key, stars, review_text, name
             FROM direct_leads WHERE status = 'approved' ORDER BY created_at DESC",
            )
            ->fetchAll();
        foreach ($rows as $r) {
            $out[] = [
                'name' => $r['name'],
                'stars' => (int) $r['stars'],
                'text' => $r['review_text'],
                'prop' => $r['prop_key'],
            ];
        }
    } catch (\Throwable $e) {
    } // table missing (pre-migration) — skip
    return ['reviews' => $out];
}

// When bootstrap.php includes this file for the payload helper, stop before the
// HTTP routing — the routes below run only when this file IS the request.
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'reviews.php') {
    return;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    json_out(reviews_public_payload());
}

$in = body();
$action = $in['action'] ?? '';

if ($action === 'submit') {
    require_guest();
    $propKey = clean($in['prop_key'] ?? '');
    $stars = (int) ($in['stars'] ?? 0);
    $text = trim((string) ($in['text'] ?? ''));
    if ($stars < 1 || $stars > 5) {
        json_out(['error' => 'Please choose a star rating'], 400);
    }
    if (mb_strlen($text) < 10) {
        json_out(['error' => 'Please write at least a sentence or two'], 400);
    }
    if (mb_strlen($text) > 1000) {
        json_out(['error' => 'Reviews are capped at 1000 characters'], 400);
    }

    // Verify the guest has actually COMPLETED a stay at this property
    // (a booking under their email with a check-out in the past).
    $g = db()->prepare('SELECT name, email FROM guests WHERE id = ?');
    $g->execute([$_SESSION['guest_id']]);
    $guest = $g->fetch();
    if (!$guest) {
        json_out(['error' => 'Account not found'], 404);
    }
    $s = db()->prepare('SELECT COUNT(*) c FROM bookings
                        WHERE prop_key = ? AND LOWER(email) = LOWER(?) AND check_out <= CURDATE()');
    $s->execute([$propKey, $guest['email']]);
    if ((int) $s->fetch()['c'] === 0) {
        json_out(['error' => 'Reviews can be left once your stay is complete.'], 403);
    }

    // One review per guest per property: insert, or update + back to pending.
    try {
        db()
            ->prepare(
                'INSERT INTO guest_reviews (guest_id, prop_key, stars, review_text, status)
             VALUES (?,?,?,?,\'pending\')
             ON DUPLICATE KEY UPDATE stars = VALUES(stars),
                 review_text = VALUES(review_text), status = \'pending\'',
            )
            ->execute([$_SESSION['guest_id'], $propKey, $stars, $text]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Reviews table missing — run migration-guest-reviews.sql first'], 500);
    }

    // Best-effort heads-up to the owner (never blocks the submission)
    if (defined('MAIL_ENABLED') && MAIL_ENABLED && defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL !== '') {
        try {
            send_owner(
                'New guest review awaiting approval',
                "A review was submitted by {$guest['name']} for {$propKey} ({$stars}\xE2\x98\x85):\n\n{$text}\n\n" .
                    'Approve or decline it in Manage → Guest reviews.',
            );
        } catch (\Throwable $e) {
        }
    }
    json_out(['ok' => true, 'status' => 'pending']);
}

if ($action === 'mine') {
    require_guest();
    try {
        $s = db()->prepare('SELECT prop_key, stars, review_text, status FROM guest_reviews WHERE guest_id = ?');
        $s->execute([$_SESSION['guest_id']]);
        $rows = $s->fetchAll();
    } catch (\Throwable $e) {
        $rows = [];
    }
    $out = [];
    foreach ($rows as $r) {
        $out[$r['prop_key']] = ['stars' => (int) $r['stars'], 'text' => $r['review_text'], 'status' => $r['status']];
    }
    json_out(['mine' => $out]);
}

require_admin();

if ($action === 'list_admin') {
    try {
        $rows = db()
            ->query(
                'SELECT r.id, r.prop_key, r.stars, r.review_text, r.status, r.created_at, g.name, g.email
             FROM guest_reviews r JOIN guests g ON g.id = r.guest_id
             ORDER BY (r.status = \'pending\') DESC, r.created_at DESC',
            )
            ->fetchAll();
    } catch (\Throwable $e) {
        $rows = [];
    }
    json_out(['reviews' => $rows]);
}

if ($action === 'set_status') {
    $id = (int) ($in['id'] ?? 0);
    $status = in_array($in['status'] ?? '', ['approved', 'declined'], true) ? $in['status'] : null;
    if (!$id || !$status) {
        json_out(['error' => 'Invalid request'], 400);
    }
    db()
        ->prepare('UPDATE guest_reviews SET status = ? WHERE id = ?')
        ->execute([$status, $id]);
    log_activity('moderation', 'review.' . $status, 'Review ' . ($status === 'approved' ? 'approved' : 'declined'), ['entity' => 'review', 'entity_id' => (string) $id]);
    json_out(['ok' => true]);
}

if ($action === 'delete') {
    $id = (int) ($in['id'] ?? 0);
    db()
        ->prepare('DELETE FROM guest_reviews WHERE id = ?')
        ->execute([$id]);
    log_activity('moderation', 'review.delete', 'Review deleted', ['entity' => 'review', 'entity_id' => (string) $id]);
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
