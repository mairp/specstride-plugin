/**
 * The HASH of Lisa's verification package, extracted as source (T006,
 * `research.md` D-1; recorded in `../../EXTRACTED.md`).
 *
 * Extracted from `packages/verification/src/hash.ts` of Lisa at `363e6a3`
 * (29 lines, the whole file), read with
 * `git -C <lisa> show 363e6a3:packages/verification/src/hash.ts`.
 *
 * The one change of the extraction: `createHash` is imported from
 * `node:crypto` as the baseline imports it, and nothing else. `canonicalize`
 * stays module-private, as at the baseline.
 *
 * As extracted: `canonicalJson` sorts object keys with `localeCompare` and
 * leaves `JSON.stringify` its default separators, and `stableId` takes the
 * FIRST 20 characters of the hexadecimal digest. The text form of the hashes
 * of the Specstride baseline (`data-model.md`: a hash over the text form, no
 * final line end) is a LATER phase of this feature; this module is pinned
 * as it was extracted by `tests/characterization/105/CT-105-2.test.ts`.
 */
import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function contentHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function stableId(prefix: string, seed: string): string {
  return `${prefix}-${sha256(seed).slice(0, 20)}`;
}
