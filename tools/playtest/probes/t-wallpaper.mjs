// t-wallpaper (Career pass, 58-wallpaper.js): the commendation wallpaper. (a) with a fresh save and a faked save.career
// (3 clears) renderCareerWallpaper resolves to a 2560x1440 canvas whose centre strip is not one colour and whose
// bottom-left text block has bright pixels; the phone size (1080x1920) likewise; (b) a download produces an
// <a download> with the expected filename (HTMLAnchorElement.prototype.click and URL.createObjectURL stubbed);
// (c) on the victory screen the slot gets the two buttons once #careerWallpaperSlot exists (created here when the
// career module is absent), the busy state rides the click, and the records Hall tab carries the Wallpaper button
// (hidden with no clears); (d) the first desktop render (image fetches included) stays under 1.5 s; (e) no page
// errors. Writes wallpaper-desktop.png / wallpaper-phone.png into its out dir. PASS = the feature works.
// Usage: cd tools/playtest && node probes/t-wallpaper.mjs --root ../..
import fs from "node:fs";
import path from "node:path";
import { openProbe, sleep } from "./_lib.mjs";
import { startFresh } from "./b_lib.mjs";

const P = await openProbe("t-wallpaper");
const { page } = P;

const FAKE_CAREER = {
  clears: 3, loop: 1, pure: false, boons: ["shieldStart", "absorb", "longBurn"], picks: 3,
  commendations: [
    { n: 1, date: Date.UTC(2026, 9, 12, 20, 0, 0), rank: "B", ship: "coconut", loop: 0, score: 412300, wpm: 58, acc: 94.2, boons: [], pure: true },
    { n: 2, date: Date.UTC(2026, 9, 25, 21, 0, 0), rank: "A", ship: "sofrito", loop: 0, score: 598120, wpm: 66, acc: 96.1, boons: ["shieldStart"], pure: false },
    { n: 3, date: Date.UTC(2026, 10, 1, 19, 30, 0), rank: "S", ship: "honeybee", loop: 1, score: 1234567, wpm: 82, acc: 98.4, boons: ["shieldStart", "absorb", "longBurn"], pure: false }
  ]
};

const seedCareer = (career) => P.g((c) => { const g = window.game; g.save.playerName = "NOVA KITE"; g.save.career = c; return g.careerWallpaperClears(); }, career);

// Render one size in the page: dimensions, timing, the centre-strip sample and the bright-pixel count of the text block.
async function renderIn(size, region) {
  return P.g(async ({ size, region }) => {
    const g = window.game;
    const t0 = performance.now();
    const c = await g.renderCareerWallpaper({ size });
    const ms = Math.round(performance.now() - t0);
    const ctx = c.getContext("2d");
    const pts = [];
    for (let i = 0; i < 20; i++) {
      const x = Math.floor((i + 0.5) * c.width / 20);
      const d = ctx.getImageData(x, Math.floor(c.height / 2), 1, 1).data;
      pts.push(`${d[0]},${d[1]},${d[2]}`);
    }
    const rx = Math.floor(c.width * region.x), ry = Math.floor(c.height * region.y), rw = Math.floor(c.width * region.w), rh = Math.floor(c.height * region.h);
    const px = ctx.getImageData(rx, ry, rw, rh).data;
    let bright = 0;
    for (let i = 0; i < px.length; i += 4) { const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; if (l > 215) bright++; }
    const dataUrl = c.toDataURL("image/png");
    return { w: c.width, h: c.height, ms, distinct: new Set(pts).size, bright, regionPx: rw * rh, last: g._wallpaperLast, dataUrl };
  }, { size, region });
}

function savePng(name, dataUrl) {
  const file = path.join(P.out, name);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  return file;
}

// ------------------------------------------------------------------ (a) renders from a faked career on a fresh save
await P.goto(null);
await sleep(300);
const clears = await seedCareer(FAKE_CAREER);
P.check("(a) careerWallpaperClears reads the faked save.career (3)", clears === 3, { clears });

const desk = await renderIn("desktop", { x: 0.05, y: 0.72, w: 0.42, h: 0.16 });
const deskFile = savePng("wallpaper-desktop.png", desk.dataUrl);
P.check("(a) desktop: 2560x1440, the centre strip is not one colour (>= 6 distinct of 20 samples)", desk.w === 2560 && desk.h === 1440 && desk.distinct >= 6, { w: desk.w, h: desk.h, distinct: desk.distinct });
P.check("(a) desktop: the bottom-left text block carries bright pixels (> 3000 above luminance 215)", desk.bright > 3000, { bright: desk.bright, regionPx: desk.regionPx });
P.check("(a) desktop: every art layer resolved from the @2x files (vista, boss, ship, drones) and Orbitron was ready", desk.last && ["bg", "fg", "boss", "ship", "drones"].every((k) => desk.last.sources[k] === "x2") && desk.last.fontReady === true, desk.last);
P.check("(d) desktop render (first call, image fetches included) under 1.5 s", desk.ms < 1500, { ms: desk.ms });

