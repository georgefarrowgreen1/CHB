// ============================================================
//  runner.js — starting the model server, so nobody has to open a Terminal.
//
//  Until this file existed the app could only ever ASK whether something was
//  answering on localhost (engine.js `reachable()`), and the answer on a fresh
//  Mac was no. The Models screen downloaded a model, the Runner screen said
//  "Not answering", and NOTHING in the app joined those two facts — the step
//  between them was a Homebrew install and a flag-laden command you had to
//  leave a window open for. That is the whole friction this closes.
//
//  WHY THE DECISIONS ARE HERE AND THE SPAWN IS NOT. Everything below is pure:
//  where the binary might live, which arguments it takes, whether a model path
//  is one we are allowed to hand it, and what an exit code means in words. All
//  of it is driven by test/core-test.js with no Mac and no llama.cpp. The
//  actual child_process lives in main.js, which is the deliberately-untested
//  layer — the same deal the clock and the power assertion already have.
//
//  ONE ENGINE IS STARTABLE, AND SAYING SO IS THE HONEST PART. Ollama runs its
//  own background service and manages its own model store; MLX would be a
//  sidecar we do not ship. Only llama.cpp is a binary this app can sensibly
//  start and stop, so `canStart` names it and the other two keep their existing
//  "point at it if you already run one" behaviour rather than pretending.
//
//  THE SAFETY LINE. A spawn is a real widening of what this app can do, so it
//  is narrow by construction: a FIXED binary name from a FIXED list of paths,
//  arguments as an ARRAY (never a shell string), and a model path that must
//  resolve to inside the app's own Models folder. Nothing here ever runs a
//  string the window supplied.
// ============================================================
'use strict';
const path = require('path');
const fs = require('fs');

// The binary llama.cpp's own Homebrew formula installs, and the one its
// releases ship. Fixed on purpose — see the safety note above.
const RUNNER_BIN = 'llama-server';

// What to type if it is nowhere. One place, because the Runner screen prints
// it, the night log names it and the README quotes it.
const INSTALL_HINT = 'brew install llama.cpp';

// Homebrew's two prefixes: /opt/homebrew on Apple silicon, /usr/local on Intel.
// Both are listed regardless of this Mac's architecture — a Mac can carry both
// (Rosetta, or a machine migrated from an Intel one), and looking in the other
// one costs a stat.
const BREW_PREFIXES = ['/opt/homebrew/bin', '/usr/local/bin'];

// Only llama.cpp. See the header.
const STARTABLE = ['llamacpp'];

function canStart(engineId) {
    return STARTABLE.indexOf(String(engineId || '')) !== -1;
}

// Where the binary might be, best first.
//
// ORDER IS A JUDGEMENT: an explicit path the owner set wins over everything,
// because it is the only one they chose; then HOMEBREW, then the copy shipped
// inside the app. Homebrew-before-bundled looks backwards ("surely the copy we
// shipped, whose version we know?") and is deliberate: a bundled binary inside
// an UNSIGNED app arrives quarantined with it, and macOS can refuse to execute
// it even after the app itself has been allowed — at which point, if bundled
// won the order, a Mac with a perfectly good brew copy would go on trying the
// blocked one for ever with no way out short of hand-editing config.json. A
// Homebrew copy was installed by the owner, on purpose, and is never
// quarantined; when both exist it is the one guaranteed to run. The bundled
// copy is the zero-install path for the Mac that has nothing.
function runnerCandidates(opts) {
    const o = opts || {};
    const out = [];
    const custom = String(o.custom || '').trim();
    if (custom) {
        out.push({ path: custom, kind: 'custom' });
    }
    BREW_PREFIXES.forEach(function (dir) {
        out.push({ path: path.join(dir, RUNNER_BIN), kind: 'homebrew' });
    });
    if (o.resourcesDir) {
        out.push({ path: path.join(String(o.resourcesDir), 'runner', RUNNER_BIN), kind: 'bundled' });
    }
    return out;
}

// Is it there AND runnable? A file that exists but is not executable is the
// failure mode of a half-extracted download, and it reports as "found" to any
// check that only stats.
function defaultExists(p) {
    try {
        fs.accessSync(p, fs.constants.X_OK);
        return fs.statSync(p).isFile();
    } catch (e) {
        return false;
    }
}

// The first candidate that is really there. `exists` is injectable so the whole
// resolution is testable on a machine with no llama.cpp anywhere.
function resolveRunner(opts) {
    const o = opts || {};
    const exists = o.exists || defaultExists;
    const list = o.candidates || runnerCandidates(o);
    for (let i = 0; i < list.length; i++) {
        if (exists(list[i].path)) {
            return { ok: true, path: list[i].path, kind: list[i].kind };
        }
    }
    // A refusal NAMES THE FIX. "Not found" on its own is the sentence that
    // sends someone to a search engine.
    const custom = String(o.custom || '').trim();
    return {
        ok: false,
        kind: '',
        path: '',
        say: custom
            ? 'Nothing runnable at ' + custom + ', and llama.cpp is not installed either.'
            : 'llama.cpp is not installed on this Mac yet.',
        install: INSTALL_HINT,
    };
}

