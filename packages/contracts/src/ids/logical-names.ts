/**
 * T034 — the resolver from a logical name and its parameters to a path
 * (annex B, §B.5; F100-FR-053 to F100-FR-056).
 *
 * The table of §B.5 is the complete list of the logical names of Wave 1,
 * each with its root, its one writer and its readers. This module reads it
 * from `data/layout.json` and resolves a name and its parameters to a path.
 * A name the table does not hold is refused: a feature that needs one reports
 * the need, and the name is added to the annex with a new minor of the layout
 * version (F100-FR-053).
 */
import layout from "../../data/layout.json" with { type: "json" };
import { normaliseRoot, type RootName, type RootEnvironment } from "./roots.ts";

type RawName = {
  logicalName: string;
  root: string;
  writer: string;
  readers: string;
  content: string;
  path: string;
};

const RAW = (layout as { logicalNames: RawName[] }).logicalNames;
const PLACEHOLDERS = (layout as { roots: Record<string, string> }).roots;

/** The layout version of the table (F100-FR-038). */
export const layoutVersion: string = (layout as { layoutVersion: string }).layoutVersion;

/** One row of the table of §B.5. */
export type LogicalNameRow = {
  readonly logicalName: string;
  /** The root the `Root` column names, normalised to one of the seven. */
  readonly root: RootName;
  /** The `Root` cell verbatim, prose and all. */
  readonly rootCell: string;
  /** The one writer of the name (F100-FR-051). */
  readonly writer: string;
  /** The readers of the name. */
  readonly readers: readonly string[];
  /** The `Schema or content` cell. */
  readonly content: string;
  /** The path template, with its placeholders. */
  readonly path: string;
  /** The parameters the name and its path template carry, in order. */
  readonly parameters: readonly string[];
};

const splitReaders = (cell: string): string[] =>
  cell
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r !== "" && r !== "—");

function parametersOf(row: RawName): string[] {
  const seen = new Set<string>();
  for (const source of [row.logicalName, row.path]) {
    for (const m of source.matchAll(/<[^>]+>/g)) {
      const token = m[0];
      if (token in PLACEHOLDERS) continue; // a root placeholder, not a parameter
      seen.add(token);
    }
  }
  return [...seen];
}

/** Every row of the table of §B.5, in the order of the annex. */
export const logicalNameRows: readonly LogicalNameRow[] = Object.freeze(
  RAW.map((row) =>
    Object.freeze({
      logicalName: row.logicalName,
      root: normaliseRoot(row.root),
      rootCell: row.root,
      writer: row.writer.trim(),
      readers: Object.freeze(splitReaders(row.readers)),
      content: row.content,
      path: row.path,
      parameters: Object.freeze(parametersOf(row)),
    }),
  ),
);

const BY_NAME = new Map(logicalNameRows.map((r) => [r.logicalName, r]));

/** Every logical name of Wave 1 (F100-FR-053). */
export const LOGICAL_NAMES: readonly string[] = Object.freeze(
  logicalNameRows.map((r) => r.logicalName),
);

/** A logical name the table does not hold (F100-FR-053). */
export class UnknownLogicalNameError extends Error {
  readonly logicalName: string;
  constructor(logicalName: string) {
    super(
      `the table of annex B §B.5 holds no logical name "${logicalName}"; ` +
        `a feature that needs one reports the need and the name is added with a new ` +
        `minor of the layout version ${layoutVersion} (F100-FR-053)`,
    );
    this.name = "UnknownLogicalNameError";
    this.logicalName = logicalName;
  }
}

/** A parameter of a name or its path that the caller did not give. */
export class MissingParameterError extends Error {
  readonly logicalName: string;
  readonly parameter: string;
  constructor(logicalName: string, parameter: string) {
    super(`the logical name "${logicalName}" needs the parameter ${parameter} (annex B, §B.5)`);
    this.name = "MissingParameterError";
    this.logicalName = logicalName;
    this.parameter = parameter;
  }
}

/** The row of a logical name; refuses a name the table does not hold. */
export function rowOf(logicalName: string): LogicalNameRow {
  const row = BY_NAME.get(logicalName);
  if (row === undefined) throw new UnknownLogicalNameError(logicalName);
  return row;
}

/** True when the table holds the name. */
export function holdsLogicalName(logicalName: string): boolean {
  return BY_NAME.has(logicalName);
}

/** The root of a logical name (F100-FR-053). */
export function rootOf(logicalName: string): RootName {
  return rowOf(logicalName).root;
}

