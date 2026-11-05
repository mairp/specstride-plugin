/**
 * T147 — the path of command output through THE ONE INGRESS (F105-FR-054).
 *
 * Output of a verification command is text from outside the runtime. It enters
 * through the one ingress of feature 100 (annex A, F100-FR-009) with the
 * ingress class `check-output` (annex X §X.6, row 89), where it is made safe
 * and cut, BEFORE this feature writes any part of it. `OUTPUT_SURFACES` is the
 * list of every surface the requirement names, as data, so a new writer of
 * output can be checked against it.
 *
 * THIS FEATURE DOES NOT DO THE WORK ITSELF, and it cannot: the ingress lives
 * in `@specstride/observability`, which is not in the `mayImport` of this
 * package (`@specstride/contracts` and `@specstride/kernel` only). So the
 * ingress arrives as ONE INJECTED PORT, `CommandOutputIngress`, and every
 * function of this feature that turns command output into a written field
 * takes that port. A path that passes the ingress by is not a path a caller
 * can take: `OutputField` HAS NO TEXT FIELD ON THE DROPPED BRANCH, so a writer
 * cannot read a text that was never made safe.
 *
 * When the ingress cannot run, the text is DROPPED and the record SAYS SO
 * (F100-FR-205): the field carries the mark of the drop and no text. The
 * verification gate still decides on the exit results — an exit code is a
 * number the check runner returned and is not output of the command, so
 * `THE_GATE_STILL_DECIDES_ON_EXIT_RESULTS` holds whatever the ingress did.
 *
 * The log of a detached command is written by the process itself
 * (F105-FR-035). It is a RAW CAPTURE, kept in the control plane, that no sink
 * and no prompt receives; `RAW_LOG` says so, and `rawLogIsReadThrough` is the
 * only way this feature takes anything out of it — through this same ingress,
 * as any other output.
 */
import { rowOf } from "@specstride/contracts/enums";

/** Row 89 of annex X §X.6 — the ingress classes. Row 90 — the marks of a drop. */
const ROW_89 = rowOf(89);
const ROW_90 = rowOf(90);

/** The ingress class of the output of a verification command (row 89). */
export const CHECK_OUTPUT_CLASS = "check-output" as const;

/** The class is a member of row 89 and not a free string. */
export const CLASS_IS_A_MEMBER_OF_ROW_89: boolean =
  ROW_89?.literals.includes(CHECK_OUTPUT_CLASS) === true;

/** The requirement of feature 100 the one ingress is (annex A). */
export const ONE_INGRESS_REQUIREMENT = "F100-FR-009" as const;

/** The mark a drop carries (row 90 of annex X §X.6, owner 111). */
export type DropMark = string;

/** The marks of row 90, read from the annex. */
export const DROP_MARKS: readonly string[] = Object.freeze([...(ROW_90?.literals ?? [])]);

/**
 * Every surface of F105-FR-054: what is written, where, and by which
 * requirement. Output reaches none of them except through the ingress.
 */
export const OUTPUT_SURFACES = Object.freeze([
  Object.freeze({
    field: "summary",
    record: "the record of staged commands",
    requirement: "F105-FR-033",
  }),
  Object.freeze({
    field: "summary",
    record: "the event rendered as `prestage_done`",
    requirement: "F105-FR-034",
  }),
  Object.freeze({ field: "summary", record: "a result record", requirement: "F105-FR-009" }),
  Object.freeze({ field: "stdout", record: "a result record", requirement: "F105-FR-009" }),
  Object.freeze({ field: "stderr", record: "a result record", requirement: "F105-FR-009" }),
  Object.freeze({ field: "text", record: "the failure summary", requirement: "F105-FR-037" }),
  Object.freeze({
    field: "text",
    record: "the feedback of a phase attempt",
    requirement: "F105-FR-006",
  }),
  Object.freeze({
    field: "text",
    record: "the block of `prestage-report`",
    requirement: "F105-FR-039",
  }),
  Object.freeze({
    field: "summary",
    record: "the status record of a detached command",
    requirement: "F105-FR-035",
  }),
]);

/** The names of the fields of a result record that hold command output. */
export const RESULT_RECORD_OUTPUT_FIELDS = ["summary", "stdout", "stderr"] as const;
export type ResultRecordOutputField = (typeof RESULT_RECORD_OUTPUT_FIELDS)[number];

/** This feature does the work of making text safe itself: no (F105-FR-054). */
export const DOES_THE_WORK_ITSELF = false as const;

/** The gate decides on the exit results whatever the ingress did. */
export const THE_GATE_STILL_DECIDES_ON_EXIT_RESULTS = true as const;

/**
 * The raw log of a detached command (F105-FR-035, F105-FR-054): written by the
 * process, kept in the control plane, received by no sink and no prompt.
 */
export const RAW_LOG = Object.freeze({
  writtenBy: "the process itself",
  keptIn: "the control plane",
  reachesASink: false,
  reachesAPrompt: false,
  readOnlyThroughTheIngress: true,
});

/** What the port gives back when the text came through. */
export type IngressAccepted = {
  readonly ok: true;
  readonly ingressClass: string;
  /** The text as it may be written, and not the text that arrived. */
  readonly text: string;
  readonly truncated: boolean;
  readonly original_bytes: number;
  readonly retained_bytes: number;
};

/** What the port gives back when the text could not come through. */
export type IngressRefused = {
  readonly ok: false;
  readonly ingressClass: string;
  readonly dropped: true;
  /** Which of the marks of row 90 applied. */
  readonly mark: DropMark;
  readonly original_bytes: number;
};

