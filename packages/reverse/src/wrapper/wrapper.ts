/**
 * T016 — the wrapper of `reverse` (F108-FR-001 to F108-FR-010): the entry, the
 * flags, the pass-through, the refusals, the dry run, the launch, the commit
 * switch, `--detach` and the consumer's comment.
 *
 * The wrapper owns no mechanism of its own. It PARSES, REFUSES, calls `plan`
 * and then either prints the dry run or builds the one engine start. The
 * foreground start and the detached submission are seams the caller fills —
 * the detach mechanism belongs to feature 122 and the run-request kind to
 * feature 123 — so that every test here is hermetic and no test of this
 * feature claims a mechanism it does not own.
 */
import { spawnSync } from "node:child_process";

import {
  exitOfLaunch,
  REFUSALS_THAT_EXIT_24,
  type HandshakeOutcome,
} from "@specstride/contracts/state/handshake";
import type { EngineRunRequest } from "@specstride/contracts/state/run-requests";
import { contentHash } from "@specstride/kernel/hasher";

import { shellJoin } from "../plan/commands.ts";
import { DRIVER_FORMAT, TASKS_MODES } from "../plan/driver.ts";
import { DEFAULT_EXECUTABLE, REFUSED_EXIT_CODE, USAGE_EXIT_CODE } from "../plan/inventory-call.ts";
import { ReverseError } from "../plan/output.ts";
import { plan as runPlan, type PlanInput, type PlanResult } from "../plan/plan.ts";
import { COMMIT_SWITCH_OFF, COMMIT_SWITCH_VARIABLE, dryRunOutcome } from "./dry-run.ts";

/**
 * T025 owns the dry run (F108-FR-005) in `./dry-run.ts`; the wrapper decides
 * WHETHER to dry-run and re-exports the module's names so a consumer of the
 * wrapper keeps reading one surface. The dependency runs one way only.
 */
export {
  COMMIT_SWITCH_PREFIX,
  COMMIT_SWITCH_VARIABLE,
  DRY_RUN_EXIT_CODE,
  DRY_RUN_HEADING,
  DRY_RUN_LABELS,
  DRY_RUN_ORCHESTRATOR_LABEL,
  DRY_RUN_PHASES_HEADING,
  dryRunLines,
  dryRunOutcome,
  engineCommandLine,
  inventoryCountsOf,
  labelled,
  phaseLine,
  type DryRunInput,
  type DryRunOutcome,
} from "./dry-run.ts";

/* ------------------------------------------------------------------------- *
 * The entry (F108-FR-001)
 * ------------------------------------------------------------------------- */

/** The command the CLI offers (F108-FR-001; annex G §G.1). */
export const COMMAND = "reverse" as const;

/**
 * F108-FR-001 — the second spelling of the SAME entry point,
 * `specstride --reverse <SRC>`, handled BEFORE any other argument parsing.
 */
export const ENTRY_FLAG = "--reverse" as const;

/**
 * F108-FR-001 — the entry: the arguments of `reverse`, whichever spelling was
 * used, or `undefined` where the arguments are not a reverse entry at all.
 * `specstride --reverse <SRC>` is recognised wherever `--reverse` is the FIRST
 * argument, which is what "before any other argument parsing" means.
 */
export function reverseEntryOf(argv: readonly string[]): readonly string[] | undefined {
  const first = argv[0];
  if (first === ENTRY_FLAG) return Object.freeze(argv.slice(1));
  if (first === COMMAND) return Object.freeze(argv.slice(1));
  return undefined;
}

/* ------------------------------------------------------------------------- *
 * The flags (F108-FR-002, F108-FR-003)
 * ------------------------------------------------------------------------- */

/** F108-FR-002 — the flags of the wrapper that take a value. */
export const WRAPPER_FLAGS_WITH_A_VALUE = Object.freeze([
  "--src",
  "--upto",
  "--lint",
  "--out",
  "--name",
  "--tasks",
  "--mode",
  "--comment",
] as const);

/** F108-FR-002, F108-FR-009 — the flags of the wrapper that take no value. */
export const WRAPPER_FLAGS_WITHOUT_A_VALUE = Object.freeze([
  "--json",
  "--dry-run",
  "--detach",
  "-h",
  "--help",
] as const);

