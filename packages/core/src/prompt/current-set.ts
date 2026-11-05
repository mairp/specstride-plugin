/**
 * T069 of feature 103 — THE BLOCK SET `current` (F103-FR-036, with the
 * `current` half of F103-FR-033 and F103-FR-035).
 *
 * The default set (row 12 of annex X §X.7, `prompt.block_set`; the `parity`
 * profile selects `as-is` instead). Under it the assembler puts STABLE BLOCKS
 * FIRST and VOLATILE BLOCKS LAST, and the start of the prompt up to the first
 * volatile block is BYTE-IDENTICAL in every pass of one phase attempt. The
 * hash of that start is recorded in `prompt.built`, and CT-103-136
 * (`tests/characterization/103/stable-start-and-index.test.ts`) compares it
 * across the passes of a phase attempt.
 *
 * ## Why the order is the whole feature
 *
 * The harness pays for the prompt again as a cache READ on every turn of a
 * pass, not once (R12 F3b). A prompt whose first bytes change every pass can
 * never be a cache hit; a prompt whose first bytes are fixed for a phase
 * attempt can. So "stable first" is not tidiness: it is what turns a
 * first-turn WRITE into a READ, which is F103-SC-001. The requirement is
 * recorded `unverified` in `spec.md` until experiment X4 measures it on a
 * tested harness adapter, and this module claims nothing more than the ORDER
 * and the HASH, which are the two things that can be checked without a model.
 *
 * ## What may not stand before the stable start
 *
 * F103-FR-036: "No value that changes from pass to pass (a time, a pass
 * ordinal, an identifier of a pass) MUST stand before that start."
 * `VALUES_THAT_MAY_NOT_STAND_IN_THE_STABLE_START` names the three, and
 * `stableStartIsClean` is the check in code: it is given the per-pass values
 * of the pass and refuses a stable start that contains any of them. A test
 * drives it both ways, so the rule is measured and not merely written down.
 *
 * ## Which blocks are stable, and what they read
 *
 * | Block | Stability | Protected | Reads |
 * |---|---|---|---|
 * | `fixed_instructions` | stable | YES (F103-FR-033) | nothing outside the runtime |
 * | `spec_context` | stable | no | the spec documents, as data |
 * | `verification_obligations` | stable | no | the verification plan (T067) |
 * | `plugin_protocol` | stable | no | the capability of the harness |
 * | `layer_protocol` | stable | YES (F103-FR-038) | the layer at `contributePrompt` |
 * | `phase_task` | volatile | YES (F103-FR-033) | the phase slice |
 * | `handoff` | volatile | no | the handoff file (T075) |
 * | `ledger_tail` | volatile | no | the ledger of the namespace `core` (T074) |
 * | `feedback` | volatile | no | `GATE<N>-FEEDBACK.md`, filtered (T-08) |
 * | `hint` | volatile | no | `GATE<N>-HINT.md` |
 * | `acceleration_note` | volatile | no | `GATE<N>-ACCELERATION.md` |
 * | `yield_contract` | last | YES by default (B-0076) | nothing |
 *
 * ## The dependency on T074 and T075, and how it is met
 *
 * T069's own wording: it "needs T074 and T075 (the ledger and the handoff
 * that its blocks read)", and both are tasks of PHASE 5. What those tasks
 * build are the WRITERS — `../carry/ledger-core.ts` and `../carry/handoff.ts`.
 * This module needs the READ side, so the two blocks take their text through
 * `CarryReaders`, a seam of two functions that return text. The set is
 * therefore complete and testable now, and phase 5's writers plug into the
 * seam without a change here. Where a reader is absent the block is simply
 * not present, which is the same rule every other block follows.
 */
import { contentHash } from "@specstride/kernel/hasher";
import type { Block, PassContext } from "@specstride/contracts/ep/prompt-block";
import {
  JOIN,
  YIELD_CONTRACT_BLOCK_ID,
  assemblePrompt,
  blockOf,
  orderBlocks,
  stableStartOf,
  type AssembledPrompt,
  type AssemblerEvent,
  type RegisteredProvider,
} from "./assembler.ts";
import { contextPolicyRecord, type ContextPolicyResult } from "./context-policy.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-033", "F103-FR-035", "F103-FR-036"] as const;

/** The block set this module is. */
export const BLOCK_SET = "current" as const;

/** Row 12 of annex X §X.7 — `current` is the default; `parity` picks `as-is`. */
export const IS_THE_DEFAULT = true as const;
export const SELECTED_BY_THE_PARITY_PROFILE = false as const;

