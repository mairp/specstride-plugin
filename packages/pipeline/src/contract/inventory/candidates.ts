/**
 * T018 — the candidates of the inventory (F107-FR-004; C-210).
 *
 * Three kinds of candidate, each `candidate-only` and deterministic:
 *
 * - the shell candidates of the plan (and of the quickstart), read with the
 *   baseline's reading of fences, its accident included: outside a block, a
 *   line that starts at the first column with three backticks followed by
 *   nothing, `bash`, `sh`, `shell` or `console` (any case) opens a block; a
 *   line that starts with three backticks followed by anything else opens
 *   NOTHING; inside a block, a line that is three backticks once trimmed
 *   closes it, and an unterminated block at the end of the file is not
 *   recorded; a block whose body is empty after trimming is not recorded; the
 *   recorded text is the body with the leading and trailing white space
 *   removed, with the first body line as `start_line` and the line before the
 *   closing fence as `end_line`. The accident: the closing fence of a block of
 *   another kind opens a plain block, so the text between two fences of
 *   another kind is recorded — on the fixture
 *   `FX-32/107-plan-with-other-fence` the shell candidate is the heading and
 *   the text between the accidental opening fence and the bash fence;
 * - the prerequisite candidates: in every Markdown source, a backticked token
 *   on a line that carries an explicit `PRE-<digits>` id, or under a heading
 *   of any level that matches `prerequisite` in any case (the section ends at
 *   the next line that starts with `#`), which looks like a path (it holds `/`
 *   or `.` and no white space). The record holds the id, the path as written
 *   (also under `resolved`), whether the file is present beside the
 *   repository root, and the provenance (path, line, anchor = the id);
 * - the verification document, when the feature holds one: a record with
 *   `valid_json` and either the error or the feature, the phase map and the
 *   commands of the document.
 *
 * The obligation id: `OBL-` + the first twelve hexadecimal characters, upper
 * case, of the CONTENT HASH of the text
 * `<source>:<line>:<task id>:<task text>` — the hash itself comes from the
 * canonical hasher of the kernel (F107-FR-004, F104-FR-021).
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { obligationId } from "@specstride/kernel";

import { hashContent } from "../kernel.ts";
import type { SourceRecord } from "./sources.ts";

/** The classification every candidate carries. */
export const CANDIDATE_CLASSIFICATION = "candidate-only" as const;

/** The fence families that OPEN a shell block (the baseline's reading). */
export const SHELL_FENCE_LANGUAGES = Object.freeze(["bash", "sh", "shell", "console"] as const);

/** One shell candidate, with the baseline member names. */
export type ShellCandidate = {
  readonly path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly text: string;
  readonly classification: typeof CANDIDATE_CLASSIFICATION;
};

/** True when a line opens a shell block: ``` alone or a shell language. */
export function opensAShellBlock(line: string): boolean {
  if (!line.startsWith("```")) return false;
  const language = line.slice(3).trim().toLowerCase();
  return language === "" || (SHELL_FENCE_LANGUAGES as readonly string[]).includes(language);
}

/** True when a line closes any block: three backticks once trimmed. */
export function closesABlock(line: string): boolean {
  return line.trim() === "```";
}

/** The shell candidates of one Markdown text (the baseline's reading of fences). */
export function shellCandidatesOfText(input: {
  readonly path: string;
  readonly text: string;
}): readonly ShellCandidate[] {
  const lines = input.text.split("\n");
  const candidates: ShellCandidate[] = [];
  let start = -1;
  const body: string[] = [];
  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    if (start === -1) {
      if (opensAShellBlock(line)) {
        start = number + 1;
        body.length = 0;
      }
      // A fence of another kind opens nothing: the accident stands.
      continue;
    }
    if (closesABlock(line)) {
      const text = body.join("\n").trim();
      if (text !== "") {
        candidates.push({
          path: input.path,
          start_line: start,
          end_line: number - 1,
          text,
          classification: CANDIDATE_CLASSIFICATION,
        });
      }
      start = -1;
      body.length = 0;
      continue;
    }
    body.push(line);
  }
  // A block unterminated at the end of the file is not recorded.
  return candidates;
}

/** The shell candidates of the Markdown sources, in source and file order. */
export function shellCandidates(input: {
  readonly root: string;
  readonly sources: readonly SourceRecord[];
}): readonly ShellCandidate[] {
  const candidates: ShellCandidate[] = [];
  for (const source of input.sources) {
    if (!(
      source.path.endsWith(".md") &&
      (source.kind === "plan" || source.kind === "quickstart")
    )) {
      continue;
    }
    let text: string;
    try {
      text = readFileSyncUtf8(join(input.root, source.path));
    } catch {
      continue;
    }
    candidates.push(...shellCandidatesOfText({ path: source.path, text }));
  }
  return candidates;
}