/**
 * What the port gives back. IT IS A UNION AND THAT IS THE POINT: on the
 * refused branch there is no `text` field at all, so a caller cannot write a
 * text the ingress never passed.
 */
export type IngressOutcome = IngressAccepted | IngressRefused;

/**
 * The ONE injected port: one text, one class, one answer. The implementation
 * is the ingress of `@specstride/observability`; this package never has one of
 * its own.
 */
export type CommandOutputIngress = (text: string, ingressClass?: string) => IngressOutcome;

/**
 * A field of a record that holds command output. On the dropped branch the
 * field HAS NO TEXT and says why, which is what "the record must say so" of
 * F100-FR-205 means here.
 */
export type OutputField =
  | {
      readonly present: true;
      readonly text: string;
      readonly truncated: boolean;
      readonly originalBytes: number;
    }
  | {
      readonly present: false;
      readonly dropped: true;
      readonly mark: DropMark;
      readonly originalBytes: number;
      /** The note the record carries in place of the text. */
      readonly note: string;
    };

/** The note a record carries in place of a dropped text. */
export function dropNote(mark: DropMark): string {
  return `output dropped (${mark})`;
}

/**
 * ONE TEXT THROUGH THE INGRESS. Every surface of `OUTPUT_SURFACES` is written
 * from the result of this function and from nothing else.
 */
export function throughTheIngress(
  ingress: CommandOutputIngress,
  text: string | undefined,
): OutputField {
  const arriving = text ?? "";
  const outcome = ingress(arriving, CHECK_OUTPUT_CLASS);
  if (!outcome.ok) {
    return Object.freeze({
      present: false as const,
      dropped: true as const,
      mark: outcome.mark,
      originalBytes: outcome.original_bytes,
      note: dropNote(outcome.mark),
    });
  }
  return Object.freeze({
    present: true as const,
    text: outcome.text,
    truncated: outcome.truncated,
    originalBytes: outcome.original_bytes,
  });
}

/**
 * The text of a field as it may be WRITTEN: the text on the accepted branch,
 * and the note on the dropped branch. A writer that needs a string takes this
 * and can never reach the text that arrived.
 */
export function writtenText(field: OutputField): string {
  return field.present ? field.text : field.note;
}

/** True where the field was dropped, which the record records. */
export function wasDropped(field: OutputField): boolean {
  return !field.present;
}

/**
 * The two fields a record carries about a drop, or nothing where the text came
 * through. An entry without a drop therefore holds no such field, so under the
 * `parity` profile a record has the as-is fields only (F105-FR-009).
 */
export function dropFields(field: OutputField): Readonly<Record<string, unknown>> {
  return field.present
    ? Object.freeze({})
    : Object.freeze({ outputDropped: true, outputDropMark: field.mark });
}

/**
 * The only way this feature takes text out of the raw log of a detached
 * command: through the same ingress, as any other output (F105-FR-054).
 */
export function rawLogIsReadThrough(
  ingress: CommandOutputIngress,
  rawText: string | undefined,
): OutputField {
  return throughTheIngress(ingress, rawText);
}

/* ------------------------------------------------------------------ *
 * Test doubles. They are stand-ins for the port, never for the work.
 * ------------------------------------------------------------------ */

/** The options of the stand-in ingress. */
export type FakeIngressOptions = {
  /** Text to replace, each occurrence, by `placeholder`. */
  readonly replace?: readonly string[] | undefined;
  /** What a replaced text becomes. */
  readonly placeholder?: string | undefined;
  /** The byte cap, after which the text is cut. */
  readonly cap?: number | undefined;
  /** The mark of a drop; set, the stand-in refuses every text. */
  readonly refuseWith?: DropMark | undefined;
};

/**
 * A stand-in for the port, for a test. It is NOT an ingress of this feature:
 * it is a recorded double that stands where the ingress of
 * `@specstride/observability` stands in a run, so that a test can prove that
 * this feature writes only what came back from the port.
 */
export function createFakeIngress(options: FakeIngressOptions = {}): CommandOutputIngress & {
  readonly calls: readonly { readonly text: string; readonly ingressClass: string }[];
} {
  const calls: { text: string; ingressClass: string }[] = [];
  const placeholder = options.placeholder ?? "<removed>";
  const port = (text: string, ingressClass: string = CHECK_OUTPUT_CLASS): IngressOutcome => {
    calls.push({ text, ingressClass });
    const bytes = Buffer.byteLength(text, "utf8");
    if (options.refuseWith !== undefined) {
      return Object.freeze({
        ok: false as const,
        ingressClass,
        dropped: true as const,
        mark: options.refuseWith,
        original_bytes: bytes,
      });
    }
    let out = text;
    for (const needle of options.replace ?? []) {
      if (needle !== "") out = out.split(needle).join(placeholder);
    }
    const cap = options.cap;
    const cut = cap !== undefined && Buffer.byteLength(out, "utf8") > cap;
    if (cut) out = Buffer.from(out, "utf8").subarray(0, cap).toString("utf8");
    return Object.freeze({
      ok: true as const,
      ingressClass,
      text: out,
      truncated: cut,
      original_bytes: bytes,
      retained_bytes: Buffer.byteLength(out, "utf8"),
    });
  };
  // `Object.assign` would EVALUATE a getter and copy its value once, which
  // froze an empty list; the accessor is therefore defined on the port.
  Object.defineProperty(port, "calls", {
    enumerable: true,
    get: () => Object.freeze(calls.map((call) => Object.freeze({ ...call }))),
  });
  return port as CommandOutputIngress & {
    readonly calls: readonly { readonly text: string; readonly ingressClass: string }[];
  };
}
