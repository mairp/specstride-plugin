/**
 * T017 — feature resolution and repository facts (F107-FR-002, F107-FR-003;
 * C-213).
 *
 * `--feature PATH` may repeat; a relative path resolves against the
 * repository root; a path to a file is replaced by its parent directory; a
 * path that is then not a directory stops derivation. Without `--feature` the
 * repository root itself is the feature when it holds `tasks.md` or
 * `spec.md`; otherwise exactly one `specs/*` directory that holds one of the
 * two; otherwise the ambiguity refusal names the candidates.
 *
 * The repository facts are the revision (20 s limit) and the dirty mark
 * (30 s limit) from the version-control tool, each null when it cannot be
 * read. The launch-contract id is the lower-cased feature directory names
 * joined by `-and-`, every run of characters outside `a-z0-9` collapsed to
 * `-`, a `-` at either end removed, or `pipeline`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";

import { specModel } from "../ports.ts";

/** The time limit of the revision query (F107-FR-003). */
export const REVISION_TIME_LIMIT_MS = 20_000 as const;
/** The time limit of the dirty query (F107-FR-003). */
export const DIRTY_TIME_LIMIT_MS = 30_000 as const;

/** What feature resolution returns. */
export type FeatureResolution =
  | { readonly ok: true; readonly featureDirs: readonly string[] }
  | { readonly ok: false; readonly message: string };

function holdsAFeatureRoot(dir: string): boolean {
  return existsSync(join(dir, "tasks.md")) || existsSync(join(dir, "spec.md"));
}

function featureDirectoryOf(path: string, root: string): string | undefined {
  const absolute = isAbsolute(path) ? path : join(root, path);
  let resolved = absolute;
  try {
    if (statSync(resolved).isFile()) resolved = join(resolved, "..");
  } catch {
    return undefined;
  }
  try {
    return statSync(resolved).isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/**
 * F107-FR-002 — resolve the features in scope. On refusal the message is the
 * one the requirement states, exit 2 (F107-FR-006).
 */
export function resolveFeatures(root: string, featureArgs: readonly string[]): FeatureResolution {
  if (!existsSync(root)) {
    return { ok: false, message: `repository is not a directory: ${root}` };
  }
  try {
    if (!statSync(root).isDirectory()) {
      return { ok: false, message: `repository is not a directory: ${root}` };
    }
  } catch {
    return { ok: false, message: `repository is not a directory: ${root}` };
  }

  if (featureArgs.length > 0) {
    const dirs: string[] = [];
    for (const argument of featureArgs) {
      const dir = featureDirectoryOf(argument, root);
      if (dir === undefined) {
        return { ok: false, message: `feature path is not a directory: ${argument}` };
      }
      dirs.push(dir);
    }
    return { ok: true, featureDirs: dirs };
  }

  if (holdsAFeatureRoot(root)) return { ok: true, featureDirs: [root] };

  let entries: readonly string[];
  try {
    entries = readdirSync(join(root, "specs")).sort();
  } catch {
    entries = [];
  }
  const candidates = entries
    .map((name) => join(root, "specs", name))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory() && holdsAFeatureRoot(dir);
      } catch {
        return false;
      }
    });
  if (candidates.length === 1) return { ok: true, featureDirs: [candidates[0] as string] };
  const listed = candidates.map((dir) => relative(root, dir).split(sep).join("/")).join(", ");
  return {
    ok: false,
    message: `feature is ambiguous; pass --feature for each in-scope feature (candidates: ${listed === "" ? "none" : listed})`,
  };
}

/** The repository facts of the draft (F107-FR-003). */
export type RepositoryFacts = {
  readonly root: string;
  readonly revision: string | null;
  readonly dirty: boolean | null;
};

function runGit(root: string, args: readonly string[], timeout: number): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      timeout,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * F107-FR-003 — the revision from the version-control tool within 20 s, the
 * dirty mark within 30 s. Both null when the tool cannot be started, when a
 * query exceeds its limit, or when the revision cannot be read; the dirty mark
 * alone null when only the second query fails.
 */
export function repositoryFacts(root: string): RepositoryFacts {
  const revision = runGit(root, ["rev-parse", "HEAD"], REVISION_TIME_LIMIT_MS);
  if (revision === null || revision === "") {
    return { root, revision: null, dirty: null };
  }
  const status = runGit(root, ["status", "--porcelain"], DIRTY_TIME_LIMIT_MS);
  return { root, revision, dirty: status === null ? null : status !== "" };
}

