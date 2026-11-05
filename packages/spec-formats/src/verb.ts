/**
 * T039 — the public verb `spec` (F104-FR-019, F104-FR-020; ruling 26).
 *
 * `specstride spec` is the ONE inspection surface over the canonical model:
 * eleven subcommands, five flags, four exit codes and an opt-in `--json`.
 * Everything it prints is read out of the modules the earlier phases built —
 * `resolve.ts`, `slug.ts`, `registry.ts`, `validate.ts`, `context.ts` and
 * `tick.ts`. This module holds NO grammar of its own (F104-SC-001) and NO hash
 * of its own (F104-FR-021): it is the command shape and nothing else.
 *
 * Three rules shape the code:
 *
 *  1. **Nothing here exits, prints or logs.** `run` returns a result record
 *     with `stdout`, `stderr` and `exit`, byte for byte as the command would
 *     write them, and the command wiring of the CLI does the writing. That is
 *     layering rule LR-6, the same rule `errors.ts` follows, and it is what
 *     makes every line of this verb measurable in a test without a child
 *     process.
 *  2. **`first-unapproved` verifies no signature.** Whether an approval record
 *     verifies — its schema, its signature and its bindings — is the engine's
 *     verification of F101-FR-031, which lives in `@specstride/core`, a package
 *     this one may not import (package graph of feature 100, research D-12).
 *     The verb therefore receives that verification as a PORT that the CLI, the
 *     composition root, hands over. With no port handed over nothing is
 *     approved: an absent verification can never be read as a pass, so the
 *     bare marker of F101-FR-031 never approves a phase here.
 *  3. **The verb reads the position; it does not derive it.** Where a run
 *     resumes is the engine's (F101-FR-002). `first-unapproved` answers a
 *     question about the files on disk and nothing more.
 *
 * The exit codes are the row `spec` of annex G §G.4, which
 * `@specstride/contracts` holds as data; this module READS that row rather
 * than restating its numbers, so the two cannot drift.
 */
import { isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  codesOf,
  unknownSubcommandCodeOf,
  UNCAUGHT_ERROR_CODE,
} from "@specstride/contracts/codes/commands";
import {
  subcommandsOfTheCommandSpec,
  type CanonicalSpecModel,
  type ContextDocument,
  type FormatName,
  type SpecFinding,
} from "./model.ts";
import {
  SpecCallerError,
  UnknownFormatError,
  UnreadableSpecError,
  isACallerError,
  specModuleNotFound,
} from "./errors.ts";
import { canonicalSpecPath, explicitSpecPath, isARegularFile } from "./resolve.ts";
import { featureSlug, type FeatureSlug } from "./slug.ts";
import { settleFormat, SpecFormatRegistry, defaultRegistry } from "./registry.ts";
import {
  EMPTY,
  numbersOf,
  parse,
  phaseCountOf,
  rawSliceOf,
  shapeOf,
  titleOf,
  validate as findingsOf,
} from "./validate.ts";
import {
  DEFAULT_BUDGET,
  contextDocumentsOf,
  contextLinesOf,
  loadContextDocuments,
  renderContext,
} from "./context.ts";
import { countPrintedBy, tickFile } from "./tick.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F104-FR-019", "F104-FR-020"] as const;

/** The records of the baseline the shape and the texts are taken from. */
export const BEHAVIOUR_ROWS = Object.freeze([
  "B-1978",
  "B-1979",
  "B-1980",
  "B-1981",
  "B-1982",
  "B-1983",
  "B-1984",
  "B-1985",
  "B-1986",
  "B-1987",
  "B-1988",
  "B-1989",
  "B-1990",
  "B-1991",
  "B-1992",
  "B-1993",
  "B-1994",
  "B-1998",
]);

/** The verb's own name, which every text of the verb is prefixed with. */
export const VERB = "spec" as const;

/* ------------------------------------------------------------------ *
 * The subcommands (F104-FR-019; row 100 of annex X §X.6).
 * ------------------------------------------------------------------ */

/**
 * The eleven subcommands, READ from row 100 of annex X §X.6. The list is not
 * written out here: the closed set is the authority, so a subcommand added to
 * the row reaches this verb without an edit, and one removed from it stops
 * being accepted.
 */
export const SUBCOMMANDS: readonly string[] = subcommandsOfTheCommandSpec.members;

/** One of the eleven. */
export type Subcommand = (typeof SUBCOMMANDS)[number];

/** True when the first argument is one of the eleven (B-1989). */
export function isASubcommand(value: string): boolean {
  return SUBCOMMANDS.includes(value);
}

/**
 * The four subcommands that take a phase number (F104-FR-020; B-1990). The
 * argument is REQUIRED for these four and for no other, and a missing one is
 * exit 3 while a value that is not a whole number is exit 1.
 */
