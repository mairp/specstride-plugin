/**
 * T043 of feature 118 — the yield artifact, read as a claim (F118-FR-015,
 * F118-FR-016, F118-FR-017; annex D §D.6; PT-118-C-058).
 *
 * The schema `specstride-pass-yield/v1` is a claim written by the proposer
 * pass and read by the engine after the pass has exited. Every refusal of
 * F118-FR-016 is one check below, in the order the requirement lists it.
 * A refused artifact is reported once, deleted and the pass is accounted
 * exactly as a pass that wrote no evidence — the caller does that; this
 * module only decides.
 *
 * `contract`, `reason`, `on_resume`, `job.argv` and the other free texts of
 * the artifact come from outside the runtime: the caller passes them through
 * the one ingress (`ports.ts`) before any sink sees them. This module reads
 * the raw form only to decide, and never copies it into a record.
 */

/** The schema identifier of the yield artifact (annex D §D.6). */
export const YIELD_CONTRACT = "specstride-pass-yield/v1" as const;

/** The default poll interval, in seconds (F118-FR-015). */
export const YIELD_POLL_DEFAULT_SEC = 30;

/** The default number of yields allowed in one phase attempt (F118-FR-015). */
export const YIELD_MAX_PER_ATTEMPT_DEFAULT = 4;

/** The seven kinds of `resume_when` (F118-FR-018; row 69 of annex X §X.6). */
export const YIELD_KINDS = [
  "pid",
  "exit_code_file",
  "file_exists",
  "file_stable",
  "grep",
  "command",
  "first_failure",
] as const;

/** The kinds that require `resume_when.path` (F118-FR-016). */
export const KINDS_REQUIRING_PATH = [
  "file_exists",
  "file_stable",
  "grep",
  "first_failure",
] as const;

/** The kinds that require a valid `resume_when.pattern` (F118-FR-016). */
export const KINDS_REQUIRING_PATTERN = ["grep", "first_failure"] as const;

/** The two actions on a first failure (row 69). */
export const FIRST_FAILURE_ACTIONS = ["stop", "continue-and-notify"] as const;

/** The two modes of the job of a yield (row 70). */
export const YIELD_JOB_MODES = ["launch", "adopt"] as const;

export type YieldKind = (typeof YIELD_KINDS)[number];
export type FirstFailureAction = (typeof FIRST_FAILURE_ACTIONS)[number];
export type YieldJobMode = (typeof YIELD_JOB_MODES)[number];

/** The raw, untrusted artifact: parsed JSON of unknown shape. */
export type RawYieldArtifact = Readonly<Record<string, unknown>>;

/** The artifact as the engine accepts it, every field checked. */
export interface YieldArtifact {
  readonly contract: typeof YIELD_CONTRACT;
  /** The raw reason; the caller admits it through the ingress before a sink. */
  readonly reason: string;
  readonly job:
    | {
        readonly mode: "launch";
        readonly argv: readonly string[];
        readonly cwd: string;
        readonly log?: string;
      }
    | { readonly mode: "adopt"; readonly pid: number; readonly cwd: string; readonly log?: string };
  readonly resumeWhen: {
    readonly kind: YieldKind;
    readonly path?: string;
    readonly pattern?: string;
    readonly stableSec?: number;
    readonly pid?: number;
    readonly argv?: readonly string[];
  };
  readonly onFirstFailure: FirstFailureAction | undefined;
  readonly deadlineSec: number;
  readonly onResume: string | undefined;
}

/** What the validator needs from the host: only "does this path exist as a directory". */
export interface YieldSchemaHost {
  /** True when `path` exists and is a directory (for `job.cwd`). */
  directoryExists(path: string): boolean;
}

/** The decision: the accepted artifact, or the refusals in the order of F118-FR-016. */
export type YieldValidation =
  | { readonly ok: true; readonly artifact: YieldArtifact }
  | { readonly ok: false; readonly refusals: readonly string[] };

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty text without a newline or a NUL character (F118-FR-016). */
export function isCleanNonEmptyText(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && !value.includes("\n") && !value.includes("\0")
  );
}

/** A non-empty list of non-empty texts without newlines or NUL characters. */
export function isCleanArgv(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((member) => isCleanNonEmptyText(member))
  );
}

