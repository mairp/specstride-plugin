/**
 * T004 — the closed sets of the stream seam, bound from the data of
 * `@specstride/contracts` (annex X, §X.6, rows 38 and 169 to 177;
 * F126-FR-002, F126-FR-014).
 *
 * The members live ONLY in the contract package: this module imports the ten
 * sets and writes no second list of them. What it adds is the seam's use of
 * each set — the unknown-value rule of the row, applied to the value a
 * reader, the tap or the finalization saw — and the as-is texts of the route
 * reasons, which are the texts of F126-FR-014.
 */
import {
  canonicalToolNames,
  diagnosticCodesOfTheStreamSeam,
  finalizationDecisions,
  invocationStatuses,
  kindsOfNormalizedStreamRecord,
  observabilityModesOfAPass,
  reasonCodesOfAnInvocationResult,
  routeReasonsOfAStream,
  sourcesOfAnInvocationResult,
  streamSignals,
} from "@specstride/contracts/enums/all-sets";
import type { ClosedSet, UnknownValueOutcome } from "@specstride/contracts/enums";

export {
  canonicalToolNames,
  diagnosticCodesOfTheStreamSeam,
  finalizationDecisions,
  invocationStatuses,
  kindsOfNormalizedStreamRecord,
  observabilityModesOfAPass,
  reasonCodesOfAnInvocationResult,
  routeReasonsOfAStream,
  sourcesOfAnInvocationResult,
  streamSignals,
};

/** The kind of a normalized record, or null where the record is dropped. */
export type RecordKind = (typeof kindsOfNormalizedStreamRecord.members)[number];

/** The observability mode of a pass, or the degraded fallback. */
export type ObservabilityMode = (typeof observabilityModesOfAPass.members)[number];

/** A capability signal of a format row. */
export type StreamSignal = (typeof streamSignals.members)[number];

/** A route reason of the seam (row 171). */
export type RouteReason = (typeof routeReasonsOfAStream.members)[number];

/** A diagnostic code of the seam (row 172). */
export type DiagnosticCode = (typeof diagnosticCodesOfTheStreamSeam.members)[number];

/** The status of an invocation result (row 173). */
export type InvocationStatus = (typeof invocationStatuses.members)[number];

/** A reason code of an invocation result (row 174). */
export type ReasonCode = (typeof reasonCodesOfAnInvocationResult.members)[number];

/** The decision a finalization hands the breakers (row 175). */
export type FinalizationDecision = (typeof finalizationDecisions.members)[number];

/** The source of an invocation result (row 177). */
export type ResultSource = (typeof sourcesOfAnInvocationResult.members)[number];

/**
 * A record whose `kind` is outside row 38 is dropped and a
 * `stream.diagnostic` is emitted (F126-FR-002; row 38: the record is dropped
 * with a diagnostic event). Returns null for the drop.
 */
export function recordKindOrDrop(value: string): RecordKind | null {
  if (kindsOfNormalizedStreamRecord.has(value)) return value;
  diagnosticOf("unknown_record_kind", kindsOfNormalizedStreamRecord.onUnknown(value).message);
  return null;
}

/**
 * A mode outside row 169 reads as the degraded fallback (the row's unknown
 * value: `degraded`).
 */
export function observabilityModeOrDegraded(value: string): ObservabilityMode {
  return observabilityModesOfAPass.has(value) ? value : "degraded";
}

/**
 * A capability signal outside row 170 refuses the registration (the row's
 * unknown value). Throws with the rule's message, which names the set and
 * the value.
 */
export function signalOrRefuse(value: string): StreamSignal {
  if (streamSignals.has(value)) return value;
  throw new Error(streamSignals.onUnknown(value).message);
}

/**
 * A tool name outside row 176 passes through unchanged (the row's unknown
 * value): the seam never invents a name and never drops one.
 */
export function toolNameOrPassThrough(value: string): string {
  return canonicalToolNames.has(value) ? value : value;
}

/** True for a tool name inside the canonical vocabulary (row 176). */
export function isCanonicalToolName(value: string): boolean {
  return canonicalToolNames.has(value);
}

/**
 * A status outside row 173 reads as `error` (the row's unknown value).
 */
export function invocationStatusOrDefault(value: string): InvocationStatus {
  return invocationStatuses.has(value) ? value : "error";
}

/**
 * The source of a result (row 177): `synthesized` where the reason code is
 * `missing_terminal`, else `reconciled`; a value outside the row reads as
 * `reconciled` (F126-FR-032; the row's unknown value).
 */
export function sourceOfResult(reasonCode: string): ResultSource {
  return reasonCode === "missing_terminal" ? "synthesized" : "reconciled";
}

/**
 * A reason code outside row 174 is a code the provider reported: the set is
 * open by the provider, and the unknown value is shown as text.
 */
export function reasonCodeShown(value: string): ReasonCode | string {
  return reasonCodesOfAnInvocationResult.has(value) ? value : value;
}

/** The decision outside row 175 reads as `continue` (the row's unknown value). */
export function decisionOrDefault(value: string): FinalizationDecision {
  return finalizationDecisions.has(value) ? value : "continue";
}

/**
 * A diagnostic code outside row 172 is shown as text: the seam still emits
 * the diagnostic, with the code it saw.
 */
export function diagnosticCodeShown(value: string): DiagnosticCode | string {
  return diagnosticCodesOfTheStreamSeam.has(value) ? value : value;
}

/**
 * The one place the diagnostic of the seam is handed onward. The tap (T020)
 * hands it to the event writer; until then it is collected here, so a reader
 * needs no writer to drop a record.
 */
const DIAGNOSTICS: { code: DiagnosticCode | string; message: string }[] = [];

/** Record one seam diagnostic (row 172; F126-FR-002, F126-FR-018). */
export function diagnosticOf(code: DiagnosticCode | string, message: string): void {
  DIAGNOSTICS.push({ code: diagnosticCodeShown(code), message });
}

/** The diagnostics collected so far, oldest first, and drained. */
export function drainDiagnostics(): readonly { code: string; message: string }[] {
  return DIAGNOSTICS.splice(0, DIAGNOSTICS.length);
}

const [STRUCTURED_CAPTURE_DISABLED, NO_REGISTERED_ADAPTER, _ADAPTER_FAILED_TO_START] =
  routeReasonsOfAStream.members;

/**
 * The as-is texts of the route reasons (F126-FR-014). Row 171 closes the
 * reasons; the texts are the specification's. The function form takes the
 * format name the reason names. The branch keys are the contract set's own
 * members — no member string is restated here.
 */
export function routeReasonText(reason: RouteReason, format: string): string {
  if (reason === STRUCTURED_CAPTURE_DISABLED) {
    return "structured capture disabled by SPECSTRIDE_AGENT_STREAM=false — parsing plain output";
  }
  if (reason === NO_REGISTERED_ADAPTER) {
    return `stream format '${format}' has no registered adapter — parsing plain output`;
  }
  // the remaining row-171 member (ADAPTER_FAILED_TO_START): the fallthrough
  return `stream adapter for '${format}' failed to start — parsing plain output`;
}

/** The route reason an as-is text was announced with, or null. */
export function routeReasonOfText(text: string): RouteReason | null {
  for (const reason of routeReasonsOfAStream.members) {
    const head = routeReasonText(reason, "×").split("'")[0];
    if (text === routeReasonText(reason, "×") || text.startsWith(head)) return reason;
  }
  return null;
}

/** The outcome of reading a value against one set, exposed for tests. */
export function unknownOutcomeOf(set: ClosedSet<string>, value: string): UnknownValueOutcome {
  return set.onUnknown(value);
}
