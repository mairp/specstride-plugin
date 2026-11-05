/**
 * T023 (feature 112) — the summary and the run section (F112-FR-029,
 * CT-112-129).
 *
 * The doctor shows the audience in force in the summary and in `--json`. It
 * shows a run section when a run exists: the state of the run, the open
 * alerts, the caps in force, the billing mode, the fallback in force and the
 * critic-diversity warning — read through the read model of the run view
 * (`@specstride/view`: `emptyView` folded event by event with `reduce`,
 * F129-FR-002). The doctor never re-derives a field the read model holds.
 */
import { project } from "@specstride/view";
import type { RunView } from "@specstride/view";
import type { EventEnvelope } from "@specstride/contracts/envelope/event";
import type { Finding, Severity } from "../registry/types.ts";

/** The counts of the summary, per severity, in the closed order. */
export type DoctorSummary = {
  readonly audience: string;
  readonly counts: Readonly<Record<Severity, number>>;
  readonly total: number;
  readonly healthy: boolean;
};

/**
 * The summary: the counts per severity and the audience in force
 * (F112-FR-029, first sentence).
 */
export function doctorSummary(findings: readonly Finding[], audience: string): DoctorSummary {
  const counts: Record<Severity, number> = { ok: 0, info: 0, warn: 0, fail: 0 };
  for (const f of findings) counts[f.severity] += 1;
  const total = findings.length;
  return {
    audience,
    counts,
    total,
    healthy: counts.fail === 0 && counts.warn === 0,
  };
}

/** One run the doctor may read (annex B §B.5): its id, its events, its pick. */
export type DoctorRunRecord = {
  readonly runId: string;
  readonly events: readonly EventEnvelope[];
  /** What the run recorded as picked, when the run holds a pick record. */
  readonly pick?: { readonly criticDiversity?: string };
  /** The run record of the run state file, when the doctor read one. */
  readonly runRecord?: Readonly<Record<string, unknown>> | null;
};

/** The run section the doctor shows (F112-FR-029). */
export type RunSection = {
  readonly runId: string;
  /** The state of the run, as the read model holds it. */
  readonly state: string;
  /** The open alerts, as the kinds the read model raised. */
  readonly alerts: readonly string[];
  /** The caps in force, per role, as the read model holds them. */
  readonly caps: readonly {
    readonly role: string | null;
    readonly cap: number | null;
    readonly costClass: string | null;
    readonly quota: string;
  }[];
  /** The billing mode, as the cost class of the read model's budget rows. */
  readonly billingMode: string | null;
  /** The fallback in force, as the read model's fallback reason. */
  readonly fallback: string | null;
  /** The critic-diversity warning, when the run's pick carries one. */
  readonly criticDiversity: string | null;
};

/** Fold the events of one run through the read model (F129-FR-002). */
export function runViewOfEvents(
  events: readonly EventEnvelope[],
  runRecord?: Readonly<Record<string, unknown>> | null,
): RunView {
  return project({
    events: { events: [...events] },
    stateFiles: {
      runRecord: runRecord ?? null,
      terminalRecord: null,
      pauseRecord: null,
    },
    observations: {
      lease: null,
      newestLaunchRecord: null,
      supervisionRecord: null,
      processTableSearch: null,
      handshakeLimitSec: null,
    },
    now: new Date(0).toISOString(),
  });
}

/**
 * The run section of the newest run that holds events, or `null` when no run
 * exists (F112-FR-029: "when a run exists"). Every field is read out of the
 * folded view — never recomputed by the doctor.
 */
export function runSection(runs: readonly DoctorRunRecord[]): RunSection | null {
  const withEvents = [...runs].reverse().find((r) => r.events.length > 0);
  if (withEvents === undefined) return null;
  const view = runViewOfEvents(withEvents.events, withEvents.runRecord ?? null);
  const caps = view.budget.map((row) => ({
    role: row.role,
    cap: row.cap,
    costClass: row.costClass,
    quota: row.quota,
  }));
  const billingMode = view.budget.map((row) => row.costClass).find((c) => c !== null) ?? null;
  const diversity = withEvents.pick?.criticDiversity;
  return {
    runId: withEvents.runId,
    state: view.state,
    alerts: view.attention.map((a) => a.kind),
    caps,
    billingMode,
    fallback: view.parallel?.fallbackReason ?? null,
    criticDiversity: diversity ?? null,
  };
}
