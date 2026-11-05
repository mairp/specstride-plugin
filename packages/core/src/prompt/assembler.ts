/**
 * T065 of feature 103 — THE ONE ASSEMBLER of the proposer's prompt
 * (F103-FR-030, F103-FR-033, F103-FR-034, F103-FR-038).
 *
 * There is ONE assembler. It offers providers the one operation `blocks` of
 * EP-15 (`specstride.prompt-block/1`, annex D §D.5), keeps the budget of the
 * whole prompt, keeps protected blocks, and emits `prompt.built` with every
 * block and every drop.
 *
 * ## The four things it does, and the record each rests on
 *
 *  1. **It calls providers and reads what they return** (F103-FR-030). A block
 *     over the size its provider declared is CUT and recorded. A provider that
 *     FAILS leaves its block out and the omission is recorded in
 *     `prompt.built`; a failing provider of a PROTECTED block is an ERROR OF
 *     THE PASS, by the existing breakers — `ProtectedProviderFailedError`,
 *     which the loop's accounting counts as a pass error.
 *  2. **It keeps the budget** (F103-FR-033). `loop.promptMaxBytes`
 *     (`SPECSTRIDE_PROMPT_MAX_BYTES`, default 180000, 0 disables) and
 *     `loop.promptProtectedBlocks` (`SPECSTRIDE_PROMPT_PROTECTED_BLOCKS`,
 *     default `yield_contract`, set but empty protects nothing). Records
 *     B-0075, B-0076, B-0296. A PROTECTED block over the budget is KEPT and
 *     said out loud; an UNPROTECTED one is DROPPED and said out loud. The rest
 *     of the prompt is NEVER truncated by the assembler.
 *  3. **It says it out loud** (F103-FR-033, records B-0207, B-0091, B-0092).
 *     Two lines, byte for byte, and two events. The assembler emits the
 *     CATALOGUED type (`prompt.block_protected`, `prompt.block_dropped` of
 *     `packages/observability/data/event-catalogue.tsv`) and NEVER the as-is
 *     name; the compatibility projection renames them to
 *     `prompt_block_protected` and `prompt_block_dropped` with the as-is
 *     fields `block`, `assembled_bytes`, `block_bytes`, `budget_bytes`
 *     (`packages/observability/data/projection/projection-table.tsv`, rows 56
 *     and 57). This is the same split `../pass-loop/announce.ts` makes.
 *  4. **It emits `prompt.built`** (F103-FR-034). Every block with its id,
 *     bytes, hash, writer, `protected` and `stable`; every block dropped or
 *     left out WITH ITS REASON; and the hash of the stable start. No block is
 *     dropped or left out without an entry — `prompt.built` is the ONE record
 *     the two events above are DERIVED from, which is what F103-FR-034 asks
 *     for and what F103-SC-003 measures.
 *
 * ## What it never does
 *
 * It never truncates the rest of the prompt (F103-FR-033). It never drops a
 * protected block (F103-FR-033, annex D §D.5). No block of it reaches the
 * CRITIC (F103-FR-030): the critic has an assembler and a block set of its
 * own, which is feature 117's.
 *
 * Boundary: `@specstride/contracts` and `@specstride/kernel` only
 * (F100-FR-012); no writer of the phase gate (F103-FR-028).
 */
import { contentHash } from "@specstride/kernel/hasher";
import {
  cutToDeclaredSize,
  readProtected,
  readStability,
} from "@specstride/contracts/ep/prompt-block";
import type { Block, PassContext, Stability } from "@specstride/contracts/ep/prompt-block";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-030", "F103-FR-033", "F103-FR-034", "F103-FR-038"] as const;

/** F103-FR-030 — there is ONE assembler of the proposer's prompt. */
export const ASSEMBLERS_OF_THE_PROPOSER_PROMPT = 1 as const;

/** F103-FR-030 — the one operation the assembler offers a provider. */
export const PROVIDER_OPERATION = "blocks" as const;

/** F103-FR-030 — no block of this assembler reaches the critic. */
export const A_BLOCK_REACHES_THE_CRITIC = false as const;

/** F103-FR-033 — the rest of the prompt is never truncated by the assembler. */
export const TRUNCATES_THE_REST_OF_THE_PROMPT = false as const;

