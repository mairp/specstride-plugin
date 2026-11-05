/**
 * T041/T046 — the `supervise` command of the CLI (features 107 and 123).
 *
 * The command is a thin wiring over the supervisors of
 * `@specstride/pipeline`: it parses the argv of the verb, dispatches, prints
 * the lines the verb produces, and ends with the exit code the verb's
 * outcome map gives. The record, the cadence and every decision stay in the
 * pipeline package; this file holds no rule of supervision.
 */
// F100-FR-003: between the CLI and the runtime root there are only files —
// the command imports the sources of @specstride/pipeline by path, never by
// package name.
import {
  LAUNCH_CHECKS,
  runLaunchChecks,
  type LaunchCheckContext,
} from "../../../pipeline/src/launch-checks/checks.ts";
import { chooseMode, mapMode } from "../../../pipeline/src/supervisor/mode.ts";
import {
  resolveLauncher,
  readLaunchBundle,
  displayPath,
  RESOLVE_REFUSAL_EXIT,
} from "../../../pipeline/src/supervisor/resolve.ts";
import {
  parseVerbArgv,
  VerbUsageError,
  exitForStatus,
  EXIT_MAP,
  exitOfRefusalReason,
  supervisionRefusal,
  INVALID_CONTRACT_REASON,
} from "../../../pipeline/src/supervisor/verbs.ts";
import { superviseLaunch } from "../../../pipeline/src/supervisor/launch.ts";
import { dirname, basename, join } from "node:path";

export { LAUNCH_CHECKS, EXIT_MAP, RESOLVE_REFUSAL_EXIT };

/** The result of one invocation of the command: the printed lines and the exit code. */
export type SuperviseCommandResult = {
  readonly lines: readonly string[];
  readonly exit: number;
};

/** The dependencies the command runs against; every one is injected. */
export type SuperviseCommandDeps = {
  print?(text: string): void;
  /** The gate the `gate` and `launch` verbs run against. */
  launchContext?: LaunchCheckContext;
  startDetached?(args: readonly string[], options: unknown): Promise<{ pid: number; pgid: number }>;
  now?(): number;
};

/** The usage error exit of the command (§R.7: a usage error exits 2). */
export const USAGE_EXIT = 2 as const;

/** The `mode` verb: choose the mode, print the mode line, exit 0 always. */
export function superviseModeCommand(input: {
  request: string;
  tokens?: readonly string[];
  output?: "compatibility" | "default";
}): SuperviseCommandResult {
  const choice = chooseMode({ tokens: input.tokens, text: input.request });
  const output = input.output ?? "default";
  const evidence = choice.evidence ?? "";
  const line =
    output === "default"
      ? `[SPECSTRIDE-MODE] mode=${mapMode(choice.mode)} source=${choice.source}`
      : `[MOL-MODE] mode=${choice.mode} source=${choice.source} evidence=${JSON.stringify(evidence)} flags=${JSON.stringify(choice.flags.implement ? ["--implement"] : [])}`;
  const lines = [line];
  if (mapMode(choice.mode) === "dry-run") {
    lines.push(
      `[SPECSTRIDE-NEXT] next=${JSON.stringify("the mode is dry-run; ask for `auto` to run it")}`,
    );
  }
  return { lines, exit: 0 };
}

/** The `resolve` verb: print the launcher line, or a refusal, exit 4 on refusal. */
export function superviseResolveCommand(input: {
  repo: string;
  feature?: string;
  launcher?: string;
  output?: "compatibility" | "default";
}): SuperviseCommandResult {
  const output = input.output ?? "default";
  const result = resolveLauncher({
    repoDir: input.repo,
    feature: input.feature,
    requested: input.launcher,
  });
  if (!result.ok) {
    return {
      lines: [
        output === "default"
          ? `[SPECSTRIDE-REFUSE] action=resolve reason=${result.refusal} next=${JSON.stringify("ask for `auto` to generate the launcher first")}`
          : `[MOL-REFUSE] action=resolve reason=${result.refusal} detail=${JSON.stringify("")} next=${JSON.stringify("ask for `auto` to generate the launcher first")}`,
      ],
      exit: RESOLVE_REFUSAL_EXIT,
    };
  }
  const bundle = readLaunchBundle(result.launcher);
  if (!bundle.ok) {
    return {
      lines: [
        output === "default"
          ? `[SPECSTRIDE-REFUSE] action=resolve reason=${bundle.refusal} next=${JSON.stringify("ask for `auto` to generate the launcher first")}`
          : `[MOL-REFUSE] action=resolve reason=${bundle.refusal} detail=${JSON.stringify("")} next=${JSON.stringify("ask for `auto` to generate the launcher first")}`,
      ],
      exit: RESOLVE_REFUSAL_EXIT,
    };
  }
  const shown = displayPath(input.repo, result.launcher);
  return {
    lines: [
      output === "default"
        ? `[SPECSTRIDE-LAUNCHER] launcher=${shown}`
        : `[MOL-LAUNCHER] launcher=${shown} source=${result.source}`,
    ],
    exit: 0,
  };
}

