// STYLE RULES THAT RE-CHECK THE WHOLE PAGE. A small change (one line of text, a
// class on one element, a chat bubble arriving) must restyle a handful of
// elements, never the page. Counted from the browser's own trace (the
// UpdateLayoutTree event's elementCount): a COUNT, not a timing, so a loaded
// machine can neither pass nor fail it. Before this, every text change anywhere
// restyled the whole page (756 elements on the home page, 2,742 on Today), which
// is what made typing in the search window and picking dates slow on a phone.
// Two shapes did it, and they did it TOGETHER: a :has() hung on <body> marks
// every element it looks through, and `.chat-thread:has(> .chat-hello) >
// :first-child` (a :has() before a subject that names nothing) then made any
// change to a marked element restyle everything. Either alone costs far less
// (the body rules alone: Today 12 → 88), which is why check-css-conventions
// refuses both shapes and this suite measures what is left.
//   1. the home page on a phone: text, a state class, a row added
//   2. the guest chat open on its welcome: a bubble arriving
//   3. Today on a phone and on a computer
//   4. Manage with a window open, and the search window hosting a section
//   5. the rules that asked with a :has() from <body> still do their job, both
//      ways: the screen flags, the window rules' scope, the two scroll locks, the
//      background drift, the Messages button's six stand-downs and the tab bar's
//      room for the faces
// On a failure it names the cause by loading the scene again with each shape of
// :has() rule taken out of the stylesheets BEFORE they arrive. Taking rules out
// of a page that has already loaded proves nothing: the marks they left on the
// elements stay, and measured, the count barely moved.
const { bootBrowser } = require('./ui-test-lib');

let fails = 0;
const ok = (b, m) => {
    console.log(`  ${b ? '✓' : '✗'} ${m}`);
    if (!b) fails++;
};
// Measured after the fix: 0 to 6 per change in every scene. The failures this
// exists for were 58 and up.
const LIMIT = 40;

// The shapes, as check-css-conventions reads them. Split at depth 0, outside
// () and [].
const splitTop = (str, isSep) => {
    const out = [];
    let depth = 0, cur = '';
    for (const c of str) {
        if (c === '(' || c === '[') depth++;
        if (c === ')' || c === ']') depth--;
        if (depth === 0 && isSep(c)) { out.push(cur); cur = ''; continue; }
        cur += c;
    }
    out.push(cur);
    return out;
};
const names = (cmp) => {
    const top = cmp.replace(/::[\w-]+(\([^)]*\))?/g, '');
    if (/^[a-zA-Z]/.test(top)) return true;
    let depth = 0, plain = '';
    for (const c of top) { if (c === '(') depth++; if (depth === 0) plain += c; if (c === ')') depth--; }
    return /[.#[]/.test(plain) || /:(is|where)\([^)]*[.#[a-zA-Z]/.test(top);
};
const shapeOf = (sel) => {
    const cs = splitTop(sel.trim(), (c) => /[\s>+~]/.test(c)).filter(Boolean);
    if (cs.some((c) => c.includes(':has(') && (/^(html|body)(?![\w-])/.test(c) || c.includes(':root')))) return 'hung on <body>';
    if (cs.slice(0, -1).some((c) => c.includes(':has(')) && !names(cs[cs.length - 1])) return 'before a subject that names nothing';
    return 'other :has()';
};
// A stylesheet with every selector of the given shapes swapped for one that
// matches nothing ('all' takes every :has() out). Returns the text and what went.
const without = (css, shapes) => {
    const gone = [];
    // Comments out first, or a comment that mentions :has() reads as a selector.
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{};]+)\{/g, (m, prelude) => {
        if (prelude.trim().startsWith('@') || !prelude.includes(':has(')) return m;
        const sels = splitTop(prelude, (c) => c === ',').map((s) => {
            if (!s.includes(':has(')) return s;
            if (shapes !== 'all' && !shapes.includes(shapeOf(s))) return s;
            gone.push(s.trim());
            return ' .chb-taken-out';
        });
        return sels.join(',') + '{';
    });
    return { text, gone };
};