const phone = await renderIn("phone", { x: 0.05, y: 0.66, w: 0.9, h: 0.14 });
const phoneFile = savePng("wallpaper-phone.png", phone.dataUrl);
P.check("(a) phone: 1080x1920, centre strip not one colour, bright text pixels in the lower block (> 2000)", phone.w === 1080 && phone.h === 1920 && phone.distinct >= 6 && phone.bright > 2000, { w: phone.w, h: phone.h, distinct: phone.distinct, bright: phone.bright, ms: phone.ms });
console.log("samples:", deskFile, phoneFile);

// ------------------------------------------------------------------ (b) download: <a download> with the expected filename
const dl = await P.g(async () => {
  const g = window.game;
  const rec = { clicks: [], created: 0, revoked: 0 };
  const origClick = HTMLAnchorElement.prototype.click, origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;
  HTMLAnchorElement.prototype.click = function () { rec.clicks.push({ download: this.download, href: this.href, inDoc: document.contains(this) }); };
  URL.createObjectURL = (blob) => { rec.created++; rec.blobType = blob && blob.type; rec.blobSize = blob && blob.size; return "blob:stub"; };
  URL.revokeObjectURL = () => { rec.revoked++; };
  try {
    const r1 = await g.downloadCareerWallpaper("desktop");
    const r2 = await g.downloadCareerWallpaper("phone");
    return { r1, r2, rec };
  } finally {
    HTMLAnchorElement.prototype.click = origClick; URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke;
  }
});
P.check("(b) downloadCareerWallpaper('desktop') clicks <a download=\"TypeR-198X-commendation-3-desktop.png\" href=blob:...> once, result ok with that name",
  dl.r1.ok && dl.r1.name === "TypeR-198X-commendation-3-desktop.png" && dl.rec.clicks[0] && dl.rec.clicks[0].download === "TypeR-198X-commendation-3-desktop.png" && dl.rec.clicks[0].href === "blob:stub" && dl.rec.clicks[0].inDoc === true, dl);
P.check("(b) the phone download names TypeR-198X-commendation-3-phone.png and the blob is a PNG", dl.r2.ok && dl.r2.name === "TypeR-198X-commendation-3-phone.png" && dl.rec.clicks[1] && dl.rec.clicks[1].download === dl.r2.name && dl.rec.blobType === "image/png" && dl.rec.blobSize > 100000 && dl.rec.created === 2,
  { r2: dl.r2, click: dl.rec.clicks[1], blobType: dl.rec.blobType, blobSize: dl.rec.blobSize, created: dl.rec.created });

// ------------------------------------------------------------------ (c) records Hall tab: Wallpaper button, hidden with no clears
const rec1 = await P.g(() => {
  const g = window.game;
  g.openRecords();
  const box = document.querySelector("#panelHall #careerWallpaperRecords");
  const btn = box && box.querySelector("[data-wallpaper]");
  const table = document.getElementById("highScoreTable");
  const out = { exists: !!box, hidden: box ? box.classList.contains("hidden") : null, btnText: btn ? btn.textContent.trim() : null, auto: btn ? btn.dataset.wallpaper : null,
    afterTable: !!(box && table && (table.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING)), hint: box ? box.querySelector(".careerWallpaper__hint").textContent : null };
  g.closeRecords();
  return out;
});
P.check("(c) records: #careerWallpaperRecords after the table with one 'Wallpaper' button (data-wallpaper=auto), shown with 3 clears", rec1.exists && !rec1.hidden && rec1.btnText === "Wallpaper" && rec1.auto === "auto" && rec1.afterTable, rec1);
const rec0 = await P.g(() => {
  const g = window.game;
  g.save.career = { clears: 0, commendations: [] };
  g.save.victories = 0;
  g.openRecords();
  const box = document.querySelector("#panelHall #careerWallpaperRecords");
  const out = { exists: !!box, hidden: box ? box.classList.contains("hidden") : null, count: document.querySelectorAll("#panelHall #careerWallpaperRecords").length };
  g.closeRecords();
  return out;
});
P.check("(c) records: the button hides with zero clears and is created once (no duplicate on a second open)", rec0.exists && rec0.hidden === true && rec0.count === 1, rec0);

