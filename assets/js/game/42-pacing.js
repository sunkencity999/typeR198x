// Type-R 198X — PACE track (D2 / D3): pace follows the pilot (paceMul per wave into this.waveTuning), PERFECT WAVE by
// quota only, WAVE TIMED OUT with quota carry, hull carry from sector 4, the Cadet assist and the diff() row. Loads after
// 40-combat.js. Hooks consumed: waveWillStart, waveWillEnd, waveDrained, levelWillStart, checkpointRestored,
// clearWillRepair, results, recordWillSave, gameOverWillShow, levelCompleteWillShow, sectorCardWillShow (plus
// bossWillApproach: a wave-3 timeout whose drain the sector clock cuts short still gets its callout). Top-level names
// PACE* / pace*. No per-frame code, no canvas drawing, no save writes of its own (run.pace rides the existing save points).
//
// Pace (D2): at every wave boundary paceMul = clamp(0.85 x pilotCps / targetCps, 1.0, 2.5), moving at most 0.35 from
// the previous wave of the run; pilotCps = MEASURE's run speed (>= 20 intervals), else the profile's lifetime speed
// (>= 60 intervals, so a Flight Check alone never moves a fresh pilot's S1 W1 off 1.0), else the table. The wave's
// tuning (scaffold, 40-combat.js beginWave) gets quota x mul (+ escaped carry), spawn rate x mul, maxEnemies +
// min(3, round(2 (mul - 1))), plate speed x (1 + 0.15 (mul - 1)) and, from paceMul 1.35, an empty-field top-up to 2 alive.
// Stakes (D3, lead ruling Z5): a wave's cap is computed from its quota and stream (>= delivery x 1.25 + 4 s, never below
// the table), and the cap times a wave out only with plates alive (40-combat.js), so a pilot who kills everything that
// spawns never times out. A timed-out wave pays no PERFECT WAVE and plays no clear sting; its N plates leave the field at
// once (they warp off, no explosion, no damage) and at the drain end "WAVE TIMED OUT · N ESCAPED" counts them into the
// next wave of the sector. Clears of sectors 4-9 repair half of the missing hull and carry the rest. Cadet (D2): from the second death in one sector the Game Over
// card offers "Fly at Cadet pace" (stream x0.75, damage x0.75, score x0.8, tag CADET) until that sector is cleared.

// ----------------------------- Tuning: every PACE number (the balance re-pass retunes here) -----------------------------
// Also PACE-owned, in 20-constants.js because the scaffold spawner reads them directly: HUNGRY_SPAWN_S (0.1 s) and
// SPAWN_ROLLIN_PX ([10, 30] px). Binding (D2, not knobs): pilotFactor, mulMin, mulMax, stepMax, runMinIntervals, the
// tuning formulas, the Cadet row. Knobs in the order spec-pace 14.3 allows: hungryMin2AtMul (never below 1.3),
// SPAWN_ROLLIN_PX[1] (30 -> 20), profileMinIntervals (60 -> 40).
const PACE = {
  pilotFactor: 0.85,          // D2: target paceMul = 0.85 x pilotCps / targetCps
  mulMin: 1.0,                // never below 1.0 automatically
  mulMax: 2.5,
  stepMax: 0.35,              // max change of paceMul per wave boundary
  runMinIntervals: 20,        // MEASURE run speed counts from 20 qualifying intervals this run
  profileMinIntervals: 60,    // the lifetime speed counts once the profile holds 60 intervals (Flight Check: 5-15)
  maxEnemiesPerMul: 2,        // maxEnemies + min(3, round(2 x (paceMul - 1)))
  maxEnemiesAddMax: 3,
  speedPerMul: 0.15,          // plate speed x (1 + 0.15 x (paceMul - 1))
  hungryMin2AtMul: 1.35,      // knob (C4 / R29): from this paceMul the empty-field rule tops the field up to 2 alive.
                              // Spec 1.5 -> 1.35 (balance pass, spec 14.3 knob 1): a returning pilot's first wave runs at
                              // 1.35 and read 13-19 % S1 idle at 1.5 (target 15 %); the 35 WPM pilot's S2 peaks at 1.34.
  cadetMul: 0.75,             // CADET: paceMul fixed at 0.75
  cadetDamage: 0.75,
  cadetScore: 0.8,
  cadetAfterDeaths: 2,        // the offer appears from the 2nd death in the same sector (this run)
  hullCarryFromLevel: 4,      // clears of sectors 4..9 carry hull; clears of 1..3 refill; 10 is the victory
  hullRepairFrac: 0.5,        // a carrying clear repairs 50 % of the missing hull fraction
  timeoutCalloutS: 1.6,       // WAVE TIMED OUT callout duration
  capDeliveryMul: 1.25,       // Z5: wave cap >= stream delivery of the quota x 1.25 + 4 s, never below the table cap
  capMarginS: 4,
  paceTagMin: 1.1,            // results tag "PACE xN.N" when the sector's mean paceMul is at least this
  pinMin: 0.5                 // pacePin (probes) lower bound; the normaliser accepts the same range
};
const PACE_DIFF_STANDARD = Object.freeze({ id: "standard", score: 1, damage: 1 });
const PACE_DIFF_CADET = Object.freeze({ id: "cadet", score: PACE.cadetScore, damage: PACE.cadetDamage });

