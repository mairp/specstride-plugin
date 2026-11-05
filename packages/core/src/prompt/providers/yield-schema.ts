/**
 * T065 of feature 103 — the YIELD ARTIFACT SCHEMA provider, the one BUDGETED
 * block (F103-FR-030, F103-FR-032, F103-FR-033).
 *
 * The seventh of the nine shipped providers, and the only one that the budget
 * of F103-FR-033 was written for. Three rules meet in it:
 *
 *  1. It is added LAST and only if what is assembled so far plus its own size
 *     fits `loop.promptMaxBytes` (F103-FR-033, record B-0296). The assembler
 *     puts it last — `YIELD_CONTRACT_BLOCK_ID` of `../assembler.ts`.
 *  2. It is the DEFAULT member of `loop.promptProtectedBlocks` (B-0076), so by
 *     default it is KEPT over the budget and the fact is said out loud, with
 *     the line and the event of F103-FR-033.
 *  3. Its CONTENT is fixed by F103-FR-032 and B-0297: a
 *     `specstride-pass-yield/v1` example with `reason`, `job.mode` (`launch`
 *     or `adopt`), `resume_when.kind`, the REQUIRED `deadline_sec` and
 *     `on_resume`; the instruction to write it atomically and to stop without
 *     phase evidence instead of waiting inside a pass; and it does NOT
 *     advertise the predicate `command`.
 *
 * The last of those is a rule about what the block must NOT say, so
 * `ADVERTISES_THE_COMMAND_PREDICATE` states it as data and the test asserts
 * the word is absent from the rendered text rather than trusting the prose.
 */
import { YIELD_CONTRACT_BLOCK_ID, blockOf } from "../assembler.ts";
import type {
  Block,
  PassContext,
  PromptBlockProvider,
} from "@specstride/contracts/ep/prompt-block";

/** The id of the block — the one the budget's default protects (B-0076). */
export const BLOCK_ID = YIELD_CONTRACT_BLOCK_ID;
export const WRITER = "core/prompt/providers/yield-schema" as const;

/** F103-FR-033 — the block is added LAST. */
export const ADDED_LAST = true as const;

/** B-0076 — it is the default member of `loop.promptProtectedBlocks`. */
export const PROTECTED_BY_DEFAULT = true as const;

/** The size the provider declares. */
export const DECLARED_SIZE = 4_000 as const;

/** The contract of the artifact (F103-FR-032). */
export const CONTRACT = "specstride-pass-yield/v1" as const;

/** The two modes of a job (F103-FR-032, B-0297). */
export const JOB_MODES = ["launch", "adopt"] as const;

/** The predicates `resume_when.kind` takes. */
export const RESUME_WHEN_KINDS = [
  "exit_code_file",
  "pid",
  "file_exists",
  "file_stable",
  "grep",
] as const;

/** B-0297 — the block does NOT advertise the predicate `command`. */
export const ADVERTISES_THE_COMMAND_PREDICATE = false as const;
export const THE_PREDICATE_NOT_ADVERTISED = "command" as const;

/** F103-FR-032 — the two fields the example must mark as required. */
export const REQUIRED_FIELDS = ["deadline_sec", "on_resume"] as const;

/** The heading of the block. */
export const HEADING =
  "## If this phase depends on a job that cannot finish inside one pass: YIELD" as const;

/** The example, exactly the fields F103-FR-032 and B-0297 name. */
export function exampleOf(path: string, cwd: string): string {
  return [
    "```json",
    `{"contract": "${CONTRACT}",`,
    ` "reason": "one line: what you are waiting on and why the evidence needs it",`,
    ` "job": {"mode": "launch", "argv": ["/usr/bin/make", "live"], "cwd": "${cwd}"},`,
    ` "resume_when": {"kind": "exit_code_file"},`,
    ` "deadline_sec": 7200,`,
    ` "on_resume": "exactly what the next pass should do with the result"}`,
    "```",
    `Write it ATOMICALLY (a temporary name, then \`mv\`) to ${path}, then STOP`,
    "without writing phase evidence. Do NOT sleep, poll or tail a long job inside",
    "a pass: a pass that waits is killed at its ceiling, and the kill reaches the",
    "job, because a job started from inside the pass lives in the pass's process",
    "tree.",
    `\`job.mode\` is one of ${JOB_MODES.join(" or ")}; \`resume_when.kind\` is one of`,
    `${RESUME_WHEN_KINDS.join(", ")}. \`deadline_sec\` and \`on_resume\` are REQUIRED.`,
    "A yield is not a failure: it is not an error, not a stall, and by default it",
    "does not burn an iteration.",
  ].join("\n");
}

/** What the provider is given. */
export type YieldSchemaInput = {
  /** Where the artifact is to be written. */
  readonly artifactPath: string;
  /** The working directory the example's job runs in. */
  readonly workingDirectory: string;
};

/** The text of the block. */
export function yieldSchemaText(input: YieldSchemaInput): string {
  return [HEADING, exampleOf(input.artifactPath, input.workingDirectory)].join("\n");
}

/**
 * The provider. The block is STABLE in content — the same bytes in every pass
 * of a phase attempt — but it is declared `volatile` because F103-FR-033 puts
 * it LAST in the prompt, after every volatile block. A stable block that
 * stands last would make the stable start of F103-FR-036 claim the whole
 * prompt; `stability` here says where the block GOES, and last is last.
 */
export function yieldSchemaProvider(input: YieldSchemaInput): PromptBlockProvider & {
  readonly id: typeof BLOCK_ID;
  readonly writer: typeof WRITER;
  readonly protected: true;
} {
  return Object.freeze({
    id: BLOCK_ID,
    writer: WRITER,
    declaredSize: DECLARED_SIZE,
    protected: true as const,
    blocks(_context: PassContext): readonly Block[] {
      return Object.freeze([
        blockOf({
          id: BLOCK_ID,
          text: yieldSchemaText(input),
          writer: WRITER,
          protected: true,
          stability: "volatile",
        }),
      ]);
    },
  });
}
