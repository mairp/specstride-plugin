/**
 * T023 — one runner for every check, and no check while a process of the pass
 * lives (F148-FR-005; `research.md` D-2, R27 D1.4, feature 100 annex C §C.8).
 *
 * Two rules, both of them data a test can read:
 *
 *  1. **One runner.** The verification gate, release verification, inner
 *     checks, the closing check and the merge check call THE SAME runner, so a
 *     result means the same in all of them. `CHECK_CALLERS` names the five and
 *     `runnerFor` gives every one of them the same instance. A check is run by
 *     the RUNTIME and never by the harness of the proposer, and no model acts
 *     as a check: `refuseRunnerOfACheck` is the one place that says so.
 *  2. **No start while a pass lives.** The runner reads the process registry
 *     (`run:<runId>:procs`, annex B §B.10) and does not start a command while
 *     it shows a process of the pass as alive, apart from a detached job held
 *     by an accepted yield. Ending those processes belongs to the owner of
 *     kills; this guard only reads (R23v IR-32).
 */
import schema from "@specstride/contracts/schemas/process-registry.schema.json" with { type: "json" };

/**
 * The fields of the process registry this guard READS (annex B §B.10; schema
 * `specstride.procs/1`, which feature 100 owns). The guard reads and never
 * writes: ending a process belongs to the owner of kills.
 */
export type ProcessRegistryEntry = {
  readonly procId: string;
  readonly kind: string;
  readonly class: string;
  readonly endedAt?: string | null;
  readonly endCause?: string | null;
};

type ProcsSchema = {
  properties: {
    kind: { enum: string[] };
    class: { enum: string[] };
  };
};

/** The seven kinds of §B.10, read from the schema so they cannot drift. */
export const PROCESS_KINDS: readonly string[] = Object.freeze([
  ...(schema as ProcsSchema).properties.kind.enum,
]);

/** The two classes of §B.10 (row 22 of annex X §X.6), read from the schema. */
export const PROCESS_CLASSES: readonly string[] = Object.freeze([
  ...(schema as ProcsSchema).properties.class.enum,
]);

/**
 * F100-FR-063 — the class of the detached job of an accepted yield. It is the
 * one class that survives a stop, which is why such a job may still live when
 * a check is due.
 */
export const CLASS_OF_A_DETACHED_JOB = "adoptable" as const;

/** The five callers of F148-FR-005 that use the same runner. */
export const CHECK_CALLERS = [
  "verification-gate",
  "release-verification",
  "inner-check",
  "closing-check",
  "merge-check",
] as const;
export type CheckCaller = (typeof CHECK_CALLERS)[number];

/** F148-FR-005 — who may run a check, and who may not. */
export const RUN_BY = "runtime" as const;
export const NEVER_RUN_BY = Object.freeze([
  "proposer-harness",
  "model",
  "critic",
  "host-skill",
] as const);
export type ForbiddenRunner = (typeof NEVER_RUN_BY)[number];

/** Raised where anything but the runtime is named as the runner of a check. */
export class RunnerOfACheckRefusedError extends Error {
  readonly named: string;
  constructor(named: string) {
    super(
      `a check is run by the ${RUN_BY} and never by the harness of the proposer, and no ` +
        `model acts as a check (F148-FR-005; decision 21); \`${named}\` was named`,
    );
    this.name = "RunnerOfACheckRefusedError";
    this.named = named;
  }
}

/** F148-FR-005 — only the runtime runs a check. Anything else is refused. */
export function refuseRunnerOfACheck(named: string): void {
  if (named !== RUN_BY) throw new RunnerOfACheckRefusedError(named);
}

/**
 * The kinds of the process registry that are a PROCESS OF THE PASS: the pass
 * of the proposer, the pass of a worker, and a call of the critic class. A
 * check waits for all three (annex C §C.8, "Guarantees of the core": a check
 * starts only after the pass has exited).
 */
export const PASS_PROCESS_KINDS = ["harness-pass", "worker-pass", "critic-call"] as const;
export type PassProcessKind = (typeof PASS_PROCESS_KINDS)[number];

