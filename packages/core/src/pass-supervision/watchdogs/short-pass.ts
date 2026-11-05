/**
 * T031 of feature 118 — the short-pass counter, the nudge block and the
 * checkpoint exemptions (F118-FR-012, F118-FR-013; C-057, C-058; B-0651,
 * B-0779, B-0780; R23v V-14, IR-48; DV-013).
 *
 * A pass that ends clean in under 180 seconds with no phase evidence and no
 * yield counts as short; any other such pass resets the counter to 0. When
 * the counter reaches 2 the next prompt carries the nudge block, which
 * prints the yield artifact path and a sample `specstride-pass-yield/v1`
 * document. Nothing halts on it and the counter keeps growing.
 *
 * F118-FR-013 — a pass that ends at a valid checkpoint leaves the
 * short-pass counter, the error counter and the counter of consecutive
 * hard-cap kills as they were, neither raised nor reset, as a yield does;
 * the test of no progress still applies. The engine, not the layer, carries
 * out both exemptions when a loop layer returns the directives
 * `exemptShortPass` and `exemptRepeatCounter`; neither can occur when the
 * layer is off. The exact argument lists of the inner check set are exempt
 * from the process-level repetition count; the tool-level count is unchanged.
 */

/** The short-pass period, in seconds (F118-FR-014). */
export const SHORT_PASS_SEC_DEFAULT = 180;

/** After how many short passes in a row the nudge is shown (0 disables). */
export const SHORT_PASS_NUDGE_AFTER_DEFAULT = 2;

/** The directives a loop layer may return (F118-FR-013). */
export interface LoopLayerDirectives {
  readonly exemptShortPass?: boolean | undefined;
  readonly exemptRepeatCounter?: boolean | undefined;
}

/** The directives a layer that is OFF returns: neither can occur. */
export const NO_DIRECTIVES: LoopLayerDirectives = Object.freeze({});

/**
 * The directives in force for this pass: the engine reads them from the loop
 * layer only when the layer is on; a layer that is off can return neither.
 */
export function directivesForLayer(
  layerOn: boolean,
  returned: LoopLayerDirectives,
): LoopLayerDirectives {
  if (!layerOn) return NO_DIRECTIVES;
  return returned;
}

/** The verdict on one ended pass. */
export interface ShortPassVerdict {
  readonly short: boolean;
  /** The counters after the pass, per F118-FR-012 and F118-FR-013. */
  readonly shortConsec: number;
  readonly errorCount: number;
  readonly capConsec: number;
}

/** The counters as they were before the pass (used by the checkpoint exemption). */
export interface PassCounters {
  readonly shortConsec: number;
  readonly errorCount: number;
  readonly capConsec: number;
}

/**
 * Account one ended clean pass (F118-FR-012, F118-FR-013).
 *
 * - a valid checkpoint (`checkpoint`) leaves every counter as it was;
 * - a short pass (clean, under the period, no phase evidence, no yield)
 *   raises the short-pass counter;
 * - any other such pass resets the short-pass counter to 0;
 * - the nudge is due when the counter reaches the nudge-after (0 disables).
 */
export function accountEndedPass(input: {
  counters: PassCounters;
  endedClean: boolean;
  elapsedSec: number;
  hasPhaseEvidence: boolean;
  hasYield: boolean;
  checkpoint?: boolean | undefined;
  shortPassSec?: number | undefined;
  nudgeAfter?: number | undefined;
  directives?: LoopLayerDirectives | undefined;
}): ShortPassVerdict {
  const shortPassSec = input.shortPassSec ?? SHORT_PASS_SEC_DEFAULT;
  const _nudgeAfter = input.nudgeAfter ?? SHORT_PASS_NUDGE_AFTER_DEFAULT;
  const directives = input.directives ?? NO_DIRECTIVES;

  // F118-FR-013: a pass that ends at a valid checkpoint leaves the counters
  // as they were — neither raised nor reset (as a yield does). The
  // short-pass counter is left even when the directive `exemptShortPass`
  // does not name it: the exemption of a checkpoint is unconditional.
  // F118-FR-013: "as a yield does" — a pass that ends at a valid yield
  // leaves the counters as they were, too.
  if (input.checkpoint === true || (input.hasYield && input.endedClean)) {
    return { short: false, ...input.counters };
  }

  const short =
    input.endedClean &&
    input.elapsedSec < shortPassSec &&
    !input.hasPhaseEvidence &&
    !input.hasYield;

  const shortConsec = directives.exemptShortPass
    ? input.counters.shortConsec
    : short
      ? input.counters.shortConsec + 1
      : 0;

  return {
    short,
    shortConsec,
    errorCount: input.counters.errorCount,
    capConsec: input.counters.capConsec,
  };
}

/** True when the next prompt must carry the nudge block (F118-FR-012). */
export function nudgeDue(shortConsec: number, nudgeAfter?: number): boolean {
  const after = nudgeAfter ?? SHORT_PASS_NUDGE_AFTER_DEFAULT;
  return after > 0 && shortConsec >= after;
}

/** The component line of a short pass (rule N-15; F118-FR-030). */
export function shortPassLine(passIndex: number, elapsedSec: number, consec: number): string {
  return (
    `pass ${passIndex} ended after ${elapsedSec}s with no evidence and no yield — ` +
    `${consec} short passes in a row; the next pass is told to yield instead of waiting.`
  );
}

/** A sample yield document printed inside the nudge block. */
export function sampleYieldDocument(deadlineSec: number): string {
  return [
    "```json",
    JSON.stringify(
      {
        contract: "specstride-pass-yield/v1",
        reason: "the long verification step is running; nothing to do until it ends",
        job: { mode: "launch", argv: ["/usr/bin/make", "live"], cwd: "." },
        resume_when: { kind: "exit_code_file" },
        deadline_sec: deadlineSec,
        on_resume: "read the job result and continue the phase",
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}

/**
 * The nudge block of the next prompt (F118-FR-012): headed
 * `## You have ended <n> passes in a row within <sec>s without evidence`,
 * printing the yield artifact path and a sample `specstride-pass-yield/v1`
 * document. Nothing halts on it.
 */
export function shortPassNudgeBlock(input: {
  consec: number;
  shortPassSec: number;
  yieldPath: string;
  deadlineSec: number;
}): string {
  const lines = [
    `## You have ended ${input.consec} passes in a row within ${input.shortPassSec}s without evidence`,
    "",
    `Write a yield artifact to ${input.yieldPath} and end the pass instead of waiting:`,
    "",
    sampleYieldDocument(input.deadlineSec),
  ];
  return lines.join("\n");
}
