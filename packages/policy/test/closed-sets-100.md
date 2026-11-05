# T006 — the closed sets of feature 127, confirmed against what feature 100 generates

**Task**: T006 of `specs/127-quota-budgets-and-pause/tasks.md`.
**Date of this confirmation**: 2026-10-02 (phase 2).
**Held to the code by**: `packages/policy/test/closed-sets-100.test.ts`. The table below is not prose:
every row is asserted against `packages/contracts/src/enums/` on every test run, so a change on
either side fails the suite.

## What was confirmed, and what was not written

Feature 127 owns seven closed sets: rows 46, 47, 48 and 205 to 208 of annex X §X.6. Feature 100
generates them into `packages/contracts/src/enums/`, from the table
`packages/contracts/data/closed-sets.json`. This task **confirms** that they are present with the
members and the unknown-value rules of the section "Closed sets" of
`specs/127-quota-budgets-and-pause/spec.md`, and **writes nothing into `packages/contracts/`** — not
a member, not a row, not a comment. Feature 100 is the only writer there; a difference is
**reported**, which this file is.

Where the seven sets live:

| Row | Export | File |
| --- | ------ | ---- |
| 46 | `quotaClasses` | `packages/contracts/src/enums/sets-126-129.ts` |
| 47 | `quotaConfidence` | `packages/contracts/src/enums/sets-126-129.ts` |
| 48 | `alertLevels` | `packages/contracts/src/enums/sets-126-129.ts` |
| 205 | `alertKinds` | `packages/contracts/src/enums/sets-126-129.ts` |
| 206 | `budgetDimensions` | `packages/contracts/src/enums/sets-126-129.ts` |
| 207 | `sourcesOfAResetTime` | `packages/contracts/src/enums/sets-126-129.ts` |
| 208 | `reasonsThatSkipAFallbackEntry` | `packages/contracts/src/enums/sets-126-129.ts` |

All seven are registered in the one map of `packages/contracts/src/enums/all-sets.ts` and are
reachable as `closedSet(46)` … `closedSet(208)`.

## Row by row: the members

| Row | Set | The spec's members | What `packages/contracts/src/enums/` holds | Same? |
| --- | --- | ------------------ | ------------------------------------------ | ----- |
| 46 | Quota classes | `quota_window`, `quota_credit`, `rate_limit_transient`, `overload`, `auth`, `context_window`, `agent_failure`, `provider_other`, `budget_cap` | the nine, but in `packages/contracts/src/ep/quota-classifier.ts` as `CLASSES`; the registered set `quotaClasses` carries an **empty** member list | **no — difference D-1** |
| 47 | Quota confidence | `structured`, `status`, `text`, `stall`, `host` | the same five, as literals | yes |
| 48 | Alert levels | `info`, `warn`, `loud` | the same three, as literals | yes |
| 205 | Alert kinds | `budget-threshold`, `provider-warning`, `billing-mode-change`, `spend-unmeasurable`, `ledger-unreadable` | the same five, as literals | yes |
| 206 | Budget dimensions | `tokens`, `costUsd`, `wallClock`, `phaseAttempts`, `calls` | the same five, as literals | yes |
| 207 | Sources of a reset time | `structured`, `header`, `parsed_text` | the same three, as literals | yes |
| 208 | Reasons that skip a fallback entry | `terms-refused`, `no-cap`, `not-in-plan`, `limited` | the same four, as literals | yes |

## Row by row: the unknown-value rules

The rule of a row is read from the column "unknown value" by `unknownValueRuleOf` of
`packages/contracts/src/enums/index.ts`, which turns the cell into one of four kinds: `refuse`,
`show-as-unknown`, `ignore`, `default`.

| Row | The spec's unknown value | The cell of `closed-sets.json` | The kind it resolves to | Reads as | Agrees with the spec? |
| --- | ------------------------ | ------------------------------ | ----------------------- | -------- | --------------------- |
| 46 | `provider_other` | `` `provider_other` `` | `default` | `provider_other` | yes |
| 47 | `text` | `` `text` `` | `default` | `text` | yes |
| 48 | `warn` | `` `warn` `` | `default` | `warn` | yes |
| 205 | Shown as text at level `warn` | ``Shown as text at the level `warn` `` | `default` | `warn` | yes |
| 206 | The key is refused as a configuration error | `Configuration error` | `refuse` | — | yes |
| 207 | Read as `parsed_text` | ``Read as `parsed_text` `` | `default` | `parsed_text` | yes |
| 208 | Shown as text; the entry is skipped | `Shown as text; the entry is skipped` | `refuse` | — | **see difference D-3** |

