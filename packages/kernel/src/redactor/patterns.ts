/**
 * T042 — the widened pattern set as versioned data, and its loader
 * (F111-FR-024, F111-FR-029).
 *
 * F111-FR-029: *The pattern set of the redactor MUST be wider than the
 * baseline's and MUST contain it. It MUST be versioned data with the fields of
 * annex X §X.4. Key names MUST match as a suffix or a substring (`*_token`,
 * `*_key`, `*_secret`, `*password*`). Value patterns MUST cover private-key
 * blocks, signed tokens, access key ids of clouds, addresses with embedded
 * credentials and the prefixes of provider keys. The version of the set MUST be
 * recorded in the run record and MUST change with every change of the set. On
 * the fixtures of the oracle, no text MUST match a pattern that the baseline set
 * does not match.*
 *
 * THE SET IS DATA AND THE VERSION IS DERIVED FROM IT. "The version must change
 * with every change of the set" is the one clause here that a comment cannot
 * keep: a person who edits a pattern and forgets the version would leave two
 * different sets wearing one name, and every run record written under the old
 * name would then be wrong about what redacted it. So the version is not a
 * number someone remembers to raise — it CARRIES a digest of the two pattern
 * lists, and the loader REFUSES a set whose digest does not match its version
 * (`pattern-set-invalid`, row 90). Changing a pattern without changing the
 * version makes the set unloadable, which is the fail-closed behaviour of
 * F111-FR-024 rather than a silent mismatch.
 *
 * TWO FILES, AND CONTAINMENT IS CHECKED AND NOT CLAIMED. `baseline-v1.json`
 * holds exactly the rules of `lib/observability_policy.py` at `9cab15d` — the
 * eleven key names and the four value patterns — and `widened-v1.json` holds
 * those FIFTEEN ENTRIES UNCHANGED plus the wider ones.
 * `widenedContainsBaseline` compares them entry by entry, so the baseline is
 * contained by construction and by test, and `widenedOnlyPatterns` is the
 * difference, which is what the claim about the oracle's fixtures is tested
 * against.
 *
 * The loader reads FILES. `@specstride/kernel` is neither `core` nor `edge` in
 * the package graph and already reaches `node:fs` for the atomic write, so the
 * set can be data on disk that a test can replace and read back, rather than a
 * literal compiled into the bundle.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCHEMA_ID,
  VALUE_PATTERNS_COVER,
  isRedactionPatternSet,
  type RedactionPatternSet,
} from "@specstride/contracts/ep/redactor";
import { DROP_MARKS, type DropMark } from "./marks.ts";

/** The directory of the package: three levels up from `src/redactor`. */
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Where the versioned pattern sets live. */
export const PATTERNS_DIR = join(PACKAGE_ROOT, "data", "patterns");

/** The set of the baseline: the eleven key names and the four value patterns. */
export const BASELINE_SET_FILE = join(PATTERNS_DIR, "baseline-v1.json");

/** The widened set: the baseline's fifteen entries and the wider ones. */
export const WIDENED_SET_FILE = join(PATTERNS_DIR, "widened-v1.json");

/** How a key-name pattern is matched against a key (F111-FR-029). */
export const KEY_MATCH_KINDS = ["exact", "suffix", "substring"] as const;
export type KeyMatchKind = (typeof KEY_MATCH_KINDS)[number];

/** The four wider forms of key name F111-FR-029 names by hand. */
export const WIDENED_KEY_FORMS = ["*_token", "*_key", "*_secret", "*password*"] as const;

/** The five classes a value pattern must cover (annex X §X.4). */
export const VALUE_CLASSES = VALUE_PATTERNS_COVER;

/** One pattern of a set: a name, a regular expression and its flags. */
export type PatternEntry = {
  /** The name the record of a hit carries. Never the match itself. */
  readonly name: string;
  /** The source of the regular expression. */
  readonly pattern: string;
  /** Its flags, without `g`: the caller adds `g` where it needs every match. */
  readonly flags: string;
  /** How a key name is matched. Absent on a value pattern. */
  readonly match?: KeyMatchKind;
  /** Which class of §X.4 a value pattern covers. Absent on a key name. */
  readonly covers?: string;
};

/** A set that was read and whose version matches its content. */
export type LoadedPatternSet = {
  readonly set: RedactionPatternSet;
  readonly version: string;
  readonly keyNames: readonly PatternEntry[];
  readonly values: readonly PatternEntry[];
};

