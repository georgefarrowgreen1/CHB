// ============================================================
//  chat.js — the owner talking to their own model, and nothing else.
//
//  THIS IS NOT THE BUSINESS CHANNEL. Every other path a model's words take in
//  this app ends at a guard and then at the site — drafts, answers, menu
//  picks, all of them checked because a GUEST might read the result. A chat
//  reply is read by exactly one person, the owner, on their own Mac, so there
//  is deliberately no guard here: guarding it would refuse half of what makes
//  a chat useful ("write me a limerick about the quay"), and the thing the
//  guards exist to protect — a guest seeing an invented figure — cannot
//  happen, because nothing here has a route to the site at all. The system
//  line states that boundary to the MODEL, and the screen states it to the
//  OWNER, so neither can mistake this for the work channel.
//
//  What this module owns is the PURE part: the store (v2 — a titled LIST of
//  conversations, where v1 was one bare thread), the boundary sanitisers,
//  the trim that keeps a long conversation inside the model's patience, the
//  split between a reasoning model's THINKING and its answer, and the caps
//  that keep chats.json a file rather than a diary. The IO — the engine
//  call, the streaming, the file — lives in api.js like everything else's.
// ============================================================
'use strict';

// What one conversation may grow to ON DISK, and how many conversations the
// store keeps (oldest out — a chat is a working surface, not an archive).
const CHAT_KEEP = 200;
const CHAT_THREADS_MAX = 24;
const CHAT_TITLE_MAX = 46;
// What travels TO THE MODEL per send: the newest turns that fit the budget.
// A small local model with an 8K window loses the thread long before it runs
// out of context — recency is the only trimming rule that never surprises.
const CHAT_SEND_MAX = 24;        // messages
const CHAT_SEND_CHARS = 12000;   // total characters across them
const CHAT_MSG_CHARS = 8000;     // one message's cap, both directions
// A reasoning model's thinking, KEPT so the owner can reopen it, capped so a
// chatty thinker cannot triple the file. It is display-only: chatForModel
// sends `text` and never `think`, because reasoning models degrade when old
// thinking rides back in as history — their own model cards say so.
const CHAT_THINK_CHARS = 6000;
// A conversation's standing instruction ("two sentences, no lists") — typed
// by the owner or it does not exist; the app never writes one itself.
const CHAT_INSTR_CHARS = 500;
// An attached text file's cap. Refused over it, never silently cut — a
// half-read file answered confidently is worse than a sentence saying no.
const CHAT_ATTACH_CHARS = 6000;
const CHAT_ATTACH_NAME_MAX = 60;

// The system line. It names the owner when the site's brief has told us who
// that is, and it states the boundary — because a model that believes it can
// "send that to the guest" will happily claim it has.
function chatSystemLine(host) {
    const who = String(host || '').trim();
    return 'You are a helpful assistant running locally on '
        + (who ? who + '’s' : 'the owner’s')
        + ' own Mac, inside the Cottage Holidays Blakeney AI app. You are talking to '
        + (who || 'the owner') + ' directly. This is a private conversation: '
        + 'you cannot send messages, emails or anything else — nothing you '
        + 'write here reaches the website or a guest. Answer plainly and '
        + 'briefly; say so when you do not know something.';
}

// One message, or null. The boundary posture every payload in this app takes:
// garbage is ABSENT, never the word Array on a screen or in a prompt.
function chatMsg(raw) {
    if (!raw || typeof raw !== 'object') { return null; }
    const role = raw.role === 'assistant' ? 'assistant' : raw.role === 'user' ? 'user' : '';
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!role || !text) { return null; }
    const m = {
        role: role,
        text: text.slice(0, CHAT_MSG_CHARS),
        // The stamp is display-only ("14:22") and never parsed, so a missing
        // or malformed one is simply blank.
        at: typeof raw.at === 'string' ? raw.at.slice(0, 5) : '',
    };
    // The thinking, when a reasoning model produced one. Never invented: an
    // absent field renders no fold at all.
    if (typeof raw.think === 'string' && raw.think.trim() !== '') {
        m.think = raw.think.trim().slice(0, CHAT_THINK_CHARS);
    }
    // An attachment's NAME, for the bubble's file chip — the content lives in
    // the text itself (chatAttachMsg), so the two can never separate.
    if (typeof raw.file === 'string' && raw.file.trim() !== '') {
        m.file = raw.file.trim().slice(0, CHAT_ATTACH_NAME_MAX);
    }
    // Which lookups grounded this reply — names only, so the chip can render
    // after a restart. The payloads are session memory, deliberately not disk.
    if (Array.isArray(raw.used)) {
        const u = raw.used.filter(function (x) { return typeof x === 'string' && x !== ''; })
            .map(function (x) { return x.slice(0, 24); }).slice(0, 4);
        if (u.length) { m.used = u; }
    }
    return m;
}

// Whatever was on disk → a clean thread, capped.
function chatThread(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
        const m = chatMsg(list[i]);
        if (m) { out.push(m); }
    }
    return out.slice(-CHAT_KEEP);
}

