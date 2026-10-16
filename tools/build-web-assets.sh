#!/usr/bin/env bash
# Builds the optimized web asset set used by the browser build of Type-R 198X.
#
#   assets/opt/            <- generated, committed, consumed by game.js / index.html
#     bg/<id>@1x.webp      backgrounds 1408px wide, @2x 2816px wide
#     fg/<id>@1x.webp      foreground parallax layers (alpha)
#     bosses/<n>@1x.webp   trimmed boss art (alpha), @2x up to 1600px wide
#     ships/<id>@1x.webp   trimmed ship art (alpha), @2x up to 700px wide
#     fx/explosions.webp   explosion sprite sheet (alpha, full resolution)
#     audio/*.mp3          music tracks (VBR ~190 kbps) + compact mono SFX wavs
#     manifest.js          window.TYPER_ASSET_MANIFEST = {...} (trim boxes, sizes)
#     manifest.json        same data for tooling
#
# The original PNG/WAV masters stay untouched where they are (the native wrappers
# and this script both read them). Requires: magick (ImageMagick 7), cwebp, ffmpeg.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/assets"
OUT="$SRC/opt"
Q_OPAQUE=${Q_OPAQUE:-82}
Q_ALPHA=${Q_ALPHA:-84}
PAD=24

for tool in magick cwebp ffmpeg; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing $tool (brew install imagemagick webp ffmpeg)" >&2; exit 1; }
done

mkdir -p "$OUT/bg" "$OUT/fg" "$OUT/bosses" "$OUT/ships" "$OUT/fx" "$OUT/audio"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

MANIFEST_ENTRIES=()
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# encode_webp <png> <out.webp> <quality> <alpha:0|1>
encode_webp() {
  local in="$1" out="$2" q="$3" alpha="$4"
  if [[ "$alpha" == "1" ]]; then
    cwebp -quiet -q "$q" -alpha_q 92 -m 6 -sharp_yuv -metadata none "$in" -o "$out"
  else
    cwebp -quiet -q "$q" -m 6 -sharp_yuv -metadata none "$in" -o "$out"
  fi
}

# resize_png <src> <width> <out.png>  (never upscale)
resize_png() {
  local src="$1" w="$2" out="$3"
  magick "$src" -filter Lanczos -resize "${w}x>" -strip "$out"
}

dims() { magick identify -format "%w %h\n" "$1"; }

# ---------------------------------------------------------------- layers (bg/fg)
# Theme ids match PARALLAX_THEMES in game.js.
THEMES=(first second third fourth fifth sixth seventh eighth ninth tenth)
for t in "${THEMES[@]}"; do
  bg="$SRC/backgrounds/${t}levelbg.png"
  fg="$SRC/foregrounds/${t}levelFG.png"
  for kind in bg fg; do
    src=$([[ $kind == bg ]] && echo "$bg" || echo "$fg")
    alpha=$([[ $kind == bg ]] && echo 0 || echo 1)
    q=$([[ $kind == bg ]] && echo "$Q_OPAQUE" || echo "$Q_ALPHA")
    read -r ow oh < <(dims "$src")
    for scale in 1 2; do
      w=$(( scale == 1 ? ow / 2 : ow ))
      png="$TMP/${kind}-${t}@${scale}x.png"
      out="$OUT/$kind/${t}@${scale}x.webp"
      resize_png "$src" "$w" "$png"
      encode_webp "$png" "$out" "$q" "$alpha"
    done
    read -r w1 h1 < <(dims "$OUT/$kind/${t}@1x.webp")
    read -r w2 h2 < <(dims "$OUT/$kind/${t}@2x.webp")
    MANIFEST_ENTRIES+=("\"$kind/$t\":{\"orig\":{\"w\":$ow,\"h\":$oh},\"x1\":{\"src\":\"./assets/opt/$kind/${t}@1x.webp\",\"w\":$w1,\"h\":$h1},\"x2\":{\"src\":\"./assets/opt/$kind/${t}@2x.webp\",\"w\":$w2,\"h\":$h2},\"fallback\":\"./assets/$([[ $kind == bg ]] && echo backgrounds/${t}levelbg.png || echo foregrounds/${t}levelFG.png)\"}")
    echo "layer $kind/$t -> $(du -h "$OUT/$kind/${t}@1x.webp" | cut -f1) / $(du -h "$OUT/$kind/${t}@2x.webp" | cut -f1)"
  done
