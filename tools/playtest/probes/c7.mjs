// C7 acceptance: mobile play path (hidden #typeInput, tap-to-type pill, keyboard evidence) and the phone profile.
// Usage: cd tools/playtest && node probes/c7.mjs
import { devices } from "playwright";
import { openProbe, sleep } from "./_lib.mjs";

const P = await openProbe("c7");
const overlayGone = (pg) => pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });

async function open(opts) {
  const ctx = await P.browser.newContext(opts);
  await ctx.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} }, "typesmup198x.save.v1");
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.goto(P.base, { waitUntil: "load" });
  await overlayGone(pg);
  return { ctx, pg, errs };
}
async function start(pg, tap = false) {
  await pg.fill("#playerName", "C7").catch(() => {});
  if (tap) await pg.locator("#btnStart").tap({ force: true }); else await pg.click("#btnStart");
  const story = pg.locator("#btnStoryLaunch");
  try { await story.waitFor({ state: "visible", timeout: 2500 }); if (tap) await story.tap({ force: true }); else await story.click(); } catch {}
  await pg.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });
}
const nextEnemyKey = (pg) => pg.evaluate(() => { const g = window.game; const pool = g.enemies.filter((e) => e.alive && !e.dying && g.isTargetable(e)).sort((a, b) => a.x - b.x); return pool.length ? pool[0].nextChar() : null; });
const waitEnemy = (pg) => pg.waitForFunction(() => { const g = window.game; return !g.levelIntro && g.enemies.some((e) => e.alive && g.isTargetable(e)); }, null, { timeout: 20000 }).catch(() => {});

// --- desktop: keyboard path unchanged, touchMode false, pill never shows ---------------------------------
{
  const { ctx, pg, errs } = await open({ viewport: { width: 1440, height: 900 } });
  P.check("desktop: #keyboardHint removed from the DOM", await pg.evaluate(() => document.getElementById("keyboardHint") === null && document.getElementById("btnKeyboardHint") === null));
  P.check("desktop: #typeInput present, never display:none, 16 px font", await pg.evaluate(() => { const el = document.getElementById("typeInput"); const cs = getComputedStyle(el); return !!el && cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.fontSize) === 16; }));
  await start(pg);
  await waitEnemy(pg);
  const before = await pg.evaluate(() => ({ total: window.game.stats.total, correct: window.game.stats.correct, kills: window.game.stats.kills }));
  const k = await nextEnemyKey(pg);
  if (k) await pg.keyboard.press(k);
  await sleep(100);
  const d = await pg.evaluate(() => ({ total: window.game.stats.total, correct: window.game.stats.correct, kills: window.game.stats.kills, lock: !!window.game.lock, touchMode: window.game.touchMode, keyboardSeen: window.game.keyboardSeen, active: document.activeElement.id }));
  P.check("desktop: keyboard press counts a correct key (lock or single-letter kill); touchMode false after the first letter", k && d.total === before.total + 1 && d.correct === before.correct + 1 && (d.lock || d.kills > before.kills) && d.touchMode === false && d.keyboardSeen === true && d.active === "game", JSON.stringify({ k, ...d }));
  await sleep(1500);
  P.check("desktop: .tapToType never visible", await pg.evaluate(() => { const el = document.getElementById("tapToType"); return el.classList.contains("hidden") && getComputedStyle(el).display === "none"; }));
  // Space releases the lock
  await pg.keyboard.press("Space");
  await sleep(50);
  P.check("desktop: Space releases the lock", await pg.evaluate(() => window.game.lock === null));
  P.check("desktop: no page errors", errs.length === 0, errs.join("; "));
  await ctx.close();
}

