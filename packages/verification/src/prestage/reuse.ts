/**
 * T127 — THE REUSE RULES (F105-FR-033, items B-1128, B-1129, B-1130, B-1045).
 *
 * The verification gate reuses NOTHING BUT results of commands staged before,
 * and it FAILS CLOSED on every question it cannot answer. This is the only
 * place in the whole feature that can make a verification gate accept a result
 * it did not observe, so every refusal below is written out, and each one is a
 * named predicate a test can run on its own:
 *
 *  - only a command of the stage `prestage` offers its result — `both` means
 *    what it says: the command is staged for the proposer's benefit AND the
 *    verification gate still executes it (`REFUSED_FOR_STAGE_BOTH`);
 *  - the record must have PASSED and be COMPLETED;
 *  - the plan hash must be the same;
 *  - the revision must be the same, and the working tree must be CLEAN in the
 *    record AND at the verification gate — an unavailable revision, a revision
 *    that moved, and a tree that is dirty or not known each refuse;
 *  - `per-attempt` needs the same phase AND the same phase attempt,
 *    `per-phase` the same phase, `per-run` neither;
 *  - THE NUMBER OF THE PHASE ATTEMPT DEFAULTS TO THE ONE IN THE NAME OF THE
 *    RESULT RECORD (B-1045, `attemptFromPath` of `./commands.ts`), and where it
 *    is unknown, reuse per phase attempt is REFUSED;
 *  - NO RESULT OF AN INNER CHECK is ever accepted in place of an execution;
 *  - IN A PHASE ATTEMPT IN WHICH A LOOP LAYER IS ENGAGED nothing at all is
 *    taken over and every selected command is executed (divergence DV-012,
 *    F100-FR-232). THE ENGINE HANDS THAT FACT IN; this feature reads no record
 *    of a loop layer (`READS_A_RECORD_OF_A_LOOP_LAYER`).
 *
 * THE SEARCH is over the records of commands staged before of EVERY PHASE
 * ATTEMPT OF THE RUN that carry the same plan hash, THE MOST RECENT PHASE AND
 * PHASE ATTEMPT FIRST (`mostRecentFirst`). The records arrive as a list the
 * caller read; this module does the ranking and the rules, so the order is
 * provable without a file system.
 *
 * `lib/verification_plan.py` `_prestage_reuse` (:2296) and
 * `_prestage_documents` (:2270) are the baseline.
 */
import type { SourceRevision } from "../plan/record.ts";
import {
  attemptFromPath,
  PRESTAGE_KIND,
  reusePolicyOf,
  STAGE_THAT_IS_STILL_EXECUTED,
  STAGE_THAT_OFFERS_ITS_RESULT,
  stageOf,
} from "./commands.ts";

/** The record of staged commands, as the reuse rules read it. */
export type PrestageDocumentForReuse = {
  readonly kind?: string | undefined;
  readonly planId?: string | undefined;
  readonly planHash?: string | undefined;
  readonly phase?: number | undefined;
  readonly attempt?: number | undefined;
  readonly sourceRevision?: SourceRevision | undefined;
  readonly startedAtEpoch?: number | undefined;
  readonly commands?: readonly Readonly<Record<string, unknown>>[] | undefined;
  readonly passed?: boolean | undefined;
  readonly summary?: string | undefined;
};

/** One record of staged commands with the place it was read from. */
export type FoundDocument = {
  readonly path: string;
  readonly document: PrestageDocumentForReuse;
};

/* ------------------------------------------------------------------ *
 * The facts of F105-FR-033, as values.
 * ------------------------------------------------------------------ */

/** The verification gate reuses NOTHING BUT results of staged commands. */
export const REUSES_NOTHING_BUT = "results of commands staged before" as const;

/** The stage whose result may be taken over: `prestage`, and only it. */
export const STAGE_THAT_MAY_BE_REUSED: typeof STAGE_THAT_OFFERS_ITS_RESULT =
  STAGE_THAT_OFFERS_ITS_RESULT;

