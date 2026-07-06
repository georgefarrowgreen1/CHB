<?php
// ============================================================
//  config.php — EDIT THESE with your IONOS database credentials.
//  Find them in: IONOS control panel > Hosting > Databases.
//  Keep this file private. Never commit real credentials to a
//  public repository.
// ============================================================

// --- Database connection ---
define('DB_HOST', 'db5012345678.hosting-data.io'); // IONOS gives you this host
define('DB_NAME', 'dbs12345678');                  // your database name
define('DB_USER', 'dbu12345678');                  // your database user
define('DB_PASS', 'CHANGE_ME');                    // your database password
define('DB_CHARSET', 'utf8mb4');

// --- Session / security ---
// Used for hashing & general app config. Change to a long random string.
define('APP_SECRET', 'change-this-to-a-long-random-string');

// Allowed origin for the front end (your domain). Used for CORS if the
// front end and API are on the same domain you can leave as '' .
define('ALLOWED_ORIGIN', ''); // e.g. 'https://www.yourdomain.co.uk'  (empty = same-origin)

// --- Web Push (optional: check-in notifications). Leave blank to keep it off. ---
// Generate real values with vapid-keygen.php (run once, paste here, then delete it).
// See SETUP-PUSH.md.
define('VAPID_PUBLIC_KEY', '');                          // base64url uncompressed P-256 point
define('VAPID_PRIVATE_KEY', '');                         // EC private key in PEM
define('VAPID_SUBJECT', 'mailto:you@yourdomain.co.uk');  // your contact email or site URL

// ============================================================
//  Email (SMTP) — for booking confirmation emails.
//  Use a real mailbox: an IONOS @yourdomain address, or a Gmail account.
//  IONOS example:  host 'smtp.ionos.co.uk', port 587, your full email + password.
//  Gmail example:  host 'smtp.gmail.com',   port 587, your gmail + an APP PASSWORD
//                  (not your normal password — create one in Google account security).
//  Set MAIL_ENABLED to false to turn emails off entirely.
// ============================================================
define('MAIL_ENABLED', false);                       // set true once SMTP below is filled in
define('SMTP_HOST', 'smtp.ionos.co.uk');             // your provider's SMTP host
define('SMTP_PORT', 587);                            // 587 = STARTTLS (recommended), 465 = SSL
define('SMTP_SECURE', 'tls');                        // 'tls' for 587, 'ssl' for 465
define('SMTP_USER', 'bookings@yourdomain.co.uk');    // the mailbox you send from
define('SMTP_PASS', 'CHANGE_ME');                    // that mailbox's password / app password
define('MAIL_FROM', 'bookings@yourdomain.co.uk');    // usually the same as SMTP_USER
define('MAIL_FROM_NAME', 'Cottage Holidays Blakeney');
define('OWNER_NOTIFY_EMAIL', 'sophia@yourdomain.co.uk'); // where YOUR owner copy is sent

// ---- Reply-by-email (optional) ----------------------------------------------
// Lets you REPLY to a "new website message" notification and have it reach the
// guest on the website chat AND by email. Set an inbound mailbox address and a
// secret, then point a free inbound-mail route (ImprovMX / Mailgun / CloudMailin)
// for that address at:  https://YOURDOMAIN/inbound-mail.php?key=<INBOUND_SECRET>
// Leave these unset to keep notifications behaving as before. See SETUP-REPLY-EMAIL.md.
// define('REPLY_INBOX', 'reply@yourdomain.co.uk');
// define('INBOUND_SECRET', 'a-long-random-string-different-from-APP_SECRET');

// ============================================================
//  Square online payments (optional). Leave SQUARE_PAYMENTS_ENABLED false
//  until every value below is filled in — guests then pay a deposit (and later
//  the balance) by card on our own site. Get these from the Square Developer
//  Dashboard (https://developer.squareup.com): create an application, then read
//  its credentials for the chosen environment. See SETUP-SQUARE.md.
//
//   * APPLICATION_ID + LOCATION_ID are PUBLIC (handed to the browser SDK).
//   * ACCESS_TOKEN + WEBHOOK_SIGNATURE_KEY are SECRET — keep this file private.
// ============================================================
define('SQUARE_PAYMENTS_ENABLED', false);            // master on/off switch
define('SQUARE_ENVIRONMENT', 'sandbox');             // 'sandbox' while testing, 'production' when live
define('SQUARE_APPLICATION_ID', '');                 // e.g. sandbox-sq0idb-xxxx (public)
define('SQUARE_LOCATION_ID', '');                    // e.g. L1234567890AB (public)
define('SQUARE_ACCESS_TOKEN', '');                   // SECRET access token for the environment above
define('SQUARE_WEBHOOK_SIGNATURE_KEY', '');          // SECRET — from the webhook subscription
define('SQUARE_WEBHOOK_URL', '');                    // the EXACT URL you register, e.g. https://yourdomain.co.uk/square-webhook.php
define('SQUARE_API_VERSION', '2024-01-18');          // Square-Version header (bump when you adopt newer features)
// Payment schedule: deposit on approval, then the balance is auto-requested this
// many days before check-in (and the full amount is requested upfront if a booking
// is approved inside this window). Requires a daily cron on payments-due.php.
define('PAYMENT_BALANCE_DAYS', 30);
// Balance reminders: if a requested balance is still unpaid, the daily cron sends
// gentle reminders while check-in is between STOP and FROM days away (at most once
// every ~3 days), then stops a few days before arrival.
define('PAYMENT_REMINDER_FROM_DAYS', 14);
define('PAYMENT_REMINDER_STOP_DAYS', 3);

// Staging sandbox marker. LEAVE THIS UNSET on production. Define it (true) ONLY
// in the staging /staging/config.php: it unlocks the frictionless test-guest
// session used by the staging Test centre. The gate is this server-side constant
// — never the request Host header — so a spoofed `Host: staging.…` sent to
// production can't mint a credential-less guest session.
// define('STAGING_SANDBOX', true);
