/**
 * T074 of feature 103, first half — THE LEDGER RECORDS OF THE NAMESPACE
 * `core` (F103-FR-039, F103-SC-009).
 *
 * One ledger per run, in the control plane (`run:<runId>:ledger`,
 * annex B §B.13): APPEND-ONLY, each record CHAINED to the one before, and
 * SIGNED with a key that is NOT the approval key (`run:<runId>:ledger-key`).
 * The namespace `core` holds the four kinds of the closed set of row 132 and
 * each of its records carries the counters as they stand after it.
 *
 * ## The four things this module is responsible for
 *
 *  1. **The chain and the signature.** `appendCoreRecord` is the only way a
 *     record of the namespace is made: it fills `seq` from the ledger it is
 *     given, `prev` from the hash of the record before, and `sig` from the
 *     ledger key. `recordHashOf` hashes the record WITHOUT its signature, so
 *     a record is chained to the content of its predecessor and not to its
 *     predecessor's signature.
 *  2. **One record per phase attempt with every layer off.** The two kinds
 *     `attempt-open` and `attempt-closed` are written WHATEVER the switch
 *     `carry.ledger_handoff` says (`KINDS_ALWAYS_WRITTEN`); only `pass-closed`
 *     waits for the switch. So with every layer off and the switch off the
 *     ledger still holds at least one record per phase attempt, which is what
 *     F103-FR-039 and F100-FR-068 require, and `recordsPerPhaseAttempt`
 *     measures it.
 *  3. **Validation on resume.** `validateLedger` detects a record that was
 *     EDITED, TRUNCATED or REORDERED, and says which of the three it was and
 *     at which position.
 *  4. **The effect of an invalid ledger, which is the whole point.** Every
 *     loop layer goes off FOR THE PHASE ATTEMPT, with an event, and the run
 *     NEVER STOPS: `effectOfAnInvalidLedger` returns the off records and the
 *     events and carries no exit code and no stop reason at all.
 *     `AN_INVALID_LEDGER_STOPS_THE_RUN` is `false` and
 *     `tests/characterization/103/ledger-core.test.ts` (CT-103-139) drives it
 *     for all three faults.
 *
 * ## An unknown kind is not a broken ledger
 *
 * Row 132's unknown-value rule: "a reader keeps the record in the check of the
 * chain and ignores its content". A layer of a later wave writes kinds this
 * module has never heard of, and a ledger holding them is VALID. So
 * `validateLedger` never looks at `kind`, and `readKind` says in one place
 * what a reader does with one: keep it in the chain, ignore its content.
 *
 * ## What this module does not do
 *
 * It opens no file and writes none: a core package reads and writes files
 * through the kernel and the ports of the edge packages (F100-FR-012,
 * F100-FR-234). The ledger is handed in as an array and the appended record is
 * handed back; the composition root appends it. The ledger and its key are
 * refused by grounding (F100-FR-037), which this module asserts against the
 * data of `@specstride/contracts` rather than restating.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { canonicalRecordHash } from "@specstride/kernel/hasher";
import type { LedgerRecord } from "@specstride/contracts/records/ledger-record";
import {
  CORE_LEDGER_KINDS,
  coreLedgerKinds,
  isCoreLedgerKind,
  type CoreLedgerKind,
} from "@specstride/contracts/enums/pass-loop";
import { groundingRefusedNames } from "@specstride/contracts/ids/layout-rules";
import {
  SCOPE_OF_REASON,
  offAnnouncement,
  offEvent,
  type LayerOffRecord,
  type OffReason,
} from "../layers/call-points.ts";
import { ZERO_COUNTS, readCounts, type Counts } from "./counters.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = ["F103-FR-039", "F103-FR-040", "F103-SC-009"] as const;

/* ------------------------------------------------------------------ *
 * Identity.
 * ------------------------------------------------------------------ */

/** The schema id of a ledger record (annex B §B.13). */
export const SCHEMA_ID = "specstride.ledger/1" as const;

