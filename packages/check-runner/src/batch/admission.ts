/**
 * T048, T049 — the parallelism parameter, the admission of a command to a
 * batch, and the formation of the batches (F148-FR-011, F148-FR-012).
 *
 * Batch formation is a PURE FUNCTION of the frozen check manifest and the
 * parallelism (`research.md` D-3): `formBatches` reads nothing, starts
 * nothing and measures nothing, so the plan of a run can be asserted without
 * a single command being executed. Nothing in this module touches the file
 * system; `FILES_THIS_MODULE_READS` states that, and CT-148-208 checks it
 * against the source.
 *
 * Three rules of F148-FR-011 are code here, not prose:
 *
 *  1. **The parameter.** `verification.parallelism` (row 7 of annex X §X.7)
 *     has the default 1 and the ceiling 4; a value above 4 is a configuration
 *     error, refused by `checkParallelism` of `../registry/switches.ts` rather
 *     than clamped. It applies to the verification gate and to inner checks
 *     alike (`appliesTo`).
 *  2. **Declarations come from the manifest only (CQ-190).** `declarationOf`
 *     takes a manifest entry and nothing else. The runner never reads a
 *     declaration of reads, writes, side effects or an exclusive resource
 *     from a file of the repository, and an entry that holds no declaration
 *     counts as UNDECLARED and runs alone.
 *  3. **The rules, in the order of the data file.** `ADMISSION_RULES` is
 *     `data/batch-rules.json` (T004, byte-equal to
 *     `specs/148-check-runner/contracts/batch-rules.json`), so a rule cannot
 *     drift from the specification. The first rule that fires gives the
 *     reason of row 236 of annex X §X.6.
 *
 * A batch closes either because the next command was REFUSED — which is an
 * event — or because it holds as many commands as the parallelism, which is
 * capacity and no refusal at all (`data/batch-rules.json`, `order`). The
 * rules are therefore evaluated BEFORE the capacity, so that the reason
 * `demoted` of rule B7 is recorded when a taint has set the parallelism of
 * the run to 1 (F148-FR-014) instead of being hidden behind a full batch.
 */
import type { ManifestEntry } from "@specstride/contracts/ep/check-runner";
import {
  PARALLELISM_CEILING,
  PARALLELISM_KEY,
  PARALLELISM_MIN,
  checkParallelism,
  defaultValueOf,
  parityValueOf,
} from "../registry/switches.ts";
import { ADMISSION_REASONS, type AdmissionReason } from "../result/closed-sets.ts";
import batchRules from "../../data/batch-rules.json" with { type: "json" };

/* ------------------------------------------------------------------ *
 * The parameter (F148-FR-011).
 * ------------------------------------------------------------------ */

/** Row 7 of annex X §X.7, the key of the parameter. */
export const BATCH_PARALLELISM_KEY: "verification.parallelism" = PARALLELISM_KEY;

/** The default of the parameter, read from the annex: 1, so it is OFF by default. */
export const BATCH_PARALLELISM_DEFAULT: number = PARALLELISM_MIN;

/** The ceiling of the parameter, read from the annex: 4. */
export const BATCH_PARALLELISM_CEILING: number = PARALLELISM_CEILING;

/** The value of the parameter under the `parity` profile, read from the annex. */
export const BATCH_PARALLELISM_UNDER_PARITY: boolean | number | string | null =
  parityValueOf(PARALLELISM_KEY);

/** The "Default" cell of row 7, as the annex spells it. */
export const BATCH_PARALLELISM_DEFAULT_CELL: boolean | number | string | null =
  defaultValueOf(PARALLELISM_KEY);

/**
 * F148-FR-011 — the parameter applies to the verification gate and to inner
 * checks ALIKE. The list is read by a caller that must say where it holds.
 */
export const APPLIES_TO: readonly string[] = Object.freeze([
  "the verification gate",
  "inner checks",
]);

/** True where the parameter governs the given kind of check. */
export function appliesTo(check: string): boolean {
  return APPLIES_TO.includes(check);
}

