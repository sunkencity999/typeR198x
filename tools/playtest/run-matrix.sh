#!/usr/bin/env bash
# tools/playtest/run-matrix.sh [--quick] [--only name,name] [--out <dir>] [--root <dir>] [--seconds N]
#
# Runs play.mjs across the standard configuration matrix, one report folder per row under
# out/matrix/<name>, then prints a summary table with the exit codes (PLAN A1 / E3).
#
# Rows: dpr1, dpr2, reduced-motion (DPR 2), mobile, native-ua (the WKWebView UA served over HTTP),
#       no-music (perf-only, media transport stubbed), fixture-fresh, fixture-legacy-midwave,
#       fixture-legacy-inboss, fixture-legacy-postvictory, fixture-legacy-levelcomplete
# --quick  runs every row with --scenario smoke (minutes instead of tens of minutes)
# --only   comma-separated row names to run
# Extra environment: PLAY_ARGS="..." is appended to every row (e.g. PLAY_ARGS="--wpm 60 --cpu 4").
# Exit code: the number of rows that exited non-zero (capped at 125).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/../.."
OUT="$HERE/out/matrix"
SECS=12
QUICK=0
ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick) QUICK=1; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --root) ROOT="$2"; shift 2 ;;
    --seconds) SECS="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$OUT"
ROOT="$(cd "$ROOT" && pwd)"
OUT="$(cd "$OUT" && pwd)"

ALL="all"; [[ $QUICK -eq 1 ]] && ALL="smoke"
ROWS=(
  "dpr1|--scenario $ALL --dpr 1"
  "dpr2|--scenario $ALL --dpr 2"
  "reduced-motion|--scenario $ALL --dpr 2 --reduced-motion"
  "mobile|--scenario smoke --mobile --dpr 2"
  "native-ua|--scenario $ALL --ua native"
  "no-music|--scenario smoke --dpr 2 --no-music"
  "fixture-fresh|--scenario smoke --fixture fresh"
  "fixture-legacy-midwave|--scenario smoke --fixture legacy-midwave"
  "fixture-legacy-inboss|--scenario smoke --fixture legacy-inboss"
  "fixture-legacy-postvictory|--scenario smoke --fixture legacy-postvictory"
  "fixture-legacy-levelcomplete|--scenario smoke --fixture legacy-levelcomplete"
)

selected() { [[ -z "$ONLY" ]] && return 0; [[ ",$ONLY," == *",$1,"* ]]; }

SUMMARY="$OUT/summary.tsv"
printf 'name\texit\tpageErr\tconsoleErr\tresourceErr\treqFail\tmediaAbort\tfpsMenu\tfpsPlay\tfpsBoss\tfpsFinale\tmaxRenderMs\tshadow/frame\tffAlpha\tlayout/5s\tnonMediaMB\tmediaMB\tfixture\tnotes\tseconds\n' > "$SUMMARY"
failures=0
started=$(date +%s)
for row in "${ROWS[@]}"; do
  name="${row%%|*}"; flags="${row#*|}"
  selected "$name" || continue
  dir="$OUT/$name"
  echo "=== $name: node play.mjs --root $ROOT --out $dir $flags --seconds $SECS ${PLAY_ARGS:-}"
  t0=$(date +%s)
  # shellcheck disable=SC2086
  (cd "$HERE" && node play.mjs --root "$ROOT" --out "$dir" $flags --seconds "$SECS" ${PLAY_ARGS:-}) > "$dir.log" 2>&1
  code=$?
  dt=$(( $(date +%s) - t0 ))
  [[ $code -ne 0 ]] && failures=$((failures+1))
  tail -n 40 "$dir.log" | grep -E '"(pageErrors|consoleErrors|resourceErrors|harnessError)"|\[fixture\] check' | sed 's/^/    /'
  if [[ -f "$dir/report.json" ]]; then
    node -e '
      const r = require(process.argv[1]); const n = (v) => (v == null ? "-" : v);
      const fx = r.fixture ? (r.fixture.check ? (r.fixture.check.pass ? "pass" : "FAIL") : "n/a") : "-";
      const mb = (b) => (b == null ? "-" : (b / 1048576).toFixed(2));
      const nt = r.networkTotals || {};
      console.log([process.argv[2], process.argv[3], r.pageErrors.length, r.consoleErrors.length, r.resourceErrors.length, r.requestFailures.length, (r.mediaAborts || []).length,
        n(r.fps.menu), n(r.fps.gameplay), n(r.fps.boss), n(r.fps.finale), n(r.maxRenderMs), n(r.shadowBlurPerFrame), n(r.fullFrameFillMaxAlpha),
        n(r.layoutCountPer5s), mb(nt.bytesFinishedBeforeFirstKeystrokeNonMedia), mb(nt.mediaBytes), fx, r.notes.length, process.argv[4]].join("\t"));
    ' "$dir/report.json" "$name" "$code" "$dt" >> "$SUMMARY"
  else
    printf '%s\t%s\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\tno report\t%s\n' "$name" "$code" "$dt" >> "$SUMMARY"
  fi
done

echo
echo "matrix summary ($OUT, $(( $(date +%s) - started )) s):"
if command -v column >/dev/null 2>&1; then column -t -s$'\t' "$SUMMARY"; else cat "$SUMMARY"; fi
echo "rows with non-zero exit: $failures"
exit $(( failures > 125 ? 125 : failures ))
