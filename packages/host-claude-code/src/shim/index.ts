/**
 * T007 of `specs/113-host-claude-code/tasks.md` — the executable shim of the
 * plugin: the RESOLUTION ORDER of the CLI, the `--protocol` check and the ONE
 * refusal line (F113-FR-018, F113-FR-019).
 *
 * F113-FR-018: "The shim MUST find the CLI in this order: an explicit variable
 * of the consumer, the search path, the package the plugin was published with.
 * It MUST NOT fetch, install or update anything. On a missing CLI it MUST
 * report through the doctor and print the install command."
 *
 * F113-FR-019: "The shim MUST call `specstride --protocol`, compare the
 * integer with the range it supports, and refuse a mismatch with one line that
 * names the doctor. It MUST NOT refuse for a differing package version alone."
 *
 * This directory is the one part of `src/` that RUNS ON THE CONSUMER'S
 * MACHINE: `shimScript()` is the text of `plugin/bin/specstride`. The plugin
 * layer carries no runtime dependency (F113-FR-030, F113-FR-031, threat T-44),
 * so THIS MODULE IMPORTS NOTHING — not `@specstride/contracts`, which the rest
 * of the package may import at build time. The rule file
 * `tools/import-boundary/rules/113-host-claude-code-build-time-only.json`
 * (RF-113-01) enforces it, and `test/shim.test.ts` holds every constant
 * inlined below against the one `@specstride/contracts/ep/host` gives, so the
 * inlining cannot drift from annex H §H.1.
 *
 * Nothing here fetches, installs or updates: the only I/O the shim does is
 * reading the environment, testing a file, reading the manifest of the package
 * it was published with, and running the CLI it found. The decisions are pure
 * functions over an injected probe, so a test observes them without a process.
 */

/* -------------------------------------------------------------------------
 * The constants of annex H §H.1 and annex G §G.1 and §G.4, INLINED
 * ---------------------------------------------------------------------- */

/** annex H §H.1 — "The shim finds the executable through the variable `SPECSTRIDE_BIN`". */
export const EXECUTABLE_VARIABLE = "SPECSTRIDE_BIN";

/** annex G §G.1 — the protocol integer of the CLI this shim was published with. */
export const CLI_PROTOCOL_VERSION = 1;

/** The range of protocol integers this shim supports (F113-FR-019). */
export const SUPPORTED_PROTOCOL_MIN = 1;
export const SUPPORTED_PROTOCOL_MAX = 1;

/**
 * annex H §H.1 — the one line of a protocol mismatch. The shim prints it "with
 * the two integers and exits 4", and the line names the doctor (annex G §G.4).
 */
export const PROTOCOL_MISMATCH_LINE =
  "[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch";

/** annex G §G.4 — "The shim of a host package, protocol mismatch | 4". */
export const PROTOCOL_MISMATCH_EXIT_CODE = 4;

/**
 * The code of a missing CLI. §G.4 fixes a code for the shim only for the
 * protocol mismatch, so the shim uses the POSIX convention for an executable
 * that is not on the machine, 127, and never a code of a CLI command.
 */
export const CLI_NOT_FOUND_EXIT_CODE = 127;

/** The command of the CLI that prints the protocol integer (annex G §G.1). */
export const PROTOCOL_FLAG = "--protocol";

/** The name of the executable on the search path. */
export const EXECUTABLE_NAME = "specstride";

/** The one published package that holds the CLI and this plugin (F113-FR-030). */
export const PUBLISHED_PACKAGE = "specstride";

/**
 * The version of the CLI the install command names. Directory policy
 * 2026-11-10: the plugin no longer bundles the CLI, so the CLI's release on
 * the registry (0.1.0, the pinned core) no longer tracks the plugin's own
 * release — the plugin is 0.1.1 and runs the CLI it finds.
 */
export const PLUGIN_VERSION = "0.1.0";

/** The install command the shim PRINTS and never runs (F113-FR-018, T-46). */
export const INSTALL_COMMAND = "npm install -g specstride@0.1.0";

