/**
 * Byte-exact JSON serialization for the reverse inventory (F140-FR-021).
 *
 * The inventory must be reproducible to the byte: "two plans over the same
 * tree give byte-identical inventories", and the `fingerprint` must equal the
 * one the Specstride baseline produced at `9cab15d`
 * (`lib/reverse_inventory.py`). The baseline is Python, and Python's `json`
 * module differs from `JSON.stringify` in three ways that this feature
 * depends on, so none of this can be delegated to the platform:
 *
 *  1. **Key order.** Python's `sort_keys=True` sorts by CODE POINT.
 *     `JSON.stringify` keeps insertion order, and JavaScript's default string
 *     comparison (`<`, `Array.prototype.sort`) is by UTF-16 CODE UNIT, which
 *     disagrees with code-point order for every astral character: `"�"`
 *     sorts BEFORE `"\u{1F600}"` by code point (0xFFFD < 0x1F600) and AFTER it
 *     by UTF-16 unit (0xD83D < 0xFFFD). Decision D-2 of `research.md` and rule
 *     N-27 forbid both the UTF-16 order and any locale order.
 *  2. **Two different escapings.** The baseline writes the document with
 *     `ensure_ascii=False` (non-ASCII characters stay as they are) and hashes
 *     the fingerprint input with the DEFAULT `ensure_ascii=True` (every
 *     character above U+007E becomes `\uXXXX`, and an astral character becomes
 *     a SURROGATE PAIR, e.g. `"😀"`). One serializer cannot do both,
 *     which is decision D-1 of `research.md`: a non-ASCII path would otherwise
 *     change the fingerprint.
 *  3. **Layout.** `indent=1` is one space, and Python's indented form uses the
 *     separators `(",", ": ")`; the compact form uses `(",", ":")`.
 *
 * Numbers: the inventory holds integers only (sizes, line counts, limits).
 * Python's `repr` of a float and JavaScript's `Number.prototype.toString`
 * disagree (`1.0` against `1`), so a non-integer or non-finite number is
 * REFUSED here rather than silently serialized into a different fingerprint.
 */

/** A value these serializers accept: the JSON data model, integers only. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/* ------------------------------------------------------------------------- *
 * The code-point comparator (F140-FR-021: "Sorting MUST be by code point,
 * never by locale and never by UTF-16 unit.")
 * ------------------------------------------------------------------------- */

/**
 * Compare two strings by Unicode CODE POINT, as Python's `sorted` does.
 *
 * Negative when `a` sorts first, positive when `b` does, zero when the two
 * strings are equal. Never consults a locale, and never compares UTF-16 code
 * units: a surrogate pair is read as the one character it encodes, so
 * `compareCodePoint("�", "\u{1F600}")` is negative where the JavaScript
 * default would be positive.
 */
export function compareCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  const left = Array.from(a);
  const right = Array.from(b);
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const x = (left[index] as string).codePointAt(0) as number;
    const y = (right[index] as string).codePointAt(0) as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (left.length === right.length) return 0;
  return left.length < right.length ? -1 : 1;
}

/** A copy of `values` in code-point order. The input is not touched. */
export function sortByCodePoint(values: Iterable<string>): string[] {
  return [...values].sort(compareCodePoint);
}

/* ------------------------------------------------------------------------- *
 * Escaping
 * ------------------------------------------------------------------------- */

/** The one-letter escapes Python and JSON agree on. */
const SHORT_ESCAPE = new Map<number, string>([
  [0x08, "\\b"],
  [0x09, "\\t"],
  [0x0a, "\\n"],
  [0x0c, "\\f"],
  [0x0d, "\\r"],
  [0x22, '\\"'],
  [0x5c, "\\\\"],
]);

/** `\uXXXX`, lower-case hexadecimal, as Python writes it. */
function unicodeEscape(unit: number): string {
  return `\\u${unit.toString(16).padStart(4, "0")}`;
}

/**
 * A JSON string literal, with the quotes.
 *
 * With `ensureAscii` false this is Python's `py_encode_basestring`: only `"`,
 * `\` and U+0000 to U+001F are escaped, so U+007F and every non-ASCII
 * character stay as they are. With `ensureAscii` true it is
 * `py_encode_basestring_ascii`: everything outside U+0020 to U+007E is
 * escaped, and a character above U+FFFF becomes the surrogate pair that UTF-16
 * encodes it with. `/` is never escaped in either form.
 */
function encodeString(value: string, ensureAscii: boolean): string {
  let out = '"';
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    const short = SHORT_ESCAPE.get(unit);
    if (short !== undefined) {
      out += short;
      continue;
    }
    if (unit < 0x20) {
      out += unicodeEscape(unit);
      continue;
    }
    if (!ensureAscii || unit < 0x7f) {
      // Below U+007F nothing more is escaped; with `ensure_ascii=False`
      // nothing above it is either, and a surrogate pair is copied through as
      // the two units it already is.
      out += value[index] as string;
      continue;
    }
    // `ensure_ascii=True` and a unit at or above U+007F. Writing the UTF-16
    // units one by one IS the surrogate-pair rule: an astral character is
    // already stored as two units here, and each becomes its own `\uXXXX`.
    out += unicodeEscape(unit);
  }
  return `${out}"`;
}

/** A number as Python's `json` writes it, or a refusal. */
function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `serialize: ${String(value)} is not a finite number; Python writes NaN/Infinity and ` +
        "JSON.stringify writes null, so the two would not agree byte for byte",
    );
  }
  if (!Number.isInteger(value)) {
    throw new TypeError(
      `serialize: ${value} is not an integer; the inventory holds integers only, and ` +
        "Python's float repr and JavaScript's differ (1.0 against 1)",
    );
  }
  return String(value);
}

