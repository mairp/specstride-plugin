/**
 * T037 (feature 112) — `events.gateIntegrity` (F112-FR-032, CT-112-132;
 * catalogue row 45, research D-6).
 *
 * The check tests the FIVE invariants of the integrity of the phase gate on
 * the event log of a run, and is `fail` when one does not hold:
 *   (1) every approval follows a verdict of the critic with the matching
 *       nonce, made after the proposer loop ended and after the verification
 *       gate ran in the same phase attempt;
 *   (2) no inner event changed a counter that limits a run (reject count,
 *       ordinal of the phase attempt, MALFORMED streak, oscillation input,
 *       diagnostician signature, verdict pins, learning observations);
 *   (3) no critic-class input held a field that the fact block excludes;
 *   (4) no check is recorded as `pass` that did not run, ran tainted, or
 *       whose fingerprints differed before and after;
 *   (5) `seq` has no gap, and every event that opens something has a closing
 *       event or a synthesized one.
 *
 * When the log holds NONE of the events an invariant needs, that invariant is
 * `info`. A detected and refused attempt (an `integrity.noted` event naming
 * the kind) is NOT a breach.
 *
 * The check reads the event log through the probe bag; it writes nothing.
 */

/** An event of a run's log, as the doctor reads it. */
export type GateEvent = {
  readonly seq: number;
  readonly type: string;
  readonly data?: Readonly<Record<string, unknown>>;
};

/** A breach of one invariant, as the finding reports it. */
export type GateBreach = {
  readonly invariant: number;
  readonly kind: string;
  readonly detail: string;
};

/** The counters an inner event must never change (invariant 2). */
export const LIMITED_COUNTERS: readonly string[] = Object.freeze([
  "rejectCount",
  "phaseAttemptOrdinal",
  "malformedStreak",
  "oscillationInput",
  "diagnosticianSignature",
  "verdictPins",
  "learningObservations",
]);

/** The fields the fact block excludes from a critic-class input (invariant 3). */
export const EXCLUDED_FACT_FIELDS: readonly string[] = Object.freeze([
  "note",
  "output",
  "stdout",
  "stderr",
  "transcript",
]);

/** The opener/closer pairs invariant 5 checks. */
export const OPEN_CLOSE: Readonly<Record<string, string>> = Object.freeze({
  "run.started": "run.ended",
  "run.launched": "run.ended",
  "phase.started": "phase.ended",
  "attempt.started": "attempt.ended",
  "pass.started": "pass.ended",
  "verification.started": "verification.ended",
  "check.started": "check.ended",
  "job.started": "job.ended",
  "yield.started": "yield.ended",
});

const data = (e: GateEvent): Readonly<Record<string, unknown>> => e.data ?? {};

/** The kinds a log notes as detected and refused: never a breach (F112-FR-032). */
function refusedKinds(events: readonly GateEvent[]): ReadonlySet<string> {
  const refused = new Set<string>();
  for (const e of events) {
    // The refusal event is `integrity.noted`, which names the refused kind
    // (F116-FR-022); no other type marks a breach as refused.
    if (e.type === "integrity.noted") {
      const kind = data(e)["kind"];
      if (typeof kind === "string") refused.add(kind);
    }
  }
  return refused;
}

/**
 * The five invariants over one event log. `present` records, per invariant,
 * whether the log holds any of the events the invariant needs — an invariant
 * whose events are absent reads as `info`, never `fail`.
 */
