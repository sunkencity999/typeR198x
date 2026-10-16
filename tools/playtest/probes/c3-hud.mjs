// C3 acceptance probe: HUD (hull meter, chips, multiplier badge, boss meter, mode-aware opacity, two-row layout).
// Usage: cd tools/playtest && node probes/c3-hud.mjs
import { openProbe, sleep } from "./_lib.mjs";
import { chromium } from "playwright";

const P = await openProbe("c3");
const { page } = P;

await P.goto(null);
const menuOpacity = await P.g(() => getComputedStyle(document.getElementById("hud")).opacity);
P.check("menu: #hud computed opacity 0", menuOpacity === "0", `opacity=${menuOpacity}`);
const menuChrome = await P.g(() => ({ pause: getComputedStyle(document.getElementById("btnPause")).display, stop: getComputedStyle(document.getElementById("btnStop")).display }));
P.check("menu: #btnPause/#btnStop display none", menuChrome.pause === "none" && menuChrome.stop === "none", JSON.stringify(menuChrome));

await P.startRun("C3");
await page.waitForFunction(() => window.game && !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
await sleep(400);

// Idle HUD hygiene: no typing, no damage for 2 s -> fewer than 12 DOM mutations under #hud.
await P.g(() => { window.game.invulnT = 1000; });
const mutations = await P.g(() => new Promise((resolve) => {
  let n = 0;
  const obs = new MutationObserver((list) => { n += list.length; });
  obs.observe(document.getElementById("hud"), { childList: true, characterData: true, attributes: true, subtree: true });
  setTimeout(() => { obs.disconnect(); resolve(n); }, 2000);
}));
P.check("idle wave: < 12 HUD mutations over 2 s", mutations < 12, `mutations=${mutations}`);

// Hull at 20 %: data-hp crit and the fill transform at scaleX(.2) (transition 120 ms, so read after it settles).
const crit = await P.g(async () => {
  const g = window.game;
  g.player.hp = g.player.maxHp * 0.2;
  g.updateHUD();
  await new Promise((r) => setTimeout(r, 260));
  const fill = document.getElementById("hudHPFill");
  return { hp: document.getElementById("hud").dataset.hp, transform: getComputedStyle(fill).transform, anim: getComputedStyle(fill).animationName };
});
P.check("hp .2 -> #hud[data-hp=crit] and #hudHPFill matrix(0.2…)", crit.hp === "crit" && /^matrix\(0\.2(0*|\d*),/.test(crit.transform), JSON.stringify(crit));
P.check("crit fill pulses (hpPulse) when motion is allowed", crit.anim === "hpPulse", crit.anim);
await P.g(() => { const g = window.game; g.player.hp = g.player.maxHp; g.updateHUD(); });

// Multiplier badge: combo 100 with MULTI active reads x7 and keeps the tier-5 look.
const mult = await P.g(() => {
  const g = window.game;
  g.stats.combo = 100; g.power.multiplier = 5; g._baseTier = 1; g.bumpMultiplier(); g.updateHUD();
  const el = document.getElementById("hudMult");
  return { text: el.textContent, tier: el.dataset.tier, mult: g.stats.mult };
});
P.check("combo 100 + MULTI -> #hudMult 'x7' with data-tier 5", mult.text === "x7" && mult.tier === "5", JSON.stringify(mult));
await P.g(() => { const g = window.game; g.power.multiplier = 0; g.stats.combo = 0; g.bumpMultiplier(); });

// Shield chip lifecycle: --p ~1 on pickup, .expiring at 7.1 s, gone by 9.3 s.
await P.g(() => {
  const g = window.game;
  g.player.shield = 0;
  const p = g.spawnPowerup({ type: "SHIELD", x: 640, y: 320, fromKill: true });
  g.collectPowerup(p);
  g.updateHUD();
});
const chip0 = await P.g(() => {
  const c = document.querySelector('#hudChips .chip[data-type="shield"]');
  return c ? { exists: true, p: Number(c.style.getPropertyValue("--p")), icon: !!c.querySelector(".chipIcon svg"), ring: getComputedStyle(c, "::before").backgroundImage.includes("conic-gradient") } : { exists: false };
});
P.check("SHIELD pickup -> chip exists with --p .95..1, inline SVG icon and a conic ring", chip0.exists && chip0.p >= 0.95 && chip0.p <= 1 && chip0.icon && chip0.ring, JSON.stringify(chip0));
await P.shot("hud-chip");
await sleep(7100);
const chip7 = await P.g(() => { const c = document.querySelector('#hudChips .chip[data-type="shield"]'); return c ? { exists: true, expiring: c.classList.contains("expiring"), shield: window.game.player.shield } : { exists: false }; });
P.check("shield chip .expiring at 7.1 s", chip7.exists && chip7.expiring, JSON.stringify(chip7));
await sleep(2200);
const chip9 = await P.g(() => !!document.querySelector('#hudChips .chip[data-type="shield"]'));
P.check("shield chip gone at 9.3 s", chip9 === false, `exists=${chip9}`);

// Boss meter at L1: scaleX matrix, --segments 6, ticks 2, data-state p1.
await P.forceBoss();
await page.waitForFunction(() => { const g = window.game; return g.inBoss && !(g.bossIntro && g.bossIntro.locked); }, null, { timeout: 15000 }).catch(() => {});
await sleep(200);
const boss1 = await P.g(() => {
  const m = document.getElementById("bossMeter"), f = document.getElementById("bossFill");
  return { transform: getComputedStyle(f).transform, width: getComputedStyle(f).width === getComputedStyle(m).width || getComputedStyle(f).width, segments: m.style.getPropertyValue("--segments").trim(), ticks: m.querySelectorAll(".bossPhaseTick").length, state: m.dataset.state, segText: document.getElementById("bossSegment").textContent, phaseText: document.getElementById("bossPhase").textContent };
});
P.check("L1 boss: #bossFill transform is a scaleX matrix and --segments '6'", /^matrix\(/.test(boss1.transform) && boss1.segments === "6", JSON.stringify(boss1));
P.check("L1 boss: 2 phase ticks, SEG k/6 and PHASE 1/3 text", boss1.ticks === 2 && /^SEG \d+\/6$/.test(boss1.segText) && /^PHASE 1\/3$/.test(boss1.phaseText), JSON.stringify(boss1));
await P.shot("hud-boss");

// Boss meter at L10: 42 segments -> --segments 4, 3 phase ticks.
await P.g(() => { const g = window.game; if (typeof g.startSector === "function") g.startSector(9); else g.startLevel(9, { fromMenu: true, fresh: true }); });
await sleep(300);
await P.forceBoss();
await page.waitForFunction(() => { const g = window.game; return g.inBoss && g.levelIndex === 9; }, null, { timeout: 15000 }).catch(() => {});
await sleep(200);
const boss10 = await P.g(() => { const m = document.getElementById("bossMeter"); return { segments: m.style.getPropertyValue("--segments").trim(), ticks: m.querySelectorAll(".bossPhaseTick").length, n: window.game.boss && window.game.boss.segments.length }; });
P.check("L10 boss: --segments '4' and 3 phase ticks", boss10.segments === "4" && boss10.ticks === 3, JSON.stringify(boss10));

P.check("no page errors", P.errors.pageErrors.length === 0, JSON.stringify(P.errors.pageErrors));

// 900x700: HUD overlaid on the canvas in two rows.
{
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });
  await pg.fill("#playerName", "C3").catch(() => {});
  await pg.click("#btnStart");
  const story = pg.locator("#btnStoryLaunch");
  try { await story.waitFor({ state: "visible", timeout: 2500 }); await story.click(); } catch {}
  await pg.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });
  await sleep(2500);
  const layout = await pg.evaluate(() => {
    const hud = document.getElementById("hud").getBoundingClientRect();
    const main = document.getElementById("main").getBoundingClientRect();
    const cells = [...document.querySelectorAll("#hud .hudCell")].filter((c) => c.offsetParent !== null).map((c) => Math.round(c.getBoundingClientRect().top));
    const rows = new Set(cells).size;
    const wpm = getComputedStyle(document.querySelector(".hudCell--wpm")).display;
    return { hudTop: hud.top, hudBottom: hud.bottom, mainTop: main.top, mainBottom: main.bottom, rows, wpm };
  });
  const file = await (async () => { const f = P.out + "/99-hud-900x700.png"; await pg.screenshot({ path: f }); return f; })();
  P.check("900x700: HUD overlaid inside #main in >= 2 rows, WPM cell hidden", layout.hudTop >= layout.mainTop && layout.hudBottom < layout.mainBottom && layout.rows >= 2 && layout.wpm === "none", JSON.stringify(layout) + " " + file);
  await browser.close();
}

await P.finish();