/** The one writer of a logical name (F100-FR-051, F100-FR-053). */
export function writerOf(logicalName: string): string {
  return rowOf(logicalName).writer;
}

/** The readers of a logical name (F100-FR-053). */
export function readersOf(logicalName: string): readonly string[] {
  return rowOf(logicalName).readers;
}

/**
 * The parameters a caller may give. `<workspaceId>`, `<slug>`, `<runId>`,
 * `<N>`, `<k>`, `<n>`, `<launchId>` and `<pipelineId>` are the parameters the
 * annex names; the other parameters of the path templates are here too.
 */
export type NameParameters = Readonly<Record<string, string | number>>;

/** Where the roots of the machine are, for the substitution of a placeholder. */
export type RootPaths = Readonly<Record<string, string>>;

/** The root paths of a machine, keyed by the placeholders of `data/layout.json`. */
export function rootPathsOf(
  env: RootEnvironment & { readonly controlRoot: string; readonly workerRoot: string },
): RootPaths {
  const home = env.home;
  const j = (...p: string[]): string =>
    p
      .filter((x) => x !== "")
      .join("/")
      .replace(/\/{2,}/g, "/");
  return Object.freeze({
    "<user-config>": j(env.xdgConfigHome ?? j(home, ".config"), "specstride"),
    "<user-state>": j(env.xdgStateHome ?? j(home, ".local/state"), "specstride", "user"),
    "<user-cache>": j(env.xdgCacheHome ?? j(home, ".cache"), "specstride"),
    "<control>": env.controlRoot,
    "<workspace>": env.workspaceRealPath,
    "<workspace-part>": j(env.workspaceRealPath, ".specstride"),
    "<worker-root>": env.workerRoot,
    "<temp>": "/tmp",
    "<package>": "",
    "<harness-home>": "",
  });
}

/**
 * Resolve a logical name and its parameters to a path (F100-FR-053).
 *
 * The root placeholder at the head of the path template is replaced from
 * `roots`; every parameter of the template is replaced from `parameters`.
 * `<attempt-dir>` is itself a template of `data/layout.json` and is expanded
 * first, so that `<slug>`, `<runId>`, `<N>`, `<k>` and `<n>` reach it.
 */
export function resolve(
  logicalName: string,
  parameters: NameParameters = {},
  roots: RootPaths = {},
): string {
  const row = rowOf(logicalName);
  // T303 — a bare per-start name is the file of the newest engine start, not a
  // file of its own: it resolves through its `:<k>` form (annex B, §B.5,
  // F100-FR-054). The caller gives the ordinal of the newest start as `<k>`.
  const perStart = perStartNameOf(logicalName);
  if (perStart !== undefined) {
    const k = parameters["<k>"] ?? parameters["k"];
    if (k === undefined) throw new MissingEngineStartError(logicalName);
    return resolve(perStart, parameters, roots);
  }
  let path = row.path;
  // `<attempt-dir>` is a template of the roots table, not a root of state.
  if (path.includes("<attempt-dir>")) {
    const attemptDir = PLACEHOLDERS["<attempt-dir>"] ?? "";
    path = path.replace("<attempt-dir>", attemptDir.split(";")[0]?.trim() ?? "");
  }
  for (const [placeholder, value] of Object.entries(roots)) {
    path = path.split(placeholder).join(value);
  }
  path = path.replace(/<[^>]+>/g, (token) => {
    if (token in parameters) return String(parameters[token]);
    const bare = token.slice(1, -1);
    if (bare in parameters) return String(parameters[bare as keyof typeof parameters]);
    if (token in PLACEHOLDERS && !(token in roots)) return token; // an unresolved root placeholder
    throw new MissingParameterError(logicalName, token);
  });
  return path;
}

/** The parameters a logical name needs, for a caller that wants to ask first. */
export function parametersOfName(logicalName: string): readonly string[] {
  return rowOf(logicalName).parameters;
}

/**
 * F100-FR-054 — the five compared logs and records of the as-is pipeline
 * runtime and supervisor, and the engine log. The compatibility projection
 * writes them as files, so that the oracle compares them by logical name.
 */
export const COMPARED_PIPELINE_NAMES = [
  "pipeline:<pipelineId>:launcher-log",
  "pipeline:<pipelineId>:report-log",
  "pipeline:<pipelineId>:launch-log",
  "pipeline:<pipelineId>:harness-run",
  "run:<runId>:engine-log",
] as const;

