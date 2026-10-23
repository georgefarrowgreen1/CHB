#!/usr/bin/env node
// ============================================================
//  volume-test.js — the app on a five-year business, held to volume-budget.json
//  (dev only: the deploy strips *-test.js and *-budget.json).
//
//      node volume-test.js            measure, and compare with volume-budget.json
//      node volume-test.js --update   write volume-budget.json from this run
//
//  Every other gate runs on a handful of rows, so what five years of trading cost was
//  found by hand, one audit at a time (the booking list's 216 extra statements, the
//  2.3MB owner payload, the whole page restyled on every keystroke). This gate keeps
//  them found: it fills a database with test-volume-seed.php (1,400 bookings, 40,000
//  activity rows, 800 chats, 3,000 enquiries ...), serves the real app on it and
//  measures, for each read the screens make:
//    - the bytes it sends (and gzipped, as the host sends them),
//    - the statements it runs and the rows the database reads for it,
//    - how long it takes (a ceiling only: a loaded machine moves the time, not the count);
//  and in a browser: how many elements Today has on this much data, and how many each
//  of three small changes restyles there (a line of text, a class on one element, a row
//  added and taken away: ui-test-stylecost's changes, made here on a full Today); what a
//  refresh of Today works out and how often opening Payments writes its list, with each
//  one's main-thread time at 4x CPU (time x3, at least 2s: the counts hold the line). (What a
//  first visit fetches before the page shows depends on timing; it is measured where
//  that is the subject, not budgeted here.)
//
//  COUNTED PER DATABASE USER, never with the server-wide counter: the app connects as
//  its own user, and MariaDB's USER_STATISTICS (or MySQL's performance_schema) counts
//  that user's statements and rows alone, so a gate running beside this one cannot
//  move its numbers. (test-integration reads the server-wide counter, which is why
//  run-checks lets the database gates take turns.)
//
//  A BUDGET IS A CEILING WITH ROOM, measured and then written by --update: bytes and
//  rows read +10%, statements +2, time x5 and at least a second (a ceiling for a
//  regression of several times over, not a timing gate). Lower a budget when a change
//  brings a figure down (the run says so), and never raise one to get green without
//  saying in the PR what got bigger and why.
//
//  Environment: CHB_IT_DB_HOST/PORT/USER/PASS (root, as test-integration.php), and
//  CHB_VOLUME_DB for the database name (default chb_volume; dropped and made again on
//  every run). CHB_CHROMIUM points at a Chromium if Playwright's own is not installed.
// ============================================================
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const APP = __dirname;
const UPDATE = process.argv.includes('--update');
const BUDGET_PATH = path.join(APP, 'volume-budget.json');
const ROOT_DB = {
    host: process.env.CHB_IT_DB_HOST || '127.0.0.1',
    port: Number(process.env.CHB_IT_DB_PORT || 3306),
    user: process.env.CHB_IT_DB_USER || 'root',
    pass: process.env.CHB_IT_DB_PASS !== undefined ? process.env.CHB_IT_DB_PASS : 'root',
};
const NAME = /^[a-z0-9_]{1,40}$/.test(process.env.CHB_VOLUME_DB || '') ? process.env.CHB_VOLUME_DB : 'chb_volume';
const APP_USER = NAME.slice(0, 32);
const APP_PASS = 'volume-db-pass-7c1e';
const SECRET = 'chb-volume-secret-0123456789abcdef';
const OWNER_PASS = 'volume-pass-123'; // test-volume-seed.php's VS_PASSWORD

let fails = 0;
const ok = (b, m) => {
    console.log(`  ${b ? '✓' : '✗'} ${m}`);
    if (!b) fails++;
};
const fatal = (m) => {
    console.error('✗ ' + m);
    cleanup();
    process.exit(1);
};

// ---- the database, through PHP's PDO (php is here whatever else is) ----------
function sql(query, user = ROOT_DB.user, pass = ROOT_DB.pass) {
    const code = `$p = new PDO("mysql:host=" . getenv("H") . ";port=" . getenv("P"), getenv("U"), getenv("W"), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); $out = []; foreach (preg_split('/;\\s*\\n/', getenv("Q")) as $q) { if (trim($q) === '') continue; $st = $p->query($q); $out = $st->columnCount() ? $st->fetchAll(PDO::FETCH_ASSOC) : $out; } echo json_encode($out);`;
    const r = spawnSync('php', ['-r', code], { encoding: 'utf8', env: { ...process.env, H: ROOT_DB.host, P: String(ROOT_DB.port), U: user, W: pass, Q: query }, timeout: 60000 });
    if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').trim().slice(0, 300));
    return JSON.parse(r.stdout || '[]');
}

