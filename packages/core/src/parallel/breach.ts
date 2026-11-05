/**
 * T090 — the five breach conditions of gate integrity, checked on the event
 * file (feature 142, F142-FR-071; rules PU-66, PU-80).
 *
 * F142-FR-071 — a breach of gate integrity, for the tripwire and for the rule of
 * immediate return, is **also** each of:
 *
 *  1. a delta applied that did not pass the audits;
 *  2. a workspace after the application that differs from the integrated tree;
 *  3. an integrated tree that holds a path or an object of no audited delta
 *     (the condition PU-80 added when composition replaced merge);
 *  4. a kept unit of work for a merge check that ran while a process of a worker
 *     was known to live;
 *  5. an input of a critic-class call that holds a withheld field.
 *
 * An act that was **detected and refused** is an event and not a breach: the
 * whole point of the audits is that a refused delta leaves no trace in the
 * workspace, and a run full of refusals is a run that worked.
 *
 * Each condition is checked on the event file of **every** run, by the doctor
 * and in the build. This module is that check: it reads a list of event records
 * — the lines of the event file, already parsed — and returns the breaches. It
 * holds no file access of its own (the package is `core`), so the doctor and the
 * build hand it the records they read.
 */

import { rowOf } from "@specstride/contracts/enums";

/* ================================================================== *
 * 1. The five conditions.
 * ================================================================== */

/** The five conditions of F142-FR-071, in the order of the requirement. */
export const BREACH_CONDITIONS = Object.freeze([
  "a delta applied that did not pass the audits",
  "a workspace after the application that differs from the integrated tree",
  "an integrated tree that holds a path or an object of no audited delta",
  "a kept unit of work for a merge check that ran while a process of a worker was known to live",
  "an input of a critic-class call that holds a withheld field",
] as const);
export type BreachCondition = (typeof BREACH_CONDITIONS)[number];

/** The number of conditions this feature adds (F142-FR-071). */
export const CONDITIONS_ADDED = 5 as const;

/** The two rules of feature 100 the conditions are added to (F142-FR-071). */
export const ADDED_TO = Object.freeze(["the tripwire", "the rule of immediate return"] as const);

/** F142-FR-071 — an act that was detected and refused is an event and not a breach. */
export const A_DETECTED_AND_REFUSED_ACT_IS_A_BREACH = false as const;

/** Who checks the conditions, on the event file of every run (F142-FR-071). */
export const CHECKED_BY = Object.freeze(["the doctor", "the build"] as const);

/** The condition of an ordinal, 1 to 5 as the requirement lists them. */
export function conditionOf(ordinal: 1 | 2 | 3 | 4 | 5): BreachCondition {
  return BREACH_CONDITIONS[ordinal - 1]!;
}

/* ================================================================== *
 * 2. The records of the event file the check reads.
 * ================================================================== */

/**
 * One record of the event file, as the doctor and the build read it. A record of
 * a run carries more; only what the five conditions read is named.
 *
 * The field the check keys on is `kind`, which is how the records of the ledger
 * namespaces reach the event file, and `type` is accepted as its alias so that a
 * reader that holds the row-74 event types can be passed in unchanged.
 */
export type EventRecord = {
  /** The kind of the record, from the namespace the table below names. */
  readonly kind?: string;
  /** The type of the event, where the record is one of row 74 of annex X §X.6. */
  readonly type?: string;
  readonly seq?: number;
  readonly data?: Readonly<Record<string, unknown>>;
};

/** The kind of a record: its `kind`, or its `type` where it carries no `kind`. */
export function kindOf(record: EventRecord): string {
  return record.kind ?? record.type ?? "";
}

/** The row of annex X §X.6 that holds the record kinds of the parallel namespace. */
export const LEDGER_KIND_ROW = 184 as const;

/**
 * The record kinds the five conditions read, each with where it comes from. The
 * five of the parallel namespace are members of row 184 of annex X §X.6, which
 * `kindsNotInRow184` asserts; the other three come from where their own
 * requirement puts them, and the table says so rather than pretending they are
 * row-184 members.
 */
