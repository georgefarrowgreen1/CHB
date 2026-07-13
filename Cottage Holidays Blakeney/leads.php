<?php
// ============================================================
//  leads.php — direct-booking leads from EXTERNAL guests.
//  These are Airbnb/Vrbo/etc. guests who arrive via a per-cottage
//  /review/<slug> link (review.php). They have no account, so we take their
//  contact details WITH the review to (a) publish an approved review and
//  (b) re-invite them next year to book DIRECT (skip the OTA fees).
//
//  POST {action:'submit'}      -> public: leave a review + contact details
//  POST {action:'list'}        -> admin: all leads (moderation + private rating)
//  POST {action:'set_status'}  -> admin: approve / decline the PUBLIC review
//  POST {action:'rate_guest'}  -> admin: PRIVATE guest rating + note (never shown)
//  POST {action:'delete'}      -> admin: remove a lead
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';

$in = body();
$action = $in['action'] ?? '';

if ($action === 'submit') {
    // Public — a real person leaving a review. Rate-limited so the open form
    // can't be scripted into a spam funnel.
    rate_limit('lead', 5, 30);

    $propKey = clean($in['prop_key'] ?? '');
    $name = trim((string) ($in['name'] ?? ''));
    $email = trim((string) ($in['email'] ?? ''));
    $phone = trim((string) ($in['phone'] ?? ''));
    $stars = (int) ($in['stars'] ?? 0);
    $text = trim((string) ($in['text'] ?? ''));
    $source = strtolower(preg_replace('/[^a-z]/i', '', (string) ($in['source'] ?? 'direct'))) ?: 'direct';
    $source = substr($source, 0, 24);

    // Property must exist and be a live, listed cottage.
    $prop = null;
    try {
        $s = db()->prepare('SELECT prop_key, name FROM properties
                            WHERE prop_key = ? AND archived_at IS NULL AND unlisted = 0 LIMIT 1');
        $s->execute([$propKey]);
        $prop = $s->fetch();
    } catch (\Throwable $e) {
        // properties table missing (pre-migration) — fall back to the known three
        $known = ['21a', 'jollyboat', 'pimpernel'];
        if (in_array($propKey, $known, true)) {
            $prop = ['prop_key' => $propKey, 'name' => prop_display($propKey)['name']];
        }
    }
    if (!$prop) {
        json_out(['error' => 'That cottage was not found.'], 404);
    }

    if ($name === '' || mb_strlen($name) > 120) {
        json_out(['error' => 'Please tell us your name.'], 400);
    }
    // Email is REQUIRED (this is how we invite them back to book direct).
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 190) {
        json_out(['error' => 'Please enter a valid email address.'], 400);
    }
    // Phone is OPTIONAL — validate lightly only if given.
    if ($phone !== '') {
        if (!preg_match('/^[0-9+()\s-]{6,40}$/', $phone)) {
            json_out(['error' => 'That phone number does not look right.'], 400);
        }
    } else {
        $phone = null;
    }
    if ($stars < 1 || $stars > 5) {
        json_out(['error' => 'Please choose a star rating.'], 400);
    }
    if (mb_strlen($text) < 10) {
        json_out(['error' => 'Please write at least a sentence or two.'], 400);
    }
    if (mb_strlen($text) > 1000) {
        json_out(['error' => 'Reviews are capped at 1000 characters.'], 400);
    }

    // Re-invite ~11 months out so it lands with a comfortable runway before next
    // year's same season — the anchor is when they left the review (their moment).
    $followUp = date('Y-m-d', strtotime('+335 days'));
    $ip = substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);

    try {
        db()
            ->prepare(
                'INSERT INTO direct_leads
                   (prop_key, name, email, phone, stars, review_text, source, follow_up_at, ip)
                 VALUES (?,?,?,?,?,?,?,?,?)',
            )
            ->execute([$prop['prop_key'], $name, $email, $phone, $stars, $text, $source, $followUp, $ip]);
    } catch (\Throwable $e) {
        json_out(['error' => 'Reviews table missing — run migration-direct-leads.sql first.'], 500);
    }

    // Heads-up to the owner (best-effort; never blocks the guest's submission).
    if (defined('MAIL_ENABLED') && MAIL_ENABLED && defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL !== '') {
        try {
            send_owner(
                'New guest review awaiting approval',
                "{$name} left a {$stars}\xE2\x98\x85 review for {$prop['name']} via the review link:\n\n{$text}\n\n" .
                    "Contact: {$email}" . ($phone ? " / {$phone}" : '') . "\n\n" .
                    'Approve it (and privately rate the guest) in Manage → Guest reviews.',
            );
        } catch (\Throwable $e) {
        }
    }
    log_activity('review', 'lead.submit', $name . ' left a review for ' . $prop['name'], ['entity' => 'lead']);

    json_out(['ok' => true]);
}

// ---- Everything below is owner-only ----
require_admin();

if ($action === 'list') {
    try {
        $rows = db()
            ->query(
                'SELECT id, prop_key, name, email, phone, stars, review_text, source,
                        status, admin_rating, admin_note, follow_up_at, follow_up_sent_at, created_at
                 FROM direct_leads
                 ORDER BY (status = \'pending\') DESC, created_at DESC',
            )
            ->fetchAll();
    } catch (\Throwable $e) {
        $rows = [];
    }
    json_out(['leads' => $rows]);
}

if ($action === 'set_status') {
    $id = (int) ($in['id'] ?? 0);
    $status = in_array($in['status'] ?? '', ['pending', 'approved', 'declined'], true) ? $in['status'] : null;
    if (!$id || !$status) {
        json_out(['error' => 'Invalid request'], 400);
    }
    db()->prepare('UPDATE direct_leads SET status = ? WHERE id = ?')->execute([$status, $id]);
    log_activity('moderation', 'lead.' . $status, 'Guest review ' . $status, ['entity' => 'lead', 'entity_id' => (string) $id]);
    json_out(['ok' => true]);
}

if ($action === 'rate_guest') {
    // PRIVATE owner rating of the guest — never shown to them, only used to keep
    // difficult guests OUT of the direct-booking follow-up campaign.
    $id = (int) ($in['id'] ?? 0);
    if (!$id) {
        json_out(['error' => 'Invalid request'], 400);
    }
    $rating = $in['admin_rating'] ?? null;
    $rating = $rating === null || $rating === '' ? null : max(1, min(5, (int) $rating));
    $note = mb_substr(trim((string) ($in['admin_note'] ?? '')), 0, 500) ?: null;
    db()->prepare('UPDATE direct_leads SET admin_rating = ?, admin_note = ? WHERE id = ?')
        ->execute([$rating, $note, $id]);
    log_activity('moderation', 'lead.rate', 'Rated a guest privately', ['entity' => 'lead', 'entity_id' => (string) $id]);
    json_out(['ok' => true]);
}

if ($action === 'delete') {
    $id = (int) ($in['id'] ?? 0);
    db()->prepare('DELETE FROM direct_leads WHERE id = ?')->execute([$id]);
    log_activity('moderation', 'lead.delete', 'Lead deleted', ['entity' => 'lead', 'entity_id' => (string) $id]);
    json_out(['ok' => true]);
}

json_out(['error' => 'Unknown action'], 400);
