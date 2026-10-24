// Helpers for the MODES probes (t-modes-*.mjs): fixtures, mode starts, waits, the isolation snapshot and a controlled
// typist (frozen spawner, scripted static plates, game.handleTyped on a performance.now() schedule). Builds on
// _lib.mjs / b_lib.mjs. WORDS / PACE / ARCADE are feature-detected by the probes themselves.
import { openProbe, sleep, LS_KEY, harnessFlags } from "./_lib.mjs";
import { typeFor, waitFor, state } from "./b_lib.mjs";
export { openProbe, sleep, LS_KEY, harnessFlags, typeFor, waitFor, state };

const RUN3 = { levelIndex: 2, levelT: 40, inBoss: false, hp: 260, maxHp: 400, shield: 0, power: { spread: 0, pierce: 0, rapid: 0, multiplier: 0 },
  stats: { score: 6000, combo: 4, mult: 1, correct: 300, total: 320 }, shipId: "coconut", spawnAcc: 0.3, powerAcc: 2 };

// F5: five sectors unlocked, sector bests 1-4, a headline and a records row, bestWpm 40, a campaign run on sector 3 (6000).
export function F5(extra = {}) {
  const best = (score) => ({ score, rank: "A", wpm: 30, acc: 96, maxCombo: 20, date: 1 });
  return {
    schema: 3, playerName: "MODES", selectedShip: "coconut", highScore: 5000, lastUnlockedLevel: 5, storySeen: true, keyboardHintSeen: true,
    onboardingDone: 1, legacySeeded: true, victories: 0, bestWpm: 40, settings: { muted: true, crt: true },
    tutorialSeen: { lock: true, finish: true, powerup: true, boss: true, release: true, accuracy: true },
    highScores: [{ runId: "r1", name: "MODES", score: 5000, levelReached: 5, startLevel: 1, wpm: 40, acc: 95, maxCombo: 20, ship: "coconut", difficulty: "standard", date: 1, wpmLegacy: false }],
    sectorBests: { 1: best(3000), 2: best(3500), 3: best(4000), 4: best(4500) },
    run: JSON.parse(JSON.stringify(RUN3)), ...extra
  };
}

// F5P: F5 + a MEASURE profile (speedEma 60 over 400 intervals; k and p weak at 30 % misses, others 2 %).
export function F5P(extra = {}) {
  const keys = {};
  for (const ch of "abcdefghijklmnopqrstuvwxyz") keys[ch] = { n: 40, err: (ch === "k" || ch === "p") ? 0.3 : 0.02, ms: 200 };
  return F5({ profile: { v: 1, keys, bigrams: {}, speedEma: 60, thrEma: 50, speedN: 400, sessions: [], sectorBest: {}, bests: { speed: 50, ceiling: 0, drill: { speed: 0, acc: 0 } }, days: { n: 0, last: 0 } }, ...extra });
}

// Local-time ms epoch of a calendar moment, computed in the page (same zone as the game).
export async function localMs(P, y, mo, d, h = 12, mi = 0, s = 0) {
  return P.g(([y, mo, d, h, mi, s]) => new Date(y, mo - 1, d, h, mi, s).getTime(), [y, mo, d, h, mi, s]);
}

export async function setNow(P, ms) {
  await P.g((v) => { window.game.modesDebug().setNow(v); window.game.refreshMenu(); }, ms);
}

// beginModeRun (the synchronous entry) and wait until the sector card is over and the first wave started.
export async function startMode(P, mode, { waitGo = true } = {}) {
  const ok = await P.g((m) => window.game.beginModeRun(m), mode);
  if (ok && waitGo) await waitFor(P, () => { const g = window.game; return g.mode === "playing" && !g.levelIntro && g.wavePhase === "spawn"; }, 15000);
  return ok;
}

export async function waitMode(P, mode, ms = 5000) {
  return waitFor(P, (m) => window.game.mode === m, ms, mode);
}

// Fields D9 isolates, from the stored blob and from memory.
export async function isolation(P) {
  return P.g((k) => {
    const pick = (s) => s ? JSON.stringify({ run: s.run, highScore: s.highScore, highScores: s.highScores, sectorBests: s.sectorBests, lastUnlockedLevel: s.lastUnlockedLevel,
      victories: s.victories, bestWpm: s.bestWpm, profileSectorBest: (s.profile && s.profile.sectorBest) || {}, profileBestSpeed: (s.profile && s.profile.bests && s.profile.bests.speed) | 0 }) : null;
    let blob = null;
    try { blob = JSON.parse(localStorage.getItem(k)); } catch (_) { blob = null; }
    const g = window.game;
    return { blob: pick(blob), mem: pick(g.save), deaths: JSON.stringify(g.deathsBySector || {}) };
  }, LS_KEY);
}

