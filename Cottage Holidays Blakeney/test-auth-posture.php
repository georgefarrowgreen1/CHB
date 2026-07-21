<?php
// ============================================================
//  test-auth-posture.php — endpoint AUTH-POSTURE gate (dev/CI only).
//
//      php test-auth-posture.php
//
//  Every .php file in this folder is web-reachable (flat shared hosting), so
//  every one must have a CONSCIOUS auth posture. This registry declares what
//  each file is — owner-only, guest-session, cron-secret, signed-token,
//  webhook-secret, rate-limited public, deliberately public, an include-only
//  library, or a dev tool that never deploys — and the gate VERIFIES the
//  claim where it can: a file claiming 'admin' must actually contain
//  require_admin(), a cron job the APP_SECRET check, a token endpoint
//  hash_equals(), and 'dev' files must appear in deploy.yml's exclusions.
//
//  What this catches: a NEW endpoint shipped with no auth line at all (it
//  won't be in the registry → fail), and an EDIT that strips the auth call
//  from an existing endpoint (its required marker disappears → fail).
//
//  Adding a file? Register it here with its posture and — for public/lib —
//  one honest sentence on why it's safe with no auth.
// ============================================================
error_reporting(E_ALL);

$fail = 0;
$pass = 0;
function ap_check($name, $cond)
{
    global $fail, $pass;
    if ($cond) {
        $pass++;
        echo "  \xE2\x9C\x93 $name\n";
    } else {
        $fail++;
        echo "  \xE2\x9C\x97 $name\n";
    }
}

// Marker shorthands (literal substrings the file must contain).
$ADMIN = 'require_admin(';
$GUEST = 'require_guest(';
$CRON = 'hash_equals(APP_SECRET'; // the ?cron=APP_SECRET check
$TOKEN = 'hash_equals(';          // signed one-tap / feed / pay tokens
$RATE = 'rate_limit(';