export function gateIntegrityBreaches(events: readonly GateEvent[]): {
  breaches: readonly GateBreach[];
  present: readonly boolean[];
} {
  const refused = refusedKinds(events);
  const breaches: GateBreach[] = [];
  // Invariant 1 — approval after a matching critic verdict, after the proposer
  // loop ended, after the verification gate in the same phase attempt.
  let inv1Present = false;
  const verdicts = events.filter((e) => e.type === "verdict.recorded");
  for (const e of events) {
    if (e.type !== "approval.recorded") continue;
    inv1Present = true;
    const nonce = data(e)["nonce"];
    const attempt = data(e)["attempt"];
    const idx = events.indexOf(e);
    const verdict = verdicts.find((v) => events.indexOf(v) < idx && data(v)["nonce"] === nonce);
    const loopEnded = events
      .slice(0, idx)
      .some((p) => p.type === "pass.ended" && data(p)["attempt"] === attempt);
    const gate = events
      .slice(0, idx)
      .some(
        (g) =>
          (g.type === "verification.ended" || g.type === "gate.result") &&
          data(g)["attempt"] === attempt &&
          data(g)["result"] === "pass",
      );
    if (!verdict || !loopEnded || !gate) {
      const kind = "approval-without-verdict";
      if (!refused.has(kind)) {
        breaches.push({
          invariant: 1,
          kind,
          detail: `approval at seq ${String(e.seq)} has no matching critic verdict after the gate`,
        });
      }
    }
  }
  // Invariant 2 — an inner event that changes a limited counter.
  let inv2Present = false;
  for (const e of events) {
    const inner = e.type.startsWith("inner.") || data(e)["workerId"] !== undefined;
    if (!inner) continue;
    inv2Present = true;
    for (const counter of LIMITED_COUNTERS) {
      if (data(e)[counter] !== undefined) {
        const kind = "inner-counter-changed";
        if (!refused.has(kind)) {
          breaches.push({
            invariant: 2,
            kind,
            detail: `inner event ${e.type} at seq ${String(e.seq)} carries ${counter}`,
          });
        }
      }
    }
  }
  // Invariant 3 — a critic-class input holding an excluded field.
  let inv3Present = false;
  for (const e of events) {
    if (!e.type.startsWith("critic.")) continue;
    inv3Present = true;
    for (const field of EXCLUDED_FACT_FIELDS) {
      if (data(e)[field] !== undefined) {
        const kind = "critic-input-excluded-field";
        if (!refused.has(kind)) {
          breaches.push({
            invariant: 3,
            kind,
            detail: `critic input at seq ${String(e.seq)} holds the excluded field ${field}`,
          });
        }
      }
    }
  }
  // Invariant 4 — a pass recorded for a check that did not run, ran tainted,
  // or whose fingerprints differed before and after.
  let inv4Present = false;
  const started = new Map<string, GateEvent>();
  for (const e of events) {
    if (e.type === "check.started") {
      inv4Present = true;
      started.set(String(data(e)["checkId"] ?? ""), e);
    }
    if (e.type === "check.passed" || e.type === "check.ended") {
      inv4Present = true;
      if (data(e)["result"] !== undefined && data(e)["result"] !== "pass") continue;
      const id = String(data(e)["checkId"] ?? "");
      const open = started.get(id);
      const kind = "false-pass";
      if (open === undefined) {
        if (!refused.has(kind)) {
          breaches.push({
            invariant: 4,
            kind,
            detail: `check ${id} recorded as pass at seq ${String(e.seq)} never started`,
          });
        }
      } else if (data(open)["tainted"] === true) {
        if (!refused.has(kind)) {
          breaches.push({
            invariant: 4,
            kind,
            detail: `check ${id} ran tainted and still reads as pass`,
          });
        }
      } else if (
        data(open)["fingerprint"] !== undefined &&
        data(e)["fingerprint"] !== undefined &&
        data(open)["fingerprint"] !== data(e)["fingerprint"]
      ) {
        if (!refused.has(kind)) {
          breaches.push({
            invariant: 4,
            kind,
            detail: `check ${id} fingerprints differ before and after`,
          });
        }
      }
    }
  }
  // Invariant 5 — no gap in `seq`; every opener has a closer or a synthesized one.
  let inv5Present = false;
  let previous: number | null = null;
  for (const e of events) {
    // Invariant 5 needs an opener or a closer: a log without either lacks it.
    if (OPEN_CLOSE[e.type] !== undefined || e.type === "run.ended" || e.type === "run.started") {
      inv5Present = true;
    }
    if (previous !== null && e.seq !== previous + 1) {
      const kind = "seq-gap";
      if (!refused.has(kind)) {
        breaches.push({
          invariant: 5,
          kind,
          detail: `seq jumps from ${String(previous)} to ${String(e.seq)}`,
        });
      }
    }
    previous = e.seq;
  }
  const open: string[] = [];
  for (const e of events) {
    const closer = OPEN_CLOSE[e.type];
    if (closer !== undefined) open.push(closer);
    if (open.includes(e.type)) {
      open.splice(open.indexOf(e.type), 1);
    } else if (e.type === "run.ended") {
      open.length = 0; // the run ended: everything is closed or synthesized
    }
  }
  for (const unclosed of open) {
    const kind = "unclosed";
    if (!refused.has(kind)) {
      breaches.push({
        invariant: 5,
        kind,
        detail: `no ${unclosed} closed the event that opened it`,
      });
    }
  }
  return { breaches, present: [inv1Present, inv2Present, inv3Present, inv4Present, inv5Present] };
}

/** The `events.gateIntegrity` check of the core catalogue (row 45). */
export const gateIntegrityCheck = {
  id: "events.gateIntegrity",
  group: "events" as const,
  lb: false,
  order: 45,
  messageTemplate: "invariant broken: {kinds}",
  fixHint: "see the run's integrity event; clear the tripwire only after the cause is found",
  severityRule: (o: unknown): "fail" | "info" | "ok" => {
    const s = o as { breaches: readonly GateBreach[]; anyPresent: boolean };
    if (s.breaches.length > 0) return "fail";
    // A log that holds none of the events an invariant needs is `info`.
    return s.anyPresent ? "ok" : "info";
  },
  probe: async (bag: Readonly<Record<string, unknown>>) => {
    const events = (bag["events"] ?? []) as readonly GateEvent[];
    const { breaches, present } = gateIntegrityBreaches(events);
    return {
      breaches,
      present,
      anyPresent: present.some(Boolean),
      kinds: breaches.map((b) => b.kind).join(", "),
    };
  },
} as const;
