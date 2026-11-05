/**
 * T014 — resolution of the spec, the explicit path and the listings
 * (F104-FR-001, F104-FR-002, F104-FR-004).
 *
 * The order, which `RESOLUTION_ORDER` carries as data:
 *
 *   0. an explicit `-s`/`--specs` BYPASSES resolution (F104-FR-002, B-0237);
 *   1. `<workspace>/SPECS.md`, which wins whenever it exists, even when a
 *      feature is named (B-0239);
 *   2. the `feature_directory` of `.specify/feature.json`, whose `tasks.md` is
 *      the spec; a file that cannot be parsed, that has no `feature_directory`,
 *      or that names a directory without `tasks.md` falls through to step 3
 *      WITHOUT a message (B-0240, B-0241);
 *   3. the candidates `<workspace>/specs/<dir>/tasks.md` and then
 *      `<workspace>/openspec/changes/<dir>/tasks.md` — a glob over every child
 *      directory, written out literally in `TRIED_LOCATIONS` — of which
 *      exactly one is used
 *      (B-0242). `--feature` selects among several (B-0243, `slug.ts`); with
 *      several and no feature NOTHING is selected (F104-FR-001).
 *
 * A failed resolution exits 3 with the as-is text and NO other line
 * (F104-FR-004, B-0116, B-0189, B-0190, B-0191). This module returns the lines
 * and the reason kind; the exit belongs to the command line, because a code is
 * a field of a result record and not a process of its own (LR-6).
 *
 * One reading had to be chosen, and it is recorded rather than hidden. Row
 * B-0190 of `docs/ecosystem/research/R18-behaviour-inventory.tsv` gives the
 * ambiguity listing as "per candidate its path and the two
 * `→ specstride run -w … -s …` / `--feature …` forms"; the as-is shell source
 * that row cites is not in this repository, so the INDENTATION of those three
 * lines cannot be read off. `CANDIDATE_INDENT` and `COMMAND_INDENT` hold the chosen widths in
 * one place; the parity task of FX-09 `ambiguous-candidates` is what settles
 * them against a golden capture, and until a capture exists the choice is an
 * `assumption` of the same kind as the phase shape's serialization in T007.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve as resolvePath, sep } from "node:path";
import { selectCandidateByFeature, type SelectableCandidate } from "./slug.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F104-FR-001", "F104-FR-002", "F104-FR-004"] as const;

/** The records of the baseline this module is measured against. */
export const BEHAVIOUR_ROWS = Object.freeze([
  "B-0010",
  "B-0116",
  "B-0117",
  "B-0189",
  "B-0190",
  "B-0191",
  "B-0237",
  "B-0239",
  "B-0240",
  "B-0241",
  "B-0242",
  "B-0243",
  "B-0244",
]);

/** Step 1 — the file at the workspace root that wins whenever it exists. */
export const ROOT_SPEC_NAME = "SPECS.md" as const;

/** Step 2 — the file Spec Kit writes, and the key resolution reads from it. */
export const FEATURE_JSON = join(".specify", "feature.json");
export const FEATURE_DIRECTORY_KEY = "feature_directory" as const;

/** The name of a task list, which is the spec in steps 2 and 3. */
export const TASKS_NAME = "tasks.md" as const;

/** Step 3 — the two candidate roots, in the order they are collected. */
export const CANDIDATE_ROOTS = Object.freeze([
  Object.freeze({ kind: "speckit" as const, parts: Object.freeze(["specs"]) }),
  Object.freeze({ kind: "openspec" as const, parts: Object.freeze(["openspec", "changes"]) }),
]);

/**
 * The FOUR locations of the `tried:` list of F104-FR-004, in order. They are
 * written with the workspace left as a placeholder, because the message names
 * the workspace once on its own line above them.
 */
export const TRIED_LOCATIONS = Object.freeze([
  ROOT_SPEC_NAME,
  `${FEATURE_JSON.split(sep).join("/")} → ${FEATURE_DIRECTORY_KEY}/${TASKS_NAME}`,
  `specs/*/${TASKS_NAME}`,
  `openspec/changes/*/${TASKS_NAME}`,
]);

/** One step of the resolution order of F104-FR-001. */
export type ResolutionStep = {
  /** 0 for the explicit path, then 1, 2 and 3 as F104-FR-001 numbers them. */
  readonly step: number;
  readonly kind: "explicit" | "root-spec" | "feature-json" | "candidates";
  readonly rule: string;
};

