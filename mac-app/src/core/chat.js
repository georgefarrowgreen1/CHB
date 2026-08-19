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
//  What this module owns is the PURE part: the system line, the boundary
//  sanitisers (a message is a role and a string, whatever the disk or the
//  model handed back), the trim that keeps a long conversation inside the
//  model's patience, and the cap that keeps the stored thread a file rather
//  than a diary. The IO — the engine call, the file — lives in api.js like
//  everything else's.
// ============================================================
'use strict';

// What a conversation may grow to ON DISK. Big enough that "we talked about
// this last week" still works, small enough that chats.json stays a file the
// window reads whole in one gulp (the nights.json posture).
const CHAT_KEEP = 200;
// What travels TO THE MODEL per send: the newest turns that fit the budget.
// A small local model with an 8K window loses the thread long before it runs
// out of context — recency is the only trimming rule that never surprises.
const CHAT_SEND_MAX = 24;        // messages
const CHAT_SEND_CHARS = 12000;   // total characters across them
const CHAT_MSG_CHARS = 8000;     // one message's cap, both directions

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
    return {
        role: role,
        text: text.slice(0, CHAT_MSG_CHARS),
        // The stamp is display-only ("14:22") and never parsed, so a missing
        // or malformed one is simply blank.
        at: typeof raw.at === 'string' ? raw.at.slice(0, 5) : '',
    };
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

// The messages that travel to the model: system line first, then the newest
// turns that fit both budgets, oldest of the kept ones first. Deliberately
// counted from the NEW end — cutting the start of a conversation loses old
// context, cutting the end would lose the question just asked.
function chatForModel(thread, host) {
    const clean = chatThread(thread);
    const kept = [];
    let chars = 0;
    for (let i = clean.length - 1; i >= 0; i--) {
        const m = clean[i];
        if (kept.length >= CHAT_SEND_MAX || chars + m.text.length > CHAT_SEND_CHARS) { break; }
        kept.unshift({ role: m.role, content: m.text });
        chars += m.text.length;
    }
    return [{ role: 'system', content: chatSystemLine(host) }].concat(kept);
}

module.exports = {
    CHAT_KEEP, CHAT_SEND_MAX, CHAT_SEND_CHARS, CHAT_MSG_CHARS,
    chatSystemLine, chatMsg, chatThread, chatPush, chatForModel,
};
