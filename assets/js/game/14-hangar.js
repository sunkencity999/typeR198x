// Type-R 198X — HANGAR (14-hangar.js): the ship cards' lock state for the Career unlocks.
// Methods are mixed into Game.prototype; load order is defined in index.html (right after 12-access.js, before
// 15-screens.js). This file only reads: the Career module (56-career.js) owns save.career and calls hangarRefresh()
// after it records a clear; 40-save.js is untouched.
//
//   data      <label class="shipCard" data-ship-unlock="N"> in the hangar fieldset (index.html): N campaign clears
//             open the hull (SHIP_CONFIGS[id].unlock carries the same number, 0 for the four original hulls).
//             save.career.clears is the pilot's clear count (0 when the career block is absent).
//   hangarRefresh({ newlyUnlocked: [ids] })
//             toggles .is-locked and the radio's disabled attribute on every [data-ship-unlock] card whose unlock
//             exceeds the clears (a disabled radio leaves the tab order and the group's arrow cycle, and its label
//             click does nothing), sets .is-new on the cards named in newlyUnlocked (a ring + NEW pill until the
//             next refresh), and when the saved selectedShip is locked falls back to coconut (save, radios and the
//             title ship). Runs once at boot after hydrateShipCards (finishLoading covers the Continue / watchdog
//             path) and on every modeChange to "menu". Returns { clears, locked, unlocked, fallback }.
//   hangarClears() / hangarShipLocked(id)   readers for probes and other modules.
//
// Probe: tools/playtest/probes/t-hangar.mjs.

const HANGAR_FALLBACK_SHIP = "coconut";

Object.assign(Game.prototype, {
  hangarClears() {
    const career = this.save && this.save.career;
    const n = career && Number(career.clears);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  },

  hangarUnlockFor(id) {
    const card = document.querySelector(`.shipCard[data-ship-unlock] input[name='shipChoice'][value='${id}']`);
    const fromCard = card && card.closest(".shipCard");
    if (fromCard) {
      const n = Number(fromCard.dataset.shipUnlock);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const cfg = typeof SHIP_CONFIGS !== "undefined" && SHIP_CONFIGS ? SHIP_CONFIGS[id] : null;
    const n = cfg ? Number(cfg.unlock) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  },

  hangarShipLocked(id) {
    return this.hangarUnlockFor(id) > this.hangarClears();
  },

  hangarRefresh(opts) {
    const o = opts || {};
    const fresh = new Set(Array.isArray(o.newlyUnlocked) ? o.newlyUnlocked : []);
    const clears = this.hangarClears();
    const locked = [];
    const unlocked = [];
    const cards = document.querySelectorAll(".shipCard[data-ship-unlock]");
    for (const card of cards) {
      const input = card.querySelector("input[name='shipChoice']");
      const id = input ? input.value : "";
      const need = Number(card.dataset.shipUnlock) || 0;
      const isLocked = need > clears;
      card.classList.toggle("is-locked", isLocked);
      card.classList.toggle("is-new", !isLocked && fresh.has(id));
      if (input) {
        input.disabled = isLocked;
        if (isLocked) {
          input.setAttribute("aria-disabled", "true");
          if (input.checked) input.checked = false;
        } else {
          input.removeAttribute("aria-disabled");
        }
      }
      (isLocked ? locked : unlocked).push(id);
    }
    // A locked selection (an edited save, a card re-locked by a reset) falls back to the Coconut.
    let fallback = false;
    const selected = this.save ? this.save.selectedShip : null;
    if (selected && locked.includes(selected)) {
      fallback = true;
      this.save.selectedShip = HANGAR_FALLBACK_SHIP;
      if (typeof storeSave === "function") storeSave(this.save);
      if (Array.isArray(this.shipInputs)) this.shipInputs.forEach((input) => { input.checked = input.value === HANGAR_FALLBACK_SHIP; });
      if (this.player && !this.run && typeof this.setPlayerShip === "function") this.setPlayerShip(HANGAR_FALLBACK_SHIP);   // the title ship; a live run keeps its hull
    }
    this._hangarBooted = true;
    this._hangar = { clears, locked, unlocked, fallback, refreshes: ((this._hangar && this._hangar.refreshes) || 0) + 1 };
    return { clears, locked, unlocked, fallback };
  }
});

// Boot: after the cards hydrate (onAssetsReady) and, when Continue / the watchdog dismissed the overlay first, at
// finishLoading. Later: every return to the title.
(() => {
  const hydrate = Game.prototype.hydrateShipCards;
  if (typeof hydrate === "function") {
    Game.prototype.hydrateShipCards = function () {
      const r = hydrate.apply(this, arguments);
      try { this.hangarRefresh(); } catch (e) { console.warn("[TypeR] hangarRefresh at boot failed", e); }
      return r;
    };
  }
  const finish = Game.prototype.finishLoading;
  if (typeof finish === "function") {
    Game.prototype.finishLoading = function () {
      if (!this._hangarBooted) { try { this.hangarRefresh(); } catch (e) { console.warn("[TypeR] hangarRefresh at finishLoading failed", e); } }
      return finish.apply(this, arguments);
    };
  }
  onGameHook("modeChange", function (evt) { if (evt && evt.to === "menu" && this && typeof this.hangarRefresh === "function") this.hangarRefresh(); });
})();
