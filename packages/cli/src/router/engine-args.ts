/**
 * T020 — the engine call's argument handling and its workdir errors
 * (F119-FR-005, F119-FR-006).
 *
 * The engine call is what `run`, `start` and any leading flag other than
 * `-h`, `--help`, `--reverse` and `--protocol` become (F119-FR-002). Its
 * argument handling is STRICT (CT-119-5): `-h`/`--help` print the engine
 * usage and exit 0 before any state is touched; an unknown argument, a stray
 * positional included, prints `engine: unknown arg: <arg>` and the usage on
 * standard error and exits 3; a value-taking flag without a value ends the
 * call before any state is touched with the status the baseline's shell
 * gives — 127, not the documented 3 (register row B-0235; CQ-098; research
 * decision 8).
 *
 * The usage says what F119-FR-005 asks it to say: that each agent invocation
 * records a capability mode (structured, raw-text or degraded) and that
 * setting `SPECSTRIDE_AGENT_STREAM` to `false` forces the raw-text fallback.
 *
 * The launch itself goes through the `EngineLauncher` port: the front door
 * runs the engine in the foreground in the start mode `standalone` and ends
 * with the engine's exit code (F119-FR-002). The engine executable is the
 * engine feature's deliverable; where this build mounts no launcher, the
 * call ends on the uncaught path of `exit.ts` (70), never with a faked code.
 */
import { realpathSync, statSync } from "node:fs";
import { join } from "node:path";

/** The exit of a value-taking flag given without a value (F119-FR-005). */
export const VALUELESS_FLAG_EXIT = 127 as const;

/** The exit of an unknown engine argument (F119-FR-005). */
export const UNKNOWN_ARG_EXIT = 3 as const;

/** The exit of a working directory that does not exist (F119-FR-006). */
export const WORKDIR_NOT_FOUND_EXIT = 3 as const;

/** The exit of a working directory that exists and cannot be entered (F119-FR-006). */
export const WORKDIR_UNENTERABLE_EXIT = 1 as const;

/** The exit of the engine usage (F119-FR-005). */
export const ENGINE_HELP_EXIT = 0 as const;

/**
 * The flags the engine call knows. The value-less flags are the run flags the
 * verb table documents (F119-FR-001, the `run` row: `--detach`, `--new-run`,
 * `--reset-counts`); `-w`/`--workdir` is the front door's own flag
 * (F119-FR-006). Everything else is an unknown argument.
 */
export const ENGINE_FLAGS_WITHOUT_VALUE: readonly string[] = Object.freeze([
  "--detach",
  "--new-run",
  "--reset-counts",
]);

/** The engine flags that take a value. */
export const ENGINE_FLAGS_WITH_VALUE: readonly string[] = Object.freeze(["-w", "--workdir"]);

/** The sentence about the capability modes the usage MUST carry (F119-FR-005). */
export const CAPABILITY_MODE_SENTENCE =
  "Each agent invocation records a capability mode (structured, raw-text or degraded); " +
  "setting SPECSTRIDE_AGENT_STREAM to false forces the raw-text fallback.";

/** The engine usage (F119-FR-005). */
export function engineUsageText(): string {
  return [
    "usage: specstride run [-w DIR] [--detach] [--new-run] [--reset-counts]",
    "",
    "Runs the engine in the foreground in the start mode standalone.",
    CAPABILITY_MODE_SENTENCE,
  ].join("\n");
}

/** The message of an unknown engine argument (F119-FR-005). */
export function unknownArgMessage(arg: string): string {
  return `engine: unknown arg: ${arg}`;
}

/** The message of a working directory that does not exist (F119-FR-006). */
export function workdirNotFoundMessage(dir: string): string {
  return `workdir not found: ${dir}`;
}

/** What the parser read out of one engine call. */
export type EngineCallPlan =
  | { readonly kind: "help" }
  | { readonly kind: "unknown"; readonly arg: string }
  | { readonly kind: "valueless"; readonly flag: string }
  | { readonly kind: "launch"; readonly workdir: string | undefined };

