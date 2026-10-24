// t-modes-endless (MODES, D9 Endless Drift): start rate from the pilot (PACE pacePilot when present, else MEASURE's
// lifetime speed, else the table), the stream in waveTuning (no quota / time end, own pressure cap), +0.3 cps per 20 s,
// delivered-rate calibration, the first leak ends it with TIME / CEILING / PEAK 10 S and the bests, powerups without
// SHIELD / REPAIR, no damage, no boss, isolation, and the frame budget at 6 cps. PASS = the feature works.
// Usage: node tools/playtest/probes/t-modes-endless.mjs [--dpr 2]
import { openProbe, sleep, F5P, startMode, waitMode, waitFor, isolation, card, typeFor, checkErrors } from "./modes_lib.mjs";

const dpr = process.argv.includes("--dpr") ? Number(process.argv[process.argv.indexOf("--dpr") + 1]) : 1;
const P = await openProbe("t-modes-endless", { dpr });
await P.installCanvasCounters();
await P.goto(F5P());
await sleep(300);
await P.g(() => storeSave(window.game.save));   // the blob in its normalised form (the game's own first write)
const iso0 = await isolation(P);
// The pilot as MODES reads it (contract fallbacks): PACE, else lifetime >= 60 intervals, else sector 1.
const pilotCps = () => P.g(() => {
  const g = window.game;
  if (typeof g.pacePilot === "function") return { cps: g.pacePilot(LEVELS[0]).cps, src: "pace" };
  const s = g.typistSpeed("lifetime");
  return s.n >= 60 && s.wpm > 0 ? { cps: s.wpm / 12, src: "lifetime" } : { cps: LEVELS[0].targetCps, src: "table" };
});
const pilot = await pilotCps();

// E1 start
await startMode(P, "endless", { waitGo: false });
const card1 = await P.g(() => ({ title: window.game.banner && window.game.banner.title, eyebrow: window.game.banner && window.game.banner.eyebrow, said: document.getElementById("srAnnounce").textContent }));
await waitFor(P, () => !window.game.levelIntro && window.game.wavePhase === "spawn", 10000);
const e1 = await P.g(() => {
  const g = window.game, s = g.modesDebug().state(), t = g.waveTuningNow();
  return { mode: g.runMode(), cps: s.cps, wave: g.wave, t: t && { quota: t.quota, capInf: t.cap === Infinity, pressureCap: t.pressureCap }, label: document.getElementById("hudLevel").previousElementSibling.textContent,
    hud: document.getElementById("hudLevel").textContent, hull: getComputedStyle(document.querySelector(".hudCell--hull")).display, stage: getComputedStyle(document.getElementById("stageBar")).display,
    go: [g.banner, g.callout].some((b) => b && b.eyebrow === "DRIFT" && b.sub === "GO") || g.phaseLog.length > 0, li: g.levelIndex, eq: modesStreamParams(s.cps).eqLevel };
});
const cps0 = Math.max(1.2, 0.7 * pilot.cps);
P.check(`E1 start: endless, cps = max(1.2, 0.7 x pilot ${pilot.cps.toFixed(2)} [${pilot.src}]) +-0.01, wave 1, tuning quota >= 1e9 / cap Infinity / pressureCap max(12, round(cps x 10)), HUD Drift 0:0x, hull + stage bar hidden, card ENDLESS DRIFT / STREAM nn WPM, sector = min(eqLevel, U)`,
  e1.mode === "endless" && Math.abs(e1.cps - cps0) <= 0.01 && e1.wave === 1 && e1.t && e1.t.quota >= 1e9 && e1.t.capInf && e1.t.pressureCap === Math.max(12, Math.round(e1.cps * 10)) &&
  e1.label === "Drift" && /^0:0\d$/.test(e1.hud) && e1.hull === "none" && e1.stage === "none" && card1.eyebrow === "ENDLESS DRIFT" && card1.title === `STREAM ${Math.round(cps0 * 12)} WPM` &&
  e1.li === Math.min(e1.eq, 5) - 1 && /^Endless drift\. The stream starts at \d+ words per minute/.test(card1.said), { e1, card1 });

