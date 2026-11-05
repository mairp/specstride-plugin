# Capture 3 fixture directory (task T003 of feature 131)

What this capture is: whether the read-only sandbox of the harness denies
reads of named paths, inside and outside the working tree, read with the
harness's own sandbox command (F131-FR-011, F131-FR-019). Not paid: no model
call.

Status: `unverified` — the capture was **not made** by this phase. It is a
person-run step and the owner ruling of 2026-09-30 forbids this feature to run
or fake it; an authorized person runs `procedure.sh` out of band and logs the
result in `capture.json`. The hermetic part on Linux is done: the scripted
procedure, the planted-tree layout (one planted file inside the working tree,
one outside) and the result schema are stored in this directory.

The fixture to store: `denial.txt`. Fill `denialFixture`, `command` and `date`
of `capture.json` after the run.

The harness pin of the capture is `codex-cli 0.153.4`.
