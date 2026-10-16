// Type-R 198X — boss fight v2 (SYS-06/SYS-07): phases, targetable minions, the Signal Surge, the 2.4 s intro, the
// 5 s skippable finale and the clear tally. Boss drawing lives in 70-render.js; drawBossHazardMeter(ctx, rect) here is
// the hook the renderer calls at layer L10 when present. Methods are mixed into Game.prototype; load order is defined in index.html.
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
    this.flash = Math.max(this.flash, 0.45);
    this.damagePulse = 1;
    this.screenShake(14);
    this.showBanner({ kind: "bossIntro", eyebrow: "WARNING // INCOMING BOSS", title: name, sub: returning ? "ANY KEY TO ENGAGE" : "" });
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
    this.sfx.zap(clamp((boss.progress + 1) / segLen, 0, 1));
    this.addSparks(aim.x, aim.y + rand(-40, 40), 10);
    const mult = this.scoringMult();
    const slab = boss.slabRect;
    const r = boss.advance();
    this.addScore(SCORE.bossChar * mult);
    if (r.segmentDone) {
      this.addScore(SCORE.segment(segLen) * mult, { x: slab.x + slab.w / 2, y: slab.y - 14 });
      this.sfx.segmentDown();
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

  // Hazard cell: top-right of the console slab (D6 may move it; the renderer passes its own rect).
  bossHazardRect() {
    const boss = this.boss;
    if (!boss) return null;
    const s = boss.slabRect;
    return { x: s.x + s.w - 156, y: s.y + 12, w: 132, h: 16 };
  },

  // 3-segment countdown in danger red while a surge charges, plus the bolt afterglow once it fired.
  drawBossHazardMeter(ctx, rect) {
    this._hazardDraws = (this._hazardDraws | 0) + 1;
    const boss = this.boss;
    if (!boss) return;
    const r = rect || this.bossHazardRect();
    if (!r) return;
    const surge = boss.surge;
    if (!surge && !(boss.surgeFlash > 0)) return;
    const danger = feedbackColor("danger");
    ctx.save();
    if (surge) {
      const k = clamp(surge.t / Math.max(0.01, surge.dur), 0, 1);
      const blink = (surge.dur - surge.t) < 0.5 && !this.reduceMotion && (Math.floor(surge.t * 10) % 2 === 0);
      ctx.globalAlpha = blink ? 0.55 : 1;
      ctx.strokeStyle = danger;
      ctx.lineWidth = 1.5;
      roundRect(ctx, r.x, r.y, r.w, r.h, 4);
      ctx.stroke();
      const gap = 4, inner = r.w - 8;
      const segW = (inner - gap * 2) / 3;
      for (let i = 0; i < 3; i++) {
        const fill = clamp(k * 3 - i, 0, 1);
        const x0 = r.x + 4 + i * (segW + gap);
        ctx.globalAlpha = (blink ? 0.55 : 1) * 0.25;
        ctx.fillStyle = danger;
        ctx.fillRect(x0, r.y + 4, segW, r.h - 8);
        if (fill > 0) {
          ctx.globalAlpha = blink ? 0.55 : 0.95;
          ctx.fillRect(x0, r.y + 4, segW * fill, r.h - 8);
        }
      }
      ctx.globalAlpha = 1;
      ctx.font = feedbackFont(11, 700);
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = danger;
      ctx.fillText("SIGNAL SURGE", r.x + r.w, r.y - 3);
    }
    if (boss.surgeFlash > 0) {
      ctx.globalAlpha = clamp(boss.surgeFlash, 0, 1);
      ctx.strokeStyle = danger;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y + r.h / 2);
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
    const artRect = boss.artRect;
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
      tally: null,
      committed: false,
      skipped: false,
      fanfared: false,
      skipHinted: false
    };
    info.tally = this.computeClearTally(info);
    this.bossClear = info;
    this.sfx.bossCharge();
    this.sfx.setMusicState("finale");
    this.screenShake(10);
    this.addExplosion(aim.x, aim.y, 120);
    this.hitStop = Math.max(this.hitStop || 0, 0.16);
    this.startBossFinale(artRect);
    this.showBanner({ kind: "bossClear", eyebrow: `${cfg.bossName} NEUTRALIZED`, title: "BOSS DEFEATED", sub: `+${formatInt(info.tally.total)} BONUS` });
    this.maybePrefetchNext();
    return info;
  },

  // Finale script: bossKill crack at .4 s, bursts every .3 s, the bossDown fanfare at 2.0 s.
  startBossFinale(artRect) {
    const r = artRect || { x: this.w / 2 - 200, y: this.h / 2 - 150, w: 400, h: 300 };
    this.bossFinaleOrigin = { x: r.x + r.w * 0.5, y: r.y + r.h * 0.5, w: r.w, h: r.h };
    const bursts = [];
    bursts.push({ time: 0.4, kind: "bossKill" });
    for (let t = 0.1, i = 0; t <= BOSS_FINALE_S - 0.4; t += 0.3, i++) {
      const step = i % 3;
      bursts.push({ time: t, kind: step === 0 ? "shock" : step === 1 ? "large" : "medium" });
    }
    bursts.push({ time: 2.0, kind: "fanfare" });
    bursts.sort((a, b) => a.time - b.time);
    this.bossFinaleBursts = bursts;
  },

  runBossFinaleBurst(burst) {
    const o = this.bossFinaleOrigin || { x: this.w * 0.7, y: this.h * 0.4, w: 400, h: 300 };
    const sx = Math.max(60, o.w * 0.35), sy = Math.max(60, o.h * 0.35);
    switch (burst.kind) {
      case "bossKill":
        this.sfx.bossKill();
        this.screenShake(14);
        this.addExplosionSprite(o.x, o.y, "large");
        this.addExplosion(o.x, o.y, 90);
        break;
      case "fanfare":
        if (this.bossClear && !this.bossClear.fanfared) {
          this.bossClear.fanfared = true;
          this.sfx.fanfare("bossDown");
        }
        break;
      case "shock":
        this.addExplosion(o.x + rand(-40, 40), o.y + rand(-40, 40), 140);
        this.addExplosionSprite(o.x + rand(-40, 40), o.y + rand(-40, 40), "large");
        this.screenShake(6);
        this.sfx.explosion(rand(0.6, 1.0));
        break;
      case "medium":
        for (let i = 0; i < 3; i++) this.addExplosionSprite(o.x + rand(-sx, sx), o.y + rand(-sy, sy), "medium");
        break;
      default:
        for (let i = 0; i < 3; i++) this.addExplosionSprite(o.x + rand(-sx * 0.8, sx * 0.8), o.y + rand(-sy * 0.8, sy * 0.8), "large");
        break;
    }
  },

  tickFinale(dt) {
    const info = this.bossClear;
    if (!info) return;
    info.t += dt;
    const bursts = this.bossFinaleBursts;
    while (bursts.length && bursts[0].time <= info.t) this.runBossFinaleBurst(bursts.shift());
    if (!info.skipHinted && info.t >= BOSS_FINALE_SKIP_S) {
      info.skipHinted = true;
      this.showBanner({ kind: "callout", title: "ANY KEY TO CONTINUE", color: "text", dur: 1.4 });
    }
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
