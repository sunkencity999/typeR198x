// A4 acceptance: normalizeKey/foldLatin, modifier filter, repeat guard, Space ignored, layout toast, no audio await.
import { openProbe, sleep } from "./_lib.mjs";

const P = await openProbe("a4");
await P.goto("fresh");

// --- pure normalisation via TypeRDebug ---
const norm = await P.g(() => {
  const n = window.TypeRDebug.normalizeKey;
  return {
    dottedI: n({ key: "İ", code: "KeyI" }), dotlessI: n({ key: "ı", code: "KeyI" }), aAcute: n({ key: "á" }), cyrillic: n({ key: "ф", code: "KeyA" }),
    digit: n({ key: "2", code: "Digit2" }), space: n({ key: " ", code: "Space" }), ctrlC: n({ key: "c", code: "KeyC", ctrlKey: true }),
    process: n({ key: "Process", code: "KeyA" }), plain: n({ key: "Q", code: "KeyQ" }), fold: window.TypeRDebug.foldLatin("Ąé İ")
  };
});
P.check("normalizeKey: İ/ı/á/ф(KeyA) -> i/i/a/a; digits, space, ctrl chords, Process -> null",
  norm.dottedI === "i" && norm.dotlessI === "i" && norm.aAcute === "a" && norm.cyrillic === "a" && norm.digit === null && norm.space === null && norm.ctrlC === null && norm.process === null && norm.plain === "q", norm);

await P.startRun("A4");
await sleep(300);

// Helper: dispatch a trusted-looking keydown on the canvas and report what changed.
const fire = (init) => P.g((init) => {
  const g = window.game;
  const before = { total: g.stats.total, correct: g.stats.correct, combo: g.stats.combo, lock: g.lock ? g.lock.ref.text || g.lock.ref.label : null };
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  g.canvas.focus();
  window.dispatchEvent(ev);
  const after = { total: g.stats.total, correct: g.stats.correct, combo: g.stats.combo, lock: g.lock ? (g.lock.ref.text || g.lock.ref.label) : null };
  return { before, after, defaultPrevented: ev.defaultPrevented };
}, init);

// --- Cyrillic ф on KeyA locks an 'a' target ---
await P.g(() => { const g = window.game; g.enemies.length = 0; g.powerups.length = 0; g.lock = null; g.enemies.push(new Enemy({ text: "apple", x: 900, y: 300, speed: 0 })); });
const r1 = await fire({ key: "ф", code: "KeyA" });
P.check("{key:'ф',code:'KeyA'} locks the 'apple' target (stats.total +1)", r1.after.lock === "apple" && r1.after.total === r1.before.total + 1 && r1.defaultPrevented, r1);

// --- ctrl+c: untouched, not prevented ---
const r2 = await fire({ key: "c", code: "KeyC", ctrlKey: true });
P.check("{key:'c',ctrlKey:true} leaves stats.total unchanged, defaultPrevented===false", r2.after.total === r2.before.total && r2.after.combo === r2.before.combo && !r2.defaultPrevented, r2);
const r2b = await fire({ key: "x", code: "KeyX", metaKey: true });
P.check("meta+letter never alters combo", r2b.after.combo === r2b.before.combo && !r2b.defaultPrevented, r2b);

// --- Space repeat: prevented, stats unchanged; Space with no lock: nothing ---
const r3 = await fire({ key: " ", code: "Space", repeat: true });
P.check("{key:' ',repeat:true} in play is defaultPrevented and stats unchanged", r3.defaultPrevented && r3.after.total === r3.before.total, r3);
await P.g(() => { const g = window.game; g.lock = null; g.enemies.forEach(e => e.locked = false); });
const r4 = await fire({ key: " ", code: "Space" });
P.check("Space with no lock changes nothing (lock null, stats unchanged)", r4.after.lock === null && r4.after.total === r4.before.total && r4.after.combo === r4.before.combo, r4);

