// ui-test-newsletter.js — newsletter sign-ups are confirmed by email (the security
// leftovers, step 4).
//
// The footer form used to say "You're in" the moment an address was typed, and the
// server put it on the list. Now the form says a link was emailed (nobody joins until
// it is opened), the emailed link opened on the page posts the confirmation and tidies
// the address bar, an expired link says so in the server's words, and Manage →
// Newsletter counts who is still to open the link apart from who is on the list.
const { bootBrowser, bootVerdict } = require('./ui-test-lib');

const PROPS = [{ prop_key: 'jollyboat', name: 'Jollyboat', slug: 'jollyboat', couple_rate: 140, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 4, max_children: 2, max_total: 6, sort_order: 1 }];
const NL = {
    ok: true,
    active: 42,
    waiting: 2,
    unsubscribed: 5,
    total: 49,
    recent: [
        { email: 'wren@example.com', name: 'Wren', created_at: '2026-10-10 09:00:00', confirmed_at: null, unsubscribed_at: null },
        { email: 'hannah@example.com', name: 'Hannah', created_at: '2026-10-09 09:00:00', confirmed_at: '2026-10-09 09:05:00', unsubscribed_at: null },
        { email: 'gone@example.com', name: 'Gone', created_at: '2026-10-08 09:00:00', confirmed_at: '2026-10-08 09:05:00', unsubscribed_at: '2026-10-09 10:00:00' },
        { email: 'otto@example.com', name: 'Otto', created_at: '2026-10-07 09:00:00', confirmed_at: null, unsubscribed_at: null },
    ],
};

let fails = 0;
// A wait that answers rather than throws, so a missing behaviour fails its own check.
const until = (page, fn) => page.waitForFunction(fn, null, { timeout: 8000 }).then(() => true, () => false);
const check = (cond, label) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + label);
    if (!cond) fails++;
};