// posture => which markers a claim of that kind implies by default.
// Each entry: file => [kind, [extra markers], 'reason (public/lib/page/dev only)']
$REGISTRY = [
    // ---- Owner-only JSON endpoints -------------------------------------
    'accounts.php' => ['admin'],
    'activity-log.php' => ['admin'],
    'activity.php' => ['admin'],
    'admin-bootstrap.php' => ['admin'],
    'bookings.php' => ['admin'],
    'content.php' => ['admin'], // public GET serves site content; every write is admin
    'cron-status.php' => ['admin'],
    'customers.php' => ['admin'],
    'diagnostics.php' => ['admin'],
    'email-samples.php' => ['admin'],
    'expenses.php' => ['admin'],
    'mailbox.php' => ['admin'],
    'notify-recipients.php' => ['admin'],
    'optimize-hero.php' => ['admin'],
    'pricing-suggest.php' => ['admin'],
    'rates.php' => ['admin'], // public GET lists live rates; every write is admin
    'search.php' => ['admin'],
    'square-setup.php' => ['admin'],
    'testcentre.php' => ['admin'],
    'track.php' => ['admin'],
    'upload.php' => ['admin'],
    'webp-backfill.php' => ['admin'],

    // ---- Owner OR cron secret (daily jobs, admin-triggerable) -----------
    'anniversary-nudge.php' => ['admin', [$CRON]],
    'backup.php' => ['admin', [$CRON]],
    'conflict-audit.php' => ['admin', [$CRON]],
    'cron.php' => ['admin', [$CRON]],
    'direct-followup.php' => ['admin', [$CRON]],
    'enquiry-nudge.php' => ['admin', [$CRON]],
    'ical-import.php' => ['admin', [$CRON]],
    'mailbox-read.php' => ['admin', [$CRON]],
    'migrate.php' => ['admin', [$CRON]],
    'owner-digest.php' => ['admin', [$CRON]],
    'payments-due.php' => ['admin', [$CRON]],
    'pre-arrival.php' => ['admin', [$CRON]],
    'self-repair.php' => ['admin', [$CRON]],
    'weekly-analytics.php' => ['admin', [$CRON]],

    // ---- Guest-session endpoints ----------------------------------------
    'arrival-access.php' => ['guest'],
    'welcome.php' => ['guest'],

    // ---- Serve both roles ------------------------------------------------
    'experiences.php' => ['admin', [$GUEST]], // GET public, guest suggest, admin moderate
    'my-bookings.php' => ['guest', [$ADMIN]], // guest's own stays; admin path powers the account preview
    'photos.php' => ['admin', [$GUEST]],
    'push.php' => ['admin', [$GUEST, $CRON]],
    'reviews.php' => ['admin', [$GUEST]],
    'passkeys.php' => ['admin', [$GUEST, $RATE]],

    // ---- Public actions guarded by rate limit (+ admin for their back office half)
    'auth.php' => ['admin', [$RATE]], // login/magic-link are public by nature; throttled
    'chat-upload.php' => ['admin', [$RATE]],
    'enquiries.php' => ['admin', [$RATE]],
    'leads.php' => ['admin', [$RATE]],
    'messages.php' => ['admin', [$RATE]],
    'newsletter.php' => ['admin', [$RATE]],
    'waitlist.php' => ['admin', [$RATE]],

    // ---- Public, rate-limited only ---------------------------------------
    'client-error.php' => ['ratelimited', [], 'anonymous error reports; size-capped + deduped server-side'],
    'guest-details.php' => ['ratelimited', [$TOKEN], 'registration form reached by a signed booking token'],
    'guest-faq.php' => ['ratelimited', [], 'guest FAQ-miss capture; pure merge into one capped content key'],
    'postcode-lookup.php' => ['ratelimited', [], 'address lookup proxy for the enquiry form'],

    // ---- Signed-token endpoints (no session; the unguessable token IS the auth)
    'email-optout.php' => ['token'],
    'enquiry-action.php' => ['token'],
    'ical-export.php' => ['token'],
    'invoice.php' => ['token'],
    'pay.php' => ['token', [$RATE]], // pay_token authorises paying THIS booking only

    // ---- Webhooks (shared secret / signature) ----------------------------
    'inbound-mail.php' => ['webhook', ['INBOUND_SECRET', $TOKEN]],
    'square-webhook.php' => ['webhook', ['square_webhook_signing_key']],

    // ---- Deliberately public (reason required) ----------------------------
    'availability.php' => ['public', [], 'booked date RANGES only (no names/PII) — the booking form needs them'],
    'bootstrap.php' => ['public', [], 'first-paint aggregate of the public rates/content/reviews payloads'],
    'csp-report.php' => ['public', [], 'CSP report sink: sanitised, size-capped, deduped hourly — cannot flood'],
    'img.php' => ['public', [], 'image resizer restricted to files under uploads/'],
    'review.php' => ['public', [], 'the public review-request landing page'],
    'sitemap.php' => ['public', [], 'sitemap.xml for crawlers'],
    'square-config.php' => ['public', [], 'the public Square application id the pay page needs'],
    'status.php' => ['public', [], 'public status page (no internals beyond up/down)'],
    'tide-data.php' => ['public', [], 'tide times for the guest pages (public data)'],
    'tides.php' => ['public', [], 'tide widget data (API key stays server-side)'],
    'version.php' => ['public', [], 'the build stamp probe the update check polls'],

    // ---- Public HTML routes (SEO / infrastructure pages) -------------------
    'blocked.php' => ['page', [], 'the request-firewall block page'],
    'cottage.php' => ['page', [], '/cottages/<slug> server-rendered for crawlers'],
    'experiences-page.php' => ['page', [], '/experiences server-rendered for crawlers'],
    'hero-shell.php' => ['page', [], 'hero-image shell used by the SEO routes'],
    'home.php' => ['page', [], '/ server-rendered for crawlers'],
    'staging-gate.php' => ['page', [], 'staging-host gate page (no-op in production)'],

    // ---- Include-only libraries (no routing; requesting them runs nothing) --
    'activity-lib.php' => ['lib', [], 'log_activity helpers'],
    'analytics-data.php' => ['lib', [], 'analytics_summary() shared by track.php + the digest'],
    'chat-lib.php' => ['lib', [], 'chat thread helpers'],
    'config.php' => ['lib', [], 'constants only'],
    'customers-lib.php' => ['lib', [], 'customers_group()/customers_key() shared client/server rule'],
    'db.php' => ['lib', [], 'the bootstrap every endpoint includes (defines the auth helpers themselves)'],
    'enquiry-actions.php' => ['lib', [], 'shared approve/decline logic'],
    'image-save.php' => ['lib', [], 'save_uploaded_image() shared by upload.php + photos.php'],
    'mailer.php' => ['lib', [], 'smtp_send + send_* builders'],
    'payments-reconcile.php' => ['lib', [], 'fee/refund reconciliation shared by bookings.php + self-repair'],
    'pricing.php' => ['lib', [], 'price_breakdown() — the authoritative price model'],
    'sms.php' => ['lib', [], 'optional Twilio sender, no-op until configured'],
    'webpush.php' => ['lib', [], 'VAPID web-push sender'],

    // ---- Dev tools: never deployed (verified against deploy.yml below) -----
    'health.php' => ['dev', [], 'local health probe'],
    'setup.php' => ['dev', [], 'one-time first-admin creator'],
    'vapid-keygen.php' => ['dev', [], 'one-time VAPID key generator'],
];

