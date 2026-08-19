// ============================================================
//  main.js — the Electron main process: the window, the menu, the clock, and
//  the power assertion. The ONLY part of this app that cannot be tested in the
//  repo's CI, and it is deliberately the smallest part.
//
//  Everything with a decision in it lives in src/core and is driven by
//  test/core-test.js with no Electron, no model and no Mac. What is left here
//  is window-opening and wiring, which is why it is short: the honest deal is
//  that the untested surface should be the part where being wrong is obvious
//  the first time you launch it.
//
//  THE SECURITY POSTURE, stated once. The renderer has no Node
//  (contextIsolation on, nodeIntegration off, sandbox on), so the window cannot
//  read a file, spawn anything or reach the network — its own CSP even sets
//  connect-src 'none'. Every capability it has is one of the named channels
//  below, and the secret never crosses them: the window can say "store this"
//  and "is one stored", never "what is it".
// ============================================================
'use strict';
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, powerSaveBlocker, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { makeApi } = require('./core/api');
const { makeUpdater } = require('./core/updater');
const runnerMod = require('./core/runner');

let win = null;
let api = null;
let tick = null;
let blockerId = -1;

// ── THE MODEL SERVER ─────────────────────────────────────────────────────
//  The only thing this app spawns, and the only place it can.
//
//  Every DECISION about it is in core/runner.js and under test: which binary,
//  from which paths, with which arguments, whether the model path is allowed,
//  and what an exit means in words. What is left here is the twenty lines that
//  cannot be tested without a Mac and a copy of llama.cpp — start it, watch for
//  it to answer, and make sure it dies when we do.
//
//  READY MEANS ANSWERING, NOT RUNNING. A spawned llama-server exists
//  immediately and cannot be asked anything for tens of seconds while it loads
//  the model, so "started" is polled against the engine's own `/v1/models`
//  rather than against the process. Reporting a green light on a process that
//  is still reading nine gigabytes off an SSD would be the invented-progress
//  failure the pay screen's narration rules already forbid.
//
//  AND IT NEVER OUTLIVES THE APP. A stray llama-server holding the model in
//  memory until the next reboot is a real cost, so it is killed on quit, on an
//  unexpected exit of this process, and by `stop()` when a run that started it
//  has finished.
let child = null;
let childErr = '';

function makeProcessRunner() {
    return {
        status() {
            return { running: !!child };
        },

        async start(o) {
            if (child) {
                return { ok: true, ms: 0 };
            }
            const began = Date.now();
            childErr = '';
            let c;
            try {
                c = spawn(o.bin, o.args, {
                    // No shell, ever: the arguments are an array from
                    // runnerArgs() and must never be re-parsed by one.
                    shell: false,
                    // Tied to this process, so it cannot be left behind.
                    detached: false,
                    stdio: ['ignore', 'ignore', 'pipe'],
                });
            } catch (e) {
                return { ok: false, say: runnerMod.failSay(e && e.code, String(e && e.message)) };
            }
            child = c;
            let exited = null;
            // Keep only the TAIL. llama-server prints a great deal at startup
            // and the useful line is always the last one.
            c.stderr.on('data', function (b) {
                childErr = (childErr + String(b)).slice(-4000);
            });
            c.on('exit', function (code) { exited = code === null ? -1 : code; if (child === c) { child = null; } });
            c.on('error', function (e) { childErr += '\n' + String(e && e.message); });

            const deadline = began + runnerMod.READY_TIMEOUT_MS;
            while (Date.now() < deadline) {
                if (exited !== null) {
                    return { ok: false, say: runnerMod.failSay(exited, childErr) };
                }
                if (await o.reachable()) {
                    return { ok: true, ms: Date.now() - began };
                }
                await new Promise(function (r) { setTimeout(r, runnerMod.READY_POLL_MS); });
            }
            // Never leave one running that we have given up on: it holds the
            // port, so the next attempt would fail for a different reason.
            this.stop();
            return { ok: false, say: runnerMod.timeoutSay(o.base) };
        },

        stop() {
            const c = child;
            if (!c) {
                return { ok: false, say: 'Nothing to stop — this app is not running one.' };
            }
            child = null;
            try {
                c.kill('SIGTERM');
                // A model server mid-load can ignore SIGTERM; this is the
                // backstop, and it is a no-op once the process has gone.
                setTimeout(function () { try { c.kill('SIGKILL'); } catch (e) { /* gone */ } }, 4000);
            } catch (e) {
                return { ok: false, say: 'Could not stop it: ' + (e && e.message ? e.message : 'unknown') };
            }
            return { ok: true, say: 'Stopped.' };
        },
    };
}