done

# ---------------------------------------------------------------- sprites (trim + alpha)
# trim_sprite <id> <src.png> <outdir-kind> <max2xWidth> <fallbackRelPath>
trim_sprite() {
  local id="$1" src="$2" kind="$3" max2x="$4" fallback="$5"
  read -r ow oh < <(dims "$src")
  # trim box of non-transparent content: "WxH+X+Y"
  local box; box="$(magick "$src" -format '%@' info:)"
  local tw th tx ty
  tw="${box%%x*}"; th="$(echo "$box" | sed -E 's/^[0-9]+x([0-9]+)\+.*/\1/')"
  tx="$(echo "$box" | sed -E 's/^[0-9]+x[0-9]+\+([0-9]+)\+.*/\1/')"
  ty="$(echo "$box" | sed -E 's/^[0-9]+x[0-9]+\+[0-9]+\+([0-9]+)$/\1/')"
  # pad the box, clamped to the image
  local x0=$(( tx - PAD < 0 ? 0 : tx - PAD )); local y0=$(( ty - PAD < 0 ? 0 : ty - PAD ))
  local x1=$(( tx + tw + PAD > ow ? ow : tx + tw + PAD )); local y1=$(( ty + th + PAD > oh ? oh : ty + th + PAD ))
  local cw=$(( x1 - x0 )); local ch=$(( y1 - y0 ))
  local cropped="$TMP/${kind}-${id}-crop.png"
  magick "$src" -crop "${cw}x${ch}+${x0}+${y0}" +repage -strip "$cropped"
  local w2=$(( cw < max2x ? cw : max2x )); local w1=$(( w2 / 2 ))
  resize_png "$cropped" "$w2" "$TMP/${kind}-${id}@2x.png"
  resize_png "$cropped" "$w1" "$TMP/${kind}-${id}@1x.png"
  encode_webp "$TMP/${kind}-${id}@2x.png" "$OUT/$kind/${id}@2x.webp" "$Q_ALPHA" 1
  encode_webp "$TMP/${kind}-${id}@1x.png" "$OUT/$kind/${id}@1x.webp" "$Q_ALPHA" 1
  local rw1 rh1 rw2 rh2
  read -r rw1 rh1 < <(dims "$OUT/$kind/${id}@1x.webp")
  read -r rw2 rh2 < <(dims "$OUT/$kind/${id}@2x.webp")
  MANIFEST_ENTRIES+=("\"$kind/$id\":{\"orig\":{\"w\":$ow,\"h\":$oh},\"crop\":{\"x\":$x0,\"y\":$y0,\"w\":$cw,\"h\":$ch},\"content\":{\"x\":$tx,\"y\":$ty,\"w\":$tw,\"h\":$th},\"x1\":{\"src\":\"./assets/opt/$kind/${id}@1x.webp\",\"w\":$rw1,\"h\":$rh1},\"x2\":{\"src\":\"./assets/opt/$kind/${id}@2x.webp\",\"w\":$rw2,\"h\":$rh2},\"fallback\":\"$fallback\"}")
  echo "sprite $kind/$id crop ${cw}x${ch}+${x0}+${y0} -> $(du -h "$OUT/$kind/${id}@1x.webp" | cut -f1) / $(du -h "$OUT/$kind/${id}@2x.webp" | cut -f1)"
}