/** F103-FR-036 — stable blocks first, volatile blocks last. */
export const STABLE_FIRST = true as const;

/** F103-FR-036 — the divergence register row of the stable start. */
export const DIVERGENCE = "DV-094" as const;

/**
 * F103-FR-036 — the three kinds of value that may NOT stand before the first
 * volatile block, because each of them changes from pass to pass.
 */
export const VALUES_THAT_MAY_NOT_STAND_IN_THE_STABLE_START = [
  "a time",
  "a pass ordinal",
  "an identifier of a pass",
] as const;

/**
 * F103-FR-033, the `current` half — the blocks that are kept PROTECTED, so
 * that the budget can never drop them: "MUST keep the fixed instructions and
 * the task of the phase as protected blocks, and MUST never drop a protected
 * block".
 */
export const PROTECTED_UNDER_CURRENT = ["fixed_instructions", "phase_task"] as const;

/** The ids of the set, in the order they are offered to the assembler. */
export const CURRENT_BLOCK_IDS = [
  "fixed_instructions",
  "spec_context",
  "verification_obligations",
  "plugin_protocol",
  "layer_protocol",
  "phase_task",
  "handoff",
  "ledger_tail",
  "feedback",
  "hint",
  "acceleration_note",
  YIELD_CONTRACT_BLOCK_ID,
] as const;
export type CurrentBlockId = (typeof CURRENT_BLOCK_IDS)[number];

/** Which of them are stable. The rest are volatile; the yield block is last. */
export const STABLE_BLOCK_IDS = [
  "fixed_instructions",
  "spec_context",
  "verification_obligations",
  "plugin_protocol",
  "layer_protocol",
] as const;

/** Whether an id of the set is a stable block. */
export function isStable(id: string): boolean {
  return (STABLE_BLOCK_IDS as readonly string[]).includes(id);
}

/* ------------------------------------------------------------------ *
 * The read seam of the carry-over files (T074 and T075 write them).
 * ------------------------------------------------------------------ */

/**
 * The read side of the two carry-over files the set's volatile blocks read.
 * The WRITERS are `../carry/handoff.ts` (T075) and `../carry/ledger-core.ts`
 * (T074), both of phase 5; this seam is what makes the set complete before
 * they exist, and what they fill in afterwards.
 *
 * Both are TEXT, not records: F103-FR-041 says the runtime never reads the
 * handoff back, so there is nothing to parse — the file goes into the prompt
 * as data and this seam hands over exactly those bytes.
 */
export type CarryReaders = {
  /** The text of the handoff file, written at the start of this pass. */
  handoff?(): string | undefined;
  /** The last lines of the ledger of the namespace `core`. */
  ledgerTail?(): string | undefined;
};

/* ------------------------------------------------------------------ *
 * Building the set.
 * ------------------------------------------------------------------ */

/** The text of each block of the set; an absent block is an empty one. */
export type CurrentTexts = Partial<Readonly<Record<CurrentBlockId, string>>>;

/** What the set is built from. */
export type CurrentSetInput = {
  readonly texts: CurrentTexts;
  readonly readers?: CarryReaders | undefined;
  /** The result of Lisa's policy, recorded in `prompt.built` (F103-FR-035). */
  readonly contextPolicy?: ContextPolicyResult | undefined;
};

/**
 * The blocks of the set `current`, each with its stability and its
 * protection, in the order of `CURRENT_BLOCK_IDS`. The assembler is what
 * re-orders them stable-first; this function fixes WHAT each block is.
 */
export function currentBlocks(input: CurrentSetInput): readonly Block[] {
  const texts: Record<string, string | undefined> = { ...input.texts };
  texts.handoff ??= input.readers?.handoff?.();
  texts.ledger_tail ??= input.readers?.ledgerTail?.();

  const blocks: Block[] = [];
  for (const id of CURRENT_BLOCK_IDS) {
    const text = texts[id] ?? "";
    if (text === "") continue;
    blocks.push(
      blockOf({
        id,
        text,
        writer: `core/prompt/current-set:${id}`,
        protected: (PROTECTED_UNDER_CURRENT as readonly string[]).includes(id),
        stability: isStable(id) ? "stable" : "volatile",
      }),
    );
  }
  return Object.freeze(blocks);
}

/** The blocks of the set as PROVIDERS, which is how the assembler takes them. */
export function currentProviders(input: CurrentSetInput): readonly RegisteredProvider[] {
  return Object.freeze(
    currentBlocks(input).map((block) =>
      Object.freeze({
        id: block.id,
        declaredSize: block.bytes,
        writer: block.writer,
        protected: block.protected,
        stability: block.stability,
        blocks: () => Object.freeze([block]),
      }),
    ),
  );
}

