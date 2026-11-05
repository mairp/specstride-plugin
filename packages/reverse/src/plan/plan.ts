/**
 * T015 — `plan`: the four writes, the plan JSON and the verb dispatch
 * (F108-FR-011, F108-FR-012, F108-FR-014, F108-FR-015).
 *
 * `plan` never calls a model. It obtains the inventory through the CLI command
 * `reverse inventory` (T004), derives the phases, the driver spec and the
 * verification-commands document from it, writes the four files of F108-FR-014
 * atomically, and prints ONE JSON object with the keys of F108-FR-015, which
 * is checked against the shipped copy of `contracts/plan-output.schema.json`
 * before it is returned.
 *
 * Every path of the plan is the location of a LOGICAL NAME of annex B §B.5,
 * resolved through `@specstride/contracts`: nothing here spells a path of
 * state, which is what lets the oracle compare the values through the layout
 * table (F108-FR-015).
 */
import { basename, join, relative } from "node:path";

import {
  resolve as resolveLogicalName,
  type RootPaths,
} from "@specstride/contracts/ids/logical-names";
import { atomicWrite } from "@specstride/kernel/atomic-write";

import {
  buildVerificationCommands,
  serializeVerificationCommands,
  sortedKeys,
  type CommandLocations,
} from "./commands.ts";
import { checkGateStateCollision } from "./collision.ts";
import {
  buildDriver,
  commandsPhaseOf,
  phasesOfAReverseRun,
  templateDirectory,
  TASKS_MODES,
  type DriverInput,
  type ReversePhase,
  type TasksMode,
} from "./driver.ts";
import {
  callReverseInventory,
  constitutionOf,
  frameworksOf,
  languagesOf,
  REFUSED_EXIT_CODE,
  unitCountOf,
  USAGE_EXIT_CODE,
  type InventoryCallRunner,
  type InventoryFields,
  type Inventory,
} from "./inventory-call.ts";
import {
  checkOutputDirectory,
  defaultOutputDirectory,
  featureOfSlug,
  realSource,
  ReverseError,
  slugify,
} from "./output.ts";
import { checkAgainstShippedSchema, violationLines } from "./schema-check.ts";

/* ------------------------------------------------------------------------- *
 * The verbs (F108-FR-012)
 * ------------------------------------------------------------------------- */

/** The four verbs of the command `reverse` (F108-FR-012; annex G §G.1). */
export const VERBS = ["plan", "lint", "guard", "inventory"] as const;

/** One verb of `VERBS`. */
export type Verb = (typeof VERBS)[number];

/** True for a verb the command offers. */
export function isAVerb(word: string): word is Verb {
  return (VERBS as readonly string[]).includes(word);
}

/**
 * F108-FR-012 — a verb is recognised ONLY as the first argument. A source
 * directory that happens to carry the name of a verb is written with a leading
 * `./`, and this reader honours that: `./plan` is a source, `plan` is the verb.
 */
export function verbOf(argv: readonly string[]): Verb | undefined {
  const first = argv[0];
  if (first === undefined) return undefined;
  return isAVerb(first) ? first : undefined;
}

/** F108-FR-012 — the usage error of a missing or unknown verb, exit 2. */
export function unknownVerbMessage(word: string): string {
  return `specstride reverse: unknown verb '${word}'; the verbs are ${VERBS.join(", ")}`;
}

/** F108-FR-012 — the usage error where no verb and no wrapper form applies. */
export function missingVerbMessage(): string {
  return `usage: specstride reverse <SRC> ... | specstride reverse ${VERBS.join("|")} ...`;
}

/* ------------------------------------------------------------------------- *
 * The tasks mode (F108-FR-011)
 * ------------------------------------------------------------------------- */

/** The default tasks mode of a reverse run (F108-FR-011). */
export const DEFAULT_TASKS_MODE: TasksMode = "done";

/** The configuration key the tasks mode comes from (annex X §X.7 row 68). */
export const TASKS_KEY = "reverse.tasks" as const;

/** Its as-is variable (annex X §X.8). */
export const TASKS_VARIABLE = "SPECSTRIDE_REVERSE_TASKS" as const;

/**
 * The legacy-prefixed spellings of the variable, which F108-FR-011 says MUST
 * NOT be read. They are listed so that a test can prove they are ignored.
 */
export const LEGACY_TASKS_VARIABLES = Object.freeze([
  "RALPH_REVERSE_TASKS",
  "WIGGUM_REVERSE_TASKS",
] as const);

/** F108-FR-011 — the message of a bad `--tasks` value. */
export function tasksFlagMessage(value: string): string {
  return `--tasks must be done or open (got '${value}')`;
}

