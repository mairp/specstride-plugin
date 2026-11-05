/**
 * T013 — the detection of dsh: presence, version, pin, home (F130-FR-002).
 *
 * Detection establishes presence, version and the existence of the
 * configuration home FREE OF CHARGE, with the version command of the harness
 * (`--version`) and nothing that changes state. The executable is resolved to
 * an absolute path with the consumer's real search path, BEFORE any overlay
 * variable is applied, and recorded with its version (F100-FR-080) — the
 * resolution itself is the one of the harness seam
 * (`resolveExecutable` of `@specstride/harness`), so the refusals inside the
 * workspace and in a world-writable directory, and the 127, are the seam's
 * own; the only dsh part is the as-is message of the not-found arm
 * (`DeepSeek Harness not found: <bin>`, descriptor `invoke.proposer.notFound`).
 *
 * The pin is the EXACT version `0.1.0-rc.8`, verified-on 2026-09-29; no range
 * is accepted. For a version other than the pin the doctor warns for the
 * proposer role and fails for the critic role (F130-FR-002, F130-FR-025).
 * Each pass records the harness version; a change of version between two
 * passes of one run is a warning. Nothing is downloaded to reach a pin.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveExecutable, searchDirsFromPath } from "@specstride/harness";

/** Why a resolved executable is refused (F100-FR-080; the seam's closed set). */
export type ExecutableRefusalReason = "inside-workspace" | "world-writable-directory";
import { DSH_PIN, DSH_VERIFIED_ON } from "../descriptor/data.ts";

export { DSH_PIN, DSH_VERIFIED_ON };

/** The name the executable is looked up under: the as-is command. */
export const DSH_BIN = "dsh" as const;

/** The version command of the harness (free of charge; nothing changes state). */
export const DSH_VERSION_FLAG = "--version" as const;

/** The variable of the configuration home, and its default (descriptor `detect`). */
export const DSH_HOME_VARIABLE = "DSH_HOME" as const;
export const DSH_DEFAULT_HOME = ".dsh" as const;

/** The as-is not-found message of the proposer arm. */
export const DSH_NOT_FOUND_PREFIX = "DeepSeek Harness not found" as const;

/** The roles the pin check distinguishes (F130-FR-002: warn for proposer, fail for critic). */
export type DshRole = "proposer" | "critic";

/** The pin states of an installed version (closed set). */
export type DshPinState = "pin" | "warn" | "fail";

/**
 * The pin state of VERSION for ROLE: the exact pin is `pin`; any other
 * version warns for the proposer and FAILS for the critic (F130-FR-002), and
 * a critic failure is launch-blocking where this harness is the critic
 * (F130-FR-025).
 */
export function dshPinState(version: string | null, role: DshRole): DshPinState {
  if (version === DSH_PIN) return "pin";
  return role === "critic" ? "fail" : "warn";
}

/**
 * The warning for a change of version between two passes of one run
 * (F130-FR-002): non-null exactly where both versions are recorded and differ.
 */
export function dshVersionChangeWarning(
  previous: string | null,
  current: string | null,
): string | null {
  if (previous === null || current === null || previous === current) return null;
  return (
    `dsh: the harness version changed during the run: ${previous} -> ${current}; ` +
    `the pin is ${DSH_PIN}`
  );
}

/** The version record of ONE pass (F130-FR-002: each pass records the version). */
export type DshVersionRecord = {
  /** The resolved absolute path of the executable, where it was resolved. */
  readonly path: string | null;
  /** The version the `--version` command printed, where it answered. */
  readonly version: string | null;
  readonly pin: typeof DSH_PIN;
  readonly pinState: DshPinState;
  /** Always true: the record exists exactly to carry the version per pass. */
  readonly recordedOnPass: true;
};

/** Records the version of one pass, with the pin state of the role in use. */
export function dshVersionRecord(input: {
  readonly path: string | null;
  readonly version: string | null;
  readonly role: DshRole;
}): DshVersionRecord {
  return {
    path: input.path,
    version: input.version,
    pin: DSH_PIN,
    pinState: dshPinState(input.version, input.role),
    recordedOnPass: true,
  };
}

/** The state of the configuration home, established free of charge. */
export type DshHomeState = {
  readonly variable: typeof DSH_HOME_VARIABLE;
  /** The absolute path of the home: DSH_HOME, else the default under the real home. */
  readonly path: string;
  readonly exists: boolean;
  readonly readable: boolean;
};

