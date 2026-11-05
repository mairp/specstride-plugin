/**
 * T174 — the type and the validator of the parallel plan from
 * `schemas/parallel-plan.schema.json` (annex D, §D.3; F100-FR-126,
 * F100-FR-127, F100-FR-128).
 *
 * Schema id `specstride.parallel-plan/1`, logical name
 * `run:<runId>:parallel-plan`. The engine writes it at launch and never
 * computes it again inside a run; the engine, the doctor and the dry-run plan
 * of the pipeline entry read it. Content owner 142.
 *
 * The type is generated from the schema (T009); this module gives the
 * validator over it and the rules of the three requirements of §D.3.
 */
import type { ParallelPlan as Generated } from "./generated/parallel-plan.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.parallel-plan/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "run:<runId>:parallel-plan" as const;

/** The section of annex D that owns the field list. */
export const ANNEX_SECTION = "annex D, §D.3" as const;

/** The content owner of §D.3. */
export const CONTENT_OWNER = "142" as const;

/** The writer of the record, and when it writes (§D.3). */
export const WRITER = "Engine, at launch. Never computed again inside a run" as const;

/** The readers of the record (§D.3). */
export const READERS = [
  "Engine",
  "doctor",
  "the dry-run plan of the pipeline entry (only with the option on)",
] as const;

/** One group of a phase of the plan (§D.3, `phases[].groups`). */
export type PlanGroup = {
  /** The ordinal of the group inside its phase. */
  readonly ordinal: number;
  /** The task ids, in the order of the tasks at launch. */
  readonly taskIds: readonly string[];
};

/** One candidate task of a phase of the plan (§D.3, `phases[].tasks`). */
export type PlanTask = {
  readonly id: string;
  /** Path prefixes relative to the workspace root. */
  readonly writeScope: readonly string[];
  /** Where the scope came from (§D.3). */
  readonly scopeSource: ScopeSource;
  /** The verdict of every admission check, with its detail. */
  readonly admission: readonly {
    readonly check: string;
    readonly verdict: string;
    readonly detail?: string;
  }[];
};

/** One task made serial, with the reason (§D.3, `phases[].serial`). */
export type SerialTask = { readonly id: string; readonly reason: string };

/** The two sources of a write scope the table of §D.3 names. */
export const SCOPE_SOURCES = ["consumer-declaration", "task-text-at-launch"] as const;
export type ScopeSource = (typeof SCOPE_SOURCES)[number];

/** The parallel plan of a run (annex D, §D.3). */
export type ParallelPlan = Generated;

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of §D.3 is
 * required (F100-FR-048, F100-FR-049).
 */
export function readParallelPlan(value: unknown, logicalName: string = LOGICAL_NAME): ParallelPlan {
  return readRecord<ParallelPlan>(logicalName, value);
}

/** `readParallelPlan` that returns a result instead of throwing. */
export function tryReadParallelPlan(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: ParallelPlan } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<ParallelPlan>(logicalName, value);
}

/** True when the value validates against `specstride.parallel-plan/1`. */
export function isParallelPlan(value: unknown): value is ParallelPlan {
  return validate<ParallelPlan>(SCHEMA_ID, value).ok;
}

/* ------------------------------------------------------------------ *
 * F100-FR-126 — the plan is a pure function of the task list at launch
 * and of configuration, stored with its hash.
 * ------------------------------------------------------------------ */

/** The two inputs the plan is derived from, and nothing else (F100-FR-126). */
export const DERIVED_FROM = ["the task list as read at launch", "configuration"] as const;

/** The plan is computed at launch, and never again inside a run. */
export const COMPUTED_AT = "launch" as const;
export const RECOMPUTED_INSIDE_A_RUN = false as const;

/** The plan is stored in the control plane with its hash (F100-FR-126). */
export const STORED_IN = "the control plane" as const;
export const STORED_WITH_ITS_HASH = true as const;

/** What a relaunch does when it derives a different plan (F100-FR-126). */
export const ON_A_DIFFERENT_PLAN_AT_RELAUNCH = Object.freeze({
  announceTheDifference: true as const,
  useTheStoredPlan: true as const,
});

/** What a stored plan whose hash does not match does (F100-FR-126). */
export const ON_A_HASH_THAT_DOES_NOT_MATCH = Object.freeze({
  layerOffForRun: true as const,
  integrityEvent: true as const,
});

/**
 * F100-FR-126 — the decision on a stored plan: `use` where the hash matches,
 * `announce-and-use-stored` where a relaunch derived a different plan, and
 * `layer-off-for-run` where the stored hash does not match its plan.
 */
export type StoredPlanDecision = "use" | "announce-and-use-stored" | "layer-off-for-run";

export function decideStoredPlan(input: {
  readonly storedHash: string;
  readonly hashOfTheStoredPlan: string;
  readonly derivedHash?: string | undefined;
}): StoredPlanDecision {
  if (input.storedHash !== input.hashOfTheStoredPlan) return "layer-off-for-run";
  if (input.derivedHash !== undefined && input.derivedHash !== input.storedHash) {
    return "announce-and-use-stored";
  }
  return "use";
}