/** F103-FR-033 and annex D §D.5 — a protected block is never dropped. */
export const DROPS_A_PROTECTED_BLOCK = false as const;

/** F103-FR-030 — block ids are an OPEN set; the block SETS are closed. */
export const BLOCK_IDS_ARE_AN_OPEN_SET = true as const;

/* ------------------------------------------------------------------ *
 * The two configuration keys of F103-FR-033.
 * ------------------------------------------------------------------ */

/** `loop.promptMaxBytes` — the byte budget of the assembled prompt (B-0075). */
export const BUDGET_KEY = "loop.promptMaxBytes" as const;
export const BUDGET_VARIABLE = "SPECSTRIDE_PROMPT_MAX_BYTES" as const;
export const BUDGET_DEFAULT = 180_000 as const;
/** F103-FR-033 — the value 0 disables the budget. */
export const BUDGET_DISABLED = 0 as const;

/** `loop.promptProtectedBlocks` — the set of protected blocks (B-0076). */
export const PROTECTED_KEY = "loop.promptProtectedBlocks" as const;
export const PROTECTED_VARIABLE = "SPECSTRIDE_PROMPT_PROTECTED_BLOCKS" as const;
export const PROTECTED_DEFAULT = ["yield_contract"] as const;
/** B-0076 — set but EMPTY protects nothing; it is not the default. */
export const SET_BUT_EMPTY_PROTECTS_NOTHING = true as const;

/** The id of the one block the baseline budgets, appended LAST (B-0296). */
export const YIELD_CONTRACT_BLOCK_ID = "yield_contract" as const;
/** F103-FR-033 — the yield artifact schema block is added LAST. */
export const YIELD_CONTRACT_IS_ADDED_LAST = true as const;

/**
 * The protected set as the key gives it. `undefined` means the key was not
 * set, so the default stands; an EMPTY LIST means it was set to nothing, and
 * then nothing is protected (B-0076).
 */
export function resolveProtectedBlocks(
  configured: readonly string[] | undefined,
): readonly string[] {
  if (configured === undefined) return PROTECTED_DEFAULT;
  return Object.freeze([...configured]);
}

/** The budget as the key gives it; `undefined` leaves the default standing. */
export function resolveBudget(configured: number | undefined): number {
  return configured === undefined ? BUDGET_DEFAULT : configured;
}

/** F103-FR-033 — a budget of 0 is no budget at all. */
export function budgetIsOff(budget: number): boolean {
  return budget === BUDGET_DISABLED;
}

/* ------------------------------------------------------------------ *
 * The two lines of F103-FR-033, byte for byte (B-0207).
 * ------------------------------------------------------------------ */

/** The line of a PROTECTED block that is over the budget and is kept. */
export function keptOverBudgetLine(
  block: string,
  assembledBytes: number,
  blockBytes: number,
  budgetBytes: number,
): string {
  return (
    `>>> prompt block '${block}' kept over budget (protected): ` +
    `${assembledBytes}B already assembled + ${blockBytes}B exceeds ` +
    `${BUDGET_VARIABLE}=${budgetBytes}`
  );
}

/** The line of an UNPROTECTED block that is over the budget and is dropped. */
export function droppedLine(
  block: string,
  assembledBytes: number,
  blockBytes: number,
  budgetBytes: number,
): string {
  return (
    `>>> prompt block '${block}' dropped: ` +
    `${assembledBytes}B already assembled + ${blockBytes}B exceeds ` +
    `${BUDGET_VARIABLE}=${budgetBytes}`
  );
}

/* ------------------------------------------------------------------ *
 * The three events: two of F103-FR-033 and one of F103-FR-034.
 * ------------------------------------------------------------------ */

/** The catalogue and the projection table the rows below are taken from. */
export const EVENT_CATALOGUE_FILE = "packages/observability/data/event-catalogue.tsv" as const;
export const PROJECTION_TABLE_FILE =
  "packages/observability/data/projection/projection-table.tsv" as const;

/** One event of the assembler, with both of its halves. */
export type AssemblerEventRow = {
  /** The type of the event catalogue the assembler actually emits. */
  readonly catalogueType: string;
  /** The name the compatibility projection renders, where it renders one. */
  readonly asIsName: string | undefined;
  /** The as-is fields of the projected event, in the order of the table. */
  readonly asIsFields: readonly string[];
  readonly requirement: string;
};

