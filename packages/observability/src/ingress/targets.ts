/**
 * T040 — the targets of the observability policy (F111-FR-026).
 *
 * F111-FR-026: *The observability policy MUST treat targets as the baseline does.
 * The string values of the keys `file`, `file_path`, `filename`, `notebook_path`,
 * `path`, `paths`, `target`, `targets`, `destination` and `source` (also in camel
 * case) MUST be taken as paths. The values of `command`, `cmd` and `script` MUST
 * be split as a shell would split them (on a quoting error, at white space) to
 * find paths. Extraction MUST be lexical: tokens that start with `-`, `http://`
 * or `https://`, shell operators and tokens not shaped as paths MUST be discarded
 * and duplicates removed. At most 8 targets MUST be kept. A tool argument MUST be
 * summarised as `targets`, `summary` (the redacted JSON cut to the argument
 * limit), `redacted`, `truncated`, `original_bytes` and `retained_bytes`.*
 *
 * NOTHING IS EXECUTED, AND NOTHING IS RESOLVED. A command that arrives from
 * outside the runtime is SPLIT and nothing more: there is no `child_process` in
 * this module and no call that touches the file system, so a token that looks
 * like a path is kept because of its shape and never because it exists. That is
 * what "lexical" buys — the content of a stream can be hostile and the worst it
 * can do here is be ignored.
 *
 * THE PROGRAM NAME IS KEPT, AND THAT IS THE BASELINE. `cp -r a b` yields `cp`,
 * `a` and `b`, because `cp` is shaped like a path and a lexical pass cannot know
 * it is a program. This port keeps that answer rather than improving on it: the
 * parity oracle compares the targets of the two sides, and an improvement here
 * would be a difference there. The characterization table of
 * `test/targets.test.ts` records the answers that were read off the baseline.
 *
 * `shellSplit` IS THE POSIX HALF OF PYTHON'S `shlex.split`. Single quotes are
 * literal, double quotes keep a backslash escape for `"`, `\\` and the escape
 * itself, an unquoted backslash escapes the next character, and an unmatched
 * quote RAISES, which is where the requirement's "on a quoting error, at white
 * space" comes in: the fallback is the baseline's `command.split()`.
 */
import {
  baselineJson,
  defaultRedactor,
  sanitizeText,
  sanitizeValue,
  truncateUtf8,
  type Limits,
} from "./limits.ts";
import type { SpecstrideRedactor } from "@specstride/kernel";

