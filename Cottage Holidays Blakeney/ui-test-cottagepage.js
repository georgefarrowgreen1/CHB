// ============================================================
//  ui-test-cottagepage.js — the three screens a visitor sees first
//  (home, the cottages grid, the cottage page). Dev/CI only.
//
//      node ui-test-cottagepage.js
//
//  Six claims, each of which shipped broken and none of which any existing
//  suite could see, because each is about the PAINT rather than about the DOM:
//
//   §1 the cottage NAMES are the serif. `.card-title` declares
//      var(--font-serif) and every card carries data-edit-text, so
//      `[data-edit-text]{font-family:inherit}` tied on specificity and sat
//      later — measured, all three names painted Montserrat above a serif
//      price, the same trap round eight fixed for .section-title and left on
//      the cards.
//   §2 the MAP follows the theme. It was one CARTO light_all URL whatever the
//      body class, so in the default dark theme the map was a white sheet on a
//      near-black page (mean luminance 240 against a ground of 19). The tiles,
//      the zoom control and the attribution all have to move together, and a
//      map already mounted has to be swapped LIVE — the controls are CSS and
//      flip instantly, so a layer that waits for the next mount would leave
//      dark controls on a white map for as long as the page is open.
//   §3 the LIGHTBOX is one control family. Its arrows were a second design of
//      the gallery's own — an 8% white disc, invisible over a bright photo —
//      and all three controls took --text-light, which is near-black ink in
//      light mode on a scrim that is dark in BOTH themes.
//   §4 the LEGEND shows the cells the grid actually paints. It showed a green
//      dot for Available and a grey one for Booked; there is no green anywhere
//      in that calendar.
//   §5 the cottage's own Q&A has a DOOR. openFaqModal's only openers were the
//      My Stays booking cards, so a guest choosing a cottage could not reach
//      its parking/wifi/dogs answers from the page they were choosing on.
//   §6 the RAG. The facts line broke after a hanging '·' and orphaned
//      "2 bathrooms"; the waitlist link orphaned "available".
//   §7 a per-cottage review list named the cottage on every card, six times in
//      a list that is only about that cottage — while the SOURCE tag, the one
//      fact that varies between the cards, was pushed to a third line. Gated
//      here because nothing else reads .review-who at all.
//
//  SAMPLE THE PAINT, NEVER getComputedStyle ON A TRANSLUCENT SURFACE. The
//  lightbox disc, the map control and the calendar cells are all alpha over a
//  ground this file cannot read off a style declaration — this codebase has
//  produced six false contrast readings that way. Grounds come from the
//  screenshot; only OPAQUE declared inks are taken from the CSSOM, and §2
//  asserts the ink IS opaque before doing so.
// ============================================================
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
const zlib = require('zlib');

let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

// ---- PNG decode + contrast, no dependencies ----------------------------------
function decodePng(buf) {
    let pos = 8, idat = [], w = 0, h = 0, ct = 0, pal = null;
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos), typ = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.slice(pos + 8, pos + 8 + len); pos += 12 + len;
        if (typ === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
        else if (typ === 'PLTE') pal = data;
        else if (typ === 'IDAT') idat.push(data);
        else if (typ === 'IEND') break;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 3 ? 1 : 1;
    const stride = w * bpp;
    const out = Buffer.alloc(h * stride);
    let prev = Buffer.alloc(stride), i = 0;
    for (let y = 0; y < h; y++) {
        const f = raw[i++]; const line = Buffer.from(raw.slice(i, i + stride)); i += stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
            if (f === 1) line[x] = (line[x] + a) & 255;
            else if (f === 2) line[x] = (line[x] + b) & 255;
            else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
            else if (f === 4) {
                const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
            }
        }
        line.copy(out, y * stride); prev = line;
    }
    return { w, h, px: (x, y) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return null;
        const o = y * stride + x * bpp;
        if (ct === 3) { const k = out[o] * 3; return [pal[k], pal[k + 1], pal[k + 2]]; }
        return [out[o], out[o + 1], out[o + 2]];
    } };
}
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// A declared rgb()/rgba() composited over a SAMPLED ground.
function over(decl, ground) {
    const m = String(decl).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const a = p.length > 3 ? p[3] : 1;
    return [0, 1, 2].map((i) => Math.round(p[i] * a + ground[i] * (1 - a)));
}
const isOpaque = (decl) => { const m = String(decl).match(/rgba?\(([^)]+)\)/); if (!m) return false; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return p.length < 4 || p[3] === 1; };

