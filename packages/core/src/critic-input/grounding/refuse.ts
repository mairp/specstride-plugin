// Feature 117 (T011) — the refusal guard (F117-FR-018; F100-FR-037, SL-3).
//
// Grounding refuses, BY REAL PATH, every path of the seven refused roots of
// `data/closed-sets.json` — the control plane, the event stream, the outbox,
// the carry-over files (the handoff and the proposer's notebook), the worker
// root, the tree store, and the repository directory of the project. The
// refusal holds for an absolute citation, a relative citation, a wildcard
// match, a placeholder match, an expanded directory and a citation through a
// symbolic link, with every loop layer on or off and with parallel units on
// or off (research D-2: a test on the real path is the only test that holds
// for every way a path can enter the snapshot).
//
// A refused citation renders ONE line with the cited token and the fixed
// words that the path is not grounded because it lies outside what grounding
// reads. The line never names the root (`refusedRoot` is never printed),
// gives no size, no time and no content, and the refusal is recorded. A
// refused path is never a grounding gap.
//
// No `node:fs`, no process: every file-system answer comes through the
// `FileReadingPort` of `../ports.ts`.

import {
  controlRoot,
  isInside,
  workerRoot,
  workspacePart,
  type RootEnvironment,
} from "@specstride/contracts/ids/roots";
import { loopStrategies } from "@specstride/contracts/enums/all-sets";
import type { FileReadingPort } from "../ports.ts";
import closedSets from "../data/closed-sets.json" with { type: "json" };

/** The seven refused roots, in the order of the closed set. */
export const REFUSED_ROOTS = Object.freeze(
  (closedSets as { refusedRoots: readonly string[] }).refusedRoots,
) as readonly [
  "control",
  "events",
  "outbox",
  "carry-over",
  "worker-root",
  "tree-store",
  "repository",
];

export type RefusedRootName = (typeof REFUSED_ROOTS)[number];

/** One refused root, resolved to the physical paths it covers. */
export interface RefusedRoot {
  readonly name: RefusedRootName;
  /**
   * The physical paths the root covers; a path is refused when its real path
   * lies inside ANY of them. `carry-over` covers two places (the handoff and
   * the notebook); the others cover one.
   */
  readonly paths: readonly string[];
}

/** The environment the roots are resolved from, beside the roots of feature 100. */
export interface RefusalEnvironment extends RootEnvironment {
  /** The feature slug of the run. */
  readonly featureSlug: string;
  /** The run identifier of §B.3. */
  readonly runId: string;
}

const joinPath = (...parts: readonly string[]): string =>
  parts
    .filter((p) => p !== "")
    .join("/")
    .replace(/\/{2,}/g, "/");

/** The number of path segments of a path. */
function segmentCount(path: string): number {
  return path.split("/").filter((p) => p !== "").length;
}

/**
 * The seven roots resolved from the logical roots of feature 100
 * (`@specstride/contracts/ids/roots`: the control root, the workspace part,
 * the worker root — this module invents no path of its own). `repository` is
 * the repository directory of the project, `<workspace>/.git`, which the
 * layout rule of feature 100 refuses in full
 * (`groundingRefusesRepositoryDirectory`).
 */
export function resolveRefusedRoots(env: RefusalEnvironment): readonly RefusedRoot[] {
  const control = controlRoot(env).path;
  const controlFeature = joinPath(control, "features", env.featureSlug);
  const runDir = joinPath(controlFeature, "runs", env.runId);
  const part = workspacePart(env);
  const featurePart = joinPath(part, "features", env.featureSlug);
  const roots: readonly RefusedRoot[] = [
    { name: "control", paths: [control] },
    // The event stream: `run:<runId>:events` of the layout (annex B, §B.5).
    { name: "events", paths: [joinPath(runDir, "events.jsonl")] },
    // The outbox: `feature:<slug>:outbox` of the layout.
    { name: "outbox", paths: [joinPath(featurePart, "outbox")] },
    // The carry-over files: the handoff (`feature:<slug>:handoff`) and the
    // proposer's notebook (`feature:<slug>:notebook`).
    {
      name: "carry-over",
      paths: [joinPath(featurePart, "handoff.md"), joinPath(featurePart, "notebook")],
    },
    { name: "worker-root", paths: [workerRoot(env)] },
    // The tree store: `tree-store` of the layout, under the run.
    { name: "tree-store", paths: [joinPath(runDir, "tree-store")] },
    // The repository directory of the project.
    { name: "repository", paths: [joinPath(env.workspaceRealPath, ".git")] },
  ];
  for (const root of roots) {
    if (!REFUSED_ROOTS.includes(root.name)) {
      throw new Error(`"${root.name}" is not a member of the closed set of refused roots`);
    }
  }
  return Object.freeze(roots.map((r) => Object.freeze(r)));
}

