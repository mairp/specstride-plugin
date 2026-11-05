// Feature 117 (T059) — the window fitter of the critic prompt
// (F117-FR-023, F117-FR-024, F117-FR-025).
//
// The numbers are the as-is numbers of `data/budgets.json`:
//  - budget   = (window tokens − reply reserve of 8000) × 3.18 bytes
//  - order    = design context, grounding, phase evidence — the criteria
//               section is NEVER in it and never shrunk (B-1011, IR-22)
//  - floor    = a block is shrunk only above 4096 bytes and never below it
//  - marker   = `… [<label>: <n> bytes elided to fit the critic's context
//               window; this is a BUDGET elision, not missing content] …`
//               (the as-is `elision` literal), head AND tail kept
//  - stderr   = `critic prompt trimmed to fit the <N>-token window: <notes>`
//               and, still over, `STILL OVER by <n> B after shrinking <order>`
//
// The over-window switch (row 57, `prompt.critic.overWindow`): with the
// default `refuse` the call is NOT made and the outcome is the typed failure
// `context_window_exceeded`, scored as a failed critic call is scored; with
// the as-is value `send` the prompt goes out as it is (research D-6, DV-099).
//
// The known-window rule (F117-FR-025): a prompt is assembled only for a
// critic whose context window is KNOWN — from the capability of the harness
// port or from the consumer's setting. There is NO default window. Where the
// capability declares and reports two values that differ, the smaller is
// used; a window the consumer set wins over both.

import budgets from "../data/budgets.json" with { type: "json" };
import literals from "../data/as-is-literals.json" with { type: "json" };

/** `data/budgets.json`: the as-is numbers of the fitter. */
export const BUDGETS: Readonly<Record<string, number>> = Object.freeze(
  budgets as unknown as Record<string, number>,
);

/** Measured bytes per token of the baseline fleet (B-0918). */
export const BYTES_PER_TOKEN: number = BUDGETS.bytesPerToken;
/** The reply reserve of 8000 tokens (B-0920). */
export const REPLY_RESERVE_TOKENS: number = BUDGETS.replyReserveTokens;
/** A block is shrunk only above this and never below this (B-0921). */
export const SHRINK_FLOOR_BYTES: number = BUDGETS.shrinkFloorBytes;
/** The reference window the byte budgets were measured at. */
export const REFERENCE_WINDOW_TOKENS: number = BUDGETS.referenceWindowTokens;
/** The floor of a scaled cap (`_scaled_cap`). */
export const MIN_SCALED_BUDGET_BYTES: number = BUDGETS.minScaledBudgetBytes;

/** The as-is elision marker; `<label>` and `<n>` are substituted (B-0897). */
export const ELISION_MARKER_TEMPLATE: string = literals.elision ?? "";

/** The two values of the over-window switch (row 57). */
export const OVER_WINDOW_VALUES = ["refuse", "send"] as const;
export type OverWindow = (typeof OVER_WINDOW_VALUES)[number];

/** The typed failure of a refused over-window call (annex C §C.1). */
export const CONTEXT_WINDOW_EXCEEDED = "context_window_exceeded" as const;

/** The byte length of the prompt — what the window is actually spent on. */
export function promptBytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * The budget of a window: `(window − reply reserve) × bytes per token`, at
 * least one token's worth, as `fit_to_window` computes it (F117-FR-023).
 */
export function budgetBytes(windowTokens: number, reserve: number = REPLY_RESERVE_TOKENS): number {
  return Math.floor(Math.max(1, windowTokens - reserve) * BYTES_PER_TOKEN);
}

/** A reference byte budget scaled linearly to a window, never below the floor. */
export function scaledCap(
  referenceBytes: number,
  windowTokens: number,
  floorBytes: number = MIN_SCALED_BUDGET_BYTES,
): number {
  return Math.max(
    floorBytes,
    Math.round((referenceBytes * windowTokens) / REFERENCE_WINDOW_TOKENS),
  );
}

/**
 * Keep the head AND the tail of a block, cut to `maxBytes`, with the as-is
 * elision marker between them (F117-FR-023). A block at or under the limit
 * comes back unchanged.
 */
export function elideMiddle(text: string, maxBytes: number, label: string): string {
  const raw = Buffer.from(text, "utf8");
  if (raw.length <= maxBytes) return text;
  const keep = Math.max(1024, Math.floor(maxBytes / 2) - 256);
  const head = raw.subarray(0, keep).toString("utf8");
  const tail = raw.subarray(raw.length - keep).toString("utf8");
  const marker = ELISION_MARKER_TEMPLATE.replace("<label>", label).replace(
    "<n>",
    String(raw.length - 2 * keep),
  );
  return `${head}\n\n${marker}\n\n${tail}`;
}

/** The fitting input: the shrinkable blocks by their as-is label and a builder. */
export type FitToWindowInput = {
  /**
   * Build the full prompt from the (possibly shrunk) blocks, exactly as the
   * baseline passes its `build` callback: the fitter rebuilds after every
   * shrink, so the prompt always exists as a whole.
   */
  readonly build: (blocks: Readonly<Record<string, string>>) => string;
  /** The blocks by label, in the as-is spelling the stderr line shows. */
  readonly blocks: Readonly<Record<string, string>>;
  /** The order of shrinking, least load-bearing first (never `criteria`). */
  readonly order: readonly string[];
  /** The window in force (known; F117-FR-025). */
  readonly windowTokens: number;
  /** The reply reserve; the as-is default is 8000. */
  readonly reserve?: number | undefined;
};

