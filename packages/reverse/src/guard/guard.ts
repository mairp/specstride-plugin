/**
 * T023 of feature 108 — THE GUARD: the comparison, the problems,
 * `testautomation/`, the git checks, the printing and the exit codes
 * (F108-FR-027 to F108-FR-032).
 *
 * The guard is the one check that answers user story 2, "know that the source
 * was not touched". It takes the source, the baseline inventory and the output
 * directory, re-walks the source (`walk.ts`), and reports every way in which
 * the tree now differs from the baseline — outside the output directory and the
 * state directory, which the run itself writes.
 *
 * | Requirement | What this module does |
 * |---|---|
 * | F108-FR-027 | `parseGuardArguments` (source, `--baseline`, `--out`, all required; a missing baseline is a usage error with exit 2), `baselineOf` (read by the logical name `reverse:<slug>:inventory` and through its schema), and `compareEntries`, which runs ONLY where the re-walk's fingerprint differs from the baseline's |
 * | F108-FR-028 | `problemsOfTheComparison` — `deleted: <path>`, `added: <path>`, `changed: <path>`, `fingerprint differs from the baseline`; `deduplicated` keeps the order first seen, and the paths of each kind are sorted |
 * | F108-FR-029 | `testautomationProblems` — the snapshot comparison with the suffix, a deletion never reported, and the two baseline cases (no snapshot, snapshot null) |
 * | F108-FR-030 | `gitProblems` — only in git mode; `git HEAD moved: ... -> ...` and `git status: <entry>`, with the output directory, the workspace part and the baseline's own entries exempt |
 * | F108-FR-031 | `guardLines`, `GUARD_OK_LINE`, `guardFailedLine`, `reverseErrorLine`, and the exit codes 0, 3 and 2 |
 * | F108-FR-032 | the tree is read through `walk.ts`, which `lstat`s first and never follows a link; `isOutsideTheWorkingTree` states why a stub's counter file and the control plane can never be a problem |
 *
 * Nothing here writes: the source is never written (`plan.md`, Constraints),
 * and the guard creates no file, not even in the output directory.
 */
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative as relativePath, resolve as resolvePath, sep } from "node:path";

import type { RootPaths } from "@specstride/contracts/ids/logical-names";

import {
  InventoryError,
  readInventory,
  REFUSED_EXIT_CODE,
  reverseErrorLine,
  USAGE_EXIT_CODE,
  type InventoryFields,
  type InventoryTestAutomation,
  type ReadInventory,
} from "../plan/inventory-call.ts";
import { ReverseError } from "../plan/output.ts";
import {
  byCodePoint,
  entryOf,
  fingerprintOfEntries,
  guardExcludes,
  reWalk,
  TESTAUTOMATION_DIRECTORY,
  type WalkedEntry,
} from "./walk.ts";
import {
  gitHead,
  gitListing,
  gitStatus,
  pathOfAStatusEntry,
  spawnGit,
  type GitRunner,
} from "./git.ts";

/* ------------------------------------------------------------------------- *
 * The arguments (F108-FR-027; B-1603, B-1616, B-1617)
 * ------------------------------------------------------------------------- */

/** The verb, as `commands.ts` writes it into every `guard-N` command. */
export const VERB = "guard" as const;

/** The two flags of the verb (F108-FR-027). */
export const BASELINE_FLAG = "--baseline" as const;
export const OUT_FLAG = "--out" as const;

/** The exit codes of the verb (annex G §G.4; F108-FR-031). */
export const OK_EXIT_CODE = 0 as const;
export const PROBLEM_EXIT_CODE = REFUSED_EXIT_CODE;
export const MISSING_ARGUMENT_EXIT_CODE = USAGE_EXIT_CODE;

/**
 * B-1603, B-1617 — a missing `--baseline` or `--out` is a USAGE error with exit
 * 2, which is what the as-is argument parser gave. The text is not pinned by
 * the as-is code (argparse wrote it); the code is.
 */
export function missingArgumentMessage(what: string): string {
  return `guard: ${what} is required`;
}

/** The three arguments of the verb, as the command line gave them. */
export type GuardArguments = {
  /** The source tree to re-walk; `realpath`ed (B-1616). */
  readonly src: string;
  /** The baseline inventory: the location of `reverse:<slug>:inventory`. */
  readonly baseline: string;
  /** The output directory, excluded from the comparison and named in the failure line. */
  readonly out: string;
};

