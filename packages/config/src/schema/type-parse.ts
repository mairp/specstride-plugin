/**
 * T009 — reading the columns "Type and range", "Default" and "Under `parity`"
 * of the catalogue (F110-FR-001, F110-FR-007, F110-FR-008, F110-FR-010).
 *
 * The tables of §K.3 to §K.6b are prose on purpose: a cell says "whole number
 * of seconds" or "on, off" or "list of paths". This module turns a cell into a
 * `ValueSpec` that can be checked against a value, and a default cell into the
 * value it names or into a stated reason why the owner of the key supplies it.
 *
 * Nothing here is generated: `catalogue-data.ts` carries the cells verbatim and
 * every reading of a cell happens here, so a change of a table cannot leave a
 * stale judgement behind.
 */
import {
  RESERVED_PARITY_LITERALS,
  type DefaultSpec,
  type ParitySpec,
  type ReservedLiteral,
  type ValueKind,
  type ValueSpec,
} from "./types.ts";

/** The units of rule 1 of §K.2, as a suffix of the key or a word of the cell. */
export const UNITS = Object.freeze({
  seconds: "Sec",
  second: "Sec",
  milliseconds: "Ms",
  minutes: "Min",
  days: "Days",
  bytes: "Bytes",
  percent: "Percent",
  characters: "Chars",
  lines: "Lines",
  tokens: "Tokens",
  events: "Events",
  ticks: "Ticks",
} as const);

const words = (cell: string): string[] =>
  cell
    .toLowerCase()
    .split(/[^a-z0-9.<>@_-]+/)
    .filter((w) => w !== "");

/** True where the cell names a list. */
const isList = (cell: string): boolean => /^list\b/.test(cell.trim());

/** True where the cell names a table, a map or a descriptor of another schema. */
const isTable = (cell: string): boolean =>
  /^(table|map)\b/.test(cell.trim()) ||
  /^descriptor of\b/.test(cell.trim()) ||
  /^profile of\b/.test(cell.trim());

/** The cells that name a free text value rather than a closed set. */
const TEXT_CELLS = new Set([
  "text",
  "path",
  "url",
  "id",
  "expression",
  "command text",
  "run id",
  "feature slug",
  "characters",
  "harness id",
  "harness id of the registry",
  "id of the spec-format registry",
  "id of the detach registry",
  "path under the working directory",
  "path of the control root",
]);

/** Members that are prose, not literals, and so widen a closed set to free text. */
const OPEN_MEMBER = /^(and |the members|as at |as the |unless |where |or unset$)/;

/**
 * Read the column "Type and range" of one key (§K.1).
 *
 * The forms the tables use, in the order this function tries them:
 *
 * 1. `secret ref` — a reference of §K.7, never an inline value (F110-FR-027).
 * 2. `list …` — a list, which replaces and never concatenates (F110-FR-016).
 * 3. `table of …`, `map from …`, `descriptor of …`, `profile of …` — an object.
 * 4. `true, false`, `on, off`, `off, on` — a boolean, with the two literals the
 *    cell uses, so that the message of a type error quotes the cell.
 * 5. a cell that begins with a number word (`whole number`, `number`,
 *    `seconds`, `milliseconds`, `minutes`, `percent`, …) — a number, with the
 *    unit of rule 1 of §K.2 and whatever bound the cell states.
 * 6. a comma-separated list of literals — a closed set.
 * 7. anything else — free text.
 */
export function parseValueSpec(cell: string): ValueSpec {
  const text = cell.trim();
  const low = text.toLowerCase();

  if (low === "secret ref") return Object.freeze({ kind: "secret-ref", text });
  if (isList(low)) {
    const members = closedMembersOfListCell(text);
    const element = elementKindOfListCell(low);
    return Object.freeze({
      kind: "list",
      text,
      ...(members === undefined ? {} : { elementMembers: members }),
      ...(element === undefined ? {} : { elementKind: element }),
    });
  }
  if (isTable(low)) return Object.freeze({ kind: "table", text });

  const bool = booleanLiteralsOf(low);
  if (bool !== undefined) {
    return Object.freeze({ kind: "boolean", text, booleanLiterals: bool });
  }

  const num = parseNumberCell(text);
  if (num !== undefined) return num;

  const members = splitMembers(text);
  if (members !== undefined && members.length > 1) {
    return Object.freeze({ kind: "enum", text, members: Object.freeze(members) });
  }
  if (TEXT_CELLS.has(low) || members === undefined || members.length <= 1) {
    return Object.freeze({ kind: "text", text });
  }
  return Object.freeze({ kind: "text", text });
}

