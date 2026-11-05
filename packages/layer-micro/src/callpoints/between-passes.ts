/**
 * T045, T049 — the call point `betweenPasses`: the inner check and the
 * guards around it (F115-FR-013, F115-FR-014, F115-FR-015, F115-FR-026;
 * annex D §D.1 row 3).
 *
 * Order of one call, in the words of the requirements:
 *
 * 1. F115-FR-014 — verify the hash of the check manifest and the pin of
 *    every executable of the inner set. On a mismatch the check does not
 *    run, the layer goes off for the phase attempt, and an integrity event
 *    of the kind `manifest-mismatch` or `pin-mismatch` is raised. The layer
 *    never derives exclusions itself: exclusions are by the runtime only.
 * 2. F115-FR-015 — end every process of the pass through the engine, except
 *    a detached job held by an accepted yield. Where the engine cannot
 *    guarantee that no process of the pass remains, protection reads
 *    `detect`. A result is the exit status the runtime observed — never read
 *    from a file, and output of a test the proposer ran is never a result.
 * 3. F115-FR-013 — run every command of the inner set through the check
 *    runner, in manifest order, and never stop at a failed command.
 * 4. F115-FR-026 — a stop request is checked before the check starts and at
 *    every poll while it runs; the wall-clock budget is checked as it is
 *    during the wait of a yield; a quota pause is entered at a boundary and
 *    the paused cycle is not counted; an accelerated phase attempt gets the
 *    layer with the same check manifest.
 * 5. The outcome of the check is decided in `unit/outcome.ts` from the
 *    observed exit statuses and the conditions the check runner set.
 *
 * The layer runs no process itself: every command goes through the check
 * runner the engine offers, and the processes of the pass are ended by the
 * engine (IR-10, IR-32).
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */
import { decideOutcome, type CheckResult, type UnitDecision } from "../unit/outcome.ts";

/** One entry of the inner check set: a manifest entry the runtime verified. */
export type InnerCommand = {
  readonly id: string;
  readonly argv: readonly string[];
};

/** The verification of the manifest hash and of the pins, before a check. */
export type ManifestVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "manifest-mismatch" | "pin-mismatch" };

/** The services of the engine the point needs (annex D §D.1, Inputs). */
export type BetweenPassesServices = {
  /**
   * F115-FR-014 — verify the hash of the check manifest and the pin of
   * every executable of the inner set. Exclusions are made by the runtime
   * only; this service verifies, it never excludes.
   */
  readonly verifyManifest: () => ManifestVerification;
  /**
   * F115-FR-015 — end every process of the pass that the engine can
   * identify, except a detached job held by an accepted yield. `guaranteed`
   * is false when the engine cannot guarantee that no process of the pass
   * remains; protection then reads `detect`.
   */
  readonly endPassProcesses: () => Promise<{ readonly guaranteed: boolean }>;
  /**
   * F115-FR-013 — run one command of the inner set and return the exit
   * status the runtime observed. The check runner sets the conditions
   * (`tainted`, `cached`) and compares the fingerprints before and after.
   */
  readonly runCheckCommand: (command: InnerCommand) => Promise<CheckResult>;
  /** The inner set: the manifest entries marked as inner, less the ones the runtime excluded. */
  readonly innerSet: readonly InnerCommand[];
  /** True when a stop request stands (F115-FR-026); polled before and during. */
  readonly stopRequested: () => boolean;
  /** True while the wall-clock budget of the phase attempt still holds. */
  readonly budgetAvailable: () => boolean;
  /** Enter a quota pause at a boundary; the paused cycle is not counted. */
  readonly enterQuotaPause: () => Promise<void>;
};

/** Why the check did not run to its end. */
export type CheckAbortion =
  { readonly reason: "stop-requested" } | { readonly reason: "budget-exhausted" };

/** What the layer returns at `betweenPasses`. */
export type BetweenPassesOutcome = {
  /** `layerOffForAttempt` on an integrity event, else the outcome directive. */
  readonly directive: string;
  /** The decision for the unit, when a check ran. */
  readonly decision?: UnitDecision;
  /** The results the runtime observed, in manifest order. */
  readonly results: readonly CheckResult[];
  /** The integrity event raised on a manifest or pin mismatch. */
  readonly integrityEvent?: { readonly kind: string };
  /** Why the check stopped early, when it did. */
  readonly aborted?: CheckAbortion["reason"];
  /** True when the engine could not guarantee an empty process table. */
  readonly protectionDetect?: boolean;
  /** True when a quota pause was entered at the boundary of this check. */
  readonly quotaPaused?: boolean;
  /** True when the check ran with the same manifest on an accelerated attempt. */
  readonly acceleratedManifest?: boolean;
};

/** The input of one `betweenPasses` call. */
export type BetweenPassesInput = {
  readonly services: BetweenPassesServices;
  /** The task ids of the unit the pass declared, as validated at `afterPass`. */
  readonly taskIds: readonly string[];
  /** Repairs left per task id, and the default (F115-FR-022). */
  readonly budget: {
    readonly repairsLeft: Readonly<Record<string, number>>;
    readonly defaultRepairsLeft: number;
  };
  /** True when the phase attempt is an accelerated one (F115-FR-026). */
  readonly accelerated?: boolean;
};

/**
 * T045, T049 — run the inner check of the phase for the unit of the pass,
 * with the manifest and pin verification first, the processes of the pass
 * ended first, every command run, and the stop, budget and quota guards
 * around the run.
 */
export async function betweenPasses(input: BetweenPassesInput): Promise<BetweenPassesOutcome> {
  const { services } = input;
  const acceleratedManifest = input.accelerated === true;

  // F115-FR-026 — a stop request is checked before the check starts.
  if (services.stopRequested()) {
    return { directive: "none", results: [], aborted: "stop-requested" };
  }

  // F115-FR-014, IR-08 — the manifest hash and the pins, before every check.
  const verification = services.verifyManifest();
  if (!verification.ok) {
    return {
      directive: "layerOffForAttempt",
      results: [],
      integrityEvent: { kind: verification.kind },
    };
  }

  // F115-FR-015, IR-32 — the processes of the pass end before the check.
  const ended = await services.endPassProcesses();

  // F115-FR-026 — a quota pause is entered at a boundary of a check; the
  // paused cycle is not counted, so the pause happens before any cycle book.
  await services.enterQuotaPause();

  const results: CheckResult[] = [];
  let aborted: CheckAbortion["reason"] | undefined;
  for (const command of services.innerSet) {
    // F115-FR-026 — the stop request and the wall-clock budget are checked
    // at every poll of the check, here between the commands.
    if (services.stopRequested()) {
      aborted = "stop-requested";
      break;
    }
    if (!services.budgetAvailable()) {
      aborted = "budget-exhausted";
      break;
    }
    // F115-FR-013 — the command runs; a failed command never stops a check.
    results.push(await services.runCheckCommand(command));
  }

  const decision = decideOutcome(results, { taskIds: input.taskIds, budget: input.budget });
  return {
    directive: decision.directive,
    decision,
    results,
    ...(aborted === undefined ? {} : { aborted }),
    ...(ended.guaranteed ? {} : { protectionDetect: true }),
    ...(acceleratedManifest ? { acceleratedManifest: true } : {}),
  };
}
