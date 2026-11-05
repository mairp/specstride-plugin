/**
 * `src/evals/` — what the evals of this host hold without a model call:
 *
 *  - `./log.ts` — the log record of a paid task and the reader of the log
 *    (F113-FR-038, F113-FR-039); the refusal of a run whose configuration
 *    names no model, before any call;
 *  - `./release-check.ts` — the release check of the trigger suite, which
 *    reads the log and calls no model (F113-FR-038);
 *  - `./paid-tasks.ts` — the verification record of the paid tasks
 *    (T029, T037; F113-FR-040, F113-FR-038): the paid part is never run in
 *    this lane;
 *  - `./static-check.ts` — the static check of the suite files and of the
 *    build configuration (T033, F113-FR-041 (a) and its last sentence);
 *  - `./eval-driver.ts` — `evalDriver.run`, as the build runs it: one result
 *    per case, on a stub (F113-FR-041 (b));
 *  - `./stub-runner.ts` — the stub of the host's suite runner, with recorded
 *    results, among them an interrupted run and a usage-limit run (T033);
 *  - `./suite-file.ts` — the types of the suite files the check reads.
 *
 * T033 of `specs/113-host-claude-code/tasks.md` (phase 9) added the static
 * check and the stub; T035 is the release check and the log writer above.
 */
export * from "./log.ts";
export * from "./release-check.ts";
export * from "./paid-tasks.ts";
export * from "./static-check.ts";
export * from "./eval-driver.ts";
export * from "./stub-runner.ts";
export * from "./suite-file.ts";
