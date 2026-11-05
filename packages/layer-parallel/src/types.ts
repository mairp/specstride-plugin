/**
 * T003 — the types of the layer `parallel` (feature 142): the parallel plan,
 * a write scope, a group, the verdict of the audits, and the five closed sets
 * this feature owns.
 *
 * Sources: `specs/142-parallel-units/data-model.md` (the entity table),
 * `specs/142-parallel-units/spec.md` (the section "Closed sets", F142-FR-002,
 * F142-FR-008 to F142-FR-011, F142-FR-017, F142-FR-023, F142-FR-054 to
 * F142-FR-058, F142-FR-063), and feature 100, annex D §D.1 to §D.3, whose
 * schemas this module cites and never repeats.
 *
 * Two rules shape the file.
 *
 * 1. **No drift.** The members of each closed set are written here as literal
 *    tuples, so that TypeScript can narrow them, and `closedSetDrift()`
 *    compares every tuple with both authorities: this feature's own
 *    `data/closed-sets.json` (the copy of `contracts/closed-sets.json` that
 *    T002 made) and the row of annex X §X.6 in the shared contracts. A change
 *    on one side that is not made on the others fails `test/types.test.ts`.
 * 2. **The layer decides and never executes** (F142-FR-006). Nothing here is
 *    a handle: a plan, a scope, a group and a verdict are values. The verdicts
 *    of the audits leave the layer in the shape of the contract type
 *    `IntegrateGroupRequest` of EP-04, which is how they reach the engine
 *    before `compose`.
 */
import { rowOf } from "@specstride/contracts/enums";
import type { IntegrateGroupRequest } from "@specstride/contracts/ep/loop-layer";
import type { ChangeKind } from "@specstride/contracts/ep/tree-store";
import closedSets from "../data/closed-sets.json" with { type: "json" };

/* ================================================================== *
 * 1. The five closed sets (F142-FR-002, F142-FR-010, F142-FR-011,
 *    F142-FR-023, F142-FR-058; spec.md, "Closed sets").
 * ================================================================== */

/** The row of annex X §X.6 that holds each of the five sets. */
export const CLOSED_SET_ROWS = Object.freeze({
  fallbackReasons: 60,
  admissionChecks: 61,
  deltaRefusalReasons: 63,
  layerOffReasons: 185,
  scopeSources: 186,
} as const);

/** The name each set carries in `data/closed-sets.json`. */
export const CLOSED_SET_NAMES = Object.freeze({
  fallbackReasons: "fallback-reasons",
  admissionChecks: "admission-checks",
  deltaRefusalReasons: "delta-refusal-reasons",
  layerOffReasons: "layer-off-reasons",
  scopeSources: "scope-sources",
} as const);

/** The key of one of the five sets, as the two tables above name it. */
export type ClosedSetKey = keyof typeof CLOSED_SET_ROWS;

/** Every key of the five sets, in the order of the rows of §X.6. */
export const CLOSED_SET_KEYS = Object.freeze([
  "fallbackReasons",
  "admissionChecks",
  "deltaRefusalReasons",
  "layerOffReasons",
  "scopeSources",
] as const);

/**
 * Row 60 — the fallback reasons of the layer. A failed precondition is a
 * fallback and never an error: the run completes as the same run with the
 * option off (F142-FR-002). Unknown value: shown as text; the layer is off.
 */
export const FALLBACK_REASONS = Object.freeze([
  "classic",
  "gate-not-executing",
  "not-git",
  "submodules",
  "git-version",
  "harness",
  "containment",
  "no-group",
] as const);
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

/**
 * Row 61 — the eight admission checks of a parallel group, in the order in
 * which admission runs them (F142-FR-011). Unknown value: the task is serial.
 */
export const ADMISSION_CHECKS = Object.freeze([
  "marker",
  "scope",
  "protected",
  "resource",
  "headroom",
  "check",
  "links",
  "jobs",
] as const);
export type AdmissionCheck = (typeof ADMISSION_CHECKS)[number];

/**
 * Row 63 — the refusal reasons of a delta (F142-FR-058). One reason per
 * refused delta; the reason never reaches a critic-class call. Unknown value:
 * the delta is refused.
 */
export const DELTA_REFUSAL_REASONS = Object.freeze([
  "scope",
  "protected",
  "overlap",
  "path-leak",
  "checkpoint",
  "yield",
  "tree-changed-after-end",
  "workspace-changed",
] as const);
export type DeltaRefusalReason = (typeof DELTA_REFUSAL_REASONS)[number];