/** F108-FR-011 — the message of a bad value of the setting. */
export function tasksSettingMessage(value: string): string {
  return `${TASKS_VARIABLE} must be done or open (got '${value}')`;
}

/** True for a value that is one of the two modes. */
export function isATasksMode(value: string): value is TasksMode {
  return (TASKS_MODES as readonly string[]).includes(value);
}

/**
 * F108-FR-011 — the tasks mode: from `--tasks`, else from the setting
 * `reverse.tasks` (as-is variable `SPECSTRIDE_REVERSE_TASKS`, whose EMPTY value
 * counts as `done`), else `done`. Any other value fails the plan with exit 3
 * and the matching message. The legacy-prefixed variable is never read.
 */
export function resolveTasksMode(input: {
  readonly flag?: string | undefined;
  readonly setting?: string | undefined;
}): TasksMode {
  const flag = input.flag;
  if (flag !== undefined) {
    if (isATasksMode(flag)) return flag;
    throw new ReverseError(tasksFlagMessage(flag), "tasks-flag", REFUSED_EXIT_CODE);
  }
  const setting = input.setting;
  if (setting !== undefined) {
    if (setting === "") return DEFAULT_TASKS_MODE;
    if (isATasksMode(setting)) return setting;
    throw new ReverseError(tasksSettingMessage(setting), "tasks-setting", REFUSED_EXIT_CODE);
  }
  return DEFAULT_TASKS_MODE;
}

/**
 * The tasks mode from an environment, reading ONLY `SPECSTRIDE_REVERSE_TASKS`.
 * The legacy-prefixed names of `LEGACY_TASKS_VARIABLES` are not read, and a
 * test proves it by setting one and seeing the default stand.
 */
export function tasksModeOfEnvironment(
  flag: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): TasksMode {
  return resolveTasksMode({ flag, setting: env[TASKS_VARIABLE] });
}

/* ------------------------------------------------------------------------- *
 * The logical names the plan resolves (F108-FR-014, F108-FR-015)
 * ------------------------------------------------------------------------- */

/** The logical names of the files and directories the plan JSON names. */
export const PLAN_LOGICAL_NAMES = Object.freeze({
  inventory: "reverse:<slug>:inventory",
  inventory_md: "reverse:<slug>:inventory-summary",
  driver: "reverse:<slug>:driver",
  verification_commands: "reverse:<slug>:verification-commands",
  test_plan: "reverse:<slug>:test-plan",
  generate_tests: "reverse:<slug>:scaffolds",
  analysis: "reverse:<slug>:analysis",
} as const);

/** Those names, resolved for one slug. */
export type PlanLocations = Readonly<Record<keyof typeof PLAN_LOGICAL_NAMES, string>>;

/** Resolve every logical name of the plan for one slug. */
export function planLocations(slug: string, roots: RootPaths): PlanLocations {
  const out: Record<string, string> = {};
  for (const [key, logicalName] of Object.entries(PLAN_LOGICAL_NAMES)) {
    out[key] = resolveLogicalName(logicalName, { "<slug>": slug }, roots);
  }
  return Object.freeze(out) as PlanLocations;
}

/** The workspace part of the source, the root `<workspace-part>`. */
export function stateDirectoryOf(roots: RootPaths): string {
  const part = roots["<workspace-part>"];
  if (part === undefined || part === "") {
    throw new ReverseError(
      "the workspace part of the source is not among the roots the plan was given",
      "no-workspace-part",
      REFUSED_EXIT_CODE,
    );
  }
  return part;
}

/**
 * The directory of the run inside the workspace part, the `run_state` of
 * F108-FR-015. It is the directory the workspace-part names of a reverse run
 * share, so it is taken from one of them rather than spelled here.
 */
export function runStateOf(slug: string, roots: RootPaths): string {
  const driver = resolveLogicalName(PLAN_LOGICAL_NAMES.driver, { "<slug>": slug }, roots);
  return driver.slice(0, driver.lastIndexOf("/")) || "/";
}

/* ------------------------------------------------------------------------- *
 * The plan output (F108-FR-015)
 * ------------------------------------------------------------------------- */

/** The schema file of the plan output, shipped in `data/` by T002. */
export const PLAN_SCHEMA_FILE = "plan-output.schema.json" as const;

/** The keys of the plan JSON, in the order F108-FR-015 lists them. */
export const PLAN_KEYS = Object.freeze([
  "src",
  "slug",
  "feature",
  "out",
  "state_dir",
  "run_state",
  "inventory",
  "inventory_md",
  "driver",
  "verification_commands",
  "test_plan",
  "generate_tests",
  "analysis",
  "tasks_mode",
  "oversize",
  "phases",
  "summary",
] as const);