/**
 * F108-FR-027 — the argument list of the verb, exactly as `commands.ts` builds
 * it for a `guard-N` command: one positional source, then `--baseline` and
 * `--out`. A missing one of the three is a usage error with exit 2; an unknown
 * flag is one too, so that a typo never silently widens the comparison.
 */
export function parseGuardArguments(argv: readonly string[]): GuardArguments {
  let src: string | undefined;
  let baseline: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const word = argv[i] as string;
    if (word === BASELINE_FLAG || word === OUT_FLAG) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new ReverseError(
          missingArgumentMessage(word),
          "guard-missing-argument",
          MISSING_ARGUMENT_EXIT_CODE,
        );
      }
      if (word === BASELINE_FLAG) baseline = value;
      else out = value;
      i += 1;
      continue;
    }
    if (word.startsWith("-")) {
      throw new ReverseError(
        `guard: unrecognized argument ${word}`,
        "guard-unknown-flag",
        MISSING_ARGUMENT_EXIT_CODE,
      );
    }
    if (src === undefined) {
      src = word;
      continue;
    }
    throw new ReverseError(
      `guard: unrecognized argument ${word}`,
      "guard-extra-argument",
      MISSING_ARGUMENT_EXIT_CODE,
    );
  }
  for (const [value, what] of [
    [src, "source"],
    [baseline, BASELINE_FLAG],
    [out, OUT_FLAG],
  ] as const) {
    if (value === undefined) {
      throw new ReverseError(
        missingArgumentMessage(what),
        "guard-missing-argument",
        MISSING_ARGUMENT_EXIT_CODE,
      );
    }
  }
  return Object.freeze({
    src: realSourceOfTheGuard(src as string),
    baseline: baseline as string,
    out: out as string,
  });
}

/**
 * B-1616 — the source is the REAL path of the positional argument, as the
 * inventory records its own `src`. A path that does not exist keeps its
 * absolute form, so that the message of a later refusal names what was asked
 * for.
 */
