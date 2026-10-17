// B4 acceptance: HP, damage table, shield economy, i-frames, hull meter DOM.
import { openProbe, sleep, state, startFresh, jumpTo, clearField, placeEnemy, hold, continueRun } from "./b_lib.mjs";

const P = await openProbe("b4");
await startFresh(P, "B4");
await jumpTo(P, 4);   // L5
await hold(P);
await clearField(P);

// leak a 12-letter word at L5 without shield -> hp -36 exactly, combo 0
const r1 = await P.g(() => {
  const g = window.game;
  g.player.shield = 0; g.invulnT = 0; g.stats.combo = 7; g.bumpMultiplier();
  const hp0 = g.player.hp;
  const en = new Enemy({ text: "interference", x: g.player.x + 36, y: LANE_YS[2], speed: 400, lane: 2 });
  g.enemies.push(en);
  return { hp0, len: en.text.length };
});
await sleep(120);
const r1b = await state(P);
P.check("leak a 12-letter word at L5 without shield -> hp -36 exactly, combo 0", r1.hp0 - r1b.hp === 36 && r1b.combo === 0, { r1, hp: r1b.hp, combo: r1b.combo, lastCue: r1b.lastCue });

// two leaks .3 s apart -> one hp drop (i-frames .8 s)
const hpA = await P.g(() => { const g = window.game; g.invulnT = 0; const en = new Enemy({ text: "neon", x: g.player.x + 36, y: LANE_YS[1], speed: 400, lane: 1 }); g.enemies.push(en); return g.player.hp; });
await sleep(300);
const hpMid = await P.g(() => { const g = window.game; const en = new Enemy({ text: "neon", x: g.player.x + 36, y: LANE_YS[3], speed: 400, lane: 3 }); g.enemies.push(en); return g.player.hp; });
await sleep(150);
const hpB = await P.g(() => window.game.player.hp);
P.check("two leaks .3 s apart -> exactly one hp drop (i-frames)", hpA - hpMid === 20 && hpB === hpMid, { hpA, hpMid, hpB, expectedLeak: 12 + Math.min(24, 2 * 4) });

// shield 9 + leak -> hp unchanged, shield 6
const s9 = await P.g(() => { const g = window.game; g.invulnT = 0; g.player.shield = 9; const hp = g.player.hp; const en = new Enemy({ text: "pixel", x: g.player.x + 36, y: LANE_YS[2], speed: 400, lane: 2 }); g.enemies.push(en); return hp; });
await sleep(150);
const s9b = await P.g(() => ({ hp: window.game.player.hp, shield: Math.round(window.game.player.shield * 10) / 10, cue: window.game.sfx.lastCue }));
P.check("shield 9 + leak -> hp unchanged, shield ~6 (shieldHit)", s9b.hp === s9 && s9b.shield >= 5.7 && s9b.shield <= 6, s9b);

// shield 2 + leak -> shield 0 and lastCue shieldBreak
await P.g(() => { const g = window.game; g.invulnT = 0; g.player.shield = 2; const en = new Enemy({ text: "pixel", x: g.player.x + 36, y: LANE_YS[2], speed: 400, lane: 2 }); g.enemies.push(en); });
await sleep(150);
const s2 = await P.g(() => ({ shield: window.game.player.shield, cue: window.game.sfx.lastCue }));
P.check("shield 2 + leak -> shield 0 and lastCue === 'shieldBreak'", s2.shield === 0 && s2.cue === "shieldBreak", s2);

// healPlayer at 100/500 -> 175
const heal = await P.g(() => { const g = window.game; g.player.maxHp = 500; g.player.hp = 100; g.healPlayer(Math.round(0.15 * g.player.maxHp)); return g.player.hp; });
P.check("healPlayer(round(.15*maxHp)) at 100/500 -> 175", heal === 175, { hp: heal });

// hp = .2 maxHp -> data-hp crit and #hudHPFill scaleX(0.2); .6 -> ok
const crit = await P.g(() => { const g = window.game; g.player.hp = 0.2 * g.player.maxHp; g.updateHUD(); return { state: document.getElementById("hud").dataset.hp, fill: document.getElementById("hudHPFill").style.transform, ghost: document.getElementById("hudHPGhost").style.transform }; });
const ok = await P.g(() => { const g = window.game; g.player.hp = 0.6 * g.player.maxHp; g.updateHUD(); return { state: document.getElementById("hud").dataset.hp, fill: document.getElementById("hudHPFill").style.transform }; });
P.check("hp=.2*maxHp -> #hud[data-hp=crit] and #hudHPFill transform scaleX(0.2); .6*maxHp -> ok", crit.state === "crit" && crit.fill === "scaleX(0.2)" && ok.state === "ok" && ok.fill === "scaleX(0.6)", { crit, ok });

// #hud.is-hit after real damage (180 ms)
await P.g(() => { const g = window.game; g.player.hp = g.player.maxHp; g.player.shield = 0; g.invulnT = 0; g.takeDamage(10, "leak"); });
const hit1 = await P.g(() => document.getElementById("hud").classList.contains("is-hit"));
await sleep(350);
const hit2 = await P.g(() => document.getElementById("hud").classList.contains("is-hit"));
P.check("#hud.is-hit set on real damage and cleared after 180 ms", hit1 && !hit2, { hit1, hit2 });

// lowHp cue crossing .25
const low = await P.g(() => { const g = window.game; g.player.hp = g.player.maxHp; g.updateLowHp(); g.invulnT = 0; g.player.hp = 0.27 * g.player.maxHp; g.takeDamage(0.05 * g.player.maxHp, "leak"); return { hp: g.player.hp, cue: g.sfx.lastCue, on: g._lowHpOn }; });
P.check("hp crossing below 25 % turns the lowHp beeper on", low.on === true, low);

// fresh L7 via Continue -> maxHp 800
await P.goto({ playerName: "SEVEN", selectedShip: "coconut", highScore: 0, lastUnlockedLevel: 7, storySeen: true, keyboardHintSeen: true, settings: { muted: true, crt: true }, run: null });
await continueRun(P);
await sleep(200);
const l7 = await P.g(() => ({ maxHp: window.game.player.maxHp, hp: window.game.player.hp, levelIndex: window.game.levelIndex }));
P.check("fresh L7 via Continue -> maxHp 800 (getHpBonusForLevel)", l7.maxHp === 800 && l7.hp === 800 && l7.levelIndex === 6, l7);

P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
