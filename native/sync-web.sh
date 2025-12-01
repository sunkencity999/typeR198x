#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR"

# Function to patch files for native environment
patch_for_native() {
  local target_dir="$1"
  local index_file="$target_dir/index.html"
  local game_file="$target_dir/game.js"

  echo "Patching $target_dir for native..."

  # 1. Hide Loading Overlay in index.html
  # Replaces <div id="loadingOverlay" ...> with <div id="loadingOverlay" class="hidden" ...>
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' 's/id="loadingOverlay"/id="loadingOverlay" class="hidden"/' "$index_file"
  else
    sed -i 's/id="loadingOverlay"/id="loadingOverlay" class="hidden"/' "$index_file"
  fi

  # 2. Disable Asset Versioning in game.js
  # Replaces the return statement in withAssetVersion to just return the path.
  # Pattern matches: return `${path}${sep}v=${ASSET_VERSION}`;
  # Replaces with: return path;
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' 's/return `\${path}${sep}v=\${ASSET_VERSION}`;/return path;/' "$game_file"
  else
    sed -i 's/return `\${path}${sep}v=\${ASSET_VERSION}`;/return path;/' "$game_file"
  fi
}

# Sync to iOS project
TARGET_IOS="$ROOT_DIR/native/ios/TypeR198XIOS/www"
mkdir -p "$TARGET_IOS"
cp "$SOURCE_DIR/index.html" "$TARGET_IOS/"
cp "$SOURCE_DIR/game.js" "$TARGET_IOS/"
cp "$SOURCE_DIR/style.css" "$TARGET_IOS/"
rsync -a --delete "$SOURCE_DIR/assets/" "$TARGET_IOS/assets/"
patch_for_native "$TARGET_IOS"
echo "Synced iOS bundle to $TARGET_IOS"

# Sync to macOS project
TARGET_MAC="$ROOT_DIR/native/macos/typer198xMac/www"
mkdir -p "$TARGET_MAC"
cp "$SOURCE_DIR/index.html" "$TARGET_MAC/"
cp "$SOURCE_DIR/game.js" "$TARGET_MAC/"
cp "$SOURCE_DIR/style.css" "$TARGET_MAC/"
rsync -a --delete "$SOURCE_DIR/assets/" "$TARGET_MAC/assets/"
patch_for_native "$TARGET_MAC"
echo "Synced macOS bundle to $TARGET_MAC"
