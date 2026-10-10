// DEVICES (approved demo), in a real browser:
//  §1 Sign-in & security lists every device you're signed in on: this one first,
//     marked, each saying when it was last used, and "Sign out of all other devices"
//  §2 a device's sheet: when and how it signed in, two-step, alerts; the sign-out
//     button at text size; it rises from the bottom on a phone; Escape and Back close it
//  §3 signing one device out asks first, naming it; backing out sends nothing;
//     confirming posts it and the row goes
//  §4 this device's sheet offers Log out, never a sign-out from here
//  §5 signing out of all other devices: one ask, counted; the note that follows
//  §6 a list that may not be complete yet keeps the way out on offer and says why
//  §7 a Super User on someone's page: their devices, and signing them out everywhere
//  §8 the new-sign-in alert's link opens the device; one already gone says so
//  §9 a list that couldn't load says so and tries again; an answer with no list
//     is never "Not signed in anywhere"; a device signed out from elsewhere is
//     told why; the page names itself for the server's label
//  §10 "last active yesterday" holds across the night the clocks go forward
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => {
    console.log(`  ${b ? '✓' : '✗'} ${m}`);
    if (!b) fails++;
};

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 390, height: 844 } });
    const ago = (mins) => {
        const t = new Date(Date.now() - mins * 60000);
        const p = (n) => String(n).padStart(2, '0');
        return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:00`;
    };
    const posts = [];
    const fresh = () => ({
        0: [
            { id: 11, label: 'iPhone · App', kind: 'phone', here: true, seen: ago(0), since: '2026-10-08 08:02:00', earlier: false, how: 'Passkey', trusted: true, alerts: true },
            { id: 12, label: 'Mac · Chrome', kind: 'laptop', here: false, seen: ago(120), since: '2026-10-03 09:14:00', earlier: false, how: 'Emailed code', trusted: true, alerts: true },
            { id: 13, label: 'iPad · Safari', kind: 'tablet', here: false, seen: ago(60 * 24 * 21), since: '2026-09-13 17:40:00', earlier: true, how: 'Not recorded', trusted: false, alerts: false },
        ],
        2: [
            { id: 21, label: 'iPhone · Safari', kind: 'phone', here: false, seen: ago(12), since: '2026-10-07 07:55:00', earlier: false, how: 'Emailed code', trusted: true, alerts: true },
            { id: 22, label: 'Mac · Safari', kind: 'laptop', here: false, seen: ago(60 * 26), since: '2026-10-02 20:31:00', earlier: false, how: 'Password and emailed code', trusted: false, alerts: false },
        ],
    });
    const st = { devs: fresh(), partial: false, failList: false, noList: false };
    const me = {
        id: 1, name: 'George Farrow', first: 'George', named: true, email: 'george@example.com', contact: 'george@example.com', username: 'george',
        full: true, original: true, caps: {}, photo: '', state: 'active', twofa: true, twofaLive: true, notify: {},
    };
    const ivy = { id: 2, name: 'Ivy Holt', first: 'Ivy', username: 'ivy', contact: 'ivy@example.com', full: false, state: 'active', you: false, perms: {}, changes: 0, passkeys: 0, seen: ago(12), mail: {}, mailCan: {} };
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (o, code) => route.fulfill({ status: code || 200, contentType: 'application/json', body: JSON.stringify(o) });
        let b = {};
        try {
            b = JSON.parse(route.request().postData() || '{}');
        } catch (e) {}
        const file = url.split('?')[0].split('/').pop();
        if (route.request().method() === 'POST') posts.push({ file, b });
        if (file === 'devices.php') {
            const k = Number(b.id) || 0;
            const answer = (extra) => json(Object.assign({ ok: true, id: k || 1, devices: st.devs[k] || [], twofa: true, began: '2026-10-10', partial: st.partial }, extra || {}));
            if (b.action === 'list') return st.failList ? json({ error: 'Couldn’t reach the server' }, 500) : st.noList ? json({ ok: true }) : answer();
            if (b.action === 'sign_out') {
                const d = (st.devs[k] || []).find((x) => x.id === Number(b.sid));
                st.devs[k] = (st.devs[k] || []).filter((x) => x.id !== Number(b.sid));
                return answer({ label: d ? d.label : '' });
            }
            if (b.action === 'sign_out_all') {
                const n = (st.devs[k] || []).filter((x) => !x.here).length;
                st.devs[k] = (st.devs[k] || []).filter((x) => x.here);
                return answer({ count: n });
            }
        }
        if (file === 'auth.php' && b.action === 'admin_status') return json({ admin: true, me, ownerFirst: 'George' });
        if (file === 'passkeys.php' && b.action === 'admin_list') return json({ ok: true, passkeys: [] });
        if (file === 'people.php' && b.action === 'list')
            return json({ ok: true, people: [Object.assign({ you: true, mail: {}, mailCan: {} }, me), ivy], mailKinds: [], mailExtras: [], permDefs: [], permGroups: {} });
        return json({ ok: true, bookings: [], enquiries: [], threads: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [], reviews: [] });
    });
    const devPosts = (action) => posts.filter((p) => p.file === 'devices.php' && p.b.action === action);
    const dlgOpen = () => page.evaluate(() => document.getElementById('glass-dialog').classList.contains('open'));
    const waitDlg = () => page.waitForFunction(() => document.getElementById('glass-dialog').classList.contains('open'), null, { timeout: 15000 });
    const waitShut = () => page.waitForFunction(() => !document.getElementById('glass-dialog').classList.contains('open'), null, { timeout: 15000 });
    const dlg = () =>
        page.evaluate(() => ({
            title: document.getElementById('glass-dialog-title').textContent,
            msg: document.getElementById('glass-dialog-msg').innerText,
            ok: document.getElementById('glass-dialog-ok').textContent,
            danger: document.getElementById('glass-dialog-ok').classList.contains('is-danger'),
        }));
    const sheetOpen = () => page.evaluate(() => { const o = document.getElementById('oa-dev-sheet'); return !!o && o.classList.contains('open'); });
    const rows = (host) =>
        page.evaluate((h) => [...document.querySelectorAll(`#${h} .ga-row`)].map((r) => ({ t: (r.querySelector('.ga-t') || {}).textContent, s: ((r.querySelector('.ga-s') || {}).textContent || '').trim(), here: !!r.querySelector('.oa-dev-here i'), danger: r.classList.contains('is-danger') })), host);
    const toastText = () => page.evaluate(() => [...document.querySelectorAll('.toast, #toast, .chb-toast')].map((t) => t.textContent).join(' | '));

    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const hint = await page.evaluate(() => document.cookie);
    await page.evaluate(() => {
        document.body.classList.remove('light-mode');
        isAuthenticated = true;
        document.body.classList.add('owner-mode');
    });
    await page.evaluate((m) => chbSetMe(m, 'George'), me);
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(700);
    await page.evaluate(async () => {
        await openArea();
        settingsOpen('security');
    });
    await page.waitForFunction(() => document.querySelectorAll('#oa-dev-host .oa-dev').length > 0, null, { timeout: 15000 });

    console.log('§1 your devices');
    const cap = await page.evaluate(() => [...document.querySelectorAll('#security-body .ga-cap')].map((c) => c.textContent));
    ok(cap[cap.length - 1] === 'Devices', `a Devices caption closes the page (${cap.join(' · ')})`);
    let r = await rows('oa-dev-host');
    ok(r.length === 4 && r[0].t === 'iPhone · App' && r[0].here && r[0].s === 'This device · Active now', `this device first, marked with its dot: "${r[0].t} — ${r[0].s}"`);
    ok(r[1].t === 'Mac · Chrome' && r[1].s === 'Last active 2 hours ago' && !r[1].here, `another says when it was last used ("${r[1].s}")`);
    ok(r[2].s === 'Last active 3 weeks ago', `…however long ago ("${r[2].s}")`);
    ok(r[3].t === 'Sign out of all other devices' && r[3].danger, 'then "Sign out of all other devices", in danger ink');
    ok(/chb_dh=web/.test(hint), `the page tells the server what kind of window it is (a browser tab: ${(hint.match(/chb_dh=[^;]*/) || [''])[0]})`);

    console.log('§2 a device\'s sheet');
    await page.click('#oa-dev-host .oa-dev:nth-child(2)');
    await page.waitForFunction(() => document.getElementById('oa-dev-sheet') && document.getElementById('oa-dev-sheet').classList.contains('open'));
    await page.waitForTimeout(500); // the sheet's rise
    const sh = await page.evaluate(() => {
        const o = document.getElementById('oa-dev-sheet');
        const box = o.querySelector('.ga-sheetbox').getBoundingClientRect();
        const out = o.querySelector('.oa-dev-out');
        const ic = out.querySelector('svg').getBoundingClientRect();
        return {
            t: o.querySelector('.ga-sheet-t').textContent,
            s: o.querySelector('.ga-sheet-s').textContent,
            facts: [...o.querySelectorAll('.oa-dev-fact')].map((f) => f.querySelector('.ga-t').textContent + ': ' + f.querySelector('.ga-v').textContent),
            btn: out.textContent,
            btnH: out.getBoundingClientRect().height,
            icW: ic.width,
            icH: ic.height,
            ink: getComputedStyle(out).color,
            bottom: Math.round(box.bottom),
            vh: window.innerHeight,
            focus: document.activeElement && document.activeElement.textContent,
            label: o.getAttribute('aria-labelledby') === 'oa-dev-title' && o.getAttribute('aria-modal') === 'true',
        };
    });
    ok(sh.t === 'Mac · Chrome' && sh.s === 'Last active 2 hours ago', `it names the device and when it was last used (${sh.t} · ${sh.s})`);
    ok(sh.facts.join(' | ') === 'Signed in: 03/10/2026 at 09:14 | How: Emailed code | Two-step: No code needed here | Alerts: On', `its facts: ${sh.facts.join(' | ')}`);
    ok(sh.btn === 'Sign out of this device', `one sign-out button (${sh.btn})`);
    ok(sh.btnH <= 56 && sh.icW <= 24 && sh.icH <= 24, `…at the size of a button, its icon at text size (${Math.round(sh.btnH)}px, icon ${Math.round(sh.icW)}×${Math.round(sh.icH)})`);
    const danger = await page.evaluate(() => { const p = document.createElement('span'); p.style.color = 'var(--danger-text)'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    ok(sh.ink === danger, `…in danger ink (${sh.ink})`);
    ok(sh.bottom === sh.vh, `on a phone it rises from the bottom edge (box bottom ${sh.bottom} of ${sh.vh})`);
    ok(sh.focus === 'Close' && sh.label, 'focus lands on Close, never on the sign-out; the sheet is a named dialog');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok(!(await sheetOpen()), 'Escape closes it');
    await page.click('#oa-dev-host .oa-dev:nth-child(2)');
    await page.waitForTimeout(400);
    // The sheet takes its own history entry, so Back closes IT and nothing beneath.
    // (Without one, Back still closed the sheet here — by spending the entry of the
    // screen before, so the NEXT Back skipped a level: the state is what to check.)
    ok(await page.evaluate(() => !!(history.state && history.state.chbOverlay)), 'the open sheet holds its own history entry');
    await page.evaluate(() => history.back());
    await page.waitForTimeout(500);
    ok(!(await sheetOpen()) && (await page.evaluate(() => getComputedStyle(document.getElementById('sec-security')).display !== 'none' && !(history.state && history.state.chbOverlay))), 'Back closes it, spends that entry, and stays on Sign-in & security');

    console.log('§3 signing one device out');
    await page.click('#oa-dev-host .oa-dev:nth-child(2)');
    await page.waitForTimeout(400);
    await page.click('#oa-dev-sheet .oa-dev-out');
    await waitDlg();
    let dg = await dlg();
    ok(dg.title === 'Sign out of Mac · Chrome?' && dg.ok === 'Sign out' && dg.danger, `it asks first, naming the device (${dg.title} / ${dg.ok})`);
    ok(/signed out the next time it’s used/.test(dg.msg) && /your password and an emailed code, or a passkey\./.test(dg.msg), `and says exactly what getting back in takes (${dg.msg})`);
    await page.click('#glass-dialog-cancel');
    await waitShut();
    ok(devPosts('sign_out').length === 0 && (await sheetOpen()), 'backing out sends nothing and leaves the sheet up');
    await page.click('#oa-dev-sheet .oa-dev-out');
    await waitDlg();
    await page.click('#glass-dialog-ok');
    await page.waitForFunction(() => document.querySelectorAll('#oa-dev-host .oa-dev').length === 2, null, { timeout: 15000 }).catch(() => {});
    const so = devPosts('sign_out');
    ok(so.length === 1 && so[0].b.sid === 12 && so[0].b.id === undefined, `confirming posts that device and no one else's (${JSON.stringify(so[0] && so[0].b)})`);
    r = await rows('oa-dev-host');
    ok(!r.some((x) => x.t === 'Mac · Chrome') && !(await sheetOpen()), 'the sheet closes and the row goes');
    ok(/Signed out of Mac · Chrome/.test(await toastText()), 'and it says so');

    console.log('§4 this device');
    await page.click('#oa-dev-host .oa-dev:nth-child(1)');
    await page.waitForTimeout(400);
    const here = await page.evaluate(() => ({
        btn: document.querySelector('#oa-dev-sheet .oa-dev-out').textContent,
        act: document.querySelector('#oa-dev-sheet .oa-dev-out').getAttribute('data-act'),
        note: (document.querySelector('#oa-dev-sheet .oa-dev-note') || {}).textContent,
        sub: document.querySelector('#oa-dev-sheet .ga-sheet-s').textContent,
    }));
    ok(here.btn === 'Log out of this iPhone' && here.act === 'oaDevLogoutHere', `the device in your hand offers Log out (${here.btn})`);
    ok(here.note === 'This is the device you’re using.' && here.sub === 'This device · active now', 'and says it is the one you are using');
    await page.click('#oa-dev-sheet [data-act="oaDevClose"]');
    await page.waitForTimeout(400);
    ok(!(await sheetOpen()) && devPosts('sign_out').length === 1, 'Close sends nothing');

    console.log('§5 signing out of all other devices');
    await page.click('#oa-dev-host .ga-row.is-danger');
    await waitDlg();
    dg = await dlg();
    ok(dg.title === 'Sign out of 1 other device?' && dg.ok === 'Sign out all' && /This iPhone stays signed in/.test(dg.msg), `one ask, counted, saying this one stays (${dg.title} / ${dg.msg})`);
    await page.click('#glass-dialog-ok');
    await page.waitForFunction(() => document.querySelectorAll('#oa-dev-host .oa-dev').length === 1, null, { timeout: 15000 }).catch(() => {});
    const sa = devPosts('sign_out_all');
    ok(sa.length === 1 && sa[0].b.id === undefined, 'it posts your own sign-out, nobody else\'s');
    r = await rows('oa-dev-host');
    const note = await page.evaluate(() => (document.querySelector('#oa-dev-host .oa-dev-note') || {}).textContent);
    ok(r.length === 1 && note === 'You’re signed in on this iPhone only.', `only this one is left, and the page says so (${note})`);
    ok(/Signed out of 1 device/.test(await toastText()), 'the toast counts what went');

    console.log('§6 a list that may not be complete yet');
    st.partial = true;
    await page.evaluate(() => oaDevLoad(0));
    await page.waitForTimeout(400);
    r = await rows('oa-dev-host');
    const pnote = await page.evaluate(() => (document.querySelector('#oa-dev-host .oa-dev-note') || {}).textContent);
    ok(r.some((x) => x.t === 'Sign out of all other devices'), 'with only this device listed, signing out the others stays on offer');
    ok(/^Listed since 10\/10\/2026: a device not used since then appears here the next time it is\. Signing out of all other devices covers it too\.$/.test(pnote || ''), `…and the note says why (${pnote})`);
    await page.click('#oa-dev-host .ga-row.is-danger');
    await waitDlg();
    dg = await dlg();
    ok(dg.title === 'Sign out of every other device?', `the ask names no count it doesn't know (${dg.title})`);
    await page.click('#glass-dialog-cancel');
    await waitShut();
    st.partial = false;

    console.log('§7 someone else\'s devices (a Super User)');
    await page.evaluate(() => loadPeople());
    await page.waitForTimeout(300);
    await page.evaluate(() => oaPersonOpen(2));
    await page.waitForFunction(() => document.querySelectorAll('#oa-pdev-host .oa-dev').length === 2, null, { timeout: 15000 }).catch(() => {});
    r = await rows('oa-pdev-host');
    // The fixture was stamped when the run began, so a slow machine can add a minute.
    ok(r.length === 3 && r[0].t === 'iPhone · Safari' && /^Active 1[2-4] minutes ago$/.test(r[0].s) && !r[0].here, `Ivy's devices, none of them "this device" (${r.map((x) => x.t + ' — ' + x.s).join(', ')})`);
    ok(r[2].t === 'Sign Ivy out everywhere' && r[2].danger, 'and "Sign Ivy out everywhere"');
    ok(devPosts('list').some((p) => p.b.id === 2), 'her list is asked for by her id');
    await page.click('#oa-pdev-host .oa-dev:nth-child(1)');
    await page.waitForTimeout(400);
    const ivSheet = await page.evaluate(() => document.querySelector('#oa-dev-sheet .oa-dev-out').textContent);
    ok(ivSheet === 'Sign Ivy out of this device', `her device's sheet signs HER out (${ivSheet})`);
    await page.click('#oa-dev-sheet .oa-dev-out');
    await waitDlg();
    dg = await dlg();
    ok(dg.title === 'Sign Ivy out of iPhone · Safari?' && /Ivy gets an email saying you did this/.test(dg.msg), `the ask says she is told (${dg.title})`);
    await page.click('#glass-dialog-cancel');
    await waitShut();
    await page.click('#oa-dev-sheet [data-act="oaDevClose"]');
    await page.waitForTimeout(400);
    await page.click('#oa-pdev-host .ga-row.is-danger');
    await waitDlg();
    dg = await dlg();
    ok(dg.title === 'Sign Ivy out everywhere?' && dg.ok === 'Sign out everywhere' && /Ivy gets an email saying you did this/.test(dg.msg), `everywhere: one ask, and she is told (${dg.title})`);
    await page.click('#glass-dialog-ok');
    await page.waitForFunction(() => document.querySelectorAll('#oa-pdev-host .oa-dev').length === 0, null, { timeout: 15000 }).catch(() => {});
    const sa2 = devPosts('sign_out_all').pop();
    r = await rows('oa-pdev-host');
    ok(sa2 && sa2.b.id === 2 && !sa2.b.push_endpoint, 'it posts HER id, and never this device\'s alerts');
    ok(r.length === 1 && r[0].t === 'Not signed in anywhere' && r[0].s === 'Ivy can sign in with a password, a passkey or an emailed code', `then: "${r[0] && r[0].t}"`);
    ok(/Signed Ivy out everywhere/.test(await toastText()), 'and the toast says so');

    console.log('§8 the new-sign-in alert\'s link');
    st.devs = fresh();
    delete st.devs[0][1]; // keep the array dense
    st.devs[0] = st.devs[0].filter(Boolean);
    await page.evaluate(() => chbOpenTarget('device-13'));
    await page.waitForFunction(() => document.getElementById('oa-dev-sheet').classList.contains('open'), null, { timeout: 15000 }).catch(() => {});
    const tgt = await page.evaluate(() => ({ t: document.querySelector('#oa-dev-sheet .ga-sheet-t').textContent, on: getComputedStyle(document.getElementById('sec-security')).display !== 'none' }));
    ok(tgt.t === 'iPad · Safari' && tgt.on, `?open=device-13 lands on Sign-in & security with that device open (${tgt.t})`);
    const early = await page.evaluate(() => [...document.querySelectorAll('#oa-dev-sheet .oa-dev-fact')].map((f) => f.textContent).join(' | '));
    ok(/Signed in\s*Before 13\/09\/2026/.test(early) && /How\s*Not recorded/.test(early) && /Two-step\s*Asks for a code/.test(early) && /Alerts\s*Off/.test(early), `a device from before the list began says so honestly (${early})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.evaluate(() => chbOpenTarget('device-99'));
    await page.waitForTimeout(600);
    ok(!(await sheetOpen()) && /That device isn’t signed in any more/.test(await toastText()), 'a device already signed out is said to be, with no sheet');

    console.log('§9 failures, and being signed out');
    st.failList = true;
    await page.evaluate(() => { __oaDevs = {}; return oaDevLoad(0); });
    await page.waitForTimeout(300);
    r = await rows('oa-dev-host');
    ok(r.length === 1 && /Couldn’t reach the server/.test(r[0].t) && r[0].s === 'Tap to try again', `a list that couldn't load says so (${r[0] && r[0].t})`);
    st.failList = false;
    await page.click('#oa-dev-host .ga-row');
    await page.waitForFunction(() => document.querySelectorAll('#oa-dev-host .oa-dev').length > 0, null, { timeout: 15000 }).catch(() => {});
    ok((await rows('oa-dev-host')).some((x) => x.here), 'and tapping it tries again');
    st.failList = true;
    await page.evaluate(() => oaDevLoad(0));
    await page.waitForTimeout(300);
    ok((await rows('oa-dev-host')).some((x) => x.here), 'a failed refresh keeps the last list rather than emptying it');
    st.failList = false;
    // An answer that carries no list is not an empty list.
    st.noList = true;
    const nl = await page.evaluate(async () => {
        delete __oaDevs[2];
        await oaDevLoad(2);
        const el = document.createElement('div');
        el.innerHTML = oaDevHtml(2);
        return el.textContent;
    });
    ok(/Couldn’t load the devices/.test(nl) && !/Not signed in anywhere/.test(nl), `an answer with no list says it couldn't check, never "Not signed in anywhere" (${nl})`);
    st.noList = false;
    // The session this page holds was signed out from a Devices list somewhere else.
    await page.evaluate(() => { forceAdminLogout('device'); });
    await waitDlg().catch(() => {});
    const msg = await page.evaluate(() => document.getElementById('glass-dialog-msg').innerText);
    ok(msg === 'This device was signed out of the back office. Sign in again to carry on.', `a device signed out from elsewhere is told why (${msg})`);

    console.log('§10 across the night the clocks go forward');
    // The morning after 28/03/2027: midnight to midnight is 23 hours, so a day count
    // that floors reads yesterday as "today" (or "25 hours ago").
    await page.clock.setFixedTime(new Date('2027-03-29T10:00:00+01:00'));
    const dst = await page.evaluate(() => ({ dev: oaDevSeen({ seen: '2027-03-28 09:00:00' }), person: oaSeenWords({ seen: '2027-03-28 09:00:00' }) }));
    ok(dst.dev === 'Last active yesterday' && dst.person === 'active yesterday', `yesterday is yesterday (${dst.dev} · ${dst.person})`);

    console.log(fails ? `\n${fails} check(s) failed` : '\nALL CHECKS PASSED');
    await done(fails);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
