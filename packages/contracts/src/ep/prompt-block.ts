/**
 * T135 — the interface types of EP-15, the prompt block provider, from
 * `contracts/extension-points/EP-15.prompt-block.json` and annex D, §D.5
 * (F100-FR-131, F100-FR-132).
 *
 * `specstride.prompt-block/1`. Any component may contribute a block to the
 * proposer's prompt, while one assembler keeps the budget of the whole
 * prompt.
 */
export const POINT_ID = "specstride.prompt-block/1" as const;
export const EP = "EP-15" as const;
export const ANNEX_SECTION = "annex D, §D.5" as const;

/** F100-FR-131 — the one operation of the point. */
export const OPERATIONS = ["blocks"] as const;
export type PromptBlockOperation = (typeof OPERATIONS)[number];

/** The context of the pass `blocks` receives (§D.5, Inputs). */
export type PassContext = {
  readonly phase: number;
  readonly attempt: number;
  readonly passOrdinal: number;
  readonly strategy: string;
  /** What changed since the pass before. */
  readonly changedSinceThePassBefore: readonly string[];
};

/** Whether a block is stable or volatile (§D.5, Outputs). */
export const STABILITIES = ["stable", "volatile"] as const;
export type Stability = (typeof STABILITIES)[number];

/** One block, with everything §D.5 lists. */
export type Block = {
  readonly id: string;
  readonly bytes: number;
  readonly hash: string;
  readonly writer: string;
  readonly protected: boolean;
  readonly stability: Stability;
  readonly text: string;
};

/** F100-FR-131 — a prompt block provider. */
export type PromptBlockProvider = {
  /** The size the provider declares for its block; a longer block is cut. */
  readonly declaredSize: number;
  blocks(context: PassContext): readonly Block[];
};

/** "Guarantees of the core" of §D.5, as data. */
export const CORE_GUARANTEES = [
  "one assembler budgets the whole prompt",
  "stable blocks are placed first",
  "the start of the prompt is byte-stable inside a phase attempt",
  "every pass emits `prompt.built` with the blocks and what was dropped",
  "a protected block is never dropped",
  "the critic has an assembler and a block set of its own",
] as const;

/** The event every pass emits (§D.5, Guarantees of the core). */
export const EVENT_OF_THE_ASSEMBLY = "prompt.built" as const;

/** A protected block is never dropped (§D.5). */
export const A_PROTECTED_BLOCK_IS_DROPPED = false as const;

/** No block of the proposer reaches the critic through this point (§D.5). */
export const A_PROPOSER_BLOCK_REACHES_THE_CRITIC = false as const;

/** "Errors" of §D.5: a block over its declared size is cut and recorded. */
export function cutToDeclaredSize(
  block: Block,
  declaredSize: number,
): {
  readonly block: Block;
  readonly cut: boolean;
} {
  if (block.bytes <= declaredSize) return { block, cut: false };
  return {
    block: Object.freeze({
      ...block,
      bytes: declaredSize,
      text: block.text.slice(0, declaredSize),
    }),
    cut: true,
  };
}

/**
 * "Failure of an implementation" of §D.5 — the plainer path: the block is
 * left out, the omission is recorded in `prompt.built`, and the pass runs. A
 * provider of a protected block that fails is an error of the pass, by the
 * existing breakers.
 */
export const FAILURE_PATH =
  "the block is left out, the omission is recorded in `prompt.built`, and the pass runs" as const;
export const FAILURE_PATH_OF_A_PROTECTED_BLOCK =
  "an error of the pass, by the existing breakers" as const;
export const FAILURE_PATHS: Readonly<Record<PromptBlockOperation, string>> = Object.freeze({
  blocks: FAILURE_PATH,
});

/**
 * "Unknown-value rule" of §D.5: an unknown block id is accepted, since block
 * ids are an open set; an unknown value of `protected` or of `stable` is read
 * as not protected and volatile.
 */
export const BLOCK_IDS_ARE_AN_OPEN_SET = true as const;
export function readProtected(value: unknown): boolean {
  return value === true;
}
export function readStability(value: unknown): Stability {
  return value === "stable" ? "stable" : "volatile";
}

/** F100-FR-132 — the three parts of carry-over, each with its own switch. */
export const CARRY_OVER_SWITCHES = ["carry.ledger_handoff", "carry.index"] as const;
export const CARRY_OVER_DEFAULT_ON = true as const;
/** The handoff is written at the start of every pass and never read back. */
export const THE_HANDOFF_IS_READ_BACK = false as const;
