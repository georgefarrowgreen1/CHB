// ============================================================
//  preload.js — the bridge, and the app's whole attack surface from the window.
//
//  Runs with contextIsolation, so `window.hand` is a frozen object of functions
//  and nothing else crosses. Each one is a NAMED channel: there is deliberately
//  no generic "invoke(method, args)", because that would hand the renderer the
//  entire core module and make this file decorative.
//
//  Note what is absent: any way to read the secret. The window can ask to store
//  one and ask whether one exists. That is all it will ever need.
// ============================================================
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hand', {
    state: function () { return ipcRenderer.invoke('hand:state'); },
    saveConfig: function (patch) { return ipcRenderer.invoke('hand:saveConfig', patch); },
    setSecret: function (v) { return ipcRenderer.invoke('hand:setSecret', v); },
    // Hands over a connect code and is told whether it worked. The key it earns
    // never crosses back — same posture as setSecret.
    connect: function (code) { return ipcRenderer.invoke('hand:connect', code); },
    testSite: function () { return ipcRenderer.invoke('hand:testSite'); },
    searchModels: function (term) { return ipcRenderer.invoke('hand:searchModels', term); },
    modelFiles: function (id) { return ipcRenderer.invoke('hand:modelFiles', id); },
    downloadModel: function (row) { return ipcRenderer.invoke('hand:downloadModel', row); },
    runNow: function () { return ipcRenderer.invoke('hand:runNow'); },
    // The updater. `openFile` takes only the path this app downloaded AND
    // verified — main.js checks it against what it last wrote, so the window
    // cannot use this to open anything of its choosing.
    checkUpdate: function () { return ipcRenderer.invoke('hand:checkUpdate'); },
    downloadUpdate: function (v) { return ipcRenderer.invoke('hand:downloadUpdate', v); },
    openFile: function (f) { return ipcRenderer.invoke('hand:openFile', f); },
    openUrl: function (u) { return ipcRenderer.invoke('hand:openUrl', u); },
    onUpdateProgress: function (fn) {
        ipcRenderer.on('hand:updateProgress', function (e, p) { try { fn(p); } catch (err) { /* the window's problem */ } });
    },
    // One-way, main → window: progress while a run is working, and progress
    // while a model downloads. The callback gets the payload and nothing else.
    onProgress: function (fn) {
        ipcRenderer.on('hand:progress', function (e, p) { try { fn(p); } catch (err) { /* the window's problem */ } });
    },
    onDownload: function (fn) {
        ipcRenderer.on('hand:download', function (e, p) { try { fn(p); } catch (err) { /* as above */ } });
    },
    onRan: function (fn) {
        ipcRenderer.on('hand:ran', function () { try { fn(); } catch (err) { /* as above */ } });
    },
});
