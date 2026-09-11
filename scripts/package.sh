#!/usr/bin/env bash
# Build a Chrome Web Store zip: manifest.json at the archive root; docs/tests/scripts/samples excluded.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/cookielet-consent-inspector-${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"
zip -r -q "$OUT" manifest.json _locales icons src \
  -x '*/.DS_Store' -x '*_metadata*' -x 'src/**/*.map'
echo "packaged $OUT ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT" | tail -1
