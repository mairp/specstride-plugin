/**
 * T051 — the verb wiring of `launch` (F107-FR-032, F107-FR-033, F107-FR-034;
 * contracts/commands.md, row "`launch`").
 *
 * The wiring is thin: it parses the arguments through the modes of
 * `@specstride/pipeline` (`src/contract/launch/modes.ts`), and
 *
 * - in the mode `run` it resolves the launcher (the `--launcher` path wins,
 *   else the launcher `contract render` wrote under the state of the
 *   pipeline — F123-FR-026), runs the launch checks of §R.5
 *   (`runLaunchChecks`) — the first failure refuses with the pipeline's
 *   exit — and then calls the handshake of feature 122
 *   (`runLaunchHandshake` of this package) with the REAL detach strategy
 *   `spawn-detached` and the runtime entry `[node, <launcher>, --no-color]`:
 *   the record, the detach, the wait and the outcome are the handshake
 *   owner's, and no launch record is written by this file;
 * - in the mode `dry-run` it reports what would be launched: the line
 *   `[SPECSTRIDE-DRY-RUN]` of contracts/commands.md, over a promoted launch
 *   contract. A call with no promoted launch contract refuses with exit 20
 *   and a `next:` line that names `contract derive` — `launch` never derives
 *   (F107-FR-033);
 * - a call whose arguments carry a refusal (an unknown mode, a usage error)
 *   withholds the launch: the refusal line of annex G §G.3, the code of the
 *   refusal, and NO launch record — the handshake is never called
 *   (F107-FR-032).
 *
 * The handshake itself is injected, so the characterization test of the
 * modes proves on a stub that the wiring calls it in the mode `run` and in
 * no other.
 */
import {
  LAUNCH_MODES,
  parseLaunchArgs,
  LAUNCH_REFUSED_EXIT,
  REFUSAL_OF_AN_UNKNOWN_MODE,
  type LaunchArgs,
} from "../../../pipeline/src/contract/launch/modes.ts";
import { runLaunchHandshake, type LaunchHandshakeOutcome } from "./launch-handshake.ts";
import {
  dryRun,
  type DryRunInput,
  type DryRunOutcome,
} from "../../../pipeline/src/contract/launch/dry-run.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveLauncher } from "../../../pipeline/src/supervisor/resolve.ts";
import { launcherPathUnderState } from "../../../pipeline/src/contract/commands/render.ts";
import {
  runLaunchChecks,
  type LaunchCheckContext,
} from "../../../pipeline/src/launch-checks/checks.ts";
import { validateInOrder } from "../../../pipeline/src/contract/validate/order.ts";
import {
  DEFAULT_CHECKS,
  DEFAULT_STAGE_KINDS,
} from "../../../pipeline/src/contract/default-registries.ts";
import {
  PreconditionCheckRegistry,
  StageKindRegistry,
} from "../../../pipeline/src/kinds/registry.ts";
import { PIPELINE_REFUSAL_EXITS } from "../../../pipeline/src/supervisor/launch.ts";
// The reach into the runtime package (F100-FR-003, LR-1): its SOURCES by
// relative path, exactly the pattern of `commands/supervise.ts` — the
// strategy of EP-17 and the lease token its context demands.
import {
  createSpawnDetachedStrategy,
  RUNTIME_LOG_LOGICAL_NAME,
} from "../../../runtime/src/detach/spawn-detached.ts";
import { mintLeaseToken } from "../../../runtime/src/procs/run-token.ts";
import { controlPlaneOf } from "../router/guards.ts";

export { LAUNCH_MODES, parseLaunchArgs, LAUNCH_REFUSED_EXIT, REFUSAL_OF_AN_UNKNOWN_MODE };
export type { LaunchArgs };

/**
 * The names of the environment the detached root may see (§F.6): the ones the
 * host owns (a path, a home, a temporary directory, a locale), the ones the
 * product owns (the engine of a contract stage, the module the launcher
 * becomes, the integrity module the launcher checks with, the launcher file
 * it names, the state directory, the profile), and the harness roles the
 * configuration pins. Nothing else of the shell crosses.
 */
