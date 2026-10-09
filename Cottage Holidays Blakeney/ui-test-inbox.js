// The Inbox is ONE LIST OF PEOPLE (the approved "One Inbox" demo, built).
// End to end against mocked endpoints:
//  1. one row per person across enquiries, chat and email; who waits, in what order
//  2. a conversation: the whole chat and each email's words, reply on their channel
//  3. a reply waits five seconds with Undo on the message, then sends
//  4. the decision: Approve (held, then posted), dates taken → Offer, Decline → ask
//  5. Done, Remind me, Link: the owner's record is saved to inbox-state
//  6. search, the computer's panes and its keyboard
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
const fs = require('fs');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const SHOTS = process.env.IB_SHOTS || '';

(async () => {
    const { page, browser, base, done } = await boot({ viewport: { width: 390, height: 844 } });
    const d = (n) => { const t = new Date(); const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const at = (n, hm) => `${d(n)} ${hm}:00`;
    const bk = (o) => Object.assign({
        phone: '', address: '1 Lane', postcode: 'NR25 7AB', check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0,
        payment: 'unpaid', deposit_paid: 0, payment_method: '', payment_date: '', agreed_per_night: 130, agreed_booking_fee: 0,
        agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-30), hold_status: 'none', notes: '', created_at: at(-30, '14:02'),
    }, o);
    const bookings = [
        bk({ id: 11, prop_key: '21a', name: 'Sofia Laurent', email: 'sofia@example.fr', phone: '+33 6 12 34 56 78', check_in: d(-1), check_out: d(3), payment: 'paid', deposit_paid: 520, agreed_total: 520, agreed_nights: 4, agreed_nightly: 520 }),
        bk({ id: 12, prop_key: 'jollyboat', name: 'Daniel Okafor', email: 'daniel@example.com', phone: '07700 900815', check_in: d(9), check_out: d(13), deposit_paid: 210, payment: 'deposit', agreed_total: 702.15, agreed_nights: 4, agreed_nightly: 702.15, adults: 2, children: 2 }),
        bk({ id: 13, prop_key: 'jollyboat', name: 'Eleanor Brady', email: 'eleanor@example.com', check_in: d(-8), check_out: d(-3), payment: 'paid', deposit_paid: 600, agreed_total: 600, agreed_nights: 5, agreed_nightly: 600, hold_status: 'charged', hold_amount: 75 }),
        bk({ id: 14, prop_key: 'pimpernel', name: 'Marcus Hill', email: 'marcus@example.com', check_in: d(14), check_out: d(17), agreed_total: 450, agreed_nights: 3, agreed_nightly: 450 }),
    ];
    const enquiries = [
        { id: 21, prop_key: '21a', name: 'Tom Barrett', email: 'tom.barrett@example.com', phone: '07700 900412', check_in: d(34), check_out: d(37), adults: 2, children: 0, message: 'Hoping for a long weekend. Do you allow late checkout?', created_at: at(-4, '09:14') },
        { id: 22, prop_key: 'pimpernel', name: 'Hannah Whitlock', email: 'hannah@example.com', phone: '', check_in: d(15), check_out: d(18), adults: 4, children: 0, message: "It's my mum's 70th, so we'd love Pimpernel for the weekend.", created_at: at(-1, '13:20') },
    ];
    const threads = [{ thread_id: 1, name: 'Sofia Laurent', email: 'sofia@example.fr', source: '', location: '', is_guest: true, archived: 0, last_at: at(0, '08:12'), unread: 1, last_body: 'Morning! The hot water seems to have gone off.', last_role: 'guest' }];
    const threadMsgs = [
        { id: 1, role: 'guest', body: "We're in, and it's beautiful.", at: at(-1, '16:40'), seen: false, attachment: '' },
        { id: 2, role: 'admin', body: 'So glad you like it!', at: at(-1, '17:02'), seen: true, attachment: '' },
        { id: 3, role: 'guest', body: 'Morning! The hot water seems to have gone off.', at: at(0, '08:12'), seen: false, attachment: '' },
    ];
    const mails = [
        { uid: 'u1', from: 'daniel@example.com', fromRaw: 'Daniel Okafor <daniel@example.com>', subject: 'Early check-in?', date: at(-1, '21:15'), seen: false, preview: 'Hi George, any chance we could check in around 1pm?' },
        { uid: 'u2', from: 'd.okafor@arup.com', fromRaw: 'Daniel Okafor <d.okafor@arup.com>', subject: 'Balance', date: at(0, '09:40'), seen: false, preview: "Hi, I'll pay the rest of the balance from this account on Monday." },
        { uid: 'u3', from: 'lucy@example.com', fromRaw: 'Lucy Marsh <lucy@example.com>', subject: 'New Year', date: at(0, '07:55'), seen: false, preview: 'Hello! Do you have anything for 4 adults over New Year? We would stay three nights.' },
        { uid: 'u4', from: 'automated@airbnb.com', fromRaw: 'Airbnb <automated@airbnb.com>', subject: 'Reservation confirmed', date: at(-2, '10:00'), seen: true, preview: 'Reservation confirmed for Pimpernel.' },
        { uid: 'u5', from: 'pete@holtlinen.co.uk', fromRaw: 'Pete Holt <pete@holtlinen.co.uk>', subject: 'Invoice 4471', date: at(-3, '11:00'), seen: false, preview: 'Invoice attached for September linen.' },
    ];
    const sent = [{ id: 5, to_email: 'daniel@example.com', cc_email: null, subject: 'Your stay at Jollyboat', body: 'Looking forward to having you!', sent_at: at(-20, '10:00') }];
    const logs = { 12: [{ action: 'booking.confirm', summary: 'Confirmation emailed to Daniel', at: at(-30, '14:03'), subject: '', body: '' }] };
    const posts = [];
    let state = null;
    await page.route(/\.php/, (route) => {
        const req = route.request();
        const url = req.url();
        const file = url.split('/').pop().split('?')[0];
        const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (req.method() === 'POST') {
            const b = JSON.parse(req.postData() || '{}');
            b.__url = file;
            posts.push(b);
            if (file === 'mailbox.php') {
                if (b.action === 'list') return json({ ok: true, messages: mails, total: mails.length, hasMore: false });
                if (b.action === 'sent') return json({ ok: true, messages: sent });
                if (b.action === 'read') {
                    const m = mails.find((x) => x.uid === b.uid) || mails[0];
                    return json({ ok: true, uid: m.uid, from: m.from, fromRaw: m.fromRaw, date: m.date, subject: m.subject, body: m.preview + '\n\nOn Mon, someone wrote:\n> an earlier message', attachments: [] });
                }
                return json({ ok: true });
            }
            if (file === 'messages.php') {
                if (b.action === 'threads') return json({ ok: true, threads: b.archived ? [] : threads });
                if (b.action === 'thread') return json({ ok: true, thread: { id: 1 }, bookings: [], messages: threadMsgs });
                return json({ ok: true });
            }
            if (file === 'enquiries.php') {
                if (b.action === 'declined') return json({ ok: true, enquiries: [] });
                if (b.action === 'approve') return json({ ok: true, booking_id: 99, email: { guest: { ok: true } } });
                return json({ ok: true });
            }
            if (file === 'bookings.php' && b.action === 'email_logs') return json({ logs });
            if (file === 'content.php' && b.action === 'set' && b.key === 'inbox-state') { state = b.value; return json({ ok: true }); }
            return json({ ok: true, events: [], logs: {}, reviews: [], photos: [] });
        }
        if (file === 'bookings.php') return json({ bookings });
        if (file === 'enquiries.php') return json({ enquiries });
        return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
    });

    await page.goto(`${base}/index.html`);
    await page.waitForTimeout(1000);
    await page.evaluate(() => { isAuthenticated = true; document.body.classList.add('owner-mode'); });
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(500);
    await page.evaluate(async () => { await window.openInbox(); });
    // Wait on the DATA, not a clock: the four stores land independently, and on a
    // loaded runner the mailbox can answer seconds after the bookings.
    await page.waitForFunction(() => document.querySelectorAll('#ib-rows .ib-rowwrap').length >= 10
        && (document.querySelector('#ib-rows .ib-rowwrap') || {}).getAttribute
        && document.querySelector('#ib-rows .ib-rowwrap').getAttribute('data-key') === 'e:sofia@example.fr', null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(300);
    const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
    const keys = () => page.$$eval('#ib-rows .ib-rowwrap', (r) => r.map((x) => x.getAttribute('data-key')));
    const capOf = (k) => page.$eval(`#ib-rows .ib-rowwrap[data-key="${k}"]`, (e) => e.closest('.ib-rows').getAttribute('aria-label')).catch(() => '');

    console.log('1. one row per person');
    await shot('ph-list');
    const ks = await keys();
    ok(ks.length >= 7, `rows: ${ks.join(', ')}`);
    ok(ks.filter((k) => k.indexOf('daniel@example.com') >= 0).length === 1, 'Daniel’s booking, email and sent mail are ONE row');
    ok(ks.includes('e:d.okafor@arup.com'), 'his second address is its own row until linked');
    ok(ks[0] === 'e:sofia@example.fr', `the guest staying now leads Waiting (${ks[0]})`);
    ok(/Waiting/.test(await capOf('e:tom.barrett@example.com')), 'a pending enquiry waits');
    ok(/Earlier|Recent/.test(await capOf('e:automated@airbnb.com')), 'automatic mail never waits');
    const quiet = await page.$eval('#ib-rows .ib-rowwrap[data-key="e:automated@airbnb.com"] .ib-row', (e) => e.classList.contains('is-quiet')).catch(() => false);
    ok(quiet, 'and its row is quiet');
    const pill = await page.$eval('#ib-pill', (e) => e.textContent.trim());
    ok(/\d+ waiting/.test(pill), `status pill beside the title (${pill})`);
    const tags = await page.$$eval('#ib-rows .ib-cap', (c) => c.map((x) => x.textContent.trim()));
    ok(tags.includes('Reply now') && tags.includes('Decide'), `tags: ${[...new Set(tags)].join(', ')}`);
    const noFolders = await page.evaluate(() => !document.getElementById('inbox-folders') && !document.getElementById('inbox-landing') && document.getElementById('inbox-legacy').hidden);
    ok(noFolders, 'no folders: the old lists are hidden, the landing gone');

    console.log('2. a conversation on a phone');
    await page.click('#ib-rows .ib-rowwrap[data-key="e:sofia@example.fr"] .ib-row');
    await page.waitForTimeout(700);
    await shot('ph-sofia');
    const conv = await page.evaluate(() => {
        const c = document.getElementById('ib-conv').getBoundingClientRect();
        return { left: Math.round(c.left), top: Math.round(c.top), bottom: Math.round(c.bottom), h: innerHeight,
            bubbles: document.querySelectorAll('#ib-thread .ib-msg').length, seen: !!document.querySelector('#ib-thread .ib-seen'),
            chan: (document.querySelector('.ib-chan [aria-pressed="true"]') || {}).textContent };
    });
    ok(conv.left === 0 && conv.bottom === conv.h, `the conversation fills the phone below the header (top ${conv.top})`);
    ok(conv.bubbles === 3, `the whole chat is loaded (${conv.bubbles} messages)`);
    ok(conv.seen, 'their reading of your reply shows as Seen');
    ok(/Chat/.test(conv.chan || ''), `reply starts on their channel (${conv.chan})`);

    console.log('3. a reply waits five seconds with Undo');
    await page.fill('#ib-reply', 'Hold the reset button for five seconds.');
    await page.click('#ib-send');
    await page.waitForTimeout(300);
    ok(!!(await page.$('#ib-thread .ib-msg.is-pending .ib-undo')), 'the message carries its own Undo');
    ok(!posts.some((p) => p.__url === 'messages.php' && p.action === 'send'), 'nothing has been sent yet');
    await page.click('#ib-thread .ib-undo');
    await page.waitForTimeout(300);
    ok((await page.$eval('#ib-reply', (e) => e.value)) === 'Hold the reset button for five seconds.', 'Undo puts the words back');
    await page.click('#ib-send');
    await page.waitForTimeout(5600);
    const sendPost = posts.find((p) => p.__url === 'messages.php' && p.action === 'send');
    ok(sendPost && sendPost.thread_id === 1 && /reset button/.test(sendPost.body), 'after five seconds it sends, in the chat');
    await page.click('#ib-conv .ib-back');
    await page.waitForTimeout(600);

    console.log('4. the decision');
    await page.click('#ib-rows .ib-rowwrap[data-key="e:tom.barrett@example.com"] .ib-row');
    await page.waitForTimeout(700);
    await shot('ph-tom');
    const dec = await page.evaluate(() => ({ free: !!document.querySelector('.ib-decide.is-free'), approve: (document.querySelector('[data-ib="approve"]') || {}).textContent || '' }));
    ok(dec.free && /Approve/.test(dec.approve), `dates free: Approve (${dec.approve.replace(/\s+/g, ' ').trim()})`);
    await page.click('[data-ib="approve"]');
    await page.waitForTimeout(300);
    ok(!!(await page.$('#ib-thread .ib-msg.is-pending .ib-undo')), 'approving holds the confirmation with Undo');
    ok(!posts.some((p) => p.action === 'approve'), 'and posts nothing yet');
    await page.waitForTimeout(5600);
    const ap = posts.find((p) => p.__url === 'enquiries.php' && p.action === 'approve');
    ok(ap && ap.id === 21, 'then approves the enquiry');
    await page.click('#ib-conv .ib-back');
    await page.waitForTimeout(600);
    await page.click('#ib-rows .ib-rowwrap[data-key="e:hannah@example.com"] .ib-row');
    await page.waitForTimeout(700);
    const tk = await page.evaluate(() => ({ taken: !!document.querySelector('.ib-decide.is-taken'), offer: (document.querySelector('[data-ib="offer"]') || {}).textContent || '', approve: !!document.querySelector('[data-ib="approve"]') }));
    ok(tk.taken && /Offer/.test(tk.offer) && !tk.approve, `dates taken: Offer, never Approve (${tk.offer.trim()})`);
    await page.click('[data-ib="decline"]');
    await page.waitForTimeout(700);
    ok(posts.some((p) => p.action === 'decline' && p.id === 22), 'decline posts');
    ok(!!(await page.$('.ib-decide.is-after')), 'and asks whether to write to them');
    await page.click('#ib-conv .ib-back');
    await page.waitForTimeout(600);

    console.log('5. done, remind, link');
    await page.click('#ib-rows .ib-rowwrap[data-key="e:pete@holtlinen.co.uk"] .ib-row');
    await page.waitForTimeout(600);
    await page.click('#ib-conv [data-ib="done"]');
    await page.waitForTimeout(700);
    ok(!(await keys()).includes('e:pete@holtlinen.co.uk'), 'Done takes the row out of the list');
    ok(state && state.done && state.done['e:pete@holtlinen.co.uk'] > 0, 'and saves it in inbox-state');
    await page.click('#ib-toast-undo');
    await page.waitForTimeout(500);
    ok((await keys()).includes('e:pete@holtlinen.co.uk'), 'Undo brings it back');
    await page.click('#ib-rows .ib-rowwrap[data-key="e:daniel@example.com"] .ib-row');
    await page.waitForTimeout(700);
    await page.click('#ib-conv [data-ib="menu"]');
    await page.waitForTimeout(200);
    await shot('ph-menu');
    await page.click('#ib-conv [data-ib="remind"][data-arg="tomorrow"]');
    await page.waitForTimeout(700);
    ok(/Reminders/.test(await capOf('e:daniel@example.com')), 'Remind me moves him under Reminders');
    ok(state && state.remind && state.remind['e:daniel@example.com'] > Date.now(), 'and saves the time');
    await page.click('#ib-rows .ib-rowwrap[data-key="e:d.okafor@arup.com"] .ib-row');
    await page.waitForTimeout(700);
    await page.click('#ib-conv .ib-stayline');
    await page.waitForTimeout(400);
    await shot('ph-link');
    await page.click('#ib-ctxdrop [data-ib="link"]');
    await page.waitForTimeout(700);
    ok(!(await keys()).includes('e:d.okafor@arup.com'), 'linking joins the second address to his row');
    ok(state && state.links && state.links['d.okafor@arup.com'] === 'e:daniel@example.com', 'and saves the link');
    await page.click('#ib-conv .ib-back');
    await page.waitForTimeout(600);

    console.log('6. search');
    await page.fill('#ib-q', 'hot water');
    await page.waitForTimeout(300);
    const hits = await keys();
    ok(hits.length === 1 && hits[0] === 'e:sofia@example.fr', `search finds the message (${hits.join(',')})`);
    ok(!!(await page.$('#ib-rows mark')), 'and highlights why');
    await page.fill('#ib-q', '');
    await page.dispatchEvent('#ib-q', 'input');

    console.log('7. a computer');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(800);
    await page.evaluate(() => ibSoon());
    await page.waitForTimeout(500);
    await shot('dk');
    const dk = await page.evaluate(() => {
        const r = document.getElementById('ib');
        const b = (id) => { const x = document.getElementById(id).getBoundingClientRect(); return { l: Math.round(x.left), w: Math.round(x.width), h: Math.round(x.height) }; };
        return { wide: r.classList.contains('is-wide'), triple: r.classList.contains('is-triple'), list: b('ib-list'), conv: b('ib-conv'), side: b('ib-side'), over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    ok(dk.wide && dk.list.w > 300 && dk.conv.w > 300, `list and conversation side by side (${dk.list.w} | ${dk.conv.w}${dk.triple ? ' | ' + dk.side.w : ''})`);
    ok(dk.over <= 0, 'nothing scrolls sideways');
    const before = await page.evaluate(() => __ibOpen);
    await page.focus('#ib-rows .ib-row');
    await page.keyboard.press('j');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => __ibOpen);
    ok(after && after !== before, `J moves to the next person (${before} → ${after})`);

    if (SHOTS) {
        await page.evaluate(() => { document.body.classList.toggle('light-mode'); });
        await page.waitForTimeout(300);
        await shot('dk-other-theme');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(600);
        await page.evaluate(() => ibSoon());
        await page.waitForTimeout(400);
        await shot('ph-other-theme-list');
        await page.click('#ib-rows .ib-rowwrap[data-key="e:hannah@example.com"] .ib-row').catch(() => {});
        await page.waitForTimeout(700);
        await shot('ph-other-theme-conv');
    }
    console.log(fails ? `\n${fails} FAILED` : '\nall passed');
    await done(fails);
})();
