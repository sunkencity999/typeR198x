// Type-R 198X — boss fight v2 (SYS-06/SYS-07): phases, targetable minions, the Counter-Signal (ARCADE D10), the 2.4 s
// intro, the 5 s skippable finale and the clear tally. Boss drawing lives in 70-render.js; drawBossHazardMeter(ctx, rect)
// here is the hook the renderer calls at layer L10 when present. Methods are mixed into Game.prototype; load order is
// defined in index.html. Counter-Signal hooks: listens to modeChange (surge riser), checkpoint / checkpointRestored
// (lvSurgesFired) and results (COUNTER-SIGNALS card note); emits counterSignal, bossSegmentReset and bossKill.
// Dissolve length (70-render.js owns BOSS_DISSOLVE_S; 1.2 s per CONTRACT section 11).
const BOSS_DISSOLVE_S_FOR = () => (typeof BOSS_DISSOLVE_S === "number" ? BOSS_DISSOLVE_S : 1.2);
const CS_GLYPHS = "abcdefghijklmnopqrstuvwxyz";
const CS_SLAB_TEXT = { done: "", rem: "", remColor: null };     // reused: counterSignalSlabText()'s return value
const CS_EVT = { result: "", level: 0, phase: 0, segmentIndex: 0, chars: 0, dur: 0, t: 0, slow: false };   // reused hook payload

