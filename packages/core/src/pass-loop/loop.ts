/**
 * The CLASSIC LOOP of one phase attempt (F103-FR-003 to F103-FR-007,
 * F103-FR-010, F103-FR-011, and the breakers of `./accounting.ts`).
 *
 * One call per phase attempt: the engine hands a request record
 * (`./request.ts`) and receives a result record, and the loop decides when the
 * next pass starts and when it must stop.
 *
 * ## The order of one turn of the loop
 *
 * The order is `specs/103-proposer-pass/contracts/accounting-order.json`.
 * Before the FIRST pass: the check for phase evidence, then the empty-prompt
 * refusal (F103-FR-006, in that order). Before EVERY pass: the stop flag, the
 * source check (F103-FR-021), the prompt, and the session directive. After
 * EVERY pass, in this fixed order:
 *
 *  1. `betweenPasses` of the harness port (F103-FR-010);
 *  2. the kill check and 3. the yield check (F103-FR-022, feature 118's);
 *  4. the loop layer at `afterPass` (F103-FR-022);
 *  5. phase evidence exists: end with 0 (F103-FR-005);
 *  5a. a pass the layer gave back: `iter_done`, the pass number returned
 *      (F115-FR-027, feature 115's extension of this order);
 *  6. a quota class: hand the pass number back, change no counter (F103-FR-020);
 *  7. the short-pass counter (feature 118's);
 *  8. the error accounting and the cap counter (F103-FR-012, F103-FR-013, F103-FR-015);
 *  9. the no-progress measurement and counter (F103-FR-016, F103-FR-017);
 * 10. the stop flag (F103-FR-019);
 * 11. `iter_done`, then the pause unless this was the last pass (F103-FR-004, F103-FR-003).
 *
 * Steps 2, 3, 4 and 7 belong to features this phase does not build; the loop
 * calls them through `LoopHooks`, whose absent members are no-ops, so the
 * order is already in place for them and the step a later feature fills does
 * not move the steps around it. `STEPS_NOT_OWNED_BY_THIS_PHASE` names them.
 *
 * ## `betweenPasses` is called FIRST, and a failure reads as `continue`
 *
 * F103-FR-010 is exact about the three things a reader gets wrong:
 *
 *  - the loop starts every pass through `startPass` of the harness port and
 *    NEVER tests the NAME of a harness (`TESTS_THE_NAME_OF_A_HARNESS` is
 *    `false`): a harness that needs its own behaviour between passes gets it
 *    through its adapter, which is where the dsh plugin protocol lives;
 *  - `betweenPasses` is called AFTER every pass and BEFORE the kill check;
 *  - a FAILURE of `betweenPasses`, and a value OUTSIDE the closed set, are
 *    both read as `continue`. Neither stops the loop and neither counts
 *    against a breaker. `stop` with the result 4 ends the loop with
 *    `exit_code` 4 and `stop` with 7 ends it with 7, and neither of those
 *    counts against a breaker either.
 *
 * ## A non-zero exit of the harness does not end the loop
 *
 * F103-FR-003: only the rules of the loop end it. A pass that exits non-zero
 * is a pass that ended; whether it counts as an error is the accounting's
 * question and not the exit code's.
 */
import type {
  BetweenPassesOutcome,
  HarnessPort,
  PassHandle,
} from "@specstride/contracts/ep/harness";
import {
  accountForPass,
  DEFAULT_LIMITS,
  ZERO_COUNTERS,
  type Accounting,
  type AccountingPath,
  type Counters,
  type Limits,
  type PassOutcome,
} from "./accounting.ts";
import {
  evidenceAlreadyExists,
  evidenceAppeared,
  evidencePresentEvent,
  evidenceWrittenEvent,
  iterDoneEvent,
  iterStartEvent,
  proposerPassBanner,
  type Announcement,
} from "./announce.ts";
import { checkPrompt, EMPTY_PROMPT_LINE } from "./empty-prompt.ts";
import { invocationIdOfPass } from "./invocation-id.ts";
import type { PassLoopRequest } from "./request.ts";
import { checkSources, type SourceCheckQuestion } from "./source-check.ts";
import {
  elapsedSinceOpen,
  plannedEvents,
  tickedEvents,
  type TaskEvent,
  type TaskListPort,
  type TaskSliceReading,
} from "./task-events.ts";

