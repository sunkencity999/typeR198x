// CAREER (56-career.js): the meta-progression contract. A fresh save shows no service record; the victories count
// migrates into clears + boon picks; the strip renders badges / loop selector / pick button; a boon pick persists and
// the pick modal offers three; loop runs get +6 % plate speed per loop, +1 boss segment per loop, +10 % score per loop and
// the LOOP n / BOONS tags; the boons act (shield at sector start, the first leak absorbed, score untouched by boons);
// a sector-10 clear records a commendation, shows the panel with a pending pick and tags the record; PURE runs carry no
// boon / loop and the PURE tag; the modes never see boons; the records modal lists the commendations; beam tier 4 draws.
// Usage: node probes/t-career.mjs
import { openProbe, sleep } from "./_lib.mjs";

const P = await openProbe("t-career", { dpr: 1 });
await P.goto({ playerName: "CAREER", selectedShip: "coconut", highScore: 0, lastUnlockedLevel: 10, storySeen: true, keyboardHintSeen: true, settings: { muted: true } });

const fresh = await P.g(() => ({ hidden: document.getElementById("serviceRecord").classList.contains("hidden"), career: window.game.save.career, tier: window.game.careerBeamTier(), setting: document.getElementById("setCareer") && document.getElementById("setCareer").checked }));
P.check("C1 fresh save: career block present and empty, strip hidden, beam tier 0, Career setting on", fresh.career && fresh.career.clears === 0 && fresh.career.picks === 0 && fresh.hidden && fresh.tier === 0 && fresh.setting === true, fresh);

// migration: six victories -> six clears, six picks, six generic commendations
const mig = await P.g(() => { const g = window.game; const c = normaliseCareer(null, 6); g.save.victories = 6; g.save.career = c; storeSave(g.save); g.careerRenderStrip(); return { clears: c.clears, picks: c.picks, comm: c.commendations.length, loop: c.loop, strip: !document.getElementById("serviceRecord").classList.contains("hidden"), badges: document.querySelectorAll("#srBadges .srBadge").length, loops: document.querySelectorAll(".srLoop").length, active: document.querySelector(".srLoop.is-active") && document.querySelector(".srLoop.is-active").dataset.loop, pick: document.getElementById("btnBoonPick") && document.getElementById("btnBoonPick").textContent, tier: g.careerBeamTier(), max: g.careerLoopMax() }; });
P.check("C2 migration: victories 6 -> clears 6, picks 6, 6 commendations; strip shows 6 badges, loops 0..5 (0 active), CHOOSE BOON (6), beam tier 2", mig.clears === 6 && mig.picks === 6 && mig.comm === 6 && mig.strip && mig.badges === 6 && mig.loops === 6 && mig.active === "0" && /CHOOSE BOON \(6\)/.test(mig.pick || "") && mig.tier === 2 && mig.max === 5, mig);

// the pick modal offers three; a pick persists and renders a chip
await P.page.click("#btnBoonPick");
await sleep(250);
const offers = await P.g(() => ({ open: !document.getElementById("boonModal").classList.contains("is-dismissed"), offers: [...document.querySelectorAll("#boonOffers button.boonCard")].map((b) => b.dataset.boon), focus: document.activeElement && document.activeElement.className }));
P.check("C3 pick modal opens from the strip with three distinct offers, focus on the first card", offers.open && offers.offers.length === 3 && new Set(offers.offers).size === 3 && /boonCard/.test(offers.focus || ""), offers);
await P.page.click(`#boonOffers button.boonCard[data-boon="${offers.offers[0]}"]`);
await sleep(250);
const picked = await P.g((id) => { const g = window.game; const c = g.save.career; const stored = JSON.parse(localStorage.getItem("typesmup198x.save.v1") || "{}"); return { boons: c.boons, picks: c.picks, stored: stored.career && stored.career.boons, chips: document.querySelectorAll(".srBoon").length, stillOpen: !document.getElementById("boonModal").classList.contains("is-dismissed"), again: [...document.querySelectorAll("#boonOffers button.boonCard")].map((b) => b.dataset.boon).includes(id) }; }, offers.offers[0]);
P.check("C4 pick: the boon is stored (save + localStorage), picks 5, one chip in the strip, the modal re-offers without the picked boon", picked.boons.length === 1 && picked.boons[0] === offers.offers[0] && picked.picks === 5 && Array.isArray(picked.stored) && picked.stored[0] === offers.offers[0] && picked.chips === 1 && picked.stillOpen && !picked.again, picked);
await P.g(() => { const g = window.game; g.closeModal(document.getElementById("boonModal")); for (const id of ["shieldStart", "absorb", "safeRelease"]) if (!g.save.career.boons.includes(id) && g.save.career.picks > 0) g.careerPickBoon(id); });

