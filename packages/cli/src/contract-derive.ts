/**
 * `specstride contract derive` — the draft launch contract of the features in
 * scope, derived from the Spec Kit artifacts of the repository.
 *
 * Owner: feature 107 (`specs/107-launch-contract/`), F107-FR-002 to F107-FR-007.
 * This module is the first command of `@specstride/cli` and implements the
 * derivation of a DRAFT: the inventory, the coverage obligations, the one
 * bootstrap finding and the provenance of the draft. Promotion, the stage graph,
 * `--next-batch` and `launch` are the rest of that feature and are not here.
 *
 * What the draft holds, and where each rule comes from:
 *
 * | Member | Rule |
 * |---|---|
 * | `schema` = `specstride.launch-contract/1`, `status` = `draft`, `stages` = [] | F107-FR-005 |
 * | `generated_by.tool` = the logical component name `contract-derive`, never an implementation file | F107-FR-005 |
 * | `repository.root`, `.revision`, `.dirty`; the contract id | F107-FR-003 |
 * | `inventory.tasks`, `.shell_candidates`, `.prerequisites`, `.verification_documents` | F107-FR-004 |
 * | one `coverage` entry per task, `OBL-` + 12 hexadecimal characters of the content hash | F107-FR-004, F107-FR-005 |
 * | exactly one finding, `semantic-derivation-required` | F107-FR-005 |
 * | `configuration` holds the verification mode and no other member | F107-FR-005, F107-FR-036 |
 * | sorted keys, indent two, non-ASCII unescaped, a final line end, written atomically | F107-FR-006 |
 *
 * Two members are named differently from the as-is draft of mixture-of-loops, on
 * purpose and by the ruling of the divergence register: the schema id stands in the
 * field `schema` where the baseline wrote `schema_version` with the value `1.0`
 * (register row DV-120), and the five configuration keys the baseline writes and no
 * component reads are not written at all (F107-FR-024, register row DV-061).
 *
 * Deviation recorded here rather than hidden: F107-FR-007 requires the inventory to
 * read tasks, phases and the hash that ignores checkboxes only through the canonical
 * spec model of feature 104 (`@specstride/spec-formats`). That package is still the
 * skeleton of the campaign scaffolding, so the reading below is the baseline's own
 * grammar, line by line, which is what F107-FR-004 pins for every other candidate.
 * When feature 104 lands, the three readers marked `CANONICAL MODEL` give way to it
 * and nothing else here changes.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeSync,
  fsyncSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** The schema id of a launch contract (F107-FR-005). */
export const LAUNCH_CONTRACT_SCHEMA = "specstride.launch-contract/1" as const;

/** The logical component name this command is, and its version (F107-FR-005). */
export const COMPONENT = "contract-derive" as const;
export const COMPONENT_VERSION = "1.0" as const;

/** The artifacts of a feature, in the order a draft reports them (F107-FR-005). */
export const ARTIFACTS: readonly string[] = Object.freeze([
  "spec.md",
  "plan.md",
  "tasks.md",
  "research.md",
  "data-model.md",
  "quickstart.md",
  "verification-commands.json",
]);

