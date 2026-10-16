// Shared helpers for the B-track acceptance probes (b1..b9, b-run). Builds on _lib.mjs (openProbe).
import { openProbe, sleep } from "./_lib.mjs";
export { openProbe, sleep };

// Harness-equivalent typist choice (amendment C-14): nothing during intros, boss first, then the lock, then the
// nearest targetable enemy, then powerups.
export function nextKey(P) {
  return P.page.evaluate(() => {
    const g = window.game;
    try {
      if (g.levelIntro) return null;
      if (g.bossIntro && g.bossIntro.locked) return null;
      const nc = (o) => { if (!o) return null; const v = typeof o.nextChar === "function" ? o.nextChar() : o.nextChar; return v || null; };
      if (g.inBoss && g.boss) { const c = nc(g.boss); if (c) return c; }
      if (g.lock && g.lock.ref && g.lock.ref.alive !== false) { const c = nc(g.lock.ref); if (c) return c; }
      const pick = (arr) => {
        const pool = (arr || []).filter(e => e && e.alive !== false && !e.dying && g.isTargetable(e)).sort((a, b) => a.x - b.x);
        for (const e of pool) { const c = nc(e); if (c) return c; }
        return null;
      };
      return pick(g.enemies) || pick(g.powerups);
    } catch { return null; }
  });
}

export function state(P) {
  return P.page.evaluate(() => {
    const g = window.game;
    return {
      mode: g.mode, levelIndex: g.levelIndex, levelT: g.levelT, inBoss: g.inBoss, bossClear: !!g.bossClear, bossClearT: g.bossClear ? g.bossClear.t : null,
      hp: g.player.hp, maxHp: g.player.maxHp, shield: g.player.shield, score: g.stats.score, combo: g.stats.combo, mult: g.stats.mult,
      total: g.stats.total, correct: g.stats.correct, enemies: g.enemies.length, alive: g.enemies.filter(e => e.alive && !e.dying).length,
      powerups: g.powerups.length, wave: g.wave, waveKills: g.waveKills, wavePhase: g.wavePhase, levelIntro: !!g.levelIntro,
      bossIntroLocked: !!(g.bossIntro && g.bossIntro.locked), lock: g.lock ? g.lock.kind : null, lastCue: g.sfx.lastCue
    };
  });
}

// Types like the harness: key interval 60000/(wpm*5) ms with +-20 % jitter. onTick(st, elapsedMs) runs each loop.
export async function typeFor(P, seconds, { wpm = 80, accuracy = 0.97, until = null, onTick = null } = {}) {
  const interval = 60000 / (Math.max(1, wpm) * 5);
  const t0 = Date.now();
  let typed = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const loopStart = Date.now();
    const st = await state(P);
    if (onTick) await onTick(st, Date.now() - t0);
    if (until && until(st)) break;
    if (st.mode !== "playing") { await sleep(80); continue; }
    const k = await nextKey(P);
    if (k && /^[a-z]$/.test(k)) {
      const wrong = Math.random() > accuracy;
      const key = wrong ? "abcdefghijklmnopqrstuvwxyz".replace(k, "")[Math.floor(Math.random() * 25)] : k;
      await P.page.keyboard.press(key);
      typed++;
      const jitter = interval * (0.8 + Math.random() * 0.4);
      await sleep(Math.max(5, jitter - (Date.now() - loopStart)));
    } else {
      await sleep(60);
    }
  }
  return typed;
}

export async function waitFor(P, fn, timeoutMs = 10000, arg = null) {
  try { await P.page.waitForFunction(fn, arg, { timeout: timeoutMs }); return true; } catch { return false; }
}

// Fresh save, Start, wait until the sector card is gone.
export async function startFresh(P, name = "PROBE") {
  await P.goto("fresh");
  await P.startRun(name);
  await waitFor(P, () => window.game && !window.game.levelIntro, 6000);
}

// Jump to a sector (0-based) with a fresh run and wait past the sector card.
export async function jumpTo(P, levelIndex) {
  await P.g((i) => { const g = window.game; g.stopToMenu(true); g.startNewRun(); g.startLevel(i, { fromMenu: true, fresh: true }); }, levelIndex);
  await waitFor(P, () => window.game && !window.game.levelIntro, 6000);
  await sleep(100);
}

// Clear the field so a scripted scenario starts from nothing; freezes spawning by leaving 'spawn' phase alone
// but with a huge spawnAcc deficit is not possible, so callers set g.wavePhase when they need silence.
export async function clearField(P) {
  await P.g(() => { const g = window.game; g.enemies.length = 0; g.powerups.length = 0; g.lock = null; g.lockMisses = 0; });
}

// Spawn a scripted enemy (speed 0 by default) on a lane; returns its index.
export async function placeEnemy(P, text, x, lane = 2, speed = 0, kind = "enemy") {
  return P.g(({ text, x, lane, speed, kind }) => {
    const g = window.game;
    const en = new Enemy({ text, x, y: LANE_YS[lane], speed, lane, kind });
    g.enemies.push(en);
    return g.enemies.length - 1;
  }, { text, x, lane, speed, kind });
}

export async function placePowerup(P, type, x, lane = 2, speed = 0) {
  return P.g(({ type, x, lane, speed }) => {
    const g = window.game;
    const def = POWERUP_TYPES[type];
    const p = new Powerup({ type, label: def.label, x, y: LANE_YS[lane], speed, lane });
    g.powerups.push(p);
    return g.powerups.length - 1;
  }, { type, x, lane, speed });
}

export async function press(P, key) {
  await P.page.keyboard.press(key);
}

// Stop the wave spawner so a scripted field stays scripted (phase 'drain' spawns nothing; drain times out after
// DRAIN_MAX_S, so re-arm by calling again or finish quickly).
export async function hold(P) {
  await P.g(() => { const g = window.game; g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9; g.waveT = 0; });
}
