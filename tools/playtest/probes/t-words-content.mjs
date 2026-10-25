// WORDS (D7 / D8) content probe, no browser: the four core scripts run in a vm (like content-tables.mjs).
// COMMON_WORDS / PHRASES shape, inventions out of the wave pools, per-wave pools and shares, >= 95 % dictionary words,
// English top-100 coverage, bigram and letter coverage of a simulated stream vs today's pools, the cps estimate,
// the weak-key bias (and the anti-repeat ring on tiny weak pools), determinism, MODES tuning and the THREAT INTEL copy.
// Usage: node t-words-content.mjs [--root ../..] [--dict /usr/share/dict/words]
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg("--root", path.join(here, "../../..")));
const DICT_PATH = arg("--dict", "/usr/share/dict/words");

function context(withLexicon) {
  const ctx = vm.createContext({ window: { SFX: function SFX() {}, location: { protocol: "http:" } }, navigator: { userAgent: "node" },
    performance: { now: () => Date.now() }, console, Math, Number, Array, Object, Set, Map, JSON, RegExp, String, Boolean, Error, Symbol });
  const files = ["assets/js/core/00-util.js", "assets/js/core/20-constants.js", ...(withLexicon ? ["assets/js/core/25-lexicon.js"] : []), "assets/js/core/30-content.js"];
  for (const rel of files) vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), ctx, { filename: rel });
  vm.runInContext("globalThis.__mk = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };", ctx);
  return (expr) => vm.runInContext(expr, ctx);
}
const G = context(true);
const G0 = context(false);   // today's pools: the scaffold's feature detection falls back to ALL_WORDS

