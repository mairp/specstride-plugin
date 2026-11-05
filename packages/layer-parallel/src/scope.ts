/**
 * T018 and T019 — write scopes of the layer `parallel` (feature 142).
 *
 * T018 (F142-FR-009; rules PU-11, PU-12, PU-99): a scope is a list of path
 * prefixes relative to the root of the workspace, normalised — no leading
 * current-directory segment, no parent segment, no absolute path, no trailing
 * separator. A path with a parent segment is refused. Two scopes overlap when
 * a prefix of one equals or is an ancestor of a prefix of the other, compared
 * **at path boundaries**, so that `src/a` does not match `src/ab`. An empty or
 * absent list means the whole tree and overlaps everything. Where the file
 * system ignores case, scopes and the paths of a delta are compared after case
 * folding and Unicode normalisation.
 *
 * T019 (F142-FR-010; rule PU-12, ruling 35): a scope comes from one of two
 * sources, in this order — a declaration by the consumer, keyed by task id, in
 * user configuration or in the promoted launch contract; otherwise the paths
 * that the text of the task itself names, as read at launch. Project
 * configuration may remove a task from eligibility and may narrow a scope; it
 * may not add or widen one, and such a declaration is refused with a doctor
 * line. Nothing the proposer writes is a source of a scope.
 *
 * The module is pure: it reads no file, starts no process and holds no state.
 * The one fact it cannot compute — whether the file system of the workspace
 * ignores case — arrives as the flag `caseFolds`, which the engine takes from
 * a probe at launch (F142-FR-009; `WriteScope.caseFolded` of `types.ts`).
 */
import { SCOPE_SOURCES, prefixFormBroken } from "./types.ts";
import type { PrefixFormRule, ScopeSource, WriteScope } from "./types.ts";

/* ================================================================== *
 * 1. The form of a prefix and its normalisation (F142-FR-009).
 * ================================================================== */

/** The separator of a path prefix: scopes are written with `/` whatever the host. */
export const SEPARATOR = "/" as const;

/**
 * The prefix that means the whole tree. A list that holds it, and an empty or
 * absent list, both mean the whole tree and overlap everything.
 */
export const WHOLE_TREE = "" as const;

/** A prefix that was normalised, or the rule of `PREFIX_FORM` it breaks. */
export type NormalisedPrefix = { readonly prefix: string } | { readonly refused: PrefixFormRule };

/** True where the normalisation refused the prefix. */
export function isRefused(
  result: NormalisedPrefix,
): result is { readonly refused: PrefixFormRule } {
  return "refused" in result;
}

/**
 * Normalise one prefix (F142-FR-009). A leading current-directory segment, a
 * trailing separator, a repeated separator and an inner `.` segment are
 * removed; an absolute path and a path with a parent segment are refused,
 * because neither can be read as a prefix inside the workspace.
 *
 * A prefix that normalises to nothing — `.`, `./`, `/`-free emptiness — is
 * `WHOLE_TREE`, which is the whole tree.
 */
export function normalisedPrefix(prefix: string): NormalisedPrefix {
  if (prefix.startsWith(SEPARATOR)) {
    return Object.freeze({ refused: prefixFormBroken("/x") ?? "no absolute path" });
  }
  const segments = prefix.split(SEPARATOR);
  if (segments.includes("..")) {
    return Object.freeze({ refused: prefixFormBroken("../x") ?? "no parent segment" });
  }
  const kept = segments.filter((segment) => segment !== "" && segment !== ".");
  return Object.freeze({ prefix: kept.join(SEPARATOR) });
}

/** The normalisation of a whole list, or the first rule a prefix of it breaks. */
export type NormalisedScope =
  | { readonly prefixes: readonly string[] }
  | { readonly refused: PrefixFormRule; readonly prefix: string };

/**
 * Normalise a list of prefixes (F142-FR-009). The result keeps the order of
 * the list, drops a prefix that repeats another, and is refused as a whole as
 * soon as one prefix breaks the form: a scope that cannot be read is never
 * read half way.
 */
export function normalisedPrefixes(prefixes: readonly string[]): NormalisedScope {
  const out: string[] = [];
  for (const prefix of prefixes) {
    const one = normalisedPrefix(prefix);
    if (isRefused(one)) {
      return Object.freeze({ refused: one.refused, prefix });
    }
    if (!out.includes(one.prefix)) out.push(one.prefix);
  }
  return Object.freeze({ prefixes: Object.freeze(out) });
}

