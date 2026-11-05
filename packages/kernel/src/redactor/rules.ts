/**
 * T040 — the redactor with the baseline rules (F111-FR-025).
 *
 * F111-FR-025: *The redaction of the baseline MUST be kept. The placeholder MUST
 * be `[REDACTED]`. The keys `thinking`, `reasoning`, `chain_of_thought` and
 * `chainofthought`, in any case, MUST be dropped and counted as a redaction. The
 * value of a key equal, in any case, to `api_key`, `apikey`, `authorization`,
 * `cookie`, `credential`, `password`, `secret`, `token`, `access_token`,
 * `refresh_token` or `client_secret` MUST be replaced. In any text, `bearer` with
 * 8 or more token characters, `sk-` with 8 or more of letters, digits, hyphen and
 * underscore, `ghp_`, `gho_`, `ghu_`, `ghs_` and `ghr_` with 8 or more
 * alphanumerics, and `api_key`, `api-key`, `apikey`, `token`, `secret` or
 * `password` followed by `=` or `:` and a value (the whole, key name included)
 * MUST be replaced.*
 *
 * This module is the PORT of `lib/observability_policy.py` at `9cab15d`:
 * `REDACTED`, `THINKING_KEYS`, `DEFAULT_SECRET_KEYS`, `DEFAULT_SECRET_VALUES`,
 * `_redact_text` and the recursion of `sanitize`. The four value patterns and the
 * eleven key names are not written here: they are the DATA of
 * `data/patterns/baseline-v1.json` (T042), so that the set in force is versioned
 * and the baseline is contained in the widened set by construction.
 *
 * THE RULES ARE SEPARATE FROM THE SIZE CAP. The baseline mixed redaction and
 * truncation in one class; here the rules replace and count, and the cut belongs
 * to the ingress of `@specstride/observability`, which is the one place a cap is
 * applied (F111-FR-023, "redacted first and cut second"). Keeping the cut out of
 * this module is what makes the order unmistakable: a caller of this module
 * cannot cut, so it cannot cut first.
 *
 * A THINKING KEY IS DROPPED AND NOT REPLACED. The baseline removes the key
 * altogether rather than leaving `thinking: "[REDACTED]"`, because the fact that
 * a model reasoned is not a fact the stream needs to carry, and a placeholder
 * would invite a reader to ask what was there.
 */
import {
  compilePattern,
  loadWidenedPatternSet,
  type LoadedPatternSet,
  type PatternEntry,
} from "./patterns.ts";
import { REDACTION_PLACEHOLDER } from "./marks.ts";

/** The placeholder of the baseline (F111-FR-025). */
export const REDACTED = REDACTION_PLACEHOLDER;

/**
 * The keys the baseline DROPS, in any case (F111-FR-025). They are kept here
 * and not in the pattern set: they are not patterns, and no widening of the set
 * may make the stream carry a model's reasoning.
 */
export const THINKING_KEYS = [
  "thinking",
  "reasoning",
  "chain_of_thought",
  "chainofthought",
] as const;
export type ThinkingKey = (typeof THINKING_KEYS)[number];

const THINKING = new Set<string>(THINKING_KEYS);

/** True where the key is one of the four, in any case (F111-FR-025). */
export function isThinkingKey(key: string): boolean {
  return THINKING.has(String(key).toLowerCase());
}

/**
 * The eleven key names of the baseline, in the order the baseline lists them
 * (`DEFAULT_SECRET_KEYS`). Read from the baseline pattern set, so that the data
 * and this list cannot drift apart.
 */
export const BASELINE_SECRET_KEYS: readonly string[] = Object.freeze([
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "password",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "client_secret",
]);

