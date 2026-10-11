// CHANGE PASSWORD (approved demo), in a real browser:
//  §1 one sheet, a real form a password manager can read: your sign-in address in
//     it (read-only, the username), current-password and new-password, no confirm box;
//     the caret lands in the first box, never on the sign-in line
//  §2 the rhythm: each label 8px above its box, 20px between fields; focus is the
//     box's own edge and a glow, with no ring drawn outside it
//  §3 Show / Hide on each box keeps the focus (the keyboard) in the box
//  §4 the line under the new box counts to 12, ticks there, and notices the current
//     password typed again; the button looks unavailable until both boxes are ready
//  §5 tapped too early, it goes to what is missing and sends nothing
//  §6 a wrong current password is said under that box, in red, with the box focused
//     and what was typed selected; a refusal of tries uses the server's words; a
//     failure that is about no box is said above the buttons
//  §7 the change: what it posts (this device keeps its alerts), the busy row (the
//     spinner 10px from its words, the boxes held), then the done panel naming the
//     devices it signed out, and the Devices list asked again
//  §8 "Forgotten it?" sends the 30-minute link to your own inbox and says so
//  §9 the devices sentence: named, counted, only this one, not yet complete, unknown
//  §10 Escape and Back close it; Tab stays inside it; reopening starts empty; the
//      passwords leave the page with the sheet
//  §11 an answer that lands after the sheet closed still reaches you
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
let fails = 0;
const ok = (b, m) => {
    console.log(`  ${b ? '✓' : '✗'} ${m}`);
    if (!b) fails++;
};

