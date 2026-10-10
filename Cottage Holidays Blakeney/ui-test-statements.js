// ui-test-statements.js — the business bank on the Payments page, from the
// statements the owner exports (see CLAUDE.md "The business bank, from its
// statements"). statements.php is stubbed with state kept here, but the PARSING
// and the auto-sort are the real statement-lib.php run through the php CLI, so
// the screens see exactly what the server would send. The server itself is gated
// by test-statements.php and test-integration §53.
//
// Covers: the way in (the landing's "In the bank" row), the + menu, the add sheet
// (a PDF refused, the first statement read from the tax year's start, the review,
// the receipt, one import carrying an op id), the bank page (the closing balance
// and the count of what waits), the ONE Money list's To sort filter (what sorted
// itself, a suggestion per kind), recording a guest's transfer on the booking
// dated the day it arrived, an expense on its own date and linked, the next
// payment from that payee remembered, tax and a platform payout, the kind sheet,
// Undo of an expense on the payment's own page, a recorded transfer offering Open
// rather than Undo, the reminder switch, Needs you, the same file adding nothing,
// and a due statement asking on the landing. (The bank page's own To sort /
// Sorted lists and the way-in card went into the Money list: CLAUDE.md "One money
// list".) And the LIVE LINK to Monzo (monzo.php, stubbed;
// the real flow against a fake Monzo is test-integration §54): set up in three
// steps with the redirect address to copy, a non-confidential client refused in
// the server's words, connecting, waiting for approval in the app (polled, then
// the payments arriving), live on the landing with the statement ask standing
// down and Monzo's balance leading, syncing, disconnecting behind a confirm, and
// a person without full access offered no setup.
const APP = __dirname;
const { boot } = require('./ui-test-lib');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const pad = (n) => String(n).padStart(2, '0');
const dt = (n) => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); };
const d = (n) => { const x = dt(n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const dmy = (n) => { const x = dt(n); return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()}`; };
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const php = (code, input) => JSON.parse(execFileSync('php', ['-r', `require '${APP}/statement-lib.php'; ${code}`], { input: input || '' }).toString());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const width = 390;
    const theme = 'dark';
    const { page, base, done } = await boot({ viewport: { width, height: width < 600 ? 844 : 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const mk = (id, over = {}) => Object.assign({
        id, prop_key: '21a', name: 'Guest', email: 'g@gmail.com', phone: '', address: '1 Lane', postcode: 'NR25 7AB',
        check_in: d(20), check_out: d(23), check_in_time: '15:00', check_out_time: '10:00', adults: 2, children: 0,
        payment: 'paid', deposit_paid: 440, payment_method: 'Square card', payment_date: d(-30), agreed_total: 440, agreed_per_night: 130,
        agreed_nights: 3, agreed_nightly: 390, agreed_booking_fee: 50, agreed_txn_pct: 0, agreed_txn_fee: 0, agreed_on: d(-40), hold_status: 'charged', hold_amount: 50, notes: '',
    }, over);
    const rows = [
        mk(1, { name: 'Daniel Okafor', check_in: d(9), check_out: d(13) }),
        mk(6, { name: 'Marcus Hill', check_in: d(14), check_out: d(17), payment: 'deposit', deposit_paid: 112.5, payment_method: 'Bank transfer', hold_status: 'none', hold_amount: 0 }),
        mk(7, { name: 'Priya Shah', check_in: d(40), check_out: d(43), payment: 'deposit', deposit_paid: 100, payment_method: 'Bank transfer', hold_status: 'none', hold_amount: 0 }),
    ];
    // ── statements.php, kept as state the way the real tables would be ──
    const S = { on: false, remind: true, imports: [], lines: [], nextId: 1, nextExp: 900 };
    // The live link, as monzo.php would report it.
    const LIVE = { state: 'off', say: '', client: false, client_fixed: false, redirect: 'https://chb.example/monzo-callback.php', account: '', connected_at: 0, full_until: 0, last_ok: 0, last_error: '', added: 0, balance: null, total: null, balance_at: 0 };
    let checks = 0;
    const status = () => {
        const last = S.imports.slice().sort((a, b) => (a.to < b.to ? 1 : -1))[0] || null;
        const withBal = S.imports.filter((i) => i.balance != null).sort((a, b) => (a.balance_at < b.balance_at ? 1 : -1))[0];
        const toSort = S.lines.filter((l) => !l.as).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
        const sorted = S.lines.filter((l) => l.as).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
        const learnMap = {};
        S.lines.filter((l) => ['expense', 'platform', 'ignore', 'tax', 'income'].includes(l.as) && l.name).forEach((l) => { const k = l.name + '|' + l.as + '|' + l.label; learnMap[k] = { name: l.name, as: l.as, label: l.label }; });
        return {
            ok: true, ready: true, on: S.on, remind: S.remind, live: Object.assign({}, LIVE),
            last: last ? { from: last.from, to: last.to, rows: last.rows, added: last.added, skipped: last.rows - last.added, at: '' } : null,
            balance: withBal ? withBal.balance : null, balance_at: withBal ? withBal.balance_at : '',
            first: S.lines.length ? S.lines.map((l) => l.date).sort()[0] : '', uploads: S.imports.length,
            unsorted: toSort.length,
            due: php(`echo json_encode(statement_due(${last ? `'${last.to}'` : 'null'}, '${d(0)}'));`),
            lines: toSort.concat(sorted), learned: Object.values(learnMap),
        };
    };
    const plan = (b) => {
        const p = php(`echo json_encode(statement_parse(stream_get_contents(STDIN), '${b.filename}'));`, b.csv);
        if (!p.ok) return { err: p.error };
        const known = new Set(S.lines.map((l) => l.ext_key));
        const fresh = [];
        let already = 0, older = 0;
        p.lines.forEach((l) => { if (known.has(l.ext_key)) already++; else if (b.since && l.date < b.since) older++; else fresh.push(l); });
        return { p, fresh, sum: { from: p.from, to: p.to, rows: p.lines.length, adding: fresh.length, already, older, money_in: p.money_in, money_out: p.money_out, balance: p.balance, balance_at: p.balance_at, unreadable: p.unreadable, other_currency: p.other_currency } };
    };
    const posts = [];
    await page.route(/\.php/, (route) => {
        const url = route.request().url();
        const json = (o, st) => route.fulfill({ status: st || 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (route.request().method() === 'POST') {
            const b = JSON.parse(route.request().postData() || '{}');
            b.__url = url.split('/').pop().split('?')[0];
            posts.push(b);
            if (b.__url === 'statements.php') {
                if (b.action === 'status') return json(status());
                if (b.action === 'preview') { const r = plan(b); return r.err ? json({ error: r.err }, 400) : json({ ok: true, summary: r.sum }); }
                if (b.action === 'import') {
                    const r = plan(b);
                    if (r.err) return json({ error: r.err }, 400);
                    let auto = 0;
                    r.fresh.forEach((l) => {
                        const a = php(`echo json_encode(statement_auto(json_decode(stream_get_contents(STDIN), true)));`, JSON.stringify(l));
                        if (a) auto++;
                        S.lines.push(Object.assign({ id: S.nextId++, as: a ? a[0] : null, label: a ? a[1] : '', booking_id: null, expense_id: null }, l));
                    });
                    S.imports.push({ from: r.p.from, to: r.p.to, rows: r.p.lines.length, added: r.fresh.length, balance: r.p.balance, balance_at: r.p.balance_at });
                    S.on = true;
                    return json({ ok: true, summary: Object.assign({}, r.sum, { added: r.fresh.length, auto }) });
                }
                if (b.action === 'mark') {
                    if (b.as === 'payment' && !b.booking_id) return json({ error: 'Say which booking the payment was for.' }, 400);
                    const l = S.lines.find((x) => x.id === b.id);
                    Object.assign(l, { as: b.as, label: b.label || '', booking_id: b.booking_id || null, expense_id: b.expense_id || null });
                    return json({ ok: true });
                }
                if (b.action === 'unmark') { Object.assign(S.lines.find((x) => x.id === b.id), { as: null, label: '', booking_id: null, expense_id: null }); return json({ ok: true }); }
                if (b.action === 'settings') { S.remind = !!b.remind; return json({ ok: true, remind: S.remind }); }
                if (b.action === 'remove') { S.on = false; return json({ ok: true }); }
            }
            if (b.__url === 'monzo.php') {
                const now = Math.floor(Date.now() / 1000);
                if (b.action === 'save_client') {
                    if (/^mnzpub/.test(b.client_secret || '')) return json({ error: 'That client isn’t confidential, so Monzo won’t keep it connected. Make it again as Confidential.' }, 400);
                    Object.assign(LIVE, { client: true, state: 'ready', say: 'Not connected yet.' });
                    return json({ ok: true, live: LIVE });
                }
                if (b.action === 'connect') return json({ ok: true, url: 'https://auth.monzo.test/?client_id=oauth2client_0000Abc&state=x', live: LIVE });
                if (b.action === 'check') {
                    checks++;
                    if (checks < 2) return json({ ok: true, sync: null, live: LIVE });
                    Object.assign(LIVE, { state: 'live', say: '', account: 'Business account ending 4471', last_ok: now, balance: 1880.25, total: 2511.69, balance_at: now });
                    return json({ ok: true, sync: { ok: true, added: 3, auto: 1 }, live: LIVE });
                }
                if (b.action === 'sync') return json({ ok: true, sync: { ok: true, added: 0, auto: 0 }, live: LIVE });
                if (b.action === 'disconnect') { Object.assign(LIVE, { state: 'ready', account: '', last_ok: 0, balance: null }); return json({ ok: true, live: LIVE }); }
                return json({ ok: true, live: LIVE });
            }
            if (b.__url === 'expenses.php' && b.action === 'add') return json({ ok: true, id: S.nextExp++ });
            if (b.__url === 'expenses.php' && b.action === 'list') return json({ ok: true, expenses: [] });
            if (b.__url === 'money.php') {
                return json({ ok: true, position: { with_square: 0, in_bank: 420, ready: 420, held: 0, last_moved: 0, unreported_count: 0, failed: [] }, bank_items: [], moved_map: {}, landed_map: {}, way_items: [], books: { year: 2026, income: 15610, kept: 0, fees: 271.8, expenses: 1119.6, profit: 14218.6, quarters: [5210, 10400, 1200, 0], by_category: [], undated: { count: 0 } }, years: [2026], activity: [] });
            }
            if (b.__url === 'bookings.php' && b.action === 'set_payment') {
                const r = rows.find((x) => x.id === b.id);
                r.payment = b.payment; r.deposit_paid = b.payment === 'deposit' ? b.deposit : 440; r.payment_method = b.payment_method; r.payment_date = b.payment_date;
                return json({ ok: true });
            }
            return json({ ok: true, events: [], logs: {}, reviews: [], photos: [], returns: [] });
        }
        if (url.includes('bookings.php')) return json({ bookings: rows });
        if (url.includes('rates.php')) return json({ properties: [{ prop_key: '21a', name: '21A Westgate', slug: '21a', couple_rate: 130, extra_adult_rate: 0, child_rate: 0, booking_fee: 50, transaction_pct: 0, lastmin_pct: 0, lastmin_days: 0, max_adults: 2, max_children: 0, max_total: 2, sort_order: 1 }], seasons: {}, occupancy: {} });
        return json({ ok: true, bookings: [], enquiries: [], properties: [], seasons: {}, occupancy: {}, content: {}, blocks: [], ranges: [], payments: [], years: [] });
    });
    await page.route('https://auth.monzo.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Monzo</title><p>Monzo sign in</p>' }));
    const enterApp = async () => {
        await page.waitForTimeout(1300);
        await page.evaluate((th) => { isAuthenticated = true; document.body.classList.add('owner-mode'); if (th === 'light') document.body.classList.add('light-mode'); else document.body.classList.remove('light-mode'); squareAdminEnabled = true; }, theme);
        await page.evaluate(() => window.loadAdminBundle());
        await page.waitForTimeout(600);
        await page.evaluate(() => loadData());
        await page.waitForTimeout(600);
        await page.evaluate(() => openAccounts());
        await page.waitForTimeout(1500);
    };
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await enterApp();
        const shot = async () => {};
    const list = () => page.evaluate(() => document.getElementById('pm-list').textContent.replace(/\s+/g, ' '));
    const detail = () => page.evaluate(() => (document.getElementById('pm-detail') || {}).textContent.replace(/\s+/g, ' '));
    const sheet = () => page.evaluate(() => document.getElementById('pm-sheet').textContent.replace(/\s+/g, ' '));
    const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s); e.click(); }, sel);
    const clickText = (scope, text) => page.evaluate(([sc, t]) => { const e = [...document.querySelectorAll(sc + ' button')].find((b) => b.textContent.trim() === t); if (!e) throw new Error('no button ' + t); e.click(); }, [scope, text]);

    await shot('1-landing');
    // THE WAY IN is the landing's "In the bank" row now (the way-in card and its
    // Not now went with "One money list"): with nothing linked it says so, offers
    // Link, and opens the bank page.
    const way = await page.evaluate(() => {
        const b = document.querySelector('#pm-list .pm-bankstrip [data-pm="bank"]');
        return b ? { txt: b.textContent.replace(/\s+/g, ' '), go: ((b.querySelector('.pm-go') || {}).textContent || '').trim() } : null;
    });
    ok(!!way && /In the bank\s*Not linked/.test(way.txt) && way.go === 'Link', 'the landing offers the way in: "In the bank · Not linked", with Link (' + (way && way.txt) + ')');
    ok(/Open Banking\s*Your bank, in this list\s*Not linked/.test(await list()), '…and "Where it comes from" says the bank is not linked yet');
    const owed = await page.evaluate(() => pmOwed().map((r) => [r.b.name, r.dg.balance]));
    const marcus = owed.find((o) => o[0] === 'Marcus Hill');
    ok(!!marcus, 'Marcus owes ' + JSON.stringify(owed));
    const csv = 'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Balance,Balance currency\n' + [
        ['tx_1', dmy(-12), '09:12:00', 'Faster payment', 'SQUARE PAYOUT', '612.40', '1612.40', 'SQ *PAYOUT'],
        ['tx_2', dmy(-11), '14:00:00', 'Faster payment', 'M HILL', marcus[1].toFixed(2), '1950.00', 'CHB-000006'],
        ['tx_3', dmy(-10), '08:30:00', 'Faster payment', 'NORFOLK CLEAN CO', '-86.40', '1863.60', 'INV 2201'],
        ['tx_4', dmy(-8), '08:30:00', 'Faster payment', 'NORFOLK CLEAN CO', '-72.00', '1791.60', 'INV 2207'],
        ['tx_5', dmy(-7), '10:00:00', 'Direct debit', 'HMRC', '-400.00', '1391.60', 'SA UTR'],
        ['tx_6', dmy(-6), '10:00:00', 'Faster payment', 'AIRBNB PAYMENTS UK', '520.00', '1911.60', 'AIRBNB'],
        ['tx_7', dmy(-5), '23:10:00', 'Pot transfer', 'Tax pot', '-631.44', '1280.16', ''],
        ['tx_8', dmy(-3), '12:01:00', 'Card payment', 'TESCO STORES 2231', '-23.10', '1257.06', 'TESCO STORES'],
    ].map(([id, dd, t, ty, n, a, bal, desc]) => `${id},${dd},${t},${ty},${n},,General,${a},GBP,${a},GBP,,,,${desc},,${bal},GBP`).join('\n') + '\n';
    const csvPath = fs.mkdtempSync(os.tmpdir() + '/chb-stmt-') + '/monzo-business.csv';
    fs.writeFileSync(csvPath, csv);

    // ── Add a statement ──
    await click('#pm-add');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => !!document.querySelector('#pm-menu [data-pm="bank-add"]')), 'the + menu has "Add a bank statement"');
    await click('#pm-menu [data-pm="bank-add"]');
    await page.waitForFunction(() => !!document.getElementById('pm-stmt-file'), null, { timeout: 6000 }).catch(() => {});
    await shot('2-add');
    // The how-to-export step was removed at the owner's ask: the sheet opens on the file.
    ok(await page.evaluate(() => !!document.getElementById('pm-stmt-file')) && /Add a statement/.test(await sheet()) && !/I have the file/.test(await sheet()), 'the sheet opens on choosing the file (the how-to step is gone)');
    await page.setInputFiles('#pm-stmt-file', { name: 'statement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await page.waitForTimeout(300);
    ok(/That’s a PDF/.test(await sheet()), 'a PDF is named for what it is');
    await page.setInputFiles('#pm-stmt-file', csvPath);
    await page.waitForFunction(() => /Review before it goes in/.test(document.getElementById('pm-sheet').textContent), null, { timeout: 8000 });
    await shot('4-check');
    // THE FIRST STATEMENT READS FROM THE START OF THE TAX YEAR: older lines in the file
    // are left out unless the owner says otherwise.
    const tyStart = `${d(0) < `${dt(0).getFullYear()}-04-06` ? dt(0).getFullYear() - 1 : dt(0).getFullYear()}-04-06`;
    const pv1 = posts.filter((p) => p.__url === 'statements.php' && p.action === 'preview').pop();
    ok(!!pv1 && pv1.since === tyStart, `the first statement is read from the start of the tax year (since ${pv1 && pv1.since}, expected ${tyStart})`);
    const chk = await sheet();
    ok(/Payments in the file\s*8/.test(chk) && /Already here\s*None/.test(chk), 'the check counts the file: ' + chk.slice(0, 220));
    ok(/Add 8 payments/.test(chk), 'the button says what it will add');
    await clickText('#pm-sheet', 'Add 8 payments');
    await page.waitForFunction(() => /payments added/.test(document.getElementById('pm-sheet').textContent), null, { timeout: 8000 });
    await shot('5-done');
    const dn = await sheet();
    ok(/8 payments added/.test(dn) && /Matched by themselves\s*2/.test(dn) && /For you to sort\s*6/.test(dn), 'the receipt: ' + dn.slice(0, 200));
    const imp = posts.filter((p) => p.__url === 'statements.php' && p.action === 'import');
    ok(imp.length === 1 && /^[\w-]+/.test(imp[0].op_id || ''), 'one import, carrying an op id');
    await clickText('#pm-sheet', 'See your bank');
    await page.waitForFunction(() => /Your bank/.test((document.getElementById('pm-detail') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
    await shot('6-bank');
    let dt1 = await detail();
    ok(/Balance on .*£1,257\.06/.test(dt1), 'the bank page leads with the closing balance');
    // The bank page's To sort / Sorted lists went into the ONE Money list on the
    // landing: the bank page counts what waits and its row is the way there.
    ok(/6 payments to sort/.test(dt1) && /in the Money list/.test(dt1), 'six to sort, and the bank page points at the Money list');
    await click('#pm-detail [data-pm="tosort"]');
    await page.waitForFunction(() => document.querySelector('#pm-list [data-pm="filter"][data-arg="tosort"][aria-pressed="true"]'), null, { timeout: 6000 }).catch(() => {});
    let L0 = await list();
    ok(await page.evaluate(() => !document.getElementById('pm').classList.contains('is-detail')), 'its row closes the bank page on a phone and lands on the list');
    ok(/To sort\s*6/.test(L0), 'the Money list carries a To sort filter with its count');
    ok(/Marcus Hill owes .*reference is their booking/.test(L0), 'the guest transfer is matched by its reference');
    ok(/Looks like cleaning/.test(L0) && /Tax\. It isn’t a cottage cost/.test(L0) && /An Airbnb payout/.test(L0), 'cleaning, tax and the platform payout each get a suggestion');
    ok(!/SQUARE PAYOUT|Tax pot/.test(L0), 'the Square payout and the pot move are not waiting to be sorted');
    await click('#pm-list [data-pm="filter"][data-arg="all"]');
    await page.waitForTimeout(200);
    const Lall = await list();
    ok(/SQUARE PAYOUT\s*Square payout/.test(Lall) && /Tax pot\s*To a pot/.test(Lall), 'the Square payout and the pot move sorted themselves, and say so in the Money list');
    await click('#pm-list [data-pm="filter"][data-arg="tosort"]');
    await page.waitForTimeout(200);
    // ── record Marcus's transfer ──
    await clickText('#pm-list', 'Record Marcus’s payment');
    await page.waitForFunction(() => pmBankLines().some((l) => l.as === 'payment'), null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(400);
    const sp = posts.filter((p) => p.__url === 'bookings.php' && p.action === 'set_payment').pop();
    ok(sp && sp.payment === 'paid' && sp.payment_date === d(-11) && sp.payment_method === 'Bank transfer' && sp.op_id, 'recorded on the booking, dated the day it arrived: ' + JSON.stringify(sp));
    const mk1 = posts.filter((p) => p.__url === 'statements.php' && p.action === 'mark').pop();
    ok(mk1 && mk1.as === 'payment' && mk1.booking_id === 6, 'the line is linked to the booking');
    await page.evaluate(() => { const c = document.getElementById('glass-dialog-cancel'); if (c && c.offsetParent) c.click(); });
    await page.waitForTimeout(400);
    await shot('7-recorded');
    // ── add the cleaning as an expense ──
    await clickText('#pm-list', 'Add as Cleaning');
    await page.waitForFunction(() => /Cleaning, as last time/.test(document.getElementById('pm-list').textContent), null, { timeout: 6000 }).catch(() => {});
    const ex = posts.filter((p) => p.__url === 'expenses.php' && p.action === 'add').pop();
    ok(ex && ex.category === 'Cleaning' && ex.amount === 72 && ex.date === d(-8) && ex.description === 'NORFOLK CLEAN CO', 'the expense is added on its own date: ' + JSON.stringify(ex));
    const mk2 = posts.filter((p) => p.__url === 'statements.php' && p.action === 'mark').pop();
    ok(mk2 && mk2.as === 'expense' && mk2.expense_id === 900, 'linked to the expense it made');
    L0 = await list();
    ok(/Cleaning, as last time/.test(L0), 'the second payment to the same cleaner is remembered');
    await shot('8-learned');
    await clickText('#pm-list', 'Leave it out');
    await page.waitForTimeout(500);
    await clickText('#pm-list', 'That’s it');
    await page.waitForTimeout(500);
    const marks = posts.filter((p) => p.__url === 'statements.php' && p.action === 'mark');
    ok(marks.some((m) => m.as === 'tax') && marks.some((m) => m.as === 'platform' && m.label === 'Airbnb payout'), 'tax left out, the Airbnb payout noted');
    // ── something else: the category sheet ──
    await clickText('#pm-list', 'An expense');
    await page.waitForFunction(() => /What was £23\.10 for\?/.test((document.getElementById('pm-sheet') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
    await shot('9-cat');
    ok(/What was £23\.10 for\?/.test(await sheet()), 'the category sheet names the figure');
    await page.evaluate(() => [...document.querySelectorAll('#pm-sheet [data-pms="cat"]')].find((b) => b.textContent === 'Supplies').click());
    await page.waitForFunction(() => pmBankLines().some((l) => /TESCO/.test(l.name) && l.as === 'expense'), null, { timeout: 6000 }).catch(() => {});
    const ex2 = posts.filter((p) => p.__url === 'expenses.php' && p.action === 'add').pop();
    ok(ex2 && ex2.category === 'Supplies' && ex2.amount === 23.1, 'the chosen kind is added');
    // ── undo an expense: it lives on the payment's own page now, not in a Sorted list ──
    await click('#pm-list [data-pm="filter"][data-arg="all"]');
    await page.waitForTimeout(200);
    const tesco = await page.evaluate(() => { const b = [...document.querySelectorAll('#pm-list [data-pm="line"]')].find((x) => /TESCO/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return b ? b.getAttribute('aria-label') : ''; });
    await page.waitForFunction(() => !!document.querySelector('#pm-detail [data-pm="bank-undo"]'), null, { timeout: 4000 }).catch(() => {});
    ok(/Supplies/.test(tesco), 'the sorted payment is one plain row saying what it was (' + tesco + ')');
    const ln = await detail();
    ok(/−£23\.10/.test(ln) && /Paid out/.test(ln) && /What it was/.test(ln) && /Counted, as a cost/.test(ln), 'its page says what it was and that the books count it');
    await click('#pm-detail [data-pm="bank-undo"]');
    await page.waitForFunction(() => /What was it\?/.test((document.getElementById('pm-detail') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
    const del = posts.filter((p) => p.__url === 'expenses.php' && p.action === 'delete').pop();
    ok(!!del && del.id === 901, 'Undo deletes the expense it made');
    const back = await detail();
    ok(/To sort/.test(back) && /What was it\?/.test(back) && await page.evaluate(() => pmBankLines().some((l) => /TESCO/.test(l.name) && !l.as)), '…the page stays open and asks again: it is back to sort');
    await page.evaluate(() => { const b = document.querySelector('#pm-detail [data-pm="close"]'); if (b && b.offsetParent) b.click(); });
    await page.waitForTimeout(400);
    // the recorded transfer offers its booking, never an undo that could double it
    await page.evaluate(() => { const b = [...document.querySelectorAll('#pm-list [data-pm="line"]')].find((x) => /M HILL/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); });
    await page.waitForFunction(() => /M HILL/.test((document.getElementById('pm-detail') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
    ok(await page.evaluate(() => { const p = document.getElementById('pm-detail'); return /Recorded on their booking/.test(p.textContent) && !!p.querySelector('[data-pm="stay"]') && !p.querySelector('[data-pm="bank-undo"]'); }), 'a recorded transfer offers Open the booking, not Undo');
    await page.evaluate(() => { const b = document.querySelector('#pm-detail [data-pm="close"]'); if (b && b.offsetParent) b.click(); });
    await page.waitForTimeout(400);
    // ── the reminder switch ──
    await click('#pm-list [data-pm="bank"]');
    await page.waitForFunction(() => !!document.querySelector('#pm-detail [data-pm="bank-remind"]'), null, { timeout: 4000 }).catch(() => {});
    await click('#pm-detail [data-pm="bank-remind"]');
    await page.waitForTimeout(500);
    const st = posts.filter((p) => p.__url === 'statements.php' && p.action === 'settings').pop();
    ok(st && st.remind === false, 'the reminder switch saves');
    await shot('10-sorted');
    // ── the landing ──
    await page.evaluate(() => { const b = document.querySelector('#pm-detail [data-pm="close"]'); if (b && b.offsetParent) b.click(); });
    await page.waitForTimeout(500);
    const L = await list();
    ok(/2 bank payments to sort/.test(L), 'Needs you counts what is left to sort: ' + (L.match(/\d+ bank payments? to sort/) || [''])[0]);
    ok(/In the bank\s*Statement · [^£]*£1,257\.06/.test(L), 'the landing shows the account in one row, with the statement’s balance: ' + (L.match(/In the bank[^£]*£[\d,.]+/) || [''])[0]);
    await shot('11-landing');
    // ── the same file again ──
    await page.evaluate(() => pmBankSheet());
    await page.waitForFunction(() => !!document.getElementById('pm-stmt-file'), null, { timeout: 4000 }).catch(() => {});
    await page.setInputFiles('#pm-stmt-file', csvPath);
    await page.waitForFunction(() => /Review before it goes in/.test(document.getElementById('pm-sheet').textContent), null, { timeout: 8000 });
    const again = await sheet();
    ok(/Already here\s*8 · skipped/.test(again) && /Nothing new to add/.test(again) && await page.evaluate(() => document.querySelector('#pm-sheet [data-pms="save"]').disabled), 'the same file adds nothing');
    await shot('12-again');
    await page.evaluate(() => pmSheetClose());
    // ── a statement due ──
    S.imports.forEach((i) => { i.to = d(-45).slice(0, 8) + '28'; });
    await page.evaluate(() => pmBankLoad());
    await page.waitForTimeout(500);
    const L2 = await list();
    ok(/Time for .*statement/.test(L2), 'a due statement asks on the landing: ' + (L2.match(/Time for [^.]*statement/) || [''])[0]);
    await shot('13-due');

    // ── THE LIVE LINK ──
    // The connection is called "Open Banking" everywhere; the account stays "Monzo
    // Business", and the developer-client steps still say Monzo (it is what the owner
    // types into).
    await click('#pm-list [data-pm="bank"]');
    await page.waitForFunction(() => /Your bank/.test((document.getElementById('pm-detail') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
    ok(/Open Banking\s*Payments arrive by themselves/.test(await detail()) && await page.evaluate(() => !!document.querySelector('#pm-detail [data-pm="mz-setup"]')), 'the bank page offers the live link');
    await click('#pm-detail [data-pm="mz-setup"]');
    await page.waitForTimeout(400);
    let sh = await sheet();
    ok(/Create a client in Monzo/.test(sh) && /chb\.example\/monzo-callback\.php/.test(sh) && /Confidential/.test(sh), 'step 1 shows the redirect address to paste and asks for a confidential client');
    await shot('14-mz-create');
    await clickText('#pm-sheet', 'I’ve made it');
    // A FORM IS TYPED INTO ONLY AFTER IT HAS FOCUSED ITSELF: the sheet focuses its first
    // field on a timer, and under load that timer can fire mid-fill and pull the secret
    // into the client ID (the glassDialog lesson). Wait for the sheet's own focus.
    const sheetFocused = () => page.waitForFunction(() => document.activeElement && document.activeElement.id === 'pm-mz-id', null, { timeout: 6000 }).catch(() => {});
    await sheetFocused();
    await page.fill('#pm-mz-id', 'oauth2client_0000Abc');
    await page.fill('#pm-mz-secret', 'mnzpub.notconfidential');
    await clickText('#pm-sheet', 'Save');
    await page.waitForFunction(() => /isn’t confidential/.test(document.getElementById('pm-sheet').textContent), null, { timeout: 6000 }).catch(() => {});
    ok(/isn’t confidential/.test(await sheet()), 'a non-confidential client is refused in the server’s words');
    await sheetFocused(); // the refusal redraws the sheet, which focuses itself again
    await page.fill('#pm-mz-id', 'oauth2client_0000Abc');
    await page.fill('#pm-mz-secret', 'mnzconf.secret-value-123');
    await clickText('#pm-sheet', 'Save');
    await page.waitForFunction(() => /first five minutes/.test(document.getElementById('pm-sheet').textContent), null, { timeout: 6000 }).catch(() => {});
    sh = await sheet();
    ok(/Connect Open Banking/.test(sh) && /first five minutes/.test(sh), 'step 3 says what happens next, and why to approve at once');
    const saved = posts.filter((p) => p.__url === 'monzo.php' && p.action === 'save_client').pop();
    ok(saved && saved.client_secret === 'mnzconf.secret-value-123', 'the client is sent to be saved');
    await shot('15-mz-connect');
    await clickText('#pm-sheet', 'Connect Open Banking');
    await page.waitForURL(/auth\.monzo\.test/, { timeout: 6000 }).catch(() => {});
    ok(/auth\.monzo\.test\/\?client_id=oauth2client_0000Abc/.test(page.url()), 'Connect sends the owner to Monzo');
    // Back from Monzo (the callback page links to Payments): waiting for approval in the app.
    Object.assign(LIVE, { state: 'approve', say: 'Approve access in the Monzo app.', connected_at: Math.floor(Date.now() / 1000) });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await enterApp();
    await page.waitForFunction(() => /Approve in your banking app/.test((document.getElementById('pm-list') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
    const La = await list();
    ok(/Approve in your banking app/.test(La) && /In the bank\s*Waiting for approval/.test(La), 'the landing asks for approval in the app: Needs you, and the bank row');
    await click('#pm-list [data-pm="bank"]');
    await page.waitForTimeout(400);
    ok(/Approve in your banking app/.test(await detail()), 'the bank page says it is waiting');
    await shot('16-mz-approve');
    await page.waitForFunction(() => /live through Open Banking/.test(document.getElementById('pm-detail').textContent), null, { timeout: 15000 }).catch(() => {});
    ok(checks >= 2, 'it asks again by itself while waiting (' + checks + ' checks)');
    const dt2 = await detail();
    ok(/live through Open Banking/.test(dt2) && /Ending 4471/.test(dt2), 'approval lands: live, named by its last four digits');
    ok(/Balance now\s*£1,880\.25/.test(dt2) && /£2,511\.69 with pots/.test(dt2), 'Monzo’s own balance leads, with the pots beside it');
    ok(/Not needed/.test(dt2) && !/Remind me on the 1st/.test(dt2), 'while live, no statement is needed and no reminder is offered');
    await shot('17-mz-live');
    await page.evaluate(() => { const b = document.querySelector('#pm-detail [data-pm="close"]'); if (b && b.offsetParent) b.click(); });
    await page.waitForTimeout(400);
    const L3 = await list();
    ok(/In the bank\s*Live · \d+:\d\d/.test(L3) && !/Time for .*statement/.test(L3), 'the landing says live, and the due statement stands down: ' + (L3.match(/In the bank[^£]{0,40}/) || [''])[0]);
    await click('#pm-list [data-pm="bank"]');
    await page.waitForTimeout(400);
    await click('#pm-detail [data-pm="mz-sync"]');
    await page.waitForTimeout(600);
    ok(posts.some((p) => p.__url === 'monzo.php' && p.action === 'sync'), 'Sync asks Monzo for new payments');
    await click('#pm-detail [data-pm="mz-disconnect"]');
    await page.waitForTimeout(400);
    ok(/Disconnect Open Banking\?/.test(await page.evaluate(() => document.getElementById('glass-dialog-msg').textContent)), 'disconnecting asks first');
    await page.evaluate(() => document.getElementById('glass-dialog-ok').click());
    await page.waitForTimeout(800);
    ok(posts.some((p) => p.__url === 'monzo.php' && p.action === 'disconnect') && /Client saved · not connected/.test(await detail()), 'disconnected: the client stays for next time');
    // A person without full access sees the link but is offered no setup. The state is
    // read back from the server first (with no client, the owner IS offered setup), so
    // the absence below is the permission, not a state with no setup to offer.
    Object.assign(LIVE, { state: 'off', client: false });
    await page.evaluate(() => pmBankLoad());
    const offered = await page.evaluate(() => { pmRenderDetail(); return !!document.querySelector('#pm-detail [data-pm="mz-setup"]'); });
    ok(offered, 'with no client saved, full access is offered the setup (the control the next check withholds)');
    await page.evaluate(() => { window.__me = { full: false, caps: { money: true } }; pmRenderDetail(); });
    ok(!(await page.evaluate(() => !!document.querySelector('#pm-detail [data-pm="mz-setup"]'))) && /Open Banking/.test(await detail()), 'someone without full access sees the link but is offered no setup');
    await page.evaluate(() => { window.__me = null; });
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov <= 0, 'no sideways scroll (' + ov + ')');
    ok(!errors.length, 'no page errors ' + JSON.stringify(errors));
    console.log(fails ? `\n  ${fails} CHECK(S) FAILED ❌` : '\n  ALL STATEMENT CHECKS PASSED ✅');
    await done(fails);
})();
