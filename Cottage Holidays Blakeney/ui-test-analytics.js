// ui-test-analytics.js — Manage → Analytics says what each figure counts.
//
// The old page called page views "Visits", put the enquiries TABLE (which loses
// every approved enquiry) beside the site's own "sent an enquiry" events, divided
// EVERY booking — hand-added ones too — by visitors, and showed "Returning 0%"
// from a fingerprint that changes with a phone's connection. This suite feeds a
// summary where each of those pairs DISAGREES, so a page that reads the wrong one
// fails by name.
const { bootBrowser } = require('./ui-test-lib');

const PROPS = [
    { prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
    { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 140, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 2, max_total: 6, sort_order: 2 },
];
const daily = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, views: 10 + (i % 7) * 3 }));
const SUM = {
    ok: true, days: 30, totalViews: 494, uniqueVisitors: 175, prevTotalViews: 568, prevUniqueVisitors: 220,
    visitorMix: { new: 175, returning: 0 }, bounceRate: 58,
    exitPages: [{ path: 'view-21a', count: 61 }], daily,
    topReferrers: [{ host: 'google.com', count: 96 }], byCottage: [{ prop_key: 'jollyboat', views: 118 }, { prop_key: '21a', views: 97 }],
    topPages: [{ path: 'view-main', views: 181, dwellMs: 42000 }],
    channels: [{ channel: 'Direct', count: 349 }, { channel: 'Search', count: 103 }],
    searchEngines: [{ name: 'Google', count: 96 }], sources: [],
    events: { book_click: 38, enquiry_open: 22, enquiry_submit: 6, pay_start: 2 },
    devices: [{ device: 'mobile', count: 366 }, { device: 'desktop', count: 109 }, { device: 'tablet', count: 19 }],
    // The pairs that must NOT be read: 3 rows left in the enquiries table (6 were
    // sent), and 4 bookings made in all (1 through the site).
    enquiries: 3, bookings: 4, siteBookings: 1,
    searchDemand: { total: 64, noResult: 60, topMonths: [{ month: '2026-10', count: 34, found: 1 }], recentNoResult: [{ mode: 'exact', adults: 2, children: 0, nights: 3, month: '2026-10', check_in: '2026-10-23' }] },
};

let fails = 0;
const check = (cond, label) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + label);
    if (!cond) fails++;
};

(async () => {
    const t = await bootBrowser();
    const page = await t.browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8000);
    page.on('pageerror', (e) => {
        fails++;
        console.log('PAGEERR', e.message);
    });
    await page.addInitScript(() => {
        if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    });
    await page.route(/\.php/, (r) => {
        const url = r.request().url();
        const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (url.includes('track.php')) {
            const m = /days=(\d+)/.exec(url);
            return json(Object.assign({}, SUM, { days: m ? +m[1] : 30 }));
        }
        if (url.includes('rates.php')) return json({ properties: PROPS, seasons: {}, occupancy: {} });
        return json({ ok: true, bookings: [], enquiries: [], threads: [], messages: [], content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, feeds: [], properties: PROPS });
    });
    await page.goto(`${t.base}/index.html`);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        isAuthenticated = true;
        document.body.classList.add('owner-mode');
        window.__me = { id: 1, name: 'George Farrow', full: true };
    });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForFunction(() => window.__ADMIN_LOADED === true);
    await page.evaluate(async () => {
        await openArea();
        settingsOpen('analytics');
    });
    await page.waitForSelector('#analytics-body .u-stats');

    console.log('§1 each figure says what it counts');
    const p1 = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll('#analytics-body .u-stat')].map((x) => ({ n: x.querySelector('.u-stat-n').textContent, l: x.querySelector('.u-stat-l').textContent, s: (x.querySelector('.ana-tsub') || {}).textContent || '' }));
        const body = document.getElementById('analytics-body').textContent;
        return { tiles, body, pill: document.getElementById('settings-panel-cap').textContent.trim(), over: document.documentElement.scrollWidth - innerWidth };
    });
    const tile = (l) => p1.tiles.find((x) => x.l === l) || {};
    check(tile('People').n === '175' && /▼ 20% on the 30 days before/.test(tile('People').s), `People, with its change in words (${JSON.stringify(tile('People'))})`);
    check(tile('Pages viewed').n === '494', 'page views are called pages viewed, not visits');
    check(tile('Enquiries sent').n === '6', `enquiries are the SENT events (6), not the rows left in the table (3) — ${tile('Enquiries sent').n}`);
    check(tile('Booked through the site').n === '1' && /17% of enquiries/.test(tile('Booked through the site').s), `bookings are the ones made through the site (1 of 4) — ${JSON.stringify(tile('Booked through the site'))}`);
    check(!/Returning|Conversion/.test(p1.body), 'no "Returning" or "Conversion" figure is claimed');
    check(p1.pill === 'Down 20%', `the title's pill states the change in people (${p1.pill})`);
    check(p1.over <= 0, `nothing is wider than the phone (${p1.over})`);

    console.log('§2 the funnel is one colour, and worth-knowing leads to its detail');
    const p2 = await page.evaluate(() => {
        const fills = [...document.querySelectorAll('#analytics-body .ana-funnel [style*="width:"]')].map((el) => getComputedStyle(el).backgroundColor);
        return { colours: new Set(fills).size, n: fills.length, first: (document.querySelector('#analytics-body .ana-insrow') || {}).textContent || '' };
    });
    check(p2.n >= 5 && p2.colours === 1, `five steps, one colour (${p2.n} bars, ${p2.colours} colours)`);
    check(/60 of 64 date searches found nothing free/.test(p2.first), `the unmet searches lead what is worth knowing (${p2.first.trim()})`);
    await page.click('#analytics-body button.ana-insrow');
    await page.waitForFunction(() => !document.getElementById('bhub-fold-ana-search').hidden);
    check(true, 'tapping it opens the searches fold');
    const p2b = await page.evaluate(() => ({ cap: (document.querySelector('[data-grp="ana-search"] .st-cap') || {}).textContent || '', acts: [...document.querySelectorAll('#bhub-fold-ana-search .ana-acts button')].map((b) => b.textContent) }));
    check(/94% unmet/.test(p2b.cap) && p2b.acts.join('|') === 'Open Price ideas|Open the waitlist', `the fold states it and offers where to act (${p2b.cap} / ${p2b.acts.join('|')})`);

    console.log('§3 the window switch, and the CSV');
    await page.click('#analytics-body .ana-seg [data-args="[7]"]');
    await page.waitForFunction(() => (document.querySelector('#analytics-body .ana-seg-btn.on') || {}).textContent === '7 days');
    const seven = await page.evaluate(() => document.querySelector('#analytics-body .u-stat .ana-tsub').textContent);
    check(/on the 7 days before/.test(seven), `the comparison follows the window (${seven})`);
    const csv = await page.evaluate(() => {
        let out = '';
        const real = URL.createObjectURL;
        URL.createObjectURL = (b) => {
            b.text().then((t) => (window.__csv = t));
            return 'blob:x';
        };
        exportAnalyticsCsv();
        URL.createObjectURL = real;
        return out;
    });
    await page.waitForFunction(() => typeof window.__csv === 'string');
    const text = await page.evaluate(() => window.__csv);
    check(/Enquiries sent from the site,6/.test(text) && /Booked through the site,1/.test(text) && !/Returning visitors/.test(text), 'the CSV carries the same honest figures');
    void csv;

    await page.close();
    console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL ANALYTICS CHECKS PASSED');
    await t.done(fails);
})().catch(async (e) => {
    console.error('FAILED:', e);
    process.exit(1);
});
