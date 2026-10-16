// E2 colour-vision check: the same six scenes under normal vision, deuteranopia and achromatopsia (Chrome's
// Emulation.setEmulatedVisionDeficiency), saved under tools/playtest/out/e2-vision for review. The scenes carry the
// shape cues that must survive without hue: lock brackets + caret on the locked plate, the pulsing stroke on a danger
// plate, the chamfered capsule vs the plate pill, the hull meter's ghost drain + crit pulse + data-hp text, rank
// letters on the sector grid and the results card, the chip icons. The probe also asserts the cues exist in the DOM /
// draw state; the visual review is the screenshots.
// Usage: node probes/e2-vision.mjs
import { openProbe, sleep } from "./_lib.mjs";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../out/e2-vision");
fs.mkdirSync(OUT, { recursive: true });
const P = await openProbe("e2-vision", { dpr: 1 });
const MODES = ["none", "deuteranopia", "achromatopsia"];
const saved = [];
const captureAll = async (scene) => {
  for (const m of MODES) {
    await P.vision(m);
    await sleep(120);
    const file = path.join(OUT, `${scene}-${m}.png`);
    await P.page.screenshot({ path: file });
    saved.push(path.relative(path.resolve(OUT, "../.."), file));
  }
  await P.vision("none");
};

// Menu with a mixed sector grid: cleared (rank badges), current, locked; a saved run (resume card).
await P.goto({
  schema: 2, playerName: "VISION", selectedShip: "sofrito", highScore: 48200, lastUnlockedLevel: 5, storySeen: true, keyboardHintSeen: true,
  settings: { muted: true, crt: true },
  sectorBests: { "1": { score: 9100, rank: "S", wpm: 62, acc: 98, maxCombo: 40, date: 1 }, "2": { score: 8800, rank: "A", wpm: 55, acc: 95, maxCombo: 30, date: 1 }, "3": { score: 6100, rank: "B", wpm: 44, acc: 91, maxCombo: 18, date: 1 }, "4": { score: 4200, rank: "D", wpm: 30, acc: 82, maxCombo: 9, date: 1 } },
  run: { id: "r1", startLevel: 1, levelIndex: 4, levelT: 20, wave: 1, waveKills: 3, wavePhase: "spawn", inBoss: false, hp: 400, maxHp: 600, shield: 0,
    power: { spread: 0, pierce: 0, rapid: 0, multiplier: 0 }, stats: { score: 31200, combo: 0, mult: 1, correct: 900, total: 950, maxCombo: 40, kills: 200, words: 120, letters: 80, chars: 900, misses: 50, timeMs: 400000, bossTimeMs: 0, retries: 0 },
    shipId: "sofrito", difficulty: "standard", retries: 0, checkpoint: { kind: "level", levelIndex: 4, score: 30000, correct: 880, total: 930, kills: 195, words: 118, chars: 880, misses: 50, maxCombo: 40, timeMs: 390000, maxHp: 600, retries: 0 }, spawnAcc: 0, powerAcc: 0, minionAcc: 0 }
});
await sleep(800);
const grid = await P.g(() => Array.from(document.querySelectorAll(".sectorCard")).map((c) => ({ cls: c.className.replace("sectorCard", "").trim(), status: c.querySelector(".sectorStatus").textContent.trim(), disabled: c.disabled })));
await captureAll("01-menu");
P.check("sector grid states carry text / shape cues (rank letter, NEXT / RESUME, disabled)", grid.slice(0, 4).every((c) => /^[SABCD]/.test(c.status)) && /RESUME|NEXT/.test(grid[4].status) && grid[5].disabled, grid);

