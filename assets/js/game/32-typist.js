// Type-R 198X — MEASURE track (D1 / D4 / D5 / D6): honest hand speed (qualifying intervals), the per-key / bigram pilot
// profile (save.profile, schema 3), weak keys, sessions and bests, the inline typo pair, the rank line / WEAK SIGNAL /
// Game Over cause, the HUD ACC / WPM providers and the Flight Log. Loads after 30-input.js. Hooks consumed: keyCorrect,
// keyMiss, modeChange, sectorStart, sectorEnd, results, resultsRender, leak, hullDamage, menuRender, recordsOpen,
// renderOverlay, saveMigrate, saveStore; emitted: typistInterval. Top-level names TYPIST_* / typist* / SPEED_GAP_MAX_MS.
// Per key and per frame: typed arrays, reused objects, no allocation, no save write.
//
// D1 speed: an interval is the wall-clock ms between two consecutive CORRECT keys on the same target (plate, capsule,
// boss segment), never closed by the first key of a target, dropped under TYPIST_GAP_MIN_MS (touch / IME bursts) or
// over SPEED_GAP_MAX_MS; wrong keys in between stay inside it. speedWpm = 12000 x n / sum(ms). Scopes: live (last 30,
// HUD), window (ARCADE / MODES), sector (this segment), run (save.run.spd), lifetime (profile.speedEma).
// D6 profile: lifetime per-key {n, err EMA .05, ms EMA .15} and 676 bigrams live in typed arrays (this._ty) and are
// folded into save.profile only inside storeSave (saveStore); sessions are positional rows (CONTRACT R04).

// ----------------------------- Constants -----------------------------
const SPEED_GAP_MAX_MS = 1500;          // D1: an interval above this is a pause, not typing
const TYPIST_GAP_MIN_MS = 10;           // touch paste / IME bursts deliver several letters in one task
const TYPIST_LIVE_N = 30;               // HUD live window (intervals)
const TYPIST_SHOW_MIN_N = 10;           // any speed is shown only from 10 intervals ("--" before)
const TYPIST_BEST_MIN_N = 60;           // Best WPM / sector best speed need 60 intervals
const TYPIST_RING = 128;                // interval ring (power of two: index & 127)
const TYPIST_EMA_SECTOR_K = 300;        // speedEma / thrEma weight w = n / (n + 300) per finished segment
const TYPIST_KEY_MS_ALPHA = 0.15;
const TYPIST_KEY_ERR_ALPHA = 0.05;
const TYPIST_BIGRAM_MS_ALPHA = 0.15;
const TYPIST_BIGRAM_CAP = 200;
const TYPIST_SESSION_CAP = 100;
const TYPIST_WEAK_MIN_N = 15;
const TYPIST_WEAK_SCORE_MIN = 0.25;
const TYPIST_WEAK_MAX = 3;
const TYPIST_BIGRAM_MIN_N = 8;
const TYPIST_BIGRAM_SLOW_MUL = 1.35;
const TYPIST_WEAK_CACHE_MS = 2000;
const TYPIST_PAIR_MS = 450;             // D4: locked / boss typo pair life
const TYPIST_POP_MS = 400;              // D4: unlocked-miss glyph popping off the gun
const TYPIST_PULSE_MS = 300;            // D4: nearest plate's lead glyph pulse
const TYPIST_ACC_MIN_KEYS = 10;
const TYPIST_ACC_WARN = 0.95;
const TYPIST_ACC_BAD = 0.90;
const TYPIST_ACC_PULSE_MS = 300;
const TYPIST_SECTOR_ACC_MIN_KEYS = 50;  // sector best accuracy needs 50 keys
const TYPIST_SPARK_N = 20;
const TYPIST_GOAL_N = 5;
const TYPIST_PROFILE_MAX_BYTES = 16384;
const TYPIST_RANK_LINE_AT_MS = 700;     // fallback for 15-screens.js RESULTS_RANK_AT_MS: the rank line fades in with the stamp
const TYPIST_SESSION_FIELDS = Object.freeze(["t", "mode", "sector", "speed", "acc", "rank", "score", "misses", "steady", "weak"]);
const TYPIST_MODES = Object.freeze(["campaign", "daily", "endless", "drill"]);
const TYPIST_LETTERS = "abcdefghijklmnopqrstuvwxyz";
const TYPIST_KEY_ROWS = Object.freeze(["qwertyuiop", "asdfghjkl", "zxcvbnm"]);
const TYPIST_EMPTY = Object.freeze([]);
// Prebuilt strings: no concatenation on the key / HUD paths.
const TYPIST_BIGRAM_KEYS = (() => {
  const out = new Array(676);
  for (let a = 0; a < 26; a++) for (let b = 0; b < 26; b++) out[a * 26 + b] = TYPIST_LETTERS[a] + TYPIST_LETTERS[b];
  return Object.freeze(out);
})();
const TYPIST_PCT_STR = (() => { const o = []; for (let i = 0; i <= 100; i++) o.push(`${i}%`); return Object.freeze(o); })();
const TYPIST_NUM_STR = (() => { const o = []; for (let i = 0; i < 400; i++) o.push(String(i)); return Object.freeze(o); })();

// ----------------------------- Pure helpers -----------------------------
function typistCode(ch) {
  if (!ch) return -1;
  const k = ch.charCodeAt(0) - 97;
  return k >= 0 && k < 26 ? k : -1;
}

function typistSpeedOf(n, ms) {
  return n >= TYPIST_SHOW_MIN_N && ms > 0 ? 12000 * n / ms : 0;
}

function typistRound(x, dp) {
  const m = Math.pow(10, dp);
  return Math.round((Number(x) || 0) * m) / m;
}

function typistToday(d) {
  const t = d || new Date();
  return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
}

// Median of the first k entries of a scratch Float64Array (sorted in place; one view object per call).
function typistMedian(scratch, k) {
  if (k <= 0) return 0;
  const v = scratch.subarray(0, k).sort();
  return k % 2 ? v[(k - 1) >> 1] : (v[k / 2 - 1] + v[k / 2]) / 2;
}

function typistMedianOf(list) {
  const v = list.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const k = v.length;
  return k % 2 ? v[(k - 1) >> 1] : (v[k / 2 - 1] + v[k / 2]) / 2;
}

function typistGradeAtLeast(g, want) {
  const o = RANK.order;
  return o.indexOf(g) <= o.indexOf(want);
}

function typistPlural(n, one, many) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function typistBlankProfile() {
  return {
    v: 1, keys: {}, bigrams: {}, speedEma: 0, thrEma: 0, speedN: 0, sessions: [], sectorBest: {},
    bests: { speed: 0, ceiling: 0, drill: { speed: 0, acc: 0 } }, days: { n: 0, last: 0 }
  };
}

function typistNum(v, lo = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo ? n : lo;
}

// One stored session row (TYPIST_SESSION_FIELDS order) or null when it does not validate. Object rows (a hand edit)
// are converted by field name.
function typistNormaliseRow(row) {
  let r = row;
  if (r && typeof r === "object" && !Array.isArray(r)) r = TYPIST_SESSION_FIELDS.map((k) => r[k]);
  if (!Array.isArray(r) || r.length !== 10) return null;
  let [t, mode, sector, speed, acc, rank, score, misses, steady, weak] = r;
  t = Number(t);
  if (!Number.isFinite(t) || t < 0) return null;
  if (t > 1e11) t = t / 1000;   // ms epoch from a hand edit
  if (TYPIST_MODES.indexOf(mode) < 0) return null;
  sector = Number(sector);
  if (!Number.isFinite(sector) || sector < 0 || sector > 10) return null;
  speed = Number(speed); score = Number(score); misses = Number(misses);
  if (![speed, score, misses].every((x) => Number.isFinite(x) && x >= 0)) return null;
  if (acc !== null) { acc = Number(acc); if (!(Number.isFinite(acc) && acc >= 0)) return null; acc = typistRound(Math.min(100, acc), 1); }   // null: under 10 keys
  if (rank !== null && (typeof rank !== "string" || RANK.order.indexOf(rank) < 0)) return null;
  if (steady !== null) { steady = Number(steady); if (!Number.isFinite(steady)) return null; steady = Math.round(clamp(steady, 0, 100)); }
  if (typeof weak !== "string" || !/^[a-z]{0,3}$/.test(weak)) return null;
  return [Math.floor(t), mode, Math.round(sector), Math.round(speed), acc, rank, Math.round(score), Math.round(misses), steady, weak];
}