/** F108-FR-002 — the flags that are forwarded to the LINT, lint mode only. */
export const LINT_ONLY_FLAGS = Object.freeze(["--upto", "--json"] as const);

/** F108-FR-002 — the flags that are forwarded to the PLAN. */
export const PLAN_FLAGS = Object.freeze(["--out", "--name", "--tasks"] as const);

/**
 * F108-FR-003 — the flags that are passed on to the engine start WITH their
 * value. Any OTHER argument that starts with a hyphen is passed on as a flag
 * without a value.
 */
export const PASS_THROUGH_WITH_A_VALUE = Object.freeze([
  "--proposer",
  "--critic",
  "--max-rejects",
  "--max-iter",
  "--proposer-timeout",
  "--proposer-timeout-phase",
  "--critic-timeout",
  "--start-phase",
  "--loki-url",
  "--otel-url",
  "--long-job-phase",
  "--long-job-cmd",
] as const);

/**
 * F108-FR-004 — the flags the reverse run SETS ITSELF, which it therefore
 * refuses to be passed.
 */
export const FLAGS_THE_RUN_SETS_ITSELF = Object.freeze([
  "-w",
  "--workdir",
  "-s",
  "--specs",
  "--spec-format",
  "--feature",
  "--verification",
  "--verification-commands",
  "--test-plan",
  "--generate-tests",
] as const);

/** F108-FR-004 — the only mode the wrapper accepts. */
export const ACCEPTED_MODE = "source-aware" as const;

/* ------------------------------------------------------------------------- *
 * The messages (F108-FR-004, F108-FR-007)
 * ------------------------------------------------------------------------- */

/** F108-FR-004 — a flag the reverse run sets itself. */
export function flagIsSetByTheRunMessage(flag: string): string {
  return `specstride reverse: ${flag} is set by the reverse run itself; it cannot be passed`;
}

/** F108-FR-004 — a second positional argument. */
export function unexpectedArgumentMessage(argument: string): string {
  return `specstride reverse: unexpected argument '${argument}'`;
}

/** F108-FR-004 — the usage line of a missing source, on standard error. */
export const USAGE_LINE: string =
  "usage: specstride reverse <SRC> [--name SLUG] [--out DIR] [--tasks done|open] " +
  "[--dry-run] [--detach] [--comment TEXT] [--lint FEATURE_DIR [--upto N] [--json]]";

/**
 * F108-FR-004 — the refusal of a mode other than `source-aware`. The message
 * STARTS with this text; the first word is `Black-box` where the mode is
 * `black-box`, and `Runtime-assisted` otherwise.
 */
export function modeRefusalMessage(mode: string): string {
  const kind = mode === "black-box" ? "Black-box" : "Runtime-assisted";
  return (
    `specstride reverse: ${kind} reverse engineering requires an explicit permission ` +
    `and side-effect policy; only --mode ${ACCEPTED_MODE} is accepted (got '${mode}')`
  );
}

/** The text every mode refusal starts with, after the component prefix. */
export const MODE_REFUSAL_TAIL =
  "reverse engineering requires an explicit permission and side-effect policy" as const;

/** F108-FR-007 — the line printed BEFORE the engine starts. */
export function launchingLine(executable: string, argv: readonly string[]): string {
  return `reverse: launching ${shellJoin([executable, ...argv])}`;
}

/** The front-door usage of `-h`/`--help` (F108-FR-002). */
export const HELP_TEXT = [
  USAGE_LINE,
  "",
  "Reverse-engineer a source tree into an as-is Spec Kit feature.",
  "",
  "  --name SLUG        the name of the run; the default is the source's base name",
  "  --out DIR          the output feature directory inside the source tree",
  "  --tasks done|open  the tasks mode of the produced task list",
  "  --dry-run          print what would be launched and launch nothing",
  "  --detach           run through a run request of kind engine",
  "  --comment TEXT     the consumer's comment, stored with its hash",
  "  --lint FEATURE_DIR run the deterministic Spec Kit lint and start no run",
  "  --upto N           the lint level, with --lint only",
  "  --json             the lint's JSON output, with --lint only",
  "  -h, --help         print this and exit 0",
].join("\n");