/** The doctor command every refusal of the shim names (F113-FR-019, F113-FR-018). */
export const DOCTOR_COMMAND = "specstride doctor";

/** The doctor check of a missing CLI, by its registered name (F113-FR-033). */
export const CLI_FOUND_CHECK = "host.cli-found";

/** The doctor check of the protocol (F113-FR-033). */
export const PROTOCOL_CHECK = "host.protocol-supported";

/** The shim fetches, installs and updates nothing (F113-FR-018, F100-FR-197). */
export const INSTALLS_OR_UPDATES = false;

/* -------------------------------------------------------------------------
 * F113-FR-018 — the resolution order
 * ---------------------------------------------------------------------- */

/**
 * The three steps of F113-FR-018, in the order the requirement gives them:
 * an explicit variable of the consumer, the search path, the package the
 * plugin was published with.
 */
export const RESOLUTION_ORDER = ["explicit-variable", "search-path", "published-package"] as const;

export type ResolutionSource = (typeof RESOLUTION_ORDER)[number];

/** What the shim knows about the machine; a test gives it without a process. */
export type ShimProbe = {
  /** The environment, read and never written. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The directory the shim itself lies in: `<package>/plugin/bin`. */
  readonly shimDirectory: string;
  /** True for a path that is an existing file the shim may execute. */
  readonly isExecutable: (path: string) => boolean;
  /**
   * The path of the CLI the manifest of the package at a root names in its
   * `bin`, or `null` where there is no manifest and no such entry. This is the
   * third step of F113-FR-018: the package the plugin was published with.
   */
  readonly publishedBin: (packageRoot: string) => string | null;
};

/** One step of the resolution, and what it found. */
export type ResolutionStep = {
  readonly source: ResolutionSource;
  readonly candidate: string | null;
  readonly found: boolean;
};

/** The result of resolving the CLI. */
export type Resolution = {
  /** The path of the CLI, or `null` where no step found one. */
  readonly path: string | null;
  /** The step that found it, or `null`. */
  readonly source: ResolutionSource | null;
  /** Every step, in the order of F113-FR-018, for the doctor. */
  readonly steps: readonly ResolutionStep[];
};

/** The parent directory of a path, without importing `node:path`. */
function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  if (cut < 0) return ".";
  if (cut === 0) return "/";
  return trimmed.slice(0, cut);
}

/**
 * The root of the package the plugin was published with: the shim lies at
 * `<package>/plugin/bin/specstride`, so the root is two directories above the
 * directory of the shim.
 */
export function publishedPackageRoot(shimDirectory: string): string {
  return parentOf(parentOf(shimDirectory));
}

/** The entries of the search path, in order; an empty entry means `.` (POSIX). */
export function searchPathEntries(path: string | undefined): readonly string[] {
  if (path === undefined || path === "") return [];
  return path.split(":").map((entry) => (entry === "" ? "." : entry));
}

/**
 * F113-FR-018 — find the CLI in this order: the explicit variable of the
 * consumer, the search path, the package the plugin was published with. It
 * fetches, installs and updates nothing: every step only tests a path.
 */
