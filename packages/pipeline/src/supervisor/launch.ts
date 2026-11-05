/**
 * T041 — `supervise launch` (F123-FR-023, F123-FR-024).
 *
 * The verb runs the launch checks, then starts the launcher through the
 * detach strategy (EP-17), once, with the argument array
 * `[launcher, --no-color]` followed by `--implement` and `--smoke` when
 * given — never a shell string. The started process has standard input
 * closed, is the leader of a process session of its own, and writes both of
 * its streams to the launch log, which receives the header
 * `=== launch <time> <argv> ===` at each launch and `=== relaunch <time>
 * <argv> ===` at each relaunch. The environment carries `NO_COLOR=1`. The
 * verb leaves the record of §R.9 and prints the launch line. A launch ends
 * in exactly one handshake outcome: `started` exits 0, `attached` exits 4,
 * `refused` exits 4, or the pipeline code 20, 21, 23 or 24 where the refusal
 * is one of the pipeline's.
 */
import { appendFileSync } from "node:fs";
import { HANDSHAKE_OUTCOMES, type HandshakeOutcome } from "@specstride/contracts/state/handshake";
import {
  runLaunchChecks,
  type LaunchCheckContext,
  type LaunchChecksResult,
} from "../launch-checks/checks.ts";
import {
  emptySupervisionRecord,
  writeSupervisionRecord,
  type SupervisionRecord,
} from "./record.ts";
import { launchLine, refuseLine, appendReportLog } from "./lines.ts";

/** The environment of a launch, of a relaunch and of the launch dry run. */
export function launchEnvironment(
  base: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return { ...base, NO_COLOR: "1" };
}

/** The argument array of a launch: never a shell string (F123-FR-023). */
export function launchArgv(input: {
  launcher: string;
  implement?: boolean;
  smoke?: boolean;
}): string[] {
  return [
    input.launcher,
    "--no-color",
    ...(input.implement ? ["--implement"] : []),
    ...(input.smoke ? ["--smoke"] : []),
  ];
}

/** The header the launch log receives at each launch and each relaunch. */
export function launchLogHeader(
  kind: "launch" | "relaunch",
  time: string,
  argv: readonly string[],
): string {
  return `=== ${kind} ${time} ${JSON.stringify(argv)} ===`;
}

/** Append a header to the launch log; a write failure is ignored. */
export function appendLaunchHeader(launchLogPath: string, header: string): void {
  try {
    appendFileSync(launchLogPath, `${header}\n`);
  } catch {
    /* the launch log never blocks a launch */
  }
}

/** The pipeline exit codes a refusal may carry (F123-FR-021, F123-FR-024). */
export const PIPELINE_REFUSAL_EXITS: Readonly<Record<string, number>> = Object.freeze({
  "invalid-contract": 20,
  "preflight-blocked": 21,
  "stale-sources": 23,
  "lock-conflict": 24,
  "already-running": 24,
});

/** The exit code of a handshake outcome (F123-FR-024). */
export function handshakeExit(outcome: HandshakeOutcome, refusalReason?: string): number {
  if (outcome === "started") return 0;
  if (refusalReason !== undefined) {
    const pipeline = PIPELINE_REFUSAL_EXITS[refusalReason];
    if (pipeline !== undefined) return pipeline;
  }
  return 4;
}

/** The three handshake outcomes, from the contracts of feature 100 (annex F §F.3). */
export const LAUNCH_HANDSHAKE_OUTCOMES: readonly string[] = HANDSHAKE_OUTCOMES;

/** The ports a launch needs; every one is injected, so the verb runs on a fake. */
export type LaunchPorts = {
  /** The detach strategy of EP-17. */
  start(
    args: readonly string[],
    options: {
      cwd: string;
      env: Readonly<Record<string, string | undefined>>;
      stdinClosed: true;
      ownSession: true;
      launchLog: string;
    },
  ): Promise<{ pid: number; pgid: number }>;
  now(): number;
  print(text: string): void;
};

/** The result of the `launch` verb: the decision, the outcome and its exit code. */
export type LaunchResult = {
  readonly outcome: HandshakeOutcome;
  readonly exit: number;
  readonly decision: LaunchChecksResult["decision"];
  readonly reason?: string;
  readonly record?: SupervisionRecord;
};

/** The exit code of the launch decision `refuse` and `attach`. */
export const LAUNCH_REFUSED_EXIT = 4 as const;

/**
 * Run the `launch` verb (F123-FR-023): checks, detach start, record, line.
 * When the decision is not `launch` nothing is started and the refusal line
 * is printed.
 */
export async function superviseLaunch(input: {
  ctx: LaunchCheckContext;
  pipelineId: string;
  launchId: string;
  mode: string;
  runDir: string;
  statePath: string;
  launchLog: string;
  reportLog?: string;
  stageCount?: number;
  budgetRemaining: number;
  budgetMaximum: number;
  budgetSource: string;
  output: "compatibility" | "default";
  ports: LaunchPorts;
}): Promise<LaunchResult> {
  const gate = runLaunchChecks(input.ctx);
  const lines: string[] = [];
  if (gate.decision !== "launch") {
    lines.push(
      refuseLine({
        action: "launch",
        reason: gate.reason as string,
        detail: gate.detail,
        next: "fix the refusal, or attach with `watch` when the reason is `already-running`",
        output: input.output,
      }).body,
    );
    const outcome: HandshakeOutcome = "refused";
    const exit = handshakeExit(outcome, gate.reason);
    for (const text of lines) input.ports.print(text);
    return { outcome, exit, decision: gate.decision, reason: gate.reason };
  }
  const argv = launchArgv({
    launcher: input.ctx.launcherPath,
    implement: input.ctx.flags.implement,
    smoke: input.ctx.flags.smoke,
  });
  const header = launchLogHeader("launch", new Date(input.ports.now() * 1000).toISOString(), argv);
  appendLaunchHeader(input.launchLog, header);
  const started = await input.ports.start(argv, {
    cwd: input.runDir,
    env: launchEnvironment(process.env),
    stdinClosed: true,
    ownSession: true,
    launchLog: input.launchLog,
  });
  const record = emptySupervisionRecord({
    pipeline: input.pipelineId,
    launchId: input.launchId,
    mode: input.mode,
    launcher: input.ctx.launcherPath,
    argv,
    cwd: input.runDir,
    runDir: input.runDir,
    statePath: input.statePath,
    launchLog: input.launchLog,
    reportLog: input.reportLog,
    stageCount: input.stageCount,
    firstLaunchedAt: Math.trunc(input.ports.now()),
    pipelineLogOffset: 0,
  });
  writeSupervisionRecord(input.statePath.replace(/state[^/]*$/, "supervision.json"), record);
  const printed = launchLine({
    pipeline: input.pipelineId,
    mode: input.mode,
    launcher: input.ctx.launcherPath,
    runDir: input.runDir,
    stages: input.stageCount ?? 0,
    flags: input.ctx.flags.implement ? ["--implement"] : [],
    budgetRemaining: input.budgetRemaining,
    budgetMaximum: input.budgetMaximum,
    budgetSource: input.budgetSource,
    pid: started.pid,
    pgid: started.pgid,
    output: input.output,
  }).body;
  lines.push(printed);
  appendReportLog(input.reportLog, printed);
  for (const text of lines) input.ports.print(text);
  return { outcome: "started", exit: handshakeExit("started"), decision: "launch", record };
}
