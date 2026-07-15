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
  `--ok/--warn/--danger`, shadows `--shadow-*`, easings `--fluid-bezier/--spring`);
  never introduce new raw hex/px/easing values for things a token covers.
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
via `settingsOpen(id)` → `#sec-<id>`; the health/cron pills + Activity log live
here). `ADMIN_VIEWS` is the
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
ellipsised line (palette + both Assist Bars). Additive — the tested answer rows are
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

**Assist Bars** — the palette's brain embedded IN workspaces: `chbAssistBar(hostId, opts)`
(admin.js) injects a knot+input bar into static host divs, registered in
`chbAssistInitBars()` (admin boot footer — guests never load any of it). ALL FOUR back-office
workspaces carry one — `#abar-today` (Today), `#abar-inbox` (Inbox), `#abar-accounts`
(Payments) and `#abar-manage` (Manage) — PLUS a record-scoped bar on each hub
(`#abar-bookinghub`, `#abar-enquiryhub`). The Payments/Manage index rows are static markup
without a haystack, so `abarStampSearchRows(view)` stamps `data-search` (label+sub+kw) on
`.settings-row`s the first time their bar filters. The HUB bars set `opts.scopeEntity` → each
keystroke sets `__cmdkEntity = cmdkCurrentEntity()` before building, so "email them", "their
balance", "this booking" act on the OPEN record. Routing per keystroke: terms matching the
board's `[data-search]` rows live-filter it (shared dim machinery; count in the bar; the
palette's "filter this workspace" adopts INTO the bar via `abarAdopt`, so no floating banner
where a bar exists; the Inbox bar adds per-folder `.ifold-match` pills + hides the unread chips
while filtering). But filtering ALONE isn't enough — a matched record can sit off-screen (a
future booking outside the timeline window, a bk-row below the keyboard) — so `cmdkBuildResults()`
ALSO runs every keystroke and, when the query resolves to an actual RECORD (`hasRecord`:
booking/enquiry/guest/payment), its rows render in the panel too: typing a NAME both dims the
board AND shows the customer as a tappable row (never just "1 match" over a dimmed board).
Questions release the filter (pure answer); a pay-state / broad filter with no record answer
stays filter-only. The LEAD actionable record's quick-actions render on the row (`abarRowHtml`
marks the first row carrying `actions` with `_showActs`; `abarAct` runs them), so "who owes me
money" → [Request payment] without a hop (chips/`_nlu` learning intact); zero matches →
deep-search CTA + ask chips. **Smart clear**: acting on a result (`abarExec`/`abarAct`/an action
`abarChip`) resets the bar, and leaving a workspace (`chbSmartClear(viewId)`, wired into app.js
`nav()` via a facade-safe `window.` slot) clears the bars you're LEAVING — so search is always
fresh for the next query. A guest **typeahead** in Add Booking (`modalNameSuggest` /
`#modal-name-suggest`) suggests past guests → a pick fills name+email+phone. Full
intelligence parity: the **model-status pill** (palette `#cmdk-ml`, per-bar `.abar-status`,
`data-mstate` set by `chbSetModelStatus`/`chbModelState`) NAMES what the assistant is doing —
`ready` (Darkstar loaded, idle · quiet purple), `understood` (paraphrase→intent · confident
green, breathing), `meaning` (semantic recall · its OWN Darkstar identity — a teal→purple Siri
gradient wordmark that shimmers, distinct from understood's green so a meaning-match reads as
semantic at a glance), `guess` (near-miss only · tentative rose-gold, hollow/dashed pip),
`learning` (teaching · orange pulse) — the WORD carries the state, colour is a quiet accent
(NOT a code to decode), and each pill's hover title (`CHB_MSTATE_TITLE`) explains itself. Bar
pills carry a scannable leading state pip (`.abar-status::before`, the palette has its knot);
all pills pop in (`chb-ms-in`) and honour `prefers-reduced-motion`. The dock button keeps a
purple Darkstar tint. Plus walk-away
(focusout) dead-end capture into the shared miss store, and `__cmdkConvCtx` carries across
bars↔palette. **Cross-page context memory** (`__cmdkLastEntity`, `chbStampRecent`/
`cmdkRecentEntity`, `CMDK_RECENT_MS` 6min): the record you last engaged with — a hub you opened
(`openBookingHub`/`openEnquiryHub`) or one a palette/bar answer surfaced — is remembered ACROSS
navigation, so from ANY page a pronoun ("email them", "their balance") resolves to it and the
empty landing offers a "Continue with [name]" row. Distinct from `__cmdkEntity` (only the OPEN
hub) and `__cmdkConvCtx` (only this palette session); resolved only while fresh AND the record
still exists, so stale/deleted context never hijacks a later query, and a real pronoun is
required so a generic query is never captured (search-test §21b). EVERY back-office bar sits ABOVE the header divider line (one admin.css rule:
`#view-backoffice > #abar-today`, `#inbox-head > #abar-inbox`, `#settings-chrome > #abar-manage`,
`#accounts-chrome > #abar-accounts` — the header's own `border-bottom` is dropped and re-hung
under the bar, so the order always reads title → SEARCH → line → content; on Manage/Payments the
bar lives inside the `#…-chrome` wrapper that hides on drill-down, so the divider follows it in
and out). **Siri look**: the search lights up with
a luminous cycling glow when engaged — the palette card breathes `cmdkSiriAura` while open, an
Assist Bar field breathes `abarSiriAura` while focused (with a rounder pill + firmer focused
surface), driven by the `--siri-1..5` hue tokens (`:root` in admin.css); both are box-shadow
auras (overflow-safe) and honour `prefers-reduced-motion`. **Unified interface**: one button
language across the palette + bars — RESULTS/JUMP-TO/quick-ACTIONS are rows (`.cmdk-row` /
`.cmdk-qa-row`, distinct destination glyphs via a registry `icon` + a row's `iconType`);
refine/related/ask PIVOTS are pills (`.cmdk-chip` in the palette === `.abar-chip` in the bars);
one hover tint (`--cmdk-sel`), one pill spec (scope/chip share padding/radius/border). Suites:
`ui-test-assist-{today,inbox,parity,deep}.js` (deep = the Payments/Manage bars, act-in-place,
hub scoping + Add-Booking typeahead); the layout gate asserts the bars render.

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

**Guest FAQ assistant** (app.js — guest-side, so admin.js's NLU never loads for visitors):
a TYPED question in the guest chat is answered instantly ON-DEVICE from the cottage's own FAQ
content before it ever pings the owner — `guestFaqAnswer(text)` runs a small precision-biased
lexical matcher (whole-word token overlap + `GUEST_FAQ_SYN` synonyms, Q&A-weighted, threshold
≥3 with a question hit) over `CHAT_FAQ` + the active cottage's `siteContent['faqs-<prop>']`;
`sendChat()` intercepts a confident match (`chatFaqReply` shows the answer + a "Message a
person instead" fallback that re-sends bypassing the matcher via `__faqBypass`), and anything
unmatched reaches a human as before. Deflects the repetitive parking/wifi/dogs enquiries 24/7,
no server. Gated by smoke-test (matches from content + synonyms; nulls on unrelated/greeting).

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