/** Reads the state of the configuration home without writing anything. */
export function dshHomeState(home?: string): DshHomeState {
  const path = home ?? process.env.DSH_HOME ?? join(homedir(), DSH_DEFAULT_HOME);
  let exists = false;
  let readable = false;
  try {
    exists = existsSync(path);
    if (exists) {
      accessSync(path, constants.R_OK);
      readable = true;
    }
  } catch {
    readable = false;
  }
  return { variable: DSH_HOME_VARIABLE, path, exists, readable };
}

/** The outcome of the detection of dsh. */
export type DshDetection =
  | {
      readonly ok: true;
      readonly bin: typeof DSH_BIN;
      /** The resolved ABSOLUTE path (F100-FR-080). */
      readonly path: string;
      readonly version: string | null;
      readonly pin: typeof DSH_PIN;
      readonly pinState: DshPinState;
      readonly home: DshHomeState;
      /** The record of this detection, as a pass records it. */
      readonly record: DshVersionRecord;
    }
  | { readonly ok: false; readonly code: 127; readonly message: string }
  | { readonly ok: false; readonly refusal: ExecutableRefusalReason; readonly message: string };

export type DshDetectInput = {
  /** The real search path, before any overlay variable is applied. */
  readonly path?: string;
  /** Override of the binary name (a test names its stub). */
  readonly bin?: string;
  /** Override of the configuration home (a test names its fixture home). */
  readonly home?: string;
  /** The root of the workspace; an executable inside it is refused (F100-FR-080). */
  readonly workspaceRoot?: string | null;
  /** The absolute path recorded on the last run, for the path-change warning. */
  readonly previousPath?: string | null;
  /** The role in use, for the pin state (`proposer` when not given). */
  readonly role?: DshRole;
  /** Injection point for tests: whether NAME exists in DIR. */
  readonly exists?: (dir: string, name: string) => boolean;
  /** Injection point for tests: the version of the executable at PATH. */
  readonly probeVersion?: (path: string) => string | null;
};

/**
 * The default version probe: run `<path> --version` with standard input
 * closed and a time limit, read the first line of standard output, change no
 * state. Free of charge; no download, no credential store, no model call.
 */
export function probeDshVersion(path: string): string | null {
  const run = spawnSync(path, [DSH_VERSION_FLAG], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 10_000,
    shell: false,
  });
  if (run.status !== 0 || typeof run.stdout !== "string") return null;
  const first = run.stdout.split("\n", 1)[0]?.trim();
  return first === undefined || first === "" ? null : first;
}

/** Whether DIR is a directory everyone may write (mode & 0o002), for the resolver. */
function worldWritable(dir: string): boolean {
  try {
    return (statSync(dir).mode & 0o002) !== 0;
  } catch {
    return false;
  }
}

/**
 * F130-FR-002 — detects dsh: resolves the executable to an absolute path,
 * reads its version with `--version`, checks the pin and the home. Not found:
 * result code 127 with the as-is message. Found: the detection record with the
 * version record of the pass.
 */
export function detectDsh(input: DshDetectInput = {}): DshDetection {
  const bin = input.bin ?? DSH_BIN;
  const role = input.role ?? "proposer";
  const probe = input.probeVersion ?? probeDshVersion;
  const dirs = searchDirsFromPath(input.path ?? process.env.PATH ?? "", worldWritable);
  const resolved = resolveExecutable(bin, {
    dirs,
    exists: input.exists,
    workspaceRoot: input.workspaceRoot ?? null,
    previousPath: input.previousPath ?? null,
    probeVersion: probe,
    component: "dsh",
  });
  if (!resolved.ok) {
    if ("resultCode" in resolved) {
      return {
        ok: false,
        code: 127,
        message: `${DSH_NOT_FOUND_PREFIX}: ${bin}`,
      };
    }
    return { ok: false, refusal: resolved.refusal, message: resolved.message };
  }
  const version = resolved.version;
  const record = dshVersionRecord({ path: resolved.path, version, role });
  return {
    ok: true,
    bin: DSH_BIN,
    path: resolved.path,
    version,
    pin: DSH_PIN,
    pinState: record.pinState,
    home: dshHomeState(input.home),
    record,
  };
}
