/**
 * T176 — the type and the validator of the yield artifact from
 * `schemas/yield-artifact.schema.json` (annex D, §D.6; F100-FR-133,
 * F100-FR-134).
 *
 * Schema id `specstride-pass-yield/v1` — the as-is name is kept. The proposer
 * writes it into `feature:<slug>:outbox` as a CLAIM; it is moved to
 * `job:<jobId>:yield` when read. The engine is its only reader. Content owner
 * 118, which may add kinds of predicate through a new minor.
 *
 * The record names its schema in the field `contract`, not `schema`, so it is
 * validated by schema id: a `contract` that names another major is refused
 * with both majors (as the overlay of §C.16 is, T172).
 */
import type { YieldArtifact as Generated } from "./generated/yield-artifact.ts";
import { validate, type SchemaError } from "./compile.ts";
import { majorOf } from "./validate.ts";

/** The schema id the record carries in its field `contract`. */
export const SCHEMA_ID = "specstride-pass-yield/v1" as const;

/** The field that carries the schema id of this record (§D.6). */
export const SCHEMA_FIELD = "contract" as const;

/** Where the proposer writes it, and where it is moved when read (§D.6). */
export const LOGICAL_NAME = "feature:<slug>:outbox" as const;
export const MOVED_TO_WHEN_READ = "job:<jobId>:yield" as const;

/** The section of annex D that owns the field list. */
export const ANNEX_SECTION = "annex D, §D.6" as const;

/** The content owner of §D.6. */
export const CONTENT_OWNER = "118" as const;

/** The record is read as a claim under the rules of annex B §B.2 (F100-FR-133). */
export const READ_AS_A_CLAIM = true as const;
export const CLAIM_RULES = "annex B, §B.2" as const;

/** The two modes of a job (§D.6, `job.mode`). */
export const JOB_MODES = ["launch", "adopt"] as const;
export type JobMode = (typeof JOB_MODES)[number];

/** The seven kinds of resume predicate (§D.6, `resume_when.kind`). */
export const RESUME_WHEN_KINDS = [
  "pid",
  "exit_code_file",
  "file_exists",
  "file_stable",
  "grep",
  "command",
  "first_failure",
] as const;
export type ResumeWhenKind = (typeof RESUME_WHEN_KINDS)[number];

/** The two values of `on_first_failure` (§D.6). */
export const ON_FIRST_FAILURE_VALUES = ["stop", "continue-and-notify"] as const;
export type OnFirstFailure = (typeof ON_FIRST_FAILURE_VALUES)[number];

/** The yield artifact of a pass (annex D, §D.6). */
export type YieldArtifact = Generated;

/**
 * The fields the table of §D.6 requires unconditionally: `contract`,
 * `reason`, `deadline_sec`. `job.mode` and `resume_when.kind` are required
 * inside their record; the rest are required by the condition of their row.
 */
export const REQUIRED_ALWAYS = ["contract", "reason", "deadline_sec"] as const;

/** The conditional "Required" cells of §D.6, each as a rule. */
export const REQUIRED_BY_CONDITION = Object.freeze({
  "job.argv": "With `launch`" as const,
  "job.pid": "With `adopt`" as const,
  "resume_when.stable_sec": "With `file_stable`" as const,
  "resume_when.pid": "With `pid`" as const,
  "resume_when.argv": "With `command`" as const,
  on_first_failure: "With `first_failure`" as const,
});

/** What each kind of predicate needs, from the rows of §D.6. */
export const PREDICATE_NEEDS: Readonly<Record<ResumeWhenKind, readonly string[]>> = Object.freeze({
  pid: Object.freeze(["pid"]),
  exit_code_file: Object.freeze([]),
  file_exists: Object.freeze(["path"]),
  file_stable: Object.freeze(["path", "stable_sec"]),
  grep: Object.freeze(["path", "pattern"]),
  command: Object.freeze(["argv"]),
  first_failure: Object.freeze([]),
});

/** Why a yield artifact was refused. */
export type YieldRefusal =
  | "not-a-record"
  | "missing-contract"
  | "different-major"
  | "invalid"
  | "command-not-allowed"
  | "worker-of-a-parallel-group";

/** A yield artifact that §D.6 refuses. */
export class YieldRefusedError extends Error {
  readonly reason: YieldRefusal;
  readonly majorFound: string;
  readonly majorSupported: string;
  readonly errors: readonly SchemaError[];

  constructor(init: {
    reason: YieldRefusal;
    message: string;
    majorFound?: string;
    majorSupported?: string;
    errors?: readonly SchemaError[];
  }) {
    super(init.message);
    this.name = "YieldRefusedError";
    this.reason = init.reason;
    this.majorFound = init.majorFound ?? "—";
    this.majorSupported = init.majorSupported ?? majorOf(SCHEMA_ID);
    this.errors = Object.freeze([...(init.errors ?? [])]);
  }
}

