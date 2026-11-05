/**
 * T012 — detection of the Claude harness (F125-FR-001, F125-FR-003).
 *
 * Detection makes no model call and opens no credential store: it resolves
 * the `claude` executable to an ABSOLUTE path on the consumer's real search
 * path, reads the version from the executable's own `--version` output, and
 * reports whether a configuration home exists.
 *
 * Refusals (F125-FR-001, as F109-FR-020 states them for every harness):
 *   - an executable INSIDE the workspace is refused;
 *   - an executable in a directory that everyone may write is refused;
 *   - an executable not on the search path fails with the result code 127.
 *
 * A path that changed since the last run gives a warning, never a refusal
 * (F100-FR-080). The state of a harness in the tested range is `tested`
 * (pin claude 2.1.284, floor 2.1.259, verified-on 2026-09-29).
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** The pin of the tested range (contracts/argument-table.md). */
export const CLI_PIN = "2.1.284" as const;
/** The floor of the tested range: the first version with `--permission-prompts`. */
export const CLI_FLOOR = "2.1.259" as const;
/** The floor that applies only when the restricted mode is used (F125-FR-003). */
export const CLI_RESTRICTED_FLOOR = "2.1.248" as const;
/** The date the pin was verified on. */
export const VERIFIED_ON = "2026-09-29" as const;
/** The harness state recorded at launch for a version in the tested range. */
export const HARNESS_STATE = "tested" as const;

/** The result code of a pass whose executable is not on the search path. */
export const EXECUTABLE_NOT_FOUND_CODE = 127;

/** Why a resolved executable was refused. */
export type DetectRefusalReason = "inside-workspace" | "world-writable-directory";

/** One directory of the search path, with what detection needs of it. */
export type PathDir = {
  readonly path: string;
  /** Whether the directory is writable by everyone (mode & 0o002). */
  readonly worldWritable: boolean;
};

/** The outcome of detection. */
export type DetectOutcome =
  | {
      readonly ok: true;
      /** The resolved absolute path of the executable. */
      readonly executablePath: string;
      /** The version as the executable itself reports it, or null. */
      readonly version: string | null;
      /** Whether a configuration home exists. */
      readonly homePresent: boolean;
      /** The configuration home that was probed. */
      readonly configHome: string;
      /** The harness state recorded at launch. */
      readonly state: typeof HARNESS_STATE;
      /** The warning for a path that changed since the last run, if any. */
      readonly changedPathWarning: string | null;
    }
  | { readonly ok: false; readonly resultCode: 127; readonly message: string }
  | {
      readonly ok: false;
      readonly refusal: DetectRefusalReason;
      readonly message: string;
    };

/** The pieces of the world detection reads; every one is injectable for tests. */
export type DetectDependencies = {
  /** The consumer's real search path, before any overlay variable. */
  readonly pathVariable: string;
  /** The root of the workspace; an executable inside it is refused. */
  readonly workspaceRoot: string | null;
  /** Stats one directory of the search path; null when it does not exist. */
  readonly statDir?: (dir: string) => { worldWritable: boolean } | null;
  /** Whether a candidate exists and is executable in a directory. */
  readonly existsInDir?: (dir: string, name: string) => boolean;
  /** Reads the version of an executable; null when the probe does not answer. */
  readonly readVersion?: (executablePath: string) => string | null;
  /** Whether a path exists (the configuration home). */
  readonly pathExists?: (p: string) => boolean;
  /** The consumer's home directory. */
  readonly home?: string;
  /** The value of `CLAUDE_CONFIG_DIR`, where the consumer set one. */
  readonly configDirVariable?: string | null;
  /** The absolute path recorded on the last run, if any. */
  readonly previousPath?: string | null;
};

/** True when `candidate` lies inside `directory` (both absolute). */
function inside(candidate: string, directory: string): boolean {
  const c = path.resolve(candidate);
  const d = path.resolve(directory);
  if (d === path.parse(d).root) return c.startsWith(d);
  return c === d || c.startsWith(d + path.sep);
}

/** Splits a search path into its directories, in order. */
export function searchPathDirs(pathVariable: string): readonly string[] {
  return pathVariable.split(path.delimiter).filter((dir) => dir !== "");
}

/** Whether a directory is writable by everyone (mode & 0o002). */
export function dirIsWorldWritable(dir: string): boolean {
  try {
    return (statSync(dir).mode & 0o002) !== 0;
  } catch {
    return false;
  }
}

/**
 * Resolves the `claude` executable to an absolute path on the given search
 * path, and refuses the two refused placements (F125-FR-001).
 */
