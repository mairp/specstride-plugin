/**
 * T018 — the router of the front door (F119-FR-001, F119-FR-002).
 *
 * The one `specstride` command reads its first argument here and ends with
 * the code of the command it ran (F119-FR-011, `exit.ts`):
 *
 * - no argument, `-h`, `--help` or `help`: the usage on standard output, 0
 *   (F119-FR-004, `usage.ts`);
 * - `--protocol`: the handler of feature 100, MOUNTED
 *   (`protocolHandler` of `@specstride/contracts/grammar/protocol`,
 *   F100-FR-170), prints the protocol integer and ends 0;
 * - `--reverse`: routes as the verb `reverse`;
 * - any other first argument that begins with `-`, and `run` and `start`:
 *   the engine call (`engine-args.ts`) — every remaining argument passed on
 *   unchanged, the engine in the foreground in the start mode `standalone`,
 *   the engine's exit code (F119-FR-002);
 * - a first argument that is not a verb and not a help token: the
 *   unknown-verb exit 1 with `specstride: unknown subcommand '<SUB>'` and the
 *   usage on standard error (F119-FR-003);
 * - `reverse` refuses a `--mode` other than `source-aware` with the message
 *   of F119-FR-001 and exit 3;
 * - the inspection verbs and `status`, `stop`, `resume`, `learn`: the state
 *   guard and the missing-input checks of `guards.ts` (F119-FR-009,
 *   F119-FR-010) run FIRST, then the call goes to the handler the owner
 *   feature mounted;
 * - `spec` and `verify` are public verbs of their owners (F119-FR-013): the
 *   router hands them their row's codes through (`exit.ts`), never their
 *   behaviour.
 *
 * Nothing here enumerates harnesses (F119-FR-014): the routing data is the
 * verb table of `verbs.ts` alone.
 */
// F119-FR-015 — the cold-start budget of a read command (150 ms p90) holds
// for EVERY routed verb, so the module graph of a call is only what the call
// needs: `verbs.ts` (the routing data) and `usage.ts` (the usage) load
// eagerly; `guards.ts`, `inspect-args.ts` and `engine-args.ts` load lazily,
// in the branches that need them (the plan's lazy-imports mandate). Types
// ride along at no cost.
import type { ControlPlane, GuardRefusal } from "./guards.ts";
import type { EngineLauncher } from "./engine-args.ts";
import { printUsage, unknownVerbExit, type UsageIo, type UsageMode } from "./usage.ts";
import { runCommand } from "./exit.ts";
import { isKnownVerb } from "./verbs.ts";

/**
 * F119-FR-002 — the leading flags that do NOT start a run. Every other first
 * argument that begins with `-` is the engine call, flag included.
 */
export const LEADING_RUN_EXEMPT_FLAGS: readonly string[] = Object.freeze([
  "-h",
  "--help",
  "--reverse",
  "--protocol",
]);

/** F119-FR-001 — the only mode the routing of `reverse` accepts. */
export const REVERSE_ACCEPTED_MODE = "source-aware" as const;

/** The exit of the `reverse --mode` refusal (F119-FR-001). */
export const REVERSE_MODE_REFUSAL_EXIT = 3 as const;

/**
 * F119-FR-001 — the refusal of a `--mode` other than `source-aware`, on
 * standard error, exit 3. `<Label>` is `Black-box` for `black-box` and
 * `Runtime-assisted` otherwise.
 */
export function reverseModeRefusal(mode: string): string {
  const label = mode === "black-box" ? "Black-box" : "Runtime-assisted";
  return (
    `specstride reverse: ${label} reverse engineering requires an explicit permission ` +
    `and side-effect policy. Specstride will not infer those permissions; ` +
    `only --mode ${REVERSE_ACCEPTED_MODE} is supported.`
  );
}

/** The `--mode` value of a `reverse` call, when one is given. */
export function reverseModeOf(rest: readonly string[]): string | undefined {
  for (let at = 0; at < rest.length; at += 1) {
    const arg = rest[at] as string;
    if (arg === "--mode") return rest[at + 1];
    if (arg.startsWith("--mode=")) return arg.slice("--mode=".length);
  }
  return undefined;
}

/** The streams of one routed call. */
export type RouteIo = UsageIo;