// host + port out of an engine's own base URL, so the address is stated ONCE
// (in engine.js's ENGINES) and the arguments cannot drift from the address the
// app then goes looking on.
function hostPort(base) {
    try {
        const u = new URL(String(base || 'http://127.0.0.1:8080'));
        return { host: u.hostname || '127.0.0.1', port: parseInt(u.port, 10) || 8080 };
    } catch (e) {
        return { host: '127.0.0.1', port: 8080 };
    }
}

// The arguments, as an ARRAY. Never a command line.
//
// `-ngl` is the one that matters: without offloading the layers to Metal a
// 14B model on Apple silicon runs at a small fraction of its speed, which
// reads as the app being broken rather than misconfigured. It is passed only
// on Apple silicon — an Intel Mac has no Metal device worth the flag, and some
// CPU-only builds warn about it.
function runnerArgs(opts) {
    const o = opts || {};
    const hp = hostPort(o.base);
    const args = [
        '-m', String(o.modelPath || ''),
        '--host', o.host || hp.host,
        '--port', String(o.port || hp.port),
        '-c', String(o.ctx || 4096),
    ];
    // The model's OWN vision projector, when it has one (models.projectorFor
    // pairs them by name) — this is what lets llama-server accept image parts.
    if (o.mmproj) {
        args.push('--mmproj', String(o.mmproj));
    }
    if (o.appleSilicon) {
        // Clamped by llama.cpp to however many layers the model actually has.
        args.push('-ngl', '999');
    }
    return args;
}

// May we hand this path to the binary?
//
// The model path comes from settings, which the window can write — so it is
// checked here rather than trusted. It must be a .gguf and it must resolve to
// INSIDE the app's own Models folder, which `..` cannot climb out of once both
// sides are resolved.
function modelPathAllowed(modelPath, modelsDir) {
    const p = String(modelPath || '');
    const dir = String(modelsDir || '');
    if (!p || !dir) {
        return false;
    }
    if (!/\.gguf$/i.test(p)) {
        return false;
    }
    const rp = path.resolve(p);
    const rd = path.resolve(dir);
    // The separator matters: without it "/Models-old/x.gguf" passes a plain
    // startsWith against "/Models".
    return rp.indexOf(rd + path.sep) === 0;
}

// ONE decision about whether a start is even possible, so the Runner screen's
// button and the night's own attempt cannot disagree about it. Returns '' when
// there is no problem.
function startProblem(opts) {
    const o = opts || {};
    if (!canStart(o.engineId)) {
        const name = o.engineName || o.engineId || 'That engine';
        return name + ' runs its own service, so this app does not start or stop it.';
    }
    if (!o.modelPath) {
        return 'No model is chosen for the reply job yet.';
    }
    if (!modelPathAllowed(o.modelPath, o.modelsDir)) {
        return 'That model is not in the app’s own Models folder.';
    }
    const r = o.runner || {};
    if (!r.ok) {
        return r.say || 'llama.cpp is not installed on this Mac yet.';
    }
    return '';
}

// An exit, in words. The stderr tail is the only thing that distinguishes a
// broken model file from a busy port, and both are things the owner can act on.
function failSay(code, stderr) {
    const s = String(stderr || '').toLowerCase();
    if (/address already in use|bind|eaddrinuse/.test(s)) {
        return 'Something else is already using that port. Quit it, or use the engine that is already serving.';
    }
    if (/failed to load model|error loading model|unable to load model|no such file/.test(s)) {
        return 'That model file could not be loaded — the download may be incomplete. Try downloading it again.';
    }
    if (/out of memory|insufficient memory|ggml_metal|not enough space/.test(s)) {
        return 'This Mac ran out of memory loading that model. Choose a smaller one on the Models screen.';
    }
    if (String(code) === 'ENOENT') {
        return 'The llama.cpp binary has gone. Reinstall it with ' + INSTALL_HINT + '.';
    }
    const tail = String(stderr || '').trim().split('\n').filter(Boolean).pop() || '';
    return 'The model server stopped' + (code || code === 0 ? ' (exit ' + code + ')' : '')
        + (tail ? ': ' + tail.slice(0, 160) : '.');
}

// How long to wait for it to answer. A cold 14B load off an SSD is tens of
// seconds, so this is generous — but it is BOUNDED, because "still starting"
// for ever is the state that looks identical to broken.
const READY_TIMEOUT_MS = 120000;
const READY_POLL_MS = 700;

function readySay(ms) {
    const s = Math.round((Number(ms) || 0) / 1000);
    return s > 1 ? 'ready after ' + s + ' seconds' : 'ready';
}

function timeoutSay(base) {
    return 'It started but never answered on ' + String(base || '')
        + ' within ' + Math.round(READY_TIMEOUT_MS / 1000) + ' seconds.';
}

module.exports = {
    RUNNER_BIN,
    INSTALL_HINT,
    BREW_PREFIXES,
    STARTABLE,
    READY_TIMEOUT_MS,
    READY_POLL_MS,
    canStart,
    runnerCandidates,
    resolveRunner,
    hostPort,
    runnerArgs,
    modelPathAllowed,
    startProblem,
    failSay,
    readySay,
    timeoutSay,
};
