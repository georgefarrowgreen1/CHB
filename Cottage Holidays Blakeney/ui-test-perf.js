// ============================================================
//  ui-test-perf.js — real visitors' speed, from the page's side (app.js chbPerf) and on
//  the owner's Status page (admin.js spPerfHtml).
//
//  The page: it sends one beacon to perf.php when it is first put away, with the load
//  figures its own browser measured and nothing that says who it is; each later visible
//  stretch sends only its taps and layout, and a stretch with neither sends nothing; a
//  figure from after the page was first hidden is left out; a preview frame sends
//  nothing. Status: each group says how it did in a capsule, opens to its figures, and
//  draws the daily trace; a figure below the minimum is shown but not judged.
//  perf-lib.php's arithmetic is test-perf.php's; the endpoint is test-integration §103.
// ============================================================
const { bootBrowser, d } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };

const props = [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 135, sort_order: 1, extra_adult_rate: 0, child_rate: 0, transaction_pct: 3, booking_fee: 0, max_adults: 2, max_children: 0, max_total: 2 }];

async function visitor(browser, base, path) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    const beacons = [];
    await page.route(/\.php/, (route) => {
        const req = route.request();
        const url = req.url();
        const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
        if (url.includes('perf.php')) {
            let b = null;
            try { b = JSON.parse(req.postData() || 'null'); } catch (e) {}
            beacons.push({ method: req.method(), type: (req.headers()['content-type'] || ''), body: b });
            return json({ ok: true });
        }
        if (url.includes('bootstrap.php')) return json({ ok: false });
        if (url.includes('rates.php')) return json({ properties: props, seasons: {}, occupancy: {} });
        if (url.includes('content.php')) return json({ content: {} });
        if (url.includes('availability.php')) return json({ ok: true, ranges: [], props: {} });
        return json({ ok: true, bookings: [], enquiries: [], reviews: [], photos: [], props: {}, events: [] });
    });
    await page.goto(base + path, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.classList.contains('hero-go'), null, { timeout: 20000 });
    // A control that answers slowly, so a tap has a figure Event Timing reports (>=16ms).
    await page.evaluate(() => {
        const b = document.createElement('button');
        b.id = 'perf-slow';
        b.textContent = 'slow';
        b.style.cssText = 'position:fixed;left:8px;bottom:120px;z-index:99999;width:120px;height:48px';
        b.addEventListener('click', () => { const t = performance.now(); while (performance.now() - t < 90) {} });
        document.body.appendChild(b);
    });
    return { page, beacons };
}
const hide = (page) => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
});
const show = (page) => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
});
const settle = (beacons, n) => new Promise((res) => {
    const t0 = Date.now();
    const tick = () => (beacons.length >= n || Date.now() - t0 > 3000 ? res(undefined) : setTimeout(tick, 50));
    tick();
});

const PERF = {
    groups: {
        sp: { label: 'Phones', views: 318, tone: 'fast', figs: {
            shown: { n: 318, p50: 900, p75: 1300, p90: 2100, good: 280, poor: 4, rate: 'good' },
            lcp: { n: 300, p50: 1400, p75: 2100, p90: 3000, good: 250, poor: 10, rate: 'good' },
            ready: { n: 318, p50: 1900, p75: 2600, p90: 3900, good: 260, poor: 9, rate: 'good' },
            inp: { n: 120, p50: 60, p75: 96, p90: 180, good: 118, poor: 0, rate: 'good' },
            cls: { n: 318, p50: 10, p75: 40, p90: 90, good: 300, poor: 2, rate: 'good' },
        } },
        sc: { label: 'Computers and tablets', views: 6, tone: 'few', figs: { shown: { n: 6, p50: 700, p75: 800, p90: 900, good: 6, poor: 0, rate: null } } },
        bo: { label: 'Your back office', views: 41, tone: 'slow', figs: {
            ready: { n: 41, p50: 2500, p75: 3100, p90: 4200, good: 35, poor: 1, rate: 'good' },
            inp: { n: 60, p50: 300, p75: 640, p90: 1200, good: 20, poor: 22, rate: 'poor' },
        } },
    },
    judged: true, poor: [['bo', 'inp', 640]], sentence: 'In your back office, a tap was answered in 640ms or longer for 1 in 4 visits this week.',
    trace: { sp: { shown: { [d(-1)]: [1300, 40], [d(-2)]: [3400, 38], [d(-14)]: [1200, 30] } }, bo: { inp: { [d(-1)]: [640, 9] } } },
    traceDays: 14, minN: 20, lines: { shown: [1800, 3000], lcp: [2500, 4000], ready: [3800, 7300], inp: [200, 500], cls: [100, 250], ttfb: [800, 1800], fcp: [1800, 3000] },
};

