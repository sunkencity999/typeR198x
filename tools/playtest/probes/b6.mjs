// B6 acceptance: powerup arsenal v2 (real SPREAD/PIERCE/RAPID, kill drops, pity, REPAIR, chips).
import { openProbe, sleep, state, startFresh, jumpTo, clearField, placeEnemy, press, hold, waitFor } from "./b_lib.mjs";

const P = await openProbe("b6");
await startFresh(P, "B6");
await hold(P);
await clearField(P);

// 500 rollPowerupType labels == {spread, pierce, rapid, shield, multi, heal}, none with digits
const roll = await P.g(() => {
  const g = window.game;
  const labels = new Set();
  for (let i = 0; i < 500; i++) { const t = g.rollPowerupType(); labels.add(POWERUP_TYPES[t].label); }
  return { labels: [...labels].sort(), digits: [...labels].some(l => /\d/.test(l)) };
});
P.check("500 rollPowerupType() labels == {heal, multi, pierce, rapid, shield, spread}, none with digits", JSON.stringify(roll.labels) === JSON.stringify(["heal", "multi", "pierce", "rapid", "shield", "spread"]) && !roll.digits, roll);

// hp = .2 maxHp -> REPAIR share >= 40 % of 500 rolls
const pity = await P.g(() => {
  const g = window.game;
  const hp = g.player.hp; g.player.hp = 0.2 * g.player.maxHp;
  let heal = 0;
  for (let i = 0; i < 500; i++) if (g.rollPowerupType() === "REPAIR") heal++;
  g.player.hp = hp;
  return { healPct: heal / 5 };
});
P.check("hp = .2*maxHp -> REPAIR share >= 40 % of 500 rolls", pity.healPct >= 40, pity);

// SPREAD: power.spread = 9, three enemies at x 800/860/900 same lane, complete the 800 one -> all three dead, waveKills +3
await clearField(P);
const spread = await P.g(() => {
  const g = window.game;
  g.power.spread = 9;
  g.enemies.push(new Enemy({ text: "neon", x: 800, y: LANE_YS[2], speed: 0, lane: 2 }));
  g.enemies.push(new Enemy({ text: "quartz", x: 860, y: LANE_YS[2], speed: 0, lane: 2 }));
  g.enemies.push(new Enemy({ text: "vector", x: 900, y: LANE_YS[2], speed: 0, lane: 2 }));
  g.waveKills = 0;
  g.handleTyped("n"); g.handleTyped("e"); g.handleTyped("o"); g.handleTyped("n");
  return { dead: g.enemies.filter(e => !e.alive).length, n: g.enemies.length, waveKills: g.waveKills, kills: g.stats.kills };
});
P.check("SPREAD: completing the word at x 800 kills the enemies at 860 and 900 the same frame; waveKills +3", spread.dead === 3 && spread.waveKills === 3, spread);

// PIERCE: lock at x 700 lane 2, enemy at x 820 lane 2 -> that enemy progress === 1 after one correct char
await clearField(P);
const pierce = await P.g(() => {
  const g = window.game;
  g.power.spread = 0; g.power.pierce = 9;
  const a = new Enemy({ text: "arcade", x: 700, y: LANE_YS[2], speed: 0, lane: 2 });
  const b = new Enemy({ text: "zephyr", x: 820, y: LANE_YS[2], speed: 0, lane: 2 });
  g.enemies.push(a, b);
  g.handleTyped("a");
  return { aProgress: a.progress, bProgress: b.progress, lock: g.lock && g.lock.kind };
});
P.check("PIERCE: a correct char on the lock at x 700 lane 2 advances the enemy at x 820 lane 2 to progress 1", pierce.aProgress === 1 && pierce.bProgress === 1, pierce);

// RAPID: two other enemies whose nextChar matches both advance; chainTargets.length === 2
await clearField(P);
const rapid = await P.g(() => {
  const g = window.game;
  g.power.pierce = 0; g.power.rapid = 9; g.chainTargets = [];
  const a = new Enemy({ text: "solar", x: 700, y: LANE_YS[1], speed: 0, lane: 1 });
  const b = new Enemy({ text: "sonar", x: 820, y: LANE_YS[3], speed: 0, lane: 3 });
  const c = new Enemy({ text: "servo", x: 900, y: LANE_YS[4], speed: 0, lane: 4 });
  g.enemies.push(a, b, c);
  g.handleTyped("s");
  return { a: a.progress, b: b.progress, c: c.progress, chain: g.chainTargets.length, cue: g.sfx.lastCue };
});
P.check("RAPID: correct 's' advances both other enemies whose nextChar is 's'; chainTargets.length === 2; chainZap cue", rapid.a === 1 && rapid.b === 1 && rapid.c === 1 && rapid.chain === 2 && rapid.cue === "chainZap", rapid);

