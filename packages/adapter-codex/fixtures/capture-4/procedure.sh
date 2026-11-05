#!/usr/bin/env bash
# Capture 4 (T004): session files outside the home while the login stays, and
# what the harness writes to its home without persisting sessions. PAID: one
# small model call. Authorized person, out of band only.
set -euo pipefail
[ "${AUTHORIZED:-}" = "yes" ] || { echo "refusing: set AUTHORIZED=yes" >&2; exit 126; }
out="${1:?output directory}"; workdir="$(mktemp -d)"; mkdir -p "$out"
codex --version > "$out/harness-version.txt"
home_before="$(find "$HOME/.codex" -maxdepth 2 2>/dev/null | sort)" || true
codex exec --json -s workspace-write --ignore-user-config --ignore-rules \
  --ephemeral -C "$workdir" "Reply with the single word ok." \
  > "$out/stream.jsonl" 2> "$out/stderr.txt"
home_after="$(find "$HOME/.codex" -maxdepth 2 2>/dev/null | sort)" || true
diff <(printf '%s\n' "$home_before") <(printf '%s\n' "$home_after") \
  > "$out/home-diff.txt" || true
find "$workdir" -type f > "$out/session-files-outside-home.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$out/date.txt"
rm -rf "$workdir"
echo "record home-diff.txt and session-files-outside-home.txt into capture.json"
