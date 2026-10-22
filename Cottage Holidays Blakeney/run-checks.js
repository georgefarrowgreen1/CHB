#!/usr/bin/env node
// ============================================================
//  run-checks.js — every check, run on this machine, before a merge
//  (dev only, never deployed).
//
//      node run-checks.js            what ci.yml defines, the way CI ran it
//      node run-checks.js --all      also the browser and layout suites when no front-end file changed
//      node run-checks.js --only=smoke-test,test-ical    just those (a job name runs the whole job)
//      node run-checks.js --skip=layout                  all but those (say so in the PR)
//      node run-checks.js --list     the plan, without running anything
//      --jobs=N sets how many gates run at once beside the browser suites; --no-fetch
//      leaves origin/main as it is.
//
//  GITHUB RUNS NO TESTS BY ITSELF (the owner's ask, 22/10/2026). Waiting on it slowed
//  every merge, and its jobs queued beside the deploy for the same runners. ci.yml now
//  starts only by hand; this is the gate a change passes before it is merged.
//
//  THE LIST IS READ FROM ci.yml, so the two cannot drift: every one-command step of every
//  job, plus the steps it knows by their script (php -l, PHPStan, the tool installs, the
//  MySQL start, the front-end detector). A step it does not recognise fails the run
//  rather than being skipped quietly.
//
//  AS CI RAN THEM: PHP with the tracing JIT on, child processes included (PHP_INI_SCAN_DIR:
//  the JIT once miscompiled a CSV loop that every run without it passed); check-versions
//  against the merge base with origin/main, uncommitted changes included (`git stash
//  create`); PHPStan at the version ci.yml pins; the browser and layout jobs only when a
//  file matching ci.yml's front-end pattern changed, unless --all; test-integration against
//  a database of its own, dropped afterwards.
//
//  Exit 0 means every gate that should run here ran and passed. A gate that could not run
//  (no MySQL, no Playwright, no PHPStan) fails the run unless it was skipped by name. The
//  WebKit layout leg is the exception: on a machine with no WebKit it is reported, not
//  failed, because nothing here can provide it.
// ============================================================
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const APP = __dirname;
const ROOT = path.resolve(APP, '..');
const CI_YML = path.join(ROOT, '.github', 'workflows', 'ci.yml');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n) => {
    const a = argv.find((x) => x.startsWith('--' + n + '='));
    return a ? a.slice(n.length + 3) : null;
};
const ALIAS = { browser: 'browser-core' };
const names = (n) => (opt(n) || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => ALIAS[s] || s);
const ONLY = names('only');
const SKIP = names('skip');
const CPUS = Math.max(1, (os.cpus() || []).length);

// ---- ci.yml, read as the list of what to run ---------------------------------
// A small reader for this file's own shape: jobs at two spaces, steps at "      - ",
// a step's keys at eight spaces, a `run: |` script indented beneath it.
function readWorkflow(src) {
    const jobs = {};
    let inJobs = false;
    let job = null;
    let step = null;
    let script = null;
    const endScript = () => {
        if (script && step) step.run = script.join('\n');
        script = null;
    };
    const setKey = (st, k, v) => {
        v = v.replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
        if (k === 'run') {
            if (v === '|' || v === '>') { st.script = true; return true; }
            st.run = v;
        } else if (k === 'name') st.name = v;
        else if (k === 'uses') st.uses = v;
        else if (k === 'working-directory') st.wd = v;
        else if (k === 'if') st.if = v;
        return false;
    };
    for (const line of src.split('\n')) {
        if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
        if (!inJobs) continue;
        if (script) {
            if (line.trim() === '' || /^ {10}/.test(line)) { script.push(line.slice(10)); continue; }
            endScript();
        }
        let m;
        if ((m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line))) {
            job = jobs[m[1]] = { name: m[1], text: '', steps: [] };
            step = null;
            continue;
        }
        if (!job) continue;
        job.text += line + '\n';
        if ((m = /^ {6}- ([A-Za-z][\w-]*):\s*(.*)$/.exec(line))) {
            step = { name: '', uses: '', run: '', script: false, wd: '', if: '' };
            job.steps.push(step);
            if (setKey(step, m[1], m[2])) script = [];
            continue;
        }
        if (step && (m = /^ {8}([A-Za-z][\w-]*):\s*(.*)$/.exec(line))) {
            if (setKey(step, m[1], m[2])) script = [];
        }
    }
    endScript();
    return jobs;
}

