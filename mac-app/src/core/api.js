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
const chatToolsMod = require('./chattools');

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
    // THE CHAT — a titled list of conversations, on this Mac only (the
    // nights.json posture). chatStore adopts a v1 single-thread file, so an
    // update never loses what was already said.
    function readChat() {
        const p = configMod.paths(dir);
        try {
            return chatMod.chatStore(JSON.parse(require('fs').readFileSync(p.chat, 'utf8')), now().getTime());
        } catch (e) {
            return chatMod.chatStore(null, 0);
        }
    }
    function writeChat() {
        const p = configMod.paths(dir);
        try {
            require('fs').mkdirSync(p.dir, { recursive: true });
            require('fs').writeFileSync(p.chat, JSON.stringify(chatDb), 'utf8');
        } catch (e) { /* a thread we cannot write still works for this session */ }
    }
    let chatDb = readChat();
    let chatBusy = false;
    // Thread ids carry a counter beside the clock: two conversations minted
    // in the same millisecond (a test, a fast hand) must never share an id —
    // a shared id makes pick ambiguous and delete a double delete.
    let chatSeq = 0;
    // The Stop button's handle: aborting is a DECISION about the reply in
    // flight, so the controller lives per send and dies with it.
    let chatAbort = null;
    // What the window hears while a reply streams. Injected by main.js as a
    // webContents.send; absent (tests, bare node) events go nowhere and the
    // return value still carries the whole answer.
    const chatPushEv = typeof d.push === 'function' ? d.push : function () {};
    function chatCur() {
        const t = chatDb.threads.filter(function (x) { return x.id === chatDb.cur; })[0];
        return t || null;
    }
    function chatEnsureThread() {
        if (!chatCur()) {
            chatDb = chatMod.chatThreadNew(chatDb, 'c' + now().getTime() + '-' + (++chatSeq), now().getTime());
        }
        return chatCur();
    }
    function chatHistoryOut() {
        const cur = chatCur();
        return {
            ok: true,
            cur: chatDb.cur,
            threads: chatDb.threads.map(function (t) {
                return { id: t.id, title: t.title, at: t.at, n: t.msgs.length };
            }),
            thread: (cur || { msgs: [] }).msgs.slice(),
            instr: (cur && cur.instr) || '',
            model: chatModelId(),
        };
    }
    // The loaded context window, measured once per session — /props is cheap
    // but the number only changes when the server restarts with new flags.
    let chatCtx = 0;
    // ── THE CHAT'S SHARED CORE — the local screen and the WEB CHAT (the
    // ask channel's ownerchat kind) run the SAME machinery, split in two so
    // each caller keeps its own order: chatEngineUp brings the engine up and
    // measures the meter's denominator; chatLoop is the bounded tool loop.
    // `ev` hears the same events the window does ({round}/{think}/{tok}/
    // {tool}/{tool_done}); the web chat turns them into streamed partials.
    async function chatEngineUp(model) {
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
        // THE METER'S DENOMINATOR — measured once (llama.cpp /props),
        // 0 when the engine does not report, and 0 shows NO meter:
        // a guessed meter is worse than none.
        if (!chatCtx && eng.props) {
            try { chatCtx = (await eng.props()).ctx || 0; } catch (e) { chatCtx = 0; }
        }
        return { ok: true, eng: eng };
    }
    // ── THE TOOL LOOP — the model may LOOK THINGS UP (chattools.js
    // owns the protocol; the site's chat_tool action owns the door).
    // Every path is bounded: lookups cap at CHAT_TOOL_ROUNDS, a
    // fumbled call gets ONE grammar-constrained retry, and both
    // latches are one-way — the loop always ends at a sentence.
    // STREAMED: every round streams over `ev` as it decodes — { think }
    // for a reasoning model's own thinking (the reasoning_content field
    // or an in-content <think> block, split live by chat.js's state
    // machine), { tok } for answer text, { round } opening each round so
    // a watcher can discard one that turns out to be a tool call,
    // { tool }/{ tool_done } around each lookup. The RETURN VALUE carries
    // the whole answer — events are a watcher's luxury, never the record.
    async function chatLoop(eng, turns, instr, model, ev, signal, img) {
        let toolsOn = !!(configMod.siteUrl(cfg) && secrets.get());
        const site = toolsOn ? siteFor() : null;
        let extra = toolsOn ? chatToolsMod.chatToolsIntro(siteMod.today(now())) : '';
        // The STANDING INSTRUCTION joins the system content — typed by
        // the owner or absent, never written by the app.
        if (instr) {
            extra += (extra ? '\n\n' : '')
                + 'The owner’s standing instruction for this conversation: ' + instr;
        }
        let msgs = chatMod.chatForModel(turns, '', extra);
        // A PHOTO joins the NEWEST turn as OpenAI content parts — the question
        // and its image are one message, exactly as the fenced document rule
        // keeps a question with its file. Only offered when the caller already
        // established the engine can see (props().vision), so a text-only
        // server never receives parts it would refuse.
        if (img) {
            const lastM = msgs[msgs.length - 1];
            if (lastM && lastM.role === 'user' && typeof lastM.content === 'string') {
                lastM.content = [
                    { type: 'text', text: lastM.content },
                    { type: 'image_url', image_url: { url: String(img) } },
                ];
            }
        }
        // TRIM HONESTY: how many stored turns no longer travel.
        const dropped = Math.max(0, turns.length - (msgs.length - 1));
        const used = [];
        let lookups = 0;
        let grammarNext = false;
        let fumbled = false;
        let thinkAll = '';
        let answer = '';
        let stopped = false;
        let r = null;
        for (;;) {
            const split = chatMod.chatThinkStream();
            ev({ t: 'round' });
            r = await eng.chatStream(msgs, model, {
                // The retry runs cool: a constrained decode at chat
                // temperature wanders inside the grammar's freedoms.
                temperature: grammarNext ? 0.2 : 0.7,
                maxTokens: 900, timeoutMs: 180000, signal: signal,
                grammar: grammarNext ? chatToolsMod.chatToolGrammar() : '',
            }, function (e2) {
                if (e2.think) { ev({ t: 'think', s: e2.think }); }
                if (e2.token) {
                    const bits = split(e2.token);
                    if (bits.think) { ev({ t: 'think', s: bits.think }); }
                    if (bits.answer) { ev({ t: 'tok', s: bits.answer }); }
                }
            });
            if (!r.ok) {
                return { ok: false, say: r.say };
            }
            // The authoritative split runs on the WHOLE text — the live
            // one above only routed the paint.
            const parts = chatMod.chatThinkSplit(r.text);
            thinkAll += (r.think ? r.think + '\n' : '') + (parts.think ? parts.think + '\n' : '');
            if (r.stopped) {
                stopped = true;
                answer = parts.answer;
                break;
            }
            const call = toolsOn ? chatToolsMod.chatToolCall(parts.answer) : null;
            if (!call) {
                answer = parts.answer;
                break;
            }
            if (call.bad) {
                if (!fumbled) {
                    // It TRIED — re-run the same turn with the decode
                    // constrained so the call is valid by construction.
                    fumbled = true;
                    grammarNext = true;
                    continue;
                }
                msgs = msgs.concat([
                    { role: 'assistant', content: parts.answer },
                    { role: 'user', content: 'That tool call was not valid (' + call.bad + '). Answer in plain words instead.' },
                ]);
                toolsOn = false;
                grammarNext = false;
                continue;
            }
            grammarNext = false;
            if (lookups >= chatToolsMod.CHAT_TOOL_ROUNDS) {
                msgs = msgs.concat([
                    { role: 'assistant', content: parts.answer },
                    { role: 'user', content: 'No more lookups this message — answer now, in plain words, from what you already have.' },
                ]);
                toolsOn = false;
                continue;
            }
            lookups++;
            ev({ t: 'tool', name: call.tool });
            const res = await site.chatTool(call.tool, call.args);
            if (used.indexOf(call.tool) < 0) { used.push(call.tool); }
            // The payload rides the event so THIS SESSION can show
            // "what did it see" — it is deliberately not stored, so
            // chats.json keeps words, not records.
            ev({
                t: 'tool_done', name: call.tool, ok: !!res.ok,
                data: res.ok ? res.data : { error: (res.refusal && res.refusal.say) || 'the website did not answer' },
            });
            // A refused lookup travels back as a RESULT saying so — the
            // model then answers honestly rather than the send dying on
            // a switch the owner can flip.
            const resultBody = res.ok
                ? chatToolsMod.chatToolResultMsg(call.tool, res.data)
                : chatToolsMod.chatToolResultMsg(call.tool, { error: (res.refusal && res.refusal.say) || 'the website did not answer' });
            msgs = msgs.concat([
                { role: 'assistant', content: parts.answer },
                { role: 'user', content: resultBody },
            ]);
        }
        return {
            ok: true, answer: answer, think: thinkAll.trim(), used: used,
            stopped: stopped, dropped: dropped, ms: r.ms, tokensPerSec: r.tokensPerSec,
            ctxUsed: (r.promptTokens || 0) + (r.tokens || 0),
        };
    }
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
                // Paired by name from the same Models folder; '' means a
                // text-only launch, exactly as before this existed.
                mmproj: modelsMod.projectorFor(model, cfg.modelsDir),
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
            // A vision repo's projector downloads BESIDE its model — the
            // companion llama-server takes via --mmproj, without which the
            // model reads text only. Best-effort: a failed companion never
            // fails the model, it just means no vision until re-fetched.
            if (r && r.ok && row.mmproj && row.mmproj.url && row.mmproj.filename) {
                const pSafe = String(row.mmproj.filename).replace(/[^A-Za-z0-9._-]/g, '_');
                if (/\.gguf$/i.test(pSafe) && modelsMod.isProjector(pSafe)) {
                    try {
                        const pr = await modelsMod.download(String(row.mmproj.url), cfg.modelsDir, pSafe, null, { fetch: fetchImpl });
                        if (pr && pr.ok) {
                            r.say = (r.say ? r.say + ' ' : '') + 'Its vision file came with it — this model can look at photos.';
                        }
                    } catch (e) { /* the model itself is in hand */ }
                }
            }
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
                    // THE WEB CHAT'S WORKER — the owner talking to this Mac
                    // from their phone, over the same channel. It runs the
                    // LOCAL chat's own core (engine, tools, thinking), holds
                    // chatBusy so the two chats take turns on the engine, and
                    // SKIPS (ask stays open, next sweep is seconds away) when
                    // the owner is mid-send here. `postPartial` streams the
                    // answer-so-far back for the phone to paint.
                    ownerChat: async function (oc, postPartial) {
                        if (chatBusy || running) {
                            return { skip: true };
                        }
                        const model = chatModelId();
                        if (!model) {
                            return { ok: false, say: 'no chat model chosen — pick one on the Chat screen' };
                        }
                        chatBusy = true;
                        try {
                            const up = await chatEngineUp(model);
                            if (!up.ok) {
                                return { ok: false, say: up.say };
                            }
                            const rawTurns = Array.isArray(oc.turns) ? oc.turns : [];
                            const turns = rawTurns.map(function (m) {
                                return { role: (m && m.who) === 'mac' ? 'assistant' : 'user', text: String((m && m.text) || '') };
                            });
                            // A PHOTO rides the newest turn as a REF; the bytes
                            // come through chat_file. Three honest outcomes and
                            // no fourth: the engine can see → the image joins
                            // the turn; it cannot → the model NEVER meets the
                            // photo and the answer says so (a text model must
                            // not bluff a description); the fetch fails → said
                            // plainly, never answered around.
                            let imgUri = '';
                            const lastT = rawTurns[rawTurns.length - 1] || {};
                            const imgRef = typeof lastT.img === 'string' ? lastT.img : '';
                            if (imgRef) {
                                const seen = await up.eng.props();
                                if (!seen.vision) {
                                    return { ok: true, model: model, text: JSON.stringify({
                                        text: 'I can’t see pictures with this model — it reads text only. In the Mac app, download a vision model (its photo file comes along automatically) under Library, pick it for the chat, and send the photo again.',
                                    }) };
                                }
                                const pf = await siteFor().chatFile(imgRef);
                                if (!pf.ok) {
                                    return { ok: true, model: model, text: JSON.stringify({
                                        text: 'I couldn’t fetch that photo from the website just now — send it again in a moment.',
                                    }) };
                                }
                                imgUri = pf.dataUri;
                            }
                            // Rebuild the streaming view from the loop's own
                            // events — the TOOL holdback the window applies,
                            // applied here so a lookup being typed never
                            // paints on the phone either. Throttled: a
                            // partial every ~1.5s is streaming; every token
                            // would be a request per word.
                            let round = '';
                            let think = '';
                            let lastPost = 0;
                            // THE OWNER'S ■ REACHES THE MODEL THROUGH THE
                            // PARTIAL POST'S OWN ANSWER: `held: false` means
                            // the row is no longer open — the owner stopped
                            // it (or a newer send superseded it) — so the
                            // generation aborts and the engine is freed
                            // instead of finishing words nobody is waiting
                            // for. The abort path is the local Stop's own.
                            const oah = new AbortController();
                            const res = await chatLoop(up.eng, turns, String(oc.instr || ''), model, function (e2) {
                                if (e2.t === 'round' || e2.t === 'tool') { round = ''; }
                                if (e2.t === 'think') { think += e2.s || ''; }
                                if (e2.t === 'tok') { round += e2.s || ''; }
                                const show = /^\s*TOOL/.test(round) ? '' : round;
                                const tms = now().getTime();
                                if (postPartial && (show || think) && tms - lastPost >= 1500) {
                                    lastPost = tms;
                                    const pp = postPartial(JSON.stringify({
                                        text: show,
                                        think: think.slice(0, chatMod.CHAT_THINK_CHARS),
                                    }));
                                    if (pp && typeof pp.then === 'function') {
                                        pp.then(function (st) {
                                            if (st && st.ok && st.held === false) { oah.abort(); }
                                        }, function () { /* a blip is never a stop */ });
                                    }
                                }
                            }, oah.signal, imgUri);
                            if (oah.signal.aborted) {
                                // The row is expired at the site; posting the
                                // remainder would only be refused as too late.
                                return { skip: true };
                            }
                            if (!res.ok) {
                                return { ok: false, say: res.say };
                            }
                            return {
                                ok: true,
                                model: model,
                                text: JSON.stringify({
                                    text: res.answer,
                                    think: res.think.slice(0, chatMod.CHAT_THINK_CHARS),
                                    used: res.used,
                                    ms: res.ms,
                                    tps: res.tokensPerSec,
                                }),
                            };
                        } finally {
                            chatBusy = false;
                        }
                    },
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
            return chatHistoryOut();
        },
        // ── CONVERSATIONS. New/pick/delete all answer with the fresh history,
        // so the window never has to guess what a write did.
        chatNew() {
            chatDb = chatMod.chatThreadNew(chatDb, 'c' + now().getTime() + '-' + (++chatSeq), now().getTime());
            writeChat();
            return chatHistoryOut();
        },
        chatPick(id) {
            if (chatDb.threads.some(function (x) { return x.id === id; })) {
                chatDb = { v: 2, cur: String(id), threads: chatDb.threads };
                writeChat();
            }
            return chatHistoryOut();
        },
        chatDelete(id) {
            chatDb = chatMod.chatStore({
                v: 2, cur: chatDb.cur,
                threads: chatDb.threads.filter(function (x) { return x.id !== id; }),
            }, now().getTime());
            writeChat();
            return chatHistoryOut();
        },
        // EDIT = truncate from a user turn and hand its words back — the
        // window refills the box, and the resend is an ordinary chatSend.
        chatTruncate(index) {
            const t = chatCur();
            const i = parseInt(index, 10);
            if (!t || !(i >= 0) || i >= t.msgs.length || t.msgs[i].role !== 'user') {
                return { ok: false, say: 'That message is not editable any more.' };
            }
            const text = t.msgs[i].text;
            t.msgs = t.msgs.slice(0, i);
            if (!t.msgs.length) { t.title = 'New chat'; }
            writeChat();
            const out = chatHistoryOut();
            out.text = text;
            return out;
        },
        // STOP is a decision about the reply in flight — the partial answer is
        // kept (chatSend's own stopped branch owns what that means).
        chatStop() {
            if (chatAbort) { chatAbort.abort(); }
            return { ok: true };
        },
        // REGENERATE: drop the last reply and ask the last question again.
        async chatRegen() {
            if (chatBusy) {
                return { ok: false, say: 'One at a time — the model is still answering.' };
            }
            const t = chatCur();
            if (!t || !t.msgs.length) {
                return { ok: false, say: 'Nothing to regenerate yet.' };
            }
            if (t.msgs[t.msgs.length - 1].role === 'assistant') {
                t.msgs = t.msgs.slice(0, -1);
                writeChat();
            }
            const last = t.msgs.filter(function (m) { return m.role === 'user'; }).pop();
            if (!last) {
                return { ok: false, say: 'Nothing to regenerate yet.' };
            }
            return this.chatSend(last.text, { regen: true });
        },
        async chatSend(text, opts) {
            let t = String(typeof text === 'string' ? text : '').trim().slice(0, chatMod.CHAT_MSG_CHARS);
            const regen = !!(opts && opts.regen);
            // AN ATTACHED TEXT FILE joins the user turn as a fenced block —
            // one message, so the trim can never separate a question from
            // its file. Refused over the cap, never silently cut.
            const attach = (opts && opts.attach && typeof opts.attach === 'object') ? opts.attach : null;
            let fileName = '';
            if (attach) {
                const bad = chatMod.chatAttachProblem(attach.text);
                if (bad !== '') {
                    return { ok: false, say: bad };
                }
                fileName = String(attach.name || 'attached.txt');
                t = chatMod.chatAttachMsg(t, fileName, attach.text);
            }
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
            chatAbort = new AbortController();
            const signal = chatAbort.signal;
            try {
                const up = await chatEngineUp(model);
                if (!up.ok) {
                    return { ok: false, say: up.say };
                }
                const th = chatEnsureThread();
                // The question joins the thread BEFORE the call: it was said,
                // whatever the model does about it — but AFTER the engine is
                // confirmed up, so an engine refusal hands the words back
                // instead of storing a question nothing will answer. A
                // REGENERATE re-asks the question already there.
                if (!regen) {
                    const um = { role: 'user', text: t, at: nightMod.hhmm() };
                    if (fileName) { um.file = fileName; }
                    th.msgs = chatMod.chatPush(th.msgs, um);
                }
                if (th.title === 'New chat') { th.title = chatMod.chatTitle(t); }
                th.at = now().getTime();
                writeChat();
                chatPushEv({ t: 'start', thread: chatDb.cur });
                const res = await chatLoop(up.eng, th.msgs, th.instr || '', model, chatPushEv, signal);
                if (!res.ok) {
                    chatPushEv({ t: 'done', ok: false, say: res.say });
                    return { ok: false, say: res.say };
                }
                // A STOP that landed before any answer stores NOTHING: the
                // question stays, nothing was answered, and regenerate can
                // re-ask. Anything already said is kept — the owner pressed
                // Stop having read it, not to erase it.
                if (res.answer !== '') {
                    th.msgs = chatMod.chatPush(th.msgs, {
                        role: 'assistant', text: res.answer, at: nightMod.hhmm(),
                        think: res.think, used: res.used,
                    });
                    writeChat();
                }
                if (startedModel && runner) {
                    armIdleStop();
                }
                chatPushEv({
                    t: 'done', ok: true, stopped: res.stopped, used: res.used,
                    model: model, ms: res.ms, tokensPerSec: res.tokensPerSec,
                    ctx: chatCtx, ctxUsed: res.ctxUsed, dropped: res.dropped,
                });
                return {
                    ok: true, reply: res.answer, stopped: res.stopped, think: res.think,
                    ms: res.ms, tokensPerSec: res.tokensPerSec, model: model, used: res.used,
                    ctx: chatCtx, ctxUsed: res.ctxUsed, dropped: res.dropped,
                };
                        } finally {
                chatBusy = false;
                chatAbort = null;
            }
        },
        chatClear() {
            const t = chatCur();
            if (t) {
                t.msgs = [];
                t.title = 'New chat';
                writeChat();
            }
            return chatHistoryOut();
        },
        // The conversation's standing instruction. Empty CLEARS it — the way
        // out is the same box the way in was.
        chatInstr(text) {
            const t = chatEnsureThread();
            const v = String(typeof text === 'string' ? text : '').trim().slice(0, chatMod.CHAT_INSTR_CHARS);
            if (v === '') { delete t.instr; } else { t.instr = v; }
            writeChat();
            return chatHistoryOut();
        },
        // A conversation as a Markdown document — the pure formatter's work;
        // main.js owns the save dialog and the file.
        chatExport(id) {
            const t = chatDb.threads.filter(function (x) { return x.id === id; })[0];
            if (!t || !t.msgs.length) {
                return { ok: false, say: 'Nothing in that conversation to save yet.' };
            }
            return { ok: true, title: t.title, md: chatMod.chatExportMd(t.msgs, t.title, '') };
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
