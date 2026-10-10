# CHB — working notes for Claude

Cottage Holidays Blakeney: a 3-cottage family holiday-let site. The frontend is a
single large `Cottage Holidays Blakeney/index.html` (vanilla JS + inline CSS, **no
build step**); PHP backend files sit alongside it. App-style guest shell lives in
`guest-app.js` / `guest-app.css`.

## Workflow preferences
- **Always merge.** When a PR is opened for completed, verified work, squash-merge it
  to `main` without asking first (then sync the branch to main). Skip only if CI is
  failing or the work is explicitly a draft/WIP.
- **NEVER SIT AND WATCH CI.** Measured on three consecutive PRs (#959–#961): the jobs
  finished in 4–5 minutes and GitHub's PR **check-runs** endpoint went on reporting
  `in_progress` for up to **two hours** afterwards — the steps frozen mid-list while
  the run was long over. Polling it costs the session and buys nothing. So:
  1. **Open the PR and go straight to the next piece of work.** Merge at the next
     natural checkpoint — one status check, then merge — and resync the branch
     (`git checkout -B <branch> origin/main`) at the START of the next task rather
     than the end of the last one. An open, green PR sitting for twenty minutes
     costs nothing; twenty minutes of polling costs twenty minutes.
  2. **`enable_pr_auto_merge` does NOT work here** — tried on #962 and refused with
     "the pull request is in unstable status", which is what GitHub calls a PR whose
     checks are merely PENDING. It is only accepted once the checks have passed, i.e.
     exactly when a plain merge would do. Don't reach for it again expecting to walk
     away; the walking away is step 1.
  3. When a status IS wanted, ask the **JOB** (`actions_get get_workflow_job`) or the
     run's job list — both were fresher than the PR's check-runs list every time —
     and never more than once between real pieces of work.
  4. Job LOGS are the honest oracle the status field is not: they 404 while a job is
     running and download once it is done.
- **`test-integration.php` needs MySQL — CHECK whether this container has any before
  believing either claim.** It is the gate that bites (migrations are ONLY exercised
  there; #963 shipped one that passed every other gate and failed §2 in CI), so run
  it when you can: `mysqladmin -h127.0.0.1 -uroot -proot status`, or
  `sudo service mariadb start` first. But do NOT assume it is there — this note used
  to assert flatly that the container HAS MariaDB, and a later session found no
  mysqld, no mariadb service and no mysqladmin at all, having trusted the line. The
  container image is not stable across sessions: **node_modules is not committed
  either** (ci.yml does `npm init -y` + `npm install playwright@<pinned>` per run), so
  the ui-test suites may need `npm install playwright` before they will run, and the
  preinstalled Chromium may not match a newer playwright — pass
  `CHB_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (ui-test-lib's
  own override) when the launch complains about a missing browser revision.
  When you genuinely cannot run it, SAY so in the PR rather than implying CI-parity.
- **CI's PHP runs with the TRACING JIT ON; a local `php` does not.** setup-php enables it by default, and PHP
  8.3.35's JIT miscompiled a hand-written CSV character loop (the first file read in a process grew eight extra
  header fields; the same file a moment later read fine) — a failure that passed every local run for days. To
  reproduce a CI-only PHP failure, run with `-d opcache.enable_cli=1 -d opcache.jit=1235 -d
  opcache.jit_buffer_size=128M`; for test-integration, put those in an ini file and point `PHP_INI_SCAN_DIR` at
  `/etc/php/8.3/cli/conf.d:<that dir>` so the `php -S` it spawns gets them too. Prefer PHP's own C parsers
  (`fgetcsv`, `str_getcsv`) over character loops.
- **A guarded migration is a plain `ALTER TABLE ... ADD COLUMN`.** migrate.php
  treats a duplicate-column error as already-applied. Do NOT reach for the
  information_schema + `PREPARE`/`EXECUTE` guard: the no-op branch (`SELECT 1`)
  leaves a result set nobody reads, and the open cursor kills the NEXT migration
  with PDO error 2014 ("cannot execute queries while other unbuffered queries are
  active"). Measured, and break-tested against the real database.
- **Run the local gauntlet CONCURRENTLY**, in the background, not one suite at a time.
  It is the local run that catches things (CI has never once caught what the full local
  battery missed), and in parallel it finishes in minutes.

## Deploy checklist (do this whenever shipping frontend changes)
- **`node bump.js <new-build-stamp>`** does the WHOLE chain in one go (stamp =
  lowercase/digits, ≥6 chars): BUILD (app.js last statement), CACHE (sw.js), the
  `?v=` pins in index.html + sw.js CORE for whichever assets git says changed, and
  ADMIN_BUNDLE_V / ADMIN_CSS_V when admin.js / admin.css changed. `--dry` previews.
- CI enforces it: `check-versions.js` diffs the PR against its base and fails if a
  changed cached asset kept its version; smoke-test §6c checks the static half
  (sw.js CORE ?v= == index.html ?v=, BUILD well-formed ≥6 chars).
- Then run `node smoke-test.js` and `php test-pricing.php` — must pass (CI runs both).

## The emails are a design system, and mailer.php is it

Thirty-eight templates, one look, every one composed from the helpers at the top of
`mailer.php` — never hand-rolled table markup, which is how the enquiry reply and the
owner's new-enquiry notification each grew their own label-value table and looked like a
different product from the confirmation that follows them.

- **Blocks**, top to bottom in the order an email uses them: `email_shell` (document +
  preheader + footer; NO accent bar), `email_crown_header`, `email_eyebrow` (the stay: the
  cottage's dot + name + dates), `email_h` (the title), `email_lead` (the muted line under
  it), `email_p`, `email_amount` / `email_code` (the key block, in an inset well),
  `email_btn` (the ONE button, a pill, VML-safe), `email_btn2` (the outlined second
  choice), `email_rows` (label + right-rail value), `email_money_rows`, `email_cap` (a
  status capsule), `email_caption` (a section caption), `email_note` (the one tinted
  shout), `email_ownernote`, `email_footnote`, `email_address_block`, `email_photo_band`.
- **ESCAPING IS ASYMMETRIC AND IT BITES.** `email_h`, `email_btn`, `email_btn2`,
  `email_amount`'s and `email_code`'s LABEL, `email_eyebrow`, `email_cap`,
  `email_caption`, `email_ownernote` and **`email_shell`'s PREHEADER** run `email_esc()`
  on what you give them, so a pre-escaped name or an `&mdash;` prints the entity literally
  in the inbox. `email_p`, `email_lead`, `email_note`, `email_rows`, `email_money_rows` and
  `email_footnote` expect PRE-ESCAPED HTML. The preheader one shipped ("We&rsquo;ll confirm your dates" in
  the inbox preview); test-payrail sweeps every `email_shell` call's first argument.
- **DATES ARE SPOKEN, TIMES LOSE THEIR DEAD :00.** `email_date('2026-09-06')` → "Sun 6
  Sep 2026" (`, false` drops the year for subjects); `email_time('15:00')` → "3pm". A
  deliberate DEPARTURE from the DD/MM/YYYY house rule, which governs SCREENS: a screen
  date is scanned against other dates, an email date is read once and acted on, so it
  names the weekday. **The exception is a SCHEDULE COLUMN** — payment tables keep
  `uk_date()`, because four dates stacked in one column are compared to each other and
  DD/MM/YYYY is fixed-width (hence `$retry` spoken and `$retryNum` numeric). NB
  `email_time('')` returns `''`: `strtotime('2000-01-01 ')` parses to midnight, so an
  unset check-in time rendered "from 12am" — a stated fact, wrong.
- **A MONEY EMAIL LEADS WITH THE FIGURE, THEN THE BUTTON, THEN THE ARITHMETIC.** The ask,
  the reminder and the receipt share `payment_money_facts()` (one derivation) but each
  renders its own row set, because a reminder has no "still to come" — the balance IS the
  remainder. The three reconcile.
- **A DEADLINE SITS BESIDE ITS OWN FIGURE.** `payment_plan_line()` answers a different
  question (when the REMAINDER is wanted), so on a balance ask it returns `''` and the one
  email whose job is "settle by then" named no date at all. A balance ask and its reminder
  carry `Due by <spoken date>` in the amount block; a DEPOSIT ask must NOT, its money
  being due now.
- **THE PURE COMPOSERS MUST STAY PURE.** `payment_request_body`, `payment_reminder_body`,
  `payment_receipt_body`, `autopay_notice_body`, `autopay_failure_body`,
  `owner_payment_notice_body`, `send_cancellation_email_body`, `arrival_email_body` take
  everything as arguments (accent, bank details, host name, house rules) so test-payrail
  drives the REAL composer with no DB and no SMTP. **A `content_value()` call inside one
  breaks the whole gate** — which is why `email_host_name()` is resolved by the SENDER and
  passed down. NB `content_value($key)` takes ONE argument and already returns `''`; a
  second "default" is accepted at runtime and silently ignored, so only PHPStan catches it.
- **"Reason:" is a form field, not a sentence.** The refund, cancellation and
  deposit-return emails printed the owner's private note under a bold "Reason:", making
  the SITE appear to justify itself in the register of a rejection letter.
  `email_ownernote($who, $text)` attributes it and returns `''` when empty. Refunds state
  **3–5 working days**, never "a few".
- **PREHEADERS FINISH THE THOUGHT** rather than restating the subject: the money family
  carries the figure + what it does + the deadline, the receipt says what remains, the
  refunds say the working days. Plain text only (the shell escapes them).

### Ink, and the gate that measures the rendered document

**INK vs FILL applies in the inbox too.** The screens learned it once (`--accent-text`
exists because the rose-gold fails AA as WORDS while being fine as a button or a rule) and
the fix stopped at the edge of the browser: measured across the rendered templates,
**sixteen ink/ground/size combinations sat below AA** — the worst `email_amount`'s figure
at **2.00:1**, i.e. the one number a refund email exists to state, and an **unsubscribe
link at 2.12:1**, the one element in a marketing email with a legal expectation attached.
Four ink tokens, now the back office's own light-mode text tokens, each measured on the
three grounds an email ink sits on (card #FDFCFA / well #F4F4F2 / outer #F5F1E9):
- `email_muted_ink()` **#52646E** = `--text-muted` (6.01 / 5.60 / 5.47) — all secondary
  text. It first replaced FOUR near-identical failing greys that served no hierarchy.
- `email_accent_ink()` **#965C35** = `--accent-text` (5.28 / 4.92 / 4.81) — the accent as
  TEXT: a link, an accent word, a ★ glyph. The accent stays the FILL (#C6885E light,
  #D6A785 dark).
- `email_warn_ink()` **#9C5300** and `email_alert_ink()` **#BC2626** = `--warn-text` /
  `--danger-text` (5.61 / 5.22 / 5.11 and 5.95 / 5.54 / 5.41) — the digest's
  needs-attention rows once set amber and red straight into 13px `color:` (**#ffb74d at
  1.73:1**), on the one email that exists to say something has gone wrong.
A shade past the mark, never on it — the discipline the screen tokens follow. NB
invoice.php restates these four (its composer is pure and loads no mailer) and
test-invoice §6 asserts equality, and the owner's PDF (app.js `downloadInvoice`) carries
the same accent/alert inks with smoke-test pinning `150,92,53` — move all three together.

**`test-emails-render.php` — every composer runs, and no colour is illegible.** It
splices a capture into BOTH `smtp_send` and `smtp_send_batch` (send_owner posts through
the batch one — patch only the first and every owner email renders as "nothing
captured"), stubs the db.php helpers, and lets `db()` THROW, so a composer that grows a
`content_value()` call fails loudly rather than quietly needing a database. Sections:
- **§0** every `test-*.php` is stripped from BOTH deploy passes (production AND staging).
- **§1** all 38 render with a subject, a text half and a full HTML document, plus a
  coverage check that no composer in mailer.php is left unreached.
- **§2** contrast by arithmetic on the rendered output, **walking a background stack**
  because an ink is only legible against the ground it ACTUALLY sits on (measuring
  everything against white reported the tinted panels as fine). Vacuity-guarded at ≥250
  coloured nodes. Runs a DARK pass too.
- **§4** drives the REAL `chb_send_sample_emails('all')` through the harness. What it
  does NOT prove, break-tested: a non-numeric total still sends, so a WRONG FIGURE
  passes — it guards the affordance, test-payrail owns the arithmetic. The `[SAMPLE]`
  prefix is applied by smtp_TRANSMIT, downstream of the spliced smtp_send, so asserting
  it on captured subjects would measure the harness; both halves of the real mechanism
  are checked instead.
- **§5** ratchets the RETIRED inks across every file that composes email. §2 measures the
  rendered output, the strongest check available, but only sees what mailer.php builds —
  so the weeklies were still setting a retired `#8E877A` as TEXT afterwards. Narrow on
  purpose: it forbids a retired ink as `color:` only, because the same hexes stay correct
  as FILLS and a blanket ban would fail on correct code and get worked around.
- **§9** counts greetings BY NAME over every rendered template, in each half separately,
  discovering the name FROM the greeting rather than a list.
- **§11** drives the REAL GD path for the photo band with a fixture JPEG.
- **§13** reads every email colour against the **app.css token it was taken from**,
  composited onto its real ground (`rgba` glass over `--dark-grey` → the card) in both
  themes, so "the dashboard's colours" is a property of two files gated as one: move a
  token and this fails until the emails follow. Plus one button colour across every
  rendered email, no 3px accent bar, the stay dot above the title, and the owner deep
  links. Break-tested six ways (card drift, a bar restored, the payment link removed, a
  caller's own accent reaching the button, a dark ink drifting, the dot removed). NB
  "the button takes the cottage colour" first did NOT fire — no caller passed one any
  more, so removing the guard changed nothing; the break-test had to add a caller that
  does.

### The lessons the gates themselves taught

- **A NEGATIVE SOURCE SCAN MUST NOT SEE ITS OWN EXPLANATION.** Two gates assert an
  absence and both first failed against the comment stating exactly that, three lines
  above the code they guard. test-payrail strips `//` lines before any such assertion.
- **A SOURCE SCAN SEES WHAT IT WAS WRITTEN TO SEE.** §5 matched `color:<hex>` ADJACENTLY,
  and the digest wrote `'…color:' . ($sev === 'action' ? '#e57373' : '#ffb74d') . '…'` —
  a separate string literal, so §5 reported "no retired ink" while a 1.73:1 amber
  shipped. **§2's measurement of the RENDERED output is what caught it.** §5 now also
  matches the concatenated form. General rule: the rendered measurement is the one that
  cannot be dodged by how the string was assembled.
- **A GATE THAT SCANS FOR A PHRASE PRESENT IN BOTH HALVES IS VACUOUS.** Three checks
  passed with the HTML half deleted because the text half carried the same sentence, and
  one passed with the whole amount block gone because `email_h()` renders the same words.
  Assert the halves separately, and target the BLOCK rather than the words.
- **A HELPER-ONLY GATE MISSES THE ROUTE.** test-emails-render drives `arrival_email_body`
  and passes with the whole `arrival` branch deleted from bookings.php. The wiring is
  gated in **test-integration §23**, which posts the real `email_preview` both ways.
  Whenever a pure builder gains a field, gate the ROUTE that fills it.
- **§9's counter needed two things to work**: a tag becomes a **SPACE**, never nothing (a
  bare `strip_tags` welds `…below.<br>Hello Wren` into one word and hides the SECOND
  greeting — the break-test found 1 of 2 until fixed, i.e. the counter was blind to
  exactly its own defect), and entities are decoded. Vacuity-guarded at ≥20 hits; it
  sweeps 46.
- **A VACUITY GUARD MOVES WITH A CONSOLIDATION.** §5's composing-files floor went 8 → 4 →
  **2** (its end state: mailer.php + waitlist-lib.php) as compositions left their routes.
  The drop IS the win, so the guard also asserts `mailer.php` BY NAME — a bare count would
  pass on two files that happened not to include the real one.
- **The gate's scratch files live in the SYSTEM TEMP DIR**, or an aborted run leaves one
  beside the app where `test-auth-posture.php` fails it as an unregistered endpoint. The
  copied email-samples.php therefore needs its `__DIR__` pinned to the real app path.
- **PHPStan caught two payload keys the template never asked for** — variables that do not
  exist in owner-digest.php at all, invisible to every other gate because an undefined
  variable there is just an empty string.

### The previews, and what rendering them found

**THE OWNER CAN PREVIEW EVERY EMAIL, and a gate keeps that true.** `email-samples.php`
had drifted to 13 of 19 senders — omitting BOTH automatic-payment emails (the newest and
most complex money emails, where a wrong figure is least recoverable), the enquiry
acknowledgement and the owner's own new-enquiry notification. It looked decided and was
accidental, which is what a registry does when nothing checks it. It is **38 entries**
now and §1 renders all 38. NB the coverage check's exclusion list is written out IN FULL
and must not be derived from §1's — deriving it was vacuous, because §1 legitimately
excludes the two autopay senders and those were exactly the previews that were missing.

Thirteen templates that composed inline in a route or cron script now have pure builders
in mailer.php taking their facts as arguments (`owner_mail_test_body`, `admin_code_body`,
`backup_report_body`, `guest_chat_body`, `guest_message_body`, `enquiry_nudge_body`,
`enquiry_rescue_body`, and the plain `owner_note_*` notes). **Their look was never the
problem** — `send_owner()` wraps a plain-text caller in `owner_alert_text_html()`, so
they always carried the house shell; what they lacked was a function a sample could call
without the route. A plain builder returns `['subject','text']` only and the gate drives
it THROUGH send_owner, so §2 measures the document that shell produces. The two weeklies
outlasted the rest because they compose from a dozen live figures — the payload IS the
work; `owner_digest_body($d)` / `weekly_analytics_body($d)` take it, the four pure
FORMATTERS moved into the builder, everything touching the database stayed in the cron.

**RENDERING THEM FOUND A REAL DEFECT IN THREE GUEST EMAILS**: the two enquiry nudges and
the abandoned-enquiry rescue were the only templates handing a PER-COTTAGE accent to
`email_btn` with `'#ffffff'` as the ink — **3.30:1** on Jollyboat's green. A button carries
WORDS, so it takes the house accent+ink pair; the cottage colour stays where it is a FILL.
Nothing could see this because nothing rendered these three.

**THE TWO WEEKLY EMAILS HAVE A BUTTON** (Manage → System check → More tools).
`owner-digest.php` and `weekly-analytics.php` have supported `?force=1` since they were
written — their own headers say so — and nothing in the back office ever asked, so
seeing your own digest meant waiting for Monday. `sendWeeklyEmailNow` POSTs with the flag in the
QUERY (the script reads `$_GET['force']`; the POST is what makes `require_admin()`
enforce CSRF). These send the REAL email with REAL data, which beats a fixture. **The
enquiry nudge deliberately gets NO button** despite supporting the flag: it emails
GUESTS, so forcing it is live marketing, not a sample.

### The look

- **THE BACK OFFICE'S OWN COLOURS** (asked for from a screenshot of the sign-in code
  email beside Today: "change all emails from the brown colour to the exact same colour
  as the admin dashboard… they need to look consistent"; approved demo). Supersedes the
  modern pass's brown palette, serif brand and cottage bar. Every colour is a dashboard
  token COMPOSITED onto the ground it sits on, since an email cannot lean on rgba: dark is
  Today's `#121316` ground, `#16171A` card (the 1.8% glass), `#242528` hairline and
  `#D6A785` button; light is the linen `#F5F1E9`, card `#FDFCFA`, slate inks.
  - **ONE SHAPE** (the order in mailer.php's header comment): brand line → the stay →
    title → lead → key block → one button → second choice → details → small print.
  - **NO ACCENT BAR** — it was three colours (cottage / gold / rose), the loudest
    inconsistency. The cottage is a DOT beside its name (`email_eyebrow`), the timeline's
    lane-dot vocabulary; a fill, so any cottage colour is safe.
  - **THE TITLE IS "Today"** — 28px at regular weight — and says what the email is for:
    "Pay your deposit", never just "Jollyboat".
  - **ONE BUTTON**, the Today card's "Return £50": full-width 48px pill, the accent under
    `#1B1208`; `email_btn` ignores a passed accent. The second choice is the same pill,
    outlined. The key figure or code sits in an inset well and is always INK — the label
    says whether money goes out or comes back.
  - **STATES ARE CAPSULES** (`email_cap`, the dashboard's `.st-cap`): "UPCOMING" in 10px
    tracked capitals became "Confirmed", and a deposit-paid booking stopped showing its
    payment state in RED (the old rule was paid → green, anything else → red).
  - Six type sizes (12/13/15/17/28/34, was sixteen), three corners (card 20, inside 12,
    round), the brand name in Montserrat (the back office's one font — the serif's last
    survivor went), one greeting ("Hello <first name>,"; three said "Hi").
  - **OWNER ALERTS END WHERE THE OWNER ACTS.** `owner_alert_text_html` renders a
    paragraph of "Label: value" lines as `email_rows`, keeps a 3+-part subject's first
    part as the title (the payment alert's wrapped to three lines), and renders
    `owner_open_line($target)`'s "Open in the back office: <url>?open=<target>" paragraph
    as the one button — a usable link in the text half too. Targets are chbOpenTarget's:
    `booking-<id>` (pay.php now passes `id`), `moderation`, `inbox:messages`,
    `settings:experiences`; the push fallback carries the push's own target and the
    digest opens `today`.
  - **A PRINTED LINK IS STYLED AS A LINK.** The sign-in emails' fallback URL was plain
    text, so iOS Mail auto-linked it in system blue — the one off-palette colour in the
    screenshot. It is an `<a>` in the accent ink now.
- **THE DARK TWIN IS ONE DEFINITION** (`email_dark_palette()`): the shell BUILDS its
  `@media (prefers-color-scheme: dark)` block from it and §2's dark pass READS it, so the
  palette served and the palette measured cannot drift. Class hooks are INJECTED AT THE
  CHOKE POINT (`email_dark_hooks()` over the finished document inside email_shell) — the
  pdfSafe rule: a sanitiser you have to remember is one the next composer forgets.
  The one unmapped ink is the button's `#1B1208`, on the accent in both themes. **A
  SURFACE'S FILL IS A SIMPLE CLASS RULE (what §2 measures) AND ITS EDGE A DESCENDANT RULE
  declared after `.em-card td`** — before that split, `.em-card td` (0,1,1) silently
  outranked `.em-r2` (0,1,0) under `!important`, so the price box's heavy rule had never
  once rendered heavy in dark mode, and a descendant-only well would have been invisible
  to the gate.
  Apple Mail honours the block; Gmail ignores everyone's preferences and self-transforms
  regardless (no opt-out exists; the chosen values survive that transform too).
  Break-tested three ways. **The dark pass found a real ink on its first run** — the
  magic-link email's off-token `#6b6b6b` at 3.10:1 on the dark card. The general rule: an
  ink outside the token set is invisible to every palette that ships.
- **THE PHOTO BAND** (`email_photo_band` pure + `email_prop_photo` IO): the confirmation
  and arrival emails carry the cottage's FIRST gallery image, GD-downscaled to 560w and
  INLINED as a data URI (the crown's rationale — default image-blocking cannot strip it),
  refused over ~66KB of base64 against Gmail's 102KB clip. Local `uploads/` only (a remote
  gallery URL is not ours to fetch at send time), traversal refused, and **every refusal
  returns `''`** — no band, never a broken img.
- **THE CROWN IS 144px AND MUST NOT BE QUANTISED.** Stored 240×240, displayed 72, so 144
  is all a retina `<img>` can ask for: 14,026 base64 bytes → 8,864, every email ~5KB
  lighter for no visible change. A 64-colour palette reaches 2,476 bytes and the
  per-pixel arithmetic calls it fine — **it still BANDS**, because banding is a STRUCTURED
  artifact a mean per-pixel delta underweights. The arithmetic passed and looking at it
  did not, which is the whole reason to look.
- **THE STARS COME TO THE INBOX**: the review ask carries five ★ links →
  `?review=<prop>&stars=N`; `maybeOpenReviewLink` polls for the card's own `gb2Star`
  button and fires the same prefill My Stays' star-tap performs — armed on BOTH auth
  branches, because the boot runs it before the session restore lands. A star glyph is
  TEXT to a renderer, so it takes `email_accent_ink()`, not the fill.

### And one rule about asking

**AN EDIT THAT CHANGES NOTHING THE GUEST WOULD NOTICE MUST NOT ASK.**
`offerUpdatedConfirmationEmail` fired after EVERY save, so correcting a phone-number typo
raised a dialog asking whether to re-send the whole confirmation. `bookings.php`'s update
tail returns **`material`** — dates, cottage, party or price, i.e. what the confirmation
actually STATES — derived server-side because the client no longer holds the old row. An
ask that appears for nothing teaches the owner to dismiss the one that counts.

**NOBODY IS GREETED TWICE.** `build_enquiry_reply_email` OWNS the greeting (it must: an
owner typing a bare message still gets one), so anything that FILLS its body must not
greet. The defect was found once and then shipped TWICE MORE on surfaces nobody
re-checked — reported from a phone as "Hello Laura," above "Hello Laura — everything you
need for Pimpernel is below." The three: the arrival REVIEW preview went through that
builder at all (the SEND had always routed to `send_arrival`), `chbDraftBookingReply`
opened with its own `Hello <first>,`, and nothing held the STARTER reply library to the
rule its own comment states. `arrival_email_body()` + `arrival_email_payload()` were split
out of `send_arrival_email` / `send_arrival_for_booking` so the preview builds the REAL
email from the REAL payload. The waitlist's own `wl_send($row)` needed no extraction —
it simply had no caller.

## A refund asks whether it is still you (the step-up)

**Asked for after the security review.** A signed-in admin session is long-lived
and carried in a pocket; everything else in the back office is recoverable if it
is borrowed for five minutes, and a REFUND is not. So the three actions that
push money OUT require a fresh proof on top of the session — a passkey assertion
or the account password, re-entered.
- **`require_reauth()` / `reauth_fresh()` / `reauth_stamp()` (db.php).** The gate
  answers **401 with `code: 'reauth_required'`** and a sentence — never a bare
  "Unauthorized", which reads as being logged out. The stamp is bound to the
  admin id, so it cannot survive a switch of account inside one session, and a
  clock that has gone BACKWARDS reads as stale rather than fresh for N minutes.
- **It is a WINDOW (`REAUTH_WINDOW`, 5 min), not a per-action prompt.** Returning
  five deposits after a changeover is one confirmation. A control people are
  forced to repeat is a control they route around.
- **Gated where money LEAVES, and nowhere else**: `refund`, `return_deposit`, and
  `cancel` — the last **only when it actually refunds** (a typed amount, or a
  damages deposit the cancel path returns automatically). `keep_deposit` is not
  gated: nothing goes out. Both halves are asserted, so this can neither erode
  into "ask for nothing" nor swell into "ask for everything".
- **Two ways to prove it, cheapest first**: `admin_reauth_password` (auth.php,
  throttled on the SAME identifier as sign-in so it cannot become a quieter way
  to guess the password, and a failure is logged as a warn) and
  `admin_reauth_begin`/`_finish` (passkeys.php). The passkey one differs from
  admin_login_finish in two ways that matter: the credential must belong to the
  admin ALREADY signed in, and the challenge is consumed on use.
- **`chbWithReauth(what, fn)` WRAPS rather than guards** (admin.js). The action
  runs normally and only a `reauth_required` refusal raises the prompt and
  retries ONCE — so the SERVER owns the rule, the client cannot forget to ask,
  and a window still fresh costs nothing. The retry carries the same payload:
  the owner's tap is not lost. Declining throws `reauth_cancelled` with "nothing
  was refunded", because "not confirmed" must never read as "done".
- Gates: **test-integration §24** (refused on a fresh session with the money
  unmoved, a wrong password refused AND logged, the right one opening the way,
  a guest session unable to confirm at all, and the two ungated actions staying
  ungated) — break-tested by disabling the gate, which fires four; and
  **ui-test-reauth.js** (prompt-then-retry with the same payload, a fresh window
  asking nothing, declining sending nothing, a wrong password not refunding) —
  break-tested by removing the retry, which fails the suite outright.
- NB the suite's own money calls now step up first (`it_reauth()`), which keeps
  the existing refund coverage exercising the REAL path rather than a weakened
  one.

## The weekly backup leaves the host ENCRYPTED, or it does not leave

**Found in a security review, and it was the biggest real exposure in the app.**
`backup.php` emailed the full gzipped dump to the owner "so a copy lives off the
host" — every guest's name, email, phone, address, postcode, booking history and
chat messages, in plaintext, weekly, into a mailbox that keeps it for ever and
syncs it to every signed-in device. The off-site copy is worth having; the
plaintext is not.
- **THE RULE IS ABSOLUTE: encrypted or not attached.** There is deliberately no
  path back to a plaintext attachment — not when the passphrase is missing, too
  short, unreadable, or when the host has no OpenSSL. Any of those sends the
  REPORT with no file and says why. "We couldn't encrypt it" must never degrade
  into "here is everything about your guests". `backup_encrypt()` returns `''`
  on every refusal precisely so the caller has nothing to attach.
- **THE FORMAT IS OPENSSL'S OWN CONTAINER** (`Salted__` + 8-byte salt +
  AES-256-CBC, key/IV via PBKDF2-HMAC-SHA256, 10,000 iterations) — byte for byte
  what `openssl enc -aes-256-cbc -pbkdf2` produces. A backup you cannot open is
  not a backup: recovery is ONE standard command on any Mac or Linux box, with
  no PHP and no this app, and that command travels IN the email
  (`backup_recovery_command()`, never carrying the passphrase).
- **THE GATE DECRYPTS WITH THE REAL `openssl` BINARY**, not with our own
  `backup_decrypt` — encrypt-then-decrypt with one's own code proves only that
  the two halves agree, and if both are wrong nobody finds out until the day it
  matters. Same discipline test-webpush.php follows against RFC 8291's vectors.
  test-backup-crypt.php (27 checks, CI-wired, deploy-excluded) also asserts the
  printed command IS the command that worked, so the instructions and the file
  cannot drift.
- **The passphrase is a PRIVATE content key** (`backup-passphrase`, encrypted at
  rest) set in Manage → System check, with a `BACKUP_PASSPHRASE` config const
  winning as every other secret here does. NB the bacs-details trade (don't
  encrypt, a failed decrypt becomes garbage in a guest's inbox) does NOT apply:
  an unreadable value here means the dump is not attached, which is the safe
  outcome. The field never echoes the stored value back — a password box that
  redisplays a secret hands it to whoever opens the page — and the state line
  says only WHETHER one is set.
- **Length is the only rule** (≥12 chars): character-class rules push people
  toward "Passw0rd!" while a long phrase they can remember is stronger.
- Break-tested both ways: restoring the raw-dump attachment fails §5, and
  dropping the passphrase check fails three of §4.
- NB the gate's counter is named **`bck()`**, not `chk()` — PHPStan analyses
  every test file as ONE set and two suites already declare a 2-argument
  `chk()`. A unique name is the fix, not a matching signature (the `ok()` lesson
  in the invoice notes).

## The arrival email waits for the owner (migration-114)

**Asked for, and the two judgements are the OWNER'S, not defaults**: the arrival
email may be read, edited and sent by hand instead of going on its own — and
when it is, **nothing sends without them**. There is deliberately NO auto-send
fallback: an email the owner meant to write is not improved by the app writing
it at the last minute, so the ESCALATING DUTY is what stops it being forgotten.
- **A SETTING, default OFF** (`arrival-review`, internal — classified in db.php).
  Off is today's behaviour byte for byte, so nothing changes for anyone until it
  is switched on in Manage → Follow-ups. The switch is NOT inverted (unlike the
  two nudge toggles beside it: those store `-off`), and it hydrates from
  **adminPrivateContent FIRST** — an internal key is absent from the anonymous
  boot GET, so reading `siteContent` alone would paint it OFF over a real ON and
  one tap would silently turn reviewing off (the bacs-details rule).
- **`pre_arrival_ready_at` is not `pre_arrival_sent`** — "waiting for you" and
  "it has gone" are different facts, and the pair is what makes the duty
  self-clearing: the send NULLs the stamp, so the row ends with the job done.
  The stamp is set with COALESCE so the daily job notifies ONCE per booking,
  not every morning.
- **A MISSING COLUMN NEVER STOPS THE SENDING.** pre-arrival.php probes for the
  column and falls back to sending when it is absent (pre-migration installs) —
  failing closed on "review" would silently stop every arrival email.
- **The editable part is the MESSAGE; the facts stay generated.**
  `arrival_default_message()` is that opening sentence stated ONCE, so the
  composer prefills from the same function the email renders — otherwise the box
  shows one thing and the guest receives another. Dates, address, directions and
  the "Open my booking" button are still composed by the template, and the
  composer shows them read-only beneath the box, because an owner who cannot see
  them types them again and the guest reads everything twice. The SUBJECT names
  the arrival date and is read-only for the same reason.
  **The note is free text and is escaped at the boundary** (`nl2br(email_esc())`
  — email_p expects PRE-ESCAPED HTML, the asymmetry in the mailer notes), so a
  typed apostrophe or a stray `<` can never reach a guest as markup.
- **The send goes through the ARRIVAL template, never the reply composer** —
  `__composeTarget.arrival` routes `sendEnquiryEmail` to `send_arrival`, because
  `email_guest` would wrap the words in the enquiry-reply shell and lose the
  designed email. Gated as an absence too (no `email_guest` post).
- **The duty ESCALATES rather than nagging**: amber while there is room, RED once
  they arrive tomorrow or today ("They arrive TODAY and still have no
  directions"). No ready stamp → no duty, so the app never invents a chore.
- **A FAILED SEND KEEPS THE WAIT.** The stamp is cleared only on success —
  clearing it on a failure would retire the duty while the guest still has
  nothing, which is the exact lie this feature exists to prevent. Gated.
- **LOOKING AT IT FOUND THREE THINGS THE GATES DID NOT.** The modal still read
  "Email guest" after the owner tapped *review the arrival email*; the reply
  library's tools were live, so **✨ Draft reply would have replaced the arrival
  message with a booking reply**; and the facts panel was rendered into
  `#etpl-acts`, which the reply library's own async content refresh
  re-renders — silently wiping it. The panel has its own node
  (`#arv-facts-host`) now, and `openBookingEmail` restores every piece of
  chrome the review dressed, because the two share one modal.
  **AND THE FIRST FIX FOR THE STAND-DOWN DID NOT WORK WHILE ITS CHECK PASSED**:
  `#enq-email-ctl` carries an inline `display:flex`, which outranks the
  `hidden` attribute — so `el.hidden` read true while the row was still on
  screen. Hidden via `style.display` now, and the gate measures
  `getClientRects().length` — the paint, not the attribute. Same family as the
  contrast traps: the property is not the pixel.
- Gates: **test-integration §23** (the job MARKS instead of sending, once; the
  preview; a failed send keeps the wait; an already-emailed booking is never
  re-readied) — break-tested by forcing review off, which fires three;
  **test-emails-render §8** (the note reaches both halves, is escaped, replaces
  the house sentence rather than doubling it, and leaves the facts intact) —
  break-tested by dropping the escaping; and **ui-test-arrival-review.js**
  (the escalation both ways, the notification route, the read-only subject, the
  send path) — break-tested on the severity and the send branch.

## The check-out tap (migration-120)

**Asked for as "a check-out button that lets us know when the guest has left"
(approved demo, "Build it").** On the LAST MORNING only, the in-residence hub
carries "We've left the cottage": one tap records `guest_checked_out_at` and
tells the owner the changeover can start — a push ("Jollyboat is yours again —
Sarah tapped \"we've left\" at 9:41 — 19 minutes before checkout"), the hub
when-line gaining `left 9:41 ✓`, and the deposit-return duty arriving at the
tap instead of the checkout hour.
- **A SIGNAL, NEVER A CLAIM.** What is recorded and told is that the GUEST
  TAPPED — every surface says "left 9:41 ✓ (guest-declared)", never that the
  cottage is empty or inspected. And NOTHING depends on it: the duty gate is
  `hasCheckedOut(b) || b.guestCheckedOutAt` — additive only, so an untapped
  stay renders and behaves byte-for-byte as before (break-tested both ways).
- **THE WRITE HAS ITS OWN DOOR** (`guest-checkout.php`, posture `guest`) —
  my-bookings.php stays read-only (its 405 is a tested decision). The server
  re-enforces the window BOTH ways (before the last morning: "the button
  hasn't unlocked"; after the stay: "already ended", so a late tap never
  re-notifies), ownership is the session guest's own email (plain equality —
  the migration-112 collation rule), and the tap rides the op ledger with a
  DETERMINISTIC id (`gco-<id>-<date>`) so a poor-signal retry replays the
  stored success. The UPDATE is COALESCE (two devices racing keep the FIRST
  time, and the time TOLD is re-read so it is the time KEPT); a fresh second
  tap answers `already` with the original time — a guest doing the right thing
  twice must never read an error. The already/replay branches exit BEFORE the
  tell, which is what §30's one-activity-row checks measure.
- **THE CLIENT TRUSTS THE REFETCH AS THE RECORD**: `guestCheckoutTap` posts
  then calls `renderGuestBookings()`, which re-reads my-bookings (now carrying
  the stamp). A local cache patch was written first and DELETED — the refetch
  overwrites it, so it could only ever disagree (the ui gate caught exactly
  that: tick rendered from the stub's unstamped row = empty).
- **The push is a normal owner alert**: category `checkout` (joined
  NOTIFY_CATS, so it is mutable; notify_should_push treats an unknown key as
  allowed, so older prefs need no migration), per-booking tag, deep link
  `?open=booking-<id>`, email fallback. Best-effort in a try — the record
  stands whatever happens to the notification.
- **The button's whole life is one window**: it renders only when
  `b.checkOut === todayDashed()`, and after the checkout HOUR the in-residence
  card itself stands down (isInResidence is time-aware) — so the ui gate pins
  the clock to 08:30 with `page.clock.setFixedTime`, and search-test's duty
  case pins `ukNowMinutes` in the vm rather than writing a 23:59 fixture (the
  documented one-minute-a-day trap).
- Gates: **test-integration §30** (ownership, the window both ways, the tap +
  ONE activity row, op-ledger replay and the graceful already — both leaving
  the alert count at one), **ui-test-yourstay §34** (the button's window, the
  ask-first confirm, backing out sends nothing, the deterministic op id, the
  tick from the refetch, the mid-stay ABSENCE — break-tested by deleting the
  day gate), and **search-test A3** (the duty arrives at the tap, labelled
  guest-declared; the untapped twin left alone — break-tested by reverting the
  OR).

## The Guest Book (migration-121) — private guest ratings

**Asked for as "can we rate customers Like on Airbnb. Cleanliness. Rules
communication etc" (approved v2 demo, "Build it").** One row per booking in
`guest_ratings` (PK booking_id): overall 1–5 + three marks (clean/rules/comms ∈
''|good|poor) + note ≤500 + rated_at. PRIVATE and OWNER-ONLY, absolutely: never
in a guest payload (§31 searches the RAW my-bookings text for the markers, not
the parsed shape), never in the night brief or world sheet.
- **`rate_guest` (bookings.php)**: re-rate REPLACES (INSERT…ON DUPLICATE KEY),
  overall 0 DELETES (`removed: true`) — un-rating is a first-class act, not a
  1-star. Marks and note length refused in words; un-migrated → the
  run-the-migrations sentence. Rows ride `bookings_admin_payload` best-effort
  as `gr_*` (one grouped query, try/catch — a missing table never blanks the
  booking list), mapped to `b.guestRating` in mapBookingFromApi.
- **`chbGuestBookFor(rec)` is the ONE aggregation** (admin.js): strong identity
  via chbCustomerKey — a name-only key (`b:` prefix) returns null so two John
  Smiths never share a book, but a name-only stay's OWN rating still lists
  (identity governs MERGING, not whether one stay's rating exists — the
  search-test worst-first case pins this). **LATEST SPEAKS, HISTORY WHISPERS**:
  the newest rated stay is the verdict, older ones are a muted "usually" line.
- **THE PAUSE IS ONE SHARP RULE**: latest overall ≤2 OR rules === 'poor' —
  cleanliness/comms poor earn a pill, never a pause (a mess is money, the £75
  deposit's job; rule-breaking is the relationship). The enquiry hub renders
  `.gb-pause` ("Worth a pause: … Approving is still one tap — this is a memory,
  not a rule") ABOVE the grid, and **INFORMS, NEVER DECIDES**: the Approve
  button renders byte-identically, gate-pinned so this cannot erode into an
  auto-decline.
- **The rating moment is the deposit decision**: returnDeposit/keepDeposit
  success opens the hub's rating fold (`__bhubOpenFolds.add('rating')`) — an
  offer at the natural moment, never a nag. The card (`hubGuestBookCard`,
  PAST stays only) states the record's own facts (deposit state, the check-out
  tap, paid state via bookingDue) beside the stars, so the owner rates against
  the record, not memory. `gbSyncNote` reads the textarea BEFORE any re-render
  (the bank-details trap). Stars are TEXT → `--accent-text` (the a11y rule).
- Surfaces: booking-hub intel fold + enquiry intel (other-stays only — the
  current booking's own rating is the card, not intel), directory row `· ★N`,
  and a search family (`CHB_GUESTBOOK_Q`, 0b9 before CHB_WAITLIST_Q — "who are
  my best guests" / "guests i rated poorly", worst detection flips the sort).
  NB fixture names must not contain the family's own query words ("Rated Rita"
  was intercepted by the name-match tier; "Norah Neat" is the shape).
- Gates: **test-integration §31** (guest 401, validation in words, dated write,
  replace, remove, the raw-payload absence, gr_* on the admin GET),
  **search-test** guest-book block (latest-speaks, both pause halves, clean-poor
  never pauses, name-only null, answer + worst-first, directory sub), and
  **ui-test-hub §A3b** (the card on a past stay only, star+mark+note through the
  REAL post shape, the pause row + Approve-unchanged, 5★ quiet). NB A3b's
  restore stands the enquiry hub down via renderInbox's own empty branch —
  `__enqHubId` is script-scoped (the currentGuest rule) and leaving it set made
  section J auto-dock the wrong enquiry while the stale hidden `.bhub-next`
  shadowed section B's selector.

## The AI chat and the Mac assistant were REMOVED (owner's ask: "not very good and quite slow")

The overnight queue ("Ready for you"), the web AI chat (`view-aichat`), the Mac app
(`mac-app/`, its workflow and its releases) and every client and server piece that served
them are gone. Git history has all of it if it is ever wanted back. What deliberately stays:
- **Two tombstones**, because the deploy NEVER deletes files on the host: `nightshift.php`
  answers 410 and nothing else (a Mac app left installed gets a plain refusal, never the old
  door), and `nightshift-lib.php` is an empty file nothing requires. Both are registered in
  test-auth-posture; test-integration §51 asserts the 410.
- **The tables and migrations** (migration-115 onwards: `night_items`, `night_asks`,
  `ownerchat_msgs` …). A migration is never removed (the ledger keys off filenames) and
  dropping a table destroys data for no gain. Nothing reads or writes them.
- **The content-key classifications** in db.php (`night-shift`, `mac-chat`,
  `mac-chat-memory`, `chat-handoff`, `mac-chat-imports`, `mac-chat-sum`,
  `nightshift-latest-build`, `nightshift-app-url`, `night-warm-until`) and content.php's
  exclusion of `apikey-nightshift`: rows already stored hold the owner's chat words and a
  device secret, so they must never reach the public content GET.
- **self-repair's week-old `chat-photo-*.jpg` sweep**, which clears the photos the chat left
  in uploads/ on the host. Nothing writes them now.
- `via_label()` and the " · via AI chat" activity attribution went with the chat.

## Saved replies and ✨ Draft reply were REMOVED (owner's ask: "delete … completely from the site")

The email composer is a Subject, a Message box, attachments, Preview and Send. Gone:
- **Saved replies**: the composer's picker (`emailTpl*`, `etpl*`), the Manage → Messages & automation row and its
  page (`sec-replies`, `renderSavedReplies`), the search route, and the "Buttons in this email" bar (Pay / Invoice /
  Register buttons on a manual reply). The server half went too: `email_reply_actions` / `email_reply_facts` and the
  `$actions` argument of `build_enquiry_reply_email` / `send_enquiry_reply_email`. bookings.php and enquiries.php
  refuse a stale page's `actions` with 409 "Email buttons have been removed. Reload the page and send it again."
  rather than sending without them.
- **✨ Draft reply**: `chbDraftEnquiryReply`, `chbDraftBookingReply`, `draftComposeReply`, `enqReplyDraft` and the ✨
  rows on the enquiry page and the stale-enquiry fold. The decline ask ("Write the reply") and the declined drawer now
  open the composer EMPTY. The Inbox's "Offer other dates" fills one plain sentence naming the free dates (from
  `enquiryFreeNearby`), and "Write the reply" after a decline keeps its one starter sentence. Neither is the drafter.
- **Kept**: the content key `email-templates` stays classified in db.php and listed in people-lib, because rows
  already stored hold the owner's words and must never reach the public content GET. The chat sheet's "Quick
  replies…" dropdown is a different feature and stays.
- Gates: search-test §26 asserts the functions are gone (and still lays the Jollyboat £130 fixture later sections
  use), test-payrail asserts the resolver is gone and both endpoints refuse, test-emails-render §7 asserts a manual
  reply carries no buttons, ui-test-hub asserts the composer opens empty. ui-test-replies.js was deleted;
  ui-test-onelook, ui-test-people and ui-test-arrival-review were re-aimed (onelook and people not run).

## Guest chat: one page that says how the chat stands (approved demo, built)

Manage → Guest chat (`#sec-chat-away` → `#gc-page`, `renderGuestChat` and the `gc*` block in admin.js, the GUEST CHAT
block at the foot of admin.css). The two old editors (`#chat-away-editor`, `#chat-answers-editor`) are gone;
`renderChatAwayEditor` survives as a one-line alias.
- **The title's pill** is the page's state: `N to answer` (amber, questions guests asked that nothing answered),
  else `Away reply on` / `Away reply off`.
- **Preview → See it as a guest** opens `#gc-sheet`, a bottom sheet on a phone. It draws the guest chat from the chat's
  OWN classes and composers (`chatHelloHtml`, `chatQuickList`, `chatChipLabel`), so it cannot drift from what guests
  see. Tapping a button answers in the preview. "They write at 2pm | At 11:40pm" shows the away reply, or "they wait
  for you", by the server's own rule.
- **Guests asked**: the `guest-faq-misses` list MOVED here from Search learning (`slAddFaq` / `slDismissGuestQ` and
  the Search-learning panel are deleted). Manage's "Needs a look" has its own `guestq` row ("Guests asked the
  chat"), which routes here. Answering one stores it as a typed-only instant answer, for that cottage or every
  cottage. That is deliberately NOT in `faqs-<prop>`, because that key needs the cottage-pages permission and
  `chat-chips` is everyday.
- **When you're away**:
  - the switch (`chat-away-enabled`);
  - the hours as `select.acw-pill`, labelled 7am/10pm and still stored as `07`/`22`, with a sentence saying who gets
    the reply;
  - the reply as a box that grows with its words.

  **An empty box sends the standard words**: messages.php `CHAT_AWAY_DEFAULT` equals admin.js `GC_AWAY_STD`
  (smoke-test holds them equal). Before, an empty box sent NOTHING with the switch on, while the box showed those
  words as its placeholder. The chat-away-* keys are internal, so the page reads `adminPrivateContent` FIRST
  (`gcVal`) and `gcSave` writes both mirrors.
- **Instant answers**:
  - each answer is a fold row with a capsule: Standard, Your words, Added, plus Typed only;
  - the answer box grows with its words;
  - "Use the standard answer" (typing the standard back, or clearing the box, stores `''`);
  - a "Show as a button" switch;
  - "Add a question" (a glassForm);
  - "Your cottages' own questions", which opens each cottage's FAQ section.
- **The data**: new PUBLIC content key **`chat-chips`** `{hide: [standard ids], extra: [{id, q, chip, a, btn, prop}]}`.
  app.js `chatChipsCfg` is the one sanitiser (malformed entries are simply not there; at most 40). `chatQuickList(all)`
  is the one list used by the chat's buttons (`renderChatChips`, on open), the on-device matcher (`guestFaqCorpus`),
  `chatFaq(id)` and the preview. An answer with `prop` is offered only on that cottage's page. **`chat-reply-time`**
  (public: hour / hours / day / next) feeds `chatReplySay()` in the welcome. Both keys are everyday in
  `people_content_cap` and on test-content-keys' `$JS_PUBLIC_OK`.
- Gates: smoke-test's "Guest chat instant answers" block (the sanitiser, buttons per cottage, the corpus, the reply
  time, the two standard sentences equal), **ui-test-guestchat.js** (the page driven in a browser), plus re-aims in
  ui-test-manage / -hig / -search-learning.

## The guest chat says who answers (approved demo v3, built and merged without CI)

**Asked for as "a new and overhauled messages section for guests, show both host and super user first names and
their account photos".** The guest's chat names the people who answer, with their photos, and signs every reply.
Code: the "WHO ANSWERS" blocks in app.js (`chatTeam*`, `chatAva`, `chatHeadHtml`, `chatPinPaint`,
`chatGuestBubbles`, `chatGuide`) and app.css; chat-lib.php (`chat_team*`, `chat_author_name`, `chat_away_at`,
`chat_insert_owner_message`); messages.php (`team`, `set_member`); avatar.php `?team=`; migration-142.
- **WHO IS SHOWN is one rule** (`chat_team_member_ok`): a current person (not removed, not still invited) with a
  name, `admins.chat_show` on (migration-142, default on; a database without the column shows nobody), and
  permission to reply to guests (`gu.reply`). The person whose first name is `host-name` comes first, with the line
  "Host" unless they wrote their own; anyone else shows their own line (`admins.chat_line`, at most 40 characters,
  e.g. George's "Bookings & Website") or none. **First names only**: the public payload is exactly
  `{id, name, line, v}`, no surname, no email (integration §81 checks the keys).
- **EVERY REPLY RECORDS WHO WROTE IT** (`messages.admin_id`, `messages.kind`). `chat_admin_reply` takes the actor
  (`admin:<id>`), so a reply typed in the app and one sent by email (credited through `people_mail_sender_row`) both
  carry the person, and an extra "Also emailed" address carries nobody. The guest's copy sends `by` only for someone
  SHOWN (`chat_team_ids()`); a reply by someone hidden, removed or unknown reads as the business, under the crown,
  and consecutive replies by nobody shown read as one run. The owner's copy names the writer (`by_name`; "You" for
  yourself, "Automatic reply" for the away reply).
- **AUTOMATIC MESSAGES ARE MARKED WHEN WRITTEN**, never guessed from their words: the away reply is `kind 'auto'`
  (no person) and renders "Automatic reply" with the crown in an outlined bubble; the pay link and arrival details
  sent from the chat are `kind 'event'`, one line ("George emailed you a secure link to pay your balance of
  £414.90 · 18:40"). Older messages have `kind ''` and render as ordinary replies.
- **THE PUBLIC PHOTO ROUTE SERVES ONLY THE PEOPLE SHOWN** (`avatar.php?team=<id>`, the same rule): 404 for anyone
  else, served `public, max-age=86400` with the session cookie REMOVED (db.php always starts a session, and a
  publicly cached response must not carry a Set-Cookie). `?admin=` stays owner-only. The URL carries the photo's
  version (`v`, the first 10 hex of the file name), so a new photo is a new URL.
- **"Show me in the guest chat"** (Manage → Guest chat → Who answers): `set_member` changes your own row, or anyone's
  for a Super User (403 `not_allowed` otherwise); the line is whitespace-collapsed with control characters removed,
  and over 40 characters is refused in words. Switched off, you still answer, signed by the business with the crown.
  The card has no explanation line under the rows (removed at the owner's ask).
- **The header**: the faces and "Sophia & George", and a status line: "Usually reply in a few hours" (the
  `chat-reply-time` setting, in its short form so it fits at 390px), or "Away until 7am" with a moon while the away
  reply would answer (`chat_away_state()`; only an away reply WITH hours knows when someone is back). Tapping it
  unfolds the people (`#chat-teamfold`, a 0fr grid fold) and a footnote: "Replies also reach you by email." for a
  signed-in guest, else "Leave your email below and we can reply there too."
- **A signed-in guest's stay is pinned** under the header (`chatPinStay`: the stay in progress, else the soonest
  upcoming, never a finished one): a 44px button that opens it (`chatOpenStay`).
- **A run reads as one**: the name above its first bubble, the face and time under its last; a run is one author on
  one day, and an event line breaks it. Every message is still one `.chat-row`, so only the last row animates in.
- **Seen, and who is typing**: the guest's latest message reads "Seen" or "Sent" (`read_by_admin`); a poll that only
  changes that flips the word where it stands (`chatSeenSig`), no re-render. Typing is named ("Sophia is typing",
  `chat_threads.admin_typing_by`), and unnamed under the crown for someone not shown.
- **The cottage guide's answers are cards** ("From the cottage guide", `chatGuide`) offering "Ask Sophia or George".
- **The reply email names the person** (`guest_chat_body(…, $from)`: "Sophia replied: …"). `strip_quoted_reply`
  cuts that opener from the start of its LINE, because the name comes before the phrase it matches; cutting at the
  phrase left "Sophia" dangling on the guest's message (test-reply caught it).
- **The team is cached per device** (localStorage `chb-chat-team`, cleaned by `chatTeamClean`: at most 6, names and
  lines capped at 40, a photo version only as 10 hex) so the header paints before the chat's first answer;
  `loadChat` asks with `team: 1` and repaints only when it changed. With nobody shown, the header and welcome are
  the ones the chat always had, and every reply is signed by the business under the crown.
- Gates: test-integration **§81** (the columns; the payload's keys; the photo route for a shown person, a person who
  may not reply, an unknown id and `?admin=`; signing in the app and by email; `set_member`'s refusals; hiding and
  removal falling back to the crown; `typing_by`; the away reply's kind), **ui-test-chatteam.js** (41 checks),
  test-reply (the away hours, the named opener), test-emails-render §19, and ui-test-guestchat re-aimed ("Who
  answers" replaced "Signed by"). Break-tested: three server mutations each fail their named §81 checks, and eight
  client mutations each fail their named checks (one passed until the one-run check was added).
- **Not done, said plainly**: the chat button keeps its icon (the demo's faces there were not built), and message
  times are shown as the database stores them, as before.

## Analytics says what each figure counts (rebuilt in the one look, no demo, at the owner's ask)

Manage → Analytics (`loadAnalytics` / `buildInsights` / `anaOpenFold` in admin.js, the ANALYTICS block at the foot
of admin.css). **The old page's figures did not mean what their labels said**, and the rebuild is first a correction:
- "Visits" were page views → the tiles are **People** (`uniqueVisitors`) and **Pages viewed** (`totalViews`).
- Enquiries came from the `enquiries` table, which loses every APPROVED enquiry (approval deletes the row), while
  the funnel beside them read the site's own events (3 against 6 on one screen) → **Enquiries sent** is
  `events.enquiry_submit`.
- "Conversion" divided EVERY booking, the owner's hand-added ones included, by visitors → **Booked through the
  site** is the new `siteBookings` in `analytics_summary()`: bookings in the window carrying `terms_accepted_at`,
  which only an approved site enquiry has.
- "Returning 0%" came from a fingerprint (IP + browser) that changes with a phone's connection → removed. A one-line
  note under the tiles says a person is counted by device and connection.
- The donut rounded 0.6% to "1%", and the funnel's green→amber ramp read as status → both are gone; the funnel is one
  accent colour.

The page:
- The title's pill is the change in people (Down N% amber at −10%, Up N% green at +10%, else Steady).
- The four tiles are `.u-stats`, each with its change in words.
- **Worth knowing** rows, the unmet date searches first; that row opens its fold (`anaOpenFold`).
- Pages viewed each day (`osVBars`, still measured by ui-test-manage §9), then the funnel.
- Four fold rows: Where they came from / What they looked at / What they used (one split bar) / Date searches, with
  a capsule and links to Price ideas and the waitlist.
- Tools as the Status page's `.sp-tool` rows: email this week's analytics, download the CSV.

The CSV and the **weekly analytics email** (`weekly_analytics_body`, payload `sent` / `booked`) use the same figures.
Gated by **ui-test-analytics.js**: its fixture makes each wrong pair DISAGREE (3 table rows against 6 sent, 4
bookings against 1 through the site), so reading the wrong one fails by name. test-emails-render covers the email.

## Email a guest: one sheet, and the email it sends (approved demo v3, built and pushed to main without CI)

**Asked for as "overhaul guest email", demoed three times, then "Build and merge without CI".** One sheet for a
booking, an enquiry and the arrival review (`#enq-email-modal`, the "Email a guest" block in admin.js, `cmp-*`
in admin.css). The ids the rest of the app reads are unchanged (`enq-email-subject` / `-body` / `-send` /
`-title` / `-preview-frame`, `arv-facts-host`), and so are the function names on the stub list.
- **The sheet is Mail's shape.** Send at the top (the keyboard covers a phone's bottom), To with the guest's name
  and address unfolding their stay (`cmpFactsFor`: Stay, Guests, Payment or Quote, and what an enquirer wrote),
  the email's own "Hello <first>," above the box and the signer below it, then "Added below your message": a
  switch for their stay and one for the payment (or the quote), the files, and Attach. Write | Preview.
- **The switches default from the record**: a finished stay leaves its stay out, a paid-up booking leaves the
  payment out (each row says why); an enquiry with no price has no money switch. They post as `include_stay` /
  `include_money` (absent = on, so the Inbox's own replies keep both).
- **Send waits five seconds** with a countdown and Undo (`#cmp-toast`); Undo reopens the sheet with everything
  in it. `composeFlush()` sends what is waiting at once: the timer, the next send, `pagehide` and a hidden tab
  all call it. **`sendEnquiryEmail` returns nothing, not a promise**, so the dispatcher never locks the Send
  button over the wait; a suite that wants the post calls `composeFlush()` after it. A failed send reopens
  the sheet with the words and the reason.
- **Drafts are per device** (`chb-cmp-draft:<kind>:<dbId>`, 30 days, "Saved on this device"). Closing keeps
  one and says so, with Discard; a dot (`.cmp-draft-dot`, a CHILD of the envelope button, because the
  buttons' pseudo-elements carry their 44px reach) marks every envelope whose guest has one
  (`composeDraftDots`, run after each hub render). The arrival review never drafts.
- **The arrival review is the same sheet** (`openArrivalReview` → `cmpOpen` with `arrival: true`): titled
  "Arrival email", the subject read-only, the greeting, sign-off and extras hidden (`.cmp-arrival`), its facts
  panel shown, sending through `send_arrival`. Any other opener takes all of that back off.
- **Preview** is the server's email (`email_preview`, the switches included, debounced 350ms, stamp-guarded)
  under their inbox line; Light/Dark rewrites the email's own `prefers-color-scheme` block (`cmpForceScheme`).
- **On a phone it drags down to close** (past 22% or a flick; a finger that stopped before letting go is not a
  flick, which the gate found); from 641px it is a 600px card. The overlay keeps `.reviews-modal` for the
  shared Escape and Tab handling, and its own look is undone in admin.css.
- **Light mode's `textarea { background-color … !important }`** reaches the letter's boxes; the sheet restates
  `transparent` at id specificity.
- **The email** (`build_enquiry_reply_email($e, $subject, $message, $ctx, $opts)`, mailer.php): the stay's
  eyebrow, the SUBJECT as the title (empty → "Your stay at <cottage>" / "Your enquiry about <cottage>"), the
  greeting, the message, the signer's first name over the business name, then what was switched on. A booking
  states **where its money stands** (paid so far, still to pay by the plan's date, or Paid in full) and links
  back into the booking, never the price again; an enquiry gets its quote, **one "Agreed price for your stay"
  line when the price is custom**, so the lines always add up to the total. The preheader is the start of the
  message. Pure: the sender (`reply_email_opts($in)`: the signed-in person's first name, else the host's, never
  the business twice) and the booking's payment facts (`reply_pay_facts($b)` in bookings.php, counting the
  refundable deposit the way the booking page does) are resolved by the caller.
- Gates: **`ui-test-composer.js`** (50 checks: the person, the facts, the defaults, the empty send, the draft and
  its dot, the preview's choices, the five-second hold and Undo, composeFlush, the enquiry endpoint, the arrival
  dressing on and off, the bottom sheet and its drag, the desktop card); test-emails re-aimed (the payment
  position, the switches, the quote adding up); test-integration §23 gains the ROUTE half (the pay facts and both
  switches through the real `email_preview`); test-emails-render's two double-greeting controls count "at least
  two" (the preheader repeats a greeting the message brings); onelook §14, ownerday §5, arrival-review and e2e
  re-aimed. ui-test-mailbox was already stale on main (it expects a drafted reply) and was not touched.

## Add or edit a booking: one sheet (approved demo v2, built and pushed to main without CI)

**Asked for as "overhaul the add booking page", demoed twice, then "Build it, merge without tests or CI".** Supersedes
the sectioned form (its `.modal-foot`, `.mav-strip`, `.modal-cols`, the date trigger and `#modal-date-verdict`). The
sheet is `#edit-modal .modal-box.bks` in index.html, the "ADD-BOOKING SHEET" block in admin.js (`bks*`) and the "ADD /
EDIT A BOOKING" block in admin.css.
- **The hidden `#modal-*` inputs are still the form's STORE.** setModalFields, tlAddAt, the cmdk prefills, the
  walkthrough, the new-cottage wizard and saveModal read and write them unchanged. admin.js `bksSync` paints the sheet
  from them; app.js reaches it only through `bksHook()` (guarded on `__ADMIN_LOADED`, the chbFrameSync pattern), and
  setModalFields calls `bksReset(f)` for the view state (folds, price mode, reason, the switch).
- **Check-in is always 3pm and check-out 10am**: the tiles state them, nothing asks. The hidden time inputs keep the
  values so every save path is unchanged.
- **The stay**: a cottage row unfolding the list (Free / Booked / Too small capsules once dates are set; "A new
  cottage" starts the existing wizard), Arrive | Leave tiles over an inline calendar with each free night's price
  (`nightlyRateFor`, the guest calendars' function), and a verdict row: nights, ✓ Free with the next arrival, or
  "Overlaps <who>" with the first free cottage that fits offered as one tap. Picking a smaller cottage brings the party
  down and says so. The server's clash and occupancy confirms are still the authority.
- **The price**: Standard (night by night, every line from the price model's parts, so they add up to the row) or
  Custom as a total, a night or a discount. `price_override` is always a TOTAL; a night or a discount is re-derived
  when the standard moves (`bksDerive`), and values carry between modes unrounded. "Why" chips store
  **`bookings.price_reason`** (migration-138, VARCHAR(40), owner-only: unset in `my_bookings_payload` and the guest
  export). The first payment row folds the plan (deposit % and balance date on the same calendar).
- **An edit never re-sends money.** The paid card is add-only; an edit shows "Received so far" (`displayGrand().paid`)
  and posts no payment fields, which the server's update keeps. The refundable deposit is a stepper until it has been
  taken, then a fact. A fully paid booking (`bks-paidlock`) offers no custom price; an arrived one (`bks-movelock`)
  locks the cottage and dates with a note.
- **The confirmation is a switch.** Add: on by default; off posts `send_confirmation: false`, which reaches
  `send_booking_emails` as `skip_guest` (the owner's copy still goes). Edit: on when something the confirmation STATES
  changed (cottage, dates, party, price vs `__bks.orig`), unless the owner touched it; on means saveModal calls
  `send_confirmation guest_only`. The post-save "re-send?" dialog is no longer asked from this sheet.
- **Add says what is missing** instead of refusing in a box: no dates opens the calendar and nudges the tiles, no name
  focuses the field (`bksHook('nudge-dates'|'nudge-name')`); the button is `aria-disabled` until both are there.
- **Layout traps found by driving it** (390 and 1280, both themes): `#edit-modal .bks [hidden]` needs `!important`
  (row rules set `display`); a fold is `grid-template-columns: minmax(0, 1fr)` with `min-width: 0` on its child,
  because `overflow: clip` is NOT a scroll container, so its automatic minimum stays the content's and the custom
  price fold grew to 523px in a 390px sheet; the switchers' pills are seated from `openModal` on the next frame (before
  that the sheet is `display: none` and every button measures 0); the mobile 17px input rule needs `!important` on the
  big price input; the "Other" discount box is `3.4em` wide so the forced 17px fits.
- **Not run or re-aimed, at the owner's ask**: ui-test-addbooking (built for the old form), ui-test-dialogs,
  ui-test-hig, ui-test-hub, ui-test-radii and ui-test-onelook §14 (old classes), ui-test-coach (the add-booking walk
  now starts at `#bks-cot-row`), layout-test (its scene was re-aimed, not run). Checked by a throwaway headless drive:
  every state above, no page errors, nothing wider than the sheet, and the save payload (override, reason, the
  confirmation flag). Budgets raised: admin.js +12.8KB, admin.css +2.5KB gz (owner-only, immutable-cached).

## The booking sheet saves what it shows (the add/edit audit)

Nine money defects in the sheet, each reproduced on a full stack (real endpoints, MariaDB, Chromium), plus four
smaller ones. The rule they share: what the sheet states is what the save stores.
- **An enquiry's agreed price** shows on the sheet (Total: "Agreed price + the £75 deposit") and travels only
  with the stay it was agreed for: saveModal carries it through `set_terms` only when cottage, dates and party
  are unchanged, a balance date only while it is today or later and ≤ the new check-in, and the toast names what
  did not travel. Moved, the sheet says "Today's rates · replaces the agreed £X".
- **Clearing a custom price restores the standard.** Add stores the override in `agreed_total` too, so clearing
  `price_override` alone left the 'lost' shape and the old figure in every email. The update path resets
  `agreed_total = agreed_nightly + agreed_txn_fee` when the row, read without its override, is 'lost'; a folded
  legacy row is left alone.
- **A refundable-deposit change is not a new stay**: it writes `agreed_booking_fee` only (it re-snapshotted every
  night at today's rates), and the client's `stayChanged` no longer counts it. It IS material: the confirmation
  states the deposit (server `material`, client `bksMaterial` → the email switch).
- **"Some" prefills only a part payment the server accepts** (`modalSomePrefill`: the first payment while it is
  below the rental). Inside the balance window it prefills nothing and says the whole stay is "All of it"; a typed
  sum that covers the rental is refused before posting; `showErr` scrolls the box into view (it sits at the top
  of a scrolled sheet, so a refusal used to land where nobody could see it).
- **"All of it" on Add posts `deposit_collected`** when the refundable deposit is above £0, and the add action
  takes it (set_payment's flag): the deposit used to read as still owed in the confirmation Add sends.
- **A paid booking's custom price returns once its stay changes** (`canCustom`): hidden, an extension kept the
  old custom total and the new nights were free.
- **"A discount" never re-prices a custom price above the standard** (`__bks.offHold` holds it until a
  discount is chosen); it used to clamp to 0% off and drop £500 to £339.90.
- **Money boxes read through `payPartNum`**: parseFloat read "1,250.00" as £1.
- **An edit that sends no payment fields never needs a payment date**; `record_square_payment` now fills
  `payment_method` ('Square card') and `payment_date` (the Square day) when they are empty.
- Smaller: "A new cottage" is offered on Add only; a party brought down by a smaller cottage comes back when a
  cottage fits it again (`__bks.clamped.from`); without 'mo.ask' the sheet shows no custom price or deposit
  stepper (`#modal-deposit-group` follows 'mo.ask' in CHB_PART_CAP, as the server's strip always did) and the
  server strips `price_reason` with the price; an owner's enquiry edit skips the guest-only stay rules (minimum
  and maximum nights, arrival days) and gets owner wording for occupancy and clashes, and the enquiry calendar no
  longer promises "Add asks first".
- Gates: **ui-test-bookingsheet.js** (31 checks; 16 fixes break-tested one at a time), test-integration **§58**
  and §51's reason check (8 server fixes break-tested), ui-test-people re-aimed to the deposit stepper's
  permission.
- NB a successful save closes the sheet only after its reload, so a suite that opens the next sheet straight
  away must wait for that close (`closedBySave`), or the late close lands on the new sheet.
- NB `CHB_IT_DB_NAME` lets a second copy of test-integration run against the same server for break-testing one
  section; the §32 lock checks and the statement budget then fail from the cross-talk, not the code.

## Each pound once, on the day it moved (the money split and bank audit)

Defects in how the books, the split between hosts and the bank page count money, each reproduced on a full stack.
The rule they share: money is counted once, on the day it moved, with the cottage it belongs to.
- **set_payment takes `expect_paid`**, the figure the page worked from, and answers 409 `code: 'stale'` when
  `deposit_paid` has moved by the time the lock is held. It writes an ABSOLUTE figure, so two quick taps on the
  bank page (£300, then £200 worked out from the same load) stored £200. Every client caller sends it: the
  Record dialog, the Payments sheet and the bank page through `pmAddPayment` (which re-reads and adds once on
  'stale'), Undo with the figure it recorded, and the day sheet's capture from the snapshot's `paid`. A caller
  that sends none is served as before, because writes queued by an older page carry none.
- **Hand-recorded money is dated on its own ledger row.** Add writes a manual row for its rental part (set_payment's
  rule; never for a card), and set_payment first gives money with no row (from before migration-129, or recorded
  with the booking) a row on its OLD `payment_date`, before moving that date. A March deposit used to move into
  October's tax year with the next payment. Money recorded as a card is left to its own card row.
- **A refund comes off on the day it went back** (`allocate_income_by_year/day` take the refunds): what arrived is
  allocated to the days it arrived, and each refund is negative on its own day. A refund in May used to restate a
  closed March year. A stay refunded in full within one year is still not listed; refunded in a later year, it is
  +£X in the first and −£X in the second.
- **A cancelled stay keeps its cottage**: accounts.php's cancelled-stay rows read the ledger's `prop_key` and run
  day by day. They had no cottage, so their money fell to the account holder. Refunds beyond what the ledger shows
  came in (old cash money) still report nothing.
- **The split counts what the books count**: a host's cancelled stays (less their card fees; a full refund leaves
  only the fee), kept deposits (accounts' `kept_by_booking`, lib mode only) on their booking's line, refunds on
  their days, archived cottages in the holder's figures (`split_cottage_list(true)`; nobody is offered one to
  host), and the fees of cancelled stays (a LEFT JOIN on the ledger's `prop_key`).
- **A link's Undo puts back only what that link sorted**: `link` returns the `ids`, `unlink` honours them, so a
  payment sorted to the host by hand before the name was linked stays theirs. An unlink from Settings (no ids)
  still puts back every payment to that name.
- **`record_square_payment` dates its ledger row when Square took the money** (`square_taken_at`: the UK day of
  Square's UTC time), not the day the owner recovered it.
- **Statements**: when several payments share the last moment (no time column, or the same second), the closing
  balance is the one no other payment follows by the balances, else by the file's own order. It used to take the
  last row of the file, which in a newest-first file is the OPENING balance. A pot named after a host is the
  owner's money moving, not a payment to the host.
- **The Money list shows each pound once** (`pmJoin`): bank payments linked to a booking are matched booking by
  booking, one to one within four days, then the rest nearest in date within a month. £500 recorded once and
  banked as £300 + £200 is one row (it showed £950 as three rows), and a payment recorded a week after it reached
  the bank still joins it. The row shows the bank's total when larger.
- **The bank's suggestions**: "the same money" only at a recorded figure (a hand-recorded payment of that amount,
  or the booking's whole figure; nearness alone offered a second payment as the first); "cash paid in" never with
  a booking reference, and "paid in" only as whole words ("Balance paid in full CHB-000007" and "UNPAID INVOICE"
  both read as cash); money out to a guest the books already refunded is offered as that refund, not a cost; and
  sorting a line as an expense bumps the op id, so sorting it again after an Undo makes a new expense.
- Gates: test-integration **§59** (16 server fixes break-tested one at a time), test-statements (the closing
  balance three ways, the pot), test-payrail (`square_taken_at` and its wiring), ui-test-statements (the join, the
  suggestions, the stale retry, both Undos; 9 client fixes break-tested).
- NOT changed: a statement with no transaction ids keys a line by a fingerprint and its count within that file, so
  identical payments split across two overlapping exports could still be miscounted. Monzo's exports carry ids;
  this only reaches other banks' CSVs, and it was not reproduced. And a host's share is charged the whole card fee
  of a charge that carried a refundable deposit, though Square credits back the deposit's share of it when the
  deposit is returned (about £1.30 on £75); the books count the whole fee too, so the two still agree.

## Automatic collection: finished plans, Square's silences, two passes at once (round 5)

Found by the scheduled-jobs review and each reproduced against the real collector code.
- **A finished plan never leaves the due query by itself**: its date stays past and a success resets the try
  count. The run took the oldest 21 and tried 20, so once twenty finished plans existed the plan due today was
  always the one cut, and being armed it was never chased either. `autopay_due_sql(true)` leaves out plans
  already collected for their date (`autopay_collected_for`), and `autopay_run` judges every candidate with
  `autopay_try_due` BEFORE the cap, so only a plan it would try takes a place. The cap is a warning now.
  test-integration **§60** runs the query's own text on the real schema (the unit harness accepts any SQL, and a
  broken clause would fall back to the old query in silence).
- **No answer from Square is not a decline** (`autopay_outcome_unknown`: status 0, a 5xx, or GATEWAY_TIMEOUT /
  INTERNAL_SERVER_ERROR / SERVICE_UNAVAILABLE / TEMPORARY_ERROR). It was read as a hard decline: the plan
  stopped, the guest was emailed that nothing had been taken, and payments-due chased the full balance in the
  same run. Now the same request is sent once more at once; still unknown, the try is dated and marked
  `autopay_last_code = 'UNKNOWN'`, no attempt is counted (the plan stays armed, so nothing chases it), the guest
  hears nothing, and the owner gets an urgent alert to check Square. The next pass asks Square first
  (`autopay_find_taken`: a COMPLETED payment with the booking's reference that is not on our ledger) and records
  it rather than charging; Square unreachable or a different sum leaves it for the owner.
- **The idempotency key is the booking, the date the collection is FOR, the sum and the attempt**, not today's
  date, so the repeat of an unanswered try collapses at Square while a recorded decline moves the attempt on.
- **Two passes at once** (the manual cron URL during the nightly run): the second read the row before the
  first wrote, waited for the lock, and found a monthly plan still armed for its next instalment, so it charged
  again; Square replayed the payment and the instalment was counted twice. `autopay_try_due` is re-asked under
  the lock, and `autopay_record_success` ignores a payment already on the ledger.
- **An uncertain advance notice is stamped** (the house rule: no layer retries a `sent_uncertain` send); it was
  sent again on each of the three days before the charge.
- **A `?hold=` link only works where a hold was requested** (`hold_requested_at`). The same token opens `?pay=`,
  so any guest could swap links, place an authorisation that lapses in a week, and pay the rental with the
  refundable deposit never taken. `pay.php` also refuses `charge` in hold mode.
- **The refund poller's guard is in the write**: it tested the row it had selected, which was never decided, so
  a refund the webhook or the owner settled during the Square call could be written back to PENDING.
- Gates: test-autopay (sections 20–22: unknown outcomes, the lookup, the same key, the cap, the overlap, the
  replayed payment, the uncertain notice), test-payrail (the hold link, the charge refusal, the poller guard),
  integration §60. Twelve fixes break-tested one at a time, and §60 against a broken clause.

## The calendar sync can't lose a booking (round 5)

Found by the calendar-sync review; four of the nine could lead to a double booking. Each was reproduced first.
- **SAVING ONE LINK NEVER DROPS ANOTHER.** `save_feeds` replaced the whole list from the page's copy (often
  stale: a second device, or a link added on the detail page since the list loaded) and deleted every block whose
  source was missing from it, so linking Booking.com could silently unlink Vrbo and free all its stays. It now
  adds or replaces only the links it is sent, under `content_locked`, and `unlink_feed` is the one way to remove a
  platform (its link and its blocks, never `owner`, logged `ical.unlink`). The client sends only that link
  (`calLinkSave`) or only the boxes that changed (`saveSyncFeeds`, against each box's `defaultValue`), offers
  "Link a platform" only once the overview has answered (`calSources` null = unknown), and clears `__calOv` after
  a save on the detail page.
- **THE ECHO OF OUR BOOKING IS JUDGED ON ITS OWN COTTAGE.** `clash_message` skips a block exactly at the edited
  booking's stored dates (our export re-imported). It never checked the cottage, so moving a booking onto another
  cottage's Airbnb stay at the same dates saved with no question.
- **A PROVEN PLATFORM GUEST IS NEVER THE ECHO** (`ical_block_is_reservation` in ical-lib.php, JS twin
  `blockIsReservation`): kind `booking` with any label but `Booked`, which is our export's own title and what a
  feed that passes titles through hands back. The clash check asks first, the nightly conflict audit reports it as
  a double booking ("overlaps an Airbnb stay"), and the timeline keeps the bar whole, drawn over ours in red
  (`tl-clash`, `clashWith`) instead of subtracting it.
- **A FEED IS READ IN FULL OR NOT USED** (`ical_parse_feed`: events, skipped, unreadable). Property names are
  case-insensitive, `DURATION` is read, a date with no end is the RFC's one day, a zero-length event still blocks
  its night, a TZID PHP knows converts to London, dashed dates read, an alarm's DESCRIPTION no longer overwrites
  the event's, `STATUS:CANCELLED` is skipped (its nights are free), and a repeating event (`RRULE`/`RDATE`), an
  end before its start, a nonexistent date or an event the line reader never saw (counted from the raw
  `BEGIN:VEVENT` markers) is UNREADABLE. The sync refuses to rebuild while anything is unreadable ("couldn't read N
  events — nothing was changed") and keeps the old blocks; a body without `END:VCALENDAR` is not usable.
  Simulated end to end before the fix, a DURATION feed turned two Airbnb blocks into none and told the waitlist
  the nights were free. `TRANSP:TRANSPARENT` still blocks, deliberately (an over-blocked night costs less).
  `ical_split_line` is regex, not a character loop (the CI JIT rule).
- **Booking.com's "CLOSED - Not available" is `unknown`** (a stay): Booking.com titles every unavailable period
  that way, its guests included, so they had dropped out of changeovers, the day sheet and the key-safe rotation.
  Stored rows re-classify on the next sync (the block signature includes `kind`).
- **The waitlist checks the guest's OWN dates** (from tomorrow, the earliest online check-in), not just the freed
  range: a three-night cancellation inside a week someone waits for no longer tells them the week opened, an
  entry whose dates have passed is not told about them, and one that has started is told about what is left.
- **The fetch** (`fetch_url`, `ical_url_resolve`): every hop is resolved, checked and the connection PINNED to that
  address with `CURLOPT_RESOLVE` (DNS rebinding); more ranges are refused (`ICAL_DENY_CIDRS`: carrier-grade NAT,
  the benchmark range, NAT64/6to4/Teredo, multicast); the body is capped at `ICAL_MAX_BYTES` (5 MB) as it arrives;
  the unchecked `file_get_contents` fallback is gone (cURL is already required by square_api and cron).
- **A failing feed alerts by TIME** (`ical_feed_alert`, stamps `fail_since` / `alerted_at` in `ical-status-<k>`):
  once it has failed for six hours, then weekly. It counted sync runs, which happen on every device every few
  minutes, so one broken link sent several urgent pushes a day through quiet hours. Decided and stored under
  `content_locked`, so two syncs finishing together alert once.
- Smaller: freeing a block a booking partly covers frees only the piece on screen (`tlBlockTap` sends the piece
  whenever it has one; the server's delete + re-insert is one transaction); `availability.php?prop=` answers a
  removed cottage with no ranges, as `?all=1` already did; the clash wording names what blocks the dates
  (`ical_block_phrase`: "an Airbnb stay", "your own block", never "a Owner booking"); `dates_clash` and
  `clash_message` read only a missing table as free and throw on any other database error.
- Gates: test-ical (sections 7–10), test-waitlist (section 7), test-integration **§61** (the merge, the unlink, the
  move, the echo both ways, the audit, the removed cottage), smoke-test 12c (the timeline), ui-test-manage (§3b/§3c
  re-aimed to one link per save and `unlink_feed`) and ui-test-workspace 5d. Thirty fixes break-tested one at a time.

## Who is who: a typed email is not proof (round 5)

Found by the guest-endpoint and scheduled-jobs reviews; each was reproduced first.
- **AN EMAIL TYPED INTO THE WEBSITE CHAT IS NOT THE GUEST.** The Inbox joined chat threads to bookings by email,
  so anyone could open the site chat with a booked guest's address and land inside that guest's conversation,
  their stay and "Reply now" beside it, and the owner's reply (a door code) went to the impostor's widget.
  messages.php now sends **`verified`** per thread (`chat_thread_verified`: a signed-in account whose email is
  PROVEN), and the `thread` action returns bookings only for a verified thread. In `ibBuild` an unverified thread
  is its own person (`t:<id>`) until the owner links THAT thread (`links['t:<id>']`, accepted by `ibStateClean`);
  if its email belongs to a guest it is an `unlinked` row with `claimed: true`, "email not confirmed" on its line
  and a card saying anyone can type an email there. Linking an unconfirmed chat stores the thread, never the
  address, so a later chat typing the same email asks again. The floating thread sheet says "email not
  confirmed" too. A `verified` that is absent (an older server) keeps the old joining.
- **A SQUATTER'S PHONE STOPS GETTING THE GUEST'S ALERTS.** `guest_id_for_email` (every guest push: the booking
  confirmation with cottage and dates, payment figures) matches only a proven account, and push `subscribe` needs
  one. When the real guest proves the address from another browser, `guest_prove_address` also deletes the
  claim's push subscriptions and its photo, and unlinks its chat thread (which then reads as unconfirmed).
- **RESET LINKS COUNT AGAINST THE DAY'S SIGN-IN EMAILS** (`signin_mail_allowed`, owner and self alike: 429
  `paused`), and a guest may send one to themselves only from a proven account. An unproven account could mail a
  stranger a link a minute.
- **A PAUSED ADDRESS STILL GETS IN.** Ten wrong codes in a day pause codes for an address, which let anyone lock
  a guest out of their stay (and its door code) for the day. Asking for a code while paused now emails a guest
  account a sign-in LINK (it cannot be guessed), counted like any sign-in email; the answer is the same for every
  address (`CODE_PAUSED_LINK`).
- **GUEST PHOTOS HAD BEEN FAILING ENTIRELY.** photos.php called `get_rate()` without requiring pricing.php, so
  every guest upload ended in "Something went wrong on our side". Nothing could see it: PHPStan reads every file
  as one set, `php -l` never resolves a call, and no suite uploaded a photo. **`test-requires.php`** (CI-wired,
  deploy-excluded) follows the code each request can run (every loaded file's top level, then every app function
  it reaches) and fails on a call to an app function defined only in a file that request never loads. It reads
  requires statically and counts conditional ones as loaded, so it can miss a require that never runs but does
  not cry wolf about one that does. Break-tested on photos.php and invoice.php.
- **GUEST UPLOADS LOSE THEIR METADATA IN EVERY FORMAT.** Only JPEG was stripped (and only with the exif
  extension); a PNG, WebP or GIF reached the public photo wall byte for byte. A guest's upload (photo wall, chat
  photo, suggestion picture) is re-encoded through GD in every format and refused when it can't be; a JPEG
  without exif is re-encoded anyway (orientation then can't be read). The owner's own PNG/WebP/GIF stay as
  uploaded.
- **`testcentre-guest` is internal** (the staging test guest, holding the owner's email), and test-content-keys
  now also scans literal keys written through `->execute(['key', …])`, which is how it slipped past.
- **THE HANDLED-MAIL LIST FOLLOWS THE INBOX** (`mailbox_handled_keep`): it was cut to the last 2,000 ids while
  nothing deletes mail, so past 2,000 messages every poll re-handled the newest unknown ones (an old emailed reply
  posted to a guest's chat again). Ids are kept while the listing shows them, pruned only from a listing read in
  full.
- **An uncertain send keeps its claim** in pre-arrival (arrival, thank-you, review ask), the enquiry nudge and the
  anniversary nudge, as payments-due always did: released, the next run sent the guest the same email again.
- **Scheduled jobs** (`jobs-lib.php`, gated by **`test-jobs.php`**): the weekly digest, the weekly analytics and
  the off-site backup run on their day or the first run after it (`weekly_due`; a Monday with no cron run meant
  no backup that week), one at a time (`GET_LOCK`, re-checked inside it), and cron.php judges a job by
  `cron_result_ok` — a failed migration or an `{ok:false, error}` is a failure that reaches Needs attention, while
  `ok:false` with nothing to do (the mailbox off) is not. The collector says why it could not run.
  `watchers-run.php` runs once at a time and saves under `content_locked` against the list as it is then.
- Gates: test-integration **§62** (the flag and the withheld bookings, the push lookup and subscribe, the reset
  rule and allowance, the paused link, the squatter's phone, photo and chat, the PNG, the content key),
  **ui-test-inbox §10** (its own row, the warning, linking the thread, asking again, a proven chat still
  joining), test-jobs, test-requires, test-reply (the handled list), test-content-keys. Break-tested one fix at a
  time. admin.js budget +600 bytes gz: the unconfirmed-chat handling and its warning card (owner-only, cached).
- **Not done, said plainly**: register and enquiry answers still reveal whether an account or a booking exists
  (`guest_register` 409 / `verify`, `account_exists`); fixing it changes the sign-up flow. And `script-src` still
  allows the whole of jsDelivr and cdnjs.

## A refresh does the work once (round 5, performance)

Found by the client-performance review and measured in a vm harness: app.js + admin.js against a seeded business with
3 cottages, 3 years of history, 662 bookings and 120 platform stays. Every change was first checked for byte-identical
output there: the duty list, the timeline's HTML, the bookings list, the Needs-you strip, the ops line and sentence,
the Inbox's people, every booking's chase decision and every search result for nine queries typed letter by letter.
One Today refresh went from 214 ms to 67 ms of JavaScript. A search keystroke went from 39 ms to 14 ms on average
(118 → 50 ms worst).
- **THE CLOCK IS READ ONCE A MINUTE** (`ukNowParts`). `formatToParts` costs ~10 µs and the per-booking checks
  (`hasCheckedOut`, the balance window, the chase) asked for it about 40,000 times in one desktop refresh. The
  reading is kept for its epoch minute, which is the London wall-clock minute because London's offset is whole
  hours. It follows `chbNow` (the server skew, a pinned test clock), and every caller gets its own copy. Gated by
  smoke-test 12d-ii: at most one format per minute, a mutated copy leaks nowhere, the next minute reads afresh.
- **ONE DUTY LIST PER RENDER.** `renderNeedsYou` is a wrapper that opens a scope (`__nyScope`) for one render of
  `renderNeedsYouOnce`. Inside it, `chbDuties()` (the strip, `chbFrameSync`'s rail, `refreshInboxBadge`'s dock
  count) shares the first answer. It is deliberately NOT a whole-task memo: a swipe-dismiss stores and re-renders
  in the same task, and would read the stale list. Gated by search-test §46 (one computation per render, afresh
  after); a scope left open fails §40's dismissal checks by name. NB the body keeps a name containing
  `renderNeedsYou` because test-webpush measures a 700-character window from that name to `setAppBadgeCount`.
- **The duty loop asks the cheap date questions first**: the register window as two ISO dates before any parsing
  or clock read, `chbChaseInfo`'s own 14-day cutoff before `bookingDue`, and the deposit's checked-out test before
  `damageHeld`. `chbDayTuples` skips stays that ended before today (`chbOpsParts` reads nothing earlier).
- **The timeline marks nights only inside the window it draws**, and a cell finds its booking in a map built in
  the same loop. `findBookingById` used to scan every list per taken cell: 64% of `renderCalendar`.
- **An Inbox that is not on screen builds its people, its count and its title's pill, not its DOM** (`ibRender`
  returns after `ibBuild`, `ibPill` and `refreshInboxBadge` unless `view-inbox` is active). Every way to show it
  repaints it already (`nav('view-inbox')` → `renderInbox` → `ibSoon`, and `openInbox`). The pill is kept because
  ui-test-needs-you §8 holds it equal to the dock pip. Gated by ui-test-inbox §11.
- **Search**: `chbRankQuery` sums only the query's own dimensions (20–35 of 4,096; the zero terms add nothing, so
  the scores are identical), and `cmdkLev` is remembered per (word, word, cut-off) in a map cleared at 20,000
  entries. `cmdkLevNow` is the computation; search-test §45 holds the two equal for every pair and cut-off.
- **TWO GUEST-VISIBLE DEFECTS, found the same way**:
  - **The homepage headline rose in again every 30 seconds.** The live tick reapplies every `[data-edit-text]`,
    and rewriting the hero's h1 threw away its word spans, so `heroWordsRise` wrapped them afresh and they
    animated in for every visitor, twice a minute. A content override is now written only when it changes what
    shows (`chbTextSquash`: ordinary whitespace collapsed, so the wrapped words compare equal; a no-break space
    still counts, so the separator binding is still written).
  - **Both cottage grids were rebuilt every tick**, dropping keyboard focus on a card and the map hover wired to
    the old cards (it was wired only on navigation). `renderCottageGrid` rebuilds only when the markup changed and
    wires the hover itself (`wireCottageCardHover`, once per card). Price, rating and availability are still
    written by id on every render.
  Gated by **`ui-test-steady.js`**: node identity across real live ticks, focus kept, a new headline / price /
  name still landing, and the hover on rebuilt cards. Each of the three changes was break-tested.
- **A DRAG IS TIMED BY THE FINGER, NOT THE HANDLER** (the composer sheet's drag-to-close, found when PR #1388's CI
  closed the sheet on a short drag). A busy phone hands a slow drag's moves over in one batch, and timed by
  `performance.now()` in the handler they read as a flick of several px per ms. `cmpWireSheet` reads each event's
  own `timeStamp`. Gated by ui-test-composer's batched-events check (synthetic moves with real 30ms/200ms gaps,
  dispatched at once; break-tested by restoring the handler clock), and the suite now waits for the sheet to come
  to rest (`atRest`, `grabAt`) rather than sleeping 700ms. ui-test-guestchat §9 likewise waits for the welcome line.
- **Not done, said plainly**: the document-wide `touchmove` listener stays non-passive. Its comment says iOS Safari
  ignores `touch-action`, so it is what blocks pinch-zoom there, and nothing here can confirm an iPhone still
  blocks it without the listener.
- Budgets: admin.js +900 bytes gz (owner-only, immutable-cached) and app.js +500 as measured. The deploy strips
  app.js's comments, so the shipped growth is +185.

## One device, two people (round 6)

Found by the round-6 XSS, client-lifecycle and data-lifecycle reviews; each was reproduced first (the XSS ones by
running the real renderers on a hostile value).
- **A PHOTO LINK STAYS INSIDE ITS url('…').** The cottage galleries, the home cards, the hero and the host's photo are
  owner-editable links printed into style attributes, and five sinks printed them raw (the hero search results, the
  flexible-date results, the pending-enquiry card): a stored link could close the url() and the attribute and put an
  `<iframe>` over the public cottage pages (CSP's `frame-src https:` lets it load). `escapeHtml` alone does not hold
  one either: the HTML parser turns `&#39;` back into `'` before CSS reads the attribute. And `gbPhotoHtml`'s own
  guard did nothing, because **`encodeURIComponent` leaves `'`, `(` and `)` alone**. `chbCssUrl(u)` (app.js, beside
  `escapeHtml`) percent-encodes what could end the string or the call, and every `url('${…}')` in the three scripts
  reads its link through it (sinks in an attribute: `escapeHtml(chbCssUrl(x))`). The server refuses one at the write
  too: `content_image_key` / `content_image_value_ok` (db.php) in content.php's `set` — an upload path, a bare static
  filename or a clean https link (`site-logo` is the site's NAME, a text key, and is not one). A hand-recorded
  payment's method (free text) is escaped in the ledger row's label. Gated by smoke-test 12j (the encoder, the two
  renderers with a hostile value, a source sweep of all 24 sites, the ledger row) and test-integration §63.
- **A GUEST SIGNING OUT LEAVES NOTHING FOR THE NEXT PERSON.** The enquiry form autofilled from the account and kept
  their name, email, phone and address after sign-out — and its draft saves to the server under the email in it, so
  the next visitor's date pick filed a draft as them. `guestLogout` now runs `resetEnquiryForm()` and empties the
  chat box and its attachment.
- **A LATE ANSWER BELONGS TO WHOEVER ASKED.** A stays request still on its way at sign-out painted that guest's stays,
  pay button and door code for the next guest to sign in (whose own request was never sent: the busy flag was still
  up). `chbGuestWho()` is captured before each guest fetch and compared after (`gaStaysLoad`, `renderGuestBookings`,
  `loadWelcomeBack`, `loadPasskeys`); `gaStaysLoad` also numbers its asks (`__gaStaysAsk`), which `guestLogout` bumps,
  so a stale answer never owns the flag and a changed guest is asked for again.
- **A SESSION THE SERVER ENDED STARTS THE PAGE AGAIN FROM NOTHING.** `forceAdminLogout` (a reset elsewhere, a person
  removed, the boot's provisional entry refused) showed a toast and left the whole back office in memory — the
  decrypted day sheet, the private settings, every booking — for whoever signed in next on that page. It now says so
  in a dialog and reloads once read, `logoutStaff`'s rule; the at-rest key's removal is awaited first, because a
  reload cuts an IndexedDB transaction off. NB a step-up refusal (`reauth_required`) is never sent to the
  stale-session check (`maybeHandleStaleAdmin(code)`): the server accepted the session before refusing the step-up,
  and with the reload a wrong answer there would restart the page in the middle of a refund (ui-test-reauth §1).
- **DELETING AN ACCOUNT NEVER TAKES AN UPCOMING STAY WITH IT.** It anonymised every booking under the address, next
  month's included: the owner was left a "Former guest" with no email or phone, the arrival email and balance chase
  (both need the address) stopped, the guest lost their way back to their own stay and door code, and a card plan
  would still have collected. `guest_delete_account` answers 409 `stay_ahead` with the stay's date while any stay
  has not ended; the client shows the sentence as it is.
- Gates: **`ui-test-handover.js`** (the form and chat box after sign-out, a held stays answer landing after the next
  guest signed in — on You and on the stays page — the forced sign-out's dialog and reload, the deletion refusal) and
  test-integration §64. Fifteen declarations break-tested, each failing its named check; the stale-stays one has two
  independent layers (the ask number, the who-check) and only removing both reproduces the original bug.

## What a change carries with it (round 6, data lifecycle)

Found by the round-6 data-lifecycle review; each was reproduced before it was fixed.
- **A QUEUED EMAIL IS SENT ONLY WHILE IT IS STILL TRUE** (migration-140 `email_outbox.ref`). The send that succeeds
  after an outage is what drains the outbox, so a confirmation queued during the outage landed just after the
  cancellation, or after the corrected one with the new dates. Each queued copy names what it is about:
  `booking:<id>:<hash>` (`email_booking_ref`: dates, cottage, party, price and, since round 7, the payment state and
  plan, read from the same `SELECT *` row the drain re-reads), `enquiry:<id>`, `newsletter:<address>`, `person:<id>`. `email_outbox_wanted($row)` asks before
  sending. A stay moved or cancelled, an enquiry answered, an unsubscribe or a person removed closes the row as
  "no longer current" (`gave_up_at`, an info `email.dropped`, never a give-up warning). Anything it cannot read (no
  ref, an unknown kind, a database hiccup) still sends: delivery is the outbox's job, and only a positive "no
  longer" stops one. The decision is gated in test-integration §65. The senders' half is gated by test-payrail's
  wiring checks, because mail is off in the harness and a failed send never queues there.
- **A CANCELLATION RE-READS THE BOOKING UNDER ITS LOCK.** pay.php holds the same lock to charge. A deposit charged
  while the cancel waited took the cash branch, found no cash deposit, was neither returned nor recorded as owed,
  and then the row that remembered it was deleted. If the re-read finds a deposit to refund that the first read did
  not, it asks for the step-up too. §66 reproduces the interleaving (the §32 technique).
- **A MOVED STAY IS CHASED ON ITS NEW SCHEDULE.** Moving a future stay's check-in clears `balance_requested_at` /
  `balance_reminded_at`, and so does a new plan due date. The ask had stayed tied to the old dates, so a postponed
  stay's first contact was a "reminder" days before arrival.
- **THE GUEST REGISTER FOLLOWS ITS STAY** (`guest_register_follow`). It is re-dated from a new checkout. It is
  deleted with a stay cancelled or deleted before it began, which used to keep a party's passport numbers for a
  year after a stay that never happened. One that had begun keeps it for a year from today. A failure is logged as
  a warning, never thrown: the booking change it follows has already happened.
- **AN EDITED ENQUIRY IS THE SAME ENQUIRY.** The owner's Edit is a decline + resubmit, and the new row lost the
  guest's text-message consent and its age, seen and nudged state: a two-day-old enquiry read as new today and was
  nudged again. The resubmit sends `replaces_id`, and enquiries.php copies those four columns from the row it
  replaces (admin edits only).
- **NOBODY IS REMOVED FROM UNDER THE MONEY SPLIT.** Removing someone who hosts a cottage in the split, or holds
  the account, is refused (people.php 409 `in_split`, saying where to change it). A removed paid-out host used to
  stay in the split, taking their cottage's income out of the holder's profit. Removal also drops the names they
  were paid as.
- **A COTTAGE WITH STAYS STILL TO COME IS NOT REMOVED IN ONE TAP.** rates.php answers 409 `stays_ahead`, with the
  count and the first date, until `confirm_stays` is sent. Archived, a cottage drops out of the key safes, the
  timeline, the platform import and the nightly double-booking audit. `archiveAccommodation` asks with the server's
  sentence and "Remove it anyway".
- **A DELETED ACCOUNT TAKES ITS WHOLE CONVERSATION.** That is every message in its threads (the owner's replies
  carry no guest_id, so they outlived the account and stayed searchable), plus the anonymous threads under its
  email. It also takes the enquiry draft, the direct lead, the owner's emails to them, unsent queued copies and
  sign-in codes. Self-repair prunes sign-in codes older than a day.
- **"DOWNLOAD MY DATA" CARRIES WHAT DELETION TAKES** (`guest_export_data`). The export had the guest's own chat
  lines only, and nothing filed under their address before the account existed. Under the proven-address rule (as
  for the stays) it now carries:
  - the whole conversation, the owner's replies included;
  - a chat started on the website before signing in;
  - the enquiry draft and a review left from a review link;
  - the owner's emails to them, from the Inbox's sent log and from a booking's page;
  - the names of their passkeys.

  Left out on purpose: a chat's token (it opens that chat), the owner's archive flag, and the owner's private
  rating and note on a review-link lead. Deleting the account now also clears the activity log's copies of the
  words: the first line of every chat message, which the Activity log page shows and searches, and a booking
  page's emails in full. A guest's "New chat message from <name>" loses the name. The rows stay as the record.
  **Not done, said plainly**: other audit lines still name the guest ("Emailed guest — <name>"), and every row
  keeps the IP it came from. Gated in test-integration §19b and §70.
- **A DELETED EXPENSE PUTS ITS BANK PAYMENT BACK TO SORT.** This is statements.php's own unmark, the split columns
  included. The payment used to read "Counted, as a cost" for a cost the books no longer held.
- **A removed or private cottage tells its waitlist nothing** (`prop_is_marketable`, as the three nudges already did).
- **An emailed reply to a chat since deleted lands in the Inbox as mail.** It used to become an orphan message,
  emailed to no one and marked handled (mailbox-read `thread-gone`; the mailbox list stops hiding it). Gated by
  test-integration §77 against the fake POP3 server (see "Reply by email, against a mailbox that answers").
- Gates:
  - test-integration §65–§71 and §61's refusal;
  - test-payrail (the four senders' refs) and test-waitlist;
  - ui-test-bookingsheet (the resubmit names what it replaces);
  - new **`ui-test-lifecycle.js`** (the archive confirm, both answers).

  Twenty changes break-tested, each failing its own named check.

## What every visitor's poll and every platform's fetch cost (round 6, server performance)

- **A VISITOR'S CONTENT READ LEAVES THE OPERATIONAL CACHES IN THE DATABASE.** The public content GET runs on every
  visitor's 30-second poll. It read every value in the table and threw the internal ones away, including the payout
  cache, the mailbox's handled list, the opt-out list, the Inbox's record and the retired chat's stored words.
  - **The read is still ONE query.** It leaves out `CONTENT_VISITOR_SKIP` (exact keys) and
    `CONTENT_VISITOR_SKIP_PREFIX` (the private families) by name. The owner's read is unchanged.
  - **A names-first version was built and rejected, measured.** It cost the public bootstrap a ninth statement
    against §24's ratchet of eight.
  - **The memo knows what the read left behind**
    (`content_memo_warm($raw, $skipKeys, $skipPrefixes)`). A later read of a skipped key in the same request (the
    cron watchdog's, straight after the payload) asks for itself rather than reading "not set". Without that, the
    watchdog would have seen its own stamp as missing.
  - **Every listed name must be one the public filter drops anyway**, so the output cannot change. test-integration
    §72 asserts it for each key and prefix. A missing internal key is merely fetched and dropped, as before; a
    public key on the list fails the gate.
- **THE PLATFORMS' CALENDAR FEED CARRIES WHAT IS AHEAD, AND ANSWERS 304 WHEN NOTHING CHANGED** (`ical-export.php`).
  - Each platform polls it many times a day. It carried every stay since the first, so it now leaves out stays
    and owner blocks that ended more than 30 days ago; a platform only blocks what is ahead.
  - A fresh `DTSTAMP` every second made each answer new. The ETag is now taken over the body with the DTSTAMP
    lines removed, and compared with `shell_etag_matches`, the deflate-tolerant comparison from the shell routes.
  - §73 asserts the window, a 304 a second later, the `-gzip` form, a new tag after a change, and that a wrong
    token is still refused.
- **The site's deposit percentage is read once a request** (`square_deposit_pct`, a static). The back office's
  booking list asked for it for every booking with a plan, two round trips each. A database that does not answer
  is asked again, so one failure is not cached.
- Gates: test-integration §72 and §73, and §24's statement count, still 8. Six changes break-tested, each failing
  its own named check: the visitor query, the memo, the list check, the window, the DTSTAMP-free tag and the
  deflate-tolerant comparison.
- **A guest's chat poll asks the mailbox throttle of the row's own timestamp** (`mailbox_poll_recent`), before it
  reads the state that holds the inbox's whole handled list. `mailbox_poll_save` writes the row's `updated_at` every
  time, and the age is worked out on the database's own clock (`TIMESTAMPDIFF` against `CURRENT_TIMESTAMP`), so a
  recent poll answers with one small query. Only a clear "saved in the last 25 seconds" stops the poll: no row, an
  error, or the autumn hour the clock goes back fall through to the state's own stamp, as before. test-integration
  §74 drives the real poll in the app copy with the mailbox switched on and no host to reach; removing the cheap
  check fails it.

## Answers that land late, and changes that meet (round 6)

Found by the round-6 lifecycle reviews. The back office reuses one node for many records (the email sheet, the
booking page's guest-book card) and saves several settings as one whole object; on the server, several requests
can change the Monzo link at once. All of it goes wrong only when a request is slow or two changes overlap, which is
why nothing caught it.
- **A SHARED SHEET OR CARD CHECKS WHOSE IT IS BEFORE A LATE ANSWER TOUCHES IT.**
  - The arrival review's failure path cleared the email sheet's message box even after the owner had opened
    another guest's email in it. The success path already checked `__composeTarget`; the catch did not.
  - The guest book's save and remove repainted `#gb-card-host`, whichever booking's page held it when the answer
    landed, and cleared the half-written rating, whoever's it was. `gbHost` now paints only onto its own booking's
    page, compared as bookings because the page may have been opened by either id form. Only that booking's
    draft is cleared.
- **AN EDIT TO A WHOLE-OBJECT SETTING IS MADE TO THE OBJECT AS THE LAST SAVE LEFT IT.** Three settings are saved
  whole: the chat's answers (`chat-chips`), the alert preferences and the "in my bank" marks. Each edit copied an
  object whose mirror updates only once a save lands, so two quick edits copied the same object and the second
  save wiped out the first.
  - `gcChipsEdit(change)`, `saveNotifyPrefs` and `pmLandedEdit(change)` queue their saves and read the latest
    object at their turn.
  - `gcSave` also queues per key, so two saves of one switch cannot land in the wrong order.
  - A refused value still never reaches a mirror.
- **AN UNDO PUTS BACK ONLY WHAT ITS OWN TAP CHANGED** (`pmLanded`). Restoring the whole earlier map also undid
  every mark made after it.
- **AN UNDO THAT FAILED SAYS SO** (`toast`). Most Undos are async, and a rejection went nowhere: the toast left
  and the owner believed it undone.
- **A FAILED READ KEEPS THE LAST ANSWER, NEVER ZERO OR EMPTY.**
  - The approvals count: zero claimed nothing was waiting, and the badge and the Needs-you row went with it.
  - A stay's money history on Payments: an empty list said the stay had no payments. With nothing kept, it now
    says it couldn't read it, and an explicit reopen asks again. A retry from the render would loop while
    offline.
- **A REPAINT OF THE BOOKING PAGE KEEPS ITS ACTIVITY** (`__hubBundle`, `hubBundlePaint`). `renderBookingHub`
  rebuilt the Activity card as "Loading…" after a plan change, a reminder or a re-dock, and only opening the
  booking fetched it.
- **A HOST WHOSE SPLIT DID NOT LOAD IS SHOWN NONE OF THE BUSINESS'S MONEY** (`pmSplitUnsure`). A failed answer
  fell through to the whole business: every cottage's guests, the bank and the books, and a title pill reading
  "1 overdue" about another host's guest. Now:
  - the list says it couldn't check and offers a retry;
  - the pill claims nothing;
  - the side pane stays empty.
  
  Full access sees the business, which is theirs to see.
- **AN EMAIL SENT AGAIN AFTER ITS ANSWER WAS LOST GOES ONCE.** The composer's and the Inbox's email sends carry a
  retry id, computed over what the email says (each file by name and size). bookings.php and enquiries.php
  `email_guest` and mailbox.php `send` answer a retry from the op ledger. A deliberate resend after one has gone
  is a new send (`chbOpBump`). This is not queueing: the manual composer still never queues.
- **AN ARRIVAL EMAIL IS RE-SENT WHEN WHAT IT STATES CHANGES.** `update` cleared `pre_arrival_sent` for a new
  check-in date or cottage only, while the email also states the leaving date and both times. Those clear it now too.
  A stored time is compared as `clean_time` reads it, so a blank time from an older row is the default, not a change,
  and a notes edit does not re-send.
- **ONE LOCK FOR EVERY CHANGE TO THE MONZO LINK** (`monzo_locked`, the sync's own `chb_monzo_sync`). A disconnect
  made while a refresh or a sync was in flight was undone by its save: the link came back and went on importing
  payments. Two refreshes at once spent one refresh token twice, and the loser told the owner to connect again over
  the winner's good token.
  - The sync, the approval check, connect, disconnect and the callback all take the lock. It is re-entrant, so a
    check inside a sync is one holder.
  - Disconnect and connect wait up to `CHB_MONZO_LOCK_WAIT` (20s), then answer 409 `busy` and change nothing.
  - A check reports the link as it stands, without calling Monzo.
  - The callback asks the owner to reload: nothing is used up before the lock is held.
- Gates:
  - test-integration §20(e) (a new leaving date, a new time, the same time again, a blank stored time) and §54 (a
    disconnect and a check while the lock is held);
  - new **`ui-test-latework.js`** (eleven sections, each holding a request open or dropping it, then doing the
    next thing);
  - test-payrail (the three endpoints' ledger wiring). Mail is off in the integration harness, so a send cannot
    succeed there to be replayed.

  Twenty-three changes break-tested, each failing its own named check.

## Uploaded files: private until shown, deleted with what shows them (round 7)

Found by the round-7 uploads review; each was reproduced before it was fixed.
- **A CHAT PHOTO IS STAGED, NOT PUBLISHED.** Anyone with a made-up 16-character chat token could upload an image that
  no conversation showed and nobody could delete, kept on the site's own address and cached publicly for 30 days. The
  limit was per exact address, which an IPv6 phone renews every few minutes.
  - Every upload is now prepared in `uploads/pending/` (`upload_pending_dir`, deny-all, created on demand).
  - A chat photo stays there until a message carries it: `chat_valid_attachment` publishes it (`upload_publish`). A
    send retried after a lost answer finds it already published.
  - The client previews the photo from the device (a blob URL), since the server's copy is private until sent.
  - Self-repair empties the staging folder after two days and deletes a public `chat-<12 hex>` file no message
    carries after one. That sweep only runs when the messages table was read.
- **NOTHING IS PUBLIC UNTIL IT IS CLEAN.** `save_uploaded_image` moved the original into `uploads/` before stripping
  its metadata, so a request that died mid re-encode left the photo, GPS and all, in public. It is cleaned in the
  staging folder and renamed into `uploads/` only on success; a shutdown function removes what a dying request left.
  A guest's image is also brought down to 2000px on its long side (`image_fit_within`): a 40-megapixel phone photo
  was kept whole at 27MB.
- **ONE WAY TO DELETE AN UPLOAD** (`upload_delete`): the file, its WebP companion and every size img.php cached,
  rebuilt from the basename. Used by:
  - **Delete conversation** (the chat's photos);
  - **account deletion** (their chat photos; photos never approved, row and file; suggestions never published,
    picture and all; a published card keeps no name or address; their stashed notification text);
  - **rejecting a guest photo** (rejected rows are hidden, so the owner had no way to remove the file; approving one
    whose file has gone answers 409);
  - **rejecting or deleting a suggestion** (`experience_image_drop`, only a guest's `experience-` upload, and only
    when no other card shows it).
- **A /64 IS ONE ADDRESS TO A LIMIT** (`client_ip_key`): `rate_limit`, `rate_allow`, `rate_limit_key` and the sign-in
  throttles count IPv6 by its /64; IPv4 (and IPv4 written as IPv6) as it is. The activity log keeps the full address.
- Gates: test-integration **§75** (staging, cleaning, the size cap, publishing, a retried send, every deletion, the
  two sweeps, the /64 limiter), fourteen changes break-tested, each failing its own named check.
- **Not done, said plainly**: chat photos and wall photos are still served from `uploads/` to anyone with the address
  (only a profile photo goes through a login check), and the service worker's image cache is not cleared at sign-out.

## What years of data cost the owner's boot (round 7, server performance)

Measured by the round-7 data-volume review on a five-year business (1,387 bookings, 3,218 payments, 40,000 activity
rows); each change is gated by a count or a plan, not a timing.
- **ONE READ OF THE LEDGER FOR THE BOOKING LIST** (`booking_ledger_warm` / `booking_ledger_forget`, db.php). Each card
  plan's state asks what its booking still owes, and each asked the payments table on its own: 216 of the boot's 262
  statements. The list reads every figure in one grouped query between warm and forget, and `booking_ledger_net` asks
  the table as before outside that window, so nothing that writes a payment reads a stale figure. The SQL is one
  constant (`BOOKING_LEDGER_NET_SQL`) for both.
- **THE LIST LEAVES ON THE SERVER WHAT THE BACK OFFICE NEVER READS** (`BOOKINGS_ADMIN_OMIT`): thirteen columns no
  client file names, three of them the card-on-file handles Square issued (`autopay_card_id`, `autopay_customer_id`,
  `hold_payment_id`). A register link rides only a stay whose link still opens (guest-details.php closes it a week
  after the stay).
- **THE SERVER'S OWN CACHES NEVER REACH A BROWSER** (`CONTENT_SERVER_ONLY`, content.php): the mailbox's handled list
  (149KB), the payout cache, the opt-out list, the guests' stashed notifications and the retired chat's rows were in
  the owner's content payload and `get_all`. Both leave them out; the memo is told, so the server still reads them
  later in the request. A visitor's read also skips `guest-ping-` and `anniv-sent` now. NB this re-aimed §72's owner
  check: the owner's read is no longer "the whole table".
- **A guest's notification text is deleted after a day** (self-repair): it waits five minutes for their phone, and
  the row stayed for good, one per guest ever notified.
- **migration-141**: `bookings (prop_key, check_out, check_in)` for the availability read and the clash check (461
  rows examined for 33), and `enquiries (declined_at, created_at)` for the owner's enquiry list.
- **Analytics stopped working out `visitorMix`**, which nothing has read since the "returning" figure was removed:
  a grouping of every page view kept.
- **The daily orphan-upload scan** looks each file up in a set of the names the content holds, keeping the substring
  search only as the fallback.
- **A BADGE'S COUNT IS A COUNT** (`list_admin` with `count: 'pending'` in reviews.php, photos.php and
  experiences.php; `refreshModerationCounts`). Today and Manage downloaded every review, photo and suggestion there has
  ever been to count the ones waiting. The count is the list's own rule (a review whose guest has gone is in neither),
  so the badge and the list cannot disagree, and an older server that ignores the flag still answers with rows, which
  the client counts as before. Gated by test-integration **§78**, break-tested both ways (the count branch removed, the
  guest join removed).
- Gates: test-integration **§76** (ten more card plans cost no more statements on the probe's own connection, the
  same states booking by booking, the omitted columns and that no client file names them, the register links, both
  content outputs, the ping prune, the two plans, the analytics field) and §72 re-aimed.
- **Not done, said plainly** (the rest of that review): every approved review still rides the visitor's boot, the chat
  thread list is unbounded and fetched on Today only to count, the email log has hit its 3,000-row cap, the money reports read the whole ledger, and search scans each table with
  `LIKE '%q%'`. Each needs a client change with the server one.

## Reply by email, against a mailbox that answers (round 7)

The poll had only ever met a mailbox it could not reach (§74), so reply-by-email was gated piece by piece in
test-reply and never end to end. **`test-pop3-server.php`** (deploy-excluded like every test-*.php) serves a folder of
.eml files over TLS with a certificate it makes for the run: USER/PASS, STAT, LIST, UIDL, TOP, RETR, DELE, RSET, QUIT
(a QUIT removes what DELE marked), every command logged. `pop3_open` takes its port from `MAIL_POP_PORT` (995 by
default, as `SMTP_PORT` does for sending), which only the harness's config sets. What driving it found:
- **ONE TOKEN READER, AND IT READS THE WHOLE TOKEN** (`msg_reply_token_in`, db.php). The poll and the webhook each took
  the first 16 hex of a token now 32 long, so a current token verified as the old short form: every reply would have
  stopped routing the day the short form is retired, and a token with a forged second half was accepted. And the first
  token-shaped string in a field won even when it did not verify, hiding a real token later in References. Every
  candidate is read at full length now and the first that verifies wins; a 16-hex token from an email sent before the
  widening still routes.
- **THE WEBHOOK TAKES A GUEST'S OWN REPLY** (inbound-mail.php, the route when `REPLY_INBOX` is set). It verified owner
  tokens only, so a guest replying to the email that told them to "just reply" was answered "no thread" and their
  words went nowhere. A guest token from the thread's own guest lands as theirs, as it does by the POP3 route; only an
  OWNER token posts as the owner. A reply to a chat since deleted is refused ("thread gone"), never an orphan message.
- **THE INBOX SETS ASIDE AN OWNER'S ROUTED REPLY FROM ANY OF THEIR ADDRESSES** (mailbox.php `list`). Only the site's
  own address was covered, and the usual reply comes from the owner's own inbox, where the alert went: their reply sat
  in the Inbox as a person waiting. The rule is now the poll's (an owner token, a sender on the allow-list, a chat that
  still exists).
- Gates: test-integration **§77** (eleven emails through the real poll: the owner's reply decoded and credited to
  them, a guest's Windows-1252 reply, the owner's address on a guest's token, our own alert, the owner typing from the
  business address, the old token, the deleted chat, the forged half, the decoy; what is recorded as new mail; each
  read once and never again; nothing deleted; the Inbox's list, read and delete over HTTP; the handled list following
  a deletion; five webhook cases) and test-reply's token-reader checks. Twelve changes break-tested, each failing its
  own named check.
- **Not done, said plainly**: a guest's emailed reply still shows in their conversation twice, once as chat and once
  as mail. Setting it aside in the list would also hide one the poll leaves as mail (a reply that is only quoted
  text), so it was left.

## A page left open all day (round 7)

Measured by the round-7 long-session review: over twenty rounds of every owner screen and every guest step, timers,
listeners, observers and the DOM stayed flat, and twenty offline/online flips left nothing behind. What goes wrong is
what happens on a page that has been open a while, when a release lands or an answer is slow:
- **A NEW BUILD WAITS FOR THE OWNER TO FINISH** (`reloadWhenIdle`, `chbMidTask`). The version watch reloaded 1.2s after
  noticing a release, on the owner's return to the tab: the screen comes back (`captureAdminState`) but not an open
  form, so a half-typed Add booking was lost. While a window, sheet or dialog is open or a field has focus, it asks
  again every five seconds. The service worker's `chb-reload` takes the same path.
- **A LATE ANSWER PAINTS ONLY WHAT IT WAS ASKED FOR.** The Calendar sync page (`loadCalendarSyncProp`) painted one
  cottage's links and controls under another's name, so a link pasted there saved onto the wrong cottage and freed its
  stays; a cottage page showed another cottage's guest photos (`renderGuestPhotos`, `activeFrontProperty`, the
  availability rule); the welcome book showed another cottage's Wi-Fi (`__wbAsk`: each opening numbered, closing
  counts).
- **AN OVERVIEW ANSWER THAT SAYS NOTHING IS NOT ASKED AGAIN AT ONCE.** A reply without its props left the overview
  unknown, the repaint asked again, and the page fetched it about fifty times a second, on any screen, until a reload.
  It waits `CAL_OV_RETRY_MS` (15s) now, and a save's own refetch goes through `calOvForget()`. `calRepaint` also asks
  whether the list is painted (`getClientRects`): belt and braces, since with the wait in place nothing loops, and the
  gate measures the wait. NB a suite that wants the overview asked for again calls `calOvForget()` as the app does:
  ui-test-manage §3b set `__calOv = null` by hand and then waited the 15s out, failing eight checks.
- **THE REVIEW ROTATION READS THE REVIEWS AS THEY ARE NOW** (`__gwList`, `gwShow`). The interval kept the first render's
  list, so a withdrawn review went on showing on a page left open.
- **ONE FOCUS TIMER PER PAYMENTS SHEET, AND IT NEVER TAKES A FIELD THE OWNER IS IN** (`pmSheet`). Each redraw set its own
  and none was cleared, so a save (a busy redraw, then the answer's) left one to fire mid-typing: the cursor jumped to
  the first field and the secret went into the client ID. Found from a CI failure of ui-test-statements that passed
  three times out of three locally.
- Gates: **`ui-test-longsession.js`** (§1–§7, each holding an answer back or shipping a build mid-task), seven changes
  break-tested, each failing its own named check.
- **Not verified**: Google Pay instances are created afresh on each wallet re-price without `destroy()`; Square's SDK
  cannot load here, so any growth is unproven.

## The guest's own journey, driven end to end (round 7)

Found by the round-7 guest-journey audit on a full stack (MariaDB in strict mode, `php -S`, a fake Square, Chromium);
each was reproduced before it was fixed.
- **A CARD PAYMENT AFTER THE FIRST FAILED AFTER SQUARE HAD TAKEN THE MONEY.** pay.php and the webhook wrote
  `payment_date = COALESCE(NULLIF(payment_date, ''), ?)`, and on a strict-mode database comparing a set DATE with
  `''` is an error. So every balance, "pay the rest" and part payment: Square charged, the ledger row landed, and the
  booking stayed "deposit" with no receipt and no owner alert, while the guest read "Something went wrong" and My
  stays still asked for the money. Both are `COALESCE(payment_date, ?)` now (record_square_payment's form).
  **test-payrail ratchets the shape**: no PHP may compare a date column with `''`, the columns read from schema.sql
  and the migrations (78), so a new one is covered the day it is added. Gated by integration **§79**: the webhook's
  real route on a dated booking, and pay.php's own SQL text run against the real schema (Square is off there).
- **A RELOAD BROUGHT THE GUEST'S PAGES BACK BLANK** (`chbOpenTarget`): You, My stays and the pay screen were restored
  with a bare `nav()`, which draws none of them, and the app reloads itself when a build ships. They open through
  their own openers now; the pay screen (its token lives in memory) comes back as My stays, where Pay is. Gated by
  ui-test-resume §6, which holds the stays request open for the You case and gives the guest an `avatar`: either a
  landing stays answer or `guestAvatarEnsure` redraws You by itself, and both hid the defect from the first draft.
- **A SAVE ON THE GUEST-DETAILS FORM SHOWED EVERY PASSPORT IN FULL.** The POST swaps an unchanged mask for the stored
  number before validating, and both the save and a refused save rendered it. After any POST a stored number is
  masked again; a refused save keeps what was just typed so it can be fixed. §42.
- **A SINGLE AUTOMATIC COLLECTION IS ONLY OFFERED WHEN ITS NOTICE FITS** (`AUTOPAY_SINGLE_GAP_DAYS`, equal to
  `AUTOPAY_NOTICE_DAYS`): a stay exactly 30 days out put the balance due today, and the collector took it that night
  with no email, against the screen's "we'll email you 3 days before". test-autopay, both sides of the line.
- **A RETRIED ENQUIRY IS THE SAME ENQUIRY**: `submitEnquiry` sends `op_id` (`chbOpFor`, bumped after a send).
  Without it, tapping Send again after a lost answer made a second enquiry with its own emails. ui-test-enquiry §6.
- **THE CHARGE WAITS LONGER THAN THE SERVER CAN TAKE** (`PAY_CHARGE_WAIT_MS` 75s through `apiPost`'s new
  `timeoutMs`, which known-off never shortens): the page gave up at 15s, under pay.php's 30s lock wait plus 20s for
  Square, and said the full amount was still due over a payment recorded two seconds later. ui-test-pay.
- **ONE ROUNDING FOR A PERCENTAGE OF MONEY** (`money_pct` / `chbMoneyPct`: whole pence times whole basis points,
  half up). The enquiry form's `Math.round(total * pct) / 100` quoted a deposit 1p off the charge, and PHP's own
  `round()` answers by version: 8.3 pre-rounds and 8.4 does not (this container runs 8.4, CI and the host 8.3).
  The exact rule equals 8.3's answer on every penny from £50 to £2,000 at seven percentages (1,365,007 cases), so
  no live amount moves. **`deposit-fixtures.json`** is generated from it and looped by test-pricing and smoke-test.
- **THE PICKER KNOWS THE SERVER'S OUTER LIMITS** (`CHB_ENQ_MAX_NIGHTS` 60 and `CHB_ENQ_MAX_AHEAD_DAYS` 730, held
  equal to enquiries.php's by smoke-test, which also checks the sentences word for word): `checkBookingRules`
  refuses both, and the picker puts the 60-night ceiling under any cottage maximum and refuses a check-in past two
  years with its own reason. ui-test-datepicker §23.
- Break-tested: every fix above fails its own named check with the change reverted.
- **AND #1395 SHIPPED A TEST SERVER TO THE HOST.** `test-pop3-server.php` was missing from deploy.yml's strip lists;
  test-emails-render §0 says so, and it was not run locally because #1395 merged on local checks that did not
  include it. Fixed three ways: both strip lists name it, the script refuses anything but the command line (with
  `register_argc_argv` on, a query string becomes `$argv`), and **htaccess denies every `test-*.php`**, which is what
  reaches the copy already on the host, since the deploy never deletes a remote file. A local check before a merge
  without CI is every command ci.yml's checks job runs, not a chosen few.

## Notifications reach the right people, once (round 7)

Found by the round-7 notifications audit on a full stack (MariaDB, `php -S`, a fake SMTP server that can accept,
refuse for now or refuse for good); each was reproduced before it was fixed.
- **A DEVICE'S ALERTS END WITH ITS SIGN-IN** (`push_subs_drop`, db.php). Signing out kept the device's push
  subscription, so a phone nobody was signed in on still showed "New message — Hannah: the key safe code you gave
  me…". Sign-out drops THIS device (the client sends `push_endpoint`, `chbPushEndpoint()`, which never throws and
  gives up after 1.5s), a password change drops every OTHER device of that person (the legacy no-owner rows too, for
  the first owner), a reset link drops them all, and a guest's sign-out and password change do the same for theirs.
  A named endpoint only ever matches the signed-in person's own rows. The next sign-in re-registers an existing
  subscription (`revalidateOwnerPush` always posts `subscribe_admin`). Integration §80(a), ui-test-owneraccount §8.
- **THE ONE-TAP APPROVE LINK IS ONE PERSON'S.** Every copy of the new-enquiry email carried the same Approve link and
  `enquiry-action.php` trusted the link alone, so a Host whose approve switch was off, refused in the app, approved
  from her email: the guest was booked and asked for money. The token now signs the person (`enquiry_action_token($id,
  $action, $personId)`, the link carries `p=`), each copy is composed for its recipient (`owner_enquiry_copy($e,
  $row)`, pure; the sender passes `action_link`), only someone who may approve (`gu.approve`) gets the links, anyone
  else (an extra address included) gets "Open the enquiry", and `enquiry-action.php` asks that person's permission
  again when the link is used (a removed or invited person's link reads as not valid). A link from before this reads
  as not valid too. The one-tap approve and decline are credited to the person (`admin:<id>`). §80(b),
  test-emails-render §17, test-payrail (the route's wiring).
- **REPLYING BY EMAIL FOLLOWS THE APP'S RULES** (`people_mail_senders`): only someone who may reply in the app
  (`gu.reply`), at their sign-in address, plus the extra addresses. A person's address follows that person's
  permission whatever list it is also on, and an address that was a removed person's posts nothing: the config owner
  address used to be let in unconditionally, and it is the first owner's, so a removed first owner could still post
  to a guest as the business. "Also emailed" still RECEIVES what the owner listed there (it is on screen to change);
  removal takes away posting as the business. Before people (rows unreadable) it is what it always was. §80(c),
  through the real webhook.
- **AN EMAIL THAT MUST REACH SOMEONE FALLS BACK TO A CURRENT SUPER USER** (the first owner if they still are one),
  never the config owner address when that is a removed person's: with George removed and nobody choosing enquiries,
  the next enquiry (the guest's phone and address) went to George. With no current Super User at all, nobody. §80(c).
- **THE "NO DEVICE REACHED" EMAIL FOLLOWS EACH PERSON'S SETTINGS** (`alert_fallback_ids`, pure): only someone the
  push was MEANT for now (their areas, mutes and quiet hours, `notify_should_push_for`) and none of whose devices took
  it. A mute or a quiet hour is a choice, not an unreachable phone: the muted owner with a phone in hand got the email
  anyway, and an email at 2am buzzes the phone the push was kept from. And only an alert with NO email of its own asks
  for it: "New enquiry" and "Payment received" already send one to whoever chose it, so the fallback beside them was a
  second copy, or one sent to someone who had switched that email off. A fallback copy that fails waits in the outbox
  like every other owner alert. test-webpush.
- **A REQUEST SENDING SAMPLES NEVER DRAINS REAL MAIL** (`email_outbox_kick`): the samples' `[SAMPLE]`/`[TEST]` prefix
  applies to every subject sent in the request, and the first sample kicked the outbox, so a guest got "[SAMPLE]
  We've got your enquiry". The kick stands down while the prefix or `people_mail_only()` is set. §80(d).
- **A QUEUED CONFIRMATION IS DROPPED ONCE THE MONEY HAS MOVED** (`email_booking_ref` now fingerprints the payment
  state, deposit paid, hold state, refundable deposit and plan): a confirmation queued in an outage went out after the
  fresh "Paid in full" one, still saying "Unpaid · balance of £414.90 due". §65.
- **A RECIPIENT'S PERMANENT REFUSAL IS NOT RETRIED** (`permanent`, set only on a 5xx to RCPT TO and carried by
  `smtp_send` and `smtp_send_batch`; `email_queueable` and the drain's `email_outbox_after` read it). The old rule read
  a `retryable` flag neither send function passed on, so a "no such mailbox" was queued, retried for 48 hours and
  stopped the drain ahead of a real confirmation. Only the RECIPIENT's refusal counts: a 5xx to the sign-in or the
  sender is the relay's set-up (a changed password), and those emails still queue. test-smtp (two new server modes,
  `rcpt-550` and `auth-535`), test-payrail.
- **THE CHAT'S ONE-TAP SENDS SHARE THE BOOKING PAGE'S GUARD** (`resend_guard` with `email.arrival` and
  `payment.request`; the chat logged its balance as its own action, so neither guard saw the other): two taps in the
  chat sent two arrival emails, and chat plus booking page sent three balance requests in seconds. The chat reads the
  409 as "they have it", not "Couldn't send". §80(e), ui-test-command, test-payrail.
- **THE NOTES ASKING AN ENQUIRER BACK HONOUR THE UNSUBSCRIBE** (enquiry-nudge.php: the follow-up and the
  abandoned-enquiry rescue): an opted-out address is set aside and stamped, and both carry a signed one-tap
  unsubscribe (footer, text half, List-Unsubscribe headers). §80(f), test-emails-render §18.
- **Smaller**: a declined card is a money alert that opens the booking (it had no category, so it counted as a system
  notice only a Super User gets); a chat alert is tagged per conversation (a second guest's replaced the first's); every
  guest alert opens `?open=stay`, not the homepage; the arrival email waiting for review is its own kind of alert,
  "Arrival emails to review" (`arrivals`, a switch on Notifications, for people with `gu.reply`): its category was one
  no switch covered.
- Gates: integration **§80** (a–f), test-emails-render §17–§18, test-webpush, test-smtp, test-payrail, ui-test-command,
  ui-test-owneraccount §8. Every change break-tested, each failing its own named check; several first drafts of those
  checks were vacuous (a seeded row on the database's UTC clock read as an hour old, a mutation that landed on the
  "Damage hold placed" alert's identical text, a scan that read the wrong argument of calls with a trailing comma),
  and each was fixed until the break fired.
- **Not done, said plainly**: reply tokens still never expire; and "Also emailed" addresses that are a removed
  person's still receive (listed on screen for the owner to remove).

## Email delivery is at-least-once now — the OUTBOX (migration-113)

**Two retry regimes, and a flow must be in exactly ONE.** The stamp-on-success
crons (pre-arrival, review ask, waitlist, payment chasers) re-enter their due
window on the next pass — they self-heal and must NEVER also queue. The
ONE-SHOTS had nothing: a transport blip lost the booking confirmation, the
enquiry ack (the "we'll reply by tomorrow" promise), every owner alert and any
failed newsletter recipient, forever, with only an activity warn to show for
it. `email_outbox` (mailer.php) is that missing half — queue on failure, retry
with backoff (10min doubling, capped 6h), give up LOUDLY at 8 tries / 48h
(`email.gaveup` warn → Needs attention), pruned by self-repair (sent 7d,
gave-up 30d).
- **`sent_uncertain` is the safety fact.** smtp_transmit now states on every
  return whether the payload went out; after-DATA ambiguity may NEVER be
  retried by any layer (`email_queueable` refuses it, and a drain retry that
  itself ends sent_uncertain is terminal). smtp_send_batch carries the flag
  too — send_owner's per-recipient queueing reads it there.
- **Decisions are PURE** (`email_queueable` / `email_outbox_backoff` /
  `email_outbox_step`) — test-payrail drives the matrix with no DB; test-smtp
  gates the flag against the fake server; test-integration §22 gates the SQL
  lifecycle through the real self-repair drain.
- **Wired**: `smtp_send_reliable` on the ack + confirmation; send_owner queues
  failed copies ('owner-alert'); newsletter queues failed recipients. The
  MANUAL composer is deliberately NOT queued — the owner is looking at the
  error and retries; queueing would double-send when they do. 'Mail disabled'
  never queues. Attachments over 512KB (the weekly backup) never queue. A recipient's permanent refusal (a 5xx to
  RCPT TO, `permanent`) never queues and is given up at once by the drain, which carries on (round 7).
- **Drain triggers**: self-repair daily, plus `email_outbox_kick` after any
  successful smtp_send (a send that just worked is the only real proof the
  relay is back — the op-queue probe rule, server-side; once per request,
  re-entrancy-guarded).

## Payments: where the money is, in one look (the approved Payments demo, built without CI)

**Supersedes the "FIVE ANSWERS" landing below** (its renderer, moAsyncFill, moHeadline and the Tools rows are gone).
The page is `#pm` in admin-views.html, `pm*` / `PM_*` in admin.js, the `#pm` / `.pm-sheet` block at the foot of
admin.css. Markup uses `data-pm` and `pm-` classes (the Inbox's rule), wired once on `#view-accounts` by `pmWire`.
- **The journey card**: Owed to you (the bookings' own `bookingDue`), With Square, In your bank, and **Ready to move
  out**, then Needs you (overdue balances, deposits to return, a failed payout), Coming in (each with how the money
  arrives: collects itself / link sent / asked, not paid / due now / asks on its date / you arranged it), Activity
  (five filters, paged by `before`) and The books. A phone slides a detail page over the list below the header
  (`#pm.is-detail`, `--pm-top`); from 880px of room the two sit side by side and the detail defaults to the books.
- **Two sources, each said once.** Who owes what is client-side from `pmOwedRow` (bookingDue, bookingPlanDueDate,
  bookingInBalanceWindow, the autopay columns, bookingOwnerArranged), so this page, the booking page and Today cannot
  disagree. A card on file is never overdue unless declined (3 tries). Everything else is **money.php**: `summary`
  (position, bank items, the moved-out map, the books, years, the first 80 movements), `activity {before}`,
  `stay {id}`, `payout {id}`, `books {year}`.
- **money.php reads accounts.php AS A LIBRARY** (`CHB_ACCOUNTS_AS_LIB` makes it return its report instead of
  `json_out`), so the sweep's per-transaction arithmetic exists once. `money-lib.php` is pure: payments rows to events
  (the card's amount is rental + the deposit that rode it), payouts from the Square cache, expenses, moved-out
  markings, `money_position` (with Square = settled money on its way or unknown; in the bank = landed and not marked
  moved; ready = the sweep's own movable; held = the gap) and `money_books` (one profit sum). Square is never asked
  on a page visit; "Check Square now" on Move money out asks.
- **"I've moved it out"** amends the WHOLE stored `sweep-moved` map with every in-bank txn (the payouts-lib rule) and
  offers Undo. The typed-balance worksheet stays one tap away (`accountsOpen('balance')` shows the old `asec-sweep`).
- **Recording a payment is a sheet** (`pmRecordSheet`): from a guest it is that guest's alone; from + it offers the
  owing guests. It adds the typed sum to what is recorded and posts the CUMULATIVE `set_payment` (cash deposit only in
  full, `deposit_collected`), with the op ledger id and an Undo that puts the previous figures back.
- **Routes**: `accountsOpen('payments'|'recent')` lands on the page, `'income'` opens the books, `'sweep'` opens Move
  money out, `'expenses'` keeps the old expense manager (the books' "Every expense"). `renderMoneyOverview()` is now
  the page's repaint plus a debounced summary refetch; anything that changes money still calls it.
- **A reset rule inside `:is(#pm, …)` takes the id's weight**: `:is(#pm, .pm-sheet) button { color: inherit }` beat
  the pressed chip's own colour and painted white on white. Resets go in `:where()`.
- **The + animates both ways** (owner-asked): open, it turns into a × and fills like the dock's selected button, and
  `#pm-menu` grows out of it; closing plays the same motion backwards (the rotate used to be declared on the open
  state only, so it snapped back). `[hidden]` is still the one switch `pmMenuShow` sets and every check reads: for
  the menu it is the folded state (kept on screen 140ms, then `visibility: hidden`), which is why the page's
  `[hidden] { display: none !important }` rule excludes `.pm-menu`. Reduced motion puts `display: none` back. A
  check that measures the open menu reads layout sizes (`offsetWidth`), not rects, which are 90% while it grows
  (ui-test-onelook §8, re-aimed and not run, at the owner's ask).
- Re-aimed since (the overnight CI pass): ui-test-money, ui-test-backoffice-motion, onelook §8/§16 and new layout
  scenes all read the `#pm` page now. Follow-ups: Today, the dock badge and search still compute owed
  their own way; the CSV/PDF keep their own profit arithmetic.

**"With Square" kept money that was already in the bank** (reported live: £1,291.97 "in the next payout", all of it
transferred). Bank transfers and cash were never counted there (only `kind deposit|balance` Square charges are). Two
causes, both in payouts-lib.php:
- **The payout cache was rebuilt from the fetch window alone.** A charge whose payout aged out of the 60 days lost
  its "landed", so its moved-out mark (which only applies to landed money) stopped applying and it read as with
  Square again. And the sweep lists charges from 90 days back (plus any still holding a deposit), so a charge 60–90
  days old could never be matched at all. Now: `payouts_charge_merge` carries PAID/SENT charges forward for 400 days
  (a FAILED one is dropped: Square re-pays it as an adjustment), the fresh fetch always wins, the window is 100 days,
  a PAID payout already read in full (`entries_read`) is not re-read, and the carry-over only happens for the same
  location. `payouts_apply(…, $today)` re-judges `landed` when read, so a cached "arrives Thursday" is landed on
  Thursday without waiting for a refresh.
- **The owner can say so** (the demo they asked for): `sweep-landed` (internal, Money overview in people-lib) is a
  map of txn id → when, read by `payouts_landed_marks()` and applied in `payouts_split_totals(…, $owner)`: a charge
  Square has not called landed counts as landed, carrying `landed_by_owner`. Square's own answer wins, and a mark
  never overrides a FAILED payout. Charges already lost from the cache before this fix need the owner's tap.
- **The page**: tapping With Square opens `pmWayPage` (On its way / Not paid out yet / Not reported by Square, with
  "In my bank" per row and "All N are in my bank" behind a confirm / You said these are in your bank, with Put back /
  Not through Square). `money_position` adds `unreported` (unknown charges over `MONEY_UNREPORTED_DAYS` 7 old): the
  stop's subtitle then says "Square hasn't reported N", not "in the next payout", and Needs you gets a "Card payments
  to check" row. The stay page's card rows stop saying "in the next payout" for those too. Gated by test-payouts
  (marks, read-time verdict, merge, a second refresh not re-reading a PAID payout, the wiring), break-tested on the
  merge and the marks. Not run: test-integration (no MySQL here) and the money ui suites (not re-aimed since #1379).

## One money list: Square, the bank and the owner's own records (approved demo v4, built and pushed to main without CI)

**Asked for as "can these be unified into one system, even if monzo is disconnected?"** The Payments landing's
Activity and the bank page's To sort / Sorted lists are ONE list, captioned **Money** (`pmActivityHtml`, still
`#pm-activity`). It has three sources, named in a "Where it comes from" card at the foot (`pmSourcesHtml`):
- **Square**: cards and payouts.
- **Open Banking**: the bank.
- **You**: cash, transfers, expenses.

Everything is client-side over data the page already fetched: money.php's events plus statements.php's lines. There
is no new endpoint and no migration.
- **EACH POUND SHOWS ONCE** (`pmJoin` → a map of event id → bank line). A bank line that says the same thing as an
  event is not a second row; it changes the event's row.
  - Expense line (`expense_id`) → event `x<id>`.
  - Square payout line → the payout with the same amount arriving within 4 days. Its sub becomes "In your bank"
    (a FAILED payout keeps its own word).
  - Recorded transfer (`booking_id`) → a non-card `in` event for that booking within 4 days, whose amount is ≤ the
    bank figure (the nearest amount wins). The row shows the BANK figure, because set_payment records the rental
    part only.

  An unjoined bank line is its own row (`pmBankRow`, sorting in place). A line older than the oldest loaded event
  waits for Show older, except under the To sort filter.
- **THE BANK IS SEEN UP TO A DATE, and the list says where it stops** (`pmBankSeenTo`):
  - While Open Banking is live, today.
  - Otherwise the newest of the last statement's end, the last good sync and the newest line.

  Below that date in All / Money in / Money out, an amber `.pm-edge` row reads "Your bank is seen up to <date>". It
  says whether Open Banking is disconnected, and offers Connect again (full access, reconnect only) and Add a
  statement. So everything above it is Square's word or the owner's, never claimed as bank-checked. No bank at all →
  no edge and no To sort.
- **To sort is a FILTER** (the second chip, with its count, shown only when something waits) and a Needs-you row
  ("N bank payments to sort" → `data-pm="tosort"`, which also closes the phone's bank page).
- **Statement due and the link's trouble moved into Needs you too** (`pmBankNeedHtml`):
  - Approve in your banking app.
  - Connect Open Banking again.
  - Open Banking hasn't synced.
  - Time for <month>'s statement.

  The way-in card, its Not now (`PM_BANK_HIDE`) and the bank page's two lists are gone. The bank page ("Your bank")
  keeps the balance, the link, statements, the reminder and Disconnect.
- **The balance is one row, "In the bank"** (`pmBankCardHtml`, top of the landing). It takes the newer of the live
  and statement balance (`pmBankBal`). One status line carries a coloured dot (`.pm-sdot`), one of:
  - Live · 13:51
  - Waiting for approval
  - Disconnected · <date>
  - Statement · <date>
  - Not linked · Link

  It is the way in when nothing is linked.
- **A transfer to the owner's own name is an offer, never assumed**: "A transfer to you. Moving money to your own
  account?" → Moved to my account (`ignore`, labelled "Moved to your own account", not a cost) or An expense. The
  name is the split holder's, else the signed-in person's (`pmOwnName`).
- **A sorted bank payment is one plain row that opens its own page** (`data-pm="line"` → `pmOpen('line:<id>')` →
  `pmLinePage`, laid out like the stay page). Undo lives on that page, not in the row: "Undo, and sort it again". A
  payment recorded on a booking offers Open the booking instead. The page shows:
  - the amount, with a Sorted capsule;
  - What it was: the cottage or booking, whether the books count it (`pmBankBooksSay` — the books read only booking
    payments and expenses, so everything else is "Left out" or "Not in the books"), and when it was sorted;
  - From your bank: payee, reference, type, the bank's category, the balance after, and how it came in.

  The top card is a centred receipt (`.pm-lhero`): the direction icon, the figure, Paid out / Paid in, and one
  capsule — ✓ what it was, or an amber To sort.
  After an undo the page stays open and asks again with the list's own buttons, placed under the question.
  statements.php's `stmt_row` sends `via` (import 0 = live), `sorted_at` and `balance` for it. `pmBankWhat` is the one
  wording for what a payment was. "Moved out" rows still open nothing.
- **NAMING: the connection is "Open Banking"**, the account stays "Monzo Business". Every connect/disconnect/sync
  string, toast, sheet title and + menu item says Open Banking. The Monzo developer-client steps still say Monzo,
  because that is what the owner types into. smoke-test's Title Case allowlist gained Open, Banking and User.
- Also fixed: the books page's three buttons overlapped at 1280 (`.pm-acts .pm-btn` now has
  `min-width: min(100%, max-content)`, the `.pm-acts-row` idiom). And one type error left on main by the Permissions
  push was fixed (`window.__BUILD`).
- Checked by a throwaway stubbed browser drive in five states (live, stale, statements only, nothing linked, 1280),
  at 390 in both themes. It asserted:
  - each payout and expense once, the transfer once at the bank figure;
  - To sort 4 → 3 after a sort;
  - the own-account ask;
  - the edge only when not live, and where it sits;
  - no sideways scroll, no page errors.

  That drive is not committed. ui-test-statements and ui-test-money were re-aimed to the one list
  afterwards (the overnight CI pass).

## The business bank, from its statements (Monzo Business; built without CI at the owner's ask)

**Asked for after the MTD/Monzo demos, for a BUSINESS account.** Monzo's developer API is built for personal
and joint accounts and can't be confirmed to read Monzo Business, so the app reads the statement the owner
exports (Monzo app → ⋯ on the business card → Bank statements → CSV). A live link waits on the owner's own test
at developers.monzo.com; nothing here assumes it.
- **Server**: `statement-lib.php` is PURE (CSV parse, loose header match, a PDF/QIF/xlsx refused in words, the
  closing balance = the one after the LATEST date+time whatever the file's order, `statement_auto`,
  `statement_due`, `statement_reminder_due`), gated by **test-statements.php** (60, CI-wired, deploy-excluded,
  counter `stc()`). `statements.php` (admin, area `money`) stores it: migration-135 `bank_lines` (UNIQUE
  `ext_key` = `m:<Monzo transaction id>`, or `h:<fingerprint>:<occurrence>` when a file has no ids, so the same
  payment twice in one file is two payments) + `bank_imports`. `import` rides the op ledger AND INSERT IGNORE,
  so statements may overlap freely and nothing is ever added twice. Settings live in the internal key
  `bank-statements` {on, remind, reminded}.
- **Only two things sort themselves** (`statement_auto`): a Square payout (money IN only — it is card money
  already in the books, so counting it again would count it twice) and a move to or from a pot (the owner's own
  money changing places). Everything else is the owner's call; `mark` refuses `square`/`pot` and a `payment`
  with no booking.
- **Suggestions are worked out in the BROWSER** (`pmBankSuggest`), from the live bookings, never stored: the
  booking reference (`CHB-000123`), then a surname shared with someone who owes, then exactly the sum someone
  owes; platform payouts (Airbnb/Booking.com/Vrbo) are NOTED for reconciliation and change no books; HMRC is tax
  and left out of costs; a payee sorted before is "as last time" (`learned` from the server); a category guess
  from the payee name. **Recording reuses the existing writes** — `pmPaymentPlan` (extracted from pmRecordSave,
  one derivation) posts `set_payment` dated the day the money ARRIVED with method Bank transfer; an expense goes
  through `expenses.php add` on its own date. statements.php only stores the link (`booking_id`/`expense_id`).
  A recorded transfer's row offers **Open** (its booking), never Undo: un-marking it would leave the payment
  recorded and the line back to sort, i.e. a way to record it twice.
- **The page**: a way-in card on the landing ("Not now" hides it per device), then one "Monzo Business" row,
  or "Time for <month>'s statement" once the last statement stops short of last month's end; "N bank payments to
  sort" in Needs you; the bank page (`pmOpen('bank')`, `accounts:bank`) with the closing balance FROM THE
  STATEMENT (dated — never mixed into the In-your-bank stop, which is Square's money), the reminder switch, To
  sort and Sorted. The add sheet is Export → Add → Check; Check writes nothing (`preview`) and its button says
  what it will add. A monthly reminder on the 1st rides self-repair → `alert_owner` (email fallback), once a
  month at most.
- Gates: test-statements, test-integration **§53** (the real endpoint and tables: refused for a visitor, the
  preview writes nothing, auto-sort exactly two, the replay, the same file again, an overlap adds only the new
  line, the mark refusals, the link, undo, the reminder, never public, stop keeps the payments) and
  **ui-test-statements.js** (the screens, with the REAL parser run through the php CLI behind a stubbed endpoint;
  also driven by hand at 360/1280 in both themes). Budgets: admin.js +9.5KB, admin.css +0.5KB gz (owner-only).

## Whose money is whose: the account holder pays a host their cottage's money (built and pushed to main without CI, at the owner's ask)

**Asked for as**: every guest pays into Sophia's Monzo Business account; she keeps 21A's and Jollyboat's money
and pays her costs from it, and sends George Pimpernel's money. George pays Pimpernel's costs from his own
account, which the app can't see. The approved demo was v10 of the "who earned what" artifact.
- **The rule is `split-lib.php`** (pure, `test-split.php`, 37 checks, counter `spc()`). Settings are the
  internal key **`money-split`** {holder, hosts {prop_key: admin id}, payees {admin id: [names]}, since}. A host
  who isn't the holder is **paid out**; a cottage nobody hosts is the holder's, so no money falls between two
  people. With no holder set the split is off and every screen is as before.
- **A paid-out host's money** (`split.php` `split_items`): each booking's income on the days it arrived
  (accounts.php's own `allocate_income_by_day`, so the arithmetic exists once) **less that day's card fee**,
  plus every platform payout sorted on the bank page **with a cottage** (`bank_lines.prop_key`, migration-136).
  **Sent** is the bank lines sorted `person` to them (`bank_lines.admin_id`). **Still owed** is the difference,
  and `split_allocate` says which bookings it is for: payments cover the earliest-counted money first, so the
  list on screen is exactly what the next transfer ticks off; money handed back to a guest comes off its own
  booking. Counted from `since` (set to the tax-year start the first time the settings are saved).
- **A payment out to a linked name sorts itself** as it arrives, from a statement or the live Monzo link
  (`split_bank_insert` in `split-store.php` is now the one insert both use; `statement_auto($line, $payees)`).
  Only an EXACT name (letters only) counts; a similar one ("G Farrow-Green") is offered on the bank page and
  never assumed. Until migration-136 has run the split stays off and no insert names the new columns.
- **The holder's side** (`status` role `holder`): their cottages after card fees (accounts.php's payment rows
  by cottage, plus their matched platform payouts, less card fees), **their costs = every expense except one
  tagged to a paid-out cottage**, their profit, and each paid-out host's share, sent and still owed.
- **The Payments page** (admin.js `pmView()`): the flow card (Owed / With Square / In your bank / Ready to move
  out) and Coming in are GONE for everyone — one **"Guests still to pay"** card (`pmOwedCardHtml`, `#pm-coming`
  kept as the anchor) lists who owes, overdue included, so Needs you no longer repeats overdue rows. Square
  payouts moved to the + menu (Move money out went too, then was REMOVED — see below). **Holder**: their cottages' guests only, a Needs-you row
  "Pay George for Pimpernel", and "Your cottages" + "Pimpernel is George's" in place of the books card (Open the
  books stays a row). **Paid-out host**: only "Sent to you this tax year", what is still with the holder (a sheet
  of the bookings), their cottages' guests still to pay, and the transfers from the holder; on a computer the
  side pane is that list, never the business's books. With full access, "Open the whole business" shows the
  ordinary page. Until the first answer lands the list says Loading rather than flash someone else's money.
- **The matching engine** (`pmSplitSuggest`, consulted first by `pmBankSuggest`; each is an offer, never
  assumed): money out to a name like a paid-out host's → "Paid to George"; money out equal to a guest's damage
  deposit with their name → "deposit going back, not a cost" (sorted `ignore`); money in that a booking already
  records (paid by transfer, near its date) → "the same money" (sorted `payment` with the booking, **no
  `set_payment`**, so it is never counted twice); cash paid in → counted once; a platform payout with exactly one
  imported stay from that platform starting 0–3 days before → that cottage (else, with the split on, a cottage
  picker). `pmBankDoSplit` carries them out.
- **Settings**: People & access → **Cottages and the bank** (`renderSplitSettings`, section `split`, full
  access only): whose account it is, who hosts each cottage, and the names each host is paid as (link / unlink;
  linking sorts the payments already there, unlinking puts them back to sort). A paid-out host with no linked name
  is offered the payments to their own name on their Payments page. `split.php`'s `status` is area `money`;
  `settings`/`link`/`unlink` are full access.
- Gates: `test-split.php`, **test-integration §55** (20 checks against the real tables: settings refusals, the
  share after fees, the offer before linking, link sorting the existing payment, the earliest booking first, a new
  statement sorting itself, the holder's side, the mark refusal, unlink, never public), the re-aimed
  test-statements/test-monzo source checks, and a full-stack browser drive (George and Sophia signed in, both
  views, the pay sheet, the five suggestions carried out, the payout raising what is owed) — not committed.
- **Not done, said plainly**: money owed from before `since` isn't included; the guest "money story" page in the
  demo was not built (the booking page's ledger serves); the weekly digest, search and the CSV/PDF don't follow
  the split; the books page is still the whole business's. ui-test-money and the layout/onelook scenes were re-aimed
  to the page without the flow card afterwards.

## Move money out is GONE (owner's ask: "no longer needed")

The Payments detail page (`pmMovePage`, "I've moved it out"), the old typed-balance worksheet behind it
(`#asec-sweep`, `renderSweep` and every `sweep*` helper, `confirmReturnSettled`), the + menu item, the search action
and the "how much can I move out" answer (`CHB_SWEEP_Q`, `cmdkSweepMerge`) were all removed. Old links
(`accountsOpen('sweep'|'balance')`, a remembered `accounts:sweep`) land on the Payments landing; the failed-payout and
dispute duties open Square payouts instead. **The server is untouched**: accounts.php's `deposit_liability`,
sweep-lib.php and payouts-lib.php still feed the Square payouts page and the books, and test-sweep/test-payouts keep
their arithmetic checks (only their source-scans of the removed screen went). Activity rows recorded as "Moved out"
still list, no longer tappable. The browser scenes that opened the screen (a11y, layout, ui-test-radii §3,
ui-test-ownerref §2) were removed with it; nothing was run, at the owner's ask.

## The live link to Monzo Business (built and pushed to main without a PR or CI, at the owner's ask)

**Asked for as "add the live link".** Monzo's developer API documents only `uk_retail` / `uk_retail_joint`, so
whether it shares a BUSINESS account is Monzo's call: the link takes only an account whose type says business
(`monzo_pick_account`) and otherwise says "Monzo shared a personal account, not the business account.
Statements stay the way in" (`no_business`). **A personal account's payments must never land in the business
books.** The statements route is untouched and still works alongside.
- **Files**: `monzo-lib.php` (pure — the connect URL, the client refusal, token reading, refresh-due, the account
  choice, `monzo_since`, `monzo_line`, `monzo_health`), `monzo-sync.php` (IO lib — `monzo_http`, `monzo_token`
  with one-time refresh rotation, `monzo_check`, `monzo_sync` under `GET_LOCK('chb_monzo_sync')`),
  `monzo.php` (admin: status / save_client / connect / check / sync / disconnect; people-lib gives status, check
  and sync to `money`, the rest is full access), `monzo-callback.php` (Monzo's redirect).
- **Stores**: `monzo-client` and `monzo-auth` are PRIVATE (encrypted; a config const `MONZO_CLIENT_ID` /
  `MONZO_CLIENT_SECRET` wins); `monzo-link` is internal. Payments land in `bank_lines` with `import_id 0`, keyed
  `m:<Monzo transaction id>` — the SAME key a statement's Transaction ID makes, so a payment that arrives both ways
  is one payment. `monzo_line` skips declined, still-pending (`settled === ''`), £0 and non-GBP transactions, names
  pots from `/pots`, and dates in London time. `statement_auto` sorts the Square payouts and pot moves exactly as
  for a statement.
- **The callback is authorised by a single-use state, not the session** (sha256 in `monzo-link.pending`, 15
  minutes, removed before the code is exchanged): Monzo's sign-in arrives by email, and on a phone that link opens
  in the browser rather than the installed app, which has its own cookies. The page it shows says what is left
  (approve in the Monzo app) and links back to `?open=accounts:bank`. Posture `token` + rate limit.
- **The five-minute window**: Monzo shares full history only in the first five minutes after authentication, then
  the last 90 days. The page polls `check` every 5s (ten minutes) while waiting for approval, and the check that
  sees the business account syncs at once from the start of the tax year; later syncs ask from ten days behind the
  newest live payment (`MONZO_OVERLAP_DAYS`, so a card payment that settled late arrives), never older than 89 days.
- **Freshness**: the daily self-repair syncs and passes `$live` to `statement_reminder_due`, which stands down
  while live (`monzo_is_live`); a page visit kicks a quiet sync when the last is over an hour old (nothing waits on
  Monzo). The statements status carries `live`, so the page makes one request. Live: Monzo's balance leads the
  bank page ("Balance now", with pots), the landing row says "Live · synced 13:51", the due-statement card and the
  reminder row stand down. A refresh Monzo refuses, or a 401, drops the token and shows "Connect Monzo again".
- **A client must be CONFIDENTIAL** (secrets starting `mnzpub` are refused: Monzo gives a non-confidential client
  no refresh token, so it would stop every six hours). Monzo's API errors reach the page through `chbActErrSay`,
  which only passes a sentence of **≤120 characters** — the first refusal was longer and read as a generic
  failure.
- Gates written: `test-monzo.php` (51, CI-wired, deploy-excluded, counter `mzc()`), test-integration **§54** (the
  real endpoints against a FAKE Monzo started on its own port — `MONZO_API_BASE` / `MONZO_AUTH_BASE` are defined
  only in the harness's config copy), and the live half of `ui-test-statements.js`. Break-tested on the account
  choice, the declined skip and the five-minute window. §54 passed in full once before a final edit to its
  null-check; after that, at the owner's ask, nothing more was run before pushing.

## The Money area is FIVE ANSWERS, not an index

**CONNECTION + LOADING (owner-asked).** A dropped request no longer flips the app offline by itself: `chbNetFail()` (app.js) needs `version.php` to fail a 3.5s probe too, `navigator.onLine === false` stays an instant verdict, and `apiGet` retries once after 600ms on a FAST transport failure (never after a 15s timeout, never while known-off). The outage still gets its toast only after the existing 8s "noticed" rule — an early probe was tried and removed because it pre-empted that rule (ui-test-offline). Work is visible: `chbBusy()` lights `body.chb-busy` (a 3px sweep bar, admin.css) 500ms after any request starts, except `version.php`; `adminLoading` paints skeleton rows (`.sk`) with the words kept in an `.sr-only` live region; the Payments placeholders pulse (`.mo-run`, removed by `moLand`) but still never play the arrival animation (ui-test-backoffice-motion, re-aimed). `apiPost`/`apiGet` are thin wrappers over `apiPostCore`/`apiGetCore` and carry `@returns {Promise<any>}` — without it tsc infers `{}` and the budget moves.

**TYPE BY ROLE (owner-asked, demo "Type sizes"; supersedes the Payments "one size" rule below):** at the foot of admin.css, scoped to `body.owner-mode` — headline sentence 17, section caption 12 (`.bhub-grpcap`, `.acr-cap`, `.bo-sec-title`, `.status-group-title` are ONE spec, ui-test-hig), row sub-line 13, row figure 17, buttons 15; row titles 15, capsules 12, page titles 28, menu rows 17 unchanged.

**ONE FONT (owner-asked, supersedes the "serif is money" rule in the back office):** `body.owner-mode { --font-serif: var(--font-sans) }` at the foot of admin.css, so every admin screen is Montserrat with sizes and hierarchy unchanged; the Manage index and rail rows are one step bigger (`--fs-headline`). The guest site keeps its serif.

**Update (one size):** every word on the landing — headline, pulse, row titles/subs, figures, calm line, Tools — is the status capsule's own type (`--fs-caption`, 600, sans, tabular); hierarchy is ink and position, there are no serif figures there (owner-asked, demo "One size"). Scoped under `#money-overview`/`#accounts-index` at the foot of admin.css.

**Update (calm is one line):** the landing opens with a SENTENCE (`moHeadline`, `#mo-headline`) built from the
same figures the groups show — what is yours to move, who owes you, what is held, how many things need a look —
and leaves out any part still loading rather than guessing. "To collect" renders only when money is owed and "To
give back" only when a deposit is held (filled by `moAsyncFill` into `#mo-back-slot`); otherwise the status pill
beside the title says so (`#mo-pill` — the `#mo-calm` panel is gone, see "Every page's status is the Manage pill"). The "More" cards are three `.mo-tool` buttons. The Square-hasn't-said row says when a charge is
older than Square's payout window and so cannot be matched. The destination pages (Move out, Income & tax,
Recent, Expenses, Pricing coach) are NOT yet reworked.

`renderMoneyOverview` (admin.js) renders the landing in the hub's fold anatomy
(`bhubFoldGrp` — see the booking-hub notes): a pulse line, the EXCEPTIONS, then one
verdict group per money question — **To collect / To move out / To give back / The
books / Recent** (+ Trends & history holding the old charts). Gated by ui-test-money
§2/2b/2c (each break-tested; a deleted fold group fails NAMED checks, not a crash —
the click is guarded).
- **The owed rows are PLAN-AWARE and reuse the hub's own helpers** (`bookingDue`,
  `bookingPlanDueDate`, `bookingInBalanceWindow`), so "due now" here and the payask
  there cannot disagree. Due NOW: nothing paid in yet, inside the window, or the stay
  is over. OVERDUE (finished stay, or due date a week gone) is an EXCEPTION row in
  Needs attention, NOT a queue row — and the To-collect zero state therefore must not
  claim "every upcoming booking is paid up" while an overdue row sits above it
  (break-tested; it says "nothing else — the overdue one is above").
- **`moChaseDue` rides `chbBulkBalanceAction`** (the search answer's informed-confirm
  bulk machinery, unchanged) over the DUE-NOW rows; offered only at ≥2 chaseable
  owers, the under-two rule the bulk chase already follows.
- **`moAsyncFill` fills the slow answers in place, stamp-guarded** (`__moFillStamp`,
  the cmdk supersede pattern): ONE accounts.php fetch answers To-move-out (payout
  `P.inBank`), To-give-back (`L.items` with per-row states — the sweep's tensed
  vocabulary), The-books (the SERVER net replacing the client's fee-less estimate),
  and the "Square hasn't said" exception (joins Needs attention only when payouts ARE
  reporting and a charge is >7 days old); it caches into `__sweepLiab` so opening the
  sweep afterwards costs nothing. The recent feed is its own `recent_payments` call.
  Navigate first, load second — the groups render instantly with "working it out…".
- **Income & tax keeps its headline and folds the rest** (`renderAccounts`): The
  arithmetic / Quarterly (MTD) / What this number doesn't cover, exports visible.
  Every gate-pinned string (the feed rows, the Q2 regex, the fee note, the
  `.accounts-stat.headline` classes) survives verbatim INSIDE the folds — textContent
  reads pass through `hidden`, the fold rule again.
- **The index shrank to one "More" group** (Payments & balances / Expenses / Pricing
  coach) — the verdicts route to recent/income/sweep themselves. `#accounts-index` is
  ONE desktop column now (app.css ≥900 block): two columns tore the caption from its
  group, the money-overview children centre on a 640px rail (`.mo-pulse`'s own margin
  must stay `auto` — a `margin: 2px 0 0` shorthand silently un-centred it, caught on
  the screenshot). Income & tax's folds stay LEFT-aligned — the headline and year
  select above them are, and centring only the folds made two columns of one page.
  **THE "More" GROUP SITS OUTSIDE `#money-overview`, so the RAIL rule can't reach it**
  (found in the audit's screenshot pass): on rail screens `body.rail-on.admin-screen
  #money-overview …` left-aligns the answers to the title's edge, but the More caption +
  group are siblings of `#money-overview` and carried inline `margin:auto`, so they
  stayed CENTRED while the answers went flush-left — two starting lines on one page. The
  inline margins are gone and `#accounts-index > .bhub-grpcap`/`.settings-group` follow
  the same regime (centred on the 640 column, `margin-left:0` on rail). The general
  trap: a rail rule scoped to a container never reaches a sibling, and an inline
  auto-margin can't be overridden by it.
- **A WIDE `.bk-row-top` WITH TWO STATUS CHIPS FLOATS THE FIRST ONE TO THE CENTRE.**
  The Payments & balances rows (`#money-panel`) carry a pay pill AND an "Arrives in Nd"
  chip, i.e. THREE flex items under `justify-content: space-between` — which spreads them
  left/centre/right, stranding the pay pill mid-row with empty gaps either side (the
  Alexandrina row below, with one chip, looked correct and made it obvious). `#money-panel
  .bk-row-top .prop-tag { margin-right: auto }` at ≥900px groups both chips on the right
  rail; below 900 the row wraps (the arrival chip to a second line) and the verified phone
  layout is left untouched, so the fix is desktop-scoped. Found in the audit's visual pass,
  not by a geometric gate — space-between spreading N>2 items is legible-but-wrong, which
  layout-test (overflow/clipping only) cannot see.
- **`#money-overview .bhub-kv-label` is sentence case at reading size** — these rows
  name GUESTS, and the reference cards' 84px uppercase column rendered "PAID UP ·
  BALANCE" as a label. The landing's booking rows are `.mo-row` `<button>`s (full UA
  reset) routing to `openBookingHub`.
- The Move-money-out screen itself was deliberately left as-is this pass — it already
  had its answer-first rebuild (see the sweep notes).

## One look across Manage (approved "One look for Manage" demo, built: #1365 + the content PR)

Every Manage page, sub-page and window opened from one uses ONE set of parts, taken from the account pages
(`ga-*`), which already looked like this. Measured before (the demo's audit): fifteen button looks, ten cards,
seven captions, three back links, seven fields, four switchers, five stat tiles, four window shapes. After: three
kinds of button, two card surfaces (the card and the inset panel), one of each of the rest. Gated by
**`ui-test-onelook.js`** (26 checks), break-tested three ways (the button pass removed, a background repaint's
guard removed, the window scope removed — each fails its own checks).
- **THE STYLES ARE ONE BLOCK** at the foot of admin.css ("ONE LOOK ACROSS MANAGE"), every value a `--u-*` token
  defined on `body.owner-mode`. **Scope**: page rules hang off `:is(main, div).one-look` — the class sits on
  `#view-settings`, `#view-activity-log` (index.html shells) and the search sheet's `#cmdk-sheet-host`, and the
  selector is (0,1,1), the same weight as the `body.owner-mode` rules it has to follow on order. Window rules hang
  off `body.owner-mode:where(:has(main.one-look.active), :has(#cmdk.cmdk-sheet))` — a glass dialog, the photo sheet,
  the QR window or the date picker opened FROM Manage is a bottom sheet on a phone; the same window over Today keeps
  its own shape (gated both ways). Nothing outside Manage moves.
- **THREE KINDS OF BUTTON, decided at one choke point** (`oneLookButtons`/`oneLookWatch`, admin.js): an observer
  over the Manage views strips the old look classes (`ONE_LOOK_OLD`) and adds `u-btn1` (accent — the one thing a
  card is for), `u-btn2` (outlined) or `u-btn3` (outlined, danger ink), read from the LABEL
  (`ONE_LOOK_PRIMARY`/`ONE_LOOK_DANGER`). A choke point because forty renderers carried fifteen looks — the
  email_dark_hooks rule: a class you have to remember is one the next renderer forgets. It runs on the observer's
  microtask, so the kind lands before the next paint; a test that reads a class in the SAME tick as the render
  reads the old one (wait a tick). A button keeps its kind once given one ("Save" passing through "Saving…" does
  not change shape). The busy/copied/sent/settled states the old classes carried are restated on the kinds. Code
  and tests must find Manage buttons by `data-act`, never by `btn-sm`/`pay-btn`/`sp-fix`/`mo-tool` etc.
- **THE BACK LINK NAMES WHERE IT GOES** — "‹ Manage", "‹ Reviews", "‹ Calendar sync", "‹ Price ideas" — through
  ONE helper, `settingsSetBack(fn, label)`; nothing assigns `settingsBackTarget` directly. **A list that repaints in
  the background must not retitle the page the owner moved to**: `renderCalendarList`, `renderCancelList`,
  `renderTestCentreList` and `renderPricing` set the title and back link only while `settingsShowing(section)` —
  before this, the calendar overview landing late renamed the Price ideas page "Calendar sync" and pointed its back
  link at Manage (found by the gate, present before the one look).
- **ADDING IS A ROW AT THE FOOT OF ITS LIST** (`uAddRow(label, attrs, first)` — an accent "+" tile and the words),
  never one more pill among the actions: Write a new reply, Add something to do, Link a platform, Add a season, and
  the cottage editors' Add a photo / amenity / rule / item / question / section, each above its Save row.
- **The content is the simpler format**: a menu row says where it goes (no sub-lines; Status has no row — the pill is
  the way in; Backups, Integrations, Search learning and Test copy fold under **More tools**, `mgMoreTools`); the
  explanation notes, tips and caption sub-lines went from every page (`ga-note`, `acr-note`, `acr-capsub`,
  `acw-tip`, `sl-note`, `pr-swhy`, `sp-tsub`… — their dead CSS with them); a hint under a field stays only when it is
  a unit or a limit ("per night, on top", "0 = no limit"). Renamed so the row and the page say the same thing:
  **Seasonal rates**, **Price ideas** (was Pricing), **Guest list** (was Guests). Things to do is a list of rows
  (name over category) each opening its labelled editor; Analytics keeps its figures and chart open and folds its
  four deeper sections; Newsletter's figures are stat tiles; Price ideas folds what it has learned and what guests
  searched for; Changeovers has ONE header ("‹ Price ideas", then its own title).
- **DELIBERATE DEPARTURES FROM THE DEMO**, each a fact the demo's blanket rule would have deleted: a season's DATES
  stay under its name on the cottage page (a value, not a hint); Backups keeps one line — keep the passphrase
  somewhere other than your inbox, or the backup can't be opened; Changeovers keeps the shared-changeover figure
  ("5 changeovers on 5 days — 2 already share a drive"), a documented feature; the security page keeps the note that
  two-step stays off until you add an email (it unblocks something); the search-learning "Most-taught answers" line
  stays (data). The cottage rows lost the month's booked figure, and `cottageMonthOccupancy` went with it.
- Also fixed on the way: the account page's slide-in no longer snaps when the people list lands mid-slide (`oaPage`
  carries a running slide on through a repaint with a negative `animation-delay`); the SMS token's saved state rides
  the field's placeholder (its note went); the review QR and Square location windows end in their answers (Done /
  Copy link, Cancel), not a corner ✕.
- **THE REST OF THE BACK OFFICE JOINS, ONE AREA AT A TIME** (owner-asked overnight: "inspect every single admin ui
  element and make sure they're in keeping"). The scope class goes on each view's `<main>` in index.html and the
  view joins `oneLookWatch` (admin.js footer); section 15 of the block names only the parts that area owns.
  **Payments + Key safes first.** What moved: Payments' Tools tiles are rows in a card (the Manage index's own
  `.settings-row` anatomy); its captions are the one tier; the drill-down back link reads "‹ Payments"; the deposits
  heading is a caption; the "Tap a booking to…" note went, leaving only the card-payments-off fact; the "Check
  Square now" button has its own row; a deposit card and the key-safe list are cards on the card radius with no
  shadow. **A fold group takes the card radius through `--fold-r`** (the base `.bhub-card.bhub-fold-grp` reads
  `var(--fold-r, var(--r-sm))`, the one-look views set it) — generalising the Manage card rule to every fold group
  overrode the joins' squared corners AND their negative margins (each container's flex gap is cancelled by
  `--fold-gap`), so the Payments landing came apart into islands. Key-safe to-do cards keep their tinted edge (the
  duty's severity) and their full-width accent action, as Today's single task does. `Return` and a bare `Add` are
  primary kinds now.
- **THE EXPENSE ROWS WERE WEARING THE GUEST'S CLASS.** `.exp-row` is the guest Things-to-do row in app.css, and its
  `display: flex` silently beat admin.css's grid for the expenses list, so every expense wrapped into a narrow column
  at phone width (the documented phone fix for those rows had stopped working the day Things to do shipped). They
  are `.xp-row` now: a caption per tax year with its total, one list card, a line per expense (what, then date ·
  cottage, the amount, its tools as 32px glyphs whose reach is 44 and never overlaps), and "Add an expense" is the
  row at the foot that opens the form in place.
- **A RULE KEYED ON A CLASS THE BUTTON PASS STRIPS IS DEAD.** Reviews' "Ask for a review" rows were one line (the
  cottage, then QR / Share / Copy), and on a phone with a share sheet the three pills squeezed the name into breaking
  mid-word ("Jollybo/at") while each icon shrank to a dot: `.rv-act svg { flex: none }` had pinned them, and
  `rv-act` is on `ONE_LOOK_OLD`, so that rule never applied once the pass ran (reported from a phone). Below 641px
  the pills now take a line of their own as three equal columns, and the icons are pinned by a rule on the one-look
  selector. Before relying on an old class inside a Manage view, check the list.
- **THE INBOX JOINS NEXT** (section 16). The sentence under the title went (the answers carry every count); the
  folder chevrons are the drawn one; inside an open fold a list is the card's own INSET panel (inset ground, no edge,
  the cell radius on the run's ends), while at ≥1200 the same lists are list cards on the card radius. The guest
  conversations are wrapped in ONE `.msg-threads` card — a wrapper, not per-row corners, because `applyMsgFilter`
  hides rows by `display` and `:has(+ …)` corners would square the wrong ends of a filtered run. Under ONE search:
  the filters are chips ("Needs reply · N", "Archived" with `aria-pressed`) and "Mark all read" is the small
  outlined pill after them; the heading slot carries the archive toggle only when the list is EMPTY (the way back out
  of an empty archive). The thread sheet names its own entry point (`data-focus=".modal-box"`): focusInto's
  first-field heuristic landed on the Quick-replies `<select>`, painting a focus ring on a picker nobody chose.
- **TWO INBOX VERDICTS CLAIMED MORE THAN THEY KNEW.** A mailbox load that FAILED read "✓ Nothing new" (the fetched-
  once branch never asked whether the fetch worked) — `__mbxFailed` makes it "couldn't check · the mailbox didn't
  answer". And the Messages folder read "✓ All read" over a conversation still waiting on a reply: read is not
  answered, so a `msgNeedsReply` thread keeps it amber ("1 to answer"). And the enquiry hub's dock repeated the state
  card's Approve while the card was on screen — `hubWatchSticky` now runs for both hubs, its observers kept in a
  WeakMap per hub node so one hub never unhooks the other's.
- **THE BOOKING AND ENQUIRY PAGES JOIN** (section 17). The scope class sits on the hub's CONTENT node
  (`#booking-hub-content` / `#enquiry-hub-content`, `:is(main, div).one-look`) as well as on its page, because those
  nodes re-parent into Today's and the Inbox's side panes at ≥1200px — scoping the page alone would dress a hub
  differently docked than standing alone. What moved: the back link names where it goes (`hubBackName()` from
  `__hubReturnView`: "‹ Payments", "‹ Inbox", else "‹ Today" — exactly the screens `bookingHubBack` returns to; the
  enquiry's is "‹ Inbox"), the groups are cards on the card radius (`--fold-r`), "Needs attention" is the one caption
  tier, the plan badge reads "Custom"/"Default" in sentence case. The hub's own decision buttons are kept OUT of the
  button classifier (`ONE_LOOK_NOT`: the ⋯ circle, the next-action pill, its outlined twin, the sticky bar) — they
  already are the house look and a label-read kind would have turned "Record a payment" into an outlined pill.
  **Approve keeps its own green** (gated in ui-test-ownerday): it was a ghost on a phone because the sticky bar
  carried the fill, and that bar now stands down while the card is on screen, so the card's pill is filled at every
  width.
- **TODAY JOINS LAST, AND WITH IT EVERY WINDOW** (section 18). Today's Upcoming|Past is the same `.inbox-sort.seg`
  control as the Inbox's, so it takes the one switcher (the chosen side in the accent) rather than the hairline
  segmented control the simpler-Today pass gave it; the Bookings caption joins the tier with its section air
  REMOVED inside `.bk-caprow` (the tier's top margin dropped "Bookings" 8px below its own count — gated in §11,
  break-tested). The booking window's one action ("Add booking"/"Save", `#modal-save-btn`) is the accent pill.
  **With Today in, every back-office screen is a one-look screen** — an owner is always routed to one (`nav()` sends
  a signed-in admin's customer views to Today) — so the window rule now reaches every glass dialog an owner opens,
  and §6's "outside the scope" probe moved to the GUEST side (`owner-mode` off), which is the boundary that remains.
- **WHAT THE AUDIT FOUND AFTER ALL FOUR AREAS** (section 19, re-running the vocabulary audit over every non-Manage
  route): a guest's other stays ("Also stayed (3):" over separate mini-cards ending "open →") are one caption over the
  card's INSET panel, rows on hairlines, each ending in the drawn chevron — and "open →" became that chevron at all four
  `.bhub-stay-row` sites (the hub, its intel mentions, the email reader's guest context); an action link's `'›'` glyph
  is the drawn chevron as a mask at the same 0.6; and two fields an id rule held at 44px (`#msg-search`,
  `#sweep-balance`/`#sweep-buffer`) take the one field height. Gated in ui-test-onelook §12.
- **AND THE SECOND AUDIT, OVER EVERY ADMIN SCREEN** (section 20). Every glyph chevron left is the drawn one: the
  `.bk-row-arrow` on every booking/enquiry/payment row (masked, keeping its hover tint and the mailbox's turn), the
  Needs-you action's " ›", the owed line's "View ›", the guest book's "Add detail ›/Hide detail ‹" (now
  `aria-expanded` with a turning chevron), and the timeline's "❮ ❯" (inline SVG in admin-views.html). Both hubs'
  call / email / ⋯ are ONE icon button — a 44px outlined circle on the pill token, `corner-shape: round` pinned, because
  `.btn-sm`'s continuous corner turned the ⋯ into a squircle beside two true circles and the booking hub's was a 56px
  filled pill. "Keep it for damage" is the outlined second choice beside the filled one; the enquiry's quote breakdown
  sits in the inset panel (it was a black stain on a 16px corner); a loading row takes the cell corner; and the
  conversation sheet (the Inbox's pane from 1200px) takes the window's title — its inline serif at 22px is gone from
  index.html — and the one field for its quick-replies picker and reply box (they were 44px, the box on the card's
  20px corner beside a 12px search). Gated in §13
  (break-tested: removing the section fails 7 of 8 — the eighth is the markup's SVG). NB the "££1,363" an audit
  reads is the owed line's decorative £ tile beside its figure, `aria-hidden` — not a doubled sign on screen.
  **A FONT-SIZE-0 INLINE-BLOCK SITS ON ITS FOOT.** The Needs-you chevron (a masked `inline-block` with `font-size: 0`)
  has no line box, so its baseline is its bottom edge and it dropped a line under its own word — "Check" over "›",
  the action 32px tall. The action is an `inline-flex` row centred on the word now; §13 measures the chevron's centre
  against the action's. A glyph the mask replaces is a box, not a character: align it as one.
- **THE TWO LONG WINDOWS JOIN** (section 21). The booking form (`#edit-modal`) and the email composer
  (`#enq-email-modal`, a `.reviews-modal`) were the last centred cards with their own title (22px bold / the old
  serif, inline in index.html — removed) and their own field heights (54–58px). They take the window's ground
  (`--sheet-surface`, `--u-edge`, the card corner), title (17/600), field (48px, cell corner, 17px), caption tier
  (`.modal-sec`) and switcher (the booking form's `.hs-mode` pairs are the pill track, the travelling pill hidden),
  and **on a phone both rise from the bottom edge** like every other window. Written as explicit owner rules rather
  than by adding the guest `.chb-sheet` class: that class's grabber is a block with a negative margin and its padding
  rule would fight the booking form's padding-0 head/scroll/foot structure, which hides its own overflow — so the
  grabber here is absolutely placed, and the docked foot loses its bottom corners and gains the home-indicator inset.
  On a computer both stay cards in the middle. A window's close is one 44px outlined circle (they were 36, a filled
  38 and 44), the key-safe sheet's title is the window's 17/600, and its lone "Got it" the accent answer as
  glassAlert's OK is. Gated in ui-test-onelook §14 (break-tested: removing the section fails 6 of 7; the desktop
  card check rightly survives).
- **THE OFFLINE DAY SHEET JOINS** (section 22) — it lives inside Today's `<main>`, so the button kinds and caption
  tier already reached it, and the rest had been left behind: every row carried the 3px coloured rail the HIG pass
  removed everywhere else, each row was its own card 10px from the next, the cottage tag stretched the whole row,
  the Bookings rows said "Balance due" as BARE text (`.bhub-chip`'s CSS went with the hub chips long ago — the class
  survived only because ui-test-offline reads it), the duties ended "Open ›" in a glyph, and the banner, timeline
  and private notes sat on a 16px corner that is not one of the three. Now: no rail, each run of rows is ONE card
  (radii on the run's ends, hairlines between), the tag keeps to its name, the paid state is `stCap` (the
  `bhub-chip` class kept beside it for the suite), a duty's action is the online strip's own `ny-act` + drawn
  chevron, the call/text buttons are the outlined icon circle, the timeline is a card and the banner a cell. Gated
  in ui-test-onelook §15 (break-tested: removing the section fails the four CSS checks; the capsule and chevron are
  markup and rightly survive).
- **A FIXTURE ON A SCREEN THAT REFRESHES ITSELF IS RE-LAID UNTIL THE SCREEN SHOWS IT.** ui-test-onelook §9/§10/§12
  failed once in CI and one run in six locally: the Inbox's own message fetch, or a data refresh, landed after the
  fixture and repainted the hub/list empty. Each now re-seeds and re-opens (≤5 tries) until the rendered screen carries
  the fixture's own text — a waiting loop, not a weakened check: a real regression still fails its named assertion.
- Re-aimed gates: ui-test-manage (three calendar tools plus the Link-a-platform add row, the review-link row is one
  line, the caption tier, the "Needs a look" gap at 24px, the page called Guest list), ui-test-status / ui-test-intel /
  ui-test-owneraccount (old classes → `data-act`; the hero sub is "9 checks passed"), ui-test-hig (Manage's caption
  is the one tier, sentence case), ui-test-people (rows carry no sub; the reset row and no password box; the
  renamed rows), ui-test-legibility (no explanation line under the editors' captions; §3 now asserts one-line Manage rows with no
  description, the orphan it measured having nowhere left to happen), ui-test-sms (the token's placeholder),
  ui-test-money (the search weeks are a fold row; a deposit card is on the card radius), ui-test-replies (the
  starters are the library, each editable, no caption calling them starters), ui-test-hig (a run of rows on a
  one-look screen ends on the CARD radius; elsewhere the cell's), ui-test-onelook §7 (the outside-the-scope probe
  sits on a guest view now) and **§8** (Payments and Key safes: tools as rows, one caption tier, the named back
  link, an expense as one line in one card, the key-safe list a shadowless card — break-tested on the key-safe
  scope), **§9** (the Inbox: no sentence under the title, the drawn chevron, one conversations card, the chips, the
  empty archive's way back, and the three honest-verdict fixes — each break-tested), ui-test-hig (a run inside an open
  fold is the inset panel on the CELL radius), ui-test-mailbox (no sentence under the title; the declined row's
  buttons found by class, not `btn-sm`), ui-test-hub (the enquiry hub's dock stands down; the plan badge says "Custom"/"Default"), **§10** (the booking and
  enquiry pages: the named back link from two screens, the card radius, the caption tier, the sentence-case tag, a
  filled green Approve on a phone — break-tested on the back link and the content node's scope), **§11** (Today: the
  one switcher, the caption on its row's line, the window's accent Save), §6 (the scope probe on the guest side),
  search-test (the occupancy check went with the function).

## Every page's status is the Manage pill, beside its title (owner-asked)

**Asked for from three screenshots of one idea in three looks** — Today's bookings card header ("✓ Nobody
owes you anything"), Key safes' green words ("✓ All 3 safes are ready") and Payments' tinted panel ("✓ Nothing
to collect") — "instead give them the pill style and position that the Manage status pill has". Every page that
states how it is doing now does it ONE way: `headPill(tone, text, opts)` (admin.js, beside `manageStatusPill`)
renders the Manage pill's own markup (`cron-pill head-pill ok|warn|danger|unk` + `.cron-pill-dot`), a
`<button>` when it leads somewhere (`opts.act`), else a `role="status"` span (`.is-static`, no pointer);
`headPillSet(slot, html)` writes it only when it changed (two memos, the ops-line lesson) and settles a pill
whose words changed. `''` claims nothing. The place is the Manage header's: title left, pill right, centred on
the title's line — `.dashboard-header.settings-head` + `.settings-head-titles` + `.settings-head-pills` on Today
(`#bookings-owed`), Key safes (`#ks-pill`) and Payments (`#mo-pill`); the sub-pages' existing title slot
(`#settings-panel-cap`) and a `.settings-panel-head` row on the Activity log (`#al-pill`, index.html).
- **What each says**: Today — `£X to collect` (amber, taps to the who-owes list; "from N guests" in its
  aria-label) / `Nobody owes you anything` / `Nothing to chase` (owner-arranged money still owed); Key safes —
  `N codes to set` (red when the duty is red) / `All N ready`; Payments — `N overdue` (red) / `£X due now`
  (amber) / `Nothing due yet` / `Nothing to collect` (owed later is not late); Activity log — `N need a look` /
  `All clear`; Calendar sync — `N not syncing` (red, as Manage's feed row) / `N behind` / `None linked` /
  `Up to date` / `Checking…`, and a cottage's page `<Platform> not responding` / `Not linked` / `Synced 2m ago`;
  Reviews, Price ideas, Seasonal rates and Payments settings keep their words in the pill.
- **What went**: the bookings card's status row and its join rules (the list is its own card again; the count is
  the caption's `· 6 upcoming`), `.ks-status`, `#mo-calm` and `__moCalmState`, the Calendar sync summary's mark
  and title (the card keeps the facts and Sync all — hidden when nothing is linked), and the activity week
  card's capsule. **Calendar sync said "All calendars up to date" with 0 of 4 linked** — a claim about nothing;
  it says `None linked` now.
- **The words were cut to fit 360px beside the title** (measured): "4 need a new code" wrapped "Key safes" to two
  lines, so `N codes to set` (aria-label keeps "N safes need a new code"); `Up to date`, `All clear`. The ⓘ on Key
  safes moved beside the title (28px, a 44px region) so the right edge is the pill's. "Seasonal rates" still wraps
  at 360 (fits from 375).
- Gated by **ui-test-onelook §16** (nine pages: the pill present, the Manage pill's classes and look — height,
  corners, type, padding, dot — right of the title on its line at the row's edge, each page's words, none of the
  old looks left), break-tested four ways (a page's pill losing the class, Payments' header losing the row anatomy,
  "up to date" about nothing, a status line restored). Re-aimed: ui-test-simpletoday §5, ui-test-keysafe §2b,
  ui-test-money (calm and overdue), ui-test-manage §3b/§3c and the title-pill reads, ui-test-ownerday,
  ui-test-backoffice-motion §3, ui-test-round8, ui-test-workspace, ui-test-needs-you. NB onelook's fixture
  SERVES §16's booking, because its background refresh empties `dbBookings` and the pill then rightly says nothing.

## One window, wherever the rows are one list (owner-asked, from screenshots)

**Asked for from Payments' "Needs attention" card beside Calendar sync's separate cottage cards**: "give them
the same treatment", sitewide, "regardless of how small". Rows of one kind that stack are ONE joined window —
a hairline between, the card corners only on the run's ends — and a caption names each run. Gated by
**ui-test-onelook §17** (break-tested eight ways) plus re-aims in ui-test-manage §3/§3b and ui-test-keysafe.
- **The generic join** (admin.css one-look block) covers `.sp-need, .sp-off, .ac-card, .settings-sec
  .bhub-fold-grp, .pr-scard, .pr-pcard, .sg-band, .cancel-card, .u-join`. Its top margin is
  `calc(-1 * var(--fold-gap, 0px))`: a container with a flex gap DECLARES it as `--fold-gap` and the join cancels
  it (`.sp-sec` 8px, the content editor 12px). Forcing `margin-top: 0` instead left rows squared-but-apart.
- **Calendar sync**: one "Cottages" caption over one window of rows (`.cal-cot` + a `cot-dot` in the cottage
  colour); failing platforms are their own fold rows under "Needs attention" (`cal-prob`, red "failing"
  capsule); the facts line (`.cal-sum`) shows only when something is linked — "3 of 4 cottages linked" about
  nothing linked was dropped. The list is ONE column at 640px at every width.
- **Key safes**: two or more to-dos are rows of one window under "Needs attention" (`.ks-trow`, the duty's
  severity as a capsule — Set now / Soon / After <time>); one to-do keeps the card with its full-width button.
  A guest past check-in reads "is staying until <date>", never "arrives".
- **Also joined**: the cottage page's Private/Remove rows, Search learning's stats + probe, the expense list +
  its add row, the booking hub's money group with the grid below at EVERY width (docked included), the
  enquiry message with the group under it, Price ideas' two lists, loading skeleton rows, the Status page's
  Needs-a-look rows. The hub's "Needs attention" sits directly under the payask now.
- **A page's first caption sits 24px under its title** (section 24 of the block; flow-root on the hosts whose
  first child's margin collapsed through) — calendar and Payments read 32, the cottage calendar page 8,
  Backups and Text messages 16.
- **Text messages' state is the title pill** (Texts on / Texts off / Not ready / Set on the server / Couldn't
  check), the quiet line under it only when it adds something.
- **The season strip had gone BLANK**: section 12's generic `position: relative` reach rule caught `.sg-blk`,
  the absolutely-positioned blocks, and they painted 0px tall. Removed from that rule; ui-test-manage asserts the
  blocks paint.
- **An auto-docked hub must not take over the screen** (`__hubAuto`): the wide split docks the first booking
  quietly; narrowing below the split used to open it full-screen and hide the + menu (CI caught it in
  ui-test-workspace). Only a hub the owner opened follows the width change.
- NB the probes that found these live in the scratch stack, not the repo: "squared corners but apart" and
  "title→first caption gap" are the two measurements worth re-running after any layout pass.

## The second unified-design pass (overnight, owner-asked: "you may have missed things from previous tasks")

Every admin page was driven on a seeded real stack (staging seat + "Set the stage") at 390 in both themes and at
1280, screenshotted, and measured for the vocabulary (button/caption/window/field signatures) and for cut text.
What it set, so later pages follow it:
- **A CHOSEN CHIP IS THE ACCENT, everywhere.** Payments' filters, the record sheet's chips and the Inbox's
  Chat|Email and stay tabs were white-on-ink while every other chip and switcher used the accent; the one-look rule
  (`.u-btn1` fill, section 8) wins. A count inside a chosen chip inverts (`--accent-ink` ground, accent ink).
- **A ROW'S TITLE IS 500.** Measured across every list: Inbox, Payments, Manage, fold rows and account rows were
  15/500 while Today's booking rows (700), Needs-you (600), key safes (600), the guest list (600), the activity log
  (600) and the composer's rows (600) were heavier. Bold is kept for exactly one meaning: unread mail.
- **`stCap` makes every capsule sentence case** at the one composer ("Not linked", "None yet", "Synced"), since a
  dozen callers wrote lowercase. Suites reading capsule text use case-insensitive matches.
- **The search window's captions are the one caption tier** (sentence case, 600, no tracking) — they were the
  last tracked capitals in the back office, and the HIG note that kept them was written before the dashboard's own
  captions went sentence case. A brief row's duty action reads as Today's does (accent words + the drawn chevron),
  never a filled pill per row (four filled accents in one list is four primaries). Uppercase ratchet 15 → 13.
- **A caption row (`.pay-caprow`) takes its air as PADDING**: a top margin on the caption inside a centred flex
  row sat the caption 8px below the capsule beside it.
- **Small honesty rules**: nothing deducted is `£0.00`, never `−£0.00` (`pmMinus`); a calendar vital with nothing
  linked is grey, not green; "None coming up", not "0 coming up"; money figures are ink (Changeovers had them green
  and amber); a list names the whole cottage ("Pimp" is the timeline lane's short name, not a row's); a stay is the
  house range ("20–24 Oct 2026"), never `→` between two dates; a text arrow on a button is the drawn chevron or a
  label naming the destination ("Open Seasonal rates").
- **Said once**: the booking page's quiet "Record a payment" stands down when the ask above is already Record; the
  Newsletter stops repeating the zero its tile states; Price ideas' two read-only folds are one joined window (each
  had its own `rv-sec`).
- **Permissions**: the people list has a caption (the card sat 8px under the title); your own role is a static row,
  not a one-off box; every back link names the page it returns to ("‹ George", "‹ Permissions"); with one person,
  Cottages & money says the money is yours instead of a one-option switcher and a row of one face per cottage.
- **Layout traps found by looking**: the field rule's `width: 100%` reached a cottage's check-in TIME input and
  squeezed "Check-in from" to a word a line under it (a time keeps its own width beside its label now); the week of
  arrival days wrapped six and a lonely Saturday (one row of seven); the offline pill sat at top 70px right, over
  each page's own right-hand control — below 480px it now sits in the header bar beside the crown (z above the
  header, which is opaque at the top), where the screen name stands down.
- **Empty states**: Guest photos uses the back office's `emptyState` (app.js reaches it through `window`, never a
  bare admin name).
- Inbox and Payments fixes from the re-aimed suites (agents A/B): an email's attachments are links again
  (`mailbox.php?action=attachment`); an empty search says when older mail on the server wasn't searched; the Inbox
  | Done switch reaches 44 through the track's padding (`::before`, inside every clipping ancestor); the reply box
  and Send are 44; a row's context line may take two lines so the dates survive; a sent email found by search opens
  that person's conversation; Payments rows have their hairline back (the row rule reset the border at the same
  weight AFTER the separator rule — order matters at equal specificity); a guest's name wraps whole and a sub takes
  two lines; the detail title wraps rather than ellipsising.
- **layout-test covers the one-list Inbox and the Payments page** (`admin-inbox`, `admin-inbox-person`,
  `admin-inbox-done`, `admin-money`, `admin-money-books`), its money summary generated from money-lib's own
  composers so the fixture cannot drift from the shape the page reads.
- **The last sweep (light theme at 390, dark at 1280, every route)**:
  - The key-safe sheet said "Guest sees it: Now, on their booking page" for a guest staying on a code never set
    for them. The server reveals only a code set for THEIR booking, so the line asks `keysafeSetFor`, not the
    duty state (ui-test-keysafe, the in-residence case).
  - The key-safe duty reads "For <guest>, arriving <date>": the label already says rotate, and the old sentence
    was cut off in the search panel.
  - The calendar's + menu keeps the sync note's hairline as its divider but drops the blank line when the note
    is empty.
  - Backups is three captioned cards (bookings and settings / photos and files / the emailed copy), not one card
    under a caption repeating the title, and its dates are DD/MM/YYYY.
  - The guest list's first tile says what its figure is ("Spent by N guests").
  - ui-test-command's 30-guest confirm is measured after the dialog's settle finishes. A fixed 400ms caught it
    still scaled under CI load (783 of 780px).

## Manage's status is ONE pill (owner-asked: "remove duplication of status", approved demo)

**Supersedes the summary row below.** The status is said once, by `#health-pill` beside the Manage title, its dot
green / amber / red / grey: `Status: all clear`, `needs a look`, `needs fixing`, `couldn't check` (plus `checking…`
until the system check first answers). It replaced the `.mg-sum` card, the `#cron-pill` "Automation quiet" pill
and the `#cron-alert` banner, which between them said one stopped cron up to four times. The pill and the card had
also watched different halves: the pill the full system check (diagnostics.php), the card the ambient stores
(cron, feeds, approvals, teach), so the pill read "all clear" over a card saying "2 things need a look".
- **THE DOT IS THE WORST ROW, and every row it counts is on screen.** `manageVerdicts()` builds the rows under
  "Needs a look" and hands `manageStatusPill(tone)` the worst of them; no rows → green, but only once the system
  check has answered (`window.__diagSum`: undefined while asking, null when it couldn't) AND the bootstrap signals
  are fresh (`chbSignalsFresh`), else grey. A grey pill never becomes green by default.
- **The system check is a row only for what no other row says** (`id: 'sys'`). It fails its own "Daily jobs
  (cron)" check when the jobs stop, which the cron row has already said, so `mgDiagFrom` keeps that check's status
  as `cron` and the row subtracts it. The cron row now says what stops ("guest emails won't send"): the banner's
  one fact worth keeping.
- `checkSystemHealth()` asks diagnostics.php once a session (`chb-health-v2` in sessionStorage, one in-flight
  request) and `loadDiagnostics` (the Status page's own run) refreshes it, so "Check again" there moves the pill.
  `checkCronHealth()` now only tells Today (`__nyCronQuiet`).
- **A limited person gets no pill**: they are never sent the system's state (diagnostics is full access only), and
  `#manage-verdicts` was already hidden for them.
- `.mg-sum` CSS stays: it is the Calendar sync page's facts card (its verdict is the title's pill now). The banner's CSS left app.css (guests paid for it).
- Gated by ui-test-manage §1–§2 (the one pill and no extras; amber for a feed and a review; all clear; the system
  row; stopped jobs red with ONE row; a second failing check still a row; grey both ways; hidden when limited; the
  real fetch folded in), ui-test-needs-you §10 (a dropped bootstrap is grey, a fresh one green), ui-test-hig §2 (one
  pill, no card, and the green dot measured in a state SET UP as all clear: the fixture's own state is red, which
  had made the old card's green-mark check pass without testing anything). Break-tested four ways: the tone, the
  dedupe, grey-not-green and the limited-person rule.

## Manage opens with ONE summary row (the approved prototype, built "exactly as the demo")

**Superseded by "Manage's status is ONE pill" above** (the card is gone; the rows and the cottage list stand).
**Supersedes the pulse + "Running for you" groups below.** `manageVerdicts()` builds `.mg-sum` ONCE and updates it in
place: a mark (✓ ok / ! warn / ? couldn't check — `chbSignalsFresh`, never claiming health it didn't ask about),
"Everything's running" or "N things need a look", and a sub naming what IS fine; it opens Status. Problems are
rows of their own under "Needs a look" (`.mg-fold`, the 0fr discipline): a stopped cron, each stalled feed (its
capsule is `mgRunSync` — spin, re-read admin-bootstrap, the row folds away when fresh), reviews / photos / things
to do waiting (`__nyMod`), and searches to teach. Rows are keyed (`.mg-wrap[data-id]`) so they arrive and leave
animated; the words change at once and only their arrival animates; returning to all-clear redraws the tick with
a one-shot halo. **No green pills and no shouted captions on the landing.** The cottages are ROWS in the Cottages &
pricing group (`#cottages-overview` is `display: contents` inside it): name and "from £x a night", opening that
cottage (the month's booked figure left with the one look, below); the old "Cottages" row became **Add a cottage**
(`addAccommodationPrompt`). Gated by ui-test-manage §1–§2, ui-test-needs-you §10, ui-test-hig §2 (re-aimed).
**THE COTTAGE LIST PAGE IS GONE** (owner-asked: "can this intermediary page be removed, the cottages are listed on
the manage page"). Tapping a cottage on Manage opened the list first and then the cottage, so Back landed on a second
list of what Manage already shows. `settingsOpenAccom(k)` now shows the panel itself (`accomPanelShow`, skipped while
the search sheet hosts the section) and Back returns to Manage; a bare `settingsOpen('accom')` (search's "Cottages",
help topics' "Open Cottages", old history entries) lands on the Manage index; REMOVED cottages are rows on Manage
too ("Removed from the site · tap to restore"), each opening its own page where Restore is; private/remove/restore
repaint in place (`accomAfterChange` — a removed cottage returns to Manage); `renderAccomList`, `cottageRowsHtml`,
`accomAddRowHtml` and `#accom-list` are deleted, and the rail's **Cottages** row went with the page (it opened the
list; Manage stays current on a cottage page). Shipped without running the suites, at the owner's ask:
ui-test-railspine (six rows, Manage current on a cottage page) and layout-test's admin-accom scene were re-aimed
but not run.

## Manage leads with VERDICTS above the untouched toolbox

`manageVerdicts()` (admin.js → `#manage-verdicts`, first child of the settings
index; spans both desktop columns). A pulse line, then EXCEPTIONS (a stopped
cron; each troubled feed with why-it-matters + `runSync` one tap inside the
fold), then Running-for-you groups — **System check** (only what is ambiently
KNOWN: daily jobs + feeds; backups/push/payments belong to the full check,
which asks), **To approve** (`__nyMod` counts; `openArea()` now fire-and-forgets
`refreshModerationCounts()` so the counts are fresh on open — its tail
re-renders the verdicts), **Your assistant** (`chbMissList` + `slGuestQuestions`).
Every figure reads the store its existing badge/pill reads — `chbFeedTrouble()`
is shared with the search foot and the Today duty, so breaking its threshold
fails the landing's own gate (proven in the break-test). The toolbox rows
below are untouched. **Calendar feeds** (`renderCalendarList`) is one verdict
fold group per cottage — freshness capsule from `__feedStatusPre`, Run-the-sync
+ the feed-link editor inside the fold, the per-cottage editor unchanged behind
`settingsOpenCalendar`. Gated by **`ui-test-manage.js`** (threshold + calendar
tone break-tested).
**Search learning + Website content wear the anatomy too.** The four teach
lists (`renderSearchLearning`) are verdict fold groups — waiting teach-work an
amber capsule quoting the top miss, the reference lists grey counts, the
status card + probe above as the page's pulse; teaching the last dead-end
flips the capsule green (gated both ways). `loadContentEditor` is two groups
(Images / Text & wording) counting the real fields, every `ce-<key>` id
unchanged inside the fold so `contentEditSave`/`contentEditImage` and
poorsignal's direct calls work untouched. Gated by ui-test-search-learning
(capsule + fold checks re-aimed) and ui-test-manage §5, break-tested.
**The cottage page is fold groups with the REAL editors inside**
(`settingsOpenAccom` — the 13-section menu→subpage hop is gone; each
ACCOM_SECTIONS entry is a `bhub-fold-grp.ac-card` whose fold holds
`accomSectionHtml(k, s.id)` unchanged, so every editor id, save button and
in-place refresh (`accom-photos-<k>` etc.) works inside the fold). Verdicts
only where a real one is cheaply derivable — the photo-count capsule and the
nightly rate as a serif figure; **the client rate field is `coupleRate`
(camelCase), not the server's `couple_rate`** — inventing the rest would be
claims. `settingsOpenAccomSec(k, sec)` is a DEEP LINK now: render the page,
open that fold, scroll to it — so every existing route (help topics, search
dossiers, keysafe's Settings link) lands on the working editor. Two traps,
both gated in ui-test-manage §4: `.ac-card` needs
`scroll-margin-top: calc(100px + var(--safe-t))` (the app.css anchored-scroll
pattern) or block:'start' buries the fold row you just opened UNDER the fixed
header (caught on the build's own screenshot).
**The RATES section is the REFINED editor** (owner-approved demo, three
rounds): captioned wells (Your price / Weekends & last minute / Deposit & fee
/ Book-direct badge), every control a stepper on the RIGHT RAIL (`acrStep`,
typing rides `acrType` → the SAME `updateRate` instant-save), serif money,
and live consequence lines via `acrSync` that must QUOTE THE MODEL: the
weekend figure is `nightlyRateFor`'s own maths and the badge is
`renderLocalGuide`'s exact string — gated by EQUALITY OF DERIVATIONS in
ui-test-manage §4b (9 checks; weekend/stepper/badge each break-tested).
Three traps: `saveContent` never writes the `siteContent` mirror, so `acrOta`
mirrors FIRST or the badge preview lags one edit behind (caught by the gate's
first run); the rates fold body is FLAT (`.acr-body`) because wrapping it in
the `.rate-prop` glass panel spent 26px a side and starved the labels
(measured on the build's own screenshot); and `.acr-badge` is ink + outline
with NO accent tint under `--accent-text`, so a11y §1b never meets an
unmeasured pair. `acrSync` repaints derived TEXT only, never inputs — a
re-render mid-keystroke is the bank-details trap.
**AND EVERY OTHER SECTION WEARS THE SAME VOCABULARY** (approved 11-section
demo; PR-A = the ten field/list sections, PR-B = photos grid + home-card
preview). Captioned wells (`.acr-cap`/`.acr-well`), label-above field rows
(`.acw-frow`), quiet sentence-case action rows (`.acw-acts`), pill time
fields, day CHIPS (the checkbox fills its label — the chb-switch trick — so
`toggleArrivalDay` fires untouched), steppers on min/max nights
(`ruleStep` → the SAME `updateRuleField` save) and occupancy (`occStep`
bumps the INPUT only — "Save guest limits" stays the validated write), the
location pin as a status capsule, seasons as label + DD/MM/YYYY +
serif-£/night rows, and fold VERDICTS counting only stores already in hand
(features/safety/seasons/faq/welcome/pin/arrival — an unloaded mirror mints
no claim). The shared row composers (`listRowHtml`/`faqRowHtml`/
`welcomeRowHtml`) kept their classes + data-attrs and are FLATTENED by
CSS scoped under `.acr-well`, so every add-row handler and collect
function is untouched. Gated by ui-test-manage §4c (7 checks; the stepper
write, the day chip and the verdict counts each break-tested).
**PR-B: photos are a GRID and the home-page card previews the real tile.**
`accomPhotoRow` (app.js) renders a grid CELL — MAIN badged on the first,
order number, the four actions as compact glyphs — same classes and
data-acts, so `accomSavePhotos`' re-render keeps reorder/replace/remove
working. NB `.acp-cell .acp-acts` is (0,2,0) ON PURPOSE: app.css's
`.content-edit-row .accom-photo-actions` sets `flex-wrap: wrap` and wins at
equal specificity — measured, the ✕ wrapped onto its own line in every cell.
The web section's inputs ride `chbInput('acwCardSync')` (an inline
`oninput=` is CSP-blocked — the invoice-print lesson) into a live tile
preview, and `acwCardSave` writes BOTH card keys through `contentEditSave`.
Gated by ui-test-manage §4d (5 checks; the preview-follows and MAIN-badge
each break-tested).
**THE SETTINGS PAGES WEAR IT TOO** (approved realistic 22-page demo; batch 1 =
switch sheets + settings forms). ONE re-skin converts every `.accounts-stat`
INSIDE `.settings-sec` into the unified well — the Money screens'
`.accounts-stat` (gated `.headline`) live outside `.settings-sec` and are
untouched. Every on/off is the keeper's `.chb-switch` on its REAL checkbox
(notify categories, sms-on, 2fa, chat-away, both follow-up nudges — ids and
save paths byte-identical); quiet/available hours are `select.acw-pill`s; the
Payments deposit % is an `occStep` stepper (bumps the input only — Save stays
the write, the guest-limits model). Gated by ui-test-manage §6 (6 checks;
the notify switches and the deposit stepper break-tested).
**Batch 2 — moderation queues + people lists**: the pending-review items are
moderation rows (`.acw-qrow` + `.acw-modacts` verdict pills, the star line in
accent-text, the waiting state a capsule); Waitlist and Guest accounts are
person-rows in one well (`.acw-prow` — the guest leads, facts as the sub,
state/lifetime-spend on the right; Guest accounts DROPPED its
sideways-scrolling 5-column table, keeping the data-gemail hooks and both
actions, Reset password still only where an account exists); Instant chat
answers is one well of labelled boxes with the default as placeholder and the
saves-by-itself whisper. Gated by ui-test-manage §7 (5 checks, fixture-fed
waitlist/guest_crm routes; the Waiting capsule's tone and the verdict pills
each break-tested).
**Batch 3 — the data pages join by FRAMING, not rebuild**: Pricing's section
labels take the caption vocabulary, and the pages already carrying gated
verdict structures from earlier overhauls (Status's hero, the activity feed,
the cancel radiogroup, Analytics) were converted by the `.accounts-stat`
re-skin alone. Gated by ui-test-manage §8. That completed the approved
22-page demo; the seasons grid it framed was then REBUILT outright (below).
**SEASONAL RATES ARE SEASON CARDS** (approved demo; `seasonCardHtml`/
`renderSeasonGrid`/`sgSync` in admin.js, `.sg-*` in admin.css — the old
`.sg-table` CSS left app.css entirely, guests stop paying for it). One card
per season: serif name + remove ✕ in the head, dates as pills, a £-pill row
per cottage, a foot NAMING who keeps their base rate (a silent empty cell
reads as an oversight), a sticky save bar counting unsaved changes, and
cards flow two-up ≥901px. `saveSeasonGrid` kept its per-cottage save loop +
partial reporting (iterating `.sg-band` divs now — poorsignal §9's fixture
injects that shape, a `<tr>` in a div body is parser-stripped). Traps, all
gated in ui-test-manage §8 and break-tested:
- **The dates open the BUILT-IN calendar, never a native input[type=date]**
  (owner-asked). `openFieldDatePicker` gained `admin: true` — dpMode 'admin'
  with a dpTarget: past dates pickable (a running season's start is one), no
  guest rules, no per-cottage prices/crosses (`modalStayConflicts` is only
  consulted when there is NO target — the modal's cottage means nothing on an
  all-cottage band, and the legend says '' because nothing is crossed), and
  dpDone routes admin-with-target through the FIELD write. Optional target
  words: `startHint`/`endHint`/`bothMsg`.
- **A season's end date is INCLUSIVE** (`coupleRateForNight`: start <= night
  <= end), unlike a checkout — the card counts `nightsBetween + 1` ("July
  01→31" is 31 nights) and the picker takes `inclusive: true` so its own
  hint cannot state a different number (both sides break-tested).
- **A HIDDEN input's `.value` writes the ATTRIBUTE** (spec "default" mode),
  so `defaultValue` moves with it and a defaultValue-based change counter
  never fires for the picker's write — the date fields carry `data-orig`
  instead (measured; the visible inputs stay on defaultValue).
- **A foot note asserted by textContent is vacuous** — break-testing found
  the check green with the foot `display:none`; the gate reads it only when
  painted.
- The price input needs `min-height: 40px` INSIDE its 42px pill or a11y §5
  fails it at 21px (the pill is not the control; the input is).

## The Inbox is ONE LIST OF PEOPLE (the approved "One Inbox" demo, built without CI at the owner's ask)

**Supersedes the three-answers section below and the folder switch.** Enquiries, guest chat and email
are one row per PERSON, their conversation in time order across every channel, the stay beside it.
Code: the "THE INBOX IS ONE LIST OF PEOPLE" block in admin.js (`ib*`), `#ib` in admin-views.html,
the matching block at the foot of admin.css. Gated by **`ui-test-inbox.js`** (37 checks).
- **IT READS THE STORES, IT DOES NOT OWN THEM.** `enquiries`, `__msgThreads`, `__mbxMessages`,
  `__mbxSent`, `__declinedEnq`, `bookingEmailLogs` and `dbBookings` are still filled by their own
  loaders (renderInbox, loadAdminMessages, loadMailbox, loadBookingEmailLogs); each calls `ibSoon()`
  and the render coalesces to one frame. Their old list markup sits HIDDEN in `#inbox-legacy`
  because `loadAdminMessages` returns before setting the store when `#messages-list` is absent,
  and the badges, search and notifications still count from those stores. `inboxFolder()` is a shim:
  every caller that asks for a folder lands on the one list. `#inbox-detail-pane` is gone, so
  `inboxSplitWide()` is false and the enquiry hub always opens as its own page.
- **ONE ROW PER PERSON, never by a name** (`ibKeyOf`: email, else phone — chbCustomerKey's rule).
  An address that matches nobody but whose display name matches one guest exactly is an
  `unlinked` row with a "Yes, this is X" card; the link is stored, never inferred.
- **KINDS**: guest (booking, enquiry or declined enquiry), auto (`IB_AUTO_RE`: no-reply family,
  platforms, payment processors — quiet, never waits, no reply box), unlinked, lead (stay words in
  what they sent), other.
- **WAITING IS WORKED OUT**: a pending enquiry, a "write to them?" after a decline, a reminder that
  came back, or they spoke last and nothing cleared it. Staying guests first, then the longest wait.
  **THE FIRST OPEN DRAWS A LINE** (`inbox-state.since`): mail and chat already READ before the new
  Inbox existed do not wait, or launch would have filled the list with old mail answered elsewhere.
- **THE OWNER'S RECORD is the internal content key `inbox-state`** {since, done, remind, reminded,
  unread, cleared, links} — classified in db.php, allowed for everyday staff in people-lib, riding
  the admin boot payload as `inbox` (`window.__inboxStatePre`) like `duty-dismissed`, saved
  mirror-first on a chain (`ibStateSave`). **NOTHING IS SAVED BEFORE THE BOOT PAYLOAD HAS ANSWERED**
  (`ibStReady`): the dock count asked for the record early, read it empty, wrote the first-open line
  and so replaced every saved Done with nothing — reloaded Done rows came back. An early change is
  laid over the stored record when it lands; a payload OLDER than this page's last save (`at`) is
  ignored, so a refresh in flight across a save cannot roll it back. Done holds until they write again; drafts are per device
  (localStorage `chb-ib-draft:<key>`).
- **A REPLY OR AN APPROVAL WAITS FIVE SECONDS with Undo on the message** (`ibHoldInline`); leaving
  the page sends what is waiting (pagehide / hidden), never loses it. A failed send puts the words
  back and says so. Routes: chat → messages.php `send`; email → bookings.php `email_guest` for a
  booking, enquiries.php `email_guest` for an enquirer, else mailbox.php `send`. The approval is held
  as `__ibApproving` so the person keeps their row inside the window.
- **ONE FIGURE**: `enquiryAskFigures(e)` was lifted out of renderEnquiryHub so the Inbox's Approve
  and the enquiry page quote the same deposit (or the full amount inside the balance window).
- **ONE NUMBER**: the dock pip and the rail say people waiting (app.js `inboxCount()` →
  `ibWaitingCount()`), no longer unseen enquiries.
- **Server**: mailbox.php `list` adds a `preview` (TOP 40 lines, the parser, quoted history and
  signatures dropped, never fatal); `sent` returns 200 rows; enquiries.php `email_guest` writes the
  sent log so the reply shows in the thread.
- **Layout follows the room the Inbox has**, not the window: `ibLayout` sets `is-wide` (880px) and
  `is-triple` (1180px) on `#ib`. On a phone the conversation is fixed below the header
  (`--ib-top`); the toast is placed where it covers nothing (`ibToastPlace`).
- **Markup uses `data-ib`, never `data-act`**, and `ib-` classes, so the app's dispatcher and the
  one-look restyler leave it alone.
- **A refresh button sits beside the status pill** (`#ib-refresh` in `.ib-head-r`, the Payments + circle's
  shape). The header is outside `#ib`, so `ibRender` wires it directly. `ibRefresh()` asks everything again
  at once: `loadData()` (bookings, enquiries), `loadAdminMessages()` (chats) and `ibLoadAll(true)` (the
  mailbox, declined enquiries, archived chats, email logs; it now returns its promise). The arrows turn for at
  least 600ms, then show a green tick for 1.4s. A failed `loadData` says "Couldn't check for new messages"
  rather than leaving the old list looking current. Checked by a throwaway browser drive at 390 dark and 1280
  light; no suite asserts it.
- **MAIL FROM OUR OWN ADDRESS IS HIDDEN ONLY WHEN THE SITE WROTE IT** (reported: an email George typed on his
  iPhone from info@ to info@ never reached the Inbox). `mailbox_is_self_notification($from, $head)` used to hide
  everything from MAIL_FROM. The owner's phone sends as that same address, so his own test emails were hidden. So were
  his emailed replies to guest-chat alerts: the reply poll dropped them as "self-notification", and they never reached
  the chat. It now asks `mailbox_is_site_sent($head)`: the `X-CHB-Origin: site` header (smtp_transmit writes it on
  every send from now on), or, for mail already in the box, smtp_transmit's own `chbalt_`/`chbmix_` boundary or its
  24-hex / `msg.<token>` Message-ID. It reads top-level headers only, so a forward of an alert is not "ours". The
  mailbox list also sets aside an owner's emailed reply that the poll routes into a chat (an owner token + a sender
  on the allow-list), because the chat already shows it. Earlier replies that were dropped stay unposted. Gated by
  test-reply ("The site's own mail, by its fingerprint", break-tested on the rule and the marker), and driven once
  through the real `mailbox.php` list and the poll's debug trace against a fake POP3 mailbox: before the fix 1 of 5
  shown and the reply dropped, after it 2 of 5 and the reply delivered.
- **DONE IS A FOLDER** (approved demo, built without CI at the owner's ask). An Inbox | Done switch
  (the one switcher, its accent pill travelling on `--sheet`) sits under the search; `__ibFolder`
  decides what `ibRenderList` shows. Inbox = Waiting / Earlier / Reminders, a calm card when nothing
  waits; Done = every `ibDone` person under MONTH captions (`IB_MONTH`, by last message), paged by 60
  ("Show older"), no Done capsule per row — the capsule shows only in SEARCH results, which reach both
  folders while the switch steps aside (`is-away`). `ibSetFolder` crosses the list (8px out, 14px in
  from the folder's side, stamp-superseded, cancelling the held fade-out in the same task or the list
  stays invisible); `ibFoldAway` folds a leaving row before the rebuild (a phone slides the
  conversation off first, 360ms); `ibMoveBack` + a swipe in Done + E return a row; `ibNudge` settles
  the destination label. The folder is a place (`inbox:done` in chbOpenTarget/inboxRemember); a
  width change must not reset it, and `ibOpenWhen` lands in the person's folder. Gated by
  ui-test-inbox §8–§9.
- **DELETE CONVERSATION is the last item of the ⋯ menu** (`ibDeletePlan` decides, `IB_ACT.delete`
  acts). It asks first (`glassConfirm`, danger) naming what goes, and has **NO Undo** — the
  mailbox cannot restore a deleted email. What GOES: their chats (messages.php `delete`), the
  emails they sent (mailbox.php `delete` with a `uids` list — one POP3 session, missing uids
  skipped), the emails sent TO them (mailbox.php `delete_sent` → `mail_sent` rows) and their
  pending and declined enquiries (enquiries.php `delete`, a hard delete). What STAYS: bookings and
  the emails about them — with a booking left the person is marked done. Nothing is sent to the
  guest. Hidden when only a booking is left (nothing to delete) and during an approval's Undo
  window. The three new actions are `'all'` in PEOPLE_POLICY. Gated by ui-test-inbox §7.
- **Re-aimed to the one list since** (the overnight CI pass): ui-test-mailbox (rewritten — rows, reading,
  reply routes, the decline ask, attachments as links), ui-test-emailreader (reading inside the conversation),
  onelook §9, needs-you (the enquiry duty lands on the conversation; the Inbox pip counts people waiting),
  resume (`inbox:done` is the folder place; the Sent tab memory is gone), hub, ownerday, reach (the Inbox | Done
  switch) and round8 (the context line).

## The Inbox is THREE ANSWERS below 1200px — and the wide three-pane is untouched (SUPERSEDED by the one list above)

Stacked, the folder switch hides and each folder becomes a verdict fold group
(`#inbox-landing` in admin-views.html; summaries by `inboxVerdicts()`, which RIDES
`inboxSubline()` — and must run ABOVE its declined early-return, or the drawer freezes
the landing's counts: shipped that way for one gate-run, caught by the new gate).
Gated by ui-test-mailbox §10 (each break-tested; a dead fold-opener kills the suite at
its own click).
- **The folder divs re-parent INTO the folds** (`inboxLayoutSync`, the
  `#booking-hub-content` trick) so every list, gate and handler is untouched;
  `inboxFolder(which)` stays the ONE switch — stacked it opens that fold (accordion)
  with the SAME display toggling the wide layout uses, so restore targets
  (`inbox:email:sent`), the dock and every caller work unchanged. `ivToggle` closes an
  open answer on the second tap. Crossing 1200px live re-seats the divs (matchMedia
  change listener). The folder h2s hide inside the landing (CSS) — the FOLD LABEL is
  the visible heading and renderInbox renames it "Declined enquiries" with the tab.
- **The verdicts read the stores the badges already read** (enquiries.length, the
  `ifold-count-*` chips, `__msgThreads`/`__mbxMessages`), so the four surfaces cannot
  disagree. The Email verdict says "tap to check the mailbox" until the lazy first
  fetch — inventing "nothing new" before asking would be an unchecked assertion.
- **Exceptions**: enquiries past `ENQUIRY_STALE_DAYS` are red fold rows in `#iv-attn`
  with Open + ✨ Draft under them; the mapper's timestamp is **`received`**
  (date-only) — `createdAt` does not exist on the client shape.
- **The destinations wear the anatomy too**: the chat thread's guest context folds
  CLOSED with a paid-state pill on the summary (app.js `openMessageThread` — the
  conversation is the work); the email reader's guest-match is a verdict row
  ("Their booking · Paid in full ✓" via `bookingDue`) with the hub chips folded, and
  the chain folds behind "Earlier in this conversation · N emails" (`.mbx-ctx-d`).
  The declined drawer KEEPS its gated row anatomy (#164) and gains the one new fact —
  "dates still free / now taken" as words on the dates line, NOT a third pill: a
  third pill at 390px squeezed the cottage name to 24px and the drawer's own gate
  caught it.

## Amenities are a tab on the guest's stay, and a section of their own

**Asked for**: an Amenities tab on the customer page where "Things to do" sat, with
Things to do moved past Contact host. The data already existed and had exactly one
surface — the pills on the cottage page — so a guest could read what the cottage has
while BOOKING and not while staying in it.
- **ONE STORE, both surfaces.** `guestAmenityList(propKey)` (app.js) and
  `accomAmenityList(k)` (admin.js) read the same `amenities-<k>` content key with the
  same `propertyContent[k].amenities` fallback the cottage page uses — so the sheet a
  guest opens from their stay and the pills they read while choosing cannot differ, and
  the fold's count cannot disagree with the rows inside it. Read-only on the guest side;
  there is no second store and no second editor.
- **The tile is on BOTH My Stays hubs** (pre-arrival and in-residence) — "what's in the
  cottage" is a question with a shorter fuse once you are in it, not a longer one — and
  the pre-arrival ORDER is the ask: Directions, Good to know, Welcome book, Amenities,
  Contact host, Things to do. Gated as an order (ui-test-yourstay §32), not as presence.
- **THE PILLS FLOW, they are not a grid.** `repeat(auto-fit, minmax(150px, 1fr))` is one
  column inside a 296px sheet on a 402px phone (two tracks need 308), so every short
  amenity took a whole row of a narrow sheet — measured on the build's own screenshot.
  `flex-wrap` with `flex: 0 1 auto` lets three short ones share a line and "Off-street
  parking" take what it needs.
- **An empty list names a person, never the cottage.** "No amenities" is a false claim
  about the COTTAGE where the true one is about our own list — the faq-modal rule,
  break-tested.
- **Manage: its own section** (`ACCOM_SECTIONS` id `amenities`, between Text & details
  and Home page card). The well moved out of `case 'text'` whole — same
  `#accom-am-rows-<k>` host, same `accomAddAmenity` / `accomSaveAmenities` — and the
  fold verdict moved with it ("✓ 5 amenities"). **The one thing the move broke and the
  gate caught**: `accomSaveAmenities` reported into `#accom-text-msg-<k>`, which was
  fine while the two shared a section and became a save reporting into a DIFFERENT,
  closed fold the moment it did not. Its own `#accom-am-msg-<k>` now.
- Gates: ui-test-yourstay §32 (order, the sheet, the empty state), ui-test-manage §4c
  (11 welled sections, the verdict) + §4e (its own section, Add+Save through the real
  endpoint, the message slot), ui-test-guest-modals (the sheet joins the Back-closes
  sweep). Three break-tests fired: the order, the message slot, the empty state.
- NB the backdrop-click handler folds all three sheets into ONE `instanceof Element`
  narrowing — a third copy of `e.target.id` would have ADDED a type error; folding
  removed two. tsc budget 728 → 726.

## House rules take the "Good to know" tile, and get a section of their own

**Asked for after a screenshot of that sheet EMPTY on the customer's own screen**: a
cottage with no FAQs written up opened "Good to Know — Pimpernel" with nothing in it.
House rules cannot be empty — check-in, checkout and the guest limit are facts every
cottage has — so the tile now opens something that always answers.
- **ONE DERIVATION, both surfaces.** `guestHouseRuleList(propKey)` (app.js) is the three
  AUTO lines from the booking rules the cottage really enforces, then the owner's own
  `houserules-<k>` list. `renderHouseRules` (the cottage page) was rewritten to read it,
  so a guest cannot be told one checkout time while choosing and another while staying —
  ui-test-yourstay §33 asserts the sheet EQUALS it rather than re-listing the lines.
- **The FAQ is not lost, it is moved off a dead end.** `openFaqModal` keeps its button on
  the cottage page (booking-time Q&A) and the chat's on-device `guestFaqAnswer` still
  answers a typed question during the stay. What went is the TILE that opened an empty
  sheet.
- **A rule is a SENTENCE; an amenity is a NAME.** `.hr-line` is a hairline-separated list
  that wraps, where `.amenity-sheet` flows pills — the two sheets sit one tile apart and
  deliberately do not share a layout.
- **THE OLD "House rules" SECTION WAS NAMED FOR SOMETHING ELSE.** `ACCOM_SECTIONS`
  `house` held check-in/out times, min/max nights, arrival days and guest limits — the
  functional BOOKING constraints — with the rules well buried at its foot. It is
  **"Times & limits"** now (display-only, the id stays `house`, so every deep link, help
  topic and search route still resolves) and `houserules` is its own section carrying the
  same rows host, add and save actions.
- **The new section QUOTES the auto lines read-only**, from `guestHouseRuleList` itself:
  an owner who cannot see that checkout is already stated writes "check out by 10" as a
  fourth bullet and the guest reads it twice. Gated as EQUALITY with the guest's list.
- **The verdict counts the OWNER'S rules only** — counting the auto lines would make
  every cottage read "3 rules" whether the owner had written any or not, a claim about
  nothing (break-tested). And it never says "none yet": the auto lines mean a guest
  always gets an answer, so the honest empty state is silence.
- **Search learned the split too** — "edit house rules" routes to `houserules`, and a new
  action carries check-in/limits queries to `house`. Asking for the rules used to land on
  the times panel with the rules a scroll below.
- Gates: ui-test-yourstay §33 (the sheet, the enforced times, the shared derivation, the
  never-empty case) + §32's order line, ui-test-manage §4c (12 welled sections) + §4f
  (its own section, the quoted settings, the verdict, Add+Save through the real
  endpoint), ui-test-guest-modals. Break-tests fired on the shared derivation and the
  verdict's count.
- **AND THEY RIDE THE ARRIVAL EMAIL** (asked for). They reached the guest twice — the
  cottage page while choosing, the tile while staying — and not in the one email read on
  the way. **Resolved by the SENDER**, `arrival_email_payload` → `arrival_house_rules`,
  and passed down on the payload: `arrival_email_body` is one of the PURE composers and
  a `content_value()` call inside one breaks every gate that drives it with no database
  (the `email_host_name()` rule).
  - **Only the owner's OWN list travels.** The three auto lines are NOT repeated — the
    Arrive/Leave rows above already state the times, and saying one fact twice in one
    email is the defect the double-greeting sweep had just finished closing. And there
    is no fallback to `DEFAULT_HOUSE_RULES`: "please treat the cottage as your own home"
    under a heading reading *House rules* is filler in an email read once.
  - **NOT `email_note`.** The tinted accent callout directly above the button is "your
    entry details" — the thing this email needs the guest to ACT on — and a second
    identical block under it makes two shouts where the design system means one. Rules
    are reference, so they sit in the flow as `email_p` at body ink. Caught by looking at
    the rendered email, not by a gate.
  - Sanitised at BOTH ends (a hand-edited content row cannot put markup or a non-string
    in an inbox; capped at 12, the full list always being on the stay screen), escaped at
    the boundary, and the review composer's facts panel NAMES them so the owner does not
    type them into the message as well.
  - **THE COMPOSER GATE CANNOT SEE THE WIRING** — break-tested: deleting the `rules` line
    from `arrival_email_payload` leaves test-emails-render §10 fully green, because it
    drives the builder with rules already on the payload. test-integration §23 saves real
    rules through the real endpoint and reads them out of the real rendered email; that
    is what fails. Second time in two days this shape has bitten (the arrival preview
    route was the first).

## What the cottage HAS and what guests AGREE TO, where they are needed

Two per-cottage stores (`amenities-<k>`, `houserules-<k>`) had display surfaces and
nothing else could see them. Found by asking who reads the keys — the answer was
"only the four renderers". (The AI chat's `cottages` tool also read them; it was
removed with the chat.)
- **THE GUEST CHAT'S ON-DEVICE ANSWERER GAINED A SECOND TIER** (`guestFactCorpus`,
  consulted only when `guestFaqCorpus` abstains). A rule is ONE entry each — "no
  dogs, sorry" answers the dog question and the quiet-hours rule answers another —
  while the amenities are ONE entry per cottage, because answering "is there a
  dishwasher?" with the single word "Dishwasher" is a worse reply than none; the
  list, led by what they asked about, is an answer. **The ordering is the whole
  safety story**: a written answer can never be outscored by a derived one, so this
  can only turn a silence into an answer. Break-tested by inverting it, which fires
  the parking check.
- NB a check phrased "what TIME do we need to be quiet" tests the wrong thing — it
  hits the built-in check-in/checkout topic on the word *time* and the written
  answer wins BY DESIGN. Phrase a tier-2 assertion so it reaches tier 2.

## The House Rules were a defined term with teeth and no document

Clause 3 says follow them; clause 8 lets us cancel with **no refund** for seriously
breaking them — and clause 1 defined them as *"a short separate document we send
with your confirmation"*, which does not exist and never did. The contract could
end a stay over a document nobody was ever sent.
- **The definition is GENERATED per cottage** (`termsHouseRules`, the mechanism
  `termsSecurityDeposit` already uses) and names where they really are: the
  cottage's page, and the arrival email before you travel.
- **The rules THEMSELVES sit in clause 3**, directly after the sentence that tells
  you to follow them (`houseRulesClauseParagraphs`) — a term you agree to should be
  readable where you agree to it.
- **Only the owner's OWN rules**, not `guestHouseRuleList`'s — the gate caught the
  first version restating "Check-in after 15:00" as a house rule, which clause 1
  already defines and the confirmation already states. Same line the arrival email
  draws, and no fallback to `DEFAULT_HOUSE_RULES`, whose two courtesies clause 3's
  own opening sentence already covers. Nothing saved → clause 3 says nothing.
- **The Confirmation definition claimed to carry "directions and the House Rules"** —
  those travel in the ARRIVAL email. Corrected, and both literals are now LABEL-ONLY
  in `termsSections` so the dead copy cannot drift back.
- `TERMS_VERSION` 2026-08a → **2026-08b**.
- Gates: ui-test-terms §5b/§5c (the absent document, the generated definition, the
  corrected confirmation, the rules in clause 3 and their placement, the empty
  case) and smoke-test's guest-FAQ block (7 new). Break-tests fired on the corpus
  precedence and the clause-3 wiring.

## The guest's invoice: ONE document, two presentations

**AND IT IS MODERN, not a letterhead** (asked for as *"still looks like an old style
invoice"*). Three things were carrying the traditional register, and they were carrying
it on BOTH surfaces because the two share one anatomy: the **centred** crown-over-brand
masthead, the **serif** money figure, and **uppercase letterspaced** captions. All three
are gone. Everything is now left-aligned against one rail; the figure is the grotesque
at 46px/32pt with a −0.035em track and tabular figures; captions are sentence case at
600 weight, so hierarchy comes from size and space rather than tracking; the ground is
WHITE (the linen and every card fill went with it) and the accent is a 3px rule at the
very top instead of a slab. The serif survives in exactly one place — the business NAME,
as the brand's signature. The INKS are untouched: they are the email design system's and
§6 asserts the pair, so modernising the layout could not regress contrast.
- **The rows lost their cards.** A row is one hairline above it and a total is a heavier
  1.5px rule; the meta blocks are a two-column grid collapsing at 520px. `.kvs.one` is
  the single-party variant, because a lone `.who` in a two-column grid leaves half the
  row empty.
- **AIR IS WHAT MAKES IT MODERN AND A ONE-SHEET INVOICE MATTERS MORE.** The first pass
  at the airier rhythm pushed even the SETTLED case onto two pages (row 27→ sub 12→ gap
  22). The values shipped are the tightest that still read as space rather than a
  ledger — row 25, foot 29, sub 11, gap 17 — and the settled case is one sheet again.
  The bank-rail case (one extra group) still runs to two and breaks correctly.
- **Two assertions had to be re-aimed, not patched:** "print gives every card a hairline"
  described chrome that no longer exists (the check now asserts there is no card chrome
  to undo, and that a row is one hairline while a total is heavier), and the 44px floor
  check pinned `min-height:44px` where the modern control is 46 — it reads the number and
  compares now. And ten of the PDF's checks named UPPERCASE captions; sentence case is
  the point of the change, so they follow the page's vocabulary.
- NB `.vh` (the visually-hidden document title) was used in the markup before it was
  defined in the stylesheet, so the `<h1>` would have painted at browser-default size.
  Nothing else would have caught it — the gates read text, not type size.


`invoice.php` is the page the guest files and may show an insurer, and
`render_invoice_html()` has always been PURE and unit-testable while nothing unit-tested
it — so three things shipped on it. Gated now by **`test-invoice.php`** (85 checks: the
deposit states, the money, contrast by arithmetic, the affordances, the ink lockstep).
- **A KEPT DEPOSIT WAS DESCRIBED AS "returned in full after checkout".** The HTML invoice
  had ONE static sentence for every state while the owner's PDF said "Retained after
  checkout for damage or loss" about the same money — one booking, two documents, opposite
  claims, and the guest's copy was the wrong one. `invoice_deposit_status()` is the PHP
  mirror of app.js's `depositInvoiceStatus`, and **both are driven by
  `invoice-deposit-fixtures.json`** (the `pricing-fixtures.json` pattern: add a case to
  the JSON, never to either test — test-invoice §1 and smoke-test both loop it).
  Rendering them together also caught **`captured`**: a LEGACY card hold that was
  captured means the money was taken, and it sat in the holds branch reading "held on your
  card (not charged)" while `$depositCharged` and `damages_collected()` both already
  counted it as collected. One sentence disagreed with the rest of the app.
- **A REFUNDED DEPOSIT WAS DELETED FROM THE PAGE.** `$damages = 0` for
  returned/released is right for the ARITHMETIC (the money went back, so it leaves the
  total) and was applied to the DISPLAY as well, so nothing recorded that £75 had ever
  been taken or given back. **Display and arithmetic are different questions**: `damages`
  is what is still in the total, `deposit_amount` is what the deposit WAS and never goes
  to zero. The state rides as a chip at the top too (Deposit returned / Deposit retained).
- **AND THE ONLY CONTROL ON IT HAD NEVER WORKED.** `onclick="window.print()"` — the
  site's CSP is `script-src 'self' 'unsafe-eval' 'sha256-…'` with **no 'unsafe-inline'
  and no 'unsafe-hashes'**, so an inline event-handler ATTRIBUTE is blocked outright. The
  handler is now a hashed inline `<script>` (`INV_PRINT_JS`, the pattern index.html's
  theme-boot script already uses); test-invoice hashes that constant and fails if the
  policy doesn't carry it, so editing the script TELLS you to update the header. A CSP
  edit is a cached asset — `node bump.js` (see the deploy checklist).
- **THE LEDGER RECONCILES, and the trap is that `payments.amount` is RENTAL-ONLY.**
  pay.php charges rental + the refundable deposit as ONE Square payment and records only
  the rental part, so listing the rows raw leaves the Payments card £75 short of its own
  footer AND smaller than the guest's bank statement. The carrying row (matched on
  `hold_payment_id`) is shown at the sum the CARD took with "includes the £75.00
  refundable deposit" underneath — the same fact `booking_payments_rows()` flags to the
  owner as `deposit_carried`. §3 asserts the property rather than the pounds: **the rows
  plus what is still to pay equal the total**, in all four states.
- **The inks are the EMAIL design system's**, restated as consts because the composer is
  pure and mailer.php is not required on a guest page — §6 asserts each equals its
  `email_*_ink()` definition, so the restatement cannot drift. What they replace: every
  label, heading and note at `#8a8378` (**3.75:1**), the word INVOICE as the accent in
  text (**2.55:1**), and white on the accent fill (**2.55:1**, the old Print button).
- **The BAR exists to pay.** Label + one action; a settled invoice gets no bar at all,
  because a fixed bar carrying no action is chrome that covers the last rows of the
  document. Save a copy lives in the flow at the foot in both states — beside Pay in the
  bar it wrapped to a second line and took **121px of a 390px screen**.
- **Print is the SAME DOM, restyled** — masthead split, cards flattened to ruled tables,
  actions gone, `@page{margin:14mm}` stated rather than left to the browser, and the chips
  get a border because a printer drops tinted fills. Not a second composition: two would
  drift the way the two invoices already had.
- **What it does NOT say: a VAT position.** The mockup asserted "Not registered for VAT"
  and nothing in the app states one — a fixture can invent a tax status, a document a
  guest files cannot. Same for a trading address; it names the business and the phone
  from `contact-phone`, and stops.
- NB `test-payrail` had pattern-matched the exact string concatenation that built the
  "Balance due by <date>" label. The date is still rendered — twice, beside the figure and
  in the bar — so the check moved to test-invoice §5 and reads the OUTPUT. Assert the
  outcome, not the ingredient. And **three test files declared a global `function ok()`**
  with incompatible signatures (test-csp-report's is `($cond,$msg)`, test-smtp's is
  `($label,$cond)` — opposite order); they never load together at runtime but PHPStan
  analyses the set as one, which is how it caught a third being added.
- **AND IT IS ONE ANATOMY, NOT TWO — asked for as "invoice continuity".** The PDF was a
  formal letterhead (crown above a 22pt serif brand, "I N V O I C E", a meta block, serif
  Title Case section titles) while the guest's page led with the amount in grouped cards:
  same booking, two products, which is exactly the divergence this whole pass exists to
  end. `downloadInvoice` now draws the PAGE's structure in points — linen ground, an
  amount card under the accent band (crown + name on ONE line, the caption naming which
  figure it is, the serif figure, the ref line, a state chip), then Charges / Payments /
  Your stay / Billed to / Issued by as white rounded groups with hairline rows and a
  tinted footer row. The meta block is gone: its facts live in the ref line and Billed to,
  as they do on the page.
  - **`group(items)` MEASURES THEN DRAWS**, because a card cannot be sized until its rows
    are — and it slices at ROW boundaries across pages rather than overflowing one. A row
    is `{label, sub, value, ink, foot}`; the `foot` row is the tinted total, drawn as a
    rounded rect squared off at its top edge where it meets the row above.
  - **The figures are still `gt`/`ps`** — nothing in the drawing code re-derives money. The
    ledger reconciles by construction: received + still-to-pay = total (verified on the
    real booking, £228.21 + £459.64 = £687.85).
  - **A PDF CANNOT BE RASTERISED IN THIS CONTAINER** (no jsPDF in node_modules, no
    pdftoppm/mutool/gs), so it was looked at by REPLAYING the recorded draw calls onto a
    canvas in Playwright at 1pt = 1px. Worth keeping as the technique — but note the
    preview's own stub sliced `addImage`'s arguments one short and reported the crown as
    absent, i.e. the harness lied before the app did.
- **AND THE OWNER'S PDF WAS FIXED TO MATCH ON THE FACTS FIRST** (`downloadInvoice`,
  app.js; gated by smoke-test's PDF section, which stubs jsPDF by wrapping the
  CONSTRUCTOR — every text baseline, page and ink then measurable with no browser).
  - **"Paid in full £770.25".** `gbp(gt.fullyPaid ? gt.total : gt.balance)` put the whole
    TOTAL in the column every other state uses for what is still owed. The label and the
    figure are one fact now, in invoice.php's words: `Nothing outstanding £0.00` /
    `Balance due £446.44`.
  - **NOTHING CALLED `addPage()`** and the page furniture was painted once, so a long
    address pushed the closing sentence off the sheet (baseline **819** against a sheet
    ending at **814**) — and a second page would have been bare linen with no white sheet
    under the ink. `sheet()` draws the furniture per page and `need(h)` breaks; the row
    writers **advance `y` themselves**, because the old helpers took the baseline as an
    argument and left `y += 18` to fifteen call sites, which is exactly where a break
    cannot be inserted reliably. The gate's multi-page fixture must be a WRAPPING field
    (a long address) — a single row is 18pt whatever is in it, so a 40-name guest string
    grew the document not at all and the check passed vacuously first time.
  - **The deposit was stated twice** — once in Charges as money, once in a section of its
    own with its status. One line now, with the status underneath, on the same
    display-vs-arithmetic split as invoice.php: the line carries `gt.dep` (in the total,
    0 once refunded) and the record only appears once it has LEFT the total.
  - **Inks**: "I N V O I C E" was the accent as text (**2.55:1**) and "Paid in full" was
    `#4CAF50` (**2.78:1**). Both take invoice.php's INV_ACCENT_INK / INV_OK_INK.
  - NB smoke-test is otherwise entirely synchronous and `process.exit`s at the foot;
    `downloadInvoice` awaits `ensureJsPdf`, so its continuation lands on a microtask and
    the summary printed first — the probe's promise goes in `pendingChecks`, which the
    summary now waits on. It is the one async gate in that file.
- **THE PRINT STYLESHEET WAS A THIRD LOOK, and that is three documents of one
  invoice.** The screen and the owner's PDF matched; `@media print` then flipped the
  header into a masthead and flattened every card to a ruled table, so the guest's
  SAVED PDF matched neither. It flattened for a real reason — a printer drops tinted
  fills, so a white card on linen prints white on white — so the cards keep their
  shape and take a **hairline** instead, and every tinted thing states its own
  border. test-invoice asserts what print must NOT do (`border-radius:0`,
  `display:flex`) as well as what it must.
- **AN INVOICE THAT STATES A BALANCE MUST SAY HOW TO PAY IT.** `grep -c bacs
  invoice.php` was **0**: the pay button is correctly withheld off the card rail
  (`payment_rail`) and NOTHING replaced it, so a guest who paid by transfer got
  "Balance due £459.64" and no instructions. The chase emails print `bacs-details`;
  the document the guest FILES did not. A "How to pay" group now carries them, and
  with none on file it names a way to get them rather than saying nothing. NB
  `bacs-details` is INTERNAL, so invoice.php (server-side) always resolves it while a
  GUEST's app.js never receives it — the owner's PDF shows the block, a guest's copy
  of the PDF cannot, and their route is the emailed page, which can.
- **THE PDF HAD NO IDENTITY AND ITS SECOND PAGE WAS A LOOSE SHEET.**
  `setProperties` / `setLanguage` / `getNumberOfPages` / `setPage` were all absent, so
  the Title was empty (viewers and Files showed the filename alone), a screen reader
  got no document language, and — once #1042 made pagination possible — page two
  carried nothing saying which booking it was. Stamped in a SECOND pass, because the
  total is only known once the drawing is done.
- **THE FIT TEST WAS TWICE AS CONSERVATIVE AS THE DRAWING, AND THEN ORPHANED A
  CAPTION.** `avail` reserved a full `PAD` while `cardH` only adds `PAD/2`, so a
  group with 1pt of room broke the page; and `groupCap` asked for its own 20pt
  independently of the group after it, which put a caption on page one with its card
  on page two — strictly worse than the break it was trying to avoid. `group(cap,
  items)` now owns both: the break is decided with the caption's height included,
  then the caption is painted, and a continuation slice gets no caption. General
  rule: whatever can be separated by a page break must be measured by ONE decision.
  NB the bank-rail case (one extra group) still legitimately runs to two pages — it
  breaks correctly now rather than fitting by a millimetre, which is the outcome to
  want. Folding "Issued by" into the closing fine print would bring it back to one
  sheet and is the next thing to try if that matters.
- **AND THE CHARGES MUST ADD UP TO THEIR OWN TOTAL — the half the first pass missed.**
  Coherence was asserted for the Payments card and not for Charges, so the refunded state
  listed a £75 deposit in a table stated to total £695.25. A deposit is a HOLDING, not a
  charge: while it is in the total it is a charge line, and once it has gone back it
  leaves and its history lives in Payments (the dated return row) plus a sentence beneath
  the card. **And the gate for it has to read the RENDERED table** — the first version
  summed the payload, so reverting the renderer left it green.
- **jsPDF SILENTLY DELETES SMART PUNCTUATION, AND MANGLES ANY NAME OUTSIDE cp1252.**
  Its built-in fonts declare WinAnsi and its encoder does **not** handle cp1252's
  **0x80–0x9F** block, so `–` `—` `’` `…` `•` `€` `™` are dropped with no error — measured
  against the real 2.5.1 bundle by reading the `Tj` operators back out of the output. Two
  drawn strings were affected and one is on **every invoice ever produced**: the Charges
  row's `06/09/2026 – 11/09/2026` drew as `06/09/2026  11/09/2026`, a hole where the range
  dash belongs, which also silently reopened the HTML-vs-PDF divergence the continuity work
  had just closed. A character OUTSIDE cp1252 is worse: jsPDF emits **UTF-16BE bytes while
  still declaring a WinAnsi font**, so `Łukasz Wójcik` painted as a control character, an
  `A`, then NUL-separated letters — a guest's own name as line noise on the document they
  file, and names/cottage names/addresses are all free text, so nothing but a fixture with
  one in it could ever have caught it. `£ · × é ë Á` all sit at 0xA0+ and draw correctly,
  which is why a gap in a date range was the only visible symptom for so long. The
  **metadata is fine** and must not be "fixed": jsPDF writes the Info dictionary as
  UTF-16BE with a BOM, which is correct — only page text is broken.
  `pdfSafe` is **wrapped onto the jsPDF INSTANCE**, not applied per call site, because a
  sanitiser you have to remember is one the next draw call forgets; `getTextWidth` and
  `splitTextToSize` are wrapped too, or a chip is sized and a line broken on characters
  that never appear. Transliteration, not font embedding: jsPDF wants TTF where the brand
  faces are variable woff2, and the base64 lands in app.js's budget — `Lukasz Wójcik` (the
  ó is cp1252 and survives) is legible and honest where the status quo was garbage. A
  script the fonts cannot draw at all gets `?` per character: visible and honest, where
  dropping is the defect and drawing is the noise.
  **Both maps carry ONLY what the two general rules miss**, and 16 of the 46 entries first
  written were provably redundant — either already drawable at 0xA0+ (`Ø Æ Þ Ð ß`) or
  decomposing under NFD (`Š š Ž ž Ÿ İ`). Check before tabulating; the test that answers it
  is three lines.
  **THE TWO WRAPPERS COVER DIFFERENT PATHS, so one fixture cannot gate both.** A row's SUB
  reaches the page through `splitTextToSize` and a row's LABEL only through `text` — so
  break-testing with the `text` wrapper removed left the plain-invoice sweep GREEN (the sub
  had already been cleaned by the other wrapper). The undrawable sweep is asserted on the
  ordinary fixture AND on a non-Latin-1 guest name, separately.
- **THE PDF'S MONEY IS NOW GATED THE WAY THE PAGE'S IS.** test-invoice §3 asserted both
  coherence properties on the guest page's rendered tables and smoke-test's PDF section —
  the same money through a *different renderer* — asserted **neither**, which is the surface
  the Charges-coherence defect above actually shipped on. Both now read the DRAWN rows (the
  right-hand column between one group caption and the next) in all four deposit states:
  charge lines sum to their own Total, and received + still-to-pay equals it.
- **PDF CONTRAST IS ARITHMETIC ON THE RECORDED INKS, and rasterising was the wrong answer.**
  The inks are invoice.php's, which test-invoice proves equal to the email design system's
  measured values — but nothing checked the PDF only ever USES those, so a new
  `setTextColor` here was invisible to every gate. There is still no PDF rasteriser in this
  container or in CI (no jsPDF in node_modules, no pdftoppm/mutool/gs), and adding a system
  package to gate what arithmetic already settles is a bad trade: the ground is a known flat
  colour, so every distinct ink is measured against white and both chip tints. Break-tested
  by restoring the retired `#4CAF50`, which fails all three grounds.
- **A GUEST'S PDF STATED A BALANCE WITH NO WAY TO PAY IT.** The "How to pay" group was gated
  on `bacs` being PRESENT rather than on the guest being off the card rail — and
  `bacs-details` is INTERNAL, so a guest's app.js never receives it and the group rendered
  nothing at all. The dead end the group was added to close, still open on the copy the
  guest keeps. It now falls back to invoice.php's own sentence, word for word.
  **And the gate for it walked straight into a vacuity trap**: the closing fine print also
  says "reply to your confirmation email", so the obvious phrase passed with the whole group
  deleted (break-tested). It targets `send you our bank details`, which only this block says.
- **"ISSUED BY" IS FINE PRINT NOW, ON BOTH SURFACES.** Its own section restated the masthead
  at a cost of 57pt on the PDF (caption 15 + row 25 + gap 17) — and that was the 57pt taking
  the bank-rail case onto a second sheet, so folding it is what finally brought that case
  back to one. Folded on BOTH surfaces together, because invoice.php had the same section and
  letting one drop it alone reopens the divergence. Two gates re-aimed rather than patched:
  the fact to assert is that the issuer is still **named**, not that it has a heading.
- **PROSE IS A POOR LEVER ON A BUDGET, measured.** app.js went 2,071 gz bytes over; trimming
  three long comment blocks (two of which restated CLAUDE.md at length and both ended "See
  CLAUDE.md") plus 16 map entries recovered only **828** of them, because gzip compresses
  repetitive prose extremely well and the residue is irreducible code. The order in the rule
  still holds — trim first, raise second — but expect the trim to buy less than it looks like
  it should, and don't cut load-bearing comments chasing it. Budget raised 230400 → 232100.

## The booking flow speaks and moves (the approved demo, built)

The enquiry journey — picker → form → send → sent — wears the pay screens' spring
grammar, so asking and paying feel like one product. Gated by ui-test-datepicker
(two checks re-aimed, below) and browser-verified end to end (17 checks: voice,
capsule, wave, receipts, narration, beat, sent moment).
- **THE PICKER TALKS LIKE THE HOUSE on the guest surfaces** (`dpVoice` = not admin,
  no field target — a target's own startHint/endHint still wins): "When would you
  like to arrive?" → "**Mon 24 Aug** — lovely. Now the day you'll leave, anything up
  to **Fri 28 Aug**" → the completed range with nights + figure + party. Dates are
  SPOKEN (`dpSpoken`/`dpSpokenEnd` — weekday-named, year only when it isn't this
  year's, and NB `toLocaleDateString` writes "Mon, 24 Aug": the comma is stripped).
  This is the email date rule applied to the one screen that behaves like a
  conversation; `dpPretty` stays for field labels and admin. The ceiling is still
  stated only where enforced — its gate was re-aimed from `/28 Aug 2026/` to
  `/28 Aug/` because dropping the current year is the point, not a regression.
- **"✓ LOOKS FREE" ONLY WHERE IT IS TRUE BY THE MODE'S OWN RULES** (`.dp-cap-ok` in
  the hint): the enquiry picker refuses crossed nights, so a completed range there
  is clear — but a SEEDED range (the hero search seeds any dates) can cross a
  booking, so the capsule re-sweeps the nights before claiming anything. The other
  modes never claim it: a waitlist range is for the taken nights.
- **MOTION IS EARNED PER PICK** (`dpState.animPick`/`animWave`, consumed by
  renderDatePicker into `dp-anim`/`dp-wavef` grid classes): the selection pops, and
  the range fills as a WAVE near-to-far (`--dpd` stagger inline per in-range cell,
  capped 0.24s) — only on the render that completes it. A month page or price
  repaint replays neither (gated). **§18's pixel checks needed a settle wait**: it
  samples the grid straight after its picks, and mid-pop a scaled cell's pixels sit
  at the wrong spot — all four pixel checks cried wolf the day the motion shipped.
  Its question is the RESTING paint, so it waits 750ms; the re-aim is in the suite.
- **THE DONE BUTTON IS THE RECEIPT** (enquiry only): a completed range flips it to
  filled-accent "Continue" with dates + figure as a `.dp-done-sub` — which must be
  `text-transform: none`: it inherits the button's uppercase + tracking and CLIPPED
  the figure (measured on the build's own screenshot). Other modes keep plain Done —
  a waitlist range is not a purchase.
- **THE FORM ASSEMBLES ITSELF AROUND LANDED DATES**: dpDone (enquiry) writes the
  SPOKEN range into `#enq-date-display`, re-adds `.enq-landed` on
  **`#enquire-step-review`** (NB the step-1 container id — `enquire-step-dates` does
  not exist, and the first draft silently cascaded nothing), and the price box /
  reassurance / quick-ask cascade in on the spring. The step-1 Continue carries its
  own receipt (`.enq-cta-sub`, "Mon 24 Aug → 27 Aug · £440.00 all in" — rental + the
  refundable deposit, the price box's own framing), synced at the TOP of
  updateEnquiryPrice before any early return so cleared dates strip it.
- **THE SEND IS NARRATED** (`enqStepsShow`/`enqStepsEnd` in `#enq-steps` — the
  pay screen's `.pay-steps` anatomy reused verbatim, one grammar): "Checking the
  dates are still free" shows TICKED at the 400ms reveal because `enqFirstProblem`
  really has just run the calendar check; "Sending your enquiry to George" covers
  the POST. Success beats the button green ("✓ Sent", `.btn-accent.is-sent`,
  650ms, skipped under reduced motion); a refusal folds the narration away before
  the message settles in (`.enq-modal-msg.show` rides `paySettle`).
- **THE SENT MOMENT** (step 3): the receipt's own drawn tick + halo
  (`.pay-done-tick` reused — its draw/halo rules are class-scoped, and the step's
  display flip restarts them), an "Enquiry sent" heading, and the step's blocks
  (the note — now "George replies personally — usually the same day", the said-back
  summary, the schedule rows) cascade in via nth-child delays. Signed-in guests
  skip step 3 by design and keep toast + beat.
- **Deliberately not changed**: the quick-ask placeholder ("Parking? Wifi? The
  beach?" already carries the demo's voice), the steppers (already `.hs-step`),
  and every refusal rule in the picker — this pass is connective tissue and motion
  over the gated logic, not a rebuild of it.

## Three guest-side repairs, found by looking (approved demo, built)

**Asked for as "what next in terms of ui enhancements" — so the guest surfaces were
DRIVEN at 390px and screenshotted, and only what survived a measurement was
proposed.** Gated by **`ui-test-guestrepairs.js`** (36 checks), each of the four
declarations break-tested — the broken run reproduces the original numbers exactly
(14px/148px, 312/67px, 41px).
- **THE CHAT OPENED ON A VOID.** `chatHelloHtml()` composes a proper welcome and
  its own comment says it exists "so the chat opens looking like a conversation
  rather than a blank pane" — and then `.chat-thread > :first-child { margin-top:
  auto }` pinned it to the floor: **267px of nothing** above the only thing on a
  360px pane, ~60% empty, reading as still loading. **It was composed as an intro
  and positioned as a message.** `:has(> .chat-hello)` centres the empty thread;
  the instant a real bubble exists the rule stops matching and messages
  bottom-anchor byte for byte as before (gated both ways). Leading the pane, the
  welcome can then earn the space — it NAMES who answers (`host-name`, the
  existing key, falling back to "the owner") and says when, which is the question
  a hesitant guest has BEFORE typing.
- **AND MESSAGES ARRIVE LIKE MESSAGES.** Two things at once, and it is the PAIR
  that reads as iOS rather than as a fade: the thread MAKES ROOM (`.chat-row`,
  grid-rows 0fr→1fr — the `#pay-steps` reveal) while the bubble GROWS FROM THE
  CORNER IT HANGS OFF (`transform-origin` bottom right for yours, bottom left for
  theirs). Both 0.5s, so they are one event.
  - **A BUBBLE IS A DAMPED SPRING AND A BEZIER CANNOT FAKE IT.** iOS swings past,
    swings back a fraction, and settles — two swings; a `cubic-bezier` has ONE
    hump by construction, so it gives the overshoot or the settle, never both.
    `--ios-bubble` / `--ios-settle` are a damped oscillator's step response
    sampled into `linear()`: bubble ζ 0.70 ω₀ 20 (**4.6% overshoot, 0.21%
    counter-swing**), thread **ζ 1.00 critically damped** — a list that springs
    past its own height has to claw back rows it already showed. **16 stops carry
    the identical curve as 28** (measured to 3dp), at 60% of the bytes. Bezier
    behind `@supports`, losing only the second swing.
  - **THE FADE IS ITS OWN ANIMATION.** Folded into the spring's keyframes it
    stretches across the overshoot and the settle, so the bubble is still
    *arriving* at 400ms. Opaque by 140ms; after that only the shape moves.
  - **TWO WRAPPERS, both load-bearing**: `.chat-row` does the height,
    `.chat-rowin` keeps the flex column so `.chat-msg`'s own `align-self` still
    picks its side. And **the wrapper must TAKE the thread's place in the flex
    column** — `.chat-widget .chat-thread { flex: 1 }` is what makes the thread
    the growing scrolling region, and an ordinary block between them let it grow
    to its content (measured **595px**), pushing the name/email fields and the
    chip row under the composer. Verified layout-identical to the pre-change build
    across the whole widget.
  - **ONLY THE LAST ROW EVER CARRIES `is-new`**, and `enter` is opt-in per call:
    every caller rebuilds the whole thread, so an entrance keyed on anything else
    replays the conversation on each poll. `loadChat` cannot tell a send from an
    open, so **the SEND says which it is** (`__chatEnterNext`).
- **THE SCROLL FOLLOWS THE MESSAGE, and the POLICY is untouched.** `chatPoll` has
  always refused to autoscroll unless the reader was within 60px of the bottom —
  that rule is unchanged, and the near-bottom test is still read BEFORE the
  re-render (afterwards `scrollHeight` has already grown by the new row, so a
  reader sitting exactly at the bottom measures a row's height away). What was
  wrong is only that `scrollTop = scrollHeight` TELEPORTS. `chatFollow` pins
  scrollTop to scrollHeight each frame for the row's 0.5s: the row is GROWING, so
  the newest bubble stays on the floor while the thread slides up underneath,
  inheriting the row's own critically damped curve — no second easing to keep in
  step. Measured: one distinct scrollTop before, twelve after. Stamp-guarded, so a
  newer message takes over.
- **AND THE ONE THING THAT IS NEW: a reply could land silently off-screen.** Read
  up-thread while one arrives and the app correctly leaves you where you are — and
  then says nothing. `#chat-newpill` is the only addition, shown in exactly that
  case.
- **THE SITE'S FIRST LINE ORPHANED A WORD.** "Est. 1983 · Book direct with the
  owner" broke **312px / 67px** at 390px — one word alone on line two, in tracked
  uppercase. `text-wrap: balance`; a hard `<br>` would be wrong because the string
  is owner-editable (`data-edit-text`). **The gate asserts the RATIO, not the
  pixels** — 21% of the first line — because a ratio compares across widths and
  type sizes where a pixel figure describes one rendering.
- **THE TWO DECLARATIONS WERE 18px.** `#enq-nodogs` / `#enq-terms` in a 41px row,
  3px under this app's own 44px floor. Never a WCAG 2.5.8 failure — the input is
  inside its label, so the row is the target — the box a guest AIMS at just looked
  half the size of what they can hit. Row to 44px, box to 24px, **and the tick
  draws itself** (`termsDraw`, 0.22s — deliberately not `.pay-done-tick`'s 0.9s +
  halo, which is earned by money landing; the star-bow lesson). It draws on the
  way IN only: unchecking fades the mark, because undoing a declaration is not a
  moment.
  - **The drawn control is the KEYSAFE SWITCH'S OWN TRICK**: the real `<input>`
    stays, full size, `opacity: 0`, over a `.terms-box` we draw — so every id,
    gate, `enqLiveSync` handler and the server-side `no_dogs` refusal are
    untouched. Opacity, never `display:none` (which takes the label's click target
    and the focus ring with it); the ring is drawn on the box instead.
  - **NOT WHITE.** `#fff` on `--ok` measures **2.78:1** — under the 3:1 that
    1.4.11 asks of a non-text mark. `--accent-ink` is the design system's
    ink-on-a-fill token and reads **6.65:1** on the same green. The check-css
    ratchet caught the raw hex; the arithmetic caught that white was also wrong.
  - Deliberately NOT switches, despite borrowing the switch's mechanism: a switch
    says "on/off, changeable"; a declaration is a statement you are making, and
    the tick is what the confirmation email and the hub's register row show.
- **TWO THINGS THE LOOKING PASS GOT WRONG, both corrected before proposing.** The
  chat's quick-reply chips look clipped mid-word and are not — that is a
  deliberate mask fade, and the fade is what was being seen. And the chat FAB
  looked like it sat on the first cottage card; a Range sweep of the INKED text
  down the whole homepage found it covering none, at any scroll position. The
  general rule, third time: measure the paint before believing the eye.
- **AND THE DEMO SLANDERED THE APP TWICE** before the build. Its "today" pane
  yanked the reader to the bottom on a poll (which `chatPoll` has never done), and
  then read `nearBottom` AFTER the re-render. Both were the demo's bugs. A
  before/after demo must be held to the same fidelity as the fix.
- Budgets raised with the shipped figure stated: the gate measures the UNSTRIPPED
  file while the deploy strips comments, so app.css read +2568 while the real
  growth is **+828**; app.js **+569**, index.html **+77** gz.

## Two guest-side repairs (approved demo, built)

**Asked for as "what next for ui enhancement", then demoed and chosen.** Ten
guest screens driven at three widths with an INK-OVERLAP detector added — the
last round's timeline collision was caught by eye, not by heuristic. Gated by
**`ui-test-guestrepairs.js` §5–§6** (19 new checks), both break-tested.

- **A STAY YOU ARE IN WAS FILED UNDER "UPCOMING".** `const upcoming =
  !hasCheckedOut(b)` means only *has not ended*, so a guest sitting in the
  cottage saw their booking under **Upcoming stays** with a green **Upcoming**
  badge and a date range that started yesterday — directly beneath a hub card
  correctly reading "You're staying at Jollyboat · 3 nights left". The comment
  above it reasons carefully about the DEPARTURE edge ("Departed is time-aware…
  the arrival edge stays date-based"), so the past boundary was thought through
  and the present/future one never was.
  **`currentStay` was already being computed on the very next line** and used
  only to build the hub. Three buckets now (`currentCards` beside `upcomingCards`
  and `pastCards`), a third badge state, and its own **"Staying now"** group above
  Upcoming. **BOTH HALVES OR NEITHER** — the demo offered a badge-only fix and the
  gate is what refuses it: §5 asserts the badge AND the heading, and the
  badge-only break-test fires three checks. Amber, not the upcoming green: it is
  the vocabulary the in-residence hub already uses, and green beside "3 nights
  left" read as a stay that had not started. The empty state counts the new bucket
  too, or a guest whose ONLY stay is in progress would be told they have none.
- **THE COTTAGE PAGE LISTED AMENITIES ONE PER ROW ON EVERY PHONE.** `.amenities`
  was `repeat(auto-fit, minmax(200px, 1fr))` + a 15px gap — **two tracks need
  415px** and the container measures **332/362/402px at 360/390/430**, so it
  collapsed to one column and "Wifi" took a whole row. `.amenity-sheet` (My Stays)
  had already been fixed with `flex-wrap` + `flex: 0 1 auto`, twenty lines below in
  the same stylesheet: **fixed for one route, left for its neighbours**, and the
  note recording that fix names this exact cause. Measured after: 8 amenities in
  **5 / 4 / 3 rows** at 360/390/430, against 8 before.
  **A narrower `minmax` was refused**: two equal columns would give a one-word
  amenity the same box as "Heritage Coastal Setting". §6 gates that as
  `distinctWidths > 2` and `full === 0` — no pill spans the container — so the
  fix cannot erode back into equal columns.
- **§6 DRIVES `renderAmenities` DIRECTLY, and that is not laziness.** The cottage
  page reads a module-scoped `activePropAmenities`, so a `content.php` route
  registered mid-test never reaches it (content lands at boot) and
  `guestAmenityList` wants an ARRAY, not the JSON string a route would send. The
  claim being gated is the LAYOUT, and `renderAmenities` is its route.
- **THE OVERLAP DETECTOR FOUND NOTHING, and that is worth recording**: its hits
  were the auth modal legitimately stacking over the cottage page behind it and
  the hidden `.seo-text` crawler block. The alarming-looking "Check availability
  pill across the subtitle" was the documented `position: fixed` full-page-capture
  trap — it clears on scroll. **NOT fixed, and left as a note**: at max scroll on a
  short page, 5px of the last line sits behind that bar; fixture-sensitive enough
  that it wants a real page before anyone calls it a defect.
- **A MEASUREMENT LIED BEFORE THE APP DID, for the third time this session.** The
  first hit-test reported 24 overlaps at every scroll position: `requestAnimationFrame`
  alone does not commit a `scrollTo` before measuring, so it re-measured the same
  frame 24 times. Anything that scrolls then measures needs a real timeout.
- Budget raised app.js 278500 → 278800. The gate measures the UNSTRIPPED file; the
  REAL shipped growth is **+56 gz bytes** (app.css +9), which is the third bucket
  and its badge — the rest is comment prose the deploy strips.

## Words the owner can actually read (approved demo, built)

**Asked for as "what next for ui enhancements", then demoed and chosen.** Twenty
admin screens driven at two widths and measured for what the gates structurally
cannot see — layout-test measures overflow past the viewport, a11y-test measures
contrast, targets and names; neither measures COLLISION or TRUNCATION. Three
survived. Gated by **`ui-test-legibility.js`** (37 checks), each break-tested.

- **THE TIMELINE'S MONTH LABELS WERE PAINTED ON TOP OF EACH OTHER.** `.tl-day b`
  is `position:absolute; white-space:nowrap` inside a 32–38px column, and
  **"Aug 2026" measures 59px** against "Aug" at 23px — so a label runs across its
  neighbours. `tlStartOffset()` is a constant **−2 from TODAY**, so on the 2nd of
  a month the window opens on the last day of the previous one and the `i === 0`
  label sits ONE column from the month-start label: measured **26px of overlap at
  390px, 20px at 900/1280/1440**, reading `Aug 2⩝⩝⩝6`. On the 1st it clears by
  1–5px, which is not clearance. **A MONTHLY recurrence, not an everyday one** —
  the first framing of this said "the resting state" and was wrong; reading
  `tlStartOffset` is what corrected it. The year is the part dropped (the caption
  directly above already says "September 2026"), and only when a month-start is
  within two columns — three columns is 96px at the narrowest, which clears 59.
  **The gate PINS THE CLOCK** (`page.clock.setFixedTime`, the 1st / 2nd /
  mid-month): on the real clock this would fire one run in thirty, which is a
  gate that does not fire.
- **HALF THE WORDS WERE BEING CUT OFF THE VERDICT SUBS.** `.bhub-fold-sub` is
  `nowrap` + ellipsis and the right rail takes the figure or capsule, so the sub
  gets 119–213px and the sentence is cut mid-word: measured on Manage @360,
  `daily jobs and feeds — the f…` **51% lost**, `teach it once and it an…` 47%,
  `reviews, guest photos, …` 43%; Money @390 `was due 06/08/2026 under the s…`
  34%. **Fixed by SHORTENING THE COPY** (the owner's choice of three demoed
  options — the others were two lines on a phone, and the figure dropping to its
  own line). Eleven strings, written to the narrowest rail: a sub is a caption
  for a row whose label and capsule already carry the verdict, so it only has to
  name WHAT, not restate the conclusion — `'daily jobs and feeds'`,
  `'guest submissions'`, `'paid in, net of fees'`, `'after fees and expenses'`.
  The dynamic ones shortened too (the miss quote slices at 24 rather than 42; the
  overdue sub says `due <date>` and names *their plan* only when it is not the
  standard schedule — the exception is the informative half).
  **THE KNOWN WEAKNESS IS REAL AND THE GATE IS WHAT HOLDS IT**: the rail a sub
  gets depends on the capsule beside it, so shortened copy is not self-maintaining
  — the demo showed one line still cut after a first rewrite, and building it took
  two measure-and-shorten rounds. §2 fails on any truncated sub at 360 AND 390,
  and asserts a floor (≥10 chars) so "shorten until it fits" cannot degrade into a
  stub.
- **A SETTINGS ROW'S DESCRIPTION DROPPED A LONE WORD** — "Card payments (Square)
  & your deposit / **policy**", the hero-kicker defect at scale. **`text-wrap:
  pretty`** (the owner's choice; `balance` was measured as stronger — 13 → 1
  against pretty's 13 → 8 at 360px — but it equalises every line and is specified
  for headings, where `pretty` is the body-text tool and leaves the natural rag).
  Measured effect: **13 → 8 at 360px, 11 → 7 at 390**. It lives in **admin.css,
  not beside the rule in app.css**, because these rows are owner-only markup and
  app.css is the sheet every anonymous visitor pays for; admin.css loads after
  it, so equal specificity wins on order.
- **§3'S GATE IS SELF-CALIBRATING** rather than pinned to a number: it measures
  the same page with the rule and again with `text-wrap: wrap !important` injected,
  and asserts the fixed count is lower by more than noise. A fixed threshold would
  rot the moment a row's copy changed, and the claim being made is about the
  declaration's effect, not about a count.
- **AND ui-test-money's To-collect CHECK WAS RE-AIMED, NOT PATCHED.** It pinned the
  phrase "overdue one is above"; what it exists to hold is that the zero state
  never claims *paid up* over an overdue row and points AT that row. It asserts
  that property now — the wording is copy, and this pass moved it.
- Budgets raised with the real figures: **admin.js 547300 → 547800**, **admin.css
  71300 → 71700**. Both owner-only and immutable-cached; app.css was untouched,
  which is the point of putting the text-wrap rule in admin.css.

## The timeline header's last two collisions (approved demo, built)

**Reported from a phone on the 4th: "Oct↺2026" and "S4" with the playhead through the 4.**
The earlier fix only covered the 1st and 2nd. The cause was the window's FIRST column
carrying a month label (59px "Oct 2026" in a 32px column) beside a changeover ↺ in the
next one, and the playhead (`.tl-nowline`, one element down the whole timeline) striking
through today's day number.
- **The first column carries NO month label** — the caption above (`tlSyncMonthLabel`)
  already names the month under the left edge. Labels mark the 1st only, with no year at
  all (the caption carries it, January included).
- **A month label and a ↺ never share a column**: where the 1st is also a changeover the
  label wins; the pips and the bars meeting below still say it.
- **The playhead starts where the header row ends** (`tlPlaceNowLine` sets its `top`), so it
  never crosses the number. The day number is wrapped in `.tl-num` for the gate.
- Gated by ui-test-legibility §1 (the 4th, the 1st, mid-month; the clock pinned to 14:15 —
  at 10:00 the line is over the weekday letter and the check proves nothing). All three
  declarations break-tested.

## Profit per night — the pricing engine knows the drive (approved demo, built)

**The owner's aim is money kept per booked night, not nights filled**: every changeover is an
hour's drive each way plus cleaning, the same for two nights as for a week. Gated by
ui-test-manage §8d (13 checks), test-pricing + smoke-test (the two new rules, both sides),
ui-test-intel (re-aimed: the gap goes to the guest already there first).
- **The changeover cost** is the internal key `pricing-changeover` {drive (min each way), hourly,
  fuel, clean}; `prCosts().trip` is the one figure. Its page is Pricing → Settings → "Changeovers
  & what you keep" (`__prPage = 'costs'`): kept per booked night over six weeks, changeovers, hours
  on the road, and across all cottages how many changeovers already share a day.
- **Stays vs holds**: `prStays` = direct bookings + `isOtaBlock` stays; a hold is never a stay or a
  changeover (§8d asserts both). Platform stays are valued at the cottage's own price and SAID so.
- **Learned stay length** (`prLearned`/`prLikelyStay`): last three years, recency-weighted, by
  booking window (direct bookings' `createdAt`) and by season; shown on the page and on a tapped night.
- **Six profit ideas** (`prProfitIdeas`), each comparing two options in pounds kept with a confidence
  and its basis: offer the guest already there the nights after them (opens the composer prefilled;
  the gap's discount card stands down while it is live), a shared changeover day, raise a week guests
  found full (dated override `Busy week`), a sunny weekend (`Sunny weekend`, weather.php), the
  short-stay charge, minimum stay by month + gap fits. **Not now** stores `pricing-hidden`
  {pk|id: sig} — the idea returns only when its numbers change.
- **Short-stay charge** (migration-130 `short_fee`/`short_max`): `short_stay_charge()` /
  `shortStayCharge()` add fee × nights to stays of ≤ short_max nights, AFTER the last-minute factor,
  folded into `nightly` so every quote, snapshot and document carries it unchanged.
- **Minimum stay by date + gap fit** (`booking-rules-lib.php` / `ruleMinNights` + `ruleGapFit`):
  rules-<k> gains `minByDate` [{from, to, min}] (check-in inclusive) and `gapFitDays` (a stay that
  exactly fills a gap between two taken nights, within that many days, books whatever the minimum).
  Enforced by enquiries.php, checkBookingRules, the picker and the availability chips; `saveRules`
  carries both through every rules save.

## The Bookings menus, simplified (approved demo, built)

**Asked for as "the bookings menus need simplifying".** Twelve tappable controls sat above the
first booking: five filter tabs, Add booking, Block dates, ‹ Today ›, the compact zoom and the
refresh icon — plus a green "All paid up" capsule saying what the Needs payment tab already said.
Now eight.
- **Three tabs, not five**: Upcoming / Needs payment / Past. `Custom plan` (an audit) and `All`
  (just Upcoming + Past) live in the caption's ⋯ menu. A filter chosen there selects NO tab,
  says what is on in a chip (`#bookings-filter-chip`, one tap back to Upcoming) and marks the ⋯
  (`.is-active`). `bookingsSetFilter` keeps ONE pass over every `data-bfilter` in
  `#bookings-main`, tabs and menu items alike.
- **WHO OWES IS SAID ONCE**, as the COUNT on the Needs payment tab (`#bk-needs-count`) — same
  predicate as the filter, over EVERY booking (not the filtered rows), absent at zero because
  silence is the all-clear. The old `#bookings-verdict` capsule is gone; its settle motion moved
  to the badge and fires only when the COUNT changes (a part-payment that leaves the same guest
  owing moves nothing — the gate adds a second owing booking to prove the settle).
- **One Add button, two choices**: "Add ▾" opens the existing `.bhub-menu` pattern with Add a
  booking / Block dates. The compact zoom and the external refresh (with its "updated N minutes
  ago" note, `#cal-updated-text`) are in the calendar's own ⋯. Both menus reuse
  `bhubMenuToggle`, so Escape, click-away and viewport fitting come free.
- Gated by ui-test-workspace §1c (three tabs, the menu's two items, the filter driven by
  CLICKING the item, the chip's way back, one Add button) and ui-test-backoffice-motion §3.
  ui-test-smallthings lost its refresh hit-region check — the icon it measured no longer exists.

## The simpler Today (approved demo, built "exactly as shown")

**Asked for as "simplify it a little bit more, make it more clear", demoed twice, then
"Build it exactly as shown" — and then the sentence came out.** Gated by **`ui-test-simpletoday.js`**.
- **THERE IS NO DAY SENTENCE.** It shipped ("There's one thing to do: return …") and was REMOVED the
  same day at the owner's ask: the card below says what to do, so the line said it twice. `#today-date`
  is empty and collapses (`:empty`) on a phone, carries the greeting alone on rail screens, and the date
  line, movements list, "£… to collect" button and ✓ capsule beside the title are all gone.
- **ONE TASK IS A CARD WITH ONE BUTTON** (`#needs-you.ny-solo`, set by renderNeedsYou when exactly one
  item): heading hidden, the action a full-width accent button ("Return £60"). The deposit duty now
  names the figure (`Return <full name>'s £60 deposit`, act `Return £60`); the FULL name stays on
  purpose (two Sarahs). Several tasks keep the heading and list unchanged.
- **THE MONTH ROW** is title + ‹ Today › + a 44px **+**; the calendar ⋯ and the Add ▾ pill are gone.
  The + menu holds Add a booking, Block dates, the sync note, Compact calendar and Refresh external
  bookings.
- **THE CALENDAR SAYS LESS**: no occupancy pips, no ↺ marks (so no key), today's number circled, a
  platform block is faint hatching with no outline, `.tl-bar` has 16px of left padding so the playhead
  never strikes the first letter of a bar that starts at today's checkout.
- **BOOKINGS**: serif caption with Upcoming | Past beside it. **Needs payment is no longer a tab** —
  who owes is ONE line under the caption (`#bookings-owed`): "✓ Nobody owes you anything." or a button
  "£528 to collect from 1 guest ›" → `openBookingsNeedsPay`, which selects no tab and shows the
  "Bookings that owe you ✕" chip (the existing tab-less-filter mechanism). The figure settles when
  it changes (never on first paint). With no bookings loaded it claims nothing.
- **REMOVED, said plainly**: the Bookings ⋯ with its **Custom plans only** and **Show every booking**
  audits. `bookingsSetFilter('customplan'|'all')` still works but nothing on screen offers it.
- **THE BOOKINGS BLOCK WEARS THE HOUSE VOCABULARY (second pass).** (Its tabs are SUPERSEDED by the one look: the
  one switcher, the chosen side in the accent.) The tabs were the hairline segmented
  control (bordered container, active segment a flat fill, no floating shadow); `#bookings-owed` is a
  ROW — ✓ "Nobody owes you anything" or an amber "£528 to collect · from 1 guest · View ›" — and an
  empty list is the standard empty state (`.bk-empty`: mark, a title that says what is true, one line on
  what fills it, **no button** — owner's ask; the + in the month row is the way to add). The row and the
  empty state JOIN into one well via `:has(~ #bookings-list .bk-empty)` (NB `~`, not `+`: the filter
  chip sits between them). With NO bookings loaded at all the row claims nothing and the empty state
  stands alone. Today's title carries no divider (the `.dashboard-header` border belonged to the
  removed sentence; it is cleared for `#view-backoffice` only).
- **SUPERSEDED — who owes is Today's status pill beside the title** (see "Every page's status is the Manage pill"); the
  row, its card join and the count on its edge are gone, the count is the caption's again.
- **ONE CARD IN EVERY STATE (continuity, approved demo).** The status row is the HEADER of the card that
  holds the list: a list with bookings joins it exactly as the empty state does (no gap, the first row
  loses its top radius/border, the last takes the card's), and the count ("6 past" / "0 upcoming") rides
  the clear row's right edge instead of the caption. The owing row keeps "View ›" and the caption count.
  Gated by ui-test-simpletoday §5 (join in both states, count placement), break-tested on the row rule
  and the caption clearing.
- The dock count badge sits on the icon's corner (`.admin-dock-badge`), outside the selected pill.

## The booking page, one decision at a time (approved demo, built)

**Asked for as "improve the look and feel of the individual booking pages — cleaner, more intuitive",
demoed (static, then a working animated prototype), then "Build it".** Gated by ui-test-hub (§A and the
phone-width block), each declaration break-tested.
- **THE DAY STRIP STANDS DOWN ON A HUB** (`chbFrameSync` excludes `view-booking-hub` and
  `view-enquiry-hub`): "Return Tina's £50 deposit" sat above a card saying the same thing.
- **THE WHEN-LINE IS FACTS PLUS ONE STATE CAPSULE** (`hubStateCap`: Past stay / Staying now / Arrives in N
  days). The check-in/out times moved into the Guest row's sub, where they are looked up, not scanned.
- **CALL AND EMAIL ARE TWO PLAIN BUTTONS** (`.bhub-contact`) under the name. Email still goes through the
  site's composer, never mailto:.
- **THE DECISION CARD KEEPS ITS BUTTON ON EVERY WIDTH, and the STICKY BAR is what yields**:
  `hubWatchSticky` adds `.is-away` while the card is ≥90% on screen. The default is SHOWN — the observer
  can only ever hide the bar, so no card, no observer or an old engine leave today's behaviour. This
  reverses the old "card drops its button ≤900px" rule (A2c); the one-tap-offered-once intent is kept.
  The secondary answer (Keep it for damage) sits beside the primary as a pill (`.bhub-next-acts`).
- **THE PAGE SETTLES IN ONCE PER BOOKING OPENED** (`.bhub-enter`, `__hubDrewId`): a data refresh re-renders
  the hub constantly and must not replay the entrance. Reduced motion is covered by the killswitch.
- **ONE LIST, NOT SEVEN CARDS (follow-up, "still looks disjointed").** The groups lived in three parents
  (money in the header, the grid, the guest book inside `#gb-card-host`), so only adjacent siblings joined.
  The host is `display: contents` with join rules that look THROUGH it, and the money group abuts the grid
  below it ≤1199px. The earlier claim that the groups "already were one list" was wrong on the phone.

## The booking page has THREE rows (approved simplification, built)

**Asked for as "simplify it down, currently lots of info that isn't necessarily needed".** Money, Guest,
History. Guest holds the facts, "Knows your guest", the guest book and the private note; History holds the
booking reference, emails and activity. The sections inside are the SAME `bhubFoldGrp`s (keys `intel`,
`rating`, `note`, `emails`, `activity` — ids, handlers and hub_bundle's summary slots untouched) rendered
FLAT inside their parent's fold (`.bhub-foldin .bhub-fold-grp`). `BHUB_PARENT`/`BHUB_KIDS`: opening a
nested key opens its parent, and a parent renders open while any child is open — which keeps
`__bhubOpenFolds.add('rating')` (the deposit decision's rating offer) working. Also gone from the page: the
booking reference (now in History), the "Next · 2 of 6 ·" counter (the cap is the stage label alone), and
nights/party/times from the when-line (they open the Guest fold). Call and Email are 44px icon buttons
beside the name (`aria-label`ed, with sr-only text). Gated by ui-test-hub.

## A block is not a booked night (audit, "check sitewide")

**Asked for from the Cottages & pricing screenshot ("97% booked in October").** Every figure that says
BOOKED must count direct bookings plus imported platform STAYS and nothing else: the owner's own blocks and a
host's "Not available" hold on an imported calendar (`kind: 'blocked'`, migration-124) are availability, not
occupancy. The shared rule is `isOtaBlock` (client) / `source <> 'owner' AND kind <> 'blocked'` (server).
Swept: the pulse, insights, price model, owner digest, day sheet, assistant answers and the books caveat
already followed it; **two did not** — `cottageMonthOccupancy` (the "% booked" on Manage → Cottages; the
function went with that figure in the one look) and the projected-occupancy table (`renderProjection`-area, admin.js ~17606) counted every
block, so a month the owner had held back read as nearly full. Both fixed. DELIBERATELY unchanged: every
AVAILABILITY surface (timeline, free-window scans, clash checks, gap brief, `pricing-suggest.php`'s
is_booked_date, the assistant's "is it free" tool) — a block makes a night unavailable, which is the point.
An imported event with no recognisable label ('unknown') still counts as a stay, as it always did.
(search-test §44 (a2) gated it until the function went.)
- **AND search-test HAD BEEN ENDING EARLY, SILENTLY, FOR EVERY SECTION AFTER §40.** The dismissal block's
  `release()` ran before the queue's `.then` had assigned it (a microtask), released a no-op, and
  `await settle()` hung on a promise nothing would resolve — node then exits 0 with the event loop empty, so
  the gate printed a clean-looking half and passed. It now awaits the tick, and the file carries an exit guard:
  no summary reached means exit 1. ~140 checks (§41–§44) ran for the first time in a while and all pass.
  General rule: an async main that can exit before its summary needs a "reached the end" assertion.

## Five back-office motions (approved demo, built)

**Asked for as "what animation effects can we do next to make the ui more
polished", demoed side by side, then "Build".** The measured starting point:
app.css carries **99 animations / 109 transitions** against admin.css's **38 /
52**, and of every row type in the app only `.ny-row` had an entrance — the
owner's side of the product barely moved. Gated by **`ui-test-backoffice-motion.js`**
(42 checks), each declaration break-tested (eight fired).

- **THE FOLD MOVES**, and it is the one that touches everything: `bhubFoldToggle`
  set `f.hidden` — a hard show and hide — while `.bhub-chev` alone turned, so half
  the gesture moved. 38 call sites wear it. 0.32s on **`--unfold`**
  (`cubic-bezier(0,0,.58,1)`), deliberately NOT `--fluid-bezier`, which measures
  **0.00 · 0.79 · 0.97 · 1.00** at the quarters — 97% open by its own midpoint,
  right for a slide and useless for a height. `--unfold` is 0.38 · 0.68 · 0.91.
  - **`[hidden]` STAYS THE ONE SWITCH.** It is redefined as the COLLAPSED state
    (a 0fr grid) rather than display:none, so `f.hidden` is synchronously true the
    instant a fold closes and false the instant it opens — which is why **all eight
    suites that read this fold passed untouched** (hub, manage, money, mailbox,
    keysafe, nodogs, layout-test, e2e). The alternative — a class plus an async
    `hidden` on close — would have re-aimed ~30 assertions. `visibility` does what
    display:none was doing (out of the tab order and the a11y tree) and transitions
    with a DELAY on the way out (the `.cmdk-box` trick), so the fold is still
    visible while it closes and gone the moment it has. a11y-test and layout-test
    both skip `visibility: hidden`, so what they measure is unchanged.
  - **A 0fr grid collapses only the FIRST track**, so `.bhub-fold` must hold exactly
    ONE element child. `bhubFoldGrp`, the money fold and the key-safe card wrap
    theirs in `.bhub-foldin`; the cottage sections already wrapped in `.acr-body`
    and the Inbox's folds hold one re-parented folder div.
  - **THE FOCUS RING NEEDED `overflow: clip`, and looking at pixels is what found
    it.** The wrapper's edge sits flush with the fold's last row, so plain
    `overflow: hidden` cut the ring off the last control in EVERY open fold —
    measured 0px of room, and a screenshot shows the ring reduced to a sliver.
    `overflow: hidden; overflow: clip; overflow-clip-margin: 4px` declared in that
    order clips for the reveal and lets the ring bleed, with an older engine keeping
    hidden. **Moving the padding onto the child was tried and does NOT work**: a grid
    item's padding does not collapse with its track, so a closed fold sat 26px high.
- **THE ANSWER ARRIVING** (`moLand`): the Money landing's four slow answers settle
  in from 4px when they land, staggered 90ms by ROW — not by call order, since the
  two fetches resolve independently. `backwards` holds each at opacity 0 through its
  own delay rather than flashing the answer and then animating it. **No first-fill
  flag**, and that is the difference from the availability chip: `renderMoneyOverview`
  paints the placeholders and only then calls the fill, so every write is an arrival
  by construction.
- **A FIGURE THAT CHANGED SAYS SO — two grammars, and the difference is the point.**
  The bookings caption's owed capsule was already on screen and has been RECOMPUTED,
  so it SETTLES (3px, 0.34s); `payPop`'s 0.5→1.2 scale means "this appeared", which
  on a figure already in front of you is a flinch. A dock badge genuinely appears, or
  goes 2→3, so it POPS. Both fire on a CHANGE only and never on a first paint — the
  capsule compares its own WORDS (rounding means £953.10 and £953.40 print the same
  capsule, and a settle on a figure that did not visibly change is motion saying
  nothing); the badge remembers in `dataset.was`.
- **THE TIMELINE DRAWS IN — decoration, named as such**, and the only one here that
  tells you nothing by moving. Bars grow from their check-in edge, staggered 45ms
  down the lanes and capped at 12 steps. **ONCE per visit** (`host.__tlDrew`, the
  `host.__tlScroll` shape): `renderCalendar` runs on every data refresh and
  `tlMaybeExtend` pages the window in place, so a per-render entrance wears out by
  lunchtime.
- **THE FILTER SWITCH is a FADE, never a cascade.** `renderBookings` runs on every
  data refresh as well as every filter change, so a staggered entrance would replay
  dozens of times a session. Keyed on the filter + search TEXT, not on the render,
  and recorded on BOTH branches — memoing the subject only when rows exist would make
  the return trip from an empty filter read as unchanged.
- **REFUSED, and pinned as decisions**: search results (`__cmdkResults` is rebuilt on
  every keystroke, so any row entrance replays the whole list as you type — this is
  also why the filter is a fade); a `nav()` page transition (twenty-odd views toggling
  `.active`, the offline day sheet among them, which must appear at once); scroll
  reveal; and anything on the money figures themselves, where motion implies a value
  is changing when it is not.
- **NB the gate's own two vacuity traps.** The reduced-motion check reads the
  stylesheet through the CSSOM, because Chromium's emulation forces every
  `transition-duration` to ~1e-05s whatever the CSS says. And the badge pop is
  measured BELOW 1200px: the rail takes over above it and hides the dock outright,
  and a CSS animation does not run on a display:none element — at 1280 the check
  passed in both directions while proving nothing.
- Budgets raised with the real figures: **admin.css 69300 → 70900**, **admin.js
  545900 → 547300**, **app.js 278200 → 278500** (the badge pop is the one motion that
  lives in the shared bundle). admin.css and admin.js are owner-only and
  immutable-cached — the trade CLAUDE.md's own rule names as the cheap one — and note
  that neither is in the deploy's comment-strip list, which covers the four guest
  assets only, so those bytes are shipped bytes rather than prose.

## Today moves (owner-asked, built and pushed to main without tests or CI)

**Asked for as "fix the outline, add animations to the whole today page"**, after a
redesign demo the owner declined ("prefer how it currently is") — so the layout is
untouched and only motion was added. The "TODAY MOVES" blocks in admin.js and at the
foot of admin.css.
- **The outline**: `.bk-row.is-open` (the docked hub's selection) is only given, and
  only styled, where a row and its docked booking sit side by side (`bookingsSplitWide()`
  and `@media (min-width: 1200px)`). On a phone the last opened booking kept an outline
  that meant nothing.
- **ARRIVAL ONCE PER VISIT, NEVER ON A REFRESH**: a MutationObserver arms `__tdArmed`
  when `#view-backoffice` gains `active`, and initBackOffice's first render after it
  plays `tdArrive()`: the header, the Needs-you rows (half-step stagger), the calendar
  bar and panel, the bars drawing in again (`__tlDrew` reset), the now-line dropping and
  pinging, today's number ringed, the bookings caption and first rows. Each element is
  tagged on its own (`tdTag`, cleared after 2.2s), so a re-render just appears.
- **Supersedes "THE FILTER SWITCH is a FADE, never a cascade"**: Upcoming|Past has a
  travelling pill (`chbSeatPill` on `#bookings-filters`) and the rows slide in from the
  side the switch moved to (`bkListSwapped` — still keyed on filter + search TEXT, so a
  data refresh replays nothing); a search rises.
- New Needs-you rows slide in (`__nySeen`, by duty key), the empty state's mark draws
  itself, the + turns to × while its menu is open.
- Reduced motion and the offline day sheet (`tdMotionOk`) skip all of it.

## Five small motions — the snaps in the booking flow (approved demo, built)

**Asked for as "what other little ui upgrades/animations can be added", demoed
side-by-side, refined once, then built.** Five places that SNAPPED. Gated by
**`ui-test-flowmotion.js`** (30 checks, CI-wired by the runner's own glob,
deploy-excluded with every `ui-test-*.js`), each break-tested.
- **THE MONTH PAGE TRAVELS** (`dpChangeMonth` + `.dp-mo-out`/`.dp-mo-in`). It was a
  bare `innerHTML` swap — the most-repeated gesture in the enquiry flow, reading as
  a flicker rather than movement. The GRID alone moves (8px out against the
  direction, 10px in with it, `--dpmx` carrying the signed distance); the month name
  only CROSS-FADES, being the label rather than the content; the **weekday row never
  moves**, because it does not change between months and animating it would be motion
  that means nothing.
  - **THE SUPERSEDE STAMP IS THE PART THAT IS NOT DECORATION.** Synchronous paging
    cannot get this wrong; an animated one can — three quick taps start three flights
    and whichever resolves LAST paints its month over the newest. `dpMonthAnim` is
    bumped by every page AND by `closeDatePicker` (or a close mid-flight re-opens onto
    a grid still held at `opacity: 0` by `dp-mo-out`'s `fill: both`), and the newer
    flight removes-reflows-re-adds the classes, because adding a class already present
    restarts nothing.
  - **IT MADE A SYNCHRONOUS FUNCTION VISIBLY ASYNC**, and ui-test-datepicker's
    admin-back-dating check caught it by reading `#dp-title` in the same tick. No
    production caller reads the DOM after it (the two ‹ › buttons and the PageUp/Down
    handler), so the gate polls now — but check the callers before deferring a render.
- **STEP ONE TO STEP TWO IS ACKNOWLEDGED** (`enquireContinue` adds `.enq-landed`;
  `#enquire-step-details.enq-landed .enq-fg` in app.css). Everything around that
  moment already moves — the range fills as a wave, the send is narrated, the sent
  panel cascades — and the one moment the guest COMMITS was a bare `display` swap.
  - **THE LABEL/INPUT PAIRS ARE WRAPPED, and that is the whole markup change.** Step
    two's children were FLAT, so `> *` would have staggered 16 elements and floated a
    label in before its own field. Six `.enq-fg` wrappers, each carrying its delay
    inline as `--efd` (the `.dp-day` wave's `--dpd` pattern) — no id, class, handler or
    inline style inside them touched. **Measured layout-neutral**: every field box in
    step two is byte-identical before and after, container height 1118px both ways.
    The gate asserts the INVARIANT rather than the boxes — no `label[for]` may sit in a
    different `.enq-fg` from the input it names.
  - **The cadence is deliberately tighter than the three-block one it reuses.** Six
    groups at `.enq-landed`'s own 0.45s/0.26s settle the last at ~0.8s, too long in
    front of a form you want to start typing in; 0.36s across 0.195s of stagger lands
    it at 0.555s, with the heading and first field at ZERO delay so the card reads at
    once. Focusing the name field was deliberately NOT done — on a phone it opens the
    keyboard over the form the guest has just been shown.
- **THE CONTINUE RECEIPT'S FIGURE SETTLES WHEN IT RECOMPUTES** (`.enq-cta-fig`).
  Changing the party made the number simply BECOME a different number. **A settle, not
  a pop**: `payPop` opens at `scale(0.5)` because it means "this APPEARED", which on a
  figure already on screen is a flinch — the lesson `revBow`'s own comment records.
  Only the FIGURE moves (the dates beside it did not change), it is `tabular-nums` so
  the button does not re-flow under it, and it fires on a CHANGE only.
- **AVAILABILITY ARRIVES RATHER THAN MATERIALISES** (`.avail-chip-in`). I first called
  this a layout shift and it is **not** — `.card-avail` already reserves the line — so
  what is wrong is only that the words appear mid-scroll with no arrival. **First fill
  per cottage**, and the flag (`__availShown`) must outlive the ELEMENT:
  `renderCottageGrid` rebuilds these cards and every rates load calls the renderer
  again, so a per-element flag would replay on each price refresh and flicker the grid.
  The weakest of the five — the fetch usually beats the scroll.
- **A TAPPED STAR BOWS AT ITS OWN AMPLITUDE** (`revBowTap` 1.18/0.28s beside the
  shipped `revBow` 1.32/0.42s). The stars already bowed on SUBMIT and nothing happened
  on the tap. Reusing the submit amplitude made tapping a star look exactly as
  important as finishing the review, which flattens the one moment on that card worth
  marking — **the ending has to stay bigger than the beginning**. Only the star you
  TOUCHED (3 → 5 lights the fourth too, but the one chosen is the answer), and
  `.gb2-stars.is-settling .gb2-star.is-on` at (0,3,0) still outranks `.gb2-bow` at
  (0,2,0), so a submit wins on a star just tapped.
- **SAMPLING RULE: SEEK, NEVER RACE — and seek LAST.** Two `evaluate()` round trips
  are enough to overshoot an 80ms animation, so a fixed sample calls a working slide a
  teleport (it did, three checks at once). The gate pauses the animation and sets
  `currentTime`, the discipline ui-test-searchpage §17a already uses on the Siri aura —
  **but a paused CSS animation does not resume into a clean flight**, so every
  natural-flow assertion runs BEFORE the seek and waits on STATE
  (`getAnimations().length === 0`), never a clock.
- **AND §3 WAS VACUOUS UNTIL IT DROVE THE ROUTE.** Written against markup the gate
  composed itself, it proved the STYLESHEET and nothing else: deleting the
  `<span class="enq-cta-fig">` from `updateEnquiryPrice` left it fully green while the
  other four break-tests fired. It drives the real composer now. Fourth time this shape
  has bitten — whenever a pure builder gains a field, gate the ROUTE that fills it.
- **PROSE IS A POOR LEVER ON A BUDGET, again.** Trimming the new comments recovered
  159 gz bytes of app.css and 198 of app.js against overages of ~1000 and ~2100, so the
  budgets were raised with the real number stated: **the gate measures the UNSTRIPPED
  file while the deploy strips comments**, and the actual shipped growth is app.css
  **+257**, app.js **+664**, index.html **+275** gz — about 1.2KB for all five. Check
  the stripped size before reading a documentation-heavy pass as performance rot.

## The motion system — twelve behaviours, one definition each (built from the spec)

**Asked for as "everything looked at and animated as if Apple's designers had done
it", after five rounds of measured proposals; the spec artifact (v2, held to the
HIG) is the record.** The way to animate ~100 controls is not 100 animations: it
is **twelve shared behaviours** — Press · Settle · Appear · Unfold · Travel ·
Cross · Sheet · Alert · Draw · Work · Nudge · Roll — on **four curves**, and every
control assigned to one. PR-A shipped the first ten (Sheet and Alert are PR-B).
Gated by **`ui-test-motion-system.js`** (57 checks), break-tested six ways in
isolation — the listener, the roll's adopt branch, the fold's display, the pill's
seating, the killswitch and the connector each fail their NAMED checks (3/1/2/2/2/2).
- **THE CURVES, and the one rule**: nothing swings past its target by more than
  0.5%. `--out` (Apple's deceleration), `--in` (leaving), `--settle` (critically
  damped — an ALIAS of `--ios-settle`, so one definition), `--sheet` (ζ 0.86,
  peak 1.005, for sheets and travelling pills), `--unfold` (the height curve —
  **declared in app.css now; admin.css's own copy is gone**, the two were the
  same value and two definitions drift). `--spring` (1.56, the bezier that
  overshoots) survives for the one thing built on it — the chat bubble — and
  **no `:active` rule references it** (gated). `payPop` appears from 0.94 with
  no 1.2 hump; the star bows are 1.12/1.06, not 1.32/1.18.
- **PRESS is a constant 4px, not a constant scale.** Measured before: a fixed
  scale moved the 324px CTA 16.2px and the 38px month arrow 1.5px — a 10.8×
  spread for one gesture. `chbPressDepth` (one delegated `pointerdown`) writes
  `--sc = 1 − 4/width` on the way DOWN; every `:active` reads
  `scale(var(--sc, 0.97))` + `brightness(0.94)`, 80ms down on `--in`, 320ms up
  on `--settle`. The five inert controls (Home link, Book again, the payline,
  Copy code, Back to Cottages — four on My Stays) press now.
  **THE RELEASE IS THE BASE RULE'S TRANSITION, and for 19 controls the base rule
  is NOT where you think**: app.css ~11805 carries a late shared group
  ("appended LAST so it standardises the per-component rules") that overrides
  `.hs-step`, `.dp-day`, `.hub-tile`, `.avail-nav`, the close buttons and
  fourteen more. A retime on the component's own rule does nothing for those;
  the group is where the `transform 320ms var(--settle), filter, opacity` lives.
  And a scripted "does this block already mention filter" check was fooled by
  `backdrop-filter` in a COMMENT — `.btn-glass` and `.gallery-nav` took the wrong
  branch and shipped unretimed until the report said MISS.
- **ROLL adopts the bare text node.** `.hs-count` ships as `<span>2</span>`-less
  text; the first `chbRoll` used to wrap it silently and only the SECOND tap
  travelled. The gate caught it ("on the FIRST tap"). `.hs-count` is
  `inline-grid` with a clipped 1.4em window; up on more, down on fewer.
- **UNFOLD is the back office's collapsing grid on the guest side** (`.gb2-fold`,
  `#gb2-pastfold`): `[hidden]` IS the collapsed state, so `fold.hidden` stays
  true the instant it closes and ui-test-yourstay's reads are untouched; ONE
  child (`.gb2-foldin`) because a 0fr track collapses only the first; the
  `.faq-a` max-height and the three chevrons (faq 0.3s, prop-desc 0.2s, gb2-chev
  0.25s) are one clock now — 240ms `--out`.
- **TRAVEL: the pill is a SIBLING, and the chips are toggled IN PLACE.**
  `chbSeatPill` prepends `.chb-pill` to `#exp-filters` / `#hs-month-chips` /
  `.hs-mode` and seats it on `.is-on`; `expBuildFilters`' click handler used to
  rebuild the row's innerHTML, which would destroy the pill mid-flight (gated:
  the tapped chip is still `isConnected` after the move). A chip keeps its own
  fill until the container carries `.has-pill` — no JS, no change — which is also
  why a11y-test's `accentAsText` ratchet FELL 20 → 19. The progress connector
  (`.enq-prog-line`) gained the `.done` state it never had.
- **CROSS replaced the step cascade, both ways.** The 11-animation `payCasc`
  stagger that greeted step two had no mirror (forward 11 keyframes, back 1) —
  a settled 8px cross now, `enq-in-fwd` / `enq-in-back`, and `enquireBack` only
  plays it when step two was really showing (the modal's own open lands there
  too). **ui-test-flowmotion §2 was RE-AIMED, not patched**; its forced path had
  to add `enq-in-fwd` beside `enq-landed`. The cottage calendar turns the page
  like the picker (`#avail-cal-grid.chb-mo-out/in`, stamp-guarded); the lightbox
  decodes the next photo on `#lightbox-img2` before fading — never a blank frame.
- **WORK is not disabled**: `.btn-glass.is-busy` and `:disabled` shared one
  `opacity: 0.6` rule; busy is the pay button's spinner now, no dimming (gated:
  busy opacity 1, disabled 0.6). My Stays waits with two `sk-card`s and
  "Finding your stays, X…" — the welcome sentence used to claim stays over a 0px
  list — and only on a COLD list, so a refresh keeps the last good cards.
- **NUDGE**: `enqFirstProblem` names `focus` for name/address/postcode now, and
  the send caller marks + focuses + nudges (4px, once); the live line's caller
  does not, because it runs per keystroke.
- **The killswitch names pseudo-elements** (`*, *::before, *::after`) — 11 of 14
  `::before/::after` motions ran under reduced motion because `*` cannot match
  one. **CSSOM serialises `*::before` as `::before`**, so a selectorText regex
  for the literal fails on a rule that is plainly there (the gate's first
  version did).
- **Fixture lessons the gate taught, each one a false "the app is broken":** the
  rates stub must send `occupancy` (copied verbatim into `occupancyLimits`) or
  the offline caps clamp 21A to 2 adults and the stepper correctly refuses —
  read as the roll failing; experiences chips render ONLY for canonical
  `EXPERIENCE_CATEGORIES` names; `currentGuest` is a module `let` (documented
  above, re-bitten — `window.currentGuest =` signs nobody in); a `.hs-step`
  probed by `document.querySelector` is the hero's hidden twin (0px, so
  `chbPressDepth` rightly writes nothing) — probe PAINTED controls.
- **Budgets, honestly**: the gate measures the UNSTRIPPED file. Shipped growth
  (comments stripped, gz) is **app.css +1642, app.js +3059**; prose was trimmed
  first, then app.css 81400 → 84297 and app.js 278800 → 282442 — set from
  node-zlib's default level, because python's level-9 gzip undercounted by 740
  bytes and the first raise fell short. tsc budget **714 → 711** (the lightbox
  casts), a11y `accentAsText` **20 → 19**.
- **SHEET and ALERT shipped in PR-B — one exit for every overlay**
  (`chbCloseOverlay`, app.js; gated by **`ui-test-overlays.js`**, 72 checks,
  break-tested six ways). Eighteen of the twenty-two close functions vanished
  their overlay in a frame; four faded on a 350ms timer that kept `open` set
  while they did. The helper is the fold's `[hidden]` discipline for overlays:
  **`open` drops SYNCHRONOUSLY** (every gate, `topOpenDialog` and
  `closeTopOverlay` read it — which is why all 66 test call sites of the close
  functions ran untouched), `closing` paints an inert exit (`pointer-events:
  none`; `visibility` rides the last keyframe so a finished overlay leaves the
  tab order), and **every closing rule is `.closing:not(.open)`** so a re-open
  mid-exit simply wins and the stale timer strips a class selecting nothing —
  the glass dialog's queue opens the next confirm INTO the previous one's exit
  on exactly that. The picker over a glass form keeps **z 6100 while it fades**
  (`dp-over-glass` drops at once because `dpOverGlass()` reads it; at 2100 the
  exit played BEHIND the dialog it came from). Every `.modal-overlay` box
  arrives on `--sheet` while the scrim only FADES — `fluidFadeIn` translated
  the whole overlay, the box's motion painted twice. ≤640px a `.chb-sheet`
  overlay (enquiry, terms, waitlist, welcome book, photo upload, suggest) is a
  **bottom sheet**: edge-attached, top corners only, a grabber, its own
  `--safe-b` padding, up on `--sheet` 480ms and off on `--in` 280ms; the
  reviews family and the account screens deliberately are not. **Four inline
  `max-width` styles moved into `:where()` rules** — an inline style outranks
  the sheet's `max-width: none`, and a bare `#id .modal-box` rule would outrank
  the sheet too. ui-test-safearea re-aimed for the sheet cases: a sheet is
  edge-attached BY DESIGN and carries the home-indicator inset INSIDE as
  padding, the way the guest-shell auth screens already do. The glass dialog
  settles DOWN from 1.08 (the iOS alert never rises).
  **THE GATE FOUND A MODAL THAT COULD NOT PAINT.** `#reviews-modal` sat inside
  the HOME view's `<main>` — display:none on every other view — and its only
  openers are the cottage page's "Read all N reviews" button and the footer
  link, so from the cottage page the button opened nothing visible.
  ui-test-terms gated the button's presence and never clicked it. It lives at
  body level with the other overlays now, and §2b asserts by name that it
  paints from the cottage page. General rule: an overlay's markup belongs at
  body level; inside a `.page-view` it inherits that view's display.

- **§12's PRESS SAMPLES WAIT ON STATE, AND THE FLAKE WAS REPRODUCED BY SLOWING THE
  TRANSITION, NOT BY LOADING THE MACHINE.** "mouse down, sleep 140ms, read" failed in
  three CI runs in four and passed alone: the press is an 80ms transition that only
  advances when frames arrive, and on a loaded runner they arrive late — CI printed
  `.ny-row 2.8px` of 4, a ground at `0.106` of `0.12`, a scale still at 1, a rail row
  still at rest. The earlier one-control fix (`.card`) had not covered the rest of the
  section. Eight-times CPU throttling and twelve busy loops on four cores both left the
  old sampling GREEN, so neither is a reproduction; forcing the probe's
  `transition-duration` to 450ms is — the old sampling then fails six checks with the
  same kind of mid-flight numbers, the new one passes, and a press rule deliberately
  broken fails exactly its own two checks and nothing else (the wait has a 3s cap, so a
  rule that never presses fails on the CHECK, not by hanging). `settled()` polls until
  the value has LEFT rest and stopped moving — and `rest` is settled the same way, so a
  hover still in flight cannot pass for a press. The same pass fixed a second race in
  `held()`: the probe is marked and found in two round trips, and a re-render between
  them crashed the suite with a `TypeError` instead of failing a check. A flake that
  will not reproduce under load is usually waiting on a CLOCK: lengthen the thing it
  waits for and it reproduces on demand.

## Sentence case on the controls — the brand keeps its caps where they are the voice (built)

**HIG proposal 4, demoed on the real pages and then "Build it".** app.css carried
**49** `text-transform: uppercase` rule blocks; the pass leaves **five** — the nav,
the hero kicker and subtitle, and the section kicker, which ARE the brand's voice —
and converts the other forty-four: every button (`.btn-glass` 0.8→0.9rem 600,
`.btn-sm` 0.7→0.8rem 600), field and card labels (`.modal-label`, `.hs-label`,
`.enq-field-label` …), captions (`.gtl-cap`, `.bkflow-lbl`, the pay screen's,
`.accounts-stat .label`, `.settings-section-label`), chips and badges
(`.prop-tag`, `.guest-status-badge`, `.exp-tag`), back links, step labels, the
weekday rows, the stat captions. Sentence case at 600 weight is the house label
(the invoice's own rule, applied to the screens); tracking is removed with the
caps — it was compensating for them. Sizes step UP by 0.06–0.1rem because
lowercase at the caps' size reads smaller; measured, the widths come out close to
even (caps run ~20% wider than lowercase).
- **The ornament under centred section titles is gone** — a 2px gradient rule the
  serif title never needed; its `padding-bottom: 16px` went with it.
- **Caps hide Title Case.** "Log In", "Create Account", "Log Out", "Change
  Password", "Call to Discuss", "Your Name", "UK Address", "Tax Year" all read as
  one shout under uppercase and as wrong the moment it came off; corrected in the
  strings. **And the stylesheet ratchet cannot see an INLINE `style="text-transform:
  uppercase"`** — nine of them in index.html (the enquiry form's six labels, the two
  auth dividers) and admin-views.html (the tax-year label) were converted by hand;
  a markup scan for the attribute is the check that would catch the next one.
- **`check-css-conventions` counts uppercase rule blocks** (`uppercase`: app.css
  5, admin.css 34, guest-app.css 0; may only fall) — the shout cannot creep back one
  control at a time. admin.css's 34 are the owner-side captions (`.bhub-eyebrow`,
  `.acr-cap`, `.bhub-next-cap`, the cmdk captions …), deliberately NOT converted in
  this pass: the demo was the guest surfaces, and the shared button classes carry
  the change into the back office already. The ONE admin rule converted is the
  Pricing page's `.settings-section-label` override — the same class the Manage
  index wears, and one class must be one look (ui-test-manage's caption check
  caught the split the moment app.css changed and admin.css had not).
- Gated by ui-test-smallthings §8 (computed `none/normal` on buttons, labels and
  captions; `uppercase` still on both kickers; the `::after` gone; the CTA's string
  and "Call to discuss" in sentence case) and ui-test-manage's caption check
  re-aimed (sentence case at 600 instead of uppercase).

## The HIG systems — what the whole-site review found stated once each (built)

**Asked for as a whole-site HIG proposal, then "Show me a working demo", then
"Build it".** Three independent reviews over 66 captures found the same row,
caption, radius and material stated differently on every screen; the demo layered
the CSS-only systems over the real app and this PR restates each rule IN PLACE.
Gated by **`ui-test-hig.js`** (9 sections, ~60 checks), break-tested five ways
(the sibling join, the spine media, the sheet surface, the pay CTA, the calm
capsule — 2/4/1/1/1 fire).
- **ONE MATERIAL FOR LISTS.** `bhubFoldGrp` sections (hub, Payments, Manage, Inbox,
  night-ready) and `#needs-you-list .ny-row`s JOIN: no shadow, a hairline, radius
  only on a run's ends, `.bhub-fold-grp + .bhub-fold-grp { margin-top: -12px }`
  closing the containers' own gap (a caption or card between two keeps it). **NB
  `body.light-mode .glass-panel` is (0,2,1)** — it outranked the two-class rule and
  the shadow stayed while the gate said "none" on the rule; restated at that
  specificity, with the glass-panel hover LIFT opted out (a list cell does not rise).
  The Needs-you rail (`border-left`) and the icon tile fill are gone: the capsule
  says the state once. (The `#calendar-list` exemption that once kept the cottages
  apart is GONE — the owner later asked for Calendar sync to be one joined window
  like Payments; see "One window, wherever the rows are one list".)
- **THE CHEVRON IS `BHUB_CHEV`** — one stroke-SVG span constant used at all seven
  disclosure sites (one of them string-concatenated, hence the constant rather than
  a template). `.bhub-chev` is a 14px box; the `›` glyph is gone. ui-test-hub and
  backoffice-motion read its rect and transform, both untouched.
- **ONE CAPTION TIER.** Tracked uppercase stays for section headers OUTSIDE a container
  (`bhub-grpcap`, `bo-sec-title`, `cmdk-board-cap`, `acr-cap`); `bhub-next-cap`,
  `bhub-eyebrow`, `bhub-msg-cap` and `ny-act` are sentence case at 0.82–0.84rem/600
  ("Next · 3 of 5 · Balance", "Enquiry · asked yesterday"). admin.css uppercase
  ratchet 34 → **30**.
- **CALM IS QUIET.** `.st-cap.is-ok` is muted text with `.st-tick` as the one green
  mark; warn/danger keep their tint. Payments' four answer titles lost their inline
  `--ok-text` (a title stays in ink; the trailing figure carries the state). The hub ⋯
  is a circle (`--r-pill`), matching the sticky's phone/mail buttons.
- **THE PHONE'S CHROME.** ≤640 the spine is the sentence then ONE scrolling row of
  32px chips (`.spine-duties` flex/nowrap/overflow-x auto; hit region `-6px 0` so the
  chip still reaches 44) — 77px tall at 390 against ~200. **Two traps the row
  taught**: a column flex that still WRAPS sizes its one line to the items'
  max-content (597px at 390 — the page scrolled sideways, railspine §5 caught it),
  so `flex-wrap: nowrap` is load-bearing; and a scroll container CLIPS its
  children's `::before` hit regions, so the row carries 8px of padding cancelled
  by margin to keep the 44px reach inside the scroll box (smallthings §4 caught
  that one). And **`#admin-head-title`
  is `display: none` below 480**: with six dock icons the slot painted "T." for Today
  and "D" for Debbie. ui-test-adminmenu was RE-AIMED, not patched — hidden at 390,
  named at 480 (a new case), the name still SET at both.
- **GUEST: WELLS LIFT, SHEETS ARE OPAQUE.** `--well-bg` (white 55% light / 5% dark)
  replaces the black-alpha stains on `.enq-host`, `.date-range-trigger`,
  `.guest-price-box`; `.bkflow` is no longer a box in a box. ≤640 the `.chb-sheet`
  boxes and `.datepicker-card` take `--sheet-surface` (the search window's own
  `#f7f4ee` / `#14181d`, already in a11y SURFACES) with no blur — blur over the scrim
  composited to flat grey. At 1280 the modal keeps its glass (gated). The pay button
  takes the accent (green stays for done); free calendar nights are unfilled with a
  hairline; `.avail-cell`/`.dp-day` take `--r-sm`; `.back-link` is 500/1rem in
  accent-text; footer links are sentence case in two left columns at 44px ≤480;
  `.btn-glass.btn-accent`'s 24px rose glow is a 2px lift; `.hub-count` drops its
  border; `.chat-meta` lifts to the 11px floor.
- **NOT built from the demo**: the search rows' shadows (they are inset selection
  edges, not drop shadows — the metric miscounted them) and the cottage page's sans
  h2 (the overriding rule was not found; verify before claiming).
- **THE HEADER IS A BAR** (the demo was asked for, then "Build all"): edge-attached,
  full width, `--bar-bg` (the page ground at 72%) under a 20px blur, a hairline, no
  shadow — the pill's own shadow was the heaviest thing on most screens. ONE rule in
  app.css with the material restated at (0,2,2) (`body.light-mode .glass-panel` is
  (0,2,1)); guest-app.css and admin.css follow (width 100%, no condensed shadow).
  **The safe-area inset moved from `top` into the bar's PADDING** —
  ui-test-acctpreview §C, which measures that the inset is read once and never twice
  inside the preview frame, reads `padding-top` now. `padding-inline` is
  `.container`'s own 1200px centring arithmetic, so the crown and nav sit where they
  did. Containers start higher (90–120 → 78–92 + inset; owner/shell 100 → 80). Gated
  by ui-test-hig §10; ui-test-smallthings §7's "radius untouched" half reads a card,
  the bar having none by design.
  **AND THE STATUS-BAR STRIP WEARS IT IN THE INSTALLED APP** (owner screenshot: a
  solid dark band above the frosted bar). The header already extends under the
  status bar and `black-translucent` is declared — but **iOS 15+ paints a standalone
  web app's status bar with `theme-color` and ignores the translucent style while
  that meta exists**. `setThemeLabel` REMOVES the meta when standalone
  (`navigator.standalone` / `display-mode: standalone`, detected inline because
  `isStandalonePwa` is admin-only) and keeps it theme-matched in Safari, where the
  strip is the browser's own chrome and cannot be frosted by any page. Gated in
  ui-test-safearea (Safari keeps the meta; installed, gone + the header at top 0
  padded past the 59px inset with its blur — NB freeze the header's transition
  before reading its padding, the acctpreview trap, 54 of 67 measured mid-flight).
  **The band survived the meta fix** (second screenshot, light mode: a cream band,
  the LIGHT theme-colour, over the frosted bar) — so the next lever was pulled: the
  manifest's `theme_color` is GONE, and the meta removal is keyed on
  `navigator.standalone` ALONE (the iOS-only signal), so an installed ANDROID app
  keeps its meta, which is what colours its status bar without the manifest value.
  Both halves gated in ui-test-safearea. **Still not verifiable here** (no iOS), and
  two things on the phone can still show a band: Safari, whose strip is its own
  chrome and always flat, and an installed app that has not reloaded to the new
  build — iOS caches the manifest at install, so the honest check is remove and
  re-add to the Home Screen once this has deployed.
  **AND AT REST THE BAR IS THE PAGE** (third screenshot, and it was SAFARI — the
  address bar at the bottom: the strip there is the browser's, tinted with
  theme-color, and no page can frost it). So the only way bar and strip can agree
  is for the bar to BE the ground at the top of a page, which is what an iOS nav
  bar does anyway: the page's own ground until content scrolls under it, the
  frosted material only then. `header.at-top` (setupHeaderScroll, y ≤ 24, every
  mode; in the markup for the first paint) paints the bar `--dark-grey` with no
  blur and a transparent hairline; scrolled, the material returns. The frosted bar
  over the hero photo — a pink band under a cream strip — was the same defect from
  the other side. Gated in ui-test-hig §10 (BOTH states, and the resting colour
  EQUALS the theme-color meta's) and ui-test-safearea (which scrolls before it
  asks for the blur); the resting HEIGHT is the one to assert — condensed it is
  45px by design.
  **SUPERSEDED — THE BAR HAS A TOP AND NO BOTTOM** (four demos, then "Perfect,
  build it"). The at-rest switch closed the seam at rest only; scrolled, a flat
  strip still met a translucent band. The seam is at ONE edge, the top, so the
  fill is graded spatially: `header.glass-panel::before` carries the fill, the
  blur AND a mask, in one `@supports (color-mix and mask-image)` block at the
  foot of app.css — the page GROUND held solid for 16px below the join, eased
  (color-mix stops, smoothstep) into `--bar-bg` through the bar where the crown
  and icons sit, then fill and blur dissolving together over a 44px tail (the
  masked backdrop blur iOS draws its own edgeless bars with). No hairline (the
  header's border is transparent — and the z:-1 layer paints OVER the header's
  own border anyway, per painting order, so a restored hairline is invisible:
  the gate catches it by declaration). `at-top` is GONE (rule, toggle, markup).
  Two traps, both measured: **THE SOLID RUN IS `--dark-grey`, NOT `--bar-bg`** —
  the strip is theme-color = the ground, and the material's tint differs by 2–5
  per channel; two near-equal flats on one row read as a line, which is exactly
  what the owner still saw after the first fade. And **A PIXEL GATE OVER THE
  PAGE GROUND IS VACUOUS HERE**: the material over its own ground is nearly the
  ground, so a deleted mask stepped 2/255 — ui-test-hig §10 measures the tail
  over a CONTRASTING spacer (black under light, white under dark), where the
  eased tail steps ≤6, a hairline ~23, an unmasked edge ~176. Declared on the
  header (not :root) so `var(--safe-t)` resolves where the preview frame zeroes
  it; solid through the inset so the installed clock sits on ground. Gates:
  ui-test-hig §10 (the layer's fill/blur/mask, the 44px overhang, the top row's
  PAINT = theme-color, the fill's first stop = ground and last = the 72%
  material, the contrast-ground step), break-tested four ways; ui-test-safearea
  and ui-test-adminmenu re-aimed to read the layer / the body ground. NB Chromium
  serialises a resolved color-mix() stop as `color(srgb …)`, not `rgb()`, and
  the a11y home scene once caught `#cmdk-sys` under 12-suite load (passes
  alone — a load flake, not a finding). app.css budget 86300 → 87000 (+364 gz
  shipped, comments stripped).
- **THREE RADII** ("Build all"): the CELL `--r-sm` 12 (list cells, fields, chips,
  calendar and picker cells — fold groups and Needs-you rows moved from `--r-md`),
  the CARD `--r-lg` **20** (was 22; every card/well/to-do card reads it) and the
  PILL; sheets keep `--r-panel`. Every raw px radius was mapped onto a token (the
  minified `.mc-*` chat rules carry `border-radius:` with no space, which a spaced
  sed missed — sweep both forms), and **`check-css-conventions` ratchets `rawRadii`**:
  any px radius over 8 that is not 12/20/pill, outside the token definitions. Both
  sheets are at **0**. `.status-hero-mark` is a 28px symbol, `.status-rerun` a tinted
  text button at 44, the income headline's stripe is gone, the two Move-money-out
  fields stand at 44px/17px, the chat header is a ≤60px bar (title 1.15rem/1.2,
  avatar 32, padding 6 — the ✕ is the 44px floor that sets it), the terms sheet
  carries ONE close (the foot markup + both rules deleted), `.dp-day` is 44px tall
  in a 16/12-padded card, and grid batch two's named declarations are snapped
  (app.css offGrid 581 → 573). Gated by **`ui-test-radii.js`** (§1–§5).
- **ONE TYPE SCALE** ("Build all", PR-3): eight steps as `--fs-*` tokens in app.css's
  `:root` — micro 11 · caption 12 · sub 13 · body 15 · headline 17 · title 22 ·
  display 28 · hero 34 — in **rem** (a reader's own text size still scales the page),
  and every `font-size` in the three sheets, the two markup files and both JS
  bundles' templates is one of them (nearest step, ties down: 16 → 15). Before: 61
  distinct declared sizes in app.css, 55 in admin.css, ~210 inline. What the
  mechanical rewrite could NOT judge, each done by hand: `body` and the bare `h1–h3,
  h5, h6` get element defaults (the UA's 16/32/24/18.72/10.72 are not steps and a
  stray span or section h2 inherited them); `--fs-h2`/`--fs-h3` alias title/headline
  and `--fs-h1`'s clamp FLOOR is the display step (a phone read 30.4); the fluid
  `clamp()` sites (logo, hero p, `.lead`, `.card-title`, `.cal-month-title`, terms h2,
  `.heritage-num`, `.guestwords-quote`) are a phone step + a desktop step behind ONE
  `@media (min-width: 641px)` block at the foot — the pair Apple's text styles state
  per size class; **the mobile `input, select, textarea { 16px !important }` and
  `.input-glass` take HEADLINE (17), never body (15)** — 16 → 15 there would bring
  back iOS's zoom-on-focus; the `font:` SHORTHAND (16 sites, `.tl-seg button` among
  them) needed its own pass — a `font-size:` regex sees none of them; and the
  `--cmdk-fs-*` scale is untouched (its own gate, §16b). Gates: **`ui-test-typescale.js`**
  sweeps every painted size on 12 guest + owner screens at 390/1280 (tolerance 0.3px —
  0.8rem's 12.8 fails; `#cmdk`, the timeline day cells and sizes over 36px excluded by
  name; vacuity ≥8 per screen) and **`check-css-conventions` ratchets `rawType`** (any
  rem/px `font-size`, longhand or in a `font:` shorthand, ≤40px) at **0** in all three
  sheets. The sweep found what the rewrite missed on its first run (18 screens off) and
  the three shorthand buttons on its second, which is the gate doing its job. NB the
  budget gate reads the UNSTRIPPED file: app.css raw gz +379 while the SHIPPED
  (comment-stripped) file fell 102 bytes and admin.css 159 — a `var(--fs-sub)` gzips
  better than forty spellings of 0.8rem. One gate re-aimed: ui-test-chat-layout's
  "hit its cap" compared clientHeight to a border-box `max-height` (two hairlines
  apart) and failed the day the field took one more line at 17px; it reads offsetHeight.
  Two more in ui-test-smallthings, neither about type: its `d()` took the UTC date
  while the page reads Europe/London, so between 23:00 and midnight UTC under BST the
  last-morning fixture had already ended and "10 days to go" read 9 (the documented
  clock class, caught because the gauntlet ran across midnight); and §6's rag
  calibration pinned the column, which stopped orphaning at 15px — it SWEEPS the
  column narrower until the plain wrap does orphan and asks the rule there.
- **ROUND EIGHT** ("What next", demoed as sliders, then "Build all"): the current build
  driven again after the three PRs above — twelve screens at 390 and 1280, probed for
  truncation, orphans, sub-44 targets and ink overlap, then looked at. Nine survived,
  all built, gated by **`ui-test-round8.js`** (47 checks) plus two re-aims:
  - **The cottage title painted Montserrat.** `[data-edit-text] { font-family:
    inherit }` ties with `.section-title` on specificity and sits later, so the one
    page title carrying the attribute — the cottage's h1 — lost the serif at 28/48px
    while every other title kept it. The old note's "verify before claiming" is
    settled: `.section-title[data-edit-text]` at (0,2,0). Measured by computed face.
  - **Reach 44, where round seven never went**: the search chrome (clear 24, pin and
    help 32, close 34, chips and scope 29), the hub's contact links (email 25px, the
    tel link 19px tall), the picker's month arrows (38), Today's money pill (26), the
    deposit stepper's ± (38) and the theme switch (32). `::after` hit regions on all
    of them; nothing on screen changed size. The gate measures the EFFECTIVE region
    (element box grown by any absolutely-positioned pseudo), the same arithmetic the
    demo's green/red boxes drew.
  - **A sub may take two lines.** `.ny-sub`, `.bhub-fold-sub` and `.cmdk-row-sub`
    are a two-line clamp now (`-webkit-box`), and the gate asserts NO sub loses words
    at 360 or 390 — sideways OR past the clamp — on Today, the enquiry hub, the Inbox
    landing and the search rows. **The copy half is real and the gate found it at
    360**: beside a 102px "Due now" capsule the search row's sub has 144px, and
    "£960.00 still due · Pimpernel · out 25/09/2026" needed a third line; it reads
    "£960.00 due · Pimpernel" — the capsule carries the urgency the date implied
    (golden's `still due` pin re-aimed to `due`).
  - **The lane monogram**: below 640 the timeline lane (54px) paints the cottage's
    INITIAL beside its dot — "J", "P" — where the short names read "Jolly" and
    "Pimp" (and even "Pimp" was clipped 7%); a code of up to three characters (21A)
    keeps its code; the full name rides `aria-label`; above 640 the short name still
    paints. Both spans are in the markup, CSS chooses.
  - **State said once on the bookings list**: `.bk-row.pay-*`'s 3px rail is
    `transparent` (kept, so geometry is unchanged); the chip is the state.
  - **The guest's journey is a caption.** `guestFlowHtml` renders `.bkflow-cap`
    ("Next · 3 of 7 · Balance") in place of the five-pill strip — the ASK per stage
    key, never the past-tense `glabel`; a stay in progress carries `data-staying`
    and the ok ink. The pill CSS is gone; search-test's two flow checks re-aimed.
  - **The rag is the default**: `p`, the when-line, feature subs, the stayed-before
    chip, the quoted enquiry message, the accounts note, settings subs and search
    row labels wrap `pretty`. And two units hold: `.gb2-ref` (the ref stayed alone
    on a line even under pretty — pretty avoids a lone WORD, and "CHB-000003" is
    one) and `.gb2-pl-unit` ("£300.00 to pay" broke before "pay" beside the serif
    figure).
  - **Small**: `.bhub-kv-label` reads at 13px sentence case on a 96px column; the
    bookings caption says "· 3 upcoming" (it wrapped as "· 3 bookings / upcoming"
    beside its capsule at 390).
  - **THE SEARCH WINDOW IS ON THE APP'S SCALE** (the one decision, taken): the six
    `--cmdk-fs-*` tokens resolve to app steps (hero → title 22, lead → headline 17,
    body and row → 15, sub → caption 12, micro → 11) and the phone's hero
    re-declaration is gone. ui-test-searchpage §16c now asserts five DISTINCT
    descending sizes ≥1px apart and that every token IS an app step; §16b reads the
    tokens so it passed untouched; ui-test-typescale sweeps the window (its `#cmdk`
    exclusion removed, a search-answer state added at both widths).
  - NB the sweep's first gate run reported the search sub as `display: flow-root`
    — Chromium reports `-webkit-box` that way; the clamp works, read `scrollHeight`
    against `clientHeight` to know. **And a hit region inflates `scrollHeight`**:
    ui-test-searchpage §13's overflow detector read `scrollHeight − clientHeight`
    and flagged the scope chips (+8) the moment their `::after` region landed —
    no text had moved. It measures the INK now (a Range over the element's text
    against its box), break-tested against the original clamp defect it exists
    for (+100 restored, 0 clean). The property is not the pixel, again. **And
    a11y §8 had pinned the rail** ("a guest arriving today gets the sea-blue
    traffic-light edge") — it asserts the CHIP now: its dot is `--info` and its
    ink clears AA on its own 14% tint, composited from the TOKEN, because reading
    the computed `color-mix` tint back gave `color(srgb …)` in 0–1 floats and a
    false 4.37:1 where §1b measures 4.64 — the sixth false contrast reading this
    codebase has produced, same trap as the first four. Budgets raised with the trade: app.css +100,
    app.js +288 (the caption + units), admin.js +250 (the monogram), admin.css +500
    (the regions and the clamp).
- Budgets raised with the trade named: app.css 85077 → 85600 (the sheet/well/footer
  rules, comments stripped at deploy), admin.css 71827 → 73300, admin.js +150 (the
  chevron constant).

## Seven small things — round seven of the measured sweep (built)

**Asked for as "keep going" after the HIG assessment; nineteen guest and owner
screens driven at 390 and 1280 with every control inventoried.** Gated by
**`ui-test-smallthings.js`** (28 checks), break-tested six ways.
- **`.btn-primary` HAD NO RULE.** Seven guest controls used it — the last-morning
  "We've left the cottage" tap, both empty-state "Message us" buttons, the welcome
  book's pay/message buttons, both "Try again"s — and rendered as the browser's
  default button (measured: `#efefef`, 2px black outset, square corners). No gate
  could see it: the suites read text and names, never paint, and a class with no
  rule is invisible to a stylesheet scan because there is nothing to scan.
  **check-css-conventions now carries a HARD invariant**: every `btn-*` token used
  in the markup or the JS templates must have a rule in one of the three sheets
  (vacuity-guarded at ≥5 tokens seen). The gate asserts the PAINT (background ≠
  the UA grey, border 0, pill, 44) — and NB read `--accent` off `document.body`,
  where light mode retunes it; reading `:root` compares against the dark value.
- **THE MESSAGES PILL STANDS DOWN ON MY STAYS while a hub is up** (`:has(…
  .my-stay-hub) #guest-msg-fab`, the privacy-page mechanism): every hub carries
  Contact host, which opens the same chat, and at 390px the pill covered 364px² of
  the countdown badge's "days to go". A guest with no hub keeps it.
- **THE COUNTDOWN IS SAID ONCE.** The pre-arrival head read "Jollyboat — 10 days"
  beside a badge reading "10 DAYS TO GO"; the duplicate forced the name onto two
  lines (a 180px column). Title = the name; ui-test-yourstay's two pins re-aimed
  to assert the ABSENCE in the title and the figure on the badge.
- **HIT REGIONS, NOT BIGGER CONTROLS.** The docks' 38px buttons (34 condensed),
  the spine's 34px chips and the 32px calendar refresh keep their look; a
  `::before` at `inset: -5px` takes the region past 44 (the HIG's own allowance).
  `::after` on both docks is the hover label, so the region is `::before`.
  Neighbours overlap inside the 6px gap ON PURPOSE — a tab bar's contiguity — so
  the gate accepts a probe landing on a sibling dock button, never on nothing. The
  spine chips grow vertically only (`inset: -5px 0`), being already wide. Where a
  control was simply short — the hero's mode switch and ± chips, the cottage
  calendar's ‹ ›, the hub ⋯ — it stands at 44 now. The `.tl-seg` group stays 32:
  a documented small-control family, and its `overflow: hidden` would clip a
  region anyway.
- **THE 11px FLOOR.** a11y §4's floor is 11 (Apple's 11pt), up from 10. Nineteen
  declarations between 0.6 and 0.68rem were lifted to 0.7 — the timeline day
  numbers (9.9px on a phone, 9.6 compact), the cottage calendar's weekday row,
  the hero labels, `.btn-sm` (10.9px uppercase on a control), the stay captions,
  every `prop-tag`, the enquiry step labels (a `clamp()` whose floor was 0.62rem)
  and the hub/settings caps the a11y scenes walk. **Still under 11 and left, by
  name**: the mac-chat notes (`.mc-day-note`/`.mc-act-note` 0.62), the rail
  keycaps, `.acp-main`, `.pay-amount-label` 0.62, `.exp-tag`, `.needs-reply-pill`,
  `.chat-bot .cb-meta`, `.gwx-s`, `.mav-dow`, `.oq-count` — none on a screen the
  scenes or the gate walk; the a11y count is a ratchet at 0 on the walked screens,
  not a whole-site census. The changeover ↺ glyph stays 0.6 (a mark, not words).
- **THE RAG**: `text-wrap: pretty` on the guest notes (`.card p`, `.things-note`,
  `.pay-error p`, `#exp-empty p`, `#exp-grid p`). The gate counts the WORDS on the
  last line by ranging each word — "it below." with the rule, "below." with
  `text-wrap: wrap` injected — because a width threshold is a guess dressed as a
  number, and `pretty` only promises no lone word.
- **A STUB THAT MATCHES `bookings.php` MATCHES `my-bookings.php` TOO.** The gate's
  first draft served the owner's booking list to the guest (a 6-day badge from a
  stay the guest never had) because `url.includes('bookings.php')` sat above the
  my-bookings branch. Order the specific route first.
- **CONTINUOUS CORNERS, behind `@supports (corner-shape: superellipse(1.5))`**
  (HIG proposal 3): header, panels, cards, modal boxes, the dialog, the picker
  card, buttons, fields and chips take the squircle iOS draws; Safari 26 and
  Chromium 139+ render it, every other engine keeps the circular arc at zero
  cost, and no radius changes — the curve, not the size. Measured: this
  container's Chromium 141 draws it (`CSS.supports` true, computed
  `superellipse(1.5)`). Gated by ui-test-smallthings §7 (the CSSOM rule, the
  computed value where the engine supports it, the radius untouched).

## The guest pay screen tells the WHOLE money story (the approved v2 + motion)

Three additions to `view-pay` (index.html) rendered by `openPayView`/`payWithToken`
(app.js), styled in app.css's pay block. Gated by the existing ui-test-pay strings
(all additive — its 60+ checks run untouched) plus a11y §1b, which caught the one
real defect (below). Browser-verified in all three states on the ui-test-pay stubs.
- **THE JOURNEY** (`payJourneyRender` → `#pay-journey`): deposit → balance → deposit
  back as dotted rows with "you are here" marked, every figure re-using what the
  amount note already derived (`payTotal`, the same `rest`, `paidSoFar`, and
  `dep > 0 ? dep : depCharged` for the money that comes back) so the journey and the
  hero cannot disagree — measured reconciling: £225 today + £525 balance = the £750
  grand, and the £50 rides both sides. The legacy HOLD flow gets no journey (its
  wording is its own era), and a one-row journey is hidden — it would state nothing
  the hero hasn't. `payState.jBack`/`jDue` stash the two figures the done panel
  needs, because it renders after the screen's locals are gone.
- **THE STAY'S OWN COLOUR** (`#pay-stay-band` + `.pay-stay-cap`): the cottage accent
  as a 4px band over the card, and the stage as a capsule beside the dates —
  "✓ Dates confirmed" on a balance, "Dates held for you" (warn tint) on a deposit.
  Safe to `insertAdjacentHTML` every open because `propEl.innerHTML` is rewritten
  first; the hold flow gets neither.
- **MONEY IN FLIGHT ANIMATES; money at rest is still.** The is-now dot pings
  (`pjPing`), a busy Pay button spins (`::before`) and shimmers (`::after`), success
  is a GREEN BEAT on the control before the done panel replaces it (`payBeat` —
  ~1050ms, skipped under reduced motion; '✓ Paid', or '✓ Hold placed' on the hold
  branch), the receipt's tick draws itself (`payDraw` — a display flip restarts CSS
  animations, so no JS), and My Stays' plan dot pings only while the plan is NOT
  troubled (red is not "on its way"). All stand down under `prefers-reduced-motion`
  (`content: none` kills the busy pseudo-elements).
- **THE UNHURRIED PAYMENT (approved tempo demo).** The SUCCESS choreography runs on
  a slower clock — beat hold 650→1050ms, beat pop 0.45→0.7s, tick draw 0.5→0.9s
  (delay 0.25s), halo 1.1→1.7s (delay 0.75s, scale 1.6), receipt cascade 0.7s with
  the last line landing at 1.65s, steps unfold 0.7s, step pop 0.55s, journey ping
  2.4→3.2s — while everything that runs during the WAIT keeps its speed (spinner
  0.7s, sweep 1.1s, the narration's 400ms reveal), the DECLINE keeps its quick
  settle (bad news is read, not savoured), and My Stays' plan dot keeps 2.4s (a
  resting screen, not the moment of payment). The enquiry flow's beat (650ms) is
  likewise untouched. NB any gate that reads the DONE PANEL after clicking Pay must
  wait on STATE, not a fixed clock — two ui-test-pay sites raced the longer beat
  and were re-aimed to `waitForFunction(pay-done visible)`; checks that only read
  the captured charge POST are unaffected (the charge lands before the beat).
- **`.pay-cta.is-paid` is 15% `--ok`, not stronger** — a11y §1b measured `--ok-text`
  on a 28% tint at **4.15:1** both themes; 15% reads 4.65/5.13. The §1b scanner
  found the pair the day it was written, which is that gate doing its job.
- **THE DONE PANEL SAYS WHAT HAPPENS NEXT** (`payDoneNextRender` → `#pay-done-next`):
  received ✓ / the rest (autopay-arranged wording off `res.autopay`, else the
  balance with its due date) / arrival details a week before / the deposit back —
  paying never dead-ends. Additive beside the unchanged spoken sub, so every gate
  reading `#pay-done-sub` still fires.
- Deliberately NOT built (re-gate first): the two-option plan choice cards (the
  consent radio flow is gate-pinned) and a two-line pay button (gates read
  `btn.textContent` as one string).
- **THE WAIT IS NARRATED (v3 — the refined demo, built).** `#pay-steps` under the
  card form: Preparing your payment → Checking with your bank → Taking the payment,
  ticking on the REAL callbacks (step 1 covers `tokenize(verificationDetails)`, where
  3-D Secure actually runs; step 2 turns when `payWithToken`'s charge posts). Three
  rules, each in payStepsArm's header: it EARNS ITS PLACE (unfolds via a grid-rows
  reveal only after 400ms of waiting — a fast payment never sees it), it ACKNOWLEDGES
  TIME (a bank step still running at 2s changes its line to "still with your bank —
  open your banking app"), and it NEVER INVENTS PROGRESS. Card path only — wallets
  have their own sheet, the legacy hold keeps its wording. On failure the list folds
  away before the message settles in (`.pay-msg.show` carries a damped-slide keyframe
  now). ONE PULSE, ONE PLACE: payStepsArm swaps the journey's `is-now` ping for an
  `is-run` spinner and payStepsEnd settles it to `is-done` (or restores it on
  failure) — note a part-field re-render mid-charge would resurrect the ping
  (harmless, display-only).
- **THE JOURNEY FOLLOWS THE SLICE** (`payJourneyRowsFor` + `payJourneySync`, called
  from payPartRender): arming a part payment used to re-price the hero, button and
  wallets while the journey kept saying "Balance — today £525" — two statements of
  one payment. The "you are here" row becomes "Today — part payment", the remainder
  gets its own row with the due date, and closing the part row restores everything.
  payState.jCtx is the stash (cleared on hold/hidden) so sync re-renders the same facts.
- **AN ARRANGED BALANCE SAYS SO** (openPayView, gated `armed && !autopayRepair`): hero
  label "Balance · already arranged", an `is-arr` journey row (sea-blue `--info` dot —
  handled, not "you are here") naming the collection date, the button demoted to
  `.pay-cta.is-quiet` "Pay £X now instead", and `#pay-armed-note` says what paying
  early does. A TROUBLED armed plan (autopayRepair present) keeps the full-strength
  ask — its affordance is the repair card, never "nothing to do". The armed chrome is
  set BEFORE the partView snapshot so a part open/close round trip restores it.
- **MONEY COMING BACK SHOWS ITS JOURNEY** (`guestDepositTrackerHtml`, past-stay cards
  on My Stays): issued (= `hold_settled_at`, already in `SELECT b.*` — NO server
  change) → your bank (+5 working days), solid fill = days behind you, "Day N of 3–5
  working days" in words, retiring after 6 working days. Renders only for
  `holdStatus 'returned'` with a real returned figure and a dated settle.
- **THE RECEIPT LANDS WHERE ITS PROMISES LIVE** (`payDoneBackRetarget` on both done
  branches): a signed-in guest's exit becomes "View your stay" → `payDoneStays`
  (nav + a FRESH renderGuestBookings, so the card shows the payment that just
  happened); an email-link guest keeps "Back to the site". NB `currentGuest` is a
  `let` — a harness poking `window.currentGuest` cannot reach it, which is why the
  signed-in branch is verified by calling the retarget helper, not by assignment.
- **The Apple-polish motion set**: `payPop` on completed dots (steps + journey),
  `payPop2` beat on `.pay-cta.is-paid`, a one-shot `payHalo` behind the receipt tick,
  `payCasc` nth-child cascade on the done panel, `paySettle` on the decline message,
  and journey/step separators inset to the text edge (`.pj-row + .pj-row::before` at
  left 36px — the border-top rule is GONE, anything styling it must move too). The
  loading state is a skeleton in the coming screen's shape (`.pay-sk-box`). All
  motion stands down under reduced motion (the unfold's transition is explicitly
  none'd there).
- **Deliberately not built**: the demo's "Sending your receipt…" animation (the server
  has already sent it by the time the response arrives; animating it would be the
  invented progress the narration rules forbid). The plan choice cards, once deferred
  here, are BUILT — see the plan-first block below.
- **THE PLAN COMES FIRST, AND THE METHODS FOLLOW IT (the approved plan-first
  demo).** `#pay-autopay` sits ABOVE the express checkout now: the plan is a
  decision about the STAY, so it lives where every guest passes it — below the
  card form, a wallet guest paid through the top buttons and never met it.
  **`payMethodsSync()` is the one decider**: an automatic choice stands the
  wallets down WITH the reason on screen (`#pay-walnote` — Square cannot keep a
  WALLET card on file for merchant-initiated payments, verified against their
  docs; the note names the way back), 'self' restores them, and the
  divider/card-label pair are complements of ONE expression there (the
  mountWallets one-label rule moved home — a late wallet mount calls sync, so
  it can never resurrect buttons a chosen plan stood down). Step chips 1/2 ride
  `#pay-ap-cap`/`#pay-today-cap` (step 2 only while step 1 shows; its figure is
  read off the PAY BUTTON's own text — one source for the ask). **One consent
  sentence** (`#pay-consent`) above the button restates the whole arrangement
  per choice, so the wallet sheet and the card form make identical promises.
  **The belt**: walletPay refuses a chosen plan BEFORE tokenize — consent must
  never ride a wallet token (the save would fail and the guest would leave
  believing a plan was arranged that was not). **The error is said once**: a
  pure field-validation tokenize failure prints NO banner (Square's iframe
  already says "Enter a valid card number" inline — ours restated it beneath,
  two voices for one mistake); non-field failures keep the banner. Gated by
  ui-test-pay's PLAN-FIRST block (DOM order, stand-down both ways, consent per
  choice, the belt as a source assertion ordered before tokenize, both error
  branches); the old `lblEl` source pin re-aimed to payMethodsSync.

## The cottage cards are ONE shape, whatever the cottages are called

Reported from a phone: the cards don't lay out the same way. They didn't — and it was never
a second template, since all of them come from `cottageCardHtml()`. The **name and the rating
were siblings in a WRAPPING flex row**, so a card's anatomy came down to a pixel comparison
against owner-editable text. Measured at 402px with 344px of card: 21A needed 245+122+12 =
**379**, Jollyboat **343**, Pimpernel **362** — so the rating sat beside Jollyboat and under
the other two, making its card **380px against their 413**. Jollyboat cleared it by **ONE
pixel**, and the comparison moves with the screen (all three wrap at 390px, one is inline at
402, two at 430), so the same list was tidy on one guest's phone and mixed on another's, and
would flip the moment a cottage was renamed in Settings.
- **The name owns its own line; the two REFERENCE facts share the line under it** — `.cott-facts`
  holding `.card-rating` + `.card-meta` as "★ 5.0 · 16 reviews · Sleeps 2". Price and
  availability keep their own lines: they are the DECISION, not the reference. Flat **384px**
  at every width, one row shorter than before. The separator is
  `.card-rating:not(:empty) + .card-meta:not(:empty)::before`, conditional on BOTH, because a
  cottage with no occupancy set renders an empty `.card-meta` (`cottageSleepsLabel` returns
  `''`) which used to be a whole empty uppercase row carrying its own 15px margin.
- **The CSS is UNSCOPED and index.html's six static fallback cards were rewritten to match.**
  Both grids render from the same function, so scoping to `.cottages-list` would let the
  homepage drift; and the static pre-JS cards (two shapes — the homepage set has no
  `.card-rating`) are what crawlers and the first paint see. `.cott-head` is GONE everywhere.
- **`renderCottageGrid` now repaints the AVAILABILITY too.** It called `renderCardPrices` and
  `renderCardRatings` and not `renderCardAvailability`, which is filled by a single call after
  `loadAvailabilityAll()` resolves — and `loadRates` rebuilds the grid after that. Measured:
  every card settled with **no "Available from …" at all**. It only looks fine if you
  re-render by hand before reading it, which is how the first version of that gate passed
  with the fix reverted; the gate captures the chips AT REST now, before anything re-renders.
- **The Messages button moved to the bottom RIGHT.** Every card row is left-aligned and none
  reaches the right edge; on the left it sat on the words — at 402px a price reads x 28..238
  and at scrollY 74 sits at y 808..833, through the button's 764..824 band, so x 12..76
  covered 48px of it (the owner's screenshot, with "from" hidden).
- **MEASURE THE INKED TEXT, NOT THE ELEMENT BOX.** `.card-title` is now a plain block spanning
  the whole card, so a box-based overlap sweep reports the button covering names whose words
  stop 89px short of it — it produced a confident "15 of 31 scroll positions" that was pure
  artefact. A `Range` over the contents gives what is actually painted. Same family as the
  contrast traps: the box is not the ink.
- Gated by **`ui-test-cottagecards.js`** (24 checks: one row order, identical heights swept
  360-430px, a hostile 40-character name that takes two lines and moves nothing, the empty
  occupancy case, availability at rest, the button sweep, and the homepage grid matching), each
  declaration break-tested — reverting the flex row reproduces 413/380/413 exactly. NB
  line-sharing is decided on `left`, never `top`: these rows are baseline-aligned, so a tall
  name and a small rating on ONE line still have very different tops, and testing `top`
  reported "wrapped" for every inline case.

## Reading an email: their new words first (built from the approved demo)

**Asked for after a screenshot of a guest's one-line reply sitting above 40 lines of our own quoted email,
a signature and "Sent from my iPhone".** The Email reader (`mailboxOpen`, admin.js) now shows what they WROTE
and folds the rest. Gated by **`ui-test-emailreader.js`** (21 checks, break-tested twice: the reader showing
the raw body, and the importance call forced) and smoke-test's `email split` / `importance` block (12).
- **`mbxSplit(raw)` is pure and NEVER leaves the reader empty.** It cuts at the first Apple/Gmail "On … wrote:"
  header (also when wrapped over two lines), an Outlook `From:/Sent:` block, a `-- Original Message --` rule or a
  run of `>` lines, and peels a trailing "Sent from my iPhone / Get Outlook / `--`" signature off what is left.
  Three refusals keep it from hiding the message: an email that BEGINS with a header or a quote is shown whole
  (nothing to isolate), a mid-message "wrote:" is not a header, and if no body survives the whole text is the body.
  The quote, signature and **Whole email** are each one tap (`.mbx-fchip` → `mbxToggleFold`, a 0fr grid fold), so
  nothing is ever lost to the tidy view.
- **"Replying to:"** is the question or time/£ sentence in OUR latest sent email to that address before the
  message (`mbxReplyingTo`, read from `__mbxSent`) — what a one-word "yes" is answering.
- **Earlier emails are SORTED by whether they matter** (`mbxEarlierSmart`): the list carries headers only, so their
  earlier emails are fetched (≤6, cached in `__mbxBodyCache`) and our sent replies (≤4) are already held. Each is
  scored by `mbxScore` — transparent signals with weights (amount, time, date, party/dog/allergy, access, change,
  question, attachment; bar 3; a short acknowledgement scores 0 unless it carries a time/amount/change/file).
  **RULES, NOT A MODEL**: every call is explained by its tags and the facts are marked in the text. They sit in ONE
  "Earlier in this conversation" section (summary "N emails · M worth a look"): emails with facts first, their words
  with the facts marked, the rest one-line rows; every row opens its email. The Important / Not important override
  buttons were REMOVED as complexity (`mbxMarkImp` survives, unused). The reader's actions are Reply plus one even
  row, Mark unread / Delete / Close. Until the fetch lands the plain
  chain stands; a fetch that fails just omits that email.
- **Reply quotes only their new words, cursor ABOVE the quote.** NB a textarea drops the first newline of its
  initial text, so the value starts `\nOn …` not `\n\nOn …`; the gate allows either.
- Budgets raised with the trade named: admin.js +3.3KB, admin.css +0.6KB gz (owner-only, immutable-cached); tsc
  app budget 707 → 705 (the new code adds none and the typing of `items` removed seven).

## Declining stops being the end of the conversation

**A guest promised a reply "always by the end of the next day" got silence, and the
app told the owner the opposite.** `send_enquiry_ack` makes that promise; the decline
path requires no mailer and calls no `send_*` at all, so nothing was ever sent — while
the in-app help topic said *"Approve… edit, or decline — **each emails the guest**"*,
so the owner declined believing it was handled. (Editing IS silent, and is documented
as such; decline was documented as the opposite of what it does.) Three parts, gated by
**ui-test-mailbox §11/§11b** (17 checks) and search-test §26:
- **`declineEnquiry` ASKS, and never sends.** After the successful post, an enquiry
  with an email raises a `glassConfirm` ("…is expecting a reply", ok label "Write the
  reply") that routes to the existing `enqReplyDraft`. **Never automatic**: the owner
  may have already phoned, and a canned apology after a real conversation is worse than
  none — so "Not now" is a complete answer and falls through to the unchanged toast with
  its Undo. No email address → no ask at all.
- **The captured ROW is handed over, not its id.** Declining is a soft delete and the
  list query is `declined_at IS NULL`, so by the time `loadData()` has run the record is
  out of `enquiries` and an id lookup finds nothing. `openEnquiryEmail` therefore takes
  an id **or** the enquiry object; every other caller still passes an id. Break-tested —
  passing `enqId` there yields an empty composer.
- **The drawer keeps the offer** (`emailDeclinedEnquiry`, reading `__declinedEnq`), so a
  decline made in haste can still be answered an hour later. NB the row already spends
  165px on "Put back in Waiting" at 390px, which is the documented squeeze that rendered
  "Pimpernel" as "Pl…" — the second button is gated at 390px for exactly that.
**AND THE DRAFT ITSELF HAD THREE DEFECTS, all on EVERY enquiry reply, not just declines.**
Found by driving `chbDraftEnquiryReply` for real and rendering the result through
`build_enquiry_reply_email` — which nothing had ever done, the drafter being JS-gated and
the template PHP-gated:
- **It greeted the guest TWICE.** The template opens every reply with its own
  `email_p('Hello ' . $name . ',')` — it has to, since an owner typing a bare message
  still gets one — and the draft opened with "Hi <first>,". Every drafted reply shipped
  reading "Hello Rachel," / "Hi Rachel,". The template owns the greeting; the drafter
  owns the body. Gated from **both sides, because neither is sufficient**:
  test-emails-render §6 counts greetings in the RENDERED halves (and proves the counter
  can tell one from two), search-test §26 asserts the body does not greet.
- **It offered to go and look for alternatives it already had.** On taken dates it wrote
  "I'll gladly find the nearest we can offer" while `enquiryFreeNearby()` — which the
  enquiry hub prints on the screen directly above that button — already knew. It names
  them now ("18–22 Sep 2026 and 26–30 Sep 2026 are free…"), falling back to the old
  sentence only when the scan finds nothing.
- **It quoted a price for the dates it had just refused.** The quote line was
  unconditional, so "The total for your stay would be £556.20 (4 nights)" landed directly
  under "those exact dates are just taken". Gated on the FREE branch keeping its quote,
  so this cannot become "never quote".
NB the sample in test-emails-render's registry greeted too, so the owner's own preview of
this template showed the double greeting; de-greeted with the fixture. And **ui-test-hub
§J answered that new dialog `true`**, which opened the composer and left it covering the
page — section L's clicks then timed out 90 lines later. A suite that resolves a dialog it
did not raise will do this every time a new ask appears; it answers "Not now" now, which
is the path that section is actually about.

## The declined drawer says what it is

Reported from a phone (screenshot): the Declined tab showed a green **0** and "All caught
up — nothing needs a reply" directly above a list with a row in it.
- **`mapEnquiryFromApi` DROPPED `declined_at`.** enquiries.php's `declined` action
  `SELECT *`s and `ORDER BY declined_at DESC` — so the server sends and sorts by the one
  fact that identifies a decline, and the client threw it away. The row now leads with
  it via `relTime` (the inbox's own recency vocabulary: "Yesterday", "5 Aug"). That is
  NOT a breach of the DD/MM/YYYY screen rule — a numeric date is for comparing dates
  against each other, and the question here is how long ago.
- **THE HEADING NAMES THE LIST BENEATH IT.** The h2 is "Enquiries" + the WAITING count,
  which on this tab described nothing on screen. It reads "Declined enquiries" while the
  drawer is open, and the badge is hidden **by CLASS, not emptied** — `refreshInboxBadge()`
  lives in app.js and runs from a dozen places, so an emptied badge is written straight
  back. The heading TEXT is safe to set in `renderInbox`, which is the only thing that
  switches tabs.
- **`inboxSubline()` only ever counted WAITING work**, hence the "All caught up" caption
  over a non-empty list. The drawer gets its own line.
- **ARCHIVED WITHOUT DIMMING ANYTHING — two attempts measured as contrast failures
  first.** `opacity: 0.72` on the row body composites every ink toward the ground: the
  guest's quoted message fell to **3.05:1 dark / 2.75:1 light**. Tinting the ground with
  `var(--text-muted)` — the ink's own hue — moved the ground toward the text and still
  measured 4.34 / 3.86. Flat and unlifted reads as filed away and leaves every ink where
  the tokens put it. **Container opacity is the blunt instrument to distrust here: it
  dims text that was already muted, and no token audit can see it because the token is
  unchanged.**
- **`--text-muted` CLEARS AA IN BOTH THEMES NOW — the 4.34:1 figure that stood here is
  STALE.** This entry used to record dark `--text-muted` at 4.34:1 on `.glass-panel`
  (215 elements) with "fixing it belongs in its own PR" — written BEFORE the a11y
  token sweep, and never updated when that sweep landed. Re-measured (Aug 2026) by
  sampling the PAINT beside real muted text in a browser: dark 7.74–9.55:1, light
  5.45–6.16:1, and the registered admin dark grounds read 6.58–9.39 by arithmetic.
  Its claim that "a11y-test gates the status tints and `--accent-text`, not this one"
  is also obsolete: `--text-muted` is in a11y-test's `TEXT_TOKENS` and §1 sweeps it
  against every registered surface of both themes on every CI run. Nothing to fix —
  the standing lesson is that a measured-number claim in these notes goes stale the
  moment the token moves, so date the measurement or point at the gate that keeps it
  true.
- **THE TWO PILLS ARE A PAIR, ON ONE LINE, AND THE COTTAGE NAME SURVIVES.** Reported from
  a phone; two causes, both measured at 390px. `.prop-tag` is an inline-block pill built
  for a STACKED context and carries `margin-bottom: 12px`, which inside this centred flex
  row is part of its box and so lifted it 6px above the chip beside it (centres 523 vs
  529) — fixed on **`.bk-row-top .prop-tag`**, so every `.bk-row` gains it, not just this
  drawer. And "Put back in Waiting" is 165px of nowrap button, leaving the body 150px,
  with the chip `flex-shrink: 0` — so the cottage pill absorbed the whole squeeze and
  rendered **22px of its 91**, "Pimpernel" as "Pl…", the one word saying which cottage.
  The row wraps on a basis (`flex: 1 1 240px`) rather than at a breakpoint, so it responds
  to the COLUMN and not the window — which matters because the ≥1200px Inbox puts this
  list in a ~340px middle pane, i.e. wider viewport, narrower row. `justify-content:
  flex-start` on this row's `.bk-row-top` packs the two together; the general rule is
  `space-between`, which is right for a row whose chip is a right-hand status rail and
  would otherwise fling these to opposite corners (measured 88px apart).
- Declined is a **DECISION, not a fault** — deliberately not the red `danger` chip. The
  guest's message shows on one clamped line so two declines can be told apart without
  restoring one, and the action says where it goes ("Put back in Waiting"), matching the
  toast. Gated by ui-test-mailbox (9 checks; the mapper, the opacity and the heading each
  break-tested). NB `chbAttrs` emits **`data-args`** (a JSON list), so a
  `[data-arg="declined"]` selector finds nothing — which is how the first draft of that
  gate silently tested an unclicked tab.

## "Read all reviews" — two causes, one by design and one a real bug

Reported: the button showed on 21A (16 reviews) and on no other cottage page. Measured by
driving `renderPropReviews` per scenario — and **NO suite covered cottage-page reviews at
all**, which is how both shipped.
- **The button needed FIVE reviews.** It was gated on `count > show.length` with a 4-card
  grid, so a cottage with 1–4 got the cards, the count and the star average but no
  button — which reads as the page being broken rather than as there being nothing more
  to read. `.review-text` does NOT clamp, so ≤4 really is all of it on screen; the modal
  is nonetheless the canonical list, so it is offered **from two up**. At one review a
  "read all 1" button is noise.
- **A review saved with NO COTTAGE appears on no cottage page — and deflates the ones it
  should have counted for.** `renderPropReviews` filters `r.prop === propKey`, so
  `prop: ''` hides the whole "Guest reviews" section, while `renderGuestWords()` does NOT
  filter and keeps rotating the same review on the homepage — reviews visible there and
  nowhere else. Measured: **6 unassigned + 2 assigned rendered as "2 reviews"**, so the
  per-cottage COUNT and STAR AVERAGE are wrong too, silently. **"(no cottage)" is the
  FIRST option in both the per-review editor and the bulk importer**, i.e. what you get
  by not choosing, which is how a whole import ends up stranded. The option now names the
  consequence ("not shown on any cottage page") and `saveReviews` ASKS before saving any,
  naming the count — deliberately an ask, not a refusal, since the cottage is a field the
  owner may genuinely not know yet (the bulk-send confirm's posture).
Gated in ui-test-terms (8 checks: the button at 16/4/2/1, the count never inflated by
unassigned reviews, and the owner-side half source-scanned); the button threshold, the
stranded count and the option label are each break-tested.

## The frame — the day spine and the rail (the built redesign)

**Approved as a canvas + working prototype (design/, PR #1194), then built.** Two
pieces of chrome AROUND the screens, none to the screens; both live in
`chbFrameSync()` (admin.js) + the FRAME block at the foot of admin.css, gated by
**ui-test-railspine.js** (40 checks, five break-tested in isolation).
- **THE DAY SPINE** (`#day-spine`, JS-built) carries the day onto every admin view
  that doesn't already open with it: one sentence — `cmdkDayLine()`, the SAME
  derivation the search landing reads, gated as EQUALITY —
  plus up to two duty chips wearing `chbDuties()`'s own `go` route attributes
  (labels escaped at this render boundary, the needsYouItems contract) and an
  "N more" chip routing to Today. EXCLUDED by name: `view-backoffice` (Today IS the
  day — header line + Needs-you strip); it also stands down under `body.offline-snap`, where the day sheet owns the
  day. It is IN FLOW, deliberately not sticky: the prototype's sticky spine needed
  scroll-condensing with hysteresis (it oscillated — condensing shortens
  scrollHeight, which clamps scrollTop and re-expands it), and production's header
  already condenses and names the screen, so a second sticky bar is chrome
  stacking. It is RE-PARENTED into the active `<main>` as its first child (the
  `#booking-hub-content` pattern) so it inherits each view's container width — and
  it carries NO heading element, because a11y §6 scopes the outline to
  `.page-view.active` and a heading here would sit above every view's own h1.
- **THE RAIL** (`#admin-rail`, JS-built onto `<body>`) is the dock's five
  destinations (Cottages and the AI chat rows have since gone) as a left column from **1200px** — FULL (labels,
  counts, brand, Ask pill, theme) at ≥1440, FOLDED to a 64px icon rail at
  1200–1439 (where the ≥1200 two-pane layouts need the width back: the review
  measured the Inbox reading pane at ~330px beside a 220px rail; the fold costs
  92px and the panes keep ~530). Below 1200 the header dock IS the folded rail
  (the canvas's own read), byte-identical to before — every dock gate measures
  at 390. **The boundaries are BODY CLASSES, not media queries**: neither
  boundary for this chrome is expressible without a stray width, so
  chbFrameSync toggles `body.rail-on` (≥1200) and `body.rail-fold` (1200–1439)
  from matchMedia (change listeners registered in chbRailEnsure) and the CSS
  keys on the classes — full rail with labels+counts from 1440, the icon fold
  below it.
  Every rail rule ALSO requires **`.admin-screen`** (nav() maintains it from
  ADMIN_VIEWS): an owner browsing their own PUBLIC pages sees exactly what a
  guest sees — unshifted, dock in the header — or "check my own site" stops
  being a preview. The rail's glyphs are CLONED from the dock's own buttons at
  build (identity by construction, never by comment; the literals are the
  fallback and the Cottages glyph, which has no dock twin). The spine's chip
  label lives in a child `.spine-lbl` span because text-overflow on the flex
  chip itself renders no ellipsis, and the spine rewrites its innerHTML only
  when the markup actually CHANGED — the sync rides refreshInboxBadge and every
  nav, and an unconditional rewrite destroyed keyboard focus on the chips. Every count is the surface's OWN derivation said
  again, never a second one: Today = `chbDuties().length` (the Home-badge number),
  Inbox = `unseenEnquiries()` (the pip's number), Payments =
  `chbOpsParts(chbDayTuples()).owed` (the ops line's figure), Key safes = the
  keysafe duties in the same list — each gated as equality against the in-page
  derivation. The current row MIRRORS `.admin-dock-btn.current` (nav() maintains
  it, alias map included, even while the dock is display:none) so there is ONE
  alias map; (the Cottages row is GONE with the cottage list page — Manage stays current on a cottage page) the
  Cottages row went current on the PAINT of `#sec-accom`
  (getClientRects, the property-is-not-the-pixel rule), which needs the
  `chbFrameSync()` calls in settingsOpen/settingsShowIndex — settingsOpen doesn't
  nav() when Manage is already up, so the nav() hook alone misses the drill-in.
  **THE HEADER STANDS DOWN WITH THE DOCK on rail screens** (the owner asked for
  the demo replicated whole): the prototype has no top bar — the rail carries
  the BRAND at its head, the **Ask pill** (`#rail-ask`, `crownSheetToggle` — the
  hidden crown's job; `cmdkBack` hands focus back to it when the crown isn't
  painted) and a **theme row** (app.js's own `toggleTheme`, persistence
  included). Content starts at the top; the SPINE is the page's head there —
  sticky, the demo's serif scale (1.3rem), condensing on scroll to one line + a
  count pill (hysteresis 120/40, the prototype's own lesson: condensing
  shortens the document, which clamps scrollTop and re-expands it without a
  dead zone wider than the reclaim). The container's top padding moves INTO
  the spine via `:has(> #day-spine:not([hidden]))` — on the container, content
  scrolled visibly through the strip above the sticky spine (screenshot-
  caught); spineless rail views (Today) keep the container's padding.
  **THE FOLD (1200–1439, `body.rail-fold`)** is the prototype's own icon rail:
  64px, labels/counts/brand-words hidden, hot counts surviving as pips —
  every control keeps its name via `aria-label`, because a display:none label
  contributes NOTHING to accessible-name computation. Content shifts with
  `width: auto` + margins (the base `.container` is `width: 100%`, and 100%
  plus a margin overflows; `width: auto` lets the body's flex-stretch size
  it), LEFT-ANCHORED on purpose — a rail plus a column, not a centred page.
  `search-first` and `offline-snap` trim the rail's mirror rows exactly as
  they trim the dock (Cottages goes with Manage in both). The current icon
  takes `--accent-text`, not `--accent` — the cmdk tile lesson, 2.70:1 under
  the 3:1 non-text bar. NB ui-test-keysafe (1280) enters the page by the
  RAIL's row now — the dock click it was written with meets a display:none
  control at that width and times out.
- **Sync sites** (all guarded try/catch, and `chbFrameSync` is deliberately NOT a
  facade stub — the nav()/refreshInboxBadge hooks check `__ADMIN_LOADED` first so
  a guest navigation can never pull the admin bundle): the head of
  `renderNeedsYou()` (THE duties-changed moment, BEFORE its early returns or an
  emptying strip would leave stale chips), nav()'s view switch, the admin.js
  footer (an owner restored straight onto Inbox must not wait for a Today visit),
  `refreshInboxBadge()` (data lands), and the two settings hooks above.
- NB `#day-spine[hidden] { display: none; }` is load-bearing: the spine's own
  `display: flex` outranks the hidden attribute (the arrival stand-down lesson).
- **THE REFINEMENT ROUND (five built, one refuted).** Proposed on a canvas
  against the SHIPPED frame, then each driven: **the rail's current mark
  GLIDES** (`.rail-ind` — the dock's pill turned vertical, travelling on
  `translate` with the rows above it, re-seated by a ResizeObserver, snapping
  under reduced motion); **Today opens like every other screen** (on rail
  widths its own `#today-date` carries the greeting at the spine's serif scale
  and the redundant `h1` stands down — below the rail it renders byte for byte
  as before, and the greeting is never hidden-but-present); **the theme row
  names its DESTINATION** ("Switch to dark" — a control says what it does, and
  the label, `aria-label` and glyph all read the class `toggleTheme` keeps);
  **composure past 1720px** (`body.rail-wide` + `body.rail-widecol` — the
  ensemble centres as ONE unit, and the two column caps get their own
  arithmetic because CSS cannot see the active view's `.wide` from `<body>`);
  and **Payments shares the title's rail** on rail screens (longhand
  `margin-left: 0` only — the `.mo-pulse` shorthand lesson).
- **THE REFUTED ONE, and it is pinned as a decision.** The condensed spine was
  going to NAME THE RECORD you are in, on the reasoning that the old condensed
  header did and losing it was a regression. Driving it says otherwise: at rail
  widths a hub **docks beside its own list** (`bookingsSplitWide`, ≥1200), so
  the active view is still the workspace and the record is on screen with its
  own head; below 1200 the hub is standalone and the header, which exists
  there, names it exactly as before. No width is missing the place, so the
  spine would have been a SECOND name for a fact already on screen. §8 pins
  both halves, so the absence stays a tested decision.
- **AND HIDING TODAY'S h1 ORPHANED ITS VERDICT** — ui-test-needs-you caught
  it: the "Nothing needs you" capsule sits BESIDE the head, and with the h1
  gone at rail widths it floated alone above the sentence. `.bo-today-head`
  goes `display: contents` there so the verdict lifts onto the sentence's own
  row. The gate now asserts the RELATIONSHIP (beside whichever element is the
  head at that width), not an element that only exists at one of them.
- **AND THE PILL SAT 16px LOW FOR A DAY** (reported from a Mac, with a photo).
  `.rail-ind` is `position: absolute` with no `top`, so its static origin is
  the flex CONTENT box — below the rail's 16px top padding — while `offsetTop`
  is measured from the PADDING edge: translating by offsetTop counted the
  padding twice and the pill straddled the gap between two rows. `top: 0` is
  the fix and is load-bearing. The gate had asserted only that the pill MOVED
  between rows, which passed the whole time; it now asserts the pill HUGS its
  row on all four edges. A travelling indicator needs both checks — that it
  travels, and that it lands.
- **TWO TRAPS THE ROUND ITSELF PRODUCED, both worth keeping.** A changed-guard
  must check the DOM's TRUTH, not only its own memory: `initBackOffice` paints
  `#today-date` with the bare date the instant the page opens, so a memo-only
  guard believed itself current and left the greeting off — two memos now (the
  intended string and the WRITTEN one, because innerHTML normalises on write).
  And an index-based CSS edit ate an `@media` opener while removing a block,
  which silently unbalanced every rule after it — the rail simply stopped
  hiding at 390px, four sections away from the edit. Delete CSS by matching
  the whole rule, never by slicing to the next brace.

## Hover and press never change a ground (owner-asked, sitewide)

Every `:hover` / `:active` rule in the three stylesheets lost its `background`,
`background-color`, `background-image` and `filter: brightness()` declarations (a scripted
sweep: rules whose selectors were ALL hover/active were stripped; mixed lists such as
`.x:hover, .x:focus-visible` kept the background for the focus selector only — keyboard focus
and `.is-sel` selection are state, not pointer feedback, so they keep their tint). What remains
is MOVEMENT (the 4px press scale, lifts) and ink/border changes. Do not add a hover or press
tint back: touch devices leave `:hover` stuck after a tap, which is the darkened row the owner
reported on the search landing. Gates re-aimed from "the ground moves" to "the ground holds
still": ui-test-datepicker §18, ui-test-motion-system §12 (list rows), ui-test-workspace (the
timeline cell).

## The hero booking bar (owner-approved demo, built)

The guest home page's first screen carries the question it exists to answer: **Dates · Guests · Show prices**
(`#hero-bar`, under a compact headline panel). It owns NO state — `hbSync()` mirrors `heroSearch` into
`#hb-dates` / `#hb-guests`, the dates button is the existing `openHeroDatePicker`, the guests popover reuses
`hsAdjust` (so the hero form and the bar can never disagree), and `heroBarGo()` opens the calendar when dates are
missing, else runs the same `runHeroSearch()` whose results `showHeroResults()` presents. The full form lower down
stays (flexible dates, ±days). The button keeps `.hero-cta`. The scroll cue and the hero's own CTA are gone, and the
four-line trust strip (`#home-trust`) was removed: the heritage band (founded / cottages / live rating) is the one
strip, and ≤640 its gap is 12px so its ink stops before the Messages pill (ui-test-reach asserts it, now on
`.home-heritage`). The guest-picker band check in smoke-test counts THREE pickers (form, bar popover, enquiry).
Deliberately NOT built from the demo: footer regrouping, Messages-pill shrinking, card re-skin (the home cards already
carried price + availability chips).

**THE BAR WAS REFINED (approved demo, "Build and merge"):** one card with inset parts — the two fields share a soft
well (`.hb-fields`), the guest panel unfolds DIRECTLY under the fields (it used to open below the button, splitting the
control from what it opened), and the button is its own rounded pill whose label says what a tap does ("Choose dates"
until both dates are set, then "Show prices" — it already opened the calendar first). `#hb-pop[hidden]` is the
COLLAPSED state (a 0fr grid, the fold discipline), so the panel unfolds; a tap outside or Escape closes it. `hbSync`
owns the words: the dates label becomes "3 nights" ("Dates · 3 nights" ≥901px via `.hb-lw`), the value a compact
`hbRange` ("16–19 Oct"), guests "N guests" once children are added (the full phrase was cut off at phone width), and
the steppers DISABLE at their limits — minus at 1 adult / 0 children, plus at `hsPortfolioCaps()` — with `#hb-cap`
saying why. `.hs-gband` text stays "16+"/"under 16": smoke-test extracts those numbers. The hint under the button
was REMOVED at the owner's ask; the cap note is a `div`, never a `p` — the hero's paragraph rule uppercased and
spaced it.

## The scene hero and the one-rail home page (owner-approved demo, built)

**Asked for from a screenshot of the demo ("make it look like this"), then "Build the new layout exactly as
it's built in the demo".** The hero is an illustrated coast scene (`.hero-scene`, inline SVG INSIDE
`.hero-bg`, so home.php's `data-edit-img="hero-bg"` anchor is untouched) behind a left-aligned headline, with
the booking bar under it; everything below it shares ONE rail (20px gutter, 1088px) and one material.
- **The uploaded hero photo LEADS; the scene is the fallback** (follow-up, owner asked): the static markup carries the placeholder `hero.jpg` in the inline style until home.php or applyContentOverrides swaps the real URL in, so `.hero-bg[style*="hero.jpg"]` is the "no photo set" state and only then does `.hero-scene` paint. It was first built to REPLACE the photo; that hid the owner's own upload on the live site.
- **Default copy changed** ("Three cottages by the Blakeney marshes" / the price-you-pay line). A saved
  `hero-title` / `hero-sub` content value still wins, so a live install may keep its old words under the new look.
- **`heroWordsRise()`** (app.js, end of `applyContentOverrides`) wraps the headline in `.w > i` spans for the
  rise; idempotent, and a headline that never gets wrapped is simply plain visible text, never hidden.
- Cards, the late-availability row, the heritage strip and the section headings were re-skinned to the same
  hairline, left-aligned, flat vocabulary. Card reveals use `animation-timeline: view()` (CSS-only) so a card the
  app re-renders can never be stuck at opacity 0.
- NOT converted: the "Check availability" form section and the guest-quote section further down.

## The hero entrance waits for the reveal (page-load smoothness)

The hero's entrance (word rise, eyebrow, subline, booking bar, photo settle) used to start at CSS parse,
**behind the opaque `#loading-overlay`**, so it finished unseen (measured: 100% done when the cover lifted)
and the reveal landed on a busy main thread. It is now HELD (`body:not(.hero-go)` pauses the animations) until
`hideLoadingOverlay()` has decoded the hero photo (capped 900ms), waited two animation frames (150ms timeout
fallback: a backgrounded tab never ticks rAF) and then adds `hero-go` and `fade-out` in the same frame. The
photo's dimming is a flat `::after` layer (`opacity: 1 - --hero-brightness`), NOT `filter: brightness()` on the
element that is also scaling in `heroDrift` - removing the filter alone took long frames from ~7.5 to ~3.5
(4x CPU, Chromium). Measured before/after: frames >33ms in 2s after reveal 7.6 -> 3.3, p95 33 -> 19ms. Not
measured: iOS Safari. One-word headlines now wrap and rise too. The reveal is the single call site
(`__revealed` guard), so a new reveal path must go through `hideLoadingOverlay`, or the entrance stays held.

## The footer, grouped and trimmed (approved demo, built)

The footer was nine equal links read across two columns (the cottages split between them). Now: the name + an
outlined **Message us** (`toggleChat`), two `nav.footer-links` groups (Cottages, rebuilt by
`renderFooterCottages`; Explore: Things to do, Guest reviews) under small `.ft-cap` captions, the email sign-up as
one pill field (no heading; the placeholder names it), and `.ft-base`: Terms · Privacy · the theme switch, with
"© year · Made by George ♥" on its own line ≤900 and the same row above. Removed at the owner's ask: Home (the
crown), the NAP line, the newsletter blurb, Service status (still in Manage → System check). The guest shell no
longer hides the sign-up, and its footer pads 48px so the last row clears the Messages pill. Gated by
ui-test-hig §8 (two groups side by side, cottages in ONE column, 44px rows) + ui-test-reach (sign-up 44px).

**The privacy policy is the terms WINDOW** (`#privacy-modal`, `openPrivacyModal`/`closePrivacyModal`; the
`view-privacy` page is gone). Same box/head/body classes as `#terms-modal`, z 2200, Escape/Back via
`MODAL_CLOSERS` + `closeTopOverlay`, and it opens OVER the form that linked to it (sign-in, details, enquiry)
rather than closing it. Gated by ui-test-topmenu §H (opens, covers the Messages pill, closes) + layout-test.

## Calendar sync is a status page, not a form (approved demo, built)

**The verdict is the title's status pill now** ("Every page's status is the Manage pill"); the summary card keeps the facts
and Sync all. Manage → Calendar sync (`renderCalendarList`, admin.js) opens with ONE summary row
(`.mg-sum` anatomy: "All calendars up to date" / "N calendars aren't syncing", "3 of 4
cottages linked · newest 2m ago") and a **Sync all** pill that walks the cottages ONE
AT A TIME (`calSyncAll`, each row's capsule spins then ticks). Each FAILING platform
gets a "Needs a look" card above the list. The card states what the cottage still has
("Still using the 4 Airbnb stays from Mon"), from the last-good `events`/`ok_at` that
`ical_record_status` already keeps. It offers **Paste a new link**, which replaces ONLY
that platform's URL, keeps the others and syncs at once, and **Try again**. Each cottage
is still a `bhubFoldGrp('cal-<k>')`:
- the sub carries a chip per linked platform with its own dot;
- the fold lists each platform ("6 stays · synced 3m ago") with Replace link;
- below that are Sync now, Copy your link, + Link a platform (offering only platforms not
  yet linked, with live link validation: `calLinkOk`), and the old Edit feed links editor.

The explanation copy is gone. The data comes from ONE request, `ical-import.php overview`,
which is the 'list' reads looped over live cottages. Until it lands the bootstrap's
`__feedStatusPre` paints the verdicts, so nothing waits on it. A cottage absent from a
loaded overview reads "not linked". Typing in the link field updates the hint and button
IN PLACE (`calLinkInput`), and the list never repaints over a focused field. Gated by
ui-test-manage §3b; the keep-other-links save and the overview read were break-tested.
**The per-cottage page wears it too** (`calendarPropBoxHtml`, opened by Edit links): a
summary with Sync now, one row per platform (state line + its link field, ids kept as
`sync-<src>-<key>`), then "Your calendar link" with Copy. Leaving a box with a NEW valid
link saves it and syncs at once (`calFieldBlur`); an EMPTIED box is put back — unlinking
frees that platform's dates, so it is its own button with its own question
(`calRemoveFeed`); an invalid link is flagged and never saved. `calLinkOk` accepts http
too (Vrbo's own links are http). Gated by ui-test-manage §3c, the put-back break-tested.

## Guests: invite back, and a reset LINK — the owner never sets a password (approved demo, built)

Manage → Guests (`loadGuestList`/`gstRender`, admin.js; `.gst-*` in admin.css). Three stat tiles
(lifetime spend · Coming back · To invite back — the last two FILTER, with a chip to clear), a
search box that is never repainted while typing, and the list GROUPED by what to do: Coming back
(an upcoming booking in `dbBookings`), Worth inviting back (no upcoming stay, last checkout
>`GST_LAPSED_DAYS` 60 days ago), Past guests (by spend). A row is two lines; it opens into an
email + stays fact list and plain actions (Email, Copy email, Open booking, Send a password
reset link). Rows keep `.acw-prow[data-gemail]` for the search reveal.
- **The owner never sets a guest's password.** `guest_reset_password` is GONE; `guest_send_reset`
  (auth.php, admin) emails the magic-link token with `&pr=1` via `send_magic_link_email($g, $url,
  'reset')`. Consuming it with `reset` sets `$_SESSION['pw_reset_at']`, which lets
  `guest_change_password` accept a blank current password for 30 minutes, ONCE — the password is
  not cleared, so a link opened by mistake locks nobody out. The client opens
  `guestChooseNewPassword()` on landing. One send per guest per minute (activity-log check, 409
  `already_sent`), and a send the mailer refused is not logged.
- `guest_crm` carries `invited_at` (the last `guest.reinvite` in 90 days), so "Invited today ·
  Jollyboat" and the tile count survive a reload.
- Sent states are an animated `.gst-card` (`.is-new` only within 2s of the send, so re-renders
  never replay it); the buttons morph Sending… → green ✓ Sent first.
- Gates: test-integration §45 (the old action gone, refusals, the window both ways, one reset per
  link — break-tested on the window), ui-test-manage §7/§7e (tiles, filter, search focus, invite
  card, the email preview, a send carrying no password, the 60s wait).

## The Manage index is seven groups (owner-asked "reorder and recategorise")

`#settings-index` in admin-views.html. **Your account comes FIRST, with no heading** (owner-asked twice: first
from Sophia's screen, where it sat last, then "remove the your account text, move it closer to the line", approved
demo): ONE row with the person's photo and name — see "The owner's account" below; Log out lives on that page.
`#oa-acct-grp` is the index's FIRST child, ABOVE `#manage-verdicts`, so it sits the header's own gap under the title
line (18px on a phone, 40px from 641px) in every state; "Needs a look" follows it under its own heading. The old
order put the problems first, which pushed the account 253px down whenever one arrived, and without its heading the
account row would have read as one more row of that list. Spacing traps, all measured: the row has **no bottom
margin** (the empty `#manage-verdicts` is a FLEX box, so the margins either side of it ADD instead of collapsing,
and the default 20px gave 42px to the next caption); the gap comes from the next caption, which inside the fold is
the "Needs a look" caption, so the space opens with the rows; `#manage-verdicts` keeps no margin of its own. **From
900px** the index is two CSS columns and a group before the `column-span: all` verdicts sat alone in column one, 4px
from the next caption — so the row spans too (640px, as wide as "Needs a look") and brings 20px, with `.mg-probs`
20px inside the fold. Then, top-down by use: **Cottages & pricing** (Cottages, Seasonal rates, Pricing,
Calendar sync) · **Bookings & payments** (Payments, Cancellation policy — the read-only "Booking terms &
conditions" row was removed at the owner's ask, as nothing on it can be edited; the terms still open from the guest
site) · **Guests** (Guest
accounts, Waitlist, Reviews, Guest photos — the people and what they send in for approval) · **Messages &
automation** (Follow-up emails, Text messages, Guest chat) ·
**Website & marketing** (Home page & menu, Things to do, Newsletter, Analytics) ·
**System & tools** (Activity log, then **More tools** folding Backups, Integrations, Search learning and Test copy;
Test centre on staging) — there is no Status row: the pill beside the title is the way in (the one look, below).
Gated by
ui-test-manage §1 (first child, uncaptioned, the header's gap at 1280 and 18px/22px at 402, "Needs a look" after it,
spanning on two columns; four break-tests) and ui-test-people §B (Sophia's first
group). **`manageAccessSync` and `settingsFilter` walk only the index's OWN groups (`:scope >`)**: the summary keeps
a "Needs a look" `.settings-group` of its own, empty until a problem arrives, and the unscoped access sync hid it —
so a review counted a moment after opening Manage showed "1 thing needs a look" over nothing (ui-test-manage §2).
Rows, ids and acts were unchanged by the reorder — only order, groups and
four subtitles moved, so deep links and search are untouched. "Guests &
marketing" was nine unrelated rows and "Account & system" mixed your settings with maintenance.
**And inside them** (second pass): **Status** is health only now — its Maintenance cards moved to where they
belong: **Backups** (`sec-backups`, `renderBackups`, System & tools) and the hero-photo
optimiser onto **Home page & menu** (`#hero-opt-host`, `renderHeroOptCard`). **Away auto-reply + Instant chat
answers are ONE page, "Guest chat"** (`sec-chat-away` hosts both editors; `settingsOpen('chat-answers')` and
`settingsRenderSection('chat-answers')` alias to it, so old links and recents land). "Email me this week's
analytics now" sits on Analytics. Search routes (`toManage('backups')`, `toMng('chat-away')`) follow;
search-test asserts every route targets a registered section. (The AI chat and Mac assistant rows were removed
with the assistant.)

## The owner's account (approved demo, built)

**Asked for as "make the admin account a similar design to how the guest account is set up".** The five
Manage rows (Profile, Notifications, Security, Appearance, Back-office layout) and the Log out row are ONE row
(`#oa-index-row`, photo + name, painted by `oaIndexRowPaint` from `applyAreaFilter`) that opens
`settingsOpen('acct')`. Four Manage sections now use the guest account's rows and groups (`gaRow` / `gaGroup`,
app.css `.ga-*`): `acct` (the account page: a hello with the host title, Account, On this device, Log out) and its
three pages `host` / `notify` / `security`. Code: the OWNER'S ACCOUNT block after `settingsBack` in admin.js,
`.oa-*` at the foot of admin.css.
- **Each page carries its own back link and h1**, so the panel's pair stands down (`#settings-panel.is-oa`,
  toggled in `settingsOpen`, removed in `settingsShowIndex`). Every other section keeps the panel's back link and
  title (gated). The pages slide like the guest's (`ga-in` / `ga-in-back`): `settingsOpen` records where the owner
  came from (`__oaFrom`, captured BEFORE `__settingsPath` moves) and `OA_DEPTH` decides the direction; a repaint
  after a save does not move (`__oaStill`, `oaRepaint`).
- **In the search-first layout** the pages open in the search sheet; `oaGo` swaps the sheet between them, and the
  account page's own back link is hidden there (the sheet's "Back to results" is the way out).
- **Every detail is edited on its own** in a small `glassForm` with Save (`oaEdit` / `OA_EDIT`, `oaEditPhone`,
  `oaQuiet`, `addNotifyEmail`, `changeAdminPassword`). A refusal, the client's or the server's, keeps the form
  open with what was typed. The password is ONE form (it was three prompts in a row; a mismatch in the third threw
  away the first two), still ≥12 characters.
- **"Where I studied:" / "My work:" are stored WITH their label**, because the cottage page prints them that way.
  The row and the form show only the answer; the label goes back on when it saves (`OA_LINE`). Rows show
  `hostVal`, i.e. what guests see: an emptied fact falls back to `HOST_DEFAULTS`, as it always did.
- **`saveHostText` answers whether it landed** and writes the mirror only on success (it used to write the
  mirror first). That fixed a live bug on the way: the search's inline "Host bio" editor reads a THROW as "not
  saved", and `saveHostText` swallowed the failure, so a refused save showed "Saved ✓". The field's `set` throws
  on `false` now (gated).
- **The Host profile row shows only on the HOST's account** (owner-asked, from George's screen): the person whose
  first name matches `host-name` (`oaHostRowShown`). When nobody who signs in is the host (none set up yet, or they
  were removed), full access keeps the row once the people list lands, so the card can always be edited. An empty
  "The business" group renders nothing. Search's "Host profile" route is unchanged.
- **"How guests see you" is a CLONE of the cottage page's own host card** (`oaHostCard`: `renderHost` first, ids
  stripped), so the preview cannot drift from it. `.oa-preview` restores the Playfair serif, which owner-mode
  turns into the sans everywhere else.
- **The photo uses the guest's sheet and cropper**: `gaPhotoPick(which, use)` / `gaCropOpen(url, use)` take an
  optional destination. With one, `gaCropSave` hands it the 512px canvas and stays open if it returns false. The
  owner's `oaPhotoUse` uploads the square through `apiUpload(…, 'host-photo')` and saves the URL. The guest path
  is unchanged (gated: no `guest_avatar_set` on the owner's flow).
- **Notifications asks the device**: `oaPushState` checks for a push SUBSCRIPTION, not just permission (granted
  with no subscription receives nothing). `oaPushRefresh` patches `#notify-device` and the account row in place,
  so a render never waits on the service worker. **`enableOwnerPush` asks the iPhone-not-installed question
  FIRST**: a Safari tab does not expose the push APIs, so behind the support check the "add to Home Screen"
  guidance could never show. Each kind of alert is a switch row (`saveNotifyPref` merges one change through
  `saveNotifyPrefs`); quiet hours refuse half a window and equal ends.
- **Two-step reads the PRIVATE map first** (`oaTwoStepOn`): `admin-2fa-enabled` is internal, so the anonymous boot
  GET never carries it and the old switch could read off over a real on (the bacs-details rule). The switch is the
  real `#admin-2fa-toggle`, drawn when the page opens; a refused change puts it back.
- **Dark mode and Search-first layout are switches** (`#oa-dark`, `#oa-search`); `setThemeLabel` and
  `applyBackofficeMode` keep them in step however the setting changed. **Log out asks first** (`oaLogout`).
- Removed: `saveContactPhone`, `uploadHostPhoto`, `fillHostFields`, `syncAdmin2faToggle` (stub list and the admin
  footer list too), and the `.notify-row*`, `.settings-row-logout` and `.host-edit-label` CSS.
  `renderNotifyEmails` / `removeNotifyEmail` moved from app.js into admin.js (only the back office calls them).
- Gates: **`ui-test-owneraccount.js`** (86 checks). Twelve break-tests, each failing a named check: the panel
  flag, the mirror-before-save, the label, the two-step revert and private read, the cropper's destination, the
  logout confirm, the search bio editor, the half quiet window, the theme switch sync, the named passkey, the sheet
  back link. Re-aimed: ui-test-manage §6, ui-test-hig §1c (now measures the Google review link's well), e2e 5b,
  ui-test-poorsignal §9b. layout-test and a11y-test gained the four pages.
- Budgets: admin.js +7.1KB and admin.css +0.7KB gz (owner-only, immutable-cached); admin-views.html −1.4KB,
  app.js −0.1KB, app.css −0.3KB.
- **A FORM IS TYPED INTO ONLY AFTER IT HAS FOCUSED ITSELF.** `glassDialog` focuses its first field on a 60ms
  timer, and on a loaded machine that timer can fire in the middle of a Playwright `fill` on another field, so the
  text lands in the first one (measured by sweeping the timer across the fill window: `{a: "firstsecond", b: ""}`
  3 times in 42; waiting for the dialog's focus first, 0 in 42). That was ui-test-guestaccount §3's flake, present
  on main at the same rate (2 in 12 runs under CPU contention). Both suites now wait for the dialog's own focus
  before typing into a multi-field form. No person types within 60ms of a dialog appearing, so the app is fine.

## Permissions: two roles and 23 switches (approved demo v7, built and pushed to main without CI or tests)

**Supersedes the five area switches below** ("full access" is now **Super User**, everyone else a **Host**, and
"People & access" is **Permissions**). Asked for as "completely reimagine this page and subpages, call it Permissions",
simplified over six demo rounds.
- **THE MODEL IS `people-lib.php`'s `PEOPLE_PERMS`**: 23 keys in seven groups (bk / gu / ks / mo / co / we / su), each
  `[label, group, fixed]`. `bk.see` is `'always'` (on for everyone); `su.perm` and `su.sys` are `'super'` (a Super User's
  only — they stand for the existing `'owner'` cap). A plain Host has every bk/gu/ks/mo permission.
- **STORED AS A DIFFERENCE**: `admins.perms` (migration-137, TEXT) holds only how a Host differs from a plain Host (`{}` =
  plain Host), so a permission added later follows the Host default. **NULL = someone from before permissions**: their old
  `caps` decide (`people_perms_from_caps`: everyday → bk/gu/ks, payments → mo.ask+mo.record, refunds → mo.refund+mo.deposit,
  money → mo.view+mo.exp, prices → co.*, website → we.*) until the first change is saved, so nobody's access moved on
  deploy. Sophia's existing row reads "Host · 4 changes" for exactly that reason.
- **`people_can($row, $cap)`** takes a permission key, `'a+b'` (both — an approve with a price is `gu.approve+mo.ask`, an
  email with a pay button `gu.reply+mo.ask`), `'all'`, `'owner'`, or an OLD AREA NAME as "any of" (`PEOPLE_AREA_PERMS`;
  `money` is `mo.view` only), so search/webpush and anything not yet re-aimed keep working. `PEOPLE_POLICY`, the content
  and upload caps and `PEOPLE_MAILS` are re-keyed by permission; a file or action not listed is still `'owner'`.
  `people_strip_money` drops payment fields without `mo.record` and price/plan fields without `mo.ask`; a cancellation
  that refunds needs `mo.refund` for the typed sum and `mo.deposit` for the deposit it returns.
- **people.php**: `set_full` is the ROLE (becoming a Host resets to a plain Host; "There must always be a Super User"),
  `set_perm` {id, perm, on} refuses fixed permissions and Super Users, `reset_perms`, `invite` takes `role`. `set_cap` is
  gone. Every answer carries `permDefs` + `permGroups`, so the page never keeps a second copy of the words.
  `people_public` adds `role`, `perms`, `changes`, and `caps` derived from the permissions.
- **The client** (app.js): `CHB_ACT_CAP` / `CHB_SEC_CAP` / `CHB_VIEW_CAP` are keyed by permission, plus `CHB_PART_CAP`
  for parts that are not data-act buttons (the Inbox's reply box and decisions via `data-ib`, the booking form's money
  groups). The class is `cap-x-` + the key with the dot as a dash (`cap-x-mo-refund`); `chbAccessSync` walks
  `CHB_CAP_KEYS`. `chbCan` (admin.js) is `chbMayUse`. Key safes is a view now (`ks.see`).
- **The pages** (admin.js): Permissions = people rows ("Host · 1 change · active today at 12:51", a Waiting capsule for
  an invite), Add someone (name, email, role select — a glassForm select has no default, so the chosen role is put first
  on a retry), and one "Cottages & money" row. A person = hero (photo, name, email, when seen), Role (the one switcher,
  Host | Super User — yours is said, not switched), "What X can do" (→ `perms` section, depth 4), an Emails fold (only the
  emails their permissions allow, a switch each), Passkeys (only when they have one — kept beyond the demo so a lost
  phone's passkey can still be removed without removing the person), reset link, Remove. The perms page: a "N changes
  from Host · Reset" row, captions with "n of m" or "Super User only", a switch per permission with a dot where it differs
  from Host (Undo on the toast), a tick for always-on and for every row of a Super User, a lock for set-up. Cottages &
  money = the account holder as the one switcher, a face picker per cottage, one sentence per paid-out host, and the
  linked bank names kept only so one linked by mistake can be unlinked. The emails matrix page stays (from Notifications).
- **Gates re-aimed afterwards** (the overnight CI pass): test-people.php, test-integration §51/§52, ui-test-people
  (rebuilt from PEOPLE_PERMS / PEOPLE_MAILS, 141 checks) and ui-test-owneraccount assert the roles, the switches and
  "Permissions" now.

## People: separate sign-ins, and what each person can do (approved demo, built — its five switches SUPERSEDED by Permissions above)

**Asked for as "two admin accounts, one for me which needs complete access and one for Sophia who doesn't need as
many buttons"** (Sophia runs the cottages, George does the website). Every person who signs in is an `admins` row
(migration-133: name, email, full_access, caps, twofa, photo, auth_epoch, invite/reset token hashes, removed_at,
notify_prefs; `admin_devices.admin_id` and `push_subscriptions.admin_id`, NULL = the first owner's from before).
- **THE OWNER NEVER SETS ANYONE'S PASSWORD** (a standing instruction). Add someone = name + email; they get a
  7-day invite link and choose their own. A forgotten password, or the owner's "Send a password reset link", is a
  30-minute link to the person's OWN inbox. Links are `<id>.<48 hex>`; only sha256 of the token is stored
  (`people_link_ok`: an invite only works while invited, a reset only once they have a password). Saving a reset
  bumps `auth_epoch`, signing them out everywhere else; removing someone keeps the row (the activity log names
  them), deletes their passkeys, trusted devices and phone subscriptions, and `admin_session_check()` (db.php
  bootstrap) ends a removed, still-invited or epoch-bumped session on its next request.
- **EACH PERSON'S SIGN-IN IS THEIR OWN**: the new-device code goes to their email (`admin_contact_email`; the
  first owner falls back to the old owner address), passkeys and trusted devices are per person, two-step is their
  switch. The sign-in sheet carries every step in place (password → device code → in; email → code → in, see "Three
  ways into the back office"; invite and reset pages; a passkey offer after the invite) —
  never a detour to another dialog. A switched-off sign-in says so and is never retried as a guest login.
- **THE AREAS ARE `people-lib.php`'s, and the server decides them on EVERY request.** Full access = everything;
  anyone else = the everyday work (`'all'`: bookings, calendar, enquiries, messages, email, key safes, guests,
  reviews) plus the five switches — Take payments (on by default), Refunds and deposits, Money overview, Prices
  and cottages, Website and marketing. `'owner'` is full access only (People & access, system, the
  activity log). `require_admin()` → `people_enforce()` maps every action CANDIDATE (body, GET and POST — endpoints
  read the action from different places) through `people_cap_for()`; **a file or action not in `PEOPLE_POLICY` is
  `'owner'`, so a new endpoint is closed to a limited person until someone decides otherwise.** The refusal is
  403 `code: 'not_allowed'` with the sentence "That's for George to change."
  - **Money hides inside everyday actions**, so those are judged by their inputs: a booking add/edit drops the
    money fields without Take payments (`people_strip_money` — "absent keeps" does the rest), a cancellation that
    REFUNDS needs Refunds (`require_cap`), an approval carrying a price or plan and an email with a pay button need
    Take payments. `content.php` writes are decided BY KEY (`people_content_cap`), and its GET and the boot
    payload are filtered to what the person may read (`people_content_readable`; `PEOPLE_READ_ALSO` lists the
    switches everyday screens consult — never a secret). Uploads by slot.
- **THE SCREENS FOLLOW, from the same maps** (app.js `CHB_ACT_CAP` / `CHB_SEC_CAP` / `CHB_VIEW_CAP`): `chbSetMe`
  stores the server's word as `window.__me` and `chbAccessSync` sets `body.cap-x-<area>` for each area the person
  lacks; ONE generated style rule hides every button, Manage row and dock/rail destination in that area (the
  CHB_NEEDS_NET pattern), the dispatcher refuses a stale render's tap in the server's words, `nav()` lands a
  switched-off screen on Today, `manageAccessSync` drops emptied groups and the system summary, `chbDuties` filters
  Today's jobs (`CHB_DUTY_CAP`), and alerts follow (`notifyCatsFor`; server `notify_should_push_for`: money needs
  Take payments, system notices full access, 'urgent' reaches everyone, then each person's own mutes and quiet
  hours). **An unknown person (no word from the server yet, or an offline boot) is full access**: the server
  decides, and the hiding is only ever what is offered.
- **NB the hiding is derived, the switches are not**: a person's areas change on their next sign-in or reload,
  not live. `#manage-verdicts` needed `[hidden] { display: none }` — its own `display: flex` outranked the
  attribute (the arrival stand-down trap again). A change handler gets its data-args and the value, never the
  element, so a handler serving several switches is told which (`oaSwitch`'s `arg`).
- **The activity log names who** (`actor = 'admin:<id>'`, `admin_actor_label`: "You" for the reader, the name
  otherwise; legacy `'owner'` rows are the first owner's). NB an explicit `'actor' => 'owner'` OVERRIDES the
  session — `chat_admin_reply` and the mailbox had one, so every chat reply was credited to the first owner
  whoever typed it. A session's person is the actor now; only a reply that came in BY EMAIL (no session) is
  still 'owner' (per-person reply attribution is the email PR's).
- **THERE IS ONE SIGN-IN.** The old `#admin-login-modal` (username/password + "a code to your owner email") is
  DELETED: its last route was `tryAccessBackOffice()` while signed out, and it never told the client who had
  signed in, so a limited person would have been shown every screen. That route opens the sheet now.
- **The first sign-in inherits `OWNER_NOTIFY_EMAIL`** (`admin_backfill_owner`) until its owner sets their own in
  Your details (a code to the NEW address proves it). If that address is the person you are about to invite —
  likely, since it was one shared inbox — the invite refuses with "That's the email on your own sign-in. Change
  yours in Your details first".
- **The search window's system line is full access only** (`chbSysLine`): a limited person is never sent the
  cron state, so the line would have read "All systems normal" about nothing — and `.cmdk-sys[hidden]` needed
  its own rule (the hidden-vs-display trap, twice in one PR).
- **Shared, deliberately or not yet**: duty dismissals and search pins are one store for everyone. Who gets which
  EMAIL is per person (next section).
- Gates: **test-people.php** (78 checks: the policy, links, names, every action candidate), **test-integration
  §51** (45 checks against the real endpoints: invite → accept → sign in, a reset signing other sessions out,
  removal ending a live session, refusals by area including a query-string action, money stripped from an
  edit, the content read filter, her chat reply logged as hers), **test-webpush** (per-person alerts), and
  **ui-test-people.js** (70 checks: the People pages, what a limited person is offered and refused, the sign-in
  steps) — break-tested on the style rule, the
  duty filter, the nav guard, the dispatcher refusal, the summary row and the switch argument. It found a real
  bug on its first run: after one refused new password every later try was refused too (`AU.err` was never
  cleared).

## Who gets which emails — per person (the approved demo's email matrix, built)

Every email the back office sends its people is one of nine KINDS (`PEOPLE_MAILS` in people-lib.php): new enquiries,
new bookings, payments received, guest messages, reviews to approve, things-to-do suggestions, the weekly digest, the
weekly analytics and the database backup. Each person chooses which reach them (`admins.mail_prefs`, migration-134).
Sign-in codes and reset links aren't kinds: they only ever go to the person signing in.
- **`send_people($kind, …)` is the one sender** (mailer.php); `send_owner()` survives as `send_people('')`, meaning
  the people with full access. `people_mail_recipients($kind)` decides: each person who has chosen the kind and may
  have it, then the extra addresses ("Also emailed", the old `notify-emails`) on every kind but the backup. Before the
  people migration, or when the table can't be read, it is `OWNER_NOTIFY_EMAIL` plus the extras, exactly as before.
  **Every sender names its kind** (test-people §12 scans them). A new sender left on `send_owner` reaches only the
  people with full access.
- **An area switched off takes its emails with it** (`people_mail_can`: payments needs Take payments, ideas and
  analytics need Website and marketing, the backup is full access only). The choice is kept, so switching the area
  back on brings it back. **An invite reaches no one** until the person has chosen a password.
- **Three kinds must always reach someone**: new enquiries, guest messages and the backup. `set_mail` refuses
  switching off the last person (`people_mail_must_problem`, 409 `must`). Should nobody be left anyway (the last
  person removed), the resolver falls back to a current Super User, the first owner if they still are one (round 7).
- **Defaults**: full access gets everything, which is how it worked before people existed. Anyone else gets the
  guest-facing six (`PEOPLE_MAIL_LIMITED`): enquiries, bookings, payments, messages, reviews and the digest.
- **THE DIGEST HAS A COPY WITHOUT THE MONEY** for anyone without Money overview (`owner_digest_body(['noMoney' =>
  true])`). It leaves out every figure and also the warnings list, because a warning's free text can carry an amount.
  `send_people`'s `compose` callback picks the copy per recipient. The render gate asserts no £ in either half.
- **A weekly email asked for from the back office goes only to whoever asked** (`people_mail_only()`, the same
  override the samples use), and it does not stamp the day, so it can't stop Monday's going to everyone else.
- **Phone alerts stay separate**, and the email fallback is per person now. If an alert meant for you (your areas,
  mutes and quiet hours) reached none of YOUR devices, you get the email, whoever else's phone it reached; a mute or a
  quiet hour stops this email too (round 7). The extras only get it when nobody's phone was reached, as before.
- **Reply by email**: someone who may reply in the app (`gu.reply`) may answer a guest by replying
  (`people_mail_senders()`; the thread token is still the real gate), and the reply is credited to them
  (`people_mail_sender_row` → `chat_admin_reply`'s new `$actor`).
- **Samples and the test email go to the person who asked**, never to everyone who'd get the real email.
- The page: People & access → **Who gets which emails** (also from Notifications and each person's page). It shows a
  photo per person per email: lit with a tick = sent, a dashed ring = not sent, a lock = can't be sent (the reason
  comes on tap). The extra addresses are at the foot. Someone without full access sees **Emails you get**, read-only.
  `.em-*` in admin.css; a locked photo is `aria-disabled` but still tappable, so Playwright needs `force`.
- **`OWNER_NOTIFY_EMAIL` changes meaning, and it matters at deploy**: it is the first sign-in's address until its owner
  sets their own in Your details, then it receives nothing unless it is someone's address or an extra. A shared inbox
  that should keep getting everything must be added under Also emailed.
- Gates: test-people §12 (the rules and the wiring), test-integration §52 (who each kind really reaches, through the
  app itself in CLI; the must and lock refusals; areas taking their emails; the fallback; reply-by-email senders),
  test-emails-render (the digest without the money), test-webpush (the per-person fallback), ui-test-people (the
  matrix, locks, the must refusal, the limited page), ui-test-owneraccount (re-aimed). Break-tested on the must
  fallback, the backup's extras, the must refusal, reply attribution, the lock state, the limited page and the digest
  note.

## Three ways into the back office: an emailed code, a password or a passkey (owner-asked)

Asked for after the passwordless demo: "give the ability for both admin and hosts to login via email 6 digit, password
or passkey". **The emailed code alone signs a back-office person in now**; it used to be the first half, with the
password after it. `guest_code_verify` finishes the sign-in for an ACTIVE person (`admin_trust_this_device` +
`admin_complete_login`, logged "signed in with an emailed code"), and the `?signin=` link does the same on the device
that opens it. A password still works (a username, or "Use a password instead" on the code step), and two-step still
sends a new device a code after a PASSWORD. A passkey works as before. Someone INVITED and not started still chooses a
password (the proof waits in `$_SESSION['admin_email_proof']` for `admin_invite_accept`), so everyone keeps a password
for the refund step-up, which still asks for a passkey or the password, never a code: on an unlocked phone Mail is
usually open too.
- **A CODE THAT IS A WHOLE SIGN-IN NEEDS A DAILY CAP.** `throttle_check` allowed 20 wrong codes per 10 minutes per
  address across IPs, about a 0.3% chance a day of guessing a 6-digit code. That was harmless while a password
  followed the code, and not once the code is the key (it already was for a GUEST account, door code included).
  `code_paused()` counts a DAY's wrong codes for the address across every IP; at `CODE_DAILY_FAILS` (10) both the
  request and the verify answer 429 `paused`, the right code included, with one sentence for every address so it says
  nothing about who has a sign-in. A success clears that browser's own wrong tries.
- **A back-office code lives 10 minutes** (a guest's 30), and its email no longer says "your password comes next". The
  sign-in email's "ignore this" line says nobody gets in without the code; the device-code email still says to change
  the password, because someone had it.
- **Removed, with nothing left to serve**: `admin_email_proven()`, the `wrong_password` / `guest_password` replies and
  `guest_login`'s 409 `back_office`. All of it hung off the code-then-password step. A wrong password typed with an
  email gets the generic reply and the merged login's guest attempt, as that path always did.
- The sheet's "Welcome back" and "Too many tries" steps now show an error (neither rendered one, so a paused or failed
  request there said nothing). The Security page's lead names the three ways in (`oaSecurityLead`, one sentence for
  the page and its patch), and the two-step row says it applies after a password.
- Gates: test-integration §50 (the cap from ten other IPs, the right code refused, no new code sent, nine under the
  line) and §51 (the 10-minute life, the code alone in as herself, the device remembered, the log, a same-address guest
  account never where the code lands, the password still working, removed and invited people), ui-test-people §C (the
  three ways, a wrong password, the reset from a username, the link signing in), test-emails-render §14 (no password
  promised and 10 minutes, each half read on its own).

## Signing in to the back office with an email (reported: "you can only get in with a password reset")

**Partly superseded by "Three ways into the back office" above**: the code now signs in on its own, so the
password step after it, and everything below that guarded it, is gone. The other three fixes stand.

Every path works on a clean server, so none of this showed on a fresh copy. It took a full-stack copy (real
MariaDB, real `php -S`, real mail caught by a local SMTP sink so the codes are read from the actual emails, two-step on)
plus the states a real phone carries. Four defects, each confirmed there:
- **THE PASSWORD STEP FELL THROUGH TO A GUEST LOGIN.** `guestLogin()` tried the password as a GUEST's after any failed
  back-office one, even after a code had proved the address was a back-office sign-in ("it needs your password too").
  A wrong password then read "Email or password not recognised". If a GUEST account shared the address (likely for
  anyone who has tested the guest side), its password signed the person in as that guest. A phone's password manager
  holds one password per address on a site, so it fills the guest one in. Now: after the code (`AU.via === 'email'`),
  or for a username, the back office alone is tried. Any back-office error with a `code`, or a status other than a
  plain 401, is shown as itself and never retried as a guest. With the inbox proven, `admin_login` says exactly what
  went wrong: `wrong_password`, or `guest_password` ("that's the password for your guest account"). `guest_login`
  refuses (409 `back_office`) while the address is proven a back-office sign-in, because an old copy of the page
  cached on a phone still makes that call. `admin_email_proven($row)` is the one test for the proof.
- **PASSWORD MANAGERS COULD NOT FILE OR FIND THE PASSWORD.** The username on the password step was
  `<input type="hidden">`, which managers skip, and the invite/reset step had no username at all. So a password a phone
  saved (its own "Use Strong Password" suggestion included) was filed under no address and not offered back. The person
  never knew it, and only a reset got them in, every time. Both steps are real `<form>`s now (`data-act-submit`,
  `display: contents` so the step's gap still spaces them, fields with no `name`, the default stopped first). Each
  carries a read-only `autocomplete="username"` field (`authIdField`) in the same form as the password: the typed
  email or username, or on invite/reset the person's own address, which `admin_link_check` now returns as `email`.
  The button is a submit (`authSubmit`, `data-submit`, not `data-act`, or a click would run the work twice), so Return
  signs in. Focus skips the read-only field.
- **THE ADDRESS THAT GETS YOUR CODES MUST BE AN ADDRESS YOU CAN SIGN IN WITH.** The first owner's codes and reset links
  go to `OWNER_NOTIFY_EMAIL` while their own email column is blank (`admin_contact_email`), but `admin_find()` searched
  the column alone, so that address went down the guest path. It now falls back to the first owner on exactly that
  address and backfills the row.
- **THE CODE SCREEN PROMISED A LINK THE BACK-OFFICE EMAIL DID NOT CARRY** ("Or tap the link in the same email"). The
  sign-in code email has one now: `?signin=<email>&code=<6 digits>`, handled by `maybeSigninLink()`, which opens the
  code step with the code filled in and checks it as if typed; the password still follows. It rescues a phone that
  reloaded the app while the code was fetched from Mail. A new-device code is titled "Your code for a new device", so
  two codes in one inbox can't be mistaken.
- Gates: test-integration §51 (wrong password, the guest password named, guest login refused with no guest session,
  the right password in, the blank-email owner found and backfilled, `admin_link_check`'s email), ui-test-people §C (a
  real form a password manager can read, the caret in the password, Return submits, the guest password named and
  never tried as a guest, the invite filing under the address, the one-tap link), test-emails-render §14 (the link in
  both halves, none on a device code, distinct subjects). ui-test-signin and the full-stack harness were re-aimed to
  `[data-submit]`. Break-tested six ways in isolation; two are telling. With the guest-login refusal removed, the
  server signed Sophia into her GUEST account. With the owner-address fallback removed, the owner's own address
  came back `{new: true}`, a brand-new guest being asked for a name.
- NB not reproduced: a phone's own password-manager behaviour. No WebKit here, so the filing fix rests on the
  standard rule that managers read `autocomplete="username"` on a real field in the password's form. If a phone still
  offers the wrong password after this, the screen now names it.

## The Status page (approved demo, built "exactly like the demo")

Manage → Status is one run of `diagnostics.php` drawn as: a HEALTH RING (fraction of
non-optional checks passed, tone ok/warn/bad), four VITALS each with a seven-day trace
(daily jobs, calendars, email sent, backups), THIS WEEK (warnings grouped and judged),
EVERYTHING CHECKED (every check in exactly one system — Payments ← Payments+Data,
Email ← Email+Notifications, Calendars ← the feeds themselves, Automation, Website &
data ← the rest), STORAGE (split bar + 30-day growth) and SWITCHED OFF (optional
checks, each routing to the page that turns it on). Client: `loadDiagnostics` /
`spHtml` / `spSystems` / `spVitals` / `spWeekHtml` / `spReveal` in admin.js, `.sp-*`
in admin.css. Gated by **ui-test-status.js**, **test-status.php** and test-integration §46.
- **THE WARNING VERDICTS ARE `status-lib.php`** (pure, `status_warn_kind`/`status_week`):
  a mapped action is said in plain words with whether it needs the owner; an UNKNOWN one
  shows its own summary and COUNTS AS NEEDING THE OWNER — never waved through.
- **"Check again" never invents progress.** While the request is out the ring spins
  indeterminately; the ring sweep, the percentage and the per-system badges tick only
  once the real answer has landed (a reveal of results, not a fake load bar).
  Reduced motion lands on the verdict at once — and needs its OWN block, because the
  app killswitch leaves inline `animation-delay`s in place and a `both` fill would hold
  every bar at `scaleY(0)` through them.
- **Email's trace is `mail-sent-days`** (internal key, `mail_sent_tally()` in mailer.php
  on every successful send, single and batch; 14 days kept; best-effort, never costs a send).
- "Fix safe issues" sits under Needs a look and, always, in Tools.
- **TOOLS are grouped rows that report under themselves** (approved demo): "Keep it
  healthy" (Fix safe issues / Install updates / Optimise photos) and "Email checks"
  (test email / every template / this week's digest / reply-by-email), each `.sp-tool`
  with a one-line sub saying what it does and a verb on the right that turns spinner →
  ✓ (or red). The tool functions find their row from the button
  (`spToolOf`/`spToolBusy`/`spToolSay`) and fall back to their old toast/slot when
  called from anywhere else (search, Needs a look, Analytics' weekly button) — so
  never set `btn.textContent` inside a row. Gated by ui-test-status §7.

## The PUBLIC status page wears the admin Status look (approved demo, built)

`/status` (status.php) is the admin Status page's vocabulary for visitors: a one-line
crown + name, "Service status", a RING card ("Everything's working" / "Some things
aren't working"; full when every switched-ON row works, an `off` row counted for
neither side), "What we checked" as icon rows with ICON-ONLY round badges (✓ / ✕ / –,
the word kept in `.sr-only`), "Last 30 days" with the healthy % counting up and tap-a-day
bars, and "Back to the website" as a row. Dark by default, light by the visitor's
setting, values restated inline as before (no stylesheet dependency). Removed at the
owner's ask: the Live pill, the counts beside the captions, "tap a day", the
switched-off footnote, the subtitle under the title, and the ring's orbit/glow.
- **Interactions live in `status.js`, SAME-ORIGIN** — the CSP carries no
  'unsafe-inline' for scripts, so an inline block would silently do nothing. It is
  pinned by its own content hash (`?v=` from `md5_file`), and the page reads fully
  without it. **Check again RELOADS the current address** (the reload IS the check) —
  `location.href = '/status'` 404s under `php -S`, which has no rewrite.
- Gated by **ui-test-publicstatus.js** (the real degraded response in both themes,
  icon-only badges with spoken states, the script pin, Check again reloading) and
  layout-test's /status scene (selectors re-aimed).

## The Activity log is a week, a to-do and a story (approved demo, built)

Manage → Activity log (`#act-log-app`, built once by `alShell()` in admin.js; `.al-*` in admin.css).
- **Server**: `activity-log.php` gains `summary` (`activity_summary($today, $seen)` in activity-lib.php — seven
  days of counts/warnings and the NEEDS list: warnings `status_warn_kind` judges as needing the owner, unseen,
  grouped by action+title, max 6) and `seen` {ids} (internal key **`activity-seen`**, last 400 ids). `list` is
  unchanged except rows now carry `id`/`action`/`entity`/`entity_id` and, for known warnings, a plain `nice`
  title + `verdict` — one judgement shared with the Status page.
- **Client**: a week card (bars; tap a day to filter — its "needs a look" verdict is the title's pill, `#al-pill`), the Needs-a-look card (Seen it →
  POST seen, row leaves), a pill search (250ms debounce, server `q`), five ICON tabs (All/Bookings/Money/Messages/
  System via `AL_GROUP`) with count badges and a sliding pill (`--al-i`), the log grouped by day with consecutive
  same-action rows collapsed ×N, each row expanding to facts, the raw code and "Open the booking". "Show older
  activity" grows the page by `ACT_LOG_LIMIT` (150) to `ACT_LOG_MAX` (500); past that it says to search. Live: a
  quiet refresh every 30s while the view is up marks arrivals.
- The shell is built ONCE and its parts repainted, so typing in search never loses focus.
- Gates: ui-test-activitylog.js, test-integration §47 (summary judgement, seen excludes, 400 on empty, owner-only,
  never public), smoke §13 (re-aimed to the new cap sentence), ui-test-reach (the tabs fit at 390, 44px each).

## The guest's Account page and My stays (approved demo, built)

**Asked for from three screenshots: "completely overhaul the customer account and stays
section".** The "Your details" and "Account & security" pop-ups are GONE (markup, CSS,
`openGuestDetailsModal`/`openGuestSecurityModal`, their MODAL_CLOSERS and Back entries).
- **Account is a PAGE** (`view-guest-account`, `renderGuestAccount` / `openGuestAccount(sub)`
  / `gaGo(sub)` in app.js, `.ga-*` in app.css): profile row → Your details; Settings
  (Sign-in & security); Help (Message us, Call us, Booking terms); Privacy & your data;
  Sign out. Sub-pages render IN PLACE with a "‹ Account" back link (`__gaSub`). The dock's
  Account tab (`guestAccountTab`) always lands on the first page; desktop reaches it from
  the My stays header's one Account pill (`#acct-settings-btn`).
- **Details are FACTS, edited one at a time** (`gaEdit` → glassForm → the same
  `guest_update_profile`). The server saves phone + address + postcode TOGETHER and refuses a
  missing address or bad postcode, so a guest with no address yet is asked for all three at
  once. The email is a locked row, never an input.
- **The password is two rows** (`gaPassword` — a glassForm that stays open on a mismatch and
  says why; `gaResetLink`). **`guest_send_reset` now also serves a signed-in GUEST**, to their
  OWN address only — the body's email is ignored for a guest (test-integration §45).
  Passkeys are rows (`__gaPasskeys`, filled by `loadPasskeys`).
- **Call us exists only when `contact-phone` is configured** — the CONTACT_PHONE_* fallbacks
  are placeholders, and a row dialling them is worse than none.
- **Sign out and Delete ask first**; backing out sends nothing.
- **My stays**: `#gb-seg` is an Upcoming | Past switch (`gbSeg`, `__gbSeg`) shown ONLY when
  both sides have stays; the panes are `#gb-pane-up` / `#gb-pane-past` (hidden, so textContent
  gates still read both). Each stay card has a photo header (`gbPhotoHtml`: first gallery
  image over a cottage-colour gradient). The empty state is one short card ("Nothing booked
  yet" / "Nothing booked at the moment" for a returning guest) plus the cottages as cards
  (`gbCottagePicksHtml`). The welcome line says where the guest is ("— 12 days until
  Jollyboat"). "Call to discuss" left the header for Account → Help.
- **Deliberately not built from the demo**: a Notifications page — arrival emails are
  transactional and the newsletter has no signed-in toggle yet.
- Gated by **ui-test-guestaccount.js**; ui-test-guest-modals / overlays / focusreturn /
  yourstay re-aimed (the pop-ups are gone; one header pill; the new empty-state words).
  Budgets: app.js +4.4KB, app.css +1.4KB gz raw (comments stripped at deploy); index.html
  fell ~1KB.

## Stays inside the You page (approved demo, built)

My stays and Account are ONE place now: the dock has three buttons (Things to do, Cottages,
**You**) and the You page (`view-guest-account`, `renderGuestAccount`) reads: a hello line that
says where the guest is ("4 days until Jollyboat"), the LEAD stay card, other stays as rows,
then the account settings.
- **The lead stay** (`gaStaysSplit`): the stay in progress, else the soonest upcoming, else the most recent
  past. It is a photo card with ONE ask: Pay (via `openPayView` with its pay token), the door
  code once it has been released, or Book again for a past stay. Below that are four shortcuts
  (Directions / House rules / Amenities / Message; a past stay gets Invoice / Review / Message),
  then "Everything about this stay".
- **The money is the stay page's own**: `gaStayMoney` reads `displayGrand` + `guestPayCta`, so
  the two pages cannot quote different figures. The stays come from the same `my-bookings.php`
  (`gaStaysLoad`, cached in `__gaStays`, reset on logout). The page has four non-stay states:
  loading, failed (Try again), unproven (confirm your email) and empty (Find dates).
- **The full stay page is unchanged** (`view-guest-bookings`, every gate on it intact). It opens
  from You (`gaOpenStays` / `gaOpenStay`, which lands on the right pane and opens the past fold)
  and carries one "‹ You" back link; the dock keeps You marked while it is up.
- **The amber pip on You** (`guestDockNeedsSync`, a child `.gd-pip`, because the dock's
  `::before`/`::after` are already taken) shows while the guest is staying or has money due.
  `guestDockAvatarSync` re-applies it, since its innerHTML rewrite removes the dot.
- Gated by ui-test-guestaccount §9. ui-test-yourstay's header-pill check is re-aimed to "You".
  Budgets: app.js +3.5KB, app.css +0.5KB gz.

## Things to do, polished (approved demo, built)

Supersedes the row details in the section below; the You placement and booked-only rule stand.
- **The You section**:
  - While staying, a tide chart comes first (`gaTideTip` → `tideChartSvg`/`tideToday`): a cosine
    drawn between the feed's own highs and lows, with a mark for now. It never shows a time the
    feed didn't give.
  - Then a row of scene cards, quick chips (`gaOpenTodoCat`), and at ≥900px four across with
    an "All N places" card.
- **The page**:
  - A search box (`expSearch`, `#exp-q`) and counted chips (`expBuildFilters`, a "Your list" chip
    included). The chips keep `.exp-chip` and the travelling pill.
  - Groups by kind in `EXP_KINDS` order. Boat trips carry today's high water while staying
    (`expHighWater`).
  - Rows with a scene thumbnail (`expArt` — one SVG per kind on the `--exp-*` tokens; an
    uploaded photo still leads), the distance, "Website · Phone", and a ♡.
- **One place**:
  - On a phone it opens as `#exp-detail-modal` (a `.chb-sheet`, body-level, `MODAL_CLOSERS`,
    Back/Escape).
  - At ≥900px it opens in `#exp-pane`, sticky beside the list.
  - It shows Website / Call / Directions / Save, plus a tide note on boat trips.
  - `gaOpenTodo(id)` opens a place.
- **♡ saves to `chb-exp-saved` in localStorage**: on that phone only, nothing on the server.
  A "Your list" group leads the page.
- **Good to know** is cards; the tide card carries the chart too.
- **Gates**: ui-test-guestaccount §10 covers the groups, the sheet and its actions, Save (store +
  chip + group), Escape, search narrowing, nothing-found and clear. ui-test-reach caught the
  sticky tools bleeding past the gutter.
- **Budgets**: app.js +3.7KB, app.css +1.4KB, index.html +0.1KB gz. The tsc app budget fell
  684 → 682.

## Things to do live on the You page (approved demo, built)

The guest menu is **Cottages · You**. Things to do left the dock and is a section of the
You page, between the stays and the account settings. It is still booked-guests-only (see
the next section).
- **`#ga-todo`** (`gaTodoHtml` / `gaTodoPaint` / `gaTodoLoad`, app.js) is a row of up to five
  `.ga-tcard`s you swipe sideways. The caption follows the stay (`gaStaysSplit`):
  "Plan your trip" before arrival, "Near <cottage>" during the stay, and "Things to do"
  otherwise. During a stay the boat and wildlife trips come first, and `gaTideTip` names
  today's next high water from the tide feed the site already has. It never invents a
  departure time. It renders nothing for a guest who hasn't booked, and repaints when
  `gaStaysLoad` lands. `__experiences` is declared far below, so `gaExps()` guards the TDZ.
- **The full page is ROWS** (`expCardHtml` → `.exp-row`: thumb, name, distance; a tap
  unfolds the words and the actions in place via `expRowOpen`, a 0fr grid fold).
  `.exp-card` stays on each row for the gates. A card on You opens the list with its row
  unfolded (`gaOpenTodo(id)`). The page leads with a "‹ You" back link (`.exp-back`).
  The dock's You tab marks `view-experiences`.
- The desktop header and footer links stay (booked guests only).
- Gates: ui-test-guestaccount §10 (the section, its caption and order, its placement,
  the menu, the card → unfolded row, the back link). ui-test-motion, ui-test-topmenu
  and ui-test-smallthings were re-aimed to a two-button dock. Budgets: app.js +1.6KB,
  app.css +0.7KB gz.

## Things to do are for guests who have booked (owner's ask)

Anonymous visitors, crawlers, and signed-in guests with no booking get no Things to do.
- **The server is the rule.** `viewer_has_booked()` (db.php) is true for the owner, or for
  a guest whose PROVEN address has at least one booking, past or future. `experiences.php`'s
  GET and `list` answer **403 `code: 'stays_only'`** to anyone else, and `suggest` requires
  the same. `experiences-page.php` no longer renders the list for crawlers and sends
  `X-Robots-Tag: noindex`. `/experiences` is gone from the sitemap. This trades away the
  page's search traffic, deliberately.
- **The site stops offering the door.** `body.has-booked` (`chbBookedSync`, called from
  `guestDockNeedsSync`, read off `__gaStays`) shows the dock tab, header, mobile menu and
  footer links. Owner-mode shows them too. Without it, app.css hides
  `a[data-view="view-experiences"]` and the dock button.
- **A direct visit says so.** On the 403, `renderExperiencesView` puts `exp-locked` on the
  view and only `#exp-locked` shows: "For our guests", with Sign in and See the cottages.
  It never shows "couldn't load" or "coming soon". `apiGet` now throws `apiErr` with
  `status`/`code`, as `apiPost` already did.
- Gates: test-integration §49 (visitor, POST door, owner, never-booked, past booking,
  unproven, page, sitemap) and ui-test-guestaccount §10. §10 was break-tested on the CSS.
  ui-test-motion and ui-test-guest-modals were re-aimed, because the first dock button is
  now hidden for a visitor.

## A guest's profile photo (approved demo, built)

Tap the circle on the Account page (or "Add a photo" on Your details) → a sheet (Take a photo /
Choose from library / Remove) → a cropper (drag, slider/wheel/pinch zoom, a 280px circle — what is
inside is what is saved). Shown on the Account page, on the guest dock's Account button
(`guestDockAvatarSync`) and beside the guest's name on the owner's booking page (`.bhub-ava`).
- **Private to the guest and the owner.** Files live in `uploads/avatars/` (deny-all `.htaccess`,
  random 32-hex names) and are served ONLY by **`avatar.php`**: `require_guest` → your own,
  `require_admin` + `?email=` → the owner's read. The client is told a 10-char VERSION
  (`guests.avatar`, migration-131, never the name), which every URL carries as `?v=`.
- **`avatar_store`** (db.php) takes a JPEG data URI (magic bytes, ≤600KB) and GD re-encodes it to a
  256px square, which also drops EXIF (a phone photo's location). Every refusal returns `''`.
  `guest_avatar_set` / `guest_avatar_remove` (auth.php) act on the SESSION's guest only; replacing
  or removing deletes the old file, and deleting the account deletes the photo.
- **The security pass that followed** (independent review, all fixed and gated in §48): dimensions
  are read BEFORE GD decodes (≤2048px — a tiny JPEG can declare a canvas that exhausts memory);
  no GD → refused, never stored raw (the re-encode is what strips EXIF); 12 sets an hour; files
  0600 in a 0700 folder; a day's private cache; self-repair sweeps files no guest row names; the
  photo rides "Download my data"; and **the owner only ever sees a CONFIRMED account's photo**
  (`email_verified_at IS NOT NULL` in both the payload and `avatar.php?email=`) — a stranger who
  squats a guest's address must never put a picture beside the real guest's booking.
- The version rides `guest_status` / `guest_update_profile`; other login paths fetch it once
  (`guestAvatarEnsure`). The owner's payload carries `guest_avatar` per booking (by email).
- Gated by ui-test-guestaccount §8 (sheet, Escape, a real drag, the post shape with no email, the
  page + dock, remove; the dock sync break-tested) and test-integration §48 (refusals, the 256px
  re-encode, the deny-all folder, served to the guest and owner only, removal deletes the file).

## Sign-in is code-first (approved demo, built)

The guest sign-in sheet (`#guest-auth-modal`, now one host `#ga-auth` painted by `authPaint` in
app.js) asks for an EMAIL and nothing else. The Log in / Create account tabs and the register form
are GONE (`switchGuestTab` survives as a compat opener).
- **The email gets a 6-digit code AND a link** (`guest_code_request`, auth.php; migration-132
  `guest_codes`, the code stored as an HMAC of email+code, 30 minutes, 5 tries). The answer is
  always `{ok:true}`, so the endpoint never says whether an address has an account. A KNOWN guest's
  correct code runs `guest_prove_address` (extracted from `guest_magic_consume` — same rules: an
  unproven password is cleared and the epoch bumped when proof comes from another browser) and signs
  in. A NEW address gets `{new:true}` and one more step: a NAME (`guest_code_register`, within 30
  minutes of the code) — no password, no address; the account is born verified because the code
  proved the inbox.
- **Six digits auto-verify**; a wrong code says how many tries are left, the fifth retires it; a
  30s cool-down guards "Send a new code". The owner's USERNAME (no @) goes straight to the password
  step and `guestLogin` tries `admin_login` first, as before.
- **The device is remembered** (`chb-last-guest`: name + email only, forgotten on account delete) so
  the sheet opens on "Continue as …". A passkey is offered IN the email field (conditional
  mediation, `authPasskeyAutofill`). A likely domain typo is offered once (`authTypoFix`).
- **`authPasswordGo` marks its button busy IN PLACE** — re-rendering swapped the fields
  `guestLogin` reads, and its error landed on a dead node (the gate caught it).
- **NOT built, deliberately**: the demo's "this screen signs in by itself" when the link is opened
  on another device. It is phishable — whoever requested the code could get the inbox owner to
  approve their session. The link still signs in the device that opens it.
- Gates: test-integration §50 (request/verify/register, tries, expiry, the proof rules),
  test-emails-render (`send_guest_code_email`, both kinds), **ui-test-signin.js** (§1–§5);
  e2e / ui-test-reach / ui-test-hig re-aimed off the tabs.

## The Key safes page: a status line, a to-do, one list (approved "simpler" demo)

`renderKeysafe` / `keysafeView` (admin.js, `.ks-*` in admin.css). Three rounds, owner-led
(overhaul → "can this be simplified?" → the approved demo); this is the end state:
- **SUPERSEDED: the status is the pill beside the title** (`#ks-pill`, "N codes to set" / "All N ready").
- **ONE STATUS LINE** (`.ks-status`) under the title — "✓ All 3 safes are ready" or red/amber
  "1 safe needs a new code". It counts the TO-DOS below, which include a safe with no code
  recorded (the duty counts only due/later; a safe with nothing on record has nothing to give).
- **A TO-DO CARD ONLY WHEN A SAFE NEEDS A CODE** (`.ks-todo[data-pk]`): a heading naming the
  work ("21A Westgate still has Hannah's code"), one `.ks-say` sentence (arrival + when they see
  it; a platform guest is told to share it in the platform's thread; changeover morning says
  "Rotate after X leaves at 10:00"), one primary `.ks-rotate`. AMBER while the leaver is still in
  (`d0.dep`), RED otherwise (`isRed`) — the duty's own severity.
- **EVERY SAFE IS A ROW OF ONE LIST** (`.ks-row`, a button opening `keysafeOpen`): cottage dot,
  name, the code on the right, one line ("Marcus · sees it from 06/10/2026", "No one booked",
  amber "Sarah staying until … · change it after"). Spoken with the code digit by digit.
- **THE DETAIL IS A SHEET** (`#ks-sheet`, a `.modal-overlay.chb-sheet` built on demand — a bottom
  sheet on a phone; Escape and the backdrop close it): tiles, set-for, next, when the guest sees it,
  Change code (`keysafeSheetRotate` closes the sheet, then the unchanged `keysafeRotate` dialog),
  past codes. **How it works** is the ⓘ by the title (`keysafeHow`, in admin-views.html).
- A confirmed rotation flashes its row green (`__ksFlash`). Every keeper rule is unchanged —
  `keysafeDue` still decides each state. Gated by ui-test-keysafe §2/§2b/§3/§4b–d/§6 (re-aimed to
  the to-do, row and sheet) and ui-test-ownerref (reads `.ks-say`/`.ks-row-sub`; its §5 vacuity
  floor is now 1, naming the sweep's own disclosure, since this page has none left).

## Conventions
- Owner content editing lives in **Settings**: "Website content" (global homepage/nav
  text + images) and Preferences → [cottage] → Photos / Text (per-cottage). The old
  inline live editor is fully REMOVED (code + CSS). Content
  is APPLIED to the page via the `data-edit-*` attributes + `applyContentOverrides`
  (reads `siteContent`), and galleries via `images-<prop>` — do NOT remove those;
  they're the rendering path, not an editing UI.
- Responsive: prefer the four canonical breakpoints (480 / 640 / 900 / 1200) for new
  media queries; migrate stray one-off widths opportunistically when touched. Gated by
  **`check-css-conventions.js`** (see below) — the complement of a canonical width
  (max-width:479/639/899/1199, min-width:481/641/901/1201) counts as canonical, since
  the pair is one boundary.
- **Design system**: `Cottage Holidays Blakeney/DESIGN.md` is the design language —
  build from the `:root` tokens in app.css (radius `--r-*` incl. `--r-panel`, status
  `--ok/--warn/--danger` + `--info` (the sea-blue "Arriving" state), text-on-accent
  `--accent-ink` (dark ink — white fails WCAG on the mid-light accent), shadows
  `--shadow-*`, easings `--fluid-bezier/--spring`); the `-text` variants (`--ok-text`
  … `--info-text`) are the light tints readable on glass and are retuned under
  `body.light-mode`. Never introduce new raw hex/px/easing values for things a token
  covers. `.sr-only` is the visually-hidden-but-announced utility (status live
  regions etc.).
  **WEIGHT IS REAL NOW — the ladder is 400 / 500 / 600 / 700 and nothing else.**
  Both families are latin-subset VARIABLE woff2, but app.css declared one
  `@font-face` per weight (Google's css2 output shape), and a SINGLE-VALUE
  `font-weight` descriptor PINS a variable file's wght axis. Montserrat was declared
  at 300/400/500, so every weight the app asked for above 500 matched the 500 face
  and got the same synthetic bold: measured, 500 / 600 / 650 / 700 / 800 all set
  "£290.00 Handpicked" to the identical **421px** — five declared weights, one look.
  That is why PR #839 ("make the £290 the same size as the rest of the text",
  re-emphasising by weight instead of size) changed **0 pixels of 25,812** and its
  gate still passed: the gate asserted the DECLARATION, not the rendering. One
  ranged block per family now (Montserrat `100 900`, Playfair `400 900`) and the
  same file instances properly — 421 / 424 / 431 / 437px at 500 / 600 / 700 / 800,
  for no extra bytes. Two consequences: real bold is ~2.4% **WIDER** than the
  synthetic it replaces (advance widths grow where a stroke-widen did not), so a
  weight change is a layout question here; and the off-ladder 550 / 650 / 800 sites,
  which had all been rendering as that one bold, are collapsed to the four steps.
  Gated by **ui-test-searchpage §16a**, which asks the FONT whether the steps differ.
  **The search window's type scale is SIX named steps** (`--cmdk-fs-hero/lead/body/
  row/sub/micro` in admin.css, a phone re-declaring the TOKEN rather than the
  rule). It had nineteen sizes, twelve within 0.02rem of a neighbour, three of which
  never rendered at all because the later ONE-ASSISTANT-LOOK block overrode them.
  §16b sweeps three render states (landing / answer / selected record — they light up
  largely disjoint rules, and scanning only one let a deliberately off-scale
  `.cmdk-hero-sub` through) and fails on any size that is not a step.
  It was seven, and that block's comment claimed every step stood ≥1.2px from its
  neighbour — **which was false**: three of six gaps were under it and the tightest,
  sub against meta at 0.64px, was closer than pairs the collapse had removed for being
  too close, on surfaces they SHARED (a hero's sub sits directly above row subs in the
  same list). Those two are one step. The single close pair left is body against row
  at 0.8px, tolerated because prose and a list label never appear as PEERS — and the
  one place they did, `.cmdk-none`'s title over its own sub, was the real defect there
  (that title now takes `--lead`, gated separately). **§16c asserts the true minimum
  gap**, so the prose and the tokens cannot drift apart again; write a claim about the
  numbers and gate it, or don't write it.
  **The assistant's knot carries model state in COLOUR ALONE**, so its five state
  colours are 1.4.11 non-text cases at 3:1, not decoration — see `--knot-*` and
  a11y-test §1c.
  **`.glass-panel` is a MATERIAL, not an affordance.** Its `:hover` rule (app.css,
  inside `@media (hover: hover)`) adds `transform: translateY(-5px)` + a
  `--glass-hover` background — that is a CARD saying "I respond to you". But the same
  material is worn by every modal, the shared glass dialog, and the account-preview
  shell, none of which you click, and on those the hover state was actively wrong: it
  MOVED them (the glass dialog measured top 377.3 → 372.3 as the pointer crossed its
  edge, shifting its own buttons under your reach — including the bulk-send confirm),
  and it made them TRANSLUCENT, which on `.acct-preview-shell` silently undid the
  opaque ground that element sets for itself, so the back office ghosted through
  behind the customer's name — the exact bug its own comment claims to have fixed,
  because only the RESTING state had been. The 5px lift also broke the notch
  guarantee (bar at 55px against a 59px inset). Containers now opt out by name in
  that same media block (`.modal-box`, `.glass-dialog-box`, `.reviews-modal-box`,
  `.terms-modal-box`, `.acct-preview-shell`, `.datepicker-card`, `.cal-panel`);
  decorative page panels (hero, trust strip, host card) deliberately keep the lift.
  NB this also made `ui-test-acctpreview` deterministic — it had been passing or
  failing on wherever the pointer happened to sit, so it now HOVERS the shell on
  purpose before measuring, and asserts that it is hovered.
  **Colour for WORDS vs colour for THINGS.** `--accent` is for icons, stars, borders
  and fills, which only have to clear the 3:1 non-text bar; WORDS in the brand accent
  take **`--accent-text`**, because the rose-gold measures 2.60–2.96:1 against all
  four light surfaces and fails AA outright (it reads 6.5:1 on the dark ground, so
  the two tokens are the same value in `:root` and only light mode retunes). Same
  relationship the status tints already had. Every text token is deliberately a shade
  PAST the pass mark rather than on it — `--warn-text` sat at 4.46:1 and `--ok-text`
  at exactly 4.50:1 on the timeline's grey band (`#f0f0f0`, darker than the cream
  those two were tuned against) until they were nudged, so treat 4.5 as the floor to
  clear, not to land on. **`a11y-test.js`** gates all of it (see Testing / CI).
- Guest mobile shell CSS/JS is gated to `body.guest-app:not(.owner-mode)` so admin
  (`owner-mode`) and desktop are never affected. Keep new shell rules gated the same way.
- The site deploys from `main`; the repo is cloned fresh each session (ephemeral
  container), so anything that must persist has to be committed.

## Architecture map
Single-operator holiday-let PWA. No framework, no build step.

**Frontend** (no inline blobs anymore — CSS and JS are extracted into cached files)
- `index.html` (~139KB / 28KB gz) — markup + `<head>` only: `<main class="page-view">`
  sections toggled by `nav(viewId)`; `currentGuest`/`isAuthenticated` +
  `body.owner-mode`/`body.guest-app` classes drive what shows. Links `app.css`, then
  `app.js`, then `guest-app.js`. The seven ADMIN views are EMPTY `<main>` shells here —
  their bodies live in `admin-views.html` (below).
- `app.css` — the main stylesheet (was the inline `<style>`).
- `app.js` — the PUBLIC app (guest site + shared helpers + auth) as globals that
  inline `onclick`s call. `const BUILD` (last statement) is the version stamp.
  Loads before `guest-app.js`.
- `admin.js` — the owner back office, split out so guests never download it.
  Fetched on demand by `loadAdminBundle()` (facade at the top of app.js): eagerly
  from `setAuthUI()` on any owner sign-in / session restore, lazily via the
  generated **stub list** (async `window.*` stubs that load the bundle then
  delegate; admin.js's footer publishes the real fns over them and sets
  `__ADMIN_LOADED`). Rules: admin.js may use any app.js global; app.js/guest-app.js
  must NOT reference admin names except via the stub list; shared state stays in
  app.js; nothing admin runs on public boot (a stub call there would make every
  guest fetch the bundle — see the `__ADMIN_LOADED` guard in
  `loadSquareAdminConfig`). smoke-test.js §1 enforces the facade contract
  (evaluates both files, all stubs replaced) and 6a/6c check handlers + that
  admin.js stays OUT of the sw.js CORE precache.
- `admin-views.html` — the back-office MARKUP, split out of index.html for the same
  reason as admin.js: it was ~40% of the file / ~17KB gz that every guest downloaded
  and never saw (index.html is now 43.8→28.4KB gz). One
  `<template data-view="view-…">` per admin screen; `ensureAdminViews()` (app.js)
  injects each body into index.html's matching empty shell as the FIRST step of
  `loadAdminBundle()`, before admin.js is evaluated — admin.js's renderers target
  these ids, so the markup must be in the DOM before any admin fn runs (admin.js is
  `<link rel=preload>`ed at the same moment so the two fetches still overlap; only
  EXECUTION is serialised). Versioned by **ADMIN_BUNDLE_V — the same stamp as
  admin.js, deliberately**: the two must ship in lockstep, and one shared version
  can't drift the way two would (bump.js + check-versions.js both treat a change to
  either file as requiring that bump). Kept OUT of the sw.js CORE precache like
  admin.js. Every smoke-test markup gate (6a-i inline handlers, 6a-ii the inline-`on*`
  ratchet, 6a-iii `data-act` resolution, 6b duplicate ids) scans index.html AND
  admin-views.html together — scanning only index.html would silently drop ~40% of
  the app's markup out of coverage. app.js may only touch ids inside these views
  NULL-GUARDED (they don't exist until an owner signs in); the nine existing
  references already are.
- `guest-app.js` / `guest-app.css` — the mobile app shell only (the menu dock,
  full-page overlays, install chip). Loaded with `?v=` and gated as above.
  **The customer menu is in the HEADER on mobile, the same place as on desktop.**
  There is only ONE nav: `placeDock()` MOVES the existing `.guest-dock` node into
  `#guest-dock-slot` inside `<header>` when the shell applies, and back into
  `#guest-tabbar` when it doesn't (both ways, live, on crossing 768px) — so the
  sliding indicator, `setActiveTab` and every button handler are untouched (same
  re-parenting trick as `#booking-hub-content`). Three things this must keep
  right, all gated by `ui-test-topmenu.js`: (1) select the nav dock via
  `#guest-tabbar .guest-dock`, NEVER document-wide — `#guest-msg-fab` holds a
  SECOND `.guest-dock` (the standalone Messages pill) and moving that one puts
  the chat bubble in the header and leaves the nav behind; (2) only the DOCK
  moves — `#guest-tabbar` keeps the cottage pages' "Check availability" pill
  bottom-anchored in thumb reach, and it must, because that wrapper carries a
  `transform`, making it the containing block for any fixed child; (3) the header
  is `z-index: 1410` so it out-ranks the full-page guest screens (chat + auth at
  1390) — otherwise a guest who opens Messages can't tap another tab to get out
  (`ui-test-guest-modals.js` hit-tests this). The dock's own crown Home button is
  hidden in the header because the logo beside it already goes Home — so Home's
  "you are here" mark lives on the LOGO instead (`.logo-current`, set by
  `applyCurrent`), keeping exactly one selection cue in the bar.
  **Motion** (gated by `ui-test-motion.js`, iOS-flavoured): the selection pill
  travels on `translate` and squashes via a separate `scale` keyframe —
  deliberately two properties, because one combined `transform` lets the keyframe
  override the travel and the pill teleports. `style.translate` is set DIRECTLY,
  never through a `var()`: a transition can't interpolate a custom property
  (they animate discretely), which teleports just as silently. Scrolling
  CONDENSES the header (`.header-condensed`, ≤24px threshold, set in app.js's
  `setupHeaderScroll`) instead of hiding it — `.header-hidden` is suppressed in
  the shell because it would carry the menu away; desktop keeps the original
  hide-on-scroll untouched. `prefers-reduced-motion` drops the springs and the
  squash but KEEPS the pill's movement and the condensed layout (both carry
  meaning, they're not decoration).
  **Bar proportions**: the crown was 63×38 against 38px icon buttons, so it held
  nearly all the visual weight with ~147px (40% of the bar) empty between it and
  the icons — the mark is now 30px (25px condensed) and the icon gap 6px, so they
  read as peers. That middle space carries `#guest-head-title` (created by
  `placeDock`, set by `setHeadTitle` from the active view; the cottage page reads
  its OWN `#prop-title` rather than keeping a second copy of the owner-editable
  cottage names). It is revealed ONLY in the condensed state — at rest the page's
  own big heading is still on screen and showing both would say it twice. Home
  gets no title (the crown already says it).
  **AND `.logo` MUST BE PINNED `flex: 0 0 auto`, for the SAME reason the owner side
  is** (reported from a phone: "between experiences page and any other page the crown
  logo changes size"). `#guest-head-title` beside it is `flex: 1 1 auto` and holds the
  OWNER-EDITABLE screen name, while `.logo` was left at the shrinkable `0 1 auto`
  default — so a long name took its share of the shortfall out of the BRAND: measured
  at 390px, "21A Westgate Street" shrank the mark **49.9px → 38.5px** (23% smaller on
  the page most guests land on) while Home, which deliberately has no title, stayed
  full size. The sting is that the title is `opacity: 0` until the bar condenses, so an
  element nobody could see was resizing the logo. The title already carries
  `min-width: 0` + an ellipsis; it is the sibling that should absorb a squeeze. Gated
  by **ui-test-topmenu §G**, which sweeps home / experiences / cottages / a cottage
  page at rest AND condensed and asserts one box in one position — an OUTCOME, since a
  `flex` declaration check would pass on any future layout that pins the logo another
  way while still moving it. Compared WITHIN a state, never across: condensing scales
  the mark 30 → 25px on purpose. A 57-character name is injected too (the real ones fit,
  so the sweep alone could pass vacuously), and it asserts the name really arrived —
  the first draft read `textContent` after restoring the short one and reported a
  clipped 19-character title, passing while proving nothing.
- Routing is `nav()` toggling `.page-view.active`; per-view init lives in `nav()`
  (e.g. `view-experiences` → `renderExperiencesView()`). No router lib.

**The ADMIN nav is in the HEADER too** (`admin.css`, `body.owner-mode header …`) —
owner-mode used to hide the header outright and float `.admin-dock-wrap` at the bottom
of the screen; both sides now put navigation in one bar at the top. The dock is STATIC
markup with a single home, so unlike the guest dock it needs no re-parenting: it simply
lives inside `<header>`, where admin.css drops the dock's own glass/shadow and pushes the
wrapper right (`margin-left: auto`). The wrapper's base rule in app.css is deliberately
just `display/align-items/gap` — it used to carry the whole bottom-floating geometry
(`position: fixed`, `bottom`, `left: 50%`, `transform`, `z-index`, `max-width`), every
line of which admin.css immediately overrode in the only state where the dock is ever
visible, so it was computed-then-discarded; don't reintroduce it. Note the customer-nav hide must
be **`header > nav:not(.admin-dock)`**, because the admin dock IS a `<nav>` in this
header and a bare `header nav` hides the very menu this provides. Four more things it
has to keep right, all gated by `ui-test-adminmenu.js`: (1) the guest dock must VACATE
the header when the owner signs in — that's a body-class change, not a resize, so
`watchOwnerMode()` (guest-app.js) observes `owner-mode` and re-runs `updateShell()`,
whose else-branch now also removes the stale `#guest-dock-slot`/`#guest-head-title`
(they lingered as a 60px ghost of the guest pill inside the admin bar); (2) the icons
take `var(--text-light)` — they were WHITE, right for the dark floating pill, invisible
on the light glass bar (measured: 4 of 5 at luminance delta 0), and `:not(.current)`
because the selected one must stay dark against the white pill; (3) the selection pill
travels on `translate` with a separate `scale` squash and is re-seated by a
`ResizeObserver` (`watchAdminDock()`), for the same two reasons the guest side needed
both — a combined transform teleports, and condensing changes the button widths under a
stale placement; (4) reduced motion drops the **easing only** — never `transform: none`
on the bar, which centres itself with `left: 50%` + `translateX(-50%)`, so blanking it
shoves the whole thing 185px right (measured: header right 380 → 550, icons off screen;
the condensed scale is likewise a compact layout, not an effect). Scrolling condenses
and never hides (`setupHeaderScroll`'s guard is now `owner-mode || guest-app`), the
condensed bar names the screen in `#admin-head-title` (label read off the dock BUTTON so
it can't drift; the two hubs + search are named in `nav()`), and `body.owner-mode
.container` clears the bar at the TOP instead of the bottom. `loadAdminBundle()` now
AWAITS `ensureAdminCss()` alongside the views — fire-and-forget let the back office
paint before its own stylesheet arrived, so the nav rendered at its old floating size
inside the header and overflowed the bar.

**Back-office IA** — the admin dock (`body.owner-mode`) has 4 buttons, each a task
area, not a settings dump: **Today** (`view-backoffice` — the OPERATIONS workspace:
the **Needs-you strip** first (`renderNeedsYou()` — ONE prioritised to-do list:
automation warnings, waiting enquiries, balances to chase ≤21 days out, damages
deposits to return, chats, approvals; each row one-tap-routes to the exact
hub/screen; hidden when clear), then the timeline calendar, then the bookings
master–detail — filters/search/`.bk-row`
index + the `#bookings-detail-pane` docked hub at ≥1200px; `openBookings()` survives
as an alias that lands here and scrolls to `#bookings-workspace`;
`dock-badge-enquiries` pip), **Inbox** (`openInbox()` → `view-inbox` — the COMMS
dashboard: an **Enquiries | Messages | Email** folder switch (`inboxFolder()`,
`#inbox-folder-*` containers, `.ifold-count` chips). At ≥1200px the Inbox is an
APPLE-MAIL three-pane client: the folder switch becomes a left sidebar rail, the
active folder's list is the middle column, and `#inbox-detail-pane` is a reading
pane serving EVERY folder — the enquiry hub docks as before, emails open in the
pane (`mbxPaneDock()`; row highlight `.is-open`; below 1200px they open as an
in-row accordion, `mbxSlotFor()`), and guest chats dock the `#messages-modal`
node into the pane as a static panel (undocked on folder switch; app.js
`openMessageThread` self-heals the dock via DOM checks only — never admin
globals). Email is the full mailbox client (`loadMailbox()`/`mailbox.php`, lazy
on first open — moved from Manage, and `settingsOpen('mailbox')` redirects
here) with its own Inbox|Sent switch in the toolbar; the folder switch itself is the
only level of nesting — the old `inboxSub()`/`inboxSubClose()` drill-down and its
`INBOX_SUBS` map are GONE (admin.js says so in a comment; this line documented them
long after they were removed, so don't go looking for them);
`dock-badge-inbox` pip), **Payments** (`openAccounts()` →
`view-accounts` — dock label/titles say "Payments" but the internal ids keep
their names (`asec-*`, `#money-overview`);
`accountsOpen(id)` → `#asec-<id>`, incl. the pricing coach), and
**Manage** (`openArea()` → `view-settings`, ONE index — cottages, then marketing, then
account/system, grouped by `.settings-section-label`s; the old per-area filtering is
gone but `applyAreaFilter()` keeps its name as the open/return repaint; a row opens
via `settingsOpen(id)` → `#sec-<id>`; the health/cron pills + Activity log + the
**Search learning** page live here). **Search learning** (`renderSearchLearning`,
System group, `#sec-search-learning`) is the assistant's per-owner teach loop as a
proper screen: the dead-end searches to teach (`chbMissList` → `slTeach`/`slForget`,
suggestions from `chbNluSuggestSmart`), the phrasings you've taught (`chbNluLearned`
→ `slUnlearn`/`chbNluUnlearn`), the ones made literal (`chbNluSuppressed` →
`slRestore`/`chbNluRestore`), and a plain-language model-status line. It only
exercises the existing learned/suppressed/miss lists — NEVER the frozen corpus. The
in-search "dead ends" review (cmdkIntent 0n) still works; this is the same data with
a home in Manage. `ADMIN_VIEWS` is the
canonical admin-screen list (used by `nav()`/`forceAdminLogout()`) — keep it complete.
The two dock pips both show `enquiries.length`, synced from `refreshInboxBadge()`.
**Assist NLU cascade** — three tiers in `chbNluClassify` (admin.js), each consulted only
when the previous abstains: tier 1 TF-IDF centroid cosine, tier 2 kNN+ELM fusion, tier 3
**Darkstar** (`DARKSTAR`) — our on-device SEMANTIC model: a static token-embedding table
(29,528 tokens × 256 dims, WordPiece) packed by `darkstar-build.js` (dev-only,
deploy-excluded) into **`darkstar.bin`** (int8+scales, ~7.6MB, committed + deployed;
versioned by its `?v=` in `DARKSTAR.url`). Pure JS — no WASM/CSP change; lazy owner-only
fetch ~2.5s after the admin bundle boots (until it lands the cascade is lexical-only, as
before). Measured: 48→51/52 held-out, zero wrong intents, all negatives rejected
(search-test §20 is the CI gate — recoveries, negatives, train accuracy, teach-loop
reach). chbNluLearn/Suppress call `darkstarIndex()` so taught phrases join their intent
centroid and suppressed ones join the none pool. (`darkstar-build.js` carries the source
table's MIT attribution notice.) The corpus is ~117 TARGETED examples — brute expansion
blurs the TF-IDF centroids (measured), so add disambiguators only. **Semantic precision
veto** (`darkstarNoneDominates`, `DARKSTAR.veto` 0.12): once Darkstar is loaded it can
VETO a confident tier-1/2 answer when its best none-exemplar beats its best intent-centroid
by the margin — so "directions to the cottage" / "which cottage has a hot tub" stop
false-matching *which cottage earns most* on the shared word "cottage". Monotonic-safe (only
ever turns an accept into an ABSTAIN — never invents an intent), so the zero-wrong guarantee
can only tighten; no model loaded → no veto (unchanged). Margin swept to hold held-out at
86/86 + every committed negative while lifting hard-negative rejection. The model's accuracy is
gated on a committed held-out set: **`nlu-testset.js`** (dev/CI, deploy-excluded — 112 unseen
paraphrases + 40 negatives incl. in-domain distractors: veto + none-class cottage-feature /
capacity / directions / card-payment cases, fresh-worded to check the reject class GENERALISES)
run through the full cascade in search-test §20: recall ≥ 95% (scales with the set), ZERO wrong
intents, all negatives rejected. The model is at its PRECISION/RECALL CEILING — measured 3× this
session that ADDING positive corpus examples (recall) OR a Darkstar arbiter blurs the boundaries
and breaks the zero-wrong guarantee, so recall is grown only via the per-owner teach loop
(`chbNluLearn`) and precision only via TARGETED, measured none-examples. NB the corpus is precision-tuned: `noneExamples` carry TARGETED in-domain distractors
(re-measure — several collide with real paraphrases and cost held-out; the excluded ones are
noted inline), and adding POSITIVE examples blurs the centroids (measured: +12 introduced 5
held-out wrong intents, reverted). Retune with
scratchpad `model-bench.js` (+ `stress-bench.js`/`sweep-veto.js` for the hard set/veto margin).

**chbSay** (admin.js) — the ANSWER VOICE. The data answers (money, arrivals/leaving/staying/
next, deposits) are now warm SPOKEN sentences, not database read-outs — "You're owed £1,000
across 2 guests, Cara leading at £600", "Eve's your only departure today", "Just one deposit to
hand back — Dan's". Each family passes its numbers to `nlgPick`-seeded frames (deterministic per
query → stable + golden-testable; different questions vary) via helpers `chbSayFirst` (first name
in prose) and `chbSayN` (small counts as words). It
LEADS with the key figure/name so search stays scannable, then the human frame. **Figure cards**
(revenue / occupancy / nights / top cottage / busiest month) keep their number-forward stat
format by design (a big number reads better than prose) but get warmer labels/subs with stance
("Jollyboat's your top earner — £2,240"). golden-test asserts the CORRECT content (total, salient
guest, count) not the exact phrasing (which varies by design).

**chbNlg** (admin.js) — the assistant's conversational-awareness layer (TEXT, shown on
screen — there is NO listen/speak feature; it was removed). `chbNlgSocial(q)` generates
conversational replies — AWARE greetings (with a live `chbNlgBrief()` day status:
arrivals/departures today + money to collect), thanks / bye / ack / capability / identity,
deterministic variation (`nlgPick`) — surfaced through cmdkIntent's `0-social` branch.
`chbNlgFallback(q)` is the safety net: a question-shaped query that finds NOTHING (empty
intent AND fuzzy) gets a natural "I can't answer that, but I can tell you about…" reply
with the model's nearest guesses as chips, injected in `cmdkBuildResults` — so a question
never dead-ends silently. Matchers are precise so real searches pass through. `chbNlgHowTo(t,
more)` REALIZES a help topic into a spoken how-to answer: it stitches the topic's full-sentence
`steps[]` into one flowing paragraph (`First,…/Then,…/Finally,…`, rendered as `.cmdk-nlg-body`)
and rides its `doIt`/`showMe` + "More:" runners-up as chips — so an explicit "how do I…"
question GENERATES a single natural-language answer instead of a stack of topic rows. `cmdkHelp`
returns it (in place of `cmdkHelpItem` rows) when `wantHelp` and the top topic scores ≥ 3; a
plain keyword still returns the browsable `type:'help'` rows — and those rows now build the
SAME chips this does. They didn't: `cmdkHelpItem` went on emitting `'More: ' + full title`
for months after the generated answer had dropped both, so the same idea looked like two
different things depending on how you happened to ask ("More: Return (or keep) a damage
deposit" against a clean "Return or keep a damage deposit"). A help row's SUB is also no
longer the topic's first step: `steps[0]` is sometimes an instruction ("Tap “Block dates”.")
and sometimes a ~100-character explanation, and the row sub is a single-line clamp by design,
so half of them were sentences cut mid-word — which reads as a bug and states no complete
fact. `cmdkHelpSub` keeps a step short enough to work as a label (≤46 chars) and otherwise
says what IS complete at that length: "Money · 3 steps". Gated by ui-test-searchpage §18a,
which reads the COMPOSER rather than the DOM, since these rows only surface for some queries
and a DOM check would pass by rendering nothing.
**A how-to's chips are TWO species and are grouped as such.** `doIt` / `showMe` /
"Walk me through it" act on THIS topic; the runners-up go to ANOTHER one. They were one
undifferentiated wrap of pills — measured at 390px: 116, 126, 262px and a 44-char label
that WRAPPED to two centred lines (58px among 29px neighbours), with 84/226/90/182px of
dead space beside them. Now the runners-up carry `kind:'topic'`, lose the dead "More: "
prefix and any trailing parenthetical (`chbChipLabel` — `q` keeps the FULL title so the
topic still resolves), take the muted "goes elsewhere" treatment with the knot glyph that
this file's comments had promised for related searches but never actually rendered, and
`flex: 1 1 240px` gives them a line each which they FILL, so the block ends flush instead
of ragged. `.cmdk-chip-lbl` clamps every chip to one line, so a long label can never
become a lozenge again. The separator is a zero-height flex break (`.cmdk-chip-brk`), NOT
a split array: `cmdkChipRun(i, k)` and `cmdkRowSubItems` both index straight into
`it.chips`, so this obeys the same invariant as the layouts — regroup freely, never
re-order or re-index. Gated by ui-test-searchpage §14 at 390 and 1280px (index integrity,
one-line clamp driven by an INJECTED long label — without one the check is vacuous
because the real titles fit their stretched line, no "More:", both species present,
destinations flush). Conversational answer rows
(social greetings, fallbacks, generated how-tos) carry `wrap:true` → the row renders
`.cmdk-row-wrap` so full sentences wrap over multiple lines instead of clamping to one
ellipsised line on the search page. **A wrapping row must LIFT THE CLAMP, not just the
overflow**: `.cmdk-row-label` is a 2-line `-webkit-line-clamp` box, and `.cmdk-row-wrap`
originally relaxed only `overflow: visible` — the worst of both, because the box stays
two lines TALL while its content is no longer clipped, so every line past the second
paints ON TOP of the row's own sub, the next group heading and the row below (measured
on "Help" at 390px: box 39px, content 117px — 78px of an answer over other text; 19px
even at 1280px). It now also resets `display: block` + `-webkit-line-clamp: none` so the
box grows to the sentence. Gated by ui-test-searchpage §13, which checks the GENERAL
form rather than that selector — any leaf whose content is taller than its box while
nothing clips it — so clipped/ellipsised truncation stays allowed by design. Additive — the tested answer rows are
unchanged. Gated by search-test §22 + §8 (how-to) + golden social cases.

**Guided walkthroughs** (admin.js — help that HELPS ALL THE WAY THROUGH a task, not just
describes it). Where the single-step `coachMark`/`coachTo` ("Show me where") points at ONE
button and stops, `coachSequence(steps, i)` chains coach-marks INTO the task: each step
spotlights its target (`coachPaintStep`, reusing the ring + `coachReposition`) with the
sentence you'd have read, shows "Step N of M" + Next/Back, and AUTO-ADVANCES the instant the
step's `until` signal fires (you typed the name / set the dates). It waits for each target to
appear (30×200ms), and Escape stops it (`coachSeqStop`). The sequence overlay (`.coach-ov-seq`) is click-THROUGH
(`pointer-events:none`, only the tip interactive) and sits ABOVE modals (`z-index:7000`) so it
can spotlight fields INSIDE the Add-Booking box. Crucially SAFE: it only points and waits — it
never submits or edits (you tap Save). Flows in `CHB_WALK`: `add-booking` (5-step field-by-field
on the shared `#modal-*` ids), `block-dates` (the `#glass-dialog-fields` step), `take-payment` +
`refund-deposit` (cross-navigation — open a `.bk-row`, then the hub's `[data-act="requestPayment"]`
/ `[data-act="returnDeposit"]`, advancing on presence). `coachWalk(topicId, from)` launches; `chbNlgHowTo`
prepends a **"Walk me through it"** chip for any topic with a `CHB_WALK[id]`.
**A WALK THAT LOSES ITS TARGET STOPS, AND SAYS SO.** `document.contains` was the only
liveness test, and `closeModal()` removes a CLASS not the node — so a cancelled Add
Booking left the guide certain its form was open: measured, overlay still up on Today
reading "Tap Save", `__coachSeq` alive, ring painted 172×56 at (37,725) over a
zero-rect button (the ring was STALE — `coachReposition` only ran on scroll/resize, so
it is now called on the 350ms poll tick too). `coachAlive` is `getClientRects().length
> 0` + a non-zero rect — deliberately NOT `offsetParent`, the obvious-looking test,
which is null for any `position: fixed` element and so judged live buttons inside
fixed overlays dead. What a vanished target MEANS is now per-step: `until` true →
you did it, advance; last step → only `done` can tell saved from cancelled;
otherwise → you backed out, `coachSeqAbort` says so and offers "Start again" (NB
`toast`'s third arg is `{label, fn}` — a `run` key renders no button at all). The
30×200ms give-up aborts with a sentence instead of vanishing.
**REACHING THE END IS NOT FINISHING.** The last step is always "tap Save" and has no
`until`, so the walk used to toast "You're all set" whether you saved or backed out.
A flow may declare `mark`/`done` — snapshotted in `coachWalk` BEFORE `start` runs
(inside `coachSequence` it would be re-read per step and could never fail) — and gets
to say "Saved — the booking is on Today" or "Stopped before saving — nothing was
created". A flow that cannot observe its outcome cheaply declares NEITHER and keeps
the neutral sign-off (take-payment ends in an email); search-test gates them as a pair.
**IT STARTS WHERE THE OWNER ALREADY IS.** `start` used to run unconditionally, so
asking "how do I take a payment" with the pay banner in front of you bounced you to
Bookings and re-filtered. `coachWalk` skips leading steps whose `until` is already
true, then navigates only if the step it landed on isn't on screen. That exposed a
latent bug: add-booking's cottage step read `until: value.length > 0` against a
STATIC preselected `<select>`, so it was true before the modal opened — the walk
auto-advanced off its own step 1 after the 1400ms grace, and the skip pass started a
blank form at step 2 of 5. A default is not a decision; that step has no `until` now.
**THE TIP MEASURES ITSELF.** `coachReposition` chose above-or-below with `r.bottom +
110 < innerHeight` — a hardcoded GUESS at the tip's height, right for a short sentence
(111px measured) and wrong by 106px for a real one (216px). At 390×844 with a target at
y=640 that put the tip's bottom at 918, i.e. **74px past the fold with its own Next
button off screen** and the walk unadvanceable except by Escape. It reads the tip's real
box now (it is in the DOM before this runs), and clamps when NEITHER side fits; the tip's
width likewise replaces a `260` that duplicated the stylesheet's `max-width` in JS.
**THE STEP IS ANNOUNCED.** Measured: `role` / `aria-live` / `aria-label` all null on
`.coach-tip`, and focus deliberately stays on the field — so a screen-reader user got an
overlay nobody mentioned and five steps they never heard. The visible label + sentence
are `aria-hidden` and the same words go to an `.sr-only` `role="status"` region written
one frame AFTER the tip lands — separate region because `coachClear` rebuilds the overlay
each step, and a live region that arrives WITH its text is not reliably announced (the
payment-outcome rule). Polite, not assertive: the field beneath is where the work is.
Tip buttons take the house 44px floor (they measured 70×30 — over WCAG 2.5.8's 24px,
under this app's own bar, on a control tapped once per step). Reduced motion drops the
ring's EASING and the tip's fade but keeps the ring's TRAVEL — it is the pointer, the
same call the guest dock's pill gets — and `scrollIntoView` goes `auto`, and is skipped
entirely when the target is already comfortably on screen. NB Chromium's reduced-motion
emulation forces every `transition-duration` to ~1e-05s regardless of author CSS, so the
gate asserts the `@media` RULE via CSSOM: a computed read cannot tell our rule from the
browser's own and passes with the rule deleted. `a11y-test` gained a `walkthrough` scene
(driven to a MIDDLE step so Back renders) — it had never seen this overlay, the same
blind spot that let a 23px `.cmdk-qa-row` live in the search window.
Gated by `ui-test-coach.js` (start, click-through + z-order, Next/Back, auto-advance,
Done, Escape, plus cancel-mid-walk, the honest finish both ways, the lost target,
starting in place without navigating, tip-fit at four target heights, the announcement,
and reduced motion — each break-tested) and search-test §8b (every
walk id is a real topic, every step has a target and a SENTENCE, every walk is
reachable via its chip, `mark`/`done` paired). NB a step-COUNT comparison against the
topic's prose was tried in that gate and dropped: it is not an invariant — a walk
legitimately splits one prose step into fields (add-booking 5 vs 3) and legitimately
collapses three into one dialog (block-dates 1 vs 3).

**The CROWN is the assistant** (`crownSheetToggle`/`openCmdK`/`closeCmdK`) — there is
no separate Search knot and no second surface. There used to be a `#crown-sheet` that
showed four rows and handed off to a full-bleed `#cmdk`; it is REMOVED (node, CSS,
`crownSheetEl`/`Rows`/`Open`/`Close`, `#crown-scrim`, `#crown-ask`, `.cs-*`), and the
per-workspace Assist Bars (`abar*`) with it. **Do not reintroduce either**: a sheet is
a menu for the feature, so the answers live one journey away. `crownSheetToggle` keeps
its name (it is in the `chbAct` registry and on the crown's `data-act`). The bar cannot
host a field — at 390px the middle slot yields 80px and the input needs 215px+ — which
is why it drops a pop-out rather than navigating.

Six things the crown must keep right, gated by `ui-test-crownsheet.js`: z-index **1440,
BELOW the header's 1500**, so the crown stays hittable and one target toggles both ways;
**`.logo` pinned `flex: 0 0 auto`** (it is `0 1 auto` by default and a long screen name
squeezed it to 19–20px — the crown is the only route to the assistant); the handler
SELF-HEALS (admin.js cannot be un-run, and `.logo` is the public site's Home link, so it
checks `owner-mode`); Escape hands focus back (`crownSetExpanded` keeps `aria-expanded`
in step from both `openCmdK`/`closeCmdK`); the crown carries the model STATE as colour;
and a query is ANSWERED IN PLACE, because there is nowhere to hand off to.

**SEARCH IS THE POP-OUT** (`#cmdk.cmdk-overlay` + `#cmdk-scrim`, z 1440/1430 — below the
header, far below real modals at 2000+, so a glassConfirm raised FROM search covers it).
- **`cmdkEnsureOverlay()` re-parents `#cmdk` to `<body>` and that is not optional**: a
  `.page-view` carries a transform, making it the containing block for any fixed child,
  so left in place the "overlay" is pinned inside the page. The markup ships in the
  `view-search` template only because that is how `ensureAdminViews()` delivers it.
- `openCmdK` does NOT navigate — the active view is unchanged, which is what lets the
  scope/entity snapshots work (`__cmdkReturnView`, `__cmdkHomeScope`, `__cmdkEntity`).
  State to know: `__cmdkResults`, `__cmdkSel`, `__cmdkEmpty`, `__cmdkDeep`,
  `__cmdkThread`, `__cmdkConvCtx`; `body.cmdk-open` locks the page scroll and
  `.cmdk-results` scrolls inside with `overscroll-behavior: contain`. The palette's
  "filter this workspace" uses `renderTodayFilterBar` + the dim machinery. `closeCmdK` is state cleanup + hide; `cmdkBack()` closes
  and returns focus to the crown. `nav()`'s teardown hook is keyed on the overlay's own
  CLASS via a DOM check (app.js may not reach admin globals), so any navigation still
  files the dead-end miss and supersedes in-flight searches.
- **`cmdk-wide` is decided at the TOP of `cmdkRenderInner`, above every early return.**
  Toggling it where the pane renders left the deep/empty/no-results branches at whatever
  width the last selection set. One place decides the pane and sizes the box.
- **THE POP-OUT CONTAINS FOCUS** (`cmdkTrapTab`, `CMDK_FOCUSABLE`, `aria-modal`).
  Without it ONE Shift+Tab reached a "Save note" button inside the booking hub — off
  screen, unreachable, fully activatable — and two put typed text into that booking's
  notes. A keydown trap rather than `inert`, because the workspace must keep rendering
  and `inert` would need unwinding on all four exits. **Result rows carry
  `tabindex="-1"`**: they are `role="option"` buttons, so Tab could ring one row while
  `.is-sel` sat on another, and once focus left the field every arrow key was dead (all
  key handling is bound to the input). Arrows own the list, Tab owns the chrome.
- **An action's failure never prints server internals** (`chbActErrSay`) — apiPost slices
  a failed body to 200 chars, and a 500 rendered a PHP fatal, SQLSTATE and the host path
  into the window. Some throws are deliberate PROSE ("Couldn't send any — Dan Rowe has no
  email address"), so the test is whether it reads as written for a person. Gated
  including the WIRING, because testing the helper alone passed with the call site
  reverted to `e.message`.

**Material and motion.** Glass (`--glass-bg` + blur) is right at 520px — it blurs only
the edge and its max-width IS the measure — but **below 641px the panel is OPAQUE**
(`--cmdk-surface`, blur off), because at 390px the box is 370 of 390 and the whole
workspace smears through it. `--cmdk-surface` is registered in **a11y-test's `SURFACES`**,
break-tested. The box **DROPS** on `visibility` (not `display`, which cannot transition)
and `transform`, with `--spring` — a full-bleed panel could not use the spring (1.56
overshoots to scale 1.06 and crops itself); a card can. In and out are deliberately
different: the container carries `transition: visibility 0s linear 0.22s`, the closed
state is a quick unsprung exit, `.open` the slow spring entry. Reduced motion keeps the
pop-out (it is information) and drops the spring.
- **Name the animation that goes, never the shorthand.** `#cmdk.cmdk-overlay .cmdk-box`
  blanked the whole `animation` shorthand to cancel `cmdkRise` and took the Siri aura
  with it — a documented part of the look rendered on no surface for the pop-out's whole
  life. Restate the reduced-motion off-switch at the OVERLAY's specificity too.
- The aura is a RIM, not a cloud: one hairline ring + a 22px glow, hue cycling.
- §17 samples the exit by STATE, never a clock — `closeCmdK` does ~180ms of synchronous
  teardown before the first paint, so a fixed sample calls a working exit a teleport.

**Row and group anatomy.**
- A group is the dashboard's WELL (`.cmdk-board` takes `.acr-well`'s ground). The earlier
  "a group is a FILL, the border is gone" ruling was about fill + border + FILLED ROWS =
  three edges in ~90px; the rows went flat, so two edges is the same as every other well.
  NB the caption's inline padding must EQUAL the row's (22px) or §18f reads the heading
  as 2px inside its own list.
- **TWO RAILS, NOT FIVE** (§18f–g): panel EDGES on the answer's text rail (21), every
  LABEL on the list's (63). **When measuring a rail, keep `edge` and `text` apart** — a
  box's outer boundary compares against type, its content start against other type;
  conflating them produced two confident false readings.
- `.cmdk-row-label` clamps to TWO lines (one cut "Alexandrina Featherstonehaugh-Smythe"
  by 189px of 306). Label and sub carry the raw text as `title`, because `cmdkHi` returns
  markup that cannot go in an attribute. The sub stays single-line on purpose.
- **`.cmdk-qa-row` is a `<button>` and needs the full `.cmdk-row` reset**, not just
  sizing — its UA chrome had never been removed, so it painted `#efefef` with a 2px black
  border, nearly invisible on cream and obvious only on a phone in dark mode. `border:
  none` is likewise load-bearing on "search everything" (Chromium's UA `2px outset`). The
  second time a button's UA chrome has bitten here.
- **No keyboard cursor on a touch device**: the landing preselects row 0 for arrow keys,
  which painted a row as chosen before the owner chose anything — suppressed under
  `(hover: none) and (pointer: coarse)`. Icon TILES are gone (a filled lozenge under
  every glyph was a second shape per row); keep the 32px BOX, which is what puts labels
  on rail 63. The tile was carrying the icon's contrast, so glyphs take `--accent-text`
  (bare `--accent` is 2.70:1 on the light surface, under the 3:1 non-text bar) — which
  took a11y-test's `accentAsText` ratchet 23 → 19.
- A selected BOARD row keeps its background — the board's `background: none` reset and
  `.cmdk-row.is-sel` are both (0,2,0), so the reset won and selection computed
  transparent; it is `:not(.is-sel):not(:hover)` now. **`.is-kbd` renders a real ring**
  (Left/Right emitted the class with no rule anywhere, so sub-focus was invisible while
  the cursor rested on an action that arms a bulk money send). **Focus is not hover** —
  three hover rules ended with `outline: none` and killed the global ring.
- NB the cmdk `:hover` rules are deliberately NOT behind `@media (hover: hover)`:
  selection is hover PLUS accent PLUS a 3px edge bar, so a lingering tint reads as stale,
  not as a false selection — and Chromium cannot reproduce iOS sticky hover, so the
  change would be unverifiable. Revisit if selection loses the edge bar.
- **A SHORT VIEWPORT SPENDS ITS HEIGHT ON RESULTS**: under `max-height: 600px` the
  keyboard hint yields and the field tightens (at 740×400 chrome took 119 of 296px,
  showing ONE row of seven). Hidden BY CONDITION —
  `:not(:has(.cmdk-sys.is-warn))` — because a stopped automation earns its line at any
  size.

**ONE EMPTY STATE** (`cmdkNoneHtml` + `CMDK_WIDEN` + `CMDK_NONE_IC`) — there were three,
reading like three products, with the same "widen the scope" instruction in two wordings.
Title and sub are **PLAIN TEXT escaped at the boundary** (the chbDuties rule); §18b checks
the query is escaped exactly once. The deep zero drops the TYPE filter (a lone "All 0"
chip offering to narrow nothing) but KEEPS the recency switch. The mark takes
`--accent-text` at 0.8 — at `--accent` 0.6 it measured 1.76:1, i.e. in the DOM and absent
on screen; decorative, so no WCAG rule compels it and §18e measures it by arithmetic.

**"SEARCH EVERYTHING" OWNS THE RESULTS AREA WHILE IT RUNS** (`__cmdkDeepPending`,
`cmdkRenderDeepWait`, `cmdkDeepReset`; §19). The sweep bar answers in chrome a question
asked of the RESULTS, and a FAILED deep search said nothing at all. The pending state
wears the finished view's frame and carries `role="status"` (the bar is `aria-hidden`).
**Clearing the flags is the EXIT's job, not the fetch's** — every exit bumps
`__cmdkDeepStamp`, which makes the fetch's handlers return early, so a flag left to them
strands "Searching everything…" forever; and the bump belongs at the exit SITES, never
inside the helper, which `cmdkDeepFetch` also calls with its own stamp. Fixing this surfaced a latent bug:
`cmdkSearchCore` cleared `__cmdkDeep` without bumping the stamp, so a slow deep response
arriving after the owner moved on REOPENED the deep view over their newer query.

**FOUR LAYOUTS OVER ONE RESULT SET** — boards, answer hero, thread, split. All four are
containers around the SAME rows from `cmdkRowHtml` at their SAME `__cmdkResults` indices.
**That is the invariant**: a layout may never re-order, re-index or swallow a row, or
keyboard nav, `cmdkSyncActive` and `aria-activedescendant` break in silence. Every row
keeps its `cmdk-opt-<i>` id, which is what the gates assert — a container that ate an
index would break arrow-key nav with nothing on screen to show for it. Each layout
break-tested independently in §11.
- **BOARDS** (`cmdkBoardsHtml`, `CMDK_BOARDS`) — the empty landing is a dashboard and
  **the day LEADS it**: Suggested → greeting + boards → Most used → Jump to. **Reorder in
  the ARRAY, never in the renderer alone** — the landing renders SLICES by index, so
  moving HTML blocks leaves arrow-key nav walking the old order (§20 checks heading order
  AND that DOM order and index order rise together; the second catches it).
  **`cmdkBriefBuild` ENDS with a stable sort by board rank**: composition order is
  severity (it decides which rows survive the cap of 7) but boards render
  today→money→waiting→month, so the indices crossed — only in clock windows where both
  rows coexist, which is how it passed CI for months then failed at midnight. §20a-ii
  pins it at ANY hour. A brief row DECLARES its `board` rather than the renderer guessing;
  an unrecognised board still renders as an orphan, because silently dropping one is the
  exact bug the scope filter caused here. The grid is ONE column and says so (two 240px
  tracks need 490 in a 478px box).
- **ANSWER hero** — captioned "Answer", not "Top hit" (which describes ranking). The
  figure is emphasised INSIDE the sentence by one span (`cmdkHeroFigure`), by **WEIGHT at
  the sentence's own size**: at 1.7em it towered and the answer stopped reading as a sentence. NB §11 must
  query `.cmdk-hero .cmdk-hero-fig` — the THREAD renders its own copy above the live
  answer, so a document-wide query measures history.
- **THREAD** (`CMDK_THREAD_MAX` 3) — earlier ANSWERED turns stay above the live answer,
  the only way the conversational frame is visible. Pushed where a query COMMITS, never in
  the renderer (which re-runs per selection). A turn that EXTENDS the previous replaces
  it. **It survives a MISS** — the no-results branch used to return before the thread
  rendered, so a conversation vanished when a query found nothing: finding nothing is not
  the same as never having asked.
- **SPLIT** (`cmdkDetailHtml`, ≥1200px) — renders a SUMMARY and does **NOT** re-parent
  `#booking-hub-content` (that node already moves between Inbox and Today; a third
  claimant empties one). Pure CSS at the existing breakpoint — no matchMedia, nothing to
  leave stale. The pop-out WIDENS 520 → 860px while a pane is up, or the list is narrower
  than its own sidebar (measured 226px against 260px). NB selection therefore changes the
  box width, which silently broke §10's resting-shape measurement.

**A TYPED QUERY SPANS EVERY CATEGORY; the workspace snapshot only shapes the LANDING.**
These were one variable, so opening search from Today pre-scoped to Bookings and a
guest's emails, chats and payments were filtered out **in silence** (no widen note,
because the search had not failed). Two now: **`__cmdkScope`** is the OWNER'S choice
('all' until they tap a chip) and **`__cmdkHomeScope`** is the snapshot, read by the
landing ALONE. `cmdkScopeLabel(k)` is the one place a scope becomes words.
- On the landing the day brief is **NOT** filtered (Jump-to still is), and the scope
  switch is HIDDEN, so nothing claims a filter it is not applying. Filtering the brief
  was the first bug of this shape — 1 row surviving of 4, which is why the landing looked
  empty. Removing the Jump-to filter too was tried and BACKED OUT: it is what keeps that
  list short (124px → 271px capped, 952px uncapped).
- `cmdkHi` needs **3 characters**: a 2-letter token has no word boundary and lit up inside
  unrelated words. Display-only — it never scores.

**Cross-page context memory** (`__cmdkLastEntity`, `chbStampRecent`/`cmdkRecentEntity`,
`CMDK_RECENT_MS` 6min): the record last engaged with is remembered ACROSS navigation, so a
pronoun resolves on the search page and the landing offers "Continue with [name]".
Distinct from `__cmdkEntity` (the open hub, snapshotted by openCmdK) and `__cmdkConvCtx`
(this session). Resolved only while fresh AND the record still exists, and a real pronoun
is required so a generic query is never captured.

**The AI status lives IN THE LOGO** — the knot glyph (`#cmdk-ml`, `data-mstate` via
`chbSetModelStatus`) carries state as COLOUR with a hover title (`CHB_MSTATE_TITLE`);
there is no worded pill (`CHB_MSTATE_LABEL` is REMOVED) and **no download progress ring**.
States: ready / understood / meaning (its own Siri identity, `chb-knot-siri` — the knot
cycling teal→purple, distinct from understood's steady green) / guess / learning. The ring was deleted deliberately
— the cascade is lexical-only until a model lands, so search answers throughout and the
arc reported on something nobody waits for; `chbFetchBuf` is a plain fetch again, and
`ui-test-modelring.js` + search-test §31 went with it. All state animation honours
reduced motion. Leaving on an unanswered query files the miss (`chbMissRecord`) via
`cmdkBack`/`closeCmdK` AND via `nav()`.

**ONE assistant look** (admin.css's "ONE ASSISTANT LOOK" block) — the one place the
assistant's material is stated: panel radius + darkstar hairline, the pill field with its
accent focus ring, the row rhythm (44px touch floor, shared label/sub sizes), the hint
footer. **The field's focus ring HUGS**: it is autofocused for the pop-out's life and a
text input always matches `:focus-visible`, so an offset 2px solid accent ring was
permanent decoration. `.cmdk-foot` is not hidden behind `hover: hover` — a phone got no
hint at all; touch gets a touch-appropriate line instead of ⌘K keycaps.

**THE UI PASS — search wears the dashboard's vocabulary.** Anatomy untouched (same rows,
same indices, same chips); the clothes changed: the greeting is a spoken `.cmdk-pulse`
line, captions take the `.acr-cap` track, boards take the well ground, the HERO is a
verdict card (rail arithmetic 3px margin + 1px border + 8px padding = the old 12px, so
§18f/g pass untouched), the hero's MONEY figure takes the house serif at the sentence's
own size while a leading COUNT keeps sans (`.cmdk-fig-n` — a headcount is not money), and
rows accept an optional **`stcap: {tone, text}`** capsule. Wired additively to the owed
rows (judged by `hasCheckedOut || bookingInBalanceWindow`, the hub's own derivation, so
capsule and payask cannot disagree), ratings and plans. A row without `stcap` renders
byte-identical.

**Unified interface**: RESULTS / JUMP-TO / quick-ACTIONS are rows; refine / related / ask
PIVOTS are pills (`.cmdk-chip`); one hover tint, one pill spec. `.cmdk-box` keeps
max-width 680px and every inner id, so the intelligence stack is unchanged. A guest
**typeahead** in Add Booking (`modalNameSuggest`) fills name+email+phone from a past
guest. Suite: `ui-test-searchpage.js`; the layout gate covers the page at phone width.
NB `getComputedStyle` may return `color(srgb 0.99 …)` in **0–1 floats** where `rgb()` is
0–255, making a near-white surface measure as near-black — the fourth false contrast
failure this codebase has produced.

**Hubs are where you act; index rows are where you find.** The **booking hub**
(`view-booking-hub`) is the ONE home per booking — `showDetails()` (app.js) only
delegates to `openBookingHub()` (admin.js): status pipeline + next action + the
payments block are ONE unified header section (`.bhub-head` → `payBlock` /
`.bhub-headpay` — there is NO separate Payments card and NO second money
mini-pipeline: `hubPayFlowHtml` is REMOVED, guarded by search-test §16 + ui-test-hub
§A. **THE JOURNEY IS A CAPTION, NOT A STRIP (the iOS restyle, owner-approved
demo):** the pill pipelines — the phone's three-pill window AND the desktop
full strip, plus all their `.pipe3-*`/`.pipe-step` CSS in app.css — are GONE;
the stage rides the next-action card as `.bhub-next-cap` ("Next · 2 of 6 ·
Deposit"), derived once in hubPipelineHtml and carried on `__hubNext.cap` so
the payask wears the same words. NB the 'paid' stage renames to **"Balance"**
in the cap — its label "Paid in full" over "£292.50 balance remaining" read as
the booking's state (caught on the build's own screenshot). **A MONEY next-action renders
INSIDE the Payments header** (`.bhub-payask`, deliberately still carrying
`.bhub-next` so the gates that read the banner read the same node) and
`nextHtml()` returns '' for it — the ask is said ONCE, where the money lives;
non-money banners (arrival prep etc.) keep the top slot. **The payask IS the
staged email ask** (`hubAskKind(gt, past, b)` — deposit first, then the
SUBSEQUENT balance once something is in), **and the FIGURE follows the stage**.
This line used to end "the label names the stage, not the figure", which was
true of the code and wrong as a design: the banner and the sticky bar each read
`gt.balance` — the whole outstanding — beside a button sending the DEPOSIT, so a
£440 booking three months out read "Nothing received yet — £440.00 due" over a
plan panel saying £147.50 and a link that would have charged £147.50 (owner's
screenshot). Two fixes, one shape. `hubAskKind` now mirrors
`booking_payment_kind`'s window clause (`bookingInBalanceWindow`, the JS twin of
`booking_within_balance_window` — CUSTOM due date inclusive, standard strict, the
same two comparisons), because the SUM is derived from the stage and getting the
stage wrong over-asks outside the window and under-asks inside it. And
**`hubDepositAsk(b, ps)` is the one definition of what the first payment is
worth** — the plan's deposit plus the refundable deposit pay.php bundles with it
— read by the plan panel that STATES it and by `hubAskAmount` for the payask and
sticky that ASK for it, with the figure carried on `__hubNext.fig` so one tap
cannot carry two numbers. Fixing it surfaced Gap 3 reproduced here:
`depositTakenAmt(p, b)` reads the agreed figure off its FIRST argument and the
hold off its SECOND, and BOTH admin call sites passed it ONE — so `held` was
always 0 and the era-aware half could never fire, quoting the re-snapshotted
agreed deposit after a charge instead of what the card took. `hubDepositTake`
is that call stated once. Gated by ui-test-hub §A2d (the invariant read off the
plan panel's own figure rather than hardcoded pounds, the window case both ways,
and the era case), each break-tested. NB §B had ENCODED the bug — it asserted
the deposit ask quoted the whole stay, calling it "the same figure the Money area
shows as due", which is the conflation itself: the Money area answers "what do
they still owe", the payask answers "what will this button send". The button row's
own staged copy of that button is REMOVED: it was added when the ask lived in a
banner a screen above (the owner had to go back up for it) and became a strict
duplicate the day the banner moved INTO the Payments block — measured at 390px,
the same `requestPayment` three times in one screen-height (payask, row,
sticky). ui-test-hub §A2c now asserts BOTH halves: the stage on the one control,
and the absence of the twin — don't re-add the row button; the history above is
why it looks plausible. **The row that remains is the QUIET tier**
(`.bhub-act-links` / `.bhub-actlink` — linklike text actions at the 44px floor):
Send a reminder / Record payment / Copy pay link / Invoice, because five pills
shouting as loudly as the ask was the jumble the owner reported. Same pass: `.bhub-plan` is a FILL under a
hairline, not a third box treatment between the tinted payask and the dashed
gap chip. **The Edit/Move/Cancel menu is the ⋯ in the header's TOP-RIGHT
corner** (the iOS restyle — it lived at the page FOOT for a while at the
owner's earlier ask, and the approved demo carries the ellipsis in the
nav-bar spot, superseding that). Chrome, not a pill: the button says "⋯" with
the words in aria-label/title. Same node, same data-acts — every gate reading
`.bhub-actions` kept firing — `.bhub-foot` and its upward-opening override are
DELETED, the dropdown opens downward again, and §H pins head placement +
on-screen fit. `.bhub-head-top` is `flex-wrap: nowrap` with a shrinkable
`.bhub-iden` column so the ⋯ pins to the corner under a long guest name.
**AND THE CARD'S BUTTON YIELDS TO THE STICKY ≤900px** (`#booking-hub-content
.bhub-next .bhub-next-btn { display:none }` in that media): the banner button
and the sticky bar were the same tap twice in one screen-height — the card
keeps its cap + sentence, the sticky is the control. Scoped to the BOOKING
hub by id, because the enquiry hub's Approve rides its own `.bhub-next` and
has no sticky to hand over to. §C2 pins it (break-tested).
**THE PAYMENT PLAN IS PER-BOOKING** (migration-103: `deposit_pct_override` /
`deposit_amount_override` / `balance_due_date`, NULL = site standard; gated by
test-payrail's plan section + ui-test-hub §C3). The 25% deposit and the 30-day
balance window stopped being site-wide constants: `booking_deposit_amount($b,
$total)` (pricing.php — fixed £ wins, capped at the total; then pct in (0,100];
then `square_deposit_pct()`) and `booking_balance_due_date($b)` are the ONE
derivation each, read by `booking_amount_due`, pay.php's under-lock recompute
(reading the global pct there would let the charge disagree with the ask), and
`booking_within_balance_window` — where a CUSTOM date is inclusive ("due BY that
day" — the day named is the day the full amount is asked) while the STANDARD
path keeps its original strict boundary, deliberately two comparisons, both
gated. payments-due.php follows the booking's date in SQL —
`COALESCE(balance_due_date, DATE_SUB(check_in, INTERVAL ? DAY))` in the request
pass (`<=`) AND the abandoned-deposit recovery (`>`), byte-identical to the old
interval conditions for a NULL plan and mutually exclusive by construction.
`set_payment_plan` (bookings.php) stores the PLAN, never an amount to charge —
five refusals (both deposit forms at once, pct outside (0,100], deposit over the
stay, a past due date, one after check-in), each in words. The hub's **plan
panel** (`hubPlanHtml`, inside `.bhub-headpay`) states it as sentences — figure,
provenance ("30% — custom" / "site standard"), state (paid/link sent/not asked).
The chaser-narration line was REMOVED at the owner's ask (02 Aug) — don't
reintroduce it; the dialog's hints carry the schedule context now. **The deposit line quotes what the card TAKES, itemised**
("£225.00 deposit (25% — site standard + £50.00 refundable deposit)"): pay.php
bundles the refundable deposit into the first payment while `hold_status` is
none/charged, so the rental-frame £175 sat directly under a header reading
"Received so far £225.00" — the same one-surface-different-story defect
`payment_money_facts` fixed in the emails, reported live within hours of the
panel shipping. `depositTakenAmt` supplies the era-aware figure, Paid ✓ is
judged against the FOLDED sum via `gt.paid` (displayGrand — which credits the
refundable deposit only once genuinely taken, so a £110 rental payment with the
£50 uncharged is a first payment that hasn't fully landed), and the two plan
lines now sum to the header's own total. Legacy hold/returned/kept eras don't
bundle, so no fold there. Gated in §C3 both ways (charged → Paid ✓, uncharged →
not).
booking's own dates. `bookingPlanDeposit` /
`bookingPlanDueDate` (admin.js) are DISPLAY mirrors only — every asked figure is
still server-derived. `editPaymentPlan` is a glassForm whose deposit input is PERCENT ONLY
(owner's ask — a %-or-£ field invited the wrong grammar; a legacy £ override
displays as its effective pct and saving converts it; blank = standard = how
a plan is cleared), and the client adopts the SERVER'S accepted values, not
the typed ones. The server still accepts/stores both forms for existing data. **Send a reminder**
rides `request_payment` with `reminder: true` — the cron's own reminder composer
on demand — refused before anything has been asked for, stamping
`balance_reminded_at` so the cron's reminders space off it; the button waits for
a request stamp rather than offering a refusal. A manual deposit ask now stamps
`deposit_requested_at` (COALESCE — never clobbering the first), arming the
recovery pass the way approval always did.
**The hub fills from ONE round trip**: `bookings.php` `hub_bundle` returns the
payment ledger (`booking_payments_rows()`, the helper the `payments` action shares)
plus the booking's activity-log events together, so a weak signal paints the page
at once instead of card by card. The old Emails card (`#hub-email-log`) and the
separate history/payments/email-log fetches are GONE from the hub — the
**Activity card** (`#hub-history` — id kept so the ledger gates keep firing)
renders `hubActivityHtml`: ledger rows via the shared `hubLedgerRowHtml`
(extracted from `loadBookingPayments`, which still serves the Payments screen)
interleaved with events newest-first; `payment.card` events are FILTERED because
the ledger row is the same fact said better (ui-test-hub §C pins the twin
dropped), and a logged email's subject/body expands in place
(`details.bhub-feed-mail` — e2e clicks it open). **The status CHIPS are GONE
(`hubChipsHtml` REMOVED, iOS restyle)** — terms vN / no-dog / register /
payment rail / texts are label+value rows in the Guest card now, keeping the
dot vocabulary (green recorded, red outstanding; the rail stays dotless — a
category, not a status; Texts only when opted in). The `.bhub-sub` when-line
speaks `fmtStayRange` + nights + party + `in 15:00 / out 10:00` — the enquiry
hub's own form, replacing two fmtDate·time pairs. **Gap chip**: a 2–4-night hole starting at this stay's
checkout rides `chbGapScan`/`chbGapPlan` — the SAME plan the Pricing page and
brief use, one-tap `nyGapOffer` or "offer live" → seasongrid. **Phone sticky
action bar** (`.bhub-sticky`, hidden ≥901px, inset by the `--safe-b` token): the
next action plus tel:/mailto: icon buttons at the 44px floor. **A money label is
FIGURE-FIRST and the figure never clips** (`.bhub-sticky-fig` no-shrink +
`.bhub-sticky-verb` ellipsis, verbs shortened via `btnShort`): verb-first with
the amount trailing measured 104px wider than the button at 390px — the AMOUNT
ran under the call icon, and a clipped verb still reads while a clipped amount
is a different number. Gated in ui-test-hub §C2 with an INJECTED 60-char verb
(the §14 long-chip discipline — the real short labels fit on their own, so
without the injection the check is vacuous; break-tested by deleting the
ellipsis rule). The same hostile-fixture sweep fixed two more: the ledger row's
Refund button SHRANK as a flex child under a long line (flex:none — the text
half wraps, the control never squeezes), and `.bhub-plan-row`'s
baseline-aligned state span rendered INTERLEAVED with a three-line wrapping
sentence (flex-start, and the state stacks under the sentence ≤640px; §C2
asserts the two boxes never intersect). NB this Chromium reports LAYOUT BOXES
for closed-`<details>` content while painting nothing — an overlap scanner must
skip it or it cries wolf on every feed email row.
**The reference cards are GROUPED ROWS** (`.bhub-kvs`/`.bhub-kv` — label column
+ value + one hairline per row, the iOS inset-list shape): the Guest and
register cards' stacked caps-label blocks spent ~55px per fact against a row's
~34 (265px shorter at 390px, measured on the hostile fixture). The Emails and
register actions wear the same quiet `bhub-actlink` vocabulary as the payments
row — a card of sends is a list, not a control panel — and the register's
what-this-is prose renders only while NOT yet submitted (once in, just the
retention line). The Terms/No-dog rows print `fmtDate` DD/MM/YYYY — they were
the last two RAW SQL timestamps on an owner-facing screen, and ui-test-nodogs
now pins the house form (`Confirmed 01/07/2026`), not the raw stamp.
**Share** (`shareStayDetails`, hub ⋯ menu): navigator.share
with clipboard fallback, and NO money in the shared text — it goes to cleaners
and co-hosts, not the guest. **✨ Draft reply** in the booking email composer
(`chbDraftBookingReply` + `draftBookingReply` — deterministic template like the
enquiry drafter; the balance line reads `bookingDue`, the one owner-facing due
figure, so the draft can never quote a different number than the hub above it).
All gated by ui-test-hub §C/§C2 (feed contract incl. order + twin-drop, all five
affordances, sticky shown/hidden by width, share text, draft figure) + e2e (real
hub_bundle shape end to end).
**ONLY WHAT NEEDS TO BE SEEN (the fold build — owner-approved demo, "make it
look exactly like this" + "more continuity").** The hub is DISCLOSURE GROUPS
now: `bhubFoldGrp(key, label, sub, sum, fold)` renders one summary row stating
its CONCLUSION with the detail in a hidden `#bhub-fold-<key>`; `bhubFoldToggle`
+ `__bhubOpenFolds` keep open state across re-renders. **The fold decides
VISIBILITY, never existence** — same composers, same data-acts inside, so
`textContent` reads and evaluate-clicks in gates keep working on folded
content, but anything that MEASURES geometry, waits for `:visible`, real-taps,
or reads `innerText` (which is '' for hidden) must OPEN the fold first — that
re-aimed ui-test-nodogs, layout-test's hub scene and e2e's feed section, each
of which failed honestly on it. The groups: `money` (the payline IS the
disclosure row — bhubMoneyExpand kept its name; breakdown + plan panel + the
quiet money actions all fold under it), `guest` (kvs + register links + other
stays; summary = "All recorded ✓" or "N not recorded", counting EXACTLY what
the rows inside show red), `emails` / `activity` (summaries filled by the
hub_bundle handler — `hubEmailsSum`/`hubActivitySum`), `note` (first line
quoted in the sub), `intel` (when present). **Needs attention** is the one
extra section: the outstanding register as a red-dotted row with its fix
actions folded under, standing down when the to-do card already carries the
register ask (`__hubNext.regAsk`) — one statement of one duty. **The cap names
the ASK's stage, not the flow cursor's** (`capIdx`/`capLbl`): money-first
asking means the cursor can sit on "Guest details" while the sentence asks for
the balance — caught on the build's own screenshot. **Continuity, measured:**
identity sits on the PAGE GROUND (no .bhub-head glass panel — NB the ≤640
media carried the old panel padding and was the phantom 18px in the rhythm),
ONE radius (`--r-lg`) for the to-do card and every group, ONE 12px gap between
blocks (caption 20/8), captions cut to the one that earns it ("Needs
attention" — "Money"/"Everything else" repeated what their rows already say;
the payTitle gate re-aimed to capGone), `#booking-hub-content` is a 760px
column with the back-link on it. The payline's SUB spans full width under the
label/figure line (beside the serif figure it squeezed to a three-line
sliver), the when-line's in/out pair is `.bhub-nowrap`, and the sticky's main
button is a filled accent pill in sentence case (`BHUB_IC_PHONE`/`BHUB_IC_MAIL`
are the dock's bespoke stroke glyphs — the emoji painted in platform colours).
Gated by ui-test-hub §A1b (fold round-trip + persistence, the exception rule
both ways, needs-attention appears/completes/stands-down — all break-tested in
isolation, four fired).
**THE HUB WEARS THE CAPSULES TOO** (owner screenshot: the whole settled payline
painted status green, three green marks on one row). The fold summaries ride
`stCap` — Guest details' count as the amber-triangle/green-✓ capsule (both
hubs), Emails' "Arrival info sent"/"Confirmation sent"/"No email on file"
(`hubEmailsSum` returns MARKUP now, so its slot is set via innerHTML), the
enquiry quote's "Price unavailable" — and the settled payline keeps serif +
house ink with the ✓ (`.bhub-payok`) as the ONE green mark, the
serif-is-money/capsule-is-state rule. **The condensed bar names the RECORD**:
mid-scroll the identity row (cottage tag + name) is under the fixed header and
"Booking" answered the wrong question — `openBookingHub`/`openEnquiryHub`
overwrite `#admin-head-title` with the guest's FIRST name (standalone only —
a docked pane keeps the workspace's title; the slot is ~56px at 390px beside
the crown + five dock icons, so a full name clipped to "Deb…" and the title's
padding is 4px so "Debbie" paints whole). Gated in ui-test-hub (capsules both
ways, figure ink equals label ink, the ✓ mark, the title), each break-tested. Then the guest/intel grid cards; the payments
block folds to ONE `.bhub-payline` in EVERY state (settled "Paid in full £X ✓",
part-paid "Received so far £X of £Y", untouched "Total £Y" — label left with
the deposit state + the plan's one-line brief (`hubPlanBrief` — same
derivations as the panel and the payask, '' once settled/past/due-date-passed)
as a small `.bhub-payline-sub`, the serif figure right and NEVER wrapping).
**The full maths AND the plan panel disclose IN PLACE** behind "Payment plan &
full breakdown ›" (`bhubMoneyExpand` toggles `#bhub-money-more`, hidden by
default, open state surviving re-renders): the old `#breakdown-modal` pop-up
and `__bhubBreakdownHtml` are REMOVED (markup too — it was admin-only weight
in public index.html). NB gates that MEASURE the plan panel (geometry, real
taps) must open the fold first; textContent reads work on the hidden node.
No separate deposit info row remains — even
`holdControls`' fresh-booking note is gone (only real hold states render).
Booking EDIT protection is layered in `openEditBooking` (app.js): a FINISHED stay
(`hasCheckedOut`) is soft-locked — glassConfirm ("it's a record now") before the
form opens (never a hard block: name/email corrections stay possible; the sync
inner opener is `openEditBookingNow`, which `cmdkPrefillEditDates` relies on);
an arrived guest has dates+cottage locked (`lockBookingMove`); a fully-paid
booking hides the payment-entry fields (`trimPaidBookingFields`). Gated by
ui-test-hub §A3.
The **enquiry hub**
(`view-enquiry-hub`, `openEnquiryHub()`) is a DECISION-FIRST page in the same
anatomy (the owner-approved mockup: "an enquiry is one question — can I say
yes?"), and three booking-page rules INVERT here. **The MESSAGE never folds**
(`.bhub-msg` — it is the decision's input, with a one-tap `enqReplyDraft` ✨
row that opens the composer THEN runs the drafter, order load-bearing since
draftEnquiryReply reads `__composeTarget`). **The calendar answer is the
page's STATE**: free → `.bhub-next.is-ready` stating the tap's consequence
WITH its figure ("requests the deposit by card — £147.50", the plan deposit +
the refundable ride, same fold as hubDepositAsk; full amount inside the
window); gone → `.bhub-next.is-gone` naming WHO took the dates + the nearest
free windows either side (`enquiryFreeNearby`, same-length scan ±31 days,
never offering the past), with **Approve WITHDRAWN everywhere** (card + dock —
the dock flips to "Edit the dates") and the blocker as a Needs-attention row
routing to their booking. **Money is a QUOTE, not a ledger**: one fold row
(`equote`) with the schedule in its sub, breakdown + agreed-price/plan
controls inside (setEnquiryPrice/setEnquiryPlan data-acts kept). A returning
guest announces themselves (`eintel`, priorStays); a first-timer says nothing.
Edit/Email/**Decline** live behind the ⋯ (decline is reversible via the
drawer, so the page leads with the yes — last, `bhub-menu-danger` ink).
Approving jumps to the new booking's hub (`enquiries.php` returns
`booking_id`). Gated by ui-test-hub §J (re-aimed to the menu + state card;
clash state break-tested three ways — gone-card, approve-withdrawn,
ask-figure — all fired). At ≥1200px both the Today workspace and the
Inbox dock their hub in a side pane (master–detail; the `#booking-hub-content` /
`#enquiry-hub-content` nodes re-parent between pane and standalone view, incl. live
on crossing 1200px). Index rows
share the `.bk-row` three-line anatomy. The Today calendar is a horizontal
multi-cottage TIMELINE (`renderCalendar()` in admin.js, `.tl-*` CSS): one lane per
cottage, sticky labels; the window ALWAYS starts on the 1st of the current month
(`tlStartOffset()`), opens there, and GROWS endlessly — nearing the right edge
extends it ~3 months in place (`tlMaybeExtend()`, scroll preserved). Its bars
are launchers, not editors —
tapping a booking bar opens `openBookingHub()`, tapping a free future cell calls
`tlAddAt(propKey, iso)` to prefill the Add Booking modal; no other editing lives
on the calendar. External iCal bars (`.tl-ext`) stay display-only (the auto-sync
owns their lifecycle; `#details-modal` is gone and `closeDetailsModal()` survives
as a defensive no-op). New booking/enquiry
actions belong on the hubs, not new surfaces. Dates display DD/MM/YYYY everywhere
(`fmtDate()` JS / `uk_date()` PHP); storage, APIs and ICS stay ISO.

**Backend** — flat PHP in the same folder, each a small JSON endpoint. Helpers in
`db.php`: `db()` (lazy PDO), `body()`, `json_out()`, `clean()`, `require_admin()`,
`require_guest()`, `site_base_url()`, `content_value()`. **Money primitives (db.php,
ONE definition each — never re-inline them):** `booking_ledger_net($id)` = settled
card charges − non-failed refunds (the raw net every paid/refund calc builds on;
callers add their own cap/floor), and `booking_rental_price($b)` = agreed nightly +
txn fee, a price_override REPLACING it (see the Gotchas entry — it was max()'d in as
a floor, which broke every discounted agreed price on the cash rail; JS mirror
`damageHeld`). The FAILED-refund audit fix had to touch four copies
of the first — consolidating removed that whole "half-fixed across copies" class. Key endpoints: `auth.php`
(guest/admin sessions, magic link), `enquiries.php`, `pay.php` (Square),
`pricing.php` (authoritative price model), `reviews.php`/`photos.php`/`experiences.php`
(moderated guest UGC: GET public, `suggest`/`submit` guest, admin list/approve/reject),
`messages.php` (chat), `webpush.php` (`alert_owner`, `notify_guest`), `mailer.php`
(`smtp_send`, `send_*`), `customers.php` (`audit` — the customer-directory lookup
trail; see below). Crons run daily via `cron.php` (pre-arrival, payments-due,
tide-push, push checkin, enquiry-nudge). NEW endpoints route actions via
`route_actions([...])` (db.php — declarative map, guaranteed 400 on unknown;
customers.php is the exemplar; legacy if-chains migrate when touched). A content
key WRITTEN by server code must be classified in db.php (`is_internal_content_key`
/ `is_private_content_key`) or the public content GET serves it to anonymous
visitors — `test-content-keys.php` (CI) scans every literal write and fails on an
unclassified key (it caught `owner-ping` carrying the owner's push text).

**Unified customer directory** (admin.js — owner-side) — `dbBookings` is per-STAY, so
a repeat guest is scattered across booking rows. `chbCustomers()` groups them into ONE
customer by a STRONG identity ONLY — exact email, else exact phone (digits,
country-code tolerant via last-10) — **never by name alone** (`chbCustomerKey`): two
different "John Smith"s, or a name-only booking with no contact, stay SEPARATE
(false-merge protection). Each customer carries stays, lifetime nights + revenue, first/
last stay, cottages. `cmdkSourceCustomers()` (registered search source, weight 8) turns
every REPEAT customer (≥2 stays) into ONE `type:'guest'` row with lifetime stats; a
`_customer` boost in `cmdkScore` floats the person above their own scattered stays, so
searching a name returns the CUSTOMER first, then their bookings (single-stay guests are
unchanged booking rows). `openCustomer(key)` lands on their most recent stay's hub.
Safeguards (all gated by search-test §21c): **false-merge** (strong-key only),
**audit trail** (`openCustomer` → `customers.php` `audit` logs a `customer.lookup` to
`activity_log`, deduped 1h, storing the NAME + a NON-PII ref hash, never raw email/phone;
admin-only), and **no destructive one-tap** (the directory row exposes only Email — a
delete/refund is never one tap from a fuzzy match; those stay on the booking hub).
**Full-history (server) directory**: the in-memory sources only see loaded bookings, so
`customers.php` `directory` groups the WHOLE `bookings` table (bounded LIKE over name/
email/phone/postcode) into unified customers by the SAME strong-identity rule —
`customers-lib.php` `customers_key`/`customers_group` mirror the client `chbCustomerKey`
so both agree by construction (unit-tested by `test-customers.php`, wired into CI, incl.
phone-only unification + both false-merge cases). `cmdkCustomerDirectory(ql)` fires on a
name-ish (non-question) query beside the server search, maps past customers to `_customer`
rows tagged "· from history", deduped against the in-memory customer keys, and
`openCustomerRecord` opens their latest stay (the hub fetches it when not loaded). Same
safeguards (audit + no destructive action). `customers-lib.php` deploys; `test-customers.php`
is deploy-excluded.

**Read-only customer-account preview** (app.js + admin.js) — the owner can see EXACTLY what a
customer sees on their account, system-wide and SAFELY. `openAccountPreview(bookingId, name)`
(admin.js) mounts a dimmed overlay (`.acct-preview-overlay`, `body.acct-preview-open`) holding a
**sandboxed same-origin `<iframe sandbox="allow-scripts allow-same-origin" src="index.html?acctpreview=<bookingId>">`** —
a true container: its own JS/DOM context, can't touch the back office. Reachable from the booking
hub menu ("View their account (read-only)"), the customer-directory rows (`cmdkSourceCustomers`/
`cmdkCustomerDirectory` "View account" action, eye icon), closable via the in-frame banner
(posts `chb-acct-preview-close` to the opener), the overlay Close, or Escape. The frame boots the
normal app but detects `?acctpreview=` (`ACCT_PREVIEW`/`ACCT_PREVIEW_ID`, app.js) which (a) folds
into `PREVIEW_MODE` so owner chrome + the admin bounce are suppressed, (b) BLOCKS every write at
the single `apiPost` choke point (plus the raw `photos.php` upload) → look-but-never-act, and (c)
`maybeAccountPreview()` fetches the target's account (admin-authed) and paints My Stays as them.
Server: `my-bookings.php` refactored into `my_bookings_payload($email, $preview)` (guarded routing
like content.php); `?acctpreview=<bookingId>` runs the ADMIN path (`require_admin`, resolves the
booking's email) and STRIPS the login-free action tokens (`pay_token`/`reg_url` → null) so a
preview is inert. The frame carries the admin cookie (same-origin) for the data fetch but renders
as the customer (`currentGuest` synthesised from the payload, no real guest session). Gated by
`ui-test-acctpreview.js` (frame: lands on My Stays, banner names the customer, no owner chrome,
booking renders, writes blocked, tokens stripped; container: sandboxed iframe mounts at the
preview URL + tears down) + search-test §21c (the directory row exposes only non-destructive
Email + read-only View).
**How it's SHOWN on a phone** (ui-test-acctpreview §C, which sets `--safe-t/--safe-b` to fake a
notch): the overlay pads by `max(24px, var(--safe-*))` and BELOW 640px the shell becomes a
full-screen sheet. Both matter — a flat 24px put the bar (the customer's name + Close) at 34px
against a 59px inset, i.e. UNDER the Dynamic Island, and the decorative phone-shaped frame was
342×776 inside a 390×844 phone, spending 48px of width on chrome so the account got 66% of the
screen. The shell is also explicitly OPAQUE despite carrying `.glass-panel` (the admin dock used
to ghost through behind the customer's name), and `.acct-preview-note` is clamped to one line on
a phone (wrapping doubled the bar to 88px). Inside the frame, `injectPreviewBanner` adds
**`body.acct-preview-embedded`** when embedded, which zeroes the `--safe-*` tokens: the frame's
edges are the overlay's, not the device's, and the overlay already inset itself — iOS hands
`env(safe-area-inset-*)` down into a same-origin iframe, so token-based rules would otherwise
inset twice. **Every inset reads a token now** — all 36 raw `env(safe-area-inset-*)` call sites
were migrated, so the four `:root` declarations are the only `env()` left and zeroing them zeroes
the lot. `header`/`.container` used to call `env()` DIRECTLY and so inset a SECOND time in the
frame; restating them without the inset term was tried and REVERTED, because the override
out-specified the guest shell's own `top` and moved the header 10→20px, making the preview stop
matching what the customer sees — the one thing the feature guarantees. Migrating the
DECLARATIONS adds no specificity, which is exactly why that trap is gone. Gated two ways:
check-css-conventions's **rawEnv** count must stay 0 (a new raw `env()` silently opts its rule
out again), and ui-test-acctpreview asserts each rule **RESPONDS** to the token — measured at
inset 59 vs 0 in the top-level page, because Chromium reports `env()` as 0, so an "is it
doubled?" check would pass just as happily against a rule that ignores the token entirely. NB the
rule that wins for the header is the PHONE one (`calc(10px + var(--safe-t))`), not the desktop
`calc(20px + …)` — break-testing the wrong one looks like a passing gate.

**The day panel's WORDING rules** (all gated — search-test's pulse + brief + duties
blocks, ui-test-searchpage §20b, ui-test-needs-you). A board's caption is context for
everything inside it, so a row must not repeat it: the Today card said "today" three
times (caption + both rows) and now says it once. A row on the MONEY board leads with
its FIGURE — `£520.00 to collect from Sarah Pemberton`, timing in the sub — because
every other money row does and the Today card has already given you the arrival; the
one exception is OVERDUE, which stays in the label because it must never be clippable.
That label keeps the FULL name even though it runs to two lines at 390px: the row
clamps at two by design, and "from Sarah" is not a row you can act on if you have two
Sarahs. The month pulse's zero-last-month branch says `up from none last month`, not
"off the mark" — which meant off the STARTING line and read as wide of it, a complaint
about the number beside it, while its three siblings are all plain comparisons. And a
brief sub uses `fmtStayRange`, never two `fmtDate`s pasted together: that is not an
exception to the DD/MM/YYYY rule, it is the house's own compact form, which the gap row
was the last row not to use.
**WHAT A BOOKING OWES YOU IS `bookingDue()`, NOT `paymentSummary().balance`** (app.js;
gated by search-test §40 + ui-test-needs-you). Reported live: one screen showed two
numbers for one guest — the booking's own row said "£340.00 due" while Today's header
brief AND the bookings summary both said "£290 to collect". **The row was right.**
`paymentSummary().balance` is the RENTAL balance; the refundable damages deposit is
CHARGED with the guest's first payment (`pay.php` charges `amountDue + damagesDue`, so
the card really does take the larger figure), which makes an untaken deposit money still
to collect. `displayGrand` already folded it in — counting it paid only once
`hold_status` says it was actually taken, dropping it once refunded — but only the
Payments screen and the booking rows used it, and Payments' own comment already
promised "the two screens always quote identical numbers". `bookingDue(propKey, b)` is
that one definition, and every OWNER-FACING "still to collect" now goes through it: the
**day line under the header** (`todayOpsLine` — the exact "£290 to collect" reported, and
the last one found: its string is BUILT BY CONCATENATION, so a grep for the phrase in a
template literal missed it — check the rendered words, not the source shape), the
`needspay` FILTER that line's button links to (or the owner taps a total and lands on a
list missing the booking it counted), the bookings-list summary, `chbDuties` (so Today's
strip and the brief both move), the greeting line, the balances-to-chase answer, the
money overview, `chbOwedLater`, the owed family and the bulk chase it feeds, the per-row
inline chase + its balance watcher, and the per-booking money lines in the search
dossier/detail pill/record sub. **Deliberately
NOT changed**: the questions that are genuinely about the rental — "who's put a deposit
down" (`ps.deposit`) and "who's paid in full" (`ps.total`). The guest CHASE emails and
the pay screen were originally left on the rental frame under the same reasoning, and
that half was REVISED at the owner's ask (screenshot): once the damages deposit had been
CHARGED, the balance chase read "£175.00 already paid" of a "£700.00 total" at a guest
whose card took £225 and whose confirmation, receipt, invoice and My Stays all said £225
of £750 — the one document telling a different story. `payment_money_facts` now folds
`deposit_charged` (carried by `request_booking_payment`, mirroring the confirmation's
`$chargedDep`) into BOTH the stay total and the paid figure — the balance is unmoved,
because the deposit adds equally to both sides — and says "(including your £X refundable
deposit)"; the pay screen's summary carries `depositCharged` and the client folds it the
same way. `paidRental` stays available raw for any caller that means the rental rail.
The RECEIPT keeps its frame on purpose: it says "RENTAL paid so far" and lists the
deposit on its own labelled line — coherent because labelled. Gated by test-payrail
(the real composers driven with a charged-deposit payload, plus the WIRING — the first
break-test round proved the payload line could be deleted with every check green, the
helper-tested-alone trap yet again) + ui-test-pay (the £525-of-£750 balance view).
NB the two shapes are NOT interchangeable — `paymentSummary`
returns `{total, deposit, balance}` and `displayGrand` returns `{dep, total, paid,
balance}`, so a blanket swap silently makes `ps.deposit` undefined; the `withPs` block
keeps the rental summary and the owed branch maps in the due figure under the same name.

**chbDuties — ONE decision about what needs the owner** (admin.js). There used to be
two: `needsYouItems()` built the Today strip and `cmdkBriefBuild()` built the search
pop-out's landing, from the same bookings and enquiries but with DIFFERENT rules. Today
aged enquiries and escalated them to red at two days; the brief showed a plain count.
Today chased balances only within 21 days of arrival (or already overdue); the brief
totalled EVERYONE who owed, whenever they arrived — measured on one fixture as **£440 on
Today against £955 in the pop-out**, both correct under their own rule and neither
explaining itself. Every new signal also had to be taught to both. Today's rules win
(they are the considered ones); `chbDuties()` owns them and the two surfaces are now
FORMATTERS. It returns **PLAIN TEXT**, and that is the contract that made reuse possible
at all: `needsYouItems` renders through innerHTML and used to escape as it composed
(`${escapeHtml(q.name)}&rsquo;s enquiry`), so a guest called O'Brien would have reached
the brief pre-escaped and been escaped again — break-tested, it prints
`O&amp;#39;Brien`. Escaping now happens at each render boundary, once. Each duty
DECLARES its `board` and `scope` (same principle as the brief rows), so the boards
machinery is untouched — which means the two surfaces order differently BY DESIGN: which
duties surface is severity-driven (the brief takes the first 4 of the severity-ordered
list), where they sit is subject-driven (the boards group by Today/Money/Waiting).
Money outside the 21-day window is `chbOwedLater()` — a quiet "£515 more owed, none due
yet" line rather than being folded into a headline figure that then disagreed with Today.
Gated by search-test §40.

**ROUND 3 OF THE AUDIT (the search stack), for the record.** The undo's
whole-list season restore silently deleted every season/override added SINCE
— it is SURGICAL now (`chbSeasonUndoStale`/`chbSeasonUndoList`: remove
exactly the rows the apply added, restore the rows its splice removed. Round 4
went further: an entry that ADDED nothing — the old whole-list shape included —
is refused outright, and `search-undo` is written only with `co.prices`, because
replaying a stored undo posts a price change as whoever taps Undo, so a planted
entry could otherwise put rows of someone else's choosing into the prices).
The pin-memo "fix" was tried and REVERTED — ui-test-searchpage §21's
liveness gate refused it, and the gate is right: "never a stale figure" is
the pin feature's founding rule; the recompute cost is bounded and stays.
Owner maintenance blocks are out of the arriving/leaving/upcoming/today
intent branches (the isOtaBlock gate branch 5 always had). An explicit bare
year is a PERIOD ("how much did i earn in 2024" answered this-month before;
"how many bookings in 2024" counted the current year and labelled it 2024).
chbBulkConfirm prints money lines only when the rows CARRY money (the
arrival bulk listed every guest as £0.00). A passed DD/MM with no year rolls
to next year like the worded dates (an explicit year never rolls).
cmdkActIcon gained the 'alert' glyph the watchers asked for by name
(`p[name] || p.hub` hid the miss). chbCustomers' memo now rides
__chbDataGen in front of the row counts (the chbRankStamp lesson — a
recorded payment changed no count and served stale lifetime revenue).
search.php refuses a pure-punctuation query's booking-ref probe (stripped
to '', '%%' LIKE-matched every ref). And a blank cottage display name
matches nothing in chbEntities (''.includes is true for every query).
Gated: search-test §44 + the §40 surgical-undo block + §39's no-£ check +
integration §28.

**Durable undo** (admin.js `CHB_UNDO_KEY` `search-undo`, `CHB_UNDO_REPLAY`,
`chbUndoStored`/`chbUndoRehydrate`/`chbUndoForget`) — the stack was session-only, so
closing the pop-out forgot everything and Tuesday's price override could only be undone
by remembering it and going to Rates by hand. The constraint that shapes it: an entry
holds a **CLOSURE**, and a closure cannot be serialised — so a durable entry stores a
DESCRIPTOR (`{ kind, payload }`) and the reversal is rebuilt from `CHB_UNDO_REPLAY` at
read time. **OPT-IN**, the same discipline as the inline actions: `chbUndoPush(label,
run, spec)` without a spec behaves exactly as before. Stored under the INTERNAL content
key `search-undo` (classified in db.php, so test-content-keys enforces it) via
`saveContent` + `siteContent` — the admin content GET already serves internal keys, so
this needed NO new endpoint. Two rules carried over from watchers: a stored undo
**RE-CHECKS** before reversing (`CHB_UNDO_REPLAY[kind].stale` — the seasons replay asks
"is my override still in the list?" and refuses with "that has changed since" rather than
clobbering a later edit), and anything older than `CHB_UNDO_DAYS` (30) or of an
unrecognised `kind` is silently ignored rather than thrown on. NB the in-memory entry
carries the STORED id: without that link the same change appeared twice, and reversing
the session copy left the stored twin on offer — safe, because the staleness check
refuses it, but it reads as "not undone yet". Gated by search-test §40; the `undo`
command reads `chbUndoList()` (session first, then stored), never `__chbUndo` directly.

**THE LANDING IS A CONTROL CENTRE** (admin.js — pins + the "Running for you" board; gated
by search-test §41 + ui-test-searchpage §21). Two additions to the boards landing, both
riding the existing machinery rather than adding surfaces.
**Pinned live answers**: `#cmdk-pin` (admin-views.html, in the field row after the ✕
clear) arms when a COMMITTED query's lead row is a pinnable hero (`cmdkPinOffer`, called
at the one commit site + disarmed by every non-query render path — deep fetch, help open,
the empty branch); `chbPinToggle` (data-act) stores `{q}` under the INTERNAL content key
**`search-pins`** (cap 6, newest kept). A pin stores the QUESTION, never the answer: the
landing RECOMPUTES each one live via `chbPinAnswer(q)` — a side-effect-free rerun of the
answer tiers (chbCompute/chbAlmanac → cmdkIntent → NLU canonical → cmdkIntent) — so
"who owes me money" pinned on Tuesday shows Thursday's figure on Thursday. One that no
longer answers renders an honest "Couldn't answer this just now" tile rather than
vanishing. Four refusals, each break-tested: COMMANDS (every `cmdkCommand` row is tagged
`cmd: true` at the single tier -1 call site — the guards filter on the TAG, because an
id-literal filter missed the branches that never set `id:'cmdk-command'`); PRONOUN
questions (`CHB_ANAPHOR_Q` — "their balance" recomputed next session answers about
whatever record that session holds); ENTITY-CONTEXT answers (`chbPinAnswer` STRIPS
`__cmdkEntity`/`__cmdkConvCtx` for the recompute and restores in `finally`, and
`cmdkPinOffer` refuses while a hub entity + task words are live — cmdkIntent 0a fires on
task words alone when an entity is loaded, so a pinned generic "outstanding balance"
would silently become an answer about that booking); conversational-frame refinements
(`chbConvResolve`). The 0a boundary regexes are now shared consts (`CHB_ANAPHOR_Q`,
`CHB_ENTITY_TASK_Q`) — one definition for the branch that answers and the guard that
refuses, the CHB_STAYLEN_Q discipline. NB `chbPinStore` is **MIRROR-FIRST** — the
INVERSE of chbUndoStored's save-then-mirror, deliberately: the landing re-reads
`siteContent[CHB_PIN_KEY]` synchronously on the very next render after a toggle, so the
mirror must be true immediately; the network half rides a serialised promise chain
(`__chbPinSaveQ`) that always saves the CURRENT mirror, so two quick toggles can't land
out of order. (Undo's order is the durability-honesty rule — don't "fix" either into
the other.)
**"Running for you"** (`CMDK_BOARDS` key `control`): live watchers (from fetched
`__chbWatchers`, else the `search-watchers` mirror read into a LOCAL — never write the
cache from the landing, the fetched copy outranks it) and the undo count surface as
rows that ROUTE to the `watching`/`undo` commands — surfacing is one tap, stopping a
watcher stays a second deliberate tap.
Two engine fixes it forced, both measured: **`cmdkBrief()` is memoised and returns the
CACHED ARRAY BY REFERENCE**, so the landing takes `.slice()` before appending — without
it the first render polluted the cache and every empty re-render inside the 8s TTL
stacked duplicate control rows; and **the empty branch now kills the OLD query's
machinery** (`clearTimeout(__cmdkServerT)` + stamp/queryGen bumps + loading off) —
clearing the field inside the 180ms debounce left the old query's federated fetch armed,
stamp still current, and its results merged INTO THE LANDING. The §19 gate for that one
was vacuous TWICE before it fired: an empty stub payload (the merger returns before
touching `__cmdkResults`) and then an out-of-scope row (`type:'message'` merges but is
scoped away inside `cmdkArrangeWide` — the suite opens search from view-backoffice, so
the snapshot scope is 'bookings'); the fixture is an in-scope booking row.
Related hardening from the same pass: **test-content-keys.php scans CLIENT writes too**
(`saveContent('literal'|CONST,` — every key must be classified in db.php or listed in
`$JS_PUBLIC_OK` with a reason), which found `square-deposit-pct` served publicly — and
the fix is the ALLOWLIST, not classification, because **`siteContent` boots from the
PUBLIC content GET before auth**: a key the admin client reads at boot cannot be made
internal without breaking that read (measured — Settings rendered blank). And
ui-test-searchpage §17b samples the exit fade with transition EVENTS as fallback
evidence: any forced style flush inside closeCmdK's teardown starts the 0.22s
transition's wall-clock while the thread is blocked, so on a slow run no mid-flight
frame ever paints and the rAF poll alone called a working exit a teleport (~1-in-4
flake, measured); a real exit dispatches transitionrun/transitionend for the box's
opacity even then, while a genuinely deleted transition dispatches neither.
**§17a's sibling flake, and the better answer: SEEK the animation, don't race it.**
The Siri-aura check read `box-shadow` twice 1.5s apart and asserted it had moved —
which flaked green-then-red on CI, because `cmdkSiriAura`'s `0%, 100%` is a PLATEAU
and `ease-in-out` is slow at both ends, so two samples can land in the same slow
zone and round to the same string (and any re-render that restarts the animation
between them makes that likely rather than unlucky). It now sets an INLINE negative
`animation-delay` — `0s` for the 0% keyframe, `-3s` for the 50% one at the halfway
point of the 6s cycle — and reads both a millisecond apart: no clock, no frames.
Inline wins over the stylesheet's `animation` shorthand, which is what makes the
seek stick. Still fails for the reason it was written (break-tested both ways): a
blanked animation seeks nowhere, and keyframes that never move the shadow leave the
NAME check passing while the PAINT check fails, which is exactly the bug it guards.
General rule for a keyframe assertion: sample by PHASE, never by wall clock.

**Owner's picks** — the habit/trust/revenue layer. (1) **Teach-loop nudges**: the synced
dead-end searches (`search-misses` in the content table) surface BOTH in the weekly digest
email (owner-digest.php "Teach your assistant" section, last-7-days, top 5 by count) and as
a morning-brief row (`brief-teach`, ≥2 fresh misses → one tap opens the dead-ends review).
(2) **Richer morning brief** (`cmdkBrief`): today's arrivals are NAMED with context (check-in
time, repeat ordinal from the customer directory, balance to take), the soonest gap rides as
a ready-made 15%-off offer row, pulse unchanged; cap 7 rows. (3) **UNDO** (`chbUndoRecord`/
`__cmdkUndo`, one level, session-only): every change search itself saves (dated price
override, weekend-uplift apply) records its exact restore; the `undo` command in cmdkCommand
reverses it through the same validated endpoints, with an honest "Nothing to undo" otherwise.
(The cottage page's "Ask us anything" box — `#ask-box`, `askBoxSubmit`/`askBoxToChat`,
the `.ask-*` CSS and ui-test-askbox.js — is fully REMOVED; do not resurrect it. Guests
ask in the chat instead. `guestFaqAnswer` and `__faqBypass` STAY: the chat still answers
a typed question on-device before it reaches a person, and admin.js reuses the matcher to
draft enquiry replies.) Gated by search-test §36 (brief composition, stale-miss silence,
undo round-trip incl. prior-state payload).

**The guest DATE PICKER crosses a night out for TWO different reasons, and they are not
interchangeable** (app.js `renderDatePicker`; gated by `ui-test-datepicker.js`, whose
fixture is the August the owner reported). A night is either **BOOKED** (`isBookedNight`)
or **`tooShort`** — free, but the run to the next booking is shorter than the cottage's
`minNights`, so no stay can START there (`dpCheckinFits`). Three bugs came from treating
them as one thing, all reproduced in a browser before being fixed:
`tooShort` used to be computed `guestPick && **!pickingEnd** && …`, i.e. it was a fact
about the QUESTION rather than about the night — so choosing a check-in silently
un-crossed every too-short night in the month and choosing a checkout crossed them again;
the same night changed availability three times in one selection. It is computed once now,
and each branch decides whether the question applies. That exposed the second: the
**"restart selection" branch (`ds <= dpState.start`) asked only `!booked`** — but
restarting IS picking a check-in, so a night the minimum forbids could be tapped to begin
a stay `enquiries.php`'s min-nights guard then rejects, after the guest had filled in the
form. It asks `!booked && !tooShort`, the same as the check-in branch. Third, **a cross
means "cannot be used", so it is wrong on a cell that IS being used**: the exception
covered a turnover day offered as a checkout but NOT the nights of a stay already chosen,
so picking checkout 28 (the next guest's arrival — nights 24–27 free, a legitimate
turnover) crossed out both the 27 underneath it and the 28 itself while both stayed
selected — the picker contradicting its own answer. `inChosenStay` is guarded on
`chosenClear`, because the hero search (`dpMode 'search'`) lets ANY date through and seeds
these inputs: a seeded stay that really does cross a booking keeps its marks, since this
is the only screen that can show the guest which nights are the problem. The `aria-label`
follows the PAINTED state rather than `booked` alone (a turnover day on offer was read out
as "booked"), and the legend no longer says "already booked" — that was false of every
too-short night in the grid; the per-cell `title` still names the reason. NB admin mode is
deliberately outside all of this: everything stays pickable and everything stays shaded,
because a deliberate overlap is the owner's call.
**A REFUSAL THE GUEST CANNOT SEE IS THE CALENDAR NOT WORKING.** The fixes above were
right and the picker still felt broken, because refusing a date and SHOWING that it is
refused were never the same code. A checkout past a booked night was correctly rejected
and rendered as a plain cell — full opacity, pointer cursor, no mark — so measured, after
picking a check-in and turning the page, **the whole of the next month came back 30 dead
cells** indistinguishable from bookable ones: tap anything, nothing happens, nothing says
why. Worse, the shared hover treatment later in app.css lifts and shadows EVERY `.dp-day`,
so those cells rose to meet the pointer like live controls first. Three parts now:
`dp-out` (dimmed, `not-allowed`, and deliberately **NOT** struck through — the line is the
"booked" mark and these nights are for sale, just not on this stay), a hover-suppression
rule keyed on `:not([data-act])` — the click hook itself, so it needs no list of dead
states and admin, where every cell IS pickable, is exempt by construction — and the hint
naming the limit up front (`dpNextBookedStart`: "Now select your check-out date — up to 28
Aug 2026"). The general rule: **wherever this picker declines a tap, the cell must say so
in the same render.** §6's `unmarked` sweep asserts that as a property over the whole grid
rather than listing days, so a new refusal branch cannot ship invisible.
**NB a night that cannot START a stay is NOT unsellable**, and it is easy to conclude
otherwise: 6 Aug with 7 Aug booked and a 2-night minimum can't be an arrival day, but
**5 → 7 sells it fine**. So the cottage page's read-only calendar is RIGHT to show it free
with a price, and the two calendars are answering different questions rather than
disagreeing — do not "fix" that one to match the picker.
**The chat's live-calendar check now applies the booking RULES too** (`chatAvailRun`). It
tested for an overlap and nothing else, so a stay under the minimum got "Good news —
looks free" plus an Enquire button, and the enquiry was then refused by the rule it never
consulted. `checkBookingRules` is the same helper the enquiry form and hero search already
call — it was the one availability answer not using it. Gated by ui-test-datepicker §9.
**EVERY GUEST DATE FIELD IS THE BUILT-IN CALENDAR** (`openFieldDatePicker`, `dpMode
'fields'`, `dpProp`/`dpPropKey`; gated by ui-test-datepicker §14, 30 checks). Reported
from a phone: the waitlist "Notify me" modal showed iOS's own date control. Two guest
surfaces were still on a native `<input type="date">` — the waitlist join and the chat
availability check — and the native control cannot do the one thing those screens exist
for: **it offers every date as equally free**, so the guest picks blind and is told
afterwards that the nights are taken. `openDatePicker`/`openBookingDatePicker`/
`openHeroDatePicker` each hardcode the ids they read and write, which is why a new
surface meant a fourth branch and got a native field instead; `openFieldDatePicker({ci,
co, display, trigger, prop, empty, onDone})` takes its targets as DATA, so the ids stay
exactly the ones `chatAvailRun` and waitlist.php already read — they are simply
`type="hidden"` behind a `.date-range-trigger` now. Four things it had to get right, each
break-tested:
- **WHICH COTTAGE.** The picker read `activeFrontProperty` everywhere — right for the
  enquiry form and the hero search, which are already about the cottage you are looking
  at, and wrong for both of these, which carry their OWN cottage select. `dpProp` (null =
  the page's cottage, so every existing caller is unchanged) is read through
  `dpPropKey()` by `isBookedNight`, `dpNextBookedStart` and the rate lookup.
  **`closeDatePicker` resets it**, or a CANCELLED waitlist pick leaves the enquiry form
  shading someone else's bookings while looking perfectly normal.
- **A WAITLIST IS FOR THE TAKEN NIGHTS.** `'fields'` joins `'search'` in the
  any-future-date branch — refusing booked nights would refuse the feature — while
  `isPast || tooSoon` is still tested FIRST, so the night-before floor holds. And
  `tooShort` does NOT cross in this mode: it is a CONSEQUENCE of a booking (the 6th
  starts no 2-night stay only because the 7th is taken), i.e. the very thing the guest is
  asking us to watch for, so marking it unavailable on a waitlist is marking a free night
  unavailable. Booked nights still cross — that is the fact they are waiting on.
- **THE LEGEND FOLLOWS THE PICKABILITY RULE.** "Crossed-out dates aren't available" was
  static, and false on three of the four modes: only the enquiry form REFUSES a crossed
  night. It now says "already booked — you can still pick them" on the hero search, the
  waitlist, the chat check and admin. Same defect class as the legend that used to call
  every too-short night "already booked"; the hint's `— up to <date>` ceiling is likewise
  now stated only in the mode that enforces it.
- **ESCAPE ANSWERS THE THING ON TOP.** `topOpenDialog` took the last `.modal-overlay`
  before it ever looked at the picker — which is z **2100** against the overlay's **2000**
  and is RAISED from one — so Escape closed the modal UNDERNEATH while the calendar stayed
  on screen, and Tab trapped focus in a form the guest could no longer see. Ordered by
  what is actually on top now (lightbox 5000 → `.reviews-modal` 6000 → picker → overlay).
NB `#modal-payment-date`/`#modal-plan-due` stay native by design — owner fields in the
Add/Edit Booking form, not a guest surface — and §14's native-field ratchet excludes
`#edit-modal` for exactly that reason. The eight `.value` reads this added went through
two typed helpers (`dpVal`/`dpSetVal`), because the typecheck ratchet counts every
`HTMLElement.value` in the long tail and the budget only falls.
**AND THE LEGEND WAS ONLY THE VISIBLE LAYER — four things below it said otherwise**
(gated by ui-test-datepicker §15, 20 checks, each break-tested; the waitlist half-range
also by test-integration §12).
- **THE ANNOUNCED STATE MUST MATCH THE PICKABILITY.** A crossed cell is REFUSED on the
  enquiry form and SELECTABLE on the other three modes, and it was announced `role=
  "button"` `aria-label="07/08/2026 — booked"` in both cases, with **no `title` at all**
  (that branch was gated `crossed && !clickable`). So a screen-reader user was told the
  button was unavailable while it was the one thing a waitlist exists to select.
  `crossedPickable` now carries "already booked, you can still pick it" into the label
  AND the hover title. a11y-test cannot see this class of defect — it checks that a name
  exists, not that it is true.
- **HALF A RANGE IS NOT A RANGE, and it does not mean what it looks like.** Done with one
  date wrote `wl-checkin` alone and the trigger read "4 Aug 2026 — pick check-out" — but
  `waitlist_notify_freed` matches `check_in IS NULL OR check_out IS NULL OR (overlap)`,
  so ONE date stored alone is an **OPEN-DATED** wait, emailed about every future
  cancellation, and the email's date clause is gated on both being set so it names no
  dates at all. Three layers now: a `fields` target may declare **`both: true`** (the
  waitlist adds `emptyOk` so the refusal can offer "or Clear dates", which is a real
  answer there) and `dpDone` refuses via the hint rather than closing; `submitWaitlist`
  refuses too, because a PREFILL arrives half-filled from the hero search and never
  touches the picker; and **`waitlist.php` is the authority**, for the stale tab.
- **THE PAST IS NOT ON OFFER.** `dpChangeMonth` was unbounded and ‹ was never disabled —
  measured, 14 taps reached June 2025 with **0 of 36 cells pickable**, a screenful of
  dead calendar. `dpMonthFloor()` stops at the current month and returns null in ADMIN,
  because the owner back-dates. NB §6's past-month check now sets `dpState.view`
  DIRECTLY: what it tests is how a past CELL renders, not how it was reached.
- **THE HINT IS ANNOUNCED** (`role="status" aria-live="polite"`). It is the only progress
  report — "select a check-in" → "now a check-out — up to 28 Aug" → "4 Aug → 7 Aug · 3
  nights" — and it changed silently, so a screen-reader user picked a date and heard
  nothing about what was left. It also carries the both-or-neither refusal, so that is
  announced for free.
**ONE TAB STOP, THEN ARROWS.** Every clickable day carried `tabindex="0"` — measured 35
stops inside the picker, up to 31 of them to cross a month — while the search window and
the coach overlay both give arrows to their lists. Roving tabindex now (`dpSeatFocus`,
`__dpFocusDay`, `data-day` on every cell), arrows via `dpGridKeys` hung off the SAME
global handler that owns Escape and Tab, so an arrow works wherever focus sits in the
dialog and the first one from the card enters the grid. Two things it must keep right:
`dpMoveFocus` lands on the nearest **pickable** day in the direction of travel (focusing
a refused cell is a dead end to arrow out of again), and **`renderDatePicker` reads
whether the grid had focus BEFORE `innerHTML` destroys the node holding it** — after the
swap `document.activeElement` is `<body>` and the answer is always no, which is how the
first draft silently dropped focus on every pick.
**A NIGHT THAT IS FOR SALE SAYS WHAT IT COSTS** (`dpNightPrice`, `.dp-price`; gated by
ui-test-datepicker §16, 17 checks). The cottage page's read-only calendar had shown
per-night prices for ages (`.ac-price`) and the picker had not, so a guest choosing dates
could not see that a Tuesday is £130 and the Saturday £150 without leaving the modal.
`dpNightPrice` goes through the SAME `nightlyRateFor` the read-only calendar uses, read
off the SAME cottage `dpPropKey()` shades, so the two calendars cannot quote different
money for one night — season rate and weekend uplift compose exactly as `priceBreakdown`
composes them (£130 base → £150 Sat → £175 peak → £201 peak Sat, all four gated).
Where a price must NOT appear, and why each one would be a lie:
- a night the picker REFUSES (booked, out of reach, past, too soon) — pricing something
  the guest cannot have;
- the chosen CHECKOUT (`ds !== dpState.end`) — not a night they pay for. Note it IS
  priced while merely being *offered* as a checkout, which is the marginal cost of one
  more night and the most useful moment for the figure to exist;
- a night the WAITLIST offers (crossed but pickable there) — it is sold;
- ADMIN, all of it — the owner is moving a booking, not shopping, and every cell there is
  pickable, so a price would land on nights already sold.
**A SELECTED cell prices in its OWN ink.** Its ground flips dark and `--text-muted`
measured **2.39:1** on it in light mode; the fix is `color: inherit`, not an opacity —
hierarchy comes from the 0.7rem size, and dimming text that is already muted is the trap
container opacity sets. The gate asserts the price's colour EQUALS the day number's
beside it, which needs no colour model to stay honest.
**NB the cell's TEXT is no longer just its number** — it reads "26£175" — so a locator
anchored on `/^26$/` matches nothing. §6's hover helper was exactly that and broke;
`[data-day]` is the stable hook. And the overflow/clip check does NOT gate the stacked
layout (break-tested: without `flex-direction: column` the flex row simply squeezes both
and nothing clips), so §16 asserts the price's box sits BELOW the number's.
**AND THE WHOLE STAY, ON THE ONE SCREEN THAT CAN KNOW IT** (`dpStayTotal`, `.dp-fig`;
gated by ui-test-datepicker §17, 12 checks). This was recorded here as not-done on the
grounds that a total means deriving the figure a second way — which is true of the SUM OF
THE NIGHTS and false of the real one. `dpStayTotal` calls **`priceBreakdown`**, the same
function `updateEnquiryPrice`'s box and `updateBookBar` already quote from, with the party
read off the same `#enq-adults`/`#enq-children` those two read. Measured after: £401.70 in
the picker, the price box AND the book bar for one stay, with the £75 deposit still on its
own row. (`total` and `rentalTotal` are the same field — `const total = rentalTotal` — so
those two were never in disagreement.)
- **ENQUIRY MODE ONLY, and that is the constraint, not a nicety.** The hero search has no
  party fields, the waitlist is about dates that are gone and the chat check answers
  availability — so on those three the only computable total is the sum of the nights,
  which omits extra adults, children and the card fee. Measured on a Jollyboat-shaped
  fixture it runs **22–86% under** the real ask (£390 against £723.90 for four adults and
  two children over three midweek nights). A figure that light is worse than no figure.
- **It is `total`, not the deposit-inclusive ask.** A first draft used £476.70 on the
  reasoning that the card takes the deposit with the first payment — true of the ASK, and
  it would have put a THIRD framing of one stay on a screen whose other two agree.
- **The money goes IN THE HINT**, which is already the one `role="status"` region, so it
  is announced for free and the stay is not said twice; emphasis is WEIGHT at the
  sentence's own size (`.dp-fig`), the lesson the search hero learned from a 1.7em figure
  towering over its own words. The party is NAMED, because it stays editable after the
  picker closes — the figure is a snapshot of a field, not a standalone promise.
- **A stay the form will REFUSE is not priced** (`checkBookingRules` first): the hero
  search seeds any dates, so a seeded range can break the cottage's minimum.
NB §4's plural check was anchored on `$` and the hint no longer ENDS with the night count,
so it asserts the phrase now; the singular case is what proves the "s" is conditional.
**"DIFFICULT TO SEE WHAT DATES YOU'VE COLLECTED" — TWO CAUSES, BOTH MEASURED ON PIXELS**
(gated by ui-test-datepicker §18, 12 checks across both themes, each declaration
break-tested). Reported from a phone with a September screenshot.
- **The MIDDLE of the range was invisible.** `.dp-in-range` painted
  `rgba(255,255,255,0.07)` — a raw white whatever the theme, while the two ENDS correctly
  take `var(--text-light)` — so an in-range night measured **1.18:1 in dark and 1.03:1 in
  light** against the unselected cells beside it. Two solid pills with three
  perfectly-ordinary days between them. Selection is a UI STATE, so 1.4.11 asks 3:1 of the
  band, and it must not cost the day number its AA — which is a real tension here, because
  the light card grounds at 206 and a band strong enough to hit 3:1 by fill alone leaves NO
  ink that reaches 4.5 (pure black tops out at 4.43). The answer is the ends' OWN pair at
  **65%** (fill `--text-light`, ink `--dark-grey`) — one definition of the selection's
  colour at three strengths — measuring band **7.66 / 4.01** and ink **7.47 / 5.61**
  dark/light. The percentage is arithmetic: 60% clears both too but leaves light's ink 0.26
  clear, and the house rule is a shade past the mark. The 4px grid gap is deliberately left
  open — bridging it with a `box-shadow` from each neighbour paints every gap TWICE, and at
  any alpha under 1 that makes the joins DARKER than the cells they join.
- **The chosen CHECK-OUT was dimmed off the calendar.** `crossed` learned not to mark a
  night inside the chosen stay and **`outOfReach` never did**, so the two marks disagreed
  about one cell. A complete range makes every tap a RESTART, so the far end is judged as a
  would-be check-in — and one with a booking two days later under a 2-night minimum starts
  no stay. True, and nothing to do with the date just picked: `dp-out`'s `opacity: 0.3` took
  it from the check-in's **17.59:1 to 2.61** (dark) and **9.35 to 1.78** (light), under a
  hover title reading "There's a booking before this date" about the guest's own check-out.
- **And the selection was carried in COLOUR ALONE.** Nothing in the DOM said which dates
  were chosen, so a screen-reader user picked a range and heard the bare numbers back.
  `selStage` names it ("your check-in" / "inside your stay" / "your check-out") in both the
  label and the title. It is the PAINTED state, the rule these labels already follow, so it
  outranks `offeredCheckout` (which exists only while no check-out is chosen, so no cell is
  both) and the unavailable notes — "minimum stay 2 nights, unavailable" is true of STARTING
  a stay there and a lie about the cell in front of them. `crossed` still wins: an admin
  overlap is chosen AND booked, and booked is the operative fact there.
- **The gate reads PIXELS, not `getComputedStyle`** — it screenshots the grid and samples it
  back through a canvas. This surface is the worst case for a colour model: the card is
  translucent glass over a scrim over the page, so `backgroundColor` reports only the top
  layer and the card measures **pure white in BOTH themes**, which is how a 1.03:1 band
  survived being looked at (twice, in this session, before the screenshot settled it). The
  fifth false contrast reading this codebase has produced. Sample the paint.
- **AND THE FIX ABOVE STILL LOOKED BROKEN, BECAUSE `:hover` OUT-SPECIFIED THE SELECTION**
  (reported on a second look at the same screen — *"is it because it's a touch element that
  still thinks it's being pressed?"*, which is exactly the mechanism). Two rules older than
  the band, both beating `.dp-day.dp-start`/`-end`/`-in-range` at (0,2,0), so a POINTED-AT
  chosen night was repainted: `.dp-day:hover:not(.dp-disabled):not(.dp-empty)` at (0,4,0)
  turned the pill `rgba(255,255,255,0.92)` — near-white ink on near-white — and
  `#date-picker .dp-day:not([data-act]):hover` at (1,3,0) set `background: transparent`, so
  the chosen CHECK-OUT **vanished entirely**. That second one lands almost every time,
  because a check-out is so often not clickable (it starts no stay of its own), and it is
  the September screenshot. **Measured on a plain desktop pointer, so this was never
  iOS-specific — iOS only makes it STICK**, since a tap leaves `:hover` applied with no
  pointer to move away. Three changes: both rules now exclude the three selected states
  (hovering your own dates must not repaint them on any device); the dead-cell rule keeps
  `transform/box-shadow: none` for everything but only blanks the FILL where there is no
  selection to erase; and the tint moved inside `@media (hover: hover)`, the call the shared
  lift lower in app.css already makes. Gated in §18 by hovering each chosen cell and
  asserting the fill is unchanged — plus that an unselected bookable night STILL answers the
  pointer, or it is a fix by deletion — and the media wrapper is asserted through the CSSOM,
  because Chromium will not reproduce sticky hover for us to observe. **NB that CSSOM walk
  has a trap: modern Chromium gives every `CSSStyleRule` a (usually empty) `cssRules` list
  for CSS nesting, so an `if (r.cssRules) { …; continue; }` branch skips every style rule in
  the document** — the first version reported ZERO day-cell hover rules, including ones that
  had been there for months. Read `selectorText` first; recurse only on a non-empty list.
- **AND A NIGHT INSIDE THE STAY WAS UNPRICED, because `clickable` is the wrong question**
  (asked directly — "is it showing the pricing correctly?" — and no). Reported on a cottage
  with a **3-NIGHT MINIMUM**: 24→27 chosen, and the cells read **£175 · £175 · blank** under
  a hint saying £540.75. The 26th carried no figure because `dpCheckinFits(26, 3)` fails —
  the 28th is booked, so no three-night stay can BEGIN on the 26th — which is true, and
  nothing to do with a night the guest is already paying for. `clickable` answers "can a stay
  START here", a question about SELECTION; what a night costs is a question about the STAY.
  So the price gate is `(clickable || inChosenStay)`, and the four deliberate silences are
  untouched (a refused cell, the chosen CHECKOUT, a waitlist night, all of admin) because
  `inChosenStay` is guarded on `chosenClear` and the checkout is excluded by name.
  **THE FIXTURE WAS DERIVED BACKWARDS FROM THE SCREENSHOT, AND THAT IS THE INTERESTING
  PART**: a minNights sweep showed that only **3** leaves the 26th bare, and at 3 the days
  11/12 and 20/21 are struck for being TOO SHORT rather than booked — so the real bookings
  are just 9, 13–15, 22 and 28–31. That set reproduces every cell state in the report
  exactly, which is how the mechanism was confirmed rather than guessed (a first fixture
  built from "everything struck is booked" priced the 26th fine and proved nothing).
  §19 gates it on the **coherence property**, which no arithmetic can dodge: the visible
  per-night figures must SUM to `priceBreakdown`'s `nightly`. It read £260 of £390 before the
  fix (break-tested). NB compare against `nightly`, not `total` — reverse-engineering the
  card fee out of the total would hardcode the percentage in the gate, the second derivation
  this suite exists to prevent — and `priceBreakdown`'s argument order is
  `(propKey, adults, children, checkIn, checkOut)`.
- **PAID FOR WITHOUT RAISING app.css's BUDGET**, which is what the previous entry's raise
  should have done. The comments went in, went over by 402 bytes gzipped, and were then paid
  for by trimming prose that restated CLAUDE.md at length: the `.glass-panel`-is-a-material
  note, the `env()` migration note, the Square-card framing note, and two comments about the
  status-text retune where the second superseded the first (collapsed into one). Net 183
  bytes of headroom under the existing budget. This is the order the rule intends — trim
  first, raise only if the trade is still worth it.

**THE TERMS QUOTE THE SERVER, NEVER PROSE** (app.js `definitionParagraphs` /
`paymentClauseParagraphs` / `termsSecurityDeposit`; the `payment` block in
`rates_public_payload()`; gated by **`ui-test-terms.js`** + test-integration §4).
Clause 1's *Deposit* / *Balance due date* / *Security deposit* and the whole of clause 5
were written out as "25%", "4 weeks" and "typically £75" — numbers the app does not
derive from, on the one document the guest agrees to. **Two were already wrong**: the
window is `PAYMENT_BALANCE_DAYS` (30 days, not 28), so a booking made 29 days out was
promised a deposit by clause 5 while `booking_payment_kind()` forced `'balance'`, and
payments-due.php chases the balance at 30 days rather than the 28 the contract named.
The percentage is owner-editable and the refundable deposit is per cottage. The schedule
now rides the rates payload the client already fetches at boot (published payment terms,
not secrets — the `feeds` precedent), and the clauses are generated per cottage exactly
as clause 7 already was. Three refusals, each break-tested: an OLDER server (no `payment`
block) keeps pricing.php's own defaults rather than telling the guest their deposit is
**0%**; a cottage with no deposit gets the sentence WITHOUT a figure, never "a refundable
£0.00" (which reads as a term of the contract rather than the absence of one); and the
literals left in `termsSections` are **labels only** — the text after the colon is
discarded, so dead copy cannot drift back in. `TERMS_VERSION` bumped with the wording.
The gate serves a deliberately NON-default 30% / 45-day / £60 fixture, so the old prose
cannot pass any of its checks.
**And the LIMITED cancellation policy publishes the window it enforces.**
`rentalRefundBlocked()` (and its mirror `rental_refund_blocked()`) refuse a rental refund
inside 7 days under Limited, and the published points stopped at "partial refund 7–14
days" — so a guest cancelling 3 days out got nothing back from a policy that never said
so. The third point is stated in app.js's `CANCELLATION_POLICIES` **and** mailer.php's
`cancellation_policy_line()` together: the cottage page, the terms and the confirmation
email are one promise, and the two definitions must be kept in step by hand.

**A CHILD IS UNDER 16** (`CHILD_UNDER_AGE`, app.js; gated by smoke-test §5). Two things
already depended on that boundary: `childRate` prices the children count, and
guest-details.php takes `$expected = $b['adults']` and registers those as "everyone
staying who is 16 or over" while never counting children — so it decides who lands on the
register the Immigration (Hotel Records) Order 1972 requires. NB the register PAGE always
stated the rule ("Children under 16 don't need to be listed"); what was missing is the
band at the two PICKERS — the hero search and the enquiry form — where the guest actually
chooses, and where a wrong choice either misprices the stay or leaves a 16- or
17-year-old off a legal record. The gate does NOT assert three files each say 16: it
EXTRACTS the number from index.html, app.js and guest-details.php and requires them
equal, so moving one without the others fails. `occupancyHint` pluralises now too — it
read "max 2 adults, 2 child".

**A REVIEW SAYS WHAT HAPPENS TO IT** (`guestReviewForm`, app.js; gated by smoke-test §5).
The form promised "Your review will appear on our site shortly" while reviews.php writes
`status='pending'` and `set_status` can DECLINE one — and the toast on the very next tap
already said "submitted for approval", so one screen made two claims and the one read
first was the one the site cannot keep. The PENDING note likewise read "Thank you for
staying with us!", an answer to a question nobody asked at the one moment the guest is
wondering what became of what they wrote; it names the cottage now, as its approved
sibling always did. NB the explanation lives in a JS comment, NOT an HTML one: a comment
inside that template SHIPS, and the first draft quoted the old sentence back at the guest
until smoke-test caught it. A DECLINED review still falls through both branches (the form
returns with the old text and no note, which reads as "never submitted") — deliberately
left, being a decision about tone rather than about facts.

**TWO DECLARATIONS ON THE ENQUIRY FORM, not one** (`#enq-nodogs` beside `#enq-terms`;
gated by **`ui-test-nodogs.js`** + test-integration §16). The guest must confirm they are
not bringing a dog before the enquiry can be sent, alongside accepting the terms. Built
the same way the terms are, because the same things can go wrong: the client refuses to
submit, **and `enquiries.php` refuses a direct public POST** (`no_dogs`), so a stale tab
or a crafted request cannot create an enquiry that never made the declaration — admin
edits are exempt for the same reason terms are, there being no guest at the keyboard.
**It is RECORDED, not just checked** (`enquiries.no_dogs_at`, migration-101, and in
schema.sql because that file is kept current): a declaration nobody keeps is theatre —
if a dog turns up the owner has to be able to point at what was agreed and when. That
forced the same passthrough the terms have (`no_dogs_at_passthrough`), because an admin
Edit/Move is a decline + resubmit and would otherwise silently erase what the guest
confirmed; the enquiry hub shows it as a "No dog" row so the stored value is not
write-only. The dog box is deliberately FIRST and validated first — pointing at the
second unticked box while the first is also unticked sends the guest back twice.
**AND IT SURVIVES APPROVAL** (`bookings.no_dogs_at`, migration-102, copied in
`enquiry-actions.php` beside `terms_accepted_at`). Approving DELETES the enquiry, so
without this the declaration existed only while the owner was reviewing and vanished
exactly when it starts to matter — at arrival, by which point it is a booking. The
booking hub carries the same "No dog" row, with the guest's ORIGINAL timestamp rather
than the approval's. A booking the OWNER adds by hand stays NULL and reads "Not
recorded": there was no guest at the keyboard, and an invented timestamp is worse than
an honest blank. NB there is exactly ONE guest route into `enquiries.php` `submit` —
`#enq-submit-btn` → `submitEnquiry` — with no `<form>` around those fields (the page's
only form is the newsletter), so there is no native-submit bypass of either box; the
second `submit` caller is the admin edit, exempt by design. NB
adding the server requirement broke three existing enquiry fixtures in test-integration
that predate it (13 checks, all downstream of §5's submit); they now send the field,
which is the correct fix and not a workaround — every real client does.

**Welcome back** (app.js — guest-side): a RETURNING signed-in guest gets a personal homepage
rebook nudge (`#welcome-back`, `renderWelcomeBack` — "Fancy Jollyboat again?" with their
favourite cottage = mode of COMPLETED stays, live cottages only; an upcoming-only first
booking is NOT "back") plus a quiet `#stayed-before` note on any cottage page they've
actually stayed in (`renderStayedBefore`, hooked into `openProperty`). Their stays come from
their own `my-bookings.php` session (nothing new exposed), fetched once per session by
`loadWelcomeBack()` (kicked from `setGuestUI`, cache dropped on logout/role change).
Logged-out, owner, first-time and upcoming-only guests see nothing. Gated by
ui-test-welcomeback.js (nudge + favourite, CTA → cottage page + note, upcoming-only and
logged-out stay empty).

**Your stay hub** (app.js — guest-side, `renderGuestBookings` under the "Your stay" header):
there are TWO hub cards, both `.my-stay-hub`. The in-residence one (unchanged) shows for a stay
including today. The **pre-arrival** one (`guestPreArrivalHubHtml`, `.my-stay-hub-soon`) shows
ONCE for the SOONEST strictly-future booking (`mine` is sorted soonest-first): a sea-blue
countdown badge (`.hub-count`, "N days to go" / "Tomorrow"), the one outstanding thing before
arrival (balance due → a Pay-balance CTA via `openPayView`; else missing guest details → an
Add-details link to `b.regUrl`; else "you're all set"), and planning tiles reusing existing fns
(Directions `openCottageDirections`, Good to know `openFaqModal`, Welcome book `openWelcomeBook`
[locked until balance paid, unchanged], Things to do → `view-experiences`, Contact host). No new
endpoints. Gated by ui-test-yourstay.js (countdown wording, balance/all-set states, Tomorrow at
+1 day, only-soonest, past-only + logged-out show nothing).

**The My Stays companion** (app.js — the approved demo's PR-1; gated by
ui-test-yourstay §21–25 + test-integration §19). The pre-arrival hub carries a
STAY TIMELINE ("Your road to Blakeney", `guestStayTimelineHtml`) — booking
confirmed / paid-so-far / the NOW money row / your stay / deposit back — the
ARRIVAL-DETAILS and DOOR-CODE rows were removed at the owner's ask (see
below) — where EVERY figure comes from the derivations the
card already trusts (`displayGrand` + `guestPayCta`; §21 asserts the now-row's
figure EQUALS the Pay button's), and the money row follows the same
armed/trouble/owner-arranged judgements as the hub line via
`guestAutopayTroubleOf` (ONE definition, both readers).
- **THE DOOR CODE IS SECURITY-GATED BY THE KEEPER'S OWN RULE, in three layers**,
  and the SERVER half is untouched by any of the removals: digits only when the
  server released them (`door_code`), a DATE only from `door_code_from` (minted
  by a real confirm), and `door_code_pending` only while the keeper is ON for
  the cottage with no code confirmed for THIS stay — a keeper-off cottage may
  have NO SAFE and a held-back promise would assert one. Gated in
  test-integration §18.
  **The guest now meets it in ONE place, not two.** The timeline's door-code
  row (and the "Arrival details" row beside it) were removed at the owner's
  ask, so the surviving surface is the arrival-day HERO
  (`guestDoorCodeHeroHtml`, in-residence hub): released → big figure + Copy;
  pending on arrival day → masked `····` naming the honest way in (call us);
  anything else → no card. **The consequence, stated because it is a real
  narrowing**: the reveal window opens `KEYSAFE_REVEAL_DAYS` (2) before
  check-in, and the hero renders only from check-in day — so a code released on
  the travel day is visible from arrival rather than two days early. Putting the
  hero on the pre-arrival card would close that gap and was deliberately NOT
  done unasked. ui-test-yourstay §20 drives all three server states and asserts
  the pre-arrival card says nothing in ANY of them; §25 owns the hero.
- **The weather strip rides weather.php** (public, no key): fetched once per
  session, the stay's own days only, absent beyond the ~2-week horizon or on
  failure — a blank strip claims nothing. Caption states forecast confidence.
- **TWO ASKS WERE REMOVED FROM THIS CARD, and my-bookings.php is READ-ONLY
  again because of it.** "When will you arrive?" (the window chips) and
  "Anything you'll need?" (the extras chips) are gone at the owner's ask —
  composers, handlers, CSS and the `set_arrival_window` route with them, plus
  both places the owner read the answer back (the hub when-line's "arriving
  4-6pm" and the arrival-day card's "you said"). `bookings.arrival_window`
  (migration-110) is RETIRED, not dropped: nothing reads or writes it, and
  deleting a column destroys what guests already told us for no gain.
  **The removal exposed a real defect the gate caught**: with the route gone a
  POST FELL THROUGH to the read and answered **200 with the whole payload**, so
  a stale tab's write looked to it exactly like one that had worked. A POST is
  refused **405** now. That in turn re-aimed an older §19 check which POSTed
  `{action:'list'}` to prove a half-verified account "can read nothing" — it
  was riding the write route's `require_guest()`, so it met the 405 first and
  proved nothing; it GETs now, the way a real client reads.
  ui-test-yourstay §22 asserts the ABSENCE (no markup, none of their words, and
  the composers undefined — a stray call site would throw), break-tested by
  putting the slots back.
- **PR-2: THE STAY CARD REBUILT + AFTER THE STAY** (ui-test-yourstay §26–27).
  Booking cards are `.gb2` now: accent band (`--prop-<k>` inline var), serif
  name (h3 + `.guest-status-badge` KEPT — §8–10 read them), spoken when-line,
  and ONE payline ("Paid in full ✓" / "Paid £X — £Y to pay" / "Still to pay" —
  the figure on the right is said once) whose fold holds the SAME
  `guestPriceBoxHtml` rows, priceIsCustom branch and all — **§11/§12 open the
  fold before their innerText reads** (the fold rule; hidden innerText loses
  layout spacing, which is how the re-aim announced itself). Secondary actions
  are one quiet row (`.gb2-links` flattens `btn-sm` by CSS — classes and
  data-acts untouched, uppercase/tracking stripped, icons hidden). The PENDING
  enquiry cards deliberately keep the old anatomy. After the stay: the
  just-finished card leads with Book-again + the returning-guest ordinal
  (`completed_stays`, the server's own count — no count sent, no claim), the
  review ask is a star-tap card ONLY while no review exists (`gb2Star` opens
  the real moderated form with the rating prefilled — one path), and older
  past stays sit behind ONE disclosure holding FULL cards, not one-liners, so
  a cottage whose only stay is old keeps its review form.
  **THE AIR PASS (approved before/after demo) — and the padding that was never
  there.** `.guest-booking { padding: 0 }` (the OLD photo-flush anatomy the
  pending cards keep) sits LATER in app.css than the gb2 block, so the shipped
  card's `padding: 20px 22px` computed to **0px** — the "everything kisses the
  edge" scruffiness the owner reported was a specificity casualty, not a
  design. The rule is `.guest-booking.gb2` now (0,2,0 wins whatever the
  order). The pass itself: one 24px rail, the payline + fold composed into ONE
  WELL (the `.bkflow` panel's own ground; the open payline squares its bottom
  corners, the fold carries the well's lower half, and `.gb2-fold
  .guest-price-box` loses its own panel — no box in a box), a 16px beat
  between blocks, and the quiet links behind their own hairline with
  `flex: 0 0 auto` — `.card-actions .btn-sm` stretches its buttons ≤640px,
  which made the links read as space-between and centred their wrap row.

**Guest FAQ assistant** (app.js — guest-side, so admin.js's NLU never loads for visitors):
a TYPED question in the guest chat is answered instantly ON-DEVICE from the cottage's own FAQ
content before it ever pings the owner — `guestFaqAnswer(text)` runs a small precision-biased
lexical matcher (whole-word token overlap + `GUEST_FAQ_SYN` synonyms, Q&A-weighted, threshold
≥3 with a question hit) over `CHAT_FAQ` + the active cottage's `siteContent['faqs-<prop>']`;
`sendChat()` intercepts a confident match (`chatFaqReply` shows the answer + a "Message a
person instead" fallback that re-sends bypassing the matcher via `__faqBypass`), and anything
unmatched reaches a human as before. Deflects the repetitive parking/wifi/dogs enquiries 24/7,
no server. Gated by smoke-test (matches from content + synonyms; nulls on unrelated/greeting).
**Guest-side learning loop**: a QUESTION-shaped guest message the on-device FAQ couldn't answer
(`guestQuestionShaped` gate: ≥6 chars + trailing `?` or a leading question word) is ALSO recorded
— fire-and-forget from `sendChat`'s fall-through (never owner-mode) via `guestFaqMissRecord` →
**`guest-faq.php`** `record` (public, rate-limited; pure `guest_faq_merge` dedupes by lowered
question, bumps count + recency, tags the cottage, caps 40) into the internal content key
**`guest-faq-misses`** (admin-only in the content GET — added to `is_internal_content_key`). The
owner sees the recurring ones on the Search learning page's **"Guests asked these"** panel
(`slGuestQuestions`, most-asked first) and turns one into an instant answer in one tap
(`slAddFaq` → `glassPrompt` the answer → append `{icon,q,a}` to `faqs-<prop>` via `saveContent` →
clears the question) or dismisses it (`slDismissGuestQ`). So a repeated unanswered question
becomes a permanent on-device answer. Gated by `test-guestfaq.php` (merge/dedupe/cap, CI-wired),
smoke-test (`guestQuestionShaped`), and ui-test-search-learning.js (panel renders, dismiss,
add-answer appends to the FAQ + clears). `guest-faq.php` deploys; `test-guestfaq.php` is
deploy-excluded.

**AI-drafted enquiry replies — REMOVED** with Saved replies (see "Saved replies and ✨ Draft reply were
REMOVED"); what follows is history. The enquiry email composer (`openEnquiryEmail`) had a
"✨ Draft reply" button (`draftEnquiryReply` fills `#enq-email-body`). `chbDraftEnquiryReply(enq)`
is deterministic template NLG (no model call → instant, on-brand; the owner edits then sends):
greeting by first name, availability (`enquiryAvailability` — free vs "just taken"), the live quote
(`priceBreakdown` + refundable deposit), the answer to whatever they asked (reuses the guest-side
`guestFaqAnswer` scoped to the cottage), a CTA, and the host sign-off (`siteContent['host-name']`,
falling back to the business name). Turns the assistant from "find the enquiry" into "write the
reply". Gated by search-test §26.

**Proactive business pulse** (admin.js) — `chbBusinessPulse()` compares THIS month to last in plain
English (nights + revenue, unioning paying bookings with OTA guest stays, owner blocks excluded —
same rule as the insights composer), names the leading cottage and flags a real dip ("worth a
nudge — maybe a last-minute offer"). Surfaced two ways: proactively as a row on the palette's empty
landing (`cmdkBrief`, unasked), and as the LEADING narrative answer to a bare "how's business / how
am I doing / performance" (the numbers still follow; an explicit-period query like "how's business
this month" keeps its nights-led figure). NB `monthName`/`propName` are locals elsewhere — inlined
here. Gated by search-test §27.

**Natural-language history recall** (admin.js) — the federated `search.php` deep search already
covers ALL history (messages, emails, reviews, the activity log) and fires on every palette query,
but a natural QUESTION buries the key terms in question-words, so keyword recall suffers.
`chbHistoryClean(q)` detects a history-SHAPED query (`CHB_HISTORY_Q`: said/wrote/emailed/mention/
history/"when did"/"find the email…") and strips the framing to content terms (`CHB_HISTORY_STOP`)
before sending — "what did Sarah say about the boiler" → "sarah boiler", "when did I change the
Jollyboat price" → "jollyboat price". A plain keyword query is sent untouched; an over-stripped one
falls back to the raw text. Wired into both the auto server search (`cmdkServerSearch`) and the
"search everything" deep fetch. Gated by search-test §28.

**TRUE semantic history recall** (admin.js + search.php) — meaning-based, not keyword. `search.php`
gains a **`?corpus`** mode: a bounded dump (`$cap` 300/source) of the text-bearing history —
messages, sent emails, reviews, activity log, enquiries — as `{type,id,text,date,…}`. The client
embeds every row ONCE with the on-device model (`chbEmbedText` = `darkstarVec` over CONTENT words
only — stopwords diluted the signal, measured) into an in-memory index (`CHB_HIST`, lazy build on
the first history-shaped query, ~10-min freshness). `chbHistorySemantic(q)` cosine-searches it
(`darkstarCos`, threshold ≥0.35 — genuine matches score ~0.4–0.65, unrelated ~0), maps hits via
`chbHistoryRow`→`cmdkServerItem` (per-type open handlers reused), tags them `_sem` ("By meaning"),
and `cmdkSemanticHistory` merges them into the live palette (stamp-guarded like the server search).
So "did any guests complain about noise" finds a review that says "the neighbours were rather loud"
— **zero shared words**. Owner-only (Darkstar never loads for guests). Gated by search-test §20
(seeds embedded docs, asserts pet→dog / noise recall by meaning + unrelated rejected).

**Darkstar-C** (admin.js) — the CONTEXTUAL sentence encoder that upgrades the history
meaning-index. Where the static Darkstar table is an order-blind mean of word vectors,
this is a full transformer: **bge-small-en-v1.5** (MIT), quantised int8 ONNX —
committed + deployed as **`encoder.onnx`** (~34MB, versioned by `?v=` in `CHB_ENC.url`)
with its BERT WordPiece vocab in **`encoder-vocab.json`** (ids differ from Darkstar's
trimmed table — the tokenizers can't be shared; `chbEncTokens`). It replaced
all-MiniLM-L6-v2 on a 22-query history bench through the REAL chbEncLoad pipeline:
**22/22 top-1 / MRR 1.000 vs 21/22 / .977**, perfect on the zero-lexical-overlap hard
set, ~30ms/embed. Three facts a future swap must keep: **the QUERY side carries bge's
instruction prefix** (`CHB_ENC.qPrefix`, applied at the ONE query-embed site in
cmdkSemanticHistory — passages embed bare; skipping it cost a measured recall point);
**the threshold is 0.50, not MiniLM's 0.30** (bge cosines run hot and tight — swept:
0.50 keeps the borderline genuine matches, pet→labrador measured 0.501, at the cost
of ONE synthetic unrelated top at 0.51; 0.52 rejected 8/8 unrelated but dropped the
pet-class recalls, and truly unrelated queries rarely reach this ranking because
cmdkSemanticHistory only fires for history-SHAPED queries. MiniLM's 0.30 would admit
most unrelated outright); and the vocab is byte-identical bert-base-uncased, so
encoder-vocab.json did not change. `CHB_ENC.ver` 2 rebuilds MiniLM-built indexes.
**The STATIC table was benched for the same upgrade and REFUSED** — darkstar.bin is
potion-base-8M (Model2Vec, see darkstar-build.js); potion-base-32M (63k×512, 31.6MB)
was built and run through search-test §20: it produced a WRONG INTENT ("expected
guests for tonight"→upcoming bookings) that NO margin setting fixes (min/noneMargin/
veto swept — a proximity inversion, not a threshold miss) and its best recall (110)
trails the 8M's 111. The corpus is precision-tuned to the 8M geometry; don't retry a
bigger table without planning a corpus retune. Runtime is
**onnxruntime-web** (MIT) SRI-pinned from jsdelivr — the CSP already allows it
(script/connect: jsdelivr; WASM under 'unsafe-eval'; `ort.env.wasm.proxy=true` runs
inference in a blob worker so index builds never jank the UI; numThreads=1 — no
COOP/COEP on the host). Measured (multi-label history bench): right record first
**9/14 vs 6/14**, MRR .760 vs .584; browser-verified ~40ms/embed, ~1-2s session load.
LAZY + owner-only: `chbEncLoad()` kicks on the first history-shaped query
(`cmdkSemanticHistory`); until it lands (old device, blocked CDN, CI) the static path
serves as before; an index built pre-encoder REBUILDS once it arrives (`CHB_HIST.enc`
stamp; embeddings reused across ~10-min refreshes by `type:id:len` key); any load
failure stands down for the session. Floors differ per space: static 0.35, encoder
`CHB_ENC.thresh` 0.30. **The NLU cascade + precision veto stay on the static table**
(measured ceiling, zero-wrong gate — do NOT wire the encoder into them without
re-running §20). `chbHistorySemantic` stays the SYNC static path (returns [] on an
encoder index — different space/dims); the encoder query path goes through
`chbHistoryRank` inside `cmdkSemanticHistory`. Model files are long-cached immutable
via htaccess (versioned by ?v=). Gated by search-test §30 (tokenizer, encoder-built
index + threshold, static-path decline, rebuild-on-upgrade, no-model fallback).

**Ambient intelligence** (admin.js) — the search indexes VOLUNTEER what they know instead of
waiting to be asked. (1) **"Knows your guest"** card leads the booking-hub grid
(`chbGuestIntel` → `hubIntelCardHtml`): visit ordinal + lifetime nights/revenue + favourite
cottage + last-stay from the unified customer directory (STRONG identity only — a name-only
booking gets NO card, so two John Smiths never cross-pollinate), plus up to 2 history
**mentions** from the in-memory corpus index (`chbGuestMentions` — email rows by address,
enquiries by recorded name, free text only by 2+-word full name; activity log excluded as
log-spam; strong key required; rows open their source via `chbHistoryRow`). Renders NOTHING
for a first-timer with no history; if `CHB_HIST` isn't built, `openBookingHub` builds it in
the background and slots mentions in when it lands. (2) **`chbAnomalies()`** builds
OPPORTUNITY rows (sev `ok`, `spark` icon, `opp: true`) — these now live on their OWN
**Manage → Pricing** page (`renderPricing` into `#sec-pricing`/`#pricing-body`, section id
`pricing` in `SETTINGS_TITLES`/`settingsRenderSection`/`cmdkRegistry`; opened from the Manage
index row under "Bookings & payments", or `settingsOpen('pricing')`), NOT the Today Needs-you
strip — the strip stays about things that genuinely NEED the owner (duties). `needsYouItems()`
no longer pushes `chbAnomalies()`; the adaptive "Worth a look"/`is-opp` heading in
`renderNeedsYou` is retained as harmless defensive code (nothing carries `opp` there now).
The Pricing page also links out to the full pricing coach (`openPricingCoach`). Rows: bounded
2–4-night gaps between guest stays starting ≤45 days out (owner-blocked holes = deliberately
held, skipped; 1-night = changeover slack; unbounded space ≠ gap; cap 2) and a next-month
shortfall vs the same month last year (fires only under 50% of last year with last year
≥8 nights → `nyPacingReview` opens the pricing coach). **Gap rows carry a DECISION, not a
generic action**: `chbGapPlan(g)` picks the best commercial outcome — a hole between stays is
PRICED to sell, never hand-booked. No offer yet → a one-tap dated offer off the season-aware
current rate (`chbCoupleRateOn`), 20% when the gap is imminent (≤7 days — last-minute price is
the only lever left) else 15%, floor £20; act **Offer** → `nyGapOffer` saves the 'Gap offer'
override via `cmdkApplyPriceOverride` (undo-able) and re-renders the Pricing page so the row
flips. A 'Gap offer' season already covering the hole → the row reports it LIVE (act **Rates** →
`nyOfferRates` = Manage → seasongrid) instead of re-suggesting. The SAME plan drives the Pricing
page, the brief's gap row, and the CHB_PRICE_Q suggestion rows, so every surface agrees.
Gated by search-test §32 (18 checks: gap bounds/blocks/window, offer/imminent/live decisions,
pacing thresholds, intel composition, false-merge + no-card guards, mention matching) +
ui-test-intel.js (real browser: card renders/withholds, Offer tap on Manage → Pricing →
seasons_save payload + row flips to live).

**Booking logic in search** (admin.js) — search REASONS about the calendar, not just finds
it. (1) **QUOTES**: "how much for 15–18 aug at jollyboat (2 adults 1 child)" prices the asked
stay with the LIVE model (`priceBreakdown`), checks the calendar (`cmdkBookClash` — bookings
+ blocks, end-exclusive), and one-tap-prefills Add Booking; taken dates name WHO has them and
price the free alternatives beneath; no cottage named → "From £X" across the fleet with
per-cottage rows. A nights-count ("3 nights from 20 december") makes the day-level
`cmdkParseDates` parse beat a whole-month entity range (golden-caught bug), and
`cmdkParseDates` now also handles "15 aug to 18 aug" (month named both sides, cross-month
safe). Guards: `safe` (INSIGHTS/OPS), named-guest, future-start, no-dates → falls through.
(2) **Clash-aware commands**: "add booking …" / "block …" check the range FIRST — the sub
says "⚠ taken then (Bob Carter) — 21A or Pimpernel is free" / "⚠ Bob is booked — check
before you block" (labels unchanged, golden-pinned). (3) **MOVE/EXTEND/SHORTEN proposals**:
"move bob back a week" (back/later = LATER, forward/earlier = earlier), "move bob to 4 aug"
(keeps length), "extend/shorten cara by N nights" — resolve the guest (upcoming preferred),
compute + VERIFY the new dates (clash names the blocker), and open the EDIT modal prefilled
via `cmdkPrefillEditDates` — **never saves**; arrived guests are move-locked and say so.
Gated by search-test §34 (18 checks) + golden shape cases + ui-test-bookcmd.js (real
browser: edit modal carries the proposed dates; quote run prefills Add Booking).

**Pricing in search** (admin.js) — search suggests AND applies demand-based pricing.
(1) **Dated price-change COMMAND** (in `cmdkCommand`, so it beats the generic rates action):
"set jollyboat to £150 for 20–23 aug" / "discount 21a by 10% next weekend" / "raise pimpernel
15% for september" (bare "in/for <month>" now parses as the WHOLE month in `cmdkParseDates`,
checkout-style end) — previews the maths from the season-aware CURRENT rate
(`chbCoupleRateOn`), and Apply saves a dated override through the existing validated
`seasons_save` endpoint. Seasons resolve first-match by start date (lockstep with
pricing.php), so `chbSeasonSplice` SPLITS any overlapped season around the override — an
override can never be silently shadowed; rows stay visible/editable in Rates. Sanity bounds
£20–£2000, future-start only. (2) **Suggestions** ("should i change my prices", `CHB_PRICE_Q`):
instant gap offers from `chbGapScan` (extracted from `chbAnomalies`, shared) — 15% off the
2–4-night holes, one-tap Apply — plus the coach as the full surface, and the server's
demand-signal suggestions (`pricing-suggest.php`: guest searches, unmet demand) merging into
the palette async (`cmdkPricingMerge`, stamp-guarded; weekendPct ones apply via the coach's
own `applyPricingSuggestion`, the rest route to the coach). Gated by search-test §35
(12 checks: preview maths incl. season-aware current rate, whole-month ranges, splice
before/override/after, apply payload keeps existing seasons, guards) + golden shape cases.

**Smart pricing model** (admin.js) — an ON-DEVICE demand model (no server, no external
model — works offline/iPhone) that learns from the owner's OWN bookings and shapes every
price suggestion. `chbPriceModel()` (lazy, memoised on a `dbBookings`+`dbBlocks`+`enquiries`
signature) reads signals, ALL **recency-weighted** (a ~1.5-year half-life, so last year
outweighs three years ago): **seasonal demand** (occupancy by calendar month from direct
stays + OTA `dbBlocks`, Bayesian-shrunk to the mean; **per-cottage** where a cottage has ≥~10
of its own stays, else the pooled fleet curve — so Jollyboat and 21A each learn their own
peak. The per-cottage curve is shrunk against ITS OWN availability (fleet avail ÷ cottages)
and normalised on its OWN min/max, so a cottage's busiest month reads as a peak — NOT the
pooled fleet scale, which used to deflate a single cottage's whole curve ~N× and read even its
peak as quiet (search-test §37 per-cottage check)), **booking pace** (a lead-time CDF from `createdAt` — added to `mapBookingFromApi` — so
a still-open window close to arrival is "harder to fill" than a far one, PLUS a `pickupFraction`
pace-vs-pickup check: within 45 days, a window emptier than usual-by-now softens, fuller firms
up — `chbWindowOccupancy`), **achieved rate** (`agreedPrice.perNight` ÷ season base, **outlier-
trimmed** to ratios in [0.5,2] so a friends-rate freebie can't skew it), and **enquiry demand**
(pending `enquiries` per month → a small post-shrink premium so a month people are actively
enquiring about earns more, even one with thin history). `chbSmartPrice(pk, fromIso, nights, {gap})` turns those into a recommended
nightly rate on a transparent yield curve (busy ⇒ hold/raise to +18%, quiet/last-minute ⇒
discount to −28%), nudged by the achieved-rate ratio and ALWAYS regularised by confidence
(`nStays/24`) so thin data barely moves off the current rate — returns `{rate, pct, base,
score, conf, why, rateLow, rateHigh, confWord, …}` with a plain-English `why`. **Confidence
is PER-MONTH** (`monthConfidence` = the calendar month's data-vs-prior weight, `min`'d with the
global `nStays/24`) — a barely-seen month moves less AND gets a WIDER suggested **range**
(`rateLow`–`rateHigh`, band ∝ `1−conf`), so search shows "£150–£175 · still learning this month"
rather than a false-precise single figure; a well-observed month tightens to one number.
Wired in three places: (a) **gap offers** —
`chbGapPlan` still ANCHORS on the proven default (20% ≤7 days out, else 15%) but the model
REFINES the depth (`dev = (0.5−score)·24·conf`, clamped 5–35%): a busy gap is cut less, a
quiet one more, thin data stays on 15/20 (so search-test §32's flat-rule checks still hold);
(b) a new **search answer** in `cmdkCommand` — "what should I charge for 15–18 aug at
jollyboat" / "best price for …" (`CHB_SMARTPRICE_Q`, a pricing QUESTION so it never collides
with the dated price-CHANGE command) → a "Suggested for X: £Y/night" row with the reason +
one-tap dated apply via `cmdkApplyPriceOverride`; (c) it feeds the same gap rows the brief +
CHB_PRICE_Q surface. The recommendation ALWAYS lands as a `rate_seasons` override the
deterministic `priceBreakdown` reads — never a parallel calc. Gated by search-test §37
(12 checks: learns seasonality, busy≥base/quiet<base, busy priced above quiet, bounds,
plain-English why, gap depth follows demand, thin-data conservatism, the search answer).

**SEARCH ACTS, REMEMBERS, WATCHES** — the command-centre layer, built in dependency
order because each piece makes the next one safe.
- **ACT IN PLACE** (`cmdkAct`'s optional `inline` runner) — every quick-action used to
  begin `closeCmdK()`, so chasing three balances was three journeys. An action may now
  supply `inline: async () => ({ say, undo?, reload? })`, doing its work with the window
  open and reporting as a strip under its own row (`{ say, undo?, reload?, state? }` —
  `state: 'warn'` is the PARTIAL outcome, added for bulk; see BULK below). **OPT-IN is
  the whole safety story**: no `inline` → the old `run()` branch, byte for byte. Used by
  `balance`, the gap watcher, and the set-level `balance-all`.
  The send PREVIEW is kept (one-tap-send-blind on money would be a downgrade); what
  changed is that search no longer closes around it, since modals sit at 2000+ and the
  window at 1700. `previewAndSendEmail` now **returns** whether it sent — it always
  computed that and discarded it — which is what lets the strip tell "sent" from "you
  backed out". Three refusals, each gated: cancelling claims nothing and pushes no undo;
  a sent email offers no undo (it cannot be unsent); a failed action is not undoable.
  `cmdkRefreshRow` recomputes the acted-on row, because a strip reading "sent" above a
  row still reading "still due" is worse than the modal. The strip is STATE + re-render,
  and **`cmdkRowWithStrip` emits it with EVERY row in EVERY layout** — it was in the
  results loop only, so the moment a brief row gained an action (the gap watcher) acting
  from the landing produced silence.
- **UNDO IS A STACK** (`__chbUndo`, `chbUndoPush`, `CHB_UNDO_MAX` 8) — was one variable,
  overwritten by the next action. `chbUndoRecord` KEEPS its name and signature, so
  `cmdkApplyPriceOverride` and the weekend uplift join with no edit. A failed undo goes
  BACK on the stack so it can be retried. `undo` lists the rest of the session's changes.
- **SYSTEM STATE** (`chbSystemState`/`chbSysLine`, `#cmdk-sys`) — one line in the search
  foot, refreshed on open. Reads `window.__cronStatusPre`, already stashed by loadData's
  bootstrap, so it costs NO request — a status line that fetched on every open would be a
  bad trade for a line you normally ignore. Drives off the same `stale` field
  `checkCronHealth` uses, so the two surfaces cannot disagree. ONE line, not a panel:
  healthy is `disabled` (nothing to open), a warning is tappable and routed via
  `cmdkOpenSection('diagnostics')` — NB `openArea()` takes no arguments, and
  `openArea('settings')` was routing nowhere until the typecheck ratchet caught it.
  The foot can no longer be `aria-hidden`: the keycaps stay hidden as decoration but a
  stopped automation must be announced, so the line carries its own `role="status"`.
  TWO signals now. Cron first — everything depends on it — then per-cottage **iCal
  feed health**, which was left out originally because `ical-import.php` returns it
  only to the settings page that asks and fetching it would break the no-request
  rule. `admin-bootstrap.php` now carries a reduced `feeds` array (worst staleness +
  failing-source count per cottage) in the SAME payload `loadData` already makes, so
  the second signal is free and the rule is intact. A feed that has NEVER imported is
  omitted server-side — that is not the same thing as stalled. An outright failing
  source outranks mere staleness; the cron outranks both. Warns at ≥36h.
  Without it a stuck Airbnb sync was discovered by a double booking.
- **WATCHERS** (`watchers-lib.php` rules, `watchers.php` admin API, `watchers-run.php`
  from cron.php, client `chbWatchSet`/`chbWatchStop`/`chbWatchGapAction`, `watching`
  command) — the only thing here that acts while nobody is looking. Stored under the
  INTERNAL content key `search-watchers`. It composes rather than adds machinery: setting
  one is an inline action AND lands on the undo stack. Two rules that matter:
  **`watchers_due` uses `>=`, not `===`** — a cron that fails on Friday must still speak
  on Saturday, because swallowing the one alert the owner asked for is the worst failure
  available; and a watcher only fires **if it is still true** (`watchers-run.php`
  re-checks with an end-exclusive overlap query, and says nothing on a DB error rather
  than claim a gap is free). Expired ones are cleared SILENTLY — "that gap is now in the
  past" is not news. `watchers_key` requires a `kind`: it used to return `'|||'` for an
  empty watcher, which made a contentless one storable. Capped at 12, newest kept.
  Gated by `test-watchers.php` (26 checks, no DB and no clock — the silence cases carry
  as many checks as the firing ones) + `ui-test-command.js` (24 checks across all four,
  each break-tested independently).
- **BULK — chase them all, in one tap** (`CMDK_BULK_SAFE`, `chbBulkAction`,
  `chbBulkSplit`/`chbBulkNames`, `chbBulkConfirm`, `chbBulkRun`,
  `chbBulkBalanceAction`). The recurring job isn't "find a booking", it's chase the
  balances, and that stayed three journeys even after acting in place. **There is no
  selection model**: the money answer was BUILT from the list, so the composer already
  holds every ower and their balance and the set-level action rides on the answer row
  itself (`head.actions = [bulk]` in the owed branch of `cmdkIntent`). That deletes
  checkboxes, long-press, an action bar — and the index-vs-identity bug where a late
  async merge silently changes which rows were ticked. Five rules:
  (1) only the REVERSIBLE and COMMUNICATIVE may go over a set (`CMDK_BULK_SAFE` =
  `email`, `balance`), and the gate is `chbBulkAction(baseKey, spec)` which BUILDS the
  action — a refund/deposit-return/delete can't be bulk-enabled by forgetting a check;
  (2) ONE INFORMED CONFIRM replaces the per-record previews (three previews isn't bulk,
  it's three journeys) — it names every recipient, every amount and every skip, and its
  **button counts what will really send** ("Send 2 requests" over 3 listed rows), which
  is why `glassConfirm(message, okLabel)` gained a second argument; the OK button is one
  SHARED node, so the label is reassigned on every dialog or it leaks into the next plain
  confirm (gated); (3) a guest with no email is SKIPPED AND NAMED, not a blocked batch,
  decided by `chbBulkSplit` BEFORE the confirm so the dialog is honest up front rather
  than reporting a surprise; (4) SERIAL, never `Promise.all` — simultaneous sends invite
  a rate limit and a stampede makes a partial failure impossible to attribute; (5) the
  report is honest and never a bare "Done" — a partial returns the NEW `state: 'warn'`
  strip (`__cmdkActMsg` gained it, `.cmdk-actmsg.is-warn`) because green over "Sent 2 of
  3" is the colour contradicting the words, a total failure THROWS onto the error strip,
  and no branch ever offers an undo (an email cannot be unsent). Re-running is safe: it
  recomputes from live `paymentSummary`, so a half-failed batch re-chases only whoever
  still owes — no bookkeeping. Under two owers there is no bulk action at all ("Request
  all 1 balances" is the row's own action wearing a worse label).
  **A SECOND bulk action** — `chbBulkArrivalAction`, on the arrivals answer — is why
  `email` sat in the safe list from the start. It reuses the confirm, the serial send
  and the report unchanged; what it added is a second SKIP REASON, because a guest who
  already has their arrival info must be named and passed over rather than sent it
  twice. `chbBulkSplit(rows, skipIf)` takes that predicate so the confirm and the
  report can never disagree about who is in the batch, and the "nothing to send" alert
  stays SPECIFIC when the reason is a missing address (actionable: add one) rather than
  going generic. OTA rows can't reach it — the arrivals composer's `rows` are direct
  bookings only. NB the report counts in DIGITS: `chbSayN(2)` is "a couple", which
  reads as "a couple guests" before a noun. Gated by search-test §39.
  **Two fixes it forced, both measured.** `cmdkRowExtrasHtml` now owns a row's
  quick-actions + refine chips as ONE definition shared with `cmdkHeroHtml`, because the
  hero rendered NEITHER: the owed answer's three refine chips ("Overdue only" /
  "Deposits to return" / "Who's paid in full") had been in its data since before the hero
  existed and appeared **0 times** on screen the moment it became one — so a bulk action
  placed there would have been invisible too. And `.glass-dialog-msg` scrolls
  (`max-height: 46vh`) because a confirm that LISTS its set is as long as the set —
  without it, 30 owers pushed Send/Cancel to y=995 in a 780px viewport, a dialog you
  cannot answer. Gated by search-test §38 (26 checks, all nine refusals break-tested)
  + `ui-test-command.js` (the affordance on screen, the real dialog driven by clicking
  its own buttons, the partial report, the phone's full-width lone action, the label
  leak, the long-list scroller — NB that scroller check sets the viewport explicitly:
  at the suite's default 900×900 the buttons fit anyway and it passed with the CSS
  deleted).

**THE COAST TIER** (admin.js `chbCoastRow`/`chbCoastDay`/`chbCoastFetch`, `CHB_TIDE_Q`,
`CHB_WEATHER_Q`) — tides and weather, the two things a Blakeney owner is asked about
most. **Tides were already built and unreached**: `tides.php`/`tide-data.php` (cached,
public, `apikey-tides`, degrades to `{ok:false,reason}`) existed only for the
cottage-page widget and the trip planner — the owner, the brief and search never saw
it, the same "built with no way in" shape as the mailbox's Sent list. Weather is NEW:
**`weather-data.php`** + **`weather.php`** on Open-Meteo, chosen because it needs **no
key** (tides already cost one, and a second is a second thing to go stale), cached in
the content table under **`weather-cache`** (classified internal in db.php, so
`test-content-keys.php` enforces it) rather than a new table — one row rewritten a few
times a day isn't worth a migration. `weather_daily()` deliberately mirrors
`tide_extremes()`'s return contract so the two behave identically at every call site.
Both sit in the DETERMINISTIC tier beside `chbCompute`/`chbAlmanac` (retrieval — never
wrong, silent when the data isn't there) but are **async**, so they merge in
stamp-guarded exactly like `cmdkServerSearch`: a tide time that lands after you've
typed something else is dropped. The value is the CROSS-REFERENCE, which only this app
can make — "High water 06:41 and 19:08 today · low 12:55 · **Wren arrives today**".
`weather_notable()` is the discipline: the brief may only interrupt when the answer
changes what you'd do (gale ≥45mph gust, ice ≤0°C, heat ≥28°C, rain ≥20mm) — a daily
"18°C and cloudy" row trains the owner to ignore the panel, so an ordinary day returns
null. Two bugs its own tests caught, both worth remembering: `weather_code_text` had
`>= 95` with **no upper bound**, so a garbage code invented "thunderstorms" (WMO tops
out at 99); and `chbCoastDay` anchored at LOCAL midnight then formatted with
`toISOString()` — under BST, Saturday 00:00 local is Friday 23:00 UTC, so "tides on
saturday" resolved to the Friday. It is all-UTC now (`T00:00:00Z` + `getUTCDay`), swept
across both DST transitions. Gated by `test-weather.php` (CI-wired, deploy-excluded —
no network, it tests the judgement) + search-test §31c (14 checks: composition, the
arrival cross-reference, silence on a failed fetch, the day parser, and that ordinary
business queries never trigger it).

**Conversational frame** (admin.js) — search is a DIALOGUE, not one-shots. The last METRIC
answer's frame (`__cmdkFrame` = metric · period · cottage, 3-min TTL, stored by
`chbFrameStore` whenever an intent/NLU answer carries a `CHB_FRAME_METRIC_Q` metric) lets a
one-slot follow-up REFINE it instead of starting over: "revenue this year" → "and last year"
→ "just jollyboat" → "occupancy" → "as nights" each patch ONE slot (`chbConvResolve` →
`chbConvPatch`) and recompose a canonical query (`chbFrameCompose`) re-run through the SAME
deterministic families — checked FIRST in `cmdkBuildResults`, figure row hoisted to the head
(`chbConvFigure` — a follow-up asked for a number, not the Income & tax action row; NB
recomposition says "earned", not "revenue", because 'revenue …' is claimed by that
golden-pinned action). "vs last year / versus / compared to" runs BOTH frames and SPEAKS the
delta (`chbConvCompare` — "this year: 1% · last year: 2% — down 50%", sources beneath).
Monotonic-safe like the veto: a refinement must be EXACTLY one slot; a bare cottage name
needs a marker ("just/only/at jollyboat" — bare "jollyboat" stays the dossier); full
questions (metric+period) are never refinements; stale/absent frame or an unanswered
recomposition falls through untouched. Enables **prop-scoped insights** as a standalone
feature too: a named cottage now scopes every figure in the insights branch (`insProp` —
"jollyboat earned last year", "occupancy at 21a this year"; occupancy denominator = 1
cottage). Gated by search-test §33 (12 checks: the full chain, all five guards, standalone
prop-scoping) + a golden "conversational frame" section (drives cmdkBuildResults, incl. the
composed delta and the mid-conversation ops guard).

**Breadth tier** (admin.js) — deterministic GENERAL answers, consulted by `cmdkBuildResults`
right after the intent branches and before the NLU model. When it fires it is **prepended** —
an exact sum beats a keyword-matched action row ("vat on £480" leads with the figure, the
Income & tax row rides below). `chbCompute`: safe arithmetic (`chbCalc`, recursive-descent —
never eval), UK VAT @20%, percentages (of/off/plus/minus/what-%), unit conversions
(kg/lb/st/mi/km/m/ft/cm/in/l/pt/gal/°C/°F), date arithmetic ("days until christmas", "what day
is 20 august" — `chbComputeDate`, UK-day-seeded via `todayDashed`, incl. named days + Easter
from `chbEaster` (Meeus/Jones/Butcher — computed, never tabled)) and a world clock
(`CHB_CITY_TZ`). `chbAlmanac`: curated fact pack — `CHB_COUNTRIES` (~120 countries → capital +
currency) and **computed** England & Wales bank holidays (`chbBankHols(year)` — Easter-derived
+ first/last-Monday + weekend substitute days; NO yearly table to extend, "next bank holiday"
spans this year + next). Retrieval/computation only — never wrong, just silent off-pack. Every pattern requires
explicit digits / units / date words, so business queries can never fire it (search-test §29:
answers, abstains on 13 business shapes, pipeline lead). New insight families in `cmdkIntent`:
**repeat-guest rate** (from `chbCustomers`, all-time by nature, strong-identity so name-only
guests never fake a repeat) and **average length of stay** (a habitual "how long do guests
stay" widens to the year; an explicit period keeps it; checked before the average-RATE family)
— §29b. **HABITUAL and AGGREGATE phrasings are vetoed out of the singular "the guest"
composer**, and this matters more than it sounds: that branch resolves to ONE stay (the
soonest, when nobody is in residence) and matches on words as broad as "how many nights" +
"book", so it used to answer "how long do guests stay" with a single guest's stay length —
and "how many nights booked this month", a core metric, with one guest's booking. ANY future
booking was enough to trigger it, i.e. nearly always. Two shared regexes own the boundary
(`CHB_STAYLEN_Q` habitual, `CHB_NIGHTSAGG_Q` aggregate), each ONE definition used by both
sides so the composer's veto and the family that should answer can never disagree —
`CHB_STAYLEN_Q` also makes the nights-booked family DECLINE "how many nights do guests stay"
so the average family (checked just after it) takes it. The vetoes are deliberately narrow:
"how long is the guest staying" / "how many nights is the guest staying" still name the
guest. §29b gates all seven phrasings and each veto break-tests independently.
The NLU corpus stays frozen (ceiling — see above); breadth grows by new deterministic
families, not classifier examples. Business-SLANG synonyms ride the family regexes the same
way (measured on the stress set, gated in golden): `adr` → average rate, `fill rate` →
occupancy, `top line` → revenue, `how's trade` / `state of play` → the pulse narrative,
`pipeline` / `round the corner` → upcoming. NB "check-in/out time" wording must NEVER become
a none-example (measured: collides with "who checks out before noon"); the intent tier
already answers it end-to-end, so the tier-3 model-level accept is harmless.

**Scope batch — five more deterministic families + two structural widenings** (admin.js,
gated by search-test §43). The families (`CHB_RATING_Q` / `CHB_EXPENSE_Q` / `CHB_PLAN_Q` /
`CHB_LAPSED_Q` / `CHB_WAITLIST_Q`, branch 0b9 in cmdkIntent): **reputation** (allReviews()
averaged overall + per cottage — an unassigned review still counts overall, and no date
claims because review dates are unreliable), **expenses** (tax-year framed like the books,
`expensesForYear`/`taxYearStartOf`, category drill-down against `EXPENSE_CATS`), **payment
plans** (`chbAutopayRows` — the hub/Money derivation, never a second one), **lapsed guests**
(`chbCustomers`, last stay >180 days, nothing upcoming, Email action per row) and
**waitlist** (a session cache filled by `cmdkWaitlistMerge`). Three placement rules, each
learned by a failing gate: **0b9 sits ABOVE the insights branch** — CHB_LAPSED_Q must beat
the repeat family's `\brebook` ("who HASN'T rebooked" is the lapsed question), and insights'
generic tail would otherwise claim any INSIGHTS_RE-shaped query these declined; **bare
"who's waiting" stays the enquiries answer** (golden-pinned) — CHB_WAITLIST_Q requires the
list's own name or a space/dates object; and the expenses/waitlist stores **fetch
stamp-guarded from cmdkSearchCore only while genuinely unloaded** (`__expTried` /
`Array.isArray(__wlCache)` — a tried-and-EMPTY store answers "nothing logged", an unloaded
one stays silent; the loop-proofing is the gate condition, not the merge). Structural:
**`chbConvPatch` takes ONE two-slot pair** — cottage + period together ("just jollyboat
last year"), both halves parsing exactly, the cottage half still marked; metric never joins
a pair, so a full question is still never a refinement. And **`cmdkCommand` strips a
compound suffix** ("…and send the confirmation") before the guest-name captures and notes
it on the move/extend proposal — honest because a dates change is MATERIAL, so saving
already raises the re-send ask; the note says where it appears, never promising an
auto-send.

**Accommodations are dynamic** — the owner adds/removes cottages from the back office
(Settings → Preferences → "Add accommodation"; per-cottage "Remove" / "Restore"). The
`properties` table is the single source of truth (`prop_key`, `name`, `couple_rate`…,
plus `archived_at`, `slug`, `accent`, `sort_order`, `max_adults/children/total` — see
`migration-accommodations.sql`). `rates.php` actions: `create` (name + couple rate →
generates key/slug/accent), `archive`/`unarchive` (soft-remove; **never hard-delete** —
past bookings/payments/emails key off `prop_key`), `save` (extended to name/slug/accent/
occupancy). All payment/booking logic works for any cottage with a row. On the front end
`loadRates()` synthesizes `propertyMeta`/`propertyContent`/`propSubtitleDefault`/
`COTTAGE_SLUGS` for every row, `injectPropColors()` gives added cottages a runtime accent,
and `renderCottageCards()` rebuilds `#cottages` from the live list; `db.php` `occupancy_limits()`
+ `prop_display()` and the email files (`mailer.php`/`owner-digest.php`/`enquiry-nudge.php`)
read the rows too. The hardcoded JS maps + PHP fallbacks now only cover the original three
offline / pre-migration. SEO is dynamic end-to-end: `sitemap.php` (rewritten from
`/sitemap.xml`) and the JSON-LD (`injectStructuredData()` after `loadRates()`) both follow
the live cottage list, and **`cottage.php`** serves `/cottages/<slug>` (rewrite in
`htaccess.txt`) — it returns index.html with that cottage's title/meta/og/h1/description
injected server-side for crawlers (keys `<prop_key>-title/-subtitle/-desc` from the content
table, falling back to the properties row; og:image = the cottage's first gallery photo;
unknown slugs return a real 404). **`experiences-page.php`** serves `/experiences` (published
things-to-do rendered into `#exp-grid` for crawlers; app.js opens the view for the path), and
**`home.php`** serves `/` the same way, swapping the live
uploaded hero (content key `hero-bg`) into the LCP preload, og:/twitter:/JSON-LD images and
the hero element — the static `hero.jpg` does NOT exist on the live host (it 404s), so never
"fix" references back to it; the auth modals' brand panel gets it via `--hero-img` (set in
`applyContentOverrides`). Both PHP routes regex-target exact markup anchors in index.html —
smoke-test §6g/§6h guard them; if you move that markup, update cottage.php/home.php too.
They're deliberately standalone (own PDO, not db.php — `db()` exits with JSON on failure,
which would corrupt these HTML routes); on ANY error they serve index.html untouched.

**A BAD FEED MUST NEVER EMPTY THE CALENDAR** (`ical-lib.php`, gated by
**`test-ical.php`**). Every other double-booking guard is a REFUSAL — the endpoints
check `dates_clash` and say no. The platform sync is the exception and therefore the
most dangerous code in the app: `sync_property` DELETEs a source's blocks and
re-inserts from the feed, so treating a bad response as a good one leaves the cottage
reading FREE for every Airbnb stay, and no endpoint guard can save it — the clash
check faithfully finds nothing, because there is nothing left to find. The guards were
all present and correct and NOTHING tested them, the same gap the clash guards had.
**`ical_feed_usable($res)`** is that decision stated once (it was two inline conditions
inside `sync_property`): a failed fetch is unusable, a 200 whose body lacks
`BEGIN:VCALENDAR` is unusable (a login page, an HTML error, a moved link — all parse to
zero events and would look exactly like "no bookings"), and a REAL calendar with no
events IS usable, because "everything is free now" is a legitimate answer — that is how
an external cancellation frees the dates and the waitlist gets told. NB an Airbnb
`DTEND` is the CHECKOUT day, so the feed is end-exclusive like everything else here;
§2 pins 10th→14th as FOUR nights, and making it inclusive fails that check (the
off-by-one would sell an OTA guest's last night twice). The pure judgement lives in a
lib for the same reason sweep-lib / payouts-lib / bank-lib do — `ical-import.php` routes
and calls `require_admin()`, so a test that required it would exit. **No network**: a
suite that depends on Airbnb's uptime fails for reasons that are nothing to do with this
codebase, and `ical_url_public` blocks a local fixture URL anyway (correctly — trusted-user
SSRF is still SSRF; §3 pins loopback / 10.x / 192.168.x / 169.254.x / IPv6 loopback with
bare IPs, so no DNS is involved and the checks are hermetic).

**A TIMELINE DAY CELL ANSWERS FOR THE NIGHT IT ACTUALLY IS** (`renderCalendar`, gated by
ui-test-workspace §1b). The bars are inset half a day at each end so a changeover reads
as shared between two stays — good, and it leaves a bare strip of the underlying
`.tl-cell` exposed on BOTH the check-in and the checkout day. Every future cell carried
`tlAddAt`, so both strips offered "add a booking here": the checkout one is right (that
night IS free again — the same turnover the clash guard allows) and the check-in one is
not, since it prefilled a stay on a night already sold, which the server then refuses.
`takenBy` maps each night to its booking (end-exclusive, the guest picker's model, so the
two calendars agree), a taken night opens THAT booking rather than starting a new one —
leaving it inert would only move the defect, a live-looking strip that answers nothing —
and an imported platform stay just names itself, having no hub to open. Hit-tested at
real pixels in §1b, because the defect is an exposed strip and no class check can see it.

**TODAY WEARS THE VOCABULARY, AND THE CALENDAR WORKS HARDER** (approved live
demo v3; gated by ui-test-workspace §1b/1c + ui-test-hub's calendar block, both
re-aimed). One serif identity: the month is the timeline caption row's SMALL
serif beside ‹ Today ›, "Bookings" is a caption row (`.bk-caprow` — the h2
stays for the outline, restyled) with its count and a **COMPUTED verdict
capsule** (renderBookings — money due anywhere in the visible rows keeps it
amber; only a list with nothing owed earns ✓; empty claims nothing). The ops
line gains the ✓ "Nothing needs you" capsule ONLY while `needsYouItems()` is
empty — with duties present the strip carries the state. Actions go sentence
case; `.cal-panel` takes the well ground. Calendar features, each on existing
plumbing: **occupancy pips + ↺ changeover marks** in the header (laneData —
ONE per-lane night derivation shared by header and lanes, so they cannot
disagree; both aria-hidden decoration), **✦ gap sparks** (chbGapScan/chbGapPlan
— tap CONFIRMS before nyGapOffer saves; a 24px mark must never apply a price
on a stray touch; live offers route to Rates), **paid-state dots** on unsettled
direct bars (CSS ::before on the existing tl-pay-warn/danger classes), and the
**TWO-TAP RANGE** (`tlCellTap` replaces the free cell's instant tlAddAt): first
tap ARMS a night (`.is-selstart`, state in `__tlSel`, repainted across
re-renders, Escape clears), second tap on the same lane completes — the
glassDialog chooser offers Add a booking (tlAddAt grew a checkout argument) or
Block these dates; the same night twice books one night; a crossing range
REFUSES via cmdkBookClash and NAMES whose stay it crosses; a different lane
restarts there. NB ui-test-hub's old check clicked a `tlAddAt` cell and expected
the modal — re-aimed to the two-tap + chooser flow, and ui-test-workspace §1c
drives arm/choose/refuse with the back-out proving nothing saves.
**THE CALENDAR CANNOT BE DOUBLE-BOOKED — and that is now GATED, which it was not**
(test-integration §15, 26 checks against a real database through the real endpoints).
The guards were all there and all correct; what was missing was any test of them, so
the single guarantee this business cannot trade away rested on code nothing exercised.
The shape to keep in mind: **the picker is only the friendly layer** — it can be
bypassed by a stale tab, a second device, a slow network or a bug like the three fixed
this week — so what matters is the ENDPOINTS. `dates_clash` (db.php, boolean) and
`clash_message` (bookings.php, the wording) are the two forms of one rule, tested
`existing.start < new.end AND existing.end > new.start`; both cover `bookings` AND
`ical_blocks`, so an Airbnb stay blocks the calendar exactly like one of ours.
Admin `add`/`update` hold `book_lock` and answer `{clash:true}` — a SOFT stop, since
the owner may overlap on purpose, and **`override_clash` is the only way through**;
enquiry `submit` refuses outright, and **approval re-checks under `book_lock`**, which
is the race that actually happens (the enquiry was legitimate when made and the dates
went while it sat in the inbox). Two directions are gated because they cost the same
money: an overlap that gets through is a double booking, and a "clash" that is really a
legal TURNOVER — arriving on the day someone leaves, leaving on the day someone
arrives — is a booking refused for nothing. Break-testing `<` to `<=` fails exactly the
turnover checks, which is the point of having them. `cancel` DELETEs the row (not a
status flag), so the dates return to `dates_clash` AND to `availability.php` and the
waitlist is notified — gated end to end, because a cancellation that left the row
behind would quietly block those dates for ever.
**`override_clash` may only ever be set after a human has read the clash**, gated by
smoke-test §12 (it scans the shipped JS and requires a `glassConfirm` within 400 chars
of every site). The Test Centre's demo-booking button was sending it unconditionally —
the one control that creates a booking with nobody reading the answer could therefore
silently overlap a real guest, and its own "Those dates clash — try again" branch was
unreachable because the override guaranteed the server would never say so.

**REGISTERING AN EMAIL IS NOT PROOF YOU OWN IT** (`guests.email_verified_at`,
migration-111). `my_bookings_payload` matches stays on `LOWER(b.email) = LOWER(?)`
and NOTHING verified the address — `guest_register` created the account and signed
the person in on the spot, so registering with a guest's email handed over their
booking: dates, party, money, arrival details, and the door code once inside its
reveal window. The magic link is the proof, because it is emailed TO the address.
Three rules: an address with NO bookings has nothing to claim, so it is stamped
verified and signs straight in (the ordinary case is untouched); an address that
DOES have bookings gets the account, no session, and the link; and **`guest_login`
must refuse an unverified account** — without that the fix is theatre, since the
password was chosen by whoever registered. `guest_magic_consume` stamps the column.
Checks BOOKINGS only, never enquiries: the enquiry flow registers moments after
submitting an enquiry with that same address, so counting enquiries would send
every new guest to their inbox. Existing rows are backfilled VERIFIED — locking a
real guest out of their own stay is a worse harm than a squat that has already
happened. Gated by test-integration §19 in all four directions.

**THE INSTALMENT COLLECTOR'S THREE RULES** (autopay-lib.php / pay.php), each of
which shipped broken and was found by the money audit:
- **The write-back names `payment` — the ENUM — not `payment_status`**, which is no
  column at all. PDO is in exception mode, so the write AND its fallback threw and
  the inner catch swallowed both: after a successful charge NOTHING was written
  back, `autopay_next_at` never advanced, and a monthly plan re-collected the next
  morning and every morning after. test-autopay now asserts every column the
  collector writes exists in schema.sql + the migrations, because the harness's
  `ApWrite` accepts any SQL string — which is how 211 checks passed over a
  collector that could not write.
- **Read the paid figure BEFORE the ledger row lands.** `booking_paid_so_far` reads
  `booking_ledger_net`, so reading it after the INSERT and adding `$rental` counts
  the collection twice; a monthly plan then stopped one instalment short with every
  screen reading paid in full. The receipt was re-deriving it the same way.
- **Snapshot the autopay terms BEFORE the charge.** `booking_autopay_terms` opens
  with "only a DEPOSIT is ever scheduled" and resolves the stage through the LIVE
  ledger — derived after the charge the deposit reads settled, the stage is already
  'balance', terms come back null and the vault answers "nothing to schedule". Every
  consenting guest was told their plan could not be set up. It also takes a
  `$kindHint` so the screen's own stage wins: "settle the whole stay now" was
  offering to schedule the money it was collecting.

**BLOCKING DATES IS NOT A ONE-WAY DOOR.** `delete_block` existed, was correct, and
had NO caller — the timeline drew owner blocks as inert spans — so a blocked range
was permanent: hidden on the site, refused by `dates_clash`, AND published as
unavailable to every platform (ical-export publishes `source='owner'`). Owner blocks
are controls now; IMPORTED bars stay display-only and `delete_block` is restricted
to `source='owner'` server-side, because deleting an import reads the cottage as
FREE until the next sync — a real double-booking window.

**Data / migrations** — MySQL. Schema in `schema.sql`; changes ship as
`migration-*.sql` applied by `migrate.php` (admin visit or `?cron=APP_SECRET`, or
Settings → System check → Run migrations). Migrations are idempotent
(`CREATE TABLE IF NOT EXISTS`, guarded `ADD COLUMN`). **NEW migrations are named
`migration-NNN-<slug>.sql`** (NNN ≥ 100, next free number) — smoke-test §6c-iii
gates the name against a FROZEN legacy list (never rename an old file; the ledger
keys off filenames), and `migration_sort()` (migrate.php, tested in
test-migrate.php) applies legacy names first in byte order, then numeric ones in
numeric order, so a new ALTER always follows the legacy CREATE it touches on a
fresh DB. Most owner-editable content
lives as JSON in the `content` table (`welcome-<prop>`, `faqs-<prop>`, etc.).

**Gotchas**
- The price model is duplicated: JS `priceBreakdown()` (app.js) must stay in
  lockstep with PHP `price_breakdown()` (pricing.php). The parity cases live ONCE in
  **`pricing-fixtures.json`** — smoke-test §2 loops them against the JS engine
  (asserting the shim's built-in rates match the fixture) and test-pricing.php loops
  the same file against PHP, so the two sides can never silently test different
  inputs. Add new parity cases to the JSON, not to either test.
- **`total` is RENTAL ONLY** (nightly + txn). The refundable damages deposit is returned
  by the price model as `damagesDeposit` but is NOT in `total`. Current model: it is
  **CHARGED together with the guest's first payment** (`pay.php` bundles `damagesDue`
  when `hold_status='none'` → `'charged'`) and **refunded after checkout** via
  `bookings.php` `return_deposit` (or `keep_deposit` when there was damage →
  `'returned'`/`'kept'`); state lives in the reused `bookings.hold_*` columns. Wording
  everywhere (guest + admin) says "charged with your first payment, refunded after your
  stay" — NOT "held". A LEGACY Square card **HOLD** flow (authorise → capture/release;
  `hold_request`/`hold_link`/`hold_capture`/`hold_release`, ?hold= pay screen + emails)
  still exists for old bookings — only there is "held, not charged" wording correct.
  self-repair marks `authorized` rows older than Square's ~6-day auth window `expired`.
  **The two eras leave DIFFERENT ledger traces, and accounts.php has to respect that.**
  A charge-upfront deposit gets NO `kind='damages'` payments row — pay.php writes one
  rental row for `$amountDue` only and puts the deposit on `hold_*`. A legacy captured
  hold DOES get a `damages` row. `return_deposit` writes `damages_return` in both. So
  kept-deposit income must be netted **per BOOKING and floored at zero**
  (`max(0, captured − returned)`), allocated to the CAPTURE date because retaining the
  money is the taxable event. Netting per DATE across all bookings — which is what it
  used to do — breaks three ways: a returned charge-upfront deposit becomes NEGATIVE
  kept income (a £75 refund silently took £75 off net profit, reproduced to the penny
  against an owner's real statement), one booking's return eats another booking's kept
  income when the dates collide (£100 kept + £75 returned elsewhere reported £25), and
  a return in the following tax year leaves a phantom negative in that year. A returned
  deposit was never income and must not move profit at all. Gated by
  test-integration §14 (7 checks; three of them fail against the old query).
- **A FAILED REFUND IS NOT MONEY RETURNED** (`damages_returned_map`, db.php; gated by
  test-payrail + test-integration §10b(E)). `damages_returned($id)` always excluded
  FAILED/REJECTED — but THREE display sites summed the same rows with **no status
  filter at all**: the admin booking rows (so the hub showed the deposit settled), the
  `deposit_returns` action (which feeds the Money screen's "Deposits to return" queue
  AND its Needs-you duty, so the deposit dropped off the owner's to-do list and the
  failed refund was never re-tried) and `my-bookings.php` (so the GUEST was shown money
  back they had never received). The server's `return_deposit` guard used the correct
  figure throughout, so the money could still be returned — nothing was telling anyone
  to. One map helper now, and `damages_returned` delegates to it so there is a single
  query shape.
- **THE GUEST INVOICE HAD TWO WRONG FIGURES** (invoice.php; gated by test-payrail).
  It read `deposit_paid` alone — the FOURTH "already paid" site, missed when the email,
  the pay screen and the charge were unified — so with the ledger ahead it understated
  Paid and overstated Balance due on a document the guest opens. And it billed
  `agreed_booking_fee` as the refundable deposit, which the `update` action RE-SNAPSHOTS
  while `hold_amount` (the sum actually taken) stays put, so the two diverge and the
  invoice showed the new figure as both the deposit and as money paid.
  `damages_collected()` reads `hold_amount` for exactly this reason; so does the invoice.
  **NB the trigger is narrower than this entry used to claim** — it said "whenever the
  stay changes", but `$depForSnap` PRESERVES `$currentDeposit` unless a different
  `damages_deposit` is supplied, so it takes a deliberate deposit EDIT, not any stay
  edit. Checked while fixing the client half.
- **AND THE CLIENT HALF WAS THE SAME BUG** (`depositTakenAmt`, app.js; gated by
  smoke-test + ui-test-yourstay §11). invoice.php bills `hold_amount`; the DOWNLOADED
  PDF (`downloadInvoice`) and every `displayGrand` figure read `p.damagesDeposit`, i.e.
  the agreed one — so a guest could hold **two invoices for one stay quoting different
  deposits**, and the PDF promised back money `return_deposit` is capped from paying
  (`damages_collected()` reads `hold_amount` too). Measured at £90 agreed against £50
  held: the My Stays card read "deposit £90.00 · Total £480.00 · Paid in full £480.00"
  for a stay whose card took £440. Three cases the helper must keep right: BEFORE the
  charge the agreed figure is correct (it is what pay.php will take), a cash/bank
  booking never charges it so `hold_status` stays `none`, and an older charged row with
  no `hold_amount` falls back to the agreed figure rather than reading £0. The owner's
  EDIT MODAL deliberately keeps showing the AGREED deposit — it is what its own input
  edits and what saving preserves. NB the BALANCE is unaffected either way (total and
  paid move together), which is why every balance-shaped test in the suite was blind
  to this.
- **A CUSTOM PRICE RENDERS AS ONE COHERENT LINE, SAID SO** (`booking_price_is_custom`
  in db.php, JS mirror `priceIsCustom` in app.js; gated by test-payrail + smoke-test +
  ui-test-yourstay §12). `price_override` (and an enquiry's agreed price) replaces the
  rental TOTAL while `per_night`/`nightly`/`tx_fee` stay the standard snapshot — so the
  confirmation email, invoice.php, the My Stays card, the client PDF and the hub
  breakdown popup ALL printed "£130.00 × 7 nights: £910.00 / fee £0.00 / Total £750.00":
  lines that cannot add up to their own total, on the guest's own documents (reported
  with a screenshot). One decision now — custom ⇔ |nightly + txFee − total| > ½p — and
  when true every renderer prints "Agreed price for your stay (N nights)" in place of
  the per-night + fee pair, so the sum coheres AND the custom price is stated as what it
  is. An override typed EQUAL to the standard price keeps the standard lines (they add
  up; relabelling them is noise). Deliberately untouched: the EDIT MODAL and the
  custom-booking preview, which already show the override honestly as a struck-through
  "Calculated total" beside the agreed one — that is an owner surface explaining the
  derivation, not a guest document asserting a sum. The five renderers are one
  booking's documents: any new price-box render must take the same branch.
- **A PRICE OVERRIDE REPLACES THE RENTAL FLOOR — IT IS NOT MAX()'D IN**
  (`booking_rental_price` in db.php, JS mirror `damageHeld` in admin.js; gated by
  test-payrail + smoke-test §9 + ui-test-pay). Found by the full payment-surface
  audit. The override used to "raise the floor" (max of snapshot and override),
  which is wrong in the direction overrides are actually used — a DISCOUNT: agreed
  £700 against a £910 snapshot, guest pays £750 CASH (rental + £50 damages deposit;
  `hold_status` stays `none` on that rail), and `damages_collected`'s 'none' branch
  read paid − rental as negative — so the £50 the owner genuinely holds reported £0
  collected: never listed in "Deposits to return", never a duty, unreturnable
  (`return_deposit` caps at collected − returned), while accounts.php counted it as
  taxable rental income AND the balance watcher kept saying the guest still owed the
  snapshot difference. The CARD rail dodged all of it (`hold_status='charged'`
  short-circuits to `hold_amount` before the rental maths), which is why it
  survived. Replace is safe in every era: over-return stays impossible because
  collected is min-capped at the agreed deposit AND at what was paid above the
  rental — a legacy override with the deposit folded in has paid == override, so it
  still collects £0. From the same audit: **the pay screen's deposit sub-line now
  ITEMISES to its own headline** ("£175.00 deposit (25%) + £50.00 refundable
  deposit" under £225.00) — "25% deposit · £750.00 total" had the percentage
  against the rental beside the grand total, so the line never reconciled with the
  figure the guest was about to pay whenever a damages deposit rode the payment.
  A legacy CAPTURED hold writes its ledger row as `kind='damages'` keyed on the same
  `hold_payment_id`, with the DEPOSIT as its amount — so the unrestricted join read
  that as the charge's rental portion and apportioned the fee against a doubled gross
  (over-fencing, the safe direction, but wrong). With no rental row the deposit rode
  its own charge, which is what a captured hold IS, and the estimate is then correct.
  A defect in the code #869 shipped; the per-transaction list was already safe because
  it filters `kind IN ('deposit','balance')`.
- **ONE DEFINITION OF "ALREADY PAID"** (`booking_paid_so_far`, db.php; gated by
  test-payrail). There were two. `bookings.deposit_paid` is the reconciled headline
  figure and `booking_ledger_net()` is what the card ledger shows; they agree once
  reconciliation has run and diverge in the window this app already handles elsewhere
  (a payment landed, reconcile/webhook unfinished). The CHARGE in pay.php always took
  `max()` of the two — so it can never take more than the guest was quoted — but the
  EMAIL (`booking_amount_due`) and the pay SCREEN's summary both read `deposit_paid`
  alone. With the ledger ahead, the guest was asked for MORE than the card would take,
  and at the extreme was told £220 was due and then got "already paid in full". Same
  question, three call sites, two answers. NB the helper's catch covers a failing
  ledger QUERY (an un-migrated payments table), NOT an unreachable database — `db()`
  EXITS with JSON on that, so there is nothing to catch; the first version of this
  comment claimed otherwise and writing the test is what caught it.
- **THE LEDGER'S STATUS IS CASE-PROOF AT BOTH ENDS** (`payment_status_norm` /
  `payment_status_known`, gated by test-payrail + test-integration §10b). Everything
  stored comes from Square (uppercase) or is the literal `'MANUAL'`, so the column has
  always been uppercase in practice — but the READERS disagreed about whether that was
  guaranteed. accounts.php case-folds all eleven of its filters; `booking_ledger_net`
  (the primitive every paid/refund calc builds on), `find_charge_for_refund`,
  `damages_returned` and the reconciler did not. One lowercase row would therefore be
  counted by some money queries and not others, and which ones would depend on the
  query rather than the fact. Fixed from both ends: normalised on WRITE so it cannot
  recur, and the four readers case-fold so rows already stored are safe.
  **And the REFUND webhook branch validates before it overwrites.** It wrote
  `$refund['status'] ?? ''` straight in, so an event whose refund object carried no
  status blanked a good one on a money row — while the payment branch guards on
  `$status !== ''` and the reconciler uses an explicit whitelist. Three paths, three
  rules; this was the unguarded one. (Its blast radius was limited because
  `reconcile_pending_refunds` re-polls a non-terminal row and repairs it, but a blanked
  charge stops `booking_ledger_net` counting it, i.e. the booking reads unpaid.)
- **THE CANCELLATION REFUND IS CAPPED** like the per-row one (gated by test-payrail +
  test-integration §10b). The `refund` action capped by `booking_ledger_net`; `cancel`
  took a free-typed figure with no cap, on the one screen where a typo is most likely.
  Without it the only thing stopping an over-refund was Square rejecting it — which
  aborts the cancellation too, so the owner could not cancel at all until they guessed
  a workable number. Same rule, same sentence. An unreadable ledger still leaves it to
  Square rather than blocking a cancellation.
  NB two of these gates were vacuous first: one matched `sweep_outstanding` in a
  COMMENT, and one checked the cancel cap was COMPUTED while `if (false)` left it
  computed and ignored. Assert the enforcement, not the ingredient.
- **VERIFIED CORRECT in the same audit** (recorded so the next one can skip them):
  every pound→pence conversion is `(int) round(x * 100)`; charge and refund
  idempotency keys are deterministic and include the refunded-so-far sum, so a retry
  collapses at Square while a genuine second refund does not; no endpoint takes a money
  amount from the client except the owner's own refund figures, which are capped;
  `damages_returned` counts PENDING returns (the double-return guard) while the sweep's
  own query counts only SETTLED ones (has the money left?) — two different questions,
  two queries, both right; `keep_deposit` and `return_deposit` re-read under
  `book_lock`; `price_round2` documents its bit-identical parity with JS
  `Math.round(x*100)/100`; expenses reject a non-positive amount; the pay-in-full kind
  upgrade happens BEFORE the summary, so quote and charge agree; and `hold_status='kept'`
  correctly leaves the sweep's ring fence.
- **What "Net profit" on Payments → Income & tax actually COVERS**, and why the
  screen says so out loud. `accounts.php` selects `WHERE b.deposit_paid > 0`, i.e.
  money recorded through THIS site, so two things sit outside the figure and neither
  is visible in the numbers: **logged expenses only** (with none logged the headline
  is income less card fees — a gross margin, not profit), and **platform stays** —
  Airbnb/Booking.com arrive as imported `dbBlocks`, are paid out by the platform and
  never touch the ledger, so neither that income NOR the commission deducted from it
  is counted. `accountsScopeCaveats(startYear, expTotal)` (admin.js) is the ONE
  definition of those caveats — plain sentences, no markup — and the screen, the PDF
  and the CSV all render it, so the three can't disagree. It counts OTA stays via
  `isOtaBlock` (excludes `source:'owner'` blocks, which aren't bookings). Gated by
  ui-test-money §6. NB `dbBlocks` is `const` in app.js — a test must MUTATE it, not
  reassign it, or the assignment throws and the case silently proves nothing.
- **HOW MUCH OF THE SQUARE BALANCE IS ACTUALLY THE OWNER'S** (Payments → "Move
  money out", `asec-sweep`/`renderSweep`; arithmetic in **`sweep-lib.php`**, gated by
  **`test-sweep.php`** + ui-test-money §7 + a11y/layout scenes). Square settles into
  one bank account and LATER direct-debits it again when a damage deposit is
  refunded, crediting back the fee on that portion at the same time — so the cash
  that LEAVES on a refund is the same net figure that ARRIVED for that deposit, and
  the ring fence is **deposit − its share of the fee**. Ring-fence the gross and
  money sits idle; ring-fence nothing and the account goes short.
  **WHY A FEE SHARE AND NOT THE FEE.** pay.php charges rental + deposit as ONE
  Square payment but records the RENTAL only in `payments.amount` (the deposit
  lives on `hold_*`), so the stored `fee` belongs to a bigger gross than the row it
  sits on. Measured on the canonical case — £900 + £75 charged together, £17.06 fee
  — the deposit's share is £1.31 and £73.69 really leaves; using the fee as-is
  ring-fences £57.94 and leaves the account **£15.75 short per deposit**. The rate
  is OBSERVED from the last 200 settled charges (clamped 0.5–5%, default 1.75%) so
  it follows a Square rate change with no edit, and an unsettled charge (`fee` NULL
  for a day or two) is estimated from it rather than assumed fee-free.
  Four judgements worth keeping: the liability is deliberately **NOT tax-year
  filtered** (unlike `held_deposits` right above it in accounts.php — "what is
  still owed back" has no year), it rides the payload Income & tax already fetches
  so the screen costs no extra round trip, a failed query sets `error` and the
  screen says **"couldn't work out"** rather than a confident £0 that would invite
  moving money that isn't there, and an account already below the ring fence
  reports the **SHORTFALL** instead of "safe to move: £0". The BALANCE is typed in
  and deliberately never stored — there is no bank feed and a remembered balance is
  stale the moment it is saved — but the liability IS cached, so a keystroke costs
  no request (gated). NB the returns subquery is case-folded (`UPPER(r.status)`)
  like the file's other two ledger queries: a lowercase `'failed'` counting as
  already returned would understate the ring fence, the expensive direction.
  **PER TRANSACTION** (`sweep_txn`/`sweep_txn_totals`, `deposit_liability.transactions`)
  — the same question asked of each settled charge, because that is how a Square
  payout list reads: this £975 landed, £73.69 of it is going back out, so the rest is
  the owner's. The identity that makes it simple, asserted in the gate: **movable is
  always the RENTAL portion net of its own share of the fee**, since every penny of
  the deposit either has left already (`alreadyOut`) or is still to (`ringFence`) — so
  a charge carrying no deposit needs no special case, it is just movable in full less
  the fee. The one hazard is the LINKAGE: a deposit rides the guest's FIRST payment
  (`bookings.hold_payment_id` = `payments.square_payment_id`), so a later balance
  payment on the same booking must hold NOTHING back or the same £75 is ring-fenced
  twice. That is runtime PHP a static scan cannot see — **test-integration §10(e) is
  where it is really gated** (break-tested: forcing `$carried = true` fails it), and
  the query's window is `recent OR still holding a deposit`, because an old charge
  with money still to go back is exactly what must not fall off the end. The movable
  TOTAL is of those payments and says so on screen — it is NOT the account balance,
  which also holds older money and whatever has already been moved or spent, so the
  typed-balance answer stays the authoritative one. Note the deposits list and the
  transactions list overlap but are not redundant: a deposit whose carrying charge
  predates the ledger has no `payments` row and appears only in the former.
  The observed rate now adds any deposit that rode a charge BACK into its gross
  (`payments.amount` is rental-only while its fee covers both), because reading
  `amount` as the gross biased the learned rate HIGH on exactly the charges that
  carry deposits.
  **THE SAME BUG ON THE WAY OUT, AND ITS FIX** (`sweep_outstanding`, gated by
  test-sweep + test-integration §10(f)). `return_deposit` marks `hold_status='returned'`
  the moment a refund is ISSUED — but Square's refund starts PENDING and the bank debit
  lands a day or two later, which is why `reconcile_pending_refunds()` exists. So
  "returned" does NOT mean "gone", and the liability query dropped the money out of the
  ring fence while it was still in the account: refund £73.92, be told £73.92 more is
  movable, go short on Thursday. A return now only reduces the liability once it has
  SETTLED (`COMPLETED`, or `MANUAL` — booked by hand is settled by definition); a
  NULL/unrecognised status counts as PENDING, because unknown must not be promoted to
  gone on a money screen. The one thing that must not happen is fencing money FOR EVER
  on a row nobody will confirm — the owner could never clear it — so a pending return
  older than 14 days is assumed landed (`ret_stale`). NB where that column actually
  bites is a booking still `charged` with an old unconfirmed PARTIAL return: for an
  already-`returned` booking the WHERE clause decides it, which is why the first
  integration break-test for it did not fire and a second fixture was added.
  **AND THE OWNER CAN SAY SO THEMSELVES** (`confirm_return_settled` in bookings.php,
  `confirmReturnSettled` in admin.js; gated by test-payrail + ui-test-money §7). The
  14-day `ret_stale` escape is the floor, not the answer: Square's API can lag what the
  owner is already looking at, and it did — reported live, a deposit refund had come out
  of the Square balance (never having reached the bank) while the row still said our
  records had not seen it settle. The confirm button on that row is the owner asserting a
  fact they have VERIFIED, so the ledger stops fencing money that has gone. `MANUAL` is
  the existing word for "settled by hand" and both `ret_settled` and `damages_returned`
  already treat it as settled, so nothing downstream changed. Deliberately narrow: it
  only ever moves a NON-TERMINAL `damages_return` to MANUAL — it cannot resurrect a
  FAILED refund, touch a rental charge, or invent a return that was never issued — and
  it asks first, in terms of what the owner can check ("has it actually left your Square
  balance") with the CONSEQUENCE stated, because under-fencing is how the account goes
  short. The row's pointer at the page-level "Check Square now" is suppressed when the
  row has its own button, or one job reads as two.
  **"DECIDED" IS ONE DEFINITION, AND NOTHING MAY WALK A ROW BACK FROM IT**
  (`payment_status_terminal` / `PAYMENT_STATUSES_TERMINAL` in db.php). Building the
  confirm surfaced that a `MANUAL` row would still be polled by
  `reconcile_pending_refunds()`, Square would answer `PENDING`, and the confirmation
  would silently reverse itself — the poller undoing the owner precisely because
  Square's API being behind is the whole reason they confirmed. Auditing that found the
  same hole already open on a path nobody had connected to it: **Square's events arrive
  out of order**, so a late `refund.updated` carrying PENDING could overwrite a
  COMPLETED row and put money that had already gone back into the ring fence. So the
  poller now excludes MANUAL *and* guards its write (a row can settle between the SELECT
  and the UPDATE), and the webhook's write carries the same guard in SQL. FAILED and
  REJECTED are terminal too: not "settled" in the money sense — `damages_returned` and
  `ret_settled` both exclude them — but DECIDED, and a later PENDING must not resurrect
  a refund known not to have gone. A terminal status may still be corrected to another
  TERMINAL one (a refund that later FAILS is news the owner must have), which is why the
  guard tests the INCOMING value and not the stored row alone.
  **UNKNOWN IS ITS OWN ANSWER.** `payouts_landed` returns true/false/**null** — an
  unrecognised status, a missing or malformed `arrival_date`, a charge absent from the
  payout data. Null money gets its own figure ("Square hasn't said · not counted as
  movable") rather than being rounded into movable (which invites moving it) or into
  on-its-way (which invents a date). A FAILED payout sits there too — and separately
  becomes a **DUTY**, because bad bank details stop every later transfer; it and the
  disputed total ride `admin-bootstrap.php`'s payload (the `$feeds` precedent), so
  neither costs a request of its own.
  **MONEY UNDER DISPUTE IS FENCED** beside the deposits (`payouts_disputes_open`, open
  states only: WON kept the money, LOST/ACCEPTED already took it, so fencing either
  holds the same money back twice). A dispute read that FAILS says so and states that
  nothing disputed is included — never reading as "none".
  **LIVE, NOT NIGHTLY.** `payout.sent`/`payout.paid`/`payout.failed` (and `dispute.*`)
  webhooks refresh the cache, plus the daily cron and an explicit "Check Square now".
  NB adding those events makes an EXISTING install report as not-connected until
  "Connect automatic payment updates" is re-run — the intended prompt, since the
  subscription genuinely lacks them.
  **THE BALANCE IS DATED, NOT REMEMBERED.** There is no bank feed, so a bare stored
  figure would be stale — but "£2,000 on Tuesday" plus what Square has paid in and
  taken back since is a RUNNING figure with its basis stated
  (`payouts_balance_estimate`; internal key **`sweep-balance`**, written through the
  ordinary content save, so no new endpoint). It refuses to roll a balance older than
  30 days forward, counts only movements strictly AFTER the stated instant, never
  counts a FAILED payout as arrived, and is always labelled an ESTIMATE with a
  correct-it field. `__sweepBalTouched` stops a re-render overwriting what the owner is
  mid-way through typing.
  **AND WHAT THE OWNER HAS ALREADY MOVED OUT IS RECORDED, because nothing else can
  tell this screen** (`payouts_moved_map`, `SWEEP_MOVED_KEY` `sweep-moved`, a fourth
  **`moved`** bucket in `payouts_split_totals`; client `sweepMovedMap`/
  `sweepMarkTransferred`/`sweepUnmarkTransferred`). Square reports what it paid IN and
  has no idea what left the bank afterwards, so without this the same £294.75 is
  offered as movable on every visit until a fresh balance is typed. Two halves:
  **AUTOMATIC** — `sweepRememberBalance` marks everything Square has already paid in,
  because a stated balance is the truth about the account at that instant and therefore
  already contains it (the same reasoning `payouts_balance_estimate` uses when it counts
  only movements strictly AFTER the stated instant); and **MANUAL**, at two grains.
  **PER BOOKING** (`sweepMarkOneTransferred`) is the everyday one — a tick on each row
  of the movable group, because a payout usually goes on its own and the only way to say
  so used to be marking the lot and putting the rest back. It carries NO confirm,
  deliberately: the row directly above it names the guest, the date and the figure, so
  the tap is unambiguous in a way the set-level one is not, and the undo sits in the
  group below. Its `aria-label` names whose money it is — "I've transferred this one"
  repeated down a list is a name that identifies nothing. **THE WHOLE LOT**
  (`sweepMarkTransferred`, on the answer card) keeps its confirm, because it acts on a
  set you cannot see from where it sits, and it renders only at **≥2** landed charges:
  with one, "I've transferred all 1" is the row's own tick wearing a worse label — the
  same judgement the bulk chase makes under two owers. It also names the count, or
  beside per-row ticks it reads as "the one I was looking at". Rules, each break-tested: **only a LANDED charge can have been transferred**
  (money Square has not paid out cannot have left the bank, so a stale mark on `onWay`
  or `unknown` money is ignored rather than quietly removing it from the figure); a mark
  is KEPT AND SHOWN in an "Already transferred out" group with a per-row undo, never
  dropped, because "you already moved this" is a different statement from "Square never
  paid it" and a memory can be wrong; and there is **ONE recording action per state** —
  `!hasBal` gates the manual button, since with a balance typed the headline is the
  BALANCE's figure while the button confirms `P.inBank` (measured at £2000: "transfer
  out £1852.62" over a dialog asking to mark £294.75, a different number for the tap
  directly beneath it) and "Remember this balance" already does the marking there.
  NB the server sends the WHOLE stored map back as `payouts.movedMap`, and the client
  amends THAT: rebuilding it from the `moved` ROWS on screen — which are only the marks
  whose charge is still inside the payout window — makes recording or undoing one
  transfer silently forget every older one. Owner-written JSON reaching money
  arithmetic, so the read sanitises (non-JSON, a scalar, an empty id or a
  zero/non-numeric timestamp all degrade to "nothing marked") and caps at
  `SWEEP_MOVED_MAX` 200, newest kept. Gated by test-payouts (the bucket, the sanitiser,
  the cap, AND the wiring — reverting accounts.php's call site failed nothing until that
  check existed, the helper-tested-alone trap again) + ui-test-money §7.
  Also: **`payouts_money()` refuses a non-GBP amount** rather than mixing currencies (a
  foreign fee reads as unknown, not wrong); payout-level transfer fees (instant
  deposits) are reported, never apportioned per charge; the 90-day/30-payout caps are
  declared on screen (the no-silent-caps rule); and search ANSWERS "how much can I move
  out" in the window (`CHB_SWEEP_Q` → `cmdkSweepMerge`, stamp-guarded like
  `cmdkPricingMerge`) instead of linking to the screen that holds the answer.
  **`payouts_refresh()` IS DRIVEN FOR REAL IN CI** — test-payouts stubs `square_api`,
  `square_enabled`, `content_value` and `content_set_scalar` BEFORE the require, so the
  code that EXTRACTS Square's response shape is exercised with no network. That was the
  one untested part, and its failure mode is silent: wrong nesting → empty map → every
  row reads "Square hasn't said", which looks like a legitimate state.
  **HAS IT ACTUALLY REACHED THE BANK?** (**`payouts-lib.php`**, gated by
  **`test-payouts.php`** + ui-test-money §7.) sweep-lib works out how much of a
  charge is the owner's; it cannot know WHEN it arrives. Square settles a charge and
  pays out a day or two LATER, so the first version of this screen listed a charge
  taken the SAME DAY as £604.05 movable — money that was still with Square. Square's
  **Payouts API** answers it exactly (`GET /v2/payouts` → status `SENT`/`PAID`/
  `FAILED` + `arrival_date`; `GET /v2/payouts/{id}/payout-entries` → one line per
  activity with the REAL `fee_amount_money` and `type_charge_details.payment_id`).
  Scope `PAYOUTS_READ`, which the app's Developer-Dashboard access token already
  carries (scopes are not granted per authorisation as with OAuth) — and if it does
  not, the 403 is NAMED ("the access token can't read payouts") rather than showing
  an empty screen. Two things are taken from it and only two: **landed vs on its
  way**, and the **actual fee** per charge, which replaces the observed-rate
  estimate — `payouts_apply` runs BEFORE `sweep_txn_totals` or Square's figure is
  decoration (gated). A wider reading of the entries (refunds, disputes,
  adjustments) was deliberately left out: our own ledger already tracks deposit
  returns and a second source for the same fact is a way to double-count it. NB the
  CHARGE-type filter is load-bearing, not defensive — an `ADJUSTMENT` entry can
  carry `type_charge_details` too, and arriving after the charge it would overwrite
  the real fee (break-tested; the first version of that check was vacuous because
  the fixture had no such entry).
  **A DEPOSIT IS HELD FROM THE MOMENT THEY BOOK, so "not arrived" is its own state.**
  The deposit is charged with the first payment, which can be months before the stay —
  so the card carries FOUR states, not three, and saying "Still staying" of a guest whose
  booking starts in a month was the second wrong thing said about the same row. The
  liability payload now sends `check_in` beside `check_out` (it cannot be told from the
  checkout alone), and each row leads with the date that matters to it: `arrives` before
  the stay, `leaves` during it, `left` after.
  **AND "WAITING FOR SQUARE" WAS AN ASSERTION NOBODY HAD CHECKED.** A deposit refund
  sat reading "Already refunded - waiting for Square to take it" when Square had ALREADY
  taken it (out of the Square BALANCE, since that money had never reached the bank).
  Two causes. The wording claimed something about Square that nothing had asked - it now
  says what our ledger knows ("Refunded - not yet confirmed settled here") and points at
  the control that asks. And `reconcile_pending_refunds()` ran from the Recent-payments
  view and the daily cron ONLY - never from Move money out, never from "Check Square
  now" - so a refund could stay non-terminal until the 14-day `ret_stale` line gave up
  and assumed it. The owner's explicit refresh now reconciles refunds alongside the
  payouts, which is the fair place for it under the no-page-waits-on-Square rule.
  **THE RING FENCE IS NOT A TO-DO LIST.** The deposits card was headed "Deposits still
  to return" over THREE states, two of which are no such thing: one already refunded and
  waiting for Square to debit it (the ROW said so while the heading contradicted it) and
  one whose guest has not left. Every row also read `left <date>` unconditionally, so a
  guest checking out on 31/08 was reported as having LEFT on a date a month away
  (reported from the live account). The card describes what is FENCED, so it is
  "Deposits still held" and each row states its own case — already refunded / still
  staying / ready to return — with the date tensed to match (`left` vs `leaves`, and
  "leaves today" on checkout day, since the guest is in until the checkout time). The
  headline sentence above it carried the same false claim and was fixed with it. The real
  to-do is elsewhere and was already correct: `chbDuties` and the assistant's "deposits
  to return" answer both gate on `hasCheckedOut()`. Gated by ui-test-money, all three
  states break-tested.
  **EVERY SQUARE READ IS SCOPED TO ONE LOCATION** (`square_location_id()` in db.php,
  internal key `square-location`; gated by test-payouts + test-bank + ui-test-money).
  Omitting `location_id` does NOT mean "everywhere" — Square's own words on ListPayouts:
  *"By default, payouts are returned for the default (main) location associated with the
  seller"*. So on a multi-location account the app asked about the WRONG SHOP and got a
  confident, complete-looking empty answer: measured live as sixty days of "Square hasn't
  reported any payouts at all" on a business whose money was moving the whole time under
  a location called **Online CHB**, and a bank account named from a different location
  entirely. Both `/v2/payouts` and `/v2/bank-accounts` now send it, the cache records
  WHICH location its answer is about, and the sweep screen SAYS so — but only when there
  is more than one location, because with one there is no other shop it could have meant.
  The picker (Manage → Payments) is likewise hidden unless there is a genuine choice, and
  is driven by **`square-setup.php`'s `status`** — the call that screen already makes.
  It first read `__sweepLiab`, which only the MOVE-MONEY-OUT screen fills, so opening
  Settings the ordinary way left it null and the card hid itself EVERY time: a control
  that could not appear. The gate for it drives `openArea()`/`settingsOpen('payments')`
  rather than calling the renderer, because calling the renderer is precisely what hid
  the bug. `status` falls back to a live `/v2/locations` when the cache has none yet, so
  the picker works on the first open rather than after a cron. The
  location list rides the bank refresh (`/v2/locations`, scope `MERCHANT_PROFILE_READ`),
  so Settings never waits on Square, and changing it re-fetches at once rather than
  leaving figures gathered for the old location on screen. A config const
  `SQUARE_LOCATION_ID` wins if set; unset keeps Square's own default AND says that is
  what it did.
  **IS THERE ANYWHERE FOR THE MONEY TO GO?** (**`bank-lib.php`**, gated by
  **`test-bank.php`** + ui-test-money §7.) The "no payouts at all" sentence had to END
  in a guess — "usually a Square-side setting (payouts paused, or no bank account
  linked)" — because nothing in the app could see the bank account. Square's **Bank
  Accounts API** answers it: `GET /v2/bank-accounts` (scope `BANK_ACCOUNTS_READ`), and
  `bank_read()` turns the reply into ONE state — `ready` / `verifying` / `blocked` /
  `none` / `unknown` — which the screen renders as a fact ("No bank account is linked to
  Square, so there is nowhere for it to pay out to" / "Barclays ending 4471 is linked and
  verified, so the hold-up is something else"). **READY means VERIFIED *and*
  `creditable`**, and those are not interchangeable: `creditable` is the direction Square
  SENDS money, `debitable` the direction it takes; an account it can only take from pays
  out nothing. A missing flag counts as NOT creditable — claiming an account is ready is
  the assertion that misleads. **IT CANNOT SAY WHICH ACCOUNT SQUARE PAYS INTO, so naming one is only honest when
  there is ONE.** Square keeps a single primary payout account and `ListBankAccounts`
  does NOT flag it — there is no default/primary field, and `primary_bank_identification_number`
  is a SORT CODE that reads deceptively like one. The first version picked the first
  VERIFIED+creditable row and asserted it: reported live, it named a **Lloyds** account on
  a business paid out to **Monzo**. `bank_read` carries `all` (every account with its own
  verdict) and the screen lists them with the states — "2 bank accounts linked (Lloyds
  ending 968, Monzo ending 1234 — still being verified). Square does not say which one it
  pays into" — while a lone account is still named plainly, because that claim is fair.
  **A CUSTOMER'S BANK ACCOUNT IS NEVER THE OWNER'S**: `ListBankAccounts` returns customer
  accounts alongside the seller's, told apart by `customer_id`, and `bank_slim` drops them
  — naming a GUEST's bank on the owner's money screen is worse than any confusion this
  file prevents. Excluding on `customer_id` rather than requiring `location_id` is the
  safe direction: it only drops rows we are certain belong to someone else.
  **`unknown` is the load-bearing state**: a 403 on the
  scope falls back to the OLD hedge and never to "you have no bank account", because
  failing to ask and being told there are none are different facts and only one of them
  alarms the owner about their own banking. Cached under the INTERNAL key `square-bank`
  (slimmed to five fields — the holder name and sort code stay out of our content
  table), refreshed by the daily cron, by the owner's "Check Square now" (which now asks
  both halves of the same question) and live by the `bank_account.created/verified/
  disabled` webhooks. NB adding those events makes an EXISTING install report as
  not-connected until "Connect" is re-run — the same intended prompt the payout events
  caused. **AND THERE IS STILL NO BALANCE ENDPOINT** — confirmed with Square (their
  developer advocate, Aug 2024, reaffirmed Feb 2025: "the ability to get the current
  balance for a location within a Square account isn't currently possible"), so the
  typed-balance design stays; don't go looking for one again.
  **AND UNKNOWN SAYS WHY.** The unknown group's note claimed the charges were not in
  the payout data **YET** — asserting a temporary wait the screen has no basis for.
  Reported from the live account: payouts checked THAT DAY, no error, two charges
  unknown and one of them 23 days old, which Square (1–2 working days) should long
  since have paid out. The fact that explains it was already in the payload and
  `renderSweep` never read it — `payouts.known` is how many charges the payout data
  covers AT ALL. Two states now read differently: `known === 0` says Square reported no
  payouts at all in the window (a Square-side setting — payouts paused, no bank account
  linked — not a delay), and `known > 0` with a charge over **7 days** old says it
  should have shown up by now. A charge taken today raises neither. The window is sent
  as `payouts.lookback` from `PAYOUTS_LOOKBACK_DAYS` rather than re-typed in JS. Gated
  by ui-test-money §7, all three states break-tested.
  **UNKNOWN IS ITS OWN ANSWER.** `payouts_landed` returns true/false/**null** —
  an unrecognised status, a missing or malformed `arrival_date`, a charge absent
  from the payout data. Null money is reported as its own figure ("Square hasn't
  said · not counted as movable") rather than rounded into movable (which invites
  moving it) or into on-its-way (which invents a date). A FAILED payout lands in
  the same bucket for the same reason: it is not arriving, so saying it is due
  would be a lie. `arrival_date` on the day itself counts as landed.
  **NOTHING WAITS ON SQUARE.** The fetch is the daily cron (`self-repair.php` §0b,
  only when `payouts_stale`) plus an explicit "Check Square now" — accounts.php may
  only READ the cache (gated), because a page that blocks on a payment API is the
  poor-signal bug again. Cached under the INTERNAL content key **`square-payouts`**;
  a failed refresh KEEPS the last good copy and records why, so the screen says
  "payout data may be out of date — …" instead of showing no payouts as though
  nothing had settled. With no cache at all (Square off, or before the first cron)
  the flat list still renders with the caveat stated. The "these are payments, not
  your balance" sentence is one const used by BOTH branches — it was dropped from
  the split view in the first draft and ui-test-money caught it, but only after the
  check was re-aimed: it had been reading the fallback branch, where the sentence
  still was.
- **THE STATUS PAGE HAS A WAY IN.** `/status` had no link anywhere in the app —
  the one page you want when something looks wrong could only be reached by
  typing the URL. It is now a card in Manage → System check and a footer link,
  both REAL `href`s opening outside the SPA router: it is the page you check when
  *this* app is misbehaving, so it must not be reached through it.
- **THE ASSISTANT HAS NO PAGE.** `#cmdk` is delivered straight to `<body>` by the
  `data-host="body"` template in admin-views.html. It used to be injected into an
  empty `<main id="view-search">` shell that existed purely as a delivery address
  — because a `.page-view` carries a transform and would trap the fixed pop-out,
  `cmdkEnsureOverlay()` re-parented it to body immediately, leaving a page whose
  own gate asserted it must stay EMPTY. Shell, `ADMIN_VIEWS` entry and the dead
  `HUBS` title are gone; `ui-test-adminviews` now asserts the shell is ABSENT
  rather than empty. `data-host` is explicit, never a fallback for a missing
  host — a genuinely absent shell must still fail loudly.
- **A PAGE THAT OPENS INSTANTLY MUST SAY IT IS STILL FILLING IN** (`adminLoading`)
  — the other half of the poor-signal work below. Measured: Payments rendered 323
  characters of static index rows with the money dashboard blank and no loading
  word anywhere, which reads as broken. And `openArea` now opens its SECTION
  before the two round trips, repainting after — but skips the repaint while the
  owner is typing in that panel, because these are input-heavy screens and a
  repaint lands on half-entered text (the bank-details rule).
- **"HELD" IS THE LEGACY WORD.** The damages deposit is CHARGED with the first
  payment and refunded after the stay; every guest- and owner-facing string says
  so. Three admin strings and a CSV header still said "held" and were changed.
  The ONE place it stays is `app.js`'s `authorized/captured/released/expired`
  branch — the legacy Square card-HOLD flow, where "held on your card (not
  charged)" is the truth. Check which era a string belongs to before rewording it.
- **A FAILED WRITE MUST NOT RETURN AS THOUGH IT WORKED.** `saveContent()` caught
  its error, showed the owner a `glassAlert`, and then returned NORMALLY — so it
  told the USER the save had failed and its CALLER that all was well. **14 call
  sites wrap it in a try/catch that could therefore never fire**, and every one of
  them updates a local mirror or a status line "after a successful save": the bank
  details, the deposit percentage, a cleared map pin all adopted values the server
  had rejected, and reverted on the next load. It RETHROWS now (the alert stays —
  it is the one message the owner sees wherever the caller is), which makes those
  14 handlers real in one edit. The 10 fire-and-forget callers opt out explicitly
  with `.catch(() => {})` rather than being left as unhandled rejections. Gated by
  ui-test-poorsignal §9. NB `clearGeo` was the one that surfaced it — it fired the
  save unawaited and printed "Not set" regardless, so the owner believed they had
  cleared a cottage's map pin when they had not.
- **KEEPING LAST-GOOD DATA IS THE RULE, NOT THE EXCEPTION.** Auditing for
  `loadData`'s shape found three more caches that emptied themselves in the catch,
  and each lie is different: `loadExpenses` reported the year's expenses as ZERO,
  and Income & tax subtracts expenses from income, so the headline **net profit
  came out too HIGH**; `loadBookingEmailLogs` showed no emails ever sent to a
  guest, inviting a duplicate send; `loadDepositReturns` made a PARTIALLY returned
  damage deposit reappear in "Deposits to return" at its full collected figure (the
  server caps the refund at what is actually left, so no money can go out twice —
  the damage is a wrong number and a wasted trip). All keep the last good copy now.
- **ONE WAY TO SHIFT A DATE: `ukShiftDays(iso, n)`** (app.js, beside `todayDashed`).
  The pattern it replaces — local `setDate()` formatted through `toISOString()` —
  mixes two clocks and lands a day early between 00:00 and 01:00 BST, i.e. it is
  wrong for one hour a night and right whenever you test it. Anchored at UTC NOON
  so the DST hour cannot move the calendar date. Two sites used the broken shape:
  the teach-loop's 7-day window (silently 8 days for that hour) and the test
  centre's demo-booking dates. Gated in smoke-test §5 across both DST transitions,
  a leap day and a year end. NB a `new Date(iso + 'T00:00:00Z')` round trip through
  `toISOString()` is FINE and several sites do it — the bug is only local-in,
  UTC-out.
- **A POOR SIGNAL MUST NOT MOVE THE OWNER** (gated by `ui-test-poorsignal.js`,
  which stalls then DROPS the data endpoints — what a dead mobile link does, not
  a 500, which was already handled). Reported from a phone: "I click on a page
  and if the signal is poor it reverts me to an old page and doesn't slow load
  the new page." Two independent causes, both reproduced:
  **(1) `loadData()` DESTROYED good data on a failed fetch** — each of its
  bookings/enquiries/blocks tasks emptied its own store in the catch, so ONE
  dropped request didn't merely fail to refresh, it wiped the back office's
  memory. Everything downstream then rendered as though the business had no
  bookings (empty Today, empty calendar), and the booking the owner had just
  tapped genuinely wasn't there any more — which is the "reverts me to an old
  page" they actually saw. It now KEEPS the last good copy (the `loadContent()`
  rule) and **RETURNS `{ok, failed[]}`**. NB it isolates each task's failure so
  one dead endpoint can't stop the others, which means it **never rejects** — a
  `try/catch` around `await loadData()` is dead code, and callers that need to
  tell "couldn't load" from "isn't there" must read the RETURN. (The old clear
  was never logout hygiene: `forceAdminLogout` doesn't clear these stores and
  never did, and nothing renders them outside owner-mode.)
  **(2) Openers awaited the network BEFORE navigating** — `openAccounts` and
  `openBookings` both did, so the tap looked dead for the length of the request
  and, on a drop, `openAccounts` threw a blocking `glassAlert` and left the owner
  on the page they were trying to leave (measured: 9s of nothing, then the
  alert, still on Today). **Navigate first, load second**: the tax-year list is a
  dropdown ON the Payments page, not permission to show it.
  Consequently `openBookingHub`/`openEnquiryHub` no longer collapse "the reload
  failed" into "the record is gone" — that told the owner a booking was deleted
  when it was fine, then bounced them off it. A network failure says so and stays
  put, with a Retry via `toast`'s third `action` argument (its timer pauses on
  hover/focus, so the affordance survives a slow reader). `adminNetFail(retry)`
  is that message stated once. NB `loadAdminBundle()` was already right — it
  retries twice and clears `__adminBundlePromise` so the next tap re-tries — and
  so was the stale-admin check, which explicitly refuses to log anyone out on a
  network error ("don't log out on uncertainty"); neither needed touching.
- **PUSH CARRIES ITS OWN MESSAGE NOW, AND EVERY DEVICE GETS IT.** Two bugs in one
  design. (1) **First device wins**: `alert_owner()` wakes EVERY admin device, and
  `owner_ping_take()` DELETED the stash on read — so the first device to fetch
  consumed the message and every other one fell through to "You have a new
  notification". An owner with an iPhone *and* an iPad got the real text on exactly
  one, at random. `owner_ping_read()` / `guest_ping_read()` never delete; freshness
  does the job instead (a ping older than 5 min is ignored, which also stops a push
  delivered days late from picking up an unrelated current message). (2) **The text
  needed a network round trip and a live admin session at the moment the
  notification fired** — `sw.js` fetched `push.php?action=sw_notify`, which requires
  `$_SESSION['admin_id']`; on poor signal or an expired session the owner got the
  generic line, and iOS gives a service worker only a short budget to show
  something. Pushes now carry an **encrypted payload** (RFC 8291 aes128gcm,
  `wp_encrypt_payload` — pure openssl + `hash_hkdf`, no Composer), so the message is
  already in hand. The stash stays as the FALLBACK for subscriptions stored before
  `p256dh`/`auth` were captured, and `send_webpush` **retries payload-less on
  400/413**, so a push service that dislikes the body degrades to exactly the old
  behaviour rather than dropping the alert. TTL is per-message (was a flat 28 days —
  wrong for anything time-sensitive) and `Urgency: high` is sent, because Apple
  batches low-urgency pushes. Gated by **test-webpush.php** (31 checks, CI-wired,
  deploy-excluded): RFC 8291 §5's worked example encrypted with a pinned salt +
  application-server key, framing asserted against the RFC's own values, then
  decrypted back with the RFC's user-agent private key. Break-tested — corrupting
  the HKDF salt AND swapping the two public keys in `key_info` both fail the
  round-trip, which is what makes it more than a self-consistent mirror.
- **A TAPPED ALERT LANDS ON THE RECORD, AND ALERTS NO LONGER ERASE EACH OTHER.**
  `alert_owner` hardcoded `url => './'` and `tag => 'chb-owner'` for every alert, so
  "Payment received — £900" dropped you on the back-office root to go and find it
  yourself, and the *second* notification REPLACED the first (two enquiries showed as
  one; a payment could erase a message). It now takes an `$opts` array —
  `url`/`category`/`tag`/`email`/`reload` — every trigger passes `./?open=booking-42`
  etc., and the tag is per-record so distinct alerts stack while repeats of the same
  record still collapse. `maybeHandleNotificationOpen()` (app.js) reads `?open=`,
  routes through the **facade stubs** (never admin globals — arriving cold from a
  notification is the case the stubs exist for) and `history.replaceState`s the URL
  clean, mirroring `?unsub=`. The stash carries url+tag too, so the fetch fallback
  lands in the same place. NB the enquiry call site names its id `$enqId`, not
  `$enquiryId` — checked, because a wrong variable there is a silent `?open=enquiry-0`.
- **NOBODY LISTENING IS NOT THE SAME AS NOTHING TO SAY.** `alert_owner` always
  returned the device count and only the test button ever read it, so with permission
  revoked or the last subscription pruned "Payment received" went nowhere and nothing
  said so. `'email' => true` (a failing calendar sync, the check-out tap, the arrival
  email to review, the statement reminder: alerts with no email of their own) falls back
  to an email per person whose devices it did not reach (see round 7's notifications).
- **WHAT INTERRUPTS YOU IS A SETTING.** `notify-prefs` (internal content key,
  classified in db.php) carries per-category mutes + quiet hours; `notify_should_push()`
  gates the PUSH and, since round 7, its email fallback; the activity log and the duties
  are untouched, so muting loses nothing from the app, and `'urgent'` (a sync failure that can double-book you)
  ignores both. Quiet hours **wrap midnight**, which the obvious between-test gets
  wrong: 22:00–07:00 is quiet at 02:00. The settings UI reads
  `adminPrivateContent` FIRST (the bacs-details rule — an internal key is absent from
  the anonymous boot GET, so reading `siteContent` would render every toggle at its
  default over real saved settings, one change from wiping them).
- **A FOCUSED WINDOW GETS A SILENT NOTIFICATION, NOT NO NOTIFICATION.** Showing
  nothing looks like the right answer and is not: the subscription is
  `userVisibleOnly`, so a push that displays nothing invites the browser's own "site
  updated in the background" notice and repeat offences can cost the permission.
  `silent: focused` + `renotify: !focused` keeps the promise and drops the buzz.
- **THE BADGE COUNTS DUTIES, NOT ENQUIRIES.** `refreshInboxBadge` sets the
  enquiries-based count only while `__ADMIN_LOADED` is false; once the bundle is in,
  `renderNeedsYou()` badges `items.length` — the same list the strip renders, so the
  icon and Today can't disagree.
- **iOS SPECIFICS THE BACK OFFICE NOW RESPECTS.** `navigator.setAppBadge()` puts the
  pending-enquiry count on the Home Screen icon (iOS 16.4+, installed PWAs) — the
  one surface the owner sees without unlocking into the app, and the count was
  already computed for three in-app pips, so `refreshInboxBadge()` just calls
  `setAppBadgeCount()`. Owner-only, or a guest would see a stray red dot. **iOS only
  allows web push from an installed app**: enabling it in a Safari tab silently
  never works, so `enableOwnerPush()` detects `isAppleTouchDevice() &&
  !isStandalonePwa()` and says to Add to Home Screen instead of failing quietly (NB
  iPadOS 13+ reports itself as a Mac — the touch-point count is what catches an
  iPad, and `navigator.standalone` needs a cast, being absent from the DOM typings).
  And **a push subscription is not forever** — iOS drops it when the PWA is removed
  and re-added, leaving permission granted and nothing arriving; `revalidateOwnerPush()`
  re-checks on admin boot and silently re-subscribes. It never prompts.
- **A BOOKING INSIDE THE BALANCE WINDOW IS ASKED TO PAY IN FULL.** `PAYMENT_BALANCE_DAYS`
  (30) is the deposit-then-balance schedule, and `payment_balance_days()`'s own comment
  always said "full-amount-upfront if a booking is approved inside the window" — but
  only ONE of the paths that ask for money implemented it. `enquiry-actions.php` did it
  on approval; **`bookings.php`'s `request_payment` took `kind` from the CLIENT and
  defaulted to `'deposit'`**, so a booking made close to arrival and chased from the
  booking hub emailed *"Pay your deposit — £X"* for 25%, while the banner the owner had
  just tapped read *"Nothing received yet — £Y due"* with the FULL figure. The guest
  then gets chased for the rest days later. `booking_within_balance_window($b)` /
  `booking_payment_kind($b, $requested)` (pricing.php) are that rule stated ONCE;
  enquiry-actions.php now calls them instead of its inline copy, `bookings.php` derives
  the kind rather than trusting the caller (and stamps `balance_requested_at` so
  payments-due.php can't double-ask), and **`pay.php` upgrades the kind too** — the
  amount was always server-derived, and now the kind is, so an older emailed deposit
  link opened inside the window charges the full amount rather than 25%. Only ever
  upgrades, never downgrades; the legacy `'hold'` flow passes through untouched, and
  outside the window a deposit is still a deposit (asserted, so the fix can't become
  "always charge everything"). The boundary is `< payment_balance_days()`, gated from
  both sides. Gated by **test-payrail.php** (13 new checks: window behaviour, both
  boundary sides, hold passthrough, missing check-in, plus a WIRING scan of all three
  endpoints — each break-tested, including restoring the client-trusting line).
- **AN ASK AND ITS CHASE QUOTE THE SAME SUM** (`payment_money_facts`, gated by
test-payrail). `send_payment_request` and `send_payment_reminder` chase the SAME money
and were composed independently, so they disagreed: driven with a £50 deposit
outstanding, the request said "so **£340.00** will be charged to your card today"
(rental + the refundable deposit, which `pay.php` really does bundle) while the
reminder — the one sent again and again until the guest pays — said only "£290.00".
Both are handed the same payload by the shared sender; the reminder simply ignored
`damages`. One composer now states what is being charged now, what the deposit adds,
what is already paid and the full stay total, and both emails render from it.
**`alreadyPaid` was computed and thrown away**: `booking_amount_due` returns it, the
payload never carried it, so no email could tell a part-paid guest what they had put
down. It is carried now and shown only when there IS something paid — "£0.00 already
paid" on a fresh ask is noise. The other guest emails were AUDITED and are correct:
the confirmation already does the deposit-aware thing properly (`grand = total +
deposit`, `paid_so_far` includes the charged deposit, balance derived from both — it
is the model the owner side was fixed to match), the receipt distinguishes "Rental
paid so far" from the deposit "(refunded after checkout)", and the enquiry
acknowledgement quotes the total with the deposit explained. The arrival email states
no money by design — chasing is the payments-due cron's job, not its.

**A CHASE EMAIL FOLLOWS THE GUEST'S RAIL** (`payment_rail($b)` in db.php — 'card'
  or 'bacs'). A guest who paid their deposit in cash or by transfer has no use for a
  Square link, and chasing them with one asks them to switch rails mid-booking; they
  get bank details instead. The decision is taken ONCE, so the first balance request
  (`send_payment_request`) and every reminder after it (`send_payment_reminder`)
  cannot disagree about how the SAME guest is asked to settle up — applying it to
  only one would have meant a card link in the first chase and BACS in the
  follow-ups. Read off `bookings.payment_method`, which is FREE TEXT ("Card / Bank
  transfer / Cash …" in the Add-Booking form) except where the site writes it
  itself (pay.php + square-webhook.php both stamp `'Square card'`) — so the test is
  a MATCH, not an equality, and anything unrecognised ("cheque", "paypal") is
  treated as off the card rail, because an owner who typed it meant "not through
  the website". The one value that must stay on card is **EMPTY**: nothing recorded
  means nothing paid yet, and the link is that guest's only way to pay — a fresh
  booking's deposit request is byte-for-byte unchanged. `payment_cta($rail, $payUrl,
  $bacs, $lead)` is the one composer for the "how to pay" half of both emails; the
  BACS branch drops "Powered by Square" (a line about card handling reads as a
  contradiction under bank details) and rewords the refundable-deposit sentence,
  since "…will be charged to your card today" is a CARD sentence and on the transfer
  rail nothing is charged to anything. Bank details live in the INTERNAL content key
  **`bacs-details`** (Manage → Payments), deliberately internal rather than
  private/encrypted-at-rest: the value is printed verbatim into guest emails so it
  is not a secret from its recipients, and encrypting it adds a failure mode with a
  worse outcome than the leak it guards (an unreadable value becomes garbage bank
  details in a guest's inbox). Empty is a legitimate state — the emails then say
  "reply and we'll send them" rather than printing a blank block or falling back to
  a card link the guest has already shown they don't use. The Settings field reads
  `adminPrivateContent` FIRST (content.php `get_all`, refreshed by `openArea()`),
  NOT `siteContent`: siteContent is filled by the BOOT content GET, which is the
  ANONYMOUS one when the page loaded before sign-in, so an internal key would be
  missing and the field would render blank over real saved details, one Save away
  from wiping them. Gated by **`test-payrail.php`** (43 checks, no DB and no SMTP —
  the two `*_body()` builders are pure and take the accent + bank details as
  arguments precisely so the gate drives the REAL composers; testing `payment_rail`
  alone passed with either call site reverted to a hardcoded card button, which is
  break-tested).
- **3-D SECURE NEEDS `frame-src` AND `form-action`, AND THEY MOVE TOGETHER.** 3DS
  step one is the *method URL* device fingerprint: Square's SDK opens a hidden
  iframe in OUR document and POSTs a form to the issuer's ACS. A script-created
  iframe inherits the parent policy, so both directives apply. `frame-src` was
  widened to `https:` when pinning issuer domains broke SCA live
  (`CARD_DECLINED_VERIFICATION_REQUIRED`) — but `form-action` stayed `'self'`, so
  the frame loaded and the POST inside it was blocked. Observed in the owner's
  activity log as `CSP blocked form-action → https://methodurl.vcas.visa.com/…`.
  The issuer then scores the payment with NO device data, which is what turns a
  frictionless auth into a challenge or a decline — the same failure the frame-src
  note records, half-fixed. ACS hosts differ per issuer and are not enumerable, so
  `https:` is the only workable value for both; the trade is small here because
  script-src carries no `unsafe-inline`. Square's SDK also probes
  `spay.samsung.com` (Samsung Pay) — allowlisted, it is a readiness check — and
  reports its own errors to Square's Sentry, which is deliberately NOT allowlisted
  (blocking it costs nothing; CSP exists to stop exactly that). Gated in smoke-test
  §6a-ii-b, which asserts the frame-src/form-action pair together.
- **THE CSP IS A CACHED ASSET — A CSP EDIT NEEDS A CACHE BUMP.** It is a response
  HEADER on index.html, and the Cache API stores headers with the body. `sw.js`
  precaches `index.html` and serves it on any navigation the network doesn't answer,
  so an installed PWA goes on enforcing whatever policy was live when its shell was
  last cached — however many deploys ago. Measured: the form-action fix above shipped
  with "no cached asset changed, so no bump", the live server was serving the new
  policy (curl-confirmed at the domain) and the owner's phone kept reporting
  `CSP blocked form-action → methodurl.vcas.visa.com` from the old one. `bump.js`
  already bumps CACHE on every run, so RUNNING it is the fix; **check-versions.js now
  fails a PR that changes ANY `Header set` directive without bumping CACHE**
  (break-tested by replaying the real base..head of that PR, which fails, and two
  earlier PRs, which pass). Every response header travels the same way, so the rule
  is not CSP-specific. **And what needs a bump is DERIVED, not listed**: the rule
  used to read a hand-written `['app.js','app.css','guest-app.js','guest-app.css',
  'index.html']`, which is a list somebody has to remember to extend — the same
  shape of defect as the CSP not being in any list at all. It now parses sw.js's own
  `CORE` array, so a new precached asset is covered the day it is added (the derived
  list is 9 assets and already includes `logo.svg`, `manifest.json` and the icons,
  none of which the hand-written array covered). A vacuity guard fails the run if
  `CORE` ever stops parsing, so the rule cannot silently cover nothing. NB the
  RUNTIME half of this was already right and needed no change: `startVersionWatch` /
  `startGuestVersionWatch` poll `version.php` and reload when `BUILD` differs, and a
  new CACHE name makes the SW refetch the shell — that machinery simply had nothing
  to detect, because the PR changed no version at all.
- **A CSP-REPORT DE-DUPE KEY MUST NOT CONTAIN THE REPORTER'S IP.** `csp-report.php`
  caps one log per (directive, ip) per hour — and on mobile that limit never fired,
  because a phone rotates its IPv6 address every few minutes (RFC 4941 privacy
  extensions). Measured live: the same `connect-src → spay.samsung.com` block
  logged twice inside three minutes from two addresses on ONE device on ONE page,
  filling "Needs attention". Keyed on the blocked HOST now (host, not full URL —
  payment SDKs put per-transaction ids in the path); the IP stays on the row for
  forensics. Known third-party SDK telemetry is logged at `info` so it never nags.
- **A CSP REPORT THE CURRENT POLICY WOULD PERMIT IS A STALE-CLIENT ARTIFACT, NOT A
  THREAT.** Because the CSP rides the cached shell (above), an installed PWA enforces
  its LAST-CACHED policy until it reloads — so after a policy is widened, an
  un-refetched client keeps blocking and REPORTING things the live policy now allows
  (measured: `form-action → methodurl.vcas.visa.com` and `connect-src →
  spay.samsung.com` still arriving after the fix deployed — provably from an old shell,
  since the same batch blocked the Samsung host that the SAME commit allow-listed). An
  up-to-date browser would never have blocked those, so it would never report them:
  such a report can ONLY come from a stale client and is not the owner's to fix.
  `csp-report.php` now reads the LIVE policy (from `.htaccess`, falling back to
  `htaccess.txt`) and logs any (directive, uri) the policy PERMITS at `info` rather
  than `warn` — so it stops nagging "Needs attention" while the fleet catches up, and
  a genuine block (a host the policy still forbids) stays `warn`. Self-maintaining: it
  parses the SAME policy Apache serves, so it can't drift from what's enforced. The
  decision is a pure function (`csp_report_severity`/`csp_policy_permits` in the new
  **`csp-lib.php`**), gated by **`test-csp-report.php`** (CI-wired, deploy-excluded):
  drives the real live policy + the exact screenshot reports, break-tests the
  downgrade (removing it re-nags the 3 screenshot cases) and the wildcard matcher
  (`*.google.com` matches a subdomain, never the apex or a suffix-spoof), and proves
  form-action has NO default-src fallback and an http (insecure) target stays `warn`.
  **The policy comes from a GENERATED `csp-policy.php` (an `include`), never a
  filesystem read.** The first version read `.htaccess` with `htaccess.txt` as a
  fallback and silently never worked live: deploy.yml RENAMES htaccess.txt to
  .htaccess, so the fallback is a **404 on the host** (verified by curl), leaving one
  source — a dotfile PHP may not be permitted to read. When that read failed
  `$parsed` was null, the downgrade was skipped, and every report kept logging
  `warn`: the fix was deployed and did nothing, and the only visible symptom was the
  owner still being nagged. An include is EXECUTED rather than read, and csp-lib.php
  proves includes work. `php test-csp-report.php --update` regenerates it; the gate
  asserts parity with htaccess.txt so it cannot drift from the real header, and — the
  check whose absence let this ship — resolves the policy in a temp dir containing
  ONLY the generated file, i.e. the real production layout with no htaccess at all.
  Break-tested: restoring the filesystem-only lookup fails that check. A policy that
  cannot be resolved returns null and everything stays `warn` — failing SAFE, since
  over-reporting is recoverable and under-reporting hides a real block. **The general
  lesson: a fallback chain is only real if some link exists in PRODUCTION — test the
  deployed filesystem layout, not the repo's.**
- **Square settlement sync** — a payment's processing FEE and a refund's final
  STATUS (PENDING→COMPLETED) both land a day or two after the action, pushed by the
  `square-webhook.php` events. Because that webhook can be unconfigured, the
  `recent_payments` action ALSO reconciles on view: `reconcile_missing_fees()` +
  `reconcile_pending_refunds()` (in the shared **`payments-reconcile.php`** lib, required
  by bookings.php AND run daily from `self-repair.php` so the ledger self-heals even if
  nobody opens Payments) poll Square for fee-less card-ins / non-terminal refunds and
  backfill them. The webhook can **self-provision**:
  `square-setup.php` (`status`/`setup`, admin) creates the subscription via the
  Square API and stores the signing key ENCRYPTED as `apikey-square-webhook`;
  `square_webhook_signing_key()`/`square_webhook_url()` (db.php) resolve it (config
  const wins, else the stored key / derived URL), so `square-webhook.php` verifies
  with no config.php edit. Owner UI: Manage → Payments → "Connect" (`connectSquareWebhook`);
  read-only pill in diagnostics. Payment STATUS everywhere shows a traffic-light
  dot (`paymentStatusMeta`, green/amber/red) — the Payments feed AND the booking
  hub's per-payment ledger (`loadBookingPayments`); an issued refund reads
  Completed (see `paymentStatusLabel`). Both helpers live in **app.js** (the hub
  ledger renders from app.js, which must not reach admin globals). Gated by
  `test-webhook.php` (signature) + smoke (dot/label mapping).
- **A GLASS FORM PICKS DATES ON THE BUILT-IN CALENDAR** (`type: 'daterange'` in
  glassDialog; opener `gdfOpenDates`; Block-out-dates is the consumer; gated by
  ui-test-workspace §5, three break-tests). A trigger button + two hidden inputs,
  resolving `{from, to}`; `propFrom` names a sibling select whose cottage SHADES
  the calendar (admin+target with a prop builds conflicts from dbBookings/dbBlocks;
  the prop-less seasons target still shades nothing and shows no legend). THE KNOT
  IS Z-ORDER AND KEYS: `#glass-dialog` is z 6000 against the picker's 2100, so
  `openFieldDatePicker` lifts it (`.dp-over-glass`, 6100 — DETECTED from the open
  dialog, never declared) and BOTH key handlers defer while it's up (`dpOverGlass()`):
  the glass dialog's own Enter/Escape listener would otherwise answer the FORM
  under the calendar (break-tested — Escape cancelled the whole dialog), and the
  topOpenDialog listener early-returns while a glass dialog is open, so unguarded
  it never saw the picker at all (break-tested — Escape did nothing). Escape then
  closes the picker and closeDatePicker hands focus back to the trigger.
- **iOS date/time inputs won't shrink.** A native `input[type=date]` on iOS has an
  INTRINSIC minimum width (its rendered date text + the control's internal padding)
  and ignores both `width: 100%` and `min-width: 0`, so in a narrow panel it overhangs
  the edge — the Block-out-dates dialog had both date fields hanging past its right
  rounded corner on an iPhone. **`appearance: none` is what removes that floor**,
  which is exactly why the glass `select` (which has carried it for ages) was always
  fine and the date fields weren't; the fix sits on
  `input[type=date|time|datetime-local].input-glass`. **Chromium does not reproduce
  this** (measured: field 51→339 inside a 50→340 content box, identical with and
  without the fix — only `appearance` flips), so a green local layout run proves the
  fix is HARMLESS, not that it works: the **WebKit leg of layout-test is the actual
  verifier**. The `admin-block-dates` view was added there because no gate had ever
  opened a glassForm dialog, which is how this reached a phone at all.
- Offscreen `.page-view`s are `display:none`, so their CSS background-images aren't
  fetched until shown (built-in lazy-loading). The hero is the LCP image
  (`fetchpriority="high"` preload) — keep it prioritised, not deferred.
- Dev/CI-only files (`smoke-test.js`, `test-pricing.php`, `*.md`, `*.sql` are shipped
  for migrate but `.htaccess`-denied) are excluded from the deploy in `deploy.yml`.
- **Staging sandbox** (LIVE — probed 401-gated at staging.<domain>, tracking main):
  `deploy.yml`'s `deploy-staging` job mirrors the same code to a `staging.<domain>` site
  with its OWN database + `config.php` (Square sandbox + test email; see
  `SETUP-STAGING.md`). On the staging host only, `.htaccess` routes the entry pages
  through `staging-gate.php` (owner password → HMAC cookie), sends `X-Robots-Tag:
  noindex`, and `app.js` (`IS_STAGING`) shows the banner. Post-deploy is migrate-only.
  **The gate password is the ONLY credential — one door, two seats.** The banner carries
  a seat switcher ("Open the back office" / "Switch to guest view"): `staging_admin_session`
  (auth.php) mints the admin seat, gated on `STAGING_SANDBOX` (which site) AND
  `staging_gate_passed()` (who is asking — the gate cookie's HMAC recomputed from
  `STAGING_GATE_USER` + APP_SECRET, or the Basic header; fails CLOSED unconfigured).
  The constant alone was NOT enough for an admin seat: API endpoints aren't behind the
  gate's rewrite rules, so anyone who found the URL could otherwise mint a session on a
  box with a working mailer. The guest seat was already frictionless
  (`staging_guest_session`, low-power so constant+host suffice). If no admins row exists
  the seat MINTS one with a random never-shown password — setup.php is not needed on
  staging. Gated by test-integration §20, where each refusal is PAIRED with a success
  differing in exactly one factor (cookie, host), so no check can be vacuous.
  **"Set the stage" (Test centre) seeds a full pretend business**: six stays across the
  money states (in residence · arriving today with an arrival window · part-paid balance
  due · custom plan · unpaid due now · past CASH stay with the deposit bundled, so the
  deposit-return flow walks end to end with NO Square charge behind it), three enquiries
  (fresh/stale/declined), a chat thread + pending review (on the owner-email test guest
  — three stays carry that email so the GUEST seat's My Stays is rich too), expenses and
  a waitlist entry for taken nights. Every stay is priced with the REAL `price_breakdown`
  (§20 asserts no seeded row lacks a snapshot) and `dates_clash`-checked — never seeded
  over existing dates, `skipped` reported. Reversal: bookings/enquiries carry
  `[CHB-TEST]` in notes/message (the existing purge sweeps); expenses/waitlist/reviews/
  messages are id-tracked in internal key `testcentre-staged`, which MERGES on re-seed
  (overwriting would orphan the previous round from the purge). "Mark paid in full" on
  Test-centre booking rows rides the REAL `set_payment` write (deposit_collected, op
  ledger id) so skipping the payment still leaves coherent ledgers. And the pay screen
  names the sandbox test card (`#pay-sandbox-note`, shown when square-config's
  environment ≠ production — hostname is the wrong key, sandbox IS the fact).

**Dead code — what a sweep will re-flag, and why it ISN'T dead.** A naive
"defined but never referenced" scan over this codebase returns a lot of noise, because
so much of the UI composes its hooks at runtime. Before deleting anything a scanner
flags, check it against this list (all VERIFIED live, Jul 2026):
- **CSS classes** are built from data: `cmdk-${it.type}` / `cmdk-row-${it.type}`
  (so `.cmdk-answer`, `.cmdk-booking`, `.cmdk-figure`, `.cmdk-screen`… are all live),
  `act-row--${sev}`, `feed-dot-${level}`, `is-${tone}` / `is-${status}`,
  `sl-probe-${cls}`, and the per-cottage `tag-<prop>` / `bar-<prop>` / `swatch-<prop>`
  (the ORIGINAL THREE are also written literally in app.css as the pre-migration
  fallback; `injectPropColors()` generates the rest at runtime). `.leaflet-*` styles
  the map library loaded from CDN at runtime.
- **Markup ids** are resolved by pattern: `#sec-<id>` (`settingsOpen`), `#asec-<id>`
  (`accountsOpen`), `#card-price-<prop>` / `#card-rating-<prop>` / `#cott-fav-<prop>`.
- **`CHB_FILES` / `CHB_EVENT`** look unused but are the `chbAttrs()` authoring
  sentinels for two `data-pass` kinds the dispatcher serves and static markup uses
  (`data-pass="files"`, `data-pass="event"`). The five sentinels are one API; don't
  split it.
Two genuine finds that were NOT dead code either, and wanted fixing rather than
deleting — both now FIXED, and they are worth keeping here as the pattern to expect:
- `mailboxTab()` was the only writer of `__mbxTab='sent'` and had NO caller. The Sent
  list was fully built, its data already fetched by `loadMailbox()` (inbox + sent in
  one `Promise.all`) and it was ui-tested — with **no button**, so no owner could ever
  reach it. The fix was the affordance: an Inbox|Sent `.inbox-sort.seg` switch in the
  mailbox toolbar, which the toolbar's own comment had promised ("segmented switch on
  the left") and which was simply never built. The test hid it by calling
  `mailboxTab('sent')` DIRECTLY — it now CLICKS the tab, which is the only version of
  that assertion that can fail when the affordance goes missing.
- `#breakdown-modal` carried an `aria-label` ("Price breakdown") that disagreed with
  its own visible heading ("Payment breakdown"); it is now
  `aria-labelledby="breakdown-modal-title"`, so the announced name IS the visible one
  and cannot drift again. `#pay-done-title` was NOT an `aria-labelledby` target in the
  end — that reading was wrong, since nothing there needs a name. The real gap was
  that both payment OUTCOME panels were revealed by flipping `display` with nothing
  announced and no focus move, so a screen-reader user paid and heard silence:
  `#pay-done` is `role="status" aria-live="polite"`, `#pay-error` is `role="alert"`,
  and the reveal now happens BEFORE the text is written (a live region whose content
  changes while `display:none` is not reliably announced).

## Testing / CI
- Before shipping: `node smoke-test.js` (loads index.html + admin.js in a shim;
  pricing, postcode, occupancy, structural + facade-stub checks) and
  `php test-pricing.php`.
- **A test that reads the clock is only verified on the day it runs.** search-test
  was written and tuned in July and passed in **2 of 12 months** — measured, by
  shifting the clock and re-running. Three assertions were silently date-dependent:
  a hardcoded 23:59 as "a time that has not arrived" (false for the 23:59 minute,
  so CI failed for one minute a day), a bare month name in a query (the product
  resolves that to the most RECENT instance, while the seed wrote into the current
  year), and a seeded season spanning only `today+60` (so a September query landed
  inside it in July and outside it in January). **Two of those were hiding real
  product bugs** — the July-only greenness was doing the concealing, not the flake.
  So: never write a wall-clock instant or a bare month into an assertion. Pin the
  clock instead — stubbing `ukNowParts()` pins BOTH `todayDashed()` and
  `ukNowMinutes()` in lockstep (it is the one reader behind both), which also lets a
  boundary be asserted in both directions rather than only the side CI happens to
  land on. Derive month names from the current date (month-after-next is always
  fully future), and read expected rates from the model the way §35's `decCur` does
  rather than writing the number down. To check a change here, shift the clock and
  sweep: a 12-month pass plus month/day/year boundaries, DST and a leap day.
  **The PHP twin: test-integration's `$ukToday`.** The harness runs on UTC while
  db.php sets Europe/London, so a bare `date('Y-m-d')` in that file is the
  server's YESTERDAY between 23:00 and midnight UTC under BST. The rule is
  stated at the top of the file and two later sections (the memory dates, §30's
  last-morning window) were written against `date()` anyway — caught by a CI
  run that started at 00:03 London time. Compare a server-stamped date against
  `$ukToday`/`$ukPlus(n)`, never `date()`.
  **And a runner-load flake is a check that slept instead of waiting**: the hub
  focus-ring pixel sample (500ms after the fold toggle) and the mailbox
  folder-row read (300ms after openInbox's refetch) each failed once under CI's
  3-suite load and pass alone; both now wait on state (`getAnimations()`
  empty + open, the row present). Same rule as the safe-area suite's settle.
- `.github/workflows/ci.yml` runs `php -l` on every PHP, `node smoke-test.js`,
  `php test-pricing.php`, `php test-reply.php`, the real-browser `node e2e-test.js`,
  and the design gate `node layout-test.js` (layout invariants — no horizontal
  overflow, no content cut off, key content rendered — on the public views at
  390/768/1280 AND the six back-office screens at phone width; screenshots
  uploaded as the `layout-shots` CI artifact) on each PR — merge only on green.
  Plus the convention gates: `check-versions.js` (changed cached asset → bumped
  version, vs the PR base — `node bump.js <stamp>` satisfies it), the migration
  naming rule (smoke-test §6c-iii), **`typecheck.js`** — a tsc `--checkJs`
  RATCHET against `tsc-budget.json` (pinned typescript; the per-group error count
  may only fall — lower the budget in the same PR when you fix errors, never raise
  one to get green; no build step is being introduced, it's a linter),
  **`test-auth-posture.php`** (every web-reachable .php is registered with its
  auth posture — admin/guest/cron/token/webhook/rate-limited/public-with-reason/
  lib/dev — and the guard call is verified present; register new endpoints there),
  and **`test-content-keys.php`** (server-written content keys must be classified).
  PHPStan runs at **level 2** (a ratchet: regenerate `phpstan-baseline.neon` only
  for a level raise, never to bury an error you introduced). **It is the one gate
  with no local runner** — the container has no `vendor/`, so a full green
  gauntlet still says nothing about it, and #890 shipped a duplicate array key
  and an undefined-variable path straight into a red CI on that basis. Fetch the
  PINNED phar (the version is in ci.yml, currently 2.2.5) and run it before
  pushing any PHP change: `curl -sSL https://github.com/phpstan/phpstan/releases/download/<ver>/phpstan.phar
  -o /tmp/phpstan.phar && php /tmp/phpstan.phar analyse -c phpstan.neon.dist
  --no-progress`. CI PHP is **pinned**
  (8.3, checks + integration jobs) — bump it together with the IONOS host, never
  let it float with the runner image. **`perf-budget.js`** gates the gzipped size
  of every shipped asset against `size-budget.json` — raising a budget is allowed
  but must be deliberate, in the same PR, with the trade named; lower budgets when
  you shrink an asset to lock the win in. NB in these stylesheets the budget is
  mostly PROSE: strip the comments and admin.css gzips to 12.9KB of its 30KB, so a
  documentation-heavy change reads as performance rot unless you check. When a pass
  goes over, trim the comments to the measured facts first and only then raise —
  and hold **app.css flat regardless**, because every anonymous visitor pays for it,
  where admin.css is owner-only and immutable-cached. **`check-css-conventions.js`** is the same
  ratchet shape for the two CSS rules above (canonical breakpoints, no raw hex where
  a token covers it) against `css-budget.json`: counts may only FALL — fix the value
  instead of raising the number, and re-baseline a cleanup with `--update`. It
  deliberately does NOT count breakpoint complements, hex in a `--token:`
  declaration, hex in a `var(--x, #fallback)`, or mask/mask-image alpha channels
  (#000/#fff there are not theme colours) — a noisy gate gets worked around.
  **It also counts SPACING OFF THE 4pt GRID** (`offGrid`: padding/margin/gap pixel
  values of 3px+ that are not multiples of 4; 1–2px hairline nudges are allowed —
  the HIG's 8pt grid with its 4pt minor). Baselined at app.css 605 / admin.css 479
  / guest-app.css 16, measured with the declarations matched ANYWHERE on a line —
  admin.css joins rules onto one line (`}.x { padding: 6px; }`) and a start-of-line
  match under-counted it by a third (303 against 479). Snapping is done BY
  COMPONENT with layout-test watching, never by sweep: half the off-grid values are
  five numbers (14, 10, 6, 18, 22px) and each is a 2px move, but a sweep across 600
  sites is a layout question at 600 sites. **The first batch** (twelve guest rules:
  `.card` 15→16, `.input-glass` 15→16, `.hs-field` 15/18→16/20, the trust strip,
  the section kicker's margin, `.modal-box` 35→36 and 26/22→24/24 on phones, the
  glass dialog and reviews boxes 30→32, the daterange trigger, the terms foot,
  the footer gap 6→8) took app.css 605 → 586 with every guest suite, layout-test
  and a11y green — and each is a 1–2px move a screenshot cannot tell apart, which
  is the point: the grid is felt as consistency, not seen as change. **And it
  holds a HARD invariant: every
  `btn-*` class used in the markup or the JS templates has a rule** in one of the
  three sheets (round seven's `.btn-primary`, used on seven controls and defined
  nowhere) — vacuity-guarded at ≥5 tokens seen.
  **`a11y-test.js`** (browser-core job, ratchets against `a11y-budget.json`) is the
  accessibility gate: §1 every text token's contrast BY ARITHMETIC against the real
  surfaces of both themes (no rendering, so no flake), **§1b the same tokens on their
  own STATUS TINT**, **§1c the assistant's model-state colours at the 3:1 non-text
  bar**, §2 an accent-as-text ratchet, §3 accessible names on interactive
  elements, §4 minimum font size, §5 WCAG 2.2's 24×24 for standalone controls.
  **§1c exists because the knot's colour IS the information.** There is no worded
  pill, so `ready / understood / by-meaning / best-guess / learning` are reported by
  hue alone — and on the LIGHT theme four of the five sat under 3:1 against the
  search surface (understood 2.53, meaning 2.56 falling to 1.45 mid-animation,
  learning 1.77, guess 1.76), i.e. the state was announced in ink the owner could
  barely see, in the theme the back office actually ships in. The colours are now
  `--knot-*` tokens in admin.css with a light retune (reusing `--ok-text` /
  `--warn-text` where the value already existed), `guess` bakes its dimming into the
  VALUE instead of an `opacity: 0.6` so no alpha is left for the gate to model, and
  the two states that FADE are measured at their animation FLOOR — 0.66/0.5 put them
  back under 3:1 for half of every cycle, so both floors are 0.72 and the learning
  pulse gets its urgency from a glow swing instead. The gate reads admin.css and
  resolves `var()` aliases and `hsl(var(--siri-N))` parts, so a token may keep
  stating its hue once. ui-test-searchpage §16d owns the complementary property —
  that the five are five DISTINCT colours — and freezes both the 0.35s transition
  and the animation before sampling, because reading mid-interpolation made it
  report "4 of 5" nondeterministically AND made a broken `--knot-meaning` invisible
  to it (the keyframe was painting over the token).
  **§1b exists because §1 measured the wrong background.** Status ink almost never
  paints on a bare surface — it sits inside a `color-mix(in srgb, var(--ok) 12–20%,
  transparent)` pill or strip of its OWN colour, which is darker than the surface
  beneath it. Every one of `--ok-text` / `--warn-text` / `--danger-text` / `--info-text`
  passed §1 while failing AA where it is actually read (measured 4.23 / 4.40 / 4.30 /
  4.08:1); all four were retuned. §1b DISCOVERS its pairs by scanning for rules that
  set both `color: var(--X-text)` and a `--X` tint background, rather than listing
  them — so a new status pill is covered the day it is written, and the gate stays
  honest (`--ok`/`--warn` also appear at 32–34% as plain fills with no matching text,
  and testing every percentage against every token would invent failures for pairings
  that never appear on screen). It carries a guard that fails if the scanner ever
  stops finding pairs, so it cannot silently cover nothing. Read its header before extending it — a full
  pixel-sampling contrast crawler was built for the audit behind this gate and
  produced THREE rounds of confident false failures (a background-compositing model
  that stopped at a translucent parent; a probe stylesheet leaking into the next
  measurement; `getComputedStyle` being LIVE, so a colour read after blanking the
  text came back transparent), which is why the gate only measures things that are
  cheap AND deterministic. It walks the SEARCH WINDOW too (empty, answering, and
  with a record selected) — it was absent entirely, which is how a 23px
  `.cmdk-qa-row` and 10.2px group labels lived in the owner's primary interface
  unnoticed. NB the quick-action rows only render beneath a SELECTED RECORD, so the
  gate's stub has to serve a booking and the `search-record` state has to query its
  name; with an empty booking list §5 cannot see those rows at all (break-tested —
  the 23px row is invisible to the gate without the fixture).
  **layout-test's fixtures decide what it can SEE, and an empty one is a blind spot.**
  The admin booking-hub scene stubbed no email log, so `.bk-email-log-row` never
  rendered — and that row is a flex pair whose label sits at the default
  `min-width: auto` while both the timestamp and the "Show email" button are
  `nowrap`, i.e. a row with a FIXED intrinsic width. It shipped overflowing: the
  owner's own layout sentinel measured `button.bk-email-log-view` at right=439 in a
  420px viewport, taking the page 19px wider. Two fixture bugs kept it invisible —
  the log was keyed `b2` (the CLIENT key) where the hub looks up `b.dbId` (`2`), and
  the actions were undotted, so `EMAIL_PREVIEWABLE` never matched and the button was
  never emitted. With a real fixture the gate reproduces it at 390px (page over by
  39px) and the fix is `flex-wrap` plus `min-width: 0`, which holds at ANY width
  rather than the three we happen to test.
  **§6 is the heading OUTLINE, and it needed a reliable scope before it could exist at
  all** (backlog #76 was blocked on exactly that). This is a SPA with twenty-odd
  `.page-view` sections, most `display:none`, so a document-wide `h1..h6` query
  concatenates screens the owner cannot see — measured, scanning `body` reported the admin
  Today `h1` as the HOME page's heading. The scope is the **ACTIVE view, or the topmost
  open dialog**, visible headings only, which is also what `aria-modal` gives a screen
  reader. Two questions, and the thresholds are the point: **skipped levels** (a descent
  of more than one, `h2 → h4`) are budgeted at **0**, and **starting below h2** is a
  separate check at 0 — deliberately h2 and not h1, because WCAG does not require an h1
  and several admin screens legitimately top out at one: `settingsOpen()` HIDES the big
  "Manage"/"Payments" title while drilled in ("the section shows ONE back link + its own
  title instead of two stacked headers"), so the h1 is in the DOM, hidden with the index
  it titles, and the section's h2 is that screen's title. Demanding an h1 there would ask
  the app to reverse a UI decision to satisfy a rule nobody wrote; a top heading of h3 or
  lower, where levels 1 AND 2 are both absent, is what earns a failure. It carries a
  VACUITY GUARD (≥10 outlines collected) for the reason §1b does — break-tested by
  renaming the scope selector, which leaves the skip check passing at `✓ 0` while the
  guard catches it. Six scenes were added for it, which cost §3–§5 nothing and immediately
  earned their keep: they caught `#mbx-search` named only by its placeholder and the
  income-forecast chart's axis labels at **9.6px**, both now fixed. The one outline defect
  it found: the Inbox's **Email folder had no heading at all** while both its sibling
  folders carry an `h2`, so switching to Email lost the section heading — it has one now.
  §4/§5 have a real coverage limit, documented in the file:
  they see only what RENDERS in the harness, and a collapsed container (the cottage
  availability calendar) or the footer wrapper hides elements from them — check those
  by computed style instead. The static CSS lesson from the same audit: a
  `color: var(--accent)` declaration in the stylesheet is NOT evidence it paints —
  several are overridden by later rules, so of 13 "accent as text" sites only 2 were
  really rendering. Verify at runtime before "fixing" a colour.
  NB an app.js "account bundle" split was
  MEASURED (Jul 2026, Chromium coverage + a function-level audit) and REJECTED:
  the cleanly signed-in-only slice is only ~9% raw (~14KB gz), so the
  admin.js-style facade machinery wouldn't pay for itself — re-measure before
  ever attempting it. (The 68% "never executed on an anonymous browse" figure is
  mostly PUBLIC situational code — booking modal, flex-date search, chat — that
  must stay in app.js.)
  `deploy.yml` SFTP-deploys `main` to IONOS (never deletes remote files; preserves
  `config.php` + `uploads/`).

- **ui-test harness**: every `ui-test-*.js` suite boots through **`ui-test-lib.js`**
  (`const { d, ok, boot } = require('./ui-test-lib')` — or `bootBrowser` for suites
  creating their own pages): it pins TZ=Europe/London at require time, leases a FREE
  port from the kernel (no hand-picked port registry), spawns php -S + readiness
  poll, launches Chromium (CHB_CHROMIUM override), stubs the service worker and
  wires pageerror logging; `await done(fails)` tears everything down. New suites use
  it; never re-inline the boot block or hardcode a port. The lib matches the runner's
  suite glob, so ui-tests.js explicitly skips it.
  For a time-of-DAY assertion in a browser suite, pin the page's clock —
  **`page.clock.setFixedTime(date)`**, NOT `clock.install()`: setFixedTime fixes
  `Date.now()`/`new Date()` and leaves the timers running, so the app's own
  `setTimeout`s still fire (install fakes them too and the suite would hang waiting
  for ticks). Keep the pinned instant on the SAME calendar day so the node-side
  `d(n)` helper still agrees, and fix only the hour. ui-test-yourstay is the
  exemplar: its checkout-time cases were asserted against the real clock, so
  "checkout still to come (23:59)" was false during the 23:59 minute — pinned, it
  now checks both ends of the day on purpose (case 10 is the far end, and removing
  its pin fails the check, which is how you know the pin is load-bearing).

## The offline day sheet — Today with no signal

**A changeover morning with one bar still gets its day sheet** (gated by
**`ui-test-offline.js`**, 23 checks, each break-tested — including one that only the
TOAST could catch, because initBackOffice self-heals the sheet). The pieces:
- **The snapshot is pre-warmed, deliberately** (`chbSnapWrite`, localStorage
  `chb-daysheet`): written on every SUCCESSFUL loadData in initBackOffice — never
  opportunistically, or the one morning it matters the copy is from Tuesday. It carries
  today's movements + in-residence + the next TWO mornings' arrivals (a snapshot taken
  tonight still covers tomorrow's changeover), each row with name/phone/times/party,
  `bookingDue(pk,b).balance` (NB the shape — bookingDue returns the displayGrand OBJECT,
  not a number), the held deposit, and the booking notes. Refused past 48h
  (`chbSnapRead`).
- **An offline BOOT enters owner-mode on a hint** (`chb-was-admin`, stamped by a
  VERIFIED admin_status): the boot catch distinguishes a network failure (no `e.status`)
  from a 401 (a verdict), and only the former + the hint enters. Never in the
  account-preview iframe. Both the hint and the snapshot are removed on BOTH logout
  paths — guest names and key-safe codes don't outlive the session.
- **The day sheet replaces Today outright** (`renderOfflineDaySheet`,
  `body.offline-snap` hides every other child of view-backoffice): half-real panels
  under an offline banner would present empty stores as facts. The marker speaks in the
  day's terms ("saved this morning at 8:12"), phones are `tel:`/`sms:` links (they need
  no data at all), and **grouping is recomputed from each row's own dates at render** —
  a yesterday-snapshot's "arriving tomorrow" renders as arriving TODAY, and finished
  stays drop out. "Try again" is honest both ways; the still-dead branch owns the TOAST
  (the sheet re-rendering is initBackOffice self-healing — break-testing found the
  branch removable with every DOM check green).
- **`ops-<prop>` is the owner's private cottage card** (Manage → cottage → Private
  cottage notes; key safe, stopcock, boiler reset, cleaner's number) — PRIVATE like
  `arrival-` (encrypted at rest; these codes physically open the cottages), NOT internal
  like bacs-details: the decrypt-failure trade that kept bank details plaintext (garbage
  in a guest's inbox) doesn't apply to an owner-side field that can be retyped. Written
  concatenated so the test-content-keys literal scanner can't see it — its
  classification is pinned there explicitly. `saveOpsNotes` refreshes the snapshot in
  the same breath, and the snapshot keeps the LAST-SEEN ops when adminPrivateContent
  isn't loaded (it only fills when Manage opens; forgetting the key-safe codes because
  the owner didn't visit Settings today would decay the sheet for no reason).
- **sw.js no longer excludes admin.js from the fetch handler** — keyed on its full `?v=`
  URL a cached copy cannot drift beyond the lockstep app.js already imposes (an old
  app.js asks for the old URL), and the exclusion's real cost was this feature: a dead
  link couldn't load the bundle at all (the immutable HTTP disk cache is an evictable
  lucky backstop, not a design). Still OUT of CORE — guests never pay. smoke-test asserts
  the handler carries no admin.js bypass in CODE (comments legitimately narrate it).
- ~~What this PR deliberately does NOT do~~ **PR-2 shipped the write half.** What follows
  supersedes the deferral note that stood here.

**THE OP LEDGER — exactly-once for replayed writes** (migration-109 + `op_claim`/
`op_finish` in db.php, gated by test-integration §17 + ui-test-offline §7/§8, each half
break-tested). A phone on one bar can land a request whose REPLY dies — the client
cannot tell that from a request that never arrived, so it queues and retries. Without
the ledger the retry double-applies, and this was a LATENT LIVE BUG: `expenses add` and
`messages send` (queueOrPost's two original users) INSERT rows, and `set_payment` writes
an ABSOLUTE reconciled figure, so a stale replay would REGRESS a newer payment (gated
both ways in §17b). The shape:
- `$opTok = op_claim($in)` at the top of a queueable action; success exits through
  `json_out(op_finish($opTok, [...]))`. A repeat of a stored id is answered from the
  ledger with `replayed: true`; concurrent repeats serialise on a per-op GET_LOCK (the
  book_lock posture); an UN-MIGRATED table degrades to no-dedupe, never a blocked write.
- **ERRORS ARE NEVER STORED** — a 4xx/5xx json_out exits before op_finish, so a replay
  re-runs and meets the same deterministic refusal (a clash-refused enquiry re-refuses;
  §17e) — storing refusals would freeze a fixable one forever.
- Wired: `set_payment`, `expenses add`, all three `messages send` variants (the
  anonymous one claims AFTER its rate limit, so a flood can't ride stored responses
  around the toll), and `enquiries submit` (claimed BEFORE its rate limit, so a
  legitimate retry never burns a slot). Rows pruned at 30 days by self-repair §4d.
- **THE ONLINE WRITE PATHS CARRY IT TOO** (`chbOpFor`/`chbOpBump` in app.js; server:
  `bookings add`/`update` joined the ledger; gated by ui-test-offline §12 +
  test-integration §17g–i). The ambiguous timeout exists on good WiFi — a hand retry
  rebuilds its payload from the FORM, so the id is DETERMINISTIC over the payload:
  identical retry = same id (dedupes), any edited field = fresh id (an edited save must
  never be answered from the stored response of the save it replaces), and `chbOpBump`
  on each confirmed success makes re-stating an EARLIER value a new write, not a replay
  (£100→£150→£100 would otherwise leave the DB at £150 while the ledger said done).
  The guarded save LADDER shares one id: the clash refusal stores nothing, the override
  post stores, so a retried ladder is answered at post ONE — no re-prompt, no duplicate.
  Stamped in saveModal (add/update + the enquiry-edit resubmit) and recordPayment.
  queueOrPost keeps its RANDOM id — the queue persists the stamped payload, so its
  retries are the same object by construction; don't unify the two schemes.
- **`oqFlush` claims its flag BEFORE the first await** — set after loading the queue,
  two callers a few ms apart (the recovery's 60ms flush + the any-success hook) both
  pass the guard and both post the same items: a double POST the ledger absorbs but
  that should never reach the wire.
- **A REFUSED REPLAY BECOMES A DUTY** (IDB store `refused` — chb-db is **v2** now, and
  app.js's `oqDB` + sw.js's `swQueueDB` must bump TOGETHER or the loser gets a
  VersionError; gated by ui-test-offline §14, the SW half by a source assertion since
  the harness stubs the SW). The flush's toast covers the owner who is LOOKING; the SW
  replay runs with the app CLOSED, where a refusal reaches nobody — and a change the
  owner believes saved but that did not apply is the worst lie the queue can tell.
  Both replayers record the refusal (label + the server's own sentence) before
  consuming the item; `chbDuties` surfaces it (`__oqRefused` mirror, loaded async in
  initBackOffice) as a red row saying "it did NOT apply", and `oqRefusedOpen` shows the
  full reason BEFORE it can be dismissed. Deliberately not cleared on logout — it is a
  business record, like the queue itself.
- **PHOTO EVIDENCE RIDES THE DEPOSIT DECISION** (odsDep's `file` field → `odsPhotoData`
  canvas re-encode ≤1280px JPEG; shown by `glassDialog`'s `img` option in the reconnect
  confirm; uploaded as `photo_data` ON the confirmed keep/return; server
  `deposit_evidence_store` in db.php; gated by ui-test-offline §13 + test-integration
  §17j). The judgements: the photo is EVIDENCE, never a precondition — a photo that
  won't decode still saves the decision, and the server helper NEVER THROWS (magic-byte
  checked JPEG only, 2MB cap, random filename suffix because uploads/ is web-reachable)
  so the money op stands whatever happens to it; `odsDepSave` sheds the OLDEST photos
  first when the record outgrows localStorage (~5MB) — a photo is worth less than
  losing the decisions; and the shared `#glass-dialog-img` node is reassigned on EVERY
  dialog open (the okLabel-leak rule, for pictures — break-tested: setting it only
  when present leaks the photo into the next plain confirm). glassForm's `file` type
  resolves the File OBJECT, not the fakepath string `.value` would give.
- **THE PHONE-SIDE STORES ARE ENCRYPTED AT REST** (`chbSecKey`/`chbSecEncrypt`/
  `chbSecDecrypt`/`chbSecForget` in app.js; `chbSecLoad`/`chbSecStore` + the mirrors in
  admin.js; gated by ui-test-offline §15, each half break-tested). The day sheet and
  the deposit decisions hold guest names, phone numbers and KEY-SAFE CODES; localStorage
  now shows only an `enc1:` AES-GCM envelope under a NON-EXTRACTABLE CryptoKey in IDB
  (`chb-db` **v3** adds `keys` — app.js + sw.js bump together, the VersionError rule).
  The judgements: readers stay SYNCHRONOUS through decrypted memory mirrors
  (`__chbSnapCache`/`__odsDepCache`, unlocked ONCE by `chbSecLoad`, which initBackOffice
  awaits before anything reads); a value that will not decrypt is ABSENT and removed,
  never garbage; legacy plaintext is ADOPTED and re-encrypted on the next store, so the
  upgrade loses nothing; no WebCrypto → plaintext fallback (the no-lock degrade — never
  lose the feature to the lock); and logout deletes the KEY with the ciphertext, so a
  fresh sign-in mints a fresh key. Deliberately NOT a defence against code running on
  the device — nothing client-side is — it closes the backup/inspection surface.
  NB tests that used to `JSON.parse(localStorage.getItem('chb-daysheet'))` now read
  `chbSnapRead(true)` / `odsDepDecisions()` — the raw value is ciphertext.
- **THE COAST RIDES THE SNAPSHOT** (`chbSnapCoastPatch` async after a successful
  loadData — never waited on; `odsCoastLine` renders it under the marker; gated by
  ui-test-offline §16). "High water 06:41 and 19:08 · low 12:55 · Sunny · 18°C" on a
  no-signal morning, from the tides/weather the coast tier already fetches. **The TIDE
  is gated on `coast.day === today`** — tide times are fetched FOR a day, and
  yesterday's snapshot rendering this morning must not state yesterday's high water as
  today's (break-tested); the weather payload carries dated days, so it survives the
  roll-over on its own. chbSnapWrite carries `prev.coast` forward, or every rebuild
  between patches would throw away what the offline morning needs.
- **THE ASSISTANT ANSWERS OFFLINE, FROM THE DAY SHEET** (`chbSnapAnswers`, consulted
  FIRST in cmdkBuildResults; gated by ui-test-offline §17). On an offline BOOT the
  stores are empty, so every store-backed family would report a business with no
  bookings — the poor-signal lie, in the assistant. The snapshot tier answers the
  day-sheet questions (arrivals/departures/staying/money/a name, with the phone
  number), each attributed "From the saved day sheet". **Two abstain gates, and the
  break-test lesson lives in the second**: the verdict gate (online → null) and the
  stores gate (offline MID-SESSION with stores loaded → null, live data stays in
  charge) — the first draft only tested online, and deleting the stores gate left it
  green because the verdict gate answered first. Test each gate where it bites.
  `cmdkServerSearch` and `cmdkDeepFetch` refuse up front while known-off (the deep one
  onto its existing honest error state) instead of spending 5s timeouts per keystroke.
- **NB ui-test-poorsignal §7 must DRAIN the recovery's own reads before seeding** —
  chbNetRecover's fire-and-forget initBackOffice issues loadDepositReturns, and under
  CI's 3-suite load its generic 200 landed MID-SEED and wiped the fixture (the check
  read £0 while the app code was correct; reproduced 1-in-3 locally under the same
  contention). Same class as the email-log drain directly above it in that suite:
  wait for the verdict to settle, then issue-and-await the read yourself.
- **`queueOrPost` queues ON FAILURE TO SEND, never on `navigator.onLine`** — the flag is
  true on a dead router, so the old gate threw the write away on exactly the connection
  the queue exists for. An `e.status` means the server ANSWERED: a refusal throws to the
  caller and is never retried blind. The op_id is stamped BEFORE the first attempt
  (break-tested: stamping at enqueue splits the ids and §8's exactly-once contract
  fails). oqFlush likewise only lets a server ANSWER consume an item — a transport
  failure breaks and keeps the whole queue (the old onLine test deleted items on a dead
  router), and a refusal's toast now carries the item's label + the server's own words.
- **Replay probes**: `online`, `visibilitychange`, and — the honest one — ANY successful
  apiPost (a request that just worked is the only real proof the link works; a router
  back from the dead fires no event at all). Plus **`pageshow` and `focus`** (gated on
  known-off/queued state): iOS has no Background Sync, so replay hangs on the PAGE
  waking, and a PWA resumed from background can arrive via bfcache or a bare refocus
  (iPad split view) with no visibilitychange — the probe fires NOW, not in 15s
  (ui-test-offline §11, deterministic: the interval timer is stopped first, so any
  probe seen can only be the resume listener's).
- **The day-sheet captures** (admin.js `odsPay`/`odsDep`/`odsEnquiry`/`odsExpense` —
  the expense one reuses addExpense's payload + EXPENSE_CATS through queueOrPost, since
  the server half was ledger-safe from the start and only the affordance was missing;
  ui-test-offline §10 gates it, and NB its exactly-once assertion is ONE id across
  every wire attempt + the queue draining, never a post COUNT — a resume-probe flush
  while the API is still dead is a legitimate third attempt): record a cash
  payment (payload MIRRORS recordPayment's — cumulative rental vs `rtot`, deposit rides
  `deposit_collected` on 'paid' only; snapshot rows carry dbId/rtot/rpaid/dmg/holdNone
  for exactly this), the deposit DECISION (localStorage `chb-dep-decisions`, deliberately
  OUTSIDE the oq queue: the SW replayer deletes items on any non-auth response, so a
  pseudo-endpoint there would be silently dropped — and it must never auto-replay at
  all: reconnecting runs `odsDepConfirmSweep`, one glassConfirm per decision quoting the
  note from the cottage, executing return/keep_deposit ONLY on the OK; "Not now" and a
  server refusal both keep it, with the server's sentence shown), and the phone enquiry
  (an ENQUIRY, never a booking — approval re-checks the calendar under book_lock, so
  dates that went to Airbnb while the phone was blind become a decline, not a double
  booking; enquiries.php's address/postcode are now admin-exempt for exactly this,
  §17d). Queued-payment rows re-mark via `__odsQueued` (ids, not object flags — the
  sheet re-renders fresh row objects from the snapshot and a mark on the old object dies
  with it; measured, the first gate run caught it).
- **NB the PHPStan stub-arity class struck twice here**: test-emails-render.php declared
  `rate_limit()` and `occupancy_limits($k)` with the WRONG ARITY, and touching their real
  callers re-typed 17 call sites against the stubs (the three-`ok()` lesson again — the
  set is analysed as one). Stubs must mirror the real signature.

**LIVE ONLINE/OFFLINE TRANSITIONS — one evidence-based verdict, both ways, no reloads**
(app.js `chbNetDown`/`chbNetUp`/`chbNetProbe`, gated by ui-test-offline §9, five
break-tests firing). `navigator.onLine` only knows whether an INTERFACE is up (true on
a dead router), so the verdict is what actually happened: any transport failure in
apiPost/apiGet flips the whole dashboard offline (`body.net-off` + the pill, at the
FIRST failed request), any success flips it back, and while off a version.php probe
retries every 15s so recovery is automatic with nothing touched. The `online` event is
a HINT to probe now, never a verdict.
- **OFFLINE MODE TAKES OVER BY ITSELF ON A POOR SIGNAL** (gated by ui-test-offline
  §18, all three mechanisms break-tested). On one bar nothing FAILS — everything
  HANGS — so the failure-driven verdict never fired and a hinted boot sat behind a
  15s auth timeout plus a 15s data timeout before the sheet appeared (~30s of
  nothing). Three parts, one constant (`CHB_BOOT_PATIENCE_MS` 3s): the boot-start
  WATCHDOG (the boot's own content fetches hang BEFORE the auth step is reached, so
  no per-step race can help — enter provisionally, reads only) with the auth race
  behind it (a late FALSE verdict logs the provisional session straight out);
  initBackOffice's PATIENCE timer (day sheet at patience+1s while loadData still
  runs underneath — a late-landing load swaps the sheet for live Today by itself,
  and `navigator.onLine === false`/known-off skip the wait entirely); and the
  HEADER TRIMMED to what still works under `body.offline-snap` (Inbox/Payments/
  Manage hidden — dead destinations read as broken; Today and the crown stay).
  Measured in the gate: owner-mode at ~2.7s and the sheet at ~6.7s with every
  request still pending. **The patience timer is armed ONCE PER PAGE
  (`__odsPatienceUsed`) — the window is the BOOT's**: arming it on every re-init
  put the sheet up 4s into any stalled mid-session refresh with emptied stores,
  and its presence made the next chbNetUp "noticed", burying the specific failure
  toasts ui-test-poorsignal §3–§4 assert (measured — the bisect that found it
  reverted one mechanism at a time). The trim is keyed on `offline-snap`, NOT
  `net-off`: a mid-session blip keeps the full menu, because those screens still
  hold last-good data.
- **THE MACHINERY IS VISIBLE NOW** (gated by ui-test-offline §20, four mechanisms
  break-tested). The queue in WORDS: an `#ods-queue` section on the sheet and the
  same tray behind the (now tappable, `<button>`-reset) offline pill via `oqTrayOpen`
  — read-only by design, a queued change can be seen and awaited, never discarded.
  The reconnect replay NARRATED: `oqSyncNote` updates one `#oq-sync` status element
  in place ("Sending 2 of 3 — …" → "N sent ✓" / "N sent · M refused"), final state
  lingering a beat. The banner is the mode's IDENTITY: LIVE freshness
  (`odsMarkWire` ticks "· 4 min ago", amber `.is-stale` past 6h) and the probe made
  visible — but NO wifi-off glyph of its own, and a compact strip rather than a
  card (owner: "make the offline box smaller", "both offline logos aren't really
  needed"): the floating pill beside it is the ONE mark, and the functional one
  (it opens the tray) — NB a failed probe can answer in MILLISECONDS (airplane mode aborts
  instantly), so the "checking the connection…" whisper HOLDS a readable beat and
  signs off "still offline" rather than clearing before it can be read (measured —
  the first version was invisible in exactly the case it was for). Dimmed Tier-C
  controls grow a "needs signal" title via a LAZY delegated mouseover (re-renders
  wipe a one-off attribute pass) + grayscale in the generated rule. The assistant's
  LANDING gets offline boards (`chbSnapBriefRows` — chbSnapAnswers' gates, rows
  declaring their board so the §20a sort places them). A guest going offline is told
  ONCE per session (sessionStorage-flagged toast). `odsA2hsNudge` tips Add-to-Home-
  Screen once ever, only on an un-installed Apple touch device. NB odsExpense/
  odsEnquiry call `odsQueueRefresh()` themselves — only odsPay re-renders the sheet,
  and a tray that waits for the 30s tick reads as a capture that vanished.
- **ONE DASHBOARD, TWO SOURCES** (gated by ui-test-offline §21, four break-tests
  fired in ISOLATION — a broken duty row kills the suite at its own click, so a
  combined break run proves only the first break; see the §21 history). The sheet
  wears the online Today's anatomy, fed by ONE adapter: `chbSnapRowsFromStores()`
  is the single derivation of the day's rows (the snapshot WRITER and the live
  path both call it), `chbDayRows()` picks the source (live stores when they hold
  anything — the wifi-icon takeover mid-session renders from MEMORY, marker
  reading "built from the data already on this phone" — else the saved snapshot),
  and `chbOpsParts(tuples)` is the one GRAMMAR both day lines speak (measured
  identical: "1 arrival · 1 departure · 1 changeover · £340 to collect"; the
  online header keeps its judgements — hasCheckedIn, owner-arranged zeroing, the
  needspay button — in its own tuples, the sheet states its source instead).
  The sheet's own sections: `odsDutiesHtml` (Needs-you row vocabulary, each duty
  routing to the CAPTURE that answers it — there is no live hub offline — plus
  the refused-replay records, the one duty class that works entirely from the
  phone), `odsHubCard` (the guest's NAME is the tap target — a `<button>` with
  the UA reset — opening a read-only grouped-row card that ends "the full record
  needs a connection"), and `odsTimelineHtml` — lanes and bars for EXACTLY the
  days the rows vouch for (today + tomorrow; the snapshot window's
  guaranteed-complete nights — day+2 can hold un-snapshotted arrivals), with one
  hatched UNKNOWN cell per lane beyond: an empty cell there would pose as "free",
  which is the lie the whole day sheet exists to avoid.
- **AN OTA STAY PAINTS AND NEVER COUNTS, and the sheet carries the Bookings list
  too** (gated by ui-test-offline §23; owner screenshots — "offline mode looks
  very jumbled, it needs to look like online mode"). A quiet day's sheet
  collapsed to two buttons while online showed a screen of OTA bars and upcoming
  cards. Three additions, all display-only: OTA rows join `chbSnapRowsFromStores`
  (`ota: true`, dbId 0, no phone, no money — a changeover is changeover work
  whoever booked it) and the ops line / duties / money / spoken answers all
  filter them, so the grammar still agrees with the online header; the snapshot
  gains **`up`** (`chbSnapUpFromStores`, the first 5 upcoming stays with the
  paid/balance chip) rendered by `odsUpcomingHtml` as a Bookings section; and the
  capture buttons moved to directly under the ops line, where online keeps its
  action row. **NB the §23 fixture must put the OTA block on its OWN cottage**:
  every 21a block overlapping a local booking is correctly suppressed as a
  platform mirror (`suppressBlocksUnderLocalBookings`), and 21a's local stays
  blanket today–tomorrow — the first fixture sat there and §23a silently tested
  a row the app had rightly dropped.
- **NOTIFICATIONS NEVER DOUBLE-SHOW** (gated by ui-test-offline §22, three
  break-tests — the broken run reproduces the owner's screenshot verbatim,
  "Back online." stacked over two copies of "Back on — this is live data now.").
  Three layers: `toast()` DEDUPES an identical message already on screen (action
  toasts exempt — dropping one silently drops the affordance); `chbNetUp`'s
  generic voice STANDS DOWN while the day sheet is up (odsRetry's "Back on —
  this is live data now." is the specific version of the same message); and
  `odsRetry` is RE-ENTRANT-SAFE (`__odsRetrying` — a flapping link fires the
  recovery twice in quick succession, and two concurrent retries meant two
  loadDatas: the cause; the dedupe is the backstop). NB one recovery is TWO
  bootstrap loads by design (odsRetry's own loadData, then initBackOffice's) —
  §22's counter asserts 2 and the guard's failure mode is 4+; asserting 1 was a
  wrong count, not a wrong guard.
- **THE WIFI-ICON RULE** (`chbGoOffline`, wired to the `offline` event; gated by
  ui-test-offline §19, wiring break-tested). Airplane mode / wifi-off fires the
  browser's `offline` event with NO failed request — the whole back office
  transforms at once: day sheet up, header trimmed, and the owner brought to it
  from wherever they were (the trimmed screens are about to be dead ends).
  Deliberately ONLY on the no-interface signal — the evidence verdict alone (one
  failed request, a blip) keeps the last-good workspace and never yanks the owner
  off the screen they are reading. A SPURIOUS offline event self-corrects: the
  first successful request swaps everything straight back — which is also why
  §19's fixture must make requests actually FAIL when it dispatches the event
  (with routes left alive, the correct self-correction reads as the feature
  being broken).
  **AND THE EVENT CANNOT BE THE ONLY TRIGGER** (§23e; owner screenshot — the
  live dashboard reachable in airplane mode). iOS never delivers `offline` when
  airplane mode is toggled while the app is BACKGROUNDED, so the owner resumed
  onto a dead dashboard with error toasts and no takeover. The interface being
  off is checkable at two other moments: `chbNetDown` fires `chbGoOffline` when
  the verdict flips with `navigator.onLine === false` (deferred a tick —
  chbGoOffline's own chbNetDown call must not recurse), and the
  visibilitychange/pageshow resume listeners check the same condition on wake.
  A blip (onLine true) still never transforms — the wifi-icon rule is intact,
  it just stops depending on an event iOS withholds. The gate shadows
  `navigator.onLine` with an own-property getter and lifts it with
  `delete navigator.onLine` (the prototype getter returns).
- **Tier-C refuses up front at the dispatcher** (`CHB_NEEDS_NET`: requestPayment,
  returnDeposit, keepDeposit, sendArrivalInfo, approveEnquiry): dimmed under
  `body.net-off` by a style rule GENERATED from the same list the guard reads (one
  definition; style-src carries 'unsafe-inline' so the injected <style> is allowed),
  and a tap gets the reason immediately. NB the hub's payask can offer
  **`recordPayment` — the SAFE capture — which is deliberately NOT in the list**; the
  first draft of the gate targeted a hub that showed it and proved the distinction by
  accident. `returnDeposit` needs a CHECKED-OUT fixture to render at all.
- **A BLIP IS NOT AN OUTAGE** (`CHB_NET_NOTICED_MS` 8s): on genuinely bad WiFi SOME
  requests fail while others land, so the verdict flips per request — measured,
  ui-test-poorsignal's mixed-endpoint scenario had "Back online." burying the specific
  failure message it asserts. The pill moves instantly both ways; the TOAST and the
  re-render recovery fire only for an outage the owner could have noticed (lasted 8s,
  queued writes, or the day sheet up). While known-off, requests take a 5s timeout so
  taps fail fast.
- **Recovery is in place, never a reload** (§9 pins a window marker across the whole
  arc): the cold-boot day sheet swaps itself for the live Today when the probe
  succeeds; the odsRetry branch in `chbNetRecover` owns the PARKED case (sheet up
  while the owner sits on another view) — break-tested, the on-Today path is equally
  covered by initBackOffice's own fallthrough, and the comment says so rather than
  claiming more.
- **THE GATE'S FIRST RUN CAUGHT A DOUBLE ASK**: chbNetUp's recovery and an explicit
  initBackOffice swept the deposit decisions CONCURRENTLY — two sweeps snapshotted the
  same list and a second "Return £75.00 to Hannah?" confirm sat over the page (the
  server's book_lock made its OK a 409, so no money could move twice — but a double
  ask about money leaving is exactly what the sweep must never do).
  `odsDepConfirmSweep` is re-entrant-safe (`__odsSweeping`) and re-checks each item
  against the LIVE list before asking.

## The key safe keeper — a code the guest only gets once the safe carries it

**Its own page** (`view-keysafe`, the KEY icon in the admin dock — 5 buttons now) plus
duties on both dashboards, an offline capture, and a guest reveal. The owner's rule,
stated at the demo and load-bearing everywhere: **the guest is never given a code the
safe hasn't been confirmed set to.** Three consequences shape the whole design:
- **Generating records NOTHING.** The app cannot turn a dial, so `keysafeRotate`'s
  dialog (a glassForm with a generated 4-digit code prefilled — `def` support added to
  glassForm for it — overtype to use your own) writes only on "I've set the safe".
  That confirm is also what RELEASES the code to the guest.
- **The code is never emailed** — that was already mailer.php's standing policy (the
  arrival email says "your entry details appear on your booking page"), but the in-app
  reveal that sentence pointed at had been REMOVED (arrival-access.php now serves only
  coordinates), so the promise was dead. `my-bookings.php` makes it true again:
  `door_code` is attached to a stay only when the record says the safe is set FOR that
  booking AND `keysafe_reveal_window` is open (2 days before check-in through check-out,
  string-compared ISO dates so no timezone moves the day); `door_code_from` carries the
  dated promise once a confirmed code exists. Gated BOTH directions in
  test-integration §18 — the break-test's failure mode is the exact leak ("7302" shown
  to a guest a month out).
- **The record is PRIVATE like ops-** (`keysafe-<prop>`, encrypted at rest via
  `content_set_secret`; read through the new `content_secret_json` in db.php, which
  content_json is NOT — it reads ciphertext raw). §18 asserts the stored row never
  contains the plaintext code, and the activity log records THAT a rotation happened,
  never the code (log rows are plaintext). `keysafe_read` sanitises: garbage, a failed
  decrypt or a non-4-digit code degrade to "no code", never line noise on a guest page.
The pieces: **keysafe-lib.php** (pure — `keysafe_bad` refuses runs/repeats/junk,
`keysafe_generate` excludes this cottage's recent codes AND the other cottages' current
ones, the reveal window; gated by test-keysafe.php, CI-wired), **keysafe.php** (admin,
route_actions; `confirm` rides the op ledger so the offline capture replays exactly
once), the **duty** (`chbDuties` kind `keysafe`, TIME-AWARE via **`keysafeDue`** —
ONE derivation the duty, the page's capsule/sub and its pulse all read: a guest IN
RESIDENCE whose code isn't recorded is SCHEDULED ("rotate at changeover", amber on
the page, NO strip row — rotating mid-stay locks out the guest using the code; the
owner's screenshot was two RED rows about in-residence Airbnb guests). Because
`keysafeNextBooking` drops the departing stay on checkout morning, the ask fires
exactly at changeover, named for the INCOMING guest — RED when their reveal window
is open or they arrive today, amber further out; an unloaded mirror mints NO duty —
never from ignorance; the day sheet was already arrival-window-only, no change),
and the **offline capture** (`odsKeysafe`:
on-device `crypto.getRandomValues`, queued confirm, local mirror update so the sheet
stops nagging before the signal returns; the mirror rides the snapshot as `ks`,
last-seen kept like the ops notes). Gated by ui-test-keysafe.js (38 checks; §5b's
odsKeysafe call must NOT be awaited — it resolves only when its dialog is answered,
and the awaiting line is what would answer it: a deadlock, hit on the first run) and
ui-test-yourstay §20 (the guest renderer shows what the server sent, promises only a
dated `door_code_from`, and says NOTHING otherwise — no empty row, no guess). NB
ui-test-yourstay's `openPage(guest, …)` takes a guest OBJECT; `true` crashes
renderGuestBookings on `currentGuest.name.split`.
**THE PAGE WEARS THE FOLD ANATOMY** (the approved demo): each cottage is ONE
verdict fold group — `✓ Code on the safe` / `△ rotate now` / grey
not-recorded/no-upcoming capsules (stCap), the sub telling the story ("Priya
Patel · arrives 12/08 · code is still Dan's") — with the code (the page's serif
figure), the guest-visibility line, Rotate and the encrypted history folded
under. A safe due a rotation HOISTS its whole group into Needs attention
(never repeated below). `.ks-card` stays on the group as the suite's locator;
real clicks on Rotate open the fold first (ui-test-keysafe's `openKsFold`).
Gated by §2b (pulse, hoist, red capsule, fold round-trip — hoist and tone each
break-tested). Presentation only: every keeper rule below is untouched.
**PLATFORM STAYS ROTATE TOO** (owner: "it needs to look at external bookings too" —
the first cut read only dbBookings, so a cottage with an Airbnb arrival tomorrow said
"no upcoming booking"). `keysafeNextBooking` unions direct bookings with OTA
`dbBlocks` (mirror-suppression means a block here is a real external stay); an OTA
stay has NO bookings row, so it is identified by a **stay ref** (`o:<check-in>` —
block ids are re-minted on every sync and cannot anchor a record; direct stays keep
matching on `forBooking`, ref `b:<id>` riding beside). `keysafeSetFor(rec, next)` is
the ONE match rule the page, both duties and the dialog read. The refs are
vocabulary-sanitised at every boundary (`/^[bo]:[\w:-]{1,40}$/` in keysafe-lib +
keysafe.php — garbage reads as none). **The guest reveal deliberately cannot reach a
platform guest** (forBooking 0 never matches a real booking id): the card and both
dialogs say to share the code in the platform's message thread instead, which is the
honest version of "they see it". Gated by ui-test-keysafe §6 (break-tested: deleting
the dbBlocks loop fails all five) + test-integration §18h + the lib's ref cases.
**THE KEEPER IS A PER-COTTAGE SWITCH** (owner-asked; the control lives in Settings →
cottage → Private notes, `#ks-toggle-<pk>` — an iOS-style ON/OFF SWITCH now,
`.chb-switch`: the REAL checkbox sits on top at full size with opacity 0 so
gates that click/read it by id keep working, the track + thumb underneath draw
the state, and a failed save still puts the input back). A switched-off cottage is **HIDDEN from
the key screen entirely — no off-card, no footnote** (both were built and removed at
the owner's ask); the Settings checkbox is the one way back on. `enabled` rides the
SAME record — default ON, only an
explicit false disables, so pre-toggle records keep working and garbage can never
switch a cottage off by accident (keysafe_read). OFF means: no rotation duty on
either dashboard, and **my-bookings.php withholds the reveal even inside the window**
(the break-test's failure mode is the code served while off). The record and history
are KEPT — back on finds everything as it was. Three traps from building its gate,
each general: `#accom-detail input[type=checkbox]` matches OTHER sections' hidden
checkboxes (target by id); a bare `<input type=checkbox>` in that panel renders at
ZERO size (the exp-recurring idiom `style="width:auto;margin:0"` is load-bearing);
and the Manage section id is **'accom'**, not 'accommodations' — poorsignal §9d
"worked" with the section invisible because it only tested DOM presence. Gated by
ui-test-keysafe §7 (drives the REAL checkbox) + test-integration §18i + the lib's
enabled cases, the duty guard and the reveal guard each break-tested in isolation.

## Where you were, and sending things once

- **A RELOAD COMES BACK TO THE SCREEN YOU WERE ON** (`chbNavRemember`/`maybeRestoreView`,
  internal key **`chb-nav`** in sessionStorage; gated by **`ui-test-resume.js`**). There
  is no router — `nav()` just toggles `.page-view.active` — so a refresh dropped the
  owner back on Today however deep into a task they were, and the app reloads ITSELF
  where that hurts most: `startVersionWatch` when a new build ships, and the stale-cache
  self-heal. sessionStorage on purpose, not localStorage or the URL: a reload keeps the
  tab so it survives, opening fresh tomorrow starts clean, two tabs cannot fight over one
  view, and the URL is deliberately kept clean here (`?open=`/`?unsub=` are both
  replaceState'd away) - view names in a shared link would leak the back office's shape.
  **THE FOLDER IS PART OF THE PLACE.** The Inbox is three folders behind ONE view id, and
  its email folder has its own Inbox|Sent switch, so `view-inbox` came back to Enquiries
  however deep into the email or the chats you were - while admin.js's own comment beside
  `inboxFolder` already promised "the owner comes back to the folder they were in", which
  is true in-session (the display toggles persist in the DOM) and false across the refresh
  the app performs on ITSELF when a new build ships. `inbox:<folder>[:sent]` joins the
  vocabulary, written by **`inboxRemember()`** - ONE definition, because the folder switch,
  the Inbox|Sent switch and `openInbox()` all have to agree. `openInbox()` calling it is
  load-bearing, not belt-and-braces: `nav()` remembers the plain view id, so tapping Inbox
  while reading email would DOWNGRADE the memory and send the next reload to Enquiries
  (break-tested). The tab is applied AFTER the folder in `chbOpenTarget`, because switching
  to email kicks the lazy `loadMailbox()`.
  **That exposed a live bug of its own: `loadMailbox()` reset `__mbxTab` and `__mbxQuery`.**
  It is a DATA refresh and its own Refresh button (`data-act="loadMailbox"`) reaches it, so
  checking for new mail while reading Sent threw the owner back to Inbox and wiped their
  search - measured, `sent` → `inbox` and `"old"` → `""`. On a first open both are already
  at their declared defaults, so removing the reset changes nothing there; it also removed
  what would have clobbered the tab restore. Gated by ui-test-mailbox (driven by CLICKING
  Refresh) and ui-test-resume §3b.
  **Stored as a TARGET STRING in `chbOpenTarget()`'s vocabulary** (`booking-42`,
  `settings:rates`, `accounts:sweep`, `inbox:email:sent`, `view-experiences`), the same
  dispatcher `?open=` uses - restoring reuses the notification path rather than being a second way to
  navigate, and both speak the numeric db id. Refuses, each break-tested: an owner target
  for a signed-out visitor, anything older than `CHB_NAV_TTL_MS` (4h, forgotten as it is
  refused so it cannot retry), a view that no longer exists, and any explicit destination
  (`?open=`/`?unsub=`/`?pay=`/`?acctpreview=`) - which always wins. Cleared on both logout
  paths, and the clear must come AFTER their `nav('view-main')`, because nav() remembers
  where it went and a forget before it is overwritten a line later.
  **IT DID NOT WORK WHEN FIRST SHIPPED (#875), AND THE TEST WAS WHY.** The suite called
  `maybeRestoreView()` by hand after signing in, which proved the FUNCTION and not the
  FEATURE — driven by the real boot it restored nothing, every time. Two causes, both
  ordering: (1) the boot's own default landing calls `nav()`, and nav()'s remember hook
  overwrote the stored target with `view-backoffice` BEFORE the restore read it back —
  hence the load-time snapshot (`__chbNavAtLoad`), read at parse time, before any nav()
  can fire; and (2) `renderBookings`' wide-split auto-select called
  `openBookingHub(id, true)`, and `quiet` only suppressed the SCROLL, so docking the
  first booking NAVIGATED to Today the moment the bookings finished loading — measured,
  the restore landed view-inbox at 260ms and this pulled it to view-backoffice at 367ms.
  `quiet` now means "dock it, don't move the owner", which also stops the same auto-dock
  clobbering a tapped `?open=` notification at =1200px. The suite drives the real boot
  now (a stubbed `admin_status` signs the page in on its own) — the only version of the
  assertion that can fail when the ordering is wrong. NB the call site was ALSO moved to
  after `setAuthUI`, but break-testing shows that one is belt-and-braces: setAuthUI
  leaves an owner alone once they are on an admin view.
    **`findBookingById` now accepts EITHER id form**, which fixed a live bug on the way
  past: the click path holds the client id (`'b42'`) while anything from the server holds
  the numeric `dbId`, so `?open=booking-42` from a tapped "Payment received" notification
  never resolved and bounced the owner to Today claiming the booking was gone.
- **NOTHING IS SENT TWICE** - two layers, because neither survives every case. And a
  WITHDRAWN third, recorded here because it looks like the obvious first thing to build
  and is a trap: **`apiPost` must NOT coalesce an identical request already in flight.**
  It shipped (#875) doing exactly that - same endpoint + same body returns the SAME
  promise, so a double-tap resolves from the first send - and the flaw is that `apiPost`
  is not a write channel, it is the app's ONLY POST channel, and several of the busiest
  calls through it are READS (`email_logs`, `history`, `deposit_returns`,
  `recent_payments`). Two identical reads are indistinguishable by endpoint + body, so a
  read issued AFTER a state change can be answered by one issued BEFORE it - an email log
  fetched after a send showing the state before it, which invites sending the same email
  again: the very failure the guard was for, pointing the other way. Measured, not
  theorised: it made `ui-test-poorsignal` lose a store it exists to keep, about one run in
  three (4 of 4 green with the guard removed). If a future send genuinely needs
  collapsing, do it where the INTENT is known - never here. `test-payrail` ratchets its
  absence, and `ui-test-resume` §5 asserts two overlapping identical reads are two
  requests. (One lesson from it worth keeping: the cleanup was `p.then(clear, clear)` and
  never `.finally()`, because finally returns a derived promise that RE-THROWS with
  nothing handling it, so every failed write raised an unhandled rejection - four guest
  ui-suites began reporting "Database connection failed" as a page error, which is how
  that one was caught. Applies to any promise bookkeeping added here.)
  (1) **The `data-act` dispatcher disables its own control** while an async handler runs,
  with `aria-busy` so it reads as working rather than unavailable - one guard replacing
  25 hand-written `disabled` pairs and the ones never written. `<button>` only: disabling
  a checkbox mid-change breaks it (break-tested). The `typeof r.then` half is defensive
  only - the surrounding try/catch already re-enables on a non-promise. This covers every
  send affordance in the app: there are no inline `onclick`s left in `index.html` or
  `admin-views.html`, and none are generated for a send.
  (2) **The server refuses a repeat inside a window** (`resend_guard` →
  `recent_send_at`, `CHB_RESEND_GUARD_SECONDS` 180, `chb_ago` for the wording), because
  the client layer does not survive a reload mid-request or a second device - those arrive
  as genuinely new requests. Deliberately a WINDOW, not a lock: chasing the same balance
  next week is necessary, and only the second copy in the same breath is never wanted. An
  unreadable activity_log lets the send through - a duplicate email is a smaller failure
  than being unable to chase.
  **THE REFUSAL HAS TO REACH THE OWNER, AND AT FIRST IT DID NOT.** It answered
  `json_out(['error' => …], 200)`, and `apiPost` only throws on a NON-2xx - so nothing
  inspected it. Measured in a browser: `requestPayment` toasted **"Balance request sent -
  £NaN"** (`res.amount` absent) and `chbBulkRun` did `sent++` and added that guest's
  balance to the "chasing £X" total, so re-running a half-failed batch reported "3
  requests sent · £955 chased" for a batch the server sent NONE of. A guard that reports
  the opposite of what happened is worse than no guard. `resend_guard()` is now the ONE
  composer for the refusal - **409** (the request conflicts with the record's state; it is
  not malformed and nothing is broken) plus **`code: 'already_sent'`**, carried through by
  `apiPost` (`apiErr`, which builds the error with `Object.assign` so `status`/`code` are
  part of the type rather than hand-assigned onto a bare `Error`). One sentence shape for
  every send, so the call sites cannot drift.
  **"ALREADY WENT" IS ITS OWN OUTCOME, distinct from both "sent" and "failed".** Re-running
  a half-failed batch is meant to be safe - it recomputes from live `paymentSummary`, so
  whoever still owes is chased again, and a guest emailed a minute ago still owes - so the
  window refuses exactly those, correctly. `chbBulkRun` buckets them into `already` and
  reports "Richard Berry already had it just now"; folding them into `failed` would say
  "couldn't reach Richard Berry" about a guest holding the email. A batch where EVERYONE
  already had theirs is not thrown as an error either: the set is in the state the owner
  asked for. On the single path an `already_sent` is a plain toast, not a `glassAlert`
  reading "Couldn't send".
  **AND A MAIL FAILURE IS A FAILURE, in every send.** The refusal was only half of it:
  three of the four send actions ALSO answered a genuine SMTP failure with
  `json_out(['error' => …], 200)`, so the identical false reports arrived from a dead mail
  server - `£NaN` on the single path, a counted send in bulk, and a green
  "Balance request sent to Sarah" strip (the inline `balance` action renders off
  `previewAndSendEmail`'s boolean) sitting beside a `glassAlert` saying the opposite.
  `send_arrival` had always used **500**; `request_payment`, `send_confirmation` and the
  legacy `hold_request` now match it, which also made the two hand-written
  `if (res && res.error)` checks in app.js unreachable, so they are gone - checking a 200
  body for an error is the shape that caused this, and it should not be modelled anywhere.
  Gated by test-payrail (three 500s, zero 200s, the confirmation's own line) and
  ui-test-command's MAILFAIL block, both break-tested in both directions.
  **APPLIED TO `request_payment` AND `send_arrival`** - the two whose content is GENERATED
  from the booking, so a second copy in the same breath is never a different message, and
  both of which also go over a bulk set. **NOT `send_confirmation`**, deliberately and
  gated as such: the normal flow is add booking → record the deposit → confirm, which fires
  `add`'s own confirmation and then this one within a minute or two, and those two say
  DIFFERENT things - a window there would refuse a genuinely different message.
  **And `previewAndSendEmail` reports the SEND, not the CONFIRMATION.** It used to
  `return !!ok` after awaiting `doSend`, and every `doSend` handles its own errors, so
  nothing threw for it to notice - an inline act strip said "sent" for a send that had
  failed or been refused. A `doSend` returning `false` now means "it did not go"; returning
  nothing keeps the old meaning, so no caller shifts by accident. Gated by test-payrail
  (the helper's status/code, all three wiring decisions incl. the deliberate omission) and
  ui-test-command, which drives the real dialog against a stubbed 409 - break-tested by
  putting the refusal back to 200, which reproduces both "Sent 2 of 3" and the £NaN toast.

## What every guest downloads, and what every guest query costs

- **THE CROWN IS A FILE.** `CHB_CROWN_PNG` was an 8,070-byte PNG as a base64 constant
  in app.js — **10,067 gzipped bytes, 3.7% of the file every anonymous visitor
  downloads**, and base64 is the one thing gzip cannot help with — for a mark ONLY
  `downloadInvoice`'s letterhead has ever drawn. It is `crown.png` now, fetched lazily
  beside jsPDF (`Promise.all`, so it adds no wall clock), memoised, and **never fatal**:
  a failed fetch returns `''`, clears the memo so the next export retries, and the
  letterhead prints without the mark. Two traps: the build stamp is **`window.__BUILD`**,
  not `BUILD` — the `const BUILD` at the foot of app.js is inside its own IIFE and is in
  scope nowhere else (smoke-test's vm caught it as a ReferenceError, and the browser
  would have too); and crown.png stays **OUT of the sw.js CORE precache**, or guests
  precache an owner-only asset and the saving is spent again. Gated by smoke-test's PDF
  section, which now serves the real bytes through a stubbed fetch and asserts the
  drawn image **equals crown.png byte for byte** — moving an image is only a win if the
  letterhead is unchanged, and a wrong base64 encoder draws noise, not nothing — plus a
  RATCHET: no `data:image/…;base64,` over 1KB may ride app.js or guest-app.js again.
  Deliberately a size threshold, not a ban: a 1px spacer is a fair thing to inline.
  Budget lowered 274800 → 265600 to lock it in.
- **A FINISHED PAGE IS NOT HELD BACK BY A SESSION CHECK** (gated by ui-test-poorsignal
  §10, all five declarations break-tested). `#loading-overlay` is an opaque `#121316`
  at z-index 5000 and was removed only in the boot's `finally` — i.e. after
  bootstrap.php AND both session POSTs. Measured at Slow 4G (CPU ×4): first paint
  **1,820ms is a crown on black**, reveal **7,049ms**, while a 2,500ms screenshot with
  it suppressed shows the hero photo, both headlines, the CTA, the stats and all three
  cottage cards, complete and correct — the static cards carry no prices, so nothing
  above the fold is a placeholder. It now hides as soon as the content render block is
  done: reveal **5,959 → 5,245ms**. **GATED ON NEVER-SIGNED-IN**, because the cost lands
  on the other side — an owner or returning guest would watch the anonymous view flash
  past for the length of the session check, and that is the population who use the app
  most. The `finally` call stays as belt-and-braces (hideLoadingOverlay returns early
  once `fade-out` is set), so the fast path costs the slow path nothing. That needed a
  guest twin of `chb-was-admin`: **`chb-was-guest`**, written from the VERDICT in
  `restoreGuestSession`, cleared by `guestLogout`, and deliberately NOT touched in the
  catch — a dropped request is not "signed out", the same rule the admin hint follows.
  §10 drives it with **auth.php HANGING**, which is the whole question: if the reveal
  still waited on the session, a hung one would never reveal at all.
- **THE FONTS ARE PINNED BY THEIR OWN CONTENT HASH.** htaccess serves woff2
  `immutable, max-age=31536000` under a comment claiming "CSS/JS/fonts are cache-busted
  with ?v=…" — and the two font URLs carried **no pin at all**, so a re-subset or a
  weight-axis fix would have been invisible to every returning visitor for a YEAR with
  no way to bust it. `?v=<first 8 hex of sha256>` now, on the `@font-face` **and** the
  index.html PRELOAD, which must match byte for byte or the preload warms a URL nothing
  asks for. Content-derived so nobody has to remember a stamp: smoke-test §12f
  recomputes the hash and fails with the value to paste in.
- **AN EMAIL LOOKUP IS PLAIN EQUALITY — never `LOWER(email) = LOWER(?)`** (migration-112,
  gated by test-integration §21). Wrapping the indexed column in a function makes
  `idx_email` unusable. Measured on the real schema with 5,036 rows: `email = ?` plans
  **ref / idx_email / 1 row**, the LOWER() form plans an **index scan of all 5,036** —
  on the query `my_bookings_payload` runs every time a guest opens their stays. Twelve
  sites swapped; `enquiries.php` had already worked this out and said so in a comment
  nothing else followed. Plain `=` is case-insensitive here only because the columns
  collate `utf8mb4_general_ci`, which was **inherited from the server default**, i.e.
  true by luck — migration-112 states it outright on `bookings`/`enquiries`/`guests`
  (a no-op on a correct install, a fix on a wrong one; a MODIFY keeps `idx_email` and
  the guests UNIQUE key, both rebuilt under the stated collation). §21 checks all three
  legs — the collation, the BEHAVIOUR through the real endpoint (a mixed-case stay must
  reach a guest whose session was minted from the lower-case form), and the PLAN — and
  break-testing the collation to `utf8mb4_bin` reproduces the harm exactly: the guest's
  own booking list comes back **empty**. The plan check asks `possible_keys`, not `key`:
  that is whether the index is USABLE, which is what the wrapper destroyed, and unlike
  the optimiser's final choice it is stable at any table size. Out of scope on purpose:
  `LIKE` searches and `SELECT LOWER(email)` projections — neither can use the index
  anyway, so forbidding them would fail on correct code.

## The round-2 bug sweep (bug-CLASS lenses), and the postures it set

Hunted along classes rather than subsystems (clock/TZ, escaping, NaN money,
races, PHP type traps, wiring) — 26 confirmed fixes, PR #1206. What future code
must keep doing:
- **A write that preserves absolutes RE-READS UNDER THE LOCK.** bookings.php
  `update` read $b before book_lock and wrote deposit_paid/payment back from
  that snapshot — and the lock WAIT widened the window (an edit blocking on a
  pay.php charge landed its stale write the instant the charge finished; the
  cash twin via set_payment, which had NO lock, was lost outright). Both
  re-read now. Gated by **test-integration §32a**, which reproduces the
  interleaving for real: hold the prop's book_lock on a second connection, fire
  the edit in a child process, wait for it to PARK (probe the processlist for
  `state = 'User lock'` — NB a text probe's own query literal matched ITSELF on
  iteration 0, and db.php's real server-side prepares mean `info` shows only
  `GET_LOCK(?, 30)` anyway; the wait STATE is the honest signal), land the
  charge, release, assert the money survived. Break-tested both ways.
- **AN ACTION THAT MOVES MONEY OUT RIDES THE OP LEDGER, and its terminal
  marker lands BEFORE its slowest step.** `cancel`'s only terminal state was
  the row DELETE, placed after the SMTP send — a timeout retry re-ran the
  whole action and record_square_refund's key deliberately differs once money
  has been refunded, so Square paid the typed refund TWICE. op_claim + client
  chbOpFor stamp + DELETE moved above the email. §32b gates the replay.
- **EVERY GUEST-EMAILING AUTOMATION CLAIMS BEFORE IT SENDS**, with rowCount as
  the arbitration and an un-claim on a CLEAN failure (failed-send-keeps-the-
  wait unchanged). The overlap is by construction, not bad luck: the outbox
  kick fires from ordinary traffic at exactly the moment self-repair walks the
  same backlog, and waitlist_notify_freed has three concurrent triggers (the
  per-device iCal sync among them). A `static $draining` flag is per-process
  and guards nothing across FPM workers. Stamps that legitimately re-fire
  (reminders) claim on RECENCY, not IS NULL. New cron sender = same posture.
- **The tide window anchors at Europe/London midnight and every tide time is
  rendered on the QUAY'S clock** (`ukClockHm`/`ukDateOfInstant` in app.js —
  the guest renders formatted on the visitor's device; a Berlin guest read
  every tide an hour off). chbCoastRow also filters extremes to the asked
  London day. The sibling traps fixed with it: anniversary-nudge's ±N*86400s
  window slipped a day across DST (noon-anchored day arithmetic now) and
  conflict-audit's `gmdate` today re-logged finished conflicts for the
  00:00–01:00 BST hour.
- **`?:` vs `??` on NOT-NULL-DEFAULT columns**: the value a cleared form field
  stores is `''`, never null — `?? '15:00'` was a dead branch and
  `strtotime('2026-09-06 ')` is MIDNIGHT, so the confirmation's .ics told the
  guest their stay begins at 00:00 (gated in test-payrail). The same conflation
  the other way: a £0 price override (a comped stay) read as "no price"
  through `?:` at three sites outside booking_amount_due's documented
  one-predicate fix.
- **The trip planner is REMOVED, not lost**: its opener vanished in an old
  refactor and the whole feature (modal + planner code every guest downloaded)
  shipped unreachable for months. Deliberate now — resurrect from git if ever
  wanted. Same sweep wired the two genuine lost affordances instead:
  `?open=stay` (the guest emails' "Open my booking" button routed to the
  homepage — it opens My Stays/sign-in now, ui-test-topmenu §I) and the
  orphan-payment flag's "one tap" (activity-log rows carry a CLOSED `act` for
  exactly `selfrepair.square_orphan` → "Record it on the booking" →
  record_square_payment, §32c gates that no other row grows an action from
  log data).
- **gbp() renders £— for non-finite input** — the honest refusal that turns
  the whole response-shape-drift class (£NaN toasts) into a visible dash.

## The round-3 sweep (lifecycle / staleness / caps / privacy / migrations)

Six more class lenses, each candidate put to three adversarial skeptics before it
earned a fix — 14 confirmed, 1 refuted (PR #1208). The rules it set:
- **A CONSENT THAT HAS BEEN SPENT NEEDS ITS OWN MARKER, and it is a DATE.** A
  single autopay collection has no `autopay_next_at` to advance — NULL before AND
  after — so the only thing standing the plan down was "nothing is owed", and
  REFUNDING that collection made the outstanding match the agreed amount again
  exactly: 'armed', and the collector (which re-selects the row every night once
  the due date has passed) charged the card AGAIN the night after the owner
  deliberately refunded it, with no advance notice — the pre-debit window having
  closed with the due date. `autopay_collected_for` (migration-122) is the marker
  the MONTHLY branch always had. Dated, not a flag, for `autopay_notified_at`'s
  own reason: a plan the owner genuinely moves on is a NEW agreed day, so the
  consent is live again BY CONSTRUCTION, where a flag would have to be
  remembered-to-be-cleared at every site that can move the date.
- **THE CASH RAIL KEEPS FALLING THROUGH CARD-GATED BLOCKS.** Two of this round's
  three money bugs were one shape: a deposit collected in cash (hold_status
  'none', no hold_payment_id) meeting a block written `if ($hs === 'charged' &&
  …)`. CANCEL skipped it entirely, so the obligation was destroyed with the row —
  no refund, no `deposit.owed` warn, the owner told only "Booking cancelled",
  which is verbatim the harm the comment ABOVE that block describes. And
  return_deposit's settle stamp excluded it, so a returned cash deposit was never
  marked settled and the invoice went on promising a refund that had already
  happened, on the page listing it. `damages_collected` and the `$held`
  derivation were rail-agnostic all along — only the WRITES were card-shaped. Any
  new deposit branch: ask what 'none' does before shipping it.
- **"FIXED FOR ONE ROUTE, LEFT FOR ITS NEIGHBOURS" IS A PATTERN HERE, not an
  accident.** availability.php's `?all=1` was fixed so an unlisted cottage stays
  off the public site, with a comment saying so — and the `?prop=` route directly
  below it, which answers the same question about ONE cottage, was left returning
  its whole forward calendar to anyone who named the key. rates.php had the twin:
  `properties` filtered for anonymous callers, `seasons` not, so the private
  cottage's key, season labels and nightly rates shipped anyway. When a privacy
  or authorisation fix lands, sweep every OTHER route that answers the same
  question — including the one that answers it about a single row.
- **`migrate.php?force=1` REDOES SCHEMA, NEVER DATA.** force exists to repair a
  wrongly-baselined database, and its safety argument is that the DDL is
  idempotent — which says nothing about the DATA backfills two migrations carry.
  Re-running them re-verified every guest account that had since registered and
  NOT proved its address (silently undoing migration-111's whole control) and
  reset each original cottage's refundable deposit to £75 over the owner's own
  figure. `migration_stmt_is_schema` decides, and it is an ALLOWLIST
  (CREATE/ALTER/DROP/RENAME/TRUNCATE TABLE): anything unrecognised counts as DATA
  and is skipped, because skipping leaves the database as it was while running
  one wrongly overwrites live values.
- **A COUNT OR A SUM OVER A CAPPED LIST IS A WRONG NUMBER, not a short list.**
  Two shipped: the day sheet counted "5 upcoming" AFTER slicing to five, and the
  AI chat's grounding pack — which rides EVERY ask and which the model quotes as
  fact — counted and totalled money owed over rows already trimmed to 12. The
  rows stay capped (a chat answer is not an export); the TOTALS are carried
  beside them from the full set. Cap the list, never the arithmetic.
- **A SHARED COMPOSER OR PANE MUST RE-CHECK WHOSE TURN IT IS.** Three of this
  round's async bugs were one node serving many records: `draftEnquiryOnMac` laid
  the Mac's draft into whatever enquiry was open when it landed (its sibling
  `draftChatOnMac` has exactly this guard, with a comment about not putting guest
  A's draft in guest B's box); `mailboxOpen` painted a slow IMAP read into the
  shared reading pane with no re-check; and `openEnquiryEmail` never undid the
  arrival-review DRESSING of the shared modal, which only `openBookingEmail`
  took back off. The stamp-guard rule generalises: whatever an async write
  targets, check the target still belongs to the request that started it.
- **THE DAY SHEET IS THE DESTINATION OFFLINE.** `maybeRestoreView` had no offline
  guard, so a no-signal reload put the sheet up and then walked the owner off it
  onto a remembered screen whose data never loaded — an Inbox reading "All caught
  up" over nothing, its dock button already hidden by the trim. The memory is
  KEPT and honoured when the signal returns.
- **AND A GATE CAN ENCODE THE DEFECT.** ui-test-offline asserted that accepting
  the offline payment capture's default marked the guest PAID IN FULL — which was
  the bug (the box is an absolute "received so far" and was prefilled with the
  rental TOTAL, so one tap on the no-signal morning recorded money never handed
  over). It had to be re-aimed, not extended. When a fix makes an existing check
  fail, read the check before believing the code.

## The Edit form opened BLANK, and a save with nothing changed lost the agreed price

**Reported as "paid in full by bank transfer but still showing the damage deposit owing"
— three times, and it had three causes** (#1238 the edit wiping `deposit_paid`, #1239 the
Record dialog clamping 310 to 260, and this). The last one was found by building a
throwaway FULL-STACK harness (fresh MariaDB + the real `php -S` + the real client in
Chromium, seeding through the real endpoints) and doing what the owner did — which
reproduced the screenshot to the penny, with the database holding the full £310.
- **`openEditBookingNow` never fed the form the booking's money.** `setModalFields`
  prefills the amount / date / method / deposit / price-override inputs from its argument
  and the call passed none of them, so they opened BLANK — and `saveModal` posts every one
  on every save, `price_override` as `''` meaning "clear it". A paid stay hides those
  inputs (`trimPaidBookingFields`), so a save that changed NOTHING dropped the agreed
  price, wiped the payment method and re-dated the payment to today
  (`togglePaymentDetails` defaults a blank date to today — and `payment_date` decides the
  tax year income lands in). Present in the oldest commit of the clone; the server only
  ever did what it was told ("absent keeps, '' clears" is a fine contract for a form that
  KNOWS the value).
- **Why it read as a deposit bug.** With the override gone the booking has `agreed_total`
  £260 but `agreed_nightly + agreed_txn_fee` at the standard price, and the two frames
  that mean "the rental" disagree: `set_payment`, `update` and the emails use
  `price_override ?? agreed_total`; the hub (`displayGrand`), `damages_collected`
  (`booking_rental_price`) and accounts.php use `price_override ?? nightly + fee`. So
  £310 was stored correctly and the confirmation email said "Paid in full" while the hub
  measured the £50 cash deposit against the STANDARD rental and said £50 owing. **THE
  TELL is on the hub itself**: its note read "Agreed price · agreed …" with no "(custom)"
  while the breakdown row said "Agreed price (custom)" — a custom total with no override.
  When two surfaces of one booking disagree, suspect the frame before the figure.
- **The fix is three parts.** The form is fed `depositPaid` / `paymentDate` /
  `paymentMethod` / `agreedPrice` / `damagesDeposit` / `priceOverride`;
  **migration-123** restores `price_override = agreed_total` for exactly the damaged rows
  (no override, a snapshot that no longer adds up to the total, not the older
  deposit-folded shape, both snapshot lines present, stay not yet over — history and
  closed tax years are never restated; no amount changes, the total is `agreed_total`
  either way); and the gates below. It is DATA, so `migrate.php?force=1` skips it.
- **Gates.** `ui-test-price-lock` §4 opens the REAL form for a custom-priced paid booking
  and asserts what it shows and what a no-change save POSTS (8 checks fail with the feed
  removed, reproducing the real-stack numbers: blank override, date = today).
  `test-integration` §36 runs the migration against seven shapes (lost / standard /
  folded / past / has-override / half-snapshot / no-stored-deposit), twice for
  idempotence — four of its five guards were each break-tested by removing them (the
  fifth, the half-snapshot test, is redundant: NULL arithmetic excludes those rows anyway).
- **What was NOT recoverable or NOT done.** A payment method and date already wiped by an
  earlier edit are gone (the Record dialog re-sets them). The two "rental" frames still
  exist; they now agree for every row the app can produce, which is the cheaper trade than
  unifying money maths mid-incident. And clearing an override on an enquiry-approved
  booking still does not revert the price, because approval stored the agreed figure in
  `agreed_total` as well — the form can no longer do it by accident, but a deliberate
  clear is still a half-action.
- **The general lesson: a stub feeds the client whatever shape you hand it, which is
  exactly why no suite saw this** — every UI gate booted the form from a fixture that
  never asked whether `openEditBookingNow` supplied the fields. The full-stack harness is
  worth rebuilding whenever a symptom crosses the client/server line: seed through the
  real endpoints, drive the real UI, and read the database after each step.

## One rental total: two frames became one rule

The "paid in full but still owing" reports (#1238–#1240) had one root: two definitions of
"the rental". The emails, `set_payment`, `booking_amount_due`, the invoice and autopay read
`price_override ?? agreed_total`; the hub, `damages_collected`, accounts and `damageHeld`
read `price_override ?? agreed_nightly + agreed_txn_fee`. They agree until an override is
lost, and then the negotiated total sits in `agreed_total` while nightly + fee still say
standard — so £310 was stored correctly and one surface said £50 owing.
- **Three named functions in db.php**: `booking_total_shape()` (unsnapshotted / standard /
  custom / mismatch / folded / lost — the predicate migration-123 repairs on),
  `booking_agreed_total()` (override ?? `agreed_total`) and `booking_rental_price()`
  (override wins; a `lost` row's rental IS `agreed_total`; else nightly + fee). Client twin:
  `bookingRentalPure(b, p)` in app.js, fed `hasSnapshot` by the mapper.
- **`folded` legacy rows** keep their deposit inside `booking_agreed_total` on purpose: that
  era's paid-status maths measures against it. The rental is still nightly + fee.
- **ONE fixture file, `rental-fixtures.json`**, looped by test-payrail (PHP), smoke-test
  (client) and test-integration §38 (real stored rows). Add cases there, never to a test.
- **Ratchet**: test-payrail fails on a new inline `price_override ?? agreed_total` outside
  db.php. SQL `COALESCE(price_override, agreed_total, 0)` (auth, customers, owner-digest) is
  the same read as `booking_agreed_total` and is deliberately left.
- **Manage → System check → "Booking prices"** (diagnostics.php) warns if any upcoming
  booking is still `lost`.

## Swiping a Needs-you row away

**Asked for from a screenshot of "Tina Nudd's details are not on the register"** — a
row the owner could do nothing about at that moment and could not clear. A swipe left
on a Needs-you row dismisses it, with an Undo toast.
- **WHAT A DISMISSAL MEANS IS NARROW ON PURPOSE.** The row stops nagging *at the level
  it was dismissed at* and comes back the moment it gets WORSE: the record is
  `{sev, at}` and the row is hidden while its current severity is ≤ the stored one, so
  amber → red resurfaces it ("the duty escalates rather than nags", already how a read
  enquiry returns at two days). The FACT is untouched — the register is still
  outstanding on the booking hub, the money in Payments, the enquiry in the Inbox. An
  entry also lapses after 120 days, the map is capped at the newest 200, and none of it
  is shown anywhere once dismissed (see below).
- **THE FILTER IS IN `chbDuties()`, NOT ON THE STRIP.** The composer became
  `chbDutiesAll()`; `chbDuties()` is its filtered view, because the strip, the Home
  Screen badge, the spine chips, the search brief and the AI chat's welcome all read
  `chbDuties()` — hiding a row on one surface would leave a badge saying 3 over a strip
  of 2. `chbDutiesAll()` is what the dismissal itself reads.
- **A DUTY IS DISMISSIBLE ONLY IF IT WAS GIVEN AN IDENTITY (`key`)**, and only five kinds
  were: `register:<id>`, `balance:<id>`, `deposit:<id>`, `enquiry:<id>`,
  `arrival-review:<id>`. A stopped automation, a failed payout, a dispute, a refused
  offline write, a failed autopay, a stuck calendar sync, a quiet Mac and a key-safe
  rotation have none, so a swipe on them does nothing — they are resolved at the source —
  and a new kind starts life un-dismissable. The aggregates (chats, new emails, approvals)
  are not dismissible either: "3 chats" has no identity, and a stale entry would swallow
  the NEXT unrelated chat. The stored-entry pattern is a closed
  `^(register|balance|deposit|enquiry|arrival-review):\d+$`, so a hand-edited row cannot
  hide an alarm. The Manage → Pricing page reuses `.ny-row` markup and deliberately has no
  `data-nykey`.
- **IT RIDES THE BOOT PAYLOAD.** Internal content key `duty-dismissed`, saved with
  `saveContent` (mirror-first on a serialised chain, the pins store's shape) and carried on
  `admin-bootstrap.php` as `dismissed` (an OBJECT on the wire — `(object)` — never `[]`).
  An internal key is absent from the page's content at first render and the strip paints
  at boot, so read any later a dismissed row would flash back first. app.js stashes it as
  `window.__dutyDismissedPre`; `chbDutyMap()` adopts a NEW payload only while none of our
  own saves is in flight, so a refresh that raced a swipe cannot put the row back.
- **THE GESTURE** (admin.js `nySwipe*`): pointer events, so one path serves a finger and
  a mouse; `touch-action: pan-y` leaves vertical scrolling to the browser (without it a
  horizontal touch drag is `pointercancel`led and nothing dismisses); the row follows on
  `translate` (an individual property, so it composes with the press scale); a "Dismiss"
  panel is uncovered in the gap it leaves (`.ny-reveal`, one per drag, sized by JS, so
  nothing wraps the rows and the HIG join rules keep working). Past a third of the width or
  a flick it goes; short of that it springs back. **The spring-back and slide-out are Web
  Animations, not a CSS transition** — restating the row's `transition` list would silently
  drop what the late shared press rule gives it. A swipe's own click is swallowed in the
  capture phase, **keyed to the ROW that was swiped** (600ms): the first version swallowed
  every click for 400ms, which ate the very next tap on a different row — the suite found it.
  A row whose duty was resolved while it sat there (the guest filed the register) swipes
  into a refresh of the strip rather than a bounce back. Reduced motion removes the row at
  once.
- **THE KEYBOARD PATH, AND ITS LIMIT.** A swipe is a dragging movement (WCAG 2.5.7), so a
  focused row also dismisses on Delete/Backspace (`aria-keyshortcuts`, and
  `aria-describedby` → a screen-reader-only hint). There is still NO visible
  single-pointer, non-drag control; a button inside each row would be a button inside a
  `<button>`, and wrapping the rows would break the joined-list rules — offered, not built.
  Likewise there is no "show dismissed" list: the Undo toast (8s, pauses on hover/focus),
  escalation, and the fact living on in its own screen are the safety nets.
- **THE TRAPS.** `renderNeedsYou` is scanned by test-webpush for a 700-character window
  from its name to `setAppBadgeCount` — the gesture setup sits AFTER the badge call. tsc
  infers the duty shape from the first `push` (the cron row, which has no `key`), so the
  one read of `.key` needed a cast. The first gate for the click guard was VACUOUS: a real
  touch drag never ends in a click, so removing the guard failed nothing — only a MOUSE
  drag ends in one on the row it started on, which is the path the gate now covers.
- **A REFRESH MID-DRAG WAITS FOR THE FINGER** (`__nyRenderLater`, `nyRenderDeferred`). Found when the suite
  flaked in CI: the calendar's own auto-sync (`autoSyncIcalBlocks`) reloads the bookings on its own timer, and
  `renderNeedsYou` rebuilt the strip mid-swipe, so the row vanished from under the finger and every later move
  threw on the detached node (`nyReveal` read `parentNode` of null). `renderNeedsYou` now defers while a swipe is
  on, the gesture's end runs the deferred render, and a row that is detached anyway stands the gesture down. Gated
  by ui-test-dismiss §8 (break-tested: removing the deferral fails all three). The suite itself now holds the
  bookings refetch from the moment its page is quiet: `autoSyncIcalBlocks` calls app.js's `loadData` directly, so
  the window stub never saw it. Measured under six concurrent copies: the old suite failed 3 of 6, the new one
  0 of 18.
  **A swipe test must let DISTANCE decide, never speed**: §8 dragged a fixed 330px on a ~1100px row at 1280, short
  of the 35% rule, so the dismissal rested on the drag also counting as a flick; under load it doesn't (main failed
  4 runs in 4 at eight concurrent copies). It drags past half the row now (47 of 48 under the same load).
- **Gates.** `search-test` §40 A6 (identity per kind, hidden/escalation both ways, no entry
  can hide the cron row, malformed and lapsed entries, the write + Undo, refusals, the cap,
  adoption mid-save), `test-integration` §37 (private, on the boot payload as `{}`,
  truncated at 400), and `ui-test-dismiss.js` driving REAL touch (CDP) and mouse input:
  dismissible rows and the hint, a short drag springing back, a vertical drag left to
  scrolling, a full swipe (one save, the toast, the badge, the count), Undo, the stopped
  automation refusing, a tap still opening, the mouse and Delete paths, the boot payload
  honoured at first render, reduced motion. Twenty declarations (sixteen client, four
  server) were each break-tested in isolation — and FOUR of the first sixteen survived,
  every one a gate that could not fail: the click guard (touch never clicks), the key
  pattern (an ancient test entry lapsed on its own), the public-GET check (the payload is
  `{content: {...}}`, so it looked at the wrong level — and so had the night-shift check it
  was copied from, now fixed with a positive control), and a hub-opened check that looked
  500ms too early. Proven end to end on a real PHP + MariaDB + browser stack: a touch swipe
  saves `{"register:N":{sev,at}}`, a second device never paints the row during boot, and
  moving the arrival to tomorrow brings it back red. Budgets raised: admin.js +3.1KB, admin.css +0.4KB gz (owner-only,
  immutable-cached; app.js took one line and stayed inside).

## The maps: a third party defaced them and nothing noticed

**Reported from a phone**: "Where you'll be" on the Pimpernel page showing
`API KEY REQUIRED / carto.com/basemaps/apikey` painted diagonally across
Blakeney. Both maps were affected — the cottage page's and the desktop
cottages-list pane — so every guest checking where they'd be staying saw a
defaced map.
- **THE FAILURE MODE IS THE POINT: CARTO ANSWERS 200.** They did not start
  403ing unkeyed traffic, they started *drawing the words on the tile* — so
  there is no error, no failed request and no console warning anywhere for the
  app to notice. Verified it is not a rate limit and not one style: `voyager`,
  `light_all` and `dark_all` all deface, at every zoom. **A dependency can
  degrade its OUTPUT while its status stays green**, and nothing that watches
  for errors will ever see it. This is the general lesson; the map is just
  where it landed.
- **RESOLVED: CARTO Positron, keyed** (owner created a free CARTO account and
  supplied the key). The site is back on the look it had, minus the watermark,
  and better: Positron rather than Voyager, and `{r}` restores the `@2x` retina
  tiles OSM could not serve. **The parameter is `key`, and testing it was the
  whole point**: `api_key` — the obvious guess, and what older CARTO docs
  use — is **silently ignored**, so a bogus key, a wrong parameter name and no
  key at all all return byte-identical watermarked tiles at 200. A wrong param
  is indistinguishable from a wrong key, and neither errors. Verified by
  HASHING: a real key returns a different tile, a deliberately bogus one falls
  back to the watermark. `maxZoom` is 20 (CARTO over-zooms past its raster
  ceiling rather than 404ing, so nothing tells you when you overshoot).
  **The key is PUBLIC by design** — it rides every tile URL the browser
  requests, so it cannot be secret; CARTO's own domain allowlist is the
  protection, and the console is where to set it. Free tier is 5M tile
  requests/month, which a three-cottage site will not approach.
  **AND THE FILTER WAS REMOVED, by looking.** The `saturate(0.55)` existed to
  calm OSM's loudness; carried onto Positron it only SUBTRACTED — rendered side
  by side it washed Blakeney Cut and the saltmarsh to nearly the page colour,
  losing the water on a coastal village's map. A treatment tuned for one
  basemap is not a property of the app; re-judge it whenever the tiles change.
- **The interim was OSM's own tiles, and TWO details were load-bearing**,
  both measured rather than assumed. The `{s}` subdomain is not decoration:
  the CSP allows `https://*.tile.openstreetmap.org`, and **a CSP wildcard
  matches subdomains but never the apex** — the same rule `csp-lib.php`'s own
  tests pin — so the obvious-looking bare `tile.openstreetmap.org` would be
  blocked and paint an empty box with no error. And `maxZoom` is **19**,
  because OSM answers **400** above it; the old prop-map copy said 20, so a
  guest pinching to full zoom would have got blank tiles.
- **`MAP_TILES` is ONE DECLARATION, TWO THEME URLS** (superseding "the URL
  stated ONCE"). The two maps each carried their own copy and had already
  drifted — maxZoom 20 against 19 — which is how the zoom trap above was
  sitting there before the provider change; and the one URL left was
  `light_all` whatever the body class, so in the DEFAULT DARK theme the map was
  a sheet of white on a near-black page (measured on the screenshot: the map
  box mean luminance **240.5** against a page ground of **21.7** — the
  brightest thing on the page and the only surface ignoring the theme). CARTO
  serves Dark Matter from the SAME host under the SAME key, so the CSP entry,
  `{s}`, `{r}` and the ceiling are unchanged and only the style slug differs;
  after, the same box measures **11.9**. Verified by hand that the key is
  load-bearing on BOTH styles — `dark_all` with the key is 25,002 bytes and
  with a bogus key or none returns a byte-identical WATERMARKED tile, exactly
  as `light_all` does. **THREE THINGS MOVE TOGETHER OR THE FIX IS WORSE THAN
  THE DEFECT**: `mapTileUrl()` is the one picker both mounts read;
  `toggleTheme` calls `chbMapTheme()`, which `setUrl()`s the MOUNTED layers
  (both maps outlive a toggle, and the controls are CSS and flip instantly, so
  a layer that waited for the next mount would leave dark controls on a white
  map for as long as the page is open); and the whole `--map-*` set is
  theme-aware now (ink / sub / ground / ctl-bg / ctl-hover / ctl-press /
  ctl-edge / ctl-line / ctl-dim / ctl-shadow / attr-bg), the block having
  carried an explicit "Not theme-aware on purpose … the basemap is light in
  either theme" that became false in the same commit. Measured on the
  composited paint over the dark tile ground: zoom ink 15.3:1, attribution
  11.7:1. **NB Leaflet's own stylesheet paints `.leaflet-container` `#ddd` at
  (0,1,0) and is injected into `<head>` AFTER app.css, so it wins the tie on
  order** — both maps read rgb(221,221,221) under the tiles until the ground
  was restated at (0,2,0), which is what stops a light-grey square flashing
  behind a dark map while the tiles arrive.
- **A BOUNDARY RATIO IS THE WRONG CLAIM FOR A MAP CONTROL**, and the gate's
  first draft made it: a white control on a white basemap measures **1.08:1**
  by construction and always did — its distinctness comes from its ring and its
  shadow, not its fill. What must hold is that the control and the map are the
  same SIDE of the theme, which is what ui-test-cottagepage §2 asserts (fill
  luminance < 0.15 dark, > 0.4 light) alongside the ink-on-its-own-ground AA
  reading. Same shape as the lightbox half: a dark disc on a dark scrim is
  1.03:1 and rightly so, because the glyph is the affordance.
- **What is NOT as good, said plainly**: OSM standard serves no `@2x` tiles,
  so on a retina phone the map is a touch softer than the CARTO layer was.
  Legible beats defaced. Restoring Voyager needs a CARTO account and key,
  which is the owner's to create — and the key would then need adding to the
  URL *and* the host is already CSP-allowed, so it is a small change.
- **The tiles are CALMED, and the value was chosen by LOOKING.** OSM's style
  is tuned for a white page and shouted against this cream one. `saturate(0.55)
  brightness(1.03)` on **`.leaflet-tile-pane` only**, so the accent pin and the
  zoom control keep their own colour — a filter on the whole map takes the pin
  with it. Three strengths were rendered and compared: 0.72 still read busy and
  0.40 washed the channel and the saltmarsh to the same grey as the houses,
  which is a real loss on a coastal village where the water is half of why
  anyone opens the map. Labels are ink, so saturation never costs legibility.
- **`test-maptiles.js`** (26 checks, CI-wired, deploy-excluded) gates what is
  cheaply checkable: TWO URL literals both inside the one declaration and
  differing ONLY in the style slug, both call sites reading `mapTileUrl()`,
  `toggleTheme` swapping the live layer, a key on EVERY theme's URL, the
  host permitted by the SHIPPED `img-src`, and the zoom inside the provider's
  ceiling. Deliberately **no network** — a suite that fetches live tiles fails
  for reasons that are nothing to do with this codebase, the call `test-ical.php`
  already makes about Airbnb's feed. Break-tested four ways; the apex-host one
  is the one that matters, since that is the silent blank map.
- **NB the gate's own CSP parse read a COMMENT.** Anchoring on the header's
  NAME matched the prose four lines above the policy explaining when to switch
  it to Report-Only, so `img-src` came back empty — the same shape as a negative
  source scan matching its own explanation. It anchors on the `Header ... set`
  DIRECTIVE now, and **the vacuity guard is what caught it**: a parse that finds
  nothing must fail, not pass.

**AND A BROKEN STYLESHEET PASSED THE WHOLE LOCAL GAUNTLET.** Trimming the
comment above left a `*/` closing early with four stray lines after it — invalid
CSS that silently kills every rule following the break. `check-css-conventions`,
`perf-budget`, smoke-test and typecheck were all GREEN, because every one of
them reads a stylesheet as TEXT — sizes it, greps it — and text does not care
whether it parses. CLAUDE.md already records this class biting once (an
index-based edit ate an `@media` opener and the admin rail stopped hiding at
390px, four sections from the edit) and still nothing checked it.
`check-css-conventions.js` now opens with a **hard structural invariant** — not
a ratchet — asserting comments and braces balance in all three stylesheets, with
comments stripped BEFORE the braces are counted (a `{` inside prose otherwise
reads as a rule and the check cries wolf on correct code). Break-tested against
both real shapes: the half-closed comment and the eaten `@media` opener.

## The round-1 full-site audit (security + regressions + UX)

Five parallel lenses (server security, client security, the Manage regressions,
guest UX in a browser, owner UX in a browser). What it set:
- **REGISTERING AN EMAIL IS NEVER OWNING IT — now for EVERY address, not only
  ones with bookings today** (migration-127 `guests.auth_epoch`). Two holes:
  a PRE-HIJACK (register a guest's email while they have bookings; the account
  sat unverified with the attacker's password, and the victim's own later
  magic-link click stamped it verified — the attacker's password then worked)
  and a SQUAT (register an address with nothing behind it yet; it was stamped
  verified at once, so a booking made later against it landed in the squatter's
  My Stays, door code included). Now: no account is verified at registration;
  an unproven account signs in but `my-bookings.php` returns `unproven: true`
  with no stays (only enquiries THIS browser sent, `$_SESSION['enq_ids']`), and
  every endpoint that matches bookings by email calls
  **`require_guest_proven()`** (arrival-access, guest-checkout, photos submit,
  reviews submit, welcome) — test-auth-posture accepts it as the guest marker.
  `guest_login` refuses an unproven account only while bookings exist for it.
  **Confirming from a browser that did not register** (`$_SESSION['reg_gid']`)
  clears the unproven password (`''` — `guest_change_password` then accepts a
  blank current one), deletes its passkeys and bumps `auth_epoch`, which signs
  out every earlier session on its next request (`guest_session_check`, called
  from `require_guest`/`current_guest_id` and the top of auth.php/push.php;
  sessions are minted by `guest_session_begin`). The client shows "Confirm your
  email to see your stays" with a re-send, and a reset says so. Export carries
  bookings only for a proven account and never `notes` / card handles; delete
  only touches email-matched records when proven. Gated by test-integration
  §19b (break-tested on the my-bookings gate and the consume reset).
- **THE OP LEDGER KEY IS THE CALLER'S** (`op_claim`): `k` + sha256(actor |
  endpoint | op_id). Keyed on op_id alone a stranger could pre-store a success
  under a guessable id (the check-out tap's `gco-<id>-<date>`) on another
  endpoint and the guest's real tap "replayed" it. §30 reproduces the poisoning
  when the scoping is removed. An in-flight retry across the deploy re-runs
  once (old keys no longer match) — accepted.
- **backup.php does work only on a POST or the cron** (§41): require_admin()
  checks CSRF on POST only, so a planted GET link ran (and emailed) a backup.
- **The data-act global fallback refuses platform built-ins** (native code)
  and the request primitives by name (`chbActAllowed`).
- **Times are vetted once**: `chbTime()` at the row mappers, `clean_time()` at
  the writes — free text from a form reached unescaped templates.
- **Owner logout reloads the page** (memory + hidden views held the whole back
  office); guest logout clears the chat token, the enquiry draft and the
  rendered stays.
- **Back closes the owner's sheets too** (edit form, floating thread, email
  composer push overlay history); `adminHistPush` waits for an in-flight
  overlay `history.back()`. **Escape answers the HIGHEST z-index** open
  overlay (the privacy window over the enquiry sheet sits earlier in the DOM),
  and closes the chat.
- Smaller, each measured: the date picker's grid is `minmax(0,1fr)` and drops
  the 1:1 cell below 480px (the Sunday column was clipped 25px at 360);
  picking dates clears step one's own refusal; `.btn-edit:hover` no longer
  sets the label to the page ground (invisible text on hover/after a tap);
  inline `color:var(--danger|--ok)` ink → the `-text` tokens; the hub's state
  capsule, Past-stay test, deposit queue and search "Return deposit" are
  time-aware (`hasCheckedIn`/`hasCheckedOut`); a new booking opens with its
  folds closed; "Bookingcom" → `otaSourceName()`; the rail is 236px (17px
  labels were cut at 220) with the wide composure clamped on-screen; the
  key-safe page counts what the duty counts (due + later); the search brief
  shows three duties plus "N more" rather than dropping the rest; the
  Manage summary and the Status pill no longer use the same words for
  different lists; a literal NUL byte in admin.js (grep read it as binary) is
  the escape sequence again; stale "Manage → System check / Preferences /
  Website content" directions now name the real pages, Mac app included.

## The round-2 audit (money paths + every endpoint's authz)

Two read-only lenses swept the money code and all 116 non-test PHP files; what
shipped and the rules it set:
- **A CASH DEPOSIT IS ALREADY TAKEN** (`booking_damages_due`): the cash rail
  leaves `hold_status` at 'none', which used to read as "not yet taken", so an old
  pay link charged the card for a deposit already in hand and the write-back
  erased the cash record. Money paid above `booking_rental_price` counts against
  it (test-payrail, 5 cases incl. part-rental-paid and the fresh booking).
- **THE TERMS AGREED WITH AN ENQUIRER ARE STORED** (migration-128
  `enquiries.agreed_price/plan_pct/plan_due`, action `set_terms`, mapped by
  `mapEnquiryFromApi`). They lived on the in-memory enquiry only, so any of the
  ~30 `loadData()` refreshes before approval dropped them and the guest was
  charged the standard price after the owner was told otherwise. Approval and
  its preview fall back to the stored terms when the client sends none (§42,
  break-tested).
- **REFUND AND DEPOSIT RETURN RIDE THE OP LEDGER** (client stamps `chbOpFor` +
  `chbOpBump` after success): Square's idempotency key changes once money has
  gone back, so a timed-out retry was a second refund. `cancel` already did this.
- **A COTTAGE MOVE LOCKS BOTH COTTAGES** (sorted, so opposite moves cannot
  deadlock) — the charge locks the ORIGIN.
- **LEGACY `captured` HOLDS** are refunded/owed on cancel like `charged`, and
  keeping one writes no second `damages` row (that doubled kept income).
- **THE SQUARE WEBHOOK'S WRITE IS RAISE-ONLY IN SQL** (`AND deposit_paid <= ?`),
  not just in its read, because it runs without the booking lock.
- **The invoice** caps "received" at the total once a CASH deposit is returned.
- **REPLY-BY-EMAIL HAS TWO AUDIENCE TOKENS** (`msg_reply_token($tid, 'guest')` →
  `<id>y<mac>` under its own HMAC label; `msg_reply_parse` returns [tid, aud];
  `msg_reply_verify` is OWNER-only). The guest's own copy used to carry the very
  token that authorised owner replies, so a guest replying with a forged
  `From: <owner>` posted in the owner's name. mailbox-read routes an admin reply
  only from an owner token; a guest token still lands as a guest message.
  Already-sent guest emails carry the old owner-shape token — a legacy window
  that closes as those threads go quiet. Gated by test-reply.
- **Public doors that cost money or disk**: tides clamps `start` to −1…+60 days
  and rate-limits (each miss spends paid WorldTides credits); an anonymous chat
  upload with no thread behind its token gets 2/hour, not 8.
- **The guest-details link CLOSES a week after the stay (410)** and shows stored
  document numbers MASKED (`••••1234`); posting the mask back unchanged keeps the
  stored number. **The welcome book** only opens for a current/upcoming stay.
- **GET never does owner work**: `push.php test_admin` and `webp-backfill.php`
  refuse a GET (405) — the client test-push now POSTs. **client-error.php pushes a
  FIXED sentence**, never the reporter's text (it was a public way onto the
  owner's lock screen). `ical-export.php` casts its token.
- **Sessions**: a guest password change signs out other sessions (epoch bump,
  this one re-stamped) and is throttled; the staging gate's cookie now includes
  the password's hash (changing it revokes every cookie) and a wrong guess costs
  a second.
- Status flags a reply-by-email webhook still authenticating with APP_SECRET.
- NOT done, deliberately: double opt-in for newsletter/drafts/leads (product
  change), DNS pinning for the admin-only iCal fetch, and deleting orphan chat
  uploads (self-repair still only flags them).

## The round-4 audit (concurrency, input, abuse, output)

Five read-only lenses (server security, client security, server and client
performance, robustness); each finding was reproduced before it was fixed, and
each fix is gated and break-tested. The rules it set:
- **THE SESSION LOCK IS RELEASED EARLY, AND A WRITER SAYS SO.** PHP's file session
  locks from `session_start()` to the end of the request, so one slow call (the
  POP3 mailbox, a Square refresh, a photo resize) queued every other request from
  that browser behind it. db.php now calls `session_write_close()` after its own
  checks UNLESS the endpoint did `define('CHB_KEEPS_SESSION', true)` before the
  require — the files that write `$_SESSION` (auth, passkeys, enquiries, …).
  **`test-session-lock.php`** (CI, deploy-excluded) fails if any other file writes
  the session or calls a helper that does. `session-lib.php` holds the TTL and
  `session_files_prune` (self-repair §4d-ii: empty files over a day old and any
  past the lifetime — PHP's own GC is often off, measured 6,675 empty files).
  `session.use_strict_mode` is on (a planted id is replaced, not adopted).
- **RELEASING IT EXPOSED RACES THE LOCK HAD BEEN HIDING BY ACCIDENT**, each now
  closed where it lives:
  - **`op_claim` refuses a repeat that is still running** — GET_LOCK answering 0
    is 409 `code: 'in_flight'` ("still being saved"), never a second run: the
    first may be in a slow email after a refund has gone, and Square's
    idempotency key changes once money has gone back. NULL (no lock support)
    still proceeds. BOTH queue replayers (app.js `oqFlushRun`, sw.js) KEEP an
    in-flight item rather than recording it refused. `CHB_OP_LOCK_WAIT` (default
    15) is shortened only in test-integration's config (§17k).
  - **`book_lock` failing is a refusal** on refund / return_deposit /
    keep_deposit / cancel (409 "being processed"), never an unlocked money move.
    test-payrail scans for it.
  - **`content_locked($key, fn)`** (db.php) makes a read-change-save of one content
    key one step (named lock per key; `__content_all` memo dropped inside). Used
    by the mailbox seen-list, the opt-out list, the sent tally, the activity seen
    list, guest-FAQ misses, watchers, notify recipients and key safes (a closure
    there must RETURN the record — `safe: null` was the bug). §32d gates it.
  - **One POP3 session at a time** (`pop3_lock`/`pop3_release` in mailbox-read):
    parallel logins to one mailbox are refused by the provider; a busy box says
    "The mailbox is busy — try again in a moment."
- **AN ARRAY WHERE TEXT WAS EXPECTED IS `''`** (`clean()`), so `name: [...]` on a
  public form no longer threw a TypeError, logged a server error and pushed the
  owner "Site error detected". Passwords go through `field_text()` (never
  trimmed). **Text longer than its column answers 400 BY NAME**
  (`require_fits($in, [key => [width, 'Label']])` — bookings' `BOOKING_FIELD_FITS`,
  experiences, rates, guest name/phone): the database rejects it outright, which
  read as "Something went wrong on our side". A catch that means "not migrated
  yet" tests `db_schema_missing($e)` and rethrows anything else.
- **ONE BAD BYTE MUST NOT BLANK A LIST OR ERASE A STORE.** `json_out` and both
  content writers use `JSON_INVALID_UTF8_SUBSTITUTE`; a still-unencodable answer
  is a 500 (it was a 2xx), and a content write that cannot encode THROWS rather
  than storing `''` (which read back as an empty list). Email parts are converted
  to UTF-8 by their declared charset (`mailbox_utf8`; ISO-8859-1 is read as
  Windows-1252, which is what senders mean) and subjects/display names are
  decoded. test-reply's charset section.
- **A CLI SCRIPT THAT DIES SAYS SO.** db.php's exception handler made PHP exit 0
  from the command line, so six gates that load it could crash halfway and report
  a pass. It writes the error to STDERR and exits 255 under `PHP_SAPI === 'cli'`.
  **test-error-status.php** gates it — from a FILE, because `php -r` bypasses user
  exception handlers and the first break-test was vacuous for exactly that reason.
- **MONEY STEPS UP; so do the doors to the account.** `require_reauth` now also
  guards changing the sign-in email, turning two-step OFF and adding a passkey;
  `chbWithReauth` wraps the three client calls. An invite accept or a password
  reset proves freshness (`admin_complete_login(…, $proven)` stamps it). A failed
  admin password change is throttled and logged as a warning — NB `log_activity`
  takes **`'severity'`**, and `'level'` was silently ignored at three sites.
- **ABUSE LIMITS, by what they protect.** `rate_limit` (per IP, refuses),
  `rate_limit_key` (per key ACROSS IPs — a signed-in guest's chat and uploads, so a
  new address buys no fresh allowance), `rate_allow` (per IP, returns a bool — the
  analytics recorder stops counting instead of failing), and
  `signin_mail_allowed` (10 sign-in emails a day per address, on every path that
  mails a code or link: a day's flood of codes into someone's inbox was free).
  The CSP and blocked-request reporters cap per IP AND overall per hour and read
  `REMOTE_ADDR` (a header is the sender's to choose). The owner's chat alert stops
  at 20 a thread per hour.
- **AN UNKNOWN ACCOUNT TAKES AS LONG AS A KNOWN ONE.** `auth_hash_for($row)` checks
  a dummy hash at THIS PHP's default cost (`AUTH_DUMMY_HASHES`, picked by
  `password_needs_rehash`): a fixed cost-12 dummy beside cost-10 accounts made an
  unknown name answer four times SLOWER (83 vs 360ms). Passwords are rehashed on a
  successful login. **Signing out ends the session** (`session_end_signed_in`:
  empty `$_SESSION` + a new id), not just the name on it.
- **THE ACTIVITY LOG KEEPS WHAT MATTERS.** Machine reports
  (`ACTIVITY_NOISE_ACTIONS`: csp.violation, request.blocked, client.error,
  client.swallow) are kept 30 days and capped at 2,000; everything else 3 years
  under a 200k-row ceiling. The summary reads real events and noise separately
  (`activity_logged_events($limit, 'real'|'noise')`), so a flood of reports can no
  longer push a week of bookings out of "this week".
- **OUTPUT**: a CSV cell that starts like a formula gets a leading apostrophe
  (`chbCsvSafe`, both exports; numbers untouched); a To: display name with
  specials is quoted (`mb_encode_safe`); owner alerts render guest text as a quote
  and only the LAST paragraph's back-office URL as the button
  (`owner_open_url_ok`, `owner_quote`, `owner_name`); a cottage colour is only ever
  `#RRGGBB` at every read (`prop_accent_ok`, self-repair replaces a bad one); the
  backup dump restores with `NO_AUTO_VALUE_ON_ZERO`; `backup_decrypt` refuses a
  plaintext that is neither gzip nor SQL (CBC without a MAC decrypts a wrong
  passphrase to valid-looking padding ~1 time in 256 — measured 14 in 3,000);
  instalments split in whole pence; images over 40 megapixels are refused before
  GD decodes them; `.bak/.old/.orig/.swp/~` files are denied by htaccess.
- **SIGNING OUT LEAVES NO UNSENT MESSAGE ON THE DEVICE.** `chbOwnerDeviceForget()`
  (app.js) is the one list for both ways out: the boot hint, the day sheet, the
  deposit decisions and every `chb-ib-draft:` / `chb-cmp-draft:` draft. smoke-test
  §12i (break-tested on the prefix sweep).
- **test-integration §56** drives the abuse and input cases against the real
  endpoints (arrays, long fields, the CSP cap, the summary under 1,200 noise rows,
  ten emails from twelve code requests with identical answers — `srv` stripped
  before comparing — the dummy hash, a new session id at logout).
- **THREE PERMISSION GAPS, found by a read-only audit of the policy map** (gated
  in test-people, each failing on the old map):
  - `people_content_cap`'s cottage pattern takes any `<word>-location` as a
    cottage's location line, and it swallowed **`square-location`** — which
    Square location every money read uses — so anyone who could edit cottage
    pages could repoint the Payments data. It is named first now, as `owner`.
    A pattern that classifies by SHAPE needs every non-matching key named
    before it.
  - `leads.php` approved and deleted direct reviews for any signed-in person,
    while `reviews.php` asks for Approve reviews (`gu.reviews`) — and approving
    one PUBLISHES it on the cottage page. Same permission now, on the server
    and on the two buttons (`setLeadStatus`, `deleteLead` in `CHB_ACT_CAP`).
  - `statements.php` was `'*' => 'mo.view'`, the READ permission, for every
    write too. Seeing and importing stay `mo.view`; sorting a payment (`mark`,
    `unmark`, the reminder) takes `mo.record`, because a sort says whose money
    it was and feeds what each host is owed; switching statements off is a
    Super User's. The Payments page wires its own buttons (`data-pm`), so the
    server's refusal is what a Host meets there.
  - Left as designed, flagged: Edit cottage pages (`co.pages`) reads and writes
    the private `ops-`/`arrival-`/`welcome-` notes, where an owner may have typed
    a key-safe code — the key safes' own permissions do not cover them.

## The round-4 performance pass (one load per trip, a 304 that fires, indexes)

Every change here is counted where it happens (requests, statements, plans), not
timed, and each gate was break-tested against the old code.
- **THE PUBLIC BOOT PAYLOAD'S 304 NEVER FIRED IN PRODUCTION.** htaccess deflates
  `application/json`, so Apache sends bootstrap.php's ETag as `"abc-gzip"` and gets
  that back, and bootstrap.php compared byte-exact: every 30-second poll from every
  visitor downloaded the whole payload. It uses shell-etag.php's tolerant
  `shell_etag_matches` now (the shell routes learned this first), with
  `Vary: Accept-Encoding`. **An owner's copy is `no-store` with no ETag**: it carries
  the internal settings (bank details among them) and is asked for only at boot.
  test-integration §24 sends the `-gzip`, `W/` and list forms by hand, because
  `php -S` compresses nothing and a test against PHP alone passes either way.
  NB admin-bootstrap.php deliberately has NO ETag: a stored copy would put every
  guest's name and phone number in the browser's HTTP cache unencrypted, the facts
  the day sheet goes to the trouble of encrypting.
- **ONE LOAD PER TRIP TO TODAY.** `nav('view-backoffice')` runs initBackOffice, and
  tryAccessBackOffice (the Today button), bookingHubBack and the history replay ran
  it again on the very next line: two admin-bootstrap loads and two full renders
  per tap. `initBackOffice()` now shares one run between calls made in the SAME TASK
  (`__boInitTurn`, cleared by a 0ms timer); a refresh asked for later always loads
  afresh. That is the difference from PERF-8's time window, which skipped the very
  reloads the refresh callers exist for. ui-test-oneload §1–§2 count both ways.
- **A SYNC THAT FOUND THE SAME STAYS CHANGES NOTHING.** `sync_property` compares the
  rows a feed would write with the stored ones (`ical_block_sig`, ical-lib; every
  stored column, sorted, duplicates kept) and leaves an unchanged source alone —
  no delete, no inserts. Each source answers `changed`, and `autoSyncIcalBlocks`
  reloads only when something changed or a feed is in trouble (`icalSyncChanged`:
  a failure, a missing flag from an older server or a malformed answer all reload).
  The Status page's "Synced" reads the feeds' own `ok_at` now: it was the newest
  block's `updated_at`, which stops moving once unchanged rows are not rewritten.
  test-ical §6, ui-test-oneload §4.
- **THE GUEST IS NOT KEPT WAITING ON THE OWNER'S PHONE.** The new-enquiry
  `alert_owner` (an HTTPS request per device, then the email fallback) ran before
  the response; it rides `mail_after_response` with the emails now. And
  `mail_after_response` RELEASES THE SESSION LOCK first: enquiries.php keeps the
  lock (`CHB_KEEPS_SESSION`), so the guest's next request waited behind every send.
  test-webpush.
- **INDEXES** (migration-139): activity_log `(entity, entity_id, id)` for a booking
  page's feed and the send guard, `(action, created_at)` for the per-hour caps and
  status checks; login_attempts `(identifier, attempted_at)` for the per-account
  limits (its only index started with `ip`); enquiries `(email)`. §57 reads
  EXPLAIN's `possible_keys` — whether an index is usable, which does not depend on
  how few rows the harness holds.
- **Smaller**: the three approval counts are asked for together (they were three
  round trips in a row on every visit to Today), and on a phone the hidden rail no
  longer walks every booking twice per navigation (`chbFrameSync` skips
  `chbDuties`/`chbDaySentence` unless `rail-on`; `chbRailEnsure` still runs, because
  it registers the width listeners that sync the rail the moment it appears).
  And version.php — polled every minute or so by every open tab — reads only the
  last 16KB of app.js for `const BUILD` (bump.js keeps it the last statement)
  instead of the whole 1MB bundle, falling back to a full read; test-csp-report
  asserts the build it reports equals app.js's.
- **A PINNED ASSET IS SERVED FROM THE CACHE, NEVER REVALIDATED** (sw.js). The
  generic branch was stale-while-revalidate, so every page load re-fetched each
  `?v=` bundle and RE-WROTE it into Cache Storage — app.js alone is a megabyte, a
  phone's write for nothing. A `?v=` URL cannot change under its pin
  (check-versions), so it is cache-first now; the logo, icons and manifest keep
  SWR, and a release's new CACHE name still clears the lot. smoke-test §6c-iv
  loads sw.js into a sandbox with a fake cache and counts fetches and writes.
- **Considered and left**: the hero at a resized width (home.php preloads the
  full-size URL, so a resized one would download twice), memoising `chbDuties`
  (too many inputs to key without serving a stale duty), and replacing the costly
  `:has()` rules (a CSS refactor with no measurement behind it).

## Deploy integrity
- **A PARTIAL UPLOAD OF AN APP WHOSE FILES REFERENCE EACH OTHER IS A BROKEN APP.**
  `lftp mirror -R` can finish with files un-uploaded and still exit 0 — which is how a
  deploy landed `accounts.php` carrying a new `require sweep-lib.php` while the lib
  itself never arrived, 500-ing the Payments screen (reported from the owner's phone:
  "Failed opening required '/home/www/public/sweep-lib.php'") until a later deploy
  happened to complete. deploy.yml now sets **`cmd:fail-exit yes`** so a failed
  transfer fails the job, and runs a **second idempotent mirror pass** (mirror only
  sends what differs, so it is a no-op when the first was complete and a repair when it
  was not).
- **smoke-test §7 catches the sibling class**: it derives every
  `require_once __DIR__ . '/x.php'` target from the source and every basename the
  deploy's `rm -f` lines strip, and fails if a required file is stripped or absent from
  the repo. `config.php` is the one legitimate exception (the host keeps its own; the
  deploy never deletes remote-only files). Vacuity-guarded at both ends — if either
  derivation stops finding anything, the check fails rather than covering nothing.
- **DO NOT verify a deploy by HTTP status.** An HTTP completeness check was built and
  REMOVED: `enquiry-actions.php` answers a direct request with `http_response_code(404)`
  on purpose (a lib refusing direct access), so 404 cannot distinguish "not deployed"
  from "deliberately hidden" — it reported a false missing file against the real
  production host. A verification that would block every deploy is worse than the bug
  it guards. If this is ever revisited, compare the REMOTE FILE LISTING (`lftp cls`)
  against the staged set, which is a filesystem question with no HTTP semantics to
  misread.

## Self-repair & error reporting
- Errors: client capture (app.js, third-party webview noise filtered, sends
  stack/build/view) + server capture (db.php exception/shutdown handlers) both
  land in the activity log as warn ("Needs attention" + weekly digest), deduped
  1h, with an owner push at most every 6h. A stale-cache signature ("… is not
  defined" from our own assets) triggers a ONE-per-tab cache purge + reload
  (self-heal) before reporting.
- `self-repair.php` (daily via cron.php) fixes safe state drift — dead gallery
  references, card-hold auths past Square's window, missing slug/accent — and
  FLAGS ambiguous things (orphaned payment rows) without touching them. Never
  auto-change production code; code fixes go through PRs + CI like everything else.
