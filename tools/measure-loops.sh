#!/usr/bin/env bash
# Measures the music loop points used by assets/audio/sfx.js (MUSIC_LOOP) and finds
# which two of the six "Galactic High Score" tracks are the same song (MUSIC_FOR_LEVEL).
#
# Usage: tools/measure-loops.sh [audio-dir]      (default: assets/opt/audio, the MP3 encodes)
# Prints one JSON object per track, a pairwise similarity table and two paste-ready
# MUSIC_LOOP lines (raw first-audio table and the adopted body-start / phase-aligned
# table). Requires ffmpeg + node (both already needed by the asset pipeline).
#
# Method (mirrored in the comment above MUSIC_LOOP in sfx.js):
#   1. ffmpeg decodes each file to mono float PCM at 44.1 kHz. ffmpeg honours the LAME
#      gapless header exactly like the browser decoders do, so the timestamps below are
#      the ones HTMLMediaElement.currentTime reports (the WAV masters have the same
#      length to the sample, so the table is valid for the legacy WAV fallback too).
#   2. firstAudio = time of the first sample above -50 dBFS. An RMS envelope (100 ms hop)
#      gives bodyRef = median window RMS over the middle 40 % of the track; bodyStart = the
#      first window within 6 dB of bodyRef whose following 2 s and 8 s medians are also within
#      6 dB, i.e. where the full mix enters and stays. Tracks 1, 2 and 6 have intros and build-ups
#      8-10 dB under the body for 15-18 s before that point (the per-second means: track 1
#      -18 dB at 7 s, -20 at 12 s, -8 from 18 s).
#   3. loopStart: when the lead-in (bodyStart - firstAudio) is >= 0.5 s the loop lands on the
#      body, not the lead-in: loopStart = the strongest onset within +-150 ms of bodyStart
#      (minus 5 ms so the attack is kept). Otherwise loopStart = firstAudio.
#   4. rawEnd = start of the last 100 ms window still within 3 dB of bodyRef (the last point
#      before the trailing fade). sfx.js starts the incoming element at loopStart the moment
#      the outgoing one reaches loopEnd - 0.6 s and crossfades for 0.6 s (equal power), so
#      the point that must be phase-aligned with loopStart is X = loopEnd - 0.6.
#   5. Beat alignment: the onset envelope (20 ms band energies at a 5 ms hop, half-wave-rectified dB
#      increases summed over 4 bands; gain-invariant, so the trailing fade does not disturb it) gives
#      b0 = the first beat after loopStart and the beat peaks in the last two bars before rawEnd - 0.6.
#      X = bEnd - (b0 - loopStart) for the chosen end beat bEnd, so the incoming element's first beat
#      lands on an outgoing beat during the fade. loopEnd = X + 0.6.
#   6. Which end beat: the beat period comes from the autocorrelation of the onset envelope over 60 s of
#      body (60-200 BPM, prior around 120, refined at 16 beats). When that pulse is steady (r >= 0.3) the
#      strongest candidate that is a whole number of bars (4 beats, +-0.2 beat) from b0 is taken, else
#      the strongest on-beat one, else the strongest onset. The report prints the beat count and its
#      phase error plus a section-match r (detrended 4-band fingerprint, 2 s after loopStart vs 2 s
#      after X) so the choice can be audited.
#   7. Duplicate song: a 4-band energy envelope (one-pole splits at 200/800/3200 Hz,
#      50 ms hop, dB) is detrended with a 1.5 s moving average so only the short-term
#      rhythmic/spectral detail is left, z-normalised per band, and compared pairwise
#      with Pearson correlation at every lag within +-3 s (the two encodes of one song
#      have different lead-ins). The best lag's r > 0.6 means the same song; unrelated
#      songs stay below 0.15 even at their best lag.
#   8. Confirmation: the best pair and the runner-up are also compared at waveform level
#      (10 s excerpt from 60 s, decimated to 4 kHz, best lag within +-0.25 s). A bit-identical
#      render would score > 0.5 there; tracks 1 and 6 score ~0.18 (same song, different
#      mix/master) while unrelated music scores ~0.04.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${1:-$ROOT/assets/opt/audio}"