// Copy (spec-pace 16.1). Every line that shows also reaches announce().
const PACE_COPY = {
  timeout: (n) => (n > 0 ? `WAVE TIMED OUT · ${n} ESCAPED` : "WAVE TIMED OUT"),
  timeoutSay: (w, n, carried) => (n > 0 ? `Wave ${w + 1} timed out. ${n} escaped${carried ? ` and join wave ${w + 2}` : ""}.` : `Wave ${w + 1} timed out.`),
  hullLine: (pct, rep) => (rep > 0 ? `HULL ${pct}% · REPAIRED +${rep}%` : `HULL ${pct}%`),
  hullSay: (pct, rep) => (rep > 0 ? `Hull ${pct} percent, repaired ${rep} percent.` : `Hull ${pct} percent.`),
  hullSuffix: (pct, rep) => ` · Hull ${pct}% (+${rep}% repaired)`,
  hullNote: (pct) => `Hull ${pct} percent after repairs.`,
  cadetLine: "CADET PACE",
  cadetSay: "Cadet pace.",
  cadetFlown: "Flown at Cadet pace.",
  cadetOffer: (L) => `Cadet pace for Sector ${L}: 75% stream and damage, 80% score, tagged CADET.`,
  cadetStays: (L) => `Cadet pace stays on until Sector ${L} is cleared.`,
  cadetOfferSay: "Cadet pace available: 75 percent stream and damage, 80 percent score.",
  cadetToast: (L) => `CADET PACE · UNTIL SECTOR ${L} IS CLEARED`,
  cadetRow: "Cadet pace",
  cadetTag: "CADET",
  paceTag: (mean) => `PACE x${mean.toFixed(1)}`,
  paceTagSay: (x) => `Pace ${x} times the standard stream.`
};

// run.pace objects already normalised in this page session (a reload parses new objects, so they are checked again).
const PACE_SEEN = new WeakSet();

// ----------------------------- Pure helpers (probes and MODES may call them) -----------------------------
function paceRound2(x) {
  return Math.round(x * 100) / 100;
}

// D2 target, unrounded: clamp(0.85 x pilotCps / targetCps, 1.0, 2.5); 1.0 when either speed is unknown.
function paceTargetMul(pilotCps, targetCps) {
  if (!(pilotCps > 0) || !(targetCps > 0)) return PACE.mulMin;
  return clamp(PACE.pilotFactor * pilotCps / targetCps, PACE.mulMin, PACE.mulMax);
}

// One wave boundary: move from prev toward target by at most stepMax, inside [1.0, 2.5], two decimals.
function paceStepMul(prev, target) {
  const p = Number.isFinite(prev) && prev > 0 ? prev : PACE.mulMin;
  const t = Number.isFinite(target) ? target : PACE.mulMin;
  return paceRound2(clamp(clamp(t, p - PACE.stepMax, p + PACE.stepMax), PACE.mulMin, PACE.mulMax));
}

// Z5: seconds the stream needs to deliver a wave's quota at its spawn rate x spawnMul (spawnAcc primed at
// SPAWN_ACC_PRIME, the intra-wave ramp as for a pilot who keeps up: the kills trail the spawns by one plate).
function paceDeliveryS(cfg, wave, quota, spawnMul) {
  const q = Math.max(1, quota | 0), m = spawnMul > 0 ? spawnMul : 1;
  let s = (1 - SPAWN_ACC_PRIME) / (waveSpawnRate(cfg, wave, 0, q) * m);
  for (let j = 2; j <= q; j++) s += 1 / (waveSpawnRate(cfg, wave, j - 2, q) * m);
  return s;
}

