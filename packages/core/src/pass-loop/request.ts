/**
 * T015 of feature 103 — the REQUEST RECORD of the pass loop, its defaults and
 * its usage and set-up failures (F103-FR-001, F103-FR-002).
 *
 * The pass loop is a CALL and not a public command (F100-FR-171): the engine
 * hands it one request record and receives one result record, and no process
 * boundary lies between them. What the baseline carried as the flags of
 * `proposer.sh` is therefore carried as the FIELDS of this record, and what
 * the baseline carried as its exit codes is carried as `exit_code` of the
 * result (divergence DV-066). The shape of both is pinned by
 * `./pass-loop-request.schema.json` and `./pass-loop-result.schema.json`
 * (T003), and this module is their one TypeScript side.
 *
 * Three things live here, and nothing else:
 *
 * | Part | What it is | Requirement |
 * |---|---|---|
 * | the record and its defaults | `PassLoopRequest`, `REQUEST_DEFAULTS`, `applyRequestDefaults` | F103-FR-001 |
 * | the usage text | `usageText`, `USAGE_CODES` | F103-FR-002 |
 * | the usage and set-up failures | `normalizeRequest` and the message builders beside it | F103-FR-002 |
 *
 * ## The raw input and the record are two types, on purpose
 *
 * `PassLoopRequestInput` is what a CALLER hands over: the as-is flags as a
 * record, every field optional, unknown keys possible, a value possibly
 * present without a value (`undefined` where the baseline saw `--flag` with no
 * argument following it). `PassLoopRequest` is what survives normalization:
 * every field of the schema, the absent ones filled with the as-is value, the
 * working directory canonical and the evidence path absolute. The engine never
 * sees a half-checked request, and the failures of F103-FR-002 are all
 * produced in one place.
 *
 * ## The usage text does not list 3
 *
 * F103-FR-002 pins it: the usage text lists 0, 1, 4, 6, 7, 8, 9 and 10 and, as
 * at the baseline, NOT 3 — even though 3 is a result of the loop since ruling
 * K3 (a changed source, F103-FR-021). The omission is as-is behaviour that
 * parity binds, not an oversight, and `USAGE_OMITS_CODE_3` says so where a
 * reader will look.
 *
 * ## What this module does not do
 *
 * It starts no pass, reads no snapshot and writes no event. It touches the
 * file system through `RequestIo` only, and only for the four things
 * F103-FR-002 asks of it: to test the working directory, to test the prompt
 * file, to canonicalize the working directory, and to create the parent
 * directory of the evidence path and the state directory of the feature.
 */
import { isAbsolute, join, resolve } from "node:path";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-001", "F103-FR-002"] as const;

/** F103-FR-001 — the pass loop is a call, not a public command. */
export const IS_A_PUBLIC_COMMAND = false as const;

/** The divergence row that records the entry point kept as a call (DV-066). */
export const DIVERGENCE_ROW = "DV-066" as const;

/** The role of a request (the `role` of the schema). */
export const ROLES = ["proposer", "accelerator"] as const;
export type PassLoopRole = (typeof ROLES)[number];

/** F103-FR-001 — the place for yield artifacts, as the schema pins it. */
export const YIELD_PLACE = "feature:<slug>:outbox" as const;

/* ------------------------------------------------------------------ *
 * The record.
 * ------------------------------------------------------------------ */

/**
 * F103-FR-001 — the request record of one phase attempt, as
 * `./pass-loop-request.schema.json` pins it. A normalized request carries
 * every field: the optional ones hold the as-is value of `REQUEST_DEFAULTS`.
 */
