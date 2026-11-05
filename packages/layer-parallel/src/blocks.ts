/**
 * T088 — the worker block, the reserved-tasks block and the neutral handoff
 * (feature 142, F142-FR-069; rule PU-103).
 *
 * What the runtime tells a proposer about parallel work is minimal and neutral:
 *
 *  - the prompt of a **worker** names its task and its scope and names no
 *    sibling, count, index or group;
 *  - the **reserved-tasks** block of the main line says up to which task to work
 *    and does not say why;
 *  - after a group the **handoff** lists the integrated tasks as kept units of
 *    work in the words used for a serial unit.
 *
 * A proposer can still describe its work in the phase evidence: that channel is
 * narrowed and not closed, and the documentation of the option must say so —
 * `WHAT_THE_DOCUMENTATION_MUST_SAY` is that sentence.
 *
 * The three blocks are built here and nowhere else, and each is built from a
 * shape that holds nothing it may not say. The handoff takes a list of task ids
 * and a word for the unit; it cannot name a worker because it is given none.
 * The module is pure: the hashing of a block (§D.5) arrives as an argument.
 */
import type { PromptBlock } from "@specstride/contracts/ep/loop-layer";

import { RESERVED_TASKS_BLOCK_ID, reservedTasksBlockText } from "./decide.ts";

/* ================================================================== *
 * 1. What F142-FR-069 forbids in any of the three blocks.
 * ================================================================== */

/** The four things a worker's prompt never names (F142-FR-069, PU-103). */
export const A_WORKER_PROMPT_NEVER_NAMES = Object.freeze([
  "a sibling",
  "a count",
  "an index",
  "a group",
] as const);

/** The words that would name one of them, read case-insensitively. */
export const FORBIDDEN_WORDS: readonly RegExp[] = Object.freeze([
  /\bworkers?\b/i,
  /\bsiblings?\b/i,
  /\bgroups?\b/i,
  /\bparallel\b/i,
  /\bconcurrent(ly)?\b/i,
  /\bat the same time\b/i,
  /\bindex\b/i,
  /\bother tasks?\b/i,
  /\bwhile\b/i,
  // A count or an index of the group, however it is written.
  /\b\d+\s+of\s+\d+\b/i,
  /\bof (two|three|four)\b/i,
  /\b(first|second|third|fourth|last) (task|pass)\b/i,
]);

/**
 * The words of a block that F142-FR-069 forbids (empty on every block built
 * here). `exempt` holds text that came from the project itself — the text of a
 * task, which the serial run of the same fixture carries too: a word of the
 * project's own text is not a finding, as `contracts/vocabulary.json` puts it.
 * Only what the **runtime** wrote is searched.
 */
export function forbiddenWordsIn(text: string, exempt: readonly string[] = []): readonly string[] {
  let runtimeWords = text;
  for (const own of exempt) {
    if (own.length > 0) runtimeWords = runtimeWords.split(own).join(" ");
  }
  return Object.freeze(
    FORBIDDEN_WORDS.filter((pattern) => pattern.test(runtimeWords)).map(
      (pattern) => pattern.source,
    ),
  );
}

/** F142-FR-069 — the evidence channel is narrowed and not closed. */
export const THE_EVIDENCE_CHANNEL_IS_CLOSED = false as const;
export const WHAT_THE_DOCUMENTATION_MUST_SAY =
  "A proposer can still describe its work in the phase evidence of its phase: the " +
  "channel through which a proposer could tell a critic that work ran in parallel " +
  "is narrowed and not closed (F142-FR-069).";

/** The writer of every block of this layer, as §D.5 names a writer. */
export const WRITER = "parallel" as const;

/** Build a block of §D.5 from its id and its text. */
export function blockOf(input: {
  readonly id: string;
  readonly text: string;
  readonly hash: (text: string) => string;
  readonly stability?: "stable" | "volatile";
}): PromptBlock {
  return Object.freeze({
    id: input.id,
    bytes: new TextEncoder().encode(input.text).length,
    hash: input.hash(input.text),
    writer: WRITER,
    protected: false,
    stability: input.stability ?? "stable",
    text: input.text,
  });
}

/* ================================================================== *
 * 2. The worker block (F142-FR-069).
 * ================================================================== */

/** The id of the block of one worker (§D.5). A worker sees only its own. */
export const WORKER_BLOCK_ID = "parallel.worker" as const;

/** What a worker's prompt is built from: its task, its text and its scope. */
export type WorkerBlockInput = {
  readonly taskId: string;
  /** The text of the task as the task list carries it, which the worker works. */
  readonly taskText: string;
  /** The normalised prefixes of its write scope; empty means the whole tree. */
  readonly prefixes: readonly string[];
  readonly hash: (text: string) => string;
};

/**
 * The text of the prompt block of one worker (F142-FR-069).
 *
 * It names the task and the scope, and the shape it is built from holds nothing
 * else: no sibling, no count, no index, no group, because `WorkerBlockInput`
 * carries none of them. The scope is written as the list of prefixes; an empty
 * list is written as the whole tree, so that a worker is never left guessing.
 */
export function workerBlockText(input: WorkerBlockInput): string {
  const where =
    input.prefixes.length === 0
      ? "Write anywhere in the tree."
      : `Write only inside ${[...input.prefixes].join(", ")}. Write nowhere else.`;
  return [`Work ${input.taskId}: ${input.taskText}`, where].join("\n");
}

