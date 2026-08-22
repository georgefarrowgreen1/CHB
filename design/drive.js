// Drive the prototype — every interaction, every width, both themes — and
// report what is broken. The companion to shot.js: that one lets a frame be
// LOOKED at, this one proves the working page actually works.
//
//   node drive.js            # the whole pass
//   node drive.js --shots    # …and write screenshots to $OUT
//
// It exists because four real defects came out of driving this page, and every
// one of them was invisible in a screenshot:
//   · scroll-to-condense could never fire on a phone — the spine's own height
//     left only 17px of overflow against a 24px threshold;
//   · on desktop the same trick oscillated, because condensing freed more room
//     than there was overflow, so scrollTop snapped to 0 and it expanded again;
//   · three areas were unreachable at phone width — hidden by the dock with
//     nothing to reach them by;
//   · the calendar clipped guests' names at 390px.
// A check that only asserts "the element exists" would have passed all four.
const path = require('path');
const fs = require('fs');
const HERE = __dirname;
const PW = path.join(HERE, '..', 'Cottage Holidays Blakeney', 'node_modules', 'playwright');
let chromium;
try {
    ({ chromium } = require(PW));
} catch (e) {
    console.error(`playwright is not installed at ${PW} — run:\n  cd "Cottage Holidays Blakeney" && npm init -y && npm install playwright`);
    process.exit(1);
}

