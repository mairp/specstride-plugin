# Fixture capture A — the write root of the harness's own file tools under the sandbox

**Feature**: 125-adapter-claude · **Task**: T001 · **Proves**: F125-FR-019
**Kind**: paid, logged capture (out-of-band, owner ruling of 2026-09-30)
**Status of the paid part**: `unverified`
**Status of F125-FR-019 until this capture is done**: `unverified`

## What the capture asks

Whether the sandbox for shell commands confines the harness's own file tools to a
write root other than the workspace. This decides whether a proposer pass can be
contained to a throwaway root while the workspace stays read-only for the file
tools (F125-FR-019).

## Paid part — `unverified` (never run, never faked)

- **Reason**: the capture needs a live, logged call of the pinned `claude` CLI
  2.1.284 with a subscription login (a paid model call). The owner ruling of
  2026-09-30 forbids running and faking paid steps inside this feature's runs;
  the operator runs it by hand later.
- **What the operator must do**: one headless pass with
  `--permission-mode acceptEdits --permission-prompts none` that asks the
  harness to write a file through its own file tools inside a sandbox whose
  shell command has a different write root; log date, CLI version, cost, the
  path the file tool actually wrote, and whether that path is inside or outside
  the workspace.
- **Result**: pending (the requirement F125-FR-019 stays `unverified`).

## Hermetic part — done on Linux, 2026-10-26 (no login, no key, no model call)

Probed without any live call, from the pinned binary's own help text and from
the local filesystem layout:

| Probe                     | Command                                                                              | Result                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI present on this host  | `command -v claude`                                                                  | absent on this Linux host — no probe against the real binary is possible hermetically                                                                                                                   |
| Documented sandbox switch | `specs/125-adapter-claude/contracts/argument-table.md` (rows of the default profile) | the table records `--sandbox <mode>` as a documented flag of the pin; the write root it implies for the file tools is **not** stated in the help text and is exactly what the paid capture must observe |
| Local filesystem layout   | `ls -d ~/.claude ~/.claude/projects 2>/dev/null`                                     | no configuration home exists on this host (no login), so no local write root can be observed either                                                                                                     |

Conclusion of the hermetic part: nothing on this host can answer the question
without the paid call. No value is guessed; F125-FR-019 stays `unverified` and
the argument table stays at the state recorded in
`specs/125-adapter-claude/contracts/argument-table.md`.

## Log

| Field           | Value                                                  |
| --------------- | ------------------------------------------------------ |
| Date of capture | not run (out-of-band; owner runs it)                   |
| CLI version     | 2.1.284 (pin; `--help` introspection only, 2026-09-29) |
| Cost            | not incurred                                           |
| Confirmed       | nothing yet                                            |