/** The prompt block of one worker (F142-FR-069). */
export function workerBlock(input: WorkerBlockInput): PromptBlock {
  return blockOf({
    id: `${WORKER_BLOCK_ID}.${input.taskId}`,
    text: workerBlockText(input),
    hash: input.hash,
  });
}

/* ================================================================== *
 * 3. The reserved-tasks block of the main line (F142-FR-069).
 * ================================================================== */

/** The id of the reserved-tasks block, the one of `decide.ts` (DV-088). */
export const RESERVED_TASKS_ID = RESERVED_TASKS_BLOCK_ID;

/**
 * The reserved-tasks block of the main line (F142-FR-069). The text is the one
 * `decide.ts` builds — the two modules share it so that they cannot drift — and
 * this function gives it the form of §D.5. It says up to which task to work and
 * does not say why: no reason, no group, no worker.
 */
export function reservedTasksBlock(input: {
  readonly reserved: readonly string[];
  readonly hash: (text: string) => string;
}): PromptBlock | null {
  const text = reservedTasksBlockText(input.reserved);
  if (text.length === 0) return null;
  return blockOf({ id: RESERVED_TASKS_ID, text, hash: input.hash, stability: "volatile" });
}

/** F142-FR-069 — the reserved-tasks block does not say why a task is reserved. */
export const THE_RESERVED_TASKS_BLOCK_SAYS_WHY = false as const;

/* ================================================================== *
 * 4. The neutral handoff after a group (F142-FR-069).
 * ================================================================== */

/** The id of the handoff block (§D.5). */
export const HANDOFF_BLOCK_ID = "parallel.handoff" as const;

/**
 * The words a kept unit of work is listed in. They are the words of a **serial**
 * unit: the handoff after a group uses these and no others, which is what makes
 * it neutral (F142-FR-069).
 */
export const WORDS_OF_A_KEPT_UNIT = Object.freeze({
  heading: "Kept units of work:",
  unit: (tasks: readonly string[]) => `- ${[...tasks].sort().join(", ")}`,
} as const);

/** What the handoff is built from: the tasks of each kept unit, and nothing else. */
export type HandoffInput = {
  /** One entry per kept unit of work, each the tasks that unit named. */
  readonly keptUnits: readonly (readonly string[])[];
  readonly hash: (text: string) => string;
};

/**
 * The text of the handoff after a group (F142-FR-069).
 *
 * The integrated tasks are listed as kept units of work in the words of
 * `WORDS_OF_A_KEPT_UNIT`, which is what a serial unit is listed in. A handoff
 * built from one group of two tasks and a handoff built from one serial pass that
 * named the same two tasks are therefore the same text, byte for byte — which is
 * the property `handoffsAreIdentical` states and the tests of F142-SC-005
 * observe.
 */
export function handoffText(keptUnits: readonly (readonly string[])[]): string {
  if (keptUnits.length === 0) return "";
  return [
    WORDS_OF_A_KEPT_UNIT.heading,
    ...keptUnits.map((tasks) => WORDS_OF_A_KEPT_UNIT.unit(tasks)),
  ].join("\n");
}

/** The handoff block after a group, or `null` where no unit was kept. */
export function handoffBlock(input: HandoffInput): PromptBlock | null {
  const text = handoffText(input.keptUnits);
  if (text.length === 0) return null;
  return blockOf({ id: HANDOFF_BLOCK_ID, text, hash: input.hash, stability: "volatile" });
}

/**
 * True where the handoff of a run through a group and the handoff of a serial run
 * that kept the same units are the same text (F142-FR-069, F142-SC-005).
 */
export function handoffsAreIdentical(
  throughAGroup: readonly (readonly string[])[],
  serial: readonly (readonly string[])[],
): boolean {
  return handoffText(throughAGroup) === handoffText(serial);
}

/* ================================================================== *
 * 5. The three blocks together.
 * ================================================================== */

/** The three blocks this feature writes for a proposer (F142-FR-069). */
export const BLOCKS = Object.freeze(["worker", "reserved-tasks", "handoff"] as const);
export type BlockKind = (typeof BLOCKS)[number];

/** Every block of this layer that a prompt may hold, in the order of `BLOCKS`. */
export function blocksOf(input: {
  readonly worker?: WorkerBlockInput;
  readonly reserved?: readonly string[];
  readonly keptUnits?: readonly (readonly string[])[];
  readonly hash: (text: string) => string;
}): readonly PromptBlock[] {
  const blocks: PromptBlock[] = [];
  if (input.worker !== undefined) blocks.push(workerBlock(input.worker));
  if (input.reserved !== undefined) {
    const block = reservedTasksBlock({ reserved: input.reserved, hash: input.hash });
    if (block !== null) blocks.push(block);
  }
  if (input.keptUnits !== undefined) {
    const block = handoffBlock({ keptUnits: input.keptUnits, hash: input.hash });
    if (block !== null) blocks.push(block);
  }
  return Object.freeze(blocks);
}

/**
 * The blocks whose text holds a word F142-FR-069 forbids; empty, always.
 * `exempt` holds the project's own text — the text of the tasks — which the
 * serial run carries as well and which is therefore no finding.
 */
export function blocksThatSayTooMuch(
  blocks: readonly PromptBlock[],
  exempt: readonly string[] = [],
): readonly { readonly id: string; readonly words: readonly string[] }[] {
  return Object.freeze(
    blocks
      .map((block) => Object.freeze({ id: block.id, words: forbiddenWordsIn(block.text, exempt) }))
      .filter((entry) => entry.words.length > 0),
  );
}