/** One phase as the plan JSON holds it (F108-FR-015). */
export type PlanPhase = {
  readonly n: number;
  readonly title: string;
  readonly lint_level: number;
};

/** The `summary` of the plan JSON (F108-FR-015). */
export type PlanSummary = {
  readonly files: number;
  readonly skipped: number;
  readonly text_bytes: number;
  readonly walk: string;
  readonly git_head: string | null;
  readonly languages: Readonly<Record<string, number>>;
  readonly frameworks: readonly string[];
  readonly units: number;
  readonly constitution: "existing" | "to be written";
};

/** The plan JSON (F108-FR-015). */
export type PlanOutput = {
  readonly src: string;
  readonly slug: string;
  readonly feature: string;
  readonly out: string;
  readonly state_dir: string;
  readonly run_state: string;
  readonly inventory: string;
  readonly inventory_md: string;
  readonly driver: string;
  readonly verification_commands: string;
  readonly test_plan: string;
  readonly generate_tests: string;
  readonly analysis: string;
  readonly tasks_mode: TasksMode;
  readonly oversize: boolean;
  readonly phases: readonly PlanPhase[];
  readonly summary: PlanSummary;
};

/** F108-FR-015 — the phases as the plan JSON holds them. */
export function planPhasesOf(phases: readonly ReversePhase[]): readonly PlanPhase[] {
  return Object.freeze(
    phases.map((phase) =>
      Object.freeze({ n: phase.n, title: phase.title, lint_level: phase.lintLevel }),
    ),
  );
}

/** F108-FR-015 — the summary, from the inventory's own fields. */
export function planSummaryOf(inventory: Inventory, fields: InventoryFields): PlanSummary {
  return Object.freeze({
    files: inventory.totals.files ?? fields.files.length,
    skipped: inventory.totals.skipped ?? fields.skipped.length,
    text_bytes: inventory.totals.text_bytes ?? 0,
    walk: fields.walk,
    git_head: fields.git_head,
    languages: languagesOf(fields),
    frameworks: frameworksOf(fields),
    units: unitCountOf(fields),
    constitution: constitutionOf(fields),
  });
}

/** A plan output this module built that the shipped schema refuses. */
export class PlanOutputNotValidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanOutputNotValidError";
  }
}

/**
 * F108-FR-015 — the plan as ONE JSON object, indented by one space with sorted
 * keys. It is checked against the shipped schema and against `PLAN_KEYS`
 * before it is printed, so an output that misses a key is never printed.
 */
export function serializePlanOutput(output: PlanOutput): string {
  const missing = PLAN_KEYS.filter((key) => !(key in output));
  if (missing.length > 0) {
    throw new PlanOutputNotValidError(
      `the plan output misses the key(s) ${missing.join(", ")} of F108-FR-015`,
    );
  }
  const violations = checkAgainstShippedSchema(output, PLAN_SCHEMA_FILE);
  if (violations.length > 0) {
    throw new PlanOutputNotValidError(
      `the plan output does not satisfy data/${PLAN_SCHEMA_FILE}: ${violationLines(violations)}`,
    );
  }
  return JSON.stringify(output, sortedKeys, 1);
}

/* ------------------------------------------------------------------------- *
 * `plan` itself (F108-FR-014)
 * ------------------------------------------------------------------------- */

/** The mode of the file a reverse plan writes: owner-only (F100-FR-043). */
export const FILE_MODE = 0o600;

/** What `plan` is given. */
export type PlanInput = {
  /** The source, as the consumer wrote it; resolved to its real path. */
  readonly src: string;
  /** `--name <SLUG>`; the default is the base name of the source directory. */
  readonly name?: string | undefined;
  /** `--out <DIR>`, made absolute against `cwd`; the default is F108-FR-024's. */
  readonly out?: string | undefined;
  /** `--tasks done|open`. */
  readonly tasks?: string | undefined;
  /** The current directory `--out` is made absolute against. */
  readonly cwd?: string | undefined;
  /** The roots of the machine, for every logical name of the plan. */
  readonly roots: RootPaths;
  /** The root of the installed package, for the shipped templates. */
  readonly packageRoot: string;
  /** The environment the setting `reverse.tasks` is read from. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  /** The product's own entry, for the verification commands and the call. */
  readonly executable?: string | undefined;
  /** Arguments before the command of the inventory call (a script path). */
  readonly prefixArgs?: readonly string[] | undefined;
  /** The runner of the inventory call; a test replaces it. */
  readonly run?: InventoryCallRunner | undefined;
};

