// SOUND pass acceptance: sample pool, sidechain, typing climb, announcer and its setting, director feeds.
// Usage (from tools/playtest): node probes/audio-sound.mjs --root ../..   (root is implied by _lib.mjs)
//   1. unlock decodes both banks (sfxBank / voBank) with the marker shift inside +-80 ms; load stats reported
//   2. round-robin: six impacts never repeat a variant back to back and use >= 3 variants; rates inside the jitter
//   3. voice caps: a burst of large explosions keeps <= its per-cue cap live; the pool stays <= 32
//   4. typing tick: zap(k/8) climbs strictly in pitch, the last glyph resolves, a miss is the dull tick
//   5. typeTick(variant, progress) takes the climb; typeTick(variant) keeps the legacy synth tick
//   6. sidechain: explosion(1) dips musicDuck to about -4 dB within 60 ms and releases within a second
//   7. compressor: -12 dB / knee 20 / ratio 3 / 5 ms / 150 ms
//   8. announcer: say() plays through voGain, the setting row toggles sfx.announcerOn and silences lines
//   9. priority queue: a lower line waits, a higher one replaces the queued one
//  10. rankStamp(rank) says the letter; the director's results / waveWillEnd feeds reach the registry
//  11. offline render with the banks: a 12-zap burst + explosion(1) + bossKill + damage peaks < .95
//  12. legacy manifest (no banks): every cue runs on its synth, _sample() returns null, nothing throws
import { openProbe, ROOT } from "./_lib.mjs";
import fs from "node:fs";
import path from "node:path";

const P = await openProbe("audio-sound", {});
const page = P.page;

await P.goto("fresh");
const g = (fn, arg) => page.evaluate(fn, arg);

// 1. unlock + banks
const unlocked = await g(async () => {
  const s = game.sfx;
  const t0 = performance.now();
  await s.unlock();
  const unlockMs = Math.round(performance.now() - t0);
  const until = performance.now() + 4000;
  while ((!s.banks.sfx || !s.banks.vo) && performance.now() < until) await new Promise((r) => setTimeout(r, 20));
  const b = s.banks.sfx, v = s.banks.vo;
  return { unlockMs, ctx: !!s.ctx, sfx: !!b, vo: !!v, sfxShift: b && +b.shift.toFixed(4), voShift: v && +v.shift.toFixed(4), sfxCues: b && Object.keys(b.cues).length, voCues: v && Object.keys(v.cues).length,
    sfxDur: b && +b.buffer.duration.toFixed(2), voDur: v && +v.buffer.duration.toFixed(2), rate: s.ctx.sampleRate, stats: s.loadStats, announcer: s.announcerOn,
    decodedMB: +(((b ? b.buffer.length : 0) + (v ? v.buffer.length : 0)) * 4 / 1048576).toFixed(2) };
});
P.check("unlock decodes the sfx and vo banks (marker shift within +-80 ms)", unlocked.ctx && unlocked.sfx && unlocked.vo && Math.abs(unlocked.sfxShift) <= 0.08 && Math.abs(unlocked.voShift) <= 0.08 && unlocked.sfxCues >= 30 && unlocked.voCues >= 14, unlocked);

// 2. round-robin
const rr = await g(() => {
  const s = game.sfx, picks = [], rates = [];
  for (let i = 0; i < 6; i++) { s.impact(); picks.push(s.lastVoice.variant); rates.push(s.lastVoice.rate); }
  let repeat = false; for (let i = 1; i < picks.length; i++) if (picks[i] === picks[i - 1]) repeat = true;
  const jitter = s.banks.sfx.cues.impact.jitter;
  return { picks, distinct: new Set(picks).size, repeat, rates, jitter, ratesOk: rates.every((r) => Math.abs(r - 1) <= jitter + 1e-6), cue: s.lastVoice.cue, lastCue: s.lastCue };
});
P.check("round-robin: six impacts, no back-to-back repeat, >= 3 variants, rate within the table jitter", !rr.repeat && rr.distinct >= 3 && rr.ratesOk && rr.cue === "impact" && rr.lastCue === "impact", rr);