// E2 steps
const e2a = await P.g(() => {
  const g = window.game, D = g.modesDebug();
  const before = D.state().cps;
  D.advance(20);
  const titles = [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((b) => b.title);
  return { before, after: D.state().cps, step: D.state().step, titles, said: document.getElementById("srAnnounce").textContent };
});
const e2b = await P.g(() => {
  const g = window.game, D = g.modesDebug();
  D.advance(120);
  g.updateHUD();
  const s = D.state(), p = modesStreamParams(s.cps), t = g.waveTuningNow(), base = LEVELS[g.levelIndex];
  return { step: s.step, cps: s.cps, win: s.win, p, speed: base.speed * t.speedMul, maxE: base.maxEnemies + t.maxEnemiesAdd, hud: document.getElementById("hudLevel").textContent, pressureCap: t.pressureCap };
});
P.check("E2 advance(20): cps +0.3, callout SIGNAL RISING · nn WPM, announce 'Signal rising, nn words per minute'; advance(120): 6 more steps, the window / plate speed / field size follow modesStreamParams(cps)",
  Math.abs(e2a.after - e2a.before - 0.3) < 1e-6 && e2a.step === 1 && e2a.titles.includes(`SIGNAL RISING · ${Math.round(e2a.after * 12)} WPM`) && /^Signal rising, \d+ words per minute$/.test(e2a.said) &&
  e2b.step === 7 && Math.abs(e2b.cps - (cps0 + 2.1)) < 1e-6 && e2b.win.min === e2b.p.wordMin && e2b.win.max === e2b.p.wordMax && Math.abs(e2b.speed - e2b.p.speed) < 1e-6 && e2b.maxE === e2b.p.maxEnemies &&
  e2b.pressureCap === Math.max(12, Math.round(e2b.cps * 10)) && /^2:\d\d$/.test(e2b.hud), { e2a, e2b });

// E2b pause copy (spec 3.8.3)
await P.page.keyboard.press("Escape");
await waitMode(P, "paused", 2000);
const e2p = await P.g(() => ({ eyebrow: document.getElementById("pauseEyebrow").textContent, restart: document.getElementById("btnRestart").textContent, quit: document.getElementById("btnPauseQuit").textContent,
  tiles: [...document.querySelectorAll("#screenPaused .metaTile")].map((t) => [...t.children].map((c) => c.textContent.trim()).join(" ")) }));
await sleep(250);   // togglePause ignores a second toggle inside 60 ms
await P.page.keyboard.press("Escape");
const e2r = await waitMode(P, "playing", 2000);
P.check("E2b pause: 'Paused // Endless drift', Stream nn WPM / Time m:ss / Score tiles, Restart drift, Quit to menu",
  e2p.eyebrow === "Paused // Endless drift" && e2p.tiles[0] === `Stream ${Math.round(e2b.cps * 12)} WPM` && /^Time 2:2\d$/.test(e2p.tiles[1]) && /^Score \d/.test(e2p.tiles[2]) && e2p.restart === "Restart drift" && e2p.quit === "Quit to menu" && e2r, e2p);

// E3 calibration: the delivered chars/s equals the stream, and the assumed text mix is the delivered mix.
const e3 = await P.g(() => {
  const g = window.game, s = g.modesDebug().state(), t = g.waveTuningNow(), cfg = LEVELS[g.levelIndex];
  const delivered = waveSpawnRate(cfg, 1, g.waveKills, g.waveQuota()) * t.spawnMul * (s.letterRatio + (1 - s.letterRatio) * s.poolMean);
  let letters = 0, wordLen = 0, words = 0;
  for (let i = 0; i < 400; i++) { const x = g.makeEnemyText(cfg, 1, null); if (x.length === 1) letters++; else { words++; wordLen += x.length; } }
  return { cps: s.cps, delivered, poolMean: s.poolMean, meanLen: wordLen / words, letterShare: letters / 400, letterRatio: s.letterRatio };
});
P.check("E3 calibration: waveSpawnRate(row, 1) x spawnMul x (lr + (1 - lr) x poolMean) within 5 % of cps; 400 picks: mean word length within 0.4 of poolMean, letter share within 0.06 of the stream's",
  Math.abs(e3.delivered / e3.cps - 1) <= 0.05 && Math.abs(e3.meanLen - e3.poolMean) <= 0.4 && Math.abs(e3.letterShare - e3.letterRatio) <= 0.06, e3);

// E4 pressure cap (no leaks, no typing, 15 s)
await P.g(() => { const g = window.game; window.__px = g.player.x; g.player.x = -1e4; g.spawnAcc = 0; g.hungryT = 0; });
let e4max = 0, e4cap = 0, e4n = 0;
for (let i = 0; i < 60; i++) {
  const r = await P.g(() => ({ live: window.game.liveChars(), cap: window.game.waveTuningNow().pressureCap, phase: window.game.wavePhase }));
  e4max = Math.max(e4max, r.live - r.cap); e4cap = r.cap; e4n = Math.max(e4n, r.live);
  await sleep(250);
}
await P.g(() => { const g = window.game; g.player.x = window.__px; g.enemies.length = 0; g.lock = null; });
P.check("E4 15 s with no leaks and no typing: every 250 ms liveChars() <= pressureCap + 13 (the field is capped by the stream)", e4max <= 13 && e4n > 0, { overCap: e4max, cap: e4cap, maxLive: e4n });

// E6 powerups subset; E7 no damage, no boss
const e6 = await P.g(() => {
  const g = window.game, seen = new Set();
  for (let i = 0; i < 40; i++) { g.powerups.length = 0; const p = g.spawnPowerup({}); if (p) seen.add(p.type); }
  g.powerups.length = 0;
  return [...seen];
});
P.check("E6 40 x spawnPowerup({}): every type in SPREAD / PIERCE / RAPID / MULTI (no SHIELD / REPAIR in endless)", e6.length > 0 && e6.every((t) => ["SPREAD", "PIERCE", "RAPID", "MULTI"].includes(t)), e6);
const e7a = await P.g(() => { const g = window.game; const hp = g.player.hp; g.invulnT = 0; const d = g.takeDamage(50, "leak"); return { d, hp, after: g.player.hp }; });
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 1; });
await sleep(1200);
const e7b = await P.g(() => ({ approach: window.game.phaseLog.includes("approach"), inBoss: window.game.inBoss, phase: window.game.wavePhase, mode: window.game.mode }));
P.check("E7 takeDamage(50) returns 0 and the hull is unchanged; past the table duration no 'approach' and no boss", e7a.d === 0 && e7a.after === e7a.hp && !e7b.approach && !e7b.inBoss && e7b.phase === "spawn", { e7a, e7b });

