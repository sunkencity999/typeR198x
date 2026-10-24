// t-pace-cadet (PACE, D2 Cadet assist; CONTRACT 6 PACE): no offer on the first death; the second death in one sector
// adds "Fly at Cadet pace" (focus stays on Retry sector, Tab order Retry -> Cadet -> Sector select, described by
// #cadetNote, announced); accepting flies the sector at stream / damage x0.75 and score x0.8 with CADET on the card, the
// results card and the records; the next sector is standard again; the boss path; the death count survives a reload;
// no offer outside the campaign. ~90 s. PASS = the Cadet assist works as D2 states.
// Usage: node tools/playtest/probes/t-pace-cadet.mjs [--dpr 1|2]
import { openProbe, sleep, waitFor, startFresh, jumpTo, forceClear, dieNow, reloadInPlace, errorsCheck } from "./pace_lib.mjs";
import { harnessFlags, LS_KEY } from "./_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const DPR = Number(args.dpr || 1);
const P = await openProbe(`t-pace-cadet-dpr${DPR}`, { dpr: DPR });
await startFresh(P, "CADET");

const over = () => P.g(() => {
  const btn = document.getElementById("btnCadetPace"), note = document.getElementById("cadetNote");
  const vis = (el) => !!el && !el.classList.contains("hidden") && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
  return { mode: window.game.mode, btn: vis(btn), text: btn && btn.textContent, desc: btn && btn.getAttribute("aria-describedby"), note: vis(note) ? note.textContent : null,
    focus: document.activeElement && document.activeElement.id, sr: document.getElementById("srAnnounce").textContent, deaths: { ...window.game.paceSnapshot().state.deaths },
    offer: window.game.paceSnapshot().offer };
});
const retrySector = async () => { await P.g(() => document.getElementById("btnTryAgain").click()); await waitFor(P, () => window.game.mode === "playing", 8000); await waitFor(P, () => !window.game.levelIntro, 6000); };

// ---- 1. first death in S2: no offer ----
await jumpTo(P, 1);
await dieNow(P);
await sleep(400);
const d1 = await over();
P.check("1. S2, first death: Game Over without #btnCadetPace, state.deaths {level 2, n 1}", d1.mode === "gameOver" && !d1.btn && d1.note === null && d1.deaths.level === 2 && d1.deaths.n === 1, d1);

// ---- 2. second death: the offer ----
await retrySector();
await dieNow(P);
await sleep(500);
const d2 = await over();
const tabs = [];
await P.g(() => document.getElementById("btnTryAgain").focus());
for (let i = 0; i < 3; i++) { await P.page.keyboard.press("Tab"); tabs.push(await P.g(() => document.activeElement && document.activeElement.id)); }
P.check("2. second death in S2: 'Fly at Cadet pace' shown, aria-describedby cadetNote, the note's copy, focus on Retry sector, Tab reaches it before Sector select, 'Cadet pace available' announced",
  d2.btn && d2.text === "Fly at Cadet pace" && d2.desc === "cadetNote" && d2.note === "Cadet pace for Sector 2: 75% stream and damage, 80% score, tagged CADET." && d2.focus === "btnTryAgain" &&
  tabs.indexOf("btnCadetPace") >= 0 && tabs.indexOf("btnCadetPace") < tabs.indexOf("btnBackToMenu2") && /Cadet pace available: 75 percent stream and damage, 80 percent score\./.test(d2.sr) && d2.deaths.n === 2,
  { d2, tabs });
await P.shot("gameover-cadet-offer");

// ---- 3. accept ----
await P.g(() => document.getElementById("btnCadetPace").click());
await waitFor(P, () => window.game.mode === "playing", 8000);
const a0 = await P.g(() => {
  const g = window.game;
  const toast = [...document.querySelectorAll(".toast")].map((t) => t.textContent);
  return { diff: g.diff().id, toast, lines: g.banner && g.banner.kind === "sector" ? (g.banner.lines || []).map((l) => l.text) : null, sr: document.getElementById("srAnnounce").textContent, state: g.paceSnapshot().state };
});
await waitFor(P, () => !window.game.levelIntro && window.game.wavePhase === "spawn", 6000);
const a1 = await P.g(() => {
  const g = window.game;
  const t = g.waveTuningNow();
  g.player.shield = 0; g.invulnT = 0;
  const hp0 = g.player.hp; g.takeDamage(20, "leak"); const lost = hp0 - g.player.hp;
  g.invulnT = 0;
  const s0 = g.stats.score; const gained = g.addScore(100); const ds = g.stats.score - s0;
  return { spawnMul: t && t.spawnMul, quota: g.waveQuota(), speedMul: t && t.speedMul, lost, gained, ds, mul: g.paceSnapshot().state.mul };
});
P.check("3. accept: playing, diff() cadet, toast 'CADET PACE · UNTIL SECTOR 2 IS CLEARED' (announced last), card line 'CADET PACE'; W1 spawnMul 0.75, quota round(10 x .75) = 8; takeDamage(20) -> 15; addScore(100) -> +80",
  a0.diff === "cadet" && a0.toast.includes("CADET PACE · UNTIL SECTOR 2 IS CLEARED") && /CADET PACE · UNTIL SECTOR 2 IS CLEARED/.test(a0.sr) && a0.lines && a0.lines.includes("CADET PACE") &&
  a0.state.cadetLevel === 2 && a0.state.usedCadet === true && a1.spawnMul === 0.75 && a1.quota === 8 && a1.lost === 15 && a1.gained === 80 && a1.ds === 80 && a1.mul === 1, { a0, a1 });

