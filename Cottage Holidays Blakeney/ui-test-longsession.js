// ============================================================
//  ui-test-longsession.js — a page left open all day.
//
//  Measured by the round-7 long-session review: nothing accumulates (timers,
//  listeners, observers and the DOM stay flat over twenty rounds), but six things go
//  wrong only on a page that has been open a while, when a release lands or an
//  answer is slow. Each check sets that up, does the next thing, then lets it land.
//   §1 a new build waits for the owner to finish what they are typing
//   §2 a slow Calendar sync answer paints only the cottage it was asked for
//   §3 an overview answer that says nothing is not asked again fifty times a second
//   §4 a slow guest-photos answer stays off the next cottage's page
//   §5 a slow welcome book stays out of the next book opened
//   §6 the homepage's review rotation reads the reviews as they are now
//   §7 a Payments sheet never pulls the cursor out of the field being typed in
// ============================================================
const { bootBrowser } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
const fs = require('fs');
const path = require('path');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BUILD = (fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').match(/const BUILD = '([^']*)'/g) || []).pop().match(/'([^']*)'/)[1];
const generic = { ok: true, bookings: [], enquiries: [], threads: [], reviews: [], photos: [], experiences: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] };

(async () => {
    const t = await bootBrowser();
    const page = async (vp) => {
        const p = await t.browser.newPage({ viewport: vp || { width: 1280, height: 900 } });
        p.on('pageerror', (e) => console.log('  PAGEERR:', e.message));
        await p.addInitScript(() => { if (window.top === window && navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
        return p;
    };
    const owner = async (p) => {
        await p.goto(t.base + '/index.html');
        await p.waitForFunction(() => !!window.__ADMIN_LOADED, null, { timeout: 25000 });
        // The calendar's own auto-sync must not reload anything mid-check.
        await p.evaluate(() => { try { localStorage.setItem('nn-ical-last-sync', String(Date.now())); } catch (e) {} });
        await p.waitForTimeout(800);
    };
    const ownerRoutes = (p, extra) => p.route(/\.php/, async (route) => {
        const req = route.request();
        const url = req.url();
        let body = {};
        try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
        const json = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
        // extra answers with [payload, status] or nothing (fall through to the defaults).
        if (extra) {
            const r = await extra(url, body);
            if (r) return json(r[0], r[1]);
        }
        if (url.includes('auth.php') && body.action === 'admin_status') return json({ ok: true, admin: true, me: { id: 1, name: 'George', full: true } });
        if (url.includes('admin-bootstrap.php')) return json({ ok: true, feeds: [], dismissed: {}, blocks: { ok: true, blocks: [] }, bookings: { bookings: [] }, enquiries: { enquiries: [] }, cron: { stale: false } });
        return json(generic);
    });

    // ---------- §1 a new build waits for the owner to finish ----------
    console.log('\n§1 a new build waits for the owner to finish what they are typing');
    {
        const p = await page();
        let build = BUILD;
        let loads = 0;
        p.on('load', () => { loads++; });
        await ownerRoutes(p, (url) => (url.includes('version.php') ? [{ build }] : undefined));
        await owner(p);
        await p.evaluate(() => window.openAddBooking());
        await p.waitForTimeout(500);
        await p.fill('#modal-name', 'Margaret Halloran');
        const before = loads;
        build = 'nextrelease1'; // a release lands
        await p.evaluate(() => window.dispatchEvent(new Event('focus'))); // the owner glances back at the tab
        await p.waitForTimeout(3500);
        const mid = await p.evaluate(() => ({ open: document.getElementById('edit-modal').classList.contains('open'), name: document.getElementById('modal-name').value }));
        ok(loads === before && mid.open && mid.name === 'Margaret Halloran', 'with Add booking open and a name typed, the page does not reload (' + JSON.stringify(mid) + ', loads ' + (loads - before) + ')');
        // The owner finishes: the sheet closes and nothing has focus.
        await p.evaluate(() => { window.closeModal(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
        for (let i = 0; i < 40 && loads === before; i++) await p.waitForTimeout(250);
        ok(loads === before + 1, 'once the sheet is closed the new build loads (' + (loads - before) + ' reload)');
        await p.close();
    }

    // ---------- §2 Calendar sync: one cottage's late answer ----------
    console.log('\n§2 a slow Calendar sync answer paints only the cottage it was asked for');
    {
        const p = await page({ width: 390, height: 844 });
        await ownerRoutes(p, async (url, body) => {
            if (url.includes('version.php')) return [{ build: BUILD }];
            if (url.includes('ical-import.php') && body.action === 'list') {
                if (body.prop === 'jollyboat') {
                    await sleep(2500);
                    return [{ ok: true, feeds: [{ source: 'airbnb', url: 'https://www.airbnb.co.uk/calendar/ical/1111.ics?s=JOLLY' }], status: { sources: {} }, export_url: 'https://x.test/ical-export.php?prop=jollyboat&t=JOLLY' }];
                }
                return [{ ok: true, feeds: [{ source: 'airbnb', url: 'https://www.airbnb.co.uk/calendar/ical/2222.ics?s=PIMP' }], status: { sources: {} }, export_url: 'https://x.test/ical-export.php?prop=pimpernel&t=PIMP' }];
            }
            return undefined;
        });
        await owner(p);
        await p.evaluate(() => window.openArea());
        await p.waitForTimeout(500);
        await p.evaluate(() => window.settingsOpen('calendar'));
        await p.waitForTimeout(500);
        await p.evaluate(() => { window.settingsOpenCalendar('jollyboat'); });
        await p.waitForTimeout(300);
        await p.evaluate(() => window.settingsOpen('calendar')); // the page's own back link
        await p.waitForTimeout(300);
        await p.evaluate(() => { window.settingsOpenCalendar('pimpernel'); });
        await p.waitForTimeout(3200); // Jollyboat's answer lands
        const after = await p.evaluate(() => ({
            title: (document.getElementById('settings-panel-title') || {}).textContent,
            ids: [...document.querySelectorAll('#calendar-detail input')].map((i) => i.id),
            vals: [...document.querySelectorAll('#calendar-detail input')].map((i) => i.value).join(' '),
        }));
        ok(after.title === 'Pimpernel' && after.ids.length > 0 && after.ids.every((i) => !/jollyboat/.test(i)) && /PIMP/.test(after.vals) && !/JOLLY/.test(after.vals), 'Pimpernel\'s page keeps Pimpernel\'s links and controls when Jollyboat\'s answer lands (' + JSON.stringify(after) + ')');
        await p.close();
    }

    // ---------- §3 the overview that says nothing ----------
    console.log('\n§3 an overview answer that says nothing is not asked again at once');
    {
        const p = await page({ width: 390, height: 844 });
        let asks = 0;
        await ownerRoutes(p, (url, body) => {
            if (url.includes('version.php')) return [{ build: BUILD }];
            if (url.includes('ical-import.php') && body.action === 'overview') { asks++; return [{}]; }
            return undefined;
        });
        await owner(p);
        await p.evaluate(() => window.openArea());
        await p.waitForTimeout(500);
        await p.evaluate(() => window.settingsOpen('calendar'));
        await p.waitForTimeout(3000);
        const onPage = asks;
        ok(onPage >= 1 && onPage <= 2, 'on the Calendar sync page it is asked once, not on every repaint (' + onPage + ' in 3s)');
        await p.evaluate(() => window.nav('view-backoffice'));
        await p.waitForTimeout(3000);
        ok(asks - onPage === 0, 'and on Today nothing asks for it at all (' + (asks - onPage) + ' in 3s)');
        await p.close();
    }

    // ---------- §4 guest photos ----------
    console.log('\n§4 a slow guest-photos answer stays off the next cottage\'s page');
    {
        const p = await page({ width: 390, height: 844 });
        await p.route(/\.php/, async (route) => {
            const url = route.request().url();
            const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
            if (url.includes('version.php')) return json({ build: BUILD });
            if (url.includes('photos.php?prop=jollyboat')) {
                await sleep(2000);
                return json({ ok: true, photos: [{ url: 'uploads/jolly-guest.jpg', caption: 'Sunset from the Jollyboat terrace' }] });
            }
            if (url.includes('photos.php?prop=pimpernel')) return json({ ok: true, photos: [] });
            return json(generic);
        });
        await p.goto(t.base + '/index.html');
        await p.waitForTimeout(600);
        await p.evaluate(() => window.openProperty('jollyboat'));
        await p.waitForTimeout(300);
        await p.evaluate(() => window.openProperty('pimpernel'));
        await p.waitForTimeout(2600);
        const s = await p.evaluate(() => {
            const sec = document.getElementById('guest-photos-section');
            return { shown: !!sec && sec.style.display !== 'none', text: (document.getElementById('guest-photo-grid') || {}).textContent || '' };
        });
        ok(!s.shown && !/Jollyboat terrace/.test(s.text), 'Pimpernel\'s page shows none of Jollyboat\'s guest photos (' + JSON.stringify(s) + ')');
        await p.close();
    }

    // ---------- §5 the welcome book ----------
    console.log('\n§5 a slow welcome book stays out of the next book opened');
    {
        const p = await page({ width: 390, height: 844 });
        await p.route(/\.php/, async (route) => {
            const req = route.request();
            const url = req.url();
            let body = {};
            try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
            const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
            if (url.includes('version.php')) return json({ build: BUILD });
            if (url.includes('welcome.php')) {
                if (body.prop === 'jollyboat') {
                    await sleep(2000);
                    return json({ ok: true, sections: [{ title: 'Wi-Fi', body: 'Network JOLLYBOAT-GUEST, password jolly-1234' }] });
                }
                return json({ ok: true, sections: [{ title: 'Wi-Fi', body: 'Network PIMPERNEL-GUEST, password pimp-5678' }] });
            }
            return json(generic);
        });
        await p.goto(t.base + '/index.html');
        await p.waitForTimeout(600);
        await p.evaluate(() => { window.openWelcomeBook('jollyboat'); });
        await p.waitForTimeout(300);
        await p.evaluate(() => window.closeWelcomeModal());
        await p.waitForTimeout(300);
        await p.evaluate(() => { window.openWelcomeBook('pimpernel'); });
        await p.waitForTimeout(2400);
        const w = await p.evaluate(() => ({ title: document.getElementById('welcome-modal-title').textContent, body: document.getElementById('welcome-modal-body').textContent }));
        ok(/Pimpernel/.test(w.title) && /PIMPERNEL-GUEST/.test(w.body) && !/JOLLYBOAT/.test(w.body), 'Pimpernel\'s book keeps Pimpernel\'s Wi-Fi when Jollyboat\'s answer lands (' + JSON.stringify(w) + ')');
        await p.close();
    }

    // ---------- §6 the review rotation ----------
    console.log('\n§6 the homepage\'s review rotation reads the reviews as they are now');
    {
        const p = await page({ width: 390, height: 844 });
        const R = (name, word) => ({ name, stars: 5, prop: 'jollyboat', text: 'A lovely stay, everything was perfect, ' + word + ' would come back.' });
        await p.route(/\.php/, (route) => {
            const url = route.request().url();
            const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
            if (url.includes('version.php')) return json({ build: BUILD });
            // Any refresh in between reads the reviews as they are after the withdrawal.
            if (url.includes('reviews.php')) return json({ ok: true, reviews: [R('Bravo', 'BRAVO'), R('Charlie', 'CHARLIE')] });
            return json(generic);
        });
        await p.goto(t.base + '/index.html');
        await p.waitForTimeout(800);
        await p.evaluate((rs) => { publicGuestReviews = rs; renderGuestWords(); }, [R('Alpha', 'ALPHA'), R('Bravo', 'BRAVO'), R('Charlie', 'CHARLIE')]);
        // ALPHA is withdrawn; the refresh re-renders with what is left.
        await p.evaluate((rs) => { publicGuestReviews = rs; renderGuestWords(); __gwIdx = 2; }, [R('Bravo', 'BRAVO'), R('Charlie', 'CHARLIE')]);
        await p.waitForTimeout(9600); // one turn of the rotation (8.5s + the fade)
        const q = await p.evaluate(() => document.getElementById('guestwords-quote').textContent);
        ok(!/ALPHA/.test(q) && /BRAVO|CHARLIE/.test(q), 'the next review shown is one still published (' + q.slice(0, 70) + ')');
        await p.close();
    }

    // ---------- §7 the Payments sheet's focus ----------
    console.log('\n§7 a Payments sheet never pulls the cursor out of the field being typed in');
    {
        const p = await page({ width: 390, height: 844 });
        await ownerRoutes(p, (url, body) => {
            if (url.includes('version.php')) return [{ build: BUILD }];
            if (url.includes('monzo.php') && body.action === 'save_client') return [{ error: 'That client isn’t confidential. Make one marked Confidential.' }, 400];
            return undefined;
        });
        await owner(p);
        await p.evaluate(() => window.pmMzSheet());
        await p.waitForTimeout(500);
        await p.evaluate(() => [...document.querySelectorAll('#pm-sheet button')].find((b) => b.textContent.trim() === 'I’ve made it').click());
        await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'pm-mz-id', null, { timeout: 4000 }).catch(() => {});
        await p.fill('#pm-mz-id', 'oauth2client_0000Abc');
        await p.fill('#pm-mz-secret', 'mnzpub.notconfidential');
        await p.evaluate(() => [...document.querySelectorAll('#pm-sheet button')].find((b) => b.textContent.trim() === 'Save').click());
        await p.waitForFunction(() => /confidential/.test(document.getElementById('pm-sheet').textContent), null, { timeout: 4000 });
        // The owner goes straight to the secret and types it again, over the next second.
        await p.click('#pm-mz-secret');
        await p.keyboard.type('mnzconf.secret', { delay: 90 });
        await p.waitForTimeout(500);
        const f = await p.evaluate(() => ({ active: document.activeElement && document.activeElement.id, id: document.getElementById('pm-mz-id').value, secret: document.getElementById('pm-mz-secret').value }));
        ok(f.active === 'pm-mz-secret' && f.secret === 'mnzconf.secret' && f.id === '', 'every keystroke lands in the secret, none in the client ID (' + JSON.stringify(f) + ')');
        await p.close();
    }

    console.log(fails ? `\n  ${fails} CHECK(S) FAILED ❌\n` : '\n  LONG-SESSION SUITE PASSED ✅\n');
    await t.done(fails);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