// 3. voice caps
const caps = await g(() => {
  const s = game.sfx;
  let maxCue = 0, maxPool = 0;
  for (let i = 0; i < 10; i++) { s.explosion(0.95); maxCue = Math.max(maxCue, s.banks.sfx.voices.explosion_l.length); maxPool = Math.max(maxPool, s._pool.length); }
  for (let i = 0; i < 40; i++) { s.impact(); s.shieldHit(); maxPool = Math.max(maxPool, s._pool.length); }
  return { cap: s.banks.sfx.cues.explosion_l.voices, maxCue, maxPool, poolMax: SFX.POOL.maxVoices };
});
P.check("voice stealing: explosion_l live voices <= its cap, pool <= 32 under a 90-voice burst", caps.maxCue <= caps.cap && caps.maxPool <= caps.poolMax, caps);

// 4. typing climb
const climb = await g(() => {
  const s = game.sfx, hz = [], kinds = [], variants = [];
  for (let k = 1; k <= 8; k++) { s.zap(k / 8); hz.push(s.lastTick.hz); kinds.push(s.lastTick.kind); variants.push(s.lastVoice.cue + ":" + s.lastVoice.variant); }
  let rising = true; for (let i = 1; i < hz.length; i++) if (!(hz[i] > hz[i - 1])) rising = false;
  s.error(); const miss = { ...s.lastTick };
  s.error(0.45); const dry = { ...s.lastTick, lastCue: s.lastCue };
  return { hz, kinds, rising, octave: +(hz[hz.length - 1] / (hz[0] / Math.pow(2, 1 / 8))).toFixed(2), miss, dry, laserVoices: s.laserVoices.length, lastSampled: variants.slice(-2) };
});
P.check("typing tick climbs strictly across the word (8 glyphs), resolves on the last, miss is the dull tick", climb.rising && climb.kinds[7] === "resolve" && climb.kinds.slice(0, 7).every((k) => k === "climb") && Math.abs(climb.octave - 2) < 0.05 && climb.miss.kind === "miss" && climb.miss.hz < climb.hz[0] && climb.dry.kind === "miss" && climb.dry.lastCue === "error", climb);

// 5. typeTick with / without progress
const tt = await g(() => {
  const s = game.sfx;
  s.typeTick("default", 0.5); const withP = { ...s.lastTick, lastCue: s.lastCue };
  s.lastTick = null; s.typeTick("empress"); const without = { tick: s.lastTick, lastCue: s.lastCue };
  return { withP, without };
});
P.check("typeTick(variant, progress) climbs; typeTick(variant) keeps the legacy synth tick and its lastCue", tt.withP.kind === "climb" && tt.withP.p === 0.5 && tt.withP.lastCue === "typeTick:default" && tt.without.tick === null && tt.without.lastCue === "typeTick:empress", tt);

// 6. sidechain duck
const duck = await g(async () => {
  const s = game.sfx, g = s.musicDuck.gain;
  await new Promise((r) => setTimeout(r, 900));   // let earlier ducks release
  const before = +g.value.toFixed(3);
  s.explosion(1);
  const trace = [];
  for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 50)); trace.push(+g.value.toFixed(3)); }
  await new Promise((r) => setTimeout(r, 400));
  return { before, min: Math.min(...trace), trace, after: +g.value.toFixed(3), wantMin: +Math.pow(10, SFX.POOL.duckDb.explosionL / 20).toFixed(3) };
});
P.check("sidechain: explosion(1) dips musicDuck to about -4 dB and releases to unity within a second", duck.before > 0.98 && duck.min <= duck.wantMin + 0.03 && duck.min >= duck.wantMin - 0.03 && duck.after > 0.98, duck);

// 7. compressor
const comp = await g(() => { const c = game.sfx.compressor; return { threshold: c.threshold.value, knee: c.knee.value, ratio: c.ratio.value, attack: +c.attack.value.toFixed(3), release: +c.release.value.toFixed(3) }; });
P.check("master compressor: -12 dB, knee 20, ratio 3, attack .005, release .15", comp.threshold === -12 && comp.knee === 20 && comp.ratio === 3 && comp.attack === 0.005 && comp.release === 0.15, comp);

