// Legacy-save fixtures through the gameplay restore path (B3 save/restore): the harness's [fixture] checks, entered
// through #btnContinue's handler because the resume card stays .hidden until C5's renderResumeCard() lands
// (play.mjs then falls back to Start and the checks cannot pass for reasons outside the wave/boss code).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openProbe, sleep, state, waitFor, continueRun } from "./b_lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const P = await openProbe("b-fixtures");

for (const name of ["legacy-midwave", "legacy-inboss", "legacy-levelcomplete", "legacy-postvictory"]) {
  const fx = JSON.parse(fs.readFileSync(path.join(HERE, "../fixtures", name + ".json"), "utf8"));
  await P.goto(fx.save);
  const t0 = Date.now();
  await continueRun(P);
  const exp = fx.expect || {};
  const details = [];
  const snap = await P.g(() => { const g = window.game; return { levelIndex: g.levelIndex, levelT: g.levelT, duration: LEVELS[g.levelIndex].duration, score: g.stats.score, highScore: g.save.highScore, lastUnlockedLevel: g.save.lastUnlockedLevel, playerName: g.save.playerName, inBoss: g.inBoss, wave: g.wave, wavePhase: g.wavePhase, maxHp: g.player.maxHp }; });
  let pass = true;
  const note = (ok, msg) => { pass = pass && ok; details.push(`${ok ? "ok" : "FAIL"}: ${msg}`); };
  if (exp.levelIndex != null) note(snap.levelIndex === exp.levelIndex, `levelIndex ${snap.levelIndex} (expected ${exp.levelIndex})`);
  if (exp.scoreMin != null) note(snap.score >= exp.scoreMin, `score ${snap.score} (expected >= ${exp.scoreMin})`);
  if (exp.highScore != null) note(snap.highScore === exp.highScore, `highScore ${snap.highScore} (expected ${exp.highScore})`);
  if (exp.lastUnlockedLevel != null) note(snap.lastUnlockedLevel === exp.lastUnlockedLevel, `lastUnlockedLevel ${snap.lastUnlockedLevel}`);
  if (exp.playerName != null) note(snap.playerName === exp.playerName, `playerName ${snap.playerName}`);
  if (exp.levelTBelowDuration) note(snap.levelT < snap.duration, `levelT ${Math.round(snap.levelT * 10) / 10} < duration ${snap.duration}`);
  if (exp.inBossWithinS != null) {
    const ok = await waitFor(P, () => window.game.inBoss, exp.inBossWithinS * 1000);
    note(ok, `inBoss after ${Math.round((Date.now() - t0) / 100) / 10} s (expected within ${exp.inBossWithinS} s)`);
  }
  if (exp.notInBossForS != null) {
    await sleep(exp.notInBossForS * 1000);
    const st = await state(P);
    note(!st.inBoss, `still in wave play ${exp.notInBossForS} s after Continue (inBoss=${st.inBoss})`);
  }
  await P.shot(name);
  P.check(`[fixture] ${name}: ${fx.description.slice(0, 60)}...`, pass, { details, snap });
}

P.check("zero pageErrors across the four fixtures", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
