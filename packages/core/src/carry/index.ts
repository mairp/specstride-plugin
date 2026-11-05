/**
 * T067 of feature 103 — THE INDEX OF VERIFICATION OBLIGATIONS
 * (F103-FR-037, F103-SC-009).
 *
 * `index.ts` of this directory is the INDEX, not a re-export barrel: that is
 * what `./module.ts` says `plan.md` assigns to the name.
 *
 * ## What it is
 *
 * With the switch `carry.index` ON, the block of inherited verification
 * obligations in the PROPOSER'S prompt is replaced by an index that holds, per
 * obligation, three things and nothing else:
 *
 *  1. its id (`VO-` and 20 hexadecimal characters, F105-FR-011);
 *  2. its title CUT to `carry.indexTitleChars` characters — the same number in
 *     every pass of a run;
 *  3. the PATH of its full text, which CQ-069 settles as the verification plan
 *     for people, `feature:<slug>:verification:test-plan`.
 *
 * With the switch OFF the block is the baseline's: ONE LINE PER OBLIGATION,
 * so that the prompt can be compared in full.
 *
 * ## Two properties that are tested, not asserted
 *
 *  - It is a PURE FUNCTION of the verification plan. `tests/characterization/
 *    103/stable-start-and-index.test.ts` (CT-103-137) regenerates it from the
 *    plan and compares it with the stored one, which is F103-SC-009.
 *  - It reaches the PROPOSER'S prompt only. The critic's copy of the block is
 *    unchanged: `INDEX_REACHES_THE_CRITIC` is false, `criticBlockOf` returns
 *    the baseline's full block whatever the switch says, and the same test
 *    drives both sides.
 *
 * Boundary: `@specstride/kernel` for the one hash and nothing else
 * (F100-FR-012). No file is read here: the plan is handed in, so the function
 * is pure and a test can drive it.
 */
import { contentHash } from "@specstride/kernel/hasher";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-037", "F103-SC-009"] as const;

/** The switch of F103-FR-037; its value under the `parity` profile is off. */
export const SWITCH = "carry.index" as const;
export const SWITCH_DEFAULT_ON = true as const;
export const SWITCH_UNDER_PARITY_ON = false as const;

/**
 * `carry.indexTitleChars` — the length a title is cut to. `plan.md`, "Index":
 * "title cut to `carry.indexTitleChars` characters (starting value 80, low
 * confidence; experiment X3 of feature 115 may change it; THE SAME IN EVERY
 * PASS OF A RUN)". Row 60 of annex X §X.7 holds the key.
 */
export const INDEX_TITLE_CHARS_KEY = "carry.indexTitleChars" as const;
export const INDEX_TITLE_CHARS_DEFAULT = 80 as const;
export const INDEX_TITLE_CHARS_CONFIDENCE = "low" as const;

/** F103-FR-037 — the index appears in the proposer's prompt ONLY. */
export const INDEX_REACHES_THE_CRITIC = false as const;

/** F103-FR-037 — the index is a pure function of the verification plan. */
export const INDEX_IS_A_PURE_FUNCTION_OF_THE_PLAN = true as const;

/** CQ-069 — where the path of the full text of an obligation points. */
export const FULL_TEXT_LOGICAL_NAME = "feature:<slug>:verification:test-plan" as const;

/** The logical name of the full text for one feature slug. */
export function fullTextPathOf(slug: string): string {
  return FULL_TEXT_LOGICAL_NAME.replace("<slug>", slug);
}

/* ------------------------------------------------------------------ *
 * The plan, as much of it as the index reads.
 * ------------------------------------------------------------------ */

/**
 * One verification obligation, as much of the record of F105-FR-011 as the
 * index reads. `title` is the text of the criterion the obligation was made
 * from; where the plan carries it under another name the caller maps it.
 */
export type PlannedObligation = {
  readonly obligationId: string;
  readonly title: string;
  /** The rest of the record of F105-FR-011; the index never reads it. */
  readonly [field: string]: unknown;
};

/** As much of the verification plan of F105-FR-011 as the index reads. */
export type VerificationPlanForTheIndex = {
  readonly obligations: readonly PlannedObligation[];
  readonly [field: string]: unknown;
};

/** One entry of the index: the three things F103-FR-037 names. */
export type IndexEntry = {
  readonly obligationId: string;
  /** The title cut to `carry.indexTitleChars` characters. */
  readonly title: string;
  /** Whether the title was cut. */
  readonly cut: boolean;
  /** The path of the full text (CQ-069). */
  readonly fullText: string;
};