/** What a mounted handler of a verb receives. */
export type RoutedCall = {
  /** The verb as the table spells it (`start` never arrives: it is `run`). */
  readonly verb: string;
  /** The arguments after the verb, in order. */
  readonly extras: readonly string[];
  /** The physical working directory of the call. */
  readonly workdir: string;
  /** The control plane of the workspace. */
  readonly controlPlane: ControlPlane;
  /** The streams of the call. */
  readonly io: RouteIo;
  /**
   * The output mode in force (F119-FR-029), as the router selected it;
   * `undefined` reads as `default`.
   */
  readonly mode?: UsageMode | undefined;
};

/** A handler a feature mounts for the verb its row in annex G §G.1 owns. */
export type VerbHandler = (call: RoutedCall) => number | Promise<number>;

/** The handlers mounted in this build, by verb. */
export type RouteHandlers = Readonly<Record<string, VerbHandler>>;

/** Raised where a known verb has no handler mounted in this build. */
export class VerbNotMountedError extends Error {
  /** The verb whose owner has not mounted a handler here. */
  readonly verb: string;
  constructor(verb: string) {
    super(`the verb '${verb}' is routed but its owner has not mounted a handler in this build`);
    this.name = "VerbNotMountedError";
    this.verb = verb;
  }
}

/** Everything the router reads, injectable for the tests. */
export type RouteDeps = {
  readonly io?: RouteIo | undefined;
  /** The working directory the call runs in (default: `process.cwd()`). */
  readonly cwd?: string | undefined;
  /** The directory the command was launched from (F119-FR-008). */
  readonly launchDir?: string | undefined;
  /** `SPECSTRIDE_STATE_DIR`, where the host set it (F119-FR-009, N-02). */
  readonly stateDir?: string | undefined;
  /** The output mode in force (F119-FR-029); the caller selects it. */
  readonly mode?: UsageMode | undefined;
  /** The handlers mounted by the owning features. */
  readonly handlers?: RouteHandlers | undefined;
  /** The engine launcher port (F119-FR-002). */
  readonly engine?: { readonly launch?: EngineLauncher | undefined } | undefined;
};

function defaultIo(): RouteIo {
  return {
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
  };
}

/** The refusal of a guard, printed; the guard always ends with its code. */
async function applyGuard(
  verb: string,
  refusal: GuardRefusal,
  io: RouteIo,
  mode: UsageMode,
  jsonRequested = false,
): Promise<number> {
  // F119-FR-030 — in DEFAULT output the failure is one error line with the
  // closed reason and its fix; the refusal's own message stays on standard
  // error in both modes. In compatibility output the line has no as-is
  // equivalent, so it is not printed (F119-FR-029).
  if (mode === "default" && refusal.reason !== undefined && !jsonRequested) {
    const { errorLine } = await import("../output/lines.ts");
    io.out(`${errorLine(verb, refusal.reason)}\n`);
  }
  if (jsonRequested && refusal.reason !== undefined) {
    // F119-FR-033 — with `--json` the failure is the record: no error line,
    // and no findings text either; the record is the whole stdout.
    const { jsonRecord } = await import("../output/default.ts");
    io.out(`${jsonRecord(verb, {}, { reason: refusal.reason })}\n`);
    return refusal.exit;
  }
  if (refusal.stdout !== undefined) io.out(refusal.stdout);
  // F119-FR-029 — in compatibility output the refusal text is the baseline's:
  // where the guard carries a compat spelling (the absolute paths the FX-28
  // captures pin), that is the text of the stream.
  io.err(
    mode === "compat" && refusal.compatStderr !== undefined ? refusal.compatStderr : refusal.stderr,
  );
  return refusal.exit;
}

/**
 * The front door: argv in, exit code out (F119-FR-011: the code of the
 * command it ran, 70 on an error nothing catches).
 */
export async function route(argv: readonly string[], deps?: RouteDeps): Promise<number> {
  const io = deps?.io ?? defaultIo();
  const cwd = deps?.cwd ?? process.cwd();
  const launchDir = deps?.launchDir ?? cwd;
  const mode: UsageMode = deps?.mode ?? "default";
  const handlers: RouteHandlers = deps?.handlers ?? {};
  const verbose = argv.includes("--verbose");

  return runCommand(
    verbLabelOf(argv),
    () =>
      dispatch(argv, {
        io,
        cwd,
        launchDir,
        stateDir: deps?.stateDir,
        mode,
        handlers,
        engine: deps?.engine,
      }),
    { io, verbose, mode },
  );
}

