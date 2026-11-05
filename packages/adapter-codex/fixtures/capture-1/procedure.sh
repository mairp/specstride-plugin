#!/usr/bin/env bash
# Capture 1 (T001): the stream record and the exit code of `codex exec` at a
# login limit. PAID: this script calls the model once. Run it only as an
# authorized person, out of band (owner ruling of 2026-09-30); this feature
# never runs it and never fakes its result.
#
# Usage: AUTHORIZED=yes bash procedure.sh <workdir> <out-dir>
set -euo pipefail
[ "${AUTHORIZED:-}" = "yes" ] || { echo "refusing: set AUTHORIZED=yes" >&2; exit 126; }
workdir="${1:?working directory}"; out="${2:?output directory}"
mkdir -p "$out"
version="$(codex --version)"; printf '%s\n' "$version" > "$out/harness-version.txt"
prompt="Reply with the single word ok."
set +e
codex exec --json -s workspace-write --ignore-user-config --ignore-rules --ephemeral \
  -C "$workdir" "$prompt" > "$out/stream.jsonl" 2> "$out/stderr.txt"
rc=$?
set -e
printf '%s\n' "$rc" > "$out/exit-code.txt"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$out/date.txt"
echo "record stream.jsonl, exit-code.txt and harness-version.txt into capture.json"