/** The resolution order of F104-FR-001, as data. */
export const RESOLUTION_ORDER: readonly ResolutionStep[] = Object.freeze([
  Object.freeze({
    step: 0,
    kind: "explicit" as const,
    rule: "an explicit `-s`/`--specs` bypasses resolution (F104-FR-002)",
  }),
  Object.freeze({
    step: 1,
    kind: "root-spec" as const,
    rule: "`<workspace>/SPECS.md`, which wins whenever it exists, even when a feature is named",
  }),
  Object.freeze({
    step: 2,
    kind: "feature-json" as const,
    rule: "the `feature_directory` of `.specify/feature.json`, whose `tasks.md` is the spec",
  }),
  Object.freeze({
    step: 3,
    kind: "candidates" as const,
    rule: "`specs/*/tasks.md` and then `openspec/changes/*/tasks.md`, of which exactly one is used",
  }),
]);

/** Step 1 wins even when a feature is named (B-0239). */
export const ROOT_SPEC_WINS_OVER_A_NAMED_FEATURE = true as const;
/** Step 2 falls through to step 3 without a message (B-0241). */
export const FEATURE_JSON_FALLS_THROUGH_SILENTLY = true as const;

/* ------------------------------------------------------------------ *
 * The explicit path (F104-FR-002).
 * ------------------------------------------------------------------ */

/** The as-is text of a spec path that is not a regular file (B-0117). */
export function specNotFoundLine(path: string): string {
  return `spec not found: ${path} (pass -s FILE — any name/location)`;
}

/**
 * The explicit path of `-s`/`--specs` (F104-FR-002, B-0237): a RELATIVE value
 * is taken against the directory the command was STARTED FROM, captured before
 * the product changes into the workspace; an ABSOLUTE value is kept.
 */
export function explicitSpecPath(value: string, launchDirectory: string): string {
  return isAbsolute(value) ? value : resolvePath(launchDirectory, value);
}

/**
 * The absolute, canonical form handed to the engine, the critic and the saved
 * run settings (F104-FR-002, B-0244): the PHYSICAL directory joined with the
 * base name, so that a symbolic link to the spec file itself is kept as the
 * caller named it while the directory is resolved.
 */
export function canonicalSpecPath(path: string): string {
  const absolute = isAbsolute(path) ? path : resolvePath(path);
  try {
    return join(realpathSync(dirname(absolute)), basename(absolute));
  } catch {
    return absolute;
  }
}

/** True when the path is a REGULAR file; a directory is not a spec (B-0117). */
export function isARegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * The candidates (step 3).
 * ------------------------------------------------------------------ */

/** One candidate task list found under the workspace. */
export type Candidate = SelectableCandidate & {
  /** The absolute path of the `tasks.md`. */
  readonly path: string;
  /** The directory that holds it. */
  readonly directory: string;
  /** Its name, which `--feature` is compared against RAW (B-0243). */
  readonly parentName: string;
  /** Which of the two roots it came from. */
  readonly kind: "speckit" | "openspec";
};

/** Directory entries, sorted, or nothing where the directory is not readable. */
function childDirectories(directory: string): readonly string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * The candidates of step 3, `specs/<dir>/tasks.md` first and then
 * `openspec/changes/<dir>/tasks.md` (B-0242), a glob over every child
 * directory of each root. Within a root the order is the sorted
 * directory name, so that the listing of F104-FR-004 and the selection of
 * F104-FR-003 ("the FIRST candidate") are the same on every machine.
 */
export function candidatesOf(workspace: string): readonly Candidate[] {
  const found: Candidate[] = [];
  for (const root of CANDIDATE_ROOTS) {
    const base = join(workspace, ...root.parts);
    for (const name of childDirectories(base)) {
      const directory = join(base, name);
      const path = join(directory, TASKS_NAME);
      if (!isARegularFile(path)) continue;
      found.push(
        Object.freeze({
          path,
          directory,
          parentName: name,
          kind: root.kind,
        }),
      );
    }
  }
  return Object.freeze(found);
}

/* ------------------------------------------------------------------ *
 * Step 2 — `.specify/feature.json`.
 * ------------------------------------------------------------------ */

/**
 * The `tasks.md` of the `feature_directory` of `.specify/feature.json`
 * (B-0240), or `undefined` where the file cannot be parsed, holds no
 * `feature_directory`, or names a directory without a `tasks.md` (B-0241). A
 * relative value is taken against the WORKSPACE, not against the launch
 * directory — which is the one place the two differ from F104-FR-002.
 */
