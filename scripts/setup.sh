#!/usr/bin/env bash
# Run once after cloning to wire up git hooks.
set -euo pipefail

git config core.hooksPath .githooks
chmod +x .githooks/*

echo "✔ tack git hooks installed"