/* ------------------------------------------------------------------------- *
 * The parse (F108-FR-002, F108-FR-003, F108-FR-004)
 * ------------------------------------------------------------------------- */

/** What the wrapper read out of the arguments. */
export type ParsedReverse = {
  /** The source directory, the one positional argument. */
  readonly src: string | undefined;
  readonly name: string | undefined;
  readonly out: string | undefined;
  readonly tasks: string | undefined;
  readonly comment: string | undefined;
  readonly mode: string | undefined;
  readonly dryRun: boolean;
  readonly detach: boolean;
  readonly help: boolean;
  /** `--lint <FEATURE_DIR>`: lint mode, which starts no run. */
  readonly lint: string | undefined;
  readonly upto: string | undefined;
  readonly json: boolean;
  /** The flags forwarded to the engine start, in the order they were given. */
  readonly passThrough: readonly string[];
};

/**
 * F108-FR-002 to F108-FR-004 — read the arguments of `reverse`.
 *
 * The refusals of F108-FR-004 are raised HERE, before anything is written: a
 * flag the run sets itself (exit 3), a second positional argument (exit 2) and
 * a mode other than `source-aware` (exit 3). The missing source is raised by
 * the caller, because `--lint` makes it legitimate.
 */
export function parseReverse(argv: readonly string[]): ParsedReverse {
  let src: string | undefined;
  let name: string | undefined;
  let out: string | undefined;
  let tasks: string | undefined;
  let comment: string | undefined;
  let mode: string | undefined;
  let lint: string | undefined;
  let upto: string | undefined;
  let dryRun = false;
  let detach = false;
  let help = false;
  let json = false;
  const passThrough: string[] = [];

  const valueOf = (flag: string, index: number): string => {
    const value = argv[index + 1];
    if (value === undefined) {
      throw new ReverseError(
        `specstride reverse: ${flag} needs a value`,
        "flag-needs-a-value",
        USAGE_EXIT_CODE,
      );
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i] as string;

    // F108-FR-004 — a flag the reverse run sets itself, before anything else.
    if ((FLAGS_THE_RUN_SETS_ITSELF as readonly string[]).includes(argument)) {
      throw new ReverseError(
        flagIsSetByTheRunMessage(argument),
        "flag-set-by-the-run",
        REFUSED_EXIT_CODE,
      );
    }

    if (argument === "-h" || argument === "--help") {
      help = true;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--detach") {
      detach = true;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--src") {
      src = valueOf(argument, i);
      i += 1;
      continue;
    }
    if (argument === "--name") {
      name = valueOf(argument, i);
      i += 1;
      continue;
    }
    if (argument === "--out") {
      out = valueOf(argument, i);
      i += 1;
      continue;
    }
    if (argument === "--tasks") {
      tasks = valueOf(argument, i);
      i += 1;
      continue;
    }
    if (argument === "--comment") {
      comment = valueOf(argument, i);
      i += 1;
      continue;
    }
    if (argument === "--lint") {
      lint = valueOf(argument, i);
      i += 1;
      continue;
    }
    if (argument === "--upto") {
      upto = valueOf(argument, i);
      i += 1;
      continue;
    }
    if (argument === "--mode") {
      mode = valueOf(argument, i);
      i += 1;
      // F108-FR-004 — any value but `source-aware` is refused with exit 3.
      if (mode !== ACCEPTED_MODE) {
        throw new ReverseError(modeRefusalMessage(mode), "mode-refused", REFUSED_EXIT_CODE);
      }
      continue;
    }

    // F108-FR-003 — a pass-through flag with its value.
    if ((PASS_THROUGH_WITH_A_VALUE as readonly string[]).includes(argument)) {
      passThrough.push(argument, valueOf(argument, i));
      i += 1;
      continue;
    }
    // F108-FR-003 — any other argument that starts with a hyphen is passed on
    // as a flag WITHOUT a value.
    if (argument.startsWith("-")) {
      passThrough.push(argument);
      continue;
    }

    // The positional argument: the source. A second one is refused with 2.
    if (src === undefined) {
      src = argument;
      continue;
    }
    throw new ReverseError(
      unexpectedArgumentMessage(argument),
      "unexpected-argument",
      USAGE_EXIT_CODE,
    );
  }

  return Object.freeze({
    src,
    name,
    out,
    tasks,
    comment,
    mode,
    dryRun,
    detach,
    help,
    lint,
    upto,
    json,
    passThrough: Object.freeze(passThrough),
  });
}

