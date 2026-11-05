/**
 * T077 of feature 118 — the one ingress in use (F118-FR-044; F100-FR-009,
 * F100-FR-205).
 *
 * Every text this feature takes from outside the runtime enters through the
 * `Ingress` port (ports.ts, the one point of redaction of feature 100) before
 * any writer of this feature puts it into a sink or a prompt. This module is
 * the ONLY place that reads an `AdmittedText` result: no writer of the feature
 * redacts by itself and none writes the unredacted form.
 *
 * When the redactor cannot run, the text is DROPPED and the record says so
 * (F100-FR-205); the kill, the wait and the resume go on without it — a drop
 * is never an error and never aborts a writer.
 *
 * The ingress classes are the closed set row 89 of annex X §X.6:
 * `tool-arguments` for a command line and an argument list, `stream-text` for
 * a text block of the pass, `check-output` for the log of a job and what is
 * taken from it, `free-text` for the other texts.
 */

import type { AdmittedText, Ingress, IngressClass } from "./ports.ts";

/** What a dropped text leaves behind in a sink or a prompt (as-is literal). */
export const REDACTED_TEXT = "(redacted)";

/** The record of one admission, as it is written next to the text. */
export type AdmissionOutcome = "admitted" | "dropped";

/** The durable line a writer puts into its record when a text was dropped. */
export const INGRESS_DROPPED_LINE =
  "[the redactor could not run: the text was dropped; the pass went on]";

/** The fixed size cap of the ingress cut (F100-FR-009), in characters. */
export const INGRESS_SIZE_CAP = 4096;

/** One text after the ingress, with the outcome that the record carries. */
export interface AdmittedForWrite {
  /** The text to write: the admitted form, or the as-is redaction placeholder. */
  readonly text: string;
  /** True when the redactor could not run and the text was dropped. */
  readonly held: boolean;
  /** The outcome for the record (`admitted` or `dropped`). */
  readonly outcome: AdmissionOutcome;
}

function result(text: string, held: boolean): AdmittedForWrite {
  return { text, held, outcome: held ? "dropped" : "admitted" };
}

/**
 * Admit one outside text for a write: the admitted form, cut to `sizeCap`
 * (default `INGRESS_SIZE_CAP`); a drop becomes the placeholder, never an
 * exception and never the raw text.
 */
export function admitForWrite(
  ingress: Ingress,
  text: string,
  ingressClass: IngressClass,
  sizeCap: number = INGRESS_SIZE_CAP,
): AdmittedForWrite {
  let admittedText: AdmittedText;
  try {
    admittedText = ingress.admit(text, ingressClass);
  } catch {
    // The redactor itself threw: fail closed, as if it could not run.
    return result(REDACTED_TEXT, true);
  }
  if (admittedText.kind === "dropped") return result(REDACTED_TEXT, true);
  const cut =
    admittedText.text.length > sizeCap ? admittedText.text.slice(0, sizeCap) : admittedText.text;
  return result(cut, false);
}

/** The outcome of one argument list after the ingress. */
export interface AdmittedArgv {
  readonly argv: readonly string[];
  readonly held: boolean;
  readonly outcome: AdmissionOutcome;
}

/**
 * Admit every element of an argument list (class `tool-arguments`); an
 * element the redactor could not take becomes the placeholder.
 */
export function admitArgv(ingress: Ingress, argv: readonly string[]): AdmittedArgv {
  const out: string[] = [];
  let held = false;
  for (const part of argv) {
    const one = admitForWrite(ingress, part, "tool-arguments");
    if (one.held) held = true;
    out.push(one.text);
  }
  return { argv: out, held, outcome: held ? "dropped" : "admitted" };
}

/**
 * Admit a list of lines (class given by the caller, `check-output` for a job
 * log); a dropped line becomes the placeholder and the outcome says so.
 */
export function admitLines(
  ingress: Ingress,
  lines: readonly string[],
  ingressClass: IngressClass,
): {
  readonly lines: readonly string[];
  readonly held: boolean;
  readonly outcome: AdmissionOutcome;
} {
  const out: string[] = [];
  let held = false;
  for (const line of lines) {
    const one = admitForWrite(ingress, line, ingressClass);
    if (one.held) held = true;
    out.push(one.text);
  }
  return { lines: out, held, outcome: held ? "dropped" : "admitted" };
}

/** The value a writer records next to a text (F100-FR-205: the record says so). */
export function admissionRecord(held: boolean): AdmissionOutcome {
  return held ? "dropped" : "admitted";
}

/**
 * An ingress whose redactor cannot run: every text is dropped (F100-FR-205).
 * Used at the edge when feature 100 reports the redactor unavailable; the
 * writers keep going with the placeholder and the dropped record.
 */
export function unavailableIngress(): Ingress {
  return { admit: () => ({ kind: "dropped" }) };
}

/** An ingress that passes every text through unchanged (the fixtures hold no secret). */
export function passingIngress(): Ingress {
  return { admit: (text: string) => ({ kind: "text", text }) };
}
