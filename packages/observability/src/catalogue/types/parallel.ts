/**
 * T025 — the `data` schemas of the types of F111-FR-015: the parallel units.
 *
 * *The seven types `parallel.plan`, `parallel.admission`,
 * `parallel.group.started`, `parallel.group.ended`, `parallel.worker.started`,
 * `parallel.worker.ended` and `parallel.integration` MUST be defined here.
 * They are events of the main line about a group or a worker: the engine
 * writes them on the main line, so they MUST carry `groupId` and `workerId` in
 * `data` only, and the envelope fields `workerId` and `wseq` MUST be absent on
 * them, as on every event of the main line. This holds for
 * `parallel.worker.started` and `parallel.worker.ended` as well ... "Every
 * event of a worker" (annex X §X.1) is an event that was produced inside the
 * stream of one worker ... it is none of the seven, and it MUST carry the
 * envelope fields `workerId` and `wseq`. `parallel.admission` MUST carry
 * `taskId`, the check and its result, one event for each check of each task;
 * `parallel.integration` MUST carry `step` and `pathCount`, a count of paths
 * and never a path. They MUST project to nothing. A reader that does not know
 * them MUST ignore them.*
 *
 * THE SAME NAME IN TWO PLACES MEANS TWO THINGS. `workerId` in `data` says
 * "this event is ABOUT that worker"; `workerId` in the envelope says "this
 * event CAME FROM that worker". `parallel.worker.ended` is written by the
 * engine about a worker that has finished, so it takes the first and not the
 * second. `parallelEnvelopeFindings` is that distinction as a check, because
 * it is exactly the kind of thing a writer gets right once and wrong later.
 *
 * `pathCount` IS A COUNT. A count of paths tells a reader how wide the
 * integration was; a list of paths would put the shape of the workspace into
 * a stream that is kept and shipped. The schema admits a whole number and
 * nothing else.
 */
import { closedSet } from "@specstride/contracts/enums/all-sets";
import { WORKER_FIELDS } from "@specstride/contracts/envelope/event";
import { refine, COUNT, TEXT, TEXT_OR_NULL, type TypeRefinement } from "./refinement.ts";

/** The seven types of F111-FR-015, in the order the requirement names them. */
export const PARALLEL_TYPES = [
  "parallel.plan",
  "parallel.admission",
  "parallel.group.started",
  "parallel.group.ended",
  "parallel.worker.started",
  "parallel.worker.ended",
  "parallel.integration",
] as const;
export type ParallelType = (typeof PARALLEL_TYPES)[number];

/** F111-FR-015: they project to nothing. */
export const PARALLEL_TYPES_PROJECT_TO = null;

/** A reader that does not know them ignores them (F100-FR-199). */
export const A_READER_THAT_DOES_NOT_KNOW_THEM_IGNORES_THEM = true as const;

/** The admission checks of a parallel group: annex X §X.6 row 61. */
export const ADMISSION_CHECKS: readonly string[] = Object.freeze([
  ...(closedSet(61)?.members ?? []),
]);

/** The outcomes of a group and of a worker: annex X §X.6 row 62. */
export const WORKER_OUTCOMES: readonly string[] = Object.freeze([
  ...(closedSet(62)?.members ?? []),
]);

/** True where the type is one of the seven. */
export function isParallelType(type: string): boolean {
  return (PARALLEL_TYPES as readonly string[]).includes(type);
}

/**
 * The findings of one event against the main-line rule of F111-FR-015. One of
 * the seven carries no `workerId` and no `wseq` in its ENVELOPE, however much
 * it is about a worker; an event produced inside a worker's stream is none of
 * the seven and carries both.
 */
export function parallelEnvelopeFindings(
  event: Readonly<Record<string, unknown>>,
): readonly string[] {
  const type = typeof event.type === "string" ? event.type : "";
  if (!isParallelType(type)) return Object.freeze([]);
  const findings: string[] = [];
  for (const field of WORKER_FIELDS) {
    if (Object.hasOwn(event, field)) {
      findings.push(
        `${type} is an event of the main line about a group or a worker: the envelope field ` +
          `\`${field}\` is absent on it, and the worker is named in \`data\``,
      );
    }
  }
  return Object.freeze(findings);
}

/** The refinements of F111-FR-015. */
export const REFINEMENTS: readonly TypeRefinement[] = Object.freeze([
  refine({
    requirement: "F111-FR-015",
    type: "parallel.plan",
    required: ["groupId"],
    fields: { groupId: TEXT, hash: TEXT_OR_NULL },
  }),
  refine({
    requirement: "F111-FR-015",
    type: "parallel.admission",
    required: ["groupId", "taskId", "check", "result"],
    fields: {
      groupId: TEXT,
      taskId: TEXT,
      check: { enum: ADMISSION_CHECKS },
      result: TEXT,
    },
    note: "one event for each check of each task",
  }),
  refine({
    requirement: "F111-FR-015",
    type: "parallel.group.started",
    required: ["groupId"],
    fields: { groupId: TEXT },
  }),
  refine({
    requirement: "F111-FR-015",
    type: "parallel.group.ended",
    required: ["groupId", "outcome"],
    fields: { groupId: TEXT, outcome: { enum: WORKER_OUTCOMES } },
  }),
  refine({
    requirement: "F111-FR-015",
    type: "parallel.worker.started",
    required: ["groupId", "workerId"],
    fields: { groupId: TEXT, workerId: TEXT },
    note: "the engine writes it ON THE MAIN LINE about a worker; the worker is named in `data`",
  }),
  refine({
    requirement: "F111-FR-015",
    type: "parallel.worker.ended",
    required: ["groupId", "workerId", "outcome"],
    fields: { groupId: TEXT, workerId: TEXT, outcome: { enum: WORKER_OUTCOMES } },
  }),
  refine({
    requirement: "F111-FR-015",
    type: "parallel.integration",
    required: ["groupId", "step", "pathCount"],
    fields: {
      groupId: TEXT,
      step: TEXT,
      pathCount: COUNT,
    },
    note: "`pathCount` is a count of paths and never a path",
  }),
]);
