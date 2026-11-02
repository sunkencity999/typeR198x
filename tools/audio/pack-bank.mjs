#!/usr/bin/env node
// Type-R 198X — packs a directory of 16-bit mono WAV cues into one MP3 sample bank plus a cue table.
//
//   node tools/audio/pack-bank.mjs --dir assets/audio/sfx --out assets/opt/audio/sfx-bank [--q 4] [--gap 0.03]
//
// Reads <dir>/index.json (from gen_sfx.py / gen_vo.py: { sampleRate, cues: { name: { files, trim, voices, jitter,
// priority? } } }), lays the files out with `gap` seconds of silence between them behind a 10 ms 1 kHz alignment
// marker at MARKER_AT, encodes the whole thing with libmp3lame (-q:a <q>, mono, the index sample rate) and writes
// <out>.json: { src, rate, marker, cues: { name: { trim, voices, jitter, priority?, v: [[offset, dur], ...] } } }.
// The runtime (assets/audio/sfx.js) decodes the bank once, finds the marker to cancel any decoder pre-roll, and
// plays cues as AudioBufferSourceNode(offset, dur) voices. One request + one decode for the whole set.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith("--")) ? arr[i + 1] : "true"]);
  return acc;
}, []));
if (!args.dir || !args.out) { console.error("usage: pack-bank.mjs --dir <wavdir> --out <path-without-ext> [--q 4] [--gap 0.03]"); process.exit(2); }
const DIR = path.resolve(args.dir);
const OUT = path.resolve(args.out);
const Q = Number(args.q || 4);
const GAP = Number(args.gap || 0.03);
const MARKER_AT = 0.05, MARKER_DUR = 0.01, LEAD = 0.1;

const index = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8"));
const rate = index.sampleRate | 0;
if (!rate) throw new Error("index.json has no sampleRate");

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${file}: not a RIFF WAVE`);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { format: b.readUInt16LE(p + 8), channels: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === "data") data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: missing fmt/data`);
  if (fmt.format !== 1 || fmt.channels !== 1 || fmt.bits !== 16 || fmt.rate !== rate) throw new Error(`${file}: need PCM16 mono @${rate}, got fmt ${fmt.format} ch ${fmt.channels} bits ${fmt.bits} rate ${fmt.rate}`);
  return new Int16Array(data.buffer, data.byteOffset, data.length >> 1);
}

const cues = {};
const parts = [];
let cursor = Math.round(LEAD * rate);
// marker
const marker = new Int16Array(Math.round(MARKER_DUR * rate));
for (let i = 0; i < marker.length; i++) {
  const t = i / rate + 0.00025, fadeN = Math.round(0.001 * rate);   // +90 degrees: the first sample is already at -6 dBFS
  const env = Math.min(1, (marker.length - 1 - i) / fadeN);   // instant onset (the runtime detects it), 1 ms fade-out
  marker[i] = Math.round(Math.sin(2 * Math.PI * 1000 * t) * 0.5 * 32767 * Math.max(0, env));
}
parts.push({ at: Math.round(MARKER_AT * rate), pcm: marker });
const gapN = Math.round(GAP * rate);
for (const [name, cue] of Object.entries(index.cues)) {
  const v = [];
  for (const f of cue.files) {
    const pcm = readWav(path.join(DIR, f));
    parts.push({ at: cursor, pcm });
    v.push([+(cursor / rate).toFixed(5), +(pcm.length / rate).toFixed(5)]);
    cursor += pcm.length + gapN;
  }
  const entry = { trim: cue.trim, voices: cue.voices, jitter: cue.jitter, v };
  if (cue.priority != null) entry.priority = cue.priority;
  cues[name] = entry;
}
const total = cursor + Math.round(0.05 * rate);
const bank = new Int16Array(total);
for (const { at, pcm } of parts) bank.set(pcm, at);

// temp wav -> mp3
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "typer-bank-"));
const wav = path.join(tmp, "bank.wav");
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + bank.byteLength, 4); hdr.write("WAVE", 8); hdr.write("fmt ", 12);
hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
hdr.write("data", 36); hdr.writeUInt32LE(bank.byteLength, 40);
fs.writeFileSync(wav, Buffer.concat([hdr, Buffer.from(bank.buffer)]));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const mp3 = OUT + ".mp3";
const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", wav, "-codec:a", "libmp3lame", "-q:a", String(Q), "-ac", "1", "-ar", String(rate), "-map_metadata", "-1", mp3], { stdio: "inherit" });
fs.rmSync(tmp, { recursive: true, force: true });
if (ff.status !== 0) { console.error("ffmpeg failed"); process.exit(1); }

const relRoot = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".."));
const src = "./" + path.relative(relRoot, mp3).split(path.sep).join("/");
const table = { src, rate, marker: MARKER_AT, markerDur: MARKER_DUR, cues };
fs.writeFileSync(OUT + ".json", JSON.stringify(table));
const bytes = fs.statSync(mp3).size;
const n = Object.values(cues).reduce((s, c) => s + c.v.length, 0);
console.log(`bank ${path.basename(mp3)}: ${Object.keys(cues).length} cues / ${n} samples, ${(total / rate).toFixed(1)} s @ ${rate} Hz -> ${(bytes / 1024).toFixed(0)} KB (q=${Q})`);