/**
 * Row 185 — the reasons for which the layer is switched off inside a run
 * (F142-FR-023; decision D-7 of `research.md`). The set is split by how far
 * the switch reaches: the phase attempt, or the whole run.
 */
export const LAYER_OFF_FOR_ATTEMPT_REASONS = Object.freeze([
  "group-failures",
  "harness-error",
  "unchecked",
  "missing-object",
  "ledger",
  "check-budget",
] as const);
export type LayerOffForAttemptReason = (typeof LAYER_OFF_FOR_ATTEMPT_REASONS)[number];

/** Row 185, the two members that switch the layer off for the whole run. */
export const LAYER_OFF_FOR_RUN_REASONS = Object.freeze(["plan-hash", "apply-incomplete"] as const);
export type LayerOffForRunReason = (typeof LAYER_OFF_FOR_RUN_REASONS)[number];

/** Row 185 in full, in the order of the annex: the attempt members, then the run members. */
export const LAYER_OFF_REASONS = Object.freeze([
  ...LAYER_OFF_FOR_ATTEMPT_REASONS,
  ...LAYER_OFF_FOR_RUN_REASONS,
] as const);
export type LayerOffReason = LayerOffForAttemptReason | LayerOffForRunReason;

/** How far a member of row 185 reaches; `undefined` for a value outside the set. */
export function layerOffScopeOf(reason: string): "attempt" | "run" | undefined {
  if ((LAYER_OFF_FOR_ATTEMPT_REASONS as readonly string[]).includes(reason)) return "attempt";
  if ((LAYER_OFF_FOR_RUN_REASONS as readonly string[]).includes(reason)) return "run";
  return undefined;
}

/**
 * Row 186 — the two sources of a write scope, in the order in which
 * F142-FR-010 reads them. Unknown value: the scope is read as absent, which
 * is the whole tree.
 */
export const SCOPE_SOURCES = Object.freeze(["consumer", "task-text"] as const);
export type ScopeSource = (typeof SCOPE_SOURCES)[number];

/** The members of each of the five sets, by key. */
export const CLOSED_SET_MEMBERS: Readonly<Record<ClosedSetKey, readonly string[]>> = Object.freeze({
  fallbackReasons: FALLBACK_REASONS,
  admissionChecks: ADMISSION_CHECKS,
  deltaRefusalReasons: DELTA_REFUSAL_REASONS,
  layerOffReasons: LAYER_OFF_REASONS,
  scopeSources: SCOPE_SOURCES,
});

/** What a reader does with a value outside each set (the column of §X.6). */
export const CLOSED_SET_UNKNOWN_VALUE: Readonly<Record<ClosedSetKey, string>> = Object.freeze({
  fallbackReasons: "shown as text; the layer is off",
  admissionChecks: "the task is serial",
  deltaRefusalReasons: "the delta is refused",
  layerOffReasons: "shown as text; the layer is off for the run",
  scopeSources: "the scope is read as absent, which is the whole tree",
});

/** The feature that owns all five sets. */
export const OWNER = "142" as const;

/** Every set of this feature is closed by design and never by an owner decision. */
export const CLOSED_BY = "design" as const;

/* --- the guards, one per set ------------------------------------- */

export const isFallbackReason = (value: string): value is FallbackReason =>
  (FALLBACK_REASONS as readonly string[]).includes(value);
export const isAdmissionCheck = (value: string): value is AdmissionCheck =>
  (ADMISSION_CHECKS as readonly string[]).includes(value);
export const isDeltaRefusalReason = (value: string): value is DeltaRefusalReason =>
  (DELTA_REFUSAL_REASONS as readonly string[]).includes(value);
export const isLayerOffReason = (value: string): value is LayerOffReason =>
  layerOffScopeOf(value) !== undefined;
export const isScopeSource = (value: string): value is ScopeSource =>
  (SCOPE_SOURCES as readonly string[]).includes(value);

/* --- the drift check -------------------------------------------- */

/** One disagreement between the tuples above and an authority. */
export type ClosedSetDrift = {
  readonly set: ClosedSetKey;
  /** `data` for `data/closed-sets.json`; `annex-x` for the row of §X.6. */
  readonly authority: "data" | "annex-x";
  readonly detail: string;
};

type RawSet = {
  name: string;
  annexXRow: number;
  closedBy: string;
  members: string[] | { attempt: string[]; run: string[] };
  unknown: string;
};

/** The five sets as `data/closed-sets.json` holds them, by name. */
function dataSets(): ReadonlyMap<string, RawSet> {
  const sets = (closedSets as { sets: RawSet[] }).sets;
  return new Map(sets.map((s) => [s.name, s]));
}

