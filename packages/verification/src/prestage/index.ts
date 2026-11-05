/**
 * The commands staged before a phase attempt, the detached ones included,
 * their reuse rules and their build artifacts (`plan.md`, "Project
 * Structure"; F105-FR-033 to F105-FR-036).
 *
 * Phase 1 created the folder of `plan.md`; phase 3 filled the one part of it
 * that F105-FR-054 names — the path of the output of a staged command through
 * the one ingress (T147). PHASE 6 fills the rest:
 *
 *  - `./commands.ts` — which commands are staged, and the names and places of
 *    their record (T128, F105-FR-034);
 *  - `./reuse.ts` — THE REUSE RULES: the search over the records of the run,
 *    the most recent first, and no result taken over when the engine reports a
 *    loop layer engaged in the phase attempt (T127, F105-FR-033);
 *  - `./step.ts` — the step itself, its two printed lines, its result code,
 *    the log line and the event `prestage_done` (T128, F105-FR-034);
 *  - `./detached.ts` — detached staged commands, started by the process
 *    primitive of `@specstride/kernel` (T129, F105-FR-035);
 *  - `./report.ts` — the block of `prestage-report`, which the phase context
 *    of T101 ends with where a record exists (T128, F105-FR-039, F105-FR-025);
 *  - `./artifacts.ts` — the build artifacts record (T130, F105-FR-036).
 */
export * from "./ingress.ts";
export * from "./commands.ts";
export * from "./reuse.ts";
export * from "./step.ts";
export * from "./detached.ts";
export * from "./report.ts";
export * from "./artifacts.ts";