/* ------------------------------------------------------------------------- *
 * The comment (F108-FR-010)
 * ------------------------------------------------------------------------- */

/**
 * F108-FR-010 — the options of `reverse` a comment may select among, and
 * NOTHING else: the tasks mode, the name, the output directory and the dry
 * run.
 */
export const COMMENT_MAY_SELECT = Object.freeze([
  "tasks mode",
  "name",
  "output directory",
  "dry run",
] as const);

/**
 * F108-FR-010 — what a comment NEVER changes. The list is the requirement's
 * own, and a test reads it: a comment never widens scope or spend, and never
 * changes a launch check, the terms gate or a budget.
 */
export const COMMENT_NEVER_CHANGES = Object.freeze([
  "scope",
  "spend",
  "a launch check",
  "the terms gate",
  "a budget",
] as const);

/** The comment, stored verbatim with its hash (F108-FR-010). */
export type CommentRecord = {
  /** The comment, byte for byte as the consumer wrote it. */
  readonly comment: string;
  /** Its hash, from the canonical hasher of annex X §X.5. */
  readonly commentHash: string;
};

/**
 * F108-FR-010 — the comment with its hash. It is taken BEFORE any repository
 * text is printed: the caller stores this record first and prints afterwards,
 * and `runReverse` does exactly that.
 */
export function commentRecordOf(comment: string | undefined): CommentRecord | undefined {
  if (comment === undefined) return undefined;
  return Object.freeze({ comment, commentHash: contentHash(comment) });
}

/** What a comment proposed, among the options of `COMMENT_MAY_SELECT`. */
export type CommentSelection = {
  readonly tasks?: string | undefined;
  readonly dryRun?: boolean | undefined;
};

/**
 * F108-FR-010 — read a comment for a selection among the options of
 * `reverse`. It reads only the prose forms of the tasks mode and of the dry
 * run; a comment that asks for anything else — to skip a check, to raise a
 * budget, to widen scope — yields NOTHING, so no check can be changed by it.
 */
export function selectionFromComment(comment: string | undefined): CommentSelection {
  if (comment === undefined) return Object.freeze({});
  const text = comment.toLowerCase();
  const selection: { tasks?: string; dryRun?: boolean } = {};
  for (const mode of TASKS_MODES) {
    if (text.includes(`tasks ${mode}`) || text.includes(`tasks=${mode}`)) selection.tasks = mode;
  }
  if (text.includes("dry run") || text.includes("dry-run")) selection.dryRun = true;
  return Object.freeze(selection);
}

/**
 * F108-FR-010 — an EXPLICIT FLAG WINS over prose in the comment. The flag is
 * taken whenever it was given; the comment's selection is taken only where the
 * flag was not.
 */
export function applyComment(parsed: ParsedReverse): ParsedReverse {
  const selection = selectionFromComment(parsed.comment);
  return Object.freeze({
    ...parsed,
    tasks: parsed.tasks ?? selection.tasks,
    dryRun: parsed.dryRun || (parsed.tasks === undefined && selection.dryRun === true),
  });
}

/* ------------------------------------------------------------------------- *
 * The engine start (F108-FR-006, F108-FR-007, F108-FR-008)
 * ------------------------------------------------------------------------- */

/** F108-FR-006 — the keys of the plan the launch is built from. */
export const PLAN_KEYS_THE_LAUNCH_READS = Object.freeze([
  "src",
  "driver",
  "feature",
  "verification_commands",
  "test_plan",
  "generate_tests",
] as const);

/** The flags of the engine start, each of which the wrapper refuses as input. */
export const ENGINE_FLAGS = Object.freeze({
  workdir: "--workdir",
  specs: "--specs",
  specFormat: "--spec-format",
  feature: "--feature",
  verificationCommands: "--verification-commands",
  testPlan: "--test-plan",
  generateTests: "--generate-tests",
  set: "--set",
} as const);