// Math.random -> 0 + kill a 5-letter word at (640, 320) -> a powerup within 40 px with fromKill
await clearField(P);
const drop = await P.g(() => {
  const g = window.game;
  g.power.rapid = 0; g.powerups.length = 0;
  const orig = Math.random; Math.random = () => 0;
  try {
    const en = new Enemy({ text: "pixel", x: 640, y: 320, speed: 0, lane: 2 });
    g.enemies.push(en);
    g.killEnemy(en);
  } finally { Math.random = orig; }
  const p = g.powerups[0];
  return p ? { x: p.x, y: p.y, fromKill: p.fromKill, type: p.type, dist: Math.hypot(p.x - 640, p.y - 320) } : null;
});
P.check("Math.random -> 0 + kill a 5-letter word at (640,320) -> a powerup within 40 px with fromKill", !!drop && drop.fromKill && drop.dist <= 40, drop);

// shield active -> #hudChips .chip[data-type=shield] whose chipTime matches player.shield to .1
await P.g(() => { window.game.player.shield = 7.3; window.game.syncChips(); });
await sleep(50);
const chip = await P.g(() => { const g = window.game; const el = document.querySelector("#hudChips .chip[data-type=shield]"); return el ? { time: el.querySelector(".chipTime").textContent, shield: g.player.shield, p: el.style.getPropertyValue("--p"), accent: el.style.getPropertyValue("--accent"), icon: !!el.querySelector(".chipIcon svg") } : null; });
P.check("shield active -> #hudChips .chip[data-type=shield] whose .chipTime matches player.shield to .1", !!chip && Math.abs(parseFloat(chip.time) - chip.shield) <= 0.1 && chip.icon, chip);
await P.shot("chips");
// chip leaves after the timer ends
await P.g(() => { window.game.player.shield = 0; window.game.syncChips(); });
await sleep(300);
const gone = await P.g(() => !!document.querySelector("#hudChips .chip[data-type=shield]"));
P.check("shield chip removed after the timer reaches 0 (.is-leaving 160 ms)", gone === false, { stillThere: gone });

// collectPowerup: REPAIR heals 15 % and plays pickup; MULTI raises the mult by two tiers
const collect = await P.g(() => {
  const g = window.game;
  g.player.maxHp = 400; g.player.hp = 100;
  const r = new Powerup({ type: "REPAIR", label: "heal", x: 600, y: LANE_YS[2], speed: 0, lane: 2 });
  g.powerups.push(r); g.collectPowerup(r);
  const hpAfter = g.player.hp;
  g.stats.combo = 0; g.bumpMultiplier();
  const m = new Powerup({ type: "MULTI", label: "multi", x: 600, y: LANE_YS[2], speed: 0, lane: 2 });
  g.powerups.push(m); g.collectPowerup(m);
  return { hpAfter, cueRepair: null, mult: g.stats.mult, multiTimer: g.power.multiplier };
});
P.check("REPAIR heals round(.15*maxHp) (100 -> 160 at maxHp 400); MULTI sets mult to 3 at combo 0 and a 12 s timer", collect.hpAfter === 160 && collect.mult === 3 && collect.multiTimer === 12, collect);

// forced boss: powerups.length > 0 at least once in 25 s (floor spawn 18 s)
await jumpTo(P, 1);
await P.g(() => { window.game.levelT = LEVELS[1].duration + 0.01; });
await waitFor(P, () => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), 15000);
await P.g(() => { window.game.powerups.length = 0; window.game.powerAcc = 0; });
const sawPowerup = await waitFor(P, () => window.game.powerups.length > 0, 25000);
const bossPu = await P.g(() => ({ n: window.game.powerups.length, types: window.game.powerups.map(p => p.type), acc: window.game.powerAcc }));
P.check("forced boss: powerups.length > 0 at least once within 25 s (floor spawn)", sawPowerup, bossPu);

P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
