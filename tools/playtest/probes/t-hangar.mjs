// CAREER hangar probe: the three unlockable hulls (14-hangar.js hangarRefresh, SHIP_CONFIGS unlock, THRUSTER_OFFSET rows).
//   1. fresh save: 7 ship cards; paprika / nightjar / moonpie are .is-locked with a disabled, unfocusable radio, the
//      "Unlocks after N clear(s)" line visible and the hull's description as the card title; the four originals stay
//      selectable (clicking Sofrito saves it, clicking a locked card changes nothing) and the radio group's arrow keys
//      never land on a locked radio.
//   2. save.career = { clears: 5 } + hangarRefresh({ newlyUnlocked: ["paprika", "nightjar"] }): Paprika and Nightjar
//      unlock with .is-new, Moonpie stays locked; a plain hangarRefresh() clears .is-new.
//   3. select Paprika and start a run: player.shipId / run.shipId "paprika", ships/paprika resident, the ship pose has
//      two nozzles; every THRUSTER_OFFSET nozzle of the three new hulls lands on an opaque pixel of its x1 WebP with
//      transparency just behind it (the plume leaves the rear lip), and the muzzle column touches the nose.
//   4. pause -> quit to menu runs hangarRefresh again (modeChange hook).
//   5. an edited save (selectedShip "moonpie", locked, no run) + reload falls back to coconut: save, radio, title ship.
// Usage: cd tools/playtest && node probes/t-hangar.mjs
import { openProbe, sleep, LS_KEY, harnessFlags } from "./_lib.mjs";

const P = await openProbe("t-hangar");
const { page } = P;
const LOCKED_FRESH = ["paprika", "nightjar", "moonpie"];
const ORIGINALS = ["coconut", "little-dark-one", "sofrito", "honeybee"];

const readCards = () => P.g(() => [...document.querySelectorAll(".shipCard")].map((card) => {
  const input = card.querySelector("input[name='shipChoice']");
  const lock = card.querySelector(".shipLock");
  let focusable = false;
  if (input) { input.focus(); focusable = document.activeElement === input; input.blur(); }
  return {
    id: input ? input.value : "", unlock: card.dataset.shipUnlock || null, locked: card.classList.contains("is-locked"), isNew: card.classList.contains("is-new"),
    disabled: !!(input && input.disabled), ariaDisabled: input ? input.getAttribute("aria-disabled") : null, focusable, checked: !!(input && input.checked),
    title: card.getAttribute("title") || "", lockText: lock ? lock.textContent.trim() : null, lockShown: lock ? getComputedStyle(lock).display !== "none" : false,
    img: (card.querySelector("img[data-ship-id]") || {}).getAttribute ? card.querySelector("img[data-ship-id]").getAttribute("src") : "",
    filter: getComputedStyle(card.querySelector(".shipCardInner")).filter, cursor: getComputedStyle(card).cursor
  };
}));

// ---------------------------------------------------------------- 1. fresh save
await P.goto(null);
await sleep(300);
let cards = await readCards();
const byId = (list, id) => list.find((c) => c.id === id);
P.check("7 ship cards: 4 originals without data-ship-unlock, paprika 1 / nightjar 5 / moonpie 12", cards.length === 7 && ORIGINALS.every((id) => byId(cards, id) && byId(cards, id).unlock === null) && byId(cards, "paprika").unlock === "1" && byId(cards, "nightjar").unlock === "5" && byId(cards, "moonpie").unlock === "12", cards.map((c) => `${c.id}:${c.unlock}`));
P.check("fresh save: the three career hulls are .is-locked, radio disabled + aria-disabled, unfocusable, grayscale, not-allowed cursor", LOCKED_FRESH.every((id) => { const c = byId(cards, id); return c.locked && c.disabled && c.ariaDisabled === "true" && !c.focusable && /grayscale/.test(c.filter) && c.cursor === "not-allowed"; }), LOCKED_FRESH.map((id) => { const c = byId(cards, id); return { id: c.id, locked: c.locked, disabled: c.disabled, focusable: c.focusable, filter: c.filter, cursor: c.cursor }; }));
P.check("fresh save: the four originals are unlocked, enabled and focusable; coconut checked", ORIGINALS.every((id) => { const c = byId(cards, id); return !c.locked && !c.disabled && c.focusable; }) && byId(cards, "coconut").checked, ORIGINALS.map((id) => { const c = byId(cards, id); return { id, locked: c.locked, disabled: c.disabled, focusable: c.focusable, checked: c.checked }; }));
P.check("lock line visible only on locked cards with singular / plural copy; card title carries the description", byId(cards, "paprika").lockShown && byId(cards, "paprika").lockText === "Unlocks after 1 clear" && byId(cards, "nightjar").lockText === "Unlocks after 5 clears" && byId(cards, "moonpie").lockText === "Unlocks after 12 clears" && ORIGINALS.every((id) => byId(cards, id).lockText === null) && /impossible to lose/.test(byId(cards, "paprika").title) && /hear it coming/.test(byId(cards, "nightjar").title) && /diner at midnight/.test(byId(cards, "moonpie").title), LOCKED_FRESH.map((id) => ({ id, shown: byId(cards, id).lockShown, text: byId(cards, id).lockText })));
P.check("career card images hydrated from the manifest x1 WebP", LOCKED_FRESH.every((id) => new RegExp(`ships/${id}@1x\\.webp\\?v=`).test(byId(cards, id).img)), LOCKED_FRESH.map((id) => byId(cards, id).img.replace(/^.*\/assets/, "assets")));
const hangar0 = await P.g(() => ({ clears: window.game.hangarClears(), state: window.game._hangar, lockedFn: ["paprika", "nightjar", "moonpie", "coconut"].map((id) => window.game.hangarShipLocked(id)) }));
P.check("hangarClears() 0 without save.career; _hangar lists the three locked ids; hangarShipLocked() agrees", hangar0.clears === 0 && hangar0.state && hangar0.state.locked.join() === LOCKED_FRESH.join() && hangar0.state.unlocked.length === 0 && hangar0.lockedFn.join() === "true,true,true,false", hangar0);
await P.g(() => document.querySelector(".shipGrid").scrollIntoView({ block: "center" }));
await P.shot("hangar-locked");

