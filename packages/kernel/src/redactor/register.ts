/**
 * T044 — the registration of a resolved secret (F111-FR-030).
 *
 * F111-FR-030: *A secret that the runtime resolved MUST be registered with the
 * redactor at the moment of its use, and its exact value MUST be replaced in
 * every text that enters the ingress from then on. The value MUST never be
 * written to any state, event, log or contract.*
 *
 * "THE VALUE IS NEVER WRITTEN" IS A PROPERTY OF THIS CLASS AND NOT A RULE ITS
 * CALLERS FOLLOW. The values live in a private field, so no caller can read the
 * list back; `toJSON` returns the COUNT and the FINGERPRINTS, so
 * `JSON.stringify` of a registry — which is how a value ends up in a state file,
 * an event or a log by accident — cannot carry a secret; and
 * `Symbol.for("nodejs.util.inspect.custom")` gives the same, so neither
 * `console.log` nor an error that embeds the object leaks one.
 *
 * THE MATCH IS EXACT AND LITERAL. A registered value is not a pattern: it is
 * matched as a literal, every occurrence of it, with no regular expression in
 * between — so a value that happens to hold `.*` redacts itself and nothing
 * else. Values are tried LONGEST FIRST, so that a short secret which is a prefix
 * of a long one cannot cut the long one in half and leave its tail in the text.
 *
 * A VERY SHORT VALUE IS NOT REGISTERED. A one-character secret would replace
 * every occurrence of that character in every text that follows, which destroys
 * the stream and tells an observer the character. `MINIMUM_REGISTERED_LENGTH` is
 * the floor; a shorter value is ignored, and the caller is told by the return of
 * `register`.
 */
import { createHash } from "node:crypto";
import { REDACTION_PLACEHOLDER } from "./marks.ts";

/** The shortest value that is worth registering, in characters. */
export const MINIMUM_REGISTERED_LENGTH = 4;

/** The fingerprint of a value: what a record MAY carry in its place. */
export function secretFingerprint(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16);
}

/** What `replaceIn` did to a text. */
export type SecretReplacement = {
  readonly text: string;
  readonly replacements: number;
};

/** What a registry may say about itself: a count and fingerprints, never a value. */
export type RegistryRecord = {
  readonly count: number;
  readonly fingerprints: readonly string[];
};

/**
 * The registry of the values the runtime resolved. One registry sits behind the
 * one redactor, so the ingress and the scan before a commit look for the same
 * values (F111-FR-030, F111-FR-031).
 */
export class SecretRegistry {
  readonly #secrets = new Set<string>();
  /** Longest first, so an overlapping pair replaces the long value whole. */
  #ordered: string[] = [];

  /**
   * Register a value AT THE MOMENT OF ITS USE. Returns true where the value was
   * taken, false where it was too short to be safe to match.
   */
  register(secret: unknown): boolean {
    if (typeof secret !== "string") return false;
    if (secret.length < MINIMUM_REGISTERED_LENGTH) return false;
    if (this.#secrets.has(secret)) return true;
    this.#secrets.add(secret);
    this.#ordered = [...this.#secrets].sort((left, right) => right.length - left.length);
    return true;
  }

  /** How many values are registered. */
  get size(): number {
    return this.#secrets.size;
  }

  /** Whether a value is registered. The caller must already hold the value. */
  has(secret: string): boolean {
    return this.#secrets.has(secret);
  }

  /** The fingerprints, in the order the values were taken. */
  fingerprints(): readonly string[] {
    return Object.freeze([...this.#secrets].map(secretFingerprint));
  }

  /** Replace every exact occurrence of every registered value. */
  replaceIn(text: string): SecretReplacement {
    let out = String(text);
    let replacements = 0;
    for (const secret of this.#ordered) {
      if (!out.includes(secret)) continue;
      const parts = out.split(secret);
      replacements += parts.length - 1;
      out = parts.join(REDACTION_PLACEHOLDER);
    }
    return Object.freeze({ text: out, replacements });
  }

  /** True where the text holds a registered value. */
  hits(text: string): boolean {
    return this.#ordered.some((secret) => text.includes(secret));
  }

  /** Which registered values a text holds, as FINGERPRINTS and never as values. */
  hitFingerprints(text: string): readonly string[] {
    return Object.freeze(
      this.#ordered.filter((secret) => text.includes(secret)).map(secretFingerprint),
    );
  }

  /** The offsets at which a registered value occurs in a text. */
  hitOffsets(text: string): readonly number[] {
    const offsets: number[] = [];
    for (const secret of this.#ordered) {
      let at = text.indexOf(secret);
      while (at !== -1) {
        offsets.push(at);
        at = text.indexOf(secret, at + secret.length);
      }
    }
    return Object.freeze([...new Set(offsets)].sort((left, right) => left - right));
  }

  /** What may be written: the count and the fingerprints. NEVER a value. */
  toJSON(): RegistryRecord {
    return Object.freeze({ count: this.size, fingerprints: this.fingerprints() });
  }

  toString(): string {
    return `SecretRegistry(${this.size} registered)`;
  }
}

/** The hook `util.inspect` uses: the same record, never a value. */
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

Object.defineProperty(SecretRegistry.prototype, INSPECT, {
  value(this: SecretRegistry): RegistryRecord {
    return this.toJSON();
  },
  writable: false,
  enumerable: false,
  configurable: false,
});

/** The one thing a caller holding a redactor does: register at the use. */
export function registerAtUse(target: { register(secret: string): void }, secret: string): void {
  target.register(secret);
}
