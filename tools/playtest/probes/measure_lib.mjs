// Helpers for the MEASURE probes (t-measure-*.mjs): a controlled in-page typist. The spawner is frozen, scripted
// plates sit still, and keys go through game.handleTyped(ch) from a setTimeout chain scheduled against
// performance.now(), so intervals are exact to timer jitter. Builds on b_lib.mjs / _lib.mjs.
import { openProbe, sleep, state, typeFor, startFresh, jumpTo, waitFor, press, clearField, placeEnemy, placePowerup, continueRun, nextKey } from "./b_lib.mjs";
export { openProbe, sleep, state, typeFor, startFresh, jumpTo, waitFor, press, clearField, placeEnemy, placePowerup, continueRun, nextKey };

// Installs window.__ty in the page (idempotent).
export async function installTypist(P) {
  await P.g(() => {
    if (window.__ty) return;
    const T = window.__ty = {};
    // Freeze the wave machine: no spawns, no quota end, no wave cap, no boss approach.
    T.hold = () => {
      const g = window.game;
      g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9; g.waveT = 0; g.waveKills = 0; g.levelT = Math.min(g.levelT || 0, 1);
      if (g.powerAcc !== undefined) g.powerAcc = -1e9;
    };
    T.clear = () => { const g = window.game; g.enemies.length = 0; g.powerups.length = 0; g.lock = null; g.lockMisses = 0; };
    T.plate = (text, lane = 2, x = null) => {
      const g = window.game;
      const ys = typeof g.laneYs === "function" ? g.laneYs() : LANE_YS;
      const en = new Enemy({ text, x: x == null ? g.w - 300 : x, y: ys[Math.min(lane, ys.length - 1)], speed: 0, lane });
      g.enemies.push(en);
      return en;
    };
    T.capsule = (type, lane = 2, x = null) => {
      const g = window.game;
      const ys = typeof g.laneYs === "function" ? g.laneYs() : LANE_YS;
      const def = POWERUP_TYPES[type];
      const p = new Powerup({ type, label: def.label, x: x == null ? g.w - 300 : x, y: ys[Math.min(lane, ys.length - 1)], speed: 0, lane });
      g.powerups.push(p);
      return p;
    };
    // steps: [{at, ch} | {at, plate, lane, x} | {at, capsule} | {at, hold: true} | {at, burst: "abc"}]; resolves when done.
    T.run = (steps) => new Promise((resolve) => {
      const g = window.game;
      let i = 0;
      const t0 = performance.now();
      const next = () => {
        while (i < steps.length) {
          const s = steps[i];
          const wait = t0 + s.at - performance.now();
          if (wait > 0.5) { setTimeout(next, wait); return; }
          i++;
          try {
            if (s.hold) T.hold();
            else if (s.plate) T.plate(s.plate, s.lane == null ? 2 : s.lane, s.x == null ? null : s.x);
            else if (s.capsule) T.capsule(s.capsule, s.lane == null ? 2 : s.lane);
            else if (s.burst) { for (const c of s.burst) g.handleTyped(c); }
            else if (s.ch) g.handleTyped(s.ch);
          } catch (e) { console.error("__ty.run", e); }
          if (i < steps.length && steps[i].at > s.at) { setTimeout(next, Math.max(0, t0 + steps[i].at - performance.now())); return; }
        }
        resolve(true);
      };
      next();
    });
    T.speed = (scope, w) => { const s = window.game.typistSpeed(scope, w); return { wpm: s.wpm, n: s.n }; };
  });
}

// Steps for typing `words` (each pushed as a plate just before its first key) at msPerKey. missEvery: after the
// second correct key of each word a wrong key ("q" / "z") lands halfway, and the next correct key comes 2 x msPerKey
// after the previous correct one (errors cost time).
export function wordSteps(words, msPerKey = 200, { miss = false, start = 50, lane = 2 } = {}) {
  const steps = [];
  let t = start;
  for (const w of words) {
    steps.push({ at: t - 20, hold: true });
    steps.push({ at: t - 10, plate: w, lane });
    for (let k = 0; k < w.length; k++) {
      if (miss && k === 3) {
        const wrong = w[k] === "q" ? "z" : "q";
        steps.push({ at: t - msPerKey + msPerKey / 2, ch: wrong });
        t += msPerKey;   // the correct key arrives 2 x msPerKey after the previous correct key
      }
      steps.push({ at: t, ch: w[k] });
      t += msPerKey;
    }
  }
  return steps;
}

export async function runSteps(P, steps) {
  return P.page.evaluate((s) => window.__ty.run(s), steps);
}

export async function holdField(P) {
  await P.g(() => { window.__ty.clear(); window.__ty.hold(); });
}

export async function speed(P, scope = "sector", w) {
  return P.g(([s, ww]) => window.__ty.speed(s, ww), [scope, w]);
}

export async function dbg(P) {
  return P.g(() => window.game.typistDebug());
}

// Fresh save, start a run, wait past the sector card, install the typist, hold the field.
export async function freshControlled(P, name = "MEASURE") {
  await startFresh(P, name);
  await installTypist(P);
  await holdField(P);
}

// Drive a forced boss to its finale with the harness typist, then wait for the card.
export async function clearBoss(P, { wpm = 80, accuracy = 0.99, seconds = 120 } = {}) {
  await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; g.wavePhase = "spawn"; g.spawnAcc = 0; g.hungryT = 0; });
  await waitFor(P, () => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), 20000);
  await typeFor(P, seconds, { wpm, accuracy, until: (s) => s.bossClear || s.mode !== "playing" });
  return waitFor(P, () => window.game.mode === "levelComplete" || window.game.mode === "victory", 20000);
}

// Lose the current sector: hull to 1, a plate at the ship leaks.
export async function dieByLeak(P, words = ["leak"]) {
  await P.g((ws) => {
    const g = window.game;
    g.player.shield = 0; g.invulnT = 0;
    for (const w of ws) { const en = window.__ty.plate(w, 2, g.player.x + 30); en.speed = 0; }
  }, words);
  return waitFor(P, () => window.game.mode === "gameOver", 15000);
}

export const SIGNAL12 = Array.from({ length: 12 }, () => "signal");