// ---- 4. clear at Cadet pace: card tag, row, Bonus tile, records ----
const ok4 = await forceClear(P, {});
await sleep(1600);
const c4 = await P.g(() => {
  const g = window.game;
  const card = document.getElementById("resultsLevel");
  const rows = [...card.querySelectorAll(".bonusList .bonusRow")].map((li) => [li.querySelector(".bonusLabel").textContent, li.querySelector(".bonusValue").textContent, li.classList.contains("bonusRow--penalty")]);
  const t = g.lastTally;
  const want = Math.round(t.retryMul * 0.8 * (t.clear + t.time + t.flawless + t.accuracy));
  const bonusTile = card.querySelector('[data-stat="bonus"]');
  g.renderRecordsTable();
  const hsRow = (g.save.highScores || []).find((h) => h.runId === g.runMeta.id);
  return { tag: !!card.querySelector('.resultsTag[data-tag="CADET"]'), rows, scoreMul: t.scoreMul, total: t.total, want, bonus: bonusTile ? bonusTile.textContent : null,
    hsRow: hsRow && { difficulty: hsRow.difficulty, tags: hsRow.tags }, tableTag: !!document.querySelector('#highScoreTable .hsTag[data-tag="CADET"]'),
    sectorBestTags: (g.save.sectorBests["2"] || {}).tags || null, sr: document.getElementById("srAnnounce").textContent, results: g.lastResults.tags };
});
P.check("4. clear at Cadet pace: .resultsTag[data-tag=CADET], a 'Cadet pace x0.8' penalty row, tally total = round(retryMul x 0.8 x (clear + time + flawless + accuracy)) on the Bonus tile; records row difficulty cadet, tags [CADET], chip in the table; 'Flown at Cadet pace.' announced",
  ok4 && c4.tag && c4.rows.some((r) => r[0] === "Cadet pace" && r[1] === "x0.8" && r[2]) && c4.scoreMul === 0.8 && c4.total === c4.want && (c4.bonus === null || c4.bonus.replace(/[^0-9]/g, "") === String(c4.total)) &&
  c4.hsRow && c4.hsRow.difficulty === "cadet" && JSON.stringify(c4.hsRow.tags) === '["CADET"]' && c4.tableTag && JSON.stringify(c4.sectorBestTags) === '["CADET"]' && /Flown at Cadet pace\./.test(c4.sr), c4);
await P.shot("results-cadet");

// ---- 5. Next -> S3 standard ----
await P.g(() => document.getElementById("btnNextLevel").click());
await waitFor(P, () => window.game.mode === "playing", 8000);
const n5lines = await P.g(() => { const b = window.game.banner; return b && b.kind === "sector" ? (b.lines || []).map((l) => l.text) : null; });
await waitFor(P, () => !window.game.levelIntro && window.game.wavePhase === "spawn", 6000);
const n5 = await P.g(() => { const g = window.game; const s = g.paceSnapshot(); return { diff: g.diff().id, mul: s.state.applied.mul, cadetLevel: s.state.cadetLevel, usedCadet: s.state.usedCadet, spawnMul: g.waveTuningNow().spawnMul }; });
P.check("5. Next -> S3: diff() standard, W1 paceMul >= 1.0 (spawnMul too), cadetLevel 0, no CADET card line (usedCadet stays true for the records)",
  n5.diff === "standard" && n5.mul >= 1 && n5.spawnMul >= 1 && n5.cadetLevel === 0 && n5.usedCadet === true && !(n5lines || []).includes("CADET PACE"), { n5, n5lines });

