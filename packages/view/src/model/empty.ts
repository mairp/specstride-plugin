/**
 * T021 — the view before any event is folded, with the fields that come from
 * the state files and the observations already settled (F129-FR-002).
 */
import { LANE_TABLE, SCHEMA_ID } from "./view.ts";
import type { RunView } from "./view.ts";
import { ACCEPTED_MAJORS } from "../reduce/index.ts";
import { DEFAULT_STALE_EVENT_SEC } from "./ports.ts";

/** Every field of the view at its empty value. `project` settles over it. */
export function emptyView(now: string): RunView {
  return Object.freeze({
    schema: SCHEMA_ID,
    now,
    runId: null,
    workspaceId: null,
    feature: null,
    cursor: Object.freeze({ file: null, offset: 0, lastSeq: 0 }),
    state: "none" as const,
    stateSince: null,
    transition: null,
    display: "none",
    liveness: "unknown" as const,
    conditions: Object.freeze({ dead: false, stale: null, launchAbandoned: false }),
    launch: Object.freeze({
      launchId: null,
      reason: null,
      outcome: null,
      engineStartId: null,
    }),
    progress: Object.freeze({
      phase: null,
      phases: null,
      phaseAttempt: null,
      pass: null,
      rejects: 0,
      malformed: 0,
      units: null,
      elapsedSeconds: 0,
    }),
    strategy: Object.freeze({ strategy: null, microLevel: null, layerOffReason: null }),
    phases: Object.freeze([]),
    cards: Object.freeze([]),
    lanes: Object.freeze([]),
    laneTable: LANE_TABLE,
    attention: Object.freeze([]),
    attentionOmitted: 0,
    budget: Object.freeze([]),
    budgetOmitted: 0,
    processes: Object.freeze({ holders: Object.freeze([]), omitted: 0, cut: 0 }),
    supervision: null,
    activity: Object.freeze({
      latestTool: null,
      observabilityMode: null,
      observabilityReason: null,
    }),
    telemetry: Object.freeze([]),
    timeline: Object.freeze({ rows: Object.freeze([]), omitted: 0 }),
    parallel: null,
    diagnostics: Object.freeze({
      skippedLines: 0,
      gaps: Object.freeze([]),
      majorsSeen: Object.freeze([]),
      majorsAccepted: ACCEPTED_MAJORS,
      majorsOutOfRange: 0,
      tornLastLine: false,
      fieldsCut: Object.freeze([]),
      fieldsDropped: Object.freeze([]),
      redactorFailed: false,
    }),
    signature: Object.freeze({ record: Object.freeze({}), token: "0".repeat(8) }),
    stream: Object.freeze({
      first: null,
      last: null,
      runStartedAt: null,
      runEndedAt: null,
      passSeconds: 0,
      passStartedAt: null,
    }),
    settled: Object.freeze({ heartbeatLate: false, staleEventSec: DEFAULT_STALE_EVENT_SEC }),
  });
}
