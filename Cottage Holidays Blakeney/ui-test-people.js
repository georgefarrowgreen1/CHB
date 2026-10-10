// ui-test-people.js — the people who sign in, and what each is offered.
//   §A the owner's Permissions pages: who signs in, adding someone (with a role,
//      never a password), who gets which emails, one person's page (the role,
//      What X can do with a switch per permission, their emails, passkeys only
//      when they have one, a reset link, removal and giving access back)
//   §B what a HOST sees, permission by permission: the menus and rail, Manage,
//      Today's jobs, the money buttons and the booking form's money parts; a
//      stale tap refused in the server's words; their own alerts and emails
//   §C the sign-in page's back-office steps: a new device's code at the person's
//      own inbox, the three ways in, a forgotten password, an invite, a reset,
//      a dead link, and a switched-off sign-in said in words
// The server holds every rule regardless (test-people.php, test-integration §51);
// this suite holds what each person is OFFERED. The fixture below speaks the
// server's real shapes: people-lib.php's PEOPLE_PERMS and people_public, and
// people.php's list payload (permDefs + permGroups beside the people).
const { bootBrowser, d } = require('./ui-test-lib');

let fails = 0;
const ok = (c, m) => {
    console.log((c ? '  ✓ ' : '  ✗ ') + m);
    if (!c) fails++;
};

// ---- people-lib.php, said once for the fixture ----
// [key, label, group, fixed]: 'always' is on for everyone, 'super' a Super User's only.
const PERMS = [
    ['bk.see', 'See bookings and the calendar', 'bk', 'always'],
    ['bk.edit', 'Add and change bookings', 'bk', ''],
    ['bk.cancel', 'Cancel bookings', 'bk', ''],
    ['bk.block', 'Block dates', 'bk', ''],
    ['gu.reply', 'Reply to enquiries and messages', 'gu', ''],
    ['gu.approve', 'Approve or decline enquiries', 'gu', ''],
    ['gu.reviews', 'Approve reviews and photos', 'gu', ''],
    ['ks.see', 'See door codes', 'ks', ''],
    ['ks.change', 'Change door codes', 'ks', ''],
    ['mo.ask', 'Ask guests to pay', 'mo', ''],
    ['mo.record', 'Record payments', 'mo', ''],
    ['mo.refund', 'Give refunds', 'mo', ''],
    ['mo.deposit', 'Return or keep deposits', 'mo', ''],
    ['mo.view', 'See the Payments page and the books', 'mo', ''],
    ['mo.exp', 'Add expenses', 'mo', ''],
    ['co.prices', 'Change prices and seasons', 'co', ''],
    ['co.pages', 'Edit cottage pages', 'co', ''],
    ['co.sync', 'Calendar sync', 'co', ''],
    ['we.content', 'Home page and things to do', 'we', ''],
    ['we.news', 'Send the newsletter', 'we', ''],
    ['we.stats', 'See analytics', 'we', ''],
    ['su.perm', 'Permissions', 'su', 'super'],
    ['su.sys', 'Backups, status and integrations', 'su', 'super'],
];
const PERM_GROUPS = { bk: 'Bookings', gu: 'Guests & messages', ks: 'Key safes', mo: 'Money', co: 'Cottages & prices', we: 'Website', su: 'Set-up' };
const HOST = Object.fromEntries(PERMS.map(([k, , g, f]) => [k, f === 'always' || (f === '' && ['bk', 'gu', 'ks', 'mo'].includes(g))]));
const PERM_DEFS = PERMS.map(([k, t, g, f]) => ({ k, t, g, fixed: f, host: HOST[k] }));
// Who gets which emails (people-lib.php PEOPLE_MAILS): the permission each needs.
const KINDS = ['enquiry', 'booking', 'paid', 'messages', 'reviews', 'ideas', 'digest', 'analytics', 'backup'];
const MAIL_CAP = { enquiry: 'gu.reply', booking: 'all', paid: 'mo.record', messages: 'gu.reply', reviews: 'gu.reviews', ideas: 'we.content', digest: 'all', analytics: 'we.stats', backup: 'owner' };
const MUST = { enquiry: 'new enquiries — a guest is waiting for a reply', messages: 'guest messages — guests are waiting for an answer', backup: 'the backup — it’s the copy that lives off the host' };
const MAIL_KINDS = KINDS.map((k) => ({ k, cap: MAIL_CAP[k], must: !!MUST[k] }));
const ALL = Object.fromEntries(KINDS.map((k) => [k, true]));
const LIMITED = { enquiry: true, booking: true, paid: true, messages: true, reviews: true, ideas: false, digest: true, analytics: false, backup: false };

// One stored person → what people_public + people_mail_payload send (the list),
// and admin_me_payload adds the rest for the person signed in.
function shape(row, viewerId) {
    const full = !!row.full;
    const perms = {};
    PERMS.forEach(([k, , , f]) => {
        perms[k] = full ? true : f === 'always' ? true : f === 'super' ? false : k in (row.own || {}) ? !!row.own[k] : HOST[k];
    });
    const changes = full ? 0 : PERMS.filter(([k, , , f]) => f === '' && perms[k] !== HOST[k]).length;
    const can = (cap) => (row.state === 'removed' ? false : full || cap === 'all' ? true : cap === 'owner' ? false : !!perms[cap]);
    const any = (ks) => ks.some(can);
    const mail = Object.assign({}, full ? ALL : LIMITED, row.mailOwn || {});
    const mailCan = Object.fromEntries(KINDS.map((k) => [k, can(MAIL_CAP[k])]));
    return {
        id: row.id,
        name: row.name,
        first: row.name.split(' ')[0],
        named: true,
        email: row.email,
        contact: row.email,
        username: row.username,
        full,
        role: full ? 'super' : 'host',
        perms,
        changes,
        caps: { payments: any(['mo.ask', 'mo.record']), refunds: any(['mo.refund', 'mo.deposit']), money: can('mo.view'), prices: any(['co.prices', 'co.pages', 'co.sync']), website: any(['we.content', 'we.news', 'we.stats']) },
        photo: '',
        state: row.state,
        you: row.id === viewerId,
        seen: row.seen || '',
        invited: row.state === 'invited' ? '2026-10-08 10:00:00' : '',
        removed: row.state === 'removed' ? '2026-10-08 10:00:00' : '',
        passkeys: row.passkeys || 0,
        mail,
        mailCan,
        mailGets: KINDS.filter((k) => mailCan[k] && row.state === 'active' && mail[k]),
    };
}
const meOf = (row, notify) => Object.assign(shape(row, row.id), { twofa: true, twofaLive: true, original: row.id === 1, notify });
const NOTIFY = { money: true, enquiries: true, messages: true, checkout: true, system: true, quietFrom: '', quietTo: '' };

// George is the Super User. Sophia is a Host from before permissions: her old
// switches (Take payments on; refunds, money overview off) came over as the
// permissions they covered, which is four changes from a plain Host — the
// "Host · 4 changes" the live site shows for her.
const GEORGE_ROW = { id: 1, name: 'George Farrow', email: 'george@example.com', username: 'george', full: true, state: 'active', passkeys: 0 };
const SOPHIA_OWN = { 'mo.refund': false, 'mo.deposit': false, 'mo.view': false, 'mo.exp': false };
const SOPHIA_ROW = { id: 2, name: 'Sophia Hart', email: 'sophia@example.com', username: 'sophiahart', full: false, own: Object.assign({}, SOPHIA_OWN), state: 'active', seen: d(-1) + ' 09:41:00', passkeys: 1 };
const GEORGE = meOf(GEORGE_ROW, NOTIFY);
const SOPHIA = meOf(SOPHIA_ROW, Object.assign({}, NOTIFY, { money: false, system: false }));
// Sophia with one permission changed — for §B's "this one decides that one" checks.
const sophiaWith = (patch) => meOf(Object.assign({}, SOPHIA_ROW, { own: Object.assign({}, SOPHIA_OWN, patch) }), SOPHIA.notify);

