// t-modes-daily (MODES, D9 + lead rulings Q5 / "SORTIES n"): the Daily Sortie tile, start, pause copy, three waves and
// no boss, the results card and rating, the save record (counted vs practice, death, streak copy, midnight), isolation of
// every campaign field, the share line and its copy, quit keeping the campaign run, post-victory sectors, the locked
// deck on a fresh save, the SILVER cap on a lost sortie and the save.modes size budget. PASS = the feature works.
// Usage: node tools/playtest/probes/t-modes-daily.mjs
import { openProbe, sleep, F5, localMs, setNow, startMode, waitMode, waitFor, isolation, card, typeWords, checkErrors } from "./modes_lib.mjs";
const WORDS6 = ["signal", "vector", "plasma", "shogun", "matrix", "cipher"];   // 30 qualifying intervals, typed exactly

const P = await openProbe("t-modes-daily");
await P.context.grantPermissions(["clipboard-read", "clipboard-write"]);
await P.goto(F5());
await sleep(300);
const iso0 = await isolation(P);
const blobRun0 = await P.g((k) => JSON.stringify(JSON.parse(localStorage.getItem(k)).run), "typesmup198x.save.v1");
const day23 = await localMs(P, 2026, 10, 23);
await setNow(P, day23);

// D1 tile
const d1 = await P.g(() => {
  const b = document.getElementById("btnDaily").getBoundingClientRect();
  const t = (id) => document.getElementById(id).textContent;
  return { inView: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth && b.width > 0, date: t("dailyDate"), sector: t("dailySector"), status: t("dailyStatus"),
    aria: document.getElementById("btnDaily").getAttribute("aria-label"), deckHidden: document.getElementById("modeDeck").classList.contains("hidden"), meta: document.getElementById("dailyMeta").className };
});
P.check("D1 1440x900: #btnDaily inside the viewport; FRI 23 OCT / SECTOR 05 · CHROME MONOLITH (U5 -> 5) / FLY; aria-label starts 'Daily sortie'; no meta line yet",
  d1.inView && !d1.deckHidden && d1.date === "FRI 23 OCT" && d1.sector === "SECTOR 05 · CHROME MONOLITH" && d1.status === "FLY" && /^Daily sortie, /.test(d1.aria) && /hidden/.test(d1.meta), d1);

// D2 start from the tile
await P.page.click("#btnDaily");
await waitFor(P, () => window.game.mode === "playing", 10000);
const d2 = await P.g(() => {
  const g = window.game;
  return { mode: g.mode, run: g.run && g.run.mode, li: g.levelIndex, eyebrow: g.banner && g.banner.eyebrow, title: g.banner && g.banner.title, sub: g.banner && g.banner.sub,
    said: document.getElementById("srAnnounce").textContent, boss: getComputedStyle(document.querySelector(".stageSeg--boss")).display, label: document.getElementById("hudLevel").previousElementSibling.textContent,
    saveRunSame: g.save.run !== g.run };
});
const blobRun1 = await P.g((k) => JSON.stringify(JSON.parse(localStorage.getItem(k)).run), "typesmup198x.save.v1");
P.check("D2 click: playing, run.mode daily, levelIndex 4, card DAILY SORTIE · FRI 23 OCT / SECTOR 05 / 3 WAVES · NO BOSS, announce 'Daily sortie ...', stored run byte-identical, boss stage segment hidden",
  d2.mode === "playing" && d2.run === "daily" && d2.li === 4 && d2.eyebrow === "DAILY SORTIE · FRI 23 OCT" && d2.title === "SECTOR 05" && d2.sub === "3 WAVES · NO BOSS" &&
  /Daily sortie, sector 5, Chrome Monolith\. Three waves, no boss\. Counted attempt\./.test(d2.said) && blobRun1 === blobRun0 && d2.boss === "none" && d2.label === "Daily" && d2.saveRunSame, d2);