export function specOfTheFeatureJson(workspace: string): string | undefined {
  const file = join(workspace, FEATURE_JSON);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const value = (parsed as Record<string, unknown>)[FEATURE_DIRECTORY_KEY];
  if (typeof value !== "string" || value === "") return undefined;
  const directory = isAbsolute(value) ? value : join(workspace, value);
  const path = join(directory, TASKS_NAME);
  return isARegularFile(path) ? path : undefined;
}

/* ------------------------------------------------------------------ *
 * The listings of F104-FR-004.
 * ------------------------------------------------------------------ */

/**
 * The indentation of the three lines a candidate contributes to the ambiguity
 * listing. Row B-0190 of `docs/ecosystem/research/R18-behaviour-inventory.tsv`
 * does not state the widths and the as-is shell source it cites is not in this
 * repository, so they are chosen here, in ONE place, and settled by the golden
 * capture of FX-09 `ambiguous-candidates`.
 */
export const CANDIDATE_INDENT = "  " as const;
export const COMMAND_INDENT = "    " as const;
/** The marker B-0190 names for a suggested command. */
export const COMMAND_MARKER = "→ specstride run" as const;

/** The head line of the ambiguity listing (B-0190). */
export function ambiguousHeadLine(workspace: string): string {
  return `multiple feature specs found under ${workspace} — disambiguate (nothing auto-selected):`;
}

/** The two commands that disambiguate one candidate (F104-FR-004, B-0190). */
export function disambiguatingCommands(
  workspace: string,
  candidate: Candidate,
): readonly [string, string] {
  return [
    `${COMMAND_MARKER} -w ${workspace} -s ${candidate.path}`,
    `${COMMAND_MARKER} -w ${workspace} --feature ${candidate.parentName}`,
  ];
}

/**
 * The whole ambiguity listing: the head line, then PER CANDIDATE its path and
 * the two commands that would disambiguate (F104-FR-004, B-0190).
 */
export function ambiguousCandidateLines(
  workspace: string,
  candidates: readonly Candidate[],
): readonly string[] {
  const lines: string[] = [ambiguousHeadLine(workspace)];
  for (const candidate of candidates) {
    lines.push(`${CANDIDATE_INDENT}${candidate.path}`);
    for (const command of disambiguatingCommands(workspace, candidate)) {
      lines.push(`${COMMAND_INDENT}${command}`);
    }
  }
  return Object.freeze(lines);
}

/** A feature that matches no candidate: ONE line, no list of locations (B-0189). */
export function noSuchFeatureLine(workspace: string, feature: string): string {
  return `spec not found: no feature/change '${feature}' ${TASKS_NAME} under ${workspace}`;
}

/** Nothing found: the head line and a `tried:` list of the four locations (B-0191). */
export function noSpecResolvedLines(workspace: string): readonly string[] {
  return Object.freeze([
    `spec not found: no spec resolved for ${workspace} (pass -s FILE — any name/location).`,
    "tried:",
    ...TRIED_LOCATIONS.map((location) => `${CANDIDATE_INDENT}${location}`),
  ]);
}

/* ------------------------------------------------------------------ *
 * The result.
 * ------------------------------------------------------------------ */

/** The exit code of every failed resolution (F104-FR-004, B-0116). */
export const EXIT_OF_A_FAILED_RESOLUTION = 3 as const;

/** The two reason kinds of EP-03 a failed resolution carries (F104-FR-004). */
export const RESOLUTION_REASON_KINDS = ["ambiguous-candidates", "invalid-spec"] as const;
export type ResolutionReasonKind = (typeof RESOLUTION_REASON_KINDS)[number];

/** Which of the four failures of F104-FR-004 happened. */
export type ResolutionFailureCase =
  "not-a-file" | "ambiguous-candidates" | "no-such-feature" | "nothing-resolved";

/** A failed resolution: its case, its reason kind, its lines and the code 3. */
export type ResolutionFailure = {
  readonly case: ResolutionFailureCase;
  readonly reason: ResolutionReasonKind;
  /** The as-is text and NO other line (F104-FR-004). */
  readonly lines: readonly string[];
  readonly exitCode: typeof EXIT_OF_A_FAILED_RESOLUTION;
  /** The candidates, where the case is the ambiguity. */
  readonly candidates: readonly Candidate[];
};

/** A resolved spec: the canonical path and the step that found it. */
export type ResolvedSpec = {
  readonly path: string;
  readonly step: number;
  readonly kind: ResolutionStep["kind"];
};

