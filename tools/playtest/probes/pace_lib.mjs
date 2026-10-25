// Helpers for the PACE probes (t-pace-*.mjs). Builds on b_lib.mjs / _lib.mjs (openProbe, typist choice, fixtures).
//   paceType(P, seconds, opts)  the harness typist paced by the PLAY clock (b10's loop): WPM stays honest when Chrome is
//                               starved (other agents' browsers) and the game's dt clamp slows the world.
//   forceClear(P, { hp })       force the sector's boss and kill it at once (finale skipped): Level Complete / Victory.
//   dieNow(P)                   the hull to 1 and one unshielded hit: Game Over.
//   reloadInPlace(P)            the stored blob re-read through loadSave() (b3's in-place reload), then Continue.
//   installBudget(P)            per-frame canvas budget counters (play.mjs installProbe, compact): call BEFORE goto().
import { openProbe, sleep, state, waitFor, startFresh, jumpTo, press, clearField, placeEnemy, continueRun, nextKey, hold, typistTarget, acquireOpts, acquireDelayMs } from "./b_lib.mjs";
export { openProbe, sleep, state, waitFor, startFresh, jumpTo, press, clearField, placeEnemy, continueRun, nextKey, hold };

// The b10 typist choice (boss minions past DANGER_X first, then the boss, the lock, the nearest targetable plate).
export function typistKey(P, policy = "danger") {
  return P.page.evaluate((policy) => {
    const g = window.game;
    try {
      if (g.levelIntro) return null;
      if (g.bossIntro && g.bossIntro.locked) return null;
      if (g.bossClear) return null;
      const nc = (o) => { if (!o) return null; const v = typeof o.nextChar === "function" ? o.nextChar() : o.nextChar; return v || null; };
      if (g.inBoss && g.boss) {
        const bossChar = nc(g.boss);
        if (policy !== "never") {
          const minions = g.enemies.filter((e) => e.alive && !e.dying && e.kind === "bossMinion" && g.isTargetable(e)).sort((a, b) => a.x - b.x);
          const line = DANGER_X * g.w;
          const m = policy === "always" ? minions[0] : minions.find((e) => e.x - (e.plateW || 40) / 2 < line);
          if (m) { const c = nc(m); if (c) return c; }
        }
        if (bossChar) return bossChar;
      }
      if (g.lock && g.lock.ref && g.lock.ref.alive !== false) { const c = nc(g.lock.ref); if (c) return c; }
      const pick = (arr) => {
        const pool = (arr || []).filter((e) => e && e.alive !== false && !e.dying && g.isTargetable(e)).sort((a, b) => a.x - b.x);
        for (const e of pool) { const c = nc(e); if (c) return c; }
        return null;
      };
      return pick(g.enemies) || pick(g.powerups);
    } catch { return null; }
  }, policy);
}

// Waits until game.playClock has advanced `ms` (a wall cap of 4 x ms + 50 when the clock stalls).
export async function waitPlay(P, ms) {
  if (!(ms > 0)) return;
  const pc0 = await P.g(() => (window.game && window.game.playClock) || 0);
  const due = pc0 + ms / 1000, wallLimit = Date.now() + ms * 4 + 50;
  await sleep(Math.max(5, ms * 0.5));
  while (Date.now() < wallLimit) {
    const pc = await P.g(() => (window.game && window.game.playClock) || 0);
    if (pc >= due || pc < pc0) break;
    await sleep(Math.min(25, Math.max(5, ((due - pc) * 1000) / 2)));
  }
}