// ------------------------------------------------------------------ (c) victory screen: the slot gets its two buttons
await startFresh(P, "WALL");
await seedCareer(FAKE_CAREER);
await P.g(() => { const g = window.game; g.invulnT = 1000; g.onVictory(); });
await page.waitForFunction(() => window.game.mode === "victory", null, { timeout: 5000 });
const slotInfo = await P.g(() => {
  let slot = document.getElementById("careerWallpaperSlot");
  let created = false;
  if (!slot) {
    // The career module is absent: stand in for its victory markup (after #resultsRun inside #screenVictory).
    const sec = document.createElement("section");
    sec.id = "careerPanel";
    sec.className = "careerPanel";
    slot = document.createElement("div");
    slot.id = "careerWallpaperSlot";
    slot.className = "careerWallpaper";
    sec.appendChild(slot);
    const after = document.getElementById("resultsRun");
    after.insertAdjacentElement("afterend", sec);
    created = true;
  }
  return { created, careerModule: typeof window.game.careerClears === "function" };
});
const mounted = await page.waitForFunction(() => document.querySelectorAll("#careerWallpaperSlot [data-wallpaper]").length === 2, null, { timeout: 4000 }).then(() => true).catch(() => false);
const slot = await P.g(() => {
  const btns = [...document.querySelectorAll("#careerWallpaperSlot [data-wallpaper]")];
  const hint = document.querySelector("#careerWallpaperSlot .careerWallpaper__hint");
  return { n: btns.length, labels: btns.map((b) => b.textContent.trim()), sizes: btns.map((b) => b.dataset.wallpaper), arcade: btns.every((b) => b.classList.contains("btn-arcade") && b.type === "button"), hint: hint ? hint.textContent : null, mode: window.game.mode };
});
P.check("(c) victory: #careerWallpaperSlot holds 'Wallpaper · desktop' and 'Wallpaper · phone' (.btn-arcade) plus the hint" + (slotInfo.created ? " (slot created by the probe: no career module)" : " (career module's slot)"),
  mounted && slot.n === 2 && slot.labels[0] === "Wallpaper · desktop" && slot.labels[1] === "Wallpaper · phone" && slot.sizes.join() === "desktop,phone" && slot.arcade && !!slot.hint, { ...slot, ...slotInfo });
await page.keyboard.press("Escape");
await sleep(1200);
await P.shot("victory-slot");

// A click rides the busy state while rendering and clears it after; the stubbed anchor records the phone filename.
const busy = await P.g(async () => {
  const rec = { clicks: [] };
  const origClick = HTMLAnchorElement.prototype.click, origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;
  HTMLAnchorElement.prototype.click = function () { rec.clicks.push(this.download); };
  URL.createObjectURL = () => "blob:stub";
  URL.revokeObjectURL = () => {};
  try {
    const b = document.querySelector('#careerWallpaperSlot [data-wallpaper="phone"]');
    b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 30));
    const during = { busy: b.classList.contains("is-busy"), ariaBusy: b.getAttribute("aria-busy"), disabled: b.disabled };
    const t0 = performance.now();
    while (b.classList.contains("is-busy") && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 40));
    const after = { busy: b.classList.contains("is-busy"), ariaBusy: b.getAttribute("aria-busy"), disabled: b.disabled };
    return { during, after, clicks: rec.clicks };
  } finally {
    HTMLAnchorElement.prototype.click = origClick; URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke;
  }
});
P.check("(c) the phone button is .is-busy / aria-busy / disabled while rendering, clean afterwards, and the download named the phone file", busy.during.busy && busy.during.ariaBusy === "true" && busy.during.disabled && !busy.after.busy && busy.after.ariaBusy === null && !busy.after.disabled && busy.clicks[0] === "TypeR-198X-commendation-3-phone.png", busy);

// No career module at all: render from save alone (victories + the newest highScores row) still resolves.
const bare = await P.g(async () => {
  const g = window.game;
  delete g.save.career;
  g.save.victories = 1;
  const d = g.careerWallpaperData();
  const c = await g.renderCareerWallpaper({ size: "desktop" });
  return { n: d.commendation.n, rank: d.commendation.rank, ship: d.shipId, name: d.name, clears: d.clears, w: c.width, file: g.careerWallpaperFilename("desktop", d) };
});
P.check("(c) without save.career the data comes from save (clears 1, the live run's rank, the pilot's ship) and the render resolves", bare.n === 1 && /^[SABCD]$/.test(bare.rank) && bare.ship === "coconut" && bare.name === "NOVA KITE" && bare.clears === 1 && bare.w === 2560 && bare.file === "TypeR-198X-commendation-1-desktop.png", bare);

// ------------------------------------------------------------------ (e)
P.check("(e) no page errors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
