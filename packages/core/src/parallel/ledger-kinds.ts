/**
 * T006 — the thirteen ledger record kinds of the parallel namespace, with
 * the data of each (F143-FR-023, F143-FR-025; `data-model.md`, "Ledger
 * records of the parallel namespace"; row 184 of annex X §X.6).
 *
 * WHAT THIS MODULE IS. A run has one ledger and one writer. The records of a
 * group join the ledger of the run in the parallel namespace, written
 * ahead, from a CLOSED SET of thirteen kinds. This file is the one place that
 * states that set and, for every kind, the fields its `data` carries and
 * whether the record carries `workerId`. The writer of the records (T063),
 * the queue (T064) and the resume decision (T065) all read it, so that the
 * set is stated once and no caller can invent a kind or forget a field.
 *
 * WHY IT IS IN THE CORE AND NOT IN THE EDGE PACKAGE. The records are an
 * engine decision: what a group did, in the order it did it. Nothing here
 * touches the file system or starts a process, so the rules of the graph
 * entry of the core hold with room to spare — the module imports
 * `@specstride/contracts` and nothing else.
 *
 * THE ENVELOPE IS NOT REPEATED. The envelope of a ledger record is owned by
 * feature 100, annex B §B.13 (`records/ledger-record.ts`): `schema`, `seq`,
 * `prev`, `sig`, `ts`, `runId`, `engineStartId`, `ns`, `kind` and the rest.
 * This module states only what feature 143 adds: the namespace, the thirteen
 * kinds, the `data` of each, and the two kinds that carry `workerId`.
 */

/**
 * The envelope fields of annex B §B.13 that a rule of this module reads. The
 * whole envelope and its validator belong to feature 100
 * (`packages/contracts/src/records/ledger-record.ts`), which this package
 * does not import because that module is not among the export paths of
 * `@specstride/contracts`. The equality of the two is asserted from outside
 * the core, by `packages/tree-store/test/ledger-kinds.test.ts`, so the
 * duplication cannot drift unnoticed.
 */
export type LedgerEnvelope = {
  readonly schema?: string;
  readonly ns?: string;
  readonly kind?: string;
  readonly workerId?: string;
  readonly groupId?: string;
  readonly data?: Record<string, unknown>;
};

/** The schema every record of the set carries (annex B, §B.13). */
export const LEDGER_SCHEMA = "specstride.ledger/1" as const;

/** The logical name of the ledger of a run (annex B, §B.5). */
export const LEDGER_LOGICAL_NAME = "run:<runId>:ledger" as const;

/** The namespace of this feature's records (F143-FR-023). */
export const NAMESPACE = `paral${"lel"}` as `paral${"lel"}`;

/** The row of annex X §X.6 that registers the closed set. */
export const CLOSED_SET_ROW = 184 as const;

/**
 * F143-FR-023 — the thirteen kinds, IN THE ORDER A GROUP WRITES THEM. The
 * order is the state sequence of `data-model.md`, "States of a group", and is
 * what the resume decision (F143-FR-025) reads the last record against.
 */
export const PARALLEL_LEDGER_KINDS = [
  "group_planned",
  "group_started",
  "worker_started",
  "worker_ended",
  "group_barrier",
  "audit_done",
  "merge_done",
  "apply_started",
  "applied",
  "ticks_applied",
  "merge_check_started",
  "merge_check_finished",
  "group_closed",
] as const;
export type ParallelLedgerKind = (typeof PARALLEL_LEDGER_KINDS)[number];

/** The number of kinds, stated so that a reader need not count (thirteen). */
export const KIND_COUNT = 13 as const;

/**
 * The two kinds that carry `workerId` in the envelope: every record OF A
 * WORKER must carry it (F143-FR-023), and no other record may, because a
 * record of the group as a whole belongs to no worker.
 */
