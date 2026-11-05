#!/usr/bin/env bash
# Capture 3 (T003): can the read-only sandbox of the harness deny reads of
# named paths, inside and outside the working tree, read with the harness's
# own sandbox command. NOT PAID: no model call. Person-run: the owner ruling
# of 2026-09-30 leaves it to an authorized person, out of band.
set -euo pipefail
[ "${AUTHORIZED:-}" = "yes" ] || { echo "refusing: set AUTHORIZED=yes" >&2; exit 126; }
out="${1:?output directory}"; mkdir -p "$out"
codex --version > "$out/harness-version.txt"
tree="$(mktemp -d)"; mkdir -p "$tree/inside" /tmp/capture3-outside
echo secret > "$tree/inside/planted.txt"; echo secret > /tmp/capture3-outside/planted.txt
{
  echo "== inside the working tree =="
  codex sandbox --json -s read-only cat "$tree/inside/planted.txt"; echo "rc=$?"
  echo "== outside the working tree =="
  codex sandbox --json -s read-only cat /tmp/capture3-outside/planted.txt; echo "rc=$?"
} > "$out/denial.txt" 2>&1
date -u +%Y-%m-%dT%H:%M:%SZ > "$out/date.txt"
rm -rf "$tree" /tmp/capture3-outside
echo "record denial.txt into capture.json"
