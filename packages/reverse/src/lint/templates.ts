/**
 * The template, placeholder and structure rules of the reverse lint
 * (F140-FR-005, F140-FR-006, F140-FR-007).
 *
 * A port of `template_rules`, `lint_template`, `template_comments`,
 * `lint_placeholders` and `lint_structure` of the Specstride baseline
 * (`lib/reverse.py` at `9cab15d`), with the baseline's message bytes. The
 * required headings are NEVER listed here: they are read off the template at
 * run time, which is the whole point of F140-FR-005 ("required headings are
 * never listed in the code").
 *
 * The layout and the ownership table are the lint frame's (`lint.ts`,
 * F140-FR-004) and reach `lintStructure` as an argument, so this module
 * states no level of its own and the frame stays the single place the levels
 * are written.
 */

import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { compareCodePoint } from "../inventory/serialize.ts";
import type { Findings } from "./findings.ts";

/* ------------------------------------------------------------------ *
 * Text helpers shared by every rule of the lint
 * ------------------------------------------------------------------ */

/**
 * The body of a markdown file with its YAML front matter removed, as the
 * baseline's `strip_front_matter` removes it: only a file that STARTS with
 * `---\n` has front matter, and it ends at the first `\n---` after it.
 */
export function stripFrontMatter(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return text;
  const lineEnd = text.indexOf("\n", end + 4);
  return lineEnd === -1 ? "" : text.slice(lineEnd + 1);
}

/** `*(...)*`, the annotation a heading may carry (`*(mandatory)*` and kin). */
const ANNOTATION_RE = /\*\([^)]*\)\*/g;

/**
 * Everything that is neither a word character, whitespace nor one of the
 * punctuation marks a heading may carry — emoji and ornaments — which the
 * baseline replaces by a space. Python's `\w` is Unicode-aware for `str`, so
 * the class is written with `\p{L}\p{N}_` and the `u` flag and not with the
 * ASCII-only `\w` of JavaScript.
 */
const ORNAMENT_RE = /[^\p{L}\p{N}_\s&:.,()[\]/`'"-]+/gu;

/**
 * A heading, normalized for comparison (F140-FR-005): annotations removed,
 * emoji and ornaments replaced by spaces, whitespace collapsed, trimmed,
 * lower-cased.
 */
export function normalizeHeading(text: string): string {
  return text
    .replace(ANNOTATION_RE, "")
    .replace(ORNAMENT_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** One `## ` heading of an artifact or a template: its line and its text. */
export interface Heading {
  readonly line: number;
  readonly text: string;
}

/**
 * Every `## ` heading outside a fenced code block, with its 1-based line
 * number. A fence line toggles the fence and is itself never a heading.
 */
export function h2Headings(text: string): readonly Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && line.startsWith("## ")) {
      out.push(Object.freeze({ line: index + 1, text: line.slice(3).trim() }));
    }
  }
  return Object.freeze(out);
}

/**
 * The lines of a text as Python's `str.splitlines()` gives them: no trailing
 * empty element for a final line end, and an empty text has no line.
 */
export function splitLines(text: string): readonly string[] {
  if (text === "") return Object.freeze([]);
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return Object.freeze(body.split("\n"));
}

/** A literal for a regular expression. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every `<!-- ... -->` comment body of a text, as `re.findall` with DOTALL. */
export function htmlComments(text: string): readonly string[] {
  const out: string[] = [];
  const pattern = /<!--([\s\S]*?)-->/g;
  for (const match of text.matchAll(pattern)) out.push(match[1] as string);
  return Object.freeze(out);
}

/* ------------------------------------------------------------------ *
 * F140-FR-005 — the rules a template states
 * ------------------------------------------------------------------ */

/** What a template heading demands of an artifact. */
export type TemplateRuleKind = "required" | "family" | "phases" | "expected";

/** One rule read off a template heading. */
export interface TemplateRule {
  readonly kind: TemplateRuleKind;
  /** The heading as the template writes it, for the message. */
  readonly display: string;
  /** Does a NORMALIZED artifact heading satisfy this rule? */
  readonly matches: (heading: string) => boolean;
}

