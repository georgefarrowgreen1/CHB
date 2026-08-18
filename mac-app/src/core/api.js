// ============================================================
//  api.js — the surface the window is allowed to call.
//
//  Electron's main process owns everything with a file handle or a socket; the
//  window is a renderer with no Node access at all (contextIsolation on,
//  nodeIntegration off) and reaches this through a preload bridge. So THIS list
//  is the app's security boundary, and it is short on purpose — the window can
//  ask for state, change settings, search and download models, test the site
//  and run a night. It cannot read a file, spawn a process or post anywhere.
//
//  Every method returns a plain object and never throws: a rejected promise in
//  a renderer becomes an unhandled rejection nobody sees, so a failure comes
//  back as { ok:false, say } and the window prints the sentence.
//
//  Constructed with its dependencies so test/core-test.js and the UI test can
//  drive the whole surface with a fake site, a fake engine and a temp folder.
// ============================================================
'use strict';
const path = require('path');
const machineMod = require('./machine');
const engineMod = require('./engine');
const modelsMod = require('./models');
const configMod = require('./config');
const siteMod = require('./site');
const nightMod = require('./night');
const jobsMod = require('./jobs');

function makeApi(deps) {
    const d = deps || {};
    const dir = d.dir || null;                      // settings dir override, for tests
    const mach = d.machine || machineMod.readMachine();
    const secrets = d.secrets || configMod.makeSecrets({});
    const makeEngine = d.makeEngine || engineMod.makeEngine;
    const makeSite = d.makeSite || siteMod.makeSite;
    const fetchImpl = d.fetch || (typeof fetch === 'function' ? fetch : null);
    const now = function () { return d.now ? d.now() : new Date(); };

    let cfg = configMod.load(dir);
    let nights = readNights();
    let running = false;

    function readNights() {
        const p = configMod.paths(dir);
        try {
            const raw = JSON.parse(require('fs').readFileSync(p.log, 'utf8'));
            return Array.isArray(raw) ? raw : [];
        } catch (e) {
            return [];
        }
    }
    function writeNights() {
        const p = configMod.paths(dir);
        try {
            require('fs').mkdirSync(p.dir, { recursive: true });
            require('fs').writeFileSync(p.log, JSON.stringify(nights), 'utf8');
        } catch (e) { /* a log we cannot write is not worth stopping a run for */ }
    }

    // Which engine is in use: the owner's choice if they made one and it is
    // usable here, otherwise whatever this Mac can actually run.
    function engineId(reach) {
        const chosen = String(cfg.engine || '');
        if (chosen) {
            const spec = engineMod.ENGINES[chosen];
            if (spec && (!spec.appleSiliconOnly || mach.appleSilicon)) {
                return chosen;
            }
        }
        return engineMod.pickDefault(mach, reach || {});
    }
    function engineFor(id) {
        return makeEngine({ id: id || engineId() });
    }
    function siteFor() {
        return makeSite({ url: cfg.siteUrl, secret: secrets.get() });
    }

    return {
        // Everything the window paints on open. One call, so the UI never has to
        // orchestrate four.
        async state() {
            const reach = {};
            const engines = engineMod.available(mach);
            for (let i = 0; i < engines.length; i++) {
                const e = engines[i];
                reach[e.id] = e.usable ? await engineFor(e.id).reachable() : false;
                e.serving = reach[e.id];
                e.base = (engineMod.ENGINES[e.id] || {}).base || '';
            }
            const id = engineId(reach);
            const inst = modelsMod.installed(cfg.modelsDir).map(function (m) {
                const v = machineMod.modelVerdict(mach, m.sizeGB, { mlxOnly: m.format === 'mlx' });
                return Object.assign({}, m, { fit: v.fit, why: v.why });
            });
            const next = nightMod.nextRun((cfg.jobs.reply || {}).at, now());
            return {
                ok: true,
                machine: mach,
                machineSays: machineMod.describe(mach),
                engines: engines,
                engine: id,
                engineName: (engineMod.ENGINES[id] || {}).name || id,
                engineServing: !!reach[id],
                engineBase: (engineMod.ENGINES[id] || {}).base || '',
                jobs: jobsMod.JOBS.map(function (j) {
                    const c = cfg.jobs[j.id] || {};
                    return Object.assign({}, j, { on: !!c.on && !!j.built, model: c.model || '', at: c.at || '02:00' });
                }),
                models: inst,
                modelsDir: cfg.modelsDir,
                siteUrl: cfg.siteUrl,
                secretSet: secrets.state().set,
                secretHint: secrets.state().hint,
                keychain: secrets.available,
                keepAwake: !!cfg.keepAwake,
                nextRun: next.toISOString(),
                nextRunAt: (cfg.jobs.reply || {}).at || '02:00',
                nextRunSays: nightMod.untilWords(next, now()),
                nights: nights.slice(0, 30),
                running: running,
            };
        },

        // A shallow settings change. Only the keys the window is allowed to set.
        async saveConfig(patch) {
            const p = patch && typeof patch === 'object' ? patch : {};
            if (typeof p.siteUrl === 'string') {
                // Told NOW, at the keyboard, rather than at two in the morning
                // in a log nobody is reading.
                const bad = siteMod.urlProblem(p.siteUrl);
                if (p.siteUrl.trim() && bad) {
                    return { ok: false, say: bad };
                }
                cfg.siteUrl = p.siteUrl.trim();
            }
            if (typeof p.engine === 'string' && (p.engine === '' || engineMod.ENGINES[p.engine])) {
                cfg.engine = p.engine;
            }
            if (typeof p.keepAwake === 'boolean') {
                cfg.keepAwake = p.keepAwake;
            }
            if (p.job && typeof p.job.id === 'string') {
                const j = jobsMod.jobById(p.job.id);
                if (!j) {
                    return { ok: false, say: 'There is no job called that.' };
                }
                const c = cfg.jobs[j.id] || (cfg.jobs[j.id] = { on: false, model: '', at: '02:00' });
                if (typeof p.job.on === 'boolean') {
                    // A job that is not BUILT cannot be switched on, however the
                    // window asks. The Jobs screen shows them for shape, not use.
                    c.on = p.job.on && j.built;
                }
                if (typeof p.job.model === 'string') {
                    c.model = p.job.model;
                }
                if (typeof p.job.at === 'string' && /^\d{1,2}:\d{2}$/.test(p.job.at)) {
                    c.at = p.job.at;
                }
            }
            const r = configMod.save(cfg, dir);
            return r.ok ? { ok: true } : r;
        },

        async setSecret(value) {
            const r = secrets.set(String(value == null ? '' : value));
            return r.ok ? { ok: true, set: secrets.state().set } : r;
        },

        // CONNECT WITH A CODE, and store what comes back. The window never sees
        // the key: it hands over the code and is told whether it worked, which
        // is the same posture as setSecret — there is no way to read a secret
        // back out of this app and this must not become one.
        async connect(code) {
            if (!cfg.siteUrl) {
                return { ok: false, say: 'Put the site address in first.' };
            }
            const r = await siteFor().connect(code);
            if (!r.ok) { return r; }
            const s = secrets.set(r.key);
            if (!s.ok) {
                // The key is spent — the code will not work twice — so say so
                // rather than leaving the owner to try the same code again.
                return { ok: false, say: (s.say || 'Could not store the key.')
                    + ' That code is now used; start again on the website.' };
            }
            return { ok: true, host: r.host || '' };
        },

        async testSite() {
            if (!cfg.siteUrl) {
                return { ok: false, state: 'error', say: 'No site address yet.' };
            }
            if (!secrets.state().set) {
                return { ok: false, state: 'auth', say: 'No secret stored yet. Paste the one your daily-jobs address uses.' };
            }
            const t = await siteFor().test();
            return { ok: t.state === 'on', state: t.state, say: t.say };
        },

        async searchModels(term) {
            if (!fetchImpl) {
                return { ok: false, say: 'This build cannot reach the network.' };
            }
            return modelsMod.search(term, mach, { fetch: fetchImpl });
        },

        // The quantisations inside one repo, with REAL sizes and therefore real
        // fit verdicts. This is what a search row expands into.
        async modelFiles(repoId) {
            if (!fetchImpl) {
                return { ok: false, say: 'This build cannot reach the network.' };
            }
            return modelsMod.files(repoId, mach, { fetch: fetchImpl });
        },

        // Download a model file. `onProgress` is supplied by main.js and forwards
        // to the window; the api itself does not know about windows.
        async downloadModel(row, onProgress) {
            if (!row || !row.url || !row.filename) {
                return { ok: false, say: 'That model does not say where to download it from.' };
            }
            const safe = String(row.filename).replace(/[^A-Za-z0-9._-]/g, '_');
            if (!/\.gguf$/i.test(safe)) {
                return { ok: false, say: 'Only .gguf model files can be downloaded here.' };
            }
            const r = await modelsMod.download(String(row.url), cfg.modelsDir, safe, onProgress, { fetch: fetchImpl });
            return r;
        },

        // Run tonight's work now. Guarded against two at once: a second run
        // would draft the same enquiries and post the same refs, which the site
        // would deduplicate — but the log would read as though it had worked
        // twice, which is a lie about a thing nobody watched.
        async runNow(onProgress, openingNote) {
            if (running) {
                return { ok: false, say: 'It is already working.' };
            }
            running = true;
            try {
                const reach = {};
                const id = engineId(reach);
                const rec = await nightMod.runNight({
                    site: siteFor(),
                    engine: engineFor(id),
                    cfg: cfg,
                    machine: mach,
                    now: now(),
                    onProgress: onProgress,
                    openingNote: openingNote,
                });
                nights = nightMod.pushRecord(nights, rec);
                writeNights();
                cfg.lastRun = rec.started;
                configMod.save(cfg, dir);
                return { ok: true, night: rec };
            } catch (e) {
                // A crash mid-run is itself a night worth recording.
                const rec = {
                    started: now().toISOString(), ok: false, drafted: 0, posted: 0,
                    log: [{ at: '', say: 'the run stopped unexpectedly: ' + (e && e.message ? e.message : 'unknown'), level: 'fail' }],
                };
                nights = nightMod.pushRecord(nights, rec);
                writeNights();
                return { ok: false, say: 'The run stopped unexpectedly.', night: rec };
            } finally {
                running = false;
            }
        },

        // Where the queue lives, so the window can offer to open it.
        siteHomeUrl() {
            const u = String(cfg.siteUrl || '');
            if (!u) {
                return '';
            }
            try {
                const parsed = new URL(u);
                return parsed.origin + parsed.pathname.replace(/nightshift\.php$/, '');
            } catch (e) {
                return '';
            }
        },

        // For tests and for main.js's scheduler.
        _cfg() { return cfg; },
        _nextRun() { return nightMod.nextRun((cfg.jobs.reply || {}).at, now()); },
    };
}

module.exports = { makeApi };
