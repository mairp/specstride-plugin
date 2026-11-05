# @specstride/doctor

The doctor tells a consumer, before or after a run, whether the set-up is
sound. It is one function that runs registered checks (extension point
**EP-14**), and it has three exposures: the command `specstride doctor`, the
host skill in Claude Code, and the equivalent skill of the `dsh` host in
Wave 2. It reads and never writes, calls no model, reads no secret, and never
blocks a run by being unhealthy.

- Owners: feature 112. Data: `data/check-catalogue.tsv` (the 45 core checks).
- Findings schema: `specstride.doctor/1`
  (`specs/100-specstride/contracts/schemas/doctor-findings.schema.json`).
- A check registers through the registration call of the kernel package
  (`registerDoctorCheck`, F100-FR-234); the code of a registered check lives
  in the package of its owner (F112-FR-033). This package holds only the core
  catalogue.

## Layout

| Path                            | What it holds                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/registry/types.ts`         | The finding, the check type, the probe bag (F112-FR-001)                                                      |
| `src/registry/registry.ts`      | Registration, the 19 groups, refusal of a foreign group or duplicate id, read-only after launch (F112-FR-002) |
| `src/registry/launch-subset.ts` | The `lb` subset for `launch`, `--launch-checks` without launching (F112-FR-030)                               |
| `src/runner/`                   | The runner (`run.ts`), the exit codes (`exit.ts`), the flag parser (`flags.ts`)                               |
| `src/checks/`                   | The core checks, one file per group cluster                                                                   |
| `src/integrity/gate.ts`         | `events.gateIntegrity`, the five invariants of gate integrity (F112-FR-032)                                   |
| `src/render/`                   | Text, `--json`, summary, the `doctor` command entry                                                           |
| `src/probes/`                   | The safe read of untrusted files (`untrusted.ts`); the real probe implementations (`real.ts`)                 |
| `data/check-catalogue.tsv`      | One row per core check: id, group, who supplies the probe, severity rule, `lb`, message template, fix hint    |

## The 19 groups of a check

The set is closed (annex X §X.6 row 134); a registration with another group is
refused at registration time.

`env`, `cli`, `host`, `bin`, `harness`, `auth`, `model`, `critic`, `terms`,
`quota`, `budget`, `config`, `secret`, `run`, `sandbox`, `ui`, `telemetry`,
`events`, `memory`

Group counts in the core catalogue (45 checks): `env` 5, `cli` 1, `host` 4,
`bin` 1 form (`bin.<id>`, per harness), `harness` 6, `auth` 2 forms
(`auth.<id>.<role>`, `auth.tier.<role>`), `model` 2 forms
(`model.reach.<role>`, `model.window.<role>`), `critic` 3, `terms` 3,
`quota` 2 forms, `budget` 1, `config` 4, `secret` 3, `run` 2, `sandbox` 2,
`ui` 1, `telemetry` 1, `events` 2, `memory` 1. The forms with `<id>`/`<role>`
are one check per entry of the resolved harness registry; no check names a
harness by name.

## Flags

Parsed once (`src/runner/flags.ts`):

| Flag              | Effect                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| `--json`          | One record of `specstride.doctor/1` instead of text (opt-in, not budgeted) |
| `--verbose`       | More detail in the text output                                             |
| `--quick`         | Skips the checks that touch a subprocess or the network                    |
| `--offline`       | Forbids the network, allows subprocesses                                   |
| `--online`        | Runs the free model-list GETs; the default follows `doctor.online` (true)  |
| `--role <role>`   | Restricts to one role                                                      |
| `--harness <id>`  | Restricts to one harness                                                   |
| `--check <id>`    | The check-id filter; only the named checks run (repeatable)                |
| `--launch-checks` | Evaluates the `lb` subset without launching (annex G §G.4)                 |
| `--strict`        | A warning then exits 2                                                     |
| `--workdir <dir>` | The working directory the doctor reads                                     |

A usage error — an unknown flag, an unknown role, harness or check id in the
filter — is one usage line and exit 3.

## Exit codes

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| `0`  | No finding is `fail`; a warning exits 0 (research D-2, DV-041, ruling K6)       |
| `1`  | The doctor could not run: a bad working directory, or a check whose probe threw |
| `2`  | At least one finding is `fail`; with `--strict`, at least one `warn` as well    |
| `3`  | A usage error                                                                   |

## Ground rules

Read-only — the doctor writes nothing and has no `--fix` in Wave 1; every fix
hint is printed, never run. No paid call — the only network request is a free
model-list GET, redirects refused, to a declared host. No secret read — file
reads are metadata only, a credential store is never opened, at most four
characters of an inline secret are ever shown. Bounded — a probe time limit of
5 s, a subprocess output cap of 64 KiB, a finding message of at most 200
bytes, at most 7 finding lines with `fail`, at most 1,700 bytes of worst-case
text output, the whole doctor skill inside 1,500 tokens at 2.8 bytes per
token. Advisory — a launch runs exactly the `lb` subset of the same registry,
so the doctor and a launch cannot disagree.

## Tests

`npm test` in this package runs `test/*.test.ts` with `node --test`, each file
in its own process. The conformance cases of EP-14 live in
`packages/testkit/src/conformance/EP-14/`; the security and budget suites live
in `tests/security/112/` and `tests/budget/112/`.
