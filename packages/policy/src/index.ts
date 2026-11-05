// @specstride/policy: the owning features are 110 (configuration and terms),
// 127 (quota, budgets and pause) and 147 (the terms gate).
//
// Feature 127 keeps its code in two directories, created by its T002:
//   ./quota/  — the classifier, the pause, the fallback
//   ./budget/ — the ceilings, the spend ledger, the alerts
// and its data in ../data/ (the classifier table and the pattern set, T005).
export * as quota from "./quota/index.ts";
export * as budget from "./budget/index.ts";