/** What `resolveSpec` answers. */
export type Resolution =
  | ({ readonly resolved: true } & ResolvedSpec)
  | { readonly resolved: false; readonly failure: ResolutionFailure };

/** What a caller gives resolution. */
export type ResolutionRequest = {
  /** The workspace, `-w`; the default of the command line is `.`. */
  readonly workspace: string;
  /** The value of `-s`/`--specs`, where one was given (F104-FR-002). */
  readonly explicitSpec?: string | undefined;
  /**
   * The directory the command was STARTED FROM, captured before the product
   * changes into the workspace (F104-FR-002, B-0237).
   */
  readonly launchDirectory?: string | undefined;
  /** The RAW, unsanitized value of `--feature` or of `spec.feature` (B-0243). */
  readonly feature?: string | undefined;
};

/** A failure record, built once so that every case carries the same fields. */
function failure(
  which: ResolutionFailureCase,
  reason: ResolutionReasonKind,
  lines: readonly string[],
  candidates: readonly Candidate[] = [],
): Resolution {
  return Object.freeze({
    resolved: false as const,
    failure: Object.freeze({
      case: which,
      reason,
      lines: Object.freeze([...lines]),
      exitCode: EXIT_OF_A_FAILED_RESOLUTION,
      candidates: Object.freeze([...candidates]),
    }),
  });
}

function resolvedAt(path: string, step: ResolutionStep): Resolution {
  return Object.freeze({
    resolved: true as const,
    path: canonicalSpecPath(path),
    step: step.step,
    kind: step.kind,
  });
}

const stepOf = (kind: ResolutionStep["kind"]): ResolutionStep =>
  RESOLUTION_ORDER.find((entry) => entry.kind === kind) as ResolutionStep;

/**
 * Resolution of the spec (F104-FR-001, F104-FR-002, F104-FR-004). The workspace
 * is made absolute first, because every message of F104-FR-004 names it and the
 * two commands of the ambiguity listing must be runnable as printed.
 */
export function resolveSpec(request: ResolutionRequest): Resolution {
  const workspace = isAbsolute(request.workspace)
    ? request.workspace
    : resolvePath(request.workspace);

  // Step 0 — an explicit path BYPASSES resolution (F104-FR-002).
  const explicit = request.explicitSpec;
  if (explicit !== undefined && explicit !== "") {
    const launchDirectory = request.launchDirectory ?? process.cwd();
    const named = explicitSpecPath(explicit, launchDirectory);
    if (!isARegularFile(named)) {
      // The text names the path as the CALLER wrote it (B-0117).
      return failure("not-a-file", "invalid-spec", [specNotFoundLine(explicit)]);
    }
    return resolvedAt(named, stepOf("explicit"));
  }

  // Step 1 — `SPECS.md` wins whenever it exists, even when a feature is named.
  const rootSpec = join(workspace, ROOT_SPEC_NAME);
  if (isARegularFile(rootSpec)) return resolvedAt(rootSpec, stepOf("root-spec"));

  // Step 2 — `.specify/feature.json`, which falls through silently (B-0241).
  const fromFeatureJson = specOfTheFeatureJson(workspace);
  if (fromFeatureJson !== undefined) {
    return resolvedAt(fromFeatureJson, stepOf("feature-json"));
  }

  // Step 3 — the candidates.
  const candidates = candidatesOf(workspace);
  const feature = request.feature;
  if (feature !== undefined && feature !== "") {
    const selected = selectCandidateByFeature(candidates, feature);
    if (selected === undefined) {
      return failure("no-such-feature", "invalid-spec", [noSuchFeatureLine(workspace, feature)]);
    }
    return resolvedAt(selected.path, stepOf("candidates"));
  }
  if (candidates.length === 1) {
    return resolvedAt((candidates[0] as Candidate).path, stepOf("candidates"));
  }
  if (candidates.length > 1) {
    // Nothing is selected (F104-FR-001); the reason kind is EP-03's.
    return failure(
      "ambiguous-candidates",
      "ambiguous-candidates",
      ambiguousCandidateLines(workspace, candidates),
      candidates,
    );
  }
  return failure("nothing-resolved", "invalid-spec", noSpecResolvedLines(workspace));
}

/** True where the workspace holds the marker Spec Kit writes. */
export function hasAFeatureJson(workspace: string): boolean {
  return existsSync(join(workspace, FEATURE_JSON));
}
