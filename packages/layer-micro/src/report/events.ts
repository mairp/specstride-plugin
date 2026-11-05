/**
 * T110 — the events of the layer (F115-FR-037), emitted through the engine
 * under the types of the table "Events of the layer" of `spec.md`. The types
 * and their fields are those of the event catalogue of feature 111
 * (`specs/111-event-schema-and-projection/contracts/event-catalogue.tsv`).
 *
 * Rules the module enforces, so a caller cannot break them:
 *
 * - A type that the table does not name is refused: the layer writes no
 *   event of a type the catalogue does not hold (F115-FR-037). The guard is
 *   `isLayerEventType`, and `layerEvent` throws on anything else.
 * - An event holds no output of a command and no note of a checkpoint: the
 *   forbidden field names of `FORBIDDEN_EVENT_FIELDS` throw.
 * - A pass that an inner time cap ended is marked as ended by a time limit
 *   (`markKilledByInnerTimeCap`), so that it counts as a killed pass in
 *   every measurement (F115-FR-065 applies the same mark to inner caps).
 * - The layer going off carries the cause of the ledger record `disengaged`
 *   (field `layerOff`, N-111-1) and, where one applies, the fallback reason
 *   (field `fallbackReason`).
 *
 * Purity: imports `@specstride/contracts` only; no `node:fs`, no process.
 */
import { FALLBACK_REASONS, type FallbackReason } from "../strategy/fallback.ts";

/**
 * The event types of the table "Events of the layer" of `spec.md`, in the
 * order of that table. Every one is in the catalogue of feature 111.
 */
export const LAYER_EVENT_TYPES = [
  "strategy.selected",
  "attempt.started",
  "microloop.inert",
  "checkpoint.accepted",
  "checkpoint.refused",
  "checkpoint.removed",
  "check.started",
  "check.ended",
  "microloop.unit",
  "check.excluded",
  "route.decided",
  "escalation.skipped",
  "integrity.noted",
  "tripwire.raised",
  "tripwire.cleared",
] as const;
export type LayerEventType = (typeof LAYER_EVENT_TYPES)[number];

