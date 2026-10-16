// Type-R 198X — spawning (SYS-01/SYS-03), the wave state machine (SYS-04), combat resolution, HP/damage (SYS-10),
// the powerup arsenal (SYS-05) and the per-frame update(dt). Methods are mixed into Game.prototype; load order is defined in index.html.
//
// Wave phases: intro -> spawn -> drain -> banner -> spawn -> drain -> banner -> spawn -> drain -> approach -> boss -> finale.
// levelT advances in every phase but the sector card; a pause freezes everything because update() is not called.
Object.assign(Game.prototype, {
  // ------------------------- Lanes -------------------------
  phoneProfile() {
    return this.cssScale > 0 && this.cssScale < LANE_PROFILE_PHONE.cssScaleBelow;
  },

  laneYs() {
    return this.phoneProfile() ? LANE_PROFILE_PHONE.laneYs : LANE_YS;
  },

  laneIndexForY(y) {
    const ys = this.laneYs();
    let best = 0, bd = Infinity;
    for (let i = 0; i < ys.length; i++) {
      const d = Math.abs(ys[i] - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  },

  // Exclude the lane of the most recent spawn and lanes whose newest occupant is still near the right edge;
  // when every lane is busy, take the one whose newest plate is furthest along (smallest x).
  pickSpawnLane() {
    const n = this.laneYs().length;
    const newest = new Array(n).fill(null);
    for (const en of this.enemies) {
      if (!en.alive || en.dying) continue;
      const l = en.lane >= 0 && en.lane < n ? en.lane : this.laneIndexForY(en.y);
      if (newest[l] === null || en.x > newest[l]) newest[l] = en.x;
    }
    const candidates = [];
    for (let l = 0; l < n; l++) {
      if (l === this.lastSpawnLane) continue;
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

  // ------------------------- Text selection -------------------------
  // Next character of every live target: enemies, powerups and the boss. Used for unique-first-letter spawns
  // and to keep powerup labels off a live first letter.
  liveFirstChars() {
    const s = new Set();
    for (const en of this.enemies) {
      if (!en.alive || en.dying) continue;
      const c = en.nextChar();
      if (c) s.add(c);
    }
    for (const p of this.powerups) {
      if (!p.alive || p.dying) continue;
      const c = p.nextChar();
      if (c) s.add(c);
    }
    if (this.inBoss && this.boss && this.boss.nextChar) s.add(this.boss.nextChar);
    return s;
  },

  // Word from the wave's length window (never sliced or padded); anti-repeat ring of 12 with up to 6 rerolls.
  pickWord(cfg, wave) {
    const pool = wordsForWave(cfg, wave);
    if (!this.recentWords) this.recentWords = [];
    let w = choice(pool);
    for (let i = 0; i < 6 && this.recentWords.includes(w); i++) w = choice(pool);
    this.recentWords.push(w);
    if (this.recentWords.length > 12) this.recentWords.shift();
    return w;
  },

  // Letter (graded set) or word for this wave; up to 8 retries for a first character not in avoidSet, then accept.
  makeEnemyText(cfg, wave = this.wave, avoidSet = null) {
    const letterRatio = waveLetterRatio(cfg, wave);
    const letters = letterSetForWave(cfg, wave);
    let text = null;
    for (let attempt = 0; attempt < 9; attempt++) {
      text = Math.random() < letterRatio ? letters[randi(0, letters.length - 1)] : this.pickWord(cfg, wave);
      if (!avoidSet || !avoidSet.has(text[0])) break;
    }
    return text;
  },

  countAliveEnemies() {
    let n = 0;
    for (const en of this.enemies) if (en.alive && !en.dying) n++;
    return n;
  },

  countAlivePowerups() {
    let n = 0;
    for (const p of this.powerups) if (p.alive && !p.dying) n++;
    return n;
  },

  // ------------------------- Spawning -------------------------
  spawnEnemy() {
    const cfg = LEVELS[this.levelIndex];
    if (this.countAliveEnemies() >= waveMaxEnemies(cfg, this.wave, this.phoneProfile())) return null;
    const text = this.makeEnemyText(cfg, this.wave, this.liveFirstChars());
    const lane = this.pickSpawnLane();
    const y = this.laneYs()[lane];
    const len = text.length;
    let speed = waveSpeed(cfg, this.wave) * rand(0.92, 1.08);
    if (len >= LONG_WORD_LEN) speed *= LONG_WORD_SPEED_MUL;
    else if (len === 1) speed *= rand(LETTER_SPEED_MUL[0], LETTER_SPEED_MUL[1]);
    const en = new Enemy({ text, x: this.w, y, speed, lane });
    en.x = this.w + en.plateW / 2 + rand(10, 90);   // plate fully off-screen, targetable ~0.3 s later
    this.enemies.push(en);
    this.lastSpawnLane = lane;
    this._spawnLog.push({ t: nowMs(), n: len });
    return en;
  },

  // Regular stream + hungry spawner + pressure valve. Never spawns more than the wave still needs.
  tickSpawner(dt, cfg) {
    const alive = this.countAliveEnemies();
    const quota = cfg.quota[this.wave] || 1;
    this.spawnAcc += dt * waveSpawnRate(cfg, this.wave, this.waveKills);
    if (alive < HUNGRY_MIN_ALIVE) {
      this.hungryT = (this.hungryT || 0) + dt;
      if (this.hungryT >= HUNGRY_SPAWN_S) {
        this.hungryT = 0;
        this.spawnAcc = Math.max(this.spawnAcc, 1);
      }
    } else {
      this.hungryT = 0;
    }
    if (this.waveKills + alive >= quota) { this.spawnAcc = Math.min(this.spawnAcc, 1); return; }
    if (this.liveChars() > pressureCap(cfg)) { this.spawnAcc = Math.min(this.spawnAcc, 1); return; }
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (!this.spawnEnemy()) { this.spawnAcc = Math.min(this.spawnAcc, 0.999); break; }
    }
  },

  // ------------------------- Wave state machine -------------------------
  setWavePhase(phase) {
    this.wavePhase = phase;
    this.phaseT = 0;
    // Debug trail for the harness (phases can last a single frame).
    if (!this.phaseLog) this.phaseLog = [];
    this.phaseLog.push(phase);
    if (this.phaseLog.length > 64) this.phaseLog.shift();
  },

  tickWaves(dt) {
    if (this.inBoss) return;
    const cfg = LEVELS[this.levelIndex];
    if (this.levelT >= cfg.duration && this.wavePhase !== "approach") this.beginBossApproach();
    this.phaseT += dt;
    switch (this.wavePhase) {
      case "intro": {
        const li = this.levelIntro;
        if (!li) { this.beginWave(this.wave); break; }
        li.t += dt;
        const gate = (typeof this.isLevelGateOpen === "function") ? this.isLevelGateOpen() : true;
        if (li.t >= li.dur && (gate || li.t >= LEVEL_INTRO_MAX_S)) {
          this.levelIntro = null;
          this.beginWave(this.wave);
        }
        break;
      }
      case "spawn": {
        this.waveT += dt;
        this.tickSpawner(dt, cfg);
        if (this.waveKills >= (cfg.quota[this.wave] || 1) || this.waveT >= cfg.cap) this.endWave();
        break;
      }
      case "drain": {
        const alive = this.countAliveEnemies();
        if ((alive === 0 && this.phaseT >= DRAIN_MIN_S) || this.phaseT >= DRAIN_MAX_S) {
          if (alive) this.detonateLeftovers();
          if (this.wave < 2) {
            this.setWavePhase("banner");
            this.showBanner({ kind: "wave", title: `WAVE ${this.wave + 2} / 3` });
          } else {
            this.beginBossApproach();
          }
        }
        break;
      }
      case "banner": {
        if (this.phaseT >= WAVE_BANNER_S) this.beginWave(this.wave + 1);
        break;
      }
      case "approach": {
        if (this.phaseT >= BOSS_APPROACH_S) this.beginBossFight();
        break;
      }
      default:
        this.setWavePhase("spawn");
    }
  },

  beginWave(i) {
    this.wave = clamp(i | 0, 0, 2);
    this.waveKills = 0;
    this.waveT = 0;
    this.waveDmg = 0;
    this._waveFinished = false;
    this.hungryT = 0;
    this.spawnAcc = SPAWN_ACC_PRIME;
    this.setWavePhase("spawn");
    this.sfx.waveStart(this.wave + 1);
    if (this.wave === 0) {
      this.sfx.lock("go");
      this.showBanner({ kind: "wave", title: "WAVE 1 / 3", sub: "GO" });
    }
    if (this.run) { this.run.wave = this.wave; this.run.waveKills = 0; this.run.wavePhase = "spawn"; }
  },

  // Quota met (or the wave cap ran out): perfect-wave bonus, then drain the field.
  endWave() {
    if (this.wavePhase !== "spawn") return;
    const cfg = LEVELS[this.levelIndex];
    this._waveFinished = true;
    this.sfx.waveClear(this.wave + 1);
    if ((this.waveDmg || 0) === 0 && this.waveKills > 0) {
      this.levelStats.perfectWaves = (this.levelStats.perfectWaves | 0) + 1;
      const bonus = Math.round(SCORE.perfectWave(cfg.level) * SCORE.retryMul(this.levelStats.retries | 0));
      this.addScore(bonus, { kind: "bonus", x: this.w / 2, y: this.hudSafeTop + 96 });
      this.showBanner({ kind: "callout", title: "PERFECT WAVE", sub: `+${formatInt(bonus)}`, color: "amber" });
    }
    this.setWavePhase("drain");
  },

  // 3 s danger callout, then the boss. Also the hard cap for levelT >= duration (harness forceBoss).
  beginBossApproach() {
    if (this.inBoss || this.wavePhase === "approach") return;
    const cfg = LEVELS[this.levelIndex];
    this.levelIntro = null;
    this.detonateLeftovers();
    this.releaseLock("dead");
    this._waveFinished = true;
    this.setWavePhase("approach");
    this.sfx.bossWarning();
    if (typeof this.sfx.duckMusic === "function") this.sfx.duckMusic(0.5, BOSS_APPROACH_S);
    this.showBanner({ kind: "wave", title: "WARNING", sub: `${cfg.bossName} APPROACHING`, color: "danger", dur: BOSS_APPROACH_S });
    if (this.run) { this.run.wavePhase = "approach"; this.run.wave = this.wave; }
  },

  // Leftovers at a drain timeout / approach start / phase clear: small explosion, no damage, no score, no quota.
  detonateEnemy(en) {
    if (!en || !en.alive) return;
    en.dying = true;
    en.alive = false;
    en.locked = false;
    if (this.lock && this.lock.ref === en) { this.lock = null; this.lockMisses = 0; }
    this.addExplosion(en.x, en.y, 10);
    this.addExplosionSprite(en.x, en.y, "small");
  },

  detonateLeftovers() {
    let n = 0;
    for (const en of this.enemies) {
      if (!en.alive) continue;
      this.detonateEnemy(en);
      n++;
    }
    if (n) this.sfx.explosion(0.3);
    return n;
  },

  // ------------------------- Combat resolution -------------------------
  // Typed destruction (primary) or a weapon side-effect (secondary: half value, never clean). Minions never
  // count toward wave quotas.
  killEnemy(en, opts = {}) {
    if (!en || !en.alive) return 0;
    const secondary = !!opts.secondary;
    en.alive = false;
    en.locked = false;
    en.dying = true;
    if (this.lock && this.lock.ref === en) { this.lock = null; this.lockMisses = 0; }

    const len = en.text.length;
    const minion = en.kind === "bossMinion";
    const mult = this.scoringMult();
    let base = minion ? SCORE.minion : (len <= 1 ? SCORE.letter : SCORE.word(len));
    if (secondary) base *= SCORE.secondaryMul;
    else if (!minion && len > 1 && en.cleanSoFar) base *= SCORE.cleanMul;
    const gained = this.addScore(base * mult, { x: en.x, y: en.y - 26 });

    this.stats.kills++;
    this.levelStats.kills++;
    if (!minion) {
      if (len <= 1) this.stats.letters++;
      else { this.stats.words++; this.levelStats.words++; }
      if (!this.inBoss && this.wavePhase !== "approach") this.waveKills++;
    }

    this.addExplosion(en.x, en.y, 14 + len * 2);
    this.addExplosionSprite(en.x, en.y, this.getExplosionTypeForEnemy(en));
    this.sfx.explosion(minion ? 0.15 : clamp((len - 1) / 11, 0, 1));
    this.screenShake(len > 6 ? 5 : 3);
    this.hitStop = Math.max(this.hitStop || 0, len > 1 ? 0.045 : 0.03);

    this.maybeDropPowerup(en);
    if (!secondary && !minion && this.power.spread > 0) this.applySpread(en);
    return gained;
  },

  // SPREAD: completing a word also destroys enemies within 160 px (one hop; secondary kills do not spread).
  applySpread(en) {
    const r = POWERUP_TYPES.SPREAD.radius;
    const victims = [];
    for (const o of this.enemies) {
      if (o === en || !o.alive || o.dying || o.kind === "bossMinion") continue;
      if (Math.hypot(o.x - en.x, o.y - en.y) <= r) victims.push(o);
    }
    if (typeof this.addShockwave === "function") this.addShockwave(en.x, en.y, r, "magenta");
    else this.addExplosion(en.x, en.y, 40);
    for (const o of victims) this.killEnemy(o, { secondary: true });
    return victims;
  },

  // PIERCE: each correct key also hits the enemy directly behind the target in the same lane.
  applyPierce(ref, ch) {
    let behind = null;
    for (const o of this.enemies) {
      if (o === ref || !o.alive || o.dying || o.lane !== ref.lane || o.x <= ref.x) continue;
      if (!behind || o.x < behind.x) behind = o;
    }
    if (!behind) return null;
    behind.progress++;
    behind.flash = 0.18;
    behind.cleanSoFar = false;
    this.fireLaserTo(behind.x, behind.y, "magenta");
    if (behind.progress >= behind.text.length) this.killEnemy(behind, { secondary: true });
    return behind;
  },

  // RAPID: each correct key also hits every targetable enemy whose next character matches (chain lightning).
  applyRapid(ref, ch) {
    if (!this.chainTargets) this.chainTargets = [];
    const hits = [];
    for (const o of this.enemies) {
      if (o === ref || !this.isTargetable(o) || o.nextChar() !== ch) continue;
      hits.push(o);
    }
    const now = nowMs();
    for (const o of hits) {
      o.progress++;
      o.flash = 0.18;
      o.cleanSoFar = false;
      this.chainTargets.push({ en: o, x: o.x, y: o.y, t: now });
      if (typeof this.addBolt === "function") this.addBolt(ref.x, ref.y, o.x, o.y, "cyan", 0.12);
      else this.fireLaserTo(o.x, o.y, "cyan");
      if (o.progress >= o.text.length) this.killEnemy(o, { secondary: true });
    }
    if (hits.length) this.sfx.chainZap();
    return hits;
  },

  // Contact leak: the enemy is destroyed either way; damage only outside i-frames.
  leakEnemy(en) {
    en.alive = false;
    en.locked = false;
    en.dying = true;
    if (this.lock && this.lock.ref === en) { this.lock = null; this.lockMisses = 0; }
    if (this.bossClear) return;
    this._leakLog.push(nowMs());
    this.sfx.impact();
    const dmg = en.kind === "bossMinion" ? DAMAGE.minion : DAMAGE.leak(en.text.length);
    this.takeDamage(dmg, "leak");
    this.addExplosion(this.player.x + 40, en.y, 18);
    this.addExplosionSprite(this.player.x + 40, en.y, this.getExplosionTypeForEnemy(en));
  },

  // ------------------------- HP, shield, i-frames -------------------------
  // source: 'leak' | 'minion' | 'surge'. Returns the HP actually lost.
  takeDamage(amount, source = "leak") {
    if (this.bossClear) return 0;
    if ((this.invulnT || 0) > 0) return 0;
    const dmg = Math.round(Math.max(0, amount) * (this.diff().damage || 1));
    if (this.player.shield > 0) {
      this.player.shield = Math.max(0, this.player.shield - DAMAGE.shieldHitCost);
      this.player.shieldFlash = 1;
      this.screenShake(4);
      if (this.player.shield <= 0) {
        this.sfx.shieldBreak();
        this.showBanner({ kind: "callout", title: "SHIELD DOWN", color: "danger" });
      } else {
        this.sfx.shieldHit();
      }
      return 0;
    }
    this.player.hp = Math.max(0, this.player.hp - dmg);
    this.invulnT = DAMAGE.iframes;
    const ls = this.levelStats;
    ls.damageTaken = (ls.damageTaken | 0) + dmg;
    if (this.inBoss) ls.bossDamage = (ls.bossDamage | 0) + dmg;
    else { ls.waveDamage = (ls.waveDamage | 0) + dmg; this.waveDmg = (this.waveDmg || 0) + dmg; }
    this.onComboBreak(this.stats.combo | 0);
    if (source !== "surge") this.sfx.damage();   // surgeFire() carries its own damage() hit
    this.player.hitT = 0.3;
    this.player.kick = 1;
    this.damageFlash = 1;
    this.damagePulse = 1;
    this.flash = Math.max(this.flash, 0.35);
    this.screenShake(12);
    this.flashHudHit();
    this.updateLowHp();
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.onGameOver();
    }
    return dmg;
  },

  healPlayer(n) {
    const before = this.player.hp;
    this.player.hp = clamp(before + Math.max(0, n | 0), 0, this.player.maxHp);
    const healed = this.player.hp - before;
    if (healed > 0) this.addFloater(this.player.x + 20, this.player.y - 60, `+${healed} HULL`, "text", 16);
    this.updateLowHp();
    return healed;
  },

  // SFX.lowHp(on) on crossing 25 % either way.
  updateLowHp() {
    const low = this.player.hp / Math.max(1, this.player.maxHp) < DAMAGE.lowHp;
    if (low !== !!this._lowHpOn) {
      this._lowHpOn = low;
      this.sfx.lowHp(low);
    }
  },

  // ------------------------- Powerups -------------------------
  // Weighted by hp (pity rows) and boss context; types whose label starts with a live first letter are skipped.
  rollPowerupType() {
    const hpFrac = this.player.hp / Math.max(1, this.player.maxHp);
    const weights = powerupWeightsFor(hpFrac, this.inBoss);
    const taken = this.liveFirstChars();
    let entries = POWERUP_ORDER.map((id) => [id, weights[id] || 0]).filter(([id, w]) => w > 0 && !taken.has(POWERUP_TYPES[id].label[0]));
    if (!entries.length) entries = POWERUP_ORDER.map((id) => [id, weights[id] || 0]).filter(([, w]) => w > 0);
    if (!entries.length) return null;
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    for (const [id, w] of entries) {
      r -= w;
      if (r < 0) return id;
    }
    return entries[entries.length - 1][0];
  },

  maybeDropPowerup(en) {
    const cfg = LEVELS[this.levelIndex];
    if (this.countAlivePowerups() >= POWERUP_DROP.maxAlive) return null;
    let p;
    if (en.kind === "bossMinion") p = POWERUP_DROP.pMinion;
    else if (en.text.length >= POWERUP_DROP.wordMinLen) p = POWERUP_DROP.pWord(cfg.level);
    else p = POWERUP_DROP.pLetter;
    if (Math.random() < p) return this.spawnPowerup({ x: en.x, y: en.y, fromKill: true });
    return null;
  },

  // spawnPowerup({ x, y, fromKill, type }): kill drops appear at the kill point and home toward the ship's lane at
  // .55x speed; floor spawns enter from the right on a free lane.
  spawnPowerup(opts = {}) {
    const cfg = LEVELS[this.levelIndex];
    if (this.countAlivePowerups() >= POWERUP_DROP.maxAlive) return null;
    const type = (opts.type && POWERUP_TYPES[opts.type]) ? opts.type : this.rollPowerupType();
    if (!type) return null;
    const def = POWERUP_TYPES[type];
    const fromKill = !!opts.fromKill && Number.isFinite(opts.x) && Number.isFinite(opts.y);
    const speed = cfg.speed * POWERUP_DROP.homingSpeedMul;
    const ys = this.laneYs();
    let x, y, lane;
    if (fromKill) {
      x = opts.x;
      y = opts.y;
      lane = this.laneIndexForY(y);
    } else {
      lane = this.pickSpawnLane();
      y = ys[lane];
      x = this.w + 60 + rand(0, 80);
    }
    const homing = fromKill ? { tx: this.player.x + 140, ty: this.player.y } : null;
    const pu = new Powerup({ type, label: def.label, x, y, speed, lane, fromKill, ttl: POWERUP_DROP.lifetimeS, homing });
    this.powerups.push(pu);
    this.powerAcc = 0;
    return pu;
  },

  // Guaranteed cadence while none is alive: every 14 s (18 s in a boss), only in play phases.
  tickPowerupFloor(dt) {
    const inPlay = this.wavePhase === "spawn" || (this.inBoss && !(this.bossIntro && this.bossIntro.locked) && !this.bossClear);
    if (!inPlay) return;
    if (this.countAlivePowerups() > 0) { this.powerAcc = 0; return; }
    this.powerAcc += dt;
    const every = this.inBoss ? POWERUP_DROP.bossFloorEveryS : POWERUP_DROP.floorEveryS;
    if (this.powerAcc >= every) {
      this.powerAcc = 0;
      this.spawnPowerup({});
    }
  },

  collectPowerup(p) {
    if (!p || !p.alive) return;
    p.alive = false;
    p.locked = false;
    p.dying = true;
    if (this.lock && this.lock.ref === p) { this.lock = null; this.lockMisses = 0; }
    const def = POWERUP_TYPES[p.type] || POWERUP_TYPES.SHIELD;
    const mult = this.scoringMult();
    this.sfx.pickup(p.type);
    this.addExplosion(p.x, p.y, 22);
    this.addExplosionSprite(p.x, p.y, "small");
    this.addScore(SCORE.pickup * mult, { x: p.x, y: p.y - 26, label: def.label.toUpperCase() });
    if (!this.powerMax) this.powerMax = {};
    switch (p.type) {
      case "SPREAD":
      case "PIERCE":
      case "RAPID":
        this.power[def.powerKey] = Math.max(this.power[def.powerKey] || 0, def.duration);
        break;
      case "MULTI":
        this.power.multiplier = Math.max(this.power.multiplier || 0, def.duration);
        this.bumpMultiplier();
        break;
      case "SHIELD":
        this.player.shield = Math.min(DAMAGE.shieldCap, (this.player.shield || 0) + def.duration);
        break;
      case "REPAIR":
        this.healPlayer(Math.round(DAMAGE.repair * this.player.maxHp));
        break;
    }
    if (typeof this.flyLabelToChip === "function") this.flyLabelToChip(def.label, p.x, p.y, p.type);
    this.syncChips();
  },

  // Power timers; a timer reaching 0 plays powerDown (MULTI also drops the multiplier).
  tickPowerTimers(dt) {
    for (const key of ["spread", "pierce", "rapid", "multiplier"]) {
      const before = this.power[key] || 0;
      if (before <= 0) continue;
      this.power[key] = Math.max(0, before - dt);
      if (this.power[key] === 0) {
        this.sfx.powerDown();
        if (key === "multiplier") this.bumpMultiplier();
      }
    }
    const shieldBefore = this.player.shield || 0;
    if (shieldBefore > 0) {
      this.player.shield = Math.max(0, shieldBefore - dt);
      if (this.player.shield === 0) this.sfx.powerDown();
    }
    this.invulnT = Math.max(0, (this.invulnT || 0) - dt);
    this.player.hitT = Math.max(0, (this.player.hitT || 0) - dt);
    this.player.kick = Math.max(0, (this.player.kick || 0) - dt * 4);
    this.player.shieldFlash = Math.max(0, (this.player.shieldFlash || 0) - dt * 3);
    this.typoFlash = Math.max(0, (this.typoFlash || 0) - dt * 3);
    this.damageFlash = Math.max(0, (this.damageFlash || 0) - dt * 1.8);
    this.whiteFlash = Math.max(0, (this.whiteFlash || 0) - dt * 2);
  },

  // Prefetch the next sector's art and music once per level (at 25 % of the duration, and when the finale starts).
  maybePrefetchNext() {
    if (this._prefetched) return;
    this._prefetched = true;
    if (typeof this.prefetchNextSector === "function") this.prefetchNextSector();
    const sfx = this.sfx;
    if (sfx && typeof sfx.prefetchMusic === "function" && typeof sfx.trackForLevel === "function" && this.levelIndex < LEVELS.length - 1) {
      sfx.prefetchMusic(sfx.trackForLevel(this.levelIndex + 1));
    }
  },

  // ------------------------- Frame update -------------------------
  update(dt) {
    const cfg = LEVELS[this.levelIndex];
    if (!Game.prototype._feedbackHooked) this.installFeedbackHooks();
    if (!this.chainTargets) this.chainTargets = [];

    const intro = !!this.levelIntro;
    if (!intro) this.levelT += dt;
    this.playClock = (this.playClock || 0) + dt;
    this.stepAmbient(dt);

    // Clocks (B9): only while the player can act (not the sector card, a locked boss intro or the finale).
    if (!intro && !(this.bossIntro && this.bossIntro.locked) && !this.bossClear) {
      const ms = dt * 1000;
      this.stats.timeMs += ms;
      this.levelStats.timeMs += ms;
      if (this.inBoss) {
        this.stats.bossTimeMs += ms;
        this.levelStats.bossTimeMs += ms;
      }
    }

    this.tickPowerTimers(dt);
    if (this.chainTargets.length) {
      const now = nowMs();
      compactInPlace(this.chainTargets, (c) => now - c.t < 150);
    }

    if (this.bossClear) this.tickFinale(dt);
    else {
      this.tickWaves(dt);
      if (this.inBoss) this.tickBoss(dt);
    }
    this.tickPowerupFloor(dt);

    // Enemies and leaks
    for (const en of this.enemies) {
      if (!en.alive) continue;
      en.update(dt);
      if (en.x < this.player.x + 35) this.leakEnemy(en);
    }

    // Powerups: homing / drift, lifetime, missed when they pass the ship
    for (const p of this.powerups) {
      if (!p.alive) continue;
      p.update(dt);
      if (p.dying || p.x < this.player.x + 60) {
        p.alive = false;
        if (this.lock && this.lock.ref === p) { this.lock = null; this.lockMisses = 0; }
      }
    }

    if (this.inBoss && this.boss) this.boss.update(dt, this.h);

    // Bullets (visual only), particles, explosions: in-place compaction keeps object identity (F101)
    compactInPlace(this.bullets, b => (b.update(dt), b.alive()));
    compactInPlace(this.particles, p => (p.update(dt), p.alive()));
    compactInPlace(this.explosions, ex => (ex.update(dt), !ex.done));
    compactInPlace(this.enemies, e => e.alive);
    compactInPlace(this.powerups, p => p.alive);

    // Lock validity
    if (this.lock && (!this.lock.ref || !this.lock.ref.alive)) { this.lock = null; this.lockMisses = 0; }

    this.updateFloaters(dt);
    this.updateBanner(dt);

    if (!this._prefetched && this.levelT >= 0.25 * cfg.duration) this.maybePrefetchNext();

    // autosave (never during the finale: the clear is committed once, by the finale itself)
    if (!this.bossClear) this.saveRun(false);

    this.updateHUD();
  },
});
