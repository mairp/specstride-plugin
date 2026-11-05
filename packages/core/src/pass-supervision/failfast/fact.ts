/**
 * T062 of feature 118 — the row for the critic's fact block (F118-FR-040;
 * CT-118-6).
 *
 * What a result file of a job says is a claim and never a check result.
 * When a phase attempt holds a job that the runtime stopped, the fact block
 * for the critic holds, in `facts`, the member "a cited result file that
 * belongs to a stopped job" — by KIND, and without counts: no line number,
 * no step, no number of matched lines, no number of anything. Grounding
 * never changes the state of a check because of what a result file says.
 */

/** The member text of the fact (F118-FR-040, verbatim). */
export const STOPPED_JOB_FACT = "a cited result file that belongs to a stopped job" as const;

/** The kind of the fact, as the block records it (a kind, never a count). */
export const STOPPED_JOB_FACT_KIND = "stopped-job-result-file" as const;

/** One member of the fact block: a kind and its text, no counters. */
export interface FactMember {
  readonly kind: typeof STOPPED_JOB_FACT_KIND;
  readonly fact: typeof STOPPED_JOB_FACT;
}

/**
 * The rows the fact block gains because a job of the phase attempt was
 * stopped by the runtime (F118-FR-040). An empty list when no job was
 * stopped: the critic is told nothing that is not true of this attempt.
 */
export function stoppedJobFactRows(input: { readonly stoppedJob: boolean }): readonly FactMember[] {
  return input.stoppedJob ? [{ kind: STOPPED_JOB_FACT_KIND, fact: STOPPED_JOB_FACT }] : [];
}

/**
 * The full fact block for the critic: the stopped-job row of F118-FR-040
 * added to the rows the caller already holds. The block carries kinds only;
 * any caller that passes counts in gets them back unchanged, and this module
 * adds none.
 */
export function factBlock(
  existing: readonly string[],
  input: { readonly stoppedJob: boolean },
): readonly string[] {
  return input.stoppedJob ? [...existing, STOPPED_JOB_FACT] : existing;
}

/**
 * Grounding never changes the state of a check because of what a result
 * file says (F118-FR-040): the fact block is data for the critic's prompt,
 * and answers no check. This constant is the closed answer of the module.
 */
export const FACT_BLOCK_CHANGES_NO_CHECK = false as const;
