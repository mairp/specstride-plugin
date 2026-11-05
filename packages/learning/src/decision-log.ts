/**
 * T007 — the decision log (F106-FR-007, F106-FR-008, F106-FR-010, F106-FR-011):
 * the byte format, the append, the replay, the bound through a run id and the
 * shape keying.
 *
 * Logical name `feature:<slug>:learning:decisions` (layout table of feature
 * 100: `<control>/features/<slug>/learning/applied.json`). The byte format is
 * kept exactly because the launch contract hashes these bytes (F106-FR-027):
 * one JSON object per line, the members in the order of F106-FR-008, `, `
 * between members and `: ` after a name, every character outside ASCII as a
 * `\uXXXX` escape in lower case (a character outside the basic plane as its
 * two surrogate escapes), a whole-valued number that the baseline writes with
 * a fraction keeping its fraction (`120.0`), and one line feed at the end.
 * That text form is the form Python's `json.dumps` writes with its default
 * separators and `ensure_ascii=True` — the serializer below reproduces it.
 *
 * Existing lines are never rewritten; the directory is created on demand.
 */
import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { dirname } from "node:path";
import {
  DECISION_ENTRY_FREE_TEXT_MEMBERS,
  learningIngress,
  redactWrittenValue,
} from "./ingress.ts";

/** The schema id of the entries this feature writes (annex B §B.20). */
export const LEARN_APPLIED_SCHEMA = "specstride.learn.applied/2" as const;
/** The schema id of the entries of the first version; read, never written. */
export const LEARN_APPLIED_SCHEMA_V1 = "specstride.learn.applied/1" as const;
/** The schemas a reader accepts. */
export const LEARN_APPLIED_SCHEMAS_READ = [LEARN_APPLIED_SCHEMA_V1, LEARN_APPLIED_SCHEMA] as const;

/** A JSON number that must be written with a fraction, as the baseline writes it. */
export type Fraction = { readonly fraction: number };

/** Wrap a number so the serializer writes it with a fraction (`120` → `120.0`). */
export function fraction(value: number): Fraction {
  return { fraction: value };
}

function isFraction(value: unknown): value is Fraction {
  return typeof value === "object" && value !== null && "fraction" in value;
}

/** The text form Python writes for a float: `repr`, which keeps `.0` on wholes. */
function floatText(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e16) return `${value}.0`;
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : value < 0 ? "-Infinity" : "NaN";
  let text = String(value);
  if (/^[-]?\d+$/.test(text)) text = `${text}.0`; // 1e16 and above: Python still writes .0
  if (text.includes("e")) text = text.replace("e+", "e+"); // exponent form as JS prints it
  return text;
}

function escapeString(text: string): string {
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (code === 0x08) out += "\\b";
    else if (code === 0x09) out += "\\t";
    else if (code === 0x0a) out += "\\n";
    else if (code === 0x0c) out += "\\f";
    else if (code === 0x0d) out += "\\r";
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else if (code < 0x7f) out += ch;
    else if (code <= 0xffff) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else {
      // Outside the basic plane: the two surrogate escapes (F106-FR-007).
      const high = Math.floor((code - 0x10000) / 0x400) + 0xd800;
      const low = ((code - 0x10000) % 0x400) + 0xdc00;
      out += `\\u${high.toString(16).padStart(4, "0")}\\u${low.toString(16).padStart(4, "0")}`;
    }
  }
  return `${out}"`;
}

/**
 * Serialize one JSON value in the byte format of the decision log: `, `
 * between members, `: ` after a name, lower-case `\uXXXX` escapes, and a
 * fraction kept on the numbers that were wrapped with `fraction`.
 */
