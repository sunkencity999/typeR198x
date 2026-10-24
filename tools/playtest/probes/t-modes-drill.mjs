// t-modes-drill (MODES, D9 Drill): 60 s, no hull, no score, the stream at 1.1 x pilot cps (clamped), 60 % of letters and
// words weighted to MEASURE's weak keys / bigram (common words without a profile), no powerups, the clock and its
// pause, leaks break the combo only, the 10 SECONDS / TIME outro, the per-key lines against the profile, the bigram
// line, drill bests (first / worse / better) and isolation. PASS = the feature works.
// Usage: node tools/playtest/probes/t-modes-drill.mjs
import { openProbe, sleep, F5, F5P, startMode, waitMode, waitFor, isolation, card, typeWords, checkErrors } from "./modes_lib.mjs";

const P = await openProbe("t-modes-drill");
// F5P + one slow bigram so the drill also targets it (MEASURE: n >= 8, >= 1.35 x the median of >= 5 bigrams).
const bigrams = { th: { n: 20, ms: 420 }, an: { n: 20, ms: 200 }, er: { n: 20, ms: 210 }, in: { n: 20, ms: 190 }, on: { n: 20, ms: 200 }, re: { n: 20, ms: 205 } };
const fx = F5P();
fx.profile.bigrams = bigrams;
await P.goto(fx);
await sleep(300);
await P.g(() => storeSave(window.game.save));
const iso0 = await isolation(P);
const pilot = await P.g(() => {
  const g = window.game;
  if (typeof g.pacePilot === "function") return { cps: g.pacePilot(LEVELS[0]).cps, src: "pace" };
  const s = g.typistSpeed("lifetime");
  return s.n >= 60 && s.wpm > 0 ? { cps: s.wpm / 12, src: "lifetime" } : { cps: LEVELS[0].targetCps, src: "table" };
});
const weak = await P.g(() => ({ keys: [...window.game.typistWeakKeys()], bigram: window.game.typistWeakBigram() }));
const deck = await P.g(() => document.getElementById("drillSub").textContent);

// L1 start
await startMode(P, "drill", { waitGo: false });
const l1card = await P.g(() => ({ eyebrow: window.game.banner.eyebrow, title: window.game.banner.title, sub: window.game.banner.sub, said: document.getElementById("srAnnounce").textContent }));
await waitFor(P, () => !window.game.levelIntro && window.game.wavePhase === "spawn", 10000);
const l1 = await P.g(() => {
  const g = window.game, s = g.modesDebug().state(), cs = (sel) => getComputedStyle(document.querySelector(sel)).display;
  return { mode: g.runMode(), li: g.levelIndex, cps: s.cps, label: document.getElementById("hudLevel").previousElementSibling.textContent, hud: document.getElementById("hudLevel").textContent,
    score: getComputedStyle(document.getElementById("hudScore").closest(".hudCell")).display, mult: cs("#hudMult"), hull: cs(".hudCell--hull"), stage: cs("#stageBar"), win: s.win, letterRatio: s.letterRatio, weakShare: s.weakShare };
});
const want = Math.min(9, Math.max(1.2, 1.1 * pilot.cps));
P.check(`L1 start: drill, sector 1, cps = clamp(1.1 x pilot ${pilot.cps.toFixed(2)} [${pilot.src}], 1.2, 9) +-0.01; card DRILL · 60 S / TARGETS K · P · TH / NO HULL · NO SCORE; deck TARGETS K · P · TH; HUD Drill 1:00; score, multiplier, hull, stage bar hidden; window [3, <= 8], letters .30, weak .60`,
  weak.keys.join() === "k,p" && weak.bigram === "th" && deck === "TARGETS K · P · TH" && l1.mode === "drill" && l1.li === 0 && Math.abs(l1.cps - want) <= 0.01 && l1card.eyebrow === "DRILL · 60 S" &&
  l1card.title === "TARGETS K · P · TH" && l1card.sub === "NO HULL · NO SCORE" && /^Drill, 60 seconds\. Targets K, P and T H\. No hull, no score\./.test(l1card.said) && l1.label === "Drill" && l1.hud === "1:00" &&
  l1.score === "none" && l1.mult === "none" && l1.hull === "none" && l1.stage === "none" && l1.win.min === 3 && l1.win.max <= 8 && l1.win.max >= 5 && l1.letterRatio === 0.3 && l1.weakShare === 0.6, { weak, deck, l1, l1card });

