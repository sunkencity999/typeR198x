// ONBOARD (D13) probe: the harness skips the Flight Check by default and plays it with --flight-check.
// Usage (from the repo root or tools/playtest): node tools/playtest/probes/t-onboard-harness.mjs
// Runs play.mjs --scenario smoke twice (default and --flight-check) into tools/playtest/out/t-onboard-harness/, then
// checks openProbe's default. PASS = the feature works. Exit 1 on any failed check or page / console error.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openProbe, ROOT } from "./_lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAY = path.resolve(HERE, "../play.mjs");
const CHECK = path.resolve(HERE, "harness-report-check.mjs");
const OUT = path.resolve(HERE, "../out/t-onboard-harness");

function run(cmd, args, timeoutMs = 300000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: path.resolve(HERE, ".."), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); out += "\n[timeout]"; }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}
const readReport = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")); } catch { return null; } };
const shots = (dir) => { try { return fs.readdirSync(dir).filter((f) => /\.png$/.test(f)).sort(); } catch { return []; } };

const P = await openProbe("t-onboard-harness", {});

// ---- 1. Default: skipped ----
const dDef = path.join(OUT, "default");
const r1 = await run("node", [PLAY, "--root", ROOT, "--scenario", "smoke", "--out", dDef]);
const rep1 = readReport(dDef);
const shots1 = shots(dDef);
P.check("1 play.mjs --scenario smoke (default): exit 0, flightCheck.played false, config.flightCheck false, no 17-flight-check shot, wave play in sector 1",
  r1.code === 0 && !!rep1 && rep1.flightCheck && rep1.flightCheck.played === false && rep1.config.flightCheck === false &&
  !shots1.some((f) => /flight-check/.test(f)) && rep1.stateAfterWave && rep1.stateAfterWave.levelIndex === 0 && rep1.pageErrors.length === 0 && rep1.consoleErrors.length === 0,
  JSON.stringify({ code: r1.code, flightCheck: rep1 && rep1.flightCheck, config: rep1 && rep1.config.flightCheck, shots: shots1, after: rep1 && rep1.stateAfterWave, notes: rep1 && rep1.notes }));

// ---- 2. --flight-check: played and passed, shots 17-20, report check with the 2.5 MB budget ----
const dFlag = path.join(OUT, "flag");
const r2 = await run("node", [PLAY, "--root", ROOT, "--scenario", "smoke", "--flight-check", "--out", dFlag]);
const rep2 = readReport(dFlag);
const shots2 = shots(dFlag);
const want = ["17-flight-check-1.png", "18-flight-check-2.png", "19-flight-check-3.png", "20-flight-check-complete.png"];
const r2c = await run("node", [CHECK, path.join(dFlag, "report.json"), "--budget-mb", "2.5"], 60000);
P.check("2 play.mjs --scenario smoke --flight-check: exit 0, played + passed + sector card, shots 17-20, harness-report-check --budget-mb 2.5 passes",
  r2.code === 0 && !!rep2 && rep2.config.flightCheck === true && rep2.flightCheck && rep2.flightCheck.played === true && rep2.flightCheck.result === "passed" &&
  rep2.flightCheck.sectorCard === true && want.every((f) => shots2.includes(f)) && r2c.code === 0 && rep2.pageErrors.length === 0 && rep2.consoleErrors.length === 0,
  JSON.stringify({ code: r2.code, flightCheck: rep2 && rep2.flightCheck, shots: shots2.filter((f) => /^(1[7-9]|20)-/.test(f)), reportCheck: r2c.code,
    budget: (r2c.out.match(/budget: .*|BUDGET: .*/) || [""])[0], notes: rep2 && rep2.notes }));

// ---- 3. openProbe's default skips it ----
await P.goto(null);
await P.startRun("HARNESS");
const s3 = await P.page.waitForFunction(() => { const g = window.game; return !g.flightCheck && !g.levelIntro && g.mode === "playing" ? { active: g.isFlightCheckActive(), flag: window.TypeRHarness && window.TypeRHarness.flightCheck } : null; }, null, { timeout: 6000 })
  .then((h) => h.jsonValue()).catch(() => null);
P.check("3 openProbe default (fresh save + startRun): no Flight Check, the sector card is gone within 6 s, TypeRHarness.flightCheck skip",
  !!s3 && s3.active === false && s3.flag === "skip", JSON.stringify(s3));

P.check("no page / console errors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, JSON.stringify(P.errors));
await P.finish();