const CHANGES = {
    'a line of text': () => {
        const all = document.querySelectorAll('.page-view.active p, footer p');
        const el = all[Math.floor(all.length / 2)];
        const t = el.textContent;
        el.textContent = t + ' ';
        void document.body.offsetHeight;
        el.textContent = t;
        void document.body.offsetHeight;
    },
    'a state class on one element': () => {
        const all = document.querySelectorAll('.page-view.active div, .page-view.active span');
        const el = all[Math.floor(all.length / 2)];
        for (const c of ['active', 'open']) {
            el.classList.add(c);
            void getComputedStyle(el).color;
            el.classList.remove(c);
            void getComputedStyle(el).color;
        }
    },
    'a row added and taken away': () => {
        const host = document.querySelector('.page-view.active') || document.body;
        const row = document.createElement('div');
        row.textContent = 'row';
        host.appendChild(row);
        void getComputedStyle(row).color;
        row.remove();
        void document.body.offsetHeight;
    },
    'a bubble arriving': () => {
        const th = document.querySelector('#chat-widget .chat-thread');
        const row = document.createElement('div');
        row.className = 'chat-row';
        row.innerHTML = '<div class="chat-rowin"><div class="chat-msg guest">Is there parking?</div></div>';
        th.appendChild(row);
        void getComputedStyle(row).color;
        row.remove();
        void document.body.offsetHeight;
    },
};

const SCENES = [
    { name: 'home', width: 390, changes: ['a line of text', 'a state class on one element', 'a row added and taken away'] },
    {
        name: 'chat on its welcome', width: 390, changes: ['a bubble arriving', 'a line of text'],
        setup: async (p) => {
            await p.evaluate(() => toggleChat());
            await p.waitForFunction(() => !!document.querySelector('#chat-widget.open .chat-thread > .chat-hello:first-child'), null, { timeout: 8000 });
        },
    },
    { name: 'Today 390', width: 390, owner: true, changes: ['a line of text', 'a state class on one element', 'a row added and taken away'] },
    { name: 'Today 1280', width: 1280, owner: true, changes: ['a line of text', 'a state class on one element', 'a row added and taken away'] },
    {
        name: 'Manage + window', width: 390, owner: true, changes: ['a line of text', 'a state class on one element', 'a row added and taken away'],
        setup: async (p) => {
            await p.evaluate(() => openArea());
            await p.waitForTimeout(300);
            await p.evaluate(() => { glassAlert('Checking the window rules'); });
            await p.waitForSelector('#glass-dialog.open', { timeout: 5000 });
        },
    },
    {
        name: 'search sheet', width: 390, owner: true, changes: ['a line of text', 'a state class on one element'],
        setup: async (p) => {
            await p.evaluate(() => { openCmdK(); cmdkSheetOpen('accom', 'Cottages'); });
            await p.waitForFunction(() => document.getElementById('cmdk').classList.contains('cmdk-sheet'), null, { timeout: 5000 });
        },
    },
];

