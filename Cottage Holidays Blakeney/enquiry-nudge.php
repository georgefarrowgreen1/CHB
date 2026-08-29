<?php
// ============================================================
//  enquiry-nudge.php — the two "don't lose the booking" emails, one each:
//   1) Follow-up: guests whose SUBMITTED enquiry has been pending a couple of
//      days (dates still in the future) — records nudge_sent_at, never twice.
//   2) Rescue: visitors who typed a valid email into the enquiry form but never
//      sent it (enquiry_drafts, saved by enquiries.php 'draft') — one email a
//      few hours later, records nudged_at, never twice.
//
//  Run daily (alongside the other crons):
//    https://YOURDOMAIN/enquiry-nudge.php?cron=APP_SECRET
//
//  The owner can switch it off in Settings → Enquiries (content key
//  'enquiry-nudge-off' = '1'). Table column added by migration-enquiry-nudge.sql.
// ============================================================
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/pricing.php';

$isCron = isset($_GET['cron']) && hash_equals(APP_SECRET, (string) $_GET['cron']);
if (!$isCron) {
    // A signed-in admin's manual run must be a POST so require_admin() enforces the
    // CSRF token — a cross-site GET link in the owner's browser must not be able to
    // fire this job via their session (same guard as cron.php / self-repair.php).
    require_admin();
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        json_out(['error' => 'Run this from the back office, or use the cron URL with your secret.'], 405);
    }
}

// Owner opt-out.
if (content_value('enquiry-nudge-off') === '1') {
    json_out(['ok' => true, 'sent' => 0, 'off' => true]);
}

require_once __DIR__ . '/mailer.php';

try {
    $rows = db()
        ->query(
            "SELECT * FROM enquiries
        WHERE email <> '' AND nudge_sent_at IS NULL AND declined_at IS NULL
          AND created_at <= (NOW() - INTERVAL 2 DAY)
          AND check_in >= CURDATE()",
        )
        ->fetchAll();
} catch (\Throwable $e) {
    json_out(['error' => 'Could not read enquiries — has migrate.php been run?'], 500);
}

$sent = 0;
foreach ($rows as $e) {
    // Re-check the world before promising anything: an archived cottage gets no
    // nudge at all, and dates taken since the enquiry (another booking or an
    // imported OTA block) must not be described as "still held" — the approval
    // path re-checks both (enquiry-actions.php), so the nudge must too.
    if (function_exists('prop_is_archived') && prop_is_archived($e['prop_key'])) {
        continue;
    }
    $datesGone = function_exists('dates_clash') && dates_clash($e['prop_key'], $e['check_in'], $e['check_out']);
    $rate = get_rate($e['prop_key']);
    $propName = $rate['name'] ?? '' ?: $e['prop_key'];
    $name = first_name($e['name'], 'there');
    // A direct link back to the cottage so they can pick up and book in one tap.
    $base = function_exists('site_base_url') ? site_base_url() : '';
    $slug = prop_display($e['prop_key'])['slug']; // pretty URL for any cottage, owner-added included
    $link = $base ? $base . ($slug ? 'cottages/' . $slug : '') : '';
    // Composed by enquiry_nudge_body() in mailer.php — previewable, and the render
    // gate proves it builds. datesGone carries the honest-status half.
    $m = enquiry_nudge_body(
        $name,
        $propName,
        email_date($e['check_in']) . ' to ' . email_date($e['check_out']),
        $link,
        prop_display($e['prop_key'])['accent'],
        $datesGone,
    );
    [$subject, $text, $html] = [$m['subject'], $m['text'], $m['html']];
    try {
        // Claim-first (the payments-due posture): stamp-after-send let two
        // overlapping runs nudge the same guest twice. A soft send failure
        // un-claims so the one-and-only nudge is never silently burned.
        $claim = db()->prepare('UPDATE enquiries SET nudge_sent_at = NOW() WHERE id = ? AND nudge_sent_at IS NULL');
        $claim->execute([(int) $e['id']]);
        if ($claim->rowCount() !== 1) {
            continue; // an overlapping run owns this enquiry
        }
        // smtp_send returns ok:false on a soft failure (server down / mail off)
        // WITHOUT throwing.
        $r = function_exists('smtp_send') ? smtp_send($e['email'], $name, $subject, $text, $html) : ['ok' => false];
        if (empty($r['ok'])) {
            db()->prepare('UPDATE enquiries SET nudge_sent_at = NULL WHERE id = ?')->execute([(int) $e['id']]);
        }
        if (!empty($r['ok'])) {
            $sent++;
            log_activity('comms', 'enquiry.nudge', 'Enquiry follow-up emailed — ' . ($e['name'] ?: $e['email']), [
                'actor' => 'cron',
                'prop_key' => $e['prop_key'] ?? '',
                'entity' => 'enquiry',
                'entity_id' => (string) $e['id'],
            ]);
        }
    } catch (\Throwable $ex) {
        /* skip this one, continue with the rest */
    }
}

