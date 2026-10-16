// A3 acceptance (staged "at A3" per amendment C-5): save model v2, checkpoints, high-score commit.
import { openProbe, sleep } from "./_lib.mjs";

const P = await openProbe("a3");
const die = async () => {
  await P.g(() => { window.game.player.hp = 5; });
  await P.page.waitForFunction(() => window.game.mode === "gameOver", null, { timeout: 90000 });
  await sleep(300);
};
const clearSector = async () => {
  await P.forceBoss();
  await sleep(2800);
  await P.autoType(120, { accuracy: 0.995, until: (s) => s.bossClear || s.mode !== "playing" });
};

// ===== 1. legacy-midwave: migrates, Continue works =====
await P.goto("legacy-midwave");
const mig = await P.saveBlob();
const migInfo = await P.g(() => ({ schema: window.game.save.schema, runId: window.game.save.run.id, cp: window.game.save.run.checkpoint, legacy: window.game.save.run.legacy, startLevel: window.game.save.run.startLevel, hazardAcc: window.game.save.run.hazardAcc, stats: window.game.save.run.stats }));
P.check("legacy-midwave loads: schema 2, run.id, run.checkpoint (score 6000), stats deep-merged, hazardAcc tolerated", migInfo.schema === 2 && /^[a-z0-9]{8}$/.test(migInfo.runId) && migInfo.cp && migInfo.cp.score === 6000 && migInfo.cp.kind === "level" && migInfo.stats.maxCombo === 0 && migInfo.stats.score === 6000 && migInfo.hazardAcc === 0, migInfo);
await P.clickContinue();
await sleep(400);
const c1 = await P.state();
const blob1 = await P.saveBlob();
P.check("Continue resumes L3 at score 6000; persisted blob has schema 2 + run.id + run.checkpoint", c1.mode === "playing" && c1.levelIndex === 2 && c1.score === 6000 && blob1.schema === 2 && !!blob1.run.id && !!blob1.run.checkpoint, { c1, schema: blob1.schema, id: blob1.run.id });

// ===== 2. raise to 9000, die, Retry sector -> checkpoint =====
await P.g(() => { window.game.stats.score = 9000; window.game.stats.combo = 12; });
await die();
await P.shot("gameover-l3");
const over1 = await P.g(() => ({ retryBossHidden: document.getElementById("btnRetryBoss").classList.contains("hidden"), runHp: window.game.save.run.hp, label: document.getElementById("btnTryAgain").textContent, note: (document.getElementById("retryNote") || {}).textContent }));
P.check("wave death: #btnRetryBoss hidden, run saved with hp 0, 'Retry sector' label + retryNote", over1.retryBossHidden && over1.runHp === 0 && /Retry sector/i.test(over1.label) && /sector start/i.test(over1.note || ""), over1);
await P.page.click("#btnTryAgain");
await sleep(300);
const r1 = await P.g(() => { const g = window.game; return { score: g.stats.score, combo: g.stats.combo, hp: g.player.hp, maxHp: g.player.maxHp, retries: g.save.run.retries, levelIndex: g.levelIndex, mode: g.mode, levelStatsRetries: g.levelStats.retries }; });
P.check("Retry sector -> score 6000, combo 0, hp===maxHp, run.retries 1, levelIndex 2", r1.score === 6000 && r1.combo === 0 && r1.hp === r1.maxHp && r1.retries === 1 && r1.levelIndex === 2 && r1.mode === "playing", r1);

// ===== 3. Game Over -> menu -> Continue converges =====
await P.g(() => { window.game.stats.score = 9500; });
await die();
await P.page.click("#btnBackToMenu2");
await sleep(300);
await P.clickContinue();
await sleep(300);
const r2 = await P.g(() => { const g = window.game; return { score: g.stats.score, levelIndex: g.levelIndex, combo: g.stats.combo, hp: g.player.hp, maxHp: g.player.maxHp, retries: g.save.run.retries }; });
P.check("Game Over -> menu -> Continue gives the checkpoint score/levelIndex (6000 / 2)", r2.score === 6000 && r2.levelIndex === 2 && r2.combo === 0 && r2.hp === r2.maxHp, r2);