const OPTIONAL_MARKS_RE =
  /\*\(\s*optional\s*\)\*|\*\(\s*include if[^)]*\)\*|\bOPTIONAL\b|\[REMOVE IF UNUSED\]/i;
const MANDATORY_MARK_RE = /\*\(\s*mandatory\s*\)\*/i;
const BRACKET_RE = /\[[^\]]+\]/;
const BRACKET_SPLIT_RE = /\[[^\]]+\]/g;
const TEMPLATE_PHASE_RE = /^Phase\s+(\d+|N)\s*:/i;
const SAMPLE_STORY_RE = /\bUser Story \d+\b/g;
/** The phase family: any artifact heading `phase <digits>:` satisfies it. */
const ARTIFACT_PHASE_RE = /^phase \d+\s*:/;

/** A bracket pattern: each `[...]` matches any text, the rest is literal. */
function bracketPattern(normalized: string): RegExp {
  const pieces = normalized.split(BRACKET_SPLIT_RE).map(escapeForRegExp);
  return new RegExp(`^${pieces.join(".+")}$`);
}

/**
 * Classify the `## ` headings of a template into the rules of F140-FR-005:
 * `*(mandatory)*` is required; `*(optional)*`, `*(include if ...)*`,
 * `OPTIONAL` and `[REMOVE IF UNUSED]` give no rule; `Phase <n>:` headings
 * collapse into one phase family; a heading with a `[placeholder]` is a
 * family (identical patterns merged); every other heading is expected. A
 * heading with a sample `User Story <n>` and no bracket matches any story
 * number and only warns.
 */
export function templateRules(templateText: string): readonly TemplateRule[] {
  const rules: TemplateRule[] = [];
  const seenFamilies = new Set<string>();
  let phaseFamily = false;
  for (const { text: heading } of h2Headings(stripFrontMatter(templateText))) {
    const sample = heading.replace(SAMPLE_STORY_RE, "User Story [N]");
    if (sample !== heading && !BRACKET_RE.test(heading)) {
      const pattern = bracketPattern(normalizeHeading(sample));
      rules.push(
        Object.freeze({
          kind: "expected" as const,
          display: heading,
          matches: (h: string) => pattern.test(h),
        }),
      );
      continue;
    }
    if (MANDATORY_MARK_RE.test(heading)) {
      const norm = normalizeHeading(heading);
      rules.push(
        Object.freeze({
          kind: "required" as const,
          display: heading,
          matches: (h: string) => h === norm,
        }),
      );
      continue;
    }
    if (OPTIONAL_MARKS_RE.test(heading)) continue;
    if (TEMPLATE_PHASE_RE.test(heading)) {
      phaseFamily = true;
      continue;
    }
    if (BRACKET_RE.test(heading)) {
      const pattern = bracketPattern(normalizeHeading(heading));
      if (seenFamilies.has(pattern.source)) continue;
      seenFamilies.add(pattern.source);
      rules.push(
        Object.freeze({
          kind: "family" as const,
          display: heading,
          matches: (h: string) => pattern.test(h),
        }),
      );
      continue;
    }
    const norm = normalizeHeading(heading);
    rules.push(
      Object.freeze({
        kind: "expected" as const,
        display: heading,
        matches: (h: string) => h === norm,
      }),
    );
  }
  if (phaseFamily) {
    rules.push(
      Object.freeze({
        kind: "phases" as const,
        display: "Phase N:",
        matches: (h: string) => ARTIFACT_PHASE_RE.test(h),
      }),
    );
  }
  return Object.freeze(rules);
}

/**
 * How a template path is printed in a message (F140-FR-005): relative to the
 * root of the product when the template is the shipped one, in full
 * otherwise.
 */
export function templatePathNote(templatePath: string, productRoot: string): string {
  const inside = relative(productRoot, templatePath);
  return inside !== "" && !inside.startsWith("..") ? inside : templatePath;
}

/**
 * The template rule of one artifact (F140-FR-005). A family cannot be
 * satisfied by a heading that an explicit rule — required or expected —
 * already accounts for.
 */
