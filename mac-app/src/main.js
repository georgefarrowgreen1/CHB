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
const { app, BrowserWindow, Menu, shell, ipcMain, powerSaveBlocker, dialog } = require('electron');
const path = require('path');
const { makeApi } = require('./core/api');
const { makeUpdater } = require('./core/updater');

let win = null;
let api = null;
let tick = null;
let blockerId = -1;

function create() {
    win = new BrowserWindow({
        width: 1040,
        height: 680,
        minWidth: 760,
        minHeight: 520,
        title: 'Cottage Holidays Blakeney',
        // The window draws its own title bar (see .titlebar in app.css), which
        // is why the traffic lights are inset rather than sitting on a strip of
        // chrome above the app's own.
        titleBarStyle: 'hiddenInset',
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
    const template = [
        ...(isMac ? [{ role: 'appMenu' }] : []),
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
async function runNow() {
    if (!api) {
        return { ok: false, say: 'The app is still starting.' };
    }
    hold();
    try {
        return await api.runNow(function (p) {
            if (win && !win.isDestroyed()) {
                win.webContents.send('hand:progress', p);
            }
        });
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
let lastRunDay = '';
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
            const day = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
            if (day === lastRunDay) {
                return;
            }
            const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2], 0, 0);
            // A window of an hour after the time, so a Mac that was asleep at
            // 02:00 and woke at 02:40 still does the night's work.
            if (now >= due && now - due < 3600000) {
                lastRunDay = day;
                await runNow();
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
    ipcMain.handle('hand:saveConfig', function (e, patch) { return api.saveConfig(patch); });
    ipcMain.handle('hand:setSecret', function (e, v) { return api.setSecret(v); });
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
    api = makeApi({});
    wire();
    menu();
    create();
    startClock();
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
app.on('before-quit', function () { release(); clearInterval(tick); });