// L4 weighting (before any typing changes the profile). 1,000 picks, and the k / p band is centred on its expectation
// .6 + .4 x 2/26 = .631 (60 % weak draws plus the uniform draws that land on k or p): the first cut centred it on .60 with
// 400 picks, so a healthy picker failed it about one run in eight (review: .685 seen).
const l4 = await P.g(() => {
  const g = window.game, cfg = LEVELS[0];
  let letters = 0, weakL = 0, words = 0, weakW = 0;
  for (let i = 0; i < 1000; i++) {
    const t = g.makeEnemyText(cfg, 1, null);
    if (t.length === 1) { letters++; if (t === "k" || t === "p") weakL++; } else { words++; if (/[kp]|th/.test(t)) weakW++; }
  }
  return { letterShare: letters / 1000, weakLetters: weakL / letters, weakWords: weakW / words };
});
P.check("L4 1,000 picks: letter share 0.30 +-0.06; k / p among letters .631 +-0.08 (60 % weak + uniform 2/26); words with k, p or th >= 0.52",
  Math.abs(l4.letterShare - 0.3) <= 0.06 && Math.abs(l4.weakLetters - (0.6 + 0.4 * 2 / 26)) <= 0.08 && l4.weakWords >= 0.52, l4);

// L5 no powerups
const l5 = await P.g(async () => {
  const g = window.game;
  const a = g.spawnPowerup({}), b = g.spawnPowerup({ fromKill: true, x: 600, y: 300 });
  g.powerAcc = 1e3;
  await new Promise((r) => setTimeout(r, 1500));
  return { a, b, alive: g.countAlivePowerups() };
});
P.check("L5 spawnPowerup({}) and a kill drop return null; the floor cadence spawns nothing", l5.a === null && l5.b === null && l5.alive === 0, l5);

// L2 clock and pause
await P.page.focus("#game");
await typeWords(P, ["kept", "pack"], 180);
await P.g(() => window.game.updateHUD());
const hud2 = await P.g(() => document.getElementById("hudLevel").textContent);
await P.page.keyboard.press("Escape");
await waitMode(P, "paused", 2000);
const pause2 = await P.g(() => ({ c: window.game.modesDebug().state().clock, eyebrow: document.getElementById("pauseEyebrow").textContent,
  tiles: [...document.querySelectorAll("#screenPaused .metaTile")].map((t) => [...t.children].map((c) => c.textContent.trim()).join(" ")), restart: document.getElementById("btnRestart").textContent }));
await sleep(2000);
const c2b = await P.g(() => window.game.modesDebug().state().clock);
await P.page.keyboard.press("Escape");
await waitMode(P, "playing", 2000);
P.check("L2 typed 2 s: HUD below 1:00; paused 2 s: the clock does not move; pause copy Paused // Drill, Left / Keys / WPM tiles, Restart drill",
  /^0:5\d$/.test(hud2) && pause2.c === c2b && pause2.c > 1 && pause2.eyebrow === "Paused // Drill" && /^Left 0:5\d$/.test(pause2.tiles[0]) && /^Keys \d+$/.test(pause2.tiles[1]) && /^WPM (\d+|--)$/.test(pause2.tiles[2]) &&
  pause2.restart === "Restart drill", { hud2, pause2, c2b });

// L3 leak, score
const l3 = await P.g(async () => {
  const g = window.game;
  window.__mt.clear();
  g.stats.combo = 7;
  const hp = g.player.hp;
  g.enemies.push(new Enemy({ text: "leak", x: g.player.x + 30, y: g.laneYs()[2], speed: 0, lane: 2 }));
  await new Promise((r) => setTimeout(r, 300));
  return { hp, after: g.player.hp, combo: g.stats.combo, leaks: g.modesDebug().state().leaks, score: g.stats.score, add: g.addScore(500), score2: g.stats.score, mode: g.mode };
});
P.check("L3 a leak: hull unchanged, combo broken to 0, leaks 1, run continues; after kills stats.score === 0 and addScore(500) returns 0",
  l3.after === l3.hp && l3.combo === 0 && l3.leaks === 1 && l3.score === 0 && l3.add === 0 && l3.score2 === 0 && l3.mode === "playing", l3);

