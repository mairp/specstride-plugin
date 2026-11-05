/**
 * T035 — the log record of a paid task and the reader of the log, F113-FR-038
 * and F113-FR-039 (implemented together with T028, which first exercised it).
 *
 * A paid task (the trigger suite, the behaviour smoke, the with-and-without
 * report) is started by a PERSON and is logged. The fields of the record are
 * the row "Log record of a paid task" of data-model.md, in its order:
 *
 * | date | task | model ids (from the configuration of the run) | number of
 * calls | cost | hash of the skill texts | result per skill | runs not scored |
 *
 * No module here calls a model. The log is written by the person's run and
 * read by the release check (`./release-check.ts`), which calls no model.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** The paid tasks of this host (F113-FR-038, F113-FR-040). */
export const PAID_TASK_NAMES = [
  "trigger-suite",
  "behaviour-smoke",
  "with-and-without-report",
] as const;
export type PaidTaskName = (typeof PAID_TASK_NAMES)[number];

/**
 * F113-FR-039 — the exit codes of an interrupted run. Research R3v C7: exit
 * 130 and 143 are interruptions. An interrupted run and a run ended by a usage
 * limit are NOT a score failure; the suite reports them as not scored.
 */
export const INTERRUPTED_EXIT_CODES: readonly number[] = Object.freeze([130, 143]);

/** The marker a run carries when the host ended it on its usage limit. */
export const USAGE_LIMIT_MARKER = "usage-limit" as const;

/** Why a run was not scored. */
export type NotScoredReason = "interrupted" | "usage-limit" | "not-started";

/** The result of one skill inside one recorded run. */
export type SkillResult = {
  /** The logical id of the skill (row 144 of annex X §X.6). */
  readonly skill: string;
  /** The score of each completed run of the suite, between 0 and 1. */
  readonly scores: readonly number[];
  /** False where the run was interrupted or ended by a usage limit. */
  readonly scored: boolean;
  /** Why the run is not scored, where it is not. */
  readonly notScoredReason?: NotScoredReason;
  /** The exit code of an interrupted run, where there was one. */
  readonly interruptedExitCode?: number;
};

/**
 * One record of the log of a paid task — the row of data-model.md, field for
 * field, in its order.
 */
export type PaidRunRecord = {
  /** The date of the run (ISO-8601). */
  readonly date: string;
  /** Which paid task ran. */
  readonly task: PaidTaskName;
  /** The model ids, from the CONFIGURATION of the run, never from a file. */
  readonly modelIds: readonly string[];
  /** The number of model calls the run made. */
  readonly calls: number;
  /** The cost of the run, in the currency of the credential. */
  readonly cost: string;
  /** The hash of the skill texts the run measured (sha256, hex). */
  readonly skillTextsHash: string;
  /** The result per skill. */
  readonly resultPerSkill: readonly SkillResult[];
  /** The runs that were not scored, with their reason. */
  readonly runsNotScored: readonly { readonly skill: string; readonly reason: NotScoredReason }[];
};

/** True where the record is well formed enough for the release check to read. */
export function isPaidRunRecord(value: unknown): value is PaidRunRecord {
  const record = value as PaidRunRecord;
  return (
    typeof record === "object" &&
    record !== null &&
    typeof record.date === "string" &&
    (PAID_TASK_NAMES as readonly string[]).includes(record.task) &&
    Array.isArray(record.modelIds) &&
    typeof record.calls === "number" &&
    typeof record.cost === "string" &&
    typeof record.skillTextsHash === "string" &&
    Array.isArray(record.resultPerSkill) &&
    Array.isArray(record.runsNotScored)
  );
}

/**
 * Classifies how a run ended, from its exit code and its marker. F113-FR-039:
 * an interrupted run and a run ended by a usage limit are not scored.
 */
export function howARunEnded(exitCode: number | null, marker?: string): NotScoredReason | "scored" {
  if (marker === USAGE_LIMIT_MARKER) return "usage-limit";
  if (exitCode !== null && INTERRUPTED_EXIT_CODES.includes(exitCode)) return "interrupted";
  return "scored";
}

/**
 * The hash of the skill texts a run measured: the sha256 of the rendered
 * skills, joined in the order of row 144. The writer of the record computes
 * it; the release check matches it (`./release-check.ts`).
 */
export function skillTextsHashOf(texts: readonly string[]): string {
  return createHash("sha256").update(texts.join("\u0000"), "utf8").digest("hex");
}

/**
 * Appends one record to the log at `logPath` (JSON lines, one record a line),
 * and returns what was written. The person's run calls this; nothing of the
 * build does.
 */
export function appendRunRecord(logPath: string, record: PaidRunRecord): string {
  const line = `${JSON.stringify(record)}\n`;
  appendFileSync(logPath, line, "utf8");
  return line;
}

/** Reads the log back, skipping lines that are not well-formed records. */
export function readRunLog(logPath: string): readonly PaidRunRecord[] {
  const content = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  return Object.freeze(
    content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown)
      .filter(isPaidRunRecord),
  );
}

/**
 * F113-FR-039 — a run for which the configuration names no model is refused
 * BEFORE ANY CALL. The refusal is this error; the caller throws it before it
 * starts the host's suite runner, so no call is made.
 */
export class RunRefusedError extends Error {
  override readonly name = "RunRefusedError";
  constructor(detail: string) {
    super(`refused before any call: ${detail} (F113-FR-039)`);
  }
}

/**
 * F113-FR-039 — the model of a suite run, and of the judge where a grader uses
 * one, comes from the CONFIGURATION of the run, given by the person who starts
 * it. A configuration that names no model is refused here, before any call.
 */
export function modelIdsFromConfiguration(config: {
  readonly modelIds?: readonly string[];
  readonly judgeModelIds?: readonly string[];
}): readonly string[] {
  const modelIds = config.modelIds ?? [];
  if (modelIds.length === 0) {
    throw new RunRefusedError("the configuration of the run names no model");
  }
  return Object.freeze([...modelIds]);
}
