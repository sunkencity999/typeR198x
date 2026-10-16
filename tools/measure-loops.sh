#!/usr/bin/env bash
# Measures the music loop points used by assets/audio/sfx.js (MUSIC_LOOP) and finds
# which two of the six "Galactic High Score" tracks are the same song (MUSIC_FOR_LEVEL).
#
# Usage: tools/measure-loops.sh [audio-dir]      (default: assets/opt/audio, the MP3 encodes)
# Prints one JSON object per track, a pairwise similarity table and a paste-ready
# MUSIC_LOOP line. Requires ffmpeg + node (both already needed by the asset pipeline).
#
# Method (mirrored in the comment above MUSIC_LOOP in sfx.js):
#   1. ffmpeg decodes each file to mono float PCM at 44.1 kHz. ffmpeg honours the LAME
#      gapless header exactly like the browser decoders do, so the timestamps below are
#      the ones HTMLMediaElement.currentTime reports (the WAV masters have the same
#      length to the sample, so the table is valid for the legacy WAV fallback too).
#   2. loopStart = time of the first sample above -50 dBFS (skips the lead-in silence). bodyStart
#      (first 100 ms window within 6 dB of the body median) is printed for information: tracks
#      1, 2 and 6 have quiet lead-ins between loopStart and bodyStart.
#   3. An RMS envelope is taken with a 100 ms hop. bodyRef = median window RMS over the
#      middle 40 % of the track. The trailing fade/silence is the run of windows at the
#      end that never come back within 3 dB of bodyRef; loopEnd = the start of the last
#      window that is still within 3 dB of bodyRef. sfx.js crossfades into loopStart
#      over the 0.6 s before loopEnd (equal power), so loopEnd does not need to sit on
#      a beat, it only needs to be before the fade.
#   4. Duplicate song: a 4-band energy envelope (one-pole splits at 200/800/3200 Hz,
#      50 ms hop, dB) is detrended with a 1.5 s moving average so only the short-term
#      rhythmic/spectral detail is left, z-normalised per band, and compared pairwise
#      with Pearson correlation at every lag within +-3 s (the two encodes of one song
#      have different lead-ins). The best lag's r > 0.6 means the same song; unrelated
#      songs stay below 0.15 even at their best lag.
#   5. Confirmation: the best pair and the runner-up are also compared at waveform level
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

node - "${FILES[@]}" <<'EOF'
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const SR = 44100;
const SILENCE_DB = -50;          // "audio present" threshold for loopStart / end of audio
const HOP_S = 0.1;               // RMS envelope hop
const BODY_TOL_DB = 3;           // a window within this of the body median is still "the body"
const FP_HOP_S = 0.05;           // fingerprint hop
const FP_DETREND_S = 1.5;        // moving-average window removed from the fingerprint
const FP_MAX_LAG_S = 3;          // lag search range for the duplicate test
const SPLITS = [200, 800, 3200]; // one-pole band splits for the fingerprint

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

function fingerprint(pcm, hopS) {
  // 4 band energies per hop via cascaded one-pole lowpass filters, dB, z-normalised per band.
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

function pearson(x, y, lag) {
  // correlation of x[i] with y[i + lag] over the overlap
  const start = Math.max(0, -lag), end = Math.min(x.length, y.length - lag), n = end - start;
  let mx = 0, my = 0; for (let i = start; i < end; i++) { mx += x[i]; my += y[i + lag]; } mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = start; i < end; i++) { const dx = x[i] - mx, dy = y[i + lag] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy || 1);
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

function waveformSimilarity(a, b) {
  // 10 s excerpt from 60 s, box-decimated by 11 (~4 kHz), best normalised cross-correlation within +-0.25 s
  const D = 11, start = 60 * SR, len = 10 * SR;
  const dec = (pcm) => { const n = Math.floor(Math.min(len, pcm.length - start) / D), o = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < D; k++) s += pcm[start + i * D + k]; o[i] = s / D; } return o; };
  const x = dec(a), y = dec(b), maxLag = Math.round(0.25 * SR / D);
  let best = { r: -1, lag: 0 };
  for (let lag = -maxLag; lag <= maxLag; lag++) { const r = pearson(x, y, lag); if (r > best.r) best = { r, lag }; }
  return { r: +best.r.toFixed(3), lagS: +(best.lag * D / SR).toFixed(3) };
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
  let bodyW = 0; while (bodyW < env.length && env[bodyW] < bodyRef - 6) bodyW++; // informational: where the track gets loud
  const loopStart = +(first / SR).toFixed(2);
  const loopEnd = +(endW * HOP_S).toFixed(1);
  const tail = Array.from(env.slice(Math.max(0, endW - 20), env.length)).map((v) => Math.round(v));
  const head = Array.from(env.slice(0, 30)).map((v) => Math.round(v));
  return {
    file: path.basename(file), duration: +(pcm.length / SR).toFixed(3),
    firstAudio: +(first / SR).toFixed(3), lastAudio: +((last + 1) / SR).toFixed(3),
    bodyRmsDb: +bodyRef.toFixed(1), loopStart, bodyStart: +(bodyW * HOP_S).toFixed(1), loopEnd, fadeSeconds: +(((last + 1) / SR) - loopEnd).toFixed(1),
    rmsDbFirst3s: head, rmsDbAroundLoopEnd: tail, fp: fingerprint(pcm, FP_HOP_S), pcm
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
console.log("\nMUSIC_LOOP = " + JSON.stringify(tracks.map((t) => [t.loopStart, t.loopEnd])) + ";");
EOF
