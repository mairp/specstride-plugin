/**
 * T046 — the verbs of `supervise`: `gate`, `watch`, `observe`, `auto`,
 * `stop`, `hold` and `release`, their arguments, results and the exit map
 * (F123-FR-034, F123-FR-037).
 *
 * A verb takes `--launcher PATH` or `--run-dir DIR` — exactly one, one is
 * required — and `gate`, `launch` and `auto` accept only `--launcher`.
 * Supervision ends with one outcome of the exit map: completed 0, stopped 2,
 * unknown-terminal 3, refused 4, supervision-expired 5, failed 22,
 * lock-conflict 24; any other status 1; interrupted by the operator 130 with
 * the reason `interrupted`; a usage error 2. An error of supervision that
 * carries a reason prints `[MOL-REFUSE] action=<command> reason=<reason>` and
 * exits 4. `stop` records the stop request before it signals, sends only the
 * termination signal to the process group, and never a kill signal.
 */
import { supervisionExitCode } from "@specstride/contracts/codes/resume-and-supervision";
import { verbsOfSupervise } from "@specstride/contracts";
import { refuseLine, appendReportLog } from "./lines.ts";
import { PIPELINE_REFUSAL_EXITS } from "./launch.ts";

/** The closed set of the verbs of `supervise` (row 111). */
export const VERBS = verbsOfSupervise;

/** The parsed arguments of one verb invocation. */
export type VerbArgv = {
  readonly verb: string;
  readonly launcher?: string;
  readonly runDir?: string;
  readonly flags: {
    readonly implement: boolean;
    readonly smoke: boolean;
    readonly json: boolean;
    readonly noRelaunch: boolean;
    readonly mode?: string;
    readonly token: readonly string[];
    readonly request?: string;
    readonly repo?: string;
    readonly feature?: string;
    readonly reason?: string;
    readonly pollSeconds?: number;
    readonly maxPollSeconds?: number;
    readonly maxWaitSeconds?: number;
    readonly cadence?: number;
  };
};

/** A usage error of a verb invocation; supervision exits 2. */
export class VerbUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerbUsageError";
  }
}

/** True when the verb accepts `--run-dir` at all. */
export function verbAcceptsRunDir(verb: string): boolean {
  return !["gate", "launch", "auto"].includes(verb);
}

/**
 * Parse the arguments of one verb (F123-FR-034): `--launcher` and `--run-dir`
 * are mutually exclusive and one is required; `gate`, `launch` and `auto`
 * accept only `--launcher`. A positional number is the cadence.
 */