// loop 2 run: stamped record, speed, boss plan, score, tags, shield at the sector start
await P.g(() => window.game.careerSetLoop(2));
await P.g(() => { const g = window.game; g.startNewRun(); g.startLevel(0, { fromMenu: true, fresh: true }); });
await P.page.waitForFunction(() => window.game.mode === "playing" && !window.game.levelIntro, null, { timeout: 30000 });
const loop = await P.g(() => { const g = window.game; const t = g.waveTuning; const n0 = (() => { const keep = g.run.loop; g.run.loop = 0; const n = buildBossPlan(1).segments.length; g.run.loop = keep; return n; })(); const s0 = g.stats.score; const gained = g.addScore(100, { kind: "kill" }); return { runLoop: g.run.loop, boons: g.run.boons.length, pure: g.run.pure, speedMul: Math.round((t ? t.speedMul : 0) * 1000) / 1000, segs: buildBossPlan(1).segments.length, segs0: n0, gained, delta: g.stats.score - s0, tags: g.buildResults("level").tags, shield: g.player.shield }; });
P.check("C5 loop 2 run: run.loop 2, boons stamped, speedMul 1.12, boss plan +2 segments, 100 points -> 120, tags LOOP 2 + BOONS, shield up at the sector start", loop.runLoop === 2 && loop.boons >= 3 && !loop.pure && loop.speedMul === 1.12 && loop.segs === loop.segs0 + 2 && loop.gained === 120 && loop.delta === 120 && loop.tags.includes("LOOP 2") && loop.tags.includes("BOONS") && loop.shield > 0, loop);

const absorb = await P.g(() => { const g = window.game; g.player.shield = 0; const hp0 = g.player.hp; const d1 = g.takeDamage(30, "leak"); const hp1 = g.player.hp; g.invulnT = 0; const d2 = g.takeDamage(30, "leak"); return { hp0, hp1, hp2: g.player.hp, d1, d2, used: g._careerSector && g._careerSector.absorbUsed }; });
P.check("C6 Absorb: the first leak of the sector costs no hull, the second does", absorb.d1 === 0 && absorb.hp1 === absorb.hp0 && absorb.hp2 < absorb.hp1 && absorb.used === true, absorb);

const release = await P.g(() => { const g = window.game; g.enemies.length = 0; const e = new Enemy({ text: "signal", x: 800, y: g.laneYs()[1], speed: 0, lane: 1 }); e.age = 2; g.enemies.push(e); g.handleTyped("s"); g.handleTyped("i"); const p0 = e.progress; g.releaseLock("manual"); const p1 = e.progress; g.handleTyped("s"); g.handleTyped("i"); g.handleTyped("g"); g.releaseLock("manual"); return { p0, p1, p2: e.progress, free: g._careerSector.freeRelease }; });
P.check("C7 Safe Release: the first manual release of the wave keeps the typed letters, the second resets them", release.p0 === 2 && release.p1 === 2 && release.p2 === 0 && release.free === false, release);

// beam tier 4 draws without errors inside the additive batch
await P.g(() => { const g = window.game; g.save.career.clears = 20; g.fireLaserTo(900, 300, "cyan"); });
await sleep(60);
const beam = await P.g(() => ({ tier: window.game.careerBeamTier(), bullets: window.game.bullets.length, errors: 0 }));
P.check("C8 beam tier 4 (20 clears) renders a beam", beam.tier === 4 && beam.bullets >= 1, beam);
await P.g(() => { window.game.save.career.clears = 6; });

