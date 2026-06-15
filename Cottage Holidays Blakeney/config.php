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
