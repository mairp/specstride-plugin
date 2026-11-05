/**
 * T020, T021 — the fold.
 *
 * `reduce(view, event)` takes a view and ONE event and returns the next view
 * (F129-FR-002). It looks the event type up in the signal table, calls the one
 * function of that signal, moves the cursor, and derives the fields that come
 * from the fold again. A type the table does not hold reaches no function: it
 * changes no field of the view, it moves the cursor, and it fails nothing
 * (F129-FR-005). An event whose major lies outside the accepted range is NOT
 * folded at all and marks the view `stale`.
 *
 * `reduce` NEVER recomputes a field that comes from a state file or from an
 * observation: those are the work of `project` (F129-FR-002).
 */
import { SUPPORTED_MAJORS, majorIsSupported } from "@specstride/contracts/envelope/event";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import { signalOf, PAIR_OPENERS } from "../signals/table.ts";
import { displayOf, staleOf } from "../conditions/index.ts";
import { attentionItemsOf } from "../attention/raise.ts";
import { orderAttention } from "../attention/index.ts";
import { cardsOf, lanesOf } from "../lanes/index.ts";
import { signature } from "../signature/index.ts";
import { DEFAULT_TIMELINE_ROWS, type ViewPorts } from "../model/ports.ts";
import type { MajorRange, RunView, StreamMark } from "../model/view.ts";
import { draftOf, viewOf, type ViewDraft } from "./draft.ts";
import { elapsedSecondsOf } from "./progress.ts";
import { budgetLevelsOf, quotaStatesOf } from "../budget/index.ts";
import { SIGNAL_FUNCTIONS, type FoldContext } from "./signals.ts";

export { SIGNAL_FUNCTIONS };
export type { FoldContext, ViewDraft };

/** The range of event majors this read model accepts (F129-FR-005). */
export const ACCEPTED_MAJORS: MajorRange = Object.freeze({
  from: SUPPORTED_MAJORS.from,
  to: SUPPORTED_MAJORS.to,
});

/** The context one fold step needs, from the ports. */
export function contextOf(ports: ViewPorts | undefined): FoldContext {
  return Object.freeze({
    redactor: ports?.redactor ?? null,
    timelineRows: ports?.timelineRows ?? DEFAULT_TIMELINE_ROWS,
    textCap: 240,
  });
}

/**
 * T057 (CT-129-16) — the five open pairs the lane table reads
 * (`contracts/lane-and-attention.md`, F129-FR-016), read off the NEWEST mark
 * of the stream through the PAIR_OPENERS table of the signal table: the
 * opening event of a pair has it open, and any later event of the stream is
 * the newest word on the run, so no pair reads open behind it. The flags are
 * derived from the newest mark of the stream — a field the view already holds —
 * so a run
 * folded event by event and the same run projected in one batch derive the
 * same flags (F129-FR-002); pair state kept anywhere else would leave the view
 * unable to reproduce it on the next fold.
 */
function openPairsOf(last: StreamMark | null): {
  critic: boolean;
  verification: boolean;
  pass: boolean;
  unit: boolean;
  workerPass: boolean;
} {
  const flags = {
    critic: false,
    verification: false,
    pass: false,
    unit: false,
    workerPass: false,
  };
  const opener = last === null ? undefined : PAIR_OPENERS[last.type];
  if (opener !== undefined) flags[opener] = true;
  return flags;
}

/** The gap in `seq` between the last event folded and this one (F129-FR-004). */
function recordGap(draft: ViewDraft, event: EventEnvelope): void {
  const last = draft.stream.last;
  if (last === null) return;
  if (event.seq <= last.seq + 1) return;
  const gap = { after: last.seq, before: event.seq };
  if (
    draft.diagnostics.gaps.some((seen) => seen.after === gap.after && seen.before === gap.before)
  ) {
    return;
  }
  draft.diagnostics.gaps.push(gap);
}

/**
 * The derivation step. It reads ONLY fields the view already holds, so running
 * it twice gives the same view: that is what makes `project` over a prefix
 * equal to folding `reduce` over the same prefix (F129-FR-002).
 */
