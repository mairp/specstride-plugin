/**
 * The tool handling of the JSONL reader (T034; covers F138-FR-029,
 * F138-FR-030 and F138-FR-031).
 *
 * A tool gives a normalized record at its start, at each non-empty progress
 * message and at its end; a call id the stream does not give is generated
 * from the dialect's provider format. Arguments are summarized as the
 * redacted JSON cut to 2,048 bytes; arguments that are neither an object nor
 * a list are summarized as an object with one key `script` holding their
 * text. Quoted path literals in the text of the arguments that contain a
 * `/`, or name the evidence gate file, join the targets, up to 8. Evidence
 * writing is detected lexically, from the words of the arguments alone:
 * nothing a stream carries is ever executed, and the output of a tool is
 * never read back as a stream record.
 */
import { resolve } from "node:path";
import type { DialectRow } from "./dialect.ts";
import {
  READER_CAPS,
  TARGET_MAX_BYTES,
  cutToByteCap,
  sanitizeText,
  sanitizeValue,
  type ReaderRedactor,
  type Sanitized,
} from "./display.ts";

/** Quoted literals that contain a `/`, or name the gate evidence file. */
const PATH_LITERAL = /['"]([^'"\r\n]+(?:\/[^'"\r\n]+|GATE\d+-EVIDENCE\.md))['"]/g;

/** A path object written by its write-text, write-bytes or open call. */
const DIRECT_PATH_WRITE =
  /Path\s*\(\s*['"]([^'"\r\n]+)['"]\s*\)\s*\.\s*(?:write_text|write_bytes|open)\s*\(/gi;

/** An open call with a write, append, exclusive or update mode. */
const OPEN_WRITE = /open\s*\(\s*['"]([^'"\r\n]+)['"]\s*,\s*['"][wax+]/gi;

/** A variable assigned from a path object, and later written. */
const PATH_ASSIGNMENT = /\b([A-Za-z_]\w*)\s*=\s*Path\s*\(\s*['"]([^'"\r\n]+)['"]\s*\)/gi;

/** A path-shaped token, matched whole: the baseline's acceptance rule. */
const PATH_TOKEN = /^(?:^|\/)(?:\.?[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_-]+)?$/;

/** The keys whose value names a target; the baseline's two tables. */
const TARGET_KEYS = new Set([
  "file",
  "file_path",
  "filename",
  "notebook_path",
  "path",
  "paths",
  "target",
  "targets",
  "destination",
  "source",
]);

/** The keys whose value is a command, whose words are tokenized. */
const COMMAND_KEYS = new Set(["command", "cmd", "script"]);

/** The keys a recursive target walk never descends into a string of. */
const MAX_TARGET_PATHS = READER_CAPS.targets;

/** Split one command word-wise, as a POSIX shell would, quotes removed. */
export function shlexSplit(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let index = 0;
  while (index < command.length) {
    const char = command[index];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      if (hasToken) tokens.push(current);
      current = "";
      hasToken = false;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      index += 1;
      hasToken = true;
      while (index < command.length && command[index] !== quote) {
        if (quote === '"' && command[index] === "\\" && index + 1 < command.length) {
          const next = command[index + 1];
          if (next === '"' || next === "\\" || next === "$" || next === "`") {
            current += next;
            index += 2;
            continue;
          }
        }
        current += command[index];
        index += 1;
      }
      index += 1; // the closing quote, or the end of the text
      continue;
    }
    current += char;
    hasToken = true;
    index += 1;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

/** Strip the punctuation shells leave on a token, as the baseline does. */
function stripTokenEdges(candidate: string): string {
  return candidate.replace(/^['"()[\]{}:,;]+/, "").replace(/['"()[\]{}:,;]+$/, "");
}

/** Every path-looking string the value states, lexically, in order. */
export function extractTargetPaths(value: unknown): string[] {
  const candidates: string[] = [];
  const commands: string[] = [];
  const visit = (item: unknown, key: string): void => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      for (const [childKey, child] of Object.entries(item as Record<string, unknown>)) {
        visit(child, childKey);
      }
    } else if (Array.isArray(item)) {
      for (const child of item) visit(child, key);
    } else if (typeof item === "string") {
      if (TARGET_KEYS.has(key.toLowerCase())) candidates.push(item);
      else if (COMMAND_KEYS.has(key.toLowerCase())) commands.push(item);
    }
  };
  visit(value, "");
  for (const command of commands) {
    candidates.push(...shlexSplit(command));
  }
  const targets: string[] = [];
  for (const raw of candidates) {
    const candidate = stripTokenEdges(raw.trim());
    if (
      !candidate ||
      candidate.startsWith("-") ||
      candidate.startsWith("http://") ||
      candidate.startsWith("https://") ||
      ["|", "||", "&&", ">", ">>", "<"].includes(candidate) ||
      !PATH_TOKEN.test(candidate)
    ) {
      continue;
    }
    const bounded = cutToByteCap(candidate, TARGET_MAX_BYTES).text;
    if (!targets.includes(bounded)) targets.push(bounded);
    if (targets.length >= MAX_TARGET_PATHS) return targets;
  }
  return targets;
}

/** The summary of one tool call: redacted JSON, targets, and the metadata. */
export type ArgumentSummary = {
  targets: string[];
  summary: string;
  redacted: boolean;
  truncated: boolean;
  original_bytes: number;
  retained_bytes: number;
};

/** Summarize one tool call's arguments, as the baseline summarizes them. */
export function summarizeArguments(
  args: unknown,
  redactor: ReaderRedactor | null,
): ArgumentSummary {
  const value = args !== null && typeof args === "object" ? args : { script: String(args ?? "") };
  const cleaned: Sanitized = sanitizeValue(value, Number.MAX_SAFE_INTEGER, redactor);
  const summary = sanitizeText(cleaned.value, READER_CAPS.toolSummary, redactor);
  const targets = extractTargetPaths(value);
  const text = String(args ?? "");
  for (const match of text.matchAll(PATH_LITERAL)) {
    for (const candidate of extractTargetPaths({ path: match[1] })) {
      if (!targets.includes(candidate) && targets.length < MAX_TARGET_PATHS) {
        targets.push(candidate);
      }
    }
  }
  return {
    targets,
    summary: summary.value,
    redacted: cleaned.redacted || summary.redacted,
    truncated: summary.truncated,
    original_bytes: cleaned.originalBytes,
    retained_bytes: summary.retainedBytes,
  };
}

/** Resolve one candidate path against the working directory of the session. */
export function resolveAgainstCwd(path: string, cwd: string | null): string {
  const expanded = path.startsWith("~/") || path === "~" ? path.slice(2) : path;
  return resolve(cwd ?? process.cwd(), expanded);
}

/**
 * The lexical evidence detection (F138-FR-030): a path object written by its
 * write-text, write-bytes or open call; an open call with a write, append,
 * exclusive or update mode; or a variable assigned from a path object and
 * later written. True only where the resolved path equals the expected
 * evidence path.
 */
export function isEvidenceWrite(
  args: unknown,
  expectedEvidence: string | null,
  cwd: string | null,
): boolean {
  if (expectedEvidence === null) return false;
  // The words of the arguments, and nothing else: strings are read as they
  // are, any other value contributes only its strings, so the detection
  // never depends on a serialization escaping newlines or quotes.
  const collect = (value: unknown, into: string[]): void => {
    if (typeof value === "string") into.push(value);
    else if (Array.isArray(value)) value.forEach((item) => collect(item, into));
    else if (value !== null && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) collect(item, into);
    }
  };
  const parts: string[] = [];
  collect(args, parts);
  const text = parts.join("\n");
  const writeTargets: string[] = [];
  for (const match of text.matchAll(DIRECT_PATH_WRITE)) writeTargets.push(match[1]);
  for (const match of text.matchAll(OPEN_WRITE)) writeTargets.push(match[1]);
  for (const match of text.matchAll(PATH_ASSIGNMENT)) {
    const variable = match[1];
    const written = new RegExp(
      `\\b${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\.\\s*(?:write_text|write_bytes|open)\\s*\\(`,
      "i",
    );
    if (written.test(text)) writeTargets.push(match[2]);
  }
  for (const target of writeTargets) {
    try {
      if (resolveAgainstCwd(target, cwd) === expectedEvidence) return true;
    } catch {
      // A path that cannot resolve is not evidence.
    }
  }
  return false;
}

/** The per-tool state the reader keeps, as the baseline keeps it. */
export type ToolState = {
  id: string;
  name: string;
  arguments: unknown;
  argumentsText: string;
  started: boolean;
  ended: boolean;
};

/** True where the end of a tool counts as an error (F138-FR-029). */
export function toolEndIsError(record: Record<string, unknown>): boolean {
  const status = String(record["status"] ?? "").toLowerCase();
  return (
    status === "error" || status === "failed" || status === "failure" || record["isError"] === true
  );
}

/** The generated id of a call the stream names no id for (F138-FR-029). */
export function generatedToolId(row: DialectRow, ordinal: number): string {
  const family = row.providerFormat.split(/-v\d+$/)[0] || row.providerFormat;
  return `${family}-tool-${ordinal}`;
}

/** Read the call id a tool record names, under both spellings. */
export function toolIdOf(record: Record<string, unknown>): string | null {
  const id = record["toolCallId"] ?? record["tool_call_id"];
  return typeof id === "string" && id.length > 0 ? id : null;
}
