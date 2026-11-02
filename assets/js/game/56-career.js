// Type-R 198X — CAREER (2026-11): what a campaign clear leaves behind. Methods are mixed into Game.prototype; load
// order is defined in index.html (after 54-leaderboard.js, before 58-wallpaper.js).
//
// Every clear of sector 10 records a COMMENDATION (rank, ship, loop, score, speed, accuracy, date) in save.career and
// earns one BOON PICK: a permanent perk chosen from three offers (seven exist). Power and pressure rise together: each
// clear also unlocks the next LOOP (New Game+, up to CAREER.loopCap): plates +6 % speed per loop, the boss carries one
// more segment per loop, every point scores +10 % per loop. Clears unlock ships (1 / 5 / 12, drawn by 14-hangar.js)
// and cosmetic BEAM TIERS for the main weapon (1 / 5 / 12 / 20, drawn by 75-fx-draw.js); the twentieth clear is the
// prestige seal. The Daily Sortie, Endless Drift and Drill never see boons or loops (modesActive()), and the PURE
// setting turns both off for campaign runs too (the run is tagged PURE, the records table shows it).
//
// Surfaces: the SERVICE RECORD strip under the title hero (badge per commendation, loop selector, boon chips, pending
// pick), the victory screen's COMMENDATION panel (stamp, boon pick, unlock callouts, the wallpaper slot 58-wallpaper.js
// fills), the boon pick modal (#boonModal), a Commendations table in the records modal, results tags LOOP n / PURE /
// BOONS, and the "Career boons & loops" settings toggle.
//
// Save: save.career = { clears, loop, pure, boons[], picks, commendations[] } (40-save.js normaliseCareer migrates the
// old save.victories count into clears + picks). Run: run.loop / run.boons / run.pure are stamped by newRunRecord and
// survive a reload (migrateRun spreads the record). Hooks fired: careerClear { n, commendation }, careerBoonPicked { id }.

const CAREER = Object.freeze({
  loopCap: 5,
  speedPerLoop: 0.06,
  scorePerLoop: 0.10,
  bossSegmentsPerLoop: 1,
  shipUnlocks: Object.freeze({ paprika: 1, nightjar: 5, moonpie: 12 }),
  beamTiers: Object.freeze([1, 5, 12, 20]),          // clears needed for beam tier 1..4
  prestigeAt: 20,
  shieldStartS: 4,
  longBurnMul: 1.5,
  fieldRepairMul: 1.5,
  wideSpreadMul: 1.4,
  hotEngineMul: 1.25,
  offers: 3
});

const CAREER_BOONS = Object.freeze([
  Object.freeze({ id: "shieldStart", name: "Shield Start", glyph: "◈", desc: "Every sector opens with a 4 s shield already up." }),
  Object.freeze({ id: "absorb", name: "Absorb", glyph: "◉", desc: "The first plate to reach your hull in each sector is absorbed." }),
  Object.freeze({ id: "longBurn", name: "Long Burn", glyph: "▲", desc: "Powerups last half as long again." }),
  Object.freeze({ id: "safeRelease", name: "Safe Release", glyph: "⟲", desc: "Once per wave, releasing a lock keeps the letters you typed." }),
  Object.freeze({ id: "fieldRepair", name: "Field Repair", glyph: "✚", desc: "Repair kits restore half as much hull again." }),
  Object.freeze({ id: "wideSpread", name: "Wide Spread", glyph: "✦", desc: "Spread blasts reach 40 % further." }),
  Object.freeze({ id: "hotEngine", name: "Hot Engine", glyph: "⚡", desc: "The Overdrive meter charges 25 % faster." })
]);
const CAREER_BOON_BY_ID = Object.freeze(Object.fromEntries(CAREER_BOONS.map((b) => [b.id, b])));
const CAREER_BEAM_NAMES = Object.freeze(["Standard", "Twin Rail", "Prism", "Lance", "Aurora"]);
const CAREER_SHIP_NAMES = Object.freeze({ paprika: "The S.S. Paprika", nightjar: "The S.S. Nightjar", moonpie: "The S.S. Moonpie" });

function careerDefault() {
  return { clears: 0, loop: 0, pure: false, boons: [], picks: 0, commendations: [] };
}

