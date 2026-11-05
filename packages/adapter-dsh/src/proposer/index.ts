/**
 * T025 — the argument table and the invocation of a proposer pass
 * (F130-FR-007, F130-FR-009).
 *
 * The invocation is `<executable> --profile <profile> <prompt>`: the whole
 * prompt as ONE positional argument (or the space-split chunks of
 * F130-FR-011 over the limit), NO flag that allows all tools, in the working
 * directory of the pass, with standard input CLOSED; the reply is read as
 * text. The environment of the process carries the names the argument table
 * states (`DSH_HOME`, `DSH_PERMISSION_MODE`, `DSH_TELEMETRY_MODE`, and
 * `TRACEPARENT` when traces are on). The executable is resolved through the
 * seam (`resolveExecutable`) BEFORE any overlay variable is applied; when it
 * is not found the pass returns the status 127 with a message that names the
 * setting to change, and NO overlay is built or left behind. The permission
 * mode is always stated in the record of the call (F130-FR-010).
 */
import { spawnSync, spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync, statSync } from "node:fs";
import {
  resolveExecutable,
  searchDirsFromPath,
  EXECUTABLE_NOT_FOUND_CODE,
} from "@specstride/harness";
import { resolveDshModel, type ModelReference } from "../model/index.ts";
import { resolvePermissionMode, type ConfigOrigin } from "./permission.ts";
import { promptArguments, PROMPT_LIMIT_BYTES } from "./chunks.ts";
import { resolveDshSettings, type ConfigSource } from "./settings.ts";
import { buildOverlay, OverlayBuildError, type DshOverlay } from "../overlay/index.ts";

/** The as-is not-found message of the arm (the descriptor's `notFound`). */
export const DSH_NOT_FOUND_PREFIX = "DeepSeek Harness not found" as const;

/** Flags that allow all tools; the invocation NEVER carries one (F130-FR-007). */
export const ALLOW_ALL_FLAGS: readonly string[] = Object.freeze([
  "--dangerously-skip-permissions",
  "--danger-full-access",
  "--yolo",
  "--allow-all-tools",
]);

/** The environment variable names the invocation exports (the argument table). */
export const PROPOSER_ENV_NAMES: readonly string[] = Object.freeze([
  "DSH_HOME",
  "DSH_PERMISSION_MODE",
  "DSH_TELEMETRY_MODE",
]);

/** The environment variable name exported only when traces are on. */
export const TRACEPARENT_ENV_NAME = "TRACEPARENT" as const;

/** The telemetry off variable: the name is stated, the off value waits for capture 5. */
export const DSH_TELEMETRY_VARIABLE = "DSH_TELEMETRY_MODE" as const;

/** The argv template of the proposer role, as the argument table states it. */
export const PROPOSER_ARGV_TEMPLATE: readonly string[] = Object.freeze([
  "{bin}",
  "--profile",
  "{profile}",
  "{prompt}",
]);

/** The argument list of one pass: the prompt as ONE positional argument. */
export function proposerArgv(input: {
  readonly bin: string;
  readonly profile: string;
  readonly prompt: string;
}): string[] {
  return [input.bin, "--profile", input.profile, input.prompt];
}

/** The outcome of a proposer pass, with the permission mode STATED. */
export type ProposerRun =
  | {
      readonly ok: true;
      readonly status: number;
      readonly stdout: string;
      readonly stderr: string;
      readonly argv: string[];
      readonly cwd: string;
      readonly permissionMode: string;
      readonly overlay: string | null;
      readonly overlayLogicalName: "overlay:dsh:tree" | null;
    }
  | { readonly ok: false; readonly code: 127; readonly message: string }
  | { readonly ok: false; readonly result: 1; readonly message: string };