// 8. announcer + setting
const vo = await g(async () => {
  const s = game.sfx;
  s._voCut(); await new Promise((r) => setTimeout(r, 50));
  const cueBefore = s.lastCue;
  const ok = s.say("ready");
  const playing = !!(s._vo && s._vo.line === "ready" && s._vo.voice && s._vo.voice.dur > 0.3);
  const routed = s.voGain && s.voGain.numberOfOutputs === 1;
  const row = document.getElementById("setAnnouncer");
  const rowDefault = !!row && row.checked && game.save.settings.announcer === true && s.announcerOn === true;
  row.click();
  await new Promise((r) => setTimeout(r, 30));
  const offSetting = game.save.settings.announcer === false && s.announcerOn === false && s._vo === null;
  const offSay = s.say("go");
  const offLastVo = s.lastVo;
  row.click();
  await new Promise((r) => setTimeout(r, 30));
  const backOn = game.save.settings.announcer === true && s.announcerOn === true;
  return { ok, playing, routed, rowDefault, offSetting, offSay, offLastVo, backOn, lastCueUntouched: s.lastCue === cueBefore };
});
P.check("announcer: say('ready') plays through voGain; #setAnnouncer toggles settings.announcer and sfx.announcerOn and silences lines", vo.ok && vo.playing && vo.routed && vo.rowDefault && vo.offSetting && vo.offSay === false && vo.offLastVo === "ready" && vo.backOn && vo.lastCueUntouched, vo);

// 9. priority queue
const q = await g(async () => {
  const s = game.sfx;
  s._voCut(); await new Promise((r) => setTimeout(r, 50));
  s.say("sector_clear");                      // priority 5, ~1.05 s
  const a = s.say("rank_a");                  // 4: queued
  const queued1 = s._voQueue && s._voQueue.line;
  s.say("perfect");                           // 2 < 4: dropped
  const queued2 = s._voQueue && s._voQueue.line;
  s.say("signal_lost");                       // 5 >= 5: not above the current one, replaces the queued line
  const queued3 = s._voQueue && s._voQueue.line;
  const cur = s._vo && s._vo.line;
  await new Promise((r) => setTimeout(r, 1400));
  const later = s.lastVo;
  s._voCut();
  return { a, queued1, queued2, queued3, cur, later };
});
P.check("announcer queue: lower priority waits (one slot), equal/higher priority replaces the queued line, plays after the current one", q.a && q.queued1 === "rank_a" && q.queued2 === "rank_a" && q.queued3 === "signal_lost" && q.cur === "sector_clear" && q.later === "signal_lost", q);

// 10. rankStamp + director feeds
const dir = await g(async () => {
  const s = game.sfx, gm = game;
  s._voCut(); await new Promise((r) => setTimeout(r, 50));
  s.rankStamp("S");
  const stamp = { lastCue: s.lastCue, vo: s.lastVo };
  s._voCut();
  gm.hook("results", { results: { rank: "B", newHigh: true }, scope: "level" });
  const fed = { rank: s.lastRank, high: s.lastNewHigh };
  s.rankStamp();
  const stamp2 = { vo: s.lastVo, queued: s._voQueue && s._voQueue.line };
  s._voCut();
  gm.hook("waveWillEnd", { perfect: true, byQuota: true });
  const pending = s.pendingPerfect;
  s.waveClear(2);
  const perfect = { vo: s.lastVo, pending: s.pendingPerfect, lastCue: s.lastCue };
  s._voCut();
  gm.hook("modeChange", { from: "levelComplete", to: "menu" });
  return { stamp, fed, stamp2, pending, perfect, cleared: s.lastRank === null && s.lastNewHigh === false };
});
P.check("rankStamp(rank) keeps lastCue uiTick:stamp and says the letter; results hook feeds lastRank/newHigh (-> 'New record' queued); perfect wave -> 'Perfect' on waveClear; menu clears the rank", dir.stamp.lastCue === "uiTick:stamp" && dir.stamp.vo === "rank_s" && dir.fed.rank === "B" && dir.fed.high && dir.stamp2.vo === "rank_b" && dir.stamp2.queued === "new_record" && dir.pending && dir.perfect.vo === "perfect" && !dir.perfect.pending && dir.perfect.lastCue === "waveClear:2" && dir.cleared, dir);

