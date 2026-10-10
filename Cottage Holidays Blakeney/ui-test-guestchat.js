// ui-test-guestchat.js — Manage → Guest chat, and what it changes on the guest's chat.
//
// The page is the approved demo, built: the title's pill, "See it as a guest",
// the questions guests asked answered in place, the away reply as sentences, the
// instant answers as rows that say Standard / Your words / Added / Typed only,
// and the reply time in the welcome. Every write goes through the real content
// POST, captured here, so a check on the screen is paired with a check on what
// was saved.
const { bootBrowser } = require('./ui-test-lib');

const PROPS = [
    { prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
    { prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 140, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 2, max_total: 6, sort_order: 2 },
];
const PARK = 'Blakeney has a few car parks; for 21A you can park on the drive.';
// The PUBLIC content (what any visitor's boot GET carries) — the internal keys
// are deliberately absent, as they are in production.
const PUB = {
    'chat-ans-parking': PARK,
    'host-name': 'George',
    'faqs-jollyboat': [{ q: 'Is there a garden?', a: 'Yes' }, { q: 'Dogs?', a: 'No' }],
    'faqs-21a': [{ q: 'Stairs?', a: 'Two flights' }],
};
// The owner's full map (content.php get_all): the away switch is ON here only.
const PRIV = Object.assign({}, PUB, {
    'chat-away-enabled': '1',
    'chat-away-msg': '',
    'chat-away-from': '07',
    'chat-away-to': '22',
    'guest-faq-misses': [
        { q: 'Can we bring our dog?', n: 3, at: '2026-10-08', prop: 'jollyboat' },
        { q: 'Is there a cot for a baby?', n: 1, at: '2026-10-06', prop: '' },
    ],
});

let fails = 0;
const check = (cond, label) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + label);
    if (!cond) fails++;
};