// ---- Abandoned-enquiry rescue ------------------------------------------------
// Visitors who typed a valid email into the enquiry form but never pressed send
// leave a row in enquiry_drafts (enquiries.php 'draft'). Send ONE "pick up where
// you left off" email once the draft is a few hours old — but only while it's
// still fresh (≤3 days) and only if no real enquiry arrived from that email in
// the meantime. nudged_at guarantees a single email ever, even if they come back
// and keep editing the draft. Same owner switch as the follow-up above.
$rescued = 0;
$drafts = [];
try {
    $drafts = db()
        ->query(
            "SELECT * FROM enquiry_drafts
        WHERE nudged_at IS NULL
          AND updated_at <= (NOW() - INTERVAL 3 HOUR)
          AND updated_at >= (NOW() - INTERVAL 3 DAY)
          AND (check_in IS NULL OR check_in >= CURDATE())",
        )
        ->fetchAll();
} catch (\Throwable $e) {
    /* table missing pre-migration — the follow-up section above still ran */
}

foreach ($drafts as $d) {
    try {
        // They enquired (same email, after the draft appeared)? Nothing to rescue.
        $q = db()->prepare('SELECT 1 FROM enquiries WHERE email = ? AND created_at >= ? LIMIT 1');
        $q->execute([$d['email'], $d['created_at']]);
        if ($q->fetchColumn()) {
            db()->prepare('DELETE FROM enquiry_drafts WHERE id = ?')->execute([(int) $d['id']]);
            continue;
        }
        // Approved enquiries become bookings (the enquiry row goes away) — treat a
        // booking from this email for the drafted dates as "already sorted" too.
        if ($d['check_in']) {
            $q = db()->prepare('SELECT 1 FROM bookings WHERE email = ? AND check_in = ? LIMIT 1');
            $q->execute([$d['email'], $d['check_in']]);
            if ($q->fetchColumn()) {
                db()->prepare('DELETE FROM enquiry_drafts WHERE id = ?')->execute([(int) $d['id']]);
                continue;
            }
        }

        $rate = get_rate($d['prop_key']);
        $propName = $rate['name'] ?? '' ?: $d['prop_key'];
        $name = first_name($d['name'], 'there');
        $base = function_exists('site_base_url') ? site_base_url() : '';
        $slug = prop_display($d['prop_key'])['slug'];
        $link = $base ? $base . ($slug ? 'cottages/' . $slug : '') : '';
        // The BARE span; enquiry_rescue_body() adds the " for " when there is one.
        // NB ltrim($dates, ' for ') was tried and is a landmine: ltrim takes a CHARACTER
        // list, so it eats any leading space/f/o/r and only happened to work here.
        $dates = $d['check_in'] && $d['check_out'] ? email_date($d['check_in']) . ' to ' . email_date($d['check_out']) : '';
        // Composed by enquiry_rescue_body() in mailer.php — previewable, gated.
        $m = enquiry_rescue_body($name, $propName, $dates, $link, prop_display($d['prop_key'])['accent']);
        [$subject, $text, $html] = [$m['subject'], $m['text'], $m['html']];
        // Like the follow-up above: only mark it sent if it actually went, or the
        // one-and-only rescue email is silently burned on a mail hiccup.
        $r = function_exists('smtp_send') ? smtp_send($d['email'], $name, $subject, $text, $html) : ['ok' => false];
        if (!empty($r['ok'])) {
            db()->prepare('UPDATE enquiry_drafts SET nudged_at = NOW() WHERE id = ?')->execute([(int) $d['id']]);
            $rescued++;
            log_activity('comms', 'enquiry.rescue', 'Abandoned-enquiry rescue emailed — ' . ($d['name'] ?: $d['email']), [
                'actor' => 'cron',
                'prop_key' => $d['prop_key'] ?? '',
                'entity' => 'enquiry',
            ]);
        }
    } catch (\Throwable $ex) {
        /* skip this one, continue with the rest */
    }
}

// Housekeeping: drafts are transient by design — purge anything untouched for
// 30 days (nudged or not) so abandoned contact details don't accumulate.
try {
    db()->exec("DELETE FROM enquiry_drafts WHERE updated_at < (NOW() - INTERVAL 30 DAY)");
} catch (\Throwable $e) {
}

json_out(['ok' => true, 'sent' => $sent + $rescued, 'nudged' => $sent, 'rescued' => $rescued, 'candidates' => count($rows) + count($drafts)]);