(async () => {
    const t = await bootBrowser();
    // A fresh page for a scene. `take`: the :has() shapes to take out of the
    // stylesheets as they arrive (blame only).
    const newPage = async (width, owner, take) => {
        const page = await t.browser.newPage({ viewport: { width, height: 844 } });
        page.on('pageerror', (e) => {
            console.log('  PAGEERR:', e.message);
            fails++;
        });
        await page.addInitScript(() => {
            if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
        });
        if (take) {
            page.gone = [];
            await page.route(/\.css(\?|$)/, async (route) => {
                const res = await route.fetch();
                const w = without(await res.text(), take);
                page.gone.push(...w.gone);
                await route.fulfill({ status: 200, contentType: 'text/css', body: w.text });
            });
        }
        await page.route(/\.php/, (route) => {
            const body = route.request().postData() || '';
            const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
            if (owner && /admin_status/.test(body)) return json({ admin: true, me: { id: 1, name: 'Owner', full: true } });
            return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], reviews: [], photos: [], experiences: [], threads: [], logs: {}, events: [], payments: [] });
        });
        await page.goto(t.base + '/index.html');
        await page.waitForTimeout(1000);
        if (owner) {
            await page.evaluate(() => {
                isAuthenticated = true;
                document.body.classList.add('owner-mode');
            });
            await page.evaluate(() => window.loadAdminBundle());
            await page.waitForFunction(() => !!window.__ADMIN_LOADED, null, { timeout: 20000 });
            await page.evaluate(async () => {
                nav('view-backoffice');
                await initBackOffice();
            });
            await page.waitForTimeout(500);
        }
        const cdp = await page.context().newCDPSession(page);
        const events = [];
        cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
        // The fewest elements one run of the change restyled, over three runs: an
        // unrelated timer can only ever ADD to a run, so the least is the change's own.
        page.restyled = async (fn) => {
            let best = Infinity;
            for (let i = 0; i < 3; i++) {
                await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
                events.length = 0;
                await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
                await page.evaluate(fn);
                const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
                await cdp.send('Tracing.end');
                await done;
                best = Math.min(best, events.filter((e) => e.name === 'UpdateLayoutTree').reduce((s, e) => s + ((e.args && e.args.elementCount) || 0), 0));
            }
            return best;
        };
        return page;
    };

    // Names the cause: the scene again with every :has() taken out, then with each
    // shape taken out on its own.
    const blame = async (scene, what, count) => {
        const run = async (take) => {
            const p = await newPage(scene.width, scene.owner, take);
            if (scene.setup) await scene.setup(p);
            const n = await p.restyled(CHANGES[what]);
            const gone = p.gone;
            await p.close();
            return { n, gone };
        };
        const none = await run('all');
        if (none.n > LIMIT) {
            console.log(`      with no :has() rule at all it still restyles ${none.n}: look at rules keyed on what changed`);
            return;
        }
        let named = false;
        for (const shape of ['hung on <body>', 'before a subject that names nothing', 'other :has()']) {
            const r = await run([shape]);
            if (!r.gone.length || count - r.n <= (count - LIMIT) / 2) continue;
            named = true;
            console.log(`      the ${r.gone.length} :has() selector(s) ${shape}: ${count} → ${r.n} without them, e.g. ${[...new Set(r.gone)].slice(0, 3).join(' | ')}`);
        }
        if (!named) console.log(`      no single shape accounts for it (${count} → ${none.n} with every :has() out): the shapes act together`);
    };

    for (const scene of SCENES) {
        console.log(`· ${scene.name}`);
        const p = await newPage(scene.width, scene.owner);
        if (scene.name === 'home') ok(await p.evaluate(() => document.body.classList.contains('guest-app')), 'the guest shell is on (the pill rules apply)');
        if (scene.setup) await scene.setup(p);
        const total = await p.evaluate(() => document.getElementsByTagName('*').length);
        for (const what of scene.changes) {
            const n = await p.restyled(CHANGES[what]);
            ok(n <= LIMIT, `${scene.name}: ${what} restyles ${n} element(s) (at most ${LIMIT}; the page has ${total})`);
            if (n > LIMIT) await blame(scene, what, n);
        }
        await p.close();
    }

    console.log('5. the rules still do their job');
    const guest = await newPage(390, false);
    const owner = await newPage(390, true);
    // The two flags say exactly what the old :has() asked: is a one-look <main> the
    // active screen? Checked on every screen visited, owner and guest (an owner sent
    // to the public site is routed to Today, so the off side is the guest's).
    const flagsTrue = (page) => page.evaluate(() =>
        document.body.dataset.screen === (document.querySelector('.page-view.active') || {}).id &&
        document.body.classList.contains('one-look-view') === !!document.querySelector('main.one-look.active'));
    let flagsOk = true;
    for (const v of ['view-settings', 'view-inbox', 'view-accounts', 'view-keysafe', 'view-main', 'view-backoffice']) {
        await owner.evaluate((v) => nav(v), v);
        if (!(await flagsTrue(owner))) { flagsOk = false; console.log('      wrong on', v); }
    }
    for (const v of ['view-cottages', 'view-experiences', 'view-main']) {
        await guest.evaluate((v) => nav(v), v);
        if (!(await flagsTrue(guest))) { flagsOk = false; console.log('      wrong on (guest)', v); }
    }
    ok(flagsOk, 'data-screen names the screen on show, and one-look-view is on exactly while a one-look screen is up (9 screens)');
    ok(await guest.evaluate(() => !document.body.classList.contains('one-look-view')), 'the public site: one-look-view is off');
    await owner.evaluate(() => { openCmdK(); cmdkSheetOpen('accom', 'Cottages'); });
    ok(await owner.evaluate(() => document.body.classList.contains('one-look-sheet')), 'the search window hosting a section names itself on <body> (one-look-sheet)');
    await owner.evaluate(() => closeCmdK());
    await owner.waitForTimeout(300);
    ok(await owner.evaluate(() => !document.body.classList.contains('one-look-sheet') && !document.getElementById('cmdk').classList.contains('cmdk-sheet')), '…and stops once the section goes back');
    // The window rules' scope, both ways.
    const title = async (page) => {
        await page.evaluate(() => { glassAlert('Scope'); });
        await page.waitForSelector('#glass-dialog.open', { timeout: 5000 });
        const px = await page.evaluate(() => getComputedStyle(document.querySelector('#glass-dialog .glass-dialog-title')).fontSize);
        await page.evaluate(() => document.querySelector('#glass-dialog .glass-dialog-btns button').click());
        await page.waitForTimeout(300);
        return px;
    };
    await owner.evaluate(() => openArea());
    await owner.waitForTimeout(300);
    const overManage = await title(owner);
    const overSite = await title(guest);
    ok(overManage === '17px' && overSite !== overManage, `a window's title takes the one look over Manage (${overManage}) and not over the public site (${overSite})`);
    // The two scroll locks hold only while their own screen is up.
    const locked = () => owner.evaluate(() => getComputedStyle(document.body).overflowY === 'hidden');
    await owner.evaluate(() => { nav('view-inbox'); document.body.classList.add('ib-conv-open'); });
    ok(await locked(), 'a conversation open in the Inbox locks the page scroll');
    await owner.evaluate(() => nav('view-backoffice'));
    ok(!(await locked()), '…and a lingering flag does not lock Today');
    await owner.evaluate(() => { document.body.classList.remove('ib-conv-open'); nav('view-accounts'); document.body.classList.add('pm-detail-open'); });
    ok(await locked(), 'a Payments detail page locks the page scroll');
    await owner.evaluate(() => nav('view-backoffice'));
    ok(!(await locked()), '…and not once Payments is left');
    await owner.evaluate(() => document.body.classList.remove('pm-detail-open'));

    // The background drift: running on the home screen, paused on any other.
    const drift = () => guest.evaluate(() => getComputedStyle(document.querySelector('.blob')).animationPlayState);
    const fresh = await t.browser.newPage({ viewport: { width: 390, height: 844 } });
    await fresh.route(/\.php/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await fresh.goto(t.base + '/index.html');
    ok(await fresh.evaluate(() => getComputedStyle(document.querySelector('.blob')).animationPlayState) === 'running', 'the drift runs on the home screen the page arrives on');
    await fresh.close();
    await guest.evaluate(() => nav('view-cottages'));
    ok((await drift()) === 'paused', 'and pauses behind another screen');
    await guest.evaluate(() => nav('view-main'));
    ok((await drift()) === 'running', 'and runs again back home');

    // The Messages button: shown on the home screen, gone over each of the six.
    const pill = () => guest.evaluate(() => getComputedStyle(document.getElementById('guest-msg-fab')).display !== 'none');
    ok(await pill(), 'the Messages button shows on the home screen');
    for (const v of ['view-pay', 'view-experiences', 'view-guest-account']) {
        await guest.evaluate((v) => { nav(v); try { closeGuestAuthModal(); } catch (e) {} }, v);
        ok(!(await pill()), `…and stands down on ${v}`);
    }
    await guest.evaluate(() => nav('view-main'));
    ok(await pill(), '…and returns on the home screen');
    await guest.evaluate(() => document.getElementById('guest-auth-modal').classList.add('open'));
    ok(!(await pill()), 'it stands down over the sign-in sheet');
    await guest.evaluate(() => document.getElementById('guest-auth-modal').classList.remove('open'));
    await guest.evaluate(() => toggleChat());
    await guest.waitForSelector('#chat-widget.open', { timeout: 5000 });
    ok(!(await pill()), 'and while Messages is open');
    await guest.evaluate(() => closeChat());
    await guest.waitForTimeout(400);
    // My stays: only while a stay's tiles are up.
    await guest.evaluate(() => { nav('view-guest-bookings'); try { closeGuestAuthModal(); } catch (e) {} });
    ok(await pill(), 'on My stays with no stay card it shows');
    await guest.evaluate(() => document.getElementById('view-guest-bookings').insertAdjacentHTML('beforeend', '<div class="gb2-next" id="probe-next"></div>'));
    ok(!(await pill()), "…and stands down once the next stay's card is up");
    await guest.evaluate(() => { document.getElementById('probe-next').remove(); nav('view-main'); });

    // The tab bar makes room for the faces pill.
    const right = () => guest.evaluate(() => getComputedStyle(document.getElementById('guest-tabbar')).right);
    ok((await right()) === '88px', `without faces the book pill ends 88px from the edge (${await right()})`);
    await guest.evaluate(() => { chatTeamSet([{ id: 7, name: 'Sophia', line: 'Host', v: '' }], null); chatFabPaint(); });
    ok(await guest.evaluate(() => document.getElementById('guest-tabbar').classList.contains('gt-faces')), 'the faces mark the bar');
    ok((await right()) === '108px', `with faces it ends 108px from the edge (${await right()})`);
    await guest.evaluate(() => { chatTeamSet([], null); chatFabPaint(); });
    ok((await right()) === '88px' && !(await guest.evaluate(() => document.getElementById('guest-tabbar').classList.contains('gt-faces'))), 'and back to 88px when nobody is shown');

    await t.done(fails);
})().catch((e) => {
    console.log('  ✗ crashed:', e.message);
    process.exit(1);
});