export const SUBCOMMANDS_WITH_A_PHASE_NUMBER: readonly string[] = Object.freeze([
  "tick",
  "title",
  "shape",
  "slice",
]);

/** True when the subcommand needs the positional phase number. */
export function needsAPhaseNumber(subcommand: string): boolean {
  return SUBCOMMANDS_WITH_A_PHASE_NUMBER.includes(subcommand);
}

/**
 * The one subcommand that is answered BEFORE the spec is read (B-1978), so it
 * works for a spec file that is missing or odd.
 */
export const ANSWERED_BEFORE_THE_SPEC_IS_READ = "feature-slug" as const;

/** The one subcommand that WRITES; every other is a pure reader (F104-FR-017). */
export const SUBCOMMAND_THAT_WRITES = "tick" as const;

/* ------------------------------------------------------------------ *
 * The flags (F104-FR-019; B-1991 to B-1994).
 * ------------------------------------------------------------------ */

/** `--specs FILE`, required for every subcommand (B-1991). */
export const SPECS_FLAG = "--specs" as const;

/**
 * `--format`, the override of detection (B-1994). It is NOT the run's
 * `--spec-format` of F104-FR-007 (`registry.ts`): the verb keeps the as-is
 * flag name of the module it came from, and the two names are kept apart on
 * purpose so that neither is read for the other.
 */
export const FORMAT_FLAG = "--format" as const;

/** `--workdir`, default `.` (B-1992). */
export const WORKDIR_FLAG = "--workdir" as const;

/** `--gates-dir`, which replaces the default gates directory (B-1993). */
export const GATES_DIR_FLAG = "--gates-dir" as const;

/** `--json`, opt-in (F104-FR-020; annex G, F100-FR-172). */
export const JSON_FLAG = "--json" as const;

/** Every flag the verb accepts; anything else is a usage error. */
export const FLAGS: readonly string[] = Object.freeze([
  SPECS_FLAG,
  FORMAT_FLAG,
  WORKDIR_FLAG,
  GATES_DIR_FLAG,
  JSON_FLAG,
]);

/** The flags that take a value; `--json` is the only one that does not. */
export const FLAGS_WITH_A_VALUE: readonly string[] = Object.freeze([
  SPECS_FLAG,
  FORMAT_FLAG,
  WORKDIR_FLAG,
  GATES_DIR_FLAG,
]);

/** `--specs` is the one REQUIRED flag (B-1991). */
export const REQUIRED_FLAGS: readonly string[] = Object.freeze([SPECS_FLAG]);

/** The default of `--workdir` (B-1992). */
export const DEFAULT_WORKDIR = "." as const;

/** `--json` is opt-in: the default output of every subcommand is the as-is text. */
export const JSON_IS_OPT_IN = true as const;

/** F100-FR-172 — a `--json` output is ONE record. */
export const JSON_IS_ONE_RECORD = true as const;

/**
 * The feature is NOT a flag of this verb: F104-FR-019 names five flags and
 * `--feature` is not among them. The key `spec.feature` reaches the verb
 * through the configuration loader of feature 110, which the CLI hands over in
 * the request record (`featureKey` below).
 */
export const FEATURE_IS_NOT_A_FLAG_OF_THE_VERB = true as const;

/* ------------------------------------------------------------------ *
 * The exit codes (F104-FR-020; the row `spec` of annex G §G.4).
 * ------------------------------------------------------------------ */

/** Success. */
export const EXIT_OK = 0 as const;

/**
 * A phase number that is not a whole number. At the baseline this was an
 * uncaught `ValueError` with a traceback; the port exits 1 ON PURPOSE and the
 * trace text is not reproduced (rule N-18, CQ-042).
 */
export const EXIT_NOT_A_WHOLE_NUMBER = 1 as const;

/** A usage error, which includes an unknown subcommand of `spec` (ruling K6). */
export const EXIT_USAGE = 2 as const;

/** An invalid spec, an unknown explicit format, an unreadable spec, a missing number. */
export const EXIT_INVALID_SPEC = 3 as const;

/**
 * The exit 1 of a phase number that is not a whole number is a CHOSEN exit of
 * the verb and is NOT the uncaught error of annex G §G.4, which exits 70
 * (F104-FR-020). The number is named here so that a test can measure that the
 * verb never returns it.
 */
export const EXIT_OF_AN_UNCAUGHT_ERROR = UNCAUGHT_ERROR_CODE;
export const EXIT_1_IS_A_CHOSEN_EXIT = true as const;

/** The codes the row `spec` of annex G §G.4 names, READ from that row. */
export const CODES_OF_THE_ROW: readonly number[] = codesOf(VERB);

