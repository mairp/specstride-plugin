/**
 * T049 — the result records of the verification gate, WRITTEN ONCE
 * (F105-FR-009).
 *
 * Three records, each with its logical name of the layout table of annex B
 * §B.5:
 *
 *  - `attempt:<N>:<k>:<n>:verification` — the result of the verification gate
 *    of one phase attempt;
 *  - `run:<runId>:verification:plan` — the verification plan of the run;
 *  - `run:<runId>:verification:release` — the result of release verification.
 *
 * The record of a gate holds `planId`, `planHash`, `gateId`, `phase`,
 * `passed`, `sourceRevision`, `commands`, `buildArtifacts` and `summary`, and
 * each entry of `commands` holds the thirteen as-is fields. BESIDE THESE an
 * entry holds `reused` and `reusedFrom` when its result was taken over
 * (F105-FR-033), and each condition the check runner returned IN A FIELD OF
 * ITS OWN (F105-FR-032) — and AN ENTRY WITHOUT A CONDITION HOLDS NO SUCH
 * FIELD, so that under the `parity` profile the record has the as-is fields
 * only. `asIsFieldsOnly` is the predicate that says so.
 *
 * WRITTEN ONCE. A second write with other content is REFUSED. The refusal is
 * the behaviour, not a convention: `writeOnce` compares the canonical text of
 * what is already there with the canonical text of what is offered, and
 * refuses the write when they differ. A second write of THE SAME content is
 * not a second write at all — a resumed run that re-derives the same record
 * must not break — and that is `SECOND_WRITE_OF_THE_SAME_CONTENT`.
 *
 * The write itself goes through the atomic write of `@specstride/kernel`, so a
 * reader never sees a half record; the refusal happens before it.
 */
import { holdsLogicalName } from "@specstride/contracts/ids/logical-names";
import type { BuildArtifactRecord } from "../prestage/artifacts.ts";
import type { GateOutcome, RecordedCommand } from "./gate.ts";

/** The logical name of the result record of a gate of a phase attempt. */
export const GATE_RECORD_NAME = "attempt:<N>:<k>:<n>:verification" as const;

/** The logical name of the verification plan of the run. */
export const PLAN_RECORD_NAME = "run:<runId>:verification:plan" as const;

/** The logical name of the result of release verification. */
export const RELEASE_RECORD_NAME = "run:<runId>:verification:release" as const;

/** The three names, and the fact that each is one the layout table holds. */
export const RECORD_NAMES = Object.freeze([
  GATE_RECORD_NAME,
  PLAN_RECORD_NAME,
  RELEASE_RECORD_NAME,
]);

/** Every name this module writes is a name of the layout table of §B.5. */
export const NAMES_ARE_IN_THE_LAYOUT: boolean = RECORD_NAMES.every((name) =>
  holdsLogicalName(name),
);

/** The nine fields of the result record of a gate (F105-FR-009). */
export const RECORD_FIELDS = [
  "planId",
  "planHash",
  "gateId",
  "phase",
  "passed",
  "sourceRevision",
  "commands",
  "buildArtifacts",
  "summary",
] as const;
export type RecordField = (typeof RECORD_FIELDS)[number];

/** The thirteen as-is fields of one entry of `commands` (F105-FR-009). */
export const AS_IS_COMMAND_FIELDS = [
  "commandId",
  "declaredId",
  "source",
  "executable",
  "args",
  "env",
  "cwd",
  "exitCode",
  "signal",
  "durationMs",
  "stdout",
  "stderr",
  "passed",
] as const;
export type AsIsCommandField = (typeof AS_IS_COMMAND_FIELDS)[number];

/** The two fields a taken-over result adds (F105-FR-033). */
export const REUSE_FIELDS = ["reused", "reusedFrom"] as const;

/** The result record of the verification gate of a phase attempt. */
export type GateResultRecord = {
  readonly planId: string;
  readonly planHash: string;
  readonly gateId: string;
  readonly phase: number | "release" | null;
  readonly passed: boolean;
  readonly sourceRevision: string;
  readonly commands: readonly RecordedCommand[];
  readonly buildArtifacts: readonly BuildArtifactRecord[];
  readonly summary: string;
};

/** What a result record is built from. */
export type GateRecordInput = {
  readonly planId: string;
  readonly planHash: string;
  readonly gateId: string;
  readonly phase: number | "release" | null;
  readonly sourceRevision: string;
  readonly outcome: Pick<GateOutcome, "passed" | "summary" | "commands">;
  readonly buildArtifacts?: readonly BuildArtifactRecord[] | undefined;
};

