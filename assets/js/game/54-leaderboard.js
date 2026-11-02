// Type-R 198X — LEADERBOARD track: the optional public daily-sortie board. Loads after 52-modes.js (reads modes* helpers,
// ASSET_VERSION, storeSave, onGameHook). Hooks consumed: modesRunStart, modesRunEnd, menuRender; wraps Game.prototype
// renderModeResults (the "Today's board" block under the sortie card) and setSetting (the opt-in creates the token).
// Top-level names LEADERBOARD* / lb*.
//
// OFF BY DEFAULT. LEADERBOARD.endpoint === "" means the feature does not exist: no DOM is shown, no request is made,
// the settings row stays hidden and the game runs exactly as before. To enable, set endpoint to "./api/leaderboard.php"
// (same origin: api/leaderboard.php on the SiteGround host) or to a Cloudflare Worker URL (tools/leaderboard/worker.js),
// deploy, and see tools/leaderboard/README.md for the private directory and the contract.
//
// Privacy: nothing is sent unless settings.shareDailyScores is true (the "Share daily sortie scores" row). A submission
// carries the pilot name (sanitised, <= 12 chars), an anonymous save-local UUID (save.playerToken, rotated by Reset
// save) and today's counted result; the GET that fills the board sends the day and, when one exists, the token (so the
// server can answer "you"). Nothing runs in the render loop; every request is async with a timeout and never blocks
// play; failures are shown as a muted "Board unavailable" line, never as a toast.
//
// Harness: window.TypeRHarness.leaderboardEndpoint = "<url>" overrides the endpoint (probes mock it with page.route).

const LEADERBOARD = Object.freeze({
  endpoint: "",          // "" = off. "./api/leaderboard.php" (same origin) or "https://<worker>.workers.dev" to enable.
  timeoutMs: 6000,       // per request (AbortController)
  top: 10,               // rows shown on the results board
  nameMax: 12,           // pilot name length on the board (code points)
  teaserMinMs: 300000,   // the menu teaser fetches at most once per 5 minutes (per day key)
  retries: 1             // one retry on a network failure / timeout of the POST (never on an HTTP 4xx)
});
const LEADERBOARD_SHIPS = Object.freeze(["coconut", "little-dark-one", "sofrito", "honeybee"]);
const LEADERBOARD_RANKS = Object.freeze(["S", "A", "B", "C", "D"]);
const LEADERBOARD_LIMITS = Object.freeze({ rating: 3000, speed: 300, acc: 100, score: 5000000 });
const LEADERBOARD_COPY = Object.freeze({
  title: "Today's board",
  loading: "Loading today's board…",
  empty: "Be the first pilot today",
  unavailable: "Board unavailable",
  teaserEmpty: "Board: be the first pilot today",
  teaserUnavailable: "Board unavailable",
  noteOff: "Turn on Share daily sortie scores in Settings to enter the board.",
  notePractice: "Practice sorties do not enter the board.",
  noteUnrated: "Too few keys to rate · not sent.",
  noteFailed: "Board unavailable · your result was not sent.",
  noteLimited: "Board busy · your result was not sent.",
  noteRejected: "The board did not accept this result."
});
const LEADERBOARD_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Pure helpers (window globals; t-leaderboard) ---
// trim, collapse whitespace, strip control / zero-width / bidi characters, <= nameMax code points, fallback PILOT.
function lbSanitiseName(name, max = LEADERBOARD.nameMax) {
  let s = String(name == null ? "" : name);
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  s = Array.from(s).slice(0, Math.max(1, max | 0)).join("").trim();
  return s || "PILOT";
}

function lbIsUuid(s) {
  return typeof s === "string" && LEADERBOARD_UUID_RE.test(s);
}