(async () => {
    const { browser, base, done } = await bootBrowser();
    const newPage = async (route) => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.on('pageerror', (e) => {
            console.log('  PAGEERR:', e.message);
            fails++;
        });
        await page.addInitScript(() => {
            if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
        });
        await page.route(/\.php/, route);
        return page;
    };
    const fulfil = (route) => (x, code) => route.fulfill({ status: code || 200, contentType: 'application/json', body: JSON.stringify(x) });
    const bodyOf = (route) => {
        try {
            return JSON.parse(route.request().postData() || '{}');
        } catch (e) {
            return {};
        }
    };
    const fileOf = (route) => route.request().url().split('?')[0].split('/').pop();
    const EMPTY = { ok: true, bookings: [], enquiries: [], threads: [], events: [], logs: {}, content: {}, blocks: [], ranges: [], payments: [], seasons: {}, occupancy: {}, properties: [], reviews: [], passkeys: [] };
    const waitDlg = async (page, re) => {
        await page.waitForFunction(
            (src) => {
                const o = document.getElementById('glass-dialog');
                if (!o.classList.contains('open')) return false;
                if (src && !new RegExp(src).test(document.getElementById('glass-dialog-msg').innerText + ' ' + document.getElementById('glass-dialog-title').textContent)) return false;
                const f = document.querySelector('#glass-dialog-fields input');
                return document.activeElement === (f || document.getElementById('glass-dialog-ok'));
            },
            re ? re.source : '',
            { timeout: 8000 },
        );
    };
    const waitShut = (page) => page.waitForFunction(() => !document.getElementById('glass-dialog').classList.contains('open'), null, { timeout: 8000 });
    // A state the page should reach: true once it does, false (a failed check, not a
    // crash) if it never does.
    const until = (page, fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms || 8000 }).then(() => true, () => false);
    // A request the page should send, polled on the node side.
    const sent = async (posts, pred, ms) => {
        const t0 = Date.now();
        for (;;) {
            const hit = posts.filter(pred).pop();
            if (hit || Date.now() - t0 > (ms || 6000)) return hit || null;
            await new Promise((r) => setTimeout(r, 40));
        }
    };
    const shown = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
    const rowByTitle = (scope, t) => `${scope} .ga-row:has(.ga-t:text-is("${t}"))`;
    const lastToast = (page) => page.evaluate(() => { const t = [...document.querySelectorAll('#app-toasts .toast:not(.toast-out)')].pop(); return t ? t.textContent.trim() : ''; });
    // Identical toasts are not stacked again, so a refusal check starts from none:
    // otherwise an EARLIER refusal's toast would answer for this one.
    const clearToasts = (page) => page.evaluate(() => document.querySelectorAll('#app-toasts .toast').forEach((t) => t.remove()));
    const toastSays = (page, re) => until(page, (src) => [...document.querySelectorAll('#app-toasts .toast:not(.toast-out)')].some((t) => new RegExp(src).test(t.textContent)), re.source);
    // The boot signs the person in from admin_status (the fixture's `me`) and loads
    // the back office; wait for exactly that, not for a clock.
    const signIn = async (page) => {
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () => !!(window.__ADMIN_LOADED && window.__me && document.body.classList.contains('owner-mode') && document.getElementById('view-backoffice').classList.contains('active')),
            null,
            { timeout: 20000 },
        );
    };

    // ================================================================ §A owner
    {
        const posts = [];
        const st = {
            rows: { 1: Object.assign({}, GEORGE_ROW), 2: Object.assign({}, SOPHIA_ROW, { own: Object.assign({}, SOPHIA_OWN) }) },
            keys: [{ id: 7, label: 'iPhone', created_at: '2026-06-03 10:00:00', last_used_at: '2026-10-07 09:41:00' }],
            failPerm: false,
        };
        const people = () => Object.values(st.rows).sort((a, b) => (b.id === 1) - (a.id === 1) || a.id - b.id).map((r) => shape(r, 1));
        const listRes = (extra) => Object.assign({ ok: true, people: people(), mailKinds: MAIL_KINDS, mailExtras: ['co@example.com'], permDefs: PERM_DEFS, permGroups: PERM_GROUPS }, extra || {});
        const page = await newPage((route) => {
            const json = fulfil(route);
            const b = bodyOf(route);
            const file = fileOf(route);
            if (route.request().method() === 'POST') posts.push({ file, b });
            if (file === 'auth.php' && b.action === 'admin_status') return json({ admin: true, me: GEORGE, ownerFirst: 'George' });
            if (file === 'split.php' && b.action === 'status') {
                return json({ ok: true, ready: true, on: false, holder: 1, people: [{ id: 1, first: 'George', name: 'George Farrow' }, { id: 2, first: 'Sophia', name: 'Sophia Hart' }], cottages: [], hosts: {}, payees: {} });
            }
            if (file === 'people.php') {
                const row = st.rows[b.id];
                if (b.action === 'list') return json(listRes());
                if (b.action === 'set_mail') {
                    const p = shape(row, 1);
                    if (b.on && !p.mailCan[b.kind]) return json({ error: 'Locked', code: 'locked' }, 409);
                    if (!b.on && MUST[b.kind] && !Object.values(st.rows).some((r) => r.id !== b.id && shape(r, 1).mailGets.includes(b.kind))) {
                        return json({ error: 'Someone has to get ' + MUST[b.kind] + '.', code: 'must' }, 409);
                    }
                    row.mailOwn = Object.assign({}, row.mailOwn, { [b.kind]: !!b.on });
                    return json(listRes());
                }
                if (b.action === 'invite') {
                    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) return json({ error: 'That doesn’t look like an email address.' }, 400);
                    st.rows[3] = { id: 3, name: b.name, email: b.email, username: 'elliemarsh', full: b.role === 'super', own: {}, state: 'invited', passkeys: 0 };
                    return json(listRes({ sent: true, id: 3 }));
                }
                if (b.action === 'set_perm') {
                    if (st.failPerm) return json({ error: 'Database is down' }, 500);
                    const def = PERM_DEFS.find((x) => x.k === b.perm);
                    if (!def) return json({ error: 'Unknown permission' }, 400);
                    if (row.full) return json({ error: row.name.split(' ')[0] + ' is a Super User, so can do everything already.' }, 409);
                    if (def.fixed) return json({ error: 'Fixed' }, 409);
                    row.own = Object.assign({}, row.own, { [b.perm]: !!b.on });
                    return json(listRes());
                }
                if (b.action === 'reset_perms') {
                    row.own = {};
                    return json(listRes());
                }
                if (b.action === 'set_full') {
                    row.full = !!b.on;
                    if (!b.on) row.own = {}; // becoming a Host starts as a plain Host
                    return json(listRes());
                }
                if (b.action === 'passkeys') return json({ ok: true, passkeys: st.keys });
                if (b.action === 'passkey_remove') {
                    st.keys = st.keys.filter((k) => k.id !== b.key);
                    row.passkeys = st.keys.length;
                    return json({ ok: true, passkeys: st.keys, people: people() });
                }
                if (b.action === 'reset_link' || b.action === 'reinvite') return json(listRes({ sent: true }));
                if (b.action === 'remove') {
                    row.state = 'removed';
                    return json(listRes());
                }
                if (b.action === 'restore') {
                    row.state = 'invited';
                    row.passkeys = 0;
                    return json(listRes({ sent: true }));
                }
                if (b.action === 'cancel_invite') {
                    delete st.rows[b.id];
                    return json(listRes());
                }
            }
            if (file === 'passkeys.php' && b.action === 'admin_list') return json({ ok: true, passkeys: [] });
            return json(EMPTY);
        });
        await signIn(page);
        await page.evaluate(async () => {
            await openArea();
            settingsOpen('acct');
        });
        console.log('§A the owner: Permissions');
        // The account page lands before the people list; wait for the list's words.
        await until(page, () => ((document.querySelector('#acct-body .oa-r-people .ga-s') || {}).textContent || '') === 'You and Sophia');
        const acct = await page.evaluate(() => ({
            people: ((document.querySelector('#acct-body .oa-r-people .ga-s') || {}).textContent || ''),
            peopleT: ((document.querySelector('#acct-body .oa-r-people .ga-t') || {}).textContent || ''),
            details: ((document.querySelector('#acct-body .oa-r-details .ga-s') || {}).textContent || ''),
            lead: ((document.querySelector('#acct-body .ga-lead') || {}).textContent || ''),
        }));
        ok(acct.peopleT === 'Permissions' && acct.people === 'You and Sophia', `the account page's Permissions row names who else signs in (${acct.peopleT}: ${acct.people})`);
        ok(acct.lead === 'Super User', `the account says your role (${acct.lead})`);
        // The row says what it is and nothing else (the one-look pass): the
        // page it opens carries the name and email.
        ok(acct.details === '', `Your details is a one-line row, no sub restating it (${acct.details})`);
        await page.click(rowByTitle('#acct-body', 'Permissions'));
        await until(page, () => document.querySelectorAll('#people-body .ga-page > .ga-group .ga-row.oa-person').length >= 2);
        const listOf = () =>
            page.evaluate(() => {
                const g = document.querySelectorAll('#people-body .ga-page > .ga-group');
                return {
                    rows: [...((g[0] && g[0].querySelectorAll('.ga-row')) || [])].map((r) => ({ t: (r.querySelector('.ga-t') || {}).textContent, s: (r.querySelector('.ga-s') || {}).textContent || '', cap: ((r.querySelector('.ga-v .st-cap') || {}).textContent || '').trim(), btn: r.tagName === 'BUTTON' })),
                    split: g[1] ? [...g[1].querySelectorAll('.ga-row')].map((r) => (r.querySelector('.ga-t') || {}).textContent + ': ' + ((r.querySelector('.ga-s') || {}).textContent || '')) : [],
                    h1: (document.querySelector('#people-body h1') || {}).textContent,
                    back: (document.querySelector('#people-body .oa-back') || {}).textContent,
                };
            });
        const list = await listOf();
        ok(list.h1 === 'Permissions' && list.back === 'Account', `the page is Permissions, back to the account (${list.h1}, ‹ ${list.back})`);
        ok(list.rows.map((r) => r.t).join() === 'George Farrow,Sophia Hart,Add someone', `the list: you, Sophia, then Add someone (${list.rows.map((r) => r.t).join(' · ')})`);
        ok(list.rows[0].s === 'Super User · you', `your own row says your role and that it is you (${list.rows[0].s})`);
        ok(list.rows[1].s === 'Host · 4 changes · active yesterday' && list.rows[1].btn, `Sophia's row says her role, how far it is changed, and when she was here (${list.rows[1].s})`);
        ok(await page.evaluate(() => !!document.querySelector('#people-body .ga-row .ga-ava.oa-pava')), 'each person leads with their photo or initial');
        ok(list.split.length === 1 && /^Cottages & money: /.test(list.split[0]), `whose money is whose is one row of its own (${list.split.join(' | ')})`);

        // Add someone: their name, email and role — never a password.
        await page.click(rowByTitle('#people-body', 'Add someone'));
        await waitDlg(page);
        const addDlg = await page.evaluate(() => ({
            title: document.getElementById('glass-dialog-title').textContent,
            ok: document.getElementById('glass-dialog-ok').textContent,
            fields: [...document.querySelectorAll('#glass-dialog-fields input, #glass-dialog-fields select')].map((i) => i.id + ':' + (i.tagName === 'SELECT' ? 'select' : i.type)),
            roles: [...document.querySelectorAll('#gdf-role option')].map((o) => o.value + '=' + o.textContent),
        }));
        ok(addDlg.title === 'Add someone' && addDlg.ok === 'Send the invite' && addDlg.fields.join() === 'gdf-name:text,gdf-email:email,gdf-role:select', `Add someone asks for a name, an email and a role, and no password (${addDlg.fields.join(', ')})`);
        ok(addDlg.roles.join() === 'host=Host,super=Super User', `the role is Host or Super User, Host first (${addDlg.roles.join(', ')})`);
        await page.click('#glass-dialog-ok');
        await waitDlg(page, /Enter their name/);
        ok(!posts.some((p) => p.b.action === 'invite'), 'no name is refused before anything is sent');
        await page.fill('#gdf-name', 'Ellie Marsh');
        await page.fill('#gdf-email', 'ellie@');
        await page.selectOption('#gdf-role', 'super');
        await page.click('#glass-dialog-ok');
        await waitDlg(page, /look like an email/);
        const kept = await page.evaluate(() => ({ name: document.getElementById('gdf-name').value, role: document.getElementById('gdf-role').value }));
        ok(kept.name === 'Ellie Marsh' && kept.role === 'super', `the server's refusal keeps the form open with what was typed, the role included (${kept.name}, ${kept.role})`);
        await page.fill('#gdf-email', 'ellie@example.com');
        await page.click('#glass-dialog-ok');
        await waitShut(page);
        const inv = await sent(posts, (p) => p.b.action === 'invite' && p.b.email === 'ellie@example.com');
        ok(!!inv && inv.b.name === 'Ellie Marsh' && inv.b.role === 'super' && !('password' in inv.b), `the invite carries a name, an email and the role chosen, never a password (${inv ? inv.b.role : 'none sent'})`);
        ok(await toastSays(page, /Invite sent to ellie@example\.com/), 'and says where it went');
        await until(page, () => [...document.querySelectorAll('#people-body .ga-row .ga-t')].some((t) => t.textContent === 'Ellie Marsh'));
        const ellie = (await listOf()).rows.find((r) => r.t === 'Ellie Marsh') || {};
        ok(ellie.s === 'Super User · invite sent' && ellie.cap === 'Waiting', `the list shows her as a Super User, waiting (${ellie.s} | ${ellie.cap})`);
        // The split's own answer (split.php status) names whose account the money lands in.
        const split2 = (await listOf()).split;
        ok(split2.join() === 'Cottages & money: Money lands in George’s account', `…and Cottages & money says whose account the money lands in (${split2.join(' | ')})`);

        // Who gets which emails: from Notifications, everyone's at once.
        await page.click('#people-body .oa-back');
        await page.click(rowByTitle('#acct-body', 'Notifications'));
        const sumOk = await until(page, () => ((document.querySelector('#notify-body .oa-r-emails .ga-s') || {}).textContent || '') === '9 kinds to you · 6 to Sophia · 9 to Ellie');
        ok(sumOk, `Notifications says who gets which emails, in counts (${await page.evaluate(() => (document.querySelector('#notify-body .oa-r-emails .ga-s') || {}).textContent)})`);
        await page.click('#notify-body .oa-r-emails');
        await until(page, () => document.querySelectorAll('#emails-body .em-row').length > 0);
        const em = await page.evaluate(() => ({
            back: (document.querySelector('#emails-body .oa-back') || {}).textContent,
            sent: [...document.querySelectorAll('#emails-body .oa-person .ga-t')].map((e) => e.textContent),
            ellie: [...document.querySelectorAll('#emails-body .oa-person .ga-s')].map((e) => e.textContent).pop(),
            heads: [...document.querySelectorAll('#emails-body .em-cap')].map((c) => [...c.querySelectorAll('.em-heads span')].map((x) => x.textContent).join('+')),
            rows: [...document.querySelectorAll('#emails-body .em-row')].map((r) => r.dataset.mail),
            sophia: Object.fromEntries([...document.querySelectorAll('#emails-body .em-row')].map((r) => { const t = r.querySelectorAll('.em-tog')[1]; return [r.dataset.mail, t.classList.contains('is-locked') ? 'lock' : t.getAttribute('aria-pressed')]; })),
            george: [...document.querySelectorAll('#emails-body .em-row')].every((r) => r.querySelectorAll('.em-tog')[0].getAttribute('aria-pressed') === 'true'),
            ellieAll: [...document.querySelectorAll('#emails-body .em-row')].every((r) => !r.querySelectorAll('.em-tog')[2].classList.contains('is-locked')),
            digestNote: ((document.querySelector('#emails-body .em-row[data-mail="digest"] .em-also') || {}).textContent || ''),
            also: [...document.querySelectorAll('#emails-body .ga-group')].pop().textContent,
            badges: [...document.querySelectorAll('#emails-body .em-tog[aria-pressed="true"]')].every((t) => !!t.querySelector('.em-badge')),
        }));
        ok(em.back === 'Notifications' && em.sent.join() === 'George Farrow (you),Sophia Hart,Ellie Marsh', `it lists who it is sent to, back to Notifications (${em.sent.join(' · ')})`);
        ok(/emails start once Ellie has chosen a password/.test(em.ellie || ''), 'an invite says the emails start once a password is chosen');
        ok(em.heads.join() === 'George+Sophia+Ellie,George+Sophia+Ellie' && em.rows.join() === KINDS.join(), 'a row per email, a photo per person, as it happens then every week');
        ok(em.george && em.sophia.enquiry === 'true' && em.sophia.digest === 'true' && em.sophia.paid === 'true' && em.sophia.ideas === 'lock' && em.sophia.analytics === 'lock' && em.sophia.backup === 'lock', `her photos: lit where she gets it, locked where a permission is off (${JSON.stringify(em.sophia)})`);
        ok(em.ellieAll, 'a Super User’s photos are never locked');
        ok(em.badges, 'a lit photo carries a tick, never colour alone');
        ok(em.digestNote === 'Sophia’s copy leaves out the money', `the digest row says whose copy leaves out the money — a Super User's never does (${em.digestNote})`);
        ok(/co@example\.com/.test(em.also) && /Add an address/.test(em.also), 'and the extra addresses sit at the foot, with a way to add one');
        let before = posts.length;
        await clearToasts(page);
        await page.click('#emails-body .em-row[data-mail="ideas"] .em-tog:nth-child(2)', { force: true }); // aria-disabled: a tap explains, it never sends
        const why = await toastSays(page, /Sophia can’t get this yet\. Switch on Home page and things to do in What Sophia can do first\./);
        ok(why && posts.length === before, 'a locked photo names the permission it needs, in the server’s words, and sends nothing');
        await page.click('#emails-body .em-row[data-mail="digest"] .em-tog:nth-child(2)');
        const sm = await sent(posts, (p) => p.b.action === 'set_mail' && p.b.kind === 'digest');
        ok(!!sm && sm.b.id === 2 && sm.b.on === false, 'tapping her photo stops that one email for her');
        ok(await until(page, () => document.querySelector('#emails-body .em-row[data-mail="digest"] .em-tog:nth-child(2)').getAttribute('aria-pressed') === 'false'), '…and the photo fades');
        // The backup must reach someone, and nobody but George gets it (Ellie hasn't
        // chosen a password yet), so his photo can't be switched off.
        await clearToasts(page);
        await page.click('#emails-body .em-row[data-mail="backup"] .em-tog:nth-child(1)');
        const must = await toastSays(page, /Someone has to get the backup/);
        ok(must && (await page.evaluate(() => document.querySelector('#emails-body .em-row[data-mail="backup"] .em-tog:nth-child(1)').getAttribute('aria-pressed'))) === 'true', 'the last person on the backup can’t be switched off, and says why');
        await page.click('#emails-body .oa-back');
        await page.click('#notify-body .oa-back');
        await page.click(rowByTitle('#acct-body', 'Permissions'));

        // Your own page: your role is said, never switched; nothing to remove.
        await page.click(rowByTitle('#people-body', 'George Farrow'));
        await until(page, () => ((document.querySelector('#person-body h1') || {}).textContent || '') === 'George Farrow');
        const mine = await page.evaluate(() => ({
            role: ((document.querySelector('#person-body .oa-rolebox') || {}).textContent || ''),
            seg: !!document.querySelector('#person-body .oa-seg'),
            can: ((document.querySelector('#person-body .oa-r-perms') || {}).textContent || ''),
            danger: document.querySelectorAll('#person-body .ga-row.is-danger').length,
            reset: /Send a password reset link/.test(document.getElementById('person-body').textContent),
        }));
        ok(mine.role === 'Super User' && !mine.seg, `your own role is said, not switched (${mine.role})`);
        ok(/^What you can do/.test(mine.can) && /Everything/.test(mine.can) && !mine.danger && !mine.reset, `you can do everything, and your own page offers no reset or removal (${mine.can})`);
        await page.click('#person-body .oa-back');

        // Ellie's page: an invite, a Super User, no passkeys yet.
        await page.click(rowByTitle('#people-body', 'Ellie Marsh'));
        await until(page, () => ((document.querySelector('#person-body h1') || {}).textContent || '') === 'Ellie Marsh');
        const el = await page.evaluate(() => ({
            on: ((document.querySelector('#person-body .oa-seg [aria-checked="true"]') || {}).textContent || ''),
            rows: [...document.querySelectorAll('#person-body .ga-row .ga-t')].map((t) => t.textContent),
            mail: ((document.querySelector('#person-body .oa-fold .ga-row:has(.ga-t) .ga-s') || {}).textContent || ''),
        }));
        ok(el.on === 'Super User', `the role switcher shows what she was invited as (${el.on})`);
        ok(!el.rows.includes('Passkeys') && el.rows.includes('Send the invite again') && el.rows.includes('Cancel the invite') && !el.rows.includes('Send a password reset link'), `an invite has no passkeys row and no reset — it can be sent again or cancelled (${el.rows.join(' · ')})`);
        ok(el.mail === 'Once they’ve signed in', `her emails start once she has signed in (${el.mail})`);
        await page.click('#person-body .oa-back');

        // Sophia's page.
        await page.click(rowByTitle('#people-body', 'Sophia Hart'));
        await until(page, () => ((document.querySelector('#person-body h1') || {}).textContent || '') === 'Sophia Hart');
        const pp = await page.evaluate(() => ({
            back: (document.querySelector('#person-body .oa-back') || {}).textContent,
            hero: [...document.querySelectorAll('#person-body .oa-hero-t span')].map((s) => s.textContent),
            caps: [...document.querySelectorAll('#person-body .ga-cap')].map((c) => c.textContent),
            seg: [...document.querySelectorAll('#person-body .oa-seg button')].map((b) => b.textContent + '=' + b.getAttribute('aria-checked')),
            rows: [...document.querySelectorAll('#person-body .ga-row')].map((r) => (r.querySelector('.ga-t') || {}).textContent + ((r.querySelector('.ga-s') || {}).textContent ? ': ' + r.querySelector('.ga-s').textContent : '')),
            pwField: document.querySelectorAll('#person-body input[type="password"]').length,
            last: (() => { const r = [...document.querySelectorAll('#person-body .ga-row')].pop(); return r ? (r.querySelector('.ga-t') || {}).textContent + (r.classList.contains('is-danger') ? ' (danger)' : '') : ''; })(),
        }));
        ok(pp.back === 'Permissions' && pp.hero.join(' | ') === 'sophia@example.com | Active yesterday', `her page is headed with her email and when she was here, back to Permissions (${pp.hero.join(' | ')})`);
        ok(pp.caps.join() === 'Role' && pp.seg.join() === 'Host=true,Super User=false', `her role is the one switcher, on Host (${pp.seg.join(', ')})`);
        ok(pp.rows.join(' | ') === 'What Sophia can do: 4 changes from Host | Emails: 5 of 6 | Passkeys: 1 passkey | Send a password reset link | Remove Sophia', `it says what she can do, her emails, her passkey, a reset link and removal (${pp.rows.join(' | ')})`);
        ok(pp.last === 'Remove Sophia (danger)' && pp.pwField === 0, 'removing her is the last, destructive row — and no password is ever asked for');

        // Her emails fold open in place: only the ones she may have, a switch each.
        await page.click('#person-body .oa-fold > .ga-row:has(.ga-t:text-is("Emails"))');
        await until(page, () => !!document.getElementById('oa-mail-digest'));
        const fold = await page.evaluate(() => [...document.querySelectorAll('#person-body .oa-foldbody .oa-swrow')].map((r) => (r.querySelector('.ga-t') || {}).textContent + '=' + r.querySelector('input').checked));
        ok(fold.join() === 'New enquiries=true,New bookings=true,Payments received=true,Guest messages=true,Reviews to approve=true,Weekly digest=false', `her emails, the digest stopped from the matrix — the same choice (${fold.join(', ')})`);
        await page.click('#person-body .chb-switch:has(#oa-mail-digest)');
        const sm2 = await sent(posts, (p) => p.b.action === 'set_mail' && p.b.kind === 'digest' && p.b.on === true);
        ok(!!sm2 && sm2.b.id === 2, 'a switch there sends that one email to her again');
        ok(await until(page, () => ((document.querySelector('#person-body .oa-fold > .ga-row .ga-s') || {}).textContent || '') === '6 of 6'), '…and the fold counts it');

        // What Sophia can do: every permission, a switch each.
        await page.click('#person-body .oa-r-perms');
        await until(page, () => document.querySelectorAll('#perms-body .oa-prow').length > 0);
        const permsOf = () =>
            page.evaluate(() => ({
                back: (document.querySelector('#perms-body .oa-back') || {}).textContent,
                h1: (document.querySelector('#perms-body h1') || {}).textContent,
                reset: ((document.querySelector('#perms-body .oa-permreset') || {}).textContent || '').trim(),
                caps: [...document.querySelectorAll('#perms-body .oa-pcap')].map((c) => [...c.querySelectorAll('span')].map((s) => s.textContent).join(': ')),
                rows: document.querySelectorAll('#perms-body .oa-prow').length,
                inputs: document.querySelectorAll('#perms-body .oa-prow input[type="checkbox"]').length,
                state: Object.fromEntries([...document.querySelectorAll('#perms-body .oa-prow input')].map((i) => [i.id.replace('oa-perm-', ''), i.checked])),
                changed: [...document.querySelectorAll('#perms-body .oa-prow.is-changed input')].map((i) => i.id.replace('oa-perm-', '')),
                always: (() => { const r = [...document.querySelectorAll('#perms-body .oa-prow')].find((x) => x.querySelector('.ga-t').textContent === 'See bookings and the calendar'); return r ? !r.querySelector('input') && (r.querySelector('.oa-fixed.is-on') || {}).getAttribute?.('aria-label') : ''; })(),
                locks: [...document.querySelectorAll('#perms-body .oa-prow')].filter((r) => !r.querySelector('input') && !!r.querySelector('.oa-fixed:not(.is-on)')).map((r) => r.querySelector('.ga-t').textContent + '=' + r.querySelector('.oa-fixed').getAttribute('aria-label')),
            }));
        const pm = await permsOf();
        ok(pm.back === 'Sophia' && pm.h1 === 'What Sophia can do', `the page is What Sophia can do, back to her page (${pm.h1}, ‹ ${pm.back})`);
        ok(pm.caps.join(' | ') === 'Bookings: 4 of 4 | Guests & messages: 3 of 3 | Key safes: 2 of 2 | Money: 2 of 6 | Cottages & prices: 0 of 3 | Website: 0 of 3 | Set-up: Super User only', `seven groups, each saying how many are on (${pm.caps.join(' | ')})`);
        ok(pm.rows === 23 && pm.inputs === 20, `all 23 permissions, 20 of them switches (${pm.rows} rows, ${pm.inputs} switches)`);
        ok(pm.state['mo-ask'] === true && pm.state['mo-record'] === true && pm.state['mo-refund'] === false && pm.state['mo-view'] === false && pm.state['co-prices'] === false && pm.state['bk-edit'] === true, 'each switch shows her real permission');
        ok(pm.changed.sort().join() === 'mo-deposit,mo-exp,mo-refund,mo-view', `the four changed from a plain Host carry a mark (${pm.changed.join(', ')})`);
        ok(pm.reset === '4 changes from HostReset', `the page says how far from Host she is, with a way back (${pm.reset})`);
        ok(pm.always === 'Always on', `seeing bookings is a tick for everyone, never a switch (${pm.always})`);
        ok(pm.locks.join() === 'Permissions=Super User only,Backups, status and integrations=Super User only', `set-up is locked to a Super User (${pm.locks.join(', ')})`);

        before = posts.filter((p) => p.b.action === 'set_perm').length;
        await clearToasts(page);
        await page.click('#perms-body .chb-switch:has(#oa-perm-mo-refund)');
        const sp = await sent(posts, (p) => p.b.action === 'set_perm' && p.b.perm === 'mo.refund');
        ok(!!sp && sp.b.id === 2 && sp.b.on === true && !('perms' in sp.b) && posts.filter((p) => p.b.action === 'set_perm').length === before + 1, 'a switch saves that ONE permission for her');
        ok(await toastSays(page, /Give refunds: on for SophiaUndo/), 'and says what changed, with Undo');
        ok(await until(page, () => /^3 changes from Host/.test(((document.querySelector('#perms-body .oa-permreset') || {}).textContent || '').trim()) && !!document.getElementById('oa-perm-mo-refund').checked), '…and the page counts it from the server’s answer');
        await page.click('#app-toasts .toast:not(.toast-out) .toast-action');
        const undo = await sent(posts, (p) => p.b.action === 'set_perm' && p.b.perm === 'mo.refund' && p.b.on === false);
        ok(!!undo && (await until(page, () => /^4 changes from Host/.test(((document.querySelector('#perms-body .oa-permreset') || {}).textContent || '').trim()) && !document.getElementById('oa-perm-mo-refund').checked)), 'Undo puts that one permission back');
        st.failPerm = true;
        await page.click('#perms-body .chb-switch:has(#oa-perm-mo-view)');
        await waitDlg(page, /Database is down/);
        await page.click('#glass-dialog-ok');
        await waitShut(page);
        ok(await page.evaluate(() => document.getElementById('oa-perm-mo-view').checked === false), 'a refused switch goes back to the truth');
        st.failPerm = false;
        await clearToasts(page);
        await page.click('#perms-body .oa-permreset [data-act="oaPermsReset"]');
        const rs = await sent(posts, (p) => p.b.action === 'reset_perms');
        ok(!!rs && rs.b.id === 2 && (await toastSays(page, /Sophia is a plain Host again/)), 'Reset makes her a plain Host');
        ok(await until(page, () => !document.querySelector('#perms-body .oa-permreset') && [...document.querySelectorAll('#perms-body .oa-pcap')].some((c) => c.textContent === 'Money6 of 6')), '…and the changes row goes, every money permission on');
        await page.click('#perms-body .oa-back');
        ok(await until(page, () => /As a Host/.test((document.querySelector('#person-body .oa-r-perms') || {}).textContent || '')), 'her page then says she is as a Host');

        // The role: Super User asks first; Host does not.
        await page.click('#person-body .oa-seg button:text-is("Super User")');
        await waitDlg(page, /Make Sophia a Super User/);
        ok(/do everything you can, including Permissions/.test(await page.evaluate(() => document.getElementById('glass-dialog-msg').innerText)), 'making her a Super User asks first, and says what it means');
        await page.click('#glass-dialog-cancel');
        await waitShut(page);
        ok(!posts.some((p) => p.b.action === 'set_full') && (await page.evaluate(() => (document.querySelector('#person-body .oa-seg [aria-checked="true"]') || {}).textContent)) === 'Host', 'backing out changes nothing');
        await page.click('#person-body .oa-seg button:text-is("Super User")');
        await waitDlg(page, /Make Sophia a Super User/);
        await page.click('#glass-dialog-ok');
        await waitShut(page);
        const sf = await sent(posts, (p) => p.b.action === 'set_full' && p.b.on === true);
        ok(!!sf && sf.b.id === 2 && (await toastSays(page, /Sophia is a Super User now/)), 'confirming makes her a Super User');
        ok(await until(page, () => (document.querySelector('#person-body .oa-seg [aria-checked="true"]') || {}).textContent === 'Super User' && /Everything/.test((document.querySelector('#person-body .oa-r-perms') || {}).textContent || '')), '…and her page says she can do everything');
        before = posts.length;
        await page.click('#person-body .oa-seg button:text-is("Host")');
        const sh = await sent(posts, (p) => p.b.action === 'set_full' && p.b.on === false);
        ok(!!sh && !(await page.evaluate(() => document.getElementById('glass-dialog').classList.contains('open'))), 'making her a Host again needs no question');
        ok(await until(page, () => (document.querySelector('#person-body .oa-seg [aria-checked="true"]') || {}).textContent === 'Host'), '…and the switcher follows');

        // Her passkey: a lost phone's can be taken off without removing her.
        await page.click('#person-body .oa-fold > .ga-row:has(.ga-t:text-is("Passkeys"))');
        await page.click(rowByTitle('#person-body', 'iPhone'));
        await waitDlg(page, /Remove Sophia’s passkey/);
        ok(/password still works/.test(await page.evaluate(() => document.getElementById('glass-dialog-msg').innerText)), 'removing her passkey says her password still works');
        await page.click('#glass-dialog-ok');
        await waitShut(page);
        const pk = await sent(posts, (p) => p.b.action === 'passkey_remove');
        ok(!!pk && pk.b.id === 2 && pk.b.key === 7, '…then removes that one');
        ok(await until(page, () => ![...document.querySelectorAll('#person-body .ga-row .ga-t')].some((t) => t.textContent === 'Passkeys')), 'and with none left, her page has no Passkeys row');

        await clearToasts(page);
        await page.click(rowByTitle('#person-body', 'Send a password reset link'));
        const rl = await sent(posts, (p) => p.b.action === 'reset_link');
        ok(!!rl && rl.b.id === 2 && (await toastSays(page, /Sophia chooses the new password/)), 'a reset sends her a link; she chooses the password');

        await page.click('#person-body .ga-row.is-danger');
        await waitDlg(page, /Remove Sophia’s access/);
        ok(await page.evaluate(() => document.getElementById('glass-dialog-ok').classList.contains('is-danger') && /signed out everywhere straight away/.test(document.getElementById('glass-dialog-msg').innerText)), 'removing access asks first, in the destructive style, saying what happens');
        await page.click('#glass-dialog-ok');
        await waitShut(page);
        ok(await until(page, () => /Give Sophia access again/.test(document.getElementById('person-body').textContent) && document.querySelector('#person-body h1').textContent === 'Sophia Hart'), 'her page then offers to give the access back, and is still hers');
        ok(await page.evaluate(() => !document.querySelector('#person-body .oa-seg') && !document.querySelector('#person-body .oa-r-perms')), '…with no role or permissions to change while she has no access');
        await clearToasts(page);
        await page.click(rowByTitle('#person-body', 'Give Sophia access again'));
        const rst = await sent(posts, (p) => p.b.action === 'restore');
        ok(!!rst && rst.b.id === 2 && (await toastSays(page, /A new invite is on its way to sophia@example\.com/)), 'giving it back sends her a new invite');
        ok(await until(page, () => /Send the invite again/.test(document.getElementById('person-body').textContent)), '…and her page waits for her to choose a password');
        await page.close();
    }

    // ================================================================ §B host
    {
        const posts = [];
        const page = await newPage((route) => {
            const json = fulfil(route);
            const b = bodyOf(route);
            const file = fileOf(route);
            if (route.request().method() === 'POST') posts.push({ file, b });
            if (file === 'auth.php' && b.action === 'admin_status') return json({ admin: true, me: SOPHIA, ownerFirst: 'George' });
            if (file === 'passkeys.php' && b.action === 'admin_list') return json({ ok: true, passkeys: [] });
            return json(EMPTY);
        });
        await signIn(page);
        const setMe = (m) => page.evaluate((x) => chbSetMe(x, 'George'), m);
        console.log('§B what a Host sees');
        const meNow = await page.evaluate(() => ({ full: window.__me.full, refund: window.__me.perms['mo.refund'], view: window.__me.perms['mo.view'], cls: [...document.body.classList].filter((c) => /^cap-x-/.test(c)).sort() }));
        ok(meNow.full === false && meNow.refund === false && meNow.view === false, 'she is signed in as the Host the server described');
        // One class per permission she lacks — and none for the ones she has.
        const wantCls = ['owner', 'mo.refund', 'mo.deposit', 'mo.view', 'mo.exp', 'co.prices', 'co.pages', 'co.sync', 'we.content', 'we.news', 'we.stats'].map((k) => 'cap-x-' + k.replace('.', '-')).sort();
        ok(meNow.cls.join() === wantCls.join(), `the page marks exactly the permissions she lacks (${meNow.cls.join(' ')})`);
        const dock = await page.evaluate(() => ({
            shown: [...document.querySelectorAll('header .admin-dock-btn')].filter((b) => b.getClientRects().length).map((b) => b.dataset.view),
            all: [...document.querySelectorAll('header .admin-dock-btn')].map((b) => b.dataset.view),
        }));
        ok(dock.all.includes('view-accounts') && !dock.shown.includes('view-accounts'), `without "See the Payments page" the menu leaves out Payments (${dock.shown.join(', ')})`);
        ok(dock.shown.includes('view-inbox') && dock.shown.includes('view-keysafe') && dock.shown.includes('view-settings'), '…and keeps the Inbox, Key safes and Manage');
        await setMe(sophiaWith({ 'ks.see': false }));
        ok(!(await shown(page, 'header .admin-dock-btn[data-view="view-keysafe"]')), 'without "See door codes" Key safes goes too');
        await setMe(SOPHIA);
        await page.evaluate(() => openArea());
        await until(page, () => document.getElementById('view-settings').classList.contains('active') && !!document.querySelector('#settings-index .settings-row'));
        const idx = await page.evaluate(() => {
            const lab = (r) => ((r.querySelector('.settings-row-label') || {}).textContent || '').trim();
            return {
                rows: [...document.querySelectorAll('#settings-index .settings-row')].filter((r) => r.getClientRects().length).map(lab),
                inDom: [...document.querySelectorAll('#settings-index .settings-row')].map(lab),
                labels: [...document.querySelectorAll('#settings-index .settings-section-label')].filter((l) => l.getClientRects().length).map((l) => l.textContent),
                summary: (() => { const m = document.getElementById('manage-verdicts'); return !!m && m.getClientRects().length > 0; })(),
                first: (() => { const c = [...document.getElementById('settings-index').children].find((x) => x.getClientRects().length); return c ? c.id : ''; })(),
            };
        });
        const has = (list, t) => list.some((r) => r.indexOf(t) === 0);
        const want = ['Guest list', 'Waitlist', 'Reviews', 'Guest photos', 'Guest chat'];
        ok(want.every((t) => has(idx.rows, t)), `Manage keeps her everyday rows (${idx.rows.join(' · ')})`);
        const gone = ['Add a cottage', 'Seasonal rates', 'Price ideas', 'Calendar sync', 'Payments', 'Cancellation policy', 'Follow-up emails', 'Text messages', 'Home page & menu', 'Things to do', 'Newsletter', 'Analytics', 'Activity log', 'More tools', 'Backups', 'Integrations', 'Search learning'];
        ok(gone.every((t) => has(idx.inDom, t)) && !gone.some((t) => has(idx.rows, t)), `and every row whose permission she lacks is hidden, not missing (${gone.filter((t) => has(idx.rows, t)).join(', ') || 'none shown'})`);
        ok(idx.labels.includes('Guests') && idx.labels.includes('Messages & automation') && !['Cottages & pricing', 'Bookings & payments', 'Website & marketing', 'System & tools'].some((l) => idx.labels.includes(l)), `a group left with nothing in it goes too (${idx.labels.join(' · ')})`);
        ok(!idx.summary, 'the system summary is a Super User’s only');
        ok(idx.first === 'oa-acct-grp', `her own account is the first thing on Manage (${idx.first})`);
        // A permission takes effect at the next sign-in or page load, not live; the
        // index repainting is that moment.
        await setMe(sophiaWith({ 'co.prices': true }));
        await page.evaluate(() => settingsShowIndex());
        const pricesRows = await page.evaluate(() => [...document.querySelectorAll('#settings-index .settings-row')].filter((r) => r.getClientRects().length).map((r) => ((r.querySelector('.settings-row-label') || {}).textContent || '').trim()));
        ok(has(pricesRows, 'Seasonal rates') && has(pricesRows, 'Price ideas') && has(pricesRows, 'Cancellation policy') && !has(pricesRows, 'Calendar sync'), `"Change prices and seasons" brings back its own rows and no others (${pricesRows.join(' · ')})`);
        await setMe(SOPHIA);
        await page.evaluate(() => settingsOpen('acct'));
        await until(page, () => !!document.querySelector('#acct-body .ga-lead'));
        const acct = await page.evaluate(() => ({ lead: (document.querySelector('#acct-body .ga-lead') || {}).textContent, people: !!document.querySelector('#acct-body .oa-r-people'), host: !!document.querySelector('#acct-body .oa-r-host') }));
        ok(acct.lead === 'Host · 4 changes' && !acct.people && acct.host, `her account says her role, has no Permissions row, and keeps the host profile (${acct.lead})`);
        for (const [sec, what] of [['payments', 'a Super User’s settings page'], ['people', 'Permissions']]) {
            await clearToasts(page);
            await page.evaluate((s) => settingsOpen(s), sec);
            ok((await toastSays(page, /That’s for George to change\./)) && (await shown(page, '#settings-index')), `a stale link to ${what} is refused in the server’s words`);
        }
        await clearToasts(page);
        await page.evaluate(() => nav('view-accounts'));
        ok((await until(page, () => document.getElementById('view-backoffice').classList.contains('active'))) && (await toastSays(page, /That’s for George to change\./)), '…and a screen she can’t use lands on Today instead');
        await page.evaluate(() => nav('view-keysafe'));
        ok(await until(page, () => document.getElementById('view-keysafe').classList.contains('active')), 'while one she can use opens');
        await page.evaluate(() => nav('view-backoffice'));
        // Today: only the jobs she can do.
        const duties = await page.evaluate(() => {
            const real = window.chbDutiesAll;
            window.chbDutiesAll = () => [
                { kind: 'deposit', key: 'deposit:1', label: 'Return Emma’s £60 deposit', sev: 'warn' },
                { kind: 'balance', key: 'balance:2', label: '£580 to collect', sev: 'warn' },
                { kind: 'cron', label: 'Automation stopped', sev: 'danger' },
                { kind: 'payout', label: 'A payout failed', sev: 'danger' },
                { kind: 'keysafe', label: 'Set the code at Jollyboat', sev: 'warn' },
                { kind: 'enquiry', key: 'enquiry:3', label: 'Jane’s enquiry', sev: 'warn' },
            ];
            const out = chbDuties().map((x) => x.kind);
            window.chbDutiesAll = real;
            return out;
        });
        ok(duties.join() === 'balance,keysafe,enquiry', `Today shows only her jobs: no deposit return, no payout, no automation (${duties.join(', ')})`);
        // The buttons follow her permissions, one by one.
        const BTNS = { requestPayment: 'mo.ask', recordPayment: 'mo.record', returnDeposit: 'mo.deposit', refundPayment: 'mo.refund', openAccounts: 'mo.view', addExpense: 'mo.exp', keysafeRotate: 'ks.change', contentEditSave: 'we.content', runBackupNow: 'Super User' };
        const btns = await page.evaluate((names) => {
            const box = document.createElement('div');
            box.id = 't-btns';
            box.innerHTML = names.map((n) => `<button id="t-${n}" data-act="${n}">${n}</button>`).join('');
            document.body.appendChild(box);
            return Object.fromEntries(names.map((n) => [n, document.getElementById('t-' + n).getClientRects().length > 0]));
        }, Object.keys(BTNS));
        const showsOk = ['requestPayment', 'recordPayment', 'keysafeRotate'];
        ok(Object.keys(BTNS).every((n) => btns[n] === showsOk.includes(n)), `asking for and recording money and changing door codes stay; refunds, deposits, Payments, expenses, the website and set-up go (${Object.keys(BTNS).map((n) => n + (btns[n] ? '✓' : '✗')).join(' ')})`);
        let called = false;
        await page.exposeFunction('__peopleCalled', () => { called = true; });
        await clearToasts(page);
        await page.evaluate(() => {
            window.returnDeposit = () => window.__peopleCalled();
            document.getElementById('t-returnDeposit').setAttribute('style', 'display:inline-block !important');
            document.getElementById('t-returnDeposit').click();
        });
        ok((await toastSays(page, /That’s for George to change\./)) && !called, 'a stale render that still shows one is refused, and the action never runs');
        // The booking form's money parts: recording money and asking for it are
        // separate permissions, each taking its own fields. Probed by giving each
        // part an inline display and reading whether the permission rule beats it,
        // so a part the form hides for other reasons can't pass for a hidden one.
        const PARTS = ['modal-payment-group', 'modal-deposit-group', 'modal-override-group', 'modal-plan-group'];
        const capHidden = () =>
            page.evaluate(
                (ids) =>
                    Object.fromEntries(
                        ids.map((id) => {
                            const e = document.getElementById(id);
                            if (!e) return [id, 'missing'];
                            const was = e.style.display;
                            e.style.display = 'block';
                            const h = getComputedStyle(e).display === 'none';
                            e.style.display = was;
                            return [id, h];
                        }),
                    ),
                PARTS,
            );
        const pAll = await capHidden();
        ok(PARTS.every((id) => pAll[id] === false), `with both, the booking form keeps its payment, deposit, price and plan fields (${JSON.stringify(pAll)})`);
        await setMe(sophiaWith({ 'mo.record': false }));
        const pRec = await capHidden();
        ok(pRec['modal-payment-group'] === true && pRec['modal-deposit-group'] === true && pRec['modal-override-group'] === false && pRec['modal-plan-group'] === false, `without "Record payments" the payment and deposit fields go, the price and plan stay (${JSON.stringify(pRec)})`);
        await setMe(sophiaWith({ 'mo.ask': false }));
        const pAsk = await capHidden();
        ok(pAsk['modal-payment-group'] === false && pAsk['modal-deposit-group'] === false && pAsk['modal-override-group'] === true && pAsk['modal-plan-group'] === true, `without "Ask guests to pay" the price and plan go, the payment fields stay (${JSON.stringify(pAsk)})`);
        ok(await page.evaluate(() => getComputedStyle(document.getElementById('t-requestPayment')).display === 'none' && getComputedStyle(document.getElementById('t-recordPayment')).display !== 'none'), '…and so does asking for money, while recording it stays');
        // Her alerts: never a kind she cannot get.
        await setMe(SOPHIA);
        await page.evaluate(async () => {
            await openArea();
            settingsOpen('notify');
        });
        await until(page, () => document.querySelectorAll('#notify-prefs-body .oa-swrow').length > 0);
        const kinds = () => page.evaluate(() => [...document.querySelectorAll('#notify-prefs-body .oa-swrow .ga-t')].map((e) => e.textContent));
        const nf = await kinds();
        ok(nf.join() === 'Payments and money,New enquiries,Guest messages,Guest check-outs', `her alerts: money because she records payments, never the system notices (${nf.join(' · ')})`);
        ok((await page.evaluate(() => (document.querySelector('#notify-body .oa-r-emails .ga-s') || {}).textContent)) === '6 kinds, all to sophia@example.com', 'her Notifications say which emails reach her, and where');
        await page.click('#notify-body .oa-r-emails');
        await until(page, () => ((document.querySelector('#emails-body h1') || {}).textContent || '') === 'Emails you get');
        const mineOf = () =>
            page.evaluate(() => ({
                h1: (document.querySelector('#emails-body h1') || {}).textContent,
                lead: (document.querySelector('#emails-body .ga-lead') || {}).textContent,
                rows: [...document.querySelectorAll('#emails-body .ga-row .ga-t')].map((e) => e.textContent),
                digest: (([...document.querySelectorAll('#emails-body .ga-row')].find((r) => (r.querySelector('.ga-t') || {}).textContent === 'Weekly digest') || {}).textContent || ''),
                togs: document.querySelectorAll('#emails-body .em-tog, #emails-body input').length,
                extras: /Also emailed|Add an address/.test(document.getElementById('emails-body').textContent) || !!document.querySelector('#emails-body [data-act="addNotifyEmail"]'),
            }));
        const mine = await mineOf();
        ok(mine.h1 === 'Emails you get' && /George chooses who gets which emails\. Yours come to sophia@example\.com\./.test(mine.lead), 'her page says who chooses, and where hers go');
        ok(mine.rows.join() === 'New enquiries,New bookings,Payments received,Guest messages,Reviews to approve,Weekly digest' && mine.togs === 0, `the emails she gets, read-only (${mine.rows.join(' · ')})`);
        ok(!mine.extras, 'and the shared extra addresses are a Super User’s to see and change');
        ok(/without the money/.test(mine.digest), 'without "See the Payments page" her digest says it leaves out the money');
        await setMe(sophiaWith({ 'mo.view': true }));
        await page.evaluate(() => renderEmails());
        ok(!/without the money/.test((await mineOf()).digest), '…and with it, it doesn’t');
        await setMe(SOPHIA);
        await page.click('#emails-body .oa-back');
        await until(page, () => document.querySelectorAll('#notify-prefs-body .oa-swrow').length > 0);
        await setMe(sophiaWith({ 'mo.record': false }));
        await page.evaluate(() => renderNotifyPrefs());
        const nf2 = await kinds();
        ok(nf2.join() === 'New enquiries,Guest messages,Guest check-outs', `without "Record payments" the money alerts go too (${nf2.join(' · ')})`);
        await setMe(SOPHIA);
        ok(await page.evaluate(() => /Sophia/.test(chbDaySentence().greet)), 'the greeting is hers');
        // Wide: the rail carries the menu, and follows the same permissions. The
        // search window's system line is a Super User's (she is never sent the state
        // it reports); wide, because a phone stands the quiet line down anyway.
        await page.setViewportSize({ width: 1280, height: 900 });
        const railOk = await until(page, () => { const r = document.querySelector('#admin-rail .rail-row[data-view="view-inbox"]'); return !!r && r.getClientRects().length > 0; });
        const rail = await page.evaluate(() => ({
            acc: !!document.querySelector('#admin-rail .rail-row[data-view="view-accounts"]'),
            accShown: (() => { const r = document.querySelector('#admin-rail .rail-row[data-view="view-accounts"]'); return !!r && r.getClientRects().length > 0; })(),
        }));
        ok(railOk && rail.acc && !rail.accShown, 'on a wide screen the rail leaves out Payments too');
        await page.evaluate(() => openCmdK());
        await until(page, () => document.getElementById('cmdk').classList.contains('open'));
        const sysHer = await shown(page, '#cmdk-sys');
        await page.evaluate((m) => { chbSetMe(m, 'George'); chbSysLine(); }, GEORGE);
        const sysHim = await shown(page, '#cmdk-sys');
        await page.evaluate((m) => { chbSetMe(m, 'George'); chbSysLine(); }, SOPHIA);
        ok(!sysHer && sysHim && !(await shown(page, '#cmdk-sys')), `the search window says nothing about the system to her (hers ${sysHer}, the owner's ${sysHim})`);
        await page.evaluate(() => closeCmdK());
        await page.close();
    }

    // ================================================================ §C sign-in
    {
        const posts = [];
        const st = { login: 'twofa', link: 'ok' };
        const page = await newPage((route) => {
            const json = fulfil(route);
            const b = bodyOf(route);
            const file = fileOf(route);
            if (route.request().method() === 'POST') posts.push({ file, b });
            if (file === 'auth.php') {
                if (b.action === 'admin_status') return json({ admin: false });
                if (b.action === 'admin_login') {
                    if (st.login === 'removed') return json({ error: 'This sign-in has been switched off. Ask George if you need it back.', code: 'removed' }, 403);
                    if (st.login === 'wrong') return json({ error: 'Incorrect username or password' }, 401);
                    if (st.login === 'twofa') return json({ ok: true, twofa: true, to: 's•••••@example.com' });
                    return json({ ok: true, me: SOPHIA, ownerFirst: 'George' });
                }
                if (b.action === 'admin_2fa') return b.code === '428913' ? json({ ok: true, me: SOPHIA, ownerFirst: 'George' }) : json({ error: 'That code isn’t right. Try again, or send a new one.', code: 'wrong' }, 401);
                if (b.action === 'guest_code_request' || b.action === 'admin_reset_request') return json({ ok: true });
                if (b.action === 'guest_code_verify') return json({ ok: true, admin: true, me: SOPHIA, ownerFirst: 'George' });
                if (b.action === 'admin_link_check') return st.link === 'ok' ? json({ ok: true, first: 'Sophia', username: 'sophiahart', email: 'sophia@example.com', by: 'George' }) : json({ error: 'This invite link has been used or has expired. Ask George to send a new one.', code: 'dead' }, 410);
                if (b.action === 'admin_invite_accept' || b.action === 'admin_reset_save') return json({ ok: true, me: SOPHIA, ownerFirst: 'George' });
                if (b.action === 'guest_login') return json({ error: 'That email and password don’t match.' }, 401);
                return json({ ok: true, admin: false, guest: null });
            }
            if (file === 'passkeys.php') return json({ error: 'no' }, 400);
            return json(EMPTY);
        });
        const step = () => page.evaluate(() => (document.querySelector('#ga-auth .ga-ah') || {}).textContent || '');
        const text = () => page.evaluate(() => (document.getElementById('ga-auth') || {}).textContent || '');
        const inBackOffice = () => page.evaluate(() => document.body.classList.contains('owner-mode') && !document.getElementById('guest-auth-modal').classList.contains('open'));
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
        console.log('§C the sign-in page, for the back office');
        // A back-office route while signed out opens THE sign-in (there is one):
        // the old owner dialog never learned who had signed in.
        await page.evaluate(() => window.tryAccessBackOffice());
        await page.waitForTimeout(900);
        ok(await page.evaluate(() => document.getElementById('guest-auth-modal').classList.contains('open') && !!document.querySelector('#ga-auth #login-email') && !document.getElementById('admin-login-modal')), 'a back-office route while signed out opens the one sign-in sheet');
        await page.evaluate(() => closeGuestAuthModal());
        await page.waitForTimeout(300);
        await page.evaluate(() => { localStorage.removeItem('chb-last-guest'); openGuestAuthModal(); });
        await page.waitForTimeout(300);
        await page.fill('#login-email', 'sophiahart');
        await page.click('#ga-auth [data-act="authContinue"]');
        await page.waitForTimeout(300);
        ok(/Your password/.test(await step()) && /Forgotten your password\?/.test(await text()), 'a username goes to the password, with a way to reset it');
        // WHAT A PASSWORD MANAGER SEES. The username was a type="hidden" input, which
        // managers skip, so a phone filed the password under no address and offered
        // the wrong one back (a guest account's, on the same address) next time.
        const pmf = await page.evaluate(() => {
            const u = /** @type {HTMLInputElement} */ (document.getElementById('login-email'));
            const p = /** @type {HTMLInputElement} */ (document.getElementById('login-password'));
            return { type: u.type, auto: u.autocomplete, val: u.value, ro: u.readOnly, form: !!p.form && u.form === p.form, pw: p.autocomplete, focus: document.activeElement === p };
        });
        ok(pmf.type !== 'hidden' && pmf.auto === 'username' && pmf.val === 'sophiahart' && pmf.ro && pmf.form && pmf.pw === 'current-password', `the password step is a real form a password manager can read: username "${pmf.val}" (${pmf.type}, ${pmf.auto}) beside the password`);
        ok(pmf.focus, '…and the caret starts in the password, not the read-only name');
        await page.fill('#login-password', 'sophias own passphrase');
        await page.press('#login-password', 'Enter');
        await page.waitForTimeout(500);
        ok(posts.some((p) => p.b.action === 'admin_login' && p.b.username === 'sophiahart'), 'Return signs in (the form submits)');
        ok(/Check your email/.test(await step()) && /This device is new to your sign-in, so we sent a 6-digit code to s•••••@example\.com/.test(await text()), 'a new device asks for a code, sent to HER inbox (masked)');
        ok(!/Use a password instead/.test(await text()) && !(await page.evaluate(() => !!document.querySelector('.modal-overlay.open:not(#guest-auth-modal)'))), 'in the same sheet, with no detour to another dialog');
        await page.fill('#ga-code', '111111');
        await page.waitForTimeout(400);
        ok(/isn’t right/.test(await text()), 'a wrong code says so');
        await page.fill('#ga-code', '428913');
        await page.waitForTimeout(700);
        const twofa = posts.filter((p) => p.b.action === 'admin_2fa').pop();
        ok(twofa && twofa.b.remember === true && (await inBackOffice()), 'the right code signs her in, and remembers this device');
        ok(/won’t ask for a code again/.test(await page.evaluate(() => document.body.textContent)), 'and says the device is remembered');

        // THREE EQUAL WAYS IN: an emailed code (it alone signs her in), a password,
        // or a passkey. The code used to be followed by the password.
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
        st.login = 'ok';
        await page.evaluate(() => { localStorage.removeItem('chb-last-guest'); openGuestAuthModal(); });
        await page.waitForTimeout(300);
        ok(await page.evaluate(() => !!document.querySelector('#ga-auth [data-act="passkeyLogin"]')), 'the first step offers a passkey');
        await page.fill('#login-email', 'sophia@example.com');
        await page.click('#ga-auth [data-act="authContinue"]');
        await page.waitForTimeout(400);
        ok(/Check your email/.test(await step()) && /Or tap the link in the same email/.test(await text()) && /Use a password instead/.test(await text()), 'her email gets a code, with a password as the other way');
        const beforeCode = posts.length;
        await page.fill('#ga-code', '515151');
        await page.waitForTimeout(700);
        ok((await inBackOffice()) && !/Your password/.test(await step()), 'the code alone signs her in: no password step after it');
        ok(!posts.slice(beforeCode).some((p) => p.b.action === 'admin_login' || p.b.action === 'guest_login') && (await page.evaluate(() => (window.__me || {}).id === 2)), '…as herself, with nothing more asked of the server');

        // A PASSWORD STILL WORKS, from the code step. With an email, a forgotten
        // password needs no reset: the code is the way back in.
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
        await page.evaluate(() => { localStorage.removeItem('chb-last-guest'); openGuestAuthModal(); });
        await page.waitForTimeout(300);
        await page.fill('#login-email', 'sophia@example.com');
        await page.click('#ga-auth [data-act="authContinue"]');
        await page.waitForTimeout(400);
        await page.click('#ga-auth [data-act="authToPassword"]');
        await page.waitForTimeout(300);
        ok(/Your password/.test(await step()) && /Email me a code instead/.test(await text()) && !/confirmed/.test(await text()), 'the password is one tap from the code, and the code one tap back');
        st.login = 'wrong';
        const beforeWrong = posts.length;
        await page.fill('#login-password', 'not her password');
        await page.click('#ga-auth [data-submit="authPasswordGo"]');
        await page.waitForTimeout(600);
        ok(/don’t match/.test(await text()) && !(await inBackOffice()) && (await page.evaluate(() => !currentGuest)), 'a wrong password signs nobody in, and says so');
        ok(posts.slice(beforeWrong).some((p) => p.b.action === 'admin_login' && p.b.username === 'sophia@example.com'), '…having asked the back office first');
        st.login = 'ok';
        await page.fill('#login-password', 'sophias own passphrase');
        await page.click('#ga-auth [data-submit="authPasswordGo"]');
        await page.waitForTimeout(600);
        ok(await inBackOffice(), 'and with the right password, she is in');

        // A forgotten password, from her username: a link to her own inbox, and the
        // page never says whether the sign-in exists.
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
        await page.evaluate(() => { localStorage.removeItem('chb-last-guest'); openGuestAuthModal(); });
        await page.waitForTimeout(300);
        await page.fill('#login-email', 'sophiahart');
        await page.click('#ga-auth [data-act="authContinue"]');
        await page.waitForTimeout(300);
        await page.click('#ga-auth [data-act="authForgot"]');
        await page.waitForTimeout(400);
        ok(posts.some((p) => p.b.action === 'admin_reset_request' && p.b.id === 'sophiahart') && /If sophiahart has a back-office sign-in, we’ve sent a link/.test(await text()), 'a forgotten password sends a link — the page never says whether the sign-in exists');

        // A switched-off sign-in says so, and is never tried as a guest.
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
        st.login = 'removed';
        await page.evaluate(() => { localStorage.removeItem('chb-last-guest'); openGuestAuthModal(); });
        await page.waitForTimeout(300);
        await page.fill('#login-email', 'sophiahart');
        await page.click('#ga-auth [data-act="authContinue"]');
        await page.waitForTimeout(300);
        await page.fill('#login-password', 'sophias own passphrase');
        const before = posts.length;
        await page.click('#ga-auth [data-submit="authPasswordGo"]');
        await page.waitForTimeout(500);
        ok(/This sign-in has been switched off\. Ask George if you need it back\./.test(await text()), 'a switched-off sign-in says so, and who to ask');
        ok(!posts.slice(before).some((p) => p.b.action === 'guest_login'), '…and is never tried as a guest sign-in');

        // The invite link: she chooses her own password, then is offered a passkey.
        await page.goto(`${base}/index.html?invite=2.${'a1'.repeat(24)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        ok(/Welcome, Sophia/.test(await step()) && /George has given you a sign-in/.test(await text()), 'the invite greets her by name and says who');
        // The password she chooses (or the phone suggests) is filed under the address
        // she signs in with, so the phone offers it back at the next sign-in.
        const inv = await page.evaluate(() => {
            const u = /** @type {HTMLInputElement} */ (document.getElementById('ga-user'));
            const p = /** @type {HTMLInputElement} */ (document.getElementById('ga-new'));
            return { val: u && u.value, auto: u && u.autocomplete, form: !!(u && p && u.form && u.form === p.form), pw: p && p.autocomplete };
        });
        ok(inv.val === 'sophia@example.com' && inv.auto === 'username' && inv.form && inv.pw === 'new-password', `…with her sign-in address as the form's username (${inv.val}), so a saved password is filed under it`);
        ok(await page.evaluate(() => !/invite=/.test(location.search)), 'the link leaves the address bar');
        await page.fill('#ga-new', 'short');
        await page.fill('#ga-new2', 'short');
        await page.click('#ga-auth [data-submit="authNewPassword"]');
        await page.waitForTimeout(200);
        ok(/at least 12 characters/.test(await text()) && !posts.some((p) => p.b.action === 'admin_invite_accept'), 'a short password is refused before anything is sent');
        await page.fill('#ga-new', 'sophias own passphrase');
        await page.fill('#ga-new2', 'sophias other phrase');
        await page.click('#ga-auth [data-submit="authNewPassword"]');
        await page.waitForTimeout(200);
        ok(/don’t match/.test(await text()), 'two that do not match are refused');
        await page.fill('#ga-new', 'sophias own passphrase');
        await page.fill('#ga-new2', 'sophias own passphrase');
        await page.click('#ga-auth [data-submit="authNewPassword"]');
        await page.waitForTimeout(500);
        const acc = posts.filter((p) => p.b.action === 'admin_invite_accept').pop();
        ok(acc && acc.b.link === '2.' + 'a1'.repeat(24) && acc.b.password === 'sophias own passphrase', 'saving sends the link and her password');
        ok(/Sign in with a passkey next time\?/.test(await step()), 'then a passkey is offered');
        await page.click('#ga-auth [data-act="authOfferSkip"]');
        await page.waitForTimeout(500);
        ok((await inBackOffice()) && /add a passkey any time/.test(await page.evaluate(() => document.body.textContent)), '“Not now” lands her in the back office, saying where to add one later');

        // The reset link.
        await page.goto(`${base}/index.html?areset=2.${'b2'.repeat(24)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        ok(/Choose a new password/.test(await step()) && /Saving it signs you out on your other devices/.test(await text()), 'a reset link asks for a new password, saying what saving does');
        await page.fill('#ga-new', 'a brand new passphrase');
        await page.fill('#ga-new2', 'a brand new passphrase');
        await page.click('#ga-auth [data-submit="authNewPassword"]');
        await page.waitForTimeout(600);
        ok((await inBackOffice()) && posts.some((p) => p.b.action === 'admin_reset_save'), 'saving it signs her in');

        // A dead link says so, on the email step.
        st.link = 'dead';
        await page.goto(`${base}/index.html?invite=2.${'c3'.repeat(24)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        ok(/Sign in or create an account/.test(await step()) && /invite link has been used or has expired\. Ask George/.test(await text()), 'a used or expired link says so, and who to ask');

        // THE CODE EMAIL'S ONE-TAP LINK. The code screen says "or tap the link in the
        // same email": the sheet opens on the code and checks it exactly as if typed,
        // which signs in the device that opened it.
        const beforeLink = posts.length;
        await page.goto(`${base}/index.html?signin=${encodeURIComponent('sophia@example.com')}&code=515151`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1400);
        ok(posts.slice(beforeLink).some((p) => p.b.action === 'guest_code_verify' && p.b.email === 'sophia@example.com' && p.b.code === '515151'), 'the code email’s link checks its code, as if typed');
        ok((await inBackOffice()) && (await page.evaluate(() => !/signin=|code=/.test(location.search))), '…signs her in, and leaves the address bar');
        await page.close();
    }

    console.log(fails ? `\n${fails} check(s) failed` : '\nALL PEOPLE CHECKS PASSED');
    await done(fails);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