let server = null;
let work = '';
let restoreUserstat = null;
let made = false;
function cleanup() {
    try { if (server) server.kill('SIGKILL'); } catch (e) {}
    try { if (work) fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
    try { if (restoreUserstat !== null) sql(`SET GLOBAL userstat=${restoreUserstat}`); } catch (e) {}
    // The database and its user go with the run, as test-integration's do.
    try { if (made) sql([`DROP DATABASE IF EXISTS \`${NAME}\``, ...['localhost', '127.0.0.1'].map((h) => `DROP USER IF EXISTS '${APP_USER}'@'${h}'`)].join(';\n')); } catch (e) {}
    made = false;
}
process.on('exit', cleanup);

const freePort = () => new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

(async () => {
    const t0 = Date.now();
    // 1. The database: empty, its own user, the schema.
    let version;
    try {
        version = sql('SELECT VERSION() AS v')[0].v;
    } catch (e) {
        fatal(`cannot reach MySQL at ${ROOT_DB.host}:${ROOT_DB.port} as ${ROOT_DB.user}: ${e.message}`);
    }
    const maria = /mariadb/i.test(version);
    sql([
        `DROP DATABASE IF EXISTS \`${NAME}\``,
        `CREATE DATABASE \`${NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        ...['localhost', '127.0.0.1'].flatMap((h) => [
            `CREATE USER IF NOT EXISTS '${APP_USER}'@'${h}' IDENTIFIED BY '${APP_PASS}'`,
            `ALTER USER '${APP_USER}'@'${h}' IDENTIFIED BY '${APP_PASS}'`,
            `GRANT ALL PRIVILEGES ON \`${NAME}\`.* TO '${APP_USER}'@'${h}'`,
        ]),
    ].join(';\n'));
    made = true;
    const schema = spawnSync('php', ['-r', `require 'migrate.php'; $p = new PDO("mysql:host=" . getenv("H") . ";port=" . getenv("P") . ";dbname=" . getenv("D"), getenv("U"), getenv("W"), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); $n = 0; foreach (split_sql('schema.sql') as $s) { $p->exec($s); $n++; } echo $n;`], { cwd: APP, encoding: 'utf8', env: { ...process.env, H: ROOT_DB.host, P: String(ROOT_DB.port), D: NAME, U: ROOT_DB.user, W: ROOT_DB.pass } });
    if (schema.status !== 0) fatal('schema.sql did not apply: ' + (schema.stderr || schema.stdout).slice(0, 300));

    // 2. A copy of the app on that database, served by php -S. The models (darkstar,
    // the encoder) stay behind: nothing measured here loads them.
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'chb-volume-'));
    const KEEP_ONLY_GUARDS = /^(uploads|sessions|backups)\//;
    fs.cpSync(APP, work, {
        recursive: true,
        filter: (src) => {
            const rel = path.relative(APP, src).split(path.sep).join('/');
            if (!rel) return true;
            if (/^(node_modules|layout-shots|\.phpstan-cache)(\/|$)/.test(rel) || /\.(bin|onnx)$/.test(rel)) return false;
            if (KEEP_ONLY_GUARDS.test(rel)) return !/\/[^/]+\.[^/]+$/.test(rel) || /\/(\.htaccess|README\.txt|\.gitignore)$/.test(rel);
            return true;
        },
    });
    let cfg = fs.readFileSync(path.join(work, 'config.php'), 'utf8');
    const host = ROOT_DB.port === 3306 ? ROOT_DB.host : `${ROOT_DB.host};port=${ROOT_DB.port}`;
    for (const [k, v] of Object.entries({ DB_HOST: host, DB_NAME: NAME, DB_USER: APP_USER, DB_PASS: APP_PASS, APP_SECRET: SECRET })) {
        const before = cfg;
        cfg = cfg.replace(new RegExp(`define\\('${k}',\\s*'[^']*'\\)`), `define('${k}', '${v}')`);
        if (cfg === before) fatal(`config.php has no define('${k}', ...) to set`);
    }
    cfg = cfg.replace(/define\('MAIL_ENABLED',\s*\w+\)/, "define('MAIL_ENABLED', false)").replace(/define\('SQUARE_PAYMENTS_ENABLED',\s*\w+\)/, "define('SQUARE_PAYMENTS_ENABLED', false)");
    fs.writeFileSync(path.join(work, 'config.php'), cfg);
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    // Four workers, as a host serves the browser's requests side by side.
    server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', work], { stdio: 'ignore', env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4' } });
    for (let i = 0; i < 80; i++) {
        try { const r = await fetch(base + '/robots.txt'); await r.arrayBuffer(); if (r.ok) break; } catch (e) {}
        await new Promise((r) => setTimeout(r, 150));
    }

    // 3. The app's own migrations, then five years of business.
    const mig = await (await fetch(`${base}/migrate.php?cron=${SECRET}`)).json().catch(() => null);
    const errs = ((mig && mig.migrations) || []).filter((m) => m.status === 'ERROR');
    if (!mig || errs.length) fatal('migrate.php did not apply cleanly: ' + JSON.stringify(errs[0] || mig).slice(0, 300));
    const seed = spawnSync('php', ['test-volume-seed.php', NAME], { cwd: APP, encoding: 'utf8', env: process.env, timeout: 300000 });
    let seeded = null;
    try { seeded = JSON.parse(seed.stdout.trim().split('\n').pop()); } catch (e) {}
    if (seed.status !== 0 || !seeded || !seeded.ok) fatal('the seed failed: ' + (seed.stderr || seed.stdout).slice(-400));
    // One night of the daily jobs, as production has had: the analytics roll-up sums
    // the finished days, and the prunes leave what a night leaves. Without it the
    // Analytics page counted every raw page view (77 statements, 900,000 rows read).
    // The roll-up runs one at a time on the whole SERVER (a named lock), so a run
    // beside another one can find it busy and sum nothing: asked again until it has.
    for (let i = 0; ; i++) {
        const night = await fetch(`${base}/self-repair.php?cron=${SECRET}`);
        const nightBody = await night.text();
        if (night.status !== 200) fatal('the daily jobs did not run: ' + night.status + ' ' + nightBody.slice(0, 200));
        if (sql(`SELECT through_day FROM \`${NAME}\`.pv_rollup WHERE id = 1 AND through_day IS NOT NULL`).length) break;
        if (i === 10) fatal("the analytics roll-up summed nothing: another run on this database server holds its lock ('chb_pv_rollup'); run one at a time");
        await new Promise((r) => setTimeout(r, 3000));
    }
    const c = seeded.counts;
    console.log(`== A five-year business: ${c.bookings} bookings, ${c.payments} payments, ${c.activity_log} activity rows, ${c.messages} chat messages, ${c.enquiries} enquiries, ${c.bank_lines} bank lines, ${c.pageviews} page views (seeded from ${seeded.today}) ==`);
    ok(c.bookings > 1000 && c.activity_log > 30000 && c.pageviews > 40000, 'the seed made a business of the size it says (vacuity guard)');

    // 4. Counting one database user's work.
    let counter;
    if (maria) {
        restoreUserstat = Number(sql("SHOW GLOBAL VARIABLES LIKE 'userstat'")[0].Value === 'ON');
        sql('SET GLOBAL userstat=1');
        counter = () => {
            const r = sql(`SELECT SELECT_COMMANDS + UPDATE_COMMANDS + OTHER_COMMANDS AS q, ROWS_READ AS r FROM information_schema.USER_STATISTICS WHERE USER = '${APP_USER}'`)[0];
            return r ? { q: Number(r.q), r: Number(r.r) } : { q: 0, r: 0 };
        };
    } else {
        counter = () => {
            const r = sql(`SELECT COALESCE(SUM(COUNT_STAR), 0) AS q, COALESCE(SUM(SUM_ROWS_EXAMINED), 0) AS r FROM performance_schema.events_statements_summary_by_user_by_event_name WHERE USER = '${APP_USER}'`)[0];
            return { q: Number(r.q), r: Number(r.r) };
        };
    }
    // A request's counts land when its connection's statements finish; the answer can
    // arrive a moment before the last of them is counted, so wait until it settles.
    const settled = async () => {
        let a = counter();
        for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 40));
            const b = counter();
            if (b.q === a.q && b.r === a.r) return b;
            a = b;
        }
        return a;
    };

    // 5. HTTP with a cookie jar, as a browser sends it.
    const jars = { visitor: {}, owner: {}, guest: {} };
    const call = async (who, method, url, body) => {
        const jar = jars[who];
        const headers = { Accept: 'application/json' };
        const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookie) headers.Cookie = cookie;
        if (method === 'POST' && jar.csrf) headers['X-CSRF-Token'] = jar.csrf;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const t = process.hrtime.bigint();
        const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
        const buf = Buffer.from(await res.arrayBuffer());
        const ms = Number(process.hrtime.bigint() - t) / 1e6;
        for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
            const m = /^([^=;]+)=([^;]*)/.exec(sc);
            if (m) jar[m[1].trim()] = m[2].trim();
        }
        return { status: res.status, buf, ms, json: (() => { try { return JSON.parse(buf.toString('utf8')); } catch (e) { return null; } })() };
    };
    const login = await call('owner', 'POST', '/auth.php', { action: 'admin_login', username: 'owner', password: OWNER_PASS });
    if (login.status !== 200 || !(login.json && login.json.ok)) fatal('the owner could not sign in: ' + login.buf.toString().slice(0, 200));
    const guestEmail = sql(`SELECT g.email FROM \`${NAME}\`.guests g JOIN \`${NAME}\`.bookings b ON b.email = g.email WHERE g.email_verified_at IS NOT NULL GROUP BY g.email ORDER BY COUNT(*) DESC, g.email LIMIT 1`)[0].email;
    const glogin = await call('guest', 'POST', '/auth.php', { action: 'guest_login', email: guestEmail, password: OWNER_PASS });
    if (glogin.status !== 200) fatal('the guest could not sign in: ' + glogin.buf.toString().slice(0, 200));

    // What each screen reads. The owner's boot is asked twice: as a first visit, and
    // naming the parts it holds (what every later visit sends).
    const boot = await call('owner', 'GET', '/admin-bootstrap.php');
    const have = Object.entries((boot.json && boot.json.hashes) || {}).map(([k, h]) => `${k}.${h}`).join(',');
    const READS = [
        ['visitor boot', 'visitor', 'GET', '/bootstrap.php'],
        ['visitor availability', 'visitor', 'GET', '/availability.php?all=1'],
        ['visitor all reviews', 'visitor', 'GET', '/reviews.php?all=1'],
        // The page itself: home.php writes the first screen from the live list, the content it
        // names and every review's figures (CLAUDE.md, "The page before the script").
        ['visitor home page', 'visitor', 'GET', '/home.php'],
        ['owner boot', 'owner', 'GET', '/admin-bootstrap.php'],
        ['owner boot, parts held', 'owner', 'GET', '/admin-bootstrap.php?have=' + encodeURIComponent(have)],
        ['owner settings', 'owner', 'POST', '/content.php', { action: 'get_all' }],
        ['owner chat list', 'owner', 'POST', '/messages.php', { action: 'threads' }],
        ['owner email log', 'owner', 'POST', '/bookings.php', { action: 'email_logs' }],
        ['owner Payments', 'owner', 'POST', '/money.php', { action: 'summary' }],
        ['owner analytics', 'owner', 'GET', '/track.php?action=summary&days=30'],
        ['owner activity log', 'owner', 'POST', '/activity-log.php', { action: 'list', category: 'all', q: '', limit: 150 }],
        ['owner activity week', 'owner', 'POST', '/activity-log.php', { action: 'summary' }],
        // Manage → Status, which now reads the week of real visitors' figures (perf-lib.php).
        ['owner Status', 'owner', 'POST', '/diagnostics.php', { action: 'run' }],
        ['owner guest list', 'owner', 'POST', '/auth.php', { action: 'guest_crm' }],
        ['owner search', 'owner', 'POST', '/search.php', { q: 'smith' }],
        ['guest stays', 'guest', 'GET', '/my-bookings.php'],
    ];
    const measured = {};
    for (const [label, who, method, url, body] of READS) {
        const runs = [];
        for (let i = 0; i < 3; i++) {
            const before = await settled();
            const r = await call(who, method, url, body);
            const after = await settled();
            runs.push({ ...r, q: after.q - before.q, rows: after.r - before.r });
        }
        const last = runs[runs.length - 1];
        if (last.status !== 200) { ok(false, `${label}: answered ${last.status} ${last.buf.toString().slice(0, 120)}`); continue; }
        measured[label] = {
            bytes: last.buf.length,
            gz: zlib.gzipSync(last.buf, { level: 6 }).length,
            // The least of three: a write the first visit makes (a last-seen stamp) is
            // not what every visit costs.
            statements: Math.min(...runs.map((x) => x.q)),
            rowsRead: Math.min(...runs.map((x) => x.rows)),
            ms: Math.round(runs.map((x) => x.ms).sort((a, b) => a - b)[1]),
        };
    }

    // 5b. The lists that grow with the years, after one change. A page holding a copy names
    // its buckets and gets back only the bucket that changed (db.php held_list); each
    // read is asked three times with the same claim, so each run is the same delta.
    const db = '`' + NAME + '`';
    const someBooking = Number(sql(`SELECT id FROM ${db}.bookings ORDER BY id DESC LIMIT 1 OFFSET 40`)[0].id);
    const someThread = Number(sql(`SELECT t.id FROM ${db}.chat_threads t WHERE t.archived = 0 AND EXISTS (SELECT 1 FROM ${db}.messages m WHERE m.thread_id = t.id) ORDER BY t.id LIMIT 1 OFFSET 100`)[0].id);
    const claimOf = (j) => (j && j.bh && j.bs ? `${j.bs}:${Object.keys(j.bh).map((k) => `${k}.${j.bh[k]}`).join(',')}` : '');
    const noteFor = (id) => `INSERT INTO ${db}.activity_log (actor, category, action, summary, entity, entity_id, meta, created_at) VALUES ('owner', 'comms', 'comms.message', 'Volume note', 'booking', '${id}', '{"subject":"Volume","body":"Hello"}', NOW())`;
    const CHANGED = [
        ['owner boot, one booking changed', async () => {
            const j = (await call('owner', 'GET', '/admin-bootstrap.php')).json || {};
            sql(`UPDATE ${db}.bookings SET notes = CONCAT(COALESCE(notes, ''), ' .') WHERE id = ${someBooking}`);
            // Naming every part it holds, as the page does.
            const have = Object.entries(j.hashes || {}).map(([k, h]) => `${k}.${h}`).join(',');
            return ['GET', '/admin-bootstrap.php?have=' + encodeURIComponent(have) + '&haveb=' + encodeURIComponent(claimOf(j.bookings)), undefined, (r) => !!(r.json && r.json.bookings && r.json.bookings.delta === true)];
        }],
        ['owner email log, one email sent', async () => {
            const j = (await call('owner', 'POST', '/bookings.php', { action: 'email_logs' })).json || {};
            sql(noteFor(someBooking));
            return ['POST', '/bookings.php', { action: 'email_logs', have: j.h, haveb: claimOf(j) }, (r) => !!(r.json && r.json.delta === true)];
        }],
        ['owner chat list, one message', async () => {
            const j = (await call('owner', 'POST', '/messages.php', { action: 'threads' })).json || {};
            sql(`INSERT INTO ${db}.messages (thread_id, sender_role, body, read_by_admin, read_by_guest, created_at) VALUES (${someThread}, 'guest', 'One more question', 0, 0, NOW())`);
            return ['POST', '/messages.php', { action: 'threads', have: j.h, haveb: claimOf(j) }, (r) => !!(r.json && r.json.delta === true)];
        }],
    ];
    for (const [label, prep] of CHANGED) {
        const [method, url, body, isDelta] = await prep();
        const runs = [];
        for (let i = 0; i < 3; i++) {
            const before = await settled();
            const r = await call('owner', method, url, body);
            const after = await settled();
            runs.push({ ...r, q: after.q - before.q, rows: after.r - before.r });
        }
        const last = runs[runs.length - 1];
        if (last.status !== 200 || !isDelta(last)) { ok(false, `${label}: no delta came back (${last.status} ${last.buf.toString().slice(0, 120)})`); continue; }
        measured[label] = {
            bytes: last.buf.length,
            gz: zlib.gzipSync(last.buf, { level: 6 }).length,
            statements: Math.min(...runs.map((x) => x.q)),
            rowsRead: Math.min(...runs.map((x) => x.rows)),
            ms: Math.round(runs.map((x) => x.ms).sort((a, b) => a - b)[1]),
        };
    }

    // 6. In a browser: Today on this much data.
    let chromium;
    try { ({ chromium } = require('playwright')); } catch (e) { fatal('playwright is not installed here (npm install playwright)'); }
    const browser = await chromium.launch(process.env.CHB_CHROMIUM ? { executablePath: process.env.CHB_CHROMIUM } : {});
    try {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await ctx.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
        await ctx.addCookies(Object.entries(jars.owner).map(([name, value]) => ({ name, value, url: base })));
        const page = await ctx.newPage();
        await page.goto(base + '/index.html');
        await page.waitForFunction(() => document.body.classList.contains('owner-mode') && document.querySelectorAll('#bookings-list .bk-row').length > 0, null, { timeout: 60000 });
        await page.waitForTimeout(2500);
        const cdp = await ctx.newCDPSession(page);
        const events = [];
        cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
        const restyled = async (fn) => {
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
        // The changes the app makes all day. Each REPLACES or adds nodes, as the app's
        // renders do: editing a text node's data in place changes no element, so the
        // :has() rules this exists for never even look (measured: with the old
        // whole-page rules put back, an in-place edit stayed under the limit, while
        // replacing the text restyled 5,916 elements).
        const CHANGES = {
            restyledByText: () => {
                const all = [...document.querySelectorAll('.page-view.active *')].filter((e) => e.childNodes.length === 1 && e.firstChild.nodeType === 3 && e.firstChild.data.trim() && e.getClientRects().length);
                const el = all[Math.floor(all.length / 2)];
                const t = el.textContent;
                el.textContent = t + ' ';
                void document.body.offsetHeight;
                el.textContent = t;
                void document.body.offsetHeight;
            },
            restyledByClass: () => {
                const all = document.querySelectorAll('.page-view.active div, .page-view.active span');
                const el = all[Math.floor(all.length / 2)];
                for (const c of ['active', 'open']) {
                    el.classList.add(c);
                    void getComputedStyle(el).color;
                    el.classList.remove(c);
                    void getComputedStyle(el).color;
                }
            },
            restyledByRow: () => {
                const host = document.querySelector('.page-view.active') || document.body;
                const row = document.createElement('div');
                row.textContent = 'row';
                host.appendChild(row);
                void getComputedStyle(row).color;
                row.remove();
                void document.body.offsetHeight;
            },
        };
        const today = { elements: await page.evaluate(() => document.getElementsByTagName('*').length) };
        for (const [k, fn] of Object.entries(CHANGES)) today[k] = await restyled(fn);
        measured['Today in a browser'] = today;

        // THE BACK OFFICE ON FIVE YEARS OF SUMS (CLAUDE.md "The back office stops redoing
        // five years of sums"), counted: what one refresh of Today works out (a booking's
        // money once per load, it was nine times over) and how often it builds the duty
        // list; how often opening Payments writes its list (once per answer, it was five
        // to seven) and how often a second visit with nothing changed does (none); how
        // often Today at rest restyles the page (a box-shadow pulse did it every frame).
        // And the main thread's time for a refresh and an opening at 4x CPU: a ceiling
        // with room, the counts being what holds the line.
        await page.evaluate(() => {
            const W = /** @type {any} */ (window);
            W.__n = {};
            for (const name of ['bookingDueNow', 'paymentSummaryNow', 'damageHeldNow', 'chbDutiesAll']) {
                const f = W[name];
                W[name] = function (...a) { W.__n[name] = (W.__n[name] || 0) + 1; return f.apply(this, a); };
            }
            const real = W.pmLoad;
            W.pmLoad = function (...a) {
                W.__pmIdle = false;
                const pr = real.apply(this, a);
                W.__pmLast = pr;
                Promise.resolve(pr).finally(() => { if (W.__pmLast === pr) W.__pmIdle = true; });
                return pr;
            };
            W.__writes = 0;
            new MutationObserver((recs) => { if (recs.some((r) => r.addedNodes.length || r.removedNodes.length)) W.__writes++; })
                .observe(document.getElementById('pm-list'), { childList: true });
        });
        await cdp.send('Performance.enable');
        const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
        const pause = (ms) => new Promise((r) => setTimeout(r, ms));
        const work = async (fn, payments) => {
            await page.evaluate(() => { const W = /** @type {any} */ (window); W.__n = {}; W.__writes = 0; W.__pmIdle = undefined; });
            const a = await metric();
            await page.evaluate(fn);
            if (payments) await page.waitForFunction(() => /** @type {any} */ (window).__pmIdle === true, null, { timeout: 60000 }).catch(() => {});
            await pause(payments ? 1500 : 3000);
            const b = await metric();
            const got = await page.evaluate(() => ({ n: /** @type {any} */ (window).__n, writes: /** @type {any} */ (window).__writes }));
            return { taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000), ...got };
        };
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        let backOffice;
        try {
            await page.evaluate(() => nav('view-backoffice'));
            await pause(3000);
            const t = await work(() => initBackOffice(), false);
            const p1 = await work(() => openAccounts(), true);
            await page.evaluate(() => nav('view-backoffice'));
            await pause(4000);
            const p2 = await work(() => openAccounts(), true);
            await page.evaluate(() => nav('view-backoffice'));
            await pause(4000); // past Today's arrival animation
            const r0 = await metric();
            await pause(2000);
            const r1 = await metric();
            const money = (n) => (n.bookingDueNow || 0) + (n.paymentSummaryNow || 0) + (n.damageHeldNow || 0);
            backOffice = {
                todayMoney: money(t.n),
                dutyBuilds: t.n.chbDutiesAll || 0,
                paymentsWrites: p1.writes,
                paymentsRepeatWrites: p2.writes,
                restyledAtRest: Math.round(r1.RecalcStyleCount - r0.RecalcStyleCount),
                todayTaskMs: t.taskMs,
                paymentsTaskMs: p1.taskMs,
            };
        } finally {
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        }
        measured['The back office on five years'] = backOffice;

        // THE PAGE'S OWN MERGE, on five years of data: each list after a change, made from
        // the copy it held and the buckets that came back, is the list a fresh ask returns,
        // row for row and in the same order (the order is the page's to restore).
        const deltas = [];
        const onResp = async (resp) => {
            if (!/admin-bootstrap\.php\?have=|bookings\.php|messages\.php/.test(resp.url())) return;
            try {
                if (/"delta":true/.test(await resp.text())) deltas.push(resp.url().replace(base, ''));
            } catch (e) {}
        };
        page.on('response', onResp);
        await page.evaluate(() => Promise.all([apiPostHeld('email_logs', 'bookings.php', { action: 'email_logs' }), apiPostHeld('threads:0', 'messages.php', { action: 'threads', archived: 0 })]));
        sql(`UPDATE ${db}.bookings SET notes = CONCAT(COALESCE(notes, ''), ' ..') WHERE id = ${someBooking - 3}`);
        sql(noteFor(someBooking - 3));
        sql(`INSERT INTO ${db}.messages (thread_id, sender_role, body, read_by_admin, read_by_guest, created_at) VALUES (${someThread}, 'guest', 'And another', 0, 0, NOW())`);
        const merged = await page.evaluate(async () => {
            const ab = await abFetch();
            const full = await apiGet('admin-bootstrap.php');
            const logs = await apiPostHeld('email_logs', 'bookings.php', { action: 'email_logs' });
            const logsFull = await apiPost('bookings.php', { action: 'email_logs' });
            const threads = await apiPostHeld('threads:0', 'messages.php', { action: 'threads', archived: 0 });
            const threadsFull = await apiPost('messages.php', { action: 'threads', archived: 0 });
            const same = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
            return {
                bookings: same(ab && ab.bookings && ab.bookings.bookings, full && full.bookings && full.bookings.bookings),
                nBookings: ab && ab.bookings && Array.isArray(ab.bookings.bookings) ? ab.bookings.bookings.length : -1,
                logs: same(logs && logs.logs, logsFull && logsFull.logs),
                threads: same(threads && threads.threads, threadsFull && threadsFull.threads),
            };
        });
        await new Promise((r) => setTimeout(r, 300));
        page.off('response', onResp);
        const came = (re) => deltas.some((u) => re.test(u));
        ok(merged.bookings && came(/admin-bootstrap/), `the page's merge: the bookings after one changed are the ${merged.nBookings} a fresh ask returns, in its order (a delta came: ${came(/admin-bootstrap/)})`);
        ok(merged.logs && came(/bookings\.php/), `…the email log after one email, likewise (a delta came: ${came(/bookings\.php/)})`);
        ok(merged.threads && came(/messages\.php/), `…the chat list after one message, likewise (a delta came: ${came(/messages\.php/)})`);
        await ctx.close();

        // A VISITOR'S PAGE ON FIVE YEARS OF REVIEWS: sent the figures and the reviews on
        // screen (reviews.php reviews_summary), each cottage card states the figures of the
        // whole list "Read all" fetches, and "Read all" shows that whole list.
        const allRev = (await call('visitor', 'GET', '/reviews.php?all=1')).json;
        const revList = allRev && Array.isArray(allRev.list) ? allRev.list : [];
        const byProp = {};
        for (const r of revList) {
            const p = r.prop || '';
            byProp[p] = byProp[p] || [0, 0];
            byProp[p][0]++;
            byProp[p][1] += Math.max(1, Math.min(5, parseInt(r.stars) || 5));
        }
        const vctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await vctx.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
        const vpage = await vctx.newPage();
        await vpage.goto(base + '/index.html');
        await vpage.waitForFunction(() => /review/.test((document.querySelector('[id^="card-rating-"]') || {}).textContent || ''), null, { timeout: 60000 });
        const cards = await vpage.evaluate(() => Object.fromEntries([...document.querySelectorAll('[id^="card-rating-"]')].map((e) => [e.id.slice('card-rating-'.length), e.textContent.replace(/\s+/g, ' ').trim()])));
        const wrong = Object.entries(cards).filter(([k, t]) => {
            const f = byProp[k];
            return t !== (f ? `★ ${(f[1] / f[0]).toFixed(1)} · ${f[0]} review${f[0] === 1 ? '' : 's'}` : 'New · no reviews yet');
        });
        ok(revList.length > 100 && Object.keys(cards).length > 0 && !wrong.length, `a visitor's cottage cards state the figures of all ${revList.length} reviews${wrong.length ? ' — wrong: ' + JSON.stringify(wrong) : ''}`);
        const pk = Object.keys(cards).filter((k) => byProp[k]).sort((a, b) => byProp[b][0] - byProp[a][0])[0];
        const shown = pk
            ? await vpage.evaluate(async (k) => {
                  openProperty(k);
                  openAllReviews(k);
                  for (let i = 0; i < 200 && document.querySelector('#reviews-modal-list .reviews-more'); i++) await new Promise((r) => setTimeout(r, 50));
                  return document.querySelectorAll('#reviews-modal-list .review-card').length;
              }, pk)
            : -1;
        ok(!!pk && shown === byProp[pk][0], `…and "Read all" on ${pk} shows every one of its ${pk ? byProp[pk][0] : 0} (${shown})`);
        await vctx.close();

        // THE PAGE BEFORE THE SCRIPT, end to end: a first visit to the real home.php on five
        // years of data. The script keeps the server's cards only while they are what it would
        // write itself, so this is the server's page and the script's agreeing on real data.
        const hctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await hctx.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
        const hpage = await hctx.newPage();
        await hpage.goto(base + '/home.php');
        await hpage.waitForFunction(() => window.__chbTaken === true && typeof __contentLoaded !== 'undefined' && __contentLoaded === true, null, { timeout: 60000 });
        const kept = await hpage.evaluate(() => {
            const g = document.getElementById('home-cottages-grid');
            const first = g.firstElementChild;
            renderHomeCottages();
            return { early: document.documentElement.classList.contains('chb-early'), keys: g.getAttribute('data-ssr-keys'), live: liveCottageKeys().join(','), kept: first === g.firstElementChild && typeof g.__chbCards === 'string' };
        });
        ok(kept.early && kept.keys === kept.live && kept.kept, `a first visit to home.php is shown before the script, and the script keeps the server's cards as its own (${JSON.stringify(kept)})`);
        await hctx.close();
    } finally {
        await browser.close();
    }

    // 7. Against the budget. One rule for the room a measured figure is given, used by
    // --update to write the budget and by the check to say when a figure came down.
    const room = { bytes: (n) => Math.ceil(n * 1.1), gz: (n) => Math.ceil(n * 1.1), statements: (n) => n + 2, rowsRead: (n) => Math.ceil(n * 1.1 + 20), ms: (n) => Math.max(1000, n * 5), elements: (n) => Math.ceil(n * 1.1), restyledByText: () => 40, restyledByClass: () => 40, restyledByRow: () => 40, todayMoney: (n) => Math.ceil(n * 1.1 + 20), dutyBuilds: (n) => n + 2, paymentsWrites: (n) => n + 1, paymentsRepeatWrites: (n) => n + 1, restyledAtRest: (n) => Math.max(10, n * 2), todayTaskMs: (n) => Math.max(2000, Math.ceil(n * 3)), paymentsTaskMs: (n) => Math.max(2000, Math.ceil(n * 3)) };
    if (UPDATE) {
        const out = { comment: 'Ceilings for volume-test.js, written by `node volume-test.js --update` from a run with headroom: bytes and rows +10%, statements +2, time x5 (at least 1s), each small change at most 40 restyled elements. Lower a figure when a change brings it down; never raise one to get green without saying in the PR what grew and why.', engine: maria ? 'mariadb' : 'mysql', measuredOn: seeded.today };
        for (const [label, m] of Object.entries(measured)) {
            out[label] = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, room[k] ? room[k](v) : v]));
        }
        fs.writeFileSync(BUDGET_PATH, JSON.stringify(out, null, 2) + '\n');
        console.log('volume-budget.json written from this run:');
        for (const [label, m] of Object.entries(measured)) console.log(`  ${label}: ${JSON.stringify(m)}`);
        process.exit(0);
    }
    let budget;
    try { budget = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8')); } catch (e) { fatal('volume-budget.json is missing or unreadable: write it with node volume-test.js --update'); }
    const fmt = (k, v) => (k === 'bytes' || k === 'gz' ? `${(v / 1024).toFixed(1)}KB` : k === 'ms' || /Ms$/.test(k) ? `${v}ms` : String(v));
    const nudges = [];
    for (const [label, m] of Object.entries(measured)) {
        const b = budget[label];
        if (!b) { ok(false, `${label}: no budget (node volume-test.js --update): ${Object.entries(m).map(([k, v]) => `${k} ${fmt(k, v)}`).join(', ')}`); continue; }
        const over = [];
        for (const [k, v] of Object.entries(m)) {
            if (k === 'rowsRead' && budget.engine !== (maria ? 'mariadb' : 'mysql')) continue; // rows are counted differently by the other engine
            if (b[k] === undefined) continue;
            if (v > b[k]) over.push(`${k} ${fmt(k, v)} over ${fmt(k, b[k])}`);
            // Came down: the budget this run would write is below the one stored, by a
            // statement, or by a tenth for the figures that wobble.
            else if (k !== 'ms' && !/Ms$/.test(k) && !k.startsWith('restyled') && room[k](v) < (k === 'statements' ? b[k] : b[k] * 0.9)) nudges.push(`${label} ${k}: ${fmt(k, b[k])} → ${fmt(k, room[k](v))}`);
        }
        ok(!over.length, `${label}: ${Object.entries(m).map(([k, v]) => `${k} ${fmt(k, v)}`).join(', ')}${over.length ? ' — ' + over.join('; ') : ''}`);
    }
    if (nudges.length) {
        console.log('\n  Nice — these came down. Lock the win in (node volume-test.js --update, then check the diff):');
        nudges.forEach((n) => console.log('    • ' + n));
    }
    console.log(`\n  ${fails ? `${fails} FIGURE(S) OVER BUDGET ❌` : 'within budget ✅'}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    process.exit(fails ? 1 : 0);
})().catch((e) => fatal(e && e.stack ? e.stack : String(e)));