// Gameplay: a locked plate, a danger plate near the ship, a capsule, three chips, crit hull.
await P.g(() => window.game.startSector(2));
await P.page.waitForFunction(() => { const g = window.game; return g.mode === "playing" && g.levelReady && !g.levelIntro && g.wavePhase === "spawn"; }, null, { timeout: 25000 });
const play = await P.g(() => {
  const g = window.game;
  while (g.enemies.filter((e) => e.alive).length < 5) { if (!g.spawnEnemy()) break; }
  const live = g.enemies.filter((e) => e.alive && !e.dying);
  live.forEach((e, k) => { e.x = g.w * (0.3 + 0.16 * k); });
  // danger plate: inside DANGER_X (35 % of the width); locked plate: the next one, locked by its first letter
  const danger = live[0]; if (danger) danger.x = g.w * 0.24;
  // lock a word: try the longest first; a candidate whose first letter a nearer plate shares (or a single letter)
  // would be killed by the keystroke instead of locked, so keep trying until the lock holds
  let target = null;
  for (const c of live.slice(1).filter((e) => e.text.length >= 3).sort((a, b) => b.text.length - a.text.length)) {
    g.handleTyped(c.nextChar());
    if (g.lock && g.lock.ref === c) { target = c; break; }
    if (g.lock) g.releaseLock("manual");
  }
  const cap = g.spawnPowerup({ type: "SHIELD" }); if (cap) cap.x = g.w * 0.62;
  g.power.spread = 9; g.power.multiplier = 12; g.player.shield = 9; g.syncChips();
  g.player.hp = Math.round(g.player.maxHp * 0.2); g.updateLowHp(); g.updateHUD();
  g.clearBanners();
  return { enemies: live.length, texts: live.map((e) => e.text), target: target && target.text, locked: !!(g.lock && g.lock.ref && g.lock.ref.locked), lockKind: g.lock && g.lock.kind, dangerState: danger ? g.enemyState(danger) : null, capsule: !!cap, hp: g.player.hp, dataHp: document.getElementById("hud").dataset.hp,
    chipIcons: Array.from(document.querySelectorAll("#hudChips .chip")).map((c) => ({ type: c.dataset.type, icon: !!c.querySelector(".chipIcon svg path") })), hullText: document.getElementById("hudHP").textContent };
});
await sleep(450);   // let the ghost drain (600 ms delay 250) and the crit pulse be visible
await captureAll("02-play-locked-danger-capsule-crit");
P.check("locked plate (brackets + caret), danger plate state, capsule and crit hull present", play.locked && play.lockKind === "enemy" && play.dangerState === "danger" && play.capsule && play.dataHp === "crit", play);
P.check("every chip carries its VIS-05 icon (shape cue)", play.chipIcons.length === 3 && play.chipIcons.every((c) => c.icon), play.chipIcons);

// HUD close-up of the crit meter (clip) for the review.
for (const m of MODES) { await P.vision(m); await sleep(80); const el = await P.page.$("#hud"); const f = path.join(OUT, `03-hud-crit-${m}.png`); await el.screenshot({ path: f }); saved.push(path.relative(path.resolve(OUT, "../.."), f)); }
await P.vision("none");

// Results card with a rank badge (sector clear).
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; });
await P.page.waitForFunction(() => window.game.inBoss, null, { timeout: 15000 });
await P.g(() => { const g = window.game; if (g.bossIntro) g.skipBossIntro(); });
await P.autoType(120, { accuracy: 0.995, until: (s) => s.bossClear || s.mode !== "playing" });
await P.g(() => { const g = window.game; if (g.bossClear) { g.bossClear.t = Math.max(g.bossClear.t, 2.1); g.skipFinale("probe"); } });
await P.page.waitForFunction(() => window.game.mode === "levelComplete", null, { timeout: 20000 });
await sleep(1600);   // rank stamp at 700 ms, count-ups done
const card = await P.g(() => { const b = document.querySelector("#resultsLevel .rankBadge"); return { rank: b && b.dataset.rank, text: b && b.textContent.trim(), bonusRows: document.querySelectorAll("#resultsLevel .bonusRow").length }; });
await captureAll("04-results-rank");
P.check("results card shows the rank as a letter (not hue only)", !!card.rank && card.text === card.rank && /^[SABCD]$/.test(card.text), card);

// Boss fight (slab, phase meter) under the two deficiencies, for completeness.
await P.g(() => window.game.startSector(3));
await P.page.waitForFunction(() => { const g = window.game; return g.mode === "playing" && g.levelReady && !g.levelIntro; }, null, { timeout: 25000 });
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; });
await P.page.waitForFunction(() => window.game.inBoss && window.game.bossIntro && !window.game.bossIntro.locked, null, { timeout: 15000 }).catch(() => {});
await sleep(700);
await captureAll("05-boss");

fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ modes: MODES, screenshots: saved }, null, 2));
console.log("[e2-vision] screenshots:\n  " + saved.join("\n  "));
P.note("screenshots saved", `${saved.length} files under tools/playtest/out/e2-vision`);
await P.finish();
