# Blakeney Hand

A Mac app that drafts work overnight on your own machine and leaves it on the
Cottage Holidays Blakeney website for you to read in the morning.

It runs on **Intel and Apple silicon** from one universal build. Nothing it
writes is ever sent, published or charged — every job posts a **draft**, and the
website refuses anything that tries to do more.

---

## What is real, and what is not

Being exact about this, because it decides what you should trust.

| | |
|---|---|
| **Verified here, with tests** | The whole of `src/core`: machine detection and model fit, both engine adapters, the model library, the site calls, the draft **guard**, the reply job, the night orchestrator, settings, the Keychain. `npm test` — 184 checks, no network, no model, no Mac needed. |
| **Not verified anywhere yet** | `src/main.js` (the Electron window, menu, clock and power assertion) and `src/ui` (the window's own markup and script — driven in a browser, but never inside Electron). And, most importantly, **whether the model's prose is any good**, which needs your data and your hardware. |

That split is deliberate. The unverifiable parts are the ones where being wrong
is obvious the first time you launch it; the parts where being wrong would be
*invisible* — a figure the model made up, an availability answer it guessed —
are the ones with the tests.

---

## What you need first

1. **A model runner serving on localhost.** Either is fine:
   - **llama.cpp** — `brew install llama.cpp`, then
     `llama-server -m ~/Library/Application\ Support/Blakeney\ Hand/Models/your-model.gguf --port 8080`
   - **Ollama** — `brew install ollama`, then `ollama serve` (it listens on 11434)

   The app talks to whichever answers, over the OpenAI-shaped
   `/v1/chat/completions` both provide. That is why one app covers both
   architectures: llama.cpp is compiled for each and the app never links a model
   runtime into itself.

2. **A model.** Use the **Models** screen — search Hugging Face, expand a repo,
   and every quantisation says whether it will run on *this* Mac, from its real
   file size. On 16 GB, an 8B or 14B at Q4_K_M is where to start. You can also
   just drop a `.gguf` into the Models folder and it appears.

3. **Overnight work switched on, on the website.** Manage → System check →
   **Overnight work**. That page also shows the address to paste into
   **Connection** here. The secret is the same one your daily-jobs address uses.

---

## Getting a .dmg

**A disk image can only be made on a Mac.** The format is produced by `hdiutil`
and a universal binary is merged by `lipo` — both Apple's, both macOS-only — so
no Linux box and no CI runner other than a Mac can produce one.

### The easy way: let GitHub build it

`.github/workflows/mac-app.yml` runs on a `macos-14` runner, which is an Apple
silicon Mac. On this repo those minutes are free.

1. **Actions → Mac app → Run workflow.** Tick *publish a release* if you want a
   permanent download link.
2. It installs, runs the core suite and the window suite (**a build whose own
   tests failed is never shipped**), then produces the universal `.dmg`.
3. About ten minutes later it is a workflow artifact — and, if you asked for a
   release, at a stable URL you can paste into **Manage → System check → The Mac
   app**.

Tagging `hand-v1.0` does the same thing and always publishes.

### Or on your own Mac

You need Xcode's command-line tools (`xcode-select --install`) and Node.

```bash
cd mac-app
npm install
npm start            # run it from source, no packaging
npm run build        # a universal .dmg in dist/, Intel + Apple silicon in one
```

`npm run build:arm` / `npm run build:intel` produce a single-architecture build
if you ever want a smaller download.

### Getting it to open with a double-click

An unsigned app is blocked by Gatekeeper on first launch. Two routes:

- **Free.** Open **System Settings → Privacy & Security**, find the "was blocked"
  notice and press **Open Anyway**. (macOS Sequoia removed the old
  Control-click → Open shortcut, so it has to be done there.) Fine for an app
  only you will ever run.
- **Proper.** Join the Apple Developer Program and give the workflow four
  repository secrets; it then signs and notarises every build on its own, and the
  release notes say which kind each copy is.

  | secret | what it is |
  |---|---|
  | `MAC_CERT_P12` | base64 of your Developer ID Application `.p12` |
  | `MAC_CERT_PASSWORD` | that file's password |
  | `APPLE_ID` | your Apple ID email |
  | `APPLE_APP_PASSWORD` | an app-specific password from appleid.apple.com |
  | `APPLE_TEAM_ID` | your 10-character team id |

  Building by hand instead: `export APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=…
  APPLE_TEAM_ID=…` then `npm run build`.

  Apple runs an automated malware scan. There is no review, no guidelines and no
  cut of anything — it is not the App Store, it just makes the app open normally.

### Starting it at login

**System Settings → General → Login Items → +**, and choose the app. Closing its
window does not quit it — the whole point is a machine that is there at two in
the morning — so quit from the menu when you mean it.

---

## How a night works

```
02:00  the clock ticks past the run time
       ── ask the site what is waiting            (nightshift.php · brief)
       ── for each enquiry:
            build a prompt from the SITE's facts  (its quote, its calendar answer)
            ask the local model for prose
            CHECK the draft                       (src/core/guard.js)
            keep it, or drop it and log why
       ── post what survived                      (nightshift.php · ingest)
       release the power assertion, go quiet
```

### The rule the whole app is built around

**The brief states the facts, the model arranges the words.**

The website hands over its own price and its own availability answer, the prompt
tells the model to use them verbatim, and then `guard.js` **checks** — because a
prompt is a request and a check is a rule. A draft that quotes a figure the site
did not give, or claims dates are free when the site could not tell, is **dropped
and named in the log**. It is never repaired, because repairing it would mean
this app writing text of its own.

Everything the guard refuses:

- money the site did not hand over
- an availability claim the site did not make (either way)
- a link, or any claim that something has already been booked or charged
- a greeting (the website's own email template adds one — two greetings really
  did reach guests once)
- anything under 40 characters or over 4,000

### The exactly-once mechanism

Each item carries a `ref` that is **deterministic** for the same enquiry on the
same night. If a post succeeds and the reply is lost, the retry carries the same
ref and the site stores nothing twice. That is why a lost reply is logged as
*uncertain* rather than *failed* — re-drafting it tomorrow with a fresh ref is
the failure mode this avoids.

---

## Where things are

```
src/main.js          Electron: window, menu, the minute clock, power assertion
src/preload.js       the bridge — named channels only, and no way to read the secret
src/ui/              the window: five screens, no Node, its own CSP
src/core/
  machine.js         what Mac is this, and what will run on it
  engine.js          llama.cpp / Ollama / MLX behind one HTTP adapter
  models.js          the library: installed, search, repo files, download
  site.js            the only outside contact — brief and ingest, nothing else
  guard.js           what a draft must pass. The most important file here.
  jobs.js            the work. One job built: drafted enquiry replies.
  night.js           one night, start to finish, and the log
  config.js          settings on disk; the secret in the Keychain, never on disk
  api.js             the surface the window may call
test/core-test.js    184 checks over all of the above
```

Settings, models and the night log live in
`~/Library/Application Support/Blakeney Hand/`.

---

## What it deliberately cannot do

- **Send anything.** There is no job type that emails, charges or publishes, and
  the website refuses an item that asks for one. A bug here cannot reach a guest.
- **State money of its own.** No figure in this app is calculated. Every one is
  quoted from the site, and the guard enforces it.
- **Be the only copy.** Switch overnight work off on the website and both
  directions close: this app is refused, and the website is exactly what it was.
- **Keep a secret in a file.** If the Keychain refuses, nothing is stored
  anywhere and the app says so.

## What is not built yet

Four of the five jobs on the **Jobs** screen are listed but not implemented —
they are shown for shape and cannot be switched on. Drafted enquiry replies is
the one that ships first, on purpose: it is the highest-value job and the honest
test of whether any of this earns its keep.
