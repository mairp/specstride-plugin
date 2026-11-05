/**
 * T041 (feature 112) — the checks of the group `critic` (F112-FR-015,
 * F112-FR-031, CT-112-115, CT-112-131; catalogue rows 21 to 23).
 *
 * `critic.diversity` shows the critic-diversity warning of F100-FR-024 and
 * states no trigger of its own: it reads the result of the diversity test
 * (row 183 of annex X §X.6) and the field `criticPick` of the resolved
 * registry. It warns for `same-model` and `unverified`, informs for
 * `same-provider` and is `ok` for `diverse`; a shared model tier gives no
 * finding of its own; a result the doctor does not know reads as `unverified`.
 * The check is never `fail` and never launch-blocking (F112-FR-031).
 *
 * `critic.independence` warns when the critic can call tools and fails when a
 * critic path carries a flag that allows all tools (launch-blocking).
 * `critic.autopick` shows the pick that would be made and why each other
 * candidate lost, by reading the resolved role plan.
 */
import type { Check, ProbeBag, Severity } from "../registry/types.ts";
import { cfg } from "./read.ts";

/**
 * The results of the diversity test the doctor knows (row 183 of annex X
 * §X.6, read, not owned). Any other result reads as `unverified`.
 */
export type DiversityResult = "diverse" | "same-provider" | "same-model" | "unverified";

/**
 * Normalize a result of the diversity test: a result the doctor does not know
 * reads as `unverified`, with the warning (F112-FR-015).
 */
export function normalizeDiversityResult(result: string | undefined): DiversityResult {
  if (result === "diverse" || result === "same-provider" || result === "same-model") return result;
  return "unverified";
}

/** The severity `critic.diversity` returns for a diversity result (FR-015). */
export function severityOfDiversity(result: DiversityResult): "ok" | "info" | "warn" {
  if (result === "diverse") return "ok";
  if (result === "same-provider") return "info";
  return "warn"; // same-model and unverified
}

/** `critic.diversity` — the critic-diversity warning (row 21, never lb). */
export const criticDiversityCheck: Check = {
  id: "critic.diversity",
  group: "critic",
  // F112-FR-031: the check MUST NOT have the flag `lb` and MUST never fail.
  lb: false,
  order: 21,
  messageTemplate: "critic = {pick} (critic-diversity warning: {why})",
  fixHint: "configure a second harness, or accept",
  severityRule: (o: unknown) => {
    const s = o as { severity: "ok" | "info" | "warn" };
    return s.severity;
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const raw = cfg<string>(b, "critic.diversity.result", "");
    const sharedTier = cfg<boolean>(b, "critic.diversity.sharedTier", false);
    const pick = cfg<string>(b, "critic.pick", "proposer model");
    // A shared model tier gives no finding of its own: two different models of
    // one model tier are `diverse`, unless the diversity test itself read a
    // result (then that result stands).
    const result = raw === "" && sharedTier ? "diverse" : normalizeDiversityResult(raw);
    const why = result === "diverse" ? "none" : result;
    return {
      result,
      why,
      pick,
      severity: severityOfDiversity(result),
      sharedTier,
    };
  },
};

/** `critic.independence` — can the critic call tools (row 22, lb). */
export const criticIndependenceCheck: Check = {
  id: "critic.independence",
  group: "critic",
  lb: true,
  order: 22,
  messageTemplate: "critic can call tools{form}",
  fixHint: "use a tool-less critic",
  severityRule: (o: unknown): Severity => {
    const s = o as { severity: Severity };
    return s.severity;
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const critic = cfg<{ canCallTools?: boolean; allowsAllTools?: boolean; form?: string }>(
      b,
      "critic.independence",
      {},
    );
    const allowsAllTools = critic.allowsAllTools === true;
    const canCallTools = allowsAllTools || critic.canCallTools === true;
    return {
      canCallTools,
      allowsAllTools,
      form: allowsAllTools ? " (a flag allows all tools)" : "",
      // F112-FR-015: warn when the critic can call tools, fail when a critic
      // path carries a flag that allows all tools.
      severity: allowsAllTools ? "fail" : canCallTools ? "warn" : "ok",
    };
  },
};

/** One candidate the automatic pick considered, and why it lost. */
export type AutopickCandidate = {
  readonly id: string;
  readonly why: string;
};

/** `critic.autopick` — the pick that would be made (row 23, info). */
export const criticAutopickCheck: Check = {
  id: "critic.autopick",
  group: "critic",
  lb: false,
  order: 23,
  messageTemplate: "would pick: {pick}{lost}",
  fixHint: "set or disable automatic pick",
  severityRule: (_o: unknown) => "info" as const,
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const plan = cfg<{
      pick?: string;
      candidates?: readonly AutopickCandidate[];
    }>(b, "critic.autopick", {});
    const candidates = plan.candidates ?? [];
    // Why each other candidate lost, from the resolved role plan.
    const lost = candidates.map((c) => `${c.id} (${c.why})`).join(", ");
    return {
      pick: plan.pick ?? "none",
      candidates,
      lost,
      lostSuffix: lost === "" ? "" : `; lost: ${lost}`,
    };
  },
};

/** The three checks of the group `critic`, in catalogue order. */
export const criticChecks: readonly Check[] = Object.freeze([
  criticDiversityCheck,
  criticIndependenceCheck,
  criticAutopickCheck,
]);