export const ENVIRONMENT_ALLOW_LIST: readonly string[] = Object.freeze([
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "SPECSTRIDE_ENGINE",
  "SPECSTRIDE_PIPELINE_ENTRY",
  "SPECSTRIDE_LAUNCH_INTEGRITY_MODULE",
  "SPECSTRIDE_LAUNCHER_FILE",
  "SPECSTRIDE_BUNDLE_PATH",
  "SPECSTRIDE_STATE_DIR",
  "SPECSTRIDE_PROFILE",
  "SPECSTRIDE_PROPOSER",
  "SPECSTRIDE_CRITIC",
  "SPECSTRIDE_PROPOSER_TIMEOUT_SEC",
  "SPECSTRIDE_CRITIC_TIMEOUT_SEC",
  "SPECSTRIDE_PROPOSER_MAX_ERRORS",
  "SPECSTRIDE_CONFIG",
]);

/** The absolute path of the runtime root the launcher becomes. */
/**
 * The module file of this build: the ONE rollup bundle when this code runs
 * packed (`specstride.mjs`), the source module when it runs from the
 * repository. A URL-relative source path exists only in the repository; in
 * the packed bundle every relative URL lands inside the bundle itself, so
 * there the bundle IS the module — it exports `main` (and the launcher's
 * integrity check) beside `route` through `src/bundle-entry.ts`.
 */
function moduleFileOf(relativeSourcePath: string): string {
  const packed = fileURLToPath(import.meta.url);
  if (packed.endsWith(".mjs")) return packed;
  const source = fileURLToPath(new URL(relativeSourcePath, import.meta.url));
  return existsSync(source) ? source : packed;
}

/**
 * The physical path of the launch bundle the launcher names: the address is
 * the first 20 hex of the contract hash of its own marker line, under the
 * bundle place of the state layout (F107-FR-026, F107-FR-031). `null` when
 * the marker cannot be read — the integrity check then names the bundle as
 * missing, which is the honest refusal. Exported for the wiring test: the
 * address is the seam between the render (which writes the bundle there) and
 * the launcher's integrity check (which reads it from the environment).
 */
export function bundlePathOfTheLauncher(
  launcherPath: string,
  root: string,
  pipelineId: string,
): string | null {
  try {
    const text = readFileSync(launcherPath, "utf8");
    const marker = text.split("\n").find((one) => one.startsWith("// specstride launcher v"));
    const hash = marker === undefined ? undefined : marker.split("contract=")[1];
    if (hash === undefined || hash.length < 20) return null;
    return join(root, ".specstride", "state", "pipeline", pipelineId, "bundle", hash.slice(0, 20));
  } catch {
    return null;
  }
}

/** The pipeline id of a contract path of the state layout (`…/<id>/contract`). */
function pipelineIdOf(contractPath: string): string {
  return basename(dirname(contractPath));
}

/** The absolute path of the runtime root the launcher becomes. */
function pipelineEntryPath(): string {
  return moduleFileOf("../runtime-root/pipeline-main.ts");
}

/** The absolute path of the integrity module the launcher checks with. */
function integrityModulePath(): string {
  return moduleFileOf("../../../pipeline/src/contract/launch/integrity.ts");
}

/** The CLI of this build, as a contract stage's `specstride` resolves to it. */
function engineExecutablePath(): string {
  return process.argv[1] === undefined ? process.execPath : resolve(process.argv[1]);
}

/**
 * The pipeline id of the NEWEST contract under the state of the control
 * plane: the pipeline this launch runs. The contract file's own modification
 * time orders the directories; none is there before `contract derive`.
 */