/** What the caller tells the reader about the pass that wrote the claim. */
export type YieldContext = {
  /** F100-FR-133 — the predicate `command` is refused unless the consumer allowed it. */
  readonly consumerAllowedCommandPredicate?: boolean | undefined;
  /** F100-FR-133 — a worker of a parallel group MUST NOT yield. */
  readonly writtenByAWorkerOfAParallelGroup?: boolean | undefined;
};

/**
 * Read a yield artifact (annex D, §D.6; F100-FR-133).
 *
 * The field `contract` is required and names `specstride-pass-yield/v1`;
 * another major is refused with the major found and the major supported;
 * every required field of §D.6 is required. The predicate `command` is
 * refused unless the consumer allowed it, and a claim written by a worker of
 * a parallel group is refused.
 */
export function readYieldArtifact(value: unknown, context: YieldContext = {}): YieldArtifact {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new YieldRefusedError({
      reason: "not-a-record",
      message: "refused the yield artifact: it is no record (annex D, §D.6)",
    });
  }
  const carried = (value as { contract?: unknown }).contract;
  if (typeof carried !== "string" || carried === "") {
    throw new YieldRefusedError({
      reason: "missing-contract",
      message:
        `refused the yield artifact: it carries no field \`${SCHEMA_FIELD}\`, which names ` +
        `the schema id "${SCHEMA_ID}" (annex D, §D.6)`,
    });
  }
  if (carried !== SCHEMA_ID) {
    const majorFound = majorOf(carried);
    const majorSupported = majorOf(SCHEMA_ID);
    throw new YieldRefusedError({
      reason: "different-major",
      majorFound,
      majorSupported,
      message:
        `refused the yield artifact of the logical name "${LOGICAL_NAME}": the major found ` +
        `is ${majorFound}, the major supported is ${majorSupported} (F100-FR-049)`,
    });
  }
  const result = validate<YieldArtifact>(SCHEMA_ID, value);
  if (!result.ok) {
    throw new YieldRefusedError({
      reason: "invalid",
      message:
        "refused the yield artifact: " +
        result.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
      errors: result.errors,
    });
  }
  const record = result.record;
  if (context.writtenByAWorkerOfAParallelGroup === true) {
    throw new YieldRefusedError({
      reason: "worker-of-a-parallel-group",
      message:
        "refused the yield artifact: a worker of a parallel group does not yield " +
        "(F100-FR-133)",
    });
  }
  if (record.resume_when?.kind === "command" && context.consumerAllowedCommandPredicate !== true) {
    throw new YieldRefusedError({
      reason: "command-not-allowed",
      message:
        "refused the yield artifact: the predicate `command` needs the consumer's " +
        "permission (F100-FR-133)",
    });
  }
  return record;
}

/** `readYieldArtifact` that returns a result instead of throwing. */
export function tryReadYieldArtifact(
  value: unknown,
  context: YieldContext = {},
): { ok: true; record: YieldArtifact } | { ok: false; error: YieldRefusedError } {
  try {
    return { ok: true, record: readYieldArtifact(value, context) };
  } catch (err) {
    if (err instanceof YieldRefusedError) return { ok: false, error: err };
    throw err;
  }
}

/** True when the value validates against `specstride-pass-yield/v1`. */
export function isYieldArtifact(value: unknown): value is YieldArtifact {
  return validate<YieldArtifact>(SCHEMA_ID, value).ok;
}

/* ------------------------------------------------------------------ *
 * F100-FR-134 — the first-failure predicate and the polite stop are
 * switches of their own.
 * ------------------------------------------------------------------ */

/** The switch of the first-failure predicate: on by default (F100-FR-134). */
export const FAILFAST_SWITCH = "verification.failfast" as const;
export const FAILFAST_DEFAULT = true as const;

/** It does not ride on the switch of a loop layer (F100-FR-134). */
export const FAILFAST_RIDES_ON_A_LOOP_LAYER = false as const;

/** The switch of the polite stop: on by default (F100-FR-134). */
export const POLITE_STOP_SWITCH = "carry.polite_stop" as const;
export const POLITE_STOP_DEFAULT = true as const;

/** The polite stop is an interrupt before a termination, with a grace period. */
export const POLITE_STOP_FORM = "an interrupt before a termination, with a grace period" as const;

/** The default of `on_first_failure` (F100-FR-134). */
export const ON_FIRST_FAILURE_DEFAULT: OnFirstFailure = "stop";

/** `continue-and-notify` as the default is an option that is off (F100-FR-134). */
export const CONTINUE_AND_NOTIFY_AS_THE_DEFAULT_IS_ON = false as const;

/**
 * F100-FR-134 — the runtime stops a job only if it launched the job and the
 * yield declared `stop`; otherwise the wait ends and the job runs on.
 */
export function stopsTheJob(input: {
  readonly launchedByTheRuntime: boolean;
  readonly onFirstFailure?: OnFirstFailure | undefined;
}): boolean {
  const declared = input.onFirstFailure ?? ON_FIRST_FAILURE_DEFAULT;
  return input.launchedByTheRuntime && declared === "stop";
}

/** The rows of §X.7 that switch the first-failure predicate off under `parity`. */
export const PARITY_ROWS = [4, 5, 11] as const;

export type { SchemaError };