/** `both` is staged AND still executed, so its result is refused here. */
export const REFUSED_FOR_STAGE_BOTH = true as const;

/** No result of an inner check is ever accepted (F105-FR-033). */
export const AN_INNER_CHECK_RESULT_IS_ACCEPTED = false as const;

/** With a loop layer engaged the verification gate takes over NO result. */
export const WITH_A_LOOP_LAYER_ENGAGED_NOTHING_IS_REUSED = true as const;

/** With a loop layer engaged every selected command is EXECUTED (F100-FR-232). */
export const WITH_A_LOOP_LAYER_ENGAGED_EVERY_COMMAND_IS_EXECUTED = true as const;

/** A loop layer is engaged when a unit of work was declared (F100-FR-118). */
export const A_LOOP_LAYER_IS_ENGAGED_WHEN = "a unit of work was declared" as const;

/** The engine hands that fact in; this feature reads no record of a layer. */
export const THE_FACT_IS_HANDED_IN_BY = "the engine" as const;
export const READS_A_RECORD_OF_A_LOOP_LAYER = false as const;

/** The divergence the rule is recorded as (`spec.md`, DV-012). */
export const DIVERGENCE = "DV-012" as const;

/** The fields of `reusedFrom`, in the order F105-FR-033 names them. */
export const REUSED_FROM_FIELDS = [
  "evidencePath",
  "stage",
  "phase",
  "attempt",
  "planHash",
  "revision",
  "reusePolicy",
  "ranAtEpoch",
  "durationMs",
] as const;
export type ReusedFromField = (typeof REUSED_FROM_FIELDS)[number];

/** The two fields a taken-over entry carries beside the as-is ones. */
export const REUSE_FIELDS_OF_AN_ENTRY = ["reused", "reusedFrom"] as const;

/* ------------------------------------------------------------------ *
 * The search: the records of the run, the most recent first.
 * ------------------------------------------------------------------ */

/** A record of staged commands is of this kind and of no other. */
export function isPrestageDocument(document: PrestageDocumentForReuse): boolean {
  return document.kind === PRESTAGE_KIND;
}

/**
 * The records of commands staged before OF THE RUN that may be searched: of
 * the kind `specstride-prestage-evidence` and of the same plan hash, optionally
 * narrowed to one phase, THE MOST RECENT PHASE AND PHASE ATTEMPT FIRST
 * (F105-FR-033, `_prestage_documents`).
 *
 * The phase attempt of a record DEFAULTS TO THE ONE IN ITS NAME (B-1045), so a
 * record whose field is absent still ranks and still answers a per-attempt
 * policy where its name says which attempt it is.
 */
export function mostRecentFirst(input: {
  readonly found: readonly FoundDocument[];
  readonly planHash?: string | undefined;
  readonly phase?: number | undefined;
}): readonly FoundDocument[] {
  const kept = input.found.filter((one) => {
    if (!isPrestageDocument(one.document)) return false;
    if (input.planHash !== undefined && one.document.planHash !== input.planHash) return false;
    if (input.phase !== undefined && one.document.phase !== input.phase) return false;
    return true;
  });
  // The baseline sorts the names first and then ranks by phase, attempt and
  // start, descending; a stable sort over a name-sorted list is the same order.
  const byName = [...kept].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return Object.freeze(
    byName.sort((left, right) => {
      const key = (one: FoundDocument): readonly number[] => [
        one.document.phase ?? 0,
        attemptOf(one) ?? 0,
        one.document.startedAtEpoch ?? 0,
      ];
      const a = key(left);
      const b = key(right);
      for (let index = 0; index < a.length; index += 1) {
        const difference = (b[index] as number) - (a[index] as number);
        if (difference !== 0) return difference;
      }
      return 0;
    }),
  );
}

/**
 * The phase attempt of a record: its field, or THE ONE IN THE NAME OF THE
 * RESULT RECORD where the field is absent (F105-FR-033, B-1045).
 */