// ===== 4. L1 clear -> blob =====
await P.g(() => window.game.stopToMenu(true));
await P.startRun("A3");
await sleep(300);
await clearSector();
const s0 = (await P.state()).score;
await P.page.waitForFunction(() => window.game.mode === "levelComplete", null, { timeout: 20000 });
await sleep(300);
const blob4 = await P.saveBlob();
const live4 = await P.state();
P.check("after L1 clear: run.levelIndex 1, levelT 0, inBoss false, maxHp 300, checkpoint.score===stats.score, bonus once", blob4.run.levelIndex === 1 && blob4.run.levelT === 0 && blob4.run.inBoss === false && blob4.run.maxHp === 300 && blob4.run.checkpoint.score === live4.score && live4.score === s0 + 2950 && blob4.lastUnlockedLevel >= 2 && blob4.sectorBests["1"] && blob4.sectorBests["1"].score > 0,
  { run: { levelIndex: blob4.run.levelIndex, levelT: blob4.run.levelT, inBoss: blob4.run.inBoss, maxHp: blob4.run.maxHp, cpScore: blob4.run.checkpoint.score }, liveScore: live4.score, s0, sectorBest: blob4.sectorBests["1"] });
await P.shot("level-complete");

// ===== 5. Esc during the finale: #btnRestart hidden; no double bank =====
await P.page.click("#btnNextLevel");
await sleep(300);
await clearSector();
const s5 = (await P.state()).score;
await P.page.keyboard.press("Escape");
await sleep(200);
const esc = await P.g(() => ({ mode: window.game.mode, restartHidden: document.getElementById("btnRestart").classList.contains("hidden"), score: window.game.stats.score, committed: window.game.bossClear && window.game.bossClear.committed }));
P.check("Esc during finale: paused, #btnRestart hidden, clear committed once on the forced save", esc.mode === "paused" && esc.restartHidden && esc.committed === true && esc.score === s5 + (2500 + 450 * 2), esc);
await P.shot("paused-finale");
await P.page.keyboard.press("Escape");
await P.page.waitForFunction(() => window.game.mode === "levelComplete", null, { timeout: 20000 });
const after5 = await P.state();
P.check("finale end after an early commit adds nothing more (L2 bonus banked exactly once)", after5.score === s5 + (2500 + 450 * 2), { score: after5.score, expected: s5 + 3400 });
const restartShown = await P.g(() => { window.game.advanceLevel(); window.game.pauseGame("user"); const h = document.getElementById("btnRestart").classList.contains("hidden"); window.game.setMode("playing"); return h; });
P.check("#btnRestart visible again on a normal pause", restartShown === false, { hidden: restartShown });

// ===== 6. Stop during the finale, then Continue =====
await P.g(() => window.game.stopToMenu(true));
await P.startRun("A3");
await sleep(300);
await clearSector();
const s6 = (await P.state()).score;
await P.page.click("#btnStop");
await sleep(300);
const blob6 = await P.saveBlob();
await P.clickContinue();
await sleep(300);
const r6 = await P.g(() => ({ maxHp: window.game.player.maxHp, hp: window.game.player.hp, score: window.game.stats.score, levelIndex: window.game.levelIndex, inBoss: window.game.inBoss, curve: getHpBonusForLevel(2) }));
P.check("Stop during finale then Continue -> maxHp===getHpBonusForLevel(2), score includes the clear bonus exactly once, next sector", r6.maxHp === r6.curve && r6.hp === r6.maxHp && r6.score === s6 + 2950 && r6.levelIndex === 1 && !r6.inBoss && blob6.run && blob6.run.levelIndex === 1, { ...r6, s6, blobLevel: blob6.run && blob6.run.levelIndex });

