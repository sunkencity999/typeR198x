// ONBOARD (D13) probe: the mission briefing shows a 3-line summary, with the full briefing behind a disclosure.
// Usage (from the repo root or tools/playtest): node tools/playtest/probes/t-onboard-briefing.mjs
// PASS = the feature works. Exit 1 on any failed check or page / console error.
import { openProbe, sleep, harnessFlags, LS_KEY } from "./_lib.mjs";

const P = await openProbe("t-onboard-briefing", { flightCheck: "skip" });
const { page } = P;
const SUMMARY = ["Type the first letter to lock.", "Finish the word to fire.", "Space lets go."];
const extraErrors = [];
const isOpen = () => P.g(() => { const m = document.getElementById("storyModal"); return !m.classList.contains("is-dismissed"); });

// ---- 1. Fresh Start: summary, closed disclosure, Launch focused, five paragraphs kept ----
await P.goto(null);
await page.fill("#playerName", "BRIEF").catch(() => {});
await page.click("#btnStart");
await page.locator("#btnStoryLaunch").waitFor({ state: "visible", timeout: 4000 });
await sleep(300);
const s1 = await P.g(() => {
  const m = document.getElementById("storyModal");
  const paras = [...document.querySelectorAll("#storyMore .modalBody p")].map((p) => p.textContent);
  return {
    open: !m.classList.contains("is-dismissed"), items: [...document.querySelectorAll("#storySummary li")].map((li) => li.textContent),
    moreOpen: document.getElementById("storyMore").open, focus: document.activeElement && document.activeElement.id,
    describedBy: m.getAttribute("aria-describedby"), paras: paras.length, first: paras[0] || "", last: paras[paras.length - 1] || "",
    summaryText: document.querySelector("#storyMore > summary").textContent
  };
});
P.check("1 fresh Start -> briefing open: summary lines exact, disclosure closed, focus on Launch, aria-describedby storySummary, five paragraphs behind 'Read the full briefing'",
  s1.open && JSON.stringify(s1.items) === JSON.stringify(SUMMARY) && s1.moreOpen === false && s1.focus === "btnStoryLaunch" && s1.describedBy === "storySummary" &&
  s1.paras === 5 && /^In 198X, the world’s neon skyways/.test(s1.first) && /Type fast\. Type clean\./.test(s1.last) && s1.summaryText === "Read the full briefing",
  JSON.stringify({ ...s1, first: s1.first.slice(0, 30), last: s1.last.slice(0, 30) }));
await P.shot("briefing-closed");

// ---- 2. Tab stays inside and reaches the summary; Enter opens it; scroll affordance; Escape -> menu ----
const ring = [];
for (let i = 0; i < 8; i++) {
  await page.keyboard.press("Tab");
  ring.push(await P.g(() => { const a = document.activeElement; return { tag: a.tagName, id: a.id, inside: !!a.closest("#storyModal") }; }));
}
await P.g(() => document.querySelector("#storyMore > summary").focus());
await page.keyboard.press("Enter");
await sleep(250);
const s2 = await P.g(() => {
  const wrap = document.querySelector("#storyModal .modalScroll"); const body = wrap.querySelector(".modalBody");
  return { moreOpen: document.getElementById("storyMore").open, scrollable: wrap.classList.contains("is-scrollable"), measured: body.scrollHeight > body.clientHeight + 2 };
});
await P.shot("briefing-open");
await page.keyboard.press("Escape");
await sleep(400);
const s2b = await P.g((k) => ({ mode: window.game.mode, open: !document.getElementById("storyModal").classList.contains("is-dismissed"), storySeen: window.game.save.storySeen,
  stored: (JSON.parse(localStorage.getItem(k) || "{}") || {}).storySeen }), LS_KEY);
P.check("2 Tab cycles inside the modal (summary, Back, Launch, never stuck on one stop); Enter on the summary opens it; .is-scrollable matches the body; Escape -> menu, storySeen false",
  ring.every((r) => r.inside) && ring.some((r) => r.tag === "SUMMARY") && ring.some((r) => r.id === "btnStoryBack") && ring.some((r) => r.id === "btnStoryLaunch") &&
  ring.every((r, i) => i === 0 || r.id !== ring[i - 1].id || r.tag !== ring[i - 1].tag) && s2.moreOpen && s2.scrollable === s2.measured && s2b.mode === "menu" && !s2b.open &&
  s2b.storySeen === false && !s2b.stored, JSON.stringify({ ring: ring.map((r) => r.id || r.tag), ...s2, ...s2b }));

