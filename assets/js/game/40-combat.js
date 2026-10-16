// Type-R 198X — spawning, combat resolution and the per-frame update(dt). Methods are mixed into Game.prototype; load order is defined in index.html.
Object.assign(Game.prototype, {
  // ------------------------- Spawning -------------------------
  makeEnemyText(cfg) {
    const isLetter = Math.random() < cfg.letterRatio;
    if (isLetter) {
      const letters = "abcdefghijklmnopqrstuvwxyz";
      return letters[randi(0, letters.length - 1)];
    }

    const pool = (cfg.level <= 3) ? WORDS_EASY : (cfg.level <= 6) ? WORDS_MED : WORDS_HARD;
    let w = choice(pool);
    // Clamp length to desired range by re-rolling a few times
    for (let i=0;i<6;i++) {
      if (w.length >= cfg.wordMin && w.length <= cfg.wordMax) break;
      w = choice(pool);
    }
    // If still out of range, slice
    if (w.length > cfg.wordMax) w = w.slice(0, cfg.wordMax);
    if (w.length < cfg.wordMin) w = w.padEnd(cfg.wordMin, "x");
    return w;
  },

  spawnEnemy() {
    const cfg = LEVELS[this.levelIndex];
    if (this.enemies.length >= cfg.maxEnemies) return;

    const text = this.makeEnemyText(cfg);
    const y = rand(170, this.h - 140);
    const x = this.w + rand(20, 260);
    const speed = cfg.baseSpeed * rand(0.85, 1.18) * (text.length <= 1 ? rand(1.0, 1.25) : 1.0);
    this.enemies.push(new Enemy({ text, x, y, speed }));
    this._spawnLog.push({ t: nowMs(), n: text.length });
  },

  spawnPowerup() {
    const cfg = LEVELS[this.levelIndex];
    // in early levels, fewer powerups
    if (Math.random() < (cfg.level <= 2 ? 0.55 : 0.72)) {
      const types = ["SPREAD","PIERCE","RAPID","SHIELD","MULTI"];
      const type = choice(types);
      const label = (type === "SHIELD") ? "shield" : (type === "MULTI" ? "x2" : type.toLowerCase());
      const y = rand(210, this.h - 220);
      const x = this.w + rand(80, 380);
      const speed = cfg.baseSpeed * 0.70;
      this.powerups.push(new Powerup({ type, label, x, y, speed }));
    }
  },

  // ------------------------- Combat resolution -------------------------
  killEnemy(en) {
    en.alive = false;
    en.locked = false;

    const base = en.text.length <= 1 ? 55 : 75 + en.text.length * 10;
    const gained = Math.floor(base * this.stats.mult);
    this.stats.score += gained;

    this.addExplosion(en.x, en.y, 14 + en.text.length * 2);
    this.addExplosionSprite(en.x, en.y, this.getExplosionTypeForEnemy(en));
    this.sfx.explosion();
    this.screenShake(4);

    // Chance to drop powerup on word kills (later more likely)
    const lvl = LEVELS[this.levelIndex].level;
    if (en.text.length >= 4 && Math.random() < lerp(0.08, 0.18, (lvl - 1) / 9)) {
      this.spawnPowerup();
    }
  },

  collectPowerup(p) {
    if (!p.alive) return;
    p.alive = false;
    p.locked = false;
    this.sfx.powerup();
    this.addExplosion(p.x, p.y, 22);
    this.addExplosionSprite(p.x, p.y, "small");
    this.stats.score += 120 * this.stats.mult;

    const seconds = 9;
    switch (p.type) {
      case "SPREAD": this.power.spread = Math.max(this.power.spread, seconds); break;
      case "PIERCE": this.power.pierce = Math.max(this.power.pierce, seconds); break;
      case "RAPID": this.power.rapid = Math.max(this.power.rapid, seconds); break;
      case "SHIELD": this.player.shield = Math.max(this.player.shield, seconds); break;
      case "MULTI": this.power.multiplier = Math.max(this.power.multiplier, seconds); break;
    }
  },

  takeDamage(amount) {
    if (this.bossClear) return;
    if (this.player.shield > 0) {
      this.player.shield = Math.max(0, this.player.shield - amount * 0.1);
      this.screenShake(4);
      return;
    }
    this.player.hp -= amount;
    this.screenShake(12);
    this.flash = Math.max(this.flash, 0.35);
    this.damagePulse = 1;
    this.sfx.hit();
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.onGameOver();
    }
  },

  update(dt) {
    const cfg = LEVELS[this.levelIndex];

    // timers (effects decay lives in tickEffects, which the loop runs in every mode)
    this.levelT += dt;
    this.stepAmbient(dt);

    // powerups durations
    this.power.spread = Math.max(0, this.power.spread - dt);
    this.power.pierce = Math.max(0, this.power.pierce - dt);
    this.power.rapid = Math.max(0, this.power.rapid - dt);
    this.power.multiplier = Math.max(0, this.power.multiplier - dt);
    this.player.shield = Math.max(0, this.player.shield - dt);

    // Spawning
    const celebrating = !!this.bossClear;

    if (!this.inBoss && !celebrating) {
      this.spawnAcc += dt * cfg.spawnRate * (this.power.rapid > 0 ? 1.10 : 1.0);
      while (this.spawnAcc >= 1) { this.spawnAcc -= 1; this.spawnEnemy(); }

      this.powerAcc += dt;
      const puEvery = lerp(8.8, 6.4, (cfg.level - 1) / 9);
      if (this.powerAcc >= puEvery) { this.powerAcc = 0; this.spawnPowerup(); }

      // Enter boss after duration
      if (this.levelT >= cfg.duration) {
        this.beginBossFight();
      }
    } else if (this.inBoss) {
      // Boss: minions and hazards
      if (cfg.boss.minionRate > 0) {
        this.minionAcc += dt * cfg.boss.minionRate;
        while (this.minionAcc >= 1) {
          this.minionAcc -= 1;
          const letters = "abcdefghijklmnopqrstuvwxyz";
          const text = letters[randi(0, letters.length - 1)];
          this.enemies.push(new Enemy({ text, x: this.w + rand(0, 220), y: rand(150, this.h - 160), speed: cfg.baseSpeed * 1.2, kind: "bossMinion" }));
        }
      }

      // Hazards are simple: periodic "damage pulses" if boss is alive and player too slow
      this.hazardAcc += dt * cfg.boss.hazardRate;
      if (cfg.level >= 4 && this.hazardAcc >= 1.0) {
        this.hazardAcc = 0;
        // If player has low combo, hazard pings lightly
        if (this.stats.combo < 4 && Math.random() < 0.55) {
          this.takeDamage(6);
        }
      }
    }

    // Update enemies and powerups
    for (const en of this.enemies) {
      if (!en.alive) continue;
      en.update(dt);
      // If enemy reaches the player line, it damages.
      if (!celebrating && en.x < this.player.x + 35) {
        en.alive = false;
        this._leakLog.push(nowMs());
        this.takeDamage(12 + Math.min(12, en.text.length * 2));
        this.addExplosion(this.player.x + 40, en.y, 18);
        this.addExplosionSprite(this.player.x + 40, en.y, this.getExplosionTypeForEnemy(en));
      }
    }

    for (const p of this.powerups) {
      if (!p.alive) continue;
      p.update(dt);
      if (p.x < this.player.x + 60) {
        // Missed powerup, just despawn softly
        p.alive = false;
      }
    }

    // Boss update
    if (this.inBoss && this.boss) {
      this.boss.update(dt, this.h);
      this.ui.bossFill.style.width = `${Math.round(this.boss.hpFrac() * 100)}%`;
      const seg = this.boss.segmentIndex + 1;
      const total = this.boss.segments.length;
      this.ui.bossSegment.textContent = `segment ${Math.min(seg,total)}/${total}  •  ${this.boss.remaining}`;
    }

    // Bullets (visual only), particles, explosions: in-place compaction keeps object identity (F101)
    compactInPlace(this.bullets, b => (b.update(dt), b.alive()));
    compactInPlace(this.particles, p => (p.update(dt), p.alive()));
    compactInPlace(this.explosions, ex => (ex.update(dt), !ex.done));
    compactInPlace(this.enemies, e => e.alive);
    compactInPlace(this.powerups, p => p.alive);

    // Lock validity
    if (this.lock?.ref && !this.lock.ref.alive) this.lock = null;

    // autosave
    this.saveRun(false);

    // HUD
    this.updateHUD();

    if (this.bossClear) {
      this.bossClear.t += dt;
      while (this.bossFinaleBursts.length && this.bossFinaleBursts[0].time <= this.bossClear.t) {
        const burst = this.bossFinaleBursts.shift();
        this.runBossFinaleBurst(burst);
      }
      if (this.bossClear.t >= 6.3) {
        const info = this.bossClear;
        this.bossClear = null;
        this.bossFinaleBursts.length = 0;
        this.bossFinaleOrigin = null;
        if (info.target === "victory") this.onVictory();
        else this.onLevelComplete(info.bonus);
      }
    }

    if (this.bossIntro) {
      this.bossIntro.t += dt;
      if (this.bossIntro.t >= 2.6) this.bossIntro = null;
    }
  },
});