/** The command the exit path names when nothing catches an error. */
function verbLabelOf(argv: readonly string[]): string {
  const first = argv[0];
  if (first === undefined) return "specstride";
  if (first === "--reverse") return "reverse";
  if (first.startsWith("-")) return "run";
  if (first === "start") return "run";
  return first;
}

type DispatchDeps = {
  readonly io: RouteIo;
  readonly cwd: string;
  readonly launchDir: string;
  readonly stateDir: string | undefined;
  readonly mode: UsageMode;
  readonly handlers: RouteHandlers;
  readonly engine?: { readonly launch?: EngineLauncher | undefined } | undefined;
};

async function dispatch(argv: readonly string[], d: DispatchDeps): Promise<number> {
  const first = argv[0];

  // F119-FR-004 — no argument, or a help token: usage, exit 0.
  if (first === undefined || first === "-h" || first === "--help" || first === "help") {
    return printUsage(d.mode, d.io);
  }

  // F119-FR-002 — `--protocol` routes to the handler of feature 100, mounted.
  if (first === "--protocol") {
    const { protocolHandler } = await import("@specstride/contracts/grammar/protocol");
    const outcome = protocolHandler();
    for (const line of outcome.stdout) d.io.out(`${line}\n`);
    for (const line of outcome.stderr) d.io.err(`${line}\n`);
    return outcome.exitCode;
  }

  // F119-FR-002 — `--reverse` routes as the verb `reverse`.
  if (first === "--reverse") {
    return routeReverse(argv.slice(1), d);
  }

  // F119-FR-002 — any other leading flag starts a run, flag included.
  if (first.startsWith("-")) {
    const { runEngineCall } = await import("./engine-args.ts");
    return runEngineCall(argv, {
      io: engineIo(d),
      launch:
        d.engine?.launch ??
        (async (launch) => (await import("../engine/run-feature.ts")).runFeature(launch)),
    });
  }

  const verb = first;
  const rest = argv.slice(1);

  // The two-word command of CLI protocol 1 this package carries (feature 107).
  if (verb === "contract" && rest[0] === "derive") {
    // F107-FR-002 — `--repo DIR` MUST be given: the command of the protocol
    // refuses a call that names no repository, with the message the draft
    // command of the flag's owner prints (`contract-derive.ts`). The handler
    // the call is handed to below keeps the work-tree default of the mounted
    // seam (`workingRepositoryRoot` of `engine/handlers.ts`): a host that
    // mounts it works on the repository of the call, and its pin stands.
    if (!rest.includes("--repo")) {
      d.io.err("--repo is required\n");
      return 2;
    }
    const { contractDeriveHandler } = await import("../engine/handlers.ts");
    return contractDeriveHandler(rest.slice(1), d.io);
  }

  // The rest of the verb `contract`, and the doctor of this host.
  if (verb === "contract" && d.handlers.contract === undefined) {
    const { contractHandler } = await import("../engine/handlers.ts");
    return contractHandler(rest, d.io);
  }
  if (verb === "doctor" && d.handlers.doctor === undefined) {
    const { doctorHandler } = await import("../engine/handlers.ts");
    return doctorHandler(d.cwd, d.io);
  }

  // F119-FR-003 — a first argument that is not a verb.
  if (!isKnownVerb(verb)) {
    return unknownVerbExit(verb, d.mode, d.io);
  }

  // F119-FR-002 — `run` and `start` are the engine call.
  if (verb === "run" || verb === "start") {
    const { runEngineCall } = await import("./engine-args.ts");
    return runEngineCall(rest, {
      io: engineIo(d),
      launch:
        d.engine?.launch ??
        (async (launch) => (await import("../engine/run-feature.ts")).runFeature(launch)),
    });
  }

  // F119-FR-001 — the `reverse --mode` refusal, then the owner's handler.
  if (verb === "reverse") {
    return routeReverse(rest, d);
  }

  // The argument parsing of the guard-checked verbs. A value-taking flag
  // without a value ends the call with 127 before any state is touched
  // (F119-FR-007, F119-FR-005, B-0235) — never on the uncaught path.
  const inspect = await import("./inspect-args.ts");
  let inspectionArgs;
  try {
    inspectionArgs = inspect.parseInspectArgs(rest);
  } catch (error) {
    if (error instanceof inspect.ValuelessFlagError) return inspect.VALUELESS_FLAG_EXIT;
    throw error;
  }

  if (inspectionArgs.help) {
    // F119-FR-004 — `-h`/`--help` after an inspection verb: usage, exit 0,
    // and the verb does not run.
    return printUsage(d.mode, d.io);
  }

  const guards = await import("./guards.ts");
  const cp = guards.controlPlaneOf(
    inspect.resolveWorkdir(inspectionArgs.workdir, d.cwd),
    d.stateDir,
  );

  if (verb === "stop" || verb === "resume") {
    // F119-FR-009 — for `resume` the state check is the FIRST check of its
    // row (B-1482 before B-1494; CQ-184); `stop` holds the same state check.
    const guard = verb === "resume" ? guards.resumeStateCheckFirst(cp) : guards.stateGuard(cp);
    if (guard !== null) return applyGuard(verb, guard, d.io, d.mode);
    return mounted(verb, d.handlers, callOf(verb, rest, cp, d.io, d.mode));
  }

  if (verb === "learn") {
    const guard = guards.stateGuard(cp);
    if (guard !== null) return applyGuard(verb, guard, d.io, d.mode);
    return mounted(verb, d.handlers, callOf(verb, rest, cp, d.io, d.mode));
  }

  if (verb === "spec" || verb === "verify" || verb === "launch" || verb === "wait") {
    // F119-FR-013 — public verbs of their owners; the front door adds no
    // check and passes the code of their row through (F119-FR-011).
    return mounted(verb, d.handlers, callOf(verb, rest, cp, d.io, d.mode));
  }

  // The inspection verbs of this feature, and `status` (owner 129,
  // compatibility output: 119). Guards first, then the handler.
  const slug = resolveSlug(inspectionArgs, cp, verb, inspect);
  if (verb !== "feedback" && verb !== "phases") {
    // F119-FR-009 — the state check, then the feature check (`--all` skips
    // the feature check; `status --all` skips both).
    const guard = guards.stateGuard(cp, { skip: verb === "status" && inspectionArgs.all });
    if (guard !== null) return applyGuard(verb, guard, d.io, d.mode, inspectionArgs.json);
    const feature = guards.featureGuard(cp, slug, { skip: inspectionArgs.all });
    if (feature !== null) return applyGuard(verb, feature, d.io, d.mode, inspectionArgs.json);
  }

  // F119-FR-010 — the missing-input exits of the inspection verbs.
  const missing = await missingInputGuard(
    verb,
    inspectionArgs,
    cp,
    slug,
    d.launchDir,
    guards,
    inspect,
  );
  if (missing !== null) return applyGuard(verb, missing, d.io, d.mode, inspectionArgs.json);

  return mounted(verb, d.handlers, callOf(verb, rest, cp, d.io, d.mode));
}

