/**
 * T014 — the guard that hands the writers of the phase gate to the phase gate
 * only (feature 149, F149-FR-007; R23, invariants IR-01 and IR-06).
 *
 * F149-FR-007, first sentence: "The writers of the phase gate (approval
 * record, verdict record, feedback, hint, recovery markers) MUST be handed to
 * the phase gate only. No loop layer, no router, no critic strategy and no
 * planner MUST hold one."
 *
 * The rule is kept in two ways, and this module holds both:
 *
 * | Way | What holds it |
 * |---|---|
 * | Static | `tools/import-boundary/rules/gate-writers-149.json` (T007): no source file of a loop layer, a router, a critic strategy or a planner imports a module of `GATE_WRITER_MODULES`. `check:imports` fails the build on one |
 * | At run time | `gateWritersFor` below: the bundle of the five writers is handed out to a holder of the kind `phase-gate` and refused to every other kind, and `withoutGateWriters` builds the services of a layer, a router, a strategy or a planner so that none of them carries one |
 *
 * The second invariant of F149-FR-007 that belongs to the writers is IR-06:
 * "No event of a loop layer MUST change the reject count, the ordinal of a
 * phase attempt, the MALFORMED streak, the input of the oscillation halt, the
 * signature of the diagnostician, or the count of the bump." Those six counts
 * are `COUNTS_OF_THE_PHASE_GATE`, and `recordLayerEvent` is the one way a
 * layer's event reaches the ledger: in the layer's own namespace, with no
 * `counters` field at all.
 *
 * The module reads no file and starts no process: it is handed the writers and
 * returns them or refuses them (F100-FR-012, F100-FR-234).
 */
import { writerOf } from "@specstride/contracts/ids/logical-names";

/* ------------------------------------------------------------------ *
 * The five writers of the phase gate, and the records they write.
 * ------------------------------------------------------------------ */

/** The five writers F149-FR-007 names, in the order of the requirement. */
export const GATE_WRITER_IDS = [
  "approval",
  "verdict",
  "feedback",
  "hint",
  "recovery-markers",
] as const;
export type GateWriterId = (typeof GATE_WRITER_IDS)[number];

/**
 * The record each writer writes, by logical name (annex B §B.5). The layout of
 * feature 100 names ONE writer for every one of them, which is what the static
 * test of CT-149-7 reads through `theWriterOfTheGateRecords`.
 */
export const GATE_RECORDS: Readonly<Record<GateWriterId, string>> = Object.freeze({
  approval: "gate:<N>:approved",
  verdict: "attempt:<N>:<k>:<n>:verdict",
  feedback: "attempt:<N>:<k>:<n>:feedback",
  hint: "attempt:<N>:<k>:<n>:hint",
  "recovery-markers": "phase:<N>:recovery-markers",
});

/** The logical names of the records of the phase gate, in the order above. */
export const GATE_RECORD_NAMES: readonly string[] = Object.freeze(
  GATE_WRITER_IDS.map((id) => GATE_RECORDS[id]),
);

/**
 * The modules that hold the writers. They are the `forbid` list of
 * `tools/import-boundary/rules/gate-writers-149.json` (T007) and they belong
 * to the first part of the split of feature 101, which owns the phase gate.
 */
export const GATE_WRITER_MODULES = [
  "packages/core/src/gate/writers.ts",
  "packages/core/src/approval/record.ts",
] as const;

/* ------------------------------------------------------------------ *
 * Who may hold a writer.
 * ------------------------------------------------------------------ */

/** The kinds of holder the engine builds services for. */
export const HOLDER_KINDS = [
  "phase-gate",
  "loop-layer",
  "router",
  "critic-strategy",
  "attempt-planner",
] as const;
export type HolderKind = (typeof HOLDER_KINDS)[number];

/** The one kind that is handed the writers (F149-FR-007). */
export const THE_ONLY_HOLDER: HolderKind = "phase-gate";

/** The four kinds F149-FR-007 names that never hold one. */
export const HOLDERS_THAT_NEVER_HOLD_A_WRITER: readonly HolderKind[] = Object.freeze([
  "loop-layer",
  "router",
  "critic-strategy",
  "attempt-planner",
]);

/**
 * True only for the phase gate. A kind outside the closed set is read as a
 * holder that may NOT hold a writer: the safe answer is the one that keeps the
 * writers where they are.
 */
export function mayHoldTheGateWriters(kind: string): boolean {
  return kind === THE_ONLY_HOLDER;
}