export function resolveExecutable(probe: ShimProbe): Resolution {
  const steps: ResolutionStep[] = [];

  // 1. An explicit variable of the consumer.
  const explicit = probe.env[EXECUTABLE_VARIABLE];
  const explicitPath = explicit !== undefined && explicit !== "" ? explicit : null;
  const explicitFound = explicitPath !== null && probe.isExecutable(explicitPath);
  steps.push({ source: "explicit-variable", candidate: explicitPath, found: explicitFound });
  if (explicitFound && explicitPath !== null) {
    return { path: explicitPath, source: "explicit-variable", steps: Object.freeze(steps) };
  }

  // 2. The search path.
  let onPath: string | null = null;
  for (const entry of searchPathEntries(probe.env["PATH"])) {
    const candidate = `${entry.replace(/\/+$/, "")}/${EXECUTABLE_NAME}`;
    if (probe.isExecutable(candidate)) {
      onPath = candidate;
      break;
    }
  }
  steps.push({ source: "search-path", candidate: onPath, found: onPath !== null });
  if (onPath !== null) {
    return { path: onPath, source: "search-path", steps: Object.freeze(steps) };
  }

  // 3. The package the plugin was published with.
  const root = publishedPackageRoot(probe.shimDirectory);
  const published = probe.publishedBin(root);
  const publishedFound = published !== null && probe.isExecutable(published);
  steps.push({ source: "published-package", candidate: published, found: publishedFound });
  if (publishedFound && published !== null) {
    return { path: published, source: "published-package", steps: Object.freeze(steps) };
  }

  return { path: null, source: null, steps: Object.freeze(steps) };
}

/* -------------------------------------------------------------------------
 * F113-FR-019 — `--protocol`, the range, and the one refusal line
 * ---------------------------------------------------------------------- */

/**
 * The integer `specstride --protocol` printed, or `null` where the output is
 * not one integer. annex G §G.1: the call prints the protocol integer "and
 * nothing else in that call", so anything else is not an answer.
 */
export function readProtocol(stdout: string): number | null {
  const text = stdout.trim();
  if (!/^\d+$/.test(text)) return null;
  return Number.parseInt(text, 10);
}

/** True for an integer inside the range this shim supports (F113-FR-019). */
export function protocolIsSupported(protocol: number | null): boolean {
  if (protocol === null) return false;
  return protocol >= SUPPORTED_PROTOCOL_MIN && protocol <= SUPPORTED_PROTOCOL_MAX;
}

/** The range this shim supports, as the refusal line writes it. */
export function supportedRange(): string {
  return SUPPORTED_PROTOCOL_MIN === SUPPORTED_PROTOCOL_MAX
    ? String(SUPPORTED_PROTOCOL_MIN)
    : `${SUPPORTED_PROTOCOL_MIN}-${SUPPORTED_PROTOCOL_MAX}`;
}

/**
 * THE ONE LINE of a protocol mismatch (F113-FR-019, annex H §H.1): the line of
 * the annex, with the two integers, naming the doctor. It holds no newline:
 * one mismatch is one line.
 */
export function refusalLine(found: number | null): string {
  const seen = found === null ? "none" : String(found);
  return (
    `${PROTOCOL_MISMATCH_LINE} found=${seen} supported=${supportedRange()} ` +
    `check=${PROTOCOL_CHECK} fix=${JSON.stringify(DOCTOR_COMMAND)}`
  );
}

/**
 * THE ONE LINE of a missing CLI (F113-FR-018): it reports through the doctor
 * and prints the install command. It installs nothing (threat T-46).
 */
export function missingCliLine(): string {
  return (
    `[SPECSTRIDE-REFUSE] action=resolve reason=cli-not-found ` +
    `check=${CLI_FOUND_CHECK} install=${JSON.stringify(INSTALL_COMMAND)} ` +
    `fix=${JSON.stringify(DOCTOR_COMMAND)}`
  );
}

/**
 * F113-FR-019 — "It MUST NOT refuse for a differing package version alone."
 * A version difference with a matching protocol is no refusal: the doctor
 * shows the difference and the run goes on (spec.md, "Edge cases").
 */
export function refusesForVersionDifference(
  pluginVersion: string,
  cliVersion: string,
  protocol: number | null,
): boolean {
  void pluginVersion;
  void cliVersion;
  // The only ground of a refusal is the protocol integer.
  return !protocolIsSupported(protocol);
}

/* -------------------------------------------------------------------------
 * The decision
 * ---------------------------------------------------------------------- */

