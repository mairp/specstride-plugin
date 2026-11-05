/**
 * T065 of feature 103 — THE BLOCK SET `as-is` (F103-FR-031, F103-FR-032).
 *
 * The `parity` profile selects this set (row 12 of annex X §X.7,
 * `prompt.block_set`). Under it the prompt of a pass holds FIVE BLOCKS in one
 * fixed order, joined by ONE BLANK LINE, each present only when it is not
 * empty, and the result must equal the baseline's BYTE FOR BYTE.
 *
 * ## Where the order and the headings come from
 *
 * Not from this file. The baseline's shell sources at `9cab15d` are not in
 * this repository; what the repository holds is the
 * BEHAVIOUR INVENTORY of research report R18, one row per observed behaviour
 * with the as-is text in back-ticks and the file and line it was read at. The
 * parity test `tests/parity/103/golden-prompts.test.ts` READS those rows and
 * compares this module's output with the text they carry, so the port cannot
 * drift from the record:
 *
 * | Row | What it fixes |
 * |---|---|
 * | B-0764 (`proposer.sh:2007`) | the order of the five blocks, the blank-line join, and "each is present only when non-empty" |
 * | B-0374 (`specstride-lib.sh:508`) | the heading and the three states of the detached-job block |
 * | B-0645 (`proposer.sh:1141`) | the heading of the block of the kill note |
 * | B-0648 (`proposer.sh:1557`) | the heading of the block that resumes after a yield |
 * | B-0651 (`proposer.sh:1952`) | the heading of the block that nudges after short passes |
 * | B-0755 (`proposer.sh:1784`) | the pass loop injects no feedback, hint, acceleration note or notebook: the standing prompt holds them |
 * | B-0295…B-0301 | the order of the STANDING PROMPT of F103-FR-032 (the rows name their own file and line) |
 *
 * ## Who owns the CONTENT of blocks 2 to 5
 *
 * Not this feature. The detached job, the kill note, the yield resume and the
 * short-pass nudge belong to the watchdog-and-yield feature (118) and the dsh
 * plugin protocol section to the harness adapter (130); `spec.md` of this
 * feature says so, and `OWNER_OF` below names them. What this feature owns is
 * the PLACE of each block in the order and the rule that joins them — which
 * is exactly what F103-FR-031 asks of it. So each block is a SLOT: the caller
 * hands the text, this module fixes where it goes and what happens when it is
 * empty.
 *
 * Boundary: `@specstride/contracts` and `@specstride/kernel` only
 * (F100-FR-012).
 */
import { contentHash } from "@specstride/kernel/hasher";
import type { Block } from "@specstride/contracts/ep/prompt-block";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-031", "F103-FR-032"] as const;

/** The block set this module is. */
export const BLOCK_SET = "as-is" as const;

/** F103-FR-031 — the `parity` profile selects it (row 12 of annex X §X.7). */
export const SELECTED_BY_THE_PARITY_PROFILE = true as const;

/** F103-FR-031 — the prompt must equal the baseline's byte for byte. */
export const BYTE_FOR_BYTE = true as const;

/** F103-FR-031 — the blocks are joined by ONE BLANK LINE. */
export const JOIN = "\n\n" as const;

/** F103-FR-031 — a block is present only when it is not empty. */
export const AN_EMPTY_BLOCK_IS_PRESENT = false as const;

/**
 * F103-FR-031 — the pass loop injects NO feedback, hint, acceleration note or
 * notebook of its own: the standing prompt already holds them (B-0755).
 */
export const THE_LOOP_INJECTS_FEEDBACK_ITSELF = false as const;
export const WHAT_THE_LOOP_NEVER_INJECTS = [
  "feedback",
  "hint",
  "acceleration note",
  "notebook",
] as const;

/* ------------------------------------------------------------------ *
 * The five blocks, in the fixed order of B-0764.
 * ------------------------------------------------------------------ */

/**
 * The ids of the five blocks of the set `as-is`, IN ORDER. The names are the
 * ones B-0764 uses for them.
 */
export const AS_IS_BLOCK_IDS = [
  "standing_prompt",
  "long_job_status",
  "kill_note",
  "yield_resume",
  "short_pass_nudge",
] as const;
export type AsIsBlockId = (typeof AS_IS_BLOCK_IDS)[number];

/** The row of the behaviour inventory that fixes each block. */
export const RECORD_OF: Readonly<Record<AsIsBlockId, string>> = Object.freeze({
  standing_prompt: "B-0755",
  long_job_status: "B-0374",
  kill_note: "B-0645",
  yield_resume: "B-0648",
  short_pass_nudge: "B-0651",
});

/** The row that fixes the ORDER of all five and the rule that joins them. */
export const RECORD_OF_THE_ORDER = "B-0764" as const;

/** The feature that owns the CONTENT of each block. */
export const OWNER_OF: Readonly<Record<AsIsBlockId, string>> = Object.freeze({
  standing_prompt: "103",
  long_job_status: "118",
  kill_note: "118",
  yield_resume: "118",
  short_pass_nudge: "118",
});

