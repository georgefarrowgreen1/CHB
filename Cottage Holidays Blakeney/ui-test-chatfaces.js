// ui-test-chatfaces.js — the Messages button shows who answers (the approved Messages demo).
//   §1 a first visit: the icon until the server answers, then both faces, asked once
//   §2 a fresh copy on this device: the faces at first paint, nothing asked
//   §3 a stale copy: the faces it had at once, asked again, and a change follows
//   §4 nobody shown: the icon and its own name, kept or put back
//   §5 a computer: the round button becomes the pill of faces and "Messages"
//   §6 the chat's own answer moves the button too
//   §7 never asked for the owner, nor in a preview
//   §8 the cottage page: the book pill and the Messages pill never touch, 320–768px
//   §9 the faces settle in only when they replace something
//   §10 words from the server are sanitised: no markup reaches the button
//   §11 an answer with no team in it is not asked about again on every refresh
// messages.php is stubbed from `state`, so each section sets the facts it is about
// and asks the REAL client to draw them.
const { bootBrowser } = require('./ui-test-lib');

let fails = 0;
const ok = (c, m) => {
    console.log((c ? '  ✓ ' : '  ✗ ') + m);
    if (!c) fails++;
};
const PROPS = [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 140, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 2, max_total: 6, sort_order: 1 }];
const TEAM = [
    { id: 1, name: 'Sophia', line: 'Host', v: 'abcdef0123' },
    { id: 2, name: 'George', line: 'Bookings & Website', v: '' },
];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const HOUR = 3600e3;

