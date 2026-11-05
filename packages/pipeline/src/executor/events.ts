/**
 * T019 — the events of a run, written through the event port
 * (F123-FR-018, F123-FR-019).
 *
 * The executor emits: `stage.started` and `stage.ended` per stage attempt
 * pair, the `supervisor.*` events (`supervisor.observed`, `supervisor.relaunch`),
 * `pipeline.started` and `pipeline.ended` — one pair per launch and per
 * relaunch —, `digest.written` once, with the digest, and `launch.checked`
 * for the checks the root verifies itself (the launcher, the launch contract,
 * the workspace lock; the answer to CQ-222).
 *
 * A dry run and the two start-up refusals (stale sources, invalid contract)
 * write no event at all.
 */
/** The names of the events this feature emits (the catalogue of feature 111). */
export const EVENT_NAMES = [
  "pipeline.started",
  "pipeline.ended",
  "stage.started",
  "stage.ended",
  "supervisor.observed",
  "supervisor.relaunch",
  "digest.written",
  "launch.checked",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/** One event: the name, the fields, the time. */
export type PipelineEvent = {
  name: EventName;
  time: number;
  fields: Record<string, unknown>;
};

/** The event port (feature 111): the only way an event reaches the stream. */
export type EventPort = {
  write(event: PipelineEvent): void;
};

/** An event port that collects in memory, for the tests and the digest. */
export function collectingEventPort(
  sink: PipelineEvent[] = [],
): EventPort & { events: readonly PipelineEvent[] } {
  return {
    write(event: PipelineEvent): void {
      sink.push(event);
    },
    get events(): readonly PipelineEvent[] {
      return sink;
    },
  };
}

/** A port that writes nothing: a dry run and the start-up refusals use it. */
export function nullEventPort(): EventPort {
  return { write(): void {} };
}

/** `pipeline.started`, once per launch and once per relaunch. */
export function emitPipelineStarted(
  port: EventPort,
  fields: { pipeline: string; launch: number; contractHash: string; relaunchOf?: number },
  time: number,
): void {
  port.write({ name: "pipeline.started", time, fields: { ...fields } });
}

/** `pipeline.ended`, the pair of `pipeline.started` of the same launch. */
export function emitPipelineEnded(
  port: EventPort,
  fields: {
    pipeline: string;
    launch: number;
    state: string;
    exit: number;
    lastStage?: string | null;
    childExit?: number | null;
    evidence?: string | null;
    digest?: string;
  },
  time: number,
): void {
  port.write({ name: "pipeline.ended", time, fields: { ...fields } });
}

/** `stage.started`, one per stage attempt. */
export function emitStageStarted(
  port: EventPort,
  fields: { pipeline: string; stage: string; attempt: number },
  time: number,
): void {
  port.write({ name: "stage.started", time, fields: { ...fields } });
}

/** `stage.ended`, the pair of `stage.started`. */
export function emitStageEnded(
  port: EventPort,
  fields: {
    pipeline: string;
    stage: string;
    attempt: number;
    ok: boolean;
    reason: string;
    childExitCode: number | null;
  },
  time: number,
): void {
  port.write({ name: "stage.ended", time, fields: { ...fields } });
}

/** `supervisor.observed`, the classifier's reading of a terminal run. */
export function emitSupervisorObserved(
  port: EventPort,
  fields: { tableId: string; ruleId: string; choice: string; signals: Record<string, unknown> },
  time: number,
): void {
  port.write({ name: "supervisor.observed", time, fields: { ...fields } });
}

/** `supervisor.relaunch`, with the budget bookkeeping and the decision (F123-FR-033). */
export function emitSupervisorRelaunch(
  port: EventPort,
  fields: {
    attempt: number;
    maximum: number;
    remaining: number;
    reason: string;
    ruleId?: string;
    tableVersion?: string;
  },
  time: number,
): void {
  port.write({ name: "supervisor.relaunch", time, fields: { ...fields } });
}

/** `digest.written`, exactly once per run, with the digest. */
export function emitDigestWritten(port: EventPort, fields: { digest: string }, time: number): void {
  port.write({ name: "digest.written", time, fields: { ...fields } });
}

/** `launch.checked`, once per check the root verifies itself (CQ-222). */
export function emitLaunchChecked(
  port: EventPort,
  fields: { check: string; result: "pass" | "fail" | "deferred"; detail?: string },
  time: number,
): void {
  port.write({ name: "launch.checked", time, fields: { ...fields } });
}