(async () => {
    const { page, base, done } = await boot({ viewport: { width: 390, height: 844 } });
    const posts = [];
    const DEVS = [
        { id: 11, label: 'iPhone · App', kind: 'phone', here: true, seen: '2026-10-10 08:00:00', since: '2026-10-08 08:02:00', how: 'Passkey', trusted: true, alerts: true },
        { id: 12, label: 'Mac · Chrome', kind: 'laptop', here: false, seen: '2026-10-10 06:00:00', since: '2026-10-03 09:14:00', how: 'Emailed code', trusted: true, alerts: true },
        { id: 13, label: 'iPad · Safari', kind: 'tablet', here: false, seen: '2026-09-20 06:00:00', since: '2026-09-13 17:40:00', how: 'Not recorded', trusted: false, alerts: false },
    ];
    // pw: how the change answers — 'ok', 'wrong' (403), 'tries' (429), 'down' (500).
    const st = { devs: DEVS.slice(), partial: false, failList: false, pw: 'ok', slow: 0, resetDown: false };
    const me = {
        id: 1, name: 'George Farrow', first: 'George', named: true, email: 'george@example.com', contact: 'george@example.com', username: 'george',
        full: true, original: true, caps: {}, photo: '', state: 'active', twofa: true, twofaLive: true, notify: {},
    };
    await page.route(/\.php/, async (route) => {
        const url = route.request().url();
        const json = (o, code) => route.fulfill({ status: code || 200, contentType: 'application/json', body: JSON.stringify(o) });
        let b = {};
        try {
            b = JSON.parse(route.request().postData() || '{}');
        } catch (e) {}
        const file = url.split('?')[0].split('/').pop();
        if (route.request().method() === 'POST') posts.push({ file, b });
        if (file === 'devices.php' && b.action === 'list') return st.failList ? json({ error: 'Couldn’t reach the server' }, 500) : json({ ok: true, id: 1, devices: st.devs, twofa: true, partial: st.partial });
        if (file === 'auth.php' && b.action === 'admin_status') return json({ admin: true, me, ownerFirst: 'George' });
        if (file === 'auth.php' && b.action === 'admin_change_password') {
            if (st.slow) await new Promise((r) => setTimeout(r, st.slow));
            if (st.pw === 'wrong') return json({ error: 'Current password is incorrect' }, 403);
            if (st.pw === 'tries') return json({ error: 'Too many failed attempts. Please wait 10 minutes and try again.' }, 429);
            if (st.pw === 'down') return json({ error: 'The server is having a moment. Try again shortly.' }, 503);
            return json({ ok: true });
        }
        if (file === 'auth.php' && b.action === 'admin_reset_request') return st.resetDown ? json({ error: 'Too many requests. Try again in a few minutes.' }, 429) : json({ ok: true });
        if (file === 'passkeys.php') return json({ ok: true, passkeys: [] });
        return json({ ok: true, bookings: [], enquiries: [], threads: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [], reviews: [] });
    });
    const pwPosts = () => posts.filter((p) => p.file === 'auth.php' && p.b.action === 'admin_change_password');
    const isOpen = () => page.evaluate(() => { const o = document.getElementById('oa-pw-sheet'); return !!o && o.classList.contains('open'); });
    const act = () => page.evaluate(() => (document.activeElement ? document.activeElement.id : ''));
    const val = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.value : null; }, sel);
    // Typing goes through the keyboard (the input events the sheet listens to), into
    // a box that is emptied first.
    const typeIn = async (id, text) => {
        await page.focus('#' + id);
        await page.evaluate((i) => { const e = document.getElementById(i); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }, id);
        if (text) await page.keyboard.type(text);
    };
    const openSheet = async () => {
        await page.click('#security-body .ga-row:has(.ga-t:text-is("Change password"))');
        await page.waitForFunction(() => { const o = document.getElementById('oa-pw-sheet'); return o && o.classList.contains('open') && document.activeElement && document.activeElement.id === 'oa-pw-cur'; }, null, { timeout: 15000 }).catch(() => {});
    };
    // A reading of a transitioning property is a reading of the transition: wait for
    // the sheet's own animations to end (the ring and the focus glow run 160ms).
    const settle = () =>
        page.waitForFunction(() => { const o = document.getElementById('oa-pw-sheet'); return !o || o.getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || a.effect.getTiming().iterations === Infinity); }, null, { timeout: 5000 }).catch(() => {});
    const closeSheet = async () => {
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('oa-pw-sheet').classList.contains('open'), null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(450);
    };

    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
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

    console.log('§1 one sheet, a form a password manager can read');
    await openSheet();
    ok(await isOpen(), 'the Change password row opens the sheet');
    ok(!(await page.evaluate(() => document.getElementById('glass-dialog').classList.contains('open'))), '…not the old pop-up form');
    const f = await page.evaluate(() => {
        const o = document.getElementById('oa-pw-sheet');
        const form = o.querySelector('form');
        const fields = [...form.querySelectorAll('input')];
        const user = form.querySelector('input[autocomplete="username"]');
        return {
            dialog: o.getAttribute('role') === 'dialog' && o.getAttribute('aria-modal') === 'true' && o.getAttribute('aria-labelledby') === 'oa-pw-title',
            title: document.getElementById('oa-pw-title').textContent,
            forLine: o.querySelector('.oa-pw-for').textContent.replace(/\s+/g, ' ').trim() + ' ' + (user ? user.value : ''),
            user: user ? { v: user.value, ro: user.readOnly, ti: user.tabIndex, type: user.type, fs: getComputedStyle(user).fontSize, before: fields.indexOf(user) < fields.indexOf(document.getElementById('oa-pw-cur')) } : null,
            ac: fields.filter((x) => x.type === 'password').map((x) => x.id + ':' + x.autocomplete),
            submit: !!form.querySelector('button[type="submit"]#oa-pw-ok'),
            act: form.getAttribute('data-act-submit'),
            novalidate: form.noValidate,
        };
    });
    ok(f.dialog && f.title === 'Change password', `a named dialog, titled "${f.title}"`);
    ok(!!f.user && f.user.v === 'george@example.com' && f.user.ro && f.user.ti === -1 && f.user.type === 'email' && f.user.before, `the form carries your sign-in address as a read-only username field, before the password boxes (${f.user && f.user.v})`);
    ok(/^For george@example\.com/.test(f.forLine.replace('For george@example.com george@example.com', 'For george@example.com')) && f.user.fs === '13px', `…worn as a plain line, "For george@example.com", at 13px despite the phone's 17px input rule (${f.user && f.user.fs})`);
    ok(f.ac.join() === 'oa-pw-cur:current-password,oa-pw-new:new-password', `two password boxes, current and new — no confirm box (${f.ac.join(' · ')})`);
    ok(f.submit && f.act === 'oaPwSubmit' && f.novalidate, 'a real <form> with a submit button: Return submits it');
    ok((await act()) === 'oa-pw-cur', 'the caret lands in the current password box, not on the sign-in line');

    console.log('§2 the rhythm, and focus inside the box');
    await settle();
    const g = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const cur = document.getElementById('oa-pw-cur');
        const cs = getComputedStyle(cur);
        return {
            lab1: r('label[for="oa-pw-cur"]').bottom, cur: r('#oa-pw-cur').top,
            lab2: r('label[for="oa-pw-new"]').bottom, nw: r('#oa-pw-new').top,
            g1: r('#oa-pw-cur-g').bottom, g2: r('#oa-pw-new-g').top,
            h: r('#oa-pw-cur').height,
            focusOutline: cs.outlineStyle, focusShadow: cs.boxShadow, focusEdge: cs.borderTopColor,
            restEdge: getComputedStyle(document.getElementById('oa-pw-new')).borderTopColor,
        };
    });
    ok(Math.round(g.cur - g.lab1) === 8 && Math.round(g.nw - g.lab2) === 8, `each label sits 8px above its own box (${Math.round(g.cur - g.lab1)} · ${Math.round(g.nw - g.lab2)})`);
    ok(Math.round(g.g2 - g.g1) === 20, `20px between one field and the next label (${Math.round(g.g2 - g.g1)})`);
    ok(Math.round(g.h) === 48, `the boxes are the one field height (${Math.round(g.h)}px)`);
    // Chromium writes a color-mix() result as color(srgb …), so the glow is read by its
    // geometry: a 4px spread with no offset or blur.
    ok(g.focusOutline === 'none' && /0px 0px 0px 4px/.test(g.focusShadow) && g.focusEdge !== g.restEdge, `focus is the box's own edge and a 4px glow, no outline drawn outside it (${g.focusOutline} · ${g.focusShadow.replace(/^.*\) /, '')})`);

    console.log('§3 Show / Hide keeps the keyboard up');
    await typeIn('oa-pw-cur', 'kingfish');
    await page.evaluate(() => {
        window.__blurs = 0;
        document.getElementById('oa-pw-cur').addEventListener('blur', () => window.__blurs++);
    });
    await page.click('.oa-pw-eye[aria-controls="oa-pw-cur"]');
    let e1 = await page.evaluate(() => ({ type: document.getElementById('oa-pw-cur').type, b: document.querySelector('.oa-pw-eye[aria-controls="oa-pw-cur"]'), blurs: window.__blurs, act: document.activeElement.id }));
    const eyeA = await page.evaluate(() => { const b = document.querySelector('.oa-pw-eye[aria-controls="oa-pw-cur"]'); return { p: b.getAttribute('aria-pressed'), l: b.getAttribute('aria-label'), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }; });
    ok(e1.type === 'text' && eyeA.p === 'true' && eyeA.l === 'Hide password', `Show reveals what was typed, and the button now says Hide (${e1.type} · ${eyeA.l})`);
    ok(e1.act === 'oa-pw-cur' && e1.blurs === 0, `the box never lost the focus, so a phone's keyboard stays up (blurs ${e1.blurs}, focus on ${e1.act})`);
    ok(Math.round(eyeA.w) >= 44 && Math.round(eyeA.h) >= 44, `the eye is a 44px target (${Math.round(eyeA.w)}×${Math.round(eyeA.h)})`);
    await page.click('.oa-pw-eye[aria-controls="oa-pw-cur"]');
    e1 = await page.evaluate(() => ({ type: document.getElementById('oa-pw-cur').type, blurs: window.__blurs, act: document.activeElement.id }));
    ok(e1.type === 'password' && e1.blurs === 0 && e1.act === 'oa-pw-cur', 'Hide puts the dots back, still in the box');

    console.log('§4 the line under the new box');
    const hint = () => page.evaluate(() => { const h = document.getElementById('oa-pw-h-new'); return { t: document.getElementById('oa-pw-h-t').textContent, ok: h.classList.contains('is-ok'), warn: h.classList.contains('is-warn'), off: parseFloat(getComputedStyle(h.querySelector('.oa-pw-rfg')).strokeDashoffset), btn: document.getElementById('oa-pw-ok').getAttribute('aria-disabled'), say: document.getElementById('oa-pw-say').textContent, color: getComputedStyle(h).color, op: getComputedStyle(document.getElementById('oa-pw-ok')).opacity }; });
    let h = await hint();
    ok(h.t === '12 characters or more' && !h.ok && h.btn === 'true' && Number(h.op) < 0.6, `empty, it states the rule and the button looks unavailable (${h.t} · opacity ${h.op})`);
    await typeIn('oa-pw-new', 'harbour');
    await settle();
    h = await hint();
    ok(h.t === '7 of 12 characters' && !h.ok && h.btn === 'true' && Math.abs(h.off - 50.27 * (5 / 12)) < 0.6, `it counts as you type (${h.t}, ring ${h.off.toFixed(1)})`);
    await page.keyboard.type('-lights');
    await settle();
    h = await hint();
    const okInk = await page.evaluate(() => { const p = document.createElement('span'); p.style.color = 'var(--ok-text)'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    ok(h.t === '12 characters or more' && h.ok && h.off < 0.6 && h.color === okInk, `and ticks at 12, in the ok ink (${h.t} · ring ${h.off.toFixed(1)})`);
    ok(h.btn === 'false' && Number(h.op) === 1, 'with both boxes ready, the button is ready');
    ok(h.say === 'New password is long enough', `a screen reader hears the change once, not the count (${h.say})`);
    await typeIn('oa-pw-new', 'kingfish');
    await page.keyboard.type('-yes');
    await typeIn('oa-pw-cur', 'kingfish-yes');
    h = await hint();
    ok(h.t === 'That’s your current password' && h.warn && h.btn === 'true', `the current password typed again is noticed, in amber, and is not ready (${h.t})`);
    await typeIn('oa-pw-cur', '');
    await typeIn('oa-pw-new', 'a-much-longer-password');
    h = await hint();
    ok(h.ok && h.btn === 'true', 'a long new password with no current one is still not ready');

    console.log('§5 tapped too early');
    const n0 = pwPosts().length;
    // Playwright treats aria-disabled as disabled and will not click it; a finger does.
    await page.click('#oa-pw-ok', { force: true });
    await page.waitForTimeout(80);
    let early = await page.evaluate(() => ({ act: document.activeElement.id, nudge: document.querySelector('#oa-pw-cur-g .oa-pw-fbox').classList.contains('is-nudge') }));
    ok(early.act === 'oa-pw-cur' && early.nudge, `it goes to the empty current box, with a nudge (${early.act})`);
    await typeIn('oa-pw-cur', 'kingfisher');
    await typeIn('oa-pw-new', 'short');
    await page.click('#oa-pw-ok', { force: true });
    await page.waitForTimeout(80);
    early = await page.evaluate(() => ({ act: document.activeElement.id, nudge: document.querySelector('#oa-pw-new-g .oa-pw-fbox').classList.contains('is-nudge'), pulse: document.getElementById('oa-pw-h-new').classList.contains('is-pulse') }));
    ok(early.act === 'oa-pw-new' && early.nudge && early.pulse, 'with a short new password, to the new box, and the line under it pulses');
    ok(pwPosts().length === n0, 'nothing is sent before it is ready');
    // Return in the current box moves on; it does not submit.
    await page.focus('#oa-pw-cur');
    await page.keyboard.press('Enter');
    ok((await act()) === 'oa-pw-new' && pwPosts().length === n0, 'Return in the current box moves to the new one and sends nothing');

    console.log('§6 mistakes, under the box they are about');
    st.pw = 'wrong';
    await typeIn('oa-pw-cur', 'kingfish');
    await typeIn('oa-pw-new', 'harbour-lights-1983');
    await page.keyboard.press('Enter'); // Return in the new box submits
    await page.waitForFunction(() => !document.getElementById('oa-pw-e-cur').hidden, null, { timeout: 15000 }).catch(() => {});
    await settle();
    const w = await page.evaluate(() => {
        const e = document.getElementById('oa-pw-e-cur');
        const i = document.getElementById('oa-pw-cur');
        return {
            t: e.textContent, role: e.getAttribute('role'), bad: document.getElementById('oa-pw-cur-g').classList.contains('is-bad'),
            act: document.activeElement.id, sel: [i.selectionStart, i.selectionEnd, i.value.length], inv: i.getAttribute('aria-invalid'),
            under: e.getBoundingClientRect().top > i.getBoundingClientRect().bottom && e.getBoundingClientRect().top < document.getElementById('oa-pw-new').getBoundingClientRect().top,
            ink: getComputedStyle(e).color, edge: getComputedStyle(i).borderTopColor, gen: document.getElementById('oa-pw-e-gen').hidden,
        };
    });
    const dangerInk = await page.evaluate(() => { const p = document.createElement('span'); p.style.color = 'var(--danger-text)'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    ok(pwPosts().length === n0 + 1, 'Return in the new box submits');
    ok(w.t === 'That isn’t your current password.' && w.role === 'alert' && w.under, `the wrong current password is said under that box, as an alert (${w.t})`);
    ok(w.bad && w.ink === dangerInk && w.edge === dangerInk && w.inv === 'true', `in red, the box edged in red and marked invalid (${w.ink} · ${w.edge} · ${w.inv})`);
    ok(w.act === 'oa-pw-cur' && w.sel[0] === 0 && w.sel[1] === w.sel[2] && w.sel[2] === 8, `that box has the focus, what was typed selected to retype (${w.sel.join(',')})`);
    ok(w.gen, 'nothing is said anywhere else');
    await page.keyboard.type('kingfisher');
    ok(await page.evaluate(() => document.getElementById('oa-pw-e-cur').hidden && !document.getElementById('oa-pw-cur-g').classList.contains('is-bad')), 'typing in the box clears the mistake');
    st.pw = 'tries';
    await page.click('#oa-pw-ok');
    await page.waitForFunction(() => !document.getElementById('oa-pw-e-cur').hidden, null, { timeout: 15000 }).catch(() => {});
    ok((await page.evaluate(() => document.getElementById('oa-pw-e-cur').textContent)) === 'Too many failed attempts. Please wait 10 minutes and try again.', 'too many tries: the server\'s own words, under the same box');
    st.pw = 'down';
    await typeIn('oa-pw-cur', 'kingfisher');
    await page.click('#oa-pw-ok');
    await page.waitForFunction(() => !document.getElementById('oa-pw-e-gen').hidden, null, { timeout: 15000 }).catch(() => {});
    const gen = await page.evaluate(() => ({ t: document.getElementById('oa-pw-e-gen').textContent, above: document.getElementById('oa-pw-e-gen').getBoundingClientRect().bottom <= document.getElementById('oa-pw-ok').getBoundingClientRect().top, cur: document.getElementById('oa-pw-e-cur').hidden }));
    ok(gen.t === 'The server is having a moment. Try again shortly.' && gen.above && gen.cur, `a failure about no box is said above the buttons (${gen.t})`);
    await closeSheet();

    console.log('§7 the change');
    st.pw = 'ok';
    st.slow = 1200;
    await openSheet();
    await typeIn('oa-pw-cur', 'kingfisher');
    await typeIn('oa-pw-new', 'harbour-lights-1983');
    await page.click('.oa-pw-eye[aria-controls="oa-pw-new"]');
    const listsBefore = posts.filter((p) => p.file === 'devices.php' && p.b.action === 'list').length;
    await page.click('#oa-pw-ok');
    await page.waitForFunction(() => document.getElementById('oa-pw-ok').getAttribute('aria-busy') === 'true', null, { timeout: 5000 }).catch(() => {});
    const busy = await page.evaluate(() => {
        const b = document.getElementById('oa-pw-ok');
        const s = b.querySelector('.oa-pw-spin');
        const words = b.querySelector('.oa-pw-spin + span');
        const sr = s ? s.getBoundingClientRect() : null;
        const range = document.createRange();
        if (words) range.selectNodeContents(words);
        const wr = words ? range.getBoundingClientRect() : null;
        // The spinner ROTATES, and a rotated box's bounding rect grows with the
        // angle (7px short of the gap at 45°, which is what a loaded runner
        // caught). Rotation is about the centre, so its resting right edge is the
        // centre plus half its layout width.
        const spinRight = sr ? (sr.left + sr.right) / 2 + s.offsetWidth / 2 : 0;
        return {
            words: words ? words.textContent : '', gap: sr && wr ? wr.left - spinRight : null,
            ro: document.getElementById('oa-pw-cur').readOnly && document.getElementById('oa-pw-new').readOnly,
            types: [document.getElementById('oa-pw-cur').type, document.getElementById('oa-pw-new').type].join(),
            dim: getComputedStyle(b).opacity,
        };
    });
    ok(busy.words === 'Changing…' && busy.gap !== null && Math.abs(busy.gap - 10) < 0.6, `busy: the spinner beside "Changing…", 10px from its words (${busy.gap === null ? 'no spinner' : busy.gap.toFixed(1) + 'px'})`);
    ok(busy.ro && Number(busy.dim) === 1, 'the boxes hold still, and busy is not dimmed');
    ok(busy.types === 'password,password', 'what was shown goes back to dots before the answer');
    await page.waitForFunction(() => !document.getElementById('oa-pw-done').hidden, null, { timeout: 15000 }).catch(() => {});
    const sent = pwPosts().pop();
    ok(!!sent && sent.b.current === 'kingfisher' && sent.b.next === 'harbour-lights-1983' && 'push_endpoint' in sent.b, `it posts the current and new password, and this device's alert address so it keeps them (${JSON.stringify(sent && Object.keys(sent.b))})`);
    const dn = await page.evaluate(() => ({
        form: document.getElementById('oa-pw-form').hidden,
        t: document.getElementById('oa-pw-dt').textContent,
        p: document.getElementById('oa-pw-dp').textContent,
        act: document.activeElement.id,
        label: document.getElementById('oa-pw-sheet').getAttribute('aria-labelledby'),
        tick: !!document.querySelector('#oa-pw-done .oa-pw-tick path'),
    }));
    ok(dn.form && dn.t === 'Password changed' && dn.tick, 'done: the form leaves, a drawn tick and "Password changed"');
    ok(dn.p === 'Mac · Chrome and iPad · Safari are signed out. You’re still signed in on this iPhone.', `it names the devices it signed out (${dn.p})`);
    ok(dn.act === 'oa-pw-dt' && dn.label === 'oa-pw-dt', 'focus moves to what happened, which now names the dialog');
    await page.waitForTimeout(300);
    ok(posts.filter((p) => p.file === 'devices.php' && p.b.action === 'list').length > listsBefore, 'the Devices list under the sheet is asked again');
    await page.click('#oa-pw-done .oa-pw-ok');
    await page.waitForTimeout(450);
    ok(!(await isOpen()), 'Done closes it');
    st.slow = 0;

    console.log('§8 Forgotten it?');
    await openSheet();
    const lnk = await page.evaluate(() => { const b = document.querySelector('#oa-pw-forgot .oa-pw-lnk'); return b ? b.textContent : ''; });
    ok(lnk === 'Forgotten it? Email me a reset link', `under the current box: "${lnk}"`);
    await page.click('#oa-pw-forgot .oa-pw-lnk');
    await page.waitForFunction(() => !!document.querySelector('#oa-pw-forgot .oa-pw-sent'), null, { timeout: 15000 }).catch(() => {});
    const rs = posts.filter((p) => p.file === 'auth.php' && p.b.action === 'admin_reset_request').pop();
    ok(!!rs && rs.b.id === 'george@example.com', `it asks for the reset link to your own address (${rs && rs.b.id})`);
    const said = await page.evaluate(() => { const s = document.querySelector('#oa-pw-forgot .oa-pw-sent'); return s ? { t: s.textContent, role: s.getAttribute('role'), act: document.activeElement === s || document.getElementById('oa-pw-sheet').contains(document.activeElement) } : null; });
    ok(!!said && said.t === '✓ Reset link sent to george@example.com. It works for 30 minutes.' && said.role === 'status', `and says where it went and for how long (${said && said.t})`);
    ok(!!said && said.act, 'the focus stays inside the sheet');
    st.resetDown = true;
    await closeSheet();
    await openSheet();
    await page.click('#oa-pw-forgot .oa-pw-lnk');
    await page.waitForFunction(() => !!document.querySelector('#oa-pw-forgot .oa-pw-ferr'), null, { timeout: 15000 }).catch(() => {});
    const rsBad = await page.evaluate(() => ({ t: (document.querySelector('#oa-pw-forgot .oa-pw-ferr') || {}).textContent, again: !!document.querySelector('#oa-pw-forgot .oa-pw-lnk') }));
    ok(rsBad.t === 'Too many requests. Try again in a few minutes.' && rsBad.again, `a refused send says why and offers it again (${rsBad.t})`);
    st.resetDown = false;
    await closeSheet();
    // No inbox on file: nowhere to send a link, so none is offered.
    await page.evaluate((m) => chbSetMe(Object.assign({}, m, { contact: '', email: '' }), 'George'), me);
    await openSheet();
    const noMail = await page.evaluate(() => ({ link: !!document.getElementById('oa-pw-forgot'), user: (document.getElementById('oa-pw-user') || {}).value }));
    ok(!noMail.link && noMail.user === 'george', `with no email on the sign-in, no link is offered and the username is the sign-in (${noMail.user})`);
    await closeSheet();
    await page.evaluate((m) => chbSetMe(m, 'George'), me);

    console.log('§9 the devices sentence');
    const cons = async () => {
        await openSheet();
        await page.waitForTimeout(300);
        const t = await page.evaluate(() => document.getElementById('oa-pw-cons-t').textContent);
        await closeSheet();
        return t;
    };
    ok((await cons()) === 'Mac · Chrome and iPad · Safari will be signed out. You stay signed in on this iPhone.', 'named, before you press');
    st.partial = true;
    ok((await cons()) === 'Mac · Chrome and iPad · Safari and any other device you’re signed in on will be signed out. You stay signed in on this iPhone.', 'a list that may not be complete names what it knows and says "any other"');
    st.partial = false;
    st.devs = [DEVS[0]];
    ok((await cons()) === 'No other device is signed in. You stay signed in on this iPhone.', 'only this one: says so');
    st.devs = [DEVS[0], DEVS[1], DEVS[2], Object.assign({}, DEVS[1], { id: 14 }), Object.assign({}, DEVS[2], { id: 15, label: 'Windows PC · Edge' })];
    ok((await cons()) === 'Your 4 other devices will be signed out. You stay signed in on this iPhone.', 'more than three, or two of one name: counted');
    st.failList = true;
    await page.evaluate(() => { __oaDevs[0] = undefined; });
    ok((await cons()) === 'Every other device you’re signed in on will be signed out. You stay signed in on this device.', 'a list that could not be read: said without names');
    st.failList = false;
    st.devs = DEVS.slice();
    await page.evaluate(() => oaDevLoad(0));
    await page.waitForTimeout(300);

    console.log('§10 leaving it');
    await openSheet();
    ok(await page.evaluate(() => !!(history.state && history.state.chbOverlay)), 'the open sheet holds its own history entry');
    await page.evaluate(() => history.back());
    await page.waitForTimeout(500);
    ok(!(await isOpen()) && (await page.evaluate(() => getComputedStyle(document.getElementById('sec-security')).display !== 'none')), 'Back closes it and stays on Sign-in & security');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => !document.querySelector('#oa-pw-sheet input[type="password"], #oa-pw-sheet input[type="text"]:not([readonly])')), 'the passwords leave the page with the sheet');
    await openSheet();
    ok((await val('#oa-pw-cur')) === '' && (await val('#oa-pw-new')) === '' && (await page.evaluate(() => document.getElementById('oa-pw-e-cur').hidden)), 'reopening starts empty, with no old mistake');
    // Tab stays in the sheet both ways, and the read-only sign-in line is never a stop.
    await page.focus('#oa-pw-cur');
    await page.keyboard.press('Shift+Tab');
    const back1 = await act();
    await page.focus('#oa-pw-ok');
    await page.keyboard.press('Tab');
    const fwd1 = await act();
    ok(back1 === 'oa-pw-ok' && fwd1 === 'oa-pw-cur', `Tab wraps inside the sheet: back from the first box to the button (${back1}), on from the button to the first box (${fwd1})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
    // Through the sheet's own close: a generic hide would leave its history entry (the
    // next Back would then skip a screen) and the passwords on the page.
    ok(!(await isOpen()) && (await page.evaluate(() => !(history.state && history.state.chbOverlay) && !document.querySelector('#oa-pw-sheet input[type="password"]'))), 'Escape closes it through its own close: the history entry spent, the passwords gone');
    await page.waitForTimeout(200);
    ok((await page.evaluate(() => { const a = document.activeElement; return a && a.closest && a.closest('.ga-row') ? a.querySelector('.ga-t').textContent : ''; })) === 'Change password', 'and the focus goes back to the row that opened it');

    console.log('§11 an answer after the sheet closed');
    st.slow = 900;
    await openSheet();
    await typeIn('oa-pw-cur', 'kingfisher');
    await typeIn('oa-pw-new', 'harbour-lights-1983');
    await page.click('#oa-pw-ok');
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1300);
    const late = await page.evaluate(() => [...document.querySelectorAll('.toast, #toast, .chb-toast')].map((t) => t.textContent).join(' | '));
    ok(/Your password was changed\./.test(late), `closed while it worked, the answer still reaches you (${late.slice(0, 80)})`);
    ok(!(await isOpen()), 'and the sheet stays closed');
    st.slow = 0;

    await done(fails);
})();
