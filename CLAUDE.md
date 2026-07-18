# CHB — working notes for Claude

Cottage Holidays Blakeney: a 3-cottage family holiday-let site. The frontend is a
single large `Cottage Holidays Blakeney/index.html` (vanilla JS + inline CSS, **no
build step**); PHP backend files sit alongside it. App-style guest shell lives in
`guest-app.js` / `guest-app.css`.

## Workflow preferences
- **Always merge.** When a PR is opened for completed, verified work, squash-merge it
  to `main` without asking first (then sync the branch to main). Skip only if CI is
  failing or the work is explicitly a draft/WIP.

## Deploy checklist (do this whenever shipping frontend changes)
- Bump `const BUILD` — it now lives in **`app.js`** (last statement), not index.html.
- Bump `CACHE` in `sw.js`, and the `?v=` query on whichever of `app.css` / `app.js` /
  `guest-app.css` / `guest-app.js` you changed — in BOTH `index.html` and the `sw.js`
  CORE list.
- If **`admin.js`** changed, bump `ADMIN_BUNDLE_V` (top of app.js, in the facade) —
  that's its cache-buster; admin.js has no `<script>` tag and is NOT in sw.js CORE.
- Run `node smoke-test.js` and `php test-pricing.php` — must pass (CI runs both).

## Conventions
- Owner content editing lives in **Settings**: "Website content" (global homepage/nav
  text + images) and Preferences → [cottage] → Photos / Text (per-cottage). The old
  inline live editor is fully REMOVED (code + CSS). Content
  is APPLIED to the page via the `data-edit-*` attributes + `applyContentOverrides`
  (reads `siteContent`), and galleries via `images-<prop>` — do NOT remove those;
  they're the rendering path, not an editing UI.
- Responsive: prefer the four canonical breakpoints (480 / 640 / 900 / 1200) for new
  media queries; migrate stray one-off widths opportunistically when touched.
- **Design system**: `Cottage Holidays Blakeney/DESIGN.md` is the design language —
  build from the `:root` tokens in app.css (radius `--r-*` incl. `--r-panel`, status
  `--ok/--warn/--danger` + `--info` (the sea-blue "Arriving" state), text-on-accent
  `--accent-ink` (dark ink — white fails WCAG on the mid-light accent), shadows
  `--shadow-*`, easings `--fluid-bezier/--spring`); the `-text` variants (`--ok-text`
  … `--info-text`) are the light tints readable on glass and are retuned under
  `body.light-mode`. Never introduce new raw hex/px/easing values for things a token
  covers. `.sr-only` is the visually-hidden-but-announced utility (status live
  regions etc.).
- Guest mobile shell CSS/JS is gated to `body.guest-app:not(.owner-mode)` so admin
  (`owner-mode`) and desktop are never affected. Keep new shell rules gated the same way.
- The site deploys from `main`; the repo is cloned fresh each session (ephemeral
  container), so anything that must persist has to be committed.

## Architecture map
Single-operator holiday-let PWA. No framework, no build step.

**Frontend** (no inline blobs anymore — CSS and JS are extracted into cached files)
- `index.html` (~144KB) — markup + `<head>` only: `<main class="page-view">` sections
  toggled by `nav(viewId)`; `currentGuest`/`isAuthenticated` + `body.owner-mode`/
  `body.guest-app` classes drive what shows. Links `app.css`, then `app.js`, then
  `guest-app.js`.
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
- `guest-app.js` / `guest-app.css` — the mobile app shell only (the floating dock,
  full-page overlays, install chip). Loaded with `?v=` and gated as above.
- Routing is `nav()` toggling `.page-view.active`; per-view init lives in `nav()`
  (e.g. `view-experiences` → `renderExperiencesView()`). No router lib.

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
here); `inboxSub()` sub-folders via
`INBOX_SUBS`; `dock-badge-inbox` pip), **Payments** (`openAccounts()` →
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
in prose), `chbSayNames` (aggregation with a named lead), `chbSayN` (small counts as words). It
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
plain keyword still returns the browsable `type:'help'` rows. Conversational answer rows
(social greetings, fallbacks, generated how-tos) carry `wrap:true` → the row renders
`.cmdk-row-wrap` so full sentences wrap over multiple lines instead of clamping to one
ellipsised line on the search page. Additive — the tested answer rows are
unchanged. Gated by search-test §22 + §8 (how-to) + golden social cases.