function killChild() {
    if (child) {
        try { child.kill('SIGKILL'); } catch (e) { /* gone */ }
        child = null;
    }
}

// ── THE MENU BAR (the redesign's sixth point). The asks only answer while
// the app runs, so the app must be comfortable to LEAVE running: the crown
// lives in the menu bar with the state and the two actions that matter, and
// closing the window keeps everything listening (window-all-closed already
// stays running — the tray is what makes that legible). The icon is a real
// TEMPLATE image (rendered from the site's own crown), so macOS inks it for
// whichever menu-bar appearance is in force.
const TRAY_PNG_2X = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACIUlEQVR4nOyXu0scURTGP5MlIalCCAQhCUGDIYFAIEkVAiFImqRIE0UtLPwLLEQ7bRVbWwtFRVSwsRCfjRbi+4GFD7AQRETFQgUf+B3nXPfudWYdd0e32Q9+cObO3HO+OffuzGwMGVYMGVbWQMYNPER6qiOvyDxSVDodqCC1Gj8izUhBOUhNBfDu+rEeH5LPZAW31APcXnK3PVZx0VPSiRQ66u6Bf+QrWUgyp16vEzWRKfKN5JInZCBgnnS7hnwnY/agkbRwRuM2Uk7OnCS/Sb/GS2o2R0180PFCMuTMkxttIaV6LIYnJbCX4MiKy0g7Ejv0QpOITkgxOdZ5RTomatVrjWRZOqziogMT2AZWkShJ2oX4ukqSlxpXwuuA0SKp0jhXrzXFe8l/J/eaCdxfwQZ544z1kRHSaB3/hb9k/QstkxL/8anxNsiAFPqJYG2Rj2Qv4Ly0fhmJSwCfGr/MgfszNK3ZJXla0FZZkuKiHVLijG3Cu+N9p0ZSA8/VxA+yrWMNZBg3axDx5drSHLLpnjk1LuU+ONatOJ9Mk0/kPRlHeFXD2ysT8J6SX6xzoQ28UwPbiHchrM7JqJPLr8Y1A7a7fEQnO1fC+8LdA7LuBz6TojKwZ+X3NSAyDvMQnUyuNfeEnwGzRnfRgXWEMGBcyhMx3S8maI7XTu4rxZIYEJ0iWoUyMIe706w7EPRJJq/OAkQreWN2I6SBe1P2j0nWwAUAAAD//+fqWSoAAAAGSURBVAMAAOZlDuQ/dZkAAAAASUVORK5CYII=';
let tray = null;
function traySays() {
    // Cheap facts only — api.quick() never probes an engine, because this
    // line is rebuilt every half-minute for as long as the app lives.
    const q = api && api.quick ? api.quick() : { secretSet: false, running: false, asksToday: 0 };
    if (q.running) { return 'Working…'; }
    if (!q.secretSet) { return 'Not connected yet — open the window'; }
    return 'Listening — ' + q.asksToday + ' ask' + (q.asksToday === 1 ? '' : 's') + ' answered today';
}
function trayMenu() {
    return Menu.buildFromTemplate([
        { label: traySays(), enabled: false },
        { type: 'separator' },
        { label: 'Run tonight’s work now',
            click: function () { if (api && api.runNow) { api.runNow().catch(function () { /* said in the log */ }); } } },
        { label: 'Open the window',
            click: function () { if (win) { win.show(); win.focus(); } else { create(); } } },
        { type: 'separator' },
        { label: 'Quit Blakeney Hand', role: 'quit' },
    ]);
}
function startTray() {
    try {
        const img = nativeImage.createFromBuffer(Buffer.from(TRAY_PNG_2X, 'base64'), { scaleFactor: 2 });
        img.setTemplateImage(true);
        tray = new Tray(img);
        tray.setToolTip('Blakeney Hand');
        tray.setContextMenu(trayMenu());
        // The state line has to be fresh WHEN THE MENU OPENS. Electron's
        // context menu is a snapshot, so it is rebuilt on a slow clock — and
        // askTick's own completions refresh it too (see startAskPoll).
        setInterval(function () { if (tray) { tray.setContextMenu(trayMenu()); } }, 30000);
    } catch (e) {
        tray = null; // no tray is a smaller failure than no app
    }
}

