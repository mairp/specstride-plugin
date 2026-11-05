// T034 (F116-FR-005, F116-FR-006; IR-11, IR-31) — the comparison before and
// after a check and the conditions `tainted` and `changed-during-check`.
//
// A result is a pass only when both readings (before and after) are equal,
// apart from the paths the check manifest declares as written by that command.
// Otherwise the result carries `tainted` with the reason `changed-during-check`
// (F116-FR-005) or `protected-set-changed` (F116-FR-006, a difference against
// phase entry). `tainted` is never a pass; the exit result is kept in its own
// field; the verification gate still runs and the run is not blocked.
import { isAuthorised, type Authorisation } from "./authorise.ts";

export type Tainted = false | { reason: string };

export interface Conditions {
  tainted: Tainted;
  cached: Tainted;
  flaky: Tainted;
  interrupted: Tainted;
  unchecked: Tainted;
}

export const CLEAN_CONDITIONS: Conditions = {
  tainted: false,
  cached: false,
  flaky: false,
  interrupted: false,
  unchecked: false,
};

export interface AroundCheckInput {
  treeBefore: string;
  treeAfter: string;
  changedPaths: string[];
  declaredWrites: string[];
  authorised: Authorisation;
  taskId?: string;
}

export interface AroundCheckVerdict {
  conditions: Conditions;
  isPass: boolean;
  gateStillRuns: boolean;
  blocked: false;
  changedPaths: string[];
}

/** The comparison immediately before and immediately after one check. */
export function compareAroundCheck(input: AroundCheckInput): AroundCheckVerdict {
  const declared = new Set(input.declaredWrites);
  const unexpected = input.changedPaths.filter((p) => !declared.has(p));
  const tainted: Tainted = unexpected.length > 0 ? { reason: "changed-during-check" } : false;
  return {
    conditions: { ...CLEAN_CONDITIONS, tainted },
    isPass: tainted === false,
    gateStillRuns: true,
    blocked: false,
    changedPaths: unexpected,
  };
}

export interface PhaseEntryComparisonInput {
  classAFiles: { atEntry: string[]; now: string[] };
  classB: { atEntry: string[]; now: string[] };
  authorised: Authorisation;
  taskId?: string;
  /** Paths whose content changed although the path lists still match. */
  contentChanged?: string[];
}

export interface PhaseEntryComparison {
  tainted: Tainted;
  changedPaths: string[];
  authorisedPaths: string[];
}

/**
 * The comparison of the protected set against phase entry: class A differing,
// or class B differing without authorisation, taints with the reason
 * `protected-set-changed`. An authorised change does not taint and is listed.
 */
export function compareAgainstPhaseEntry(input: PhaseEntryComparisonInput): PhaseEntryComparison {
  const atEntry = new Set([...input.classAFiles.atEntry, ...input.classB.atEntry]);
  const now = new Set([...input.classAFiles.now, ...input.classB.now]);
  const changed: string[] = [];
  for (const p of atEntry) if (!now.has(p)) changed.push(p);
  for (const p of now) if (!atEntry.has(p)) changed.push(p);
  for (const p of input.contentChanged ?? []) if (!changed.includes(p)) changed.push(p);
  changed.sort();
  const unauthorised = changed.filter(
    (p) => input.taskId === undefined || !isAuthorised(input.authorised, input.taskId, p),
  );
  const authorisedPaths = changed.filter((p) => !unauthorised.includes(p));
  return {
    tainted: unauthorised.length > 0 ? { reason: "protected-set-changed" } : false,
    changedPaths: unauthorised,
    authorisedPaths,
  };
}

/** Put conditions in their own field of the result; never touch `exit`. */
export function annotateResult<
  R extends { commands: { id: string; exit: number | null; conditions: Conditions }[] },
>(result: R, commandConditions: Conditions): R {
  return {
    ...result,
    commands: result.commands.map((c) => ({ ...c, conditions: commandConditions })),
  };
}

/** A unit of work whose check carries `tainted` is not recorded as kept. */
export function notKept(conditions: { tainted: Tainted }): boolean {
  return conditions.tainted === false;
}