/** A heading that opens a phase of a task list. */
const PHASE_PATTERN = /^##\s+Phase\s+(\d+)\s*:\s*(.+?)\s*$/i;
/** A line of a task list that declares a task. */
const TASK_PATTERN = /^-\s*\[([ xX])\]\s+(T\d+[A-Za-z]?)\s+(?:\[P\]\s+)?(?:\[([^\]]+)\]\s+)?(.*)$/;
/** A fence that opens a block of shell candidates (F107-FR-004). */
const FENCE_PATTERN = /^```(?:bash|sh|shell|console)?\s*$/i;
/** The id of a prerequisite, and the heading of a section of them. */
const PREREQUISITE_ID_PATTERN = /\b(PRE-\d+)\b/;
const PREREQUISITE_HEADING_PATTERN = /^#{1,6}\s.*prerequisite/i;
/** A path a source names between backticks. */
const BACKTICK_PATH_PATTERN = /`([^`\s]+)`/g;

/** The one finding a draft holds (F107-FR-005). */
export const BOOTSTRAP_FINDING = Object.freeze({
  id: "semantic-derivation-required",
  severity: "blocker",
  status: "open",
  message: "Classify every execution-relevant obligation and construct the stage graph.",
  resolution: "Complete semantic derivation, reconcile verification, and validate the contract.",
});

/** The verification mode a draft states, and the two reasons it may have (F107-FR-036). */
export const VERIFICATION_MODES: readonly string[] = Object.freeze(["required", "plan", "off"]);
export const VERIFICATION_REASONS: readonly string[] = Object.freeze(["declared", "configured"]);

/** A failure of reading or of value during derivation: exit 2 (F107-FR-006). */
export class DeriveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeriveError";
  }
}

/**
 * Every line end the canonical reading of a source knows. The three control
 * characters are line ends of the reading the baseline inherits from its own
 * language, and a source that holds one must not shift every line number after it.
 */
// eslint-disable-next-line no-control-regex -- they are line ends of the reading, not data
const LINE_END = new RegExp("\\r\\n|[\\r\\n\\v\\f\\u001c\\u001d\\u001e\\u0085\\u2028\\u2029]");

/**
 * The lines of a text, as the canonical reading of a source splits them: on every
 * line end the baseline's reader knows, and a final line end closes the last line
 * rather than opening an empty one.
 */
export function lines(text: string): readonly string[] {
  const split = text.split(LINE_END);
  if (split.length > 0 && split[split.length - 1] === "") split.pop();
  return split;
}

/** The content hash of some bytes or of a text (F104-FR-021: sha-256, hexadecimal). */
export function contentHash(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The content hash of a file. */
export function hashOfFile(path: string): string {
  return contentHash(readFileSync(path));
}

/**
 * CANONICAL MODEL (F107-FR-007): the hash that ignores the progress of a checkbox
 * and nothing else, so that ticking a task does not change the requirements.
 */
export function semanticHashOfFile(path: string, kind: string): string {
  let text = readFileSync(path, "utf8");
  if (kind === "tasks") {
    text = text.replace(/^(\s*-\s*\[)[ xX](\]\s+T\d+[A-Za-z]?\b)/gm, "$1 $2");
  }
  return contentHash(text);
}

/** A path under the repository root as it is reported: relative there, absolute elsewhere. */
export function relativeOrAbsolute(path: string, root: string): string {
  const within = relative(root, path);
  if (within === "" || within.startsWith("..") || isAbsolute(within)) return path;
  return within;
}

/** The revision of the repository and whether the tree is dirty (F107-FR-003). */
export function repositoryState(root: string): {
  readonly revision: string | null;
  readonly dirty: boolean | null;
} {
  try {
    const revision = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 20_000,
    });
    if (revision.error !== undefined || revision.status !== 0)
      return { revision: null, dirty: null };
    const dirty = spawnSync("git", ["-C", root, "status", "--porcelain"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    return {
      revision: revision.stdout.trim(),
      dirty:
        dirty.error !== undefined || dirty.status !== 0 ? null : dirty.stdout.trim().length > 0,
    };
  } catch {
    return { revision: null, dirty: null };
  }
}

/** Whether a path is a directory. */
function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/** Whether a path is a file. */
function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** The real path of a value, where it exists; the value resolved otherwise. */
function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The features in scope (F107-FR-002). */
export function resolveFeatures(root: string, requested: readonly string[]): readonly string[] {
  if (requested.length > 0) {
    return Object.freeze(
      requested.map((value) => {
        let path = isAbsolute(value) ? value : join(root, value);
        path = realOrResolved(path);
        if (isFile(path)) path = dirname(path);
        if (!isDirectory(path)) throw new DeriveError(`feature path is not a directory: ${value}`);
        return path;
      }),
    );
  }
  if (isFile(join(root, "tasks.md")) || isFile(join(root, "spec.md"))) return Object.freeze([root]);
  const specs = join(root, "specs");
  const candidates = (isDirectory(specs) ? readdirSync(specs).sort() : [])
    .map((name) => join(specs, name))
    .filter(
      (path) =>
        isDirectory(path) && (isFile(join(path, "tasks.md")) || isFile(join(path, "spec.md"))),
    )
    .map(realOrResolved)
    .sort();
  if (candidates.length !== 1) {
    const rendered = candidates.map((path) => relativeOrAbsolute(path, root)).join(", ") || "none";
    throw new DeriveError(
      `feature is ambiguous; pass --feature for each in-scope feature (candidates: ${rendered})`,
    );
  }
  return Object.freeze(candidates);
}

/** Every source of the draft, with the kind of each, sorted by path. */
export function sourceFiles(
  root: string,
  features: readonly string[],
): readonly { readonly path: string; readonly kind: string }[] {
  const found = new Map<string, string>();
  const constitution = join(root, ".specify", "memory", "constitution.md");
  if (isFile(constitution)) found.set(realOrResolved(constitution), "constitution");
  for (const feature of features) {
    for (const name of ARTIFACTS) {
      const path = join(feature, name);
      if (isFile(path)) found.set(realOrResolved(path), name.replace(/\.[^.]*$/, ""));
    }
    for (const [name, kind] of [
      ["contracts", "contract"],
      ["checklists", "checklist"],
    ] as const) {
      const directory = join(feature, name);
      if (!isDirectory(directory)) continue;
      const walk = (at: string): void => {
        for (const entry of readdirSync(at).sort()) {
          const path = join(at, entry);
          const stat = lstatSync(path);
          if (stat.isSymbolicLink()) continue;
          if (stat.isDirectory()) walk(path);
          else if (stat.isFile()) found.set(realOrResolved(path), kind);
        }
      };
      walk(directory);
    }
  }
  return Object.freeze(
    [...found.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, kind]) => Object.freeze({ path, kind })),
  );
}