/** The index of a phase, with the parameters it was built under. */
export type ObligationIndex = {
  readonly entries: readonly IndexEntry[];
  readonly titleChars: number;
  readonly fullText: string;
  /** The hash of the rendered block, which `prompt.built` carries. */
  readonly hash: string;
};

/* ------------------------------------------------------------------ *
 * Building the index.
 * ------------------------------------------------------------------ */

/**
 * The title cut to `titleChars` characters. The cut is on CHARACTERS and from
 * the FRONT, so the same title and the same length always give the same bytes
 * — `carry.indexTitleChars` is "the same in every pass of a run", and that is
 * only worth anything if the cut is deterministic.
 */
export function cutTitle(title: string, titleChars: number): { title: string; cut: boolean } {
  const oneLine = title.replace(/[\r\n]+/g, " ").trim();
  if (titleChars <= 0) return { title: "", cut: oneLine.length > 0 };
  if (oneLine.length <= titleChars) return { title: oneLine, cut: false };
  return { title: oneLine.slice(0, titleChars), cut: true };
}

/**
 * F103-FR-037 — the index, a PURE FUNCTION of the verification plan.
 *
 * The order is the plan's own: `plan.md`, "Index" — "sorted as the plan sorts
 * its obligations". Nothing here sorts, so nothing here can disagree with the
 * plan about the order.
 */
export function buildObligationIndex(
  plan: VerificationPlanForTheIndex,
  slug: string,
  titleChars: number = INDEX_TITLE_CHARS_DEFAULT,
): ObligationIndex {
  const fullText = fullTextPathOf(slug);
  const entries = plan.obligations.map((obligation) => {
    const { title, cut } = cutTitle(obligation.title, titleChars);
    return Object.freeze({
      obligationId: obligation.obligationId,
      title,
      cut,
      fullText,
    });
  });
  const index: Omit<ObligationIndex, "hash"> = {
    entries: Object.freeze(entries),
    titleChars,
    fullText,
  };
  return Object.freeze({ ...index, hash: contentHash(renderIndex(index)) });
}

/** The heading of the index block in the proposer's prompt. */
export const INDEX_HEADING = "## Verification obligations (index)" as const;

/** One line of the index block. */
export function indexLine(entry: IndexEntry): string {
  return `- ${entry.obligationId} — ${entry.title} — full text: ${entry.fullText}`;
}

/** The index block as it stands in the proposer's prompt. */
export function renderIndex(index: Omit<ObligationIndex, "hash">): string {
  return [INDEX_HEADING, ...index.entries.map(indexLine)].join("\n");
}

/* ------------------------------------------------------------------ *
 * The switch off: the baseline's block, one line per obligation.
 * ------------------------------------------------------------------ */

/** The heading of the baseline's block of inherited verification obligations. */
export const BASELINE_HEADING = "## Verification obligations" as const;

/**
 * F103-FR-037, the switch OFF — "the block MUST be the baseline's, ONE LINE
 * PER OBLIGATION, so that the prompt is compared in full". The baseline cuts
 * no title and names no path: it prints the obligation.
 */
export function renderBaselineBlock(plan: VerificationPlanForTheIndex): string {
  return [
    BASELINE_HEADING,
    ...plan.obligations.map((o) => `- ${o.obligationId} — ${o.title}`),
  ].join("\n");
}

/**
 * The block of inherited verification obligations of the PROPOSER'S prompt:
 * the index with the switch on, the baseline's block with it off.
 */
export function proposerBlockOf(
  plan: VerificationPlanForTheIndex,
  slug: string,
  options: { readonly indexOn: boolean; readonly titleChars?: number } = { indexOn: true },
): string {
  if (!options.indexOn) return renderBaselineBlock(plan);
  return renderIndex(buildObligationIndex(plan, slug, options.titleChars));
}

/**
 * F103-FR-037 — the CRITIC'S copy of the block is UNCHANGED: the index never
 * reaches it, whatever the switch says. The argument is accepted and ignored
 * on purpose, so that a caller cannot pass the switch through to this side.
 */
export function criticBlockOf(
  plan: VerificationPlanForTheIndex,
  _options?: { readonly indexOn?: boolean },
): string {
  return renderBaselineBlock(plan);
}
