# Setting up Square online payments

Guests pay a **deposit now and the balance later**, by card, on our own site
(Square's secure card field). The owner sends a payment request from a booking's
details; nothing changes for guests until you switch it on.

## 1. Create a Square application
1. Sign in at <https://developer.squareup.com/apps> (free Square account).
2. **Create app** → open it. You'll see two environments: **Sandbox** (for testing)
   and **Production** (real money). Do Sandbox first.
3. From the app's **Credentials** page note, for the chosen environment:
   - **Application ID** (e.g. `sandbox-sq0idb-…`) — public.
   - **Access token** — SECRET.
4. From **Locations** note your **Location ID** (e.g. `L1AB2C3…`).

## 2. Add a webhook (recommended backstop)
1. In the app → **Webhooks → Subscriptions → Add endpoint**.
2. URL: `https://YOURDOMAIN/square-webhook.php`
3. Subscribe to events: `payment.created` and `payment.updated`.
4. Copy the **Signature key** — SECRET.

## 3. Fill in `config.php` on the server (never committed/deployed)
```php
define('SQUARE_PAYMENTS_ENABLED', true);            // turn it on
define('SQUARE_ENVIRONMENT', 'sandbox');            // 'production' when you go live
define('SQUARE_APPLICATION_ID', 'sandbox-sq0idb-…');
define('SQUARE_LOCATION_ID', 'L1AB2C3…');
define('SQUARE_ACCESS_TOKEN', '…secret…');
define('SQUARE_WEBHOOK_SIGNATURE_KEY', '…secret…');
define('SQUARE_WEBHOOK_URL', 'https://YOURDOMAIN/square-webhook.php'); // EXACT match
```

## 4. Run the database migration
Visit `https://YOURDOMAIN/migrate.php` while logged in as admin (or via the cron
secret). It creates the `payments` ledger table.

## 5. Set your deposit policy
**Settings & Fees → Online payments (Square)** → set the deposit percentage
(default 25%) and Save.

## 5a. The automatic payment schedule
Once Square is on, payments run themselves:
- **On approval** — when you approve an enquiry, the guest is automatically emailed
  a request for the **deposit** (e.g. 25%).
- **30 days before check-in** — the **balance** is automatically requested.
- **Approved inside 30 days** — the guest is asked for the **full amount upfront**
  (no split).

The 30-day window is `PAYMENT_BALANCE_DAYS` in `config.php` (change it if you like).
You can still send any request by hand from a booking's details.

### Set up the daily cron (required for the balance step)
The balance chaser runs from a scheduled job. In the **IONOS control panel →
Cron Jobs**, add a job that runs **once a day** calling:
```
https://YOURDOMAIN/payments-due.php?cron=YOUR_APP_SECRET
```
`YOUR_APP_SECRET` is the `APP_SECRET` value from `config.php`. (This is the same
pattern as the check-in push and pre-arrival crons.) Until this cron exists, the
deposit-on-approval still works; only the automatic balance step needs it.

## 5b. Apple Pay & Google Pay (optional, recommended)
The card form can also show **Apple Pay** and **Google Pay** buttons. To enable:
1. In the Square Developer Dashboard → your app → **Web Payments / Digital Wallets**,
   turn on Apple Pay and Google Pay.
2. **Apple Pay** additionally needs your live domain registered: Square gives you a
   verification file to place at `/.well-known/apple-developer-merchantid-domain-association`
   (upload it to your web space), then "Add domain" in Square. Google Pay needs no
   domain step.
3. Nothing else to change in the code — the buttons appear automatically on supported
   devices/browsers (Apple Pay in Safari on Apple devices; Google Pay in Chrome). If a
   wallet isn't available, it's simply hidden and the card field still works.

The site's security policy already allows Google Pay; if you serve from a different
domain, no change is needed.

## 5c. Balance reminders
If a balance request goes unpaid, the daily cron (step 5a) also sends **gentle
reminders** while check-in is between `PAYMENT_REMINDER_STOP_DAYS` (default 3) and
`PAYMENT_REMINDER_FROM_DAYS` (default 14) days away — at most once every ~3 days —
then stops a few days before arrival. Both windows are in `config.php`. No extra
setup beyond the daily cron.

## 6. Test in Sandbox
1. Approve an enquiry so it becomes a booking with a guest email.
2. Open the booking's details → **Request deposit**. The guest gets an email with
   a secure link (`…/index.html?pay=…`).
3. Open the link, pay with a Square **test card**: `4111 1111 1111 1111`,
   any future expiry, any CVV, any postcode.
4. The booking should flip to **Deposit** with the amount recorded; **Request
   balance** then collects the rest and flips it to **Paid**.
5. Try a **Refund** from the booking's payment list.

## 7. Go live
Swap the four credentials for the **Production** values, set
`SQUARE_ENVIRONMENT` to `production`, and re-point the webhook URL/key. That's it.

**Security:** the access token and webhook key live only in `config.php` (private,
like your DB and email passwords). The browser only ever receives the public
Application ID and Location ID. Card numbers go straight to Square — our server
never sees or stores them (lightest PCI tier, SAQ-A).
