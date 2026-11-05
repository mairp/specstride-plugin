/**
 * T031 — the command surface of `resume` (F102-FR-011 to F102-FR-014,
 * F102-FR-023, F102-FR-024).
 *
 * THE ORDER OF THE CHECKS (F102-FR-024; CQ-184). The state check of annex G
 * §G.4 comes first and exits 1 on a workspace without state; on such a
 * workspace NO other check of `resume` runs. Then the six refusals, in the
 * order of `../run-control/refusals.ts`:
 *
 *   1. `nothing-to-resume`  — no run snapshot for the selection, or the
 *                             selected run is `finished` (F102-FR-012);
 *   2. `unsupported-record` — a record of the run with a schema major the
 *                             reader does not support; an older major is
 *                             never read (F102-FR-024);
 *   3. `lock-held`          — the probe says held-live, held-foreign or
 *                             unknown (F102-FR-013);
 *      `owner-survivors`    — the owner is dead and a recorded `owned`
 *                             process group is alive (F102-FR-014);
 *   4. `source-changed`     — a source hash differs (F102-FR-015); not
 *                             raised under the `parity` profile (F102-FR-018),
 *                             and skipped by `--accept-source-change`;
 *   5. `settings-invalid`   — a replayed value fails validation again
 *                             (F102-FR-024).
 *
 * THE LOCK (F102-FR-014). `resume` reaches the lock only through the probe
 * and reclaim of EP-13, injected as a port. On `stale-owner-dead` it
 * reclaims and goes on; a foreign owner is never reclaimed; on
 * `owner-dead-group-alive` it refuses and names the survivors. The
 * synthesized `run.ended` that closes a dead launch is written by the
 * process that takes the lock, never by the CLI (LR-3, LR-4).
 *
 * THE CONTINUATION (F102-FR-011, F102-FR-023). The run keeps its `runId`; a
 * new launch record with reason `resume` and a new `launchId` is written,
 * carrying the two truth values `resetCounts` and `acceptSourceChange`
 * (CQ-072). The route of the continued run is the route the last launch
 * started: the foreground with the exit code of the engine, or the runtime
 * root. The run goes on at the first phase without a valid approval record
 * (verified by `../run-control/verify-approvals.ts`, F102-FR-022). The CLI
 * writes no run state, no event and no terminal record.
 *
 * THE ENVIRONMENT (B-1473, C-110). `resume` exports `SPECSTRIDE_GIT_COMMITS`
 * from the conf key `GIT_COMMITS` when it is non-empty; it is env-only,
 * never a flag.
 *
 * THE ENGINE EXECUTABLE (F102-FR-030, T045). `resume` uses the engine
 * executable recorded in the launch record of the run when that file still
 * exists, and otherwise the product's own entry. The executable it uses is
 * pinned, by path and hash, in its new launch record.
 *
 * THE COMPATIBILITY LINE (F102-FR-031, T045). Under compatibility output
 * `resume` prints `resuming: ` followed by the engine executable and the
 * replayed argument list, before it starts the engine.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { atomicWriteJson } from "@specstride/kernel";
import { PROFILE_NAME } from "@specstride/contracts/profile/parity";
import {
  resolve as resolveLogicalName,
  rootPathsOf,
} from "@specstride/contracts/ids/logical-names";
import type { LaunchRecord } from "@specstride/contracts/records/launch-record";
import { RecordRefusedError } from "@specstride/contracts/records/validate";
import { workspaceStateExists } from "./stop.ts";
import {
  currentSourceHashes,
  compareSourceHashes,
  type RecordedSourceHash,
} from "../run-control/source-compare.ts";
import { refuseSourceChanged } from "../run-control/refuse-source-changed.ts";
import {
  acceptedChangesFromPaths,
  newSourceHashesOf,
} from "../run-control/accept-source-change.ts";
import { readRunSnapshot } from "../run-control/records.ts";
import {
  NO_STATE_EXIT,
  NO_STATE_MESSAGE,
  lockHeldLine,
  nothingToResumeFeatureLine,
  nothingToResumeNoConfLine,
  ownerSurvivorsLine,
  resumingLine,
  resumeRefusalExit,
  settingsInvalidLine,
  unsupportedRecordLine,
  WAYS_OUT_OF_SOURCE_CHANGED,
  type ResumeRefusal,
} from "../run-control/refusals.ts";
import {
  verifyApprovals,
  type ApprovalPort,
  type ApprovalVerification,
} from "../run-control/verify-approvals.ts";
import {
  decideContinuation,
  type ContinuationDecision,
  type ContinuationSelection,
} from "../run-control/continue-or-new.ts";
import {
  runLaunchedDataOf,
  unblockedDataOf,
  UNBLOCKED_BY,
  type RunLaunchedData,
  type UnblockedData,
} from "@specstride/core/run-control/counts";
import {
  replayRunSnapshot,
  replayedArgsOf,
  type ReplaySuccess,
} from "../run-control/snapshot-replay.ts";

/** The command name, as the consumer types it. */
export const COMMAND = "resume" as const;

