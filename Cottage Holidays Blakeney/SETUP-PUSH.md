# Web Push — transactional notifications (works with the app closed)

Web Push lets the site notify the **owner** and **guests** even when the browser
is closed — used for the transactional alerts the site already sends:

- **Owner** — new enquiry, new booking/payment, and other back-office alerts
  (`alert_owner` in `webpush.php`, fired from `enquiries.php`, `pay.php`, etc.).
- **Guest** — "payment received", "booking confirmed", "balance due" and message
  replies (`notify_guest` / `guest_ping_set`), fired from the flow that triggered
  them (no cron needed).

> **On GPS / "you're close" alerts:** the web can't read a phone's GPS while the
> browser is closed, so any geofenced "you've arrived" logic only works while the
> tab is open. Web Push covers the closed-app case using the transactional
> triggers above.

## One-time setup

### 1. Generate your VAPID keys
Deploy the files, then visit (logged in as admin):
```
https://YOURDOMAIN/vapid-keygen.php
```
It prints three `define(...)` lines. **Copy them into `config.php`** (replacing the
empty `VAPID_*` placeholders), set `VAPID_SUBJECT` to your email, save — then
**delete `vapid-keygen.php`** from the server.

### 2. Create the database table
Run the migration once (admin): `https://YOURDOMAIN/migrate.php`
(applies `migration-push.sql` — the `push_subscriptions` table).

No cron job is needed: transactional pushes fire from the action that triggers
them (a payment, a booking, an enquiry, a message reply).

## How guests opt in
Logged-in guests are offered notifications from the guest area; allowing them
subscribes that device. No VAPID keys configured = the whole feature stays
silently off.

## iPhone / iPad note
On iOS, Safari only allows Web Push if the guest first **adds the site to their
Home Screen** (Share → *Add to Home Screen*) and opens it from there. This is an
Apple restriction, not a site limitation. Android/Chrome and desktop work in the
browser directly.

## Files involved
`sw.js` (service worker), `manifest.json` (installable PWA), `push.php`
(subscribe/unsubscribe), `webpush.php` (VAPID sender + owner/guest notify),
`vapid-keygen.php` (run once, then delete), `migration-push.sql`.