let pass = 0, fail = 0, skip = 0;
const failures = [];
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; failures.push(`${name} :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Reference data (probe-local, not game code)
const TOP100 = "the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us".split(" ");
const EN_BIGRAMS = { th: 3.56, he: 3.07, in: 2.43, er: 2.05, an: 1.99, re: 1.85, on: 1.76, at: 1.49, en: 1.45, nd: 1.35, ti: 1.34, es: 1.34, or: 1.28, te: 1.20, of: 1.17, ed: 1.17, is: 1.13, it: 1.12, al: 1.09, ar: 1.07, st: 1.05, to: 1.04, nt: 1.04, ng: 0.95, se: 0.93, ha: 0.93, as: 0.87, ou: 0.87, io: 0.83, le: 0.83 };
const EN_LETTERS = { e: 12.7, t: 9.1, a: 8.2, o: 7.5, i: 7.0, n: 6.7, s: 6.3, h: 6.1, r: 6.0, d: 4.3, l: 4.0, c: 2.8, u: 2.8, m: 2.4, w: 2.4, f: 2.2, g: 2.0, y: 2.0, p: 1.9, b: 1.5, v: 1.0, k: 0.8, j: 0.15, x: 0.15, q: 0.1, z: 0.07 };
const BLOCK = new Set("sex sexy sexual drug drugs gay god hell damn kill dead death nazi porn tokyo japan america american english london york paris china mars saturn monday friday sunday january march june july".split(" "));
const IRREGULAR = new Set("is are was were been has had does did done said made went got came seen took knew told gave found left felt kept heard thought others things years days times words its us".split(" "));
// Modern dictionary entries (Merriam-Webster / Oxford) that the 1934 web2 list lacks; reviewed by hand.
const MODERN = new Set(("combo pixel retro hype synth metro byte cyber strobe vibe pixelate analog novae mecha glitch hologram vectorized rainmaker sideload photonic tachyon microprocessor hyperspectral neuroplastic antigravity autocorrelation omnidirectional vectorization nanofabrication bioelectric neurotransmitter rom modem debug droid reboot cyborg joypad bitmap opcode pulsar decoder payload joystick firmware database download cassette mainframe bandwidth spacecraft hyperdrive hovercraft teleporter coprocessor overclocked spacewalker microcircuit zen mod mars " +
  "skyline kilobyte megabyte countdown megahertz nightlife wavelength checkpoint cyberspace streetlight coordinates").split(" "));
let web2 = null;
try { web2 = new Set(fs.readFileSync(DICT_PATH, "utf8").split("\n").filter(Boolean)); } catch { web2 = null; }
const stems = (w) => [w, w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ies$/, "y"), w.replace(/ed$/, ""), w.replace(/ed$/, "e"), w.replace(/d$/, ""), w.replace(/ing$/, ""), w.replace(/ing$/, "e")];
const isDict = (w) => IRREGULAR.has(w) || MODERN.has(w) || (web2 && stems(w).some((s) => s.length >= 2 && web2.has(s)));

// ---- C1 COMMON_WORDS ----
const C = G("COMMON_WORDS");
check("C1 COMMON_WORDS 480..520 entries", C.length >= 480 && C.length <= 520, C.length);
check("C1 unique, a-z, 2-10 letters", new Set(C).size === C.length && C.every((w) => /^[a-z]{2,10}$/.test(w)), C.filter((w) => !/^[a-z]{2,10}$/.test(w)));
check("C1 nothing offensive / no proper nouns (blocklist)", C.every((w) => !BLOCK.has(w)), C.filter((w) => BLOCK.has(w)));
check("C1 COMMON_WORDS[0..97] = English top 100 minus 'a', 'i', in rank order", JSON.stringify(C.slice(0, 98)) === JSON.stringify(TOP100.filter((w) => w.length >= 2)), C.slice(0, 5));
check("C1 frozen", G("Object.isFrozen(COMMON_WORDS) && Object.isFrozen(PHRASES)"));
// ---- C2 PHRASES ----
const PH = G("PHRASES");
check("C2 PHRASES 110..130 entries, unique", PH.length >= 110 && PH.length <= 130 && new Set(PH).size === PH.length, PH.length);
check("C2 two a-z words of <= 8 letters, <= 15 chars", PH.every((p) => /^[a-z]{1,8} [a-z]{1,8}$/.test(p) && p.length <= 15), PH.filter((p) => !/^[a-z]{1,8} [a-z]{1,8}$/.test(p) || p.length > 15));
// ---- C3 inventions ----
const INV = G("LEXICON_INVENTIONS");
check("C3 every invention is in ALL_WORDS (the list documents a removal) and not in COMMON_WORDS", INV.every((w) => G("ALL_WORDS").includes(w) && !C.includes(w)));
check("C3 WAVE_WORDS has no invention; ALL_WORDS keeps them (boss/attract history)", G("WAVE_WORDS.every(w => !LEXICON_INVENTIONS.includes(w)) && ALL_WORDS.length === 329"));
check("C3 'japan' is an invention (reads as a proper noun, lead ruling Z4): out of WAVE_WORDS and every level's words; 'mars' and 'kana' stay in WAVE_WORDS",
  INV.includes("japan") && G("!WAVE_WORDS.includes('japan') && LEVELS.every(c => !c.words.includes('japan')) && WAVE_WORDS.includes('mars') && WAVE_WORDS.includes('kana')"));
check("C4 LEXICON_NEON_EXTRA in WAVE_WORDS, a-z, 7..13 letters", G("LEXICON_NEON_EXTRA.every(w => WAVE_WORDS.includes(w) && /^[a-z]{7,13}$/.test(w))"));
// ---- C5 per level / wave ----
const lv = G(`LEVELS.map(cfg => [0,1,2].map(w => { const win = waveLengthWindow(cfg, w), pw = lexiconPhraseWindow(win); return { L: cfg.level, w, win, pw,
  common: cfg.waveCommon[w], draw: cfg.waveCommonDraw[w].length, phrases: cfg.wavePhrases[w], themed: wordsForWave(cfg, w), shares: cfg.waveShares[w], textLen: cfg.waveTextLen[w], maxTextLen: cfg.maxTextLen,
  wce: waveCharsPerEnemy(cfg, w), lr: waveLetterRatio(cfg, w), words: cfg.words }; }))`).flat();
const inv = new Set(INV);
for (const r of lv) {
  const tag = `L${r.L}w${r.w + 1}`;
  check(`C5 ${tag} waveCommon inside ${r.win.min}-${r.win.max}, from COMMON_WORDS, >= 12`, r.common.length >= 12 && r.common.every((x) => x.length >= r.win.min && x.length <= r.win.max && C.includes(x)), r.common.length);
  check(`C5 ${tag} waveCommonDraw = unique + one extra per top-100 entry`, r.draw === r.common.length + r.common.filter((x) => C.indexOf(x) < 98).length, r.draw);
  check(`C5 ${tag} wavePhrases ${r.L <= 3 ? "empty" : `>= 8 inside ${r.pw.min}-${r.pw.max}`}`, r.L <= 3 ? r.phrases.length === 0 : (r.phrases.length >= 8 && r.phrases.every((p) => p.length >= r.pw.min && p.length <= r.pw.max)), r.phrases.length);
  check(`C5 ${tag} shares`, r.shares.common === (r.L <= 5 ? 0.5 : 0.3) && r.shares.phrase === (r.L <= 3 ? 0 : r.L <= 6 ? 0.15 : 0.2), r.shares);
  check(`C5 ${tag} no invention in any pool`, [...r.words, ...r.themed, ...r.common, ...r.phrases.flatMap((p) => p.split(" "))].every((x) => !inv.has(x)));
  check(`C5 ${tag} maxTextLen covers every pool text, <= 15`, r.maxTextLen <= 15 && [...r.common, ...r.phrases, ...r.themed].every((x) => x.length <= r.maxTextLen), r.maxTextLen);
  check(`C10 ${tag} waveCharsPerEnemy reads waveTextLen`, near(r.wce, r.lr + (1 - r.lr) * r.textLen, 1e-9), { wce: r.wce, textLen: r.textLen });
}
check("C15 phrase windows", JSON.stringify([lv[9].pw, lv[20].pw, lv[29].pw]) === JSON.stringify([{ min: 6, max: 11 }, { min: 10, max: 15 }, { min: 11, max: 15 }]), [lv[9].pw, lv[20].pw, lv[29].pw]);
// ---- C6 dictionary share ----
const poolWords = [...new Set(lv.flatMap((r) => [...r.themed, ...r.common, ...r.phrases.flatMap((p) => p.split(" "))]))];
if (web2) {
  const bad = poolWords.filter((w) => !isDict(w));
  const pct = 100 * (poolWords.length - bad.length) / poolWords.length;
  check(`C6 >= 95 % of the ${poolWords.length} distinct wave-pool words are dictionary words (${pct.toFixed(2)} %)`, pct >= 95, bad.slice(0, 12));
  check("C6 every COMMON_WORDS entry and phrase word is a dictionary word", C.every(isDict) && PH.flatMap((p) => p.split(" ")).every(isDict), [...C, ...PH.flatMap((p) => p.split(" "))].filter((w) => !isDict(w)));
} else { skip++; console.log(`SKIP C6 dictionary share: ${DICT_PATH} not readable`); }
// ---- C7 top-100 coverage ----
const top = TOP100.filter((w) => w.length >= 2);
const reach = new Set(lv.flatMap((r) => [...r.common, ...r.phrases.flatMap((p) => p.split(" "))]));
check("C7 COMMON_WORDS holds all 98 top-100 words of 2+ letters", top.every((w) => C.includes(w)), top.filter((w) => !C.includes(w)));
check(`C7 >= 95 of 98 top-100 words reachable in campaign waves (${top.filter((w) => reach.has(w)).length})`, top.filter((w) => reach.has(w)).length >= 95, top.filter((w) => !reach.has(w)));
// ---- C8 / C9 simulated stream ----
const N = 20000;
const sim = (g, lexicon) => g(`(() => { const out = [];
  for (const cfg of LEVELS) for (let w = 0; w < 3; w++) {
    const game = { levelIndex: cfg.level - 1, run: {}, recentWords: [], rand: __mk(cfg.level * 31 + w) };
    const pool = wordsForWave(cfg, w); const texts = [];
    for (let i = 0; i < ${N}; i++) texts.push(${lexicon} ? lexiconPickText(game, cfg, w, null, null) : pool[(game.rand() * pool.length) | 0]);
    out.push({ L: cfg.level, w, texts: texts.filter(t => t.length > 1), stats: game._lexStats || null, textLen: ${lexicon} ? cfg.waveTextLen[w] : 0 });
  } return out; })()`);
const A = sim(G, true), B = sim(G0, false);
const tally = (rows) => { const bi = {}, lf = {}; let nb = 0, nl = 0;
  for (const r of rows) for (const t of r.texts) for (const part of t.split(" ")) for (let i = 0; i < part.length; i++) { lf[part[i]] = (lf[part[i]] || 0) + 1; nl++; if (i < part.length - 1) { const b = part.slice(i, i + 2); bi[b] = (bi[b] || 0) + 1; nb++; } }
  return { bi: (b) => 100 * (bi[b] || 0) / nb, lf: (c) => 100 * (lf[c] || 0) / nl }; };
const a15 = tally(A.filter((r) => r.L <= 5)), b15 = tally(B.filter((r) => r.L <= 5));
const lowBi = Object.keys(EN_BIGRAMS).filter((b) => b !== "of" && a15.bi(b) < 0.25 * EN_BIGRAMS[b]);
check("C8a S1-5 stream: every top-30 English bigram but 'of' at >= 0.25x its English rate", lowBi.length === 0, lowBi.map((b) => `${b}:${a15.bi(b).toFixed(2)}`));
const lift = ["th", "he", "ou", "nd", "ng", "es", "ti"].map((b) => [b, a15.bi(b), b15.bi(b)]);
check("C8b th he ou nd ng es ti each >= 2x today's rate", lift.every(([, n, o]) => n >= 2 * o), lift.map(([b, n, o]) => `${b} ${n.toFixed(2)}/${o.toFixed(2)}`).join(" "));
const lettersOff = Object.keys(EN_LETTERS).filter((c) => { const r = a15.lf(c) / EN_LETTERS[c]; return r < 0.5 || r > 3.0; });
check("C8c S1-5 stream: every letter within 0.5x..3.0x its English share (today: w .30x, z 7.0x)", lettersOff.length === 0, lettersOff.map((c) => `${c}:${(a15.lf(c) / EN_LETTERS[c]).toFixed(2)}`));
for (const r of A) {
  const s = r.stats, words = s.themed + s.common + s.phrase;
  const wantC = r.L <= 5 ? 0.5 : 0.3, wantP = r.L <= 3 ? 0 : r.L <= 6 ? 0.15 : 0.2;
  check(`C9 L${r.L}w${r.w + 1} shares common ${wantC} +-.03, two-word ${wantP} +-.02`, near(s.common / words, wantC, 0.03) && near(s.phrase / words, wantP, 0.02), { common: (s.common / words).toFixed(3), phrase: (s.phrase / words).toFixed(3) });
  const mean = r.texts.reduce((x, t) => x + t.length, 0) / r.texts.length;
  check(`C10 L${r.L}w${r.w + 1} waveTextLen within 3 % of the simulated mean`, near(mean, r.textLen, 0.03 * r.textLen), { mean: mean.toFixed(2), textLen: r.textLen.toFixed(2) });
}
// ---- C11 weak bias ----
const wk = G(`(() => { const res = {};
  const run = (L, w, api, n = 20000) => { const cfg = LEVELS[L - 1]; const game = { levelIndex: L - 1, run: {}, recentWords: [], rand: __mk(77 + L) }; Object.assign(game, api || {});
    const t = []; for (let i = 0; i < n; i++) t.push(lexiconPickText(game, cfg, w, null, null)); return { t, snap: game._lexWeak, set: letterSetForWave(cfg, w) }; };
  for (const [L, w] of [[1, 0], [4, 1], [8, 2]]) {
    const on = run(L, w, { typistWeakKeys: () => ["k", "p", "q"], typistWeakBigram: () => "th" }), off = run(L, w, null), thr = run(L, w, { typistWeakKeys: () => { throw new Error("x"); } });
    const lets = (x) => x.t.filter(s => s.length === 1), wordsOf = (x) => x.t.filter(s => s.length > 1);
    const wl = on.snap.weakLetters[w];
    const share = (arr, f) => arr.filter(f).length / Math.max(1, arr.length);
    const cnt = {}; for (const c of lets(off)) cnt[c] = (cnt[c] || 0) + 1;
    res[L + "." + w] = { wl, letterOn: share(lets(on), c => wl.includes(c)), expectLetter: 0.35 + 0.65 * wl.length / on.set.length,
      wordOn: share(wordsOf(on), s => /[kpq]|th/.test(s)), wordOff: share(wordsOf(off), s => /[kpq]|th/.test(s)),
      uniformDev: Math.max(...[...off.set].map(c => Math.abs((cnt[c] || 0) / lets(off).length - 1 / off.set.length))),
      outside: lets(on).filter(c => !on.set.includes(c)).length, offActive: !!(off.snap && off.snap.active), throwActive: !!(thr.snap && thr.snap.active) };
  } return res; })()`);
for (const [k, r] of Object.entries(wk)) {
  check(`C11 S${k} weak letters ${r.wl}: share .35 + .65 x |weak|/|set| +-.02`, near(r.letterOn, r.expectLetter, 0.02), r);
  check(`C11 S${k} words with k/p/q/th: .35 + .65 x base +-.04`, near(r.wordOn, 0.35 + 0.65 * r.wordOff, 0.04), { on: r.wordOn.toFixed(3), off: r.wordOff.toFixed(3) });
  check(`C11 S${k} no API -> uniform letters (dev < .01), bias off; a throwing API -> off; never outside the wave set`, r.uniformDev < 0.01 && !r.offActive && !r.throwActive && r.outside === 0, r);
}
// ---- C16 a tiny weak pool keeps the anti-repeat ring: a weak q (S1w2: quick, queue; S7w2: frequency) or z (S3w3: blitz)
// never fills a third of the word plates; each word stays <= .10 of word spawns while the weak words still beat the base ----
const rep = G(`(() => { const out = [];
  for (const [L, w, key] of [[1, 1, "q"], [7, 1, "q"], [3, 2, "z"]]) {
    const cfg = LEVELS[L - 1], run = (api) => { const g = { levelIndex: L - 1, run: {}, recentWords: [], rand: __mk(41 + L), ...api }; const cnt = {}; let n = 0, weak = 0;
      for (let i = 0; i < 20000; i++) { const t = lexiconPickText(g, cfg, w, null, null); if (t.length > 1) { n++; cnt[t] = (cnt[t] || 0) + 1; if (t.includes(key)) weak++; } }
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; return { top: top[0], topShare: top[1] / n, weak: weak / n }; };
    const on = run({ typistWeakKeys: () => [key], typistWeakBigram: () => null }), off = run({});
    out.push({ S: L + "." + (w + 1), key, on, off });
  } return out; })()`);
for (const r of rep) check(`C16 S${r.S} weak ${r.key}: top word <= .10 of word spawns, weak words > base + .05`, r.on.topShare <= 0.10 && r.on.weak > r.off.weak + 0.05, { top: r.on.top, topShare: r.on.topShare.toFixed(3), weak: r.on.weak.toFixed(3), base: r.off.weak.toFixed(3) });
// ---- C12 determinism / avoidSet ----
const det = G(`(() => { const seq = () => { const g = { levelIndex: 4, run: {}, recentWords: [], rand: __mk(9), typistWeakKeys: () => ["k"] }; const s = []; for (let i = 0; i < 500; i++) s.push(lexiconPickText(g, LEVELS[4], 1, null, null)); return s.join("|"); };
  const g2 = { levelIndex: 3, run: {}, recentWords: [], rand: __mk(5) }; const avoid = new Set("abcdefghijklm"); let v = 0; for (let i = 0; i < 3000; i++) if (avoid.has(lexiconPickText(g2, LEVELS[3], 1, avoid, null)[0])) v++;
  return { same: seq() === seq(), avoidRate: v / 3000 }; })()`);
check("C12 same rng seed -> same 500 texts; avoidSet honoured in >= 99 % of picks", det.same && det.avoidRate <= 0.01, det);
// ---- C13 tuning ----
const tu = G(`(() => { const g = { levelIndex: 5, run: {}, recentWords: [], rand: __mk(3), typistWeakKeys: () => ["k", "p", "q"] };
  const t = []; for (let i = 0; i < 6000; i++) t.push(lexiconPickText(g, LEVELS[5], 0, null, { window: { min: 3, max: 5 }, phraseShare: 0, weakShare: 0.6, letterSet: "abcdefghijklmnopqrstuvwxyz", letterRatio: 0.3 }));
  const L = t.filter(s => s.length === 1), W = t.filter(s => s.length > 1);
  return { badWords: W.filter(s => s.length < 3 || s.length > 5 || s.includes(" ")).length, letterShare: L.length / t.length, weakLetters: L.filter(c => "kpq".includes(c)).length / L.length }; })()`);
check("C13 tuning {window 3-5, phraseShare 0, weakShare .6, letterSet a-z, letterRatio .3}", tu.badWords === 0 && near(tu.letterShare, 0.3, 0.02) && near(tu.weakLetters, 0.6 + 0.4 * 3 / 26, 0.03), tu);
// ---- C14 copy ----
const line = G(`lexiconThreatIntelLine({ _lexWeak: { active: true, keys: ["k", "p"], bigram: "th" } })`);
const line3 = G(`lexiconThreatIntelLine({ _lexWeak: { active: true, keys: ["k", "p", "q"], bigram: "th" } })`);
check("C14 THREAT INTEL copy and speech", line.text === "THREAT INTEL · HOSTILES PROBING K · P · TH" && line.say === "Threat intel: hostiles probing K, P, T H." && line.key === "threatIntel" && line.order === 20 && line3.text.length <= 48 && line.color === "magenta", { line, len3: line3.text.length });
check("C14 no weak keys -> no line", G(`lexiconThreatIntelLine({ _lexWeak: { active: false, keys: [], bigram: "th" } })`) === null);
check("C14 lexiconGlyphFor(' ') === '·'", G(`lexiconGlyphFor(" ") === "·" && lexiconGlyphFor("k") === "k"`));

console.log(`t-words-content: ${pass} passed, ${fail} failed, ${skip} skipped`);
if (fail) { for (const f of failures) console.log("  FAIL " + f); process.exit(1); }