/**
 * The one kind a live entry of which does NOT hold a check back: the detached
 * job held by an accepted yield, which is `adoptable` by F100-FR-063 and
 * outlives the pass on purpose (F148-FR-005, "apart from a detached job held
 * by an accepted yield").
 */
export const KIND_THAT_DOES_NOT_HOLD_A_CHECK_BACK = "detached-job" as const;

/** The kinds that are neither a pass nor the detached job of a yield. */
export const KINDS_THAT_ARE_NOT_A_PASS: readonly string[] = Object.freeze(
  PROCESS_KINDS.filter(
    (kind) =>
      !(PASS_PROCESS_KINDS as readonly string[]).includes(kind) &&
      kind !== KIND_THAT_DOES_NOT_HOLD_A_CHECK_BACK,
  ),
);

/** An entry of the registry is alive while it has neither an end nor an end cause. */
export function isAlive(entry: Pick<ProcessRegistryEntry, "endedAt" | "endCause">): boolean {
  const endedAt = entry.endedAt ?? null;
  const endCause = entry.endCause ?? null;
  return (endedAt === null || endedAt === "") && (endCause === null || endCause === "");
}

/** True where the entry is a process of the pass (whatever its state). */
export function isProcessOfThePass(entry: Pick<ProcessRegistryEntry, "kind">): boolean {
  return (PASS_PROCESS_KINDS as readonly string[]).includes(String(entry.kind));
}

/**
 * True where the entry is the detached job of an accepted yield: the kind
 * `detached-job`, which F100-FR-063 makes `adoptable`.
 */
export function isDetachedJobOfAYield(
  entry: Pick<ProcessRegistryEntry, "kind" | "class">,
): boolean {
  if (String(entry.kind) !== KIND_THAT_DOES_NOT_HOLD_A_CHECK_BACK) return false;
  return String(entry.class) === CLASS_OF_A_DETACHED_JOB;
}

/** The live processes of the pass the registry shows. */
export function liveProcessesOfThePass(
  entries: readonly Pick<
    ProcessRegistryEntry,
    "procId" | "kind" | "class" | "endedAt" | "endCause"
  >[],
): readonly string[] {
  return Object.freeze(
    entries
      .filter((entry) => isProcessOfThePass(entry) && isAlive(entry))
      .map((entry) => String(entry.procId)),
  );
}

/** What the guard decided, and why. */
export type StartVerdict =
  | { readonly mayStart: true; readonly heldBackBy: readonly [] }
  | { readonly mayStart: false; readonly heldBackBy: readonly string[]; readonly reason: string };

/**
 * F148-FR-005 — the verdict of the guard: a check does not start while the
 * process registry shows a process of the pass as alive, apart from a
 * detached job held by an accepted yield.
 */
export function mayStartACheck(
  entries: readonly Pick<
    ProcessRegistryEntry,
    "procId" | "kind" | "class" | "endedAt" | "endCause"
  >[],
): StartVerdict {
  const held = liveProcessesOfThePass(entries);
  if (held.length === 0) return Object.freeze({ mayStart: true as const, heldBackBy: [] as const });
  return Object.freeze({
    mayStart: false as const,
    heldBackBy: Object.freeze([...held]),
    reason:
      `the process registry shows ${held.length} process(es) of the pass as alive ` +
      `(${held.join(", ")}); a check does not start while a process of the pass lives, ` +
      `apart from a detached job held by an accepted yield (F148-FR-005)`,
  });
}

/** Raised where a start is asked for while a process of the pass lives. */
export class PassStillLivesError extends Error {
  readonly heldBackBy: readonly string[];
  constructor(heldBackBy: readonly string[], message: string) {
    super(message);
    this.name = "PassStillLivesError";
    this.heldBackBy = Object.freeze([...heldBackBy]);
  }
}

/** `mayStartACheck` that throws instead of returning a verdict. */
export function refuseStartWhileAPassLives(
  entries: readonly Pick<
    ProcessRegistryEntry,
    "procId" | "kind" | "class" | "endedAt" | "endCause"
  >[],
): void {
  const verdict = mayStartACheck(entries);
  if (!verdict.mayStart) throw new PassStillLivesError(verdict.heldBackBy, verdict.reason);
}