// ===== 7. Die in a forced L6 boss -> Retry boss =====
await P.g(() => { const g = window.game; g.stopToMenu(true); g.startNewRun(); g.startLevel(5, { fromMenu: true, fresh: true }); });
await sleep(300);
await P.forceBoss();
await sleep(600);
for (let i = 0; i < 6; i++) { const k = await P.nextKey(); if (k) await P.page.keyboard.press(k); await sleep(60); }
const pre7 = await P.g(() => ({ seg: window.game.boss.segmentIndex, prog: window.game.boss.progress, score: window.game.stats.score, cpScore: window.game.run.bossCheckpoint.score, phase: window.game.boss.phase }));
await die();
const over7 = await P.g(() => ({ retryBossVisible: !document.getElementById("btnRetryBoss").classList.contains("hidden"), runInBoss: window.game.save.run.inBoss, runBoss: window.game.save.run.boss && { seg: window.game.save.run.boss.segmentIndex, n: window.game.save.run.boss.segments.length }, hp: window.game.save.run.hp }));
P.check("boss death: #btnRetryBoss visible, run saved inBoss with hp 0 and boss record", over7.retryBossVisible && over7.runInBoss && over7.runBoss && over7.hp === 0, { pre7, over7 });
await P.shot("gameover-boss");
await P.page.click("#btnRetryBoss");
await sleep(300);
const r7 = await P.g(() => { const g = window.game; return { inBoss: g.inBoss, seg: g.boss && g.boss.segmentIndex, prog: g.boss && g.boss.progress, phaseStart: g.boss && g.boss.phaseStarts[g.boss.phase], score: g.stats.score, cpScore: g.run.bossCheckpoint.score, hp: g.player.hp, maxHp: g.player.maxHp, combo: g.stats.combo, retries: g.run.retries, intro: !!g.bossIntro, levelIndex: g.levelIndex, segments: g.boss && g.boss.segments.length }; });
P.check("Retry boss -> inBoss, boss.segmentIndex===phaseStarts[phase] (0 at A3), progress 0, score===bossCheckpoint.score, full HP, intro replayed", r7.inBoss && r7.seg === r7.phaseStart && r7.seg === 0 && r7.prog === 0 && r7.score === r7.cpScore && r7.score === pre7.cpScore && r7.hp === r7.maxHp && r7.combo === 0 && r7.retries === 1 && r7.intro && r7.levelIndex === 5, r7);
await P.shot("retry-boss");
// boss-death variant of menu -> Continue
await P.g(() => { window.game.stats.score += 777; });
await die();
await P.page.click("#btnBackToMenu2");
await sleep(300);
await P.clickContinue();
await sleep(300);
const r7b = await P.g(() => ({ inBoss: window.game.inBoss, score: window.game.stats.score, cpScore: window.game.run.bossCheckpoint.score, seg: window.game.boss && window.game.boss.segmentIndex }));
P.check("boss death -> menu -> Continue: inBoss with score === run.bossCheckpoint.score", r7b.inBoss && r7b.score === r7b.cpScore && r7b.score === pre7.cpScore, r7b);

// ===== 8. high score on Stop and on hidden (fresh save: the legacy run above legitimately holds 9500 per E-3) =====
await P.g(() => window.game.stopToMenu(true));
await P.page.click("#btnResetSave");
await P.g(() => { window.game.startNewRun(); window.game.stats.score = 5000; });
await sleep(200);
await P.page.click("#btnStop");
await sleep(300);
const blob8 = await P.saveBlob();
P.check("score 5000 then Stop -> save.highScore 5000, highScores[0].score 5000 (one row per run)", blob8.highScore === 5000 && blob8.highScores[0] && blob8.highScores[0].score === 5000 && blob8.highScores.filter(h => h.runId === blob8.highScores[0].runId).length === 1, { highScore: blob8.highScore, top: blob8.highScores.slice(0, 3) });
await P.clickContinue();
await sleep(200);
const hid = await P.g(async () => {
  window.game.stats.score = 5600;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  document.dispatchEvent(new Event("visibilitychange"));
  const hs = JSON.parse(localStorage.getItem("typesmup198x.save.v1")).highScore;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  document.dispatchEvent(new Event("visibilitychange"));
  return { hs, mode: window.game.mode };
});
P.check("visibilitychange hidden commits the high score (5600)", hid.hs === 5600, hid);