// Pure, idempotent normalisation of a stored profile (CONTRACT 3.2 step 4). Unknown fields are dropped; key order is
// canonical (a..z, aa..zz, "1".."10") so migrateSave(migrateSave(x)) deep-equals migrateSave(x).
function typistMigrateProfile(raw) {
  const out = typistBlankProfile();
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.v !== 1) return out;
  const keys = raw.keys && typeof raw.keys === "object" ? raw.keys : {};
  for (let i = 0; i < 26; i++) {
    const ch = TYPIST_LETTERS[i];
    const e = keys[ch];
    if (!e || typeof e !== "object") continue;
    const n = Math.floor(typistNum(e.n));
    if (n <= 0) continue;
    out.keys[ch] = { n, err: typistRound(clamp(typistNum(e.err), 0, 1), 4), ms: Math.round(typistNum(e.ms)) };
  }
  const bigrams = raw.bigrams && typeof raw.bigrams === "object" ? raw.bigrams : {};
  const list = [];
  for (const k of Object.keys(bigrams)) {
    if (!/^[a-z]{2}$/.test(k)) continue;
    const e = bigrams[k];
    if (!e || typeof e !== "object") continue;
    const n = Math.floor(typistNum(e.n));
    if (n <= 0) continue;
    list.push({ k, i: typistCode(k[0]) * 26 + typistCode(k[1]), n, ms: Math.round(typistNum(e.ms)) });
  }
  list.sort((a, b) => (b.n - a.n) || (b.ms - a.ms) || (a.i - b.i));
  if (list.length > TYPIST_BIGRAM_CAP) list.length = TYPIST_BIGRAM_CAP;
  list.sort((a, b) => a.i - b.i);
  for (const e of list) out.bigrams[e.k] = { n: e.n, ms: e.ms };
  out.speedEma = typistRound(typistNum(raw.speedEma), 1);
  out.thrEma = typistRound(typistNum(raw.thrEma), 1);
  out.speedN = Math.floor(typistNum(raw.speedN));
  const rows = Array.isArray(raw.sessions) ? raw.sessions.map(typistNormaliseRow).filter(Boolean) : [];
  out.sessions = rows.slice(-TYPIST_SESSION_CAP);
  const sb = raw.sectorBest && typeof raw.sectorBest === "object" ? raw.sectorBest : {};
  for (let L = 1; L <= 10; L++) {
    const e = sb[String(L)];
    if (!e || typeof e !== "object") continue;
    out.sectorBest[String(L)] = { speed: Math.round(typistNum(e.speed)), acc: typistRound(Math.min(100, typistNum(e.acc)), 1), t: Math.floor(typistNum(e.t)) };
  }
  const b = raw.bests && typeof raw.bests === "object" ? raw.bests : {};
  const d = b.drill && typeof b.drill === "object" ? b.drill : {};
  out.bests = { speed: Math.round(typistNum(b.speed)), ceiling: Math.round(typistNum(b.ceiling)), drill: { speed: Math.round(typistNum(d.speed)), acc: typistRound(Math.min(100, typistNum(d.acc)), 1) } };
  const days = raw.days && typeof raw.days === "object" ? raw.days : {};
  out.days = { n: Math.floor(typistNum(days.n)), last: Math.floor(typistNum(days.last)) };
  return out;
}

function typistNewState() {
  const ty = {
    saveRef: null,
    kN: new Float64Array(26), kErr: new Float64Array(26), kMs: new Float64Array(26),
    bN: new Float64Array(676), bMs: new Float64Array(676),
    keysDirty: false, bigramsDirty: false,
    // chain: the last correct key (target ref, boss segment or -1, char index, nowMs)
    cRef: null, cSeg: -1, cIndex: -1, cAt: 0,
    // ring of the last 128 qualifying intervals
    rMs: new Float32Array(TYPIST_RING), rEnd: new Float64Array(TYPIST_RING), rHead: 0, rCount: 0,
    runId: null, runN: 0, runMs: 0,
    // segment scope (one sector attempt or one practice segment)
    segKind: "sector", sN: 0, sMs: 0, sSq: 0, sKeys: 0, sMiss: 0, sHits: 0,
    sKeyN: new Uint16Array(26), sKeyMiss: new Uint16Array(26), sBiN: new Uint16Array(676), sBiMs: new Float32Array(676),
    lkWave: new Uint16Array(3), lkWaveLetters: new Uint16Array(3), lkMinion: new Uint16Array(4), lkSurge: new Uint16Array(4),
    hitSrc: "", hitWave: 0, hitPhase: -1, lastLeakMinion: false,
    // D4 cues: one pair or one pop + pulse on screen
    pRef: null, pAt: 0, pKind: "",
    popCh: "", popAt: 0, popDir: 1, popShown: false,
    puRef: null, puAt: 0,
    accPulseT: 0, accPulseEl: null, accPulseFn: null,
    // weak cache
    wKeys: TYPIST_EMPTY, wBigram: null, wAt: -1e9, wStale: true,
    // Best WPM stash (4.5)
    bsLevel: 0, bsRunId: null, bsSpeed: 0, bsNew: false, bsApplied: false,
    lastMissAt: 0,
    scratch26: new Float64Array(26), scratch676: new Float64Array(676), bIdx: new Uint16Array(676), bKeep: new Uint8Array(676),
    speedOut: { wpm: null, n: 0 },
    rSeq: 0, wsSeq: -1, wsWin: -1, wsUntil: 0, wsN: 0, wsMs: 0,   // window-speed cache (rSeq: ring writes + resets)
    intervalEvt: { ms: 0, t: 0, kind: "" },
    recordsTab: "hall", tabsWired: false,
    popFont: "", dangerFill: "", haloStroke: ""
  };
  ty.accPulseFn = () => { if (ty.accPulseEl) ty.accPulseEl.classList.remove("is-miss"); ty.accPulseT = 0; };
  return ty;
}

