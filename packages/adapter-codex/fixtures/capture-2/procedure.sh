#!/usr/bin/env bash
# Capture 2 (T002): the first record of the JSONL stream (sandbox mode and
# session) and the approval policy in force under `codex exec`. PAID: one
# small model call. Authorized person, out of band only.
set -euo pipefail
[ "${AUTHORIZED:-}" = "yes" ] || { echo "refusing: set AUTHORIZED=yes" >&2; exit 126; }
workdir="${1:?working directory}"; out="${2:?output directory}"
mkdir -p "$out"
codex --version > "$out/harness-version.txt"
prompt="Reply with the single word ok."
codex exec --json -s workspace-write --ignore-user-config --ignore-rules \
  --cfg 'approval_policy="never"' --ephemeral \
  -C "$workdir" "$prompt" > "$out/stream.jsonl" 2> "$out/stderr.txt"
rc=$?; printf '%s\n' "$rc" > "$out/exit-code.txt"
head -n 1 "$out/stream.jsonl" > "$out/first-record.jsonl"
date -u +%Y-%m-%dT%H:%M:%SZ > "$out/date.txt"
echo "record first-record.jsonl into capture.json"
