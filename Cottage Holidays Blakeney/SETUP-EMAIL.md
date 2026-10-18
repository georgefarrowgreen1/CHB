# Email setup — booking confirmations

The site sends a branded confirmation email to the guest (and a notification to
you) when you approve an enquiry, add a booking with a guest email, or press
"✉ Send confirmation email" in a booking's details.

## 1. Add the email block to config.php

IMPORTANT: do NOT overwrite your live config.php (it holds your database
password). Instead, EDIT it and add these lines if they're not already there:

    define('MAIL_ENABLED', true);
    define('SMTP_HOST', 'smtp.ionos.co.uk');
    define('SMTP_PORT', 587);
    define('SMTP_SECURE', 'tls');
    define('SMTP_USER', 'bookings@yourdomain.co.uk');   // full mailbox address
    define('SMTP_PASS', 'your-mailbox-password');
    define('MAIL_FROM', 'bookings@yourdomain.co.uk');    // usually same as SMTP_USER
    define('MAIL_FROM_NAME', 'Cottage Holidays Blakeney');
    define('OWNER_NOTIFY_EMAIL', 'you@yourdomain.co.uk'); // where owner copies go

## 2. IONOS mailbox

Create (or use) a mailbox in IONOS for the bookings address. The SMTP settings
above are IONOS's standard ones (host smtp.ionos.co.uk, port 587, TLS).

## Using Gmail instead

    define('SMTP_HOST', 'smtp.gmail.com');
    define('SMTP_PORT', 587);
    define('SMTP_SECURE', 'tls');
    define('SMTP_USER', 'youraddress@gmail.com');
    define('SMTP_PASS', 'an-app-password');   // NOT your normal password —
                                              // create one at myaccount.google.com
                                              // → Security → App passwords
    define('MAIL_FROM', 'youraddress@gmail.com');

## Automatic pre-arrival emails (optional)

Guests can automatically receive an "arrival information" email 3 days before
check-in (directions, key collection, wifi — whatever you write per cottage in
Settings & Fees → "Arrival info email").

1. Run `migration-pre-arrival.sql` once in phpMyAdmin.
2. In IONOS, create a DAILY cron job pointing at the daily jobs' address that
   Manage → Status shows (`https://YOURDOMAIN/YOURFOLDER/cron.php/JOB_KEY`); it
   runs this and every other scheduled task.
3. To change how many days before check-in it sends, add to config.php:
   `define('PRE_ARRIVAL_DAYS', 3);`

Each booking gets the email once (never repeated). You can also send it manually
per booking from the back office ("📩 Send arrival info" in the booking details).

## Daily cron jobs (one place)

The site does its scheduled work through small URLs you "ping" once a day.

### Simplest: one cron job for everything (recommended)

In the IONOS control panel, create **a single DAILY cron job** pointing at:

```
https://YOURDOMAIN/YOURFOLDER/cron.php/JOB_KEY
```

`cron.php` runs every scheduled task in turn, so you only manage one job. That's
all you need. **Copy the exact address from Manage → Status** ("Daily jobs'
address"): `JOB_KEY` is the jobs' own key, worked out from `APP_SECRET`.

> **Never put `APP_SECRET` in a cron address.** The web server keeps a log of every
> address it is asked for, and `APP_SECRET` is the key that encrypts the door codes
> and private photos. The job key can only start the scheduled jobs. (An old
> address with `APP_SECRET` still works, and Status says so until it is changed.)

> **No "?" needed.** IONOS (and some other panels) won't accept a `?` in the cron
> URL, so the key goes after a slash as shown above (`cron.php/JOB_KEY`).
> If your panel *does* allow it, `cron.php?cron=JOB_KEY` works too.

### Or: one cron job per task

If you'd rather schedule them individually (e.g. to run some at different times),
create **one DAILY cron job per line below** instead of using `cron.php`. Replace
`YOURDOMAIN/YOURFOLDER` with your site, and `JOB_KEY` with the job key from the
address Manage → Status shows. Mid-morning is a good time. Each one is safe to run every day — it
only acts when there's something to do, and never repeats itself.

> These individual URLs use `?cron=…`, so they need a cron panel that allows a
> `?` in the URL. On IONOS (which doesn't), use the single `cron.php/JOB_KEY`
> job above instead.

```
https://YOURDOMAIN/YOURFOLDER/pre-arrival.php?cron=JOB_KEY
https://YOURDOMAIN/YOURFOLDER/payments-due.php?cron=JOB_KEY
https://YOURDOMAIN/YOURFOLDER/enquiry-nudge.php?cron=JOB_KEY
https://YOURDOMAIN/YOURFOLDER/owner-digest.php?cron=JOB_KEY
```

What each one does:

- **pre-arrival.php** — arrival-info emails a few days before check-in, **and**
  the post-stay review request (Google review button if you set the link in
  Settings → Reviews).
- **payments-due.php** — requests the balance as check-in approaches, chases
  unpaid balances, and recovers abandoned deposits (one gentle reminder).
- **enquiry-nudge.php** — a friendly follow-up to enquirers who haven't booked.
- **owner-digest.php** — your Monday-morning summary email. Self-limits to
  Mondays and at most once a day, so a daily ping is fine.

> These same URLs are also pinged automatically after every deploy, but a real
> daily cron is what makes the time-sensitive ones reliable.

