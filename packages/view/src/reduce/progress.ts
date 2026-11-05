/**
 * T043 — the elapsed time of the run and the suggested seconds of the
 * supervision record (`packages/view/src/reduce/`; F129-FR-010, F129-FR-027).
 *
 * Both are DERIVED in the read model, never read from a clock: the time now is
 * a value the caller handed to `project`, and the supervision record is one of
 * the five observations (`contracts/observations.md`). The status line prints
 * the elapsed time as `el=<h>h<mm>m` (or `<m>m` below one hour, which the
 * renderer of `../line/` writes) and the suggested seconds as `next=<n>s`.
 */

/** The inputs of the elapsed time: the marks the fold settled. */
export type ElapsedInputs = {
  /** The time the run started: the first launch event of the stream. */
  readonly runStartedAt: string | null;
  /** The time the run ended, where an event states it. */
  readonly runEndedAt?: string | null;
  /** The time of the projection. */
  readonly now: string;
};

/**
 * F129-FR-010 — the elapsed time of the run, in whole seconds: from the first
 * launch to `now`, or to the end of the run where an event states it. A run
 * whose stream states no start has an elapsed time of 0; an unreadable
 * timestamp is never a negative number.
 */
export function elapsedSecondsOf(inputs: ElapsedInputs): number {
  const from = inputs.runStartedAt;
  if (from === null) return 0;
  const start = Date.parse(from);
  const end = Date.parse(inputs.runEndedAt ?? inputs.now);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

/**
 * F129-FR-027 — the seconds until the next reading that the supervision record
 * advises, printed as `next=<n>s`. The record is the observation of the caller
 * (`contracts/observations.md`); its `interval` is the advised number of
 * seconds. A record that states no whole interval advises nothing: the key is
 * left out of the line.
 */
export function suggestedSecondsOf(
  supervisionRecord: Readonly<Record<string, unknown>> | null,
): number | null {
  if (supervisionRecord === null) return null;
  const interval = supervisionRecord["interval"];
  if (typeof interval !== "number" || !Number.isFinite(interval) || interval < 0) return null;
  return Math.floor(interval);
}