/**
 * F108-FR-008 — the commit switch of a reverse run. `loop.gitCommits` is set
 * to off at the rank of a FLAG, through the generic `--set` (DV-027), so that
 * no user, project or environment configuration can turn it back on.
 */
export const COMMIT_SWITCH_KEY = "loop.gitCommits" as const;
/**
 * The ONE spelling of the value, shared with the prefix the dry run prints
 * (`./dry-run.ts`), so the flag and the printed command can never disagree.
 */
export const COMMIT_SWITCH_VALUE = COMMIT_SWITCH_OFF;
export const COMMIT_SWITCH: string = `${COMMIT_SWITCH_KEY}=${COMMIT_SWITCH_VALUE}`;

/** The six values of the plan the launch is built from (F108-FR-006). */
export type LaunchInputs = {
  readonly src: string;
  readonly driver: string;
  readonly feature: string;
  readonly verification_commands: string;
  readonly test_plan: string;
  readonly generate_tests: string;
};

/** F108-FR-006 — read the six keys of the plan output the launch needs. */
export function launchInputsOf(output: Readonly<Record<string, unknown>>): LaunchInputs {
  const missing = PLAN_KEYS_THE_LAUNCH_READS.filter(
    (key) => typeof output[key] !== "string" || output[key] === "",
  );
  if (missing.length > 0) {
    throw new ReverseError(
      `specstride reverse: the plan did not name ${missing.join(", ")}`,
      "plan-output-incomplete",
      REFUSED_EXIT_CODE,
    );
  }
  return Object.freeze({
    src: output["src"] as string,
    driver: output["driver"] as string,
    feature: output["feature"] as string,
    verification_commands: output["verification_commands"] as string,
    test_plan: output["test_plan"] as string,
    generate_tests: output["generate_tests"] as string,
  });
}

/**
 * F108-FR-007, F108-FR-008 — the argument list of the ONE engine start: the
 * source as the working tree, the driver spec as the spec in the native
 * format, the feature `reverse-<slug>`, the verification-commands document,
 * the plan of tests and the location of generated tests, the commit switch at
 * the rank of a flag, and last the pass-through flags of F108-FR-003.
 */
export function engineArgv(
  inputs: LaunchInputs,
  passThrough: readonly string[] = [],
): readonly string[] {
  return Object.freeze([
    ENGINE_FLAGS.workdir,
    inputs.src,
    ENGINE_FLAGS.specs,
    inputs.driver,
    ENGINE_FLAGS.specFormat,
    DRIVER_FORMAT,
    ENGINE_FLAGS.feature,
    inputs.feature,
    ENGINE_FLAGS.verificationCommands,
    inputs.verification_commands,
    ENGINE_FLAGS.testPlan,
    inputs.test_plan,
    ENGINE_FLAGS.generateTests,
    inputs.generate_tests,
    ENGINE_FLAGS.set,
    COMMIT_SWITCH,
    ...passThrough,
  ]);
}

/**
 * F108-FR-009 — the run request of kind `engine` that `--detach` makes: one
 * engine start with its arguments, and nothing else. It carries no launch
 * contract, which the kind itself settles (F100-FR-159).
 */
export function engineRunRequest(
  inputs: LaunchInputs,
  passThrough: readonly string[] = [],
): EngineRunRequest {
  return Object.freeze({
    kind: "engine" as const,
    slug: inputs.feature,
    argv: engineArgv(inputs, passThrough),
  });
}

/* ------------------------------------------------------------------------- *
 * The dry run (F108-FR-005) lives in `./dry-run.ts` (T025)
 * ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------- *
 * The launch (F108-FR-007, F108-FR-009)
 * ------------------------------------------------------------------------- */

/** The engine code of a reverse run on a workspace whose lock is held. */
export const ENGINE_CODE_OF_A_HELD_LOCK = 5 as const;

/** How a foreground engine start is run; a test replaces it. */
export type ForegroundRunner = (
  executable: string,
  argv: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> },
) => { readonly status: number | null };

/** The default foreground runner: one process, no shell, streams inherited. */
export const spawnForeground: ForegroundRunner = (executable, argv, options) => {
  const result = spawnSync(executable, [...argv], {
    shell: false,
    stdio: "inherit",
    cwd: options.cwd,
    env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
  });
  return { status: result.status };
};

