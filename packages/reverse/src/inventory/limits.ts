/**
 * T025 of feature 140 — the limits of the inventory and their settings
 * (F140-FR-016).
 *
 * Three numbers bound the inventory, and each of them is a setting of row 69
 * of annex X §X.7 with an as-is environment variable beside it:
 *
 * | What | Setting key | As-is variable | Default |
 * |---|---|---|---|
 * | the text of a SINGLE file | `reverse.maxFileBytes` | `SPECSTRIDE_REVERSE_MAX_FILE_BYTES` | 1048576 |
 * | the TOTAL text | `reverse.maxTotalBytes` | `SPECSTRIDE_REVERSE_MAX_TOTAL_BYTES` | 20971520 |
 * | the summary, in CHARACTERS | `reverse.contextBudget` | `SPECSTRIDE_CONTEXT_BUDGET` | 24000 |
 *
 * `SPECSTRIDE_CONTEXT_BUDGET` is the one variable of the alias table of annex
 * X §X.8 that feeds TWO keys, `spec.contextBudget` and
 * `reverse.contextBudget`; this module reads it for the second.
 *
 * Why the variables are read HERE and not through `@specstride/config`:
 * `@specstride/reverse` is layer L6 and may import `@specstride/contracts`,
 * `@specstride/kernel` and `@specstride/spec-formats` and nothing else, so the
 * settings reader is out of reach. The keys above are therefore recorded as
 * data (`SETTINGS`) and the environment is read directly, exactly as the
 * baseline's `_env_int` did at `9cab15d`.
 *
 * The legacy-prefixed variable of the as-is `specstride_env.get` is NOT read
 * (divergence DV-036): only the `SPECSTRIDE_` name above is consulted.
 *
 * An unset or empty value means the default. Any other value that is not a
 * positive integer fails with `<NAME> must be a positive integer (got '<v>')`
 * and exit 3 — never a silent fallback, because a mistyped limit would
 * silently change which files are skipped and so change the fingerprint.
 */

/** The text of a single file, in bytes, by default (F140-FR-016). */
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

/** The total text, in bytes, by default (F140-FR-016). */
export const DEFAULT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/** The summary, in CHARACTERS, by default (F140-FR-016). */
export const DEFAULT_CONTEXT_BUDGET = 24000;

/**
 * The window a file is sniffed through for a NUL byte, in bytes
 * (F140-FR-016: "The sniff window MUST be 8192 bytes"). It is also the window
 * the language rule reads a shebang from (F140-FR-019).
 */
export const SNIFF_BYTES = 8192;

/** The size of one read of a file's content, in bytes (F140-FR-019). */
export const READ_CHUNK_BYTES = 64 * 1024;

/** One limit: its setting key, its as-is variable and its default. */
export type LimitSetting = {
  /** The key of row 69 of annex X §X.7. */
  readonly key: string;
  /** The as-is environment variable the alias table maps to that key. */
  readonly variable: string;
  /** The value where the variable is unset or empty. */
  readonly fallback: number;
  /** The unit, for a message and for a reader of this table. */
  readonly unit: "bytes" | "characters";
};

/** The three limits of the inventory, as data (F140-FR-016, annex X §X.7). */
export const SETTINGS: Readonly<
  Record<"maxFileBytes" | "maxTotalBytes" | "contextBudget", LimitSetting>
> = Object.freeze({
  maxFileBytes: Object.freeze({
    key: "reverse.maxFileBytes",
    variable: "SPECSTRIDE_REVERSE_MAX_FILE_BYTES",
    fallback: DEFAULT_MAX_FILE_BYTES,
    unit: "bytes" as const,
  }),
  maxTotalBytes: Object.freeze({
    key: "reverse.maxTotalBytes",
    variable: "SPECSTRIDE_REVERSE_MAX_TOTAL_BYTES",
    fallback: DEFAULT_MAX_TOTAL_BYTES,
    unit: "bytes" as const,
  }),
  contextBudget: Object.freeze({
    key: "reverse.contextBudget",
    variable: "SPECSTRIDE_CONTEXT_BUDGET",
    fallback: DEFAULT_CONTEXT_BUDGET,
    unit: "characters" as const,
  }),
});

/**
 * Invalid input to the inventory: exit 3 and `reverse-inventory: <message>` on
 * standard error (F140-FR-001). The baseline's `InventoryError`.
 */
export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

/**
 * A string as Python's `%r` writes it, because the message of F140-FR-016 is
 * `(got '<v>')` — the baseline interpolated `repr(raw)`. Python prefers single
 * quotes and switches to double quotes only when the value holds a single
 * quote and no double quote.
 */
export function pythonRepr(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = quote;
  for (const character of value) {
    if (character === "\\") out += "\\\\";
    else if (character === quote) out += `\\${quote}`;
    else if (character === "\n") out += "\\n";
    else if (character === "\r") out += "\\r";
    else if (character === "\t") out += "\\t";
    else {
      const code = character.codePointAt(0) as number;
      if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, "0")}`;
      else out += character;
    }
  }
  return out + quote;
}

/**
 * Python's `int(str)`, as the baseline's `_env_int` called it: optional
 * surrounding whitespace, an optional sign, decimal digits, and a single
 * underscore allowed BETWEEN digits (`"1_000"` is 1000). `undefined` where the
 * text is not such an integer — `"0x10"`, `"1.0"`, `"  "` and `"1__0"` are not.
 */
export function pythonInt(raw: string): number | undefined {
  const text = raw.trim();
  if (!/^[+-]?\d(?:_?\d)*$/.test(text)) return undefined;
  const value = Number.parseInt(text.replace(/_/g, ""), 10);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * One limit out of an environment, with the positive-integer refusal of
 * F140-FR-016. An unset or empty value is the default; anything else must be
 * an integer strictly above zero.
 */
export function limitFrom(
  setting: LimitSetting,
  environ: Readonly<Record<string, string | undefined>>,
): number {
  const raw = environ[setting.variable];
  if (raw === undefined || raw === "") return setting.fallback;
  const value = pythonInt(raw);
  if (value === undefined || value <= 0) {
    throw new InventoryError(
      `${setting.variable} must be a positive integer (got ${pythonRepr(raw)})`,
    );
  }
  return value;
}

/** The two limits the inventory document records under `limits`. */
export type Limits = {
  readonly max_file_bytes: number;
  readonly max_total_bytes: number;
};

/** The two size limits out of an environment (F140-FR-016, F140-FR-021). */
export function limitsOf(environ: Readonly<Record<string, string | undefined>>): Limits {
  return Object.freeze({
    max_file_bytes: limitFrom(SETTINGS.maxFileBytes, environ),
    max_total_bytes: limitFrom(SETTINGS.maxTotalBytes, environ),
  });
}

/**
 * The size of the summary in CHARACTERS (F140-FR-016). A non-positive or
 * non-integer value fails with exit 3, like the two size limits.
 */
export function contextBudgetOf(environ: Readonly<Record<string, string | undefined>>): number {
  return limitFrom(SETTINGS.contextBudget, environ);
}
