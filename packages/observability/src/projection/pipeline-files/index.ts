/**
 * T016 — the compared logs and records of the pipeline runtime and of the
 * supervisor (F144-FR-010).
 *
 * F144-FR-010: *The projection MUST write the compared logs and records of
 * the pipeline runtime and the supervisor, named by F100-FR-054, from the
 * events `pipeline.*`, `stage.*`, `launch.checked`, `supervisor.*` and
 * `digest.written`, with the text of the lines of annex G §G.3. With
 * `relaunch.owner: root` it MUST render `[MOL-RELAUNCH]` from the root's
 * `supervisor.relaunch` event. The text of each line belongs to the feature
 * that prints it.*
 *
 * THE TEXT IS NOT WRITTEN HERE. Every line is printed by `printLine` of
 * `@specstride/contracts` over the key tables of annex G §G.3, which feature
 * 100 owns and feature 123 fills; `printLine` refuses a key the table of the
 * label does not hold, so this module cannot invent a field of a line. What
 * belongs to this feature is which FILE a line goes to and which field of the
 * event fills which key — the mechanism, not the wording.
 *
 * The four files are the four names of F100-FR-054 that the layout table marks
 * with the writer "Compatibility projection"; the fifth name of that
 * requirement, the engine log, is written by the halt rail of F144-FR-007 and
 * not here.
 */
import { COMPARED_PIPELINE_NAMES } from "@specstride/contracts/ids/logical-names";
import { printLine } from "@specstride/contracts/grammar/line-keys";
import { formatDigest, type Digest, type DigestState } from "@specstride/contracts/grammar/digest";
import { DEFAULT as DEFAULT_RELAUNCH_OWNER } from "@specstride/contracts/state/relaunch-owner";
import type { RelaunchOwner } from "@specstride/contracts/state/relaunch-owner";

/** The logical name of each of the four files (F100-FR-054, annex B §B.5). */
export const LAUNCHER_LOG = "pipeline:<pipelineId>:launcher-log" as const;
export const REPORT_LOG = "pipeline:<pipelineId>:report-log" as const;
export const LAUNCH_LOG = "pipeline:<pipelineId>:launch-log" as const;
export const HARNESS_RUN = "pipeline:<pipelineId>:harness-run" as const;

/** The four files this module writes, in the order of F100-FR-054. */
export const PIPELINE_FILES = [LAUNCHER_LOG, REPORT_LOG, LAUNCH_LOG, HARNESS_RUN] as const;
export type PipelineFile = (typeof PIPELINE_FILES)[number];

/** Four, as F144-FR-010 and the data model count them. */
export const PIPELINE_FILE_COUNT = 4 as const;

/**
 * The fifth name of F100-FR-054: the engine log. It is a compared file of the
 * projection too, and the halt rail of F144-FR-007 appends to it, so it is not
 * one of the four this module writes.
 */
export const ENGINE_LOG = "run:<runId>:engine-log" as const;

/** The four files are exactly the names of F100-FR-054 less the engine log. */
export const PIPELINE_FILES_ARE_THE_NAMES_OF_F100_FR_054 =
  COMPARED_PIPELINE_NAMES.filter((name) => name !== ENGINE_LOG).join("|") ===
  PIPELINE_FILES.join("|");

/** The event types F144-FR-010 names, as prefixes and as whole names. */
export const TYPE_PREFIXES = ["pipeline.", "stage.", "supervisor."] as const;
export const WHOLE_TYPES = ["launch.checked", "digest.written"] as const;

/** True where the type is one F144-FR-010 names. */
export function isAPipelineFileType(type: string): boolean {
  return (
    TYPE_PREFIXES.some((prefix) => type.startsWith(prefix)) ||
    (WHOLE_TYPES as readonly string[]).includes(type)
  );
}

/** The label of the supervisor line of each type that has one (annex G §G.3). */
export const LABEL_OF_TYPE: Readonly<Record<string, string>> = Object.freeze({
  "pipeline.started": "MOL-LAUNCH",
  "launch.checked": "MOL-GATE",
  "supervisor.observed": "MOL-STATE",
  "supervisor.relaunch": "MOL-RELAUNCH",
  "supervisor.stopped": "MOL-STOP",
});

/** One line or record the projection appends to one of the four files. */
export type PipelineWrite = {
  /** The logical name of the file. */
  readonly file: PipelineFile;
  /** The bytes of the line, or of the record where the file is the record. */
  readonly bytes: string;
  /** The label of the line, or null for the record. */
  readonly label: string | null;
};

/** What the projection is told about the run while it renders these files. */
export type PipelineContext = {
  readonly pipelineId: string;
  /** `root` or `supervise`; the default of §F.4 is `root`. */
  readonly relaunchOwner?: RelaunchOwner;
  /** True where the event was written by the runtime ROOT (F144-FR-010). */
  readonly fromTheRoot?: boolean;
};

const text = (value: unknown): string | null =>
  value === undefined || value === null ? null : String(value);
const number = (value: unknown): number | null =>
  value === undefined || value === null ? null : Number(value);

