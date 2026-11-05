/**
 * T030 — the qualification of a critic candidate (F124-FR-038, F124-FR-039,
 * F124-FR-042).
 *
 * Qualification is DATA: the conditions Q1 to Q10, their rule ids and the
 * reason each failure carries come from `packages/harness/data/
 * qualification.json` (a copy of the contract `qualification.json` of the
 * spec, made by T003). This module reads that file, checks at load that it
 * holds exactly Q1 to Q10 in order with reasons of the closed set 182, and
 * binds every rule id to its predicate over a vector of signals. The first
 * condition that fails is recorded, with the reason its position in the
 * condition names (F124-FR-038).
 *
 * Pure: no I/O after the load, no clock, no model. An unknown rule id in the
 * data refuses at load, never at run time.
 */
import { readFileSync } from "node:fs";
import type { CriticCandidate } from "./types.ts";
import { reasonsWhyACriticCandidateDoesNotQualifyOrIsPassedOver } from "@specstride/contracts/enums/all-sets";

/** The file the conditions are read from (T003). */
const TABLE_URL = new URL("../../data/qualification.json", import.meta.url);

type QualificationTable = {
  readonly schema: string;
  readonly id: string;
  readonly version: string;
  readonly conditions: readonly {
    readonly ruleId: string;
    readonly reasons: readonly string[];
  }[];
};

function loadQualificationTable(): QualificationTable {
  const table = JSON.parse(readFileSync(TABLE_URL, "utf8")) as QualificationTable;
  if (table.schema !== "specstride.table/1") {
    throw new Error(`qualification table ${table.id}: not a specstride.table/1`);
  }
  const expected = table.conditions.map((condition) => condition.ruleId);
  const wanted = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10"];
  if (expected.join(",") !== wanted.join(",")) {
    throw new Error(
      `qualification table ${table.id} (version ${table.version}): the conditions are not ` +
        `Q1 to Q10 in order (found: ${expected.join(", ")})`,
    );
  }
  for (const condition of table.conditions) {
    if (condition.reasons.length === 0) {
      throw new Error(`qualification table: the condition ${condition.ruleId} has no reason`);
    }
    for (const reason of condition.reasons) {
      if (!reasonsWhyACriticCandidateDoesNotQualifyOrIsPassedOver.has(reason)) {
        throw new Error(
          `qualification table: the condition ${condition.ruleId} carries the reason ` +
            `"${reason}", which is not a member of the closed set 182`,
        );
      }
    }
  }
  return table;
}

export const QUALIFICATION_TABLE: QualificationTable = loadQualificationTable();

/** The id and the version the record of a qualification cites. */
export const QUALIFICATION_TABLE_ID = QUALIFICATION_TABLE.id;
export const QUALIFICATION_TABLE_VERSION = QUALIFICATION_TABLE.version;
/** The rule ids, in the order of the data. */
export const QUALIFICATION_RULE_IDS = QUALIFICATION_TABLE.conditions.map(
  (condition) => condition.ruleId,
);

/** The smallest context window a critic may qualify with (condition Q4). */
export const MIN_CRITIC_WINDOW_TOKENS = 32000 as const;

/**
 * The vector of signals the conditions read. Everything the conditions need
 * is handed in; nothing is probed here. The provider id of a candidate comes
 * from the HOST of its endpoint, never from a label of its descriptor
 * (F124-FR-047).
 */