trim_sprite coconut          "$SRC/ships/S_S_Coconut.png"        ships 700 "./assets/ships/S_S_Coconut.png"
trim_sprite little-dark-one  "$SRC/ships/S_S_littledarkone.png"  ships 700 "./assets/ships/S_S_littledarkone.png"
trim_sprite sofrito          "$SRC/ships/S_S_Sofrito.png"        ships 700 "./assets/ships/S_S_Sofrito.png"
trim_sprite honeybee         "$SRC/ships/S_S_honeyBee.png"       ships 700 "./assets/ships/S_S_honeyBee.png"

BOSS_FILES=(firstlevelBoss secondlevelboss thirdlevelboss fourthevelboss fifthlevelboss sixthlevelboss seventhlevelboss eigthlevelboss ninthlevelboss 10thlevelboss)
for i in "${!BOSS_FILES[@]}"; do
  n=$(( i + 1 ))
  trim_sprite "$n" "$SRC/boss_ships/${BOSS_FILES[$i]}.png" bosses 1600 "./assets/boss_ships/${BOSS_FILES[$i]}.png"
done

# ---------------------------------------------------------------- fx
encode_webp "$SRC/explosions/explosions.png" "$OUT/fx/explosions.webp" 86 1
read -r ew eh < <(dims "$OUT/fx/explosions.webp")
MANIFEST_ENTRIES+=("\"fx/explosions\":{\"src\":\"./assets/opt/fx/explosions.webp\",\"w\":$ew,\"h\":$eh,\"fallback\":\"./assets/explosions/explosions.png\"}")
echo "fx/explosions -> $(du -h "$OUT/fx/explosions.webp" | cut -f1)"

# ---------------------------------------------------------------- audio
MUSIC=()
for n in 1 2 3 4 5 6; do
  in="$SRC/audio/Galactic_High_Score_${n}.wav"
  out="$OUT/audio/galactic_high_score_${n}.mp3"
  ffmpeg -v error -y -i "$in" -codec:a libmp3lame -q:a 2 -ar 44100 -ac 2 -map_metadata -1 "$out"
  MUSIC+=("\"./assets/opt/audio/galactic_high_score_${n}.mp3\"")
  echo "music $n -> $(du -h "$out" | cut -f1)"
done
# One-shot SFX stay PCM (no decoder latency / loop padding), but mono + 22.05 kHz.
ffmpeg -v error -y -i "$SRC/audio/laser.wav" -ac 1 -ar 22050 -sample_fmt s16 -af "silenceremove=start_periods=1:start_threshold=-50dB" "$OUT/audio/laser.wav"
ffmpeg -v error -y -i "$SRC/audio/bigexplosion.wav" -ac 1 -ar 22050 -sample_fmt s16 "$OUT/audio/bigexplosion.wav"
echo "sfx -> $(du -h "$OUT/audio/laser.wav" | cut -f1) / $(du -h "$OUT/audio/bigexplosion.wav" | cut -f1)"

# ---------------------------------------------------------------- manifest
VERSION="$(date -u +%Y%m%d%H%M)"
{
  printf '{"version":"%s","music":[%s],"sfx":{"laser":"./assets/opt/audio/laser.wav","bigExplosion":"./assets/opt/audio/bigexplosion.wav"},"images":{' "$VERSION" "$(IFS=,; echo "${MUSIC[*]}")"
  first=1
  for e in "${MANIFEST_ENTRIES[@]}"; do
    if [[ $first -eq 1 ]]; then first=0; else printf ','; fi
    printf '%s' "$e"
  done
  printf '}}\n'
} > "$OUT/manifest.json"
# validate + pretty print
node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));fs.writeFileSync(p,JSON.stringify(j,null,1));fs.writeFileSync(p.replace(/\.json$/,".js"),"// generated by tools/build-web-assets.sh — do not edit by hand\nwindow.TYPER_ASSET_MANIFEST = "+JSON.stringify(j)+";\n");console.log("manifest ok:",Object.keys(j.images).length,"images")' "$OUT/manifest.json"

echo "total opt size: $(du -sh "$OUT" | cut -f1)"