/** Why a set could not be loaded. The mark is a member of row 90. */
export type PatternSetRefusal = {
  readonly ok: false;
  readonly mark: DropMark;
  readonly reason: string;
};

/** What the loader returns. */
export type PatternSetResult =
  { readonly ok: true; readonly loaded: LoadedPatternSet } | PatternSetRefusal;

/** The mark a set that cannot be loaded carries (row 90). */
export const INVALID_SET_MARK: DropMark = DROP_MARKS[1];

/** The separator between the family of a version and its digest. */
export const VERSION_DIGEST_SEPARATOR = "+" as const;

/** How many hexadecimal characters of the digest the version carries. */
export const VERSION_DIGEST_LENGTH = 16;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The digest of the two pattern lists of a set: what the version carries, so
 * that a change of one pattern cannot keep the version (F111-FR-029).
 */
export function patternSetDigest(set: { keyNames: unknown; values: unknown }): string {
  const canonical = stable({ keyNames: set.keyNames, values: set.values });
  return createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex")
    .slice(0, VERSION_DIGEST_LENGTH);
}

/** The family of a version: everything before the digest. */
export function versionFamilyOf(version: string): string {
  const at = version.lastIndexOf(VERSION_DIGEST_SEPARATOR);
  return at === -1 ? version : version.slice(0, at);
}

/**
 * The version a set MUST carry: its family and the digest of its content. A
 * set whose `version` differs from this is refused.
 */
export function expectedVersionOf(set: {
  version?: unknown;
  keyNames: unknown;
  values: unknown;
}): string {
  const family = versionFamilyOf(typeof set.version === "string" ? set.version : "");
  return `${family}${VERSION_DIGEST_SEPARATOR}${patternSetDigest(set)}`;
}

function entriesOf(list: unknown, where: string): readonly PatternEntry[] | string {
  if (!Array.isArray(list)) return `${where} is not a list`;
  const out: PatternEntry[] = [];
  for (const [index, raw] of list.entries()) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return `${where}[${index}] is not a pattern`;
    }
    const entry = raw as Record<string, unknown>;
    const { name, pattern, flags } = entry;
    if (typeof name !== "string" || name.length === 0) return `${where}[${index}] has no name`;
    if (typeof pattern !== "string" || pattern.length === 0) {
      return `${where}[${index}] (${name}) has no pattern`;
    }
    if (flags !== undefined && typeof flags !== "string") {
      return `${where}[${index}] (${name}) has flags that are not text`;
    }
    const resolved = typeof flags === "string" ? flags : "";
    try {
      new RegExp(pattern, resolved);
    } catch (error) {
      return `${where}[${index}] (${name}) is no regular expression: ${String(error)}`;
    }
    const match = entry["match"];
    const covers = entry["covers"];
    out.push(
      Object.freeze({
        name,
        pattern,
        flags: resolved,
        ...(typeof match === "string" ? { match: match as KeyMatchKind } : {}),
        ...(typeof covers === "string" ? { covers } : {}),
      }),
    );
  }
  return Object.freeze(out);
}

/**
 * Load a set from a value: the fields of §X.4, every pattern a usable regular
 * expression, and the version equal to the digest of the content. Anything else
 * is refused with the mark `pattern-set-invalid` (F111-FR-024).
 */
export function loadPatternSetFrom(value: unknown): PatternSetResult {
  if (!isRedactionPatternSet(value)) {
    return Object.freeze({
      ok: false as const,
      mark: INVALID_SET_MARK,
      reason: `the set does not validate against ${SCHEMA_ID} (annex X §X.4)`,
    });
  }
  const set = value as RedactionPatternSet;
  const keyNames = entriesOf(set.keyNames, "keyNames");
  if (typeof keyNames === "string") {
    return Object.freeze({ ok: false as const, mark: INVALID_SET_MARK, reason: keyNames });
  }
  const values = entriesOf(set.values, "values");
  if (typeof values === "string") {
    return Object.freeze({ ok: false as const, mark: INVALID_SET_MARK, reason: values });
  }
  const expected = expectedVersionOf(
    set as unknown as { version: unknown; keyNames: unknown; values: unknown },
  );
  if (set.version !== expected) {
    return Object.freeze({
      ok: false as const,
      mark: INVALID_SET_MARK,
      reason:
        `the version \`${String(set.version)}\` is not the version of this content ` +
        `(\`${expected}\`): the version of the set changes with every change of the set ` +
        `(F111-FR-029)`,
    });
  }
  return Object.freeze({
    ok: true as const,
    loaded: Object.freeze({ set, version: set.version, keyNames, values }),
  });
}

