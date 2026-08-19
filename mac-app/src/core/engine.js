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
//  The NIGHT work deliberately does not stream — nobody is watching at two in
//  the morning, and a single response is one thing to time and one thing to
//  check. The CHAT does (chatStream below): somebody is watching, and the
//  difference between a dead app and a thinking model is words appearing.
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

// The SSE transport for a STREAMED completion: parses `data: {…}` lines out
// of the body as they arrive and hands each delta to `onDelta`. Chunks cut
// lines in half, so a carry buffer joins them; `[DONE]` is the wire's own
// full stop. Returns { ok, status, usage } — the TEXT was already delivered.
// Injectable, like jsonPost, so the suites stream scripted chunks.
async function ssePost(url, body, timeoutMs, signal, onDelta) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, timeoutMs || 180000);
    const onAbort = function () { ctl.abort(); };
    if (signal) { signal.addEventListener('abort', onAbort); }
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctl.signal,
        });
        if (!res.ok) {
            let json = null;
            try { json = JSON.parse(await res.text()); } catch (e) { json = null; }
            return { ok: false, status: res.status, json: json };
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let carry = '';
        let usage = null;
        for (;;) {
            const step = await reader.read();
            if (step.done) { break; }
            carry += dec.decode(step.value, { stream: true });
            const lines = carry.split('\n');
            carry = lines.pop();
            for (let i = 0; i < lines.length; i++) {
                const s = lines[i].trim();
                if (!s.startsWith('data:')) { continue; }
                const payload = s.slice(5).trim();
                if (payload === '[DONE]') { continue; }
                let j = null;
                try { j = JSON.parse(payload); } catch (e) { continue; }
                if (j && j.usage) { usage = j.usage; }
                const d = j && j.choices && j.choices[0] && j.choices[0].delta;
                if (d) {
                    onDelta({
                        content: typeof d.content === 'string' ? d.content : '',
                        // llama.cpp under --jinja can carve the thinking into
                        // its own field; it routes as thinking either way.
                        reasoning: typeof d.reasoning_content === 'string' ? d.reasoning_content : '',
                    });
                }
            }
        }
        return { ok: true, status: 200, usage: usage };
    } finally {
        clearTimeout(t);
        if (signal) { signal.removeEventListener('abort', onAbort); }
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
    const stream = o.stream || ssePost;

    // The boundary check chat() and chatStream() share — the engine must
    // never rely on its caller, and the two must never drift apart about
    // what a message is.
    function cleanMsgs(messages) {
        return (Array.isArray(messages) ? messages : [])
            .filter(function (m) {
                return m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system')
                    && typeof m.content === 'string' && m.content.trim() !== '';
            })
            .map(function (m) { return { role: m.role, content: m.content }; });
    }

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
            return this.chat([{ role: 'user', content: String(prompt || '') }], model, opts2);
        },

        // A CONVERSATION — the same call with the history passed through. The
        // one place the request is shaped and the reply parsed, so `write` (one
        // message) and the Chat screen (many) cannot drift apart. Messages are
        // re-checked at this boundary even though chat.js already cleaned them:
        // the engine must never rely on its caller.
        async chat(messages, model, opts2) {
            const p = opts2 || {};
            const msgs = cleanMsgs(messages);
            if (!msgs.some(function (m) { return m.role === 'user'; })) {
                return { ok: false, say: 'Nothing to ask the model.' };
            }
            const started = Date.now();
            const body = {
                model: model || 'local',
                messages: msgs,
                temperature: typeof p.temperature === 'number' ? p.temperature : 0.35,
                max_tokens: p.maxTokens || 700,
                stream: false,
            };
            // A GBNF grammar constrains the decode so the reply is valid by
            // construction — the chat's tool-call RETRY uses it. Only ever
            // attached when asked for: llama.cpp honours it, other engines
            // ignore the unknown field, and an empty string must not travel.
            if (typeof p.grammar === 'string' && p.grammar !== '') {
                body.grammar = p.grammar;
            }
            let r;
            try {
                r = await post(base + CHAT_PATH, body, p.timeoutMs);
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

        // The same conversation, STREAMED — the Chat screen's door. `onEv`
        // hears each piece as it arrives ({ token } for answer text,
        // { think } for a reasoning model's own thinking); the return value
        // is the whole reply, same shape as chat() plus `think` and
        // `stopped`. Three rules:
        //  * an ABORT (p.signal) is a decision, not a failure — it returns
        //    ok:true with the partial text and stopped:true, because the
        //    owner pressing Stop must keep what was already said;
        //  * the thinking is REAL or absent: it is only ever what the model
        //    itself put in reasoning_content — the <think>-in-content form
        //    is split by the caller (chat.js owns that state machine);
        //  * the boundary check is chat()'s own (cleanMsgs), so the two
        //    doors cannot drift.
        async chatStream(messages, model, opts2, onEv) {
            const p = opts2 || {};
            const cb = typeof onEv === 'function' ? onEv : function () {};
            const msgs = cleanMsgs(messages);
            if (!msgs.some(function (m) { return m.role === 'user'; })) {
                return { ok: false, say: 'Nothing to ask the model.' };
            }
            const body = {
                model: model || 'local',
                messages: msgs,
                temperature: typeof p.temperature === 'number' ? p.temperature : 0.35,
                max_tokens: p.maxTokens || 700,
                stream: true,
            };
            if (typeof p.grammar === 'string' && p.grammar !== '') {
                body.grammar = p.grammar;
            }
            const started = Date.now();
            let text = '';
            let think = '';
            let r;
            try {
                r = await stream(base + CHAT_PATH, body, p.timeoutMs, p.signal, function (d) {
                    if (d && d.reasoning) { think += d.reasoning; cb({ think: d.reasoning }); }
                    if (d && d.content) { text += d.content; cb({ token: d.content }); }
                });
            } catch (e) {
                if (p.signal && p.signal.aborted) {
                    const msA = Math.max(1, Date.now() - started);
                    return { ok: true, stopped: true, text: text.trim(), think: think.trim(), ms: msA, tokens: 0, tokensPerSec: null };
                }
                return { ok: false, say: 'The model did not answer: ' + (e && e.message ? e.message : 'timed out') };
            }
            if (p.signal && p.signal.aborted) {
                const msA = Math.max(1, Date.now() - started);
                return { ok: true, stopped: true, text: text.trim(), think: think.trim(), ms: msA, tokens: 0, tokensPerSec: null };
            }
            if (!r || !r.ok) {
                const why = (r && r.json && r.json.error && (r.json.error.message || r.json.error)) || (r ? 'HTTP ' + r.status : 'no answer');
                return { ok: false, say: 'The model refused: ' + String(why).slice(0, 160) };
            }
            if (!text.trim() && !think.trim()) {
                return { ok: false, say: 'The model answered with nothing.' };
            }
            const ms = Math.max(1, Date.now() - started);
            const out = parseInt((r.usage || {}).completion_tokens, 10) || 0;
            return {
                ok: true,
                stopped: false,
                text: text.trim(),
                think: think.trim(),
                ms: ms,
                tokens: out,
                tokensPerSec: out && ms ? Math.round((out / (ms / 1000)) * 10) / 10 : null,
            };
        },
    };
}

module.exports = { ENGINES, available, pickDefault, makeEngine, CHAT_PATH };