export function parseVerbArgv(argv: readonly string[]): VerbArgv {
  if (argv.length === 0) {
    throw new VerbUsageError("no verb given");
  }
  const verb = argv[0] as string;
  if (!VERBS.has(verb)) {
    throw new VerbUsageError(`unknown verb ${JSON.stringify(verb)}`);
  }
  const rest = [...argv.slice(1)];
  let launcher: string | undefined;
  let runDir: string | undefined;
  let cadence: number | undefined;
  const token: string[] = [];
  const flags: Record<string, unknown> = { token };
  while (rest.length > 0) {
    const arg = rest.shift() as string;
    switch (arg) {
      case "--launcher":
        launcher = rest.shift();
        if (launcher === undefined) throw new VerbUsageError("--launcher takes a path");
        break;
      case "--run-dir":
        runDir = rest.shift();
        if (runDir === undefined) throw new VerbUsageError("--run-dir takes a directory");
        break;
      case "--implement":
        flags.implement = true;
        break;
      case "--smoke":
        flags.smoke = true;
        break;
      case "--json":
        flags.json = true;
        break;
      case "--no-relaunch":
        flags.noRelaunch = true;
        break;
      case "--mode":
        flags.mode = rest.shift();
        break;
      case "--token": {
        const value = rest.shift();
        if (value === undefined) throw new VerbUsageError("--token takes a value");
        token.push(value);
        break;
      }
      case "--request":
        flags.request = rest.shift();
        break;
      case "--repo":
        flags.repo = rest.shift();
        break;
      case "--feature":
        flags.feature = rest.shift();
        break;
      case "--reason":
        flags.reason = rest.shift();
        break;
      case "--poll-seconds":
        flags.pollSeconds = Number(rest.shift());
        break;
      case "--max-poll-seconds":
        flags.maxPollSeconds = Number(rest.shift());
        break;
      case "--max-wait-seconds":
        flags.maxWaitSeconds = Number(rest.shift());
        break;
      default:
        if (/^\d+$/.test(arg) && cadence === undefined) {
          cadence = Number(arg);
          break;
        }
        throw new VerbUsageError(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  if (launcher !== undefined && runDir !== undefined) {
    throw new VerbUsageError("--launcher and --run-dir are mutually exclusive; give exactly one");
  }
  if (
    launcher === undefined &&
    runDir === undefined &&
    verb !== "mode" &&
    verb !== "resolve" &&
    verb !== "hold" &&
    verb !== "release"
  ) {
    throw new VerbUsageError("one of --launcher and --run-dir is required");
  }
  if (!verbAcceptsRunDir(verb) && runDir !== undefined) {
    throw new VerbUsageError(`${verb} accepts only --launcher`);
  }
  return {
    verb,
    launcher,
    runDir,
    flags: {
      implement: flags.implement === true,
      smoke: flags.smoke === true,
      json: flags.json === true,
      noRelaunch: flags.noRelaunch === true,
      mode: flags.mode as string | undefined,
      token,
      request: flags.request as string | undefined,
      repo: flags.repo as string | undefined,
      feature: flags.feature as string | undefined,
      reason: flags.reason as string | undefined,
      pollSeconds: flags.pollSeconds as number | undefined,
      maxPollSeconds: flags.maxPollSeconds as number | undefined,
      maxWaitSeconds: flags.maxWaitSeconds as number | undefined,
      cadence,
    },
  };
}

/** The exit map of supervision (§R.7): an unknown status ends with 1. */
export function exitForStatus(status: string): number {
  const mapped = supervisionExitCode(status);
  return mapped ?? 1;
}

/** The reason of an interrupt of supervision, and its detail (F123-FR-037). */
export const INTERRUPTED_REASON = "interrupted" as const;
export const INTERRUPTED_DETAIL = "supervision was interrupted; the run was left alone" as const;
/** The exit code of an interrupt of supervision. */
export const INTERRUPTED_EXIT = 130 as const;
/** The reason an invalid launch contract outside the launch checks carries. */
export const INVALID_CONTRACT_REASON = "invalid-contract" as const;

/** The refusal an error of supervision prints: exit 4, with the reason. */
export function supervisionRefusal(input: {
  action: string;
  reason: string;
  detail?: string;
  next?: string;
  output: "compatibility" | "default";
  reportLog?: string;
  print(text: string): void;
}): 4 {
  input.print(
    refuseLine({
      action: input.action,
      reason: input.reason,
      detail: input.detail,
      next: input.next,
      output: input.output,
    }).body,
  );
  return 4;
}

/** The ports of the `stop` verb; the signal port is injected, so no test signals a live group. */
export type StopPorts = {
  recordStop(signal: string, now: number): void;
  signalGroup(pgid: number, signal: string): void;
  now(): number;
};

/** The only signal `stop` sends: the termination signal of the process group, never a kill signal. */
export const STOP_SIGNAL = "SIGTERM" as const;

/**
 * The `stop` verb (F123-FR-034): record the stop request in the supervision
 * record before any signal goes out, then signal the process group of the
 * run — the termination signal only — and never a kill signal.
 */
export function runStop(pgid: number | null, ports: StopPorts): { sent: boolean; signal: string } {
  // 1. The request is durable before anything is signalled.
  ports.recordStop(STOP_SIGNAL, ports.now());
  // 2. The termination signal to the group; no kill signal, ever.
  if (pgid !== null && pgid > 1) {
    ports.signalGroup(pgid, STOP_SIGNAL);
    return { sent: true, signal: STOP_SIGNAL };
  }
  return { sent: false, signal: STOP_SIGNAL };
}

/** The result of `hold` and `release`: written, or refused with `no-live-run`, exit 4. */
export type HoldVerbResult = { written: true } | { written: false; reason: "no-live-run"; exit: 4 };

/** The refusal the `hold` and `release` verbs print when no live run exists. */
export function holdVerbResult(liveRun: boolean): HoldVerbResult {
  if (!liveRun) return { written: false, reason: "no-live-run", exit: 4 };
  return { written: true };
}

/** The poll interval of `stop` supervision: `min(poll, 5)` seconds, at most 120 by default. */
export function stopPollSeconds(pollSeconds: number, maxTotalSeconds = 120): number {
  return Math.min(Math.min(pollSeconds, 5), maxTotalSeconds);
}

/** One entry of the exit map of supervision, as a record for the tests. */
export const EXIT_MAP: Readonly<Record<string, number>> = Object.freeze({
  completed: 0,
  stopped: 2,
  "unknown-terminal": 3,
  refused: 4,
  "supervision-expired": 5,
  failed: 22,
  "lock-conflict": 24,
  usage: 2,
  interrupted: 130,
});

/**
 * The exit code of a refusal (F123-FR-016: the exit code of its row): the
 * pipeline's code where the refusal is one of the pipeline's (20, 21, 23,
 * 24), the code of the terminal state where the run reached one (0, 2, 3),
 * and 4 for every other refusal.
 */
export function exitOfRefusalReason(reason: string): number {
  if (reason in PIPELINE_REFUSAL_EXITS) {
    return PIPELINE_REFUSAL_EXITS[reason as keyof typeof PIPELINE_REFUSAL_EXITS]!;
  }
  for (const status of ["completed", "stopped", "unknown-terminal"] as const) {
    if (reason === status) return EXIT_MAP[status]!;
  }
  return EXIT_MAP.refused!;
}

/** Append one line to the report log of the run, once (F123-FR-038). */
export function logSuperviseLine(reportLog: string | undefined, text: string): void {
  appendReportLog(reportLog, text);
}