function readFileSyncUtf8(repositoryPath: string): string {
  // The source exists (the inventory read it); the command turns a read error
  // of the second read into exit 2 (F107-FR-006).
  return readFileSync(repositoryPath, "utf8");
}

/** One prerequisite candidate, with the baseline member names. */
export type PrerequisiteCandidate = {
  readonly id: string;
  readonly path: string;
  readonly present: boolean;
  readonly resolved: string;
  readonly source: { readonly path: string; readonly line: number; readonly anchor: string };
};

const PREREQUISITE_ID = /\bPRE-\d+\b/;
const PREREQUISITE_HEADING = /^#{1,6}[ \t]*.*prerequisite/i;
const TOKEN = /`([^`\s]+)`/g;

function looksLikeAPath(token: string): boolean {
  return !token.includes(" ") && (token.includes("/") || token.includes("."));
}

/** The prerequisite candidates of one Markdown source, in line order. */
export function prerequisiteCandidatesOfText(input: {
  readonly root: string;
  readonly path: string;
  readonly text: string;
}): readonly PrerequisiteCandidate[] {
  const lines = input.text.split("\n");
  const candidates: PrerequisiteCandidate[] = [];
  let inASection = false;
  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    if (/^#{1,6}[ \t]/.test(line)) {
      inASection = PREREQUISITE_HEADING.test(line);
      continue;
    }
    const explicitId = PREREQUISITE_ID.exec(line)?.[0];
    if (explicitId === undefined && !inASection) continue;
    for (const match of line.matchAll(TOKEN)) {
      const token = match[1] as string;
      if (!looksLikeAPath(token)) continue;
      const absolute = isAbsolute(token) ? token : join(input.root, token);
      candidates.push({
        id: explicitId ?? `PRE-${candidates.length + 1}`,
        path: token,
        present: existsSync(absolute),
        resolved: token,
        source: { path: input.path, line: number, anchor: explicitId ?? token },
      });
    }
  }
  return candidates;
}

/** The prerequisite candidates of every Markdown source, in source and line order. */
export function prerequisiteCandidates(input: {
  readonly root: string;
  readonly sources: readonly SourceRecord[];
}): readonly PrerequisiteCandidate[] {
  const candidates: PrerequisiteCandidate[] = [];
  for (const source of input.sources) {
    if (!source.path.endsWith(".md")) continue;
    let text: string;
    try {
      text = readFileSyncUtf8(join(input.root, source.path));
    } catch {
      continue;
    }
    candidates.push(...prerequisiteCandidatesOfText({ root: input.root, path: source.path, text }));
  }
  return candidates;
}

/** The verification document of one feature, as the inventory records it. */
export type VerificationDocumentRecord =
  | {
      readonly path: string;
      readonly valid_json: true;
      readonly feature: string;
      readonly phases: Readonly<Record<string, readonly string[]>>;
      readonly commands: readonly Record<string, unknown>[];
    }
  | { readonly path: string; readonly valid_json: false; readonly error: string };

/**
 * F107-FR-004 — the verification-commands document of a feature, when it
 * holds one: `valid_json` with the feature, the phase map and the commands,
 * or `valid_json: false` with the error.
 */
export function verificationDocumentRecord(input: {
  readonly root: string;
  readonly path: string;
}): VerificationDocumentRecord | undefined {
  if (!existsSync(input.path)) return undefined;
  let text: string;
  try {
    text = readFileSyncUtf8(input.path);
  } catch (cause) {
    return { path: input.path, valid_json: false, error: String(cause) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    return { path: input.path, valid_json: false, error: String(cause) };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { path: input.path, valid_json: false, error: "the document is not a record" };
  }
  const record = parsed as Record<string, unknown>;
  const phases: Record<string, readonly string[]> = {};
  for (const [key, value] of Object.entries(record.phases ?? {})) {
    if (Array.isArray(value)) phases[key] = value.map(String);
  }
  const commands = Array.isArray(record.commands)
    ? (record.commands as Record<string, unknown>[])
    : [];
  return {
    path: input.path,
    valid_json: true,
    feature: typeof record.feature === "string" ? record.feature : "",
    phases,
    commands,
  };
}

/**
 * F107-FR-004 — the obligation id over the content hash of a text:
 * `OBL-` + the first twelve hexadecimal characters, upper case, of the
 * content hash of `<source>:<line>:<task id>:<task text>`. The hash itself is
 * the canonical hasher's (`obligationId` of the hasher returns it whole).
 */
export function obligationIdOf(input: {
  readonly source: string;
  readonly line: number;
  readonly taskId: string;
  readonly text: string;
}): string {
  return `OBL-${obligationId(`${input.source}:${input.line}:${input.taskId}:${input.text}`)
    .slice(0, 12)
    .toUpperCase()}`;
}

/** The content hash the ids stand on, re-exported for the tests. */
export const obligationHashOf = hashContent;
