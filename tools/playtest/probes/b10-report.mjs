// Turns the out/b10/*.json files written by b10.mjs into the markdown tables of tools/playtest/balance.md.
// Usage: node probes/b10-report.mjs [--dir ../out/b10] [--match base-|tuned-]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const DIR = path.resolve(HERE, args.dir || "../out/b10");
const MATCH = args.match || "";
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && f.includes(MATCH)).sort();
const fmt = (v, d = 1) => (v === null || v === undefined ? "-" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(d)) : String(v));
const pct = (v) => (v === null || v === undefined ? "-" : `${fmt(v, 0)} %`);

for (const f of files) {
  const rep = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  console.log(`\n### ${rep.label} — ${rep.wpm} WPM / ${rep.accuracy} accuracy, minion policy ${rep.minions}${rep.jump ? `, direct jump to sector ${rep.jump}` : ", fresh save"}\n`);
  console.log("| S | outcome | to boss s | boss s | min HP | wave leaks/min | boss leaks/min (per phase) | cps ratio w1/w2/w3 | hungry spawns w1/w2/w3 | idle max s w1/w2/w3 | surges f/c | rank (shipped / level-aware) | WPM (nominal) | acc | dmg | tally | clock |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rep.sectors) {
    const outcome = r.mode === "levelComplete" ? "clear" : r.death ? `DIED ${r.death.inBoss ? `boss p${r.death.bossPhase}` : `wave ${r.death.wave}`}` : r.mode;
    const phases = r.boss ? r.boss.phases.map((p) => fmt(p.leaksPerMin)).join("/") : "-";
    const cps = r.perWave.map((w) => (w ? fmt(w.ratio, 2) : "-")).join("/");
    const hungry = r.perWave.map((w) => (w && w.hungrySpawns !== undefined ? `${w.hungrySpawns}/${w.enemies}` : "-")).join(" ");
    const idle = r.perWave.map((w) => (w ? fmt(w.idleMaxS, 2) : "-")).join("/");
    const res = r.results || {};
    console.log(`| ${r.level} | ${outcome} | ${fmt(r.secondsToBoss)} | ${fmt(r.bossDurationS)} | ${pct(r.minHpPct)} | ${fmt(r.waves.leaksPerMin, 2)} | ${r.boss ? fmt(r.boss.leaksPerMin, 2) : "-"} (${phases}) | ${cps} | ${hungry} | ${idle} | ${r.boss ? `${r.boss.surgesFired}/${r.boss.surgesCountered}` : "-"} | ${fmt(res.rank)} / ${fmt(res.rankLevelAware)} | ${fmt(res.wpm)} (${fmt(r.nominalWpm)}) | ${fmt(res.acc)} | ${fmt(r.levelStats.damageTaken)} | ${r.tally ? r.tally.total : "-"} | ${fmt(r.clockRatio, 2)} |`);
  }
}