/** A positive integer that is not a boolean (F118-FR-016). */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Compile `pattern`, or return `undefined` when it is not a valid regular expression. */
export function compilePattern(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

/** Validate one raw artifact against the schema of F118-FR-016. */
export function validateYieldArtifact(
  raw: unknown,
  host: YieldSchemaHost,
  options: { readonly commandAllowed: boolean },
): YieldValidation {
  const refusals: string[] = [];
  if (!isPlainObject(raw)) return { ok: false, refusals: ["the artifact is not a JSON object"] };

  if (raw["contract"] !== YIELD_CONTRACT) {
    refusals.push(`contract is not ${YIELD_CONTRACT}`);
  }
  if (!isCleanNonEmptyText(raw["reason"])) {
    refusals.push("reason is not a non-empty text");
  }
  if (!isPositiveInteger(raw["deadline_sec"])) {
    refusals.push("deadline_sec is missing, or is not a positive integer, or is a boolean");
  }
  if (raw["on_resume"] !== undefined && typeof raw["on_resume"] !== "string") {
    refusals.push("on_resume is present and is not a text");
  }

  const job = isPlainObject(raw["job"]) ? raw["job"] : undefined;
  let mode: YieldJobMode | undefined;
  let argv: readonly string[] | undefined;
  let pid: number | undefined;
  let jobLog: string | undefined;
  if (job === undefined) {
    refusals.push("job is missing");
  } else {
    if (job["mode"] !== "launch" && job["mode"] !== "adopt") {
      refusals.push("job.mode is not launch or adopt");
    } else {
      mode = job["mode"];
      if (mode === "launch" && !isCleanArgv(job["argv"])) {
        refusals.push(
          "job.argv is not a non-empty list of non-empty texts without newlines or NUL",
        );
      } else if (mode === "launch") {
        argv = job["argv"] as readonly string[];
      }
      if (mode === "adopt" && !isPositiveInteger(job["pid"])) {
        refusals.push("job.pid is not a positive integer");
      } else if (mode === "adopt") {
        pid = job["pid"] as number;
      }
    }
    if (job["log"] !== undefined && !isCleanNonEmptyText(job["log"])) {
      refusals.push("job.log is not a text");
    } else if (typeof job["log"] === "string") {
      jobLog = job["log"];
    }
  }

  // `job.cwd` defaults to the working directory and is resolved against it.
  const rawCwd = typeof job?.["cwd"] === "string" ? (job["cwd"] as string) : ".";
  const cwd = rawCwd.startsWith("/") ? rawCwd : `${rawCwd}`.replace(/^\.\//, "");
  if (!host.directoryExists(rawCwd)) {
    refusals.push("job.cwd is not an existing directory");
  }

  const resumeWhen = isPlainObject(raw["resume_when"]) ? raw["resume_when"] : undefined;
  let kind: YieldKind | undefined;
  let onFirstFailure: FirstFailureAction | undefined;
  if (resumeWhen === undefined) {
    refusals.push("resume_when is missing");
  } else {
    const rawKind = resumeWhen["kind"];
    if (typeof rawKind !== "string" || !YIELD_KINDS.includes(rawKind as YieldKind)) {
      refusals.push("resume_when.kind is outside the closed set of predicates");
    } else {
      kind = rawKind as YieldKind;
      const needsPath = (KINDS_REQUIRING_PATH as readonly string[]).includes(kind);
      const needsPattern = (KINDS_REQUIRING_PATTERN as readonly string[]).includes(kind);
      if (needsPath && !isCleanNonEmptyText(resumeWhen["path"])) {
        refusals.push(`resume_when.path is missing for the kind ${kind}`);
      }
      if (needsPattern) {
        const pattern = resumeWhen["pattern"];
        if (!isCleanNonEmptyText(pattern)) {
          refusals.push(`resume_when.pattern is missing for the kind ${kind}`);
        } else if (compilePattern(pattern) === undefined) {
          refusals.push(
            `resume_when.pattern is not a valid regular expression for the kind ${kind}`,
          );
        }
      }
      if (kind === "command") {
        if (!options.commandAllowed) {
          refusals.push("the kind command is not allowed by the consumer");
        }
        if (!isCleanArgv(resumeWhen["argv"])) {
          refusals.push("the argv of the kind command is not a non-empty list of non-empty texts");
        }
      }
      if (kind === "first_failure") {
        const action = resumeWhen["on_first_failure"];
        if (action !== "stop" && action !== "continue-and-notify") {
          refusals.push(
            "on_first_failure is missing for first_failure, or is outside stop and continue-and-notify",
          );
        } else {
          onFirstFailure = action;
        }
      }
    }
  }

  if (refusals.length > 0) return { ok: false, refusals };

  return {
    ok: true,
    artifact: {
      contract: YIELD_CONTRACT,
      reason: raw["reason"] as string,
      job:
        mode === "launch"
          ? {
              mode: "launch",
              argv: argv as readonly string[],
              cwd,
              ...(jobLog !== undefined ? { log: jobLog } : {}),
            }
          : {
              mode: "adopt",
              pid: pid as number,
              cwd,
              ...(jobLog !== undefined ? { log: jobLog } : {}),
            },
      resumeWhen: {
        kind: kind as YieldKind,
        ...(isCleanNonEmptyText(resumeWhen?.["path"])
          ? { path: resumeWhen["path"] as string }
          : {}),
        ...(isCleanNonEmptyText(resumeWhen?.["pattern"])
          ? { pattern: resumeWhen["pattern"] as string }
          : {}),
        ...(isPositiveInteger(resumeWhen?.["stable_sec"])
          ? { stableSec: resumeWhen["stable_sec"] as number }
          : {}),
        ...(isPositiveInteger(resumeWhen?.["pid"]) ? { pid: resumeWhen["pid"] as number } : {}),
        ...(isCleanArgv(resumeWhen?.["argv"])
          ? { argv: resumeWhen["argv"] as readonly string[] }
          : {}),
      },
      onFirstFailure,
      deadlineSec: raw["deadline_sec"] as number,
      onResume: typeof raw["on_resume"] === "string" ? raw["on_resume"] : undefined,
    },
  };
}