export type PassLoopRequest = {
  /** The working directory, in its canonical form (F103-FR-002). */
  readonly workdir: string;
  /** The path of the phase evidence, absolute (F103-FR-002). */
  readonly evidence: string;
  /** The standing prompt, read once when the phase attempt starts (F103-FR-007). */
  readonly standingPrompt: string;
  /** The id of a harness of the resolved registry; never tested by name. */
  readonly harness: string;
  readonly role: PassLoopRole;
  /** The pass limit; the key `loop.maxIter` (F103-FR-003). */
  readonly passLimit: number;
  /** The pause between passes, in seconds (F103-FR-003). */
  readonly pauseSec: number;
  readonly feature: string;
  readonly phase: number;
  readonly phaseAttempt: number;
  /** The base of the invocation ids, or `undefined` (F103-FR-009). */
  readonly invocationBase?: string | undefined;
  /** The time limit of one pass; the watchdogs are feature 118's. */
  readonly passTimeLimitSec?: number | undefined;
  /** The place for yield artifacts (F103-FR-001). */
  readonly yieldPlace?: typeof YIELD_PLACE | undefined;
  /** The debug switch: retention of the raw prompt and reply (F103-FR-009). */
  readonly debug: boolean;
  /** A request with `help` set returns the usage text and 0 (F103-FR-002). */
  readonly help: boolean;
};

/**
 * What a caller hands over: the as-is flags as a record. Every field is
 * optional, a field may be PRESENT WITHOUT A VALUE (`undefined`), and an
 * unknown key is possible — all three are failures F103-FR-002 names, and
 * telling them apart is why this type is not `Partial<PassLoopRequest>`.
 *
 * `promptFile` is the one field that is not a field of the record: it is the
 * as-is flag `--prompt-file`, and normalization reads the file it names into
 * `standingPrompt`. A caller that has the prompt already hands over
 * `standingPrompt` instead.
 */
export type PassLoopRequestInput = {
  readonly [field: string]: unknown;
};

/**
 * F103-FR-001 — "when a field is absent the as-is value MUST hold". The three
 * the requirement names by value (feature slug `default`, phase 0, phase
 * attempt 1) and the four the schema names by its `default` keyword.
 */
export const REQUEST_DEFAULTS = Object.freeze({
  /** F103-FR-003 — the default pass limit (the as-is `MAX_ITER`). */
  passLimit: 30,
  /** F103-FR-003 — the pause between passes, with no variable for it. */
  pauseSec: 2,
  /** F103-FR-001 — the as-is feature slug of a request without one. */
  feature: "default",
  /** F103-FR-001 — the as-is phase of a request without one. */
  phase: 0,
  /** F103-FR-001 — the as-is phase attempt of a request without one. */
  phaseAttempt: 1,
  debug: false,
  help: false,
});

/** The five fields the schema requires of a request. */
export const REQUIRED_FIELDS = [
  "workdir",
  "evidence",
  "standingPrompt",
  "harness",
  "role",
] as const;

/**
 * Every field the pass loop knows, and the as-is flag of `proposer.sh` each
 * one carries (DV-066). A key outside this table is the failure
 * `unknown arg: <name>` of F103-FR-002.
 */
export const FLAG_OF_FIELD: Readonly<Record<string, string>> = Object.freeze({
  workdir: "--workdir",
  evidence: "--evidence",
  standingPrompt: "--prompt-file",
  promptFile: "--prompt-file",
  harness: "--backend",
  role: "--role",
  passLimit: "--max-iter",
  pauseSec: "--pause",
  feature: "--feature",
  phase: "--phase",
  phaseAttempt: "--attempt",
  invocationBase: "--invocation-base",
  passTimeLimitSec: "--timeout",
  yieldPlace: "--yield-place",
  debug: "--debug",
  help: "--help",
});

/** The fields the pass loop knows, as a set. */
export const KNOWN_FIELDS: readonly string[] = Object.freeze(Object.keys(FLAG_OF_FIELD));

/** True when the pass loop knows the field. */
export function isKnownField(field: string): boolean {
  return Object.prototype.hasOwnProperty.call(FLAG_OF_FIELD, field);
}

/* ------------------------------------------------------------------ *
 * The usage text.
 * ------------------------------------------------------------------ */

/**
 * F103-FR-002 — the codes the usage text lists, in the order it lists them.
 * The result 3 is NOT among them, as at the baseline.
 */
export const USAGE_CODES = [0, 1, 4, 6, 7, 8, 9, 10] as const;

/** F103-FR-002 — the usage text does not list the code 3, as at the baseline. */
export const USAGE_OMITS_CODE_3 = true as const;

