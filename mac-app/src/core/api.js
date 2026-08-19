// ============================================================
//  api.js — the surface the window is allowed to call.
//
//  Electron's main process owns everything with a file handle or a socket; the
//  window is a renderer with no Node access at all (contextIsolation on,
//  nodeIntegration off) and reaches this through a preload bridge. So THIS list
//  is the app's security boundary, and it is short on purpose — the window can
//  ask for state, change settings, search and download models, test the site
//  and run a night. It cannot read a file or post anywhere.
//
//  STARTING THE MODEL SERVER IS DELEGATED, NOT DONE HERE. This file still has
//  no child_process: `deps.runner` is an object with start/stop/status that
//  main.js supplies over real processes and the suites supply as a fake. That
//  keeps the one place in the app that spawns anything down to a dozen lines
//  in the untested layer, and keeps every DECISION about it (core/runner.js)
//  under test with no Mac.
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
const runnerMod = require('./runner');
const chatMod = require('./chat');

function makeApi(deps) {
    const d = deps || {};
    const dir = d.dir || null;                      // settings dir override, for tests
    const mach = d.machine || machineMod.readMachine();
    const secrets = d.secrets || configMod.makeSecrets({});
    const makeEngine = d.makeEngine || engineMod.makeEngine;
    const makeSite = d.makeSite || siteMod.makeSite;
    const fetchImpl = d.fetch || (typeof fetch === 'function' ? fetch : null);
    const now = function () { return d.now ? d.now() : new Date(); };
    // The one thing this file will not do for itself. Absent (a bare `npm test`
    // constructing the api with no deps) it reports as unavailable rather than
    // throwing — the Runner screen then reads exactly as it did before this
    // feature existed.
    const runner = d.runner || null;
    // Where a bundled binary would sit. Injected, because process.resourcesPath
    // only exists inside a packaged Electron app.
    const resourcesDir = d.resourcesDir || '';

    let cfg = configMod.load(dir);
    let nights = readNights();
    let running = false;
    // THE ASK CHANNEL's day ledger — in memory on purpose: what the owner
    // needs durable is the ANSWER, and that lives on the site's ask row. This
    // is only the window's "answered N while you were here" line.
    let askDay = '';
    let askAnswered = 0;
    let askLog = [];
    let sweeping = false;
    // The engine an ASK started idles out after ten minutes rather than being
    // stopped per answer: a model load costs tens of seconds, and the owner
    // who asked once usually asks again — but a nine-gigabyte server must not
    // sit on the Mac's memory all afternoon for a question asked at nine.
    let askIdleStop = null;
    // One warm-up per warm window — a hint that re-fired every 20s would
    // start-stop the server in a loop against the idle timer.
    let warmTried = false;

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
    // THE CHAT — one thread, on this Mac only, the nights.json posture.
    function readChat() {
        const p = configMod.paths(dir);
        try {
            return chatMod.chatThread(JSON.parse(require('fs').readFileSync(p.chat, 'utf8')));
        } catch (e) {
            return [];
        }
    }
    function writeChat() {
        const p = configMod.paths(dir);
        try {
            require('fs').mkdirSync(p.dir, { recursive: true });
            require('fs').writeFileSync(p.chat, JSON.stringify(chatThread), 'utf8');
        } catch (e) { /* a thread we cannot write still works for this session */ }
    }
    let chatThread = readChat();
    let chatBusy = false;
    // The chat's model: the owner's explicit pick, else the reply job's — the
    // model already trusted with prose. '' means neither exists yet.
    function chatModelId() {
        const m = String(cfg.chatModel || (cfg.jobs.reply || {}).model || '');
        return m;
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
        return makeSite({ url: configMod.siteUrl(cfg), secret: secrets.get(), build: d.build || '' });
    }

    // Everything the window needs to decide whether to offer a Start button,
    // and what to say instead when it cannot. Composed from the pure module so
    // the button, the night and the log all read one answer.
    function runnerState(id, wantModel) {
        const engineId2 = id || engineId();
        const found = runnerMod.resolveRunner({ custom: cfg.runnerPath, resourcesDir: resourcesDir });
        const model = String(wantModel || (cfg.jobs.reply || {}).model || '');
        const modelPath = model ? path.join(cfg.modelsDir, model) : '';
        const problem = runnerMod.startProblem({
            engineId: engineId2,
            engineName: (engineMod.ENGINES[engineId2] || {}).name || engineId2,
            modelPath: modelPath,
            modelsDir: cfg.modelsDir,
            runner: found,
        });
        const live = runner && runner.status ? runner.status() : { running: false };
        return {
            // Whether this app is ABLE to start this engine at all, which is a
            // different question from whether it could start right now.
            canStart: runnerMod.canStart(engineId2),
            available: !!runner,
            found: !!found.ok,
            kind: found.kind || '',
            path: found.path || '',
            install: found.ok ? '' : found.install,
            problem: problem,
            running: !!(live && live.running),
            startedByUs: !!(live && live.running),
            autoStart: !!cfg.autoStart,
            openAtLogin: !!cfg.openAtLogin,
        };
    }

    // Bring the engine up if it is not already, and say what happened. Used by
    // the Start button AND by a night that finds nothing answering, so the two
    // cannot behave differently.
    //
    // `wantModel` is which model must be SERVING — each job names its own, and
    // an auto-started llama-server holds exactly one, so a night moving to a
    // job with a different model swaps the server here. Only one WE started is
    // ever stopped: an engine the owner runs is never ours to restart, and for
    // those the model parameter on each request is what travels.
    let startedModel = '';
    async function ensureEngine(id, wantModel) {
        const engineId2 = id || engineId();
        const eng = engineFor(engineId2);
        const model = String(wantModel || (cfg.jobs.reply || {}).model || '');
        const up = await eng.reachable();
        const ours = !!(runner && runner.status && runner.status().running);
        if (up && (!ours || !model || startedModel === model)) {
            return { ok: true, started: false, say: eng.name + ' is already answering.' };
        }
        if (!runner) {
            return up
                ? { ok: true, started: false, say: eng.name + ' is already answering.' }
                : { ok: false, say: eng.name + ' is not answering on ' + eng.base + '.' };
        }
        const st = runnerState(engineId2, model);
        if (st.problem) {
            return { ok: false, say: st.problem, install: st.install };
        }
        if (up && ours && startedModel !== model) {
            await runner.stop();
        }
        const r = await runner.start({
            bin: st.path,
            args: runnerMod.runnerArgs({
                modelPath: path.join(cfg.modelsDir, model),
                base: eng.base,
                appleSilicon: !!mach.appleSilicon,
            }),
            base: eng.base,
            reachable: function () { return eng.reachable(); },
        });
        if (r && r.ok) {
            startedModel = model;
            return { ok: true, started: true, say: eng.name + ' · ' + runnerMod.readySay(r.ms) };
        }
        return { ok: false, say: (r && r.say) || 'The model server did not start.' };
    }

    // Ten quiet minutes and an engine WE started stands down. One definition,
    // re-armed by whatever used it last — an ask answered, a chat message —
    // so the two ways of keeping it warm cannot hold two timers.
    function armIdleStop() {
        clearTimeout(askIdleStop);
        askIdleStop = setTimeout(async function () {
            try {
                if (!running && !sweeping && !chatBusy && startedModel) {
                    await runner.stop();
                    startedModel = '';
                    askLog.push({ at: nightMod.hhmm(), say: 'stopped the model server — ten quiet minutes', level: 'info' });
                }
            } catch (e) { /* leaving it running is the safe failure */ }
        }, 10 * 60 * 1000);
        if (askIdleStop.unref) { askIdleStop.unref(); }
    }

    return {
        // Everything the window paints on open. One call, so the UI never has to
        // orchestrate four.
        // The tray's state line, rebuilt every half-minute for the life of the
        // app — so it reads only what is already in hand and never probes.
        quick() {
            return { secretSet: secrets.state().set, running: running, asksToday: askAnswered };
        },

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
                // THE ADDRESS IN FORCE, resolved — not the raw setting, which is
                // '' on a fresh install and used to make the window say "no
                // address yet" about an app that knew perfectly well where its
                // site was. `siteIsDefault` lets it say "the standard address"
                // rather than printing a URL nobody chose.
                siteUrl: configMod.siteUrl(cfg),
                siteIsDefault: configMod.siteIsDefault(cfg),
                // The RAW setting too, so the Change… box shows what was
                // actually overridden and an empty one still means "standard".
                siteRaw: String(cfg.siteUrl || ''),
                secretSet: secrets.state().set,
                secretHint: secrets.state().hint,
                keychain: secrets.available,
                keepAwake: !!cfg.keepAwake,
                runner: runnerState(id),
                nextRun: next.toISOString(),
                nextRunAt: (cfg.jobs.reply || {}).at || '02:00',
                nextRunSays: nightMod.untilWords(next, now()),
                // The ask channel's day line, for Tonight: how many the Mac
                // answered while the owner was at the site today, and the
                // last few log lines so an answered ask is visible HERE too.
                asks: { today: askAnswered, log: askLog.slice(-40) },
                nights: nights.slice(0, 30),
                running: running,
            };
        },

        // A shallow settings change. Only the keys the window is allowed to set.
        async saveConfig(patch) {
            const p = patch && typeof patch === 'object' ? patch : {};
            if (typeof p.siteUrl === 'string') {
                // Told NOW, at the keyboard, rather than at two in the morning
                // in a log nobody is reading. An EMPTY value is not a mistake —
                // it means "back to the standard address" (see config.siteUrl),
                // which is how the window's Change… offers a way out again.
                const bad = siteMod.urlProblem(p.siteUrl);
                if (p.siteUrl.trim() && bad) {
                    return { ok: false, say: bad };
                }
                cfg.siteUrl = p.siteUrl.trim();
            }
            if (typeof p.engine === 'string' && (p.engine === '' || engineMod.ENGINES[p.engine])) {
                cfg.engine = p.engine;
            }
            if (typeof p.chatModel === 'string') {
                cfg.chatModel = p.chatModel;
            }
            if (typeof p.keepAwake === 'boolean') {
                cfg.keepAwake = p.keepAwake;
            }
            if (typeof p.autoStart === 'boolean') {
                cfg.autoStart = p.autoStart;
            }
            if (typeof p.openAtLogin === 'boolean') {
                cfg.openAtLogin = p.openAtLogin;
            }
            if (typeof p.moveDeclined === 'boolean') {
                cfg.moveDeclined = p.moveDeclined;
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

        // ── THE MODEL SERVER ──────────────────────────────────────────────
        // Start it, and wait until it actually answers rather than until the
        // process exists: a spawned llama-server takes tens of seconds to load
        // a 14B model, and "started" the moment the process appears would put
        // a green light on a thing that cannot yet be asked anything.
        async startEngine() {
            const r = await ensureEngine();
            return r.ok ? { ok: true, say: r.say, started: !!r.started } : r;
        },

        // Stop only what THIS app started. A llama-server the owner is running
        // themselves is not ours to kill, and `runner.stop()` knows the
        // difference because it only ever holds a child it spawned.
        async stopEngine() {
            if (!runner) {
                return { ok: false, say: 'This app is not running a model server.' };
            }
            return runner.stop();
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
            const r = await siteFor().connect(code, machineMod.deviceLabel(mach));
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
            if (!secrets.state().set) {
                return { ok: false, state: 'auth', say: 'Not connected yet. Use the code from Manage \u2192 System check \u2192 Connect a Mac.' };
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
                    // Only offered when the owner has left auto-start on. Off,
                    // the night behaves exactly as it did before this existed.
                    ensureEngineFor: cfg.autoStart && runner
                        ? function (model) { return ensureEngine(id, model); }
                        : null,
                });
                // WHAT WE STARTED, WE STOP. A model server left holding nine
                // gigabytes of a Mac's memory until the next reboot is not a
                // reasonable thing to leave behind at 02:17 — and one the owner
                // was already running is never touched, because `startedEngine`
                // is only true when this run spawned it.
                if (rec.startedEngine && runner) {
                    const stopped = await runner.stop();
                    rec.log.push({
                        at: nightMod.hhmm(),
                        say: stopped && stopped.ok ? 'stopped the model server this run started' : 'left the model server running',
                        level: 'info',
                    });
                }
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

        // ── THE ASK CHANNEL ─────────────────────────────────────────
        // One poll of the site's open asks, answered with the same guard the
        // night uses. Called every ~20s by main.js while the app runs; every
        // guard here exists so that cadence stays harmless: it skips while a
        // night run or another sweep is mid-flight, and it goes quiet (rather
        // than logging) on the refusals a resident poller meets all day.
        async askSweep() {
            if (running || sweeping) {
                return { ok: true, answered: 0 };
            }
            if (!secrets.get() && !cfg.siteUrl) {
                return { ok: true, answered: 0 };
            }
            sweeping = true;
            try {
                const reach = {};
                const id = engineId(reach);
                // The smallest installed chat model, for INTENT picks — a
                // menu choice is a small-model job, and the big one stays
                // free for prose.
                let small = '';
                try {
                    const inst = modelsMod.installed(cfg.modelsDir)
                        .filter(function (m) { return m.format === 'gguf'; })
                        .sort(function (x, y) { return (x.sizeGB || 99) - (y.sizeGB || 99); });
                    small = inst.length ? inst[0].id : '';
                } catch (e) { small = ''; }
                const out = await jobsMod.runAskSweep({
                    site: siteFor(),
                    engine: engineFor(id),
                    cfg: cfg,
                    now: now(),
                    smallModel: small,
                    // LONG-POLL: the site holds the request until an ask
                    // appears (or 20s), so work starts within a second.
                    waitS: 20,
                    ensureEngineFor: cfg.autoStart && runner
                        ? function (model) { return ensureEngine(id, model); }
                        : null,
                });
                // THE WARM HINT (seamlessness rung 2): search is open at the
                // site, so bring the engine up NOW — a dead end then meets a
                // warm model. Only when auto-start is on, only when nothing
                // of ours is already up, and never twice in a row.
                if (out.warm && !out.answered && cfg.autoStart && runner && !startedModel && !warmTried) {
                    warmTried = true;
                    try {
                        await ensureEngine(id, small || undefined);
                        askLog.push({ at: nightMod.hhmm(), say: 'warmed the model server — search is open at the site', level: 'info' });
                    } catch (e) { /* a warm-up that fails is just a cold start later */ }
                } else if (!out.warm) {
                    warmTried = false;
                }
                const day = siteMod.today(now());
                if (day !== askDay) {
                    askDay = day;
                    askAnswered = 0;
                    askLog = [];
                }
                askAnswered += out.answered;
                out.log.forEach(function (l) { askLog.push(l); });
                if (askLog.length > 80) { askLog = askLog.slice(-80); }
                askLog = askLog.slice(-20);
                // Idle-stop: only re-armed when a sweep actually touched the
                // engine (an ask existed). A stop while a NIGHT run holds the
                // engine is impossible — runNight and this never overlap.
                if ((out.answered || out.failed) && startedModel && runner) {
                    armIdleStop();
                }
                return { ok: true, answered: out.answered };
            } catch (e) {
                return { ok: false, say: 'The ask sweep stopped unexpectedly.' };
            } finally {
                sweeping = false;
            }
        },

        // ── THE CHAT — the owner talking to their own model. Not the ──
        // business channel: no guard (the only reader is the owner), no route
        // to the site, and chat.js's header says why. The engine handling is
        // the ask sweep's own — ensure, then ten-quiet-minutes idle-stop.
        chatHistory() {
            return { ok: true, thread: chatThread.slice(), model: chatModelId() };
        },
        async chatSend(text) {
            const t = String(typeof text === 'string' ? text : '').trim().slice(0, chatMod.CHAT_MSG_CHARS);
            if (!t) {
                return { ok: false, say: 'Type a message first.' };
            }
            if (chatBusy) {
                return { ok: false, say: 'One at a time — the model is still answering.' };
            }
            if (running) {
                // Tonight's run holds the engine and swaps models underneath it.
                return { ok: false, say: 'Tonight’s work is using the engine — a minute or two and it’s yours.' };
            }
            const model = chatModelId();
            if (!model) {
                return { ok: false, say: 'No model yet — add one under Library, or pick one for the reply job.' };
            }
            chatBusy = true;
            try {
                const id = engineId();
                const eng = engineFor(id);
                // The screenshot this feature answers: llama.cpp's own web UI
                // saying "Server unavailable". Here the app STARTS it instead.
                if (cfg.autoStart && runner) {
                    const up = await ensureEngine(id, model);
                    if (!up.ok) {
                        return { ok: false, say: up.say };
                    }
                } else if (!(await eng.reachable())) {
                    return { ok: false, say: eng.name + ' is not answering on ' + eng.base + ' — start it under Settings → Engine.' };
                }
                // The question joins the thread BEFORE the call: it was said,
                // whatever the model does about it.
                chatThread = chatMod.chatPush(chatThread, { role: 'user', text: t, at: nightMod.hhmm() });
                writeChat();
                const r = await eng.chat(chatMod.chatForModel(chatThread), model, {
                    temperature: 0.7, maxTokens: 900, timeoutMs: 180000,
                });
                if (!r.ok) {
                    return { ok: false, say: r.say };
                }
                chatThread = chatMod.chatPush(chatThread, { role: 'assistant', text: r.text, at: nightMod.hhmm() });
                writeChat();
                if (startedModel && runner) {
                    armIdleStop();
                }
                return { ok: true, reply: r.text, ms: r.ms, tokensPerSec: r.tokensPerSec, model: model };
            } finally {
                chatBusy = false;
            }
        },
        chatClear() {
            chatThread = [];
            writeChat();
            return { ok: true };
        },

        // Where the queue lives, so the window can offer to open it.
        siteHomeUrl() {
            const u = configMod.siteUrl(cfg);
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