/** The ten keys whose string value is a path (F111-FR-026). */
export const TARGET_KEYS: readonly string[] = Object.freeze([
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

/** The three keys whose value is a command (F111-FR-026). */
export const COMMAND_KEYS: readonly string[] = Object.freeze(["command", "cmd", "script"]);

/** The shell operators the baseline discards. */
export const SHELL_OPERATORS: readonly string[] = Object.freeze(["|", "||", "&&", ">", ">>", "<"]);

/** The prefixes a discarded token starts with (F111-FR-026). */
export const DISCARDED_PREFIXES: readonly string[] = Object.freeze(["-", "http://", "https://"]);

/** The characters the baseline strips from both ends of a candidate. */
export const STRIPPED_CHARACTERS = "'\"()[]{}:,;" as const;

/**
 * The shape of a path token, the baseline's `_PATH_TOKEN`. It is anchored at the
 * start, as Python's `re.match` is.
 */
export const PATH_TOKEN = /^(?:^|\/)(?:\.?[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_-]+)?$/;

const TARGETS = new Set(TARGET_KEYS);
const COMMANDS = new Set(COMMAND_KEYS);
const OPERATORS = new Set(SHELL_OPERATORS);

/** camelCase or PascalCase to snake_case, the baseline's formula. */
export function snakeKey(key: unknown): string {
  return String(key)
    .replace(/([A-Z]+)/g, "_$1")
    .toLowerCase();
}

/** An unmatched quote: what Python's `shlex.split` raises. */
export class QuotingError extends Error {
  constructor() {
    super("No closing quotation");
    this.name = "QuotingError";
  }
}

/** Split a command as a POSIX shell would, raising on an unmatched quote. */
export function splitPosix(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let started = false;
  let index = 0;
  const text = String(command);

  while (index < text.length) {
    const character = text[index] as string;
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
      index += 1;
      continue;
    }
    if (character === "'") {
      started = true;
      index += 1;
      const close = text.indexOf("'", index);
      if (close === -1) throw new QuotingError();
      token += text.slice(index, close);
      index = close + 1;
      continue;
    }
    if (character === '"') {
      started = true;
      index += 1;
      let closed = false;
      while (index < text.length) {
        const inner = text[index] as string;
        if (inner === "\\" && index + 1 < text.length) {
          const next = text[index + 1] as string;
          // Inside double quotes a backslash escapes only these four.
          token += ['"', "\\", "$", "`"].includes(next) ? next : `\\${next}`;
          index += 2;
          continue;
        }
        if (inner === '"') {
          closed = true;
          index += 1;
          break;
        }
        token += inner;
        index += 1;
      }
      if (!closed) throw new QuotingError();
      continue;
    }
    if (character === "\\") {
      started = true;
      if (index + 1 < text.length) {
        token += text[index + 1] as string;
        index += 2;
        continue;
      }
      // A trailing backslash: `shlex` in posix mode has nothing to escape.
      index += 1;
      continue;
    }
    started = true;
    token += character;
    index += 1;
  }

  if (started) tokens.push(token);
  return tokens;
}

/**
 * Split a command the way the baseline does: as a shell splits it, and on a
 * quoting error at white space.
 */
export function shellSplit(command: string): string[] {
  try {
    return splitPosix(command);
  } catch {
    return String(command)
      .split(/\s+/)
      .filter((token) => token.length > 0);
  }
}

function stripEnds(candidate: string): string {
  let start = 0;
  let end = candidate.length;
  while (start < end && STRIPPED_CHARACTERS.includes(candidate[start] as string)) start += 1;
  while (end > start && STRIPPED_CHARACTERS.includes(candidate[end - 1] as string)) end -= 1;
  return candidate.slice(start, end);
}

/** True where the token is one the baseline discards. */
export function isDiscardedToken(candidate: string): boolean {
  if (candidate.length === 0) return true;
  if (DISCARDED_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return true;
  if (OPERATORS.has(candidate)) return true;
  return !PATH_TOKEN.test(candidate);
}

/**
 * The paths of a value, found lexically: the path keys, then the tokens of the
 * command keys; the discarded tokens dropped, duplicates removed, each cut to the
 * target cap, and at most `maxTargetPaths` kept (F111-FR-026).
 */
export function extractTargetPaths(value: unknown, limits: Limits): readonly string[] {
  const candidates: string[] = [];
  const commands: string[] = [];

  const visit = (item: unknown, key: string): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child, key);
      return;
    }
    if (item !== null && typeof item === "object") {
      for (const [childKey, child] of Object.entries(item as Record<string, unknown>)) {
        visit(child, childKey);
      }
      return;
    }
    if (typeof item !== "string") return;
    const lowered = key.toLowerCase();
    if (TARGETS.has(lowered) || TARGETS.has(snakeKey(key))) candidates.push(item);
    else if (COMMANDS.has(lowered)) commands.push(item);
  };

  visit(value, "");
  for (const command of commands) candidates.push(...shellSplit(command));

  const targets: string[] = [];
  for (const raw of candidates) {
    const candidate = stripEnds(String(raw));
    if (isDiscardedToken(candidate)) continue;
    const bounded = truncateUtf8(candidate, limits.targetMaxBytes).value;
    if (!targets.includes(bounded)) targets.push(bounded);
    if (targets.length >= limits.maxTargetPaths) break;
  }
  return Object.freeze(targets);
}

/** The summary of a tool argument: the six fields of F111-FR-026. */
export type TargetSummary = {
  readonly targets: readonly string[];
  readonly summary: string;
  readonly redacted: boolean;
  readonly truncated: boolean;
  readonly original_bytes: number;
  readonly retained_bytes: number;
};

/**
 * Summarise a tool argument as the baseline's `summarize_targets` does: the
 * targets, the redacted JSON cut to the argument limit, and the four marks.
 */
export function summarizeTargets(
  value: unknown,
  limits: Limits,
  redactor: SpecstrideRedactor = defaultRedactor(),
): TargetSummary {
  const targets = extractTargetPaths(value, limits);
  const cleaned = sanitizeValue(value, limits, undefined, redactor);
  const rendered = baselineJson(cleaned.value);
  const summary = sanitizeText(rendered, limits, limits.toolArgsMaxBytes, redactor);
  return Object.freeze({
    targets,
    summary: summary.value,
    redacted: cleaned.redacted || summary.redacted,
    truncated: summary.truncated,
    original_bytes: cleaned.original_bytes,
    retained_bytes: summary.retained_bytes,
  });
}