// crypto.randomUUID where it exists (secure contexts), else a v4 UUID from getRandomValues.
function lbMakeToken() {
  const c = (typeof crypto !== "undefined") ? crypto : null;
  try { if (c && typeof c.randomUUID === "function") return c.randomUUID().toLowerCase(); } catch (_) { /* fall through */ }
  const b = new Uint8Array(16);
  try { c.getRandomValues(b); } catch (_) { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function lbInt(v, lo, hi) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? clamp(n, lo, hi) : lo;
}

// A board row from the server, bounded like the server bounds it (the DOM only ever shows text we built).
function lbCleanRow(x) {
  const o = (x && typeof x === "object") ? x : {};
  const acc = Number(o.acc);
  return {
    name: lbSanitiseName(o.name), rating: lbInt(o.rating, 0, LEADERBOARD_LIMITS.rating), speed: lbInt(o.speed, 0, LEADERBOARD_LIMITS.speed),
    acc: Number.isFinite(acc) ? clamp(acc, 0, 100) : 0, sector: lbInt(o.sector, 1, 10), ship: LEADERBOARD_SHIPS.includes(o.ship) ? o.ship : ""
  };
}

function lbCleanYou(y) {
  if (!y || typeof y !== "object") return null;
  const rank = Math.round(Number(y.rank));
  if (!Number.isFinite(rank) || rank < 1) return null;
  return { rank, rating: lbInt(y.rating, 0, LEADERBOARD_LIMITS.rating) };
}

function lbPlural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

Object.assign(Game.prototype, {
  // --- Gate ---
  lbEndpoint() {
    const H = (typeof window !== "undefined" && window.TypeRHarness) || null;
    if (H && typeof H.leaderboardEndpoint === "string") return H.leaderboardEndpoint.trim();   // probes only
    return typeof LEADERBOARD.endpoint === "string" ? LEADERBOARD.endpoint.trim() : "";
  },

  lbEnabled() {
    return !!this.lbEndpoint() && typeof fetch === "function";
  },

  lbConsent() {
    const s = this.save;
    return !!(s && s.settings && s.settings.shareDailyScores === true);
  },

  // The anonymous token; create = true mints one in memory (the caller's save write persists it).
  lbToken(create = false) {
    const s = this.save;
    if (!s) return "";
    if (lbIsUuid(s.playerToken)) return s.playerToken.toLowerCase();
    if (!create) return "";
    s.playerToken = lbMakeToken();
    return s.playerToken;
  },

  lbState() {
    if (!this._lb) this._lb = { seq: 0, board: null, boardState: "idle", errorAt: 0, errorDay: "", inflight: null, run: null, sig: { teaser: "", results: "" } };
    return this._lb;
  },

  lbToday() {
    if (typeof modesIsoDate === "function" && typeof modesDateKey === "function") {
      return modesIsoDate(modesDateKey(typeof this.modesNow === "function" ? this.modesNow() : new Date()));
    }
    return new Date().toISOString().slice(0, 10);
  },

  lbUrl(params) {
    const base = this.lbEndpoint();
    const q = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join("&");
    return q ? `${base}${base.includes("?") ? "&" : "?"}${q}` : base;
  },

  // --- Network (async, timed out, never awaited by game code) ---
  async lbRequest(url, opts = {}) {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, opts.timeoutMs || LEADERBOARD.timeoutMs);
    try {
      const init = { method: opts.method || "GET", cache: "no-store", credentials: "omit", headers: { Accept: "application/json" } };
      if (ctrl) init.signal = ctrl.signal;
      if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
      const res = await fetch(url, init);
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      return { ok: res.ok, status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  },

  // The POST body (the contract in tools/leaderboard/README.md); the token is created here if the save has none yet.
  lbPayload(r) {
    const ship = (this.run && this.run.shipId) || (typeof this.currentShipId === "function" ? this.currentShipId() : "") || "";
    const acc = Number(r.acc);
    return {
      day: r.iso,
      token: this.lbToken(true),
      name: lbSanitiseName(this.save && this.save.playerName),
      rating: lbInt(r.rating, 0, LEADERBOARD_LIMITS.rating),
      speed: lbInt(r.speed, 0, LEADERBOARD_LIMITS.speed),
      acc: Number.isFinite(acc) ? Math.round(clamp(acc, 0, 100) * 100) / 100 : 0,
      score: lbInt(r.score, 0, LEADERBOARD_LIMITS.score),
      sector: lbInt(r.sector, 1, 10),
      ship: LEADERBOARD_SHIPS.includes(ship) ? ship : "coconut",
      rank: LEADERBOARD_RANKS.includes(r.rank) ? r.rank : null,
      version: typeof ASSET_VERSION === "string" ? ASSET_VERSION.slice(0, 24) : ""
    };
  },

  lbSubmittable(r) {
    return !!r && r.mode === "daily" && !!r.counted && Number.isFinite(r.rating) && r.speed != null && typeof r.iso === "string";
  },

  // modesRunEnd (daily): decide, then run the async chain (POST when allowed, then GET today's board).
  lbOnRunEnd(evt) {
    if (!evt || evt.mode !== "daily" || !evt.result || !this.lbEnabled()) return;
    const S = this.lbState();
    const r = evt.result;
    const run = S.run = { result: r, day: r.iso, status: "idle", you: null, error: null, seq: ++S.seq };
    if (!this.lbConsent()) run.status = "off";
    else if (!r.counted) run.status = "practice";
    else if (!this.lbSubmittable(r)) run.status = "unrated";
    else run.status = "posting";
    this.lbRunChain(run).catch((e) => { console.warn("[TypeR] leaderboard", e && e.message); });
  },

  async lbRunChain(run) {
    if (run.status === "posting") await this.lbSubmit(run);
    await this.lbLoadBoard(run.day, { force: true });
  },

  async lbSubmit(run) {
    const S = this.lbState();
    const had = lbIsUuid(this.save && this.save.playerToken);
    const payload = this.lbPayload(run.result);
    if (!had) { try { storeSave(this.save); } catch (_) { /* memory only */ } }   // normally minted at modesRunStart and stored by modesBank
    let res = null, err = null;
    for (let attempt = 0; attempt <= LEADERBOARD.retries; attempt++) {
      try { res = await this.lbRequest(this.lbEndpoint(), { method: "POST", body: payload }); err = null; break; }
      catch (e) { err = e; res = null; }   // network failure / timeout: one retry
    }
    if (S.run !== run) return;   // a newer sortie ended meanwhile
    if (res && res.ok && res.data && Number.isFinite(Number(res.data.rank))) {
      run.status = "posted";
      run.you = { rank: Math.max(1, Math.round(Number(res.data.rank))), total: Math.max(1, Math.round(Number(res.data.total)) || 1), rating: lbInt(res.data.rating, 0, LEADERBOARD_LIMITS.rating) };
    } else if (res && res.status === 429) run.status = "limited";
    else if (res && res.status >= 400 && res.status < 500) { run.status = "rejected"; run.error = (res.data && res.data.error) || `http_${res.status}`; }
    else { run.status = "failed"; run.error = err ? (err.name === "AbortError" ? "timeout" : "network") : `http_${res ? res.status : 0}`; }
    this.lbRenderAll();
  },

  // GET today's board; cached per day for teaserMinMs unless forced. Resolves to the cached board (or null).
  lbLoadBoard(day, opts = {}) {
    const S = this.lbState();
    if (!this.lbEnabled() || typeof day !== "string") return Promise.resolve(null);
    const now = nowMs();
    if (!opts.force && S.board && S.board.day === day && now - S.board.at < LEADERBOARD.teaserMinMs) return Promise.resolve(S.board);
    if (S.inflight && S.inflight.day === day) return S.inflight.p;
    if (S.boardState !== "ok" || !S.board || S.board.day !== day) { S.boardState = "loading"; this.lbRenderAll(); }
    const p = (async () => {
      try {
        const res = await this.lbRequest(this.lbUrl({ day, token: this.lbToken(false) || undefined }));
        if (res.ok && res.data && Array.isArray(res.data.top)) {
          S.board = { day, total: Math.max(0, Math.round(Number(res.data.total)) || 0), top: res.data.top.slice(0, LEADERBOARD.top).map(lbCleanRow), you: lbCleanYou(res.data.you), at: nowMs() };
          S.boardState = "ok";
        } else { S.boardState = "error"; S.errorAt = nowMs(); S.errorDay = day; }
      } catch (_) {
        S.boardState = "error"; S.errorAt = nowMs(); S.errorDay = day;
      } finally {
        if (S.inflight && S.inflight.p === p) S.inflight = null;
        this.lbRenderAll();
      }
      return S.board && S.board.day === day ? S.board : null;
    })();
    S.inflight = { day, p };
    return p;
  },

  // --- DOM ---
  lbSetVisible() {
    const row = document.getElementById("setShareScoresRow");
    const on = this.lbEnabled();
    if (row && row.classList.contains("hidden") === on) row.classList.toggle("hidden", !on);
  },

  lbTeaserEl() {
    let el = document.getElementById("dailyBoard");
    if (!el) {
      const deck = document.getElementById("modeDeck");
      if (!deck) return null;
      el = document.createElement("p");
      el.id = "dailyBoard";
      el.className = "modeDeck__board small hidden";
      el.setAttribute("aria-live", "polite");
      deck.appendChild(el);
    }
    return el;
  },

  lbBoardEl(card) {
    let el = document.getElementById("modesBoard");
    if (!el && card) {
      el = document.createElement("section");
      el.id = "modesBoard";
      el.className = "modesBoard hidden";
      el.setAttribute("aria-live", "polite");
      el.setAttribute("aria-labelledby", "modesBoardTitle");
      card.appendChild(el);
    }
    return el;
  },

  lbRenderAll() {
    this.lbRenderTeaser();
    if (this.mode === "modeResults") {
      const M = this._modes;
      if (M && M.result) this.lbRenderResults(document.getElementById("resultsMode"), M.result);
    }
  },

  // menuRender: the settings row follows the gate; the teaser fetches at most once per 5 minutes per day.
  lbTeaserTick() {
    this.lbSetVisible();
    if (!this.lbEnabled()) return;
    const open = typeof this.modesUnlocked === "function" ? this.modesUnlocked() : true;
    if (open) {
      const S = this.lbState();
      const day = this.lbToday();
      const now = nowMs();
      const fresh = (S.board && S.board.day === day && now - S.board.at < LEADERBOARD.teaserMinMs) ||
        (S.boardState === "error" && S.errorDay === day && now - S.errorAt < LEADERBOARD.teaserMinMs);
      if (!fresh && !S.inflight) this.lbLoadBoard(day).catch(() => {});
    }
    this.lbRenderTeaser();
  },

  lbRenderTeaser() {
    const el = this.lbTeaserEl();
    if (!el) return;
    const S = this.lbState();
    const open = typeof this.modesUnlocked === "function" ? this.modesUnlocked() : true;
    let text = "", muted = false;
    if (this.lbEnabled() && open) {
      const day = this.lbToday();
      if (S.board && S.board.day === day) {
        const top = S.board.top[0];
        text = (S.board.total > 0 && top) ? `Board: ${top.name} leads with ${top.rating} · ${lbPlural(S.board.total, "pilot", "pilots")}` : LEADERBOARD_COPY.teaserEmpty;
      } else if (S.boardState === "error" && S.errorDay === day) { text = LEADERBOARD_COPY.teaserUnavailable; muted = true; }
    }
    const sig = `${text}|${muted}`;
    if (sig === S.sig.teaser) return;
    S.sig.teaser = sig;
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle("hidden", !text);
    el.classList.toggle("is-muted", muted);
  },

  // Under the sortie card: title, rows (yours highlighted), "You: #n of total", a muted note for every other outcome.
  lbRenderResults(card, r) {
    const el = this.lbBoardEl(card);
    if (!el) return;
    const S = this.lbState();
    if (!this.lbEnabled() || !r || r.mode !== "daily") {
      if (S.sig.results !== "off") { S.sig.results = "off"; el.replaceChildren(); el.classList.add("hidden"); }
      return;
    }
    const day = r.iso;
    const run = S.run && S.run.result === r ? S.run : null;
    const board = S.board && S.board.day === day ? S.board : null;
    const state = board ? "ok" : (S.boardState === "error" && S.errorDay === day) ? "error" : "loading";
    const you = run && run.you ? { rank: run.you.rank, total: run.you.total } : (board && board.you ? { rank: board.you.rank, total: board.total } : null);
    const note = !run ? "" : run.status === "off" ? LEADERBOARD_COPY.noteOff : run.status === "practice" ? LEADERBOARD_COPY.notePractice
      : run.status === "unrated" ? LEADERBOARD_COPY.noteUnrated : run.status === "failed" ? LEADERBOARD_COPY.noteFailed
        : run.status === "limited" ? LEADERBOARD_COPY.noteLimited : run.status === "rejected" ? LEADERBOARD_COPY.noteRejected : "";
    const rows = board ? board.top : [];
    const sig = JSON.stringify([day, state, rows, you, note, run && run.status]);
    if (sig === S.sig.results) return;
    S.sig.results = sig;

    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const frag = document.createDocumentFragment();
    const h = mk("h3", "modesBoard__title", LEADERBOARD_COPY.title);
    h.id = "modesBoardTitle";
    frag.appendChild(h);
    el.dataset.state = state;
    if (state === "loading") frag.appendChild(mk("p", "modesBoard__status", LEADERBOARD_COPY.loading));
    else if (state === "error") frag.appendChild(mk("p", "modesBoard__status is-muted", LEADERBOARD_COPY.unavailable));
    else if (!rows.length) frag.appendChild(mk("p", "modesBoard__status", LEADERBOARD_COPY.empty));
    else {
      const table = mk("table", "lbTable");
      const thead = mk("thead"), tr = mk("tr");
      for (const t of ["#", "Pilot", "Rating", "WPM", "Acc"]) { const th = mk("th", null, t); th.scope = "col"; tr.appendChild(th); }
      thead.appendChild(tr);
      table.appendChild(thead);
      const tbody = mk("tbody");
      rows.forEach((row, i) => {
        const rank = i + 1;
        const trr = mk("tr", `lbRow${you && you.rank === rank ? " is-you" : ""}`);
        if (you && you.rank === rank) trr.setAttribute("aria-current", "true");
        trr.appendChild(mk("td", "lbRank", String(rank)));
        trr.appendChild(mk("td", "lbName", row.name));
        trr.appendChild(mk("td", "lbRating", String(row.rating)));
        trr.appendChild(mk("td", "lbSpeed", String(row.speed)));
        trr.appendChild(mk("td", "lbAcc", `${Math.floor(row.acc)}%`));
        tbody.appendChild(trr);
      });
      table.appendChild(tbody);
      frag.appendChild(table);
    }
    if (you) frag.appendChild(mk("p", "modesBoard__you", `You: #${you.rank} of ${you.total}`));
    if (note) frag.appendChild(mk("p", "modesBoard__note is-muted", note));
    el.replaceChildren(frag);
    el.classList.remove("hidden");
  },

  // --- Probes ---
  lbDebug() {
    const g = this;
    return {
      enabled: () => g.lbEnabled(),
      endpoint: () => g.lbEndpoint(),
      state: () => {
        const S = g.lbState();
        return { boardState: S.boardState, board: S.board, run: S.run ? { day: S.run.day, status: S.run.status, you: S.run.you, error: S.run.error } : null, inflight: !!S.inflight };
      },
      reset: () => { g._lb = null; },
      refresh: () => g.lbLoadBoard(g.lbToday(), { force: true })
    };
  }
});

// --- Wrappers + hook listeners (registered at load; this = game) ---
if (typeof Game === "function" && typeof onGameHook === "function") {
  const lbOrigRender = Game.prototype.renderModeResults;
  if (typeof lbOrigRender === "function") {
    Game.prototype.renderModeResults = function (card, r, opts) {
      const out = lbOrigRender.call(this, card, r, opts);
      try { this.lbRenderResults(card, r); } catch (e) { console.error("[TypeR] leaderboard results", e); }
      return out;
    };
  }
  const lbOrigSetSetting = Game.prototype.setSetting;
  if (typeof lbOrigSetSetting === "function") {
    Game.prototype.setSetting = function (key, value) {
      const out = lbOrigSetSetting.call(this, key, value);
      // Opting in mints the token; the settings debounce (scheduleSettingsSave) persists it with the setting.
      if (key === "shareDailyScores" && value === true && this.lbEnabled()) { try { this.lbToken(true); } catch (_) { /* no crypto */ } }
      return out;
    };
  }
  // A counted daily with consent mints the token before the run, so modesBank's one save write carries it.
  onGameHook("modesRunStart", function (evt) { if (evt && evt.mode === "daily" && evt.counted && this.lbEnabled() && this.lbConsent()) this.lbToken(true); });
  onGameHook("modesRunEnd", function (evt) { this.lbOnRunEnd(evt); });
  onGameHook("menuRender", function () { this.lbTeaserTick(); });
}