/** The members of one raw set, flattened in the order of the annex. */
function membersOf(raw: RawSet): readonly string[] {
  return Array.isArray(raw.members) ? raw.members : [...raw.members.attempt, ...raw.members.run];
}

/**
 * Every disagreement between the tuples of this module and the two
 * authorities: this feature's `data/closed-sets.json` and the row of annex X
 * §X.6 in the shared contracts. An empty list is the pass.
 */
export function closedSetDrift(): readonly ClosedSetDrift[] {
  const out: ClosedSetDrift[] = [];
  const data = dataSets();
  for (const key of CLOSED_SET_KEYS) {
    const here = CLOSED_SET_MEMBERS[key];
    const name = CLOSED_SET_NAMES[key];
    const row = CLOSED_SET_ROWS[key];

    const raw = data.get(name);
    if (raw === undefined) {
      out.push({
        set: key,
        authority: "data",
        detail: `\`data/closed-sets.json\` holds no set \`${name}\``,
      });
    } else {
      const members = membersOf(raw);
      if (members.join("\u0000") !== here.join("\u0000")) {
        out.push({
          set: key,
          authority: "data",
          detail: `members differ: [${here.join(", ")}] here, [${members.join(", ")}] in \`data/closed-sets.json\``,
        });
      }
      if (raw.annexXRow !== row) {
        out.push({
          set: key,
          authority: "data",
          detail: `row ${row} here, ${raw.annexXRow} in \`data/closed-sets.json\``,
        });
      }
      if (raw.closedBy !== CLOSED_BY) {
        out.push({
          set: key,
          authority: "data",
          detail: `closed by \`${CLOSED_BY}\` here, \`${raw.closedBy}\` in \`data/closed-sets.json\``,
        });
      }
    }

    const annex = rowOf(row);
    if (annex === undefined) {
      out.push({ set: key, authority: "annex-x", detail: `annex X §X.6 holds no row ${row}` });
      continue;
    }
    if (annex.literals.join("\u0000") !== here.join("\u0000")) {
      out.push({
        set: key,
        authority: "annex-x",
        detail: `members differ: [${here.join(", ")}] here, [${annex.literals.join(", ")}] in row ${row}`,
      });
    }
    if (annex.owner !== OWNER) {
      out.push({
        set: key,
        authority: "annex-x",
        detail: `row ${row} names the owner \`${annex.owner}\`, not \`${OWNER}\``,
      });
    }
    if (annex.closedBy.toLowerCase() !== CLOSED_BY) {
      out.push({
        set: key,
        authority: "annex-x",
        detail: `row ${row} is closed by \`${annex.closedBy}\`, not \`${CLOSED_BY}\``,
      });
    }
  }
  return Object.freeze(out);
}

/* ================================================================== *
 * 2. The write scope (F142-FR-009, F142-FR-010; entity "Write scope").
 * ================================================================== */

/**
 * A write scope: a list of normalised path prefixes of one task, relative to
 * the root of the workspace, with the source it came from (F142-FR-009,
 * F142-FR-010). An empty list means the whole tree and overlaps everything.
 */
export type WriteScope = {
  /** The prefixes, normalised as `normalisedPrefix` describes. */
  readonly prefixes: readonly string[];
  /** Where the scope came from: row 186. */
  readonly source: ScopeSource;
  /**
   * True where the prefixes were compared after case folding and Unicode
   * normalisation, which happens only where a probe at launch found that the
   * file system ignores case. The probe runs behind a port of an edge package
   * and reaches the layer as this value.
   */
  readonly caseFolded?: boolean;
};

/** What an empty or absent list of prefixes means (F142-FR-009). */
export const ABSENT_SCOPE_MEANS = "the whole tree, which overlaps everything" as const;

/** The form a prefix must have (F142-FR-009); a prefix that breaks it is refused. */
export const PREFIX_FORM = Object.freeze([
  "no leading current-directory segment",
  "no parent segment",
  "no absolute path",
  "no trailing separator",
] as const);
export type PrefixFormRule = (typeof PREFIX_FORM)[number];

/** The rule a prefix breaks, or `undefined` where it is normalised (F142-FR-009). */
export function prefixFormBroken(prefix: string): PrefixFormRule | undefined {
  const segments = prefix.split("/");
  if (segments.includes("..")) return PREFIX_FORM[1];
  if (prefix.startsWith("/")) return PREFIX_FORM[2];
  if (prefix.startsWith("./") || segments.includes(".")) return PREFIX_FORM[0];
  if (prefix.length > 1 && prefix.endsWith("/")) return PREFIX_FORM[3];
  return undefined;
}