/**
 * Build a scope from a list of prefixes and the source it came from. The
 * `caseFolded` flag is set only where the file system of the workspace ignores
 * case, and only then does a comparison fold case (F142-FR-009, PU-99).
 */
export function writeScopeOf(
  prefixes: readonly string[],
  source: ScopeSource,
  caseFolds = false,
): NormalisedScope | WriteScope {
  const normalised = normalisedPrefixes(prefixes);
  if ("refused" in normalised) return normalised;
  return Object.freeze({
    prefixes: normalised.prefixes,
    source,
    caseFolded: caseFolds,
  });
}

/* ================================================================== *
 * 2. Comparison at path boundaries, with case folding (F142-FR-009).
 * ================================================================== */

/**
 * The form in which two paths are compared: Unicode normalisation always, and
 * case folding only where the file system ignores case (F142-FR-009, PU-99).
 */
export function foldForComparison(value: string, caseFolds: boolean): string {
  const normalised = value.normalize("NFC");
  return caseFolds ? normalised.toLowerCase() : normalised;
}

/**
 * True where `prefix` covers `path`: the two are equal, or the prefix is an
 * ancestor of the path **at a path boundary**, so that `src/a` covers
 * `src/a/one.ts` and never `src/ab` (F142-FR-009, PU-11).
 */
export function prefixCoversPath(prefix: string, path: string, caseFolds = false): boolean {
  const left = foldForComparison(prefix, caseFolds);
  const right = foldForComparison(path, caseFolds);
  if (left === WHOLE_TREE) return true;
  return right === left || right.startsWith(`${left}${SEPARATOR}`);
}

/**
 * True where two prefixes overlap: one equals the other, or one is an ancestor
 * of the other at a path boundary (F142-FR-009, PU-11).
 */
export function prefixesOverlapAtPathBoundaries(a: string, b: string, caseFolds = false): boolean {
  return prefixCoversPath(a, b, caseFolds) || prefixCoversPath(b, a, caseFolds);
}

/** True where a scope is the whole tree: an empty list, or a list that holds it. */
export function meansTheWholeTree(scope: WriteScope): boolean {
  return scope.prefixes.length === 0 || scope.prefixes.includes(WHOLE_TREE);
}

/**
 * True where two scopes overlap (F142-FR-009). The whole tree overlaps
 * everything, including another whole tree, which is why two tasks that
 * declare nothing are never in one group.
 */
export function scopesOverlap(a: WriteScope, b: WriteScope): boolean {
  const caseFolds = a.caseFolded === true || b.caseFolded === true;
  if (meansTheWholeTree(a) || meansTheWholeTree(b)) return true;
  return a.prefixes.some((left) =>
    b.prefixes.some((right) => prefixesOverlapAtPathBoundaries(left, right, caseFolds)),
  );
}

/** True where the scopes of a list are pairwise disjoint (the check `scope`). */
export function scopesAreDisjoint(scopes: readonly WriteScope[]): boolean {
  for (let i = 0; i < scopes.length; i += 1) {
    for (let j = i + 1; j < scopes.length; j += 1) {
      const left = scopes[i];
      const right = scopes[j];
      if (left === undefined || right === undefined) continue;
      if (scopesOverlap(left, right)) return false;
    }
  }
  return true;
}

/**
 * True where a path of a delta lies inside a scope (the scope audit of
 * F142-FR-054 uses this, compared at path boundaries and with the same
 * folding as the scope).
 */
export function pathIsInsideScope(path: string, scope: WriteScope): boolean {
  if (meansTheWholeTree(scope)) return true;
  return scope.prefixes.some((prefix) => prefixCoversPath(prefix, path, scope.caseFolded === true));
}

/** The paths of a delta that lie outside the scope, in the order they were given. */
export function pathsOutsideScope(paths: readonly string[], scope: WriteScope): readonly string[] {
  return Object.freeze(paths.filter((path) => !pathIsInsideScope(path, scope)));
}

/* ================================================================== *
 * 3. The two sources of a scope (F142-FR-010, row 186).
 * ================================================================== */

