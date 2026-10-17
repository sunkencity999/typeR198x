// Type-R 198X — attract mode (PLAN D8 / VIS-11 / PERF-10): a ghost typist plays sector 1 behind the title.
//
// While the menu is up, ghost Enemy plates drift in from the right (LEVELS[0].words, .7x speed, max 4) and a
// silent typist takes them apart through the real weapon path (fireLaserTo, sparks, impact rings, explosion
// sprites). Nothing here touches the run, the stats, the save or the audio: the ghosts live ONLY in
// game.attract.ghosts (never game.enemies), every effect is a presentation helper, and no cue is ever played.
// The selected ship cruises at (160, 360) with the D4 thruster at heat .4; a ship-radio change swaps the sprite
// with a .2 s white flash. Parallax runs at .6x (stars .5x) through parallaxWarp, which stepAmbient already
// reads; under reduce-motion .3x / .25x with no shake or flash.
//
// PERF-10: full rAF while the menu is visible; after 90 s without input (attract.idleT) or while document.hidden
// the simulation and the draw drop to 20 fps (the loop asks attractFrameSkip() before drawFrame).
//
// Hooks live in their owners: game.js loop (updateAttract / attractFrameSkip), setMode (startAttract /
// stopAttract, 10-ui.js), startNewRun / continueRun / startSector (stopAttract, 20-run.js), render() L9
// (drawAttract, 70-render.js). Methods are mixed into Game.prototype; load order is defined in index.html
// (after 80-fx.js, before 99-boot.js).

const ATTRACT = Object.freeze({
  spawnEvery: 1.6,      // s between ghost spawns
  maxGhosts: 4,
  speedMul: 0.7,        // x LEVELS[0].speed
  alpha: 0.85,          // ghost plate alpha before the cabinet (PLAN said .5; through the menu's .55-.70 scrim and
                        // frosted glass the plates land near .3 on screen, so the scrim does the dimming)
  beamWidth: 6,         // the ghost typist's beam (sector 1 fires 3 px; a 3 px line does not survive the glass)
  explosion: "medium",  // every ghost kill uses the medium sheet burst (+ debris): the one thing that reads through glass
  keyMin: 0.14,         // ghost typist cadence (s per correct key)
  keyMax: 0.26,
  acquireMin: 0.35,     // reading pause before the first key of a word / after a kill
  acquireMax: 0.7,
  fadeX: 120,           // ghosts reaching x < fadeX fade out (no damage, no leak)
  fadeS: 0.35,
  shipX: 160,
  shipY: 360,
  heat: 0.4,            // idle thruster heat while the attract runs
  swapFlashS: 0.2,      // white silhouette flash on a ship-radio change
  parallax: 0.6,        // bg / fg speed multiplier (parallaxWarp)
  stars: 0.5,
  parallaxReduced: 0.3,
  starsReduced: 0.25,
  idleS: 90,            // PERF-10: idle seconds before the 20 fps drift
  idleFps: 20,
  engageX: 0.62,        // the typist locks the nearest ghost once it has crossed this fraction of the field, so the
                        // kills land in the gap between the cabinet's two columns, not under the ship cards
  seed: 2,              // ghosts already mid-field when the attract starts (the first frame is never empty)
  seedX: Object.freeze([0.56, 0.80]),
  glassBlurPx: 4,       // the cabinet's generic 10 px frosted glass hides plates and beams; the menu panel gets
                        // this blur while the attract runs (inline fallback until style.css owns a .screen--menu rule)
  fallbackWords: Object.freeze(["type", "lock", "fire", "neon", "warp", "sync", "grid", "beam"])
});