/**
 * An unknown subcommand of `spec` exits with the code of the row of `spec`,
 * READ from the general rules of F100-FR-182 — 2, not the 1 of "unknown first
 * argument (verb)", which is about the first argument of the product
 * (F104-FR-020, ruling K6).
 */
export const EXIT_OF_AN_UNKNOWN_SUBCOMMAND = unknownSubcommandCodeOf(VERB);

/** The exit of every subcommand, as the contract `contracts/spec-verb.md` gives it. */
export const EXITS_OF_A_SUBCOMMAND: Readonly<Record<string, readonly number[]>> = Object.freeze({
  "feature-slug": Object.freeze([EXIT_OK]),
  detect: Object.freeze([EXIT_OK, EXIT_INVALID_SPEC]),
  context: Object.freeze([EXIT_OK]),
  "render-context": Object.freeze([EXIT_OK]),
  validate: Object.freeze([EXIT_OK, EXIT_INVALID_SPEC]),
  tick: Object.freeze([EXIT_OK, EXIT_INVALID_SPEC]),
  numbers: Object.freeze([EXIT_OK]),
  title: Object.freeze([EXIT_OK]),
  shape: Object.freeze([EXIT_OK]),
  slice: Object.freeze([EXIT_OK]),
  "first-unapproved": Object.freeze([EXIT_OK]),
});

/* ------------------------------------------------------------------ *
 * The texts.
 * ------------------------------------------------------------------ */

/** F104-FR-020 — a subcommand that needs a phase number and was given none. */
export function missingPhaseNumberText(subcommand: string): string {
  return `${VERB}: ${subcommand} needs a phase number`;
}

/** A line with no subcommand at all, which is a usage error of its own. */
export function missingSubcommandText(): string {
  return `${VERB}: a subcommand is required (${SUBCOMMANDS.join(", ")})`;
}

/** B-1989 — an unknown subcommand of `spec`; the eleven are named. */
export function unknownSubcommandText(value: string): string {
  return `${VERB}: unknown subcommand: ${value} (${SUBCOMMANDS.join(", ")})`;
}

/** B-1991 — `--specs` is required for every subcommand. */
export function missingSpecsText(): string {
  return `${VERB}: ${SPECS_FLAG} FILE is required`;
}

/** B-1990, rule N-18 — a phase number that is not a whole number; no traceback. */
export function notAWholeNumberText(value: string): string {
  return `${VERB}: phase number is not a whole number: ${value}`;
}

/** A flag the verb does not know. */
export function unknownFlagText(value: string): string {
  return `${VERB}: unknown flag: ${value} (${FLAGS.join(", ")})`;
}

/** A flag that takes a value and was given none. */
export function flagWithoutItsValueText(flag: string): string {
  return `${VERB}: ${flag} needs a value`;
}

/** More positional arguments than the subcommand and its phase number. */
export function tooManyArgumentsText(extra: readonly string[]): string {
  return `${VERB}: unexpected argument: ${extra.join(" ")}`;
}

/* ------------------------------------------------------------------ *
 * The command line.
 * ------------------------------------------------------------------ */

/** A parsed invocation of the verb. */
export type Invocation = {
  readonly subcommand: string;
  /** The positional phase number, where the invocation carried one. */
  readonly phase?: number | undefined;
  readonly specs: string;
  readonly format?: string | undefined;
  readonly workdir: string;
  readonly gatesDir?: string | undefined;
  readonly json: boolean;
};

/** A usage failure of the command line: its text and its exit. */
export type UsageFailure = {
  readonly ok: false;
  readonly message: string;
  readonly exit: number;
  /** The subcommand, where the line named a valid one before it failed. */
  readonly subcommand?: string | undefined;
  /** True where `--json` was asked for, so the failure is reported as a record. */
  readonly json: boolean;
};

/** The outcome of reading a command line. */
export type Parsed = { readonly ok: true; readonly invocation: Invocation } | UsageFailure;

/**
 * Read a command line: `spec <subcommand> [<n>] [flags]`. Every failure here is
 * a USAGE error (exit 2) except the two the requirement singles out — a missing
 * phase number (exit 3) and one that is not a whole number (exit 1) — which are
 * failures of the ARGUMENT and not of the shape of the line.
 *
 * `argv` is the arguments AFTER the verb: the CLI strips `specstride spec`.
 */
