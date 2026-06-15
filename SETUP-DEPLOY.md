# Auto-deploy to IONOS (GitHub Actions)

Once this is set up, **every push to the `main` branch automatically uploads the
site to your IONOS web space over SFTP.** No more dragging files in File Manager.

The workflow lives in `.github/workflows/deploy.yml`. It uploads everything in the
`Cottage Holidays Blakeney/` folder to your web root, renames `htaccess.txt` →
`.htaccess`, and is deliberately careful:

- It **never deletes** anything on the server, so your uploaded photos in
  `uploads/` and your live `config.php` are safe.
- It **does not upload** `config.php` (keeps your real DB password on the server
  only), the run-once tools `setup.php`/`health.php`, or repo-only files
  (`*.md`, `*.sql`, `smoke-test.js`, old backups).

---

## One-time setup (about 10 minutes)

### 1. Find your IONOS SFTP details
In the IONOS control panel: **Hosting → SFTP & SSH** (sometimes under "Web space"
or "Users"). You need:

- **Server / Host** — looks like `access-1234567.webspace-host.com` (this is the
  SFTP host; it is **not** the same as your `…hosting-data.io` database host).
- **Username** — your SFTP user.
- **Password** — set or reset it here if you don't know it.
- **Port** — almost always `22`.

You may also need the **path to your web root**. For most IONOS plans the SFTP
login lands directly in the servable folder, so the path is just `/`. If your site
lives in a subfolder, use that (e.g. `/cottages`).

### 2. Add them as GitHub repository secrets
In GitHub: **your repo → Settings → Secrets and variables → Actions →
New repository secret.** Add each of these (the names must match exactly):

| Secret name         | Value                                             |
|---------------------|---------------------------------------------------|
| `IONOS_SFTP_HOST`   | the SFTP host from step 1                         |
| `IONOS_SFTP_USER`   | your SFTP username                                |
| `IONOS_SFTP_PASS`   | your SFTP password                                |
| `IONOS_REMOTE_PATH` | your web root, usually `/`                         |
| `IONOS_SFTP_PORT`   | *(optional)* `22` — omit to use the default       |

Secrets are encrypted by GitHub. They are never shown in logs and are not visible
to me or anyone browsing the repo.

### 3. Get the workflow onto `main`
The workflow only runs from the default branch, so merge the branch it was added on
into `main` (open a PR from `claude/codebase-visibility-hmc5bc` → `main` and merge).

### 4. Test it
- Go to the **Actions** tab → **Deploy to IONOS** → **Run workflow** to trigger a
  manual run, or just push any change to `main`.
- Watch the run. A green tick means the files uploaded. Load your site to confirm.

From then on: **deploying = merging to `main`.**

---

## Notes & troubleshooting

- **First-ever deploy to a brand-new server:** upload `config.php` once by hand
  (the workflow intentionally never touches it), then run the workflow for the rest.
- **Auth failed:** re-check the host (the SFTP host, not the DB host) and that the
  password has no stray spaces. Reset the SFTP password in IONOS if unsure.
- **Files upload to the wrong place:** adjust `IONOS_REMOTE_PATH`.
- **Want to deploy from a different branch:** change `branches: [ main ]` in
  `.github/workflows/deploy.yml`.
- **IONOS only offers FTP/FTPS on your plan, not SFTP:** tell me and I'll switch
  the upload step to FTPS.
