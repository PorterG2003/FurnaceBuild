#!/usr/bin/env bash
# Regenerate launcher icons from the flame mark only (assets/F_Flame.svg).
# (assets/icon.png is 8-bit colormap; headless Chromium often renders it as a blank/solid tile.)
# Padding: maskable ~3% for light OEM crop; square "any" icons at 0% for maximum mark size.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

SRC="$ROOT/assets/F_Flame.svg"

npx --yes pwa-asset-generator@6.4.0 "$SRC" "$TMP" \
  --icon-only --type png --padding "3%" --background "#121212" \
  --opaque true --scrape false --log false --maskable true
cp "$TMP/manifest-icon-192.maskable.png" public/web-app-manifest-192.maskable.png
cp "$TMP/manifest-icon-512.maskable.png" public/web-app-manifest-512.maskable.png
cp "$TMP/apple-icon-180.png" public/apple-touch-icon.png

npx --yes pwa-asset-generator@6.4.0 "$SRC" "$TMP" \
  --icon-only --type png --padding "0%" --background "#121212" \
  --opaque true --scrape false --log false --maskable false
cp "$TMP/manifest-icon-192.png" public/web-app-manifest-192x192.png
cp "$TMP/manifest-icon-512.png" public/web-app-manifest-512x512.png

# Tab favicon: prefer PNG over legacy favicon.svg (browsers pick first <link rel="icon">).
SRC512="$ROOT/public/web-app-manifest-512x512.png"
DST96="$ROOT/public/favicon-96x96.png"
if command -v magick >/dev/null 2>&1; then
  magick "$SRC512" -resize 96x96 "$DST96"
elif command -v convert >/dev/null 2>&1; then
  convert "$SRC512" -resize 96x96 "$DST96"
elif command -v sips >/dev/null 2>&1; then
  sips -z 96 96 "$SRC512" --out "$DST96"
else
  echo "generate-pwa-icons: warning: no magick/convert/sips — favicon-96x96.png not updated (install ImageMagick or run on macOS)"
fi

echo "generate-pwa-icons: complete (F_Flame.svg → manifest + apple-touch-icon; favicon-96 from 512 when a resize tool is available)"
