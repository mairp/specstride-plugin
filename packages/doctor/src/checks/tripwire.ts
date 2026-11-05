/**
 * T116 — the doctor checks for the tripwire and for the invariants of the
 * integrity of the phase gate (F115-FR-039, F115-FR-041; EP-14
 * `specstride.doctor/1`).
 *
 * Two checks of the consumer's set-up, registered through the registration
 * call of the kernel (`registerDoctorCheck`, annex G §G.7):
 *
 * - `micro.tripwire-record` — the tripwire record `user:tripwire` of the
 *   machine: `fail` while it is breached (every launch runs with every loop
 *   layer off, reason `tripwire`), `ok` otherwise; `warn` when a file stands
 *   at the record path that cannot be read as a record.
 * - `micro.phase-gate-invariants` — the invariants of F115-FR-039 run over
 *   the event file of the last run: `fail` with the breach kinds found.
 *
 * The checks read and never write, make no paid call and read no secret
 * value (§G.7). They are self-contained: `@specstride/doctor` is L6 and the
 * package graph lets it import `contracts`, `kernel`, `config` and `view`
 * only — not `@specstride/layer-micro` or `@specstride/integrity` — so the
 * record path rule and the breach kinds (the closed set of row 141, read
 * from `@specstride/contracts/data/closed-sets-115.json`) restated here are
 * the same data, not a second owner.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { DoctorCheck, Severity } from "@specstride/contracts/ep/doctor";
import closedSetsData from "@specstride/contracts/data/closed-sets-115.json" with { type: "json" };

/** The ids of the two checks. Stable dotted ids; never renamed. */
export const TRIPWIRE_RECORD_CHECK_ID = "micro.tripwire-record" as const;
export const PHASE_GATE_INVARIANTS_CHECK_ID = "micro.phase-gate-invariants" as const;

/** The path of the tripwire record, by the rule of the tripwire record (F115-FR-041). */
export function doctorTripwireRecordPath(home?: string): string {
  const fromEnv = process.env["SPECSTRIDE_HOME"];
  const base =
    home ?? (fromEnv !== undefined && fromEnv !== "" ? fromEnv : join(homedir(), ".specstride"));
  return join(base, "tripwire.json");
}

/** The closed set of row 141, from the data of feature 115 in contracts. */
export const BREACH_KINDS = (
  closedSetsData.sets.find((s) => s.row === "141")?.members ??
  "approval-without-gate, outer-counter-changed, critic-input-excluded-field, false-pass"
)
  .split(",")
  .map((m) => m.trim());

/** The fields annex D §D.7 lists as never in the fact block. */
const EXCLUDED_FACT_FIELDS = ["note", "output", "stdout", "stderr", "transcript"] as const;

/** One breach found in the event file, as the doctor reports it. */
export type DoctorInvariantBreach = {
  readonly kind: string;
  readonly detail: string;
};

/**
 * The invariant check over an event file, in the doctor's own reader
 * (F115-FR-039). An `integrity.noted` event is a refusal of the runtime and
 * never a breach.
 */