## The static test of F100-FR-209 finds a branch for every unknown value

F100-FR-209: a reader without a branch for an unknown value fails. The mechanism is `readMember` of
`packages/contracts/src/enums/index.ts`, which throws `NoUnknownBranchError` when the value is
outside the set and the reader gave no branch.

Confirmed for all seven sets, in `packages/policy/test/closed-sets-100.test.ts`:

1. each of the seven answers `onUnknown("…")` **without throwing** — so a branch exists to be taken;
2. `readMember(set, "<not a member>")` with **no** branch throws `NoUnknownBranchError` for each of
   the seven — so a reader that forgot its branch fails rather than passing a wrong value on;
3. `readMember(set, "<not a member>", branch)` with a branch returns what the row's rule says — for
   rows 46, 47, 48, 205 and 207 the named default, and for 206 and 208 the refusal the branch turns
   into its own outcome.

The static check of feature 100 that covers the same ground is
`packages/testkit/src/static/closed-sets.ts` (`covers: F100-FR-208, F100-FR-209, F100-FR-225,
F100-SC-003, F100-SC-007`). It is run by `npm run test:static --workspace @specstride/testkit` and
passes with this feature's scope set.

## Differences reported to feature 100

Three. None is repaired here: nothing of `packages/contracts/` is written by feature 127.

### D-1 (blocking for a reader of row 46) — `quotaClasses` registers no member

`packages/contracts/src/enums/sets-126-129.ts` registers row 46 as

```ts
export const quotaClasses = defineByReference(46, [] as const);
```

because the row's cell "Members, or where the list is" reads "The nine of annex C §C.13" and so
gives no literal. The comment above it says the row "refers to another table of the package, and
registers by reference to that export" — but the export it refers to is not passed in, so the set's
member list is empty and `quotaClasses.has("quota_window")` is **false**. A reader that tests
membership through the registered set therefore treats every one of the nine classes as unknown and
reads it as `provider_other`.

The nine members do exist in the package, as `CLASSES` of
`packages/contracts/src/ep/quota-classifier.ts`, and they match the spec exactly.

**Asked of feature 100**: register the row by reference to that export —
`defineByReference(46, CLASSES)` — so that the one registered set and the EP-12 type agree. Feature
127 needs no change either way: `packages/policy/src/quota/classify.ts` reads membership from
`CLASSES` of EP-12 (`readQuotaClass`), which is the list the spec names.

### D-2 (naming) — EP-12's `ALERT_LEVELS` names `critical` where row 48 names `loud`

`packages/contracts/src/ep/quota-classifier.ts` declares

```ts
export const ALERT_LEVELS = ["info", "warn", "critical"] as const;
```

while row 48, the closed set feature 127 owns, holds `info`, `warn`, `loud` — which is what §Q.4 of
the spec uses throughout ("`loud` reaches every channel of §Q.5") and what
`packages/observability/src/catalogue/types/quota.ts` reads for the `enum` of the field `level` of
the event `alert`. So an implementation of EP-12 that returned `critical` from `observe` would emit
an `alert` whose level is not a member of the set, and the catalogue would refuse it.

**Asked of feature 100**: read `ALERT_LEVELS` of EP-12 from row 48, or spell it `loud`. Feature 127
uses row 48: `OBSERVE_LEVELS` of `packages/policy/src/quota/classify.ts` is `info`, `warn`, `loud`,
and the module says so where it declares them.

### D-3 (reading) — row 208's cell resolves to the kind `refuse`

The cell of row 208 is "Shown as text; the entry is skipped", and `unknownValueRuleOf` resolves it
to the kind `refuse`, whose message is "refused: … is not a member of the closed set …". For this
set that is the right **effect** — an unknown reason skips the fallback entry, and skipping is
refusing that entry — but the kind is the same one row 206 uses, where the effect is to refuse the
**run's configuration**. A reader that branches on the kind alone cannot tell "skip this entry and
go on" from "this key is a configuration error".

**Asked of feature 100**: no change is required for correctness. Either narrow the cell so it
resolves to `ignore`, or record in §X.6 that the kind `refuse` is scoped to the value's own record
and not to the run. Feature 127 does not depend on the kind: the fallback walk of phase 4 reads the
member list of row 208 and skips an entry whose reason is outside it, and the reason is carried as
text on `fallback.skipped` (F111-FR-051).

## What feature 127 wrote, and where

Nothing under `packages/contracts/`. This task produced exactly two files:

- `packages/policy/test/closed-sets-100.md` — this report;
- `packages/policy/test/closed-sets-100.test.ts` — the test that holds it to the code.