/** The input of one proposer pass. */
export type ProposerPassInput = {
  /** The prompt of the pass; bounded and split by F130-FR-011. */
  readonly prompt: string;
  /** The working directory of the pass. */
  readonly cwd: string;
  /** A model override: the flag, the setting and the qualifier, in that role. */
  readonly model?: {
    readonly flag?: string | null;
    readonly qualifier?: string | null;
  };
  /** Rows of `harnesses.dsh.modelProviders` (user configuration or a fixture). */
  readonly modelProviders?: readonly {
    readonly pattern: string;
    readonly provider: string;
    readonly model?: string | null;
  }[];
  /** Where the stub lives: the real search path, before any overlay variable. */
  readonly path?: string;
  /** The workspace root handed to the seam resolver. */
  readonly workspaceRoot?: string | null;
  /** The environment of the consumer (as-is aliases are read from it). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Overrides for tests: the configuration source of the settings. */
  readonly config?: ConfigSource;
  /** The permission mode the consumer configured, with its origin. */
  readonly configuredMode?: { readonly mode: string; readonly origin: ConfigOrigin };
  /** The containment opt-in, with its origin (user configuration only). */
  readonly containmentLevel?: { readonly level: string; readonly origin: ConfigOrigin };
  /** The `--version` probe of the seam (a test overrides it). */
  readonly probeVersion?: (path: string) => string | null;
  /** The `--version` script step of the stub, as a test plays it. */
  readonly script?: string;
  /** The watchdog of the pass, in milliseconds (the stub is killed past it). */
  readonly timeoutMs?: number;
  /** The trace parent, exported as TRACEPARENT only when traces are on. */
  readonly traceparent?: string;
};

/**
 * Everything the two runners of a pass share: settings, mode, model,
 * detection, argv, overlay and the overlaid environment (F130-FR-007,
 * F130-FR-009, F130-FR-010, F130-FR-011, F130-FR-014). Detection comes
 * FIRST: an executable that is not found is the status 127 and no overlay is
 * ever built. The caller removes the overlay when the process has ended, on
 * every arm, a kill included (F130-FR-014).
 */
export type PreparedProposerPass =
  | {
      readonly ok: true;
      readonly argv: string[];
      readonly env: Record<string, string>;
      readonly mode: string;
      readonly overlay: DshOverlay | null;
    }
  | { readonly ok: false; readonly code: 127; readonly message: string }
  | { readonly ok: false; readonly result: 1; readonly message: string };

/**
 * Prepares one proposer-class pass (settings, mode, model, detection, argv,
 * overlay, overlaid environment). Exported for `start-pass/`, which starts a
 * WORKER pass through the very same preparation the pass loop runs: one
 * preparation, no drift between the two callers.
 */
export function prepareDshProposerPass(input: ProposerPassInput): PreparedProposerPass {
  const settings = resolveDshSettings(input.config ?? { env: input.env ?? {} });
  const mode = resolvePermissionMode({
    role: "proposer",
    profile: settings.profile,
    configured: input.configuredMode,
    containmentLevel: input.containmentLevel,
  });
  if (!mode.ok) return { ok: false, result: 1, message: mode.error };

  const model = resolveDshModel({
    flag: input.model?.flag ?? null,
    setting: settings.model,
    qualifier: input.model?.qualifier ?? null,
    providerSetting: settings.provider,
    modelProviders: input.modelProviders,
  });
  if (!model.ok) return { ok: false, result: model.result, message: model.message };

  // Detection before anything is built (F130-FR-009): the real search path,
  // no overlay variable applied.
  const dirs = searchDirsFromPath(input.path ?? input.env?.PATH ?? process.env.PATH ?? "");
  const resolved = resolveExecutable(settings.bin, {
    dirs,
    exists: (dir: string, name: string) => {
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    },
    workspaceRoot: input.workspaceRoot ?? null,
    previousPath: null,
    probeVersion: input.probeVersion,
    component: "dsh",
  });
  if (!resolved.ok) {
    if ("resultCode" in resolved) {
      return {
        ok: false,
        code: EXECUTABLE_NOT_FOUND_CODE as 127,
        message:
          `${DSH_NOT_FOUND_PREFIX}: ${settings.bin} ` +
          `(change ${"harnesses.dsh.bin"} or put the executable on the search path)`,
      };
    }
    return { ok: false, result: 1, message: resolved.message };
  }

  // Under `parity` the prompt is ONE argument whatever its size, as at the
  // baseline; outside it the bound and the split of F130-FR-011 apply.
  const chunks = settings.profile === "parity" ? [input.prompt] : promptArguments(input.prompt);
  const argv = [resolved.path, "--profile", settings.profile, ...chunks];
  for (const flag of ALLOW_ALL_FLAGS) {
    if (argv.includes(flag)) {
      return { ok: false, result: 1, message: `dsh: the allow-all flag ${flag} is never passed` };
    }
  }

  try {
    const overlay =
      model.reference !== null
        ? buildOverlay({
            realHome: settings.home,
            reference: model.reference as ModelReference,
            effort: settings.effort,
          })
        : null;
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.env ?? {})) {
      if (value !== undefined) env[name] = value;
    }
    env["DSH_HOME"] = overlay !== null ? overlay.home : settings.home;
    env["DSH_PERMISSION_MODE"] = mode.mode;
    if (env[DSH_TELEMETRY_VARIABLE] === undefined) env[DSH_TELEMETRY_VARIABLE] = "";
    if (input.traceparent !== undefined) env[TRACEPARENT_ENV_NAME] = input.traceparent;
    if (input.script !== undefined) env["FAKE_DSH_SCRIPT"] = input.script;
    return { ok: true, argv, env, mode: mode.mode, overlay };
  } catch (error) {
    if (error instanceof OverlayBuildError) {
      return { ok: false, result: error.result, message: error.message };
    }
    throw error;
  }
}