export function newestPipelineId(controlRoot: string): string | null {
  const pipelines = join(controlRoot, "state", "pipeline");
  if (!existsSync(pipelines)) return null;
  let newest: { id: string; at: number } | null = null;
  for (const entry of readdirSync(pipelines, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const contract = join(pipelines, entry.name, "contract");
    const at = statSync(contract, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (at === 0) continue;
    if (newest === null || at > newest.at) newest = { id: entry.name, at };
  }
  return newest?.id ?? null;
}

/** The launch-check context of a real launch, over the contract of the pipeline. */
function launchCheckContextOf(input: {
  readonly root: string;
  readonly launcherPath: string;
  readonly contractPath: string;
  readonly lockHeld: boolean;
}): LaunchCheckContext {
  let validation: ReturnType<typeof validateInOrder> | undefined;
  try {
    validation = validateInOrder(JSON.parse(readFileSync(input.contractPath, "utf8")), {
      root: input.root,
      stageKinds: new StageKindRegistry(DEFAULT_STAGE_KINDS, "launch"),
      checks: new PreconditionCheckRegistry(DEFAULT_CHECKS),
      allowDraft: false,
      noSourceCheck: false,
    });
  } catch {
    validation = undefined;
  }
  const status =
    validation === undefined ? "unreadable" : validation.exit === 0 ? "validated" : "not-validated";
  const errorText =
    validation === undefined
      ? `the launch contract cannot be read: ${input.contractPath}`
      : validation.exit === 0
        ? ""
        : [
            ...validation.composedErrors.map((error) => `${error.path || "/"}: ${error.message}`),
            ...validation.problems.map((problem) => `${problem.path}: ${problem.message}`),
          ].join("\n");
  return {
    launcherPath: input.launcherPath,
    contractValidation: {
      status,
      errorText,
      ...(validation?.exit === 23 ? { staleSources: true } : {}),
    },
    repoRoot: input.root,
    authorizedRoots: [input.root],
    // The launcher runs the module this build names: the dry run of §R.5
    // check 5 must see the same environment the detached root will see.
    dryRun: (path, flags) => {
      const bundle = bundlePathOfTheLauncher(path, input.root, pipelineIdOf(input.contractPath));
      const run = spawnSync(process.execPath, [path, "--dry-run", "--no-color", ...flags], {
        cwd: input.root,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300_000,
        env: {
          ...process.env,
          NO_COLOR: "1",
          SPECSTRIDE_ENGINE: engineExecutablePath(),
          SPECSTRIDE_PIPELINE_ENTRY: pipelineEntryPath(),
          SPECSTRIDE_LAUNCH_INTEGRITY_MODULE: integrityModulePath(),
          SPECSTRIDE_LAUNCHER_FILE: path,
          ...(bundle === null ? {} : { SPECSTRIDE_BUNDLE_PATH: bundle }),
        },
      });
      return {
        exitCode: run.status ?? 1,
        output: `${run.stdout.toString()}${run.stderr.toString()}`,
      };
    },
    flags: {},
    lockHeld: input.lockHeld,
  };
}

/** The dependencies of the verb; every one is injected, so a test runs it on a stub. */
export type LaunchCommandDeps = {
  print?(line: string): void;
  /** The handshake of feature 122; the real one by default. */
  handshake?(input: Parameters<typeof runLaunchHandshake>[0]): Promise<LaunchHandshakeOutcome>;
  /** Where the control plane of the workspace is. */
  controlRoot?: string;
  /** The real path of the workspace (the handshake's `place`). */
  workspaceRealPath?: string;
  /**
   * The dry run itself (T052); the real one by default. The inputs the run
   * needs are injected separately, so a test points the wiring at its own
   * fixture without touching the environment.
   */
  dryRun?(input: DryRunInput): Promise<DryRunOutcome> | DryRunOutcome;
  /** The inputs of the dry run: the contract file and the repository root. */
  dryRunInput?: Partial<DryRunInput>;
  /**
   * The launch-check context of §R.5 (F123-FR-021); the real one by default,
   * over the contract of the pipeline. A test hands in its own so the checks
   * pass or fail without a repository on disk.
   */
  launchCheckContext?: LaunchCheckContext;
};

/** The result of one invocation of the verb: the printed lines and the exit. */
export type LaunchCommandResult = {
  readonly lines: readonly string[];
  readonly exit: number;
  /** The mode the call resolved to, when the arguments resolved. */
  readonly mode?: LaunchArgs["mode"];
  /** True when the handshake of feature 122 was called (the mode `run`). */
  readonly handshakeCalled: boolean;
  /** True when a launch record was written (only the mode `run` can). */
  readonly launchRecordWritten: boolean;
};

/** The refusal line of annex G §G.3: `[SPECSTRIDE-REFUSE] action=launch ...`. */
function refuseLine(reason: string, next: string): string {
  return `[SPECSTRIDE-REFUSE] action=launch reason=${reason} next=${JSON.stringify(next)}`;
}

/**
 * Run the command `launch` on the arguments that follow its word; the exit
 * code is the result.
 */
export async function launchCommand(
  argv: readonly string[],
  deps: LaunchCommandDeps = {},
): Promise<LaunchCommandResult> {
  const print = deps.print ?? ((line: string): void => void process.stdout.write(line + "\n"));
  const parsed = parseLaunchArgs(argv);

  if (parsed.refusal !== undefined) {
    // F107-FR-032 — a refused call writes no launch record and never calls
    // the handshake of feature 122.
    const { refusal } = parsed;
    print(refuseLine(refusal.reason, refusal.next ?? "pass --mode run or --mode dry-run"));
    return { lines: [], exit: refusal.exit, handshakeCalled: false, launchRecordWritten: false };
  }

  const mode = parsed.mode as "run" | "dry-run";

  if (mode === "dry-run") {
    // F107-FR-033 — the dry run of T052: it validates the promoted launch
    // contract again, evaluates the launch checks without launching, reports
    // and stops. It derives nothing (an absent contract is exit 20 with the
    // `next:` line that names `contract derive`), launches nothing and writes
    // nothing: no handshake call, no launch record, no comment record.
    const run = deps.dryRun ?? dryRun;
    const outcome = await run({
      contractFile: deps.dryRunInput?.contractFile ?? "",
      root: deps.dryRunInput?.root ?? deps.workspaceRealPath ?? process.cwd(),
      ...(deps.dryRunInput?.parallelUnits !== undefined
        ? { parallelUnits: deps.dryRunInput.parallelUnits }
        : {}),
      ...(parsed.commentShown !== undefined ? { commentShown: parsed.commentShown } : {}),
      ...(deps.dryRunInput?.workersMax !== undefined
        ? { workersMax: deps.dryRunInput.workersMax }
        : {}),
      ...(deps.dryRunInput?.ceilings !== undefined ? { ceilings: deps.dryRunInput.ceilings } : {}),
      ...(deps.dryRunInput?.launchChecks !== undefined
        ? { launchChecks: deps.dryRunInput.launchChecks }
        : {}),
    });
    for (const line of outcome.lines) print(line);
    return {
      lines: outcome.lines,
      exit: outcome.exit,
      mode,
      handshakeCalled: false,
      launchRecordWritten: false,
    };
  }

  // The mode `run`: the launch checks of §R.5 first (F123-FR-021), then the
  // handshake of feature 122 — the record, the real detach strategy, the
  // bounded wait. The record, the strategy and the outcome are the
  // handshake owner's; this wiring resolves the launcher, runs the checks
  // and hands the inputs over.
  const root = deps.workspaceRealPath ?? process.cwd();
  const controlRoot = deps.controlRoot ?? controlPlaneOf(root).stateDir;
  const pipelineId = newestPipelineId(controlRoot);
  if (pipelineId === null) {
    print(refuseLine("no-contract", "run contract derive first"));
    return { lines: [], exit: 20, mode, handshakeCalled: false, launchRecordWritten: false };
  }
  // The launcher of this launch: the requested path wins, else the launcher
  // the render wrote under the state of the pipeline (F123-FR-026).
  const resolved = resolveLauncher({
    repoDir: root,
    requested: parsed.launcher ?? launcherPathUnderState(root, pipelineId),
  });
  if (!resolved.ok) {
    print(refuseLine(resolved.refusal, "run contract render first"));
    return { lines: [], exit: 20, mode, handshakeCalled: false, launchRecordWritten: false };
  }
  const launcherPath = resolved.launcher;

  const checkContext =
    deps.launchCheckContext ??
    launchCheckContextOf({
      root,
      launcherPath,
      contractPath: join(controlRoot, "state", "pipeline", pipelineId, "contract"),
      lockHeld: existsSync(join(controlRoot, "lock")),
    });
  const checks = runLaunchChecks(checkContext);
  if (checks.decision !== "launch") {
    const reason = checks.reason ?? "refused";
    print(
      refuseLine(
        reason,
        reason === "already-running"
          ? "another launch owns this run; `specstride wait` watches it"
          : "run contract render and try again",
      ),
    );
    return {
      lines: [],
      exit: PIPELINE_REFUSAL_EXITS[reason] ?? 20,
      mode,
      handshakeCalled: false,
      launchRecordWritten: false,
    };
  }

  const launchId = `launch-${Date.now().toString(36)}`;
  const runId = `run-${launchId}`;
  const place = { controlRoot, workspaceRealPath: root };
  const engine = engineExecutablePath();
  const pipelineEntry = pipelineEntryPath();
  // The bundle the launcher's integrity check hashes at every start
  // (F107-FR-031): its address is the first 20 hex of the contract hash the
  // launcher's own marker names, and the launcher reads the path from the
  // environment — the launch is the one that knows both.
  const bundlePath = bundlePathOfTheLauncher(launcherPath, root, pipelineId);
  const run = deps.handshake ?? runLaunchHandshake;
  const outcome = await run({
    place,
    slug: pipelineId,
    launchId,
    runId,
    workspaceId: pipelineId,
    requestKind: "pipeline",
    request: { pipeline: pipelineId, launcher: launcherPath },
    // The durable record of what a contract stage runs and what the launcher
    // becomes: the node binary, the CLI of this build, the runtime root.
    engineExecutable: {
      node: process.execPath,
      cli: engine,
      pipelineEntry,
    },
    strategy: createSpawnDetachedStrategy({
      place,
      launchId,
      runToken: mintLeaseToken(),
      cwd: root,
      environment: {
        ...process.env,
        SPECSTRIDE_ENGINE: engine,
        SPECSTRIDE_PIPELINE_ENTRY: pipelineEntry,
        SPECSTRIDE_LAUNCH_INTEGRITY_MODULE: integrityModulePath(),
        SPECSTRIDE_LAUNCHER_FILE: launcherPath,
        ...(bundlePath === null ? {} : { SPECSTRIDE_BUNDLE_PATH: bundlePath }),
      },
    }),
    // §F.6 — the root runs `[node, <launcher>, --no-color]`.
    runtimeEntry: [process.execPath, launcherPath, "--no-color"],
    environmentAllowList: ENVIRONMENT_ALLOW_LIST,
    // The logical name of the runtime log is the TEMPLATE of annex B §B.5 —
    // the strategy resolves `<launchId>` from its own context.
    runtimeLogLogicalName: RUNTIME_LOG_LOGICAL_NAME,
  });
  return {
    lines: outcome.line === "" ? [] : [outcome.line],
    exit: outcome.exit,
    mode,
    handshakeCalled: true,
    launchRecordWritten: outcome.record !== null,
  };
}

/**
 * The synchronous entry of the command: it starts the verb, prints the lines
 * as they come and leaves the exit code of the outcome in `process.exitCode`.
 * The characterization tests and the callers that need the outcome call
 * `launchCommand` and await it.
 */
export function launchEntry(argv: readonly string[], deps: LaunchCommandDeps = {}): void {
  void launchCommand(argv, deps).then((result) => {
    process.exitCode = result.exit;
  });
}
