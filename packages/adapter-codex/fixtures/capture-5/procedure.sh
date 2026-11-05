#!/usr/bin/env bash
# Capture 5 (T005): several headless processes under one configuration home
# and one login. PAID: two small model calls side by side. Authorized person,
# out of band only.
set -euo pipefail
[ "${AUTHORIZED:-}" = "yes" ] || { echo "refusing: set AUTHORIZED=yes" >&2; exit 126; }
out="${1:?output directory}"; w1="$(mktemp -d)"; w2="$(mktemp -d)"; mkdir -p "$out"
codex --version > "$out/harness-version.txt"
codex exec --json -s workspace-write --ignore-user-config --ignore-rules \
  --ephemeral -C "$w1" "Reply with the single word one." \
  > "$out/stream-1.jsonl" 2> "$out/stderr-1.txt" & p1=$!
codex exec --json -s workspace-write --ignore-user-config --ignore-rules \
  --ephemeral -C "$w2" "Reply with the single word two." \
  > "$out/stream-2.jsonl" 2> "$out/stderr-2.txt" & p2=$!
rc1=0; wait "$p1" || rc1=$?; rc2=0; wait "$p2" || rc2=$?
printf '%s\n%s\n' "$rc1" "$rc2" > "$out/exit-codes.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$out/date.txt"
rm -rf "$w1" "$w2"
echo "record stream-1.jsonl, stream-2.jsonl and exit-codes.txt into capture.json"
