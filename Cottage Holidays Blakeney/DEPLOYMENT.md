# Cottage Holidays Blakeney — IONOS Deployment Guide

This is the PHP + MySQL backend that replaces the browser `localStorage`, so your
data is stored on the server, shared across devices, backed up by IONOS, served
over HTTPS (encrypted in transit), and protected by server-side logins with
**hashed** passwords.

---

## What you have

Everything sits in **ONE folder** — no `api/` or `includes/` subfolders. This is the
simplest, most reliable layout: upload all of these into the single folder your
domain serves (whether that's the root or a subfolder like `something/`):

```
index.html        ← the front end (talks to the .php files in this same folder)
.htaccess         ← forces HTTPS + protects config.php/schema.sql (upload this too!)
config.php        ← YOUR database credentials go here
db.php            ← DB connection + helpers (no edits needed)
pricing.php       ← server-side pricing (no edits needed)
setup.php         ← run ONCE to create the admin, then DELETE
health.php        ← diagnostic — visit in your browser, then DELETE
auth.php          ← admin + guest login/logout/password
rates.php         ← property rates & fees
enquiries.php     ← public enquiries + admin approve/decline
bookings.php      ← bookings CRUD + payments
my-bookings.php   ← a guest's own bookings
accounts.php      ← tax-year income reporting
content.php       ← editable text/images/galleries (shared across devices)
upload.php        ← receives photos from the Live Editor file finder (admin only)
uploads/          ← folder where uploaded photos are stored (must be writable)
schema.sql        ← import this into your database
```

**Photos:** the site loads cottage images from JPG files in this same folder
(`hero.jpg`, `card-21a.jpg`, `21a-1.jpg`, etc.). See `PHOTOS.md` for the full list
of filenames and where each one appears. Upload your own photos with those names —
OR use the **Live Editor's built-in file finder** (log in, click Edit, click an
image or use the gallery's "Add photo" button) to upload photos straight from your
device into the `uploads/` folder. Those edits are saved on the server and show for
all visitors.

**The `uploads/` folder must be writable** by the web server. On IONOS the default
permissions usually work; if uploading a photo fails with a permissions error, set
the folder's permissions to 755 (or 775) in the File Manager. Keep the small
`.htaccess` file that's inside `uploads/` — it stops uploaded files being run as
scripts.

The front end figures out its own folder automatically, so it works at the domain
root OR in any subfolder, with or without a trailing slash. Just keep every file
together in the same folder.

---

## Step 1 — Create the database (IONOS control panel)

1. Log in to IONOS → **Hosting** → **Databases** (MySQL/MariaDB).
2. Create a new database. IONOS shows you four things — write them down:
   - **Host** (e.g. `db5012345678.hosting-data.io`)
   - **Database name** (e.g. `dbs12345678`)
   - **Username** (e.g. `dbu12345678`)
   - **Password** (you set this)
3. Open **phpMyAdmin** (button next to the database).
4. Select your database, go to the **Import** tab, choose `schema.sql`, and run it.
   This creates the tables and seeds your three cottages.

## Step 2 — Enter your credentials

Edit `includes/config.php` and replace the four `DB_*` values with the ones from
step 1. Set `APP_SECRET` to a long random string. Save.

## Step 3 — Upload the files

Use the IONOS **File Manager** or any SFTP client (e.g. FileZilla — IONOS gives you
SFTP details under Hosting → SFTP/SSH). Upload everything into your domain's web
root so the structure matches the tree above.

## Step 4 — Turn on SSL (HTTPS)

In IONOS → **Domains & SSL**, make sure the free SSL certificate is **active** for
your domain, and enable **"force HTTPS"** / redirect so the site always uses
`https://`. This is the encryption-in-transit you asked for — it now protects every
request between guests' browsers, the back office, and your server.

## Step 5 — Create your admin login (once)

Visit, in your browser:

```
https://YOURDOMAIN/setup.php?username=admin&password=YourStrongPassword
```

You'll see a success message. **Then delete `setup.php` from the server** (via
File Manager / SFTP). The site refuses to create a second admin while one exists,
but deleting the file is the clean belt-and-braces step.

You can change this password any time from **Settings → Security** in the back office.

## Step 6 — Test

- Visit your domain — the public site loads over `https://`.
- Submit a test enquiry from a cottage page.
- Log in to the back office (👤 / Back Office) with your admin login; approve the
  enquiry; it appears on the calendar.
- Register a guest account with the same email used on a booking; confirm it shows
  under "My Bookings", and download the PDF invoice.
- Open **Accounts** and check the tax-year figures.

---

## Security notes (please read)

- Passwords are now stored **hashed** (bcrypt via PHP `password_hash`), never plain
  text. The old per-browser plain-text storage is gone.
- All traffic is over **HTTPS** once SSL is enabled (step 4) — this is the real
  "encrypt data between front end and back office".
- `config.php` holds your DB password. Keep it private; never put it in a public
  GitHub repo. (On shared hosting it sits outside public view as executed PHP, but
  still treat it as a secret.)
- Sessions use **HttpOnly, Secure, SameSite=Lax** cookies, so the login token can't
  be read by JavaScript and is only sent over HTTPS.
- Consider IONOS's **daily backup** option so booking and payment data is recoverable.

## If something doesn't work

**First, run the health check.** Visit `https://YOURDOMAIN/health.php` in your
browser. It reports whether PHP, the database, the tables, and an admin user are all
present, and gives plain-language next steps. Delete the file once sorted.

**Login doesn't work / "isn't sticking":** the usual causes, in order —
1. **No admin exists yet** → run `setup.php?username=admin&password=YourPass`
   (health.php will say `admin_count: 0` if so).
2. **Wrong DB credentials** → health.php shows `db_connects: false`; fix the four
   `DB_*` values in `includes/config.php`.
3. **Schema not imported** → health.php lists missing tables; import `schema.sql`.
4. **HTTPS not enabled** → enable Force HTTPS in IONOS. (The code now detects IONOS's
   proxy HTTPS, so sessions persist correctly once you're on `https://`.)
5. Always load the site as `https://yourdomain/` (not `http://`), so the session
   cookie and the page share the same secure origin.

- **"Database connection failed"** → re-check the four values in `config.php`; the
  host is the long `…hosting-data.io` string, not `localhost`.
- **Blank page / 500 error** → in IONOS, set PHP to **8.x** for the domain
  (Hosting → PHP settings). This code targets PHP 8.
- **Login works but data doesn't save** → confirm the schema imported (phpMyAdmin
  should list the tables) and that the DB user has read/write permission.

