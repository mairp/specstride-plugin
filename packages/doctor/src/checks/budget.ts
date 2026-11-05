/**
 * T031 (feature 112) — the checks of the groups `quota` and `budget`
 * (F112-FR-017, CT-112-117; catalogue rows 27 to 29).
 *
 * `quota.state.<role>` shows the last observed quota or pause state from the
 * records of the run, WITHOUT a probe: a warning near a threshold or in a
 * pause, a failure when the run is blocked on credit. `quota.shared` says when
 * a detached run and the host session share one auth tier 1 window.
 * `budget.caps` shows the caps in force per role and per run and the billing
 * mode, warns when an API key has no cap, and fails when an automatically
 * picked critic on a metered endpoint has no hard cap. Where a harness's spend
 * cannot be measured, the finding says so.
 */
import type { Check, ProbeBag } from "../registry/types.ts";
import { cfg } from "./read.ts";

/** The quota states a role's record may hold (feature 127 owns the set). */
export type QuotaObservation = {
  readonly role: string;
  readonly state: "ok" | "near-threshold" | "paused" | "blocked-on-credit";
  readonly until?: string;
};

/** One cap in force, as the billing records hold it. */
export type CapRow = {
  readonly role: string;
  readonly cap: number | null;
  readonly costClass: "metered" | "subscription" | null;
  readonly spendMeasurable: boolean;
};

/** `quota.state.<role>` — the last observed quota state, no probe (row 27). */
export function quotaStateCheck(role: string): Check {
  return {
    id: `quota.state.${role}`,
    group: "quota",
    lb: false,
    order: 27,
    messageTemplate: "{role} {state}{until}",
    fixHint: "wait, or configure a fallback",
    severityRule: (o: unknown) => {
      const s = o as { state: QuotaObservation["state"] };
      if (s.state === "blocked-on-credit") return "fail";
      if (s.state === "near-threshold" || s.state === "paused") return "warn";
      return "ok";
    },
    probe: async (bag) => {
      const b = bag as unknown as ProbeBag;
      const states = cfg<readonly QuotaObservation[]>(b, "quota.states", []);
      const found = states.find((s) => s.role === role);
      return {
        role,
        state: found?.state ?? "ok",
        ...(found?.until !== undefined ? { until: ` until ${found.until}` } : { until: "" }),
      };
    },
  };
}

/**
 * `budget.caps` — the caps in force, the billing mode, and the two cap rules
 * (row 28, lb only for an automatically picked metered critic).
 */
export const budgetCapsCheck: Check = {
  id: "budget.caps",
  group: "budget",
  // The launch-blocking flag applies only for an automatically picked metered
  // critic; the static check carries it and the launch evaluation narrows it
  // (F112-FR-030, the conditional tenth).
  lb: true,
  order: 28,
  messageTemplate: "{caps} spend of one harness not measurable",
  fixHint: "set the cap of the critic",
  severityRule: (o: unknown) => {
    const s = o as {
      apiKeyWithoutCap: boolean;
      autopickMeteredCriticWithoutCap: boolean;
    };
    if (s.autopickMeteredCriticWithoutCap) return "fail";
    if (s.apiKeyWithoutCap) return "warn";
    return "info";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const rows = cfg<readonly CapRow[]>(b, "budget.caps.roles", []);
    const autopick = cfg<{ picked: boolean; metered: boolean; cap: number | null }>(
      b,
      "budget.caps.autopickCritic",
      { picked: false, metered: false, cap: null },
    );
    const apiKeyWithoutCap = rows.some((r) => r.costClass === null && r.cap === null);
    const autopickMeteredCriticWithoutCap =
      autopick.picked && autopick.metered && autopick.cap === null;
    const unmeasurable = rows.filter((r) => !r.spendMeasurable).map((r) => r.role);
    return {
      rows,
      caps:
        rows.length > 0
          ? rows.map((r) => `run cap ${r.cap === null ? "none" : String(r.cap)}`).join(", ")
          : "no cap in force",
      apiKeyWithoutCap,
      autopickMeteredCriticWithoutCap,
      unmeasurable,
      // Where a harness's spend cannot be measured, the finding says so.
      notMeasurable: unmeasurable.length > 0,
    };
  },
};

/** `quota.shared` — one auth tier 1 window, detached run and host (row 29). */
export const quotaSharedCheck: Check = {
  id: "quota.shared",
  group: "quota",
  lb: false,
  order: 29,
  messageTemplate: "detached run and this session share the window",
  fixHint: "none",
  severityRule: (o: unknown) => ((o as { shared: boolean }).shared ? "info" : "ok"),
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const shared = cfg<boolean>(b, "quota.shared", false);
    return { shared, window: "auth tier 1" };
  },
};

/** The three checks of the groups `quota` and `budget`, in catalogue order. */
export const budgetChecks: readonly Check[] = Object.freeze([
  quotaStateCheck("proposer"),
  budgetCapsCheck,
  quotaSharedCheck,
]);