function create() {
    win = new BrowserWindow({
        width: 1040,
        height: 680,
        minWidth: 760,
        minHeight: 520,
        title: 'Cottage Holidays Blakeney',
        // There is no title-bar band at all (macOS 26 pass): the sidebar is a
        // floating glass slab and the traffic lights sit over its top-left
        // corner, so they are placed to sit inside that slab's inset.
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 22, y: 22 },
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
        },
    });
    win.once('ready-to-show', function () { win.show(); });
    win.loadFile(path.join(__dirname, 'ui', 'index.html'));

    // A link in the window opens in the browser, never in the app. There should
    // not be any, but "should not" is not a control.
    win.webContents.setWindowOpenHandler(function (d) {
        if (/^https:\/\//.test(d.url)) {
            shell.openExternal(d.url);
        }
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', function (e) { e.preventDefault(); });
    win.on('closed', function () { win = null; });
}

// ── the menu ─────────────────────────────────────────────────────────────
function menu() {
    const isMac = process.platform === 'darwin';
    // THE APP MENU IS WRITTEN OUT, not `{ role: 'appMenu' }`, for one reason:
    // Check for Updates… belongs directly under About, where every Mac app
    // puts it and where people go looking for it. The role gives the standard
    // menu with no way to insert into it, so the standard menu is restated
    // here — About, the update item, Services, the three Hides, Quit, in
    // Apple's own order — and nothing else about it changes.
    const appMenu = {
        label: app.name,
        submenu: [
            { role: 'about' },
            {
                label: 'Check for Updates…',
                click: function () { openUpdates(); },
            },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
        ],
    };
    const template = [
        ...(isMac ? [appMenu] : []),
        {
            label: 'Run',
            submenu: [
                { label: 'Run tonight’s work now', accelerator: 'Cmd+R', click: function () { runNow(); } },
                { type: 'separator' },
                {
                    label: 'Open the website',
                    click: function () {
                        const u = api && api.siteHomeUrl();
                        if (u) { shell.openExternal(u); }
                    },
                },
                {
                    label: 'Show the models folder',
                    click: function () {
                        const c = api && api._cfg();
                        if (c && c.modelsDir) { shell.openPath(c.modelsDir); }
                    },
                },
            ],
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [{
                label: 'About the overnight queue',
                click: function () {
                    dialog.showMessageBox({
                        type: 'info',
                        message: 'Cottage Holidays Blakeney',
                        detail: 'Drafts work overnight on this Mac and leaves it on your website for you to read.'
                            + '\n\nNothing it writes is ever sent, published or charged: every job posts a draft, and the'
                            + ' website refuses anything that tries to do more.',
                        buttons: ['Right'],
                    });
                },
            }],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Show the update panel, checking afresh on the way in.
//
// IT HAS TO BE ABLE TO MAKE A WINDOW. Closing the window does not quit this
// app — it has to be there at two in the morning — so the menu bar is reachable
// with no window at all, and a Check for Updates… that quietly did nothing in
// that state would be the commonest way anyone ever used it.
function openUpdates() {
    if (!win || win.isDestroyed()) {
        create();
    }
    const send = function () {
        if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
            win.webContents.send('hand:openUpdates');
        }
    };
    // A window created a moment ago has not loaded its script yet, so the
    // message would land on nobody.
    if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', send);
    } else {
        send();
    }
}

// ── keeping the Mac awake for a run, and letting it go afterwards ─────────
function hold() {
    const c = api && api._cfg();
    if (!c || !c.keepAwake || blockerId !== -1) {
        return;
    }
    try {
        blockerId = powerSaveBlocker.start('prevent-app-suspension');
    } catch (e) {
        blockerId = -1;
    }
}
function release() {
    if (blockerId === -1) {
        return;
    }
    try {
        powerSaveBlocker.stop(blockerId);
    } catch (e) { /* already gone */ }
    blockerId = -1;
}

// ── running ──────────────────────────────────────────────────────────────
async function runNow(openingNote) {
    if (!api) {
        return { ok: false, say: 'The app is still starting.' };
    }
    hold();
    try {
        return await api.runNow(function (p) {
            if (win && !win.isDestroyed()) {
                win.webContents.send('hand:progress', p);
            }
        }, openingNote);
    } finally {
        release();
        if (win && !win.isDestroyed()) {
            win.webContents.send('hand:progress', { done: true });
        }
    }
}

// THE CLOCK. A minute tick rather than a single long timer, because a Mac that
// sleeps or has its clock changed makes a one-shot timer fire at the wrong time
// or not at all. It fires when the wall clock passes the run time and not again
// until the next day — the same "did this day already run" test the site's own
// crons use.
function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Did today's run already happen? Read from the SETTINGS, not from a variable.
// It was `let lastRunDay = ''`, which a restart cleared — so quitting and
// reopening the app inside the run window ran the night a second time. cfg
// .lastRun is stamped by api.runNow and survives.
function ranToday(now) {
    try {
        const last = api._cfg().lastRun;
        if (!last) { return false; }
        return dayKey(new Date(last)) === dayKey(now);
    } catch (e) {
        return false;
    }
}

// THE ASK POLLER. Every twenty seconds while the app runs, ask the site
// whether the owner is waiting on anything — the daytime half of the queue.
// api.askSweep() carries every guard (skips mid-night-run, quiet on the
// refusals a resident poller meets all day), so this stays a dumb timer. An
// answered ask pokes the window so Tonight's day line updates itself.
let askTick = null;
function startAskPoll() {
    clearInterval(askTick);
    askTick = setInterval(async function () {
        try {
            if (!api) { return; }
            const out = await api.askSweep();
            if (tray && out && (out.answered || out.failed)) { tray.setContextMenu(trayMenu()); }
            if (out && out.answered && win && !win.isDestroyed()) {
                win.webContents.send('hand:ran', true);
            }
        } catch (e) { /* a bad poll must never stop the poller */ }
    // Two seconds, not twenty: the sweep long-polls the site for up to 20s
    // and guards itself against overlap (api.askSweep's sweeping flag), so
    // this tick is just "re-arm the listen immediately" — the Mac is
    // effectively always listening while the app runs.
    }, 2000);
}

// OPEN AT LOGIN, applied through macOS's own login-items mechanism so it is
// visible (and removable) in System Settings → General → Login Items like any
// other app. Applied at boot and after every settings save; setting it to the
// value it already holds is a no-op, so this is safe to call freely.
// THE APP MOVES ITSELF, so nobody has to drag it out of Downloads or —
// worse — run it off the read-only disk image for ever. Electron's
// moveToApplicationsFolder() copies/moves and relaunches from the new home;
// the JUDGEMENT of whether to offer lives in core/update.js where it is
// gated, and "Not now" is remembered so the question is asked exactly once.
function maybeOfferMove() {
    try {
        const updateMod = require('./core/update');
        const cfg = api._cfg();
        if (!updateMod.shouldOfferMove({
            isMac: process.platform === 'darwin',
            packaged: app.isPackaged,
            inApplications: app.isInApplicationsFolder(),
            declined: !!cfg.moveDeclined,
        })) {
            return;
        }
        const { dialog } = require('electron');
        const pick = dialog.showMessageBoxSync({
            type: 'question',
            message: 'Move to your Applications folder?',
            detail: 'Cottage Holidays Blakeney can move itself there now — nothing to drag. Your settings, models and key are kept either way.',
            buttons: ['Move to Applications', 'Not now'],
            defaultId: 0,
            cancelId: 1,
        });
        if (pick === 0) {
            // Relaunches from the new location by itself; a failure (no
            // permission, disk full) leaves the app running where it is.
            app.moveToApplicationsFolder();
            return;
        }
        api.saveConfig({ moveDeclined: true });
    } catch (e) { /* an offer that cannot be made is simply not made */ }
}

function applyLoginItem() {
    try {
        if (process.platform === 'darwin' && api) {
            app.setLoginItemSettings({ openAtLogin: !!api._cfg().openAtLogin });
        }
    } catch (e) { /* a login item we cannot set must not break the app */ }
}

function startClock() {
    clearInterval(tick);
    tick = setInterval(async function () {
        try {
            const c = api._cfg();
            const at = (c.jobs.reply || {}).at || '02:00';
            const m = /^(\d{1,2}):(\d{2})$/.exec(at);
            if (!m) {
                return;
            }
            const now = new Date();
            if (ranToday(now)) {
                return;
            }
            const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2], 0, 0);
            // PAST THE TIME IS PAST THE TIME — no window.
            //
            // This used to require `now - due < 3600000`, an hour's grace for a
            // Mac that was asleep at 02:00 and woke at 02:40. Anything longer
            // and the night was skipped ENTIRELY, silently, with no log line —
            // so a Mac that sleeps overnight, which is most of them, would have
            // done nothing at all, every night, for ever, while the app sat
            // there looking like it was working. That is the worst failure this
            // app has available to it.
            //
            // The work is "draft replies to the enquiries that are waiting". It
            // is no less useful at 09:00 than at 02:00 — the owner reads it in
            // the morning either way — so a missed night runs on the next tick
            // after the Mac is awake, and says that is what happened.
            if (now >= due) {
                const lateBy = Math.round((now - due) / 60000);
                const note = lateBy > 60
                    ? 'ran ' + (lateBy >= 120 ? Math.round(lateBy / 60) + ' hours' : lateBy + ' minutes')
                        + ' after ' + at + ' — this Mac was not awake at the run time'
                    : '';
                await runNow(note);
                if (win && !win.isDestroyed()) {
                    win.webContents.send('hand:ran', true);
                }
            }
        } catch (e) { /* a bad tick must never stop the clock */ }
    }, 60000);
}

