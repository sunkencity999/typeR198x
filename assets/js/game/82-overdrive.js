// Type-R 198X — ARCADE track (D11): Overdrive, a burst meter relative to the pilot's own speed (white arc on the shield
// ring, white-hot beams, plume x2, amber floaters, +25 % on kill / boss-letter / segment score, vent on any hard miss, leak
// or surge hit) and pilotWpm(). Loads after 80-fx.js. Hooks consumed: keyCorrect, typistInterval, keyMiss, lockRelease,
// leak, tick, modeChange, sectorStart, runWillStart, scoreWillAdd, results, checkpoint, checkpointRestored, counterSignal,
// bossKill; emitted: overdrive. Top-level names OVERDRIVE / OD_*. Off in Drill and during the Flight Check.
//
// Model (spec-arcade 3): T = max(1.05 x the pilot's run speed (else lifetime), 25 WPM). The burst is the speed of the
// qualifying intervals (MEASURE's typistInterval; an own D1 chain from keyCorrect when MEASURE is absent) that ended in
// the last 2.5 s of ENGAGED time (something typable on screen, not paused / card / intro / finale), with the open interval
// counted once it is slower than the average. A charge fills at 1/2 s while the burst >= T (drains .5/s below it); full ->
// OVERDRIVE. It ends on a hard miss, a leak or a surge hit (vent) or after 1 s of engaged time below 0.9 T (slow). Per
// key and per frame: typed arrays, one state object, reused payloads, no allocation, no save write.
const OVERDRIVE = Object.freeze({
  windowS: 2.5, minIntervals: 4, minIntervalMs: 25, maxWpm: 400,
  thresholdMul: 1.05, floorWpm: 25, runMin: 20, liveMin: 10, liveN: 30, gapMaxMs: 1500,
  fillS: 2.0, drainPerS: 0.5, exitMul: 0.9, exitBelowS: 1.0,
  acquireGraceMs: 600, staleOpenMs: 1500, refreshS: 1.0,
  scoreMul: 1.25, scoreKinds: Object.freeze({ kill: 1, bossChar: 1, segment: 1 }),
  arcGap: 12, arcW: 2.5, arcHaloW: 7, arcHaloAlpha: 0.22, arcAlpha: 0.92, arcTrackAlpha: 0.10, arcChargeAlpha: 0.65,
  arcPulseHz: 1.5, arcPulseAmp: 0.15, ventS: 0.25, ventParticles: 10, ventDangerAlpha: 0.7, ventTextAlpha: 0.5
});
const OD_RING_N = 64;                                                   // power of two (index mask)
const OD_MEASURE = typeof Game.prototype.typistSpeed === "function";   // MEASURE (32-typist.js) loaded earlier
const OD_EVT = { on: false, reason: "", ms: 0 };                          // reused "overdrive" payload
const OD_TEXT = PALETTE.rgba("text", 1);
const OD_DANGER = PALETTE.rgba("danger", 1);
const OD_TAU = Math.PI * 2;