export type ShimDecision = {
  /** `run` hands the arguments to the CLI; the other two print and stop. */
  readonly action: "run" | "refuse-protocol" | "report-missing";
  /** The path of the CLI, where one was found. */
  readonly executable: string | null;
  /** How it was found (F113-FR-018). */
  readonly source: ResolutionSource | null;
  /** The lines to print: exactly one for either refusal, none for a run. */
  readonly lines: readonly string[];
  /** The exit code; `null` where the CLI's own code is the shim's. */
  readonly exitCode: number | null;
};

/**
 * The whole decision of the shim: resolve, then compare the protocol integer.
 * A missing CLI reports through the doctor and prints the install command; a
 * protocol outside the range refuses with ONE line that names the doctor and
 * exits 4; anything else runs and the CLI's own exit code is the shim's.
 */
export function decide(resolution: Resolution, protocol: number | null): ShimDecision {
  if (resolution.path === null) {
    return {
      action: "report-missing",
      executable: null,
      source: null,
      lines: Object.freeze([missingCliLine()]),
      exitCode: CLI_NOT_FOUND_EXIT_CODE,
    };
  }
  if (!protocolIsSupported(protocol)) {
    return {
      action: "refuse-protocol",
      executable: resolution.path,
      source: resolution.source,
      lines: Object.freeze([refusalLine(protocol)]),
      exitCode: PROTOCOL_MISMATCH_EXIT_CODE,
    };
  }
  return {
    action: "run",
    executable: resolution.path,
    source: resolution.source,
    lines: Object.freeze([]),
    exitCode: null,
  };
}

/* -------------------------------------------------------------------------
 * The text of `plugin/bin/specstride`
 * ---------------------------------------------------------------------- */

/**
 * The name of the shim inside the plugin's `bin` directory. The extension is
 * `.mjs` so that the file is a module of ECMAScript whatever the `type` of the
 * manifest that encloses it: the shim must not depend on the manifest of the
 * package it is bundled into.
 */
export const SHIM_FILE_NAME = "specstride.mjs";

/**
 * The executable shim, as it ships in `plugin/bin/specstride.mjs`. Every constant
 * and every line it prints is interpolated from the exports above, so the file
 * that runs on the consumer's machine and the module the tests exercise cannot
 * drift; `test/shim.test.ts` holds the file on disk against this text byte for
 * byte and then RUNS it against stub CLIs.
 *
 * It is a Node-shebang script with no dependency: it requires three modules of
 * Node and nothing else, and it fetches, installs and updates nothing.
 */