for tool in ffmpeg node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing $tool" >&2; exit 1; }
done

shopt -s nullglob nocaseglob
FILES=("$DIR"/galactic_high_score_[1-6].mp3)
if [[ ${#FILES[@]} -eq 0 ]]; then FILES=("$DIR"/galactic_high_score_[1-6].wav); fi
if [[ ${#FILES[@]} -eq 0 ]]; then echo "no galactic_high_score_{1..6}.{mp3,wav} in $DIR" >&2; exit 1; fi
IFS=$'\n' FILES=($(printf '%s\n' "${FILES[@]}" | sort)); unset IFS

node - "${FILES[@]}" <<'EOF_NODE'
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const SR = 44100;
const SILENCE_DB = -50;          // "audio present" threshold for firstAudio / end of audio
const HOP_S = 0.1;               // RMS envelope hop
const BODY_TOL_DB = 3;           // a window within this of the body median is still "the body"
const BODY_ENTER_DB = 6;         // bodyStart: first window within this of the body median ...
const BODY_HOLD_S = 8;           // ... and whose following 2 s and 8 s medians are too (a build-up hit does not count)
const LEAD_IN_MIN_S = 0.5;       // lead-ins shorter than this keep firstAudio as loopStart
const LOOP_FADE_S = 0.6;         // sfx.js LOOP_FADE: incoming starts when outgoing is at loopEnd - LOOP_FADE
const ONSET_HOP_S = 0.005;       // onset envelope hop
const ONSET_WIN_S = 0.02;        // onset energy window
const SEARCH_BARS = 2;           // the end beat is searched over the last 2 bars before rawEnd - LOOP_FADE
const FP_HOP_S = 0.05;           // fingerprint hop
const FP_DETREND_S = 1.5;        // moving-average window removed from the fingerprint
const FP_MAX_LAG_S = 3;          // lag search range for the duplicate test
const SPLITS = [200, 800, 3200]; // one-pole band splits for the fingerprint / onset envelope

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const median = (arr) => { const a = Array.from(arr).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

function decode(file) {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(SR), "-"], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function rmsEnvelope(pcm, hopS) {
  const hop = Math.round(hopS * SR), n = Math.floor(pcm.length / hop), out = new Float64Array(n);
  for (let w = 0; w < n; w++) {
    let acc = 0; const o = w * hop;
    for (let i = 0; i < hop; i++) acc += pcm[o + i] * pcm[o + i];
    out[w] = db(Math.sqrt(acc / hop));
  }
  return out;
}

// 4 band energies (dB) per hop via cascaded one-pole lowpass filters.
function bandEnergies(pcm, hopS) {
  const hop = Math.round(hopS * SR), n = Math.floor(pcm.length / hop);
  const a = SPLITS.map((fc) => 1 - Math.exp(-2 * Math.PI * fc / SR));
  const lp = [0, 0, 0];
  const bands = [0, 1, 2, 3].map(() => new Float64Array(n));
  for (let w = 0; w < n; w++) {
    const acc = [0, 0, 0, 0]; const o = w * hop;
    for (let i = 0; i < hop; i++) {
      const x = pcm[o + i];
      lp[0] += a[0] * (x - lp[0]); lp[1] += a[1] * (x - lp[1]); lp[2] += a[2] * (x - lp[2]);
      const b0 = lp[0], b1 = lp[1] - lp[0], b2 = lp[2] - lp[1], b3 = x - lp[2];
      acc[0] += b0 * b0; acc[1] += b1 * b1; acc[2] += b2 * b2; acc[3] += b3 * b3;
    }
    for (let b = 0; b < 4; b++) bands[b][w] = db(Math.sqrt(acc[b] / hop));
  }
  return bands;
}

function fingerprint(pcm, hopS) {
  const bands = bandEnergies(pcm, hopS);
  const n = bands[0].length;
  const win = Math.round(FP_DETREND_S / hopS), half = Math.floor(win / 2);
  for (const band of bands) {
    // detrend: subtract the centred moving average so slow structure (intro/outro) drops out
    const trend = new Float64Array(n); let acc = 0, cnt = 0;
    for (let i = 0; i < Math.min(n, half); i++) { acc += band[i]; cnt++; }
    for (let i = 0; i < n; i++) {
      if (i + half < n) { acc += band[i + half]; cnt++; }
      if (i - half - 1 >= 0) { acc -= band[i - half - 1]; cnt--; }
      trend[i] = acc / cnt;
    }
    for (let i = 0; i < n; i++) band[i] -= trend[i];
    let m = 0; for (const v of band) m += v; m /= n;
    let s = 0; for (const v of band) s += (v - m) * (v - m); s = Math.sqrt(s / n) || 1;
    for (let i = 0; i < n; i++) band[i] = (band[i] - m) / s;
  }
  return bands;
}

// Onset strength per 5 ms hop: band energies over a 20 ms window (running sums of the squared one-pole
// band signals), dB, half-wave-rectified increase summed over the 4 bands. Gain-invariant, so a trailing
// fade changes the level of the music but not its onsets. timeOf(i) is the window centre.
function onsetEnvelope(pcm, hopS, winS) {
  const hop = Math.round(hopS * SR), win = Math.round(winS * SR);
  const a = SPLITS.map((fc) => 1 - Math.exp(-2 * Math.PI * fc / SR));
  const lp = [0, 0, 0];
  const n = Math.floor((pcm.length - win) / hop) + 1;
  const sums = [0, 0, 0, 0], ring = [0, 1, 2, 3].map(() => new Float64Array(win));
  const energies = [0, 1, 2, 3].map(() => new Float64Array(n));
  let ri = 0, w = 0;
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i];
    lp[0] += a[0] * (x - lp[0]); lp[1] += a[1] * (x - lp[1]); lp[2] += a[2] * (x - lp[2]);
    const b0 = lp[0], b1 = lp[1] - lp[0], b2 = lp[2] - lp[1], b3 = x - lp[2];
    const sq = [b0 * b0, b1 * b1, b2 * b2, b3 * b3];
    for (let k = 0; k < 4; k++) { sums[k] += sq[k] - ring[k][ri]; ring[k][ri] = sq[k]; }
    ri = (ri + 1) % win;
    if (i + 1 >= win && (i + 1 - win) % hop === 0 && w < n) {
      for (let k = 0; k < 4; k++) energies[k][w] = db(Math.sqrt(Math.max(0, sums[k]) / win));
      w++;
    }
  }
  const out = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += Math.max(0, energies[k][i] - energies[k][i - 1]);
    out[i] = s;
  }
  return { env: out, timeOf: (i) => (i * hop + win / 2) / SR, indexOf: (t) => Math.round((t * SR - win / 2) / hop) };
}

// Local maxima of the onset envelope in [i0, i1) above thr, at least minGap apart (strongest wins).
function peaks(env, i0, i1, minGap, thr) {
  const out = [];
  for (let i = Math.max(1, i0); i < Math.min(env.length - 1, i1); i++) {
    if (env[i] < thr || env[i] < env[i - 1] || env[i] < env[i + 1]) continue;
    if (out.length && i - out[out.length - 1].i < minGap) { if (env[i] > out[out.length - 1].v) out[out.length - 1] = { i, v: env[i] }; continue; }
    out.push({ i, v: env[i] });
  }
  return out;
}

function pearson(x, y, lag) {
  // correlation of x[i] with y[i + lag] over the overlap
  const start = Math.max(0, -lag), end = Math.min(x.length, y.length - lag), n = end - start;
  let mx = 0, my = 0; for (let i = start; i < end; i++) { mx += x[i]; my += y[i + lag]; } mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = start; i < end; i++) { const dx = x[i] - mx, dy = y[i + lag] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy || 1);
}

// Beat period: autocorrelation of the onset envelope over 60-200 BPM (mild log-normal prior around 120 BPM),
// parabolic interpolation at the peak, then refined at 16 beats so the period is good to ~0.1 ms. r is the
// plain autocorrelation at one beat: >= 0.3 means a steady pulse the bar grid can be trusted on.
function tempo(onset, hopS, fromS, toS) {
  const i0 = Math.max(0, onset.indexOf(fromS)), i1 = Math.min(onset.env.length, onset.indexOf(toS));
  const seg = onset.env.subarray(i0, i1);
  const minLag = Math.round(0.3 / hopS), maxLag = Math.round(1.0 / hopS);
  const ac = (lag) => pearson(seg, seg, lag);
  let best = { s: -Infinity, lag: minLag };
  for (let lag = minLag; lag <= maxLag; lag++) {
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(lag * hopS / 0.5) / 0.8, 2));
    const s = ac(lag) * (0.7 + 0.3 * prior);
    if (s > best.s) best = { s, lag };
  }
  const refine = (lag) => { const a = ac(lag - 1), b = ac(lag), c = ac(lag + 1); const d = a - 2 * b + c; return d !== 0 ? lag + 0.5 * (a - c) / d : lag; };
  let beat = refine(best.lag) * hopS;
  const N = 16, centre = Math.round(N * beat / hopS), span = Math.round(0.5 * beat / hopS);
  let fine = { r: -Infinity, lag: centre };
  for (let lag = centre - span; lag <= centre + span; lag++) { const r = ac(lag); if (r > fine.r) fine = { r, lag }; }
  beat = refine(fine.lag) * hopS / N;
  return { beatS: beat, bpm: 60 / beat, r: +ac(Math.round(beat / hopS)).toFixed(3) };
}

// Section match for the report: Pearson r of the detrended 4-band fingerprint (50 ms hop) over the 2 s after
// loopStart and the 2 s after X. The two passages are what the 0.6 s crossfade blends.
function sectionMatch(fp, aS, bS, winS) {
  const h = (t) => Math.round(t / FP_HOP_S), n = h(winS);
  let acc = 0;
  for (let b = 0; b < 4; b++) acc += pearson(fp[b].subarray(h(aS), h(aS) + n), fp[b].subarray(h(bS), h(bS) + n), 0);
  return acc / 4;
}

function waveformSimilarity(a, b) {
  // 10 s excerpt from 60 s, box-decimated by 11 (~4 kHz), best normalised cross-correlation within +-0.25 s
  const D = 11, start = 60 * SR, len = 10 * SR;
  const dec = (pcm) => { const n = Math.floor(Math.min(len, pcm.length - start) / D), o = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < D; k++) s += pcm[start + i * D + k]; o[i] = s / D; } return o; };
  const x = dec(a), y = dec(b), maxLag = Math.round(0.25 * SR / D);
  let best = { r: -1, lag: 0 };
  for (let lag = -maxLag; lag <= maxLag; lag++) { const r = pearson(x, y, lag); if (r > best.r) best = { r, lag }; }
  return { r: +best.r.toFixed(3), lagS: +(best.lag * D / SR).toFixed(3) };
}