// ---- fixtures ----------------------------------------------------------------
const PROPS = [
    { prop_key: '21a', name: '21A Westgate Street', slug: 'a21', couple_rate: 145, sort_order: 1 },
    { prop_key: 'jollyboat', name: 'Jollyboat Cottage', slug: 'jollyboat', couple_rate: 135, sort_order: 2 },
    { prop_key: 'pimpernel', name: 'Pimpernel Cottage', slug: 'pimpernel', couple_rate: 155, sort_order: 3 },
].map((p) => Object.assign({ extra_adult_rate: 40, child_rate: 25, transaction_pct: 3, booking_fee: 0, max_adults: 6, max_children: 2, max_total: 6, damages_deposit: 75, min_nights: 2 }, p));

// A cottage with answers written up — faqBlockHtml returns '' without them, so
// with an empty list §5 would pass on a button that is correctly absent.
const CONTENT = {
    'faqs-21a': [
        { icon: '', q: 'Is there parking?', a: 'Yes — one off-street space right outside.' },
        { icon: '', q: 'Can we bring a dog?', a: 'No dogs, sorry.' },
    ],
    'geo-21a': { lat: 52.9553, lng: 1.0186 },
};
// A booked stretch NEXT month, so the calendar has a real .taken cell that is
// not also .past (past dims to 0.3 and would be a different measurement).
function bookedRange() {
    const n = new Date();
    const y = n.getMonth() === 11 ? n.getFullYear() + 1 : n.getFullYear();
    const m = (n.getMonth() + 1) % 12;
    const p = (v) => String(v).padStart(2, '0');
    return { start: `${y}-${p(m + 1)}-10`, end: `${y}-${p(m + 1)}-16` };
}
// A BRIGHT photo: the 8% white disc is invisible over a pale picture, and a
// dark one would hide the defect this suite exists to catch.
const BRIGHT = 'data:image/svg+xml;base64,' + Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#f2f0ea"/></svg>'
).toString('base64');

