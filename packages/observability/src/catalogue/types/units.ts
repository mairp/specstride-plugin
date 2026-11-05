/**
 * T025 — the `data` schemas of the types of F111-FR-010: the units of work.
 *
 * *The units of work of a run MUST be told by events. `attempt.started` MUST
 * carry the kind of the phase attempt (`plain`, `diagnosed`, `accelerated`,
 * `bumped`) and the strategy; `attempt.ended` MUST carry `endCause`, a member
 * of the closed set "End causes of a phase attempt" (annex X §X.6 row 272),
 * and `workProducts`, each with path, hash, whether kept, and where carried.
 * `phase.ended` MUST carry `outcome`, a member of the closed set "Outcomes of
 * a phase" (row 273). `task.planned` and `task.ticked` MUST be written per
 * task with planned and elapsed time where known. `run.launched` MUST carry
 * the reason of its launch (`first`, `resume`, `relaunch`, `manual`), the
 * counts carried and whether they were reset. `counters.reset` MUST be written
 * when `--reset-counts` is used.*
 *
 * A WORK PRODUCT HAS FOUR FIELDS, AND `carriedInto` MAY BE NULL. "Where
 * carried" is a fact that often does not exist yet when the attempt ends, so
 * the field is required and nullable rather than optional: a reader can then
 * tell "not carried anywhere" from "nobody filled this in".
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { refine, COUNT_OR_NULL, FLAG, TEXT, type TypeRefinement } from "./refinement.ts";

/** The kinds of a phase attempt: annex X §X.6 row 9. */
export const ATTEMPT_KINDS: readonly string[] = Object.freeze([...(closedSet(9)?.members ?? [])]);

/** The loop strategies: annex X §X.6 row 55. */
export const STRATEGIES: readonly string[] = Object.freeze([...(closedSet(55)?.members ?? [])]);

/** The end causes of a phase attempt: annex X §X.6 row 272. */
export const ATTEMPT_END_CAUSES: readonly string[] = Object.freeze([
  ...(closedSet(272)?.members ?? []),
]);

/** The outcomes of a phase: annex X §X.6 row 273. */
export const PHASE_OUTCOMES: readonly string[] = Object.freeze([
  ...(closedSet(273)?.members ?? []),
]);

/** The reasons of a launch: annex X §X.6 row 82. */
export const LAUNCH_REASONS: readonly string[] = Object.freeze([...(closedSet(82)?.members ?? [])]);

/** What one work product records (F111-FR-010). */
export const WORK_PRODUCT_FIELDS = ["path", "hash", "kept", "carriedInto"] as const;

/** The shape of one work product. */
export const WORK_PRODUCT = Object.freeze({
  required: Object.freeze([...WORK_PRODUCT_FIELDS]),
  additional: false,
});

/** The refinements of F111-FR-010. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-010",
    type: "attempt.started",
    required: ["kind", "strategy"],
    fields: { kind: { enum: ATTEMPT_KINDS }, strategy: { enum: STRATEGIES } },
  }),
  refine({
    requirement: "F111-FR-010",
    type: "attempt.ended",
    required: ["endCause", "workProducts"],
    fields: {
      endCause: { enum: ATTEMPT_END_CAUSES },
      workProducts: {
        type: ["array"],
        items: WORK_PRODUCT,
        note: "each with path, hash, whether kept, and where carried",
      },
    },
  }),
  refine({
    requirement: "F111-FR-010",
    type: "phase.ended",
    required: ["outcome"],
    fields: { outcome: { enum: PHASE_OUTCOMES } },
  }),
  refine({
    requirement: "F111-FR-010",
    type: "task.planned",
    required: ["taskId"],
    fields: { taskId: TEXT, estimateMs: COUNT_OR_NULL },
    note: "the planned time where the plan has one, else null",
  }),
  refine({
    requirement: "F111-FR-010",
    type: "task.ticked",
    required: ["taskId", "elapsedMs"],
    fields: { taskId: TEXT, elapsedMs: COUNT_OR_NULL },
  }),
  refine({
    requirement: "F111-FR-010",
    type: "run.launched",
    required: ["reason", "countsCarried", "countsReset"],
    fields: { reason: { enum: LAUNCH_REASONS }, countsCarried: FLAG, countsReset: FLAG },
  }),
  refine({
    requirement: "F111-FR-010",
    type: "counters.reset",
    required: ["which"],
    fields: { which: TEXT },
    note: "written when `--reset-counts` is used",
  }),
]);
