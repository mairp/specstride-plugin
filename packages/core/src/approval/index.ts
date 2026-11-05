/**
 * T001 — the module group `approval` of feature 101 (plan.md, "Path
 * Conventions"): the signed approval record, its key and its verification.
 *
 * | Module | Task | Requirement |
 * |---|---|---|
 * | `index.ts` | T001 | — (the entry of the group) |
 * | `record.ts` | T006, T043 | F101-FR-029 (the gate store of Lisa, rewritten) |
 * | `key.ts` | T043 | F101-FR-030 |
 * | `verify.ts` | T074 | F101-FR-031 |
 * | `ticked-without-record.ts` | T076 | F101-FR-032 |
 *
 * `record.ts` is a writer of records of the phase gate, beside
 * `../gate/writers.ts`; the import-boundary rule
 * `tools/import-boundary/rules/gate-writers.json` (T005) keeps every package
 * of a loop layer away from both.
 *
 * The group holds no I/O of its own (F100-FR-012, F100-FR-234).
 */
export * from "./gate-tree.ts";
export * from "./record.ts";
export * from "./key.ts";
export * from "./verify.ts";
export * from "./ticked-without-record.ts";