(async () => {
    const { browser, base, done } = await bootBrowser();
    // One page per case. `seed` is this device's copy before the page loads
    // ({team, age} — age in ms, or no seed at all); `state.team` is what the server
    // answers; `admin` signs the page in as the owner.
    const open = async (o) => {
        const opts = Object.assign({ vp: { width: 390, height: 844 }, seed: null, state: {}, admin: false, url: '/index.html', hold: false, theme: 'light' }, o || {});
        const state = Object.assign({ team: TEAM, away: { on: false, until: null }, threadTeam: null }, opts.state);
        const page = await browser.newPage({ viewport: opts.vp });
        page.setDefaultTimeout(8000);
        page.on('pageerror', (e) => {
            console.log('  PAGEERR:', e.message);
            fails++;
        });
        await page.addInitScript(([seed, theme]) => {
            if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
            try {
                localStorage.setItem('chb-theme', theme);
            } catch (e) {}
            if (!seed) return;
            try {
                localStorage.setItem('chb-chat-team', JSON.stringify(seed.team));
                localStorage.setItem('chb-chat-team-at', String(Date.now() - seed.age));
            } catch (e) {}
        }, [opts.seed, opts.theme]);
        const asks = [];
        let release = null;
        const held = opts.hold ? new Promise((r) => (release = r)) : null;
        await page.route(/\.php/, async (route) => {
            const url = route.request().url();
            const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
            let b = {};
            try {
                b = JSON.parse(route.request().postData() || '{}');
            } catch (e) {}
            if (url.includes('avatar.php')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
            if (url.includes('messages.php')) {
                if (b.action === 'faces') {
                    asks.push(Date.now());
                    if (held) await held;
                    // `old: true` is a server from before 'faces': an answer with no team.
                    if (state.old) return json({ ok: true, messages: [] });
                    return json({ ok: true, team: state.team, away: state.away });
                }
                const out = { ok: true, messages: [], peer_typing: false, typing_by: 0 };
                if (b.team) Object.assign(out, { team: state.threadTeam || state.team, away: state.away });
                return json(out);
            }
            if (url.includes('auth.php')) {
                if (opts.admin && b.action === 'admin_status') return json({ ok: true, authenticated: true, admin: true, me: { id: 1, name: 'Sophia', full: true } });
                return json({ ok: true, admin: false, guest: null, authenticated: false });
            }
            if (url.includes('content.php') || url.includes('bootstrap.php')) return json({ ok: true, content: { 'host-name': 'Sophia' }, rates: { properties: PROPS, seasons: {}, occupancy: {} } });
            if (url.includes('rates.php')) return json({ properties: PROPS, seasons: {}, occupancy: {} });
            return json({ ok: true, bookings: [], enquiries: [], reviews: [], photos: [], props: {}, events: [], blocks: [], ranges: [] });
        });
        await page.goto(base + opts.url, { waitUntil: 'domcontentloaded' });
        return { page, asks, state, release: () => release && release() };
    };
    const pill = (page) =>
        page.evaluate(() => {
            const b = document.querySelector('#guest-msg-fab .guest-dock-btn');
            if (!b) return null;
            const faces = [...b.querySelectorAll('.chat-ava')];
            return {
                faces: faces.length,
                has: b.classList.contains('has-faces'),
                icon: !!b.querySelector('svg'),
                label: b.getAttribute('aria-label'),
                title: b.title,
                photo: faces[0] ? faces[0].style.backgroundImage : '',
                initial: faces[1] ? faces[1].textContent : '',
                arriving: b.classList.contains('is-arriving'),
                anims: faces.reduce((n, f) => n + f.getAnimations().length, 0),
            };
        });
    const settle = (page, ms) => page.waitForTimeout(ms || 1500);

    console.log('§1 a first visit: the icon until the server answers, then both faces');
    {
        const { page, asks, release } = await open({ hold: true });
        await page.waitForFunction(() => !!document.querySelector('#guest-msg-fab .guest-dock-btn'));
        await settle(page, 900);
        const before = await pill(page);
        ok(!!before && before.icon && !before.has && before.faces === 0, 'until the answer lands, the button is the icon it always was');
        ok(before && before.label === 'Messages', `…named as it always was (${before && before.label})`);
        release();
        await page.waitForFunction(() => document.querySelectorAll('#guest-msg-fab .chat-ava').length === 2).catch(() => {});
        const after = await pill(page);
        ok(after.has && after.faces === 2 && !after.icon, 'then the two faces stand where the icon stood');
        ok(/avatar\.php\?team=1&v=abcdef0123/.test(after.photo), `a face is the person's photo from the public route (${after.photo})`);
        ok(after.initial === 'G', `someone with no photo is their initial (${after.initial})`);
        ok(after.label === 'Messages with Sophia & George' && after.title === after.label, `the button says who it reaches (${after.label})`);
        ok(asks.length === 1, `asked once (${asks.length})`);
        const at = await page.evaluate(() => +localStorage.getItem('chb-chat-team-at'));
        ok(at > 0 && Date.now() - at < 60e3, 'the answer is kept on this device with when it came');
        await page.close();
    }

    console.log('§2 a fresh copy on this device: faces at first paint, nothing asked');
    {
        const { page, asks } = await open({ seed: { team: TEAM, age: HOUR }, hold: true });
        await page.waitForFunction(() => !!document.querySelector('#guest-msg-fab .guest-dock-btn'));
        const first = await pill(page);
        ok(first.has && first.faces === 2, 'the faces are there from the first paint');
        ok(!first.arriving, '…without an entrance: nothing arrived, they were already known');
        await settle(page, 1500);
        ok(asks.length === 0, `and the server is not asked again within the hour (${asks.length})`);
        await page.close();
    }

    console.log('§3 a stale copy: the faces it had, asked again, and a change follows');
    {
        // The answer is held until the first read, or a fast one lands before it.
        const { page, asks, release } = await open({ seed: { team: TEAM, age: 7 * HOUR }, state: { team: [TEAM[1]] }, hold: true });
        await page.waitForFunction(() => !!document.querySelector('#guest-msg-fab .guest-dock-btn'));
        const first = await pill(page);
        ok(first.faces === 2, 'the faces it had show at once, while it asks');
        release();
        await page.waitForFunction(() => document.querySelectorAll('#guest-msg-fab .chat-ava').length === 1).catch(() => {});
        const after = await pill(page);
        ok(asks.length === 1, `a copy over six hours old is asked about again (${asks.length})`);
        ok(after.faces === 1 && after.label === 'Messages with George', `someone no longer shown leaves the button (${after.label})`);
        await page.close();
    }

    console.log('§4 nobody shown: the icon and its own name');
    {
        const { page } = await open({ state: { team: [] } });
        await page.waitForFunction(() => !!document.querySelector('#guest-msg-fab .guest-dock-btn'));
        await settle(page);
        const p = await pill(page);
        ok(p.icon && !p.has && p.faces === 0 && p.label === 'Messages', 'with nobody shown the button keeps its icon and name');
        await page.close();
        const two = await open({ seed: { team: TEAM, age: 7 * HOUR }, state: { team: [] } });
        await two.page.waitForFunction(() => !document.querySelector('#guest-msg-fab .has-faces')).catch(() => {});
        const q = await pill(two.page);
        ok(q.icon && !q.has && q.label === 'Messages', 'faces this device had are put back to the icon when the answer is nobody');
        const fab = await two.page.evaluate(() => {
            const f = document.getElementById('chat-fab');
            return { svg: !!f.querySelector('svg'), has: f.classList.contains('has-faces'), label: f.getAttribute('aria-label'), title: f.title };
        });
        ok(fab.svg && !fab.has && fab.label === 'Chat with us' && fab.title === 'Chat with us', `…and so is the round button, with its own name (${fab.label})`);
        await two.page.close();
    }

    console.log('§5 a computer: the round button becomes the pill of faces and "Messages"');
    {
        for (const theme of ['dark', 'light']) {
            const { page } = await open({ vp: { width: 1280, height: 900 }, seed: { team: TEAM, age: HOUR }, theme });
            await page.waitForFunction(() => document.querySelectorAll('#chat-fab .chat-ava').length === 2);
            await settle(page, 700);
            const isLight = await page.evaluate(() => document.body.classList.contains('light-mode'));
            ok(isLight === (theme === 'light'), `${theme}: (control) the page is in the ${theme} theme`);
            const f = await page.evaluate(() => {
                const el = document.getElementById('chat-fab');
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                const ava = el.querySelector('.chat-ava + .chat-ava');
                const probe = document.createElement('div');
                probe.style.background = 'var(--sheet-surface)';
                document.body.appendChild(probe);
                const sheet = getComputedStyle(probe).backgroundColor;
                probe.remove();
                return {
                    text: (el.querySelector('.chat-fab-l') || {}).textContent || '',
                    label: el.getAttribute('aria-label'),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                    right: Math.round(innerWidth - r.right),
                    bg: cs.backgroundColor,
                    sheet,
                    ring: ava ? getComputedStyle(ava).boxShadow : '',
                    visible: cs.display !== 'none' && r.width > 0,
                };
            });
            ok(f.visible && f.text === 'Messages', `${theme}: the faces, then the word Messages`);
            ok(f.label === 'Messages with Sophia & George', `${theme}: …named for who it reaches, with the word it shows first (${f.label})`);
            ok(f.h >= 44 && f.w > f.h * 2, `${theme}: a pill, at least 44px tall (${f.w}×${f.h})`);
            ok(f.bg === f.sheet, `${theme}: on the sheet's ground (${f.bg})`);
            ok(f.ring.indexOf(f.sheet) === 0, `${theme}: each face's ring is cut from that ground (${f.ring})`);
            await page.close();
        }
    }

    console.log('§6 the chat\'s own answer moves the button too');
    {
        const { page } = await open({ vp: { width: 1280, height: 900 }, seed: { team: TEAM, age: HOUR }, state: { threadTeam: [TEAM[0]] } });
        await page.waitForFunction(() => document.querySelectorAll('#chat-fab .chat-ava').length === 2);
        await page.evaluate(() => toggleChat());
        await page.waitForFunction(() => document.querySelectorAll('#chat-fab .chat-ava').length === 1).catch(() => {});
        await page.evaluate(() => closeChat());
        await settle(page, 500);
        const f = await page.evaluate(() => ({ n: document.querySelectorAll('#chat-fab .chat-ava').length, label: document.getElementById('chat-fab').getAttribute('aria-label') }));
        ok(f.n === 1 && f.label === 'Messages with Sophia', `the team the chat was told is the team the button shows (${f.label})`);
        await page.close();
    }

    console.log('§7 never asked for the owner, nor in a preview');
    {
        const own = await open({ admin: true });
        await settle(own.page, 2500);
        ok(await own.page.evaluate(() => isAuthenticated === true), '(control) the page is signed in as the owner');
        ok(own.asks.length === 0, `the owner's screens have no Messages button, so nothing is asked (${own.asks.length})`);
        await own.page.close();
        const pre = await open({ url: '/index.html?preview=1' });
        await settle(pre.page, 2500);
        ok(await pre.page.evaluate(() => PREVIEW_MODE === true && isAuthenticated !== true), '(control) the page is a preview, signed in as nobody');
        ok(pre.asks.length === 0, `nor in a preview, which refuses every post by design (${pre.asks.length})`);
        await pre.page.close();
    }

    console.log('§8 the cottage page: the book pill and the Messages pill never touch');
    for (const withFaces of [true, false]) {
        const { page } = await open({ seed: withFaces ? { team: TEAM, age: HOUR } : null, state: { team: withFaces ? TEAM : [] } });
        await settle(page, 1200);
        await page.evaluate(() => openProperty('jollyboat'));
        await settle(page, 600);
        const rows = [];
        for (const w of [320, 340, 360, 375, 390, 414, 430, 480, 481, 520, 600, 768]) {
            await page.setViewportSize({ width: w, height: 800 });
            await page.waitForTimeout(150);
            rows.push(
                await page.evaluate((width) => {
                    const p = document.querySelector('#guest-msg-fab .guest-dock');
                    const c = document.getElementById('guest-book-cta');
                    if (!p || !c || !p.getClientRects().length || !c.getClientRects().length) return { width, gap: null };
                    const a = p.getBoundingClientRect();
                    const b = c.getBoundingClientRect();
                    return { width, gap: Math.round(a.left - b.right), inside: b.left >= 0 && a.right <= innerWidth };
                }, w),
            );
        }
        const shown = rows.filter((r) => r.gap !== null);
        const worst = shown.reduce((m, r) => (r.gap < m.gap ? r : m), { gap: 1e9 });
        ok(shown.length === rows.length, `${withFaces ? 'faces' : 'icon'}: both pills are on screen at every width (${shown.length}/${rows.length})`);
        ok(worst.gap >= 8, `${withFaces ? 'faces' : 'icon'}: at least 8px apart at every width (closest ${worst.gap}px at ${worst.width}px)`);
        ok(shown.every((r) => r.inside), `${withFaces ? 'faces' : 'icon'}: neither leaves the screen`);
        await page.close();
    }

    console.log('§9 the faces settle in only when they replace something');
    {
        const { page } = await open({ hold: true });
        await page.waitForFunction(() => !!document.querySelector('#guest-msg-fab .guest-dock-btn'));
        await settle(page, 600);
        await page.evaluate(() => chatTeamApply([{ id: 1, name: 'Sophia', line: 'Host', v: '' }, { id: 2, name: 'George', line: '', v: '' }], null));
        const a = await pill(page);
        ok(a.arriving && a.anims >= 2, `replacing the icon, the faces settle in (${a.anims} animations)`);
        await page.close();
    }

    console.log('§10 words from the server are sanitised');
    {
        const { page } = await open({ state: { team: [{ id: 3, name: '<img src=x onerror="window.__pwned=1">', line: '', v: '"><b>x</b>' }, { id: 0, name: 'Nobody', line: '', v: '' }] } });
        await page.waitForFunction(() => document.querySelectorAll('#guest-msg-fab .chat-ava').length === 1).catch(() => {});
        await settle(page, 400);
        const s = await page.evaluate(() => ({
            pwned: !!window.__pwned,
            imgs: document.querySelectorAll('#guest-msg-fab img, #chat-fab img').length,
            photo: (document.querySelector('#guest-msg-fab .chat-ava') || {}).style ? document.querySelector('#guest-msg-fab .chat-ava').style.backgroundImage : '',
            faces: document.querySelectorAll('#guest-msg-fab .chat-ava').length,
        }));
        ok(!s.pwned && s.imgs === 0, 'a name carrying markup is shown as words, never run');
        ok(s.faces === 1 && s.photo === '', 'a photo version that is not one is dropped, and a member with no id is not shown');
        await page.close();
    }

    console.log('§11 an answer with no team in it is not asked about again on every refresh');
    {
        const { page, asks } = await open({ state: { old: true } });
        await page.waitForFunction(() => !!document.querySelector('#guest-msg-fab .guest-dock-btn'));
        await settle(page, 1200);
        await page.evaluate(async () => {
            await liveUpdateTick();
            await liveUpdateTick();
        });
        await settle(page, 400);
        const p = await pill(page);
        ok(asks.length === 1, `asked once, then left for ten minutes, refreshes or not (${asks.length})`);
        ok(p.icon && !p.has, '…and the button keeps its icon');
        await page.close();
    }

    console.log(fails ? `\n  ${fails} CHECK(S) FAILED ❌\n` : '\n  ALL MESSAGES-BUTTON CHECKS PASSED ✅\n');
    await done(fails);
})().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
