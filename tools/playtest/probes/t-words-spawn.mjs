// WORDS (D7 / D8) acceptance in the page: wave-pool mixing (common / themed / two-word shares per sector), no
// inventions in spawns, the weak-key bias through MEASURE's real API (typistWeakKeys / typistWeakBigram on a seeded
// save.profile, CONTRACT 8.y W1), the THREAT INTEL sector-card line and its speech, the one-time two-word tip, the seeded
// this.rand() path, MODES tuning and the endless split, live S7 phrases, help copy, and WORDS staying inert during the
// real Flight Check (W4). Usage: node probes/t-words-spawn.mjs
import { openProbe, sleep, state, typeFor, startFresh, jumpTo, clearField, hold, waitFor } from "./b_lib.mjs";
import { harnessFlags, LS_KEY } from "./_lib.mjs";

// A save.profile whose real MEASURE readout is `weak` (letter -> miss EMA; the rest at .01, all 40 attempts at 180 ms)
// and, when given, one slow bigram (420 ms vs eight at 150 ms: >= 1.35 x the median, n >= 8).
const PROFILE = ({ weak = {}, bigram = null } = {}) => {
  const keys = {}, bigrams = {};
  for (const c of "abcdefghijklmnopqrstuvwxyz") keys[c] = { n: 40, err: weak[c] != null ? weak[c] : 0.01, ms: 180 };
  for (const b of ["an", "er", "in", "on", "re", "at", "en", "nd"]) bigrams[b] = { n: 20, ms: 150 };
  if (bigram) bigrams[bigram] = { n: 20, ms: 420 };
  return { v: 1, keys, bigrams, speedEma: 0, thrEma: 0, speedN: 0, sessions: [], sectorBest: {}, bests: { speed: 0, ceiling: 0, drill: { speed: 0, acc: 0 } }, days: { n: 0, last: 0 } };
};

const P = await openProbe("t-words-spawn");
await startFresh(P, "WORDS");
// Installs window.__seed(profile|null): writes save.profile and makes MEASURE re-hydrate (its typed arrays follow the
// save object; a fresh saveRef forces the reload and drops the 2 s weak cache); returns MEASURE's readout.
await P.g(() => {
  window.__seed = (profile) => {
    const g = window.game;
    g.save.profile = profile;
    if (g._ty) g._ty.saveRef = null;
    g._lexWeak = null;
    return { keys: g.typistWeakKeys().slice(), bigram: g.typistWeakBigram() };
  };
});
const seed = (opts) => P.g((pr) => window.__seed(pr), opts === null ? null : PROFILE(opts));

// P1 shares + validity: makeEnemyText per sector-wave until 6000 word picks (no weak keys; early waves are up to 80 %
// letters, so a fixed call count would leave the share bands near 2 sigma there)
const mix = await P.g(() => {
  const g = window.game, out = [];
  const inv = new Set(LEXICON_INVENTIONS);
  for (const cfg of LEVELS) for (let w = 0; w < 3; w++) {
    g.levelIndex = cfg.level - 1; g._lexWeak = null; g._lexStats = null; g.recentWords = [];
    const themed = new Set(wordsForWave(cfg, w)), common = new Set(cfg.waveCommon[w]), phr = new Set(cfg.wavePhrases[w]), letters = letterSetForWave(cfg, w);
    let bad = 0, invHits = 0;
    for (let i = 0; i < 60000 && !(g._lexStats && g._lexStats.themed + g._lexStats.common + g._lexStats.phrase >= 6000); i++) {
      const t = g.makeEnemyText(cfg, w, null);
      if (t.length === 1 ? !letters.includes(t) : !(themed.has(t) || common.has(t) || phr.has(t))) bad++;
      if (inv.has(t)) invHits++;
    }
    const st = g._lexStats, words = st.themed + st.common + st.phrase;
    out.push({ L: cfg.level, w, bad, invHits, common: +(st.common / words).toFixed(3), phrase: +(st.phrase / words).toFixed(3) });
  }
  g.levelIndex = 0; g._lexWeak = null;
  return out;
});
const shareOk = mix.every((m) => Math.abs(m.common - (m.L <= 5 ? 0.5 : 0.3)) <= 0.04 && Math.abs(m.phrase - (m.L <= 3 ? 0 : m.L <= 6 ? 0.15 : 0.2)) <= 0.03);
P.check("P1 makeEnemyText: common share .50 (S1-5) / .30 (S6-10), two-word .00 (S1-3) / .15 (S4-6) / .20 (S7-10), +-.04/.03", shareOk, mix.map((m) => `${m.L}.${m.w}:${m.common}/${m.phrase}`).join(" "));
P.check("P1b every text is a wave letter, a themed/common window word or a window phrase; no invention ever", mix.every((m) => m.bad === 0 && m.invHits === 0), mix.filter((m) => m.bad || m.invHits));

