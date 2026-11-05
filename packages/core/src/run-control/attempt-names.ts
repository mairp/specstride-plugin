/**
 * T041 — the name of a phase attempt after a reset (F102-FR-035).
 *
 * After `--reset-counts` the counters start again at zero, but the logical
 * name of anything that belongs to a phase attempt MUST still carry the
 * phase number, the ordinal of the engine start and the ordinal of the phase
 * attempt — so that an identifier of a phase attempt is never reused across
 * a reset (F102-FR-032, F102-FR-035). Where a directory of that name already
 * exists, the as-is suffix rule MUST apply: the run id is appended
 * (F100-FR-047).
 *
 * The shape itself is owned by feature 100 (`../ids/attempt-names.ts` of
 * `@specstride/contracts`); this module is the engine-side call of it for the
 * launch after a reset, so that every caller of the engine names the parts
 * the same way and none can drift.
 *
 * No file module of Node.js: whether a directory exists is answered by the
 * caller through `exists` — the core holds no path logic (F100-FR-012).
 */
import {
  attemptDirectoryName,
  attemptDirectoryNameWithSuffix,
  carriesAttemptParameters,
  parseAttemptDirectoryName,
} from "@specstride/contracts/ids/attempt-names";

/** The run id, as feature 100's identifiers define it. */
export type RunId = string;

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F102-FR-035"] as const;

/** The import boundary this module holds (F100-FR-012). */
export const READS_NO_FILE_MODULE_OF_NODE = true as const;

/** The three parameters every name of a phase attempt carries (F102-FR-035). */
export const NAME_CARRIES = [
  "phase number",
  "ordinal of the engine start",
  "ordinal of the phase attempt",
] as const;

/** The as-is suffix rule where the directory exists: the run id is appended. */
export const SUFFIX_RULE = "the run id is appended" as const;

/** The input of the name of one phase attempt after a reset (F102-FR-035). */
export type AttemptNameInput = {
  /** The phase number (`<N>` of the logical name). */
  readonly phaseNumber: number;
  /** The ordinal of the engine start (`k` of `e<k>-a<n>`). */
  readonly engineStartOrdinal: number;
  /** The ordinal of the phase attempt (`n` of `e<k>-a<n>`). */
  readonly attemptOrdinal: number;
  /** The run id, appended where a directory of the name already exists. */
  readonly runId: RunId | string;
  /** True when a directory of the candidate name already exists. */
  readonly exists?: ((name: string) => boolean) | undefined;
};

/**
 * The name of a phase attempt after a reset (F102-FR-035): `e<k>-a<n>`,
 * with the run id appended where a directory of that name already exists.
 * The counts being reset changes no part of the name — the ordinals come
 * from the ledger, which a reset record does not delete.
 */
export function attemptNameAfterReset(input: AttemptNameInput): string {
  const exists = input.exists ?? (() => false);
  return attemptDirectoryNameWithSuffix(
    input.engineStartOrdinal,
    input.attemptOrdinal,
    input.runId,
    exists,
  );
}

/**
 * The logical name of a work product of a phase attempt after a reset
 * (F102-FR-035): `attempt:<N>:<k>:<n>:<name>`, where `<name>` is
 * `attemptNameAfterReset` of the same parts — the phase number in its
 * segment, the run id appended in the name where the directory exists.
 */
export function attemptLogicalNameAfterReset(input: AttemptNameInput, leaf: string): string {
  return `attempt:${input.phaseNumber}:${input.engineStartOrdinal}:${input.attemptOrdinal}:${leaf}`;
}

/**
 * True when a logical name of a phase attempt still carries all three
 * parameters of F102-FR-035 after a reset — the check the engine runs before
 * it writes anything under the name.
 */
export function nameCarriesTheParametersOfAnAttempt(logicalName: string): boolean {
  return carriesAttemptParameters(logicalName);
}

export { attemptDirectoryName, attemptDirectoryNameWithSuffix, parseAttemptDirectoryName };
