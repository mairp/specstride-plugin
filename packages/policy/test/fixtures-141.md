# The fixtures and stubs of feature 141 that this feature uses (T004)

Task T004 of `specs/127-quota-budgets-and-pause/tasks.md`: confirm with feature 141 that the stubs
and the scenarios of FX-23 (`wall-budget`) and FX-18 exist, that the generic stub `stub-harness` can
declare a limit signal, and list the scenarios this feature adds inside those families
(F141-FR-030).

The confirmation was asked for and answered in feature 141's own cross-feature round. The answer is
recorded in `specs/141-parity-oracle/followup-report.md` §2.2, in the row whose "Asked by" is `127`,
and it is reproduced here, wrapped to the width of this file:

> | 127 | That the generic stub can declare a limit signal; scenarios in FX-23 and FX-18 | **Refused**
> as a scenario of a family: no stub emits a quota signal in a fixture (F141-FR-043). In a
> characterization test the stub prints what its script gives it. `FX-23/wall-budget` and FX-18
> exist |

`packages/policy/test/fixtures-141.test.ts` checks every claim of this file against
`specs/141-parity-oracle/contracts/fixture-catalogue.json`, so the record cannot drift from the
catalogue that feature 141 maintains as the register of scenario names (F141-FR-030).

## 1. FX-23 exists, with the scenario `wall-budget`

From the catalogue, family `FX-23`:

| Field | Value |
| ----- | ----- |
| `id` | `FX-23` |
| `name` | Wall-clock budget |
| `status` | `active` |
| `exercises` | The stop reason `wall_budget` |
| `reference` | S, `front-door` `run` |
| `stubs` | `critic-http`, `proposer` |
| `features` | `101`, `102`, `118`, **`127`** |
| `scenarios` | one: `wall-budget`, `scenarioOf: "141"`, no waiver, not a pattern |

So the one scenario this feature's user story 4 needs exists and is owned by feature 141, not by this
feature. `specs/141-parity-oracle/tasks.md` T104 is the task that builds it ("Build the scenarios of
FX-23 (Wall-clock budget) in packages/oracle/fixtures/FX-23/: `wall-budget`; each with
`fixture.json`, the template of the working directory and the scripts of the stubs critic-http,
proposer; capture the golden captures on the reference") and it is marked done (`[x]`) in that task
list. Feature 141 also lists `127` in the family's "Features covered" column, which matches
`specs/141-parity-oracle/spec.md:115`.

## 2. FX-18 exists, with the two scenarios this feature cites

From the catalogue, family `FX-18`:

| Field | Value |
| ----- | ----- |
| `id` | `FX-18` |
| `name` | Consecutive errors |
| `status` | `active` |
| `exercises` | Pass-loop exit 7 to engine exit 4; a pass that fails before the harness starts |
| `stubs` | `critic-http`, `proposer` |
| `features` | `103`, `124`, `130`, `138` |

The two scenarios that T017 and T081 of this feature name both exist, each `scenarioOf: "141"`:

| Scenario | End on the reference | Stop reason |
| -------- | -------------------- | ----------- |
| `consecutive-errors-legacy` | pass-loop exit 7 after two passes that the idle watchdog ended | `proposer_consecutive_errors` |
| `consecutive-errors-structured` | pass-loop exit 7 after two passes without a terminal record | `proposer_consecutive_errors` |

Both carry the stop reason `proposer_consecutive_errors`, which is what T017 (`CT-127-7`) and T081
compare against: a failure of no quota class still takes the as-is path of consecutive errors
(F127-FR-005).

The family holds further scenarios that this feature does not use (`harness-missing-dsh`,
`harness-missing-prime`, `harness-missing-prime-launcher`, `unknown-harness-name`,
`prime-empty-variant`); they belong to features 124, 130 and 138.

## 3. The generic stub `stub-harness`: it exists, and it declares a limit signal only in a characterization test

`stub-harness` exists as a stub name. F141-FR-006 fixes the naming: a stub executable is named "after
the as-is command of a harness with as-is behaviour, after the as-is engine command, or
`stub-harness` for a descriptor-driven harness" (`specs/141-parity-oracle/spec.md:683`, and
`spec.md:440`).

**It can carry a limit signal, but not as a scenario of a parity family.** Feature 141 refused that
and gave the reason, in the table of refused requests at `specs/141-parity-oracle/spec.md:338`:

> | family FX-18, family FX-23 | a limit signal declared by the generic stub | 127 | No stub emits a
> quota signal in a fixture of a family (F141-FR-043): the reference has no behaviour for it. In a
> characterization test the generic stub prints what its script gives it through `text` or `stream`;
> no verb is needed |

The refusal is grounded in F141-FR-043, which states the owner decision plainly: "Quota pause: no
stub emits a quota signal." The reason is not a limitation of the stub but of parity itself — the
reference (the baseline shell implementation) has no quota-pause behaviour at all, so there is
nothing to compare a port against. This agrees with what every adapter specification records for its
own quota requirement: "parity: not observable, the stub agents emit no quota signal (row 39 of annex
X §X.7)".

What this feature therefore does, and what feature 141 endorses:

- **no verb is added** to the stub vocabulary. The two existing surfaces `text` and `stream` are
  enough: the generic stub prints whatever its script gives it, and the script of a characterization
  test gives it a limit line or a limit record.
- the limit signal reaches the classifier through the `failures` map of a **harness descriptor of the
  fixture**, which is exactly the path F127-FR-008 requires ("The classifier entries of a harness
  MUST come from its harness adapter or from the `failures` map of its harness descriptor"). T038 and
  T039 of this feature run the conformance suite of EP-12 that way.
- these runs are **characterization tests** in `packages/policy/test/`, not parity tests in
  `tests/parity/127/`. `tests/parity/127/README.md` already records the split and the reason.

## 4. The scenarios this feature adds inside those families: **none**

This is the list F141-FR-030 asks for, and it is empty.

| Family | Scenarios feature 127 adds | Why |
| ------ | -------------------------- | --- |
| FX-23 | **none** | `wall-budget` already exists and is `scenarioOf: "141"`. It is the only scenario user story 4 needs: F127-FR-026 is the whole-run wall-clock budget, and the family exercises exactly its stop reason `wall_budget` |
| FX-18 | **none** | `consecutive-errors-legacy` and `consecutive-errors-structured` already exist and are `scenarioOf: "141"`. They are the two cases F127-FR-005 needs |

Feature 127 adds no scenario to any other family either. The only scenario it ever asked for — a
limit signal declared by the generic stub, in FX-23 and FX-18 — was refused with the reason above,
and the need is met by a characterization test instead. So under F141-FR-030 this feature carries no
scenario name of the form `127-<name>`, and nothing has to be added to the catalogue on its behalf.

## 5. What this feature's tests use, and from where

| This feature's task | Uses | Owner of the fixture |
| ------------------- | ---- | -------------------- |
| T017 (`CT-127-7`), T081 | FX-18 `consecutive-errors-legacy`, `consecutive-errors-structured` | 141 |
| T077 to T080 (`PT-127-C-007`, `-C-009`, `-C-010`, `-C-012`, `-C-013`) | FX-23 `wall-budget`; FX-22 for the wait on a yield | 141 |
| T038, T039 | the generic stub `stub-harness` with a harness descriptor of the fixture that declares a limit signal, in a characterization test | 127 (the descriptor), 141 (the stub) |

The stubs both families need, `critic-http` and `proposer`, are the stubs the catalogue lists for
FX-18 and FX-23; neither family needs a stub that this feature would have to contribute.