export function resolveClaudeExecutable(
  deps: DetectDependencies,
):
  | { ok: true; executablePath: string; changedPathWarning: string | null }
  | { ok: false; resultCode: 127; message: string }
  | { ok: false; refusal: DetectRefusalReason; message: string } {
  const existsInDir =
    deps.existsInDir ?? ((dir: string, name: string) => existsSync(path.join(dir, name)));
  const statDir =
    deps.statDir ??
    ((dir: string) => (existsSync(dir) ? { worldWritable: dirIsWorldWritable(dir) } : null));

  for (const dir of searchPathDirs(deps.pathVariable)) {
    if (!existsInDir(dir, "claude")) continue;
    const candidate = path.resolve(dir, "claude");
    if (deps.workspaceRoot !== null && inside(candidate, deps.workspaceRoot)) {
      return {
        ok: false,
        refusal: "inside-workspace",
        message:
          `refused the resolved claude executable "${candidate}": it is inside the ` +
          `workspace "${path.resolve(deps.workspaceRoot)}" (F125-FR-001)`,
      };
    }
    const info = statDir(dir);
    if (info !== null && info.worldWritable) {
      return {
        ok: false,
        refusal: "world-writable-directory",
        message:
          `refused the resolved claude executable "${candidate}": its directory ` +
          `"${dir}" is writable by everyone (F125-FR-001)`,
      };
    }
    const changedPathWarning =
      deps.previousPath !== undefined &&
      deps.previousPath !== null &&
      deps.previousPath !== candidate
        ? `the claude executable moved from "${deps.previousPath}" to "${candidate}" since the last run (F100-FR-080)`
        : null;
    return { ok: true, executablePath: candidate, changedPathWarning };
  }
  return {
    ok: false,
    resultCode: EXECUTABLE_NOT_FOUND_CODE,
    message: "claude: claude not found (F125-FR-001; result code 127)",
  };
}

/**
 * Reads the version from the executable's own `--version` output: the first
 * line, trimmed. No login, no model call. Null when the probe does not answer.
 */
export function readClaudeVersion(executablePath: string): string | null {
  const result = spawnSync(executablePath, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) return null;
  const line = `${result.stdout}`.split("\n")[0]?.trim();
  return line === undefined || line === "" ? null : line;
}

/**
 * The configuration home of the harness: `CLAUDE_CONFIG_DIR` where the
 * consumer set it, else `<home>/.claude`.
 */
export function claudeConfigHome(input: {
  home: string;
  configDirVariable: string | null;
}): string {
  return input.configDirVariable !== null && input.configDirVariable !== ""
    ? path.resolve(input.configDirVariable)
    : path.join(input.home, ".claude");
}

/** True when `version` lies in the tested range [2.1.259, 2.1.284]. */
export function versionIsInRange(version: string): boolean {
  const numbers = (v: string): readonly number[] =>
    v
      .replace(/^claude\s*/i, "")
      .trim()
      .split(/[.-]/)
      .map((part) => Number.parseInt(part, 10))
      .map((n) => (Number.isNaN(n) ? 0 : n));
  const compare = (a: readonly number[], b: readonly number[]): number => {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  };
  const v = numbers(version);
  return (
    compare(CLI_FLOOR.split(".").map(Number), v) <= 0 &&
    compare(v, CLI_PIN.split(".").map(Number)) <= 0
  );
}

/**
 * Detects the Claude harness (F125-FR-001): resolution, version, home
 * presence. Records the harness state `tested` for a version in the range.
 */
export function detectClaude(deps: DetectDependencies): DetectOutcome {
  const resolved = resolveClaudeExecutable(deps);
  if (!resolved.ok) return resolved;
  const readVersion = deps.readVersion ?? readClaudeVersion;
  const version = readVersion(resolved.executablePath);
  const home = deps.home ?? homedir();
  const configHome = claudeConfigHome({ home, configDirVariable: deps.configDirVariable ?? null });
  const pathExists = deps.pathExists ?? existsSync;
  return {
    ok: true,
    executablePath: resolved.executablePath,
    version,
    homePresent: pathExists(configHome),
    configHome,
    state: HARNESS_STATE,
    changedPathWarning: resolved.changedPathWarning,
  };
}

/* ------------------------------------------------------------------ *
 * T071/CT-125-3 — capability list before the version comparison, and the
 * hidden flags gated by the version floor (F125-FR-003).
 * ------------------------------------------------------------------ */

/**
 * The flags the help of the pinned CLI does not list (documented and hidden,
 * F125-FR-003). Capability detection cannot find them by parsing help, so a
 * version floor and the capability list of the initial record decide.
 */
export const HIDDEN_FLAGS = ["--max-turns", "--system-prompt-file"] as const;
export type HiddenFlag = (typeof HIDDEN_FLAGS)[number];

/** True when the flag is one of the hidden flags the floor gates. */
export function hiddenFlagIsGatedByFloor(flag: string): boolean {
  return (HIDDEN_FLAGS as readonly string[]).includes(flag);
}

/** Why the availability of a flag was decided (F125-FR-003). */
export type FlagDecisionBasis =
  /** The capability list of the initial record (present from 2.1.205). */
  | "capability-list"
  /** No capability list: the version floor decided. */
  | "version-floor"
  /** No version recorded: nothing was compared. */
  | "no-record";