Object.assign(Game.prototype, {
  // ------------------------- State -------------------------
  ensureAttract() {
    if (this.attract) return this.attract;
    this.attract = {
      active: false,
      pending: false,     // startAttract() was asked for; activates on the first menu frame with the art resident
      t: 0,
      idleT: 0,
      ghosts: [],
      nextSpawnAt: 0,
      nextKeyAt: 0,
      target: null,
      kills: 0,
      keys: 0,
      acc: 0,             // PERF-10 accumulator while drifting at 20 fps
      skipDraw: false,
      swapFlash: 0,
      lastLane: -1,
      saved: null         // player fields restored by stopAttract
    };
    return this.attract;
  },

  attractReduced() {
    if (typeof this.fxReduced === "function") return this.fxReduced();
    return !!this.reduceMotion;
  },

  // The menu backdrop's bitmaps are resident (bg + fg of the current theme), or the loading overlay is already
  // gone (degraded / watchdog boot draws the procedural fallback and the attract still runs over it).
  attractReady() {
    const theme = this.currentTheme;
    const art = theme ? (theme.art || theme.id) : "first";
    try {
      if (typeof Assets !== "undefined" && Assets.get("bg/" + art) && Assets.get("fg/" + art)) return true;
    } catch (e) { /* loader unavailable: fall through */ }
    return !!this.loadingDismissed;
  },

  // ------------------------- Lifecycle -------------------------
  // Idempotent. Called when the menu becomes the mode (setMode) and again by the loop until the art is ready.
  startAttract() {
    const a = this.ensureAttract();
    this.bindAttractInput();
    if (a.active) return a;
    a.pending = true;
    if (this.mode === "menu" && this.attractReady()) this.activateAttract();
    return a;
  },

  activateAttract() {
    const a = this.ensureAttract();
    const p = this.player;
    a.active = true;
    a.pending = false;
    a.t = 0;
    a.idleT = 0;
    a.acc = 0;
    a.skipDraw = false;
    a.kills = 0;
    a.keys = 0;
    a.swapFlash = 0;
    a.lastLane = -1;
    a.target = null;
    a.ghosts.length = 0;
    a.saved = { x: p.x, y: p.y, heat: p.heat || 0, warp: typeof this.parallaxWarp === "number" ? this.parallaxWarp : 1 };
    p.x = ATTRACT.shipX;
    p.y = ATTRACT.shipY;
    p.heat = Math.max(p.heat || 0, ATTRACT.heat);
    if (typeof this.setPlayerShip === "function") this.setPlayerShip(this.getSelectedShipId());
    this.applyAttractDrift();
    this.applyAttractGlass(true);
    // sector-1 plate sprites bake in idle slices (as startLevel does) so ghost plates never bake inside a frame
    if (typeof this.warmPlateCache === "function") this.warmPlateCache(0);
    // a couple of ghosts already in the field so the title never opens on an empty sky
    for (let i = 0; i < ATTRACT.seed; i++) {
      const g = this.spawnGhost(this.w * ATTRACT.seedX[i % ATTRACT.seedX.length]);
      if (g) g.age = 1; // no spawn pop for a plate that was "already there"
    }
    a.nextSpawnAt = ATTRACT.spawnEvery;
    a.nextKeyAt = rand(ATTRACT.acquireMin, ATTRACT.acquireMax);
    return a;
  },

  // Clears every list the attract fed and restores the ship's cruise fields. A no-op while inactive (so the
  // run-entry hooks that fire after the attract already stopped never touch a freshly set up run).
  stopAttract() {
    const a = this.attract;
    if (!a) return;
    a.pending = false;
    if (!a.active) return;
    a.active = false;
    a.skipDraw = false;
    a.swapFlash = 0;
    a.target = null;
    a.ghosts.length = 0;
    this.applyAttractGlass(false);
    for (const name of ["particles", "bullets", "explosions", "rings", "bolts", "debris", "muzzles", "flashDiscs", "glyphParticles", "dyingPlates"]) {
      if (Array.isArray(this[name])) this[name].length = 0;
    }
    this.hitStop = 0;
    this.timeScale = 1;
    const p = this.player;
    const s = a.saved;
    if (p && s) {
      p.x = s.x;
      p.y = s.y;
      p.heat = s.heat;
      p.recoil = 0;
      p.hitT = 0;
    }
    this.parallaxWarp = s ? s.warp : 1;
    a.saved = null;
  },

  // ------------------------- Loop hooks -------------------------
  // Called by the loop on every menu rAF (before stepAmbient, so the drift multiplier is set for this frame).
  updateAttract(dt) {
    const a = this.ensureAttract();
    if (!a.active) {
      if (a.pending && this.mode === "menu" && this.attractReady()) this.activateAttract();
      else return;
    }
    if (this.mode !== "menu") { this.stopAttract(); return; }
    const step = clamp(Number(dt) || 0, 0, 0.1);
    a.t += step;
    a.idleT += step;

    // PERF-10: 20 fps once idle for 90 s or while the tab is hidden
    const slow = a.idleT > ATTRACT.idleS || (typeof document !== "undefined" && document.hidden);
    let sim = step;
    if (slow) {
      a.acc += step;
      if (a.acc < 1 / ATTRACT.idleFps) { a.skipDraw = true; return; }
      sim = Math.min(a.acc, 0.1);
      a.acc = 0;
    } else {
      a.acc = 0;
    }
    a.skipDraw = false;
    this.stepAttractWorld(sim);
  },

  // true -> the loop skips drawFrame this rAF (frameCount then counts ~20/s).
  attractFrameSkip() {
    const a = this.attract;
    return !!(a && a.active && a.skipDraw && this.mode === "menu");
  },

  // parallaxWarp drives bg / fg in stepAmbient and the stars twice (dt * warp, then starSpeedMul = warp), so the
  // stars end up at warp^2; updateStars gets a small top-up each frame to land on the target star speed.
  applyAttractDrift() {
    const rm = this.attractReduced();
    this.parallaxWarp = rm ? ATTRACT.parallaxReduced : ATTRACT.parallax;
  },

  attractStarTopUp(dt) {
    const warp = this.parallaxWarp;
    if (!(warp > 0) || typeof this.updateStars !== "function") return;
    const target = this.attractReduced() ? ATTRACT.starsReduced : ATTRACT.stars;
    const extra = Math.max(0, target - warp * warp) / warp;
    if (extra > 0) this.updateStars(dt * extra);
  },

  stepAttractWorld(dt) {
    const a = this.attract;
    const p = this.player;
    const wdt = dt * (this.timeScale || 1);   // hit-stop from onKillFx freezes the ghosts with the world

    // the cruise: hold the pose, keep the thruster warm (tickEffects cools heat every frame)
    p.x = ATTRACT.shipX;
    p.y = ATTRACT.shipY;
    if ((p.heat || 0) < ATTRACT.heat) p.heat = ATTRACT.heat;
    this.applyAttractDrift();
    this.attractStarTopUp(dt);

    // ghosts drift left; past fadeX they dissolve (no leak, no damage)
    for (const g of a.ghosts) {
      g.update(wdt);
      if (!g.dying && g.x < ATTRACT.fadeX) { g.dying = true; g.locked = false; g.attractFade = 0; }
      if (g.dying) {
        g.attractFade = (g.attractFade || 0) + wdt / ATTRACT.fadeS;
        if (g.attractFade >= 1) g.alive = false;
      }
    }
    compactInPlace(a.ghosts, (g) => g.alive);
    if (a.target && (!a.target.alive || a.target.dying)) a.target = null;

    if (a.t >= a.nextSpawnAt) {
      a.nextSpawnAt = a.t + ATTRACT.spawnEvery;
      if (this.attractLiveGhosts() < ATTRACT.maxGhosts) this.spawnGhost();
    }
    if (a.t >= a.nextKeyAt) this.attractTypistKey();

    // the effect lists update() advances while playing: bullets, particles, explosion frames, dying plates
    compactInPlace(this.bullets, (b) => (b.update(wdt), b.alive()));
    compactInPlace(this.particles, (pt) => (pt.update(wdt), pt.alive()));
    compactInPlace(this.explosions, (ex) => (ex.update(wdt), !ex.done));
    if (Array.isArray(this.dyingPlates) && this.dyingPlates.length) {
      compactInPlace(this.dyingPlates, (d) => { d.t += wdt; return d.t < d.life; });
    }
    if (typeof this.emitExhaust === "function") this.emitExhaust(dt);   // D4 plume particles (none under reduce-motion)
    if (a.swapFlash > 0) a.swapFlash = Math.max(0, a.swapFlash - dt);
  },

  attractLiveGhosts() {
    let n = 0;
    for (const g of this.attract.ghosts) if (g.alive && !g.dying) n++;
    return n;
  },

  // ------------------------- Ghosts -------------------------
  attractLaneYs() {
    if (typeof this.laneYs === "function") {
      try { const ys = this.laneYs(); if (Array.isArray(ys) && ys.length) return ys; } catch (e) { /* fall through */ }
    }
    return (typeof LANE_YS !== "undefined" && Array.isArray(LANE_YS)) ? LANE_YS : [184, 252, 320, 388, 456, 524];
  },

  // Same rules as pickSpawnLane (40-combat.js) over the ghost list: never the last lane, never a lane whose
  // newest plate is still near the right edge; when every lane is busy, the one furthest along.
  attractPickLane() {
    const a = this.attract;
    const ys = this.attractLaneYs();
    const n = ys.length;
    const newest = new Array(n).fill(null);
    for (const g of a.ghosts) {
      if (!g.alive || g.dying) continue;
      let l = g.lane;
      if (!(l >= 0 && l < n)) {
        let best = 0, bd = Infinity;
        for (let i = 0; i < n; i++) { const d = Math.abs(ys[i] - g.y); if (d < bd) { bd = d; best = i; } }
        l = best;
      }
      if (newest[l] === null || g.x > newest[l]) newest[l] = g.x;
    }
    const candidates = [];
    for (let l = 0; l < n; l++) {
      if (l === a.lastLane) continue;
      if (newest[l] !== null && newest[l] > this.w - 280) continue;
      candidates.push(l);
    }
    if (candidates.length) return choice(candidates);
    let best = 0, bx = Infinity;
    for (let l = 0; l < n; l++) {
      const v = newest[l] === null ? -Infinity : newest[l];
      if (v < bx) { bx = v; best = l; }
    }
    return best;
  },

  // A sector-1 word (amendment C-15: LEVELS[0].words) that repeats neither a live ghost nor a live first letter.
  attractWord() {
    const cfg = (typeof LEVELS !== "undefined" && LEVELS[0]) || null;
    const pool = cfg && Array.isArray(cfg.words) && cfg.words.length ? cfg.words : ATTRACT.fallbackWords;
    const live = new Set();
    const firsts = new Set();
    for (const g of this.attract.ghosts) {
      if (!g.alive) continue;
      live.add(g.text);
      const c = g.nextChar();
      if (c) firsts.add(c);
    }
    let word = choice(pool);
    for (let i = 0; i < 16; i++) {
      const w = choice(pool);
      if (live.has(w) || firsts.has(w[0])) continue;
      word = w;
      break;
    }
    return String(word || "type").toLowerCase();
  },

  // x: optional spawn x (seeded ghosts); otherwise just off the right edge like spawnEnemy.
  spawnGhost(x) {
    const a = this.ensureAttract();
    if (typeof Enemy !== "function") return null;
    const cfg = (typeof LEVELS !== "undefined" && LEVELS[0]) || null;
    const base = cfg ? (cfg.speed || cfg.baseSpeed || 72) : 72;
    const lane = this.attractPickLane();
    const ys = this.attractLaneYs();
    const y = ys[clamp(lane, 0, ys.length - 1)];
    const g = new Enemy({ text: this.attractWord(), x: this.w, y, speed: base * ATTRACT.speedMul * rand(0.94, 1.06), lane });
    g.x = Number.isFinite(x) ? x : this.w + g.plateW / 2 + rand(10, 90);
    g.ghost = true;
    g.attractFade = 0;
    a.ghosts.push(g);
    a.lastLane = lane;
    return g;
  },

  // The ghost typist: locks the nearest ghost that is on screen, reads it for .35-.7 s, then types one correct
  // key every .14-.26 s through the silent weapon path (fireLaserTo pushes the beam and the muzzle flash; the zap
  // cue lives in onCorrectKey, which is never called). The last key hands the ghost to attractKill().
  attractTypistKey() {
    const a = this.attract;
    let g = a.target;
    if (!g || !g.alive || g.dying) {
      g = null;
      for (const c of a.ghosts) {
        if (!c.alive || c.dying) continue;
        if (!g || c.x < g.x) g = c;
      }
      // let the plates drift into the field first; the nearest one is typed once it crosses the engage line
      if (g && g.x > this.w * ATTRACT.engageX) g = null;
      if (!g) { a.nextKeyAt = a.t + 0.1; return; }
      a.target = g;
      g.locked = true;
      a.nextKeyAt = a.t + rand(ATTRACT.acquireMin, ATTRACT.acquireMax);
      return;
    }
    this.attractBeam(g.x, g.y);
    g.progress++;
    g.flash = 0.18;
    if (typeof this.onKeyFx === "function") this.onKeyFx(g, g.text[g.progress - 1]);   // recoil, heat, flinch, glyph pop
    a.keys++;
    if (g.progress >= g.text.length) {
      this.attractKill(g);
      a.target = null;
      a.nextKeyAt = a.t + rand(ATTRACT.acquireMin, ATTRACT.acquireMax);
    } else {
      this.addSparks(g.x, g.y, 6);
      a.nextKeyAt = a.t + rand(ATTRACT.keyMin, ATTRACT.keyMax);
    }
  },

  // The staged beam through fireLaserTo (silent: it pushes the bullet and the muzzle flash; the zap cue lives in
  // onCorrectKey), widened so it reads through the cabinet glass.
  attractBeam(tx, ty) {
    const before = this.bullets.length;
    this.fireLaserTo(tx, ty, "cyan");
    for (let i = before; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (b && b.impact !== false) b.width = Math.max(b.width || 0, ATTRACT.beamWidth);
    }
  },

  // Pure FX only: white impact plate, impact ring + recoil + hit-stop (onKillFx), particles, sheet explosion,
  // sparks. No score, no stats, no save, no cue, no shake.
  attractKill(g) {
    if (!g || !g.alive) return;
    const a = this.ensureAttract();
    g.alive = false;
    g.locked = false;
    const len = g.text.length;
    if (typeof this.notePlateDeath === "function") this.notePlateDeath(g, "kill");
    if (typeof this.onKillFx === "function") this.onKillFx(g, g.x, g.y);
    else if (typeof this.addShockwave === "function") this.addShockwave(g.x, g.y, len <= 1 ? 12 : 20, "cyan");
    this.addExplosion(g.x, g.y, 14 + len * 2);
    this.addExplosionSprite(g.x, g.y, ATTRACT.explosion);
    this.addSparks(g.x, g.y, 6);
    a.kills++;
    if (a.target === g) a.target = null;
  },

  // ------------------------- Draw (L9) -------------------------
  // Ghost plates through drawEnemy at alpha .5 (fading ghosts multiply their fade), far to near, the locked one
  // last like drawEnemies. Ghosts are never the L16 active target, so lastPlateDrawn is put back.
  drawAttract(ctx) {
    const a = this.attract;
    if (!a || !a.active || this.mode !== "menu") return;
    const ghosts = a.ghosts;
    if (!ghosts.length || typeof this.drawEnemy !== "function") return;
    const sorted = ghosts.length > 1 ? ghosts.slice().sort((p, q) => q.x - p.x) : ghosts;
    const prevAlpha = ctx.globalAlpha;
    const lastPlate = this.lastPlateDrawn;
    let locked = null;
    for (const g of sorted) {
      if (!g.alive) continue;
      if (g.locked && !locked) { locked = g; continue; }
      this.drawGhost(ctx, g, prevAlpha);
    }
    if (locked) this.drawGhost(ctx, locked, prevAlpha);
    ctx.globalAlpha = prevAlpha;
    this.lastPlateDrawn = lastPlate;
  },

  drawGhost(ctx, g, baseAlpha) {
    const fade = g.dying ? clamp(1 - (g.attractFade || 0), 0, 1) : 1;
    ctx.globalAlpha = baseAlpha * ATTRACT.alpha * fade;
    this.drawEnemy(ctx, g);
  },

  // ------------------------- Glass -------------------------
  // The menu is a .neon-panel with the shared blur(10px) frosted glass, which erases 40 px plates and 3 px beams.
  // While the attract runs the panel gets blur(glassBlurPx) inline; the scrim (.55 -> .70) is untouched. The
  // fallback steps aside as soon as the computed glass is no longer the generic 10 px (a .screen--menu rule).
  applyAttractGlass(on) {
    const px = ATTRACT.glassBlurPx;
    const el = (this.ui && this.ui.menu) || (typeof document !== "undefined" ? document.getElementById("screenMenu") : null);
    if (!el || !(px > 0)) return;
    if (on) {
      if (this._attractGlass) return;
      let current = "";
      try {
        const cs = getComputedStyle(el);
        current = cs.backdropFilter || cs.webkitBackdropFilter || "";
      } catch (e) { current = ""; }
      if (!/blur\(10px\)/.test(current)) return;
      this._attractGlass = { bf: el.style.backdropFilter || "", wbf: el.style.webkitBackdropFilter || "" };
      el.style.backdropFilter = `blur(${px}px)`;
      el.style.webkitBackdropFilter = `blur(${px}px)`;
    } else if (this._attractGlass) {
      el.style.backdropFilter = this._attractGlass.bf;
      el.style.webkitBackdropFilter = this._attractGlass.wbf;
      this._attractGlass = null;
    }
  },

  // ------------------------- Input -------------------------
  // Any input wakes the attract from the 20 fps drift; a ship-radio change swaps the cruising sprite with the
  // D4 hit overlay as a .2 s white flash (no flash under reduce-motion). Bound once.
  bindAttractInput() {
    if (this._attractInputBound) return;
    this._attractInputBound = true;
    const wake = () => { const a = this.attract; if (a) a.idleT = 0; };
    try {
      for (const ev of ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"]) {
        window.addEventListener(ev, wake, { passive: true });
      }
    } catch (e) { /* no window */ }
    const inputs = Array.isArray(this.shipInputs) ? this.shipInputs : [];
    for (const input of inputs) {
      input.addEventListener("change", () => this.onAttractShipChange(input));
    }
  },

  onAttractShipChange(input) {
    const a = this.attract;
    if (!a || !a.active || !input || !input.checked) return;
    if (typeof this.setPlayerShip === "function") this.setPlayerShip(input.value);
    else this.player.shipId = input.value;
    if (this.attractReduced()) return;
    a.swapFlash = ATTRACT.swapFlashS;
    const p = this.player;
    p.hitT = Math.max(p.hitT || 0, ATTRACT.swapFlashS);   // drawShipAdditive: white silhouette, fades over the channel
  }
});
