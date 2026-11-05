/**
 * T001 — the module group `gate` of feature 101 (plan.md, "Path Conventions"):
 * the phase gate itself, in its fixed order — verification gate, then critic,
 * then the approval record.
 *
 * | Module | Task | Requirement |
 * |---|---|---|
 * | `index.ts` | T001 | — (the entry of the group) |
 * | `writers.ts` | T012 | F101-FR-028 |
 * | `nonce.ts` | T013 | F101-FR-006 |
 * | `feedback.ts` | T014, T042 | F101-FR-012, F101-FR-019 |
 * | `events.ts` | T017 | F101-FR-038 |
 * | `lines.ts` | T018 | F101-FR-039 |
 * | `verdict-parser.ts` | T006, T011 | F101-FR-007, F101-FR-008 |
 * | `phase-gate.ts` | T039 | F101-FR-005 |
 * | `critic-call.ts` | T040 | F101-FR-009 to F101-FR-011 |
 * | `verdict-record.ts` | T042 | F101-FR-013 |
 * | `limits.ts` | T065 | F101-FR-014 to F101-FR-017 |
 * | `oscillation.ts` | T066 | F101-FR-016 |
 * | `archive.ts` | T067 | F101-FR-027 |
 * | `halts.ts` | T068 | F101-FR-037, F101-FR-014 |
 *
 * `writers.ts` is the one module of this group that writes a record of the
 * phase gate; `../approval/record.ts` is the other writer of the feature. The
 * import-boundary rule `tools/import-boundary/rules/gate-writers.json` (T005)
 * keeps every package of a loop layer away from both.
 *
 * The group holds no I/O of its own: it writes through the atomic write of the
 * kernel (F100-FR-012, F100-FR-234).
 */
export * from "./verdict-parser.ts";
export * from "./nonce.ts";
export * from "./writers.ts";
export * from "./feedback.ts";
export * as events from "./events.ts";
export * as lines from "./lines.ts";
export * from "./verdict-record.ts";
export * from "./critic-call.ts";
export * from "./phase-gate.ts";
export * from "./limits.ts";
export * from "./oscillation.ts";
export * from "./archive.ts";
export * as halts from "./halts.ts";