/** F103-FR-034 — the record every pass emits. */
export const PROMPT_BUILT: AssemblerEventRow = Object.freeze({
  catalogueType: "prompt.built",
  asIsName: undefined, // row 55 of the projection table: "no as-is equivalent"
  asIsFields: Object.freeze([]),
  requirement: "F103-FR-034",
});

/** F103-FR-033 — a protected block kept over the budget (B-0091). */
export const PROMPT_BLOCK_PROTECTED: AssemblerEventRow = Object.freeze({
  catalogueType: "prompt.block_protected",
  asIsName: "prompt_block_protected",
  asIsFields: Object.freeze(["block", "assembled_bytes", "block_bytes", "budget_bytes"]),
  requirement: "F103-FR-033",
});

/** F103-FR-033 — an unprotected block dropped over the budget (B-0092). */
export const PROMPT_BLOCK_DROPPED: AssemblerEventRow = Object.freeze({
  catalogueType: "prompt.block_dropped",
  asIsName: "prompt_block_dropped",
  asIsFields: Object.freeze(["block", "assembled_bytes", "block_bytes", "budget_bytes"]),
  requirement: "F103-FR-033",
});

export const ASSEMBLER_EVENTS: readonly AssemblerEventRow[] = Object.freeze([
  PROMPT_BUILT,
  PROMPT_BLOCK_PROTECTED,
  PROMPT_BLOCK_DROPPED,
]);

