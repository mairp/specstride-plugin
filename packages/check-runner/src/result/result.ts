/**
 * T021 — the result of a command: the exit result, and the conditions of row
 * 53 of annex X §X.6 each in a field of its own, with their reasons
 * (F148-FR-003; `research.md` D-7, R23v IR-40).
 *
 * Four rules of F148-FR-003 are code here, not prose:
 *
 *  1. **A condition never replaces the exit result.** `withCondition` copies
 *     the exit result across untouched and refuses to be given one; the only
 *     way to change `exitCode`, `signal`, `stdout`, `stderr` or `passed` is to
 *     build a new result from an execution.
 *  2. **A result with `tainted`, `unchecked` or `interrupted` is never stated
 *     as a pass.** `statedAsPass` is the one reader of that rule, and
 *     `passed` — the exit result — stays beside it, because what a caller
 *     decides from the exit result belongs to the caller.
 *  3. **Which owner sets each condition.** `CONDITION_OWNERS` and
 *     `uncheckedReasonOwner` carry the table; `checkRunnerMaySet` refuses the
 *     conditions this feature does not own (`cached` belongs to feature 116,
 *     five of the seven reasons of `unchecked` to the loop layer or to the
 *     owner of the verification gate).
 *  4. **A condition the reader does not know makes the result `unchecked`
 *     with the reason `unknown-condition`, and a condition of another owner is
 *     passed through unchanged.** `readResult` is that reader.
 *
 * The exit-result field names are the baseline's, byte for byte
 * (`lib/verification_plan.py:1593` of Specstride at `9cab15d`): `commandId`,
 * `executable`, `args`, `cwd`, `exitCode`, `signal`, `durationMs`, `stdout`,
 * `stderr`, `passed`. The conditions and `reason` stand beside them.
 */
import {
  RESULT_CONDITIONS,
  TAINTED_REASONS,
  UNCHECKED_REASONS,
  type ResultCondition,
  type UncheckedReason,
  type RunnerError,
} from "./closed-sets.ts";

/** The five conditions, each a field of its own (F148-FR-003). */
export type ResultConditions = {
  readonly tainted: boolean;
  readonly cached: boolean;
  readonly flaky: boolean;
  readonly interrupted: boolean;
  readonly unchecked: boolean;
};

/** No condition set: what a command that exits 0 carries (acceptance scenario 1). */
export const NO_CONDITIONS: ResultConditions = Object.freeze({
  tainted: false,
  cached: false,
  flaky: false,
  interrupted: false,
  unchecked: false,
});

/**
 * The exit result the runtime observed. It is never read from a file
 * (F148-FR-002).
 */
export type ExitResult = {
  readonly commandId: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly passed: boolean;
};

/** One step of a command, for the option `steps` (F148-FR-008). */
export type StepResult = {
  readonly id: string;
  readonly required: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
};

/** One execution of the steps of one command (row 235; F148-FR-009). */
export type StepRun = {
  readonly state: "full" | "partial";
  readonly startedAt: string;
  readonly steps: readonly StepResult[];
};

/**
 * The value the runner returns for one execution of one command. It is a
 * RETURNED value: this feature stores nothing (`research.md` D-14).
 */
export type RunnerResult = ExitResult &
  ResultConditions & {
    /** A reason of row 53, for `tainted` and `unchecked`; else null. */
    readonly reason: string | null;
    /** A member of row 54 where the runner itself failed; else null. */
    readonly error: RunnerError | null;
    /** The batch and the slot of the command, or null outside a batch. */
    readonly batch: number | null;
    readonly slot: number | null;
    /** True where the command ran beside another (F148-FR-017). */
    readonly concurrent: boolean;
    /** The run of steps, where the option `steps` ran it. */
    readonly steps: StepRun | null;
    /** The second execution of a failed member of a batch (F148-FR-016). */
    readonly rerun: RunnerResult | null;
    /** Condition names the reader did not know (F148-FR-003). */
    readonly unknownConditions: readonly string[];
  };

/** Who sets a condition, and under which requirement. */
export type ConditionOwner = {
  readonly condition: ResultCondition;
  /** The feature number that sets it, or the two that may. */
  readonly setBy: readonly string[];
  readonly owner: string;
  readonly requirements: readonly string[];
  /** True where THIS feature sets the condition itself. */
  readonly checkRunnerSets: boolean;
};

