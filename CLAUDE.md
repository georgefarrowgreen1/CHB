# CHB — working notes for Claude

Cottage Holidays Blakeney: a 3-cottage family holiday-let site. The frontend is a
single large `Cottage Holidays Blakeney/index.html` (vanilla JS + inline CSS, **no
build step**); PHP backend files sit alongside it. App-style guest shell lives in
`guest-app.js` / `guest-app.css`.

## Workflow preferences
- **Always merge.** When a PR is opened for completed, verified work, squash-merge it
  to `main` without asking first (then sync the branch to main). Skip only if CI is
  failing or the work is explicitly a draft/WIP.

## Deploy checklist (do this whenever shipping frontend changes)
- Bump `const BUILD` — it now lives in **`app.js`** (last statement), not index.html.
- Bump `CACHE` in `sw.js`, and the `?v=` query on whichever of `app.css` / `app.js` /
  `guest-app.css` / `guest-app.js` you changed — in BOTH `index.html` and the `sw.js`
  CORE list.
- If **`admin.js`** changed, bump `ADMIN_BUNDLE_V` (top of app.js, in the facade) —
  that's its cache-buster; admin.js has no `<script>` tag and is NOT in sw.js CORE.
- Run `node smoke-test.js` and `php test-pricing.php` — must pass (CI runs both).

## Conventions
- Owner content editing lives in **Settings**: "Website content" (global homepage/nav
  text + images) and Preferences → [cottage] → Photos / Text (per-cottage). The old
  inline live editor is fully REMOVED (code + CSS). Content
  is APPLIED to the page via the `data-edit-*` attributes + `applyContentOverrides`
  (reads `siteContent`), and galleries via `images-<prop>` — do NOT remove those;
  they're the rendering path, not an editing UI.
- Responsive: prefer the four canonical breakpoints (480 / 640 / 900 / 1200) for new
  media queries; migrate stray one-off widths opportunistically when touched.
- **Design system**: `Cottage Holidays Blakeney/DESIGN.md` is the design language —
  build from the `:root` tokens in app.css (radius `--r-*` incl. `--r-panel`, status
  `--ok/--warn/--danger`, shadows `--shadow-*`, easings `--fluid-bezier/--spring`);
  never introduce new raw hex/px/easing values for things a token covers.
- Guest mobile shell CSS/JS is gated to `body.guest-app:not(.owner-mode)` so admin
  (`owner-mode`) and desktop are never affected. Keep new shell rules gated the same way.
- The site deploys from `main`; the repo is cloned fresh each session (ephemeral
  container), so anything that must persist has to be committed.

## Architecture map
Single-operator holiday-let PWA. No framework, no build step.

**Frontend** (no inline blobs anymore — CSS and JS are extracted into cached files)
- `index.html` (~144KB) — markup + `<head>` only: `<main class="page-view">` sections
  toggled by `nav(viewId)`; `currentGuest`/`isAuthenticated` + `body.owner-mode`/
  `body.guest-app` classes drive what shows. Links `app.css`, then `app.js`, then
  `guest-app.js`.
- `app.css` — the main stylesheet (was the inline `<style>`).
- `app.js` — the PUBLIC app (guest site + shared helpers + auth) as globals that
  inline `onclick`s call. `const BUILD` (last statement) is the version stamp.
  Loads before `guest-app.js`.
- `admin.js` — the owner back office, split out so guests never download it.
  Fetched on demand by `loadAdminBundle()` (facade at the top of app.js): eagerly
  from `setAuthUI()` on any owner sign-in / session restore, lazily via the
  generated **stub list** (async `window.*` stubs that load the bundle then
  delegate; admin.js's footer publishes the real fns over them and sets
  `__ADMIN_LOADED`). Rules: admin.js may use any app.js global; app.js/guest-app.js
  must NOT reference admin names except via the stub list; shared state stays in
  app.js; nothing admin runs on public boot (a stub call there would make every
  guest fetch the bundle — see the `__ADMIN_LOADED` guard in
  `loadSquareAdminConfig`). smoke-test.js §1 enforces the facade contract
  (evaluates both files, all stubs replaced) and 6a/6c check handlers + that
  admin.js stays OUT of the sw.js CORE precache.
- `guest-app.js` / `guest-app.css` — the mobile app shell only (the floating dock,
  full-page overlays, install chip). Loaded with `?v=` and gated as above.
- Routing is `nav()` toggling `.page-view.active`; per-view init lives in `nav()`
  (e.g. `view-experiences` → `renderExperiencesView()`). No router lib.

