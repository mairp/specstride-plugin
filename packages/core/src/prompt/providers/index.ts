/**
 * T065 of feature 103 — the provider of the INDEX OF VERIFICATION OBLIGATIONS
 * (F103-FR-030, F103-FR-037).
 *
 * The second of the nine shipped providers. It carries into the prompt what
 * `../../carry/index.ts` builds: with the switch `carry.index` ON the index —
 * id, title cut to `carry.indexTitleChars`, path of the full text — and with
 * the switch OFF the baseline's block, one line per obligation.
 *
 * The provider adds nothing of its own to the decision. It is a thin seam so
 * that the index reaches the prompt through EP-15 like every other block, and
 * so that `prompt.built` carries its id, bytes and hash. The behaviour, and
 * the proof that it is a pure function of the plan, are the index module's.
 *
 * F103-FR-037 — it appears in the PROPOSER'S prompt only; there is no critic
 * side of this provider, and `../../carry/index.ts` `criticBlockOf` is what
 * the critic's own assembler (feature 117) reads.
 */
import {
  INDEX_TITLE_CHARS_DEFAULT,
  proposerBlockOf,
  type VerificationPlanForTheIndex,
} from "../../carry/index.ts";
import { blockOf } from "../assembler.ts";
import type {
  Block,
  PassContext,
  PromptBlockProvider,
} from "@specstride/contracts/ep/prompt-block";

/** The id of the block. */
export const BLOCK_ID = "verification_obligations" as const;
export const WRITER = "core/prompt/providers/index" as const;

/** F103-FR-037 — the block reaches the proposer's prompt only. */
export const REACHES_THE_CRITIC = false as const;

/** The size the provider declares; a longer index is cut and recorded. */
export const DECLARED_SIZE = 40_000 as const;

/** What the provider is given. */
export type IndexInput = {
  readonly plan?: VerificationPlanForTheIndex | undefined;
  readonly slug: string;
  /** `carry.index`; off under the `parity` profile (row 9 of annex X §X.7). */
  readonly indexOn: boolean;
  /** `carry.indexTitleChars`; the same in every pass of a run. */
  readonly titleChars?: number | undefined;
};

/** The text of the block. */
export function indexBlockText(input: IndexInput): string {
  const plan = input.plan;
  if (plan === undefined || plan.obligations.length === 0) return "";
  return proposerBlockOf(plan, input.slug, {
    indexOn: input.indexOn,
    titleChars: input.titleChars ?? INDEX_TITLE_CHARS_DEFAULT,
  });
}

/**
 * The provider. The block is STABLE: the verification plan of a phase does
 * not change between the passes of one phase attempt, so the index belongs in
 * the stable start of F103-FR-036 — which is the whole point of replacing the
 * baseline's full block with it.
 */
export function indexProvider(input: IndexInput): PromptBlockProvider & {
  readonly id: typeof BLOCK_ID;
  readonly writer: typeof WRITER;
} {
  return Object.freeze({
    id: BLOCK_ID,
    writer: WRITER,
    declaredSize: DECLARED_SIZE,
    blocks(_context: PassContext): readonly Block[] {
      const text = indexBlockText(input);
      if (text === "") return Object.freeze([]);
      return Object.freeze([blockOf({ id: BLOCK_ID, text, writer: WRITER, stability: "stable" })]);
    },
  });
}
