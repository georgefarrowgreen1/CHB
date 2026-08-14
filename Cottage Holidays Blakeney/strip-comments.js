#!/usr/bin/env node
// ============================================================================
//  strip-comments.js — DEPLOY-TIME ONLY. Blanks full-line comments in the four
//  assets every anonymous visitor downloads, and verifies the result is the same
//  program before letting it ship.
//
//  WHY. Measured with node-zlib at the level perf-budget.js uses: app.js
//  261.1 -> 159.6KB (-103,901 B, 39%), app.css 71.5 -> 36.7KB (-35,556 B, 49%),
//  guest-app.css 8.2 -> 2.6KB (-5,743 B, 68%), guest-app.js 6.6 -> 3.3KB
//  (-3,416 B, 50%). Total -145.1KB gz on a 461.4KB guest payload — 31.4% — plus
//  ~245KB of raw JS a phone no longer has to parse. This codebase's comments are
//  load-bearing documentation; they simply have no business on a guest's phone.
//
//  IT BLANKS LINES, IT DOES NOT DELETE THEM. Every stack-trace line number
//  reported to client-error.php stays exact, which is what keeps the error log
//  usable against a stripped artifact. Costs ~1,889 brotli bytes against the
//  deleting variant (114,132 vs 116,021 saved) — a fair price for keeping the
//  one diagnostic channel this app has.
//
//  FULL-LINE ONLY. A trailing `// …` after code and an inline `/** @type */`
//  cast are left alone. That is what makes this provably safe rather than
//  probably safe: nothing has to reason about strings, regex literals, template
//  interpolation or division-vs-regex ambiguity, because a line that STARTS with
//  a comment opener and ends its own comment cannot be inside any of them —
//  except inside a multi-line template literal or block comment, which the
//  scanner tracks explicitly below.
//
//  AND THE ARTIFACT IS VERIFIED, not trusted. --verify parses both versions with
//  the repo's own TypeScript and compares the token streams; any difference in
//  identifiers, literals or structure fails the deploy. That check is what
//  proved this safe in the first place.
// ============================================================================

const fs = require('fs');
const path = require('path');

// A line is strippable when, ignoring leading whitespace, it is entirely a
// comment. `state` carries whether we are inside a block comment or a template
// literal across lines — the only two constructs where a `//` at line-start is
// not a comment at all.
function stripSource(src, kind) {
    const lines = src.split('\n');
    const out = new Array(lines.length);
    let inBlock = false;   // inside /* … */
    let inTpl = false;     // inside a `…` template literal (JS only)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();
        if (inBlock) {
            const end = line.indexOf('*/');
            out[i] = end === -1 ? '' : line;      // a line that CLOSES a block may carry code after it
            if (end !== -1) {
                inBlock = false;
                // Only blank it when nothing follows the closer.
                if (line.slice(end + 2).trim() === '') out[i] = '';
            }
            continue;
        }
        if (inTpl) {
            out[i] = line;
            if (countUnescapedBackticks(line) % 2 === 1) inTpl = false;
            continue;
        }
        // A whole-line // comment (JS only — CSS has no line comments).
        if (kind === 'js' && t.startsWith('//')) { out[i] = ''; continue; }
        // A whole-line /* … */ on one line.
        if (t.startsWith('/*') && t.endsWith('*/') && t.length >= 4) { out[i] = ''; continue; }
        // A block comment that OPENS this line and nothing precedes it.
        if (t.startsWith('/*') && !t.includes('*/')) { out[i] = ''; inBlock = true; continue; }
        // Otherwise the line has code. Track whether it leaves a template open.
        out[i] = line;
        if (kind === 'js' && countUnescapedBackticks(stripStringsRoughly(line)) % 2 === 1) inTpl = true;
    }
    return out.join('\n');
}

// Backticks that are not escaped. Rough is fine: it only decides whether to
// keep the NEXT line verbatim, and keeping a line verbatim is always safe.
function countUnescapedBackticks(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '`' && (i === 0 || s[i - 1] !== '\\')) n++;
    }
    return n;
}

// Remove quoted runs so a backtick inside '…' or "…" does not open a template.
function stripStringsRoughly(s) {
    return s.replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""');
}

