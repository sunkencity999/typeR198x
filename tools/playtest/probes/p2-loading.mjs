// Loading-overlay acceptance (PLAN A8 / UX-09 / PERF-03): slow-link watchdog and the critical-asset error path.
// Usage: node probes/p2-loading.mjs --mode delay      (opt images delayed 20 s: Continue at ~12 s, menu works, art pops in later)
//        node probes/p2-loading.mjs --mode delay-all  (every assets/opt/* delayed 20 s incl. manifest.js, like play.mjs --delay-opt:
//                                                      the scripts cannot run before 20 s, so Continue appears right after boot)
//        node probes/p2-loading.mjs --mode fail       (bg/first WebP + PNG 404: #loadingError lists "sector 1 skyline", Continue reaches playing)
import { openProbe, sleep } from "./_lib.mjs";

const mode = (process.argv.find((a, i, arr) => arr[i - 1] === "--mode")) || "delay";
const P = await openProbe("p2-loading-" + mode, { dpr: 1 });
const page = P.page;

if (mode === "delay") {
  await page.route(/\/assets\/opt\/(bg|fg|fx|ships|bosses)\//, async (route) => { await sleep(20000); await route.continue().catch(() => {}); });
} else if (mode === "delay-all") {
  await page.route(/\/assets\/opt\//, async (route) => { await sleep(20000); await route.continue().catch(() => {}); });
} else {
  await page.route(/bg\/first@1x\.webp|bg\/first@2x\.webp|firstlevelbg\.png/, (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "injected 404" }));
}

const t0 = Date.now();
// "load" would wait for the delayed images (and under delay-all for the delayed scripts), so poll from commit.
await page.goto(P.base, { waitUntil: "commit", timeout: 90000 });

if (mode === "delay-all") {
  const shown = await page.waitForFunction(() => {
    const c = document.getElementById("btnLoadingContinue"); const e = document.getElementById("loadingError");
    return c && e && !c.classList.contains("hidden") && !e.classList.contains("hidden");
  }, null, { timeout: 60000 }).then(() => (Date.now() - t0) / 1000).catch(() => null);
  const st = await P.g(() => ({ gameUp: !!window.game, label: document.getElementById("loadingLabel").textContent, hidden: document.getElementById("loadingOverlay").classList.contains("hidden") }));
  P.check(`delay-all: Continue offered ${shown} s after navigation (scripts arrive at 20 s; watchdog anchored to navigation start)`, shown !== null && shown < 24 && st.gameUp && !st.hidden, st);
  await page.click("#btnLoadingContinue", { force: true });
  const hid = await page.waitForFunction(() => document.getElementById("loadingOverlay").classList.contains("hidden"), null, { timeout: 2000 }).then(() => true).catch(() => false);
  P.check("delay-all: Continue dismisses the overlay", hid, hid);
  // Start: the audio one-shots are delayed too, so the unlock is pending ~20 s and Start must show the busy state (F014).
  await page.fill("#playerName", "DELAYALL").catch(() => {});
  await page.click("#btnStart", { force: true });
  await sleep(600);
  const busy = await P.g(() => { const b = document.getElementById("btnStart"); return { ariaBusy: b.getAttribute("aria-busy"), label: (b.querySelector(".btnLabel") || b).textContent }; });
  P.check("delay-all: #btnStart aria-busy with 'SPOOLING AUDIO…' while the one-shot unlock is pending", busy.ariaBusy === "true" && /SPOOLING AUDIO/.test(busy.label), busy);
  const story = page.locator("#btnStoryLaunch");
  try { await story.waitFor({ state: "visible", timeout: 45000 }); await story.click(); } catch (e) { /* storySeen or stalled */ }
  const playing = await page.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 45000 }).then(() => true).catch(() => false);
  const after = await P.g(() => { const b = document.getElementById("btnStart"); return { mode: game.mode, ariaBusy: b.getAttribute("aria-busy"), label: (b.querySelector(".btnLabel") || b).textContent, audioReady: game.audioReady }; });
  P.check("delay-all: run reaches playing once the unlock resolves; busy state cleared and label restored", playing && after.ariaBusy === null && !/SPOOLING AUDIO/.test(after.label), after);
} else if (mode === "delay") {
  await sleep(Math.max(0, 11500 - (Date.now() - t0)));
  const at11 = await P.g(() => ({ cont: !document.getElementById("btnLoadingContinue").classList.contains("hidden") && !document.getElementById("loadingError").classList.contains("hidden"), hidden: document.getElementById("loadingOverlay").classList.contains("hidden") }));
  await sleep(1500);
  const at13 = await P.g(() => {
    const ov = document.getElementById("loadingOverlay");
    const cont = document.getElementById("btnLoadingContinue");
    const r = cont.getBoundingClientRect();
    return { contVisible: r.width > 0 && !cont.classList.contains("hidden") && !document.getElementById("loadingError").classList.contains("hidden"),
      overlayUp: !ov.classList.contains("hidden") && !ov.classList.contains("is-dismissed"), label: document.getElementById("loadingLabel").textContent,
      valuenow: document.getElementById("loadingBar").getAttribute("aria-valuenow"), isError: ov.classList.contains("isError") };
  });
  P.check("11.5 s: Continue not yet offered, overlay up", !at11.cont && !at11.hidden, at11);
  P.check("13 s: #btnLoadingContinue visible, overlay still up, 'Still spooling' copy, no error styling", at13.contVisible && at13.overlayUp && /still spooling/i.test(at13.label) && !at13.isError, at13);
  await page.click("#btnLoadingContinue", { force: true });
  const hid = await page.waitForFunction(() => { const ov = document.getElementById("loadingOverlay"); return ov.classList.contains("hidden"); }, null, { timeout: 2000 }).then(() => true).catch(() => false);
  P.check("Continue dismisses the overlay (.is-dismissed -> .hidden within 2 s)", hid, hid);
  await P.startRun("DELAY");
  const st = await P.g(() => ({ mode: game.mode, degraded: game.degradedAssets, bootReason: game.bootReason, resident: TypeRAssets.stats().resident }));
  P.check("menu works after Continue: run reaches playing; degradedAssets set; bootReason continue", st.mode === "playing" && st.degraded === true && st.bootReason === "continue", st);
  await sleep(9000); // let the delayed art arrive and pop in
  // bosses/1 was only requested at Continue time (+20 s), so levelReady stays false until then: the gate fails open at 2.5 s.
  const later = await P.g(() => ({ resident: TypeRAssets.stats().resident, levelReady: game.levelReady, gateOpen: game.isLevelGateOpen(), levelWait: game.levelWait }));
  P.check("delayed art pops in later (bg/first resident) while the level gate failed open at LEVEL_INTRO_MAX_S", later.resident.includes("bg/first") && later.gateOpen, later);
  await P.shot("after-delay");
} else {
  const errShown = await page.waitForFunction(() => !document.getElementById("loadingError").classList.contains("hidden"), null, { timeout: 8000 }).then(() => true).catch(() => false);
  const e = await P.g(() => ({ text: document.getElementById("loadingErrorText").textContent, isError: document.getElementById("loadingOverlay").classList.contains("isError"),
    retry: !document.getElementById("btnLoadingRetry").classList.contains("hidden"), failed: game.failedAssets.map((f) => f.key), overlayHidden: document.getElementById("loadingOverlay").classList.contains("hidden") }));
  P.check("404 on bg/first (WebP + PNG): #loadingError lists 'sector 1 skyline' with Retry and Continue, overlay held", errShown && /sector 1 skyline/.test(e.text) && e.isError && e.retry && !e.overlayHidden && e.failed.includes("bg/first"), e);
  await P.shot("error-state");
  await page.click("#btnLoadingContinue", { force: true });
  const hid = await page.waitForFunction(() => document.getElementById("loadingOverlay").classList.contains("hidden"), null, { timeout: 2000 }).then(() => true).catch(() => false);
  P.check("Continue anyway dismisses the overlay", hid, hid);
  await P.startRun("FAIL");
  await sleep(1200);
  const st = await P.g(() => ({ mode: game.mode, degraded: game.degradedAssets, bg: !!TypeRAssets.get("bg/first"), fg: !!TypeRAssets.get("fg/first"), toast: !!document.querySelector(".toast--warn") }));
  P.check("reaches playing on the procedural backdrop (bg/first null, fg/first drawn), degradedAssets true, warn toast shown", st.mode === "playing" && st.degraded && !st.bg && st.fg && st.toast, st);
  await P.shot("degraded-play");
}

// Resource-load console errors are expected in the fail mode; only page errors count.
if (mode === "fail") P.errors.consoleErrors = P.errors.consoleErrors.filter((t) => !/Failed to load resource|404/.test(t));
await P.finish();
