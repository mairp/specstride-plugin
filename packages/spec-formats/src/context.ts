/**
 * T029 — the CONTEXT DOCUMENTS of a spec and the BUDGET (F104-FR-016).
 *
 * Context is read-only background, never a gate: the block says so in its own
 * heading, which is what B-2012 records. The records this module is measured
 * against, read by research report R18 at their lines of
 * `lib/specstride_spec.py`:
 *
 *  - B-2058 the native format renders NO context;
 *  - B-2048 the Spec Kit order: constitution, spec, plan, `contract:<stem>`
 *    (sorted), data-model, research, quickstart, `checklist:<stem>` (sorted),
 *    each only when the file exists;
 *  - B-2047 the constitution is context only when the spec is inside a
 *    `.specify` project;
 *  - B-2046 the OpenSpec order: `proposal`, `delta-spec:<name>` (recursive,
 *    sorted), `design`, then `current-spec:<name>` for each delta with a
 *    matching `openspec/specs/` file;
 *  - B-2049 the budget default, 24,000 characters across all documents;
 *  - B-2050 the per-document floor, 1,200 characters: a document that would
 *    get less is dropped, unless the whole document fits;
 *  - B-2052 the allocation: each document gets the smaller of its size, a fair
 *    share (at least the floor) and what remains; the leftover cascades;
 *  - B-2051 a cut falls on a line boundary (a hard cut only for one over-long
 *    line) and closes an unbalanced code fence;
 *  - B-2011 the marker a truncated document ends with;
 *  - B-2012 the heading of each block, and the blank line between blocks.
 *
 * Two readings are recorded in the code rather than chosen silently.
 *
 *  1. **What the budget counts.** F104-FR-016 says "Each document MUST get the
 *     smallest of its size, a fair share … and what remains", so the budget
 *     governs the CONTENT of the documents; the block heading of B-2012, the
 *     truncation marker of B-2011 and a fence closed by B-2051 are added by
 *     the renderer and are not charged against it. `servedCharactersOf` is
 *     exported, so the guarantee is measurable: the content served never
 *     exceeds the budget.
 *  2. **The name of an OpenSpec delta.** B-2046 writes `delta-spec:<name>` and
 *     "recursive, sorted", and the as-is source is not in this repository. The
 *     recorded reading is: the path of the file under the change's `specs/`,
 *     sorted, with a trailing `/spec.md` removed and otherwise the `.md`
 *     dropped — which is the name that makes `current-spec:<name>` resolve to
 *     `openspec/specs/<name>/spec.md`. `deltaNameOf` holds the rule in ONE
 *     place, so a capture of FX-10 settles it with one edit.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { keyOfEnvironmentVariable } from "@specstride/contracts/envelope/config-validate";
import {
  type ContextDocument,
  type FormatName,
  FORMAT_WITHOUT_CONTEXT_DOCUMENTS,
  linesOf,
} from "./model.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F104-FR-016"] as const;

/** The records of the baseline it is measured against. */
export const BEHAVIOUR_ROWS = Object.freeze([
  "B-2011",
  "B-2012",
  "B-2046",
  "B-2047",
  "B-2048",
  "B-2049",
  "B-2050",
  "B-2051",
  "B-2052",
  "B-2058",
]);

/* ------------------------------------------------------------------ *
 * The budget (F104-FR-016; B-2049, B-2050).
 * ------------------------------------------------------------------ */

/** The key of the budget (research D-7; row 49 of annex X §X.7). */
export const BUDGET_KEY = "spec.contextBudget" as const;

/** The as-is variable that is its alias (annex X §X.8). */
export const BUDGET_VARIABLE = "SPECSTRIDE_CONTEXT_BUDGET" as const;

/**
 * The key the alias table of `@specstride/contracts` pairs the variable with.
 * It is READ, not restated, so the pairing cannot drift from the one table.
 */
export const KEY_OF_THE_BUDGET_VARIABLE = keyOfEnvironmentVariable(BUDGET_VARIABLE);

/** B-2049 — the default budget: 24,000 characters across ALL documents. */
export const DEFAULT_BUDGET = 24_000 as const;

/** B-2050 — the per-document floor: 1,200 characters. */
export const FLOOR = 1_200 as const;

/** The one variable also feeds `reverse.contextBudget` of feature 108 (D-7). */
export const ALSO_FEEDS = "reverse.contextBudget" as const;

/**
 * F104-FR-016 — the budget from its input. A value that is not a WHOLE number
 * falls back to the default; so does a missing value, a negative one and
 * anything that is not a number at all.
 */