async function openPage(browser, { width, theme }) {
    const page = await browser.newPage({ viewport: { width, height: width < 900 ? 844 : 900 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript((t) => {
        if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
        try { localStorage.setItem('chb-theme', t); } catch (e) {}
        // A LEAFLET STUB, not the CDN. The suite must not depend on a third
        // party's uptime (the call test-ical.php and test-maptiles.js both
        // make), and what is being gated here is OUR logic: which URL the app
        // hands a layer, and whether a mounted layer follows the switch. The
        // stub records both and exposes the real Leaflet DOM the CSS targets.
        window.__tileUrls = [];
        window.L = {
            map(el) {
                el.innerHTML =
                    '<div class="leaflet-control-container"><div class="leaflet-top leaflet-left">' +
                    '<div class="leaflet-control-zoom leaflet-bar leaflet-control">' +
                    '<a class="leaflet-control-zoom-in" href="#" title="Zoom in" role="button">+</a>' +
                    '<a class="leaflet-control-zoom-out" href="#" title="Zoom out" role="button">−</a>' +
                    '</div></div><div class="leaflet-bottom leaflet-right">' +
                    '<div class="leaflet-control-attribution leaflet-control">© OpenStreetMap, © CARTO</div>' +
                    '</div></div>';
                return { attributionControl: { setPrefix() {} }, setView() {}, fitBounds() {}, invalidateSize() {}, remove() {}, on() {} };
            },
            tileLayer(url) {
                const layer = { url, addTo() { return layer; }, setUrl(u) { layer.url = u; window.__tileUrls.push(u); } };
                window.__tileUrls.push(url);
                window.__lastLayer = layer;
                return layer;
            },
            divIcon() { return {}; },
            marker() { return { addTo() { return this; }, on() { return this; } }; },
        };
    }, theme);
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (url.includes('rates.php')) return json({ properties: PROPS, seasons: {}, occupancy: {} });
        // BOTH SHAPES. openProperty also fires the per-cottage availability call,
        // whose `ranges` overwrites what ?all=1 put in propertyAvailability — an
        // empty one there silently leaves the calendar with no booked cell at
        // all, which is how the first run of §4 had nothing to compare against.
        if (url.includes('availability.php')) return json({ ok: true, ranges: [bookedRange()], props: { '21a': [bookedRange()] } });
        return json({ ok: true, bookings: [], enquiries: [], reviews: [], photos: [], props: {}, events: [], content: CONTENT, value: null });
    });
    await page.goto(`${base}/index.html`);
    await page.evaluate((c) => { Object.assign(siteContent, c); }, CONTENT);
    return page;
}

// SCROLL, THEN RE-MEASURE. scrollIntoView did not commit here (measured: the
// map still read y 1092 in a 900px viewport 400ms later), so the scroll is
// explicit and every rect below is read AFTER it — the documented
// scroll-then-measure trap.
async function bringIntoView(page, sel, pad = 160) {
    for (let i = 0; i < 4; i++) {
        const y = await page.evaluate((s) => {
            const e = document.querySelector(s);
            return e ? e.getBoundingClientRect().top : null;
        }, sel);
        if (y === null) return false;
        if (y >= 0 && y < 200) return true;
        await page.evaluate(([s, p]) => {
            const e = document.querySelector(s);
            window.scrollTo(0, window.scrollY + e.getBoundingClientRect().top - p);
        }, [sel, pad]);
        await page.waitForTimeout(320);
    }
    return true;
}

let base;
(async () => {
    const t = await bootBrowser();
    base = t.base;
    const { browser, done } = t;

    // ================= §1 THE NAMES ARE THE SERIF =================
    console.log('\n== §1 The cottage names paint the serif on BOTH grids ==');
    {
        for (const width of [390, 1280]) {
            const page = await openPage(browser, { width, theme: 'dark' });
            await page.waitForTimeout(600);
            const home = await page.evaluate(() =>
                [...document.querySelectorAll('#view-main .card-title')].map((e) => getComputedStyle(e).fontFamily));
            await page.evaluate(() => nav('view-cottages'));
            await page.waitForTimeout(500);
            const grid = await page.evaluate(() =>
                [...document.querySelectorAll('#cottages .card-title')].map((e) => ({ t: e.textContent.trim(), ff: getComputedStyle(e).fontFamily, edit: e.hasAttribute('data-edit-text') })));
            const serif = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-serif').trim());
            const isSerif = (ff) => ff.split(',')[0].replace(/["']/g, '').trim() === serif.split(',')[0].replace(/["']/g, '').trim();
            ok(home.length >= 3, `@${width} the home grid has cottage titles to measure (${home.length})`);
            ok(grid.length >= 3, `@${width} the cottages grid has cottage titles to measure (${grid.length})`);
            ok(grid.some((g) => g.edit), `@${width} the titles really carry data-edit-text (the tie this fixes)`);
            const badHome = home.filter((ff) => !isSerif(ff));
            const badGrid = grid.filter((g) => !isSerif(g.ff));
            ok(!badHome.length, `@${width} every home card title is the serif` + (badHome.length ? ` — painted ${badHome[0].split(',')[0]}` : ''));
            ok(!badGrid.length, `@${width} every cottages card title is the serif` + (badGrid.length ? ` — "${badGrid[0].t}" painted ${badGrid[0].ff.split(',')[0]}` : ''));
            await page.close();
        }
    }

    // ================= §2 THE MAP FOLLOWS THE THEME =================
    console.log('\n== §2 The basemap, the zoom control and the attribution follow the theme ==');
    {
        // Measured off the real tiles by hand (the modal colour of a 512×512
        // Blakeney tile at z15): light_all #f6f6f5 at 49% of the tile, dark_all
        // #060606 at 49%. The control is painted over THAT, not over the token.
        const TILE_GROUND = { dark: '#060606', light: '#f6f6f5' };
        for (const theme of ['dark', 'light']) {
            const page = await openPage(browser, { width: 1280, theme });
            await page.waitForTimeout(600);
            await page.evaluate(() => openProperty('21a'));
            await page.waitForTimeout(900);

            const urls = await page.evaluate(() => window.__tileUrls.slice());
            const wantSlug = theme === 'dark' ? 'dark_all' : 'light_all';
            const otherSlug = theme === 'dark' ? 'light_all' : 'dark_all';
            ok(urls.length > 0, `[${theme}] a tile layer was built (${urls.length})`);
            ok(urls.every((u) => u.includes(wantSlug)), `[${theme}] the basemap is ${wantSlug}` + (urls.length && !urls[0].includes(wantSlug) ? ` — got ${(urls[0].match(/cartocdn\.com\/([a-z_]+)/) || [, '?'])[1]}` : ''));
            ok(!urls.some((u) => u.includes(otherSlug)), `[${theme}] and never ${otherSlug}`);

            // Paint the map's own ground the colour the real tiles are, then
            // SAMPLE the control back out of a screenshot: the fill is alpha
            // over that ground and cannot be read off a declaration.
            await page.evaluate((g) => { document.getElementById('prop-map').style.background = g; }, TILE_GROUND[theme]);
            await bringIntoView(page, '#prop-map', 100);
            await page.waitForTimeout(250);
            const boxes = await page.evaluate(() => {
                const zin = document.querySelector('.leaflet-control-zoom-in');
                const attr = document.querySelector('.leaflet-control-attribution');
                const map = document.getElementById('prop-map');
                const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
                return { zin: zin && r(zin), attr: attr && r(attr), map: map && r(map),
                    ink: zin && getComputedStyle(zin).color, sub: attr && getComputedStyle(attr).color };
            });
            ok(!!boxes.zin && !!boxes.attr, `[${theme}] the zoom control and the attribution strip are on the map`);
            const png = decodePng(await page.screenshot());
            const at = (x, y) => png.px(Math.round(x), Math.round(y));
            // Inside the button, clear of the glyph: a sixth in from its edge.
            const fill = at(boxes.zin.x + boxes.zin.w * 0.16, boxes.zin.y + boxes.zin.h * 0.5);
            const mapGround = at(boxes.map.x + boxes.map.w * 0.5, Math.min(boxes.map.y + boxes.map.h * 0.5, png.h - 4));
            const attrFill = at(boxes.attr.x + boxes.attr.w * 0.5, boxes.attr.y + 3);
            ok(!!fill && !!mapGround && !!attrFill, `[${theme}] every sample landed inside the frame (guard: a null sample proves nothing)`);
            if (!fill || !mapGround || !attrFill) { await page.close(); continue; }

            // The inks are declared OPAQUE on purpose (assert it, then the
            // arithmetic below is exact rather than a guess about alpha).
            ok(isOpaque(boxes.ink), `[${theme}] --map-ink is an opaque colour, so ink-on-ground is exact`);
            const inkC = over(boxes.ink, fill);
            const rInk = ratio(inkC, fill);
            ok(rInk >= 4.5, `[${theme}] the zoom glyph reads ${rInk.toFixed(2)}:1 on its own ground (AA 4.5)`);
            // THE CONTROL FOLLOWED THE MAP, not the other way round. A fill vs
            // map-ground ratio is the wrong claim here and always was: a white
            // control on a white basemap is 1.08:1 by construction, and its
            // distinctness comes from its ring and shadow, not its fill. What
            // must hold is that the two are the SAME SIDE of the theme — a pale
            // control left on a dark map is the light island this PR moved.
            const fillY = lum(fill), groundY = lum(mapGround);
            ok(theme === 'dark' ? fillY < 0.15 : fillY > 0.4,
                `[${theme}] the zoom control's own fill is ${theme} (luminance ${fillY.toFixed(3)})`);
            ok(theme === 'dark' ? groundY < 0.15 : groundY > 0.4,
                `[${theme}] …on a ${theme} map ground (luminance ${groundY.toFixed(3)}) — guard: both sampled`);
            const subC = over(boxes.sub, attrFill);
            const rSub = ratio(subC, attrFill);
            ok(rSub >= 4.5, `[${theme}] the attribution reads ${rSub.toFixed(2)}:1 on its strip`);
            await page.close();
        }

        // THE LIVE SWAP. Both maps outlive a theme toggle, so a layer that only
        // learns the theme at mount would sit as a white sheet under dark
        // controls (or the reverse) for as long as the page is open.
        const page = await openPage(browser, { width: 1280, theme: 'dark' });
        await page.waitForTimeout(600);
        await page.evaluate(() => openProperty('21a'));
        await page.waitForTimeout(900);
        const before = await page.evaluate(() => window.__lastLayer && window.__lastLayer.url);
        await page.evaluate(() => toggleTheme());
        await page.waitForTimeout(300);
        const after = await page.evaluate(() => window.__lastLayer && window.__lastLayer.url);
        ok(/dark_all/.test(String(before)), 'the mounted layer started on the dark basemap');
        ok(/light_all/.test(String(after)), 'toggleTheme swapped the MOUNTED layer to the light basemap (setUrl, not the next mount)');
        await page.evaluate(() => toggleTheme());
        await page.waitForTimeout(300);
        const back = await page.evaluate(() => window.__lastLayer && window.__lastLayer.url);
        ok(/dark_all/.test(String(back)), 'and back again');
        await page.close();
    }

    // ================= §3 THE LIGHTBOX =================
    console.log('\n== §3 The lightbox controls read over a bright photo, meet 44px, and clear it at 390 ==');
    for (const width of [390, 1280]) {
        for (const theme of ['dark', 'light']) {
            const page = await openPage(browser, { width, theme });
            await page.waitForTimeout(600);
            await page.evaluate(() => openProperty('21a'));
            await page.waitForTimeout(700);
            await page.evaluate((src) => {
                window.__galleryImages = [src, src, src];
                openLightbox(0);
            }, BRIGHT);
            await page.waitForTimeout(700);
            const geo = await page.evaluate(() => {
                const lb = document.getElementById('lightbox');
                const g = (s) => {
                    const e = lb.querySelector(s); if (!e) return null;
                    const b = e.getBoundingClientRect(); const c = getComputedStyle(e);
                    return { sel: s, x: b.left, y: b.top, w: b.width, h: b.height, color: c.color };
                };
                const img = document.getElementById('lightbox-img').getBoundingClientRect();
                return { open: lb.classList.contains('open'), img: { x: img.left, y: img.top, w: img.width, h: img.height },
                    nodes: ['.lightbox-nav.prev', '.lightbox-nav.next', '.lightbox-close', '.lightbox-counter'].map(g) };
            });
            ok(geo.open, `@${width} [${theme}] the lightbox opened over a bright photo`);
            ok(geo.img.w > 100, `@${width} [${theme}] the photo is on screen (${Math.round(geo.img.w)}×${Math.round(geo.img.h)})`);
            const png = decodePng(await page.screenshot());
            const at = (x, y) => png.px(Math.round(x), Math.round(y));
            for (const n of geo.nodes) {
                if (!n) { ok(false, `@${width} [${theme}] a lightbox control is missing`); continue; }
                const isCounter = /counter/.test(n.sel);
                // The counter is BARE TEXT: its ground is what lies UNDER the
                // box, and a pixel inside lands on a glyph (measured — the first
                // run read a half-covered pixel back as 2.2:1). The two discs
                // and the close have a fill of their own, sampled a sixth in.
                const inside = isCounter
                    ? at(n.x + n.w * 0.5, n.y + n.h + 4)
                    : at(n.x + n.w * 0.16, n.y + n.h * 0.5);
                if (!inside) { ok(false, `@${width} [${theme}] ${n.sel}'s sample landed outside the frame`); continue; }
                // `inside` is the disc as PAINTED — the fill composited over
                // whatever is behind it, so where the disc lands on the pale
                // photo this reads the ink against the photo, correctly.
                // Deliberately NOT a disc-vs-surround boundary check: over the
                // scrim a dark disc on a dark scrim is 1.03:1 and rightly so —
                // the glyph is the affordance, and the first draft of this
                // section failed six times on exactly that non-defect.
                const ink = over(n.color, inside);
                const r = ratio(ink, inside);
                const bar = isCounter ? 4.5 : 3;
                ok(r >= bar, `@${width} [${theme}] ${n.sel} ink reads ${r.toFixed(2)}:1 on the ground it is painted on (needs ${bar})`);
                if (!isCounter) ok(n.w >= 44 && n.h >= 44, `@${width} [${theme}] ${n.sel} is ${Math.round(n.w)}×${Math.round(n.h)} (44 floor)`);
            }
            // VACUITY GUARD. Every number above is only interesting because a
            // control really does land on the pale picture: at 1280 the next
            // arrow overlaps it. Without this the whole section could pass on
            // discs that all happen to sit on the scrim.
            if (width === 1280) {
                const nx = geo.nodes[1]; // .lightbox-nav.next, which overlaps the photo at this width
                const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
                const shot = at(geo.img.x + geo.img.w * 0.5, geo.img.y + geo.img.h * 0.5);
                ok(hits(nx, geo.img), `@${width} [${theme}] a control really lands ON the photo (guard)`);
                ok(!!shot && lum(shot) > 0.5, `@${width} [${theme}] …and the photo really is pale (guard: luminance ${shot ? lum(shot).toFixed(2) : '?'})`);
            }
            if (width === 390) {
                const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
                for (const n of geo.nodes.slice(0, 2)) {
                    const over_ = hits(n, geo.img);
                    ok(!over_, `@390 [${theme}] ${n.sel} does not sit on the photo` + (over_ ? ` — ${Math.round(Math.min(n.x + n.w, geo.img.x + geo.img.w) - Math.max(n.x, geo.img.x))}px of overlap` : ''));
                }
            }
            await page.close();
        }
    }

    // ================= §4 THE LEGEND =================
    console.log('\n== §4 The legend swatches ARE the cells the grid paints ==');
    for (const theme of ['dark', 'light']) {
        const page = await openPage(browser, { width: 390, theme });
        await page.waitForTimeout(600);
        await page.evaluate(() => openProperty('21a'));
        await page.waitForTimeout(700);
        // Next month, where the fixture's booked stretch is.
        await page.evaluate(() => availCalMove(1));
        await page.waitForTimeout(500);
        const r = await page.evaluate(() => {
            const w = document.getElementById('prop-avail-cal');
            const pick = (s) => { const e = w.querySelector(s); if (!e) return null; const c = getComputedStyle(e);
                return { bg: c.backgroundColor, sh: c.boxShadow, td: c.textDecorationLine, w: Math.round(e.getBoundingClientRect().width) }; };
            return { keyFree: pick('.avail-key-free'), keyTaken: pick('.avail-key-taken'),
                cellFree: pick('.avail-cell.free:not(.past)'), cellTaken: pick('.avail-cell.taken:not(.past)'),
                greenDots: w.querySelectorAll('.avail-dot').length,
                text: w.textContent.replace(/\s+/g, ' ') };
        });
        ok(!!r.cellFree && !!r.cellTaken, `[${theme}] the fixture really paints a free AND a booked cell (guard)`);
        ok(!!r.keyFree && !!r.keyTaken, `[${theme}] the legend carries two swatches`);
        ok(r.greenDots === 0, `[${theme}] the green/grey .avail-dot is gone`);
        if (r.keyFree && r.cellFree) {
            ok(r.keyFree.bg === r.cellFree.bg, `[${theme}] the Available key has the free cell's background (${r.keyFree.bg})`);
            ok(r.keyFree.sh.replace(/[\d.]+px/g, 'N') === r.cellFree.sh.replace(/[\d.]+px/g, 'N'), `[${theme}] …and its hairline`);
        }
        if (r.keyTaken && r.cellTaken) {
            ok(r.keyTaken.bg === r.cellTaken.bg, `[${theme}] the Booked key has the taken cell's fill (${r.keyTaken.bg})`);
            ok(r.keyTaken.td === r.cellTaken.td && /line-through/.test(r.keyTaken.td), `[${theme}] …and its strikethrough`);
        }
        // The price sits on the free cells, so the key explains the £ once.
        ok(/Available . price per night/.test(r.text), `[${theme}] the free key names the price that sits on those cells`);
        await page.close();
    }

    // ================= §5 THE Q&A HAS A DOOR =================
    console.log('\n== §5 The cottage page can open its own Q&A ==');
    for (const width of [390, 1280]) {
        const page = await openPage(browser, { width, theme: 'dark' });
        await page.waitForTimeout(600);
        await page.evaluate(() => openProperty('21a'));
        await page.waitForTimeout(700);
        const n = await page.evaluate(() => document.querySelectorAll('#view-21a [data-act="openFaqModal"]').length);
        ok(n >= 1, `@${width} the cottage page exposes a control whose data-act is openFaqModal (${n})`);
        if (n) {
            await page.click('#view-21a [data-act="openFaqModal"]');
            await page.waitForTimeout(500);
            const shown = await page.evaluate(() => {
                const m = document.getElementById('faq-modal');
                return { open: !!m && m.classList.contains('open'), text: (document.getElementById('faq-modal-list') || {}).textContent || '' };
            });
            ok(shown.open, `@${width} tapping it opens the FAQ modal`);
            ok(/parking/i.test(shown.text), `@${width} …carrying this cottage's own answers`);
        }
        // A cottage with NO answers must open nothing rather than an empty sheet.
        const empty = await page.evaluate(() => {
            delete siteContent['faqs-21a'];
            openProperty('21a');
            const d = document.getElementById('prop-faq-door');
            return { html: d ? d.innerHTML.trim() : null, painted: d ? d.getClientRects().length : -1 };
        });
        ok(empty.html === '', `@${width} a cottage with no answers renders no door`);
        ok(empty.painted === 0, `@${width} …and the row paints nothing at all`);
        await page.close();
    }

    // ================= §6 THE RAG =================
    console.log('\n== §6 No line ends on a separator and no line holds one orphan word ==');
    {
        // The line-by-line read: Range each character and group by its top.
        const lineSplit = (sel) => `(() => {
            const el = document.querySelector(${JSON.stringify(sel)});
            if (!el) return null;
            const tn = el.firstChild; if (!tn || tn.nodeType !== 3) return null;
            const s = tn.textContent, r = document.createRange();
            const out = []; let cur = '', prev = null;
            for (let i = 0; i < s.length; i++) {
                r.setStart(tn, i); r.setEnd(tn, i + 1);
                const t = Math.round(r.getBoundingClientRect().top);
                if (prev !== null && t !== prev) { out.push(cur); cur = ''; }
                cur += s[i]; prev = t;
            }
            out.push(cur);
            return out.map((l) => l.trim()).filter(Boolean);
        })()`;
        for (const theme of ['dark', 'light']) {
            const page = await openPage(browser, { width: 390, theme });
            await page.waitForTimeout(600);
            await page.evaluate(() => openProperty('21a'));
            await page.waitForTimeout(700);
            for (const [name, sel] of [['the facts line', '#prop-subtitle'], ['the waitlist link', '[data-act="openWaitlistHere"]']]) {
                const lines = await page.evaluate(lineSplit(sel));
                ok(Array.isArray(lines) && lines.length >= 1, `[${theme}] read ${name} (${lines ? lines.length : 0} line(s))`);
                if (!lines) continue;
                const hanging = lines.slice(0, -1).filter((l) => /[·•–—-]$/.test(l));
                ok(!hanging.length, `[${theme}] ${name} never ends a wrapped line on a separator` + (hanging.length ? ` — "${hanging[0]}"` : ''));
                const orphan = lines.length > 1 && lines[lines.length - 1].split(/\s+/).length === 1;
                ok(!orphan, `[${theme}] ${name} leaves no single orphan word` + (orphan ? ` — "${lines[lines.length - 1]}"` : ''));
            }
            // The owner's own override goes through the same binding, or the fix
            // reaches only the string nobody has edited.
            const overrideLines = await page.evaluate((split) => {
                siteContent['21a-subtitle'] = 'Townhouse in Blakeney · Sleeps 6 · 3 bedrooms · 2 bathrooms · 1 garden';
                applyContentOverrides(document);
                return eval(split);
            }, lineSplit('#prop-subtitle'));
            const hangingO = (overrideLines || []).slice(0, -1).filter((l) => /[·•]$/.test(l));
            ok(overrideLines && overrideLines.length > 1, `[${theme}] the owner-typed override wraps (guard: a one-line read proves nothing)`);
            ok(!hangingO.length, `[${theme}] the owner-typed <prop>-subtitle gets the same binding` + (hangingO.length ? ` — "${hangingO[0]}"` : ''));
            await page.close();
        }
    }

    // ================= §7 A SCOPED LIST DOES NOT NAME THE COTTAGE =================
    console.log('\n== §7 A per-cottage review list names the guest, not the cottage ==');
    {
        const page = await openPage(browser, { width: 390, theme: 'dark' });
        await page.waitForTimeout(600);
        await page.evaluate(() => {
            publicGuestReviews = [
                { id: 'r1', prop: '21a', name: 'Tom & Priya', stars: 5, text: 'A lovely stay.', created_at: '2026-05-01' },
                { id: 'r2', prop: '21a', name: 'Rachel M.', stars: 5, text: 'Spotless.', source: 'Airbnb', created_at: '2026-05-02' },
                { id: 'r3', prop: 'jollyboat', name: 'Dan', stars: 5, text: 'Perfect for two.', created_at: '2026-05-03' },
            ];
        });
        await page.evaluate(() => openProperty('21a'));
        await page.waitForTimeout(700);
        const name = await page.evaluate(() => (propertyMeta['21a'] || {}).name || '');
        ok(!!name, `the cottage has a name to look for ("${name}")`);
        const onPage = await page.evaluate(() => [...document.querySelectorAll('#prop-reviews .review-who')].map((e) => e.textContent.trim()));
        ok(onPage.length >= 2, `the cottage page renders its own review cards (${onPage.length})`);
        ok(!onPage.some((t) => t.includes(name)), `…and none of them names the cottage the whole list is about` + (onPage.some((t) => t.includes(name)) ? ` — "${onPage.find((t) => t.includes(name))}"` : ''));
        ok(onPage.some((t) => /Airbnb/.test(t)), '…while the source tag, the fact that DOES vary, is still there');

        // Scoped by the caller, so the modal opened from THIS page is scoped too.
        const scoped = await page.evaluate(() => { openAllReviews('21a'); return [...document.querySelectorAll('#reviews-modal-list .review-who')].map((e) => e.textContent.trim()); });
        ok(scoped.length >= 2 && !scoped.some((t) => t.includes(name)), `the modal opened for one cottage is scoped too (${scoped.length} cards)`);
        // …and the footer's "Guest reviews" link, which passes NO key, is not:
        // there the cottage name is the informative half.
        const all = await page.evaluate(() => { closeAllReviews(); openAllReviews(); return [...document.querySelectorAll('#reviews-modal-list .review-who')].map((e) => e.textContent.trim()); });
        ok(all.length > scoped.length, `the unscoped list is the whole fleet (${all.length} cards)`);
        ok(all.some((t) => t.includes(name)), '…and there the cottage IS named, because it varies between cards');
        await page.close();
    }

    console.log(fails ? `\n  ${fails} CHECK(S) FAILED ❌\n` : `\n  ALL CHECKS PASSED ✅\n`);
    await done(fails);
})();
