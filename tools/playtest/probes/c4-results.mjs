// C4 acceptance probe: results cards on Level Complete / Game Over / Victory, retry copy, ending progress, reduced motion.
// Usage: cd tools/playtest && node probes/c4-results.mjs
import { openProbe, sleep } from "./_lib.mjs";
import { chromium } from "playwright";

const P = await openProbe("c4");
const { page } = P;

await P.goto(null);
await P.startRun("C4");
await page.waitForFunction(() => window.game && !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
await P.g(() => { window.game.invulnT = 1000; });
await P.autoType(6, { accuracy: 0.95 });
await P.forceBoss();
await page.waitForFunction(() => { const g = window.game; return g.inBoss && !(g.bossIntro && g.bossIntro.locked); }, null, { timeout: 15000 }).catch(() => {});
await P.autoType(90, { accuracy: 0.97, until: (s) => s.bossClear || s.mode !== "playing" });
await page.waitForFunction(() => window.game.mode === "levelComplete", null, { timeout: 25000 }).catch(() => {});
const mode1 = await P.g(() => window.game.mode);
P.check("level complete reached", mode1 === "levelComplete", `mode=${mode1}`);

// Values count up: a sample taken right after the screen activates is below the final one.
const early = await P.g(() => document.querySelector('#resultsLevel [data-stat="score"], #resultsLevel [data-stat="bonus"]').textContent);
await sleep(1600);
const lc = await P.g(() => {
  const card = document.getElementById("resultsLevel");
  const badge = card.querySelector(".rankBadge");
  const labels = [...card.querySelectorAll(".statTile__label")].map((l) => l.textContent.trim().toUpperCase());
  const val = (k) => card.querySelector(`[data-stat="${k}"]`).textContent.trim();
  const g = window.game;
  return {
    rank: badge.textContent.trim(), dataRank: badge.dataset.rank, labels,
    wpm: val("wpm"), acc: val("acc"), combo: val("maxCombo"), words: val("words"), time: val("time"), bonus: val("bonus"),
    bonusRows: card.querySelectorAll(".bonusRow").length,
    primary: document.getElementById("btnNextLevel").classList.contains("primary"), primaryText: document.getElementById("btnNextLevel").textContent.trim(),
    eyebrow: document.getElementById("levelCompleteEyebrow").textContent.trim(), title: document.getElementById("levelCompleteTitle").textContent.trim(),
    sub: document.getElementById("levelCompleteText").textContent.trim(),
    expectWpm: g.buildResults("level").wpm, resultsWpm: g.lastResults && g.lastResults.wpm, tally: g.lastTally && g.lastTally.total,
    newBest: !card.querySelector(".newBest").classList.contains("hidden"),
    cardTitle: card.querySelector(".resultsTitle").textContent.trim(), cardSub: card.querySelector(".resultsHead .resultsSub").textContent.trim()
  };
});
P.check("rank badge shows a letter S/A/B/C/D", /^[SABCD]$/.test(lc.rank) && lc.dataRank === lc.rank, JSON.stringify({ rank: lc.rank, dataRank: lc.dataRank }));
P.check("six tiles WPM ACC COMBO WORDS TIME BONUS", JSON.stringify(lc.labels) === JSON.stringify(["WPM", "ACC", "COMBO", "WORDS", "TIME", "BONUS"]), JSON.stringify(lc.labels));
P.check("WPM/ACC/TIME non-zero, no dashes", Number(lc.wpm) > 0 && parseInt(lc.acc, 10) > 0 && lc.time !== "0:00" && !/—/.test(lc.wpm + lc.acc + lc.combo + lc.words + lc.time + lc.bonus), JSON.stringify(lc));
P.check("[data-stat=wpm] within ±2 of buildResults('level').wpm", Math.abs(Number(lc.wpm) - lc.expectWpm) <= 2, `tile=${lc.wpm} expect=${lc.expectWpm}`);
P.check(">= 5 .bonusRow and bonus tile = tally total", lc.bonusRows >= 5 && lc.bonus === `+${lc.tally.toLocaleString()}`, JSON.stringify({ rows: lc.bonusRows, bonus: lc.bonus, tally: lc.tally }));
P.check("'Next sector' is the primary", lc.primary && /next sector/i.test(lc.primaryText), lc.primaryText);
P.check("eyebrow 'SECTOR 1 CLEAR', title differs and names the boss", lc.eyebrow === "SECTOR 1 CLEAR" && lc.title !== lc.eyebrow && /SIGNAL WRAITH/.test(lc.title), JSON.stringify({ eyebrow: lc.eyebrow, title: lc.title }));
P.check("sub 'Next: Sector 2 — VECTOR OGRE · Max HP 300'", lc.sub === "Next: Sector 2 — VECTOR OGRE · Max HP 300", lc.sub);
P.check("values counted up (early sample below the final)", early !== lc.bonus, `early=${early} final=${lc.bonus}`);
P.check("first clear shows SECTOR BEST badge", lc.newBest === true, JSON.stringify({ newBest: lc.newBest, cardTitle: lc.cardTitle, cardSub: lc.cardSub }));
await P.shot("level-complete");

// Game over on sector 2: retry copy and the checkpoint restore.
await page.click("#btnNextLevel");
await page.waitForFunction(() => window.game.mode === "playing" && window.game.levelIndex === 1, null, { timeout: 10000 });
await page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
await P.g(() => { const g = window.game; g.invulnT = 0; g.player.hp = 5; });
await page.waitForFunction(() => window.game.mode === "gameOver", null, { timeout: 60000 }).catch(() => {});
await sleep(1600);
const go = await P.g(() => {
  const g = window.game;
  const run = g.run || g.save.run;
  return {
    mode: g.mode, tryAgain: document.getElementById("btnTryAgain").textContent.trim(), note: document.getElementById("retryNote").textContent.trim(),
    sub: document.getElementById("gameOverText").textContent.trim(), cpScore: run && run.checkpoint ? run.checkpoint.score : null,
    scoreTile: document.querySelector('#resultsOver [data-stat="score"]').textContent.trim(), score: g.stats.score,
    rank: document.querySelector("#resultsOver .rankBadge").textContent.trim(), title: document.querySelector("#resultsOver .resultsTitle").textContent.trim(),
    bonusRows: document.querySelectorAll("#resultsOver .bonusRow").length
  };
});
P.check("game over: 'Retry sector 2' and the checkpoint note with its score", go.mode === "gameOver" && /^Retry sector 2$/.test(go.tryAgain) && go.note.includes("checkpoint") && go.note.includes(Number(go.cpScore).toLocaleString()), JSON.stringify(go));
P.check("game over sub 'Sector 2 · wave k/3' or boss", /^Sector 2 · (wave [123]\/3|boss .+)$/.test(go.sub), go.sub);
P.check("game over card: score tile = stats.score, rank letter, no bonus rows", go.scoreTile === Number(go.score).toLocaleString() && /^[SABCD]$/.test(go.rank) && go.bonusRows === 0, JSON.stringify({ scoreTile: go.scoreTile, score: go.score, rank: go.rank, title: go.title }));
await P.shot("game-over");
await page.click("#btnTryAgain");
await page.waitForFunction(() => window.game.mode === "playing", null, { timeout: 10000 });
const afterRetry = await P.g(() => ({ score: window.game.stats.score, cp: window.game.run.checkpoint.score, level: window.game.levelIndex }));
P.check("Retry sector -> stats.score === run.checkpoint.score", afterRetry.score === go.cpScore && afterRetry.score === afterRetry.cp && afterRetry.level === 1, JSON.stringify(afterRetry));

// Victory: dialogue first, progress text, Escape -> run results with Play again focused.
await P.g(() => {
  const g = window.game;
  if (typeof g.startSector === "function") g.startSector(9); else g.startLevel(9, { fromMenu: true, fresh: true });
  const full = getHpBonusForLevel(10);
  if (g.player.maxHp < full) { g.player.maxHp = full; g.player.hp = full; }
  g.invulnT = 1000;
});
await sleep(500);
await P.forceBoss();
await page.waitForFunction(() => { const g = window.game; return g.inBoss && g.levelIndex === 9 && !(g.bossIntro && g.bossIntro.locked); }, null, { timeout: 15000 }).catch(() => {});
await P.g(() => { window.game.invulnT = 1000; });
await P.autoType(240, { accuracy: 0.995, until: (s) => s.bossClear || s.mode !== "playing" });
await page.waitForFunction(() => window.game.mode === "victory", null, { timeout: 30000 }).catch(() => {});
const v0 = await P.g(() => ({ mode: window.game.mode, progress: document.getElementById("endingProgress").textContent.trim(), stage: document.getElementById("endingStage").textContent.trim(), n: window.game.endingScript.length, hiddenCard: document.getElementById("resultsRun").classList.contains("hidden"), speaker: document.querySelector("#screenVictory .dialogueWindow").dataset.speaker }));
P.check("victory: #endingProgress '1 / N', #endingStage 'INCOMING TRANSMISSION' (no second counter), results hidden", v0.mode === "victory" && v0.progress === `1 / ${v0.n}` && v0.stage === "INCOMING TRANSMISSION" && v0.hiddenCard, JSON.stringify(v0));
await sleep(700);
await P.shot("victory-dialogue");
await page.keyboard.press("Escape");
await sleep(1600);
const v1 = await P.g(() => {
  const card = document.getElementById("resultsRun");
  const cs = getComputedStyle(card);
  return {
    mode: window.game.mode, hidden: card.classList.contains("hidden"), display: cs.display, opacity: cs.opacity,
    active: document.activeElement && document.activeElement.id, newRunVisible: !document.getElementById("btnNewRun").classList.contains("hidden"),
    title: card.querySelector(".resultsTitle").textContent.trim(), sub: card.querySelector(".resultsHead .resultsSub").textContent.trim(),
    rank: card.querySelector(".rankBadge").textContent.trim(), scoreTile: card.querySelector('[data-stat="score"]').textContent.trim(), score: window.game.stats.score,
    credits: !document.getElementById("creditsLine").classList.contains("hidden"), nextHidden: document.getElementById("btnEndingNext").classList.contains("hidden"),
    collapsed: document.querySelector("#screenVictory .dialogueWindow").classList.contains("is-collapsed")
  };
});
P.check("Escape -> #resultsRun visible, #btnNewRun visible and focused", v1.mode === "victory" && !v1.hidden && v1.display !== "none" && v1.opacity === "1" && v1.newRunVisible && v1.active === "btnNewRun", JSON.stringify(v1));
P.check("run card: LEGEND STATUS GRANTED, 'All ten sectors · NAME', rank + score", v1.title === "LEGEND STATUS GRANTED" && /^All ten sectors · /.test(v1.sub) && /^[SABCD]$/.test(v1.rank) && v1.scoreTile === Number(v1.score).toLocaleString(), JSON.stringify({ title: v1.title, sub: v1.sub, rank: v1.rank, scoreTile: v1.scoreTile }));
P.check("credits shown, Next retired, window collapsed", v1.credits && v1.nextHidden && v1.collapsed, JSON.stringify({ credits: v1.credits, nextHidden: v1.nextHidden, collapsed: v1.collapsed }));
await P.shot("victory-results");
P.check("no page errors through victory", P.errors.pageErrors.length === 0, JSON.stringify(P.errors.pageErrors));

// Reduced motion: tile values are final on the first frame after the screen activates.
{
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });
  await pg.fill("#playerName", "RM").catch(() => {});
  await pg.click("#btnStart");
  const story = pg.locator("#btnStoryLaunch");
  try { await story.waitFor({ state: "visible", timeout: 2500 }); await story.click(); } catch {}
  await pg.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });
  await pg.waitForFunction(() => !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
  await pg.evaluate(() => { const g = window.game; g.invulnT = 1000; g.levelT = LEVELS[0].duration + 0.01; });
  await pg.waitForFunction(() => { const g = window.game; return g.inBoss && !(g.bossIntro && g.bossIntro.locked); }, null, { timeout: 15000 }).catch(() => {});
  // Local typist for the boss
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const st = await pg.evaluate(() => ({ mode: window.game.mode, clear: !!window.game.bossClear, k: window.game.boss ? window.game.boss.nextChar : null }));
    if (st.mode !== "playing" || st.clear) break;
    if (st.k && /^[a-z]$/.test(st.k)) await pg.keyboard.press(st.k);
    await sleep(45);
  }
  const samples = await pg.evaluate(() => new Promise((resolve) => {
    const out = [];
    const el = () => document.querySelector('#resultsLevel [data-stat="wpm"]');
    const start = () => {
      const t0 = performance.now();
      const tick = () => {
        out.push(el().textContent);
        if (performance.now() - t0 < 400) setTimeout(tick, 50); else resolve({ out, final: el().textContent, rm: document.documentElement.classList.contains("reduce-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches });
      };
      tick();
    };
    const wait = () => { if (window.game.mode === "levelComplete") start(); else if (performance.now() > 30000 * 10) resolve({ out, final: null }); else setTimeout(wait, 10); };
    wait();
  }));
  P.check("reduced motion: tile values final from the first poll", samples.final != null && samples.out.every((v) => v === samples.final) && samples.final !== "—", JSON.stringify(samples));
  P.check("reduced motion run: no page errors", errs.length === 0, JSON.stringify(errs));
  await browser.close();
}

await P.finish();
