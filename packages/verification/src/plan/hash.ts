/**
 * T087 — the ids and the hashes of the verification plan (F105-FR-011).
 *
 * Every hash and every id of F105-FR-011 and F105-FR-012 is computed with the
 * operation **content hash of a text** of the canonical hasher (feature 100,
 * annex X §X.5, F100-FR-207) over the CANONICAL RECORD TEXT: sorted keys,
 * compact separators, non-ASCII characters kept, and NO FINAL LINE END. The
 * operation `canonicalRecordHash` of that annex adds one line end before it
 * hashes and therefore gives ANOTHER value over the same record; this module
 * never calls it, and `PLAN_RECORD_HASH_FORM` below records which of the two
 * forms the baseline hashes, as F100-FR-207 makes a porting feature do.
 *
 * The canonical record text is the hasher's, not this feature's: no feature
 * builds a record text of its own (F100-FR-207,
 * `A_FEATURE_BUILDS_ITS_OWN_RECORD_TEXT === false`). `canonicalJson` below is
 * the hasher's `canonicalRecordText` under the baseline's name, so a reader of
 * `lib/verification_plan.py` at `9cab15d` finds the same word.
 */
import { canonicalRecordText, contentHash as hasherContentHash } from "@specstride/kernel/hasher";
import {
  BASELINE_RECORD_HASH_FORMS,
  LINE_END_OF_THE_CANONICAL_RECORD_HASH,
  type RecordHashForm,
} from "@specstride/contracts/ep/hasher";

/**
 * Which of the two record-hash forms of §X.5 the verification plan of the
 * Specstride baseline hashes: the canonical record text AS IT IS, with no
 * final line end (F100-FR-207, `BASELINE_RECORD_HASH_FORMS`).
 */
export const PLAN_RECORD_HASH_FORM: RecordHashForm =
  BASELINE_RECORD_HASH_FORMS["verification-plan"] ?? "canonical-record-text";

/** The canonical record hash MUST NOT be used for a hash of F105-FR-011. */
export const THE_CANONICAL_RECORD_HASH_IS_USED = false as const;

/**
 * Why not: on the same record the two forms give two values, because one adds
 * a line end before it hashes, and the fixtures compare the baseline's value
 * unchanged (rule "Hash, same class" of the normalization contract).
 */
export const LINE_END_THE_OTHER_FORM_ADDS = LINE_END_OF_THE_CANONICAL_RECORD_HASH;

/**
 * The baseline's `canonical_json` (`lib/verification_plan.py`:79): the
 * canonical record text of the hasher, which is
 * `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)`.
 */
export function canonicalJson(value: unknown): string {
  return canonicalRecordText(value);
}

/** The baseline's `sha256_bytes` (:83). */
export function sha256Bytes(value: Uint8Array): string {
  return hasherContentHash(value);
}

/** The baseline's `sha256_text` (:87): the content hash of a text as UTF-8. */
export function sha256Text(value: string): string {
  return hasherContentHash(value);
}