/** The logical name of the ledger; its root is the CONTROL PLANE. */
export const LOGICAL_NAME = "run:<runId>:ledger" as const;

/** The logical name of the key the ledger is signed with. */
export const LEDGER_KEY_LOGICAL_NAME = "run:<runId>:ledger-key" as const;

/** F103-FR-039 — the ledger key is NOT the approval key. */
export const THE_LEDGER_KEY_IS_THE_APPROVAL_KEY = false as const;

/** The namespace this module owns; a loop layer owns its own. */
export const NAMESPACE = "core" as const;

/** F103-FR-039 — the ledger is append-only. */
export const APPEND_ONLY = true as const;

/** F100-FR-037 — grounding refuses the ledger. */
export const GROUNDING_ACCEPTS_THE_LEDGER = false as const;

/** The ledger's logical name as the grounding refusal of `contracts` holds it. */
export const GROUNDING_REFUSES_THESE_NAMES: readonly string[] = Object.freeze(
  groundingRefusedNames.filter((name) => name === LOGICAL_NAME),
);

/** The signature algorithm, as the key module of the approval record uses. */
export const SIGNATURE_ALGORITHM = "HMAC-SHA-256" as const;

/** The `prev` of the FIRST record of a ledger: 64 zeros, no predecessor. */
export const GENESIS_PREV = "0".repeat(64);

/* ------------------------------------------------------------------ *
 * The kinds.
 * ------------------------------------------------------------------ */

/** The four kinds of the namespace `core` (row 132 of annex X §X.6). */
export const KINDS = CORE_LEDGER_KINDS;

/**
 * F103-FR-039 — the kinds written WHATEVER `carry.ledger_handoff` says: "The
 * engine MUST write a record when a phase attempt opens and when it closes",
 * unconditionally, and `--reset-counts` is recorded whenever it is passed
 * (F103-FR-040). CQ-066 settles it: with the switch off only the CARRY-OVER
 * parts stop, and the counter records at the boundaries of a phase attempt
 * stay.
 */
export const KINDS_ALWAYS_WRITTEN: readonly CoreLedgerKind[] = Object.freeze([
  "attempt-open",
  "attempt-closed",
  "counts-reset",
]);

/** The one kind that waits for the switch: a record after EVERY pass. */
export const KIND_WRITTEN_WITH_LEDGER_HANDOFF_ON = "pass-closed" as const;

/** The switch of F103-FR-039; off under `parity` (row 8 of annex X §X.7). */
export const SWITCH = "carry.ledger_handoff" as const;
export const SWITCH_DEFAULT_ON = true as const;
export const SWITCH_UNDER_PARITY_ON = false as const;

/** Whether a kind is written with the switch in the given position. */
export function kindIsWritten(kind: CoreLedgerKind, ledgerHandoffOn: boolean): boolean {
  if ((KINDS_ALWAYS_WRITTEN as readonly string[]).includes(kind)) return true;
  return ledgerHandoffOn;
}

/** Every record of the namespace `core` carries the counters (row 132). */
export const EVERY_CORE_RECORD_CARRIES_THE_COUNTERS = true as const;

/**
 * Row 132's unknown-value rule in one place: a kind this reader does not know
 * STAYS IN THE CHECK OF THE CHAIN and only its CONTENT is ignored. It is never
 * a fault of the ledger and never stops anything.
 */
export function readKind(kind: string): {
  readonly known: boolean;
  readonly keptInTheChainCheck: true;
  readonly contentIsRead: boolean;
  readonly treatedAs?: string | undefined;
} {
  const known = isCoreLedgerKind(kind);
  return Object.freeze({
    known,
    keptInTheChainCheck: true as const,
    contentIsRead: known,
    treatedAs: known ? undefined : coreLedgerKinds.onUnknown(kind).kind,
  });
}

/* ------------------------------------------------------------------ *
 * The record.
 * ------------------------------------------------------------------ */