/**
 * The HEADING of each block that has one, as its row of R18 gives it. The
 * standing prompt has no heading of its own: it is a file the engine wrote.
 */
export const HEADING_OF: Readonly<Record<Exclude<AsIsBlockId, "standing_prompt">, string>> =
  Object.freeze({
    long_job_status: "## Long-running verification job:",
    kill_note: "## Your previous pass was terminated by the harness, not by you",
    yield_resume: "## The job you yielded on has ENDED — resume from its result",
    short_pass_nudge: "## You have ended",
  });

/** B-0374 — the three states the heading of the detached-job block ends in. */
export const LONG_JOB_STATES = ["DONE", "STILL RUNNING", "launching now"] as const;

/* ------------------------------------------------------------------ *
 * The standing prompt of F103-FR-032.
 * ------------------------------------------------------------------ */

/**
 * F103-FR-032 — the parts of the standing prompt of the proposer, IN THE
 * ORDER the requirement names them. The engine writes the file; this list is
 * the ORDER the oracle compares, and the row of R18 that fixes each part.
 */
export const STANDING_PROMPT_PARTS = [
  { part: "one-phase-and-stops", record: "B-0298" },
  { part: "workdir-notebook-clean-root", record: "B-0298" },
  { part: "phase-title-and-task", record: "B-0298" },
  { part: "evidence-written-atomically", record: "B-0298" },
  { part: "evidence-contract", record: "B-0295" },
  { part: "criteria-heading-and-phase-slice", record: "B-0299" },
  { part: "document-set-context-and-verification-slice", record: "B-0300" },
  { part: "feedback-hint-acceleration", record: "B-0301" },
  { part: "yield-artifact-schema", record: "B-0297" },
] as const;
export type StandingPromptPart = (typeof STANDING_PROMPT_PARTS)[number]["part"];

/** F103-FR-032 — the yield artifact schema block is LAST. */
export const LAST_PART_OF_THE_STANDING_PROMPT: StandingPromptPart = "yield-artifact-schema";

/** B-0299 — the three criteria headings the spec format decides between. */
export const CRITERIA_HEADINGS = [
  "## OpenSpec tasks to complete",
  "## Tasks to complete",
  "## Acceptance criteria (the phase spec)",
] as const;

/** B-0300 — the verification slice is in the proposer's prompt only. */
export const VERIFICATION_SLICE_REACHES_THE_ACCELERATOR = false as const;

/** B-0297 — the yield block does NOT advertise the predicate `command`. */
export const YIELD_BLOCK_ADVERTISES_THE_COMMAND_PREDICATE = false as const;

/** F103-FR-032 — under the block set `current` the notebook is no longer the required first read. */
export const NOTEBOOK_IS_THE_REQUIRED_FIRST_READ_UNDER_CURRENT = false as const;
export const NOTEBOOK_IS_THE_REQUIRED_FIRST_READ_UNDER_AS_IS = true as const;

/* ------------------------------------------------------------------ *
 * Assembling the set.
 * ------------------------------------------------------------------ */

/** The text of each block of the set; an absent block is an empty one. */
export type AsIsTexts = Partial<Readonly<Record<AsIsBlockId, string>>>;

/**
 * The block set `as-is` as a list of BLOCKS in the form of annex D §D.5, in
 * the fixed order of B-0764, with every empty one left out.
 *
 * Every block of this set is `volatile`: under `as-is` there is no stable
 * start to keep — F103-FR-036 puts that under `current` — and the standing
 * prompt itself carries the pass's feedback and attempt number. Calling them
 * stable here would make `prompt.built` claim a cache-stable start that the
 * baseline's byte order does not have.
 */
export function asIsBlocks(texts: AsIsTexts): readonly Block[] {
  const blocks: Block[] = [];
  for (const id of AS_IS_BLOCK_IDS) {
    const text = texts[id] ?? "";
    if (text === "") continue; // F103-FR-031 — present only when not empty
    blocks.push(
      Object.freeze({
        id,
        bytes: Buffer.byteLength(text, "utf8"),
        hash: contentHash(text),
        writer: `feature-${OWNER_OF[id]}`,
        protected: false,
        stability: "volatile" as const,
        text,
      }),
    );
  }
  return Object.freeze(blocks);
}

/**
 * The prompt of a pass under the block set `as-is`: the five blocks in their
 * order, joined by one blank line, each present only when not empty.
 *
 * This is the whole of the baseline's assembly of a pass prompt. The BUDGET of
 * F103-FR-033 is the assembler's (`./assembler.ts`): the baseline appends its
 * one budgeted block — `yield_contract`, inside the standing prompt — before
 * the pass loop ever sees the file, so nothing of the five is budgeted here.
 */
export function asIsPrompt(texts: AsIsTexts): string {
  return asIsBlocks(texts)
    .map((block) => block.text)
    .join(JOIN);
}
