// The Inbox is ONE LIST OF PEOPLE (the approved "One Inbox" demo, built).
// End to end against mocked endpoints:
//  1. one row per person across enquiries, chat and email; who waits, in what order
//  2. a conversation: the whole chat and each email's words, reply on their channel
//  3. a reply waits five seconds with Undo on the message, then sends
//  4. the decision: Approve (held, then posted), dates taken → Offer, Decline → ask
//  5. Done, Remind me, Link: the owner's record is saved to inbox-state
//  6. search
//  7. Delete from the ⋯ menu: asks first, names what goes and what stays
//  8. the Done folder: the switch and its motion, month captions, moving back, search
//  9. the computer's panes and its keyboard
// 10. an email typed into the website chat is not proof: its own row until confirmed
// 11. an Inbox not on screen builds its count, not its rows
// 12. a chat photo opens from the conversation, through its signed link
// 13. a guest's reply by email shows once: in their chat, saying Email, never also as the email
// 14. New email: to anyone, from the Inbox (who it is to, the name it greets, the send)
const { boot } = require('./ui-test-lib'); // pins TZ=Europe/London at require time
const fs = require('fs');
let fails = 0;
const ok = (b, m) => { console.log(`  ${b ? '✓' : '✗'} ${m}`); if (!b) fails++; };
const SHOTS = process.env.IB_SHOTS || '';