/** The holder that asks for the writers. */
export type Holder = {
  readonly id: string;
  readonly kind: string;
};

/** A writer of the phase gate, as the guard passes it on: opaque to the guard. */
export type GateWriter = (record: Readonly<Record<string, unknown>>) => void;

/** The bundle of the five writers. */
export type GateWriters = Readonly<Record<GateWriterId, GateWriter>>;

/** The refusal of a holder that is not the phase gate (F149-FR-007). */
export class GateWritersRefused extends Error {
  readonly holder: string;
  readonly holderKind: string;
  readonly refusedWriters: readonly GateWriterId[];
  constructor(holder: Holder) {
    super(
      `the writers of the phase gate are not handed to \`${holder.id}\`: it is a ` +
        `\`${holder.kind}\`, and the writers (${GATE_WRITER_IDS.join(", ")}) are handed to ` +
        `the \`${THE_ONLY_HOLDER}\` only (F149-FR-007; R23 IR-01)`,
    );
    this.name = "GateWritersRefused";
    this.holder = holder.id;
    this.holderKind = holder.kind;
    this.refusedWriters = GATE_WRITER_IDS;
  }
}

/**
 * Hand the writers of the phase gate to a holder. The phase gate receives the
 * bundle, frozen; every other holder is REFUSED, whatever it is called. This
 * is the run-time half of IR-01: the static half is the import rule of T007.
 */
export function gateWritersFor(holder: Holder, writers: GateWriters): GateWriters {
  if (!mayHoldTheGateWriters(holder.kind)) throw new GateWritersRefused(holder);
  return Object.freeze({ ...writers });
}

/** What `withoutGateWriters` removed from a bundle of services. */
export type ServicesWithoutGateWriters<T> = {
  /** The services as the holder receives them: no writer of the phase gate. */
  readonly services: T;
  /** The names that were removed, in the order of `GATE_WRITER_IDS`. */
  readonly removed: readonly string[];
};

/**
 * Build the services of a loop layer, a router, a critic strategy or a planner:
 * the same record WITHOUT any writer of the phase gate. A key is a writer when
 * it is one of `GATE_WRITER_IDS`, or when it is the name of a function that
 * writes one of the five records (`writeVerdict`, `verdictWriter`, …). The
 * removal is reported, so that the engine can record what a holder did not get.
 */
export function withoutGateWriters<T extends Readonly<Record<string, unknown>>>(
  services: T,
): ServicesWithoutGateWriters<Partial<T>> {
  const kept: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(services)) {
    if (keyIsAGateWriter(key)) removed.push(key);
    else kept[key] = value;
  }
  return Object.freeze({
    services: Object.freeze(kept) as Partial<T>,
    removed: Object.freeze(removed),
  });
}

/**
 * True when the name of a service is a writer of the phase gate. The name is
 * read as words, so that `writeVerdictRecord`, `verdict_writer` and
 * `recoveryMarkersWriter` are all the same subject as `verdict` and
 * `recovery-markers`.
 */
export function keyIsAGateWriter(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  const subjects = ["approval", "verdict", "feedback", "hint", "recovery marker"];
  return subjects.some((subject) => words.includes(subject));
}

/* ------------------------------------------------------------------ *
 * The static side: one writer of the records of the phase gate.
 * ------------------------------------------------------------------ */

/**
 * The writers the layout of annex B §B.5 names for the five records of the
 * phase gate, deduplicated. F149-FR-007 holds when this list has exactly one
 * member: one component writes all five.
 */
export function writersOfTheGateRecords(): readonly string[] {
  return Object.freeze([...new Set(GATE_RECORD_NAMES.map((name) => writerOf(name)))]);
}

/** True when the five records of the phase gate have exactly one writer. */
export function gateRecordsHaveOneWriter(): boolean {
  return writersOfTheGateRecords().length === 1;
}

/**
 * The one writer of the records of the phase gate. Throws where the layout
 * names more than one: that is a breach of F149-FR-007 and not a value to
 * carry on with.
 */
export function theWriterOfTheGateRecords(): string {
  const writers = writersOfTheGateRecords();
  if (writers.length !== 1) {
    throw new Error(
      `the records of the phase gate (${GATE_RECORD_NAMES.join(", ")}) have ` +
        `${String(writers.length)} writers in the layout of annex B §B.5 ` +
        `(${writers.join(", ")}); F149-FR-007 asks for one`,
    );
  }
  return writers[0] as string;
}

