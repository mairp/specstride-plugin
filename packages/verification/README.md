# `@specstride/verification`

Feature 105, layer **L1**, owner **105**, extension point **EP-07**
(`specstride.verification-source/1`).

A consumer declares how their project is verified: commands that build, check
types, lint and test. This package finds those declarations, freezes them at
launch as a verification plan and one check manifest per phase, and runs them
as the verification gate of every phase attempt — **before the critic is
called**. A failed command rejects the attempt with no critic call, and the
engine writes the feedback itself; the proposer's claim and the critic's
judgment never stand in for a command that failed.

Every command runs through the check runner of feature 100, annex C §C.8. This
package starts no process of its own, with one exception the specification
names: a *detached* command staged before, which the process primitive of
`@specstride/kernel` starts (F100-FR-234, `research.md` D-17).

- Specification: [`specs/105-verification/spec.md`](../../specs/105-verification/spec.md)
- Plan: [`specs/105-verification/plan.md`](../../specs/105-verification/plan.md)
- Quickstart: [`specs/105-verification/quickstart.md`](../../specs/105-verification/quickstart.md)
- What was extracted, and from where: [`EXTRACTED.md`](EXTRACTED.md)

## The folders of `src/`

| Folder | Concern |
|---|---|
| `mode/` | the modes `off`, `plan`, `required`; the settings; their errors; the narrowing rule |
| `plan/` | the plan record, the ids, the hashes, validation, obligations, suites, gates |
| `sources/` | the EP-07 registry; the commands document, the literal source, discovery |
| `manifest/` | the derivation of a check manifest, its hash, its comparison on a relaunch |
| `render/` | the plan for people, the phase context, the scaffolds, the safe writes |
| `gate/` | the verification gate, release verification, the feedback, the events, the records |
| `prestage/` | the staged commands, the detached ones, the reuse rules, the build artifacts |
| `summary/` | the failure summary |
| `staleness/` | the check at critic start, under the `parity` profile only |
| `cli/` | the sub-commands of `verify` |

## Performance: the starting values of `plan.md`, measured

`plan.md`, "Technical Context", gives two **Performance Goals**, each
"a starting value with low confidence, measured in the build", and the
constitution check of the same plan carries a third number under Principle
XIX: the gate summary line is the share of the token budget, at most 200 bytes
per phase attempt, measured in the build. All three are measured here.

The record below is **not** a remembered one. The build re-measures all of it
on every `npm test`, from
[`packages/verification/test/performance-105.test.ts`](test/performance-105.test.ts)
(task **T143**), which reads the three numbers out of `plan.md` itself and
holds this table against them. A recorded value that no longer satisfies the
plan fails the build, and a plan whose numbers change fails it too.

- Measured on **2026-10-03**, Linux `7.0.14-15-pve` (x64), Node.js **v22.23.2**,
  in this workspace, with no network.
- The statistic recorded for the two timings is the **median** of the samples;
  the test prints the minimum, the median and the maximum of every measurement
  to the build log. The byte counts are exact.

<!-- performance:begin -->

| Starting value of `plan.md` | Goal | Measured | Bound the build asserts | Samples |
|---|---|---|---|---|
| Derivation of a plan with 50 phases and 100 commands | under 2 s | **5.99 ms** (median) | the median is under the goal | 7 |
| Rendering of the failure summary of a result record of 1 MB | under 200 ms | **4.66 ms** (median) | the median is under the goal | 9 |
| Bytes of the gate summary line of a phase attempt | at most 200 bytes | **53 bytes** (a passed gate) | the recorded count is the measured one and is at most the ceiling | exact |

<!-- performance:end -->

Range of each measurement, as this run printed it:

| Measurement | min | median | max |
|---|---|---|---|
| Derivation of a plan, 50 phases and 100 commands | 5.09 ms | 5.99 ms | 8.42 ms |
| Failure summary of a record of 1 MB (1 181 371 bytes) | 4.41 ms | 4.66 ms | 6.02 ms |

And the gate summary line, by the number of failed commands it names:

| Failed commands the line names | Bytes (UTF-8) |
|---|---|
| 0 (a passed gate: `Verification gate GATE-phase-50 passed 100 command(s)`) | 53 |
| 1 | 48 |
| 2 | 58 |
| 4 | 78 |
| 8 | 118 |
| 100 | 1038 |

### What each number is

- **The derivation of a plan** is `createPlan` of
  [`src/plan/create.ts`](src/plan/create.ts) over a canonical spec model of 50
  phases and a verification-commands document of 100 declared commands, two
  per phase. It includes the projection `tasks-v2`, the obligations, the suites
  and gates of every phase, the two hashes of the plan and the validation the
  derivation ends with — everything a launch pays for, once. **5.99 ms against
  a goal of 2 s**: the derivation is not a cost a run notices.
- **The failure summary** is `renderFailureSummary` of
  [`src/summary/failure-summary.ts`](src/summary/failure-summary.ts) over a
  result record whose captured output is **1 MB** — 1 181 371 bytes of JSON
  text, measured as bytes and not estimated. The record's two streams hold
  about 8 500 lines each, because the summary cuts the *ends* of a stream
  (80 lines of standard output, 40 of standard error, F105-FR-037): a record of
  one enormous line would have measured the cut and not the record.
  **4.66 ms against a goal of 200 ms.**
- **The bytes of the gate summary line** are the bytes of `gateSummary` of
  [`src/gate/gate.ts`](src/gate/gate.ts) in UTF-8. It is the only line the
  verification gate adds to a phase attempt's prompt budget, so it is the whole
  of this feature's share of that budget.
  - A **passed** gate's line names the count and no id, so its width does not
    grow with the number of commands: **53 bytes** for a gate of 100 commands,
    against the ceiling of 200.
  - A **failed** gate's line names every failed command, because that is the
    as-is line of the baseline (item B-1074) and parity binds it. It stays
    under the ceiling up to **eight** failed commands (118 bytes) — which
    covers every fixture of this feature and every phase of its own plan — and
    a gate of 100 failed commands would print **1038 bytes**. The number is
    recorded rather than capped: capping it would change an as-is line, and
    the ceiling of Principle XIX is about the ordinary phase attempt.

## Tests

| What | Where |
|---|---|
| The package's own tests | `test/` |
| Characterization and own tests | `../../tests/characterization/105/` |
| Parity against the Specstride baseline at `9cab15d` | `../../tests/parity/105/` |
| The conformance suite of EP-07 | `../testkit/src/conformance/EP-07/` |
| The sample plan source outside the core | `../testkit/src/samples/EP-07/` |
| The fixture tree of documents, plans and result records | `../../tests/fixtures/105/` |
| The quickstart, run end to end | `../../tests/release/105/` |

The result of running `quickstart.md` end to end is recorded in
[`specs/105-verification/build-report.md`](../../specs/105-verification/build-report.md);
what stays `unverified`, and why, is recorded in
[`specs/105-verification/verification-record.md`](../../specs/105-verification/verification-record.md).
