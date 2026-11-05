/**
 * T147, the second half — the path of the output of a command STAGED BEFORE
 * the verification gate through the one ingress (F105-FR-054).
 *
 * The surfaces of this folder that hold output of a command:
 *
 *  - `summary` of the record of staged commands (F105-FR-033);
 *  - `summary` of the event rendered as `prestage_done` (F105-FR-034);
 *  - the block of `prestage-report` (F105-FR-039);
 *  - the `summary` of the status record of a detached command (F105-FR-035).
 *
 * Each is written from the port of `../gate/ingress.ts`, the same one the
 * verification gate uses, and from nothing else. The port is the ingress of
 * feature 100 with the ingress class `check-output`.
 *
 * THE RAW LOG OF A DETACHED COMMAND IS THE ONE THING THAT IS DIFFERENT. A
 * detached command is started by the process primitive of the kernel
 * (`research.md` D-17) and writes its own log; that log is a RAW CAPTURE, kept
 * in the control plane, that NO SINK AND NO PROMPT RECEIVES. This feature may
 * read it, and every part it takes out of it enters through the ingress as any
 * other output — `summaryOfADetachedCommand` is that path and is the only one
 * this folder offers.
 */
import {
  CHECK_OUTPUT_CLASS,
  RAW_LOG,
  rawLogIsReadThrough,
  throughTheIngress,
  writtenText,
  type CommandOutputIngress,
  type OutputField,
} from "../gate/ingress.ts";

/** The ingress class of every text of this folder: the same one (row 89). */
export const INGRESS_CLASS = CHECK_OUTPUT_CLASS;

/** The surfaces of this folder that hold output of a command (F105-FR-054). */
export const PRESTAGE_OUTPUT_SURFACES = Object.freeze([
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
  Object.freeze({
    field: "block",
    record: "the block of `prestage-report`",
    requirement: "F105-FR-039",
  }),
  Object.freeze({
    field: "summary",
    record: "the status record of a detached command",
    requirement: "F105-FR-035",
  }),
]);

/** The facts about the raw log of a detached command, re-stated for this folder. */
export const DETACHED_RAW_LOG = RAW_LOG;

/** The `summary` of the record of staged commands, through the ingress. */
export function stagedSummary(
  ingress: CommandOutputIngress,
  text: string | undefined,
): OutputField {
  return throughTheIngress(ingress, text);
}

/** The `summary` the event rendered as `prestage_done` carries. */
export function prestageDoneSummary(
  ingress: CommandOutputIngress,
  text: string | undefined,
): string {
  return writtenText(throughTheIngress(ingress, text));
}

/** The block of `prestage-report`, through the ingress (F105-FR-039). */
export function prestageReportBlock(
  ingress: CommandOutputIngress,
  text: string | undefined,
): OutputField {
  return throughTheIngress(ingress, text);
}

/**
 * The `summary` of the status record of a detached command. Its text comes out
 * of the raw log the process wrote, and it comes out THROUGH THE INGRESS.
 */
export function summaryOfADetachedCommand(
  ingress: CommandOutputIngress,
  rawLogText: string | undefined,
): OutputField {
  return rawLogIsReadThrough(ingress, rawLogText);
}

/** This folder reads the output of a command by no way that passes the ingress by. */
export const READS_OUTPUT_ONLY_THROUGH_THE_INGRESS = true as const;
