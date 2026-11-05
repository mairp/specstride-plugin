# T084 — the four files of `contracts/` checked against the spec

**Task**: T084 of `specs/127-quota-budgets-and-pause/tasks.md`, phase 8.
**Date of this check**: 2026-10-03.
**Held to the files by**: `packages/policy/test/contracts-check-127.test.ts` (18 tests). This report is
not prose: every row below is asserted on every test run, against a **parse of `spec.md` itself** —
the table of §Q.1, the table of §Q.2, the table of the section "Closed sets" and the sentence of
F127-FR-031 — so neither side can drift without the suite failing.

`contracts/README.md`: "The specification stands where a file and the spec differ." Where this check
found a difference, the **file** was brought to the spec; the spec was not touched.

## What was checked, file by file

| File | Checked against | Result |
| ---- | --------------- | ------ |
| `classifier.table.json` | §Q.1 (the nine classes, the action column, `retryable`) and §Q.2 (the five confidences, the order of evidence, the probe rules) | agrees; one reading recorded below |
| `text-patterns.json` | §Q.1 and §Q.2 (the groups the table's rows name, the order, the mark `unverified`) | agrees |
| `closed-sets.json` | the section "Closed sets" (seven rows, their members, their unknown value) | agrees |
| `spend-ledger.schema.json` | F127-FR-031 (every field the ledger must hold) | **one difference, repaired in the file**; agrees now |

## `classifier.table.json` against §Q.1 and §Q.2

| Claim of the file | What the spec says | Same? |
| ----------------- | ------------------ | ----- |
| `points.classify.choices`: eight names | §Q.1 names **nine** classes; the ninth, `budget_cap`, has the action "the budget path of §Q.3" — no provider failure produces it, so it is written by `packages/policy/src/budget/` and is never a choice of the classifier. The eight are §Q.1's nine less `budget_cap`, in §Q.1's order | yes — a **reading**, recorded, not a difference |
| every row carries `retryable` | §Q.1: "`retryable` … is a constant of the class: this table gives the one value per class"; 19 rows, each checked against the column of its own choice, and against `ACTION_BY_CLASS` of `packages/policy/src/quota/actions.ts` | yes, 19/19 |
| the rows are ordered `structured`, `status`, `text`, `stall`, default | §Q.2: "Order of evidence: a structured signal of the stream, then an HTTP status or code, then a text pattern …, then the stall watchdog" | yes |
| no row has the confidence `host` | §Q.2: "`host` is a fact that a host observed" — it reaches the engine through `packages/policy/src/quota/host.ts`, not through a table row | yes |
| the last row is the one default, choosing `provider_other` | §Q.1 (`provider_other`: "the class of an input that matches nothing") and the unknown value of closed set row 46 | yes |
| every choice has at least one row | — | yes, 8/8 |

The two confidences that pause at once (`structured`, `status`) and the three that pause only after a
confirming probe (`text`, `stall`, `host`) are read out of §Q.2's own cells and compared with
`CONFIDENCES_THAT_PAUSE_AT_ONCE` and `CONFIDENCES_THAT_PAUSE_AFTER_A_PROBE` of
`packages/policy/src/quota/probe.ts`: the same, in the same order.

## `text-patterns.json` against §Q.1 and §Q.2

| Claim of the file | Result |
| ----------------- | ------ |
| the five groups `window`, `credit`, `auth`, `overload`, `context` | exactly the groups the table's five `textGroup` rows name — no group without a row, no row without a group |
| `order` | a permutation of the groups; every group has at least one pattern |
| every group leads to a class of §Q.1 | yes, with the confidence `text` in each case |
| `note` marks the file `unverified` | yes ("Every entry is unverified …") — the provider facts rest on documentation, as `packages/policy/test/captures.md` records |

## `closed-sets.json` against the section "Closed sets"

| Row | Set | Members | Unknown value | Same as the spec? |
| --- | --- | ------- | ------------- | ----------------- |
| 46 | Quota classes | 9, the nine of §Q.1 | `provider_other` | yes |
| 47 | Quota confidence | 5 | `text` | yes |
| 48 | Alert levels | 3 | `warn` | yes (and the members are `ALERT_LEVELS` of `packages/policy/src/budget/alerts.ts`) |
| 205 | Alert kinds | 5 | shown as text at level `warn` | yes (members = `ALERT_KINDS`) |
| 206 | Budget dimensions | 5 | a configuration error | yes (members = `BUDGET_DIMENSIONS` of `packages/policy/src/budget/ceilings.ts`) |
| 207 | Sources of a reset time | 3 | `parsed_text` | yes (members = `RESET_SOURCES`, and = the backticked sources of §Q.2) |
| 208 | Reasons that skip a fallback entry | 4 | shown as text; the entry is skipped | yes (members = `SKIP_REASONS` of `packages/policy/src/budget/fallback.ts`) |

The owner field of the file is `127`, as the section says ("Owner of each: 127"), and the seven rows
are in the spec's order. Where the spec gives the unknown value as prose rather than as a member, the
check compares the words of the two cells rather than their punctuation, and requires every word of
the file to be a word of the spec.

## `spend-ledger.schema.json` against F127-FR-031 — the one difference found

F127-FR-031 names ten things the ledger must hold. Nine were described by the schema. The tenth,
**"the limit-window facts of F127-FR-009"**, was present only as an open container:

```json
"byTarget": {"type": "object"}
```

so the schema accepted any content at all for the one field whose shape F127-FR-009 and
`data-model.md` ("Limit-window fact | Harness, model tier, class, `resetsAt`, utilization,
rate-limit type, time observed") both fix. The specification stands, so the **file** was brought to
it: `byTarget` now describes one fact per target, with the five required fields `quotaClass`,
`resetsAt`, `utilization`, `rateLimitType` and `observedAt`, and records that the property name is
`<harness>/<model tier>`. That is exactly `LimitWindowFact` of `packages/policy/src/budget/ledger.ts`,
which `packages/policy/src/quota/windows.ts` writes.

Nothing else changed in the file, and no other contract file changed.

| Field of F127-FR-031 | Where the schema holds it |
| -------------------- | ------------------------- |
| per role and per billing mode | `roles.<role>.byBilling`, with `propertyNames.enum` = `api`, `subscription`, `unknown` |
| the tokens | `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens` |
| the real cost | `realCostUsd` |
| the notional cost | `notionalCostUsd` |
| the estimated cost | `estimatedCostUsd` |
| the number of calls | `calls` |
| the coverage of F127-FR-028 | `passesWithKnownCost`, `passesTotal` |
| the number of phase attempts started | `run.phaseAttempts` |
| the limit-window facts of F127-FR-009 | `windows.byTarget.<harness>/<tier>` (repaired above) |
| the start of the pause episode | `windows.episodeStart` |

The check does not stop at the field list: it builds a ledger **with the implementation**
(`emptyLedger` and three `applyUsageRecord` calls, one per billing mode, plus a limit-window fact, an
episode start, a phase attempt and an alert key), serializes it, and validates the result against the
schema of the spec. 0 errors. So the schema describes the ledger the product actually writes, and not
only the one the requirement describes.

## The two copies the code loads

`packages/policy/data/classifier.table.json` and `packages/policy/data/text-patterns.json` are
asserted byte-for-byte equal to the contract files that were checked (T005 made the copies; this
check keeps them honest, so the file that was checked is the file the classifier loads).

## Not in this check

- The closed sets against what feature 100 **generates** — that is T006, and its report is
  `packages/policy/test/closed-sets-100.md`.
- The table against the **evaluator** of feature 100 — that is T005, and `packages/policy/src/quota/table.ts`
  validates both data files at load through `loadTable` of `@specstride/kernel`.
