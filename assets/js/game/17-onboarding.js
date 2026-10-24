// Type-R 198X — ONBOARD track (D13): the first-run Flight Check (three scripted plates in mode "playing" with
// this.run === null and throwaway stats, a reduced update claimed through frameWillUpdate, one storeSave at the end) and
// the briefing disclosure. Loads after 15-screens.js. Hooks consumed: runWillStart, levelWillStart, frameWillUpdate,
// modeChange, keyEscape, scoreWillAdd, powerupWillSpawn, storyWillShow (pauseScreenFilled optional); emitted:
// flightCheckStart, flightCheckStep, flightCheckEnd. Top-level names FC_* / fc*; methods never reuse the 15-screens.js
// onboarding names (initOnboarding, tutorialEnabled, markTutorial, tutorialToast, dismissTutorialToast).
//
// Contract for every other track while a check runs (CONTRACT 2.3, the null-run contract): this.flightCheck is a state
// object, mode === "playing", this.run === null (runMode() reads "campaign"), wavePhase === "check", this.stats /
// this.levelStats are throwaway objects swapped back at the end, no waves / boss / spawner / tick event / autosave run.
// Keys go through the normal input path (lock rules, lasers, kill FX, keyCorrect / keyMiss all fire), so MEASURE's
// per-key profile is fed; score is cancelled (scoreWillAdd) and powerups never spawn (powerupWillSpawn).
//
// Flow: runWillStart(levelIndex 0, campaign) on an eligible save -> hold + startFlightCheck(); intro beat -> step 1
// "j" -> gap -> step 2 "spark" -> gap -> step 3 "comet" (far) + "laser" (near, once comet is locked) -> done beat ->
// fcFinish("passed") -> beginRunAt(0) again (now ineligible) -> the sector-1 card. Esc / the Skip button skip to the
// card; quitting to the menu aborts without marking it done. Eligibility: flightCheckEligible() (spec-onboard 1, R20).
// Harness: window.TypeRHarness.flightCheck = "skip" (default in play.mjs / openProbe) | "play" | null (real rule).

const FC_WORDS = Object.freeze({ letter: "j", word: "spark", far: "comet", near: "laser" });   // leads j / s / c / l are distinct
const FC_INTRO_S = 1.2;        // banner beat before plate 1 (plate 1 also waits for isLevelGateOpen())
const FC_STEP_GAP_S = 0.7;     // finished step -> next plate
const FC_DONE_S = 1.4;         // "FLIGHT CHECK COMPLETE" beat -> sector card
const FC_GLIDE_K = 6;          // 1/s exponential approach to the hold x (95 % in 0.5 s); no glide under reduced motion
const FC_HOLD_X = 0.62;        // steps 1-2 hold x as a fraction of this.w (794 px of 1280)
const FC_FAR_X = 0.80;         // step 3 far plate hold (1024 px)
const FC_NEAR_X = 0.50;        // step 3 near plate (640 px): warps in at its hold, no glide
                               // all three are right of DANGER_X .35 (448 px): a check plate never turns red
const FC_LOCK_NUDGE_S = 4;     // steps 2-3: no lock this long after the plate is targetable -> "TYPE S" / "TYPE C"
const FC_NUDGE_S = 8;          // no correct key this long -> the step toast is re-shown (re-announced)
const FC_NUDGE_MAX = 2;        // re-shows per step (lock nudge + idle nudge + miss nudge share this cap)
const FC_MISS_NUDGE = 3;       // misses inside one step -> re-show the step toast once
const FC_TOAST_MS = 60000;     // step toasts persist; dismissed explicitly when the step ends / on pause
const FC_TOAST_KEY = "fc";     // showToast key (tutorial toasts use "tut")
const FC_MAX_ERRORS = 3;       // consecutive fcTick throws -> skipFlightCheck("error")
const FC_COPY = Object.freeze({
  banner: "FLIGHT CHECK", bannerSub: "3 DRILLS · NO HULL · NO SCORE",
  letter: "TYPE J",                                            // lead copy
  finish: "KEEP TYPING TO FINISH IT",                          // lead copy (same string as TUTORIAL_TIPS.finish)
  release: "PRESS SPACE TO LET GO, THEN TAKE THE NEARER ONE",  // lead copy
  done: "FLIGHT CHECK COMPLETE",                               // lead copy
  typeLead: (ch) => `TYPE ${String(ch || "").toUpperCase()}`,  // lock / idle nudge, same grammar as step 1
  step: (n) => `FLIGHT CHECK ${n}/3`,
  pauseEyebrow: "Paused // Flight check",
  pauseWave: (n) => `CHECK ${n}/3`,
  skip: "Skip", skipKbd: "Skip · Esc", skipLabel: "Skip flight check",
  srStart: "Flight check: three quick drills before Sector 1. Nothing can hit you. Press Escape to skip.",
  srWord: (w) => `Word: ${w}. Type ${w[0].toUpperCase()} to lock on.`,
  srFinish: (w) => `Keep typing to finish it: ${w}.`,
  srRelease: (far, near) => `A nearer word, ${near}, appeared. Press Space to let go of ${far}, then type ${near}.`,
  srDone: "Flight check complete. Sector 1 next."
});

