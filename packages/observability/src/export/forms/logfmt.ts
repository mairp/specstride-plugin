/**
 * T008 — the one logfmt encoder of the exporter (F128-FR-022).
 *
 * F128-FR-022: *The line of a Loki entry and the body of an OTLP log record
 * MUST be the same string, made by one encoder. A field whose value is null
 * MUST be omitted, a boolean MUST be `true` or `false`, a number MUST be
 * written in its shortest decimal form, a newline MUST become a space, and a
 * string that is empty or contains a space, a double quote, `=` or a
 * backslash MUST be double-quoted with the backslash and the quote escaped.
 * Nested records MUST be flattened with dotted keys.*
 *
 * Both sinks call `encodeLogfmt`; neither formats a line by itself, so the
 * two wires can never drift (D3 of the plan). The rules are the baseline's
 * `_fmt_val`/`logfmt` (Lisa's `fmtVal`/`logfmt`, characterized in
 * tests/characterization/128/reference/logfmt.json), plus the flattening of
 * nested records that the new form of a payload needs.
 */

/** One line of logfmt: `key=value` fields joined by single spaces. */
export type LogfmtFields = Record<string, unknown>;

/**
 * A scalar that can ride a logfmt field. `null` and `undefined` are omitted;
 * a plain object is flattened with dotted keys; anything else is stringified.
 */
export type LogfmtValue = string | number | boolean | null | undefined | Record<string, unknown>;

/**
 * The escaped, possibly quoted form of one value, as the specification orders
 * it. A newline (and a carriage return, as the baseline did) becomes a space
 * BEFORE the quoting decision, so no line ever breaks.
 */
export function formatValue(value: Exclude<LogfmtValue, Record<string, unknown>>): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  let s = String(value).replaceAll("\n", " ").replaceAll("\r", " ");
  if (s === "" || /[ "=\\]/.test(s)) {
    s = s.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    return `"${s}"`;
  }
  return s;
}

/**
 * Flatten nested records into dotted keys (`a.b = v`), depth first, in field
 * order. An empty nested record contributes nothing. Arrays and other
 * non-plain values are stringified as scalars of their parent key.
 */
export function flattenFields(
  fields: LogfmtFields,
  prefix = "",
  into: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(fields)) {
    const dotted = prefix === "" ? key : `${prefix}.${key}`;
    if (value === null || value === undefined) continue;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    ) {
      flattenFields(value as LogfmtFields, dotted, into);
    } else {
      into[dotted] = formatValue(value as Exclude<LogfmtValue, Record<string, unknown>>);
    }
  }
  return into;
}

/**
 * The one encoder. Null fields (and null leaves of nested records) are
 * omitted, nested records are flattened with dotted keys, and the parts are
 * joined with single spaces.
 */
export function encodeLogfmt(fields: LogfmtFields): string {
  const parts: string[] = [];
  for (const [key, encoded] of Object.entries(flattenFields(fields))) {
    parts.push(`${key}=${encoded}`);
  }
  return parts.join(" ");
}