// Scripts this runner knows by what they do; anything else in a `run: |` is unknown.
const KNOWN_SCRIPTS = [
    [/\bphp -l\b/, 'lint'],
    [/phpstan\.phar analyse/, 'phpstan'],
    [/grep -qE '[^']+'/, 'frontend'],
    [/systemctl start mysql/, 'mysql'],
    [/npm install/, 'tools'],
];

function planOf(src) {
    const jobs = readWorkflow(src);
    const gates = [];
    const unknown = [];
    let fePattern = null;
    const pin = (re) => (re.exec(src) || [])[1] || null;
    const pins = {
        php: pin(/php-version:\s*'([\d.]+)'/),
        node: pin(/node-version:\s*'(\d+)'/),
        phpstan: pin(/phpstan\/releases\/download\/([\d.]+)\//),
        playwright: pin(/playwright@([\d.]+)/),
        typescript: pin(/typescript@([\d.]+)/),
    };
    for (const job of Object.values(jobs)) {
        const engines = ((/engine:\s*\[([^\]]+)\]/.exec(job.text) || [])[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
        for (const st of job.steps) {
            if (st.uses) continue; // checkout, setup-node, setup-php, caches, artifact upload
            const cwd = st.wd ? path.resolve(ROOT, st.wd) : ROOT;
            const feOnly = /steps\.fe\.outputs\.run/.test(st.if);
            if (st.script) {
                const kind = (KNOWN_SCRIPTS.find(([re]) => re.test(st.run)) || [])[1];
                if (!kind) unknown.push(`${job.name}: "${st.name}"`);
                else if (kind === 'lint') gates.push({ id: 'php-lint', job: job.name, kind, cwd: APP, feOnly });
                else if (kind === 'phpstan') gates.push({ id: 'phpstan', job: job.name, kind, cwd: APP, feOnly });
                else if (kind === 'frontend') fePattern = fePattern || /grep -qE '([^']+)'/.exec(st.run)[1];
                else if (kind === 'mysql') job.needsDb = true;
                else if (kind === 'tools' && /playwright/.test(st.run)) job.needsBrowser = true;
                continue;
            }
            const m = /^(node|php)\s+((?:[\w.-]+\/)*[\w.-]+\.(?:js|php))$/.exec(st.run);
            if (!m) { unknown.push(`${job.name}: "${st.name}" (${st.run})`); continue; }
            const id = path.basename(m[2]).replace(/\.(js|php)$/, '');
            const base = { job: job.name, kind: m[1], script: m[2], cwd, feOnly };
            if (engines.length) {
                // The matrix leg's CHB_ENGINE, as ci.yml sets it: '' for chromium.
                for (const e of engines) gates.push({ ...base, id: `${id} (${e})`, engine: e, env: { CHB_ENGINE: e === 'chromium' ? '' : e } });
            } else gates.push({ ...base, id, env: {} });
        }
    }
    for (const g of gates) {
        g.needsDb = !!jobs[g.job].needsDb;
        g.needsBrowser = !!jobs[g.job].needsBrowser;
    }
    return { jobs, gates, unknown, fePattern, pins };
}

// ---- small helpers -------------------------------------------------------------
function git(args, timeout = 30000) {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? String(r.stdout).trim() : null;
}
const secs = (ms) => {
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};
function resolveFrom(mod) {
    try { return require.resolve(mod, { paths: [APP] }); } catch (e) { return null; }
}
function versionOf(mod) {
    const p = resolveFrom(mod + '/package.json');
    try { return p ? JSON.parse(fs.readFileSync(p, 'utf8')).version : null; } catch (e) { return null; }
}
function php(code, env) {
    const r = spawnSync('php', ['-r', code], { env, encoding: 'utf8', timeout: 20000 });
    return r.status === 0 ? String(r.stdout).trim() : null;
}

