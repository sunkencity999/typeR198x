// E2 nit (b): portrait phone HUD budget. At 390x844 (DPR 3, touch) the 16:9 playfield is ~219 px tall; with three
// chips active the HUD (stage bar + two cell rows + chips) must cover <= 22 % of it. Also reports the boss-bar case.
// Usage: node probes/e2-portrait.mjs
import { openProbe, sleep } from "./_lib.mjs";

const P = await openProbe("e2-portrait", { dpr: 3, viewport: { width: 390, height: 844 }, isMobile: true });
await P.goto({ playerName: "PHONE", selectedShip: "sofrito", highScore: 0, lastUnlockedLevel: 4, storySeen: true, keyboardHintSeen: true, settings: { muted: true, crt: true } });
await P.g(() => window.game.startSector(2));
await P.page.waitForFunction(() => window.game.mode === "playing" && !window.game.levelIntro, null, { timeout: 20000 });
await P.g(() => { const g = window.game; g.power.spread = 9; g.power.rapid = 9; g.player.shield = 9; g.syncChips(); g.updateHUD(); });
await sleep(400);

const measure = () => P.g(() => {
  const r = (id) => { const el = document.getElementById(id); const b = el.getBoundingClientRect(); return { top: Math.round(b.top), height: Math.round(b.height * 10) / 10, width: Math.round(b.width) }; };
  const main = r("main"), hud = r("hud"), chips = r("hudChips"), boss = r("bossBar");
  const cs = getComputedStyle(document.getElementById("hud"));
  return { main, hud, chips, boss, pct: Math.round(((hud.top - main.top) + hud.height) / main.height * 1000) / 10, hudPct: Math.round(hud.height / main.height * 1000) / 10,
    chipsVisible: document.querySelectorAll("#hudChips .chip").length, pilotShown: getComputedStyle(document.querySelector(".hudCell--pilot")).display !== "none",
    wpmShown: getComputedStyle(document.querySelector(".hudCell--wpm")).display !== "none", labelPx: getComputedStyle(document.querySelector(".hudCell .label")).fontSize,
    gridCols: cs.gridTemplateColumns, portrait: matchMedia("(orientation: portrait)").matches, coarse: matchMedia("(pointer: coarse)").matches };
});
const wave = await measure();
await P.shot("portrait-wave-chips");
console.log("[e2-portrait] wave HUD:", JSON.stringify(wave));
P.check("390x844 portrait: HUD height <= 22 % of the playfield with three chips (hudPct); pct adds the 6 px top inset", wave.hudPct <= 22 && wave.pct <= 22, wave);
P.check("portrait HUD hides Pilot and WPM and runs 10 px labels", !wave.pilotShown && !wave.wpmShown && wave.labelPx === "10px", { pilot: wave.pilotShown, wpm: wave.wpmShown, labelPx: wave.labelPx });
P.check("three chips are on screen", wave.chipsVisible === 3, wave.chipsVisible);

await P.forceBoss();
await sleep(2800);
const boss = await measure();
await P.shot("portrait-boss");
console.log("[e2-portrait] boss HUD:", JSON.stringify(boss));
P.note("boss fight: HUD + boss bar share of the playfield (reported)", `${boss.pct}% (hud ${boss.hud.height}px, bossBar ${boss.boss.height}px)`);
await P.finish();