// compactInPlace predicates: top-level, so the reduced update allocates no closure per frame.
function fcBulletAlive(b) { return b.alive(); }
function fcParticleAlive(p) { return p.alive(); }
function fcExplosionLive(x) { return !x.done; }
function fcEntityAlive(e) { return e.alive; }

// Hook registration at load (feature-detected: no registry -> no Flight Check, the game plays as before).
(function fcRegisterHooks() {
  if (typeof GAME_HOOKS !== "object" || !GAME_HOOKS) return;
  const on = (name, method) => {
    const fn = function (evt) { if (this && typeof this[method] === "function") this[method](evt); };
    if (typeof onGameHook === "function") onGameHook(name, fn);
    else (GAME_HOOKS[name] || (GAME_HOOKS[name] = [])).push(fn);
  };
  on("runWillStart", "fcOnRunWillStart");
  on("levelWillStart", "fcOnLevelWillStart");
  on("frameWillUpdate", "fcOnFrame");
  on("modeChange", "fcOnModeChange");
  on("pauseScreenFilled", "fcOnPauseFilled");
  on("keyEscape", "fcOnEscape");
  on("scoreWillAdd", "fcOnScore");
  on("powerupWillSpawn", "fcOnDrop");
  on("storyWillShow", "briefingOnShow");
})();