// E5 first leak ends it; bests
const leakNow = () => P.g(() => { const g = window.game; g.enemies.push(new Enemy({ text: "drift", x: g.player.x + 30, y: g.laneYs()[2], speed: 0, lane: 2 })); return g.player.hp; });
const hp5 = await leakNow();
const ended = await waitMode(P, "modeResults", 2000);
await sleep(1300);
const c5 = await card(P);
const b5 = await P.g(() => ({ profile: window.game.save.profile.bests.ceiling, modes: window.game.save.modes.endless, hp: window.game.player.hp }));
const ceil5 = Math.round(e2b.cps * 12);
P.check("E5 first leak -> modeResults within 2 s (1 s outro), hull unchanged; tiles TIME / CEILING / PEAK 10 S / ACC / SCORE / COMBO, CEILING = round(cps x 12); FIRST CEILING; bests via typistEndSession (profile) and save.modes",
  ended && b5.hp === hp5 && c5.labels.join() === "TIME,CEILING,PEAK 10 S,ACC,SCORE,COMBO" && c5.values[1] === String(ceil5) && c5.head === `CEILING ${ceil5} WPM` && c5.sub === "FIRST CEILING" &&
  c5.title === "DRIFT ENDED" && c5.eyebrow === "ENDLESS DRIFT" && !c5.badgeShown && !c5.shareShown && c5.again === "Drift again" && b5.profile === ceil5 && b5.modes.best.ceiling === ceil5 && b5.modes.runs === 1 &&
  c5.lines[0] === `STREAM ROSE 7 TIMES FROM ${Math.round(cps0 * 12)} WPM` && /^Drift ended after \d+ (minutes? \d+ )?seconds?\. Ceiling \d+ words per minute, a new best\./.test(c5.said), { c5: { labels: c5.labels, values: c5.values, head: c5.head, sub: c5.sub, lines: c5.lines, said: c5.said }, b5 });