/** Read a set from a file, and refuse what cannot be read or parsed. */
export function readPatternSetFile(file: string): PatternSetResult {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return Object.freeze({
      ok: false as const,
      mark: INVALID_SET_MARK,
      reason: `the set at ${file} cannot be read: ${String(error)}`,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return Object.freeze({
      ok: false as const,
      mark: INVALID_SET_MARK,
      reason: `the set at ${file} is no JSON: ${String(error)}`,
    });
  }
  return loadPatternSetFrom(parsed);
}

/** The baseline set, from `data/patterns/baseline-v1.json`. */
export function loadBaselinePatternSet(file: string = BASELINE_SET_FILE): PatternSetResult {
  return readPatternSetFile(file);
}

/** The widened set, from `data/patterns/widened-v1.json`: the one in force. */
export function loadWidenedPatternSet(file: string = WIDENED_SET_FILE): PatternSetResult {
  return readPatternSetFile(file);
}

/** The version of a loaded set: what the run record records (§X.4). */
export function patternSetVersionOf(loaded: LoadedPatternSet): string {
  return loaded.version;
}

function key(entry: PatternEntry): string {
  return `${entry.name}\u0000${entry.pattern}\u0000${entry.flags}`;
}

/**
 * Whether the widened set contains the baseline's, entry by entry, and which
 * entries of the baseline are missing from it (F111-FR-029).
 */
export function widenedContainsBaseline(
  baselineFile: string = BASELINE_SET_FILE,
  widenedFile: string = WIDENED_SET_FILE,
): { readonly contains: boolean; readonly missing: readonly string[] } {
  const baseline = loadBaselinePatternSet(baselineFile);
  const widened = loadWidenedPatternSet(widenedFile);
  if (!baseline.ok || !widened.ok) {
    return Object.freeze({
      contains: false,
      missing: Object.freeze([
        `a set could not be loaded: ${!baseline.ok ? baseline.reason : ""}${!widened.ok ? widened.reason : ""}`,
      ]),
    });
  }
  const held = new Set([...widened.loaded.keyNames, ...widened.loaded.values].map(key));
  const missing = [...baseline.loaded.keyNames, ...baseline.loaded.values]
    .filter((entry) => !held.has(key(entry)))
    .map(
      (entry) => `${entry.name} (${entry.pattern}) is in the baseline and not in the widened set`,
    );
  return Object.freeze({ contains: missing.length === 0, missing: Object.freeze(missing) });
}

/**
 * The VALUE patterns the widened set has and the baseline's does not: the
 * patterns the claim "no text matches a pattern that the baseline set does not
 * match" is tested against.
 *
 * Key-name patterns are not here. They match the KEY of a field of a structure
 * and never free text, so a text cannot match one, and the wider key forms
 * (`*password*` among them) would match the prose of this very requirement.
 */
export function widenedOnlyPatterns(
  baselineFile: string = BASELINE_SET_FILE,
  widenedFile: string = WIDENED_SET_FILE,
): readonly PatternEntry[] {
  const baseline = loadBaselinePatternSet(baselineFile);
  const widened = loadWidenedPatternSet(widenedFile);
  if (!baseline.ok || !widened.ok) return Object.freeze([]);
  const held = new Set(baseline.loaded.values.map(key));
  return Object.freeze(widened.loaded.values.filter((entry) => !held.has(key(entry))));
}

/** The KEY-NAME patterns the widened set has and the baseline's does not. */
export function widenedOnlyKeyNames(
  baselineFile: string = BASELINE_SET_FILE,
  widenedFile: string = WIDENED_SET_FILE,
): readonly PatternEntry[] {
  const baseline = loadBaselinePatternSet(baselineFile);
  const widened = loadWidenedPatternSet(widenedFile);
  if (!baseline.ok || !widened.ok) return Object.freeze([]);
  const held = new Set(baseline.loaded.keyNames.map(key));
  return Object.freeze(widened.loaded.keyNames.filter((entry) => !held.has(key(entry))));
}

/** One compiled pattern, with `g` added where every match is wanted. */
export function compilePattern(entry: PatternEntry, everyMatch = false): RegExp {
  const flags = entry.flags.replace(/g/g, "");
  return new RegExp(entry.pattern, everyMatch ? `${flags}g` : flags);
}