/** What `plan` did: the output, the bytes it wrote and where it wrote them. */
export type PlanResult = {
  readonly output: PlanOutput;
  /** The JSON `plan` prints, without its line end. */
  readonly json: string;
  /** The files that were written, by the key of the plan output. */
  readonly written: Readonly<Record<string, string>>;
  /** The driver spec, as it was written. */
  readonly driver: string;
  /** The phases of the run. */
  readonly phases: readonly ReversePhase[];
  /** The exit code of a plan that succeeded: 0 (F108-FR-015). */
  readonly exitCode: 0;
};

/** The exit code of `plan` after it printed the plan (F108-FR-015). */
export const PLAN_EXIT_CODE = 0 as const;

/**
 * F108-FR-011 to F108-FR-015 — the whole of `plan`.
 *
 * In order: the source is resolved (F108-FR-013), the slug and the output
 * directory are named and judged (F108-FR-024, F108-FR-025), the gate state of
 * the feature is checked (F108-FR-026), the tasks mode is resolved
 * (F108-FR-011), the inventory is obtained through the CLI command with the
 * output directory as its ONLY exclusion (F108-FR-014), the phases, the driver
 * and the commands document are derived, and the four files are written
 * atomically. The output directory is never created.
 */
export function plan(input: PlanInput): PlanResult {
  const src = realSource(input.src);
  const slug = slugify(input.name ?? basename(src));
  const feature = featureOfSlug(slug);
  const cwd = input.cwd ?? process.cwd();

  const wanted =
    input.out === undefined
      ? defaultOutputDirectory(src, slug)
      : input.out.startsWith("/")
        ? input.out
        : join(cwd, input.out);
  const out = checkOutputDirectory({ src, out: wanted, slug });

  checkGateStateCollision(slug, input.roots);

  const tasksMode = tasksModeOfEnvironment(input.tasks, input.env ?? process.env);

  const locations = planLocations(slug, input.roots);
  const stateDir = stateDirectoryOf(input.roots);
  const runState = runStateOf(slug, input.roots);

  // F108-FR-014 — the inventory is built with the output directory, relative
  // to the source, as its ONLY exclusion.
  const call = callReverseInventory({
    src,
    out: locations.inventory,
    md: locations.inventory_md,
    excludes: [relative(src, out)],
    executable: input.executable,
    prefixArgs: input.prefixArgs,
    cwd: src,
    run: input.run,
  });
  const inventory = call.read.inventory;
  const fields = call.read.fields;

  const writesAConstitution = constitutionOf(fields) === "to be written";
  const phases = phasesOfAReverseRun({
    slug,
    tasksMode,
    writesAConstitution,
    oversize: fields.oversize,
    units: fields.units.map((unit) => unit.path),
    roots: input.roots,
  });

  const commandLocations: CommandLocations = Object.freeze({
    src,
    out,
    baseline: locations.inventory,
    executable: input.executable,
  });

  const driverInput: DriverInput = Object.freeze({
    slug,
    src,
    sourceBaseName: basename(src),
    out,
    stateDir,
    inventorySummary: locations.inventory_md,
    analysis: locations.analysis,
    templates: templateDirectory(src, input.packageRoot),
    tasksMode,
    oversize: fields.oversize,
    writesAConstitution,
    phases,
    locations: commandLocations,
  });

  const driver = buildDriver(driverInput, locations.driver, feature);
  const commands = buildVerificationCommands(phases.map(commandsPhaseOf), commandLocations);

  // F108-FR-014 — each write is atomic, and the directory of a name is created
  // when its first file is written. The output directory is NOT created.
  atomicWrite(locations.driver, driver, { mode: FILE_MODE, createDirectory: true });
  atomicWrite(locations.verification_commands, serializeVerificationCommands(commands), {
    mode: FILE_MODE,
    createDirectory: true,
  });

  const output: PlanOutput = Object.freeze({
    src,
    slug,
    feature,
    out,
    state_dir: stateDir,
    run_state: runState,
    inventory: locations.inventory,
    inventory_md: locations.inventory_md,
    driver: locations.driver,
    verification_commands: locations.verification_commands,
    test_plan: locations.test_plan,
    generate_tests: locations.generate_tests,
    analysis: locations.analysis,
    tasks_mode: tasksMode,
    oversize: fields.oversize,
    phases: planPhasesOf(phases),
    summary: planSummaryOf(inventory, fields),
  });

  return Object.freeze({
    output,
    json: serializePlanOutput(output),
    written: Object.freeze({
      inventory: locations.inventory,
      inventory_md: locations.inventory_md,
      driver: locations.driver,
      verification_commands: locations.verification_commands,
    }),
    driver,
    phases,
    exitCode: PLAN_EXIT_CODE,
  });
}

/** The exit codes of the plan, re-exported for one import at the call site. */
export { REFUSED_EXIT_CODE, USAGE_EXIT_CODE };
