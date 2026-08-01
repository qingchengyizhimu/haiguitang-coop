#!/usr/bin/env bash
set -euo pipefail

STATE_TEST_DIR="${TMPDIR:-/tmp}/haiguitang-state-test"
mkdir -p "$STATE_TEST_DIR"

npx tsc lib/game.ts \
  --target ES2022 \
  --module commonjs \
  --esModuleInterop \
  --skipLibCheck \
  --outDir "$STATE_TEST_DIR"

HAIGUITANG_GAME_MODULE="$STATE_TEST_DIR/game.js" node tests/state-regression.mjs
