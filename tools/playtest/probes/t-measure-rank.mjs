// t-measure-rank (MEASURE, D5 the rank explains itself): shortfall copy and its thresholds, the card's rank line /
// ACC caption / WEAK SIGNAL chips, the announcement, Game Over cause lines (leaks, surge, minions), Victory, reduced
// motion and phone landscape. PASS = the feature works.
// Usage: node tools/playtest/probes/t-measure-rank.mjs [--dpr 1|2]
import { openProbe, sleep, waitFor, installTypist, holdField, startFresh, jumpTo, clearBoss, typeFor } from "./measure_lib.mjs";

const dprAt = process.argv.indexOf("--dpr");
const dpr = dprAt > 0 ? Number(process.argv[dprAt + 1]) || 1 : 1;
const P = await openProbe("t-measure-rank", { dpr });
await startFresh(P, "RANK");
await installTypist(P);

// ---- 1. the spec's examples ----
const ex = await P.g(() => {
  const g = window.game;
  return {
    acc93: g.typistShortfall({ acc: 93, wpm: 60, hpPts: 1, hits: 0, level: 4 }),
    spd30: g.typistShortfall({ acc: 98, wpm: 30, hpPts: 1, hits: 0, level: 4 }),
    spd42: g.typistShortfall({ acc: 96, wpm: 42, hpPts: 1, hits: 0, level: 7 }),
    acc85: g.typistShortfall({ acc: 85, wpm: 30, hpPts: 1, hits: 0, level: 4 }),
    hull: g.typistShortfall({ acc: 99, wpm: 70, hpPts: 0.3, hits: 3, level: 6 }),
    s: g.typistShortfall({ acc: 99, wpm: 80, hpPts: 1, hits: 0, level: 5 }),
    sRank: rankFor(99, 80, 1, 5)
  };
});
P.check("1. shortfall copy: the four spec examples, HULL ... 3 HITS, and '' for an S",
  ex.acc93 === "ACCURACY HELD YOU BACK · 93% · S AT 95%" && ex.spd30 === "SPEED HELD YOU BACK · 30 WPM · S AT 36" &&
  ex.spd42 === "SPEED HELD YOU BACK · 42 WPM · S AT 55" && ex.acc85 === "ACCURACY HELD YOU BACK · 85% · B AT 88%" &&
  ex.hull === "HULL HELD YOU BACK · 3 HITS" && ex.s === "" && ex.sRank === "S", ex);

// ---- 1b. speed not measured (under 10 intervals): the speed clause shows "--", as the WPM tile ----
const um = await P.g(() => {
  const g = window.game;
  const parts = g.typistShortfallParts({ acc: 98, wpm: 0, hpPts: 1, hits: 0, level: 1, speedN: 3 });
  const s5 = g.typistShortfall({ acc: 97, wpm: 0, hpPts: 1, hits: 0, level: 5, speedN: 0 });
  const measured = g.typistShortfall({ acc: 98, wpm: 30, hpPts: 1, hits: 0, level: 4, speedN: 80 });
  // through the results filter: a fresh segment (0 intervals) -> results.wpmN 0
  g.typistBeginSegment("sector");
  const evt = { scope: "level", results: { acc: 98, wpm: 0, level: 1, speech: [] } };
  g.typistOnResults(evt);
  return { parts, s5, measured, why: evt.results.rankWhy, n: evt.results.wpmN, say: evt.results.speech[0] };
});
P.check("1b. speed not measured (< 10 intervals): 'SPEED HELD YOU BACK · -- WPM · A AT 9' (not '0 WPM'), speech 'Speed not measured.'; the results filter passes its interval count; a measured speed keeps its number",
  um.parts.text === "SPEED HELD YOU BACK · -- WPM · A AT 9" && um.parts.say === "Speed held you back. Speed not measured. A at 9." && um.s5 === "SPEED HELD YOU BACK · -- WPM · A AT 29" &&
  um.measured === "SPEED HELD YOU BACK · 30 WPM · S AT 36" && um.n === 0 && um.why === um.parts.text && um.say === um.parts.say, um);

