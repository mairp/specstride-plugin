/**
 * T001 of feature 103 — the module group `pass-loop` of `@specstride/core`
 * (`specs/103-proposer-pass/plan.md`, "Source Code (repository root)").
 *
 * The pass loop of one phase attempt. It is a CALL, not a command
 * (F100-FR-171): the engine calls it with a request record and receives a
 * result record, and no process and no file boundary lies between them. The
 * request and the result schemas therefore live with this module, in
 * `request.schema.json` and `result.schema.json` of this directory (T003), and
 * not in `@specstride/contracts`.
 *
 * The files `plan.md` assigns to this directory are listed in `FILES` below;
 * the phases after Setup write them.
 *
 * Boundary: every file of this directory may import `@specstride/contracts`
 * and `@specstride/kernel` and nothing else from the product (F100-FR-012),
 * and may not import a writer of the phase gate (F103-FR-028, the rule
 * `core-modules-103` of `tools/import-boundary/rules/`).
 */
import { CALL_POINTS } from "@specstride/contracts/ep/loop-layer";

/** The directory this module group occupies, relative to the repository root. */
export const DIRECTORY = "packages/core/src/pass-loop" as const;

/** The feature that owns the module group. */
export const OWNER = "103" as const;

/** The files `plan.md` assigns to the directory, in the order it lists them. */
export const FILES = [
  "request.ts",
  "loop.ts",
  "accounting.ts",
  "progress.ts",
  "result-map.ts",
  "source-check.ts",
  "empty-prompt.ts",
  "announce.ts",
  "invocation-id.ts",
] as const;

/**
 * The files of this directory that `plan.md` does NOT list, each with the
 * task that added it and why. They are kept apart from `FILES` so that the
 * list above stays a faithful reading of the plan.
 */
export const FILES_ADDED_AFTER_THE_PLAN: Readonly<Record<string, string>> = Object.freeze({
  "task-events.ts":
    "T086 (F103-FR-044) — the two task events of the catalogue of feature 111 " +
    "and the READ port of the task list the loop compares before and after a pass. " +
    "F103-FR-044 was added to the specification by W-X-24 after `plan.md` was written.",
});

/** The two schema files of the module group (T003); internal, no boundary. */
export const SCHEMA_FILES = [
  "pass-loop-request.schema.json",
  "pass-loop-result.schema.json",
] as const;

/**
 * The call points of the loop-layer interface the loop drives, read from
 * `@specstride/contracts` so that the loop never holds its own copy of the
 * table of annex D §D.1.
 */
export const LAYER_CALL_POINTS = CALL_POINTS;