export function attemptOf(found: FoundDocument): number | undefined {
  return found.document.attempt ?? attemptFromPath(found.path);
}

/* ------------------------------------------------------------------ *
 * The rules themselves.
 * ------------------------------------------------------------------ */

/** Why a result was not taken over. Every branch of the rules has a reason. */
export const REFUSAL_REASONS = [
  "a loop layer is engaged in the phase attempt",
  "no directory of records of staged commands",
  "the revision is not available",
  "the working tree is not clean at the verification gate",
  "no record of staged commands carries this plan hash",
  "the stage is not `prestage`",
  "the revision of the record is another one",
  "the working tree was not clean in the record",
  "the phase of the record is another one",
  "the phase attempt of the record is another one",
  "the phase attempt is unknown",
  "the record holds no result of this command",
  "the result did not pass",
  "the result is not completed",
  "the result is of an inner check",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** What a look-up for one command gave: a result, or a reason it gave none. */
export type ReuseOutcome =
  | { readonly reused: true; readonly entry: ReusedEntry }
  | { readonly reused: false; readonly reason: RefusalReason };

/** `reusedFrom` of a taken-over result (F105-FR-033). */
export type ReusedFrom = {
  readonly evidencePath: string;
  readonly stage: string;
  readonly phase: number | undefined;
  readonly attempt: number | undefined;
  readonly planHash: string | undefined;
  readonly revision: string;
  readonly workingTreeDirty: false;
  readonly reusePolicy: string;
  readonly ranAtEpoch: number | undefined;
  readonly durationMs: number | undefined;
};

/** A taken-over result: the record's own entry plus the two reuse fields. */
export type ReusedEntry = Readonly<Record<string, unknown>> & {
  readonly reused: true;
  readonly reusedFrom: ReusedFrom;
};

/** What the reuse rules are given. */
export type ReuseInput = {
  readonly planHash: string;
  /** The phase of the gate; `undefined` for a release gate, which has none. */
  readonly gatePhase: number | undefined;
  /** The revision at the VERIFICATION GATE (F105-FR-033). */
  readonly sourceRevision: SourceRevision | undefined;
  /**
   * The phase attempt the verification gate runs in. `undefined` means
   * unknown, and reuse per phase attempt is then REFUSED (B-1045).
   */
  readonly attempt: number | undefined;
  /** The records of staged commands of the run the caller read. */
  readonly found: readonly FoundDocument[];
  /**
   * THE ENGINE'S FACT: a loop layer is engaged in this phase attempt, that is,
   * a unit of work was declared (F100-FR-118). True takes over NOTHING.
   */
  readonly loopLayerEngaged: boolean;
};

/**
 * What the rules read of a command: its id and its two staging fields. It is
 * the WIDEST shape, so the verification gate's own `PlannedCommand` and the
 * plan's `PlanCommand` both satisfy it and neither caller needs a cast.
 */
export type ReusableCommand = {
  readonly id: string;
  readonly stage?: string | undefined;
  readonly reusePolicy?: string | undefined;
};

/** The look-up the verification gate calls once per selected command. */
export type ReuseLookup = (command: ReusableCommand) => ReuseOutcome;

/**
 * THE REUSE RULES (F105-FR-033). The result is a look-up over one command, or
 * `undefined` where nothing at all may be taken over in this phase attempt —
 * which is what the verification gate needs in order to execute every command
 * it selected without asking per command.
 */
export function prestageReuse(input: ReuseInput): ReuseLookup {
  const refuseAll = (reason: RefusalReason): ReuseLookup => {
    return () => Object.freeze({ reused: false as const, reason });
  };
  // A LOOP LAYER ENGAGED IN THE PHASE ATTEMPT TAKES OVER NOTHING (DV-012).
  if (input.loopLayerEngaged) return refuseAll("a loop layer is engaged in the phase attempt");
  if (input.found.length === 0) return refuseAll("no directory of records of staged commands");
  const revision = input.sourceRevision;
  if (revision === undefined || !revision.available || revision.revision === "") {
    return refuseAll("the revision is not available");
  }
  if (revision.workingTreeDirty !== false) {
    return refuseAll("the working tree is not clean at the verification gate");
  }
  const documents = mostRecentFirst({ found: input.found, planHash: input.planHash });
  if (documents.length === 0) {
    return refuseAll("no record of staged commands carries this plan hash");
  }
  const head = revision.revision;
  return (command: ReusableCommand): ReuseOutcome => {
    // `both` is staged AND still executed by the verification gate.
    if (stageOf(command) !== STAGE_THAT_MAY_BE_REUSED) {
      return Object.freeze({ reused: false as const, reason: "the stage is not `prestage`" });
    }
    const policy = reusePolicyOf(command);
    let reason: RefusalReason = "the record holds no result of this command";
    for (const found of documents) {
      const documentRevision = found.document.sourceRevision;
      if (documentRevision === undefined || !documentRevision.available) {
        reason = "the revision of the record is another one";
        continue;
      }
      if (documentRevision.revision !== head) {
        reason = "the revision of the record is another one";
        continue;
      }
      if (documentRevision.workingTreeDirty !== false) {
        reason = "the working tree was not clean in the record";
        continue;
      }
      if (policy === "per-attempt" || policy === "per-phase") {
        if (found.document.phase !== input.gatePhase) {
          reason = "the phase of the record is another one";
          continue;
        }
      }
      if (policy === "per-attempt") {
        if (input.attempt === undefined) {
          reason = "the phase attempt is unknown";
          continue;
        }
        if (attemptOf(found) !== input.attempt) {
          reason = "the phase attempt of the record is another one";
          continue;
        }
      }
      for (const entry of found.document.commands ?? []) {
        if (entry["commandId"] !== command.id) continue;
        if (entry["inner"] === true) {
          reason = "the result is of an inner check";
          continue;
        }
        if (entry["passed"] !== true) {
          reason = "the result did not pass";
          continue;
        }
        if ((entry["state"] ?? "completed") !== "completed") {
          reason = "the result is not completed";
          continue;
        }
        return Object.freeze({
          reused: true as const,
          entry: takeOver({
            entry,
            path: found.path,
            document: found.document,
            revision: head,
            policy,
            attempt: attemptOf(found),
          }),
        });
      }
    }
    return Object.freeze({ reused: false as const, reason });
  };
}

/**
 * ONE TAKEN-OVER RESULT: the record's own entry with `reused: true` and
 * `reusedFrom` naming the place of the record, the stage, the phase, the phase
 * attempt, the plan hash, the revision, the reuse policy, the run time and the
 * duration (F105-FR-033). So a result record never claims an execution it did
 * not perform.
 */
export function takeOver(input: {
  readonly entry: Readonly<Record<string, unknown>>;
  readonly path: string;
  readonly document: PrestageDocumentForReuse;
  readonly revision: string;
  readonly policy: string;
  readonly attempt: number | undefined;
}): ReusedEntry {
  const stage = input.entry["stage"];
  return Object.freeze({
    ...input.entry,
    reused: true as const,
    reusedFrom: Object.freeze({
      evidencePath: input.path,
      stage: typeof stage === "string" ? stage : STAGE_THAT_MAY_BE_REUSED,
      phase: input.document.phase,
      attempt: input.attempt,
      planHash: input.document.planHash,
      revision: input.revision,
      workingTreeDirty: false as const,
      reusePolicy: input.policy,
      ranAtEpoch: numberOrUndefined(input.entry["startedAtEpoch"]),
      durationMs: numberOrUndefined(input.entry["durationMs"]),
    }),
  }) as ReusedEntry;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** A command of the stage `both` is staged and still executed (F105-FR-033). */
export function stillExecutedByTheGate(command: ReusableCommand): boolean {
  return stageOf(command) === STAGE_THAT_IS_STILL_EXECUTED;
}