/** What `effectiveParallelism` was given and what it decided. */
export type EffectiveParallelism = {
  readonly value: number;
  readonly configured: number;
  /** True where a taint of a batch lowered the value for the rest of the run. */
  readonly lowered: boolean;
  readonly source: "configured" | "default" | "parity" | "lowered";
};

/**
 * F148-FR-011, F148-FR-014 — the parallelism in force. The configured value
 * is checked against the range (1 to 4); the `parity` profile pins it to the
 * value of the annex; a run whose parallelism was lowered after a taint is 1
 * whatever the configuration says.
 */
export function effectiveParallelism(
  input: {
    readonly configured?: number;
    readonly profile?: string;
    readonly lowered?: boolean;
  } = {},
): EffectiveParallelism {
  const configured =
    input.configured === undefined ? BATCH_PARALLELISM_DEFAULT : checkParallelism(input.configured);
  if (input.lowered === true) {
    return Object.freeze({ value: 1, configured, lowered: true, source: "lowered" as const });
  }
  if (input.profile === "parity") {
    const underParity =
      typeof BATCH_PARALLELISM_UNDER_PARITY === "number" ? BATCH_PARALLELISM_UNDER_PARITY : 1;
    return Object.freeze({
      value: underParity,
      configured,
      lowered: false,
      source: "parity" as const,
    });
  }
  return Object.freeze({
    value: configured,
    configured,
    lowered: false,
    source: input.configured === undefined ? ("default" as const) : ("configured" as const),
  });
}

/* ------------------------------------------------------------------ *
 * The declarations: the manifest only (CQ-190).
 * ------------------------------------------------------------------ */

/**
 * CQ-190, `research.md` D-13 — where a declaration may come from. The frozen
 * check manifest is the only source; repository text is never one.
 */
export const DECLARATIONS_COME_FROM = "the frozen check manifest only" as const;

/** CQ-190 — what the check runner never reads a declaration from. */
export const NEVER_A_SOURCE_OF_A_DECLARATION: readonly string[] = Object.freeze([
  "a file of the repository",
  "the verification-commands document",
  "the task text",
  "a comment of a command",
]);

/**
 * CQ-190 — the files this module reads: NONE. The declarations are fields of
 * the manifest entry the caller hands in. The one JSON this module imports is
 * `data/batch-rules.json`, which is data of this package and of the
 * specification, and is not repository text of the workspace under check.
 */
export const FILES_THIS_MODULE_READS: readonly string[] = Object.freeze([]);

/** The fields of a manifest entry that carry a declaration (CQ-190). */
export const DECLARATION_FIELDS: readonly string[] = Object.freeze([
  "reads",
  "writes",
  "sideEffects",
  "resource",
  "exclusiveResource",
  "steps",
]);

/**
 * An entry of the check manifest as THIS module reads it: the fields of the
 * EP-05 type, plus the three the schema of the manifest names and the
 * interface type does not (`sideEffects`, `resource`, `steps`).
 */
export type BatchEntry = Omit<ManifestEntry, "reads"> & {
  /**
   * The declared reads. `reads: tree` is the SECOND FORM of a declaration
   * (`check-manifest.schema.json`, the entry of `reads`), which the
   * interface type of feature 100 types as a list of prefixes only; the
   * widening stands here, at this feature's seam, and is reported upstream
   * rather than forced on `@specstride/contracts`.
   */
  readonly reads?: readonly string[] | "tree";
  readonly sideEffects?: string;
  readonly resource?: string;
  readonly steps?: readonly unknown[];
};

/** The value `reads` takes where a command reads the whole tree. */
export const READS_THE_WHOLE_TREE = "tree" as const;

/** The value of `sideEffects` that declares a command free of side effects. */
export const NO_SIDE_EFFECTS = "none" as const;

/** What a manifest entry declares, as the admission rules read it. */
export type Declaration = {
  readonly checkId: string;
  /** False where the entry holds no declaration at all: it then runs alone. */
  readonly declared: boolean;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  /** True where `reads` is `tree`: the command reads everything. */
  readonly readsTheWholeTree: boolean;
  readonly sideEffectsNone: boolean;
  readonly exclusiveResource: string | null;
  readonly hasSteps: boolean;
};

