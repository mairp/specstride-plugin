# Fixture capture B — several headless processes under one configuration home and one login

**Feature**: 125-adapter-claude · **Task**: T002 · **Proves**: F125-FR-019
**Decides**: the descriptor field `concurrentSessions`
**Kind**: paid, logged capture (out-of-band, owner ruling of 2026-09-30)
**Status of the paid part**: `unverified`

## What the capture asks

Whether several headless processes may run under one configuration home and one
login with separate session stores. The answer decides `concurrentSessions` in
`data/descriptor.json`; until the capture is done the field stays `null` with no
guess (data-model.md: "a value not established is null with no guess").

## Paid part — `unverified` (never run, never faked)

- **Reason**: the capture needs two concurrent live headless passes of the
  pinned `claude` CLI 2.1.284 under one subscription login (paid model calls).
  The owner ruling of 2026-09-30 forbids running and faking paid steps inside
  this feature's runs; the operator runs it by hand later.
- **What the operator must do**: launch two headless passes at the same time
  under one configuration home and one login, each with its own session; log
  date, CLI version, cost, whether both streams completed, and where each pass
  kept its session store.
- **Result**: pending; `concurrentSessions` stays `null` and F125-FR-019 stays
  `unverified`.

## Hermetic part — done on Linux, 2026-10-26 (no login, no key, no model call)

| Probe                    | Command                                | Result                                               |
| ------------------------ | -------------------------------------- | ---------------------------------------------------- |
| CLI present on this host | `command -v claude`                    | absent — no hermetic concurrency probe is possible   |
| Session-store layout     | `ls -d ~/.claude/projects 2>/dev/null` | no configuration home exists on this host (no login) |

Conclusion of the hermetic part: nothing on this host can answer the question
without the paid call. No value is guessed.

## Log

| Field           | Value                                |
| --------------- | ------------------------------------ |
| Date of capture | not run (out-of-band; owner runs it) |
| CLI version     | 2.1.284 (pin)                        |
| Cost            | not incurred                         |
| Confirmed       | nothing yet                          |
