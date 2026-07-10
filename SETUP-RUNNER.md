# Self-hosted GitHub Actions runner

CI and deploys run on a machine YOU own instead of GitHub's paid minutes —
free and unlimited for this private repo. Any always-on Mac, Windows PC
(via WSL) or Linux box (a Raspberry Pi 4+ works) can be the runner.

## 1. One-time: install the tools the workflows use

**Mac** (Terminal):
```
brew install php lftp brotli node
```

**Windows** — install WSL first (PowerShell: `wsl --install`, reboot,
open "Ubuntu"), then follow the Linux steps inside it.

**Linux / WSL Ubuntu**:
```
sudo apt update
sudo apt install -y php-cli php-xml php-curl lftp brotli git curl
```

Playwright's browsers install themselves on the first CI run, but on
Linux/WSL their system libraries need one manual install:
```
npx playwright install-deps chromium webkit
```
(Run it from any folder; it will sudo. Macs skip this.)

## 2. Register the runner (5 minutes)

1. GitHub → this repo → **Settings → Actions → Runners → New self-hosted runner**.
2. Pick your OS and copy-paste the THREE command blocks GitHub shows
   (download → `./config.sh` with the token → `./run.sh`). Accept the
   defaults when config.sh asks questions.
3. When `run.sh` prints "Listening for Jobs", it works — Ctrl-C it and
   install it as a background service so it survives reboots:
   - **Mac/Linux**: `sudo ./svc.sh install && sudo ./svc.sh start`
   - **Windows (native)**: re-run `config.cmd` and answer Y to
     "run as service" (WSL users use the Mac/Linux command inside WSL).

The runner shows as "Idle" on the Runners page when it's healthy.

## 3. Notes

- The workflows (`ci.yml` / `deploy.yml`) already target `runs-on:
  self-hosted` — no further changes needed.
- The machine must be ON (not asleep) for PRs to get their checks and for
  merges to deploy. If it's off, jobs queue and run when it returns.
- Security: this is a PRIVATE repo, so only your own branches/PRs run
  here — no third-party code. Still, treat the runner machine as one
  that runs your repo's code.
- The first browser-test run downloads ~300MB of browsers; after that the
  cache makes runs much faster than GitHub's hosted runners.
