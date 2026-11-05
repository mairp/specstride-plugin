# Capture 4 fixture directory (task T004 of feature 131)

What this capture is: session files outside the home while the login stays,
and what the harness writes to its home when it runs without persisting
sessions (F131-FR-013).

Status: `unverified` — the capture was **not made** by this phase. It is paid
(one small model call with a session) and the owner ruling of 2026-09-30
forbids this feature to run or fake it; an authorized person runs
`procedure.sh` out of band and logs the result in `capture.json`.

The fixture to store: `home-diff.txt` and
`session-files-outside-home.txt`. Fill `sessionLayoutFixture`, `command` and
`date` of `capture.json` after the run.

The harness pin of the capture is `codex-cli 0.153.4`.
