#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR"
TARGET_DIR="$ROOT_DIR/native/shared/www"

WEB_FILES=("index.html" "game.js" "style.css")

mkdir -p "$TARGET_DIR"

for file in "${WEB_FILES[@]}"; do
  if [[ ! -f "$SOURCE_DIR/$file" ]]; then
    echo "Missing $file in project root" >&2
    exit 1
  fi
  rsync -a "$SOURCE_DIR/$file" "$TARGET_DIR/"
  echo "Copied $file"
done

if [[ ! -d "$SOURCE_DIR/assets" ]]; then
  echo "Missing assets directory" >&2
  exit 1
fi

rsync -a --delete "$SOURCE_DIR/assets/" "$TARGET_DIR/assets/"
echo "Synced assets/"

echo "Native bundle updated at $TARGET_DIR"