(async () => {
    const t = await bootBrowser();
    const posts = [];
    const route = (page, pub) =>
        page.route(/\.php/, (r) => {
            const url = r.request().url();
            const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
            let b = {};
            try {
                b = JSON.parse(r.request().postData() || '{}');
            } catch (e) {}
            if (url.includes('content.php') && b.action === 'get_all') return json({ content: PRIV });
            if (url.includes('content.php') && b.action === 'set') {
                posts.push(b);
                return json({ ok: true });
            }
            if (url.includes('content.php') || url.includes('bootstrap.php')) return json({ content: pub, rates: { properties: PROPS, seasons: {}, occupancy: {} } });
            if (url.includes('rates.php')) return json({ properties: PROPS, seasons: {}, occupancy: {} });
            if (url.includes('admin_status')) return json({ ok: true, admin: true });
            return json({ ok: true, bookings: [], enquiries: [], threads: [], messages: [], content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, feeds: [], properties: PROPS });
        });
    const last = (key) => {
        const p = posts.filter((x) => x.key === key).pop();
        return p ? p.value : undefined;
    };

    // ---------------- the owner's page ----------------
    const page = await t.browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8000);
    page.on('pageerror', (e) => {
        fails++;
        console.log('PAGEERR', e.message);
    });
    await page.addInitScript(() => {
        if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    });
    await route(page, PUB);
    await page.goto(`${t.base}/index.html`);
    // Let the boot's own session check land first, or it signs the page back out
    // underneath the owner-mode this suite is about to set.
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
        settingsOpen('chat-away');
    });
    await page.waitForSelector('#gc-page .gc-prev');

    console.log('§1 the page states where the chat stands');
    const p1 = await page.evaluate(() => ({
        pill: document.getElementById('settings-panel-cap').textContent.trim(),
        prev: !!document.querySelector('#gc-page [data-act="gcPreview"]'),
        asked: document.querySelectorAll('#gc-page .gc-asked').length,
        awayOn: /** @type {HTMLInputElement} */ (document.getElementById('gc-away-on')).checked,
        foldShown: !document.getElementById('gc-awayf').hidden,
        hours: document.getElementById('gc-hours-v').textContent,
        who: document.getElementById('gc-who').textContent,
        box: /** @type {HTMLTextAreaElement} */ (document.getElementById('gc-a-away')).value,
        caps: [...document.querySelectorAll('#gc-page .gc-ans')].map((g) => g.getAttribute('data-gcq') + ':' + (g.querySelector('.bhub-fold-right .st-cap') || {}).textContent).join(' '),
        parkSub: (document.querySelector('[data-gcq="parking"] .bhub-fold-sub') || {}).textContent || '',
        cots: (document.querySelector('[data-grp="gc-cots"] .bhub-fold-right') || {}).textContent.trim(),
        reply: document.getElementById('gc-reply-v').textContent,
        signer: (document.querySelector('#gc-page .gc-rowbtn .gc-v') && [...document.querySelectorAll('#gc-page .gc-rowbtn .gc-v')].pop().textContent) || '',
        over: document.documentElement.scrollWidth - innerWidth,
    }));
    check(p1.pill === '2 to answer', `the title's pill counts the questions waiting (${p1.pill})`);
    check(p1.prev, '"See it as a guest" is a row on the page');
    check(p1.asked === 2, `both questions guests asked are rows (${p1.asked})`);
    check(p1.awayOn && p1.foldShown, 'the away switch reads the PRIVATE map (on), and its settings are open — the public boot copy has no such key');
    check(p1.hours === '7am – 10pm' && /between 10pm and 7am/.test(p1.who), `the hours are words, and a sentence says who gets the reply (${p1.hours} / ${p1.who})`);
    check(/not at the desk right now/.test(p1.box), 'an empty stored reply shows the standard words it will send');
    check(p1.caps === 'checkin:Standard parking:Your words wifi:Standard', `each answer says whose words it is (${p1.caps})`);
    check(p1.parkSub.indexOf('Blakeney has a few car parks') === 0, 'a changed answer shows the owner’s words, not the standard text');
    check(p1.cots === '3', `the cottages' own questions are counted (${p1.cots})`);
    check(p1.reply === 'Within a few hours' && p1.signer === 'George', `the welcome rows say what the chat says (${p1.reply} / ${p1.signer})`);
    check(p1.over <= 0, `nothing is wider than the phone (${p1.over})`);

    console.log('§2 a question guests asked becomes an instant answer');
    await page.click('[data-grp="gca-0"] .bhub-fold-row');
    await page.fill('#gc-asked-0', 'Yes — dogs are welcome at Jollyboat, up to two.');
    await page.click('#gc-page [data-act="gcAskedSave"][data-args="[0]"]');
    await page.waitForFunction(() => document.getElementById('settings-panel-cap').textContent.trim() === '1 to answer');
    const chips2 = last('chat-chips') || {};
    const ex = (chips2.extra || [])[0] || {};
    check(ex.q === 'Can we bring our dog?' && ex.btn === false && ex.prop === 'jollyboat' && /welcome at Jollyboat/.test(ex.a), `saved as a typed-only answer for Jollyboat (${JSON.stringify(ex).slice(0, 120)})`);
    check((last('guest-faq-misses') || []).length === 1, 'and the question leaves the list');
    const typedRow = await page.evaluate(() => {
        const g = [...document.querySelectorAll('#gc-page .gc-ans')].find((x) => /bring our dog/.test(x.textContent));
        return g ? (g.querySelector('.st-cap') || {}).textContent : '';
    });
    check(typedRow === 'Typed only', `it is one of the instant answers, marked Typed only (${typedRow})`);

    console.log('§3 the standard answer is one tap back');
    await page.click('[data-grp="gcq-parking"] .bhub-fold-row');
    await page.click('#gc-page [data-act="gcAnsStd"][data-args=\'["parking"]\']');
    await page.waitForFunction(() => (document.querySelector('[data-gcq="parking"] .st-cap') || {}).textContent === 'Standard');
    check(last('chat-ans-parking') === '', 'it stores nothing, so the standard keeps following the house copy');
    const parkBox = await page.evaluate(() => /** @type {HTMLTextAreaElement} */ (document.getElementById('gc-a-parking')).value);
    check(/pay-and-display/.test(parkBox), 'and the box shows the standard words again');

    console.log('§4 the hours: both or neither');
    await page.evaluate(() => {
        gcHoursPick();
    });
    await page.waitForSelector('#gdf-from');
    await page.selectOption('#gdf-from', '');
    await page.click('#glass-dialog-ok');
    await page.waitForFunction(() => /both times, or neither/.test(document.getElementById('glass-dialog').textContent));
    check(last('chat-away-from') === undefined, 'half a window is refused before anything is saved');
    await page.selectOption('#gdf-from', '20');
    await page.selectOption('#gdf-to', '01');
    await page.click('#glass-dialog-ok');
    await page.waitForFunction(() => document.getElementById('gc-hours-v').textContent === '8pm – 1am');
    check(last('chat-away-from') === '20' && last('chat-away-to') === '01', 'both ends are saved as the server reads them');
    const who4 = await page.evaluate(() => document.getElementById('gc-who').textContent);
    check(/between 1am and 8pm/.test(who4), `a window past midnight reads the right way round (${who4})`);

    console.log('§5 an empty reply is the standard words');
    await page.fill('#gc-a-away', '');
    await page.evaluate(() => document.getElementById('gc-a-away').dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForFunction(() => /not at the desk/.test(/** @type {HTMLTextAreaElement} */ (document.getElementById('gc-a-away')).value));
    check(last('chat-away-msg') === '', 'clearing the box stores nothing, and the box refills with what will be sent');
    // The box's own words go out as WORDS: an element carries one data-pass, and a
    // second handler on the box once made this save the element itself.
    await page.fill('#gc-a-away', 'Back at 8am — we will reply then.');
    await page.evaluate(() => document.getElementById('gc-a-away').dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForFunction(() => !document.getElementById('gc-away-std').hidden);
    check(last('chat-away-msg') === 'Back at 8am — we will reply then.', `typed words are saved as words (${JSON.stringify(last('chat-away-msg'))})`);
    const grown = await page.evaluate(() => { const b = document.getElementById('gc-a-away'); b.value = 'one\ntwo\nthree\nfour\nfive\nsix'; b.dispatchEvent(new Event('input', { bubbles: true })); return b.scrollHeight <= b.clientHeight + 2; });
    check(grown, 'the box grows to show every line it holds');

    console.log('§6 adding and hiding buttons');
    await page.evaluate(() => {
        gcAddQ();
    });
    await page.waitForSelector('#gdf-chip');
    await page.fill('#gdf-chip', 'Hot tub?');
    await page.fill('#gdf-a', 'No hot tub, sorry — but the sea is free.');
    await page.click('#glass-dialog-ok');
    await page.waitForFunction(() => [...document.querySelectorAll('#gc-page .gc-ans')].some((g) => /Hot tub\?/.test(g.textContent)));
    const added = ((last('chat-chips') || {}).extra || []).find((x) => x.chip === 'Hot tub?');
    check(!!added && added.btn === true && added.prop === '', 'a new question is a button on every cottage');
    await page.click('[data-grp="gcq-wifi"] .bhub-fold-row');
    await page.waitForTimeout(400); // the fold opens on a 0.32s height transition
    await page.evaluate(() => document.querySelector('[data-grp="gcq-wifi"] .chb-switch input').click());
    await page.waitForFunction(() => (document.querySelector('[data-gcq="wifi"] .st-cap') || {}).textContent === 'Typed only');
    check(((last('chat-chips') || {}).hide || []).includes('wifi'), 'switching Wi-Fi off the buttons stores it in hide');

    console.log('§7 the preview is the chat, with these words in it');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#gc-page [data-act="gcPreview"]');
    await page.waitForSelector('#gc-sheet.open #gc-quick .chat-chip');
    const p7 = await page.evaluate(() => ({
        chips: [...document.querySelectorAll('#gc-quick .chat-chip')].map((c) => c.textContent).join('|'),
        hello: (document.querySelector('#gc-thread .chat-hello-when') || {}).textContent || '',
    }));
    check(/Hot tub\?/.test(p7.chips) && !/Wi-Fi\?/.test(p7.chips), `the buttons follow the list (${p7.chips})`);
    check(!/bring our dog/.test(p7.chips), 'a typed-only answer is not a button');
    check(/a few hours/.test(p7.hello), `the welcome says the reply time (${p7.hello})`);
    await page.click('#gc-quick .chat-chip[data-act="gcChip"]');
    await page.waitForFunction(() => !!document.querySelector('#gc-thread .chat-bot'));
    check(true, 'tapping a button answers in the preview');
    await page.click('#gc-sheet .u-seg > button:nth-child(2)');
    const night1 = await page.evaluate(() => document.getElementById('gc-thread').textContent);
    check(/around at this hour/.test(night1), 'at 11:40pm inside 8pm–1am the preview says nothing goes back');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#gc-sheet.open'));
    check(true, 'Escape closes the preview');

    console.log('§8 the switch and the pill');
    await page.click('#gc-page [data-act="gcAskedDismiss"][data-args="[0]"]', { force: true }).catch(() => {});
    await page.evaluate(() => {
        const b = document.querySelector('#gc-page [data-act="gcAskedDismiss"]');
        if (b) b.click();
    });
    await page.waitForFunction(() => document.getElementById('settings-panel-cap').textContent.trim() === 'Away reply on');
    check(true, 'with nothing waiting the pill says the away reply is on');
    await page.evaluate(() => document.getElementById('gc-away-on').click());
    await page.waitForFunction(() => document.getElementById('settings-panel-cap').textContent.trim() === 'Away reply off');
    const off = await page.evaluate(() => document.getElementById('gc-awayf').hidden);
    check(off && last('chat-away-enabled') === '', 'switching it off folds its settings away and stores it');
    await page.close();

    // ---------------- the guest's chat ----------------
    console.log('§9 the guest’s chat follows the owner’s list');
    const gPub = Object.assign({}, PUB, {
        'chat-reply-time': 'day',
        'chat-chips': { hide: ['wifi'], extra: [{ id: 'hot1', q: 'Hot tub?', chip: 'Hot tub?', a: 'No hot tub, sorry.', btn: true, prop: '' }, { id: 'jb1', q: 'Is there a cot?', chip: '', a: 'Yes, a travel cot.', btn: false, prop: 'jollyboat' }] },
    });
    const g = await t.browser.newPage({ viewport: { width: 390, height: 844 } });
    g.setDefaultTimeout(8000);
    g.on('pageerror', (e) => {
        fails++;
        console.log('PAGEERR', e.message);
    });
    await g.addInitScript(() => {
        if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    });
    await route(g, gPub);
    await g.goto(`${t.base}/index.html`);
    await g.waitForTimeout(1200);
    await g.evaluate((c) => Object.assign(siteContent, c), gPub);
    await g.evaluate(() => toggleChat());
    await g.waitForSelector('#chat-widget.open');
    const p9 = await g.evaluate(() => ({
        chips: [...document.querySelectorAll('#chat-quick .chat-chip')].map((c) => c.textContent.trim()).join('|'),
        when: (document.querySelector('#chat-thread .chat-hello-when') || {}).textContent || '',
    }));
    check(p9.chips === 'Check availability|Check-in time?|Parking?|Hot tub?|Report an issue', `the buttons are the owner's list (${p9.chips})`);
    check(/Usually replies the same day/.test(p9.when), `the welcome says the owner's reply time (${p9.when})`);
    await g.click('#chat-quick .chat-chip:has-text("Hot tub?")');
    await g.waitForFunction(() => /No hot tub, sorry/.test(document.getElementById('chat-thread').textContent));
    check(true, 'the owner’s own button answers on the spot');
    const typed = await g.evaluate(() => {
        activeFrontProperty = 'jollyboat';
        const hit = guestFaqAnswer('is there a cot for the baby');
        return hit ? hit.a : '';
    });
    check(/travel cot/.test(typed), `a typed question gets the answer the owner wrote for that cottage (${typed})`);

    await g.close();
    console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL GUEST CHAT CHECKS PASSED');
    await t.done(fails);
})().catch(async (e) => {
    console.error('FAILED:', e);
    process.exit(1);
});
