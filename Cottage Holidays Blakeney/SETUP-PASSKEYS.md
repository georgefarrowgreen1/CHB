# Passkey (Face ID / Touch ID) Setup

Guests can now sign in with a passkey — Face ID, Touch ID, Windows Hello, or a
device PIN — instead of typing a password. Passwords still work as a backup, so
no one is ever locked out.

## What you need to do

### 1. Upload the WebAuthn library (one-time)
The passkey cryptography is handled by a small, well-trusted open-source PHP
library called **lbuchs/WebAuthn**. It needs no Composer — it's just PHP files.

1. Download it from: https://github.com/lbuchs/WebAuthn  
   (Click the green **Code** button → **Download ZIP**.)
2. Unzip it. Inside you'll find a `src` folder (or a `WebAuthn` folder) containing
   `WebAuthn.php` and several `.php` files in subfolders (Attestation, Binary, CBOR).
3. On your server, inside your site folder, create a folder path: **`lib/WebAuthn/`**
4. Upload the library's PHP files into `lib/WebAuthn/` so that this file exists:
   **`lib/WebAuthn/WebAuthn.php`** (with its `Attestation/`, `Binary/`, `CBOR/`
   subfolders alongside it).

The site looks for `lib/WebAuthn/WebAuthn.php`. If it's missing, passkey actions
return a clear "library not installed" message and password login is unaffected.

### 2. Upload the site files
Upload these (overwrite where they exist):
- `passkeys.php`  (new)
- `index.html`    (changed — passkey buttons + logic)
- `schema.sql`    (only needed for a fresh install)

### 3. Run the database migration
In phpMyAdmin, run **`migration-passkeys.sql`** once. It adds the
`guest_passkeys` table that stores each guest's registered passkeys.

### 4. HTTPS is required
Passkeys only work over **https://** (browsers block WebAuthn on plain http).
Your site already uses HTTPS, so this is just a reminder.

## How guests use it
- **Add a passkey:** log in normally once, go to **My Bookings**, and click
  **"＋ Add a passkey"**. Their device prompts for Face ID / Touch ID / PIN.
- **Sign in with a passkey:** on the login screen, click **"🔐 Sign in with a
  passkey"** — no email or password needed; the device confirms their identity.
- They can add several passkeys (e.g. phone + laptop) and remove any from the
  My Bookings page.

## Notes
- Passkeys are tied to a device or an ecosystem (e.g. Apple iCloud Keychain syncs
  them across the guest's Apple devices). If a guest switches to a totally
  different device with no synced passkey, they simply log in with their password
  and add a new passkey there.
- Nothing secret is stored on your server — only the guest's PUBLIC key. The
  private key never leaves their device.

---

## Admin / Back Office passkeys

The Back Office and Live Editor can also use passkeys. The admin PASSWORD always
stays as a working fallback — passkeys are an additional, faster way in.

### Extra setup for admin passkeys
1. Run **`migration-admin-passkeys.sql`** once in phpMyAdmin (adds the
   `admin_passkeys` table). This is separate from the guest passkeys migration.
2. The same uploaded `lib/WebAuthn/` library and `passkeys.php` handle both
   guest and admin passkeys — nothing else to upload.

### How you use it
- **Add an admin passkey:** log in to the Back Office with your password, go to
  **Settings & Fees → Security → "＋ Add a passkey"**.
- **Sign in:** when you click "Back Office" or the Live Editor while logged out,
  you'll be asked "Sign in with a passkey?" — OK uses Face ID/Touch ID, Cancel
  falls back to username & password.

### IMPORTANT — avoid locking yourself out
- **Keep your admin password safe** (e.g. in a password manager). It's your
  ultimate fallback and there's no one above you to reset it.
- **Add a passkey on two devices** (phone AND laptop) so losing one device
  doesn't lock you out.
- Last resort if you ever lose everything: the admin password can be reset by
  re-running `setup.php` or updating the `admins` table in phpMyAdmin.
