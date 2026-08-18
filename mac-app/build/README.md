# `build/`

## `icon.png` — the Dock icon

**Generated, not hand-drawn:** `CHB_CHROMIUM=… node build/make-icon.js`.
`--compare` also writes a plain-`border-radius` version beside it, purely for
looking at; don't commit that one.

It used to be a byte-for-byte copy of the website's `icon-512.png`. That is the
right file for a PWA — a browser, and iOS, **mask** a web icon into the
platform's shape — and the wrong one for macOS, which masks nothing: a Mac app
supplies its own silhouette. So the app sat in the Dock as a hard-cornered
square, and it could not have been otherwise: that PNG has no alpha channel at
all (colour type 2), so it could not have had a rounded corner.

What the generated one gets right, all of it measurable:

| | |
|---|---|
| **1024×1024, RGBA** | The largest slice an `.icns` carries, with the alpha a rounded corner needs. |
| **824×824 body, centred** | Apple's grid. The ~100px margin all round is not waste — it is where the system's shadow sits, and it is what keeps every icon in the Dock optically the same size. |
| **Continuous corners** | `border-radius` draws a quarter-circle, which meets the straight edge with a jump in curvature. Apple's shape eases into it. Measured, the difference is real: the squircle's curve starts 203px from the corner and is still easing 200 rows down, where the arc has started at 168 and met the edge by row 180. |
| **The site's own colours** | `--dark-grey` for the ground and the same crown artwork `src/ui/crown.svg` uses, so the Dock icon and the window's mark are one drawing. |

Gated at both ends: `test/core-test.js` §20 checks the file's shape and that it
has an alpha channel, and `test/ui-test.js` measures the rendered pixels — the
corners transparent, the body 824 and centred, and the corner profile far
enough out to be the continuous curve rather than an arc.

`electron-builder` converts it to an `.icns` at build time; nothing else needs
changing when it is regenerated.
