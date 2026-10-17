// B2 acceptance: word pools that fit, graded letter sets, anti-repeat, no slice/pad.
import { openProbe, sleep, typeFor, startFresh, jumpTo } from "./b_lib.mjs";

const P = await openProbe("b2");
await P.goto("fresh");

const pools = await P.g(() => LEVELS.map(c => ({
  level: c.level, n: c.words.length,
  fits: c.words.every(w => w.length >= c.wordMin && w.length <= c.wordMax && /^[a-z]+$/.test(w)),
  waves: c.waveWords.map(w => w.length)
})));
P.check("LEVELS.every(c => c.words.length >= 90 && every word within [wordMin, wordMax] && /^[a-z]+$/)", pools.every(p => p.n >= 90 && p.fits), pools);

const gen = await P.g(() => {
  const g = window.game;
  const out = [];
  for (const cfg of LEVELS) {
    const words = new Set(cfg.words);
    let bad = 0, padded = 0, letters = 0, total = 0;
    const badSet = new Set();
    for (let w = 0; w < 3; w++) {
      const letterSet = letterSetForWave(cfg, w);
      for (let i = 0; i < 700; i++) {
        const t = g.makeEnemyText(cfg, w, null);
        total++;
        if (t.length === 1) { letters++; if (!letterSet.includes(t)) { bad++; badSet.add(t); } }
        else if (!words.has(t)) { bad++; badSet.add(t); }
        if (/x{2,}$/.test(t) && !words.has(t)) padded++;
      }
    }
    out.push({ level: cfg.level, total, bad, padded, letters, badSet: [...badSet].slice(0, 5) });
  }
  return out;
});
P.check("2100 makeEnemyText calls per level return only pool words or wave letter-set chars, nothing padded", gen.every(x => x.bad === 0 && x.padded === 0), gen);

const l1 = await P.g(() => {
  const g = window.game;
  const cfg = LEVELS[0];
  const set = new Set();
  for (let i = 0; i < 1500; i++) { const t = g.makeEnemyText(cfg, 0, null); if (t.length === 1) set.add(t); }
  const w3 = new Set();
  for (let i = 0; i < 1500; i++) { const t = g.makeEnemyText(cfg, 2, null); if (t.length === 1) w3.add(t); }
  return { w1: [...set].sort().join(""), w1Ok: [...set].every(c => "asdfjkleiortn".includes(c)), w3: [...w3].sort().join(""), w3Ok: [...w3].every(c => "asdfghjkleiortnucmpwy".includes(c)) };
});
P.check("L1 wave-1 letters subset of 'asdfjkleiortn'; L1 wave-3 letters subset of the basic set", l1.w1Ok && l1.w3Ok, l1);

// No word twice among live enemies in 98 % of 200 frames at L6 (sampled while a typist plays)
await P.startRun("B2");
await jumpTo(P, 5);
let frames = 0, dupFrames = 0, lastT = 0;
await typeFor(P, 40, { wpm: 70, accuracy: 0.96, onTick: async (st, elapsed) => {
  if (frames >= 200 || elapsed - lastT < 150) return;
  lastT = elapsed;
  const dup = await P.g(() => {
    const words = window.game.enemies.filter(e => e.alive && !e.dying && e.text.length > 1).map(e => e.text);
    return words.length !== new Set(words).size;
  });
  frames++; if (dup) dupFrames++;
}, until: () => frames >= 200 });
const pct = frames ? Math.round((frames - dupFrames) / frames * 1000) / 10 : 0;
P.check("no word appears twice among live enemies in >= 98 % of 200 sampled frames at L6", frames >= 150 && pct >= 98, { frames, dupFrames, pct });

P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
