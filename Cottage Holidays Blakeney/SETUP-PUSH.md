# Web Push — check-in notifications (works with the app closed)

This sends a guest a notification at their **check-in time** — "Your cottage is
ready — tap to open your live arrival map and key code" — even if the browser is
closed. Tapping it opens the site, where the existing GPS flow reveals the live
map and (within 25m) the key code.

> **Why time-based, not "you're close"?** The web has no way to read a phone's GPS
> while the browser is closed, so a true geofenced "you're close/arrived" alert
> can only fire while the tab is open (that already works — see the on-arrival
> banner). Web Push covers the closed-app case using a *time* trigger instead.

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
(applies `migration-push.sql` — the `push_subscriptions` table + a
`checkin_push_sent` column on `bookings`).

### 3. Add the cron job
In IONOS, add a job that runs every ~15 minutes:
```
https://YOURDOMAIN/push.php?action=send_checkin&cron=YOUR_APP_SECRET
```
(`YOUR_APP_SECRET` = the `APP_SECRET` value in `config.php`.) Each booking is
pushed once, when its check-in time passes.

## How guests opt in
Logged-in guests with a current stay see a **"Get alerts"** button on the arrival
banner (and tapping **"Show now"** also asks). Allowing notifications subscribes
that device. No VAPID keys configured = the whole feature stays silently off.

## iPhone / iPad note
On iOS, Safari only allows Web Push if the guest first **adds the site to their
Home Screen** (Share → *Add to Home Screen*) and opens it from there. This is an
Apple restriction, not a site limitation. Android/Chrome and desktop work in the
browser directly.

## Files involved
`sw.js` (service worker), `manifest.json` (installable PWA), `push.php`
(subscribe/unsubscribe + cron send), `webpush.php` (VAPID sender),
`vapid-keygen.php` (run once, then delete), `migration-push.sql`.
