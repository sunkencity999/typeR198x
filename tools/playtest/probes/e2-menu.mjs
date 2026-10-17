// E2 nits (e) and (f): the CRT top-bar toggle keeps its "CRT" label while aria-pressed, the status dot and
// :root[data-crt] follow the state; with a saved run, Start reads NEW RUN and confirms, Enter on the menu triggers
// Continue (resume card visible) rather than Start, and Escape on the confirm dialog returns focus to the opener.
// Usage: node probes/e2-menu.mjs
import { openProbe, sleep } from "./_lib.mjs";
import { FIXTURES } from "./_lib.mjs";

const P = await openProbe("e2-menu", { dpr: 1 });
await P.goto("legacy-midwave");
await sleep(600);

// (e) CRT toggle
const crt0 = await P.g(() => { const b = document.getElementById("btnCRT"); const dot = b.querySelector(".dot"); return { label: b.querySelector(".btnLabel").textContent.trim(), pressed: b.getAttribute("aria-pressed"), crt: document.documentElement.dataset.crt, dotBg: getComputedStyle(dot).backgroundColor, dotShadow: getComputedStyle(dot).boxShadow }; });
await P.page.click("#btnCRT");
await sleep(250);
const crt1 = await P.g(() => { const b = document.getElementById("btnCRT"); const dot = b.querySelector(".dot"); return { label: b.querySelector(".btnLabel").textContent.trim(), pressed: b.getAttribute("aria-pressed"), crt: document.documentElement.dataset.crt, dotBg: getComputedStyle(dot).backgroundColor, dotShadow: getComputedStyle(dot).boxShadow, setCRT: document.getElementById("setCRT").checked }; });
await P.page.click("#btnCRT");
await sleep(250);
const crt2 = await P.g(() => { const b = document.getElementById("btnCRT"); return { label: b.querySelector(".btnLabel").textContent.trim(), pressed: b.getAttribute("aria-pressed"), crt: document.documentElement.dataset.crt }; });
P.check("CRT button: label stays CRT, aria-pressed + data-crt + dot flip on click and back", crt0.label === "CRT" && crt1.label === "CRT" && crt2.label === "CRT" && crt0.pressed !== crt1.pressed && crt1.pressed !== crt2.pressed && crt0.crt !== crt1.crt && crt2.crt === crt0.crt && crt0.dotBg !== crt1.dotBg && crt1.setCRT === (crt1.pressed === "true"), { crt0, crt1, crt2 });

// (f) saved run: Start reads NEW RUN, Enter triggers Continue
const menu = await P.g(() => ({ start: document.querySelector("#btnStart .btnLabel, #btnStart").textContent.trim(), cardVisible: !document.getElementById("resumeCard").classList.contains("hidden"), cont: document.querySelector("#btnContinue .btnLabel, #btnContinue").textContent.trim(), primary: window.game.primaryFor("menu") && window.game.primaryFor("menu").id }));
P.check("with a saved run: Start reads NEW RUN, resume card visible, primaryFor(menu) is #btnContinue", /^NEW RUN$/i.test(menu.start) && menu.cardVisible && menu.primary === "btnContinue", menu);

// Escape on the Start confirm returns focus to #btnStart
await P.page.focus("#btnStart");
await P.page.keyboard.press("Enter");          // native activation of the focused Start -> confirm dialog
await P.page.waitForSelector("#confirmModal:not(.is-dismissed)", { timeout: 3000 });
const conf = await P.g(() => ({ title: document.getElementById("confirmTitle").textContent, ok: document.getElementById("btnConfirmOk").textContent, cancel: document.getElementById("btnConfirmCancel").textContent, focused: document.activeElement && document.activeElement.id }));
await P.page.keyboard.press("Escape");
await sleep(500);
const afterEsc = await P.g(() => ({ dismissed: document.getElementById("confirmModal").classList.contains("is-dismissed"), focused: document.activeElement && document.activeElement.id, mode: window.game.mode, runKept: !!window.game.save.run }));
P.check("Start with a saved run opens the confirm (danger: focus on Cancel); Escape dismisses it, keeps the run and restores focus to #btnStart", /abandon/i.test(conf.title) && conf.focused === "btnConfirmCancel" && afterEsc.dismissed && afterEsc.focused === "btnStart" && afterEsc.runKept && afterEsc.mode === "menu", { conf, afterEsc });

// Enter with nothing focused -> Continue (the saved run resumes at its sector, not a new run)
await P.g(() => { document.activeElement && document.activeElement.blur(); document.getElementById("game").focus(); });
await P.page.keyboard.press("Enter");
await P.page.waitForFunction(() => window.game.mode === "playing", null, { timeout: 15000 });
const resumed = await P.g(() => ({ levelIndex: window.game.levelIndex, score: window.game.stats.score, runId: window.game.run && window.game.run.id }));
P.check("Enter on the menu resumed the saved run (sector 3, score 6000) instead of starting a new one", resumed.levelIndex === 2 && resumed.score === 6000, resumed);
await P.finish();
