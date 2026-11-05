/**
 * The redactor the tests of phase 5 hand to the port (annex X §X.4).
 *
 * The redactor itself belongs to feature 111 and `packages/kernel` is still a
 * skeleton, so the tests of this feature consume the INTERFACE of
 * `@specstride/contracts/ep/redactor` — `register` and `redact` — and nothing
 * else. Two things are wired:
 *
 * 1. exact-match removal of every registered value, which is what F110-FR-032
 *    requires of the port: the port registers what it resolves, and this
 *    redactor can then remove it;
 * 2. an optional pattern set, which stands for the versioned DATA of §X.4. It
 *    is the second half of F110-FR-027: a value that the redactor CHANGES when
 *    it passes through `redact` is an inline secret. The patterns are named by
 *    the test, because the set is feature 111's content and this feature holds
 *    none of it.
 */
import type { RedactResult, Redactor } from "@specstride/contracts/ep/redactor";

/** The text the redactor puts in place of a value it removes. */
export const REPLACEMENT = "[redacted]" as const;

/** The version this redactor reports for its pattern set. */
export const PATTERN_SET_VERSION = "tests-110-phase-5" as const;

/** One pattern of the set, with the name the report would name. */
export interface NamedPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * A pattern set that stands for the kinds of value §X.4 says the `values` list
 * covers. Only what this feature's tests need: a prefix of a provider key and a
 * private-key block.
 */
export const SAMPLE_PATTERNS: readonly NamedPattern[] = Object.freeze([
  Object.freeze({ name: "provider-key-prefix", pattern: /sk-[A-Za-z0-9]{8,}/g }),
  Object.freeze({
    name: "private-key-block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  }),
]);

/** The redactor of the tests, with the registry it keeps. */
export type TestRedactor = Redactor & {
  /** The values registered so far, in the order they were registered. */
  registered(): readonly string[];
  /** How many replacements were made since the redactor was built. */
  replacements(): number;
  /** Forget every registered value. */
  reset(): void;
};

/** Build a redactor over the interface of §X.4. */
export function createTestRedactor(
  options: { readonly patterns?: readonly NamedPattern[] | undefined } = {},
): TestRedactor {
  const patterns = options.patterns ?? [];
  const secrets: string[] = [];
  let made = 0;

  const redact = (text: string, sizeCap: number): RedactResult => {
    let out = text;
    let replacements = 0;
    // The longest value first, so a value that holds another is cut as a whole.
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      if (secret === "" || !out.includes(secret)) continue;
      const before = out;
      out = out.split(secret).join(REPLACEMENT);
      replacements += before.split(secret).length - 1;
    }
    for (const rule of patterns) {
      const expression = new RegExp(rule.pattern.source, rule.pattern.flags);
      const found = out.match(expression);
      if (found === null) continue;
      replacements += found.length;
      out = out.replace(expression, REPLACEMENT);
    }
    made += replacements;
    return Object.freeze({
      text: sizeCap >= 0 && out.length > sizeCap ? out.slice(0, sizeCap) : out,
      replacements,
      patternSetVersion: PATTERN_SET_VERSION,
    });
  };

  return Object.freeze({
    register(secret: string): void {
      if (secret !== "" && !secrets.includes(secret)) secrets.push(secret);
    },
    redact,
    registered(): readonly string[] {
      return Object.freeze([...secrets]);
    },
    replacements(): number {
      return made;
    },
    reset(): void {
      secrets.length = 0;
      made = 0;
    },
  });
}