/* ------------------------------------------------------------------------- *
 * The two serializers (decision D-1 of `research.md`)
 * ------------------------------------------------------------------------- */

/** What tells one serializer from the other. */
export interface SerializeOptions {
  /** Spaces of indentation; 0 (or absent) is the compact form. */
  readonly indent?: number;
  /** Sort object keys by code point, as Python's `sort_keys=True`. */
  readonly sortKeys?: boolean;
  /** Escape every character above U+007E, as Python's `ensure_ascii=True`. */
  readonly ensureAscii?: boolean;
  /**
   * Python's `separators`, where a caller needs the DEFAULT pair of
   * `json.dumps` rather than the two forms F140-FR-021 fixes. Absent, the
   * separators are Python's own for the chosen `indent`: `(",", ": ")` under
   * an indent and `(",", ":")` compact. Giving them explicitly is what the
   * entry-point SORT KEY of F140-FR-023 needs — the baseline ordered entry
   * points by `json.dumps(e, sort_keys=True)`, a call with no `separators`
   * and no `indent`, whose pair is `(", ", ": ")`.
   */
  readonly separators?: readonly [item: string, key: string];
}

/**
 * The shared core. `serializeDocument` and `serializeFingerprintInput` are the
 * two settings of it that F140-FR-021 fixes; it is exported because the lint's
 * `--json` output is a THIRD setting of the same Python call (indent 1, sorted
 * keys, and `ensure_ascii` left at its default true) — see
 * `../lint/findings.ts`.
 */
export function serializeJson(value: JsonValue, options: SerializeOptions = {}): string {
  const indent = options.indent ?? 0;
  const sortKeys = options.sortKeys ?? false;
  const ensureAscii = options.ensureAscii ?? false;
  const pad = " ".repeat(indent);
  // Python's own defaults for the chosen form, unless the caller names them.
  const [itemSeparator, keySeparator] =
    options.separators ?? (indent > 0 ? [",", ": "] : [",", ":"]);

  function walk(node: JsonValue, depth: number): string {
    if (node === null) return "null";
    if (typeof node === "boolean") return node ? "true" : "false";
    if (typeof node === "number") return encodeNumber(node);
    if (typeof node === "string") return encodeString(node, ensureAscii);

    const deeper = indent > 0 ? `\n${pad.repeat(depth + 1)}` : "";
    const closing = indent > 0 ? `\n${pad.repeat(depth)}` : "";

    if (Array.isArray(node)) {
      // Python writes an empty container as `[]` even under `indent`.
      if (node.length === 0) return "[]";
      const items = node.map((item) => walk(item as JsonValue, depth + 1));
      return `[${deeper}${items.join(`${itemSeparator}${deeper}`)}${closing}]`;
    }

    const record = node as { readonly [key: string]: JsonValue };
    const keys = Object.keys(record);
    if (keys.length === 0) return "{}";
    const ordered = sortKeys ? sortByCodePoint(keys) : keys;
    const pairs = ordered.map(
      (key) =>
        `${encodeString(key, ensureAscii)}${keySeparator}${walk(record[key] as JsonValue, depth + 1)}`,
    );
    return `{${deeper}${pairs.join(`${itemSeparator}${deeper}`)}${closing}}`;
  }

  return walk(value, 0);
}

/**
 * The DOCUMENT serializer: the inventory file as the baseline's
 * `reverse_inventory.dumps` writes it —
 * `json.dumps(inventory, sort_keys=True, indent=1, ensure_ascii=False) + "\n"`.
 *
 * Sorted keys, one space of indentation, non-ASCII characters kept as they
 * are, and a final line end. It carries no timestamp, so two runs over the
 * same tree give byte-identical files (F140-FR-021).
 */
export function serializeDocument(value: JsonValue): string {
  return `${serializeJson(value, { indent: 1, sortKeys: true, ensureAscii: false })}\n`;
}

/**
 * The FINGERPRINT serializer: the exact bytes the baseline hashes in
 * `reverse_inventory.fingerprint` —
 * `json.dumps(entries, separators=(",", ":"))` over the sorted triples
 * `(path, bytes, sha256)`.
 *
 * Compact (no space after `,` or `:`), NO trailing line end, and
 * `ensure_ascii` at its Python default TRUE, so a non-ASCII path is escaped
 * as `\uXXXX` and an astral character as a surrogate pair. Keys are NOT
 * sorted: the input is a list of lists and carries no object. Feeding a
 * document-serialized string to SHA-256 instead would change the fingerprint
 * of every source that holds a non-ASCII path.
 */
export function serializeFingerprintInput(value: JsonValue): string {
  return serializeJson(value, { indent: 0, sortKeys: false, ensureAscii: true });
}

/**
 * Python's `json.dumps(value, sort_keys=True)` with every argument at its
 * DEFAULT: compact-ish separators `(", ", ": ")`, `ensure_ascii=True`, no
 * indent, sorted keys. It is not a form the document or the fingerprint uses;
 * it is the SORT KEY the baseline ordered the inventory's entry points by
 * (F140-FR-023, `detect_manifests`), and ordering by any other string could
 * put two entry points in the other order.
 */
export function pythonJsonSortKey(value: JsonValue): string {
  return serializeJson(value, { sortKeys: true, ensureAscii: true, separators: [", ", ": "] });
}
