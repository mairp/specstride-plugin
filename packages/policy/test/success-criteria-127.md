# T086 — the measurable outcomes F127-SC-001 to F127-SC-011, run on the fake clock

**Task**: T086 of `specs/127-quota-budgets-and-pause/tasks.md`, phase 8.
**Date of this run**: 2026-10-03.
**Produced and held by**:

| File | Which outcomes it runs |
| ---- | ---------------------- |
| `packages/policy/test/success-criteria-127.test.ts` | SC-001, 002, 003, 005, 006, 007, 008, 009, 010 and the fixture half of SC-011 |
| `tests/parity/127/SC-004-wall-budget-parity.test.ts` | SC-004 (it measures the oracle routes, which this package may not read) |
| `packages/testkit/src/conformance/EP-12/SC-011-sample-127.test.ts` | the EP-12 half of SC-011 (the suite lives in the test kit) |

The column **Measured** is not prose: each of the three files recomputes its own rows on every run
and asserts that this table states exactly what the run produced. A changed figure fails the suite.
`SPECSTRIDE_SC_RECORD=1` makes the three files print their lines instead of checking them, which is
how the table is regenerated.

**Everything ran on the fake clock** (`packages/policy/test/support/clock.ts`, T003): a five-hour
pause, a twenty-four hour ceiling and four resume windows are measured in microseconds of real time,
and the jitter comes from the fixed random source, so every figure below is exact and repeatable.
No test called a model, a provider or a paid service.

## Results

| Outcome | What it states, in short | Measured | Verdict |
| ------- | ------------------------ | -------- | ------- |
| F127-SC-001 | a quota exhaustion pauses the run and spends none of the six counts | 5/5 confidence values of a `quota_window` paused; 5/5 with all six counts unchanged; 3/3 weak ones probed first; 5/5 resumed at the reset plus the margin | met |
| F127-SC-002 | alerts are loudest with an API key; an entry with no cap is never switched to | 3/3 switches wrote the `loud` `billing-mode-change` before the first call; 3/3 calls before the alert refused; 1/1 entry without a cap skipped with `no-cap` | met |
| F127-SC-003 | a hard cap holds, overshooting by at most one call per live process | 3/3 runs within the cap plus one call per live process (1:12<=13, 2:15<=16, 3:18<=19); the stop wrote `budget.exceeded` then `blocked` with `budget-cap` and no rejection | met |
| F127-SC-004 | the wall-clock budget is as at the baseline: 0 results `different` for FX-23, and FX-18 on the old path | 0/3 scenarios of FX-23 and FX-18 compared with the oracle; 3/3 `waived` because feature 141 has no golden capture in this tree; 0 results `different`; the port halves hold: the budget never trips at 0 or a value that is not a whole number and trips at whole minutes at or above the limit, and the 2 classes of FX-18 still end with `proposer_consecutive_errors` and exit 4 | unverified (no golden capture of feature 141; the oracle cannot run here) |
| F127-SC-005 | nothing pauses on weak evidence | 3/3 weak confidences probed before the pause; 0/3 paused without one; 3/3 refuting probes gave no pause | met |
| F127-SC-006 | spend is never forgotten | 2/2 unreadable cases gave spend at or above what it was before; 1/1 case with nothing readable read every hard ceiling as reached and stopped with `budget-cap` and the note `ledger-unreadable` | met |
| F127-SC-007 | the ceiling is kept, within one tick | 1/1 pause past the 24-hour ceiling rested in `blocked-on-human` with `paused_quota_ceiling` and exit 4, 0 ms after the ceiling (one tick is 60000 ms) | met |
| F127-SC-008 | the resume is punctual | 4/4 fixtures with a known reset time resumed inside the window [reset+margin, reset+margin+jitter+one tick); lateness in ms: 0, 7500, 15000, 29970 | met |
| F127-SC-009 | notional cost is kept apart | 1/1 subscription fixture: real spend null (no `api` record), notional 5.75 = the sum of the 3 reported figures; 0 hard ceilings of spend tripped | met |
| F127-SC-010 | every switch is gated and recorded | 3/3 switches evaluated the terms gate before the first call; 3/3 wrote `fallback.switched`; 2/2 switches that changed the billing mode also wrote the `loud` alert | met |
| F127-SC-011 (fixtures) | one classifier fixture per tested harness that has a captured signal | 0/0 tested harnesses with a captured signal have a fixture; 5 of 5 are marked `unverified` with the capture that would close each | met |
| F127-SC-011 (EP-12) | the conformance suite of EP-12 passes with a sample classifier outside the core, 0 core files changed | 10/10 cases of the conformance suite of EP-12 passed against the sample classifier outside the core; 0 core files name a sample | met |