/** A declared scope as a list of normalised prefixes, whatever shape it came in. */
function prefixesOf(value: unknown): readonly string[] {
  if (typeof value === "string") return value === "" ? [] : [normalisePath(value)];
  if (!Array.isArray(value)) return [];
  return Object.freeze(
    (value as unknown[])
      .filter((item): item is string => typeof item === "string" && item !== "")
      .map(normalisePath),
  );
}

/** True where a declared `reads` says the whole tree. */
function saysTheWholeTree(value: unknown): boolean {
  if (value === READS_THE_WHOLE_TREE) return true;
  return Array.isArray(value) && (value as unknown[]).includes(READS_THE_WHOLE_TREE);
}

/**
 * CQ-190, F148-FR-011 — what an entry of the FROZEN CHECK MANIFEST declares.
 * The entry is the only input: no path of the repository is opened, no text
 * of the repository is parsed, and an entry that holds no declaration counts
 * as undeclared, whatever a file of the tree may say about the command.
 *
 * A command is declared when it names BOTH what it reads and what it writes,
 * or `sideEffects: none` together with `reads: tree`.
 */
export function declarationOf(entry: BatchEntry): Declaration {
  const raw = entry as unknown as Readonly<Record<string, unknown>>;
  const reads = prefixesOf(raw["reads"]);
  const writes = prefixesOf(raw["writes"]);
  const readsTheWholeTree = saysTheWholeTree(raw["reads"]);
  const sideEffectsNone = raw["sideEffects"] === NO_SIDE_EFFECTS;
  const namesBoth = raw["reads"] !== undefined && raw["writes"] !== undefined;
  const freeOfSideEffects = sideEffectsNone && readsTheWholeTree;
  const resource = raw["resource"] ?? raw["exclusiveResource"];
  const steps = raw["steps"];
  return Object.freeze({
    checkId: entry.id,
    declared: namesBoth || freeOfSideEffects,
    reads: Object.freeze([...reads]),
    writes: Object.freeze([...writes]),
    readsTheWholeTree,
    sideEffectsNone,
    exclusiveResource: typeof resource === "string" && resource !== "" ? resource : null,
    hasSteps: Array.isArray(steps) && steps.length > 0,
  });
}

/* ------------------------------------------------------------------ *
 * The comparison of two scopes (F148-FR-012).
 * ------------------------------------------------------------------ */

/**
 * F148-FR-012 — two scopes are compared as NORMALISED path prefixes. A
 * leading `./`, a trailing separator and a repeated separator are removed; a
 * backslash is read as a separator, so a declaration written on either
 * platform compares the same.
 */
export function normalisePath(path: string): string {
  const parts = path
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  return parts.join("/");
}

/**
 * F148-FR-012, `research.md` D-3 — a prefix covers a path AT A PATH BOUNDARY:
 * the prefix itself, or the prefix followed by a separator. `src/build`
 * therefore covers `src/build/out.o` and never `src/buildings.ts`.
 */
export function underPrefix(path: string, prefix: string): boolean {
  if (prefix === "" || path === "") return false;
  if (path === prefix) return true;
  return path.startsWith(`${prefix}/`);
}

/** True where two scopes meet: either covers the other at a path boundary. */
export function scopesOverlap(a: string, b: string): boolean {
  return underPrefix(a, b) || underPrefix(b, a);
}

/** True where any prefix of the one list meets any prefix of the other. */
export function anyScopeOverlaps(a: readonly string[], b: readonly string[]): boolean {
  return a.some((one) => b.some((other) => scopesOverlap(one, other)));
}

/**
 * F148-FR-011 — true where the reads of a command are DECLARED DISJOINT from
 * the given writes. A command that reads the whole tree is disjoint from
 * nothing, and a command that declared no reads at all declared no
 * disjointness either.
 */
export function readsAreDeclaredDisjointFrom(
  declaration: Declaration,
  writes: readonly string[],
): boolean {
  if (writes.length === 0) return true;
  if (declaration.readsTheWholeTree) return false;
  if (!declaration.declared) return false;
  return !anyScopeOverlaps(declaration.reads, writes);
}

/* ------------------------------------------------------------------ *
 * The rules, read from the data file (F148-FR-012).
 * ------------------------------------------------------------------ */