/**
 * F148-FR-003 — which owner sets each condition. The check runner sets
 * `tainted`, `flaky`, `interrupted` and `unchecked` for two of its seven
 * reasons; `cached` belongs to the owner of the protected set and the
 * toolchain profiles (feature 116, F116-FR-009) and is never set here.
 */
export const CONDITION_OWNERS: readonly ConditionOwner[] = Object.freeze([
  Object.freeze({
    condition: "tainted" as const,
    setBy: Object.freeze(["148"]),
    owner: "the check runner",
    requirements: Object.freeze(["F148-FR-006", "F148-FR-010", "F148-FR-014"]),
    checkRunnerSets: true,
  }),
  Object.freeze({
    condition: "cached" as const,
    setBy: Object.freeze(["116"]),
    owner: "the owner of the protected set and the toolchain profiles",
    requirements: Object.freeze(["F116-FR-009"]),
    checkRunnerSets: false,
  }),
  Object.freeze({
    condition: "flaky" as const,
    setBy: Object.freeze(["148"]),
    owner: "the check runner",
    requirements: Object.freeze(["F148-FR-016"]),
    checkRunnerSets: true,
  }),
  Object.freeze({
    condition: "interrupted" as const,
    setBy: Object.freeze(["148"]),
    owner: "the check runner",
    requirements: Object.freeze(["F148-FR-003"]),
    checkRunnerSets: true,
  }),
  Object.freeze({
    condition: "unchecked" as const,
    setBy: Object.freeze(["148", "115", "105"]),
    owner:
      "the check runner for `partial` and `unknown-condition`; else the loop layer or the owner of the verification gate",
    requirements: Object.freeze(["F148-FR-003", "F148-FR-009"]),
    checkRunnerSets: true,
  }),
]);

/** The owner row of one condition. */
export function conditionOwner(condition: ResultCondition): ConditionOwner {
  const row = CONDITION_OWNERS.find((value) => value.condition === condition);
  // Every member of row 53 has a row above; the closed set and this table are
  // compared by a test of their own.
  if (row === undefined) throw new Error(`no owner row for the condition \`${condition}\``);
  return row;
}

/** The two reasons of `unchecked` this feature sets itself (F148-FR-003, F148-FR-009). */
export const UNCHECKED_REASONS_OF_THIS_FEATURE: readonly UncheckedReason[] = Object.freeze([
  "partial",
  "unknown-condition",
]);

/**
 * F148-FR-003 — which owner sets `unchecked` with a given reason. The other
 * five reasons are set by the loop layer or by the owner of the verification
 * gate, and the runner passes them through unchanged.
 */
export function uncheckedReasonOwner(reason: string): {
  readonly reason: string;
  readonly setBy: readonly string[];
  readonly owner: string;
  readonly checkRunnerSets: boolean;
} {
  const mine = (UNCHECKED_REASONS_OF_THIS_FEATURE as readonly string[]).includes(reason);
  return Object.freeze({
    reason,
    setBy: mine ? Object.freeze(["148"]) : Object.freeze(["115", "105"]),
    owner: mine ? "the check runner" : "the loop layer or the owner of the verification gate",
    checkRunnerSets: mine,
  });
}

/**
 * F148-FR-003 — true where the check runner may set the condition itself.
 * `cached` is never set here; `unchecked` only with `partial` or
 * `unknown-condition`.
 */
export function checkRunnerMaySet(condition: ResultCondition, reason?: string | null): boolean {
  if (condition === "unchecked") {
    return reason === undefined || reason === null
      ? false
      : uncheckedReasonOwner(reason).checkRunnerSets;
  }
  return conditionOwner(condition).checkRunnerSets;
}

/** The closed set of reasons a condition may carry, or none where it carries no reason. */
export function reasonsOf(condition: ResultCondition): readonly string[] | null {
  if (condition === "tainted") return TAINTED_REASONS;
  if (condition === "unchecked") return UNCHECKED_REASONS;
  return null;
}

/**
 * The unknown-value branch of the reasons of row 53: a reason outside the set
 * leaves the condition standing and is shown as text. The function says so;
 * it never throws and never drops the condition.
 */
export function readReason(
  condition: ResultCondition,
  reason: string | null,
): { readonly reason: string | null; readonly known: boolean; readonly shownAsText: boolean } {
  const set = reasonsOf(condition);
  if (set === null || reason === null) {
    return Object.freeze({ reason, known: reason === null, shownAsText: false });
  }
  const known = set.includes(reason);
  return Object.freeze({ reason, known, shownAsText: !known });
}