export function lintTemplate(
  findings: Findings,
  rel: string,
  text: string,
  templateText: string,
  templatePath: string,
  productRoot: string,
): void {
  const headings = h2Headings(stripFrontMatter(text)).map((heading) =>
    Object.freeze({ line: heading.line, text: normalizeHeading(heading.text) }),
  );
  const rules = templateRules(templateText);
  const explicit = new Set<number>();
  for (const rule of rules) {
    if (rule.kind !== "required" && rule.kind !== "expected") continue;
    for (const heading of headings) if (rule.matches(heading.text)) explicit.add(heading.line);
  }
  const where = templatePathNote(templatePath, productRoot);
  for (const rule of rules) {
    const pool =
      rule.kind === "family" ? headings.filter((h) => !explicit.has(h.line)) : [...headings];
    if (pool.some((heading) => rule.matches(heading.text))) continue;
    if (rule.kind === "required") {
      findings.error(
        "template.mandatory",
        rel,
        null,
        `missing mandatory section '## ${rule.display}' (from ${where})`,
      );
    } else if (rule.kind === "family") {
      findings.error(
        "template.family",
        rel,
        null,
        `no section matches the template family '## ${rule.display}' (from ${where})`,
      );
    } else if (rule.kind === "phases") {
      findings.error(
        "template.family",
        rel,
        null,
        `no '## Phase <n>:' section (the template's phase family, from ${where})`,
      );
    } else {
      findings.warn(
        "template.expected",
        rel,
        null,
        `expected section '## ${rule.display}' is missing (from ${where})`,
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * F140-FR-006 — the placeholder rule
 * ------------------------------------------------------------------ */

/** The seven fixed placeholder patterns of F140-FR-006, with their labels. */
export const PLACEHOLDERS: readonly { readonly pattern: RegExp; readonly label: string }[] =
  Object.freeze([
    Object.freeze({ pattern: /\[FEATURE NAME\]/, label: "[FEATURE NAME]" }),
    Object.freeze({ pattern: /\[###-feature-name\]/, label: "[###-feature-name]" }),
    Object.freeze({ pattern: /\$ARGUMENTS/, label: "$ARGUMENTS" }),
    Object.freeze({ pattern: /ACTION REQUIRED/, label: "ACTION REQUIRED" }),
    Object.freeze({ pattern: /\[DATE\]/, label: "[DATE]" }),
    Object.freeze({ pattern: /__SPECKIT_COMMAND_[A-Z_]*__/, label: "__SPECKIT_COMMAND_*__" }),
    Object.freeze({ pattern: /\[e\.g\.,[^\]]*\]/, label: "[e.g., …]" }),
  ]);

/** An upper-case bracket token of three or more characters. */
const UPPER_PLACEHOLDER_RE = /\[[A-Z][A-Z0-9_]{2,}\]/g;
/** The one exempt token of F140-FR-006. */
const US_TOKEN_RE = /^\[US\d+\]$/;

/**
 * The template comments a copy of which is a placeholder: every HTML comment
 * of the template longer than 20 characters, with its whitespace normalized.
 */
export function templateComments(templateText: string): readonly string[] {
  return Object.freeze(
    htmlComments(templateText)
      .filter((body) => body.trim().length > 20)
      .map((body) => body.replace(/\s+/g, " ").trim()),
  );
}

/**
 * The placeholder rule (F140-FR-006): the seven fixed patterns per line, the
 * template's own upper-case bracket tokens per line, and a template comment
 * copied verbatim into a comment of the artifact. `templateText` is null for
 * an artifact that has no template, which leaves the fixed patterns only.
 */
export function lintPlaceholders(
  findings: Findings,
  rel: string,
  text: string,
  templateText: string | null,
): void {
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    for (const { pattern, label } of PLACEHOLDERS) {
      if (pattern.test(line)) {
        findings.error(
          "placeholder",
          rel,
          index + 1,
          `template placeholder ${label} left in the artifact`,
        );
      }
    }
  }
  if (templateText === null || templateText === "") return;
  const tokens = new Set(templateText.match(UPPER_PLACEHOLDER_RE) ?? []);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    for (const token of line.match(UPPER_PLACEHOLDER_RE) ?? []) {
      if (tokens.has(token) && !US_TOKEN_RE.test(token)) {
        findings.error(
          "placeholder",
          rel,
          index + 1,
          `template placeholder ${token} left in the artifact`,
        );
      }
    }
  }
  const body = htmlComments(text).join(" ").replace(/\s+/g, " ");
  for (const comment of templateComments(templateText)) {
    if (body.includes(comment)) {
      findings.error(
        "placeholder",
        rel,
        null,
        `template HTML comment copied verbatim: <!-- ${comment.slice(0, 60)}… -->`,
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * F140-FR-007 — the structure rules
 * ------------------------------------------------------------------ */

/**
 * The layout and the ownership the structure rules are measured against. The
 * frame (`lint.ts`) states them once, from F140-FR-004, and hands them here.
 */
export interface FeatureLayout {
  /** The paths of the Spec Kit feature layout, `contracts/*.md` apart. */
  readonly paths: readonly string[];
  /** The one directory that is a pattern of the layout. */
  readonly contractsDirectory: string;
  /** Which artifacts each level owns, by level. */
  readonly ownership: ReadonlyMap<number, readonly string[]>;
}

/** What the structure rules found in the feature directory. */
export interface StructureSurvey {
  /** Every file of the feature directory, relative, `/`-separated. */
  readonly present: ReadonlySet<string>;
  /** The `contracts/<name>.md` files, sorted; a nested file is not one. */
  readonly contracts: readonly string[];
}

/** Every file under a directory, relative and `/`-separated, unsorted. */
function filesUnder(root: string, prefix: string, found: string[]): void {
  let entries;
  try {
    entries = readdirSync(join(root, prefix), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      // `os.walk` with `followlinks=False` neither enters a linked directory
      // nor lists it as a file, so a link to a directory is invisible.
      if (!entry.isSymbolicLink()) filesUnder(root, rel, found);
      continue;
    }
    found.push(rel);
  }
}

const CONTRACT_FILE_RE = /^contracts\/[^/]+\.md$/;

/**
 * The structure rules (F140-FR-007): `structure.extra` for any file outside
 * the layout at every level including 0, `structure.contracts` at level 3 and
 * above, and `structure.required` for each owned artifact that is absent.
 *
 * `constitutionNeeded` is null when the lint runs without `--src`, which
 * neither requires nor forbids a constitution (F140-FR-003); it is false only
 * when the source already has one, and then `memory/constitution.md` in the
 * output is an extra with its suffix.
 */
export function lintStructure(
  findings: Findings,
  featureDir: string,
  level: number,
  constitutionNeeded: boolean | null,
  layout: FeatureLayout,
): StructureSurvey {
  const found: string[] = [];
  filesUnder(featureDir, "", found);
  const present = new Set(found);
  const contracts = found.filter((path) => CONTRACT_FILE_RE.test(path)).sort(compareCodePoint);
  const allowed = new Set<string>([...layout.paths, ...contracts]);
  if (constitutionNeeded === false) allowed.delete("memory/constitution.md");
  for (const rel of [...present].filter((path) => !allowed.has(path)).sort(compareCodePoint)) {
    const suffix =
      rel === "memory/constitution.md"
        ? " (the source already has .specify/memory/constitution.md)"
        : "";
    findings.error(
      "structure.extra",
      rel,
      null,
      `not part of the Spec Kit feature layout${suffix}`,
    );
  }
  for (let owner = 1; owner <= level; owner += 1) {
    for (const rel of layout.ownership.get(owner) ?? []) {
      if (rel === layout.contractsDirectory) {
        if (contracts.length === 0) {
          findings.error(
            "structure.contracts",
            "contracts/",
            null,
            "contracts/ holds no .md contract",
          );
        }
        continue;
      }
      if (rel === "memory/constitution.md" && constitutionNeeded !== true) continue;
      if (!present.has(rel)) {
        findings.error("structure.required", rel, null, `required at --upto ${level} but missing`);
      }
    }
  }
  return Object.freeze({ present, contracts: Object.freeze(contracts) });
}