// P3 weak bias through MEASURE's real API: a profile with k and q missed (q is outside the S1 wave 1 alphabet) and a
// slow th. S1 wave 1: k = .35 + .65/13 = .40 of letters; with no profile the letters stay uniform (1/13).
const sampleS1 = () => P.g(() => {
  const g = window.game, cfg = LEVELS[0];
  g.levelIndex = 0; g._lexWeak = null; g._lexStats = null; g.recentWords = [];
  let k = 0, n = 0, wk = 0, wn = 0;
  for (let i = 0; i < 4000; i++) { const t = g.makeEnemyText(cfg, 0, null); if (t.length === 1) { n++; if (t === "k") k++; } else { wn++; if (/k|th/.test(t)) wk++; } }
  return { k: +(k / n).toFixed(3), words: +(wk / wn).toFixed(3), weakLetters: g._lexWeak.weakLetters[0], active: g._lexWeak.active };
});
const apiOn = await seed({ weak: { k: 0.25, q: 0.2 }, bigram: "th" });
const on = await sampleS1();
const apiOff = await seed(null);
const off = await sampleS1();
P.check("P3 real MEASURE weak keys k,q + bigram th: k = .35 + .65/13 = .40 +-.04 of S1w1 letters (q outside the set); no profile: 1/13 +-.03, bias off; words with k/th rise > .2",
  JSON.stringify(apiOn) === JSON.stringify({ keys: ["k", "q"], bigram: "th" }) && apiOff.keys.length === 0 && on.active && on.weakLetters === "k" &&
  Math.abs(on.k - 0.4) <= 0.04 && !off.active && Math.abs(off.k - 1 / 13) <= 0.03 && on.words > off.words + 0.2, { apiOn, apiOff, on, off });

// P2 THREAT INTEL line on the sector card + speech (real MEASURE readout: k, p and th)
const apiKP = await seed({ weak: { k: 0.25, p: 0.2 }, bigram: "th" });
await P.g(() => { const g = window.game; g.startLevel(3, { fromMenu: true, fresh: true }); });
await sleep(700);
const card = await P.g(() => ({ kind: window.game.banner && window.game.banner.kind, lines: (window.game.banner && window.game.banner.lines || []).map((l) => l.text), sr: document.getElementById("srAnnounce").textContent }));
await P.shot("sector-card-intel");
P.check("P2 sector card line 'THREAT INTEL · HOSTILES PROBING K · P · TH' and the spoken form", JSON.stringify(apiKP) === JSON.stringify({ keys: ["k", "p"], bigram: "th" }) && card.kind === "sector" && card.lines.includes("THREAT INTEL · HOSTILES PROBING K · P · TH") && /Threat intel: hostiles probing K, P, T H\./.test(card.sr), { apiKP, ...card });
await waitFor(P, () => !window.game.levelIntro, 6000);
const apiBigram = await seed({ bigram: "th" });
await P.g(() => { const g = window.game; g.startLevel(3, { fromMenu: true, fresh: true }); });
await sleep(500);
const card2 = await P.g(() => ({ lines: (window.game.banner && window.game.banner.lines || []).map((l) => l.text), sr: document.getElementById("srAnnounce").textContent }));
await seed(null);
P.check("P2b no weak keys (MEASURE reports bigram th only) -> no THREAT INTEL line, no speech", apiBigram.keys.length === 0 && apiBigram.bigram === "th" && !card2.lines.some((t) => t.startsWith("THREAT INTEL")) && !/Threat intel/.test(card2.sr), { apiBigram, ...card2 });
await waitFor(P, () => !window.game.levelIntro, 6000);