// ── channels ─────────────────────────────────────────────────────────────
// One handler per api method, named, and nothing generic: a single
// "call any method" channel would hand the renderer the whole module.
function wire() {
    ipcMain.handle('hand:state', function () { return api.state(); });
    ipcMain.handle('hand:saveConfig', async function (e, patch) {
        const r = await api.saveConfig(patch);
        applyLoginItem();
        return r;
    });
    ipcMain.handle('hand:setSecret', function (e, v) { return api.setSecret(v); });
    ipcMain.handle('hand:connect', function (e, code) { return api.connect(code); });
    ipcMain.handle('hand:testSite', function () { return api.testSite(); });
    ipcMain.handle('hand:searchModels', function (e, term) { return api.searchModels(term); });
    ipcMain.handle('hand:modelFiles', function (e, id) { return api.modelFiles(id); });
    ipcMain.handle('hand:downloadModel', function (e, row) {
        return api.downloadModel(row, function (p) {
            if (win && !win.isDestroyed()) {
                win.webContents.send('hand:download', p);
            }
        });
    });
    ipcMain.handle('hand:runNow', function () { return runNow(); });
    ipcMain.handle('hand:startEngine', function () { return api.startEngine(); });
    ipcMain.handle('hand:stopEngine', function () { return api.stopEngine(); });

    // ── THE BUILT-IN UPDATER ──────────────────────────────────────────────
    // Checking and downloading happen HERE, in the main process: the window has
    // connect-src 'none' and no way to reach the network at all, which is the
    // point of that CSP. It gets a verdict and a progress number, nothing else.
    //
    // The last step is `shell.openPath`, which mounts the disk image and stops.
    // This app does NOT replace itself — see the header of core/update.js: with
    // no code signature the only guard on a downloaded binary is a checksum
    // served by the same host as the binary, so installing unattended would
    // trust one server completely. Mounting it and letting a person drag it
    // across is the honest end of the chain.
    ipcMain.handle('hand:checkUpdate', function () { return updater().check(); });
    ipcMain.handle('hand:downloadUpdate', function (e, v) {
        return updater().download(v, function (p) {
            if (win && !win.isDestroyed()) { win.webContents.send('hand:updateProgress', p); }
        });
    });
    ipcMain.handle('hand:openFile', function (e, f) {
        // Only ever the file this app just downloaded and verified — never an
        // arbitrary path from the window.
        if (!lastVerified || String(f) !== lastVerified) {
            return { ok: false, say: 'That file was not one this app downloaded.' };
        }
        shell.openPath(lastVerified);
        return { ok: true };
    });
    ipcMain.handle('hand:openUrl', function (e, u) {
        const s = String(u || '');
        if (!/^https:\/\//i.test(s)) { return { ok: false, say: 'Only https addresses are opened.' }; }
        shell.openExternal(s);
        return { ok: true };
    });
}

// One updater, built lazily so it reads the version the app is actually
// running rather than one captured at load.
let lastVerified = '';
let _upd = null;
function updater() {
    if (!_upd) {
        _upd = makeUpdater({ currentVersion: appVersion() });
        const raw = _upd.download.bind(_upd);
        // Remember what was verified, so openFile cannot be pointed anywhere else.
        _upd.download = async function (v, onp) {
            const r = await raw(v, onp);
            if (r && r.ok && r.file) { lastVerified = r.file; }
            return r;
        };
    }
    return _upd;
}

// The version this copy reports. app.getVersion() reads the packaged
// Info.plist; the RELEASE tag is what the feed compares against, and CI writes
// it into the bundle at build time (see mac-app.yml). Falling back to
// package.json's version keeps `npm start` from claiming to be up to date.
function appVersion() {
    // THE RELEASE TAG, WRITTEN IN AT BUILD TIME. This matters more than it
    // looks: package.json's version is a semver ("1.0.0") while every tag CI
    // publishes is dated ("hand-build-20260818-0842"), and update.js ranks a
    // dated build above any semver — so an app that reported its package
    // version would announce an update for ever, including the minute after
    // you installed it. mac-app.yml writes release.json before packaging.
    try {
        const rel = require('./release.json');
        if (rel && rel.tag) { return String(rel.tag); }
    } catch (e) { /* running from source: fall through */ }
    try {
        return String(process.env.CHB_RELEASE_TAG || app.getVersion() || '');
    } catch (e) {
        return '';
    }
}

app.whenReady().then(function () {
    api = makeApi({
        runner: makeProcessRunner(),
        // Where a bundled llama-server lives inside the packaged app. Undefined
        // outside a package (`npm start`), where resolveRunner falls through to
        // Homebrew — which is exactly the pre-bundling behaviour.
        resourcesDir: process.resourcesPath || '',
        // Reported to the site with each poll, so Set up a Mac can say which
        // build each Mac runs (integration step 4).
        build: appVersion(),
    });
    wire();
    menu();
    maybeOfferMove();
    create();
    startTray();
    startClock();
    startAskPoll();
    applyLoginItem();
    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) {
            create();
        }
    });
});

// CLOSING THE WINDOW DOES NOT QUIT. The whole point is a machine that works
// overnight, and an app that quits when its window closes would not be there at
// two in the morning. Quit from the menu (or Cmd+Q) when you mean it.
app.on('window-all-closed', function () { /* stay running */ });
app.on('before-quit', function () { release(); clearInterval(tick); killChild(); });
// The belt to before-quit's braces: a crash or a signal skips app events, and a
// model server left holding the Mac's memory is the one piece of this app that
// outlives it if nobody says otherwise.
process.on('exit', killChild);
process.on('SIGINT', function () { killChild(); process.exit(0); });
process.on('SIGTERM', function () { killChild(); process.exit(0); });