/** One task of a task list. */
export type TaskRecord = {
  readonly id: string;
  readonly phase: number | null;
  readonly line: number;
  readonly checked: boolean;
  readonly parallel_marker: boolean;
  readonly story: string | null;
  readonly text: string;
  readonly source: string;
};

/** One phase of a task list. */
export type PhaseRecord = {
  readonly number: number;
  readonly title: string;
  readonly line: number;
};

/**
 * CANONICAL MODEL (F107-FR-007): the phases and the tasks of a task list, read
 * line by line as F107-FR-004 pins the reading.
 */
export function readTasks(
  path: string,
  root: string,
): { readonly phases: readonly PhaseRecord[]; readonly tasks: readonly TaskRecord[] } {
  const phases: PhaseRecord[] = [];
  const tasks: TaskRecord[] = [];
  let phase: string | undefined;
  lines(readFileSync(path, "utf8")).forEach((raw, index) => {
    const lineNumber = index + 1;
    const heading = PHASE_PATTERN.exec(raw);
    if (heading !== null) {
      phase = heading[1];
      phases.push({
        number: Number.parseInt(heading[1] as string, 10),
        title: heading[2] as string,
        line: lineNumber,
      });
      return;
    }
    const task = TASK_PATTERN.exec(raw);
    if (task === null) return;
    const text = task[4];
    const cut = text !== undefined && text !== "" ? raw.indexOf(text) : raw.length;
    tasks.push({
      id: task[2] as string,
      phase: phase !== undefined && phase !== "" ? Number.parseInt(phase, 10) : null,
      line: lineNumber,
      checked: (task[1] as string).toLowerCase() === "x",
      parallel_marker: raw.slice(0, cut).includes("[P]"),
      story: task[3] ?? null,
      text: (text ?? "").trim(),
      source: relativeOrAbsolute(path, root),
    });
  });
  return { phases: Object.freeze(phases), tasks: Object.freeze(tasks) };
}

