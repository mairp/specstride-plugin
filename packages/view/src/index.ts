/**
 * `@specstride/view` — the UI read model `RunView` of schema
 * `specstride.view/1`, the content of extension point EP-09
 * (`specs/129-run-view-and-status/`).
 *
 * T005 — this file exports EXACTLY `project`, `reduce`, `renderView`,
 * `renderLine`, `expiry`, `signature` and the types. Nothing else of the
 * package is part of its public surface.
 *
 * T021 — `project` itself lives here: the fold, the settle of the fields that
 * come from the state files and the observations, and the cursor (F129-FR-001,
 * F129-FR-002, F129-FR-003). It does NO input or output, reads NO clock and
 * uses NO randomness; its inputs are exactly the four of F129-FR-001, and the
 * functions it may not do itself are a second parameter, the ports.
 *
 * The package imports only `@specstride/contracts` and NO Node built-in module
 * (`packages/contracts/data/package-graph.json`, the entry
 * `@specstride/view`: `mayImport` is `@specstride/contracts` and
 * `nodeBuiltins` is `false`). The table evaluator, the redaction function and
 * the canonical hasher live in `@specstride/kernel` and are handed in by the
 * caller as functions (plan.md, Primary Dependencies).
 */
import { RUN_STATES } from "@specstride/contracts/state/run-state";
import type { ProjectInputs } from "./model/inputs.ts";
import type { ViewPorts } from "./model/ports.ts";
import { DEFAULT_STALE_EVENT_SEC } from "./model/ports.ts";
import { emptyView } from "./model/empty.ts";
import type { Liveness, RunView, SeqGap, ViewState } from "./model/view.ts";
import { ageInSeconds, launchAbandonedOf, livenessOf } from "./conditions/index.ts";
import { contextOf, derive, foldOne } from "./reduce/index.ts";
import { draftOf, viewOf } from "./reduce/draft.ts";
import { suggestedSecondsOf } from "./reduce/progress.ts";
import { cachedViewIsUsable } from "./serialize/index.ts";
import { safeText } from "./text/index.ts";

/** Record a gap once, whoever found it (F129-FR-004). */
function addGap(draft: ReturnType<typeof draftOf>, gap: SeqGap): void {
  if (
    draft.diagnostics.gaps.some((seen) => seen.after === gap.after && seen.before === gap.before)
  ) {
    return;
  }
  draft.diagnostics.gaps.push({ ...gap });
}