// Types like the harness (interval 60000 / (wpm x 5) ms, +-20 % jitter, a wrong key with probability 1 - accuracy) but
// waits on game.playClock. onTick(st, wallElapsedMs) runs every loop; until(st) ends it. acquireMs / acquireSlowMs /
// acquireSlowP: lead ruling Z7's target-acquisition latency on the play clock (b_lib acquireOpts), off by default.
export async function paceType(P, seconds, { wpm = 80, accuracy = 0.97, until = null, onTick = null, policy = "danger", acquireMs = 0, acquireSlowMs = null, acquireSlowP = 0.1 } = {}) {
  const interval = 60000 / (Math.max(1, wpm) * 5);
  const acq = acquireOpts({ acquireMs, acquireSlowMs, acquireSlowP });
  const t0 = Date.now();
  let keys = 0, wrong = 0, acquired = 0, lastId = null;
  while (Date.now() - t0 < seconds * 1000) {
    let loopStart = Date.now();
    const st = await state(P);
    st.playClock = await P.g(() => window.game.playClock || 0);
    if (onTick) await onTick(st, Date.now() - t0);
    if (until && until(st)) break;
    if (st.mode !== "playing") { await sleep(80); continue; }
    let k = null;
    if (st.levelIntro || st.bossIntroLocked) k = null;
    else if (acq.ms > 0) {
      let t = await typistTarget(P, policy);
      if (t && t.id !== lastId) {
        acquired++;
        await waitPlay(P, acquireDelayMs(acq));
        t = await typistTarget(P, policy);
        loopStart = Date.now();
        st.playClock = await P.g(() => window.game.playClock || 0);
      }
      lastId = t ? t.id : lastId;
      k = t ? t.k : null;
    } else k = await typistKey(P, policy);
    if (k && /^[a-z ]$/.test(k)) {
      const bad = Math.random() > accuracy;
      const key = bad ? "abcdefghijklmnopqrstuvwxyz".replace(k, "")[Math.floor(Math.random() * 25)] : k;
      await P.page.keyboard.press(key === " " ? "Space" : key);
      keys++;
      if (bad) wrong++;
      const due = st.playClock + (interval * (0.8 + Math.random() * 0.4)) / 1000;
      const wallLimit = Date.now() + interval * 4;
      await sleep(Math.max(5, interval * 0.5 - (Date.now() - loopStart)));
      while (Date.now() < wallLimit) {
        const pc = await P.g(() => (window.game && window.game.playClock) || 0);
        if (pc >= due || pc < st.playClock) break;
        await sleep(Math.min(25, Math.max(5, ((due - pc) * 1000) / 2)));
      }
    } else {
      await sleep(30);
    }
  }
  return { keys, wrong, acquired };
}

// Force the boss of the current sector and kill it at once; hp (optional) is the hull at the kill (what the clear sees).
export async function forceClear(P, { hp = null } = {}) {
  await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; });
  const ok = await waitFor(P, () => window.game.inBoss && !!window.game.boss, 15000);
  if (!ok) return false;
  await P.g((hp) => {
    const g = window.game;
    if (typeof g.endBossIntro === "function") g.endBossIntro();
    if (hp != null) { g.player.hp = hp; g.player.shield = 0; }
    g.onBossKill();
    g.finishFinale();
  }, hp);
  return waitFor(P, () => window.game.mode === "levelComplete" || window.game.mode === "victory", 10000);
}

export async function dieNow(P, source = "leak") {
  await P.g((source) => { const g = window.game; g.player.shield = 0; g.invulnT = 0; g.player.hp = 1; g.takeDamage(40, source); }, source);
  return waitFor(P, () => window.game.mode === "gameOver", 10000);
}

// b3's in-place reload: the probe's fixture init script would wipe localStorage on a real navigation, so the stored blob
// is re-read through loadSave() (migrateSave -> continueRun -> startLevel, the same path a reload takes).
export async function reloadInPlace(P, { cont = true } = {}) {
  await P.g(() => {
    const g = window.game;
    const blob = localStorage.getItem(LS_KEY);
    g.stopToMenu(false);
    localStorage.setItem(LS_KEY, blob);
    g.save = loadSave();
    g.run = null;
    g.runMeta = null;
    g.refreshMenu();
  });
  if (cont) await continueRun(P);
}

export async function waitMode(P, mode, ms = 10000) {
  return waitFor(P, (m) => window.game.mode === m, ms, mode);
}