/** One fenced block of a plan or a quickstart (F107-FR-004). */
export type ShellCandidate = {
  readonly path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly text: string;
  readonly classification: "candidate-only";
};

/**
 * The fenced blocks of one source, read line by line. A fence of another kind
 * opens nothing and its closing fence opens a plain block: the reading of the
 * baseline is kept as it is, and `candidate-only` is what keeps such a block from
 * becoming a command (F107-FR-004).
 */
export function shellCandidates(path: string, root: string): readonly ShellCandidate[] {
  const candidates: ShellCandidate[] = [];
  let start: number | undefined;
  let body: string[] = [];
  lines(readFileSync(path, "utf8")).forEach((raw, index) => {
    const lineNumber = index + 1;
    if (start === undefined) {
      if (FENCE_PATTERN.test(raw)) {
        start = lineNumber + 1;
        body = [];
      }
      return;
    }
    if (raw.trim() === "```") {
      const text = body.join("\n").trim();
      if (text !== "") {
        candidates.push({
          path: relativeOrAbsolute(path, root),
          start_line: start,
          end_line: lineNumber - 1,
          text,
          classification: "candidate-only",
        });
      }
      start = undefined;
      body = [];
      return;
    }
    body.push(raw);
  });
  return Object.freeze(candidates);
}

/** One prerequisite a source names (F107-FR-004). */
export type PrerequisiteCandidate = {
  readonly id: string | null;
  readonly source: { readonly path: string; readonly line: number; readonly anchor: string };
  readonly path: string;
  readonly resolved: string;
  readonly present: boolean;
};

/**
 * Every path a source names beside a prerequisite id or under a heading of
 * prerequisites, resolved against the repository root and checked for existence
 * (F107-FR-004). Only existence is recorded; what blocks when the item is absent
 * stays a semantic finding.
 */
export function prerequisiteCandidates(
  path: string,
  root: string,
): readonly PrerequisiteCandidate[] {
  const candidates: PrerequisiteCandidate[] = [];
  let inSection = false;
  lines(readFileSync(path, "utf8")).forEach((raw, index) => {
    const lineNumber = index + 1;
    const stripped = raw.trim();
    if (stripped.startsWith("#")) {
      inSection = PREREQUISITE_HEADING_PATTERN.test(stripped);
      return;
    }
    const id = PREREQUISITE_ID_PATTERN.exec(stripped)?.[1];
    if (id === undefined && !inSection) return;
    for (const match of stripped.matchAll(BACKTICK_PATH_PATTERN)) {
      const token = match[1] as string;
      if (!token.includes("/") && !token.includes(".")) continue;
      if (token.startsWith("-") || token.includes(" ")) continue;
      const resolved = isAbsolute(token) ? token : realOrResolved(join(root, token));
      candidates.push({
        id: id ?? null,
        source: {
          path: relativeOrAbsolute(path, root),
          line: lineNumber,
          anchor: id ?? "prerequisites",
        },
        path: token,
        resolved: relativeOrAbsolute(resolved, root),
        present: existsSync(resolved),
      });
    }
  });
  return Object.freeze(candidates);
}

/** The record of a verification-commands document (F107-FR-004). */
export function verificationDocument(path: string, root: string): Record<string, unknown> {
  const record: Record<string, unknown> = {
    path: relativeOrAbsolute(path, root),
    valid_json: false,
  };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    record["error"] = error instanceof Error ? error.message : String(error);
    return record;
  }
  const isRecord = value !== null && typeof value === "object" && !Array.isArray(value);
  record["valid_json"] = isRecord;
  if (isRecord) {
    const parsed = value as Record<string, unknown>;
    record["feature"] = parsed["feature"] ?? null;
    record["phase_map"] = parsed["phase_map"] ?? null;
    if (Array.isArray(parsed["commands"])) record["commands"] = parsed["commands"];
  }
  return record;
}