/** The content hash of a record, over the text form of F105-FR-011. */
export function recordContentHash(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

/** The number of hexadecimal characters a `VO-` or `CMD-` id carries. */
export const ID_HEX_LENGTH = 20 as const;

/** The baseline's `stable_id` (:91): `<prefix>-` and 20 hexadecimal characters. */
export function stableId(prefix: string, seed: string): string {
  return `${prefix}-${sha256Text(seed).slice(0, ID_HEX_LENGTH)}`;
}

/** The prefix of a verification obligation id (F105-FR-011). */
export const OBLIGATION_ID_PREFIX = "VO" as const;
/** The prefix of a command id (F105-FR-011). */
export const COMMAND_ID_PREFIX = "CMD" as const;
/** The prefix of the id of the plan itself (`lib/verification_plan.py`:988). */
export const PLAN_ID_PREFIX = "verification" as const;

/**
 * The id of a verification obligation: over the id of the spec bundle, the
 * phase, the index and the TEXT OF THE CRITERION (F105-FR-011).
 */
export function obligationId(input: {
  readonly bundleId: string;
  readonly phase: number;
  readonly index: number;
  readonly criterion: string;
}): string {
  return stableId(
    OBLIGATION_ID_PREFIX,
    `${input.bundleId}:${input.phase}:${input.index}:${input.criterion}`,
  );
}

/** The number of characters of `source.bundleId` (F105-FR-011). */
export const BUNDLE_ID_LENGTH = 26 as const;

/** The alphabet of the baseline's `deterministic_ulid` (:95). */
export const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" as const;

/**
 * The baseline's `deterministic_ulid` (:95): 26 characters of the ULID
 * alphabet from the first 32 hexadecimal characters of the hash of the seed,
 * five bits at a time, the LAST character of the produced order forced to `0`
 * so that the first character of the reversed id stays in the range a ULID
 * timestamp may hold.
 *
 * The baseline shifts a Python integer of 128 bits, so the port uses `BigInt`
 * and not a number: a `number` loses bits above 2^53 and would give another
 * id.
 */
export function deterministicUlid(seed: string): string {
  let value = BigInt(`0x${sha256Text(seed).slice(0, 32)}`);
  const characters: string[] = [];
  for (let index = 0; index < BUNDLE_ID_LENGTH; index += 1) {
    characters.push(ULID_ALPHABET[Number(value & 31n)]!);
    value >>= 5n;
  }
  characters[characters.length - 1] = "0";
  return characters.reverse().join("");
}

/**
 * `source.bundleId` (F105-FR-011): a deterministic id of 26 characters over
 * the place of the spec, its format and its hash
 * (`lib/verification_plan.py`:787).
 */
export function bundleIdOf(input: {
  readonly specPath: string;
  readonly format: string;
  readonly specHash: string;
}): string {
  return deterministicUlid(`${input.specPath}:${input.format}:${input.specHash}`);
}

/**
 * The id of the plan (`lib/verification_plan.py`:988): over the bundle id, the
 * hash of the spec, the fingerprint of the project and the content hash of the
 * verification-commands document, which is the empty text where none was
 * given.
 */
export function planIdOf(input: {
  readonly bundleId: string;
  readonly specHash: string;
  readonly fingerprint: string;
  readonly declaredCommandsHash?: string | undefined;
}): string {
  return stableId(
    PLAN_ID_PREFIX,
    `${input.bundleId}:${input.specHash}:${input.fingerprint}:${input.declaredCommandsHash ?? ""}`,
  );
}

/**
 * `contentHash` of the plan (F105-FR-011): the hash of the plan WITHOUT that
 * field, over the text form above.
 */
export function planContentHash(planWithoutItsHash: Readonly<Record<string, unknown>>): string {
  const semantic: Record<string, unknown> = { ...planWithoutItsHash };
  delete semantic["contentHash"];
  return recordContentHash(semantic);
}

/** The files of a toolchain the fingerprint of the project is taken over. */
export type FingerprintEntry = { readonly path: string; readonly sha256: string };

/**
 * `project.fingerprint` (F105-FR-011): a hash over the working directory and
 * the content hashes of the root files of the toolchains
 * (`lib/verification_plan.py`:545, over `_project_files`).
 */
export function projectFingerprint(workdir: string, entries: readonly FingerprintEntry[]): string {
  return recordContentHash({ workdir, entries: entries.map((e) => ({ ...e })) });
}

/* ------------------------------------------------------------------ *
 * The baseline's OTHER text form of a value: `json.dumps` with its
 * DEFAULTS.
 * ------------------------------------------------------------------ */

/**
 * The baseline writes a value with `json.dumps` in three places where the text
 * is NOT the canonical record text, and in each the text is part of behaviour:
 *
 *  - the SEED of a command id (`lib/verification_plan.py`:185 and :352), which
 *    holds `json.dumps(args)`;
 *  - the QUOTATION of a part of a command line that holds a space (`:1250`);
 *  - the test scaffolds and the list of the scaffolds (`:1437`, `:1512`).
 *
 * `json.dumps` with its DEFAULTS differs from the canonical record text in two
 * ways that change the bytes: its separators are `", "` and `": "`, and
 * `ensure_ascii` is TRUE, so every character above U+007F is escaped. A port
 * that used `JSON.stringify` here would write another command id and another
 * scaffold, so the form is written out.
 */
export type PythonJsonOptions = {
  /** Spaces of indentation; without it the one-line form with `", "`. */
  readonly indent?: number | undefined;
  /** `sort_keys=True` of the baseline. */
  readonly sortKeys?: boolean | undefined;
  /** `ensure_ascii`; the baseline leaves it at its default, TRUE. */
  readonly ensureAscii?: boolean | undefined;
};

/** A text as `json.dumps` writes it, with `ensure_ascii` as the caller says. */
export function pythonJsonString(value: string, ensureAscii = true): string {
  const out: string[] = ['"'];
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (character === '"') out.push('\\"');
    else if (character === "\\") out.push("\\\\");
    else if (character === "\n") out.push("\\n");
    else if (character === "\r") out.push("\\r");
    else if (character === "\t") out.push("\\t");
    else if (character === "\b") out.push("\\b");
    else if (character === "\f") out.push("\\f");
    else if (code < 0x20) out.push(`\\u${code.toString(16).padStart(4, "0")}`);
    else if (code < 0x7f) out.push(character);
    else if (!ensureAscii) out.push(character);
    else if (code <= 0xffff) out.push(`\\u${code.toString(16).padStart(4, "0")}`);
    else {
      // A character above the basic plane becomes its two surrogates, as
      // Python's `ensure_ascii` writes it.
      const rest = code - 0x10000;
      const high = 0xd800 + (rest >> 10);
      const low = 0xdc00 + (rest & 0x3ff);
      out.push(`\\u${high.toString(16).padStart(4, "0")}\\u${low.toString(16).padStart(4, "0")}`);
    }
  }
  out.push('"');
  return out.join("");
}