// clicks: an original selects, a locked card does nothing
await page.click(".shipCard:has(input[value='sofrito'])");
await sleep(120);
await page.click(".shipCard:has(input[value='nightjar'])", { force: true });
await sleep(120);
const sel1 = await P.g(() => ({ saved: window.game.save.selectedShip, checked: [...document.querySelectorAll("input[name='shipChoice']")].filter((i) => i.checked).map((i) => i.value), stored: JSON.parse(localStorage.getItem("typesmup198x.save.v1")).selectedShip }));
P.check("clicking Sofrito selects and stores it; clicking the locked Nightjar changes nothing", sel1.saved === "sofrito" && sel1.stored === "sofrito" && sel1.checked.join() === "sofrito", sel1);

// arrow keys inside the radio group skip the disabled radios
await page.focus("input[name='shipChoice'][value='sofrito']");
const visited = [];
for (let i = 0; i < 8; i++) {
  await page.keyboard.press("ArrowDown");
  visited.push(await P.g(() => (document.activeElement && document.activeElement.name === "shipChoice") ? document.activeElement.value : "(" + (document.activeElement && document.activeElement.id || document.activeElement.tagName) + ")"));
}
P.check("ArrowDown cycles the four originals only (locked radios skipped)", visited.every((v) => ORIGINALS.includes(v)) && new Set(visited).size === 4, visited.join(" > "));
await page.click(".shipCard:has(input[value='coconut'])");
await sleep(100);

// ---------------------------------------------------------------- 2. five clears
const un = await P.g(() => {
  const g = window.game;
  g.save.career = { clears: 5 };
  const r = g.hangarRefresh({ newlyUnlocked: ["paprika", "nightjar"] });
  return { r, clears: g.hangarClears() };
});
cards = await readCards();
P.check("clears 5 + hangarRefresh({newlyUnlocked}): paprika / nightjar unlocked, enabled, focusable, .is-new; moonpie locked", un.clears === 5 && un.r.unlocked.join() === "paprika,nightjar" && un.r.locked.join() === "moonpie" && !un.r.fallback && ["paprika", "nightjar"].every((id) => { const c = byId(cards, id); return !c.locked && !c.disabled && c.focusable && c.isNew && !c.lockShown; }) && byId(cards, "moonpie").locked && byId(cards, "moonpie").disabled && !byId(cards, "moonpie").isNew, { r: un.r, cards: cards.filter((c) => c.unlock).map((c) => ({ id: c.id, locked: c.locked, isNew: c.isNew, disabled: c.disabled })) });
await sleep(350);   // .shipCardInner transitions border-color over --dur-2
const pill = await P.g(() => { const inner = document.querySelector(".shipCard.is-new .shipCardInner"); const cs = getComputedStyle(inner, "::after"); return { content: cs.content, bg: cs.backgroundColor, border: getComputedStyle(inner).borderTopColor }; });
P.check("the NEW pill renders on an unlocked card (amber ring + pill)", /NEW/.test(pill.content) && pill.bg === "rgb(255, 193, 74)" && pill.border === "rgb(255, 193, 74)", pill);
await P.shot("hangar-unlocked-new");
const cleared = await P.g(() => { window.game.hangarRefresh(); return [...document.querySelectorAll(".shipCard.is-new")].length; });
P.check("a plain hangarRefresh() clears .is-new", cleared === 0, cleared);

