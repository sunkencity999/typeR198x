#!/usr/bin/env bash
# Lists top-level const/let/var/function/class names declared in more than one classic script, in index.html
# load order. Classic scripts share one global lexical scope, so a duplicate `const` is a SyntaxError that
# silently disables the later file (the page keeps running without its methods). Exit 1 when any duplicate exists.
# Usage: tools/check-globals.sh [index.html]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INDEX="${1:-$ROOT/index.html}"
cd "$ROOT" || exit 2
scripts=$(grep -oE '<script src="\./[^"?]+' "$INDEX" | sed -E 's#<script src="\./##')
status=0
dupes=$(for f in $scripts; do
  [[ -f "$f" ]] || { echo "missing: $f" >&2; continue; }
  grep -oE '^(const|let|var|function|class) +[A-Za-z_$][A-Za-z0-9_$]*' "$f" | awk -v f="$f" '{print $2 "\t" f}'
done | sort | awk -F'\t' '{n[$1]++; w[$1]=w[$1] " " $2} END {for (k in n) if (n[k] > 1) print k ":" w[k]}' | sort)
if [[ -n "$dupes" ]]; then
  echo "duplicate top-level declarations across classic scripts:"
  echo "$dupes" | sed 's/^/  /'
  status=1
else
  echo "check-globals: no duplicate top-level declarations across $(echo "$scripts" | wc -l | tr -d ' ') scripts"
fi
exit $status
