#!/bin/sh
# Seam D — Installer integration test
# Runs on a real OS with a real binary. Designed for GitHub Actions matrix:
#   macos-latest, ubuntu-latest, windows-latest
#
# Prerequisites:
#   - A published @flyingmt/mdvl@X on npm (or a local npm pack tarball)
#   - Node 22+
#
# Usage:
#   ./installer/test/integration.sh
#
# Exit 0 = all pass, 1 = any failure.

set -e
PASS=0
FAIL=0

ok() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
ko() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

echo "Seam D — Installer integration test"
echo "Platform: $(node -e "console.log(process.platform + '-' + process.arch)")"
echo ""

# === Fresh install ===
echo "Testing fresh install..."
npx --yes @flyingmt/mdvl@latest
if mdvl --version >/dev/null 2>&1; then
  ok "mdvl --version works"
else
  ko "mdvl --version failed"
fi

RECEIPT=""
if [ -f "$HOME/.local/state/mdvl/receipt.json" ]; then
  RECEIPT="$HOME/.local/state/mdvl/receipt.json"
elif [ -f "$HOME/Library/Application Support/mdvl/receipt.json" ]; then
  RECEIPT="$HOME/Library/Application Support/mdvl/receipt.json"
elif [ -n "$LOCALAPPDATA" ] && [ -f "$LOCALAPPDATA/mdvl/receipt.json" ]; then
  RECEIPT="$LOCALAPPDATA/mdvl/receipt.json"
fi

if [ -n "$RECEIPT" ]; then
  ok "receipt exists at $RECEIPT"
  if node -e "const r = require('$RECEIPT'); if (!r.version || !r.target || !r.sha256) process.exit(1)" 2>/dev/null; then
    ok "receipt has required fields"
  else
    ko "receipt missing required fields"
  fi
else
  ko "receipt not found"
fi

# === Re-install (idempotent) ===
echo ""
echo "Testing re-install (idempotent)..."
OUTPUT=$(npx --yes @flyingmt/mdvl@latest 2>&1)
if echo "$OUTPUT" | grep -q "already installed"; then
  ok "re-install detected existing version"
else
  ko "re-install did not detect existing version"
fi

# === Unmanaged collision ===
echo ""
echo "Testing unmanaged collision..."
npx --yes @flyingmt/mdvl@latest uninstall
# Place a fake binary without receipt
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
touch "$BIN_DIR/mdvl"
chmod +x "$BIN_DIR/mdvl"
OUTPUT=$(npx --yes @flyingmt/mdvl@latest 2>&1 || true)
if echo "$OUTPUT" | grep -q "refusing to overwrite unmanaged"; then
  ok "unmanaged collision refused"
else
  ko "unmanaged collision not detected"
fi
rm -f "$BIN_DIR/mdvl"

# === Uninstall ===
echo ""
echo "Testing clean install + uninstall..."
npx --yes @flyingmt/mdvl@latest
npx --yes @flyingmt/mdvl@latest uninstall

if ! command -v mdvl >/dev/null 2>&1; then
  ok "mdvl not on PATH after uninstall"
else
  # On the running shell PATH may still resolve; check the binary file
  if [ -f "$BIN_DIR/mdvl" ]; then
    ko "binary file still exists after uninstall"
  else
    ok "binary file removed after uninstall"
  fi
fi

if [ ! -f "$RECEIPT" ]; then
  ok "receipt removed after uninstall"
else
  ko "receipt still exists after uninstall"
fi

# === Summary ===
echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