export function derive(draft: ViewDraft, ports?: ViewPorts): void {
  const outOfRange =
    draft.diagnostics.majorsOutOfRange > 0
      ? {
          majorFound:
            draft.diagnostics.majorsSeen.find(
              (major) => !majorIsSupported(major, ACCEPTED_MAJORS),
            ) ?? -1,
          accepted: draft.diagnostics.majorsAccepted,
        }
      : null;
  draft.conditions.stale = staleOf({
    liveness: draft.liveness,
    heartbeatLate: draft.settled.heartbeatLate,
    newestEventAt: draft.stream.last?.ts ?? null,
    now: draft.now,
    staleEventSec: draft.settled.staleEventSec,
    majorOutOfRange: outOfRange,
  });
  draft.display = displayOf({
    state: draft.state,
    dead: draft.conditions.dead,
    launchAbandoned: draft.conditions.launchAbandoned,
    stale: draft.conditions.stale,
    refused: draft.raise.refusal,
  });
  draft.progress.elapsedSeconds = elapsedSecondsOf({
    runStartedAt: draft.stream.runStartedAt ?? draft.stream.first?.ts ?? null,
    runEndedAt: draft.stream.runEndedAt,
    now: draft.now,
  });
  // T074 (F129-FR-022) — the hours of the group `parallel`, derived from the
  // fields the view already holds, so batch and fold agree (F129-FR-002). The
  // wall hours are the elapsed time of the run; the agent hours are the sum of
  // the durations of every pass (the field `passSeconds` of the group `stream`).
  // Where the layer is OFF
  // (`parallel` is null) no field of the group is derived at all: the view
  // holds none (F129-SC-008).
  if (draft.parallel !== null) {
    draft.parallel = {
      ...draft.parallel,
      wallHours: draft.progress.elapsedSeconds / 3600,
      agentHours: draft.stream.passSeconds / 3600,
    };
  }
  // T073 (F129-FR-020) — the level of every budget row: the engine's level,
  // plus `over` where the fraction is above 1. Done before the attention items
  // are raised, because a row at `warn` or higher raises `budget-alert`.
  draft.budget = quotaStatesOf(budgetLevelsOf(draft.budget), draft.raise.pause);
  // T055 — all nine kinds of attention item
  // (`contracts/lane-and-attention.md`): the derived conditions raise
  // `dead-run`, `stale-run`, `launch-abandoned` and `unknown-state`; the state
  // files and the observations raise `blocked-on-human`, `source-changed`,
  // `quota-pause` and `orphan-processes` (F129-FR-017 to F129-FR-021); a
  // budget row at `warn`, `loud` or `over` raises `budget-alert`
  // (F129-FR-020). The kinds are the closed set of
  // `contracts/lane-and-attention.md`, ordered by the table, then by `since`.
  // The settle values (`draft.raise`) come from the state files and the
  // observations, so `reduce` recomputes the raising from the view alone.
  draft.attention = [
    ...orderAttention(
      attentionItemsOf({
        runId: draft.runId,
        state: draft.state,
        stateRaw: draft.raise.stateRaw,
        stateSince: draft.stateSince,
        launchId: draft.launch.launchId,
        dead: draft.conditions.dead,
        stale: draft.conditions.stale,
        launchAbandoned: draft.conditions.launchAbandoned,
        blocked: draft.raise.blocked,
        refusalFile: draft.raise.refusalFile,
        pause: draft.raise.pause,
        holders: draft.processes.holders,
        budgetRows: draft.budget,
        redactor: ports?.redactor ?? null,
      }),
    ).items,
  ];
  // T063 — one card per phase, its lane and its rule id read from the lane
  // table through the INJECTED evaluator (`contracts/lane-and-attention.md`,
  // F129-FR-016); the lanes then group the card ids in the order of `LANES`.
  // T057 (CT-129-16) — the five open-pair flags are the rest of the
  // CardContext, so the rows L-05 (reviewing), L-06 (verifying) and L-07
  // (proposing) can fire on a real view and not only on a table probe.
  const pairs = openPairsOf(draft.stream.last);
  draft.cards = [
    ...cardsOf(
      draft.phases,
      {
        currentPhase: draft.progress.phase,
        runState: draft.state,
        dead: draft.conditions.dead,
        criticCallOpen: pairs.critic,
        verificationOpen: pairs.verification,
        passOpen: pairs.pass,
        unitOpen: pairs.unit,
        workerPassOpen: pairs.workerPass,
      },
      ports?.evaluateTable,
    ),
  ];
  draft.lanes = [...lanesOf(draft.cards)];
  draft.signature = signature(viewOf(draft), ports?.hash);
}

/** One fold step on a draft: the signal function, the cursor and the marks. */
export function foldOne(draft: ViewDraft, event: EventEnvelope, ctx: FoldContext): void {
  const major = typeof event.v === "number" ? event.v : -1;
  if (!draft.diagnostics.majorsSeen.includes(major)) draft.diagnostics.majorsSeen.push(major);
  if (!majorIsSupported(major, ACCEPTED_MAJORS)) {
    // Not folded (F129-FR-005). The view is marked `stale` by `derive`.
    draft.diagnostics.majorsOutOfRange += 1;
    return;
  }
  recordGap(draft, event);
  const signal = signalOf(event.type);
  if (signal !== undefined) SIGNAL_FUNCTIONS[signal](draft, event, ctx);
  if (draft.stream.first === null) {
    draft.stream.first = { seq: event.seq, ts: event.ts ?? null, type: event.type };
  }
  draft.stream.last = { seq: event.seq, ts: event.ts ?? null, type: event.type };
  draft.cursor = { ...draft.cursor, lastSeq: Math.max(draft.cursor.lastSeq, event.seq) };
}

/**
 * F129-FR-002 — the reducer: a view and one event give the next view. The
 * fields that come from the state files and the observations are untouched.
 */
export function reduce(view: RunView, event: EventEnvelope, ports?: ViewPorts): RunView {
  const draft = draftOf(view);
  foldOne(draft, event, contextOf(ports));
  derive(draft, ports);
  return viewOf(draft);
}