Object.assign(Game.prototype, {
  // Untrimmed art size for Boss.artRect (pre-D6). The loader's manifest first, else the constructor's <img>.
  bossArtSize(level) {
    try {
      if (typeof Assets !== "undefined" && Assets && typeof Assets.meta === "function") {
        const m = Assets.meta("bosses/" + level);
        if (m && m.orig && m.orig.w > 0) return { w: m.orig.w, h: m.orig.h };
      }
    } catch (_) { /* loader not initialised yet */ }
    const img = this.bossArtImages && this.bossArtImages[level];
    if (img && img.complete && img.naturalWidth > 0) return { w: img.naturalWidth, h: img.naturalHeight };
    return null;
  },

  // beginBossFight({ restored }) — restored is run.boss ({ segments, segmentIndex, progress, phase, phaseStarts })
  // when a saved fight resumes or Retry boss rebuilds it; otherwise a fresh plan is rolled (buildBossPlan).
  // The field is already drained by the approach; anything still alive auto-detonates (direct calls).
  beginBossFight(opts = {}) {
    const cfg = LEVELS[this.levelIndex];
    const restored = (opts && opts.restored) || null;
    this.levelIntro = null;
    if (this.countAliveEnemies()) this.detonateLeftovers();
    this.releaseLock("dead");
    this.inBoss = true;
    this.bossClear = null;
    this.setWavePhase("boss");

    const plan = buildBossPlan(cfg.level);
    const segments = (restored && Array.isArray(restored.segments) && restored.segments.length) ? restored.segments : plan.segments;
    const phaseStarts = (restored && Array.isArray(restored.phaseStarts) && restored.phaseStarts.length) ? restored.phaseStarts : plan.phaseStarts;
    const boss = new Boss({ name: cfg.bossName, segments, artLevel: cfg.level, phaseStarts, artSize: this.bossArtSize(cfg.level) });
    if (restored) {
      boss.segmentIndex = clamp(restored.segmentIndex | 0, 0, segments.length - 1);
      boss.progress = 0;
      boss.phase = boss.phaseFor(boss.segmentIndex);
    }
    this.boss = boss;
    // Counter-Signal state (D10): a restored fight (Continue / Retry boss) starts fresh too (first surge at min(6, every)).
    boss.surgePending = false; boss.surgeCount = 0; boss.firedInPhase = 0; boss.scrambleT = 0; boss.scrambleSeed = 0;
    boss._scrStep = -1; boss._scrSrc = null; boss._scrText = "";
    this.csBar("reset");
    this._csBarAcc = 0;
    this.minionAcc = 0;
    this.lastMinionLane = -1;

    const run = this.run;
    if (run) {
      run.inBoss = true;
      run.wavePhase = "boss";
      run.boss = {
        segments: [...boss.segments],
        segmentIndex: boss.segmentIndex,
        progress: 0,
        phase: boss.phase,
        phaseStarts: [...boss.phaseStarts]
      };
      // Boss checkpoint: fresh for a new fight; a resumed fight keeps the one taken at its phase start.
      if (!restored || !run.bossCheckpoint) run.bossCheckpoint = this.makeCheckpoint("boss");
    }

    this.startBossIntro(cfg.bossName);
    this.showBossBar(true);
    this.refreshBossUI({ full: true });
    this.sfx.bossSiren(3);
    this.sfx.setMusicState("boss");
    if (typeof this.announce === "function") this.announce(`Boss: ${boss.name}. Type the highlighted word; minions are typable too.`);
    this.saveRun(true);
    return boss;
  },

  endBossFight() {
    this.inBoss = false;
    this.showBossBar(false);
    this.killMinionsAll();
    if (this.boss) this.boss.surge = null;
    this.lock = null;
    this.lockMisses = 0;
    this.boss = null;
    this.bossIntro = null;
    this.setClass(this.hudEls().bossMeter, "isCharging", false);
    this.csBar("off");
    this._csGlow = null;
    if (this.sfx && typeof this.sfx.surgeStop === "function") this.sfx.surgeStop();
    if (typeof this.sfx.bossPulse === "function") this.sfx.bossPulse(false);
  },

  // ------------------------- Intro -------------------------
  // bossIntro = { t, dur, locked, name, skippable }. Keys are ignored while locked; returning players (a sector
  // best exists or this is a retry) may skip from BOSS_INTRO_SKIP_S.
  startBossIntro(name) {
    const cfg = LEVELS[this.levelIndex];
    const bests = this.save.sectorBests || {};
    const returning = !!bests[String(cfg.level)] || (this.levelStats.retries | 0) > 0;
    this.bossIntro = { t: 0, dur: BOSS_INTRO_S, locked: true, name, skippable: returning };
    // Violet edge pulse (the camera draws and decays it); never the red damage tint. The art slides in from the
    // right while trauma ramps to .5 x motion().shake (tickBoss); the white flash belongs to the hand-off.
    this.introPulse = 1;
    this.showBanner({ kind: "bossIntro", eyebrow: "WARNING", title: name, sub: "INCOMING BOSS" });
  },

  endBossIntro() {
    const intro = this.bossIntro;
    if (!intro || !intro.locked) return;
    intro.locked = false;
    intro.t = Math.max(intro.t, intro.dur);
    this.whiteFlash = 0.5;
    this.sfx.lock("boss");
    if (this.boss) this.boss.surgeTimer = 0;
  },

  skipBossIntro() {
    const intro = this.bossIntro;
    if (!intro || !intro.locked || !intro.skippable || intro.t < BOSS_INTRO_SKIP_S) return false;
    this.endBossIntro();
    if (this.banner && this.banner.kind === "bossIntro") this.banner = null;
    return true;
  },

  // ------------------------- Per-frame -------------------------
  tickBoss(dt) {
    const boss = this.boss;
    if (!boss) return;
    const cfg = LEVELS[this.levelIndex];
    if (!boss.artSize) boss.artSize = this.bossArtSize(cfg.level);

    const intro = this.bossIntro;
    if (intro) {
      intro.t += dt;
      if (intro.locked && !this.reduceMotion) {
        // trauma ramps to .5 x motion().shake over the .9 s slide, then decays with the rest of the camera
        const shake = (typeof this.motionProfile === "function") ? (this.motionProfile().shake || 0) : 1;
        const ramp = clamp(intro.t / 0.9, 0, 1) * (intro.t < 0.9 ? 1 : Math.max(0, 1 - (intro.t - 0.9) / 0.5));
        this.trauma = Math.max(this.trauma || 0, 0.5 * shake * ramp);
      }
      if (intro.locked && intro.t >= intro.dur) this.endBossIntro();
      if (!intro.locked && intro.t >= intro.dur + 0.4) this.bossIntro = null;
      if (intro.locked) return;
    }
    if (this.bossClear) return;

    if (cfg.minionRate > 0) {
      this.minionAcc += dt * cfg.minionRate;
      if (this.countMinions() >= cfg.minionMax) this.minionAcc = Math.min(this.minionAcc, 1);
      while (this.minionAcc >= 1 && this.countMinions() < cfg.minionMax) {
        this.minionAcc -= 1;
        this.spawnBossMinion();
      }
    }

    // Counter-Signal (D10). World dt: hit-stop slows the window as it slows the plates; pause freezes it (no update).
    if (boss.scrambleT > 0) boss.scrambleT = Math.max(0, boss.scrambleT - dt);
    if (boss.surge) {
      boss.surge.t += dt;
      this.csTickBar(dt);
      if (boss.surge.t >= boss.surge.dur) this.fireSurge();
    } else if (this.counterSignalArmed(cfg)) {
      boss.surgeTimer += dt;
      if (!boss.surgePending && boss.surgeTimer >= this.counterSignalDue(cfg)) boss.surgePending = true;
      if (boss.surgePending && (boss.progress | 0) === 0) this.startSurge();   // at a segment start, with the whole segment
    }
  },

  // ------------------------- Typing against the boss -------------------------
  // Order: a held powerup lock (deliberate pickup) -> boss character -> minion letter -> powerup first letter -> hard miss.
  handleBossTyped(ch) {
    const boss = this.boss;
    const lock = this.lock;
    if (lock && lock.kind === "powerup" && lock.ref && lock.ref.alive && !lock.ref.dying) {
      if (ch === lock.ref.nextChar()) {
        this.lockMisses = 0;
        this.onCorrectKey(lock.ref);
      } else {
        this.lockMisses = (this.lockMisses | 0) + 1;
        this.onHardMiss(lock.ref, ch);
        if (this.lockMisses >= 3) this.releaseLock("lost");
      }
      return;
    }
    if (lock) this.releaseLock("dead");

    if (ch === boss.nextChar) { this.onBossChar(); return; }

    let minion = null;
    for (const en of this.enemies) {
      if (en.kind !== "bossMinion" || !this.isTargetable(en) || en.nextChar() !== ch) continue;
      if (!minion || en.x < minion.x) minion = en;
    }
    if (minion) {
      this.noteCorrectKey();
      this.countCorrect();
      minion.progress++;
      this.emitKeyCorrect("minion", minion, ch, minion.progress - 1, minion.text.length, -1);
      minion.flash = 0.18;
      this.fireLaserTo(minion.x, minion.y, "cyan");
      this.sfx.zap(1);
      if (minion.progress >= minion.text.length) this.killEnemy(minion);
      return;
    }

    let pu = null;
    for (const p of this.powerups) {
      if (!this.isTargetable(p) || p.nextChar() !== ch) continue;
      if (!pu || p.x < pu.x) pu = p;
    }
    if (pu) {
      this.acquireLock(pu, "powerup");
      this.onCorrectKey(pu);
      return;
    }
    this.onHardMiss(null, ch);
  },

  // Where the lasers go: the art's content centre (artRect until D6 supplies contentRect).
  bossAimPoint() {
    const boss = this.boss;
    if (!boss) return { x: this.w * 0.75, y: this.h * 0.4 };
    const r = boss.contentRect || (boss.artSize ? boss.artRect : null);
    if (r) return { x: r.x + r.w * 0.45, y: r.y + r.h * 0.5 };
    return { x: boss.x - 140, y: boss.y + 10 };
  },

  onBossChar() {
    const boss = this.boss;
    const cfg = LEVELS[this.levelIndex];
    const segLen = boss.segment.length;
    this.noteCorrectKey();
    this.countCorrect();
    const aim = this.bossAimPoint();
    this.fireLaserTo(aim.x, aim.y, "cyan");
    if (typeof this.onKeyFx === "function") this.onKeyFx(boss, boss.nextChar);   // recoil + heat on boss typing
    this.sfx.zap(clamp((boss.progress + 1) / segLen, 0, 1));
    this.addSparks(aim.x, aim.y + rand(-40, 40), 10);
    const mult = this.scoringMult();
    const slab = boss.slabRect;
    this.emitKeyCorrect("boss", boss, boss.nextChar, boss.progress | 0, segLen, boss.segmentIndex);
    const r = boss.advance();
    this.addScore(SCORE.bossChar * mult, { kind: "bossChar" });
    if (r.segmentDone) {
      this.addScore(SCORE.segment(segLen) * mult, { kind: "segment", x: slab.x + slab.w / 2, y: slab.y - 14 });
      this.sfx.segmentDown();
      boss.flash = Math.max(boss.flash, 0.5);
      if (typeof this.addShockwave === "function") this.addShockwave(aim.x, aim.y, 120, "magenta");
      this.pulseBossSegmentClear();
      this.hitStop = Math.max(this.hitStop || 0, 0.09);
      if (boss.surge) this.cancelSurge(true);
      if (this.run && this.run.boss) { this.run.boss.segmentIndex = boss.segmentIndex; this.run.boss.progress = 0; }
    }
    if (r.phaseDone) this.onBossPhaseClear();
    // A pending surge starts on the keystroke that opens the next segment, never a frame later (D10).
    if (r.segmentDone && !boss.done && boss.surgePending && !boss.surge && this.counterSignalArmed(cfg)) this.startSurge();
    if (typeof this.sfx.bossPulse === "function" && !boss.done) this.sfx.bossPulse(true, 1 - boss.hpFrac());
    this.refreshBossUI();
    if (boss.done) this.onBossKill();
  },

  // ------------------------- Minions -------------------------
  countMinions() {
    let n = 0;
    for (const en of this.enemies) if (en.alive && !en.dying && en.kind === "bossMinion") n++;
    return n;
  },

  // Single letters (unique among live first letters, never the boss's next character), lanes 0-4, spawned at
  // artRect.x + cfg.minionSpawnDx and 1.1x the sector speed.
  spawnBossMinion() {
    const cfg = LEVELS[this.levelIndex];
    const boss = this.boss;
    if (!boss) return null;
    const letters = letterSetForWave(cfg, 2);
    const taken = this.liveFirstChars();
    const pool = [...letters].filter((c) => !taken.has(c) && c !== boss.nextChar);
    const text = pool.length ? this.randPick(pool) : this.randPick(letters);
    const ys = this.laneYs();
    const lanes = MINION_LANES.filter((l) => l < ys.length);
    const x = boss.artRect.x + (Number.isFinite(cfg.minionSpawnDx) ? cfg.minionSpawnDx : MINION_SPAWN_DX);
    const busy = new Set();
    for (const en of this.enemies) if (en.alive && !en.dying && en.kind === "bossMinion" && en.x > x - 140) busy.add(en.lane);
    let cands = lanes.filter((l) => !busy.has(l) && l !== this.lastMinionLane);
    if (!cands.length) cands = lanes.filter((l) => !busy.has(l));
    if (!cands.length) cands = lanes;
    const lane = this.randPick(cands);
    const en = new Enemy({ text, x, y: ys[lane], speed: cfg.speed * MINION_SPEED_MUL, kind: "bossMinion", lane });
    this.enemies.push(en);
    this.lastMinionLane = lane;
    this._noteSpawn(text.length);
    return en;
  },

  killMinionsAll() {
    let n = 0;
    for (const en of this.enemies) {
      if (!en.alive || en.kind !== "bossMinion") continue;
      this.detonateEnemy(en);
      n++;
    }
    return n;
  },

  // ------------------------- Counter-Signal (ARCADE D10) -------------------------
  // From sector 2 a boss arms a surge min(COUNTER_SIGNAL.firstAtS, surgeEvery) s after the intro unlock, then every
  // surgeEvery s; it starts at a segment start and covers the whole segment: window surgeDuration(chars, L, slow).
  // Finishing the word counters it (bonus, the bolt reflects into the boss); otherwise it fires from the boss's aim
  // point (DAMAGE.surge, the word starts over with a scramble). At most maxFiredPerPhase fired surges per phase.
  // Telegraph: red glow on the art (drawCounterSignalGlow), the slab outline pulse (70-render.js drawBossSlab), the DOM
  // charge bar under the hull meter (#bossCharge, csBar) and the surgeCharge riser.
  counterSignalArmed(cfg) {                       // may a surge arm / start now?
    const b = this.boss;
    return !!(b && !b.done && b.segment && cfg && cfg.surgeEvery && cfg.level >= COUNTER_SIGNAL.fromLevel
      && (b.firedInPhase | 0) < COUNTER_SIGNAL.maxFiredPerPhase && !this.bossClear);
  },

  counterSignalDue(cfg) {
    return (this.boss.surgeCount | 0) === 0 ? Math.min(COUNTER_SIGNAL.firstAtS, cfg.surgeEvery) : cfg.surgeEvery;
  },

  // Widen 20 % below 35 WPM; an unknown speed counts as slow.
  counterSignalSlow() {
    const w = typeof this.pilotWpm === "function" ? this.pilotWpm("window") : null;
    return !(w > 0) || w < COUNTER_SIGNAL.slowWpm;
  },

  startSurge() {
    const boss = this.boss;
    if (!boss || boss.surge || boss.done || !boss.segment) return null;
    const cfg = LEVELS[this.levelIndex], L = cfg.level;
    const chars = boss.segment.length - (boss.progress | 0);          // === segment length at a segment start
    const slow = this.counterSignalSlow();
    const dur = surgeDuration(chars, L, slow);
    boss.surge = { t: 0, dur, armed: true, chars, seg: boss.segmentIndex, slow };   // one object per surge (rare)
    boss.surgeTimer = 0; boss.surgePending = false; boss.surgeCount = (boss.surgeCount | 0) + 1;
    this._csBarAcc = 0;
    this.sfx.surgeCharge(dur);                                         // the existing riser (CONTRACT R43)
    this.csBar("charge");
    this.refreshBossUI();                                              // #bossMeter.isCharging
    this.counterSignalTip();                                           // first surge on this save only
    if (typeof this.announce === "function") this.announce("Surge incoming. Finish the word.");
    this.csEmit("start", boss.surge);
    return boss.surge;
  },

  // First surge on this save: one tip toast (persisted by the next autosave; a lost flag only repeats it once).
  counterSignalTip() {
    const save = this.save;
    if (!save) return false;
    const ts = save.tutorialSeen;
    if (ts && ts.surge) return false;
    if (typeof this.showToast === "function") this.showToast("SURGE INCOMING — FINISH THE RED-FRAMED WORD BEFORE THE BAR FILLS", { kind: "tip", key: "tut", ms: 3500 });
    if (ts && typeof ts === "object") ts.surge = true; else save.tutorialSeen = { surge: true };
    return true;
  },

  cancelSurge(countered = true) {
    const boss = this.boss;
    if (!boss || !boss.surge) return false;
    const s = boss.surge;
    boss.surge = null;
    boss.surgeTimer = 0;
    if (countered) {
      const L = LEVELS[this.levelIndex].level;
      this.levelStats.surgesCancelled = (this.levelStats.surgesCancelled | 0) + 1;
      this.stats.csCountered = (this.stats.csCountered | 0) + 1;
      this.sfx.surgeCancel();
      const slab = boss.slabRect;
      this.addScore(SCORE.surgeCountered(L), { kind: "bonus", x: slab.x + slab.w / 2, y: slab.y + slab.h + 24 });
      this.showBanner({ kind: "callout", title: "COUNTERED", color: "cyan" });
      const aim = this.bossAimPoint();
      if (typeof this.addBolt === "function") this.addBolt(this.player.x + 20, this.player.y, aim.x, aim.y, "cyan", 0.2);   // the bolt reflects
      if (typeof this.addShockwave === "function") this.addShockwave(aim.x, aim.y, 90, "cyan");
      boss.flash = Math.max(boss.flash || 0, 0.6);
      this.csBar("countered");
      if (typeof this.announce === "function") this.announce("Countered.");
      this.csEmit("countered", s);
    } else {
      this.csBar("off");
      if (this.sfx && typeof this.sfx.surgeStop === "function") this.sfx.surgeStop();
    }
    this.refreshBossUI();
    return true;
  },

  fireSurge() {
    const boss = this.boss;
    if (!boss || !boss.surge) return 0;
    const s = boss.surge, L = LEVELS[this.levelIndex].level;
    boss.surge = null; boss.surgeTimer = 0; boss.surgePending = false; boss.surgeFlash = 1;
    boss.firedInPhase = (boss.firedInPhase | 0) + 1;
    this.levelStats.surgesFired = (this.levelStats.surgesFired | 0) + 1;
    this.stats.csFired = (this.stats.csFired | 0) + 1;
    const aim = this.bossAimPoint();                                   // the bolt leaves the boss, not the slab cell
    if (typeof this.addBolt === "function") this.addBolt(aim.x, aim.y, this.player.x + 20, this.player.y, "danger", 0.2);
    else this.bullets.push(new Bullet({ x: aim.x, y: aim.y, tx: this.player.x + 20, ty: this.player.y, life: 0.2, width: 4, color: "danger" }));
    // the segment starts over, with a visible scramble (typing stays live: glyph 0 is never scrambled)
    if (!boss.done) { boss.progress = 0; if (this.run && this.run.boss) this.run.boss.progress = 0; }
    boss.scrambleT = COUNTER_SIGNAL.scrambleS; boss.scrambleSeed = (Math.random() * 1e6) | 0; boss._scrStep = -1;
    if (typeof this.hook === "function") this.hook("bossSegmentReset", { boss, segmentIndex: boss.segmentIndex, reason: "surge" });
    this.csBar("fired");
    this.csEmit("fired", s);                                           // 82-overdrive.js vents on this
    this.sfx.surgeFire();
    if (typeof this.announce === "function") this.announce("Surge hit. The word starts over.");
    this.refreshBossUI();                                              // the boss meter refills by the reset letters
    return this.takeDamage(DAMAGE.surge(L), "surge");                  // last: may end the run (onGameOver)
  },

  // counterSignal payload (reused CS_EVT); a probe-injected { t, dur, armed } surge works (every field has a fallback).
  csEmit(result, s) {
    const boss = this.boss;
    const e = CS_EVT;
    e.result = result;
    e.level = LEVELS[this.levelIndex].level;
    e.phase = boss ? boss.phase | 0 : 0;
    e.segmentIndex = boss ? boss.segmentIndex | 0 : 0;
    e.chars = s && Number.isFinite(s.chars) ? s.chars : (boss ? boss.remainingChars : 0);
    e.dur = s && Number.isFinite(s.dur) ? s.dur : 0;
    e.t = s && Number.isFinite(s.t) ? s.t : 0;
    e.slow = !!(s && s.slow);
    if (typeof this.hook === "function") this.hook("counterSignal", e);
    return e;
  },

  // Charge bar under the hull meter (#bossCharge, DOM): transform / opacity only. The fill is written at 5 Hz, each
  // write aimed 200 ms ahead and eased by a 200 ms linear transition (.isLive); a new surge snaps it to 0 first and
  // turns the transition on with its first tick, so the bar never runs backwards.
  csEls() {
    if (!this._csEls) {
      const bar = document.getElementById("bossCharge");
      this._csEls = { bar, fill: bar ? bar.firstElementChild : null };
    }
    return this._csEls;
  },

  csBar(state) {                         // "reset" | "charge" | "countered" | "fired" | "off"
    const { bar, fill } = this.csEls();
    if (!bar || !fill) return;
    if (state === "reset" || state === "charge") {
      this.setClass(bar, "isLive", false);
      this.setClass(bar, "isCharging", state === "charge");
      this.setTransformScaleX(fill, 0);
      return;
    }
    this.setClass(bar, "isLive", false);
    this.setClass(bar, "isCharging", false);
    if (state === "countered" || state === "fired") this.pulseClass(bar, state === "fired" ? "isFired" : "isCountered", 240);
  },

  csTickBar(dt) {
    this._csBarAcc = (this._csBarAcc || 0) + dt;
    if (this._csBarAcc < COUNTER_SIGNAL.barCommitS) return;
    this._csBarAcc = 0;
    const s = this.boss.surge, { bar, fill } = this.csEls();
    if (!fill || !Number.isFinite(s.dur)) return;
    this.setClass(bar, "isLive", true);
    this.setTransformScaleX(fill, clamp((s.t + COUNTER_SIGNAL.barCommitS) / Math.max(0.01, s.dur), 0, 1));
  },

  // Boss art glow while a surge charges: one bake per fight / renderScale / spriteEpoch / sprite (a 1/8 danger silhouette
  // upscaled = a blurred halo at half device resolution); no shadowBlur, no getImageData. Freed in endBossFight.
  getCounterSignalGlow(level, sp) {
    const rs = this.renderScale || 1, c = this._csGlow;
    if (c && c.level === level && c.rs === rs && c.epoch === this.spriteEpoch && sp && c.img === sp.img && c.w === sp.w && c.h === sp.h) return c;
    if (!sp || !sp.img || !(sp.w > 0) || !(sp.h > 0)) return null;
    const pad = 0.06, k = rs * 0.5;
    const W = Math.max(1, Math.round(sp.w * (1 + 2 * pad) * k)), H = Math.max(1, Math.round(sp.h * (1 + 2 * pad) * k));
    const tiny = document.createElement("canvas");
    tiny.width = Math.max(1, Math.round(W / 8)); tiny.height = Math.max(1, Math.round(H / 8));
    const tg = tiny.getContext("2d");
    const ix = tiny.width * pad / (1 + 2 * pad), iy = tiny.height * pad / (1 + 2 * pad);
    tg.drawImage(sp.img, ix, iy, tiny.width - 2 * ix, tiny.height - 2 * iy);
    tg.globalCompositeOperation = "source-in";
    tg.fillStyle = PALETTE.rgba("danger", 1);
    tg.fillRect(0, 0, tiny.width, tiny.height);
    const glow = document.createElement("canvas");
    glow.width = W; glow.height = H;
    const gg = glow.getContext("2d");
    gg.imageSmoothingEnabled = true;
    gg.imageSmoothingQuality = "high";
    gg.drawImage(tiny, 0, 0, W, H);
    return (this._csGlow = { level, rs, epoch: this.spriteEpoch, img: sp.img, w: sp.w, h: sp.h, canvas: glow, pad });
  },

  // Inside drawBossArt's save(), composite already "lighter". Alpha .25 + .35 k (k = charge), pulsing 2 Hz with full
  // motion and >= .6 in the last .5 s; steady under reduced motion.
  drawCounterSignalGlow(ctx, boss, p) {
    const s = boss.surge;
    const g = s && p && this.getCounterSignalGlow(boss.artLevel, p.sp);
    if (!g) return;
    const k = clamp(s.t / Math.max(0.01, s.dur), 0, 1), rm = !!this.reduceMotion;
    let a = 0.25 + 0.35 * k;
    if (!rm) { a *= 0.85 + 0.15 * Math.sin(Math.PI * 4 * s.t); if (s.dur - s.t < 0.5) a = Math.max(a, 0.6); }
    const r = p.artRect, dx = r.w * g.pad, dy = r.h * g.pad;
    ctx.globalAlpha = p.alpha * a;
    ctx.drawImage(g.canvas, r.x - dx, r.y - dy, r.w + 2 * dx, r.h + 2 * dy);
    this._csGlowDraws = (this._csGlowDraws | 0) + 1;
    this._csGlowAlpha = a;
  },

  // Slab text during the fail scramble: the reset word in danger red, glyph i resolving at scrambleS x i / len (glyph 0
  // at once); reduced motion: the static red word. Reused return object; <= 9 strings per fail (30 Hz steps).
  counterSignalSlabText(boss, done, rem) {
    const out = CS_SLAB_TEXT;
    out.done = done; out.rem = rem; out.remColor = null;
    const st = boss.scrambleT || 0;
    if (st <= 0 || !rem) return out;
    out.remColor = "danger";
    if (this.reduceMotion) return out;
    const dur = COUNTER_SIGNAL.scrambleS, el = dur - st, step = Math.floor(el * 30);
    if (boss._scrStep === step && boss._scrSrc === rem) { out.rem = boss._scrText; return out; }
    let txt = "";
    for (let i = 0; i < rem.length; i++) txt += el >= dur * i / rem.length ? rem[i] : CS_GLYPHS[(boss.scrambleSeed + i * 7 + step * 13) % 26];
    boss._scrStep = step; boss._scrSrc = rem; boss._scrText = txt; out.rem = txt;
    return out;
  },

  // Hazard cell: the console slab's right cell (88 x 68 inside the 16 px padding); also the surge bolt's anchor.
  bossHazardRect() {
    const boss = this.boss;
    if (!boss) return null;
    const s = boss.slabRect;
    return { x: s.x + s.w - 16 - 88, y: s.y + 14, w: 88, h: 68 };
  },

  // Surge telegraph in the slab's right cell: a dim SURGE label with the charge-up arc toward the next surge
  // while idle; a danger 3-segment countdown (blinking in the last .5 s) while one charges; the bolt afterglow
  // toward the ship once it fired. Hidden during the intro and the finale.
  drawBossHazardMeter(ctx, rect) {
    this._hazardDraws = (this._hazardDraws | 0) + 1;
    const boss = this.boss;
    if (!boss) return;
    if (this.bossIntro && this.bossIntro.locked) return;
    const r = rect || this.bossHazardRect();
    if (!r) return;
    const cfg = LEVELS[this.levelIndex];
    const surge = boss.surge;
    const danger = feedbackColor("danger");
    const rm = !!this.reduceMotion;
    const cx = r.x + r.w / 2;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineCap = "round";
    if (surge) {
      const k = clamp(surge.t / Math.max(0.01, surge.dur), 0, 1);
      const left = surge.dur - surge.t;
      const blinkOn = left < 0.5 && !rm && (Math.floor(surge.t * 10) % 2 === 0);
      const a = blinkOn ? 0.55 : 1;
      ctx.globalAlpha = a;
      ctx.font = feedbackFont(10, 700);
      ctx.fillStyle = danger;
      ctx.fillText("SIGNAL SURGE", cx, r.y + 8);
      const gap = 4, segW = (r.w - gap * 2) / 3, barY = r.y + 22, barH = 12;
      for (let i = 0; i < 3; i++) {
        const fill = clamp(k * 3 - i, 0, 1);
        const x0 = r.x + i * (segW + gap);
        ctx.globalAlpha = a * 0.25;
        ctx.fillStyle = danger;
        ctx.fillRect(x0, barY, segW, barH);
        if (fill > 0) {
          ctx.globalAlpha = a * 0.95;
          ctx.fillRect(x0, barY, segW * fill, barH);
        }
      }
      ctx.globalAlpha = a;
      ctx.font = feedbackFont(16, 700);
      ctx.fillStyle = feedbackColor("text", 0.92);
      ctx.fillText(`${Math.max(0, left).toFixed(1)}s`, cx, r.y + 50);
    } else if (cfg && cfg.surgeEvery && this.counterSignalArmed(cfg)) {
      // idle: dim label + the charge arc toward the next surge (full danger arc while armed and waiting for a segment start)
      const k = boss.surgePending ? 1 : clamp((boss.surgeTimer || 0) / this.counterSignalDue(cfg), 0, 1);
      ctx.globalAlpha = 1;
      ctx.font = feedbackFont(10, 700);
      ctx.fillStyle = feedbackColor("text", 0.25);
      ctx.fillText("SURGE", cx, r.y + 8);
      ctx.lineWidth = 3;
      ctx.strokeStyle = feedbackColor("text", 0.12);
      ctx.beginPath();
      ctx.arc(cx, r.y + 40, 16, 0, Math.PI * 2);
      ctx.stroke();
      if (k > 0) {
        ctx.globalAlpha = boss.surgePending ? 0.7 : 0.45 + 0.25 * k;   // review R12: ladder colour + globalAlpha (no per-frame colour string)
        ctx.strokeStyle = feedbackColor(boss.surgePending ? "danger" : "magenta", 1);
        ctx.beginPath();
        ctx.arc(cx, r.y + 40, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.font = feedbackFont(10, 700);
      ctx.fillStyle = feedbackColor("text", 0.25);
      ctx.fillText("NO SURGE", cx, r.y + 8);
    }
    if (boss.surgeFlash > 0) {
      const aim = this.bossAimPoint();   // D10: the afterglow runs from the boss, where the bolt left
      ctx.globalAlpha = clamp(boss.surgeFlash, 0, 1);
      ctx.strokeStyle = danger;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(aim.x, aim.y);
      ctx.lineTo(this.player.x + 20, this.player.y);
      ctx.stroke();
    }
    ctx.restore();
  },

  // ------------------------- Phase clear -------------------------
  // Boss.advance() already moved boss.phase. Minions detonate, a charging surge is dropped (not countered),
  // +3 s shield, phase bonus, boss checkpoint, callout.
  onBossPhaseClear() {
    const boss = this.boss;
    const cfg = LEVELS[this.levelIndex];
    const L = cfg.level;
    this.killMinionsAll();
    this.cancelSurge(false);
    boss.firedInPhase = 0; boss.surgeTimer = 0; boss.surgePending = false;   // D10: the cap and the cadence restart per phase
    this.player.shield = Math.min(DAMAGE.shieldCap, (this.player.shield || 0) + DAMAGE.phaseClearShield);
    const slab = boss.slabRect;
    this.addScore(SCORE.phase(L), { kind: "bonus", x: slab.x + slab.w / 2, y: slab.y + slab.h + 24 });
    const run = this.run;
    if (run) {
      if (run.boss) { run.boss.phase = boss.phase; run.boss.segmentIndex = boss.segmentIndex; run.boss.progress = 0; }
      run.bossCheckpoint = this.makeCheckpoint("boss");
    }
    const phases = boss.phaseStarts.length;
    const finalMessage = L === LEVELS.length && boss.phase === phases - 1;
    this.showBanner({ kind: "callout", title: finalMessage ? "THE MESSAGE" : `PHASE ${boss.phase + 1}/${phases}`, color: finalMessage ? "violet" : "magenta" });
    this.sfx.bossPhaseClear();
    this.refreshBossUI();
    this.syncChips();
    this.saveRun(true);
  },

  // ------------------------- Kill, finale, tally -------------------------
  onBossKill() {
    const boss = this.boss;
    const cfg = LEVELS[this.levelIndex];
    const L = cfg.level;
    const placement = (typeof this.bossPlacement === "function") ? this.bossPlacement(boss) : null;
    const artRect = placement ? placement.artRect : boss.artRect;
    const contentRect = placement ? placement.contentRect : (boss.contentRect || artRect);
    const aim = this.bossAimPoint();
    const target = (this.levelIndex >= LEVELS.length - 1) ? "victory" : "level";
    const totalChars = boss.totalChars;
    const phasesCleared = Math.max(0, boss.phaseStarts.length - 1);
    if (typeof this.hook === "function") this.hook("bossKill", { level: L, totalChars, elapsedS: (this.levelStats.bossTimeMs || 0) / 1000 });   // 82-overdrive ends Overdrive
    this.endBossFight();
    this.setWavePhase("finale");
    const info = {
      t: 0,
      duration: BOSS_FINALE_S,
      target,
      level: L,
      levelIndex: this.levelIndex,
      elapsed: (this.levelStats.bossTimeMs || 0) / 1000,
      totalChars,
      phasesCleared,
      bossName: cfg.bossName,
      nextLevelIndex: target === "level" ? Math.min(this.levelIndex + 1, LEVELS.length - 1) : null,
      artRect,
      contentRect,
      artLevel: cfg.level,
      tally: null,
      committed: false,
      skipped: false,
      fanfared: false,
      skipHinted: false
    };
    info.tally = this.computeClearTally(info);
    this.bossClear = info;
    // t = 0: hit-stop .16, white-out (.6 under reduce-motion), slow-mo .35 for .6 s easing back over .4 s,
    // the charge riser (bossKill cracks at .4), finale music; minions already detonated in endBossFight.
    const rm = !!this.reduceMotion;
    if (typeof this.addHitStop === "function") this.addHitStop(0.16);
    else this.hitStop = Math.max(this.hitStop || 0, 0.16);
    this.whiteFlash = Math.max(this.whiteFlash || 0, rm ? 0.6 : 1);
    if (typeof this.setSlowMo === "function" && !rm) this.setSlowMo(0.35, 0.6, 0.4);
    this.sfx.bossCharge();
    this.sfx.setMusicState("finale");
    this.screenShake(10);
    this.addExplosion(aim.x, aim.y, 120);
    this.bossDissolve = { t: 0, dur: BOSS_DISSOLVE_S_FOR(), start: 0.4 };
    this.startBossFinale(artRect);
    // Banner at t = .3 (startBossFinale schedules it) with the bonus counting up over 1.2 s from t = .8.
    this.maybePrefetchNext();
    return info;
  },

  // Finale script (JUICE-10 inside SYS-07's 5.0 s): banner at .3; bossKill crack + burst at .4, bursts at .8 /
  // 1.2 / 1.6 (shockwave 180, large sprite, screenShake(8), explosion(rand(.7, 1))) with medium texture between;
  // the art dissolves from .4 over 1.2 s (drawBossDissolve); fanfare at 2.0; SKIP: ANY KEY from 2.0 (banner footer).
  startBossFinale(artRect) {
    const r = artRect || { x: this.w / 2 - 200, y: this.h / 2 - 150, w: 400, h: 300 };
    const c = (this.bossClear && this.bossClear.contentRect) || r;
    this.bossFinaleOrigin = { x: c.x + c.w * 0.5, y: c.y + c.h * 0.5, w: c.w, h: c.h };
    const bursts = [];
    bursts.push({ time: 0.3, kind: "banner" });
    bursts.push({ time: 0.4, kind: "bossKill" });
    for (const t of [0.8, 1.2, 1.6]) bursts.push({ time: t, kind: "shock" });
    for (const t of [0.55, 0.95, 1.35]) bursts.push({ time: t, kind: "medium" });
    bursts.push({ time: 2.0, kind: "fanfare" });
    bursts.sort((a, b) => a.time - b.time);
    this.bossFinaleBursts = bursts;
  },

  runBossFinaleBurst(burst) {
    const o = this.bossFinaleOrigin || { x: this.w * 0.76, y: this.h * 0.45, w: 400, h: 300 };
    const sx = Math.max(60, o.w * 0.35), sy = Math.max(60, o.h * 0.35);
    const info = this.bossClear;
    switch (burst.kind) {
      case "banner":
        if (info) {
          this.showBanner({
            kind: "bossClear",
            eyebrow: `${info.bossName} NEUTRALIZED`,
            title: "BOSS DEFEATED",
            sub: `+${formatInt(info.tally.total)} BONUS`,
            dur: Math.max(BANNER_PRESETS.bossClear.dur, (info.duration || BOSS_FINALE_S) - 0.3),
            count: { from: 0.5, dur: 1.2, to: info.tally.total }
          });
        }
        break;
      case "bossKill":
        this.sfx.bossKill();
        this.screenShake(14);
        if (typeof this.addShockwave === "function") this.addShockwave(o.x, o.y, 180, "text");
        this.addExplosionSprite(o.x, o.y, "large");
        this.addExplosion(o.x, o.y, 90);
        break;
      case "fanfare":
        if (info && !info.fanfared) {
          info.fanfared = true;
          this.sfx.fanfare("bossDown");
        }
        break;
      case "shock": {
        const bx = o.x + rand(-sx * 0.6, sx * 0.6), by = o.y + rand(-sy * 0.6, sy * 0.6);
        if (typeof this.addShockwave === "function") this.addShockwave(bx, by, 180, "amber");
        this.addExplosionSprite(bx, by, "large");
        this.addExplosion(bx, by, 120);
        this.screenShake(8);
        this.sfx.explosion(rand(0.7, 1.0));
        break;
      }
      case "medium":
        for (let i = 0; i < 3; i++) this.addExplosionSprite(o.x + rand(-sx, sx), o.y + rand(-sy, sy), "medium");
        break;
      default:
        break;
    }
  },

  tickFinale(dt) {
    const info = this.bossClear;
    if (!info) return;
    // The finale clock runs on wall time: the boss-kill slow-motion and hit-stop scale the world dt, but the
    // 5 s outro, its bursts and the 2 s skip window are promises to the player (B8), not to the world.
    const ts = this.timeScale;
    info.t += (ts > 0 && ts < 1) ? dt / ts : dt;
    const bursts = this.bossFinaleBursts;
    while (bursts.length && bursts[0].time <= info.t) this.runBossFinaleBurst(bursts.shift());
    const d = this.bossDissolve;
    if (d) {
      d.t = info.t;
      if (info.t >= d.start + d.dur) this.bossDissolve = null;
    }
    if (!info.skipHinted && info.t >= BOSS_FINALE_SKIP_S) info.skipHinted = true;   // the bossClear banner draws "SKIP: ANY KEY"
    if (info.t >= (info.duration || BOSS_FINALE_S)) this.finishFinale();
  },

  // Ends the finale: bank once (before the screen changes, amendment C-16), then Level Complete / Victory.
  finishFinale() {
    const info = this.bossClear;
    if (!info) return;
    if (!info.fanfared) {
      info.fanfared = true;
      this.sfx.fanfare("bossDown");
    }
    this.commitLevelClear(info);
    this.bossClear = null;
    this.bossDissolve = null;
    this.bossFinaleBursts.length = 0;
    this.bossFinaleOrigin = null;
    this.clearBanners();
    this.setWavePhase("spawn");
    if (info.target === "victory") this.onVictory();
    else this.onLevelComplete(info);
  },

  // Any letter, Enter, Space or a canvas tap from BOSS_FINALE_SKIP_S.
  skipFinale(source = "key") {
    const info = this.bossClear;
    if (!info || this.mode !== "playing") return false;
    if (info.t < BOSS_FINALE_SKIP_S) return false;
    info.skipped = true;
    info.skipSource = source;
    this.finishFinale();
    return true;
  },

  // tally = { clear, time, flawless, phases, surges, accuracy, perfectWaves, retryMul, total }: `total` is what
  // commitLevelClear banks (retryMul x (clear + time + flawless + accuracy)); phases / surges / perfectWaves were
  // banked live and are listed for the results card.
  computeClearTally(info) {
    const L = info.level;
    const ls = this.levelStats || {};
    const retries = ls.retries | 0;
    const retryMul = SCORE.retryMul(retries);
    const clear = SCORE.bossClear(L);
    const par = SCORE.par(info.totalChars || 0, L);   // D10: 90 % of the sector's nominal pace
    const elapsed = Number.isFinite(info.elapsed) ? info.elapsed : 0;
    const time = SCORE.timeBonus(par, elapsed, L);
    const flawless = (ls.bossDamage | 0) === 0 ? SCORE.flawless(L) : 0;
    const accPct = this.getLevelAccuracyPct();
    const accuracy = SCORE.accuracy(accPct, L);
    const phases = SCORE.phase(L) * (info.phasesCleared | 0);
    const surges = SCORE.surgeCountered(L) * (ls.surgesCancelled | 0);
    // The money actually banked (each wave at the multiplier of its moment). Retries only grow inside a sector, so the
    // product at the current multiplier never exceeds that sum; it wins only for a run record saved before the sum existed.
    const scoreMul = (typeof this.diff === "function" && this.diff().score) || 1;   // PACE: Cadet x0.8
    const perfectWaves = Math.max(ls.perfectWaveBonus | 0, Math.round(Math.round(SCORE.perfectWave(L) * retryMul) * scoreMul) * (ls.perfectWaves | 0));
    const total = Math.round(retryMul * scoreMul * (clear + time + flawless + accuracy));
    return { clear, time, flawless, phases, surges, accuracy, perfectWaves, retryMul, scoreMul, retries, accPct, par, elapsed, total };
  },
});

// ----------------------------- Counter-Signal listeners (ARCADE D10) -----------------------------
if (typeof onGameHook === "function") {
  // The riser stops under the pause screen (and any other screen) and restarts for what is left on resume.
  onGameHook("modeChange", function (e) {
    const s = this.boss && this.boss.surge;
    if (!s || !this.sfx) return;
    if (e.to !== "playing") { if (typeof this.sfx.surgeStop === "function") this.sfx.surgeStop(); }
    else if (e.from === "paused" && Number.isFinite(s.dur)) this.sfx.surgeCharge(Math.max(0.2, s.dur - (s.t || 0)));
  });
  // Boss checkpoints carry the sector's fired count so Retry boss restores it (surgesCancelled rides the scaffold extra).
  onGameHook("checkpoint", function (e) {
    if (e && e.kind === "boss" && e.cp) e.cp.lvSurgesFired = (this.levelStats && this.levelStats.surgesFired) | 0;
  });
  onGameHook("checkpointRestored", function (e) {
    const cp = e && e.cp;
    if (cp && cp.kind === "boss" && this.levelStats) this.levelStats.surgesFired = cp.lvSurgesFired | 0;
  });
  // Card note COUNTER-SIGNALS won/total (sector cards: this sector; the run card: the whole run).
  onGameHook("results", function (e) {
    const r = e && e.results;
    if (!r) return;
    const run = e.scope === "run";
    const st = this.stats || {}, ls = this.levelStats || {};
    const won = (run ? st.csCountered : ls.surgesCancelled) | 0;
    const lost = (run ? st.csFired : ls.surgesFired) | 0;
    r.counterSignals = { countered: won, fired: lost };
    if (won + lost > 0 && Array.isArray(r.notes)) {
      r.notes.push({ id: "counterSignals", text: `COUNTER-SIGNALS ${won}/${won + lost}`, aria: `Counter-signals: ${won} of ${won + lost} countered.` });
    }
  });
}
