/**
 * The evidence grammar, the claim blocks and citation resolution of the
 * reverse lint (F140-FR-008, F140-FR-009, F140-FR-010).
 *
 * A port of `EvidenceContext`, `parse_evidence`, `check_evidence`,
 * `_check_citations`, `claim_blocks`, `lint_claims` and `section_lookup` of
 * the Specstride baseline (`lib/reverse.py` at `9cab15d`), with the
 * baseline's message bytes — `%r` of a Python string included, which is why
 * `pythonRepr` is here and not a plain pair of quotes.
 *
 * A citation resolves against the SOURCE, through the inventory when the lint
 * was given `--baseline` and through the live file system otherwise
 * (F140-FR-010). The lint writes nothing and reads the source read-only.
 */

import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

import { compareCodePoint } from "../inventory/serialize.ts";
import type { Findings } from "./findings.ts";
import { h2Headings, normalizeHeading, splitLines } from "./templates.ts";

/* ------------------------------------------------------------------ *
 * The grammar of the comment (F140-FR-008)
 * ------------------------------------------------------------------ */

/** The evidence comment, as it is found in a line. */
export const EVIDENCE_RE = /<!--\s*evidence:\s*(.*?)\s*-->/g;

/** A citation: `path:START` or `path:START-END`, the path without `\s`, `,` or `|`. */
export const CITATION_RE = /^([^\s,|]+?):(\d+)(?:-(\d+))?$/;

/** The three kinds an as-is evidence comment may carry (F140-FR-008). */
export const KINDS = Object.freeze(["observed", "inferred", "declared"] as const);

/** The three validations (F140-FR-008). */
export const VALIDATIONS = Object.freeze(["verified", "unverified", "disproved"] as const);

/** `0.dd` or `1.00`, the only shapes a confidence may take. */
export const CONFIDENCE_RE = /^(0\.\d\d|1\.00)$/;

/** The four keyed fields, in the order the comment must write them. */
export const EVIDENCE_KEYS = Object.freeze([
  "kind",
  "confidence",
  "contradicts",
  "validation",
] as const);

/** `**FR-<digits>**`, which makes a claim a requirement line. */
export const FR_MENTION = /\*\*FR-(\d+)\*\*/;

/** The bytes of a file the sniff looks at for a NUL (F140-FR-016). */
export const SNIFF_BYTES = 8192;

/**
 * A string as Python's `%r` writes it: single quotes, unless the value holds
 * a single quote and no double quote. The messages of F140-FR-008 are the
 * baseline's bytes, and the baseline formats the offending value with `%r`.
 */
export function pythonRepr(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = quote;
  for (const character of value) {
    if (character === "\\") out += "\\\\";
    else if (character === quote) out += `\\${quote}`;
    else if (character === "\n") out += "\\n";
    else if (character === "\r") out += "\\r";
    else if (character === "\t") out += "\\t";
    else out += character;
  }
  return out + quote;
}

/** The fields of an evidence comment, as far as they could be read. */
export interface EvidenceFields {
  readonly citations: string;
  readonly kind?: string | undefined;
  readonly confidence?: string | undefined;
  readonly contradicts?: string | undefined;
  readonly validation?: string | undefined;
}

/** What `parseEvidence` found: the fields, or null, and the format problems. */
export interface ParsedEvidence {
  readonly fields: EvidenceFields | null;
  readonly problems: readonly string[];
}

/**
 * Parse the inside of an evidence comment (F140-FR-008): five `|`-separated
 * fields, the first the citations and the other four keyed and in order.
 * Fewer or more than five fields is one problem and no fields at all; a
 * misnamed or misplaced field is a problem and leaves that field unread.
 */
export function parseEvidence(body: string): ParsedEvidence {
  const parts = body.split("|").map((part) => part.trim());
  const problems: string[] = [];
  if (parts.length !== 5) {
    return Object.freeze({
      fields: null,
      problems: Object.freeze([
        "evidence comment needs 5 '|'-separated fields " +
          "(citations | kind= | confidence= | contradicts= | validation=)",
      ]),
    });
  }
  const fields: Record<string, string> = { citations: parts[0] as string };
  for (let index = 0; index < EVIDENCE_KEYS.length; index += 1) {
    const part = parts[index + 1] as string;
    const key = EVIDENCE_KEYS[index] as string;
    if (!part.startsWith(`${key}=`)) {
      problems.push(`field '${part}' must be '${key}=…'`);
      continue;
    }
    fields[key] = part.slice(key.length + 1).trim();
  }
  return Object.freeze({
    fields: Object.freeze(fields) as unknown as EvidenceFields,
    problems: Object.freeze(problems),
  });
}

/* ------------------------------------------------------------------ *
 * Citation resolution (F140-FR-010)
 * ------------------------------------------------------------------ */