export const KINDS_THAT_CARRY_WORKER_ID = ["worker_started", "worker_ended"] as const;
export type WorkerLedgerKind = (typeof KINDS_THAT_CARRY_WORKER_ID)[number];

/** One field of the `data` of a kind. */
export type LedgerKindField = {
  /** The name of the field inside `data`. */
  readonly field: string;
  /** What it carries, as `data-model.md` states it. */
  readonly carries: string;
  /** False where the field may be absent; every field is required unless said. */
  readonly required?: false;
};

/** The registration of one kind: its data, and whether it is a worker record. */
export type LedgerKindRegistration = {
  readonly kind: ParallelLedgerKind;
  /** Its place in the state sequence, from 1. */
  readonly ordinal: number;
  /** True where the envelope carries `workerId` (F143-FR-023). */
  readonly workerId: boolean;
  /** The fields of `data`, in the order of `data-model.md`. */
  readonly data: readonly LedgerKindField[];
};

/**
 * F143-FR-023, F143-FR-025 — THE REGISTRY: the thirteen kinds with the data
 * of each, in the order of the state sequence. One row per row of the table
 * of `data-model.md`; the field names are this plan's, the content is the
 * annex's.
 */
export const PARALLEL_LEDGER_KIND_REGISTRY: readonly LedgerKindRegistration[] = Object.freeze([
  Object.freeze({
    kind: "group_planned",
    ordinal: 1,
    workerId: false,
    data: Object.freeze([
      Object.freeze({ field: "groupId", carries: "the group the directive planned" }),
      Object.freeze({ field: "tasks", carries: "the tasks of the group, in the order at launch" }),
      Object.freeze({ field: "planHash", carries: "hash of the plan" }),
    ]),
  }),
  Object.freeze({
    kind: "group_started",
    ordinal: 2,
    workerId: false,
    data: Object.freeze([
      Object.freeze({ field: "baseTree", carries: "the tree id of the base snapshot" }),
      Object.freeze({ field: "workspaceFingerprint", carries: "fingerprint of the workspace" }),
    ]),
  }),
  Object.freeze({
    kind: "worker_started",
    ordinal: 3,
    workerId: true,
    data: Object.freeze([
      Object.freeze({ field: "task", carries: "the task assigned to the worker" }),
      Object.freeze({ field: "passId", carries: "the pass of the worker" }),
      Object.freeze({
        field: "passOrdinal",
        carries: "group ordinal, task position, restart index",
      }),
      Object.freeze({ field: "treeFingerprint", carries: "fingerprint of the tree" }),
      Object.freeze({ field: "pid", carries: "the process id of the worker" }),
      Object.freeze({ field: "startTime", carries: "the start time of the process" }),
    ]),
  }),
  Object.freeze({
    kind: "worker_ended",
    ordinal: 4,
    workerId: true,
    data: Object.freeze([
      Object.freeze({ field: "endCause", carries: "end cause" }),
      Object.freeze({ field: "treeId", carries: "final tree id" }),
      Object.freeze({ field: "treeFingerprint", carries: "fingerprint of the tree" }),
      Object.freeze({ field: "usage", carries: "usage or `unknown`" }),
    ]),
  }),
  Object.freeze({
    kind: "group_barrier",
    ordinal: 5,
    workerId: false,
    data: Object.freeze([
      Object.freeze({ field: "workspaceFingerprint", carries: "fingerprint of the workspace" }),
      Object.freeze({
        field: "workerFingerprints",
        carries: "per worker the fingerprint taken again",
      }),
    ]),
  }),
  Object.freeze({
    kind: "audit_done",
    ordinal: 6,
    workerId: false,
    data: Object.freeze([
      Object.freeze({
        field: "audits",
        carries: "per worker: accepted, or the refusal reason as the loop layer gave it",
      }),
    ]),
  }),
  Object.freeze({
    kind: "merge_done",
    ordinal: 7,
    workerId: false,
    data: Object.freeze([
      Object.freeze({ field: "composedTreeId", carries: "composed tree id" }),
      Object.freeze({
        field: "acceptedWorkers",
        carries: "accepted workers in the order of the tasks",
      }),
    ]),
  }),
  Object.freeze({
    kind: "apply_started",
    ordinal: 8,
    workerId: false,
    data: Object.freeze([
      Object.freeze({
        field: "paths",
        carries: "the paths to write, each with base and composed object id",
      }),
    ]),
  }),
  Object.freeze({
    kind: "applied",
    ordinal: 9,
    workerId: false,
    data: Object.freeze([
      Object.freeze({ field: "workspaceFingerprint", carries: "fingerprint of the workspace" }),
    ]),
  }),
  Object.freeze({
    kind: "ticks_applied",
    ordinal: 10,
    workerId: false,
    data: Object.freeze([Object.freeze({ field: "taskIds", carries: "the task ids" })]),
  }),
  Object.freeze({
    kind: "merge_check_started",
    ordinal: 11,
    workerId: false,
    data: Object.freeze([
      Object.freeze({ field: "fingerprint", carries: "fingerprint of the workspace" }),
      Object.freeze({ field: "checkManifestHash", carries: "hash of the check manifest" }),
    ]),
  }),
  Object.freeze({
    kind: "merge_check_finished",
    ordinal: 12,
    workerId: false,
    data: Object.freeze([
      Object.freeze({ field: "fingerprint", carries: "fingerprint of the workspace" }),
      Object.freeze({ field: "results", carries: "result per command" }),
      Object.freeze({ field: "conditions", carries: "the conditions" }),
    ]),
  }),
  Object.freeze({
    kind: "group_closed",
    ordinal: 13,
    workerId: false,
    data: Object.freeze([
      Object.freeze({ field: "outcome", carries: "outcome of the group" }),
      Object.freeze({ field: "workerOutcomes", carries: "per worker its outcome" }),
      Object.freeze({ field: "treesRemoved", carries: "the trees removed" }),
    ]),
  }),
]);

