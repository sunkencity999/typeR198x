#!/usr/bin/env bash
# tools/unreferenced-assets.sh [--root <dir>] [--out <file>] [--quiet]
#
# Lists every file under assets/ that the web build does not reference (finding F105, PLAN E1).
# A file counts as referenced when its path relative to the repo root (e.g. assets/opt/bg/first@1x.webp,
# with or without the leading ./) appears in any of: *.html at the root, style.css, assets/style/*.css,
# game.js, assets/audio/sfx.js, assets/js/**/*.js, assets/opt/manifest.json.
# Files whose bare basename appears somewhere (dynamic path building) are listed separately as
# "BY-NAME" so a human can decide. Code and stylesheet files under assets/ are skipped (they are the
# reference corpus, not content).
#
# --out <file>  also write the listing there (E1 suggests tools/unreferenced-assets.txt).
# Exit 0 always; this is a report, not a gate.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUTFILE=""
QUIET=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$(cd "$2" && pwd)"; shift 2 ;;
    --out) OUTFILE="$2"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
cd "$ROOT" || exit 2

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CORPUS="$TMP/corpus.txt"
{
  for f in *.html style.css game.js assets/audio/sfx.js assets/opt/manifest.json; do [[ -f "$f" ]] && cat "$f"; done
  find assets/style -name '*.css' -type f -exec cat {} + 2>/dev/null
  find assets/js -name '*.js' -type f -exec cat {} + 2>/dev/null
  echo
} > "$CORPUS"

fsize() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0; }
human() { awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%7.1f MB", b/1048576; else if (b >= 1024) printf "%7.1f KB", b/1024; else printf "%7d  B", b }'; }

UNREF="$TMP/unref.txt"; BYNAME="$TMP/byname.txt"; : > "$UNREF"; : > "$BYNAME"
total_unref=0; total_byname=0; total_files=0; total_bytes=0
while IFS= read -r f; do
  rel="${f#./}"
  base="$(basename "$rel")"
  case "$rel" in
    assets/js/*|assets/style/*|*/.DS_Store|assets/audio/sfx.js) continue ;;
  esac
  total_files=$((total_files+1))
  sz=$(fsize "$rel"); total_bytes=$((total_bytes+sz))
  if grep -qF -- "$rel" "$CORPUS"; then continue; fi
  if grep -qF -- "$base" "$CORPUS"; then
    printf '%s\t%s\n' "$sz" "$rel" >> "$BYNAME"; total_byname=$((total_byname+sz))
  else
    printf '%s\t%s\n' "$sz" "$rel" >> "$UNREF"; total_unref=$((total_unref+sz))
  fi
done < <(find assets -type f | sort)

render() {
  echo "unreferenced-assets: $ROOT"
  echo "scanned $total_files content files under assets/ ($(human "$total_bytes" | sed 's/^ *//'))"
  echo
  echo "UNREFERENCED (no path or basename match in html/css/js/manifest):"
  if [[ -s "$UNREF" ]]; then sort -t$'\t' -k1,1nr "$UNREF" | while IFS=$'\t' read -r sz p; do printf '  %s  %s\n' "$(human "$sz")" "$p"; done; else echo "  (none)"; fi
  echo "  total: $(human "$total_unref" | sed 's/^ *//')"
  echo
  echo "BY-NAME ONLY (basename appears in code, full path does not; probably built dynamically, check by hand):"
  if [[ -s "$BYNAME" ]]; then sort -t$'\t' -k1,1nr "$BYNAME" | while IFS=$'\t' read -r sz p; do printf '  %s  %s\n' "$(human "$sz")" "$p"; done; else echo "  (none)"; fi
  echo "  total: $(human "$total_byname" | sed 's/^ *//')"
  echo
  if [[ -d assets/opt ]]; then
    opt_bytes=$(find assets/opt -type f -exec stat -f%z {} + 2>/dev/null | awk '{s+=$1} END {print s+0}')
    [[ "$opt_bytes" == "0" ]] && opt_bytes=$(find assets/opt -type f -exec stat -c%s {} + 2>/dev/null | awk '{s+=$1} END {print s+0}')
    echo "note: native/sync-web.sh rsyncs the whole assets/ tree (masters AND assets/opt, $(human "$opt_bytes" | sed 's/^ *//')) into both"
    echo "      native bundles (amendment E-4b). Exclude assets/opt there, or ship the native apps from the opt set only."
  fi
}

if [[ -n "$OUTFILE" ]]; then render > "$OUTFILE"; [[ $QUIET -eq 1 ]] || cat "$OUTFILE"; echo "written: $OUTFILE"; else render; fi