// What each kind requires in the file by default.
$KIND_MARKERS = [
    'admin' => [$ADMIN],
    'guest' => [$GUEST],
    'ratelimited' => [$RATE],
    'token' => [$TOKEN],
    'webhook' => [],
    'public' => [],
    'page' => [],
    'lib' => [],
    'dev' => [],
];
$NEEDS_REASON = ['public', 'page', 'lib', 'dev'];

echo "\n== Auth posture (every web-reachable endpoint declares + proves its guard) ==\n";

$files = array_map('basename', glob(__DIR__ . '/*.php'));
$files = array_values(array_filter($files, fn($f) => strpos($f, 'test-') !== 0));

// 1. Completeness both ways.
$unregistered = array_diff($files, array_keys($REGISTRY));
ap_check('every endpoint is registered' . ($unregistered ? ' — add to the registry: ' . implode(', ', $unregistered) : ''), !$unregistered);
$stale = array_diff(array_keys($REGISTRY), $files);
ap_check('no stale registry entries' . ($stale ? ' — remove: ' . implode(', ', $stale) : ''), !$stale);

// 2. Verify each claim's markers (and reasons where required).
foreach ($REGISTRY as $file => $entry) {
    if (!in_array($file, $files, true)) {
        continue; // already reported stale
    }
    $kind = $entry[0];
    $markers = array_merge($KIND_MARKERS[$kind] ?? [], $entry[1] ?? []);
    $reason = $entry[2] ?? '';
    $src = (string) file_get_contents(__DIR__ . '/' . $file);
    $missing = array_values(array_filter($markers, fn($m) => strpos($src, $m) === false));
    if ($missing) {
        ap_check("$file [$kind] — MISSING guard marker(s): " . implode(', ', $missing), false);
        continue;
    }
    if (in_array($kind, $NEEDS_REASON, true) && trim($reason) === '') {
        ap_check("$file [$kind] — a public/lib/page/dev claim needs a reason", false);
        continue;
    }
    ap_check("$file — $kind" . ($markers ? ' (' . count($markers) . ' marker' . (count($markers) > 1 ? 's' : '') . ' verified)' : ': ' . $reason), true);
}

// 3. 'dev' files must be excluded from BOTH deploy jobs (they never reach the host).
$deploy = (string) file_get_contents(dirname(__DIR__) . '/.github/workflows/deploy.yml');
foreach ($REGISTRY as $file => $entry) {
    if (($entry[0] ?? '') !== 'dev') {
        continue;
    }
    ap_check("dev tool '$file' is excluded from deploy (both jobs)", substr_count($deploy, '"$OUT/' . $file . '"') >= 2);
}

echo "\n== Summary ==\n";
if ($fail) {
    echo "  $fail CHECK(S) FAILED \xE2\x9D\x8C\n\n";
    exit(1);
}
echo "  ALL $pass CHECKS PASSED \xE2\x9C\x85\n\n";
exit(0);
