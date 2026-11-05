/**
 * T113 — the report of a breach to the engine (F115-FR-040). On a breach the
 * layer returns `layerOffForRun`; the approval concerned MUST be void and the
 * phase MUST be gated again, and the breach MUST be in the digest.
 *
 * The layer itself MUST NOT void the approval: it reports the breach, and the
 * engine acts through the contract of the approval record. The value below
 * carries the request and states who acts — `voidedBy: "engine"` — so the
 * boundary is in the shape of the data, not only in the prose.
 *
 * The runtime writes the tripwire record on the report (F115-FR-041) behind
 * the port of T003; the event `tripwire.raised` carries the breach kind and
 * the rule id. Purity: imports the layer only; no `node:fs`, no process.
 */
import { BREACH_KINDS, type BreachFinding, type BreachKind } from "./invariants.ts";
import { tripwireRaised, type LayerEvent } from "../report/events.ts";

/** The value `layerOffForRun` carries, with what the engine does on it. */
export type BreachReport = {
  /** The directive of F115-FR-040, verbatim. */
  readonly directive: "layerOffForRun";
  /** The cause in the ledger record `disengaged` (N-111-1). */
  readonly cause: "breach";
  readonly kind: BreachKind;
  readonly ruleId: string;
  readonly detail: string;
  /**
   * The approval concerned is requested void — the layer does not void it:
   * the engine acts through the contract of the approval record.
   */
  readonly approvalVoid: true;
  readonly approvalVoidedBy: "engine";
  /** The phase is gated again: the attempt is replayed under the full gate. */
  readonly phaseGatedAgain: true;
  /** The breach is in the digest, as this row. */
  readonly digestEntry: string;
  /** The tripwire record is requested from the runtime (F115-FR-041). */
  readonly tripwireRequested: true;
  /** No exit code, no stop reason and no run state (IR-07). */
  readonly exitCode: undefined;
  readonly stopReason: undefined;
  readonly runState: undefined;
};

/** Report one breach finding to the engine. */
export function reportBreach(finding: BreachFinding): BreachReport {
  if (!(BREACH_KINDS as readonly string[]).includes(finding.kind)) {
    throw new Error(`not a breach kind of row 141: ${finding.kind}`);
  }
  return Object.freeze({
    directive: "layerOffForRun" as const,
    cause: "breach" as const,
    kind: finding.kind,
    ruleId: finding.ruleId,
    detail: finding.detail,
    approvalVoid: true,
    approvalVoidedBy: "engine" as const,
    phaseGatedAgain: true,
    digestEntry: `breach:${finding.kind}:${finding.ruleId}`,
    tripwireRequested: true,
    exitCode: undefined,
    stopReason: undefined,
    runState: undefined,
  });
}

/** The event the writing of the tripwire record is recorded as (F115-FR-041). */
export function tripwireRaisedEvent(report: BreachReport): LayerEvent {
  return tripwireRaised({ kind: report.kind, ruleId: report.ruleId });
}
