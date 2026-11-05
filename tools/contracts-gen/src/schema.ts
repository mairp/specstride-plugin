/**
 * The JSON Schema builder of the generator (T289; the part "JSON Schema" of
 * `specs/100-specstride/contracts/tools/generate.py` and the schema table at
 * the head of that script; F100-FR-030).
 *
 * `oneType` turns the type in words of an annex cell into a JSON Schema type,
 * `typesFor` spreads it over the names of a row, `place` puts a dotted field
 * path into a schema, and `recordSchema` builds one record schema from a field
 * table of an annex, with `description`, `x-type-in-words`, `x-required`,
 * `x-unknown-field`, `x-different-major` and the `$id`
 * (`urn:specstride:schema:<schema id>`, contracts/README.md, "The `$id` of a
 * schema file").
 */
import { asDicts as _asDicts, findTable, ticks, type AnnexTable } from "./markdown.ts";
import { NOTE, URN } from "./paths.ts";

/** A node of a JSON Schema under construction: plain JSON, built in key order. */
export type SchemaNode = Record<string, unknown>;

/**
 * One record schema of the specification: the schema id, the file stem, the
 * annex and the section, the heading of the (sub)section that holds the field
 * table, the first header cell of that table, and whether the schema is closed
 * (an unknown top-level key refuses the record).
 */
export interface RecordSpec {
  readonly sid: string;
  readonly stem: string;
  readonly annex: string;
  readonly section: string;
  readonly where: string;
  readonly first: string;
  readonly closed: boolean;
}

/** The thirty record schemas, in the order the Python script lists them. */
export const RECORDS: readonly RecordSpec[] = (
  [
    ["specstride.layout/1", "workspace-record", "B", "§B.6", "§B.6", "Field", false],
    ["specstride.launch/1", "launch-record", "B", "§B.7", "§B.7", "Field", false],
    ["specstride.lease/1", "lease", "B", "§B.8", "§B.8", "Field", false],
    ["specstride.lease/1:owner", "owner-record", "B", "§B.9", "§B.9", "Field", false],
    ["specstride.procs/1", "process-registry", "B", "§B.10", "§B.10", "Field", false],
    ["specstride.inbox/1", "inbox-request", "B", "§B.11", "§B.11", "Type", false],
    ["specstride.snapshot/1", "run-snapshot", "B", "§B.12", "§B.12", "Field", false],
    ["specstride.ledger/1", "ledger-record", "B", "§B.13", "§B.13", "Field", false],
    ["specstride.approval/1", "approval-record", "B", "§B.14", "§B.14", "Field", false],
    ["specstride.terminal/1", "terminal-record", "B", "§B.15", "§B.15", "Field", false],
    ["specstride.supervision/1", "supervision-record", "B", "§B.16", "§B.16", "Field", false],
    ["specstride.pause/1", "pause-record", "B", "§B.17", "§B.17", "Field", false],
    ["specstride.tripwire/1", "tripwire-record", "B", "§B.18", "§B.18", "Field", false],
    ["specstride.harness/1:descriptor", "harness-descriptor", "C", "§C.2", "§C.2", "Field", true],
    ["specstride.withheld-paths/1", "withheld-paths", "C", "§C.4", "§C.4", "Field", false],
    [
      "specstride.stream-dialect/1",
      "stream-dialect-row",
      "C",
      "§C.5",
      "§C.5",
      "Field of a row",
      false,
    ],
    ["specstride.registry/1", "resolved-registry", "C", "§C.6", "§C.6", "Field", false],
    ["specstride.spec-format/1:model", "canonical-spec-model", "C", "§C.7", "§C.7", "Field", false],
    ["specstride-overlay/v1", "overlay", "C", "§C.16", "§C.16", "Field", false],
    ["specstride.parallel-plan/1", "parallel-plan", "D", "§D.3", "§D.3", "Field", false],
    ["specstride-pass-yield/v1", "yield-artifact", "D", "§D.6", "§D.6", "Field", false],
    ["specstride.fact-block/1", "fact-block", "D", "§D.7", "§D.7", "Field", false],
    ["specstride.manifest/1", "check-manifest", "D", "§D.8", "§D.8", "Field", false],
    ["specstride.run-state/1", "run-record", "E", "§E.2", "Run record", "Field", false],
    ["specstride.doctor/1", "doctor-findings", "G", "§G.7", "§G.7", "Field", false],
    ["specstride.launch-contract/1", "launch-contract", "G", "§G.8", "§G.8", "Field", true],
    ["specstride.event/1", "event-envelope", "X", "§X.1", "§X.1", "Field", false],
    [
      "specstride.config/1",
      "config-envelope",
      "X",
      "§X.2",
      "§X.2",
      "Field of a configuration file",
      true,
    ],
    ["specstride.table/1", "rule-table", "X", "§X.3", "§X.3", "Field of a table", false],
    [
      "specstride.redaction/1",
      "redaction-pattern-set",
      "X",
      "§X.4",
      "§X.4",
      "Field of the pattern set",
      false,
    ],
  ] as const
).map(([sid, stem, annex, section, where, first, closed]) =>
  Object.freeze({ sid, stem, annex, section, where, first, closed }),
);

