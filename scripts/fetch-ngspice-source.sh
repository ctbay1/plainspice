#!/usr/bin/env bash
# Download the exact ngspice source the engine was built from, and check its SHA-256.
# The site build (vite.config.ts) then serves it next to ngspice.wasm, as the LGPL asks
# ("offer equivalent access to copy the source from the same place").
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Same pins as engine/build.sh.
eval "$(grep -E '^(NGSPICE_VERSION|NGSPICE_URL|NGSPICE_SHA256)=' "$REPO/engine/build.sh")"
DEST="${ENGINE_WORK:-$REPO/.engine-work}/download/ngspice-$NGSPICE_VERSION.tar.gz"
mkdir -p "$(dirname "$DEST")"
if [ ! -f "$DEST" ]; then
  curl -fL --retry 4 --retry-delay 5 -o "$DEST.part" "$NGSPICE_URL"
  mv "$DEST.part" "$DEST"
fi
echo "$NGSPICE_SHA256  $DEST" | sha256sum -c -
