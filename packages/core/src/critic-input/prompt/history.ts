// Feature 117 (T058) — the rejection history of the DIAGNOSTICIAN
// (F117-FR-022).
//
// The prompt of the diagnostician carries the rejection history of the phase
// as at the baseline (`run_diagnostician` of `lib/critic.py` at `9cab15d`):
// the feedback of every archived phase attempt of the phase in sorted order of
// their names, each under `--- <name> ---`, then the current feedback under
// `--- latest (attempt <M>) ---`, and `(no prior rejection recorded)` where
// there is none. The history is capped at 120000 bytes scaled by the window
// (the same linear scaling as `_scaled_cap`, floor 65536), with head and tail
// kept and the as-is elision marker of `fit.ts`.
//
// The prompt of the CRITIC carries NONE of this: `assemble.ts` has no
// parameter that could take a history, and PT-117-C-066-rejection-history
// holds that a critic prompt built with the history text in the workspace
// does not contain it.

import budgets from "../data/budgets.json" with { type: "json" };
import literals from "../data/as-is-literals.json" with { type: "json" };
import { elideMiddle, scaledCap } from "./fit.ts";

/** `data/budgets.json`: the as-is numbers this module uses. */
export const BUDGETS: Readonly<Record<string, number>> = Object.freeze(
  budgets as unknown as Record<string, number>,
);

/** The as-is reference cap of the history, before scaling (B-0919). */
export const HISTORY_CAP_BYTES: number = BUDGETS.historyCapBytes;

/** The line the diagnostician sees with no rejection at all (B-0964, as-is). */
export const NO_PRIOR_REJECTION: string = literals.historyNone ?? "(no prior rejection recorded)";

/** One archived feedback of the phase, under its attempt-directory name. */
export type HistoryEntry = {
  /** The name of the archived attempt directory, sorted as the baseline sorts it. */
  readonly name: string;
  /** The feedback text of that attempt. */
  readonly feedback: string;
};

/** What the history builder is given. */
export type RejectionHistoryInput = {
  /** The archived attempts of the phase; sorted by name before rendering. */
  readonly entries?: readonly HistoryEntry[] | undefined;
  /** The current feedback, under `--- latest (attempt <M>) ---`. */
  readonly current?: { readonly attempt: number; readonly feedback: string } | undefined;
};

/**
 * The rejection history text, in the order and the form of the baseline
 * (F117-FR-022): `--- <name> ---` per archived attempt, sorted by name, then
 * `--- latest (attempt <M>) ---`, joined with a blank line, or the as-is
 * `(no prior rejection recorded)` line where there is none.
 */
export function buildRejectionHistory(input: RejectionHistoryInput): string {
  const parts: string[] = [];
  const sorted = [...(input.entries ?? [])].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of sorted) {
    parts.push(`--- ${entry.name} ---\n${entry.feedback}`);
  }
  if (input.current !== undefined) {
    parts.push(`--- latest (attempt ${input.current.attempt}) ---\n${input.current.feedback}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : NO_PRIOR_REJECTION;
}

/**
 * The scaled cap of the history for a window: the reference cap scaled
 * linearly to the window, never below the 65536-byte floor
 * (`_scaled_cap`, F117-FR-022).
 */
export function historyCapForWindow(windowTokens: number): number {
  return scaledCap(HISTORY_CAP_BYTES, windowTokens);
}

/**
 * The history block the diagnostician prompt carries: the history text, kept
 * under the scaled cap with head and tail and the as-is elision marker
 * labelled `rejection history`.
 */
export function diagnosticianHistoryBlock(
  input: RejectionHistoryInput,
  windowTokens: number,
): string {
  return elideMiddle(
    buildRejectionHistory(input),
    historyCapForWindow(windowTokens),
    "rejection history",
  );
}