// ===== 9. storeSave blocked -> game still starts, warn toast =====
await P.g(() => window.game.stopToMenu(true));
const blocked = await P.g(async () => {
  const orig = localStorage.setItem.bind(localStorage);
  localStorage.setItem = () => { throw new Error("QuotaExceeded (stubbed)"); };
  window.game.toastOnce.delete("persist");
  document.getElementById("btnStart").click();
  await new Promise(r => setTimeout(r, 400));
  const launch = document.getElementById("btnStoryLaunch");
  if (launch && !document.getElementById("storyModal").classList.contains("hidden")) launch.click();
  await new Promise(r => setTimeout(r, 400));
  const toast = document.querySelector("#toastStack .toast--warn");
  const res = { mode: window.game.mode, persistUnavailable: window.game.persistUnavailable, toast: toast && toast.textContent };
  localStorage.setItem = orig;
  return res;
});
P.check("storeSave throwing -> game still starts, persistUnavailable true, warn toast shown", blocked.mode === "playing" && blocked.persistUnavailable === true && /SAVED/.test(blocked.toast || ""), blocked);

// ===== 10. legacy-postvictory / unlocked-only Continue uses the HP curve =====
await P.goto("legacy-postvictory");
const pv = await P.g(() => ({ highScores: window.game.save.highScores, seeded: window.game.save.legacySeeded, continueEnabled: !document.getElementById("btnContinue").disabled }));
await P.clickContinue();
await sleep(300);
const r10 = await P.g(() => ({ maxHp: window.game.player.maxHp, hp: window.game.player.hp, levelIndex: window.game.levelIndex, startLevel: window.game.run.startLevel }));
P.check("legacy-postvictory: highScores seeded from highScore once; Continue (sector 10) -> maxHp 1100 from the curve", pv.seeded && pv.highScores.length === 1 && pv.highScores[0].score === 4200 && r10.maxHp === 1100 && r10.hp === 1100 && r10.levelIndex === 9 && r10.startLevel === 10, { pv, r10 });
await P.goto({ playerName: "SEVEN", selectedShip: "coconut", highScore: 0, lastUnlockedLevel: 7, storySeen: true, keyboardHintSeen: true, settings: { muted: true, crt: true }, run: null });
await P.clickContinue();
await sleep(300);
const r10b = await P.g(() => ({ maxHp: window.game.player.maxHp, hp: window.game.player.hp, levelIndex: window.game.levelIndex }));
P.check("{lastUnlockedLevel:7, run:null} + Continue -> maxHp 800 and hp 800", r10b.maxHp === 800 && r10b.hp === 800 && r10b.levelIndex === 6, r10b);

// ===== 11. legacy-inboss (B-10) and legacy level-complete clamp (E-3) =====
await P.goto("legacy-inboss");
const ib = await P.g(() => { const r = window.game.save.run; return { inBoss: r.inBoss, wavePhase: r.wavePhase, wave: r.wave, levelT: r.levelT, duration: LEVELS[r.levelIndex].duration }; });
await P.clickContinue();
await P.page.waitForFunction(() => window.game.inBoss, null, { timeout: 6000 }).catch(() => {});
const ib2 = await P.state();
P.check("legacy-inboss: migrated to approach (inBoss false, wave 2, levelT duration-1); Continue -> inBoss within 6 s", !ib.inBoss && ib.wavePhase === "approach" && ib.wave === 2 && ib.levelT === ib.duration - 1 && ib2.inBoss, { ib, ib2 });
await P.goto("legacy-levelcomplete");
const lc = await P.g(() => { const r = window.game.save.run; return { levelT: r.levelT, duration: LEVELS[r.levelIndex].duration }; });
P.check("legacy run saved on Level Complete (levelT 130): restored levelT <= duration-1", lc.levelT <= lc.duration - 1 && lc.levelT === lc.duration - 1, lc);

P.check("zero pageErrors across every fixture", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
