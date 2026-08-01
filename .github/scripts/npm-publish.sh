#!/usr/bin/env bash
# Publish the package in the current directory, tolerating exactly one failure:
# this version already being on the registry, which is what a re-run of a
# release hits and the only thing that is safe to ignore.
#
# Everything else must fail the job. A blanket `|| echo` reads as "idempotent"
# but swallows a bad token, a scope with no write access, and a network fault
# alike — and a release that reports success while publishing nothing is worse
# than one that stops, because nobody goes looking. That is not hypothetical:
# v0.1.2 reported six green publish steps and put nothing on the registry.

set -uo pipefail

log=$(mktemp)
trap 'rm -f "$log"' EXIT

if npm publish --access public --provenance 2>&1 | tee "$log"; then
	exit 0
fi

# npm says EPUBLISHCONFLICT, or 403s with this sentence, when the version is
# already there. A 404 on PUT is npm's way of saying the token cannot write to
# this scope — it is an authorisation failure wearing a not-found costume, and
# it must never be mistaken for "already published".
if grep -qiE 'EPUBLISHCONFLICT|cannot publish over the previously published' "$log"; then
	echo "::notice::$(basename "$PWD") is already published at this version — nothing to do"
	exit 0
fi

echo "::error::npm publish failed for $(basename "$PWD") — see the log above" >&2
exit 1