// ---------------------------------------------------------------- 3. fly the Paprika
await page.click(".shipCard:has(input[value='paprika'])");
await sleep(150);
const selP = await P.g(() => ({ saved: window.game.save.selectedShip, title: window.game.player.shipId }));
P.check("Paprika selectable once unlocked (save.selectedShip, title ship swaps)", selP.saved === "paprika" && selP.title === "paprika", selP);
await P.startRun("HANGAR");
await sleep(600);
const run = await P.g(() => {
  const g = window.game;
  const geo = g.shipGeometry();
  const pose = g._shipPose;
  return { mode: g.mode, shipId: g.player.shipId, runShip: g.run && g.run.shipId, key: geo.key, resident: TypeRAssets.stats().resident.includes("ships/paprika"), sprite: !!(pose && pose.sprite), nozzles: pose ? pose.nozzles.length : -1, w: Math.round(geo.w), h: Math.round(geo.h), muzzleRight: pose ? pose.muzzle.x > pose.nozzles[0].x + geo.w * 0.8 : false };
});
P.check("run with the Paprika: player / run shipId paprika, sprite resident and baked, two plume nozzles, muzzle at the nose", run.mode === "playing" && run.shipId === "paprika" && run.runShip === "paprika" && run.key === "ships/paprika" && run.resident && run.sprite && run.nozzles === 2 && run.muzzleRight, run);
P.check("Paprika draws at the originals' size (trimmed ~129 x 71 logical px in the 168 px box)", run.w >= 120 && run.w <= 135 && run.h >= 60 && run.h <= 80, { w: run.w, h: run.h });
await P.shot("run-paprika");

// nozzle rows land on the hull: sample the x1 WebP at each THRUSTER_OFFSET fraction (opaque at the nozzle, clear just behind it)
const noz = await P.g(async () => {
  const out = {};
  for (const id of ["paprika", "nightjar", "moonpie"]) {
    const off = THRUSTER_OFFSET[id];
    const img = new Image();
    img.src = TypeRAssets.url("ships/" + id, "x1");
    await img.decode();
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const alphaAt = (fx, fy) => g.getImageData(Math.min(c.width - 1, Math.max(0, Math.round(fx * c.width))), Math.min(c.height - 1, Math.max(0, Math.round(fy * c.height))), 1, 1).data[3];
    const col = g.getImageData(Math.min(c.width - 1, Math.round(off.muzzleFx * c.width)), 0, 1, c.height).data;
    let muzzleHit = 0; for (let y = 0; y < c.height; y++) if (col[y * 4 + 3] > 128) muzzleHit++;
    out[id] = { w: c.width, h: c.height, nozzles: off.nozzles.map((n) => ({ fx: n.fx, fy: n.fy, a: alphaAt(n.fx, n.fy), behind: alphaAt(0, n.fy) })), muzzleFx: off.muzzleFx, muzzleHit };
  }
  return out;
});
P.check("THRUSTER_OFFSET: every nozzle of the three new hulls is on an opaque pixel of its x1 WebP, transparent at the trim edge behind it; the muzzle column touches the nose", Object.values(noz).every((s) => s.nozzles.every((n) => n.a > 128 && n.behind === 0) && s.muzzleHit > 0), noz);

// ---------------------------------------------------------------- 4. back to the menu: the modeChange hook refreshes
const before = await P.g(() => window.game._hangar.refreshes);
await page.keyboard.press("Escape");
await sleep(300);
await page.click("#btnPauseQuit");
await sleep(400);
const after = await P.g(() => ({ mode: window.game.mode, refreshes: window.game._hangar.refreshes, locked: window.game._hangar.locked, saved: window.game.save.selectedShip }));
P.check("quit to menu runs hangarRefresh again (modeChange hook), selection kept", after.mode === "menu" && after.refreshes > before && after.locked.join() === "moonpie" && after.saved === "paprika", { before, ...after });

// ---------------------------------------------------------------- 5. a locked selection in the save falls back at boot
// (a fresh context seeded with the edited save: the probe context's init script clears the save on every navigation)
{
  const edited = await P.saveBlob();
  edited.selectedShip = "moonpie"; edited.career = { clears: 5 }; edited.run = null;
  const ctx = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await harnessFlags(ctx, { flightCheck: "skip", sw: false });
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, [LS_KEY, edited]);
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => P.errors.pageErrors.push("[fallback-context] " + String(e && e.stack || e)));
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden"); }, null, { timeout: 60000 });
  await sleep(400);
  const fb = await pg.evaluate((k) => ({ saved: window.game.save.selectedShip, stored: JSON.parse(localStorage.getItem(k)).selectedShip, title: window.game.player.shipId, checked: [...document.querySelectorAll("input[name='shipChoice']")].filter((i) => i.checked).map((i) => i.value), fallback: window.game._hangar && window.game._hangar.fallback, clears: window.game.hangarClears(), moonpieLocked: document.querySelector(".shipCard:has(input[value='moonpie'])").classList.contains("is-locked") }), LS_KEY);
  P.check("boot with selectedShip = moonpie (locked): falls back to coconut in the save, the stored save, the radios and the title ship", fb.saved === "coconut" && fb.stored === "coconut" && fb.title === "coconut" && fb.checked.join() === "coconut" && fb.fallback === true && fb.moonpieLocked, fb);
  await pg.evaluate(() => document.querySelector(".shipGrid").scrollIntoView({ block: "center" }));
  await pg.screenshot({ path: P.out + "/06-hangar-after-fallback.png" });
  await ctx.close();
}

await P.finish();
