/**
 * T042 — validation and refusal of a checkpoint (F115-FR-009, F115-FR-011).
 *
 * A checkpoint is a claim (F115-FR-010): the runtime reads from it the task
 * ids and a note of bounded length and ignores every other field, then
 * validates the claim against the task list as read at launch
 * (`run:<runId>:task-list`, F115-FR-012). A refused checkpoint carries
 * exactly one reason of the closed set of checkpoint refusals (annex X §X.6
 * row 138); the closed set is the union declared on the port
 * `ClaimRefusalReason` of `@specstride/contracts/src/ports/layer-micro.ts`.
 *
 * A refused checkpoint changes no counter of the layer and the pass is
 * accounted as in the classic loop (F115-FR-011); this module returns the
 * reason and nothing else — it holds no counter and writes no record.
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */
import {
  CHECKPOINT_SCHEMA_ID,
  type CheckpointClaim,
  type ClaimRefusalReason,
} from "@specstride/contracts";

/** At most 512 bytes of the note are kept (F115-FR-010). */
export const NOTE_MAX_BYTES = 512;

/**
 * The closed set of the refusal reasons of a checkpoint (annex X §X.6 row
 * 138), in the order F115-FR-011 names them. Unknown value: the checkpoint
 * is refused.
 */
export const CHECKPOINT_REFUSAL_REASONS = [
  "pass-killed",
  "foreign-id",
  "yield-in-pass",
  "not-regular",
  "stale",
  "too-large",
  "changed-while-read",
  "empty",
] as const satisfies readonly ClaimRefusalReason[];

/** True for a member of the closed set; the unknown-value rule refuses. */
export function isRefusalReason(value: string): value is ClaimRefusalReason {
  return (CHECKPOINT_REFUSAL_REASONS as readonly string[]).includes(value);
}

/** The facts of the pass and of the launch reading the validation needs. */
export type ValidationContext = {
  /** The task ids of the phase, in order, from `run:<runId>:task-list`. */
  readonly phaseTaskIds: readonly string[];
  /** True when the pass was killed (F115-FR-011). */
  readonly passKilled?: boolean;
  /** True when a yield artifact was written in the same pass. */
  readonly yieldInPass?: boolean;
};

/** One validated checkpoint: the ids and the bounded note, nothing else. */
export type ValidatedCheckpoint = {
  readonly ok: true;
  /** The task ids the claim names, in the order of the claim. */
  readonly tasks: readonly string[];
  /** The note, cut to at most 512 bytes; absent when the claim had none. */
  readonly note?: string;
};

/** One refusal, with exactly one reason of the closed set. */
export type RefusedCheckpoint = {
  readonly ok: false;
  readonly reason: ClaimRefusalReason;
};

/** The result of a validation: the validated ids and note, or the refusal. */
export type ValidationResult = ValidatedCheckpoint | RefusedCheckpoint;

/** The bytes of a UTF-8 string. */
function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Cut the note to at most 512 bytes without splitting a code point. */
export function boundedNote(note: string): string {
  if (byteLength(note) <= NOTE_MAX_BYTES) return note;
  let cut = note;
  while (cut.length > 0 && byteLength(cut) > NOTE_MAX_BYTES) {
    cut = cut.slice(0, -1);
  }
  return cut;
}

/**
 * The refusal the *claim* itself earns, before the facts of the pass are
 * consulted. A claim that is not an object, carries a schema id other than
 * `specstride.checkpoint/1`, or holds no task id at all, holds no usable
 * declaration of a unit of work; the closed set has no schema-id reason, so
 * it refuses as `empty` (the checkpoint holds no id — F115-FR-011).
 */
export function refusalOfClaim(claim: CheckpointClaim): ClaimRefusalReason | undefined {
  if (claim.schema !== CHECKPOINT_SCHEMA_ID) return "empty";
  if (!Array.isArray(claim.tasks) || claim.tasks.length === 0) return "empty";
  if (claim.tasks.some((id) => typeof id !== "string" || id.length === 0)) return "empty";
  return undefined;
}

/**
 * F115-FR-009, F115-FR-011 — validate one checkpoint claim. Every id the
 * claim names MUST be a task of the current phase in the reading at launch;
 * a task an earlier unit named is accepted (F115-FR-022). Every other field
 * of the claim is already ignored by the reader; only the ids and the
 * bounded note survive.
 */
export function validateCheckpoint(
  claim: CheckpointClaim,
  context: ValidationContext,
): ValidationResult {
  if (context.passKilled === true) return { ok: false, reason: "pass-killed" };
  if (context.yieldInPass === true) return { ok: false, reason: "yield-in-pass" };
  const claimRefusal = refusalOfClaim(claim);
  if (claimRefusal !== undefined) return { ok: false, reason: claimRefusal };
  const known = new Set(context.phaseTaskIds);
  for (const id of claim.tasks) {
    if (!known.has(id)) return { ok: false, reason: "foreign-id" };
  }
  return {
    ok: true,
    tasks: [...claim.tasks],
    ...(claim.note === undefined ? {} : { note: boundedNote(claim.note) }),
  };
}