// Z5: the wave cap, max(table cap, delivery x 1.25 + 4 s), rounded up to 0.01 s.
function paceWaveCap(cfg, wave, quota, spawnMul) {
  return Math.ceil(100 * Math.max(cfg.cap, PACE.capDeliveryMul * paceDeliveryS(cfg, wave, quota, spawnMul) + PACE.capMarginS)) / 100;
}

// Writes the wave tuning the scaffold spawner reads (40-combat.js tickSpawner / spawnEnemy / tickWaves, 60-hud.js).
function paceApplyTuning(t, cfg, wave, mul, carry) {
  const w = clamp(wave | 0, 0, 2);
  t.quota = Math.max(1, Math.round((cfg.quota[w] || 1) * mul) + Math.max(0, carry | 0));
  t.spawnMul = mul;
  t.maxEnemiesAdd = clamp(Math.round(PACE.maxEnemiesPerMul * (mul - 1)), 0, PACE.maxEnemiesAddMax) || 0;   // -0 -> 0
  t.speedMul = 1 + PACE.speedPerMul * (mul - 1);
  t.hungryMinAlive = mul >= PACE.hungryMin2AtMul ? 2 : HUNGRY_MIN_ALIVE;
  t.cap = paceWaveCap(cfg, w, t.quota, mul);
  return t;
}

// D3 hull carry: 50 % of the missing FRACTION is repaired, so the max-HP growth of the next sector never reads as damage.
function paceHullAfterClear(hp, m0, m1) {
  const max1 = Math.max(1, Number(m1) || 1);
  const before = clamp((Number(hp) || 0) / Math.max(1, Number(m0) || 1), 0, 1);
  const after = before + PACE.hullRepairFrac * (1 - before);
  const out = clamp(Math.round(max1 * after), 1, max1);
  const pct = Math.round(100 * out / max1);
  return { hp: out, pct, rep: Math.max(0, pct - Math.round(100 * before)) };
}

function paceFreshState() {
  return { v: 1, mul: 1, cpMul: 1, applied: null, carry: 0, carryTo: null, waveMuls: [], cadetLevel: 0, usedCadet: false,
    deaths: { level: 0, n: 0 }, hullNote: null };
}

// Legacy / hand-edited blobs: every field type- and range-checked; anything odd falls back to the fresh value.
function paceNormalizeState(s) {
  const f = paceFreshState();
  if (!s || typeof s !== "object" || Array.isArray(s)) return f;
  const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  if (num(s.mul, PACE.pinMin, PACE.mulMax)) f.mul = s.mul;
  if (num(s.cpMul, PACE.pinMin, PACE.mulMax)) f.cpMul = s.cpMul;
  const a = s.applied;
  if (obj(a) && int(a.level, 1, 10) && int(a.wave, 0, 2) && num(a.mul, PACE.pinMin, PACE.mulMax) && int(a.quota, 1, 9999)) {
    f.applied = { level: a.level, wave: a.wave, mul: a.mul, quota: a.quota };
  }
  if (int(s.carry, 0, 999)) f.carry = s.carry;
  const ct = s.carryTo;
  if (obj(ct) && int(ct.level, 1, 10) && int(ct.wave, 1, 2)) f.carryTo = { level: ct.level, wave: ct.wave };
  if (!f.carryTo) f.carry = 0;
  if (Array.isArray(s.waveMuls)) f.waveMuls = s.waveMuls.filter((m) => num(m, PACE.pinMin, PACE.mulMax)).slice(0, 3);
  if (int(s.cadetLevel, 0, 10)) f.cadetLevel = s.cadetLevel;
  if (typeof s.usedCadet === "boolean") f.usedCadet = s.usedCadet;
  const d = s.deaths;
  if (obj(d) && int(d.level, 0, 10) && int(d.n, 0, 9999)) f.deaths = { level: d.level, n: d.n };
  const h = s.hullNote;
  if (obj(h) && int(h.level, 2, 10) && int(h.pct, 0, 100) && int(h.rep, 0, 100) && typeof h.shown === "boolean") {
    f.hullNote = { level: h.level, pct: h.pct, rep: h.rep, shown: h.shown };
  }
  return f;
}

// ----------------------------- Hook registration -----------------------------
(function paceRegisterHooks() {
  if (typeof onGameHook !== "function") return;   // no registry: PACE inert, diff() standard
  const on = (name, method) => onGameHook(name, function (evt) {
    if (evt && typeof this[method] === "function") this[method](evt);
  });
  on("waveWillStart", "paceOnWaveWillStart");
  on("waveWillEnd", "paceOnWaveWillEnd");
  on("waveDrained", "paceOnWaveDrained");
  on("bossWillApproach", "paceOnBossWillApproach");
  on("levelWillStart", "paceOnLevelWillStart");
  on("checkpointRestored", "paceOnCheckpointRestored");
  on("clearWillRepair", "paceOnClearWillRepair");
  on("results", "paceOnResults");
  on("recordWillSave", "paceOnRecordWillSave");
  on("gameOverWillShow", "paceOnGameOverWillShow");
  on("levelCompleteWillShow", "paceOnLevelCompleteWillShow");
  on("sectorCardWillShow", "paceOnSectorCardWillShow");
})();

