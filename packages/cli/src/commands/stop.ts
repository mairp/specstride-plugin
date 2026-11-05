/**
 * T024 — the command surface of `stop` (F102-FR-001, F102-FR-002,
 * F102-FR-010).
 *
 * WHAT THE COMMAND DOES. `stop` writes ONE stop request per workspace into
 * the inbox, under the logical name `inbox:stop` — atomically, through the
 * writer of `../run-control/stop-request-writer.ts` (F102-FR-001) — and
 * exits 0. With `--now` it also ends the owned processes of the pass in
 * flight through `../run-control/signal-owned.ts` (F102-FR-006), and `--jobs`
 * asks for the adoptable jobs too (F102-FR-008).
 *
 * WITH NO RUN ACTIVE (F102-FR-002; B-1578). `stop` still writes the request
 * and warns on the error stream — the two as-is warnings, byte for byte —
 * that no run appears to be active and that a starting run will honour the
 * request, and exits 0. The next engine start stops at once.
 *
 * WITH A RUN THE ENGINE'S RECORDS SHOW (owed item 3 of par-4, the reviewer
 * ruling). The engine of this build takes no workspace lock and writes no
 * workspace record, so the as-is check never saw a real run: on a LIVE run
 * the command said `no run appears to be active … (lock is free)` and exited
 * 1. The command now reads the live run from WHAT THE ENGINE REALLY WRITES
 * (`run-control/live-run-evidence.ts`): the supervision registry
 * (`<controlRoot>/procs.json`) holding an entry, or the newest run's event
 * file not yet ended by the terminal event. Where the records show a run,
 * the two warnings are absent, one sentence names the file the answer came
 * from, and the run's own records count as state for the exit — exit 0;
 * exit 1 only where NO state of any kind stood.
 *
 * THE EXIT CODES (F102-FR-002). 0 in every branch once state exists; 1 when
 * the workspace has no state — no workspace record (`workspace:record`,
 * `specstride.layout/1`) that reads back.
 *
 * THE LINES (F102-FR-010; D-9). The compatibility lines of the as-is front
 * door, byte for byte, with the path the request actually has:
 *
 *   `stop requested → <path of inbox:stop>`                     (B-1548)
 *   `killed in-flight agent pass (pid <pid> + descendants)`      (B-1549)
 *   `recorded pass (pid <pid or ?>) is not running — nothing to kill` (B-1550)
 *   `no in-flight pass recorded (<path> missing) — flag-only stop`    (B-1551)
 *   `the run will exit 6 (clean stop) momentarily; resume with: specstride resume -w <workdir>` (B-1552)
 *   `the run finishes its current pass, then exits 6 (clean stop).`  (B-1553)
 *
 * and ONE product line, `[SPECSTRIDE-STOP]` with the keys `request`, `now`,
 * `ended` and `next` (annex G §G.3), printed through the line grammar so a
 * key the table does not hold cannot be printed at all (F100-FR-178). Under
 * the `parity` profile the product line is silent and the compatibility
 * lines remain: they are the surfaces the parity oracle compares.
 */
import { existsSync, readFileSync } from "node:fs";

import {
  resolve as resolveLogicalName,
  rootPathsOf,
} from "@specstride/contracts/ids/logical-names";
import { printLine } from "@specstride/contracts/grammar/line-keys";
import { PROFILE_NAME } from "@specstride/contracts/profile/parity";
import { isWorkspaceRecord } from "@specstride/contracts/records/workspace-record";
import { writeStopRequest } from "../run-control/stop-request-writer.ts";
import {
  aRunStandsOpenLine,
  theLiveRunOfTheEngineRecords,
  type LiveRunOfTheRecords,
} from "../run-control/live-run-evidence.ts";
import {
  nowLineKindOf,
  signalOwnedEntries,
  type SignalOwnedResult,
} from "../run-control/signal-owned.ts";

/** The command name, as the consumer types it. */
export const COMMAND = "stop" as const;

/** The label of the one product line (annex G §G.3). */
export const STOP_LABEL = "SPECSTRIDE-STOP" as const;

/** The requirements this module carries out. */
export const STOP_COMMAND_REQUIREMENTS = ["F102-FR-001", "F102-FR-002", "F102-FR-010"] as const;

/* ------------------------------------------------------------------ *
 * The compatibility lines (F102-FR-010), as templates.
 * ------------------------------------------------------------------ */

/** `stop` prints this after the request is written (B-1548). */
export function stopRequestedLine(requestPath: string): string {
  return `stop requested → ${requestPath}`;
}

/** `stop --now` prints this after it ended a live pass (B-1549). */
export function killedPassLine(pid: number): string {
  return `killed in-flight agent pass (pid ${pid} + descendants)`;
}

/** `stop --now` prints this when the recorded pass is dead or unrecorded (B-1550). */
export function passNotRunningLine(pid: number | null): string {
  return `recorded pass (pid ${pid ?? "?"}) is not running — nothing to kill`;
}

