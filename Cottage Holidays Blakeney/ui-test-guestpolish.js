// ui-test-guestpolish.js — the guest audit's medium findings (overnight round 8).
//   §1 the waitlist sheet names its three fields, and says what it will email
//      about (no "these dates" when there are none)
//   §2 the empty price box says nothing about a deposit the cottage does not take
//   §3 the cottage calendar's month row spreads like the date picker's
//   §4 reviews: a section heading like its siblings, and ONE rating precision
//   §5 the page you are on is SAID (aria-current) and, on a computer, SHOWN
//   §6 the You pages move focus to their own heading
//   §7 an account made with an emailed code SETS a password; one with a
//      password changes it
//   §8 a stay's state capsule is sans and on its own tint; Past is visible
//   §9 the chat's first quick reply clears the edge
//   §10 Things to do has no "Your list 0" chip
//   §11 the delete confirm has a title; the pending card says its state once
const { bootBrowser } = require('./ui-test-lib');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const PROPS = [
    { prop_key: '21a', name: '21A Westgate Street', slug: 'a21', couple_rate: 145, sort_order: 1, booking_fee: 75 },
    { prop_key: 'jollyboat', name: 'Jollyboat Cottage', slug: 'jollyboat', couple_rate: 135, sort_order: 2, booking_fee: 0 },
    { prop_key: 'pimpernel', name: 'Pimpernel Cottage', slug: 'pimpernel', couple_rate: 155, sort_order: 3, booking_fee: 75 },
// booking_fee IS the refundable deposit (the column was reused for it).
].map((p) => Object.assign({ extra_adult_rate: 40, child_rate: 25, transaction_pct: 3, max_adults: 6, max_children: 2, max_total: 6, min_nights: 2 }, p));
// 4.67 on average, so a two-decimal reader and a one-decimal reader disagree.
const REVIEWS = [
    { prop: '21a', stars: 5, name: 'Ann', text: 'Lovely cottage, spotless.' },
    { prop: '21a', stars: 5, name: 'Bob', text: 'Perfect for the coast path.' },
    { prop: '21a', stars: 4, name: 'Cat', text: 'Cosy and quiet.' },
];