/** An empty result for a command that was never executed, with its exit fields null. */
export function emptyResult(parts: {
  readonly commandId: string;
  readonly executable?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
}): RunnerResult {
  return Object.freeze({
    commandId: parts.commandId,
    executable: parts.executable ?? "",
    args: Object.freeze([...(parts.args ?? [])]),
    cwd: parts.cwd ?? "",
    exitCode: null,
    signal: null,
    durationMs: 0,
    stdout: "",
    stderr: "",
    passed: false,
    ...NO_CONDITIONS,
    reason: null,
    error: null,
    batch: null,
    slot: null,
    concurrent: false,
    steps: null,
    rerun: null,
    unknownConditions: Object.freeze([]),
  });
}

/** Build a result from an exit result the runtime observed, with no condition set. */
export function resultOf(
  exit: ExitResult,
  extra: Partial<Omit<RunnerResult, keyof ExitResult>> = {},
): RunnerResult {
  return Object.freeze({
    ...exit,
    args: Object.freeze([...exit.args]),
    ...NO_CONDITIONS,
    reason: null,
    error: null,
    batch: null,
    slot: null,
    concurrent: false,
    steps: null,
    rerun: null,
    unknownConditions: Object.freeze([]),
    ...extra,
  });
}

/** The exit-result fields of a result, which a condition never replaces. */
export const EXIT_RESULT_FIELDS: readonly (keyof ExitResult)[] = Object.freeze([
  "commandId",
  "executable",
  "args",
  "cwd",
  "exitCode",
  "signal",
  "durationMs",
  "stdout",
  "stderr",
  "passed",
]);

