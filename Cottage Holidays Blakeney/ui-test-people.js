// ui-test-people.js — two people, one back office (the approved demo, built).
//   §A the owner's People & access: the list, adding someone, one person's page —
//      the five switches, full access asked first, passkeys, a reset link, removal
//   §B what a LIMITED person sees: the menus, Manage, Today's jobs, the money
//      buttons and the booking form trimmed to their areas; a stale tap refused
//      in the server's words; their own alerts only
//   §C the sign-in page's back-office steps: a new device's code at the person's
//      own inbox, the email-first path, a forgotten password, an invite, a reset,
//      a dead link, and a switched-off sign-in said in words
// The server holds every rule regardless (test-people.php, test-integration §51);
// this suite holds what each person is OFFERED.
const { bootBrowser } = require('./ui-test-lib');

let fails = 0;
const ok = (c, m) => {
    console.log((c ? '  ✓ ' : '  ✗ ') + m);
    if (!c) fails++;
};

const GEORGE = {
    id: 1, name: 'George Farrow', first: 'George', named: true, email: 'george@example.com', contact: 'george@example.com', username: 'george',
    full: true, original: true, caps: {}, photo: '', state: 'active', twofa: true, twofaLive: true,
    notify: { money: true, enquiries: true, messages: true, checkout: true, system: true, quietFrom: '', quietTo: '' },
};
const SOPHIA = {
    id: 2, name: 'Sophia Hart', first: 'Sophia', named: true, email: 'sophia@example.com', contact: 'sophia@example.com', username: 'sophiahart',
    full: false, original: false, caps: { payments: true, refunds: false, money: false, prices: false, website: false }, photo: '', state: 'active',
    seen: '', twofa: true, twofaLive: true, notify: { money: false, enquiries: true, messages: true, checkout: true, system: false, quietFrom: '', quietTo: '' },
};
// Who gets which emails (people-lib.php PEOPLE_MAILS): George everything; Sophia the
// guest-facing six, with the website emails and the backup locked for her.
const KINDS = ['enquiry', 'booking', 'paid', 'messages', 'reviews', 'ideas', 'digest', 'analytics', 'backup'];
const ALL = Object.fromEntries(KINDS.map((k) => [k, true]));
Object.assign(GEORGE, { mail: Object.assign({}, ALL), mailCan: Object.assign({}, ALL), mailGets: KINDS.slice() });
Object.assign(SOPHIA, {
    mail: { enquiry: true, booking: true, paid: true, messages: true, reviews: true, ideas: false, digest: true, analytics: false, backup: false },
    mailCan: Object.assign({}, ALL, { ideas: false, analytics: false, backup: false }),
    mailGets: ['enquiry', 'booking', 'paid', 'messages', 'reviews', 'digest'],
});
const MAIL_KINDS = KINDS.map((k) => ({ k, cap: { paid: 'payments', ideas: 'website', analytics: 'website', backup: 'owner' }[k] || 'all', must: ['enquiry', 'messages', 'backup'].includes(k) }));

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
            { timeout: 5000 },
        );
    };
    const waitShut = (page) => page.waitForFunction(() => !document.getElementById('glass-dialog').classList.contains('open'), null, { timeout: 5000 });
    const shown = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
    const rowByTitle = (scope, t) => `${scope} .ga-row:has(.ga-t:text-is("${t}"))`;
    const lastToast = (page) => page.evaluate(() => { const t = [...document.querySelectorAll('#app-toasts .toast, .toast')].pop(); return t ? t.textContent.trim() : ''; });
    const signIn = async (page, me) => {
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
        await page.evaluate((m) => {
            isAuthenticated = true;
            document.body.classList.add('owner-mode');
            chbSetMe(m, 'George');
        }, me);
        await page.evaluate(() => window.loadAdminBundle());
        await page.waitForTimeout(700);
    };

    // ================================================================ §A owner
    {
        const posts = [];
        const st = { people: [Object.assign({ you: true }, GEORGE), Object.assign({ you: false, passkeys: 1 }, SOPHIA)], keys: [{ id: 7, label: 'iPhone', created_at: '2026-06-03 10:00:00', last_used_at: '2026-10-07 09:41:00' }], failCap: false };
        const page = await newPage((route) => {
            const json = fulfil(route);
            const b = bodyOf(route);
            const file = fileOf(route);
            if (route.request().method() === 'POST') posts.push({ file, b });
            if (file === 'auth.php' && b.action === 'admin_status') return json({ admin: true, me: GEORGE, ownerFirst: 'George' });
            if (file === 'people.php') {
                if (b.action === 'list') return json({ ok: true, people: st.people, mailKinds: MAIL_KINDS, mailExtras: ['co@example.com'] });
                if (b.action === 'set_mail') {
                    if (b.kind === 'enquiry' && b.on === false && b.id === 1) return json({ error: 'Someone has to get new enquiries — a guest is waiting for a reply.', code: 'must' }, 409);
                    st.people = st.people.map((p) => (p.id === b.id ? Object.assign({}, p, { mail: Object.assign({}, p.mail, { [b.kind]: !!b.on }) }) : p));
                    return json({ ok: true, people: st.people, mailKinds: MAIL_KINDS, mailExtras: ['co@example.com'] });
                }
                if (b.action === 'invite') {
                    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) return json({ error: 'That doesn’t look like an email address.' }, 400);
                    st.people = st.people.concat([{ id: 3, name: b.name, first: b.name.split(' ')[0], named: true, email: b.email, contact: b.email, username: 'ellie', full: false, caps: { payments: true }, photo: '', state: 'invited', you: false, passkeys: 0, mail: Object.assign({}, SOPHIA.mail), mailCan: Object.assign({}, SOPHIA.mailCan), mailGets: [] }]);
                    return json({ ok: true, sent: true, id: 3, people: st.people });
                }
                if (b.action === 'set_cap') {
                    if (st.failCap) return json({ error: 'Database is down' }, 500);
                    st.people = st.people.map((p) => (p.id === b.id ? Object.assign({}, p, { caps: Object.assign({}, p.caps, { [b.cap]: !!b.on }) }) : p));
                    return json({ ok: true, people: st.people });
                }
                if (b.action === 'set_full') {
                    st.people = st.people.map((p) => (p.id === b.id ? Object.assign({}, p, { full: !!b.on }) : p));
                    return json({ ok: true, people: st.people });
                }
                if (b.action === 'passkeys') return json({ ok: true, passkeys: st.keys });
                if (b.action === 'passkey_remove') {
                    st.keys = st.keys.filter((k) => k.id !== b.key);
                    return json({ ok: true, passkeys: st.keys, people: st.people });
                }
                if (b.action === 'reset_link' || b.action === 'reinvite') return json({ ok: true, sent: true, people: st.people });
                if (b.action === 'remove') {
                    st.people = st.people.map((p) => (p.id === b.id ? Object.assign({}, p, { state: 'removed', removed: '2026-10-08 10:00:00' }) : p));
                    return json({ ok: true, people: st.people });
                }
                if (b.action === 'cancel_invite') {
                    st.people = st.people.filter((p) => p.id !== b.id);
                    return json({ ok: true, people: st.people });
                }
            }
            if (file === 'passkeys.php' && b.action === 'admin_list') return json({ ok: true, passkeys: [] });
            return json(EMPTY);
        });
        await signIn(page, GEORGE);
        await page.evaluate(async () => {
            await openArea();
            settingsOpen('acct');
        });
        await page.waitForTimeout(700);
        console.log('§A the owner: People & access');
        const acct = await page.evaluate(() => ({
            people: ((document.querySelector('#acct-body .oa-r-people .ga-s') || {}).textContent || ''),
            details: ((document.querySelector('#acct-body .oa-r-details .ga-s') || {}).textContent || ''),
        }));
        ok(acct.people === 'You and Sophia', `the account page names who else signs in (${acct.people})`);
        // The row says what it is and nothing else (the one-look pass): the
        // page it opens carries the name and email.
        ok(acct.details === '', `Your details is a one-line row, no sub restating it (${acct.details})`);
        await page.click(rowByTitle('#acct-body', 'People & access'));
        await page.waitForTimeout(600);
        const list = await page.evaluate(() => [...document.querySelectorAll('#people-body .ga-group:first-of-type .ga-row')].map((r) => ({ t: (r.querySelector('.ga-t') || {}).textContent, s: (r.querySelector('.ga-s') || {}).textContent || '', btn: r.tagName === 'BUTTON' })));
        ok(list.map((r) => r.t).join() === 'George Farrow,Sophia Hart,Add someone', `the list: you, Sophia, then Add someone (${list.map((r) => r.t).join(' · ')})`);
        ok(/you$/.test(list[0].s) && !list[0].btn, `your own row says it is you and opens nothing (${list[0].s})`);
        ok(/^Host · /.test(list[1].s) && list[1].btn, `Sophia's row says what she is and opens her page (${list[1].s})`);
        ok(await page.evaluate(() => !!document.querySelector('#people-body .ga-row .ga-ava.oa-pava')), 'each person leads with their photo or initial');

        // Add someone: their name and email, never a password.
        await page.click(rowByTitle('#people-body', 'Add someone'));
        await waitDlg(page);
        const addDlg = await page.evaluate(() => ({ title: document.getElementById('glass-dialog-title').textContent, ok: document.getElementById('glass-dialog-ok').textContent, fields: [...document.querySelectorAll('#glass-dialog-fields input')].map((i) => i.id + ':' + i.type) }));
        ok(addDlg.title === 'Add someone' && addDlg.ok === 'Send the invite' && addDlg.fields.join() === 'gdf-name:text,gdf-email:email', `Add someone asks for a name and an email, and no password (${addDlg.fields.join(', ')})`);
        await page.click('#glass-dialog-ok');
        await waitDlg(page, /Enter their name/);
        ok(!posts.some((p) => p.b.action === 'invite'), 'no name is refused before anything is sent');
        await page.fill('#gdf-name', 'Ellie Marsh');
        await page.fill('#gdf-email', 'ellie@');
        await page.click('#glass-dialog-ok');
        await waitDlg(page, /look like an email/);
        ok((await page.evaluate(() => document.getElementById('gdf-name').value)) === 'Ellie Marsh', "the server's refusal keeps the form open with what was typed");
        await page.fill('#gdf-email', 'ellie@example.com');
        await page.click('#glass-dialog-ok');
        await waitShut(page);
        await page.waitForTimeout(400);
        const inv = posts.filter((p) => p.b.action === 'invite').pop();
        ok(inv && inv.b.name === 'Ellie Marsh' && inv.b.email === 'ellie@example.com' && !('password' in inv.b), 'the invite carries a name and an email, never a password');
        ok(/Invite sent to ellie@example\.com/.test(await lastToast(page)), 'and says where it went');
        ok(await page.evaluate(() => [...document.querySelectorAll('#people-body .ga-row .ga-s')].some((s) => /Invited · waiting for Ellie to choose a password/.test(s.textContent))), 'the list shows her waiting to choose a password');

        // Who gets which emails: from People.
        ok((await page.evaluate(() => (document.querySelector('#people-body .oa-r-emails .ga-s') || {}).textContent)) === '9 kinds to you · 6 to Sophia · 6 to Ellie', 'People says who gets which emails, in counts');
        await page.click(rowByTitle('#people-body', 'Who gets which emails'));
        await page.waitForTimeout(700);
        const em = await page.evaluate(() => ({
            back: (document.querySelector('#emails-body .oa-back') || {}).textContent,
            sent: [...document.querySelectorAll('#emails-body .oa-person .ga-t')].map((e) => e.textContent),
            ellie: [...document.querySelectorAll('#emails-body .oa-person .ga-s')].map((e) => e.textContent).pop(),
            heads: [...document.querySelectorAll('#emails-body .em-cap')].map((c) => [...c.querySelectorAll('.em-heads span')].map((x) => x.textContent).join('+')),
            rows: [...document.querySelectorAll('#emails-body .em-row')].map((r) => r.dataset.mail),
            sophia: Object.fromEntries([...document.querySelectorAll('#emails-body .em-row')].map((r) => { const t = r.querySelectorAll('.em-tog')[1]; return [r.dataset.mail, t.classList.contains('is-locked') ? 'lock' : t.getAttribute('aria-pressed')]; })),
            george: [...document.querySelectorAll('#emails-body .em-row')].every((r) => r.querySelectorAll('.em-tog')[0].getAttribute('aria-pressed') === 'true'),
            digestNote: ((document.querySelector('#emails-body .em-row[data-mail="digest"] .em-also') || {}).textContent || ''),
            also: [...document.querySelectorAll('#emails-body .ga-group')].pop().textContent,
            badges: [...document.querySelectorAll('#emails-body .em-tog[aria-pressed="true"]')].every((t) => !!t.querySelector('.em-badge')),
        }));
        ok(em.back === 'People' && em.sent.join() === 'George Farrow (you),Sophia Hart,Ellie Marsh', `it lists who it is sent to, back to People (${em.sent.join(' · ')})`);
        ok(/emails start once Ellie has chosen a password/.test(em.ellie || ''), 'an invite says the emails start once a password is chosen');
        ok(em.heads.join() === 'George+Sophia+Ellie,George+Sophia+Ellie' && em.rows.join() === 'enquiry,booking,paid,messages,reviews,ideas,digest,analytics,backup', 'a row per email, a photo per person, as it happens then every week');
        ok(em.george && em.sophia.enquiry === 'true' && em.sophia.digest === 'true' && em.sophia.ideas === 'lock' && em.sophia.analytics === 'lock' && em.sophia.backup === 'lock', `her photos: lit where she gets it, locked where an area is off (${JSON.stringify(em.sophia)})`);
        ok(em.badges, 'a lit photo carries a tick, never colour alone');
        ok(em.digestNote === 'Sophia’s and Ellie’s copies leave out the money', `the digest row says whose copy leaves out the money (${em.digestNote})`);
        ok(/co@example\.com/.test(em.also) && /Add an address/.test(em.also), 'and the extra addresses sit at the foot, with a way to add one');
        const before = posts.length;
        await page.click('#emails-body .em-row[data-mail="ideas"] .em-tog.is-locked', { force: true }); // aria-disabled: a tap explains, it never sends
        await page.waitForTimeout(300);
        ok(posts.length === before && /Sophia can’t get this yet\. Switch on Website and marketing on Sophia’s page first\./.test(await lastToast(page)), 'a locked photo says why, and sends nothing');
        await page.click('#emails-body .em-row[data-mail="digest"] .em-tog:nth-child(2)');
        await page.waitForTimeout(500);
        const sm = posts.filter((p) => p.b.action === 'set_mail').pop();
        ok(sm && sm.b.id === 2 && sm.b.kind === 'digest' && sm.b.on === false, 'tapping her photo stops that one email for her');
        ok((await page.evaluate(() => document.querySelector('#emails-body .em-row[data-mail="digest"] .em-tog:nth-child(2)').getAttribute('aria-pressed'))) === 'false', '…and the photo fades');
        await page.click('#emails-body .em-row[data-mail="enquiry"] .em-tog:nth-child(1)');
        await page.waitForTimeout(500);
        ok(/Someone has to get new enquiries/.test(await lastToast(page)) && (await page.evaluate(() => document.querySelector('#emails-body .em-row[data-mail="enquiry"] .em-tog:nth-child(1)').getAttribute('aria-pressed'))) === 'true', 'the last person on new enquiries can’t be switched off, and says why');
        await page.click('#emails-body .oa-back');
        await page.waitForTimeout(500);

        // Sophia's page.
        await page.click(rowByTitle('#people-body', 'Sophia Hart'));
        await page.waitForTimeout(800);
        const pp = await page.evaluate(() => ({
            h1: (document.querySelector('#person-body h1') || {}).textContent,
            caps: [...document.querySelectorAll('#person-body .ga-cap')].map((c) => c.textContent),
            full: (document.getElementById('oa-full') || {}).checked,
            switches: [...document.querySelectorAll('#person-body .oa-cap')].map((r) => (r.querySelector('.ga-t') || {}).textContent + '=' + r.querySelector('input').checked),
            always: !!document.querySelector('#person-body .st-cap'),
            sign: [...document.querySelectorAll('#person-body .ga-group')].map((g) => g.textContent).find((t) => /Send a password reset link/.test(t)) || '',
            pwField: document.querySelectorAll('#person-body input[type="password"]').length,
            danger: (document.querySelector('#person-body .ga-signout .ga-t') || {}).textContent,
        }));
        ok(pp.h1 === 'Sophia Hart', 'her page is headed with her name');
        ok(pp.caps.join(' | ') === 'What Sophia can do | Only you | Emails | Sign-in', `it says what she can do, what only you can, her emails and her sign-in (${pp.caps.join(' | ')})`);
        ok(pp.full === false && pp.always, 'full access is off; the everyday work is always hers');
        ok(pp.switches.join() === 'Take payments=true,Refunds and deposits=false,Money overview=false,Prices and cottages=false,Website and marketing=false', `the five switches show her real settings (${pp.switches.join(', ')})`);
        ok(/Passkey on iPhone/.test(pp.sign) && /Send a password reset link/.test(pp.sign) && pp.pwField === 0, 'her sign-in lists her passkey and a reset link — never a password');
        ok(pp.danger === 'Remove Sophia’s access', 'removing her access is the last, destructive row');
        ok((await page.evaluate(() => (document.querySelector('#person-body .oa-r-emails .ga-s') || {}).textContent)) === 'New enquiries, new bookings, payments received and 2 more', 'her page names the emails she gets');
        await page.click('#person-body .oa-r-emails');
        await page.waitForTimeout(600);
        ok((await page.evaluate(() => (document.querySelector('#emails-body .oa-back') || {}).textContent)) === 'Sophia', '…opening the same page, which goes back to hers');
        await page.click('#emails-body .oa-back');
        await page.waitForTimeout(600);

        await page.click('#person-body .oa-cap:has(.ga-t:text-is("Refunds and deposits")) .chb-switch');
        await page.waitForTimeout(400);
        const sc = posts.filter((p) => p.b.action === 'set_cap').pop();
        ok(sc && sc.b.id === 2 && sc.b.cap === 'refunds' && sc.b.on === true, 'a switch saves that one area for her');
        st.failCap = true;
        await page.click('#person-body .oa-cap:has(.ga-t:text-is("Money overview")) .chb-switch');
        await waitDlg(page, /Database is down/);
        await page.click('#glass-dialog-ok');
        await waitShut(page);
        ok(await page.evaluate(() => document.getElementById('oa-cap-money').checked === false), 'a refused switch goes back to the truth');
        st.failCap = false;

        await page.click('#person-body .oa-swrow:has(#oa-full) .chb-switch');
        await waitDlg(page, /Give Sophia full access/);
        ok(/everything you can, including adding and removing people/.test(await page.evaluate(() => document.getElementById('glass-dialog-msg').innerText)), 'full access asks first, and says what it means');
        await page.click('#glass-dialog-cancel');
        await waitShut(page);
        await page.waitForTimeout(200);
        ok(!posts.some((p) => p.b.action === 'set_full') && (await page.evaluate(() => document.getElementById('oa-full').checked === false)), 'backing out changes nothing');

        await page.click('#person-body .ga-row:has(.ga-t:text-is("Passkey on iPhone"))');
        await waitDlg(page, /Remove Sophia’s passkey/);
        ok(/password still works/.test(await page.evaluate(() => document.getElementById('glass-dialog-msg').innerText)), "removing her passkey says her password still works");
        await page.click('#glass-dialog-ok');
        await waitShut(page);
        await page.waitForTimeout(400);
        ok(posts.some((p) => p.b.action === 'passkey_remove' && p.b.id === 2 && p.b.key === 7), '…then removes that one');
        ok(await page.evaluate(() => /No passkeys yet/.test(document.getElementById('person-body').textContent)), 'and her page says she has none now');

        await page.click(rowByTitle('#person-body', 'Send a password reset link'));
        await page.waitForTimeout(400);
        ok(posts.some((p) => p.b.action === 'reset_link' && p.b.id === 2) && /Sophia chooses the new password/.test(await lastToast(page)), 'a reset sends her a link; she chooses the password');

        await page.click('#person-body .ga-signout .ga-row');
        await waitDlg(page, /Remove Sophia’s access/);
        ok(await page.evaluate(() => document.getElementById('glass-dialog-ok').classList.contains('is-danger') && /signed out everywhere straight away/.test(document.getElementById('glass-dialog-msg').innerText)), 'removing access asks first, in the destructive style, saying what happens');
        await page.click('#glass-dialog-ok');
        await waitShut(page);
        await page.waitForTimeout(400);
        ok(await page.evaluate(() => /Give Sophia access again/.test(document.getElementById('person-body').textContent) && document.querySelector('#person-body h1').textContent === 'Sophia Hart'), 'her page then offers to give the access back, and is still hers');
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
        await signIn(page, SOPHIA);
        console.log('§B what a limited person sees');
        await page.evaluate(() => nav('view-backoffice'));
        await page.waitForTimeout(400);
        const dock = await page.evaluate(() => [...document.querySelectorAll('header .admin-dock-btn')].filter((b) => b.getClientRects().length).map((b) => b.dataset.view));
        ok(!dock.includes('view-accounts'), `the menu leaves out Payments (${dock.join(', ')})`);
        ok(dock.includes('view-inbox') && dock.includes('view-keysafe') && dock.includes('view-settings'), '…and keeps the Inbox, Key safes and Manage');
        await page.evaluate(() => openArea());
        await page.waitForTimeout(700);
        const idx = await page.evaluate(() => ({
            rows: [...document.querySelectorAll('#settings-index .settings-row')].filter((r) => r.getClientRects().length).map((r) => (r.querySelector('.settings-row-label') || {}).textContent),
            labels: [...document.querySelectorAll('#settings-index .settings-section-label')].filter((l) => l.getClientRects().length).map((l) => l.textContent),
            summary: (() => { const m = document.getElementById('manage-verdicts'); return !!m && m.getClientRects().length > 0; })(),
            first: (() => { const c = [...document.getElementById('settings-index').children].find((x) => x.getClientRects().length); return c ? c.id : ''; })(),
        }));
        const want = ['Guest list', 'Waitlist', 'Reviews', 'Guest photos', 'Saved replies', 'Guest chat'];
        ok(want.every((t) => idx.rows.some((r) => (r || '').indexOf(t) === 0)), `Manage keeps her everyday rows (${idx.rows.join(' · ')})`);
        const gone = ['Seasonal rates', 'Price ideas', 'Calendar sync', 'Cancellation policy', 'Follow-up emails', 'Text messages', 'Home page & menu', 'Things to do', 'Newsletter', 'Analytics', 'Status', 'Backups', 'Activity log', 'Integrations', 'Search learning'];
        ok(!gone.some((t) => idx.rows.includes(t)), 'and none of the areas switched off for her');
        ok(!idx.labels.includes('Website & marketing') && !idx.labels.includes('System & tools') && !idx.labels.includes('Cottages & pricing'), `a group left with nothing in it goes too (${idx.labels.join(' · ')})`);
        ok(!idx.summary, 'the system summary row is full access only');
        ok(idx.first === 'oa-acct-grp' && !idx.labels.includes('Your account'), `her own account is the first thing on Manage, with no heading over it (${idx.first})`);
        await page.evaluate(() => settingsOpen('acct'));
        await page.waitForTimeout(500);
        const acct = await page.evaluate(() => ({ lead: (document.querySelector('#acct-body .ga-lead') || {}).textContent, people: !!document.querySelector('#acct-body .oa-r-people'), host: !!document.querySelector('#acct-body .oa-r-host') }));
        ok(acct.lead === 'Host' && !acct.people && acct.host, 'her account says Host, has no People & access, and keeps the host profile');
        await page.evaluate(() => settingsOpen('payments'));
        await page.waitForTimeout(300);
        ok(/That’s for George to change\./.test(await lastToast(page)) && (await shown(page, '#settings-index')), 'a stale link to a switched-off page is refused in the server’s words');
        await page.evaluate(() => nav('view-accounts'));
        await page.waitForTimeout(300);
        ok(await page.evaluate(() => document.getElementById('view-backoffice').classList.contains('active')), '…and a switched-off screen lands on Today instead');
        // Today: only the jobs she can do.
        const duties = await page.evaluate(() => {
            const real = window.chbDutiesAll;
            window.chbDutiesAll = () => [
                { kind: 'deposit', key: 'deposit:1', label: 'Return Emma’s £60 deposit', sev: 'warn' },
                { kind: 'balance', key: 'balance:2', label: '£580 to collect', sev: 'warn' },
                { kind: 'cron', label: 'Automation stopped', sev: 'danger' },
                { kind: 'enquiry', key: 'enquiry:3', label: 'Jane’s enquiry', sev: 'warn' },
            ];
            const out = chbDuties().map((d) => d.kind);
            window.chbDutiesAll = real;
            return out;
        });
        ok(duties.join() === 'balance,enquiry', `Today shows only her jobs: no deposit return, no automation (${duties.join(', ')})`);
        // The money buttons follow her switches: payments on, refunds off.
        const btns = await page.evaluate(() => {
            const box = document.createElement('div');
            box.innerHTML = '<button id="t-req" data-act="requestPayment">Request</button><button id="t-ret" data-act="returnDeposit">Return</button><button id="t-acc" data-act="openAccounts">Payments</button>';
            document.body.appendChild(box);
            const vis = (id) => document.getElementById(id).getClientRects().length > 0;
            return { req: vis('t-req'), ret: vis('t-ret'), acc: vis('t-acc') };
        });
        ok(btns.req && !btns.ret && !btns.acc, `asking for money stays (Take payments); returning a deposit and Payments go (${JSON.stringify(btns)})`);
        let called = false;
        await page.exposeFunction('__peopleCalled', () => { called = true; });
        await page.evaluate(() => {
            window.returnDeposit = () => window.__peopleCalled();
            const b = document.getElementById('t-ret');
            b.style.display = 'inline-block';
            b.setAttribute('style', 'display:inline-block !important');
            b.click();
        });
        await page.waitForTimeout(300);
        ok(!called && /That’s for George to change\./.test(await lastToast(page)), 'a stale render that still shows one is refused, and the action never runs');
        // The booking form keeps its money parts to herself only with Take payments.
        await page.evaluate((m) => chbSetMe(Object.assign({}, m, { caps: Object.assign({}, m.caps, { payments: false }) }), 'George'), SOPHIA);
        const formHidden = await page.evaluate(() => ['modal-payment-group', 'modal-deposit-group', 'modal-override-group', 'modal-plan-group'].every((id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display === 'none'; }));
        ok(formHidden, 'without Take payments the booking form has no payment, deposit, price or plan fields');
        ok(await page.evaluate(() => getComputedStyle(document.getElementById('t-req')).display === 'none'), '…and asking for money goes too');
        // Her alerts: never a kind she cannot get.
        await page.evaluate((m) => chbSetMe(m, 'George'), SOPHIA);
        await page.evaluate(async () => {
            await openArea();
            settingsOpen('notify');
        });
        await page.waitForTimeout(500);
        const kinds = () => page.evaluate(() => [...document.querySelectorAll('#notify-prefs-body .oa-swrow .ga-t')].map((e) => e.textContent));
        const nf = await kinds();
        ok(!nf.some((k) => /system/i.test(k)) && nf.includes('Payments and money') && nf.length === 4, `her alerts: money because she takes payments, never the system notices (${nf.join(' · ')})`);
        ok(!(await page.evaluate(() => !!document.getElementById('notify-emails-list'))), 'and the shared email list is full access only');
        ok((await page.evaluate(() => (document.querySelector('#notify-body .oa-r-emails .ga-s') || {}).textContent)) === '6 kinds, all to sophia@example.com', 'her Notifications say which emails reach her, and where');
        await page.click('#notify-body .oa-r-emails');
        await page.waitForTimeout(600);
        const mine = await page.evaluate(() => ({
            h1: (document.querySelector('#emails-body h1') || {}).textContent,
            lead: (document.querySelector('#emails-body .ga-lead') || {}).textContent,
            rows: [...document.querySelectorAll('#emails-body .ga-row .ga-t')].map((e) => e.textContent),
            digest: (([...document.querySelectorAll('#emails-body .ga-row')].find((r) => (r.querySelector('.ga-t') || {}).textContent === 'Weekly digest') || {}).textContent || ''),
            togs: document.querySelectorAll('#emails-body .em-tog').length,
        }));
        ok(mine.h1 === 'Emails you get' && /George chooses who gets which emails\. Yours come to sophia@example\.com\./.test(mine.lead), 'her page says who chooses, and where hers go');
        ok(mine.rows.join() === 'New enquiries,New bookings,Payments received,Guest messages,Reviews to approve,Weekly digest' && mine.togs === 0, `the emails she gets, read-only (${mine.rows.join(' · ')})`);
        ok(/without the money/.test(mine.digest), 'her digest says it leaves out the money');
        await page.click('#emails-body .oa-back');
        await page.waitForTimeout(500);
        await page.evaluate((m) => chbSetMe(Object.assign({}, m, { caps: Object.assign({}, m.caps, { payments: false }) }), 'George'), SOPHIA);
        await page.evaluate(() => renderNotifyPrefs());
        const nf2 = await kinds();
        ok(!nf2.includes('Payments and money') && nf2.length === 3, `without Take payments the money alerts go too (${nf2.join(' · ')})`);
        await page.evaluate((m) => chbSetMe(m, 'George'), SOPHIA);
        ok(await page.evaluate(() => /Sophia/.test(chbDaySentence().greet)), 'the greeting is hers');
        // The search window's system line is full access only (she is never sent
        // the state it reports). Wide, because a phone stands the quiet line down anyway.
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.evaluate(() => openCmdK());
        await page.waitForTimeout(400);
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