export function parseArgv(argv: readonly string[]): Parsed {
  const positionals: string[] = [];
  let specs: string | undefined;
  let format: string | undefined;
  let workdir: string | undefined;
  let gatesDir: string | undefined;
  let json = false;
  // `--json` is read even on a line that then fails, so that a failure can be
  // reported as the one record the caller asked for.
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument === JSON_FLAG) {
      json = true;
      continue;
    }
    if (FLAGS_WITH_A_VALUE.includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined) {
        return failure(flagWithoutItsValueText(argument), EXIT_USAGE, positionals[0], json);
      }
      index += 1;
      if (argument === SPECS_FLAG) specs = value;
      else if (argument === FORMAT_FLAG) format = value;
      else if (argument === WORKDIR_FLAG) workdir = value;
      else gatesDir = value;
      continue;
    }
    if (argument.startsWith("-")) {
      return failure(unknownFlagText(argument), EXIT_USAGE, positionals[0], json);
    }
    positionals.push(argument);
  }

  const subcommand = positionals[0];
  if (subcommand === undefined) {
    return failure(missingSubcommandText(), EXIT_USAGE, undefined, json);
  }
  if (!isASubcommand(subcommand)) {
    // B-1989, ruling K6 — an unknown subcommand of `spec` exits with the code
    // of the row of `spec`, which is 2 and not the 1 of an unknown verb.
    return failure(
      unknownSubcommandText(subcommand),
      EXIT_OF_AN_UNKNOWN_SUBCOMMAND,
      undefined,
      json,
    );
  }
  if (positionals.length > 2) {
    return failure(tooManyArgumentsText(positionals.slice(2)), EXIT_USAGE, subcommand, json);
  }
  if (specs === undefined) {
    // B-1991 — `--specs` is required for EVERY subcommand, `feature-slug`
    // included: the flag is what names the spec, even where the file is never
    // read.
    return failure(missingSpecsText(), EXIT_USAGE, subcommand, json);
  }

  const raw = positionals[1];
  let phase: number | undefined;
  if (needsAPhaseNumber(subcommand)) {
    if (raw === undefined) {
      // F104-FR-020 — a missing phase number is exit 3, not a usage error.
      return failure(missingPhaseNumberText(subcommand), EXIT_INVALID_SPEC, subcommand, json);
    }
    const read = readPhaseNumber(raw);
    if (read === undefined) {
      // F104-FR-020, CQ-042 — a CHOSEN exit 1, never the uncaught error (70).
      return failure(notAWholeNumberText(raw), EXIT_NOT_A_WHOLE_NUMBER, subcommand, json);
    }
    phase = read;
  } else if (raw !== undefined) {
    return failure(tooManyArgumentsText([raw]), EXIT_USAGE, subcommand, json);
  }

  return Object.freeze({
    ok: true as const,
    invocation: Object.freeze({
      subcommand,
      phase,
      specs,
      format,
      workdir: workdir ?? DEFAULT_WORKDIR,
      gatesDir,
      json,
    }),
  });
}

function failure(
  message: string,
  exit: number,
  subcommand: string | undefined,
  json: boolean,
): UsageFailure {
  return Object.freeze({ ok: false as const, message, exit, subcommand, json });
}

/**
 * B-1990 — the positional phase number. A WHOLE number and nothing else: a
 * decimal, a hexadecimal form, an empty string and a value with a sign are all
 * "not a whole number" and give exit 1.
 */
export const WHOLE_NUMBER = /^[0-9]+$/;

export function readPhaseNumber(value: string): number | undefined {
  return WHOLE_NUMBER.test(value) ? Number(value) : undefined;
}

/* ------------------------------------------------------------------ *
 * `first-unapproved`: the approval verification PORT (F104-FR-019, D-12).
 * ------------------------------------------------------------------ */

/** The package that owns the verification the port stands for. */
export const PORT_OWNER = "@specstride/core" as const;

/** The requirement the port stands for. */
export const PORT_REQUIREMENT = "F101-FR-031" as const;

/** Who hands the port over: the composition root, which is the CLI. */
export const PORT_IS_HANDED_OVER_BY = "the command wiring of the CLI" as const;

/** The verb verifies NO signature itself (F104-FR-019, research D-12). */
export const VERIFIES_NO_SIGNATURE_ITSELF = true as const;

/** The count of signature verifiers in this module: none, and measurably none. */
export const SIGNATURE_VERIFIERS_IN_THIS_MODULE = 0 as const;

/** F101-FR-031 — the existence of a file is NEVER an approval. */
export const EXISTENCE_IS_NOT_APPROVAL = true as const;

/** F101-FR-031 — a bare marker without a record is not an approval either. */
export const BARE_MARKER_IS_NOT_APPROVAL = true as const;

/** F101-FR-002 — the verb reads the position; the engine derives where a run resumes. */
export const DERIVES_THE_RESUME_POSITION = false as const;

/** The schema id of the record the port is handed (annex B §B.14). */
export const APPROVAL_SCHEMA_ID = "specstride.approval/1" as const;