export const RECORD_KINDS = Object.freeze([
  Object.freeze({ kind: "audit_done", from: "the parallel ledger namespace (row 184)" }),
  Object.freeze({ kind: "applied", from: "the parallel ledger namespace (row 184)" }),
  Object.freeze({ kind: "group_barrier", from: "the parallel ledger namespace (row 184)" }),
  Object.freeze({ kind: "group_closed", from: "the parallel ledger namespace (row 184)" }),
  Object.freeze({
    kind: "merge_check_started",
    from: "the parallel ledger namespace (row 184)",
  }),
  Object.freeze({
    kind: "merge_check_finished",
    from: "the parallel ledger namespace (row 184)",
  }),
  Object.freeze({
    kind: "unit_kept",
    from: "the ledger namespace of the micro-loop (F142-FR-061)",
  }),
  Object.freeze({
    kind: "process_alive",
    from: "the process registry of a pass (F100-FR-063; rule PU-42)",
  }),
  Object.freeze({
    kind: "critic_call_input",
    from: "the call record of a critic-class call (annex C §C.3)",
  }),
  Object.freeze({ kind: "model_call", from: "the call record of a model call (F142-SC-003)" }),
] as const);

/** The kinds the five conditions read, by the role each plays. */
export const KINDS = Object.freeze({
  /** The verdicts of the audits, per worker. */
  auditDone: "audit_done",
  /** The application of the composed tree to the workspace. */
  applied: "applied",
  /** The barrier of a group: every worker has ended. */
  barrier: "group_barrier",
  /** The close of a group, which a group that integrated nothing reaches directly. */
  groupClosed: "group_closed",
  mergeCheckStarted: "merge_check_started",
  mergeCheckFinished: "merge_check_finished",
  /** A unit of work kept in the ledger (F142-FR-061). */
  unitKept: "unit_kept",
  /** A process of a worker that is known to live (PU-42). */
  workerProcessAlive: "process_alive",
  /** The input of a critic-class call, as the call record names its fields. */
  criticInput: "critic_call_input",
  /** A model call, for the window of F142-SC-003. */
  modelCall: "model_call",
} as const);

/**
 * The five kinds this module claims are members of row 184 and that the table of
 * annex X §X.6 does not hold: empty, or the table and this module have drifted.
 */
export function kindsNotInRow184(): readonly string[] {
  const row = rowOf(LEDGER_KIND_ROW)?.literals ?? [];
  return Object.freeze(
    RECORD_KINDS.filter((entry) => entry.from.includes("row 184") && !row.includes(entry.kind)).map(
      (entry) => entry.kind,
    ),
  );
}

/** One breach the check found, with the record it found it on. */
export type Breach = {
  readonly condition: BreachCondition;
  /** The ordinal of the condition, 1 to 5. */
  readonly ordinal: 1 | 2 | 3 | 4 | 5;
  /** The sequence number of the record the breach was found on, where it has one. */
  readonly seq?: number;
  readonly detail: string;
};

function breach(ordinal: 1 | 2 | 3 | 4 | 5, detail: string, seq: number | undefined): Breach {
  return Object.freeze({
    condition: conditionOf(ordinal),
    ordinal,
    ...(seq === undefined ? {} : { seq }),
    detail,
  });
}

const asList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const asText = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/* ================================================================== *
 * 3. The five checks, each on its own.
 * ================================================================== */

/**
 * Condition 1 — a delta applied that did not pass the audits (F142-FR-071).
 *
 * The audit events of a group say which workers were accepted; the event of the
 * application says whose deltas it wrote. A worker in the second list that is
 * not accepted in the first is the breach. A worker that was **refused** and
 * whose delta was not applied is no breach: that is the audit working.
 */
export function appliedWithoutPassingTheAudits(events: readonly EventRecord[]): readonly Breach[] {
  const accepted = new Set<string>();
  const refused = new Set<string>();
  const found: Breach[] = [];
  for (const event of events) {
    if (kindOf(event) === KINDS.auditDone) {
      const workerId = asText(event.data?.["workerId"]);
      if (workerId === undefined) continue;
      if (asText(event.data?.["outcome"]) === "accepted") accepted.add(workerId);
      else refused.add(workerId);
      continue;
    }
    if (kindOf(event) !== KINDS.applied) continue;
    for (const workerId of asList(event.data?.["workers"])) {
      if (!accepted.has(workerId)) {
        found.push(
          breach(
            1,
            `the delta of ${workerId} was applied, and the audits ${
              refused.has(workerId) ? "refused it" : "recorded no verdict for it"
            }`,
            event.seq,
          ),
        );
      }
    }
  }
  return Object.freeze(found);
}

/**
 * Condition 2 — a workspace after the application that differs from the
 * integrated tree (F142-FR-071). The two fingerprints are compared apart from
 * the single-writer files, as F142-FR-063 (e) compares them (PU-94).
 */
