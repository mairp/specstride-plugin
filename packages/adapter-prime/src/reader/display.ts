/**
 * The diagnostics and the display lines of the JSONL reader (T037; covers
 * F138-FR-036, and the byte caps of the diagnostics contract).
 *
 * Every diagnostic carries the code, the severity, the message redacted and
 * cut to 1,024 bytes, the record type of the raw stream, the redaction
 * metadata and the extras of its code, with null values dropped; it also
 * gives the display line `  ! <code>: <message>`. Content-bearing records cut
 * to their own caps: text 4,096 bytes, a tool summary 2,048, a progress
 * message 1,024, a tool result 4,096, at most 8 targets. Every value passes
 * the one redactor of annex X §X.4 before any cap is applied to it.
 */
import type { SpecstrideRedactor } from "@specstride/kernel/redactor/redactor";
import { REDACTED } from "@specstride/kernel/redactor/rules";
import type { DialectRow } from "./dialect.ts";
import type { RedactionMetadata } from "./records.ts";

/**
 * The redactor port of the reader: one point of redaction (F100-FR-205). The
 * composition root hands it in, as the harness tap takes its port (feature
 * 111 owns the redaction); a reader built without one still cuts to the caps,
 * and marks nothing as redacted.
 */
export type ReaderRedactor = Pick<SpecstrideRedactor, "redact" | "register">;

/** The caps of the diagnostics contract (`contracts/diagnostics.json`). */
export const READER_CAPS = {
  text: 4096,
  toolSummary: 2048,
  progress: 1024,
  toolResult: 4096,
  diagnosticMessage: 1024,
  targets: 8,
} as const;

/** The cap of one target path, as the baseline policy holds it. */
export const TARGET_MAX_BYTES = 512;

/** The UTF-8 byte length of one text. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Cut a text to a byte length without splitting a code point. */
export function cutToByteCap(text: string, cap: number): { text: string; truncated: boolean } {
  if (byteLength(text) <= cap) return { text, truncated: false };
  let cut = text;
  while (byteLength(cut) > cap) cut = cut.slice(0, -1);
  return { text: cut, truncated: true };
}

/** What a sanitized value carries, as the baseline policy returns it. */
export type Sanitized = RedactionMetadata & { value: string };

/** Redact and cut one text; the metadata travels with the record. */
export function sanitizeText(
  value: unknown,
  cap: number,
  redactor: ReaderRedactor | null,
): Sanitized {
  const raw = String(value ?? "");
  if (redactor === null) {
    const cut = cutToByteCap(raw, cap);
    return {
      value: cut.text,
      redacted: false,
      truncated: cut.truncated,
      originalBytes: byteLength(raw),
      retainedBytes: byteLength(cut.text),
    };
  }
  const originalBytes = byteLength(raw);
  const result = redactor.redact(raw, cap + 1);
  const redacted = result.dropped === true || result.replacements > 0;
  const text = result.dropped === true ? "" : result.text;
  const cut = cutToByteCap(text, cap);
  return {
    value: cut.text,
    redacted,
    truncated: cut.truncated,
    originalBytes,
    retainedBytes: byteLength(cut.text),
  };
}

/** The keys a recursive clean drops whole, as the baseline policy holds them. */
const THINKING_KEYS = new Set(["thinking", "reasoning", "chain_of_thought", "chainofthought"]);

/** The keys whose value is replaced whole. */
const SECRET_KEY =
  /^(?:api_key|apikey|authorization|cookie|credential|password|secret|token|access_token|refresh_token|client_secret)$/i;

/** Stable JSON rendering: keys sorted, exactly as the baseline renders it. */
function stableJson(value: unknown): string {
  const sorted = JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => {
      if (Array.isArray(item) || item === null || typeof item !== "object") return item;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(item as Record<string, unknown>).sort()) {
        out[key] = (item as Record<string, unknown>)[key];
      }
      return out;
    }),
  );
  return stringifySpaced(sorted);
}

/** JSON with the baseline's separators: a space after each comma and colon. */
function stringifySpaced(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stringifySpaced).join(", ")}]`;
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, item]) => `${JSON.stringify(key)}: ${stringifySpaced(item)}`,
  );
  return `{${entries.join(", ")}}`;
}

/** Recursively drop thinking, redact secret keys and every string value. */
export function sanitizeValue(
  value: unknown,
  cap: number,
  redactor: ReaderRedactor | null,
): Sanitized {
  let redacted = false;
  function clean(item: unknown): unknown {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
        if (THINKING_KEYS.has(key.toLowerCase())) {
          redacted = true;
          continue;
        }
        if (SECRET_KEY.test(key)) {
          result[key] = REDACTED;
          redacted = true;
        } else {
          result[key] = clean(child);
        }
      }
      return result;
    }
    if (Array.isArray(item)) return item.map(clean);
    if (typeof item === "string") {
      const safe = sanitizeText(item, Number.MAX_SAFE_INTEGER, redactor);
      if (safe.redacted) redacted = true;
      return safe.value;
    }
    return item;
  }
  const originalBytes = byteLength(stableJson(value));
  const rendered = stableJson(clean(value));
  const cut = cutToByteCap(rendered, cap);
  return {
    value: cut.text,
    redacted,
    truncated: cut.truncated,
    originalBytes,
    retainedBytes: byteLength(cut.text),
  };
}

/** Drop the null-valued fields of a record, as the baseline cleans fields. */
export function cleanFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/** The provider-format literal of the row, which names the init display line. */
export function providerFormatOf(row: DialectRow): string {
  return row.providerFormat;
}

/** The display line of an `init` record (F138-FR-027). */
export function displayLineForInit(row: DialectRow, sessionId: string | null): string {
  return `  · init ${providerFormatOf(row)} session=${sessionId ?? "?"}`;
}

/** The display line of a tool start (F138-FR-029). */
export function displayLineForToolStart(name: string, summary: string): string {
  return `  → ${name} ${summary}`;
}

/** The display line of a tool end (F138-FR-029). */
export function displayLineForToolEnd(name: string, isError: boolean): string {
  return `  ← ${name} ${isError ? "error" : "done"}`;
}

/** The display line of a diagnostic (F138-FR-036). */
export function displayLineForDiagnostic(code: string, message: string): string {
  return `  ! ${code}: ${message}`;
}
