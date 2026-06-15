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
(default 30%) and Save.

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
