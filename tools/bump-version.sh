#!/usr/bin/env bash
# tools/bump-version.sh [token] [--root <dir>] [--dry-run] [--add-missing] [--quiet]
#
# The single writer of the web shell's version token (PLAN A10 / contract "Version token").
# Rewrites, in one pass:
#   * <meta name="asset-version" content="...">            (when present)
#   * every ?v=<token> on <link>/<script>/<img> tags        in index.html, info.html, support.html,
#                                                          privacy-policy.html, privacy.html (when present)
#   * every ?v=<token> on <a href> links and the privacy.html meta-refresh url in those pages: the host serves *.html
#     with max-age=15552000 and ignores the query, so the in-site links carry the shell token to reach a browser that
#     cached an older page (release 20261024a, findings CT-02 / R2). Links without a ?v= are left alone.
#   * const ASSET_VERSION = "...";                         in game.js
#   * const SW_VERSION = "...";  and every ?v=<token> in the PRECACHE list   in sw.js (when present; PLATFORM): the
#     service worker is versioned by the shell token (a new token = a new worker, a new shell cache and the "new
#     version ready" toast), and its precache URLs must be the exact URLs the new shell requests (same URL rule as the
#     pages, assets/opt entries -> ART token). The list itself is written by tools/gen-sw-precache.mjs.
# and leaves the withAssetVersion literal line (`return `${path}${sep}v=${ASSET_VERSION}`;`) untouched,
# because native/sync-web.sh patches that exact line by sed.
#
# URL rule: tags whose href/src points under assets/opt/ (except manifest.js itself) belong to the ART
# token and are rewritten to assets/opt/manifest.json's "version"; everything else gets the shell token.
#
# token      YYYYMMDDx (e.g. 20261016a). Omitted: today's date + the next letter after the current token.
# --root     repository root to rewrite (default: the parent of this script's directory). Point it at a
#            temporary copy to rehearse a bump without touching the real files.
# --dry-run  report what would change, write nothing.
# --add-missing  also append ?v=<token> to local <link rel=stylesheet|preload> and <script src> tags
#            that have no version yet (off by default: the html owners add the first token by hand).
#            Font preloads (as="font") are skipped: their href must stay byte-identical to the @font-face
#            url() in assets/style/tokens.css or the browser fetches the font twice (review R40).
# Idempotent: a second run with the same token reports "no changes" and writes nothing. Exit 0 on success,
# 1 when index.html or game.js is missing, 2 on usage errors.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TOKEN=""
DRY=0
ADD_MISSING=0
QUIET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$(cd "$2" && pwd)"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --add-missing) ADD_MISSING=1; shift ;;
    --quiet) QUIET=1; shift ;;
    -h|--help) awk 'NR > 1 && !/^#/ { exit } NR > 1 { print }' "$0"; exit 0 ;;
    --*) echo "unknown option: $1" >&2; exit 2 ;;
    *) if [[ -n "$TOKEN" ]]; then echo "unexpected argument: $1" >&2; exit 2; fi; TOKEN="$1"; shift ;;
  esac
done

if [[ -n "$TOKEN" && ! "$TOKEN" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "token must match [A-Za-z0-9._-]+ (got: $TOKEN)" >&2
  exit 2
fi
for required in index.html game.js; do
  if [[ ! -f "$ROOT/$required" ]]; then echo "missing $ROOT/$required" >&2; exit 1; fi
done
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }

export BV_ROOT="$ROOT" BV_TOKEN="$TOKEN" BV_DRY="$DRY" BV_ADD_MISSING="$ADD_MISSING" BV_QUIET="$QUIET"
node - <<'NODE'
const fs = require("fs");
const path = require("path");
const ROOT = process.env.BV_ROOT;
const DRY = process.env.BV_DRY === "1";
const ADD_MISSING = process.env.BV_ADD_MISSING === "1";
const QUIET = process.env.BV_QUIET === "1";
const HTML_FILES = ["index.html", "info.html", "support.html", "privacy-policy.html", "privacy.html"];
const LITERAL = "return `${path}${sep}v=${ASSET_VERSION}`;";

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));