/** A ledger record of the namespace `core`: the envelope of §B.13, narrowed. */
export type CoreLedgerRecord = LedgerRecord & {
  readonly ns: typeof NAMESPACE;
  readonly kind: string;
  readonly counters: Counts;
};

/** The key the ledger is signed with. Its material never leaves the control plane. */
export type LedgerKey = {
  /** The identity of the key; it may stand in a record, the material may not. */
  readonly keyId: string;
  /** The key material, hex. */
  readonly key: string;
};

/** The identity of a ledger key: the SHA-256 of its material, hex. */
export function ledgerKeyIdOf(material: string): string {
  return createHash("sha256").update(material, "hex").digest("hex");
}

/**
 * The hash a record is chained BY: the canonical record hash (annex X §X.5)
 * over every field of the record EXCEPT its own signature.
 *
 * Leaving `sig` out is deliberate. A chain over the signature would make the
 * link depend on the key as well as on the content, so a reader without the
 * key could not even check the shape of the chain; and a re-signing of one
 * record with the same key would still have to rewrite every record after it.
 * Over the content, `prev` is a statement about WHAT the record before said.
 */
export function recordHashOf(record: LedgerRecord | CoreLedgerRecord): string {
  const { sig: _sig, ...withoutSignature } = record as LedgerRecord & { sig?: unknown };
  return canonicalRecordHash(withoutSignature);
}

/** The signature over a record, made with the ledger key (hex). */
export function signatureOf(key: LedgerKey, record: LedgerRecord | CoreLedgerRecord): string {
  return createHmac("sha256", Buffer.from(key.key, "hex"))
    .update(recordHashOf(record))
    .digest("hex");
}

/** Whether a record's signature verifies under the key, compared constant-time. */
export function signatureIsValid(key: LedgerKey, record: LedgerRecord): boolean {
  const expected = signatureOf(key, record);
  const held = record.sig;
  if (typeof held !== "string" || held.length !== expected.length) return false;
  if (!/^[0-9a-f]+$/.test(held)) return false;
  return timingSafeEqual(Buffer.from(held, "hex"), Buffer.from(expected, "hex"));
}

/** What a caller gives to append a record of the namespace `core`. */
export type AppendInput = {
  /** The ledger as it stands, oldest first. */
  readonly records: readonly LedgerRecord[];
  /** The ledger key. */
  readonly key: LedgerKey;
  /** The kind, from the closed set of the namespace. */
  readonly kind: CoreLedgerKind;
  /** The counters as they stand AFTER this record. */
  readonly counters: Counts;
  readonly runId: string;
  readonly engineStartId: string;
  /** The time of the append, UTC. Handed in: the core holds no clock. */
  readonly ts: string;
  readonly phase?: number | undefined;
  readonly attemptId?: string | undefined;
  readonly passId?: string | undefined;
  readonly unitId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly treeHash?: string | undefined;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
};

/**
 * F103-FR-039 — the next record of the namespace `core`, chained to the one
 * before and signed. The ledger it is given is not changed: append-only means
 * the caller appends what this returns.
 */