/** The four value patterns of the baseline (`DEFAULT_SECRET_VALUES`), as data. */
export const BASELINE_SECRET_VALUE_PATTERNS: readonly PatternEntry[] = Object.freeze([
  Object.freeze({
    name: "bearer",
    pattern: "\\bbearer\\s+[A-Za-z0-9._~+/=-]{8,}",
    flags: "i",
  }),
  Object.freeze({ name: "sk-prefix", pattern: "\\bsk-[A-Za-z0-9_-]{8,}", flags: "" }),
  Object.freeze({ name: "github-prefix", pattern: "\\bgh[pousr]_[A-Za-z0-9]{8,}", flags: "" }),
  Object.freeze({
    name: "key-name-then-value",
    pattern: "\\b(?:api[_-]?key|token|secret|password)\\s*[=:]\\s*[^\\s,;]+",
    flags: "i",
  }),
]);

/**
 * True where the key is one of the eleven, in any case and AS A WHOLE. The
 * baseline anchors its key alternation with `^` and `$`, so `my_api_key` is not
 * one of them; the widened set reaches that key with its suffix forms
 * (F111-FR-029), which is a different rule in a different list.
 */
export function isBaselineSecretKey(key: string): boolean {
  return BASELINE_SECRET_KEYS.includes(String(key).toLowerCase());
}

/**
 * True where a key-name pattern of a set matches the key. `match` says how:
 * `exact` anchors, `suffix` and `substring` do not. A pattern with no `match`
 * is used as it is written.
 */
export function keyMatches(key: string, entry: PatternEntry): boolean {
  return compilePattern(entry).test(String(key));
}

/** The set in force: the widened set, loaded once. */
let inForce: LoadedPatternSet | undefined;

/** The widened set, or `undefined` where it cannot be loaded (fail closed). */
export function patternSetInForce(): LoadedPatternSet | undefined {
  if (inForce === undefined) {
    const loaded = loadWidenedPatternSet();
    if (loaded.ok) inForce = loaded.loaded;
  }
  return inForce;
}

/** What a replacement over a text did. */
export type TextRedaction = {
  readonly text: string;
  readonly replacements: number;
  readonly redacted: boolean;
};

/**
 * Replace every match of the value patterns in a text, in the order of the set
 * (`_redact_text` of the baseline). The count is the number of matches, as the
 * baseline's `subn` counts them.
 */
export function redactText(
  text: string,
  values: readonly PatternEntry[] = patternSetInForce()?.values ?? BASELINE_SECRET_VALUE_PATTERNS,
): TextRedaction {
  let out = String(text);
  let replacements = 0;
  for (const entry of values) {
    const expression = compilePattern(entry, true);
    out = out.replace(expression, () => {
      replacements += 1;
      return REDACTED;
    });
  }
  return Object.freeze({ text: out, replacements, redacted: replacements > 0 });
}

/** What a replacement over a whole value did. */
export type ValueRedaction = {
  readonly value: unknown;
  readonly replacements: number;
  readonly redacted: boolean;
};

/**
 * Walk a value: drop a thinking key, replace the value of a key of the set, and
 * put every text through the value patterns (`sanitize` of the baseline). A list
 * is walked member by member; anything that is not a map, a list or text is
 * returned as it is, because there is nothing in it to replace.
 */
export function redactValue(
  value: unknown,
  set: Pick<LoadedPatternSet, "keyNames" | "values"> | undefined = patternSetInForce(),
): ValueRedaction {
  const keyNames = set?.keyNames;
  const values = set?.values ?? BASELINE_SECRET_VALUE_PATTERNS;
  let replacements = 0;

  const secretKey = (key: string): boolean => {
    if (keyNames === undefined) return isBaselineSecretKey(key);
    return keyNames.some((entry) => keyMatches(key, entry));
  };

  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (item !== null && typeof item === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
        if (isThinkingKey(key)) {
          replacements += 1;
          continue;
        }
        if (secretKey(key)) {
          out[key] = REDACTED;
          replacements += 1;
          continue;
        }
        out[key] = walk(child);
      }
      return out;
    }
    if (typeof item === "string") {
      const done = redactText(item, values);
      replacements += done.replacements;
      return done.text;
    }
    return item;
  };

  const next = walk(value);
  return Object.freeze({ value: next, replacements, redacted: replacements > 0 });
}
