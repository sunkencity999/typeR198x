#!/usr/bin/env bash
# tools/deploy-check.sh <url> [--strict] [--local]        remote checks against a deployed (or local) server
# tools/deploy-check.sh --local                            native-sync non-regression only (no server needed)
#
# Remote checks (PLAN E1 / amendment E-7), each printed as PASS / WARN / FAIL:
#   * status + MIME of index.html, style.css, game.js, every <script>/<link> the served index references,
#     a WebP from the manifest, an MP3 from the manifest, the Orbitron WOFF2, privacy-policy.html
#   * every ?v= token on the served index's shell tags agrees (and with <meta name=asset-version> when present)
#   * the served game.js (or, failing that, one of the served scripts) carries the window.SFX guard
#   * `node --check` on the served game.js and sfx.js
#   * served assets/opt/manifest.js version === the local assets/opt/manifest.js version
#   * cache headers: /index.html (and /) must say no-cache or max-age=0 -> WARN, or FAIL with --strict (G025);
#     versioned URLs should be immutable / long max-age -> WARN; manifest.js should be no-cache -> WARN;
#     MP3 should advertise Accept-Ranges -> WARN
#   * the footer privacy target names the save key (typesmup198x.save.v1) and links back to the game;
#     privacy.html is a meta-refresh stub
# Local mode (--local), source checks against --root (default: this repo):
#   * every <script src> in index.html exists and passes `node --check`
#   * assets/opt/manifest.js version === assets/opt/manifest.json version (MANIFEST_ONLY=1 tools/build-web-assets.sh)
#   * tools/check-globals.sh finds no duplicate top-level declarations across the classic scripts
#   * the footer privacy link resolves to a local file that names the save key and links back to the game;
#     privacy.html carries a meta refresh; info.html / support.html / privacy-policy.html link back to the game
#   * tools/unreferenced-assets.sh totals (informational; --unreferenced-out <file> keeps the full listing)
#   * native sync dry run: copies index.html/game.js/style.css/native/sync-web.sh into a temp tree, runs the
#     sync, and asserts the `return path;` patch and the `id="loadingOverlay" class="hidden"` patch landed
#     (plus amendment B-17: in source the overlay keeps id first and has no class attribute).
# Exit 1 when any check FAILed, else 0. --strict only promotes the cache-header WARNs to FAILs.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
URL=""
STRICT=0
LOCAL=0
UNREF_OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict) STRICT=1; shift ;;
    --local) LOCAL=1; shift ;;
    --root) ROOT="$(cd "$2" && pwd)"; shift 2 ;;
    --unreferenced-out) UNREF_OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    --*) echo "unknown option: $1" >&2; exit 2 ;;
    *) URL="${1%/}"; shift ;;
  esac
done
if [[ -z "$URL" && $LOCAL -eq 0 ]]; then sed -n '2,3p' "$0"; exit 2; fi