/** The logical name of the record (annex B §B.5). */
export const APPROVAL_LOGICAL_NAME = "gate:<N>:approved" as const;

/**
 * What the port is handed for one phase: the phase, where the record would be,
 * and its bytes — or `undefined` where there is no file at all. The verb reads
 * the file and NOTHING else; it does not parse the record, because the schema
 * is one of the things the port's verification decides (F101-FR-031).
 */
export type ApprovalCandidate = {
  readonly phase: number;
  readonly path: string;
  readonly content: string | undefined;
};

/** What the port answers: verified, or not, with a reason a caller may report. */
export type ApprovalVerdict = {
  readonly verified: boolean;
  readonly reason?: string | undefined;
};

/** The port itself: the engine's verification of F101-FR-031, handed over. */
export type ApprovalVerificationPort = (candidate: ApprovalCandidate) => ApprovalVerdict;

/** The reason the absent port gives, so that an absence is never a silent pass. */
export const NO_PORT_REASON: string =
  `no approval verification was handed over, so no phase counts as approved: ` +
  `the verification of ${PORT_REQUIREMENT} lives in ${PORT_OWNER} and is handed over by ` +
  `${PORT_IS_HANDED_OVER_BY}`;

/**
 * The port used when the CLI handed none over. It approves NOTHING. An absent
 * verification must never be read as a pass (the constitution, principle XVII);
 * the alternative — treating the existence of the file as the approval — is
 * exactly the bare marker F101-FR-031 forbids.
 */
export const noApprovalVerification: ApprovalVerificationPort = () =>
  Object.freeze({ verified: false, reason: NO_PORT_REASON });

/**
 * The workspace part, `.specstride` under the directory `--workdir` names,
 * which is where the state of a workspace lives (B-1993). The as-is path shape
 * of row B-1993 is not written out here: naming an as-is state directory in a
 * package is what the packaging rule F100-FR-026 of feature 100 forbids, so the
 * row stays in the inventory and the test reads it from there.
 */
export const STATE_DIRECTORY = ".specstride" as const;

/** The default gates directory: `gates` under the workspace part (B-1992, B-1993). */
export function defaultGatesDirectory(workdir: string): string {
  return join(resolvePath(workdir), STATE_DIRECTORY, "gates");
}

/** The gates directory in force: `--gates-dir` replaces the default (B-1993). */
export function gatesDirectoryOf(workdir: string, gatesDir?: string | undefined): string {
  if (gatesDir === undefined || gatesDir === "") return defaultGatesDirectory(workdir);
  return isAbsolute(gatesDir) ? gatesDir : resolvePath(workdir, gatesDir);
}

/**
 * The names an approval record of a phase may carry, in the order they are
 * tried. `GATE<N>-APPROVED` is the as-is path of row B-0875 of the layout of
 * feature 100; `.json` beside it is the same name with the suffix a record
 * file carries. Both are tried because the as-is name holds a RECORD now
 * (F101-FR-031) and the layout row is about the location, not the suffix. The
 * reading is kept in ONE place so that the day the owner settles the suffix the
 * change is one line.
 */
export function approvalFileNames(phase: number): readonly string[] {
  return Object.freeze([`GATE${phase}-APPROVED`, `GATE${phase}-APPROVED.json`]);
}

/** Where the approval record of a phase would be; the first name that exists wins. */
export function approvalPathOf(gatesDirectory: string, phase: number): string {
  const names = approvalFileNames(phase);
  for (const name of names) {
    const path = join(gatesDirectory, name);
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return join(gatesDirectory, names[0] as string);
}

/** The candidate of a phase: the path, and its bytes where there is a file. */
export function approvalCandidateOf(gatesDirectory: string, phase: number): ApprovalCandidate {
  const path = approvalPathOf(gatesDirectory, phase);
  let content: string | undefined;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    content = undefined;
  }
  return Object.freeze({ phase, path, content });
}

/** What `first-unapproved` found. */
export type FirstUnapproved = {
  /** The first phase without a verified record; `undefined` when all verify. */
  readonly phase: number | undefined;
  readonly gatesDirectory: string;
  /** The reason the port gave for the phase that is reported, where it gave one. */
  readonly reason?: string | undefined;
  /** The phases whose records the port was asked about, in order. */
  readonly asked: readonly number[];
};

/** `first-unapproved` stops at the first phase the port does not verify. */
export const STOPS_AT_THE_FIRST = true as const;

/**
 * F104-FR-019 — the first phase number that lacks a VERIFIED approval record.
 * Every decision about a record is the port's; this function walks the phase
 * numbers of the model in order, hands the port the candidate of each, and
 * stops at the first the port does not verify.
 */
