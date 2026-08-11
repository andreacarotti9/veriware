#!/usr/bin/env bash
#
# Packs the package, checks the tarball contains exactly what it should, then
# installs it into a scratch project and runs the offline example against it.
#
# This is the only gate that exercises what a consumer actually downloads:
# `npm test` runs against `src/`, which is not what ships.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$root/scripts/package-files.txt"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> packing"
tarball="$(cd "$root/js" && npm pack --silent --pack-destination "$work")"
tarball="$work/$tarball"

echo "==> checking the tarball file list"
tar -tzf "$tarball" | sed 's|^package/||' | LC_ALL=C sort > "$work/actual.txt"
if ! diff -u "$manifest" "$work/actual.txt"; then
  echo
  echo "The published file list changed. If that is deliberate, update:"
  echo "  $manifest"
  exit 1
fi

echo "==> installing into a scratch project"
mkdir -p "$work/project"
cd "$work/project"
npm init -y > /dev/null
npm pkg set type=module > /dev/null
npm install --silent --no-audit --no-fund "$tarball"

echo "==> running the offline example"
mkdir -p fixtures
cp "$root/fixtures/vectors.json" fixtures/vectors.json
cp "$root/examples/node/verify-fixture.mjs" .
# The example resolves the fixtures relative to itself; in the scratch project
# that is one directory shallower than in the repository.
sed -i.bak 's|../../fixtures/vectors.json|./fixtures/vectors.json|' verify-fixture.mjs
node verify-fixture.mjs

echo
echo "smoke passed: the tarball installs and verifies from a clean project"