/** What was built, with the stable start named on its own. */
export type CurrentSetResult = AssembledPrompt & {
  /** The prompt up to the first volatile block, and its hash. */
  readonly stableStart: { readonly text: string; readonly bytes: number; readonly hash: string };
};

/**
 * F103-FR-036 — the prompt of a pass under the block set `current`: stable
 * blocks first, volatile last, the yield block last of all, the budget of
 * F103-FR-033 kept, and `prompt.built` carrying the hash of the stable start.
 */
export function buildCurrentSet(
  input: CurrentSetInput,
  options: {
    readonly context: PassContext;
    readonly promptRef: string;
    readonly budgetBytes?: number | undefined;
    readonly protectedBlocks?: readonly string[] | undefined;
    /** T081 — the carry-over switches recorded in `prompt.built`. */
    readonly switches?: Readonly<Record<string, unknown>> | undefined;
    print?(line: string): void;
    emit?(event: AssemblerEvent): void;
  },
): CurrentSetResult {
  const assembled = assemblePrompt({
    context: options.context,
    promptRef: options.promptRef,
    blockSet: BLOCK_SET,
    providers: currentProviders(input),
    budgetBytes: options.budgetBytes,
    protectedBlocks: options.protectedBlocks,
    stableFirst: STABLE_FIRST,
    ...(options.switches === undefined ? {} : { switches: options.switches }),
    ...(options.print === undefined ? {} : { print: options.print }),
    ...(options.emit === undefined ? {} : { emit: options.emit }),
    ...(input.contextPolicy === undefined
      ? {}
      : { contextPolicy: contextPolicyRecord(input.contextPolicy) }),
  });
  return Object.freeze({ ...assembled, stableStart: stableStartOf(assembled.blocks) });
}

/* ------------------------------------------------------------------ *
 * The two checks F103-FR-036 asks a test to make.
 * ------------------------------------------------------------------ */

/**
 * The hash of the stable start of a list of blocks, ordered as the set orders
 * them. This is the value `prompt.built` carries and the value CT-103-136
 * compares across the passes of a phase attempt.
 */
export function stableStartHashOf(blocks: readonly Block[]): string {
  return stableStartOf(orderBlocks(blocks, STABLE_FIRST)).hash;
}

/** The hash of a text, for a caller that has the start and not the blocks. */
export function hashOfStableStartText(text: string): string {
  return contentHash(text);
}

/** The per-pass values F103-FR-036 forbids before the stable start. */
export type PerPassValues = {
  /** The time of the pass, in whatever form it would be printed. */
  readonly times?: readonly string[] | undefined;
  /** The pass ordinal. */
  readonly passOrdinal?: number | undefined;
  /** The identifiers of the pass: its pass id and its invocation id. */
  readonly ids?: readonly string[] | undefined;
};

/** One value found standing in the stable start where it may not. */
export type StableStartOffence = {
  readonly kind: (typeof VALUES_THAT_MAY_NOT_STAND_IN_THE_STABLE_START)[number];
  readonly value: string;
};

/**
 * F103-FR-036 — the check that no value which changes from pass to pass
 * stands before the first volatile block. It returns what it found, so a test
 * can assert both that a clean start is clean and that a dirty one is caught.
 *
 * A pass ordinal is looked for as a WORD, not as a substring: the digit `1`
 * occurs in almost any text, and a check that flagged it would flag every
 * prompt and prove nothing.
 */
export function stableStartOffences(
  stableStartText: string,
  values: PerPassValues,
): readonly StableStartOffence[] {
  const found: StableStartOffence[] = [];
  for (const time of values.times ?? []) {
    if (time !== "" && stableStartText.includes(time)) {
      found.push({ kind: "a time", value: time });
    }
  }
  if (values.passOrdinal !== undefined) {
    const word = new RegExp(`\\b${values.passOrdinal}\\b`);
    if (word.test(stableStartText)) {
      found.push({ kind: "a pass ordinal", value: String(values.passOrdinal) });
    }
  }
  for (const id of values.ids ?? []) {
    if (id !== "" && stableStartText.includes(id)) {
      found.push({ kind: "an identifier of a pass", value: id });
    }
  }
  return Object.freeze(found);
}

/** True when the stable start holds none of the forbidden values. */
export function stableStartIsClean(stableStartText: string, values: PerPassValues): boolean {
  return stableStartOffences(stableStartText, values).length === 0;
}

/** The join between two blocks, the same one blank line the as-is set uses. */
export { JOIN };