// The mode results card as text.
export async function card(P) {
  return P.g(() => {
    const c = document.getElementById("resultsMode");
    const t = (sel) => { const el = c.querySelector(sel); return el ? el.textContent.trim() : null; };
    return {
      mode: window.game.mode, eyebrow: document.getElementById("modeResultsEyebrow").textContent, title: document.getElementById("modeResultsTitle").textContent,
      text: document.getElementById("modeResultsText").textContent, head: t(".resultsTitle"), sub: t(".resultsHead .resultsSub"), badge: t(".medalBadge"),
      medal: c.querySelector(".medalBadge").dataset.medal, badgeShown: getComputedStyle(c.querySelector(".medalBadge")).display !== "none",
      labels: [...c.querySelectorAll(".statTile__label")].map((e) => e.textContent.trim().toUpperCase()), values: [...c.querySelectorAll(".statTile__value")].map((e) => e.textContent.trim()),
      lines: [...c.querySelectorAll(".modeLines li")].map((e) => e.textContent), share: document.getElementById("modeShareText").value,
      shareShown: !c.querySelector(".shareRow").classList.contains("hidden"), again: document.getElementById("btnModeAgain").textContent,
      focus: document.activeElement && document.activeElement.id, said: document.getElementById("srAnnounce").textContent,
      result: window.game._modes && window.game._modes.result
    };
  });
}

// Installs window.__mt: hold() freezes the spawner, plate() places a static plate, run(steps) types on a schedule.
export async function installTypist(P) {
  await P.g(() => {
    if (window.__mt) return;
    const T = window.__mt = {};
    T.hold = () => { const g = window.game; g.spawnAcc = -1e9; g.hungryT = -1e9; g.powerAcc = -1e9; };
    T.clear = () => { const g = window.game; g.enemies.length = 0; g.powerups.length = 0; g.lock = null; g.lockMisses = 0; };
    T.plate = (text, lane = 2, x = null) => {
      const g = window.game;
      const ys = g.laneYs();
      const en = new Enemy({ text, x: x == null ? g.w - 300 : x, y: ys[Math.min(lane, ys.length - 1)], speed: 0, lane });
      g.enemies.push(en);
      return en;
    };
    T.run = (steps) => new Promise((resolve) => {
      let i = 0;
      const t0 = performance.now();
      const next = () => {
        while (i < steps.length) {
          const s = steps[i];
          const wait = t0 + s.at - performance.now();
          if (wait > 0.5) { setTimeout(next, wait); return; }
          i++;
          try {
            if (s.hold) T.hold();
            else if (s.plate) T.plate(s.plate, s.lane == null ? 2 : s.lane);
            else if (s.ch) window.game.handleTyped(s.ch);
          } catch (e) { console.error("__mt.run", e); }
        }
        resolve(true);
      };
      next();
    });
  });
}

// Steps typing each word as a static plate at msPerKey; missOn: a wrong key lands before that letter (the correct key
// still comes msPerKey after the previous correct one, so the interval holds the miss).
export function wordSteps(words, msPerKey = 200, { missOn = "", start = 60 } = {}) {
  const steps = [];
  let t = start;
  for (const w of words) {
    steps.push({ at: t - 30, hold: true });
    steps.push({ at: t - 20, plate: w });
    for (let k = 0; k < w.length; k++) {
      if (k > 0 && missOn.includes(w[k])) steps.push({ at: t - msPerKey / 2, ch: w[k] === "q" ? "z" : "q" });
      steps.push({ at: t, ch: w[k] });
      t += msPerKey;
    }
    t += msPerKey;
  }
  return steps;
}

export async function typeWords(P, words, msPerKey = 200, opts = {}) {
  await installTypist(P);
  await P.g(() => { window.__mt.clear(); window.__mt.hold(); });
  return P.page.evaluate((s) => window.__mt.run(s), wordSteps(words, msPerKey, opts));
}

// Every probe ends with this: no page errors, no console errors.
export function checkErrors(P, label = "zero page errors and zero console errors") {
  P.check(label, P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, { pageErrors: P.errors.pageErrors.slice(0, 3), consoleErrors: P.errors.consoleErrors.slice(0, 3) });
}