(async () => {
    const { page, browser, base, done } = await boot({ viewport: { width: 390, height: 844 } });
    const d = require('./ui-test-lib').d; // the harness's day (today, UK)
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
    // The emails the list left out because they are in a chat (mailbox.php's `merged`).
    const merged = [];
    const { now } = require('./ui-test-lib');
    const stamp = (ms) => { const x = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`; };
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
                if (b.action === 'list') return json({ ok: true, messages: mails, total: mails.length, hasMore: false, merged });
                if (b.action === 'sent') return json({ ok: true, messages: sent });
                // New email: the server's own preview and send, as far as the Inbox can see them.
                if (b.action === 'preview') return json({ ok: true, subject: b.subject || '(no subject)', html: `<!doctype html><html><body><h1>${b.subject}</h1>${b.name ? `<p>Hello ${String(b.name).split(' ')[0]},</p>` : ''}<p>${b.body}</p></body></html>` });
                if (b.action === 'send' && b.compose === 'new') {
                    sent.unshift({ id: 90 + sent.length, to_email: b.to, to_name: b.name || null, cc_email: null, subject: b.subject, body: b.body, sent_at: stamp(now() - 60000) });
                    return json({ ok: true });
                }
                if (b.action === 'delete' && Array.isArray(b.uids)) {
                    for (let i = mails.length - 1; i >= 0; i--) if (b.uids.includes(mails[i].uid)) mails.splice(i, 1);
                    return json({ ok: true, deleted: b.uids.length });
                }
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
    // The hidden list keeps its store (the rows above came from it) but draws
    // nothing: every thread ever, into a container nobody sees, cost up to 2s.
    const legacy = await page.evaluate(() => ({ rows: document.querySelectorAll('#inbox-legacy .msg-thread-row').length, store: (typeof __msgThreads !== 'undefined' ? __msgThreads : []).length }));
    ok(legacy.rows === 0 && legacy.store > 0, `the hidden thread list draws no rows (${legacy.rows}) while its store holds ${legacy.store}`);

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
    await page.waitForTimeout(1300);
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
    await page.waitForTimeout(1300);
    ok(/Reminders/.test(await capOf('e:daniel@example.com')), 'Remind me moves the row under Reminders');
    ok(state && state.remind && state.remind['e:daniel@example.com'] > Date.now(), 'and saves the time');
    await page.click('#ib-rows .ib-rowwrap[data-key="e:d.okafor@arup.com"] .ib-row');
    await page.waitForTimeout(700);
    await page.click('#ib-conv .ib-stayline');
    await page.waitForTimeout(400);
    await shot('ph-link');
    await page.click('#ib-ctxdrop [data-ib="link"]');
    await page.waitForTimeout(700);
    ok(!(await keys()).includes('e:d.okafor@arup.com'), 'linking joins the second address to their row');
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

    console.log('7. delete');
    const menuOf = async (k) => {
        await page.click(`#ib-rows .ib-rowwrap[data-key="${k}"] .ib-row`);
        await page.waitForTimeout(700);
        await page.click('#ib-conv [data-ib="menu"]');
        await page.waitForTimeout(200);
        return page.$eval('#ib-conv .ib-menu', (m) => [...m.querySelectorAll('button')].map((x) => x.textContent.trim())).catch(() => []);
    };
    const dlg = () => page.evaluate(() => ({
        open: document.getElementById('glass-dialog').classList.contains('open'),
        title: (document.getElementById('glass-dialog-title') || {}).textContent || '',
        msg: document.getElementById('glass-dialog-msg').innerText,
        ok: document.getElementById('glass-dialog-ok').textContent.trim(),
        danger: document.getElementById('glass-dialog-ok').classList.contains('is-danger'),
    }));
    const delPosts = () => posts.filter((p) => p.action === 'delete' || p.action === 'delete_sent');
    const marcus = await menuOf('e:marcus@example.com');
    ok(marcus.length && !marcus.some((t) => /Delete/.test(t)), `a booking with no messages offers no Delete (${marcus.join(' / ')})`);
    await page.click('#ib-conv [data-ib="menu"]');
    await page.click('#ib-conv .ib-back');
    await page.waitForTimeout(600);
    const lucy = await menuOf('e:lucy@example.com');
    ok(lucy[lucy.length - 1] === 'Delete conversation', `Delete is the menu's last item (${lucy.join(' / ')})`);
    ok(await page.$eval('#ib-conv .ib-menu', (m) => { const b = m.querySelector('[data-ib="delete"]'); return b.classList.contains('is-danger') && getComputedStyle(b).color !== getComputedStyle(m.querySelector('[data-ib="unread"]')).color; }), 'in the danger ink');
    await page.click('#ib-conv .ib-menu [data-ib="delete"]');
    await page.waitForTimeout(400);
    let g = await dlg();
    ok(g.open && /Lucy Marsh/.test(g.title), `it asks first (${g.title})`);
    ok(/The email from them is deleted for good, from the mailbox too\./.test(g.msg) && /Nothing is sent to Lucy/.test(g.msg), `and says what goes (${g.msg.replace(/\s+/g, ' ')})`);
    ok(!/booking/.test(g.msg), 'no booking to keep, so it says nothing about one');
    ok(g.ok === 'Delete' && g.danger, 'the button says Delete, in red, not the accent');
    await page.click('#glass-dialog-cancel');
    await page.waitForTimeout(400);
    ok(!delPosts().length && (await keys()).includes('e:lucy@example.com'), 'Cancel deletes nothing');
    await page.click('#ib-conv [data-ib="menu"]');
    await page.waitForTimeout(200);
    await page.click('#ib-conv .ib-menu [data-ib="delete"]');
    await page.waitForTimeout(400);
    await page.click('#glass-dialog-ok');
    await page.waitForTimeout(1400);
    const lp = delPosts();
    ok(lp.length === 1 && lp[0].__url === 'mailbox.php' && JSON.stringify(lp[0].uids) === '["u3"]', `Delete takes the email from the mailbox, in one call (${JSON.stringify(lp)})`);
    ok(!(await keys()).includes('e:lucy@example.com'), 'and the row leaves the Inbox');
    const lt = await page.$eval('#ib-toast-msg', (e) => e.textContent);
    ok(/Deleted your conversation with Lucy/.test(lt), `it says so (${lt})`);
    ok(await page.$eval('#ib-toast-undo', (e) => e.hidden), 'with no Undo: the mailbox cannot give it back');
    const dan = await menuOf('e:daniel@example.com');
    ok(dan.includes('Delete conversation'), 'a guest with a booking can delete the conversation too');
    await page.click('#ib-conv .ib-menu [data-ib="delete"]');
    await page.waitForTimeout(400);
    g = await dlg();
    ok(/2 emails from them and the email you sent are deleted for good/.test(g.msg), `both their addresses and what you sent (${g.msg.replace(/\s+/g, ' ')})`);
    ok(/Their booking at Jollyboat stays, with the emails sent about it\./.test(g.msg), 'and it says the booking stays');
    const n0 = delPosts().length;
    await page.click('#glass-dialog-ok');
    await page.waitForTimeout(1400);
    const dp = delPosts().slice(n0);
    const mb = dp.find((p) => p.__url === 'mailbox.php' && p.action === 'delete');
    ok(mb && mb.uids.slice().sort().join(',') === 'u1,u2', `the emails from both addresses go (${mb && mb.uids})`);
    ok(dp.some((p) => p.action === 'delete_sent' && p.to === 'daniel@example.com'), 'and what was sent to them');
    ok(!dp.some((p) => p.__url === 'bookings.php'), 'the booking is never touched');
    ok(state && state.done && state.done['e:daniel@example.com'] > 0 && !(state.remind || {})['e:daniel@example.com'], 'the conversation moves to Done, the reminder cleared');
    ok(/booking stays on Today/.test(await page.$eval('#ib-toast-msg', (e) => e.textContent)), 'and the toast says where the booking is');

    console.log('8. the Done folder');
    const capsDone = () => page.$$eval('#ib-rows .ib-cap', (xs) => xs.filter((x) => x.textContent.trim() === 'Done').length);
    const folderOn = () => page.$eval('#ib-folders', (f) => f.getAttribute('data-on'));
    const pillX = () => page.$eval('#ib-folders .ib-folders-pill', (e) => Math.round(e.getBoundingClientRect().left - e.parentElement.getBoundingClientRect().left));
    await page.waitForTimeout(400);
    ok(!(await page.$('[data-ib="toggle-done"]')), 'no "Show N done" at the foot of the list');
    ok((await capsDone()) === 0 && !(await keys()).includes('e:daniel@example.com'), 'the Inbox holds no done rows and no Done capsules');
    ok((await folderOn()) === 'inbox' && (await page.$eval('#ib-f-inbox', (b) => b.getAttribute('aria-pressed'))) === 'true', 'the switch starts on Inbox');
    const x0 = await pillX();
    // SEEK, NEVER RACE. This sampled every animation frame for 750ms, and under a
    // loaded runner the page painted three frames of the 0.46s glide — a working
    // pill read as a teleport (measured: "3 positions", and the 130ms step-away fell
    // between frames entirely). Each animation is paused and SEEKED instead, so the
    // checks read the motion itself rather than how many frames the machine managed.
    const cross = await page.evaluate(async () => {
        const pill = document.querySelector('#ib-folders .ib-folders-pill'), host = document.getElementById('ib-rows');
        const base = pill.parentElement.getBoundingClientRect().left;
        const px = () => Math.round(pill.getBoundingClientRect().left - base);
        const look = () => ({ o: +getComputedStyle(host).opacity, tx: getComputedStyle(host).transform, done: !!host.querySelector('.ib-rowwrap[data-key="e:daniel@example.com"]') });
        const out = { xs: [], away: null, arrive: null, end: null };
        document.getElementById('ib-f-done').click();
        // the pill: its CSS transition on `translate`, seeked across its own duration
        const tr = pill.getAnimations().find((x) => x.transitionProperty === 'translate');
        if (tr) {
            tr.pause();
            const dur = Number(tr.effect.getComputedTiming().duration) || 0;
            for (let i = 0; i <= 10; i++) { tr.currentTime = (dur * i) / 10; out.xs.push(px()); }
            tr.finish();
        }
        // the Inbox stepping away: the list's own outgoing animation, at its midpoint
        const outA = host.getAnimations()[0];
        if (outA) {
            outA.pause();
            outA.currentTime = (Number(outA.effect.getComputedTiming().duration) || 0) / 2;
            out.away = look();
            outA.finish(); // its `finished` is what lands the Done folder
        }
        // Done arriving: wait for the landing to start its own animation, then seek it
        for (let i = 0; i < 80 && !(host.getAnimations().length && look().done); i++) await new Promise((r) => setTimeout(r, 25));
        const inA = host.getAnimations()[0];
        if (inA) {
            inA.pause();
            inA.currentTime = (Number(inA.effect.getComputedTiming().duration) || 0) / 3;
            out.arrive = look();
            inA.finish();
        }
        for (let i = 0; i < 80 && host.getAnimations().length; i++) await new Promise((r) => setTimeout(r, 25));
        out.end = Object.assign(look(), { x: px() });
        return out;
    });
    const xs = cross.xs.length ? cross.xs : [x0];
    ok(cross.end.x > x0 + 100 && new Set(xs).size > 5, `the pill travels to Done (${x0} → ${cross.end.x}, ${new Set(xs).size} positions)`);
    ok(Math.max(...xs) <= cross.end.x + 2, 'and settles without swinging wide');
    ok(!!cross.away && !cross.away.done && cross.away.o < 0.9 && /matrix\(1, 0, 0, 1, -/.test(cross.away.tx), `the Inbox steps away to the left as it fades (${cross.away && cross.away.tx})`);
    ok(!!cross.arrive && cross.arrive.done && cross.arrive.o < 0.9 && /matrix\(1, 0, 0, 1, [1-9]/.test(cross.arrive.tx), `Done arrives from the right (${cross.arrive && cross.arrive.tx})`);
    ok(cross.end.o === 1, 'and settles fully visible');
    ok((await folderOn()) === 'done' && (await keys()).includes('e:daniel@example.com'), 'Done shows the done conversations');
    await shot('ph-done');
    ok((await capsDone()) === 0, 'with no Done capsule on any row');
    const doneCaps = await page.$$eval('#ib-rows .ib-capline span', (xs) => xs.map((x) => x.textContent));
    ok(doneCaps.length && doneCaps.every((c) => /^(January|February|March|April|May|June|July|August|September|October|November|December)( \d{4})?$/.test(c)), `grouped under month captions (${doneCaps.join(', ')})`);
    ok(/Anyone in Done who writes again/.test(await page.$eval('#ib-rows .ib-foot', (f) => f.textContent)), 'and says who comes back');
    ok(/"t":"inbox:done"/.test(await page.evaluate(() => sessionStorage.getItem('chb-nav') || '')), 'the folder is remembered for a reload');
    await page.click('#ib-rows .ib-rowwrap[data-key="e:daniel@example.com"] .ib-row');
    await page.waitForTimeout(700);
    ok((await page.$eval('#ib-conv .ib-back', (b) => b.textContent.trim())) === 'Done', 'the back link names the folder');
    ok(await page.$eval('#ib-conv [data-ib="undone"]', (b) => b.classList.contains('is-on')), 'the tick shows it is done');
    await page.click('#ib-conv [data-ib="undone"]');
    // Seeked, like the crossing above: a frame sampler under load caught too few
    // frames of the 300ms fold to tell a fold from a jump.
    const fold = await page.evaluate(async () => {
        const sel = '#ib-rows .ib-rowwrap[data-key="e:daniel@example.com"]';
        let a = null;
        for (let i = 0; i < 120 && !a; i++) {
            const w = document.querySelector(sel);
            a = w ? w.getAnimations().find((x) => x.effect && x.effect.getKeyframes().some((k) => 'height' in k)) : null;
            if (!a) await new Promise((r) => setTimeout(r, 20));
        }
        const hs = [];
        if (a) {
            const w = document.querySelector(sel);
            a.pause();
            const end = Number(a.effect.getComputedTiming().endTime) || 0;
            for (let i = 0; i <= 10; i++) { a.currentTime = (end * i) / 10; hs.push(Math.round(w.getBoundingClientRect().height)); }
            a.finish();
        }
        let landed = false, gone = false;
        for (let i = 0; i < 120 && !(gone && landed); i++) {
            landed = landed || document.getElementById('ib-f-inbox').classList.contains('is-landed');
            gone = !document.querySelector(sel);
            if (!(gone && landed)) await new Promise((r) => setTimeout(r, 25));
        }
        return { hs: hs.filter((h) => h > 0), gone, landed };
    });
    ok(fold.hs.length && new Set(fold.hs).size > 4 && fold.gone, `moving back folds the row away (${new Set(fold.hs).size} heights, then gone)`);
    ok(fold.landed, 'and the Inbox side of the switch settles as it lands');
    ok(!(state.done || {})['e:daniel@example.com'], 'saved: no longer done');
    ok(/back in your Inbox/.test(await page.$eval('#ib-toast-msg', (e) => e.textContent)), 'the toast says where it went');
    await page.click('#ib-toast-undo');
    await page.waitForTimeout(500);
    ok((await keys()).includes('e:daniel@example.com') && (state.done || {})['e:daniel@example.com'] > 0, 'Undo puts it back in Done');
    const row = await (await page.$('#ib-rows .ib-rowwrap[data-key="e:daniel@example.com"] .ib-row')).boundingBox();
    ok(/Inbox/.test(await page.$eval('#ib-rows .ib-rowwrap[data-key="e:daniel@example.com"] .ib-reveal', (e) => e.textContent)), 'a swipe in Done reveals Inbox');
    await page.mouse.move(row.x + row.width - 30, row.y + row.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(row.x + row.width - 30 - i * 18, row.y + row.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(1200);
    ok(!(await keys()).includes('e:daniel@example.com') && !(state.done || {})['e:daniel@example.com'], 'and swiping left moves it back');
    await page.click('#ib-toast-undo');
    await page.waitForTimeout(500);
    await page.click('#ib-f-inbox');
    await page.waitForTimeout(800);
    ok((await folderOn()) === 'inbox' && (await keys()).includes('e:pete@holtlinen.co.uk'), 'back on the Inbox');
    // Pete to Done from the list, then search reaches both folders
    await page.click('#ib-rows .ib-rowwrap[data-key="e:pete@holtlinen.co.uk"] .ib-row');
    await page.waitForTimeout(600);
    await page.click('#ib-conv [data-ib="done"]');
    await page.waitForTimeout(1300);
    ok(/Pete moved to Done/.test(await page.$eval('#ib-toast-msg', (e) => e.textContent)), 'Done says where it went');
    await page.fill('#ib-q', 'invoice');
    await page.waitForTimeout(400);
    ok(await page.$eval('#ib-folders-wrap', (w) => w.classList.contains('is-away')), 'the switch steps aside while searching');
    const hitCap = await page.$eval('#ib-rows .ib-rowwrap[data-key="e:pete@holtlinen.co.uk"]', (w) => (w.querySelector('.ib-cap') || {}).textContent || '').catch(() => '');
    ok(hitCap === 'Done', `a result in Done says so (${hitCap})`);
    await page.fill('#ib-q', '');
    await page.dispatchEvent('#ib-q', 'input');
    await page.waitForTimeout(400);
    ok(!(await page.$eval('#ib-folders-wrap', (w) => w.classList.contains('is-away'))), 'and returns when the search is cleared');
    // nothing waiting: one card, not an empty page.
    // Each person is marked done AFTER their own last message, never at a bare
    // Date.now(): the fixture writes "today 08:12" and "today 09:40", which before
    // that hour are LATER than now, and ibDone rightly keeps anyone who wrote after
    // they were marked done — so a now-stamp failed this check every night before
    // 09:40 (measured at 01:26) while proving nothing about the calm card.
    const saved = await page.evaluate(() => { const was = JSON.stringify(ibState().done); __ibPeople.forEach((p) => { ibState().done[p.key] = Math.max(Date.now(), p.lastAt || 0, p.enq ? ibT(p.enq.receivedAt) : 0) + 1000; }); ibBuild(); ibRenderAll(); return was; });
    ok(/Nothing waiting on you/.test(await page.$eval('#ib-rows .ib-empty.is-card', (e) => e.textContent).catch(() => '')), 'with everyone done the Inbox shows one calm card');
    await page.evaluate((was) => { ibState().done = JSON.parse(was); ibBuild(); ibRenderAll(); }, saved);
    // a remembered place opens the folder
    await page.evaluate(() => chbOpenTarget('inbox:done'));
    await page.waitForTimeout(600);
    ok((await folderOn()) === 'done', 'inbox:done reopens the Done folder');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('#ib-f-inbox');
    ok((await keys()).includes('e:hannah@example.com'), 'with reduced motion the folder changes at once');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    console.log('9. a computer');
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
    await page.click('#ib-f-done');
    await page.waitForTimeout(800);
    const d0 = await page.evaluate(() => __ibOpen);
    ok(d0 && (state.done || {})[d0] > 0, `on a computer Done opens its newest conversation (${d0})`);
    await shot('dk-done');
    await page.focus('#ib-rows .ib-row');
    await page.keyboard.press('e');
    await page.waitForTimeout(100);
    const d1 = await page.evaluate(() => __ibOpen);
    ok(!(state.done || {})[d0] && d1 !== d0, `E moves it back and the next opens at once (${d0} → ${d1})`);
    await page.waitForTimeout(700);
    ok(!(await keys()).includes(d0), 'the moved row has folded out of Done');
    await page.click('#ib-f-inbox');
    await page.waitForTimeout(800);

    console.log('10. an email typed into the website chat is not proof');
    // Anyone can type a booked guest's email into the website chat (verified: false —
    // no proven account behind it). Joined by that address, the chat became the guest's
    // conversation, their stay beside it, so the owner's reply (a door code) went to
    // whoever typed it.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    if (await page.$eval('#ib-conv .ib-back', (e) => !!e.getClientRects().length).catch(() => false)) {
        await page.click('#ib-conv .ib-back');
        await page.waitForTimeout(600);
    }
    const reload = async (key) => {
        await page.evaluate(async () => { await loadAdminMessages(); ibSoon(); });
        if (key) await page.waitForFunction((k) => !!document.querySelector(`#ib-rows .ib-rowwrap[data-key="${k}"]`), key, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(300);
    };
    threads.push({ thread_id: 7, name: 'Marcus Hill', email: 'marcus@example.com', source: '', location: '', is_guest: false, verified: false, archived: 0, last_at: at(0, '09:05'), unread: 1, last_body: 'What is the key safe code again?', last_role: 'guest' });
    await reload('t:7');
    const imp = await page.evaluate(() => {
        const g = __ibPeopleMap.get('e:marcus@example.com');
        const t = __ibPeopleMap.get('t:7');
        const row = document.querySelector('#ib-rows .ib-rowwrap[data-key="t:7"]');
        return { gThreads: g ? g.threads.length : -1, gBookings: g ? g.bookings.length : -1, kind: t && t.kind, claimed: !!(t && t.claimed), row: row ? row.textContent.replace(/\s+/g, ' ') : '' };
    });
    ok(imp.row !== '', 'the chat is a row of its own');
    ok(imp.gThreads === 0 && imp.gBookings === 1, `…not inside the booked guest's conversation (${imp.gThreads} chats on Marcus's row)`);
    ok(imp.kind === 'unlinked' && imp.claimed, `…an unlinked row claiming Marcus (${imp.kind})`);
    ok(/email not confirmed/.test(imp.row), `…whose line says the email is not confirmed (${imp.row.slice(0, 90)})`);
    await page.click('#ib-rows .ib-rowwrap[data-key="t:7"] .ib-row', { timeout: 5000 }).catch(() => {}); // a missing row fails the checks below by name
    await page.waitForTimeout(700);
    await page.click('#ib-conv .ib-stayline', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await shot('ph-unconfirmed');
    const card = await page.evaluate(() => {
        const c = document.querySelector('#ib-ctxdrop .ib-linkcard');
        const x = document.querySelector('#ib-ctxdrop .ib-ctx');
        return { card: c ? c.textContent.replace(/\s+/g, ' ') : '', ctx: x ? x.textContent.replace(/\s+/g, ' ') : '' };
    });
    ok(/anyone can type an email there/.test(card.card) && /Yes, this is Marcus/.test(card.card), `the owner is asked to check it is them first (${card.card.slice(0, 90)})`);
    ok(/Website visitor · email not confirmed/.test(card.ctx) && !/Pimpernel/.test(card.ctx), 'and the booked guest\'s stay is not shown beside the chat');
    await page.click('#ib-ctxdrop [data-ib="link"]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
    const links = (state && state.links) || {};
    ok(links['t:7'] === 'e:marcus@example.com', `confirming links THIS chat (${JSON.stringify(links)})`);
    ok(!links['marcus@example.com'], '…never the address, which the next stranger would share');
    const kept = await page.evaluate((st) => (ibStateClean(st).links || {})['t:7'] || '', state || {});
    ok(kept === 'e:marcus@example.com', `…and the link survives the next load, when the stored record is cleaned on the way in (${kept})`);
    const joined = await page.evaluate(() => { const g = __ibPeopleMap.get('e:marcus@example.com'); return { n: g ? g.threads.length : -1, row: !!document.querySelector('#ib-rows .ib-rowwrap[data-key="t:7"]') }; });
    ok(joined.n === 1 && !joined.row, `and the chat joins Marcus's conversation (${joined.n})`);
    if (await page.$eval('#ib-conv .ib-back', (e) => !!e.getClientRects().length).catch(() => false)) {
        await page.click('#ib-conv .ib-back');
        await page.waitForTimeout(600);
    }
    threads.push({ thread_id: 8, name: 'Marcus Hill', email: 'marcus@example.com', source: '', location: '', is_guest: false, verified: false, archived: 0, last_at: at(0, '09:30'), unread: 1, last_body: 'Me again — the code?', last_role: 'guest' });
    threads.push({ thread_id: 9, name: 'Eleanor Brady', email: 'eleanor@example.com', source: '', location: '', is_guest: true, verified: true, archived: 0, last_at: at(0, '09:40'), unread: 1, last_body: 'Thank you for a lovely week.', last_role: 'guest' });
    await reload('t:8');
    const later = await page.evaluate(() => ({
        again: !!(__ibPeopleMap.get('t:8') || {}).claimed,
        eleanor: ((__ibPeopleMap.get('e:eleanor@example.com') || {}).threads || []).map((t) => t.thread_id),
        own: !!__ibPeopleMap.get('t:9'),
    }));
    ok(later.again, 'a later chat typing the same email asks again');
    ok(later.eleanor.includes(9) && !later.own, `a PROVEN account's chat still joins its guest (${JSON.stringify(later.eleanor)})`);

    console.log('11. an Inbox not on screen builds its count, not its rows');
    // Every refresh used to repaint the hidden list, conversation and pane. Off screen it
    // now builds its people and the count only, and showing it draws it at once.
    await page.evaluate(() => nav('view-backoffice'));
    await page.waitForTimeout(500);
    const n11 = await page.evaluate(() => inboxCount());
    threads.push({ thread_id: 21, name: 'Nell Newcomb', email: 'nell11@example.com', source: '', location: '', is_guest: true, verified: true, archived: 0, last_at: at(0, '10:10'), unread: 1, last_body: 'Is the cottage near the quay?', last_role: 'guest' });
    await page.evaluate(async () => { await loadAdminMessages(); });
    await page.waitForTimeout(600);
    const off = await page.evaluate(() => ({
        person: !!__ibPeopleMap.get('e:nell11@example.com'),
        row: !!document.querySelector('#ib-rows .ib-rowwrap[data-key="e:nell11@example.com"]'),
        n: inboxCount(),
    }));
    ok(off.person && off.n === n11 + 1, `off screen the new person is counted (${n11} → ${off.n})`);
    ok(!off.row, '…and no row is drawn while the Inbox is hidden');
    await page.evaluate(async () => { await window.openInbox(); });
    const drawn = await page.waitForFunction(() => !!document.querySelector('#ib-rows .ib-rowwrap[data-key="e:nell11@example.com"]'), null, { timeout: 8000 }).then(() => true, () => false);
    ok(drawn, 'opening the Inbox draws them at once');

    // 12. A chat photo is private: the conversation shows a "Photo" link that opens
    // it through the signed link the server handed out (photo.php), not a dead chip.
    console.log('12. a chat photo opens from the conversation');
    const photo12 = 'photo.php?f=chat-0123456789ab.jpg&exp=1999999999&sig=' + 'ab'.repeat(16);
    threadMsgs.push({ id: 9, role: 'guest', body: '', at: at(0, '08:30'), seen: false, attachment: photo12 });
    await page.evaluate(async () => { await window.openInbox(); await ibOpen('e:sofia@example.fr'); });
    const ph12 = await page.waitForFunction(() => {
        const a = [...document.querySelectorAll('#ib-thread a.ib-file')].find((x) => /^photo\.php\?/.test(x.getAttribute('href') || ''));
        return a ? { href: a.getAttribute('href'), target: a.target, rel: a.rel, text: a.textContent.trim() } : null;
    }, null, { timeout: 8000 }).then((h) => h.jsonValue(), () => null);
    ok(!!ph12 && ph12.href === photo12, `the photo is a link to its signed address (${ph12 ? ph12.href.slice(0, 40) : 'none'})`);
    ok(!!ph12 && ph12.target === '_blank' && /noopener/.test(ph12.rel) && ph12.text === 'Photo', '…opening in a new tab, named "Photo"');

    // 13. A GUEST'S REPLY BY EMAIL IS ONE MESSAGE. The reply poll posts it into their
    // chat and the email stays in the mailbox, so the conversation showed it twice: once
    // in the chat, once as the email it came in. The chat's copy shows, saying "Email".
    console.log('13. a guest\'s emailed reply shows once in their conversation');
    const count13 = (w) => page.evaluate((x) => (document.getElementById('ib-thread').innerText.match(new RegExp(x, 'g')) || []).length, w);
    // How a message is shown: its item (the chat's, written by email) and the channel
    // its meta draws. A run of one channel names it once, so the icon is what to read.
    const meta13 = (w) => page.evaluate((x) => {
        const p = __ibPeopleMap.get('e:sofia@example.fr');
        const its = p ? p.items.filter((i) => String(i.text || '').includes(x)) : [];
        const m = [...document.querySelectorAll('#ib-thread .ib-msg')].find((e) => e.textContent.includes(x));
        const t = m && m.querySelector('.ib-meta');
        const svg = t && t.querySelector('svg');
        const tpl = document.createElement('template');
        tpl.innerHTML = IB_IC.email;
        return { n: its.length, ch: its.map((i) => i.ch + '/' + (i.via || '')).join(','), text: t ? t.textContent.replace(/\s+/g, ' ').trim() : '', mailIcon: !!svg && !!tpl.content.firstElementChild && svg.outerHTML === tpl.content.firstElementChild.outerHTML };
    }, w);
    // One the list already left out (the poll had posted it), now in the chat.
    merged.push({ uid: 'u6', chat: 1 });
    threadMsgs.push({ id: 11, role: 'guest', body: 'IT13-POSTED Is there a hairdryer?', at: at(0, '08:40'), seen: false, attachment: '', kind: 'mail' });
    // One the poll had not posted yet when the list was read: listed with its chat and words.
    const w13 = 'IT13-WINDOW Found the towels, thank you!';
    mails.push({ uid: 'u7', from: 'sofia@example.fr', fromRaw: 'Sofia Laurent <sofia@example.fr>', subject: 'Re: Your message to Cottage Holidays Blakeney', date: at(0, '08:50'), seen: false, preview: w13, chat: 1, words: w13 });
    await page.evaluate(async () => { await loadMailbox(); await window.openInbox(); await ibOpen('e:sofia@example.fr'); });
    await page.waitForFunction(() => /IT13-POSTED/.test(document.getElementById('ib-thread').innerText) && /IT13-WINDOW/.test(document.getElementById('ib-thread').innerText), null, { timeout: 8000 }).catch(() => {});
    ok((await count13('IT13-POSTED')) === 1, `a reply the poll posted shows once, in the chat (${await count13('IT13-POSTED')})`);
    const mp13 = await meta13('IT13-POSTED');
    ok(mp13.n === 1 && mp13.ch === 'chat/email' && /^Email · /.test(mp13.text) && mp13.mailIcon, `…and says it came by email (${JSON.stringify(mp13)})`);
    ok((await count13('IT13-WINDOW')) === 1, 'one the chat has not had yet shows once, as the email');
    // The poll posts it: the chat, loaded again, shows those words from the guest.
    threadMsgs.push({ id: 12, role: 'guest', body: w13, at: at(0, '08:51'), seen: false, attachment: '', kind: 'mail' });
    await page.evaluate(async () => { await ibOpen('e:sofia@example.fr'); });
    await page.waitForFunction(() => { const p = __ibPeopleMap.get('e:sofia@example.fr'); return !!p && !p.mails.some((m) => m.uid === 'u7'); }, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    ok((await count13('IT13-WINDOW')) === 1, `once the chat has it, it still shows once, not twice (${await count13('IT13-WINDOW')})`);
    const mw13 = await meta13('IT13-WINDOW');
    ok(mw13.n === 1 && mw13.ch === 'chat/email' && mw13.mailIcon, `…now the chat's copy, written by email (${JSON.stringify(mw13)})`);
    const plan13 = await page.evaluate(() => { const p = __ibPeopleMap.get('e:sofia@example.fr'); const d = ibDeletePlan(p); return { uids: d.uids.slice().sort(), words: ibDeleteWords(p), mails: p.mails.length }; });
    ok(plan13.mails === 0 && plan13.uids.join(',') === 'u6,u7', `deleting the conversation deletes both emails from the mailbox too (${plan13.uids.join(',')})`);
    ok(/from the mailbox too/.test(plan13.words), '…and the confirm says so');
    await page.click('#ib-conv .ib-back').catch(() => {});
    await page.waitForTimeout(600);

    // 14. NEW EMAIL: to anyone, from the Inbox. The one sheet, without a stay or money
    // to add: who it is to (picked from the people the app knows, or typed), the name it
    // greets, a subject. A booked guest picked from the list gets their own email.
    console.log('14. New email: to anyone, from the Inbox');
    await page.evaluate(async () => { await window.openInbox(); });
    const nb14 = await page.evaluate(() => {
        const b = document.getElementById('ib-compose'), r = document.getElementById('ib-refresh');
        if (!b || !r) return null;
        const x = b.getBoundingClientRect(), y = r.getBoundingClientRect();
        return { label: b.getAttribute('aria-label'), w: Math.round(x.width), h: Math.round(x.height), row: Math.abs(x.top - y.top) < 2, gap: Math.round(Math.min(Math.abs(y.left - x.right), Math.abs(x.left - y.right))) };
    });
    ok(!!nb14 && nb14.label === 'New email' && nb14.row && nb14.gap <= 16, `a New email button beside refresh (${JSON.stringify(nb14)})`);
    ok(!!nb14 && nb14.w >= 44 && nb14.h >= 44, 'at the 44px floor');
    // Writing to guests is a permission: without it the button is not offered.
    const hid14 = await page.evaluate(() => { document.body.classList.add('cap-x-gu-reply'); const h = !document.getElementById('ib-compose').getClientRects().length; document.body.classList.remove('cap-x-gu-reply'); return h; });
    ok(hid14, 'someone who may not write to guests is not offered it');
    await page.click('#ib-compose');
    await page.waitForFunction(() => document.getElementById('enq-email-modal').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const s14 = await page.evaluate(() => {
        const vis = (id) => { const e = document.getElementById(id); return !!e && e.getClientRects().length > 0; };
        return {
            mode: document.getElementById('enq-email-modal').classList.contains('cmp-new'),
            title: (document.getElementById('enq-email-title') || {}).textContent || '',
            focus: (document.activeElement || {}).id || '',
            to: vis('cmp-new-to'), name: vis('cmp-new-name'), toRow: vis('cmp-to'),
            stay: vis('cmp-stay-row'), money: vis('cmp-money-row'), attach: vis('cmp-attach'),
            greet: document.getElementById('cmp-greet').textContent,
        };
    });
    ok(s14.mode && s14.title === 'New email', `the sheet opens as a new email (${s14.title})`);
    ok(s14.to && s14.name && !s14.toRow && s14.focus === 'cmp-new-to', 'with an address and a name to fill, the address asked for first');
    ok(!s14.stay && !s14.money && s14.attach, 'no stay or money to add, files still can be');
    ok(s14.greet === '', 'no greeting until there is a name');
    // Nothing to send to yet: the sheet says what is missing, where it is.
    await page.fill('#enq-email-body', 'Could you quote for winter linen?');
    await page.click('#enq-email-send');
    await page.waitForTimeout(300);
    const e14a = await page.evaluate(() => ({ msg: document.getElementById('enq-email-msg').textContent, focus: (document.activeElement || {}).id }));
    ok(e14a.msg === 'Add who it’s to.' && e14a.focus === 'cmp-new-to', `no address: it asks for one (${e14a.msg})`);
    await page.fill('#cmp-new-to', 'pete at holt');
    await page.click('#enq-email-send');
    await page.waitForTimeout(300);
    ok((await page.$eval('#enq-email-msg', (e) => e.textContent)) === 'That isn’t an email address.', 'not an address: it says so');
    // The people the app knows, by name or address.
    await page.fill('#cmp-new-to', '');
    await page.type('#cmp-new-to', 'pete');
    await page.waitForTimeout(300);
    const sg14 = await page.evaluate(() => [...document.querySelectorAll('#cmp-new-sugg .cmp-sugg-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
    ok(sg14.length === 1 && /Pete Holt/.test(sg14[0]) && /pete@holtlinen\.co\.uk/.test(sg14[0]), `typing a name offers the person (${sg14.join(' | ')})`);
    ok((await page.$eval('#cmp-new-to', (e) => e.getAttribute('aria-expanded'))) === 'true', '…announced as open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const esc14 = await page.evaluate(() => ({ sugg: document.getElementById('cmp-new-sugg').hidden, open: document.getElementById('enq-email-modal').classList.contains('open') }));
    ok(esc14.sugg && esc14.open, 'Escape folds the suggestions, not the sheet');
    await page.fill('#cmp-new-to', '');
    await page.type('#cmp-new-to', 'pete');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowDown');
    ok((await page.evaluate(() => (document.activeElement || {}).className || '')) === 'cmp-sugg-row', 'Down reaches the person offered');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const pk14 = await page.evaluate(() => ({ to: document.getElementById('cmp-new-to').value, name: document.getElementById('cmp-new-name').value, greet: document.getElementById('cmp-greet').textContent, focus: (document.activeElement || {}).id, sugg: document.getElementById('cmp-new-sugg').hidden }));
    ok(pk14.to === 'pete@holtlinen.co.uk' && pk14.name === 'Pete Holt' && pk14.sugg, `picking them fills the address and the name (${pk14.to}, ${pk14.name})`);
    ok(pk14.greet === 'Hello Pete,' && pk14.focus === 'enq-email-subject', 'the greeting follows the name, and the subject is next');
    await page.click('#enq-email-send');
    await page.waitForTimeout(300);
    ok((await page.$eval('#enq-email-msg', (e) => e.textContent)) === 'Add a subject.', 'no subject: it asks for one');
    await page.fill('#enq-email-subject', 'Linen for the winter');
    // The preview is the server's email, built from what is typed.
    // Posts are seen node-side, so the wait for one is a poll here, not in the page.
    const waitPost = async (from, pred, ms = 6000) => {
        for (let i = 0; i < ms / 100; i++) {
            const hit = posts.slice(from).find(pred);
            if (hit) return hit;
            await page.waitForTimeout(100);
        }
        return null;
    };
    const pv0 = posts.length;
    await page.click('#enq-email-preview-btn');
    const pvPost = await waitPost(pv0, (p) => p.__url === 'mailbox.php' && p.action === 'preview');
    ok(!!pvPost && pvPost.to === 'pete@holtlinen.co.uk' && pvPost.name === 'Pete Holt' && pvPost.subject === 'Linen for the winter' && /winter linen/.test(pvPost.body), `Preview asks the server for this email (${pvPost ? JSON.stringify({ to: pvPost.to, name: pvPost.name, subject: pvPost.subject }) : 'none'})`);
    await page.click('#cmp-tab-write');
    await page.waitForTimeout(300);
    // Send: five seconds to change their mind, then it goes through the mailbox.
    const sd0 = posts.length;
    await page.click('#enq-email-send');
    await page.waitForTimeout(400);
    const hold14 = await page.evaluate(() => ({ open: document.getElementById('enq-email-modal').classList.contains('open'), toast: document.getElementById('cmp-toast').textContent.replace(/\s+/g, ' ') }));
    ok(!hold14.open && /Sending to Pete/.test(hold14.toast) && !posts.slice(sd0).some((p) => p.action === 'send'), `it waits with Undo, naming who it goes to (${hold14.toast.trim().slice(0, 60)})`);
    await page.evaluate(() => composeFlush());
    await page.waitForFunction(() => /Sent to Pete/.test(document.getElementById('cmp-toast').textContent), null, { timeout: 5000 }).catch(() => {});
    const sp14 = posts.slice(sd0).find((p) => p.__url === 'mailbox.php' && p.action === 'send');
    ok(!!sp14 && sp14.compose === 'new' && sp14.to === 'pete@holtlinen.co.uk' && sp14.name === 'Pete Holt' && sp14.subject === 'Linen for the winter' && /winter linen/.test(sp14.body), 'sent as a new email, to the address with the name');
    ok(!!sp14 && typeof sp14.op_id === 'string' && sp14.op_id.length > 8 && Array.isArray(sp14.attachments), '…once, whatever happens to the answer (a retry id rides it)');
    ok(/Sent to Pete/.test(await page.$eval('#cmp-toast', (e) => e.textContent)), 'and says it went');
    // Someone the app had never met is in the Inbox now, by the name it was sent to.
    sent.unshift({ id: 99, to_email: 'nell.new@example.org', to_name: 'Nell Newbury', cc_email: null, subject: 'Hello from Blakeney', body: 'Lovely to meet you at the quay.', sent_at: stamp(now() - 30000) });
    await page.evaluate(async () => { await loadMailbox(); ibBuild(); ibRenderAll(); });
    const nn14 = await page.evaluate(() => { const p = __ibPeopleMap.get('e:nell.new@example.org'); return p ? { name: p.name, sent: p.sent.length } : null; });
    ok(!!nn14 && nn14.name === 'Nell Newbury' && nn14.sent === 1, `a new person is in the Inbox, named as written (${nn14 && nn14.name})`);
    // A booked guest picked from the list gets THEIR email: the stay and money with it,
    // and what was written so far carried across.
    await page.click('#ib-compose');
    await page.waitForFunction(() => document.getElementById('enq-email-modal').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.fill('#enq-email-body', 'IT14 See you soon.');
    await page.type('#cmp-new-to', 'daniel');
    await page.waitForTimeout(300);
    await page.click('#cmp-new-sugg .cmp-sugg-row');
    await page.waitForTimeout(500);
    const bk14 = await page.evaluate(() => ({ mode: document.getElementById('enq-email-modal').classList.contains('cmp-new'), toRow: !!document.getElementById('cmp-to').getClientRects().length, name: document.getElementById('cmp-to-name').textContent, stay: !!document.getElementById('cmp-stay-row').getClientRects().length, msg: document.getElementById('enq-email-body').value, kind: __composeTarget && __composeTarget.kind }));
    ok(!bk14.mode && bk14.kind === 'booking' && bk14.toRow && /Daniel/.test(bk14.name) && bk14.stay, `a guest with a stay gets their own email, their stay with it (${bk14.kind}, ${bk14.name})`);
    ok(bk14.msg === 'IT14 See you soon.', '…keeping what was already written');
    await page.evaluate(() => closeEnquiryEmailModal());
    await page.waitForTimeout(500);
    // A draft of a new email is kept on this device, with who it was to.
    await page.click('#ib-compose');
    await page.waitForTimeout(500);
    await page.fill('#cmp-new-to', 'ivy@example.net');
    await page.fill('#cmp-new-name', 'Ivy Lane');
    await page.fill('#enq-email-subject', 'Your walk guide');
    await page.fill('#enq-email-body', 'IT14-DRAFT Here are the walks we mentioned.');
    await page.dispatchEvent('#enq-email-body', 'input');
    await page.evaluate(() => closeEnquiryEmailModal());
    await page.waitForTimeout(600);
    await page.click('#ib-compose');
    await page.waitForTimeout(600);
    const dr14 = await page.evaluate(() => ({ to: document.getElementById('cmp-new-to').value, name: document.getElementById('cmp-new-name').value, subj: document.getElementById('enq-email-subject').value, msg: document.getElementById('enq-email-body').value, greet: document.getElementById('cmp-greet').textContent }));
    ok(dr14.to === 'ivy@example.net' && dr14.name === 'Ivy Lane' && dr14.subj === 'Your walk guide' && /IT14-DRAFT/.test(dr14.msg) && dr14.greet === 'Hello Ivy,', `closing keeps the draft, address and name included (${dr14.to}, ${dr14.name})`);
    await page.evaluate(() => closeEnquiryEmailModal(true));
    await page.waitForTimeout(400);

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
