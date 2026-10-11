<?php
// ============================================================
//  test-newsletter.php — the newsletter sign-up's confirmation (double opt-in),
//  newsletter-lib.php driven whole: no database, no network, no clock (every check
//  passes its own "now").
//
//  The rule it holds: an address joins the list only when the link emailed to it is
//  opened, the link cannot be made from the unsubscribe token alone, and it stops
//  working after a week. The endpoint's behaviour is test-integration §86; the wiring
//  scans at the foot catch a reverted filter where there is no database to run.
//  CI-wired, deploy-excluded. The counter is nlc(): PHPStan reads every test file as
//  one set, and chk() is already declared twice.
// ============================================================
if (!defined('APP_SECRET')) {
    define('APP_SECRET', 'test-newsletter-secret');
}
require_once __DIR__ . '/newsletter-lib.php';

$nlFail = 0;
$nlN = 0;
function nlc(string $name, bool $cond): void
{
    global $nlFail, $nlN;
    $nlN++;
    echo '  ' . ($cond ? "\u{2713}" : "\u{2717}") . " $name\n";
    if (!$cond) {
        $nlFail++;
    }
}

$tok = str_repeat('a1', 16); // 32 hex, as bin2hex(random_bytes(16)) makes
$now = 1791734100;

echo "\n-- the link --\n";
$link = newsletter_confirm_link('https://example.test/', $tok, $now);
nlc('the link carries the token, its time and a signature', preg_match('~^https://example\.test/index\.html\?nlconfirm=' . $tok . '&t=' . $now . '&k=[a-f0-9]{32}$~', $link) === 1);
parse_str((string) parse_url($link, PHP_URL_QUERY), $q);
$qt = (string) ($q['nlconfirm'] ?? '');
$qs = (string) ($q['t'] ?? '');
$qk = (string) ($q['k'] ?? '');
nlc('the link it makes is one it accepts', newsletter_confirm_check($qt, $qs, $qk, $now) === 'ok');
nlc('…a day later', newsletter_confirm_check($qt, $qs, $qk, $now + 86400) === 'ok');
nlc('…and at the end of the seventh day', newsletter_confirm_check($qt, $qs, $qk, $now + NEWSLETTER_CONFIRM_SECONDS) === 'ok');
nlc('a second after that it has expired (not "invalid": it was a real link)', newsletter_confirm_check($qt, $qs, $qk, $now + NEWSLETTER_CONFIRM_SECONDS + 1) === 'expired');
nlc('the week is seven days', NEWSLETTER_CONFIRM_SECONDS === 7 * 86400);
nlc('three confirmation emails a day to one address, whoever asks', NEWSLETTER_CONFIRM_MAILS_PER_DAY === 3);

echo "\n-- what it refuses --\n";
nlc('the unsubscribe token alone is not a confirmation', newsletter_confirm_check($tok, '', '', $now) === 'invalid');
nlc('a signature made for another token', newsletter_confirm_check(str_repeat('b2', 16), $qs, $qk, $now) === 'invalid');
nlc('the old signature with a later time (stretching the week)', newsletter_confirm_check($tok, (string) ($now + 86400), $qk, $now + 86400) === 'invalid');
$flip = substr($qk, 0, 31) . ($qk[31] === '0' ? '1' : '0');
nlc('one wrong character in the signature', newsletter_confirm_check($tok, $qs, $flip, $now) === 'invalid');
$other = substr(hash_hmac('sha256', 'nlconfirm|' . $tok . '|' . $now, 'another-secret'), 0, 32);
nlc('a signature made with another secret', newsletter_confirm_check($tok, (string) $now, $other, $now) === 'invalid');
$unsubShape = substr(hash_hmac('sha256', $tok . '|' . $now, APP_SECRET), 0, 32);
nlc('a signature over the same parts without the "nlconfirm" label', newsletter_confirm_check($tok, (string) $now, $unsubShape, $now) === 'invalid');
nlc('a link dated an hour ahead was not made here', newsletter_confirm_check($tok, (string) ($now + 3600), newsletter_confirm_sig($tok, $now + 3600), $now) === 'invalid');
nlc('…a couple of minutes of clock difference is allowed', newsletter_confirm_check($tok, (string) ($now + 120), newsletter_confirm_sig($tok, $now + 120), $now) === 'ok');
nlc('a token that is not hex', newsletter_confirm_check('sample-token', (string) $now, newsletter_confirm_sig('sample-token', $now), $now) === 'invalid');
nlc('a time that is not a number', newsletter_confirm_check($tok, 'soon', $qk, $now) === 'invalid');
nlc('a signature that is not 32 hex', newsletter_confirm_check($tok, $qs, substr($qk, 0, 16), $now) === 'invalid');
nlc('upper-case hex is not the signature (it is compared exactly)', newsletter_confirm_check($tok, $qs, strtoupper($qk), $now) === 'invalid');