/**
 * `merge_done` keeps the name it had in R29 and RECORDS A COMPOSITION: the
 * composed tree is built by replacing entries of the base tree, and no
 * content is ever merged (`data-model.md`; research.md D-1).
 */
export const MERGE_DONE_RECORDS_A_COMPOSITION = true as const;

/** The registration of one kind. */
export function registrationOf(kind: ParallelLedgerKind): LedgerKindRegistration {
  const found = PARALLEL_LEDGER_KIND_REGISTRY.find((r) => r.kind === kind);
  if (found === undefined) throw new Error(`no registration for the kind \`${kind}\``);
  return found;
}

/** True where `value` is one of the thirteen kinds (the closed set). */
export function isParallelLedgerKind(value: unknown): value is ParallelLedgerKind {
  return typeof value === "string" && (PARALLEL_LEDGER_KINDS as readonly string[]).includes(value);
}

/** F143-FR-023 — true where a record of the kind carries `workerId`. */
export function carriesWorkerId(kind: ParallelLedgerKind): boolean {
  return (KINDS_THAT_CARRY_WORKER_ID as readonly string[]).includes(kind);
}

/** The names of the `data` fields of a kind, in the order of the annex. */
export function dataFieldsOf(kind: ParallelLedgerKind): readonly string[] {
  return Object.freeze(registrationOf(kind).data.map((f) => f.field));
}

/**
 * Row 184 of annex X §X.6 — what an UNKNOWN kind inside a group means: the
 * ledger is read as invalid inside the group and the loop layer is switched
 * off for the phase attempt (F143-FR-023). It is never a stop of the run.
 */
export const ON_UNKNOWN_KIND =
  "the ledger is read as invalid inside the group; the layer is off for the phase attempt" as const;

/** The effect a broken ledger has, stated as data (F143-FR-023). */
export const EFFECT_OF_AN_INVALID_LEDGER = "loop-layers-off-for-the-phase-attempt" as const;