Object.assign(Game.prototype, {
  // ------------------------- Eligibility (spec-onboard 1, CONTRACT R20) -------------------------
  flightCheckEligible() {
    const H = (typeof window !== "undefined" && window.TypeRHarness) || null;
    const flag = H ? H.flightCheck : null;
    if (flag === "skip") return false;
    if (flag === "play") return !this._fcRanThisSession;
    const s = this.save;
    if (!s || typeof s !== "object") return false;
    if (Number(s.onboardingDone) > 0) return false;
    if (((s.lastUnlockedLevel | 0) || 1) > 1) return false;
    if (Array.isArray(s.highScores) && s.highScores.length > 0) return false;
    if (s.sectorBests && typeof s.sectorBests === "object" && Object.keys(s.sectorBests).length > 0) return false;
    if ((s.victories | 0) > 0 || (s.bestWpm | 0) > 0) return false;
    if (s.tutorialSeen && s.tutorialSeen.lock) return false;   // a pilot who has locked before is returning
    return !this.fcHasSessions();
  },

  // Rule 5 (R20): any MEASURE profile session (practice included) makes the save a returning pilot's. MEASURE absent
  // -> no sessions. A "flightcheck" row would not count (MEASURE writes none: R19).
  fcHasSessions() {
    if (typeof this.typistSessions !== "function") return false;
    let list = null;
    try { list = this.typistSessions(100); } catch (_) { list = null; }
    if (!Array.isArray(list)) return false;
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (row && row.mode !== "flightcheck") return true;
    }
    return false;
  },

  isFlightCheckActive() {
    return !!this.flightCheck;
  },

  // ------------------------- Start (spec-onboard 2.3) -------------------------
  startFlightCheck() {
    if (this.flightCheck) return false;
    this._fcRanThisSession = true;
    if (typeof this.stopAttract === "function") this.stopAttract();

    // World reset.
    this.resetTransientFx();
    this.resetLevelRuntime();
    this.bossClear = null;
    if (this.bossFinaleBursts) this.bossFinaleBursts.length = 0;
    this.enemies.length = 0;
    this.powerups.length = 0;
    this.lock = null;
    this.lockMisses = 0;
    this.inBoss = false;
    this.boss = null;
    this.levelIntro = null;
    this.showBossBar(false);
    this.power = { spread: 0, pierce: 0, rapid: 0, multiplier: 0 };

    // Sector-1 dressing.
    this.levelIndex = 0;
    this.levelT = 0;
    this.wave = 0;
    this.waveKills = 0;
    this.setWavePhase("check");
    this.currentTheme = getThemeForLevel(0);
    this.parallax.bgOffset = 0;
    this.parallax.fgOffset = 0;
    if (this._assetsLevel !== 0 && typeof this.loadLevelAssets === "function") this.loadLevelAssets(0);
    this.setPlayerShip(this.getSelectedShipId());
    this.player.maxHp = getHpBonusForLevel(1);
    this.player.hp = this.player.maxHp;
    this.player.shield = 0;
    this.updateLowHp();

    // Music as startLevel plays it (startLevel(0) later keeps the same track, no restart).
    const sfx = this.sfx;
    if (sfx) {
      try {
        if (typeof sfx.trackForLevel === "function") sfx.playMusic(sfx.trackForLevel(0));
        else if (typeof sfx.playMusic === "function") sfx.playMusic();
        if (typeof sfx.setMusicState === "function") sfx.setMusicState("wave");
      } catch (_) { /* audio is optional */ }
    }

    // State + stats swap (the throwaway stats keep keys / misses for the result, never reach a record).
    const st = this.stats;
    const fc = {
      phase: "intro", step: 0, t: 0, active: 0, startedAt: nowMs(), stepStartedAt: 0,
      plate: null, far: null, near: null, holdX: FC_HOLD_X,
      shownToast: null, shownLead: null, shownFinish: false, toldTarget: false,
      nudges: 0, idleT: 0, lockIdleT: 0, missNudged: false,
      missesAtStep: 0, missesAtFarLock: 0, correctAtStep: 0, lastCorrect: 0,
      releasedBy: null, steps: [0, 0, 0],
      savedStats: st, savedLevelStats: this.levelStats, savedRun: this.run || null,
      errors: 0
    };
    this.run = null;   // null-run contract: a check never feeds a saved run (beginRunAt replaces it at the hand-off)
    this.stats = defaultStats();
    this.levelStats = defaultLevelStats();
    this._baseTier = 1;
    if (this.wpmRing) this.wpmRing.length = 0;
    this.flightCheck = fc;   // before setMode: the modeChange listener sees the check
    try { document.body.dataset.flightCheck = "on"; } catch (_) { /* no DOM */ }
    this.fcEnsureUi();
    this.fcSetStepUi(1);
    this.fcShowPanel(true);

    this.setMode("playing");
    this.announce(FC_COPY.srStart);   // same task as setMode's sector line: announce() keeps the last write
    this.showBanner({ kind: "wave", eyebrow: FC_COPY.banner, sub: FC_COPY.bannerSub, dur: 1.6 });
    if (sfx && typeof sfx.waveStart === "function") { try { sfx.waveStart(1); } catch (_) { /* audio is optional */ } }
    this.fcEmit("flightCheckStart", {});
    return true;
  },

  // ------------------------- Skip / finish (spec-onboard 2.4) -------------------------
  skipFlightCheck(reason = "api") {
    const fc = this.flightCheck;
    if (!fc) return false;
    if (fc.phase === "done") this.fcFinish("passed", { markDone: true, handOff: true, reason: null });
    else this.fcFinish("skipped", { markDone: true, handOff: true, reason: reason || "api" });
    return true;
  },

  // result "passed" | "skipped" | "aborted"; opts { markDone, handOff, reason }.
  fcFinish(result, opts = {}) {
    const fc = this.flightCheck;
    if (!fc) return false;
    this.flightCheck = null;   // first: the hand-off's events see no check
    const markDone = !!opts.markDone, handOff = !!opts.handOff;
    const reason = opts.reason || null;
    this.dismissToast(FC_TOAST_KEY);
    this.fcShowPanel(false);
    try { delete document.body.dataset.flightCheck; } catch (_) { /* no DOM */ }

    const st = this.stats || {};
    const last = {
      result, reason, ms: Math.round(fc.active * 1000), keys: st.total | 0, correct: st.correct | 0, misses: st.misses | 0,
      releasedBy: fc.releasedBy, steps: fc.steps.map((s) => Math.round(s * 1000))
    };
    this._fcLast = last;
    this.stats = fc.savedStats || defaultStats();
    this.levelStats = fc.savedLevelStats || defaultLevelStats();
    if (!this.run && fc.savedRun) this.run = fc.savedRun;
    if (this.wpmRing) this.wpmRing.length = 0;
    fc.plate = fc.far = fc.near = null;
    fc.savedStats = fc.savedLevelStats = fc.savedRun = null;

    if (markDone && this.save) {
      const s = this.save;
      s.onboardingDone = Date.now();
      if (result === "passed") {
        if (!s.tutorialSeen || typeof s.tutorialSeen !== "object") s.tutorialSeen = {};
        s.tutorialSeen.lock = true;                        // step 1 taught the lock
        if (fc.shownFinish) s.tutorialSeen.finish = true;  // only when the FINISH toast was displayed; never written false
        // tutorialSeen.release stays: the 3-miss lock-loss tip still teaches something new.
      }
      storeSave(s);   // the one write of the check (blocked storage: the in-memory flag still holds this session)
    }
    this.fcEmit("flightCheckEnd", { result, reason, ms: last.ms, keys: last.keys, correct: last.correct, misses: last.misses, releasedBy: last.releasedBy });

    if (handOff) {
      this.enemies.length = 0;
      this.lock = null;
      this.lockMisses = 0;
      this.beginRunAt(0);   // ineligible now -> sector card, setMode("playing"), saveRun(true)
      this.focusGameCanvas();
    }
    return true;
  },

  // ------------------------- Listeners -------------------------
  fcOnRunWillStart(evt) {
    const campaign = !evt.mode || evt.mode === "campaign";
    if (this.flightCheck) {
      if ((evt.levelIndex | 0) === 0 && campaign) { evt.hold = true; return; }   // already checking: no restart
      this.fcFinish("aborted", { markDone: true, handOff: false, reason: "external" });
      return;
    }
    if ((evt.levelIndex | 0) !== 0 || !campaign || !this.flightCheckEligible()) return;
    let ok = false;
    try {
      ok = this.startFlightCheck();
    } catch (err) {
      console.error("[TypeR] flight check start", err);
      if (this.flightCheck) this.fcFinish("skipped", { markDone: true, handOff: false, reason: "error" });
      ok = false;
    }
    if (ok) evt.hold = true;
  },

  fcOnLevelWillStart() {
    if (this.flightCheck) this.fcFinish("aborted", { markDone: true, handOff: false, reason: "external" });
  },

  fcOnFrame(evt) {
    if (!this.flightCheck) return;
    evt.claimed = true;
    this.fcUpdate(evt.dt);
  },

  fcOnModeChange(evt) {
    const fc = this.flightCheck;
    if (!fc) return;
    const to = evt.to;
    if (to === "paused") {
      this.dismissToast(FC_TOAST_KEY);   // fc.shownToast is kept for the resume
      return;
    }
    if (to === "playing") {
      if (evt.from === "paused") {
        fc.idleT = 0;
        if (fc.shownToast) this.fcShowToast(fc.shownToast, fc.shownLead);
      }
      return;
    }
    if (to === "menu") { this.fcFinish("aborted", { markDone: false, handOff: false, reason: "menu" }); return; }
    this.fcFinish("aborted", { markDone: true, handOff: false, reason: "mode" });
  },

  // Pause screen copy for the check (runs inside fillPauseScreen, after setMode's Restart toggle).
  fcOnPauseFilled() {
    const fc = this.flightCheck;
    if (!fc) return;
    const set = (id, text) => { const el = document.getElementById(id); if (el && el.textContent !== text) el.textContent = text; };
    set("pauseEyebrow", FC_COPY.pauseEyebrow);
    set("pauseWave", FC_COPY.pauseWave(clamp(fc.step | 0 || 1, 1, 3)));
    set("pauseSector", "—");
    set("pauseScore", "—");
    if (this.btnRestart) this.btnRestart.classList.add("hidden");   // setMode re-toggles it on every later pause
  },

  fcOnEscape(evt) {
    if (!this.flightCheck || evt.mode !== "playing") return;   // paused: not claimed, Esc resumes as usual
    evt.claimed = true;
    this.skipFlightCheck("esc");
  },

  fcOnScore(evt) {
    if (this.flightCheck) evt.cancel = true;
  },

  fcOnDrop(evt) {
    if (this.flightCheck) evt.cancel = true;
  },

  // ------------------------- Reduced update (spec-onboard 2.5) -------------------------
  fcUpdate(dt) {
    const fc = this.flightCheck;
    this.playClock = (this.playClock || 0) + dt;
    this.stepAmbient(dt);
    const enemies = this.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.alive) en.update(dt);   // speed 0: age / flash / typo decay only; never a leak
    }
    this.fcGlide(dt);
    if (this.powerups.length) {   // drop fallback (powerupWillSpawn cancels them first)
      this.powerups.length = 0;
      if (this.lock && this.lock.kind === "powerup") { this.lock = null; this.lockMisses = 0; }
    }
    const bullets = this.bullets, particles = this.particles, explosions = this.explosions;
    for (let i = 0; i < bullets.length; i++) bullets[i].update(dt);
    compactInPlace(bullets, fcBulletAlive);
    for (let i = 0; i < particles.length; i++) particles[i].update(dt);
    compactInPlace(particles, fcParticleAlive);
    for (let i = 0; i < explosions.length; i++) explosions[i].update(dt);
    compactInPlace(explosions, fcExplosionLive);
    compactInPlace(enemies, fcEntityAlive);
    if (this.lock && (!this.lock.ref || !this.lock.ref.alive)) { this.lock = null; this.lockMisses = 0; }
    this.updateFloaters(dt);
    this.updateBanner(dt);
    if (typeof this.tickPresentation === "function") this.tickPresentation(dt);
    if (fc) {
      try {
        this.fcTick(dt);
        fc.errors = 0;
      } catch (err) {
        if (++fc.errors === 1) console.error("[TypeR] flight check", err);
        if (fc.errors >= FC_MAX_ERRORS && this.flightCheck === fc) this.skipFlightCheck("error");
      }
    }
    this.updateHUD();
  },

  fcGlide(dt) {
    const rm = this.fcReducedMotion();
    const w = this.w;
    const k = 1 - Math.exp(-FC_GLIDE_K * dt);
    const enemies = this.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (!en.alive || typeof en.fcHold !== "number") continue;
      const hold = en.fcHold * w;
      if (rm) { en.x = hold; continue; }
      en.x += (hold - en.x) * k;
      if (Math.abs(hold - en.x) < 0.5) en.x = hold;
    }
  },

  fcReducedMotion() {
    return typeof screensReducedMotion === "function" ? screensReducedMotion(this) : !!this.reduceMotion;
  },

  // ------------------------- Timeline (spec-onboard 2.2) -------------------------
  fcTick(dt) {
    const fc = this.flightCheck;
    if (!fc) return;
    fc.t += dt;
    fc.active += dt;
    if (fc.phase === "intro") {
      if (fc.t >= FC_INTRO_S && this.isLevelGateOpen()) this.fcBeginStep(1);
      return;
    }
    if (fc.phase === "gap") {
      if (fc.t >= FC_STEP_GAP_S) this.fcBeginStep(fc.step + 1);
      return;
    }
    if (fc.phase === "done") {
      if (fc.t >= FC_DONE_S) this.fcFinish("passed", { markDone: true, handOff: true, reason: null });
      return;
    }
    if (fc.phase !== "step") return;

    const st = this.stats;
    const lock = this.lock;
    if ((st.correct | 0) !== fc.lastCorrect) { fc.lastCorrect = st.correct | 0; fc.idleT = 0; } else fc.idleT += dt;

    if (fc.step === 3) { this.fcTickRelease(dt); return; }

    const plate = fc.plate;
    if (!plate || !plate.alive) { this.fcEndStep(); return; }
    const targetable = this.isTargetable(plate);
    const lockedOn = !!(lock && lock.ref === plate);
    if (fc.step === 1) {
      if (targetable && !fc.toldTarget) { fc.toldTarget = true; this.fcShowToast("letter"); }
    } else {
      if (targetable && !fc.toldTarget) { fc.toldTarget = true; this.announce(FC_COPY.srWord(plate.text)); }
      if (lockedOn && (plate.progress | 0) >= 1 && !fc.shownFinish) {
        fc.shownFinish = true;
        this.fcShowToast("finish");
        this.announce(FC_COPY.srFinish(plate.text));
      }
      this.fcLockNudge(dt, plate, targetable && !lockedOn);
    }
    this.fcNudges(plate);
  },

  // Step 3: the far plate, the nearer one once it is locked, and the release.
  fcTickRelease(dt) {
    const fc = this.flightCheck;
    const st = this.stats;
    const lock = this.lock;
    const far = fc.far, near = fc.near;
    if (far && !far.alive) {
      fc.releasedBy = "finish";
      if (near && near.alive) this.detonateEnemy(near);
      this.fcEndStep();
      return;
    }
    if (near && !near.alive) {
      fc.releasedBy = ((st.misses | 0) - fc.missesAtFarLock >= 3) ? "lost" : "space";
      if (far && far.alive) this.detonateEnemy(far);
      this.fcEndStep();
      return;
    }
    if (!far) return;
    const farTarget = this.isTargetable(far);
    if (farTarget && !fc.toldTarget) { fc.toldTarget = true; this.announce(FC_COPY.srWord(far.text)); }
    if (!near && (far.progress | 0) >= 1) {
      const ys = this.laneYs();
      const mid = Math.floor((ys.length - 1) / 2);
      fc.near = this.fcSpawnPlate(FC_WORDS.near, Math.min(ys.length - 1, mid + 1), FC_NEAR_X, false);
      fc.missesAtFarLock = st.misses | 0;
      fc.lockIdleT = 0;
      this.fcShowToast("release");
      this.announce(FC_COPY.srRelease(far.text, FC_WORDS.near));
      return;
    }
    if (near && lock && lock.ref === near && fc.shownToast === "release") {
      this.dismissToast(FC_TOAST_KEY);   // the nearer one is locked: the release lesson is done
      fc.shownToast = null;
    }
    const target = near || far;
    const lockedAny = !!(lock && (lock.ref === far || lock.ref === near));
    this.fcLockNudge(dt, target, this.isTargetable(target) && !lockedAny);
    this.fcNudges(target);
  },

  // Lock nudge (steps 2-3): the plate is targetable but not locked for FC_LOCK_NUDGE_S -> "TYPE <lead>".
  fcLockNudge(dt, plate, waiting) {
    const fc = this.flightCheck;
    if (!waiting) { fc.lockIdleT = 0; return; }
    fc.lockIdleT += dt;
    if (fc.lockIdleT < FC_LOCK_NUDGE_S || fc.nudges >= FC_NUDGE_MAX) return;
    fc.lockIdleT = 0;
    fc.nudges++;
    this.fcShowToast("lead", plate.nextChar() || plate.text[0]);
  },

  // Idle nudge (no correct key for FC_NUDGE_S) and miss nudge (FC_MISS_NUDGE misses in the step, once): re-show the
  // step's toast for what the pilot should do now.
  fcNudges(target) {
    const fc = this.flightCheck;
    if (fc.nudges >= FC_NUDGE_MAX) return;
    let fire = false;
    if (fc.idleT >= FC_NUDGE_S) { fc.idleT = 0; fire = true; }
    if (!fc.missNudged && (this.stats.misses | 0) - fc.missesAtStep >= FC_MISS_NUDGE) { fc.missNudged = true; fire = true; }
    if (!fire) return;
    fc.nudges++;
    const lock = this.lock;
    if (fc.step === 3 && fc.near && lock && lock.ref === fc.far) { this.fcShowToast("release"); return; }
    if (lock && lock.ref === target && (target.progress | 0) >= 1 && target.text.length > 1) { this.fcShowToast("finish"); return; }
    if (fc.step === 1) { this.fcShowToast("letter"); return; }
    this.fcShowToast("lead", target.text[0]);
  },

  fcBeginStep(n) {
    const fc = this.flightCheck;
    const st = this.stats;
    fc.phase = "step";
    fc.step = n;
    fc.t = 0;
    fc.stepStartedAt = fc.active;
    fc.nudges = 0;
    fc.idleT = 0;
    fc.lockIdleT = 0;
    fc.missNudged = false;
    fc.toldTarget = false;
    fc.missesAtStep = st.misses | 0;
    fc.correctAtStep = st.correct | 0;
    fc.lastCorrect = st.correct | 0;
    this.fcSetStepUi(n);
    const ys = this.laneYs();
    const last = ys.length - 1;
    const mid = Math.floor(last / 2);
    if (n === 1) fc.plate = this.fcSpawnPlate(FC_WORDS.letter, mid, FC_HOLD_X, true);
    else if (n === 2) fc.plate = this.fcSpawnPlate(FC_WORDS.word, mid, FC_HOLD_X, true);
    else {
      fc.far = fc.plate = this.fcSpawnPlate(FC_WORDS.far, Math.max(0, mid - 1), FC_FAR_X, true);
      fc.near = null;
    }
    this.fcEmit("flightCheckStep", { step: n });
  },

  // A step plate died: silent combo reset (no multiplier callout can come from the check), the step time, next beat.
  fcEndStep() {
    const fc = this.flightCheck;
    const st = this.stats;
    st.combo = 0;
    st.mult = 1;
    this._baseTier = 1;
    this.uiTick("confirm");
    fc.steps[fc.step - 1] = fc.active - fc.stepStartedAt;
    this.dismissToast(FC_TOAST_KEY);
    fc.shownToast = null;
    fc.shownLead = null;
    fc.t = 0;
    if (fc.step < 3) { fc.phase = "gap"; return; }
    fc.phase = "done";
    this.showBanner({ kind: "callout", title: FC_COPY.done, color: "cyan", dur: FC_DONE_S });
    this.announce(FC_COPY.srDone);
    const sfx = this.sfx;
    if (sfx && typeof sfx.waveClear === "function") { try { sfx.waveClear(1); } catch (_) { /* audio is optional */ } }
  },

  fcSpawnPlate(text, laneIndex, holdX, glide) {
    const ys = this.laneYs();
    const lane = clamp(laneIndex | 0, 0, ys.length - 1);
    const en = new Enemy({ text, x: this.w, y: ys[lane], speed: 0, lane });
    const hold = holdX * this.w;
    en.x = (glide && !this.fcReducedMotion()) ? this.w + en.plateW / 2 + 8 : hold;
    en.fcHold = holdX;
    this.enemies.push(en);
    return en;
  },

  // key: "letter" | "finish" | "release" | "lead" (lead = "TYPE <ch>").
  fcShowToast(key, ch = null) {
    const fc = this.flightCheck;
    const text = key === "lead" ? FC_COPY.typeLead(ch) : FC_COPY[key];
    if (!text) return;
    if (fc) { fc.shownToast = key; fc.shownLead = key === "lead" ? ch : null; }
    this.showToast(text, { kind: "tip", key: FC_TOAST_KEY, ms: FC_TOAST_MS });
  },

  // ------------------------- Panel (spec-onboard 2.6) -------------------------
  fcEnsureUi() {
    if (this._fcUi && this._fcUi.panel.isConnected) return this._fcUi;
    if (typeof document === "undefined") return null;
    let panel = document.getElementById("flightCheck");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "flightCheck";
      panel.className = "fcPanel hidden";
      const step = document.createElement("span");
      step.className = "fcStep";
      step.setAttribute("aria-hidden", "true");
      step.textContent = FC_COPY.step(1);
      const btn = document.createElement("button");
      btn.id = "btnFlightSkip";
      btn.className = "btn-arcade fcSkip";
      btn.type = "button";
      btn.tabIndex = -1;   // Enter / Space are swallowed in play (30-input.js): Esc is the keyboard skip
      btn.setAttribute("aria-label", FC_COPY.skipLabel);
      btn.setAttribute("aria-keyshortcuts", "Escape");
      btn.textContent = FC_COPY.skipKbd;
      panel.appendChild(step);
      panel.appendChild(btn);
      (document.getElementById("main") || document.body).appendChild(panel);
    }
    const ui = { panel, step: panel.querySelector(".fcStep"), btn: panel.querySelector("#btnFlightSkip") };
    if (ui.btn && !ui.btn.dataset.fcBound) {
      ui.btn.dataset.fcBound = "1";
      ui.btn.addEventListener("click", () => {
        this.skipFlightCheck("button");
        this.focusGameCanvas({ gesture: true });   // the click is a gesture: the soft keyboard may come back
      });
    }
    this._fcUi = ui;
    return ui;
  },

  fcSetStepUi(n) {
    const ui = this._fcUi;
    if (!ui || !ui.step) return;
    const text = FC_COPY.step(n);
    if (ui.step.textContent !== text) ui.step.textContent = text;
  },

  fcShowPanel(show) {
    const ui = this._fcUi;
    if (!ui) return;
    if (show && ui.btn) {
      const label = this.touchMode ? FC_COPY.skip : FC_COPY.skipKbd;
      if (ui.btn.textContent !== label) ui.btn.textContent = label;
    }
    ui.panel.classList.toggle("hidden", !show);
  },

  // ------------------------- Probe / harness reads (allocate) -------------------------
  flightCheckState() {
    const fc = this.flightCheck;
    if (!fc) return null;
    const lock = this.lock;
    const plates = [];
    const add = (role, en) => {
      if (!en) return;
      plates.push({ role, text: en.text, x: en.x, y: en.y, lane: en.lane, holdX: en.fcHold * this.w, alive: !!en.alive,
        progress: en.progress | 0, locked: !!(lock && lock.ref === en), targetable: this.isTargetable(en) });
    };
    if (fc.step === 3) { add("far", fc.far); add("near", fc.near); }
    else if (fc.step > 0) add(fc.step === 1 ? "letter" : "word", fc.plate);
    const entry = (this.toasts || []).find((t) => t.key === FC_TOAST_KEY);
    return {
      phase: fc.phase, step: fc.step, t: fc.t, active: fc.active,
      wantRelease: fc.step === 3 && !!fc.near && !!lock && lock.ref === fc.far,
      toast: entry ? entry.el.textContent : null, shownToast: fc.shownToast, shownFinish: fc.shownFinish,
      nudges: fc.nudges, releasedBy: fc.releasedBy, plates
    };
  },

  flightCheckLastResult() {
    return this._fcLast ? { ...this._fcLast, steps: this._fcLast.steps.slice() } : null;
  },

  fcEmit(name, payload) {
    if (typeof this.hook === "function") this.hook(name, payload);
  },

  // ------------------------- Briefing (spec-onboard 3.4) -------------------------
  // First-run Launch shows the 3-line summary with the full briefing closed; "Re-read briefing" opens it.
  briefingOnShow(evt) {
    const more = document.getElementById("storyMore");
    if (more) more.open = !(evt && evt.launch);
    this.briefingSyncBody();
    const modal = this.storyModal;
    if (modal && typeof this.updateModalScroll === "function") requestAnimationFrame(() => this.updateModalScroll(modal));
  },

  briefingInit() {
    const more = document.getElementById("storyMore");
    if (!more || more.dataset.fcBound) return;
    more.dataset.fcBound = "1";
    this.briefingSyncBody();
    more.addEventListener("toggle", () => {
      this.briefingSyncBody();
      if (typeof this.updateModalScroll === "function") this.updateModalScroll(this.storyModal || document.getElementById("storyModal"));
    });
  },

  // The scroll body is a Tab stop (bindModals gives it tabindex 0) only while the disclosure is open. Chrome lays out a
  // closed <details> body with content-visibility: hidden, so focusables() still lists it but focus() cannot land on it,
  // and the modal's Tab trap would stall on the summary.
  briefingSyncBody() {
    const more = document.getElementById("storyMore");
    const body = more && more.querySelector(".modalBody");
    if (!body) return;
    const t = more.open ? "0" : "-1";
    if (body.getAttribute("tabindex") !== t) body.setAttribute("tabindex", t);
  }
});

// Self-boot for the briefing disclosure (99-boot.js constructs the game synchronously, so window.game exists by then).
if (typeof document !== "undefined") {
  const fcBootBriefing = () => {
    const g = window.game;
    if (g && typeof g.briefingInit === "function") {
      try { g.briefingInit(); } catch (err) { console.error("[TypeR] briefingInit", err); }
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fcBootBriefing);
  else setTimeout(fcBootBriefing, 0);
}