// ---- main -----------------------------------------------------------------------
async function main() {
    const t0 = Date.now();
    const plan = planOf(fs.readFileSync(CI_YML, 'utf8'));
    const problems = [];
    if (plan.unknown.length) problems.push(`ci.yml has steps this runner does not know how to run: ${plan.unknown.join('; ')}. Make each one command, or teach run-checks.js its script.`);
    const inJob = (j) => plan.gates.filter((g) => g.job === j).length;
    if (inJob('checks') < 40 || !plan.gates.some((g) => g.needsDb) || !plan.gates.some((g) => g.id === 'ui-tests') || !plan.fePattern) {
        problems.push(`ci.yml did not read as expected (${inJob('checks')} checks gates, integration ${plan.gates.some((g) => g.needsDb) ? 'found' : 'missing'}, ui-tests ${plan.gates.some((g) => g.id === 'ui-tests') ? 'found' : 'missing'}, front-end pattern ${plan.fePattern ? 'found' : 'missing'})`);
    }
    if (problems.length) {
        problems.forEach((p) => console.error('✗ ' + p));
        process.exit(2);
    }

    if (flag('list')) {
        for (const j of Object.keys(plan.jobs)) {
            const gs = plan.gates.filter((g) => g.job === j);
            if (gs.length) console.log(`${j}: ${gs.map((g) => g.id + (g.feOnly ? '*' : '')).join(', ')}`);
        }
        console.log('* only when a front-end file changed (or --all)');
        return 0;
    }

    // What to run.
    const results = [];
    const record = (g, status, extra) => results.push({ id: g.id, job: g.job, status, ...extra });
    const named = (g, list) => list.includes(g.id) || list.includes(g.job) || list.includes(g.id.replace(/ \(.*\)$/, ''));
    const unmatched = [...ONLY, ...SKIP].filter((n) => !plan.gates.some((g) => named(g, [n])));
    if (unmatched.length) {
        console.error(`✗ no gate or job called ${unmatched.join(', ')} (node run-checks.js --list)`);
        return 2;
    }

    // The diff this run judges: from the merge base with origin/main to the working tree.
    if (!flag('no-fetch')) git(['fetch', '-q', 'origin', 'main'], 45000);
    const baseSha = git(['merge-base', 'HEAD', 'origin/main']);
    const headSha = git(['stash', 'create']) || 'HEAD';
    let changed = null;
    if (baseSha) {
        const tracked = git(['diff', '--name-only', baseSha]);
        const untracked = git(['ls-files', '--others', '--exclude-standard']);
        if (tracked !== null && untracked !== null) changed = [...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean);
    }
    const feRe = new RegExp(plan.fePattern);
    const feChanged = changed === null ? true : changed.some((f) => feRe.test(f));

    let todo = [];
    for (const g of plan.gates) {
        if (ONLY.length && !named(g, ONLY)) continue;
        if (named(g, SKIP)) { record(g, 'skipped'); continue; }
        if (g.feOnly && !feChanged && !flag('all') && !ONLY.length) { record(g, 'not-needed'); continue; }
        todo.push(g);
    }

    // PHP as CI ran it: the tracing JIT on, for every php process and its children.
    const logs = path.join(os.tmpdir(), 'chb-checks', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(logs, { recursive: true });
    const iniDir = path.join(logs, 'php-ini');
    fs.mkdirSync(iniDir);
    fs.writeFileSync(path.join(iniDir, 'zz-chb-jit.ini'), 'opcache.enable_cli=1\nopcache.jit=1235\nopcache.jit_buffer_size=128M\n');
    const scanned = (/Scan for additional \.ini files in:\s*(.+)/.exec(spawnSync('php', ['--ini'], { encoding: 'utf8' }).stdout || '') || [])[1];
    const env = { ...process.env, PHP_INI_SCAN_DIR: scanned && scanned.trim() !== '(none)' ? `${scanned.trim()}${path.delimiter}${iniDir}` : iniDir };
    const phpVer = php('echo PHP_VERSION;', env) || '?';
    const jitOn = php('$s = function_exists("opcache_get_status") ? opcache_get_status(false) : null; echo !empty($s["jit"]["on"]) ? "on" : "off";', env);
    const notes = [];
    if (plan.pins.php && !phpVer.startsWith(plan.pins.php + '.')) notes.push(`PHP ${phpVer} here; ci.yml pins ${plan.pins.php}`);
    if (jitOn !== 'on') notes.push('the tracing JIT is not on here (opcache missing?); CI ran with it');
    if (!baseSha) notes.push('no merge base with origin/main: check-versions skips, and every job runs');

    // What each kind of gate needs from this machine; a missing piece is "not run here".
    const cannot = new Map();
    const needs = (pred, reason) => todo.filter(pred).forEach((g) => cannot.has(g.id) || cannot.set(g.id, reason));
    const tsv = versionOf('typescript');
    if (!tsv || !resolveFrom('eslint') || !resolveFrom('globals')) {
        needs((g) => ['smoke-test', 'lint-js', 'typecheck'].includes(g.id),
            `eslint, globals and typescript must resolve from the app folder (npm install --no-save --no-audit --no-fund eslint globals typescript@${plan.pins.typescript})`);
    } else if (plan.pins.typescript && tsv !== plan.pins.typescript) {
        notes.push(`typescript ${tsv} here; ci.yml pins ${plan.pins.typescript} (the type-check ratchet counts differ by version)`);
    }

    let phpstanPhar = null;
    if (todo.some((g) => g.kind === 'phpstan')) {
        const ver = plan.pins.phpstan;
        const candidates = [process.env.CHB_PHPSTAN_PHAR, path.join(os.tmpdir(), `phpstan-${ver}.phar`), '/tmp/phpstan.phar'].filter(Boolean);
        const isVer = (p) => fs.existsSync(p) && (spawnSync('php', [p, '--version'], { encoding: 'utf8', timeout: 30000 }).stdout || '').includes(ver);
        phpstanPhar = candidates.find(isVer) || null;
        if (!phpstanPhar && ver) {
            const dest = path.join(os.tmpdir(), `phpstan-${ver}.phar`);
            spawnSync('curl', ['-sSL', '--max-time', '120', '-o', dest + '.part', `https://github.com/phpstan/phpstan/releases/download/${ver}/phpstan.phar`], { timeout: 130000 });
            if (fs.existsSync(dest + '.part')) fs.renameSync(dest + '.part', dest);
            if (isVer(dest)) phpstanPhar = dest;
        }
        if (!phpstanPhar) needs((g) => g.kind === 'phpstan', `PHPStan ${ver} is not here and could not be downloaded (set CHB_PHPSTAN_PHAR to a copy)`);
    }

    const dbName = `chb_it_rc${process.pid}`;
    if (todo.some((g) => g.needsDb)) {
        const probe = `try { new PDO("mysql:host=" . (getenv("CHB_IT_DB_HOST") ?: "127.0.0.1") . ";port=" . (getenv("CHB_IT_DB_PORT") ?: "3306"), getenv("CHB_IT_DB_USER") ?: "root", getenv("CHB_IT_DB_PASS") !== false ? getenv("CHB_IT_DB_PASS") : "root", [PDO::ATTR_TIMEOUT => 3]); echo "ok"; } catch (Throwable $e) { echo "no: ", $e->getMessage(); }`;
        let db = php(probe, env) || 'no';
        if (db !== 'ok') {
            // CLAUDE.md's own advice: start it if it is installed but stopped.
            const asRoot = typeof process.getuid !== 'function' || process.getuid() === 0;
            const service = asRoot ? ['service'] : ['sudo', '-n', 'service'];
            for (const svc of ['mariadb', 'mysql']) {
                spawnSync(service[0], [...service.slice(1), svc, 'start'], { timeout: 60000 });
                db = php(probe, env) || 'no';
                if (db === 'ok') break;
            }
        }
        if (db !== 'ok') needs((g) => g.needsDb, `no MySQL or MariaDB at 127.0.0.1:3306 (root/root): ${db.replace(/^no:?\s*/, '')}`);
    }

    const browserGates = todo.filter((g) => g.needsBrowser);
    if (browserGates.length) {
        const pwv = versionOf('playwright');
        if (!pwv) {
            needs((g) => browserGates.includes(g), `playwright is not installed: npm install --no-save --no-audit --no-fund playwright@${plan.pins.playwright} in the app folder`);
        } else {
            if (plan.pins.playwright && pwv !== plan.pins.playwright) notes.push(`playwright ${pwv} here; ci.yml pins ${plan.pins.playwright}`);
            const pw = require(resolveFrom('playwright'));
            const exe = (b) => { try { const p = pw[b].executablePath(); return p && fs.existsSync(p) ? p : null; } catch (e) { return null; } };
            if (!process.env.CHB_CHROMIUM && !exe('chromium')) {
                // The machine's own Chromium when Playwright's revision is not installed.
                const dir = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
                const found = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
                    .filter((d) => /^chromium-\d+$/.test(d))
                    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
                    .flatMap((d) => ['chrome-linux/chrome', 'chrome-linux64/chrome'].map((f) => path.join(dir, d, f)))
                    .find((p) => fs.existsSync(p));
                if (found) env.CHB_CHROMIUM = found;
                else needs((g) => browserGates.includes(g) && g.engine !== 'webkit', 'no Chromium for Playwright here (set CHB_CHROMIUM)');
            }
            if (!exe('webkit')) {
                todo.filter((g) => g.engine === 'webkit').forEach((g) => cannot.set(g.id, 'no WebKit on this machine'));
            }
        }
    }

    // Gates that cannot run are recorded now; the WebKit leg is reported, not failed.
    todo = todo.filter((g) => {
        if (!cannot.has(g.id)) return true;
        record(g, g.engine === 'webkit' && cannot.get(g.id) === 'no WebKit on this machine' ? 'unavailable' : 'not-run', { reason: cannot.get(g.id) });
        return false;
    });

    console.log(`run-checks: ${todo.length} gates · PHP ${phpVer}, JIT ${jitOn || '?'} · base ${baseSha ? baseSha.slice(0, 7) : 'none'}${headSha !== 'HEAD' ? ' · uncommitted changes included' : ''} · ${feChanged ? 'front-end changed' : 'no front-end change'}`);
    notes.forEach((n) => console.log('  note: ' + n));
    console.log(`  logs: ${logs}`);

    // ---- run -------------------------------------------------------------------
    const running = new Map();
    let stopping = false;
    const killGroup = (child, sig) => { try { process.kill(-child.pid, sig); } catch (e) { /* already gone */ } };
    const order = ['test-integration', 'phpstan', 'typecheck', 'search-test', 'smoke-test', 'lint-js', 'golden-test'];
    const rank = (g) => {
        const i = order.indexOf(g.id);
        if (i >= 0) return i;
        return g.job === 'checks' ? 100 + plan.gates.indexOf(g) : 1000 + plan.gates.indexOf(g);
    };
    const longPole = todo.filter((g) => g.id === 'ui-tests');
    const queue = todo.filter((g) => g.id !== 'ui-tests').sort((a, b) => rank(a) - rank(b));
    const slots = Number(opt('jobs')) > 0 ? Number(opt('jobs')) : longPole.length ? Math.max(1, Math.floor(CPUS / 2)) : CPUS;

    const argvOf = (g) => {
        if (g.kind === 'lint') {
            return ['bash', ['-c', "find . \\( -name node_modules -o -name .phpstan-cache -o -name layout-shots \\) -prune -o -name '*.php' -print0 | xargs -0 -n1 -P4 php -l"]];
        }
        if (g.kind === 'phpstan') return ['php', ['-d', 'memory_limit=2G', phpstanPhar, 'analyse', '-c', 'phpstan.neon.dist', '--no-progress', '--error-format=table']];
        return [g.kind === 'node' ? process.execPath : 'php', [g.script]];
    };
    const timeoutOf = (g) => (g.id === 'ui-tests' ? 45 : g.kind === 'phpstan' || g.needsDb ? 25 : 20) * 60000;

    function runGate(g) {
        return new Promise((resolve) => {
            const logFile = path.join(logs, g.id.replace(/[^\w.-]+/g, '_') + '.log');
            const fd = fs.openSync(logFile, 'w');
            const genv = { ...env, ...(g.env || {}) };
            if (g.id === 'check-versions') {
                if (baseSha) genv.CHB_BASE_SHA = baseSha;
                genv.CHB_HEAD_SHA = headSha;
            }
            if (g.needsDb) { genv.CHB_IT_DB_NAME = dbName; dbUsed = true; }
            const [cmd, args] = argvOf(g);
            const started = Date.now();
            const child = spawn(cmd, args, { cwd: g.cwd, env: genv, stdio: ['ignore', fd, fd], detached: true });
            running.set(g.id, { child, started });
            let timedOut = false;
            let finished = false;
            const timer = setTimeout(() => { timedOut = true; killGroup(child, 'SIGKILL'); }, timeoutOf(g));
            const done = (code, error) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                killGroup(child, 'SIGKILL'); // anything the gate left running (a php -S, a browser)
                running.delete(g.id);
                try { fs.closeSync(fd); } catch (e) { /* closed */ }
                const ms = Date.now() - started;
                const ok = code === 0 && !timedOut && !error;
                const r = { log: logFile, ms };
                if (!ok) r.reason = error || (timedOut ? `timed out after ${secs(timeoutOf(g))}` : `exit ${code}`);
                record(g, ok ? 'pass' : 'fail', r);
                if (!stopping) console.log(`${ok ? '✓' : '✗'} ${g.id}  ${secs(ms)}${ok ? '' : '  — ' + r.reason}`);
                if (!ok && !stopping) excerpt(logFile, g.id === 'ui-tests').forEach((l) => console.log('    ' + l));
                resolve();
            };
            child.on('error', (e) => done(127, e.message));
            child.on('exit', (code) => done(code));
        });
    }

    const heartbeat = setInterval(() => {
        if (!running.size) return;
        console.log(`  … running: ${[...running].map(([id, r]) => `${id} ${secs(Date.now() - r.started)}`).join(', ')}`);
    }, 60000);
    let dbUsed = false;
    const dropDb = () => {
        if (!dbUsed) return;
        php(`try { $p = new PDO("mysql:host=" . (getenv("CHB_IT_DB_HOST") ?: "127.0.0.1") . ";port=" . (getenv("CHB_IT_DB_PORT") ?: "3306"), getenv("CHB_IT_DB_USER") ?: "root", getenv("CHB_IT_DB_PASS") !== false ? getenv("CHB_IT_DB_PASS") : "root"); $p->exec("DROP DATABASE IF EXISTS \`${dbName}\`"); } catch (Throwable $e) {}`, env);
    };
    // Stopped from outside: the gates run in process groups of their own, so they are
    // killed here, or a php -S and its browsers would outlive the run.
    const stop = (sig) => {
        if (stopping) return;
        stopping = true;
        for (const { child } of running.values()) killGroup(child, 'SIGKILL');
        console.log(`\nrun-checks: stopped (${sig}) — nothing above counts as a pass for a merge`);
        dropDb();
        process.exit(130);
    };
    ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => process.on(sig, () => stop(sig)));

    await Promise.all([
        ...longPole.map(runGate),
        ...Array.from({ length: Math.min(slots, queue.length) }, async () => {
            for (let g = queue.shift(); g; g = queue.shift()) await runGate(g);
        }),
    ]);
    clearInterval(heartbeat);
    dropDb();

    // ---- summary -------------------------------------------------------------------
    const by = (s) => results.filter((r) => r.status === s);
    const failed = by('fail');
    const notRun = by('not-run');
    console.log('\n──────── run-checks ────────');
    console.log(`✓ ${by('pass').length} passed   ✗ ${failed.length} failed   ${notRun.length ? `! ${notRun.length} could not run   ` : ''}in ${secs(Date.now() - t0)}`);
    failed.forEach((r) => console.log(`  ✗ ${r.id} — ${r.reason}  (${r.log})`));
    notRun.forEach((r) => console.log(`  ! ${r.id} could not run: ${r.reason}`));
    if (by('unavailable').length) console.log(`  · not on this machine: ${by('unavailable').map((r) => `${r.id} (${r.reason})`).join(', ')}`);
    if (by('not-needed').length) console.log(`  · not needed, no front-end file changed: ${by('not-needed').map((r) => r.id).join(', ')} (--all runs them)`);
    if (by('skipped').length) console.log(`  · skipped as asked: ${by('skipped').map((r) => r.id).join(', ')}`);
    const slow = by('pass').concat(failed).sort((a, b) => b.ms - a.ms).slice(0, 4);
    if (slow.length) console.log(`  slowest: ${slow.map((r) => `${r.id} ${secs(r.ms)}`).join(', ')}`);
    console.log(`  logs: ${logs}`);
    const ok = !failed.length && !notRun.length;
    // A run that left gates out on purpose is not the gate; say which kind it was.
    let verdict = 'NOT READY TO MERGE';
    if (ok && ONLY.length) verdict = 'THESE PASSED — a partial run (--only), not enough on its own to merge';
    else if (ok && by('skipped').length) verdict = 'ALL CHECKS PASSED except those skipped — name them in the PR';
    else if (ok) verdict = 'ALL CHECKS PASSED — fine to merge';
    console.log('\n' + verdict);
    return ok ? 0 : 1;
}

// The lines worth showing under a failure: the suites that failed, else the first failing checks.
function excerpt(file, suites) {
    let lines = [];
    try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch (e) { return []; }
    const pick = (re) => lines.filter((l) => re.test(l)).map((l) => l.trim().slice(0, 200));
    const suiteLines = suites ? pick(/^\s*✗ ui-test-/) : [];
    const shown = suiteLines.length ? suiteLines : pick(/✗|FAILED|Fatal error|Parse error|Error:|\[ERROR\]/);
    return (shown.length ? shown : lines.filter((l) => l.trim()).slice(-3)).slice(0, 6);
}

if (require.main === module) {
    main().then((code) => process.exit(code), (e) => { console.error(e && e.stack || e); process.exit(2); });
}
module.exports = { readWorkflow, planOf };
