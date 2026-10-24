// Type-R 198X — MODES track (D9): run.mode, the seeded Daily Sortie, Endless Drift, Drill, the title deck and the mode
// results card. Loads after 50-boss.js. Hooks consumed: runWillStart, levelWillStart, waveWillStart, tick, bossWillApproach,
// enemyTextWillPick, powerupWillSpawn, damageWillApply, leak, scoreWillAdd, gameOverWillStart, restartWillRun,
// restartWillAsk, modeChange, pauseScreenFilled, sectorCardWillShow, menuRender, keyEscape, comboTierWillShow; emitted:
// modesRunStart, modesRunEnd. Top-level names MODES_* / modes*. A mode run never touches save.run, the high score,
// sectorBests or unlocks; exactly one storeSave per finished mode run.
// Daily: one sector, three waves, this._rng reseeded per wave from the date. Endless / drill: wave index 1 with the
// stream in this.waveTuning and MODES' own text. Feature-detected: PACE pacePilot, WORDS COMMON_WORDS, MEASURE typist*.

const MODES_LIST = ["daily", "endless", "drill"];
const MODES_SALT = { sector: 0x5EC70A1D, wave: 0x9E3779B1 };
const MODES_MEDAL = { goldMul: 1.10, silverMul: 0.95, minDays: 3, windowDays: 7, accGold: 97, accSilver: 93, minIntervals: 20 };
const MODES_DAILY_KEEP_DAYS = 60;
const MODES_QUOTA_INF = 1e9;
const MODES_ENDLESS = { stepS: 20, stepCps: 0.3, startMul: 0.7, weakShare: 0.35, commonLow: 0.5, commonHigh: 0.3, commonHighFromLevel: 6,
  speedSlope: 16, speedCap: 220, peakWindowMs: 10000, peakMinIntervals: 8, powerups: ["SPREAD", "PIERCE", "RAPID", "MULTI"] };
const MODES_DRILL = { durationS: 60, cpsMul: 1.1, cpsMin: 1.2, cpsMax: 9.0, weakShare: 0.6, letterRatio: 0.30, wordMin: 3, wordMaxLo: 5,
  wordMaxHi: 8, warnAtS: 10, minTries: 3, bestMinN: 10, bestMinKeys: 20 };
const MODES_OUTRO_S = { clear: 1.4, leak: 1.0, time: 1.0, lost: 0 };
const MODES_POOL_MIN = 12;
const MODES_MEDALS = ["GOLD", "SILVER", "BRONZE"];
const MODES_HUD_LABEL = { daily: "Daily", endless: "Drift", drill: "Drill" };
const MODES_AGAIN = { daily: "Fly again", endless: "Drift again", drill: "Drill again" };
const MODES_HOOKS = ["levelWillStart", "waveWillStart", "tick", "bossWillApproach", "enemyTextWillPick", "powerupWillSpawn", "damageWillApply",
  "leak", "scoreWillAdd", "gameOverWillStart", "restartWillRun", "restartWillAsk", "modeChange", "pauseScreenFilled", "sectorCardWillShow",
  "menuRender", "keyEscape"];

