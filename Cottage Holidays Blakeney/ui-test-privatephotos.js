// ui-test-privatephotos.js — the photos kept private (and encrypted) on the server,
// as the owner sees them.
//   §1 a deposit photo shows on the booking's Activity as a thumbnail that opens it,
//      through the link that expires the server sent; nothing else is drawn as one
//   §2 a guest's suggestion waiting for approval shows its picture through its link,
//      not at the address it will have once published; approving one whose picture
//      has gone says so
const { boot } = require('./ui-test-lib');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const d = (n) => { const t = new Date(Date.now() + n * 86400000); return t.toISOString().slice(0, 10); };

// A 1×1 PNG, what photo.php would send once it has decrypted the photo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const SIG = 'ab'.repeat(16);
const DEP_LINK = 'photo.php?f=deposit-evidence-1-0123456789ab.jpg&exp=9999999999&sig=' + SIG;
const SUG_LINK = 'photo.php?f=experience-0123456789ab.jpg&exp=9999999999&sig=' + SIG;

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 1000, height: 900 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    const row = {
        id: 1, prop_key: '21a', name: 'Dora Deposit', email: 'dora@gmail.com', phone: '07700 900000', address: '1 Lane', postcode: 'NR25 7AB',
        check_in: d(-10), check_out: d(-7), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0, payment: 'paid', deposit_paid: 440,
        payment_method: 'Card', payment_date: d(-12), agreed_total: 440, agreed_per_night: 130, agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50,
        agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-20), hold_status: 'kept', hold_amount: 50, notes: '',
    };
    const photoGets = [];
    const posts = [];
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
        if (url.includes('photo.php')) {
            photoGets.push(url.split('/').pop());
            return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
        }
        let b = {};
        try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (route.request().method() === 'POST') posts.push(Object.assign({ __url: url.split('/').pop().split('?')[0] }, b));
        if (url.includes('bookings.php')) {
            if (b.action === 'hub_bundle') return json({ ok: true, payments: [], events: [
                { action: 'deposit.evidence', summary: 'Deposit photo saved', actor: 'You', at: d(-6) + ' 10:00:00', photo: DEP_LINK },
                // Anything but photo.php's own link is never drawn as a picture.
                { action: 'deposit.evidence', summary: 'Deposit photo saved', actor: 'You', at: d(-6) + ' 09:00:00', photo: 'javascript:alert(1)' },
                { action: 'booking.add', summary: 'Booking created', actor: 'You', at: d(-20) + ' 09:00:00' },
            ] });
            if (route.request().method() === 'POST') return json({ ok: true });
            return json({ bookings: [row] });
        }
        if (url.includes('experiences.php')) {
            if (b.action === 'list_admin') return json({ experiences: [
                { id: 5, status: 'pending', source: 'guest', title: 'Seal trip from Morston', body: 'An hour each way.', category: 'Boat trips', image_url: 'uploads/experience-0123456789ab.jpg', image_view: SUG_LINK, suggested_by_name: 'Gina Guest', link_url: '', phone: '' },
                { id: 6, status: 'published', source: 'admin', title: 'Coast path', body: 'Cley to Blakeney.', category: 'Walks', image_url: 'uploads/coast-path.jpg', image_view: 'uploads/coast-path.jpg', link_url: '', phone: '' },
            ] });
            if (b.action === 'approve') return json({ ok: true, picture: 'missing' });
            return json({ ok: true });
        }
        return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], threads: [], events: [], logs: {} });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(500);
    await page.evaluate(() => loadData());
    await page.waitForTimeout(500);

    console.log('§1 a deposit photo on the booking\'s Activity');
    await page.evaluate(() => window.openBookingHub('b1'));
    await page.waitForFunction(() => !!document.querySelector('#hub-history .bhub-hist-row'), null, { timeout: 10000 }).catch(() => {});
    // The Activity sits in a fold; the photo must be there whether or not it is open.
    const a = await page.evaluate(() => {
        const links = [...document.querySelectorAll('#hub-history a.bhub-feed-photo')];
        const img = links[0] && links[0].querySelector('img');
        return {
            n: links.length,
            href: links[0] ? links[0].getAttribute('href') : '',
            src: img ? img.getAttribute('src') : '',
            label: links[0] ? links[0].getAttribute('aria-label') : '',
            target: links[0] ? links[0].getAttribute('target') : '',
            js: !!document.querySelector('#hub-history [href^="javascript"], #hub-history [src^="javascript"]'),
            line: [...document.querySelectorAll('#hub-history .bhub-hist-what')].some((w) => /^Deposit photo saved/.test(w.textContent.trim())),
        };
    });
    ok(a.n === 1 && a.href === a.src && a.src.indexOf('photo.php?f=deposit-evidence-1-') === 0, `the photo shows as a thumbnail through its link (${a.n} · ${a.src.slice(0, 48)})`);
    ok(!a.js, 'a photo value that is not photo.php\'s own link is never drawn, as a link or a picture');
    ok(a.line && a.label === 'Open the deposit photo' && a.target === '_blank', 'under its plain line, and it opens the photo when tapped');
    await page.evaluate(() => { const g = document.querySelector('[data-grp="activity"] .bhub-fold-row, #bhub-fold-activity-row'); if (g && g.getAttribute('aria-expanded') !== 'true') g.click(); });
    await page.evaluate(() => typeof bhubFoldToggle === 'function' && document.getElementById('bhub-fold-activity') && document.getElementById('bhub-fold-activity').hidden && bhubFoldToggle('activity'));
    await page.waitForFunction(() => { const i = document.querySelector('#hub-history a.bhub-feed-photo img'); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
    const loaded = await page.evaluate(() => { const i = document.querySelector('#hub-history a.bhub-feed-photo img'); return !!i && i.naturalWidth > 0; });
    ok(loaded && photoGets.some((u) => u.indexOf('photo.php?f=deposit-evidence-1-') === 0), 'the picture loads from photo.php (where it is decrypted), and nowhere else');

    console.log('§2 a suggestion waiting for approval');
    await page.evaluate(async () => { await openArea(); });
    await page.evaluate(() => settingsOpen('experiences'));
    await page.waitForFunction(() => !!document.querySelector('#exp-admin .exp-edit-thumb'), null, { timeout: 10000 }).catch(() => {});
    const s = await page.evaluate(() => {
        const thumbs = [...document.querySelectorAll('#exp-admin .exp-edit-thumb')].map((t) => t.style.backgroundImage);
        return { thumbs, hidden: (document.getElementById('exp-img-6') || {}).value || '' };
    });
    ok(s.thumbs.some((t) => t.indexOf('photo.php?f=experience-0123456789ab.jpg') !== -1), 'the waiting suggestion\'s picture shows through its link');
    ok(!s.thumbs.some((t) => t.indexOf('uploads/experience-0123456789ab.jpg') !== -1), '…never at the address it will have once published (nothing is there yet)');
    ok(s.hidden === 'uploads/coast-path.jpg', 'a published card keeps its picture\'s name for the save to send back');
    await page.click('#exp-admin [data-act="expApprove"]');
    await page.waitForFunction(() => /Published without its picture/.test(document.body.textContent), null, { timeout: 6000 }).catch(() => {});
    ok(posts.some((p) => p.__url === 'experiences.php' && p.action === 'approve' && p.id === 5), 'approving posts the suggestion');
    ok(await page.evaluate(() => /Published without its picture — it couldn’t be found/.test(document.body.textContent)), 'a picture that has gone is said, not shown broken');

    console.log(fails ? `\n  ${fails} CHECK(S) FAILED ❌\n` : '\n  ALL PRIVATE PHOTO CHECKS PASSED ✅\n');
    await done(fails);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