// a lower run, then a higher one
await P.page.click("#btnModeAgain");
await waitFor(P, () => window.game.mode === "playing" && !window.game.levelIntro && window.game.wavePhase === "spawn", 10000);
await leakNow();
await waitMode(P, "modeResults", 2000);
const lower = await card(P);
await P.page.click("#btnModeAgain");
await waitFor(P, () => window.game.mode === "playing" && !window.game.levelIntro && window.game.wavePhase === "spawn", 10000);
await P.g(() => window.game.modesDebug().advance(400));
await leakNow();
await waitMode(P, "modeResults", 2000);
const higher = await card(P);
P.check("E5b a lower run reads BEST CEILING nn WPM; a higher one NEW CEILING · WAS nn WPM (runs 3)", lower.sub === `BEST CEILING ${ceil5} WPM` && higher.sub === `NEW CEILING · WAS ${ceil5} WPM` &&
  (await P.g(() => window.game.save.modes.endless.runs)) === 3, { lower: lower.sub, higher: higher.sub });

// E8 isolation
const iso1 = await isolation(P);
P.check("E8 isolation: run, highScore, highScores, sectorBests, lastUnlockedLevel, victories, bestWpm, profile.sectorBest / bests.speed unchanged (blob and memory)", iso1.blob === iso0.blob && iso1.mem === iso0.mem && iso1.deaths === "{}", { blob: iso1.blob === iso0.blob, mem: iso1.mem === iso0.mem });

// E9 frame budget at 6 cps with a typist
await P.g(() => window.game.stopToMenu(false));
await P.g(() => { window.game.pacePilot = () => ({ cps: 6 / 0.7, wpm: 72 / 0.7, source: "profile", n: 999 }); });   // instance stub: the stream starts at 6 cps
await startMode(P, "endless");
await P.page.focus("#game");
const e9cps = await P.g(() => window.game.modesDebug().state().cps);
await sleep(1000);
await P.g(() => window.__e2Probe.mark());
const [fps] = await Promise.all([P.fps(8000), typeFor(P, 8, { wpm: 110, accuracy: 0.97, until: (s) => s.mode !== "playing" })]);
const snap = await P.g(() => window.__e2Probe.snapshot());
await P.g(() => { delete window.game.pacePilot; });
const typedRun = await P.g(() => window.game.mode === "playing" && window.game.modesDebug().finish("leak"));
await waitMode(P, "modeResults", 3000);
await sleep(1300);
const c9 = await card(P);
P.check(`E9 endless at ${e9cps.toFixed(2)} cps with a 110 WPM typist for 8 s (DPR ${dpr}): fps >= 58, shadowBlur 0 per frame after 1 s, maxRenderMs <= 16, composite sets <= 6`,
  Math.abs(e9cps - 6) < 0.01 && fps >= 58 && snap.shadowBlurPerFrame === 0 && snap.maxRenderMs <= 16 && snap.compositeSetsPerFrame <= 6, { fps, snap });
const peak = Number(c9.values[2]);
P.check("E9b the typed drift's PEAK 10 S tile is MEASURE's 10 s window speed (a number, 30-200 WPM) and the result's peak10", c9.labels[2] === "PEAK 10 S" && peak >= 30 && peak <= 200 && c9.result.peak10 === peak, { typedRun, peak: c9.values[2], result: c9.result && c9.result.peak10 });

checkErrors(P);
await P.finish();
