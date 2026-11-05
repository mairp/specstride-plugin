# Capture 2 fixture directory (task T002 of feature 131)

What this capture is: the first record of the JSONL stream (the sandbox mode
and the session id) and the approval policy in force under `codex exec`
(F131-FR-009, F131-FR-020, F131-FR-036).

Status: `unverified` — the capture was **not made** by this phase. It is paid
(one small model call) and the owner ruling of 2026-09-30 forbids this feature
to run or fake it; an authorized person runs `procedure.sh` out of band and
logs the result in `capture.json`.

The fixture to store: `first-record.jsonl` and `exit-code.txt`. It settles
whether the configuration override for approvals `never` is in force under
`exec` and what the first record shows. Fill `firstRecordFixture`, `command`
and `date` of `capture.json` after the run.

The harness pin of the capture is `codex-cli 0.153.4`.