export function readBudget(value: unknown): number {
  const number = numberOf(value);
  if (!Number.isInteger(number) || number < 0) return DEFAULT_BUDGET;
  return number;
}

/**
 * The number an input stands for; `NaN` where it stands for none. An EMPTY
 * string is UNSET, not zero, so it falls back to the default.
 *
 * A STRING must be a run of digits. `Number("0x10")` is 16 and `Number("1e3")`
 * is 1000, but the baseline reads the variable with `int(value)`, which accepts
 * neither and falls back to the default (B-1997, "a non-integer value silently
 * falls back"). The rule here is therefore the same one `verb.ts` uses for a
 * phase number (`WHOLE_NUMBER`), so the two readings of "a whole number" in
 * this feature cannot drift apart. A `number` is taken as it is, because a
 * caller that already holds a number has not written a literal.
 */
const A_RUN_OF_DIGITS = /^[0-9]+$/;

function numberOf(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  const trimmed = value.trim();
  return A_RUN_OF_DIGITS.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/**
 * True where the input IS a whole number and so is taken as given, and false
 * where `readBudget` fell back to the default. The two are separate functions
 * on purpose: `readBudget(24000)` and `readBudget("nonsense")` both give
 * 24,000, and only this predicate tells a test which of the two happened.
 */
export function budgetIsTakenAsGiven(value: unknown): boolean {
  const number = numberOf(value);
  return Number.isInteger(number) && number >= 0;
}

/* ------------------------------------------------------------------ *
 * The documents of a spec, per format (F104-FR-016).
 * ------------------------------------------------------------------ */

/** The marker directory of a Spec Kit project (B-2043, B-2047). */
export const SPECIFY_DIRECTORY = ".specify" as const;

/** The constitution, relative to the project root (B-2047). */
export const CONSTITUTION_PATH = join(SPECIFY_DIRECTORY, "memory", "constitution.md");

/** B-2048 — the fixed documents of the Spec Kit order, name to file name. */
export const SPECKIT_FIXED_DOCUMENTS: readonly (readonly [string, string])[] = Object.freeze([
  ["spec", "spec.md"] as const,
  ["plan", "plan.md"] as const,
]);

/** B-2048 — the fixed documents that come AFTER the contracts. */
export const SPECKIT_FIXED_DOCUMENTS_AFTER_CONTRACTS: readonly (readonly [string, string])[] =
  Object.freeze([
    ["data-model", "data-model.md"] as const,
    ["research", "research.md"] as const,
    ["quickstart", "quickstart.md"] as const,
  ]);

/** B-2048 — the two directories whose stems become `contract:` and `checklist:`. */
export const SPECKIT_STEM_DIRECTORIES: readonly (readonly [string, string])[] = Object.freeze([
  ["contract", "contracts"] as const,
  ["checklist", "checklists"] as const,
]);

/** B-2048 — the whole Spec Kit order, as the row writes it. */
export const SPECKIT_ORDER: readonly string[] = Object.freeze([
  "constitution",
  "spec",
  "plan",
  "contract:<stem>",
  "data-model",
  "research",
  "quickstart",
  "checklist:<stem>",
]);

/** B-2046 — the whole OpenSpec order, as the row writes it. */
export const OPENSPEC_ORDER: readonly string[] = Object.freeze([
  "proposal",
  "delta-spec:<name>",
  "design",
  "current-spec:<name>",
]);

/** What a listing of context documents is given. */
export type ContextInput = {
  /** The root the returned paths are relative to: the workspace. */
  readonly root: string;
  /** The spec file, absolute or relative to the root. */
  readonly specPath: string;
  /** The format, detected once and handed on (F104-FR-007). */
  readonly format: FormatName;
};

/** A path of the listing: relative to the root, with `/` as the separator. */
function relativeTo(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

/** The `.md` files under a directory, recursively, sorted by relative path. */
function markdownFilesUnder(directory: string): readonly string[] {
  if (!existsSync(directory)) return Object.freeze([]);
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) found.push(path);
    }
  };
  walk(directory);
  return Object.freeze(found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The `.md` files directly in a directory, sorted by name (B-2048). */
function markdownFilesIn(directory: string): readonly string[] {
  if (!existsSync(directory)) return Object.freeze([]);
  return Object.freeze(
    readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(directory, entry.name))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * B-2043, B-2047 — the `.specify` project root of a spec, found by walking
 * UPWARD from the spec's directory; `undefined` where there is none.
 */
export function specifyProjectRootOf(specPath: string): string | undefined {
  let current = dirname(resolve(specPath));
  for (;;) {
    if (existsSync(join(current, SPECIFY_DIRECTORY))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** B-2046, reading 2 — the `<name>` of a delta file under the change's `specs/`. */
export function deltaNameOf(specsDirectory: string, file: string): string {
  const path = relative(specsDirectory, file).split(sep).join("/");
  if (path.endsWith("/spec.md")) return path.slice(0, -"/spec.md".length);
  if (path === "spec.md") return basename(dirname(file));
  return path.replace(/\.md$/, "");
}

/**
 * F104-FR-016, B-2048 — the Spec Kit context documents, in the row's order,
 * each only when the file exists.
 */
export function speckitContextDocumentsOf(input: ContextInput): readonly ContextDocument[] {
  const spec = resolve(input.root, input.specPath);
  const featureDirectory = dirname(spec);
  const documents: ContextDocument[] = [];
  const add = (name: string, path: string): void => {
    if (existsSync(path))
      documents.push(Object.freeze({ name, path: relativeTo(input.root, path) }));
  };
  // B-2047 — the constitution, only inside a `.specify` project.
  const project = specifyProjectRootOf(spec);
  if (project !== undefined) add("constitution", join(project, CONSTITUTION_PATH));
  for (const [name, file] of SPECKIT_FIXED_DOCUMENTS) add(name, join(featureDirectory, file));
  for (const file of markdownFilesIn(join(featureDirectory, "contracts"))) {
    add(`contract:${basename(file, ".md")}`, file);
  }
  for (const [name, file] of SPECKIT_FIXED_DOCUMENTS_AFTER_CONTRACTS) {
    add(name, join(featureDirectory, file));
  }
  for (const file of markdownFilesIn(join(featureDirectory, "checklists"))) {
    add(`checklist:${basename(file, ".md")}`, file);
  }
  return Object.freeze(documents);
}

/**
 * F104-FR-016, B-2046 — the OpenSpec context documents: `proposal`, the delta
 * specs (recursive, sorted), `design`, then one `current-spec:<name>` for each
 * delta that has a matching file under `openspec/specs/`.
 */
export function openspecContextDocumentsOf(input: ContextInput): readonly ContextDocument[] {
  const spec = resolve(input.root, input.specPath);
  const changeDirectory = dirname(spec);
  const documents: ContextDocument[] = [];
  const add = (name: string, path: string): void => {
    if (existsSync(path))
      documents.push(Object.freeze({ name, path: relativeTo(input.root, path) }));
  };
  add("proposal", join(changeDirectory, "proposal.md"));
  const specsDirectory = join(changeDirectory, "specs");
  const deltas = markdownFilesUnder(specsDirectory).map((file) => ({
    name: deltaNameOf(specsDirectory, file),
    file,
  }));
  for (const delta of deltas) add(`delta-spec:${delta.name}`, delta.file);
  add("design", join(changeDirectory, "design.md"));
  // `openspec/changes/<change>/tasks.md` → `openspec/specs/<name>/spec.md`.
  const openspecRoot = dirname(dirname(changeDirectory));
  for (const delta of deltas) {
    add(`current-spec:${delta.name}`, join(openspecRoot, "specs", delta.name, "spec.md"));
  }
  return Object.freeze(documents);
}

/**
 * F104-FR-016 — the context documents of a spec, in the order of its format.
 * `native` has NONE (B-2058).
 */
export function contextDocumentsOf(input: ContextInput): readonly ContextDocument[] {
  if (input.format === FORMAT_WITHOUT_CONTEXT_DOCUMENTS) return Object.freeze([]);
  if (input.format === "openspec-change") return openspecContextDocumentsOf(input);
  return speckitContextDocumentsOf(input);
}

/** `spec context` prints `name<TAB>path` per document; nothing for native. */
export function contextLinesOf(documents: readonly ContextDocument[]): readonly string[] {
  return Object.freeze(documents.map((document) => `${document.name}\t${document.path}`));
}

/* ------------------------------------------------------------------ *
 * The allocation and the rendering (F104-FR-016; B-2050 to B-2052).
 * ------------------------------------------------------------------ */

/** B-2011 — the marker a truncated document ends with. */
export const TRUNCATION_MARKER = "… (context truncated at line boundary) …" as const;

/** The code fence B-2051 closes when it is left unbalanced by a cut. */
export const CODE_FENCE = "```" as const;

/** B-2012 — the heading of one block. */
export function blockHeading(name: string, path: string): string {
  return `## Context: ${name} (read-only background, NOT a gate) — ${path}`;
}

/** B-2012 — blocks are joined by a BLANK line. */
export const BLOCK_SEPARATOR = "\n\n" as const;

/** One document with its content, as the allocation is given it. */
export type LoadedDocument = {
  readonly name: string;
  readonly path: string;
  readonly content: string;
};

/** What the allocation decided for one document. */
export type Allocation = {
  readonly name: string;
  readonly path: string;
  /** The characters of CONTENT it was served; 0 for a dropped document. */
  readonly served: number;
  readonly dropped: boolean;
  readonly truncated: boolean;
};

/**
 * F104-FR-016, B-2052 — the allocation. In the documents' own order, each gets
 * the SMALLEST of its size, a fair share (the larger of the remaining budget
 * divided by the documents not yet served and the floor) and what remains; a
 * document that would get less than the floor is DROPPED unless it fits whole.
 * What a document does not take cascades forward.
 */
export function allocate(
  documents: readonly LoadedDocument[],
  budget: number = DEFAULT_BUDGET,
): readonly Allocation[] {
  let remaining = budget;
  const allocations: Allocation[] = [];
  documents.forEach((document, index) => {
    const notYetServed = documents.length - index;
    const fairShare = Math.max(Math.floor(remaining / notYetServed), FLOOR);
    const share = Math.min(document.content.length, fairShare, remaining);
    // "a document that would get less than the floor MUST be dropped unless it
    // fits whole": a share under the floor is fine when it IS the whole
    // document, and otherwise the document is dropped.
    if (share < FLOOR && share < document.content.length) {
      allocations.push(
        Object.freeze({
          name: document.name,
          path: document.path,
          served: 0,
          dropped: true,
          truncated: false,
        }),
      );
      return;
    }
    remaining -= share;
    allocations.push(
      Object.freeze({
        name: document.name,
        path: document.path,
        served: share,
        dropped: false,
        truncated: share < document.content.length,
      }),
    );
  });
  return Object.freeze(allocations);
}

/** The characters of CONTENT an allocation serves, which never exceed the budget. */
export function servedCharactersOf(allocations: readonly Allocation[]): number {
  return allocations.reduce((total, allocation) => total + allocation.served, 0);
}

/** True where the number of unclosed code fences in a text is odd (B-2051). */
export function hasAnUnbalancedCodeFence(text: string): boolean {
  return linesOf(text).filter((line) => line.trimStart().startsWith(CODE_FENCE)).length % 2 === 1;
}

/**
 * F104-FR-016, B-2051, B-2011 — the content of one document cut to its share.
 * The cut falls on a LINE END; a single over-long line is cut hard. An
 * unbalanced code fence is closed, and the result ends with the marker.
 */
export function truncate(content: string, limit: number): string {
  if (content.length <= limit) return content;
  const head = content.slice(0, limit);
  const lastLineEnd = head.lastIndexOf("\n");
  // A single over-long line has no line end to cut at: it is cut hard.
  const body = lastLineEnd > 0 ? head.slice(0, lastLineEnd) : head;
  const closed = hasAnUnbalancedCodeFence(body) ? `${body}\n${CODE_FENCE}` : body;
  return `${closed}\n${TRUNCATION_MARKER}`;
}

/** One rendered block: its heading, a blank line and its content. */
export function renderBlock(document: LoadedDocument, served: number): string {
  const content = truncate(document.content, served);
  return `${blockHeading(document.name, document.path)}\n${content}`;
}

/**
 * F104-FR-016 — the budgeted block: the documents in their order, under the
 * budget, each as a block of B-2012, joined by a blank line. `spec
 * render-context` prints it with NO added newline.
 */
export function renderContext(
  documents: readonly LoadedDocument[],
  budget: number = DEFAULT_BUDGET,
): string {
  const allocations = allocate(documents, budget);
  const blocks: string[] = [];
  documents.forEach((document, index) => {
    const allocation = allocations[index] as Allocation;
    if (allocation.dropped) return;
    blocks.push(renderBlock(document, allocation.served));
  });
  return blocks.join(BLOCK_SEPARATOR);
}

/** `spec render-context` adds NO newline of its own (F104-FR-016, B-1981). */
export const RENDER_CONTEXT_ADDS_A_NEWLINE = false as const;

/** The documents of a spec, loaded from disk, ready for `renderContext`. */
export function loadContextDocuments(input: ContextInput): readonly LoadedDocument[] {
  return Object.freeze(
    contextDocumentsOf(input).map((document) =>
      Object.freeze({
        name: document.name,
        path: document.path,
        content: readFileSync(resolve(input.root, document.path), "utf8"),
      }),
    ),
  );
}

/** The size of a context document on disk, in characters of its UTF-8 text. */
export function sizeOf(root: string, document: ContextDocument): number {
  return statSync(resolve(root, document.path)).size;
}
