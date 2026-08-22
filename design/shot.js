// Render an artboard on its own and screenshot it, so a frame can be LOOKED AT
// before it is published. The canvas editor is only rendered once it is live, so
// without this the first look at a mockup is the owner's.
//
//   node shot.js WebWide WebLaptop            # named artboards
//   node shot.js                              # all of them
//   OUT=/tmp/shots node shot.js Main          # somewhere else
//
// It strips the .dc.html wrapper (the <x-dc>/<helmet> tags and the support.js
// line the editor swaps for its runtime) and renders what is left as a plain
// page — which is what an artboard IS, minus the holes. Static artboards only:
// anything driven by a data-props tweak renders at its default.
//
// Playwright resolves from the website's node_modules (ci.yml installs it there
// per run; it is not committed), and CHB_CHROMIUM overrides the browser when the
// preinstalled one does not match — the same two rules the ui-test suites follow.
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const PW = path.join(HERE, '..', 'Cottage Holidays Blakeney', 'node_modules', 'playwright');
let chromium;
try {
    ({ chromium } = require(PW));
} catch (e) {
    console.error(`playwright is not installed at ${PW} — run:\n  cd "Cottage Holidays Blakeney" && npm init -y && npm install playwright`);
    process.exit(1);
}

// Frame widths per artboard, matching canvas.json. An artboard narrower than
// its content clips, and clipping is the one failure that matters here.
const W = {
    Main: 1440, Record: 1440, Inbox: 1440, Money: 1440, Cottages: 1440,
    Phone: 390, WebWide: 1500, WebLaptop: 1240, WebNarrow: 1020,
    DirectionB: 860, DirectionC: 860,
};
const OUT = process.env.OUT || '/home/user/gout';
const names = process.argv.slice(2).length
    ? process.argv.slice(2).map((n) => n.replace(/\.dc\.html$/, ''))
    : Object.keys(W);

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch(
        process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {},
    );
    const errs = [];
    for (const name of names) {
        const file = path.join(HERE, `${name}.dc.html`);
        if (!fs.existsSync(file)) { console.error(`no ${name}.dc.html`); continue; }
        const page = await browser.newPage({ viewport: { width: W[name] || 1440, height: 400 } });
        page.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
        const src = fs.readFileSync(file, 'utf8')
            .replace('<script src="./support.js"></script>', '')
            .replace(/<\/?x-dc>/g, '')
            .replace('<helmet>', '')
            .replace('</helmet>', '');
        await page.setContent(src, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500); // the webfont, or the first paint is the fallback
        const box = await page.evaluate(() => {
            const r = document.querySelector('body > div').getBoundingClientRect();
            return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
        });
        await (await page.$('body > div')).screenshot({ path: path.join(OUT, `${name}.png`) });
        console.log(`${name}  ${box.w}×${box.h}`);
        await page.close();
    }
    console.log(errs.length ? `PAGE ERRORS:\n  ${errs.join('\n  ')}` : 'no page errors');
    await browser.close();
})();