function similarity(a, b) {
  const maxLag = Math.round(FP_MAX_LAG_S / FP_HOP_S);
  let best = { r: -1, lag: 0 };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const r = [0, 1, 2, 3].reduce((acc, band) => acc + pearson(a[band], b[band], lag), 0) / 4;
    if (r > best.r) best = { r, lag };
  }
  return { r: best.r, lagS: +(best.lag * FP_HOP_S).toFixed(2) };
}

function measure(file) {
  const pcm = decode(file);
  const thr = Math.pow(10, SILENCE_DB / 20);
  let first = 0; while (first < pcm.length && Math.abs(pcm[first]) < thr) first++;
  let last = pcm.length - 1; while (last > 0 && Math.abs(pcm[last]) < thr) last--;
  const env = rmsEnvelope(pcm, HOP_S);
  const body = env.slice(Math.floor(env.length * 0.3), Math.floor(env.length * 0.7));
  const bodyRef = median(body);
  let endW = env.length - 1;
  while (endW > 0 && env[endW] < bodyRef - BODY_TOL_DB) endW--;
  // Sustained body entry: tracks 1/2/6 have build-ups 8-10 dB under the body with single hits that would
  // satisfy a one-window test; require the window itself and the median of the next BODY_HOLD_S to be in.
  const hold = Math.round(BODY_HOLD_S / HOP_S), near = Math.round(2 / HOP_S);
  const inBody = (w) => env[w] >= bodyRef - BODY_ENTER_DB && median(env.slice(w, w + near)) >= bodyRef - BODY_ENTER_DB && median(env.slice(w, w + hold)) >= bodyRef - BODY_ENTER_DB;
  let bodyW = 0;
  while (bodyW < env.length - hold && !inBody(bodyW)) bodyW++;
  const firstAudio = first / SR, lastAudio = (last + 1) / SR;
  const bodyStart = bodyW * HOP_S;
  const rawEnd = endW * HOP_S;

  // Onset envelope at 5 ms for loopStart snapping, the beat-aligned loop end and the tempo check.
  const onset = onsetEnvelope(pcm, ONSET_HOP_S, ONSET_WIN_S);
  const E = onset.env, idx = onset.indexOf, tOf = onset.timeOf;
  const bodyThr = median(E.slice(idx(bodyStart + 1), idx(Math.min(rawEnd, bodyStart + 61)))) * 2;
  let loopStart = firstAudio, loopStartRule = "firstAudio";
  if (bodyStart - firstAudio >= LEAD_IN_MIN_S) {
    let bi = idx(bodyStart), bv = -1;
    for (let i = idx(bodyStart - 0.15); i <= idx(bodyStart + 0.15); i++) if (E[i] > bv) { bv = E[i]; bi = i; }
    loopStart = Math.max(firstAudio, tOf(bi) - 0.005);
    loopStartRule = "bodyStart onset";
  }
  const fp = fingerprint(pcm, FP_HOP_S);
  const tp = tempo(onset, ONSET_HOP_S, bodyStart + 1, Math.min(rawEnd, bodyStart + 61));
  const gridOk = tp.r >= 0.3;
  const barS = 4 * tp.beatS;
  // First beat after loopStart (b0) and the beat near the end (bEnd) it must coincide with during the fade.
  const minGap = Math.round(0.25 * tp.beatS / ONSET_HOP_S);
  const early = peaks(E, idx(loopStart), idx(loopStart + 0.6), minGap, bodyThr * 0.5);
  const b0 = early.length ? tOf(early.reduce((m, p) => (p.v > m.v ? p : m)).i) : loopStart;
  const d = b0 - loopStart;
  const xHi = rawEnd - LOOP_FADE_S, xLo = Math.max(loopStart + 10, xHi - SEARCH_BARS * barS);
  const cands = peaks(E, idx(xLo + d), idx(xHi + d) + 1, minGap, bodyThr).map((p) => {
    const t = tOf(p.i), k = (t - b0) / tp.beatS, beatErr = Math.abs(k - Math.round(k)), bar = ((Math.round(k) % 4) + 4) % 4;
    return { t, v: p.v, k, beatErr, bar };
  });
  const byStrength = (a, b) => b.v - a.v;
  let pick = null, rule = "strongest onset";
  if (gridOk) {
    const onBeat = cands.filter((c) => c.beatErr <= 0.2);
    const onBar = onBeat.filter((c) => c.bar === 0);
    if (onBar.length) { pick = onBar.sort(byStrength)[0]; rule = "downbeat (grid from b0)"; }
    else if (onBeat.length) { pick = onBeat.sort(byStrength)[0]; rule = "on-beat (grid from b0)"; }
  }
  if (!pick && cands.length) pick = cands.sort(byStrength)[0];
  const bEnd = pick ? pick.t : xHi + d;
  const X = +(bEnd - d).toFixed(3);
  const loopEnd = +(X + LOOP_FADE_S).toFixed(2);
  const beats = (bEnd - b0) / tp.beatS;
  const match = sectionMatch(fp, loopStart, X, 2.0);
  const tail = Array.from(env.slice(Math.max(0, endW - 20), env.length)).map((v) => Math.round(v));
  const head = Array.from(env.slice(0, 30)).map((v) => Math.round(v));
  return {
    file: path.basename(file), duration: +(pcm.length / SR).toFixed(3),
    firstAudio: +firstAudio.toFixed(3), lastAudio: +lastAudio.toFixed(3),
    bodyRmsDb: +bodyRef.toFixed(1), bodyStart: +bodyStart.toFixed(1), rawEnd: +rawEnd.toFixed(1), fadeSeconds: +(lastAudio - rawEnd).toFixed(1),
    loopStart: +loopStart.toFixed(2), loopStartRule, loopEnd, alignPoint: X, endRule: rule, firstBeat: +b0.toFixed(3), endBeat: +bEnd.toFixed(3),
    bpm: +tp.bpm.toFixed(2), beatAcR: tp.r, gridOk, beatsFirstToEnd: +beats.toFixed(2), beatPhaseError: +Math.abs(beats - Math.round(beats)).toFixed(2),
    sectionMatchR: +match.toFixed(3), candidates: cands.length, rawTable: [+firstAudio.toFixed(2), +rawEnd.toFixed(1)],
    rmsDbFirst3s: head, rmsDbAroundRawEnd: tail, fp, pcm
  };
}

