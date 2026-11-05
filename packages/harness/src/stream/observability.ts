/**
 * T013 — the capability announcement of the seam and its transitions
 * (F126-FR-006).
 *
 * The seam announces the capability of a format at the start of an
 * invocation: `structured` with the signals of the row when the format is
 * registered, `raw-text` with the as-is reason when it is not, and
 * `degraded` with signals `result` when the reader fails to start or when a
 * diagnostic with code `unsupported_schema` or `absent_schema` arrives while
 * the mode differs. Other diagnostics — `malformed_json` among them — never
 * change the mode. A registered format whose route falls back is announced
 * per pass with `mode=raw-text`, the route reason and signals `text,result`.
 */
import {
  diagnosticCodeShown,
  observabilityModeOrDegraded,
  routeReasonText,
  streamSignals,
  type DiagnosticCode,
  type ObservabilityMode,
  type RouteReason,
  type StreamSignal,
} from "./closed-sets.ts";

/** The signals of a raw-text or degraded announcement: `text,result` / `result`. */
const RAW_TEXT_SIGNALS: readonly StreamSignal[] = ["text", "result"];
const DEGRADED_SIGNALS: readonly StreamSignal[] = ["result"];

/** One announcement: mode, reason, provider format, role, supported signals. */
export type CapabilityAnnouncement = {
  readonly mode: ObservabilityMode;
  readonly reason: string | null;
  readonly providerFormat: string | null;
  readonly role: string;
  readonly signals: readonly StreamSignal[];
};

/** A format row, as far as the announcement reads it. */
export type AnnouncementRow = {
  readonly name: string;
  readonly signals: readonly StreamSignal[];
};

/** The start-of-invocation announcement (F126-FR-006). */
export function announceCapability(
  row: AnnouncementRow | undefined,
  context: { role: string; providerFormat?: string | null | undefined },
): CapabilityAnnouncement {
  if (row !== undefined) {
    return {
      mode: "structured",
      reason: null,
      providerFormat: context.providerFormat ?? row.name,
      role: context.role,
      signals: row.signals,
    };
  }
  return {
    mode: "raw-text",
    reason: "structured schema unavailable — parsing plain output",
    providerFormat: context.providerFormat ?? null,
    role: context.role,
    signals: RAW_TEXT_SIGNALS,
  };
}

/**
 * The announcement of a registered format whose route fell back
 * (F126-FR-006, F126-FR-014): `mode=raw-text`, the route reason of the
 * fallback, signals `text,result`.
 */
export function announceRouteFallback(
  reason: RouteReason,
  context: { role: string; providerFormat: string; format: string },
): CapabilityAnnouncement {
  return {
    mode: "raw-text",
    reason: routeReasonText(reason, context.format),
    providerFormat: context.providerFormat,
    role: context.role,
    signals: RAW_TEXT_SIGNALS,
  };
}

/** The announcement of a reader that failed to start (F126-FR-006, F126-FR-014). */
export function announceFailedStart(
  format: string,
  context: { role: string; providerFormat?: string | null | undefined },
): CapabilityAnnouncement {
  return {
    mode: "degraded",
    reason: routeReasonText("adapter failed to start", format),
    providerFormat: context.providerFormat ?? format,
    role: context.role,
    signals: DEGRADED_SIGNALS,
  };
}

/**
 * The mode after one diagnostic (F126-FR-006): only `unsupported_schema` and
 * `absent_schema` degrade the mode, and only while the mode differs; every
 * other diagnostic — `malformed_json`, for one — changes nothing.
 */
export function modeAfterDiagnostic(
  current: ObservabilityMode,
  code: DiagnosticCode | string,
): ObservabilityMode {
  const shown = diagnosticCodeShown(code);
  if (current !== "degraded" && (shown === "unsupported_schema" || shown === "absent_schema")) {
    return observabilityModeOrDegraded("degraded");
  }
  return current;
}

/** The signals of a mode, as the closed order of row 170 holds them. */
export function signalsOfMode(mode: ObservabilityMode): readonly StreamSignal[] {
  if (mode === "degraded") return DEGRADED_SIGNALS;
  if (mode === "raw-text") return RAW_TEXT_SIGNALS;
  return streamSignals.members;
}