export function workspaceDiffersFromTheIntegratedTree(
  events: readonly EventRecord[],
): readonly Breach[] {
  const found: Breach[] = [];
  for (const event of events) {
    if (kindOf(event) !== KINDS.applied) continue;
    const workspace =
      asText(event.data?.["workspaceApartFromSingleWriterFiles"]) ??
      asText(event.data?.["workspaceAfterTheApplication"]);
    const integrated =
      asText(event.data?.["integratedTreeApartFromSingleWriterFiles"]) ??
      asText(event.data?.["integratedTree"]);
    if (workspace === undefined || integrated === undefined) continue;
    if (workspace !== integrated) {
      found.push(
        breach(
          2,
          `the workspace after the application is ${workspace} and the integrated tree is ${integrated}`,
          event.seq,
        ),
      );
    }
  }
  return Object.freeze(found);
}

/**
 * Condition 3 — an integrated tree that holds a path or an object of no audited
 * delta (F142-FR-071, the condition PU-80 added). The event of the application
 * names the paths of the integrated tree and the paths of the audited deltas.
 */
export function integratedTreeHoldsAnUnauditedPath(
  events: readonly EventRecord[],
): readonly Breach[] {
  const found: Breach[] = [];
  for (const event of events) {
    if (kindOf(event) !== KINDS.applied) continue;
    const audited = new Set(asList(event.data?.["auditedPaths"]));
    const integrated = asList(event.data?.["integratedPaths"]);
    const strangers = integrated.filter((path) => !audited.has(path));
    if (strangers.length > 0) {
      found.push(
        breach(
          3,
          `the integrated tree holds ${strangers.join(", ")}, which no audited delta carried`,
          event.seq,
        ),
      );
    }
    const auditedObjects = new Set(asList(event.data?.["auditedObjects"]));
    if (auditedObjects.size > 0) {
      const objects = asList(event.data?.["integratedObjects"]).filter(
        (object) => !auditedObjects.has(object),
      );
      if (objects.length > 0) {
        found.push(
          breach(
            3,
            `the integrated tree holds the object(s) ${objects.join(", ")}, which no audited delta carried`,
            event.seq,
          ),
        );
      }
    }
  }
  return Object.freeze(found);
}

/**
 * Condition 4 — a kept unit of work for a merge check that ran while a process
 * of a worker was known to live (F142-FR-071).
 *
 * The window is the one F142-SC-003 names: from the start of the merge check to
 * its end. A `parallel.worker-process-alive` event inside that window makes
 * every unit kept for that merge check a breach.
 */
export function keptWhileAWorkerProcessLived(events: readonly EventRecord[]): readonly Breach[] {
  const found: Breach[] = [];
  let open = false;
  let aliveInTheWindow: string[] = [];
  const tainted = new Set<string>();
  for (const event of events) {
    if (kindOf(event) === KINDS.mergeCheckStarted) {
      open = true;
      aliveInTheWindow = [];
      continue;
    }
    if (kindOf(event) === KINDS.workerProcessAlive && open) {
      aliveInTheWindow.push(asText(event.data?.["workerId"]) ?? "a worker");
      continue;
    }
    if (kindOf(event) === KINDS.mergeCheckFinished) {
      open = false;
      if (aliveInTheWindow.length > 0) {
        const groupId = asText(event.data?.["groupId"]);
        if (groupId !== undefined) tainted.add(groupId);
        else tainted.add("");
      }
      continue;
    }
    if (kindOf(event) !== KINDS.unitKept) continue;
    const groupId = asText(event.data?.["groupId"]) ?? "";
    if (tainted.has(groupId) || tainted.has("")) {
      found.push(
        breach(
          4,
          `the unit ${asText(event.data?.["unitId"]) ?? "(unnamed)"} was kept for a merge check ` +
            `that ran while a process of a worker was known to live`,
          event.seq,
        ),
      );
    }
  }
  return Object.freeze(found);
}

/**
 * The fields F142-FR-065 and F142-FR-067 withhold from a critic-class call: a
 * field whose name is about a worker, a group, an order of integration, a count
 * or an outcome of a worker.
 */
export const WITHHELD_FIELD_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bworkers?\b/,
  /\bgroups?\b/,
  /\bparallel\b/,
  /\bmerges?\b/,
  /\bintegrat/,
  /\brefus/,
  /\bsnapshots?\b/,
  /\bcounts?\b/,
  /\border\b/,
  /\bkills?\b/,
  /\bkilled\b/,
]);

