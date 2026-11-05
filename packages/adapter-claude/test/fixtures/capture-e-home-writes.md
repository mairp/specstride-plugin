# Fixture capture D and E — the initial record under customisation-off, and the home writes of the harness

**Feature**: 125-adapter-claude · **Tasks**: T004 · **Proves**: F125-FR-016; F125-FR-014; F125-FR-015
**Kind**: paid, logged capture (out-of-band, owner ruling of 2026-09-30)
**Status of the paid part**: `unverified`

## What the captures ask

- **D**: what the initial record lists about plugins, hooks, servers and
  capabilities under the customisation-off mode (F125-FR-016). The record goes
  to `capture-d-initial-record.ndjson`.
- **E**: where session state is kept at auth tier 1, whether it can be kept
  outside the real configuration home, whether a pass that persists nothing
  leaves no session file there, and which files the harness writes in the home
  by itself (F125-FR-014, F125-FR-015). Findings and the file list go to this
  file.

## Paid part — `unverified` (never run, never faked)

- **Reason**: both captures need live headless passes of the pinned `claude`
  CLI 2.1.284 with a subscription login (paid model calls) and a byte
  comparison of the real configuration home before and after a pass. The owner
  ruling of 2026-09-30 forbids running and faking paid steps inside this
  feature's runs; the operator runs them by hand later.
- **What the operator must do for D**: one headless pass with customisations
  off and `--output-format stream-json --verbose`; save the initial record
  (the first `system`/`init` line of the stream) verbatim to
  `capture-d-initial-record.ndjson`; log date, CLI version, cost.
- **What the operator must do for E**: snapshot the configuration home, run one
  headless pass that persists nothing, snapshot again, diff; list every path
  the harness wrote in the home by itself (the exclusion set of F125-SC-003),
  and answer whether the session store can be redirected outside the home.
- **Result**: pending; F125-FR-016, F125-FR-014 and F125-FR-015 stay
  `unverified` until the records exist.

## Hermetic part — done on Linux, 2026-10-26 (no login, no key, no model call)

`capture-d-initial-record.ndjson` exists and holds a single provenance record
that states `status: unverified` and `recordedLines: 0`: it carries no
initial-record line, because faking one is forbidden. This file records the
hermetic probes:

| Probe                    | Command                       | Result                                                                                    |
| ------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------- |
| CLI present on this host | `command -v claude`           | absent                                                                                    |
| Configuration home       | `ls -d ~/.claude 2>/dev/null` | absent on this host (no login) — no before/after byte comparison is possible hermetically |

Conclusion of the hermetic part: nothing on this host can answer either
question without the paid calls. The exclusion set of F125-SC-003 stays empty
(no list, no guess), and the descriptor's memory/telemetry fields stay null
until capture D lands.

## Log

| Field           | Value                                |
| --------------- | ------------------------------------ |
| Date of capture | not run (out-of-band; owner runs it) |
| CLI version     | 2.1.284 (pin)                        |
| Cost            | not incurred                         |
| Confirmed       | nothing yet                          |