Object.assign(Game.prototype, {
  // ------------------------- State -------------------------
  // this._ty, created once per page and re-hydrated whenever this.save is replaced (Reset save, fixture reloads).
  typistState() {
    let ty = this._ty;
    if (!ty) ty = this._ty = typistNewState();
    if (ty.saveRef !== this.save) this.typistHydrate(ty);
    return ty;
  },

  typistHydrate(ty) {
    ty.saveRef = this.save;
    ty.kN.fill(0); ty.kErr.fill(0); ty.kMs.fill(0); ty.bN.fill(0); ty.bMs.fill(0);
    ty.keysDirty = false; ty.bigramsDirty = false;
    ty.wKeys = TYPIST_EMPTY; ty.wBigram = null; ty.wAt = -1e9; ty.wStale = true;
    ty.bsLevel = 0; ty.bsRunId = null; ty.bsSpeed = 0; ty.bsNew = false; ty.bsApplied = false;
    const s = this.save;
    if (!s || s.profile == null) return;   // fresh saves stay profile: null until the first key (CONTRACT 3.2)
    s.profile = typistMigrateProfile(s.profile);
    const p = s.profile;
    for (let i = 0; i < 26; i++) {
      const e = p.keys[TYPIST_LETTERS[i]];
      if (!e) continue;
      ty.kN[i] = e.n; ty.kErr[i] = e.err; ty.kMs[i] = e.ms;
    }
    for (const k of Object.keys(p.bigrams)) {
      const i = typistCode(k[0]) * 26 + typistCode(k[1]);
      ty.bN[i] = p.bigrams[k].n; ty.bMs[i] = p.bigrams[k].ms;
    }
  },

  // The blank profile is created lazily on the first write (a key, a session).
  typistProfileW() {
    const s = this.save;
    if (!s.profile || typeof s.profile !== "object") s.profile = typistBlankProfile();
    return s.profile;
  },

  // A new run id resets the run accumulators (from save.run.spd when it holds them) and the live ring.
  typistSyncRun(ty) {
    const run = this.run;
    if (!run || run.id === ty.runId) return;
    ty.runId = run.id;
    const spd = run.spd;
    if (spd && typeof spd === "object" && Number.isFinite(spd.n) && Number.isFinite(spd.ms) && spd.n >= 0 && spd.ms >= 0) {
      ty.runN = spd.n; ty.runMs = spd.ms;
    } else {
      run.spd = { n: 0, ms: 0 };
      ty.runN = 0; ty.runMs = 0;
    }
    ty.rHead = 0; ty.rCount = 0; ty.rSeq++;
  },

  // Run figures stay readable after the sector-10 clear nulls this.run (runMeta outlives it).
  typistRunLive(ty) {
    if (this.run) return this.run.id === ty.runId;
    return !!(this.runMeta && this.runMeta.id === ty.runId);
  },

  typistRunKey() {
    return this.run ? this.run.id : (this.runMeta ? this.runMeta.id : null);
  },

  typistRunModeNow() {
    return typeof this.runMode === "function" ? this.runMode() : ((this.run && this.run.mode) || "campaign");
  },

  // Segment scope reset (automatic on sectorStart; practice segments may call it).
  typistBeginSegment(kind = "segment") {
    const ty = this.typistState();
    ty.segKind = String(kind || "segment");
    ty.sN = 0; ty.sMs = 0; ty.sSq = 0; ty.sKeys = 0; ty.sMiss = 0; ty.sHits = 0;
    ty.sKeyN.fill(0); ty.sKeyMiss.fill(0); ty.sBiN.fill(0); ty.sBiMs.fill(0);
    ty.lkWave.fill(0); ty.lkWaveLetters.fill(0); ty.lkMinion.fill(0); ty.lkSurge.fill(0);
    ty.hitSrc = ""; ty.hitWave = 0; ty.hitPhase = -1; ty.lastLeakMinion = false;
    ty.cRef = null; ty.cSeg = -1; ty.cIndex = -1; ty.cAt = 0;
    ty.bsLevel = 0; ty.bsRunId = null; ty.bsSpeed = 0; ty.bsNew = false; ty.bsApplied = false;
    if (ty.pRef) ty.pRef.typoCh = null;
    ty.pRef = null; ty.pAt = 0; ty.pKind = "";
    ty.popAt = 0; ty.popShown = false;
    if (ty.puRef) ty.puRef.leadPulseAt = 0;
    ty.puRef = null; ty.puAt = 0;
    ty.wStale = true; ty.wAt = -1e9;
    return true;
  },

  // ------------------------- D1 / D6: keys -------------------------
  // keyCorrect listener: attempt bookkeeping, then the qualifying interval. O(1), no allocation.
  typistOnCorrect(e) {
    const ty = this.typistState();
    this.typistSyncRun(ty);
    if (!this.save.profile) this.typistProfileW();
    const c = typistCode(e.ch);
    this.typistAttempt(ty, c, false);
    if (e.len >= 2 && e.index >= 1 && ty.cRef === e.ref && ty.cSeg === e.seg && ty.cIndex === e.index - 1 && ty.cAt > 0) {
      const ms = e.t - ty.cAt;
      if (ms >= TYPIST_GAP_MIN_MS && ms <= SPEED_GAP_MAX_MS) {
        const ref = e.ref;
        const text = e.kind === "boss" ? ref.segment : (e.kind === "powerup" ? ref.label : ref.text);
        const prev = text ? typistCode(text[e.index - 1]) : -1;
        this.typistAddInterval(ty, ms, prev, c, e.t, e.kind);
      }
    }
    ty.cRef = e.ref; ty.cSeg = e.seg; ty.cIndex = e.index; ty.cAt = e.t;
  },

  // Per-attempt bookkeeping on the expected key (code -1: only the segment totals move).
  typistAttempt(ty, code, miss) {
    ty.sKeys++;
    if (miss) ty.sMiss++;
    if (code >= 0) {
      ty.kN[code]++;
      ty.kErr[code] = ty.kErr[code] * (1 - TYPIST_KEY_ERR_ALPHA) + (miss ? TYPIST_KEY_ERR_ALPHA : 0);
      if (ty.sKeyN[code] < 65535) ty.sKeyN[code]++;
      if (miss && ty.sKeyMiss[code] < 65535) ty.sKeyMiss[code]++;
      ty.keysDirty = true;
    }
    ty.wStale = true;
  },

  typistAddInterval(ty, ms, a, b, t, kind) {
    ty.rMs[ty.rHead] = ms;
    ty.rEnd[ty.rHead] = t;
    ty.rHead = (ty.rHead + 1) & (TYPIST_RING - 1);
    if (ty.rCount < TYPIST_RING) ty.rCount++;
    ty.rSeq++;
    ty.sN++; ty.sMs += ms; ty.sSq += ms * ms;
    const ls = this.levelStats;
    if (ls) { ls.spdN = ty.sN; ls.spdMs = ty.sMs; ls.spdSq = ty.sSq; }
    const run = this.run;
    if (run && run.id === ty.runId) {
      ty.runN++; ty.runMs += ms;
      const spd = run.spd;
      if (spd) { spd.n = ty.runN; spd.ms = ty.runMs; }
    }
    if (b >= 0) {
      ty.kMs[b] = ty.kMs[b] > 0 ? ty.kMs[b] + TYPIST_KEY_MS_ALPHA * (ms - ty.kMs[b]) : ms;
      ty.keysDirty = true;
      if (a >= 0) {
        const i = a * 26 + b;
        ty.bN[i]++;
        ty.bMs[i] = ty.bN[i] > 1 ? ty.bMs[i] + TYPIST_BIGRAM_MS_ALPHA * (ms - ty.bMs[i]) : ms;
        if (ty.sBiN[i] < 65535) ty.sBiN[i]++;
        ty.sBiMs[i] += ms;
        ty.bigramsDirty = true;
      }
    }
    const p = this.save.profile;
    if (p) p.speedN = (p.speedN | 0) + 1;
    ty.wStale = true;
    const ev = ty.intervalEvt;
    ev.ms = ms; ev.t = t; ev.kind = kind;
    this.hook("typistInterval", ev);   // ARCADE's Overdrive burst ring
  },

  // ------------------------- D4: misses -------------------------
  // keyMiss listener: attribute an unlocked miss to the nearest targetable plate (evt.expected, visible to later
  // listeners), bookkeeping, ACC pulse, then one cue: the pair inside the locked plate / boss slab, or the gun pop +
  // lead pulse on the nearest plate. Claims the miss so 80-fx.js skips its rising expected glyph.
  typistOnMiss(e) {
    const ty = this.typistState();
    this.typistSyncRun(ty);
    if (!this.save.profile) this.typistProfileW();
    let near = null;
    if (!e.ref && !e.boss) {
      near = this.typistNearest();
      if (!e.expected) e.expected = near ? near.nextChar() : null;
    }
    this.typistAttempt(ty, typistCode(e.expected), true);
    ty.lastMissAt = e.t;
    const el = this.hudEls().acc;
    if (el) {
      el.classList.add("is-miss");
      ty.accPulseEl = el;
      if (ty.accPulseT) clearTimeout(ty.accPulseT);
      ty.accPulseT = setTimeout(ty.accPulseFn, TYPIST_ACC_PULSE_MS);
    }
    const typed = e.typed;
    if (!typed) return;
    const glyph = typeof lexiconGlyphFor === "function" ? lexiconGlyphFor(typed) : typed;
    if (e.ref || e.boss) {
      const pr = e.ref || this.boss;
      if (!pr) return;
      if (ty.pRef && ty.pRef !== pr) ty.pRef.typoCh = null;
      pr.typoCh = glyph; pr.typoAt = e.t;
      ty.pRef = pr; ty.pAt = e.t; ty.pKind = e.ref ? "locked" : "boss";
      ty.popAt = 0; ty.popShown = false;
      if (ty.puRef) { ty.puRef.leadPulseAt = 0; ty.puRef = null; }
      e.claimed = true;
    } else if (near) {
      if (ty.pRef) { ty.pRef.typoCh = null; ty.pRef = null; ty.pKind = ""; }
      if (ty.puRef && ty.puRef !== near) ty.puRef.leadPulseAt = 0;
      ty.popCh = glyph; ty.popAt = e.t; ty.popDir = 1; ty.popShown = false;
      near.leadPulseAt = e.t;
      ty.puRef = near; ty.puAt = e.t;
      e.claimed = true;
    }
  },

  // Nearest targetable enemy (min x), else the nearest targetable capsule. <= 14 plates, no allocation.
  typistNearest() {
    let best = null;
    const en = this.enemies;
    for (let i = 0; i < en.length; i++) {
      const o = en[i];
      if (!this.isTargetable(o) || !o.nextChar()) continue;
      if (!best || o.x < best.x) best = o;
    }
    if (best) return best;
    const pw = this.powerups;
    for (let i = 0; i < pw.length; i++) {
      const o = pw[i];
      if (!this.isTargetable(o) || !o.nextChar()) continue;
      if (!best || o.x < best.x) best = o;
    }
    return best;
  },

  typistLastMissAt() {
    const ty = this._ty;
    return ty ? ty.lastMissAt : 0;
  },

  // renderOverlay listener: the unlocked-miss glyph at the gun (18 px, danger, bg0 halo), 400 ms, up unless its final
  // box would cover a danger-zone plate (then down; both blocked: not drawn). Reduced motion: no travel, same fade.
  typistDrawOverlay(ctx) {
    const ty = this._ty;
    if (!ty || !(ty.popAt > 0)) return;
    const now = nowMs();
    const u = (now - ty.popAt) / TYPIST_POP_MS;
    if (u >= 1 || u < 0) { ty.popAt = 0; ty.popShown = false; return; }
    const pose = this._shipPose;
    const ox = pose && pose.muzzle ? pose.muzzle.x : this.player.x + 40;
    const oy = pose && pose.muzzle ? pose.muzzle.y : this.player.y;
    const rm = !!this.reduceMotion;
    const gx = ox + 18;
    if (this.typistPopBlocked(gx, oy - 26)) ty.popDir = this.typistPopBlocked(gx, oy + 26) ? 0 : -1;
    else ty.popDir = 1;
    if (ty.popDir === 0) { ty.popShown = false; return; }
    const k = rm ? 0 : easeOutCubic(u);
    const x = ox + 18 * k;
    const y = oy - 26 * k * ty.popDir;
    if (this.typistPopBlocked(x, y)) { ty.popShown = false; return; }
    if (!ty.popFont) {
      ty.popFont = FONT.target(18, 700);
      ty.dangerFill = PALETTE.rgba("danger", 1);
      ty.haloStroke = PALETTE.rgba("bg0", 0.92);
    }
    const sh = this.shakeNow;
    ctx.save();
    if (sh) {
      ctx.translate(sh.x || 0, sh.y || 0);
      if (sh.rot) { ctx.translate(this.w / 2, this.h / 2); ctx.rotate(sh.rot); ctx.translate(-this.w / 2, -this.h / 2); }
    }
    ctx.globalAlpha = u < 0.6 ? 1 : (1 - u) / 0.4;
    ctx.font = ty.popFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = ty.haloStroke;
    ctx.strokeText(ty.popCh, x, y);
    ctx.fillStyle = ty.dangerFill;
    ctx.fillText(ty.popCh, x, y);
    ctx.restore();
    ty.popShown = true;
  },

  // Does an 18 x 20 glyph box centred on (x, y) touch an alive plate inside the danger zone?
  typistPopBlocked(x, y) {
    const dz = (typeof DANGER_X === "number" ? DANGER_X : 0.35) * this.w;
    const en = this.enemies;
    for (let i = 0; i < en.length; i++) {
      const o = en[i];
      if (!o || o.alive === false || o.dying || !(o.x < dz)) continue;
      const hw = (o.plateW || 40) / 2 + 9, hh = (o.plateH || 40) / 2 + 10;
      if (Math.abs(o.x - x) < hw && Math.abs(o.y - y) < hh) return true;
    }
    return false;
  },

  // ------------------------- HUD providers (P1 / P2, 5 Hz commit frames) -------------------------
  typistHudAcc(el) {
    if (!el) return;
    const ty = this.typistState();
    if (ty.sKeys < TYPIST_ACC_MIN_KEYS) {
      this.setText(el, "--");
      this.setAttr(el, "data-acc", null);
      return;
    }
    const acc = (ty.sKeys - ty.sMiss) / ty.sKeys;
    this.setText(el, TYPIST_PCT_STR[Math.round(acc * 100)]);
    this.setAttr(el, "data-acc", acc < TYPIST_ACC_BAD ? "bad" : (acc < TYPIST_ACC_WARN ? "warn" : null));
  },

  typistHudWpm(el) {
    if (!el) return;
    const ty = this.typistState();
    this.typistSyncRun(ty);
    const n = ty.rCount < TYPIST_LIVE_N ? ty.rCount : TYPIST_LIVE_N;
    if (n < TYPIST_SHOW_MIN_N) { this.setText(el, "--"); return; }
    let sum = 0, idx = ty.rHead;
    for (let i = 0; i < n; i++) { idx = (idx - 1) & (TYPIST_RING - 1); sum += ty.rMs[idx]; }
    const w = sum > 0 ? Math.round(12000 * n / sum) : 0;
    this.setText(el, w < 400 ? TYPIST_NUM_STR[w] : String(w));
  },

  // ------------------------- Speed API (CONTRACT 2.2) -------------------------
  // REUSED {wpm, n}: copy the fields before the next call. wpm null under 10 intervals (live / run / sector), lifetime =
  // profile.speedEma (null at 0), window = intervals that ended within windowMs (null at n 0).
  typistSpeed(scope = "live", windowMs = 2500) {
    const ty = this.typistState();
    this.typistSyncRun(ty);
    const out = ty.speedOut;
    let n = 0, ms = 0;
    if (scope === "lifetime") {
      const p = this.save.profile;
      const ema = p ? Number(p.speedEma) || 0 : 0;
      out.wpm = ema > 0 ? ema : null;
      out.n = p ? (p.speedN | 0) : 0;
      return out;
    }
    if (scope === "window") {
      const win = Number(windowMs) || 0;
      const now = nowMs();
      // Cached while no interval was added and the oldest counted one is still inside the window (O(1) per call).
      if (ty.wsSeq === ty.rSeq && ty.wsWin === win && now < ty.wsUntil) {
        n = ty.wsN; ms = ty.wsMs;
      } else {
        const since = now - win;
        let idx = ty.rHead, oldest = Infinity;
        for (let i = 0; i < ty.rCount; i++) {
          idx = (idx - 1) & (TYPIST_RING - 1);
          if (ty.rEnd[idx] < since) break;
          n++; ms += ty.rMs[idx]; oldest = ty.rEnd[idx];
        }
        ty.wsSeq = ty.rSeq; ty.wsWin = win; ty.wsN = n; ty.wsMs = ms;
        ty.wsUntil = n > 0 ? oldest + win : Infinity;
      }
      out.n = n;
      out.wpm = n > 0 && ms > 0 ? 12000 * n / ms : null;
      return out;
    }
    if (scope === "run") {
      if (this.typistRunLive(ty)) { n = ty.runN; ms = ty.runMs; }
    } else if (scope === "sector" || scope === "segment" || scope === "level") {
      n = ty.sN; ms = ty.sMs;
    } else {
      n = ty.rCount < TYPIST_LIVE_N ? ty.rCount : TYPIST_LIVE_N;
      let idx = ty.rHead;
      for (let i = 0; i < n; i++) { idx = (idx - 1) & (TYPIST_RING - 1); ms += ty.rMs[idx]; }
    }
    out.n = n;
    out.wpm = n >= TYPIST_SHOW_MIN_N && ms > 0 ? 12000 * n / ms : null;
    return out;
  },

  speedFor(scope) {
    return this.typistSpeed(scope);
  },

  typistWindowSpeed(windowMs) {
    return this.typistSpeed("window", windowMs);
  },

  // P3 / P4: raw speed for a results scope; "level" -> sector, "over" / "run" -> run; 0 under 10 intervals.
  typistScopeWpm(scope) {
    const ty = this.typistState();
    this.typistSyncRun(ty);
    if (scope === "over" || scope === "run") return this.typistRunLive(ty) ? typistSpeedOf(ty.runN, ty.runMs) : 0;
    return typistSpeedOf(ty.sN, ty.sMs);
  },

  typistScopeN(scope) {
    const ty = this.typistState();
    if (scope === "over" || scope === "run") return this.typistRunLive(ty) ? ty.runN : 0;
    return ty.sN;
  },

  // ------------------------- Weak keys / bigram (cached, <= every 2 s) -------------------------
  typistWeakRefresh(ty) {
    const now = nowMs();
    if (!ty.wStale || now - ty.wAt < TYPIST_WEAK_CACHE_MS) return;
    ty.wStale = false;
    ty.wAt = now;
    // keys: n >= 15, score = 4 x err + max(0, ms / median_ms - 1) (latency term needs >= 3 timed keys)
    const sc = ty.scratch26;
    let k = 0;
    for (let i = 0; i < 26; i++) if (ty.kN[i] >= TYPIST_WEAK_MIN_N && ty.kMs[i] > 0) sc[k++] = ty.kMs[i];
    const med = k >= 3 ? typistMedian(sc, k) : 0;
    const top = [];
    for (let i = 0; i < 26; i++) {
      if (ty.kN[i] < TYPIST_WEAK_MIN_N) continue;
      const s = this.typistKeyScore(ty, i, med);
      if (s > TYPIST_WEAK_SCORE_MIN) top.push({ i, s });
    }
    top.sort((a, b) => (b.s - a.s) || (a.i - b.i));
    if (top.length > TYPIST_WEAK_MAX) top.length = TYPIST_WEAK_MAX;
    const cur = ty.wKeys;
    let same = cur.length === top.length;
    for (let j = 0; same && j < top.length; j++) same = cur[j] === TYPIST_LETTERS[top[j].i];
    if (!same) ty.wKeys = top.length ? Object.freeze(top.map((t) => TYPIST_LETTERS[t.i])) : TYPIST_EMPTY;
    // bigram: n >= 8, the slowest with ms >= 1.35 x median (median needs >= 5 eligible)
    const sb = ty.scratch676;
    let m = 0, slow = -1;
    for (let i = 0; i < 676; i++) {
      if (ty.bN[i] < TYPIST_BIGRAM_MIN_N || !(ty.bMs[i] > 0)) continue;
      sb[m++] = ty.bMs[i];
      if (slow < 0 || ty.bMs[i] > ty.bMs[slow]) slow = i;
    }
    ty.wBigram = null;
    if (m >= 5 && slow >= 0) {
      const bmed = typistMedian(sb, m);
      if (ty.bMs[slow] >= TYPIST_BIGRAM_SLOW_MUL * bmed) ty.wBigram = TYPIST_BIGRAM_KEYS[slow];
    }
  },

  typistKeyScore(ty, i, med) {
    const lat = med > 0 && ty.kMs[i] > 0 ? Math.max(0, ty.kMs[i] / med - 1) : 0;
    return 4 * ty.kErr[i] + lat;
  },

  typistKeyMedianMs(ty) {
    const sc = ty.scratch26;
    let k = 0;
    for (let i = 0; i < 26; i++) if (ty.kN[i] >= TYPIST_WEAK_MIN_N && ty.kMs[i] > 0) sc[k++] = ty.kMs[i];
    return k >= 3 ? typistMedian(sc, k) : 0;
  },

  typistWeakKeys() {
    const ty = this.typistState();
    this.typistWeakRefresh(ty);
    return ty.wKeys;
  },

  typistWeakBigram() {
    const ty = this.typistState();
    this.typistWeakRefresh(ty);
    return ty.wBigram;
  },

  typistKeyStats(ch) {
    const ty = this.typistState();
    const c = typistCode(typeof ch === "string" ? ch.toLowerCase() : "");
    if (c < 0) return { n: 0, err: 0, ms: 0, segN: 0, segMiss: 0 };
    return { n: ty.kN[c], err: ty.kErr[c], ms: Math.round(ty.kMs[c]), segN: ty.sKeyN[c], segMiss: ty.sKeyMiss[c] };
  },

  typistBigramIndex(bg) {
    if (typeof bg !== "string" || bg.length !== 2) return -1;
    const a = typistCode(bg[0].toLowerCase()), b = typistCode(bg[1].toLowerCase());
    return a >= 0 && b >= 0 ? a * 26 + b : -1;
  },

  typistBigramStats(bg) {
    const ty = this.typistState();
    const i = this.typistBigramIndex(bg);
    if (i < 0) return { n: 0, ms: 0, segN: 0, segMs: 0 };
    const segN = ty.sBiN[i];
    return { n: ty.bN[i], ms: Math.round(ty.bMs[i]), segN, segMs: segN > 0 ? Math.round(ty.sBiMs[i] / segN) : 0 };
  },

  typistScopeBigramMs(bg) {
    const ty = this.typistState();
    const i = this.typistBigramIndex(bg);
    return i >= 0 && ty.sBiN[i] > 0 ? ty.sBiMs[i] / ty.sBiN[i] : 0;
  },

  // ------------------------- Segment summary, sessions, bests -------------------------
  // Up to k letters, most missed this segment first (ties: higher lifetime weak score, then alphabetical).
  typistTopMissed(ty, k) {
    const med = this.typistKeyMedianMs(ty);
    const list = [];
    for (let i = 0; i < 26; i++) if (ty.sKeyMiss[i] > 0) list.push({ i, m: ty.sKeyMiss[i], s: ty.kN[i] >= TYPIST_WEAK_MIN_N ? this.typistKeyScore(ty, i, med) : 0 });
    list.sort((a, b) => (b.m - a.m) || (b.s - a.s) || (a.i - b.i));
    return list.slice(0, k);
  },

  typistSegmentSummary(ty) {
    const speed = typistSpeedOf(ty.sN, ty.sMs);
    // Accuracy needs TYPIST_ACC_MIN_KEYS keys, as the HUD ACC: a segment with fewer logs acc null, never 100 %.
    const acc = ty.sKeys >= TYPIST_ACC_MIN_KEYS ? (ty.sKeys - ty.sMiss) / ty.sKeys * 100 : null;
    let steady = null;
    if (ty.sN >= TYPIST_SHOW_MIN_N && ty.sMs > 0) {
      const mean = ty.sMs / ty.sN;
      const cv = Math.sqrt(Math.max(0, ty.sSq / ty.sN - mean * mean)) / mean;
      steady = Math.round(clamp(100 - 100 * cv, 0, 100));
    }
    const weak = this.typistTopMissed(ty, 3).map((x) => TYPIST_LETTERS[x.i]).join("");
    return { speed, n: ty.sN, acc, keys: ty.sKeys, misses: ty.sMiss, steady, weak };
  },

  // Lifetime EMAs (D1): w = n / (n + 300) per finished segment with >= 10 intervals.
  typistUpdateEmas(p, n, speed, throughput) {
    if (!(n >= TYPIST_SHOW_MIN_N) || !(speed > 0)) return;
    const w = n / (n + TYPIST_EMA_SECTOR_K);
    p.speedEma = typistRound(p.speedEma > 0 ? p.speedEma + w * (speed - p.speedEma) : speed, 1);
    if (throughput > 0) p.thrEma = typistRound(p.thrEma > 0 ? p.thrEma + w * (throughput - p.thrEma) : throughput, 1);
  },

  // Append a stored row, cap 100, drop oldest until the profile fits 16 KB, count the day.
  typistAppendSession(p, row) {
    if (!Array.isArray(p.sessions)) p.sessions = [];
    p.sessions.push(row);
    while (p.sessions.length > TYPIST_SESSION_CAP) p.sessions.shift();
    this.typistFlush(this.save, true);
    while (p.sessions.length > 1 && JSON.stringify(p).length > TYPIST_PROFILE_MAX_BYTES) p.sessions.shift();
    const today = typistToday();
    if (!p.days || typeof p.days !== "object") p.days = { n: 0, last: 0 };
    if (today !== p.days.last) { p.days.n = (p.days.n | 0) + 1; p.days.last = today; }
  },

  typistRowObject(r) {
    const o = {};
    for (let i = 0; i < TYPIST_SESSION_FIELDS.length; i++) o[TYPIST_SESSION_FIELDS[i]] = r[i];
    return o;
  },

  // Oldest first; the only reader of stored sessions for other tracks.
  typistSessions(n = 20) {
    const p = this.save && this.save.profile;
    const rows = p && Array.isArray(p.sessions) ? p.sessions : [];
    const k = Math.max(0, n | 0);
    return rows.slice(Math.max(0, rows.length - k)).map((r) => this.typistRowObject(r));
  },

  typistDaysFlown() {
    const p = this.save && this.save.profile;
    return p && p.days ? (p.days.n | 0) : 0;
  },

  typistProfile() {
    this.typistFlush(this.save, true);
    return this.save.profile;
  },

  // Practice segment end (MODES): session, EMAs, days and the mode bests; never bests.speed, sectorBest, save.run,
  // sectorBests or the high score. store: true persists (MODES otherwise stores once itself).
  typistEndSession(meta = {}) {
    const m = meta && typeof meta === "object" ? meta : {};
    const ty = this.typistState();
    const p = this.typistProfileW();
    const sum = this.typistSegmentSummary(ty);
    const mode = TYPIST_MODES.indexOf(m.mode) >= 0 ? m.mode : this.typistRunModeNow();
    const sector = clamp(Math.round(Number(m.sector) || 0), 0, 10);
    const rank = typeof m.rank === "string" && RANK.order.indexOf(m.rank) >= 0 ? m.rank : null;
    const score = Math.max(0, Math.round(Number(m.score) || 0));
    this.typistUpdateEmas(p, sum.n, sum.speed, Number(m.throughput) || 0);
    const t = Math.floor(Date.now() / 1000);
    const speed = Math.round(sum.speed);
    const acc = sum.acc === null ? null : typistRound(sum.acc, 1);
    const row = [t, mode, sector, speed, acc, rank, score, sum.misses, sum.steady, sum.weak];
    this.typistAppendSession(p, row);
    if (!p.bests || typeof p.bests !== "object") p.bests = { speed: 0, ceiling: 0, drill: { speed: 0, acc: 0 } };
    if (mode === "endless" && Number(m.ceiling) > 0) p.bests.ceiling = Math.max(p.bests.ceiling | 0, Math.round(Number(m.ceiling)));
    if (mode === "drill" && sum.n >= TYPIST_SHOW_MIN_N && sum.keys >= 20 && acc !== null) {
      const d = p.bests.drill || (p.bests.drill = { speed: 0, acc: 0 });
      const rating = (s, a) => s * Math.pow(a / 100, 2);
      if (rating(speed, acc) > rating(d.speed || 0, d.acc || 0)) { d.speed = speed; d.acc = acc; }
    }
    if (m.store) storeSave(this.save);
    return { t, mode, sector, speed, n: sum.n, acc, rank, score, misses: sum.misses, steady: sum.steady, weak: sum.weak };
  },

  // sectorEnd listener (campaign clear / death): session, EMAs, Best WPM, sector best; handled stops the legacy
  // bestWpm write. The caller's own storeSave persists it.
  typistOnSectorEnd(evt) {
    evt.handled = true;
    if (evt.outcome === "victory") return;   // the sector-10 clear already logged
    if (this.typistRunModeNow() !== "campaign") return;   // mode runs log through typistEndSession (MODES)
    const ty = this.typistState();
    const p = this.typistProfileW();
    const r = evt.results || {};
    const L = clamp(evt.level | 0, 1, 10);
    const sum = this.typistSegmentSummary(ty);
    const ls = this.levelStats || {};
    const throughput = this.grossWpm(ls.chars | 0, Math.round(ls.timeMs || 0));
    this.typistUpdateEmas(p, sum.n, sum.speed, throughput);
    const clear = evt.outcome === "clear";
    const t = Math.floor(Date.now() / 1000);
    const acc = sum.acc === null ? null : typistRound(sum.acc, 1);
    if (clear) {
      this.typistApplyStash(ty, p, L);
      const key = String(L);
      const cur = p.sectorBest[key];
      const speed = Math.round(sum.speed);
      let improved = false;
      const next = cur ? { ...cur } : { speed: 0, acc: 0, t: 0 };
      if (sum.n >= TYPIST_BEST_MIN_N && speed > (next.speed | 0)) { next.speed = speed; improved = true; }
      if ((ls.total | 0) >= TYPIST_SECTOR_ACC_MIN_KEYS && acc !== null && acc > (Number(next.acc) || 0)) { next.acc = acc; improved = true; }
      if (improved) { next.t = t; p.sectorBest[key] = next; }
    }
    const row = [t, "campaign", L, Math.round(sum.speed), acc, clear && typeof r.rank === "string" ? r.rank : null,
      Math.max(0, Math.round(Number(r.levelScore) || 0)), sum.misses, sum.steady, sum.weak];
    this.typistAppendSession(p, row);
  },

  // Best WPM stash (4.5), computed while the card data is built, applied at the clear.
  typistStash(ty, L) {
    const runId = this.typistRunKey();
    if (ty.bsApplied && ty.bsLevel === L && ty.bsRunId === runId) return;
    const p = this.save.profile;
    const best = p && p.bests ? (p.bests.speed | 0) : 0;
    const speed = Math.round(typistSpeedOf(ty.sN, ty.sMs));
    ty.bsLevel = L; ty.bsRunId = runId; ty.bsSpeed = speed; ty.bsApplied = false;
    ty.bsNew = ty.sN >= TYPIST_BEST_MIN_N && this.typistRunModeNow() === "campaign" && speed > best;
  },

  typistApplyStash(ty, p, L) {
    if (ty.bsLevel !== L || ty.bsRunId !== this.typistRunKey() || ty.bsApplied) return;
    if (ty.bsNew) p.bests.speed = ty.bsSpeed;
    ty.bsApplied = true;
  },

  // ------------------------- D5: lines -------------------------
  // Shortfall to the next grade from exactly the rank's inputs: {text, say}; "" for S.
  typistShortfallParts(input) {
    const src = input && typeof input === "object" ? input : {};
    const acc = Number(src.acc) || 0, wpm = Number(src.wpm) || 0;
    const h = clamp(Number.isFinite(src.hpPts) ? src.hpPts : 1, 0, 1);
    const hits = Math.max(0, src.hits | 0), level = src.level | 0;
    const grade = rankFor(acc, wpm, h, level);
    if (grade === "S") return { text: "", say: "", term: "" };
    const win = rankSpeedWindow(level);
    const W = RANK.weights;
    const a = clamp((acc - RANK.accFloorPct) / RANK.accSpanPct, 0, 1);
    const s = clamp((wpm - win.floor) / win.span, 0, 1);
    const r = W.acc * a + W.speed * s + W.hp * h;
    const target = RANK.thresholds[RANK.order.indexOf(grade) - 1];
    const G = target[0], gap = target[1] - r;
    const terms = [["acc", W.acc * (1 - a)], ["speed", W.speed * (1 - s)], ["hull", W.hp * (1 - h)]];
    let pick = null, any = false;
    for (const t of terms) if (t[1] >= gap - 1e-9) { any = true; if (!pick || t[1] > pick[1]) pick = t; }
    if (!pick) for (const t of terms) if (!pick || t[1] > pick[1]) pick = t;
    const hitsText = typistPlural(hits, "HIT", "HITS");
    if (pick[0] === "hull") return { text: `HULL HELD YOU BACK · ${hitsText}`, say: `Hull held you back. ${hitsText.toLowerCase()}.`, term: "hull" };
    if (pick[0] === "acc") {
      const ra = Math.round(acc);
      if (!any) return { text: `ACCURACY HELD YOU BACK · ${ra}%`, say: `Accuracy held you back. ${ra} percent.`, term: "acc" };
      const need = RANK.accFloorPct + RANK.accSpanPct * (a + gap / W.acc);
      let ni = Math.min(100, Math.ceil(need - 1e-9));
      while (ni < 100 && !typistGradeAtLeast(rankFor(ni, wpm, h, level), G)) ni++;
      let shown = String(ra), needS = String(ni);
      if (ra >= ni) {
        let nd = Math.min(100, Math.ceil(need * 10 - 1e-9) / 10);
        while (nd < 100 && !typistGradeAtLeast(rankFor(nd, wpm, h, level), G)) nd = Math.round(nd * 10 + 1) / 10;
        shown = (Math.floor(acc * 10) / 10).toFixed(1);
        needS = nd.toFixed(1);
      }
      return { text: `ACCURACY HELD YOU BACK · ${shown}% · ${G} AT ${needS}%`, say: `Accuracy held you back. ${shown} percent. ${G} at ${needS} percent.`, term: "acc" };
    }
    const rw = Math.round(wpm);
    if (!any) return { text: `SPEED HELD YOU BACK · ${rw} WPM`, say: `Speed held you back. ${rw} words per minute.`, term: "speed" };
    const need = win.floor + win.span * (s + gap / W.speed);
    let sp = Math.max(Math.ceil(need - 1e-9), rw + 1);
    while (sp < 400 && !typistGradeAtLeast(rankFor(acc, sp, h, level), G)) sp++;
    return { text: `SPEED HELD YOU BACK · ${rw} WPM · ${G} AT ${sp}`, say: `Speed held you back. ${rw} words per minute. ${G} at ${sp}.`, term: "speed" };
  },

  typistShortfall(input) {
    return this.typistShortfallParts(input).text;
  },

  // Game Over cause from the leak log and the killing blow (hullDamage runs before onGameOver).
  typistCauseParts() {
    const ty = this.typistState();
    const src = ty.hitSrc;
    if (src === "surge") {
      const ph = clamp(ty.hitPhase | 0, 0, 3) + 1;
      return { text: `SIGNAL LOST · TO THE SURGE IN PHASE ${ph}`, say: `Signal lost. To the surge in phase ${ph}.` };
    }
    if (src === "minion") {
      const ph = clamp(ty.hitPhase | 0, 0, 3);
      const n = Math.max(1, ty.lkMinion[ph]);
      const what = n === 1 ? "1 MINION GOT THROUGH" : `${n} MINIONS GOT THROUGH`;
      return { text: `SIGNAL LOST · ${what} IN PHASE ${ph + 1}`, say: `Signal lost. ${what.toLowerCase()} in phase ${ph + 1}.` };
    }
    if (src === "leak") {
      const w = clamp(ty.hitWave | 0, 0, 2);
      const n = ty.lkWave[w], letters = ty.lkWaveLetters[w];
      if (n > 0) {
        const noun = letters === n ? (n === 1 ? "LETTER" : "LETTERS") : (letters > 0 ? "TARGETS" : (n === 1 ? "WORD" : "WORDS"));
        const verb = `${n} ${noun} LEAKED IN WAVE ${w + 1}`;
        return { text: `SIGNAL LOST · ${verb}`, say: `Signal lost. ${verb.toLowerCase()}.` };
      }
    }
    return { text: "SIGNAL LOST · HULL BREACHED", say: "Signal lost. Hull breached." };
  },

  // results filter: speed count, misses caption, rank line / cause, WEAK SIGNAL chips, Best WPM, speech.
  typistOnResults(evt) {
    const r = evt && evt.results;
    if (!r) return;
    const scope = evt.scope || r.scope || "level";
    const ty = this.typistState();
    const ls = this.levelStats || {};
    const st = this.stats || {};
    const L = r.level | 0;
    r.wpmN = this.typistScopeN(scope);
    const misses = scope === "level" ? Math.max(0, (ls.total | 0) - (ls.correct | 0)) : Math.max(0, st.misses | 0);
    r.misses = misses;
    r.accCaption = misses === 0 ? "NO MISSES" : typistPlural(misses, "MISS", "MISSES");
    let why;
    if (scope === "over") {
      why = this.typistCauseParts();
      r.rankWhyKind = "cause";
    } else {
      const hpPts = (ls.damageTaken | 0) === 0 ? 1 : clamp(1 - (ls.damageTaken | 0) / Math.max(1, this.player.maxHp), 0, 1);
      why = this.typistShortfallParts({ acc: r.acc, wpm: r.wpm, hpPts, hits: ls.hits | 0, level: L });
      r.rankWhyKind = "shortfall";
    }
    r.rankWhy = why.text;
    r.rankWhySay = why.say;
    // WEAK SIGNAL (this segment): most-missed key, slowest bigram (>= 3 samples), steadiness
    const weak = [], kinds = [], says = [];
    const km = this.typistTopMissed(ty, 1)[0];
    if (km) {
      const ch = TYPIST_LETTERS[km.i];
      const what = typistPlural(km.m, "MISS", "MISSES");
      weak.push(`${ch.toUpperCase()} · ${what}`); kinds.push("key"); says.push(`${ch}, ${what.toLowerCase()}`);
    }
    let bi = -1, bmean = 0;
    for (let i = 0; i < 676; i++) {
      if (ty.sBiN[i] < 3) continue;
      const mean = ty.sBiMs[i] / ty.sBiN[i];
      if (mean > bmean) { bmean = mean; bi = i; }
    }
    if (bi >= 0) {
      const bg = TYPIST_BIGRAM_KEYS[bi];
      const ms = Math.round(bmean / 10) * 10;
      weak.push(`${bg.toUpperCase()} · ${ms} MS`); kinds.push("bigram"); says.push(`${bg[0]} ${bg[1]}, ${ms} milliseconds`);
    }
    const sum = this.typistSegmentSummary(ty);
    r.steady = sum.steady;
    if (sum.steady !== null) { weak.push(`STEADY ${sum.steady}%`); kinds.push("steady"); says.push(`Steady ${sum.steady} percent`); }
    r.weak = weak;
    r.weakKinds = kinds;
    // Best WPM (campaign clears with >= 60 intervals)
    if (scope === "level") {
      this.typistStash(ty, L);
      r.newWpm = ty.bsNew && ty.bsLevel === L;
      r.newWpmValue = ty.bsSpeed;
    } else if (scope === "run") {
      r.newWpm = ty.bsApplied && ty.bsLevel === 10 && ty.bsNew;
      r.newWpmValue = ty.bsSpeed;
    } else {
      r.newWpm = false;
      r.newWpmValue = 0;
    }
    if (!Array.isArray(r.speech)) r.speech = [];
    if (why.say) r.speech.push(why.say);
    r.speech.push(`${misses === 0 ? "No misses" : typistPlural(misses, "miss", "misses")}.`);
    if (says.length) r.speech.push(`Weak signal: ${says.join(". ")}.`);
    if (r.newWpm) r.speech.push(`New best speed: ${r.newWpmValue} words per minute.`);
  },

  // resultsRender listener: the card DOM (rank line, ACC caption, WEAK SIGNAL chips, WPM "--", Best WPM text).
  typistOnResultsRender(evt) {
    const cardEl = evt && evt.cardEl, r = evt && evt.results;
    if (!cardEl || !r) return;
    const q = (sel) => cardEl.querySelector(sel);
    const wpmEl = q('.statTile__value[data-stat="wpm"]');
    if (wpmEl && !(Number(r.wpm) > 0)) wpmEl.textContent = "--";   // < 10 intervals: no count-up ran (its target is 0)
    const badge = q(".newWpm");
    if (badge) badge.textContent = r.newWpm ? `BEST WPM ${r.newWpmValue | 0}` : "Best WPM";
    const why = q('[data-typist="why"]');
    if (why) {
      const text = typeof r.rankWhy === "string" ? r.rankWhy : "";
      why.textContent = text;
      why.title = text;
      why.dataset.kind = r.rankWhyKind || "shortfall";
      why.classList.toggle("hidden", !text);
      why.classList.remove("is-in");
      why.classList.toggle("is-pending", !!(text && evt.animate));
      if (text && evt.animate && cardEl._resultsAnim) {
        const at = typeof RESULTS_RANK_AT_MS === "number" ? RESULTS_RANK_AT_MS : TYPIST_RANK_LINE_AT_MS;   // with the stamp
        cardEl._resultsAnim.timers.push(setTimeout(() => { why.classList.remove("is-pending"); why.classList.add("is-in"); }, at));
      }
    }
    const cap = q('[data-typist="accCaption"]');
    if (cap) {
      cap.textContent = r.accCaption || "";
      cap.classList.toggle("hidden", !r.accCaption);
    }
    const strip = q('[data-typist="weak"]');
    if (strip) {
      const ul = strip.querySelector(".weakSignal__chips");
      const chips = Array.isArray(r.weak) ? r.weak : [];
      if (ul) {
        ul.textContent = "";
        chips.slice(0, 3).forEach((text, i) => {
          const li = document.createElement("li");
          li.className = "wsChip";
          li.dataset.kind = (Array.isArray(r.weakKinds) && r.weakKinds[i]) || "";
          li.textContent = text;
          ul.appendChild(li);
        });
      }
      strip.classList.toggle("hidden", !chips.length);
    }
  },

  // ------------------------- D6: goal, menu, Flight Log -------------------------
  // From the last five campaign sessions with speed > 0 (7.6). Never a penalty.
  typistGoal() {
    const unlocked = clamp((this.save && this.save.lastUnlockedLevel) | 0 || 1, 1, 10);
    const s5 = this.typistSessions(TYPIST_SESSION_CAP).filter((s) => s.mode === "campaign" && s.speed > 0).slice(-TYPIST_GOAL_N);
    if (!s5.length) return { text: `NEXT GOAL · CLEAR SECTOR ${unlocked} AT 90%`, speed: 0, acc: 90, sector: unlocked };
    const medSpeed = typistMedianOf(s5.map((s) => s.speed));
    const medAcc = typistMedianOf(s5.map((s) => s.acc));
    let acc, speed;
    if (medAcc < 95) { acc = clamp(Math.ceil(medAcc - 1e-9) + 2, 90, 99); speed = Math.round(medSpeed); }
    else { acc = clamp(Math.round(medAcc), 95, 99); speed = Math.ceil(medSpeed * 1.05 - 1e-9); }
    const last = s5[s5.length - 1];
    const sector = last.rank === null ? clamp(last.sector | 0, 1, 10) : Math.min(unlocked, clamp((last.sector | 0) + 1, 1, 10));
    return { text: `NEXT GOAL · ${speed} WPM AT ${acc}% IN SECTOR ${sector}`, speed, acc, sector };
  },

  typistOnMenuRender() {
    const p = this.save && this.save.profile;
    const best = p && p.bests ? (p.bests.speed | 0) : 0;
    const row = document.querySelector('[data-typist="bestWpm"]');
    if (row) row.classList.remove("hidden");
    const wpm = document.getElementById("statWpm");
    if (wpm) wpm.textContent = best > 0 ? String(best) : "--";
    const goal = document.getElementById("statGoal");
    if (goal) {
      goal.textContent = this.typistGoal().text;
      goal.classList.remove("hidden");
    }
  },

  // recordsOpen listener (idempotent: #btnRecords is bound twice).
  typistOnRecordsOpen(evt) {
    const modal = (evt && evt.modal) || document.getElementById("recordsModal");
    if (!modal) return;
    const ty = this.typistState();
    this.typistWireRecords(ty, modal);
    const log = document.getElementById("panelLog");
    if (log) log.innerHTML = this.typistFlightLogHtml();
    const note = document.getElementById("hsLegacyNote");
    if (note) {
      const rows = (Array.isArray(this.save.highScores) ? this.save.highScores : []).filter((h) => h && typeof h === "object")
        .slice().sort(byScoreThenNewest).slice(0, 10);
      note.classList.toggle("hidden", !rows.some((h) => h.wpmLegacy));
    }
    this.typistSelectTab(ty.recordsTab, false);
  },

  typistWireRecords(ty, modal) {
    if (ty.tabsWired) return;
    const tabs = modal.querySelector(".recordsTabs");
    const tabHall = document.getElementById("tabHall"), tabLog = document.getElementById("tabLog");
    const hall = document.getElementById("panelHall"), log = document.getElementById("panelLog");
    if (!tabs || !tabHall || !tabLog || !hall || !log) return;
    ty.tabsWired = true;
    tabs.classList.remove("hidden");
    hall.setAttribute("role", "tabpanel"); hall.setAttribute("aria-labelledby", "tabHall"); hall.tabIndex = 0;
    log.setAttribute("role", "tabpanel"); log.setAttribute("aria-labelledby", "tabLog"); log.tabIndex = 0;
    tabHall.addEventListener("click", () => this.typistSelectTab("hall", true));
    tabLog.addEventListener("click", () => this.typistSelectTab("log", true));
    tabs.addEventListener("keydown", (e) => {
      const k = e.key;
      let next = null;
      if (k === "ArrowLeft" || k === "ArrowRight") next = this._ty.recordsTab === "hall" ? "log" : "hall";
      else if (k === "Home") next = "hall";
      else if (k === "End") next = "log";
      if (!next) return;
      e.preventDefault();
      this.typistSelectTab(next, true);
    });
  },

  typistSelectTab(which, focus) {
    const ty = this.typistState();
    const tab = which === "log" ? "log" : "hall";
    ty.recordsTab = tab;
    const tabHall = document.getElementById("tabHall"), tabLog = document.getElementById("tabLog");
    const hall = document.getElementById("panelHall"), log = document.getElementById("panelLog");
    if (!tabHall || !tabLog || !hall || !log) return;
    const onLog = tab === "log";
    tabHall.setAttribute("aria-selected", onLog ? "false" : "true");
    tabLog.setAttribute("aria-selected", onLog ? "true" : "false");
    tabHall.tabIndex = onLog ? -1 : 0;
    tabLog.tabIndex = onLog ? 0 : -1;
    hall.hidden = onLog;
    log.hidden = !onLog;
    if (focus) { try { (onLog ? tabLog : tabHall).focus({ preventScroll: true }); } catch (_) { /* not focusable */ } }
  },

  // Key colour bucket for the Flight Log glyph (none under 15 attempts).
  typistErrBucket(n, err) {
    if (n < TYPIST_WEAK_MIN_N) return "none";
    return err < 0.03 ? "lo" : (err < 0.08 ? "mid" : "hi");
  },

  // The Flight Log panel: numbers and a-z only (no user text), built once per open.
  typistFlightLogHtml() {
    const ty = this.typistState();
    this.typistFlush(this.save, true);
    const p = this.save.profile || typistBlankProfile();
    const goal = this.typistGoal();
    const sessions = this.typistSessions(TYPIST_SPARK_N);
    const head = `<p class="flGoal">${goal.text}</p>`;
    let anyKey = false;
    for (let i = 0; i < 26; i++) if (ty.kN[i] >= TYPIST_WEAK_MIN_N) anyKey = true;
    const legacy = (this.save.bestWpm | 0) > 0 ? `<p class="flLegacy small">OLD BEST ${this.save.bestWpm | 0} · MEASURED BEFORE HONEST SPEED</p>` : "";
    if (!sessions.length && !anyKey) {
      return `${head}<p class="flEmpty">No flights logged yet. Clear a sector and your speed, accuracy and every key you type are logged here, on this device only.</p>${legacy}`;
    }
    const dash = (v) => (v > 0 ? String(v) : "--");
    const b = p.bests || {};
    const drill = b.drill && b.drill.speed > 0 ? `${b.drill.speed | 0} · ${typistRound(b.drill.acc, 1)}%` : "--";
    const stat = (label, value, cap) => `<div class="flStat"><span class="flStat__label">${label}</span><span class="flStat__value mono">${value}</span>${cap ? `<span class="flStat__cap">${cap}</span>` : ""}</div>`;
    const stats = `<div class="flStats">${stat("Best WPM", dash(b.speed | 0))}${stat("Throughput", dash(Math.round(p.thrEma || 0)), "what the stream let you type")}${stat("Days flown", dash(this.typistDaysFlown()))}${stat("Ceiling", dash(b.ceiling | 0))}${stat("Drill", drill)}</div>`;
    // keyboard glyph
    const med = this.typistKeyMedianMs(ty);
    let keyRows = "";
    for (const rowKeys of TYPIST_KEY_ROWS) {
      let row = "";
      for (const ch of rowKeys) {
        const i = typistCode(ch);
        const lat = med > 0 && ty.kMs[i] > 0 ? typistRound(clamp(ty.kMs[i] / (2 * med), 0, 1), 2) : 0;
        row += `<span class="flKey" data-key="${ch}" data-err="${this.typistErrBucket(ty.kN[i], ty.kErr[i])}" style="--lat:${lat}">${ch.toUpperCase()}<i></i></span>`;
      }
      keyRows += `<div class="flKeys__row">${row}</div>`;
    }
    const timed = [];
    for (let i = 0; i < 26; i++) if (ty.kN[i] >= TYPIST_WEAK_MIN_N && ty.kMs[i] > 0) timed.push(i);
    const slowest = timed.slice().sort((x, y) => (ty.kMs[y] - ty.kMs[x]) || (x - y)).slice(0, 5);
    const missed = [];
    for (let i = 0; i < 26; i++) if (ty.kN[i] >= TYPIST_WEAK_MIN_N && ty.kErr[i] > 0) missed.push(i);
    missed.sort((x, y) => (ty.kErr[y] - ty.kErr[x]) || (x - y));
    const weakKeys = this.typistWeakKeys();
    const msOf = (i) => Math.round(ty.kMs[i] / 10) * 10;
    const slowText = slowest.length ? slowest.map((i) => `${TYPIST_LETTERS[i].toUpperCase()} ${msOf(i)} MS`).join(" · ") : "NONE YET";
    const weakText = weakKeys.length ? weakKeys.map((c) => c.toUpperCase()).join(" · ") : "NONE YET";
    const sr = `Weak keys: ${weakKeys.length ? weakKeys.join(", ") : "none yet"}. Slowest keys: ${slowest.length ? slowest.map((i) => `${TYPIST_LETTERS[i]} ${msOf(i)} milliseconds`).join(", ") : "none yet"}. Most missed: ${missed.length ? missed.slice(0, 5).map((i) => `${TYPIST_LETTERS[i]} ${Math.round(ty.kErr[i] * 100)} percent`).join(", ") : "none yet"}.`;
    const keys = `<div class="flKeys" aria-hidden="true">${keyRows}</div><p class="srOnly flSr">${sr}</p>`;
    const lists = `<div class="flLists"><p class="flList"><span class="flList__label">Slowest keys</span> <span class="mono" data-fl="slowest">${slowText}</span></p><p class="flList"><span class="flList__label">Weak keys</span> <span class="mono" data-fl="weak">${weakText}</span></p></div>`;
    // sparkline: speed (cyan, min..max of the shown speeds; speed 0 leaves a gap), accuracy (amber, 80..100 %)
    let spark = "";
    if (sessions.length) {
      const N = sessions.length;
      const xOf = (i) => (N > 1 ? typistRound(i * 200 / (N - 1), 1) : 100);
      const sp = sessions.map((s) => s.speed).filter((v) => v > 0);
      const lo = sp.length ? Math.min(...sp) : 0, hi = sp.length ? Math.max(...sp) : 0;
      const ySp = (v) => typistRound(hi > lo ? 44 - (v - lo) / (hi - lo) * 40 : 24, 1);
      const yAcc = (v) => typistRound(44 - clamp((v - 80) / 20, 0, 1) * 40, 1);
      const segs = [];
      let cur = [];
      sessions.forEach((s, i) => {
        if (s.speed > 0) cur.push(`${xOf(i)},${ySp(s.speed)}`);
        else if (cur.length) { segs.push(cur); cur = []; }
      });
      if (cur.length) segs.push(cur);
      const speedLines = segs.map((pts) => `<polyline class="flSpark__speed" points="${pts.join(" ")}"/>`).join("");
      const accLine = `<polyline class="flSpark__acc" points="${sessions.map((s, i) => `${xOf(i)},${yAcc(s.acc)}`).join(" ")}"/>`;
      const lastS = sessions[N - 1];
      const summary = `Last ${N} ${N === 1 ? "session" : "sessions"}: speed ${sp.length ? `${lo} to ${hi} words per minute` : "not measured"}, latest accuracy ${typistRound(lastS.acc, 1)} percent.`;
      spark = `<div class="flSpark"><p class="flList__label">Speed and accuracy · last ${N}</p><svg viewBox="0 0 200 48" role="img" aria-label="${summary}" preserveAspectRatio="none"><title>${summary}</title>${accLine}${speedLines}</svg><p class="srOnly">${summary}</p></div>`;
    }
    const unlocked = clamp((this.save.lastUnlockedLevel | 0) || 1, 1, 10);
    let rows = "";
    for (let L = 1; L <= 10; L++) {
      const e = p.sectorBest && p.sectorBest[String(L)];
      const spd = e && e.speed > 0 ? String(e.speed) : "--";
      const acc = e && e.acc > 0 ? `${typistRound(e.acc, 1)}%` : "--";
      rows += `<tr class="${L > unlocked ? "is-locked" : ""}"><td>${L}</td><td>${spd}</td><td>${acc}</td></tr>`;
    }
    const table = `<table class="hsTable flSectors"><caption class="flList__label">Sector bests</caption><thead><tr><th scope="col">Sector</th><th scope="col">Best WPM</th><th scope="col">Best Acc</th></tr></thead><tbody>${rows}</tbody></table>`;
    return `${head}${stats}${legacy}${keys}${lists}${spark}${table}`;
  },

  // ------------------------- Save: flush (saveStore) -------------------------
  // Folds the dirty per-key / bigram tables into save.profile in place; only for the save the tables mirror.
  typistFlush(save, force) {
    const ty = this._ty;
    if (!ty || !save || ty.saveRef !== save) return;
    if (!ty.keysDirty && !ty.bigramsDirty && !force) return;
    const p = save.profile;
    if (!p || typeof p !== "object") return;
    if (ty.keysDirty || force) {
      if (!p.keys || typeof p.keys !== "object") p.keys = {};
      for (let i = 0; i < 26; i++) {
        if (!(ty.kN[i] > 0)) continue;
        const ch = TYPIST_LETTERS[i];
        const e = p.keys[ch] || (p.keys[ch] = { n: 0, err: 0, ms: 0 });
        e.n = ty.kN[i]; e.err = typistRound(ty.kErr[i], 4); e.ms = Math.round(ty.kMs[i]);
      }
      ty.keysDirty = false;
    }
    if (ty.bigramsDirty || force) {
      if (!p.bigrams || typeof p.bigrams !== "object") p.bigrams = {};
      let m = 0;
      for (let i = 0; i < 676; i++) if (ty.bN[i] > 0) ty.bIdx[m++] = i;
      ty.bKeep.fill(0);
      if (m > TYPIST_BIGRAM_CAP) {
        const v = ty.bIdx.subarray(0, m);
        const bN = ty.bN, bMs = ty.bMs;
        v.sort((x, y) => (bN[y] - bN[x]) || (bMs[y] - bMs[x]) || (x - y));
        m = TYPIST_BIGRAM_CAP;
      }
      for (let j = 0; j < m; j++) ty.bKeep[ty.bIdx[j]] = 1;
      for (const k of Object.keys(p.bigrams)) {
        const i = this.typistBigramIndex(k);
        if (i < 0 || !ty.bKeep[i]) delete p.bigrams[k];
      }
      for (let j = 0; j < m; j++) {
        const i = ty.bIdx[j];
        const k = TYPIST_BIGRAM_KEYS[i];
        const e = p.bigrams[k] || (p.bigrams[k] = { n: 0, ms: 0 });
        e.n = ty.bN[i]; e.ms = Math.round(ty.bMs[i]);
      }
      ty.bigramsDirty = false;
    }
  },

  // ------------------------- Debug (probes) -------------------------
  typistDebug() {
    const ty = this.typistState();
    const now = nowMs();
    const pairLive = !!(ty.pRef && ty.pRef.typoCh && now - (ty.pRef.typoAt || 0) < TYPIST_PAIR_MS);
    const popLive = ty.popAt > 0 && now - ty.popAt < TYPIST_POP_MS;
    return {
      ring: ty.rCount,
      seg: { kind: ty.segKind, n: ty.sN, ms: Math.round(ty.sMs * 100) / 100, keys: ty.sKeys, miss: ty.sMiss, hits: ty.sHits },
      run: { id: ty.runId, n: ty.runN, ms: Math.round(ty.runMs * 100) / 100 },
      last: ty.rCount ? ty.rMs[(ty.rHead - 1) & (TYPIST_RING - 1)] : 0,
      pair: { ch: pairLive ? ty.pRef.typoCh : null, at: pairLive ? ty.pAt : 0, kind: pairLive ? ty.pKind : null },
      pop: { ch: popLive ? ty.popCh : null, at: popLive ? ty.popAt : 0, dir: ty.popDir, shown: popLive && ty.popShown },
      pulseAt: ty.puRef ? (ty.puRef.leadPulseAt || 0) : 0,
      weak: this.typistWeakKeys().slice(),
      bigram: this.typistWeakBigram(),
      cause: this.typistCauseParts().text,
      hit: { src: ty.hitSrc, wave: ty.hitWave, phase: ty.hitPhase },
      leaks: { wave: Array.from(ty.lkWave), letters: Array.from(ty.lkWaveLetters), minion: Array.from(ty.lkMinion), surge: Array.from(ty.lkSurge) },
      stash: { level: ty.bsLevel, runId: ty.bsRunId, speed: ty.bsSpeed, isNew: ty.bsNew, applied: ty.bsApplied }
    };
  }
});