/** The meaning the usage text gives each code it lists. */
export const USAGE_CODE_MEANINGS: Readonly<Record<number, string>> = Object.freeze({
  0: "evidence present",
  1: "usage or set-up failure",
  4: "max-iter reached without evidence",
  6: "stop requested",
  7: "consecutive agent errors",
  8: "consecutive passes without progress",
  9: "yield budget or deadline",
  10: "consecutive kills at the pass ceiling",
});

/**
 * F103-FR-002 — the usage text of the pass loop. A request with `help` set
 * returns it with `exit_code` 0; an unknown field returns it with 1.
 */
export function usageText(): string {
  const flags = [
    "  --workdir DIR            working directory of the run (required)",
    "  --evidence FILE          path of the phase evidence (required)",
    "  --prompt-file FILE       file holding the standing prompt (required)",
    "  --backend NAME           harness of the resolved registry (required)",
    "  --role ROLE              proposer | accelerator (required)",
    `  --max-iter N             pass limit (default ${REQUEST_DEFAULTS.passLimit})`,
    `  --pause SEC              pause between passes (default ${REQUEST_DEFAULTS.pauseSec})`,
    `  --feature SLUG           feature slug (default ${REQUEST_DEFAULTS.feature})`,
    `  --phase N                phase number (default ${REQUEST_DEFAULTS.phase})`,
    `  --attempt M              phase attempt (default ${REQUEST_DEFAULTS.phaseAttempt})`,
    "  --invocation-base BASE   base of the invocation ids",
    "  --timeout SEC            time limit of one pass",
    "  --yield-place PLACE      place for yield artifacts",
    "  --debug                  retain the raw prompt and reply of every invocation",
    "  --help                   print this text and exit 0",
  ].join("\n");
  const codes = USAGE_CODES.map(
    (code) => `  ${String(code).padStart(3, " ")}  ${USAGE_CODE_MEANINGS[code]}`,
  ).join("\n");
  return [
    "usage: proposer.sh --workdir DIR --evidence FILE --prompt-file FILE --backend NAME --role ROLE [options]",
    "",
    "options:",
    flags,
    "",
    "exit codes:",
    codes,
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * The failures.
 * ------------------------------------------------------------------ */

/** F103-FR-002 — the as-is message of an empty or non-directory working directory. */
export function workdirRequiredMessage(value: string): string {
  return `--workdir DIR required (got '${value}')`;
}

/** F103-FR-002 — the as-is message of an empty evidence path. */
export function evidenceRequiredMessage(): string {
  return "--evidence FILE required";
}

/** F103-FR-002 — the as-is message of a prompt that is missing or is not a regular file. */
export function promptFileRequiredMessage(value: string): string {
  return `--prompt-file FILE required (got '${value}')`;
}

/** F103-FR-002 — the as-is message of a field the pass loop does not know. */
export function unknownArgMessage(field: string): string {
  return `unknown arg: ${field}`;
}

/** F103-FR-002 — a field present without a value is a PARAMETER error. */
export function missingValueMessage(field: string): string {
  const flag = FLAG_OF_FIELD[field] ?? `--${field}`;
  return `${flag} requires a value`;
}

/** F103-FR-002 — the message of a working directory the loop cannot enter. */
export function cannotEnterMessage(value: string): string {
  return `cannot enter working directory '${value}'`;
}

/** The kinds of failure F103-FR-002 names, so a caller can branch on one. */
export const FAILURE_KINDS = [
  "workdir",
  "evidence",
  "prompt-file",
  "unknown-arg",
  "missing-value",
  "cannot-enter",
  "role",
  "harness",
] as const;
export type RequestFailureKind = (typeof FAILURE_KINDS)[number];

/**
 * F103-FR-002 — a failure never carries the usage text EXCEPT for an unknown
 * field, and a field present without a value never carries it. The two rules
 * are one table so that no caller has to remember them.
 */
export const FAILURE_CARRIES_THE_USAGE_TEXT: Readonly<Record<RequestFailureKind, boolean>> =
  Object.freeze({
    workdir: false,
    evidence: false,
    "prompt-file": false,
    "unknown-arg": true,
    "missing-value": false,
    "cannot-enter": false,
    role: false,
    harness: false,
  });

/** The result record of the pass loop, as far as this module writes it. */
export type RequestResult = {
  /** 1 for every failure of F103-FR-002, 0 for `help`. */
  readonly exit_code: 0 | 1;
  /** The first line of the as-is message. */
  readonly message?: string;
  /** The usage text, for `help` and for an unknown field. */
  readonly usage?: string;
  /** Which rule of F103-FR-002 ended the request. */
  readonly failure?: RequestFailureKind;
};

/** What `normalizeRequest` returns: a checked request, or a result record. */
export type Normalized =
  | { readonly ok: true; readonly request: PassLoopRequest }
  | { readonly ok: false; readonly result: RequestResult };

/* ------------------------------------------------------------------ *
 * The file system this module touches, as a port.
 * ------------------------------------------------------------------ */

/**
 * The four things F103-FR-002 asks of the file system, and nothing more.
 *
 * `@specstride/core` may not import `node:fs` or `node:fs/promises`
 * (`packages/contracts/data/package-graph.json`, row `@specstride/core`;
 * F100-FR-012, F100-FR-234), and the rule is enforced by
 * `tools/import-boundary`. So the operations are NAMED here, one for one, with
 * the `node:fs` call each one stands for, and the COMPOSITION ROOT implements
 * the port over `@specstride/kernel` — the same shape
 * `../approval/gate-tree.ts` uses for the gate store. A test hands a fake, or
 * a thin implementation of its own.
 */
export const IO_OPERATIONS = Object.freeze({
  isDirectory: "statSync(...).isDirectory()",
  isRegularFile: "statSync(...).isFile()",
  canonical: "realpathSync",
  makeDirectory: "mkdirSync(..., { recursive: true })",
  readText: "readFileSync(..., 'utf8')",
});

/** This module imports no file-system module of Node (F100-FR-012). */
export const IMPORTS_NODE_FS = false as const;

/** The port itself. */
export type RequestIo = {
  /** True when the path is a directory. */
  isDirectory(path: string): boolean;
  /** True when the path is a REGULAR file (F103-FR-002: a directory is not one). */
  isRegularFile(path: string): boolean;
  /** The canonical form of a directory, or `undefined` when it cannot be entered. */
  canonical(path: string): string | undefined;
  /** Create a directory and its parents; the loop never fails on an existing one. */
  makeDirectory(path: string): void;
  /** The text of the prompt file, or `undefined` when it cannot be read. */
  readText(path: string): string | undefined;
};

/* ------------------------------------------------------------------ *
 * The state directory of the feature.
 * ------------------------------------------------------------------ */

/**
 * The state directory of the feature under the working directory, which
 * F103-FR-002 asks the loop to create when it is missing. The LEGACY name of
 * the state directory is not carried (F103-FR-016).
 */
export const STATE_DIRECTORY_HEAD = ".specstride" as const;

/** The state directory of a feature slug under a working directory. */
export function stateDirectoryOf(workdir: string, feature: string): string {
  return join(workdir, STATE_DIRECTORY_HEAD, "features", feature);
}

/** The parent directory of a path. */
function parentOf(path: string): string {
  return resolve(path, "..");
}

/* ------------------------------------------------------------------ *
 * Normalization: the defaults, then the failures, in the as-is order.
 * ------------------------------------------------------------------ */

/**
 * F103-FR-001 — fill every absent optional field with its as-is value. It does
 * no checking: `normalizeRequest` checks.
 */
export function applyRequestDefaults(input: PassLoopRequestInput): PassLoopRequestInput {
  const out: Record<string, unknown> = { ...input };
  for (const [field, value] of Object.entries(REQUEST_DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) out[field] = value;
  }
  return Object.freeze(out);
}

const failure = (
  kind: RequestFailureKind,
  message: string,
): { readonly ok: false; readonly result: RequestResult } => ({
  ok: false,
  result: Object.freeze({
    exit_code: 1 as const,
    message,
    failure: kind,
    ...(FAILURE_CARRIES_THE_USAGE_TEXT[kind] ? { usage: usageText() } : {}),
  }),
});

/**
 * F103-FR-001 and F103-FR-002 — the one checked way into the pass loop.
 *
 * The order is the baseline's and it matters: an unknown field is reported
 * before anything is read from disk, `help` wins over every check that is not
 * a parse error, and the working directory is canonical before the evidence
 * path is resolved against it.
 *
 *  1. a field the pass loop does not know → `unknown arg: <name>` and the usage text;
 *  2. a field present without a value → a parameter error, never the usage text;
 *  3. `help` → `exit_code` 0 and the usage text;
 *  4. the working directory: empty, not a directory, or not enterable;
 *  5. the evidence path: empty, then resolved against the working directory;
 *  6. the prompt: missing or not a regular file;
 *  7. the role and the harness;
 *  8. the parent directory of the evidence path and the state directory of the feature.
 */
export function normalizeRequest(input: PassLoopRequestInput, io: RequestIo): Normalized {
  for (const field of Object.keys(input)) {
    if (!isKnownField(field)) return failure("unknown-arg", unknownArgMessage(field));
  }
  for (const [field, value] of Object.entries(input)) {
    if (value === undefined) return failure("missing-value", missingValueMessage(field));
  }

  const filled = applyRequestDefaults(input);

  if (filled.help === true) {
    return { ok: false, result: Object.freeze({ exit_code: 0 as const, usage: usageText() }) };
  }

  const rawWorkdir = typeof filled.workdir === "string" ? filled.workdir : "";
  if (rawWorkdir.length === 0 || !io.isDirectory(rawWorkdir)) {
    return failure("workdir", workdirRequiredMessage(rawWorkdir));
  }
  const workdir = io.canonical(rawWorkdir);
  if (workdir === undefined) return failure("cannot-enter", cannotEnterMessage(rawWorkdir));

  const rawEvidence = typeof filled.evidence === "string" ? filled.evidence : "";
  if (rawEvidence.length === 0) return failure("evidence", evidenceRequiredMessage());
  const evidence = isAbsolute(rawEvidence) ? rawEvidence : resolve(workdir, rawEvidence);

  const standingPrompt = promptOf(filled, io);
  if (standingPrompt === undefined) {
    const named = typeof filled.promptFile === "string" ? filled.promptFile : "";
    return failure("prompt-file", promptFileRequiredMessage(named));
  }

  const role = filled.role;
  if (role !== "proposer" && role !== "accelerator") {
    return failure("role", `--role must be proposer or accelerator (got '${String(role ?? "")}')`);
  }
  const harness = typeof filled.harness === "string" ? filled.harness : "";
  if (harness.length === 0) return failure("harness", "--backend NAME required");

  io.makeDirectory(parentOf(evidence));
  const feature = typeof filled.feature === "string" ? filled.feature : REQUEST_DEFAULTS.feature;
  io.makeDirectory(stateDirectoryOf(workdir, feature));

  const request: PassLoopRequest = Object.freeze({
    workdir,
    evidence,
    standingPrompt,
    harness,
    role,
    passLimit: numberOr(filled.passLimit, REQUEST_DEFAULTS.passLimit),
    pauseSec: numberOr(filled.pauseSec, REQUEST_DEFAULTS.pauseSec),
    feature,
    phase: numberOr(filled.phase, REQUEST_DEFAULTS.phase),
    phaseAttempt: numberOr(filled.phaseAttempt, REQUEST_DEFAULTS.phaseAttempt),
    invocationBase: typeof filled.invocationBase === "string" ? filled.invocationBase : undefined,
    passTimeLimitSec:
      typeof filled.passTimeLimitSec === "number" ? filled.passTimeLimitSec : undefined,
    yieldPlace: filled.yieldPlace === YIELD_PLACE ? YIELD_PLACE : undefined,
    debug: filled.debug === true,
    help: false,
  });
  return { ok: true, request };
}

/**
 * The standing prompt: the text a caller handed over, or the text of the file
 * the as-is flag `--prompt-file` named. `undefined` means the failure of
 * F103-FR-002 — the prompt is missing, or is not a regular file.
 *
 * The prompt is read ONCE here, when the phase attempt starts; a change of a
 * file it was built from during the attempt reaches no later pass of the
 * attempt (F103-FR-007).
 */
function promptOf(filled: PassLoopRequestInput, io: RequestIo): string | undefined {
  if (typeof filled.standingPrompt === "string") return filled.standingPrompt;
  const named = filled.promptFile;
  if (typeof named !== "string" || named.length === 0) return undefined;
  if (!io.isRegularFile(named)) return undefined;
  return io.readText(named);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