// D3 pause copy
await waitFor(P, () => !window.game.levelIntro, 8000);
await P.page.keyboard.press("Escape");
await waitMode(P, "paused", 3000);
const d3 = await P.g(() => ({ eyebrow: document.getElementById("pauseEyebrow").textContent, restart: document.getElementById("btnRestart").textContent, quit: document.getElementById("btnPauseQuit").textContent }));
await sleep(400);
await P.page.keyboard.press("Enter");
const resumed = await waitMode(P, "playing", 3000);
P.check("D3 Esc: 'Paused // Daily sortie · Sector 05', Restart sortie, Quit to menu; Enter resumes", d3.eyebrow === "Paused // Daily sortie · Sector 05" && d3.restart === "Restart sortie" && d3.quit === "Quit to menu" && resumed, d3);

// D4 three waves (typed for a rating), no boss
await P.g(() => { window.__phases = []; window.__inBoss = false; window.__tick = setInterval(() => { const g = window.game; window.__phases.push(g.wavePhase); if (g.inBoss) window.__inBoss = true; }, 30); });
await typeWords(P, WORDS6, 150);
await P.g(() => { const g = window.game; g.spawnAcc = 0; g.hungryT = 0; g.powerAcc = 0; });
for (let w = 0; w < 3; w++) {
  await waitFor(P, (ww) => { const g = window.game; return (g.wave === ww && g.wavePhase === "spawn") || g.wave > ww || g.wavePhase === "modeEnd"; }, 12000, w);
  await P.g((ww) => { const g = window.game; if (g.wave === ww && g.wavePhase === "spawn") g.waveKills = g.waveQuota(); }, w);
  await waitFor(P, (ww) => window.game.wavePhase !== "spawn" || window.game.wave !== ww, 3000, w);
  await P.g(() => window.game.detonateLeftovers());
}
const outro = await waitFor(P, () => window.game.banner && window.game.banner.title === "SORTIE COMPLETE", 4000);
const atCard = await waitMode(P, "modeResults", 4000);
const d4 = await P.g(() => { clearInterval(window.__tick); return { approach: window.__phases.includes("approach") || window.game.phaseLog.includes("approach"), inBoss: window.__inBoss, mode: window.game.mode }; });
P.check("D4 three waves by quota: never 'approach', never inBoss, outro banner SORTIE COMPLETE, modeResults within 4 s", !d4.approach && !d4.inBoss && outro && atCard, d4);

// D5 card
await sleep(1300);
const c5 = await card(P);
const tileOf = (c, label) => c.values[c.labels.indexOf(label)];
const rating = tileOf(c5, "RATING"), wpm = tileOf(c5, "WPM"), acc = parseInt(tileOf(c5, "ACC"), 10);
const ratingOk = rating === "--" || (wpm !== "--" && Math.abs(Number(rating) - Math.round(Number(wpm) * Math.pow(acc / 100, 2))) <= 1);
P.check("D5 card: DAILY SORTIE · 2026-10-23, tiles RATING/WPM/ACC/TIME/SCORE/WORDS, RATING = round(WPM x (ACC/100)^2) +-1, medal badge GOLD/SILVER/BRONZE/—, COUNTED SORTIE, focus #btnModeAgain, announce carries the rating",
  c5.eyebrow === "DAILY SORTIE · 2026-10-23" && c5.labels.join() === "RATING,WPM,ACC,TIME,SCORE,WORDS" && ratingOk && rating !== "--" && ["GOLD", "SILVER", "BRONZE", "—"].includes(c5.badge) &&
  c5.badgeShown && c5.head === "COUNTED SORTIE" && c5.focus === "btnModeAgain" && /Rating \d+, (gold|silver|bronze)\./.test(c5.said) && /Counted\. Sorties 1\. Press Enter to fly again\.$/.test(c5.said) &&
  c5.sub === "BY ACCURACY · GOLD AT 97% · SILVER AT 93%" && c5.again === "Fly again", c5);