/** One file entry of an inventory, as far as a citation needs it. */
export interface InventoryFileEntry {
  readonly path: string;
  readonly lines: number;
}

/** One skipped entry of an inventory: its path and why it was skipped. */
export interface InventorySkippedEntry {
  readonly path: string;
  readonly reason: string;
}

/** The part of an inventory document a citation resolves against. */
export interface CitationInventory {
  readonly files: readonly InventoryFileEntry[];
  readonly skipped: readonly InventorySkippedEntry[];
  readonly project: { readonly workspaces: readonly { readonly path: string }[] };
}

/** `(resolved, error)`: exactly one of the two is set. */
export interface Resolution {
  readonly path: string | null;
  readonly error: string | null;
}

/** The directories a workspace scan never enters (F140-FR-018). */
const DENY_DIRECTORIES_FOR_A_SCAN: readonly string[] = Object.freeze([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "target",
  "vendor",
  "testautomation",
  ".specstride",
  ".lisa",
]);

/**
 * `os.path.normpath` for a POSIX path: `.` and `..` collapsed lexically, the
 * separators squeezed, a trailing separator dropped, an empty path `.`. Node's
 * `path.normalize` keeps a trailing slash and is therefore not the same.
 */
export function normalizePathLexically(raw: string): string {
  const absolute = raw.startsWith("/");
  const out: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      const last = out[out.length - 1];
      if (out.length > 0 && last !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(part);
  }
  const joined = out.join("/");
  if (absolute) return `/${joined}`;
  return joined === "" ? "." : joined;
}

/** Resolves citations against the source, with the inventory's rules. */
export class EvidenceContext {
  readonly src: string;
  /** Line counts by path, or null when the live file system is the oracle. */
  readonly #lines: ReadonlyMap<string, number> | null;
  /** Why a path was skipped, by path; empty without an inventory. */
  readonly skipped: ReadonlyMap<string, string>;
  /** The workspace packages, source-relative. */
  readonly workspaces: readonly string[];
  /** The roots a citation may not point into: the output dir and the state. */
  readonly excluded: readonly string[];

  constructor(src: string, inventory: CitationInventory | null, excludedRoots: readonly string[]) {
    this.src = realpathSync(src);
    this.excluded = Object.freeze(excludedRoots.filter((root) => root !== ""));
    if (inventory !== null) {
      this.#lines = new Map(inventory.files.map((file) => [file.path, file.lines]));
      this.skipped = new Map(inventory.skipped.map((entry) => [entry.path, entry.reason]));
      this.workspaces = Object.freeze(inventory.project.workspaces.map((unit) => unit.path));
    } else {
      this.#lines = null;
      this.skipped = new Map();
      this.workspaces = this.#scanWorkspaces();
    }
  }

  /** Without an inventory the workspaces are the non-root `package.json` dirs. */
  #scanWorkspaces(): readonly string[] {
    const found: string[] = [];
    const walk = (prefix: string): void => {
      let entries;
      try {
        entries = readdirSync(prefix === "" ? this.src : join(this.src, prefix), {
          withFileTypes: true,
        });
      } catch {
        return;
      }
      const names = entries.map((entry) => entry.name);
      if (names.includes("package.json") && prefix !== "") found.push(prefix);
      const directories = entries
        .filter((entry) => entry.isDirectory() && !DENY_DIRECTORIES_FOR_A_SCAN.includes(entry.name))
        .map((entry) => entry.name)
        .sort(compareCodePoint);
      for (const name of directories) walk(prefix === "" ? name : `${prefix}/${name}`);
    };
    walk("");
    return Object.freeze(found);
  }

  /** Does the source hold this path, by the inventory or by the file system? */
  exists(rel: string): boolean {
    if (this.#lines !== null) return this.#lines.has(rel) || this.skipped.has(rel);
    try {
      return statSync(join(this.src, rel)).isFile();
    } catch {
      return false;
    }
  }

  /**
   * The line count of a path, or null when it is not a text file the
   * inventory counted: an entry the inventory skipped, a file with a NUL in
   * its sniff window, or a file that cannot be read.
   */
  lineCount(rel: string): number | null {
    if (this.#lines !== null) return this.#lines.get(rel) ?? null;
    let data: Buffer;
    try {
      data = readFileSync(join(this.src, rel));
    } catch {
      return null;
    }
    if (data.subarray(0, SNIFF_BYTES).includes(0)) return null;
    let newlines = 0;
    for (const byte of data) if (byte === 0x0a) newlines += 1;
    return newlines + (data.length > 0 && data[data.length - 1] !== 0x0a ? 1 : 0);
  }

  /**
   * Resolve the path of a citation (F140-FR-010): `./` normalized, an
   * absolute path and a `..` escape refused, a path under the output
   * directory or the workspace part refused as a generated artifact, then the
   * path source-relative and, for a monorepo, workspace-relative.
   */
  resolve(raw: string): Resolution {
    if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) {
      return Object.freeze({ path: null, error: "absolute path (cite it SRC-relative)" });
    }
    const norm = normalizePathLexically(raw);
    if (norm === ".." || norm.startsWith("../")) {
      return Object.freeze({ path: null, error: "path escapes the source tree" });
    }
    for (const root of this.excluded) {
      if (norm === root || norm.startsWith(`${root}/`)) {
        return Object.freeze({
          path: null,
          error: `cites a generated artifact under ${root}/, not the source`,
        });
      }
    }
    if (this.exists(norm)) return Object.freeze({ path: norm, error: null });
    const hits = this.workspaces
      .map((unit) => `${unit}/${norm}`)
      .filter((candidate) => this.exists(candidate));
    if (hits.length === 1) return Object.freeze({ path: hits[0] as string, error: null });
    if (hits.length > 1) {
      return Object.freeze({
        path: null,
        error: `ambiguous across workspace packages: ${[...hits].sort(compareCodePoint).join(", ")}`,
      });
    }
    return Object.freeze({ path: null, error: "no such file in the source" });
  }
}