(async () => {
    const { browser, base, done } = await bootBrowser();
    const d = require('./ui-test-lib').d; // the harness's day (today, UK)
    const priced = { agreed_total: 400, agreed_per_night: 133.33, agreed_nights: 3, agreed_nightly: 400, agreed_txn_fee: 0, agreed_txn_pct: 0, agreed_booking_fee: 0 };
    const mk = (pk, i, o, x) => Object.assign({ prop_key: pk, check_in: i, check_out: o, adults: 2, children: 0, id: Math.floor(Math.random() * 1e6) }, priced, x || {});

    const open = async ({ width = 390, guest = null, bookings = [] } = {}) => {
        const page = await browser.newPage({ viewport: { width, height: width < 900 ? 844 : 900 } });
        page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
        await page.addInitScript(() => {
            if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
            try { localStorage.removeItem('chb-exp-saved'); } catch (e) {}
        });
        await page.route(/\.php/, (route) => {
            const url = route.request().url();
            const json = (x, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(x) });
            let body = {};
            try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
            if (url.includes('auth.php')) {
                if (body.action === 'guest_status') return json({ ok: true, guest });
                if (body.action === 'guest_change_password') return json({ ok: true });
                return json({ ok: true, admin: false, guest: null });
            }
            if (url.includes('rates.php')) return json({ properties: PROPS, seasons: {}, occupancy: {} });
            if (url.includes('my-bookings.php')) return json({ ok: true, bookings, enquiries: [], completed_stays: 0 });
            if (url.includes('experiences.php')) return bookings.length
                ? json({ ok: true, experiences: [
                    { id: 11, title: 'Cley Marshes', body: 'Hides over the reedbeds.', category: 'Walks & nature', distance: 'About 6 min drive', mapQuery: 'Cley Marshes' },
                    { id: 12, title: 'Beans Boat Trips', body: 'Out to the seals.', category: 'Boat trips & wildlife', distance: 'About 5 min drive', phone: '01263 740505' },
                ] })
                : json({ error: 'Things to do are for guests who have booked with us.', code: 'stays_only' }, 403);
            if (url.includes('passkeys.php')) return json({ ok: true, passkeys: [] });
            return json({ ok: true, bookings: [], events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], props: {}, mine: {}, value: null });
        });
        await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
        await page.evaluate((r) => { siteContent.reviews = r; }, REVIEWS);
        return page;
    };

    // ------------------------------------------------------------------
    console.log('§1 the waitlist sheet');
    let page = await open();
    await page.evaluate(() => { openProperty('21a'); openWaitlistModal({ prop: '21a' }); });
    await page.waitForTimeout(500);
    const wl = await page.evaluate(() => {
        const named = (id) => { const el = document.getElementById(id); return !!el && !!document.querySelector(`label[for="${id}"]`); };
        const trig = document.getElementById('wl-date-trigger');
        const by = (trig.getAttribute('aria-labelledby') || '').split(/\s+/).map((i) => (document.getElementById(i) || {}).textContent || '').join(' ');
        return {
            prop: named('wl-prop'), name: named('wl-name'), email: named('wl-email'),
            nameAc: document.getElementById('wl-name').getAttribute('autocomplete'),
            dates: by.trim(),
            intro: document.getElementById('wl-intro').textContent,
        };
    });
    ok(wl.prop && wl.name && wl.email, 'the cottage, name and email fields each have a label pointing at them');
    ok(wl.nameAc === 'name', `the name field asks for the saved name (${wl.nameAc})`);
    ok(/^Dates\s+Any dates/.test(wl.dates), `the dates button says what it is and what is picked (${wl.dates})`);
    ok(/when dates open up/.test(wl.intro) && !/these dates/.test(wl.intro), `with no dates it does not talk about "these dates" (${wl.intro})`);
    await page.evaluate(() => {
        document.getElementById('wl-checkin').value = '2027-03-10';
        document.getElementById('wl-checkout').value = '2027-03-13';
        wlRefreshDateTrigger();
    });
    ok(/these dates become available/.test(await page.evaluate(() => document.getElementById('wl-intro').textContent)), 'with dates it does');
    await page.evaluate(() => closeWaitlistModal());
    await page.waitForTimeout(300);

    // ------------------------------------------------------------------
    console.log('§2 the empty price box');
    await page.evaluate(() => { openProperty('jollyboat'); openEnquireModal(); });
    await page.waitForTimeout(500);
    const pbNone = await page.evaluate(() => document.getElementById('enq-price-box').textContent.trim());
    ok(!/£0\.00/.test(pbNone) && !/deposit/i.test(pbNone) && /Select dates to see your full price/.test(pbNone), `a cottage with no deposit says nothing about one (${pbNone})`);
    await page.evaluate(() => { closeEnquireModal(); openProperty('21a'); openEnquireModal(); });
    await page.waitForTimeout(500);
    const pbDep = await page.evaluate(() => document.getElementById('enq-price-box').textContent.trim());
    ok(/Refundable deposit £75\.00 · select dates/.test(pbDep), `one with a deposit still names it (${pbDep})`);
    await page.evaluate(() => closeEnquireModal());
    await page.waitForTimeout(300);

    // ------------------------------------------------------------------
    console.log('§3 the cottage calendar');
    await page.evaluate(() => openProperty('21a'));
    await page.waitForTimeout(600);
    const cal = await page.evaluate(() => {
        const c = document.getElementById('prop-avail-cal').getBoundingClientRect();
        const [p, n] = document.querySelectorAll('.avail-cal-head .avail-nav');
        const t = document.getElementById('avail-cal-title').getBoundingClientRect();
        return { left: Math.round(p.getBoundingClientRect().left - c.left), right: Math.round(c.right - n.getBoundingClientRect().right), mid: Math.round((t.left + t.right) / 2 - (c.left + c.right) / 2) };
    });
    ok(cal.left <= 24 && cal.right <= 24, `‹ and › sit at the card's edges (${cal.left}px / ${cal.right}px in)`);
    ok(Math.abs(cal.mid) <= 8, `the month is centred between them (${cal.mid}px off)`);

    // ------------------------------------------------------------------
    console.log('§4 reviews');
    const rv = await page.evaluate(() => {
        const h = document.querySelector('#prop-reviews h2.prop-section-h');
        const sib = [...document.querySelectorAll('#view-21a h2.prop-section-h')].find((x) => /Where you/.test(x.textContent));
        return {
            h: !!h && h.textContent.trim(),
            same: !!h && !!sib && getComputedStyle(h).fontSize === getComputedStyle(sib).fontSize,
            score: (document.querySelector('#prop-reviews .prop-reviews-score') || {}).textContent || '',
            stat: (document.querySelector('#prop-stats .prop-stat-top') || {}).textContent || '',
            host: (document.getElementById('host-rating') || {}).textContent || '',
        };
    });
    ok(rv.h === 'Guest reviews' && rv.same, `"Guest reviews" is a section h2 at its siblings' size (${rv.h})`);
    ok(rv.score === '★ 4.7' && rv.stat === '4.7', `the stat row and the reviews heading agree at one decimal (${rv.stat} · ${rv.score})`);
    ok(rv.host === '4.7 ★', `the host card is on the stars' scale too, not a percentage (${rv.host})`);
    await page.evaluate(() => openEnquireModal());
    await page.waitForTimeout(400);
    const sumR = await page.evaluate(() => document.getElementById('enq-sum-rating').textContent);
    ok(/^★ 4\.7 · 3 reviews$/.test(sumR), `…and so does the enquiry form's summary (${sumR})`);
    await page.close();

    // ------------------------------------------------------------------
    console.log('§5 the current page');
    page = await open({ width: 1280 });
    await page.evaluate(() => openProperty('21a'));
    await page.waitForTimeout(800);
    const navC = await page.evaluate(() => {
        const cur = [...document.querySelectorAll('header nav ul li a[aria-current="page"]')];
        const ind = document.querySelector('header nav .nav-indicator');
        const a = cur[0];
        return {
            n: cur.length, view: a ? a.dataset.view : '',
            shown: !!ind && ind.classList.contains('show'),
            at: !!a && !!ind && Math.abs(parseFloat(ind.style.left) - a.offsetLeft) < 1 && Math.abs(parseFloat(ind.style.width) - a.offsetWidth) < 1,
        };
    });
    ok(navC.n === 1 && navC.view === 'view-cottages', `a cottage page marks Cottages, and only Cottages (${navC.n}: ${navC.view})`);
    ok(navC.shown && navC.at, 'on a computer the pill rests on it');
    await page.evaluate(() => nav('view-main'));
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.querySelector('header nav a[data-view="view-main"]').getAttribute('aria-current') === 'page' && !document.querySelector('header nav a[data-view="view-cottages"]').hasAttribute('aria-current')), 'moving to Home moves the mark');
    await page.close();
    page = await open({ width: 390 });
    await page.evaluate(() => nav('view-cottages'));
    await page.waitForTimeout(500);
    const dockC = await page.evaluate(() => [...document.querySelectorAll('.guest-dock-btn[aria-current="page"]')].map((b) => b.dataset.tab));
    ok(dockC.length === 1 && dockC[0] === 'cottages', `the phone's menu says which tab is current (${dockC.join(',')})`);
    await page.close();

    // ------------------------------------------------------------------
    console.log('§6 the You pages move focus');
    const guestNoPw = { name: 'Gwen Rowe', email: 'gwen@example.com', phone: '07700 900123', address: '1 Quay Street', postcode: 'NR25 7ND', avatar: '', has_password: false };
    const stays = [mk('21a', d(20), d(23)), mk('pimpernel', d(-30), d(-27))];
    page = await open({ guest: guestNoPw, bookings: stays });
    await page.evaluate(() => guestAccountTab());
    await page.waitForTimeout(500);
    await page.evaluate(() => gaGo('details'));
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('ga-h1') && document.activeElement.textContent === 'Your details'), 'opening Your details lands on its heading');
    await page.click('#guest-account-body .ga-back');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('ga-h1') && /^Hi/.test(document.activeElement.textContent)), '…and the way back lands on the You heading');

    // ------------------------------------------------------------------
    console.log('§7 a password to set, or to change');
    await page.evaluate(() => gaGo('security'));
    await page.waitForTimeout(400);
    const sec = await page.evaluate(() => [...document.querySelectorAll('#guest-account-body .ga-row .ga-t')].map((e) => e.textContent));
    ok(sec.includes('Set a password') && !sec.includes('Change password') && !sec.includes('Email me a reset link'), `no password yet: Set a password, and no reset link for a password that does not exist (${sec.join(' · ')})`);
    await page.evaluate(() => { gaPassword(); });
    await page.waitForSelector('#glass-dialog.open');
    const form = await page.evaluate(() => ({ title: document.getElementById('glass-dialog-title').textContent, fields: [...document.querySelectorAll('#glass-dialog-fields input')].map((i) => i.getAttribute('autocomplete')) }));
    ok(form.title === 'Set a password' && !form.fields.includes('current-password'), `the form asks for no current password (${form.title}: ${form.fields.join(', ')})`);
    // The dialog focuses its first field on a 60ms timer; typed before that fires, the
    // second box's text lands in the first (CI read "Set a password" still showing).
    await page.waitForFunction(() => !!document.activeElement && !!document.activeElement.closest('#glass-dialog-fields'), null, { timeout: 5000 }).catch(() => {});
    await page.fill('#glass-dialog-fields input >> nth=0', 'longenough1');
    await page.fill('#glass-dialog-fields input >> nth=1', 'longenough1');
    await page.click('#glass-dialog-ok');
    await page.waitForFunction(() => [...document.querySelectorAll('#guest-account-body .ga-row .ga-t')].some((e) => e.textContent === 'Change password'), null, { timeout: 8000 }).catch(() => {});
    const sec2 = await page.evaluate(() => [...document.querySelectorAll('#guest-account-body .ga-row .ga-t')].map((e) => e.textContent));
    ok(sec2.includes('Change password') && sec2.includes('Email me a reset link'), `once saved, it is a password to change (${sec2.join(' · ')})`);

    // ------------------------------------------------------------------
    console.log('§8 a stay\'s state capsule');
    await page.evaluate(() => gaOpenStays());
    await page.waitForTimeout(900);
    const caps = await page.evaluate(() => [...document.querySelectorAll('.guest-status-badge')].map((b) => {
        const cs = getComputedStyle(b);
        return { t: b.textContent.trim(), font: cs.fontFamily, bg: cs.backgroundColor, inline: b.getAttribute('style') || '' };
    }));
    const up = caps.find((c) => c.t === 'Upcoming');
    const past = caps.find((c) => c.t === 'Past stay');
    ok(!!up && !!past, `both capsules render (${caps.map((c) => c.t).join(', ')})`);
    ok(caps.every((c) => /Montserrat/.test(c.font) && !/Playfair/.test(c.font)), 'each is set in the sans, not the heading\'s serif');
    ok(caps.every((c) => !c.inline), 'no capsule carries its own inline colours');
    ok(!!past && past.bg !== 'rgba(0, 0, 0, 0)' && !/255, 255, 255, 0\.06/.test(past.bg), `Past has a fill you can see (${past && past.bg})`);

    // ------------------------------------------------------------------
    console.log('§10 Things to do');
    await page.evaluate(() => nav('view-experiences'));
    await page.waitForTimeout(900);
    const chips0 = await page.evaluate(() => [...document.querySelectorAll('#exp-filters .exp-chip')].map((b) => b.dataset.cat));
    ok(chips0.length > 1 && !chips0.includes('saved'), `no "Your list" chip while nothing is saved (${chips0.join(',')})`);
    await page.evaluate(() => expSaveToggle(11));
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => (document.querySelector('#exp-filters [data-cat="saved"] .exp-cc') || {}).textContent === '1'), 'saving one brings it, counting 1');

    // ------------------------------------------------------------------
    console.log('§11 small honest copy');
    await page.evaluate(() => { deleteGuestAccount(); });
    await page.waitForFunction(() => document.getElementById('glass-dialog').classList.contains('open') && document.getElementById('glass-dialog-title').textContent !== 'Set a password', null, { timeout: 5000 }).catch(() => {});
    const del = await page.evaluate(() => ({ t: document.getElementById('glass-dialog-title').textContent, shown: getComputedStyle(document.getElementById('glass-dialog-title')).display !== 'none', msg: document.getElementById('glass-dialog-msg').textContent }));
    ok(del.shown && del.t === 'Delete your account?' && !/^Delete your account/.test(del.msg), `the delete confirm has its title, like Sign out (${del.t})`);
    await page.click('#glass-dialog-cancel');
    await page.waitForTimeout(300);
    await page.close();

    // ------------------------------------------------------------------
    console.log('§9 the chat\'s quick replies');
    page = await open();
    await page.evaluate(() => toggleChat());
    await page.waitForTimeout(800);
    const q = await page.evaluate(() => {
        const row = document.querySelector('.chat-quick');
        const chip = row && row.querySelector('.chat-chip');
        if (!row || !chip) return null;
        return { scroll: row.scrollLeft, gap: Math.round(chip.getBoundingClientRect().left - row.getBoundingClientRect().left) };
    });
    ok(!!q && q.gap >= 12, `the first chip sits inside the row's padding, not on its edge (${q && q.gap}px, scrolled ${q && q.scroll})`);
    await page.close();

    console.log(fails ? `\n${fails} FAILED` : '\nALL GUEST POLISH CHECKS PASSED');
    await done(fails);
})();