/** The two sources, in the order in which they are consulted (F142-FR-010). */
export const SCOPE_SOURCES_IN_ORDER: readonly ScopeSource[] = Object.freeze([
  SCOPE_SOURCES[0],
  SCOPE_SOURCES[1],
]);

/**
 * Nothing the proposer writes is a source of a scope (F142-FR-010): neither
 * phase evidence, nor a checkpoint, nor the notebook, nor the text a pass adds
 * to the task list. The two sources above are the whole list.
 */
export const PROPOSER_IS_NEVER_A_SOURCE = true as const;

/** The key of a declared scope in configuration (row 93 of annex X §X.7). */
export const SCOPE_KEY_PREFIX = "loop.parallel.scopes." as const;

/** The key that removes tasks from eligibility (row 94 of annex X §X.7). */
export const EXCLUDE_KEY = "loop.parallel.exclude" as const;

/** The key of a declared scope for one task. */
export function scopeKeyOf(taskId: string): string {
  return `${SCOPE_KEY_PREFIX}${taskId}`;
}

/** A declaration of scopes, keyed by task id, as one source of configuration holds it. */
export type ScopeDeclarations = Readonly<Record<string, readonly string[]>>;

/**
 * Where the declarations of a scope come from. `userConfiguration` and
 * `promotedLaunchContract` are the two widening places the consumer owns;
 * `projectConfiguration` may only narrow or exclude (F142-FR-010, ruling 35).
 */
export type ScopeConfiguration = {
  readonly userConfiguration?: ScopeDeclarations;
  readonly promotedLaunchContract?: ScopeDeclarations;
  readonly projectConfiguration?: ScopeDeclarations;
  /** `loop.parallel.exclude`: tasks removed from eligibility. */
  readonly exclude?: readonly string[];
};

/** One doctor line a refused declaration produces (F142-FR-010). */
export type DoctorLine = string;

/**
 * What the sources gave for one task: a scope, or a reason there is none. The
 * `doctorLines` are the lines a refused widening leaves for the doctor; they
 * are produced whatever the outcome.
 */
export type ScopeDecision =
  | {
      readonly kind: "scope";
      readonly scope: WriteScope;
      readonly doctorLines: readonly DoctorLine[];
    }
  | { readonly kind: "absent"; readonly doctorLines: readonly DoctorLine[] }
  | { readonly kind: "excluded"; readonly doctorLines: readonly DoctorLine[] }
  | {
      readonly kind: "refused";
      readonly reason: PrefixFormRule;
      readonly prefix: string;
      readonly doctorLines: readonly DoctorLine[];
    };

/** True where the decision carries a usable scope. */
export function hasAScope(decision: ScopeDecision): decision is {
  readonly kind: "scope";
  readonly scope: WriteScope;
  readonly doctorLines: readonly DoctorLine[];
} {
  return decision.kind === "scope";
}

/**
 * A token of the text of a task that looks like a path: at least one
 * separator, and only the characters a repository path uses. A token that
 * carries a scheme (`https://`) is not a path of the workspace and is left
 * out.
 */
const PATH_LIKE = /[A-Za-z0-9._][A-Za-z0-9._\-/]*\/[A-Za-z0-9._\-/]*[A-Za-z0-9._-]/g;

/**
 * The paths that the text of a task names, as read at launch (F142-FR-010,
 * the second source). A task whose text names no path gives an empty list,
 * which makes the task serial with the reason `scope` (F142-FR-011) and never
 * a worker with the whole tree.
 */
export function pathsNamedByTheTextOfATask(text: string): readonly string[] {
  const out: string[] = [];
  for (const match of text.matchAll(PATH_LIKE)) {
    const token = match[0];
    const at = match.index ?? 0;
    const before = text.slice(Math.max(0, at - 3), at);
    if (before.endsWith("://") || token.includes("://")) continue;
    if (!out.includes(token)) out.push(token);
  }
  return Object.freeze(out);
}

/**
 * True where a declaration of project configuration widens a scope: it names a
 * prefix that no prefix of the scope the consumer or the task text gave
 * covers. Such a declaration is refused with a doctor line (F142-FR-010,
 * ruling 35); only a prefix that lies inside the scope narrows it.
 */
