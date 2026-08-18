#!/usr/bin/env node
// ============================================================
//  make-icon.js — draws build/icon.png, the app's Dock icon.
//
//      CHB_CHROMIUM=/path/to/chrome node build/make-icon.js
//
//  WHY THIS EXISTS. icon.png used to be a byte-for-byte copy of the website's
//  own icon-512.png. That is the right file for a PWA — a browser, and iOS,
//  MASK a web icon into the platform's shape — and the wrong one for macOS,
//  which masks nothing: a Mac app supplies its own silhouette. So the app sat
//  in the Dock as a hard-cornered square beside every other rounded app, and
//  it could not have been otherwise, because that PNG has no alpha channel
//  (colour type 2) and so cannot have a rounded corner at all.
//
//  APPLE'S GRID, which is the part that is measurable rather than a matter of
//  taste. A macOS app icon is drawn on a 1024×1024 canvas with the body
//  occupying 824×824 in the centre — the ~100px margin all round is not waste,
//  it is where the system's shadow sits and what keeps every icon in the Dock
//  optically the same size. The corner radius at that size is 185.4.
//
//  THE SHAPE IS A CONTINUOUS CURVE, NOT AN ARC. `border-radius` draws a
//  quarter-circle, which meets the straight edge with a sudden jump in
//  curvature — the eye reads it as a corner stuck onto a square. Apple's shape
//  eases into the straight run, so it reads as one outline. squirclePath()
//  below is the standard approximation of it (the figma-squircle
//  construction), and the difference at r=185 is plainly visible: see the
//  --compare flag, which writes both for looking at side by side.
//
//  Rendered through Chromium rather than an image library because this
//  container has neither ImageMagick nor sharp, and `omitBackground` is what
//  gives the transparent margin its alpha.
// ============================================================
'use strict';
const path = require('path');
const fs = require('fs');

let playwright = null;
for (const where of [path.join(__dirname, '..', '..', 'Cottage Holidays Blakeney', 'node_modules', 'playwright'), 'playwright']) {
    try { playwright = require(where); break; } catch (e) { /* try the next */ }
}
if (!playwright) {
    console.error('make-icon: playwright is not installed.');
    process.exit(1);
}

const SIZE = 1024;          // the largest slice an .icns carries
const BODY = 824;           // Apple's icon body within it
const RADIUS = 185.4;       // ...and its corner radius
const SMOOTH = 0.6;         // Apple's corner smoothing

const rad = (d) => (d * Math.PI) / 180;

// One rounded rectangle with CONTINUOUS corners. Same construction
// figma-squircle uses: the corner is a short circular arc with a cubic Bézier
// either side of it easing the curvature into the straight edge, rather than
// the bare quarter-circle border-radius gives.
function squirclePath(w, h, r, s) {
    const maxR = Math.min(w, h) / 2;
    r = Math.min(r, maxR);
    const p = Math.min((1 + s) * r, maxR);

    let alpha, beta;
    if (r <= maxR / 2) {
        beta = 90 * (1 - s);
        alpha = 45 * s;
    } else {
        const t = (r - maxR / 2) / (maxR / 2);
        beta = 90 * (1 - s * (1 - t));
        alpha = 45 * s * (1 - t);
    }
    const theta = (90 - beta) / 2;
    const dP3P4 = r * Math.tan(rad(theta / 2));
    const arcLen = Math.sin(rad(beta / 2)) * r * Math.SQRT2;
    const c = dP3P4 * Math.cos(rad(alpha));
    const d = c * Math.tan(rad(alpha));
    const b = (p - arcLen - c - d) / 3;
    const a = 2 * b;

    // One corner, from the end of the straight edge round to the next.
    const corner = (rot) => [
        `c ${a} 0 ${a + b} 0 ${a + b + c} ${d}`,
        `a ${r} ${r} 0 0 ${rot} ${arcLen} ${arcLen}`,
        `c ${d} ${c} ${d} ${b + c} ${d} ${a + b + c}`,
    ].join(' ');

    const straightH = w - 2 * p;
    const straightV = h - 2 * p;
    return [
        `M ${p} 0`,
        `h ${straightH}`, corner(1),
        `v ${straightV}`, `c 0 ${a} 0 ${a + b} ${-d} ${a + b + c}`,
        `a ${r} ${r} 0 0 1 ${-arcLen} ${arcLen}`,
        `c ${-c} ${d} ${-(b + c)} ${d} ${-(a + b + c)} ${d}`,
        `h ${-straightH}`, `c ${-a} 0 ${-(a + b)} 0 ${-(a + b + c)} ${-d}`,
        `a ${r} ${r} 0 0 1 ${-arcLen} ${-arcLen}`,
        `c ${-d} ${-c} ${-d} ${-(b + c)} ${-d} ${-(a + b + c)}`,
        `v ${-straightV}`, `c 0 ${-a} 0 ${-(a + b)} ${d} ${-(a + b + c)}`,
        `a ${r} ${r} 0 0 1 ${arcLen} ${-arcLen}`,
        `c ${c} ${-d} ${b + c} ${-d} ${a + b + c} ${-d}`,
        'z',
    ].join(' ');
}

