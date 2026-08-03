#!/bin/sh
# Seam D — Installer integration test (macOS, Linux)
#
# Runs after publication, against the real registry, on a real OS. It answers
# one question: does `npx @flyingmt/mdvl@X` put a working mdvl on this machine
# and take it back off again?
#
# Requires MDVL_VERSION — the version just published. `@latest` would test
# whichever version happens to be newest, which during a release is not
# necessarily the one being released.
#
# Exit 0 = all pass, 1 = any failure.

set -e

if [ -z "$MDVL_VERSION" ]; then
  echo "MDVL_VERSION is not set — refusing to guess which version to verify." >&2
  exit 1
fi

PKG="@flyingmt/mdvl@$MDVL_VERSION"
PASS=0
FAIL=0

ok() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
ko() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

BIN="$HOME/.local/bin/mdvl"

case "$(uname -s)" in
  Darwin) STATE="$HOME/Library/Application Support/mdvl" ;;
  *)      STATE="${XDG_STATE_HOME:-$HOME/.local/state}/mdvl" ;;
esac
RECEIPT="$STATE/receipt.json"
FRAGMENT="$STATE/shell.sh"

echo "Seam D — installer integration"
echo "Package:  $PKG"
echo "Platform: $(node -e "console.log(process.platform + '-' + process.arch)")"
echo ""

# A version is published before every CDN edge serves it, and edges disagree
# with each other in the meantime. 0.1.5 proved that waiting on `npm view` is
# not enough: the macOS verifier watched `npm view` succeed and then took
# ETARGET from npx seconds later, having reached a different edge. Retry the
# command actually under test instead of a proxy for it.
echo "Installing..."
attempt=1
until npx --yes "$PKG"; do
  if [ "$attempt" -ge 10 ]; then
    echo "npx --yes $PKG still failing after $attempt attempts" >&2
    exit 1
  fi
  echo "  attempt $attempt failed — the registry may not serve $MDVL_VERSION yet; retrying in 10s"
  attempt=$((attempt + 1))
  sleep 10
done

if [ -x "$BIN" ]; then
  ok "binary installed at $BIN"
else
  ko "no executable at $BIN"
fi

# Called by absolute path on purpose. The installer writes a PATH fragment that
# only a newly started shell sources, so a bare `mdvl` here would fail for a
# reason that has nothing to do with whether the install worked.
if "$BIN" --version 2>/dev/null | grep -q "$MDVL_VERSION"; then
  ok "mdvl --version reports $MDVL_VERSION"
else
  ko "mdvl --version did not report $MDVL_VERSION (got: $("$BIN" --version 2>&1 || echo '<failed to run>'))"
fi

if [ -f "$RECEIPT" ]; then
  ok "receipt written to $RECEIPT"
  if node -e "const r = require('$RECEIPT'); if (r.version !== '$MDVL_VERSION' || !r.target || !r.sha256) process.exit(1)"; then
    ok "receipt records version, target and sha256"
  else
    ko "receipt is missing fields or names the wrong version"
  fi
else
  ko "no receipt at $RECEIPT"
fi

if [ -f "$FRAGMENT" ]; then
  ok "PATH fragment written to $FRAGMENT"
else
  ko "no PATH fragment at $FRAGMENT"
fi

echo ""
echo "Uninstalling..."
npx --yes "$PKG" uninstall

if [ -e "$BIN" ]; then
  ko "binary still at $BIN after uninstall"
else
  ok "binary removed"
fi

if [ -e "$RECEIPT" ]; then
  ko "receipt still at $RECEIPT after uninstall"
else
  ok "receipt removed"
fi

if [ -e "$FRAGMENT" ]; then
  ko "PATH fragment still at $FRAGMENT after uninstall"
else
  ok "PATH fragment removed"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