PASS=0; WARN=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS  $*"; }
warn() { WARN=$((WARN+1)); echo "  WARN  $*"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL  $*"; }
info() { echo "  INFO  $*"; }
# strict_or_warn <ok:0|1> <message>
gate() { if [[ "$1" == "1" ]]; then pass "$2"; elif [[ $STRICT -eq 1 ]]; then fail "$2 (strict)"; else warn "$2"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
HAVE_NODE=0; command -v node >/dev/null 2>&1 && HAVE_NODE=1

# fetch <url> <outfile> [extra curl args...] -> prints the final HTTP status; headers land in <outfile>.h
fetch() {
  local u="$1" out="$2" code; shift 2
  : > "$out"; : > "$out.h"
  code=$(curl -sS -L --max-time 40 -A "typer198x-deploy-check" -o "$out" -D "$out.h" -w '%{http_code}' "$@" "$u" 2>/dev/null)
  printf '%s' "${code:-000}"
}
# hdr <headersfile> <name> -> value of the last occurrence (follows redirects), case-insensitive, lowercase output
hdr() {
  tr -d '\r' < "$1" | awk -v k="$(printf '%s' "$2" | tr 'A-Z' 'a-z')" -F': *' 'tolower($1)==k { $1=""; sub(/^: */,""); v=$0 } END { print tolower(v) }'
}
ctype() { hdr "$1" content-type | cut -d';' -f1 | tr -d ' '; }
abs() { case "$1" in http://*|https://*) printf '%s' "$1" ;; /*) printf '%s%s' "$URL" "$1" ;; ./*) printf '%s/%s' "$URL" "${1#./}" ;; *) printf '%s/%s' "$URL" "$1" ;; esac; }

# ---------------------------------------------------------------- remote checks
if [[ -n "$URL" ]]; then
  echo "deploy-check: $URL${STRICT:+ (strict=$STRICT)}"

  # index.html
  st="$(fetch "$URL/index.html" "$TMP/index.html")"
  if [[ "$st" == "200" ]]; then pass "index.html 200"; else fail "index.html status $st"; fi
  ct="$(ctype "$TMP/index.html.h")"
  [[ "$ct" == "text/html" ]] && pass "index.html Content-Type $ct" || fail "index.html Content-Type '$ct' (expected text/html)"
  cc="$(hdr "$TMP/index.html.h" cache-control)"
  if [[ "$cc" =~ no-cache|max-age=0 ]]; then okcc=1; else okcc=0; fi
  gate "$okcc" "index.html Cache-Control '${cc:-<none>}' (needs no-cache or max-age=0; amendment E-7)"
  st="$(fetch "$URL/" "$TMP/root.html")"
  cc="$(hdr "$TMP/root.html.h" cache-control)"
  if [[ "$st" == "200" ]]; then
    if [[ "$cc" =~ no-cache|max-age=0 ]]; then pass "/ Cache-Control '$cc'"; else warn "/ Cache-Control '${cc:-<none>}' (should revalidate like index.html)"; fi
  else warn "/ status $st"; fi

  # Parse the served shell
  if [[ $HAVE_NODE -eq 1 ]]; then
    echo '{"scripts":[],"styles":[],"tokens":[],"optTokens":[],"meta":null,"overlay":null,"privacy":null}' > "$TMP/shell.json"
    node - "$TMP/index.html" > "$TMP/shell.parsed" <<'NODE' && mv "$TMP/shell.parsed" "$TMP/shell.json"
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
const tags = html.match(/<(?:script|link)\b[^>]*>/gi) || [];
const scripts = [], styles = [], tokens = [], optTokens = [];
for (const t of tags) {
  const m = t.match(/\b(href|src)=["']([^"']*)["']/i); if (!m) continue;
  const url = m[2];
  if (/^(https?:)?\/\//i.test(url) || /^data:/i.test(url)) continue;
  const isScript = /^<script/i.test(t);
  const isStyle = /^<link/i.test(t) && /\brel=["']stylesheet["']/i.test(t);
  if (isScript) scripts.push(url); else if (isStyle) styles.push(url); else continue;
  const v = (url.match(/[?&]v=([^&"']+)/) || [])[1];
  if (!v) continue;
  const isOpt = /(^|\/)assets\/opt\//.test(url) && !/manifest\.js(\?|$)/.test(url);
  (isOpt ? optTokens : tokens).push(v);
}
const meta = (html.match(/<meta\b[^>]*\bname=["']asset-version["'][^>]*\bcontent=["']([^"']*)["']/i) || html.match(/<meta\b[^>]*\bcontent=["']([^"']*)["'][^>]*\bname=["']asset-version["']/i) || [])[1] || null;
const overlay = (html.match(/<div\s[^>]*id=["']loadingOverlay["'][^>]*>/i) || [])[0] || null;
const privacy = (html.match(/<a\b[^>]*href=["']([^"']*privacy[^"']*)["']/i) || [])[1] || null;
console.log(JSON.stringify({ scripts, styles, tokens, optTokens, meta, overlay, privacy }));
NODE
    SCRIPTS=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).scripts.join("\n"))' "$TMP/shell.json")
    STYLES=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).styles.join("\n"))' "$TMP/shell.json")
    TOKENS=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tokens.join("\n"))' "$TMP/shell.json")
    META=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(j.meta||"")' "$TMP/shell.json")
    PRIVACY=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(j.privacy||"")' "$TMP/shell.json")
  else
    warn "node not found: parsing the served index with grep (token/MIME checks are approximate)"
    SCRIPTS=$(grep -oiE '<script[^>]*src="[^"]*"' "$TMP/index.html" | sed -E 's/.*src="([^"]*)".*/\1/')
    STYLES=$(grep -oiE '<link[^>]*rel="stylesheet"[^>]*href="[^"]*"' "$TMP/index.html" | sed -E 's/.*href="([^"]*)".*/\1/')
    TOKENS=$(printf '%s\n%s\n' "$SCRIPTS" "$STYLES" | grep -v 'assets/opt/[^m]' | grep -oE '[?&]v=[^&"]+' | sed -E 's/^[?&]v=//')
    META=$(grep -oiE '<meta[^>]*name="asset-version"[^>]*content="[^"]*"' "$TMP/index.html" | sed -E 's/.*content="([^"]*)".*/\1/' | head -1)
    PRIVACY=$(grep -oiE 'href="[^"]*privacy[^"]*"' "$TMP/index.html" | head -1 | sed -E 's/href="([^"]*)"/\1/')
  fi

  # Token agreement
  ntok=$(printf '%s\n' "$TOKENS" | sed '/^$/d' | wc -l | tr -d ' ')
  utok=$(printf '%s\n' "$TOKENS" | sed '/^$/d' | sort -u | wc -l | tr -d ' ')
  if [[ "$ntok" == "0" ]]; then warn "served index.html has no ?v= tokens on script/link tags"
  elif [[ "$utok" == "1" ]]; then
    tok=$(printf '%s\n' "$TOKENS" | sed '/^$/d' | head -1)
    pass "all $ntok shell ?v= tokens agree ($tok)"
    if [[ -n "$META" ]]; then [[ "$META" == "$tok" ]] && pass "meta asset-version matches ($META)" || fail "meta asset-version '$META' != tag token '$tok'"; else warn "no <meta name=asset-version> in served index.html"; fi
  else fail "shell ?v= tokens disagree: $(printf '%s\n' "$TOKENS" | sed '/^$/d' | sort | uniq -c | tr -s ' ' | tr '\n' ';')"; fi

  # Every referenced script and stylesheet
  SFX_FOUND=""
  i=0
  while IFS= read -r s; do
    [[ -z "$s" ]] && continue
    i=$((i+1)); f="$TMP/script$i.js"
    st="$(fetch "$(abs "$s")" "$f")"; ct="$(ctype "$f.h")"
    if [[ "$st" != "200" ]]; then fail "script $s status $st"; continue; fi
    case "$ct" in text/javascript|application/javascript|application/x-javascript) pass "script $s 200 $ct" ;; *) fail "script $s Content-Type '$ct' (expected a JavaScript type)" ;; esac
    if grep -q 'window\.SFX' "$f"; then SFX_FOUND="${SFX_FOUND:-$s}"; fi
    case "$s" in
      *game.js*)
        grep -q 'window\.SFX' "$f" && pass "served game.js contains the window.SFX guard" || { [[ -n "$SFX_FOUND" ]] && warn "served game.js lacks window.SFX; found in $SFX_FOUND" || warn "served game.js lacks window.SFX (checking the other scripts)"; }
        if [[ $HAVE_NODE -eq 1 ]]; then node --check "$f" 2>"$TMP/chk" && pass "node --check game.js" || fail "node --check game.js: $(head -c 200 "$TMP/chk")"; fi
        cc="$(hdr "$f.h" cache-control)"
        if [[ "$s" == *"v="* ]]; then
          if [[ "$cc" =~ immutable ]] || { [[ "$cc" =~ max-age=([0-9]+) ]] && [[ ${BASH_REMATCH[1]} -ge 86400 ]]; }; then pass "versioned game.js Cache-Control '$cc'"; else warn "versioned game.js Cache-Control '${cc:-<none>}' (expected immutable / long max-age)"; fi
        fi ;;
      *sfx.js*)
        if [[ $HAVE_NODE -eq 1 ]]; then node --check "$f" 2>"$TMP/chk" && pass "node --check sfx.js" || fail "node --check sfx.js: $(head -c 200 "$TMP/chk")"; fi ;;
      *manifest.js*)
        cc="$(hdr "$f.h" cache-control)"
        [[ "$cc" =~ no-cache|no-store|max-age=0 ]] && pass "manifest.js Cache-Control '$cc'" || warn "manifest.js Cache-Control '${cc:-<none>}' (should be no-cache)" ;;
    esac
  done <<< "$SCRIPTS"
  if [[ -z "$SFX_FOUND" ]]; then fail "no served script contains the window.SFX guard"; fi
  i=0
  while IFS= read -r s; do
    [[ -z "$s" ]] && continue
    i=$((i+1)); f="$TMP/style$i.css"
    st="$(fetch "$(abs "$s")" "$f")"; ct="$(ctype "$f.h")"
    if [[ "$st" == "200" && "$ct" == "text/css" ]]; then pass "stylesheet $s 200 text/css"; else fail "stylesheet $s status $st Content-Type '$ct'"; fi
  done <<< "$STYLES"
  # style.css by its canonical path too (the shell may reference it with a token)
  st="$(fetch "$URL/style.css" "$TMP/style.css")"; ct="$(ctype "$TMP/style.css.h")"
  [[ "$st" == "200" && "$ct" == "text/css" ]] && pass "style.css 200 text/css" || fail "style.css status $st Content-Type '$ct'"

  # Manifest version
  LOCAL_MANIFEST="$ROOT/assets/opt/manifest.js"
  st="$(fetch "$URL/assets/opt/manifest.js" "$TMP/manifest.js")"
  if [[ "$st" == "200" ]]; then
    served_v=$(grep -oE '"version":"[^"]+"' "$TMP/manifest.js" | head -1 | cut -d'"' -f4)
    if [[ -f "$LOCAL_MANIFEST" ]]; then
      local_v=$(grep -oE '"version":"[^"]+"' "$LOCAL_MANIFEST" | head -1 | cut -d'"' -f4)
      [[ -n "$served_v" && "$served_v" == "$local_v" ]] && pass "manifest version matches local ($served_v)" || fail "manifest version served '$served_v' != local '$local_v'"
    else warn "no local assets/opt/manifest.js to compare (served $served_v)"; fi
  else fail "assets/opt/manifest.js status $st"; fi

  # Media + font (range requests keep this cheap)
  if [[ -f "$LOCAL_MANIFEST" ]]; then
    WEBP=$(grep -oE '"src":"[^"]+@1x\.webp"' "$LOCAL_MANIFEST" | head -1 | cut -d'"' -f4)
    MP3=$(grep -oE '"[^"]+\.mp3"' "$LOCAL_MANIFEST" | head -1 | tr -d '"')
  fi
  WEBP="${WEBP:-./assets/opt/bg/first@1x.webp}"; MP3="${MP3:-./assets/opt/audio/galactic_high_score_1.mp3}"
  st="$(fetch "$(abs "$WEBP")" "$TMP/a.webp" -r 0-1023)"; ct="$(ctype "$TMP/a.webp.h")"
  [[ ("$st" == "200" || "$st" == "206") && "$ct" == "image/webp" ]] && pass "$WEBP $st image/webp" || fail "$WEBP status $st Content-Type '$ct' (expected image/webp)"
  st="$(fetch "$(abs "$MP3")" "$TMP/a.mp3" -r 0-1023)"; ct="$(ctype "$TMP/a.mp3.h")"
  [[ ("$st" == "200" || "$st" == "206") && "$ct" == "audio/mpeg" ]] && pass "$MP3 $st audio/mpeg" || fail "$MP3 status $st Content-Type '$ct' (expected audio/mpeg)"
  ar="$(hdr "$TMP/a.mp3.h" accept-ranges)"
  [[ "$ar" == "bytes" || "$st" == "206" ]] && pass "mp3 supports range requests" || warn "mp3 has no Accept-Ranges: bytes (music seeking/loops will re-download)"
  FONT="./assets/fonts/Orbitron-Variable.woff2"
  st="$(fetch "$(abs "$FONT")" "$TMP/a.woff2" -r 0-1023)"; ct="$(ctype "$TMP/a.woff2.h")"
  case "$st:$ct" in
    20[06]:font/woff2) pass "$FONT $st font/woff2" ;;
    20[06]:application/font-woff2|20[06]:application/octet-stream) warn "$FONT served as '$ct' (works, but font/woff2 is the registered type)" ;;
    *) fail "$FONT status $st Content-Type '$ct'" ;;
  esac

  # Privacy pages
  st="$(fetch "$URL/privacy-policy.html" "$TMP/pp.html")"
  [[ "$st" == "200" ]] && pass "privacy-policy.html 200" || fail "privacy-policy.html status $st"
  if [[ -n "$PRIVACY" ]]; then
    st="$(fetch "$(abs "$PRIVACY")" "$TMP/pl.html")"
    if [[ "$st" == "200" ]]; then
      pass "footer privacy link $PRIVACY 200"
      grep -q 'typesmup198x\.save\.v1' "$TMP/pl.html" && pass "privacy target names the save key typesmup198x.save.v1" || fail "privacy target $PRIVACY does not mention typesmup198x.save.v1"
      grep -qE 'href="(\./)?index\.html"|href="\./?"' "$TMP/pl.html" && pass "privacy target links back to the game" || fail "privacy target $PRIVACY has no back link to index.html"
    else fail "footer privacy link $PRIVACY status $st"; fi
  else warn "served index.html has no footer privacy link"; fi
  st="$(fetch "$URL/privacy.html" "$TMP/pstub.html")"
  if [[ "$st" == "200" ]]; then
    grep -qiE '<meta[^>]*http-equiv="refresh"' "$TMP/pstub.html" && pass "privacy.html is a meta-refresh stub" || warn "privacy.html 200 but carries no meta refresh"
  else warn "privacy.html status $st (old links to it would 404)"; fi
fi

# ---------------------------------------------------------------- local native-sync mode
if [[ $LOCAL -eq 1 ]]; then
  echo "deploy-check: local source checks ($ROOT)"
  if [[ ! -f "$ROOT/index.html" ]]; then fail "missing $ROOT/index.html"; else
    # every <script src> in index.html exists and parses
    nscripts=0; badscripts=0
    while IFS= read -r s; do
      [[ -z "$s" ]] && continue
      case "$s" in http://*|https://*|//*) continue ;; esac
      nscripts=$((nscripts+1)); f="$ROOT/${s#./}"; f="${f%%\?*}"
      if [[ ! -f "$f" ]]; then fail "index.html references a missing script: $s"; badscripts=$((badscripts+1)); continue; fi
      if [[ $HAVE_NODE -eq 1 ]] && ! node --check "$f" 2>"$TMP/chk"; then fail "node --check $s: $(head -c 160 "$TMP/chk" | tr '\n' ' ')"; badscripts=$((badscripts+1)); fi
    done < <(grep -oE '<script[^>]*src="[^"]+"' "$ROOT/index.html" | sed -E 's/.*src="([^"]+)".*/\1/')
    if [[ $badscripts -eq 0 ]]; then
      [[ $HAVE_NODE -eq 1 ]] && pass "all $nscripts <script src> files in index.html exist and pass node --check" || pass "all $nscripts <script src> files in index.html exist (node missing: syntax not checked)"
    fi
    # manifest.js and manifest.json carry the same ART version
    if [[ -f "$ROOT/assets/opt/manifest.js" && -f "$ROOT/assets/opt/manifest.json" ]]; then
      js_v=$(grep -oE '"version":"[^"]+"' "$ROOT/assets/opt/manifest.js" | head -1 | cut -d'"' -f4)
      json_v=$(grep -oE '"version": *"[^"]+"' "$ROOT/assets/opt/manifest.json" | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
      [[ -n "$js_v" && "$js_v" == "$json_v" ]] && pass "assets/opt/manifest.js version $js_v matches manifest.json" || fail "assets/opt/manifest.js version '$js_v' != manifest.json '$json_v' (run MANIFEST_ONLY=1 tools/build-web-assets.sh)"
    else fail "assets/opt/manifest.js or manifest.json is missing (run tools/build-web-assets.sh)"; fi
    # duplicate top-level declarations across the classic scripts
    if [[ -f "$ROOT/tools/check-globals.sh" ]]; then
      if bash "$ROOT/tools/check-globals.sh" "$ROOT/index.html" > "$TMP/globals" 2>&1; then pass "$(head -1 "$TMP/globals")"; else fail "check-globals: $(grep -v '^duplicate' "$TMP/globals" | tr -s ' \n' ' ' | head -c 200)"; fi
    else warn "tools/check-globals.sh not found"; fi
    # footer privacy link -> local file with the save key and a back link; privacy.html stub; back links on the secondary pages
    src_privacy=$(grep -oE '<a[^>]*href="[^"]*privacy[^"]*"' "$ROOT/index.html" | head -1 | sed -E 's/.*href="([^"]*)".*/\1/')
    if [[ -z "$src_privacy" ]]; then fail "index.html has no footer privacy link"
    else
      pf="$ROOT/${src_privacy#./}"; pf="${pf%%\?*}"; pf="${pf%%#*}"
      if [[ -f "$pf" ]]; then
        pass "footer privacy link $src_privacy resolves to a local file"
        grep -q 'typesmup198x\.save\.v1' "$pf" && pass "$(basename "$pf") names the save key typesmup198x.save.v1" || fail "$(basename "$pf") does not mention typesmup198x.save.v1"
        grep -qE 'href="(\./)?index\.html"' "$pf" && pass "$(basename "$pf") links back to the game" || fail "$(basename "$pf") has no back link to index.html"
      else fail "footer privacy link $src_privacy -> $pf does not exist"; fi
    fi
    if [[ -f "$ROOT/privacy.html" ]]; then
      grep -qiE '<meta[^>]*http-equiv="refresh"[^>]*privacy-policy\.html' "$ROOT/privacy.html" && pass "privacy.html is a meta-refresh stub to privacy-policy.html" || fail "privacy.html is not a meta-refresh stub to privacy-policy.html"
    else warn "privacy.html missing (old links to it would 404)"; fi
    for page in info.html support.html privacy-policy.html; do
      [[ -f "$ROOT/$page" ]] || { warn "$page missing"; continue; }
      grep -qE 'href="(\./)?index\.html"' "$ROOT/$page" && pass "$page links back to the game" || fail "$page has no back link to index.html"
    done
  fi
  # unreferenced assets (report, never a gate)
  if [[ -f "$ROOT/tools/unreferenced-assets.sh" ]]; then
    ulist="${UNREF_OUT:-$TMP/unreferenced-assets.txt}"
    if bash "$ROOT/tools/unreferenced-assets.sh" --root "$ROOT" --out "$ulist" --quiet > /dev/null 2>&1; then
      info "unreferenced assets: $(awk '/^UNREFERENCED/{u=1} /^BY-NAME/{u=0;b=1} /total:/{ if (u) printf "unreferenced %s; ", substr($0, index($0,"total:")+7); else if (b) printf "by-name-only %s", substr($0, index($0,"total:")+7) }' "$ulist")"
      [[ -n "$UNREF_OUT" ]] && info "full listing written to $UNREF_OUT" || info "full listing: tools/unreferenced-assets.sh (or --unreferenced-out <file>); native/sync-web.sh rsyncs masters AND assets/opt into both native bundles (amendment E-4b)"
    else warn "tools/unreferenced-assets.sh failed"; fi
  fi

  echo "deploy-check: local native-sync non-regression ($ROOT)"
  for f in index.html game.js style.css native/sync-web.sh; do
    [[ -f "$ROOT/$f" ]] || { fail "missing $ROOT/$f"; }
  done
  LITERAL='return `${path}${sep}v=${ASSET_VERSION}`;'
  grep -qF "$LITERAL" "$ROOT/game.js" && pass "source game.js keeps the withAssetVersion literal line" || fail "source game.js lost the withAssetVersion literal line (native sed target)"
  overlay_tag=$(grep -oE '<div[[:space:]]+[^>]*id="loadingOverlay"[^>]*>' "$ROOT/index.html" | head -1)
  if [[ -z "$overlay_tag" ]]; then fail "source index.html has no #loadingOverlay div"
  else
    [[ "$overlay_tag" =~ ^\<div[[:space:]]+id=\"loadingOverlay\" ]] && pass "#loadingOverlay keeps id as its first attribute" || fail "#loadingOverlay id is not the first attribute: $overlay_tag"
    grep -qE 'class=' <<< "$overlay_tag" && fail "#loadingOverlay carries a class attribute in source (sync-web.sh would inject a second one): $overlay_tag" || pass "#loadingOverlay has no class attribute in source (amendment B-17)"
  fi
  if [[ -f "$ROOT/native/sync-web.sh" ]]; then
    L="$TMP/local"; mkdir -p "$L/native" "$L/assets/ui" "$L/assets/opt"
    cp "$ROOT/index.html" "$ROOT/game.js" "$ROOT/style.css" "$L/"
    cp "$ROOT/native/sync-web.sh" "$L/native/"
    [[ -f "$ROOT/assets/ui/logo.svg" ]] && cp "$ROOT/assets/ui/logo.svg" "$L/assets/ui/"
    [[ -f "$ROOT/assets/opt/manifest.js" ]] && cp "$ROOT/assets/opt/manifest.js" "$L/assets/opt/"
    if bash "$L/native/sync-web.sh" > "$TMP/sync.log" 2>&1; then pass "native/sync-web.sh ran against the temp copy"; else fail "native/sync-web.sh failed: $(tail -3 "$TMP/sync.log" | tr '\n' ' ')"; fi
    for target in ios/TypeR198XIOS/www macos/typer198xMac/www; do
      g="$L/native/$target/game.js"; h="$L/native/$target/index.html"
      if [[ -f "$g" ]]; then
        grep -qF 'return path;' "$g" && ! grep -qF "$LITERAL" "$g" && pass "$target/game.js: withAssetVersion patched to 'return path;'" || fail "$target/game.js: 'return path;' patch missing"
        if [[ $HAVE_NODE -eq 1 ]]; then node --check "$g" 2>"$TMP/chk" && pass "$target/game.js parses" || fail "$target/game.js syntax: $(head -c 160 "$TMP/chk")"; fi
      else fail "$target/game.js not produced"; fi
      if [[ -f "$h" ]]; then
        n=$(grep -c 'id="loadingOverlay" class="hidden"' "$h")
        tag=$(grep -oE '<div[^>]*id="loadingOverlay"[^>]*>' "$h" | head -1)
        nclass=$(grep -o 'class=' <<< "$tag" | wc -l | tr -d ' ')
        [[ "$n" == "1" && "$nclass" == "1" ]] && pass "$target/index.html: loading overlay patched with a single class=\"hidden\"" || fail "$target/index.html: overlay patch wrong (matches=$n, class attrs=$nclass): $tag"
      else fail "$target/index.html not produced"; fi
    done
  fi
fi

echo "deploy-check: PASS $PASS  WARN $WARN  FAIL $FAIL"
[[ $FAIL -eq 0 ]]
