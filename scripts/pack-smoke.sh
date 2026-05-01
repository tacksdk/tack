#!/usr/bin/env bash
# Smoke-test the published-shape tarballs of @tacksdk/js and @tacksdk/react.
# Catches packaging bugs that the workspace symlink hides — exports map
# pointing to files not in the tarball, missing types, etc. Mirrors what an
# external consumer (Node CJS, Node ESM, Vite) would actually do.

set -euo pipefail

PACKED_DIR="${1:-/tmp/packed}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_DIR="$REPO_ROOT/.github/fixtures/vite-smoke"

if [ ! -d "$PACKED_DIR" ]; then
  echo "FAIL: packed dir $PACKED_DIR not found"
  exit 1
fi

# `|| true` keeps `set -euo pipefail` from killing the script when the glob
# matches zero files — we want the friendly error below to fire instead.
JS_TGZ=$(ls -1 "$PACKED_DIR"/tacksdk-js-*.tgz 2>/dev/null | head -1 || true)
REACT_TGZ=$(ls -1 "$PACKED_DIR"/tacksdk-react-*.tgz 2>/dev/null | head -1 || true)
if [ -z "$JS_TGZ" ] || [ -z "$REACT_TGZ" ]; then
  echo "FAIL: missing tarball(s) in $PACKED_DIR"
  ls -la "$PACKED_DIR"
  exit 1
fi
echo "Found: $JS_TGZ"
echo "Found: $REACT_TGZ"

SCRATCH=$(mktemp -d -t tack-smoke-XXXXXX)
trap 'rm -rf "$SCRATCH"' EXIT
echo "Scratch: $SCRATCH"

# --- 1. Node CJS + ESM smoke ----------------------------------------------
mkdir -p "$SCRATCH/node-smoke"
cd "$SCRATCH/node-smoke"
cat > package.json <<'EOF'
{ "name": "tack-node-smoke", "private": true, "type": "module" }
EOF
npm install --no-audit --no-fund "$JS_TGZ" "$REACT_TGZ"

cat > esm.mjs <<'EOF'
import * as js from '@tacksdk/js';
import * as headless from '@tacksdk/js/headless';
import * as react from '@tacksdk/react';
if (!js || !headless || !react) { throw new Error('missing exports'); }
console.log('esm import ok:', Object.keys(js).length, Object.keys(headless).length, Object.keys(react).length);
EOF
node esm.mjs
# Re-run with the development condition active. This is the exact resolver
# behavior `vite dev` triggers — it would have caught the original 0.2.0 bug
# (development → ./src/*.ts → missing in tarball). Production-mode imports
# fall through to the `import` condition and would have shipped green.
node --conditions=development esm.mjs

cat > cjs.cjs <<'EOF'
const js = require('@tacksdk/js');
const headless = require('@tacksdk/js/headless');
const react = require('@tacksdk/react');
if (!js || !headless || !react) { throw new Error('missing exports'); }
console.log('cjs require ok:', Object.keys(js).length, Object.keys(headless).length, Object.keys(react).length);
EOF
node cjs.cjs

# --- 2. Vite build smoke (the bug we're fixing) ----------------------------
mkdir -p "$SCRATCH/vite-smoke"
cp -R "$FIXTURE_DIR"/. "$SCRATCH/vite-smoke/"
cd "$SCRATCH/vite-smoke"
npm install --no-audit --no-fund "$JS_TGZ" "$REACT_TGZ"
# Typecheck first — exercises the `types` condition ordering. A wrong types
# resolution would silently emit any here; vite build alone wouldn't catch it.
npx --yes tsc --noEmit
# Build with mode=development so Vite resolves the `development` exports
# condition. Without this, vite build uses production resolution and wouldn't
# have caught the original bug.
npx --yes vite build --mode development

echo "ALL SMOKE CHECKS PASSED"