/** The result record of a run of the gate, with the nine fields of §F105-FR-009. */
export function gateResultRecord(input: GateRecordInput): GateResultRecord {
  return Object.freeze({
    planId: input.planId,
    planHash: input.planHash,
    gateId: input.gateId,
    phase: input.phase,
    passed: input.outcome.passed,
    sourceRevision: input.sourceRevision,
    commands: Object.freeze([...input.outcome.commands]),
    buildArtifacts: Object.freeze([...(input.buildArtifacts ?? [])]),
    summary: input.outcome.summary,
  });
}

/** The record holds every field of F105-FR-009 and no field is absent. */
export function holdsEveryField(record: Readonly<Record<string, unknown>>): boolean {
  return RECORD_FIELDS.every((field) => field in record);
}

/**
 * The entry holds the as-is fields and NOTHING ELSE. Under the `parity`
 * profile no condition is returned and no result is taken over, so every entry
 * of every record satisfies this — which is the sentence of F105-FR-009.
 */
export function asIsFieldsOnly(entry: Readonly<Record<string, unknown>>): boolean {
  const names = Object.keys(entry);
  return (
    names.length === AS_IS_COMMAND_FIELDS.length &&
    AS_IS_COMMAND_FIELDS.every((field) => names.includes(field))
  );
}

/** The fields of an entry beside the as-is thirteen, in the order they appear. */
export function fieldsBesideTheAsIsOnes(
  entry: Readonly<Record<string, unknown>>,
): readonly string[] {
  return Object.freeze(
    Object.keys(entry).filter(
      (name) => !(AS_IS_COMMAND_FIELDS as readonly string[]).includes(name),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Written once.
 * ------------------------------------------------------------------ */

/** A second write of the SAME content is not a second write (F105-FR-009). */
export const SECOND_WRITE_OF_THE_SAME_CONTENT = "accepted" as const;

/** A second write with OTHER content is refused (F105-FR-009). */
export const SECOND_WRITE_WITH_OTHER_CONTENT = "refused" as const;

/** The reason a refused write gives. */
export function refusalReason(logicalName: string): string {
  return `${logicalName} is written once and already holds other content`;
}

/** The error a refused second write raises. */
export class WriteOnceRefusedError extends Error {
  readonly logicalName: string;
  constructor(logicalName: string) {
    super(refusalReason(logicalName));
    this.name = "WriteOnceRefusedError";
    this.logicalName = logicalName;
  }
}

/** The outcome of a write-once write. */
export type WriteOutcome =
  | { readonly written: true; readonly text: string }
  | { readonly written: false; readonly reason: "same-content"; readonly text: string }
  | { readonly written: false; readonly reason: "refused"; readonly error: WriteOnceRefusedError };

/**
 * The canonical text of a record: the form the comparison of a second write
 * uses. It is the form the baseline writes — indented by two, keys sorted, one
 * closing line end — so that a record written by either side compares equal.
 */
export function canonicalText(record: unknown): string {
  return `${JSON.stringify(record, sortedKeys(record), 2)}\n`;
}

function sortedKeys(_record: unknown): (key: string, value: unknown) => unknown {
  return (_key: string, value: unknown): unknown => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return Object.fromEntries(entries);
  };
}

/** How a record already on disk is read: its text, or `undefined` where none. */
export type ReadExisting = (path: string) => string | undefined;

/** How a record is written: the atomic write of `@specstride/kernel`. */
export type WriteAtomically = (path: string, text: string) => void;

/**
 * Write a record ONCE. A record that is not there is written; a record that is
 * there with THE SAME content is left alone and the write is not an error; a
 * record that is there with OTHER content REFUSES the write.
 */
export function writeOnce(input: {
  readonly logicalName: string;
  readonly path: string;
  readonly record: unknown;
  readonly readExisting: ReadExisting;
  readonly write: WriteAtomically;
  /** True to raise instead of returning the refusal. */
  readonly raise?: boolean | undefined;
}): WriteOutcome {
  const text = canonicalText(input.record);
  const existing = input.readExisting(input.path);
  if (existing === undefined) {
    input.write(input.path, text);
    return Object.freeze({ written: true as const, text });
  }
  if (existing === text) {
    return Object.freeze({ written: false as const, reason: "same-content" as const, text });
  }
  const error = new WriteOnceRefusedError(input.logicalName);
  if (input.raise === true) throw error;
  return Object.freeze({ written: false as const, reason: "refused" as const, error });
}
