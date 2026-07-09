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
if (!$isCron && empty($_SESSION['admin_id'])) {
    json_out(['error' => 'Not authorised'], 401);
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
        WHERE email <> '' AND nudge_sent_at IS NULL
          AND created_at <= (NOW() - INTERVAL 2 DAY)
          AND check_in >= CURDATE()",
        )
        ->fetchAll();
} catch (\Throwable $e) {
    json_out(['error' => 'Could not read enquiries — has migrate.php been run?'], 500);
}

$sent = 0;
foreach ($rows as $e) {
    $rate = get_rate($e['prop_key']);
    $propName = $rate['name'] ?? '' ?: $e['prop_key'];
    $name = $e['name'] ?: 'there';
    // A direct link back to the cottage so they can pick up and book in one tap.
    $base = function_exists('site_base_url') ? site_base_url() : '';
    $slug = prop_display($e['prop_key'])['slug']; // pretty URL for any cottage, owner-added included
    $link = $base ? $base . ($slug ? 'cottages/' . $slug : '') : '';
    $subject = 'Still thinking about your Blakeney stay?';
    $text =
        'Hello ' .
        $name .
        ",\n\n" .
        'Thanks for your enquiry about ' .
        $propName .
        ' for ' .
        $e['check_in'] .
        ' to ' .
        $e['check_out'] .
        ".\n\n" .
        "We're still holding those dates for you. " .
        ($link ? "You can pick up where you left off here:\n" . $link . "\n\n" : '') .
        "Or just reply to this email (or message us on the website) and we'll get your booking confirmed.\n\n" .
        "Warm wishes,\nCottage Holidays Blakeney";
    // House email design (this and the rescue below were the only guest emails
    // still going out as bare plain text).
    $html = null;
    if (function_exists('email_shell')) {
        $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
        $accent = prop_display($e['prop_key'])['accent'];
        $inner =
            email_h('Still thinking it over?') .
            email_p('Hello ' . $esc($name) . ', thanks for your enquiry about <strong style="color:#2A2622;">' . $esc($propName) . '</strong> for ' . $esc($e['check_in']) . ' to ' . $esc($e['check_out']) . '.') .
            email_p("We're still holding those dates for you.") .
            ($link ? email_btn($link, 'Pick up where you left off', $accent, '#ffffff') : '') .
            email_p("Or just reply to this email (or message us on the website) and we'll get your booking confirmed.", true);
        $html = email_shell('Still thinking about your Blakeney stay?', $inner, $accent);
    }
    try {
        // smtp_send returns ok:false on a soft failure (server down / mail off)
        // WITHOUT throwing — only mark the nudge sent if it actually went, else
        // the guest's one-and-only nudge is silently burned.
        $r = function_exists('smtp_send') ? smtp_send($e['email'], $name, $subject, $text, $html) : ['ok' => false];
        if (!empty($r['ok'])) {
            db()
                ->prepare('UPDATE enquiries SET nudge_sent_at = NOW() WHERE id = ?')
                ->execute([(int) $e['id']]);
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
        $name = $d['name'] ?: 'there';
        $base = function_exists('site_base_url') ? site_base_url() : '';
        $slug = prop_display($d['prop_key'])['slug'];
        $link = $base ? $base . ($slug ? 'cottages/' . $slug : '') : '';
        $dates = $d['check_in'] && $d['check_out'] ? ' for ' . $d['check_in'] . ' to ' . $d['check_out'] : '';
        $subject = 'Finish your ' . $propName . ' enquiry?';
        $text =
            'Hello ' .
            $name .
            ",\n\n" .
            'It looks like you were part-way through an enquiry about ' .
            $propName .
            $dates .
            " and didn't quite finish. No pressure at all — if you'd still like to stay, " .
            "you can pick up where you left off here:\n" .
            ($link ? $link . "\n\n" : "\n") .
            "Your details are saved in the form on this device, so it only takes a moment. " .
            "Or just reply to this email and we'll happily sort it out for you.\n\n" .
            "Warm wishes,\nCottage Holidays Blakeney";
        // House email design (was bare plain text, like the follow-up above).
        $html = null;
        if (function_exists('email_shell')) {
            $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
            $accent = prop_display($d['prop_key'])['accent'];
            $inner =
                email_h('Finish your enquiry?') .
                email_p('Hello ' . $esc($name) . ', it looks like you were part-way through an enquiry about <strong style="color:#2A2622;">' . $esc($propName) . '</strong>' . $esc($dates) . " and didn't quite finish.") .
                email_p("No pressure at all — if you'd still like to stay, you can pick up where you left off in one tap. Your details are saved in the form on this device, so it only takes a moment.") .
                ($link ? email_btn($link, 'Pick up where you left off', $accent, '#ffffff') : '') .
                email_p("Or just reply to this email and we'll happily sort it out for you.", true);
            $html = email_shell('Finish your ' . $propName . ' enquiry?', $inner, $accent);
        }
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