export function appendCoreRecord(input: AppendInput): CoreLedgerRecord {
  const before = input.records[input.records.length - 1];
  const unsigned = {
    schema: SCHEMA_ID,
    seq: input.records.length + 1,
    prev: before === undefined ? GENESIS_PREV : recordHashOf(before),
    ts: input.ts,
    runId: input.runId,
    engineStartId: input.engineStartId,
    ns: NAMESPACE,
    kind: input.kind,
    counters: readCounts(input.counters),
    ...(input.phase !== undefined ? { phase: input.phase } : {}),
    ...(input.attemptId !== undefined ? { attemptId: input.attemptId } : {}),
    ...(input.passId !== undefined ? { passId: input.passId } : {}),
    ...(input.unitId !== undefined ? { unitId: input.unitId } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.treeHash !== undefined ? { treeHash: input.treeHash } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
    sig: "",
  } as unknown as CoreLedgerRecord;
  const sig = signatureOf(input.key, unsigned);
  return Object.freeze({ ...unsigned, sig }) as CoreLedgerRecord;
}

/* ------------------------------------------------------------------ *
 * Validation on resume.
 * ------------------------------------------------------------------ */

/** The three faults F103-FR-039 names, in the order it names them. */
export const LEDGER_FAULTS = ["edited", "truncated", "reordered"] as const;
export type LedgerFault = (typeof LEDGER_FAULTS)[number];

/** The newest record the engine recorded elsewhere, so a CUT TAIL is visible. */
export type LedgerHead = {
  /** The `seq` of the newest record the run knows it appended. */
  readonly seq: number;
  /** The hash of that record, where the run recorded it. */
  readonly hash?: string | undefined;
};

/** What validation is given. */
export type ValidateOptions = {
  /** The key, where the caller holds it. Without it the signature is not checked. */
  readonly key?: LedgerKey | undefined;
  /** The head, where the run recorded one; without it a cut TAIL is invisible. */
  readonly head?: LedgerHead | undefined;
};

/** What validation gives back. */
export type LedgerVerdict = {
  readonly ok: boolean;
  /** Which of the three faults it was, where there was one. */
  readonly fault?: LedgerFault | undefined;
  /** The position in the array at which the fault was found, from 1. */
  readonly at?: number | undefined;
  /** What was wrong, in words, for the event. */
  readonly detail?: string | undefined;
  /** How many records were checked. */
  readonly checked: number;
};

/**
 * F103-FR-039 — "The ledger MUST be validated on resume: a record that was
 * edited, truncated or reordered MUST be detected".
 *
 * The three are told apart from the evidence and not guessed:
 *
 *  - the `seq` values are a run from 1 upwards without gaps. A FRONT or MIDDLE
 *    cut leaves a gap or a first `seq` above 1 → **truncated**. A TAIL cut is
 *    invisible in the array alone, so it is found against the recorded head.
 *  - the same values in the wrong order — the multiset is still 1..n but the
 *    positions disagree → **reordered**.
 *  - a `prev` that is not the hash of the record before, or a signature that
 *    does not verify → **edited**. Either means the bytes of some record are
 *    not the bytes that were signed and chained.
 *
 * `kind` is never looked at: an unknown kind is not a fault (row 132).
 */
export function validateLedger(
  records: readonly LedgerRecord[],
  options: ValidateOptions = {},
): LedgerVerdict {
  const checked = records.length;

  // The sequence numbers, first: they tell truncation from reordering.
  const seqs = records.map((r) => Number(r.seq));
  if (seqs.some((s) => !Number.isSafeInteger(s) || s < 1)) {
    const at = seqs.findIndex((s) => !Number.isSafeInteger(s) || s < 1) + 1;
    return frozen({
      ok: false,
      fault: "edited",
      at,
      detail: `the record at position ${at} carries no usable seq`,
      checked,
    });
  }
  const sorted = [...seqs].sort((a, b) => a - b);
  const isARunFromOne = sorted.every((s, i) => s === i + 1);
  const inOrder = seqs.every((s, i) => i === 0 || s > seqs[i - 1]!);

  if (isARunFromOne && !inOrder) {
    const at = seqs.findIndex((s, i) => i > 0 && s <= seqs[i - 1]!) + 1;
    return frozen({
      ok: false,
      fault: "reordered",
      at,
      detail: `the record at position ${at} carries seq ${String(seqs[at - 1])}, after seq ${String(
        seqs[at - 2],
      )}`,
      checked,
    });
  }
  if (!isARunFromOne) {
    const at = sorted.findIndex((s, i) => s !== i + 1) + 1;
    return frozen({
      ok: false,
      fault: "truncated",
      at,
      detail:
        checked === 0
          ? "the ledger holds no record at all"
          : `the sequence is not 1..${String(checked)} without gaps; it breaks at ${String(at)}`,
      checked,
    });
  }

  // A cut TAIL, against the head the run recorded for itself.
  const head = options.head;
  if (head !== undefined) {
    const newest = records[records.length - 1];
    if (checked < head.seq || newest === undefined || Number(newest.seq) < head.seq) {
      return frozen({
        ok: false,
        fault: "truncated",
        at: checked,
        detail: `the run appended seq ${String(head.seq)}; the ledger ends at seq ${String(
          newest === undefined ? 0 : newest.seq,
        )}`,
        checked,
      });
    }
    if (head.hash !== undefined && recordHashOf(newest) !== head.hash) {
      return frozen({
        ok: false,
        fault: "edited",
        at: checked,
        detail: "the newest record is not the one the run appended",
        checked,
      });
    }
  }

  // The chain and the signature: either failing means EDITED bytes.
  for (let i = 0; i < records.length; i++) {
    const record = records[i] as LedgerRecord;
    const before = records[i - 1];
    const expectedPrev = before === undefined ? GENESIS_PREV : recordHashOf(before);
    if (String(record.prev) !== expectedPrev) {
      return frozen({
        ok: false,
        fault: "edited",
        at: i + 1,
        detail: `the record at seq ${String(record.seq)} is not chained to the one before`,
        checked,
      });
    }
    if (options.key !== undefined && !signatureIsValid(options.key, record)) {
      return frozen({
        ok: false,
        fault: "edited",
        at: i + 1,
        detail: `the signature of the record at seq ${String(record.seq)} does not verify`,
        checked,
      });
    }
  }
  return frozen({ ok: true, checked });
}

function frozen(verdict: LedgerVerdict): LedgerVerdict {
  return Object.freeze(verdict);
}

/* ------------------------------------------------------------------ *
 * The effect of an invalid ledger (F103-FR-039, F103-SC-009).
 * ------------------------------------------------------------------ */

/** F103-FR-039 — the effect, in the words of the requirement. */
export const EFFECT_OF_AN_INVALID_LEDGER = "every-loop-layer-off-for-the-phase-attempt" as const;

/** F103-FR-039 — and NEVER a stop. */
export const AN_INVALID_LEDGER_STOPS_THE_RUN = false as const;

/** The reason of the closed set of F103-FR-027 that an invalid ledger is. */
export const OFF_REASON_OF_AN_INVALID_LEDGER: OffReason = "invalid-ledger";

/** The scope that reason switches a layer off for: the phase attempt. */
export const OFF_SCOPE_OF_AN_INVALID_LEDGER = SCOPE_OF_REASON["invalid-ledger"];

/** What an invalid ledger does, and what it carries: no run state at all. */
export type InvalidLedgerEffect = {
  /** One off record per registered layer, all for the phase attempt. */
  readonly layersOff: readonly LayerOffRecord[];
  /** The events announced with them (F103-FR-039: "with an event"). */
  readonly events: readonly ReturnType<typeof offEvent>[];
  /** The event that announces the fault itself. */
  readonly faultEvent: {
    readonly asIsName: string;
    readonly fields: Readonly<Record<string, unknown>>;
  };
  /** F103-FR-039 — never a stop. All three are absent, by construction. */
  readonly exit_code: undefined;
  readonly stopReason: undefined;
  readonly runState: undefined;
  readonly stops: false;
};

/**
 * F103-FR-039 and F103-SC-009 — an invalid ledger switches EVERY loop layer
 * off for the phase attempt, with an event, and stops nothing.
 *
 * The three run-state fields are present and `undefined` on purpose: a caller
 * that destructures them gets nothing, and a test can assert that the shape
 * carries no exit code and no stop reason rather than trusting prose.
 */
export function effectOfAnInvalidLedger(
  verdict: LedgerVerdict,
  registeredLayers: readonly string[],
): InvalidLedgerEffect {
  const scope = OFF_SCOPE_OF_AN_INVALID_LEDGER;
  const layersOff = Object.freeze(
    registeredLayers.map((layer) =>
      Object.freeze({
        layer,
        reason: OFF_REASON_OF_AN_INVALID_LEDGER,
        scope,
        announcement: offAnnouncement(layer, OFF_REASON_OF_AN_INVALID_LEDGER, scope),
      } satisfies LayerOffRecord),
    ),
  );
  return Object.freeze({
    layersOff,
    events: Object.freeze(layersOff.map((record) => offEvent(record))),
    faultEvent: Object.freeze({
      asIsName: "ledger.invalid",
      fields: Object.freeze({
        fault: verdict.fault,
        at: verdict.at,
        detail: verdict.detail,
        checked: verdict.checked,
        effect: EFFECT_OF_AN_INVALID_LEDGER,
      }),
    }),
    exit_code: undefined,
    stopReason: undefined,
    runState: undefined,
    stops: false as const,
  });
}

/* ------------------------------------------------------------------ *
 * One record per phase attempt.
 * ------------------------------------------------------------------ */

/** The records of one phase attempt, in the order of the ledger. */
export function recordsOfAttempt(
  records: readonly LedgerRecord[],
  attemptId: string,
  namespace: string = NAMESPACE,
): readonly LedgerRecord[] {
  return Object.freeze(
    records.filter((r) => r.ns === namespace && String(r.attemptId ?? "") === attemptId),
  );
}

/** How many records of the namespace `core` each phase attempt has. */
export function recordsPerPhaseAttempt(
  records: readonly LedgerRecord[],
  namespace: string = NAMESPACE,
): ReadonlyMap<string, number> {
  const counted = new Map<string, number>();
  for (const record of records) {
    if (record.ns !== namespace) continue;
    const attempt = String(record.attemptId ?? "");
    if (attempt === "") continue;
    counted.set(attempt, (counted.get(attempt) ?? 0) + 1);
  }
  return Object.freeze(counted);
}

/**
 * F103-FR-039 — "With every layer off the ledger MUST hold at least one record
 * per phase attempt." The attempts are handed in, so the check is over the
 * attempts that HAPPENED and not only over the ones the ledger mentions: an
 * attempt with no record at all is exactly the failure this guards.
 */
export function atLeastOneRecordPerPhaseAttempt(
  records: readonly LedgerRecord[],
  attempts: readonly string[],
): { readonly ok: boolean; readonly missing: readonly string[] } {
  const counted = recordsPerPhaseAttempt(records);
  const missing = attempts.filter((attempt) => (counted.get(attempt) ?? 0) < 1);
  return Object.freeze({ ok: missing.length === 0, missing: Object.freeze(missing) });
}

/* ------------------------------------------------------------------ *
 * The tail, for the handoff and for the prompt.
 * ------------------------------------------------------------------ */

/** How many lines of the ledger the handoff carries by default. */
export const TAIL_LINES_DEFAULT = 12 as const;

/** One record as one line: what the handoff and the prompt block carry. */
export function ledgerLine(record: LedgerRecord): string {
  const counters = readCounts(record.counters);
  const where = [
    record.phase === undefined ? undefined : `phase ${String(record.phase)}`,
    record.attemptId === undefined ? undefined : `attempt ${String(record.attemptId)}`,
    record.passId === undefined ? undefined : `pass ${String(record.passId)}`,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
  return (
    `#${String(record.seq)} ${String(record.ts)} ${String(record.ns)}/${String(record.kind)}` +
    (where === "" ? "" : ` ${where}`) +
    ` passIndex=${String(counters.passIndex)} errors=${String(counters.errorCount)}` +
    ` caps=${String(counters.capCount)} noProgress=${String(counters.noProgressCount)}`
  );
}

/** The last lines of the ledger, oldest first — the handoff's `ledgerTail`. */
export function ledgerTail(
  records: readonly LedgerRecord[],
  lines: number = TAIL_LINES_DEFAULT,
): readonly string[] {
  if (lines <= 0) return Object.freeze([]);
  return Object.freeze(records.slice(-lines).map((record) => ledgerLine(record)));
}

/** The counters at the start of a phase attempt, for an `attempt-open` record. */
export const COUNTS_AT_AN_ATTEMPT_OPEN = ZERO_COUNTS;
