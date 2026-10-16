// Type-R 198X — DOM HUD (PERF-09 diffing, VIS-08 ids). Methods are mixed into Game.prototype; load order is defined in index.html.
//
// Every DOM write goes through setText / setStyleVar / setAttr, which keep a per-element cache and only touch the DOM
// when the value changed. The hull and boss meters animate with transform: scaleX only; #bossBar is toggled on
// transitions (beginBossFight / endBossFight), never per frame.

const CHIP_ICON_PATHS = {
  SHIELD: "M6 1 L10.5 2.6 V6 C10.5 8.6 8.6 10.4 6 11.2 C3.4 10.4 1.5 8.6 1.5 6 V2.6 Z",
  MULTI:  "M2 2 L10 10 M10 2 L2 10",
  SPREAD: "M6 6 L1.5 2 M6 6 L10.5 2 M6 6 L1.5 10 M6 6 L10.5 10 M6 6 L6 1",
  PIERCE: "M1 6 H11 M8 3 L11 6 L8 9",
  RAPID:  "M7 1 L2.5 7 H6 L5 11 L9.5 5 H6 Z"
};
const WPM_WINDOW_S = 10;
const HUD_HIT_MS = 180;
const CHIP_LEAVE_MS = 160;
const BOSS_SEGMENT_CLEAR_MS = 160;

