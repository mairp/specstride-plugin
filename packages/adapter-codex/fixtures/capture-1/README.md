# Capture 1 fixture directory (task T001 of feature 131)

What this capture is: the stream record and the exit code of `codex exec` at a
login limit (F131-FR-032, F131-FR-034).

Status: `unverified` — the capture was **not made** by this phase. It is paid
(one model call on a login) and the owner ruling of 2026-09-30 forbids this
feature to run or fake it; an authorized person runs `procedure.sh` in this
directory out of band and logs the result in `capture.json` beside this file.
Until then every test that would use the captured fixture is a skip with its
reason, and the requirements in `waits` of `capture.json` stay `unverified`
(F131-FR-037).

The fixture to store: the JSONL stream (`stream.jsonl`) and the exit code
(`exit-code.txt`), with `harness-version.txt` and `date.txt` beside them. Fill
the fields `streamFixture`, `exitCodeFixture`, `command` and `date` of
`capture.json` after the run.

The harness pin of the capture is `codex-cli 0.153.4` (read with a read-only
`codex --version`; first read 2026-09-29, re-read 2026-10-26).
