/**
 * T013 — the target of a tool call and the canonical tool name
 * (F126-FR-004; row 176).
 *
 * The lookup order is the baseline's: for `Bash` the `command`, else the
 * `description`; otherwise the exact top-level keys, then their snake_case
 * forms, then a bounded search of nested values (no deeper than 6 levels, at
 * most 256 values, else the empty target). A target is collapsed to one line
 * and cut to 120 characters, the last replaced by `…` when cut. A tool name
 * the vocabulary does not map passes through unchanged (the unknown-value
 * rule of row 176); no input of the stream is ever executed.
 */
import { isCanonicalToolName } from "./closed-sets.ts";

/** The exact top-level keys of F126-FR-004, in the order of the requirement. */
export const TARGET_KEYS: readonly string[] = Object.freeze([
  "file_path",
  "path",
  "notebook_path",
  "command",
  "pattern",
  "url",
  "query",
  "skill",
  "description",
  "prompt",
  "subject",
]);

/** The bounded search of F126-FR-004. */
const MAX_DEPTH = 6;
const MAX_VALUES = 256;

/** Cut a text to a byte length without splitting a code point. */
export function cutToBytes(text: string, limit: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  let cut = text;
  while (Buffer.from(cut, "utf8").length > limit) cut = cut.slice(0, -1);
  return cut;
}

/** Collapse to one line and cut to 120 characters, the last replaced by `…`. */
export function collapseTarget(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 120) return oneLine;
  return oneLine.slice(0, 119) + "…";
}

/** `camelCase` → `snake_case`, for the second pass of the lookup. */
export function snakeCaseOf(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** The first string value of the exact keys, in their order, else undefined. */
function firstExactValue(input: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of TARGET_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * The camelCase pass: a top-level key whose snake_case form is one of the
 * exact keys counts (F126-FR-004, "their camelCase forms converted to
 * snake_case").
 */
function firstSnakeCaseValue(input: Readonly<Record<string, unknown>>): string | undefined {
  for (const canonical of TARGET_KEYS) {
    for (const [key, value] of Object.entries(input)) {
      if (
        typeof value === "string" &&
        value.length > 0 &&
        key !== canonical &&
        snakeCaseOf(key) === canonical
      ) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * The bounded nested search: depth first, no deeper than 6 levels, at most
 * 256 values visited, the first matching string wins, else the empty target.
 */
function nestedSearch(value: unknown, depth: number, state: { visited: number }): string | null {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      state.visited += 1;
      if (state.visited > MAX_VALUES) return null;
      const found = nestedSearch(item, depth + 1, state);
      if (found !== null) return found;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const [key, item] of Object.entries(record)) {
      state.visited += 1;
      if (state.visited > MAX_VALUES) return null;
      if (typeof item === "string" && TARGET_KEYS.includes(key) && item.length > 0) return item;
    }
    for (const item of Object.values(record)) {
      const found = nestedSearch(item, depth + 1, state);
      if (found !== null) return found;
    }
  }
  return null;
}

/**
 * The target of one tool call, found in the order of F126-FR-004 and
 * collapsed to one line of at most 120 characters.
 */
export function resolveToolTarget(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): string {
  const candidates: (string | undefined)[] = [];
  if (toolName === "Bash") {
    const command = input["command"];
    candidates.push(typeof command === "string" && command.length > 0 ? command : undefined);
    const description = input["description"];
    candidates.push(
      typeof description === "string" && description.length > 0 ? description : undefined,
    );
  } else {
    candidates.push(firstExactValue(input));
    candidates.push(firstSnakeCaseValue(input));
    const nested = nestedSearch(input, 0, { visited: 0 });
    candidates.push(nested ?? undefined);
  }
  for (const candidate of candidates) {
    if (candidate !== undefined) return collapseTarget(candidate);
  }
  return "";
}

/**
 * The canonical name of a tool (row 176): a name the vocabulary does not map
 * passes through unchanged — the seam never invents a name and never drops
 * one (F126-FR-004).
 */
export function canonicalizeToolName(name: string): string {
  return isCanonicalToolName(name) ? name : name;
}
