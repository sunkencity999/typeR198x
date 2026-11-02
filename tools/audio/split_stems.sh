#!/usr/bin/env bash
# Splits the six Galactic High Score masters into drums / no_drums stems with Demucs (htdemucs, two-stem mode).
#
#   tools/audio/split_stems.sh [--device cpu|mps] [--threads N] [--only 1,4] [--out assets/audio/stems]
#
# Needs the typer-audio venv: python3.12 -m venv ~/.venvs/typer-audio && ~/.venvs/typer-audio/bin/pip install demucs torch torchaudio
# Output: <out>/htdemucs/Galactic_High_Score_<n>/{drums,no_drums}.wav (44.1 kHz stereo, 16-bit; ~23 MB each). The stems
# are NOT committed (assets/audio/stems is ignored): regenerate them here, then tools/build-web-assets.sh encodes the
# no_drums layers to assets/opt/audio/galactic_high_score_<n>_nodrums.mp3 (the "musicLayers" manifest array).
# CPU: ~1-1.5x realtime per track with 6 threads on an M-series laptop; the first run downloads the htdemucs weights.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VENV="${TYPER_AUDIO_VENV:-$HOME/.venvs/typer-audio}"
DEVICE=cpu
THREADS=6
ONLY="1,2,3,4,5,6"
OUT="$ROOT/assets/audio/stems"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) DEVICE="$2"; shift 2 ;;
    --threads) THREADS="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done
[[ -x "$VENV/bin/demucs" ]] || { echo "missing $VENV/bin/demucs (see the header)" >&2; exit 1; }
mkdir -p "$OUT"
export OMP_NUM_THREADS="$THREADS" MKL_NUM_THREADS="$THREADS"
IFS=, read -r -a TRACKS <<< "$ONLY"
for n in "${TRACKS[@]}"; do
  in="$ROOT/assets/audio/Galactic_High_Score_${n}.wav"
  [[ -f "$in" ]] || { echo "missing $in" >&2; exit 1; }
  if [[ -f "$OUT/htdemucs/Galactic_High_Score_${n}/no_drums.wav" ]]; then echo "track $n: stems present, skipped"; continue; fi
  echo "track $n: demucs htdemucs two-stems=drums on $DEVICE ($THREADS threads)"
  t0=$(date +%s)
  "$VENV/bin/demucs" -n htdemucs --two-stems=drums -d "$DEVICE" -j 1 -o "$OUT" "$in"
  echo "track $n: done in $(( $(date +%s) - t0 )) s"
done
ls -la "$OUT"/htdemucs/*/ 2>/dev/null || true