**Guided walkthroughs** (admin.js — help that HELPS ALL THE WAY THROUGH a task, not just
describes it). Where the single-step `coachMark`/`coachTo` ("Show me where") points at ONE
button and stops, `coachSequence(steps, i)` chains coach-marks INTO the task: each step
spotlights its target (`coachPaintStep`, reusing the ring + `coachReposition`) with the
sentence you'd have read, shows "Step N of M" + Next/Back, and AUTO-ADVANCES the instant the
step's `until` signal fires (you picked the cottage / typed the name / set the dates). It waits
for each target to appear (30×200ms), ends when the target vanishes or the last step's Done, and
Escape stops it (`coachSeqStop`). The sequence overlay (`.coach-ov-seq`) is click-THROUGH
(`pointer-events:none`, only the tip interactive) and sits ABOVE modals (`z-index:7000`) so it
can spotlight fields INSIDE the Add-Booking box. Crucially SAFE: it only points and waits — it
never submits or edits (you tap Save). Flows in `CHB_WALK`: `add-booking` (5-step field-by-field
on the shared `#modal-*` ids), `block-dates` (the `#glass-dialog-fields` step), `take-payment` +
`refund-deposit` (cross-navigation — open a `.bk-row`, then the hub's `[data-act="requestPayment"]`
/ `[data-act="returnDeposit"]`, advancing on presence). `coachWalk(topicId)` launches; `chbNlgHowTo`
prepends a **"Walk me through it"** chip for any topic with a `CHB_WALK[id]`. Gated by
`ui-test-coach.js` (start, click-through + z-order, Next/Back, auto-advance, Done, Escape).