// ---- 6. boss path: two deaths in the S3 boss -> accept -> the boss checkpoint, Cadet on ----
const bossDeath = async () => {
  await P.g(() => { const g = window.game; if (!g.inBoss) g.levelT = LEVELS[g.levelIndex].duration + 0.01; });
  await waitFor(P, () => window.game.inBoss && !!window.game.boss, 15000);
  await P.g(() => { if (typeof window.game.endBossIntro === "function") window.game.endBossIntro(); });
  await sleep(200);
  return dieNow(P, "minion");
};
await bossDeath();
await sleep(400);
const b1 = await over();
await P.g(() => document.getElementById("btnRetryBoss").click());
await waitFor(P, () => window.game.mode === "playing" && window.game.inBoss, 8000);
await bossDeath();
await sleep(500);
const b2 = await over();
const b2boss = await P.g(() => !document.getElementById("btnRetryBoss").classList.contains("hidden"));
await P.g(() => document.getElementById("btnCadetPace").click());
await waitFor(P, () => window.game.mode === "playing", 8000);
const b3 = await P.g(() => ({ inBoss: window.game.inBoss, diff: window.game.diff().id, cadetLevel: window.game.paceSnapshot().state.cadetLevel, level: window.game.levelIndex + 1 }));
P.check("6. boss path: first S3 boss death no offer, second offers (boss: true, Retry boss shown); accepting restores the boss checkpoint (inBoss) with Cadet on",
  !b1.btn && b1.deaths.n === 1 && b2.btn && b2.offer && b2.offer.boss === true && b2boss && b3.inBoss && b3.diff === "cadet" && b3.cadetLevel === 3 && b3.level === 3, { b1, b2, b2boss, b3 });
// 6b. a death while Cadet is already on: no second offer; the note says it stays on and the announcement carries it
await P.g(() => { if (typeof window.game.endBossIntro === "function") window.game.endBossIntro(); });
await sleep(200);
await dieNow(P, "minion");
await sleep(500);
const b4 = await over();
P.check("6b. a death with Cadet already on for Sector 3: no Cadet button, #cadetNote 'Cadet pace stays on until Sector 3 is cleared.', and the Game Over announcement carries it",
  b4.mode === "gameOver" && !b4.btn && b4.note === "Cadet pace stays on until Sector 3 is cleared." && /Cadet pace stays on until Sector 3 is cleared\./.test(b4.sr) && b4.offer === null, b4);

// ---- 7. the death count survives a reload ----
await jumpTo(P, 4);
await dieNow(P);
await sleep(300);
const r1 = await over();
await reloadInPlace(P);
await waitFor(P, () => !window.game.levelIntro, 6000);
const rs = await P.g(() => ({ ...window.game.paceSnapshot().state.deaths }));
await dieNow(P);
await sleep(500);
const r2 = await over();
P.check("7. S5: a death, reload (blob re-read) + Continue, a second death: the count survived (n 2) and the offer shows",
  r1.deaths.n === 1 && !r1.btn && rs.level === 5 && rs.n === 1 && r2.btn && r2.deaths.n === 2, { r1, rs, r2 });

// ---- 8. no Cadet outside the campaign ----
// With MODES merged (startModeRun exists) a real Daily Sortie is flown twice (a death ends a sortie) and an Endless run
// takes a hit; on a tree without MODES the probe sets run.mode itself (runMode() reads it), which exercises the same guard.
const modesLoaded = await P.g(() => typeof window.game.startModeRun === "function");
if (modesLoaded) {
  const res = [];
  for (const mode of ["daily", "daily", "endless"]) {
    await P.g(() => { const g = window.game; if (g.mode !== "menu") g.stopToMenu(true); });
    const ok = await P.g(async (m) => { try { return !!(await window.game.startModeRun(m)); } catch (e) { return String(e); } }, mode);
    if (ok !== true) { res.push({ mode, started: ok }); continue; }
    await waitFor(P, () => window.game.mode === "playing" && !window.game.levelIntro, 8000);
    await P.g(() => { const g = window.game; g.player.shield = 0; g.invulnT = 0; g.player.hp = 1; g.takeDamage(40, "leak"); });
    await sleep(800);
    res.push({ mode, runMode: await P.g(() => window.game.runMode()), ...(await over()), applies: await P.g(() => window.game.paceCampaign()) });
  }
  const started = res.filter((r) => r.btn !== undefined);
  if (!started.length) P.note("8. no Cadet in daily / endless (MODES present)", `MODES refused every start: ${JSON.stringify(res)}`);
  else P.check("8. MODES runs (two daily sorties ending in death, an endless hit): the Cadet button never shows and no death is counted for Cadet",
    started.every((r) => !r.btn && r.applies === false), res.map((r) => ({ mode: r.mode, runMode: r.runMode, btn: r.btn, started: r.started, deaths: r.deaths })));
} else {
  for (const mode of ["daily", "endless"]) {
    await jumpTo(P, 1);
    await P.g((m) => { window.game.run.mode = m; }, mode);
    await dieNow(P);
    await sleep(200);
    const m1 = await over();
    await P.g(() => { const g = window.game; g.run.mode = "campaign"; });
    await retrySector();
    await P.g((m) => { window.game.run.mode = m; }, mode);
    await dieNow(P);
    await sleep(300);
    const m2 = await over();
    await P.g(() => { window.game.run.mode = "campaign"; });
    P.check(`8. a run whose runMode() reads ${mode}: two deaths in one sector never show the Cadet button and count nothing (MODES absent: run.mode set by the probe; re-run after MODES merges)`,
      !m1.btn && !m2.btn && m2.deaths.n === 0 && m2.offer === null, { m1: { btn: m1.btn, deaths: m1.deaths }, m2: { btn: m2.btn, deaths: m2.deaths } });
  }
}