// --- mobile (iPhone 13): pill, tap focus, insertText typing, backspace release ------------------------
{
  const { ctx, pg, errs } = await open({ ...devices["iPhone 13"] });
  P.check("mobile: touchMode true at boot", await pg.evaluate(() => window.game.touchMode === true));
  await start(pg, true);
  const t0 = Date.now();
  const pillShown = await pg.waitForFunction(() => { const el = document.getElementById("tapToType"); return !el.classList.contains("hidden") && getComputedStyle(el).display !== "none"; }, null, { timeout: 2000 }).then(() => true).catch(() => false);
  P.check("mobile: .tapToType visible within 2 s of entering play without a keypress", pillShown, `${Date.now() - t0} ms`);
  await pg.screenshot({ path: `${P.out}/mobile-pill.png` });
  const cr = await pg.evaluate(() => { const r = document.getElementById("game").getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.6 }; });
  await pg.touchscreen.tap(cr.x, cr.y);
  await sleep(150);
  const afterTap = await pg.evaluate(() => ({ active: document.activeElement.id, pillHidden: document.getElementById("tapToType").classList.contains("hidden"), typing: document.getElementById("main").classList.contains("is-typing") }));
  P.check("mobile: tap -> #typeInput focused and the pill hidden", afterTap.active === "typeInput" && afterTap.pillHidden, JSON.stringify(afterTap));
  await waitEnemy(pg);
  const b0 = await pg.evaluate(() => ({ total: window.game.stats.total, correct: window.game.stats.correct, kills: window.game.stats.kills }));
  const k = await nextEnemyKey(pg);
  await pg.evaluate(() => { const el = document.getElementById("typeInput"); if (document.activeElement !== el) el.focus({ preventScroll: true }); });
  if (k) await pg.keyboard.insertText(k);
  await sleep(120);
  const m = await pg.evaluate(() => ({ total: window.game.stats.total, correct: window.game.stats.correct, kills: window.game.stats.kills, lock: !!(window.game.lock && window.game.lock.ref), lockChar: window.game.lock && window.game.lock.ref && window.game.lock.ref.text, value: document.getElementById("typeInput").value, touchMode: window.game.touchMode, active: document.activeElement.id }));
  P.check("mobile: insertText increments stats.total, hits the matching enemy (lock or kill); field stays empty", k && m.total === b0.total + 1 && m.correct === b0.correct + 1 && (m.lock || m.kills > b0.kills) && m.value === "" && m.touchMode === true, JSON.stringify({ k, ...m }));
  // full-width letter folds (NFKD), uppercase lowers
  const k2 = await pg.evaluate(() => window.game.lock && window.game.lock.ref ? window.game.lock.ref.nextChar() : null);
  if (k2) {
    const fw = String.fromCharCode(0xFF21 + (k2.charCodeAt(0) - 97)); // fullwidth capital
    const before = await pg.evaluate(() => window.game.stats.correct);
    await pg.keyboard.insertText(fw);
    await sleep(80);
    P.check("mobile: full-width capital folds to a-z and counts as correct", (await pg.evaluate(() => window.game.stats.correct)) === before + 1, `${fw} -> ${k2}`);
  } else P.note("mobile: full-width fold", "no lock to type into");
  // backspace releases the lock (deleteContentBackward via beforeinput)
  await pg.evaluate(() => { const el = document.getElementById("typeInput"); el.focus(); el.dispatchEvent(new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true })); });
  await sleep(50);
  P.check("mobile: deleteContentBackward releases the lock", await pg.evaluate(() => window.game.lock === null));
  // composition path: input event with insertCompositionText feeds the appended characters
  await waitEnemy(pg);
  const k3 = await nextEnemyKey(pg);
  if (k3) {
    const tot = await pg.evaluate(() => window.game.stats.total);
    await pg.evaluate((ch) => { const el = document.getElementById("typeInput"); el.focus(); el.value = ch; el.dispatchEvent(new InputEvent("input", { inputType: "insertCompositionText", data: ch, bubbles: true })); el.dispatchEvent(new CompositionEvent("compositionend", { data: ch, bubbles: true })); }, k3);
    await sleep(60);
    P.check("mobile: composition text is consumed on input and the field cleared on compositionend", await pg.evaluate((t) => window.game.stats.total === t + 1 && document.getElementById("typeInput").value === "", tot), k3);
  } else P.note("mobile: composition path", "no enemy to type");
  // blur re-shows the pill while playing
  await pg.evaluate(() => document.getElementById("typeInput").blur());
  const reshown = await pg.waitForFunction(() => !document.getElementById("tapToType").classList.contains("hidden"), null, { timeout: 1500 }).then(() => true).catch(() => false);
  P.check("mobile: pill re-shown after #typeInput blur", reshown);
  P.check("mobile: coarse-pointer targets: .btn-arcade min-height 44, top controls >= 40", await pg.evaluate(() => parseFloat(getComputedStyle(document.getElementById("btnResume")).minHeight) >= 44 && document.getElementById("btnMute").getBoundingClientRect().height >= 40));
  await pg.screenshot({ path: `${P.out}/mobile-play.png` });
  P.check("mobile: no page errors", errs.length === 0, errs.join("; "));
  await ctx.close();
}

// --- phone landscape 844x390: phone lane profile + glyph size --------------------------------------------
{
  const { ctx, pg, errs } = await open({ ...devices["iPhone 13 landscape"], viewport: { width: 844, height: 390 } });
  await start(pg, true);
  await waitEnemy(pg);
  const prof = await pg.evaluate(() => {
    const g = window.game;
    const lanes = typeof g.laneYs === "function" ? g.laneYs() : (g.cssScale < 0.55 && typeof LANE_PROFILE_PHONE !== "undefined" ? LANE_PROFILE_PHONE.laneYs : LANE_YS);
    const fontPx = typeof g.plateFontPx === "function" ? g.plateFontPx() : null;
    const hud = parseFloat(getComputedStyle(document.querySelector(".hudCell .mono")).fontSize);
    const label = parseFloat(getComputedStyle(document.querySelector(".hudCell .label")).fontSize);
    return { cssScale: g.cssScale, lanes: lanes.length, fontPx, glyphCss: fontPx ? fontPx * g.cssScale : null, hud, label, canvasW: document.getElementById("game").clientWidth };
  });
  P.check("844x390: cssScale < .55 -> four lanes", prof.cssScale < 0.55 && prof.lanes === 4, JSON.stringify(prof));
  P.check("844x390: smallest plate glyph >= 14 CSS px (plate font x cssScale)", prof.glyphCss !== null && prof.glyphCss >= 14, JSON.stringify({ fontPx: prof.fontPx, glyphCss: prof.glyphCss && Math.round(prof.glyphCss * 10) / 10 }));
  P.check("844x390: HUD text >= 10 CSS px", prof.hud >= 10 && prof.label >= 10, JSON.stringify({ hud: prof.hud, label: prof.label }));
  await pg.screenshot({ path: `${P.out}/landscape-play.png` });
  P.check("844x390: no page errors", errs.length === 0, errs.join("; "));
  await ctx.close();
}

await P.finish();