/** One row of `data/batch-rules.json`. */
export type AdmissionRule = {
  readonly id: string;
  readonly refuse: string;
  readonly reason: AdmissionReason;
};

type RulesFile = {
  readonly rules: readonly { id: string; refuse: string; reason: string }[];
  readonly admit: { readonly reason: string };
  readonly order: string;
  readonly scopeComparison: string;
  readonly declarations: string;
  readonly events: { readonly admission: string; readonly lowering: string };
  readonly parallelism: {
    readonly key: string;
    readonly default: number;
    readonly ceiling: number;
    readonly underParity: number;
  };
};

const RULES_FILE = batchRules as unknown as RulesFile;

/** The admission rules of a batch, IN ORDER, each with its reason of row 236. */
export const ADMISSION_RULES: readonly AdmissionRule[] = Object.freeze(
  RULES_FILE.rules.map((rule) =>
    Object.freeze({
      id: rule.id,
      refuse: rule.refuse,
      reason: rule.reason as AdmissionReason,
    }),
  ),
);

/** The reason an ADMISSION carries, as the data file gives it. */
export const REASON_OF_AN_ADMISSION: AdmissionReason = RULES_FILE.admit.reason as AdmissionReason;

/** The two results of row 236's decision, as the event catalogue spells them. */
export const ADMISSION_RESULTS = Object.freeze(["admitted", "refused"] as const);
export type AdmissionResult = (typeof ADMISSION_RESULTS)[number];

/** The event type every admission and every refusal is recorded in. */
export const CHECK_ADMISSION = "check.admission" as const;

/** The `data` fields of that event, as the catalogue spells them. */
export const CHECK_ADMISSION_FIELDS = Object.freeze([
  "checkId",
  "batch",
  "slot",
  "result",
  "reason",
] as const);

/** The rule of an id, or `undefined`. */
export function admissionRule(id: string): AdmissionRule | undefined {
  return ADMISSION_RULES.find((rule) => rule.id === id);
}

/** Every reason the rules can give, with the reason of an admission. */
export function admissionReasonsUsed(): readonly AdmissionReason[] {
  return Object.freeze([REASON_OF_AN_ADMISSION, ...ADMISSION_RULES.map((rule) => rule.reason)]);
}

/** What the admission of one candidate to one open batch is decided against. */
export type AdmissionContext = {
  /** The declarations of the commands already in the batch, in slot order. */
  readonly members: readonly Declaration[];
  /** True where the step runner is on (row 6 of annex X §X.7). */
  readonly stepRunner?: boolean;
  /** True where a taint lowered the parallelism of the run to 1 (rule B7). */
  readonly lowered?: boolean;
  /** Caches a toolchain profile marks as exclusive, by command id. */
  readonly exclusiveCaches?: Readonly<Record<string, readonly string[]>>;
};

/** What one evaluation of the rules decided. */
export type AdmissionDecision = {
  readonly result: AdmissionResult;
  readonly reason: AdmissionReason;
  /** The rule that refused, or null for an admission. */
  readonly ruleId: string | null;
};

function cachesOf(context: AdmissionContext, checkId: string): readonly string[] {
  return context.exclusiveCaches?.[checkId] ?? [];
}

/**
 * F148-FR-011, F148-FR-012 — may this candidate join the open batch? The
 * rules of `data/batch-rules.json` are evaluated IN THEIR ORDER and the first
 * that fires gives the reason; a candidate no rule refuses is admitted with
 * the reason `disjoint`. A candidate offered an EMPTY batch is always
 * admitted: a command that runs alone is a batch of one.
 */
