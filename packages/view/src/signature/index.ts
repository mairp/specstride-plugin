/**
 * T021 — the change signature and the cursor token
 * (`contracts/status-line.md`, "The change signature"; F129-FR-030).
 *
 * Fields, and no others: `runId`, `state`, `liveness`, `conditions` with
 * reasons, `phase`, `approved` (count), `rejects`, `attention` (kinds and
 * keys), `budgetLevels`, `strategy`. NOT part of it: the pass, the units, the
 * elapsed time, the timeline, `next`.
 */
import type { RunView } from "../model/view.ts";
import type { CanonicalHasher } from "../model/ports.ts";
import { canonicalJson } from "../serialize/canonical.ts";

/** The fields of the change signature, and no others. */
export const SIGNATURE_FIELDS = [
  "runId",
  "state",
  "liveness",
  "conditions",
  "phase",
  "approved",
  "rejects",
  "attention",
  "budgetLevels",
  "strategy",
] as const;

/** The fields that are NOT part of the change signature. */
export const NOT_IN_THE_SIGNATURE = ["pass", "units", "elapsed", "timeline", "next"] as const;

/** The length of the token in hexadecimal characters. */
export const TOKEN_LENGTH = 8 as const;

/** The change signature record of a view: those ten fields and no others. */
export function signatureRecord(view: RunView): Readonly<Record<string, unknown>> {
  return Object.freeze({
    runId: view.runId,
    state: view.state,
    liveness: view.liveness,
    conditions: Object.freeze({
      dead: view.conditions.dead,
      stale: view.conditions.stale === null ? null : view.conditions.stale.reason,
      launchAbandoned: view.conditions.launchAbandoned,
    }),
    phase: view.progress.phase,
    approved: view.phases.filter((phase) => phase.approved).length,
    rejects: view.progress.rejects,
    attention: Object.freeze(
      view.attention.map((item) => Object.freeze({ kind: item.kind, key: item.key })),
    ),
    budgetLevels: Object.freeze(
      view.budget.map((row) => Object.freeze({ scope: row.scope, level: row.level })),
    ),
    strategy: view.strategy.strategy,
  });
}

/**
 * The pure fallback hash, used where the caller injects no canonical hasher.
 * A 64-bit FNV-1a over the UTF-8 bytes of the canonical text, written as 16
 * hexadecimal characters: deterministic, and the same on every platform,
 * because it reads bytes and no locale, separator or line end of the host.
 */
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const SIXTY_FOUR_BITS = 0xffffffffffffffffn;
const utf8 = new TextEncoder();

export function fallbackHash(canonicalText: string): string {
  let hash = FNV_OFFSET;
  for (const byte of utf8.encode(canonicalText)) {
    hash = (hash ^ BigInt(byte)) & SIXTY_FOUR_BITS;
    hash = (hash * FNV_PRIME) & SIXTY_FOUR_BITS;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * F129-FR-030 — the change signature of a view: the record and the first eight
 * hexadecimal characters of its canonical record hash.
 */
export function signature(
  view: RunView,
  hash: CanonicalHasher = fallbackHash,
): {
  readonly record: Readonly<Record<string, unknown>>;
  readonly token: string;
} {
  const record = signatureRecord(view);
  const digest = hash(canonicalJson(record));
  const hex = digest.replace(/[^0-9a-f]/gu, "").slice(0, TOKEN_LENGTH);
  return Object.freeze({
    record,
    token: hex.padEnd(TOKEN_LENGTH, "0"),
  });
}

/** `cur=<offset>.<seq>.<sig>` — the cursor token of `wait` (`contracts/status-line.md`). */
export function cursorToken(view: RunView): string {
  return `${view.cursor.offset}.${view.cursor.lastSeq}.${view.signature.token}`;
}

/** The three parts of a cursor token, or null where it cannot be read. */
export function parseCursorToken(
  token: string,
): { readonly offset: number; readonly lastSeq: number; readonly signature: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const offset = Number(parts[0]);
  const lastSeq = Number(parts[1]);
  const sig = parts[2] ?? "";
  if (!Number.isInteger(offset) || offset < 0) return null;
  if (!Number.isInteger(lastSeq) || lastSeq < 0) return null;
  if (!/^[0-9a-f]{8}$/u.test(sig)) return null;
  return Object.freeze({ offset, lastSeq, signature: sig });
}