// Canvas budget counters per frame: shadowBlur > 0 sets, composite sets, full-frame fills over alpha .12 (play.mjs's
// rule: a fillRect covering >= 90 % of #game below opaque), render() ms. window.__paceBudget.mark() / .snapshot().
export async function installBudget(P) {
  await P.context.addInitScript(() => {
    if (window.__paceBudget) return;
    const fresh = () => ({ shadowBlur: 0, composite: 0, ffMax: 0, ffAbove: 0, renderMs: 0 });
    const acc = () => ({ frames: 0, shadowBlurMax: 0, compositeMax: 0, ffMaxAlpha: 0, ffFramesAbove12: 0, maxRenderMs: 0, renderSum: 0, renderN: 0, over16: 0 });
    const B = window.__paceBudget = { cur: fresh(), win: acc(), wrapped: false };
    const parseAlpha = (s) => {
      if (typeof s !== "string") return null;
      s = s.trim().toLowerCase();
      let m = s.match(/^(?:rgba?|hsla?)\(([^)]+)\)$/);
      if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean); if (p.length >= 4) { const a = p[3]; return a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a); } return 1; }
      m = s.match(/^#([0-9a-f]{3,8})$/);
      if (m) { const h = m[1]; if (h.length === 4) return parseInt(h[3] + h[3], 16) / 255; if (h.length === 8) return parseInt(h.slice(6, 8), 16) / 255; return 1; }
      return 1;
    };
    const proto = CanvasRenderingContext2D.prototype;
    const wrap = (prop, on) => {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.set) return;
      Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get() { return d.get.call(this); }, set(v) { try { on(v); } catch (_) {} return d.set.call(this, v); } });
    };
    wrap("shadowBlur", (v) => { if (v > 0) B.cur.shadowBlur++; });
    wrap("globalCompositeOperation", () => { B.cur.composite++; });
    const fillRect = proto.fillRect;
    proto.fillRect = function (x, y, w, h) {
      try {
        const c = this.canvas;
        if (c && c.id === "game" && w > 0 && h > 0) {
          const m = this.getTransform();
          const xs = [], ys = [];
          for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { xs.push(m.a * px + m.c * py + m.e); ys.push(m.b * px + m.d * py + m.f); }
          const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(c.width, Math.max(...xs));
          const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(c.height, Math.max(...ys));
          if (Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / (c.width * c.height) >= 0.9) {
            const a0 = parseAlpha(this.fillStyle);
            const a = a0 == null ? null : Math.min(1, a0 * this.globalAlpha);
            if (a !== null && a < 0.999) { if (a > B.cur.ffMax) B.cur.ffMax = a; if (a > 0.12) B.cur.ffAbove++; }
          }
        }
      } catch (_) {}
      return fillRect.apply(this, arguments);
    };
    const wrapGame = () => {
      const g = window.game;
      if (!g || typeof g.render !== "function") return;
      const orig = g.render;
      g.render = function () { const t0 = performance.now(); try { return orig.apply(this, arguments); } finally { const ms = performance.now() - t0; if (ms > B.cur.renderMs) B.cur.renderMs = ms; } };
      B.wrapped = true;
    };
    const tick = () => {
      if (!B.wrapped) wrapGame();
      const f = B.cur; B.cur = fresh();
      const a = B.win; a.frames++;
      if (f.shadowBlur > a.shadowBlurMax) a.shadowBlurMax = f.shadowBlur;
      if (f.composite > a.compositeMax) a.compositeMax = f.composite;
      if (f.ffMax > a.ffMaxAlpha) a.ffMaxAlpha = f.ffMax;
      if (f.ffAbove > 0) a.ffFramesAbove12++;
      if (f.renderMs > 0) { a.renderN++; a.renderSum += f.renderMs; if (f.renderMs > a.maxRenderMs) a.maxRenderMs = f.renderMs; if (f.renderMs > 16) a.over16++; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    B.mark = () => { B.win = acc(); };
    B.snapshot = () => { const a = B.win; return { frames: a.frames, shadowBlurPerFrame: a.shadowBlurMax, compositeSetsPerFrame: a.compositeMax, fullFrameFillMaxAlpha: Math.round(a.ffMaxAlpha * 1000) / 1000,
      fullFrameFillFramesAbove12: a.ffFramesAbove12, maxRenderMs: Math.round(a.maxRenderMs * 100) / 100, avgRenderMs: a.renderN ? Math.round(a.renderSum / a.renderN * 100) / 100 : 0, renderFramesOver16ms: a.over16, wrapped: B.wrapped }; };
  });
}

// The one closing check every PACE probe ends with (console errors fail too, not only page errors).
export function errorsCheck(P) {
  P.check("zero page errors and console errors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0,
    { pageErrors: P.errors.pageErrors.slice(0, 5), consoleErrors: P.errors.consoleErrors.slice(0, 5) });
}