/**
 * Runs one proposer pass (F130-FR-007, F130-FR-009, F130-FR-010, F130-FR-012,
 * F130-FR-014). The synchronous twin: the caller waits for the pass to end.
 * The overlay exists only while the pass runs and is removed on every arm, a
 * kill included.
 */
export function runDshProposer(input: ProposerPassInput): ProposerRun {
  const prepared = prepareDshProposerPass(input);
  if (!prepared.ok) return prepared;
  try {
    const run = spawnSync(prepared.argv[0]!, prepared.argv.slice(1), {
      cwd: input.cwd,
      env: prepared.env,
      // Standard input CLOSED (F130-FR-007, F130-FR-017): never a wait on a
      // human; the reply and the diagnostics come back as text.
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: input.timeoutMs,
      shell: false,
    });
    return {
      ok: true,
      status: run.status ?? 1,
      stdout: typeof run.stdout === "string" ? run.stdout : "",
      stderr: typeof run.stderr === "string" ? run.stderr : "",
      argv: prepared.argv,
      cwd: input.cwd,
      permissionMode: prepared.mode,
      overlay: prepared.overlay !== null ? prepared.overlay.home : null,
      overlayLogicalName: prepared.overlay !== null ? "overlay:dsh:tree" : null,
    };
  } finally {
    // Removal on every arm, a watchdog kill included (F130-FR-014).
    prepared.overlay?.remove();
  }
}

/** The outcome of one ASYNC proposer pass: the synchronous facts, plus the supervision facts. */
export type ProposerAsyncRun =
  | (Extract<ProposerRun, { readonly ok: true }> & RunSupervisionFacts & { readonly ok: true })
  | Extract<ProposerRun, { readonly ok: false }>;

/** The input of one ASYNC proposer pass. */
export type ProposerAsyncInput = ProposerPassInput & AsyncRunInput;

/**
 * Runs one proposer pass ASYNCHRONOUSLY (F130-FR-007, F130-FR-009,
 * F130-FR-010, F130-FR-014). The argv, the environment and the overlay are
 * the ones the synchronous twin builds; the process runs without blocking the
 * caller, hands its PID over through `onStart` as soon as it exists, is
 * SIGTERMed at the time limit and SIGKILLed after the grace period, and the
 * cost is read from a `total_cost_usd` figure of the JSON stream when `dsh`
 * emits one.
 */