/** The requirements this module carries out. */
export const REQUIREMENTS = [
  "F103-FR-003",
  "F103-FR-004",
  "F103-FR-005",
  "F103-FR-006",
  "F103-FR-007",
  "F103-FR-010",
  "F103-FR-011",
  "F103-FR-044",
] as const;

/** F103-FR-010 — the loop never tests the NAME of a harness. */
export const TESTS_THE_NAME_OF_A_HARNESS = false as const;

/** F103-FR-003 — a non-zero exit of the harness does not end the loop. */
export const A_NON_ZERO_EXIT_ENDS_THE_LOOP = false as const;

/** F103-FR-003 — under the `parity` profile every pass is a FRESH session. */
export const EVERY_PASS_IS_FRESH_UNDER_PARITY = true as const;

/** F103-FR-003 — the loop does not pause after the LAST pass. */
export const PAUSES_AFTER_THE_LAST_PASS = false as const;

/** F103-FR-003 — the pass loop makes no check of its own on the pass limit. */
export const CHECKS_THE_PASS_LIMIT_ITSELF = false as const;

/** The steps of the order after a pass that other features fill. */
export const STEPS_NOT_OWNED_BY_THIS_PHASE = Object.freeze({
  2: "the kill check (F103-FR-022; feature 118)",
  3: "the yield check (F103-FR-022; feature 118)",
  4: "the loop layer at `afterPass` (F103-FR-022)",
  7: "the short-pass counter (F103-FR-022; feature 118)",
});

/* ------------------------------------------------------------------ *
 * `betweenPasses` (F103-FR-010).
 * ------------------------------------------------------------------ */

/** F103-FR-010 — the closed set `betweenPasses` returns. */
export const BETWEEN_PASSES_OUTCOMES = ["continue", "stop:4", "stop:7"] as const;

/** F103-FR-010 — a failure, and a value outside the set, are read as `continue`. */
export const WHEN_UNKNOWN_OR_FAILED = "continue" as const;

/** F103-FR-010 — neither `stop` counts against a breaker. */
export const A_STOP_COUNTS_AGAINST_A_BREAKER = false as const;

/** How the loop read what `betweenPasses` returned. */
export type BetweenPassesReading = {
  /** `continue`, or a stop with its result. */
  readonly outcome: "continue" | "stop";
  /** The result of a stop: 4 or 7. */
  readonly result?: 4 | 7;
  /** True where the value the port returned was not a member of the set. */
  readonly wasUnknown: boolean;
  /** True where the call itself failed. */
  readonly failed: boolean;
  /** The value the port returned, as it stood, for a line and for a test. */
  readonly returned?: unknown;
};

/**
 * F103-FR-010 — read what `betweenPasses` returned.
 *
 * `continue` goes on. `stop` with the result 4 ends the loop with `exit_code`
 * 4; `stop` with 7 ends it with 7. A value outside the closed set is read as
 * `continue` — including a `stop` whose result is neither 4 nor 7, which is
 * outside the set just as surely as a word the set does not hold.
 */
export function readBetweenPasses(returned: unknown): BetweenPassesReading {
  if (typeof returned !== "object" || returned === null) {
    return Object.freeze({ outcome: "continue", wasUnknown: true, failed: false, returned });
  }
  const value = returned as { outcome?: unknown; result?: unknown };
  if (value.outcome === "continue") {
    return Object.freeze({ outcome: "continue", wasUnknown: false, failed: false, returned });
  }
  if (value.outcome === "stop" && (value.result === 4 || value.result === 7)) {
    return Object.freeze({
      outcome: "stop",
      result: value.result,
      wasUnknown: false,
      failed: false,
      returned,
    });
  }
  return Object.freeze({ outcome: "continue", wasUnknown: true, failed: false, returned });
}

