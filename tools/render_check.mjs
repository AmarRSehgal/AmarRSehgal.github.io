// Render every feed the way a browser would, and fail if a payload comes out blank.
//
//     node tools/render_check.mjs
//
// This exists because the site has shipped two failures that only a render can see, and
// neither showed up in the payload contract tests:
//
//   - a top-level `const esc` in feed.js collided with predictions.js and took the whole
//     page down with a SyntaxError -- every feed blank, nothing in any log;
//   - the renderer read options_levels' session state ("in_position") as a health
//     failure and replaced a book holding five live positions with "This scanner is not
//     reporting", while the payload it was handed was complete and valid.
//
// Both are invisible to validate_predictions.py, which checks what is PUBLISHED. This
// checks what is SHOWN. It runs the real files against the real payloads with a DOM
// stubbed only as far as the renderers actually reach, so there is no second copy of
// any rendering logic here to drift.
import fs from 'fs';
import path from 'path';

const REPO = path.dirname(new URL('.', import.meta.url).pathname.replace(/\/$/, ''));
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

// Anything the renderers touch, and nothing else. A missing id must not throw: the page
// legitimately removes panels, and a stub that threw would fail those on purpose.
const mkEl = () => ({
    textContent: '', innerHTML: '', className: '',
    classList: { add() {}, remove() {}, toggle() {} },
    remove() { this.removed = true; }, removed: false,
    addEventListener() {}, setAttribute() {}, appendChild() {},
});

function freshDom(search) {
    const els = {};
    globalThis.document = {
        getElementById: id => (els[id] ||= mkEl()),
        // A stub, not null: feed.js binds the nav toggle unconditionally at boot, so a
        // null here throws before a single feed renders and the harness tests nothing.
        querySelectorAll: () => [], querySelector: () => mkEl(),
        addEventListener() {},
    };
    globalThis.window = globalThis;
    globalThis.location = { search };
    globalThis.fetch = async p => {
        const file = path.join(REPO, p);
        if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
    };
    return els;
}

// The words the renderer uses when it decides a feed is not worth showing. Seeing one in
// output built from a payload that IS current is the bug this file is here to catch.
const SUPPRESSED = /is not reporting|has gone quiet|could not be read|has not run yet/;

const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

let failures = 0;
function check(name, ok, detail) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
    if (!ok) failures++;
}

const predictionsSrc = read('predictions.js');
const feedSrc = read('feed.js');

// --- Home page: every feed, compact ---------------------------------------------
{
    const els = freshDom('');
    (0, eval)(predictionsSrc);
    for (const key of Object.keys(window.Predictions.FEEDS)) {
        const cfg = window.Predictions.FEEDS[key];
        if (!fs.existsSync(path.join(REPO, cfg.file))) continue;
        await window.Predictions.load(key, {});
        const body = els[cfg.container].innerHTML;
        check(`home ${key}`, body.length > 0 && !SUPPRESSED.test(body),
              body.length === 0 ? 'rendered nothing' : text(body).slice(0, 80));
    }
}

// --- Detail page: every feed, in full, through feed.js's own boot ----------------
for (const key of ['stock_levels', 'swing_book', 'mf_book', 'funding', 'nfl', 'nba',
                   'mlb', 'f1', 'real_estate', 'magic_formula', 'polymarket_whales', 'news',
                   'pm_btc_paper', 'kalshi_mm_paper']) {
    const els = freshDom(`?feed=${key}`);
    (0, eval)(predictionsSrc);
    (0, eval)(feedSrc);
    await new Promise(r => setTimeout(r, 0));
    const body = els['feed-content'].innerHTML;
    if (els['feed-content'].removed || !body) { check(`feed ${key}`, false, 'no content'); continue; }
    check(`feed ${key}`, !SUPPRESSED.test(body), text(body).slice(0, 70));

    // The books are the reason the session panel exists; a silent regression there is
    // the panel quietly removing itself, which looks identical to a feed that has none.
    if (['stock_levels', 'swing_book', 'mf_book', 'f1', 'nfl', 'mlb'].includes(key)) {
        const sess = els['feed-sessions'];
        const html = sess.innerHTML;
        check(`feed ${key} sessions`,
              !sess.removed && /<h2[^>]*>.+?<\/h2>/.test(html) && /nba-game/.test(html),
              sess.removed ? 'panel removed' : text(sess.innerHTML).slice(0, 70));
    }
}

console.log(failures ? `\n${failures} FAILED` : '\nall rendered');
process.exit(failures ? 1 : 0);