// ---- 2. sweep: <= 48 chars and the stated value really reaches the stated grade ----
const sweep = await P.g(() => {
  const g = window.game;
  const order = RANK.order;
  let n = 0, maxLen = 0, maxStr = "", bad = [], clauses = 0, sCount = 0;
  for (let L = 1; L <= 10; L++) for (let acc = 60; acc <= 100; acc += 0.5) for (let wpm = 0; wpm <= 200; wpm += 1) for (const h of [0, 0.3, 0.7, 1]) {
    const hits = h === 1 ? 0 : 99;
    const s = g.typistShortfall({ acc, wpm, hpPts: h, hits, level: L });
    const grade = rankFor(acc, wpm, h, L);
    n++;
    if (grade === "S") { sCount++; if (s !== "" && bad.length < 5) bad.push({ why: "S with a line", acc, wpm, h, L, s }); continue; }
    if (!s && bad.length < 5) bad.push({ why: "no line", acc, wpm, h, L });
    if (s.length > maxLen) { maxLen = s.length; maxStr = s; }
    const next = order[order.indexOf(grade) - 1];
    let m = s.match(/^ACCURACY HELD YOU BACK · ([\d.]+)% · ([SABC]) AT ([\d.]+)%$/);
    if (m) {
      clauses++;
      const got = rankFor(Number(m[3]), wpm, h, L);
      if (m[2] !== next || order.indexOf(got) > order.indexOf(m[2])) { if (bad.length < 5) bad.push({ why: "acc clause", acc, wpm, h, L, s, got }); }
      continue;
    }
    m = s.match(/^SPEED HELD YOU BACK · (\d+) WPM · ([SABC]) AT (\d+)$/);
    if (m) {
      clauses++;
      const got = rankFor(acc, Number(m[3]), h, L);
      if (m[2] !== next || order.indexOf(got) > order.indexOf(m[2])) { if (bad.length < 5) bad.push({ why: "speed clause", acc, wpm, h, L, s, got }); }
      continue;
    }
    if (!/^(ACCURACY HELD YOU BACK · \d+%|SPEED HELD YOU BACK · \d+ WPM|HULL HELD YOU BACK · \d+ HITS?)$/.test(s) && bad.length < 5) bad.push({ why: "format", s });
  }
  return { n, sCount, clauses, maxLen, maxStr, bad };
});
P.check("2. sweep (sectors 1-10, acc 60-100 by .5, speed 0-200, hull 0/.3/.7/1): every line <= 48 chars; each grade clause names the next grade and raising only that term to the stated value reaches it",
  sweep.bad.length === 0 && sweep.maxLen <= 48 && sweep.clauses > 1000, sweep);

// ---- 3 / 4. a sector cleared with forced misses: card line, caption, chips, announcement ----
await holdField(P);
await P.g(() => { window.__ty.clear(); });
await typeFor(P, 8, { wpm: 70, accuracy: 0.85 });
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; g.wavePhase = "spawn"; g.spawnAcc = 0; });
await waitFor(P, () => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), 20000);
await typeFor(P, 120, { wpm: 70, accuracy: 0.88, until: (s) => s.bossClear || s.mode !== "playing" });
await P.page.waitForFunction(() => window.game.mode === "levelComplete", null, { timeout: 20000 });
const ann = await P.g(() => document.getElementById("srAnnounce").textContent);
await sleep(1500);
const card = await P.g(() => {
  const g = window.game, r = g.lastResults, c = document.getElementById("resultsLevel");
  const why = c.querySelector(".rankWhy"), cap = c.querySelector('[data-typist="accCaption"]');
  return {
    rank: r.rank, rankWhy: r.rankWhy, whyText: why.textContent, whyHidden: why.classList.contains("hidden"), whyKind: why.dataset.kind,
    caption: cap.textContent, capHidden: cap.classList.contains("hidden"), misses: g.levelStats.total - g.levelStats.correct,
    chips: [...c.querySelectorAll(".weakSignal .wsChip")].map((x) => x.textContent), stripHidden: c.querySelector(".weakSignal").classList.contains("hidden"),
    speech: r.speech, acc: r.acc
  };
});
const chipOk = card.chips.length >= 1 && card.chips.length <= 3 && card.chips.every((t) => /^[A-Z] · \d+ MISS(ES)?$/.test(t) || /^[A-Z]{2} · \d+0 MS$/.test(t) || /^STEADY \d{1,3}%$/.test(t));
const capWant = card.misses === 0 ? "NO MISSES" : card.misses === 1 ? "1 MISS" : `${card.misses} MISSES`;
P.check("3. Level Complete card: .rankWhy === results.rankWhy (hidden only for S), caption === 'N MISSES' from levelStats, 1-3 chips in the WEAK SIGNAL formats",
  (card.rank === "S" ? card.whyHidden : (!card.whyHidden && card.whyText === card.rankWhy && card.rankWhy.length > 0 && card.whyKind === "shortfall")) &&
  card.caption === capWant && !card.capHidden && card.misses > 1 && chipOk && !card.stripHidden, card);