/* ================================================================== *
 * 3. The parallel plan (F142-FR-017; annex D §D.3; entity "Parallel plan").
 * ================================================================== */

/** The schema id of the plan, owned by feature 100, annex D §D.3. */
export const PARALLEL_PLAN_SCHEMA = "specstride.parallel-plan/1" as const;

/** The logical name the plan is stored under in the control plane. */
export const PARALLEL_PLAN_LOGICAL_NAME = "run:<runId>:parallel-plan" as const;

/** The verdict of one admission check on one task, with its detail (F142-FR-011). */
export type AdmissionVerdict = {
  readonly check: AdmissionCheck;
  readonly passed: boolean;
  /** Why, in the words the plan prints; empty where there is nothing to add. */
  readonly detail: string;
};

/**
 * One candidate task of the plan: its id, its scope, and the verdict of every
 * admission check that ran on it (F142-FR-011; data-model.md).
 */
export type CandidateTask = {
  readonly id: string;
  readonly scope: WriteScope;
  readonly checks: readonly AdmissionVerdict[];
};

/**
 * The reason a task that every check admitted carries where no group of at
 * least `GROUP_MIN_TASKS` tasks can hold it (F142-FR-011, PU-14). It is
 * deliberately **not** a member of row 61: it is no admission check, and the
 * plan must never print it as one. `ALONE` of `admission.ts` is this value.
 */
export const ALONE_IN_ITS_RUN = "alone-in-its-run-of-admitted-tasks" as const;

/**
 * One task made serial, with the admission check that failed as its reason, or
 * `ALONE_IN_ITS_RUN` where every check admitted it and its run of consecutive
 * admitted tasks was too short for a group.
 */
export type SerialTask = {
  readonly id: string;
  readonly reason: AdmissionCheck | typeof ALONE_IN_ITS_RUN;
  /** Why, in the words the plan prints. */
  readonly detail?: string;
};

/** The least and the most tasks a group may hold (F142-FR-008). */
export const GROUP_MIN_TASKS = 2 as const;

/** `loop.parallel.workers` and its ceiling `loop.parallel.workersMax` (F142-FR-019). */
export const WORKERS_DEFAULT = 2 as const;
export const WORKERS_MAX_DEFAULT = 4 as const;

/**
 * One group of the plan: an ordinal, the phase it belongs to, and the task
 * ids in the order of the tasks at launch (F142-FR-008; entity "Group"). A
 * group holds at least `GROUP_MIN_TASKS` and at most `workers` tasks, all
 * consecutive and admitted, and never crosses a phase.
 */
export type PlannedGroup = {
  readonly ordinal: number;
  readonly phase: number;
  readonly tasks: readonly string[];
};

/** The plan of one phase (annex D §D.3, `phases[]`). */
export type PhasePlan = {
  readonly phase: number;
  readonly groups: readonly PlannedGroup[];
  readonly tasks: readonly CandidateTask[];
  readonly serial: readonly SerialTask[];
  /** The ceiling of the speed-up of the phase under equal task cost. */
  readonly ceiling: number;
};

/**
 * The parallel plan (F142-FR-017; annex D §D.3). Computed at launch as a pure
 * function of the task list as read at launch and of configuration, stored
 * with its hash, and never computed again inside a run.
 */
export type ParallelPlan = {
  readonly schema: typeof PARALLEL_PLAN_SCHEMA;
  readonly runId: string;
  /** The canonical record hash of the plan, which is also an event. */
  readonly hash: string;
  /** The worker count in force. */
  readonly workers: number;
  readonly phases: readonly PhasePlan[];
  /** The reason the layer is off for the run, or `null` where it is on. */
  readonly fallback: FallbackReason | null;
};

/** Every task of a phase is in exactly one of a group or the serial list (F142-FR-011). */
export function tasksNotPlacedExactlyOnce(phase: PhasePlan): readonly string[] {
  const counted = new Map<string, number>();
  for (const id of phase.groups.flatMap((g) => g.tasks)) {
    counted.set(id, (counted.get(id) ?? 0) + 1);
  }
  for (const serial of phase.serial) {
    counted.set(serial.id, (counted.get(serial.id) ?? 0) + 1);
  }
  const out = phase.tasks.map((t) => t.id).filter((id) => counted.get(id) !== 1);
  for (const [id, n] of counted) {
    if (n !== 1 && !out.includes(id)) out.push(id);
  }
  return Object.freeze(out);
}

/* ================================================================== *
 * 4. The group at run time (F142-FR-063, F142-FR-064; entity "Group").
 * ================================================================== */

/**
 * The seven fingerprints of a group that the ledger must hold, lettered as
 * F142-FR-063 letters them.
 */