/** What a submitter of a run request reports back (annex F §F.3). */
export type LaunchSubmission = {
  readonly outcome: HandshakeOutcome;
  /** The member of the closed set of refusals, where the outcome is `refused`. */
  readonly refusal?: string | undefined;
};

/** How a detached run request is submitted; feature 122 owns the mechanism. */
export type LaunchSubmitter = (
  request: EngineRunRequest,
  context: { readonly comment: CommentRecord | undefined },
) => LaunchSubmission;

/**
 * F108-FR-009 — the exit code of a DETACHED reverse run, from the handshake of
 * annex F §F.3: 0 for `started`, 4 for `attached`, 24 for the refusals
 * `lock-conflict` and `lock-unknown`, and 4 for every other refusal of the
 * launch. The mapping is the contract's own `exitOfLaunch`, never a table
 * copied into this feature.
 */
export function exitOfADetachedRun(submission: LaunchSubmission): number {
  return exitOfLaunch(submission.outcome, { refusal: submission.refusal });
}

/** The two refusals that exit 24, re-exported so a test reads the contract. */
export { REFUSALS_THAT_EXIT_24 };

/* ------------------------------------------------------------------------- *
 * `runReverse` (F108-FR-001 to F108-FR-010)
 * ------------------------------------------------------------------------- */

/** What the wrapper is given. */
export type WrapperInput = {
  /** The arguments after `reverse` or after `--reverse`. */
  readonly argv: readonly string[];
  /** The roots of the machine, which the plan resolves its names through. */
  readonly roots: PlanInput["roots"];
  /** The root of the installed package, for the shipped templates. */
  readonly packageRoot: string;
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  /** The product's own entry; `specstride` where none is named. */
  readonly executable?: string | undefined;
  /** Arguments before the command of the inventory call. */
  readonly prefixArgs?: readonly string[] | undefined;
  /** The runner of the inventory call, for a test. */
  readonly run?: PlanInput["run"] | undefined;
  /** The plan, for a test that needs a plan without an inventory call. */
  readonly planner?: ((input: PlanInput) => PlanResult) | undefined;
  /** The foreground engine start. */
  readonly foreground?: ForegroundRunner | undefined;
  /** The submitter of a detached run request. */
  readonly submit?: LaunchSubmitter | undefined;
};

/** What the wrapper did. */
export type WrapperResult = {
  readonly exitCode: number;
  /** The lines of standard output, in order. */
  readonly stdout: readonly string[];
  /** The lines of standard error, in order. */
  readonly stderr: readonly string[];
  /** The comment record, stored BEFORE any repository text was printed. */
  readonly comment?: CommentRecord | undefined;
  /** The plan, where one was made. */
  readonly plan?: PlanResult | undefined;
  /** The engine start that was made, or that the dry run only printed. */
  readonly engine?: { readonly executable: string; readonly argv: readonly string[] } | undefined;
  /** The run request, where `--detach` was given. */
  readonly request?: EngineRunRequest | undefined;
  /** The handshake outcome of a detached run. */
  readonly submission?: LaunchSubmission | undefined;
  /** True where the arguments put the wrapper in lint mode (F108-FR-002). */
  readonly lintMode: boolean;
};

/**
 * The whole wrapper. Every refusal happens before anything is written; the
 * comment is hashed and recorded before the first line of repository text; the
 * dry run launches nothing; and a launch is either one foreground engine start
 * whose code the wrapper exits with, or one run request of kind `engine`.
 */
