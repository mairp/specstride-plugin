/**
 * T047 — the feedback written BY THE ENGINE on a failed verification gate
 * (F105-FR-006).
 *
 * This is the point of the whole feature. On a failed verification gate the
 * engine writes the feedback of the phase attempt ITSELF, under
 * `attempt:<N>:<k>:<n>:feedback`. No critic was called, so no critic wrote it;
 * the proposer cannot write it; and what it says is what the commands did.
 *
 * The text, in order:
 *
 *  - it STARTS with `# Phase <N> deterministic verification gate rejected`;
 *  - the four lines of the baseline that say the failing command is the only
 *    thing that can clear the gate and that re-writing the phase evidence will
 *    not change the result;
 *  - it HOLDS THE FAILURE SUMMARY under `## What actually failed`
 *    (F105-FR-037);
 *  - it NAMES the plan and the result record under `## References`;
 *  - it ENDS with
 *    `The phase cannot be approved solely from the proposer or critic claim.`
 *
 * When the failure summary CANNOT BE PRODUCED, the section holds
 * `(failure digest unavailable — read the evidence document below)` (B-1145) —
 * and the feedback is still written, with every other part in place. A
 * feedback that is not written is a phase attempt whose proposer has nothing
 * to repair.
 *
 * The text of the phase evidence in the fourth line is named BY LOGICAL NAME
 * (`gate:<N>:evidence`), because the place of that file is the layout table of
 * annex B §B.5 and not this feature's to spell.
 *
 * Output of a command reaches this text only through the failure summary,
 * which is rendered from a result record whose fields came through the one
 * ingress (F105-FR-054).
 */
import { holdsLogicalName } from "@specstride/contracts/ids/logical-names";

/** The logical name of the feedback of a phase attempt (annex B §B.5). */
export const FEEDBACK_NAME = "attempt:<N>:<k>:<n>:feedback" as const;

/** The name is one the layout table holds, and not a free string. */
export const FEEDBACK_NAME_IS_IN_THE_LAYOUT: boolean = holdsLogicalName(FEEDBACK_NAME);

/** The logical name of the phase evidence the fourth line names. */
export const PHASE_EVIDENCE_NAME = "gate:<N>:evidence" as const;

/** That name is one the layout table holds too. */
export const PHASE_EVIDENCE_NAME_IS_IN_THE_LAYOUT: boolean = holdsLogicalName(PHASE_EVIDENCE_NAME);

/** Who writes the feedback on a failed verification gate: the engine. */
export const WRITTEN_BY = "the engine" as const;

/** The heading the feedback starts with (B-0182). */
export function heading(phase: number | "release"): string {
  return `# Phase ${phase} deterministic verification gate rejected`;
}

/** The heading the failure summary sits under (B-0182). */
export const WHAT_FAILED_HEADING = "## What actually failed" as const;

/** The heading the plan and the record are named under (B-0182). */
export const REFERENCES_HEADING = "## References" as const;

/** The sentence the feedback ends with (B-1144). */
export const CLOSING_SENTENCE =
  "The phase cannot be approved solely from the proposer or critic claim." as const;

/** What the section holds when the failure summary cannot be produced (B-1145). */
export const SUMMARY_UNAVAILABLE =
  "(failure digest unavailable — read the evidence document below)" as const;

/**
 * The four lines after the heading (B-0182). `<evidence>` is the phase
 * evidence, named by logical name.
 */
export function preamble(gateResultCode: number, phaseEvidence: string): readonly string[] {
  return Object.freeze([
    `The fixed-argv verification gate failed (exit ${gateResultCode}). The failing command`,
    "below is the ONLY thing that can clear this gate. Fix the CODE it points",
    `at. Re-writing ${phaseEvidence}, regenerating proofs, or`,
    "restating that the work is done will NOT change this result.",
  ]);
}

/** The two lines of `## References` (B-0182). */
export function references(plan: string, record: string): readonly string[] {
  return Object.freeze([
    `- Canonical verification plan: \`${plan}\``,
    `- Verification evidence: \`${record}\``,
  ]);
}

/** What the feedback is built from. */
export type FeedbackInput = {
  readonly phase: number | "release";
  /** The code of the verification gate itself: 10 or 3. */
  readonly gateResultCode: number;
  /** The failure summary, or `undefined` where it could not be produced. */
  readonly failureSummary: string | undefined;
  /** The verification plan, named as the feedback names it. */
  readonly plan: string;
  /** The result record of the gate, named as the feedback names it. */
  readonly record: string;
  /** The phase evidence, named by logical name by default. */
  readonly phaseEvidence?: string | undefined;
};

/**
 * The feedback of a phase attempt whose verification gate failed.
 *
 * The text is built LINE BY LINE, in the order the baseline writes it, and the
 * failure summary is put in VERBATIM — with the blank line its own last line
 * leaves — because that blank line is part of the text a reader sees. Joining
 * a stripped summary into a list of lines loses it and the two texts differ by
 * one newline before `## References`; building the text by appending keeps the
 * two shapes equal, and the shape of a summary that is absent equal as well.
 */
export function renderFeedback(input: FeedbackInput): string {
  const evidenceName = input.phaseEvidence ?? PHASE_EVIDENCE_NAME;
  let text = "";
  const line = (value = ""): void => {
    text += `${value}\n`;
  };
  line(heading(input.phase));
  line();
  for (const value of preamble(input.gateResultCode, evidenceName)) line(value);
  line();
  line(WHAT_FAILED_HEADING);
  line();
  // VERBATIM. The summary brings its own line ends, including the blank line
  // its last fenced block leaves behind.
  text += failureSection(input.failureSummary);
  line();
  line(REFERENCES_HEADING);
  line();
  for (const value of references(input.plan, input.record)) line(value);
  line();
  line(CLOSING_SENTENCE);
  return text;
}

/**
 * The body of `## What actually failed`, ending with exactly the line ends the
 * part itself brings: the failure summary as it was rendered, or the as-is
 * line of B-1145 with one line end, which is what the baseline's `echo` of
 * that line gives when the summary could not be produced.
 */
export function failureSection(failureSummary: string | undefined): string {
  if (failureSummary === undefined || failureSummary.trim() === "") {
    return `${SUMMARY_UNAVAILABLE}\n`;
  }
  return failureSummary.endsWith("\n") ? failureSummary : `${failureSummary}\n`;
}

/** The feedback starts with the heading (F105-FR-006). */
export function startsWithTheHeading(text: string, phase: number | "release"): boolean {
  return text.startsWith(`${heading(phase)}\n`);
}

/** The feedback ends with the closing sentence (F105-FR-006). */
export function endsWithTheClosingSentence(text: string): boolean {
  return text.replace(/\n+$/u, "").endsWith(CLOSING_SENTENCE);
}

/** The feedback holds the failure summary under its heading (F105-FR-006). */
export function holdsTheFailureSummaryUnderItsHeading(text: string, summary: string): boolean {
  const at = text.indexOf(`${WHAT_FAILED_HEADING}\n`);
  if (at < 0) return false;
  const after = text.slice(at + WHAT_FAILED_HEADING.length + 1);
  return after.includes(summary.replace(/\n+$/u, "").trimStart());
}

/** The feedback names the plan and the record under `## References`. */
export function namesThePlanAndTheRecord(text: string, plan: string, record: string): boolean {
  const at = text.indexOf(`${REFERENCES_HEADING}\n`);
  if (at < 0) return false;
  const after = text.slice(at);
  return references(plan, record).every((line) => after.includes(line));
}