export function firstUnapproved(
  phases: readonly number[],
  gatesDirectory: string,
  verify: ApprovalVerificationPort = noApprovalVerification,
): FirstUnapproved {
  const asked: number[] = [];
  for (const phase of phases) {
    asked.push(phase);
    const verdict = verify(approvalCandidateOf(gatesDirectory, phase));
    if (!verdict.verified) {
      return Object.freeze({
        phase,
        gatesDirectory,
        reason: verdict.reason,
        asked: Object.freeze([...asked]),
      });
    }
  }
  return Object.freeze({
    phase: undefined,
    gatesDirectory,
    asked: Object.freeze([...asked]),
  });
}

/* ------------------------------------------------------------------ *
 * The result of a run of the verb.
 * ------------------------------------------------------------------ */

/**
 * What the verb produced: the two streams byte for byte and the exit. Nothing
 * here is written: the CLI writes `stdout` and `stderr` as they are and exits
 * with `exit` (LR-6).
 */
export type VerbResult = {
  readonly subcommand: string | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly exit: number;
  /** The one record of `--json`, where `--json` was asked for. */
  readonly record?: Readonly<Record<string, unknown>> | undefined;
};

/** The ports and the settings the CLI hands the verb. */
export type VerbPorts = {
  /** The engine's verification of an approval record (F101-FR-031). */
  readonly verifyApproval?: ApprovalVerificationPort | undefined;
  /** The value of the key `spec.feature`, settled by the loader of feature 110. */
  readonly featureKey?: string | undefined;
  /** The value of the key `spec.format`, settled by the same loader. */
  readonly formatKey?: string | undefined;
  /** The context budget of `spec.contextBudget`, settled by the same loader. */
  readonly contextBudget?: number | undefined;
  /** The registry of formats; the default one holds the three of Wave 1. */
  readonly registry?: SpecFormatRegistry | undefined;
  /**
   * The directory the command was STARTED FROM, which is what a RELATIVE
   * `--specs` is taken against (F104-FR-002, B-0237). It is NOT `--workdir`:
   * that flag selects the WORKSPACE, which is where the gates directory, the
   * context documents and the repository-relative paths come from (B-1992).
   * The two are the same for the default `--workdir .`, and the record keeps
   * them apart so that neither is read for the other.
   */
  readonly launchDirectory?: string | undefined;
};

/** B-0237 — a relative `--specs` is taken against the launch directory. */
export const SPECS_IS_RELATIVE_TO = "the launch directory" as const;

/** B-1992 — `--workdir` selects the workspace, and nothing else does. */
export const WORKDIR_SELECTS = "the workspace" as const;

/** Nothing in this module writes to a stream or exits a process (LR-6). */
export const WRITES_NO_STREAM = true as const;

/* ------------------------------------------------------------------ *
 * The one record of `--json`.
 * ------------------------------------------------------------------ */

/**
 * F100-FR-172 — a `--json` output is ONE record, which is one line of JSON
 * followed by one newline. The record always carries the subcommand, the exit
 * and `ok`; the facts of the subcommand are the rest of it.
 */
