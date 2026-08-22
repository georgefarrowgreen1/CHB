# design/ — the back-office redesign canvas (source)

Working files for the proposed back-office frame, published as a Claude Design
canvas. Nothing here is deployed: the deploy mirrors `Cottage Holidays Blakeney/`
only, the same way `mac-app/` sits outside it.

- `*.dc.html` — one file per artboard. `Main.dc.html` is Today.
- `canvas.json` — the layout: positions, the two pages, the sticky notes.
- `build.mjs` — regenerates every sibling artboard from ONE shared style block
  lifted from `Main.dc.html`, so the design system cannot drift between frames.
  Run `node build.mjs` after editing Main's `<style>` or any sibling's body.

The values are the app's own: `app.css`'s `:root` + `body.light-mode` tokens and
`admin.css`'s component rules (`.bhub-fold-row`, `.st-cap`, `.acr-well`, the
`--cmdk-fs-*` type scale). If those change, change them here too or the mockups
stop describing the product.

- `shot.js` — renders an artboard on its own and screenshots it, so a frame can
  be LOOKED AT before it is published (`node shot.js WebLaptop`). It found the
  £1,190 count overflowing its icon in the folded rail, which no check would
  have. Needs playwright in the website's `node_modules`; `CHB_CHROMIUM`
  overrides the browser, the same two rules the ui-test suites follow.

## The pages

1. **The proposal** — Today, a stay open, Inbox, Money, Cottages, phone.
2. **Other directions** — two I did not take, each with its tradeoff named.
3. **In a browser** — the same design at 1440 / 1180 / 960, which is where the
   left rail's cost shows: folded to icons it is a vertical dock, and the live
   counts beside each area degrade to pips.
4. **On a phone** — Today, a stay, Inbox, Money, Ask at 390. Two of the three
   changes do not exist here: the rail becomes the bottom dock the app already
   has, and the pane becomes a page. Only the day spine crosses over, and it
   condenses to one line off Today to earn its ~150px.

The seeded `.html` is gitignored — it embeds the whole canvas editor. Re-seed it
with the `/design` skill's helper from these files.