**The SEARCH PAGE** — search lives on ONE dedicated page (`view-search`, in `ADMIN_VIEWS`),
opened by the dock's knot logo (`openCmdK`) or ⌘K; the per-workspace Assist Bars were RETIRED
in its favour (the whole `abar*` module, host divs and CSS are gone — do not resurrect). The
`#cmdk` node lives statically inside the view (class `cmdk-page`, no overlay/backdrop; page
scroll, `.cmdk-box` max-width 680px/940px sheet) and keeps every inner id, so the entire
intelligence stack is unchanged. `openCmdK` snapshots the workspace you came FROM before
navigating — `__cmdkReturnView`, `__cmdkScope = cmdkDefaultScope()`, `__cmdkEntity =
cmdkCurrentEntity()` — so scoping and record pronouns still resolve; `closeCmdK` is STATE
CLEANUP ONLY (no nav — result runs navigate themselves and call it first); `cmdkBack()` =
cleanup + return to `__cmdkReturnView` (Esc and the ⌘K toggle both use it). The palette's
"filter this workspace" now always uses the floating banner (`renderTodayFilterBar`) + dim
machinery. A guest **typeahead** in Add Booking (`modalNameSuggest` / `#modal-name-suggest`)
suggests past guests → a pick fills name+email+phone. The **AI status lives IN THE LOGO** —
the search page's knot glyph (the leading icon, wrapped as `#cmdk-ml`; `data-mstate` set by
`chbSetModelStatus`/`chbModelState`) carries the state as COLOUR, no words on screen: `ready`
(Darkstar loaded, idle · quiet purple), `understood` (paraphrase→intent · confident green,
breathing), `meaning` (semantic recall · its OWN Siri identity — the knot cycles teal→purple
with a soft glow, `chb-knot-siri`, distinct from understood's steady green), `guess` (near-miss
only · dimmed accent), `learning` (teaching · orange pulse), and **`loading`** while a model
file streams down (darkstar.bin at boot, encoder.onnx on the first history query) — a circular
PROGRESS ring around the knot, conic-gradient driven by `--mload` (0..1) with a radial-mask
ring cut, also on the dock Search knot (`.ml-loading::before`; ::after is the hover label).
Each knot's hover title (`CHB_MSTATE_TITLE`) explains the state in plain language, so the
colour never has to be decoded blind; there is NO worded pill any more (`CHB_MSTATE_LABEL` is
REMOVED). The knot never hides — the ✕ clear sits on the RIGHT of the input (after it, before
help); `has-text` only shows the ✕. All state animation honours `prefers-reduced-motion`
(meaning falls back to a static teal). Plumbing: `chbFetchProgress` (streamed fetch →
ArrayBuffer + per-chunk fractions; plain-arrayBuffer fallback when reader/length hidden) feeds
`chbModelLoadProgress(key, frac)` (per-source map; overlapping downloads show the
LEAST-finished; null clears). Active answer states always beat the ring; `chbSetModelStatus('')`
falls back to `loading` while a download runs, then `ready`. The ring is progress, not
animation — no reduced-motion exemption needed. Gated by ui-test-modelring.js (real browser:
ring on/track/hand-back/clear, on the search page) + search-test §31 (stream math,
min-of-loads, idle fallback). Leaving the page on an unanswered query files it into the shared
miss store (`chbMissRecord`) — via `cmdkBack`/`closeCmdK` AND via `nav()`, which calls
`closeCmdK` when leaving `view-search` by ANY route (a dock tap, a result run) so the teach
loop, in-flight-search supersede and conv-context clear can't be skipped; `openCmdK` also
resets `__cmdkConvCtx` so a session never inherits the last one's pronoun referent.
**Cross-page context memory**
(`__cmdkLastEntity`, `chbStampRecent`/
`cmdkRecentEntity`, `CMDK_RECENT_MS` 6min): the record you last engaged with — a hub you opened
(`openBookingHub`/`openEnquiryHub`) or one a search answer surfaced — is remembered ACROSS
navigation, so a pronoun ("email them", "their balance") resolves to it on the search page and
the empty landing offers a "Continue with [name]" row. Distinct from `__cmdkEntity` (only the
OPEN hub, snapshotted by openCmdK) and `__cmdkConvCtx` (only this search session); resolved
only while fresh AND the record still exists, so stale/deleted context never hijacks a later
query, and a real pronoun is required so a generic query is never captured (search-test §21b).
**Siri look**: the search card breathes `cmdkSiriAura` while the page is open, driven by the
`--siri-1..5` hue tokens (`:root` in admin.css); box-shadow aura (overflow-safe), honours
`prefers-reduced-motion`. **Unified interface**: RESULTS/JUMP-TO/quick-ACTIONS are rows
(`.cmdk-row` / `.cmdk-qa-row`, distinct destination glyphs via a registry `icon` + a row's
`iconType`); refine/related/ask PIVOTS are pills (`.cmdk-chip`); one hover tint (`--cmdk-sel`),
one pill spec. Suite: `ui-test-searchpage.js` (page open/toggle/back, answers, logo states,
teach flash, conv follow-up, miss capture); the layout gate covers the page at phone width.

**Hubs are where you act; index rows are where you find.** The **booking hub**
(`view-booking-hub`) is the ONE home per booking — `showDetails()` (app.js) only
delegates to `openBookingHub()` (admin.js): status pipeline + next action, money,
emails, guest, change history via `bookings.php` `history`; on desktop (≥900px)
the status pipeline shows ALL stages (upcoming = red dot), compact Done·Now·Next
below that; the settled Payments card folds to one line carrying the deposit
state (incl./excl.) with the standalone deposit row only when it has an action.
The **enquiry hub**
(`view-enquiry-hub`, `openEnquiryHub()`) is the same for enquiries — approve/edit/
email/decline + agreed price live there; approving jumps to the new booking's hub
(`enquiries.php` returns `booking_id`). At ≥1200px both the Today workspace and the
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
`require_guest()`, `site_base_url()`, `content_value()`. Key endpoints: `auth.php`
(guest/admin sessions, magic link), `enquiries.php`, `pay.php` (Square),
`pricing.php` (authoritative price model), `reviews.php`/`photos.php`/`experiences.php`
(moderated guest UGC: GET public, `suggest`/`submit` guest, admin list/approve/reject),
`messages.php` (chat), `webpush.php` (`alert_owner`, `notify_guest`), `mailer.php`
(`smtp_send`, `send_*`), `customers.php` (`audit` — the customer-directory lookup
trail; see below). Crons run daily via `cron.php` (pre-arrival, payments-due,
tide-push, push checkin, enquiry-nudge).

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
(4) **Guest ask box** (`#ask-box` on the cottage page, app.js `askBoxSubmit`/`askBoxToChat`):
guestFaqAnswer surfaced on-page; unmatched questions open the chat with the question
pre-typed + `__faqBypass` so a person gets it untouched. Gated by search-test §36 (brief
composition, stale-miss silence, undo round-trip incl. prior-state payload) +
ui-test-askbox.js (real browser: instant answer, honest fallback, chat handoff).

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

