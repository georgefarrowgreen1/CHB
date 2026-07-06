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

// --- Mark this as the staging sandbox (production MUST NOT set this) ---
define('STAGING_SANDBOX', true);              // unlocks the Test-centre guest session
```

> **Important:** `STAGING_SANDBOX` is the security boundary for the frictionless
> test-guest login — it must be defined **only** here, never in the production
> `config.php`. The endpoint refuses unless this constant is set, so a spoofed
> `Host: staging.…` header sent to production can't unlock a guest session.

The deploy never overwrites `config.php`, so staging keeps these settings forever.

## 4. Add the GitHub secrets (Settings → Secrets and variables → Actions)

A subdomain lives in the **same IONOS webspace**, so the SFTP login is identical to
production — the staging job **reuses your existing `IONOS_SFTP_*` secrets** by default.
Staging is switched on simply by setting `STAGING_REMOTE_PATH`. Until then the staging
job logs "not configured" and is skipped, so production is unaffected.

You only need these three:

| Secret | Value |
|---|---|
| `STAGING_REMOTE_PATH` | the staging folder, e.g. `/staging` — **must differ from your live path** (the build refuses if they match, so it can't overwrite production) |
| `STAGING_APP_SECRET` | the **staging** `APP_SECRET` from step 3 |
| `STAGING_URL` | `https://staging.cottageholidaysblakeney.co.uk` |

Optional — only if staging ever uses a *different* SFTP login: `STAGING_SFTP_HOST`,
`STAGING_SFTP_USER`, `STAGING_SFTP_PASS`, `STAGING_SFTP_PORT`. Leave them unset to reuse
the live `IONOS_SFTP_*` credentials.

## 5. First-time build of the staging database

1. **Create the tables:** IONOS → phpMyAdmin → select the **sandbox** database →
   **Import** → upload `schema.sql` from the repo → Go. *(This creates every table and
   seeds the three cottages.)*
2. **Push to `main`** (or run the **Deploy to IONOS** action) — the code lands in
   `/staging` via the new `deploy-staging` job.
3. **Create your staging admin:** `setup.php` is stripped from deployed files, so upload
   the repo's `setup.php` into `/staging` manually, visit
   `https://staging.cottageholidaysblakeney.co.uk/setup.php?username=admin&password=YOURPASS`
   over https, then **delete `setup.php`** from `/staging`.
4. **Apply migrations:** sign in to staging's back office → **Settings → System check →
   Run migrations** (or visit `…/migrate.php?cron=YOUR-STAGING-APP-SECRET`).

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
