# CHB design language

One page that explains how the site is meant to look and how to keep new work
consistent. The tokens live at the top of `app.css` (`:root`) — build from
them, don't invent new raw values.

## Philosophy

Dark, warm, editorial. The site is a night-sky ground (`--dark-grey`) with
frosted **glass surfaces** floating over it, lit by one warm accent
(`--accent` rose-gold). Serif display type carries the headings; a quiet sans
carries the UI. Everything the visitor can touch sits on a glass panel; the
page background itself never carries content.

The three signature moves:

1. **Glass panels** — `.glass-panel`. The material follows Apple's **Liquid
   Glass** (iOS 26 / macOS Tahoe): it doesn't just blur, it lifts saturation +
   brightness (`--glass-filter`) so colour behind it refracts vividly, and it
   carries a **specular edge** — a bright catch along the top inner rim plus a
   faint base shade (`--glass-rim`) that reads as real glass thickness. Both are
   theme-tuned tokens; build glass from them, never a bare `blur()`. All primary
   surfaces are glass: header, hero panels, cards, modals, admin panels. Cards
   and the hero panels additionally get a gradient border rim (`::before`,
   `border-radius: inherit`) warming to rose-gold at the base.
2. **Three radii, and one curvature above them** — the system is **the CELL
   (`--r-sm`, 12) · the CARD (`--r-lg`, 20) · the PILL**, and a SHEET —
   a top-level surface: the header, a modal box, the search window, the pay
   card — keeps `--r-panel` (40px, 28px on phones ≤768). Everything else is one
   of the three; nested elements still step DOWN (a card holds cells, a cell
   holds pills), and an element inside a panel never repeats the panel's radius.
   Images inside padded cards are rounded concentrically
   (`calc(var(--r-panel) - padding)`).
   **THE CARD IS 20, and that is the decision** — the three-radii pass wins over
   the older reading that blessed `--r-panel` on every card, because a 190px tile
   wearing the header's 40px curve reads as a sheet rather than a card (measured
   on Manage's cottage tiles and the walkthrough's 250px tooltip).
   **`--r-md` (16) is NOT a step of that scale.** It is still live (34 rules in
   app.css, 9 in admin.css, down from 45 and 20) and correct where it sits — a
   FIELD's own radius — but it was painting on containers and rows too, where
   the ratchet could not see it (it counts px literals, and a token is not one). Those named container/row misuses were
   converted (view-pay, the assistant's rows, the chat's act card, Manage's
   cards, the coach's tip and ring); retiring the token itself is a separate
   pass, and `ui-test-radii.js` §6 is what holds the line meanwhile — it sweeps
   four screens and fails on any painted corner that is not 12 / 20 / a pill /
   `--r-panel` on a sheet, reading the COMPUTED value so a `var()` cannot hide.
3. **Fluid motion** — `--fluid-bezier` for fades/colour, `--spring` for
   physical movement (lift, scale, dock indicator). No plain `ease`/`linear`.
   Every animated affordance must respect `prefers-reduced-motion`.

## Tokens (use these, never raw values)

| Concern | Tokens |
| --- | --- |
| Glass material | `--glass-blur`, `--glass-filter` (blur + saturate + brightness), `--glass-rim` (specular edge) |
| Radius | `--r-sm` (cell, 12) `--r-lg` (card, 20) `--r-pill` — plus `--r-panel` for a SHEET, and `--r-md` for a field only (not a step of the three) |
| Spacing | `--space-1`…`--space-6` (8/16/24/40/64/96) — section padding, stack gaps, insets |
| Type scale | `--fs-h1` `--fs-h2` `--fs-h3` (serif via `--font-serif`) |
| Accent | `--accent` `--accent-soft` |
| Status | `--ok` / `--ok-text`, `--warn` / `--warn-text`, `--danger` (`-text` tints for text on dark glass) |
| Shadow | `--shadow-panel` (resting), `--shadow-float` (modals/popovers/FABs), `--shadow-soft` (small controls on hover) |
| Easing | `--fluid-bezier`, `--spring` |

Exception: canvas drawing (PDF invoice) and email HTML can't read CSS
variables — those keep literal colours on purpose.

## Layout system (desktop)

- Content column: `.container` — `width: 100%`, `max-width: 1200px`
  (the width matters: `<body>` is a flex column and auto margins alone would
  collapse pages to fit-content). Collection pages may use `.container.wide`
  (1500px).
- Homepage bands cap at 1200px (`.home-cottages`, `.home-trust`) so their
  edges align; the two marquee glass panels (hero headline, availability)
  share one width (880px) and read as a pair.
- On the cottage page the photo grid, text column and reserve card share
  left/right edges — don't add per-section max-widths that break alignment.
- Grids: `.grid.grid-3` (3-up ≥900, 2-up on tablets with the odd last card
  spanning the full row, 1-up ≤768).

## Breakpoints

Canonical: **480 / 640 / 900 / 1200** (max-width for phone tiers, min-width
for desktop tiers), plus one structural boundary at **768/769** — where the
nav collapses and the guest app shell (`body.guest-app`) takes over. Documented
exceptions: `1024` (admin back-office split), `1100` (header logo overlap fix),
`≤380/360` micro-fixes. New media queries use the canonical values; migrate
strays opportunistically when touched.

## Voice

Kickers are small tracked uppercase in accent (`.section-kicker`); headings are
serif sentence case; body copy is warm and first-person ("we'll confirm your
dates"). Buttons: `.btn-glass` for secondary, `.btn-accent` for the one primary
action per view — never two accent CTAs in the same panel.
