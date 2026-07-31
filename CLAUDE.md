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
- **`node bump.js <new-build-stamp>`** does the WHOLE chain in one go (stamp =
  lowercase/digits, ≥6 chars): BUILD (app.js last statement), CACHE (sw.js), the
  `?v=` pins in index.html + sw.js CORE for whichever assets git says changed, and
  ADMIN_BUNDLE_V / ADMIN_CSS_V when admin.js / admin.css changed. `--dry` previews.
- CI enforces it: `check-versions.js` diffs the PR against its base and fails if a
  changed cached asset kept its version; smoke-test §6c checks the static half
  (sw.js CORE ?v= == index.html ?v=, BUILD well-formed ≥6 chars).
- Then run `node smoke-test.js` and `php test-pricing.php` — must pass (CI runs both).

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

**The CROWN is the assistant** (admin.js `crownSheetToggle`/`crownSheetOpen`/`crownSheetClose`,
styled in admin.css) — the dock's separate Search knot is GONE.
Rationale, measured: `nav()` rewrites `view-main` → `view-backoffice` for anyone signed in
(app.js), so the crown's old tap went to Today, exactly where the calendar icon already goes —
it had no unique job to lose, and the dock drops 5 icons to 4. Tapping it drops a POP-OUT rather
than jumping to a page, because the bar CANNOT host a field: at 390px the middle slot yields
80px once the crown and four icons have theirs (the pop-out's input measures 215px+).
**The pop-out IS the search** — see SEARCH IS THE POP-OUT below. There used to be a separate
`#crown-sheet` node here that showed four brief rows and handed off on Enter to a full-bleed
`#cmdk`; it is REMOVED (node, CSS, `crownSheetEl`/`Rows`/`Open`/`Close`, `#crown-scrim`,
`#crown-ask`, the `.cs-*` classes). Do not reintroduce a second surface: the sheet was a menu
for the feature, so the actual answers lived one journey away. `crownSheetToggle` KEEPS its
name (it is in the `chbAct` registry and on the crown's `data-act`) and now just toggles
`#cmdk`. Six things it must keep right, all gated by `ui-test-crownsheet.js`:
(1) z-index 1440 — BELOW the header's 1500 — so the crown stays hittable and one target toggles
both ways; (2) **`.logo` must be pinned `flex: 0 0 auto`** — it is `0 1 auto` by default and a
long screen name in the condensed bar squeezed it to **20px** (deleting the pin during this very
change measured **19px**, and the gate caught it), and the crown is the only route to the
assistant; (3) `crownSheetToggle` SELF-HEALS — admin.js cannot be un-run, and `.logo` is
the public site's Home link, so the handler checks `owner-mode` and navigates home when it has
gone; (4) Escape hands focus back to the crown (`crownSetExpanded` keeps `aria-expanded` in step
from `openCmdK`/`closeCmdK`, so every route in and out reports the same thing); (5) the crown
carries the model STATE (colour only — the download progress ring is REMOVED; see below);
(6) a query is ANSWERED IN PLACE — nothing hands off, because there is nowhere to hand off to.
Reduced motion keeps the pop-out (it is information) and drops only the spring.

**ONE assistant look** (admin.css, the "ONE ASSISTANT LOOK" block) — this block exists
because the crown sheet and the search page were once the same feature on TWO surfaces and
had already drifted (the page's field was a bare transparent input at 6px radius against the
sheet's bordered pill; the page used `--r-lg` against the sheet's `--r-panel`). There is only
ONE surface now, so the block's grouped selectors have been collapsed to it and the dead
`#crown-ask` / `.cs-*` halves are gone — but the block stays as the one place the assistant's
material is stated: panel radius + the darkstar hairline, the pill field with its accent focus
ring, the row rhythm (44px touch floor, shared label/sub sizes), and the hint footer. Worth
keeping from the two-surface era: `.cmdk-foot` was hidden behind `hover: hover and pointer:
fine`, so a PHONE got no hint at all while the sheet always stated its keys — touch gets a
touch-appropriate line instead of the ⌘K keycaps.

**SEARCH IS THE POP-OUT the crown drops** — one surface, not two
(`#cmdk.cmdk-overlay` + `#cmdk-scrim`, z **1440/1430 — BELOW the header's 1500**, and far below
the real modals at 2000+, so a glassConfirm raised FROM search — the bulk-send confirm — covers
it). Reached by tapping the crown (`crownSheetToggle` → `openCmdK`) or ⌘K; the per-workspace
Assist Bars were RETIRED in its favour (the whole `abar*` module, host divs and CSS are gone —
do not resurrect). The markup still ships inside the `view-search` template because that is how
`ensureAdminViews()` delivers it, but **`cmdkEnsureOverlay()` re-parents `#cmdk` to `<body>`** on
bundle load and that is not optional: a `.page-view` carries a transform, making it the
containing block for any fixed child, so left in place the "overlay" would be pinned inside the
page (the same trap the cottage page's sticky bar hits). Consequences to keep straight:
`openCmdK` does NOT navigate — the active view is UNCHANGED while search is up, which is what
lets scope/entity snapshots keep working; `closeCmdK` now hides the window as well as cleaning
state, and every existing caller wanted that (a result run closes then navigates underneath);
`cmdkBack()` only closes and returns focus to the crown, since there is nowhere to go back TO;
⌘K toggles on `cmdkIsOpen()` rather than the active view; and `nav()`'s teardown hook is keyed on
the overlay's own class via a DOM check (app.js may not reach admin globals) so ANY navigation
while it is open still files the dead-end miss and supersedes in-flight searches. `body.cmdk-open`
locks the page scroll and `.cmdk-results` scrolls inside the box with `overscroll-behavior:
contain`, so the workspace behind never scrolls with it. **BUT NOT ON A PHONE.** At 390px the box measures 370 of 390 — it is
effectively full bleed again, so it blurs the whole workspace rather than its edge
and an amber "Part paid" pill two screens down smeared across the money card.
Below 641px the panel is OPAQUE (`--cmdk-surface`, the ground a11y-test already
measures words against) with the blur off; glass returns from 641px, where the
pop-out really is a small card on a visible desktop. Same rule as the original
full-bleed decision, applied at the width where the condition recurs.
**The Siri aura is a RIM, not a cloud.** It was three stacked glows out to 92px
blur / 10px spread, which painted a purple haze well beyond the panel and read as
an artifact rather than a material. One hairline ring plus a 22px tight glow, hue
still cycling, so ui-test-searchpage §17's "the painted shadow moves" holds.
**A group is a FILL, not a card.** `.cmdk-board` carried a fill AND a hairline
border AND filled rows inside it — three edges in ~90px, so the money row read as
a card inside a card inside the panel. The border is gone, the group pads its
CHILDREN rather than itself (so rows span it edge to edge), rows square off and
are separated by hairlines, and the selected row is a full-width band. NB the
caption's inline padding must equal the ROW's (22px), because §18f compares where
the caption's text starts against the row LABEL, and a row's label begins at its
padding edge once the answer glyph is hidden inside a group — 20px put the heading
2px inside its own list.
**NO KEYBOARD CURSOR ON A TOUCH DEVICE, AND NO TILE BEHIND AN ICON.** The landing
preselects row 0 so arrow keys have somewhere to start; on a phone there are no
arrow keys, so it painted one row as chosen before the owner had chosen anything.
Suppressed under `(hover: none) and (pointer: coarse)` — desktop keeps it, because
arrowing the list is a real feature with its own gates, and those run with a fine
pointer so none of them moved. The icon TILES are gone too (`.cmdk-row-ic` and the
screen / answer / figure / tophit variants): a filled lozenge under every glyph put
a second shape in each row. Keep the 32px BOX — it is what puts every label on the
63px rail §18f measures. NB the tile was carrying the icon's CONTRAST: bare
`--accent` is 2.70:1 on the light pop-out surface, under the 3:1 non-text bar, so
the glyphs moved to `--accent-text` (4.93:1; identical in dark). That took the
a11y `accentAsText` ratchet 23 → 19.
**The field's focus ring HUGS.** It is autofocused for the pop-out's whole life and
a text input always matches `:focus-visible`, so `2px solid accent` at
`outline-offset: 2px` over an accent border was permanent decoration and the
loudest thing on screen. A 62%-accent border plus a 2px tinted ring reads as the
active control without shouting.
**Glass is RIGHT again at this size, and that is the inverse of the rule it replaces.**
As a full-bleed panel it had to be OPAQUE (`--cmdk-surface`) with its content in one
centred column (`--cmdk-measure`), because 78% white over a 24px blur reads as depth at
680px — only the workspace's EDGE blurs through — while at screen size the whole back
office smears through it, measured in light mode as grey blobs over the lower two thirds,
looking like a dirty screen; and at 1280px every row stretched full width, so a guest's
name sat at the far left with ~1000px of nothing beside it. A 520px pop-out has neither
problem: it blurs only the edge, and its own max-width IS the measure. So the box carries
`var(--glass-bg)` + `blur(22px) saturate(1.3)` again, and the centred-column override is
gone. `--cmdk-surface` stays registered in **a11y-test's `SURFACES`** — a new surface must
declare itself there exactly as a new text token must, and it is break-tested (a mid-grey
surface fails all seven text tokens). It **DROPS** rather than appearing: the box is kept
in the layout (`visibility`, not `display:none` — `display` cannot be transitioned) and
falls `translateY(-10px) scale(0.985)` → home. On `transform`, never width/height, for the
reason the dock icons stuttered. Easing is **`--spring`**, which a full-bleed panel could
NOT use (its 1.56 overshot to scale 1.06, pulling the edges past the viewport and cropping
its own content) but a small panel can — overshoot is life on a card. `#cmdk-close` is no
longer the ONLY way out now that the crown, the scrim and Escape are all reachable, but it
stays as the obvious one on a phone (a back chevron, distinct from the ✕ clear, which only
empties the query). Reduced motion keeps the pop-out and drops the spring. Gated by
ui-test-searchpage §8 — it drops and settles, hangs BELOW the header, does NOT cover it,
the crown stays hittable, the panel fits on screen with the results scrolling inside, and
close is ≥24px and named. The `<main id="view-search">` shell and its `ADMIN_VIEWS` entry
are vestigial — see the task list; `ui-test-adminviews` asserts the shell is empty BY
DESIGN so a half-done removal is caught.
**`cmdk-wide` is decided at the TOP of `cmdkRenderInner`, above every early return.** It
used to be toggled where the pane renders — which the `__cmdkDeep`, `__cmdkEmpty` and
no-results branches all `return` before, so those screens kept whatever width the last
selection left behind: measured at 1440, the empty landing rendered 860px with NO pane and
its boards silently reflowed to two columns, deep search 860×373 with `.cmdk-detail` null,
and closing deep search stayed stuck at 860. Deciding once at the top keeps the invariant
("one place decides the pane, the same place sizes the box") actually true.
**THE POP-OUT CONTAINS FOCUS** (`cmdkTrapTab`, `CMDK_FOCUSABLE`, installed by `openCmdK`
and removed by `closeCmdK`, plus `aria-modal` on the node). The workspace is still behind
the scrim and used to be reachable: ONE Shift+Tab from the field landed on a "Save note"
button inside the booking hub — off screen, unreachable because `body.cmdk-open` is
`overflow:hidden`, fully activatable, wearing a focus ring nobody can see — and two
Shift+Tabs plus typing put the text into that booking's notes textarea while the field
stayed empty. Forward Tab escaped onto the crown and the dock. Deliberately a keydown trap
rather than `inert` on the rest of the page: the workspace must keep rendering (the point
of a pop-out over a page you can still see) and `inert` would have to be unwound on all
four exit paths. **Result rows carry `tabindex="-1"`** for the same reason: they are
`role="option"` buttons and were tabbable, so Tab could put the ring on one row while
`.is-sel` sat on another, and once focus left the field EVERY arrow key was dead (all key
handling is bound to the input) — measured, a real ArrowDown on a focused row moved
nothing. Arrows own the list, Tab owns the chrome. **`.is-kbd` renders a real ring**:
Left/Right emitted that class with no stylesheet rule anywhere, so sub-focus was invisible
(pixel-diff 0 changed px of 29040) while the cursor resting on action 0 arms a bulk money
send. **A selected BOARD row keeps its background**: the board's `background: none` reset
and `.cmdk-row.is-sel` are both (0,2,0), so the later rule won and the selection computed
transparent in both themes — on the pop-out's DEFAULT state — leaving a 3px bar at 1.73:1;
the reset is now `:not(.is-sel):not(:hover)`. **Focus is not hover**: `.cmdk-clear`,
`.cmdk-help-btn` and `.cmdk-chip` ended their hover rule with `outline: none`, killing the
global ring (0px against `#cmdk-close`'s 2px in the same row). **An action's failure never
prints server internals** — `chbActErrSay` gates it, because apiPost slices a failed body
to 200 chars and a 500 rendered a PHP fatal, SQLSTATE and the host filesystem path into
the window verbatim. Some throws here are deliberate PROSE (`chbBulkRun` raises "Couldn't
send any — Dan Rowe has no email address"), so the test is whether the message looks
written for a person: no markup, stack frame, SQLSTATE, `.php` path or bare snake_case
identifier, and short enough to be a sentence. Gated by ui-test-searchpage §15, each item
break-tested; the error one gates the WIRING as well as the helper, because testing
`chbActErrSay` alone passed with the call site reverted to `e.message`.
Row anatomy, measured and refined: `.cmdk-row-label` CLAMPS TO TWO LINES (one line
cut "Alexandrina Featherstonehaugh-Smythe" by 189px of 306px — over half the row's
identity; the pop-out has the vertical room for two), label and sub both carry the raw text
as a `title` because `cmdkHi` returns highlight markup that cannot go in an
attribute, `.cmdk-qa-row` joins `.cmdk-row`/`.cs-row` in the 44px touch floor (it
had been left OUT of that group and sat at 23px, 1px under WCAG), and
`.cmdk-group-label` is 0.72rem (was 0.64rem = 10.2px). The row SUB stays
single-line on purpose — letting every sub wrap makes the list untenable to scan,
and the money subs already lead with the figure, so what clips is trailing context.
**TWO RAILS, NOT FIVE** (ui-test-searchpage §18f–g). Panel EDGES stand on the answer's
own text rail (21) and every LABEL stands on the list's (63). Getting there: the Top
Hit's icon tile was 36px against every other row's 32, pushing its label to 67 — the
one row the eye lands on first, alone on its own rail (it keeps four other emphasis
signals; size was the only one that cost alignment); the hero's action label sat at 65,
fixed by taking 2px off that row's gap so the panel edge stays on 21 AND the words land
on 63; and "search everything" sat at 48.4, on neither, so it was rebuilt with a row's
anatomy — row padding, row gap, a 32px icon box, and an INSET ring instead of a border
because a 1px border puts it a pixel out. `border: none` there is load-bearing: it is a
`<button>`, and dropping the border declaration hands it Chromium's UA `2px outset`
(the second time this file has been caught by a button's UA chrome — see
`.cmdk-qa-row`). **When measuring a rail, keep `edge` and `text` apart** — a box's
outer boundary is what you compare against type, its content start is what you compare
against other type. Conflating them made one draft call a correctly-aligned caption
10px out and another call a panel sitting exactly on 21 a 5px miss.
**"SEARCH EVERYTHING" OWNS THE RESULTS AREA WHILE IT RUNS** (`__cmdkDeepPending`,
`__cmdkDeepErr`, `cmdkRenderDeepWait`, `cmdkDeepReset`; ui-test-searchpage §19). The
2px sweep bar (`#cmdk-progress`) is real and does fire — the audit's "no loading state"
was wrong about that — but it answers in chrome a question asked of the RESULTS: the
quick palette's rows sat there for the whole server round trip (two, on a typo retry)
with nothing in the list saying so, and a FAILED deep search cleared the bar and said
nothing at all. The pending state wears the finished view's own frame so the panel does
not change shape when results land, and carries `role="status"` because the sweep bar is
`aria-hidden` decoration — without it the one announcement of "working on it" does not
exist. Two rules: **clearing the flags is the EXIT's job, not the fetch's** (every exit
bumps `__cmdkDeepStamp`, which makes the fetch's own handlers return early, so a flag
left to them would strand "Searching everything…" forever) — hence `cmdkDeepReset()`;
and the bump belongs at the exit SITES, never inside that helper, because `cmdkDeepFetch`
calls it too with its own stamp already captured. Fixing this surfaced a latent bug:
`cmdkSearchCore` cleared `__cmdkDeep` without bumping the stamp, so a slow deep response
arriving after the owner had moved on **reopened the deep view over their newer query**.
**A SHORT VIEWPORT SPENDS ITS HEIGHT ON RESULTS.** Measured at 740×400 (a landscape
phone): the pop-out is 296px tall and its chrome took 119 of them — a 74px field plus
a 45px keyboard-hint foot — leaving 175px of results, which showed ONE row of seven.
Under `max-height: 600px` the hint yields (advice about a keyboard, on a device with no
room to spare for it) and the field's padding tightens; results go to 228px. The foot
is hidden BY CONDITION, not outright — `:not(:has(.cmdk-sys.is-warn))` — because a
stopped automation earns its line at any size, the same judgement the 639px rule makes.
Gated by ui-test-searchpage §16f, including that a warning still gets through.
NB the cmdk `:hover` rules are deliberately NOT gated behind `@media (hover: hover)`
even though touch keeps a hover applied after a tap: it was considered and measured, and
since selection is hover PLUS the accent PLUS a 3px edge bar, a lingering tint reads as
a stale tint rather than a false selection — and Chromium cannot reproduce iOS's sticky
hover, so the change would have been unverifiable here for a defect that no longer
misleads. Revisit if selection ever loses the edge bar.
**ONE EMPTY STATE** (`cmdkNoneHtml(title, sub)` + `CMDK_WIDEN` + `CMDK_NONE_IC`) — there
were three, written independently and reading like three different products: the scoped
landing was a bare centred sentence with no mark, a query with no hits got mark + bold
title + sub, and deep search's zero got the title and sub with no mark; the same
"widen the scope" instruction appeared in two wordings and two capitalisations. One
renderer now, and `CMDK_WIDEN` is that sentence stated once so it cannot drift again.
Title and sub are **PLAIN TEXT escaped at the boundary** (the chbDuties rule) — the deep
zero used to escape its query inline, so passing pre-escaped text through would print
entities at the owner; §18b drives all three states and checks the query is escaped
exactly once (`&lt;` is CORRECT there, `&amp;lt;` is the double). Deep search's zero also
stops rendering the TYPE filter — with nothing found it was a lone "All 0" chip, 39px of
control offering to narrow nothing down, directly above the sentence saying there was
nothing — while KEEPING the recency switch, which is the one useful thing left to try.
The mark itself takes **`--accent-text` at 0.8**, not `--accent` at 0.6: it measured
1.76:1 on the light search surface, i.e. in the DOM and absent on screen. It is
decorative (`aria-hidden`), so no WCAG rule compels this and a11y-test does not cover
it — §18e does, by arithmetic on the computed colour against `--cmdk-surface`, because
"the thing that makes an empty result look designed rather than broken" has to be
visible to do that job.
**`.cmdk-qa-row` is a `<button>` and needs the full `.cmdk-row` reset**, not just
sizing: its UA chrome had never been removed, so it painted the browser's DEFAULT
control — `#efefef` face, 2px black border, centred 13px system font (measured
identical to a bare `<button>` in the same document). That face is nearly invisible
against light mode's cream, so it survived unseen until a phone in DARK mode showed
a light-mode button sitting in a dark UI. Its label takes **`--accent-text`**, the
words-vs-things rule again. ui-test-searchpage §9 gates it in both themes by
comparing every `#cmdk button` against a bare one — cheap, needs no colour model,
and it cannot drift with the tokens. Two traps that gate walked into first: the
quick-action rows only render beneath a SELECTED record (drive it the way §4b does —
`__cmdkSel` to the row carrying `actions` — because typing a name late in the suite
returns only chat answers, and the check then passes seeing NOTHING), and
`getComputedStyle` may hand back `color(srgb 0.99 …)` in **0–1 floats** where
`rgb()` is 0–255, which makes a near-white surface measure as near-black (that is
the fourth false contrast failure this codebase has produced — see a11y-test).
`.cmdk-box` keeps max-width 680px
(940px sheet) and every inner id, so the entire intelligence stack is unchanged. `openCmdK` snapshots the workspace you came FROM before
navigating — `__cmdkReturnView`, `__cmdkHomeScope = cmdkDefaultScope()`, `__cmdkEntity =
cmdkCurrentEntity()` — so the landing's shortcuts and record pronouns still resolve; `closeCmdK` is STATE
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
only · dimmed accent) and `learning` (teaching · orange pulse). There is **NO download
progress ring** and no `loading` state: a model file streaming down (darkstar.bin at boot,
encoder.onnx on the first history query) is reported nowhere, deliberately — the cascade is
lexical-only until the model lands, so search answers throughout and a progress arc was
reporting on something the owner never waits for. The ring, its `--mload` conic-gradient, the
`ml-loading` classes and the whole per-source fraction map went with it. Each knot's hover title (`CHB_MSTATE_TITLE`) explains the state in plain language, so the
colour never has to be decoded blind; there is NO worded pill any more (`CHB_MSTATE_LABEL` is
REMOVED). The knot never hides — the ✕ clear sits on the RIGHT of the input (after it, before
help); `has-text` only shows the ✕. All state animation honours `prefers-reduced-motion`
(meaning falls back to a static teal). `chbSetModelStatus('')` falls back to `ready` once the
model is loaded. Model files load through **`chbFetchBuf(url)`** — a plain fetch → arrayBuffer;
it used to stream the body and count chunks purely to feed the ring, so the reader loop, the
chunk reassembly and the wire-vs-decompressed clamp all went when the ring did. `ui-test-modelring.js`
(11 checks) and search-test §31 (8 checks) were deleted for the same reason: every one of them
tested the ring. Leaving the page on an unanswered query files it into the shared
miss store (`chbMissRecord`) — via `cmdkBack`/`closeCmdK` AND via `nav()`, which calls
`closeCmdK` when leaving `view-search` by ANY route (a dock tap, a result run) so the teach
loop, in-flight-search supersede and conv-context clear can't be skipped; `openCmdK` also
resets `__cmdkConvCtx` so a session never inherits the last one's pronoun referent.
**FOUR LAYOUTS OVER ONE RESULT SET** — the window changes shape with what you have
done, and all four are containers around the SAME rows from `cmdkRowHtml` at their
SAME `__cmdkResults` indices. That is the invariant: keyboard nav, `cmdkSyncActive`,
`aria-activedescendant` and every row's `run()` must survive a new layout, so a
layout may never re-order, re-index or swallow a row (the ui-test asserts every
board row still carries a `cmdk-opt-<i>` id, because a container that ate an index
would break arrow-key nav in total silence).
- **BOARDS** (`cmdkBoardsHtml`, `CMDK_BOARDS`) — the empty landing is a dashboard,
  not a list of links, and **the day LEADS it**: the order is Suggested (a direct
  answer to the record you were just on) → the day's greeting + boards → Most used →
  Jump to. The brief used to sit BELOW Most used, so the panel opened with two
  shortcuts above the greeting. Reorder in the ARRAY (`__cmdkResults`), never in the
  renderer alone — the landing renders SLICES by index and every row carries its
  `cmdk-opt-<i>` id, so moving the HTML blocks by themselves leaves arrow-key nav
  walking the old order while the eye jumps between groups (ui-test-searchpage §20
  checks the heading order AND that DOM order and index order rise together; the
  second one is what catches that mistake). The day's facts group into Today / Money / Waiting on you /
  This month, each board's first row at figure size, and a board with no rows does
  not render (a quiet day collapses instead of showing four empty cards). A brief
  row **DECLARES its board** (`board:` in `cmdkBriefBuild`) rather than having the
  renderer guess from its id — same principle as `scope`. Rows whose board is
  unrecognised still render as orphans: silently dropping one is the exact bug the
  scope filter caused on this screen. The grid is **one column and says so**: it was
  `repeat(auto-fit, minmax(240px, 1fr))`, responsive-looking dead code inside a 520px
  pop-out whose content box is 478px — two 240px tracks plus the gap need 490, so it
  computed to a single track at every width this window has, and boards only render
  on the empty landing (which never widens). Don't narrow the minimum to force two:
  a board row leads with a figure sentence that will not survive a 234px track.
- **ANSWER hero** (`cmdkHeroHtml`, `cmdkHeroFigure`) — when the leading row is an
  `answer`/`figure`, it takes the top of the window at reading size and the caption
  says "Answer", not "Top hit" (which describes the ranking, not the reply). The
  figure is emphasised **INSIDE** the sentence by one span: printing it above would
  repeat it, and deleting it from the sentence leaves "owed across 2 guests" —
  grammatical debris — so `chbSay`'s wording survives untouched. That emphasis is
  **WEIGHT, at the sentence's own size** (`.cmdk-hero-fig`, 700 against the label's
  600, plus tabular figures). It was `1.7em`/`1.5em`, which made "£290.00" tower
  over the words either side and stopped the answer reading as a sentence at all;
  the `line-height: 1`, `vertical-align: baseline` and tightened letter-spacing that
  sat with it existed ONLY to manage the oversized text and went with it, as did the
  `font-size: 1em` in `.cmdk-turn-a .cmdk-hero-fig`, whose whole job was undoing the
  hero's size so history didn't shout louder than the answer. Gated in
  ui-test-searchpage §11 — and NB that gate must query `.cmdk-hero .cmdk-hero-fig`,
  not `.cmdk-hero-fig`: the THREAD renders its own copy (it reuses `cmdkHeroFigure`)
  ABOVE the live answer, so a document-wide query measures history instead, which is
  exactly what the first version of the check did. A hero is captioned
  even on a short list, where group labels are otherwise suppressed, because an
  uncaptioned hero reads as a stray sentence. It is still a `role="option"`
  `.cmdk-row` at its own index.
- **THREAD** (`cmdkThreadPush/Html/Clear`, `CMDK_THREAD_MAX` 3) — earlier ANSWERED
  turns stay above the live answer, which is the only way the conversational frame
  (search-test §33) is visible: a refinement used to replace the single answer row
  in place, so it looked identical to a brand-new question. Pushed where a query
  COMMITS its results, never in the renderer (which re-runs on every selection change
  and would stack the same answer as you arrow down). A turn that merely EXTENDS the
  previous query replaces it, so per-keystroke typing is one turn and not eight.
  Dies with the session at the same two boundaries as `__cmdkConvCtx`. **It also
  survives a MISS**: the no-results branch returns before the one that renders the
  thread, so a conversation two answers deep vanished the moment a query found
  nothing and reappeared when the query was fixed — `__cmdkThread` had held the turns
  the whole time and only the screen lied. Finding nothing is not the same as never
  having asked (ui-test-searchpage §18c).
- **SPLIT** (`cmdkDetailHtml`) — at ≥1200px the selected booking shows BESIDE the
  results, so chasing three balances is one search instead of three. Three limits,
  each dodging a trap already in this codebase: it renders a SUMMARY from
  `findBookingById`/`paymentSummary`/`chbGuestIntel` and does **NOT** re-parent
  `#booking-hub-content` (that node already moves between the Inbox and Today; a
  third claimant empties one of them); the row's quick-actions stay inline rather
  than being rendered twice; and it is pure CSS at the **existing** 1200px pane
  breakpoint — no `matchMedia`, no resize listener, nothing to leave stale. The
  scope switch is hoisted OUT of the split, since it filters the search and not the
  left column. NB `propName` is a local elsewhere, so the pane reads `propertyMeta`
  directly. **The pop-out WIDENS (520 → 860px) while a pane is up**, and has to: the
  split was designed when this was a full-bleed window with ~1000px going spare, and
  inside the 520px pop-out the grid still fired and starved the thing it sits beside
  — measured at 1440px, 226px of results list against a 260px pane, i.e. the list
  narrower than its own sidebar. `cmdkRenderInner` toggles `.cmdk-wide` at the one
  point that decides to render a pane, so the width and the pane can never disagree;
  it narrows back the moment nothing is selected. NB this also means SELECTION
  changes the box width, which broke §10 — it measures the pop-out's RESTING shape
  and an earlier section had left a booking selected, so it silently began reading
  the wide box. It clears the selection before measuring now. Gated by
  ui-test-searchpage §11, each of the four layouts break-tested independently.

**A TYPED QUERY SPANS EVERY CATEGORY, and the workspace snapshot only shapes the
LANDING.** They used to be one variable: `openCmdK` put `cmdkDefaultScope()` straight
into `__cmdkScope`, so opening search from Today pre-scoped it to "Bookings" — and
`cmdkArrangeWide` only widens when the scope yields NOTHING, so a guest with bookings
always yielded something and their emails, chats and payments were filtered out in
silence (no widen note, because the search hadn't failed). Two variables now:
**`__cmdkScope`** is the OWNER'S choice — `'all'` until they tap a chip, and the chips
still narrow exactly as before — and **`__cmdkHomeScope`** is the workspace snapshot,
read by the empty landing ALONE. Same split in the empty states: the scoped no-results
state renders `CMDK_WIDEN` ("tap All above") because its chip bar is on screen, while
the LANDING's dead end may not — the bar is hidden there (`sb` is `''` while
`__cmdkEmpty`), so it used to name a control that wasn't on screen, and now says
"Nothing to show yet · Type a name, a screen, or a question". `cmdkScopeLabel(k)`
is the one place a scope is put into words (the empty states printed the raw key).
Gated by ui-test-searchpage §22 (snapshot vs choice, every category survives a typed
query, the OLD behaviour break-tested in the gate itself, an explicit chip still
narrows, the landing's Jump-to still differs by workspace) and §18b.
On that landing: **the day brief is NOT filtered** (the "Jump to" list still is),
and **the scope switch is HIDDEN on that state** so nothing on screen claims a filter
it isn't applying — it appears the moment you type, which is when it starts meaning
something. Removing the Jump-to filter as well was tried and BACKED OUT: it is what
keeps that list short, and without it the landing's destinations went 124px → 271px
even capped at three (952px uncapped). Showing the shortcuts that suit the workspace
you came from is helpfulness, not a filter anyone needs a control for. The brief being
filtered was the FIRST bug of this shape — measured as **1 row surviving out of 4**,
which is why the landing looked empty. It summarises the DAY (arrivals, money to
collect, an enquiry waiting, the month's pace); dropping "£440 to collect" because you
happen to be standing on the bookings screen loses the point of the panel.
`cmdkHi` also needs **3 characters**, not 2: a
2-letter token has no word boundary to protect it and lit up inside unrelated words
("who owes **me** money" marked "pay·me·nt record"). It is display-only — it never scores.
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
`prefers-reduced-motion`. NB this was DEAD for the whole life of the pop-out:
`#cmdk.cmdk-overlay .cmdk-box` blanked the entire `animation` shorthand to cancel
`cmdkRise` (the drop replaces it) and took the aura with it, so a documented part of
the assistant's look rendered on no surface at all. Name the animation that goes, never
the shorthand — and restate the reduced-motion off-switch at the OVERLAY's specificity,
because the generic `.cmdk-box` rule is out-specified by it. **Motion in and out are
deliberately different, and used to be accidentally different**: `visibility` flipped
with no transition, so the box's own exit ran inside an already-invisible container —
the panel teleported while the scrim faded on for 260ms. The container now carries
`transition: visibility 0s linear 0.22s` (the `.open` rule restates it without the delay
so opening stays instant), the closed state is the quick unsprung EXIT and `.open`
carries the slow spring ENTRY. Gated by ui-test-searchpage §17, which samples the exit
by STATE rather than on a clock — `closeCmdK` does ~180ms of synchronous teardown before
the first paint, so a fixed 100ms sample reports "opacity 1" for an exit that works.
**Unified interface**: RESULTS/JUMP-TO/quick-ACTIONS are rows
(`.cmdk-row` / `.cmdk-qa-row`, distinct destination glyphs via a registry `icon` + a row's
`iconType`); refine/related/ask PIVOTS are pills (`.cmdk-chip`); one hover tint (`--cmdk-sel`),
one pill spec. Suite: `ui-test-searchpage.js` (page open/toggle/back, answers, logo states,
teach flash, conv follow-up, miss capture); the layout gate covers the page at phone width.

**Hubs are where you act; index rows are where you find.** The **booking hub**
(`view-booking-hub`) is the ONE home per booking — `showDetails()` (app.js) only
delegates to `openBookingHub()` (admin.js): status pipeline + next action + the
payments block are ONE unified header section (`.bhub-head` → `payBlock` /
`.bhub-headpay` — there is NO separate Payments card and NO second money
mini-pipeline: `hubPayFlowHtml` is REMOVED, guarded by search-test §16 + ui-test-hub
§A; the journey strip carries the money stages, the banner owns the "Request … by
card" CTA so the button row keeps only record/copy-link/invoice); then emails,
guest, change history via `bookings.php` `history` as grid cards; on desktop
(≥900px) the status pipeline shows ALL stages (upcoming = red dot), compact
Done·Now·Next below that; the payments block folds to ONE `.bhub-payline` in EVERY
state (settled "Paid in full £X ✓", part-paid "Received so far £X of £Y", untouched
"Total £Y" — label left with the deposit state as a small `.bhub-payline-sub`, the
serif figure right and NEVER wrapping; section labelled by a `.bhub-headpay-cap`
matching the pipeline caps, no inner glass box) with the full maths behind the
quiet "Show the full breakdown ›" text-link (`.bhub-linklike`, `bhubMoneyExpand`
pop-up, `__bhubBreakdownHtml`); no separate deposit info row remains — even
`holdControls`' fresh-booking note is gone (only real hold states render).
Booking EDIT protection is layered in `openEditBooking` (app.js): a FINISHED stay
(`hasCheckedOut`) is soft-locked — glassConfirm ("it's a record now") before the
form opens (never a hard block: name/email corrections stay possible; the sync
inner opener is `openEditBookingNow`, which `cmdkPrefillEditDates` relies on);
an arrived guest has dates+cottage locked (`lockBookingMove`); a fully-paid
booking hides the payment-entry fields (`trimPaidBookingFields`). Gated by
ui-test-hub §A3.
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
`require_guest()`, `site_base_url()`, `content_value()`. **Money primitives (db.php,
ONE definition each — never re-inline them):** `booking_ledger_net($id)` = settled
card charges − non-failed refunds (the raw net every paid/refund calc builds on;
callers add their own cap/floor), and `booking_rental_price($b)` = agreed nightly +
txn fee with an override floor. The FAILED-refund audit fix had to touch four copies
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
down" (`ps.deposit`) and "who's paid in full" (`ps.total`) — and the guest emails, whose
`booking_amount_due` quotes the rental with the deposit explained separately, which is
their own considered framing. NB the two shapes are NOT interchangeable — `paymentSummary`
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
  said so. `'email' => true` (payments, enquiries, a failing calendar sync) falls back
  to `send_owner()` when zero devices were reached.
- **WHAT INTERRUPTS YOU IS A SETTING.** `notify-prefs` (internal content key,
  classified in db.php) carries per-category mutes + quiet hours; `notify_should_push()`
  gates the PUSH only — the activity log and the email fallback are untouched, so
  muting loses nothing, and `'urgent'` (a sync failure that can double-book you)
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
- **Staging sandbox** (optional, opt-in): `deploy.yml` has a `deploy-staging` job that
  mirrors the same code to a `staging.<domain>` site with its OWN database + `config.php`
  (Square sandbox + test email) — a true isolated environment. It's a no-op until the
  `STAGING_SFTP_*` secrets are set (see `SETUP-STAGING.md`). On the staging host only,
  `.htaccess` sends `X-Robots-Tag: noindex` and `app.js` (`IS_STAGING`) shows a STAGING
  banner. Staging post-deploy is migrate-only (never fires owner notify/digest/nudge).

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