/* ------------------------------------------------------------------ *
 * The checks (F140-FR-008, F140-FR-010)
 * ------------------------------------------------------------------ */

/** What one citation field holds, checked citation by citation. */
export function checkCitations(
  findings: Findings,
  rel: string,
  number: number | null,
  text: string,
  ectx: EvidenceContext,
  code: "evidence.citation" | "evidence.contradicts",
): void {
  const citations = text.trim() === "" ? [] : text.split(", ").map((citation) => citation.trim());
  if (citations.length === 0) {
    findings.error(code, rel, number, "no citation");
    return;
  }
  for (const citation of citations) {
    const match = CITATION_RE.exec(citation);
    if (match === null) {
      findings.error(code, rel, number, `citation ${pythonRepr(citation)} is not path:START[-END]`);
      continue;
    }
    const resolved = ectx.resolve(match[1] as string);
    if (resolved.error !== null) {
      findings.error(code, rel, number, `${citation}: ${resolved.error}`);
      continue;
    }
    const path = resolved.path as string;
    const start = Number.parseInt(match[2] as string, 10);
    const end = match[3] === undefined ? start : Number.parseInt(match[3], 10);
    const count = ectx.lineCount(path);
    if (count === null) {
      const reason = ectx.skipped.get(path) ?? "not a text file";
      findings.error(
        code,
        rel,
        number,
        `${citation}: ${path} is not a text file the inventory counted (${reason})`,
      );
      continue;
    }
    if (start < 1 || end < start || end > count) {
      findings.error(code, rel, number, `${citation}: line range outside ${path} (1-${count})`);
    }
  }
}

/** What an evidence comment that parsed carries, for the placement rule. */
export interface EvidenceResult {
  readonly confidence: number | null;
  readonly validation: string | undefined;
}

/**
 * One evidence comment, checked whole (F140-FR-008): the five fields, the
 * three closed sets, the confidence shape, the citations and `contradicts=`.
 * `claimIsFr` turns a `disproved` validation into `evidence.disproved`.
 */
export function checkEvidence(
  findings: Findings,
  rel: string,
  number: number | null,
  body: string,
  ectx: EvidenceContext,
  claimIsFr = false,
): EvidenceResult | null {
  const { fields, problems } = parseEvidence(body);
  for (const problem of problems) findings.error("evidence.format", rel, number, problem);
  if (fields === null) return null;
  const kind = fields.kind;
  if (kind === "desired") {
    findings.error("evidence.kind", rel, number, "kind=desired is forbidden in as-is artifacts");
  } else if (kind !== undefined && !(KINDS as readonly string[]).includes(kind)) {
    findings.error(
      "evidence.kind",
      rel,
      number,
      `kind must be observed, inferred or declared (got ${pythonRepr(kind)})`,
    );
  }
  const raw = fields.confidence;
  let confidence: number | null = null;
  if (raw !== undefined) {
    if (!CONFIDENCE_RE.test(raw)) {
      findings.error(
        "evidence.confidence",
        rel,
        number,
        `confidence must be in [0,1] with two decimals (got ${pythonRepr(raw)})`,
      );
    } else {
      confidence = Number.parseFloat(raw);
    }
  }
  const validation = fields.validation;
  if (validation !== undefined && !(VALIDATIONS as readonly string[]).includes(validation)) {
    findings.error(
      "evidence.validation",
      rel,
      number,
      `validation must be verified, unverified or disproved (got ${pythonRepr(validation)})`,
    );
  }
  if (validation === "disproved" && claimIsFr) {
    findings.error(
      "evidence.disproved",
      rel,
      number,
      "a disproved requirement must be removed, not kept",
    );
  }
  checkCitations(findings, rel, number, fields.citations, ectx, "evidence.citation");
  const contradicts = fields.contradicts;
  if (contradicts !== undefined && contradicts !== "none") {
    checkCitations(findings, rel, number, contradicts, ectx, "evidence.contradicts");
  }
  return Object.freeze({ confidence, validation });
}