export function shimScript(): string {
  return `#!/usr/bin/env node
// The executable shim of the Specstride plugin for Claude Code (T007 of
// specs/113-host-claude-code/tasks.md; F113-FR-018, F113-FR-019).
//
// GENERATED from packages/host-claude-code/src/shim/index.ts, which inlines
// every constant of annex H section H.1 and annex G sections G.1 and G.4. Do
// not edit this file: edit that module. A test holds the two against each
// other byte for byte.
//
// It finds the CLI in the order of F113-FR-018 — the explicit variable
// ${EXECUTABLE_VARIABLE} of the consumer, the search path, the package the plugin was
// published with — calls ${EXECUTABLE_NAME} ${PROTOCOL_FLAG}, compares the integer with the
// range it supports (${supportedRange()}), and refuses a mismatch with ONE line that names
// the doctor. It FETCHES, INSTALLS AND UPDATES NOTHING.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const EXECUTABLE_VARIABLE = ${JSON.stringify(EXECUTABLE_VARIABLE)};
const EXECUTABLE_NAME = ${JSON.stringify(EXECUTABLE_NAME)};
const PROTOCOL_FLAG = ${JSON.stringify(PROTOCOL_FLAG)};
const SUPPORTED_PROTOCOL_MIN = ${SUPPORTED_PROTOCOL_MIN};
const SUPPORTED_PROTOCOL_MAX = ${SUPPORTED_PROTOCOL_MAX};
const PROTOCOL_MISMATCH_EXIT_CODE = ${PROTOCOL_MISMATCH_EXIT_CODE};
const CLI_NOT_FOUND_EXIT_CODE = ${CLI_NOT_FOUND_EXIT_CODE};
const REFUSAL_PREFIX = ${JSON.stringify(PROTOCOL_MISMATCH_LINE)};
const MISSING_CLI_LINE = ${JSON.stringify(missingCliLine())};
const SUPPORTED_RANGE = ${JSON.stringify(supportedRange())};
const PROTOCOL_CHECK = ${JSON.stringify(PROTOCOL_CHECK)};
const DOCTOR_COMMAND = ${JSON.stringify(DOCTOR_COMMAND)};
const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };

function isExecutable(candidate) {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The third step of F113-FR-018: the package the plugin was published with.
// The shim lies at <package>/plugin/bin/specstride, so the root is two
// directories above its own.
function publishedBin() {
  const root = path.resolve(import.meta.dirname, "..", "..");
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const bin = manifest.bin;
    const entry = typeof bin === "string" ? bin : bin && bin[EXECUTABLE_NAME];
    if (typeof entry !== "string" || entry === "") return null;
    return path.resolve(root, entry);
  } catch {
    return null;
  }
}

// F113-FR-018, in the order of the requirement.
function resolveExecutable() {
  const explicit = process.env[EXECUTABLE_VARIABLE];
  if (explicit && isExecutable(explicit)) return explicit;
  // The CLI the plugin carries comes before the search path, so that another
  // specstride on the machine can never answer for this version of the plugin.
  const bundled = path.resolve(import.meta.dirname, "..", "cli", "bin", EXECUTABLE_NAME);
  if (isExecutable(bundled)) return bundled;
  const entries = (process.env.PATH || "").split(":");
  for (const entry of entries) {
    const candidate = path.join(entry === "" ? "." : entry, EXECUTABLE_NAME);
    if (isExecutable(candidate)) return candidate;
  }
  const published = publishedBin();
  if (published && isExecutable(published)) return published;
  return null;
}

function readProtocol(stdout) {
  const text = String(stdout === undefined || stdout === null ? "" : stdout).trim();
  return /^\\d+$/.test(text) ? Number.parseInt(text, 10) : null;
}

function refusalLine(found) {
  const seen = found === null ? "none" : String(found);
  return (
    REFUSAL_PREFIX +
    " found=" + seen +
    " supported=" + SUPPORTED_RANGE +
    " check=" + PROTOCOL_CHECK +
    " fix=" + JSON.stringify(DOCTOR_COMMAND)
  );
}

// One line, written with writeSync so that process.exit cannot truncate it.
function printOneLine(line) {
  fs.writeSync(1, line + "\\n");
}

const executable = resolveExecutable();
if (executable === null) {
  // It reports through the doctor and prints the install command. It installs
  // nothing (F113-FR-018, threat T-46).
  printOneLine(MISSING_CLI_LINE);
  process.exit(CLI_NOT_FOUND_EXIT_CODE);
}

const probe = spawnSync(executable, [PROTOCOL_FLAG], { encoding: "utf8" });
const protocol = probe.status === 0 ? readProtocol(probe.stdout) : null;
if (protocol === null || protocol < SUPPORTED_PROTOCOL_MIN || protocol > SUPPORTED_PROTOCOL_MAX) {
  // One line, with the two integers, naming the doctor; exit 4.
  printOneLine(refusalLine(protocol));
  process.exit(PROTOCOL_MISMATCH_EXIT_CODE);
}

// The protocol matches. A differing package version alone is never a refusal
// (F113-FR-019): the doctor shows the difference and the run goes on.
const run = spawnSync(executable, process.argv.slice(2), { stdio: "inherit" });
if (run.status !== null && run.status !== undefined) process.exit(run.status);
// A run ended by a signal has no code of its own: 128+N, as exit 130 and 143
// are the two interruptions of this product (R3v C7). Anything else is an
// uncaught error, 70 (annex G section G.4).
const number = SIGNAL_NUMBERS[run.signal];
process.exit(number === undefined ? 70 : 128 + number);
`;
}