// --- layout toast after three ф with no 'a' target ---
const toast = await P.g(() => {
  const g = window.game;
  g.enemies.length = 0; g.powerups.length = 0; g.lock = null; g.layoutStrikes = 0; g.toastOnce.delete("layout");
  g.enemies.push(new Enemy({ text: "zed", x: 900, y: 300, speed: 0 }));
  for (let i = 0; i < 3; i++) window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ф", code: "KeyA" }));
  const el = document.querySelector("#main #toastStack .toast--warn");
  const r = el ? el.getBoundingClientRect() : null;
  const main = document.getElementById("main").getBoundingClientRect();
  return { text: el ? el.textContent : null, kind: el ? el.dataset.kind : null, strikes: g.layoutStrikes, inMain: !!el, bottomPct: r ? Math.round((main.bottom - r.bottom) / main.height * 100) : null, count: document.querySelectorAll(".toast").length };
});
P.check("three ф events with no 'a' target show .toast--warn containing LAYOUT (inside #main, ~19% from bottom)", !!toast.text && /LAYOUT/.test(toast.text) && toast.inMain && toast.bottomPct >= 15 && toast.bottomPct <= 24, toast);
await P.shot("layout-toast");

// --- toast primitive: key replace, max 2 ---
const tp = await P.g(async () => {
  const g = window.game;
  g.showToast("ONE", { key: "k1" }); g.showToast("TWO", { key: "k2" }); g.showToast("THREE", { key: "k3" });
  const after3 = document.querySelectorAll("#toastStack .toast").length;
  g.showToast("TWO-B", { key: "k2", kind: "success" });
  const k2 = document.querySelector('#toastStack .toast[data-key="k2"]');
  const res = { after3, replaced: k2 && k2.textContent, kind: k2 && k2.dataset.kind, k1Gone: !document.querySelector('#toastStack .toast[data-key="k1"]') };
  g.dismissToast("k2"); g.dismissToast("k3"); g.dismissToast("layout");
  await new Promise(r => setTimeout(r, 300));
  res.cleared = document.querySelectorAll("#toastStack .toast").length;
  return res;
});
P.check("toast max 2 visible, same key replaces in place, dismissToast removes", tp.after3 === 2 && tp.replaced === "TWO-B" && tp.kind === "success" && tp.k1Gone && tp.cleared === 0, tp);

// --- after the first unlock: 20 keystrokes at 8 cps, no ensureAudio call/await ---
const audio = await P.g(async () => {
  const g = window.game;
  g.enemies.length = 0; g.powerups.length = 0; g.lock = null;
  g.enemies.push(new Enemy({ text: "qqqqqqqqqqqqqqqqqqqqqqqqq", x: 900, y: 300, speed: 0 }));
  let calls = 0, awaited = 0, typed = 0;
  const origEnsure = g.ensureAudio;
  g.ensureAudio = function () { calls++; const p = origEnsure.apply(this, arguments); awaited++; return p; };
  const origTyped = g.handleTyped;
  g.handleTyped = function (ch) { typed++; return origTyped.call(this, ch); };
  for (let i = 0; i < 20; i++) {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "q", code: "KeyQ" }));
    await new Promise(r => setTimeout(r, 125));
  }
  g.ensureAudio = origEnsure; g.handleTyped = origTyped;
  return { audioReady: g.audioReady, calls, awaited, typed };
});
P.check("after first unlock, 20 keystrokes at 8 cps produce 0 ensureAudio awaits and 20 synchronous handleTyped calls", audio.audioReady && audio.calls === 0 && audio.typed === 20, audio);

// --- MULTI label is letters-only ---
const labels = await P.g(() => { const g = window.game; const seen = new Set(); for (let i = 0; i < 80; i++) { g.powerups.length = 0; g.spawnPowerup(); for (const p of g.powerups) seen.add(p.type + ":" + p.label); } g.powerups.length = 0; return [...seen].sort(); });
P.check("powerup labels contain no digits (MULTI -> multi)", labels.every(l => !/\d/.test(l)) && labels.some(l => l === "MULTI:multi"), labels);

P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