Object.assign(Game.prototype, {
  // ------------------------- Write primitives -------------------------
  setText(el, str) {
    if (!el) return false;
    const s = String(str);
    if (el._hudText === s) return false;
    el._hudText = s;
    el.textContent = s;
    return true;
  },

  setStyleVar(el, name, value) {
    if (!el) return false;
    const v = String(value);
    if (!el._hudVars) el._hudVars = {};
    if (el._hudVars[name] === v) return false;
    el._hudVars[name] = v;
    el.style.setProperty(name, v);
    return true;
  },

  setTransformScaleX(el, frac) {
    if (!el) return false;
    const v = `scaleX(${Math.round(clamp(frac, 0, 1) * 1000) / 1000})`;
    if (el._hudTransform === v) return false;
    el._hudTransform = v;
    el.style.transform = v;
    return true;
  },

  setAttr(el, name, value) {
    if (!el) return false;
    const v = value == null ? null : String(value);
    if (!el._hudAttrs) el._hudAttrs = {};
    if (el._hudAttrs[name] === v) return false;
    el._hudAttrs[name] = v;
    if (v === null) el.removeAttribute(name); else el.setAttribute(name, v);
    return true;
  },

  setClass(el, cls, on) {
    if (!el) return false;
    if (!el._hudClasses) el._hudClasses = {};
    const want = !!on;
    if (el._hudClasses[cls] === want) return false;
    el._hudClasses[cls] = want;
    el.classList.toggle(cls, want);
    return true;
  },

  // Lazy element cache: everything the contract names, null-guarded so the HUD runs on older markup.
  hudEls() {
    if (this._hudEls) return this._hudEls;
    const $ = (id) => document.getElementById(id);
    const stage = $("stageBar");
    this._hudEls = {
      hud: $("hud"),
      name: $("hudName"), level: $("hudLevel"), score: $("hudScore"), combo: $("hudCombo"), mult: $("hudMult"),
      acc: $("hudAcc"), wpm: $("hudWpm"), hp: $("hudHP"), hpMeter: $("hudHPMeter"), hpFill: $("hudHPFill"), hpGhost: $("hudHPGhost"),
      chips: $("hudChips"),
      bossBar: $("bossBar"), bossName: $("bossName"), bossPhase: $("bossPhase"), bossSegment: $("bossSegment"),
      bossMeter: $("bossMeter"), bossFill: $("bossFill"),
      stageBar: stage,
      stageSegs: stage ? [0, 1, 2].map((w) => stage.querySelector(`.stageSeg[data-wave="${w}"]`)) : [null, null, null],
      stageBoss: stage ? stage.querySelector(".stageSeg--boss") : null
    };
    return this._hudEls;
  },

  // ------------------------- Per-frame HUD -------------------------
  updateHUD() {
    const el = this.hudEls();
    const cfg = LEVELS[this.levelIndex];
    this.setText(el.name, this.save.playerName || "(unnamed)");
    this.setText(el.level, `${cfg.level}/10`);
    this.setText(el.score, formatInt(this.stats.score));
    this.setText(el.combo, String(this.stats.combo | 0));
    this.updateMultBadge();
    this.setText(el.acc, `${this.getAccuracyPct()}%`);
    this.setText(el.wpm, String(this.liveWpm()));
    this.updateHullMeter();
    this.updateStageBar();
    this.syncChips();
    if (this.inBoss && this.boss) this.refreshBossUI();
  },

  updateMultBadge() {
    const el = this.hudEls();
    const mult = this.stats.mult | 0 || 1;
    if (this.setText(el.mult, `x${mult}`) && el.mult) {
      this.setAttr(el.mult, "data-tier", clamp(mult, 1, 5));
      // .pop replays on every tier change; restart via the animation property (no forced layout).
      const badge = el.mult;
      badge.classList.add("pop");
      badge.style.animation = "none";
      requestAnimationFrame(() => { badge.style.animation = ""; });
    }
  },

  updateHullMeter() {
    const el = this.hudEls();
    const maxHp = Math.max(1, this.player.maxHp);
    const frac = clamp(this.player.hp / maxHp, 0, 1);
    const shield = this.player.shield > 0 ? ` +S${Math.ceil(this.player.shield)}` : "";
    this.setText(el.hp, `${Math.round(this.player.hp)}${shield}`);
    this.setTransformScaleX(el.hpFill, frac);
    this.setTransformScaleX(el.hpGhost, frac);
    this.setAttr(el.hpMeter, "aria-valuenow", Math.round(frac * 100));
    const state = frac <= DAMAGE.lowHp ? "crit" : frac <= DAMAGE.warnHp ? "warn" : "ok";
    this.setAttr(el.hud, "data-hp", state);
  },

  // #hud.is-hit for 180 ms after real HP damage (B4).
  flashHudHit() {
    const el = this.hudEls();
    if (!el.hud) return;
    el.hud.classList.add("is-hit");
    clearTimeout(this._hudHitTimer);
    this._hudHitTimer = setTimeout(() => el.hud.classList.remove("is-hit"), HUD_HIT_MS);
  },

  // #stageBar: one .stageSeg per wave (--p = waveKills/quota, .isDone when finished) + the boss segment, which
  // pulses (.isCharging) during the approach and fills with boss progress during the fight.
  updateStageBar() {
    const el = this.hudEls();
    if (!el.stageBar) return;
    const cfg = LEVELS[this.levelIndex];
    const wave = this.wave | 0;
    const phase = this.wavePhase;
    const waveDone = (w) => wave > w || ((phase === "approach" || phase === "boss" || phase === "finale") && wave >= w) || (wave === w && (phase === "drain" || phase === "banner") && this._waveFinished);
    for (let w = 0; w < 3; w++) {
      const seg = el.stageSegs[w];
      if (!seg) continue;
      const fill = seg.firstElementChild;
      const done = waveDone(w);
      let p = 0;
      if (done) p = 1;
      else if (wave === w) p = clamp(this.waveKills / Math.max(1, cfg.quota[w]), 0, 1);
      this.setStyleVar(fill, "--p", Math.round(p * 100) / 100);
      this.setClass(seg, "isDone", done);
    }
    const boss = el.stageBoss;
    if (boss) {
      const fill = boss.firstElementChild;
      this.setClass(boss, "isCharging", phase === "approach");
      let p = 0;
      if (this.inBoss && this.boss) p = clamp(1 - this.boss.hpFrac(), 0, 1);
      else if (phase === "finale" || this.bossClear) p = 1;
      this.setStyleVar(fill, "--p", Math.round(p * 100) / 100);
      this.setClass(boss, "isDone", !!this.bossClear || phase === "finale");
    }
  },

  // ------------------------- Boss UI -------------------------
  // Called from beginBossFight (full refresh) and from Boss.advance() paths; per-frame it only diffs.
  refreshBossUI(opts = {}) {
    const el = this.hudEls();
    const boss = this.boss;
    if (!boss) return;
    const n = boss.segments.length;
    const phases = Math.max(1, boss.phaseStarts.length);
    this.setText(el.bossName, boss.name);
    this.setText(el.bossPhase, `PHASE ${Math.min(boss.phase + 1, phases)}/${phases}`);
    this.setText(el.bossSegment, `SEG ${Math.min(boss.segmentIndex + 1, n)}/${n}`);
    const frac = boss.hpFrac();
    if (this.setTransformScaleX(el.bossFill, frac)) {
      this.setAttr(el.bossMeter, "aria-valuenow", Math.round(frac * 100));
    }
    this.setAttr(el.bossMeter, "data-state", `p${Math.min(boss.phase + 1, 4)}`);
    this.setClass(el.bossMeter, "isCharging", !!boss.surge);
    if (opts.full) {
      this.setStyleVar(el.bossMeter, "--segments", n);
      this.layoutBossPhaseTicks(boss);
    }
  },

  // .bossPhaseTick count = phaseStarts.length - 1 (2 for L1-9, 3 for L10), positioned at each phase start (B-11).
  layoutBossPhaseTicks(boss) {
    const el = this.hudEls();
    const meter = el.bossMeter;
    if (!meter) return;
    const starts = boss.phaseStarts.slice(1);
    const total = boss.totalChars || 1;
    let ticks = Array.from(meter.querySelectorAll(".bossPhaseTick"));
    while (ticks.length < starts.length) {
      const i = document.createElement("i");
      i.className = "bossPhaseTick";
      i.setAttribute("aria-hidden", "true");
      meter.appendChild(i);
      ticks.push(i);
    }
    while (ticks.length > starts.length) ticks.pop().remove();
    starts.forEach((segIdx, k) => {
      let chars = 0;
      for (let i = 0; i < segIdx; i++) chars += boss.segments[i].length;
      // The meter drains right-to-left (fill = hp fraction), so a phase boundary sits at 1 - charsBefore/total.
      const pct = Math.round((1 - chars / total) * 1000) / 10;
      this.setStyleVar(ticks[k], "--at", `${pct}%`);
    });
  },

  pulseBossSegmentClear() {
    const el = this.hudEls();
    if (!el.bossMeter) return;
    el.bossMeter.classList.add("segmentClear");
    clearTimeout(this._segClearTimer);
    this._segClearTimer = setTimeout(() => el.bossMeter.classList.remove("segmentClear"), BOSS_SEGMENT_CLEAR_MS);
  },

  showBossBar(show) {
    const el = this.hudEls();
    if (!el.bossBar) return;
    if (this._bossBarShown === !!show) return;
    this._bossBarShown = !!show;
    el.bossBar.classList.toggle("hidden", !show);
  },

  // ------------------------- Chips -------------------------
  // #hudChips .chip[data-type] in POWERUP_CHIP_ORDER (shield, multi, spread, pierce, rapid; REPAIR has no chip).
  // --p is written when it moved >= .01, .chipTime every .1 s (B-16 text), .expiring in the last 2 s, .is-leaving
  // for 160 ms before removal.
  syncChips() {
    const el = this.hudEls();
    const host = el.chips;
    if (!host) return;
    if (!this._chips) this._chips = {};
    if (!this.powerMax) this.powerMax = {};
    for (const id of POWERUP_CHIP_ORDER) {
      const def = POWERUP_TYPES[id];
      const remaining = id === "SHIELD" ? this.player.shield : (this.power[def.powerKey] || 0);
      let chip = this._chips[id];
      if (remaining > 0) {
        if (!chip) {
          chip = this.makeChip(id, def);
          this._chips[id] = chip;
          // Keep contract order: insert before the first existing chip that comes later in the order.
          let before = null;
          for (const other of POWERUP_CHIP_ORDER.slice(POWERUP_CHIP_ORDER.indexOf(id) + 1)) {
            const c = this._chips[other];
            if (c && c.el.parentNode === host && !c.leaving) { before = c.el; break; }
          }
          host.insertBefore(chip.el, before);
        } else if (chip.leaving) {
          clearTimeout(chip.timer);
          chip.leaving = false;
          chip.el.classList.remove("is-leaving");
          if (chip.el.parentNode !== host) host.appendChild(chip.el);
        }
        const maxT = Math.max(this.powerMax[id] || 0, remaining, def.duration || 1);
        this.powerMax[id] = maxT;
        const p = clamp(remaining / maxT, 0, 1);
        if (Math.abs(p - (chip.p ?? -1)) >= 0.01 || p === 0 || p === 1) {
          chip.p = p;
          chip.el.style.setProperty("--p", String(Math.round(p * 100) / 100));
        }
        const timeText = remaining < 10 ? remaining.toFixed(1) : String(Math.ceil(remaining));
        this.setText(chip.time, timeText);
        this.setClass(chip.el, "expiring", remaining <= 2);
      } else if (chip && !chip.leaving) {
        chip.leaving = true;
        chip.el.classList.add("is-leaving");
        this.powerMax[id] = 0;
        chip.timer = setTimeout(() => {
          if (chip.leaving) {
            chip.el.remove();
            if (this._chips[id] === chip) delete this._chips[id];
          }
        }, CHIP_LEAVE_MS);
      }
    }
  },

  makeChip(id, def) {
    const el = document.createElement("div");
    el.className = "chip";
    el.dataset.type = def.label;
    el.style.setProperty("--p", "1");
    el.style.setProperty("--accent", `var(--neon-${POWER_ACCENT[id] === "text" ? "cyan" : POWER_ACCENT[id]})`);
    const icon = document.createElement("i");
    icon.className = "chipIcon";
    icon.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="${CHIP_ICON_PATHS[id] || CHIP_ICON_PATHS.SHIELD}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    const label = document.createElement("span");
    label.className = "chipLabel";
    label.textContent = def.label;
    const time = document.createElement("span");
    time.className = "chipTime mono";
    el.append(icon, label, time);
    return { el, time, p: null, leaving: false, timer: null };
  },

  clearChips() {
    if (!this._chips) return;
    for (const id of Object.keys(this._chips)) {
      const c = this._chips[id];
      clearTimeout(c.timer);
      c.el.remove();
    }
    this._chips = {};
    this.powerMax = {};
  },

  // ------------------------- Stats helpers -------------------------
  getAccuracyPct() {
    if (this.stats.total <= 0) return 100;
    return Math.round((this.stats.correct / this.stats.total) * 100);
  },

  getLevelAccuracyPct() {
    const ls = this.levelStats || {};
    if (!(ls.total > 0)) return 100;
    return Math.round((ls.correct / ls.total) * 10000) / 100;
  },

  // Trailing-10 s characters x 6 / 5 (CONTRACT 7). The ring runs on the play clock, so a pause changes nothing.
  noteTypedChar() {
    if (!this.wpmRing) this.wpmRing = [];
    this.wpmRing.push(this.playClock || 0);
  },

  liveWpm() {
    const ring = this.wpmRing;
    if (!ring || !ring.length) return 0;
    const now = this.playClock || 0;
    while (ring.length && now - ring[0] > WPM_WINDOW_S) ring.shift();
    return Math.round(ring.length * 6 / 5);
  },

  // Characters still to type across every live enemy (pressure-valve input; also TypeRDebug.stats().liveChars).
  liveChars() {
    let n = 0;
    for (const en of this.enemies) if (en.alive && !en.dying) n += en.text.length - en.progress;
    return n;
  },

  // TypeRDebug.stats(): trailing-window telemetry for the balance pass and the harness (B-15).
  debugStats() {
    const now = nowMs();
    const spawnLog = this._spawnLog || [];
    const leakLog = this._leakLog || [];
    while (spawnLog.length && now - spawnLog[0].t > 10000) spawnLog.shift();
    while (leakLog.length && now - leakLog[0] > 60000) leakLog.shift();
    let chars = 0;
    for (const s of spawnLog) chars += s.n;
    return {
      incomingCps: Math.round((chars / 10) * 100) / 100,
      leaksPerMin: leakLog.length,
      deathsBySector: { ...(this.deathsBySector || {}) },
      liveChars: this.liveChars()
    };
  },
});