/** The `gate` verb: run the six checks, print every check and the decision. */
export function superviseGateCommand(input: {
  ctx: LaunchCheckContext;
  output?: "compatibility" | "default";
  parityProfile?: boolean;
}): SuperviseCommandResult {
  const output = input.output ?? "default";
  const gate = runLaunchChecks(input.ctx);
  const lines: string[] = [];
  for (const check of gate.checks) {
    // Under the `parity` profile only the six checks of §R.5 print a line
    // (F123-FR-022); a later-registered launch-blocking check stays silent.
    if (input.parityProfile === true && check.order > 6) continue;
    if (output === "default") continue; // only the decision, and the passing checks are not listed
    let body = `check=${check.name} status=${check.status}`;
    if (check.reason !== undefined) body += ` reason=${check.reason}`;
    if (check.detail !== undefined) body += ` detail=${JSON.stringify(check.detail)}`;
    lines.push(`[MOL-GATE] ${body}`);
  }
  if (gate.decision === "launch") {
    lines.push(
      output === "default" ? "[SPECSTRIDE-GATE] decision=launch" : "[MOL-GATE] decision=launch",
    );
  } else {
    const next =
      gate.reason === "already-running"
        ? "attach with `supervise watch --launcher`"
        : "fix the refusal the check names, then ask again";
    lines.push(
      output === "default"
        ? `[SPECSTRIDE-GATE] decision=${gate.decision} reason=${gate.reason} next=${JSON.stringify(next)}`
        : `[MOL-GATE] decision=${gate.decision} reason=${gate.reason} detail=${JSON.stringify(gate.detail ?? "")} next=${JSON.stringify(next)}`,
    );
  }
  // The exit code of the row of the refusal (F123-FR-016); 0 for a launch.
  return { lines, exit: gate.decision === "launch" ? 0 : exitOfRefusalReason(gate.reason ?? "") };
}

/** The `launch` verb through the pipeline supervisor (F123-FR-023, F123-FR-024). */
export async function superviseLaunchCommand(input: {
  ctx: LaunchCheckContext;
  pipelineId: string;
  launchId: string;
  mode?: string;
  runDir: string;
  statePath: string;
  launchLog: string;
  reportLog?: string;
  stageCount?: number;
  budgetRemaining?: number;
  budgetMaximum?: number;
  budgetSource?: string;
  output?: "compatibility" | "default";
  deps: SuperviseCommandDeps;
}): Promise<SuperviseCommandResult> {
  const lines: string[] = [];
  const result = await superviseLaunch({
    ctx: input.ctx,
    pipelineId: input.pipelineId,
    launchId: input.launchId,
    mode: input.mode ?? "run",
    runDir: input.runDir,
    statePath: input.statePath,
    launchLog: input.launchLog,
    reportLog: input.reportLog,
    stageCount: input.stageCount,
    budgetRemaining: input.budgetRemaining ?? 2,
    budgetMaximum: input.budgetMaximum ?? 2,
    budgetSource: input.budgetSource ?? "default",
    output: input.output ?? "default",
    ports: {
      start: async (args, options) => {
        if (input.deps.startDetached === undefined) {
          throw new Error("no detach strategy is available in this host");
        }
        return input.deps.startDetached(args, options);
      },
      now: input.deps.now ?? (() => Math.floor(Date.now() / 1000)),
      print: (text) => lines.push(text),
    },
  });
  return { lines, exit: result.exit };
}

/** Dispatch one `supervise` invocation. Usage errors end with exit 2. */
export async function superviseCommand(
  argv: readonly string[],
  deps: SuperviseCommandDeps = {},
): Promise<SuperviseCommandResult> {
  try {
    const parsed = parseVerbArgv(argv);
    switch (parsed.verb) {
      case "mode":
        return superviseModeCommand({
          request: parsed.flags.request ?? "",
          tokens: parsed.flags.token,
        });
      case "resolve":
        return superviseResolveCommand({
          repo: parsed.flags.repo ?? ".",
          feature: parsed.flags.feature,
          launcher: parsed.launcher,
        });
      case "gate":
        if (deps.launchContext === undefined) {
          return {
            lines: ["[SPECSTRIDE-REFUSE] action=gate reason=invalid-contract next=none"],
            exit: 4,
          };
        }
        return superviseGateCommand({ ctx: deps.launchContext });
      case "launch": {
        if (deps.launchContext === undefined) {
          return {
            lines: ["[SPECSTRIDE-REFUSE] action=launch reason=invalid-contract next=none"],
            exit: 4,
          };
        }
        const launcher = parsed.launcher!;
        const runDir = dirname(launcher);
        const pipelineId = basename(runDir) || "pipeline";
        return await superviseLaunchCommand({
          ctx: deps.launchContext,
          pipelineId,
          launchId: `launch-${Math.trunc(deps.now?.() ?? Date.now() / 1000)}`,
          mode: parsed.flags.mode ?? "run",
          runDir,
          statePath: join(runDir, "state.json"),
          launchLog: join(runDir, "launch.log"),
          reportLog: join(runDir, "report.log"),
          output: "default",
          deps,
        });
      }
      case "watch":
      case "observe":
      case "auto": {
        const lines: string[] = [];
        const exit = supervisionRefusal({
          action: parsed.verb,
          reason: INVALID_CONTRACT_REASON,
          output: "default",
          print: (t) => lines.push(t),
        });
        return { lines, exit };
      }
      case "stop": {
        // The request is the durable record; the group is signalled by the
        // pipeline's stop driver, not by this wiring, so `sent=false` here.
        return { lines: ["[SPECSTRIDE-SUPERVISE-STOP] pipeline=unknown sent=false"], exit: 0 };
      }
      case "hold":
      case "release": {
        const lines: string[] = [];
        const exit = supervisionRefusal({
          action: parsed.verb,
          reason: "no-live-run",
          output: "default",
          print: (t) => lines.push(t),
        });
        return { lines, exit };
      }
      default:
        return { lines: [], exit: exitForStatus("unknown-terminal") };
    }
  } catch (error) {
    if (error instanceof VerbUsageError) {
      return {
        lines: [
          `[SPECSTRIDE-REFUSE] action=supervise reason=usage next=${JSON.stringify(error.message)}`,
        ],
        exit: USAGE_EXIT,
      };
    }
    throw error;
  }
}