export function serializeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null";
  if (isFraction(value)) return floatText(value.fraction);
  switch (typeof value) {
    case "string":
      return escapeString(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return Number.isInteger(value) ? String(value) : floatText(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(serializeValue).join(", ")}]`;
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => v !== undefined,
      );
      return `{${entries.map(([k, v]) => `${escapeString(k)}: ${serializeValue(v)}`).join(", ")}}`;
    }
    default:
      throw new TypeError(`a value of type ${typeof value} has no JSON form`);
  }
}

/** One serialized entry: the object, one line, one line feed at the end. */
export function serializeEntry(entry: Record<string, unknown>): string {
  return `${serializeValue(entry)}\n`;
}

/**
 * Append one entry as one new line (F106-FR-007: opened for append, the
 * directory created on demand, a line never rewritten).
 *
 * The free-text members of the entry pass the one ingress BEFORE the bytes
 * exist (F106-FR-040): a refusal of the ingress raises `IngressRefused`
 * before the file is opened, so a failed ingress writes nothing
 * (F106-FR-021). The byte format of the serializer runs after, so the
 * redacted text still lands in the exact as-is form the launch contract
 * hashes.
 */
export function appendEntry(path: string, entry: Record<string, unknown>): void {
  const redacted = redactWrittenValue(entry, DECISION_ENTRY_FREE_TEXT_MEMBERS, learningIngress());
  const dir = dirname(path);
  if (dir) mkdirSync(dir, { recursive: true });
  const fd = openSync(path, "a");
  try {
    writeSync(fd, serializeEntry(redacted as Record<string, unknown>));
  } finally {
    closeSync(fd);
  }
}

/** True when the entry is a decision: an `apply`, a `revert`, or an entry from before `action` existed (F106-FR-010). */
export function isDecision(entry: Record<string, unknown>): boolean {
  const action = entry["action"];
  return action === undefined || action === null || action === "apply" || action === "revert";
}

/** The phase shape a decision was recorded under; `null` for none (and for every `/1` entry). */
export function entryShape(entry: Record<string, unknown>): string | null {
  const shape = entry["shape"];
  return typeof shape === "string" && shape !== "" ? shape : null;
}

/**
 * The log as a contract bound it (F106-FR-010, the bound `learning.through`):
 * with `through` — the run id the launch contract pinned — every `apply` after
 * that entry is ignored; reverts after it still count, because they only move a
 * knob toward its default. A `through` that names no entry keeps the reverts
 * only (and binds no applies at all).
 */
export function boundEntries(
  entries: readonly Record<string, unknown>[],
  through?: string | null,
): Record<string, unknown>[] {
  if (!through) return [...entries];
  const cut = entries.findIndex((e) => e["run_id"] === through);
  if (cut === -1) return entries.filter((e) => e["action"] === "revert");
  return [
    ...entries.slice(0, cut + 1),
    ...entries.slice(cut + 1).filter((e) => e["action"] === "revert"),
  ];
}

/** The decision entries of one key — (knob, phase, shape) — in order (F106-FR-011). */
export function decisionsFor(
  entries: readonly Record<string, unknown>[],
  knob: string,
  phase: number,
  shape?: string | null,
  through?: string | null,
): Record<string, unknown>[] {
  const wanted = shape || null;
  return boundEntries(entries, through).filter(
    (e) =>
      isDecision(e) &&
      e["knob"] === knob &&
      toInt(e["phase"]) === phase &&
      entryShape(e) === wanted,
  );
}

/** The replayed value for one key (F106-FR-011): the value of the last decision under it; `null` when none. */
export function effectiveValue(
  entries: readonly Record<string, unknown>[],
  knob: string,
  phase: number,
  shape?: string | null,
  through?: string | null,
): number | null {
  const list = decisionsFor(entries, knob, phase, shape, through);
  const last = list[list.length - 1];
  const value = last?.["value"];
  return typeof value === "number" ? value : null;
}

/** A `to_int` that refuses nothing: a missing or malformed phase is `null`. */
export function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

/**
 * The notice for decisions of (knob, phase) recorded under no shape when a
 * shape is asked for: they never silently apply (F106-FR-011). `null` when
 * there are none.
 */
export function unshapedNotice(
  entries: readonly Record<string, unknown>[],
  knob: string,
  phase: number,
  shape?: string | null,
): string | null {
  if (!shape) return null;
  const n = entries.filter(
    (e) =>
      isDecision(e) && e["knob"] === knob && toInt(e["phase"]) === phase && entryShape(e) === null,
  ).length;
  if (!n) return null;
  return (
    `learn: notice — ${n} decision(s) for ${knob}[${phase}] predate phase-shape keys and are ` +
    "not applied; re-derive with `specstride learn --apply` under the current spec"
  );
}
