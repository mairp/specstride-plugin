/**
 * T245 — the as-is form of the run id for compatibility output, and the name
 * of a phase attempt (annex B, §B.3; F100-FR-046, F100-FR-047).
 *
 * F100-FR-046: where the compatibility projection or compatibility output
 * shows the as-is run id, it shows a value of the as-is form — date and time
 * of the engine start to the second, a hyphen, and the process id of the
 * engine.
 *
 * F100-FR-047: the logical name of anything that belongs to a phase attempt
 * carries the phase number, the ordinal of the engine start and the ordinal
 * of the phase attempt (`e<k>-a<n>`), so that the name stays unique when
 * counts were reset. Where a directory of that name already exists, the as-is
 * suffix rule applies: the run id is appended.
 */
import type { RunId } from "./identifiers.ts";

/** Two digits, zero-padded. */
const two = (n: number): string => String(n).padStart(2, "0");

/**
 * The as-is form of the run id (F100-FR-046): `YYYYMMDD-HHMMSS-<pid>` — the
 * date and the time of the engine start to the second, a hyphen, and the
 * process id of the engine. The time is taken in UTC, as every timestamp of
 * annex B is.
 */
export function asIsRunId(engineStartedAt: Date, enginePid: number): string {
  const d = engineStartedAt;
  const date = `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}`;
  const time = `${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}`;
  return `${date}-${time}-${enginePid}`;
}

/** The shape an as-is run id must have (F100-FR-046). */
export const AS_IS_RUN_ID = /^\d{8}-\d{6}-\d+$/;

/** True for a value of the as-is form of the run id (F100-FR-046). */
export function isAsIsRunId(value: string): boolean {
  return AS_IS_RUN_ID.test(value);
}

/**
 * The name of a phase attempt (F100-FR-047): `e<k>-a<n>`, with `k` the
 * ordinal of the engine start and `n` the ordinal of the phase attempt. The
 * phase number is the segment above it in the logical name
 * (`attempt:<N>:<k>:<n>:…`), which the resolver of T034 substitutes.
 */
export function attemptDirectoryName(engineStartOrdinal: number, attemptOrdinal: number): string {
  return `e${engineStartOrdinal}-a${attemptOrdinal}`;
}

/** The shape of the name of a phase attempt (F100-FR-047). */
export const ATTEMPT_DIRECTORY_NAME = /^e\d+-a\d+$/;

/**
 * The as-is suffix rule of F100-FR-047: where a directory of the name
 * `e<k>-a<n>` already exists, the run id is appended. `exists` answers for a
 * candidate name; the caller gives it the reading of the directory.
 */
export function attemptDirectoryNameWithSuffix(
  engineStartOrdinal: number,
  attemptOrdinal: number,
  runId: RunId | string,
  exists: (name: string) => boolean,
): string {
  const plain = attemptDirectoryName(engineStartOrdinal, attemptOrdinal);
  if (!exists(plain)) return plain;
  return `${plain}-${runId}`;
}

/** The parts of a name of a phase attempt, or `undefined` for another name. */
export function parseAttemptDirectoryName(
  name: string,
): { engineStartOrdinal: number; attemptOrdinal: number; runId?: string } | undefined {
  const m = /^e(\d+)-a(\d+)(?:-(.+))?$/.exec(name);
  if (!m) return undefined;
  const parsed: { engineStartOrdinal: number; attemptOrdinal: number; runId?: string } = {
    engineStartOrdinal: Number(m[1]),
    attemptOrdinal: Number(m[2]),
  };
  if (m[3] !== undefined) parsed.runId = m[3];
  return parsed;
}

/**
 * The parameters a name of a phase attempt carries (F100-FR-047): the phase
 * number, the ordinal of the engine start and the ordinal of the phase
 * attempt. A logical name of a phase attempt carries all three.
 */
export const ATTEMPT_NAME_PARAMETERS = ["<N>", "<k>", "<n>"] as const;

/** True when a logical name belongs to a phase attempt and carries all three. */
export function carriesAttemptParameters(logicalName: string): boolean {
  if (!logicalName.startsWith("attempt:")) return true;
  return ATTEMPT_NAME_PARAMETERS.every((p) => logicalName.includes(p));
}