export function realSourceOfTheGuard(src: string): string {
  const absolute = resolvePath(src);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/* ------------------------------------------------------------------------- *
 * The baseline (F108-FR-027)
 * ------------------------------------------------------------------------- */

/**
 * F108-FR-027 — the baseline, read through `readInventory`: by the resolved
 * location of the logical name `reverse:<slug>:inventory` and through its
 * schema `specstride.reverse-inventory/1`. The two refusals the requirement
 * names — `cannot read inventory <path>: <error>` and `not an inventory:
 * <path>`, both exit 3 — and the refusal of a missing or unknown `schema` come
 * from there, so the guard and the plan refuse one baseline for one reason.
 */
export function baselineOf(path: string): ReadInventory {
  return readInventory(path);
}

/* ------------------------------------------------------------------------- *
 * The comparison (F108-FR-027, F108-FR-028)
 * ------------------------------------------------------------------------- */

/** The `(bytes, sha256)` of one entry, which is all the guard compares. */
export type SizeAndHash = { readonly bytes: number; readonly sha256: string };

/**
 * B-1855 — the baseline's walked AND skipped entries, by path. A skipped entry
 * carries `bytes` and `sha256` too (F140-FR-020), which is what lets the guard
 * catch a change to a binary or an oversize file.
 */
export function baselineEntries(fields: InventoryFields): ReadonlyMap<string, SizeAndHash> {
  const byPath = new Map<string, SizeAndHash>();
  for (const entry of fields.files) {
    byPath.set(entry.path, { bytes: entry.bytes, sha256: entry.sha256 });
  }
  for (const entry of fields.skipped) {
    byPath.set(entry.path, { bytes: entry.bytes, sha256: entry.sha256 });
  }
  return byPath;
}

/** The three sorted lists of the comparison (F108-FR-028). */
export type Comparison = {
  readonly deleted: readonly string[];
  readonly added: readonly string[];
  readonly changed: readonly string[];
};

/**
 * B-1855 — the comparison of `(bytes, sha256)` per path. A path of the baseline
 * the re-walk did not find is `deleted`, a path the re-walk found that the
 * baseline does not hold is `added`, and a path whose size or hash differs is
 * `changed`. Each list is sorted by code point (F108-FR-028: "paths inside each
 * kind are sorted").
 */
export function compareEntries(
  baseline: ReadonlyMap<string, SizeAndHash>,
  walked: readonly WalkedEntry[],
): Comparison {
  const now = new Map<string, SizeAndHash>();
  for (const entry of walked) now.set(entry.path, { bytes: entry.bytes, sha256: entry.sha256 });
  const deleted: string[] = [];
  const added: string[] = [];
  const changed: string[] = [];
  for (const [path, was] of baseline) {
    const is = now.get(path);
    if (is === undefined) {
      deleted.push(path);
      continue;
    }
    if (is.bytes !== was.bytes || is.sha256 !== was.sha256) changed.push(path);
  }
  for (const path of now.keys()) {
    if (!baseline.has(path)) added.push(path);
  }
  return Object.freeze({
    deleted: Object.freeze(deleted.sort(byCodePoint)),
    added: Object.freeze(added.sort(byCodePoint)),
    changed: Object.freeze(changed.sort(byCodePoint)),
  });
}

/* ------------------------------------------------------------------------- *
 * The problems (F108-FR-028)
 * ------------------------------------------------------------------------- */

/** F108-FR-028 — the line a deleted path gives. */
export function deletedProblem(path: string): string {
  return `deleted: ${path}`;
}

/** F108-FR-028 — the line an added path gives. */
export function addedProblem(path: string): string {
  return `added: ${path}`;
}

/** F108-FR-028 — the line a changed path gives. */
export function changedProblem(path: string): string {
  return `changed: ${path}`;
}

/**
 * F108-FR-028 (B-1729) — the line a differing fingerprint gives when no path
 * differs. It names no path, because there is none to name.
 */
export const FINGERPRINT_PROBLEM = "fingerprint differs from the baseline" as const;

/**
 * F108-FR-028 — the problems of the comparison, in the order of the closed set
 * "Kinds of problem of the reverse guard" (row 156): `deleted`, then `added`,
 * then `changed`, and `fingerprint differs from the baseline` only where the
 * three are empty.
 *
 * The caller reaches this ONLY where the fingerprints differ (F108-FR-027: "The
 * comparison of single files MUST happen only when the fingerprint of the
 * re-walk differs from the baseline's"), which is why an empty comparison still
 * yields a problem here.
 */
export function problemsOfTheComparison(comparison: Comparison): readonly string[] {
  const problems: string[] = [];
  for (const path of comparison.deleted) problems.push(deletedProblem(path));
  for (const path of comparison.added) problems.push(addedProblem(path));
  for (const path of comparison.changed) problems.push(changedProblem(path));
  if (problems.length === 0) problems.push(FINGERPRINT_PROBLEM);
  return Object.freeze(problems);
}

/** F108-FR-028 (B-1862) — de-duplicated, in the order first seen. */
export function deduplicated(problems: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const problem of problems) {
    if (seen.has(problem)) continue;
    seen.add(problem);
    kept.push(problem);
  }
  return Object.freeze(kept);
}

/* ------------------------------------------------------------------------- *
 * `testautomation/` (F108-FR-029)
 * ------------------------------------------------------------------------- */

/**
 * F108-FR-029 (B-1730) — the suffix every `testautomation/` problem carries.
 * The phrase names the state directory as at the baseline: the words are "the
 * state dir", which is how the as-is line read.
 */
export const TESTAUTOMATION_SUFFIX =
  " (verification output landed in the source; pass --test-plan/--generate-tests under the state dir)" as const;

/** The path of the directory as the problems name it: with its trailing `/`. */
export const TESTAUTOMATION_PATH = `${TESTAUTOMATION_DIRECTORY}/` as const;

/**
 * The files under the source's `testautomation/`, source-relative and with the
 * directory as their first component, each with its size and hash — the shape
 * of the baseline's snapshot (F140-FR-021). Links are read as links, never
 * followed (F108-FR-032); a directory contributes nothing of its own.
 */
