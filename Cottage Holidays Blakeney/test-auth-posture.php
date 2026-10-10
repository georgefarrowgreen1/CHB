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
    'money.php' => ['admin'],
    'activity-log.php' => ['admin'],
    'activity.php' => ['admin'],
    'admin-bootstrap.php' => ['admin'],
    'bookings.php' => ['admin'],
    'content.php' => ['admin'], // public GET serves site content; every write is admin
    'cron-status.php' => ['admin'],
    'customers.php' => ['admin'],
    'keysafe.php' => ['admin'],
    'people.php' => ['admin', ['require_full_access(']], // People & access: full access only
    'diagnostics.php' => ['admin'],
    'email-samples.php' => ['admin'],
    'expenses.php' => ['admin'],
    'statements.php' => ['admin'], // the business bank account, read from exported statements
    'statement-lib.php' => ['lib', [], 'pure statement parsing + the reminder rule (no direct entry)'],
    'monzo.php' => ['admin'], // the Monzo Business live link
    'monzo-lib.php' => ['lib', [], 'pure decisions for the Monzo live link (no direct entry)'],
    'monzo-sync.php' => ['lib', [], 'the Monzo live link\'s API calls and storage (no direct entry)'],
    'split.php' => ['admin'], // whose money is whose (Payments)
    'split-lib.php' => ['lib', [], 'pure decisions for whose money is whose (no direct entry)'],
    'split-store.php' => ['lib', [], 'the split\'s settings and bank columns (no direct entry)'],
    'mailbox.php' => ['admin'],
    'notify-recipients.php' => ['admin'],
    'optimize-hero.php' => ['admin'],
    'pricing-suggest.php' => ['admin'],
    'pricing-suggest-lib.php' => ['lib', [], 'pure decisions for the pricing engine (no direct entry)'],
    'booking-rules-lib.php' => ['lib', [], 'the dated minimum stay + gap fit, shared by enquiries.php (no direct entry)'],
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
    'ical-lib.php' => ['lib', [], 'URL/response/parse judgement for the platform-calendar sync'],
    'jobs-lib.php' => ['lib', [], 'weekly_due / cron_result_ok for the scheduled jobs'],
    'booking-confirm-lib.php' => ['lib', [], 'the one booking confirmation, shared by bookings.php and enquiry approval (404s direct)'],
    'waitlist-lib.php' => ['lib', [], 'who a freed range should be told about — split out so it can be tested without the router'],
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
    'experiences.php' => ['admin', [$GUEST]], // list: booked guests + owner only (viewer_has_booked), guest suggest, admin moderate
    'my-bookings.php' => ['guest', [$ADMIN]], // guest's own stays; admin path powers the account preview
    'avatar.php' => ['guest', [$ADMIN, 'chat_team_member_ok(']], // a guest's own profile photo; the owner reads it by ?email=; a back-office person's photo is public (?team=) only while they are shown in the guest chat
    'guest-checkout.php' => ['guest'], // the "we've left" tap — one guest-scoped write, its own door (my-bookings stays read-only)
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
    'monzo-callback.php' => ['token', [$RATE]], // the single-use connect state (sha256, 15 min) authorises it, not a session

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
    'nightshift.php' => ['public', [], 'RETIRED: answers 410 and nothing else, replacing the removed Mac assistant endpoint on the host (the deploy never deletes files)'],
    'square-config.php' => ['public', [], 'the public Square application id the pay page needs'],
    'status.php' => ['public', [], 'public status page (no internals beyond up/down)'],
    'tide-data.php' => ['public', [], 'tide times for the guest pages (public data)'],
    'tides.php' => ['public', [], 'tide widget data (API key stays server-side)'],
    'watchers-lib.php' => ['lib', [], 'pure rules for standing queries (no direct entry)'],
    'nightshift-lib.php' => ['lib', [], 'RETIRED: an empty file that replaces the removed Mac assistant library on the host (the deploy never deletes files)'],
    'keysafe-lib.php' => ['lib', [], 'the key safe keeper’s pure judgements (bad codes, generation, the reveal window); required by keysafe.php and my-bookings.php'],
    'watchers.php' => ['admin', ['require_admin'], "the owner's own standing queries — names cottages and dates"],
    'watchers-run.php' => ['cron', [], 'fires due watchers daily; manual run is POST + require_admin'],
    'autopay-lib.php' => ['lib', [], 'saves the agreed card and collects the balance on the day; required by autopay-run.php and pay.php (no entry of its own)'],
    'autopay-run.php' => ['cron', [], 'collects agreed balances daily, before the chasers; manual run is POST + require_admin'],
    'weather-data.php' => ['public', [], 'Blakeney forecast fetch + cache (no key; keyless upstream)'],
    'weather.php' => ['public', [], 'forecast for the owner brief + search answers (village weather is not sensitive)'],
    'version.php' => ['public', [], 'the build stamp probe the update check polls'],

    // ---- Public HTML routes (SEO / infrastructure pages) -------------------
    'blocked.php' => ['page', [], 'the request-firewall block page'],
    'cottage.php' => ['page', [], '/cottages/<slug> server-rendered for crawlers'],
    'experiences-page.php' => ['page', [], '/experiences shell (no list, noindex — booked guests only)'],
    'hero-shell.php' => ['page', [], 'hero-image shell used by the SEO routes'],
    'shell-etag.php' => ['page', [], 'conditional-GET ending shared by the three SSR shell routes'],
    'home.php' => ['page', [], '/ server-rendered for crawlers'],
    'staging-gate.php' => ['page', [], 'staging-host gate page (no-op in production)'],

    // ---- Include-only libraries (no routing; requesting them runs nothing) --
    'activity-lib.php' => ['lib', [], 'log_activity helpers'],
    'analytics-data.php' => ['lib', [], 'analytics_summary() shared by track.php + the digest'],
    'chat-lib.php' => ['lib', [], 'chat thread helpers'],
    'config.php' => ['lib', [], 'constants only'],
    'csp-lib.php' => ['lib', [], 'pure CSP severity/matcher for csp-report.php (no I/O, no entry)'],
    'backup-crypt.php' => ['lib', [], 'pure AES-256-CBC/PBKDF2 encryption of the weekly dump before it is emailed (openssl container format); required by backup.php, no entry point of its own'],
    'sweep-lib.php' => ['lib', [], 'pure safe-to-move arithmetic for accounts.php (no I/O, no entry)'],
    'money-lib.php' => ['lib', [], 'the one money ledger the Payments page reads (pure: events, position, books; no I/O)'],
    'bank-lib.php' => ['lib', [], 'Square linked-bank-account cache + the can-money-move decision; required by accounts.php, self-repair.php and square-setup.php (no entry of its own)'],
    'payouts-lib.php' => ['lib', [], 'Square payout cache + landed/on-its-way decisions; required by accounts.php, self-repair.php and square-setup.php (no entry of its own)'],
    'csp-policy.php' => ['lib', [], 'generated: returns the live CSP string for csp-report.php (no entry)'],
    'customers-lib.php' => ['lib', [], 'customers_group()/customers_key() shared client/server rule'],
    'people-lib.php' => ['lib', [], 'who may do what: the pure rules db.php enforces (no routes of its own)'],
    'session-lib.php' => ['lib', [], 'the session lifetime + the daily sweep of the session folder; required by db.php (no entry)'],
    'status-lib.php' => ['lib', [], 'status_week()/status_warn_kind() — the Status page\'s pure judgements'],
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
    // require_guest_proven() (db.php) is require_guest() plus the email-proof check —
    // it satisfies the guest marker. require_full_access() (db.php) is require_admin()
    // plus the full-access check — it satisfies the admin marker.
    $missing = array_values(array_filter($markers, fn($m) => strpos($src, $m) === false
        && !($m === $GUEST && strpos($src, 'require_guest_proven(') !== false)
        && !($m === $ADMIN && strpos($src, 'require_full_access(') !== false)));
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
