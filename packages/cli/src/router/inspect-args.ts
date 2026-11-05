/**
 * T021 — the inspection argument parser and the resolution of workdir, spec
 * and feature (F119-FR-007, F119-FR-008).
 *
 * The parser is permissive by design: every argument that is not one of the
 * flags of F119-FR-007 is COLLECTED, in order, as a pass-through extra; the
 * front door never rejects an unknown flag of an inspection verb. The one
 * strictness it has is the valueless flag: a value-taking flag without a
 * value ends the call before any state is touched, with the status the
 * baseline's shell gives — 127, not the documented 3 (F119-FR-005; register
 * row B-0235; CQ-098; research decision 8).
 */
import { existsSync, realpathSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** The exit of a value-taking flag given without a value (F119-FR-005, B-0235). */
export const VALUELESS_FLAG_EXIT = 127 as const;

/** The value-taking flags of every inspection verb (F119-FR-007). */
export const INSPECT_FLAGS_WITH_VALUE: readonly string[] = Object.freeze([
  "-w",
  "--workdir",
  "-s",
  "--specs",
  "--feature",
]);

/** The flags without a value every inspection verb takes (F119-FR-007). */
export const INSPECT_FLAGS_WITHOUT_VALUE: readonly string[] = Object.freeze([
  "--all",
  "-f",
  "--follow",
  "--json",
  "--verbose",
  "-h",
  "--help",
]);

/** The error a value-taking flag without a value raises. */
export class ValuelessFlagError extends Error {
  /** The flag that was given without its value. */
  readonly flag: string;
  constructor(flag: string) {
    super(`the flag ${flag} takes a value and was given none`);
    this.name = "ValuelessFlagError";
    this.flag = flag;
  }
}

/** What the parser read out of one inspection call. */
export type InspectArgs = {
  /** `-w DIR` / `--workdir DIR`; `undefined` means the current directory. */
  readonly workdir: string | undefined;
  /** `-s SPEC` / `--specs SPEC`; the spec is explicit when this is set. */
  readonly spec: string | undefined;
  /** `--feature SLUG`, before sanitizing. */
  readonly feature: string | undefined;
  readonly all: boolean;
  readonly follow: boolean;
  readonly json: boolean;
  readonly verbose: boolean;
  /** `-h` / `--help` anywhere after the verb (F119-FR-004). */
  readonly help: boolean;
  /** Every other argument, in order; the first is the positional `N`/mode. */
  readonly extras: readonly string[];
};

/** F119-FR-007 — read the arguments of one inspection verb. */
export function parseInspectArgs(argv: readonly string[]): InspectArgs {
  let workdir: string | undefined;
  let spec: string | undefined;
  let feature: string | undefined;
  let all = false;
  let follow = false;
  let json = false;
  let verbose = false;
  let help = false;
  const extras: string[] = [];
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] as string;
    const equal = arg.startsWith("--") && arg.includes("=") ? arg : undefined;
    const name = equal === undefined ? arg : equal.slice(0, equal.indexOf("="));
    const inline = equal === undefined ? undefined : equal.slice(equal.indexOf("=") + 1);
    if (INSPECT_FLAGS_WITH_VALUE.includes(name)) {
      const value = inline ?? argv[at + 1];
      if (value === undefined) throw new ValuelessFlagError(name);
      if (inline === undefined) at += 1;
      if (name === "-w" || name === "--workdir") workdir = value;
      else if (name === "-s" || name === "--specs") spec = value;
      else feature = value;
      continue;
    }
    if (INSPECT_FLAGS_WITHOUT_VALUE.includes(name)) {
      if (name === "--all") all = true;
      else if (name === "-f" || name === "--follow") follow = true;
      else if (name === "--json") json = true;
      else if (name === "--verbose") verbose = true;
      else help = true;
      continue;
    }
    extras.push(arg);
  }
  return Object.freeze({
    workdir,
    spec,
    feature,
    all,
    follow,
    json,
    verbose,
    help,
    extras: Object.freeze(extras),
  });
}

/** The first positional argument (`N` or the mode), when one was given. */
export function firstExtra(args: InspectArgs): string | undefined {
  return args.extras[0];
}

