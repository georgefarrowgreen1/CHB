// ui-test-guestaccount.js — the guest's Account page and the My stays switch
// (the approved account & stays demo).
//   §1 the Account page: rows, sub-pages, the back link, the 44px floor
//   §2 details are facts, edited one at a time through the REAL post shape
//   §3 password: a mismatch keeps the form and says why; the reset link posts no email
//   §4 sign out and delete ASK first — backing out sends nothing
//   §5 Call us exists only when a number is configured
//   §6 My stays: Upcoming | Past only when both sides have stays; switching hides a pane
//   §7 the empty state shows the cottages; the stay card has a photo header
//   §9 stays inside You: the lead card + its one action, rows, the full stay
//      page and the way back, the three-button dock with its amber dot
//   §8 the profile photo: sheet → cropper → the REAL post shape → shown on the
//      page and in the dock; remove brings the initial back
const { bootBrowser } = require('./ui-test-lib');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

(async () => {
    const { browser, base, done } = await bootBrowser();
    const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const priced = { agreed_total: 400, agreed_per_night: 133.33, agreed_nights: 3, agreed_nightly: 400, agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0 };
    const mk = (pk, i, o, x) => Object.assign({ prop_key: pk, check_in: i, check_out: o, adults: 2, children: 0, id: Math.floor(Math.random() * 1e6) }, priced, x || {});
    const guest = { name: 'Gwen Rowe', email: 'gwen@example.com', phone: '07700 900123', address: '1 Quay Street, Blakeney', postcode: 'NR25 7ND' };

    const open = async (bookings) => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
        await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
        const posts = [];
        await page.route(/\.php/, (route) => {
            const url = route.request().url();
            const json = (x, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(x) });
            let body = {};
            try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
            if (route.request().method() === 'POST') posts.push({ url, body });
            if (url.includes('auth.php')) {
                if (body.action === 'guest_status') return json({ ok: true, guest });
                if (body.action === 'guest_update_profile') return json({ ok: true, guest: Object.assign({}, guest, { phone: body.phone, address: body.address, postcode: body.postcode }) });
                if (body.action === 'guest_change_password') return json({ ok: true });
                if (body.action === 'guest_send_reset') return json({ ok: true, until: '12:30' });
                if (body.action === 'guest_avatar_set') return json({ ok: true, avatar: 'abcdef0123' });
                if (body.action === 'guest_avatar_remove') return json({ ok: true, avatar: '' });
                return json({ ok: true, admin: false, guest: null });
            }
            if (url.includes('my-bookings.php')) return json({ ok: true, bookings, enquiries: [], completed_stays: 0 });
            if (url.includes('experiences.php')) return bookings.length
                ? json({ ok: true, experiences: [
                    { id: 11, title: 'Cley Marshes', body: 'Hides over the reedbeds.', category: 'Walks & nature', distance: 'About 6 min drive', mapQuery: 'Cley Marshes' },
                    { id: 12, title: 'Beans Boat Trips', body: 'Out to the seals.', category: 'Boat trips & wildlife', distance: 'About 5 min drive', phone: '01263 740505' },
                ] })
                : json({ error: 'Things to do are for guests who have booked with us.', code: 'stays_only' }, 403);
            if (url.includes('avatar.php')) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
            if (url.includes('passkeys.php')) return json({ ok: true, passkeys: [{ id: 7, label: 'iPhone', created_at: '2026-09-01 10:00:00' }] });
            return json({ ok: true, bookings: [], events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], props: {}, mine: {}, value: null });
        });
        await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
        await page.evaluate(() => openGuestArea());
        await page.waitForTimeout(700);
        return { page, posts };
    };
    const answer = async (page, okBtn) => {
        await page.waitForSelector('#glass-dialog.open');
        await page.click(okBtn ? '#glass-dialog-ok' : '#glass-dialog-cancel');
        await page.waitForTimeout(250);
    };
    // The dialog focuses its first field on a 60ms timer. Typing before that has
    // landed can lose the race on a loaded machine: the focus moves mid-fill and
    // the text goes into the first field (measured: "firstsecond" / ""). Wait for
    // the dialog's own focus before typing into a form of several fields.
    const settled = (page) =>
        page.waitForFunction(() => {
            const f = document.querySelector('#glass-dialog-fields input');
            return document.activeElement === (f || document.getElementById('glass-dialog-ok'));
        });

    // §1
    console.log('§1 the Account page');
    let { page, posts } = await open([]);
    await page.evaluate(() => guestAccountTab());
    await page.waitForTimeout(400);
    const root = await page.evaluate(() => {
        const v = document.getElementById('view-guest-account');
        const rows = [...v.querySelectorAll('.ga-row')];
        return {
            active: v.classList.contains('active'),
            name: (v.querySelector('.ga-hello .ga-h1') || {}).textContent || '',
            labels: rows.map((r) => (r.querySelector('.ga-t') || {}).textContent || ''),
            short: rows.filter((r) => r.getBoundingClientRect().height < 44).length,
            dockCur: (document.querySelector('.guest-dock-btn.current') || {}).dataset ? document.querySelector('.guest-dock-btn.current').dataset.tab : '',
        };
    });
    ok(root.active && root.name === 'Hi, Gwen', `the You tab opens the page, greeting the guest (${root.name})`);
    ok(['Your details', 'Sign-in & security', 'Message us', 'Booking terms', 'Privacy & your data', 'Sign out'].every((l) => root.labels.includes(l)),
        `one list: settings, help, privacy, sign out (${root.labels.join(' · ')})`);
    ok(root.short === 0, 'every row reaches the 44px floor');
    ok(root.dockCur === 'account', `the dock marks Account as current (${root.dockCur})`);
    await page.click('#guest-account-body .ga-row:has(.ga-t:text-is("Your details"))');
    await page.waitForTimeout(350);
    const det = await page.evaluate(() => ({
        h: (document.querySelector('#guest-account-body .ga-h1') || {}).textContent || '',
        email: document.querySelector('#guest-account-body div.ga-row .ga-s').textContent,
        emailIsStatic: !document.querySelector('#guest-account-body div.ga-row').matches('button'),
        inputs: document.querySelectorAll('#guest-account-body input, #guest-account-body textarea').length,
    }));
    ok(det.h === 'Your details' && det.email === 'gwen@example.com', 'the Your details row opens it');
    ok(det.emailIsStatic && det.inputs === 0, 'details read as FACTS — no form fields on arrival, and the email is not a control');
    await page.click('#guest-account-body .ga-back');
    await page.waitForTimeout(350);
    ok(await page.evaluate(() => /^Hi, Gwen$/.test(document.querySelector('#guest-account-body .ga-h1').textContent)), 'the back link returns to You');

    // §2
    console.log('§2 edit one fact');
    await page.evaluate(() => gaGo('details'));
    await page.waitForTimeout(300);
    await page.click('#guest-account-body button.ga-row:nth-of-type(1)'); // Phone (the first BUTTON row)
    await page.waitForSelector('#glass-dialog.open');
    const fieldCount = await page.evaluate(() => document.querySelectorAll('#glass-dialog-fields input, #glass-dialog-fields textarea').length);
    ok(fieldCount === 1, `editing the phone asks for the phone alone (${fieldCount} field)`);
    await page.fill('#gdf-phone', '07700 900999');
    await answer(page, true);
    await page.waitForTimeout(300);
    const up = posts.find((p) => p.body.action === 'guest_update_profile');
    ok(!!up && up.body.phone === '07700 900999' && up.body.address === guest.address && up.body.postcode === guest.postcode,
        'the save carries the new phone with the address + postcode the server requires');
    ok(await page.evaluate(() => /07700 900999/.test(document.getElementById('guest-account-body').textContent)), 'the row shows the saved value');

    // §3
    console.log('§3 password');
    await page.evaluate(() => gaGo('security'));
    await page.waitForTimeout(400);
    const sec = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('#guest-account-body .ga-t')].map((e) => e.textContent),
        inputs: document.querySelectorAll('#guest-account-body input').length,
    }));
    ok(sec.inputs === 0 && sec.rows.includes('Change password') && sec.rows.includes('Email me a reset link'), 'the password is two rows, not three empty boxes');
    ok(sec.rows.includes('iPhone'), 'passkeys list as rows');
    await page.evaluate(() => { gaPassword(); });
    await page.waitForSelector('#glass-dialog.open');
    await settled(page);
    await page.fill('#gdf-current', 'oldpass99');
    await page.fill('#gdf-next', 'newpass123');
    await page.fill('#gdf-confirm', 'different1');
    await answer(page, true);
    await page.waitForSelector('#glass-dialog.open');
    const say = await page.evaluate(() => document.getElementById('glass-dialog-msg').textContent);
    ok(/do not match/.test(say) && !posts.some((p) => p.body.action === 'guest_change_password'), `a mismatch keeps the form and says why, sending nothing (${say})`);
    await settled(page); // the reopened form focuses its first field again
    await page.fill('#gdf-next', 'newpass123');
    await page.fill('#gdf-confirm', 'newpass123');
    await answer(page, true);
    const cp = posts.find((p) => p.body.action === 'guest_change_password');
    ok(!!cp && cp.body.next === 'newpass123' && cp.body.current === 'oldpass99', 'then the change posts the guest\'s own new password');
    await page.evaluate(() => gaResetLink());
    await page.waitForTimeout(300);
    const rs = posts.find((p) => p.body.action === 'guest_send_reset');
    ok(!!rs && !('email' in rs.body), 'the reset link is asked for with no email in the body (the server uses the account\'s own)');

    // §4
    console.log('§4 sign out and delete ask first');
    const n0 = posts.length;
    await page.evaluate(() => { gaSignOut(); });
    await answer(page, false);
    ok(posts.length === n0 && (await page.evaluate(() => !!currentGuest)), 'backing out of Sign out signs nobody out');
    await page.evaluate(() => { deleteGuestAccount(); });
    await answer(page, false);
    ok(!posts.slice(n0).some((p) => p.body.action === 'guest_delete_account'), 'backing out of Delete sends nothing');
    ok(await page.evaluate(() => !document.querySelector('#guest-account-body a[href^="tel:"]')), 'with no number configured there is no Call us row');
    await page.close();

    // §5
    console.log('§5 Call us');
    ({ page, posts } = await open([]));
    await page.evaluate(() => { siteContent['contact-phone'] = { dial: '+441263740000', display: '01263 740000' }; guestAccountTab(); });
    await page.waitForTimeout(300);
    const tel = await page.evaluate(() => (document.querySelector('#guest-account-body a[href^="tel:"]') || {}).getAttribute ? document.querySelector('#guest-account-body a[href^="tel:"]').getAttribute('href') : '');
    ok(tel === 'tel:+441263740000', `a configured number becomes a Call us row (${tel})`);
    await page.close();

    // §6
    console.log('§6 Upcoming | Past');
    ({ page } = await open([mk('jollyboat', d(12), d(15), { payment: 'unpaid' }), mk('21a', d(-30), d(-27), { payment: 'paid', deposit_paid: 400 })]));
    const seg = await page.evaluate(() => ({
        shown: !document.getElementById('gb-seg').hidden,
        labels: [...document.querySelectorAll('#gb-seg .gb-seg-b')].map((b) => b.textContent),
        upHidden: document.getElementById('gb-pane-up').hidden,
        pastHidden: document.getElementById('gb-pane-past').hidden,
        welcome: document.getElementById('guest-welcome').textContent,
    }));
    ok(seg.shown && seg.labels[0] === 'Upcoming1' && seg.labels[1] === 'Past1', `the switch counts each side (${seg.labels.join(' | ')})`);
    ok(!seg.upHidden && seg.pastHidden, 'Upcoming is chosen first');
    ok(/12 days until Jollyboat/.test(seg.welcome), `the welcome says where they are (${seg.welcome})`);
    await page.click('#gb-seg .gb-seg-b:nth-child(2)');
    await page.waitForTimeout(200);
    const seg2 = await page.evaluate(() => ({
        upHidden: document.getElementById('gb-pane-up').hidden,
        pastShown: document.getElementById('gb-pane-past').getClientRects().length > 0,
        sel: document.querySelector('#gb-seg .gb-seg-b[aria-selected="true"]').textContent,
        hdr: (() => { const h = document.querySelector('#gb-pane-past > .gb-hdr'); return h ? h.getClientRects().length : -1; })(),
    }));
    ok(seg2.upHidden && seg2.pastShown && /^Past/.test(seg2.sel), 'tapping Past shows the past stays and hides the rest');
    ok(seg2.hdr === 0, 'under the switch the pane does not repeat its own heading');
    await page.evaluate(() => renderGuestBookings());
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.getElementById('gb-pane-up').hidden === true), 'the choice survives a refresh');
    ok(await page.evaluate(() => !!document.querySelector('.gb2 .gb2-photo')), 'each stay card has its photo header');
    await page.close();
    ({ page } = await open([mk('21a', d(-30), d(-27), { payment: 'paid', deposit_paid: 400 })]));
    ok(await page.evaluate(() => document.getElementById('gb-seg').hidden && !document.getElementById('gb-pane-past').hidden),
        'with only past stays there is no switch — a tab with nothing behind it offers nothing');
    await page.close();

    // §7
    console.log('§7 the empty state');
    ({ page } = await open([]));
    const empty = await page.evaluate(() => ({
        t: (document.querySelector('.gb-empty-t') || {}).textContent || '',
        picks: document.querySelectorAll('.gb-picks .gb-pick').length,
        go: (document.querySelector('.gb-empty-go') || {}).textContent || '',
    }));
    ok(empty.t === 'Nothing booked yet' && empty.go === 'Find dates', `a first visit gets one short card (${empty.t} · ${empty.go})`);
    ok(empty.picks >= 3, `…and the cottages to start from (${empty.picks})`);
    await page.close();

    // §8
    console.log('§8 the profile photo');
    ({ page, posts } = await open([]));
    await page.evaluate(() => guestAccountTab());
    await page.waitForTimeout(300);
    // The You page shows the photo and offers nothing to change it: that is on
    // Your details (owner's ask).
    const you8 = await page.evaluate(() => ({
        ava: !!document.querySelector('#guest-account-body .ga-hello .ga-ava'),
        btn: !!document.querySelector('#guest-account-body .ga-hello button, #guest-account-body .ga-hello .ga-cam, #guest-account-body .ga-hello [data-act="gaPhotoSheet"]'),
    }));
    ok(you8.ava && !you8.btn, 'the You page shows the photo, with nothing there to change it');
    await page.evaluate(() => gaGo('details'));
    await page.waitForTimeout(300);
    const pre = await page.evaluate(() => ({
        ini: (document.querySelector('#guest-account-body .ga-ava') || {}).textContent || '',
        label: (document.querySelector('.ga-avabtn') || { getAttribute: () => '' }).getAttribute('aria-label'),
        dockImg: !!document.querySelector('.guest-dock-btn[data-tab="account"] img'),
    }));
    ok(pre.ini === 'G' && /Add a profile photo/.test(pre.label) && !pre.dockImg, `no photo yet: the initial, an "add" name, the dock's outline (${pre.ini})`);
    await page.click('.ga-avabtn');
    await page.waitForSelector('#ga-photo-sheet.open');
    const sheet = await page.evaluate(() => [...document.querySelectorAll('#ga-photo-sheet .ga-t')].map((e) => e.textContent));
    ok(sheet.includes('Take a photo') && sheet.includes('Choose from library') && !sheet.includes('Remove photo'), `the sheet offers take / choose, and no remove yet (${sheet.join(' · ')})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => !document.getElementById('ga-photo-sheet').classList.contains('open')), 'Escape closes the sheet');
    // A real image through the real cropper (a wide one, so it has to be positioned).
    await page.evaluate(() => {
        const cv = document.createElement('canvas'); cv.width = 900; cv.height = 600;
        const g = cv.getContext('2d'); g.fillStyle = '#4f6e66'; g.fillRect(0, 0, 900, 600); g.fillStyle = '#c98e6b'; g.fillRect(400, 200, 120, 160);
        gaCropOpen(cv.toDataURL('image/jpeg', 0.9));
    });
    await page.waitForSelector('#ga-crop.open');
    const st = await page.$('#ga-crop-stage');
    const box = await st.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    const moved = await page.evaluate(() => (document.getElementById('ga-crop-img') || {}).style.transform || '');
    ok(/translate\(-60px/.test(moved), `dragging moves the photo inside the circle (${moved})`);
    await page.click('#ga-crop .is-done');
    await page.waitForTimeout(500);
    const set = posts.find((p) => p.body.action === 'guest_avatar_set');
    ok(!!set && /^data:image\/jpeg;base64,/.test(set.body.data) && !('email' in set.body), 'Use photo posts one JPEG, and nothing that names whose (the session decides)');
    const after = await page.evaluate(() => ({
        img: (document.querySelector('#guest-account-body .ga-ava img') || {}).getAttribute ? document.querySelector('#guest-account-body .ga-ava img').getAttribute('src') : '',
        dock: (document.querySelector('.guest-dock-btn[data-tab="account"] img') || { getAttribute: () => '' }).getAttribute('src'),
        cropShut: !document.getElementById('ga-crop').classList.contains('open'),
        label: document.querySelector('.ga-avabtn').getAttribute('aria-label'),
    }));
    ok(after.cropShut && after.img === 'avatar.php?v=abcdef0123', `the photo shows on Your details, versioned (${after.img})`);
    ok(after.dock === 'avatar.php?v=abcdef0123', 'and the dock\'s Account button wears it');
    ok(/Change your profile photo/.test(after.label), 'the circle now says it changes the photo');
    await page.evaluate(() => gaGo(''));
    await page.waitForTimeout(300);
    const youAfter = await page.evaluate(() => ({
        img: (document.querySelector('#guest-account-body .ga-hello .ga-ava img') || { getAttribute: () => '' }).getAttribute('src'),
        btn: !!document.querySelector('#guest-account-body .ga-hello button'),
    }));
    ok(youAfter.img === 'avatar.php?v=abcdef0123' && !youAfter.btn, `the You page shows the new photo too, still not as a button (${youAfter.img})`);
    await page.evaluate(() => gaGo('details'));
    await page.waitForTimeout(300);
    await page.click('.ga-avabtn');
    await page.waitForSelector('#ga-photo-sheet.open');
    await page.click('#ga-photo-sheet [data-act="gaPhotoRemove"]');
    await page.waitForTimeout(500);
    const gone = await page.evaluate(() => ({
        ini: (document.querySelector('#guest-account-body .ga-ava') || {}).textContent || '',
        dockImg: !!document.querySelector('.guest-dock-btn[data-tab="account"] img'),
    }));
    ok(posts.some((p) => p.body.action === 'guest_avatar_remove') && gone.ini === 'G' && !gone.dockImg, 'Remove posts once and the initial and the outline come back');
    await page.close();

    // §9
    console.log('§9 stays inside You');
    ({ page } = await open([
        mk('jollyboat', d(12), d(15), { id: 701, payment: 'unpaid', pay_token: 'tok701' }),
        mk('21a', d(-30), d(-27), { id: 702, payment: 'paid', deposit_paid: 400 }),
        mk('jollyboat', d(-90), d(-87), { id: 703, payment: 'paid', deposit_paid: 400 }),
    ]));
    await page.evaluate(() => guestAccountTab());
    await page.waitForFunction(() => !!document.querySelector('#ga-stays .ga-staycard .ga-lead-n'));
    const you = await page.evaluate(() => {
        const card = document.querySelector('#ga-stays .ga-staycard');
        const pay = card.querySelector('[data-act="openPayView"]');
        return {
            cap: (document.querySelector('#ga-stays .ga-cap') || {}).textContent || '',
            name: card.querySelector('.ga-lead-n').textContent,
            badge: (card.querySelector('.ga-badge') || {}).textContent || '',
            payArgs: pay ? pay.getAttribute('data-args') : '',
            quick: [...card.querySelectorAll('.ga-q span')].map((e) => e.textContent),
            rows: [...document.querySelectorAll('#ga-stays .ga-stayrow .ga-t')].map((e) => e.textContent),
            hello: document.getElementById('ga-hello-s').textContent,
            order: (() => { const a = document.getElementById('ga-stays'); const b = [...document.querySelectorAll('#guest-account-body .ga-t')].find((e) => e.textContent === 'Your details'); return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); })(),
            dockTabs: [...document.querySelectorAll('.guest-dock-btn')].map((b) => b.dataset.tab).filter(Boolean),
            pip: !!document.querySelector('.guest-dock-btn[data-tab="account"] .gd-pip'),
        };
    });
    ok(you.cap === 'Your next stay' && you.name === 'Jollyboat' && /12 days to go/.test(you.badge), `the next stay leads, counting down (${you.cap} · ${you.name} · ${you.badge})`);
    ok(/tok701/.test(you.payArgs), `its one action is Pay, through the stay's own pay link (${you.payArgs})`);
    ok(you.quick.join('|') === 'Directions|House rules|Amenities|Message', `four shortcuts under it (${you.quick.join(' · ')})`);
    ok(you.rows.length === 2 && you.rows.every((r) => /21A|Jollyboat/.test(r)), `the other stays are rows (${you.rows.join(' · ')})`);
    ok(/12 days until Jollyboat/.test(you.hello), `the greeting says where they are (${you.hello})`);
    ok(you.order, 'stays come first, the account settings after');
    ok(!you.dockTabs.includes('stays') && you.dockTabs.includes('account'), `My stays has left the menu — You is where it lives (${[...new Set(you.dockTabs)].join(', ')})`);
    ok(you.pip, 'the You button carries a dot while money is due');
    await page.click('#ga-stays .ga-open');
    await page.waitForFunction(() => document.getElementById('view-guest-bookings').classList.contains('active') && !!document.getElementById('gb2-fold-b701'));
    await page.waitForTimeout(700);
    const opened = await page.evaluate(() => {
        const card = document.querySelector('.my-stay-hub') || document.getElementById('gb2-fold-b701').closest('.gb2');
        const r = card.getBoundingClientRect();
        return { inView: r.top < innerHeight && r.bottom > 0, back: (document.getElementById('acct-settings-btn') || {}).textContent || '', dockCur: (document.querySelector('.guest-dock-btn.current') || { dataset: {} }).dataset.tab };
    });
    ok(opened.inView, '"Everything about this stay" opens the full stay page on that stay\'s hub');
    ok(/You/.test(opened.back) && opened.dockCur === 'account', `which leads with "‹ You" and keeps You marked in the menu (${opened.back.trim()} · ${opened.dockCur})`);
    await page.click('#acct-settings-btn');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById('view-guest-account').classList.contains('active')), 'the back link returns to You');
    await page.waitForFunction(() => !!document.querySelector('#ga-stays .ga-stayrow'));
    await page.click('#ga-stays .ga-stayrow:last-of-type');
    await page.waitForFunction(() => document.getElementById('view-guest-bookings').classList.contains('active'));
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById('gb-pane-past') && !document.getElementById('gb-pane-past').hidden), 'a past row opens the stay page on Past');
    await page.close();

    // §10
    console.log('§10 things to do are for guests who have booked');
    const painted = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].some((e) => e.getClientRects().length > 0), sel);
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (x, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(x) });
        if (url.includes('experiences.php')) return json({ error: 'Things to do are for guests who have booked with us.', code: 'stays_only' }, 403);
        if (url.includes('auth.php')) return json({ ok: true, admin: false, guest: null });
        return json({ ok: true, bookings: [], events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], props: {}, mine: {}, value: null });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    ok(!(await painted('.guest-dock-btn[data-tab="experiences"]')), 'a visitor gets no Things to do button in the menu');
    ok(!(await painted('a[data-view="view-experiences"]')), '…and no Things to do link anywhere (header, footer)');
    await page.evaluate(() => nav('view-experiences'));
    await page.waitForTimeout(500);
    ok(await painted('#exp-locked'), 'opening /experiences directly says it is for guests who have booked');
    ok(!(await painted('#exp-grid')) && !(await painted('#exp-error')) && !(await painted('#exp-empty')), '…and shows no list, no "couldn\'t load", no "coming soon"');
    await page.close();
    ({ page } = await open([]));
    await page.waitForTimeout(300);
    ok(!(await painted('.guest-dock-btn[data-tab="experiences"]')), 'a signed-in guest who has never booked gets no button either');
    await page.evaluate(() => guestAccountTab());
    await page.waitForTimeout(500);
    ok(!(await page.evaluate(() => !!document.querySelector('#ga-todo .ga-tcard'))), '…and no Things to do section on You');
    await page.close();
    await page.close();
    ({ page } = await open([mk('jollyboat', d(-1), d(2), { id: 801, payment: 'paid', deposit_paid: 400 })]));
    await page.evaluate(() => guestAccountTab());
    await page.waitForFunction(() => !!document.querySelector('#ga-todo .ga-tcard'), null, { timeout: 5000 }).catch(() => {});
    const todo = await page.evaluate(() => ({
        cap: (document.querySelector('#ga-todo .ga-cap') || {}).textContent || '',
        cards: [...document.querySelectorAll('#ga-todo .ga-tcard .ga-tn')].map((e) => e.textContent),
        order: (() => { const a = document.getElementById('ga-stays'); const t = document.getElementById('ga-todo'); const b = [...document.querySelectorAll('#guest-account-body .ga-t')].find((e) => e.textContent === 'Your details'); return !!(a && t && b && (a.compareDocumentPosition(t) & 4) && (t.compareDocumentPosition(b) & 4)); })(),
        tabs: [...document.querySelectorAll('#guest-dock-slot .guest-dock-btn')].filter((b) => b.getClientRects().length).map((b) => b.dataset.tab),
    }));
    ok(todo.cards.length === 2, `a guest who has booked gets Things to do on the You page (${todo.cards.join(' · ')})`);
    ok(/^Near /.test(todo.cap) && todo.cards[0] === 'Beans Boat Trips', `while staying it is "Near …" with the boat trips first (${todo.cap} · ${todo.cards[0]})`);
    ok(todo.order, 'it sits between the stays and the account settings');
    ok(!todo.tabs.includes('experiences'), `the menu no longer carries Things to do (${todo.tabs.join(', ')})`);
    await page.click('#ga-todo .ga-tcard:nth-child(2)');
    await page.waitForFunction(() => document.getElementById('view-experiences').classList.contains('active') && document.getElementById('exp-detail-modal').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const list = await page.evaluate(() => {
        const sheet = document.getElementById('exp-detail-modal');
        const open = document.querySelector('#exp-grid .exp-row.is-open');
        return {
            active: document.getElementById('view-experiences').classList.contains('active'),
            rows: document.querySelectorAll('#exp-grid .exp-row').length,
            groups: [...document.querySelectorAll('#exp-grid .exp-sech h2')].map((h) => h.textContent),
            openId: open ? open.dataset.expId : '',
            sheetOpen: sheet.classList.contains('open') && sheet.getClientRects().length > 0,
            title: (sheet.querySelector('h2') || {}).textContent || '',
            acts: [...sheet.querySelectorAll('.exp-actions .exp-act')].map((a) => a.textContent.trim()),
            back: [...document.querySelectorAll('#view-experiences .exp-back')].some((e) => e.getClientRects().length),
            dockCur: (document.querySelector('#guest-dock-slot .guest-dock-btn.current') || { dataset: {} }).dataset.tab,
        };
    });
    ok(list.active && list.rows === 2, `tapping a card opens the full list as rows (${list.rows})`);
    ok(list.groups.join('|') === 'Boat trips & wildlife|Walks & nature', `…grouped by kind, boat trips first (${list.groups.join(' · ')})`);
    ok(list.sheetOpen && list.openId === '11' && /Cley Marshes/.test(list.title), `…with that place open as a sheet (${list.openId} · ${list.title})`);
    ok(list.acts.some((a) => /Directions/.test(a)) && list.acts.some((a) => /Save/.test(a)), `…carrying Directions and Save (${list.acts.join(', ')})`);
    ok(list.back && list.dockCur === 'account', `…a "‹ You" back link, and You still marked in the menu (${list.dockCur})`);
    await page.click('#exp-detail-modal .exp-act-save');
    await page.waitForTimeout(200);
    const sv = await page.evaluate(() => ({
        store: localStorage.getItem('chb-exp-saved'),
        chip: (document.querySelector('#exp-filters [data-cat="saved"] .exp-cc') || {}).textContent,
        rowOn: !!document.querySelector('#exp-grid [data-exp-id="11"] .exp-save.is-on'),
        top: (document.querySelector('#exp-grid .exp-sech h2') || {}).textContent,
    }));
    ok(sv.store === '[11]' && sv.chip === '1' && sv.rowOn && sv.top === 'Your list', `Save keeps it on this phone and leads the list (${sv.store} · chip ${sv.chip} · ${sv.top})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => !document.getElementById('exp-detail-modal').classList.contains('open') && !document.querySelector('#exp-grid .exp-row.is-open')), 'Escape closes the sheet');
    await page.fill('#exp-q', 'seals');
    await page.waitForTimeout(150);
    ok(await page.evaluate(() => [...document.querySelectorAll('#exp-grid .exp-row .card-title')].map((e) => e.textContent).join('|') === 'Beans Boat Trips'), 'search narrows the list as you type');
    await page.fill('#exp-q', 'zzz');
    await page.waitForTimeout(150);
    ok(await page.evaluate(() => /Nothing matches/.test(document.getElementById('exp-grid').textContent) && !!document.querySelector('#exp-grid [data-exp-clear]')), 'nothing found says so and offers to clear');
    await page.click('#exp-grid [data-exp-clear]');
    await page.waitForTimeout(150);
    ok(await page.evaluate(() => document.querySelectorAll('#exp-grid .exp-row').length >= 2 && document.getElementById('exp-q').value === ''), '…and clearing brings everything back');
    await page.click('#view-experiences .exp-back');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById('view-guest-account').classList.contains('active')), 'and the back link returns to You');
    await page.close();

    console.log(fails ? `\n${fails} FAILED` : '\nALL GUEST ACCOUNT CHECKS PASSED');
    await done(fails);
})();
