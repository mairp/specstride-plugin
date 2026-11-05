/**
 * T066 of feature 103 — LISA'S CONTEXT POLICY, extracted (F103-FR-035).
 *
 * Source: Lisa `packages/core/src/engine/proposer-context.ts` at `363e6a3`,
 * MIT-licensed and so MIT-compatible with this repository (`LICENSE`); the
 * reuse audit R1 lists it under **Extract**
 * (`docs/ecosystem/research/R1-lisa-reuse-audit.md`, row `core`), and R15
 * records that it "becomes the first implementation behind EP-15"
 * (`docs/ecosystem/research/R15-ecosystem-architecture.md:520`). Lisa's own
 * source tree is NOT in this repository: what is recorded here is the policy
 * as `specs/103-proposer-pass/spec.md` F103-FR-035 states it and as
 * `plan.md` fixes its one new constant, and the characterization test
 * `tests/characterization/103/lisa-context.test.ts` (CT-103-135) measures this
 * module against those records rather than against prose.
 *
 * ## The policy in one paragraph
 *
 * Six sources. Two of them — the FIXED INSTRUCTIONS and the PHASE — are
 * IMMUTABLE: they are never cut and never dropped. When those two alone
 * exceed the INPUT BUDGET (the context window less the reserve kept for tools
 * and output) the pass is REFUSED with an error that names the required size,
 * the input budget and the model. The other four are admitted in one fixed
 * order — feedback, progress, optional context, history — each up to a cap of
 * its own, and every contribution is recorded with its original and its
 * included size, its hash, and whether it was cut or dropped.
 *
 * ## The window of the harness, in tokens, converted to characters
 *
 * The harness declares its context window in TOKENS (annex C §C.2, record
 * `models`); Lisa's caps are in CHARACTERS. `plan.md` fixes the conversion:
 * "Starting ratio 4 characters per token, a constant of `context-policy.ts`
 * with low confidence". `CHARACTERS_PER_TOKEN` below is that constant. The
 * window taken is the SMALLER of the declared and the effective value
 * (F100-FR-077). Where the harness gives no window the starting value of
 * 160,000 CHARACTERS is used and `prompt.built` records that the window is
 * unknown — `windowIsKnown: false`.
 *
 * Boundary: `@specstride/kernel` for the one hash, nothing else
 * (F100-FR-012). No file is read here: every source is handed in as text, so
 * the policy is a pure function and a test can drive it.
 */
import { contentHash } from "@specstride/kernel/hasher";

/** The requirement this module carries out. */
export const REQUIREMENTS = ["F103-FR-035"] as const;

/** Where the policy was extracted from, and under which licence. */
export const SOURCE = "Lisa packages/core/src/engine/proposer-context.ts" as const;
export const SOURCE_REVISION = "363e6a3" as const;
export const SOURCE_LICENCE = "MIT" as const;
export const SOURCE_IS_MIT_COMPATIBLE = true as const;

/** F103-FR-035 — under the block set `as-is` none of this applies. */
export const APPLIES_UNDER_THE_BLOCK_SET = "current" as const;

/* ------------------------------------------------------------------ *
 * The six sources.
 * ------------------------------------------------------------------ */

/**
 * The six sources the policy treats, in the order F103-FR-035 names them.
 * The first two are immutable; the last four are the admitted ones, in the
 * order they are admitted.
 */
export const SOURCES = [
  "fixedInstructions",
  "phase",
  "feedback",
  "progress",
  "optionalContext",
  "history",
] as const;
export type ContextSource = (typeof SOURCES)[number];

/** F103-FR-035 — the two sources that are never truncated. */
export const IMMUTABLE_SOURCES = ["fixedInstructions", "phase"] as const;
export type ImmutableSource = (typeof IMMUTABLE_SOURCES)[number];

/** F103-FR-035 — the fixed order in which the other four are admitted. */
export const ADMISSION_ORDER = ["feedback", "progress", "optionalContext", "history"] as const;
export type AdmittedSource = (typeof ADMISSION_ORDER)[number];