function callOf(
  verb: string,
  extras: readonly string[],
  cp: ControlPlane,
  io: RouteIo,
  mode?: UsageMode | undefined,
): RoutedCall {
  return { verb, extras: [...extras], workdir: cp.workdir, controlPlane: cp, io, mode };
}

/** The feature slug of one inspection call (F119-FR-008). */
function resolveSlug(
  args: ReturnType<typeof inspect.parseInspectArgs>,
  cp: ControlPlane,
  verb: string,
  inspect: typeof import("./inspect-args.ts"),
): string {
  if (args.feature !== undefined) return inspect.sanitizeFeature(args.feature);
  if (verb === "status" && args.extras[0] !== undefined) {
    // `status <feature>`: the positional feature of the call (the guard and
    // the handler must read the same slug).
    return inspect.sanitizeFeature(args.extras[0]);
  }
  if (verb === "status" && args.all) return "";
  return inspect.featureOfTheLastRun(cp.stateDir) ?? inspect.DEFAULT_FEATURE;
}

/** The one missing-input check of each inspection verb (F119-FR-010). */
async function missingInputGuard(
  verb: string,
  args: ReturnType<typeof inspect.parseInspectArgs>,
  cp: ControlPlane,
  slug: string,
  launchDir: string,
  guards: typeof import("./guards.ts"),
  inspect: typeof import("./inspect-args.ts"),
): Promise<GuardRefusal | null> {
  if (verb === "tail") return guards.tailGuard(cp, slug);
  if (verb === "events") return guards.eventsGuard(cp);
  if (verb === "verdicts") return guards.verdictsGuard(cp, slug, inspect.phaseNumberArg(args));
  if (verb === "feedback") return guards.feedbackGuard(cp, slug, inspect.phaseNumberArg(args));
  if (verb === "phases") {
    const specPath = inspect.resolveSpec(args, {
      workdir: cp.workdir,
      launchDir,
      stateDir: cp.stateDir,
    });
    return guards.specGuard(cp, specPath);
  }
  return null;
}