/** One shrink that happened: the label, the old bytes, the new bytes. */
export type ShrinkNote = {
  readonly label: string;
  readonly before: number;
  readonly after: number;
  /** The as-is note text: `<label> <old>-><new> B`. */
  readonly note: string;
};

/** What the fitter returns. */
export type FitResult = {
  /** The fitted prompt. */
  readonly prompt: string;
  /** Every shrink in order, then, still over, the over note. */
  readonly notes: readonly string[];
  /** The structured shrinks, for `prompt.built` (F117-FR-028). */
  readonly shrunk: readonly ShrinkNote[];
  /** True when the prompt is still over the budget after every block. */
  readonly stillOver: boolean;
  /** The over note: `STILL OVER by <n> B after shrinking <order>`. */
  readonly overNote: string | undefined;
  /** The budget the prompt was fitted against. */
  readonly budget: number;
};

/**
 * Shrink the blocks of the order, least load-bearing first, until the whole
 * prompt fits the budget (F117-FR-023). A block is shrunk only when it is
 * larger than the 4096-byte floor and never below it. The criteria section is
 * deliberately never in the order.
 */
export function fitToWindow(input: FitToWindowInput): FitResult {
  const budget = budgetBytes(input.windowTokens, input.reserve);
  const blocks: Record<string, string> = { ...input.blocks };
  const notes: string[] = [];
  const shrunk: ShrinkNote[] = [];
  let prompt = input.build(blocks);
  for (const label of input.order) {
    const over = promptBytes(prompt) - budget;
    if (over <= 0) break;
    const current = blocks[label] ?? "";
    const size = promptBytes(current);
    let target = size - over;
    if (target >= size || size <= SHRINK_FLOOR_BYTES) continue;
    target = Math.max(SHRINK_FLOOR_BYTES, target);
    blocks[label] = elideMiddle(current, target, label);
    const note = `${label} ${size}->${target} B`;
    notes.push(note);
    shrunk.push({ label, before: size, after: target, note });
    prompt = input.build(blocks);
  }
  const overBytes = promptBytes(prompt) - budget;
  const stillOver = overBytes > 0;
  const order = input.order.join(",");
  const overNote = stillOver ? `STILL OVER by ${overBytes} B after shrinking ${order}` : undefined;
  if (stillOver) notes.push(overNote!);
  return { prompt, notes, shrunk, stillOver, overNote, budget };
}

/**
 * The as-is line on standard error when a block was shrunk (B-0897):
 * `critic prompt trimmed to fit the <N>-token window: <note>; <note>`.
 * Undefined when nothing was shrunk and nothing is over.
 */
export function trimStderrLine(windowTokens: number, notes: readonly string[]): string | undefined {
  if (notes.length === 0) return undefined;
  return `critic prompt trimmed to fit the ${windowTokens}-token window: ${notes.join("; ")}`;
}

/* ------------------------------------------------------------------ *
 * The known-window rule (F117-FR-025).
 * ------------------------------------------------------------------ */

/** The source of the window in force. */
export type WindowSource = "consumer" | "capability" | undefined;

/** What the known-window rule returns. */
export type KnownWindow = {
  /** True only when a window is known; no prompt is assembled otherwise. */
  readonly known: boolean;
  /** The window in force, in tokens. */
  readonly windowTokens: number | undefined;
  /** Where the window came from: the consumer's setting or the capability. */
  readonly source: WindowSource;
};

/**
 * The known-window rule. The consumer's setting wins over both values of the
 * capability; where the capability declares and reports two values that
 * differ, the smaller is used; with no known value there is NO window, no
 * default, and no prompt is assembled.
 */
export function knownWindow(values: {
  readonly consumerTokens?: number | undefined;
  readonly declaredTokens?: number | undefined;
  readonly effectiveTokens?: number | undefined;
}): KnownWindow {
  if (values.consumerTokens !== undefined) {
    return { known: true, windowTokens: values.consumerTokens, source: "consumer" };
  }
  const candidates = [values.declaredTokens, values.effectiveTokens].filter(
    (t): t is number => typeof t === "number",
  );
  if (candidates.length === 0) {
    return { known: false, windowTokens: undefined, source: undefined };
  }
  return { known: true, windowTokens: Math.min(...candidates), source: "capability" };
}

/** What follows a prompt that is still over the budget (F117-FR-024). */
export type OverWindowDecision =
  | { readonly action: "send" }
  | {
      readonly action: "refuse";
      /** The typed failure of the refused call. */
      readonly outcome: typeof CONTEXT_WINDOW_EXCEEDED;
      /** The note on standard error. */
      readonly overNote: string;
    };

/**
 * The over-window switch. With `send` (the as-is value, the value under
 * `parity`) the prompt goes out as it is; with `refuse` (the default) the
 * call is not made and the outcome is the typed failure
 * `context_window_exceeded`.
 */
export function decideOverWindow(mode: OverWindow, overNote: string): OverWindowDecision {
  return mode === "send"
    ? { action: "send" }
    : { action: "refuse", outcome: CONTEXT_WINDOW_EXCEEDED, overNote };
}