export function jsonLine(record: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(record)}\n`;
}

/** The record of a usage failure, which has no facts of its own. */
export function jsonOfAFailure(failed: UsageFailure): Readonly<Record<string, unknown>> {
  return Object.freeze({
    verb: VERB,
    subcommand: failed.subcommand ?? null,
    ok: false,
    exit: failed.exit,
    error: Object.freeze({ message: failed.message }),
  });
}

/* ------------------------------------------------------------------ *
 * The run.
 * ------------------------------------------------------------------ */

/** The spec, read once: the path, the format, the text and the model. */
type Loaded = {
  readonly path: string;
  readonly relativePath: string;
  readonly format: FormatName;
  readonly text: string;
  readonly model: CanonicalSpecModel;
  readonly feature: FeatureSlug;
};

/** A path of the workspace, with `/` as the separator, as a source carries it. */
function relativeToWorkdir(workdir: string, path: string): string {
  const value = relative(resolvePath(workdir), path).split(sep).join("/");
  return value === "" ? path : value;
}

/**
 * The whole of a run of the verb: the command line is already read, the ports
 * are the CLI's. Every caller error of F104-FR-018 that a subcommand raises is
 * caught here and becomes its result code (3) with the error's own text on the
 * error stream — the verb never lets one escape as an uncaught error (70).
 */
export function run(invocation: Invocation, ports: VerbPorts = {}): VerbResult {
  try {
    return runOrThrow(invocation, ports);
  } catch (error) {
    if (isACallerError(error)) {
      return result(invocation, "", `${error.message}\n`, (error as SpecCallerError).resultCode, {
        error: Object.freeze({ kind: error.kind, message: error.message }),
      });
    }
    throw error;
  }
}

/** `run` over a command line: read it, then run it. */
export function runArgv(argv: readonly string[], ports: VerbPorts = {}): VerbResult {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    return Object.freeze({
      subcommand: parsed.subcommand,
      stdout: parsed.json ? jsonLine(jsonOfAFailure(parsed)) : "",
      stderr: `${parsed.message}\n`,
      exit: parsed.exit,
      record: parsed.json ? jsonOfAFailure(parsed) : undefined,
    });
  }
  return run(parsed.invocation, ports);
}

function result(
  invocation: Invocation,
  stdout: string,
  stderr: string,
  exit: number,
  facts: Readonly<Record<string, unknown>>,
): VerbResult {
  const record = Object.freeze({
    verb: VERB,
    subcommand: invocation.subcommand,
    ok: exit === EXIT_OK,
    exit,
    specs: invocation.specs,
    ...facts,
  });
  return Object.freeze({
    subcommand: invocation.subcommand,
    stdout: invocation.json ? jsonLine(record) : stdout,
    stderr,
    exit,
    record: invocation.json ? record : undefined,
  });
}

function runOrThrow(invocation: Invocation, ports: VerbPorts): VerbResult {
  const workdir = resolvePath(invocation.workdir);
  // B-0237 — a RELATIVE `--specs` is taken against the directory the command
  // was started from, which is not `--workdir`; an ABSOLUTE value is kept.
  const launchDirectory = resolvePath(ports.launchDirectory ?? DEFAULT_WORKDIR);
  const specsPath = canonicalSpecPath(explicitSpecPath(invocation.specs, launchDirectory));
  const registry = ports.registry ?? defaultRegistry;

  // B-1978 — `feature-slug` is answered BEFORE the spec is read, so it works
  // for a spec file that is missing or odd. It is the one subcommand that
  // neither reads the file nor needs a format.
  if (invocation.subcommand === ANSWERED_BEFORE_THE_SPEC_IS_READ) {
    const slug = featureSlug({ explicit: ports.featureKey, specPath: specsPath });
    return result(invocation, `${slug.slug}\n`, "", EXIT_OK, {
      featureSlug: slug.slug,
      source: slug.source,
    });
  }

  // Every other subcommand reads the file. A path that is no regular file is
  // `spec not found: <path>` with exit 3 (F104-FR-015, F104-FR-020, B-0367);
  // a file that cannot be READ is `spec: <operating-system error>` (B-2000).
  if (!isARegularFile(specsPath)) {
    const message = specModuleNotFound(specsPath);
    return result(invocation, "", `${message}\n`, EXIT_INVALID_SPEC, {
      error: Object.freeze({ kind: "invalid-spec", message }),
    });
  }

  // `--format` overrides detection (B-1994); an unknown value raises
  // `UnknownFormatError`, which `run` turns into exit 3 (F104-FR-006).
  const settled = settleFormat(
    specsPath,
    { flag: invocation.format, key: ports.formatKey },
    registry,
  );
  const format = settled.format as FormatName;

  if (invocation.subcommand === "detect") {
    // B-1979 — the resolved format name.
    return result(invocation, `${format}\n`, "", EXIT_OK, { format, source: settled.source });
  }

  const relativePath = relativeToWorkdir(workdir, specsPath);
  const feature = featureSlug({ explicit: ports.featureKey, specPath: specsPath });

  // `context` and `render-context` are about the DOCUMENTS beside the spec and
  // never about its phases, so neither parses the spec.
  if (invocation.subcommand === "context") {
    // B-1980 — one `name<TAB>path` line per document; NOTHING for native.
    const documents = contextDocumentsOf({ root: workdir, specPath: specsPath, format });
    const lines = contextLinesOf(documents);
    return result(invocation, linesWithEnds(lines), "", EXIT_OK, {
      documents: documentsOfTheRecord(documents),
    });
  }

  if (invocation.subcommand === "render-context") {
    // B-1981 — the budgeted block, with NO added newline.
    const budget = ports.contextBudget ?? DEFAULT_BUDGET;
    const loaded = loadContextDocuments({ root: workdir, specPath: specsPath, format });
    const block = renderContext(loaded, budget);
    return result(invocation, block, "", EXIT_OK, { context: block, budget });
  }

  if (invocation.subcommand === "tick") {
    // B-1983 — the count of lines that changed. `tick` is the one subcommand
    // that writes, and the write itself is `tick.ts`'s (F104-FR-017).
    const phase = invocation.phase as number;
    const ticked = tickFile({
      path: specsPath,
      format,
      request: { phase },
      file: relativePath,
    });
    const changed = countPrintedBy(ticked);
    return result(invocation, `${changed}\n`, "", EXIT_OK, {
      phase,
      changed,
      taskIds: ticked.taskIds,
      lines: ticked.lines,
    });
  }

  const loaded = loadSpec(specsPath, relativePath, format, feature);

  switch (invocation.subcommand) {
    case "validate": {
      // B-1982 — the phase count on success; on failure every finding on its
      // own line of the ERROR stream and exit 3.
      const findings = findingsOf(loaded.model, loaded.text);
      if (findings.length === 0) {
        const count = phaseCountOf(loaded.model);
        return result(invocation, `${count}\n`, "", EXIT_OK, {
          valid: true,
          phaseCount: count,
          findings: Object.freeze([]),
        });
      }
      return result(
        invocation,
        "",
        linesWithEnds(findings.map((finding) => finding.message)),
        EXIT_INVALID_SPEC,
        {
          valid: false,
          phaseCount: phaseCountOf(loaded.model),
          findings: findingsOfTheRecord(findings),
        },
      );
    }
    case "numbers": {
      // B-1984 — each phase number on its own line.
      const numbers = numbersOf(loaded.model);
      return result(invocation, linesWithEnds(numbers.map(String)), "", EXIT_OK, { numbers });
    }
    case "title": {
      // B-1985 — the title of the phase, an EMPTY LINE where there is none.
      const phase = invocation.phase as number;
      const title = titleOf(loaded.model, phase);
      return result(invocation, `${title}\n`, "", EXIT_OK, { phase, title });
    }
    case "shape": {
      // B-1986 — the 16-character shape, an EMPTY LINE where there is none.
      const phase = invocation.phase as number;
      const shape = shapeOf(loaded.model, phase);
      return result(invocation, `${shape}\n`, "", EXIT_OK, { phase, shape });
    }
    case "slice": {
      // B-1987 — the RAW, unstripped section and one newline. `rawSliceOf`
      // carries the newline, and gives the empty string for a missing phase.
      const phase = invocation.phase as number;
      const slice = rawSliceOf(loaded.model, phase);
      return result(invocation, slice, "", EXIT_OK, { phase, slice });
    }
    case "first-unapproved": {
      // B-1988, F104-FR-019 — the first phase without a VERIFIED approval
      // record; nothing when every one verifies; exit 0 either way.
      const gatesDirectory = gatesDirectoryOf(workdir, invocation.gatesDir);
      const found = firstUnapproved(
        numbersOf(loaded.model),
        gatesDirectory,
        ports.verifyApproval ?? noApprovalVerification,
      );
      return result(
        invocation,
        found.phase === undefined ? EMPTY : `${found.phase}\n`,
        "",
        EXIT_OK,
        {
          phase: found.phase ?? null,
          gatesDir: gatesDirectory,
          reason: found.reason ?? null,
        },
      );
    }
    default:
      // Unreachable: `parseArgv` accepts only the eleven of row 100, and every
      // one of them is answered above. The line is here so that a subcommand
      // ADDED to the row fails loudly instead of silently printing nothing.
      return result(
        invocation,
        "",
        `${unknownSubcommandText(invocation.subcommand)}\n`,
        EXIT_OF_AN_UNKNOWN_SUBCOMMAND,
        {
          error: Object.freeze({ message: unknownSubcommandText(invocation.subcommand) }),
        },
      );
  }
}

/** The spec, read and parsed once per run of the verb. */
function loadSpec(
  path: string,
  relativePath: string,
  format: FormatName,
  feature: FeatureSlug,
): Loaded {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    // B-2000 — `spec: <operating-system error>`, which `run` turns into exit 3.
    throw new UnreadableSpecError(path, cause);
  }
  return Object.freeze({
    path,
    relativePath,
    format,
    text,
    feature,
    model: parse({ file: relativePath, text, format, feature: feature.slug }),
  });
}

/** Lines, each followed by its own newline; the empty list gives no output. */
export function linesWithEnds(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

/** The context documents as the `--json` record carries them. */
function documentsOfTheRecord(
  documents: readonly ContextDocument[],
): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(
    documents.map((document) => Object.freeze({ name: document.name, path: document.path })),
  );
}

/** The findings as the `--json` record carries them. */
function findingsOfTheRecord(
  findings: readonly SpecFinding[],
): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(
    findings.map((finding) =>
      Object.freeze({
        severity: finding.severity,
        message: finding.message,
        path: finding.path ?? null,
        line: finding.line ?? null,
      }),
    ),
  );
}

/**
 * The classes this module may raise; `UnknownFormatError` and
 * `UnreadableSpecError` are the two it actually does, both through the modules
 * it calls, and both become exit 3 in `run`.
 */
export const CALLER_ERRORS_THAT_BECOME_EXIT_3 = Object.freeze([
  UnknownFormatError.name,
  UnreadableSpecError.name,
]);