// D6 save
const d6 = await P.g((k) => { const b = JSON.parse(localStorage.getItem(k)); return { modes: b.modes, sess: window.game.typistSessions(5).map((s) => s.mode) }; }, "typesmup198x.save.v1");
const iso1 = await isolation(P);
const day = d6.modes && d6.modes.daily.days["20261023"];
P.check("D6 save: days[20261023] {sector 5, result clear, rating = card}, today.attempts 1, flown 1, streak {1, 20261023}; a daily session; highScore / highScores / sectorBests / lastUnlockedLevel / bestWpm / victories / run / profile campaign bests unchanged (blob and memory), no deathsBySector",
  day && day.sector === 5 && day.result === "clear" && String(day.rating) === rating && d6.modes.daily.today.attempts === 1 && d6.modes.daily.flown === 1 && d6.modes.daily.streak.n === 1 &&
  d6.modes.daily.streak.last === 20261023 && d6.sess.includes("daily") && iso1.blob === iso0.mem && iso1.mem === iso0.mem && iso1.deaths === "{}", { day, today: d6.modes && d6.modes.daily.today, blobSame: iso1.blob === iso0.mem, memSame: iso1.mem === iso0.mem });

// D11 share line + copy
const RE = /^TYPE-R 198X · DAILY \d{4}-\d{2}-\d{2} · S\d+ [A-Z ]+ · (\d+|--) WPM · \d+% · (RATING \d+ · (GOLD|SILVER|BRONZE)|NO RATING)( · STREAK \d+)? · typer198x\.com$/;
await P.page.click("#btnModeCopy");
await sleep(300);
const d11 = await P.g(async () => ({ clip: await navigator.clipboard.readText(), toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent) }));
P.check("D11 share line matches the format; Copy puts it on the clipboard; toast SHARE LINE COPIED", c5.shareShown && RE.test(c5.share) && c5.share.includes("DAILY 2026-10-23 · S5 CHROME MONOLITH") &&
  d11.clip === c5.share && d11.toast.includes("SHARE LINE COPIED"), { share: c5.share, d11 });

// D11b (release review B-PERF-A11Y-1): on a short window the results card scrolls under the sticky Fly again / Menu bar;
// real Shift+Tab from Fly again to Copy and to the share line leaves each focused control wholly visible.
const d11b = {};
for (const [w, h] of [[1024, 600], [844, 390]]) {
  await P.page.setViewportSize({ width: w, height: h });
  await sleep(350);
  await P.g(() => { document.getElementById("screenModeResults").scrollTop = 0; document.getElementById("btnModeAgain").focus({ preventScroll: true }); });
  const seen = [];
  for (let i = 0; i < 2; i++) {
    await P.page.keyboard.press("Shift+Tab");
    await sleep(250);
    seen.push(await P.g(() => {
      const el = document.activeElement, r = el.getBoundingClientRect();
      let own = 0;
      for (let x = 0; x < 5; x++) for (let y = 0; y < 3; y++) { const e = document.elementFromPoint(r.left + r.width * (x + 0.5) / 5, r.top + r.height * (y + 0.5) / 3); if (e && (e === el || el.contains(e))) own++; }
      return `${el.id}:${own}`;
    }));
  }
  d11b[`${w}x${h}`] = seen;
}
await P.page.setViewportSize({ width: 1440, height: 900 });
await sleep(300);
await P.g(() => { document.getElementById("screenModeResults").scrollTop = 0; });
P.check("D11b 1024x600 and 844x390: Shift+Tab from Fly again focuses Copy, then the share line, each wholly visible above the sticky actions (15 / 15 points)",
  Object.values(d11b).every((s) => s.join() === "btnModeCopy:15,modeShareText:15"), d11b);