/** Raised where a caller tries to change the exit result while setting a condition. */
export class ExitResultIsNotReplaceableError extends Error {
  readonly fields: readonly string[];
  constructor(fields: readonly string[]) {
    super(
      `a condition never replaces the exit result (F148-FR-003); this call would ` +
        `change ${fields.map((f) => `\`${f}\``).join(", ")}`,
    );
    this.name = "ExitResultIsNotReplaceableError";
    this.fields = Object.freeze([...fields]);
  }
}

/**
 * F148-FR-003 — set one condition on a result. The exit result is copied
 * across untouched: a caller that names an exit-result field is refused, so
 * the rule "a condition never replaces the exit result" cannot be broken by
 * this path.
 */
export function withCondition(
  result: RunnerResult,
  condition: ResultCondition,
  reason: string | null = null,
  extra: Readonly<Record<string, unknown>> = {},
): RunnerResult {
  const named = Object.keys(extra).filter((k) =>
    (EXIT_RESULT_FIELDS as readonly string[]).includes(k),
  );
  if (named.length > 0) throw new ExitResultIsNotReplaceableError(named);
  return Object.freeze({
    ...result,
    [condition]: true,
    reason: reason ?? result.reason,
    ...extra,
  }) as RunnerResult;
}

/**
 * F148-FR-003 — a result with `tainted`, `unchecked` or `interrupted` is never
 * stated as a pass, in a record, in an event or in the fact block. `passed`
 * (the exit result) stays beside this reading and is not changed by it.
 */
export const CONDITIONS_THAT_FORBID_A_PASS: readonly ResultCondition[] = Object.freeze([
  "tainted",
  "unchecked",
  "interrupted",
]);

export function statedAsPass(result: RunnerResult): boolean {
  if (!result.passed) return false;
  return !CONDITIONS_THAT_FORBID_A_PASS.some((condition) => result[condition]);
}

/** The condition that forbids the pass, where one does; else null. */
export function conditionForbiddingThePass(result: RunnerResult): ResultCondition | null {
  return CONDITIONS_THAT_FORBID_A_PASS.find((condition) => result[condition]) ?? null;
}

/**
 * F148-FR-003 — a command ended by `cancel` or by a stop request before its
 * own end carries `interrupted` together with the error `interrupted`, and is
 * never stated as a pass.
 */
export function interrupt(result: RunnerResult, cause: "cancel" | "stop-request"): RunnerResult {
  return Object.freeze({
    ...withCondition(result, "interrupted"),
    error: "interrupted" as RunnerError,
    reason: result.reason,
    interruptedBy: cause,
  }) as RunnerResult & { readonly interruptedBy: "cancel" | "stop-request" };
}

/** The reason a reader gives a result whose condition it does not know. */
export const UNKNOWN_CONDITION_REASON: UncheckedReason = "unknown-condition";

/**
 * The form of a condition name: a single lower-case word, as every member of
 * row 53 is. A result field of another shape (`durationMs`, `commandId`) is
 * not a condition, however it is set.
 */
export const CONDITION_SHAPED = /^[a-z][a-z-]*$/;

/** What `readResult` found in the value it read. */
export type ReadConditions = {
  readonly known: Readonly<Record<string, boolean>>;
  readonly unknown: readonly string[];
};

/** Partition the condition flags of a value into the known and the unknown. */
export function partitionConditions(value: Readonly<Record<string, unknown>>): ReadConditions {
  const known: Record<string, boolean> = {};
  const unknown: string[] = [];
  const members = RESULT_CONDITIONS as readonly string[];
  const flags: Record<string, unknown> = { ...value };
  const nested = value["conditions"];
  if (nested !== null && typeof nested === "object") {
    Object.assign(flags, nested as Record<string, unknown>);
  }
  for (const [name, flag] of Object.entries(flags)) {
    if (members.includes(name)) {
      if (flag === true) known[name] = true;
      continue;
    }
    // Only a flag that is SET makes an unknown condition: a result that
    // carries `tainted: false` alongside a field of its own that happens to be
    // false says nothing.
    if (flag === true && name !== "passed" && name !== "concurrent" && CONDITION_SHAPED.test(name))
      unknown.push(name);
  }
  return Object.freeze({ known: Object.freeze(known), unknown: Object.freeze(unknown) });
}

/**
 * F148-FR-003 — the reader of a result. A condition the reader does not know
 * makes the result `unchecked` with the reason `unknown-condition`; every
 * condition of another owner is passed through UNCHANGED, with its reason.
 * The exit result is read as it stands and is never recomputed from a
 * condition.
 */
export function readResult(value: unknown): RunnerResult {
  const raw = (value ?? {}) as Readonly<Record<string, unknown>>;
  const { known, unknown } = partitionConditions(raw);
  const conditions: ResultConditions = {
    tainted: known["tainted"] === true,
    cached: known["cached"] === true,
    flaky: known["flaky"] === true,
    interrupted: known["interrupted"] === true,
    unchecked: known["unchecked"] === true || unknown.length > 0,
  };
  const givenReason = typeof raw["reason"] === "string" ? (raw["reason"] as string) : null;
  const reason = unknown.length > 0 ? UNKNOWN_CONDITION_REASON : givenReason;
  const exitCode = typeof raw["exitCode"] === "number" ? (raw["exitCode"] as number) : null;
  return Object.freeze({
    commandId: typeof raw["commandId"] === "string" ? (raw["commandId"] as string) : "",
    executable: typeof raw["executable"] === "string" ? (raw["executable"] as string) : "",
    args: Object.freeze(Array.isArray(raw["args"]) ? [...(raw["args"] as string[])] : []),
    cwd: typeof raw["cwd"] === "string" ? (raw["cwd"] as string) : "",
    exitCode,
    signal: typeof raw["signal"] === "string" ? (raw["signal"] as string) : null,
    durationMs: typeof raw["durationMs"] === "number" ? (raw["durationMs"] as number) : 0,
    stdout: typeof raw["stdout"] === "string" ? (raw["stdout"] as string) : "",
    stderr: typeof raw["stderr"] === "string" ? (raw["stderr"] as string) : "",
    passed: raw["passed"] === true,
    ...conditions,
    reason,
    error: (typeof raw["error"] === "string" ? raw["error"] : null) as RunnerError | null,
    batch: typeof raw["batch"] === "number" ? (raw["batch"] as number) : null,
    slot: typeof raw["slot"] === "number" ? (raw["slot"] as number) : null,
    concurrent: raw["concurrent"] === true,
    steps: (raw["steps"] ?? null) as StepRun | null,
    rerun: (raw["rerun"] ?? null) as RunnerResult | null,
    unknownConditions: Object.freeze([...unknown].sort()),
  });
}

/** The conditions a result carries, by name, in the order of row 53. */
export function conditionsSet(result: ResultConditions): readonly ResultCondition[] {
  return Object.freeze(RESULT_CONDITIONS.filter((condition) => result[condition]));
}

/**
 * The value of the field `condition` of the event `check.ended`: the
 * conditions a result carries, or null where it carries none (F148-FR-007).
 */
export function conditionField(result: ResultConditions): string | null {
  const set = conditionsSet(result);
  return set.length === 0 ? null : set.join(",");
}
