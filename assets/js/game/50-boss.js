// Type-R 198X — boss fight v2 (SYS-06/SYS-07): phases, targetable minions, the Signal Surge, the 2.4 s intro, the
// 5 s skippable finale and the clear tally. Boss drawing lives in 70-render.js; drawBossHazardMeter(ctx, rect) here is
// the hook the renderer calls at layer L10 when present. Methods are mixed into Game.prototype; load order is defined in index.html.
// Dissolve length (70-render.js owns BOSS_DISSOLVE_S; 1.2 s per CONTRACT section 11).
const BOSS_DISSOLVE_S_FOR = () => (typeof BOSS_DISSOLVE_S === "number" ? BOSS_DISSOLVE_S : 1.2);

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
    if (typeof this.announce === "function") this.announce(`Boss: ${boss.name}. Type the highlighted word.`);
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

    if (boss.surge) {
      boss.surge.t += dt;
      if (boss.surge.t >= boss.surge.dur) this.fireSurge();
    } else if (cfg.surgeEvery) {
      boss.surgeTimer += dt;
      if (boss.surgeTimer >= cfg.surgeEvery) this.startSurge();
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
        this.onHardMiss(lock.ref);
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
    this.onHardMiss(null);
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
    const r = boss.advance();
    this.addScore(SCORE.bossChar * mult);
    if (r.segmentDone) {
      this.addScore(SCORE.segment(segLen) * mult, { x: slab.x + slab.w / 2, y: slab.y - 14 });
      this.sfx.segmentDown();
      boss.flash = Math.max(boss.flash, 0.5);
      if (typeof this.addShockwave === "function") this.addShockwave(aim.x, aim.y, 120, "magenta");
      this.pulseBossSegmentClear();
      this.hitStop = Math.max(this.hitStop || 0, 0.09);
      if (boss.surge) this.cancelSurge(true);
      if (this.run && this.run.boss) { this.run.boss.segmentIndex = boss.segmentIndex; this.run.boss.progress = 0; }
    }
    if (r.phaseDone) this.onBossPhaseClear();
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
    const text = pool.length ? choice(pool) : letters[randi(0, letters.length - 1)];
    const ys = this.laneYs();
    const lanes = MINION_LANES.filter((l) => l < ys.length);
    const x = boss.artRect.x + (Number.isFinite(cfg.minionSpawnDx) ? cfg.minionSpawnDx : MINION_SPAWN_DX);
    const busy = new Set();
    for (const en of this.enemies) if (en.alive && !en.dying && en.kind === "bossMinion" && en.x > x - 140) busy.add(en.lane);
    let cands = lanes.filter((l) => !busy.has(l) && l !== this.lastMinionLane);
    if (!cands.length) cands = lanes.filter((l) => !busy.has(l));
    if (!cands.length) cands = lanes;
    const lane = choice(cands);
    const en = new Enemy({ text, x, y: ys[lane], speed: cfg.speed * MINION_SPEED_MUL, kind: "bossMinion", lane });
    this.enemies.push(en);
    this.lastMinionLane = lane;
    this._spawnLog.push({ t: nowMs(), n: text.length });
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

  // ------------------------- Signal Surge -------------------------
  // startSurge(): { t, dur: 1.5 + .25 * remainingChars, armed }. Finishing the segment first counters it; otherwise it fires.
  startSurge() {
    const boss = this.boss;
    if (!boss || boss.surge) return null;
    const dur = surgeDuration(boss.remainingChars);
    boss.surge = { t: 0, dur, armed: true };
    boss.surgeTimer = 0;
    this.sfx.surgeCharge(dur);
    this.refreshBossUI();
    return boss.surge;
  },

  cancelSurge(countered = true) {
    const boss = this.boss;
    if (!boss || !boss.surge) return false;
    boss.surge = null;
    boss.surgeTimer = 0;
    if (countered) {
      const L = LEVELS[this.levelIndex].level;
      this.levelStats.surgesCancelled = (this.levelStats.surgesCancelled | 0) + 1;
      this.sfx.surgeCancel();
      const slab = boss.slabRect;
      this.addScore(SCORE.surgeCountered(L), { kind: "bonus", x: slab.x + slab.w / 2, y: slab.y + slab.h + 24 });
      this.showBanner({ kind: "callout", title: "COUNTERED", color: "cyan" });
    }
    this.refreshBossUI();
    return true;
  },

  fireSurge() {
    const boss = this.boss;
    if (!boss || !boss.surge) return 0;
    const L = LEVELS[this.levelIndex].level;
    boss.surge = null;
    boss.surgeTimer = 0;
    boss.surgeFlash = 1;
    const cell = this.bossHazardRect();
    const sx = cell ? cell.x : boss.x, sy = cell ? cell.y + cell.h / 2 : boss.y;
    if (typeof this.addBolt === "function") this.addBolt(sx, sy, this.player.x + 20, this.player.y, "danger", 0.2);
    else this.bullets.push(new Bullet({ x: sx, y: sy, tx: this.player.x + 20, ty: this.player.y, life: 0.2, width: 4, color: "magenta" }));
    this.sfx.surgeFire();
    const dmg = this.takeDamage(DAMAGE.surge(L), "surge");
    this.refreshBossUI();
    return dmg;
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
    } else if (cfg && cfg.surgeEvery) {
      // idle: dim label + the charge arc toward the next surge
      const k = clamp((boss.surgeTimer || 0) / cfg.surgeEvery, 0, 1);
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
        ctx.strokeStyle = feedbackColor("magenta", 0.45 + 0.25 * k);
        ctx.beginPath();
        ctx.arc(cx, r.y + 40, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
        ctx.stroke();
      }
    } else {
      ctx.font = feedbackFont(10, 700);
      ctx.fillStyle = feedbackColor("text", 0.25);
      ctx.fillText("NO SURGE", cx, r.y + 8);
    }
    if (boss.surgeFlash > 0) {
      ctx.globalAlpha = clamp(boss.surgeFlash, 0, 1);
      ctx.strokeStyle = danger;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y + 40);
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
    const par = (info.totalChars || 0) / SCORE.parDivisor;
    const elapsed = Number.isFinite(info.elapsed) ? info.elapsed : 0;
    const time = SCORE.timeBonus(par, elapsed, L);
    const flawless = (ls.bossDamage | 0) === 0 ? SCORE.flawless(L) : 0;
    const accPct = this.getLevelAccuracyPct();
    const accuracy = SCORE.accuracy(accPct, L);
    const phases = SCORE.phase(L) * (info.phasesCleared | 0);
    const surges = SCORE.surgeCountered(L) * (ls.surgesCancelled | 0);
    const perfectWaves = Math.round(SCORE.perfectWave(L) * retryMul) * (ls.perfectWaves | 0);
    const total = Math.round(retryMul * (clear + time + flawless + accuracy));
    return { clear, time, flawless, phases, surges, accuracy, perfectWaves, retryMul, retries, accPct, par, elapsed, total };
  },
});