/** One emitted event: the catalogued type and its fields. */
export type AssemblerEvent = {
  readonly type: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

/* ------------------------------------------------------------------ *
 * Why a block is not in the prompt (F103-FR-034).
 * ------------------------------------------------------------------ */

/**
 * The closed set of reasons a block is not in the prompt, or is not in it
 * whole. Every one of them has an entry in `prompt.built`: that is
 * F103-FR-034's "No block MUST be dropped or left out without an entry".
 */
export const OMISSION_REASONS = [
  "over-budget",
  "provider-failed",
  "empty",
  "cut-to-declared-size",
] as const;
export type OmissionReason = (typeof OMISSION_REASONS)[number];

/** One entry of `prompt.built` for a block that is not in the prompt whole. */
export type Omission = {
  readonly id: string;
  readonly reason: OmissionReason;
  readonly writer: string;
  readonly protected: boolean;
  readonly stability: Stability;
  /** The size the block would have had. */
  readonly blockBytes: number;
  /** The size assembled when the decision was made. */
  readonly assembledBytes?: number;
  /** The budget that governed, where one did. */
  readonly budgetBytes?: number;
  /** The size the block was cut to, where it was cut. */
  readonly keptBytes?: number;
  /** The message of the provider's failure, where it failed. */
  readonly message?: string;
  /** Whether the block was kept in spite of being over the budget. */
  readonly kept: boolean;
};

/* ------------------------------------------------------------------ *
 * `prompt.built` (F103-FR-034).
 * ------------------------------------------------------------------ */

/** One block as `prompt.built` records it; the text is not in the record. */
export type BuiltBlock = {
  readonly id: string;
  readonly bytes: number;
  readonly hash: string;
  readonly writer: string;
  readonly protected: boolean;
  /** F103-FR-034 names the field `stable`; its values are of `STABILITIES`. */
  readonly stable: Stability;
};

/** The record of F103-FR-034, which both events above are derived from. */
export type PromptBuilt = {
  /** The logical name of the prompt of the pass (F103-FR-007). */
  readonly promptRef: string;
  readonly blockSet: string;
  readonly blocks: readonly BuiltBlock[];
  /** Every block dropped or left out, and why. */
  readonly omitted: readonly Omission[];
  /** F103-FR-036 — the hash of the stable start of the prompt. */
  readonly stableStartHash: string;
  /** The number of bytes of the prompt up to the first volatile block. */
  readonly stableStartBytes: number;
  readonly totalBytes: number;
  readonly budgetBytes: number;
  /** An estimate of the first-turn tokens, the field the catalogue names. */
  readonly totalTokensEst: number;
  /** The record of Lisa's policy, under the block set `current` only. */
  readonly contextPolicy?: unknown;
  /**
   * T081 (F103-SC-001) — the carry-over switches that governed this prompt,
   * so that a measurement of the record can be attributed to the arm of the
   * experiment it came from. Experiments X3 and X11 compare the same pass
   * with `carry.index` on and off, and X9 with `carry.continuation` on and
   * off; without this field the two arms are indistinguishable in the record
   * they are measured from. Absent where the caller named no switch, so the
   * prompt of the `as-is` set is unchanged byte for byte and record for
   * record.
   */
  readonly switches?: Readonly<Record<string, unknown>>;
};

/** The ratio the token estimate of `prompt.built` uses; the plan's own. */
export const CHARACTERS_PER_TOKEN = 4 as const;

/* ------------------------------------------------------------------ *
 * A failing provider of a protected block is an error of the pass.
 * ------------------------------------------------------------------ */

/**
 * F103-FR-030 — "a failure of the provider of a protected block MUST be an
 * error of the pass, by the existing breakers". The existing breakers are the
 * consecutive-error breaker of `../pass-loop/accounting.ts`: the loop counts
 * the pass as an error, and nothing new is invented for it.
 */
export class ProtectedProviderFailedError extends Error {
  readonly blockId: string;
  override readonly cause: unknown;
  /** What the loop does with it: count the pass as an error. */
  readonly isAnErrorOfThePass = true as const;
  constructor(blockId: string, cause: unknown) {
    super(
      `the provider of the protected prompt block '${blockId}' failed: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "ProtectedProviderFailedError";
    this.blockId = blockId;
    this.cause = cause;
  }
}

/* ------------------------------------------------------------------ *
 * A registered provider.
 * ------------------------------------------------------------------ */

/**
 * One registered provider of the assembler. `id` is the id of the block it
 * contributes; `declaredSize` is the size it declares, and a longer block is
 * cut and recorded (annex D §D.5, "Errors").
 */
export type RegisteredProvider = {
  readonly id: string;
  readonly declaredSize: number;
  readonly writer: string;
  /** Whether the block is protected, where the provider itself decides. */
  readonly protected?: boolean;
  readonly stability?: Stability;
  blocks(context: PassContext): readonly Block[];
};

/** What the assembler was asked to build. */
export type AssembleRequest = {
  readonly context: PassContext;
  readonly promptRef: string;
  readonly blockSet: string;
  readonly providers: readonly RegisteredProvider[];
  /** `loop.promptMaxBytes`; absent leaves the default standing. */
  readonly budgetBytes?: number | undefined;
  /** `loop.promptProtectedBlocks`; absent leaves the default standing. */
  readonly protectedBlocks?: readonly string[] | undefined;
  /** Where the lines of F103-FR-033 are printed. */
  print?(line: string): void;
  /** Where the events of F103-FR-033 and F103-FR-034 are emitted. */
  emit?(event: AssemblerEvent): void;
  /** The record of Lisa's policy, under the block set `current` only. */
  readonly contextPolicy?: unknown;
  /** T081 — the carry-over switches recorded in `prompt.built`. */
  readonly switches?: Readonly<Record<string, unknown>> | undefined;
  /**
   * Whether blocks are ordered stable-first. Under `current` they are
   * (F103-FR-036); under `as-is` the order is the baseline's and this module
   * leaves it exactly as `./as-is-set.ts` built it.
   */
  readonly stableFirst?: boolean;
};

/** Everything the assembler produced. */
export type AssembledPrompt = {
  readonly text: string;
  readonly blocks: readonly Block[];
  readonly built: PromptBuilt;
  readonly lines: readonly string[];
  readonly events: readonly AssemblerEvent[];
};

/* ------------------------------------------------------------------ *
 * Reading what a provider returned (F103-FR-030).
 * ------------------------------------------------------------------ */

/**
 * The unknown-value rules of F103-FR-030 and annex D §D.5: an unknown value
 * of `protected` is read as NOT PROTECTED and an unknown value of `stable` as
 * VOLATILE. The block id is accepted whatever it is, because block ids are an
 * open set.
 */
export function readBlock(raw: unknown, writer: string): Block | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : undefined;
  if (id === undefined) return undefined;
  const text = typeof record.text === "string" ? record.text : "";
  return Object.freeze({
    id,
    bytes: Buffer.byteLength(text, "utf8"),
    hash: typeof record.hash === "string" ? record.hash : contentHash(text),
    writer: typeof record.writer === "string" ? record.writer : writer,
    protected: readProtected(record.protected),
    stability: readStability(record.stability),
    text,
  });
}

/** The join between two blocks: one blank line, as F103-FR-031 fixes it. */
export const JOIN = "\n\n" as const;

/* ------------------------------------------------------------------ *
 * The assembly itself.
 * ------------------------------------------------------------------ */

/**
 * F103-FR-030, F103-FR-033, F103-FR-034 — call every provider, keep the
 * budget, and emit `prompt.built`.
 *
 * The walk is ONE PASS over the providers and ONE join at the end, so the
 * assembly is LINEAR in the size of the prompt: `plan.md`, "Prompt assembly"
 * — "the assembler concatenates in one pass and computes the hash of each
 * block and of the stable start; NO QUADRATIC OPERATION ON THE PROMPT". That
 * is the same rule F103-FR-008 puts on the start-up of a pass.
 */
export function assemblePrompt(request: AssembleRequest): AssembledPrompt {
  const budget = resolveBudget(request.budgetBytes);
  const protectedSet = new Set(resolveProtectedBlocks(request.protectedBlocks));
  const lines: string[] = [];
  const events: AssemblerEvent[] = [];
  const omitted: Omission[] = [];

  // 1. Call every provider once, in the order it was registered, and read
  //    what it returned. A provider that fails leaves its block out; a
  //    failing provider of a PROTECTED block is an error of the pass.
  const offered: Block[] = [];
  for (const provider of request.providers) {
    const isProtected = provider.protected === true || protectedSet.has(provider.id);
    let returned: readonly Block[];
    try {
      returned = provider.blocks(request.context);
    } catch (cause) {
      if (isProtected) throw new ProtectedProviderFailedError(provider.id, cause);
      omitted.push(
        Object.freeze({
          id: provider.id,
          reason: "provider-failed" as const,
          writer: provider.writer,
          protected: false,
          stability: provider.stability ?? ("volatile" as const),
          blockBytes: 0,
          message: cause instanceof Error ? cause.message : String(cause),
          kept: false,
        }),
      );
      continue;
    }
    for (const raw of returned) {
      const block = readBlock(raw, provider.writer);
      if (block === undefined) continue;
      const marked: Block = Object.freeze({
        ...block,
        protected: block.protected || protectedSet.has(block.id),
      });
      if (marked.text === "") {
        omitted.push(
          Object.freeze({
            id: marked.id,
            reason: "empty" as const,
            writer: marked.writer,
            protected: marked.protected,
            stability: marked.stability,
            blockBytes: 0,
            kept: false,
          }),
        );
        continue;
      }
      // Annex D §D.5, "Errors": a block over the size its provider declared
      // is CUT and RECORDED.
      const { block: fitted, cut } = cutToDeclaredSize(marked, provider.declaredSize);
      if (cut) {
        omitted.push(
          Object.freeze({
            id: marked.id,
            reason: "cut-to-declared-size" as const,
            writer: marked.writer,
            protected: marked.protected,
            stability: marked.stability,
            blockBytes: marked.bytes,
            keptBytes: fitted.bytes,
            kept: true,
          }),
        );
      }
      offered.push(fitted);
    }
  }

  // 2. The order of admission. Under `current` stable blocks come first and
  //    volatile blocks last (F103-FR-036); the sort is STABLE in the sense of
  //    `Array.prototype.sort`, so blocks of equal stability keep the order
  //    their providers were registered in. Under `as-is` the order is the
  //    baseline's and is left exactly as it came in. The yield contract block
  //    is moved LAST in both (F103-FR-033).
  const ordered = orderBlocks(offered, request.stableFirst === true);

  // 3. The budget. A protected block over it is kept and said out loud; an
  //    unprotected one is dropped and said out loud.
  const admitted: Block[] = [];
  let assembled = 0;
  for (const block of ordered) {
    const separator = admitted.length === 0 ? 0 : JOIN.length;
    const need = block.bytes + separator;
    const fits = budgetIsOff(budget) || assembled + need <= budget;
    if (fits) {
      admitted.push(block);
      assembled += need;
      continue;
    }
    const fields = Object.freeze({
      block: block.id,
      assembledBytes: assembled,
      blockBytes: block.bytes,
      budgetBytes: budget,
    });
    if (block.protected) {
      // F103-FR-033 — kept, and the fact is said out loud.
      lines.push(keptOverBudgetLine(block.id, assembled, block.bytes, budget));
      events.push(Object.freeze({ type: PROMPT_BLOCK_PROTECTED.catalogueType, fields }));
      omitted.push(
        Object.freeze({
          id: block.id,
          reason: "over-budget" as const,
          writer: block.writer,
          protected: true,
          stability: block.stability,
          blockBytes: block.bytes,
          assembledBytes: assembled,
          budgetBytes: budget,
          kept: true,
        }),
      );
      admitted.push(block);
      assembled += need;
      continue;
    }
    lines.push(droppedLine(block.id, assembled, block.bytes, budget));
    events.push(Object.freeze({ type: PROMPT_BLOCK_DROPPED.catalogueType, fields }));
    omitted.push(
      Object.freeze({
        id: block.id,
        reason: "over-budget" as const,
        writer: block.writer,
        protected: false,
        stability: block.stability,
        blockBytes: block.bytes,
        assembledBytes: assembled,
        budgetBytes: budget,
        kept: false,
      }),
    );
  }

  // 4. One join, and the hash of the stable start.
  const text = admitted.map((block) => block.text).join(JOIN);
  const start = stableStartOf(admitted);

  const built: PromptBuilt = Object.freeze({
    promptRef: request.promptRef,
    blockSet: request.blockSet,
    blocks: Object.freeze(
      admitted.map((block) =>
        Object.freeze({
          id: block.id,
          bytes: block.bytes,
          hash: block.hash,
          writer: block.writer,
          protected: block.protected,
          stable: block.stability,
        }),
      ),
    ),
    omitted: Object.freeze(omitted),
    stableStartHash: start.hash,
    stableStartBytes: start.bytes,
    totalBytes: Buffer.byteLength(text, "utf8"),
    budgetBytes: budget,
    totalTokensEst: Math.ceil(text.length / CHARACTERS_PER_TOKEN),
    ...(request.contextPolicy === undefined ? {} : { contextPolicy: request.contextPolicy }),
    ...(request.switches === undefined ? {} : { switches: Object.freeze({ ...request.switches }) }),
  });

  // The two events of F103-FR-033 are DERIVED from the same record: every one
  // of them has its entry in `built.omitted`, which is what F103-FR-034 asks.
  events.push(Object.freeze({ type: PROMPT_BUILT.catalogueType, fields: built }));

  for (const line of lines) request.print?.(line);
  for (const event of events) request.emit?.(event);

  return Object.freeze({
    text,
    blocks: Object.freeze(admitted),
    built,
    lines: Object.freeze(lines),
    events: Object.freeze(events),
  });
}

/**
 * F103-FR-033 and F103-FR-036 — the order of admission. The yield contract
 * block is last in both sets; under `current` stable blocks come before
 * volatile ones.
 */
export function orderBlocks(blocks: readonly Block[], stableFirst: boolean): readonly Block[] {
  const rank = (block: Block): number => {
    if (block.id === YIELD_CONTRACT_BLOCK_ID) return 2;
    if (!stableFirst) return 1;
    return block.stability === "stable" ? 0 : 1;
  };
  return Object.freeze(
    blocks
      .map((block, at) => ({ block, at }))
      .sort((a, b) => rank(a.block) - rank(b.block) || a.at - b.at)
      .map((entry) => entry.block),
  );
}

/**
 * F103-FR-034 and F103-FR-036 — the STABLE START: the prompt up to the first
 * volatile block, and its hash. Under `as-is` every block is volatile, so the
 * stable start is empty and its hash is the hash of the empty text — which is
 * the honest answer, not a missing field.
 */
export function stableStartOf(blocks: readonly Block[]): {
  readonly text: string;
  readonly bytes: number;
  readonly hash: string;
} {
  const stable: Block[] = [];
  for (const block of blocks) {
    if (block.stability !== "stable") break;
    stable.push(block);
  }
  const text = stable.map((block) => block.text).join(JOIN);
  return Object.freeze({
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    hash: contentHash(text),
  });
}

/**
 * F103-FR-034 and F103-SC-003 — every block that was dropped or left out has
 * an entry. This is the check in code, so a test can drive it rather than
 * reading the record by eye.
 */
export function everyOmissionIsRecorded(
  built: PromptBuilt,
  offeredIds: readonly string[],
): boolean {
  const present = new Set(built.blocks.map((block) => block.id));
  const recorded = new Set(built.omitted.map((omission) => omission.id));
  return offeredIds.every((id) => present.has(id) || recorded.has(id));
}

/**
 * One block in the form of annex D §D.5, built from its text. Every shipped
 * provider of `./providers/` makes its block through this one function, so
 * that `bytes` is always UTF-8 bytes and `hash` is always the canonical
 * content hash of the same text the block carries.
 */
export function blockOf(fields: {
  readonly id: string;
  readonly text: string;
  readonly writer: string;
  readonly protected?: boolean;
  readonly stability?: Stability;
}): Block {
  return Object.freeze({
    id: fields.id,
    bytes: Buffer.byteLength(fields.text, "utf8"),
    hash: contentHash(fields.text),
    writer: fields.writer,
    protected: fields.protected === true,
    stability: fields.stability ?? ("volatile" as const),
    text: fields.text,
  });
}

/* ------------------------------------------------------------------ *
 * T085 (F103-FR-034, W-X-20) — the two block events DERIVED from the record.
 * ------------------------------------------------------------------ */

/**
 * The fields of a `prompt.block_protected` or `prompt.block_dropped` event,
 * as the event catalogue gives them.
 */
export type BlockEventFields = {
  readonly block: string;
  readonly assembledBytes: number;
  readonly blockBytes: number;
  readonly budgetBytes: number;
};

/**
 * W-X-20 — `prompt_block_protected` and `prompt_block_dropped` DERIVE FROM
 * THE SAME RECORD. This is that derivation in code: given nothing but a
 * `prompt.built`, it reproduces the two events the assembler emitted, from
 * the `omitted` entries alone.
 *
 * It is not a second source of the events — `assemblePrompt` emits them while
 * it walks the budget — but it is the check that the record carries
 * everything they carry. CT-103-134 asserts that the emitted events and the
 * derived ones are deep-equal on every fixture, so a record that lost a field
 * or an entry would fail rather than pass quietly.
 */
export function blockEventsOf(built: PromptBuilt): readonly AssemblerEvent[] {
  const events: AssemblerEvent[] = [];
  for (const omission of built.omitted) {
    if (omission.reason !== "over-budget") continue;
    const fields: BlockEventFields = Object.freeze({
      block: omission.id,
      assembledBytes: omission.assembledBytes ?? 0,
      blockBytes: omission.blockBytes,
      budgetBytes: omission.budgetBytes ?? 0,
    });
    events.push(
      Object.freeze({
        type: omission.protected
          ? PROMPT_BLOCK_PROTECTED.catalogueType
          : PROMPT_BLOCK_DROPPED.catalogueType,
        fields,
      }),
    );
  }
  return Object.freeze(events);
}

/** The `prompt.block_protected` events derived from the record (W-X-20). */
export function protectedEventsOf(built: PromptBuilt): readonly AssemblerEvent[] {
  return Object.freeze(
    blockEventsOf(built).filter((event) => event.type === PROMPT_BLOCK_PROTECTED.catalogueType),
  );
}

/** The `prompt.block_dropped` events derived from the record (W-X-20). */
export function droppedEventsOf(built: PromptBuilt): readonly AssemblerEvent[] {
  return Object.freeze(
    blockEventsOf(built).filter((event) => event.type === PROMPT_BLOCK_DROPPED.catalogueType),
  );
}

/**
 * F103-FR-034 — the fields every block of a pass carries in `prompt.built`.
 * Named here so that a test asserts the LIST the requirement gives and not a
 * list it copied from the type.
 */
export const FIELDS_OF_A_BUILT_BLOCK = [
  "id",
  "bytes",
  "hash",
  "writer",
  "protected",
  "stable",
] as const;

/**
 * F103-FR-034 and F103-SC-003 — every block OFFERED to the assembler is
 * either in `blocks` with all six fields, or in `omitted` with its reason.
 * This returns what is missing, so a test reports WHICH block was lost rather
 * than a bare `false`.
 */
export function blocksNotAccountedFor(
  built: PromptBuilt,
  offeredIds: readonly string[],
): readonly string[] {
  const present = new Set(built.blocks.map((block) => block.id));
  const recorded = new Set(built.omitted.map((omission) => omission.id));
  return Object.freeze(offeredIds.filter((id) => !present.has(id) && !recorded.has(id)));
}
