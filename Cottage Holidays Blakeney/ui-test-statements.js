// ui-test-statements.js — the business bank on the Payments page, from the
// statements the owner exports (see CLAUDE.md "The business bank, from its
// statements"). statements.php is stubbed with state kept here, but the PARSING
// and the auto-sort are the real statement-lib.php run through the php CLI, so
// the screens see exactly what the server would send. The server itself is gated
// by test-statements.php and test-integration §53.
//
// Covers: the way in, the + menu, the add sheet (a PDF refused, the check, the
// receipt, one import carrying an op id), the bank page (the closing balance,
// what sorted itself, a suggestion per kind), recording a guest's transfer on the
// booking dated the day it arrived, an expense on its own date and linked, the
// next payment from that payee remembered, tax and a platform payout, the kind
// sheet, Undo of an expense, a recorded transfer offering Open rather than Undo,
// the reminder switch, Needs you, the same file adding nothing, and a due
// statement asking on the landing.
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
    const status = () => {
        const last = S.imports.slice().sort((a, b) => (a.to < b.to ? 1 : -1))[0] || null;
        const withBal = S.imports.filter((i) => i.balance != null).sort((a, b) => (a.balance_at < b.balance_at ? 1 : -1))[0];
        const toSort = S.lines.filter((l) => !l.as).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
        const sorted = S.lines.filter((l) => l.as).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
        const learnMap = {};
        S.lines.filter((l) => ['expense', 'platform', 'ignore', 'tax', 'income'].includes(l.as) && l.name).forEach((l) => { const k = l.name + '|' + l.as + '|' + l.label; learnMap[k] = { name: l.name, as: l.as, label: l.label }; });
        return {
            ok: true, ready: true, on: S.on, remind: S.remind,
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
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1300);
    await page.evaluate((th) => { isAuthenticated = true; document.body.classList.add('owner-mode'); if (th === 'light') document.body.classList.add('light-mode'); else document.body.classList.remove('light-mode'); squareAdminEnabled = true; }, theme);
    await page.evaluate(() => window.loadAdminBundle());
    await page.waitForTimeout(600);
    await page.evaluate(() => loadData());
    await page.waitForTimeout(600);
    await page.evaluate(() => openAccounts());
    await page.waitForTimeout(1500);
        const shot = async () => {};
    const list = () => page.evaluate(() => document.getElementById('pm-list').textContent.replace(/\s+/g, ' '));
    const detail = () => page.evaluate(() => (document.getElementById('pm-detail') || {}).textContent.replace(/\s+/g, ' '));
    const sheet = () => page.evaluate(() => document.getElementById('pm-sheet').textContent.replace(/\s+/g, ' '));
    const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s); e.click(); }, sel);
    const clickText = (scope, text) => page.evaluate(([sc, t]) => { const e = [...document.querySelectorAll(sc + ' button')].find((b) => b.textContent.trim() === t); if (!e) throw new Error('no button ' + t); e.click(); }, [scope, text]);

    await shot('1-landing');
    ok(/Add your Monzo Business statements/.test(await list()), 'the landing offers the way in');
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
    await page.waitForTimeout(500);
    await shot('2-export');
    ok(/Export a statement from Monzo Business/.test(await sheet()) && /6 Apr/.test(await sheet()), 'step 1 says how, from the start of the tax year');
    await clickText('#pm-sheet', 'I have the file');
    await page.waitForTimeout(300);
    await shot('3-add');
    await page.setInputFiles('#pm-stmt-file', { name: 'statement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await page.waitForTimeout(300);
    ok(/That’s a PDF/.test(await sheet()), 'a PDF is named for what it is');
    await page.setInputFiles('#pm-stmt-file', csvPath);
    await page.waitForFunction(() => /Check before it goes in/.test(document.getElementById('pm-sheet').textContent), null, { timeout: 8000 });
    await shot('4-check');
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
    await page.waitForTimeout(700);
    await shot('6-bank');
    let dt1 = await detail();
    ok(/Balance on .*£1,257\.06/.test(dt1), 'the bank page leads with the closing balance');
    ok(/To sort · 6/.test(dt1), 'six to sort');
    ok(/Marcus Hill owes .*reference is their booking/.test(dt1), 'the guest transfer is matched by its reference');
    ok(/Looks like cleaning/.test(dt1) && /Tax\. It isn’t a cottage cost/.test(dt1) && /A Airbnb payout|An Airbnb payout|Airbnb payout/.test(dt1), 'cleaning, tax and the platform payout each get a suggestion');
    ok(/Square payout/.test(dt1) && /To a pot/.test(dt1), 'the Square payout and the pot move sorted themselves');
    // ── record Marcus's transfer ──
    await clickText('#pm-detail', 'Record Marcus’s payment');
    await page.waitForTimeout(1200);
    const sp = posts.filter((p) => p.__url === 'bookings.php' && p.action === 'set_payment').pop();
    ok(sp && sp.payment === 'paid' && sp.payment_date === d(-11) && sp.payment_method === 'Bank transfer' && sp.op_id, 'recorded on the booking, dated the day it arrived: ' + JSON.stringify(sp));
    const mk1 = posts.filter((p) => p.__url === 'statements.php' && p.action === 'mark').pop();
    ok(mk1 && mk1.as === 'payment' && mk1.booking_id === 6, 'the line is linked to the booking');
    await page.evaluate(() => { const c = document.getElementById('glass-dialog-cancel'); if (c && c.offsetParent) c.click(); });
    await page.waitForTimeout(400);
    await shot('7-recorded');
    // ── add the cleaning as an expense ──
    dt1 = await detail();
    await clickText('#pm-detail', 'Add as Cleaning');
    await page.waitForTimeout(900);
    const ex = posts.filter((p) => p.__url === 'expenses.php' && p.action === 'add').pop();
    ok(ex && ex.category === 'Cleaning' && ex.amount === 72 && ex.date === d(-8) && ex.description === 'NORFOLK CLEAN CO', 'the expense is added on its own date: ' + JSON.stringify(ex));
    const mk2 = posts.filter((p) => p.__url === 'statements.php' && p.action === 'mark').pop();
    ok(mk2 && mk2.as === 'expense' && mk2.expense_id === 900, 'linked to the expense it made');
    dt1 = await detail();
    ok(/Cleaning, as last time/.test(dt1), 'the second payment to the same cleaner is remembered');
    await shot('8-learned');
    await clickText('#pm-detail', 'Leave it out');
    await page.waitForTimeout(500);
    await clickText('#pm-detail', 'That’s it');
    await page.waitForTimeout(500);
    const marks = posts.filter((p) => p.__url === 'statements.php' && p.action === 'mark');
    ok(marks.some((m) => m.as === 'tax') && marks.some((m) => m.as === 'platform' && m.label === 'Airbnb payout'), 'tax left out, the Airbnb payout noted');
    // ── something else: the category sheet ──
    await clickText('#pm-detail', 'An expense');
    await page.waitForTimeout(500);
    await shot('9-cat');
    ok(/What was £23\.10 for\?/.test(await sheet()), 'the category sheet names the figure');
    await page.evaluate(() => [...document.querySelectorAll('#pm-sheet [data-pms="cat"]')].find((b) => b.textContent === 'Supplies').click());
    await page.waitForTimeout(900);
    const ex2 = posts.filter((p) => p.__url === 'expenses.php' && p.action === 'add').pop();
    ok(ex2 && ex2.category === 'Supplies' && ex2.amount === 23.1, 'the chosen kind is added');
    // ── undo an expense ──
    const undoBtn = await page.evaluate(() => { const b = [...document.querySelectorAll('#pm-detail [data-pm="bank-undo"]')].find((x) => /Supplies/.test(x.closest('.pm-needrow').textContent)); if (b) b.click(); return !!b; });
    await page.waitForTimeout(900);
    const del = posts.filter((p) => p.__url === 'expenses.php' && p.action === 'delete').pop();
    ok(undoBtn && del && del.id === 901, 'Undo deletes the expense it made and puts the payment back to sort');
    ok(/TESCO/.test((await detail()).split('Sorted')[0]), '…and it is back to sort');
    // the recorded transfer offers its booking, never an undo that could double it
    ok(await page.evaluate(() => { const r = [...document.querySelectorAll('#pm-detail .pm-needrow')].find((x) => /M HILL/.test(x.textContent)); return !!r && !!r.querySelector('[data-pm="stay"]') && !r.querySelector('[data-pm="bank-undo"]'); }), 'a recorded transfer offers Open, not Undo');
    // ── the reminder switch ──
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
    ok(/Monzo Business\s*Statements up to/.test(L), 'the landing shows the account in one row');
    await shot('11-landing');
    // ── the same file again ──
    await page.evaluate(() => pmBankSheet());
    await page.waitForTimeout(400);
    await clickText('#pm-sheet', 'I have the file');
    await page.waitForTimeout(200);
    await page.setInputFiles('#pm-stmt-file', csvPath);
    await page.waitForFunction(() => /Check before it goes in/.test(document.getElementById('pm-sheet').textContent), null, { timeout: 8000 });
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
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov <= 0, 'no sideways scroll (' + ov + ')');
    ok(!errors.length, 'no page errors ' + JSON.stringify(errors));
    console.log(fails ? `\n  ${fails} CHECK(S) FAILED ❌` : '\n  ALL STATEMENT CHECKS PASSED ✅');
    await done(fails);
})();
