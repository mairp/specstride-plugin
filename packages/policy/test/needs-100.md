# T085 — the one need of feature 127 towards feature 100, and its answer

**Task**: T085 of `specs/127-quota-budgets-and-pause/tasks.md`, phase 8.
**Date**: 2026-10-03.
**Held to the files by**: `packages/policy/test/needs-100.test.ts` (12 tests). Every row below is
asserted on each run against the files it cites — feature 100's annexes, feature 100's spec, feature
100's worklist and the channel — all read **read-only**. Feature 127 writes nothing under
`specs/100-specstride/`.

## Summary

The need is **sent and answered**. It was sent as row 141 of the channel
`docs/ecosystem/STAGE-B-F100-AMENDMENTS.md` ("Annex D §D.4 lists no quota signal for the router,
although F100-FR-130 and F100-FR-140 need a skip on a limited target (CQ-136)"). Feature 100 took
the second of the two ways the task allows — not a new signal invented here, but **its confirmation
that the router asks the limit-window state**:

- annex D §D.4, under **Inputs** of the decision point, now lists among the signals
  *"the state of the limit window of the target of an escalation"*
  (`specs/100-specstride/annexes/D-pass-loop.md`, the Inputs list of §D.4);
- **F100-FR-130** of the same annex: *"When the quota of the target is exhausted the escalation MUST
  be skipped, the repair MUST run on the base model, and the skip MUST be recorded."*;
- `specs/100-specstride/spec.md` records the reading itself: *"Every decision is an event once a loop
  layer is engaged; the signals include the state of the limit window of an escalation target"*,
  owners **115, 127**, clarification **CQ-136**;
- feature 100's own `amendments-worklist.md` row **141** is **`[x]`**, action *change in place*.

What this pass did, therefore, was not to raise the need again but to **read the answer back and
record it in the channel**: the `Applied` cell of the four rows of feature 127 (rows 138, 139, 140
and 141 of the channel) now carries the answer and the date, in place of the stale `no`. No row of
any other feature was touched, and the line count of the channel is unchanged, because feature 100's
worklist addresses rows of that file **by line number**.

## The durable identity of the answer

The four answering passages, joined in the order above with one newline between them, hash under the
canonical hasher of feature 100 (annex X §X.5, `contentHash` of `@specstride/kernel/hasher`) to

```
0b52f0ff39456e049011606bd35acf783cf8a9fede1f03074f4535cf7cda7e11
```

The test recomputes this from the files on disk and fails if feature 100's text changes. A hash over
another feature's text is the one identity this task can produce that could not exist before the
answer was written.

## The three needs the task calls satisfied — measured, not assumed

| Need | Where it stands in feature 100 | Measured |
| ---- | ------------------------------ | -------- |
| The logical name `run:<runId>:spend` | annex B §B.5: `run:<runId>:spend` \| control \| **Engine** \| Engine, doctor, digest \| "The spend ledger of the run"; and the schema row `specstride.spend/1` → `run:<runId>:spend`, owner 127 | yes |
| Rows 107 to 112 of annex X §X.7 | 107 `loop.maxWallMin`; 108 `budget.role.<role>.costUsd`, `.tokens`, `.softTokens`, `.calls`, `budget.run.*`; 109 `budget.alerts.thresholds`; 110 `budget.rates`; 111 `pause.marginMs`, `pause.jitterMs`, `pause.probeScheduleMs`, `quota.transientMaxWaitMs`, `quota.overloadRetries`; 112 `roles.<role>.fallbackAfterMs`, `roles.<role>.fallbackReturn` — each owned by 127 | yes, 6 of 6 |
| Rows 205 to 208 of annex X §X.6 | 205 alert kinds; 206 budget dimensions; 207 sources of a reset time; 208 reasons that skip a fallback entry — each owned by 127 | yes, 4 of 4 |

T006 (`./closed-sets-100.md`) separately checks the **members** of those closed sets against what
feature 100 generates into `packages/contracts/src/enums/`.

## The side of the need feature 127 owns

The signal annex D §D.4 names is answered by this feature's own query, and the test exercises it:
`observeLimitWindow`, `readLimitWindow` and `decideEscalation` of
`packages/policy/src/quota/windows.ts` (F127-FR-009, T022). A limited escalation target gives
`skipped: true` with the reason `limited` (row 208) and the work runs on the base model — which is
exactly what F100-FR-130 requires of the router.

## Nothing else is open

Feature 127 has no other need towards feature 100: the four rows of the channel that name 127 are
the whole list, and all four now read `yes`. CQ-136 is closed.