function engineIo(d: DispatchDeps): {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd: string;
} {
  return { out: d.io.out, err: d.io.err, cwd: d.cwd };
}

/** Route `reverse`: the `--mode` refusal first, then the owner's handler. */
async function routeReverse(rest: readonly string[], d: DispatchDeps): Promise<number> {
  const mode = reverseModeOf(rest);
  if (mode !== undefined && mode !== REVERSE_ACCEPTED_MODE) {
    d.io.err(`${reverseModeRefusal(mode)}\n`);
    return REVERSE_MODE_REFUSAL_EXIT;
  }
  const guards = await import("./guards.ts");
  const cp = guards.controlPlaneOf(
    await import("./inspect-args.ts").then((m) => m.resolveWorkdir(undefined, d.cwd)),
    d.stateDir,
  );
  return mounted("reverse", d.handlers, callOf("reverse", rest, cp, d.io, d.mode));
}

/** Hand the call to the owner's handler, or say so truthfully. */
function mounted(
  verb: string,
  handlers: RouteHandlers,
  call: RoutedCall,
): number | Promise<number> {
  const handler = handlers[verb];
  if (handler === undefined) {
    // Phase 4 — the read verbs of this feature are mounted in this build:
    // fall back to the inspection handlers before the truthful refusal. The
    // load is lazy and cached, so an engine call never pays for it.
    if (INSPECT_DEFAULT_VERBS.includes(verb)) {
      return defaultInspectHandlers().then((defaults) => {
        const found = defaults[verb];
        if (found === undefined) throw new VerbNotMountedError(verb);
        return found(call);
      });
    }
    return composedHandler(verb, call);
  }
  return handler(call);
}

/** The verbs whose handlers this feature mounts (T029 to T034, T058). */
/** The verbs the composition root of this build mounts. */
async function composedHandler(verb: string, call: RoutedCall): Promise<number> {
  const composed = await import("../engine/handlers.ts");
  if (verb === "spec") return composed.specHandler(call.extras, call.workdir, call.io);
  if (verb === "verify") return composed.verifyHandler(call.extras, call.io);
  if (verb === "launch") return composed.launchHandler(call);
  if (verb === "wait") return composed.waitHandler(call);
  if (verb === "stop") return composed.stopHandler(call);
  const refusal = composed.NOT_IN_THIS_BUILD[verb];
  if (refusal === undefined) throw new VerbNotMountedError(verb);
  call.io.err(`specstride ${verb}: ${refusal}\n`);
  return composed.NOT_IN_THIS_BUILD_EXIT;
}

const INSPECT_DEFAULT_VERBS: readonly string[] = Object.freeze([
  "tail",
  "events",
  "verdicts",
  "feedback",
  "phases",
  "watch",
  // Phase 5 — `status` is mounted for COMPATIBILITY output only (F119-FR-028);
  // in default output the handler itself refuses truthfully: its owner is 129.
  "status",
]);

let inspectHandlersCache: Promise<RouteHandlers> | undefined;

function defaultInspectHandlers(): Promise<RouteHandlers> {
  inspectHandlersCache ??= import("../inspect/index.ts").then((module) => module.inspectHandlers());
  return inspectHandlersCache;
}