**AI-drafted enquiry replies** (admin.js) — the enquiry email composer (`openEnquiryEmail`) has a
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
this is a full transformer: **all-MiniLM-L6-v2** (Apache-2.0), quantised int8 ONNX —
committed + deployed as **`encoder.onnx`** (~23MB, versioned by `?v=` in `CHB_ENC.url`)
with its BERT WordPiece vocab in **`encoder-vocab.json`** (ids differ from Darkstar's
trimmed table — the tokenizers can't be shared; `chbEncTokens`). Runtime is
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
the background and slots mentions in when it lands. (2) **`chbAnomalies()`** appends
OPPORTUNITY rows (sev `ok`, `spark` icon, `opp: true`, lowest priority) to the Needs-you strip — whose HEADING adapts: any duty keeps "Needs you" (amber badge counts DUTIES only); a pure-opportunity strip reads "Worth a look" with a calm green badge (`#needs-you-count.is-opp`, `#needs-you-word` set in `renderNeedsYou`): bounded
2–4-night gaps between guest stays starting ≤45 days out (owner-blocked holes = deliberately
held, skipped; 1-night = changeover slack; unbounded space ≠ gap; cap 2) and a next-month
shortfall vs the same month last year (fires only under 50% of last year with last year
≥8 nights → `nyPacingReview` opens the pricing coach). **Gap rows carry a DECISION, not a
generic action**: `chbGapPlan(g)` picks the best commercial outcome — a hole between stays is
PRICED to sell, never hand-booked. No offer yet → a one-tap dated offer off the season-aware
current rate (`chbCoupleRateOn`), 20% when the gap is imminent (≤7 days — last-minute price is
the only lever left) else 15%, floor £20; act **Offer** → `nyGapOffer` saves the 'Gap offer'
override via `cmdkApplyPriceOverride` (undo-able) and re-renders so the row flips. A 'Gap
offer' season already covering the hole → the row reports it LIVE (act **Rates** →
`nyOfferRates` = Manage → seasongrid) instead of re-suggesting. The SAME plan drives the strip,
the brief's gap row, and the CHB_PRICE_Q suggestion rows, so every surface agrees.
Gated by search-test §32 (18 checks: gap bounds/blocks/window, offer/imminent/live decisions,
pacing thresholds, intel composition, false-merge + no-card guards, mention matching) +
ui-test-intel.js (real browser: card renders/withholds, Offer tap → seasons_save payload +
row flips to live).

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
price suggestion. `chbPriceModel()` (lazy, memoised on a `dbBookings`+`dbBlocks` signature)
reads three signals: **seasonal demand** (occupancy by calendar month from direct stays +
OTA `dbBlocks`, Bayesian-shrunk to the mean so a thin month can't swing), **booking pace**
(a lead-time CDF from `createdAt` — added to `mapBookingFromApi` — so a still-open window
close to arrival is "harder to fill" than a far one), and **achieved rate** (`agreedPrice.perNight`
÷ season base). `chbSmartPrice(pk, fromIso, nights, {gap})` turns those into a recommended
nightly rate on a transparent yield curve (busy ⇒ hold/raise to +18%, quiet/last-minute ⇒
discount to −28%), nudged by the achieved-rate ratio and ALWAYS regularised by confidence
(`nStays/24`) so thin data barely moves off the current rate — returns `{rate, pct, base,
score, conf, why, …}` with a plain-English `why`. Wired in three places: (a) **gap offers** —
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
— §29b. The NLU corpus stays frozen (ceiling — see above); breadth grows by new deterministic
families, not classifier examples. Business-SLANG synonyms ride the family regexes the same
way (measured on the stress set, gated in golden): `adr` → average rate, `fill rate` →
occupancy, `top line` → revenue, `how's trade` / `state of play` → the pulse narrative,
`pipeline` / `round the corner` → upcoming. NB "check-in/out time" wording must NEVER become
a none-example (measured: collides with "who checks out before noon"); the intent tier
already answers it end-to-end, so the tier-3 model-level accept is harmless.

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

**Data / migrations** — MySQL. Schema in `schema.sql`; changes ship as
`migration-*.sql` applied by `migrate.php` (admin visit or `?cron=APP_SECRET`, or
Settings → System check → Run migrations). Migrations are idempotent
(`CREATE TABLE IF NOT EXISTS`, guarded `ADD COLUMN`). Most owner-editable content
lives as JSON in the `content` table (`welcome-<prop>`, `faqs-<prop>`, etc.).

**Gotchas**
- The price model is duplicated: JS `priceBreakdown()` (index.html) must stay in
  lockstep with PHP `price_breakdown()` (pricing.php). `smoke-test.js` §2 tests the
  JS side and `test-pricing.php` the PHP side against the SAME fixtures — keep both
  green when touching pricing.
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
- **Square settlement sync** — a payment's processing FEE and a refund's final
  STATUS (PENDING→COMPLETED) both land a day or two after the action, pushed by the
  `square-webhook.php` events. Because that webhook can be unconfigured, the
  `recent_payments` action ALSO reconciles on view: `reconcile_missing_fees()` +
  `reconcile_pending_refunds()` (bookings.php) poll Square for fee-less card-ins /
  non-terminal refunds and backfill them. The webhook can **self-provision**:
  `square-setup.php` (`status`/`setup`, admin) creates the subscription via the
  Square API and stores the signing key ENCRYPTED as `apikey-square-webhook`;
  `square_webhook_signing_key()`/`square_webhook_url()` (db.php) resolve it (config
  const wins, else the stored key / derived URL), so `square-webhook.php` verifies
  with no config.php edit. Owner UI: Manage → Payments → "Connect" (`connectSquareWebhook`);
  read-only pill in diagnostics. The payments STATUS column shows a traffic-light
  dot (`paymentStatusMeta`, green/amber/red) — an issued refund reads Completed
  (see `paymentStatusLabel`). Gated by `test-webhook.php` (signature) + smoke
  (dot/label mapping).
- Offscreen `.page-view`s are `display:none`, so their CSS background-images aren't
  fetched until shown (built-in lazy-loading). The hero is the LCP image
  (`fetchpriority="high"` preload) — keep it prioritised, not deferred.
- Dev/CI-only files (`smoke-test.js`, `test-pricing.php`, `*.md`, `*.sql` are shipped
  for migrate but `.htaccess`-denied) are excluded from the deploy in `deploy.yml`.
- **Staging sandbox** (optional, opt-in): `deploy.yml` has a `deploy-staging` job that
  mirrors the same code to a `staging.<domain>` site with its OWN database + `config.php`
  (Square sandbox + test email) — a true isolated environment. It's a no-op until the
  `STAGING_SFTP_*` secrets are set (see `SETUP-STAGING.md`). On the staging host only,
  `.htaccess` sends `X-Robots-Tag: noindex` and `app.js` (`IS_STAGING`) shows a STAGING
  banner. Staging post-deploy is migrate-only (never fires owner notify/digest/nudge).

## Testing / CI
- Before shipping: `node smoke-test.js` (loads index.html + admin.js in a shim;
  pricing, postcode, occupancy, structural + facade-stub checks) and
  `php test-pricing.php`.
- `.github/workflows/ci.yml` runs `php -l` on every PHP, `node smoke-test.js`,
  `php test-pricing.php`, `php test-reply.php`, the real-browser `node e2e-test.js`,
  and the design gate `node layout-test.js` (layout invariants — no horizontal
  overflow, no content cut off, key content rendered — on the public views at
  390/768/1280 AND the six back-office screens at phone width; screenshots
  uploaded as the `layout-shots` CI artifact) on each PR — merge only on green.
  `deploy.yml` SFTP-deploys `main` to IONOS (never deletes remote files; preserves
  `config.php` + `uploads/`).

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