export function doctorCheckInvariants(input: {
  events: readonly { type: string; fields: Readonly<Record<string, unknown>> }[];
  outerCounters?: { atLaunch: Record<string, number>; now: Record<string, number> };
  approval?: {
    nonce: string;
    phase: number;
    attempt: number;
    afterGate: boolean;
    afterPassLoop: boolean;
  };
  criticInputs?: readonly { phase: number; attempt: number; fields: Record<string, unknown> }[];
  passes?: readonly { unitId: string; checkId: string; result: string }[];
}): readonly DoctorInvariantBreach[] {
  const breaches: DoctorInvariantBreach[] = [];
  const of = (type: string) => input.events.filter((e) => e.type === type).map((e) => e.fields);
  const refused = (kind: string) => of("integrity.noted").some((f) => f["kind"] === kind);

  const approval = input.approval;
  if (approval && approval.afterGate && approval.afterPassLoop) {
    if (!of("verdict.recorded").some((f) => f["nonceOk"] === true)) {
      breaches.push({
        kind: "approval-without-gate",
        detail: `approval of phase ${approval.phase} attempt ${approval.attempt} has no critic reply that matches the nonce`,
      });
    }
  }
  const innerRan = of("check.started").length > 0;
  if (innerRan && input.outerCounters) {
    for (const key of Object.keys(input.outerCounters.atLaunch)) {
      const now = input.outerCounters.now[key];
      if (
        now !== undefined &&
        now !== input.outerCounters.atLaunch[key] &&
        !refused("ledger-invalid")
      ) {
        breaches.push({
          kind: "outer-counter-changed",
          detail: `outer counter ${key} changed while inner events ran`,
        });
      }
    }
  }
  for (const row of input.criticInputs ?? []) {
    for (const name of EXCLUDED_FACT_FIELDS) {
      if (name in row.fields) {
        breaches.push({
          kind: "critic-input-excluded-field",
          detail: `critic input of phase ${row.phase} attempt ${row.attempt} holds the excluded field ${name}`,
        });
      }
    }
  }
  const started = new Set(of("check.started").map((f) => String(f["checkId"] ?? "")));
  for (const pass of input.passes ?? []) {
    if (pass.result === "pass" && !started.has(pass.checkId) && !refused("manifest-mismatch")) {
      breaches.push({
        kind: "false-pass",
        detail: `pass of unit ${pass.unitId} recorded for check ${pass.checkId} that never started`,
      });
    }
  }
  return breaches.filter((b) => (BREACH_KINDS as readonly string[]).includes(b.kind));
}

/** Read the tripwire record the way the check sees it. */
export function doctorReadTripwire(
  home?: string,
):
  | { readonly state: "absent" }
  | { readonly state: "breached" }
  | { readonly state: "clear" }
  | { readonly state: "unreadable" } {
  const path = doctorTripwireRecordPath(home);
  if (!existsSync(path)) return { state: "absent" };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return raw["breached"] === true ? { state: "breached" } : { state: "clear" };
  } catch {
    return { state: "unreadable" };
  }
}

/** The `micro.tripwire-record` check (F115-FR-041). */
export const tripwireRecordCheck: DoctorCheck = {
  id: TRIPWIRE_RECORD_CHECK_ID,
  lb: true,
  order: 700,
  messageTemplate: "tripwire record: {state}",
  fixHint: "run `specstride tripwire clear` after the breach is handled",
  severityRule: (observed: unknown): Severity => {
    const state = (observed as { state?: string } | undefined)?.["state"];
    if (state === "breached") return "fail";
    if (state === "unreadable") return "warn";
    return "ok";
  },
  probe: async (injected: Readonly<Record<string, unknown>>) => {
    const home = typeof injected["home"] === "string" ? injected["home"] : undefined;
    return doctorReadTripwire(home);
  },
};

/** The `micro.phase-gate-invariants` check (F115-FR-039). */
export const phaseGateInvariantsCheck: DoctorCheck = {
  id: PHASE_GATE_INVARIANTS_CHECK_ID,
  lb: false,
  order: 701,
  messageTemplate: "phase-gate invariants: {breaches}",
  fixHint: "treat the breach: the tripwire record holds the kind and the rule id",
  severityRule: (observed: unknown): Severity => {
    const breaches = (observed as { breaches?: unknown[] } | undefined)?.["breaches"];
    return Array.isArray(breaches) && breaches.length > 0 ? "fail" : "ok";
  },
  probe: async (injected: Readonly<Record<string, unknown>>) => {
    const events = (injected["events"] ?? []) as readonly {
      type: string;
      fields: Readonly<Record<string, unknown>>;
    }[];
    const breaches = doctorCheckInvariants({
      events,
      outerCounters: injected["outerCounters"] as never,
      approval: injected["approval"] as never,
      criticInputs: injected["criticInputs"] as never,
      passes: injected["passes"] as never,
    });
    return { breaches };
  },
};

/** Register both checks with the kernel registry (idempotent per id). */
export function registerTripwireChecks(register: (check: DoctorCheck) => void): void {
  register(tripwireRecordCheck);
  register(phaseGateInvariantsCheck);
}