function str(record: Readonly<Record<string, unknown>> | null, key: string): string | null {
  if (record === null) return null;
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function int(record: Readonly<Record<string, unknown>> | null, key: string): number | null {
  if (record === null) return null;
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The state the run record names, `none` where there is no record, `unknown` otherwise. */
function stateOf(runRecord: Readonly<Record<string, unknown>> | null): ViewState {
  if (runRecord === null) return "none";
  const written = runRecord["state"];
  if (typeof written === "string" && (RUN_STATES as readonly string[]).includes(written)) {
    return written as ViewState;
  }
  return "unknown";
}

/**
 * F129-FR-001 — one `RunView` of schema `specstride.view/1` from the four
 * inputs. The fold is `reduce` over the events; the settle happens before it
 * and is never done by `reduce`; the cursor names the event file, the byte
 * offset and the last `seq`.
 */
export function project(inputs: ProjectInputs, ports?: ViewPorts): RunView {
  const { events: stream, stateFiles, observations, now } = inputs;
  const ctx = contextOf(ports);

  // F129-FR-003: continue from a cached view, or start again from the first event.
  const decision = cachedViewIsUsable({
    cached: stream.cachedView ?? null,
    runId: str(stateFiles.runRecord, "runId"),
    eventFileBytes: stream.offset ?? null,
    nextSeq: stream.events[0]?.seq ?? null,
    newestEventAt: null,
  });
  const base = decision.usable ? decision.view : emptyView(now);

  const draft = draftOf(base);
  draft.now = now;

  /* ---- the settle: the fields of the state files (F129-FR-010) ---- */
  draft.runId = str(stateFiles.runRecord, "runId");
  draft.workspaceId = str(stateFiles.runRecord, "workspaceId");
  draft.feature = str(stateFiles.runRecord, "feature");
  draft.state = stateOf(stateFiles.runRecord);
  draft.stateSince = str(stateFiles.runRecord, "stateSince");
  draft.transition = str(stateFiles.runRecord, "transition");

  /* ---- the settle: the observations (`contracts/observations.md`) ---- */
  const launchRecord = observations.newestLaunchRecord;
  draft.launch = {
    launchId: str(launchRecord, "launchId") ?? draft.launch.launchId,
    reason: str(launchRecord, "reason") ?? draft.launch.reason,
    outcome: str(launchRecord, "outcome"),
    engineStartId: str(launchRecord, "engineStartId") ?? draft.launch.engineStartId,
  };
  const liveness = livenessOf({
    state: draft.state,
    lease: observations.lease,
    now,
    launchWrittenAt: str(launchRecord, "createdAt"),
    handshakeLimitSec: observations.handshakeLimitSec,
  });
  draft.liveness = liveness.liveness as Liveness;
  draft.conditions.dead = liveness.dead;
  draft.conditions.launchAbandoned = launchAbandonedOf({
    newestLaunchRecord: launchRecord,
    lease: observations.lease,
    now,
    handshakeLimitSec: observations.handshakeLimitSec,
  });
  const supervision = observations.supervisionRecord;
  draft.supervision =
    supervision === null
      ? null
      : Object.freeze({
          nextSeconds: suggestedSecondsOf(supervision),
          unchanged: int(supervision, "unchanged"),
          relaunchBudget:
            typeof supervision["relaunchBudget"] === "object" &&
            supervision["relaunchBudget"] !== null
              ? (supervision["relaunchBudget"] as Readonly<Record<string, unknown>>)
              : null,
        });
  const holders = observations.processTableSearch ?? [];
  draft.processes = {
    holders: holders.slice(0, 50).map((holder) => ({
      kind: str(holder, "kind"),
      class: str(holder, "class"),
      pid: int(holder, "pid"),
    })),
    omitted: Math.max(0, holders.length - 50),
    cut: holders.filter((holder) => str(holder, "endCause") !== null).length,
  };

  /* ---- the settle: the values the derivation reads back (F129-FR-002) ---- */
  const leaseValidUntil = str(observations.lease?.lease ?? null, "validUntil");
  const heartbeatAge = ageInSeconds(leaseValidUntil, now);
  draft.settled = {
    heartbeatLate: heartbeatAge !== null && heartbeatAge > 0,
    staleEventSec: ports?.staleEventSec ?? DEFAULT_STALE_EVENT_SEC,
  };

  /* ---- the diagnostics the event reader found (F129-FR-004) ---- */
  const found = stream.diagnostics;
  if (found !== undefined) {
    draft.diagnostics.tornLastLine = found.tornLastLine === true || draft.diagnostics.tornLastLine;
    draft.diagnostics.skippedLines += found.skippedLines ?? 0;
    // A gap the reader found is recorded once: the fold finds the same gap
    // between two events it folds, and a reader that continues from a cursor
    // finds the gap at the cursor that no fold can see (F129-FR-004).
    for (const gap of found.gaps ?? []) addGap(draft, gap);
  }

  /* ---- the free text of a refused launch (F129-FR-009) ---- */
  const refusal = str(launchRecord, "refusal");
  if (refusal !== null) {
    const outcome = safeText(refusal, ctx.redactor, ctx.textCap);
    if (outcome.dropped) {
      if (!draft.diagnostics.fieldsDropped.includes("launch.refusal")) {
        draft.diagnostics.fieldsDropped.push("launch.refusal");
      }
      draft.diagnostics.redactorFailed = true;
    } else if (outcome.cut && !draft.diagnostics.fieldsCut.includes("launch.refusal")) {
      draft.diagnostics.fieldsCut.push("launch.refusal");
    }
  }

  /* ---- the settle the raising of the attention items reads (T055) ---- */
  const runRecordIn = stateFiles.runRecord ?? null;
  const rawState = runRecordIn === null ? null : runRecordIn["state"];
  draft.raise.stateRaw = typeof rawState === "string" && rawState !== "" ? rawState : null;
  draft.raise.pause = stateFiles.pauseRecord ?? null;
  draft.raise.refusalFile = refusal === "source-changed" ? str(launchRecord, "refusalFile") : null;
  // CQ-166: a refusal the next launch wrote to close its own abandoned record
  // (`launch-abandoned`) is not one the consumer caused, and shows as nothing.
  draft.raise.refusal = refusal === null || refusal === "launch-abandoned" ? null : refusal;
  const terminal = stateFiles.terminalRecord ?? null;
  if (terminal === null) {
    // The event `blocked` fills it in the fold (`signals.ts`); the terminal
    // record stands over it, so the fold leaves a settled record in place.
  } else {
    const options = terminal["options"];
    const needText = str(terminal, "need") ?? str(terminal, "message");
    const need = needText === null ? null : safeText(needText, ctx.redactor, ctx.textCap);
    if (need !== null && need.dropped) {
      if (!draft.diagnostics.fieldsDropped.includes("terminal.need")) {
        draft.diagnostics.fieldsDropped.push("terminal.need");
      }
      draft.diagnostics.redactorFailed = true;
    }
    draft.raise.blocked = {
      reason: str(terminal, "reason"),
      question: str(terminal, "question"),
      options: Array.isArray(options)
        ? Object.freeze(options.filter((entry): entry is string => typeof entry === "string"))
        : Object.freeze([]),
      need: need !== null && !need.dropped ? need.value : null,
    };
  }

  /* ---- the fold (F129-FR-002) ---- */
  for (const event of stream.events) foldOne(draft, event, ctx);

  // T074 (F129-FR-023) — the strategy is a field of the layer of parallel
  // units, so that the status line can carry it; the fields of the layer are
  // present where the RUN RECORD pins a strategy, and the pin stands OVER what
  // the events named — a field of the state files, which `project` settles and
  // `reduce` never recomputes (F129-FR-002), like the terminal record over the
  // event `blocked`.
  const pinnedStrategy = str(stateFiles.runRecord, "strategy");
  if (pinnedStrategy === "classic" || pinnedStrategy === "micro") {
    draft.strategy.strategy = pinnedStrategy;
  }
  const pinnedMicroLevel = int(stateFiles.runRecord, "microLevel");
  if (pinnedMicroLevel !== null) draft.strategy.microLevel = pinnedMicroLevel;
  const pinnedLayerOff = str(stateFiles.runRecord, "layerOffReason");
  if (pinnedLayerOff !== null) draft.strategy.layerOffReason = pinnedLayerOff;

  /* ---- the cursor (F129-FR-003) ---- */
  draft.cursor = {
    file: stream.file ?? draft.cursor.file,
    offset: stream.offset ?? draft.cursor.offset,
    lastSeq: draft.cursor.lastSeq,
  };

  derive(draft, ports);
  return viewOf(draft);
}

export { reduce } from "./reduce/index.ts";
export { renderView } from "./serialize/index.ts";
export { renderLine } from "./line/index.ts";
export { expiry } from "./line/index.ts";
export { signature } from "./signature/index.ts";

export type {
  AttentionItem,
  AttentionKind,
  BudgetLevel,
  BudgetRow,
  Lane,
  LaneTableRow,
  Liveness,
  MajorRange,
  ProcessHolder,
  QuotaState,
  RunView,
  SeqGap,
  StaleCondition,
  StaleReason,
  StatusLineKey,
  StreamMark,
  TelemetryRow,
  TimelineRow,
  ViewActivity,
  ViewCard,
  ViewConditions,
  ViewCursor,
  ViewDiagnostics,
  ViewLane,
  ViewLaunch,
  ViewParallel,
  ViewPhase,
  ViewProcesses,
  ViewProgress,
  ViewSettled,
  ViewSignature,
  ViewState,
  ViewStrategy,
  ViewStream,
  ViewSupervision,
  ViewTimeline,
  ViewUnits,
} from "./model/view.ts";

export type {
  EventStreamInput,
  LeaseObservation,
  ObservationsInput,
  ProjectInputKey,
  ProjectInputs,
  ReaderDiagnostics,
  StateFilesInput,
} from "./model/inputs.ts";

export type {
  CanonicalHasher,
  Redactor,
  TableEvaluator,
  TableRow,
  ViewPorts,
} from "./model/ports.ts";

export type { CacheDecision, CacheRefusal } from "./serialize/index.ts";
export type { ExpiryVerdict, LineOptions } from "./line/index.ts";
export type { Signal, SignalRow } from "./signals/index.ts";