P.check("4. announcement: #srAnnounce carries the rank-line speech and the misses sentence",
  (card.rank === "S" || ann.includes(card.speech[0])) && /miss/i.test(ann) && card.speech.every((s) => ann.includes(s)), { ann, speech: card.speech });

// ---- 9. reduced motion: the line is final on the first frame ----
const rm = await P.g(() => {
  const g = window.game, c = document.getElementById("resultsLevel");
  const was = g.reduceMotion;
  g.reduceMotion = true;
  g.renderResultsCard(c, g.lastResults, { animate: true });
  const why = c.querySelector(".rankWhy");
  const out = { pending: why.classList.contains("is-pending"), hidden: why.classList.contains("hidden"), text: why.textContent };
  g.reduceMotion = was;
  g.renderResultsCard(c, g.lastResults, { animate: true });
  out.animatedPending = why.classList.contains("is-pending") || why.classList.contains("hidden");
  return out;
});
P.check("9. reduced motion: no is-pending on .rankWhy at the first frame (animated cards fade it in)", rm.pending === false && rm.animatedPending === true, rm);
await sleep(900);

// ---- 10. phone landscape 844 x 390 ----
await P.page.setViewportSize({ width: 844, height: 390 });
await sleep(400);
const phone = await P.g(() => {
  const g = window.game, c = document.getElementById("resultsLevel");
  g.renderResultsCard(c, g.lastResults, { animate: false });
  const why = c.querySelector(".rankWhy"), label = c.querySelector(".weakSignal__label");
  const cs = getComputedStyle(why);
  return { whySW: why.scrollWidth, whyCW: why.clientWidth, ellipsis: cs.textOverflow, whyHidden: why.classList.contains("hidden"),
    cardSW: c.scrollWidth, cardCW: c.clientWidth, docSW: document.documentElement.scrollWidth, docCW: document.documentElement.clientWidth, label: getComputedStyle(label).display };
});
await P.shot("phone-landscape-card");
await P.page.setViewportSize({ width: 1440, height: 900 });
P.check("10. 844 x 390: .rankWhy fits or ellipsises, no horizontal overflow of .resultsCard or the page, .weakSignal__label hidden",
  (phone.whyHidden || phone.whySW <= phone.whyCW + 1 || phone.ellipsis === "ellipsis") && phone.cardSW <= phone.cardCW + 1 && phone.docSW <= phone.docCW + 1 && phone.label === "none", phone);

// ---- 5. Game Over by leaks in wave 2 ----
await jumpTo(P, 1);
await installTypist(P);
await holdField(P);
const leakDeath = await P.g(async () => {
  const g = window.game;
  const T = (ms) => new Promise((r) => setTimeout(r, ms));
  g.wave = 1; g.player.shield = 0;
  g.player.hp = g.player.maxHp;
  const words = ["comet", "laser", "ember", "orbit"];
  for (let i = 0; i < 4; i++) {
    g.invulnT = 0; g.player.shield = 0;
    if (i === 3) g.player.hp = 1;
    window.__ty.hold(); g.wave = 1;
    window.__ty.plate(words[i], 2, g.player.x + 30);
    for (let k = 0; k < 30 && g.enemies.some((e) => e.alive && e.text === words[i]); k++) await T(30);
    await T(60);
  }
  for (let k = 0; k < 60 && g.mode !== "gameOver"; k++) await T(50);
  return { mode: g.mode, leaks: g.typistDebug().leaks, hit: g.typistDebug().hit };
});
await sleep(300);
const over5 = await P.g(() => {
  const c = document.getElementById("resultsOver"), why = c.querySelector(".rankWhy");
  return { text: why.textContent, kind: why.dataset.kind, hidden: why.classList.contains("hidden"), ann: document.getElementById("srAnnounce").textContent, rankWhy: window.game.lastResults.rankWhy };
});
P.check("5. Game Over by leaks: '#resultsOver .rankWhy' === 'SIGNAL LOST · 4 WORDS LEAKED IN WAVE 2', data-kind cause, announced",
  leakDeath.mode === "gameOver" && over5.text === "SIGNAL LOST · 4 WORDS LEAKED IN WAVE 2" && over5.kind === "cause" && !over5.hidden && over5.ann.toLowerCase().includes("4 words leaked in wave 2"), { leakDeath, over5 });