/** The requirements this module carries out. */
export const RESUME_COMMAND_REQUIREMENTS = [
  "F102-FR-011",
  "F102-FR-012",
  "F102-FR-013",
  "F102-FR-014",
  "F102-FR-023",
  "F102-FR-024",
  "F102-FR-030",
  "F102-FR-031",
] as const;

/** The run states where the lock is held live (F102-FR-023). */
export const LIVE_STATES = [
  "starting",
  "running",
  "paused-quota",
  "relaunching",
  "stopping",
] as const;

/** The resting states only `resume` leaves (F102-FR-023, transition T17). */
export const RESTING_STATES_RESUME_LEAVES = [
  "blocked-on-human",
  "stopped",
  "failed",
  "dead",
] as const;

/* ------------------------------------------------------------------ *
 * The environment (B-1473, C-110).
 * ------------------------------------------------------------------ */

/**
 * The environment `resume` exports for the continued run: `SPECSTRIDE_GIT_COMMITS`
 * from the conf key `GIT_COMMITS`, when non-empty (B-1473). It is env-only,
 * not a flag.
 */
export function environmentOfResume(conf: {
  readonly gitCommits?: string | undefined;
}): Readonly<Record<string, string>> {
  if (conf.gitCommits !== undefined && conf.gitCommits !== "") {
    return Object.freeze({ SPECSTRIDE_GIT_COMMITS: conf.gitCommits });
  }
  return Object.freeze({});
}

/* ------------------------------------------------------------------ *
 * The engine executable (F102-FR-030, T045).
 * ------------------------------------------------------------------ */

/** The engine executable `resume` runs, as the caller observes it. */
export type EngineExecutable = {
  /** The path of the executable. */
  readonly path: string;
  /** The hash pinned with it, where one is known. */
  readonly hash?: string | undefined;
  /** Where the path came from: the last launch record, or the product. */
  readonly source: "recorded" | "product";
};

/**
 * F102-FR-030 — the engine executable rule. `resume` uses the engine
 * executable recorded in the launch record of the run when that file still
 * exists, and otherwise the product's own entry. Whatever it uses is pinned
 * in its new launch record, by path and hash.
 */
export function engineExecutableOf(input: {
  /** The executable the LAST launch record pinned, when it named one. */
  readonly recorded?: Readonly<Record<string, unknown>> | undefined;
  /** Whether a path still exists; injectable, `existsSync` in the binary. */
  readonly existsOf: (path: string) => boolean;
  /** The product's own entry, for the case the recording is gone. */
  readonly productEntry?: { readonly path: string; readonly hash?: string | undefined } | undefined;
}): EngineExecutable {
  const recordedPath = input.recorded?.path;
  if (typeof recordedPath === "string" && recordedPath !== "" && input.existsOf(recordedPath)) {
    const hash = input.recorded?.hash;
    return Object.freeze({
      path: recordedPath,
      ...(typeof hash === "string" && hash !== "" ? { hash } : {}),
      source: "recorded" as const,
    });
  }
  const path = input.productEntry?.path ?? "specstride";
  const hash = input.productEntry?.hash;
  return Object.freeze({
    path,
    ...(typeof hash === "string" && hash !== "" ? { hash } : {}),
    source: "product" as const,
  });
}

/**
 * F102-FR-031 — the compatibility line of `resume`: `resuming: ` followed by
 * the engine executable and the replayed argument list, printed before the
 * engine starts.
 */
export function compatibilityResumingLine(
  executable: string,
  args: readonly string[] = [],
): string {
  return args.length === 0
    ? `resuming: ${executable}`
    : `resuming: ${executable} ${args.join(" ")}`;
}

/* ------------------------------------------------------------------ *
 * The selection of the run and the refusals.
 * ------------------------------------------------------------------ */

/** The run the selection found on disk. */
export type SelectedRun = {
  readonly runId: string;
  readonly feature: string;
  /** The state of the run record, as the reader of the run state gives it. */
  readonly state: string;
  /** The raw run snapshot of the run (`run:<runId>:snapshot`). */
  readonly snapshot: unknown;
  /** How the LAST launch of the run started; the route is taken again. */
  readonly lastLaunchMode?: "foreground" | "runtime-root" | undefined;
  /** The engine executable the LAST launch record pinned (F102-FR-030). */
  readonly lastLaunchEngineExecutable?: Readonly<Record<string, unknown>> | undefined;
};