/* ------------------------------------------------------------------ *
 * Claim blocks (F140-FR-009)
 * ------------------------------------------------------------------ */

/** Does a line start a claim? The caller's rule, by index and by text. */
export type IsClaim = (index: number, line: string) => boolean;

/** One claim and the line that must carry its evidence comment. */
export interface ClaimBlock {
  /** The 1-based line of the claim. */
  readonly claimLine: number;
  /** The 1-based line right after the claim's block. */
  readonly nextLine: number;
  /** The text of that line, `""` past the end of the file. */
  readonly nextText: string;
}

/** A line that ends a claim block (F140-FR-009). */
const ENDS_A_BLOCK = ["<!--", "#", "- ", "* ", "|", "```"] as const;
const ORDERED_ITEM_RE = /^\d+\.\s/;

/**
 * The claim blocks of a text (F140-FR-009): a claim's block extends over its
 * wrapped continuation lines and ends at a blank line, at a line starting
 * with `<!--`, `#`, `- `, `* `, `|`, a code fence or `<n>. `, or at the next
 * claim; the evidence comment is the line right after the block.
 */
export function claimBlocks(lines: readonly string[], isClaim: IsClaim): readonly ClaimBlock[] {
  const out: ClaimBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!isClaim(index, lines[index] as string)) {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    while (index < lines.length) {
      const next = lines[index] as string;
      const stripped = next.trim();
      if (
        stripped === "" ||
        ENDS_A_BLOCK.some((mark) => stripped.startsWith(mark)) ||
        ORDERED_ITEM_RE.test(stripped) ||
        isClaim(index, next)
      ) {
        break;
      }
      index += 1;
    }
    out.push(
      Object.freeze({
        claimLine: start + 1,
        nextLine: index + 1,
        nextText: index < lines.length ? (lines[index] as string) : "",
      }),
    );
  }
  return Object.freeze(out);
}

/** Line number -> the normalized name of the enclosing `##` section. */
export function sectionLookup(text: string): (line: number) => string | null {
  const marks = h2Headings(text).map((heading) =>
    Object.freeze({ line: heading.line, name: normalizeHeading(heading.text) }),
  );
  return (number: number): string | null => {
    let current: string | null = null;
    for (const mark of marks) if (mark.line <= number) current = mark.name;
    return current;
  };
}

/**
 * Every claim of an artifact needs an evidence comment on the line after it
 * (F140-FR-009); then EVERY evidence comment of the file is validated,
 * attached to a claim or not (F140-FR-008). Without `--src` — `ectx` null —
 * only the presence of the comments is checked.
 */
export function lintClaims(
  findings: Findings,
  rel: string,
  text: string,
  isClaim: IsClaim,
  ectx: EvidenceContext | null,
  what: string,
  options: {
    readonly fr?: boolean;
    readonly specSections?: ((line: number) => string | null) | undefined;
  } = {},
): void {
  const lines = splitLines(text);
  const attached = new Map<number, number>();
  for (const block of claimBlocks(lines, isClaim)) {
    const hasComment = new RegExp(EVIDENCE_RE.source).test(block.nextText);
    if (!hasComment || !block.nextText.trim().startsWith("<!--")) {
      findings.error(
        "evidence.missing",
        rel,
        block.claimLine,
        `${what} has no evidence comment on the line after it`,
      );
      continue;
    }
    attached.set(block.nextLine, block.claimLine);
  }
  if (ectx === null) return;
  const fr = options.fr ?? false;
  const specSections = options.specSections;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const number = index + 1;
    for (const match of line.matchAll(new RegExp(EVIDENCE_RE.source, "g"))) {
      const claimLine = attached.get(number);
      const claim = claimLine === undefined ? "" : (lines[claimLine - 1] as string);
      const result = checkEvidence(
        findings,
        rel,
        number,
        match[1] as string,
        ectx,
        fr && FR_MENTION.test(claim),
      );
      if (
        claimLine !== undefined &&
        result !== null &&
        specSections !== undefined &&
        result.validation === "unverified" &&
        result.confidence !== null &&
        result.confidence < 0.5
      ) {
        const section = specSections(claimLine);
        if (section !== "assumptions") {
          findings.warn(
            "unknowns.placement",
            rel,
            claimLine,
            "unverified claim below 0.50 confidence belongs under Assumptions, not among the " +
              `${section === null || section === "" ? "requirements" : section}`,
          );
        }
      }
    }
  }
}
