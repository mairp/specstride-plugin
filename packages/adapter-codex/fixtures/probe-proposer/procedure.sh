#!/usr/bin/env bash
# T060 — the scripted procedure of the live proposer probe (PAID; logged;
# authorized; NOT run by this feature, never by CI: F131-FR-038, the owner
# ruling of 2026-09-30).
#
# An AUTHORIZED PERSON runs this out of band, once, on a machine with a
# `codex` on the search path and a login (auth tier 1). It makes ONE small
# paid model call. Nothing in this repository runs it: no test and no CI job
# waits for it or depends on it (the tests run on the fake binary).
#
# It writes the log beside itself: log.json, harness-version.txt, date.txt.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

date -u +"%Y-%m-%dT%H:%M:%SZ" > "$HERE/date.txt"
codex --version > "$HERE/harness-version.txt"

# One headless proposer pass, the default (non-parity) invocation of the
# adapter: sandbox workspace-write, approvals never, the prompt on standard
# input, the user configuration ignored, no session persisted (ephemeral).
# The JSONL stream and the exit code are the log.
set +e
printf 'Reply with the single word OK and nothing else.' \
  | codex exec --json -s workspace-write -C "$HERE" \
      --ignore-user-config --ignore-rules --ephemeral - \
      > "$HERE/stream.jsonl" 2> "$HERE/stderr.txt"
STATUS=$?
set -e

node -e '
const fs = require("fs");
const dir = process.argv[1];
const exitCode = Number(process.argv[2]);
const lines = fs.readFileSync(dir + "/stream.jsonl", "utf8")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
fs.writeFileSync(dir + "/log.json", JSON.stringify({
  probe: "proposer", task: "T060", paid: true,
  date: fs.readFileSync(dir + "/date.txt", "utf8").trim(),
  harnessVersion: fs.readFileSync(dir + "/harness-version.txt", "utf8").trim(),
  exitCode,
  records: lines.length,
  firstRecord: lines[0] ?? null,
  stderr: fs.readFileSync(dir + "/stderr.txt", "utf8"),
}, null, 2) + "\n");
' "$HERE" "$STATUS"
echo "probe logged in $HERE/log.json (exit $STATUS)"