export type QualificationSignal = {
  readonly candidate: CriticCandidate;
  /** Condition Q1 — the harness supports the critic role. */
  readonly supportsCriticRole: boolean;
  /** Condition Q2 — a tested harness adapter exists for the form. */
  readonly testedAdapter: boolean;
  /** Condition Q5 — the model id the harness sends, or null when unknown. */
  readonly modelId: string | null;
  /** Condition Q5 — the provider identity, from the endpoint host. */
  readonly providerId: string | null;
  /** Condition Q5 — the proposer's model id, or null when unknown. */
  readonly proposerModel: string | null;
  /** Condition Q5 — the proposer's provider identity. */
  readonly proposerProvider: string | null;
  /** Condition Q6 — the credential of the harness is present. */
  readonly credentialPresent: boolean;
  /** Condition Q6 — the free preflight gave no auth failure. */
  readonly preflightAuthOk: boolean;
  /** Condition Q8 — the harness is known to be out of quota at launch. */
  readonly quotaExhausted: boolean;
  /** Condition Q9 — a budget is in force for the run. */
  readonly budgetInForce: boolean;
  /** Condition Q9 — the hard cap for an automatic pick, in USD, or null. */
  readonly capUsd: number | null;
  /** Condition Q10 — the read denial of the withheld paths is confirmed. */
  readonly readDenialConfirmed: boolean;
  /** Condition Q4 — the smallest window a critic may have. */
  readonly minWindowTokens?: number;
};

/** The result for one candidate: qualifies, or the first condition that failed. */
export type QualificationOutcome = {
  readonly harness: string;
  readonly qualifies: boolean;
  /** The rule id of the first condition that failed, or null. */
  readonly ruleId: string | null;
  /** The reason of that condition, or null. */
  readonly reason: string | null;
};

/**
 * The diversity result the rule of F124-FR-047 gives for a candidate against
 * the proposer: decided on the provider identity and the model id that is
 * sent, never on the wire format. A model id that is not known gives
 * `unverified`. Exported for the critic order, which records it.
 */
export function diversityOf(
  signal: Pick<
    QualificationSignal,
    "modelId" | "providerId" | "proposerModel" | "proposerProvider"
  >,
): "diverse" | "same-provider" | "same-model" | "unverified" {
  if (signal.modelId === null || signal.proposerModel === null) return "unverified";
  if (signal.modelId === signal.proposerModel) return "same-model";
  if (
    signal.providerId !== null &&
    signal.proposerProvider !== null &&
    signal.providerId === signal.proposerProvider
  ) {
    return "same-provider";
  }
  return "diverse";
}

/** The states of a harness that count as verified for F124-FR-039. */
export const VERIFIED_STATES = ["tested", "locally-verified"] as const;

function isVerified(state: string): boolean {
  return (VERIFIED_STATES as readonly string[]).includes(state);
}

/**
 * Whether harness-native memory is on. The field `memory` of annex C §C.6
 * carries the boolean directly with its provenance; the `Valued` form of
 * the types carries it behind `value`. Both are read.
 */
function nativeMemoryOn(memory: CriticCandidate["memory"]): boolean {
  const value = memory as { value?: { native: boolean }; native?: boolean };
  return value.value ? value.value.native === true : value.native === true;
}

/**
 * The predicate of each condition, bound to its rule id. Each predicate
 * returns the reason of the failure, chosen among the reasons the data
 * gives for that condition, or null when the condition holds.
 */
