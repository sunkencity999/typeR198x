// Type-R 198X — typing input, lock acquisition, combo/multiplier. Methods are mixed into Game.prototype; load order is defined in index.html.
Object.assign(Game.prototype, {
  // isEntityVisible is the lock-acquisition visibility filter used by handleTyped.

  // ------------------------- Typing -------------------------
  handleTyped(ch) {
    if (this.bossClear) return;
    this.stats.total++;

    // Boss priority: if inBoss, we type against boss (lock implied).
    if (this.inBoss && this.boss) {
      const expect = this.boss.nextChar;
      if (ch === expect) {
        this.stats.correct++;
        this.stats.combo++;
        this.bumpMultiplier();

        this.fireLaserTo(this.boss.x - 140, this.boss.y + 10, "cyan");
        this.sfx.laser();
        this.sfx.hit();

        this.boss.advance();
        this.addSparks(this.boss.x - 180, this.boss.y + rand(-40, 40), 10);

        // segment change hint
        this.ui.bossSegment.textContent = `segment ${Math.min(this.boss.segmentIndex + 1, this.boss.segments.length)}/${this.boss.segments.length}  •  ${this.boss.remaining}`;

        if (this.boss.done) {
          // boss defeated
          const centerX = this.boss.x - 150;
          const centerY = this.boss.y;
          this.sfx.explosion();
          this.screenShake(10);
          this.addExplosion(centerX, centerY, 120);
          this.sfx.bossExplosion();
          for (let i = 0; i < 9; i++) {
            this.addExplosionSprite(
              centerX + rand(-140, 140),
              centerY + rand(-120, 120),
              "large"
            );
          }
          for (let i = 0; i < 6; i++) {
            this.addExplosionSprite(
              centerX + rand(-220, 220),
              centerY + rand(-200, 200),
              "medium"
            );
          }

          this.endBossFight(true);

          // Level complete / unlock next
          const completedLevel = LEVELS[this.levelIndex].level;
          const nextUnlocked = Math.max(this.save.lastUnlockedLevel || 1, Math.min(10, completedLevel + 1));
          this.save.lastUnlockedLevel = nextUnlocked;

          // bonus
          const bonus = 2500 + completedLevel * 450;
          this.stats.score += bonus;
          const target = (this.levelIndex >= 9) ? "victory" : "level";
          this.bossClear = {
            t: 0,
            target,
            bonus,
            level: completedLevel,
            bossName: LEVELS[this.levelIndex].boss.name,
            levelIndex: this.levelIndex,
            nextLevelIndex: target === "level" ? Math.min(this.levelIndex + 1, 9) : null
          };
          this.startBossFinale(centerX, centerY);
        }
      } else {
        this.onWrongKey();
      }

      return;
    }

    // If we have a lock, try to type into it
    if (this.lock?.ref && this.lock.ref.alive) {
      const ref = this.lock.ref;
      const expect = ref.nextChar();
      if (ch === expect) {
        this.onCorrectKey(ref);
      } else {
        this.onWrongKey();
      }
      return;
    }

    // Acquire a new lock: check powerups first (reward), then enemies.
    const candPower = this.powerups
      .filter(p => p.alive && this.isEntityVisible(p) && p.nextChar() === ch)
      .sort((a,b) => a.x - b.x)[0];

    if (candPower) {
      this.lock = { kind: "powerup", ref: candPower };
      candPower.locked = true;
      this.onCorrectKey(candPower);
      return;
    }

    const candEnemy = this.enemies
      .filter(en => en.alive && this.isEntityVisible(en) && en.nextChar() === ch)
      .sort((a,b) => a.x - b.x)[0];

    if (candEnemy) {
      this.lock = { kind: "enemy", ref: candEnemy };
      candEnemy.locked = true;
      this.onCorrectKey(candEnemy);
      return;
    }

    this.onWrongKey(true);
  },

  onCorrectKey(ref) {
    this.stats.correct++;
    this.stats.combo++;
    this.bumpMultiplier();

    // Fire visuals
    const beamColor = this.power.multiplier > 0 ? "lime" : (this.power.spread > 0 ? "magenta" : "cyan");
    this.fireLaserTo(ref.x, ref.y, beamColor);
    this.sfx.laser();
    ref.progress++;
    ref.flash = 0.18;

    const isDone = (ref.kind === "powerup")
      ? (ref.progress >= ref.label.length)
      : (ref.progress >= ref.text.length);

    if (isDone) {
      // Resolve
      if (ref.kind === "powerup") {
        this.collectPowerup(ref);
      } else {
        this.killEnemy(ref);
      }
      this.lock = null;
    } else {
      // Mild hit feedback
      if (ref.kind !== "powerup") this.sfx.hit();
      this.addSparks(ref.x, ref.y, 6);
    }
  },

  onWrongKey(noTarget = false) {
    // Break combo
    this.stats.combo = 0;
    this.stats.mult = 1;
    this.sfx.error();
    this.flash = 0.08;

    // Optional small penalty when typing truly wrong (but not too harsh)
    if (!noTarget) {
      this.stats.score = Math.max(0, this.stats.score - 15);
    }

    // If we had a lock on something, keep lock (so user can recover) in early levels.
    // In later levels, drop lock sometimes.
    const lvl = LEVELS[this.levelIndex].level;
    if (this.lock?.ref && lvl >= 6 && Math.random() < 0.35) {
      this.lock.ref.locked = false;
      this.lock = null;
    }
  },

  bumpMultiplier() {
    // using combo brackets + active multiplier powerup
    const base = this.stats.combo >= 30 ? 3 : this.stats.combo >= 15 ? 2 : 1;
    const pu = this.power.multiplier > 0 ? 2 : 1;
    this.stats.mult = base * pu;
  },

  isEntityVisible(obj, padding = 20) {
    if (!obj) return false;
    const x = obj.x ?? 0;
    const y = obj.y ?? 0;
    const radius = obj.radius ?? 20;
    return (x + radius) >= -padding && (x - radius) <= (this.w + padding) && y >= -padding && y <= (this.h + padding);
  },
});