export function admissionOf(candidate: Declaration, context: AdmissionContext): AdmissionDecision {
  const members = context.members;
  if (members.length === 0) {
    return Object.freeze({
      result: "admitted" as const,
      reason: REASON_OF_AN_ADMISSION,
      ruleId: null,
    });
  }
  const writesOfTheBatch = members.flatMap((member) => member.writes);
  const readsOfTheBatch = members.flatMap((member) => member.reads);

  const fires: Readonly<Record<string, () => boolean>> = {
    // B1 — the command declares neither reads and writes nor `sideEffects:
    // none` with `reads: tree`. A member without a declaration refuses the
    // candidate just as surely: an undeclared command runs ALONE.
    B1: () => !candidate.declared || members.some((member) => !member.declared),
    // B2 — the command reads a prefix that a command of the batch writes.
    B2: () => anyScopeOverlaps(candidate.reads, writesOfTheBatch),
    // B3 — the command writes a prefix that a command of the batch reads or writes.
    B3: () =>
      anyScopeOverlaps(candidate.writes, readsOfTheBatch) ||
      anyScopeOverlaps(candidate.writes, writesOfTheBatch),
    // B4 — a command of the batch has declared writes and the reads of this
    // later command are not declared disjoint from them.
    B4: () => !readsAreDeclaredDisjointFrom(candidate, writesOfTheBatch),
    // B5 — the command names an exclusive resource, or shares a cache a
    // toolchain profile marks as exclusive, with a command of the batch.
    B5: () =>
      members.some(
        (member) =>
          (candidate.exclusiveResource !== null &&
            candidate.exclusiveResource === member.exclusiveResource) ||
          anyScopeOverlaps(cachesOf(context, candidate.checkId), cachesOf(context, member.checkId)),
      ),
    // B6 — the command has steps and the step runner is on.
    B6: () =>
      context.stepRunner === true &&
      (candidate.hasSteps || members.some((member) => member.hasSteps)),
    // B7 — the parallelism of the run was set to 1 after a taint.
    B7: () => context.lowered === true,
  };

  for (const rule of ADMISSION_RULES) {
    const test = fires[rule.id];
    if (test !== undefined && test()) {
      return Object.freeze({
        result: "refused" as const,
        reason: rule.reason,
        ruleId: rule.id,
      });
    }
  }
  return Object.freeze({
    result: "admitted" as const,
    reason: REASON_OF_AN_ADMISSION,
    ruleId: null,
  });
}

/* ------------------------------------------------------------------ *
 * The formation (F148-FR-012).
 * ------------------------------------------------------------------ */

/** One command of a batch: the entry, where it stood in the manifest, its slot. */
export type BatchMember = {
  readonly entry: BatchEntry;
  readonly declaration: Declaration;
  /** The position of the entry in the manifest, counted from 0. */
  readonly position: number;
  readonly batch: number;
  readonly slot: number;
};

/** One batch: its number, its members in slot order, the union of their writes. */
export type Batch = {
  readonly batch: number;
  readonly members: readonly BatchMember[];
  /** The union of the declared writes of the members (F148-FR-014). */
  readonly declaredWrites: readonly string[];
  /** True where the batch holds more than one command (F148-FR-017). */
  readonly concurrent: boolean;
};

/** One admission or refusal, in the fields of the event `check.admission`. */
export type AdmissionRecord = {
  readonly checkId: string;
  readonly batch: number;
  /** Null for a refusal (F148-FR-012). */
  readonly slot: number | null;
  readonly result: AdmissionResult;
  readonly reason: AdmissionReason;
  /** The rule that refused, for a reader of the plan; not a field of the event. */
  readonly ruleId: string | null;
};

/** The plan of a run: the batches and every admission and refusal. */
export type BatchPlan = {
  readonly parallelism: number;
  readonly batches: readonly Batch[];
  readonly admissions: readonly AdmissionRecord[];
};

/** What `formBatches` is given beside the entries. */
export type FormationOptions = {
  readonly parallelism?: number;
  readonly profile?: string;
  readonly lowered?: boolean;
  readonly stepRunner?: boolean;
  readonly exclusiveCaches?: Readonly<Record<string, readonly string[]>>;
};

function batchOf(number: number, members: readonly BatchMember[]): Batch {
  const writes = [...new Set(members.flatMap((member) => member.declaration.writes))].sort();
  return Object.freeze({
    batch: number,
    members: Object.freeze([...members]),
    declaredWrites: Object.freeze(writes),
    concurrent: members.length > 1,
  });
}

/**
 * F148-FR-012 — form the batches. The function is PURE: the same manifest and
 * the same parallelism give the same batches and the same admissions, with no
 * command run and no file read (`research.md` D-3).
 *
 * The entries are taken in the ORDER OF THE MANIFEST, greedily. A batch
 * closes when the next command is refused — which is recorded — or when it
 * holds as many commands as the parallelism, which is capacity and not a
 * refusal.
 */