const URL = 'file://' + path.join(HERE, 'back-office-prototype.html');
const OUT = process.env.OUT || '/home/user/gout';
const SHOTS = process.argv.includes('--shots');
let fails = 0;
const ok = (cond, label, detail) => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${detail !== undefined && !cond ? ' — ' + detail : ''}`);
    if (!cond) fails++;
};

(async () => {
    if (SHOTS) fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch(
        process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {},
    );
    const errs = [];
    const open = async (w, h, scheme) => {
        const p = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme || 'light' });
        p.on('pageerror', (e) => errs.push(`${w}x${h}: ${e.message}`));
        await p.goto(URL, { waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(500);
        return p;
    };
    const shot = (p, name) => (SHOTS ? p.screenshot({ path: path.join(OUT, `proto-${name}.png`) }) : Promise.resolve());

    console.log('\n1. the record pane serves every list');
    let p = await open(1440, 900);
    await p.click('[data-rec="b2"]');
    await p.waitForTimeout(250);
    ok(await p.evaluate(() => !document.getElementById('pane').hidden
        && /Sarah Pemberton/.test(document.getElementById('pane').innerText)),
        'a booking row opens the pane');
    await shot(p, 'record');
    await p.click('[data-go="inbox"]');
    await p.waitForTimeout(200);
    await p.click('[data-rec="e1"]');
    await p.waitForTimeout(250);
    ok(await p.evaluate(() => /Priya Shah/.test(document.getElementById('pane').innerText)
        && /parking/.test(document.getElementById('pane').innerText)),
        'the SAME pane holds an enquiry — the claim the split is making');

    console.log('\n2. the day spine routes and answers');
    await p.click('[data-duty="0"]');
    await p.waitForTimeout(250);
    ok(await p.evaluate(() => /Laura/.test(document.getElementById('pane').innerText)),
        'a duty chip opens the record that clears it');
    await p.keyboard.press('Meta+k');
    await p.waitForTimeout(250);
    await p.fill('#askinput', 'owes');
    await p.waitForTimeout(200);
    ok(await p.evaluate(() => /1,190/.test(document.getElementById('asklist').innerText)),
        'the ask filters as you type');
    await p.click('.askrow');
    await p.waitForTimeout(250);
    ok(await p.evaluate(() => document.querySelector('[data-go="money"]').getAttribute('aria-current') === 'page'),
        'an answer takes you to the area that holds it');
    await p.close();

    console.log('\n3. the spine condenses without fighting the scroller');
    // Short viewport so Today genuinely overflows. The spine is sticky INSIDE
    // the scroller: if it ever goes back to sitting above it, condensing frees
    // more room than there is overflow and the page oscillates.
    // 460 tall, so Today has enough overflow to reach the condense threshold
    // AND hold it afterwards — the case the hysteresis exists for.
    p = await open(1440, 460);
    await p.evaluate(() => { document.getElementById('main').scrollTop = 400; });
    await p.waitForTimeout(300);
    const desk = await p.evaluate(() => {
        const m = document.getElementById('main'), s = document.getElementById('spine');
        return { top: m.scrollTop, cond: s.classList.contains('cond'), h: Math.round(s.getBoundingClientRect().height) };
    });
    ok(desk.cond && desk.top > 40, `desktop condenses on scroll (${desk.h}px at scrollTop ${desk.top})`, JSON.stringify(desk));
    await shot(p, 'condensed');
    await p.close();
    // A page with less overflow than the spine gives back must stay full
    // rather than flap between the two states.
    p = await open(1440, 620);
    await p.evaluate(() => { document.getElementById('main').scrollTop = 999; });
    await p.waitForTimeout(300);
    const short = await p.evaluate(() => {
        const m = document.getElementById('main'), s = document.getElementById('spine');
        return { over: m.scrollHeight - m.clientHeight, cond: s.classList.contains('cond') };
    });
    ok(!short.cond, `a page with only ${short.over}px of overflow keeps the full spine — no flapping`, JSON.stringify(short));
    await p.close();

    console.log('\n4. the phone');
    p = await open(390, 844, 'dark');
    const full = await p.evaluate(() => Math.round(document.getElementById('spine').getBoundingClientRect().height));
    ok(await p.evaluate(() => !document.getElementById('spine').classList.contains('cond')),
        `Today keeps the whole spine (${full}px) — the day IS the content there`);
    ok(await p.evaluate(() => [...document.querySelectorAll('#duties .duty')].filter((b) => b.getClientRects().length).length === 2
        && document.querySelector('.dutymore').getClientRects().length > 0),
        'two duties fit; the rest become one "more" chip');
    await p.click('[data-go="money"]');
    await p.waitForTimeout(300);
    const cond = await p.evaluate(() => ({
        cond: document.getElementById('spine').classList.contains('cond'),
        h: Math.round(document.getElementById('spine').getBoundingClientRect().height),
    }));
    ok(cond.cond && cond.h < full / 2, `off Today it opens condensed (${cond.h}px) — by VIEW, not by scroll`, JSON.stringify(cond));
    ok(await p.evaluate(() => [...document.querySelectorAll('.bar')].every((b) => b.scrollWidth <= b.clientWidth + 1)),
        'no calendar bar clips its guest');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'and the page body never scrolls sideways');
    await p.click('[data-go="more"]');
    await p.waitForTimeout(250);
    const more = await p.evaluate(() => [...document.querySelectorAll('#col .row .lbl')].map((e) => e.textContent.trim()));
    ok(more.join() === 'Cottages,Key safes,Settings',
        'every area the dock cannot hold is reachable from More', more.join());
    await shot(p, 'phone');
    await p.close();

    console.log('\n5. nothing is a dead end');
    p = await open(1440, 900);
    for (const a of ['today', 'inbox', 'money', 'cottages', 'keysafes', 'settings', 'assistant']) {
        await p.click(`.rail [data-go="${a}"]`);
        await p.waitForTimeout(140);
        const n = await p.evaluate(() => document.getElementById('col').innerText.trim().length);
        ok(n > 40, `${a} renders content`, `${n} chars`);
    }
    await p.close();

    console.log(errs.length ? `\nPAGE ERRORS:\n  ${errs.join('\n  ')}` : '\nno page errors');
    if (errs.length) fails += errs.length;
    await browser.close();
    console.log(fails ? `\n${fails} CHECK(S) FAILED\n` : '\nprototype drives clean\n');
    process.exit(fails ? 1 : 0);
})();