Object.assign(Game.prototype, {
  // ------------------------- State -------------------------
  career() {
    const s = this.save;
    if (!s) return careerDefault();
    const c = s.career;
    // a missing or partial block (probes and older saves write { clears: n } alone) is normalised in place
    if (!c || typeof c !== "object" || !Array.isArray(c.boons) || !Array.isArray(c.commendations) || !Number.isFinite(c.picks) || !Number.isFinite(c.loop)) {
      s.career = (typeof normaliseCareer === "function") ? normaliseCareer(c && typeof c === "object" ? c : null, s.victories | 0) : careerDefault();
    }
    return s.career;
  },

  careerClears() { return this.career().clears | 0; },
  careerLoopMax() { return clamp(this.careerClears(), 0, CAREER.loopCap); },
  careerPure() { return !!this.career().pure; },

  // Boons / loop apply to campaign runs only, never to the modes, never under PURE.
  careerRunActive() {
    if (typeof this.modesActive === "function" && this.modesActive()) return false;
    const run = this.run;
    if (!run) return false;
    return !run.pure;
  },
  careerLoopActive() {
    return this.careerRunActive() ? ((this.run.loop | 0) || 0) : 0;
  },
  careerBoonActive(id) {
    if (!this.careerRunActive()) return false;
    const list = this.run.boons;
    return Array.isArray(list) && list.includes(id);
  },

  careerBeamTier() {
    const n = this.careerClears();
    let t = 0;
    for (const at of CAREER.beamTiers) if (n >= at) t++;
    return t;
  },
  careerShipUnlockAt(id) {
    const cfg = (typeof SHIP_CONFIGS === "object" && SHIP_CONFIGS && SHIP_CONFIGS[id]) || null;
    if (cfg && Number.isFinite(cfg.unlock)) return cfg.unlock | 0;
    return CAREER.shipUnlocks[id] | 0;
  },
  careerShipUnlocked(id) { return this.careerClears() >= this.careerShipUnlockAt(id); },

  careerStore() {
    try { if (typeof storeSave === "function") storeSave(this.save); } catch (_) { /* storage may be unavailable */ }
  },

  // ------------------------- Run stamping -------------------------
  careerStampRun(run) {
    if (!run || run.mode !== "campaign") return run;
    const c = this.career();
    const pure = !!c.pure;
    run.pure = pure;
    run.loop = pure ? 0 : clamp(c.loop | 0, 0, this.careerLoopMax());
    run.boons = pure ? [] : c.boons.slice();
    return run;
  },

  // ------------------------- The clear -------------------------
  // Called from the victory path (20-run.js onLevelComplete when L >= 10) before the run is nulled.
  careerRecordClear(results, runArg) {
    const c = this.career();
    const run = runArg || this.run;
    const r = results || this.lastResults || {};
    const pure = !!(run && run.pure);
    const loop = run && !pure ? (run.loop | 0) : 0;
    const boons = run && !pure && Array.isArray(run.boons) ? run.boons.length : 0;
    const before = c.clears | 0;
    c.clears = before + 1;
    const entry = {
      n: c.clears, date: Date.now(), rank: r.rank || "C", ship: (run && run.shipId) || this.currentShipId(),
      loop, score: this.stats ? (this.stats.score | 0) : 0, wpm: r.wpm | 0, acc: Math.round(Number(r.acc) || 0), boons, pure
    };
    c.commendations.push(entry);
    if (c.commendations.length > 60) c.commendations.splice(0, c.commendations.length - 60);
    if (c.boons.length < CAREER_BOONS.length) c.picks = Math.min((c.picks | 0) + 1, CAREER_BOONS.length - c.boons.length);
    // the next loop opens; the selector follows the player up unless they pinned a lower one
    if (!c.pure && (c.loop | 0) === Math.min(before, CAREER.loopCap)) c.loop = this.careerLoopMax();
    const unlocked = Object.keys(CAREER.shipUnlocks).filter((id) => this.careerShipUnlockAt(id) === c.clears);
    const beamBefore = (() => { let t = 0; for (const at of CAREER.beamTiers) if (before >= at) t++; return t; })();
    const beamTier = this.careerBeamTier();
    this._careerLast = { entry, unlocked, beamUp: beamTier > beamBefore ? beamTier : 0, prestige: c.clears === CAREER.prestigeAt };
    this.careerStore();
    if (typeof this.hangarRefresh === "function") { try { this.hangarRefresh({ newlyUnlocked: unlocked }); } catch (_) { /* hangar is cosmetic */ } }   // 14-hangar.js unlocks the cards
    this.hook("careerClear", { n: c.clears, commendation: entry, unlocked, beamTier });
    return entry;
  },

  // ------------------------- Boon picks -------------------------
  careerRemainingBoons() {
    const have = new Set(this.career().boons);
    return CAREER_BOONS.filter((b) => !have.has(b.id));
  },
  careerOffers() {
    const rest = this.careerRemainingBoons();
    if (rest.length <= CAREER.offers) return rest;
    // deterministic per clear count so a reload offers the same three
    const seed = (this.careerClears() * 7919 + this.career().boons.length * 104729) >>> 0;
    const pool = rest.slice();
    const out = [];
    let x = seed || 1;
    while (out.length < CAREER.offers && pool.length) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      out.push(pool.splice(x % pool.length, 1)[0]);
    }
    return out;
  },
  careerPickBoon(id) {
    const c = this.career();
    if (!CAREER_BOON_BY_ID[id] || c.boons.includes(id) || (c.picks | 0) <= 0) return false;
    c.boons.push(id);
    c.picks = Math.max(0, (c.picks | 0) - 1);
    this.careerStore();
    this.hook("careerBoonPicked", { id });
    if (typeof this.showToast === "function") this.showToast(`BOON: ${CAREER_BOON_BY_ID[id].name.toUpperCase()}`, { kind: "success", key: "boon" });
    if (typeof this.announce === "function") this.announce(`Boon chosen: ${CAREER_BOON_BY_ID[id].name}. ${CAREER_BOON_BY_ID[id].desc}`);
    this.careerRenderStrip();
    this.careerRenderPanel();
    return true;
  },

  careerOpenPicks() {
    const modal = document.getElementById("boonModal");
    if (!modal) return false;
    const c = this.career();
    const list = modal.querySelector("#boonOffers");
    const title = modal.querySelector("#boonTitle");
    const body = modal.querySelector("#boonBody");
    const offers = (c.picks | 0) > 0 ? this.careerOffers() : [];
    if (title) title.textContent = (c.picks | 0) > 0 ? `COMMENDATION ${c.clears}: CHOOSE A BOON` : "BOONS";
    if (body) body.textContent = (c.picks | 0) > 0
      ? `${c.picks} pick${c.picks === 1 ? "" : "s"} waiting. A boon is permanent and rides every campaign run (never the Daily Sortie, Drill or Endless Drift; off under Pure).`
      : (c.boons.length >= CAREER_BOONS.length ? "Every boon is yours." : "No pick waiting. Clear sector 10 to earn the next one.");
    if (list) {
      list.innerHTML = "";
      for (const b of offers) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "boonCard";
        btn.dataset.boon = b.id;
        btn.innerHTML = `<span class="boonCard__glyph" aria-hidden="true">${b.glyph}</span><span class="boonCard__name">${b.name}</span><span class="boonCard__desc">${b.desc}</span>`;
        btn.addEventListener("click", () => { if (this.careerPickBoon(b.id)) { if ((this.career().picks | 0) > 0) this.careerOpenPicks(); else this.closeModal(modal); } });
        list.appendChild(btn);
      }
      for (const id of c.boons) {
        const b = CAREER_BOON_BY_ID[id]; if (!b) continue;
        const have = document.createElement("div");
        have.className = "boonCard is-owned";
        have.innerHTML = `<span class="boonCard__glyph" aria-hidden="true">${b.glyph}</span><span class="boonCard__name">${b.name}</span><span class="boonCard__desc">${b.desc}</span><span class="boonCard__tag">OWNED</span>`;
        list.appendChild(have);
      }
    }
    const first = list ? list.querySelector("button.boonCard") : null;
    this.openModal(modal, { primary: first || modal.querySelector("#btnBoonLater") });
    return true;
  },

  // ------------------------- Loop selection -------------------------
  careerSetLoop(n) {
    const c = this.career();
    const v = clamp(n | 0, 0, this.careerLoopMax());
    if (v === (c.loop | 0)) return;
    c.loop = v;
    this.careerStore();
    this.careerRenderStrip();
    if (typeof this.announce === "function") this.announce(v > 0 ? `Loop ${v} selected: plates ${Math.round(CAREER.speedPerLoop * v * 100)} percent faster, bosses ${v} segment${v === 1 ? "" : "s"} longer, score times ${(1 + CAREER.scorePerLoop * v).toFixed(1)}.` : "Loop 0 selected: the standard campaign.");
  },
  careerSetPure(on) {
    const c = this.career();
    c.pure = !!on;
    this.careerStore();
    this.careerRenderStrip();
    this.careerSyncSetting();
  },

  // ------------------------- Service record strip (title) -------------------------
  careerBadgeHtml(entry, dim) {
    const rank = entry && entry.rank ? String(entry.rank) : "C";
    const star = entry && entry.n === CAREER.prestigeAt;
    const label = `Commendation ${entry.n}: rank ${rank}, ${entry.loop > 0 ? `loop ${entry.loop}` : "loop 0"}${entry.pure ? ", pure" : ""}`;
    return `<span class="srBadge${dim ? " is-dim" : ""}${star ? " is-star" : ""}" data-rank="${rank}" title="${label}" aria-label="${label}">${star ? "★" : rank}</span>`;
  },

  careerRenderStrip() {
    const el = document.getElementById("serviceRecord");
    if (!el) return;
    this.careerBindStrip();
    this.careerBindPanel();
    const c = this.career();
    const clears = c.clears | 0;
    el.classList.toggle("hidden", clears <= 0);
    if (clears <= 0) return;
    const badges = el.querySelector("#srBadges");
    if (badges) {
      const list = c.commendations.slice(-20);
      badges.innerHTML = list.map((e, i) => this.careerBadgeHtml(e, i < list.length - 5)).join("") + (clears > list.length ? `<span class="srMore">+${clears - list.length}</span>` : "");
    }
    const loopWrap = el.querySelector("#srLoops");
    if (loopWrap) {
      const max = this.careerLoopMax();
      const cur = c.pure ? 0 : clamp(c.loop | 0, 0, max);
      let html = "";
      for (let i = 0; i <= max; i++) {
        html += `<button type="button" class="srLoop${i === cur ? " is-active" : ""}" role="radio" aria-checked="${i === cur}" data-loop="${i}" ${c.pure ? "disabled" : ""} title="${i === 0 ? "Standard campaign" : `Loop ${i}: plates +${Math.round(CAREER.speedPerLoop * i * 100)} % speed, boss +${i} segment${i === 1 ? "" : "s"}, score x${(1 + CAREER.scorePerLoop * i).toFixed(1)}`}">${i === 0 ? "LOOP 0" : `LOOP ${i}`}</button>`;
      }
      loopWrap.innerHTML = html;
    }
    const boons = el.querySelector("#srBoons");
    if (boons) {
      const chips = c.boons.map((id) => CAREER_BOON_BY_ID[id]).filter(Boolean)
        .map((b) => `<span class="srBoon" title="${b.name}: ${b.desc}"><span aria-hidden="true">${b.glyph}</span> ${b.name}</span>`).join("");
      const pick = (c.picks | 0) > 0 ? `<button type="button" id="btnBoonPick" class="srPick">CHOOSE BOON${c.picks > 1 ? ` (${c.picks})` : ""}</button>` : "";
      const pure = c.pure ? `<span class="srPure" title="Boons and loops are off: runs are tagged PURE">PURE</span>` : "";
      boons.innerHTML = chips + pick + pure;
      boons.classList.toggle("is-dim", !!c.pure);
    }
    const meta = el.querySelector("#srMeta");
    if (meta) {
      const tier = this.careerBeamTier();
      meta.textContent = `${clears} CLEAR${clears === 1 ? "" : "S"} · BEAM ${CAREER_BEAM_NAMES[tier].toUpperCase()}${clears >= CAREER.prestigeAt ? " · ELECTROMANCER'S SEAL" : ""}`;
    }
  },

  careerBindStrip() {
    const el = document.getElementById("serviceRecord");
    if (!el || el._careerBound) return;
    el._careerBound = true;
    el.addEventListener("click", (e) => {
      const loop = e.target.closest && e.target.closest(".srLoop");
      if (loop) { e.preventDefault(); this.uiTick && this.uiTick("confirm"); this.careerSetLoop(loop.dataset.loop | 0); return; }
      const pick = e.target.closest && e.target.closest("#btnBoonPick");
      if (pick) { e.preventDefault(); this.careerOpenPicks(); }
    });
    el.addEventListener("keydown", (e) => {
      const loop = e.target.closest && e.target.closest(".srLoop");
      if (!loop) return;
      const cur = loop.dataset.loop | 0;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const next = clamp(cur + (e.key === "ArrowRight" ? 1 : -1), 0, this.careerLoopMax());
        this.careerSetLoop(next);
        const btn = el.querySelector(`.srLoop[data-loop="${next}"]`);
        if (btn) btn.focus();
      }
    });
    const later = document.getElementById("btnBoonLater");
    const modal = document.getElementById("boonModal");
    if (later && modal && !later._careerBound) { later._careerBound = true; later.addEventListener("click", () => this.closeModal(modal)); }
    const careerSetting = document.getElementById("setCareer");
    if (careerSetting && !careerSetting._careerBound) {
      careerSetting._careerBound = true;
      careerSetting.addEventListener("change", () => this.careerSetPure(!careerSetting.checked));
    }
  },

  careerSyncSetting() {
    const careerSetting = document.getElementById("setCareer");
    if (careerSetting) careerSetting.checked = !this.careerPure();
  },

  // ------------------------- Victory panel -------------------------
  careerRenderPanel() {
    const panel = document.getElementById("careerPanel");
    if (!panel) return;
    const last = this._careerLast;
    const c = this.career();
    if (!last || !last.entry) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    const e = last.entry;
    const stamp = panel.querySelector("#careerStamp");
    if (stamp) stamp.textContent = `COMMENDATION ${e.n}`;
    const sub = panel.querySelector("#careerSub");
    if (sub) sub.textContent = e.pure ? "Pure run. Logged in the service record." : e.loop > 0 ? `Loop ${e.loop} cleared${e.boons ? ` with ${e.boons} boon${e.boons === 1 ? "" : "s"}` : ""}. Logged in the service record.` : "Logged in the service record.";
    const notes = panel.querySelector("#careerNotes");
    if (notes) {
      const lines = [];
      if (last.unlocked && last.unlocked.length) for (const id of last.unlocked) lines.push(`<li class="careerNote is-ship">NEW SHIP: ${CAREER_SHIP_NAMES[id] || id} is in the hangar</li>`);
      if (last.beamUp) lines.push(`<li class="careerNote is-beam">BEAM UPGRADED: ${CAREER_BEAM_NAMES[last.beamUp].toUpperCase()}</li>`);
      if (last.prestige) lines.push(`<li class="careerNote is-star">THE ELECTROMANCER'S SEAL: twenty clears</li>`);
      if (!e.pure && this.careerLoopMax() === e.loop + 1 && e.loop + 1 <= CAREER.loopCap) lines.push(`<li class="careerNote is-loop">LOOP ${e.loop + 1} UNLOCKED: faster plates, longer bosses, score x${(1 + CAREER.scorePerLoop * (e.loop + 1)).toFixed(1)}</li>`);
      notes.innerHTML = lines.join("");
      notes.classList.toggle("hidden", !lines.length);
    }
    const pickBtn = panel.querySelector("#btnCareerPick");
    if (pickBtn) {
      const pending = (c.picks | 0) > 0;
      pickBtn.classList.toggle("hidden", !pending);
      pickBtn.textContent = pending ? "Choose your boon" : "";
    }
    const picked = panel.querySelector("#careerPicked");
    if (picked) {
      const pending = (c.picks | 0) > 0;
      picked.classList.toggle("hidden", pending || !c.boons.length);
      if (!pending && c.boons.length) {
        const b = CAREER_BOON_BY_ID[c.boons[c.boons.length - 1]];
        picked.textContent = b ? `Boon chosen: ${b.name}. ${b.desc}` : "";
      }
    }
  },

  careerBindPanel() {
    const btn = document.getElementById("btnCareerPick");
    if (btn && !btn._careerBound) { btn._careerBound = true; btn.addEventListener("click", () => this.careerOpenPicks()); }
  },

  // ------------------------- Records: commendations table -------------------------
  careerRenderCommendations() {
    const host = document.getElementById("panelHall");
    if (!host) return;
    let box = document.getElementById("commendationsPanel");
    const c = this.career();
    if (!c.commendations.length) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement("section");
      box.id = "commendationsPanel";
      box.className = "commendations";
      box.setAttribute("aria-labelledby", "commendationsTitle");
      host.appendChild(box);
    }
    const rows = c.commendations.slice().reverse().slice(0, 20).map((e) => {
      const d = new Date(e.date);
      const date = e.date > 0 && Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "\u2014";   // backfilled clears carry no date
      const ship = (typeof getShipConfig === "function" ? getShipConfig(e.ship).name : e.ship) || "";
      return `<tr><td>${e.n}</td><td><span class="rankBadge" data-rank="${e.rank}">${e.rank}</span></td><td>${screensEscapeCareer(ship)}</td><td>${e.pure ? "PURE" : `LOOP ${e.loop | 0}`}</td><td>${formatInt(e.score | 0)}</td><td>${e.wpm | 0} / ${e.acc | 0}%</td><td>${date}</td></tr>`;
    }).join("");
    box.innerHTML = `<h3 id="commendationsTitle" class="label">Commendations · ${c.clears} clear${c.clears === 1 ? "" : "s"}</h3>
      <table class="hsTable commendationsTable"><thead><tr><th scope="col">#</th><th scope="col">Rank</th><th scope="col">Ship</th><th scope="col">Run</th><th scope="col">Score</th><th scope="col">WPM / Acc</th><th scope="col">Date</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  // ------------------------- Boon effects -------------------------
  careerSectorStart() {
    this._careerSector = { absorbUsed: false, freeRelease: true };
    if (this.careerBoonActive("shieldStart") && this.player) {
      this.player.shield = Math.max(this.player.shield || 0, CAREER.shieldStartS);
      if (typeof this.syncChips === "function") this.syncChips();
    }
  },

  careerDamageWillApply(ev) {
    if (!ev || ev.cancel || ev.source !== "leak") return;
    if (!this.careerBoonActive("absorb")) return;
    const st = this._careerSector || (this._careerSector = { absorbUsed: false, freeRelease: true });
    if (st.absorbUsed) return;
    st.absorbUsed = true;
    ev.cancel = true;
    if (this.player && typeof this.addFloater === "function") this.addFloater(this.player.x + 40, this.player.y - 56, "ABSORBED", "violet", 18);
    if (this.sfx && typeof this.sfx.shieldHit === "function") this.sfx.shieldHit();
    if (this.player) { this.player.shieldFlash = 1; this.invulnT = Math.max(this.invulnT || 0, 0.6); }
  }
});

function screensEscapeCareer(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// ------------------------- Wrappers over the owners -------------------------
(function wrapCareer() {
  const P = Game.prototype;

  // run record: stamp loop / boons / pure
  const newRunRecord = P.newRunRecord;
  if (typeof newRunRecord === "function") {
    P.newRunRecord = function (levelIndex, startLevel) {
      const run = newRunRecord.call(this, levelIndex, startLevel);
      return typeof this.careerStampRun === "function" ? this.careerStampRun(run) : run;
    };
  }

  // the clear: record the commendation before the victory path nulls the run
  const onLevelComplete = P.onLevelComplete;
  const commitLevelClear = P.commitLevelClear;
  if (typeof commitLevelClear === "function") {
    P.commitLevelClear = function (info) {
      const i = info && Number.isFinite(info.levelIndex) ? info.levelIndex | 0 : this.levelIndex | 0;
      const L = (info && info.level) || (LEVELS[clamp(i, 0, 9)] && LEVELS[clamp(i, 0, 9)].level) || i + 1;
      const campaign = !(typeof this.modesActive === "function" && this.modesActive()) && this.run && this.run.mode === "campaign";
      if (L >= 10 && campaign && typeof this.careerRecordClear === "function" && !(this._careerCommitted && this._careerCommitted === this.run.id)) {
        // results exist only after commitLevelClear, which also nulls the run on a victory: keep the record for the entry
        const run = this.run;
        const out = commitLevelClear.call(this, info);
        this._careerCommitted = run.id;
        this.careerRecordClear(this.lastResults, run);
        return out;
      }
      return commitLevelClear.call(this, info);
    };
  }
  void onLevelComplete;

  // victory screen: the commendation panel follows the results reveal
  const finishEndingDialogue = P.finishEndingDialogue;
  if (typeof finishEndingDialogue === "function") {
    P.finishEndingDialogue = function () {
      finishEndingDialogue.call(this);
      if (typeof this.careerRenderPanel === "function") this.careerRenderPanel();
    };
  }
  const resetEndingDialogue = P.resetEndingDialogue;
  if (typeof resetEndingDialogue === "function") {
    P.resetEndingDialogue = function () {
      resetEndingDialogue.call(this);
      const panel = document.getElementById("careerPanel");
      if (panel) panel.classList.add("hidden");
    };
  }

  // loop score: +10 % per loop on every point of a loop run
  onGameHook("scoreWillAdd", function (se) {
    const loop = typeof this.careerLoopActive === "function" ? this.careerLoopActive() : 0;
    if (loop > 0 && se && !se.cancel) se.mul = (se.mul > 0 ? se.mul : 1) * (1 + CAREER.scorePerLoop * loop);
  });

  // loop plates: +6 % speed per loop (the pacing tuning is computed once per wave)
  if (typeof paceApplyTuning === "function") {
    const orig = paceApplyTuning;
    paceApplyTuning = function (t, cfg, wave, mul, carry) {
      const r = orig(t, cfg, wave, mul, carry);
      const g = (typeof window !== "undefined" && window.game) || null;
      const loop = g && typeof g.careerLoopActive === "function" ? g.careerLoopActive() : 0;
      if (loop > 0 && r) r.speedMul = (r.speedMul || 1) * (1 + CAREER.speedPerLoop * loop);
      return r;
    };
  }

  // loop bosses: one more segment per loop (the longest segments repeat at the end; phases keep their starts)
  if (typeof buildBossPlan === "function") {
    const orig = buildBossPlan;
    buildBossPlan = function (level) {
      const plan = orig(level);
      const g = (typeof window !== "undefined" && window.game) || null;
      const loop = g && typeof g.careerLoopActive === "function" ? g.careerLoopActive() : 0;
      if (loop > 0 && plan && Array.isArray(plan.segments) && plan.segments.length) {
        const extra = Math.min(CAREER.bossSegmentsPerLoop * loop, plan.segments.length);
        const byLen = plan.segments.slice().sort((a, b) => b.length - a.length);
        for (let i = 0; i < extra; i++) plan.segments.push(byLen[i % byLen.length]);
      }
      return plan;
    };
  }

  // boons
  onGameHook("sectorStart", function () { if (typeof this.careerSectorStart === "function") this.careerSectorStart(); });
  onGameHook("waveWillStart", function () { if (this._careerSector) this._careerSector.freeRelease = true; });
  onGameHook("damageWillApply", function (ev) { if (typeof this.careerDamageWillApply === "function") this.careerDamageWillApply(ev); });

  const collectPowerup = P.collectPowerup;
  if (typeof collectPowerup === "function") {
    P.collectPowerup = function (p) {
      const type = p && p.type;
      const hpBefore = this.player ? this.player.hp : 0;
      const out = collectPowerup.call(this, p);
      if (!type || typeof this.careerBoonActive !== "function") return out;
      const def = (typeof POWERUP_TYPES === "object" && POWERUP_TYPES[type]) || null;
      if (def && this.careerBoonActive("longBurn")) {
        const extra = (def.duration || 0) * (CAREER.longBurnMul - 1);
        if (type === "SPREAD" || type === "PIERCE" || type === "RAPID") { const k = def.powerKey; if (k && this.power) this.power[k] = Math.max(this.power[k] || 0, def.duration * CAREER.longBurnMul); }
        else if (type === "MULTI" && this.power) this.power.multiplier = Math.max(this.power.multiplier || 0, def.duration * CAREER.longBurnMul);
        else if (type === "SHIELD" && this.player) this.player.shield = Math.min((typeof DAMAGE === "object" && DAMAGE.shieldCap) || 99, (this.player.shield || 0) + extra);
        if (typeof this.syncChips === "function") this.syncChips();
      }
      if (type === "REPAIR" && this.careerBoonActive("fieldRepair") && this.player && typeof this.healPlayer === "function") {
        const healed = Math.max(0, this.player.hp - hpBefore);
        const more = Math.round(healed * (CAREER.fieldRepairMul - 1));
        if (more > 0) this.healPlayer(more);
      }
      return out;
    };
  }

  const releaseLock = P.releaseLock;
  if (typeof releaseLock === "function") {
    P.releaseLock = function (reason = "manual") {
      const ref = this.lock && this.lock.ref;
      const keep = reason === "manual" && ref && typeof this.careerBoonActive === "function" && this.careerBoonActive("safeRelease") && this._careerSector && this._careerSector.freeRelease;
      const progress = keep ? ref.progress | 0 : 0;
      releaseLock.call(this, reason);
      if (keep && progress > 0 && ref && ref.alive !== false) {
        ref.progress = progress;
        this._careerSector.freeRelease = false;
        if (typeof this.addFloater === "function") this.addFloater(ref.x, ref.y - 48, "SAFE RELEASE", "violet", 14);
      }
    };
  }

  const applySpread = P.applySpread;
  if (typeof applySpread === "function") {
    P.applySpread = function (en) {
      if (!(typeof this.careerBoonActive === "function" && this.careerBoonActive("wideSpread")) || typeof POWERUP_TYPES !== "object" || !POWERUP_TYPES.SPREAD) return applySpread.call(this, en);
      const r = (POWERUP_TYPES.SPREAD.radius || 160) * CAREER.wideSpreadMul;
      const victims = [];
      for (const o of this.enemies) {
        if (o === en || !o.alive || o.dying || o.kind === "bossMinion") continue;
        if (Math.hypot(o.x - en.x, o.y - en.y) <= r) victims.push(o);
      }
      if (typeof this.addShockwave === "function") this.addShockwave(en.x, en.y, r, "magenta");
      else this.addExplosion(en.x, en.y, 40);
      for (const o of victims) this.killEnemy(o, { secondary: true });
      return victims;
    };
  }

  const odTick = P.odTick;
  if (typeof odTick === "function") {
    P.odTick = function (dt) {
      const S = this._od;
      const before = S && !S.on ? S.charge : null;
      const out = odTick.call(this, dt);
      if (before != null && S && !S.on && S.charge > before && typeof this.careerBoonActive === "function" && this.careerBoonActive("hotEngine")) {
        S.charge = clamp(S.charge + (S.charge - before) * (CAREER.hotEngineMul - 1), 0, 1);
        if (S.charge >= 1 && typeof this.odActivate === "function") this.odActivate();
      }
      return out;
    };
  }

  // results / records tags
  onGameHook("results", function (ev) {
    const r = ev && ev.results;
    if (!r || !this.run || this.run.mode !== "campaign") return;
    if (!Array.isArray(r.tags)) r.tags = [];
    if (this.run.pure && this.careerClears() > 0 && !r.tags.includes("PURE")) r.tags.push("PURE");
    const loop = this.run.pure ? 0 : (this.run.loop | 0);
    if (loop > 0 && !r.tags.some((t) => /^LOOP /.test(t))) r.tags.push(`LOOP ${loop}`);
    if (!this.run.pure && Array.isArray(this.run.boons) && this.run.boons.length && !r.tags.includes("BOONS")) r.tags.push("BOONS");
  });
  onGameHook("recordWillSave", function (ev) {
    const row = ev && ev.row;
    const run = this.run || (this.save && this.save.run) || null;
    if (!row || !run || run.mode !== "campaign") return;
    if (!Array.isArray(row.tags)) row.tags = [];
    if (run.pure && this.careerClears() > 0) row.tags.push("PURE");
    else if ((run.loop | 0) > 0) row.tags.push(`LOOP ${run.loop | 0}`);
    row.loop = run.pure ? 0 : (run.loop | 0);
  });

  // surfaces: the title cabinet render (boot and every menu refresh) carries the strip; the victory screen the panel
  const renderMenuScreens = P.renderMenuScreens;
  if (typeof renderMenuScreens === "function") {
    P.renderMenuScreens = function () {
      const out = renderMenuScreens.apply(this, arguments);
      if (typeof this.careerRenderStrip === "function") { this.careerRenderStrip(); this.careerSyncSetting(); }
      return out;
    };
  }
  onGameHook("modeChange", function (ev) {
    if (!ev) return;
    if (ev.to === "menu") { this.careerRenderStrip(); this.careerSyncSetting(); }
    if (ev.to === "victory") { this.careerBindPanel(); }
  });
  onGameHook("recordsOpen", function () { if (typeof this.careerRenderCommendations === "function") this.careerRenderCommendations(); });
  const applySettings = P.applySettings;
  if (typeof applySettings === "function") {
    P.applySettings = function () {
      const out = applySettings.apply(this, arguments);
      if (typeof this.careerSyncSetting === "function") this.careerSyncSetting();
      return out;
    };
  }
})();