/** Whether a source is one of the two that are never cut. */
export function isImmutable(source: ContextSource): source is ImmutableSource {
  return (IMMUTABLE_SOURCES as readonly string[]).includes(source);
}

/* ------------------------------------------------------------------ *
 * The starting values — "those of the extracted code" (F103-FR-035).
 * ------------------------------------------------------------------ */

/** The context window, in CHARACTERS, where the harness declares none. */
export const DEFAULT_CONTEXT_WINDOW_CHARS = 160_000 as const;

/** The reserve kept for tools and output, in CHARACTERS. */
export const RESERVE_CHARS = 32_000 as const;

/** The cap of each admitted source, in CHARACTERS. */
export const CAPS: Readonly<Record<AdmittedSource, number>> = Object.freeze({
  feedback: 16_000,
  progress: 12_000,
  optionalContext: 24_000,
  history: 8_000,
});

/**
 * `plan.md`, "Context window in characters": the harness gives the window in
 * tokens and the caps are in characters, so the window is converted at this
 * ratio. Starting value 4, LOW CONFIDENCE, a constant of this file.
 */
export const CHARACTERS_PER_TOKEN = 4 as const;
export const CHARACTERS_PER_TOKEN_CONFIDENCE = "low" as const;

/** F103-FR-035 — the character budget is the window less the reserve. */
export function inputBudgetChars(windowChars: number): number {
  return Math.max(0, windowChars - RESERVE_CHARS);
}

/* ------------------------------------------------------------------ *
 * The window of the harness.
 * ------------------------------------------------------------------ */

/**
 * What the harness declares about its context window. Both values are in
 * TOKENS, as annex C §C.2 gives them; either may be absent.
 */
export type HarnessWindow = {
  /** The window the descriptor declares, in tokens. */
  readonly declaredTokens?: number | undefined;
  /** The window observed to be in effect, in tokens. */
  readonly effectiveTokens?: number | undefined;
  /** The model the window belongs to, named in the refusal of F103-FR-035. */
  readonly model?: string | undefined;
};

/** The window as the policy uses it, with everything `prompt.built` records. */
export type ResolvedWindow = {
  /** The window in TOKENS, or `undefined` where the harness gives none. */
  readonly windowTokens: number | undefined;
  /** The ratio used to convert tokens to characters. */
  readonly charactersPerToken: number;
  /** The window in CHARACTERS. */
  readonly windowChars: number;
  /** The character budget: the window less the reserve. */
  readonly budgetChars: number;
  /** F103-FR-035 — false where the harness gave no window. */
  readonly windowIsKnown: boolean;
  /** The model, where the harness named one. */
  readonly model: string | undefined;
};

/**
 * F100-FR-077 and F103-FR-035 — the window is the SMALLER of the declared and
 * the effective value, converted to characters at `CHARACTERS_PER_TOKEN`.
 * Where the harness gives neither, the starting value of 160,000 CHARACTERS
 * stands and `windowIsKnown` is false, which is what `prompt.built` records.
 */
export function resolveWindow(window: HarnessWindow | undefined): ResolvedWindow {
  const declared = positiveOrUndefined(window?.declaredTokens);
  const effective = positiveOrUndefined(window?.effectiveTokens);
  const both = [declared, effective].filter((v): v is number => v !== undefined);
  if (both.length === 0) {
    return Object.freeze({
      windowTokens: undefined,
      charactersPerToken: CHARACTERS_PER_TOKEN,
      windowChars: DEFAULT_CONTEXT_WINDOW_CHARS,
      budgetChars: inputBudgetChars(DEFAULT_CONTEXT_WINDOW_CHARS),
      windowIsKnown: false,
      model: window?.model,
    });
  }
  const windowTokens = Math.min(...both);
  const windowChars = windowTokens * CHARACTERS_PER_TOKEN;
  return Object.freeze({
    windowTokens,
    charactersPerToken: CHARACTERS_PER_TOKEN,
    windowChars,
    budgetChars: inputBudgetChars(windowChars),
    windowIsKnown: true,
    model: window?.model,
  });
}

