/**
 * The frame of the reverse lint: its arguments, its levels, the ownership of
 * the artifacts, the loading of the templates and the order of the findings
 * (F140-FR-001, F140-FR-002, F140-FR-003, F140-FR-004).
 *
 * A port of `lint`, `load_template`, `load_inventory` and the `lint` branch of
 * `main` of the Specstride baseline (`lib/reverse.py` at `9cab15d`), with the
 * baseline's message bytes and its exit codes. The one difference from the
 * baseline's document is the field `schema` an inventory now carries, which
 * `loadInventory` refuses to do without (F140-FR-021, F100-FR-049).
 *
 * The lint WRITES NOTHING: it reads the feature directory, the templates, the
 * source and — with `--baseline` — an inventory, and prints.
 */

import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { compareCodePoint } from "../inventory/serialize.ts";
import type { CitationInventory } from "./evidence.ts";
import { EvidenceContext } from "./evidence.ts";
import type { FindingReport } from "./findings.ts";
import { Findings, printFindingsJson, printFindingsText } from "./findings.ts";
import { productRoot, requireTheNotice, shippedTemplatesDirectory } from "./shipped.ts";
import { lintChecklist, lintDataModel, lintResearch, lintSpec } from "./spec.ts";
import type { FeatureLayout } from "./templates.ts";
import { lintPlaceholders, lintStructure, lintTemplate } from "./templates.ts";
import { lintClaimsFile, lintCoverage, lintTasks } from "./tasks.ts";

/* ------------------------------------------------------------------ *
 * F140-FR-001 — the exit codes
 * ------------------------------------------------------------------ */

/** Nothing to report (F140-FR-001). */
export const EXIT_OK = 0 as const;
/** A usage error: an argument that is not of its type (F140-FR-001). */
export const EXIT_USAGE = 2 as const;
/** Findings, and invalid input alike — the one code for both (F140-FR-001). */
export const EXIT_FINDINGS = 3 as const;

/* ------------------------------------------------------------------ *
 * F140-FR-004 — the levels, the layout and the ownership
 * ------------------------------------------------------------------ */

/** The six levels of `--upto` (F140-FR-002, F140-FR-004). */
export const LEVELS = Object.freeze([0, 1, 2, 3, 4, 5] as const);

/** The default level of `--upto`. */
export const DEFAULT_LEVEL = 5 as const;

/**
 * The Spec Kit feature layout (F140-FR-004). `contracts/*.md` is the only
 * pattern and is therefore not a row here; `lintStructure` matches it.
 */
export const LAYOUT = Object.freeze([
  "spec.md",
  "plan.md",
  "research.md",
  "data-model.md",
  "quickstart.md",
  "tasks.md",
  "checklists/requirements.md",
  "memory/constitution.md",
] as const);

/** The one directory of the layout that is a pattern. */
export const CONTRACTS_DIRECTORY = "contracts" as const;

/**
 * Which artifacts each level owns (F140-FR-004). Level 0 owns nothing: it is
 * the level of the unit phases of an oversize run, which write only a scratch
 * claims file that `--claims` checks. Level 5 owns no new artifact and adds
 * the coverage rule.
 */
export const OWNERSHIP: ReadonlyMap<number, readonly string[]> = Object.freeze(
  new Map<number, readonly string[]>([
    [1, Object.freeze(["spec.md", "checklists/requirements.md", "memory/constitution.md"])],
    [2, Object.freeze(["plan.md", "research.md"])],
    [3, Object.freeze(["data-model.md", CONTRACTS_DIRECTORY, "quickstart.md"])],
    [4, Object.freeze(["tasks.md"])],
    [5, Object.freeze([])],
  ]),
);