/** `dict.setdefault(key, fallback)`: the value, inserting the fallback when absent. */
function setdefault<T>(node: SchemaNode, key: string, fallback: T): T {
  if (!Object.prototype.hasOwnProperty.call(node, key)) node[key] = fallback;
  return node[key] as T;
}

/** The type in words of one name, as a JSON Schema type. */
export function oneType(words: string): SchemaNode {
  let w = words.trim().toLowerCase();
  const nullable = w.includes("or null");
  w = w.split(", or null").join("").split(" or null").join("").trim();
  let t: SchemaNode;
  if (w.startsWith("member of a closed set") || w.startsWith("member of")) {
    t = { type: "string" };
  } else if (w.startsWith("whole number")) {
    t = { type: "integer" };
  } else if (w.startsWith("truth value")) {
    t = { type: "boolean" };
  } else if (w.startsWith("timestamp")) {
    t = { type: "string", format: "date-time" };
  } else if (w.startsWith("date")) {
    t = { type: "string", format: "date" };
  } else if (w.startsWith("list")) {
    t = { type: "array" };
  } else if (w.startsWith("record") || w.startsWith("map")) {
    t = { type: "object" };
  } else if (
    w.includes("text") ||
    w.startsWith("secret reference") ||
    w.startsWith("major and minor")
  ) {
    t = { type: "string" };
  } else {
    t = {};
  }
  if (nullable && Object.prototype.hasOwnProperty.call(t, "type")) {
    t.type = [t.type, "null"];
  }
  return t;
}

/** The types of the `n` names of one row, from the one cell "Type in words". */
export function typesFor(words: string, n: number): SchemaNode[] {
  const parts = words
    .split(/,(?![^(]*\))/)
    .map((p) => p.trim())
    .filter((p) => p !== "" && p.toLowerCase() !== "or null");
  const merged: string[] = [];
  for (const p of parts) {
    if (p.toLowerCase().startsWith("or null") && merged.length > 0) {
      merged[merged.length - 1] += ", or null";
    } else {
      merged.push(p);
    }
  }
  if (n === 1) return [oneType(words)];
  if (merged.length === n) return merged.map((p) => oneType(p));
  if (merged.length === 1) return Array.from({ length: n }, () => oneType(merged[0]));
  return Array.from({ length: n }, () => ({}) as SchemaNode);
}