/** The words of a field name, so that `workerId` and "worker" are one subject. */
export function wordsOf(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .toLowerCase();
}

/** True where the field name is one F142-FR-065 or F142-FR-067 withholds. */
export function isAWithheldField(field: string): boolean {
  const words = wordsOf(field);
  return WITHHELD_FIELD_PATTERNS.some((pattern) => pattern.test(words));
}

/**
 * Condition 5 — an input of a critic-class call that holds a withheld field
 * (F142-FR-071). The event of the input names its fields; every one of them is
 * read as words, so that `workerId`, `worker_id` and `worker` are one subject.
 */
export function criticInputHoldsAWithheldField(events: readonly EventRecord[]): readonly Breach[] {
  const found: Breach[] = [];
  for (const event of events) {
    if (kindOf(event) !== KINDS.criticInput) continue;
    const held = asList(event.data?.["fields"]).filter((field) => isAWithheldField(field));
    if (held.length > 0) {
      found.push(
        breach(
          5,
          `the input of a critic-class call holds the field(s) ${held.join(", ")}`,
          event.seq,
        ),
      );
    }
  }
  return Object.freeze(found);
}

/* ================================================================== *
 * 4. The five together (T090).
 * ================================================================== */

/** The five checks, in the order of the conditions of F142-FR-071. */
export const CHECKS: readonly ((events: readonly EventRecord[]) => readonly Breach[])[] =
  Object.freeze([
    appliedWithoutPassingTheAudits,
    workspaceDiffersFromTheIntegratedTree,
    integratedTreeHoldsAnUnauditedPath,
    keptWhileAWorkerProcessLived,
    criticInputHoldsAWithheldField,
  ]);

/**
 * Check the five breach conditions on the event file of a run (T090,
 * F142-FR-071). The breaches come back in the order of the conditions, and an
 * empty list is the ordinary result — including on a run full of refusals, which
 * is the point of "a detected and refused act is an event and not a breach".
 */
export function breaches(events: readonly EventRecord[]): readonly Breach[] {
  return Object.freeze(CHECKS.flatMap((check) => check(events)));
}

/** True where the event file holds no breach of gate integrity (F142-SC-008). */
export function noBreach(events: readonly EventRecord[]): boolean {
  return breaches(events).length === 0;
}

/**
 * The conditions that the given event file exercises at all: the ones for which
 * it holds the events the check reads. The doctor reports it so that "0
 * breaches" cannot be read as "every condition was checked".
 */
export function conditionsExercised(events: readonly EventRecord[]): readonly BreachCondition[] {
  const types = new Set(events.map((event) => kindOf(event)));
  const out: BreachCondition[] = [];
  if (types.has(KINDS.applied)) out.push(conditionOf(1), conditionOf(2), conditionOf(3));
  if (types.has(KINDS.mergeCheckFinished) && types.has(KINDS.unitKept)) {
    out.push(conditionOf(4));
  }
  if (types.has(KINDS.criticInput)) out.push(conditionOf(5));
  return Object.freeze(out);
}

/* ================================================================== *
 * 5. F142-SC-003 — no model call between the barrier and the end of the
 *    merge check (rules PU-47, PU-80).
 * ================================================================== */

/**
 * The records that bound the window of F142-SC-003. It opens at the barrier of a
 * group and closes at the end of its merge check — or, where the group
 * integrated nothing and so had no result to check, at the close of the group,
 * because an open window with no end would read every later record as if it lay
 * inside it.
 */
export const WINDOW = Object.freeze({
  opens: KINDS.barrier,
  closes: KINDS.mergeCheckFinished,
  alsoCloses: KINDS.groupClosed,
} as const);

/**
 * The model calls that lie between the barrier of a group and the end of its
 * merge check (F142-SC-003). Empty, always: a model takes no part in
 * integration, because composition is mechanical (PU-80) and the merge check is
 * the check runner.
 */
export function modelCallsInsideTheWindow(events: readonly EventRecord[]): readonly EventRecord[] {
  const inside: EventRecord[] = [];
  let open = false;
  for (const event of events) {
    if (kindOf(event) === WINDOW.opens) {
      open = true;
      continue;
    }
    if (kindOf(event) === WINDOW.closes || kindOf(event) === WINDOW.alsoCloses) {
      open = false;
      continue;
    }
    if (open && kindOf(event) === KINDS.modelCall) inside.push(event);
  }
  return Object.freeze(inside);
}