/** `true, false` / `on, off` / `off, on` — the two literals of a boolean cell. */
function booleanLiteralsOf(low: string): readonly [string, string] | undefined {
  if (low === "true, false" || low === "false, true") return ["true", "false"];
  if (low === "on, off" || low === "off, on") return ["on", "off"];
  return undefined;
}

/**
 * What one element of a list holds (§K.1: "list" replaces and never
 * concatenates). `list of percent` and `list of milliseconds` hold whole
 * numbers; `list of {…}` holds objects; every other list of the tables holds
 * text — a path, an expression, a block name, a model id, a task id.
 */
function elementKindOfListCell(low: string): ValueKind | undefined {
  if (/^list from /.test(low)) return "enum";
  if (/^list of \{/.test(low)) return "table";
  if (/^list of (percent|milliseconds|seconds|bytes|minutes)\b/.test(low)) return "integer";
  if (/^list of /.test(low)) return "text";
  if (low === "list") return "text";
  return undefined;
}

/** The element set of a list cell, where the cell names one. */
function closedMembersOfListCell(text: string): readonly string[] | undefined {
  const m = /^list from (.+)$/i.exec(text.trim());
  if (m === null) return undefined;
  const members = splitMembers(m[1] ?? "");
  return members === undefined ? undefined : Object.freeze(members);
}

const NUMBER_HEADS = [
  "whole number",
  "number",
  "seconds",
  "milliseconds",
  "minutes",
  "percent",
  "characters",
];

/** Read a cell that names a number: its unit, its bounds, and whether 0 escapes them. */
function parseNumberCell(text: string): ValueSpec | undefined {
  const low = text.toLowerCase();
  const head = NUMBER_HEADS.find(
    (h) => low === h || low.startsWith(`${h},`) || low.startsWith(`${h} `),
  );
  // `1 or 2`, `1 to 4`, `0 to 5` begin with a digit instead of a word.
  const bare = /^\d+\s+(or|to)\s+\d+$/.test(low);
  if (head === undefined && !bare) return undefined;

  const whole = low.startsWith("whole number") || bare || head !== "number";
  const unit = unitOf(low);
  let min: number | undefined = whole ? 0 : undefined;
  let max: number | undefined;
  let zeroEscapes = false;
  let rangeIsProse = false;

  // `whole number, 1` fixes the only accepted value.
  const only = /^whole number,\s*(\d+)$/.exec(low);
  if (only !== null) {
    const v = Number(only[1]);
    min = v;
    max = v;
  }
  // `1 or 2`, `1 to 4`, `0 to 5`, `percent, 1 to 100`.
  const span = /(\d+)\s+(?:or|to)\s+(\d+)/.exec(low);
  if (span !== null && only === null) {
    min = Number(span[1]);
    max = Number(span[2]);
  }
  if (/at least 1/.test(low)) min = 1;
  if (/\b0 (disables|unlimited|flushes)/.test(low)) {
    min = 0;
    zeroEscapes = true;
  }
  // `whole number, 1 to the value of loop.parallel.workersMax` — the bound is
  // another key, so no constant bound is checked here.
  if (/the value of /.test(low)) {
    min = 1;
    max = undefined;
    rangeIsProse = true;
  }
  return Object.freeze({
    kind: whole ? "integer" : "number",
    text,
    ...(unit === undefined ? {} : { unit }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(zeroEscapes ? { zeroEscapes } : {}),
    ...(rangeIsProse ? { rangeIsProse } : {}),
  });
}

/** The unit of rule 1 of §K.2 that the cell names, where it names one. */
function unitOf(low: string): string | undefined {
  for (const w of words(low)) {
    const unit = (UNITS as Record<string, string | undefined>)[w];
    if (unit !== undefined) return unit;
  }
  return undefined;
}

/**
 * Split a cell into the literals of a closed set, or `undefined` where a part
 * is prose and the cell therefore names no closed set.
 */
function splitMembers(text: string): string[] | undefined {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length < 2) return undefined;
  const members: string[] = [];
  for (const part of parts) {
    if (OPEN_MEMBER.test(part.toLowerCase())) return undefined;
    if (/\s/.test(part) && !/^[a-z0-9][a-z0-9 -]*$/i.test(part)) return undefined;
    if (/\s/.test(part) && part.split(/\s+/).length > 2) return undefined;
    members.push(part);
  }
  return members;
}

/**
 * True where the type the cell names admits only the values it lists, so that a
 * token the cell accepts is certainly a value and never a reserved literal of
 * the profile. A `text`, a `secret ref`, a `table` and a list of text accept any
 * token at all, so for them a reserved literal wins.
 */
export function isStrictType(spec: ValueSpec): boolean {
  if (spec.kind === "boolean" || spec.kind === "integer" || spec.kind === "number") return true;
  if (spec.kind === "enum") return true;
  if (spec.kind === "list") return spec.elementKind === "integer" || spec.elementKind === "enum";
  return false;
}

/**
 * True where the cell "Type and range" names the token itself, as
 * `mode of the harness, or baseline` names `baseline`. The token is then a value
 * of the type even though the cell is prose, and not a reserved literal.
 */
export function cellNamesToken(cell: string, token: string): boolean {
  const t = token.trim().toLowerCase();
  if (t === "") return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s,])${escaped}([\\s,]|$)`, "i").test(cell.toLowerCase());
}

/** The cells of the column "Default" that mean "the key holds nothing". */
const ABSENT_DEFAULTS = new Set(["none", "unset", "empty", "empty (off)", "off (no limit)"]);

/**
 * The notes the column "Default" writes around the value it states. Each is a
 * remark about the value, not part of it: a parenthesis that translates or
 * sources it, or a clause that names the condition under which the owner of the
 * key replaces it. Stripping them is what lets F110-FR-010 compare a stated
 * default with the key's own type; a cell with no value left after the strip
 * stays `deferred`, which no type check touches.
 */
const DEFAULT_NOTE: readonly RegExp[] = Object.freeze([
  /\s*\([^()]*\)\s*$/,
  /\s*[,;]\s+(unless|where|when|required|follows|but|and)\b.*$/i,
  /\s+(unless|where|when)\s+\S.*$/i,
  /\s*:\s*(follows|required)\b.*$/i,
]);

/** Strip the notes of a cell of the column "Default". */
export function normaliseDefaultCell(cell: string): string {
  let text = cell.trim();
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const pattern of DEFAULT_NOTE) {
      const next = text.replace(pattern, "").trim();
      if (next !== text && next !== "") {
        text = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return text;
}

/**
 * Read the column "Default" of one key (§K.1).
 *
 * A cell that names a value of the key's own type becomes that value; `none`,
 * `unset` and `empty` become the absent value of the type; anything else is a
 * statement about where the default comes from — the harness, the descriptor,
 * the platform, the owning feature — and is carried as `deferred` with the
 * text, because the owner of the key supplies it (F110-FR-009) and no type
 * check applies to prose.
 */
export function parseDefault(cell: string, spec: ValueSpec): DefaultSpec {
  const text = cell.trim();
  const core = normaliseDefaultCell(text);
  const low = core.toLowerCase();
  const value = literalValue(core, spec);
  // A closed set that holds `none` as a member means the member, not "nothing".
  if (value !== undefined && isStrictType(spec)) {
    return Object.freeze({ kind: "value", value, text } as DefaultSpec);
  }
  if (ABSENT_DEFAULTS.has(low)) {
    return Object.freeze({
      kind: "absent",
      value: spec.kind === "list" ? Object.freeze([]) : null,
      text,
    } as DefaultSpec);
  }
  if (value !== undefined) return Object.freeze({ kind: "value", value, text } as DefaultSpec);
  return Object.freeze({ kind: "deferred", text } as DefaultSpec);
}

/**
 * The value a cell names, read against the key's own type, or `undefined` where
 * the cell is prose. This is the one place that decides whether a type can hold
 * a default (F110-FR-010).
 */
export function literalValue(text: string, spec: ValueSpec): unknown {
  const t = text.trim();
  const low = t.toLowerCase();
  switch (spec.kind) {
    case "boolean": {
      if (low === "true" || low === "on") return true;
      if (low === "false" || low === "off") return false;
      return undefined;
    }
    case "integer": {
      if (!/^-?\d+$/.test(t)) return undefined;
      return Number(t);
    }
    case "number": {
      if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
      return Number(t);
    }
    case "enum": {
      const member = (spec.members ?? []).find((m) => m.toLowerCase() === low);
      return member;
    }
    case "text":
    case "secret-ref": {
      // A text cell holds a value only where the cell is a single token: prose
      // such as "the harness default" is a statement, not a value.
      return /^[^\s]+$/.test(t) ? t : undefined;
    }
    case "list": {
      const items = t
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p !== "");
      if (items.length === 0) return undefined;
      const element: ValueSpec = Object.freeze({
        kind: spec.elementKind ?? (spec.elementMembers === undefined ? "text" : "enum"),
        text: spec.text,
        ...(spec.elementMembers === undefined ? {} : { members: spec.elementMembers }),
      });
      if (element.kind === "table") return undefined;
      const mapped = items.map((i) => literalValue(i, element));
      return mapped.every((m) => m !== undefined) ? Object.freeze(mapped) : undefined;
    }
    case "table":
      return undefined;
  }
}

/**
 * The prose the column "Under `parity`" adds around a value or a literal, which
 * `parseParity` strips before it reads the cell. Each form appears in §K.5,
 * §K.6 or §K.6b and says only that the profile stands at rank 8, so that an
 * explicit setting at ranks 1 to 7 beats it (F110-FR-013, CQ-157).
 */
const PARITY_PROSE: readonly (readonly [RegExp, string])[] = Object.freeze([
  // "`false`, unless the fixture sets it" — the profile names the value; any
  // fixture that sets the key wins by rank, which needs no literal.
  [/^(.+?),?\s+unless the fixture sets (?:it|them)$/i, "$1"],
  // "not set, unless the fixture sets it" — the profile names no value.
  [/^not set$/i, "(fixture)"],
  // "C0 (as at the baseline: none)", "on (compatibility output)" — the
  // parenthesis is the note of the row, not part of the value.
  [/^([^()]+?)\s*\([^()]*\)$/, "$1"],
  // "as at the baseline" — the reserved literal `baseline`.
  [/^as at the baseline$/i, "baseline"],
  // "not reached", "not printed" — the reserved literal `not used`: the profile
  // leaves the key at its default because the run never reaches it.
  [/^not (reached|printed)$/i, "not used"],
]);

/** Strip the prose of a cell of the column "Under `parity`". */
export function normaliseParityCell(cell: string): string {
  let text = cell.trim();
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const [pattern, replacement] of PARITY_PROSE) {
      const next = text.replace(pattern, replacement).trim();
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return text;
}

/**
 * Read the column "Under `parity`" of one key (F110-FR-008).
 *
 * `as default` means the profile holds no row for the key: a key that is not a
 * switch has, under `parity`, the value it has at the baseline, which is its
 * default here (§K.1). Otherwise the cell names a value of the key's own type,
 * or one of the five reserved literals of closed set 239, which are the only
 * non-value entries. A cell that is neither makes the profile invalid.
 */
export function parseParity(
  cell: string,
  spec: ValueSpec,
  stated: DefaultSpec,
): ParitySpec | undefined {
  const text = cell.trim();
  if (text.toLowerCase() === "as default") {
    return Object.freeze({ kind: "as-default", text } as ParitySpec);
  }
  const core = normaliseParityCell(text);
  // The cell repeats the default cell of the same row: the key keeps the
  // default the table states, which the reserved literal `baseline` names
  // ("as at the baseline"). The profile sets nothing for the key.
  if (stated.kind === "deferred" && core.toLowerCase() === stated.text.trim().toLowerCase()) {
    return Object.freeze({ kind: "literal", literal: "baseline", text } as ParitySpec);
  }
  const low = core.toLowerCase();
  const value = literalValue(core, spec);
  // The type admits the token: it is a value of the key, never a literal of the
  // profile. `off` under a key of the cell `on, off` is the value `off`; `off`
  // under `list of {harness, model?, auth?}` is the reserved literal.
  if (value !== undefined && (isStrictType(spec) || cellNamesToken(spec.text, core))) {
    return Object.freeze({ kind: "value", value, text } as ParitySpec);
  }
  if (ABSENT_DEFAULTS.has(low)) {
    return Object.freeze({
      kind: "value",
      value: spec.kind === "list" ? Object.freeze([]) : null,
      text,
    } as ParitySpec);
  }
  const literal = RESERVED_PARITY_LITERALS.find((l) => l === low);
  if (literal !== undefined) {
    return Object.freeze({
      kind: "literal",
      literal: literal as ReservedLiteral,
      text,
    } as ParitySpec);
  }
  if (value !== undefined) return Object.freeze({ kind: "value", value, text } as ParitySpec);
  return undefined;
}