echo "\n-- what a sign-up does with the row already there --\n";
nlc('a new address is added and asked', newsletter_signup_plan(null) === 'add');
nlc('one still waiting is asked again', newsletter_signup_plan(['confirmed_at' => null, 'unsubscribed_at' => null]) === 'ask');
nlc('one already on the list is left alone (no email)', newsletter_signup_plan(['confirmed_at' => '2026-10-01 10:00:00', 'unsubscribed_at' => null]) === 'none');
nlc('one that unsubscribed is asked, never switched back on', newsletter_signup_plan(['confirmed_at' => '2026-10-01 10:00:00', 'unsubscribed_at' => '2026-10-05 10:00:00']) === 'ask');
nlc('…nor one that unsubscribed before confirming', newsletter_signup_plan(['confirmed_at' => null, 'unsubscribed_at' => '2026-10-05 10:00:00']) === 'ask');
nlc('an empty date reads as not set', newsletter_signup_plan(['confirmed_at' => '', 'unsubscribed_at' => '']) === 'ask');
nlc('a row missing the column reads as waiting', newsletter_signup_plan(['unsubscribed_at' => null]) === 'ask');

// ---- The wiring. Comments are stripped first: a scan for an absence must not
// see the sentence explaining it.
echo "\n-- the wiring --\n";
$code = function (string $file): string {
    $src = (string) file_get_contents(__DIR__ . '/' . $file);
    $out = '';
    foreach (token_get_all($src) as $t) {
        if (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $out .= is_array($t) ? $t[1] : $t;
    }
    return $out;
};
$nl = $code('newsletter.php');
$from = strpos($nl, "\$action === 'subscribe'");
$to = strpos($nl, "\$action === 'confirm'");
$sub = $from !== false && $to !== false ? substr($nl, $from, $to - $from) : '';
nlc('(the subscribe action was found)', strlen($sub) > 200);
nlc('signing up never switches an unsubscribed address back on', $sub !== '' && stripos($sub, 'unsubscribed_at = NULL') === false && stripos($sub, 'unsubscribed_at=NULL') === false);
nlc('…and never marks an address confirmed', $sub !== '' && !preg_match('/confirmed_at\s*=\s*(NOW|CURRENT|\?)/i', $sub));
nlc('…it emails the link through the plan, capped per address', $sub !== '' && strpos($sub, 'newsletter_signup_plan(') !== false && strpos($sub, 'newsletter_confirm_allowed(') !== false && strpos($sub, 'send_newsletter_confirm(') !== false);
nlc('confirming checks the signed link before touching a row', preg_match('/newsletter_confirm_check\(.*?\);.*?UPDATE newsletter_subscribers/s', substr($nl, (int) $to)) === 1);
$bcast = strpos($nl, "\$action === 'broadcast'");
nlc('the broadcast goes to confirmed addresses only', $bcast !== false && preg_match('/FROM newsletter_subscribers WHERE unsubscribed_at IS NULL AND confirmed_at IS NOT NULL/', substr($nl, $bcast)) === 1);
$ml = $code('mailer.php');
nlc('a queued newsletter copy is sent only while the address is still confirmed', preg_match("/'newsletter'.{0,400}?confirmed_at IS NOT NULL/s", $ml) === 1);
$mig = (string) file_get_contents(__DIR__ . '/migration-146-newsletter-confirm.sql');
nlc('the migration keeps everyone already on the list (an unsubscribed address stays off)', strpos($mig, 'SET confirmed_at = created_at WHERE confirmed_at IS NULL AND unsubscribed_at IS NULL') !== false);
$sr = $code('self-repair.php');
nlc('a sign-up never confirmed is cleared a month after its last link, and an unsubscribe is kept', preg_match('/DELETE FROM newsletter_subscribers WHERE confirmed_at IS NULL AND unsubscribed_at IS NULL AND COALESCE\(confirm_sent_at, created_at\) < DATE_SUB\(NOW\(\), INTERVAL 30 DAY\)/', $sr) === 1);

echo $nlFail ? "\n  $nlFail of $nlN NEWSLETTER CHECK(S) FAILED \u{274C}\n" : "\n  ALL $nlN NEWSLETTER CHECKS PASSED \u{2705}\n";
exit($nlFail ? 1 : 0);