/** True only for a type the table names (and the catalogue holds). */
export function isLayerEventType(value: unknown): value is LayerEventType {
  return typeof value === "string" && (LAYER_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Field names that would carry the output of a command or the note of a
 * checkpoint. An event that carries one is refused, never silently trimmed.
 */
export const FORBIDDEN_EVENT_FIELDS = [
  "output",
  "stdout",
  "stderr",
  "note",
  "transcript",
  "log",
] as const;

/** The causes of the ledger record `disengaged` (N-111-1, feature 111). */
export const LAYER_OFF_CAUSES = [
  "caps",
  "integrity",
  "check-error",
  "no-check",
  "single-unit",
  "layer-error",
  "breach",
] as const;
export type LayerOffCause = (typeof LAYER_OFF_CAUSES)[number];

/** One event of the layer: a catalogue type and its catalogue fields. */
export type LayerEvent = {
  readonly type: LayerEventType;
  readonly fields: Readonly<Record<string, unknown>>;
};

function guard(type: string, fields: Readonly<Record<string, unknown>>): void {
  if (!isLayerEventType(type)) {
    throw new Error(`event type not in the table "Events of the layer": ${type}`);
  }
  for (const name of FORBIDDEN_EVENT_FIELDS) {
    if (name in fields) {
      throw new Error(
        `an event holds no ${name} of a command and no note of a checkpoint (F115-FR-037)`,
      );
    }
  }
}

/**
 * Build one event of the layer under a type of the catalogue. Throws on a
 * type the catalogue does not hold and on a forbidden field.
 */
export function layerEvent(
  type: LayerEventType,
  fields: Readonly<Record<string, unknown>> = {},
): LayerEvent {
  guard(type, fields);
  return Object.freeze({ type, fields: Object.freeze({ ...fields }) });
}

/** `strategy.selected` — the strategy of a run, with the manifest hashes and the fallback reason. */
export function strategySelected(fields: {
  strategy: string;
  level: string;
  manifestHashes: readonly string[];
  fallbackReason?: FallbackReason;
}): LayerEvent {
  return layerEvent("strategy.selected", {
    strategy: fields.strategy,
    level: fields.level,
    manifestHashes: [...fields.manifestHashes],
    ...(fields.fallbackReason === undefined ? {} : { fallbackReason: fields.fallbackReason }),
  });
}

/** `attempt.started` — the strategy of a phase attempt (field `strategy`). */
export function attemptStarted(fields: {
  phase: number;
  attempt: number;
  strategy: string;
}): LayerEvent {
  return layerEvent("attempt.started", fields);
}

/** `microloop.inert` — a phase attempt that ended without a declared unit. */
export function microloopInert(fields: { phase: number; attempt: number }): LayerEvent {
  return layerEvent("microloop.inert", fields);
}

/** `checkpoint.accepted` — a checkpoint accepted (never the note). */
export function checkpointAccepted(fields: {
  unitId: string;
  taskIds: readonly string[];
  checkpointRef: string;
}): LayerEvent {
  if ("note" in fields) {
    throw new Error("an event holds no note of a checkpoint (F115-FR-037)");
  }
  return layerEvent("checkpoint.accepted", {
    unitId: fields.unitId,
    taskIds: [...fields.taskIds],
    checkpointRef: fields.checkpointRef,
  });
}

/** `checkpoint.refused` — a checkpoint refused, with the reason of row 138. */
export function checkpointRefused(fields: { reason: string; bytes: number }): LayerEvent {
  return layerEvent("checkpoint.refused", fields);
}

/** `checkpoint.removed` — a checkpoint removed at the start of a pass. */
export function checkpointRemoved(fields: { bytes: number }): LayerEvent {
  return layerEvent("checkpoint.removed", fields);
}

/** `check.started` — an inner or closing check starts (`runner` is `runtime`). */
export function checkStarted(fields: {
  checkId: string;
  unitId: string;
  runner: "runtime";
}): LayerEvent {
  return layerEvent("check.started", fields);
}

/** `check.ended` — the check delivered its result (`runner` is `runtime`). */
export function checkEnded(fields: {
  checkId: string;
  result: string;
  unitId: string;
  durationMs: number;
  runner: "runtime";
}): LayerEvent {
  return layerEvent("check.ended", fields);
}

/**
 * `microloop.unit` — the outcome of a unit (annex X §X.6 row 136), or the
 * layer going off: field `layerOff` carries the cause of the record
 * `disengaged` (N-111-1) and, where one applies, the fallback reason of
 * row 59 (field `fallbackReason`).
 */
export function microloopUnit(fields: {
  unitId: string;
  check: string;
  result: string;
  layerOff?: LayerOffCause;
  fallbackReason?: FallbackReason;
}): LayerEvent {
  for (const reason of [fields.fallbackReason]) {
    if (reason !== undefined && !(FALLBACK_REASONS as readonly string[]).includes(reason)) {
      throw new Error(`not a fallback reason of row 59: ${reason}`);
    }
  }
  if (
    fields.layerOff !== undefined &&
    !(LAYER_OFF_CAUSES as readonly string[]).includes(fields.layerOff)
  ) {
    throw new Error(`not a cause of the record disengaged: ${fields.layerOff}`);
  }
  return layerEvent("microloop.unit", {
    unitId: fields.unitId,
    check: fields.check,
    result: fields.result,
    ...(fields.layerOff === undefined ? {} : { layerOff: fields.layerOff }),
    ...(fields.fallbackReason === undefined ? {} : { fallbackReason: fields.fallbackReason }),
  });
}

/** `check.excluded` — an exclusion of a command, with the reason. */
export function checkExcluded(fields: {
  checkId: string;
  reason: string;
  scope: string;
  durationMs: number;
  ruleId?: string;
}): LayerEvent {
  return layerEvent("check.excluded", {
    checkId: fields.checkId,
    reason: fields.reason,
    scope: fields.scope,
    durationMs: fields.durationMs,
    ...(fields.ruleId === undefined ? {} : { ruleId: fields.ruleId }),
  });
}

/** `route.decided` — one decision of the router (F115-FR-033). */
export function routeDecided(fields: {
  tableId: string;
  tableVersion: string;
  point: string;
  ruleId: string;
  choice: string;
}): LayerEvent {
  return layerEvent("route.decided", {
    tableId: fields.tableId,
    tableVersion: fields.tableVersion,
    point: fields.point,
    ruleId: fields.ruleId,
    choice: fields.choice,
  });
}

/** `escalation.skipped` — an escalation skipped, with the reason of row 140. */
export function escalationSkipped(fields: { reason: string }): LayerEvent {
  return layerEvent("escalation.skipped", fields);
}

/** `integrity.noted` — an integrity event, with its kind of row 65. */
export function integrityNoted(fields: { kind: string; detail: string }): LayerEvent {
  return layerEvent("integrity.noted", fields);
}

/** `tripwire.raised` — the tripwire raised, with the breach kind and the rule id. */
export function tripwireRaised(fields: { kind: string; ruleId: string }): LayerEvent {
  return layerEvent("tripwire.raised", fields);
}

/** `tripwire.cleared` — written in the next engine start after `tripwire clear`. */
export function tripwireCleared(fields: { clearedAt: string }): LayerEvent {
  return layerEvent("tripwire.cleared", fields);
}

/**
 * The mark of a pass that an inner time cap ended (F115-FR-037, last
 * sentence): it is marked as ended by a time limit, so that it counts as a
 * killed pass in every measurement. The fields are the `pass.ended` fields
 * `endCause` and `killClass` of the catalogue.
 */
export function markKilledByInnerTimeCap(): {
  readonly endCause: "time-limit";
  readonly killClass: "inner-cap";
  readonly killed: true;
} {
  return Object.freeze({
    endCause: "time-limit" as const,
    killClass: "inner-cap" as const,
    killed: true as const,
  });
}