async function status(browser, base, perf) {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (url.includes('diagnostics.php')) {
            const checks = [{ category: 'Core', label: 'Database', status: 'ok', detail: 'Connected.' }];
            if (perf && perf.judged) checks.push({ category: 'Website', label: 'Real visitors', status: perf.poor.length ? 'warn' : 'ok', detail: perf.sentence });
            return json({ ok: true, summary: {}, checks, mail_ready: true, insights: perf ? { perf } : {} });
        }
        if (url.includes('perf.php')) return json({ ok: true });
        if (route.request().method() === 'POST') {
            let b = {};
            try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
            if (b.action === 'admin_status') return json({ ok: true, admin: true });
            return json({ ok: true, events: [], logs: {}, content: {} });
        }
        return json({ ok: true, bookings: [], enquiries: [], blocks: [], content: {}, properties: [], seasons: {}, occupancy: {}, payments: [], years: [] });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(400);
    await page.evaluate(async () => { await openArea(); settingsOpen('diagnostics'); });
    await page.waitForFunction(() => { const h = document.getElementById('sp-hero'); return h && !h.classList.contains('is-revealing') && !h.classList.contains('is-checking'); }, null, { timeout: 8000 });
    return page;
}

(async () => {
    const t = await bootBrowser();
    try {
        console.log('§1 a visitor\'s page sends its figures once, when it is first put away');
        let { page, beacons } = await visitor(t.browser, t.base, '/');
        await page.click('#perf-slow');
        await page.waitForTimeout(250);
        ok(beacons.length === 0, `nothing is sent while the page is in use (${beacons.length})`);
        await hide(page);
        await settle(beacons, 1);
        const b1 = (beacons[0] || {}).body || {};
        ok(beacons.length === 1 && beacons[0].method === 'POST' && /application\/json/.test(beacons[0].type), `one beacon, a JSON POST (${beacons.length})`);
        const num = (k) => Number.isInteger(b1[k]) && b1[k] >= 0;
        ok(num('ttfb') && num('fcp') && num('shown') && num('ready'), `it carries when the server answered, the first paint, when the page appeared and when it was ready (${JSON.stringify(b1)})`);
        ok(b1.shown >= b1.ready, `on a page the script reveals, it "appears" when the cover lifts, after it is ready (${b1.ready} → ${b1.shown})`);
        ok(Number.isInteger(b1.inp) && b1.inp >= 80, `the slow tap is its tap figure (${b1.inp}ms)`);
        ok(Number.isInteger(b1.cls) && b1.cls >= 0, `the layout shift is sent x1000 (${b1.cls})`);
        ok(b1.land === 'h' && b1.early === false && b1.pwa === false, `where it landed and how: home, not written early, not installed (${b1.land}, ${b1.early}, ${b1.pwa})`);
        const keys = Object.keys(b1).sort().join(',');
        ok(keys === 'cls,early,fcp,inp,land,lcp,pwa,ready,shown,ttfb' || keys === 'cls,early,fcp,inp,land,pwa,ready,shown,ttfb', `nothing that says who it is: no kind, address or page (${keys})`);

        console.log('§2 a later stretch sends only its taps and layout; a quiet one sends nothing');
        await show(page);
        await page.click('#perf-slow');
        await page.waitForTimeout(200);
        await hide(page);
        await settle(beacons, 2);
        const b2 = (beacons[1] || {}).body || {};
        ok(beacons.length === 2 && Number.isInteger(b2.inp) && b2.inp >= 80, `the second stretch's tap is sent (${JSON.stringify(b2)})`);
        ok(!('ttfb' in b2) && !('shown' in b2) && !('ready' in b2) && !('land' in b2), 'its load figures are not sent twice');
        await show(page);
        await page.waitForTimeout(200);
        await hide(page);
        await page.waitForTimeout(600);
        ok(beacons.length === 2, `a stretch with no tap and no shift sends nothing (${beacons.length})`);
        await page.close();

        console.log('§3 a figure from after the page was first hidden is left out');
        ({ page, beacons } = await visitor(t.browser, t.base, '/'));
        await page.evaluate(() => { __perf.hid = 0; });
        await hide(page);
        await settle(beacons, 1);
        const b3 = (beacons[0] || {}).body || {};
        ok(beacons.length === 1 && Number.isInteger(b3.ttfb) && !('fcp' in b3) && !('shown' in b3) && !('ready' in b3) && !('lcp' in b3),
            `a page hidden from the start sends the server's answer and no paint or ready figure (${JSON.stringify(b3)})`);
        await page.close();

        console.log('§4 a preview frame sends nothing');
        ({ page, beacons } = await visitor(t.browser, t.base, '/?preview=1'));
        await page.click('#perf-slow');
        await hide(page);
        await page.waitForTimeout(600);
        ok(beacons.length === 0, `no beacon from a preview (${beacons.length})`);
        await page.close();

        console.log('§5 Status: each group says how it did, and opens to its figures');
        let sp = await status(t.browser, t.base, PERF);
        const s5 = await sp.evaluate(() => {
            const sec = document.getElementById('sp-perf');
            const rows = sec ? [...sec.querySelectorAll('.sp-sys')] : [];
            return {
                cap: sec ? sec.querySelector('.sp-cap').textContent : '',
                rows: rows.map((r) => ({ k: r.getAttribute('data-k'), name: r.querySelector('.sp-sysname').textContent, sub: r.querySelector('.sp-syssub').textContent, cap: (r.querySelector('.st-cap') || {}).className + '|' + (r.querySelector('.st-cap') || {}).textContent, open: !r.querySelector('.sp-fold').hidden })),
                afterVitals: !!sec && !!sec.previousElementSibling && sec.previousElementSibling.classList.contains('sp-hero') === false,
            };
        });
        ok(s5.cap.includes('Real visitors'), `the section is "Real visitors" (${s5.cap})`);
        ok(s5.rows.map((r) => r.k).join(',') === 'perf-sp,perf-sc,perf-bo', `three groups in order: phones, computers, the back office (${s5.rows.map((r) => r.k)})`);
        ok(s5.rows[0] && /is-ok\|✓?Fast$/.test(s5.rows[0].cap) && s5.rows[0].sub === '318 visits this week', `phones: "Fast", 318 visits (${s5.rows[0] && s5.rows[0].cap} / ${s5.rows[0] && s5.rows[0].sub})`);
        ok(s5.rows[1] && /is-unk\|Too few visits$/.test(s5.rows[1].cap), `computers: "Too few visits" (${s5.rows[1] && s5.rows[1].cap})`);
        ok(s5.rows[2] && /is-bad\|.*Slow$/.test(s5.rows[2].cap) && s5.rows[2].sub === '41 openings this week', `the back office: "Slow", 41 openings (${s5.rows[2] && s5.rows[2].cap} / ${s5.rows[2] && s5.rows[2].sub})`);
        ok(s5.rows.every((r) => !r.open), 'every group starts folded');
        await sp.click('#sp-perf .sp-sys[data-k="perf-sp"] .sp-syshead');
        await sp.waitForTimeout(350);
        const f5 = await sp.evaluate(() => {
            const row = document.querySelector('#sp-perf .sp-sys[data-k="perf-sp"]');
            const items = [...row.querySelectorAll('.sp-item')].map((i) => ({ label: i.querySelector('.sp-ilabel').textContent, note: i.querySelector('.sp-inote').textContent, ic: (i.querySelector('.sp-iic') || { getAttribute: () => '' }).getAttribute('class') || '', title: i.getAttribute('title') }));
            const bars = [...row.querySelectorAll('.sp-pbar')];
            return { open: !row.querySelector('.sp-fold').hidden && row.classList.contains('is-open'), items, bars: bars.length, none: bars.filter((b) => b.classList.contains('is-none')).length, bad: bars.filter((b) => b.classList.contains('is-bad')).length, last: bars.length ? bars[bars.length - 1].className : '', first: bars.length ? bars[0].className : '', cap: (row.querySelector('.sp-ptcap') || {}).textContent };
        });
        ok(f5.open, 'tapping a group opens it');
        ok(f5.items.map((i) => `${i.label}=${i.note}`).join('; ') === 'Page appears=1.3s; Main picture shows=2.1s; Ready to use=2.6s; Taps answered=96ms; Layout stays put=0.04',
            `its figures, each the three-in-four one: ${f5.items.map((i) => `${i.label}=${i.note}`).join('; ')}`);
        ok(f5.items.every((i) => /is-ok/.test(i.ic)), 'each judged good wears the tick');
        ok(/3 in 4 visits: 1\.3s or less · half: 900ms · 9 in 10: 2\.1s · 318 measured/.test((f5.items[0] || {}).title || ''), `the row's title says what the figure means (${(f5.items[0] || {}).title})`);
        ok(f5.bars === 14 && f5.none === 11 && f5.bad === 1 && !/is-none/.test(f5.last) && !/is-none/.test(f5.first), `fourteen days of "Page appears", missing days drawn empty, a slow day red (${f5.bars}, empty ${f5.none}, red ${f5.bad})`);
        ok(f5.cap === 'Page appears, each day', `the trace says what it draws (${f5.cap})`);
        await sp.click('#sp-perf .sp-sys[data-k="perf-sc"] .sp-syshead');
        await sp.waitForTimeout(350);
        const g5 = await sp.evaluate(() => {
            const row = document.querySelector('#sp-perf .sp-sys[data-k="perf-sc"]');
            const i = row.querySelector('.sp-item');
            return { label: i ? i.querySelector('.sp-ilabel').textContent : '', ic: i ? ((i.querySelector('.sp-iic') || { getAttribute: () => '' }).getAttribute('class') || '') : '', trace: !!row.querySelector('.sp-ptrace'), spOpen: !document.querySelector('#sp-perf .sp-sys[data-k="perf-sp"] .sp-fold').hidden };
        });
        ok(/Page appears \(too few to judge\)/.test(g5.label) && /is-unk/.test(g5.ic), `a figure below the minimum is shown but not judged (${g5.label})`);
        ok(!g5.trace && !g5.spOpen, 'no days, no trace; opening one group folds the other');
        const need = await sp.evaluate(() => [...document.querySelectorAll('.sp-need .sp-nlabel')].map((e) => e.textContent));
        ok(need.includes('Real visitors'), `a slow figure is in "Needs a look" (${need.join(', ')})`);
        await sp.close();

        console.log('§6 nothing measured, nothing claimed');
        sp = await status(t.browser, t.base, null);
        const s6 = await sp.evaluate(() => ({ sec: !!document.getElementById('sp-perf'), need: [...document.querySelectorAll('.sp-need .sp-nlabel')].map((e) => e.textContent) }));
        ok(!s6.sec && !s6.need.includes('Real visitors'), 'a server with no figures shows no section and no check');
        await sp.close();
    } catch (e) {
        console.log('  ✗ suite error: ' + (e && e.stack ? e.stack : e));
        fails++;
    }
    await t.done(fails);
})();