Object.assign(Game.prototype, {
  // ------------------------- State -------------------------
  odState() {
    let S = this._od;
    if (!S) {
      S = this._od = {
        enabled: true, on: false, charge: 0, below: 0, threshold: OVERDRIVE.floorWpm, burst: NaN, clock: 0, open: 0, chainLive: false,
        endAt: new Float64Array(OD_RING_N), ms: new Float64Array(OD_RING_N), head: 0, count: 0, lastRef: null, lastT: 0, runN: 0, runMs: 0,
        refreshAcc: 0, ventT: 0, ventFrom: 0, ventDanger: false, activations: 0, lastReason: "", arcDraws: 0, arcAlpha: 0
      };
    }
    return S;
  },

  // Live state for probes and the effect hunks (read-only by contract).
  overdriveState() {
    return this.odState();
  },

  // Probes / debug (not persisted): false ends Overdrive silently and blocks charging.
  setOverdriveEnabled(on) {
    const S = this.odState();
    S.enabled = !!on;
    if (!S.enabled) this.odEnd("disabled", false);
    return S.enabled;
  },

  // Drill (MODES, no score) and the Flight Check (ONBOARD, run === null) never charge.
  odBlocked() {
    if (this.runMode() === "drill") return true;
    if (this.flightCheck) return true;
    return typeof this.isFlightCheckActive === "function" && this.isFlightCheckActive();
  },

  // Typing is possible right now: something typable on screen and nothing holding the field (pause, sector card, wave
  // banner over an empty field, approach, boss intro, finale all hold the meter). Capsules do not count.
  odEngaged() {
    if (this.mode !== "playing" || this.bossClear) return false;
    if (typeof this.inputLockedOut === "function" && this.inputLockedOut()) return false;
    if (this.inBoss && this.boss) return !(this.bossIntro && this.bossIntro.locked);
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const en = list[i];
      if (en.alive && !en.dying && this.isTargetable(en)) return true;
    }
    return false;
  },

  // ------------------------- Speed -------------------------
  // pilotWpm(scope) -> number | null. live / run / lifetime from MEASURE (typistSpeed) when present, else the own chain
  // (live: the ring's last 30, run: the run's intervals; lifetime unknown); base = run ?? lifetime; window = live ?? base.
  pilotWpm(scope = "live") {
    if (scope === "base") {
      const r = this.pilotWpm("run");
      return r !== null ? r : this.pilotWpm("lifetime");
    }
    if (scope === "window") {
      const l = this.pilotWpm("live");
      return l !== null ? l : this.pilotWpm("base");
    }
    if (typeof this.typistSpeed === "function") {
      const sc = scope === "run" ? "run" : scope === "lifetime" ? "lifetime" : "live";
      const s = this.typistSpeed(sc);
      const w = s ? Number(s.wpm) : NaN, n = s ? (s.n | 0) : 0;
      if (!(w > 0)) return null;
      if (sc === "run" && n < OVERDRIVE.runMin) return null;
      if (sc === "live" && n < OVERDRIVE.liveMin) return null;
      return w;
    }
    const S = this.odState();
    if (scope === "run") return S.runN >= OVERDRIVE.runMin && S.runMs > 0 ? 12000 * S.runN / S.runMs : null;
    if (scope === "lifetime") return null;
    const n = S.count < OVERDRIVE.liveN ? S.count : OVERDRIVE.liveN;
    if (n < OVERDRIVE.liveMin) return null;
    let sum = 0, idx = S.head;
    for (let i = 0; i < n; i++) { idx = (idx - 1) & (OD_RING_N - 1); sum += S.ms[idx]; }
    return sum > 0 ? 12000 * n / sum : null;
  },

  odThreshold() {
    const b = this.pilotWpm("base");
    return Math.max(OVERDRIVE.thresholdMul * (b > 0 ? b : 0), OVERDRIVE.floorWpm);
  },

  // One qualifying interval into the burst ring (ignored under 25 ms: scripted input / key chatter). own = the
  // fallback chain (MEASURE absent), which also keeps the run accumulators.
  odPushInterval(ms, own) {
    const S = this.odState();
    if (own && ms >= 10) { S.runN++; S.runMs += ms; }
    if (!(ms >= OVERDRIVE.minIntervalMs)) return false;
    const i = S.head;
    S.ms[i] = ms;
    S.endAt[i] = S.clock;
    S.head = (i + 1) & (OD_RING_N - 1);
    if (S.count < OD_RING_N) S.count++;
    return true;
  },

  // Burst WPM over the engaged window: n >= 4 entries -> 12000 n / sum, or with the open interval when it is longer than
  // the mean; fewer -> 0 once the open interval is stale (> 1.5 s), else NaN (undefined: the meter holds). No allocation.
  odBurst() {
    const S = this._od;
    const from = S.clock - OVERDRIVE.windowS;
    let n = 0, sum = 0, idx = S.head;
    for (let i = 0; i < S.count; i++) {
      idx = (idx - 1) & (OD_RING_N - 1);
      if (S.endAt[idx] < from) break;
      n++; sum += S.ms[idx];
    }
    const openEff = S.chainLive ? S.open : Math.max(0, S.open - OVERDRIVE.acquireGraceMs);
    if (n >= OVERDRIVE.minIntervals) {
      const w = openEff > sum / n ? 12000 * (n + 1) / (sum + openEff) : 12000 * n / sum;
      return w < OVERDRIVE.maxWpm ? w : OVERDRIVE.maxWpm;
    }
    return openEff > OVERDRIVE.staleOpenMs ? 0 : NaN;
  },

  // ------------------------- Meter (tick) -------------------------
  odTick(dt) {
    const S = this.odState();
    if (!S.enabled || this.odBlocked()) { if (S.on || S.charge) this.odEnd("mode", false); return; }
    const ts = this.timeScale;
    let raw = (ts > 0 && ts < 1) ? dt / ts : dt;   // typing is wall time: hit-stop must not slow the meter
    if (raw > 0.05) raw = 0.05;
    if (S.ventT > 0) S.ventT = Math.max(0, S.ventT - raw);
    if (!this.odEngaged()) return;
    S.clock += raw;
    S.open += raw * 1000;
    const b = S.burst = this.odBurst();
    const T = S.threshold;
    if (!S.on) {
      if (b === b) S.charge = clamp(S.charge + (b >= T ? raw / OVERDRIVE.fillS : -OVERDRIVE.drainPerS * raw), 0, 1);
      if (S.charge >= 1) this.odActivate();
      else if (S.charge === 0 && (S.refreshAcc += raw) >= OVERDRIVE.refreshS) { S.refreshAcc = 0; S.threshold = this.odThreshold(); }
    } else {
      const ms = raw * 1000;
      if (this.levelStats) this.levelStats.overdriveMs = (Number(this.levelStats.overdriveMs) || 0) + ms;
      if (this.stats) this.stats.overdriveMs = (Number(this.stats.overdriveMs) || 0) + ms;
      if (b === b) {
        if (b >= OVERDRIVE.exitMul * T) S.below = 0;
        else if ((S.below += raw) >= OVERDRIVE.exitBelowS) this.odEnd("slow", true);
      }
    }
  },

  odActivate() {
    const S = this.odState();
    S.on = true; S.charge = 1; S.below = 0; S.activations++;
    this.overdriveOn = true;
    if (typeof this.showBanner === "function") this.showBanner({ kind: "callout", title: "OVERDRIVE", color: "text" });
    if (this.sfx && typeof this.sfx.overdrive === "function") this.sfx.overdrive();
    // First activation on this save: one tip (the flag rides the next autosave), then the one announcement.
    const save = this.save;
    let first = false;
    if (save && !(save.tutorialSeen && save.tutorialSeen.overdrive)) {
      first = true;
      if (typeof this.showToast === "function") this.showToast("OVERDRIVE — FAST AND CLEAN PAYS +25% · ANY MISS VENTS IT", { kind: "tip", key: "tut", ms: 3500 });
      if (save.tutorialSeen && typeof save.tutorialSeen === "object") save.tutorialSeen.overdrive = true;
      else save.tutorialSeen = { overdrive: true };
    }
    if (typeof this.announce === "function") this.announce(first ? "Overdrive. Fast and clean pays 25 percent more; any miss vents it." : "Overdrive.");
    OD_EVT.on = true; OD_EVT.reason = "burst"; OD_EVT.ms = (this.levelStats && this.levelStats.overdriveMs) | 0;
    this.hook("overdrive", OD_EVT);
  },

  // End Overdrive or drop a charge. vent: the arc shrinks out (danger when Overdrive was on, with the hiss, the
  // announcement and steam); a charge reset is silent.
  odEnd(reason, vent) {
    const S = this._od;
    if (!S || (!S.on && S.charge === 0)) return false;
    const wasOn = S.on;
    S.ventFrom = wasOn ? clamp(1 - S.below / OVERDRIVE.exitBelowS, 0, 1) : S.charge;
    S.on = false; S.charge = 0; S.below = 0; S.lastReason = reason;
    this.overdriveOn = false;
    if (vent) {
      S.ventT = OVERDRIVE.ventS;
      S.ventDanger = wasOn;
      if (wasOn) {
        if (this.sfx && typeof this.sfx.overdriveVent === "function") this.sfx.overdriveVent();
        if (typeof this.announce === "function") this.announce("Overdrive vented.");
        this.odSteam();
      }
    }
    if (wasOn) {
      OD_EVT.on = false; OD_EVT.reason = reason; OD_EVT.ms = (this.levelStats && this.levelStats.overdriveMs) | 0;
      this.hook("overdrive", OD_EVT);
    }
    return true;
  },

  // Vent steam: 10 text particles off the ship (full motion only; rare event).
  odSteam() {
    if (typeof this.pushParticle !== "function" || typeof Particle !== "function") return;
    if (typeof this.fxMotion === "function" && !(this.fxMotion().anim > 0)) return;
    const pose = this._shipPose;
    const cx = pose ? pose.cx + pose.dx : this.player.x, cy = pose ? pose.cy + pose.bob : this.player.y;
    for (let i = 0; i < OVERDRIVE.ventParticles; i++) {
      this.pushParticle(new Particle({ x: cx - 20 + rand(-10, 10), y: cy + rand(-20, 20), vx: rand(-160, -60), vy: rand(-140, -40),
        life: rand(0.3, 0.5), size: rand(2, 4), color: "text", drag: 3 }));
    }
  },

  // Sector start (and a new run): meter, ring and open interval to zero, threshold refreshed; run accumulators only
  // on a new run.
  odReset(newRun) {
    const S = this.odState();
    if (S.on || S.charge) this.odEnd("reset", false);
    S.on = false; S.charge = 0; S.below = 0; S.head = 0; S.count = 0; S.open = 0; S.chainLive = false;
    S.lastRef = null; S.lastT = 0; S.refreshAcc = 0; S.ventT = 0; S.burst = NaN;
    if (newRun) { S.runN = 0; S.runMs = 0; }
    this.overdriveOn = false;
    S.threshold = this.odThreshold();
  },

  // ------------------------- Effects -------------------------
  // Score floaters (scaffold P8): amber in Overdrive, else the combo tier colour.
  scoreFloaterColor() {
    if (this.overdriveOn === true) return "amber";
    return typeof this.tierColor === "function" ? this.tierColor((this.stats && this.stats.mult) | 0) : "text";
  },

  // The arc on the shield ring (75-fx-draw.js drawShipAdditive, inside the additive batch): charging = a faint track and
  // the charge; active = a white-hot ring whose sweep is the exit warning (1 - below / 1 s), pulsing 1.5 Hz with full
  // motion; venting = the arc shrinking out over .25 s (danger after Overdrive, text after a charge).
  drawOverdriveArc(ctx, pose) {
    const S = this._od;
    if (!S || !pose) return;
    const venting = S.ventT > 0 && !S.on;
    if (!S.on && !(S.charge > 0) && !venting) return;
    const sh = (typeof FX_MOTION === "object" && FX_MOTION.shield) || null;
    const R = (sh && typeof sh.r === "number" ? sh.r : 66) + OVERDRIVE.arcGap;
    const cx = pose.cx + pose.dx, cy = pose.cy + pose.bob;
    const a0 = -Math.PI / 2;
    const ga = ctx.globalAlpha;
    ctx.lineCap = "round";
    let shown = 0;
    if (S.on) {
      const pulse = this.reduceMotion ? 1 : 1 - OVERDRIVE.arcPulseAmp + OVERDRIVE.arcPulseAmp * Math.sin(OD_TAU * OVERDRIVE.arcPulseHz * (this.fxClock || 0));
      const sweep = OD_TAU * clamp(1 - S.below / OVERDRIVE.exitBelowS, 0, 1);
      ctx.strokeStyle = OD_TEXT;
      ctx.lineWidth = OVERDRIVE.arcHaloW;
      ctx.globalAlpha = ga * OVERDRIVE.arcHaloAlpha * pulse;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + sweep); ctx.stroke();
      ctx.lineWidth = OVERDRIVE.arcW;
      shown = OVERDRIVE.arcAlpha * pulse;
      ctx.globalAlpha = ga * shown;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + sweep); ctx.stroke();
    } else if (S.charge > 0) {
      ctx.strokeStyle = OD_TEXT;
      ctx.lineWidth = OVERDRIVE.arcW;
      ctx.globalAlpha = ga * OVERDRIVE.arcTrackAlpha;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, OD_TAU); ctx.stroke();
      shown = OVERDRIVE.arcChargeAlpha;
      ctx.globalAlpha = ga * shown;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + OD_TAU * S.charge); ctx.stroke();
    }
    if (venting) {
      const k = S.ventFrom * S.ventT / OVERDRIVE.ventS;
      if (k > 0) {
        ctx.strokeStyle = S.ventDanger ? OD_DANGER : OD_TEXT;
        ctx.lineWidth = OVERDRIVE.arcW;
        shown = S.ventDanger ? OVERDRIVE.ventDangerAlpha : OVERDRIVE.ventTextAlpha;
        ctx.globalAlpha = ga * shown;
        ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + OD_TAU * k); ctx.stroke();
      }
    }
    ctx.globalAlpha = ga;
    ctx.lineCap = "butt";
    S.arcDraws++;
    S.arcAlpha = shown;
  }
});

