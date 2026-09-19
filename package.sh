#!/bin/bash
# Builds the zip the Chrome Web Store expects: only what the extension needs to
# run. The store rejects a package containing files the manifest never uses.
set -e
cd "$(dirname "$0")"
VER=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="smartfill-$VER.zip"
rm -f "$OUT"
zip -r -q "$OUT" manifest.json icons src \
  -x '*.DS_Store' -x '__MACOSX*' -x '*.map'
echo "$OUT  ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT" | tail -n +4 | head -30
