/**
 * T044 — the observation of a run (F123-FR-036).
 *
 * An observation takes its facts in this order of authority: the state of
 * the pipeline; the liveness of the process; the labelled lines of the
 * pipeline log from the offset recorded at launch; the newest stop reason of
 * the engine; the last 2,000 bytes of the launch log. The status derives
 * from the state and the launcher exit, the change signature carries no
 * clock, the stage elapsed time is clamped to the total, and the detail is
 * the newest `RECOVER`, `BLOCKED`, `RESUME`, `ERROR` or `FAIL` line. The
 * newest digest of the pipeline log wins over the launch log.
 */

/** The status of an observation (the supervision outcomes of §R.7). */
export type ObservationStatus =
  | "running"
  | "starting"
  | "lock-conflict"
  | "completed"
  | "failed"
  | "stopped"
  | "unknown-terminal";

/** The labelled lines the detail may come from, in the order of recency of the scan. */
export const DETAIL_LABELS = ["RECOVER", "BLOCKED", "RESUME", "ERROR", "FAIL"] as const;

/** The window of the launch log an observation reads. */
export const LAUNCH_LOG_WINDOW_BYTES = 2_000 as const;

/** One observation of a run. */
export type Observation = {
  readonly status: ObservationStatus;
  /** The `state` of the pipeline state record. */
  readonly runState: string | null;
  readonly stageId: string | null;
  readonly stageIndex: number | null;
  readonly stageCount: number | null;
  readonly stageReason: string | null;
  readonly detail: string | null;
  readonly launcherExit: number | null;
  readonly childExit: number | null;
  /** The newest stop reason of the engine, read for the whole pipeline. */
  readonly stopReason: string | null;
  readonly stageElapsedSeconds: number | null;
  readonly totalElapsedSeconds: number | null;
  /** The digests the logs hold, the newest pipeline-log digest winning. */
  readonly digest: DigestFields | null;
  readonly anomalies: readonly string[];
  /** Of the terminal record, for the classifier. */
  readonly blocked: boolean;
  readonly retryable: boolean;
};

/** The parsed digest line. `childExit` is absent where the logs read `None`. */
export type DigestFields = {
  readonly state: string;
  readonly exit: number | null;
  readonly lastStage: string | null;
  readonly childExit: number | null;
  readonly evidence: string | null;
};

/** The labelled lines of the pipeline log, from the offset recorded at launch. */
export type LogLine = { readonly label: string; readonly message: string };

/** True when a line is labelled by the grammar of annex G §G.3. */
export function isLabelledLine(line: string): boolean {
  return /^\[[A-Z][A-Z0-9-]*\] /.test(line);
}

/** Split a labelled line into its label and its message. */
export function splitLabelledLine(line: string): LogLine | null {
  const match = /^(\[[A-Z][A-Z0-9-]*\]) (.*)$/.exec(line);
  if (match === null) return null;
  return { label: match[1] as string, message: match[2] as string };
}

/**
 * The detail: the newest `RECOVER`, `BLOCKED`, `RESUME`, `ERROR` or `FAIL`
 * line, as `<LABEL>: <message>`.
 */
export function detailOf(lines: readonly LogLine[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] as LogLine;
    const bare = line.label.replace(/^\[|\]$/g, "");
    if ((DETAIL_LABELS as readonly string[]).includes(bare)) {
      return `${bare}: ${line.message}`;
    }
  }
  return null;
}

/**
 * Parse the digest line: `state`, `exit`, `last-stage`, an optional
 * `child-exit` where `None` reads as absent, and `evidence`.
 */
