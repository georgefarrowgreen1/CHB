# Staging site — a true sandbox environment

This sets up a **separate copy of the site** at `staging.cottageholidaysblakeney.co.uk`
with its **own database** and its **own `config.php`** (Square sandbox + test email).
The same code is deployed to it automatically alongside production, but because it
talks to a different database and sandbox payment/email, **nothing you do there can
touch the live site or take real money.**

Claude wired up the code side (an opt-in staging deploy job, a noindex header on the
staging host, and a "STAGING" banner). The steps below are the IONOS + GitHub setup
**you** need to do once — Claude can't provision hosting for you.

---

## 1. Create the staging subdomain (IONOS control panel)

1. Domains & SSL → your domain → **Subdomains → Add subdomain** → `staging`.
2. Point it at a **new, empty folder** in your webspace, e.g. `/staging`.
3. Enable **SSL** for the subdomain (Let's Encrypt is free) so it's `https://`.

## 2. Create a second database (IONOS → Databases → MySQL)

1. **Create database** — note its **name, host, user, password**.
2. This is the sandbox DB. It starts empty; step 5 builds the schema.

## 3. Put a `config.php` in the staging folder

Copy your live `config.php` into `/staging/config.php` and change:

```php
// --- Sandbox database (the new one from step 2) ---
define('DB_HOST', 'db5XXXXXXXX.hosting-data.io');
define('DB_NAME', 'dbsXXXXXXXX');     // the staging database
define('DB_USER', 'dboXXXXXXXX');
define('DB_PASS', 'your-staging-db-password');

// --- A DIFFERENT secret from production ---
define('APP_SECRET', 'another-long-random-string');

// --- Square in sandbox so no real money moves ---
define('SQUARE_ENVIRONMENT', 'sandbox');
define('SQUARE_APPLICATION_ID', 'sandbox-sq0idb-…');
define('SQUARE_ACCESS_TOKEN', 'EAAA…sandbox token…');
define('SQUARE_LOCATION_ID', 'L…sandbox location…');

// --- Email: send only to you while testing (or turn off) ---
define('MAIL_ENABLED', true);                 // or false to silence all email
define('OWNER_NOTIFY_EMAIL', 'georgefarrowgreen@icloud.com');
```

The deploy never overwrites `config.php`, so staging keeps these settings forever.

## 4. Add the GitHub secrets (Settings → Secrets and variables → Actions)

Until these are set, the staging deploy job just logs "not configured" and is skipped —
production is unaffected.

| Secret | Value |
|---|---|
| `STAGING_SFTP_HOST` | same SFTP host as production (e.g. `access-XXXX.webspace-host.com`) |
| `STAGING_SFTP_USER` | your SFTP username |
| `STAGING_SFTP_PASS` | your SFTP password |
| `STAGING_REMOTE_PATH` | the staging folder, e.g. `/staging` |
| `STAGING_SFTP_PORT` | optional (defaults to 22) |
| `STAGING_APP_SECRET` | the **staging** `APP_SECRET` from step 3 |
| `STAGING_URL` | `https://staging.cottageholidaysblakeney.co.uk` |

## 5. First-time build of the staging database

1. Push to `main` (or run the **Deploy to IONOS** action) — the code lands in `/staging`.
2. Visit `https://staging.cottageholidaysblakeney.co.uk/setup.php` **once** to create
   the schema + your admin login on the sandbox DB. *(Re-upload `setup.php` if the
   deploy stripped it — it's removed from live uploads for safety; on staging you can
   run it from the repo copy or temporarily place it.)*
3. Visit `…/migrate.php` (signed in as admin) to apply all migrations.

You now have an isolated sandbox. Every future push to `main` deploys to **both**
production and staging automatically.

---

## What's automatic once it's set up

- **Same code, separate data:** staging shares the codebase but its own database.
- **Search engines blocked:** the staging host sends `X-Robots-Tag: noindex` (`.htaccess`).
- **Obvious banner:** a "STAGING" bar shows on every page so you never confuse it with live.
- **Safe payments/email:** Square sandbox + email routed to you (or off), per the staging `config.php`.
- **Migrate-only post-deploy:** staging never fires the owner digest / release / nudge pings.

To tear it down: delete the GitHub `STAGING_*` secrets (deploys stop), and remove the
subdomain + database in IONOS.
