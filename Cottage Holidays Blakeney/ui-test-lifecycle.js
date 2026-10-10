// ============================================================
//  ui-test-lifecycle.js — a cottage with stays still to come is not removed in one tap.
//
//  Archived, a cottage drops out of the key safes, the timeline, the platform import and
//  the nightly double-booking audit. The SERVER owns the rule (test-integration §61: a
//  removal is refused with `stays_ahead` until it carries confirm_stays). This suite owns
//  the affordance:
//   §1 the refusal reaches the owner as the server's own sentence, in a confirm
//   §2 "Remove it anyway" sends the removal once more, confirmed
//   §3 backing out sends nothing more
// ============================================================
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 1280, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    const sentence = 'Jollyboat Cottage has 2 stays still to come, the first on 22/10/2026. Removing it takes them off the key safes, the calendar and the nightly double-booking check.';
    const props = [
        { prop_key: 'jollyboat', name: 'Jollyboat Cottage', slug: 'jollyboat', couple_rate: 135, sort_order: 1 },
        { prop_key: 'pimpernel', name: 'Pimpernel Cottage', slug: 'pimpernel', couple_rate: 155, sort_order: 2 },
    ];
    const archives = [];
    await page.route(/\.php/, (route) => {
        const req = route.request();
        const json = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (req.method() === 'POST') {
            let b = {};
            try { b = JSON.parse(req.postData() || '{}'); } catch (e) {}
            if (req.url().includes('rates.php') && b.action === 'archive') {
                archives.push(b);
                if (!b.confirm_stays) return json({ error: sentence, code: 'stays_ahead' }, 409);
                return json({ ok: true });
            }
            return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
        }
        return json({ ok: true, properties: props, seasons: {}, occupancy: {}, content: {}, bookings: [], enquiries: [], blocks: [], ranges: [], payments: [], years: [], threads: [], reviews: [], photos: [], experiences: [], events: [] });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForFunction(() => typeof archiveAccommodation === 'function', null, { timeout: 10000 });

    console.log('§1 the refusal reaches the owner in the server\'s words');
    // NOT awaited: it resolves only once the confirm is answered, which is the next step.
    await page.evaluate(() => { archiveAccommodation('jollyboat'); });
    await page.waitForSelector('#glass-dialog.open', { timeout: 5000 }).catch(() => {});
    const asked = await page.evaluate(() => ({
        msg: (document.getElementById('glass-dialog-msg') || {}).textContent || '',
        okLabel: (document.getElementById('glass-dialog-ok') || {}).textContent || '',
    }));
    ok(asked.msg === sentence, `it says what removing the cottage takes away (${asked.msg.slice(0, 60)}…)`);
    ok(/Remove it anyway/.test(asked.okLabel), `…and the button says what it does (${asked.okLabel})`);
    ok(archives.length === 1 && !archives[0].confirm_stays, `the first ask carried no confirmation (${archives.length})`);

    console.log('§2 "Remove it anyway" sends it once more, confirmed');
    await page.click('#glass-dialog-ok');
    for (let i = 0; i < 30 && archives.length < 2; i++) await page.waitForTimeout(100);
    ok(archives.length === 2 && archives[1].confirm_stays === true && archives[1].prop_key === 'jollyboat', `the second ask names the cottage and confirms (${JSON.stringify(archives[1] || null)})`);

    console.log('§3 backing out sends nothing more');
    archives.length = 0;
    await page.evaluate(() => { archiveAccommodation('pimpernel'); });
    await page.waitForSelector('#glass-dialog.open', { timeout: 5000 }).catch(() => {});
    await page.click('#glass-dialog-cancel');
    await page.waitForTimeout(400);
    ok(archives.length === 1 && !archives[0].confirm_stays, `one refused ask and nothing after it (${archives.length})`);
    ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);

    console.log(fails ? `\n${fails} FAILED` : '\nALL LIFECYCLE CHECKS PASSED');
    await done(fails);
})();
