/**
 * T019 (feature 112) — the flag parser of the doctor (F112-FR-026,
 * CT-112-126).
 *
 * The flags are parsed once (data-model.md, "Parsed once"):
 * `--json --verbose --quick --offline --online --role <role> --harness <id>
 * --check <id> --launch-checks --strict --workdir <dir>`.
 *
 * A usage error — an unknown flag, an unknown role or harness, an unknown
 * check id in the filter — throws `UsageError`, which the entry point turns
 * into one usage line and exit 3 (F112-FR-026).
 *
 * `--offline` forbids the network and allows subprocesses; `--online` runs the
 * free model-list requests; without either, the default follows the
 * configuration key `doctor.online` (default true, and on when a credential
 * reference exists for a role in use) — `resolveOnline`.
 */
import { EXIT_USAGE } from "./exit.ts";

/** A usage error: one usage line and exit 3 (F112-FR-026). */
export class UsageError extends Error {
  readonly exit: typeof EXIT_USAGE = EXIT_USAGE;
  readonly flag: string;
  constructor(message: string, flag: string) {
    super(message);
    this.name = "UsageError";
    this.flag = flag;
  }
}

/** The parsed flags of the doctor (data-model.md, the entity "Flags"). */
export type DoctorFlags = {
  readonly json: boolean;
  readonly verbose: boolean;
  readonly quick: boolean;
  readonly offline: boolean;
  readonly online: boolean;
  readonly role?: string;
  readonly harness?: string;
  /** The check-id filter: only the named checks run (may be given more than once). */
  readonly check: readonly string[];
  /** The `lb` subset, evaluated without launching (F112-FR-030, annex G §G.4). */
  readonly launchChecks: boolean;
  readonly strict: boolean;
  readonly workdir?: string;
};

/** The flags that take a value. */
const VALUE_FLAGS: Readonly<Record<string, "role" | "harness" | "check" | "workdir">> =
  Object.freeze({
    "--role": "role",
    "--harness": "harness",
    "--check": "check",
    "--workdir": "workdir",
  });

/** The boolean flags. */
const BOOL_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--verbose",
  "--quick",
  "--offline",
  "--online",
  "--launch-checks",
  "--strict",
]);

/** The names the usage line prints (F112-FR-026). */
export const USAGE_LINE =
  "usage: specstride doctor [--json] [--verbose] [--quick] [--offline] [--online] " +
  "[--role <role>] [--harness <id>] [--check <id>]... [--launch-checks] [--strict] [--workdir <dir>]";

/** The known values of the closed sets the value flags name, when supplied. */
export type KnownValues = {
  readonly roles?: readonly string[];
  readonly harnesses?: readonly string[];
  readonly checkIds?: readonly string[];
};

/** Parse the argv of the doctor. Throws `UsageError` (exit 3) on bad input. */
export function parseDoctorFlags(argv: readonly string[], known?: KnownValues): DoctorFlags {
  let json = false;
  let verbose = false;
  let quick = false;
  let offline = false;
  let online = false;
  let launchChecks = false;
  let strict = false;
  let role: string | undefined;
  let harness: string | undefined;
  let workdir: string | undefined;
  const check: string[] = [];
  const fail = (flag: string, why: string): never => {
    throw new UsageError(`${why} (${flag})`, flag);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const valueFlag = VALUE_FLAGS[arg];
    if (valueFlag !== undefined) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        fail(arg, `the flag needs a value`);
      }
      i += 1;
      if (valueFlag === "role") {
        if (role !== undefined) fail(arg, `the flag is given more than once`);
        role = value;
      } else if (valueFlag === "harness") {
        if (harness !== undefined) fail(arg, `the flag is given more than once`);
        harness = value;
      } else if (valueFlag === "workdir") {
        if (workdir !== undefined) fail(arg, `the flag is given more than once`);
        workdir = value;
      } else {
        // `--check <id>` MAY be given more than once; the named checks run.
        check.push(value);
      }
      continue;
    }
    if (BOOL_FLAGS.has(arg)) {
      if (arg === "--json") json = true;
      else if (arg === "--verbose") verbose = true;
      else if (arg === "--quick") quick = true;
      else if (arg === "--offline") offline = true;
      else if (arg === "--online") online = true;
      else if (arg === "--launch-checks") launchChecks = true;
      else strict = true;
      continue;
    }
    fail(arg, "unknown flag");
  }
  if (offline && online) {
    fail("--online", "--offline and --online contradict each other");
  }
  if (known?.roles !== undefined && role !== undefined && !known.roles.includes(role)) {
    fail("--role", `unknown role \`${role}\``);
  }
  if (
    known?.harnesses !== undefined &&
    harness !== undefined &&
    !known.harnesses.includes(harness)
  ) {
    fail("--harness", `unknown harness \`${harness}\``);
  }
  if (known?.checkIds !== undefined) {
    for (const id of check) {
      if (!known.checkIds.includes(id)) {
        fail("--check", `unknown check id \`${id}\` in the filter`);
      }
    }
  }
  return {
    json,
    verbose,
    quick,
    offline,
    online,
    ...(role !== undefined ? { role } : {}),
    ...(harness !== undefined ? { harness } : {}),
    check: Object.freeze([...check]),
    launchChecks,
    strict,
    ...(workdir !== undefined ? { workdir } : {}),
  };
}

/**
 * The default of the network (F112-FR-026): `--offline` forbids it, `--online`
 * forces it on, and the default follows the configuration key `doctor.online`
 * (default true, and on when a credential reference exists for a role in use).
 */
export function resolveOnline(input: {
  flags: Pick<DoctorFlags, "offline" | "online">;
  config?: ReadonlyMap<string, unknown>;
  credentialRoles?: readonly string[];
}): boolean {
  if (input.flags.offline) return false;
  if (input.flags.online) return true;
  const key = input.config?.get("doctor.online");
  if (typeof key === "boolean") return key;
  // Default true; a credential reference for a role in use forces it too.
  return true;
}