export function runReverse(input: WrapperInput): WrapperResult {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const executable = input.executable ?? DEFAULT_EXECUTABLE;

  let parsed: ParsedReverse;
  try {
    parsed = parseReverse(input.argv);
  } catch (error) {
    const reverseError = error as ReverseError;
    stderr.push(`reverse: ${reverseError.message}`);
    return Object.freeze({
      exitCode: reverseError.exitCode ?? REFUSED_EXIT_CODE,
      stdout: Object.freeze(stdout),
      stderr: Object.freeze(stderr),
      lintMode: false,
    });
  }

  if (parsed.help) {
    stdout.push(HELP_TEXT);
    return Object.freeze({
      exitCode: 0,
      stdout: Object.freeze(stdout),
      stderr: Object.freeze(stderr),
      lintMode: false,
    });
  }

  // F108-FR-010 — the comment is hashed and recorded BEFORE any repository
  // text is printed. Nothing above this line reads the source.
  const comment = commentRecordOf(parsed.comment);
  const effective = applyComment(parsed);

  // F108-FR-002 — lint mode runs the lint, calls no model and starts no run.
  if (effective.lint !== undefined) {
    return Object.freeze({
      exitCode: 0,
      stdout: Object.freeze(stdout),
      stderr: Object.freeze(stderr),
      comment,
      lintMode: true,
    });
  }

  const src = effective.src;
  if (src === undefined) {
    // F108-FR-004 — a missing source without `--lint`: exit 2 and the usage
    // line on standard error.
    stderr.push(USAGE_LINE);
    return Object.freeze({
      exitCode: USAGE_EXIT_CODE,
      stdout: Object.freeze(stdout),
      stderr: Object.freeze(stderr),
      comment,
      lintMode: false,
    });
  }

  const planner = input.planner ?? runPlan;
  let result: PlanResult;
  try {
    result = planner({
      src,
      name: effective.name,
      out: effective.out,
      tasks: effective.tasks,
      cwd: input.cwd,
      roots: input.roots,
      packageRoot: input.packageRoot,
      env: input.env,
      executable: input.executable,
      prefixArgs: input.prefixArgs,
      run: input.run,
    });
  } catch (error) {
    // F108-FR-006 — when planning fails, `reverse` exits with the exit code of
    // the plan, which is 3.
    const reverseError = error as ReverseError;
    stderr.push(`reverse: ${reverseError.message}`);
    return Object.freeze({
      exitCode: reverseError.exitCode ?? REFUSED_EXIT_CODE,
      stdout: Object.freeze(stdout),
      stderr: Object.freeze(stderr),
      comment,
      lintMode: false,
    });
  }

  const inputs = launchInputsOf(result.output);
  const argv = engineArgv(inputs, effective.passThrough);

  // F108-FR-005 — the dry run prints and launches NOTHING, and exits 0. The
  // lines and the exit code are the dry run's own (`./dry-run.ts`), and this
  // branch returns BEFORE the launch line and before any runner is reached.
  if (effective.dryRun) {
    const outcome = dryRunOutcome({ result, executable, argv });
    stdout.push(...outcome.stdout);
    return Object.freeze({
      exitCode: outcome.exitCode,
      stdout: Object.freeze(stdout),
      stderr: Object.freeze(stderr),
      comment,
      plan: result,
      engine: Object.freeze({ executable, argv }),
      lintMode: false,
    });
  }

  // F108-FR-007 — the launch line is printed BEFORE the start.
  stdout.push(launchingLine(executable, argv));

  if (effective.detach) {
    // F108-FR-009 — `--detach` makes a run request of kind `engine`.
    const request = engineRunRequest(inputs, effective.passThrough);
    const submit = input.submit;
    if (submit === undefined) {
      throw new ReverseError(
        "specstride reverse: --detach needs the submitter of a run request",
        "no-submitter",
        REFUSED_EXIT_CODE,
      );
    }
    const submission = submit(request, { comment });
    return Object.freeze({
      exitCode: exitOfADetachedRun(submission),
      stdout: Object.freeze(stdout),
      stderr: Object.freeze(stderr),
      comment,
      plan: result,
      engine: Object.freeze({ executable, argv }),
      request,
      submission,
      lintMode: false,
    });
  }

  // F108-FR-009 — without the flag the engine runs in the FOREGROUND and the
  // wrapper exits with the engine's code.
  const foreground = input.foreground ?? spawnForeground;
  const run = foreground(executable, argv, {
    cwd: inputs.src,
    env: { [COMMIT_SWITCH_VARIABLE]: COMMIT_SWITCH_VALUE },
  });
  return Object.freeze({
    exitCode: run.status ?? REFUSED_EXIT_CODE,
    stdout: Object.freeze(stdout),
    stderr: Object.freeze(stderr),
    comment,
    plan: result,
    engine: Object.freeze({ executable, argv }),
    lintMode: false,
  });
}