/** The launch-contract id from the feature directories (F107-FR-003). */
export function contractId(root: string, featureDirs: readonly string[]): string {
  const names = featureDirs.map((dir) => basename(dir).toLowerCase());
  const joined = names.length === 0 ? "pipeline" : names.join("-and-");
  const collapsed = joined.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return collapsed === "" ? "pipeline" : collapsed;
}

/** The id rule applied to one name: the rule of F107-FR-003 for a stage id. */
export function idFromName(name: string): string {
  const collapsed = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return collapsed === "" ? "pipeline" : collapsed;
}

/** One phase of a feature record, with the baseline member names. */
export type FeaturePhase = {
  readonly number: number;
  readonly title: string;
  readonly line: number;
};

/**
 * The heading form that COUNTS as a phase: `## Phase <digits>`, optional
 * spaces, an optional COLON, then the title. A heading the old grammar could
 * not read — `## Phase 1 — Setup`, its separator an em-dash — is not a phase
 * (the DV-060 waiver): the tasks of such a section stay `unclassified`.
 *
 * The rule is read from the heading's WHITESPACE TOKENS, not from a regular
 * expression over the heading: F104-SC-001 keeps every reader of a phase
 * heading inside the spec-format package, so the number itself comes from the
 * canonical spec model's own parse (F107-FR-007) and this function only
 * decides whether the dialect this feature reads counts.
 */
export function countingPhaseNumberOf(heading: string): number | undefined {
  const tokens = heading.split(/[ \t]+/);
  if (tokens[0] !== "##" || tokens[1] !== "Phase") return undefined;
  const numbered = tokens[2];
  if (numbered === undefined) return undefined;
  const digits = numbered.replace(/:$/, "");
  if (!/^\d+$/.test(digits)) return undefined;
  // The em-dash form is the heading the OLD grammar could not read (DV-060):
  // no phase, and its tasks stay unclassified.
  if (tokens.some((token) => token.includes("—"))) return undefined;
  return Number.parseInt(digits, 10);
}

/** The number of a counting phase heading, or `undefined`.
 *  Kept as a name for the record of the dialect; see `countingPhaseNumberOf`. */
export const COUNTING_PHASE_HEADING = "## Phase <digits>[:| ] <title> (no em-dash)";

/** One record of `features` (data-model.md, "Feature record"). */
export type FeatureRecord = {
  readonly path: string;
  readonly slug: string;
  readonly phases: readonly FeaturePhase[];
  readonly task_count: number;
  readonly artifacts_present: readonly string[];
  readonly artifacts_absent: readonly string[];
};

/**
 * F107-FR-001/F107-FR-005 — the record of one feature: path, slug, phases
 * with number, title and line, task count, artifacts present and absent.
 * The phases and the task count are read through the canonical spec model
 * (F107-FR-007) and nothing else.
 */
export function featureRecord(root: string, featureDir: string): FeatureRecord {
  const tasksPath = join(featureDir, "tasks.md");
  const tasksText = existsSync(tasksPath) ? readUtf8(tasksPath) : undefined;
  const phases: FeaturePhase[] = [];
  let taskCount = 0;
  if (tasksText !== undefined) {
    const model = specModel.parse({
      file: relative(root, tasksPath).split(sep).join("/"),
      text: tasksText,
      format: "speckit-tasks",
      feature: basename(featureDir),
    });
    const lines = tasksText.split("\n");
    for (const phase of model.phases) {
      const heading = phase.section.split("\n")[0] ?? "";
      const line = lines.indexOf(heading) + 1;
      // The task count is the count of every task the model read, phased or not.
      taskCount += phase.tasks.length;
      // The heading form that counts (the DV-060 waiver): a heading the old
      // grammar could not read yields NO phase, and its tasks stay unclassified.
      if (countingPhaseNumberOf(heading) === undefined) continue;
      phases.push({ number: phase.number, title: phase.title, line: line === 0 ? 1 : line });
    }
  }
  const present: string[] = [];
  const absent: string[] = [];
  for (const artifact of [
    "spec.md",
    "plan.md",
    "tasks.md",
    "research.md",
    "data-model.md",
    "quickstart.md",
    "verification-commands.json",
  ]) {
    if (existsSync(join(featureDir, artifact))) present.push(artifact);
    else absent.push(artifact);
  }
  return {
    path: relative(root, featureDir).split(sep).join("/"),
    slug: basename(featureDir),
    phases,
    task_count: taskCount,
    artifacts_present: present,
    artifacts_absent: absent,
  };
}

function readUtf8(path: string): string {
  return readFileSync(path, "utf8");
}