// D7 Fly again -> practice
await P.g(() => document.getElementById("btnModeAgain").focus());
await P.page.keyboard.press("Enter");
await waitMode(P, "playing", 4000);
const d7a = await P.g(() => ({ eyebrow: window.game.banner && window.game.banner.eyebrow, sub: window.game.banner && window.game.banner.sub, said: document.getElementById("srAnnounce").textContent }));
await waitFor(P, () => !window.game.levelIntro, 8000);
await P.g(() => window.game.modesDebug().finish("clear"));
await waitMode(P, "modeResults", 4000);
await sleep(200);
const c7 = await card(P);
const d7 = await P.g((k) => JSON.parse(localStorage.getItem(k)).modes.daily, "typesmup198x.save.v1");
P.check("D7 Fly again: card DAILY SORTIE · PRACTICE / 3 WAVES · NOT COUNTED, 'Practice, not counted.'; result PRACTICE · NOT COUNTED; day record unchanged; today.attempts 2; the share row shows the counted line; TODAY'S COUNTED SORTIE line",
  d7a.eyebrow === "DAILY SORTIE · PRACTICE" && d7a.sub === "3 WAVES · NOT COUNTED" && /Practice, not counted\./.test(d7a.said) && c7.head === "PRACTICE · NOT COUNTED" &&
  JSON.stringify(d7.days["20261023"]) === JSON.stringify(day) && d7.today.attempts === 2 && c7.shareShown && c7.share === c5.share && c7.lines.some((l) => /^TODAY'S COUNTED SORTIE · /.test(l)), { d7a, head: c7.head, lines: c7.lines, attempts: d7.today.attempts });

// D12 quit mid-sortie keeps the campaign run
await P.g(() => window.game.stopToMenu(false));
await waitMode(P, "menu", 3000);
await startMode(P, "daily");
await P.page.keyboard.press("Escape");
await waitMode(P, "paused", 3000);
await P.page.click("#btnPauseQuit");
await waitMode(P, "menu", 3000);
const d12a = await P.g((k) => ({ days: Object.keys(JSON.parse(localStorage.getItem(k)).modes.daily.days), attempts: JSON.parse(localStorage.getItem(k)).modes.daily.today.attempts,
  resume: !document.getElementById("resumeCard").classList.contains("hidden"), title: document.getElementById("resumeTitle").textContent }), "typesmup198x.save.v1");
await P.g(() => document.getElementById("btnContinue").click());
await waitMode(P, "playing", 8000);
const d12b = await P.g(() => ({ li: window.game.levelIndex, score: window.game.stats.score, mode: window.game.runMode() }));
P.check("D12 pause -> Quit to menu mid-sortie: menu, no record added, attempts unchanged, resume card Sector 3; Continue -> campaign levelIndex 2, score 6000",
  d12a.days.join() === "20261023" && d12a.attempts === 2 && d12a.resume && d12a.title === "Sector 3" && d12b.li === 2 && d12b.score === 6000 && d12b.mode === "campaign", { d12a, d12b });
await P.g(() => window.game.stopToMenu(true));
await waitMode(P, "menu", 3000);
const iso2 = await isolation(P);

// D8 + Q5: a counted death on the 24th at 100 % accuracy (rated): SIGNAL LOST, SILVER (capped), streak 2
await setNow(P, await localMs(P, 2026, 10, 24));
await startMode(P, "daily");
await typeWords(P, WORDS6, 150);
// Restart from pause on a counted attempt in progress confirms first; Keep flying keeps the attempt.
await P.page.keyboard.press("Escape");
await waitMode(P, "paused", 2000);
await P.page.click("#btnRestart");
await sleep(250);
const conf = await P.g(() => ({ title: document.getElementById("confirmTitle").textContent, body: document.getElementById("confirmBody").textContent, open: window.game.modalStack.length, ok: document.getElementById("btnConfirmOk").textContent, cancel: document.getElementById("btnConfirmCancel").textContent }));
await P.page.click("#btnConfirmCancel");
await sleep(200);
const kept = await P.g(() => ({ mode: window.game.mode, date: window.game._modes && window.game._modes.dateKey, n: window.game.typistSpeed("sector").n }));
await P.page.keyboard.press("Escape");
await waitMode(P, "playing", 2000);
P.check("D3b Restart on a counted attempt in progress asks 'Restart the sortie?' (Restart / Keep flying; the body says a finished or failed sortie counts, D9); Keep flying keeps the attempt (same run, same intervals)",
  conf.title === "Restart the sortie?" && conf.body === "This attempt ends without a result. Your next finished or failed sortie counts." && conf.open === 1 && conf.ok === "Restart" && conf.cancel === "Keep flying" && kept.mode === "paused" && kept.date === 20261024 && kept.n >= 20, { conf, kept });
await P.g(() => {
  const g = window.game;
  g.player.hp = 1; g.player.shield = 0; g.invulnT = 0;
  const en = new Enemy({ text: "leak", x: g.player.x + 30, y: g.laneYs()[2], speed: 0, lane: 2 });
  g.enemies.push(en);
});
const atOnce = await waitMode(P, "modeResults", 1500);
const c8 = await card(P);
await P.g(() => window.game.stopToMenu(false));
await sleep(200);
const d8 = await P.g((k) => ({ modes: JSON.parse(localStorage.getItem(k)).modes.daily, meta: document.getElementById("dailyMeta").textContent, status: document.getElementById("dailyStatus").textContent }), "typesmup198x.save.v1");
const lost = d8.modes.days["20261024"];
P.check("D8 death on 2026-10-24: results at once (no outro), SIGNAL LOST · lost in wave n/3, counted, days[20261024].result lost, streak.n 2, tile meta SORTIES 2 · STREAK 2 (no DAYS FLOWN on the tile)",
  atOnce && c8.title === "SIGNAL LOST" && /lost in wave [123]\/3$/.test(c8.text) && c8.head === "COUNTED SORTIE" && lost && lost.result === "lost" && d8.modes.streak.n === 2 &&
  d8.meta === "SORTIES 2 · STREAK 2" && !/DAYS FLOWN/.test(d8.meta), { c8: { title: c8.title, text: c8.text, head: c8.head, badge: c8.badge, lines: c8.lines }, lost, streak: d8.modes.streak, meta: d8.meta });
P.check("Q5 a sortie that ends in death caps at SILVER: 100 % accuracy (first days -> GOLD by accuracy) stamps SILVER, card line GOLD NEEDS A FINISHED SORTIE, tile FLOWN · SILVER",
  c8.result && c8.result.rating != null && c8.badge === "SILVER" && lost.medal === "SILVER" && c8.lines.includes("GOLD NEEDS A FINISHED SORTIE") && d8.status === "FLOWN · SILVER" && /Signal lost in wave/.test(c8.said),
  { rating: c8.result && c8.result.rating, acc: c8.result && c8.result.acc, badge: c8.badge, lines: c8.lines, status: d8.status });

// D9 pure medal cases (+ the Q5 cap on both paths)
const d9 = await P.g(() => {
  const m = (r, a, p, l) => modesMedalFor(r, a, p, l).medal;
  return [m(49, 95, [40, 42, 44, 46, 48]), m(42, 95, [40, 42, 44, 46, 48]), m(41, 95, [40, 42, 44, 46, 48]), m(60, 97, [50, 55]), m(60, 93, [50]), m(60, 92.9, []), m(null, 99, [40, 42, 44]),
    m(60, 99, [40, 42, 44], true), m(60, 99, [], true), m(30, 99, [40, 42, 44], true), JSON.stringify(modesMedalFor(49, 95, [40, 42, 44, 46, 48]).rule)];
});
P.check("D9 modesMedalFor: (49, 95, [40..48]) GOLD, 42 SILVER, 41 BRONZE, (60, 97, [50,55]) GOLD, (60, 93, [50]) SILVER, (60, 92.9, []) BRONZE, null -> null; lost: GOLD -> SILVER on both paths, BRONZE stays",
  d9.slice(0, 10).join() === "GOLD,SILVER,BRONZE,GOLD,SILVER,BRONZE,,SILVER,SILVER,BRONZE" && d9[10] === '{"median":44,"goldAt":49,"silverAt":42}', d9);

// D10 streak copy, never shaming
const NO_SHAME = /lost|broke|break|don'?t|miss/i;
const flyCounted = async (modes, y, mo, dd) => {
  await P.g((m) => { const g = window.game; g.save.modes = m; storeSave(g.save); }, modes);
  await setNow(P, await localMs(P, y, mo, dd));
  await startMode(P, "daily");
  await P.g(() => window.game.modesDebug().finish("clear"));
  await waitMode(P, "modeResults", 4000);
  const lines = (await card(P)).lines;
  await P.g(() => window.game.stopToMenu(false));
  await sleep(150);
  return { lines, meta: await P.g(() => document.getElementById("dailyMeta").textContent) };
};
const dayRec = (sector) => ({ sector, rating: 40, medal: "SILVER", speed: 45, acc: 95, result: "clear", t: 1 });
const s1 = await flyCounted({ v: 1, daily: { today: null, days: { 20261021: dayRec(5), 20261022: dayRec(4) }, flown: 2, streak: { n: 2, last: 20261022 } } }, 2026, 10, 23);
const s2 = await flyCounted({ v: 1, daily: { today: null, days: { 20261020: dayRec(5) }, flown: 1, streak: { n: 1, last: 20261020 } } }, 2026, 10, 23);
P.check("D10 days 21+22 then 23: SORTIES 3 · STREAK 3 (tile and card); day 20 only then 23: SORTIES 2, no STREAK; no meta / line matches /lost|broke|break|don't|miss/",
  s1.meta === "SORTIES 3 · STREAK 3" && s1.lines.includes("SORTIES 3 · STREAK 3") && s2.meta === "SORTIES 2" && s2.lines.includes("SORTIES 2") &&
  ![s1.meta, s2.meta, ...s1.lines, ...s2.lines].some((l) => NO_SHAME.test(l)), { s1, s2 });

// D13 midnight: the date is fixed at the start
await setNow(P, await localMs(P, 2026, 10, 25, 23, 59, 58));
await startMode(P, "daily", { waitGo: false });
await setNow(P, await localMs(P, 2026, 10, 26, 0, 0, 5));
await P.g(() => window.game.modesDebug().finish("clear"));
await waitMode(P, "modeResults", 4000);
const d13 = await P.g(() => Object.keys(window.game.save.modes.daily.days));
await P.g(() => window.game.stopToMenu(false));
P.check("D13 started 23:59:58 on the 25th, finished 00:00:05 on the 26th: recorded under 20261025", d13.includes("20261025") && !d13.includes("20261026"), d13);

// save.modes size after 61 injected days + a counted sortie
const big = {};
for (let k = 0; k < 61; k++) big[await P.g((n) => modesAddDays(20260801, n), k)] = { sector: 10, rating: 123, medal: "BRONZE", speed: 140, acc: 99.99, result: "clear", t: 1792856282916 };
const sz = await flyCounted({ v: 1, daily: { today: { date: 20261001, sector: 10, attempts: 9 }, days: big, flown: 61, streak: { n: 61, last: 20260930 } }, endless: { best: { ceiling: 180, timeMs: 9999999, peak: 199, acc: 99.9, t: 1792856282916 }, runs: 999 }, drill: { best: { speed: 150, acc: 99.9, t: 1792856282916 }, runs: 999 } }, 2026, 10, 27);
const size = await P.g((k) => { const m = JSON.parse(localStorage.getItem(k)).modes; return { len: JSON.stringify(m).length, days: Object.keys(m.daily.days).length, newest: Object.keys(m.daily.days).includes("20261027") }; }, "typesmup198x.save.v1");
P.check("save.modes after 61 injected days + one counted sortie: pruned to the newest 60 (today's kept), JSON.stringify(save.modes).length <= 8192", size.len <= 8192 && size.days === 60 && size.newest, { ...size, meta: sz.meta });

// D5b review fix: the printed accuracy never rounds up past an accuracy-medal threshold. 96.67 % (first days, no
// rated prior day in the window) is SILVER, so the card, the share line and the announcement say 96 %, not 97 %.
await setNow(P, await localMs(P, 2026, 10, 28));
await startMode(P, "daily");
await typeWords(P, WORDS6, 150);
await P.g(() => { const g = window.game; g.levelStats.correct = 290; g.levelStats.total = 300; g.modesDebug().finish("clear"); });
await waitMode(P, "modeResults", 4000);
await sleep(2600);
const c5b = await card(P);
await P.g(() => window.game.stopToMenu(false));
await sleep(150);
P.check("D5b 96.67 % accuracy in the first days: badge SILVER under BY ACCURACY · GOLD AT 97%, ACC tile 96%, share line · 96% ·, announce 'at 96 percent' (never a printed 97 % beside a SILVER)",
  c5b.result && c5b.result.acc === 96.67 && c5b.badge === "SILVER" && c5b.sub === "BY ACCURACY · GOLD AT 97% · SILVER AT 93%" && tileOf(c5b, "ACC") === "96%" && c5b.share.includes(" · 96% · RATING ") &&
  / at 96 percent\./.test(c5b.said), { acc: c5b.result && c5b.result.acc, badge: c5b.badge, sub: c5b.sub, acc_tile: tileOf(c5b, "ACC"), share: c5b.share, said: c5b.said });

const iso3 = await isolation(P);
P.check("isolation over the whole probe: campaign fields of the blob unchanged since the quit test (records, bests, unlocks, bestWpm, victories, run)", iso3.blob === iso2.blob && iso3.mem === iso2.mem, { same: iso3.blob === iso2.blob });

// D14 post-victory sectors and the locked fresh deck
await P.goto("legacy-postvictory");
await sleep(300);
const d14a = [];
for (let d = 1; d <= 12; d++) { await setNow(P, await localMs(P, 2026, 11, d)); d14a.push(await P.g(() => document.getElementById("dailySector").textContent.slice(7, 9))); }
await P.goto(null);
await sleep(300);
const d14b = await P.g(() => {
  const fits = (id) => { const el = document.getElementById(id); return el.scrollWidth <= el.clientWidth + 1; };
  return { aria: document.getElementById("btnDaily").getAttribute("aria-disabled"), status: document.getElementById("dailyStatus").textContent, drill: document.getElementById("btnDrill").getAttribute("aria-disabled"),
    endless: document.getElementById("btnEndless").getAttribute("aria-disabled"), drillSub: document.getElementById("drillSub").textContent, endlessSub: document.getElementById("endlessSub").textContent,
    fit: fits("drillSub") && fits("endlessSub") && fits("dailyStatus") };
});
await P.page.click("#btnDaily", { force: true });   // aria-disabled tiles stay focusable and clickable (they explain why)
await P.page.click("#btnDrill", { force: true });
await sleep(500);
const d14c = await P.g(() => ({ mode: window.game.mode, modes: window.game._modes || null, run: window.game.runMode() }));
P.check("D14 legacy-postvictory (U 10): the daily sector is 08 / 09 / 10 on 12 dates; fresh save: tiles aria-disabled, the daily status and both practice tiles say START A RUN TO UNLOCK (untruncated; review CT-B10), clicks leave mode menu",
  d14a.every((s) => ["08", "09", "10"].includes(s)) && new Set(d14a).size >= 2 && d14b.aria === "true" && d14b.drill === "true" && d14b.endless === "true" && d14b.status === "START A RUN TO UNLOCK" &&
  d14b.drillSub === "START A RUN TO UNLOCK" && d14b.endlessSub === "START A RUN TO UNLOCK" && d14b.fit && d14c.mode === "menu" && d14c.modes === null && d14c.run === "campaign", { d14a, d14b, d14c });

checkErrors(P);
await P.finish();