## Readings of the figures

**F127-SC-001.** The five confidence values are the five of §Q.2 carrying the class `quota_window`:
`structured` (a stream record), `status` (an adapter entry that states the confidence), `text` (the
default text classifier on "the weekly limit was reached"), `stall` (the watchdog) and `host` (an
inbox request of type `host-event`, read by `packages/policy/src/quota/host.ts`). For each, the six
counts of F127-FR-011 are compared one by one before and after, the wait runs to the resume time on
the fake clock, and the resume removes the record and gives the pass back. The three weak ones are
confirmed by a probe first, which is also F127-SC-005.

**F127-SC-003.** The quickstart's arithmetic: a ceiling of 10 units and 3 units per call. The engine
records a call and enforces at every usage record; when the cap is reached, each other live process
still has one call in flight and reports it. The bound of the criterion is therefore
`10 + 3 × (live processes)`, and the measured spend is 12, 15 and 18 against 13, 16 and 19.

**F127-SC-004 is the one outcome this tree cannot verify.** The criterion asks what feature 141's
oracle reports. No golden capture of FX-23 or FX-18 exists here, so every scenario's route is
`waived` — a member of row 86 of annex X §X.6 in its own right, which is never read as `equal` and
never as a pass. 0 scenarios report `different` because 0 were compared. What *is* measured is the
port half: the rule of `loop.maxWallMin` and the as-is consecutive-error path, both of which need no
oracle. The day feature 141 lands a capture, `tests/parity/127/comparison.ts` stops answering
`waived`, the parity tests of phase 6 demand a real comparison, and this row must be re-measured.

**F127-SC-006.** "Spend is never forgotten" has two readings in F127-FR-032, and both are measured:
with a previous generation and the event stream the figure comes back whole; with nothing readable
at all every hard ceiling of spend reads as reached and the run stops with `budget-cap` and the note
`ledger-unreadable`. The alert is `loud` because a hard ceiling is set (§Q.4).

**F127-SC-008.** The four fixtures fix the jitter fraction at 0, 0.25, 0.5 and 0.999; the lateness
column is the distance from the earliest permitted instant (`resetsAt` + `pause.marginMs`), and every
one is below `pause.jitterMs` (30 000 ms) plus one stop-poll tick, as the criterion allows.

**F127-SC-009.** Real spend reads `null`, not `0`: a value that was never reported sums as unknown
and not as zero (F127-FR-028), and no `api` record exists in that fixture. That is the criterion's
"the real spend in the ledger is 0" in the ledger's own language, and the hard ceiling of 1 unit is
not tripped by 5.75 units of notional cost.

**F127-SC-011** is split across two rows because its two clauses are measured in two packages. The
fixtures clause is vacuously satisfied today and says so: **no capture exists** for any of the five
tested harnesses (`packages/policy/test/captures.md`), so 0 fixtures are required and all five are
marked `unverified` with the capture that would close each. The EP-12 clause is measured: 10 cases of
the point's own suite, run against the sample classifier that lives outside the core, 0 failures, and
0 core files that name a sample.
