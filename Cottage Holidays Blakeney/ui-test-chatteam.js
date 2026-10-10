// ui-test-chatteam.js — the guest chat says who answers (the approved Messages demo).
//   §1 the header names the people, with their faces, and opens who they are
//   §2 a signed-in guest's stay is pinned under it, and opens the stay
//   §3 every reply is signed: the name above a run, the face and time under it;
//      someone not shown, or from before replies were signed, is the crown
//   §4 the away reply says it is automatic; a pay link sent from the chat is one line
//   §5 "Sent" turns to "Seen" where it stands, with nothing arriving
//   §6 "George is typing", by name and face; someone not shown types as the crown
//   §7 away now: the header and the welcome say until when
//   §8 an instant answer is the cottage guide, and offers the people by name
//   §9 with nobody shown, the chat is the one it always was
//   §10 words from the server are sanitised and escaped
// The messages.php stub answers from `state`, so each section sets the facts it
// is about and asks the REAL client to draw them.
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
const AT = (day, hm) => {
    const t = new Date();
    const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + day);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')} ${hm}:00`;
};
const THREAD = () => [
    { id: 1, role: 'guest', body: 'Is there any chance of checking in early?', at: AT(-1, '18:02'), read: true, by: 0, kind: '' },
    { id: 2, role: 'admin', body: 'The cottage is cleaned that morning, so 1pm should be fine.', at: AT(-1, '18:20'), by: 1, kind: '' },
    { id: 3, role: 'admin', body: 'Is there anything you need for the little one?', at: AT(-1, '18:21'), by: 1, kind: '' },
    { id: 4, role: 'admin', body: 'Emailed you a secure link to pay your balance of £414.90.', at: AT(-1, '18:40'), by: 2, kind: 'event' },
    { id: 5, role: 'guest', body: 'Paid, thank you! Is there a travel cot?', at: AT(0, '09:14'), read: true, by: 0, kind: '' },
    { id: 6, role: 'admin', body: 'There is a travel cot in the hall cupboard.', at: AT(0, '09:31'), by: 2, kind: '' },
    { id: 7, role: 'guest', body: 'Brilliant, thank you both!', at: AT(0, '09:33'), read: false, by: 0, kind: '' },
];