// 11. offline render with the banks
const render = await g(async () => {
  const sr = 44100;
  const mk = (sec) => { const s = new SFX(); const off = new OfflineAudioContext(1, Math.ceil(sr * sec), sr); s._buildBus(off); s.laserBuffer = game.sfx.laserBuffer; s.bigExplosionBuffer = game.sfx.bigExplosionBuffer; s.banks = game.sfx.banks; return { s, off }; };
  const peakOf = (d) => { let p = 0; for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i])); return p; };
  const rmsDb = (d, a, b) => { let acc = 0; for (let i = a; i < b; i++) acc += d[i] * d[i]; return 20 * Math.log10(Math.sqrt(acc / (b - a)) || 1e-9); };
  const burst = mk(2.5); for (let i = 0; i < 12; i++) { burst.s._timeShift = i * 0.012; burst.s.zap(i / 11); } burst.s._timeShift = 0; burst.s.explosion(1); burst.s.bossKill(); burst.s.damage();
  const worst = (await burst.off.startRendering()).getChannelData(0);
  const z = mk(0.6); z.s.zap(0.5);
  const zap = (await z.off.startRendering()).getChannelData(0);
  const u = mk(0.6); u.s.uiTick("confirm"); u.s.lock("enemy");
  const ui = (await u.off.startRendering()).getChannelData(0);
  return { burstPeak: +peakOf(worst).toFixed(3), sampled: !!burst.s.lastVoice, zapPeak: +peakOf(zap).toFixed(3), zapBodyDb: +rmsDb(zap, 0, Math.round(0.1 * sr)).toFixed(1), zapTailDb: +rmsDb(zap, Math.round(0.25 * sr), Math.round(0.35 * sr)).toFixed(1), uiPeak: +peakOf(ui).toFixed(3) };
});
P.check("offline (sampled path): 12 zaps + explosion(1) + bossKill + damage peak < .95; a zap's tail < -40 dBFS by .25 s", render.sampled && render.burstPeak < 0.95 && render.zapTailDb < -40 && render.zapBodyDb > -40 && render.uiPeak < 0.6, render);

// 12. legacy manifest: no banks
const legacyCtx = await P.browser.newContext({ viewport: { width: 1440, height: 900 } });
const manifestJs = fs.readFileSync(path.join(ROOT, "assets", "opt", "manifest.js"), "utf8");
await legacyCtx.addInitScript(() => { window.TypeRHarness = Object.assign(window.TypeRHarness || {}, { flightCheck: "skip" }); });
await legacyCtx.route(/\/assets\/opt\/manifest\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: manifestJs + "\n;(function () { var m = window.TYPER_ASSET_MANIFEST; if (m) { delete m.sfxBank; delete m.voBank; } })();\n" }));
const lp = await legacyCtx.newPage();
const legacyErrors = [];
lp.on("pageerror", (e) => legacyErrors.push(String(e)));
await lp.goto(P.base, { waitUntil: "load" });
await lp.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 120000 });
const legacy = await lp.evaluate(async () => {
  const s = game.sfx;
  await s.unlock();
  let threw = null;
  try { for (const n of [...SFX.CUES, ...SFX.ALIASES]) { if (n === "lowHp") s.lowHp(true); else if (n === "explosion") s.explosion(0.9); else if (n === "fanfare") s.fanfare("levelClear"); else s[n](); } s.lowHp(false); s.say("ready"); s.rankStamp("A"); } catch (e) { threw = e.message; }
  return { banks: s.banks, sample: s._sample("impact"), said: s.say("go"), lastVoice: s.lastVoice, threw, laser: s.laserBuffer instanceof AudioBuffer };
});
await legacyCtx.close();
P.check("legacy manifest (no banks): synth cues run, _sample() null, say() false, nothing throws, no page errors", legacy.banks.sfx === null && legacy.banks.vo === null && legacy.sample === null && legacy.said === false && legacy.lastVoice === null && !legacy.threw && legacy.laser && legacyErrors.length === 0, { ...legacy, legacyErrors });

P.check("zero page errors / console errors on the main page", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, P.errors);
await P.finish();
