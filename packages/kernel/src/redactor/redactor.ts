/**
 * T040 — the one redactor: `register` and `redact` of annex X §X.4, with the
 * baseline rules, the widened pattern set and the registered secrets
 * (F111-FR-024, F111-FR-025, F111-FR-030).
 *
 * THERE IS ONE REDACTOR. This factory is the only thing in the product that
 * holds a pattern set and a registry together, and `@specstride/observability`
 * reaches it through the interface of `@specstride/contracts` and never through
 * the rules directly. The cap is NOT here: `redact` takes a size cap because
 * §X.4's row says it does, and applies it AFTER the replacement, which is the
 * order F111-FR-023 states and the only order this signature permits.
 *
 * IT FAILS CLOSED (F111-FR-024). Two things can go wrong, and both end the same
 * way: the pattern set does not load, or a rule throws. In either case `redact`
 * returns `dropped: true` with an EMPTY `text` and the mark of row 90 in
 * `reason`, so a caller that ignores `dropped` and uses `text` still delivers
 * nothing rather than the unredacted content. That is the point of returning the
 * empty string rather than the input: the fail-closed path has no shape in which
 * the secret survives.
 *
 * THE REGISTERED SECRETS GO FIRST. A resolved secret is replaced before the
 * patterns run, so a value that a pattern would have cut in half is already gone
 * whole, and the count of replacements the result carries is the sum of both.
 */
import type { RedactResult, Redactor } from "@specstride/contracts/ep/redactor";
import { DROP_MARKS, type DropMark } from "./marks.ts";
import {
  loadPatternSetFrom,
  loadWidenedPatternSet,
  type LoadedPatternSet,
  type PatternEntry,
} from "./patterns.ts";
import { redactText, redactValue, type ValueRedaction } from "./rules.ts";
import { SecretRegistry } from "./register.ts";

/** The mark a redactor that cannot run carries (row 90). */
export const REDACTOR_UNAVAILABLE: DropMark = DROP_MARKS[0];

/** The mark an invalid pattern set carries (row 90). */
export const PATTERN_SET_INVALID: DropMark = DROP_MARKS[1];

/** What `createRedactor` is given. */
export type CreateRedactorOptions = {
  /**
   * The pattern set to use. A value is loaded and validated here, so an invalid
   * one makes a redactor that fails closed rather than one that throws at every
   * call. Absent: the widened set the product ships.
   */
  readonly patternSet?: unknown;
  /** The registry of resolved secrets. Absent: a fresh one. */
  readonly registry?: SecretRegistry;
};

/**
 * The one redactor of the product: the interface of §X.4 and the two operations
 * over a whole value that the ingress needs.
 */
export type SpecstrideRedactor = Redactor & {
  /** The version of the pattern set, or the empty string where none loaded. */
  readonly patternSetVersion: string;
  /** The mark of why the redactor cannot run, or `undefined` where it can. */
  readonly unavailable: DropMark | undefined;
  /** The registry behind this redactor: the scan before a commit shares it. */
  readonly registry: SecretRegistry;
  /** The value patterns in force, for the scan before a commit. */
  readonly values: readonly PatternEntry[];
  /** Replace in a whole value: a thinking key goes, a secret key's value goes. */
  redactValue(value: unknown): ValueRedaction;
};

/** A result that says the content was dropped, with its mark. */
function dropped(mark: DropMark, version: string, reason: string): RedactResult {
  return Object.freeze({
    text: "",
    replacements: 0,
    patternSetVersion: version,
    dropped: true,
    reason: `${mark}: ${reason}`,
  });
}

/** True where the text of a `reason` names the mark. */
export function markOfReason(reason: string | undefined): DropMark {
  for (const mark of DROP_MARKS) {
    if (reason !== undefined && reason.startsWith(mark)) return mark;
  }
  return REDACTOR_UNAVAILABLE;
}

/** Cut a text to a byte cap without splitting a character in two. */
function cut(text: string, cap: number): string {
  if (!Number.isInteger(cap) || cap <= 0) return text;
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= cap) return text;
  let end = cap;
  while (end > 0 && (bytes[end] as number) >= 0x80 && (bytes[end] as number) < 0xc0) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

/**
 * Make the redactor. The pattern set is loaded once: a set that does not load
 * leaves a redactor that fails closed with the mark `pattern-set-invalid`.
 */
export function createRedactor(options: CreateRedactorOptions = {}): SpecstrideRedactor {
  const registry = options.registry ?? new SecretRegistry();
  const result =
    options.patternSet === undefined
      ? loadWidenedPatternSet()
      : loadPatternSetFrom(options.patternSet);
  const set: LoadedPatternSet | undefined = result.ok ? result.loaded : undefined;
  const unavailable: DropMark | undefined = result.ok ? undefined : result.mark;
  const reason = result.ok ? "" : result.reason;
  const version = set?.version ?? "";

  const redactor: SpecstrideRedactor = {
    patternSetVersion: version,
    unavailable,
    registry,
    values: set?.values ?? Object.freeze([]),

    register(secret: string): void {
      registry.register(secret);
    },

    redact(text: string, sizeCap: number): RedactResult {
      if (set === undefined) {
        return dropped(unavailable ?? PATTERN_SET_INVALID, version, reason);
      }
      try {
        const secrets = registry.replaceIn(String(text));
        const patterns = redactText(secrets.text, set.values);
        const replacements = secrets.replacements + patterns.replacements;
        return Object.freeze({
          text: cut(patterns.text, sizeCap),
          replacements,
          patternSetVersion: version,
        });
      } catch (error) {
        return dropped(REDACTOR_UNAVAILABLE, version, String(error));
      }
    },

    redactValue(value: unknown): ValueRedaction {
      if (set === undefined) throw new Error(`${unavailable ?? PATTERN_SET_INVALID}: ${reason}`);
      const walked = redactValue(value, set);
      // The registered secrets are literal and reach every text of the value.
      let replacements = walked.replacements;
      const strings = (item: unknown): unknown => {
        if (Array.isArray(item)) return item.map(strings);
        if (item !== null && typeof item === "object") {
          const out: Record<string, unknown> = {};
          for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
            out[key] = strings(child);
          }
          return out;
        }
        if (typeof item === "string") {
          const done = registry.replaceIn(item);
          replacements += done.replacements;
          return done.text;
        }
        return item;
      };
      const next = registry.size === 0 ? walked.value : strings(walked.value);
      return Object.freeze({ value: next, replacements, redacted: replacements > 0 });
    },
  };

  return Object.freeze(redactor);
}