**Back-office IA** — the admin dock (`body.owner-mode`) has 4 buttons, each a task
area, not a settings dump: **Today** (`view-backoffice` — the OPERATIONS workspace:
the **Needs-you strip** first (`renderNeedsYou()` — ONE prioritised to-do list:
automation warnings, waiting enquiries, balances to chase ≤21 days out, damages
deposits to return, chats, approvals; each row one-tap-routes to the exact
hub/screen; hidden when clear), then the timeline calendar, then the bookings
master–detail — filters/search/`.bk-row`
index + the `#bookings-detail-pane` docked hub at ≥1200px; `openBookings()` survives
as an alias that lands here and scrolls to `#bookings-workspace`;
`dock-badge-enquiries` pip), **Inbox** (`openInbox()` → `view-inbox` — the COMMS
dashboard: an **Enquiries | Messages | Email** folder switch (`inboxFolder()`,
`#inbox-folder-*` containers, `.ifold-count` chips). At ≥1200px the Inbox is an
APPLE-MAIL three-pane client: the folder switch becomes a left sidebar rail, the
active folder's list is the middle column, and `#inbox-detail-pane` is a reading
pane serving EVERY folder — the enquiry hub docks as before, emails open in the
pane (`mbxPaneDock()`; row highlight `.is-open`; below 1200px they open as an
in-row accordion, `mbxSlotFor()`), and guest chats dock the `#messages-modal`
node into the pane as a static panel (undocked on folder switch; app.js
`openMessageThread` self-heals the dock via DOM checks only — never admin
globals). Email is the full mailbox client (`loadMailbox()`/`mailbox.php`, lazy
on first open — moved from Manage, and `settingsOpen('mailbox')` redirects
here); `inboxSub()` sub-folders via
`INBOX_SUBS`; `dock-badge-inbox` pip), **Payments** (`openAccounts()` →
`view-accounts` — dock label/titles say "Payments" but the internal ids keep
their names (`asec-*`, `#money-overview`);
`accountsOpen(id)` → `#asec-<id>`, incl. the pricing coach), and
**Manage** (`openArea()` → `view-settings`, ONE index — cottages, then marketing, then
account/system, grouped by `.settings-section-label`s; the old per-area filtering is
gone but `applyAreaFilter()` keeps its name as the open/return repaint; a row opens
via `settingsOpen(id)` → `#sec-<id>`; the health/cron pills + Activity log live
here). `ADMIN_VIEWS` is the
canonical admin-screen list (used by `nav()`/`forceAdminLogout()`) — keep it complete.
The two dock pips both show `enquiries.length`, synced from `refreshInboxBadge()`.
**Assist NLU cascade** — three tiers in `chbNluClassify` (admin.js), each consulted only
when the previous abstains: tier 1 TF-IDF centroid cosine, tier 2 kNN+ELM fusion, tier 3
`CHB_EMBED` — a MiniLM-class SEMANTIC model (Model2Vec potion-base-8M distilled static
embeddings, bge WordPiece) packed by `embed-build.js` (dev-only, deploy-excluded) into
**`assist-embed.bin`** (int8+scales, ~7.6MB, committed + deployed; versioned by its `?v=`
in CHB_EMBED.url). Pure JS — no WASM/CSP change; lazy owner-only fetch ~2.5s after the
admin bundle boots (until it lands the cascade is lexical-only, as before). Measured:
48→51/52 held-out, zero wrong intents, all negatives rejected (search-test §20 is the CI
gate — recoveries, negatives, train accuracy, teach-loop reach). chbNluLearn/Suppress
call `chbEmbedIndex()` so taught phrases join their intent centroid and suppressed ones
join the none pool.

**Assist Bars** — the palette's brain embedded IN workspaces: `chbAssistBar(hostId, opts)`
(admin.js) injects a knot+input bar into static host divs (`#abar-today` top of the Today
operations workspace, `#abar-inbox` above the Inbox folder switch / atop the list column at
≥1200px), registered in `chbAssistInitBars()` (admin boot footer — guests never load any of
it). Routing per keystroke is WORKSPACE-FIRST: terms matching the board's `[data-search]`
rows live-filter (shared dim machinery; count in the bar; the palette's "filter this
workspace" adopts INTO the bar via `abarAdopt`, so no floating banner where a bar exists;
the Inbox bar adds per-folder `.ifold-match` pills + hides the unread chips while
filtering); otherwise `cmdkBuildResults()` answers INLINE with the palette's own rows
(chips/actions/`_nlu` learning intact); zero matches → deep-search CTA + ask chips. Full
intelligence parity: per-bar green `ml-active` knot / orange `ml-learning` flash, walk-away
(focusout) dead-end capture into the shared miss store, `__cmdkConvCtx` carries across
bars↔palette, and a per-bar mic via `chbVoiceStart()` (one recognition session shared;
final dictations get spoken answers). Suites: `ui-test-assist-{today,inbox,parity}.js`;
the layout gate asserts both bars render.

