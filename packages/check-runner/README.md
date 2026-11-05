# `@specstride/check-runner`

Feature 148, layer **L1**, owner **148**, extension point **EP-05**
(`specstride.check-runner/1`).

The one component that runs a deterministic command for a check — a command of
the verification gate, of release verification, of an inner check, of the
closing check or of the merge check. Because there is **one** runner, a result
means the same wherever it was obtained (`specs/148-check-runner/research.md`,
decision D-2).

It pins the executable at launch, runs a fixed argument list without a shell,
bounds its time and its output, keeps provider credentials away from it, and
returns a result whose conditions stand beside the exit result.

- Specification: [`specs/148-check-runner/spec.md`](../../specs/148-check-runner/spec.md)
- Plan: [`specs/148-check-runner/plan.md`](../../specs/148-check-runner/plan.md)
- Quickstart: [`specs/148-check-runner/quickstart.md`](../../specs/148-check-runner/quickstart.md)
- What was extracted, and from where: [`EXTRACTED.md`](EXTRACTED.md)

## The folders of `src/`

| Folder | Concern |
|---|---|
| `registry/` | the EP-05 registry, the pin, the handles, `environment`, the plainer path |
| `command/` | the kind `command`: spawn, process group, time limit, output cap, environment, containment |
| `result/` | conditions, reasons, errors, closed sets, unknown values |
| `guard/` | no start while a pass lives; the manifest hash, the pin, the search path |
| `bracket/` | the two fingerprint readings; the taint; the protected-set fact |
| `steps/` | the step runner and the `partial` run of steps |
| `batch/` | admission, formation, isolation, the second execution, the lowered parallelism |
| `events/` | the event types of a check and their batch fields |

## Performance: the starting values of `plan.md`, measured

`plan.md`, "Technical Context", gives three **Performance Goals**, each
"a starting value with low confidence, measured in the build". They are
measured here.

The record below is **not** a remembered one. The build re-measures all of it
on every `npm test`, from
[`packages/check-runner/test/performance-148.test.ts`](test/performance-148.test.ts)
(task **T062**),
which reads the three goals out of `plan.md` itself and holds this table
against them. A recorded value that no longer satisfies the plan fails the
build, and a plan whose numbers change fails it too.

- Measured on **2026-10-02**, Linux `7.0.14-15-pve` (x64), Node.js **v22.23.2**,
  in this workspace, with no network.
- The statistic recorded is the **median** of the samples; the test prints the
  minimum, the median and the maximum of every measurement to the build log.

<!-- performance:begin -->

| Starting value of `plan.md` | Goal | Measured (median) | Bound the build asserts | Samples |
|---|---|---|---|---|
| The overhead of the runner per command, without the fingerprint readings | under 50 ms | **0.24 ms** | the median is under the goal | 9 |
| Batch formation for 100 entries | under 10 ms | **1.46 ms** | the median is under the goal | 25 |
| The end of a process group after a time limit | within 5 s | **0.12 ms** | every sample is within the goal | 3 |
| `pin` of one entry at launch, on a 124.8 MB executable | no goal: a launch cost, once per entry | **250.71 ms** | under 5 s | 7 |

<!-- performance:end -->

Range of each measurement, as this run printed it:

| Measurement | min | median | max |
|---|---|---|---|
| Overhead per command | 0.03 ms | 0.24 ms | 2.18 ms |
| Batch formation, 100 entries | 0.81 ms | 1.46 ms | 7.06 ms |
| End of a process group after a time limit | 0.05 ms | 0.12 ms | 0.23 ms |
| `pin`, 124.8 MB executable (`node` itself) | 211.95 ms | 250.71 ms | 271.68 ms |
| `pin`, 43 kB executable (`/bin/true`) | 0.13 ms | 0.18 ms | 15.77 ms |

### What each number is

- **The overhead of the runner per command** is the wall time of `start` plus
  `result`, less the duration the result reports for the child itself. It is
  the runner's own work: building the environment, spawning into a process
  group of its own, the bounded capture of the two streams, the timer of the
  time limit and the result record. `pin` is deliberately **not** in it, and no
  fingerprint reading is taken, which is what `plan.md` means by "without the
  fingerprint readings". **0.24 ms against a goal of 50 ms**: the cost of a
  command is the command, not the runner.
- **Batch formation for 100 entries** is `formBatches` of `src/batch/`, a pure
  function of the manifest and the parallelism (`research.md`, decision D-3),
  measured without running a command. The 100 entries of the measurement each
  declare their own reads and writes and form **25 batches of 4** at
  `verification.parallelism` 4, so the number is the cost of real formation
  and not of an empty call.
- **The end of a process group after a time limit** is read from the
  **operating system**, not from the runner's own record: the time from the
  result of a command ended by its time limit to `kill(-group, 0)` reporting
  `ESRCH`. The command measured is the scripted `never-ending.ts`, which
  nothing but the time limit or `cancel` can end.
- **`pin` at launch** has no starting value in `plan.md`, and it is recorded
  here because it is the one cost of this feature that is dominated by what it
  pins rather than by the runner: `pin` records the sha256 of the executable
  (F148-FR-001), so pinning `node` itself — 124.8 MB — costs about 250 ms,
  while pinning a 43 kB executable costs about 0.2 ms. It runs **once per
  entry of the check manifest, at launch**, never per command of a check.

The measurement of a loaded build machine is noisy: the maximum of a sample
set is several times its median above. That is why the bound the build asserts
is the median for the two goals measured in milliseconds, and every sample for
the end of a process group, whose margin against the 5 s goal is four orders
of magnitude.

## Tests

| What | Where |
|---|---|
| The package's own tests | `test/` |
| Characterization and own tests | `../../tests/characterization/148/` |
| Parity against the Specstride baseline | `../../tests/parity/148/` |
| The conformance suite of EP-05 | `../testkit/src/conformance/EP-05/` |
| The sample runner outside the core | `../testkit/src/samples/EP-05/` |
| The scripted commands the tests run | `../../tests/fixtures/148/commands/` |
| The quickstart, run end to end | `../../tests/release/148/` |

The result of running `quickstart.md` end to end is recorded in
[`specs/148-check-runner/build-report.md`](../../specs/148-check-runner/build-report.md);
what stays `unverified`, and why, is recorded in
[`specs/148-check-runner/verification-record.md`](../../specs/148-check-runner/verification-record.md).