export const GROUP_FINGERPRINT_STAGES = Object.freeze([
  "workspace-at-group-start",
  "worker-tree-after-creation",
  "worker-tree-at-its-end",
  "workspace-at-the-barrier",
  "workspace-after-the-application",
  "workspace-before-the-merge-check",
  "workspace-after-the-merge-check",
] as const);
export type GroupFingerprintStage = (typeof GROUP_FINGERPRINT_STAGES)[number];

/** The letters of F142-FR-063, in the order of the stages above. */
export const GROUP_FINGERPRINT_LETTERS = Object.freeze([
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
] as const);

/** One worker of a group: its task, its scope and the outcome the engine reports. */
export type Worker = {
  readonly workerId: string;
  readonly task: string;
  readonly scope: WriteScope;
};

/** A group as it ran: its plan, its fingerprints and whether it failed. */
export type Group = {
  readonly ordinal: number;
  readonly phase: number;
  readonly workers: readonly Worker[];
  /** The fingerprint recorded at each stage, by stage. */
  readonly fingerprints: Readonly<Partial<Record<GroupFingerprintStage, string>>>;
  /**
   * A group in which a worker was refused or killed, or whose merge check
   * failed, counts as one failed group (F142-FR-023).
   */
  readonly failed: boolean;
};

/** After this many failed groups the layer is off for the phase attempt (F142-FR-023). */
export const FAILED_GROUPS_BEFORE_THE_LAYER_IS_OFF = 2 as const;

/**
 * The kept unit of work of a group (F142-FR-061, F142-FR-065): its id is the
 * hash of its sorted task ids, and it is bound to the fingerprint of the
 * workspace after the merge check.
 */
export type KeptUnitOfWork = {
  readonly unitId: string;
  readonly tasks: readonly string[];
  readonly treeHash: string;
};

/* ================================================================== *
 * 5. The verdict of the audits (F142-FR-054 to F142-FR-058;
 *    entity "Verdict of the audits").
 * ================================================================== */

/** One path of a delta, with the kind the tree-store operation `changed` gave it. */
export type DeltaPath = {
  readonly path: string;
  readonly kind: ChangeKind;
};

/**
 * The delta of one worker: the paths between the base snapshot of the group
 * and that worker's final snapshot (annex D §D.2). Single-writer files of
 * F142-FR-057 are already dropped.
 */
export type Delta = {
  readonly workerId: string;
  /** The tree id of the worker's final snapshot. */
  readonly treeId: string;
  readonly paths: readonly DeltaPath[];
};

/**
 * The verdict of the audits on one delta: accepted, or refused with exactly
 * one reason of row 63 (F142-FR-058). One reason per refused delta.
 */
export type AuditVerdict = "accepted" | { readonly refused: DeltaRefusalReason };

/** The verdict of the audits for one worker of a group. */
export type WorkerVerdict = {
  readonly workerId: string;
  readonly verdict: AuditVerdict;
};

/** True where the verdict accepted the delta. */
export const isAccepted = (verdict: AuditVerdict): verdict is "accepted" => verdict === "accepted";

/** The one reason a verdict refused a delta, or `undefined` where it accepted it. */
export function refusalOf(verdict: AuditVerdict): DeltaRefusalReason | undefined {
  return verdict === "accepted" ? undefined : verdict.refused;
}

/**
 * The verdicts of the audits in the shape the directive `integrateGroup`
 * carries them (annex D §D.1): per worker, `accepted` or the refusal reason.
 * This is how the verdicts of this feature reach the engine before `compose`,
 * and the only shape in which they leave the layer.
 */
export function integrateGroupRequestOf(verdicts: readonly WorkerVerdict[]): IntegrateGroupRequest {
  return Object.freeze({
    perWorker: Object.freeze(
      verdicts.map((v) =>
        Object.freeze({
          workerId: v.workerId,
          outcome: isAccepted(v.verdict)
            ? ("accepted" as const)
            : Object.freeze({ refused: v.verdict.refused }),
        }),
      ),
    ),
  });
}

/** The audits, in the order in which they run on a delta (F142-FR-054 to F142-FR-056). */
export const AUDITS = Object.freeze(["scope", "protected", "path-leak"] as const);
export type Audit = (typeof AUDITS)[number];

/**
 * The single-writer files of F142-FR-057, which are never part of a delta: a
 * change to one by a worker is not a violation, the path is simply dropped.
 */
export const SINGLE_WRITER_FILES = Object.freeze([
  "the task list",
  "the phase evidence",
  "the notebook",
  "the handoff",
  "anything under the workspace part",
] as const);