Object.assign(Game.prototype, {
  // ------------------------- Where PACE applies (spec-pace 2.6) -------------------------
  paceMode() {
    return typeof this.runMode === "function" ? this.runMode() : ((this.run && this.run.mode) || "campaign");
  },
  paceInCheck() {
    return typeof this.isFlightCheckActive === "function" && !!this.isFlightCheckActive();
  },
  // Pace and stakes: campaign and the Daily Sortie ("auto pace"); MODES drives endless / drill itself.
  paceApplies() {
    if (this.paceInCheck()) return false;
    const m = this.paceMode();
    return m !== "endless" && m !== "drill";
  },
  // Cadet, death counting and hull carry: campaign only.
  paceCampaign() {
    return !this.paceInCheck() && this.paceMode() === "campaign";
  },

  // run.pace (section 9), normalised once per object; runs without a record keep it in memory.
  paceState() {
    const host = this.run || this._paceMem || (this._paceMem = {});
    if (!host.pace || !PACE_SEEN.has(host.pace)) {
      host.pace = paceNormalizeState(host.pace);
      PACE_SEEN.add(host.pace);
    }
    return host.pace;
  },

  paceStats() {
    return this._paceStats || (this._paceStats = { timeouts: 0, escaped: 0, carried: 0, offers: 0, accepted: 0 });
  },

  // ------------------------- D2: pilotCps -------------------------
  // { cps, wpm, source: "run" | "profile" | "table", n }: MEASURE's run speed (>= 20 intervals), else the profile's
  // lifetime speed (>= 60 intervals; typistSpeed("lifetime") when MEASURE is loaded, else save.profile), else the table.
  pacePilot(cfg = LEVELS[this.levelIndex]) {
    const c = cfg || LEVELS[0];
    if (typeof this.speedFor === "function") {
      const s = this.speedFor("run");
      const n = s ? (s.n | 0) : 0;
      const wpm = s ? Number(s.wpm) : 0;
      if (n >= PACE.runMinIntervals && wpm > 0) return { cps: wpm / 12, wpm, source: "run", n };
    }
    let wpm = 0, n = 0;
    if (typeof this.typistSpeed === "function") {
      const s = this.typistSpeed("lifetime");
      wpm = s ? Number(s.wpm) || 0 : 0;
      n = s ? (s.n | 0) : 0;
    } else {
      const p = this.save && this.save.profile;
      if (p && typeof p === "object") { wpm = Number(p.speedEma) || 0; n = this.paceProfileIntervals(p); }
    }
    if (n >= PACE.profileMinIntervals && wpm > 0) return { cps: wpm / 12, wpm, source: "profile", n };
    return { cps: c.targetCps, wpm: c.targetCps * 12, source: "table", n: 0 };
  },

  // Interval count of a profile without MEASURE's accessor: speedN, else the bigram counts (a lower bound).
  paceProfileIntervals(prof) {
    if (!prof || typeof prof !== "object") return 0;
    if (Number.isFinite(prof.speedN)) return prof.speedN | 0;
    let n = 0;
    const b = prof.bigrams;
    if (b && typeof b === "object") for (const k of Object.keys(b)) { const v = b[k] && b[k].n; if (Number.isFinite(v)) n += v; }
    return n;
  },

  // ------------------------- D2: per-wave pace (waveWillStart) -------------------------
  paceOnWaveWillStart(evt) {
    if (!evt.tuning || !evt.cfg || !this.paceApplies()) return;
    const ps = this.paceState(), cfg = evt.cfg, L = cfg.level, w = clamp(evt.wave | 0, 0, 2), t = evt.tuning;
    const pinned = Number.isFinite(this._pacePin);
    const a = ps.applied;
    if (!pinned && a && a.level === L && a.wave === w) {
      // Continue / a wave replayed after a reload: the same tuning, no new step; the replay makes its own carry.
      paceApplyTuning(t, cfg, w, a.mul, 0);
      t.quota = a.quota;
      t.cap = paceWaveCap(cfg, w, t.quota, a.mul);
      if (ps.carryTo && ps.carryTo.level === L && ps.carryTo.wave === w + 1) { ps.carry = 0; ps.carryTo = null; }
      this._paceLast = { level: L, wave: w, mul: a.mul, target: null, source: "replay", cps: null, wpm: null, n: null, carry: 0, quota: t.quota };
      return;
    }
    let mul, src = null, target = null, source;
    if (pinned) { mul = this._pacePin; ps.mul = mul; source = "pin"; }
    else if (this.paceCadetActive()) { mul = PACE.cadetMul; source = "cadet"; }
    else {
      src = this.pacePilot(cfg);
      target = paceTargetMul(src.cps, cfg.targetCps);
      mul = paceStepMul(ps.mul, target);
      ps.mul = mul;
      source = src.source;
    }
    const carry = (ps.carryTo && ps.carryTo.level === L && ps.carryTo.wave === w) ? Math.max(0, ps.carry | 0) : 0;
    ps.carry = 0;
    ps.carryTo = null;
    paceApplyTuning(t, cfg, w, mul, carry);
    ps.applied = { level: L, wave: w, mul, quota: t.quota };
    if (ps.waveMuls.length > w) ps.waveMuls.length = w;
    ps.waveMuls.push(mul);
    this._paceLast = { level: L, wave: w, mul, target: target === null ? null : paceRound2(target), source,
      cps: src ? paceRound2(src.cps) : null, wpm: src ? Math.round(src.wpm) : null, n: src ? src.n : null, carry, quota: t.quota };
  },

  // ------------------------- D3: perfect wave by quota, timed-out waves -------------------------
  paceOnWaveWillEnd(evt) {
    if (evt.byQuota || this.paceInCheck()) return;
    evt.perfect = false;     // a wave that runs out of time never pays PERFECT WAVE
    evt.clearSfx = false;    // and plays no clear sting
    // Z5: the plates still alive at the cap leave the field now (no explosion); they are the N that escaped.
    this._paceTimeout = { level: evt.level | 0, wave: evt.wave | 0, n: this.paceEscapeLeftovers() };
  },

  // Z5: every wave plate still alive leaves (alive false, the "escape" ceremony of 70-render.js): no damage, no score,
  // no quota. Returns how many left.
  paceEscapeLeftovers() {
    let n = 0;
    for (const en of this.enemies) {
      if (!en.alive || en.dying || en.kind === "bossMinion") continue;
      en.alive = false;
      en.dying = true;
      en.locked = false;
      if (this.lock && this.lock.ref === en) { this.lock = null; this.lockMisses = 0; }
      if (typeof this.notePlateDeath === "function") this.notePlateDeath(en, "escape");
      n++;
    }
    return n;
  },

  // Drain end of a timed-out wave: N = the plates that left at the cap (plus any a drain timeout detonated).
  paceOnWaveDrained(evt) {
    if (evt.byQuota !== false || this.paceInCheck()) return;
    const to = this._paceTimeout;
    this._paceTimeout = null;
    const n = (to && to.level === (evt.level | 0) && to.wave === (evt.wave | 0) ? to.n | 0 : 0) + Math.max(0, evt.detonated | 0);
    this.paceTimedOut(evt.level | 0, evt.wave | 0, n, true);
  },

  // levelT reached the sector duration while a timed-out wave 3 was still draining: no waveDrained follows, so the
  // callout comes from here. Reused payload: never emits bossWillApproach.
  paceOnBossWillApproach() {
    const to = this._paceTimeout;
    if (!to || this.wavePhase !== "drain" || this.inBoss) return;
    this._paceTimeout = null;
    const cfg = LEVELS[this.levelIndex];
    if (!cfg || cfg.level !== to.level || (this.wave | 0) !== to.wave) return;
    this.paceTimedOut(to.level, to.wave, (to.n | 0) + this.countAliveEnemies(), false);   // no wave follows the approach
  },

  // One callout at the drain end (lead ruling Q4), the escaped count carried into the next wave of the sector. Z5: a
  // timeout always has N >= 1 (the cap needs plates alive); a forced one with nothing left says nothing.
  paceTimedOut(level, wave, n, allowCarry) {
    if (!(n > 0)) return;
    const carried = !!allowCarry && wave < 2 && n > 0 && this.paceApplies();
    this.showBanner({ kind: "callout", title: PACE_COPY.timeout(n), color: "magenta", dur: PACE.timeoutCalloutS });
    if (this.sfx && typeof this.sfx.lockLost === "function") this.sfx.lockLost();
    if (typeof this.announce === "function") this.announce(PACE_COPY.timeoutSay(wave, n, carried));
    const st = this.paceStats();
    st.timeouts++;
    st.escaped += n;
    if (carried) {
      const ps = this.paceState();
      ps.carry = n;
      ps.carryTo = { level, wave: wave + 1 };
      st.carried += n;
    }
  },

  // ------------------------- State lifecycle (spec-pace 2.5) -------------------------
  paceOnLevelWillStart(evt) {
    this._paceTimeout = null;
    this._paceOffer = null;
    if (this.paceInCheck() || !this.run) return;   // direct harness entry: the state is created at the first wave
    const ps = this.paceState();
    const L = (LEVELS[clamp(evt.levelIndex | 0, 0, 9)] || LEVELS[0]).level;
    // A sector entry: fresh, or a Continue into the next sector after quitting at Level Complete (not fresh, but the
    // last wave the state saw belongs to another sector).
    if (evt.fresh || (ps.applied && ps.applied.level !== L)) {
      ps.cpMul = ps.mul;
      ps.carry = 0;
      ps.carryTo = null;
      ps.applied = null;
      ps.waveMuls = [];
      if (ps.deaths.level !== L) ps.deaths = { level: L, n: 0 };
      if (ps.cadetLevel && ps.cadetLevel !== L) ps.cadetLevel = 0;
      if (ps.hullNote && ps.hullNote.level !== L) ps.hullNote = null;
    }
    if (ps.usedCadet && this.runMeta) this.runMeta.usedCadet = true;
  },

  // Retry sector / Restart sector / Continue after a death: back to the checkpoint's pace (the restore refills the hull).
  paceOnCheckpointRestored(evt) {
    if (evt.kind !== "level" || !this.run || this.paceInCheck()) return;
    const ps = this.paceState();
    ps.mul = ps.cpMul;
    ps.applied = null;
    ps.carry = 0;
    ps.carryTo = null;
    ps.waveMuls = [];
    ps.hullNote = null;
    this._paceTimeout = null;
  },

  // ------------------------- D3: hull carries from sector 4 -------------------------
  paceOnClearWillRepair(evt) {
    if (!this.paceCampaign()) return;
    const L = evt.level | 0;
    if (L < PACE.hullCarryFromLevel || L >= LEVELS.length) return;
    const h = paceHullAfterClear(evt.hpBefore, evt.maxHpBefore, evt.maxHp);
    evt.hp = h.hp;
    if (this.run) this.paceState().hullNote = { level: L + 1, pct: h.pct, rep: h.rep, shown: false };
  },

  paceOnLevelCompleteWillShow(evt) {
    if (!this.paceCampaign() || !this.run) return;
    const L = evt.level | 0;
    const n = this.paceState().hullNote;
    if (n && n.level === L + 1 && n.rep > 0) {
      if (evt.textEl) evt.textEl.textContent += PACE_COPY.hullSuffix(n.pct, n.rep);
      if (Array.isArray(evt.notes)) evt.notes.push(PACE_COPY.hullNote(n.pct));
    }
    if (this.paceCadetActive() && Array.isArray(evt.notes)) evt.notes.push(PACE_COPY.cadetFlown);
    // The card's "PACE x1.6" chip is spoken too (review: a visible line without an announcement).
    const tags = evt.results && Array.isArray(evt.results.tags) ? evt.results.tags : null;
    const tag = tags ? tags.find((t) => typeof t === "string" && t.indexOf("PACE x") === 0) : null;
    if (tag && Array.isArray(evt.notes)) evt.notes.push(PACE_COPY.paceTagSay(tag.slice(6)));
  },

  // Sector card lines (drawn and spoken by the scaffold): carried hull first, then the Cadet line.
  paceOnSectorCardWillShow(evt) {
    if (!Array.isArray(evt.lines) || !this.run || !this.paceCampaign()) return;
    const ps = this.paceState();
    const n = ps.hullNote;
    if (n && n.level === (evt.level | 0) && !n.shown) {
      evt.lines.push({ key: "hull", text: PACE_COPY.hullLine(n.pct, n.rep), color: "cyan", say: PACE_COPY.hullSay(n.pct, n.rep), order: 0 });
      n.shown = true;   // a later Continue does not repeat it; a Continue before any card was shown does show it
    }
    if (this.paceCadetActive()) evt.lines.push({ key: "cadet", text: PACE_COPY.cadetLine, color: "text", say: PACE_COPY.cadetSay, order: 0 });
  },

  // ------------------------- Results, records -------------------------
  paceOnResults(evt) {
    const r = evt.results;
    if (!r || this.paceInCheck()) return;
    if (!Array.isArray(r.tags)) r.tags = [];
    const ps = this.run && this.run.pace;
    if (evt.scope === "level") {
      if (this.paceCadetActive()) {
        r.tags.push(PACE_COPY.cadetTag);
        if (Array.isArray(r.bonusLines) && r.bonusLines.length) r.bonusLines.push({ id: "cadet", label: PACE_COPY.cadetRow, value: `x${PACE.cadetScore}` });
      } else if (ps && Array.isArray(ps.waveMuls) && ps.waveMuls.length && this.paceApplies()) {
        let sum = 0, k = 0;
        for (const m of ps.waveMuls) if (Number.isFinite(m)) { sum += m; k++; }
        const mean = k ? sum / k : 0;
        if (k && mean >= PACE.paceTagMin) r.tags.push(PACE_COPY.paceTag(mean));
      }
    } else if (this.paceRunUsedCadet()) {
      r.tags.push(PACE_COPY.cadetTag);
    }
  },

  paceRunUsedCadet(meta = this.runMeta) {
    if (meta && meta.usedCadet) return true;
    const run = this.paceRunFor(meta);
    return !!(run && run.pace && run.pace.usedCadet === true);
  },

  // The run record behind a runMeta (live, else the stored one), or the live run when there is no meta.
  paceRunFor(meta) {
    if (!meta) return this.run || null;
    if (this.run && this.run.id === meta.id) return this.run;
    const s = this.save && this.save.run;
    return (s && s.id === meta.id) ? s : null;
  },

  paceOnRecordWillSave(evt) {
    const row = evt.row;
    if (!row || !this.paceRunUsedCadet(evt.meta || this.runMeta)) return;
    row.difficulty = "cadet";
    if (!Array.isArray(row.tags)) row.tags = [];
    if (!row.tags.includes(PACE_COPY.cadetTag)) row.tags.push(PACE_COPY.cadetTag);
  },

  // ------------------------- D2: the Cadet assist -------------------------
  // Game Over, before the dead save: count the death in this sector and offer Cadet pace from the second one.
  paceOnGameOverWillShow(evt) {
    const ctl = this.paceEnsureCadetControls();
    this._paceOffer = null;
    if (ctl.btn) ctl.btn.classList.add("hidden");
    if (ctl.note) { ctl.note.classList.add("hidden"); ctl.note.textContent = ""; }
    if (!this.run || !this.paceCampaign()) return;
    const ps = this.paceState();
    const L = evt.level | 0;
    if (ps.deaths.level !== L) ps.deaths = { level: L, n: 0 };
    ps.deaths.n += 1;   // persisted by the writeRunSave({ dead: true }) that follows the hook
    if (ps.cadetLevel === L) {
      if (ctl.note) { ctl.note.textContent = PACE_COPY.cadetStays(L); ctl.note.classList.remove("hidden"); }
      if (Array.isArray(evt.notes)) evt.notes.push(PACE_COPY.cadetStays(L));   // shown and spoken (the button that describes it is hidden)
      return;
    }
    if (ps.deaths.n < PACE.cadetAfterDeaths) return;
    this._paceOffer = { level: L, boss: !!(evt.inBoss && evt.canRetryBoss) };
    this.paceStats().offers++;
    if (ctl.btn) ctl.btn.classList.remove("hidden");
    if (ctl.note) { ctl.note.textContent = PACE_COPY.cadetOffer(L); ctl.note.classList.remove("hidden"); }
    if (Array.isArray(evt.notes)) evt.notes.push(PACE_COPY.cadetOfferSay);
  },

  // #btnCadetPace / #cadetNote (index.html, scaffold); created after Retry boss / #retryNote when missing. Bound once.
  paceEnsureCadetControls() {
    let btn = document.getElementById("btnCadetPace");
    let note = document.getElementById("cadetNote");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "btnCadetPace";
      btn.type = "button";
      btn.className = "btn-arcade hidden";
      btn.setAttribute("aria-describedby", "cadetNote");
      btn.textContent = "Fly at Cadet pace";
      const after = document.getElementById("btnRetryBoss") || document.getElementById("btnTryAgain");
      if (after && after.parentElement) after.insertAdjacentElement("afterend", btn);
      else btn = null;
    }
    if (!note) {
      const retry = document.getElementById("retryNote");
      if (retry && retry.parentElement) {
        note = document.createElement("p");
        note.id = "cadetNote";
        note.className = "small hidden";
        retry.insertAdjacentElement("afterend", note);
      }
    }
    if (btn && !btn._paceBound) {
      btn._paceBound = true;
      btn.addEventListener("click", () => this.paceAcceptCadet());
    }
    return { btn: btn || null, note: note || null };
  },

  paceAcceptCadet() {
    const offer = this._paceOffer;
    if (!offer || this.mode !== "gameOver" || !this.run || !this.paceCampaign()) return false;
    const ps = this.paceState();
    const L = offer.level;
    ps.cadetLevel = L;
    ps.usedCadet = true;
    ps.mul = PACE.mulMin;
    ps.cpMul = PACE.mulMin;
    if (this.runMeta) this.runMeta.usedCadet = true;
    this._paceOffer = null;
    this.paceStats().accepted++;
    if (typeof this.uiTick === "function") this.uiTick("confirm");
    if (offer.boss) this.retryBoss(); else this.restartLevel();   // the same checkpoints as the two retry buttons
    if (typeof this.focusGameCanvas === "function") this.focusGameCanvas();
    // The toast's announce is the task's last write, so it replaces the generic sector line.
    if (typeof this.showToast === "function") this.showToast(PACE_COPY.cadetToast(L), { kind: "info", key: "cadet" });
    return true;
  },

  // Cadet on for the sector being flown (campaign). diff() calls this on every addScore / takeDamage: the fast path
  // reads two fields and allocates nothing.
  paceCadetActive() {
    const run = this.run;
    if (!run) return false;
    const ps = run.pace;
    if (!ps || !ps.cadetLevel) return false;
    const cfg = LEVELS[this.levelIndex];
    if (!cfg || ps.cadetLevel !== cfg.level) return false;
    return this.paceCampaign();
  },

  // P7 provider behind the scaffold's diff(): frozen rows, no allocation.
  paceDiffRow() {
    return this.paceCadetActive() ? PACE_DIFF_CADET : PACE_DIFF_STANDARD;
  },

  // ------------------------- Probes and other tracks -------------------------
  // pacePin(m) fixes paceMul from the next wave (m in [0.5, 2.5]); pacePin(null) clears it; { now: true } re-applies
  // the pin to the wave in progress.
  pacePin(mul, opts = {}) {
    if (mul === null || mul === undefined) { this._pacePin = null; return null; }
    const m = Number(mul);
    if (!Number.isFinite(m)) return null;
    const v = paceRound2(clamp(m, PACE.pinMin, PACE.mulMax));
    this._pacePin = v;
    const ps = this.run ? this.paceState() : null;
    if (ps) ps.mul = v;
    if (opts && opts.now && typeof this.waveTuningNow === "function") {
      const t = this.waveTuningNow();
      const cfg = LEVELS[this.levelIndex];
      if (t && cfg) {
        paceApplyTuning(t, cfg, this.wave, v, 0);
        if (ps) {
          const w = clamp(this.wave | 0, 0, 2);
          ps.applied = { level: cfg.level, wave: w, mul: v, quota: t.quota };
          if (ps.waveMuls.length > w) ps.waveMuls.length = w;
          ps.waveMuls.push(v);
        }
      }
    }
    return v;
  },

  // Pure preview: { target, mul, tuning } for a sector / wave / pilot speed / previous paceMul.
  pacePlan(levelIndex, wave, pilotCps, prev = PACE.mulMin) {
    const i = clamp(levelIndex | 0, 0, 9);
    const cfg = LEVELS[i];
    const w = clamp(wave | 0, 0, 2);
    const target = paceTargetMul(pilotCps, cfg.targetCps);
    const mul = paceStepMul(prev, target);
    const tuning = paceApplyTuning({ levelIndex: i, wave: w, quota: 1, spawnMul: 1, maxEnemiesAdd: 0, speedMul: 1,
      hungryMinAlive: HUNGRY_MIN_ALIVE, cap: cfg.cap, pressureCap: pressureCap(cfg) }, cfg, w, mul, 0);
    return { target, mul, tuning };
  },

  // Probes / hand-off tooling: a deep copy of everything PACE knows right now.
  paceSnapshot() {
    const copy = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
    const host = this.run || this._paceMem;
    return {
      state: host && host.pace ? copy(this.paceState()) : null,
      last: copy(this._paceLast || null),
      pin: Number.isFinite(this._pacePin) ? this._pacePin : null,
      offer: copy(this._paceOffer || null),
      timeout: copy(this._paceTimeout || null),
      stats: copy(this.paceStats()),
      tuning: typeof this.waveTuningNow === "function" ? copy(this.waveTuningNow()) : null,
      cadet: this.paceCadetActive(),
      mode: this.paceMode()
    };
  }
});