// P4 first two-word tip, once (a probe listener after WORDS' forces the text of the next spawns)
const tip = await P.g(async () => {
  const g = window.game;
  if (g.save.tutorialSeen) delete g.save.tutorialSeen.phrase;
  g._lexTipShown = false;
  let calls = 0; const orig = g.showToast; g.showToast = function (text, o) { if (o && o.key === "phrase") calls++; return orig.apply(this, arguments); };
  const force = function (evt) { if (window.__forceText) evt.text = window.__forceText; };
  GAME_HOOKS.enemyTextWillPick.push(force);
  g.enemies.length = 0; window.__forceText = "warp core"; g.spawnEnemy(); const first = g.enemies[g.enemies.length - 1].text;
  g.enemies.length = 0; window.__forceText = "neon city"; g.spawnEnemy();
  window.__forceText = null; GAME_HOOKS.enemyTextWillPick.splice(GAME_HOOKS.enemyTextWillPick.indexOf(force), 1);
  const el = document.querySelector('.toast[data-key="phrase"]');
  const saved = JSON.parse(localStorage.getItem("typesmup198x.save.v1") || "{}");
  g.showToast = orig;
  return { first, calls, text: el && el.textContent, flag: !!(saved.tutorialSeen && saved.tutorialSeen.phrase), sr: document.getElementById("srAnnounce").textContent };
});
P.check("P4 first two-word spawn shows 'TWO-WORD TARGET — SPACE TYPES THE GAP' once, announces it and stores tutorialSeen.phrase", tip.first === "warp core" && tip.calls === 1 && tip.text === "TWO-WORD TARGET — SPACE TYPES THE GAP" && tip.flag && tip.sr.includes("TWO-WORD TARGET"), tip);

// P5 seeded this.rand(): identical sequences
const det = await P.g(() => {
  const g = window.game, cfg = LEVELS[6];
  const mk = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  // this.rand() reads _rng only outside the campaign (MODES G6): fly the check as a Daily Sortie run
  const mode = g.run.mode; g.run.mode = "daily";
  const seq = () => { g._rng = mk(20261023); g.recentWords = []; g._lexWeak = null; const s = []; for (let i = 0; i < 200; i++) s.push(g.makeEnemyText(cfg, 1, null)); return s.join("|"); };
  const a = seq(), b = seq(); g._rng = null; g.run.mode = mode;
  return { same: a === b, sample: a.slice(0, 80) };
});
P.check("P5 makeEnemyText draws through this.rand(): a daily run with the same seed -> the same 200 texts", det.same, det);

// P6 explicit tuning (lexiconPickText) and the MODES split: endless / drill -> WORDS no-ops (MODES owns the text)
const tun = await P.g(() => {
  const g = window.game, cfg = LEVELS[6];
  let bad = 0; for (let i = 0; i < 1000; i++) { const t = lexiconPickText(g, cfg, 2, null, { window: { min: 3, max: 5 }, phraseShare: 0 }); if (t.length > 1 && (t.length < 3 || t.length > 5 || t.includes(" "))) bad++; }
  const run = g.run, mode = run.mode;
  const themed = new Set(cfg.words), letters = letterSetForWave(cfg, 2);
  run.mode = "endless"; g._lexStats = null;
  let foreign = 0; for (let i = 0; i < 600; i++) { const t = g.makeEnemyText(cfg, 2, null); if (t.length === 1 ? !letters.includes(t) : !themed.has(t)) foreign++; }
  const statsTouched = !!g._lexStats;
  run.mode = mode;
  return { bad, foreign, statsTouched };
});
P.check("P6 lexiconPickText honours an explicit tuning; in an endless run WORDS' listener no-ops (only today's pools, no lexicon stats)", tun.bad === 0 && tun.foreign === 0 && !tun.statsTouched, tun);