/**
 * F100-FR-055 — the two names that resolve to the event file and the engine
 * log of the newest engine start of the workspace.
 */
export const CURRENT_RUN_NAMES = [
  "workspace:current:events",
  "workspace:current:engine-log",
] as const;

/** What `workspace:current:*` resolves to, given the run of the newest start. */
export const CURRENT_RUN_TARGETS: Readonly<Record<string, string>> = Object.freeze({
  "workspace:current:events": "run:<runId>:events",
  "workspace:current:engine-log": "run:<runId>:engine-log",
});

/**
 * Resolve one of the two current names to the name of the newest engine
 * start's run, then to its path (F100-FR-055).
 */
export function resolveCurrent(
  logicalName: (typeof CURRENT_RUN_NAMES)[number],
  currentRunId: string,
  parameters: NameParameters = {},
  roots: RootPaths = {},
): string {
  const target = CURRENT_RUN_TARGETS[logicalName];
  if (target === undefined) throw new UnknownLogicalNameError(logicalName);
  return resolve(target, { ...parameters, "<runId>": currentRunId }, roots);
}

/** The state of a feature is reachable under the feature slug (F100-FR-055). */
export function namesOfFeature(slug: string): readonly string[] {
  return Object.freeze(
    LOGICAL_NAMES.filter((n) => n.startsWith("feature:<slug>:")).map((n) =>
      n.split("<slug>").join(slug),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * T303 — the names of an engine start (annex B, §B.5, layout 1.2;
 * F100-FR-054, F100-FR-226).
 *
 * Two names of a run are written once per engine start and carry the
 * ordinal `<k>` as a suffix: the as-is event file and the engine log. The
 * bare name of each is not a file of its own: the table gives its path as
 * the directory of the compared files followed by "the file of the newest
 * engine start". The bare name therefore resolves through the per-start
 * name, with the ordinal of the newest start.
 * ------------------------------------------------------------------ */

/** The cell of the table that marks a name as resolving through the newest start. */
const NEWEST_START_MARKER = "the file of the newest engine start";

/**
 * The two bare names of a run that resolve to the file of the newest engine
 * start, each with the per-start name that carries the ordinal `<k>`
 * (annex B, §B.5; F100-FR-054).
 */
export const PER_START_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "run:<runId>:events-legacy": "run:<runId>:events-legacy:<k>",
  "run:<runId>:engine-log": "run:<runId>:engine-log:<k>",
});

/** The bare names that resolve to the file of the newest engine start. */
export const NEWEST_ENGINE_START_NAMES: readonly string[] = Object.freeze(
  Object.keys(PER_START_NAMES),
);

/**
 * True when the table gives the path of the name as the file of the newest
 * engine start, rather than as a file of its own.
 */
export function resolvesToTheNewestEngineStart(logicalName: string): boolean {
  return rowOf(logicalName).path.includes(NEWEST_START_MARKER);
}

/**
 * The per-start name of a bare name, or `undefined` where the name carries no
 * per-start form. `run:<runId>:engine-log` gives `run:<runId>:engine-log:<k>`.
 */
export function perStartNameOf(logicalName: string): string | undefined {
  const perStart = PER_START_NAMES[logicalName];
  if (perStart === undefined) return undefined;
  return holdsLogicalName(perStart) ? perStart : undefined;
}

/** A bare per-start name resolved without the ordinal of a start. */
export class MissingEngineStartError extends Error {
  readonly logicalName: string;
  constructor(logicalName: string) {
    super(
      `the logical name "${logicalName}" is the file of the newest engine start; ` +
        `resolve it with the ordinal <k> of that start, or resolve ` +
        `"${PER_START_NAMES[logicalName] ?? logicalName}" directly (annex B, §B.5, F100-FR-054)`,
    );
    this.name = "MissingEngineStartError";
    this.logicalName = logicalName;
  }
}

/**
 * Resolve a bare per-start name to the path of one engine start: the newest
 * start, whose ordinal the caller gives (F100-FR-054). This is what
 * `run:<runId>:engine-log` and `run:<runId>:events-legacy` mean.
 */
export function resolveEngineStart(
  logicalName: string,
  newestEngineStartOrdinal: number | string,
  parameters: NameParameters = {},
  roots: RootPaths = {},
): string {
  const perStart = perStartNameOf(logicalName);
  if (perStart === undefined) throw new UnknownLogicalNameError(logicalName);
  return resolve(perStart, { ...parameters, "<k>": newestEngineStartOrdinal }, roots);
}