**Hubs are where you act; index rows are where you find.** The **booking hub**
(`view-booking-hub`) is the ONE home per booking — `showDetails()` (app.js) only
delegates to `openBookingHub()` (admin.js): status pipeline + next action, money,
emails, guest, change history via `bookings.php` `history`; on desktop (≥900px)
the status pipeline shows ALL stages (upcoming = red dot), compact Done·Now·Next
below that; the settled Payments card folds to one line carrying the deposit
state (incl./excl.) with the standalone deposit row only when it has an action.
The **enquiry hub**
(`view-enquiry-hub`, `openEnquiryHub()`) is the same for enquiries — approve/edit/
email/decline + agreed price live there; approving jumps to the new booking's hub
(`enquiries.php` returns `booking_id`). At ≥1200px both the Today workspace and the
Inbox dock their hub in a side pane (master–detail; the `#booking-hub-content` /
`#enquiry-hub-content` nodes re-parent between pane and standalone view, incl. live
on crossing 1200px). Index rows
share the `.bk-row` three-line anatomy. The Today calendar is a horizontal
multi-cottage TIMELINE (`renderCalendar()` in admin.js, `.tl-*` CSS): one lane per
cottage, sticky labels; the window ALWAYS starts on the 1st of the current month
(`tlStartOffset()`), opens there, and GROWS endlessly — nearing the right edge
extends it ~3 months in place (`tlMaybeExtend()`, scroll preserved). Its bars
are launchers, not editors —
tapping a booking bar opens `openBookingHub()`, tapping a free future cell calls
`tlAddAt(propKey, iso)` to prefill the Add Booking modal; no other editing lives
on the calendar. External iCal bars (`.tl-ext`) stay display-only (the auto-sync
owns their lifecycle; `#details-modal` is gone and `closeDetailsModal()` survives
as a defensive no-op). New booking/enquiry
actions belong on the hubs, not new surfaces. Dates display DD/MM/YYYY everywhere
(`fmtDate()` JS / `uk_date()` PHP); storage, APIs and ICS stay ISO.

**Backend** — flat PHP in the same folder, each a small JSON endpoint. Helpers in
`db.php`: `db()` (lazy PDO), `body()`, `json_out()`, `clean()`, `require_admin()`,
`require_guest()`, `site_base_url()`, `content_value()`. Key endpoints: `auth.php`
(guest/admin sessions, magic link), `enquiries.php`, `pay.php` (Square),
`pricing.php` (authoritative price model), `reviews.php`/`photos.php`/`experiences.php`
(moderated guest UGC: GET public, `suggest`/`submit` guest, admin list/approve/reject),
`messages.php` (chat), `webpush.php` (`alert_owner`, `notify_guest`), `mailer.php`
(`smtp_send`, `send_*`). Crons run daily via `cron.php` (pre-arrival, payments-due,
tide-push, push checkin, enquiry-nudge).

**Accommodations are dynamic** — the owner adds/removes cottages from the back office
(Settings → Preferences → "Add accommodation"; per-cottage "Remove" / "Restore"). The
`properties` table is the single source of truth (`prop_key`, `name`, `couple_rate`…,
plus `archived_at`, `slug`, `accent`, `sort_order`, `max_adults/children/total` — see
`migration-accommodations.sql`). `rates.php` actions: `create` (name + couple rate →
generates key/slug/accent), `archive`/`unarchive` (soft-remove; **never hard-delete** —
past bookings/payments/emails key off `prop_key`), `save` (extended to name/slug/accent/
occupancy). All payment/booking logic works for any cottage with a row. On the front end
`loadRates()` synthesizes `propertyMeta`/`propertyContent`/`propSubtitleDefault`/
`COTTAGE_SLUGS` for every row, `injectPropColors()` gives added cottages a runtime accent,
and `renderCottageCards()` rebuilds `#cottages` from the live list; `db.php` `occupancy_limits()`
+ `prop_display()` and the email files (`mailer.php`/`owner-digest.php`/`enquiry-nudge.php`)
read the rows too. The hardcoded JS maps + PHP fallbacks now only cover the original three
offline / pre-migration. SEO is dynamic end-to-end: `sitemap.php` (rewritten from
`/sitemap.xml`) and the JSON-LD (`injectStructuredData()` after `loadRates()`) both follow
the live cottage list, and **`cottage.php`** serves `/cottages/<slug>` (rewrite in
`htaccess.txt`) — it returns index.html with that cottage's title/meta/og/h1/description
injected server-side for crawlers (keys `<prop_key>-title/-subtitle/-desc` from the content
table, falling back to the properties row; og:image = the cottage's first gallery photo;
unknown slugs return a real 404). **`experiences-page.php`** serves `/experiences` (published
things-to-do rendered into `#exp-grid` for crawlers; app.js opens the view for the path), and
**`home.php`** serves `/` the same way, swapping the live
uploaded hero (content key `hero-bg`) into the LCP preload, og:/twitter:/JSON-LD images and
the hero element — the static `hero.jpg` does NOT exist on the live host (it 404s), so never
"fix" references back to it; the auth modals' brand panel gets it via `--hero-img` (set in
`applyContentOverrides`). Both PHP routes regex-target exact markup anchors in index.html —
smoke-test §6g/§6h guard them; if you move that markup, update cottage.php/home.php too.
They're deliberately standalone (own PDO, not db.php — `db()` exits with JSON on failure,
which would corrupt these HTML routes); on ANY error they serve index.html untouched.

