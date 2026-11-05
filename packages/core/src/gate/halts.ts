/**
 * T068 of feature 101 — the halts of the phase gate, from the table as DATA,
 * and the halt banner (F101-FR-037, F101-FR-014); and T112 — the texts of the
 * banner pass the one ingress of feature 100 first (F101-FR-052).
 *
 * F101-FR-037 asks for exactly one exit code and exactly one stop reason per
 * halt, as the table "Halts of the phase gate" states them, and that this
 * feature adds NO exit code and NO stop reason. Both promises are kept by
 * READING and never by restating: `GATE_HALTS` of
 * `@specstride/contracts/engine/gate-halts` is the table of
 * `specs/101-gate-and-verdict/contracts/gate-halts.json`, validated at load
 * against the closed sets of feature 100 (T004), and every value this module
 * hands out comes from a row of it. A row that disagreed with annex E would
 * fail that import, not some later run.
 *
 * So this module holds no literal exit code and no literal stop reason of its
 * own. `HALT_CAUSES` is the list of causes the table knows; `haltOf` is the one
 * way the engine turns a cause into a halt; `EXIT_CODES_THIS_FEATURE_ADDS` and
 * `STOP_REASONS_THIS_FEATURE_ADDS` are empty by construction.
 *
 * The second half of the module is the halt banner of B-0231, which the engine
 * prints when the reject limit was reached (F101-FR-014). Every text of it that
 * comes from outside the runtime passes the ONE INGRESS first
 * (`./lines.ts`, `throughTheIngress`), and where the redactor cannot run the
 * mark of dropped content stands in its place and the verdict and the counts do
 * not change (F101-FR-052, F100-FR-205).
 */
import { GATE_HALTS, gateHalt, type GateHalt } from "@specstride/contracts/engine/gate-halts";
import type { StopReason } from "@specstride/contracts/codes/stop-reasons";
import {
  BANNER_FRAME,
  BANNER_SECTIONS,
  OPTIONAL_BANNER_SECTIONS,
  haltBanner,
  haltBannerHeading,
  throughTheIngress,
  type Ingress,
} from "./lines.ts";

export type { GateHalt };
export { GATE_HALTS, gateHalt };

/** F101-FR-037 — every halt has exactly one exit code. */
export const EXIT_CODES_PER_HALT = 1 as const;
/** F101-FR-037 — and exactly one stop reason. */
export const STOP_REASONS_PER_HALT = 1 as const;

/** F101-FR-037 — this feature adds no exit code. */
export const EXIT_CODES_THIS_FEATURE_ADDS: readonly number[] = Object.freeze([]);
/** F101-FR-037 — and no stop reason. */
export const STOP_REASONS_THIS_FEATURE_ADDS: readonly string[] = Object.freeze([]);

/** The contract file the table comes from; the data is its byte-for-byte copy. */
export const TABLE_FILE = "specs/101-gate-and-verdict/contracts/gate-halts.json" as const;

/** Every cause the table knows, in the order of the table. */
export const HALT_CAUSES: readonly string[] = Object.freeze(GATE_HALTS.map((row) => row.cause));

/** The cause of a halt, as the table names it. */
export type HaltCause = (typeof HALT_CAUSES)[number];

/** A cause the table does not know. */
export class UnknownHaltCauseError extends Error {
  readonly causeName: string;
  constructor(cause: string) {
    super(
      `\`${cause}\` is no cause of the table "Halts of the phase gate" ` +
        `(${TABLE_FILE}); its causes are ${HALT_CAUSES.join(", ")} (F101-FR-037)`,
    );
    this.name = "UnknownHaltCauseError";
    this.causeName = cause;
  }
}

/** One halt of the phase gate, as the engine ends the run with it. */
export type Halt = {
  /** The cause, as the row of the table names it. */
  readonly cause: string;
  /** The one exit code of the row. */
  readonly exitCode: number;
  /** The one stop reason of the row, or null where the exit has none. */
  readonly stopReason: StopReason | null;
  /** `retryable` of the row; false on every row of this table. */
  readonly retryable: boolean;
  /** The as-is fields of the stop line, in the order of the table. */
  readonly asIsFields: readonly string[];
  /** Whether the last phase attempt is archived before the halt. */
  readonly archivedBefore: boolean | null;
};