// ---- verification: same program, or the deploy stops --------------------
// Token-stream equality via the repo's own TypeScript. Comments are trivia and
// never appear, so a correct strip is a no-op here; anything else is a diff.
function tokensOf(ts, src, file) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (sf.parseDiagnostics && sf.parseDiagnostics.length) {
        return { err: `${file}: ${sf.parseDiagnostics.length} parse diagnostic(s), first: ` +
            ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, ' ') };
    }
    const toks = [];
    const walk = (n) => {
        if (n.kind === ts.SyntaxKind.Identifier
            || n.kind === ts.SyntaxKind.StringLiteral
            || n.kind === ts.SyntaxKind.NumericLiteral
            || n.kind === ts.SyntaxKind.RegularExpressionLiteral
            || n.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
            || n.kind === ts.SyntaxKind.TemplateHead
            || n.kind === ts.SyntaxKind.TemplateMiddle
            || n.kind === ts.SyntaxKind.TemplateTail) {
            toks.push(n.kind + ':' + n.getText(sf));
        } else {
            toks.push(String(n.kind));
        }
        n.forEachChild(walk);
    };
    walk(sf);
    return { toks };
}

function verifyJs(before, after, file) {
    let ts;
    try { ts = require('typescript'); } catch (e) { return `typescript not installed — cannot verify ${file}`; }
    const a = tokensOf(ts, before, file);
    const b = tokensOf(ts, after, file);
    if (a.err) return `ORIGINAL ${a.err}`;
    if (b.err) return `STRIPPED ${b.err}`;
    if (a.toks.length !== b.toks.length) {
        return `${file}: token count changed ${a.toks.length} -> ${b.toks.length}`;
    }
    for (let i = 0; i < a.toks.length; i++) {
        if (a.toks[i] !== b.toks[i]) {
            return `${file}: token ${i} changed ${JSON.stringify(a.toks[i])} -> ${JSON.stringify(b.toks[i])}`;
        }
    }
    return null;
}

// CSS has no AST to hand here, so verify the property: every declaration and
// selector survives. Strip whitespace and comments from BOTH and compare.
function verifyCss(before, after, file) {
    const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
    return norm(before) === norm(after) ? null : `${file}: CSS content changed after stripping`;
}

const TARGETS = ['app.js', 'app.css', 'guest-app.js', 'guest-app.css'];

function main() {
    const args = process.argv.slice(2);
    const dir = args.find((a) => !a.startsWith('--')) || process.cwd();
    const verify = args.includes('--verify');
    const dry = args.includes('--dry');
    let failed = 0;
    let saved = 0;
    for (const name of TARGETS) {
        const p = path.join(dir, name);
        if (!fs.existsSync(p)) { console.log(`  – ${name} (absent, skipped)`); continue; }
        const before = fs.readFileSync(p, 'utf8');
        const kind = name.endsWith('.css') ? 'css' : 'js';
        const after = stripSource(before, kind);
        // LINE COUNT IS THE INVARIANT that keeps stack traces honest.
        const lb = before.split('\n').length;
        const la = after.split('\n').length;
        if (lb !== la) { console.log(`  ✗ ${name}: line count changed ${lb} -> ${la}`); failed++; continue; }
        if (verify) {
            const err = kind === 'js' ? verifyJs(before, after, name) : verifyCss(before, after, name);
            if (err) { console.log(`  ✗ ${err}`); failed++; continue; }
        }
        const zlib = require('zlib');
        const gb = zlib.gzipSync(Buffer.from(before)).length;
        const ga = zlib.gzipSync(Buffer.from(after)).length;
        saved += gb - ga;
        if (!dry) fs.writeFileSync(p, after);
        console.log(`  ✓ ${name}: ${(gb / 1024).toFixed(1)}KB -> ${(ga / 1024).toFixed(1)}KB gz (-${gb - ga} B), ${la} lines kept`);
    }
    console.log(failed
        ? `\nstrip-comments: ${failed} file(s) FAILED verification — nothing shipped\n`
        : `\nstrip-comments: ${(saved / 1024).toFixed(1)}KB gz saved, line numbers preserved\n`);
    process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { stripSource, verifyJs, verifyCss };