/** Which template each template-driven artifact is checked against. */
export const TEMPLATE_FOR: ReadonlyMap<string, string> = Object.freeze(
  new Map<string, string>([
    ["spec.md", "spec-template.md"],
    ["plan.md", "plan-template.md"],
    ["tasks.md", "tasks-template.md"],
    ["checklists/requirements.md", "checklist-template.md"],
    ["memory/constitution.md", "constitution-template.md"],
  ]),
);

/** The artifacts that get the fixed-pattern placeholder check only. */
export const PLAIN_ARTIFACTS = Object.freeze([
  "research.md",
  "data-model.md",
  "quickstart.md",
] as const);

/** The base name of the workspace part, never a citable path (annex B §B.5). */
export const WORKSPACE_PART_BASENAME = ".specstride" as const;

/** The directory of the source the lint takes its templates from first. */
export const SOURCE_TEMPLATES_DIRECTORY = Object.freeze([".specify", "templates"] as const);

/** Where a source keeps its constitution, which decides the output's. */
export const SOURCE_CONSTITUTION = Object.freeze([
  ".specify",
  "memory",
  "constitution.md",
] as const);

/** The layout as the structure rules want it. */
export const FEATURE_LAYOUT: FeatureLayout = Object.freeze({
  paths: LAYOUT,
  contractsDirectory: CONTRACTS_DIRECTORY,
  ownership: OWNERSHIP,
});

/** Is this value one of the six levels? */
export function isALevel(value: number): boolean {
  return (LEVELS as readonly number[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * Errors: invalid input, which exits 3 (F140-FR-001)
 * ------------------------------------------------------------------ */

/**
 * Invalid input of the lint. Printed `reverse: <message>` on the error
 * stream, exit 3 — the one code the baseline uses for findings and for
 * invalid input alike (F140-FR-001, ruling K7).
 */
export class ReverseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReverseError";
  }
}

/** A usage error: an argument that is not of its type. Exit 2. */
export class ReverseUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReverseUsageError";
  }
}

/* ------------------------------------------------------------------ *
 * The inventory of `--baseline` (F140-FR-002, F140-FR-021)
 * ------------------------------------------------------------------ */

/** The schema id of the inventory document (annex B §B.20). */
export const INVENTORY_SCHEMA = "specstride.reverse-inventory/1" as const;

/** The major of the schema id the reader accepts. */
export const INVENTORY_SCHEMA_MAJOR = "1" as const;

/** The id and the major of a schema value, or null when it is malformed. */
function schemaParts(value: unknown): { id: string; major: string } | null {
  if (typeof value !== "string") return null;
  const slash = value.lastIndexOf("/");
  if (slash <= 0) return null;
  return { id: value.slice(0, slash), major: value.slice(slash + 1) };
}

/**
 * Read an inventory document for `--baseline` (F140-FR-002): a document that
 * is not an object with `fingerprint` and `files`, or whose field `schema` is
 * absent, unknown or of another major, is refused with
 * `not an inventory: <path>` (F100-FR-049).
 */