export function runDshProposerAsync(input: ProposerAsyncInput): Promise<ProposerAsyncRun> {
  const prepared = prepareDshProposerPass(input);
  if (!prepared.ok) return Promise.resolve(prepared);
  const child = spawn(prepared.argv[0]!, prepared.argv.slice(1), {
    cwd: input.cwd,
    env: prepared.env,
    // Standard input CLOSED (F130-FR-007, F130-FR-017): never a wait on a
    // human; the reply and the diagnostics come back as text.
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (child.pid !== undefined) input.onStart?.(child.pid, (signal) => child.kill(signal));
  return runChildUnderTimeLimit(child, input.timeoutMs, input.killGraceMs).then((outcome) => {
    try {
      if (!outcome.ok) {
        return { ok: false as const, result: 1 as const, message: outcome.message };
      }
      return {
        ok: true as const,
        status: outcome.status,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        argv: prepared.argv,
        cwd: input.cwd,
        permissionMode: prepared.mode,
        overlay: prepared.overlay !== null ? prepared.overlay.home : null,
        overlayLogicalName: prepared.overlay !== null ? "overlay:dsh:tree" : null,
        pid: outcome.pid,
        timedOut: outcome.timedOut,
        killedWith: outcome.killedWith,
        costUsd: outcome.costUsd,
      };
    } finally {
      // Removal on every arm, a watchdog kill included (F130-FR-014).
      prepared.overlay?.remove();
    }
  });
}

/** Whether PATH names an existing entry (a test's convenience). */
export function homeExists(home: string): boolean {
  return existsSync(home);
}

export { PROMPT_LIMIT_BYTES };

/** The extra input of every async twin: supervision knobs of the seam. */
export type AsyncRunInput = {
  /** Handed the PID of the child as soon as it exists, with the way to end it: the caller is the supervisor of a pass it did not spawn itself. */
  readonly onStart?: (pid: number, kill: (signal: NodeJS.Signals) => void) => void;
  /** Milliseconds between the SIGTERM of the limit and the SIGKILL (default 5 000). */
  readonly killGraceMs?: number;
};

/** The supervision facts of an async run, reported on every ok arm. */
export type RunSupervisionFacts = {
  /** The PID of the child, as handed to `onStart`. */
  readonly pid: number;
  /** Whether the time limit ended the child. */
  readonly timedOut: boolean;
  /** The signal that ended a child past its limit; null when it ended by itself. */
  readonly killedWith: "SIGTERM" | "SIGKILL" | null;
  /** The `total_cost_usd` of the JSON stream, when `dsh` emitted one. */
  readonly costUsd: number;
};

/** What running one child under its time limit produced. */
type LimitedRunOutcome =
  | ({
      readonly ok: true;
      readonly status: number;
      readonly stdout: string;
      readonly stderr: string;
    } & RunSupervisionFacts)
  | { readonly ok: false; readonly message: string };

/** One `total_cost_usd` figure of a JSON-stream line, where the line carries one. */
function costOfLine(line: string): number | null {
  if (!line.trimStart().startsWith("{")) return null;
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    return typeof record.total_cost_usd === "number" ? record.total_cost_usd : null;
  } catch {
    return null;
  }
}

/**
 * Runs one already-spawned child under its time limit and resolves with its
 * facts: SIGTERM at the limit, SIGKILL after the grace period, and the cost
 * read from the JSON stream when a line of it carries `total_cost_usd`.
 */
export function runChildUnderTimeLimit(
  child: import("node:child_process").ChildProcess,
  timeoutMs: number | undefined,
  killGraceMs: number | undefined,
  groupKill = false,
): Promise<LimitedRunOutcome> {
  return new Promise((done) => {
    const pid = child.pid ?? -1;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let held = "";
    let costUsd = 0;
    let timedOut = false;
    let killedWith: "SIGTERM" | "SIGKILL" | null = null;
    let settled = false;
    let grace: NodeJS.Timeout | undefined;
    // A detached child leads its own process group: the signal goes to the
    // GROUP, so no grandchild of the call survives the limit.
    const sendSignal = (signal: NodeJS.Signals): void => {
      if (groupKill && pid > 0) {
        try {
          process.kill(-pid, signal);
        } catch {
          child.kill(signal);
        }
        return;
      }
      child.kill(signal);
    };
    const limit =
      timeoutMs !== undefined && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killedWith = "SIGTERM";
            sendSignal("SIGTERM");
            grace = setTimeout(() => {
              killedWith = "SIGKILL";
              sendSignal("SIGKILL");
            }, killGraceMs ?? 5_000);
          }, timeoutMs)
        : undefined;
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      held += chunk.toString();
      const lines = held.split("\n");
      held = lines.pop() ?? "";
      for (const line of lines) {
        const cost = costOfLine(line);
        if (cost !== null) costUsd = cost;
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      if (limit !== undefined) clearTimeout(limit);
      if (grace !== undefined) clearTimeout(grace);
      done({ ok: false, message: String(error.message ?? error) });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (limit !== undefined) clearTimeout(limit);
      if (grace !== undefined) clearTimeout(grace);
      for (const cost of [costOfLine(held)]) {
        if (cost !== null) costUsd = cost;
      }
      done({
        ok: true,
        status: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
        pid,
        timedOut,
        killedWith,
        costUsd,
      });
    });
  });
}