/** The first positional argument as a phase number, when it is one. */
export function phaseNumberArg(args: InspectArgs): number | undefined {
  const first = firstExtra(args);
  if (first === undefined) return undefined;
  const value = Number(first);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * F119-FR-008 — a feature slug outside `A-Za-z0-9._-` is sanitized, never
 * rejected: every character outside the set becomes `-`, and leading and
 * trailing `-` are trimmed.
 */
export function sanitizeFeature(slug: string): string {
  return slug.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * F119-FR-008 — the working directory made physical. A path that cannot be
 * made physical keeps its raw value: the later check of the state reports it
 * (F119-FR-008). The DIRECTORY check of the engine call is the stricter one
 * of F119-FR-006 and lives in `engine-args.ts`.
 */
export function resolveWorkdir(raw: string | undefined, cwd: string): string {
  const base = raw ?? cwd;
  try {
    return realpathSync(base);
  } catch {
    return base;
  }
}

/**
 * F119-FR-008 — the feature, in the order of the requirement: `--feature`
 * (sanitized), then the feature of the last run recorded for the workspace,
 * then `default`.
 */
export const DEFAULT_FEATURE = "default" as const;

/** The feature of the newest run recorded for the workspace, when one is. */
export function featureOfTheLastRun(stateDir: string): string | undefined {
  const features = join(stateDir, "features");
  let dirs: string[];
  try {
    dirs = readdirSync(features);
  } catch {
    return undefined;
  }
  let newest: { readonly slug: string; readonly at: number } | undefined;
  for (const slug of dirs) {
    const runs = join(features, slug, "runs");
    let entries: string[];
    try {
      entries = readdirSync(runs);
    } catch {
      continue;
    }
    for (const run of entries) {
      const snapshot = join(runs, run, "snapshot");
      try {
        const at = statSync(snapshot).mtimeMs;
        if (newest === undefined || at > newest.at) newest = { slug, at };
      } catch {
        continue;
      }
    }
  }
  if (newest === undefined) return undefined;
  try {
    const text = readFileSync(
      join(features, newest.slug, "runs", runName(newest.slug, features), "snapshot"),
      "utf8",
    );
    const line = text.split("\n").find((row) => row.startsWith("FEATURE="));
    return line === undefined ? undefined : line.slice("FEATURE=".length).trim() || undefined;
  } catch {
    return undefined;
  }
}

function runName(slug: string, features: string): string {
  const runs = join(features, slug, "runs");
  let newest: { readonly name: string; readonly at: number } | undefined;
  for (const name of readdirSync(runs)) {
    try {
      const at = statSync(join(runs, name)).mtimeMs;
      if (newest === undefined || at > newest.at) newest = { name, at };
    } catch {
      continue;
    }
  }
  return newest === undefined ? "" : newest.name;
}

/** F119-FR-008 — resolve the feature of one inspection call. */
export function resolveFeature(args: InspectArgs, stateDir: string): string {
  if (args.feature !== undefined) return sanitizeFeature(args.feature);
  return featureOfTheLastRun(stateDir) ?? DEFAULT_FEATURE;
}

/**
 * F119-FR-008 — resolve the spec. A relative `-s` path is resolved against
 * the directory the command was LAUNCHED from, never against the working
 * directory. Without `-s` the spec is `SPECS.md` in the working directory;
 * when that does not exist, the spec named in the settings of the newest run
 * recorded for the workspace (`SPECS=` in its snapshot), when that file
 * exists.
 */
export function resolveSpec(
  args: InspectArgs,
  options: {
    readonly workdir: string;
    readonly launchDir: string;
    readonly stateDir: string;
  },
): string {
  if (args.spec !== undefined) return resolve(options.launchDir, args.spec);
  const inWorkdir = join(options.workdir, "SPECS.md");
  if (existsSync(inWorkdir)) return inWorkdir;
  const fromRun = specOfTheLastRun(options.stateDir);
  if (fromRun !== undefined && existsSync(fromRun)) return fromRun;
  return inWorkdir;
}

function specOfTheLastRun(stateDir: string): string | undefined {
  const features = join(stateDir, "features");
  let dirs: string[];
  try {
    dirs = readdirSync(features);
  } catch {
    return undefined;
  }
  let newest: { readonly path: string; readonly at: number } | undefined;
  for (const slug of dirs) {
    const runs = join(features, slug, "runs");
    let entries: string[];
    try {
      entries = readdirSync(runs);
    } catch {
      continue;
    }
    for (const run of entries) {
      const snapshot = join(runs, run, "snapshot");
      try {
        const at = statSync(snapshot).mtimeMs;
        if (newest === undefined || at > newest.at) newest = { path: snapshot, at };
      } catch {
        continue;
      }
    }
  }
  if (newest === undefined) return undefined;
  try {
    const text = readFileSync(newest.path, "utf8");
    const line = text.split("\n").find((row) => row.startsWith("SPECS="));
    const value = line === undefined ? "" : line.slice("SPECS=".length).trim();
    return value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}