export function loadInventory(path: string): CitationInventory {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ReverseError(`cannot read inventory ${path}: ${reason}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ReverseError(`not an inventory: ${path}`);
  }
  const document = data as Record<string, unknown>;
  if (!("fingerprint" in document) || !("files" in document)) {
    throw new ReverseError(`not an inventory: ${path}`);
  }
  const parts = schemaParts(document["schema"]);
  const expected = schemaParts(INVENTORY_SCHEMA) as { id: string; major: string };
  if (parts === null || parts.id !== expected.id || parts.major !== expected.major) {
    throw new ReverseError(`not an inventory: ${path}`);
  }
  const project = document["project"];
  const workspaces =
    typeof project === "object" && project !== null
      ? ((project as Record<string, unknown>)["workspaces"] ?? [])
      : [];
  return Object.freeze({
    files: (document["files"] ?? []) as CitationInventory["files"],
    skipped: (document["skipped"] ?? []) as CitationInventory["skipped"],
    project: Object.freeze({ workspaces: workspaces as readonly { readonly path: string }[] }),
  });
}

/* ------------------------------------------------------------------ *
 * Template loading (F140-FR-005)
 * ------------------------------------------------------------------ */

/** A template that was found: its text and the path it was read from. */
export interface LoadedTemplate {
  readonly text: string;
  readonly path: string;
  /** True when the template came from the shipped copy, not from the source. */
  readonly shipped: boolean;
}

/** Where the lint looks for its templates, and for the product's root. */
export interface TemplateSources {
  /** The source tree, whose `.specify/templates/` comes first; null without `--src`. */
  readonly src: string | null;
  /** The root of the installed product, for the shipped copy and the messages. */
  readonly productRoot: string;
}

function isAFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isADirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The text of a template (F140-FR-005): `<SRC>/.specify/templates/` first,
 * the shipped copy otherwise. Reaching for the shipped copy checks its notice
 * first (F140-FR-026), so a product shipped without the templates or without
 * their MIT notice fails loudly.
 */
export function loadTemplate(name: string, sources: TemplateSources): LoadedTemplate | null {
  if (sources.src !== null) {
    const local = join(sources.src, ...SOURCE_TEMPLATES_DIRECTORY, name);
    if (isAFile(local)) {
      return Object.freeze({ text: readFileSync(local, "utf8"), path: local, shipped: false });
    }
  }
  const shipped = join(shippedTemplatesDirectory(sources.productRoot), name);
  if (isAFile(shipped)) {
    requireTheNotice(sources.productRoot);
    return Object.freeze({ text: readFileSync(shipped, "utf8"), path: shipped, shipped: true });
  }
  return null;
}

/**
 * Which directory the templates of a run come from (the note the plan of
 * feature 108 prints): the source's own when it has one, else the shipped
 * copy.
 */
export function templateDirectoryNote(sources: TemplateSources): string {
  if (sources.src !== null) {
    const local = join(sources.src, ...SOURCE_TEMPLATES_DIRECTORY);
    if (isADirectory(local)) return local;
  }
  return shippedTemplatesDirectory(sources.productRoot);
}

/* ------------------------------------------------------------------ *
 * The lint itself (F140-FR-002, F140-FR-004)
 * ------------------------------------------------------------------ */

/** What the lint is given (F140-FR-002). */
export interface LintOptions {
  /** The feature directory to check. */
  readonly featureDir: string;
  /** The source, which enables the evidence checks against it. */
  readonly src?: string | null | undefined;
  /** An inventory, which citations resolve against instead of the live tree. */
  readonly baseline?: string | null | undefined;
  /** The level, 0 to 5; 5 by default. */
  readonly upto?: number | undefined;
  /** A scratch claims file to lint as well. */
  readonly claims?: string | null | undefined;
  /** The root of the installed product; the package's own by default. */
  readonly productRoot?: string | undefined;
}

/**
 * The reverse lint (F140-FR-002, F140-FR-004). The levels are CUMULATIVE:
 * `--upto N` checks every artifact owned by the levels 1 to N and neither
 * requires nor lints the artifacts of higher levels.
 */
export function lint(options: LintOptions): Findings {
  const findings = new Findings();
  const upto = options.upto ?? DEFAULT_LEVEL;
  if (!isADirectory(options.featureDir)) {
    throw new ReverseError(`feature directory not found: ${options.featureDir}`);
  }
  if (!isALevel(upto)) {
    throw new ReverseError(`--upto must be one of ${LEVELS.join(", ")}`);
  }
  const featureDir = resolve(options.featureDir);
  const realFeatureDir = realOf(featureDir);
  const baseline = options.baseline ?? null;
  const inventory = baseline === null ? null : loadInventory(baseline);
  const givenSrc = options.src ?? null;
  const root = options.productRoot ?? productRoot();
  let ectx: EvidenceContext | null = null;
  let constitutionNeeded: boolean | null = null;
  let src: string | null = null;
  if (givenSrc !== null) {
    if (!isADirectory(givenSrc)) {
      throw new ReverseError(`--src is not a directory: ${givenSrc}`);
    }
    src = realOf(resolve(givenSrc));
    constitutionNeeded = !isAFile(join(src, ...SOURCE_CONSTITUTION));
    const excluded: string[] = [];
    if (isWithin(realFeatureDir, src)) {
      excluded.push(relative(src, realFeatureDir).split(/[\\/]/).join("/"));
    }
    excluded.push(WORKSPACE_PART_BASENAME);
    ectx = new EvidenceContext(src, inventory, excluded);
  } else {
    findings.warn("evidence.skipped", null, null, "no --src: evidence citations were not checked");
  }
  const sources: TemplateSources = Object.freeze({ src, productRoot: root });
  const { present, contracts } = lintStructure(
    findings,
    featureDir,
    upto,
    constitutionNeeded,
    FEATURE_LAYOUT,
  );
  const owned = new Set<string>();
  for (let owner = 1; owner <= upto; owner += 1) {
    for (const rel of OWNERSHIP.get(owner) ?? []) owned.add(rel);
  }
  const textOf = (rel: string): string | null =>
    present.has(rel) ? readFileSync(join(featureDir, rel), "utf8") : null;

  for (const rel of [...TEMPLATE_FOR.keys()].sort(compareCodePoint)) {
    if (!owned.has(rel) || !present.has(rel)) continue;
    const template = loadTemplate(TEMPLATE_FOR.get(rel) as string, sources);
    const text = textOf(rel) as string;
    if (template !== null) {
      lintTemplate(findings, rel, text, template.text, template.path, root);
    }
    lintPlaceholders(findings, rel, text, template === null ? null : template.text);
  }
  for (const rel of [...PLAIN_ARTIFACTS, ...contracts]) {
    const owner = rel.startsWith(`${CONTRACTS_DIRECTORY}/`) ? CONTRACTS_DIRECTORY : rel;
    if (owned.has(owner) && present.has(rel)) {
      lintPlaceholders(findings, rel, textOf(rel) as string, null);
    }
  }
  let stories: ReadonlySet<number> | null = null;
  let requirements: ReadonlySet<string> = new Set();
  if (owned.has("spec.md") && present.has("spec.md")) {
    const survey = lintSpec(findings, textOf("spec.md") as string, ectx);
    stories = survey.stories;
    requirements = survey.requirements;
  }
  if (owned.has("checklists/requirements.md") && present.has("checklists/requirements.md")) {
    lintChecklist(findings, textOf("checklists/requirements.md") as string, ectx);
  }
  if (owned.has("research.md") && present.has("research.md")) {
    lintResearch(findings, textOf("research.md") as string, ectx);
  }
  if (owned.has("data-model.md") && present.has("data-model.md")) {
    lintDataModel(findings, textOf("data-model.md") as string, ectx);
  }
  if (owned.has("tasks.md") && present.has("tasks.md")) {
    const descriptions = lintTasks(
      findings,
      textOf("tasks.md") as string,
      stories,
      basename(featureDir),
    );
    if (upto >= 5) lintCoverage(findings, requirements, descriptions);
  }
  const claims = options.claims ?? null;
  if (claims !== null) lintClaimsFile(findings, claims, ectx);
  return findings;
}

/**
 * The real path of a path, as the baseline's `_real` gives it: links
 * resolved, the path itself where it cannot be resolved.
 */
function realOf(path: string): string {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

/** Is `path` inside `root`, or `root` itself? */
function isWithin(path: string, root: string): boolean {
  const inside = relative(root, path);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
}

/* ------------------------------------------------------------------ *
 * The verb (F140-FR-001, F140-FR-002, F140-FR-003)
 * ------------------------------------------------------------------ */

/** The arguments of `reverse lint`, as F140-FR-002 fixes them. */
export interface LintArguments {
  readonly featureDir: string;
  readonly src: string | null;
  readonly baseline: string | null;
  readonly upto: number;
  readonly claims: string | null;
  readonly json: boolean;
}

/** The usage line the verb prints on a usage error. */
export const LINT_USAGE =
  "usage: specstride reverse lint <feature-dir> [--src SRC] [--baseline INV] " +
  "[--upto N] [--claims FILE] [--json]";

const VALUED_FLAGS = Object.freeze(["--src", "--baseline", "--upto", "--claims"] as const);

/**
 * Parse the arguments of `reverse lint` (F140-FR-002). A `--upto` that is not
 * an integer is a USAGE error (exit 2); a `--upto` outside 0 to 5 is invalid
 * input (exit 3), and is refused by `lint` and not here.
 */
export function parseLintArguments(argv: readonly string[]): LintArguments {
  let featureDir: string | null = null;
  let src: string | null = null;
  let baseline: string | null = null;
  let claims: string | null = null;
  let upto: number = DEFAULT_LEVEL;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument === "--json") {
      json = true;
      continue;
    }
    if ((VALUED_FLAGS as readonly string[]).includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new ReverseUsageError(`argument ${argument}: expected one argument`);
      }
      index += 1;
      if (argument === "--src") src = value;
      else if (argument === "--baseline") baseline = value;
      else if (argument === "--claims") claims = value;
      else {
        if (!/^[+-]?\d+$/.test(value.trim())) {
          throw new ReverseUsageError(`argument --upto: invalid int value: '${value}'`);
        }
        upto = Number.parseInt(value.trim(), 10);
      }
      continue;
    }
    if (argument.startsWith("-")) {
      throw new ReverseUsageError(`unrecognized arguments: ${argument}`);
    }
    if (featureDir !== null) {
      throw new ReverseUsageError(`unrecognized arguments: ${argument}`);
    }
    featureDir = argument;
  }
  if (featureDir === null) {
    throw new ReverseUsageError("the following arguments are required: feature_dir");
  }
  return Object.freeze({ featureDir, src, baseline, upto, claims, json });
}

/** What the verb produced: its exit code and its two streams. */
export interface VerbResult {
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The findings, where the lint ran; null where it did not. */
  readonly report: FindingReport | null;
}

/**
 * The whole verb `reverse lint` (F140-FR-001, F140-FR-003): exit 3 when at
 * least one finding has the severity error and 0 otherwise — warnings alone
 * never fail it — exit 2 on a usage error, and exit 3 with
 * `reverse: <message>` on the error stream for invalid input.
 */
export function runLint(
  argv: readonly string[],
  options: { readonly productRoot?: string | undefined } = {},
): VerbResult {
  let parsed: LintArguments;
  try {
    parsed = parseLintArguments(argv);
  } catch (error) {
    if (error instanceof ReverseUsageError) {
      return Object.freeze({
        exit: EXIT_USAGE,
        stdout: "",
        stderr: `${LINT_USAGE}\nspecstride reverse lint: error: ${error.message}\n`,
        report: null,
      });
    }
    throw error;
  }
  let findings: Findings;
  try {
    findings = lint({
      featureDir: parsed.featureDir,
      src: parsed.src,
      baseline: parsed.baseline,
      upto: parsed.upto,
      claims: parsed.claims,
      ...(options.productRoot === undefined ? {} : { productRoot: options.productRoot }),
    });
  } catch (error) {
    if (error instanceof ReverseError) {
      return Object.freeze({
        exit: EXIT_FINDINGS,
        stdout: "",
        stderr: `reverse: ${error.message}\n`,
        report: null,
      });
    }
    throw error;
  }
  const report = findings.report();
  return Object.freeze({
    exit: report.errors.length > 0 ? EXIT_FINDINGS : EXIT_OK,
    stdout: parsed.json ? printFindingsJson(report) : printFindingsText(report),
    stderr: "",
    report,
  });
}