export function testautomationNow(src: string): ReadonlyMap<string, SizeAndHash> {
  const found = new Map<string, SizeAndHash>();
  const stack: string[] = [TESTAUTOMATION_DIRECTORY];
  while (stack.length > 0) {
    const directory = stack.pop() as string;
    let listing;
    try {
      listing = readdirSync(join(src, directory), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of listing) {
      const relative = `${directory}/${child.name}`;
      if (child.isDirectory() && !child.isSymbolicLink()) {
        stack.push(relative);
        continue;
      }
      const entry = entryOf(src, relative);
      if (entry !== undefined) found.set(relative, { bytes: entry.bytes, sha256: entry.sha256 });
    }
  }
  return found;
}

/** True where the source holds a `testautomation/` directory right now. */
export function testautomationExists(src: string): boolean {
  const path = join(src, TESTAUTOMATION_DIRECTORY);
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True where the baseline's file list already holds a path under the directory. */
export function baselineListsTestautomationFiles(fields: InventoryFields): boolean {
  const under = (path: string): boolean => path.startsWith(TESTAUTOMATION_PATH);
  return (
    fields.files.some((entry) => under(entry.path)) ||
    fields.skipped.some((entry) => under(entry.path))
  );
}

/**
 * F108-FR-029 — the problems of `testautomation/`, which the walk never enters
 * (B-1857):
 *
 *  - the baseline has NO snapshot (the field is absent — a baseline that
 *    predates it, B-1858): a `testautomation/` that exists now is
 *    `added: testautomation/ (...)`, UNLESS the baseline already lists files
 *    under it, in which case the ordinary comparison covered them;
 *  - the snapshot is `null` (the directory did not exist at baseline time,
 *    F140-FR-021) and the directory exists now: `added: testautomation/ (...)`
 *    (B-1731);
 *  - the snapshot is a map: a file that is new is `added: <path> (...)`, a file
 *    whose size or hash differs is `changed: <path> (...)`, and a file that is
 *    GONE is not reported at all (B-1857: "deletions there are not reported").
 *
 * Paths are sorted by code point inside each kind, as F108-FR-028 requires of
 * every kind.
 */
export function testautomationProblems(
  src: string,
  fields: InventoryFields,
  snapshotIsAbsent: boolean,
): readonly string[] {
  const snapshot: InventoryTestAutomation = fields.testautomation;
  const exists = testautomationExists(src);
  if (snapshotIsAbsent) {
    if (!exists) return Object.freeze([]);
    if (baselineListsTestautomationFiles(fields)) return Object.freeze([]);
    return Object.freeze([`${addedProblem(TESTAUTOMATION_PATH)}${TESTAUTOMATION_SUFFIX}`]);
  }
  if (snapshot === null) {
    if (!exists) return Object.freeze([]);
    return Object.freeze([`${addedProblem(TESTAUTOMATION_PATH)}${TESTAUTOMATION_SUFFIX}`]);
  }
  const now = testautomationNow(src);
  const added: string[] = [];
  const changed: string[] = [];
  for (const [path, is] of now) {
    const was = snapshot[path];
    if (was === undefined) {
      added.push(path);
      continue;
    }
    if (was[0] !== is.bytes || was[1] !== is.sha256) changed.push(path);
  }
  return Object.freeze([
    ...added.sort(byCodePoint).map((path) => `${addedProblem(path)}${TESTAUTOMATION_SUFFIX}`),
    ...changed.sort(byCodePoint).map((path) => `${changedProblem(path)}${TESTAUTOMATION_SUFFIX}`),
  ]);
}

/* ------------------------------------------------------------------------- *
 * The git checks (F108-FR-030)
 * ------------------------------------------------------------------------- */

/** F108-FR-030 (B-1732) — the line a moved HEAD gives. */
export function headMovedProblem(was: string | null, is: string | null): string {
  return `git HEAD moved: ${was} -> ${is}`;
}

/** F108-FR-030 (B-1733) — the line a new status entry gives. */
export function statusProblem(entry: string): string {
  return `git status: ${entry}`;
}

/** What the git checks are measured against. */
export type GitExemptions = {
  /** The output directory, source-relative; a status entry under it is exempt. */
  readonly out: string | undefined;
  /** The workspace part, source-relative; a status entry under it is exempt. */
  readonly statePart: string | undefined;
};

/** True where a source-relative path lies at or under a directory. */
export function isAtOrUnder(path: string, directory: string | undefined): boolean {
  if (directory === undefined || directory === "") return false;
  return path === directory || path.startsWith(`${directory}/`);
}

/**
 * F108-FR-030 (B-1860, B-1861) — a status entry is EXEMPT when its path lies
 * under the output directory or under the workspace part, or when the entry is
 * one the baseline already carried. The last exemption is what lets a tree that
 * was dirty before the run pass.
 */
export function isAnExemptStatusEntry(
  entry: string,
  baselineStatus: readonly string[],
  exemptions: GitExemptions,
): boolean {
  if (baselineStatus.includes(entry)) return true;
  const path = pathOfAStatusEntry(entry);
  return isAtOrUnder(path, exemptions.out) || isAtOrUnder(path, exemptions.statePart);
}

/**
 * F108-FR-030 — the git problems. They are produced ONLY where the baseline was
 * walked in git mode (B-1859); the caller decides that from `fields.walk`, and
 * this function is never reached otherwise.
 */
export function gitProblems(
  fields: InventoryFields,
  currentHead: string | null,
  currentStatus: readonly string[],
  exemptions: GitExemptions,
): readonly string[] {
  const problems: string[] = [];
  if (currentHead !== fields.git_head) {
    problems.push(headMovedProblem(fields.git_head, currentHead));
  }
  const baselineStatus = fields.git_status ?? [];
  for (const entry of currentStatus) {
    if (isAnExemptStatusEntry(entry, baselineStatus, exemptions)) continue;
    problems.push(statusProblem(entry));
  }
  return Object.freeze(problems);
}

/* ------------------------------------------------------------------------- *
 * What can never be a problem (F108-FR-032)
 * ------------------------------------------------------------------------- */

/**
 * F108-FR-032 — "the counter files and transcripts of stub agents, which lie
 * outside the working tree, and the control plane MUST never count as a change
 * of the source". This is a STRUCTURAL guarantee, not a list of exemptions: the
 * re-walk's candidates are source-relative paths under the source, the git
 * status entries are source-relative too, and the control plane
 * (`<control>`, annex B) lies outside the working tree. A path outside the
 * source is therefore never a candidate, never an entry and never a problem.
 *
 * This predicate STATES the guarantee so that a test can measure it.
 */
export function isOutsideTheWorkingTree(src: string, path: string): boolean {
  const from = relativePath(src, resolvePath(path));
  return from === "" ? false : from === ".." || from.startsWith(`..${sep}`);
}

/* ------------------------------------------------------------------------- *
 * The printing and the exit codes (F108-FR-031)
 * ------------------------------------------------------------------------- */

/** F108-FR-031 (B-1738) — each problem on standard output as `guard: <problem>`. */
export function problemLine(problem: string): string {
  return `guard: ${problem}`;
}

/** F108-FR-031 (B-1739) — the failure line. The dash is an em dash. */
export function guardFailedLine(count: number, out: string): string {
  return `guard: FAILED — ${count} change(s) outside ${out} and the state dir`;
}

/** F108-FR-031 (B-1740) — the success line. The dash is an em dash. */
export const GUARD_OK_LINE =
  "guard: ok — source untouched outside the output and state dirs" as const;

/**
 * F108-FR-031 — the lines of standard output: one per problem, then the failure
 * line, or the success line alone where there is no problem.
 */
export function guardLines(problems: readonly string[], out: string): readonly string[] {
  if (problems.length === 0) return Object.freeze([GUARD_OK_LINE]);
  return Object.freeze([...problems.map(problemLine), guardFailedLine(problems.length, out)]);
}

/** F108-FR-031 (B-1625, B-1626) — 3 where there is a problem, 0 where there is none. */
export function guardExitCode(problems: readonly string[]): number {
  return problems.length === 0 ? OK_EXIT_CODE : PROBLEM_EXIT_CODE;
}

/* ------------------------------------------------------------------------- *
 * The verb
 * ------------------------------------------------------------------------- */

/** What the verb is run with. */
export type GuardInput = {
  /** The argument list AFTER `reverse guard`, as `commands.ts` builds it. */
  readonly argv: readonly string[];
  /** The roots of the machine, for the workspace part of the git exemption. */
  readonly roots?: RootPaths;
  /** The git seam; the default runs `git` as a process. */
  readonly git?: GitRunner;
};

/** What the verb produced: the surfaces the parity test compares. */
export type GuardResult = {
  readonly arguments: GuardArguments;
  /** The fingerprint of the re-walk, and the baseline's. */
  readonly fingerprint: string;
  readonly baselineFingerprint: string;
  /** The comparison; empty where the fingerprints agree (F108-FR-027). */
  readonly comparison: Comparison;
  /** Every problem, de-duplicated and in the order first seen. */
  readonly problems: readonly string[];
  /** The lines of standard output, in order. */
  readonly lines: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

/**
 * The source-relative form of a path, or `undefined` where it lies outside the
 * source. A path that is not absolute is resolved against the SOURCE, never
 * against the working directory of the process: the output directory of a
 * reverse run lies inside the source tree (F108-FR-025), and a `guard-N`
 * command runs with the source as its working directory, so the two readings
 * agree — but the guard must not depend on where it was called from.
 */
export function sourceRelative(src: string, path: string | undefined): string | undefined {
  if (path === undefined || path === "") return undefined;
  const absolute = isAbsolute(path) ? resolvePath(path) : resolvePath(src, path);
  const from = relativePath(src, absolute);
  if (from === "" || from === ".." || from.startsWith(`..${sep}`)) return undefined;
  return from.split(sep).join("/");
}

/**
 * The guard, end to end. It reads, compares and prints; it writes nothing.
 *
 * The order of the problems is the order of the closed set of row 156 and of
 * `data-model.md`: the paths of the comparison first, then `testautomation/`,
 * then the fingerprint line where no path differed, then the git checks — and
 * the whole list is de-duplicated in the order first seen (B-1862).
 */
export function guard(input: GuardInput): GuardResult {
  const args = parseGuardArguments(input.argv);
  const read = baselineOf(args.baseline);
  const fields = read.fields;
  const snapshotIsAbsent = !hasATestautomationSnapshot(read);
  const outRelative = sourceRelative(args.src, args.out);
  const excludes = guardExcludes(fields.excludes, outRelative);
  const run = input.git ?? spawnGit;
  const mode = fields.walk === "git" ? "git" : "walk";
  const listing = mode === "git" ? gitListing(args.src, run) : undefined;
  const walked = reWalk({ src: args.src, mode, excludes, listing });

  const problems: string[] = [];
  let comparison: Comparison = Object.freeze({ deleted: [], added: [], changed: [] });
  // F108-FR-027 — single files are compared ONLY where the fingerprints differ.
  if (walked.fingerprint !== fields.fingerprint) {
    comparison = compareEntries(baselineEntries(fields), walked.entries);
    problems.push(...problemsOfTheComparison(comparison));
  }
  problems.push(...testautomationProblems(args.src, fields, snapshotIsAbsent));
  if (mode === "git") {
    const exemptions: GitExemptions = Object.freeze({
      out: outRelative,
      statePart: sourceRelative(args.src, input.roots?.["<workspace-part>"]),
    });
    problems.push(
      ...gitProblems(fields, gitHead(args.src, run), gitStatus(args.src, run), exemptions),
    );
  }

  const unique = deduplicated(problems);
  const lines = guardLines(unique, args.out);
  return Object.freeze({
    arguments: args,
    fingerprint: walked.fingerprint,
    baselineFingerprint: fields.fingerprint,
    comparison,
    problems: unique,
    lines,
    stdout: `${lines.join("\n")}\n`,
    stderr: "",
    exitCode: guardExitCode(unique),
  });
}

/**
 * B-1858 — whether the baseline document carries the KEY `testautomation` at
 * all. A baseline that predates the snapshot has no such key, and that is a
 * different case from a key whose value is `null`: the first reports any
 * `testautomation/` as added unless the baseline lists files under it
 * (F108-FR-029), the second reports it as added outright.
 *
 * `InventoryFields` projects the key to `null` in both cases, so this one
 * distinction is read off the document the SAME reader returned — never off a
 * second read of the file, which could see other bytes.
 */
export function hasATestautomationSnapshot(read: ReadInventory): boolean {
  return "testautomation" in (read.inventory as unknown as Readonly<Record<string, unknown>>);
}

/**
 * F108-FR-031 (B-1627) — an `InventoryError` or a `ReverseError` in any verb is
 * written to standard error as `reverse: <message>`, with the error's own exit
 * code: 3 for a refusal, and 2 for the usage error of a missing argument.
 */
export function runGuard(input: GuardInput): GuardResult {
  try {
    return guard(input);
  } catch (error) {
    if (error instanceof ReverseError || error instanceof InventoryError) {
      return failed(error.message, (error as { exitCode?: number }).exitCode ?? PROBLEM_EXIT_CODE);
    }
    if (error instanceof Error) return failed(error.message, PROBLEM_EXIT_CODE);
    throw error;
  }
}

/** The result of a refused or failed guard: nothing on standard output. */
function failed(message: string, exitCode: number): GuardResult {
  return Object.freeze({
    arguments: Object.freeze({ src: "", baseline: "", out: "" }),
    fingerprint: "",
    baselineFingerprint: "",
    comparison: Object.freeze({ deleted: [], added: [], changed: [] }),
    problems: Object.freeze([]),
    lines: Object.freeze([]),
    stdout: "",
    stderr: `${reverseErrorLine(message)}\n`,
    exitCode,
  });
}

/**
 * Re-exported so that a caller of the guard — and the parity test — has the
 * fingerprint rule of F140-FR-021 to hand without reaching into `walk.ts`.
 */
export { fingerprintOfEntries };
