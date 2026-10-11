<?php
// ============================================================
//  newsletter-lib.php — the newsletter sign-up's confirmation (double opt-in).
//  PURE: no database, no session, so test-newsletter.php drives it whole.
//
//  A sign-up joins the list only once the link emailed to the address is opened:
//  the footer form used to add any address it was given at once, and to switch an
//  unsubscribed address straight back on. The link carries the subscriber's token,
//  the time it was made and an HMAC over both, so it cannot be made from the
//  unsubscribe link alone and stops working after a week.
// ============================================================

const NEWSLETTER_CONFIRM_SECONDS = 7 * 86400;
// Confirmation emails to one address in a day, whoever asks: enough for a person
// whose first one went to spam, too few to use the form to pester a stranger.
const NEWSLETTER_CONFIRM_MAILS_PER_DAY = 3;

function newsletter_confirm_sig(string $token, int $t): string
{
    return substr(hash_hmac('sha256', 'nlconfirm|' . $token . '|' . $t, APP_SECRET), 0, 32);
}

function newsletter_confirm_link(string $base, string $token, int $t): string
{
    return $base . 'index.html?nlconfirm=' . rawurlencode($token) . '&t=' . $t . '&k=' . newsletter_confirm_sig($token, $t);
}

// 'ok', 'expired' (a real link, older than a week) or 'invalid'.
function newsletter_confirm_check($token, $t, $k, ?int $now = null): string
{
    $token = (string) $token;
    $k = (string) $k;
    if (!preg_match('/^[a-f0-9]{16,64}$/', $token) || !preg_match('/^\d{9,11}$/', (string) $t) || !preg_match('/^[a-f0-9]{32}$/', $k)) {
        return 'invalid';
    }
    if (!hash_equals(newsletter_confirm_sig($token, (int) $t), $k)) {
        return 'invalid';
    }
    $now = $now ?? time();
    if ((int) $t > $now + 300) {
        return 'invalid'; // a link from the future was not made here
    }
    return $now - (int) $t > NEWSLETTER_CONFIRM_SECONDS ? 'expired' : 'ok';
}

// What a sign-up does with the row already stored for the address (null = none):
// 'add' a new waiting row and ask, 'ask' again (still waiting, or unsubscribed — it
// stays off until the link is opened), or 'none' (already confirmed and on the list).
function newsletter_signup_plan(?array $row): string
{
    if (!$row) {
        return 'add';
    }
    $confirmed = ($row['confirmed_at'] ?? null) !== null && (string) $row['confirmed_at'] !== '';
    $unsubscribed = ($row['unsubscribed_at'] ?? null) !== null && (string) $row['unsubscribed_at'] !== '';
    return $confirmed && !$unsubscribed ? 'none' : 'ask';
}