(async () => {
    const { browser, base, done } = await bootBrowser();
    const d = (n) => AT(n, '00:00').slice(0, 10);
    const open = async (opts) => {
        const o = Object.assign({ guest: null, bookings: [], state: {} }, opts || {});
        const state = Object.assign({ team: TEAM, away: { on: false, until: null }, messages: [], peer_typing: false, typing_by: 0 }, o.state);
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.setDefaultTimeout(8000);
        page.on('pageerror', (e) => {
            console.log('  PAGEERR:', e.message);
            fails++;
        });
        await page.addInitScript(() => {
            if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
        });
        const posts = [];
        await page.route(/\.php/, (route) => {
            const url = route.request().url();
            const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
            let b = {};
            try {
                b = JSON.parse(route.request().postData() || '{}');
            } catch (e) {}
            if (route.request().method() === 'POST') posts.push({ url, body: b });
            if (url.includes('messages.php')) {
                if (b.action === 'send') return json({ ok: true, token: b.token || '' });
                if (b.action === 'typing') return json({ ok: true });
                const out = { ok: true, messages: state.messages, peer_typing: state.peer_typing, typing_by: state.typing_by };
                if (b.team) Object.assign(out, { team: state.team, away: state.away });
                return json(out);
            }
            if (url.includes('auth.php')) {
                if (b.action === 'guest_status') return json({ ok: true, guest: o.guest });
                return json({ ok: true, admin: false, guest: o.guest });
            }
            if (url.includes('my-bookings.php')) return json({ ok: true, bookings: o.bookings, enquiries: [], completed_stays: 0 });
            if (url.includes('content.php') || url.includes('bootstrap.php')) return json({ content: { 'host-name': 'Sophia', 'chat-reply-time': 'hours' }, rates: { properties: PROPS, seasons: {}, occupancy: {} } });
            if (url.includes('rates.php')) return json({ properties: PROPS, seasons: {}, occupancy: {} });
            if (url.includes('avatar.php')) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
            return json({ ok: true, bookings: [], enquiries: [], threads: [], messages: [], ranges: [], reviews: [], photos: [], experiences: [] });
        });
        await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(600);
        return { page, posts, state };
    };
    const openChat = async (page) => {
        await page.evaluate(() => window.toggleChat());
        await page.waitForFunction(() => !!document.querySelector('#chat-thread .chat-row, #chat-thread .chat-hello'));
        await page.waitForTimeout(300);
    };
    const guest = { name: 'Laura Bennett', email: 'laura@example.com', phone: '', address: '', postcode: '' };

    // §1
    console.log('§1 the header names the people and opens who they are');
    let { page, posts, state } = await open({ guest, state: { messages: THREAD() } });
    await openChat(page);
    const h1 = await page.evaluate(() => {
        const who = document.getElementById('chat-who');
        const st = document.querySelector('#chat-who .chat-who-s');
        const ava = [...document.querySelectorAll('#chat-who .chat-pair .chat-ava')];
        return {
            names: (document.querySelector('#chat-who .chat-who-n') || {}).textContent,
            status: st ? st.textContent : '',
            oneLine: st ? st.getBoundingClientRect().height < parseFloat(getComputedStyle(st).lineHeight) * 1.6 : false,
            faces: ava.length,
            photo: ava[0] ? ava[0].style.backgroundImage : '',
            initial: ava[1] ? ava[1].textContent : '',
            expanded: who ? who.getAttribute('aria-expanded') : null,
            reach: who ? Math.round(who.getBoundingClientRect().height) : 0,
            asked: !!document.querySelector('#chat-head-id'),
        };
    });
    ok(h1.names === 'Sophia & George', `the header names both (${h1.names})`);
    ok(h1.faces === 2 && /avatar\.php\?team=1&v=abcdef0123/.test(h1.photo), `with a face each: a photo from the public route (${h1.photo})`);
    ok(h1.initial === 'G', 'and an initial where there is no photo');
    ok(h1.status === 'Usually reply in a few hours' && h1.oneLine, `the status line fits on one line at 390px (${h1.status})`);
    ok(h1.reach >= 44, `the header's button is a 44px target (${h1.reach})`);
    const asked1 = posts.filter((p) => p.url.includes('messages.php') && p.body.action === 'thread');
    ok(asked1.length && asked1[0].body.team === 1, 'the chat asks who answers as it opens');
    await page.click('#chat-who');
    await page.waitForTimeout(450);
    const t1 = await page.evaluate(() => ({
        open: document.getElementById('chat-teamfold').classList.contains('open'),
        exp: document.getElementById('chat-who').getAttribute('aria-expanded'),
        mates: [...document.querySelectorAll('#chat-team .chat-mate')].map((m) => m.textContent.trim()),
        note: (document.querySelector('#chat-team .chat-team-note') || {}).textContent,
        h: Math.round(document.getElementById('chat-team').getBoundingClientRect().height),
    }));
    ok(t1.open && t1.exp === 'true' && t1.h > 60, 'tapping it opens the people, and says so');
    ok(t1.mates.join(' | ') === 'SSophiaHost | GGeorgeBookings & Website', `each with their line (${t1.mates.join(' | ')})`);
    ok(t1.note === 'Replies also reach you by email.', `a signed-in guest is told replies reach them by email (${t1.note})`);
    await page.click('#chat-who');
    await page.waitForTimeout(450);
    ok(await page.evaluate(() => !document.getElementById('chat-teamfold').classList.contains('open') && document.getElementById('chat-who').getAttribute('aria-expanded') === 'false'), 'and tapping again folds them away');

    // §3 (same page)
    console.log('§3 every reply is signed');
    const s3 = await page.evaluate(() => {
        const th = document.getElementById('chat-thread');
        const rows = [...th.querySelectorAll('.chat-row')];
        return {
            rows: rows.length,
            names: [...th.querySelectorAll('.chat-nm')].map((n) => n.textContent),
            faces: rows.map((r) => (r.querySelector('.chat-line .chat-ava') ? 'F' : r.querySelector('.chat-slot') ? 's' : '-')).join(''),
            metas: [...th.querySelectorAll('.chat-meta')].map((n) => n.textContent),
            ev: (th.querySelector('.chat-ev') || {}).textContent,
            evFace: !!th.querySelector('.chat-ev .chat-ava'),
            mid: [...th.querySelectorAll('.chat-msg.them')].map((m) => m.classList.contains('is-mid')).join(','),
        };
    });
    ok(s3.rows === 7, `one row per message, so the arrival animation still marks one (${s3.rows})`);
    ok(s3.names.join(' | ') === 'Sophia | George', `the name sits above the first reply of a run, once (${s3.names.join(' | ')})`);
    ok(s3.faces === '-sF--F-', `the face sits beside the LAST reply of a run (${s3.faces})`);
    ok(s3.metas.join(' | ') === '18:02 | 18:21 | 09:14 | 09:31 | 09:33 · Sent', `the time under the last of a run, and Sent under their latest (${s3.metas.join(' | ')})`);
    ok(s3.ev === 'GGeorge emailed you a secure link to pay your balance of £414.90 · 18:40' && s3.evFace, `a pay link sent from the chat is one line saying who sent it (${s3.ev})`);
    ok(s3.mid === 'true,false,false', `a run's bubbles join: only its last keeps the tail (${s3.mid})`);
    // Someone not shown (an id the team does not carry) and a reply from before.
    // Two in a row, one by an id the team does not carry and one with no author at
    // all: both are the business's, so they read as ONE run under one name.
    state.messages = THREAD().concat([
        { id: 8, role: 'admin', body: 'Old reply', at: AT(0, '10:00'), by: 9, kind: '' },
        { id: 9, role: 'admin', body: 'Older reply', at: AT(0, '10:01'), by: 0, kind: '' },
    ]);
    await page.evaluate(() => window.chatPoll());
    await page.waitForTimeout(300);
    const s3b = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#chat-thread .chat-row')];
        const a = rows[rows.length - 2];
        const b = rows[rows.length - 1];
        return {
            name: (a.querySelector('.chat-nm') || {}).textContent,
            again: !!b.querySelector('.chat-nm'),
            crown: !!b.querySelector('.chat-ava.is-crown img'),
            slot: !!a.querySelector('.chat-slot'),
        };
    });
    ok(s3b.name === 'Cottage Holidays Blakeney' && s3b.crown, `a reply by someone not shown is the business's, under the crown (${s3b.name})`);
    ok(!s3b.again && s3b.slot, 'and replies by nobody shown read as one run, not one per hidden person');
    await page.close();

    // §2
    console.log('§2 the stay is pinned under the header');
    ({ page, posts, state } = await open({ guest, bookings: [{ id: 41, prop_key: 'jollyboat', property_name: 'Jollyboat', check_in: d(6), check_out: d(9), adults: 2, children: 0, agreed_total: 400, agreed_nightly: 400, agreed_txn_fee: 0, agreed_nights: 3 }], state: { messages: THREAD() } }));
    await openChat(page);
    await page.waitForFunction(() => !document.getElementById('chat-pin').hidden);
    const p2 = await page.evaluate(() => {
        const pin = document.getElementById('chat-pin');
        const b = pin.querySelector('.chat-stay');
        return { text: pin.textContent, cap: (pin.querySelector('.chat-stay-cap') || {}).textContent, label: b ? b.getAttribute('aria-label') : '', h: b ? Math.round(b.getBoundingClientRect().height) : 0, dot: (pin.querySelector('.chat-stay-dot') || {}).getAttribute ? pin.querySelector('.chat-stay-dot').getAttribute('style') : '' };
    });
    ok(/Jollyboat/.test(p2.text) && p2.cap === 'In 6 days' && /3 nights/.test(p2.text), `the stay: cottage, when, how long (${p2.text})`);
    ok(/--prop-jollyboat/.test(p2.dot), 'in the cottage\'s own colour');
    ok(/^Your stay at Jollyboat, in 6 days, .+ Open it$/.test(p2.label) && p2.h >= 44, `a 44px button that says what it opens (${p2.label})`);
    await page.click('#chat-pin .chat-stay');
    await page.waitForTimeout(700);
    ok(await page.evaluate(() => !document.getElementById('chat-widget').classList.contains('open') && document.getElementById('view-guest-bookings').classList.contains('active')), 'tapping it closes the chat and opens the stay');
    await page.close();
    // A past stay is not pinned; a signed-out visitor has no pin.
    ({ page } = await open({ guest, bookings: [{ id: 42, prop_key: 'jollyboat', check_in: d(-20), check_out: d(-17), adults: 2, children: 0 }], state: { messages: THREAD() } }));
    await openChat(page);
    await page.waitForTimeout(600);
    ok(await page.evaluate(() => document.getElementById('chat-pin').hidden), 'a finished stay is not pinned');
    await page.close();

    // §4 + §5 + §6
    console.log('§4 the away reply says it is automatic');
    ({ page, state } = await open({ state: { messages: [
        { id: 1, role: 'guest', body: 'Our train is late', at: AT(0, '23:38'), read: false, by: 0, kind: '' },
        { id: 2, role: 'admin', body: 'Thanks for your message — we’re not at the desk right now.', at: AT(0, '23:38'), by: 0, kind: 'auto' },
    ] } }));
    await page.evaluate(() => localStorage.setItem('chb-chat-token', 'a'.repeat(32)));
    await openChat(page);
    const a4 = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#chat-thread .chat-row')];
        const last = rows[rows.length - 1];
        return { name: (last.querySelector('.chat-nm') || {}).textContent, crown: !!last.querySelector('.chat-ava.is-crown'), auto: !!last.querySelector('.chat-msg.is-auto'), bg: getComputedStyle(last.querySelector('.chat-msg')).backgroundColor };
    });
    ok(a4.name === 'Automatic reply' && a4.crown && a4.auto, 'labelled "Automatic reply", under the crown');
    ok(/rgba\(0, 0, 0, 0\)|transparent/.test(a4.bg), `an outline, not a typed bubble (${a4.bg})`);

    console.log('§5 Sent turns to Seen where it stands');
    const before = await page.evaluate(() => {
        const st = document.querySelector('#chat-thread .chat-state');
        window.__rowRef = document.querySelector('#chat-thread .chat-row');
        return st ? st.textContent : '';
    });
    state.messages = state.messages.map((m) => (m.role === 'guest' ? Object.assign({}, m, { read: true }) : m));
    await page.evaluate(() => window.chatPoll());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
        const st = document.querySelector('#chat-thread .chat-state');
        return { text: st ? st.textContent : '', seen: st ? st.classList.contains('chat-seen') : false, same: window.__rowRef === document.querySelector('#chat-thread .chat-row'), entering: document.querySelectorAll('#chat-thread .chat-row.is-new').length };
    });
    ok(before === 'Sent' && after.text === 'Seen' && after.seen, `"Sent" becomes "Seen" (${before} → ${after.text})`);
    ok(after.same && after.entering === 0, 'in place: nothing is redrawn and nothing animates in');

    console.log('§6 who is typing');
    state.peer_typing = true;
    state.typing_by = 2;
    await page.evaluate(() => window.chatPoll());
    await page.waitForTimeout(300);
    const ty = await page.evaluate(() => {
        const r = document.querySelector('#chat-thread .chat-typingrow');
        return r ? { name: (r.querySelector('.chat-nm') || {}).textContent, face: !!r.querySelector('.chat-ava:not(.is-crown)'), dots: r.querySelectorAll('.chat-typing span').length, label: r.querySelector('.chat-typing').getAttribute('aria-label') } : null;
    });
    ok(ty && ty.name === 'George is typing' && ty.face && ty.dots === 3 && ty.label === 'George is typing', `"George is typing", with his face (${JSON.stringify(ty)})`);
    state.typing_by = 0;
    await page.evaluate(() => window.chatPoll());
    await page.waitForTimeout(300);
    const ty0 = await page.evaluate(() => {
        const r = document.querySelector('#chat-thread .chat-typingrow');
        return r ? { name: !!r.querySelector('.chat-nm'), crown: !!r.querySelector('.chat-ava.is-crown') } : null;
    });
    ok(ty0 && !ty0.name && ty0.crown, 'someone not shown types under the crown, unnamed');
    state.peer_typing = false;
    await page.evaluate(() => window.chatPoll());
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.querySelector('#chat-thread .chat-typingrow, #chat-thread .chat-typing')), 'and it goes when they stop');
    await page.close();

    // §7
    console.log('§7 away now');
    ({ page } = await open({ state: { away: { on: true, until: 7 } } }));
    await openChat(page);
    const aw = await page.evaluate(() => ({
        head: (document.querySelector('#chat-who .chat-who-s') || {}).textContent,
        moon: !!document.querySelector('#chat-who .chat-moon'),
        hello: (document.querySelector('#chat-thread .chat-hello-when') || {}).textContent,
        helloAway: !!document.querySelector('#chat-thread .chat-hello-when.is-away'),
        faces: document.querySelectorAll('#chat-thread .chat-hello-faces .chat-ava').length,
        who: (document.querySelector('#chat-thread .chat-hello-who') || {}).textContent,
        note: (document.querySelector('#chat-team .chat-team-note') || {}).textContent,
    }));
    ok(aw.head === 'Away until 7am' && aw.moon, `the header says until when (${aw.head})`);
    ok(aw.hello === 'Away until 7am' && aw.helloAway, `and so does the welcome (${aw.hello})`);
    ok(aw.faces === 2 && aw.who === 'Sophia & George', 'the welcome opens on their faces and names');
    ok(aw.note === 'Leave your email below and we can reply there too.', `a first-time visitor is asked for an email to reply to (${aw.note})`);

    // §8
    console.log('§8 an instant answer is the cottage guide');
    await page.fill('#chat-input', 'Is there parking at the cottage?');
    await page.evaluate(() => window.sendChat());
    await page.waitForSelector('#chat-thread .chat-guide');
    const g8 = await page.evaluate(() => {
        const g = document.querySelector('#chat-thread .chat-guide');
        return { label: (g.querySelector('.chat-guide-l') || {}).textContent, ask: (g.querySelector('button') || {}).textContent };
    });
    ok(g8.label === 'From the cottage guide', 'labelled as the guide, never as one of the people');
    ok(g8.ask === 'Ask Sophia or George', `with a way to ask them instead (${g8.ask})`);
    await page.close();

    // §9
    console.log('§9 with nobody shown, the chat it always was');
    ({ page } = await open({ state: { team: [], messages: [{ id: 1, role: 'admin', body: 'Hello', at: AT(0, '09:00'), by: 1, kind: '' }] } }));
    await page.evaluate(() => localStorage.setItem('chb-chat-team', JSON.stringify([{ id: 1, name: 'Stale', line: '', v: '' }])));
    await page.evaluate(() => localStorage.setItem('chb-chat-token', 'b'.repeat(32)));
    await openChat(page);
    const n9 = await page.evaluate(() => ({
        title: (document.querySelector('#chat-head-id .chat-widget-title') || {}).textContent,
        who: !!document.getElementById('chat-who'),
        fold: document.getElementById('chat-teamfold').hidden,
        name: (document.querySelector('#chat-thread .chat-nm') || {}).textContent,
        crown: !!document.querySelector('#chat-thread .chat-ava.is-crown'),
        stored: localStorage.getItem('chb-chat-team'),
    }));
    ok(n9.title === 'Chat with us' && !n9.who && n9.fold, 'the header is the one it always was, with nothing to open');
    ok(n9.name === 'Cottage Holidays Blakeney' && n9.crown, 'a reply is the business\'s, under the crown');
    ok(n9.stored === '[]', 'the server\'s answer replaces this device\'s copy');
    await page.close();

    // §10
    console.log('§10 words from the server are sanitised and escaped');
    ({ page } = await open({}));
    const c10 = await page.evaluate(() => {
        const clean = window.chatTeamClean([{ id: 3, name: 'Ann', line: 'x'.repeat(60), v: 'nothex' }, { id: 0, name: 'Nobody' }, { id: 4, name: '' }, null, 'junk', { id: 5, name: 'Bo', line: 7, v: 'abcdef0123' }]);
        return JSON.stringify(clean);
    });
    ok(c10 === JSON.stringify([{ id: 3, name: 'Ann', line: 'x'.repeat(40), v: '' }, { id: 5, name: 'Bo', line: '', v: 'abcdef0123' }]), `malformed entries are not there; lines are capped, a bad photo version is none (${c10})`);
    const x10 = await page.evaluate(() => {
        window.chatTeamSet([{ id: 1, name: '<img src=x onerror="window.__pwned=1">', line: '<b>Host</b>', v: '' }], null);
        window.chatHeadPaint();
        const head = document.getElementById('chat-head-id');
        return { imgs: head.querySelectorAll('img').length, bold: head.querySelectorAll('b').length, text: head.textContent.includes('<img src=x'), pwned: !!window.__pwned };
    });
    ok(x10.imgs === 0 && x10.text && !x10.pwned, 'a name is text, never markup');
    await page.close();

    console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL CHAT TEAM CHECKS PASSED');
    await done(fails);
})().catch(async (e) => {
    console.error('FAILED:', e);
    process.exit(1);
});