/**
 * How a citation reached the guard. `symlink` is a citation whose lexical
 * path is not refused but whose REAL path is — the case F117-FR-018 exists
 * for.
 */
export type CitationForm =
  "absolute" | "relative" | "wildcard" | "placeholder" | "directory" | "symlink";

/** The result of the refusal test for one path. */
export interface RefusalVerdict {
  /** True when the real path lies in a refused root: the path is NOT grounded. */
  readonly refused: boolean;
  /** The root the refusal came from; NEVER printed (F117-FR-018). */
  readonly refusedRoot: RefusedRootName | undefined;
  /** The real path the test ran on, when one could be resolved. */
  readonly realPath: string | undefined;
}

/**
 * F117-FR-018 — the refusal test of one path. The REAL path is resolved
 * first (a citation through a symbolic link is refused by where the link
 * points, never by where it stands); where the path does not exist, the
 * lexical path is tested as it stands, so that a state path cited but not
 * present is refused all the same. Both the real path and the lexical path
 * are tested against every root.
 */
export function refusalVerdict(
  citedPath: string,
  roots: readonly RefusedRoot[],
  io: FileReadingPort,
): RefusalVerdict {
  const realPath = io.realpath(citedPath);
  const candidates: readonly string[] =
    realPath === undefined ? [citedPath] : [realPath, citedPath];
  // Most specific root first: a path inside the event stream is refused AS
  // the event stream, not as the control plane that holds it. The depth of
  // a root is the largest number of segments among its paths.
  const ordered = [...roots].sort(
    (a, b) => Math.max(...b.paths.map(segmentCount)) - Math.max(...a.paths.map(segmentCount)),
  );
  for (const root of ordered) {
    for (const rootPath of root.paths) {
      const realRoot = io.realpath(rootPath) ?? rootPath;
      for (const candidate of candidates) {
        if (isInside(candidate, realRoot)) {
          return { refused: true, refusedRoot: root.name, realPath };
        }
      }
    }
  }
  return { refused: false, refusedRoot: undefined, realPath };
}

/** The fixed words of the refusal line (F117-FR-018). No root, no size, no time, no content. */
export function refusalLine(token: string): string {
  return `- \`${token}\` — **NOT GROUNDED** (outside what grounding reads)`;
}

/** The record of one refusal, for the events (F117-FR-015). No content. */
export interface RefusalRecord {
  /** The token as cited. */
  readonly token: string;
  /** The member of the closed set; recorded for events, never printed. */
  readonly root: RefusedRootName;
  /** The real path the test refused, when one was resolvable. */
  readonly realPath: string | undefined;
  /** How the citation reached the guard. */
  readonly form: CitationForm;
}

/**
 * Expand one non-literal citation and test what it reaches: a wildcard (its
 * matches below the workspace root), a placeholder (its first match in
 * sorted order) and an expanded directory (its entries) all go through the
 * same refusal test — F117-FR-018 holds for a wildcard match, a placeholder
 * match and an expanded directory exactly as for a direct citation.
 */
export function refusalVerdictForExpansion(
  token: string,
  citedPath: string,
  form: Exclude<CitationForm, "absolute" | "relative" | "symlink">,
  workspaceRoot: string,
  roots: readonly RefusedRoot[],
  io: FileReadingPort,
): RefusalVerdict {
  if (form === "directory") {
    // An expanded directory: every entry the expansion lists is tested.
    const entries = io.listDirectory(citedPath);
    for (const entry of entries ?? []) {
      const verdict = refusalVerdict(joinPath(citedPath, entry), roots, io);
      if (verdict.refused) return verdict;
    }
    // The directory itself is tested too: the expansion may name it.
    return refusalVerdict(citedPath, roots, io);
  }
  const pattern = form === "placeholder" ? wildcardOfPlaceholder(token) : token;
  const matches = io.matchBelow(workspaceRoot, pattern);
  for (const match of matches) {
    const verdict = refusalVerdict(joinPath(workspaceRoot, match), roots, io);
    if (verdict.refused) return { ...verdict };
  }
  return { refused: false, refusedRoot: undefined, realPath: undefined };
}