(async () => {
    const t = await bootBrowser();
    const posts = [];
    let confirmAnswer = { status: 200, body: { ok: true } };
    const open = async (path) => {
        const page = await t.browser.newPage({ viewport: { width: 390, height: 844 } });
        page.setDefaultTimeout(8000);
        page.on('pageerror', (e) => {
            fails++;
            console.log('PAGEERR', e.message);
        });
        await page.addInitScript(() => {
            if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
        });
        await page.route(/\.php/, (r) => {
            const url = r.request().url();
            const json = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
            if (url.includes('newsletter.php')) {
                if (r.request().method() !== 'POST') return json(NL);
                const b = JSON.parse(r.request().postData() || '{}');
                posts.push(b);
                return b.action === 'confirm' ? json(confirmAnswer.body, confirmAnswer.status) : json({ ok: true });
            }
            if (url.includes('rates.php')) return json({ properties: PROPS, seasons: {}, occupancy: {} });
            return json({ ok: true, bookings: [], enquiries: [], threads: [], messages: [], content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, feeds: [], properties: PROPS });
        });
        await page.goto(t.base + path);
        await page.waitForTimeout(1200);
        return page;
    };

    console.log('§1 the footer form says what happened');
    let page = await open('/index.html');
    await page.evaluate(() => document.getElementById('nl-email').scrollIntoView());
    await page.fill('#nl-email', 'hannah@example.com');
    await page.press('#nl-email', 'Enter');
    await until(page, () => /inbox|in —|in -/.test((document.getElementById('nl-msg') || {}).textContent || ''));
    const p1 = await page.evaluate(() => ({ msg: document.getElementById('nl-msg').textContent, field: document.getElementById('nl-email').value }));
    const sub = posts.find((b) => b.action === 'subscribe') || {};
    check(sub.email === 'hannah@example.com' && sub.source === 'footer', `the sign-up is posted (${JSON.stringify(sub)})`);
    check(/^Check your inbox: tap the link we’ve sent to hannah@example\.com to confirm\./.test(p1.msg), `it says a link was emailed, to the address typed (${p1.msg})`);
    check(/Already on our list\? Then you’re all set\./.test(p1.msg), 'it is true for someone already on the list too');
    check(!/You're in|You’re in/.test(p1.msg), 'it never says they are in before they confirm');
    check(p1.field === '', 'the field is cleared');
    await page.close();

    console.log('§2 the emailed link, opened');
    const tok = '0123456789abcdef0123456789abcdef';
    page = await open(`/index.html?nlconfirm=${tok}&t=1791734100&k=fedcba9876543210fedcba9876543210`);
    await until(page, () => /on the list/.test(document.body.textContent || ''));
    const conf = posts.filter((b) => b.action === 'confirm');
    const p2 = await page.evaluate(() => {
        const toast = [...document.querySelectorAll('.toast .toast-body span')].map((x) => x.textContent).join(' | ');
        return { toast, search: location.search, err: !!document.querySelector('.toast.toast-err') };
    });
    check(conf.length === 1 && conf[0].token === tok && conf[0].t === '1791734100' && conf[0].k === 'fedcba9876543210fedcba9876543210', `the page posts the confirmation once, with the link's parts (${JSON.stringify(conf)})`);
    check(/You’re on the list — thank you/.test(p2.toast) && !p2.err, `it says they are on the list (${p2.toast})`);
    check(await until(page, () => location.search === ''), 'the address bar is tidied, so a refresh posts nothing');
    await page.close();

    console.log('§3 an expired link says so');
    confirmAnswer = { status: 410, body: { error: 'That link has expired. Sign up again and we’ll send you a fresh one.', code: 'expired' } };
    page = await open(`/index.html?nlconfirm=${tok}&t=1&k=fedcba9876543210fedcba9876543210`);
    await until(page, () => /expired/.test(document.body.textContent || ''));
    const p3 = await page.evaluate(() => {
        const t = document.querySelector('.toast.toast-err');
        return { text: t ? t.textContent : '', role: t ? t.getAttribute('role') : '', ok: /on the list/.test(document.body.textContent || '') };
    });
    check(/That link has expired\. Sign up again/.test(p3.text) && p3.role === 'alert', `the server's sentence, as an alert (${p3.text})`);
    check(!p3.ok, 'and never that they are on the list');
    check(await until(page, () => location.search === ''), 'the address bar is tidied there too');
    await page.close();

    console.log('§4 Manage → Newsletter counts who is waiting');
    page = await open('/index.html');
    await bootVerdict(page);
    await page.evaluate(() => {
        isAuthenticated = true;
        document.body.classList.add('owner-mode');
        window.__me = { id: 1, name: 'George Farrow', full: true };
    });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForFunction(() => window.__ADMIN_LOADED === true);
    await page.evaluate(async () => {
        await openArea();
        settingsOpen('newsletter');
    });
    await page.waitForSelector('#newsletter-stats .u-stats');
    const p4 = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll('#newsletter-stats .u-stat')].map((x) => x.querySelector('.u-stat-l').textContent + '=' + x.querySelector('.u-stat-n').textContent);
        const grp = (k) => {
            const g = document.getElementById('bhub-fold-' + k);
            const row = g && g.closest('.bhub-fold-grp');
            return row ? { text: row.textContent, inner: g.textContent } : null;
        };
        return { tiles, subs: grp('nlsubs'), wait: grp('nlwait'), over: document.documentElement.scrollWidth - innerWidth };
    });
    check(p4.tiles.join('|') === 'Active subscribers=42|Waiting to confirm=2', `two tiles: on the list, and waiting (${p4.tiles.join('|')})`);
    check(p4.subs && /hannah@example\.com/.test(p4.subs.inner) && !/wren@|otto@|gone@/.test(p4.subs.inner), `who's subscribed lists confirmed addresses only (${p4.subs && p4.subs.inner})`);
    check(p4.subs && /5 unsubscribed/.test(p4.subs.text), 'the unsubscribed count rides that row');
    check(p4.wait && /Waiting to confirm/.test(p4.wait.text) && /No newsletters until they confirm/.test(p4.wait.text) && /wren@example\.com/.test(p4.wait.inner) && /otto@example\.com/.test(p4.wait.inner) && !/hannah@/.test(p4.wait.inner), `the waiting fold lists who has still to open the link (${p4.wait && p4.wait.inner})`);
    check(p4.over <= 0, 'nothing wider than the phone');
    // The send button's confirm states the scale, and the scale is the confirmed count.
    await page.fill('#nl-subject', 'Autumn');
    await page.fill('#nl-body', 'The seals are back.');
    await page.click('[data-act="sendBroadcast"]');
    await page.waitForFunction(() => {
        const g = document.getElementById('glass-dialog');
        return g && g.classList.contains('open');
    });
    const okLabel = await page.evaluate(() => document.getElementById('glass-dialog-ok').textContent.trim());
    check(okLabel === 'Send to 42 subscribers', `the send confirm counts confirmed subscribers only (${okLabel})`);
    await page.click('#glass-dialog-cancel');
    await page.waitForTimeout(300);
    check(!posts.some((b) => b.action === 'broadcast'), 'backing out sends nothing');
    await page.close();

    console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL NEWSLETTER CHECKS PASSED');
    await t.done(fails);
})().catch(async (e) => {
    console.error('FAILED:', e);
    process.exit(1);
});