/** What the lock probe of EP-13 answers. */
export type LockProbe =
  | { readonly kind: "free" }
  | { readonly kind: "held-live"; readonly holder: string }
  | { readonly kind: "held-foreign"; readonly holder: string }
  | { readonly kind: "unknown" }
  | { readonly kind: "stale-owner-dead"; readonly holder: string }
  | { readonly kind: "owner-dead-group-alive"; readonly survivors: readonly string[] };

/** A refusal: its code, its exit, its line, and what the launch record gets. */
export type ResumeRefusalOutcome = {
  readonly refusal: ResumeRefusal;
  readonly exit: 3 | 5;
  readonly detail: string;
  /** The file named, when the refusal names files (`source-changed`). */
  readonly refusalFile?: string | undefined;
};

/** What one printed line went to. */
export type ResumeLine = {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
};

/** What the caller of `runResume` injects. */
export type ResumeInput = {
  readonly controlRoot: string;
  readonly workspaceRealPath: string;
  readonly workdir?: string | undefined;
  /** `resume --feature <slug>`; absent selects the run launched last. */
  readonly featureSlug?: string | undefined;
  /** `--reset-counts`, recorded in the launch record, never replayed. */
  readonly resetCounts?: boolean | undefined;
  /** `--accept-source-change` (F102-FR-021). */
  readonly acceptSourceChange?: boolean | undefined;
  /** The profile: `source-changed` is not raised under `parity` (F102-FR-018). */
  readonly profile?: string | undefined;
  /** The launch id of the new launch record; generated when absent. */
  readonly launchId?: string | undefined;
  /** The clock of the launch record; never read here. */
  readonly now?: string | undefined;
  /** The workspace id, as the layout record holds it. */
  readonly workspaceId?: string | undefined;
  /** The conf key `GIT_COMMITS` (B-1473). */
  readonly confGitCommits?: string | undefined;
  /** T040 — when the run rested in `blocked-on-human` (T17): the `latencyMs`
   * of the `unblocked` event is measured from here (F102-FR-036). */
  readonly blockedAt?: string | undefined;
  /** The selection of the run on disk. */
  readonly selectRun: (featureSlug: string | undefined) => SelectedRun | null;
  /** The probe and reclaim of EP-13 (F102-FR-014). */
  readonly probe: () => LockProbe;
  /** Reclaim of EP-13, on `stale-owner-dead`. */
  readonly reclaim?: () => void | undefined;
  /** The replay of the snapshot values (F102-FR-024: `settings-invalid`).
   * When absent, the default replay of `../run-control/snapshot-replay.ts`
   * (T044) runs against the snapshot, with `replayContext`. */
  readonly replaySettings?:
    ((snapshot: unknown) => { ok: true } | { ok: false; key: string }) | undefined;
  /** T044 — the context of the default replay: the flags (rank 2,
   * F102-FR-029), the pins of the launch contract (rank 1) and the
   * environment (rank 4). */
  readonly replayContext?:
    | {
        readonly flags?: Readonly<Record<string, unknown>> | undefined;
        readonly contractPins?: Readonly<Record<string, unknown>> | undefined;
        readonly environment?: Readonly<Record<string, unknown>> | undefined;
        readonly inRuntimeRootChild?: boolean | undefined;
      }
    | undefined;
  /** The paths of the three compared sources, where they stand now. */
  readonly sourcePaths?:
    { readonly spec: string; readonly plan: string; readonly tasks: string } | undefined;
  /** The approval records of the feature (F102-FR-022). */
  readonly approvals: ApprovalPort;
  /** Rewrites the snapshot with `acceptedChanges` and the new hashes
   * (F102-FR-019; T037 wires it through `accept-source-change.ts` and
   * `snapshot-writer.ts`). Called only for files that actually changed. */
  readonly rewriteSnapshotWithAcceptedChanges?:
    | ((
        acceptedChanges: readonly unknown[],
        newSourceHashes: Readonly<Record<string, unknown>>,
      ) => boolean)
    | undefined;
  /** F102-FR-030 — whether the engine executable of a path still exists.
   * Injected; `existsSync` by the binary entry. */
  readonly engineExecutableExists?: ((path: string) => boolean) | undefined;
  /** F102-FR-030 — the product's own entry, used when the recorded engine
   * executable no longer exists. */
  readonly productEngineEntry?:
    { readonly path: string; readonly hash?: string | undefined } | undefined;
  /** The writer of the launch record; the kernel atomic write by default. */
  readonly writeLaunchRecord?: ((path: string, record: LaunchRecord) => void) | undefined;
};