// ----------------------------- Listeners (registration order = script order: after MEASURE and 50-boss) -----------------------------
if (typeof onGameHook === "function") {
  onGameHook("tick", function (e) { this.odTick(e.dt); });

  // Intervals: MEASURE's qualifying intervals (D1 rule) when present.
  onGameHook("typistInterval", function (e) {
    const S = this.odState();
    if (!S.enabled || this.odBlocked()) return;
    this.odPushInterval(e.ms, false);
  });

  // Every correct key resets the open interval (first keys and minions included); without MEASURE the own D1 chain.
  onGameHook("keyCorrect", function (e) {
    const S = this.odState();
    if (!S.enabled || this.odBlocked()) return;
    if (!OD_MEASURE) {
      if (!e.first && e.ref === S.lastRef && e.kind !== "powerup" && (e.t - S.lastT) <= OVERDRIVE.gapMaxMs) this.odPushInterval(e.t - S.lastT, true);
      S.lastRef = e.last ? null : e.ref;
      S.lastT = e.t;
    }
    S.open = 0;
    S.chainLive = !e.last;
  });

  onGameHook("lockRelease", function () { const S = this._od; if (S) S.lastRef = null; });
  onGameHook("keyMiss", function () { this.odEnd("miss", true); });
  onGameHook("leak", function () { this.odEnd("leak", true); });
  onGameHook("counterSignal", function (e) { if (e && e.result === "fired") this.odEnd("surge", true); });   // a surge hit vents like a leak
  onGameHook("bossKill", function () { this.odEnd("boss", false); });
  onGameHook("modeChange", function (e) {
    const S = this._od;
    if (!S) return;
    S.lastRef = null;   // pause / blur restart the fallback chain
    if (e.to !== "playing" && e.to !== "paused") this.odEnd("mode", false);   // results, menu, game over: silent, time banked
  });
  onGameHook("sectorStart", function () { this.odReset(false); });
  onGameHook("runWillStart", function (e) { if (e && e.hold) return; this.odReset(true); });

  // +25 % on kill / bossChar / segment score while active; never pickups or bonuses.
  onGameHook("scoreWillAdd", function (e) {
    if (this.overdriveOn === true && OVERDRIVE.scoreKinds[e.kind] === 1) e.mul *= OVERDRIVE.scoreMul;
  });

  // Card note OVERDRIVE n S (sector cards: this sector; the run card: the whole run).
  onGameHook("results", function (e) {
    const r = e && e.results;
    if (!r) return;
    const src = e.scope === "run" ? this.stats : this.levelStats;
    const s = Math.round(((src && Number(src.overdriveMs)) || 0) / 1000);
    r.overdriveS = s;
    if (s >= 1 && Array.isArray(r.notes)) r.notes.push({ id: "overdrive", text: `OVERDRIVE ${s} S`, aria: `Overdrive: ${s} seconds.` });
  });

  onGameHook("checkpoint", function (e) {
    if (e && e.kind === "boss" && e.cp) e.cp.lvOverdriveMs = Math.round(Number(this.levelStats && this.levelStats.overdriveMs) || 0);
  });
  onGameHook("checkpointRestored", function (e) {
    const cp = e && e.cp;
    if (cp && cp.kind === "boss" && this.levelStats) this.levelStats.overdriveMs = Math.max(0, Number(cp.lvOverdriveMs) || 0);
  });
}