/** `stop --now` prints this when no pass is recorded at all (B-1551). */
export function noPassRecordedLine(path: string): string {
  return `no in-flight pass recorded (${path} missing) — flag-only stop`;
}

/** `stop --now` ends with this (B-1552). */
export function nowTailLine(workdir: string): string {
  return `the run will exit 6 (clean stop) momentarily; resume with: specstride resume -w ${workdir}`;
}

/** `stop` without `--now` prints this (B-1553). */
export const CLEAN_STOP_LINE =
  "the run finishes its current pass, then exits 6 (clean stop)." as const;

/** The warning of `stop` with no run active, first line (B-1578). */
export function noRunWarningLine(workdir: string): string {
  return `no run appears to be active on ${workdir} (lock is free).`;
}

/** The warning of `stop` with no run active, second line (B-1578). */
export const WRITING_ANYWAY_LINE =
  "writing stop.flag anyway (a starting run will honor it)." as const;

/* ------------------------------------------------------------------ *
 * The exit codes (F102-FR-002).
 * ------------------------------------------------------------------ */

/** 0 in every branch once state exists. */
export const STOP_EXIT_OK = 0 as const;
/** 1 when the workspace has no state (no workspace record). */
export const STOP_EXIT_NO_STATE = 1 as const;

/** The exit code of `stop` (F102-FR-002). */
export function stopExitCode(input: { readonly stateExists: boolean }): 0 | 1 {
  return input.stateExists ? STOP_EXIT_OK : STOP_EXIT_NO_STATE;
}

/* ------------------------------------------------------------------ *
 * The state check.
 * ------------------------------------------------------------------ */

/**
 * Whether the workspace has state: a workspace record that reads back and
 * validates against `specstride.layout/1` (F102-FR-002). A record that is
 * absent, unreadable or refused is NO state.
 */
export function workspaceStateExists(workspaceRecordPath: string): boolean {
  try {
    if (!existsSync(workspaceRecordPath)) return false;
    return isWorkspaceRecord(JSON.parse(readFileSync(workspaceRecordPath, "utf8")));
  } catch {
    return false;
  }
}