export function formBatches(
  entries: readonly BatchEntry[],
  options: FormationOptions = {},
): BatchPlan {
  const effective = effectiveParallelism({
    ...(options.parallelism === undefined ? {} : { configured: options.parallelism }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    ...(options.lowered === undefined ? {} : { lowered: options.lowered }),
  });
  const parallelism = effective.value;
  const batches: Batch[] = [];
  const admissions: AdmissionRecord[] = [];
  let open: BatchMember[] = [];
  let number = 0;

  const close = (): void => {
    if (open.length > 0) batches.push(batchOf(number, open));
    open = [];
    number += 1;
  };

  entries.forEach((entry, position) => {
    const declaration = declarationOf(entry);
    if (open.length > 0) {
      const decision = admissionOf(declaration, {
        members: open.map((member) => member.declaration),
        ...(options.stepRunner === undefined ? {} : { stepRunner: options.stepRunner }),
        lowered: effective.lowered,
        ...(options.exclusiveCaches === undefined
          ? {}
          : { exclusiveCaches: options.exclusiveCaches }),
      });
      if (decision.result === "refused") {
        // Every refusal is recorded, with the batch it was refused from and
        // no slot (F148-FR-012).
        admissions.push(
          Object.freeze({
            checkId: entry.id,
            batch: number,
            slot: null,
            result: "refused" as const,
            reason: decision.reason,
            ruleId: decision.ruleId,
          }),
        );
        close();
      } else if (open.length >= parallelism) {
        // Capacity, not a refusal: the batch closes and nothing is recorded.
        close();
      }
    }
    const slot = open.length;
    const member: BatchMember = Object.freeze({
      entry,
      declaration,
      position,
      batch: number,
      slot,
    });
    open.push(member);
    admissions.push(
      Object.freeze({
        checkId: entry.id,
        batch: number,
        slot,
        result: "admitted" as const,
        reason: REASON_OF_AN_ADMISSION,
        ruleId: null,
      }),
    );
  });
  close();

  return Object.freeze({
    parallelism,
    batches: Object.freeze(batches),
    admissions: Object.freeze(admissions),
  });
}

/** Every member of a plan, in the order of the manifest. */
export function membersOf(plan: BatchPlan): readonly BatchMember[] {
  return Object.freeze(
    plan.batches.flatMap((batch) => [...batch.members]).sort((a, b) => a.position - b.position),
  );
}

/** The batch a command was admitted to, or `undefined`. */
export function batchOfACommand(plan: BatchPlan, checkId: string): Batch | undefined {
  return plan.batches.find((batch) => batch.members.some((member) => member.entry.id === checkId));
}

/* ------------------------------------------------------------------ *
 * The event `check.admission` (F148-FR-012).
 * ------------------------------------------------------------------ */

/**
 * F148-FR-012 — the `data` of one `check.admission`: the five fields of the
 * catalogue and nothing else. A refusal carries `slot: null`.
 */
export function admissionEventData(record: AdmissionRecord): Readonly<Record<string, unknown>> {
  return Object.freeze({
    checkId: record.checkId,
    batch: record.batch,
    slot: record.result === "refused" ? null : record.slot,
    result: record.result,
    reason: record.reason,
  });
}

/** One event of an admission or a refusal, ready for the one event writer. */
export type AdmissionEvent = {
  readonly type: typeof CHECK_ADMISSION;
  readonly data: Readonly<Record<string, unknown>>;
};

/** F148-FR-012 — one event for EVERY admission and EVERY refusal of a plan. */
export function admissionEventsOf(plan: BatchPlan): readonly AdmissionEvent[] {
  return Object.freeze(
    plan.admissions.map((record) =>
      Object.freeze({ type: CHECK_ADMISSION, data: admissionEventData(record) }),
    ),
  );
}

/** True where the reason is a member of row 236 of annex X §X.6. */
export function isAnAdmissionReason(value: string): value is AdmissionReason {
  return (ADMISSION_REASONS as readonly string[]).includes(value);
}