/** What `resume` came to, as the caller observes and exits by. */
export type ResumeResult = {
  readonly exitCode: 0 | 1 | 3 | 5;
  /** The refusal, when the command was refused; `null` on success. */
  readonly refusal: ResumeRefusalOutcome | null;
  /** The checks that RAN, in order — the state check is always first. */
  readonly checksRun: readonly string[];
  /** The lines, in the order they are printed; the caller prints them. */
  readonly lines: readonly ResumeLine[];
  /** The selection, where a run was selected at all. */
  readonly selectedRun: SelectedRun | null;
  /** The verification of the approval records, where it ran. */
  readonly approvals: ApprovalVerification | null;
  /** The first phase without a valid approval record (F102-FR-011). */
  readonly firstUnapprovedPhase: number | null;
  /** The route of the continued run (F102-FR-011). */
  readonly route: "foreground" | "runtime-root" | null;
  /** The path of the launch record written; `null` when none was written. */
  readonly launchRecordPath: string | null;
  /** Whether the lock was reclaimed (EP-13, `stale-owner-dead`). */
  readonly reclaimed: boolean;
  /** Whether `--accept-source-change` rewrote the snapshot (F102-FR-019). */
  readonly acceptedChangesWritten: boolean;
  /** Whether a dead launch is to be closed by the lock taker (T4, F102-FR-014). */
  readonly deadLaunchClosedByLockTaker: boolean;
  /** The environment exported for the continued run (B-1473). */
  readonly environment: Readonly<Record<string, string>>;
  /** T052 — the decision of the continuation module (F102-FR-034). */
  readonly continuation?: ContinuationDecision | undefined;
  /** T040 — the `data` of `run.launched` for this launch (F102-FR-036);
   * written by the process that becomes the writer of the event file. */
  readonly runLaunched?: RunLaunchedData | undefined;
  /** T040 — the `data` of `unblocked` when `resume` leaves
   * `blocked-on-human` (T17, F102-FR-023, F102-FR-036). */
  readonly unblocked?: UnblockedData | undefined;
  /** T045 — the engine executable the continued launch runs and the new
   * launch record pins (F102-FR-030). */
  readonly engineExecutable?: EngineExecutable | undefined;
  /** T045 — the compatibility line `resuming: …` (F102-FR-031), also carried
   * in `lines`. */
  readonly engineCommand?: string | undefined;
  /** T044 — the replay of the snapshot with ranks, where it ran. */
  readonly replay?: ReplaySuccess | undefined;
};

/** The refusal outcome of one member of the closed set. */
function refusalOf(
  refusal: ResumeRefusal,
  detail: string,
  refusalFile?: string,
): ResumeRefusalOutcome {
  return Object.freeze({
    refusal,
    exit: resumeRefusalExit(refusal) ?? 3,
    detail,
    ...(refusalFile !== undefined ? { refusalFile } : {}),
  });
}

/** Build the launch record of a resume (F102-FR-011, CQ-072). The engine
 * executable it uses is pinned by path and hash (F102-FR-030). */
export function buildResumeLaunchRecord(input: {
  readonly launchId: string;
  readonly runId: string;
  readonly workspaceId: string;
  readonly now: string;
  readonly outcome: "started" | "refused";
  readonly refusal?: string | undefined;
  readonly refusalFile?: string | undefined;
  readonly resetCounts: boolean;
  readonly acceptSourceChange: boolean;
  readonly featureSlug: string | undefined;
  /** F102-FR-030 — the engine executable pinned by path and hash. */
  readonly engineExecutable?: Readonly<Record<string, unknown>> | undefined;
}): LaunchRecord {
  return {
    schema: "specstride.launch/1",
    launchId: input.launchId,
    runId: input.runId,
    workspaceId: input.workspaceId,
    requestKind: "engine",
    request: {
      command: "resume",
      ...(input.featureSlug !== undefined ? { feature: input.featureSlug } : {}),
    },
    mode: "run",
    reason: "resume",
    host: "cli",
    commentHash: null,
    detachStrategy: "foreground",
    launchNonce: randomUUID(),
    engineExecutable: input.engineExecutable ?? {},
    createdAt: input.now,
    productVersion: "0.0.0",
    protocol: 1,
    outcome: input.outcome,
    ...(input.refusal !== undefined ? { refusal: input.refusal } : {}),
    ...(input.refusalFile !== undefined ? { refusalFile: input.refusalFile } : {}),
    resetCounts: input.resetCounts,
    acceptSourceChange: input.acceptSourceChange,
  };
}

/**
 * Run `resume` (F102-FR-011 to F102-FR-014, F102-FR-023, F102-FR-024). The
 * checks run in the order of the module comment; the answer carries the
 * refusal, the lines and the launch record path the caller exits and prints
 * by.
 */
