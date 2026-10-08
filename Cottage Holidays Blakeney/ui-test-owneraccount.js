// THE OWNER'S ACCOUNT (approved demo), in a real browser:
//  §1 Manage carries ONE row with the owner on it, in place of the five account
//     rows and Log out — and it still answers the old words when searched
//  §2 the account page: a hello, three rows that state their facts, the two
//     device switches, and a Log out that asks first
//  §3 the host profile: one fact per row, each saved through a small form that
//     keeps a refusal open; the labelled lines take only the answer; the photo
//     goes through the guest's sheet and cropper
//  §4 notifications: this device, what interrupts you (switches + a quiet-hours
//     form that refuses half a window), who gets emailed
//  §5 sign-in & security: one password form, named passkey removal, the
//     two-step switch on the real toggle (and back to the truth on a failure)
//  §6 navigation: the pages slide the right way, the panel's own back link and
//     title stand down only for these pages, and Back replays
//  §7 the search-first layout hosts the pages in the search sheet
//  §8 Log out, confirmed, signs out
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
const path = require('path');
let fails = 0;
const ok = (b, m) => {
    console.log(`  ${b ? '✓' : '✗'} ${m}`);
    if (!b) fails++;
};

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 390, height: 844 } });
    // A device that has never been asked: what a fresh phone reports, and the state
    // these checks are about. CI's headless browser answers 'denied' instead (measured:
    // "Blocked on this device"), so the permission is pinned rather than inherited.
    await page.addInitScript(() => {
        try {
            Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
        } catch (e) {}
    });
    const posts = [];
    const st = {
        failSet: false, // content.php set answers 500
        pwRefuse: false, // admin_change_password answers 403
        keys: [
            { id: 1, label: 'iPhone', created_at: '2026-03-12 10:00:00' },
            { id: 2, label: 'MacBook Air', created_at: '2026-05-02 10:00:00' },
        ],
        extras: ['bookings@example.com'],
        // The person signed in: George, the first owner. The HOST on the cottage
        // pages is someone else (Sophia) — the account must never confuse the two.
        me: {
            id: 1, name: 'George Farrow', first: 'George', named: true, email: 'george@example.com', contact: 'george@example.com', username: 'george',
            full: true, original: true, caps: {}, photo: '', state: 'active', twofa: true, twofaLive: true,
            notify: { money: true, enquiries: true, messages: true, checkout: true, system: true, quietFrom: '22:00', quietTo: '07:00' },
        },
    };
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (o, code) => route.fulfill({ status: code || 200, contentType: 'application/json', body: JSON.stringify(o) });
        let b = {};
        try {
            b = JSON.parse(route.request().postData() || '{}');
        } catch (e) {}
        const file = url.split('?')[0].split('/').pop();
        if (route.request().method() === 'POST') posts.push({ file, b });
        if (file === 'content.php' && b.action === 'get_all')
            return json({ ok: true, content: { 'notify-prefs': { money: true, enquiries: true, messages: true, checkout: true, system: true, quietFrom: '22:00', quietTo: '07:00' }, 'admin-2fa-enabled': '1' } });
        if (file === 'content.php' && b.action === 'set') return st.failSet ? json({ error: 'Database is down' }, 500) : json({ ok: true });
        if (file === 'upload.php') return json({ ok: true, url: 'crown.png' });
        if (file === 'passkeys.php' && b.action === 'admin_list') return json({ ok: true, passkeys: st.keys });
        if (file === 'passkeys.php' && b.action === 'admin_delete') {
            st.keys = st.keys.filter((k) => String(k.id) !== String(b.id));
            return json({ ok: true });
        }
        if (file === 'auth.php' && b.action === 'admin_change_password')
            return st.pwRefuse ? json({ error: 'Current password is incorrect' }, 403) : json({ ok: true });
        if (file === 'auth.php' && b.action === 'admin_logout') return json({ ok: true });
        // Your own settings now live on your person (people): alerts and two-step.
        if (file === 'auth.php' && b.action === 'admin_notify_set') {
            if (st.failSet) return json({ error: 'Database is down' }, 500);
            st.me = Object.assign({}, st.me, { notify: Object.assign({}, st.me.notify, b.prefs || {}) });
            return json({ ok: true, me: st.me });
        }
        if (file === 'auth.php' && b.action === 'admin_twofa_set') {
            if (st.failSet) return json({ error: 'Database is down' }, 500);
            st.me = Object.assign({}, st.me, { twofa: !!b.on });
            return json({ ok: true, me: st.me });
        }
        if (file === 'auth.php' && b.action === 'admin_status') return json({ admin: true, me: st.me, ownerFirst: 'George' });
        if (file === 'people.php' && b.action === 'list') return json({ ok: true, people: [Object.assign({ you: true }, st.me)] });
        if (file === 'notify-recipients.php') {
            if (b.action === 'add') {
                if (!/@/.test(b.email || '')) return json({ error: "That doesn't look like a valid email address." }, 400);
                st.extras.push(b.email);
            }
            if (b.action === 'remove') st.extras = st.extras.filter((e) => e !== b.email);
            return json({ ok: true, primary: 'sophia@example.com', extras: st.extras, max: 5 });
        }
        if (file === 'rates.php')
            return json({
                properties: [
                    { prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 },
                ],
                seasons: {},
                occupancy: {},
            });
        return json({ ok: true, bookings: [], enquiries: [], threads: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [], reviews: [] });
    });
    const sets = (key) => posts.filter((p) => p.file === 'content.php' && p.b.action === 'set' && p.b.key === key);
    const ownSets = (action) => posts.filter((p) => p.file === 'auth.php' && p.b.action === action);
    const dlgOpen = () => page.evaluate(() => document.getElementById('glass-dialog').classList.contains('open'));
    // A wait that times out is a FAILED CHECK, named for what it waited on — a
    // refusal that never appears must read as that refusal missing, not a crash.
    // It also waits for the dialog's OWN focus (its first field, on a 60ms timer):
    // typing before that lands can have the focus pulled mid-fill on a loaded
    // machine, putting the text in the first field (measured, 3 in 42).
    const waitDlg = async (re) => {
        try {
            await page.waitForFunction(
                (src) => {
                    const o = document.getElementById('glass-dialog');
                    if (!o.classList.contains('open')) return false;
                    if (src && !new RegExp(src).test(document.getElementById('glass-dialog-msg').innerText)) return false;
                    const f = document.querySelector('#glass-dialog-fields input');
                    return document.activeElement === (f || document.getElementById('glass-dialog-ok'));
                },
                re ? re.source : '',
                { timeout: 5000 },
            );
        } catch (e) {
            ok(false, re ? `the dialog says /${re.source}/` : 'the dialog opens');
            throw new Error('stopped at a dialog step');
        }
    };
    const waitShut = async () => {
        try {
            await page.waitForFunction(() => !document.getElementById('glass-dialog').classList.contains('open'), null, { timeout: 5000 });
        } catch (e) {
            ok(false, `the dialog closes (it still says: ${await page.evaluate(() => document.getElementById('glass-dialog-msg').innerText)})`);
            throw new Error('stopped at a dialog step');
        }
    };
    const dlg = () =>
        page.evaluate(() => ({
            title: document.getElementById('glass-dialog-title').textContent,
            msg: document.getElementById('glass-dialog-msg').innerText,
            ok: document.getElementById('glass-dialog-ok').textContent,
            danger: document.getElementById('glass-dialog-ok').classList.contains('is-danger'),
            fields: [...document.querySelectorAll('#glass-dialog-fields input, #glass-dialog-fields select, #glass-dialog-fields textarea')].map((e) => ({ id: e.id, type: e.type, value: e.value })),
        }));
    const rowByTitle = (scope, t) => `${scope} .ga-row:has(.ga-t:text-is("${t}"))`;
    const shown = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);

    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
        document.body.classList.remove('light-mode');
        isAuthenticated = true;
        document.body.classList.add('owner-mode');
        siteContent['contact-phone'] = { dial: '+441263740512', display: '01263 740512' };
    });
    await page.evaluate((me) => chbSetMe(me, 'George'), st.me);
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(700);
    await page.evaluate(async () => {
        await openArea();
    });
    await page.waitForTimeout(800);

    console.log('§1 Manage: one row with the owner on it');
    const idx = await page.evaluate(() => {
        const r = document.getElementById('oa-index-row');
        return {
            row: !!r,
            name: (document.getElementById('oa-index-name') || {}).textContent,
            ini: ((r && r.querySelector('.oa-ic .ga-ava')) || {}).textContent,
            sub: ((r && r.querySelector('.settings-row-sub')) || {}).textContent,
            gone: ['[data-arg="host"]', '[data-arg="notify"]', '[data-arg="security"]', '[data-act="toggleTheme"]', '[data-act="toggleBackofficeMode"]', '[data-act="logoutStaff"]'].filter((s) => document.querySelector('#settings-index ' + s)),
        };
    });
    ok(idx.row && idx.name === 'George Farrow' && idx.ini === 'G', `the row names the PERSON signed in, never the host, and wears their initial (${idx.name} / ${idx.ini})`);
    ok(/Your details, notifications & sign-in/.test(idx.sub || ''), 'its sub says what is inside');
    ok(idx.gone.length === 0, `the five old rows and Log out are gone from the index (${idx.gone.join(', ') || 'none left'})`);
    for (const q of ['password', 'dark mode', 'log out', 'notifications']) {
        const hit = await page.evaluate((x) => {
            settingsFilter(x);
            const r = document.getElementById('oa-index-row');
            const vis = r.style.display !== 'none' && r.getClientRects().length > 0;
            settingsFilter('');
            return vis;
        }, q);
        ok(hit, `searching Manage for "${q}" still finds it`);
    }
    await page.click('#oa-index-row');
    await page.waitForTimeout(500);
    const acct = await page.evaluate(() => {
        const panel = document.getElementById('settings-panel');
        const pg = document.querySelector('#acct-body .ga-page');
        return {
            onAcct: getComputedStyle(document.getElementById('sec-acct')).display !== 'none',
            h1: (document.querySelector('#acct-body h1') || {}).textContent,
            lead: (document.querySelector('#acct-body .ga-hello .ga-lead') || {}).textContent,
            slide: !!pg && pg.classList.contains('ga-in'),
            panelBack: document.getElementById('settings-back').getClientRects().length,
            panelTitle: document.getElementById('settings-panel-title').getClientRects().length,
            isOa: panel.classList.contains('is-oa'),
        };
    });
    ok(acct.onAcct && acct.h1 === 'Hi, George' && acct.lead === 'Owner · full access', `it opens the account page: "${acct.h1}" over what they are to the back office (${acct.lead})`);
    ok(acct.slide, 'the page slides in, the way the guest account does');
    ok(acct.isOa && acct.panelBack === 0 && acct.panelTitle === 0, "the panel's own back link and title stand down (the page carries its own)");

    console.log('§2 the account page');
    await page.waitForTimeout(400);
    const rows = await page.evaluate(() => {
        const s = (cls) => ((document.querySelector(`#acct-body .${cls} .ga-s`) || {}).textContent || '');
        return {
            titles: [...document.querySelectorAll('#acct-body .ga-group:first-of-type .ga-t')].map((e) => e.textContent),
            notify: s('oa-r-notify'),
            sec: s('oa-r-security'),
            caps: [...document.querySelectorAll('#acct-body .ga-cap')].map((e) => e.textContent),
            dark: document.getElementById('oa-dark').checked,
            search: document.getElementById('oa-search').checked,
            logout: [...document.querySelectorAll('#acct-body .ga-signout .ga-t')].map((e) => e.textContent).join(),
        };
    });
    ok(rows.caps.join(' | ') === 'Account | The business | On this device', `three groups, captioned (${rows.caps.join(' | ')})`);
    const accTitles = await page.evaluate(() => [...[...document.querySelectorAll('#acct-body .ga-group')][0].querySelectorAll('.ga-t')].map((e) => e.textContent));
    ok(accTitles.join() === 'Your details,Notifications,Sign-in & security', `the account group is yours: details, alerts, sign-in (${accTitles.join(' · ')})`);
    ok(await page.evaluate(() => [...document.querySelectorAll('#acct-body .ga-group')][1].textContent.includes('Host profile') && [...document.querySelectorAll('#acct-body .ga-group')][1].textContent.includes('People & access')), 'the business group holds the host card and People & access');
    ok(/Off on this device · quiet 22:00–07:00/.test(rows.notify), `Notifications states this device and the quiet hours (${rows.notify})`);
    ok(rows.sec === 'Password, 2 passkeys, two-step on', `Sign-in & security counts the passkeys and reads two-step from YOUR own setting (${rows.sec})`);
    ok(rows.dark === true && rows.search === false, 'the switches show the truth: dark on, search-first off');
    ok(rows.logout === 'Log out', 'Log out is its own group at the foot');
    await page.click('#acct-body .oa-swrow:has(#oa-dark) .chb-switch');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.body.classList.contains('light-mode')), 'turning Dark mode off switches to light');
    await page.evaluate(() => toggleTheme());
    ok(await page.evaluate(() => document.getElementById('oa-dark').checked === true), '…and the switch follows a theme change made anywhere else');
    await page.click('#acct-body .oa-swrow:has(#oa-search) .chb-switch');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.body.classList.contains('search-first') && localStorage.getItem('chb-bo-mode') === 'search'), 'Search-first layout turns on, and is remembered on this device');
    await page.evaluate(() => setBackofficeMode('classic'));
    ok(await page.evaluate(() => document.getElementById('oa-search').checked === false), '…and the switch follows the layout set elsewhere');
    const before = posts.length;
    await page.click(rowByTitle('#acct-body', 'Log out'));
    await waitDlg();
    const lo = await dlg();
    ok(lo.title === 'Log out?' && lo.ok === 'Log out', `Log out asks first (${lo.title} / ${lo.ok})`);
    await page.click('#glass-dialog-cancel');
    await waitShut();
    await page.waitForTimeout(200);
    ok(!posts.slice(before).some((p) => p.b.action === 'admin_logout'), 'backing out signs nobody out');

    console.log('§3 the host profile');
    await page.click(rowByTitle('#acct-body', 'Host profile'));
    await page.waitForTimeout(500);
    const hp = await page.evaluate(() => {
        const sub = (t) => {
            const r = [...document.querySelectorAll('#host-body .ga-row')].find((x) => (x.querySelector('.ga-t') || {}).textContent === t);
            return r ? (r.querySelector('.ga-s') || r.querySelector('.ga-v') || {}).textContent : null;
        };
        const nm = document.querySelector('#host-body .oa-preview .host-name');
        const ownerFont = getComputedStyle(document.querySelector('#host-body h1')).fontFamily;
        return {
            slide: !!document.querySelector('#host-body .ga-page.ga-in'),
            studied: sub('Where I studied'),
            work: sub('My work'),
            bioClamp: getComputedStyle(document.querySelector('#host-body .oa-clamp .ga-s')).webkitLineClamp,
            reviews: (document.querySelector('#host-body .oa-figs') || {}).textContent,
            phone: [...document.querySelectorAll('#host-body .ga-row')].map((r) => r.textContent).find((t) => /Dials/.test(t)) || '',
            cardFont: nm ? getComputedStyle(nm).fontFamily : '',
            ownerFont,
            cardLine: (document.querySelector('#host-body .oa-preview .host-line span') || {}).textContent,
            ids: document.querySelectorAll('#host-body .oa-preview [id]').length,
        };
    });
    ok(hp.slide, 'the page slides in going deeper');
    ok(hp.studied === 'North Norfolk' && hp.work === 'holiday accommodation', `the labelled lines show only the answer (${hp.studied} / ${hp.work})`);
    ok(hp.bioClamp === '2', 'the bio row shows two lines of it');
    ok(/01263 740512/.test(hp.phone) && /Dials \+44 1263 740512/.test(hp.phone), `the phone row says what guests see and what is dialled (${hp.phone.trim()})`);
    ok(/Playfair/.test(hp.cardFont) && !/Playfair/.test(hp.ownerFont), `the guests' card keeps the guest site's serif while the back office stays sans (${hp.cardFont.split(',')[0]})`);
    ok(hp.cardLine === 'Where I studied: North Norfolk', `…and prints the line the way guests read it (${hp.cardLine})`);
    ok(hp.ids === 0, 'the preview carries no ids (the cottage page owns those)');

    // Name: an empty name is refused in place, then saved.
    await page.click(rowByTitle('#host-body', 'Name'));
    await waitDlg();
    let f = await dlg();
    ok(f.title === 'Host name' && f.ok === 'Save' && f.fields.length === 1 && f.fields[0].value === 'Sophia', `one fact, one form, prefilled (${f.title}: ${f.fields.map((x) => x.value)})`);
    await page.fill('#gdf-v', '   ');
    await page.click('#glass-dialog-ok');
    await waitDlg(/Enter the name guests see/);
    ok(!sets('host-name').length, 'an empty name is refused before anything is sent, and the form stays open');
    await page.fill('#gdf-v', 'Sophia Farrow');
    await page.click('#glass-dialog-ok');
    await waitShut();
    await page.waitForTimeout(300);
    const nm = await page.evaluate(() => ({
        row: [...document.querySelectorAll('#host-body .ga-row')].some((r) => /Sophia Farrow/.test(r.textContent)),
        card: (document.querySelector('#host-body .oa-preview .host-name') || {}).textContent,
        index: (document.getElementById('oa-index-name') || {}).textContent,
        hello: (document.querySelector('#acct-body h1') || {}).textContent,
        mirror: siteContent['host-name'],
        flash: !!document.querySelector('#host-body .oa-preview .host-card.oa-flash'),
    }));
    ok(sets('host-name').length === 1 && sets('host-name')[0].b.value === 'Sophia Farrow', 'Save posts the one fact');
    ok(nm.row && nm.card === 'Sophia Farrow' && nm.mirror === 'Sophia Farrow', 'the row, the guests\' card and the site mirror all follow');
    ok(nm.index === 'George Farrow' && nm.hello === 'Hi, George', `…while YOUR name stays yours: the Manage row and the hello are George's (${nm.index} / ${nm.hello})`);
    ok(nm.flash, 'the card says it changed, once');

    // Where I studied: the answer goes in, the label goes back on.
    await page.click(rowByTitle('#host-body', 'Where I studied'));
    await waitDlg();
    f = await dlg();
    ok(f.fields[0].value === 'North Norfolk', `the form takes only the answer (${f.fields[0].value})`);
    await page.fill('#gdf-v', 'Cambridge');
    await page.click('#glass-dialog-ok');
    await waitShut();
    await page.waitForTimeout(300);
    const sch = sets('host-school');
    ok(sch.length === 1 && sch[0].b.value === 'Where I studied: Cambridge', `the label goes back on when it saves (${sch[0] && sch[0].b.value})`);
    ok(
        await page.evaluate(() => (document.querySelector('#host-body .oa-preview .host-line span') || {}).textContent === 'Where I studied: Cambridge'),
        '…so guests still read "Where I studied: Cambridge"',
    );

    // A save the server refuses: the form stays open, the mirror never adopts it.
    st.failSet = true;
    await page.click(rowByTitle('#host-body', 'Hosting for'));
    await waitDlg();
    await page.fill('#gdf-v', '12 years');
    await page.click('#glass-dialog-ok');
    // saveContent's own alert comes first; then the form returns, saying so.
    await waitDlg(/Database is down|Couldn/);
    await page.click('#glass-dialog-ok');
    await waitDlg(/Not saved/);
    f = await dlg();
    const yrs = await page.evaluate(() => siteContent['host-years']);
    ok(f.fields[0].value === '12 years', 'a refused save keeps the form open with what was typed');
    ok(yrs !== '12 years', `…and the cottage page never adopts the refused value (${yrs})`);
    st.failSet = false;
    await page.click('#glass-dialog-cancel');
    await waitShut();

    // The phone: a bad number is refused; a good one saves both halves.
    await page.click('#host-body .ga-row:has(.ga-s:text-matches("Dials"))');
    await waitDlg();
    f = await dlg();
    ok(f.title === 'Call to discuss' && f.fields.map((x) => x.id).join() === 'gdf-dial,gdf-display', `the phone is one form, two fields (${f.fields.map((x) => x.value).join(' / ')})`);
    await page.fill('#gdf-dial', 'call me');
    await page.click('#glass-dialog-ok');
    await waitDlg(/full number/);
    ok(!sets('contact-phone').length, 'a number that is not a number is refused in place');
    await page.fill('#gdf-dial', '+44 1263 740599');
    await page.fill('#gdf-display', '01263 740599');
    await page.click('#glass-dialog-ok');
    await waitShut();
    await page.waitForTimeout(300);
    const ph = sets('contact-phone');
    ok(ph.length === 1 && ph[0].b.value.dial === '+441263740599' && ph[0].b.value.display === '01263 740599', 'a good number saves what is dialled and what guests see');
    ok(await page.evaluate(() => [...document.querySelectorAll('#host-body .ga-row')].some((r) => /01263 740599/.test(r.textContent))), '…and the row says so');

    // The photo: the guest's sheet, then the cropper, then a site upload.
    await page.click('#host-body .ga-photolink');
    await page.waitForSelector('#ga-photo-sheet.open');
    let sheet = await page.evaluate(() => [...document.querySelectorAll('#ga-photo-sheet .ga-t')].map((e) => e.textContent));
    ok(sheet.join() === 'Take a photo,Choose from library', `the sheet offers take / choose, and no remove yet (${sheet.join(' · ')})`);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#ga-photo-sheet .ga-row:has(.ga-t:text-is("Choose from library"))')]);
    await chooser.setFiles(path.join(__dirname, 'crown.png'));
    await page.waitForSelector('#ga-crop.open');
    await page.click('#ga-crop .is-done');
    await page.waitForFunction(() => !document.getElementById('ga-crop').classList.contains('open'), null, { timeout: 5000 });
    await page.waitForTimeout(300);
    const up = posts.filter((p) => p.file === 'upload.php');
    const photo = await page.evaluate(() => ({
        mirror: siteContent['host-photo'],
        rowImg: (document.querySelector('#host-body .ga-hero .ga-ava img') || { getAttribute: () => '' }).getAttribute('src'),
        idxImg: (document.querySelector('#oa-index-row .ga-ava img') || { getAttribute: () => '' }).getAttribute('src'),
        card: (document.querySelector('#host-body .oa-preview .host-photo') || { style: {} }).style.backgroundImage,
        link: (document.querySelector('#host-body .ga-photolink') || {}).textContent,
    }));
    photo.guestUntouched = !posts.some((p) => p.b.action === 'guest_avatar_set');
    ok(up.length === 1, 'Use photo uploads the cropped square as a site image');
    ok(sets('host-photo').length === 1 && sets('host-photo')[0].b.value === 'crown.png' && photo.mirror === 'crown.png', 'and saves it as the host photo');
    ok(photo.guestUntouched, '…never as a guest avatar (the cropper took the caller\'s destination)');
    ok(photo.rowImg === 'crown.png' && /crown\.png/.test(photo.card), 'the host photo shows on the host page and the guests\' card');
    ok(photo.idxImg === '', '…and never as YOUR photo on the Manage row (that is your own)');
    ok(photo.link === 'Change photo', 'the link now changes it');
    await page.click('#host-body .ga-photolink');
    await page.waitForSelector('#ga-photo-sheet.open');
    sheet = await page.evaluate(() => [...document.querySelectorAll('#ga-photo-sheet .ga-t')].map((e) => e.textContent));
    ok(sheet.includes('Remove photo'), 'with a photo, the sheet offers to remove it');
    await page.click('#ga-photo-sheet .ga-row:has(.ga-t:text-is("Remove photo"))');
    await page.waitForTimeout(500);
    ok(sets('host-photo').length === 2 && sets('host-photo')[1].b.value === '' && (await page.evaluate(() => (document.querySelector('#host-body .ga-hero .ga-ava') || {}).textContent === 'S')), 'Remove clears it and the initial comes back');

    console.log('§4 notifications');
    await page.click('#host-body .oa-back');
    await page.waitForTimeout(400);
    await page.click(rowByTitle('#acct-body', 'Notifications'));
    await page.waitForTimeout(600);
    const nf = await page.evaluate(() => ({
        device: [...document.querySelectorAll('#notify-device .ga-t')].map((e) => e.textContent),
        switches: document.querySelectorAll('#notify-prefs-body .ga-row .chb-switch input').length,
        on: [...document.querySelectorAll('#notify-prefs-body .chb-switch input')].every((i) => i.checked),
        cats: NOTIFY_CATS.length,
        quiet: ((document.querySelector('#notify-prefs-body [data-act="oaQuiet"] .ga-s') || {}).textContent || ''),
        emails: [...document.querySelectorAll('#notify-emails-list .ga-t')].map((e) => e.textContent),
        lock: !!document.querySelector('#notify-emails-list .ga-lock'),
    }));
    ok(nf.device.join() === 'Turn on alerts for this device,Send a test alert', `this device: turn it on, or test (${nf.device.join(' · ')})`);
    ok(nf.switches === nf.cats && nf.on, `every kind of alert is a switch, showing the saved settings (${nf.switches}/${nf.cats})`);
    ok(nf.quiet === 'Nothing buzzes from 22:00 to 07:00', `quiet hours read as a sentence (${nf.quiet})`);
    ok(nf.emails.join() === 'sophia@example.com,bookings@example.com,Add someone' && nf.lock, 'emailed to: the owner address locked, the extra removable, then Add someone');
    await page.click('#notify-prefs-body .ga-row:nth-child(2) .chb-switch');
    await page.waitForTimeout(300);
    const np = ownSets('admin_notify_set');
    ok(np.length === 1 && np[0].b.prefs.enquiries === false && np[0].b.prefs.money === true && np[0].b.prefs.quietFrom === '22:00', 'one switch saves YOUR whole set with that one change');
    ok(!sets('notify-prefs').length, '…on your own sign-in, never the old shared setting');
    await page.click('#notify-prefs-body [data-act="oaQuiet"]');
    await waitDlg();
    f = await dlg();
    ok(f.title === 'Quiet hours' && f.fields.map((x) => x.value).join() === '22:00,07:00', `quiet hours is a small form, prefilled (${f.fields.map((x) => x.value).join('–')})`);
    await page.selectOption('#gdf-to', '');
    await page.click('#glass-dialog-ok');
    await waitDlg(/both times/);
    ok(ownSets('admin_notify_set').length === 1, 'half a window is refused before anything is sent');
    await page.selectOption('#gdf-to', '22:00');
    await page.click('#glass-dialog-ok');
    await waitDlg(/two different times/);
    await page.selectOption('#gdf-from', '21:00');
    await page.selectOption('#gdf-to', '08:00');
    await page.click('#glass-dialog-ok');
    await waitShut();
    await page.waitForTimeout(300);
    const nq = ownSets('admin_notify_set');
    ok(nq.length === 2 && nq[1].b.prefs.quietFrom === '21:00' && nq[1].b.prefs.quietTo === '08:00' && nq[1].b.prefs.enquiries === false, 'both ends save together, keeping the switch changed earlier');
    ok(
        await page.evaluate(() => /21:00 to 08:00/.test(document.querySelector('#notify-prefs-body [data-act="oaQuiet"] .ga-s').textContent) && /quiet 21:00–08:00/.test(document.querySelector('#acct-body .oa-r-notify .ga-s').textContent)),
        '…and the row and the account page say the new window',
    );
    await page.click(rowByTitle('#notify-emails-list', 'Add someone'));
    await waitDlg();
    await page.fill('#gdf-email', 'not-an-address');
    await page.click('#glass-dialog-ok');
    await waitDlg(/valid email/);
    ok((await dlg()).fields[0].value === 'not-an-address', "the server's refusal keeps the form open, in its own words");
    await page.fill('#gdf-email', 'co@example.com');
    await page.click('#glass-dialog-ok');
    await waitShut();
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => [...document.querySelectorAll('#notify-emails-list .ga-t')].some((e) => e.textContent === 'co@example.com')), 'a good address joins the list');
    await page.click('#notify-emails-list .ga-row:has(.ga-t:text-is("co@example.com"))');
    await waitDlg();
    const rm = await dlg();
    ok(rm.title === 'Remove this address?' && rm.danger && /co@example\.com will stop/.test(rm.msg), 'removing one asks, names it, and wears the destructive style');
    await page.click('#glass-dialog-ok');
    await waitShut();
    await page.waitForTimeout(400);
    ok(posts.some((p) => p.file === 'notify-recipients.php' && p.b.action === 'remove' && p.b.email === 'co@example.com'), '…then removes it');

    console.log('§5 sign-in & security');
    await page.click('#notify-body .oa-back');
    await page.waitForTimeout(400);
    await page.click(rowByTitle('#acct-body', 'Sign-in & security'));
    await page.waitForTimeout(600);
    const sec = await page.evaluate(() => ({
        keys: [...document.querySelectorAll('#admin-passkey-list .ga-t')].map((e) => e.textContent),
        twofa: (document.querySelector('#security-body .chb-switch #admin-2fa-toggle') || {}).checked,
    }));
    ok(sec.keys.join() === 'iPhone,MacBook Air,Add another passkey', `each passkey is a row, then add another (${sec.keys.join(' · ')})`);
    ok(sec.twofa === true, 'two-step is the switch on the real toggle, ON from your own setting');
    await page.click(rowByTitle('#security-body', 'Change password'));
    await waitDlg();
    f = await dlg();
    ok(f.title === 'Change password' && f.fields.length === 3 && f.fields.every((x) => x.type === 'password'), 'changing the password is ONE form of three password fields');
    await page.fill('#gdf-current', 'old-password-here');
    await page.fill('#gdf-next', 'short');
    await page.fill('#gdf-confirm', 'short');
    await page.click('#glass-dialog-ok');
    await waitDlg(/at least 12/);
    await page.fill('#gdf-next', 'a-much-longer-password');
    await page.fill('#gdf-confirm', 'a-different-password!');
    await page.click('#glass-dialog-ok');
    await waitDlg(/don.t match/);
    ok(!posts.some((p) => p.b.action === 'admin_change_password'), 'too short and mismatched are refused before anything is sent');
    f = await dlg();
    ok(f.fields[0].value === 'old-password-here', '…keeping what was typed, so one box gets fixed, not three');
    st.pwRefuse = true;
    await page.fill('#gdf-confirm', 'a-much-longer-password');
    await page.click('#glass-dialog-ok');
    await waitDlg(/Current password is incorrect/);
    f = await dlg();
    ok(f.fields[1].value === 'a-much-longer-password' && f.fields[2].value === 'a-much-longer-password', "the server's refusal keeps the form open, in its own words");
    st.pwRefuse = false;
    await page.click('#glass-dialog-ok');
    await waitShut();
    await page.waitForTimeout(300);
    const pw = posts.filter((p) => p.b.action === 'admin_change_password');
    ok(pw.length === 2 && pw[1].b.current === 'old-password-here' && pw[1].b.next === 'a-much-longer-password', 'the accepted change posts the current and the new password');
    await page.click('#admin-passkey-list .ga-row:has(.ga-t:text-is("MacBook Air"))');
    await waitDlg();
    const pk = await dlg();
    ok(pk.title === 'Remove “MacBook Air”?' && pk.ok === 'Remove the passkey' && pk.danger, `removing a passkey names it (${pk.title})`);
    await page.click('#glass-dialog-ok');
    await waitShut();
    await page.waitForTimeout(500);
    ok(posts.some((p) => p.b.action === 'admin_delete' && String(p.b.id) === '2'), 'and removes that one');
    ok(
        await page.evaluate(() => [...document.querySelectorAll('#admin-passkey-list .ga-t')].map((e) => e.textContent).join() === 'iPhone,Add another passkey' && /1 passkey,/.test(document.querySelector('#acct-body .oa-r-security .ga-s').textContent)),
        'the list and the account row both follow',
    );
    st.failSet = true;
    await page.click('#security-body .oa-swrow .chb-switch');
    await waitDlg(/Database is down|Couldn/);
    await page.click('#glass-dialog-ok');
    await waitShut();
    ok(await page.evaluate(() => document.getElementById('admin-2fa-toggle').checked === true), 'a refused two-step change puts the switch back to the truth');
    st.failSet = false;
    await page.click('#security-body .oa-swrow .chb-switch');
    await page.waitForTimeout(300);
    const tf = ownSets('admin_twofa_set');
    ok(tf.length === 2 && tf[1].b.on === false && !sets('admin-2fa-enabled').length && (await page.evaluate(() => !/two-step on/.test(document.querySelector('#acct-body .oa-r-security .ga-s').textContent))), 'turning it off saves YOUR setting, and the account row stops saying "two-step on"');

    console.log('§6 navigation');
    await page.click('#security-body .oa-back');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !!document.querySelector('#acct-body .ga-page.ga-in-back')), 'coming out slides back');
    await page.click(rowByTitle('#acct-body', 'Host profile'));
    await page.waitForTimeout(400);
    await page.evaluate(() => history.back());
    await page.waitForTimeout(500);
    ok(await shown('#sec-acct'), 'the browser\'s Back walks out to the account page');
    await page.click('#acct-body .oa-back');
    await page.waitForTimeout(400);
    const out = await page.evaluate(() => ({
        index: getComputedStyle(document.getElementById('settings-index')).display !== 'none',
        isOa: document.getElementById('settings-panel').classList.contains('is-oa'),
    }));
    ok(out.index && !out.isOa, "the account's back link returns to the Manage index");
    await page.evaluate(() => settingsOpen('reviews'));
    await page.waitForTimeout(300);
    ok((await shown('#settings-back')) && (await shown('#settings-panel-title')), "every other section keeps the panel's own back link and title");
    await page.evaluate(() => settingsShowIndex());
    // The search's inline Host bio editor must not say "Saved ✓" over a refusal.
    st.failSet = true;
    const bio = await page.evaluate(async () => {
        const fld = cmdkFields('host bio').find((x) => x.id === 'fld-host-bio');
        try {
            await fld.set('A bio that will not save.');
            return 'resolved';
        } catch (e) {
            return 'threw';
        }
    });
    await waitDlg(/Database is down|Couldn/);
    await page.click('#glass-dialog-ok');
    await waitShut();
    st.failSet = false;
    ok(bio === 'threw', "the search's Host bio editor hears a refused save (it reported \"Saved ✓\" before)");

    console.log('§7 the search-first layout');
    await page.evaluate(() => {
        setBackofficeMode('search');
        openCmdK();
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => cmdkOpenSection('acct'));
    await page.waitForTimeout(500);
    const sh = await page.evaluate(() => ({
        hosted: !!document.querySelector('#cmdk-sheet-host #sec-acct'),
        backHidden: document.querySelector('#cmdk-sheet-host #sec-acct .oa-back').getClientRects().length === 0,
    }));
    ok(sh.hosted && sh.backHidden, "the account page opens inside the search sheet, whose own Back is the way out");
    await page.click('#cmdk-sheet-host .ga-row:has(.ga-t:text-is("Host profile"))');
    await page.waitForTimeout(500);
    const sh2 = await page.evaluate(() => ({
        hosted: !!document.querySelector('#cmdk-sheet-host #sec-host'),
        acctHome: !!document.querySelector('#settings-panel #sec-acct'),
        back: document.querySelector('#cmdk-sheet-host #sec-host .oa-back').getClientRects().length > 0,
    }));
    ok(sh2.hosted && sh2.acctHome && sh2.back, 'Host profile replaces it inside the sheet, with a way back to the account');
    await page.click('#cmdk-sheet-host #sec-host .oa-back');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => !!document.querySelector('#cmdk-sheet-host #sec-acct') && !!document.querySelector('#settings-panel #sec-host')), '…and back again, every node returned to its place');
    await page.evaluate(() => {
        cmdkSheetClose();
        closeCmdK();
        setBackofficeMode('classic');
    });
    await page.waitForTimeout(300);

    console.log('§8 Log out, confirmed');
    await page.evaluate(() => settingsOpen('acct'));
    await page.waitForTimeout(400);
    await page.click(rowByTitle('#acct-body', 'Log out'));
    await waitDlg();
    const nav = page.waitForEvent('framenavigated', { timeout: 8000 }).catch(() => null);
    await page.click('#glass-dialog-ok');
    await page.waitForTimeout(400);
    ok(posts.some((p) => p.b.action === 'admin_logout'), 'confirming signs out on the server');
    if (await dlgOpen()) await page.click('#glass-dialog-ok'); // "You have been securely logged out."
    ok(!!(await nav), '…and the page starts again from nothing');

    console.log(fails ? `\n${fails} check(s) failed` : '\nALL CHECKS PASSED');
    await done(fails);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