/** A value as `json.dumps` writes it (`lib/verification_plan.py`, see above). */
export function pythonJson(value: unknown, options: PythonJsonOptions = {}): string {
  const indent = options.indent;
  const ensureAscii = options.ensureAscii ?? true;
  const sortKeys = options.sortKeys ?? false;
  const write = (one: unknown, depth: number): string => {
    if (one === null || one === undefined) return "null";
    if (typeof one === "string") return pythonJsonString(one, ensureAscii);
    if (typeof one === "number") return Number.isInteger(one) ? String(one) : JSON.stringify(one);
    if (typeof one === "boolean") return one ? "true" : "false";
    const pad = indent === undefined ? "" : "\n" + " ".repeat(indent * (depth + 1));
    const closePad = indent === undefined ? "" : "\n" + " ".repeat(indent * depth);
    const itemSeparator = indent === undefined ? ", " : `,${pad}`;
    if (Array.isArray(one)) {
      if (one.length === 0) return "[]";
      return `[${pad}${one.map((item) => write(item, depth + 1)).join(itemSeparator)}${closePad}]`;
    }
    const entries = Object.entries(one as Record<string, unknown>).filter(
      ([, item]) => item !== undefined,
    );
    if (sortKeys) entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    if (entries.length === 0) return "{}";
    const body = entries
      .map(([key, item]) => `${pythonJsonString(key, ensureAscii)}: ${write(item, depth + 1)}`)
      .join(itemSeparator);
    return `{${pad}${body}${closePad}}`;
  };
  return write(value, 0);
}

/** The seed of the id of a command (`lib/verification_plan.py`:185). */
export function commandSeed(input: {
  readonly kind: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly workdir: string;
}): string {
  return `${input.kind}:${input.executable}:${pythonJson([...input.args])}:${input.workdir}`;
}