/** The id of the coverage obligation of one task (F107-FR-004). */
export function obligationId(task: TaskRecord): string {
  const seed = `${task.source}:${String(task.line)}:${task.id}:${task.text}`;
  return `OBL-${contentHash(seed).slice(0, 12).toUpperCase()}`;
}

/** The id of the launch contract: the feature slugs joined by `-and-` (F107-FR-003). */
export function contractId(features: readonly string[]): string {
  const joined = features
    .map(
      (feature) =>
        feature
          .split("/")
          .filter((p) => p !== "")
          .pop() ?? "",
    )
    .map((name) => name.toLowerCase())
    .join("-and-");
  const collapsed = joined.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return collapsed === "" ? "pipeline" : collapsed;
}

/** The verification mode a draft states, with the reason it is printed with (F107-FR-036). */
export function verificationMode(declaredCommands: number): {
  readonly mode: string;
  readonly reason: string;
} {
  return declaredCommands > 0
    ? { mode: "required", reason: "declared" }
    : { mode: "required", reason: "configured" };
}

/** Options of one derivation. */
export type DeriveOptions = {
  readonly repo: string;
  readonly feature: readonly string[];
  readonly output: string;
  readonly comment?: string;
};

/** The draft launch contract of the features in scope. */
export function buildContract(
  root: string,
  features: readonly string[],
  options: { readonly comment?: string } = {},
): Record<string, unknown> {
  const sources: Record<string, unknown>[] = [];
  const allTasks: TaskRecord[] = [];
  const featureRecords: Record<string, unknown>[] = [];
  const candidates: ShellCandidate[] = [];
  const prerequisites: PrerequisiteCandidate[] = [];
  const verification: Record<string, unknown>[] = [];

  for (const { path, kind } of sourceFiles(root, features)) {
    let lineCount = 0;
    try {
      lineCount = lines(readFileSync(path, "utf8")).length;
    } catch {
      lineCount = 0;
    }
    const source: Record<string, unknown> = {
      path: relativeOrAbsolute(path, root),
      kind,
      sha256: hashOfFile(path),
      lines: lineCount,
    };
    if (kind === "tasks") source["semantic_sha256"] = semanticHashOfFile(path, kind);
    sources.push(source);
    const name = path.split("/").pop() ?? "";
    if (name === "plan.md" || name === "quickstart.md") {
      candidates.push(...shellCandidates(path, root));
    }
    if (name.endsWith(".md")) prerequisites.push(...prerequisiteCandidates(path, root));
    if (name === "verification-commands.json") verification.push(verificationDocument(path, root));
  }

  for (const feature of features) {
    let phases: readonly PhaseRecord[] = [];
    let tasks: readonly TaskRecord[] = [];
    const tasksPath = join(feature, "tasks.md");
    if (isFile(tasksPath)) {
      const read = readTasks(realOrResolved(tasksPath), root);
      phases = read.phases;
      tasks = read.tasks;
      allTasks.push(...tasks);
    }
    featureRecords.push({
      path: relativeOrAbsolute(feature, root),
      slug:
        feature
          .split("/")
          .filter((p) => p !== "")
          .pop() ?? "",
      phases,
      task_count: tasks.length,
      artifacts_present: ARTIFACTS.filter((name) => isFile(join(feature, name))),
      artifacts_absent: ARTIFACTS.filter((name) => !isFile(join(feature, name))),
    });
  }

  const state = repositoryState(root);
  const coverage = allTasks.map((task) => ({
    id: obligationId(task),
    source: { path: task.source, line: task.line, anchor: task.id },
    kind: "implementation",
    timing: task.phase === null ? "unclassified" : `specstride-phase:${String(task.phase)}`,
    producer: "unclassified",
    disposition: "unresolved",
    stage_ids: [],
    verification_ids: [],
    rationale: task.text,
    evidence: [],
  }));
  const findingSource =
    coverage[0]?.source ??
    ({
      path: (sources[0]?.["path"] as string | undefined) ?? ".",
      line: 1,
      anchor: "artifact-set",
    } as const);

  const declaredCommands = verification.reduce(
    (total, document) =>
      total + (Array.isArray(document["commands"]) ? document["commands"].length : 0),
    0,
  );
  const configuration: Record<string, unknown> = {
    verification: { mode: verificationMode(declaredCommands).mode },
  };
  // The hash of the comment is recorded before anything of the repository is
  // printed, so the comment is bound first (F107-FR-034).
  if (options.comment !== undefined) configuration["comment"] = contentHash(options.comment);

  return {
    schema: LAUNCH_CONTRACT_SCHEMA,
    id: contractId(features),
    status: "draft",
    generated_by: { tool: COMPONENT, version: COMPONENT_VERSION },
    repository: { root, revision: state.revision, dirty: state.dirty },
    authorized_roots: [root],
    features: featureRecords,
    sources,
    inventory: {
      tasks: allTasks,
      shell_candidates: candidates,
      prerequisites,
      verification_documents: verification,
    },
    configuration,
    coverage,
    findings: [
      {
        id: BOOTSTRAP_FINDING.id,
        severity: BOOTSTRAP_FINDING.severity,
        status: BOOTSTRAP_FINDING.status,
        message: BOOTSTRAP_FINDING.message,
        source: findingSource,
        resolution: BOOTSTRAP_FINDING.resolution,
      },
    ],
    stages: [],
  };
}