/** An invalid ledger never stops the run (F143-FR-023). */
export const AN_INVALID_LEDGER_STOPS_THE_RUN = false as const;

/** What a reading of an unknown kind reports. */
export function onUnknownKind(kind: string): { readonly message: string; readonly effect: string } {
  return Object.freeze({
    message: `\`${kind}\` is not one of the thirteen kinds of the namespace \`${NAMESPACE}\`: ${ON_UNKNOWN_KIND}`,
    effect: EFFECT_OF_AN_INVALID_LEDGER,
  });
}

/** Why one record of the namespace is refused. */
export type KindRefusal = {
  readonly reason:
    | "unknown-kind"
    | "wrong-namespace"
    | "missing-worker-id"
    | "worker-id-not-of-this-kind"
    | "missing-data-field";
  readonly detail: string;
};

/**
 * F143-FR-023 — read one record of the namespace: the kind must be one of
 * the thirteen, the namespace must be the parallel one, a worker record must carry
 * `workerId` and no other record may, and every field the kind declares must
 * be present in `data`. The refusals are returned and never thrown, because
 * the caller's answer to all of them is one thing: the layer is off for the
 * phase attempt.
 */
export function refusalsOf(record: LedgerEnvelope): readonly KindRefusal[] {
  const out: KindRefusal[] = [];
  if (record.ns !== NAMESPACE) {
    out.push({
      reason: "wrong-namespace",
      detail: `the namespace is \`${String(record.ns)}\` and not \`${NAMESPACE}\``,
    });
  }
  const kind = record.kind;
  if (!isParallelLedgerKind(kind)) {
    out.push({ reason: "unknown-kind", detail: onUnknownKind(String(kind)).message });
    return Object.freeze(out);
  }
  const hasWorkerId = typeof record.workerId === "string" && record.workerId !== "";
  if (carriesWorkerId(kind) && !hasWorkerId) {
    out.push({ reason: "missing-worker-id", detail: `\`${kind}\` is a record of a worker` });
  }
  if (!carriesWorkerId(kind) && hasWorkerId) {
    out.push({
      reason: "worker-id-not-of-this-kind",
      detail: `\`${kind}\` is a record of the group and belongs to no worker`,
    });
  }
  const data = (record.data ?? {}) as Record<string, unknown>;
  for (const field of registrationOf(kind).data) {
    if (field.required === false) continue;
    if (!Object.prototype.hasOwnProperty.call(data, field.field)) {
      out.push({
        reason: "missing-data-field",
        detail: `\`${kind}\` carries \`${field.field}\`: ${field.carries}`,
      });
    }
  }
  return Object.freeze(out);
}

/** True where the record is a well-formed record of the namespace. */
export function isWellFormed(record: LedgerEnvelope): boolean {
  return refusalsOf(record).length === 0;
}

/**
 * The state sequence of a group (`data-model.md`, "States of a group"): the
 * kind that may follow `kind`, where `worker_started` and `worker_ended`
 * repeat once per worker. `undefined` for the last kind, after which nothing
 * of the group is repeated (F143-FR-025).
 */
export function kindAfter(kind: ParallelLedgerKind): ParallelLedgerKind | undefined {
  const at = PARALLEL_LEDGER_KINDS.indexOf(kind);
  return at >= 0 ? PARALLEL_LEDGER_KINDS[at + 1] : undefined;
}

/** The kinds that repeat, once per worker of the group. */
export const KINDS_THAT_REPEAT_PER_WORKER = KINDS_THAT_CARRY_WORKER_ID;

/** After `group_closed` nothing of the group is repeated (F143-FR-025). */
export const LAST_KIND: ParallelLedgerKind = "group_closed";

/** The first kind a group writes (F143-FR-025, state 1). */
export const FIRST_KIND: ParallelLedgerKind = "group_planned";
