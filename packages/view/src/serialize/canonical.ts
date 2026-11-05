/**
 * T023 — the canonical serialization of a view (F129-FR-006, F129-FR-007).
 *
 * A stable order of keys, ONE record, no colour escape sequence, no wall-clock
 * field other than `now`, and no secret value, account identifier or token. Two
 * projections of the same inputs are equal byte for byte, on every platform:
 * the order of keys is the code-unit order of the key, which no locale and no
 * operating system changes; a number is written in the one form JSON gives it;
 * and no separator, line end or path of the host appears.
 */

/** The order of keys: by code unit, so that no locale can change it. */
function sortedKeys(record: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function number(value: number): string {
  if (!Number.isFinite(value)) return "null";
  if (Object.is(value, -0)) return "0";
  return JSON.stringify(value);
}

/** The canonical text of any value of a view: one line, no space, keys sorted. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return number(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    const parts: string[] = [];
    for (const key of sortedKeys(record)) {
      const entry = record[key];
      if (entry === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return "null";
}

/** True where the text holds an escape sequence or any other control character. */
export function hasEscapeSequence(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