/** F100-FR-126 — the plan is printed only with the option on. */
export const PRINTED_ONLY_WITH_THE_OPTION_ON = true as const;

/** The row of §X.7 that switches the plan off under the `parity` profile. */
export const PARITY_ROW = 20 as const;
export const UNDER_PARITY = "off (no plan file exists)" as const;

/* ------------------------------------------------------------------ *
 * F100-FR-127 — the defaults and the ceiling of the parallel keys.
 * ------------------------------------------------------------------ */

/** The configuration keys of §D.3 with their default (F100-FR-127). */
export const KEY_DEFAULTS = Object.freeze({
  "loop.parallel.units": "off" as const,
  "loop.parallel.workers": 2 as const,
  "loop.parallel.workersMax": 4 as const,
  "loop.parallel.quota_headroom": 70 as const,
  "loop.parallel.allow_detect": "off" as const,
});

/** The key that is the ceiling of `loop.parallel.workers` (F100-FR-127). */
export const WORKERS_CEILING_KEY = "loop.parallel.workersMax" as const;

/** The two widening keys of §D.3: project configuration may lower, never raise. */
export const WIDENING_KEYS = ["loop.parallel.workersMax", "loop.parallel.allow_detect"] as const;

/** `loop.parallel.workersMax` is a whole number of 1 or more (F100-FR-127). */
export const WORKERS_MAX_MINIMUM = 1 as const;

/**
 * F100-FR-127 and F100-FR-202 — a higher value of a widening key in project
 * configuration is ignored, with a launch message and a doctor warning.
 */
export function ceilingInForce(input: {
  readonly fromLowerRanks: number;
  readonly fromProjectConfiguration?: number | undefined;
}): {
  readonly value: number;
  readonly ignored: boolean;
  readonly launchMessage?: string;
  readonly doctorWarning?: string;
} {
  const project = input.fromProjectConfiguration;
  if (project === undefined || project <= input.fromLowerRanks) {
    return Object.freeze({ value: project ?? input.fromLowerRanks, ignored: false });
  }
  return Object.freeze({
    value: input.fromLowerRanks,
    ignored: true,
    launchMessage:
      `\`${WORKERS_CEILING_KEY}\` = ${project} in project configuration widens the run; ` +
      `the value in force stays ${input.fromLowerRanks} (F100-FR-127, F100-FR-202)`,
    doctorWarning:
      `project configuration raises \`${WORKERS_CEILING_KEY}\`, a widening key; ignored ` +
      `(F100-FR-202)`,
  });
}

/**
 * F100-FR-127 — a value of `loop.parallel.workers` above the ceiling in force
 * is a configuration error at launch.
 */
export function workersAboveTheCeilingIsAConfigurationError(
  workers: number,
  ceiling: number,
): boolean {
  return workers > ceiling;
}

/** A group holds at least 2 tasks and at most `workers` (§D.3). */
export const GROUP_MINIMUM_TASKS = 2 as const;
export function groupSizeIsAllowed(size: number, workers: number): boolean {
  return size >= GROUP_MINIMUM_TASKS && size <= workers;
}

/* ------------------------------------------------------------------ *
 * F100-FR-128 — nothing of groups or workers reaches a critic-class call.
 * ------------------------------------------------------------------ */

/** What MUST NOT reach a critic-class call (F100-FR-128). */
export const NEVER_IN_A_CRITIC_CLASS_CALL = [
  "worker id",
  "group id",
  "count",
  "outcome of a worker",
  "order of integration",
  "a word that tells a group from a serial unit of work that named the same tasks",
] as const;

/** An integrated group appears in the fact block as one unit (F100-FR-128). */
export const AN_INTEGRATED_GROUP_IS_ONE_UNIT_IN_THE_FACT_BLOCK = true as const;

/** The two neutral integrity kinds parallel units add (F100-FR-128). */
export const NEUTRAL_INTEGRITY_KINDS = [
  "tree-changed-outside-pass",
  "protected-change-not-applied",
] as const;
export type NeutralIntegrityKind = (typeof NEUTRAL_INTEGRITY_KINDS)[number];

/** The two kinds are reported by kind and without a count (F100-FR-128). */
export const REPORTED_WITH_A_COUNT = false as const;

/** A worker tree MUST NOT exist when a critic-class call starts (F100-FR-128). */
export const A_WORKER_TREE_EXISTS_WHEN_A_CRITIC_CLASS_CALL_STARTS = false as const;

/**
 * F100-FR-128 — the neutrality check of one field that would go to a
 * critic-class call: `true` where the field may be handed over.
 */
export function mayReachACriticClassCall(field: string): boolean {
  // A field name is read as words, so that `workerId` and "worker id" are the
  // same subject.
  const lowered = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return !(
    /\bworkers?\b/.test(lowered) ||
    /\bgroups?\b/.test(lowered) ||
    /\bcounts?\b/.test(lowered) ||
    /\border of integration\b/.test(lowered)
  );
}