/** A placeholder citation (`<...>`) is the pattern in which only it is a wildcard. */
function wildcardOfPlaceholder(token: string): string {
  return token.replace(/<[^<>]*>/g, "*");
}

/**
 * The guard run configuration: the loop strategy and the parallel-units
 * switch, carried through the guard and IGNORED by it. They are inputs at
 * all only so that the characterization test CT-117-18 can prove the
 * refusal holds for both members of the loop-strategy closed set and with
 * parallel units on and off — the guard's answers are byte-identical under
 * all four combinations (F117-FR-018).
 */
export type LoopStrategy = (typeof loopStrategies)["members"][number];

export interface GuardRunConfig {
  /** A member of the loop-strategy closed set (row 55 of annex X §X.6). */
  readonly loopStrategy: LoopStrategy;
  /** True when parallel units are on. */
  readonly parallelUnits: boolean;
}

/** The outcome of the guard for one batch of citations. */
export interface GuardOutcome {
  /** The refusal verdict of each citation, in the order given. */
  readonly verdicts: readonly RefusalVerdict[];
  /** The refusal line of every refused citation, token and fixed words only. */
  readonly lines: readonly string[];
  /** The records, one per refusal, for the events. */
  readonly records: readonly RefusalRecord[];
  /**
   * The grounding gap the batch contributes: ALWAYS empty. A refused path
   * is never a grounding gap (F117-FR-018).
   */
  readonly gap: readonly string[];
  /** True when no citation of the batch was grounded through the guard. */
  readonly noneGrounded: boolean;
}

/**
 * Run the guard over a batch of citations. Each citation is tested directly
 * (absolute, relative, through a symbolic link) and, when it carries a
 * wildcard or placeholder shape, through its expansion as well; a cited
 * directory goes through its expanded entries. Nothing a refusal covers is
 * grounded, named, sized, timed or turned into a gap.
 */
export function runRefusalGuard(
  citations: readonly {
    readonly token: string;
    readonly path: string;
    readonly form: CitationForm;
  }[],
  workspaceRoot: string,
  roots: readonly RefusedRoot[],
  io: FileReadingPort,
  config: GuardRunConfig,
): GuardOutcome {
  void config; // carried and ignored: the refusal is independent of the layers
  const verdicts: RefusalVerdict[] = [];
  const lines: string[] = [];
  const records: RefusalRecord[] = [];
  for (const citation of citations) {
    let verdict =
      citation.form === "wildcard" ||
      citation.form === "placeholder" ||
      citation.form === "directory"
        ? refusalVerdictForExpansion(
            citation.token,
            citation.path,
            citation.form,
            workspaceRoot,
            roots,
            io,
          )
        : refusalVerdict(citation.path, roots, io);
    // A citation through a symbolic link: the lexical path stood in the
    // workspace and the real path in a refused root.
    let form = citation.form;
    if (
      !verdict.refused &&
      (citation.form === "absolute" || citation.form === "relative") &&
      verdict.realPath !== undefined &&
      verdict.realPath !== citation.path
    ) {
      const lexical = refusalVerdict(citation.path, roots, io);
      verdict = lexical.refused ? lexical : verdict;
      if (lexical.refused) form = "symlink";
    }
    verdicts.push(verdict);
    if (verdict.refused && verdict.refusedRoot !== undefined) {
      lines.push(refusalLine(citation.token));
      records.push(
        Object.freeze({
          token: citation.token,
          root: verdict.refusedRoot,
          realPath: verdict.realPath,
          form,
        }),
      );
    }
  }
  return Object.freeze({
    verdicts: Object.freeze(verdicts),
    lines: Object.freeze(lines),
    records: Object.freeze(records),
    gap: Object.freeze([]),
    noneGrounded: records.length === citations.length,
  });
}