export function parseDigestLine(line: string): DigestFields | null {
  const match = /^\[DIGEST\] (.*)$/.exec(line.trim());
  if (match === null) return null;
  const fields = new Map<string, string>();
  for (const pair of (match[1] as string).split(" ")) {
    const eq = pair.indexOf("=");
    if (eq > 0) fields.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const state = fields.get("state");
  if (state === undefined) return null;
  const exit = fields.get("exit");
  const childExit = fields.get("child-exit");
  return {
    state,
    exit: exit !== undefined && exit !== "unknown" ? Number(exit) : null,
    lastStage: fields.get("last-stage") ?? null,
    childExit: childExit !== undefined && childExit !== "None" ? Number(childExit) : null,
    evidence: fields.get("evidence") ?? null,
  };
}

/**
 * Derive the status (F123-FR-036): alive is `running` when the state is
 * `ready` or `running`, else `starting`; not alive and launcher exit 24 is
 * `lock-conflict`; a terminal state is that status; otherwise from the
 * launcher exit (0 completed, 128 or more stopped, other failed); otherwise
 * `unknown-terminal`.
 */
export function deriveStatus(input: {
  alive: boolean;
  runState: string | null;
  launcherExit: number | null;
}): ObservationStatus {
  if (input.alive) {
    return input.runState === "ready" || input.runState === "running" ? "running" : "starting";
  }
  if (input.launcherExit === 24) return "lock-conflict";
  if (
    input.runState === "completed" ||
    input.runState === "failed" ||
    input.runState === "stopped"
  ) {
    return input.runState;
  }
  if (input.launcherExit !== null) {
    if (input.launcherExit === 0) return "completed";
    if (input.launcherExit >= 128) return "stopped";
    return "failed";
  }
  return "unknown-terminal";
}

/** Clamp the stage elapsed time into `[0, totalElapsed]`. */
export function clampElapsed(
  stageElapsed: number | null,
  totalElapsed: number | null,
): number | null {
  if (stageElapsed === null) return null;
  const upper = totalElapsed ?? stageElapsed;
  return Math.min(Math.max(stageElapsed, 0), Math.max(upper, 0));
}

/** The change signature: status, run state, stage id, stage index, stage reason, detail, launcher exit — no clock. */
export function signatureOf(observation: Observation): string {
  return JSON.stringify([
    observation.status,
    observation.runState,
    observation.stageId,
    observation.stageIndex,
    observation.stageReason,
    observation.detail,
    observation.launcherExit,
  ]);
}

/** The facts the observation is built from, one per authority. */
export type ObservationInput = {
  readonly alive: boolean;
  readonly state: {
    readonly state: string | null;
    readonly stages: readonly {
      readonly id: string;
      readonly status: string;
      readonly reason: string | null;
    }[];
    readonly lastStage: string | null;
  } | null;
  readonly launcherExit: number | null;
  readonly childExit: number | null;
  /** The labelled lines of the pipeline log, from the offset recorded at launch. */
  readonly pipelineLogLines: readonly LogLine[];
  /** The newest stop reason of the engine, read for the whole pipeline. */
  readonly stopReason: string | null;
  /** The lines of the last 2,000 bytes of the launch log. */
  readonly launchLogLines: readonly LogLine[];
  readonly stageElapsedSeconds: number | null;
  readonly totalElapsedSeconds: number | null;
  readonly blocked: boolean;
  readonly retryable: boolean;
};

/** Build one observation from the facts, in the order of authority. */
export function buildObservation(input: ObservationInput): Observation {
  const anomalies: string[] = [];
  const runState = input.state?.state ?? null;
  const status = deriveStatus({
    alive: input.alive,
    runState,
    launcherExit: input.launcherExit,
  });
  // The newest digest of the pipeline log wins over the launch log.
  const pipelineDigests = input.pipelineLogLines
    .map((line) => parseDigestLine(`[${line.label.replace(/^\[|\]$/g, "")}] ${line.message}`))
    .filter((digest): digest is DigestFields => digest !== null);
  const launchDigests = input.launchLogLines
    .map((line) => parseDigestLine(`[${line.label.replace(/^\[|\]$/g, "")}] ${line.message}`))
    .filter((digest): digest is DigestFields => digest !== null);
  const digest = pipelineDigests.at(-1) ?? launchDigests.at(-1) ?? null;
  const stages = input.state?.stages ?? [];
  const runningIndex = stages.findIndex((stage) => stage.status === "running");
  const failedIndex = stages.findIndex((stage) => stage.status === "failed");
  const index =
    runningIndex >= 0 ? runningIndex : failedIndex >= 0 ? failedIndex : stages.length - 1;
  const stage = index >= 0 ? stages[index] : undefined;
  if (status === "unknown-terminal" && digest === null) {
    anomalies.push("the launcher process is gone and wrote no terminal state");
  }
  const detail = detailOf(input.pipelineLogLines);
  return {
    status,
    runState,
    stageId: stage?.id ?? null,
    stageIndex: stage ? index + 1 : null,
    stageCount: stages.length > 0 ? stages.length : null,
    stageReason: stage?.reason ?? null,
    detail,
    launcherExit: input.launcherExit,
    childExit: input.childExit,
    stopReason: input.stopReason,
    stageElapsedSeconds: clampElapsed(input.stageElapsedSeconds, input.totalElapsedSeconds),
    totalElapsedSeconds: input.totalElapsedSeconds,
    digest,
    anomalies,
    blocked: input.blocked,
    retryable: input.retryable,
  };
}