function positiveOrUndefined(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/* ------------------------------------------------------------------ *
 * The deterministic compaction of progress.
 * ------------------------------------------------------------------ */

/** The marker a compaction of progress leaves where it cut. */
export const COMPACTION_MARKER = "[... earlier notes compacted ...]" as const;

/**
 * F103-FR-035 — "Progress from the notebook MUST be compacted
 * deterministically to its cap and MUST keep the NEWEST notes."
 *
 * Deterministic means: the same text and the same cap always give the same
 * bytes, with no clock, no random value and no ordering of a map in it. The
 * text is cut at a LINE boundary from the END, so the newest notes — the ones
 * at the end of a notebook — are the ones kept, and the marker says that
 * earlier notes were dropped. Where even one whole line does not fit, the
 * last `cap` characters are kept, so the result is never empty while the cap
 * is above zero.
 */
export function compactProgress(text: string, cap: number): string {
  if (cap <= 0) return "";
  if (text.length <= cap) return text;
  const lines = text.split("\n");
  const kept: string[] = [];
  let size = COMPACTION_MARKER.length + 1; // the marker and its line end
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] as string;
    const cost = line.length + 1;
    if (size + cost > cap) break;
    kept.unshift(line);
    size += cost;
  }
  if (kept.length === 0) return text.slice(text.length - cap);
  return `${COMPACTION_MARKER}\n${kept.join("\n")}`;
}

/* ------------------------------------------------------------------ *
 * One contribution and the whole result.
 * ------------------------------------------------------------------ */