/* ------------------------------------------------------------------ *
 * IR-06 — the counts of the phase gate, which no event of a layer moves.
 * ------------------------------------------------------------------ */

/**
 * The six counts F149-FR-007 names, by the key each is held under:
 *
 * | Count of the requirement | Key |
 * |---|---|
 * | the reject count | `rejectCount` (the ledger, namespace `core`) |
 * | the ordinal of a phase attempt | `phaseAttemptOrdinal` |
 * | the MALFORMED streak | `malformedStreak` |
 * | the input of the oscillation halt | `sequence-of-phase-attempts` (§B.13) |
 * | the signature of the diagnostician | `diagnosed` (the recovery markers) |
 * | the count of the bump | `criticRejections` (F149-FR-004) |
 */
export const COUNTS_OF_THE_PHASE_GATE = [
  "rejectCount",
  "phaseAttemptOrdinal",
  "malformedStreak",
  "sequence-of-phase-attempts",
  "diagnosed",
  "criticRejections",
] as const;
export type CountOfThePhaseGate = (typeof COUNTS_OF_THE_PHASE_GATE)[number];

/** The namespace of the ledger the counts of the phase gate live in (§B.13). */
export const CORE_NAMESPACE = "core" as const;

/** A snapshot of the counts of the phase gate, frozen. */
export type CountsSnapshot = Readonly<Record<string, unknown>>;

/**
 * The snapshot CT-149-7 takes before and after every event of a layer. Every
 * count of `COUNTS_OF_THE_PHASE_GATE` is in it; one that is not held is 0.
 */
export function snapshotOfTheCounts(state: Readonly<Record<string, unknown>>): CountsSnapshot {
  const out: Record<string, unknown> = {};
  for (const name of COUNTS_OF_THE_PHASE_GATE) {
    const held = state[name];
    out[name] = held === undefined ? 0 : frozenCopy(held);
  }
  return Object.freeze(out);
}

/** The counts that differ between two snapshots, by name. */
export function countsThatChanged(
  before: CountsSnapshot,
  after: CountsSnapshot,
): readonly string[] {
  return Object.freeze(
    COUNTS_OF_THE_PHASE_GATE.filter(
      (name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]),
    ),
  );
}

/** One event of a loop layer, as the engine receives it from a call point. */
export type LayerEvent = {
  /** The id of the layer the event came from. */
  readonly layerId: string;
  /** The kind of the record, from the closed set of the layer's namespace. */
  readonly kind: string;
  /** The content of the kind. */
  readonly data?: Readonly<Record<string, unknown>>;
};

/** The ledger record the engine appends for one event of a layer (§B.13). */
export type LayerLedgerRecord = {
  /** The namespace is the id of the layer, never `core` (§B.13). */
  readonly ns: string;
  readonly kind: string;
  readonly data: Readonly<Record<string, unknown>>;
};

/** IR-06, as a constant the test reads: an event of a layer moves no count. */
export const A_LAYER_EVENT_CHANGES_A_COUNT = false as const;

/**
 * Record one event of a loop layer, and return the counts of the phase gate as
 * they stand afterwards.
 *
 * The record goes into the layer's OWN namespace and carries no `counters`
 * field, so there is no path by which an event of a layer could move a count of
 * the phase gate: the counts come back as they went in, whatever the event
 * carried. An event that names the namespace `core`, or that carries counters,
 * is refused — it is the layer trying to write where the phase gate writes.
 */
export function recordLayerEvent(
  before: CountsSnapshot,
  event: LayerEvent,
): { readonly record: LayerLedgerRecord; readonly counts: CountsSnapshot } {
  if (event.layerId === CORE_NAMESPACE) {
    throw new GateWritersRefused({ id: event.layerId, kind: "loop-layer" });
  }
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.data ?? {})) {
    // A count of the phase gate never travels in an event of a layer, and
    // neither does a writer of the phase gate.
    if ((COUNTS_OF_THE_PHASE_GATE as readonly string[]).includes(key)) continue;
    if (key === "counters" || keyIsAGateWriter(key)) continue;
    data[key] = value;
  }
  return Object.freeze({
    record: Object.freeze({
      ns: event.layerId,
      kind: event.kind,
      data: Object.freeze(data),
    }),
    // The counts are the phase gate's: an event of a layer returns them whole.
    counts: Object.freeze({ ...before }),
  });
}

/** A frozen copy of a value, at every depth. */
function frozenCopy(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(value)) out[key] = frozenCopy(held);
    return Object.freeze(out);
  }
  return value;
}