/** Whether a run APPEARS to be active: the lock of the workspace is held. */
export function lockAppearsHeld(lockDirectory: string): boolean {
  try {
    return existsSync(lockDirectory) && readFileSync(`${lockDirectory}/owner`, "utf8").length > 0;
  } catch {
    // An empty lock directory, or no owner record: the lock is free.
    try {
      return (
        existsSync(lockDirectory) && readFileSync(`${lockDirectory}/owner.json`, "utf8").length > 0
      );
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------ *
 * The command.
 * ------------------------------------------------------------------ */

/** What one printed line went to. */
export type StopLine = {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
};

/** What `stop` came to, as the caller of the surface observes it. */
export type StopResult = {
  readonly exitCode: 0 | 1;
  /** The path of the request written (`inbox:stop`). */
  readonly requestPath: string;
  /** Whether the workspace had state (F102-FR-002). */
  readonly stateExists: boolean;
  /**
   * The run the engine's OWN records show live or standing open (owed item 3
   * of par-4): the supervision registry holding an entry, or the newest run's
   * event file not yet ended by the terminal event. `live` false where the
   * records name nothing.
   */
  readonly liveRun: LiveRunOfTheRecords;
  /** Whether a run appeared to be active when the command ran. */
  readonly runAppearedActive: boolean;
  /** The lines, in the order they are printed; the caller prints them. */
  readonly lines: readonly StopLine[];
  /** The `--now` outcome, where `--now` was asked. */
  readonly nowOutcome: SignalOwnedResult | null;
};

/** What the caller of `runStop` gives. */
export type StopInput = {
  /** The control root of the workspace (`<control>` of the layout table). */
  readonly controlRoot: string;
  /** The REAL path of the workspace root. */
  readonly workspaceRealPath: string;
  /** The workdir as the consumer gave it, for the as-is lines. */
  readonly workdir?: string | undefined;
  /** `stop --now`. */
  readonly now?: boolean | undefined;
  /** `--jobs`: also end adoptable jobs. */
  readonly jobs?: boolean | undefined;
  /** The profile: the product line is silent under `parity`. */
  readonly profile?: string | undefined;
  /** The recorded entries of the process registry, read by the caller. */
  readonly processes?:
    readonly import("@specstride/contracts/records/process-registry").ProcessRegistry[] | undefined;
  /** The path the pass record is expected at, for the `no in-flight pass` line. */
  readonly passRecordPath?: string | undefined;
  /** Hash of the run token, when a run was active and the caller knows it. */
  readonly runTokenHash?: string | undefined;
  /** The clock tick of the request; the caller's clock, never read here. */
  readonly at?: string | undefined;
};

/**
 * Run `stop` (F102-FR-001, F102-FR-002). Writes the request (atomically, and
 * always — with no run active too), ends owned processes only under `--now`,
 * prints the compatibility lines and the one product line, and answers with
 * the result the caller prints and exits by.
 */
export function runStop(input: StopInput): StopResult {
  const workdir = input.workdir ?? input.workspaceRealPath;
  const roots = rootPathsOf({
    home: "",
    workspaceRealPath: input.workspaceRealPath,
    workspaceId: "",
    controlRoot: input.controlRoot,
    workerRoot: "",
  });
  const requestPath = resolveLogicalName("inbox:stop", {}, roots);
  const stateExists = workspaceStateExists(resolveLogicalName("workspace:record", {}, roots));
  // THE LIVE RUN OF THE ENGINE'S OWN RECORDS (owed item 3 of par-4): the
  // registry the engine writes while a pass is in flight, and the newest
  // run's event file while no clean end stands in it. The engine of this
  // build takes no lock and writes no workspace record, so this is the only
  // reading that can see a real run; the lock stays in the answer for a host
  // whose engine does hold one.
  const liveRun = theLiveRunOfTheEngineRecords(input.controlRoot);
  const runAppearedActive =
    liveRun.live || lockAppearsHeld(resolveLogicalName("workspace:lock", {}, roots));

  // The request, always, and atomically (F102-FR-001): `now` and `jobs` are
  // false unless asked; the hash of the run token only when a run was active.
  writeStopRequest(requestPath, {
    now: input.now === true,
    jobs: input.jobs === true,
    ...(input.runTokenHash !== undefined && runAppearedActive
      ? { runTokenHash: input.runTokenHash }
      : {}),
    ...(input.at !== undefined ? { at: input.at } : {}),
  });

  const lines: StopLine[] = [];

  // WHERE THE RECORDS SHOW A LIVE RUN (owed item 3 of par-4): one sentence
  // on standard output naming the file the answer came from, in place of the
  // two warnings below, which are then absent. Under `parity` the sentence
  // is silent with the product line: the compatibility surface is what the
  // oracle compares (F100-FR-187).
  if (liveRun.live && input.profile !== PROFILE_NAME) {
    lines.push(Object.freeze({ stream: "stdout", text: aRunStandsOpenLine(liveRun) }));
  }

  // With no run active (F102-FR-002; B-1578): the two warnings, on stderr.
  if (!runAppearedActive) {
    lines.push(
      Object.freeze({ stream: "stderr", text: noRunWarningLine(workdir) }),
      Object.freeze({ stream: "stderr", text: WRITING_ANYWAY_LINE }),
    );
  }

  // `--now`: end the owned processes under the identity check (F102-FR-006
  // to F102-FR-008), then the compatibility line the outcome chooses.
  let nowOutcome: SignalOwnedResult | null = null;
  if (input.now === true) {
    nowOutcome = signalOwnedEntries(input.processes ?? [], { jobs: input.jobs === true });
    const kind = nowLineKindOf(nowOutcome);
    if (kind === "killed") {
      lines.push(Object.freeze({ stream: "stdout", text: killedPassLine(nowOutcome.passPid!) }));
    } else if (kind === "not-running") {
      lines.push(Object.freeze({ stream: "stdout", text: passNotRunningLine(nowOutcome.passPid) }));
    } else {
      // The flag-only line names the path of the registry (`run:<runId>:procs`,
      // written by the engine) — resolved only here, where the line needs it;
      // a workspace that has no run in flight has no run id to resolve, and
      // the line then names the registry under the engine's writer as the
      // layout table templates it.
      const passRecordPath =
        input.passRecordPath ??
        `${input.controlRoot.replace(/\/$/, "")}/features/-/runs/-/procs/engine.jsonl`;
      lines.push(Object.freeze({ stream: "stdout", text: noPassRecordedLine(passRecordPath) }));
    }
    lines.push(Object.freeze({ stream: "stdout", text: nowTailLine(workdir) }));
  }

  // The compatibility line of the request itself (B-1548), then the one
  // product line (silent under `parity`, F100-FR-187).
  lines.push(Object.freeze({ stream: "stdout", text: stopRequestedLine(requestPath) }));
  if (!input.now) {
    lines.push(Object.freeze({ stream: "stdout", text: CLEAN_STOP_LINE }));
    lines.push(Object.freeze({ stream: "stdout", text: nowTailLine(workdir) }));
  }
  if (input.profile !== PROFILE_NAME) {
    lines.push(
      Object.freeze({
        stream: "stdout",
        text: printLine(STOP_LABEL, {
          request: requestPath,
          now: input.now === true,
          ended: nowOutcome === null ? false : nowOutcome.signalsSent,
          next: "resume",
        }),
      }),
    );
  }

  return Object.freeze({
    // THE EXIT (F102-FR-002, as the reviewer ruling of par-4 item 3 reads
    // it): the run's own records ARE state of the workspace, so a run the
    // records show live or standing open exits 0 — exit 1 means NO state of
    // any kind stood, not merely no record.
    exitCode: stopExitCode({ stateExists: stateExists || liveRun.live }),
    requestPath,
    stateExists,
    liveRun,
    runAppearedActive,
    lines: Object.freeze(lines),
    nowOutcome,
  });
}
