// ============================================================
//  engine.js — where the words come from.
//
//  ONE ADAPTER COVERS BOTH ENGINES, and that is the simplification the whole
//  runner design rests on: llama.cpp's own server and Ollama both speak an
//  OpenAI-shaped `/v1/chat/completions`, and an MLX sidecar can be made to
//  speak it too. So the app talks HTTP to localhost and never links a model
//  runtime into its own process.
//
//  What that buys, in order of importance:
//   * the universal build is a non-question — llama.cpp is compiled for both
//     architectures and lipo'd, and nothing in this JavaScript knows or cares;
//   * MLX becomes a SECOND SIDECAR rather than a second app (an Apple-silicon
//     helper serving the same route), which is the answer to "two versions?";
//   * you can point it at Ollama or LM Studio if you already run one;
//   * and every line above this file is testable with a fake HTTP endpoint,
//     which is how the drafting logic gets verified without a model at all.
//
//  Deliberately NOT streaming. Nobody is watching at two in the morning, and a
//  single response is one thing to time and one thing to check.
// ============================================================
'use strict';

// Engines, in the order the app offers them. `mlx` is listed even where it
// cannot run: the Runner screen shows it withdrawn with a reason rather than
// silently absent, because an option that vanishes reads as a missing feature.
const ENGINES = {
    llamacpp: {
        id: 'llamacpp',
        name: 'llama.cpp',
        base: 'http://127.0.0.1:8080',
        note: 'Metal on Apple silicon, CPU on Intel. Runs on any Mac.',
        appleSiliconOnly: false,
    },
    ollama: {
        id: 'ollama',
        name: 'Ollama',
        base: 'http://127.0.0.1:11434',
        note: 'If you already run Ollama, this uses it rather than a second copy.',
        appleSiliconOnly: false,
    },
    mlx: {
        id: 'mlx',
        name: 'MLX',
        base: 'http://127.0.0.1:8081',
        note: 'Apple’s own framework. Apple silicon only.',
        appleSiliconOnly: true,
    },
};

// Which engines this Mac can actually use, each with a reason when it cannot.
function available(machine) {
    return Object.keys(ENGINES).map(function (k) {
        const e = ENGINES[k];
        const usable = !e.appleSiliconOnly || !!(machine && machine.appleSilicon);
        return {
            id: e.id,
            name: e.name,
            note: e.note,
            usable: usable,
            why: usable ? '' : 'This Mac is Intel, and MLX is Apple silicon only.',
        };
    });
}

// The engine the app should pick with nobody choosing. Apple silicon gets MLX
// only once it is actually serving; otherwise llama.cpp, which runs anywhere.
// Never a preference expressed as a hope — `reachable` is measured.
function pickDefault(machine, reachable) {
    const r = reachable || {};
    if (machine && machine.appleSilicon && r.mlx) {
        return 'mlx';
    }
    if (r.llamacpp) {
        return 'llamacpp';
    }
    if (r.ollama) {
        return 'ollama';
    }
    return 'llamacpp';
}

const CHAT_PATH = '/v1/chat/completions';

async function jsonPost(url, body, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, timeoutMs || 300000);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctl.signal,
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        return { ok: res.ok, status: res.status, json: json, raw: text.slice(0, 300) };
    } finally {
        clearTimeout(t);
    }
}

async function jsonGet(url, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, timeoutMs || 2500);
    try {
        const res = await fetch(url, { signal: ctl.signal });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        return { ok: res.ok, status: res.status, json: json };
    } finally {
        clearTimeout(t);
    }
}

// An engine bound to one id. `httpPost`/`httpGet` are injectable so the test
// suite drives the drafting path — including a model that answers with rubbish
// — without any model installed.
function makeEngine(opts) {
    const o = opts || {};
    const spec = ENGINES[o.id] || ENGINES.llamacpp;
    const base = String(o.base || spec.base).replace(/\/+$/, '');
    const post = o.post || jsonPost;
    const get = o.get || jsonGet;

    return {
        id: spec.id,
        name: spec.name,
        base: base,

        // Is it serving? Cheap, short timeout, never throws — the Runner screen
        // asks this on every open and must not hang on a dead port.
        async reachable() {
            try {
                const r = await get(base + '/v1/models', 2500);
                return !!(r && r.ok);
            } catch (e) {
                return false;
            }
        },

        // Ask for prose. Returns { ok, text, ms, tokens } or { ok:false, say }.
        // `temperature` is low on purpose: this is a business letter, not a poem,
        // and a deterministic-ish answer is one the guard can reason about.
        async write(prompt, model, opts2) {
            const p = opts2 || {};
            const started = Date.now();
            let r;
            try {
                r = await post(base + CHAT_PATH, {
                    model: model || 'local',
                    messages: [{ role: 'user', content: String(prompt || '') }],
                    temperature: typeof p.temperature === 'number' ? p.temperature : 0.35,
                    max_tokens: p.maxTokens || 700,
                    stream: false,
                }, p.timeoutMs);
            } catch (e) {
                return { ok: false, say: 'The model did not answer: ' + (e && e.message ? e.message : 'timed out') };
            }
            if (!r || !r.ok) {
                const why = (r && r.json && r.json.error && (r.json.error.message || r.json.error)) || (r ? 'HTTP ' + r.status : 'no answer');
                return { ok: false, say: 'The model refused: ' + String(why).slice(0, 160) };
            }
            const choice = r.json && r.json.choices && r.json.choices[0];
            const text = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
            if (!text.trim()) {
                return { ok: false, say: 'The model answered with nothing.' };
            }
            const usage = (r.json && r.json.usage) || {};
            // A floor of 1ms: a fake or cached answer can return inside the same
            // millisecond, and a rate of null there reads as "not measured"
            // rather than "very fast indeed".
            const ms = Math.max(1, Date.now() - started);
            const out = parseInt(usage.completion_tokens, 10) || 0;
            return {
                ok: true,
                text: text.trim(),
                ms: ms,
                tokens: out,
                // Measured, not quoted. This is the figure the Runner screen shows
                // and the only honest basis for choosing between engines.
                tokensPerSec: out && ms ? Math.round((out / (ms / 1000)) * 10) / 10 : null,
            };
        },
    };
}

module.exports = { ENGINES, available, pickDefault, makeEngine, CHAT_PATH };
