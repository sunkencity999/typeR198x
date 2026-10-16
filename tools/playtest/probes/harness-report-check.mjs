// Verifies that a play.mjs report.json carries every v2 field and prints the headline numbers.
// Usage: node probes/harness-report-check.mjs <path/to/report.json> [--all]
//   --all   also require the fields only an `all` scenario produces (fps.boss/finale, stateAfterBoss ...)
// Exit 1 when a field is missing, else 0. Used by other tracks to assert "report.json contains every new field".
import fs from "node:fs";

const file = process.argv[2];
const wantAll = process.argv.includes("--all");
if (!file) { console.error("usage: node harness-report-check.mjs <report.json> [--all]"); process.exit(2); }
const r = JSON.parse(fs.readFileSync(file, "utf8"));

const get = (obj, pathStr) => pathStr.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const REQUIRED = [
  "config", "pageErrors", "consoleErrors", "resourceErrors", "ignoredErrors", "requestFailures", "httpErrors",
  "timings.loadEventMs", "timings.assetsReadyMs", "timings.startToPlayingMs",
  "fps.menu", "fps.gameplay", "perf.menu", "perf.gameplay", "perf.typing",
  "maxRenderMs", "shadowBlurPerFrame", "fullFrameFillMaxAlpha", "getImageDataCalls", "layoutCountPer5s",
  "network", "networkTotals.overallBytes", "networkTotals.bytesFinishedBeforeFirstKeystroke", "networkTotals.topUrls",
  "saveBlob", "reduceMotion", "canvas", "probe.longTasks", "probe.wrapped", "screenshots", "notes", "finalState"
];
const REQUIRED_ALL = ["fps.boss", "fps.finale", "perf.boss", "stateAfterBoss", "stateAfterFinale", "stateLevel2", "stateFinalBoss"];
// debugStats is null until window.TypeRDebug.stats() exists (A2/B-15); only its presence as a key is required.
const missing = [...REQUIRED, ...(wantAll ? REQUIRED_ALL : [])].filter(k => get(r, k) === undefined);
if (!("debugStats" in r)) missing.push("debugStats");

console.log(`report: ${file}`);
console.log(`  scenario ${r.scenario} dpr ${r.dpr} mobile ${r.mobile} fixture ${r.config && r.config.fixture}`);
console.log(`  pageErrors ${r.pageErrors.length} consoleErrors ${r.consoleErrors.length} resourceErrors ${r.resourceErrors.length}`);
console.log(`  fps ${JSON.stringify(r.fps)} maxRenderMs ${r.maxRenderMs} shadowBlurPerFrame ${r.shadowBlurPerFrame} fullFrameFillMaxAlpha ${r.fullFrameFillMaxAlpha} layoutCountPer5s ${r.layoutCountPer5s}`);
console.log(`  network ${r.networkTotals.requests} requests, ${(r.networkTotals.overallBytes / 1048576).toFixed(2)} MB overall, ${((r.networkTotals.bytesFinishedBeforeFirstKeystroke || 0) / 1048576).toFixed(2)} MB before first keystroke`);
console.log(`  screenshots ${r.screenshots.length} notes ${r.notes.length}${r.harnessError ? " HARNESS ERROR" : ""}`);
if (missing.length) { console.log(`  MISSING: ${missing.join(", ")}`); process.exit(1); }
console.log("  all required fields present");