/** F103-FR-010 — a FAILURE of `betweenPasses` is read as `continue`. */
export const FAILED_READING: BetweenPassesReading = Object.freeze({
  outcome: "continue",
  wasUnknown: false,
  failed: true,
});

/**
 * F103-FR-010 — call `betweenPasses` of the harness port with the handle of
 * the pass that ended, its result and the working directory, and read what it
 * returned. A throw, a rejection and an unknown value all become `continue`.
 */
export async function callBetweenPasses(
  port: Pick<HarnessPort, "betweenPasses">,
  handle: PassHandle,
  result: unknown,
  workingDirectory: string,
): Promise<BetweenPassesReading> {
  let returned: BetweenPassesOutcome | unknown;
  try {
    returned = await port.betweenPasses(handle, result, workingDirectory);
  } catch {
    return FAILED_READING;
  }
  return readBetweenPasses(returned);
}

/* ------------------------------------------------------------------ *
 * The pass limit (F103-FR-011).
 * ------------------------------------------------------------------ */

/** The logical component prefix of a line of the pass loop. */
export const LOGICAL_PREFIX = "proposer.sh:" as const;

/** F103-FR-011 — the line of the pass limit reached without phase evidence. */
export function maxIterLine(limit: number, evidencePath: string): string {
  return `${LOGICAL_PREFIX} max-iter (${limit}) reached without ${evidencePath}`;
}

/** F103-FR-011 — on the pass limit the loop writes NO stop line of its own. */
export const WRITES_A_STOP_LINE_ON_THE_PASS_LIMIT = false as const;

/* ------------------------------------------------------------------ *
 * What one pass of the loop is driven by.
 * ------------------------------------------------------------------ */

/** What the loop learns about one pass, besides the handle it started. */
export type PassReport = {
  /** The handle `startPass` returned. */
  readonly handle: PassHandle;
  /** The result of the invocation, which `betweenPasses` is handed. */
  readonly result?: unknown;
  /** What the accounting needs of this pass, less the pass number and its id. */
  readonly outcome: Omit<PassOutcome, "pass" | "passId">;
};

/**
 * The steps of the order after a pass that other features own. An absent
 * member is a no-op, so the ORDER is in place before the features that fill
 * these steps exist.
 */
export type LoopHooks = {
  /** Step 2 — the kill check (feature 118). A result ends the loop. */
  killCheck?(pass: number): { readonly exit_code: number } | undefined;
  /** Step 3 — the yield check (feature 118). A result ends the loop. */
  yieldCheck?(pass: number): { readonly exit_code: number } | undefined;
  /**
   * Step 4 — the loop layer at `afterPass` (F103-FR-022). A returned
   * `givenBack: true` gives the pass number back after the evidence check
   * (F115-FR-027): the pass raises no pass count and no classic counter, and
   * the loop continues on the same pass number.
   */
  afterPass?(pass: number): void | { readonly givenBack?: boolean };
  /** Step 7 — the short-pass counter (feature 118). */
  shortPass?(pass: number): void;
  /**
   * F103-FR-020 — the pause, the resume time and the WAIT CEILING of a pass
   * that failed with a quota class. The quota feature owns all three; the loop
   * only hands the pass number back. A result ends the loop — the ceiling of a
   * quota pause is the engine's exit 4 with the stop reason
   * `paused_quota_ceiling` — and where the member is absent the loop goes
   * straight on, which is what makes the carve-out testable without a wait.
   */
  quotaWait?(
    pass: number,
    quotaClass: string,
  ):
    | Promise<{ readonly exit_code: number } | undefined>
    | { readonly exit_code: number }
    | undefined;
  /** Steps 1 and 10 — the stop flag. A truth value ends the loop with 6. */
  stopRequested?(): boolean;
};