export function runResume(input: ResumeInput): ResumeResult {
  const workdir = input.workdir ?? input.workspaceRealPath;
  const workspaceId = input.workspaceId ?? "ws";
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: input.workspaceRealPath,
    workspaceId,
    controlRoot: input.controlRoot,
    workerRoot: "",
  });
  const lines: ResumeLine[] = [];
  const checks: string[] = [];
  const record = (path: string, value: LaunchRecord): string => {
    mkdirSync(dirname(path), { recursive: true });
    const write =
      input.writeLaunchRecord ?? ((p: string, r: LaunchRecord) => atomicWriteJson(p, r));
    write(path, value);
    return path;
  };
  const refusedLaunchRecord = (
    outcome: ResumeRefusalOutcome,
    runId: string,
    feature: string,
  ): string =>
    record(
      resolveLogicalName(
        "launch:<launchId>:record",
        { "<launchId>": input.launchId ?? randomUUID() },
        roots,
      ),
      buildResumeLaunchRecord({
        launchId: input.launchId ?? randomUUID(),
        runId,
        workspaceId,
        now: input.now ?? "1970-01-01T00:00:00.000Z",
        outcome: "refused",
        refusal: outcome.refusal,
        refusalFile: outcome.refusalFile,
        resetCounts: input.resetCounts === true,
        acceptSourceChange: input.acceptSourceChange === true,
        featureSlug: feature,
      }),
    );

  // 0. The state check of annex G §G.4 (F102-FR-012, CQ-184): FIRST, exit 1,
  // and on a workspace without state no other check of `resume` runs.
  if (!workspaceStateExists(resolveLogicalName("workspace:record", {}, roots))) {
    checks.push("state");
    lines.push(Object.freeze({ stream: "stderr", text: NO_STATE_MESSAGE }));
    return Object.freeze({
      exitCode: NO_STATE_EXIT,
      refusal: null,
      checksRun: Object.freeze(checks),
      lines: Object.freeze(lines),
      selectedRun: null,
      approvals: null,
      firstUnapprovedPhase: null,
      route: null,
      launchRecordPath: null,
      reclaimed: false,
      acceptedChangesWritten: false,
      deadLaunchClosedByLockTaker: false,
      environment: Object.freeze({}),
    });
  }
  checks.push("state");

  // 1. `nothing-to-resume` (F102-FR-012): no run snapshot for the selection,
  // or the selected run is finished. Before the check of the lock.
  const selected = input.selectRun(input.featureSlug);
  checks.push("selection");
  if (selected === null) {
    const detail =
      input.featureSlug !== undefined
        ? `no run to resume for the feature "${input.featureSlug}"`
        : "no run was ever launched in this workspace";
    const line =
      input.featureSlug !== undefined
        ? nothingToResumeFeatureLine(input.featureSlug, "last-run.conf")
        : nothingToResumeNoConfLine("last-run.conf");
    lines.push(Object.freeze({ stream: "stderr", text: line }));
    lines.push(
      Object.freeze({ stream: "stdout", text: `refused resume (nothing-to-resume): ${detail}` }),
    );
    return Object.freeze({
      exitCode: resumeRefusalExit("nothing-to-resume") ?? 3,
      refusal: refusalOf("nothing-to-resume", detail),
      checksRun: Object.freeze(checks),
      lines: Object.freeze(lines),
      selectedRun: null,
      approvals: null,
      firstUnapprovedPhase: null,
      route: null,
      launchRecordPath: null,
      reclaimed: false,
      acceptedChangesWritten: false,
      deadLaunchClosedByLockTaker: false,
      environment: Object.freeze({}),
    });
  }
  if (selected.state === "finished") {
    const detail = `the run ${selected.runId} is finished; nothing to resume`;
    lines.push(
      Object.freeze({
        stream: "stderr",
        text: nothingToResumeFeatureLine(selected.feature, "last-run.conf"),
      }),
    );
    lines.push(
      Object.freeze({ stream: "stdout", text: `refused resume (nothing-to-resume): ${detail}` }),
    );
    return Object.freeze({
      exitCode: 3,
      refusal: refusalOf("nothing-to-resume", detail),
      checksRun: Object.freeze(checks),
      lines: Object.freeze(lines),
      selectedRun: Object.freeze(selected),
      approvals: null,
      firstUnapprovedPhase: null,
      route: null,
      launchRecordPath: null,
      reclaimed: false,
      acceptedChangesWritten: false,
      deadLaunchClosedByLockTaker: false,
      environment: Object.freeze({}),
    });
  }

  // 2. `unsupported-record` (F102-FR-024): the run snapshot must be readable
  // before the run can be selected further. An older major is never read.
  checks.push("unsupported-record");
  const snapshotRead = readRunSnapshot(selected.snapshot);
  if (!snapshotRead.ok) {
    const error: RecordRefusedError = snapshotRead.error;
    const detail = error.message;
    lines.push(
      Object.freeze({
        stream: "stderr",
        text: unsupportedRecordLine(error.logicalName, error.majorFound, error.majorSupported),
      }),
    );
    const launchRecordPath = refusedLaunchRecord(
      refusalOf("unsupported-record", detail),
      selected.runId,
      selected.feature,
    );
    return Object.freeze({
      exitCode: 3,
      refusal: refusalOf("unsupported-record", detail),
      checksRun: Object.freeze(checks),
      lines: Object.freeze(lines),
      selectedRun: Object.freeze(selected),
      approvals: null,
      firstUnapprovedPhase: null,
      route: null,
      launchRecordPath,
      reclaimed: false,
      acceptedChangesWritten: false,
      deadLaunchClosedByLockTaker: false,
      environment: Object.freeze({}),
    });
  }
  const snapshot = snapshotRead.record;

  // 3. The lock (F102-FR-013, F102-FR-014), only through the probe of EP-13.
  checks.push("lock");
  const lock = input.probe();
  if (lock.kind === "held-live" || lock.kind === "held-foreign" || lock.kind === "unknown") {
    const detail = `the lock of the workspace is held (${lock.kind}) by ${lock.kind === "unknown" ? "an unknown owner" : lock.holder}`;
    lines.push(Object.freeze({ stream: "stderr", text: lockHeldLine(workdir) }));
    const launchRecordPath = refusedLaunchRecord(
      refusalOf("lock-held", detail),
      selected.runId,
      selected.feature,
    );
    return Object.freeze({
      exitCode: 5,
      refusal: refusalOf("lock-held", detail),
      checksRun: Object.freeze(checks),
      lines: Object.freeze(lines),
      selectedRun: Object.freeze(selected),
      approvals: null,
      firstUnapprovedPhase: null,
      route: null,
      launchRecordPath,
      reclaimed: false,
      acceptedChangesWritten: false,
      deadLaunchClosedByLockTaker: false,
      environment: Object.freeze({}),
    });
  }
  if (lock.kind === "owner-dead-group-alive") {
    const detail = `the owner is dead and these process groups survive: ${lock.survivors.join(", ")}`;
    lines.push(Object.freeze({ stream: "stderr", text: ownerSurvivorsLine(lock.survivors) }));
    const launchRecordPath = refusedLaunchRecord(
      refusalOf("owner-survivors", detail),
      selected.runId,
      selected.feature,
    );
    return Object.freeze({
      exitCode: 5,
      refusal: refusalOf("owner-survivors", detail),
      checksRun: Object.freeze(checks),
      lines: Object.freeze(lines),
      selectedRun: Object.freeze(selected),
      approvals: null,
      firstUnapprovedPhase: null,
      route: null,
      launchRecordPath,
      reclaimed: false,
      acceptedChangesWritten: false,
      deadLaunchClosedByLockTaker: false,
      environment: Object.freeze({}),
    });
  }
  // `stale-owner-dead`: reclaim (EP-13) and go on. A dead launch is closed
  // at T4 by the process that takes the lock — never by the CLI.
  const reclaimed = lock.kind === "stale-owner-dead";
  if (reclaimed) input.reclaim?.();

  // 4. `source-changed` (F102-FR-015): after the checks of F102-FR-012 and
  // F102-FR-013. Not raised under the `parity` profile (F102-FR-018), and
  // skipped where the change is accepted (F102-FR-021).
  checks.push("source-changed");
  if (
    input.profile !== PROFILE_NAME &&
    input.acceptSourceChange !== true &&
    input.sourcePaths !== undefined
  ) {
    const recorded =
      (snapshot as { sourceHashes?: Record<string, RecordedSourceHash> }).sourceHashes ?? {};
    const current = currentSourceHashes(input.sourcePaths);
    const comparison = compareSourceHashes(recorded, current);
    if (comparison.changed.length > 0) {
      // T036 — the refusal record and the derived state: the launch record
      // only; the CLI writes no run state and no event (F102-FR-016), the
      // synthesized `blocked` belongs to the next writer of the event file.
      const refusal = refuseSourceChanged(comparison.changed, comparison.message);
      const detail = `the source changed (${refusal.namedFiles}); the ways out: ${WAYS_OUT_OF_SOURCE_CHANGED.join(", ")}`;
      for (const line of refusal.lines) lines.push(Object.freeze(line));
      const launchRecordPath = refusedLaunchRecord(
        refusalOf("source-changed", detail, refusal.namedFiles),
        selected.runId,
        selected.feature,
      );
      return Object.freeze({
        exitCode: 3,
        refusal: refusalOf("source-changed", detail, comparison.changed.join(", ")),
        checksRun: Object.freeze(checks),
        lines: Object.freeze(lines),
        selectedRun: Object.freeze(selected),
        approvals: null,
        firstUnapprovedPhase: null,
        route: null,
        launchRecordPath,
        reclaimed,
        acceptedChangesWritten: false,
        deadLaunchClosedByLockTaker: reclaimed,
        environment: Object.freeze({}),
      });
    }
  }

  // 5. `settings-invalid` (F102-FR-024): after the replay; names the key.
  // T044 — the default replay is the replay with ranks of
  // `../run-control/snapshot-replay.ts`: the pin of the launch contract above
  // every flag, the flags above both classes (F102-FR-029), pinned above the
  // environment, tunable below it; every replayed value re-validated against
  // the schema and the trust classes. An injected `replaySettings` replaces
  // it.
  checks.push("settings-invalid");
  let replay: ReplaySuccess | undefined;
  if (input.replaySettings !== undefined) {
    const attempt = input.replaySettings(selected.snapshot);
    if (!attempt.ok) {
      const detail = `the replayed value of the key "${attempt.key}" failed validation`;
      lines.push(Object.freeze({ stream: "stderr", text: settingsInvalidLine(attempt.key) }));
      const launchRecordPath = refusedLaunchRecord(
        refusalOf("settings-invalid", detail),
        selected.runId,
        selected.feature,
      );
      return Object.freeze({
        exitCode: 3,
        refusal: refusalOf("settings-invalid", detail),
        checksRun: Object.freeze(checks),
        lines: Object.freeze(lines),
        selectedRun: Object.freeze(selected),
        approvals: null,
        firstUnapprovedPhase: null,
        route: null,
        launchRecordPath,
        reclaimed,
        acceptedChangesWritten: false,
        deadLaunchClosedByLockTaker: reclaimed,
        environment: Object.freeze({}),
      });
    }
  } else if (input.replayContext !== undefined) {
    const attempt = replayRunSnapshot({
      snapshot: snapshot as unknown as Readonly<Record<string, unknown>>,
      flags: input.replayContext?.flags,
      contractPins: input.replayContext?.contractPins,
      environment: input.replayContext?.environment,
      profile: input.profile,
      inRuntimeRootChild: input.replayContext?.inRuntimeRootChild,
    });
    if (!attempt.ok) {
      // F102-FR-024 — the replayed value failed validation against the config
      // schema or the trust classes again: exit 3, and the key is named.
      const detail = `the replayed value of the key "${attempt.key}" failed validation: ${attempt.message}`;
      lines.push(Object.freeze({ stream: "stderr", text: settingsInvalidLine(attempt.key) }));
      const launchRecordPath = refusedLaunchRecord(
        refusalOf("settings-invalid", detail),
        selected.runId,
        selected.feature,
      );
      return Object.freeze({
        exitCode: 3,
        refusal: refusalOf("settings-invalid", detail),
        checksRun: Object.freeze(checks),
        lines: Object.freeze(lines),
        selectedRun: Object.freeze(selected),
        approvals: null,
        firstUnapprovedPhase: null,
        route: null,
        launchRecordPath,
        reclaimed,
        acceptedChangesWritten: false,
        deadLaunchClosedByLockTaker: reclaimed,
        environment: Object.freeze({}),
      });
    }
    replay = attempt;
  }

  // F102-FR-019 — with `--accept-source-change` the snapshot is rewritten
  // with `acceptedChanges` and the new hashes BEFORE the engine starts. The
  // changed files are computed against the snapshot here; the EP-07
  // derivation and the write are the port (T037,
  // `../run-control/accept-source-change.ts` + `snapshot-writer.ts`). With
  // the flag and NO changed source the command behaves as a plain `resume`
  // and records no accepted change.
  let acceptedChangesWritten = false;
  if (input.acceptSourceChange === true && input.rewriteSnapshotWithAcceptedChanges !== undefined) {
    if (input.sourcePaths !== undefined) {
      const recorded =
        (snapshot as { sourceHashes?: Record<string, RecordedSourceHash> }).sourceHashes ?? {};
      const current = currentSourceHashes(input.sourcePaths);
      const comparison = compareSourceHashes(recorded, current);
      if (comparison.changed.length > 0) {
        const acceptedChanges = acceptedChangesFromPaths({
          featureId: selected.feature,
          acceptedAt: input.now ?? "1970-01-01T00:00:00.000Z",
          recorded,
          sourcePaths: input.sourcePaths,
        });
        acceptedChangesWritten = input.rewriteSnapshotWithAcceptedChanges(
          acceptedChanges.acceptedChanges,
          newSourceHashesOf(current),
        );
      }
    } else {
      acceptedChangesWritten = input.rewriteSnapshotWithAcceptedChanges([], {});
    }
  }

  // F102-FR-022 — the verification of the approval records: the run goes on
  // at the first phase without a valid record.
  checks.push("approvals");
  const verification = verifyApprovals(input.approvals);
  const firstUnapprovedPhase = verification.firstUnapprovedPhase;

  // The route of the continued run (F102-FR-011): the route the last launch
  // started, foreground when nothing is known.
  const route: "foreground" | "runtime-root" = selected.lastLaunchMode ?? "foreground";

  // F102-FR-011 — the launch record of the continued launch, with the two
  // truth values of CQ-072.
  const launchId = input.launchId ?? randomUUID();

  // F102-FR-030 — the engine executable rule: the executable recorded in the
  // launch record of the run when that file still exists, otherwise the
  // product's own entry. Whatever is used is pinned here, by path and hash.
  const engineExecutable = engineExecutableOf({
    recorded: selected.lastLaunchEngineExecutable,
    existsOf: input.engineExecutableExists ?? (() => false),
    productEntry: input.productEngineEntry,
  });

  const launchRecordPath = record(
    resolveLogicalName("launch:<launchId>:record", { "<launchId>": launchId }, roots),
    buildResumeLaunchRecord({
      launchId,
      runId: selected.runId,
      workspaceId,
      now: input.now ?? "1970-01-01T00:00:00.000Z",
      outcome: "started",
      resetCounts: input.resetCounts === true,
      acceptSourceChange: input.acceptSourceChange === true,
      featureSlug: selected.feature,
      engineExecutable: {
        path: engineExecutable.path,
        ...(engineExecutable.hash !== undefined ? { hash: engineExecutable.hash } : {}),
        source: engineExecutable.source,
      },
    }),
  );

  lines.push(
    Object.freeze({
      stream: "stdout",
      text: resumingLine(selected.runId, firstUnapprovedPhase ?? 1, launchId),
    }),
  );

  // F102-FR-031 — under compatibility output `resume` prints `resuming: `
  // followed by the engine executable and the replayed argument list, before
  // it starts the engine. The line is the as-is compatibility line, so it is
  // printed under the `parity` profile too.
  const args = replay !== undefined ? replayedArgsOf(replay.values) : [];
  const engineCommand = compatibilityResumingLine(engineExecutable.path, args);
  lines.push(Object.freeze({ stream: "stdout", text: engineCommand }));

  // T052 — the ONE continuation module that `launch`, `run` and `resume`
  // call (F102-FR-034): the run is continued, so the source check of
  // F102-FR-015 is required exactly as at a continuing launch, and the line
  // `[SPECSTRIDE-CONTINUE]` with `run` and `counts` is printed — never
  // under the `parity` profile (F102-FR-018). A new run prints no line.
  const selection: ContinuationSelection = { runId: selected.runId, state: selected.state };
  const continuation = decideContinuation({
    selection,
    resetCounts: input.resetCounts === true,
    profile: input.profile,
  });
  if (continuation.line !== null) {
    lines.push(Object.freeze({ stream: "stdout", text: continuation.line }));
  }

  // T040 — the counts and the events of the launch (F102-FR-032,
  // F102-FR-033, F102-FR-036). The counts themselves are taken from the
  // ledger at the engine start (`../run-control/counts.ts` of the core); the
  // CLI records the flag `--reset-counts` in the launch record above
  // (command line only, never replayed) and derives the `data` of
  // `run.launched` (counts carried or reset) and, when it leaves
  // `blocked-on-human` (T17), of `unblocked` (`by` operator, `latencyMs`
  // from the time the run rested blocked). The CLI writes no event (LR-3,
  // LR-4): the process that becomes the writer of the event file writes
  // them.
  const runLaunched = runLaunchedDataOf({
    reason: "resume",
    resetCounts: input.resetCounts === true,
  });
  let unblocked: UnblockedData | undefined;
  if (selected.state === "blocked-on-human") {
    const nowMs = Date.parse(input.now ?? "1970-01-01T00:00:00.000Z");
    const blockedMs = input.blockedAt !== undefined ? Date.parse(input.blockedAt) : Number.NaN;
    unblocked = unblockedDataOf({
      by: UNBLOCKED_BY,
      latencyMs: Number.isFinite(blockedMs) ? Math.max(0, nowMs - blockedMs) : 0,
    });
  }

  return Object.freeze({
    exitCode: 0,
    refusal: null,
    checksRun: Object.freeze(checks),
    lines: Object.freeze(lines),
    selectedRun: Object.freeze(selected),
    approvals: verification,
    firstUnapprovedPhase,
    route,
    launchRecordPath,
    reclaimed,
    deadLaunchClosedByLockTaker: reclaimed,
    acceptedChangesWritten,
    environment: environmentOfResume({ gitCommits: input.confGitCommits }),
    continuation,
    runLaunched,
    engineExecutable,
    engineCommand,
    replay,
    ...(unblocked !== undefined ? { unblocked } : {}),
  });
}
