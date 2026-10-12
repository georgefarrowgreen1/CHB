// ui-test-username.js — a guest's own username (the approved "Guest usernames" demo).
//   §1 Your details carries a Username row under Email
//   §2 the sheet: capitals become lower case as typed; the rule is said at once, with
//      no request for a name that breaks it; a taken or kept-back name is said with
//      free names to pick; Save waits until the name is free
//   §3 a picked name saves through the REAL post shape; the row and a toast say so;
//      reopened, it is yours
//   §4 two people at once: a save the server turns down says so in place, with names
//      to pick, and the name they had is kept
//   §5 Escape and Back close the sheet; removing it asks first
//   §6 the sign-in box: a guest's username gets a code at "the email on your account"
//      (never named); a back-office one goes to its password; one nobody has is said so;
//      a guest's username + password signs in as a guest, never at the back office;
//      an older server's plain answer still goes to the password, as before
//   §7 your Guest list shows the username beside the name, in the guest's facts, and
//      search finds it
const { bootBrowser } = require('./ui-test-lib');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

(async () => {
    const { browser, base, done } = await bootBrowser();
    const guestBase = { name: 'Hannah Reed', email: 'hannah@example.com', phone: '07700 900123', address: '4 Quay Lane, Blakeney', postcode: 'NR25 7NE', has_password: true, avatar: '' };
    // The server's half, as a small model: who has which name, what is kept back.
    const M = { username: '', taken: new Set(['hannah', 'pia88']), kept: new Set(['admin', 'jollyboat']), race: false, signedIn: true, codeServer: 'new' };
    const SUGG = ['hannah.reed', 'hannah_reed', 'reed.hannah', 'hannahreed'];
    const fmt = (v) => /\s/.test(v) || v.includes('@') || /[^a-z0-9._-]/.test(v) || !/^[a-z0-9]/.test(v) || v.length < 3 || v.length > 40;
    const sugg = () => SUGG.filter((s) => !M.taken.has(s) && s !== M.username).slice(0, 3);
    const guest = () => Object.assign({}, guestBase, { username: M.username });

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    const posts = [];
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (x, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(x) });
        let b = {};
        try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (route.request().method() === 'POST') posts.push(b);
        if (url.includes('auth.php')) {
            if (b.action === 'guest_status') return json({ ok: true, guest: M.signedIn ? guest() : null });
            if (b.action === 'guest_logout') { M.signedIn = false; return json({ ok: true }); }
            if (b.action === 'guest_username_check') {
                const u = String(b.username || '').toLowerCase();
                if (fmt(u)) return json({ ok: true, username: u, state: 'bad', message: 'That breaks the rule.', suggestions: [] });
                if (u === M.username) return json({ ok: true, username: u, state: 'yours', suggestions: [] });
                if (M.kept.has(u)) return json({ ok: true, username: u, state: 'kept', suggestions: sugg() });
                if (M.taken.has(u)) return json({ ok: true, username: u, state: 'taken', suggestions: sugg() });
                return json({ ok: true, username: u, state: 'free', suggestions: [] });
            }
            if (b.action === 'guest_username_set') {
                const u = String(b.username || '').toLowerCase();
                if (u === '') { M.username = ''; return json({ ok: true, guest: guest() }); }
                // Two people at once: another guest's save lands first.
                if (M.race) { M.race = false; M.taken.add(u); return json({ error: 'Someone else has ' + u + '.', code: 'taken', suggestions: sugg() }, 409); }
                if (M.taken.has(u)) return json({ error: 'Someone else has ' + u + '.', code: 'taken', suggestions: sugg() }, 409);
                M.username = u;
                return json({ ok: true, guest: guest() });
            }
            if (b.action === 'guest_code_request') {
                const e = String(b.email || '');
                if (e.includes('@')) return json({ ok: true });
                if (M.codeServer === 'old') return json({ ok: true }); // a server from before usernames
                if (M.username && e === M.username) return json({ ok: true, username: true });
                if (e === 'george') return json({ ok: true, office: true });
                return json({ error: 'There’s no account with the username ' + e + '. Check it, or sign in with your email.', code: 'no_username' }, 404);
            }
            if (b.action === 'guest_code_verify') {
                if (b.code === '424242') { M.signedIn = true; return json({ ok: true, guest: guest() }); }
                return json({ error: "That code isn't right. Check the latest email and try again.", code: 'wrong', left: 4 }, 401);
            }
            if (b.action === 'guest_login') return json({ error: 'Username or password not recognised' }, 401);
            if (b.action === 'admin_login') return json({ error: 'Incorrect username or password' }, 401);
            return json({ ok: true, admin: false, guest: null });
        }
        if (url.includes('my-bookings.php')) return json({ ok: true, bookings: [], enquiries: [], completed_stays: 0 });
        if (url.includes('passkeys.php')) return json({ error: 'no' }, 400);
        return json({ ok: true, bookings: [], events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], props: {}, mine: {}, value: null });
    });
    const sent = (a) => posts.filter((p) => p.action === a);
    // A wait that answers rather than throws: a broken flow fails its named check
    // instead of ending the suite mid-way.
    const until = (fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms || 6000 }).then(() => true, () => false);
    const stepIs = (re) => until((src) => new RegExp(src).test((document.querySelector('#ga-auth .ga-ah') || {}).textContent || ''), re.source);
    const status = () => page.evaluate(() => (document.getElementById('gu-status') || {}).textContent || '');
    const untilStatus = (re) => page.waitForFunction((src) => new RegExp(src).test((document.getElementById('gu-status') || {}).textContent || ''), re.source, { timeout: 5000 }).then(() => true, () => false);
    const sheetOpen = () => page.evaluate(() => !!document.getElementById('ga-uname-sheet') && document.getElementById('ga-uname-sheet').classList.contains('open'));
    const openSheet = async () => {
        await page.click('#guest-account-body .ga-unrow');
        await page.waitForFunction(() => document.getElementById('ga-uname-sheet')?.classList.contains('open') && document.activeElement === document.getElementById('gu-input'));
    };
    const typeName = async (v) => {
        await page.fill('#gu-input', '');
        await page.locator('#gu-input').pressSequentially(v, { delay: 20 });
    };

    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => openGuestAccount('details'));
    await page.waitForTimeout(400);

    console.log('§1 Your details carries a Username row under Email');
    const rows = await page.evaluate(() => [...document.querySelectorAll('#guest-account-body .ga-row .ga-t')].map((x) => x.textContent));
    ok(rows.join(',') === 'Name,Email,Username,Phone,Address,Postcode', `the rows, in order: ${rows.join(', ')}`);
    ok(await page.evaluate(() => /Choose a username/.test(document.querySelector('#guest-account-body .ga-unrow .ga-s').textContent)), 'with none chosen it says "Choose a username"');

    console.log('§2 the sheet checks the name as it is typed');
    await openSheet();
    ok(await page.evaluate(() => {
        const o = document.getElementById('ga-uname-sheet');
        return o.getAttribute('role') === 'dialog' && o.getAttribute('aria-modal') === 'true' && /Your username/.test(document.getElementById('gu-title').textContent) && /Only you and .+ can see it/.test(o.textContent);
    }), 'a dialog titled "Your username" that says who can see it');
    ok(/3 to 40 lower-case letters/.test(await status()) && (await page.getAttribute('#gu-save', 'aria-disabled')) === 'true', 'empty, it states the rule and Save waits');
    let before = sent('guest_username_check').length;
    await typeName('ha');
    await page.waitForTimeout(500);
    ok(/At least 3 characters/.test(await status()) && !(await page.evaluate(() => document.getElementById('gu-status').classList.contains('is-bad'))) && sent('guest_username_check').length === before, 'too short to judge: said quietly, and nothing asked of the server');
    await typeName('han nah');
    await page.waitForTimeout(500);
    ok(/No spaces/.test(await status()) && (await page.evaluate(() => document.getElementById('gu-status').classList.contains('is-bad'))) && sent('guest_username_check').length === before, 'a space: said at once, in the danger ink, with no request');
    await typeName('h@x');
    ok(/can’t have an @/.test(await status()), 'an @: "that’s how we tell it from an email"');
    await typeName('Hannah');
    ok((await page.inputValue('#gu-input')) === 'hannah', 'capitals become lower case as they are typed');
    ok(await untilStatus(/hannah is taken\. Try one of these:/), `a taken name is said: "${await status()}"`);
    const chips = await page.evaluate(() => [...document.querySelectorAll('#gu-sugg button')].map((b) => b.textContent));
    ok(chips.length === 3 && !chips.includes('hannah'), `…with three free names to pick: ${chips.join(', ')}`);
    ok(sent('guest_username_check').some((p) => p.username === 'hannah'), 'the check asked the server about the lower-case name');
    ok((await page.getAttribute('#gu-save', 'aria-disabled')) === 'true' && (await page.evaluate(() => document.getElementById('gu-mark').classList.contains('is-bad') && document.getElementById('gu-input').getAttribute('aria-invalid') === 'true')), 'Save waits; the field is marked and announced invalid');
    before = sent('guest_username_set').length;
    await page.click('#gu-save', { force: true });
    await page.waitForTimeout(300);
    ok((await sheetOpen()) && sent('guest_username_set').length === before && (await page.evaluate(() => document.getElementById('gu-field').classList.contains('gu-nudge'))), 'tapping Save on a taken name nudges the field and sends nothing');
    await typeName('admin');
    ok(await untilStatus(/admin isn’t available/), 'a kept-back name: "isn’t available"');

    console.log('§3 a picked name saves');
    await typeName('hannah');
    await untilStatus(/taken/);
    await page.click('#gu-sugg button >> nth=0');
    const picked = await page.inputValue('#gu-input');
    ok(await untilStatus(/is available/), `picking a name checks it: ${picked} → "${await status()}"`);
    ok((await page.getAttribute('#gu-save', 'aria-disabled')) === 'false' && (await page.evaluate(() => document.getElementById('gu-mark').classList.contains('is-ok'))), '…and Save is ready, the field marked free');
    await page.click('#gu-save');
    await page.waitForFunction(() => !document.getElementById('ga-uname-sheet').classList.contains('open'));
    ok(sent('guest_username_set').some((p) => p.username === picked && Object.keys(p).sort().join(',') === 'action,username'), 'the save posts the name alone (the REAL post shape)');
    ok(await page.evaluate((n) => document.querySelector('#guest-account-body .ga-unrow .ga-s').textContent === n, picked), 'the row shows the saved name');
    ok(await page.evaluate(() => /Username saved/.test(document.getElementById('app-toasts').textContent)), 'a toast says it saved');
    await openSheet();
    ok(/This is your username now/.test(await status()) && (await page.inputValue('#gu-input')) === picked, 'reopened, it is yours');
    ok(await page.evaluate(() => !!document.querySelector('#ga-uname-sheet [data-act="gaUsernameRemove"]')), 'with a way to remove it');

    console.log('§4 two people at once');
    M.race = true;
    await typeName('reed.hannah');
    await untilStatus(/is available/);
    await page.click('#gu-save');
    ok(await untilStatus(/Someone else has just taken reed\.hannah\. Try one of these:/), `the save turned down says so in place: "${await status()}"`);
    ok((await sheetOpen()) && (await page.getAttribute('#gu-save', 'aria-disabled')) === 'true' && (await page.evaluate(() => document.querySelectorAll('#gu-sugg button').length > 0)), '…the sheet stays, Save waits, and there are names to pick');
    ok(await page.evaluate((n) => document.querySelector('#guest-account-body .ga-unrow .ga-s').textContent === n, picked), '…and the name they had is kept');

    console.log('§5 Escape, Back and removing');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok(!(await sheetOpen()), 'Escape closes the sheet');
    await openSheet();
    await page.evaluate(() => closeTopOverlay());
    await page.waitForTimeout(400);
    ok(!(await sheetOpen()), 'Back (the phone\'s own) closes it too');
    await openSheet();
    await page.click('#ga-uname-sheet [data-act="gaUsernameRemove"]');
    await page.waitForSelector('#glass-dialog.open');
    await page.click('#glass-dialog-cancel');
    await page.waitForTimeout(300);
    ok(M.username === picked && !sent('guest_username_set').some((p) => p.username === ''), 'removing asks first; backing out keeps it');
    await page.click('#ga-uname-sheet [data-act="gaUsernameRemove"]');
    await page.waitForSelector('#glass-dialog.open');
    await page.click('#glass-dialog-ok');
    await page.waitForFunction(() => /Choose a username/.test(document.querySelector('#guest-account-body .ga-unrow .ga-s').textContent));
    ok(M.username === '' && sent('guest_username_set').some((p) => p.username === ''), 'confirmed, it is removed and the row says "Choose a username"');

    console.log('§6 signing in with it');
    M.username = 'hannah.reed';
    await page.evaluate(async () => { await guestLogout(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { localStorage.removeItem('chb-last-guest'); openGuestAuthModal(); });
    await page.waitForFunction(() => !!document.getElementById('login-email') && document.activeElement === document.getElementById('login-email'));
    ok(await page.evaluate(() => /Email or username/.test(document.querySelector('#ga-auth label[for="login-email"]').textContent) && /or your username/.test(document.getElementById('login-email').placeholder)), 'the box asks for "Email or username"');
    await page.fill('#login-email', 'Hannah.Reed');
    await page.click('#ga-auth [data-act="authContinue"]');
    const toCode = await stepIs(/Check your email/);
    const codeText = await page.evaluate(() => document.getElementById('ga-auth').textContent);
    ok(toCode && /the email on your account/.test(codeText) && !/hannah@example\.com/.test(codeText), 'a guest\'s username: the code goes to "the email on your account", never named');
    ok(sent('guest_code_request').some((p) => p.email === 'hannah.reed'), '…asked for with the lower-case name');
    if (toCode) await page.fill('#ga-code', '424242');
    await until(() => !document.getElementById('guest-auth-modal').classList.contains('open'));
    ok(sent('guest_code_verify').some((p) => p.email === 'hannah.reed' && p.code === '424242') && (await page.evaluate(() => !!currentGuest && currentGuest.email === 'hannah@example.com')), 'the code, sent with the username, signs the guest in');
    await page.evaluate(async () => { await guestLogout(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { localStorage.removeItem('chb-last-guest'); openGuestAuthModal(); });
    await page.waitForFunction(() => document.activeElement === document.getElementById('login-email'));
    await page.fill('#login-email', 'george');
    await page.click('#ga-auth [data-act="authContinue"]');
    ok(await stepIs(/Your password/) && /Forgotten your password\?/.test(await page.evaluate(() => document.getElementById('ga-auth').textContent)), 'a back-office username goes to its password, with the way to reset it');
    await page.click('#ga-auth [data-act="authToEmail"]');
    await page.waitForFunction(() => document.activeElement === document.getElementById('login-email'));
    await page.fill('#login-email', 'nobody');
    await page.click('#ga-auth [data-act="authContinue"]');
    await until(() => !document.getElementById('login-error').hidden);
    ok(/There’s no account with the username nobody/.test(await page.evaluate(() => document.getElementById('login-error').textContent)), 'a username nobody has is said so');
    await page.fill('#login-email', 'hannah.reed');
    await page.click('#ga-auth [data-act="authContinue"]');
    if (await stepIs(/Check your email/)) await page.click('#ga-auth [data-act="authToPassword"]');
    await stepIs(/Your password/);
    const pwText = await page.evaluate(() => document.getElementById('ga-auth').textContent);
    ok(/Email me a code instead/.test(pwText) && !/Forgotten your password\?/.test(pwText), 'a guest\'s username on the password step offers the code, not the back office\'s reset');
    const adminBefore = sent('admin_login').length;
    await page.fill('#login-password', 'not-my-password');
    await page.click('#ga-auth [data-submit="authPasswordGo"]');
    await until(() => !document.getElementById('login-error').hidden);
    ok(sent('guest_login').some((p) => p.email === 'hannah.reed') && sent('admin_login').length === adminBefore, 'its password goes to the guest sign-in, never the back office');
    M.codeServer = 'old';
    await page.click('#ga-auth [data-act="authToEmail"]');
    await page.waitForFunction(() => document.activeElement === document.getElementById('login-email'));
    await page.fill('#login-email', 'owner');
    await page.click('#ga-auth [data-act="authContinue"]');
    ok(await stepIs(/Your password/), 'an older server\'s plain answer still goes to the password, as a name with no @ always did');
    await page.evaluate(() => closeGuestAuthModal());
    await page.close();

    console.log('§7 your Guest list');
    const op = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    op.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await op.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await op.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
        let b = {};
        try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (url.includes('auth.php') && b.action === 'guest_crm') return json({ ok: true, guests: [
            { name: 'Hannah Reed', email: 'hannah@example.com', username: 'hannah.reed', stays: 2, ltv: 1240, last_stay: '2026-06-10', fav_prop: 'jollyboat', repeat: true, has_account: true },
            { name: 'Tom Harding', email: 'tom@example.com', username: '', stays: 1, ltv: 440, last_stay: '2026-04-02', fav_prop: '21a', repeat: false, has_account: false },
        ] });
        return json({ ok: true, bookings: [], enquiries: [], threads: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [] });
    });
    await op.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await op.waitForTimeout(900);
    await op.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await op.evaluate(() => window.loadAdminBundle());
    await op.evaluate(async () => { await openArea(); });
    await op.waitForTimeout(400);
    await op.evaluate(() => settingsOpen('guests'));
    await op.waitForSelector('#guest-admin-list .gst-row');
    const gl = await op.evaluate(() => {
        const r = document.querySelector('#guest-admin-list .acw-prow[data-gemail="hannah@example.com"]');
        const t = document.querySelector('#guest-admin-list .acw-prow[data-gemail="tom@example.com"]');
        return { un: (r.querySelector('.gst-main b .gst-un') || {}).textContent || '', tom: !!t.querySelector('.gst-un') };
    });
    ok(gl.un === 'hannah.reed' && !gl.tom, 'the username sits beside the name (and nothing for a guest without one)');
    await op.click('#guest-admin-list .acw-prow[data-gemail="hannah@example.com"] .gst-row');
    await op.waitForTimeout(300);
    ok(await op.evaluate(() => [...document.querySelectorAll('#guest-admin-list .acw-prow[data-gemail="hannah@example.com"] .gst-facts > div')].some((d) => /Username/.test(d.textContent) && /hannah\.reed/.test(d.textContent))), 'opened, the guest\'s facts carry it under Email');
    await op.fill('#gst-q', 'reed.h');
    await op.waitForTimeout(200);
    ok(await op.evaluate(() => document.querySelectorAll('#guest-admin-list .gst-row').length === 0), 'search on a part of no username finds nobody');
    await op.fill('#gst-q', 'hannah.re');
    await op.waitForTimeout(200);
    ok(await op.evaluate(() => document.querySelectorAll('#guest-admin-list .gst-row').length === 1), 'search finds a guest by their username');

    console.log(fails ? `\n  ${fails} CHECK(S) FAILED ❌\n` : '\n  ALL USERNAME CHECKS PASSED ✅\n');
    await done(fails);
})();
