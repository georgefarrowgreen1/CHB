<?php
// ============================================================
//  reviews.php — guest-submitted reviews (moderated).
//  GET                          -> the reviews the site shows (public; see reviews_public_payload)
//  GET ?all=1                   -> every review the site shows, for "Read all" (public)
//  POST {action:'submit'}       -> guest submits/updates their review
//                                  (must have a completed stay; goes to PENDING)
//  POST {action:'mine'}         -> the logged-in guest's own reviews
//  POST {action:'list_admin'}   -> all reviews + status (admin)
//  POST {action:'set_status'}   -> approve / decline (admin)
//  POST {action:'delete'}       -> remove a review (admin)
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/shell-etag.php';
require_once __DIR__ . '/reviews-lib.php';

// THE REVIEWS A VISITOR IS SENT ARE THE ONES THE PAGE SHOWS (see CLAUDE.md). Every review
// rode every visitor's first load: on a five-year business 211KB of the 233KB boot, for a
// page that shows four per cottage and a few in the homepage rotation. A visitor now gets
// the counts and star sums the page states (overall, per cottage, and the guest-only
// figures the search-result markup uses) and only the reviews on screen; "Read all" asks
// ?all=1. The order is the site's: guests' newest first, then the owner's own in editor
// order (allReviews in app.js). The owner keeps the whole list, editor and all. The rules
// are reviews-lib.php's, which home.php shares to write the first screen.
function reviews_guest_list(): array
{
    return reviews_guest_rows(db());
}
function reviews_curated_list(): array
{
    return reviews_curated_from(content_json('reviews', []));
}
function reviews_all(): array
{
    return reviews_merge(reviews_guest_list(), reviews_curated_list());
}
// The public payload, as a function so bootstrap.php serves the SAME data in its combined
// first-paint response. The owner's shape is the one it always was (the guests' reviews;
// the owner's own ride the content), because the owner's screens read every review.
function reviews_public_payload()
{
    if (!empty($_SESSION['admin_id'])) {
        return ['reviews' => reviews_guest_list()];
    }
    return reviews_summary(reviews_all());
}

// When bootstrap.php includes this file for the payload helper, stop before the
// HTTP routing — the routes below run only when this file IS the request.
if (basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'reviews.php') {
    return;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (!empty($_GET['all'])) {
        // Every review, for "Read all". Public data in a public order; revalidated, and
        // answered 304 when the visitor already has it.
        $body = (string) json_encode(['v' => 2, 'list' => reviews_all()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        $etag = '"' . substr(md5($body), 0, 20) . '"';
        header('Cache-Control: no-cache, private');
        header('ETag: ' . $etag);
        header('Vary: Accept-Encoding');
        if (shell_etag_matches((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''), $etag)) {
            http_response_code(304);
            exit();
        }
        header('Content-Type: application/json; charset=utf-8');
        echo $body;
        exit();
    }
    json_out(reviews_public_payload());
}

$in = body();
$action = $in['action'] ?? '';

if ($action === 'submit') {
    require_guest_proven(); // ownership is matched by email — confirmed accounts only
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
                        WHERE prop_key = ? AND email = ? AND check_out <= CURDATE()');
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
        guest_save_failed('review', $e);
    }

    // Best-effort heads-up to the owner (never blocks the submission)
    if (defined('MAIL_ENABLED') && MAIL_ENABLED) {
        try {
            $m = owner_note_review($guest['name'], $propKey, $stars, $text);
            send_people('reviews', $m['subject'], $m['text']);
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
    // A COUNT FOR A BADGE IS A COUNT: Today and Manage asked for every review there has
    // ever been to count the ones waiting, on every visit.
    if (($in['count'] ?? '') === 'pending') {
        try {
            // Joined as the list below is, so the badge counts what the list will show.
            json_out(['pending' => (int) db()->query("SELECT COUNT(*) FROM guest_reviews r JOIN guests g ON g.id = r.guest_id WHERE r.status = 'pending'")->fetchColumn()]);
        } catch (\Throwable $e) {
            json_out(['error' => 'Could not count the reviews waiting.'], 500);
        }
    }
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