// ---- 9. touch: a phone context taps the offer ----
const ctx2 = await P.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
await harnessFlags(ctx2);
await ctx2.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} }, LS_KEY);
const p2 = await ctx2.newPage();
const p2errors = [];
p2.on("pageerror", (e) => p2errors.push(String(e && e.stack || e)));
p2.on("console", (m) => { if (m.type() === "error") p2errors.push(m.text()); });
await p2.goto(P.base, { waitUntil: "load" });
await p2.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 120000 });
const M = { page: p2, g: (fn, a) => p2.evaluate(fn, a) };
await p2.fill("#playerName", "TOUCH").catch(() => {});
await p2.tap("#btnStart");
try { const st = p2.locator("#btnStoryLaunch"); await st.waitFor({ state: "visible", timeout: 2500 }); await st.tap(); } catch {}
await p2.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });
await jumpTo(M, 1);
for (let i = 0; i < 2; i++) {
  await dieNow(M);
  await sleep(700);
  if (i === 0) { await p2.tap("#btnTryAgain"); await p2.waitForFunction(() => window.game.mode === "playing" && !window.game.levelIntro, null, { timeout: 10000 }); }
}
const t9a = await M.g(() => { const b = document.getElementById("btnCadetPace"); const r = b.getBoundingClientRect(); return { visible: !b.classList.contains("hidden") && r.width > 0, w: Math.round(r.width), h: Math.round(r.height), inView: r.bottom <= innerHeight && r.top >= 0 }; });
if (!t9a.inView) await p2.locator("#btnCadetPace").scrollIntoViewIfNeeded().catch(() => {});
await p2.tap("#btnCadetPace");
await p2.waitForFunction(() => window.game.mode === "playing", null, { timeout: 8000 }).catch(() => {});
const t9b = await M.g(() => ({ mode: window.game.mode, diff: window.game.diff().id, touch: !!window.game.touchMode }));
P.check("9. touch (390 x 844 phone context): the second death shows 'Fly at Cadet pace' (>= 44 px tall); a tap accepts it (playing, diff cadet); no page / console errors there",
  t9a.visible && t9a.h >= 44 && t9b.mode === "playing" && t9b.diff === "cadet" && p2errors.length === 0, { t9a, t9b, errors: p2errors.slice(0, 3) });
// 9b. the records row of that Cadet run fits the phone-width modal (the CADET chip wraps under FULL, never clipped)
await forceClear(M, {});
await M.g(() => { const g = window.game; g.stopToMenu(true); g.openRecords(); });
await sleep(700);
const t9c = await M.g(() => {
  const t = document.getElementById("highScoreTable");
  const box = t.closest(".modalBody") || t.parentElement;
  const chip = t.querySelector('.hsTag[data-tag="CADET"]');
  const br = box.getBoundingClientRect(), cr = chip ? chip.getBoundingClientRect() : null;
  return { chip: !!chip, tableW: t.scrollWidth, boxW: box.clientWidth, chipRight: cr ? Math.round(cr.right) : null, boxRight: Math.round(br.right) };
});
P.check("9b. phone records (390 x 844): the Cadet run's row shows its CADET chip inside the modal (table no wider than its scroll box, chip not clipped)",
  t9c.chip && t9c.tableW <= t9c.boxW && t9c.chipRight <= t9c.boxRight && p2errors.length === 0, { t9c, errors: p2errors.slice(0, 3) });
await ctx2.close();

errorsCheck(P);
await P.finish();