/** What the loop needs that is not in the request. */
export type LoopServices = {
  /** The harness port; `startPass` and `betweenPasses` are the two used here. */
  readonly port: Pick<HarnessPort, "startPass" | "betweenPasses">;
  /** True when the phase evidence exists NOW (F103-FR-005, F103-FR-006). */
  evidenceExists(): boolean;
  /** Run one pass to its end and report what it ended with. */
  runPass(pass: number, passId: string, prompt: string): Promise<PassReport>;
  /** The ISO time of the banner of a pass (F103-FR-004). */
  now(): string;
  /** The pause between passes; a test hands one that does not sleep. */
  pause(seconds: number): Promise<void>;
  /** What a line of compatibility output is written to. */
  print(line: string): void;
  /** What an as-is event is emitted through. */
  emit(announcement: Announcement | { readonly asIsName: string; readonly fields: unknown }): void;
  /** The hashes of the three sources at a pass start (F103-FR-021). */
  sourceHashes?(pass: number): SourceCheckQuestion;
  /** The limits of the breakers; the defaults of this feature where absent. */
  readonly limits?: Limits;
  /** F103-FR-018 — whether the switch of row 59 is on. */
  readonly noProgressStructured?: boolean;
  /** The counters as the ledger holds them on a resume (F103-FR-040). */
  readonly counters?: Counters;
  /** The steps other features own. */
  readonly hooks?: LoopHooks;
  /**
   * F103-FR-044 — the READ port the engine fills from the spec-format
   * adapter, through which the loop reads the tasks of the phase slice. The
   * loop never writes through it: it has no writer (`./task-events.ts`).
   * Where the engine hands none, no task event is emitted, and the loop runs
   * exactly as it did before the port existed.
   */
  readonly taskList?: TaskListPort;
  /**
   * F103-FR-044 — the channel of the CATALOGUE events, kept apart from
   * `emit`, which carries the as-is announcements of `./announce.ts`. The two
   * task events project to nothing (rows 107 and 108 of the projection
   * table), so a catalogue event that reached the as-is stream would change a
   * compared surface under `parity`, which F103-FR-044 forbids.
   */
  emitEvent?(event: TaskEvent): void;
  /**
   * F103-FR-044 — the clock `elapsedMs` is measured on, in milliseconds, from
   * the OPEN of the phase attempt. Where it is absent the elapsed time is not
   * known and `task.ticked` carries no `elapsedMs`, rather than a zero.
   */
  clockMs?(): number;
};

/** The result record of the pass loop (`./pass-loop-result.schema.json`). */
export type PassLoopResult = {
  readonly exit_code: number;
  readonly passReached?: number;
  readonly blocked?: {
    readonly reason: "declared-block" | "source-changed";
    readonly file?: "spec" | "plan" | "tasks";
    readonly needs?: string;
  };
  readonly message?: string;
  /** The counters as they stand, which the engine writes back to the ledger. */
  readonly counters?: Counters;
};

/**
 * F103-FR-003 to F103-FR-011 — the classic loop of one phase attempt.
 *
 * The request is already normalized (`normalizeRequest` of `./request.ts`), so
 * this function makes no usage check: by the time it is called the working
 * directory is canonical, the evidence path is absolute and the standing
 * prompt has been read once, which is what F103-FR-007 asks for — a change of
 * a file the prompt was built from during the attempt reaches no later pass.
 */