**Data / migrations** — MySQL. Schema in `schema.sql`; changes ship as
`migration-*.sql` applied by `migrate.php` (admin visit or `?cron=APP_SECRET`, or
Settings → System check → Run migrations). Migrations are idempotent
(`CREATE TABLE IF NOT EXISTS`, guarded `ADD COLUMN`). Most owner-editable content
lives as JSON in the `content` table (`welcome-<prop>`, `faqs-<prop>`, etc.).

**Gotchas**
- The price model is duplicated: JS `priceBreakdown()` (index.html) must stay in
  lockstep with PHP `price_breakdown()` (pricing.php). `smoke-test.js` §2 tests the
  JS side and `test-pricing.php` the PHP side against the SAME fixtures — keep both
  green when touching pricing.
- **`total` is RENTAL ONLY** (nightly + txn). The refundable damages deposit is returned
  by the price model as `damagesDeposit` but is NOT in `total`. Current model: it is
  **CHARGED together with the guest's first payment** (`pay.php` bundles `damagesDue`
  when `hold_status='none'` → `'charged'`) and **refunded after checkout** via
  `bookings.php` `return_deposit` (or `keep_deposit` when there was damage →
  `'returned'`/`'kept'`); state lives in the reused `bookings.hold_*` columns. Wording
  everywhere (guest + admin) says "charged with your first payment, refunded after your
  stay" — NOT "held". A LEGACY Square card **HOLD** flow (authorise → capture/release;
  `hold_request`/`hold_link`/`hold_capture`/`hold_release`, ?hold= pay screen + emails)
  still exists for old bookings — only there is "held, not charged" wording correct.
  self-repair marks `authorized` rows older than Square's ~6-day auth window `expired`.
- Offscreen `.page-view`s are `display:none`, so their CSS background-images aren't
  fetched until shown (built-in lazy-loading). The hero is the LCP image
  (`fetchpriority="high"` preload) — keep it prioritised, not deferred.
- Dev/CI-only files (`smoke-test.js`, `test-pricing.php`, `*.md`, `*.sql` are shipped
  for migrate but `.htaccess`-denied) are excluded from the deploy in `deploy.yml`.
- **Staging sandbox** (optional, opt-in): `deploy.yml` has a `deploy-staging` job that
  mirrors the same code to a `staging.<domain>` site with its OWN database + `config.php`
  (Square sandbox + test email) — a true isolated environment. It's a no-op until the
  `STAGING_SFTP_*` secrets are set (see `SETUP-STAGING.md`). On the staging host only,
  `.htaccess` sends `X-Robots-Tag: noindex` and `app.js` (`IS_STAGING`) shows a STAGING
  banner. Staging post-deploy is migrate-only (never fires owner notify/digest/nudge).

## Testing / CI
- Before shipping: `node smoke-test.js` (loads index.html + admin.js in a shim;
  pricing, postcode, occupancy, structural + facade-stub checks) and
  `php test-pricing.php`.
- `.github/workflows/ci.yml` runs `php -l` on every PHP, `node smoke-test.js`,
  `php test-pricing.php`, `php test-reply.php`, the real-browser `node e2e-test.js`,
  and the design gate `node layout-test.js` (layout invariants — no horizontal
  overflow, no content cut off, key content rendered — on the public views at
  390/768/1280 AND the six back-office screens at phone width; screenshots
  uploaded as the `layout-shots` CI artifact) on each PR — merge only on green.
  `deploy.yml` SFTP-deploys `main` to IONOS (never deletes remote files; preserves
  `config.php` + `uploads/`).

## Self-repair & error reporting
- Errors: client capture (app.js, third-party webview noise filtered, sends
  stack/build/view) + server capture (db.php exception/shutdown handlers) both
  land in the activity log as warn ("Needs attention" + weekly digest), deduped
  1h, with an owner push at most every 6h. A stale-cache signature ("… is not
  defined" from our own assets) triggers a ONE-per-tab cache purge + reload
  (self-heal) before reporting.
- `self-repair.php` (daily via cron.php) fixes safe state drift — dead gallery
  references, card-hold auths past Square's window, missing slug/accent — and
  FLAGS ambiguous things (orphaned payment rows) without touching them. Never
  auto-change production code; code fixes go through PRs + CI like everything else.
