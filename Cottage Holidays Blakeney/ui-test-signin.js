// ui-test-signin.js — the code-first sign-in (the approved "Sign in, rethought" demo).
//   §1 one email field; a likely typo is offered as a fix BEFORE anything is sent
//   §2 a code is asked for; a wrong code says so; the right one signs in and lands on You
//   §3 the phone remembers who signed in — "Welcome back" — and "Not you?" forgets
//   §4 a new email needs only a name after the code
//   §5 a username with no @ (the owner) goes straight to a password; too many tries locks the code
const { bootBrowser } = require('./ui-test-lib');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

(async () => {
    const { browser, base, done } = await bootBrowser();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => { console.log('  PAGEERR:', e.message); fails++; });
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    const posts = [];
    let verifyMode = 'ok';
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (x, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(x) });
        let body = {};
        try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (route.request().method() === 'POST') posts.push(body);
        if (url.includes('auth.php')) {
            if (body.action === 'guest_code_request') return json({ ok: true });
            if (body.action === 'guest_code_verify') {
                if (body.code === '000000') return json({ error: "That code isn't right. Check the latest email and try again.", code: 'wrong', left: 4 }, 401);
                if (verifyMode === 'locked') return json({ error: 'Too many tries', code: 'too_many' }, 429);
                if (verifyMode === 'new') return json({ ok: true, new: true });
                return json({ ok: true, guest: { name: 'Gwen Rowe', email: body.email } });
            }
            if (body.action === 'guest_code_register') return json({ ok: true, guest: { name: body.name, email: 'sam@example.com' } });
            if (body.action === 'admin_login') return json({ error: 'nope' }, 401);
            if (body.action === 'guest_login') return json({ error: "That email and password don't match." }, 401);
            return json({ ok: true, admin: false, guest: null });
        }
        if (url.includes('passkeys.php')) return json({ error: 'no' }, 400);
        return json({ ok: true, bookings: [], events: [], results: [], threads: [], enquiries: [], reviews: [], photos: [], props: {}, mine: {}, value: null });
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    const step = () => page.evaluate(() => (document.querySelector('#ga-auth .ga-ah') || {}).textContent || '');
    const sent = (a) => posts.filter((p) => p.action === a);

    console.log('§1 one email field, and a typo caught first');
    await page.evaluate(() => { localStorage.removeItem('chb-last-guest'); openGuestAuthModal(); });
    await page.waitForTimeout(300);
    ok(/Sign in or create an account/.test(await step()), `it opens on one email field (${await step()})`);
    ok(await page.evaluate(() => !document.getElementById('tab-register') && !document.getElementById('reg-password')), 'no separate "Create account" form or password to invent');
    await page.fill('#login-email', 'gwen@gmial.com');
    await page.click('#ga-auth [data-act="authContinue"]');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => /gwen@gmail\.com/.test((document.querySelector('#ga-auth .ga-afix') || {}).textContent || '')), 'gmial.com is offered as gmail.com');
    ok(sent('guest_code_request').length === 0, '…before anything is sent');
    await page.click('#ga-auth .ga-afix button');
    await page.click('#ga-auth [data-act="authContinue"]');
    await page.waitForTimeout(400);
    ok(sent('guest_code_request').length === 1 && sent('guest_code_request')[0].email === 'gwen@gmail.com', `the code goes to the fixed address (${JSON.stringify(sent('guest_code_request')[0] || {})})`);

    console.log('§2 the code');
    ok(/Check your email/.test(await step()), 'it asks for the code from the email');
    ok(await page.evaluate(() => { const i = document.getElementById('ga-code'); return !!i && i.getAttribute('autocomplete') === 'one-time-code' && i.getAttribute('inputmode') === 'numeric'; }), 'the field offers iOS\'s "from Mail" code (one-time-code, numeric)');
    ok(await page.evaluate(() => { const b = document.getElementById('ga-resend'); return !!b && b.disabled && /in \d+s/.test(b.textContent); }), 'a new code waits 30 seconds');
    await page.fill('#ga-code', '000000');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => /isn't right/.test((document.getElementById('login-error') || {}).textContent || '') && document.getElementById('ga-codebox').classList.contains('is-bad')), 'a wrong code says so');
    await page.fill('#ga-code', '482913');
    await page.waitForTimeout(800);
    const inn = await page.evaluate(() => ({
        closed: !document.getElementById('guest-auth-modal').classList.contains('open'),
        you: document.getElementById('view-guest-account').classList.contains('active'),
        remembered: localStorage.getItem('chb-last-guest'),
    }));
    ok(inn.closed && inn.you, 'the right code signs in and lands on You');
    ok(/"first":"Gwen"/.test(inn.remembered || '') && /gwen@gmail\.com/.test(inn.remembered || ''), `the phone remembers who signed in — first name and email only (${inn.remembered})`);

    console.log('§3 welcome back');
    await page.evaluate(() => { currentGuest = null; setGuestUI(); openGuestAuthModal(); });
    await page.waitForTimeout(300);
    ok(/Welcome back/.test(await step()) && await page.evaluate(() => /Continue as Gwen/.test(document.getElementById('ga-auth').textContent)), '"Welcome back" with one button: Continue as Gwen');
    await page.click('#ga-auth [data-act="authKnownGo"]');
    await page.waitForTimeout(400);
    ok(sent('guest_code_request').length === 2 && /Check your email/.test(await step()), 'Continue sends the code straight away');
    await page.evaluate(() => { closeGuestAuthModal(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => openGuestAuthModal());
    await page.waitForTimeout(300);
    await page.click('#ga-auth [data-act="authNotYou"]');
    await page.waitForTimeout(200);
    ok(/Sign in or create/.test(await step()) && await page.evaluate(() => localStorage.getItem('chb-last-guest') === null), '"Not you?" forgets this phone\'s guest');

    console.log('§4 a new guest needs only a name');
    verifyMode = 'new';
    await page.fill('#login-email', 'sam@example.com');
    await page.click('#ga-auth [data-act="authContinue"]');
    await page.waitForTimeout(400);
    await page.fill('#ga-code', '135790');
    await page.waitForTimeout(500);
    ok(/Nice to meet you/.test(await step()), 'after the code a new email is asked only for a name');
    await page.click('#ga-auth [data-act="authCreate"]');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => /Add your name/.test(document.getElementById('login-error').textContent)), 'an empty name is refused in words');
    await page.fill('#ga-name', 'Sam Taylor');
    await page.click('#ga-auth [data-act="authCreate"]');
    await page.waitForTimeout(600);
    ok(sent('guest_code_register').some((p) => p.name === 'Sam Taylor' && !('password' in p) && !('address' in p)) && await page.evaluate(() => !document.getElementById('guest-auth-modal').classList.contains('open')), 'the account is made with the name alone — no password, no address');

    console.log('§5 the owner, and too many tries');
    await page.evaluate(() => { currentGuest = null; setGuestUI(); localStorage.removeItem('chb-last-guest'); openGuestAuthModal(); });
    await page.waitForTimeout(300);
    const before = sent('guest_code_request').length;
    await page.fill('#login-email', 'owner');
    await page.click('#ga-auth [data-act="authContinue"]');
    await page.waitForTimeout(300);
    ok(/Your password/.test(await step()) && sent('guest_code_request').length === before, 'a username with no @ goes straight to a password, no code sent');
    await page.fill('#login-password', 'wrongpass1');
    await page.click('#ga-auth [data-act="authPasswordGo"]');
    await page.waitForTimeout(500);
    ok(sent('admin_login').length >= 1 && await page.evaluate(() => !document.getElementById('login-error').hidden), 'the password tries the owner first, then says it doesn\'t match');
    verifyMode = 'locked';
    await page.click('#ga-auth [data-act="authToEmail"]');
    await page.fill('#login-email', 'gwen@example.com');
    await page.click('#ga-auth [data-act="authContinue"]');
    await page.waitForTimeout(400);
    await page.fill('#ga-code', '111222');
    await page.waitForTimeout(500);
    ok(/Too many tries/.test(await step()), 'too many tries retires the code and offers a new one');

    console.log(fails ? `\n${fails} FAILED` : '\nALL SIGN-IN CHECKS PASSED');
    await done(fails);
})();