const PREDICATES: Record<string, (signal: QualificationSignal) => string | null> = {
  // Q1 — the harness supports the critic role.
  Q1: (signal) =>
    signal.supportsCriticRole ? null : QUALIFICATION_TABLE.conditions[0]!.reasons[0]!,
  // Q2 — the form is tool-less by construction, or the harness has a tested
  // harness adapter; an unverified harness of kind cli never qualifies
  // (F124-FR-039), while an unverified endpoint may.
  Q2: (signal) => {
    const reasons = QUALIFICATION_TABLE.conditions[1]!.reasons;
    const { candidate } = signal;
    if (candidate.completionForm.value === "tool-less") {
      return isVerified(candidate.state) || candidate.kind !== "cli"
        ? null
        : reasons.includes("unverified-cli")
          ? "unverified-cli"
          : reasons[0]!;
    }
    // The form read-only-tools needs a tested harness adapter, also on a
    // subscription (F124-FR-039).
    return signal.testedAdapter && isVerified(candidate.state)
      ? null
      : reasons.includes("unverified-cli") &&
          !isVerified(candidate.state) &&
          candidate.kind === "cli"
        ? "unverified-cli"
        : reasons[0]!;
  },
  // Q3 — harness-native memory is off or absent.
  Q3: (signal) =>
    nativeMemoryOn(signal.candidate.memory) ? QUALIFICATION_TABLE.conditions[2]!.reasons[0]! : null,
  // Q4 — the context window is known and large enough.
  Q4: (signal) => {
    const reasons = QUALIFICATION_TABLE.conditions[3]!.reasons;
    const window = signal.candidate.contextWindow;
    if (window === null) return reasons.includes("window-unknown") ? "window-unknown" : reasons[0]!;
    const min = signal.minWindowTokens ?? MIN_CRITIC_WINDOW_TOKENS;
    return window.tokens < min
      ? reasons.includes("window-too-small")
        ? "window-too-small"
        : reasons[0]!
      : null;
  },
  // Q5 — the provider or the model differs from the proposer's (the result
  // `same-model` of the diversity test; `same-provider` and `diverse` hold).
  Q5: (signal) => {
    const reasons = QUALIFICATION_TABLE.conditions[4]!.reasons;
    return diversityOf(signal) === "same-model"
      ? reasons.includes("not-diverse")
        ? "not-diverse"
        : reasons[0]!
      : null;
  },
  // Q6 — the credential is present and the free preflight gave no auth failure.
  Q6: (signal) => {
    const reasons = QUALIFICATION_TABLE.conditions[5]!.reasons;
    if (!signal.credentialPresent) {
      return reasons.includes("credential-absent") ? "credential-absent" : reasons[0]!;
    }
    return signal.preflightAuthOk
      ? null
      : reasons.includes("preflight-failed")
        ? "preflight-failed"
        : reasons[0]!;
  },
  // Q7 — the terms gate allows the provider on a row.
  Q7: (signal) => {
    const reasons = QUALIFICATION_TABLE.conditions[6]!.reasons;
    const decision = signal.candidate.terms.decision;
    if (decision === "refused") {
      return reasons.includes("terms-refused") ? "terms-refused" : reasons[0]!;
    }
    return decision === "unknown"
      ? reasons.includes("terms-unknown")
        ? "terms-unknown"
        : reasons[0]!
      : null;
  },
  // Q8 — not known to be out of quota at launch.
  Q8: (signal) => (signal.quotaExhausted ? QUALIFICATION_TABLE.conditions[7]!.reasons[0]! : null),
  // Q9 — a budget is in force; for the cost class metered the hard cap is
  // set (F124-FR-042).
  Q9: (signal) => {
    const reasons = QUALIFICATION_TABLE.conditions[8]!.reasons;
    if (!signal.budgetInForce) {
      return reasons.includes("no-budget") ? "no-budget" : reasons[0]!;
    }
    const metered = signal.candidate.costClass.value === "metered";
    return metered && signal.capUsd === null
      ? reasons.includes("no-spend-cap")
        ? "no-spend-cap"
        : reasons[0]!
      : null;
  },
  // Q10 — for the form read-only-tools the read denial of the withheld paths
  // is confirmed.
  Q10: (signal) => {
    const reasons = QUALIFICATION_TABLE.conditions[9]!.reasons;
    return signal.candidate.completionForm.value === "read-only-tools" &&
      !signal.readDenialConfirmed
      ? reasons.includes("read-denial-unconfirmed")
        ? "read-denial-unconfirmed"
        : reasons[0]!
      : null;
  },
};

/** Evaluate the conditions of the data, in order, for one candidate. */
export function qualifies(signal: QualificationSignal): QualificationOutcome {
  for (const condition of QUALIFICATION_TABLE.conditions) {
    const predicate = PREDICATES[condition.ruleId];
    if (predicate === undefined) {
      throw new Error(`no predicate is bound to the condition ${condition.ruleId}`);
    }
    const reason = predicate(signal);
    if (reason !== null) {
      return { harness: signal.candidate.id, qualifies: false, ruleId: condition.ruleId, reason };
    }
  }
  return { harness: signal.candidate.id, qualifies: true, ruleId: null, reason: null };
}

/** Evaluate the conditions for every candidate, in the order given. */
export function qualifyAll(
  signals: readonly QualificationSignal[],
): readonly QualificationOutcome[] {
  return signals.map((signal) => qualifies(signal));
}
