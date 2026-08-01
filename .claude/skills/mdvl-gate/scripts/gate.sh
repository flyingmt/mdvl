#!/usr/bin/env bash
# The completion checklist from CLAUDE.md rule 20, as one command.
#
# Every step is anchored to the repo root rather than the caller's directory.
# The web toolchain only works from web/ and the Rust one only from the root, so
# a gate that trusted the current directory would pass or fail depending on
# where it was started — which is how `npm install` once landed a dependency in
# the wrong package and `rm` once took the wrong README.
#
#   ./gate.sh          every check
#   ./gate.sh rust     the Rust half only
#   ./gate.sh web      the web half only
#   ./gate.sh quick    skip the e2e run (use while iterating, never to finish)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
WEB="$ROOT/web"
SCOPE="${1:-all}"

failed=()
passed=()

step() {
	local name="$1"
	shift
	printf '\n\033[1m▸ %s\033[0m\n' "$name"
	if "$@"; then
		passed+=("$name")
	else
		failed+=("$name")
		printf '\033[31m  ✗ %s\033[0m\n' "$name"
	fi
}

in_root() { (cd "$ROOT" && "$@"); }
in_web() { (cd "$WEB" && "$@"); }

if [ ! -f "$ROOT/Cargo.toml" ]; then
	echo "gate.sh: $ROOT is not the mdvl repo root" >&2
	exit 2
fi

# The Rust binary serves web/build. A debug build reads it from disk at run
# time, so stale assets make the browser tests assert against the last build
# rather than this one. Build the web app before anything runs against it.
if [ "$SCOPE" != "rust" ]; then
	step "web · build"        in_web npm run build
	step "web · format"       in_web npm run format
	step "web · lint"         in_web npm run lint
	step "web · typecheck"    in_web npm run check
fi

if [ "$SCOPE" != "web" ]; then
	step "rust · format"      in_root cargo fmt --check
	step "rust · clippy"      in_root cargo clippy --all-targets -- -D warnings
	step "rust · build"       in_root cargo build
	# dev-proxy swaps the asset handler, so it compiles code the default build
	# never sees. It has broken on its own before.
	step "rust · build (dev-proxy)" in_root cargo build --features dev-proxy
	step "rust · seam A"      in_root cargo test
fi

# Seam C — the installer never reaches a browser or the Rust binary, so neither
# of the other halves can see it. Its packaging rules decide whether anything
# gets installed at all: a `files` field once left checksums.json out of the
# published tarball and every `npx` install failed on it.
if [ -f "$ROOT/installer/test/bootstrap.test.js" ]; then
	step "installer · seam C" in_root node installer/test/bootstrap.test.js
fi

if [ "$SCOPE" != "rust" ] && [ "$SCOPE" != "quick" ]; then
	step "web · seam B"       in_web npx playwright test
fi

printf '\n\033[1m── gate ──\033[0m\n'
for name in ${passed[@]+"${passed[@]}"}; do printf '  \033[32m✓\033[0m %s\n' "$name"; done
for name in ${failed[@]+"${failed[@]}"}; do printf '  \033[31m✗\033[0m %s\n' "$name"; done

if [ ${#failed[@]} -gt 0 ]; then
	printf '\n\033[31m%d check(s) failed.\033[0m Report them as failures — a gate\n' "${#failed[@]}"
	printf 'that is described as passing when it did not is worse than no gate.\n'
	exit 1
fi

if [ "$SCOPE" = "quick" ]; then
	printf '\n\033[33mquick: seam B was not run.\033[0m Not a finished gate.\n'
	exit 0
fi

printf '\n\033[32mAll checks passed.\033[0m\n'