// ----------------------------- Listeners (registration order = script order) -----------------------------
if (typeof onGameHook === "function") {
  onGameHook("keyCorrect", function (e) { this.typistOnCorrect(e); });
  onGameHook("keyMiss", function (e) { this.typistOnMiss(e); });
  onGameHook("modeChange", function () {
    const ty = this._ty;
    if (ty) { ty.cRef = null; ty.cSeg = -1; ty.cIndex = -1; ty.cAt = 0; }   // pause, blur, screens: the chain restarts
  });
  onGameHook("sectorStart", function (e) {
    const ty = this.typistState();
    this.typistSyncRun(ty);
    this.typistBeginSegment("sector");
    if (e && e.restored) {   // Continue mid-sector: the segment resumes from the saved level stats (tables restart)
      const ls = this.levelStats || {};
      ty.sN = Math.max(0, ls.spdN | 0); ty.sMs = Math.max(0, Number(ls.spdMs) || 0); ty.sSq = Math.max(0, Number(ls.spdSq) || 0);
      ty.sHits = Math.max(0, ls.hits | 0); ty.sKeys = Math.max(0, ls.total | 0); ty.sMiss = Math.max(0, (ls.total | 0) - (ls.correct | 0));
    }
  });
  onGameHook("leak", function (e) {
    const ty = this.typistState();
    const minion = !!(e && e.kind === "bossMinion");
    ty.lastLeakMinion = minion;
    if (minion) ty.lkMinion[clamp(this.boss ? (this.boss.phase | 0) : 0, 0, 3)]++;
    else {
      const w = clamp(this.wave | 0, 0, 2);
      ty.lkWave[w]++;
      if (e && e.len === 1) ty.lkWaveLetters[w]++;
    }
  });
  onGameHook("hullDamage", function (e) {
    const ty = this.typistState();
    ty.sHits++;
    const ls = this.levelStats;
    if (ls) ls.hits = (ls.hits | 0) + 1;
    const src = e ? e.source : "";
    ty.hitSrc = src === "surge" ? "surge" : ((src === "minion" || (src === "leak" && ty.lastLeakMinion)) ? "minion" : "leak");
    ty.hitWave = e ? (e.wave | 0) : 0;
    ty.hitPhase = e ? (e.phase | 0) : -1;
    if (src === "surge") ty.lkSurge[clamp(ty.hitPhase, 0, 3)]++;
    ty.lastLeakMinion = false;
  });
  onGameHook("results", function (evt) { this.typistOnResults(evt); });
  onGameHook("sectorEnd", function (evt) { this.typistOnSectorEnd(evt); });
  onGameHook("resultsRender", function (evt) { this.typistOnResultsRender(evt); });
  onGameHook("menuRender", function () { this.typistOnMenuRender(); });
  onGameHook("recordsOpen", function (evt) { this.typistOnRecordsOpen(evt); });
  onGameHook("renderOverlay", function (evt) { this.typistDrawOverlay(evt.ctx); });
  // Static emits (CONTRACT 8.x R2): read evt, never this.
  onGameHook("saveMigrate", function (evt) {
    const save = evt && evt.save;
    if (!save) return;
    const src = (evt.src && typeof evt.src === "object") ? evt.src : {};
    save.profile = typistMigrateProfile(src.profile);
    if (!(Number(src.schema) >= 3)) {   // WPM measured before honest speed keeps its number, flagged legacy
      if (Array.isArray(save.highScores)) {
        save.highScores = save.highScores.map((h) => (h && typeof h === "object" && typeof h.wpmLegacy !== "boolean") ? { ...h, wpmLegacy: true } : h);
      }
      if (save.sectorBests && typeof save.sectorBests === "object") {
        for (const k of Object.keys(save.sectorBests)) {
          const e = save.sectorBests[k];
          if (e && typeof e === "object") save.sectorBests[k] = { ...e, wpmLegacy: true };
        }
      }
    }
  });
  onGameHook("saveStore", function (evt) {
    const g = (typeof window !== "undefined" && window.game) || null;
    if (g && typeof g.typistFlush === "function" && evt && evt.save) g.typistFlush(evt.save, false);
  });
}
