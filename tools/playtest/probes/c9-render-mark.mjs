// Renders assets/ui/mark.svg to assets/ui/apple-touch-icon.png (180x180, opaque #0B1030 behind the rounded square)
// with the Playwright Chrome already installed for the harness, so no image library is needed.
// Usage: node probes/c9-render-mark.mjs [--size 180] [--out ../../assets/ui/apple-touch-icon.png]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith("--")) ? arr[i + 1] : "true"]);
  return acc;
}, []));
const SIZE = Number(args.size || 180);
const OUT = path.resolve(HERE, args.out || path.join(ROOT, "assets/ui/apple-touch-icon.png"));
const svg = fs.readFileSync(path.join(ROOT, "assets/ui/mark.svg"), "utf8");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html><body style="margin:0;background:#0B1030;width:${SIZE}px;height:${SIZE}px;overflow:hidden">
  <img id="m" alt="" style="display:block;width:${SIZE}px;height:${SIZE}px" src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}"></body></html>`);
await page.waitForFunction(() => { const i = document.getElementById("m"); return i && i.complete && i.naturalWidth > 0; });
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: SIZE, height: SIZE }, omitBackground: false });
await browser.close();
const bytes = fs.statSync(OUT).size;
console.log(JSON.stringify({ out: OUT, size: SIZE, bytes }));