// --- Pure helpers (window globals; t-modes-rng) ---
function modesMulberry32(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// murmur3 fmix32: decorrelates consecutive dates.
function modesHash32(x) {
  let h = x >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function modesWaveSeed(key, w) {
  return modesHash32((key + Math.imul((w | 0) + 1, MODES_SALT.wave)) >>> 0);
}

function modesDateKey(d) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function modesKeyToDate(key) {
  const k = key | 0;
  return new Date(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100, 12);   // noon: DST-safe
}

function modesAddDays(key, n) {
  const d = modesKeyToDate(key);
  d.setDate(d.getDate() + (n | 0));
  return modesDateKey(d);
}

function modesPad2(n) {
  return String(n | 0).padStart(2, "0");
}

function modesIsoDate(key) {
  const k = key | 0;
  return `${Math.floor(k / 10000)}-${modesPad2(Math.floor(k / 100) % 100)}-${modesPad2(k % 100)}`;
}

// "FRI 23 OCT" (locale-free); modesLongDate "Friday 23 October" (aria only).
function modesShortDate(key) {
  const d = modesKeyToDate(key);
  return `${"SUNMONTUEWEDTHUFRISAT".substr(d.getDay() * 3, 3)} ${d.getDate()} ${"JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC".substr(d.getMonth() * 3, 3)}`;
}

function modesLongDate(key) {
  try { return modesKeyToDate(key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }); } catch (_) { return modesIsoDate(key); }
}

// Today's sector: one of the top three unlocked (U = lastUnlockedLevel).
function modesDailySectorFor(key, U) {
  const top = clamp(U | 0 || 1, 1, 10);
  const lo = Math.max(1, top - 2);
  return lo + Math.floor(modesMulberry32(modesHash32(((key | 0) ^ MODES_SALT.sector) >>> 0))() * (top - lo + 1));
}

function modesMedian(arr) {
  const a = (Array.isArray(arr) ? arr : []).filter(Number.isFinite).sort((x, y) => x - y);
  const m = a.length >> 1;
  return !a.length ? 0 : a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// D9 medal (prior = counted ratings of the 7 days before). Lead ruling Q5: a sortie ending in death caps at SILVER on
// every path. The printed thresholds are the ones compared (integer ratings), so "GOLD AT 49" and the stamp agree.
function modesMedalFor(rating, accPct, prior, lost = false) {
  if (rating == null || !Number.isFinite(rating)) return { medal: null, rule: { none: true } };
  const K = MODES_MEDAL;
  const list = (Array.isArray(prior) ? prior : []).filter(Number.isFinite);
  const med = list.length >= K.minDays ? modesMedian(list) : 0;
  let medal, rule;
  if (med > 0) {
    rule = { median: med, goldAt: Math.ceil(K.goldMul * med - 1e-9), silverAt: Math.ceil(K.silverMul * med - 1e-9) };
    medal = rating >= rule.goldAt ? "GOLD" : rating >= rule.silverAt ? "SILVER" : "BRONZE";
  } else {
    rule = { acc: true };
    medal = accPct >= K.accGold ? "GOLD" : accPct >= K.accSilver ? "SILVER" : "BRONZE";
  }
  if (lost && medal === "GOLD") { medal = "SILVER"; rule.capped = true; }
  return { medal, rule };
}

function modesStreakAfter(streak, key) {
  const s = streak || {};
  const k = key | 0;
  if ((s.last | 0) === k) return { n: Math.max(1, s.n | 0), last: k };
  return { n: (s.last | 0) === modesAddDays(k, -1) ? (s.n | 0) + 1 : 1, last: k };
}

// Shown while alive (last counted sortie today or yesterday) and >= 2; a broken streak simply stops showing (D9).
function modesStreakShown(streak, today) {
  if (!streak || (streak.n | 0) < 2) return 0;
  const last = streak.last | 0;
  return (last === (today | 0) || last === modesAddDays(today, -1)) ? (streak.n | 0) : 0;
}

// Stream for a char rate: piecewise-linear over LEVELS (ascending targetCps); past sector 10 only the speed rises.
// eqLevel = the highest sector with targetCps <= cps (min 1).
function modesStreamParams(cps) {
  const c = Number(cps) || 0;
  const n = LEVELS.length;
  let a = 0;
  while (a < n - 1 && LEVELS[a + 1].targetCps <= c) a++;
  const r0 = LEVELS[a];
  const r1 = (c > LEVELS[0].targetCps && a < n - 1) ? LEVELS[a + 1] : r0;
  const f = r1 === r0 ? 0 : (c - r0.targetCps) / (r1.targetCps - r0.targetCps);
  const L = (k) => lerp(r0[k], r1[k], f);
  const p = { eqLevel: r0.level, speed: L("speed"), letterRatio: L("letterRatio"), wordMin: Math.round(L("wordMin")), wordMax: Math.round(L("wordMax")), maxEnemies: Math.round(L("maxEnemies")) };
  if (a === n - 1) p.speed = Math.min(MODES_ENDLESS.speedCap, r0.speed + MODES_ENDLESS.speedSlope * (c - r0.targetCps));
  return p;
}

function modesFmtClock(s) {
  const v = Math.max(0, s | 0);
  return `${Math.floor(v / 60)}:${modesPad2(v % 60)}`;
}

function modesTitleCase(s) {
  return String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// TYPE-R 198X · DAILY 2026-10-23 · S4 HOLO TITAN · 52 WPM · 97% · RATING 49 · GOLD · STREAK 3 · typer198x.com
function modesShareLine(r) {
  if (!r) return "";
  const rating = Number.isFinite(r.rating) ? `RATING ${Math.round(r.rating)}${r.medal ? ` · ${r.medal}` : ""}` : "NO RATING";
  return `TYPE-R 198X · DAILY ${modesIsoDate(r.dateKey)} · S${r.sector | 0} ${String(r.bossName || "").toUpperCase()} · ${Number.isFinite(r.speed) ? Math.round(r.speed) : "--"} WPM · ` +
    `${Math.floor(Number(r.acc) || 0)}% · ${rating}${(r.streak | 0) >= 2 ? ` · STREAK ${r.streak | 0}` : ""} · typer198x.com`;
}

// save.modes normalised (CONTRACT 3.1): unknown fields dropped, the newest 60 days kept in ascending key order.
function modesNormalise(m) {
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  const int = (v) => { const x = Math.floor(Number(v)); return x > 0 ? x : 0; };
  const num = (v) => (v === null || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);
  const pct = (v, dp) => { const x = num(v); return x === null ? 0 : Math.round(clamp(x, 0, 100) * dp) / dp; };
  const isKey = (k) => /^\d{8}$/.test(String(k));
  const sec = (v) => { const x = Number(v) | 0; return x >= 1 && x <= 10 ? x : 0; };
  const src = obj(m), d = obj(src.daily), e = obj(src.endless), r = obj(src.drill), t0 = obj(d.today), raw = obj(d.days), st = obj(d.streak);
  const eb = obj(e.best), db = obj(r.best);
  const days = {};
  Object.keys(raw).filter((k) => isKey(k) && sec(obj(raw[k]).sector)).sort((a, b) => b - a).slice(0, MODES_DAILY_KEEP_DAYS).reverse().forEach((k) => {
    const x = raw[k], rating = num(x.rating), speed = num(x.speed);
    days[k] = { sector: sec(x.sector), rating: rating === null ? null : Math.round(rating), medal: MODES_MEDALS.indexOf(x.medal) >= 0 ? x.medal : null,
      speed: speed === null ? null : Math.round(speed), acc: pct(x.acc, 100), result: x.result === "lost" ? "lost" : "clear", t: int(x.t) };
  });
  return {
    v: 1,
    daily: { today: isKey(t0.date) && sec(t0.sector) ? { date: Number(t0.date), sector: sec(t0.sector), attempts: int(t0.attempts) } : null,
      days, flown: int(d.flown), streak: { n: int(st.n), last: isKey(st.last) ? Number(st.last) : 0 } },
    endless: { best: num(eb.ceiling) > 0 ? { ceiling: Math.round(eb.ceiling), timeMs: int(eb.timeMs), peak: int(eb.peak), acc: pct(eb.acc, 10), t: int(eb.t) } : null, runs: int(e.runs) },
    drill: { best: num(db.speed) >= 0 && num(db.acc) !== null ? { speed: Math.round(db.speed), acc: pct(db.acc, 10), t: int(db.t) } : null, runs: int(r.runs) }
  };
}

function modesRating(speed, acc) {
  return Number(speed) * Math.pow((Number(acc) || 0) / 100, 2);
}

function modesPick(g, list) {
  return list[Math.floor(g.rand() * list.length)];
}

function modesMeanLen(pool) {
  let s = 0;
  for (const w of pool) s += w.length;
  return pool.length ? s / pool.length : 0;
}

Object.assign(Game.prototype, {
  // --- Support, gate, reads ---
  modesSupported() {
    if (this._modesOk === undefined) {
      this._modesOk = typeof this.runMode === "function" && typeof this.waveTuningNow === "function" && typeof GAME_HOOKS === "object" &&
        MODES_HOOKS.every((n) => Array.isArray(GAME_HOOKS[n]));
    }
    return this._modesOk && !!this.screens().modeResults;
  },

  // Locked while the save is fresh by ONBOARD's rules 2-5 (R20 / R36): sessions read through typistSessions.
  modesUnlocked() {
    const s = this.save;
    if (!s) return false;
    if (Number(s.onboardingDone) > 0 || ((s.lastUnlockedLevel | 0) || 1) > 1 || (s.victories | 0) > 0 || (s.bestWpm | 0) > 0) return true;
    if ((Array.isArray(s.highScores) && s.highScores.length) || Object.keys(s.sectorBests || {}).length || (s.tutorialSeen && s.tutorialSeen.lock)) return true;
    let rows = null;
    try { rows = typeof this.typistSessions === "function" ? this.typistSessions(100) : null; } catch (_) { rows = null; }
    return Array.isArray(rows) && rows.some((r) => r && r.mode !== "flightcheck");
  },

  modesNow() {
    return this._modesNow != null ? new Date(this._modesNow) : new Date();
  },

  modesRead() {
    return modesNormalise(this.save && this.save.modes);
  },

  modesActive() {
    return this._modes ? this._modes.mode : null;
  },

  modesUnlockedLevel() {
    return clamp((this.save.lastUnlockedLevel | 0) || 1, 1, 10);
  },

  modesDailyInfo() {
    const key = modesDateKey(this.modesNow());
    const m = this.modesRead();
    const today = m.daily.today && m.daily.today.date === key ? m.daily.today : null;
    const sector = today ? today.sector : modesDailySectorFor(key, this.modesUnlockedLevel());
    const rec = m.daily.days[key] || null;
    return {
      key, iso: modesIsoDate(key), short: modesShortDate(key), sector, bossName: LEVELS[sector - 1].bossName, flown: !!rec,
      medal: rec ? rec.medal : null, rating: rec ? rec.rating : null, attempts: today ? today.attempts : 0, sorties: m.daily.flown,
      daysFlown: typeof this.typistDaysFlown === "function" ? this.typistDaysFlown() : m.daily.flown,
      streak: modesStreakShown(m.daily.streak, key), unlocked: this.modesUnlocked()
    };
  },

  // Card-side bests: the max of MEASURE's profile.bests and save.modes (R17).
  modesBests() {
    const m = this.modesRead();
    const p = this.save && this.save.profile;
    const pb = (p && p.bests) || {};
    const eb = m.endless.best, pd = pb.drill;
    let drill = m.drill.best ? { speed: m.drill.best.speed, acc: m.drill.best.acc } : null;
    if (pd && Number(pd.speed) > 0 && (!drill || modesRating(pd.speed, pd.acc) > modesRating(drill.speed, drill.acc))) drill = { speed: Math.round(pd.speed), acc: Number(pd.acc) || 0 };
    let daily = 0;
    for (const k in m.daily.days) daily = Math.max(daily, m.daily.days[k].rating | 0);
    return { ceiling: Math.max(pb.ceiling | 0, eb ? eb.ceiling : 0), ceilingTimeMs: eb ? eb.timeMs : 0, drill, dailyBestRating: daily };
  },

  // pilotCps (D2): PACE's pacePilot, else MEASURE's lifetime speed (>= 60 intervals), else the sector-1 table.
  modesPilotCps() {
    if (typeof this.pacePilot === "function") {
      try { const p = this.pacePilot(LEVELS[0]); if (p && Number(p.cps) > 0) return Number(p.cps); } catch (_) { /* fallback */ }
    }
    const s = typeof this.typistSpeed === "function" ? this.typistSpeed("lifetime") : null;
    return s && (s.n | 0) >= 60 && s.wpm > 0 ? s.wpm / 12 : LEVELS[0].targetCps;
  },

  // Weak keys / bigram with their profile numbers before the run (the drill lines compare against them).
  modesWeakPlan() {
    const keys = typeof this.typistWeakKeys === "function" ? Array.from(this.typistWeakKeys() || []).filter((k) => /^[a-z]$/.test(k)).slice(0, 3) : [];
    const bg = typeof this.typistWeakBigram === "function" ? this.typistWeakBigram() : null;
    const ks = (k) => (typeof this.typistKeyStats === "function" && this.typistKeyStats(k)) || {};
    const bs = typeof this.typistBigramStats === "function" && typeof bg === "string" && /^[a-z]{2}$/.test(bg) ? this.typistBigramStats(bg) : null;
    return { weak: keys.map((k) => ({ key: k, profileErr: Number(ks(k).err) || 0 })), bigram: bs ? { bg, profileMs: Number(bs.ms) || 0 } : null };
  },

  modesPlan(mode) {
    const key = modesDateKey(this.modesNow());
    const U = this.modesUnlockedLevel();
    const plan = { mode, dateKey: key, seed: 0, counted: false, attempt: 1, levelIndex: 0, sector: 1, cps: 0, weak: [], bigram: null };
    if (mode === "daily") {
      const m = this.modesRead();
      const today = m.daily.today && m.daily.today.date === key ? m.daily.today : null;
      plan.sector = today ? today.sector : modesDailySectorFor(key, U);
      plan.counted = !m.daily.days[key];
      plan.attempt = (today ? today.attempts : 0) + 1;
      plan.seed = key;
    } else {
      Object.assign(plan, this.modesWeakPlan());
      const pilot = this.modesPilotCps();
      if (mode === "endless") {
        plan.cps = Math.max(LEVELS[0].targetCps, MODES_ENDLESS.startMul * pilot);
        plan.sector = clamp(Math.min(modesStreamParams(plan.cps).eqLevel, U), 1, 10);
      } else plan.cps = clamp(MODES_DRILL.cpsMul * pilot, MODES_DRILL.cpsMin, MODES_DRILL.cpsMax);
    }
    plan.levelIndex = plan.sector - 1;
    return plan;
  },

  // --- Run lifecycle ---
  // Synchronous start (deck, Fly again, Restart, probes); false for an unknown mode or a half-wired tree.
  beginModeRun(mode) {
    if (MODES_LIST.indexOf(mode) < 0 || !this.modesSupported()) return false;
    this.modesCleanup();
    if (typeof this.stopAttract === "function") this.stopAttract();
    const plan = this.modesPlan(mode);
    const i = plan.levelIndex, L = i + 1;
    // The campaign stays untouched: no beginRunAt / bankAbandonedRun, save.run never read or written, no runMeta.
    this.runMeta = null;
    this.setPlayerShip(this.getSelectedShipId());
    this.levelIndex = i;
    this.stats = defaultStats();
    this.levelStats = defaultLevelStats();
    this.player.maxHp = this.player.hp = getHpBonusForLevel(L);
    this.player.shield = 0;
    this.power = { spread: 0, pierce: 0, rapid: 0, multiplier: 0 };
    this.toastOnce.clear();
    this._accuracyTipPending = false;
    if (this._spawnLog) this._spawnLog.length = 0;
    if (this._leakLog) this._leakLog.length = 0;
    const run = this.run = this.newRunRecord(i, L);
    run.mode = mode;
    run.seed = plan.seed | 0;
    run.modeDate = plan.dateKey | 0;
    const daily = mode === "daily";
    const M = this._modes = {
      mode, levelIndex: i, sector: L, dateKey: plan.dateKey, seed: plan.seed, counted: plan.counted, attempt: plan.attempt,
      clock: 0, ended: false, endReason: null, outroT: 0, outroDur: 0, result: null, shown: false, goShown: false,
      rng: modesMulberry32(modesWaveSeed(plan.dateKey, 0)), cps: plan.cps, cps0: plan.cps, step: 0, nextStepAt: MODES_ENDLESS.stepS, peak10: 0, nextSampleAt: 1,
      eqLevel: 1, letterRatio: 0, letters: "", weakLetters: "", commonShare: 0, poolMean: 0,
      weakShare: (plan.weak.length || plan.bigram) ? (mode === "drill" ? MODES_DRILL.weakShare : MODES_ENDLESS.weakShare) : 0,
      commonPool: [], themedPool: [], weakWords: [], win: { min: 0, max: 0 }, pools: false,
      weak: plan.weak, bigram: plan.bigram, weakKeys: plan.weak.map((w) => w.key).join(""), leaks: 0, warned: false, hudSec: -1, hudText: ""
    };
    this._modesLast = mode;
    this._rng = daily ? () => M.rng() : null;   // one closure per run; waveWillStart reseeds M.rng per wave
    this.modesApplyChrome(mode);
    this._sectorCardSaid = "";
    this.startLevel(i, { fromMenu: true, fresh: true });
    if (!daily) {
      this.wave = run.wave = 1;   // the neutral row (WAVE_* multipliers 1.0, full window): the intro calls beginWave(1)
      if (mode === "endless" && typeof this.warmPlateCache === "function") this.warmPlateCache(9);   // plates to 16 chars
    }
    const said = this._sectorCardSaid || "";
    this.announce(`${this.modesStartSpeech(M)}${said ? " " + said : ""}`);
    this.hook("modesRunStart", { mode, levelIndex: i, sector: L, dateKey: M.dateKey, seed: M.seed, counted: M.counted });
    return true;
  },

  // Deck / card path: gate, pilot name, audio unlock, then the synchronous start.
  async startModeRun(mode) {
    const ready = () => this.mode === "menu" || this.mode === "modeResults";
    if (this._modesStarting || this._launchBusy || !ready() || !this.modesSupported() || !this.modesUnlocked()) return false;
    this._modesStarting = true;
    try {
      if (typeof this.readPilotName === "function") this.readPilotName();
      this.uiTick("confirm");
      if (typeof this.ensureAudio === "function") await this.ensureAudio();
      const ok = ready() && this.beginModeRun(mode);
      if (ok) this.focusGameCanvas();
      return ok;
    } finally {
      this._modesStarting = false;
    }
  },

  // Drops a mode run (menu, campaign start, a new mode run). this.run goes to null, never to save.run: the live
  // player / stats are the mode's, and every campaign entry re-derives this.run itself.
  modesCleanup() {
    const card = document.getElementById("resultsMode");
    if (card && typeof this.cancelResultsAnimation === "function") this.cancelResultsAnimation(card);
    this._rng = null;
    this._modes = null;
    this.modesApplyChrome(null);
    if (this.run && this.run.mode && this.run.mode !== "campaign") this.run = null;
  },

  modesRestart() {
    const mode = (this._modes && this._modes.mode) || this._modesLast;
    this.uiTick("confirm");
    const ok = !!mode && this.beginModeRun(mode);
    if (ok) this.focusGameCanvas();
    return ok;
  },

  // Pause -> Restart: a counted daily attempt in progress confirms first (it ends without a result).
  async modesRestartPressed() {
    const M = this._modes;
    if (!M) return false;
    if (M.mode === "daily" && M.counted && !M.ended && ((this.wave | 0) > 0 || (this.stats.score | 0) > 0)) {
      const ok = await this.confirm({ eyebrow: "Daily sortie", title: "Restart the sortie?", body: "This attempt ends without a result. Your next finished sortie counts.",
        okLabel: "Restart", cancelLabel: "Keep flying" });
      if (!ok || this._modes !== M) return false;
    }
    return this.modesRestart();
  },

  // --- Chrome (event-driven DOM writes, originals captured before the first change) ---
  modesChromeEls() {
    if (this._modesChrome) return this._modesChrome;
    const $ = (id) => document.getElementById(id);
    const txt = (el) => (el ? el.textContent : "");
    const tile = (id) => { const v = $(id), l = v && v.previousElementSibling; return { v, l, orig: txt(l) }; };
    const lvl = $("hudLevel"), score = $("hudScore"), stop = this.btnStop, quit = $("btnPauseQuit");
    return (this._modesChrome = {
      levelLabel: lvl && lvl.previousElementSibling, levelOrig: txt(lvl && lvl.previousElementSibling) || "Sector",
      scoreCell: score && score.closest(".hudCell"), mult: $("hudMult"),
      stopOrig: txt(stop && (stop.querySelector(".btnLabel") || stop)) || "Save & quit", stopTitle: (stop && stop.getAttribute("title")) || "",
      restartOrig: txt(this.btnRestart) || "Restart sector", quit, quitOrig: txt(quit) || "Save & quit",
      tiles: [tile("pauseSector"), tile("pauseWave"), tile("pauseScore")], eyebrow: $("pauseEyebrow")
    });
  },

  modesSetText(el, s) {
    if (el && el.textContent !== s) el.textContent = s;
  },

  modesApplyChrome(mode) {
    const E = this.modesChromeEls();
    const ds = document.body.dataset;
    if (mode) { if (ds.runMode !== mode) ds.runMode = mode; } else if (ds.runMode !== undefined) delete ds.runMode;
    this.modesSetText(E.levelLabel, mode ? MODES_HUD_LABEL[mode] : E.levelOrig);
    if (E.scoreCell) E.scoreCell.classList.toggle("modesHidden", mode === "drill");
    if (E.mult) E.mult.classList.toggle("modesHidden", mode === "drill");
    if (this.btnStop) {
      this.setBtnLabel(this.btnStop, mode ? "Quit" : E.stopOrig);
      const title = mode ? "Return to the menu" : E.stopTitle;
      if (this.btnStop.getAttribute("title") !== title) this.btnStop.setAttribute("title", title);
    }
    if (!mode) this.modesFillPause();
  },

  // H16 provider: endless elapsed / drill remaining as m:ss (rebuilt when the whole second changes); daily null.
  modesHudLevel() {
    const M = this._modes;
    if (!M || M.mode === "daily") return null;
    const s = M.mode === "drill" ? this.modesLeftS(M) : Math.floor(M.clock);
    if (s !== M.hudSec) { M.hudSec = s; M.hudText = modesFmtClock(s); }
    return M.hudText;
  },

  modesLeftS(M) {
    return Math.max(0, Math.ceil(MODES_DRILL.durationS - M.clock - 1e-9));
  },

  // Pause screen (H15): mode copy, or the campaign labels restored.
  modesFillPause() {
    const E = this.modesChromeEls();
    const M = this._modes;
    const set = (el, s) => this.modesSetText(el, s);
    const [t1, t2, t3] = E.tiles;
    for (const t of E.tiles) set(t.l, t.orig);
    set(this.btnRestart, M ? `Restart ${{ daily: "sortie", endless: "drift", drill: "drill" }[M.mode]}` : E.restartOrig);
    set(E.quit, M ? "Quit to menu" : E.quitOrig);
    if (!M) return;
    if (M.mode === "daily") set(E.eyebrow, `Paused // Daily sortie · Sector ${modesPad2(M.sector)}`);
    else if (M.mode === "endless") {
      set(E.eyebrow, "Paused // Endless drift");
      set(t1.l, "Stream"); set(t1.v, `${Math.round(M.cps * 12)} WPM`);
      set(t2.l, "Time"); set(t2.v, modesFmtClock(Math.floor(M.clock)));
    } else {
      const s = typeof this.typistSpeed === "function" ? this.typistSpeed("sector") : null;
      set(E.eyebrow, "Paused // Drill");
      set(t1.l, "Left"); set(t1.v, modesFmtClock(this.modesLeftS(M)));
      set(t2.l, "Keys"); set(t2.v, String(this.levelStats.correct | 0));
      set(t3.l, "WPM"); set(t3.v, s && s.wpm != null ? String(Math.round(s.wpm)) : "--");
    }
  },

  // --- Stream (endless / drill) ---
  // The stream in this.waveTuning (wave index 1): no end by quota or time, field capped by the stream, spawn rate
  // scaled so the delivered chars/s equals cps for MODES' own text mix (G9, R33).
  modesApplyTuning(t, cps) {
    const M = this._modes;
    if (!M || !t) return;
    const base = LEVELS[M.levelIndex];
    const p = modesStreamParams(cps);
    const drill = M.mode === "drill";
    M.eqLevel = p.eqLevel;
    M.letterRatio = drill ? MODES_DRILL.letterRatio : p.letterRatio;
    const letters = drill ? LETTER_SETS.full : (LETTER_SETS[letterSetKeysForLevel(p.eqLevel)[1]] || LETTER_SETS.full);
    if (letters !== M.letters) {
      M.letters = letters;
      M.weakLetters = M.weakKeys.split("").filter((k) => letters.indexOf(k) >= 0).join("");
    }
    M.commonShare = drill ? 1 : p.eqLevel < MODES_ENDLESS.commonHighFromLevel ? MODES_ENDLESS.commonLow : MODES_ENDLESS.commonHigh;
    const min = drill ? MODES_DRILL.wordMin : p.wordMin;
    const max = drill ? clamp(p.wordMax, MODES_DRILL.wordMaxLo, MODES_DRILL.wordMaxHi) : p.wordMax;
    if (!M.pools || min !== M.win.min || max !== M.win.max) { M.win.min = min; M.win.max = max; this.modesRebuildPools(M); }
    this.modesPoolMean(M);
    t.quota = MODES_QUOTA_INF;
    t.cap = Infinity;
    t.pressureCap = Math.max(PRESSURE_VALVE_MIN_CHARS, Math.round(cps * PRESSURE_VALVE_CPS_WINDOW));
    const cpe = M.letterRatio + (1 - M.letterRatio) * M.poolMean;
    const rate = waveSpawnRate(base, 1, 0, MODES_QUOTA_INF);
    t.spawnMul = rate > 0 && cpe > 0 ? cps / cpe / rate : 1;
    t.maxEnemiesAdd = p.maxEnemies - base.maxEnemies;
    t.speedMul = p.speed / base.speed;
    t.hungryMinAlive = HUNGRY_MIN_ALIVE;
  },

  // Pools for the length window (allocates: at most once per 20 s step in endless, once per drill). Common words are
  // WORDS' COMMON_WORDS (else ALL_WORDS); themed words are the wave pools' (WAVE_WORDS, after WORDS' clean-up).
  modesRebuildPools(M) {
    const lo = M.win.min, hi = M.win.max;
    const fit = (w) => typeof w === "string" && w.length >= lo && w.length <= hi && /^[a-z]+$/.test(w);
    const commonSrc = typeof COMMON_WORDS !== "undefined" && Array.isArray(COMMON_WORDS) && COMMON_WORDS.length ? COMMON_WORDS : ALL_WORDS;
    let common = commonSrc.filter(fit);
    if (common.length < MODES_POOL_MIN) common = ALL_WORDS.filter(fit);
    let themed = M.mode === "drill" ? [] : (typeof WAVE_WORDS !== "undefined" ? WAVE_WORDS : ALL_WORDS).filter(fit);
    if (M.mode !== "drill" && themed.length < MODES_POOL_MIN) themed = common;
    const bg = M.bigram ? M.bigram.bg : "";
    const hit = (w) => (bg && w.indexOf(bg) >= 0) || M.weakKeys.split("").some((k) => w.indexOf(k) >= 0);
    M.commonPool = common;
    M.themedPool = themed;
    M.weakWords = (M.weakKeys || bg) ? [...new Set(common.concat(themed))].filter(hit) : [];
    M.commonMean = modesMeanLen(common);
    M.themedMean = modesMeanLen(themed);
    M.weakMean = modesMeanLen(M.weakWords);
    M.pools = true;
  },

  // Expected word length of modesPickText's mix (a share that cannot apply counts as 0).
  modesPoolMean(M) {
    const wS = M.weakWords.length ? M.weakShare : 0;
    const cS = M.commonPool.length >= MODES_POOL_MIN ? M.commonShare : 0;
    return (M.poolMean = wS * M.weakMean + (1 - wS) * (cS * M.commonMean + (1 - cS) * (M.themedPool.length ? M.themedMean : M.commonMean)));
  },

  // H6 (endless / drill): indexes into prebuilt arrays / strings, no allocation, every draw this.rand().
  modesPickText() {
    const M = this._modes;
    if (this.rand() < M.letterRatio) return modesPick(this, (M.weakLetters.length && this.rand() < M.weakShare) ? M.weakLetters : M.letters);
    let pool;
    if (M.weakWords.length && this.rand() < M.weakShare) pool = M.weakWords;
    else if (M.commonPool.length >= MODES_POOL_MIN && this.rand() < M.commonShare) pool = M.commonPool;
    else pool = M.themedPool.length ? M.themedPool : M.commonPool;
    if (!pool.length) return modesPick(this, M.letters);
    const recent = this.recentWords || (this.recentWords = []);
    let w = modesPick(this, pool);
    for (let i = 0; i < 6 && recent.includes(w); i++) w = modesPick(this, pool);
    recent.push(w);
    if (recent.length > 12) recent.shift();
    return w;
  },

  // --- Clock (tick listener; modesDebug().advance) ---
  modesTick(dt) {
    const M = this._modes;
    if (!M || this.runMode() !== M.mode) return;
    if (M.ended) {
      if (M.outroDur > 0 && !M.shown && (M.outroT += dt) >= M.outroDur) this.modesShowResults();
    } else if (M.mode !== "daily" && !this.levelIntro) this.modesAdvance(dt);
  },

  modesAdvance(dt) {
    const M = this._modes;
    if (!M || M.ended || M.mode === "daily") return;
    M.clock += Math.max(0, Number(dt) || 0);
    if (M.mode === "drill") {
      if (!M.warned && M.clock >= MODES_DRILL.durationS - MODES_DRILL.warnAtS) {
        M.warned = true;
        this.showBanner({ kind: "callout", title: "10 SECONDS", color: "amber" });
        this.announce("10 seconds left");
      }
      if (M.clock >= MODES_DRILL.durationS) this.modesFinish("time");
      return;
    }
    while (M.clock >= M.nextStepAt) {
      M.cps += MODES_ENDLESS.stepCps;
      M.step++;
      M.nextStepAt += MODES_ENDLESS.stepS;
      this.modesApplyTuning(this.waveTuningNow(), M.cps);
      const wpm = Math.round(M.cps * 12);
      this.showBanner({ kind: "callout", title: `SIGNAL RISING · ${wpm} WPM`, color: "cyan" });
      this.announce(`Signal rising, ${wpm} words per minute`);
    }
    // PEAK 10 S: MEASURE's speed over the intervals that ended in the last 10 s (n >= 8), sampled each second.
    while (M.clock >= M.nextSampleAt) {
      M.nextSampleAt++;
      const s = typeof this.typistWindowSpeed === "function" ? this.typistWindowSpeed(MODES_ENDLESS.peakWindowMs) : null;
      const w = Math.round(s ? ((s.n | 0) >= MODES_ENDLESS.peakMinIntervals && s.wpm > 0 ? s.wpm : 0) : this.liveWpm());
      if (w > M.peak10) M.peak10 = w;
    }
  },

  // --- Finish, snapshot, bank ---
  // reason: clear | lost (daily), leak (endless), time (drill). Idempotent.
  modesFinish(reason) {
    const M = this._modes;
    if (!M || M.ended) return false;
    M.ended = true;
    M.endReason = reason;
    const r = M.result = this.modesSnapshot(reason);
    this.releaseLock("dead");
    this.detonateLeftovers();
    for (const p of this.powerups) { p.alive = false; p.locked = false; }
    this.setWavePhase("modeEnd");
    this.modesBank(r);
    this.hook("modesRunEnd", { mode: M.mode, reason, result: r });
    M.outroDur = MODES_OUTRO_S[reason] || 0;
    M.outroT = 0;
    if (!M.outroDur) return this.modesShowResults() || true;
    const b = M.mode === "daily" ? ["DAILY SORTIE", "SORTIE COMPLETE", r.rating != null ? `RATING ${r.rating}` : "NO RATING", r.rating != null ? `Sortie complete. Rating ${r.rating}.` : "Sortie complete. No rating."]
      : M.mode === "endless" ? ["SIGNAL BREACH", "DRIFT ENDED", `CEILING ${r.ceiling} WPM`, `Drift ended. Ceiling ${r.ceiling} words per minute.`]
        : ["DRILL", "TIME", `${r.speed != null ? r.speed : "--"} WPM AT ${r.accInt}%`, "Drill complete."];
    this.showBanner({ kind: "bossClear", eyebrow: b[0], title: b[1], sub: b[2], dur: M.outroDur });
    this.announce(b[3]);
    return true;
  },

  // The result every screen / save / session uses: read first, record second (typistEndSession last).
  // accInt is floored (here and in the share line): a printed 97% always meets the accuracy medal's GOLD AT 97%.
  modesSnapshot(reason) {
    const M = this._modes;
    const ls = this.levelStats || {};
    let speed = null, speedN = 99;
    if (typeof this.typistSpeed === "function") {
      const s = this.typistSpeed("sector");
      speedN = s.n | 0;
      speed = s.wpm != null ? Math.round(s.wpm) : null;
    } else speed = this.grossWpm(ls.chars | 0, ls.timeMs | 0) || null;
    const acc = Math.round(this.getLevelAccuracyPct() * 100) / 100;
    const m = this.modesRead();
    const r = {
      mode: M.mode, reason, sector: M.sector, bossName: LEVELS[M.levelIndex].bossName, dateKey: M.dateKey, iso: modesIsoDate(M.dateKey),
      counted: !!M.counted, attempt: M.attempt, speed, speedN, acc, accInt: Math.floor(acc), keys: ls.total | 0, timeMs: Math.round(ls.timeMs || 0),
      score: this.stats.score | 0, words: ls.words | 0, misses: this.stats.misses | 0, correct: ls.correct | 0, maxCombo: ls.maxCombo | 0,
      rating: null, medal: null, rule: null, rank: null, ceiling: 0, peak10: M.peak10, cps0: M.cps0, steps: M.step, leaks: M.leaks,
      lostWave: Math.min((this.wave | 0) + 1, 3), weakLines: [], bigramLine: "", weakSpeech: [], newBest: false, prevBest: null,
      sorties: 0, streak: 0, todayCounted: null, share: "", targets: this.modesTargetsText(M)
    };
    if (M.mode === "daily") {
      r.rating = speedN >= MODES_MEDAL.minIntervals && speed != null ? Math.round(modesRating(speed, acc)) : null;
      const prior = [];
      for (let k = 1; k <= MODES_MEDAL.windowDays; k++) { const d = m.daily.days[modesAddDays(M.dateKey, -k)]; if (d && d.rating != null) prior.push(d.rating); }
      Object.assign(r, modesMedalFor(r.rating, acc, prior, reason === "lost"));
      if (reason === "clear") r.rank = rankFor(acc, speed || 0, (ls.damageTaken | 0) === 0 ? 1 : clamp(1 - (ls.damageTaken | 0) / Math.max(1, this.player.maxHp), 0, 1), M.sector);
      const rec = m.daily.days[M.dateKey];
      const counted = r.counted && !rec;
      r.sorties = m.daily.flown + (counted ? 1 : 0);
      r.streak = modesStreakShown(counted ? modesStreakAfter(m.daily.streak, M.dateKey) : m.daily.streak, M.dateKey);
      if (counted) r.share = modesShareLine(r);
      else if (rec) {
        r.todayCounted = rec;
        r.share = modesShareLine({ ...rec, dateKey: M.dateKey, bossName: LEVELS[rec.sector - 1].bossName, streak: r.streak });
      }
    } else if (M.mode === "endless") {
      r.ceiling = Math.round(M.cps * 12);
      const p = this.save.profile;
      const prev = Math.max(p && p.bests ? p.bests.ceiling | 0 : 0, m.endless.best ? m.endless.best.ceiling : 0);
      r.prevBest = prev || null;
      r.newBest = r.ceiling > prev;
    } else {
      const prev = r.prevBest = this.modesBests().drill;
      r.newBest = speed != null && speedN >= MODES_DRILL.bestMinN && r.keys >= MODES_DRILL.bestMinKeys && (!prev || modesRating(speed, acc) > modesRating(prev.speed, prev.acc));
      this.modesDrillLines(M, r);
    }
    if (typeof this.typistEndSession === "function") {
      try {
        this.typistEndSession({ mode: M.mode, sector: M.sector, score: M.mode === "drill" ? 0 : r.score, rank: r.rank, cleared: reason === "clear",
          ceiling: r.ceiling, throughput: this.grossWpm(ls.chars | 0, r.timeMs), store: false });
      } catch (err) { console.error("[TypeR] modes session", err); }
    }
    return r;
  },

  // Drill lines: this drill's miss rate per weak key vs the profile before it, the bigram, or the most missed keys.
  modesDrillLines(M, r) {
    const ks = (k) => (typeof this.typistKeyStats === "function" && this.typistKeyStats(k)) || { segN: 0, segMiss: 0 };
    for (const w of M.weak) {
      const s = ks(w.key), K = w.key.toUpperCase(), n = s.segN | 0;
      if (n >= MODES_DRILL.minTries) {
        const rate = Math.round(100 * (s.segMiss | 0) / n), prof = Math.round(100 * w.profileErr);
        r.weakLines.push(`${K} · ${rate}% MISSED · PROFILE ${prof}%`);
        r.weakSpeech.push(`${K} missed ${rate} percent, profile ${prof}.`);
      } else r.weakLines.push(`${K} · ${n === 1 ? "1 TRY" : `${n} TRIES`}`);
    }
    if (M.bigram && typeof this.typistBigramStats === "function") {
      const b = this.typistBigramStats(M.bigram.bg), BG = M.bigram.bg.toUpperCase();
      r.bigramLine = b.segN > 0 ? `${BG} · ${b.segMs} MS · PROFILE ${Math.round(M.bigram.profileMs)} MS` : `${BG} · 0 TRIES`;
    }
    if (M.weak.length || M.bigram) return;
    r.weakLines.push("NO WEAK KEYS YET");
    const top = [];
    for (let i = 0; i < 26; i++) { const ch = String.fromCharCode(97 + i), s = ks(ch); if ((s.segMiss | 0) >= 2) top.push([ch, s.segMiss | 0]); }
    top.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
    if (top.length) r.weakLines.push(`MOST MISSED · ${top.slice(0, 3).map((x) => `${x[0].toUpperCase()} ${x[1]}`).join(" · ")}`);
  },

  // The one save write of a finished mode run (save.modes, plus the profile MEASURE just updated in memory).
  modesBank(r) {
    const m = this.modesRead();
    const t = Date.now();
    if (r.mode === "daily") {
      m.daily.today = { date: r.dateKey, sector: r.sector, attempts: r.attempt };
      if (r.counted && !m.daily.days[r.dateKey]) {
        m.daily.days[r.dateKey] = { sector: r.sector, rating: r.rating, medal: r.medal, speed: r.speed, acc: r.acc, result: r.reason === "lost" ? "lost" : "clear", t };
        m.daily.flown++;
        m.daily.streak = modesStreakAfter(m.daily.streak, r.dateKey);
      }
    } else {
      const rec = m[r.mode];
      rec.runs++;
      if (r.newBest) rec.best = r.mode === "endless" ? { ceiling: r.ceiling, timeMs: r.timeMs, peak: r.peak10, acc: r.acc, t } : { speed: r.speed, acc: r.acc, t };
    }
    this.save.modes = modesNormalise(m);
    storeSave(this.save);
  },

  // --- Results screen ---
  modesShowResults() {
    const M = this._modes;
    if (!M || M.shown || !M.result) return false;
    M.shown = true;
    this.setMode("modeResults");
    if (this.sfx) {
      if (typeof this.sfx.setMusicState === "function") this.sfx.setMusicState("end");
      if (typeof this.sfx.fanfare === "function") this.sfx.fanfare(M.result.reason === "lost" ? "gameOver" : "levelClear");
    }
    this.renderModeResults(document.getElementById("resultsMode"), M.result, { animate: true });
    this.announce(this.modesResultsSpeech(M.result));
    this.focusPrimary("modeResults");
    return true;
  },

  modesTargetsText(M) {
    const parts = M.weak.map((w) => w.key.toUpperCase());
    if (M.bigram) parts.push(M.bigram.bg.toUpperCase());
    return parts.join(" · ");
  },

  modesStartSpeech(M) {
    if (M.mode === "daily") return `Daily sortie, sector ${M.sector}, ${modesTitleCase(LEVELS[M.levelIndex].bossName)}. Three waves, no boss. ${M.counted ? "Counted attempt." : "Practice, not counted."}`;
    if (M.mode === "endless") return `Endless drift. The stream starts at ${Math.round(M.cps0 * 12)} words per minute and rises every 20 seconds. The first word that gets through ends the run.`;
    const said = M.weak.map((w) => w.key.toUpperCase());
    if (M.bigram) said.push(M.bigram.bg.toUpperCase().split("").join(" "));
    const list = said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}` : said[0];
    return `Drill, 60 seconds. ${list ? `Targets ${list}.` : "Common words."} No hull, no score.`;
  },

  modesResultsSpeech(r) {
    const spd = r.speed != null ? `${r.speed} words per minute at ${r.accInt} percent.` : `Speed not measured, accuracy ${r.accInt} percent.`;
    if (r.mode === "daily") {
      return `${r.reason === "lost" ? `Signal lost in wave ${r.lostWave} of 3.` : "Daily sortie complete."} ${r.rating != null ? `Rating ${r.rating}, ${String(r.medal).toLowerCase()}.` : "No rating, too few keys."} ` +
        `${spd} ${r.counted && !r.todayCounted ? "Counted." : "Practice, not counted."}${r.sorties > 0 ? ` Sorties ${r.sorties}${r.streak ? `, streak ${r.streak}` : ""}.` : ""} Press Enter to fly again.`;
    }
    if (r.mode === "endless") {
      const s = Math.round(r.timeMs / 1000), mm = Math.floor(s / 60), ss = s % 60;
      return `Drift ended after ${mm ? `${mm} minute${mm === 1 ? "" : "s"} ` : ""}${ss} second${ss === 1 ? "" : "s"}. Ceiling ${r.ceiling} words per minute${r.newBest ? ", a new best" : ""}. ` +
        `${r.peak10 > 0 ? `Peak ${r.peak10}.` : "Peak not measured."} Accuracy ${r.accInt} percent. Press Enter to drift again.`;
    }
    return `Drill complete. ${spd}${r.weakSpeech.length ? " " + r.weakSpeech.join(" ") : ""} Press Enter to drill again.`;
  },

  // Head, six tiles, lines, share row; count-ups and the medal stamp use the results timings (15-screens.js), and
  // card._resultsAnim lets cancelResultsAnimation stop them. Reduced motion / animate false: final values at once.
  renderModeResults(card, r, opts = {}) {
    if (!card || !r) return;
    this.cancelResultsAnimation(card);
    const animate = opts.animate !== false && !screensReducedMotion(this);
    const set = (el, s) => this.modesSetText(el, s);
    const $ = (id) => document.getElementById(id);
    const q = (sel) => card.querySelector(sel);
    const daily = r.mode === "daily", endless = r.mode === "endless";
    const time = screensFormatTime;
    card.dataset.mode = r.mode;
    card.dataset.medal = daily ? (r.medal || "NONE") : "";
    set($("modeResultsEyebrow"), daily ? `DAILY SORTIE · ${r.iso}` : endless ? "ENDLESS DRIFT" : "DRILL · 60 S");
    set($("modeResultsTitle"), daily ? (r.reason === "lost" ? "SIGNAL LOST" : "SORTIE COMPLETE") : endless ? "DRIFT ENDED" : "DRILL COMPLETE");
    set($("modeResultsText"), daily ? `Sector ${r.sector} · ${modesTitleCase(r.bossName)} · ${r.reason === "lost" ? `lost in wave ${r.lostWave}/3` : "3 waves cleared"}`
      : endless ? `Signal breach at ${time(r.timeMs)} · stream ${r.ceiling} WPM` : r.targets ? `Targets ${r.targets}` : "Common words");
    const rule = r.rule || {}, p = r.prevBest;
    set(q(".resultsTitle"), daily ? (r.counted && !r.todayCounted ? "COUNTED SORTIE" : "PRACTICE · NOT COUNTED") : endless ? `CEILING ${r.ceiling} WPM` : `${r.speed != null ? r.speed : "--"} WPM AT ${r.accInt}%`);
    set(q(".resultsHead .resultsSub"), daily
      ? (rule.none ? "TOO FEW KEYS TO RATE" : rule.acc ? "FIRST DAYS · GOLD AT 97% · SILVER AT 93%" : `7-DAY MEDIAN ${Math.round(rule.median)} · GOLD AT ${rule.goldAt} · SILVER AT ${rule.silverAt}`)
      : endless ? (r.newBest ? (p ? `NEW CEILING · WAS ${p} WPM` : "FIRST CEILING") : `BEST CEILING ${p} WPM`)
        : (r.newBest && p ? "NEW DRILL BEST" : p ? `DRILL BEST ${p.speed} WPM AT ${Math.floor(p.acc)}%` : "FIRST DRILL"));
    const n = (v) => String(Math.round(v)), pct = (v) => `${Math.round(v)}%`, big = (v) => formatInt(Math.round(v)), combo = (v) => `x${Math.round(v)}`;
    const tiles = daily ? [["Rating", r.rating, n], ["WPM", r.speed, n], ["Acc", r.accInt, pct], ["Time", r.timeMs, time], ["Score", r.score, big], ["Words", r.words, n]]
      : endless ? [["Time", r.timeMs, time], ["Ceiling", r.ceiling, n], ["Peak 10 s", r.peak10 || null, n], ["Acc", r.accInt, pct], ["Score", r.score, big], ["Combo", r.maxCombo, combo]]
        : [["WPM", r.speed, n], ["Acc", r.accInt, pct], ["Keys", r.correct, n], ["Misses", r.misses, n], ["Leaked", r.leaks, n], ["Combo", r.maxCombo, combo]];
    const anim = card._resultsAnim = { counts: [], timers: [] };
    card.querySelectorAll(".statTile__value[data-stat]").forEach((el, i) => {
      const [label, v, fmt] = tiles[i] || ["", null, n];
      set(el.previousElementSibling, label);
      el.classList.remove("is-counting");
      if (v == null) set(el, "--");
      else if (animate && v > 0) anim.counts.push(this.animateCount(el, 0, v, RESULTS_COUNT_MS, { delay: i * RESULTS_STAGGER_MS, format: fmt, tick: true }));
      else set(el, fmt(v));
    });
    const lines = [];
    if (daily) {
      if (r.sorties > 0) lines.push(`SORTIES ${r.sorties}${r.streak ? ` · STREAK ${r.streak}` : ""}`);
      const tc = r.todayCounted;
      if (tc) lines.push(`TODAY'S COUNTED SORTIE · ${tc.rating != null ? `${tc.medal} · RATING ${tc.rating}` : "NO RATING"}`);
      if (rule.capped) lines.push("GOLD NEEDS A FINISHED SORTIE");
    } else if (endless) {
      const from = Math.round(r.cps0 * 12);
      lines.push(r.steps ? `STREAM ROSE ${r.steps === 1 ? "ONCE" : `${r.steps} TIMES`} FROM ${from} WPM` : `STREAM HELD AT ${from} WPM`);
    } else lines.push(...r.weakLines, ...(r.bigramLine ? [r.bigramLine] : []));
    const ul = q(".modeLines");
    if (ul) ul.replaceChildren(...lines.map((l) => { const li = document.createElement("li"); li.textContent = l; return li; }));
    const row = q(".shareRow"), input = $("modeShareText");
    if (row) row.classList.toggle("hidden", !(daily && r.share));
    if (input && input.value !== r.share) input.value = r.share;
    this.setBtnLabel($("btnModeAgain"), MODES_AGAIN[r.mode]);
    const badge = q(".medalBadge");
    if (!badge) return;
    set(badge, daily ? (r.medal || "—") : "");
    badge.dataset.medal = card.dataset.medal;
    badge.classList.remove("stamp");
    badge.classList.toggle("is-pending", animate && daily && !!r.medal);
    if (animate && daily && r.medal) {
      anim.timers.push(setTimeout(() => {
        badge.classList.remove("is-pending");
        badge.classList.add("stamp");
        if (this.sfx && typeof this.sfx.rankStamp === "function") this.sfx.rankStamp();
        anim.timers.push(setTimeout(() => badge.classList.remove("stamp"), RESULTS_RANK_POP_MS));
      }, RESULTS_RANK_AT_MS));
    }
  },

  // Clipboard when allowed, else the selected text field + execCommand; the toast announces either outcome.
  async modesCopyShare() {
    const input = document.getElementById("modeShareText");
    const text = input ? input.value : "";
    if (!text) return false;
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (_) { ok = false; }
    const select = () => { try { input.focus(); input.select(); } catch (_) { /* no focus */ } };
    if (!ok) { select(); try { ok = !!document.execCommand("copy"); } catch (_) { ok = false; } }
    if (!ok) select();
    this.showToast(ok ? "SHARE LINE COPIED" : "COPY BLOCKED · TEXT SELECTED", { kind: ok ? "success" : "warn", key: "modes" });
    return ok;
  },

  // --- Title deck (menuRender; DOM writes only on change; never writes the save) ---
  modesDeckEls() {
    if (this._modesDeck) return this._modesDeck;
    const $ = (id) => document.getElementById(id);
    const E = this._modesDeck = { deck: $("modeDeck"), daily: $("btnDaily"), date: $("dailyDate"), sector: $("dailySector"), status: $("dailyStatus"),
      meta: $("dailyMeta"), drill: $("btnDrill"), drillSub: $("drillSub"), endless: $("btnEndless"), endlessSub: $("endlessSub"), bound: false };
    E.drillTitle = E.drill && E.drill.querySelector(".modeTile__title");
    E.endlessTitle = E.endless && E.endless.querySelector(".modeTile__title");
    return E;
  },

  modesBindDeck(E) {
    E.bound = true;
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
    for (const mode of MODES_LIST) on(`btn${mode[0].toUpperCase()}${mode.slice(1)}`, (e) => { if (e.currentTarget.getAttribute("aria-disabled") !== "true") this.startModeRun(mode); });
    on("btnModeAgain", () => { if (this.mode === "modeResults") this.modesRestart(); });
    on("btnModeMenu", () => { this.uiTick("back"); this.stopToMenu(false); });
    on("btnModeCopy", () => this.modesCopyShare());
  },

  renderModeDeck() {
    const E = this.modesDeckEls();
    if (!E.deck) return;
    const supported = this.modesSupported();
    if (supported && !E.bound) this.modesBindDeck(E);
    const set = (el, s) => this.modesSetText(el, s);
    const attr = (el, k, v) => { if (el && el.getAttribute(k) !== v) el.setAttribute(k, v); };
    if (E.deck.classList.contains("hidden")) E.deck.classList.remove("hidden");
    E.deck.classList.toggle("is-unavailable", !supported);
    const info = this.modesDailyInfo();
    const open = supported && info.unlocked;
    set(E.date, info.short);
    set(E.sector, `SECTOR ${modesPad2(info.sector)} · ${info.bossName}`);
    set(E.status, !supported ? "UNAVAILABLE" : !open ? "START A RUN TO UNLOCK" : info.flown ? `FLOWN${info.medal ? ` · ${info.medal}` : ""}` : "FLY");
    const meta = open && info.sorties > 0 ? `SORTIES ${info.sorties}${info.streak ? ` · STREAK ${info.streak}` : ""}` : "";
    set(E.meta, meta);
    if (E.meta) E.meta.classList.toggle("hidden", !meta);
    const where = `${modesLongDate(info.key)}, sector ${info.sector}, ${modesTitleCase(info.bossName)}`;
    const lock = open ? "" : supported ? " Locked: start a run to unlock." : " Unavailable.";
    attr(E.daily, "aria-label", `Daily sortie, ${where}${!open ? "." + lock : info.flown ? `, flown today${info.medal ? `, ${info.medal.toLowerCase()} medal, rating ${info.rating}` : ""}. Fly a practice attempt.` : ", not flown yet."}`);
    const targets = this.modesTargetsText(this.modesWeakPlan());
    const ceiling = this.modesBests().ceiling;
    set(E.drillTitle, "DRILL · 60 S");
    set(E.drillSub, targets ? `TARGETS ${targets}` : "COMMON WORDS");
    set(E.endlessTitle, "ENDLESS DRIFT");
    set(E.endlessSub, ceiling > 0 ? `CEILING ${ceiling} WPM` : "FIND YOUR CEILING");
    attr(E.drill, "aria-label", `Drill, 60 seconds, ${targets ? `targets ${targets.split(" · ").join(", ")}` : "common words"}.${lock}`);
    attr(E.endless, "aria-label", `Endless drift, ${ceiling > 0 ? `best ceiling ${ceiling} words per minute` : "find your ceiling"}.${lock}`);
    for (const b of [E.daily, E.drill, E.endless]) attr(b, "aria-disabled", open ? "false" : "true");
  },

  // --- Probes ---
  modesDebug() {
    const g = this;
    return {
      setNow(v) { return (g._modesNow = v == null ? null : v instanceof Date ? v.getTime() : Number(v)); },
      advance(s) { if (!g._modes || g._modes.ended) return false; g.modesAdvance(s); return true; },
      state() {
        const M = g._modes;
        if (!M) return null;
        const out = {};
        for (const k in M) if (typeof M[k] !== "function") out[k] = Array.isArray(M[k]) ? (k === "weak" ? M[k].map((w) => ({ ...w })) : M[k].length) : (M[k] && typeof M[k] === "object") ? JSON.parse(JSON.stringify(M[k])) : M[k];
        return out;
      },
      plan(mode) { return g.modesPlan(mode); },
      finish(reason) { const M = g._modes; return !!M && g.modesFinish(reason || { daily: "clear", endless: "leak", drill: "time" }[M.mode]); }
    };
  }
});

// --- Hook listeners (registered at load; this = game) ---
// Each keys on this._modes and runMode(): the Flight Check (run === null, campaign) and every campaign run see nothing.
if (typeof onGameHook === "function") {
  const live = (g) => { const M = g._modes; return M && g.runMode() === M.mode ? M : null; };
  const on = (name, fn) => onGameHook(name, fn);
  // A campaign start (harness startSector) while a mode run is live: drop it before bankAbandonedRun, so the stored run is banked.
  on("runWillStart", function () { if (this._modes) this.modesCleanup(); });
  on("levelWillStart", function () { if (this._modes && this.runMode() === "campaign") this.modesCleanup(); });
  on("waveWillStart", function (evt) {
    const M = live(this);
    if (!M) return;
    if (M.mode === "daily") { M.rng = modesMulberry32(modesWaveSeed(M.dateKey, evt.wave)); return; }
    this.modesApplyTuning(evt.tuning, M.cps);
    if (M.goShown) return;
    M.goShown = true;
    if (this.sfx && typeof this.sfx.lock === "function") this.sfx.lock("go");
    this.showBanner({ kind: "wave", eyebrow: M.mode === "drill" ? "DRILL" : "DRIFT", sub: "GO" });
  });
  on("tick", function (evt) { if (this._modes) this.modesTick(evt.dt); });
  on("bossWillApproach", function (evt) {
    const M = live(this);
    if (!M) return;
    evt.cancel = true;   // no boss in a mode run; the daily ends at the drain after wave 3 (the time cap never cuts it short)
    if (M.mode === "daily" && !M.ended && (this.wave | 0) >= 2 && this.wavePhase === "drain") this.modesFinish("clear");
  });
  on("enemyTextWillPick", function (evt) { const M = live(this); if (M && M.mode !== "daily" && M.pools) evt.text = this.modesPickText(); });
  on("powerupWillSpawn", function (evt) {
    const M = live(this);
    if (!M) return;
    if (M.mode === "drill" || M.ended) { evt.cancel = true; return; }
    if (M.mode !== "endless" || (evt.type !== "SHIELD" && evt.type !== "REPAIR")) return;
    const list = MODES_ENDLESS.powerups, taken = this.liveFirstChars(), k0 = Math.floor(this.rand() * list.length);
    evt.type = list[k0];
    for (let j = 0; j < list.length; j++) { const id = list[(k0 + j) % list.length]; if (!taken.has(POWERUP_TYPES[id].label[0])) { evt.type = id; break; } }
  });
  on("damageWillApply", function (evt) { const M = live(this); if (M && M.mode !== "daily") evt.cancel = true; });
  on("leak", function () {
    const M = live(this);
    if (!M || M.ended) return;
    if (M.mode === "endless") this.modesFinish("leak");
    else if (M.mode === "drill") { M.leaks++; this.onComboBreak(this.stats.combo | 0); }
  });
  on("scoreWillAdd", function (evt) { const M = live(this); if (M && M.mode === "drill") evt.cancel = true; });
  on("comboTierWillShow", function (evt) { const M = live(this); if (M && M.mode === "drill") evt.cancel = true; });
  on("gameOverWillStart", function (evt) {
    const M = live(this);
    if (!M) return;
    evt.cancel = true;
    if (M.mode === "daily") this.modesFinish("lost");
  });
  on("restartWillRun", function (evt) { if (live(this)) { evt.cancel = true; this.modesRestart(); } });
  on("restartWillAsk", function (evt) { if (live(this)) { evt.cancel = true; this.modesRestartPressed(); } });
  on("modeChange", function (evt) { if (evt.to === "menu" && (this._modes || this._rng || document.body.dataset.runMode)) this.modesCleanup(); });
  on("pauseScreenFilled", function () { this.modesFillPause(); });
  on("sectorCardWillShow", function (evt) {
    const M = live(this);
    if (!M) return;
    const t = this.modesTargetsText(M);
    const c = M.mode === "daily" ? [M.counted ? `DAILY SORTIE · ${modesShortDate(M.dateKey)}` : "DAILY SORTIE · PRACTICE", `SECTOR ${modesPad2(M.sector)}`, M.counted ? "3 WAVES · NO BOSS" : "3 WAVES · NOT COUNTED"]
      : M.mode === "endless" ? ["ENDLESS DRIFT", `STREAM ${Math.round(M.cps0 * 12)} WPM`, "RISES EVERY 20 S · ONE LEAK ENDS IT"]
        : ["DRILL · 60 S", t ? `TARGETS ${t}` : "COMMON WORDS", "NO HULL · NO SCORE"];
    evt.eyebrow = c[0]; evt.title = c[1]; evt.sub = c[2];
  });
  on("menuRender", function () { this.renderModeDeck(); });
  on("keyEscape", function (evt) {
    if (evt.mode !== "modeResults") return;
    evt.claimed = true;
    this.uiTick("back");
    this.stopToMenu(false);
  });
}
