#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR"

# Sync to iOS project
TARGET_IOS="$ROOT_DIR/native/ios/TypeR198XIOS/www"
mkdir -p "$TARGET_IOS"
cp "$SOURCE_DIR/index.html" "$TARGET_IOS/"
cp "$SOURCE_DIR/game.js" "$TARGET_IOS/"
cp "$SOURCE_DIR/style.css" "$TARGET_IOS/"
rsync -a --delete "$SOURCE_DIR/assets/" "$TARGET_IOS/assets/"
echo "Synced iOS bundle to $TARGET_IOS"

# Sync to macOS project
TARGET_MAC="$ROOT_DIR/native/macos/typer198xMac/www"
mkdir -p "$TARGET_MAC"
cp "$SOURCE_DIR/index.html" "$TARGET_MAC/"
cp "$SOURCE_DIR/game.js" "$TARGET_MAC/"
cp "$SOURCE_DIR/style.css" "$TARGET_MAC/"
rsync -a --delete "$SOURCE_DIR/assets/" "$TARGET_MAC/assets/"
echo "Synced macOS bundle to $TARGET_MAC"