export async function runPassLoop(
  request: PassLoopRequest,
  services: LoopServices,
): Promise<PassLoopResult> {
  const limits = services.limits ?? DEFAULT_LIMITS;
  const hooks = services.hooks ?? {};
  let counters: Counters = services.counters ?? ZERO_COUNTERS;
  let declarationSeen = false;

  // F103-FR-044 — AT THE OPEN OF THE PHASE ATTEMPT, `task.planned` once per
  // task of the phase slice. It stands here, before the evidence check of
  // F103-FR-005, because this IS the open of the attempt: an attempt that
  // ends at once because the evidence is already there still planned the
  // tasks it was opened for. The events project to nothing (rows 107 and 108
  // of the projection table), so no compared surface moves.
  const openedAtMs = services.clockMs?.();
  let slice: readonly TaskSliceReading[] = services.taskList?.readPhaseSlice() ?? [];
  for (const event of plannedEvents(slice)) services.emitEvent?.(event);

  // F103-FR-006 — before any prompt is read and before any pass starts.
  if (services.evidenceExists()) {
    services.print(evidenceAlreadyExists(request.evidence));
    services.emit(evidencePresentEvent(baseNameOf(request.evidence)));
    return Object.freeze({ exit_code: 0, passReached: 0, counters });
  }

  // F103-FR-006 — AFTER that check, a prompt of white space alone is refused.
  const prompt = checkPrompt(request.standingPrompt);
  if (prompt.refused) {
    services.print(EMPTY_PROMPT_LINE);
    return Object.freeze({ exit_code: 1, passReached: 0, message: EMPTY_PROMPT_LINE, counters });
  }

  // F103-FR-003 — passes are numbered from 1 up to the pass limit, and the
  // loop makes no check of its own on the value of the limit.
  //
  // The counter is driven by hand and not by a `for` step, because of
  // F103-FR-020: a pass that failed with a quota class GIVES ITS PASS NUMBER
  // BACK, so the next pass carries the SAME number and the quota failure costs
  // the phase attempt none of its pass limit. A `for (pass = 1; ...; pass +=
  // 1)` cannot express that without a flag that reads worse than this does.
  let pass = 1;
  let passesStarted = 0;
  while (pass <= request.passLimit) {
    if (hooks.stopRequested?.() === true) {
      return Object.freeze({ exit_code: 6, passReached: passesStarted, counters });
    }

    // F103-FR-021 — the source check, before the pass and before its prompt.
    if (services.sourceHashes !== undefined) {
      const checked = checkSources(services.sourceHashes(pass));
      if (checked.stopped && checked.blocked !== undefined) {
        // F103-FR-021 — no pass starts, so the pass number reached is the
        // number of passes that DID start, and the phase evidence that was
        // already delivered is left where it is.
        services.emit({ asIsName: "blocked", fields: checked.event ?? {} });
        return Object.freeze({
          exit_code: 3,
          passReached: passesStarted,
          blocked: checked.blocked,
          counters,
        });
      }
    }

    // F103-FR-004 — the banner and `iter_start`, before every pass.
    services.print(proposerPassBanner(pass, request.passLimit, services.now()));
    services.emit(iterStartEvent(pass, request.passLimit));
    passesStarted += 1;

    const passId = invocationIdOfPass(pass, request.invocationBase);
    const report = await services.runPass(pass, passId, request.standingPrompt);

    // F103-FR-044 — AFTER THE PASS, `task.ticked` for every checkbox that
    // went from unticked to ticked DURING IT. The change is read by comparing
    // two readings of the task list through the port, never by writing: the
    // loop ticks no checkbox and edits the list in no way. The comparison
    // stands here, before every exit path of the rest of the pass, so a pass
    // that ends in a kill, a yield or a breaker reports its ticks too.
    if (services.taskList !== undefined) {
      const after = services.taskList.readPhaseSlice();
      const elapsedMs =
        openedAtMs === undefined || services.clockMs === undefined
          ? undefined
          : elapsedSinceOpen(openedAtMs, services.clockMs());
      for (const event of tickedEvents(slice, after, elapsedMs)) services.emitEvent?.(event);
      slice = after;
    }

    // Step 1 — `betweenPasses`, before the kill check (F103-FR-010).
    const between = await callBetweenPasses(
      services.port,
      report.handle,
      report.result,
      request.workdir,
    );
    if (between.outcome === "stop" && between.result !== undefined) {
      // F103-FR-010 — neither stop counts against a breaker.
      return Object.freeze({ exit_code: between.result, passReached: pass, counters });
    }

    // Steps 2 and 3 — the kill check and the yield check (feature 118's).
    const killed = hooks.killCheck?.(pass);
    if (killed !== undefined) {
      return Object.freeze({ exit_code: killed.exit_code, passReached: pass, counters });
    }
    const yielded = hooks.yieldCheck?.(pass);
    if (yielded !== undefined) {
      return Object.freeze({ exit_code: yielded.exit_code, passReached: pass, counters });
    }

    // Step 4 — the loop layer at `afterPass` (F103-FR-022).
    const layerAfterPass = hooks.afterPass?.(pass);

    // Step 5 — phase evidence wins outright (F103-FR-005), whatever the pass
    // ended with: an error, a kill, or a yield artifact written in the pass.
    // The edge case of F115-FR-027 — a pass that wrote a checkpoint AND phase
    // evidence — keeps evidence winning here, before any give-back is read.
    if (services.evidenceExists()) {
      services.print(evidenceAppeared(pass, request.evidence));
      services.emit(evidenceWrittenEvent(baseNameOf(request.evidence), pass));
      return Object.freeze({ exit_code: 0, passReached: pass, counters });
    }

    // F115-FR-027 — the give-back. A pass the layer gave back ends the turn
    // with `iter_done` and WITHOUT `pass += 1`, after the evidence check and
    // before the classic accounting: no error count, no short-pass count, no
    // no-progress measurement — the pass number costs the phase attempt
    // nothing of its pass limit.
    if (typeof layerAfterPass === "object" && layerAfterPass !== null) {
      if (layerAfterPass.givenBack === true) {
        services.emit(iterDoneEvent(pass));
        continue;
      }
    }

    // Step 7 — the short-pass counter (feature 118's).
    hooks.shortPass?.(pass);

    // Steps 6, 8 and 9 — the quota carve-out, the error accounting and the
    // cap counter, then the no-progress measurement and counter.
    //
    // `declarationSeen` is threaded through the accounting and never kept as a
    // flag of the whole phase attempt: W-103-01 asks whether a declaration was
    // seen IN THE COUNTED PASSES, and a pass that made progress resets the
    // streak and the memory of a declaration with it.
    const accounted: Accounting = accountForPass(
      counters,
      Object.freeze({ ...report.outcome, pass, passId }),
      {
        limits,
        ...(services.noProgressStructured !== undefined
          ? { noProgressStructured: services.noProgressStructured }
          : {}),
        declarationSeenEarlier: declarationSeen,
      },
    );
    counters = accounted.counters;
    declarationSeen = accounted.declarationInCountedPasses;
    for (const line of accounted.lines) services.print(line);
    for (const event of accounted.events) services.emit(event);
    if (accounted.exit_code !== undefined) {
      return Object.freeze({
        exit_code: accounted.exit_code,
        passReached: accounted.passReached,
        ...(accounted.blocked !== undefined ? { blocked: accounted.blocked } : {}),
        counters,
      });
    }
    // Step 10 — the stop flag.
    if (hooks.stopRequested?.() === true) {
      return Object.freeze({ exit_code: 6, passReached: pass, counters });
    }

    // F103-FR-020 — the carve-out. The pass number is GIVEN BACK: the next
    // pass carries the same number, so a quota failure costs the phase
    // attempt none of its pass limit and no counter of the loop moved. The
    // pause, the resume time and the wait are the quota feature's, which is
    // why nothing is waited for here.
    if (accounted.carvedOut) {
      services.emit(iterDoneEvent(pass));
      const waited = await hooks.quotaWait?.(pass, report.outcome.quotaClass ?? "");
      if (waited !== undefined) {
        return Object.freeze({ exit_code: waited.exit_code, passReached: pass, counters });
      }
      continue;
    }

    // Step 11 — `iter_done`, then the pause unless this was the last pass.
    services.emit(iterDoneEvent(pass));
    if (pass < request.passLimit) await services.pause(request.pauseSec);
    pass += 1;
  }

  // F103-FR-011 — the pass limit, reached with no phase evidence: the line,
  // the result 4, and NO stop line of its own (defect D-45, preserved).
  services.print(maxIterLine(request.passLimit, request.evidence));
  return Object.freeze({ exit_code: 4, passReached: request.passLimit, counters });
}

/** The base name of a path, which the two evidence events carry. */
function baseNameOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? path : path.slice(at + 1);
}

export type { AccountingPath };
