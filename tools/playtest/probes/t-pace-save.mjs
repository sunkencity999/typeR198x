// t-pace-save (PACE, run.pace; CONTRACT 3.1 / 3.3, spec-pace 9): the stored state has exactly the section-9 keys and
// types and stays under 400 B even fully populated; a hand-edited garbage blob loads normalised with no error; PACE adds
// no storage write while typing (setItem count over 10 s of 80 WPM play stays at the autosave cadence); the file passes
// node --check and check-globals. ~40 s. PASS = run.pace is small, safe and written only at the existing save points.
// Usage: node tools/playtest/probes/t-pace-save.mjs
import { execFileSync } from "node:child_process";
import path from "node:path";
import { openProbe, sleep, waitFor, startFresh, continueRun, paceType, errorsCheck } from "./pace_lib.mjs";
import { ROOT, FIXTURES } from "./_lib.mjs";

const P = await openProbe("t-pace-save");
await P.context.addInitScript(() => {
  window.__setItems = [];
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { try { window.__setItems.push({ k, t: performance.now(), n: String(v).length }); } catch (_) {} return orig.apply(this, arguments); };
});
await startFresh(P, "SAVE");

// ---- 1. shape and size ----
await sleep(1700);   // past one autosave
const shape = await P.g(() => {
  const g = window.game;
  g.saveRun(true);
  const blob = JSON.parse(localStorage.getItem(LS_KEY));
  const ps = blob.run && blob.run.pace;
  const isInt = (v) => Number.isInteger(v);
  const keys = ps ? Object.keys(ps).sort() : [];
  const types = ps && {
    v: ps.v === 1, mul: typeof ps.mul === "number", cpMul: typeof ps.cpMul === "number",
    applied: ps.applied === null || (isInt(ps.applied.level) && isInt(ps.applied.wave) && typeof ps.applied.mul === "number" && isInt(ps.applied.quota) && Object.keys(ps.applied).length === 4),
    carry: isInt(ps.carry), carryTo: ps.carryTo === null || (isInt(ps.carryTo.level) && isInt(ps.carryTo.wave)),
    waveMuls: Array.isArray(ps.waveMuls) && ps.waveMuls.length <= 3 && ps.waveMuls.every((m) => typeof m === "number"),
    cadetLevel: isInt(ps.cadetLevel), usedCadet: typeof ps.usedCadet === "boolean",
    deaths: !!ps.deaths && isInt(ps.deaths.level) && isInt(ps.deaths.n) && Object.keys(ps.deaths).length === 2,
    hullNote: ps.hullNote === null || (isInt(ps.hullNote.level) && isInt(ps.hullNote.pct) && isInt(ps.hullNote.rep) && typeof ps.hullNote.shown === "boolean")
  };
  // fully populated worst case (every field at its widest)
  const worst = { v: 1, mul: 2.35, cpMul: 2.15, applied: { level: 10, wave: 2, mul: 2.35, quota: 1999 }, carry: 999, carryTo: { level: 10, wave: 2 }, waveMuls: [2.15, 2.35, 2.45],
    cadetLevel: 10, usedCadet: true, deaths: { level: 10, n: 9999 }, hullNote: { level: 10, pct: 100, rep: 100, shown: false } };
  const worstNorm = paceNormalizeState(worst);
  return { keys, types, len: ps ? JSON.stringify(ps).length : -1, worstLen: JSON.stringify(worstNorm).length, worstSame: JSON.stringify(worstNorm) === JSON.stringify(worst) };
});
const WANT_KEYS = ["applied", "cadetLevel", "carry", "carryTo", "cpMul", "deaths", "hullNote", "mul", "usedCadet", "v", "waveMuls"];
P.check("1. after a wave start save.run.pace has exactly the section-9 keys with their types; JSON < 400 B (live) and a fully populated state round-trips the normaliser at < 400 B",
  JSON.stringify(shape.keys) === JSON.stringify(WANT_KEYS) && shape.types && Object.values(shape.types).every(Boolean) && shape.len > 0 && shape.len < 400 && shape.worstLen < 400 && shape.worstSame, shape);

// ---- 3. no extra writes while typing ----
await P.g(() => { window.__setItems.length = 0; });
const t0 = Date.now();
await paceType(P, 10, { wpm: 80, accuracy: 0.97 });
const writes = await P.g((k) => window.__setItems.filter((w) => w.k === k).length, "typesmup198x.save.v1");
P.check("3. 10 s of 80 WPM typing: <= 10 save writes (1.5 s autosave plus wave boundaries; PACE adds none)", writes <= 10, { writes, seconds: Math.round((Date.now() - t0) / 100) / 10 });

// ---- 2. garbage ----
const garbage = JSON.parse(JSON.stringify(FIXTURES["legacy-midwave"]));
garbage.run.pace = { mul: "x", deaths: 5, applied: [], waveMuls: "no", hullNote: { level: 99 }, carryTo: 7, cadetLevel: -3, usedCadet: "yes", v: 9 };
await P.goto(garbage);
await continueRun(P);
await waitFor(P, () => !window.game.levelIntro, 6000);
await sleep(300);
const g2 = await P.g(() => { const g = window.game; const s = g.paceSnapshot(); return { state: s.state, quota: g.waveQuota(), table: LEVELS[g.levelIndex].quota[g.wave], level: g.levelIndex + 1 }; });
P.check("2. a hand-edited run.pace ({mul: 'x', deaths: 5, applied: [], ...}) loads normalised: mul 1, deaths n 0, the rest fresh, applied set by the first wave, no page error",
  g2.level === 3 && g2.state && g2.state.mul === 1 && g2.state.v === 1 && g2.state.cadetLevel === 0 && g2.state.usedCadet === false && g2.state.hullNote === null && g2.state.carryTo === null &&
  g2.state.deaths.n === 0 && g2.state.applied && g2.state.applied.level === 3 && g2.quota === g2.table && P.errors.pageErrors.length === 0, g2);

// ---- 4. syntax / globals ----
let syntax = "", globals = "", okSyntax = false, okGlobals = false;
try { execFileSync(process.execPath, ["--check", path.join(ROOT, "assets/js/game/42-pacing.js")], { stdio: "pipe" }); okSyntax = true; syntax = "ok"; } catch (e) { syntax = String(e.stderr || e.message).slice(0, 300); }
try { globals = execFileSync("bash", [path.join(ROOT, "tools/check-globals.sh")], { stdio: "pipe", cwd: ROOT }).toString().trim(); okGlobals = true; } catch (e) { globals = String(e.stdout || e.message).slice(0, 300); }
P.check("4. node --check assets/js/game/42-pacing.js and tools/check-globals.sh clean", okSyntax && okGlobals, { syntax, globals });

errorsCheck(P);
await P.finish();
