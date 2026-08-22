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

The seeded `.html` is gitignored — it embeds the whole canvas editor. Re-seed it
with the `/design` skill's helper from these files.