// L6 typed drill (misses on k): lines, outro, bests (first drill)
const drillWords = ["park", "peak", "kept", "pack", "kick", "pink", "spark", "think", "kappa"];
await typeWords(P, drillWords, 200, { missOn: "k" });
const l6a = await P.g(() => {
  const g = window.game, D = g.modesDebug();
  D.advance(50 - D.state().clock);
  const titles = [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((b) => b.title);
  return { titles, said: document.getElementById("srAnnounce").textContent };
});
await P.g(() => window.game.modesDebug().advance(10.5));
const timeBanner = await waitFor(P, () => window.game.banner && window.game.banner.title === "TIME", 1000);
const atCard = await waitMode(P, "modeResults", 2500);
await sleep(1300);
const c6 = await card(P);
const b6 = await P.g(() => ({ profile: { ...window.game.save.profile.bests.drill }, modes: window.game.save.modes.drill }));
const LINE = /^[A-Z] · (\d+% MISSED · PROFILE \d+%|\d+ TR(Y|IES))$/;
P.check("L6 advance to 50 s: callout 10 SECONDS + announce '10 seconds left'; at 60 s banner TIME then modeResults within 2.5 s; tiles WPM / ACC / KEYS / MISSES / LEAKED / COMBO; K and P lines vs the profile (30 %), TH bigram line in ms; FIRST DRILL",
  l6a.titles.includes("10 SECONDS") && l6a.said === "10 seconds left" && timeBanner && atCard && c6.labels.join() === "WPM,ACC,KEYS,MISSES,LEAKED,COMBO" && c6.values[4] === "1" &&
  c6.lines.length === 3 && c6.lines.slice(0, 2).every((l) => LINE.test(l)) && /^K · \d+% MISSED · PROFILE 30%$/.test(c6.lines[0]) && /^P · \d+% MISSED · PROFILE 30%$/.test(c6.lines[1]) &&
  /^TH · \d+ MS · PROFILE 420 MS$/.test(c6.lines[2]) && c6.sub === "FIRST DRILL" && c6.eyebrow === "DRILL · 60 S" && c6.title === "DRILL COMPLETE" && c6.text === "Targets K · P · TH" &&
  c6.again === "Drill again" && !c6.badgeShown && /^Drill complete\. \d+ words per minute at \d+ percent\. K missed \d+ percent, profile 30\. P missed/.test(c6.said),
  { labels: c6.labels, values: c6.values, lines: c6.lines, sub: c6.sub, said: c6.said });
const speed6 = Number(c6.values[0]);
P.check("L6b drill bests: profile.bests.drill (MEASURE, via typistEndSession) and save.modes.drill.best hold this drill's speed / accuracy; runs 1",
  speed6 > 0 && b6.profile.speed === speed6 && b6.modes.best && b6.modes.best.speed === speed6 && b6.modes.runs === 1 && Math.abs(b6.modes.best.acc - c6.result.acc) < 0.06, { b6, speed6 });

// worse, then better
const drillAgain = async (ms) => {
  await P.page.click("#btnModeAgain");
  await waitFor(P, () => window.game.mode === "playing" && !window.game.levelIntro && window.game.wavePhase === "spawn", 10000);
  await typeWords(P, drillWords, ms);
  await P.g(() => window.game.modesDebug().finish("time"));
  await waitMode(P, "modeResults", 2500);
  return card(P);
};
const worse = await drillAgain(320);
const better = await drillAgain(140);
P.check("L6c a slower drill reads DRILL BEST nn WPM AT nn% (the first drill's, accuracy floored); a faster one NEW DRILL BEST", worse.sub === `DRILL BEST ${speed6} WPM AT ${Math.floor(b6.modes.best.acc)}%` && better.sub === "NEW DRILL BEST" &&
  (await P.g(() => window.game.save.modes.drill.runs)) === 3, { worse: worse.sub, better: better.sub });

// L7 isolation
const iso1 = await isolation(P);
P.check("L7 isolation: run, highScore, highScores, sectorBests, lastUnlockedLevel, victories, bestWpm, profile.sectorBest / bests.speed unchanged (blob and memory)", iso1.blob === iso0.blob && iso1.mem === iso0.mem && iso1.deaths === "{}", { blob: iso1.blob === iso0.blob, mem: iso1.mem === iso0.mem });

// No profile: common words, NO WEAK KEYS YET (+ MOST MISSED)
await P.goto(F5());
await sleep(300);
await startMode(P, "drill", { waitGo: false });
const np = await P.g(() => ({ title: window.game.banner.title, sub: document.getElementById("drillSub").textContent }));
await waitFor(P, () => !window.game.levelIntro && window.game.wavePhase === "spawn", 10000);
const npw = await P.g(() => {
  const g = window.game, src = typeof COMMON_WORDS !== "undefined" ? COMMON_WORDS : ALL_WORDS, set = new Set(src);
  let words = 0, inSrc = 0;
  for (let i = 0; i < 400; i++) { const t = g.makeEnemyText(LEVELS[0], 1, null); if (t.length > 1) { words++; if (set.has(t)) inSrc++; } }
  return { words, inSrc, src: typeof COMMON_WORDS !== "undefined" ? "COMMON_WORDS" : "ALL_WORDS", weakShare: g.modesDebug().state().weakShare };
});
await typeWords(P, ["the", "and", "you", "that"], 200, { missOn: "eh" });
await P.g(() => window.game.modesDebug().finish("time"));
await waitMode(P, "modeResults", 2500);
const npc = await card(P);
P.check(`L4b / L6d no profile: card COMMON WORDS, every word from ${npw.src}, weak share 0; lines NO WEAK KEYS YET + MOST MISSED · ...`,
  np.title === "COMMON WORDS" && np.sub === "COMMON WORDS" && npw.words > 200 && npw.inSrc === npw.words && npw.weakShare === 0 && npc.lines[0] === "NO WEAK KEYS YET" && /^MOST MISSED · [A-Z] \d+/.test(npc.lines[1] || "") &&
  npc.text === "Common words", { np, npw, lines: npc.lines });

checkErrors(P);
await P.finish();