/**
 * F144-FR-010 — `[MOL-RELAUNCH]` is rendered from the ROOT's
 * `supervisor.relaunch` event, and only where `relaunch.owner` is `root`:
 * under `supervise` the supervisor owns the relaunch and prints its own line.
 */
export function relaunchLineIsRendered(context: PipelineContext): boolean {
  const owner = context.relaunchOwner ?? DEFAULT_RELAUNCH_OWNER;
  return owner === "root" && context.fromTheRoot !== false;
}

/** The record of `harness-run`, as the compared record of F100-FR-054. */
export type HarnessRunRecord = Readonly<Record<string, unknown>>;

/**
 * The writes one event of F144-FR-010 causes: zero, one or two of the four
 * files. The order of the list is the order the lines are appended in.
 */
export function writesOfEvent(
  type: string,
  data: Readonly<Record<string, unknown>>,
  context: PipelineContext,
): readonly PipelineWrite[] {
  const writes: PipelineWrite[] = [];
  const line = (
    file: PipelineFile,
    label: string,
    values: Readonly<Record<string, string | number | boolean | null>>,
    discriminant?: string,
  ): void => {
    writes.push(
      Object.freeze({
        file,
        label,
        bytes: printLine(label, values, discriminant === undefined ? {} : { discriminant }),
      }),
    );
  };
  switch (type) {
    case "pipeline.started": {
      line(LAUNCHER_LOG, "MOL-LAUNCH", {
        pipeline: context.pipelineId,
        mode: text(data.mode),
        launcher: text(data.launcherRef),
        stages: number(data.stages),
      });
      writes.push(
        Object.freeze({
          file: HARNESS_RUN,
          label: null,
          bytes: JSON.stringify({
            pipeline: context.pipelineId,
            mode: data.mode ?? null,
            stages: data.stages ?? null,
            state: "running",
          }),
        }),
      );
      return Object.freeze(writes);
    }
    case "pipeline.ended": {
      line(LAUNCHER_LOG, "MOL-DIGEST", {
        pipeline: context.pipelineId,
        state: text(data.state),
        exit: number(data.exitCode),
        "child-exit": number(data.childExit),
        "last-stage": text(data.lastStage),
        evidence: text(data.evidencePath),
      });
      writes.push(
        Object.freeze({
          file: HARNESS_RUN,
          label: null,
          bytes: JSON.stringify({
            pipeline: context.pipelineId,
            state: data.state ?? null,
            exit: data.exitCode ?? null,
            "last-stage": data.lastStage ?? null,
            evidence: data.evidencePath ?? null,
          }),
        }),
      );
      return Object.freeze(writes);
    }
    case "stage.started": {
      line(LAUNCHER_LOG, "MOL-STATE", {
        pipeline: context.pipelineId,
        stage: text(data.kind),
        id: text(data.stageId),
        state: "started",
      });
      return Object.freeze(writes);
    }
    case "stage.ended": {
      line(LAUNCHER_LOG, "MOL-STATE", {
        pipeline: context.pipelineId,
        state: text(data.outcome),
        detail: text(data.reason),
      });
      return Object.freeze(writes);
    }
    case "launch.checked": {
      const decision = text(data.decision);
      const values: Readonly<Record<string, string | number | boolean | null>> =
        decision === null
          ? Object.freeze({
              check: text(data.check),
              status: text(data.status),
              reason: text(data.reason),
              detail: text(data.detail),
            })
          : Object.freeze({
              decision,
              reason: text(data.reason),
              detail: text(data.detail),
            });
      const discriminant = decision === null ? "check" : "decision";
      line(LAUNCH_LOG, "MOL-GATE", values, discriminant);
      line(REPORT_LOG, "MOL-GATE", values, discriminant);
      return Object.freeze(writes);
    }
    case "supervisor.observed": {
      line(REPORT_LOG, "MOL-STATE", {
        pipeline: context.pipelineId,
        state: text(data.stopReason) ?? "observed",
        detail: text(data.budgetLeft),
      });
      return Object.freeze(writes);
    }
    case "supervisor.relaunch": {
      if (!relaunchLineIsRendered(context)) return Object.freeze(writes);
      line(REPORT_LOG, "MOL-RELAUNCH", {
        pipeline: context.pipelineId,
        attempt: number(data.attempt),
        reason: text(data.reason),
        exit: number(data.exit),
        "child-exit": number(data.childExit),
        stage: text(data.stage),
        "stop-reason": text(data.stopReason),
        "budget-remaining": number(data.budgetRemaining),
        detail: text(data.detail),
      });
      return Object.freeze(writes);
    }
    case "supervisor.stopped": {
      line(REPORT_LOG, "MOL-STOP", {
        pipeline: context.pipelineId,
        sent: text(data.sent),
      });
      return Object.freeze(writes);
    }
    case "digest.written": {
      const digest: Digest = {
        state: String(data.state) as DigestState,
        exit: Number(data.exit ?? 0),
        lastStage: text(data.lastStage),
        childExit: number(data.childExit),
        evidence: text(data.evidencePath),
      };
      writes.push(
        Object.freeze({ file: LAUNCHER_LOG, label: "DIGEST", bytes: formatDigest(digest) }),
      );
      return Object.freeze(writes);
    }
    default:
      return Object.freeze(writes);
  }
}
