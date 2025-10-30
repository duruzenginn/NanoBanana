#!/usr/bin/env bash
set -euo pipefail

# Source image path
SRC="$(cd "$(dirname "$0")/.." && pwd)/public/icons/maskable_icon.png"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/icons"

if [ ! -f "$SRC" ]; then
  echo "ERROR: $SRC not found. Place your maskable icon image there (PNG)." >&2
  exit 1
fi

# Generate required sizes
sips -s format png "$SRC" --out "$OUT_DIR/maskable-1024.png" >/dev/null
sips -z 512 512 "$SRC" --out "$OUT_DIR/maskable-512.png" >/dev/null
sips -z 192 192 "$SRC" --out "$OUT_DIR/maskable-192.png" >/dev/null
sips -z 180 180 "$SRC" --out "$OUT_DIR/apple-touch-icon.png" >/dev/null
sips -z 150 150 "$SRC" --out "$OUT_DIR/mstile-150.png" >/dev/null
sips -z 32 32 "$SRC"   --out "$OUT_DIR/favicon-32.png" >/dev/null
sips -z 16 16 "$SRC"   --out "$OUT_DIR/favicon-16.png" >/dev/null

echo "Icons generated in $OUT_DIR:"
ls -1 "$OUT_DIR" | sed 's/^/ - /'