// ---- 7. minion death in phase 2 ----
await jumpTo(P, 1);
await installTypist(P);
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; g.wavePhase = "spawn"; g.spawnAcc = 0; });
await waitFor(P, () => window.game.inBoss && window.game.boss && !(window.game.bossIntro && window.game.bossIntro.locked), 20000);
const minionDeath = await P.g(async () => {
  const g = window.game, b = g.boss;
  const T = (ms) => new Promise((r) => setTimeout(r, ms));
  g.minionAcc = -1e9; b.surgeTimer = -1e9; b.phase = 1;
  g.enemies.length = 0;
  const ys = g.laneYs();
  for (let i = 0; i < 2; i++) {
    g.invulnT = 0; g.player.shield = 0;
    if (i === 1) g.player.hp = 1;
    const used = new Set([b.nextChar]);
    const letter = "zqxjkvwy".split("").find((c) => !used.has(c));
    g.enemies.push(new Enemy({ text: letter, x: g.player.x + 30, y: ys[2], speed: 0, kind: "bossMinion", lane: 2 }));
    for (let k = 0; k < 30 && g.enemies.some((e) => e.alive && e.kind === "bossMinion"); k++) await T(30);
    await T(60);
  }
  for (let k = 0; k < 60 && g.mode !== "gameOver"; k++) await T(50);
  return { mode: g.mode, rankWhy: g.lastResults && g.lastResults.rankWhy, dbg: g.typistDebug().hit, leaks: g.typistDebug().leaks };
});
P.check("7. minion death: 'SIGNAL LOST · 2 MINIONS GOT THROUGH IN PHASE 2'", minionDeath.mode === "gameOver" && minionDeath.rankWhy === "SIGNAL LOST · 2 MINIONS GOT THROUGH IN PHASE 2", minionDeath);

// ---- 6. surge death in phase 3 ----
await jumpTo(P, 2);
await installTypist(P);
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; g.wavePhase = "spawn"; g.spawnAcc = 0; });
await waitFor(P, () => window.game.inBoss && window.game.boss && !(window.game.bossIntro && window.game.bossIntro.locked), 20000);
const surgeDeath = await P.g(async () => {
  const g = window.game, b = g.boss;
  const T = (ms) => new Promise((r) => setTimeout(r, ms));
  g.minionAcc = -1e9; g.enemies.length = 0;
  b.phase = 2; g.invulnT = 0; g.player.shield = 0; g.player.hp = 1;
  g.startSurge();
  g.fireSurge();
  for (let k = 0; k < 60 && g.mode !== "gameOver"; k++) await T(50);
  return { mode: g.mode, rankWhy: g.lastResults && g.lastResults.rankWhy, hit: g.typistDebug().hit, ann: document.getElementById("srAnnounce").textContent };
});
P.check("6. surge death in phase 3: 'SIGNAL LOST · TO THE SURGE IN PHASE 3' (announced)", surgeDeath.mode === "gameOver" && surgeDeath.rankWhy === "SIGNAL LOST · TO THE SURGE IN PHASE 3" && /to the surge in phase 3/i.test(surgeDeath.ann), surgeDeath);

// ---- 8. Victory (sector 10) ----
await P.g(() => { const g = window.game; g.stopToMenu(true); g.startSector(9); });
await waitFor(P, () => window.game.mode === "playing" && !window.game.levelIntro, 15000);
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; g.wavePhase = "spawn"; g.spawnAcc = 0; });
await waitFor(P, () => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), 20000);
await typeFor(P, 300, { wpm: 90, accuracy: 0.9, until: (s) => s.bossClear || s.mode !== "playing" });
await P.page.waitForFunction(() => window.game.mode === "victory", null, { timeout: 30000 }).catch(() => {});
const vicAnn = await P.g(() => document.getElementById("srAnnounce").textContent);
// The run card is rendered when the ending dialogue ends (20-run.js): skip it.
await P.g(() => { const b = document.getElementById("btnEndingSkip"); if (b && !b.classList.contains("hidden")) b.click(); });
await sleep(1600);
const vic = await P.g((ann) => {
  const g = window.game, r = g.lastResults, c = document.getElementById("resultsRun"), why = c.querySelector(".rankWhy");
  return { mode: g.mode, rank: r && r.rank, rankWhy: r && r.rankWhy, text: why.textContent, hidden: why.classList.contains("hidden"), pending: why.classList.contains("is-pending"), cardHidden: c.classList.contains("hidden"), speech: r && r.speech, ann };
}, vicAnn);
await P.shot("victory-card");
P.check("8. Victory: '#resultsRun .rankWhy' present unless S (results.rankWhy), the onVictory announcement carries the speech",
  vic.mode === "victory" && !vic.cardHidden && (vic.rank === "S" ? vic.hidden : (!vic.hidden && !vic.pending && vic.text === vic.rankWhy && vic.rankWhy.length > 0)) && Array.isArray(vic.speech) && vic.speech.every((s) => vic.ann.includes(s)), vic);

P.check("zero page errors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
