/**
 * T003 — the interfaces of the two ports of the micro-loop layer (feature
 * 115): the reader that hands the checkpoint of a unit to the layer as a
 * *claim* (F115-FR-010), and the store of the tripwire record (F115-FR-041).
 *
 * The layer `@specstride/layer-micro` is a core package: it imports no
 * `node:` file-system module and starts no process (F100-FR-012). The two
 * things of feature 115 that touch the file system — reading a checkpoint
 * and the tripwire record — stand behind these ports. The implementations
 * live in the edge package `@specstride/integrity` (feature 116 creates the
 * package; feature 115 fills `src/checkpoint/` and `src/tripwire/`) and
 * write with the atomic write of `@specstride/kernel` (F100-FR-234). The
 * composition root of the engine hands the implementations to the layer.
 *
 * Interface only: this module declares no behaviour and holds no `node:`
 * import, so `@specstride/contracts` keeps the import rule of a core package.
 */

/** The schema id of a checkpoint (feature 100, annex B §B.20; owner 115). */
export const CHECKPOINT_SCHEMA_ID = "specstride.checkpoint/1";

/**
 * The checkpoint of a unit, read as a claim (F115-FR-010): what the proposer
 * says it did, never a verdict. The fields are the ones
 * `specs/115-micro-loop-layer/contracts/schemas/checkpoint.schema.json`
 * states; a reader ignores every other field of the file.
 */
export type CheckpointClaim = {
  /** `specstride.checkpoint/1` — the schema id the file carries. */
  readonly schema: string;
  /** Task ids of the current phase, or criterion indexes; at least one. */
  readonly tasks: readonly string[];
  /** Free text of the proposer; 512 bytes kept; optional. */
  readonly note?: string;
};

/** One refusal of a checkpoint file, with the reason the file was refused. */
export type CheckpointRefusal = {
  readonly reason: ClaimRefusalReason;
  /** The path the read was attempted on, where a path was given. */
  readonly path?: string;
};

/**
 * Why a checkpoint read refuses. The closed set of the refusal reasons, annex
 * X §X.6 row 138 (`packages/contracts/data/closed-sets-115.json`): a file the
 * reader refuses carries exactly one of these reasons (T041, T042; F115-FR-011).
 * The reasons of the pass itself (`pass-killed`), of a foreign task id
 * (`foreign-id`) and of a yield written in the same pass (`yield-in-pass`) are
 * facts the runtime holds, not facts of the file, so the *file* reader refuses
 * with `not-regular`, `stale`, `too-large`, `changed-while-read` and `empty`
 * only; the layer completes the closed set in
 * `@specstride/layer-micro/src/unit/validate.ts`.
 */
export type ClaimRefusalReason =
  | "pass-killed"
  | "foreign-id"
  | "yield-in-pass"
  | "not-regular"
  | "stale"
  | "too-large"
  | "changed-while-read"
  | "empty";

/**
 * The outcome of one claim read: the claim, the refusal with its reason of
 * the closed set, or the absence of a checkpoint. Absence — the pass ended
 * and wrote no checkpoint — is not a refusal: the closed set of row 138 has
 * no member for it, no `checkpoint.refused` event is raised, and the pass is
 * accounted as in the classic loop (F115-FR-011). The layer returns `none`
 * at `afterPass` for it.
 */
export type CheckpointClaimResult =
  | { readonly ok: true; readonly claim: CheckpointClaim }
  | { readonly ok: false; readonly absent: true }
  | { readonly ok: false; readonly refusal: CheckpointRefusal };

/**
 * Port: reads the checkpoint file of a unit and hands it to the layer as a
 * claim. The implementation of the edge package checks the file rules (a
 * regular file, no link, newer than the pass, at most 16 kilobytes) and the
 * schema, and refuses instead of guessing (F115-FR-010).
 */
export interface CheckpointClaimReader {
  /** Read the claim of `unitId`; never throws for a refused file. */
  readClaim(unitId: string): Promise<CheckpointClaimResult>;
}

/** One breach of the tripwire, as the invariant check of the layer reports it. */
export type TripwireBreach = {
  /** The kind of the breach, for example `outer-counter-changed` (F115-FR-039). */
  readonly kind: string;
  /** What was observed, in the words of the invariant check. */
  readonly detail: string;
  /** The id of the integrity rule that found the breach (F115-FR-041, IR-28). */
  readonly ruleId?: string;
  /** When the breach was observed (ISO 8601). */
  readonly observedAt: string;
};

/** The state the tripwire record holds (feature 100, annex B §B.18). */
export type TripwireState = {
  /** True when a breach stands and the layer stays off until it is cleared. */
  readonly breached: boolean;
  /** The breaches the record holds, oldest first; empty when not breached. */
  readonly breaches: readonly TripwireBreach[];
};

/**
 * Port: the tripwire record `user:tripwire`, read and written by the
 * runtime, never by the layer itself (F115-FR-041). The implementation of
 * the edge package writes with the atomic write of the kernel, so a crash
 * leaves either the old record or the new one, never a half record.
 */
export interface TripwireStore {
  /** The state of the record; an absent record reads as not breached. */
  read(): Promise<TripwireState>;
  /** Append one breach and mark the record breached. */
  recordBreach(breach: TripwireBreach): Promise<void>;
  /** Remove the breaches and mark the record not breached (`tripwire clear`). */
  clear(): Promise<void>;
}