/**
 * F101-FR-037 — the halt of one cause, read from the table. The engine has no
 * other way to form a halt of the phase gate, which is what makes "exactly one
 * exit code and exactly one stop reason" hold by construction.
 */
export function haltOf(cause: string): Halt {
  const row = gateHalt(cause);
  if (row === undefined) throw new UnknownHaltCauseError(cause);
  return Object.freeze({
    cause: row.cause,
    exitCode: row.exitCode,
    stopReason: row.stopReason,
    retryable: row.retryable,
    asIsFields: row.asIsFields,
    archivedBefore: row.archivedBefore,
  });
}

/** The row of the table a fixture or a scenario of feature 141 ends in. */
export function haltOfFixture(fixture: string): Halt | undefined {
  const row = GATE_HALTS.find((halt) => halt.fixtures.includes(fixture));
  return row === undefined ? undefined : haltOf(row.cause);
}

/**
 * F101-FR-041 — a halt of the phase gate by the reject limit, by the MALFORMED
 * limit or by oscillation ends the run as a stop that is NOT retryable and is
 * never relaunched. The three causes are named by the table; the promise is
 * read off the row, so a row that ever said `retryable: true` would be caught
 * by the test and not by a run.
 */
export const HALTS_BY_A_LIMIT = ["reject-limit", "malformed-limit", "oscillation"] as const;
export type HaltByALimit = (typeof HALTS_BY_A_LIMIT)[number];

/** F101-FR-041 — a halt by a limit is relaunched. */
export const A_HALT_BY_A_LIMIT_IS_RELAUNCHED = false as const;

/** True when the cause is one of the three halts by a limit (F101-FR-041). */
export function isAHaltByALimit(cause: string): cause is HaltByALimit {
  return (HALTS_BY_A_LIMIT as readonly string[]).includes(cause);
}

/** F101-FR-041 — whether this halt may be relaunched: never, for a limit. */
export function mayBeRelaunched(cause: string): boolean {
  if (isAHaltByALimit(cause)) return A_HALT_BY_A_LIMIT_IS_RELAUNCHED;
  return haltOf(cause).retryable;
}

/* ------------------------------------------------------------------ *
 * The as-is stop line of the compatibility projection.
 * ------------------------------------------------------------------ */

/** The as-is name of the event of a halt (B-0151 to B-0154). */
export const AS_IS_STOP_EVENT = "run_stop" as const;

/** The as-is field that carries the stop reason. */
export const AS_IS_FIELD_OF_THE_STOP_REASON = "reason" as const;

/**
 * F101-FR-037 — the as-is stop line of a halt, as the compatibility projection
 * shows it: the as-is name, the reason, and the as-is fields of the ROW of the
 * table, in the order of the table. A field the caller does not hand over is
 * ABSENT, as at the baseline; a field the row does not name is dropped, so no
 * halt can grow a field the table does not give it.
 *
 * A row without a stop reason (the exit-0 path) projects to no stop line at
 * all: `undefined` is returned, which is what CQ-174 asks for.
 */
export function asIsStopLine(
  cause: string,
  values: Readonly<Record<string, unknown>> = {},
):
  | { readonly event: typeof AS_IS_STOP_EVENT; readonly fields: Readonly<Record<string, unknown>> }
  | undefined {
  const halt = haltOf(cause);
  if (halt.stopReason === null) return undefined;
  const fields: Record<string, unknown> = { [AS_IS_FIELD_OF_THE_STOP_REASON]: halt.stopReason };
  for (const field of halt.asIsFields) {
    const value = values[field];
    if (value === undefined) continue;
    // The engine script wrote every value as text (D-25).
    fields[field] = String(value);
  }
  return Object.freeze({ event: AS_IS_STOP_EVENT, fields: Object.freeze(fields) });
}

/* ------------------------------------------------------------------ *
 * F101-FR-014 — the halt banner of B-0231, through the one ingress.
 * ------------------------------------------------------------------ */

export { BANNER_FRAME, BANNER_SECTIONS, OPTIONAL_BANNER_SECTIONS, haltBannerHeading };

