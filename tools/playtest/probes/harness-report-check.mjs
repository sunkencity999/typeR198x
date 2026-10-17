// Verifies that a play.mjs report.json carries every v2 field and prints the headline numbers.
// Usage: node probes/harness-report-check.mjs <path/to/report.json> [--all] [--budget-mb 2.5]
//   --all          also require the fields only an `all` scenario produces (fps.boss/finale, stateAfterBoss ...)
//   --budget-mb N  fail when networkTotals.bytesFinishedBeforeFirstKeystrokeNonMedia exceeds N MB (the
//                  pre-first-keystroke budget; media element streaming is reported separately)
// Exit 1 when a field is missing (or the budget is exceeded), else 0. Used by other tracks to assert
// "report.json contains every new field".
import fs from "node:fs";

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const wantAll = argv.includes("--all");
const budgetIdx = argv.indexOf("--budget-mb");
const budgetMb = budgetIdx >= 0 ? Number(argv[budgetIdx + 1]) : null;
if (!file) { console.error("usage: node harness-report-check.mjs <report.json> [--all] [--budget-mb N]"); process.exit(2); }
const r = JSON.parse(fs.readFileSync(file, "utf8"));

const get = (obj, pathStr) => pathStr.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const REQUIRED = [
  "config", "config.noMusic", "pageErrors", "consoleErrors", "resourceErrors", "ignoredErrors", "requestFailures", "mediaAborts", "httpErrors",
  "timings.loadEventMs", "timings.assetsReadyMs", "timings.startToPlayingMs",
  "fps.menu", "fps.gameplay", "perf.menu", "perf.gameplay", "perf.typing",
  "maxRenderMs", "shadowBlurPerFrame", "fullFrameFillMaxAlpha", "getImageDataCalls", "layoutCountPer5s",
  "network", "networkTotals.overallBytes", "networkTotals.mediaBytes", "networkTotals.bytesFinishedBeforeFirstKeystroke",
  "networkTotals.bytesFinishedBeforeFirstKeystrokeNonMedia", "networkTotals.bytesFinishedBeforeFirstKeystrokeMedia", "networkTotals.topUrls",
  "saveBlob", "reduceMotion", "canvas", "probe.longTasks", "probe.wrapped", "screenshots", "notes", "finalState"
];
const REQUIRED_ALL = ["fps.boss", "fps.finale", "perf.boss", "stateAfterBoss", "stateAfterFinale", "stateLevel2", "stateFinalBoss"];
// debugStats is null until window.TypeRDebug.stats() exists (A2/B-15); only its presence as a key is required.
const missing = [...REQUIRED, ...(wantAll ? REQUIRED_ALL : [])].filter(k => get(r, k) === undefined);
if (!("debugStats" in r)) missing.push("debugStats");
// Shape checks on the new fields: arrays stay arrays, byte figures are numbers (null only before any keystroke).
const shape = [];
if (!Array.isArray(r.mediaAborts)) shape.push("mediaAborts is not an array");
if (!Array.isArray(r.requestFailures)) shape.push("requestFailures is not an array");
const nt = r.networkTotals || {};
if (typeof nt.mediaBytes !== "number") shape.push("networkTotals.mediaBytes is not a number");
const nm = nt.bytesFinishedBeforeFirstKeystrokeNonMedia, me = nt.bytesFinishedBeforeFirstKeystrokeMedia, all = nt.bytesFinishedBeforeFirstKeystroke;
if (nm !== null && typeof nm !== "number") shape.push("bytesFinishedBeforeFirstKeystrokeNonMedia is neither number nor null");
if (typeof nm === "number" && typeof me === "number" && typeof all === "number" && nm + me !== all) shape.push(`nonMedia (${nm}) + media (${me}) != total (${all})`);
if (typeof nt.mediaBytes === "number" && typeof nt.overallBytes === "number" && nt.mediaBytes > nt.overallBytes) shape.push("mediaBytes > overallBytes");
if (r.mediaAborts && r.mediaAborts.some((l) => !/net::ERR_ABORTED/.test(l))) shape.push("mediaAborts carries a non-ERR_ABORTED entry");
if (r.requestFailures && r.requestFailures.some((l) => /net::ERR_ABORTED/.test(l) && /\.(mp3|m4a|ogg|opus)|galactic_high_score/i.test(l))) shape.push("a music ERR_ABORTED is still in requestFailures");

const mb = (b) => (b == null ? "-" : (b / 1048576).toFixed(2));
console.log(`report: ${file}`);
console.log(`  scenario ${r.scenario} dpr ${r.dpr} mobile ${r.mobile} fixture ${r.config && r.config.fixture} ua ${r.config && r.config.ua} noMusic ${r.config && r.config.noMusic}`);
console.log(`  pageErrors ${r.pageErrors.length} consoleErrors ${r.consoleErrors.length} resourceErrors ${r.resourceErrors.length} requestFailures ${r.requestFailures.length} mediaAborts ${(r.mediaAborts || []).length}`);
console.log(`  fps ${JSON.stringify(r.fps)} maxRenderMs ${r.maxRenderMs} shadowBlurPerFrame ${r.shadowBlurPerFrame} fullFrameFillMaxAlpha ${r.fullFrameFillMaxAlpha} layoutCountPer5s ${r.layoutCountPer5s}`);
console.log(`  network ${nt.requests} requests, ${mb(nt.overallBytes)} MB overall (${mb(nt.mediaBytes)} MB media), before first keystroke ${mb(all)} MB = ${mb(nm)} MB non-media + ${mb(me)} MB media`);
console.log(`  timings ${JSON.stringify(r.timings)}`);
console.log(`  screenshots ${r.screenshots.length} notes ${r.notes.length}${r.harnessError ? " HARNESS ERROR" : ""}`);
let bad = false;
if (missing.length) { console.log(`  MISSING: ${missing.join(", ")}`); bad = true; }
if (shape.length) { console.log(`  SHAPE: ${shape.join("; ")}`); bad = true; }
if (budgetMb != null && typeof nm === "number" && nm > budgetMb * 1048576) { console.log(`  BUDGET: ${mb(nm)} MB non-media before the first keystroke exceeds ${budgetMb} MB`); bad = true; }
else if (budgetMb != null) console.log(`  budget: ${mb(nm)} MB non-media before the first keystroke <= ${budgetMb} MB`);
if (bad) process.exit(1);
console.log("  all required fields present");