// ---- 3. Sizes: 1440x900 closed <= 420 px; Launch on screen at 390x844 and 844x390; 844x390 opened scrolls once ----
const sizes = {};
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  const ctx = await P.browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  await harnessFlags(ctx);
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => extraErrors.push(`${vp.width}x${vp.height}: ${e}`));
  pg.on("console", (m) => { if (m.type() === "error") extraErrors.push(`${vp.width}x${vp.height}: ${m.text()}`); });
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });
  await pg.evaluate(() => window.game.showStoryModal({ launch: true }));
  await sleep(500);
  const m = await pg.evaluate(() => {
    const inner = document.querySelector("#storyModal .modalInner"); const ir = inner.getBoundingClientRect();
    const l = document.getElementById("btnStoryLaunch").getBoundingClientRect();
    return { innerH: Math.round(ir.height), innerScrollTop: inner.scrollTop, launch: { top: l.top, bottom: l.bottom, left: l.left, right: l.right }, vw: innerWidth, vh: innerHeight };
  });
  m.launchInView = m.launch.top >= 0 && m.launch.left >= 0 && m.launch.bottom <= m.vh && m.launch.right <= m.vw && m.innerScrollTop === 0;
  if (vp.width === 844) {
    await pg.evaluate(() => { document.getElementById("storyMore").open = true; });
    await sleep(250);
    m.opened = await pg.evaluate(() => {
      const inner = document.querySelector("#storyModal .modalInner"); const body = document.querySelector("#storyModal .modalBody");
      return { innerOverflow: getComputedStyle(inner).overflowY, innerScrolls: inner.scrollHeight > inner.clientHeight + 2,
        bodyOverflow: getComputedStyle(body).overflowY, bodyScrolls: body.scrollHeight > body.clientHeight + 2 };
    });
  }
  await pg.screenshot({ path: `${P.out}/briefing-${vp.width}x${vp.height}.png` });
  sizes[`${vp.width}x${vp.height}`] = m;
  await ctx.close();
}
const o = sizes["844x390"].opened;
P.check("3 1440x900 closed .modalInner <= 420 px; Launch fully on screen without scrolling at 390x844 and 844x390; 844x390 opened: .modalInner scrolls, .modalBody does not",
  sizes["1440x900"].innerH <= 420 && sizes["1440x900"].launchInView && sizes["390x844"].launchInView && sizes["844x390"].launchInView &&
  o.innerOverflow === "auto" && o.innerScrolls && !o.bodyScrolls && o.bodyOverflow === "visible", JSON.stringify(sizes));

// ---- 4. Re-read from the menu opens the full briefing; Close returns focus ----
await P.g(() => document.getElementById("btnBriefing").focus());
await page.keyboard.press("Enter");
await sleep(400);
const s4 = await P.g(() => ({ open: !document.getElementById("storyModal").classList.contains("is-dismissed"), moreOpen: document.getElementById("storyMore").open,
  label: document.getElementById("btnStoryLaunch").textContent, focus: document.activeElement && document.activeElement.id,
  backHidden: document.getElementById("btnStoryBack").classList.contains("hidden") }));
await page.keyboard.press("Enter");   // Launch (relabelled Close) has focus
await sleep(450);
const s4b = await P.g(() => ({ closed: document.getElementById("storyModal").classList.contains("is-dismissed"), focus: document.activeElement && document.activeElement.id }));
P.check("4 'Re-read briefing' -> disclosure open, Launch reads Close and has focus; Close -> focus back on #btnBriefing",
  s4.open && s4.moreOpen === true && s4.label === "Close" && s4.focus === "btnStoryLaunch" && s4.backHidden && s4b.closed && s4b.focus === "btnBriefing",
  JSON.stringify({ s4, s4b }));

// ---- 5. Launch on a fresh save still reaches play within 1 s ----
await page.click("#btnStart");
await page.locator("#btnStoryLaunch").waitFor({ state: "visible", timeout: 4000 });
const s5open = await P.g(() => document.getElementById("storyMore").open);
await sleep(300);
const t0 = Date.now();
await page.click("#btnStoryLaunch");
const playing = await page.waitForFunction(() => window.game.mode === "playing", null, { timeout: 5000 }).then(() => true).catch(() => false);
const ms = Date.now() - t0;
P.check("5 Launch on a fresh save -> playing within 1 s (the summary opened closed again)", playing && ms <= 1000 && s5open === false, JSON.stringify({ ms, s5open }));

P.check("no page / console errors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0 && extraErrors.length === 0, JSON.stringify({ ...P.errors, extraErrors }));
await P.finish();