/** F119-FR-005 — read the arguments of the engine call. */
export function parseEngineArgs(argv: readonly string[]): EngineCallPlan {
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] as string;
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    const inline = arg.startsWith("--") && arg.includes("=") ? arg : undefined;
    const name = inline === undefined ? arg : inline.slice(0, inline.indexOf("="));
    if (ENGINE_FLAGS_WITH_VALUE.includes(name)) {
      if (inline !== undefined) continue;
      const value = argv[at + 1];
      if (value === undefined) return { kind: "valueless", flag: name };
      at += 1;
      continue;
    }
    if (ENGINE_FLAGS_WITHOUT_VALUE.includes(name)) continue;
    return { kind: "unknown", arg };
  }
  const workdir = workdirOf(argv);
  return { kind: "launch", workdir };
}

function workdirOf(argv: readonly string[]): string | undefined {
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] as string;
    if (arg === "-w" || arg === "--workdir") return argv[at + 1];
    if (arg.startsWith("--workdir=")) return arg.slice("--workdir=".length);
  }
  return undefined;
}

/** One launch of the engine: the arguments, unchanged, and the workdir. */
export type EngineLaunch = {
  /** The arguments of the call, in the order they were given (F119-FR-002). */
  readonly argv: readonly string[];
  /** The physical path of the working directory (F119-FR-006). */
  readonly workdir: string;
};

/** The port the engine itself is reached through (F119-FR-002). */
export type EngineLauncher = (launch: EngineLaunch) => number | Promise<number>;

/** Raised where this build mounts no engine launcher. */
export class EngineNotMountedError extends Error {
  constructor() {
    super(
      "no engine launcher is mounted in this build; the engine call cannot start (the engine is the deliverable of its owning feature)",
    );
    this.name = "EngineNotMountedError";
  }
}

/** The streams and the environment the call runs against; injectable. */
export type EngineCallIo = {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly cwd: string;
};

/**
 * F119-FR-005 and F119-FR-006 — run the engine call: the argument handling
 * first (help, unknown argument, valueless flag), then the workdir check
 * (not found: 3 with `workdir not found: <dir>`; exists and cannot be
 * entered: 1), then the launch through the port, unchanged, and the engine's
 * exit code.
 */
export async function runEngineCall(
  argv: readonly string[],
  ports: {
    readonly io: EngineCallIo;
    readonly launch?: EngineLauncher | undefined;
  },
): Promise<number> {
  const plan = parseEngineArgs(argv);
  if (plan.kind === "help") {
    ports.io.out(`${engineUsageText()}\n`);
    return ENGINE_HELP_EXIT;
  }
  if (plan.kind === "unknown") {
    ports.io.err(`${unknownArgMessage(plan.arg)}\n${engineUsageText()}\n`);
    return UNKNOWN_ARG_EXIT;
  }
  if (plan.kind === "valueless") {
    // Before any state is touched, with the baseline's status, not the
    // documented 3 (F119-FR-005, B-0235).
    return VALUELESS_FLAG_EXIT;
  }
  const raw = plan.workdir ?? ports.io.cwd;
  let physical: string;
  try {
    const stats = statSync(raw);
    if (!stats.isDirectory()) {
      // Exists, but cannot be entered as a working directory (F119-FR-006).
      return WORKDIR_UNENTERABLE_EXIT;
    }
    physical = realpathSync(raw);
  } catch {
    ports.io.err(`${workdirNotFoundMessage(raw)}\n`);
    return WORKDIR_NOT_FOUND_EXIT;
  }
  if (ports.launch === undefined) throw new EngineNotMountedError();
  return ports.launch({ argv: [...argv], workdir: physical });
}

/** The default working directory of a call: the current one (F119-FR-006). */
export function defaultWorkdir(cwd: string): string {
  return join(cwd);
}