/** What was done with one source. */
export const DISPOSITIONS = ["included", "cut", "dropped"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** The record of one source, as F103-FR-035 asks for it. */
export type Contribution = {
  readonly source: ContextSource;
  /** The size of the source as it was handed in, in characters. */
  readonly originalChars: number;
  /** The size that was admitted, in characters. */
  readonly includedChars: number;
  /** The hash of the text that was admitted. */
  readonly hash: string;
  readonly cut: boolean;
  readonly dropped: boolean;
  readonly disposition: Disposition;
  /** The cap that governed it, where one did. */
  readonly cap?: number;
  /** The text that was admitted, in the order of `SOURCES`. */
  readonly text: string;
};

/** The text of each source; an absent source is an empty one. */
export type ContextSources = Partial<Readonly<Record<ContextSource, string>>>;

/** The error F103-FR-035 asks for when the immutable sources alone are too big. */
export class ImmutablePromptOverBudgetError extends Error {
  readonly requiredChars: number;
  readonly budgetChars: number;
  readonly model: string;
  constructor(requiredChars: number, budgetChars: number, model: string | undefined) {
    const named = model ?? "unknown";
    super(
      `the fixed instructions and the phase need ${requiredChars} characters, ` +
        `which is over the input budget of ${budgetChars} characters of the model ${named}`,
    );
    this.name = "ImmutablePromptOverBudgetError";
    this.requiredChars = requiredChars;
    this.budgetChars = budgetChars;
    this.model = named;
  }
}

/** Everything the policy decided, and everything `prompt.built` records of it. */
export type ContextPolicyResult = {
  /** One record per source of `SOURCES`, in that order. */
  readonly contributions: readonly Contribution[];
  /** The window, the ratio and the character budget, for `prompt.built`. */
  readonly window: ResolvedWindow;
  /** The characters admitted in total. */
  readonly totalChars: number;
  /** The caps as they stood, for `prompt.built`. */
  readonly caps: Readonly<Record<AdmittedSource, number>>;
  /** The reserve kept for tools and output. */
  readonly reserveChars: number;
};

/**
 * F103-FR-035 — the whole policy.
 *
 * `promptMaxBytes` is the budget of F103-FR-033: "The budget of F103-FR-033
 * and these caps MUST both hold; the smaller governs." A value of 0 disables
 * that budget, as F103-FR-033 says, and then the character budget alone
 * governs.
 */
export function applyContextPolicy(
  sources: ContextSources,
  options: {
    readonly window?: HarnessWindow | undefined;
    readonly promptMaxBytes?: number | undefined;
    readonly caps?: Partial<Readonly<Record<AdmittedSource, number>>> | undefined;
  } = {},
): ContextPolicyResult {
  const window = resolveWindow(options.window);
  const caps: Readonly<Record<AdmittedSource, number>> = Object.freeze({
    ...CAPS,
    ...(options.caps ?? {}),
  });

  // "The budget of F103-FR-033 and these caps MUST both hold; the smaller
  // governs." 0 disables the byte budget (F103-FR-033).
  const promptMax = options.promptMaxBytes;
  const governing =
    promptMax !== undefined && promptMax > 0
      ? Math.min(window.budgetChars, promptMax)
      : window.budgetChars;

  const fixed = sources.fixedInstructions ?? "";
  const phase = sources.phase ?? "";
  const required = fixed.length + phase.length;
  if (required > governing) {
    throw new ImmutablePromptOverBudgetError(required, governing, window.model);
  }

  const contributions: Contribution[] = [
    immutableContribution("fixedInstructions", fixed),
    immutableContribution("phase", phase),
  ];

  let assembled = required;
  for (const source of ADMISSION_ORDER) {
    const cap = caps[source];
    const original = sources[source] ?? "";
    const room = Math.max(0, Math.min(cap, governing - assembled));
    let text: string;
    if (source === "progress") {
      text = original.length <= room ? original : compactProgress(original, room);
    } else {
      text = original.length <= room ? original : original.slice(0, room);
    }
    const dropped = original.length > 0 && text.length === 0;
    const cut = !dropped && text.length < original.length;
    contributions.push(
      Object.freeze({
        source,
        originalChars: original.length,
        includedChars: text.length,
        hash: contentHash(text),
        cut,
        dropped,
        disposition: dropped
          ? ("dropped" as const)
          : cut
            ? ("cut" as const)
            : ("included" as const),
        cap,
        text,
      }),
    );
    assembled += text.length;
  }

  return Object.freeze({
    contributions: Object.freeze(contributions),
    window,
    totalChars: assembled,
    caps,
    reserveChars: RESERVE_CHARS,
  });
}

function immutableContribution(source: ImmutableSource, text: string): Contribution {
  return Object.freeze({
    source,
    originalChars: text.length,
    includedChars: text.length,
    hash: contentHash(text),
    cut: false,
    dropped: false,
    disposition: "included" as const,
    text,
  });
}

/** The part of `prompt.built` this policy owns (F103-FR-035). */
export type ContextPolicyRecord = {
  readonly policy: typeof SOURCE;
  readonly sourceRevision: typeof SOURCE_REVISION;
  readonly windowTokens: number | undefined;
  readonly charactersPerToken: number;
  readonly windowChars: number;
  readonly budgetChars: number;
  readonly windowIsKnown: boolean;
  readonly model: string | undefined;
  readonly reserveChars: number;
  readonly caps: Readonly<Record<AdmittedSource, number>>;
  readonly contributions: readonly Omit<Contribution, "text">[];
};

/** The record of the policy for `prompt.built`; the texts are left out of it. */
export function contextPolicyRecord(result: ContextPolicyResult): ContextPolicyRecord {
  return Object.freeze({
    policy: SOURCE,
    sourceRevision: SOURCE_REVISION,
    windowTokens: result.window.windowTokens,
    charactersPerToken: result.window.charactersPerToken,
    windowChars: result.window.windowChars,
    budgetChars: result.window.budgetChars,
    windowIsKnown: result.window.windowIsKnown,
    model: result.window.model,
    reserveChars: result.reserveChars,
    caps: result.caps,
    contributions: Object.freeze(
      result.contributions.map(({ text: _text, ...rest }) => Object.freeze({ ...rest })),
    ),
  });
}