/** Put `node` at the dotted path (with `[]` for list items) below the schema `root`. */
export function place(root: SchemaNode, path: string, node: SchemaNode, required: boolean): void {
  let cur = root;
  const parts = path.split(".");
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    const isList = part.endsWith("[]");
    const name = isList ? part.slice(0, -2) : part;
    const props = setdefault<SchemaNode>(cur, "properties", {});
    const last = k === parts.length - 1;
    if (last && !isList) {
      const existing = (props[name] as SchemaNode | undefined) ?? {};
      Object.assign(existing, node);
      props[name] = existing;
      if (required) {
        const req = setdefault<string[]>(cur, "required", []);
        if (!req.includes(name)) req.push(name);
      }
      return;
    }
    const child = setdefault<SchemaNode>(props, name, {});
    if (isList) {
      setdefault(child, "type", "array");
      cur = setdefault<SchemaNode>(child, "items", { type: "object" });
      if (last) {
        Object.assign(cur, node);
        return;
      }
    } else {
      setdefault(child, "type", "object");
      cur = child;
    }
  }
}

/** The name of a field, with trailing prose in parentheses cut off. */
const BARE = /\s*\(.*\)$/;
/** The form of a field name that the builder accepts. */
const NAME = /^[A-Za-z_][\w.[\]-]*$/;

/** Build one record schema from the field table of its annex section. */
export function recordSchema(tables: readonly AnnexTable[], spec: RecordSpec): SchemaNode {
  const sub = spec.where.startsWith("§") ? null : spec.where;
  const table = findTable(tables, spec.annex, spec.section, spec.first, sub);
  const hdr = table.header;
  const nameCol = spec.first === "Type" ? 1 : 0;
  const schema: SchemaNode = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: URN + spec.sid,
    title: spec.stem,
    description: NOTE,
    "x-schema-id": spec.sid,
    "x-annex": `annex ${spec.annex}, ${spec.section}`,
    type: "object",
  };
  for (const row of table.rows) {
    const d: Record<string, string> = {};
    for (let k = 0; k < Math.min(hdr.length, row.length); k++) d[hdr[k]] = row[k];
    let names = ticks(row[nameCol])
      .map((n) => n.replace(BARE, ""))
      .filter((n) => NAME.test(n));
    if (!row[nameCol].startsWith("`")) names = [];
    const meaning = d["Meaning"] ?? "";
    const words = d["Type in words"] ?? "";
    const req = d["Required"] ?? "";
    if (names.length === 0) {
      setdefault<SchemaNode[]>(schema, "x-notes", []).push({
        row: row[nameCol],
        meaning,
        required: req,
      });
      continue;
    }
    const ts = typesFor(words, names.length);
    for (let k = 0; k < names.length; k++) {
      const n = names[k];
      const node: SchemaNode = { ...ts[k] };
      node["description"] = meaning;
      node["x-type-in-words"] = words;
      node["x-required"] = req;
      if (spec.first === "Type") node["x-request-type"] = row[0].replace(/^`+|`+$/g, "");
      const lw = words.toLowerCase();
      if (lw.includes("closed set") && !lw.includes("open set") && names.length === 1) {
        const lits = ticks(meaning);
        const low = meaning.toLowerCase();
        if (lits.length >= 2 && !low.includes("closed set of") && !low.includes("enumeration of")) {
          node["enum"] = lw.includes("null") ? [...lits, null] : [...lits];
        }
      }
      const required = req.trim().toLowerCase().startsWith("yes") && spec.first !== "Type";
      place(schema, n, node, required);
    }
  }
  if (spec.closed) {
    schema["additionalProperties"] = false;
    schema["patternProperties"] = { "^x-": {} };
  } else {
    schema["additionalProperties"] = true;
  }
  schema["x-unknown-field"] = spec.closed
    ? "refused, except keys under x-"
    : "ignored by a reader (annex B, §B.4)";
  schema["x-different-major"] = "refused (annex B, §B.4)";
  return schema;
}

/** Re-exported so that a caller of the builder needs one import (`as_dicts` of the script). */
export const asDicts = _asDicts;