/** F101-FR-014 — one gist line per archived phase attempt, cut to this many characters. */
export const REJECTION_TRAIL_GIST_MAX = 100 as const;

/** One archived phase attempt, as the rejection trail of the banner shows it. */
export type RejectionTrailEntry = {
  /** The ordinal of the archived phase attempt. */
  readonly ordinal: number;
  /** The gist of its feedback: text of a critic-class call. */
  readonly gist: string;
};

/**
 * F101-FR-014 and F101-FR-052 — one line of the rejection trail: the ordinal
 * of the archived phase attempt, then its gist, passed through the one ingress
 * and cut to 100 characters. The cut comes AFTER the ingress, so what is
 * counted is what is written.
 */
export function rejectionTrailLine(entry: RejectionTrailEntry, ingress: Ingress): string {
  const gist = throughTheIngress(ingress, entry.gist, "critic-reply");
  return `  attempt ${entry.ordinal}: ${gist.slice(0, REJECTION_TRAIL_GIST_MAX)}`;
}

/** One phase attempt of the section `attempt history` of the banner. */
export type AttemptHistoryEntry = {
  readonly ordinal: number;
  /** What the phase attempt ended as; the runtime's own word, not outside text. */
  readonly outcome: string;
};

/**
 * The section `attempt history` of the banner. It holds ordinals and the
 * runtime's own words for the outcomes, so it needs no ingress.
 */
export function attemptHistoryText(history: readonly AttemptHistoryEntry[]): string {
  return history.map((entry) => `${entry.ordinal}=${entry.outcome}`).join(" ");
}

/** What the halt banner of the reject limit is handed. */
export type HaltBannerRequest = {
  readonly phase: number;
  /** The reject limit the phase reached. */
  readonly maxRejects: number;
  /** Where the latest phase evidence stands, or an excerpt of it. */
  readonly latestEvidence: string;
  /** The latest feedback: the reply of the critic. */
  readonly latestFeedback: string;
  /** The hint, where a diagnosis wrote one: the reply of the diagnostician. */
  readonly diagnosticianHint?: string | undefined;
  /** The acceleration note, where an accelerated phase attempt wrote one. */
  readonly accelerationNote?: string | undefined;
  readonly attemptHistory: readonly AttemptHistoryEntry[];
  /** One entry per ARCHIVED phase attempt (F101-FR-014). */
  readonly rejectionTrail: readonly RejectionTrailEntry[];
};

/**
 * F101-FR-014 and F101-FR-052 — the halt banner of a reject limit, with every
 * text that comes from outside the runtime passed through the ONE INGRESS
 * before any byte of it stands in a line.
 *
 * The bytes of the frame, the heading and the section labels belong to
 * `./lines.ts` (B-0231); this function decides only what goes INTO them, which
 * is where the ingress belongs. The optional sections stay optional: a hint
 * that does not exist is not passed through the ingress and prints no line.
 */
export function haltBannerThroughTheIngress(
  request: HaltBannerRequest,
  ingress: Ingress,
): readonly string[] {
  return haltBanner({
    phase: request.phase,
    maxRejects: request.maxRejects,
    latestEvidence: throughTheIngress(ingress, request.latestEvidence, "critic-reply"),
    latestFeedback: throughTheIngress(ingress, request.latestFeedback, "critic-reply"),
    ...(request.diagnosticianHint === undefined
      ? {}
      : {
          diagnosticianHint: throughTheIngress(
            ingress,
            request.diagnosticianHint,
            "diagnostician-reply",
          ),
        }),
    ...(request.accelerationNote === undefined
      ? {}
      : {
          accelerationNote: throughTheIngress(ingress, request.accelerationNote, "critic-reply"),
        }),
    attemptHistory: attemptHistoryText(request.attemptHistory),
    rejectionTrail: request.rejectionTrail.map((entry) => rejectionTrailLine(entry, ingress)),
  });
}

/** F101-FR-014 — the banner is printed when the reject limit was reached. */
export const THE_BANNER_IS_PRINTED_ON = "reject-limit" as const;

/** F101-FR-014 and B-0336 — the last phase attempt of that halt is archived. */
export const THE_LAST_PHASE_ATTEMPT_OF_A_REJECT_LIMIT_IS_ARCHIVED = false as const;