// The crown, lifted from src/ui/crown.svg so the Dock icon and the window's
// own mark are the same artwork rather than two drawings of one idea.
const CROWN = `
<g transform="matrix(0.857142857,0,0,0.857142857,3.86861,23.159729)">
  <path d="M 9.305130371658928 -8.279466277516764 L 9.309300329634548 -8.279466277516764 L 9.699124142968216 -8.279466277516764 L 6.994906395779325 -12.590664765213132 L 1.2601380611160131 -14.529022650008908 L 5.479597473348762 -8.279466277516764 L 9.305130371658928 -8.279466277516764 Z" fill="url(#g0)"/>
  <path d="M 16.227193353799684 -8.279466277516764 L 20.44665276603243 -14.529022650008908 L 14.711884431369116 -12.590664765213132 L 12.007666684180228 -8.279466277516764 L 16.227193353799684 -8.279466277516764 Z" fill="url(#g1)"/>
  <path d="M 13.557411388602999 -12.590664765213132 L 10.853395413574221 -16.900652619948836 L 8.149379438545443 -12.590664765213132 L 10.853395413574221 -8.28067691047743 L 13.557411388602999 -12.590664765213132 Z" fill="url(#g2)"/>
  <path d="M 4.156779191663706 -5.821881367369727 L 17.550011635484744 -5.821881367369727 L 16.235735041911028 -7.47943966267826 L 5.471055785237414 -7.47943966267826 L 4.156779191663706 -5.821881367369727 Z" fill="url(#g3)"/>
</g>`;

// The crown's own box inside crown.svg's viewBox, so it can be centred on the
// icon body by arithmetic rather than by nudging until it looks right.
const CROWN_VB = { x: 4.449, y: 8.173, w: 17.446, h: 10.496 };

// How much of the body's width the mark takes. 0.62 keeps it inside the
// corners' influence — a mark that reaches the edges of a rounded square reads
// as cramped at Dock size, where the icon is 32px.
const MARK = 0.62;

function svg(shape) {
    const off = (SIZE - BODY) / 2;
    const markW = BODY * MARK;
    const markH = markW * (CROWN_VB.h / CROWN_VB.w);
    const scale = markW / CROWN_VB.w;
    // Optically centred, not arithmetically: the crown is bottom-heavy (the
    // band), so its mass sits low and dead-centring leaves it looking dropped.
    const markX = off + (BODY - markW) / 2;
    const markY = off + (BODY - markH) / 2 - BODY * 0.012;

    // ONE path, used for the fill, the clip and the rim — so the comparison
    // below really compares two shapes. It did not: the rim was drawn with
    // squirclePath() whatever `shape` said, and since a stroke straddles the
    // outline it was the rim that defined the silhouette. Both variants
    // measured identical, which is how a vacuous comparison looks when you
    // measure it instead of glancing at it.
    const d = shape === 'arc'
        ? roundedRectPath(BODY, BODY, RADIUS)
        : squirclePath(BODY, BODY, RADIUS, SMOOTH);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="g0" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#dfb9a4" offset="0"/><stop stop-color="#af877b" offset="1"/></linearGradient>
    <linearGradient id="g1" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#c49d8d" offset="0"/><stop stop-color="#956c65" offset="1"/></linearGradient>
    <linearGradient id="g2" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#d8b19e" offset="0"/><stop stop-color="#a67d73" offset="1"/></linearGradient>
    <linearGradient id="g3" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#b99284" offset="0"/><stop stop-color="#916862" offset="1"/></linearGradient>
    <!-- The site's own --dark-grey, lifted a little at the top so the face has
         the depth every Mac icon has rather than reading as a flat sticker. -->
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#23262c"/><stop offset="1" stop-color="#121316"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.03"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="bodyClip"><path d="${d}"/></clipPath>
  </defs>
  <g transform="translate(${off} ${off})">
    <path d="${d}" fill="url(#ground)"/>
    <!-- The top rim. Apple's own icons carry a light edge where the face meets
         the sky; without it a dark icon looks like a hole in the Dock. CLIPPED
         to the body, because a stroke straddles its path — unclipped it put
         1.5px outside the outline and the silhouette measured 828 where
         Apple's grid says 824. -->
    <g clip-path="url(#bodyClip)">
      <path d="${d}" fill="none" stroke="url(#rim)" stroke-width="6"/>
    </g>
  </g>
  <g transform="translate(${markX} ${markY}) scale(${scale}) translate(${-CROWN_VB.x} ${-CROWN_VB.y})">${CROWN}</g>
</svg>`;
}

// A PLAIN border-radius corner — a quarter-circle — kept only so --compare has
// something real to compare the squircle against.
function roundedRectPath(w, h, r) {
    return [
        `M ${r} 0`, `h ${w - 2 * r}`, `a ${r} ${r} 0 0 1 ${r} ${r}`,
        `v ${h - 2 * r}`, `a ${r} ${r} 0 0 1 ${-r} ${r}`,
        `h ${-(w - 2 * r)}`, `a ${r} ${r} 0 0 1 ${-r} ${-r}`,
        `v ${-(h - 2 * r)}`, `a ${r} ${r} 0 0 1 ${r} ${-r}`, 'z',
    ].join(' ');
}

(async () => {
    const compare = process.argv.indexOf('--compare') !== -1;
    const browser = await playwright.chromium.launch({ executablePath: process.env.CHB_CHROMIUM || undefined });
    const ctx = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();

    for (const shape of compare ? ['squircle', 'arc'] : ['squircle']) {
        const out = compare && shape === 'arc'
            ? path.join(__dirname, 'icon-arc-for-comparison.png')
            : path.join(__dirname, 'icon.png');
        await page.setContent(
            '<style>html,body{margin:0;background:transparent}</style>' + svg(shape),
            { waitUntil: 'load' },
        );
        // omitBackground is what makes the margin TRANSPARENT — without it the
        // page's white shows through and the icon is a square again.
        await page.screenshot({ path: out, omitBackground: true });
        const b = fs.readFileSync(out);
        console.log(shape, '→', path.basename(out),
            b.readUInt32BE(16) + 'x' + b.readUInt32BE(20),
            'colour type', b[25], '(6 = RGBA)',
            Math.round(b.length / 1024) + 'KB');
    }
    await browser.close();
})();