/** Every object of a value, with its members in the order of their names. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return out;
}

/** The text of a draft: sorted keys, indent two, non-ASCII unescaped, a final line end. */
export function renderContract(contract: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(sortKeys(contract), null, 2)}\n`;
}

/** Write a file atomically: a temporary name, forced to disk, renamed (F107-FR-006). */
export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(
    dirname(path),
    `.${path.split("/").pop() ?? "out"}.${String(process.pid)}.tmp`,
  );
  const handle = openSync(temporary, "wx", 0o600);
  try {
    writeSync(handle, text);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temporary, path);
}

/** Derive one draft and write it where the options say. */
export function derive(options: DeriveOptions): string {
  const root = realOrResolved(options.repo);
  if (!isDirectory(root)) throw new DeriveError(`repository is not a directory: ${root}`);
  const features = resolveFeatures(root, options.feature);
  const contract = buildContract(root, features, {
    ...(options.comment === undefined ? {} : { comment: options.comment }),
  });
  const rendered = renderContract(contract);
  if (options.output === "-") process.stdout.write(rendered);
  else writeAtomic(resolve(options.output), rendered);
  return rendered;
}

/** The options `contract derive` takes (F107-FR-002, F107-FR-034). */
export function parseDeriveArguments(argv: readonly string[]): DeriveOptions {
  let repo: string | undefined;
  const feature: string[] = [];
  let output = "-";
  let comment: string | undefined;
  for (let at = 0; at < argv.length; at += 1) {
    const name = argv[at] as string;
    const value = (): string => {
      const next = argv[at + 1];
      if (next === undefined) throw new DeriveError(`${name} needs a value`);
      at += 1;
      return next;
    };
    if (name === "--repo") repo = value();
    else if (name === "--feature") feature.push(value());
    else if (name === "--output") output = value();
    else if (name === "--comment") comment = value();
    else if (name === "--learning-mode") {
      const mode = value();
      if (!["off", "suggest", "apply"].includes(mode)) {
        throw new DeriveError(`--learning-mode is one of off, suggest, apply: ${mode}`);
      }
    } else if (name === "--applied-file") value();
    else throw new DeriveError(`unknown option: ${name}`);
  }
  if (repo === undefined) throw new DeriveError("--repo is required");
  return Object.freeze({
    repo,
    feature: Object.freeze(feature),
    output,
    ...(comment === undefined ? {} : { comment }),
  });
}

/** `contract derive` as a command: exit 0 when it wrote the draft, 2 on a failure. */
export function contractDerive(argv: readonly string[]): number {
  try {
    derive(parseDeriveArguments(argv));
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