/** The availability of one flag, as F125-FR-003 decides it. */
export type FlagAvailability = {
  readonly available: boolean;
  readonly decidedBy: FlagDecisionBasis;
};

/** True when `version` is at or above `floor` (numeric, component by component). */
export function versionAtFloor(version: string, floor: string): boolean {
  const numbers = (v: string): readonly number[] =>
    v
      .replace(/^claude\s*/i, "")
      .trim()
      .split(/[.-]/)
      .map((part) => Number.parseInt(part, 10))
      .map((n) => (Number.isNaN(n) ? 0 : n));
  const a = numbers(version);
  const b = numbers(floor);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * The availability of a flag (F125-FR-003): the capability list of the
 * initial record is preferred over any comparison of versions, and only
 * where no capability list exists does the version floor decide. With no
 * recorded version and no capability list, nothing was compared — the floor
 * is checked by detection before a call is built, so this is not a refusal.
 */
export function flagAvailability(input: {
  readonly flag: string;
  /** The recorded version of the executable, or null. */
  readonly version: string | null;
  /** The capability list of the initial record, or null when it had none. */
  readonly capabilityList: readonly string[] | null;
}): FlagAvailability {
  if (input.capabilityList !== null) {
    return {
      available: input.capabilityList.includes(input.flag),
      decidedBy: "capability-list",
    };
  }
  if (input.version === null) return { available: true, decidedBy: "no-record" };
  return {
    available: versionAtFloor(input.version, CLI_FLOOR),
    decidedBy: "version-floor",
  };
}

/* ------------------------------------------------------------------ *
 * T054 — the containment ceiling and the concurrentSessions capability
 * (F125-FR-019).
 * ------------------------------------------------------------------ */

/** The provenance of the containment ceiling: always `adapter` here. */
export const CONTAINMENT_PROVENANCE = "adapter" as const;

/** The closed set of the containment levels (annex C). */
export const CONTAINMENT_LEVELS = ["C1", "C2"] as const;
export type ContainmentLevel = (typeof CONTAINMENT_LEVELS)[number];

/** The containment ceiling as detection states it (F125-FR-019). */
export type ContainmentCeiling = {
  readonly ceiling: ContainmentLevel;
  readonly provenance: typeof CONTAINMENT_PROVENANCE;
  /** The observed fact the ceiling rests on. */
  readonly basis: string;
};

/**
 * The containment ceiling (F125-FR-019): C2 where the platform offers the
 * sandbox of the harness for shell commands, else C1, with the provenance
 * `adapter`. The harness adapter NEVER asserts a sandbox by itself: the
 * ceiling follows what the platform offers, as the doctor observes it —
 * the adapter's own claim is never the observation.
 */
export function containmentCeiling(input: {
  /** Whether the platform offers the harness's command sandbox (observed). */
  readonly sandboxOfferedByPlatform: boolean;
}): ContainmentCeiling {
  return Object.freeze(
    input.sandboxOfferedByPlatform
      ? {
          ceiling: "C2",
          provenance: CONTAINMENT_PROVENANCE,
          basis:
            "the platform offers the sandbox of the harness for shell commands, " +
            "as the doctor observes it (F125-FR-019)",
        }
      : {
          ceiling: "C1",
          provenance: CONTAINMENT_PROVENANCE,
          basis:
            "the platform offers no sandbox for shell commands, so the ceiling is " +
            "the process group of the port (F125-FR-019)",
        },
  );
}

/** The capability `concurrentSessions` as detection states it (F125-FR-019). */
export type ConcurrentSessionsCapability = {
  /** The descriptor field: null until capture B, never guessed. */
  readonly concurrentSessions: null;
  readonly status: "unverified";
  readonly decidedBy: string;
};

/**
 * The capability `concurrentSessions` (F125-FR-019): null (`unverified`)
 * until capture B shows that several headless processes may run under one
 * configuration home and one login with separate session stores. No value
 * is guessed (data-model: a value not established is null with no guess).
 */
export function concurrentSessionsCapability(): ConcurrentSessionsCapability {
  return Object.freeze({
    concurrentSessions: null,
    status: "unverified",
    decidedBy:
      "fixture capture B (packages/adapter-claude/test/fixtures/" +
      "capture-b-concurrent-sessions.md), unverified (F125-FR-019)",
  });
}

/** Why parallel units are off for this harness (F125-FR-019). */
export type ParallelUnitsSetting = {
  readonly enabled: false;
  readonly reason: string;
};

/**
 * Parallel units are OFF for this harness at auth tier 1, with the reason
 * stated (F125-FR-019): `concurrentSessions` is null until capture B.
 */
export function parallelUnitsSetting(): ParallelUnitsSetting {
  return Object.freeze({
    enabled: false,
    reason:
      "parallel units are off: the capability concurrentSessions is null " +
      "(unverified) until fixture capture B shows that several headless " +
      "processes may run under one configuration home and one login with " +
      "separate session stores (F125-FR-019)",
  });
}
