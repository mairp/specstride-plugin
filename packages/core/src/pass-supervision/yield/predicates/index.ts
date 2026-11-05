/**
 * T044 of feature 118 — the six as-is predicates of a yield (F118-FR-018;
 * contract `yield-predicates.md`; PT-118-C-058-predicate-<kind>).
 *
 * A predicate returns 0 (satisfied), 1 (not yet) or 2 (unsatisfiable); an
 * unsatisfiable predicate ends the wait with the outcome `timeout`, failing
 * closed. The seventh kind, `first_failure`, lives in `failfast/` (the
 * first-failure predicate, F118-FR-038) and is not evaluated here.
 *
 * Every file read goes through the `FileReader` port, every liveness check
 * through the `ProcessList` port and the `command` run through a runner that
 * the edge hands in: no file or process access inside the core.
 */
import type { FileReader, ProcessList } from "../../ports.ts";
import { compilePattern } from "../schema/index.ts";

/** The three results of the evaluation of a predicate (row 114 of annex X §X.6). */
export const PREDICATE_SATISFIED = 0;
export const PREDICATE_NOT_YET = 1;
export const PREDICATE_UNSATISFIABLE = 2;

/** The default age at which a file counts as stable, in seconds (F118-FR-018). */
export const FILE_STABLE_DEFAULT_SEC = 60;

/** The time limit of the `command` predicate, in seconds (F118-FR-018). */
export const COMMAND_LIMIT_SEC = 120;

/** The tail of the file the `grep` predicate reads, in bytes (the last 4 MiB). */
export const GREP_WINDOW_BYTES = 4 * 1024 * 1024;

/** A fixed-argument-list run, no shell, output discarded (the edge implements it). */
export interface CommandRunner {
  /** Run `argv` in `cwd` with no shell; `undefined` when the command cannot be run. */
  run(argv: readonly string[], cwd: string, limitMs: number): { exitCode: number } | undefined;
}

/** What one evaluation of a predicate is given. */
export interface PredicateInput {
  readonly kind: string;
  readonly nowMs: number;
  /** The pid of the launched or adopted job, when the runtime knows one. */
  readonly jobPid: number | undefined;
  /** The working directory of the job (the `command` predicate runs there). */
  readonly cwd: string;
  readonly path?: string | undefined;
  readonly pattern?: string | undefined;
  readonly stableSec?: number | undefined;
  readonly pid?: number | undefined;
  readonly argv?: readonly string[] | undefined;
}

/** The dependencies one evaluation needs, all of them ports. */
export interface PredicateDeps {
  readonly files: FileReader;
  readonly processes: ProcessList;
  readonly runner: CommandRunner;
  /** True when the consumer has allowed the `command` predicate (F118-FR-015). */
  readonly commandAllowed: boolean;
}

/** The `pid` predicate: satisfied when the target is no longer alive; never unsatisfiable. */
export function pidPredicate(input: PredicateInput, deps: PredicateDeps): number {
  const target = input.pid ?? input.jobPid;
  if (target === undefined) return PREDICATE_NOT_YET;
  // The process list answers for the whole host: the target is alive when it
  // is listed anywhere (it is not in the pass tree — it has its own session).
  const alive =
    deps.processes.tree(target).some((p) => p.pid === target) || hostListsPid(deps, target);
  return alive ? PREDICATE_NOT_YET : PREDICATE_SATISFIED;
}

function hostListsPid(deps: PredicateDeps, pid: number): boolean {
  // The fake lists only the pass tree; a detached job is probed by asking for
  // a tree rooted at its own pid, which exists exactly while it is alive.
  return deps.processes.tree(pid).length > 0;
}

/** The `exit_code_file` predicate: satisfied when the path (default the job's own) exists. */
export function exitCodeFilePredicate(input: PredicateInput, deps: PredicateDeps): number {
  const path = input.path ?? defaultExitCodeFile(input.cwd);
  return deps.files.identify(path) !== undefined ? PREDICATE_SATISFIED : PREDICATE_NOT_YET;
}

/** The exit-code file of a job the runtime launched, in its own directory. */
export function defaultExitCodeFile(cwd: string): string {
  return `${cwd}/exit-code`;
}

/** The `file_exists` predicate: satisfied when the resolved path exists. */
export function fileExistsPredicate(input: PredicateInput, deps: PredicateDeps): number {
  if (input.path === undefined) return PREDICATE_UNSATISFIABLE;
  return deps.files.identify(input.path) !== undefined ? PREDICATE_SATISFIED : PREDICATE_NOT_YET;
}

/** The `file_stable` predicate: the file is at least `stable_sec` old; missing is not yet stable. */
export function fileStablePredicate(input: PredicateInput, deps: PredicateDeps): number {
  if (input.path === undefined) return PREDICATE_UNSATISFIABLE;
  const identified = deps.files.identify(input.path);
  if (identified === undefined) return PREDICATE_NOT_YET;
  const stableSec = input.stableSec ?? FILE_STABLE_DEFAULT_SEC;
  const ageMs = input.nowMs - identified.modifiedAtMs;
  return ageMs >= stableSec * 1000 ? PREDICATE_SATISFIED : PREDICATE_NOT_YET;
}

/** The `grep` predicate: the pattern matches within the last 4 MiB of the file. */
export function grepPredicate(input: PredicateInput, deps: PredicateDeps): number {
  if (input.path === undefined || input.pattern === undefined) return PREDICATE_UNSATISFIABLE;
  const compiled = compilePattern(input.pattern);
  if (compiled === undefined) return PREDICATE_UNSATISFIABLE;
  const slice = deps.files.readAfter(input.path, 0);
  if (slice === undefined) return PREDICATE_NOT_YET;
  const from = Math.max(0, slice.bytes.length - GREP_WINDOW_BYTES);
  const text = new TextDecoder().decode(slice.bytes.subarray(from));
  return compiled.test(text) ? PREDICATE_SATISFIED : PREDICATE_NOT_YET;
}

/** The `command` predicate: exit 0 satisfies; unrunnable or disallowed is unsatisfiable. */
export function commandPredicate(input: PredicateInput, deps: PredicateDeps): number {
  if (!deps.commandAllowed) return PREDICATE_UNSATISFIABLE;
  if (input.argv === undefined || input.argv.length === 0) return PREDICATE_UNSATISFIABLE;
  const result = deps.runner.run(input.argv, input.cwd, COMMAND_LIMIT_SEC * 1000);
  if (result === undefined) return PREDICATE_UNSATISFIABLE;
  return result.exitCode === 0 ? PREDICATE_SATISFIED : PREDICATE_NOT_YET;
}

/** Evaluate one of the six as-is kinds; an unknown kind is unsatisfiable (fail closed). */
export function evaluatePredicate(input: PredicateInput, deps: PredicateDeps): number {
  switch (input.kind) {
    case "pid":
      return pidPredicate(input, deps);
    case "exit_code_file":
      return exitCodeFilePredicate(input, deps);
    case "file_exists":
      return fileExistsPredicate(input, deps);
    case "file_stable":
      return fileStablePredicate(input, deps);
    case "grep":
      return grepPredicate(input, deps);
    case "command":
      return commandPredicate(input, deps);
    default:
      return PREDICATE_UNSATISFIABLE;
  }
}

/** True when the kind is one of the six as-is kinds (not `first_failure`). */
export function isAsIsKind(kind: string): boolean {
  return ["pid", "exit_code_file", "file_exists", "file_stable", "grep", "command"].includes(kind);
}