// P8 live play at S7: two-word plates spawn and the typist clears them
await jumpTo(P, 6);
await P.g(() => { const g = window.game; g.invulnT = 1e9; g.__spawned = []; (GAME_HOOKS.enemySpawned || (GAME_HOOKS.enemySpawned = [])).push(function (e) { if (e && e.en) this.__spawned.push(e.en); }); });
await typeFor(P, 35, { wpm: 90, accuracy: 0.97, until: (st) => st.inBoss || st.mode !== "playing" });
const live = await P.g(() => { const s = window.game.__spawned.filter((e) => e.text.includes(" ")); return { spawned: window.game.__spawned.length, phrases: s.length, killed: s.filter((e) => !e.alive && e.progress >= e.text.length).length }; });
P.check("P8 S7 live: two-word plates spawn and are typed to death by the harness typist", live.phrases >= 1 && live.killed >= 1, live);

// P7 help copy
const help = await P.g(() => document.getElementById("helpModal").textContent.replace(/\s+/g, " "));
P.check("P7 help copy: Backspace releases, Space types the gap of a two-word target, the gap counts in scoring", /Backspace releases your lock/.test(help) && /two-word target/.test(help) && /Space types it/.test(help) && /per character/.test(help), help.slice(0, 120));

// P9 W4: the real Flight Check (ONBOARD, harness flag "play") with a weak profile: WORDS picks nothing, adds no card
// line, then the Sector 1 card after Esc carries THREAT INTEL again.
{
  const ctx = await P.browser.newContext({ viewport: { width: 1440, height: 900 } });
  await harnessFlags(ctx, { flightCheck: "play" });
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, [LS_KEY, { playerName: "W4", storySeen: true, settings: { muted: true }, profile: PROFILE({ weak: { k: 0.25, p: 0.2 }, bigram: "th" }) }]);
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 120000 });
  await pg.click("#btnStart");
  const story = pg.locator("#btnStoryLaunch");
  try { await story.waitFor({ state: "visible", timeout: 2500 }); await story.click(); } catch {}
  const active = await pg.waitForFunction(() => window.game && window.game.isFlightCheckActive && window.game.isFlightCheckActive(), null, { timeout: 15000 }).then(() => true).catch(() => false);
  const inCheck = await pg.evaluate(() => {
    const g = window.game;
    const weak = g.typistWeakKeys().slice();
    g._lexStats = null; g._lexWeak = null;
    for (let i = 0; i < 200; i++) g.makeEnemyText(LEVELS[0], 0, null);
    const card = g.hook("sectorCardWillShow", { level: 1, lines: [], eyebrow: "", title: "", sub: "" });
    return { weak, run: g.run, mode: g.runMode(), stats: g._lexStats, snap: g._lexWeak, lines: card.lines.length, banner: g.banner ? g.banner.kind : null };
  });
  await pg.keyboard.press("Escape");
  const after = await pg.waitForFunction(() => { const g = window.game; return !g.isFlightCheckActive() && g.banner && g.banner.kind === "sector" ? (g.banner.lines || []).map((l) => l.text) : null; }, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => null);
  P.check("P9 W4 Flight Check (real ONBOARD) with weak keys k,p: WORDS picks nothing (no _lexStats, no snapshot), adds no card line; the Sector 1 card after Esc shows THREAT INTEL",
    active && inCheck.weak.join("") === "kp" && inCheck.run === null && inCheck.stats === null && inCheck.snap === null && inCheck.lines === 0 &&
    Array.isArray(after) && after.includes("THREAT INTEL · HOSTILES PROBING K · P · TH") && errs.length === 0, { active, inCheck, after, errs });
  await ctx.close();
}
P.check("zero pageErrors / consoleErrors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, P.errors);
await P.finish();
