#!/usr/bin/env node
// tools/gen-pwa-icons.mjs [--root <dir>]
//
// Renders the PWA icons that site.webmanifest lists from assets/ui/mark.svg's glyph (the gradient T) with Playwright's
// Chrome (tools/playtest/node_modules; `cd tools/playtest && npm install` once):
//   assets/ui/icons/icon-192.png, icon-512.png                  purpose "any": dark rounded tile (#0B1030, 22 % radius,
//                                                               faint cyan edge like mark.svg), glyph at 64 % of the tile,
//                                                               transparent corners
//   assets/ui/icons/icon-maskable-192.png, icon-maskable-512.png purpose "maskable": full-bleed #0B1030, glyph at 46 %
//                                                               so it stays inside the 80 % safe zone of any mask
// Deterministic (no noise, no time); re-run after changing mark.svg. Exit 1 when Playwright is missing.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let ROOT = path.resolve(HERE, "..");
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--root") ROOT = path.resolve(argv[++i] || "");
  else if (argv[i] === "-h" || argv[i] === "--help") { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(0); }
}

let chromium;
try {
  const require = createRequire(path.join(ROOT, "tools/playtest/package.json"));
  ({ chromium } = require("playwright"));
} catch (e) {
  console.error("playwright not found: run `cd tools/playtest && npm install` first");
  process.exit(1);
}

const OUT = path.join(ROOT, "assets/ui/icons");
fs.mkdirSync(OUT, { recursive: true });

// The glyph of assets/ui/mark.svg (its rect is replaced by the CSS tile so the corners can be transparent).
const GLYPH = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="16" y1="16" x2="48" y2="48">
      <stop offset="0" stop-color="#39F5FF"/><stop offset="0.55" stop-color="#FF39D1"/><stop offset="1" stop-color="#A8FF3A"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <g filter="url(#glow)" stroke="url(#g)" stroke-width="8" stroke-linecap="round" fill="none"><path d="M16 20H48"/><path d="M32 20V48"/></g>
</svg>`;

const page = (size, maskable) => {
  const glyph = Math.round(size * (maskable ? 0.46 : 0.64));
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const edge = maskable ? "" : `box-shadow: inset 0 0 0 ${Math.max(1, Math.round(size / 64))}px rgba(57,245,255,0.45);`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; }
    #tile { width: ${size}px; height: ${size}px; border-radius: ${radius}px; background: #0B1030; ${edge} display: grid; place-items: center; overflow: hidden; }
    svg { display: block; }
  </style></head><body><div id="tile">${GLYPH(glyph)}</div></body></html>`;
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const jobs = [[192, false, "icon-192.png"], [512, false, "icon-512.png"], [192, true, "icon-maskable-192.png"], [512, true, "icon-maskable-512.png"]];
  for (const [size, maskable, name] of jobs) {
    await p.setContent(page(size, maskable));
    const file = path.join(OUT, name);
    await p.locator("#tile").screenshot({ path: file, omitBackground: !maskable, type: "png" });
    console.log(`${path.relative(ROOT, file)}  ${size}x${size}  ${fs.statSync(file).size} B`);
  }
} finally {
  await browser.close();
}
