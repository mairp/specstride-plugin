/**
 * The learning package (owners: 106) — the across-runs layer.
 *
 * Phase 2 modules:
 *  - `knobs.ts`        — the allowlist, the hard bounds and the step cap (T005)
 *  - `events-reader.ts` — the lenient readers and the run-id attribution (T006)
 *  - `decision-log.ts` — the byte format, the append, the replay, the bound, the shape keying (T007)
 *  - `stream.ts`       — the learning writer domain and its lock (T008)
 *  - `stats.ts`        — percentile, the exact binomial tail, the exact rank test (T009)
 *  - `metrics.ts`      — the summary and the metric definitions (T011)
 *  - `mode.ts`         — the mode, its bound and their aliases (T041)
 *
 * Phase 3 modules (User Story 1, read-only):
 *  - `lines.ts`        — the message texts of the command (T025)
 *  - `suggest.ts`      — the two suggestion engines and the advice (T023)
 *  - `observation.ts`  — the observation document of an approved phase (T024)
 *  - `resolve.ts`      — the value and the arm of one knob for one phase (T027)
 *  - `verb.ts`         — the command `learn`: input selection and handlers (T026)
 *
 * Phase 5 module (User Story 3, the launch contract):
 *  - `binding.ts`      — the binding of the decision log into `configuration.learning` (T048/T049/T051)
 */
export * from "./knobs.ts";
export * from "./events-reader.ts";
export * from "./decision-log.ts";
export * from "./stream.ts";
export * from "./stats.ts";
export * from "./metrics.ts";
export * from "./metrics-support.ts";
export * from "./mode.ts";
export * from "./lines.ts";
export * from "./suggest.ts";
export * from "./observation.ts";
export * from "./resolve.ts";
export * from "./verb.ts";
export * from "./apply.ts";
export * from "./revert.ts";
export * from "./off.ts";
export * from "./binding.ts";
export * from "./evaluate.ts";
export * from "./guardrails.ts";
export * from "./quarantine.ts";
export * from "./selector.ts";
export * from "./retro.ts";
export * from "./hooks.ts";
export * from "./tamper.ts";
export * from "./ingress.ts";