// a sector-10 clear: commendation 7, panel, pending pick, record tags
await P.g(() => { const g = window.game; g.stopToMenu(true); g.careerSetLoop(1); g.startNewRun(); g.startLevel(9, { fromMenu: true, fresh: true }); });
await P.page.waitForFunction(() => window.game.mode === "playing" && !window.game.levelIntro, null, { timeout: 30000 });
await P.page.waitForFunction(() => !!TypeRAssets.get("bosses/10"), null, { timeout: 30000 }).catch(() => {});
await P.g(() => { const g = window.game; for (const e of g.enemies) e.alive = false; g.enemies.length = 0; g.beginBossFight(); });
await P.page.waitForFunction(() => { const g = window.game; return g.inBoss && !(g.bossIntro && g.bossIntro.locked); }, null, { timeout: 15000 });
for (let n = 0; n < 1500; n++) { const done = await P.g(() => { const g = window.game; const b = g.boss; if (!b || g.bossClear) return true; const ch = b.nextChar; if (ch) g.handleTyped(ch); return false; }); if (done) break; await sleep(20); }
await P.page.waitForFunction(() => window.game.mode === "victory", null, { timeout: 30000 });
await P.g(() => window.game.skipEndingDialogue());
await sleep(600);
const vic = await P.g(() => { const g = window.game; const c = g.save.career; const last = c.commendations[c.commendations.length - 1]; return { clears: c.clears, picks: c.picks, last, panel: !document.getElementById("careerPanel").classList.contains("hidden"), stamp: document.getElementById("careerStamp").textContent, pickBtn: !document.getElementById("btnCareerPick").classList.contains("hidden"), hs: (g.save.highScores[0] || {}).tags, hsLoop: (g.save.highScores[0] || {}).loop }; });
P.check("C9 sector-10 clear: commendation 7 (loop 1, rank, ship), one more pick, panel + CHOOSE BOON visible, high-score row tagged LOOP 1", vic.clears === 7 && vic.picks === 3 && vic.last && vic.last.n === 7 && vic.last.loop === 1 && /^[SABCD]$/.test(vic.last.rank) && vic.last.ship === "coconut" && vic.panel && /COMMENDATION 7/.test(vic.stamp) && vic.pickBtn && Array.isArray(vic.hs) && vic.hs.includes("LOOP 1") && vic.hsLoop === 1, vic);
await P.shot("victory-commendation");

// PURE: boons and loop off, tag PURE
await P.g(() => { const g = window.game; g.stopToMenu(true); g.careerSetPure(true); g.startNewRun(); g.startLevel(0, { fromMenu: true, fresh: true }); });
await P.page.waitForFunction(() => window.game.mode === "playing", null, { timeout: 30000 });
const pure = await P.g(() => { const g = window.game; return { loop: g.run.loop, boons: g.run.boons.length, pure: g.run.pure, tags: g.buildResults("level").tags, shield: g.player.shield, loopActive: g.careerLoopActive(), speedMul: g.waveTuning && g.waveTuning.speedMul, setting: document.getElementById("setCareer").checked, loopsDisabled: [...document.querySelectorAll(".srLoop")].every((b) => b.disabled) }; });
// speedMul here is the pace controller's own (the fast typing above raises paceMul); the loop factor (x1.06 per loop) must be absent
P.check("C10 PURE: loop 0, no boons, no shield, no loop speed factor, tag PURE, setting off, loop buttons disabled", pure.loop === 0 && pure.boons === 0 && pure.pure && pure.tags.includes("PURE") && !pure.tags.some((t) => /^LOOP/.test(t)) && !(pure.shield > 0) && pure.loopActive === 0 && pure.speedMul < 1.12 && pure.setting === false && pure.loopsDisabled, pure);
await P.g(() => { const g = window.game; g.stopToMenu(true); g.careerSetPure(false); });

// modes never see boons / loops
const mode = await P.g(() => { const g = window.game; if (typeof g.beginModeRun !== "function") return { skip: true }; g.beginModeRun("drill"); return { active: g.modesActive(), runActive: g.careerRunActive(), loop: g.careerLoopActive(), boon: g.careerBoonActive("shieldStart") }; });
P.check("C11 a Drill run has no career: careerRunActive false, loop 0, no boon", mode.skip || (mode.active === "drill" && mode.runActive === false && mode.loop === 0 && mode.boon === false), mode);
await P.g(() => { const g = window.game; g.stopToMenu(true); });

// records modal lists the commendations (dates: a dash for backfilled clears)
await P.g(() => window.game.openRecords());
await sleep(300);
const rec = await P.g(() => ({ rows: document.querySelectorAll("#commendationsPanel tbody tr").length, title: (document.getElementById("commendationsTitle") || {}).textContent, dash: /—/.test(document.querySelector("#commendationsPanel tbody tr:last-child td:last-child").textContent) }));
P.check("C12 records: a Commendations table with 7 rows, backfilled clears dated with a dash", rec.rows === 7 && /7 clears/.test(rec.title || "") && rec.dash, rec);

await P.finish();
