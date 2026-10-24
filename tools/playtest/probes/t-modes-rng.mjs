// t-modes-rng (MODES, D9): the seeded Daily Sortie. Test vectors of the pure helpers, the sector pick over 2026, gameplay
// picks routed through game._rng in a daily run and never in a campaign run, reproducible wave openings on the same date,
// state cleared on quit. PASS = the seed works as documented. Usage: node tools/playtest/probes/t-modes-rng.mjs
import { openProbe, sleep, F5, localMs, setNow, startMode, waitFor, checkErrors } from "./modes_lib.mjs";

const P = await openProbe("t-modes-rng");
await P.goto(F5());
await sleep(300);

// R1 / R2 / R3: pure vectors.
const v = await P.g(() => {
  const r = modesMulberry32(20261023);
  const three = [r(), r(), r()];
  const counts = { 3: 0, 4: 0, 5: 0 };
  let days = 0;
  for (let d = new Date(2026, 0, 1, 12); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) { counts[modesDailySectorFor(modesDateKey(d), 5)]++; days++; }
  return { three, hash: modesHash32(20261023), wave0: modesWaveSeed(20261023, 0), sectors: [5, 10, 4, 2, 1].map((U) => modesDailySectorFor(20261023, U)), counts, days,
    iso: modesIsoDate(20261023), short: modesShortDate(20261023), plus: modesAddDays(20261231, 1), minus: modesAddDays(20260301, -1) };
});
const near = (a, b) => Math.abs(a - b) < 1e-9;
P.check("R1 modesMulberry32(20261023) -> 0.1199604138 / 0.8116779858 / 0.9474854597 (+-1e-9)",
  near(v.three[0], 0.1199604138) && near(v.three[1], 0.8116779858) && near(v.three[2], 0.9474854597), v.three);
P.check("R2 modesHash32(20261023) === 2432605180, modesWaveSeed(20261023, 0) === 852611406; date helpers (iso, short, day arithmetic)",
  v.hash === 2432605180 && v.wave0 === 852611406 && v.iso === "2026-10-23" && v.short === "FRI 23 OCT" && v.plus === 20270101 && v.minus === 20260228, v);
P.check("R3 modesDailySectorFor(20261023, U): U5 5, U10 10, U4 4, U2 2, U1 1; over the 365 days of 2026 with U5 each of 3 / 4 / 5 >= 25 %",
  v.sectors.join() === "5,10,4,2,1" && v.days === 365 && [3, 4, 5].every((s) => v.counts[s] / v.days >= 0.25), { sectors: v.sectors, counts: v.counts });

// R4: in a daily run every gameplay pick goes through game._rng.
await setNow(P, await localMs(P, 2026, 10, 23));
await startMode(P, "daily");
const r4 = await P.g(() => {
  const g = window.game;
  const keep = g._rng;
  const seeded = typeof keep === "function";
  g._rng = () => 0;
  const cfg = LEVELS[g.levelIndex];
  const out = [];
  for (let i = 0; i < 20; i++) out.push(g.makeEnemyText(cfg, g.wave, null));
  const first = letterSetForWave(cfg, g.wave)[0];
  g._rng = keep;
  return { seeded, mode: g.runMode(), texts: out, first, words: typeof COMMON_WORDS !== "undefined" };
});
P.check("R4 daily run: game._rng is the run's closure; with _rng = () => 0, 20 x makeEnemyText are identical" + (r4.words ? " (WORDS picker)" : " (= the first letter of the wave set)"),
  r4.seeded && r4.mode === "daily" && r4.texts.every((t) => t === r4.texts[0]) && (r4.words || r4.texts[0] === r4.first), { texts: r4.texts.slice(0, 4), first: r4.first });

// R7 (quit) then R5: campaign ignores a planted _rng.
await P.g(() => window.game.stopToMenu(false));
await sleep(200);
const r7 = await P.g(() => ({ rng: window.game._rng, modes: window.game._modes, runMode: document.body.dataset.runMode, mode: window.game.mode }));
P.check("R7 stopToMenu after a daily: game._rng === null, game._modes === null, body[data-run-mode] removed", r7.rng === null && r7.modes === null && r7.runMode === undefined && r7.mode === "menu", r7);
const r5 = await P.g(() => {
  const g = window.game;
  g.startSector(0);
  g._rng = () => 0;
  const cfg = LEVELS[g.levelIndex];
  const out = [];
  for (let i = 0; i < 50; i++) out.push(g.makeEnemyText(cfg, 0, null));
  const rv = [g.rand(), g.rand(), g.rand()];
  g._rng = null;
  return { mode: g.runMode(), distinct: new Set(out).size, rv };
});
P.check("R5 campaign after a daily: runMode() campaign; with a planted _rng = () => 0, 50 x makeEnemyText are not all identical and rand() is Math.random-backed",
  r5.mode === "campaign" && r5.distinct > 1 && r5.rv.some((x) => x !== 0), r5);
await P.g(() => window.game.stopToMenu(false));
await sleep(200);

// R6: two attempts on the same date open their first wave alike; the next date differs.
await P.g(() => {
  window.__spawned = [];
  onGameHook("enemySpawned", function (e) { if (this.runMode() === "daily" && this.wave === 0) window.__spawned.push(e.en.text); });
});
const opening = async (n) => {
  await P.g(() => { window.__spawned.length = 0; });
  await P.g(() => window.game.beginModeRun("daily"));
  await waitFor(P, (k) => window.__spawned.length >= k, 20000, n);
  return P.g((k) => window.__spawned.slice(0, k), n);
};
const a1 = await opening(5);
await P.g(() => window.game.stopToMenu(false));
const a2 = await opening(3);
await P.g(() => window.game.stopToMenu(false));
await setNow(P, await localMs(P, 2026, 10, 24));
const b1 = await opening(5);
await P.g(() => window.game.stopToMenu(false));
const sectors = await P.g(() => [modesDailySectorFor(20261023, 5), modesDailySectorFor(20261024, 5)]);
P.check("R6 same mocked date: the first 3 spawned texts of wave 1 are identical across two attempts; the next date's first 5 differ in at least one",
  a1.length >= 3 && a2.length >= 3 && a1.slice(0, 3).join() === a2.slice(0, 3).join() && b1.length >= 5 && b1.join() !== a1.join(), { a1, a2, b1, sectors });

checkErrors(P);
await P.finish();
