/**
 * T101 — the records of the ledger namespace `micro` (F115-FR-030; IR-25).
 *
 * The layer writes its records to the ledger in the namespace `micro,
 * through the engine, and each record is appended BEFORE the act it
 * describes (write-ahead, `WRITE_AHEAD`): `appendRecord` returns the ledger
 * with the record already durable, so the act that follows can throw and the
 * record stands. The kinds are exactly the closed set of `spec.md`
 * ("Closed sets"), mirrored by
 * `packages/contracts/data/ledger-micro-115.json`.
 *
 * The ledger is chained (IR-25): every record carries the hash of its
 * predecessor and the canonical hash of its own content, taken with the
 * canonical record hash of the kernel (annex X §X.5). `validateLedger`
 * reads the chain back and reports a truncated, reordered or edited ledger
 * with the position it fails at.
 *
 * Purity: imports `@specstride/contracts` and `@specstride/kernel` only; no
 * `node:fs`, no process (F100-FR-012; research.md D-1).
 */
import { canonicalRecordHash } from "@specstride/kernel";

/** The namespace the records live in (F115-FR-030). */
export const MICRO_NAMESPACE = "micro" as const;

/**
 * F115-FR-030 — the closed set of the record kinds of the namespace `micro`.
 */
export const LEDGER_RECORD_KINDS = [
  "unit-declared",
  "check-started",
  "check-finished",
  "unit-kept",
  "unit-repair",
  "unit-unresolved",
  "command-excluded",
  "escalation",
  "closing-check",
  "disengaged",
  "integrity",
] as const;
export type LedgerRecordKind = (typeof LEDGER_RECORD_KINDS)[number];

/** F115-FR-030 — each record is appended before the act it describes. */
export const WRITE_AHEAD = true as const;

/** The hash the first record of a ledger chains to. */
export const GENESIS_HASH: string = "0".repeat(64);

/** Free-form payload of a record, keyed by the record kind's own fields. */
export type LedgerData = Readonly<Record<string, unknown>>;

/** One record of the namespace `micro`, as the engine wrote it. */
export type LedgerRecord = {
  /** Position of the record in the ledger, counting from 0. */
  readonly seq: number;
  /** The namespace: always `micro` (F115-FR-030). */
  readonly namespace: typeof MICRO_NAMESPACE;
  /** The kind, exactly one of the closed set. */
  readonly kind: LedgerRecordKind;
  /** The payload of the record. */
  readonly data: LedgerData;
  /** IR-25 — the hash of the predecessor, `GENESIS_HASH` for the first. */
  readonly prevHash: string;
  /** IR-25 — the canonical hash of this record's content. */
  readonly hash: string;
};

/** The ledger of the namespace `micro` of one phase attempt. */
export type MicroLedger = {
  readonly runId: string;
  readonly phase: number;
  readonly records: readonly LedgerRecord[];
};

/** The hash input of one record: everything but the hash itself. */
function recordHashOf(record: Omit<LedgerRecord, "hash">): string {
  return canonicalRecordHash({
    seq: record.seq,
    namespace: record.namespace,
    kind: record.kind,
    data: record.data,
    prevHash: record.prevHash,
  });
}

/** An empty ledger for the phase attempt. */
export function newLedger(runId: string, phase: number): MicroLedger {
  return { runId, phase, records: Object.freeze([]) };
}

/**
 * F115-FR-030 — append one record of the namespace `micro` BEFORE the act
 * the caller performs next. The kind must be in the closed set; anything
 * else is refused and nothing is written.
 */
export function appendRecord(
  ledger: MicroLedger,
  kind: LedgerRecordKind,
  data: LedgerData,
): MicroLedger {
  if (!(LEDGER_RECORD_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `record kind "${String(kind)}" is not in the closed set of the namespace micro`,
    );
  }
  const seq = ledger.records.length;
  const prevHash = ledger.records[seq - 1]?.hash ?? GENESIS_HASH;
  const withoutHash = { seq, namespace: MICRO_NAMESPACE, kind, data, prevHash };
  const record: LedgerRecord = Object.freeze({
    ...withoutHash,
    hash: recordHashOf(withoutHash),
  });
  return { ...ledger, records: Object.freeze([...ledger.records, record]) };
}

/** The last record of the ledger, or `undefined` when it is empty. */
export function lastRecord(ledger: MicroLedger): LedgerRecord | undefined {
  return ledger.records[ledger.records.length - 1];
}

/** Why a ledger failed validation (IR-25). */
export type LedgerInvalidReason = "truncated" | "reordered" | "edited";

/** The verdict of `validateLedger`. */
export type LedgerValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: LedgerInvalidReason; readonly at: number };

/**
 * IR-25 — validate the chain of the ledger: the sequence numbers run
 * consecutively from 0, each record's content hashes to its own hash, and
 * each record names the hash of its predecessor.
 *
 * - a sequence value is missing → `truncated`;
 * - the values are present but out of order → `reordered`;
 * - a record's content no longer hashes to its own hash, or its link to the
 *   predecessor is broken → `edited`.
 */
export function validateLedger(ledger: MicroLedger): LedgerValidation {
  const { records } = ledger;
  const seqs = records.map((record) => record.seq).sort((a, b) => a - b);
  for (let index = 0; index < seqs.length; index += 1) {
    if (seqs[index] !== index) {
      return { ok: false, reason: "truncated", at: index };
    }
  }
  let prevHash = GENESIS_HASH;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.seq !== index) {
      return { ok: false, reason: "reordered", at: index };
    }
    const recomputed = recordHashOf(record);
    if (recomputed !== record.hash) {
      return { ok: false, reason: "edited", at: index };
    }
    if (record.prevHash !== prevHash) {
      return { ok: false, reason: "edited", at: index };
    }
    prevHash = record.hash;
  }
  return { ok: true };
}
