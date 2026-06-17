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
- Run `node smoke-test.js` and `php test-pricing.php` — must pass (CI runs both).

## Conventions
- Owner content editing lives in **Settings**: "Website content" (global homepage/nav
  text + images) and Preferences → [cottage] → Photos / Text (per-cottage). The old
  inline live editor is retired — `handleEditToggle` / `body.edit-mode` remain dormant
  (unused). Content is still APPLIED to the page via the `data-edit-*` attributes +
  `applyContentOverrides` (reads `siteContent`), and galleries via `images-<prop>` —
  do NOT remove those; they're the rendering path, not the editing UI.
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
- `app.js` — the whole app: all the page logic + globals that inline `onclick`s call.
  `const BUILD` (last statement) is the version stamp. Loads before `guest-app.js`.
- `guest-app.js` / `guest-app.css` — the mobile app shell only (the floating dock,
  full-page overlays, install chip). Loaded with `?v=` and gated as above.
- Routing is `nav()` toggling `.page-view.active`; per-view init lives in `nav()`
  (e.g. `view-experiences` → `renderExperiencesView()`). No router lib.

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
offline / pre-migration. Known minor gaps: `index.html` JSON-LD and `sitemap.xml` still list
only the original three (added cottages stay crawlable via their `/cottages/<slug>` links).

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
- Before shipping: `node smoke-test.js` (loads index.html in a shim; pricing,
  postcode, occupancy, structural checks) and `php test-pricing.php`.
- `.github/workflows/ci.yml` runs `php -l` on every PHP, `node smoke-test.js`, and
  `php test-pricing.php` on each PR — merge only on green. `deploy.yml` SFTP-deploys
  `main` to IONOS (never deletes remote files; preserves `config.php` + `uploads/`).