// Append one message and keep the cap. Returns the new thread (never mutates —
// the caller owns when the file is written).
function chatPush(thread, msg) {
    const m = chatMsg(msg);
    const base = Array.isArray(thread) ? thread.slice() : [];
    if (m) { base.push(m); }
    return base.slice(-CHAT_KEEP);
}

// A conversation's title: its first line, trimmed to a label. Deterministic —
// no model call, so a title can never be wrong about what was asked.
function chatTitle(text) {
    const t = String(text || '').trim().split('\n')[0].trim();
    if (t === '') { return 'New chat'; }
    return t.length > CHAT_TITLE_MAX ? t.slice(0, CHAT_TITLE_MAX - 1).trimEnd() + '…' : t;
}

// ── THE STORE, v2: a titled list of conversations. ──────────────────────────
// v1 was one bare array; it is ADOPTED as a single conversation so nobody's
// existing chat vanishes on update. Garbage in any slot is absent, and the
// current pointer always lands on a real thread.
function chatStore(raw, nowMs) {
    const ms = typeof nowMs === 'number' ? nowMs : 0;
    let threads = [];
    let cur = '';
    if (Array.isArray(raw)) {
        // v1: one thread. Its title is its own first user message.
        const msgs = chatThread(raw);
        if (msgs.length) {
            const firstUser = msgs.filter(function (m) { return m.role === 'user'; })[0];
            threads = [{ id: 'legacy', title: chatTitle(firstUser ? firstUser.text : ''), at: ms, msgs: msgs }];
        }
    } else if (raw && typeof raw === 'object' && Array.isArray(raw.threads)) {
        cur = typeof raw.cur === 'string' ? raw.cur : '';
        for (let i = 0; i < raw.threads.length; i++) {
            const t = raw.threads[i];
            if (!t || typeof t !== 'object') { continue; }
            const id = typeof t.id === 'string' && t.id !== '' ? t.id.slice(0, 40) : '';
            if (!id) { continue; }
            const th = {
                id: id,
                title: chatTitle(typeof t.title === 'string' ? t.title : ''),
                at: typeof t.at === 'number' && t.at > 0 ? t.at : 0,
                msgs: chatThread(t.msgs),
            };
            if (typeof t.instr === 'string' && t.instr.trim() !== '') {
                th.instr = t.instr.trim().slice(0, CHAT_INSTR_CHARS);
            }
            threads.push(th);
        }
    }
    threads = threads.slice(0, CHAT_THREADS_MAX);
    if (!threads.some(function (t) { return t.id === cur; })) {
        cur = threads.length ? threads[0].id : '';
    }
    return { v: 2, cur: cur, threads: threads };
}

// A fresh conversation at the front — unless an EMPTY one already leads, in
// which case that one is simply current again (New chat twice is one chat).
function chatThreadNew(store, id, nowMs) {
    const s = chatStore(store, nowMs);
    const empty = s.threads.filter(function (t) { return t.msgs.length === 0; })[0];
    if (empty) {
        return { v: 2, cur: empty.id, threads: s.threads };
    }
    const threads = [{ id: String(id || 'c' + nowMs), title: 'New chat', at: typeof nowMs === 'number' ? nowMs : 0, msgs: [] }]
        .concat(s.threads).slice(0, CHAT_THREADS_MAX);
    return { v: 2, cur: threads[0].id, threads: threads };
}

// ── THINKING vs ANSWER. ─────────────────────────────────────────────────────
// Reasoning models open with <think>…</think>; everything else is the reply.
// An UNCLOSED block (a stopped generation) is all thinking and no answer —
// which is the truth of what happened. A model that never thinks returns
// { think:'', answer: text } untouched.
function chatThinkSplit(text) {
    const t = String(text == null ? '' : text);
    const m = t.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
    if (!m) { return { think: '', answer: t.trim() }; }
    const closed = m[2] === '</think>';
    return {
        think: m[1].trim().slice(0, CHAT_THINK_CHARS),
        answer: closed ? t.slice(t.indexOf('</think>') + 8).trim() : '',
    };
}

// The STREAMING form of the same split: a stateful router fed content chunks
// as they arrive, answering { think, answer } pieces to paint live. The tags
// can be CUT ACROSS CHUNKS ('<thi' + 'nk>'), so a possible tag prefix at the
// buffer's end is HELD BACK until the next chunk settles what it was.
function chatThinkStream() {
    let mode = 'start';   // start → think → answer
    let buf = '';
    const TAGS = { start: '<think>', think: '</think>' };
    function prefixLen(s, tag) {
        // The longest tail of s that is a prefix of tag — what must be held.
        for (let n = Math.min(s.length, tag.length - 1); n > 0; n--) {
            if (tag.startsWith(s.slice(-n))) { return n; }
        }
        return 0;
    }
    return function (chunk) {
        buf += String(chunk == null ? '' : chunk);
        const out = { think: '', answer: '' };
        for (;;) {
            if (mode === 'answer') {
                out.answer += buf; buf = '';
                return out;
            }
            const tag = TAGS[mode];
            const at = buf.indexOf(tag);
            if (at >= 0) {
                if (mode === 'start') {
                    // Only a LEADING <think> opens a block — mid-answer angle
                    // brackets are just text.
                    if (buf.slice(0, at).trim() === '') {
                        mode = 'think';
                        buf = buf.slice(at + tag.length);
                        continue;
                    }
                    mode = 'answer';
                    continue;
                }
                out.think += buf.slice(0, at);
                mode = 'answer';
                buf = buf.slice(at + tag.length);
                continue;
            }
            // No tag yet. In 'start' we are still deciding whether a block
            // opens at all: emit nothing until the buffer stops looking like
            // whitespace-then-maybe-a-tag.
            if (mode === 'start') {
                if (/^\s*(<think>?|<thin|<thi|<th|<t|<)?$/.test(buf)) { return out; }
                mode = 'answer';
                continue;
            }
            const hold = prefixLen(buf, tag);
            out.think += buf.slice(0, buf.length - hold);
            buf = buf.slice(buf.length - hold);
            return out;
        }
    };
}

