# Probe: live proposer pass (T060, PAID — not run here)

One proposer pass of `codex exec`, headless, on a login (auth tier 1). The
owner ruling of 2026-09-30 puts every paid, live, person-run step out of band:
this feature never runs it and never fakes it. An **authorized person** runs
`procedure.sh` once, on Linux or macOS, and stores the log in this folder:

- `log.json` — the log: date, command, harness version, exit code, the count
  and the first record of the JSONL stream, standard error.
- `harness-version.txt`, `date.txt` — the pin and the date of the pass.
- `stream.jsonl`, `stderr.txt` — the raw stream and error output.

The paid part stays `unverified` (in `probe.json`, in
`specs/131-adapter-codex/contracts/captures.json` → `phase7Record`, and in the
feature report) until that log is stored. **No test waits for the probe**
(F131-FR-038): `packages/adapter-codex/test/probes.test.ts` reports the probe
as a skip with its reason while `log.json` is absent, and never as a pass.

The hermetic part of the task is done in this repository: the default
argument list, the sandbox mode, the prompt on standard input, the
environment allow-list, the process group, the stream mapping and the usage
accounting are exercised against the fake binary
(`tests/conformance/codex/fake-codex.mjs`), and the harness port conformance
suite runs on the adapter (`tests/conformance/codex/suite.test.ts`).