export function projectConfigurationWidens(
  base: readonly string[],
  declared: readonly string[],
  caseFolds = false,
): readonly string[] {
  if (base.length === 0 || base.includes(WHOLE_TREE)) {
    // The base is the whole tree; nothing can widen it, every prefix narrows.
    return Object.freeze([]);
  }
  return Object.freeze(
    declared.filter(
      (prefix) => !base.some((inside) => prefixCoversPath(inside, prefix, caseFolds)),
    ),
  );
}

/** The doctor line of a refused widening (F142-FR-010). */
export function widenedScopeDoctorLine(taskId: string, prefixes: readonly string[]): DoctorLine {
  return (
    `${scopeKeyOf(taskId)} in project configuration widens the scope of ${taskId} ` +
    `(${prefixes.join(", ")}): refused, project configuration may only narrow a scope ` +
    `(F142-FR-010)`
  );
}

/**
 * The scope of one task (F142-FR-010). The sources are consulted in the order
 * of `SCOPE_SOURCES_IN_ORDER`: a declaration by the consumer in user
 * configuration, else in the promoted launch contract, else the paths the text
 * of the task names. Project configuration may exclude the task and may narrow
 * the scope; a prefix of it that widens the scope is refused with a doctor
 * line and does not reach the result.
 */
export function scopeOf(input: {
  readonly taskId: string;
  readonly text?: string;
  readonly configuration?: ScopeConfiguration;
  readonly caseFolds?: boolean;
}): ScopeDecision {
  const configuration = input.configuration ?? {};
  const caseFolds = input.caseFolds ?? false;
  const doctorLines: DoctorLine[] = [];

  if ((configuration.exclude ?? []).includes(input.taskId)) {
    return Object.freeze({ kind: "excluded", doctorLines: Object.freeze([]) });
  }

  const declaredByTheConsumer =
    configuration.userConfiguration?.[input.taskId] ??
    configuration.promotedLaunchContract?.[input.taskId];
  const source: ScopeSource =
    declaredByTheConsumer !== undefined ? SCOPE_SOURCES_IN_ORDER[0]! : SCOPE_SOURCES_IN_ORDER[1]!;
  const given = declaredByTheConsumer ?? pathsNamedByTheTextOfATask(input.text ?? "");

  const normalised = normalisedPrefixes(given);
  if ("refused" in normalised) {
    return Object.freeze({
      kind: "refused",
      reason: normalised.refused,
      prefix: normalised.prefix,
      doctorLines: Object.freeze([]),
    });
  }
  if (normalised.prefixes.length === 0) {
    return Object.freeze({ kind: "absent", doctorLines: Object.freeze([]) });
  }

  let prefixes: readonly string[] = normalised.prefixes;
  const fromTheProject = configuration.projectConfiguration?.[input.taskId];
  if (fromTheProject !== undefined) {
    const narrowed = normalisedPrefixes(fromTheProject);
    if ("refused" in narrowed) {
      return Object.freeze({
        kind: "refused",
        reason: narrowed.refused,
        prefix: narrowed.prefix,
        doctorLines: Object.freeze([]),
      });
    }
    const widening = projectConfigurationWidens(prefixes, narrowed.prefixes, caseFolds);
    if (widening.length > 0) {
      doctorLines.push(widenedScopeDoctorLine(input.taskId, widening));
    }
    const accepted = narrowed.prefixes.filter((prefix) => !widening.includes(prefix));
    if (accepted.length > 0) prefixes = Object.freeze(accepted);
  }

  return Object.freeze({
    kind: "scope",
    scope: Object.freeze({ prefixes: Object.freeze([...prefixes]), source, caseFolded: caseFolds }),
    doctorLines: Object.freeze([...doctorLines]),
  });
}

/** The scope decision of every task of a list, keyed by task id (a pure map). */
export function scopesOf(
  tasks: readonly { readonly id: string; readonly text?: string }[],
  configuration?: ScopeConfiguration,
  caseFolds = false,
): Readonly<Record<string, ScopeDecision>> {
  const out: Record<string, ScopeDecision> = {};
  for (const task of tasks) {
    out[task.id] = scopeOf({
      taskId: task.id,
      text: task.text,
      configuration,
      caseFolds,
    });
  }
  return Object.freeze(out);
}