const files = process.argv.slice(2);
const tracks = files.map(measure);
for (const t of tracks) {
  const { fp, pcm, ...rest } = t;
  console.log(JSON.stringify(rest));
}
console.log("\nsimilarity (best-lag Pearson r of detrended 4-band energy envelopes; same song > 0.6):");
const names = tracks.map((t) => (t.file.match(/_(\d)\./) || [, "?"])[1]);
let best = { r: -1 };
const sim = tracks.map(() => []);
for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
  const s = similarity(tracks[i].fp, tracks[j].fp);
  sim[i][j] = sim[j][i] = s;
  if (s.r > best.r) best = { ...s, i, j };
}
for (let i = 0; i < tracks.length; i++) {
  const row = tracks.map((_, j) => (j === i ? "   -   " : `${sim[i][j].r.toFixed(2)}@${String(sim[i][j].lagS).padStart(5)}`));
  console.log(`  track ${names[i]}: ${row.join("  ")}`);
}
console.log(`  -> duplicate pair: track ${names[best.i]} and track ${names[best.j]} (r=${best.r.toFixed(3)} at lag ${best.lagS}s), MUSIC indices ${best.i} and ${best.j}`);
let runner = { r: -1 };
for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
  if ((i === best.i && j === best.j) || sim[i][j].r <= runner.r) continue;
  runner = { ...sim[i][j], i, j };
}
const w1 = waveformSimilarity(tracks[best.i].pcm, tracks[best.j].pcm);
const w2 = waveformSimilarity(tracks[runner.i].pcm, tracks[runner.j].pcm);
console.log(`  waveform check (10 s @ 60 s): pair ${names[best.i]}/${names[best.j]} r=${w1.r} lag ${w1.lagS}s; runner-up ${names[runner.i]}/${names[runner.j]} r=${w2.r} lag ${w2.lagS}s`);
console.log("\nloop points (loopEnd = X + 0.6 where X is beat-aligned with loopStart; bpm, beats from the first body beat to the end beat, section match r):");
for (const t of tracks) console.log(`  ${t.file}: [${t.loopStart}, ${t.loopEnd}]  start: ${t.loopStartRule}; end: ${t.endRule}; ${t.bpm} bpm (ac r ${t.beatAcR}${t.gridOk ? "" : ", grid not trusted"}); ${t.beatsFirstToEnd} beats (phase error ${t.beatPhaseError}); section match r=${t.sectionMatchR}`);
console.log("\nMUSIC_LOOP raw (firstAudio, rawEnd)  = " + JSON.stringify(tracks.map((t) => t.rawTable)) + ";");
console.log("MUSIC_LOOP adopted (body-start, beat-aligned) = " + JSON.stringify(tracks.map((t) => [t.loopStart, t.loopEnd])) + ";");
EOF_NODE