// The messages that travel to the model: system line first, then the newest
// turns that fit both budgets, oldest of the kept ones first. Deliberately
// counted from the NEW end — cutting the start of a conversation loses old
// context, cutting the end would lose the question just asked.
//
// `extra` joins the SYSTEM content (the tool protocol, when the site is
// paired) rather than being a second system message — small local models
// reliably read one system message and unreliably read two. Reading does not
// move the boundary the line above states: looking things up was always
// allowed, sending remains impossible. NB only `text` travels — a stored
// `think` never rides back into history (see CHAT_THINK_CHARS above).
function chatForModel(thread, host, extra) {
    const clean = chatThread(thread);
    const kept = [];
    let chars = 0;
    for (let i = clean.length - 1; i >= 0; i--) {
        const m = clean[i];
        if (kept.length >= CHAT_SEND_MAX || chars + m.text.length > CHAT_SEND_CHARS) { break; }
        kept.unshift({ role: m.role, content: m.text });
        chars += m.text.length;
    }
    const sys = chatSystemLine(host)
        + (typeof extra === 'string' && extra.trim() !== '' ? '\n\n' + extra : '');
    return [{ role: 'system', content: sys }].concat(kept);
}

// ── AN ATTACHED TEXT FILE. ──────────────────────────────────────────────────
// '' or a sentence. Refusal over the cap is the whole design: the meter shows
// what an attachment costs BEFORE the send, and a file that will not fit is
// said so, never trimmed into a confident answer about half a document.
function chatAttachProblem(content) {
    const c = String(content == null ? '' : content);
    if (c.trim() === '') {
        return 'That file is empty.';
    }
    if (c.length > CHAT_ATTACH_CHARS) {
        return 'That file is too big for the chat — ' + c.length.toLocaleString()
            + ' characters against a limit of ' + CHAT_ATTACH_CHARS.toLocaleString()
            + '. Trim it down, or ask about a part of it.';
    }
    if (c.indexOf('\u0000') >= 0) {
        return 'That does not look like a text file.';
    }
    return '';
}
// The attachment joins the USER turn as a fenced block — one message, so the
// trim can never separate a question from its file.
function chatAttachMsg(text, name, content) {
    const t = String(text == null ? '' : text).trim();
    const n = String(name == null ? '' : name).slice(0, CHAT_ATTACH_NAME_MAX);
    return (t !== '' ? t + '\n\n' : '')
        + '--- attached file: ' + n + ' ---\n'
        + String(content == null ? '' : content).slice(0, CHAT_ATTACH_CHARS)
        + '\n--- end of ' + n + ' ---';
}

// ── A CONVERSATION AS A DOCUMENT. ───────────────────────────────────────────
// Markdown, pure: the words as said, thinking folded into quotes, lookups
// noted. What the export deliberately is NOT: a record of tool payloads —
// those were never stored, and an export cannot contain what the file
// does not hold.
function chatExportMd(thread, title, host) {
    const clean = chatThread(thread);
    const lines = ['# ' + chatTitle(title), ''];
    clean.forEach(function (m) {
        lines.push('## ' + (m.role === 'user' ? (String(host || '').trim() || 'You') : 'The model')
            + (m.at ? ' · ' + m.at : ''));
        if (m.think) {
            lines.push('');
            m.think.split('\n').forEach(function (t) { lines.push('> ' + t); });
        }
        if (m.used && m.used.length) {
            lines.push('');
            lines.push('*Checked the website: ' + m.used.join(', ') + '*');
        }
        lines.push('');
        lines.push(m.text);
        lines.push('');
    });
    return lines.join('\n');
}

module.exports = {
    CHAT_KEEP, CHAT_SEND_MAX, CHAT_SEND_CHARS, CHAT_MSG_CHARS,
    CHAT_THREADS_MAX, CHAT_TITLE_MAX, CHAT_THINK_CHARS,
    CHAT_INSTR_CHARS, CHAT_ATTACH_CHARS, CHAT_ATTACH_NAME_MAX,
    chatSystemLine, chatMsg, chatThread, chatPush, chatForModel,
    chatTitle, chatStore, chatThreadNew, chatThinkSplit, chatThinkStream,
    chatAttachProblem, chatAttachMsg, chatExportMd,
};
