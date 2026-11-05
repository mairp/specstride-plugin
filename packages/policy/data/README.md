# `packages/policy/data/` — the data files of feature 127

Created by T002 of `specs/127-quota-budgets-and-pause/tasks.md`. The directory holds the versioned
data the classifier of EP-12 is evaluated from; no code of this package reads a file of its own, so
the data is loaded through the table loader of `@specstride/kernel` and validated at load.

| File | Source | Content | Task | Requirement |
| ---- | ------ | ------- | ---- | ----------- |
| `classifier.table.json` | `specs/127-quota-budgets-and-pause/contracts/classifier.table.json` | the default classifier as a table of the evaluator of feature 100 (annex X §X.3) | T005 | F127-FR-003 |
| `text-patterns.json` | `specs/127-quota-budgets-and-pause/contracts/text-patterns.json` | the pattern groups of the default text classifier | T005 | F127-FR-003 |

Both files are empty of a verified provider fact until a harness adapter feature captures one:
`packages/policy/test/captures.md` (T001) lists, row by row, which classifier rows stay
`unverified` and which capture closes each.

The specification stands where a file here and `spec.md` differ
(`specs/127-quota-budgets-and-pause/contracts/README.md`).