// --- current tokens -----------------------------------------------------------------------
const indexSrc = read("index.html");
const gameSrc = read("game.js");
const metaRe = /(<meta\b[^>]*\bname=["']asset-version["'][^>]*\bcontent=["'])([^"']*)(["'])/i;
const metaReAlt = /(<meta\b[^>]*\bcontent=["'])([^"']*)(["'][^>]*\bname=["']asset-version["'])/i;
const assetVersionRe = /(const\s+ASSET_VERSION\s*=\s*["'])([^"']*)(["'])/;
const currentShell = (indexSrc.match(metaRe) || indexSrc.match(metaReAlt) || [])[2]
  || (indexSrc.match(/<script\b[^>]*\bsrc=["'][^"']*[?&]v=([^"'&]+)/i) || [])[1]
  || (gameSrc.match(assetVersionRe) || [])[2]
  || "";

let TOKEN = process.env.BV_TOKEN;
if (!TOKEN) {
  const d = new Date();
  const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  if (currentShell.startsWith(today) && /^[a-y]$/.test(currentShell.slice(8))) TOKEN = today + String.fromCharCode(currentShell.charCodeAt(8) + 1);
  else TOKEN = today + "a";
}
let ART = null;
if (exists("assets/opt/manifest.json")) {
  try { ART = JSON.parse(read("assets/opt/manifest.json")).version || null; } catch { ART = null; }
}

const summary = [];
let totalChanges = 0;
const diffs = [];

function rewriteHtml(file) {
  const src = read(file);
  let out = src;
  let replaced = 0, added = 0, artCount = 0;
  const bump = (tag) => {
    const m = tag.match(/\b(href|src)=(["'])([^"']*)\2/i);
    if (!m) return tag;
    const url = m[3];
    if (/^(https?:)?\/\//i.test(url) || /^(data|mailto|javascript):/i.test(url)) return tag;
    const isOpt = /(^|\/)assets\/opt\//.test(url) && !/manifest\.js(\?|$)/.test(url);
    const token = (isOpt && ART) ? ART : TOKEN;
    if (/[?&]v=/.test(url)) {
      const next = url.replace(/([?&]v=)[^"'&]*/, `$1${token}`);
      if (next !== url) { replaced++; if (isOpt && ART) artCount++; }
      return tag.replace(m[0], `${m[1]}=${m[2]}${next}${m[2]}`);
    }
    if (ADD_MISSING) {
      const isScript = /^<script/i.test(tag);
      const isVersionedLink = /^<link/i.test(tag) && /\brel=["'](stylesheet|preload|modulepreload)["']/i.test(tag) && !/\bas=["']font["']/i.test(tag); // review R40
      if (isScript || isVersionedLink) {
        const next = `${url}${url.includes("?") ? "&" : "?"}v=${token}`;
        added++;
        return tag.replace(m[0], `${m[1]}=${m[2]}${next}${m[2]}`);
      }
    }
    return tag;
  };
  out = out.replace(/<(?:link|script|img|a)\b[^>]*>/gi, bump); // img: the ship cards carry the ART token (review R39); a: in-site page links
  out = out.replace(/(<meta\b[^>]*\bhttp-equiv=["']refresh["'][^>]*\bcontent=["'][^"']*\burl=[^"'?]*\?(?:[^"']*&)?v=)([^"'&]*)/gi, (m, a, old) => {
    if (old !== TOKEN) replaced++;
    return `${a}${TOKEN}`;
  });
  let metaHit = false;
  out = out.replace(metaRe, (_, a, old, c) => { metaHit = true; if (old !== TOKEN) replaced++; return `${a}${TOKEN}${c}`; });
  if (!metaHit) out = out.replace(metaReAlt, (_, a, old, c) => { metaHit = true; if (old !== TOKEN) replaced++; return `${a}${TOKEN}${c}`; });
  return { src, out, replaced, added, artCount, metaHit };
}

function rewriteGame() {
  const src = gameSrc;
  let replaced = 0;
  const out = src.replace(assetVersionRe, (_, a, old, c) => { if (old !== TOKEN) replaced++; return `${a}${TOKEN}${c}`; });
  const hasConst = assetVersionRe.test(src);
  const literalOk = out.includes(LITERAL) && src.includes(LITERAL);
  return { src, out, replaced, hasConst, literalOk };
}

// sw.js (PLATFORM): SW_VERSION takes the shell token; every quoted "...?v=<token>" string (the PRECACHE list) follows the
// URL rule of the pages (assets/opt -> ART token, else shell token). Nothing else in the file is touched.
const swVersionRe = /(const\s+SW_VERSION\s*=\s*["'])([^"']*)(["'])/;
function rewriteSw() {
  const src = read("sw.js");
  let replaced = 0, artCount = 0;
  let out = src.replace(swVersionRe, (_, a, old, c) => `${a}${TOKEN}${c}`);   // the const is reported on its own below
  out = out.replace(/(["'])([^"'\s]*?[?&]v=)([^"'&\s]*)(\1)/g, (m, q, pre, old, q2) => {
    const isOpt = /(^|\/)assets\/opt\//.test(pre) && !/manifest\.js\?/.test(pre);
    const token = (isOpt && ART) ? ART : TOKEN;
    if (old !== token) { replaced++; if (isOpt && ART) artCount++; }
    return `${q}${pre}${token}${q2}`;
  });
  return { src, out, replaced, artCount, hasConst: swVersionRe.test(src) };
}

function lineDiff(file, a, b) {
  const al = a.split("\n"), bl = b.split("\n");
  const lines = [];
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) if (al[i] !== bl[i]) { lines.push(`  -${i + 1}: ${(al[i] ?? "").trim()}`); lines.push(`  +${i + 1}: ${(bl[i] ?? "").trim()}`); }
  return lines.length ? [`--- ${file}`, ...lines] : [];
}

for (const f of HTML_FILES) {
  if (!exists(f)) continue;
  const r = rewriteHtml(f);
  const changed = r.out !== r.src;
  summary.push(`${f.padEnd(20)} ${changed ? "rewrite" : "ok     "}  ?v= rewritten: ${r.replaced}${r.artCount ? ` (${r.artCount} opt -> ${ART})` : ""}${r.added ? `, added: ${r.added}` : ""}${r.metaHit ? ", meta: yes" : ", meta: none"}`);
  if (changed) { totalChanges++; diffs.push(...lineDiff(f, r.src, r.out)); if (!DRY) fs.writeFileSync(path.join(ROOT, f), r.out); }
}
{
  const r = rewriteGame();
  const changed = r.out !== r.src;
  summary.push(`${"game.js".padEnd(20)} ${changed ? "rewrite" : "ok     "}  ASSET_VERSION: ${r.hasConst ? (changed ? "updated" : "unchanged") : "NOT FOUND"}, withAssetVersion literal: ${r.literalOk ? "intact" : "MISSING"}`);
  if (!r.hasConst) process.exitCode = 1;
  if (!r.literalOk) { console.error("warning: game.js no longer contains the withAssetVersion literal line that native/sync-web.sh patches"); }
  if (changed) { totalChanges++; diffs.push(...lineDiff("game.js", r.src, r.out)); if (!DRY) fs.writeFileSync(path.join(ROOT, "game.js"), r.out); }
}
if (exists("sw.js")) {
  const r = rewriteSw();
  const changed = r.out !== r.src;
  summary.push(`${"sw.js".padEnd(20)} ${changed ? "rewrite" : "ok     "}  SW_VERSION: ${r.hasConst ? (changed && swVersionRe.exec(r.src)[2] !== TOKEN ? "updated" : "unchanged") : "NOT FOUND"}, precache ?v= rewritten: ${r.replaced}${r.artCount ? ` (${r.artCount} opt -> ${ART})` : ""}`);
  if (!r.hasConst) { console.error("warning: sw.js has no `const SW_VERSION = \"...\"` line; the service worker will not be versioned by this token"); }
  if (changed) { totalChanges++; diffs.push(...lineDiff("sw.js", r.src, r.out)); if (!DRY) fs.writeFileSync(path.join(ROOT, "sw.js"), r.out); }
}

console.log(`bump-version: shell token ${currentShell || "(none)"} -> ${TOKEN}${ART ? `, art token ${ART} (assets/opt/manifest.json)` : ""}${DRY ? " [dry run]" : ""}`);
for (const s of summary) console.log("  " + s);
if (!QUIET && diffs.length) { console.log("diff:"); for (const d of diffs) console.log(d); }
if (!totalChanges) console.log("no changes (already at this token)");

// Informational: other version strings that still carry an old-looking token.
const stale = [];
for (const f of ["index.html", "game.js", "assets/audio/sfx.js", "sw.js"]) {
  if (!exists(f)) continue;
  read(f).split("\n").forEach((line, i) => {
    const m = line.match(/\bv=(20\d{6}[a-z]?)\b/) || line.match(/VERSION\s*=\s*["']([^"']+)["']/);
    // review R44: in a dry run game.js's own ASSET_VERSION line is the one this script rewrites, not a stale string
    if (DRY && f === "game.js" && assetVersionRe.test(line)) return;
    if (DRY && f === "sw.js" && (swVersionRe.test(line) || /[?&]v=/.test(line))) return;   // the SW_VERSION and PRECACHE lines are rewritten too
    if (m && m[1] !== TOKEN && m[1] !== ART && !(DRY && m[1] === currentShell) && !line.includes("${ASSET_VERSION}")) stale.push(`  ${f}:${i + 1}: ${line.trim()}`);
  });
}
if (stale.length) { console.log("note: other version strings not managed by this script:"); stale.forEach(s => console.log(s)); }
NODE
