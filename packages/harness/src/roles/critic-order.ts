/**
 * T032 — the critic order (F124-FR-037, F124-FR-041, F124-FR-044,
 * F124-FR-048).
 *
 * Four steps, in order (feature 100, annex C §C.6): the critic the consumer
 * configured; a second model through the gateway of the host; a qualifying
 * discovered harness, ranked by the ranking table; the default harness on a
 * different model tier, in a fresh session, without tools, with a set
 * budget. Discovery and the automatic pick never override a configured
 * critic (step 1 wins). The automatic pick is made once per launch and
 * holds for every phase for which the consumer configured no critic: this
 * module is a pure function of its input, and its plan entries (the ranked
 * runners-up and step 4 after them, decision D-7) are applied to every such
 * phase by the resolver.
 *
 * Where step 4 finds no other model tier, the default harness is the critic
 * on the same model, with the critic-diversity warning (F124-FR-045). Where
 * no harness can play the critic at all, the launch is refused and the
 * refusal names every candidate with the reason it failed (F124-FR-035).
 *
 * The pass-over rule of F124-FR-041 and the proof of the first call of
 * F124-FR-048 are exported as pure predicates the engine applies at call
 * time; the record of a pass-over and its announcement come from
 * `./announce.ts`.
 */
import type {
  CriticCandidate,
  CriticPick,
  CriticRunnerUp,
  RolePlanEntry,
  StepOfTheCriticOrder,
} from "./types.ts";
import { qualifies, type QualificationSignal } from "./qualify.ts";
import { checkCriticDiversity } from "./diversity.ts";
import {
  compareCandidates,
  decidingRuleId,
  rankCandidates,
  RANKING_TABLE_ID,
  RANKING_TABLE_VERSION,
  type RankingSignal,
} from "./rank.ts";
import { announcementLine, criticSelectedEvent, diversityLine, launchLines } from "./announce.ts";

/** The switch of F124-FR-044, row 35 of annex X §X.7: on by default. */
export const AUTO_PICK_DEFAULT = true as const;
/** The row-35 key (config-keys.json). */
export const AUTO_PICK_KEY = "critic.autoPick" as const;
/** The row-91 key: the hard cap of an automatic pick, in USD. */
export const AUTO_PICK_MAX_USD_KEY = "critic.autoPickMaxUsd" as const;

/** One candidate of the critic order: a registry entry plus what step 3 needs. */
export type CriticOrderCandidate = CriticCandidate & {
  /** The model id the harness sends, or null when it is not known (F124-FR-047). */
  readonly modelId: string | null;
  /** The provider identity, from the host of the endpoint (F124-FR-047). */
  readonly providerId: string | null;
  /** A tested harness adapter exists for the form (F124-FR-039). */
  readonly testedAdapter: boolean;
  /** The credential of the harness is present (Q6). */
  readonly credentialPresent: boolean;
  /** The free preflight gave no auth failure (Q6). */
  readonly preflightAuthOk: boolean;
  /** The harness is out of quota at launch (Q8). */
  readonly quotaExhausted: boolean;
  /** The read denial of the withheld paths is confirmed (Q10). */
  readonly readDenialConfirmed: boolean;
  /** The rising price of output, read only within the cost class `metered`. */
  readonly outputPriceUsd?: number;
};

/** The default harness, as step 4 reads it. */
export type DefaultHarnessCandidate = {
  readonly id: string;
  readonly modelId: string | null;
  readonly providerId: string | null;
  /** The model tiers the default harness offers, in its own order. */
  readonly modelTiers: readonly { readonly tier: string; readonly model: string }[];
  /** The tier the proposer runs on, where it is the default harness. */
  readonly proposerTier: string | null;
  readonly state: CriticCandidate["state"];
  readonly form: CriticCandidate["completionForm"]["value"];
  readonly windowTokens: number | null;
  readonly windowSource: string;
  /** Whether the default harness can play the critic at all. */
  readonly supportsCritic: boolean;
};

/** A critic the consumer configured (step 1). */
export type ConfiguredCritic = {
  readonly harness: string;
  readonly model: string | null;
  readonly providerId: string | null;
  readonly state: CriticCandidate["state"];
  readonly form: CriticCandidate["completionForm"]["value"];
  readonly windowTokens: number | null;
  readonly windowSource: string;
};

/** The phases the pick holds for, and how the lines are printed. */
export type CriticOrderInput = {
  /** Step 1 — the configured critic, or null. */
  readonly configured: ConfiguredCritic | null;
  /** Step 2 — a second model through the gateway of the host, or null. */
  readonly gateway: CriticOrderCandidate | null;
  /** Step 3 — the discovered candidates of the registry. */
  readonly discovered: readonly CriticOrderCandidate[];
  /** Step 4 — the default harness. */
  readonly defaultHarness: DefaultHarnessCandidate;
  /** The proposer, for the diversity test. */
  readonly proposer: {
    readonly harness: string;
    readonly model: string | null;
    readonly providerId: string | null;
  };
  /** The switch of F124-FR-044; on by default. */
  readonly autoPick: boolean;
  /** Condition Q9 — a budget is in force for the run. */
  readonly budgetInForce: boolean;
  /** Condition Q9 and the announcement — the hard cap of an automatic pick. */
  readonly capUsd: number | null;
  /** The output profile: under `parity` no line of this feature is printed (F124-FR-043). */
  readonly profile: "default" | "parity";
  /** Whether the consumer silenced the diversity line (row 92; the record and the event stay). */
  readonly warnSameModel: boolean;
  /** The phases the pick holds for (F124-FR-037: once per launch). */
  readonly phases: readonly string[];
  /** The model of every phase's proposer, where it differs from `proposer.model`. */
  readonly phaseProposerModels?: Readonly<Record<string, string | null>>;
  /** The surface, for the exit code of a refusal (F124-FR-035). */
  readonly surface: "launch" | "run";
};

/** The refusal: no harness can play the critic (F124-FR-037, F124-FR-035). */
export type CriticOrderRefusal = {
  readonly outcome: "refused";
  readonly line: string;
  readonly exitCode: 4 | 3;
  /** Every candidate, with the reason it failed. */
  readonly reasons: readonly { readonly harness: string; readonly reason: string }[];
};

/** A critic that was picked, with the plan entries the pick adds. */
export type CriticOrderPick = {
  readonly outcome: "picked";
  /** The pick, as the field `criticPick` of the resolved registry records it. */
  readonly pick: CriticPick;
  /** The entries the plan gains: the runners-up, then step 4 (decision D-7). */
  readonly planEntries: readonly CriticOrderPlanEntry[];
  /** The lines of the launch, already trimmed to the profile (F124-FR-043). */
  readonly lines: readonly string[];
  /** The event `critic.selected` of the catalogue (EV-28). */
  readonly event: ReturnType<typeof criticSelectedEvent>;
};

export type CriticOrderResult = CriticOrderRefusal | CriticOrderPick;

/** The diversity result and the warning for a candidate against the proposer. */
function diversityAgainstProposer(
  input: CriticOrderInput,
  modelId: string | null,
  providerId: string | null,
  phase: string,
): { readonly diversity: CriticPick["diversity"]; readonly sameModelWarning: boolean } {
  const proposerModel = input.phaseProposerModels?.[phase] ?? input.proposer.model;
  // The rule lives in `diversity.ts` (T037, the critic strategy seam). It
  // never blocks; the decision to proceed is not read here.
  return checkCriticDiversity(
    { model: modelId, provider: providerId },
    { model: proposerModel, provider: input.proposer.providerId },
  );
}

/** A plan entry the critic order adds, with the phase it plays in (decision D-7). */
export type CriticOrderPlanEntry = RolePlanEntry & {
  readonly phase: string;
  readonly role: string;
};

/** The plan entry of a runner-up or of the step-4 critic (decision D-7). */
function planEntry(
  phase: string,
  harness: string,
  model: string | null,
  form: CriticCandidate["completionForm"]["value"],
): CriticOrderPlanEntry {
  return {
    phase,
    role: "critic",
    harness,
    model,
    modelTier: "critic",
    authTier: 1,
    transport: "cli",
    form,
    containment: "pass",
    source: "default",
    kind: "runner-up",
    regate: false,
    terms: { decision: "allowed", row: "critic-order" },
  };
}

/** Qualify one candidate of step 2 or step 3 (F124-FR-038). */
function qualificationOf(
  input: CriticOrderInput,
  candidate: CriticOrderCandidate,
): QualificationSignal {
  return {
    candidate,
    supportsCriticRole: true,
    testedAdapter: candidate.testedAdapter,
    modelId: candidate.modelId,
    providerId: candidate.providerId,
    proposerModel: input.proposer.model,
    proposerProvider: input.proposer.providerId,
    credentialPresent: candidate.credentialPresent,
    preflightAuthOk: candidate.preflightAuthOk,
    quotaExhausted: candidate.quotaExhausted,
    budgetInForce: input.budgetInForce,
    capUsd: input.capUsd,
    readDenialConfirmed: candidate.readDenialConfirmed,
  };
}

function toRankingSignal(candidate: CriticOrderCandidate): RankingSignal {
  return {
    harness: candidate.id,
    form: candidate.completionForm.value,
    state: candidate.state,
    costClass: candidate.costClass.value,
    outputPriceUsd: candidate.outputPriceUsd,
    limitSignalSeen: candidate.quotaExhausted,
    windowTokens: candidate.contextWindow?.tokens ?? null,
    modelId: candidate.modelId,
  };
}

/** The rule ids the ranking of the candidates fired, in decision order. */
function ruleIdsOf(signals: readonly RankingSignal[]): string[] {
  const ruleIds: string[] = [];
  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      const ruleId = decidingRuleId(compareCandidates(signals[i]!, signals[j]!));
      if (ruleId !== null && !ruleIds.includes(ruleId)) ruleIds.push(ruleId);
    }
  }
  return ruleIds;
}

/**
 * The pick: the four steps of annex C §C.6, in order, once per launch.
 * Pure: the same input gives the same pick (F124-SC-006).
 */
export function pickCritic(input: CriticOrderInput): CriticOrderResult {
  const steps = input.phases;

  // Step 1 — the configured critic. Discovery and the automatic pick never
  // override it (F124-FR-037).
  if (input.configured !== null) {
    const first = diversityAgainstProposer(
      input,
      input.configured.model,
      input.configured.providerId,
      steps[0] ?? "",
    );
    const pick: CriticPick = {
      step: "configured",
      automatic: false,
      harness: input.configured.harness,
      model: input.configured.model,
      state: input.configured.state,
      form: input.configured.form,
      window: input.configured.windowTokens,
      windowSource: input.configured.windowSource,
      cap: null,
      diversity: first.diversity,
      sameModelWarning: first.sameModelWarning,
      runnersUp: [],
      notQualified: [],
      passedOver: [],
      table: { id: RANKING_TABLE_ID, version: RANKING_TABLE_VERSION, ruleIds: [] },
    };
    return {
      outcome: "picked",
      pick,
      planEntries: [],
      lines: launchLines(
        pick.sameModelWarning && input.warnSameModel
          ? [
              announcementLine(pick),
              diversityLine(pick.diversity, input.proposer.model, pick.model),
            ]
          : [announcementLine(pick)],
        input.profile,
      ),
      event: criticSelectedEvent(pick),
    };
  }

  const notQualified: { harness: string; reason: string }[] = [];
  const warnings: string[] = [];

  // Step 2 — a second model through the gateway of the host. Skipped with
  // the automatic pick off (F124-FR-044).
  if (input.autoPick && input.gateway !== null) {
    const outcome = qualifies(qualificationOf(input, input.gateway));
    if (outcome.qualifies) {
      return finish(input, input.gateway, "gateway", [], notQualified, warnings);
    }
    notQualified.push({ harness: outcome.harness, reason: outcome.reason ?? "form-unproven" });
    warnings.push(`${outcome.harness}: ${outcome.reason} (${outcome.ruleId})`);
  }

  // Step 3 — the discovered candidates, qualified then ranked (F124-FR-038,
  // F124-FR-040). Skipped with the automatic pick off (F124-FR-044).
  if (input.autoPick && input.discovered.length > 0) {
    const outcomes = input.discovered.map((candidate) => ({
      candidate,
      outcome: qualifies(qualificationOf(input, candidate)),
    }));
    for (const { outcome } of outcomes) {
      if (!outcome.qualifies) {
        notQualified.push({ harness: outcome.harness, reason: outcome.reason ?? "form-unproven" });
        warnings.push(`${outcome.harness}: ${outcome.reason} (${outcome.ruleId})`);
      }
    }
    const qualified = outcomes
      .filter(({ outcome }) => outcome.qualifies)
      .map(({ candidate }) => candidate);
    if (qualified.length > 0) {
      const ranking = rankCandidates(qualified.map(toRankingSignal));
      const byHarness = new Map(qualified.map((candidate) => [candidate.id, candidate]));
      const winner = byHarness.get(ranking.order[0]!.harness)!;
      const runnersUp: CriticRunnerUp[] = ranking.order.slice(1).map((signal, index) => ({
        harness: signal.harness,
        model: byHarness.get(signal.harness)!.modelId,
        rank: index + 1,
      }));
      return finish(input, winner, "discovered", runnersUp, notQualified, warnings, ranking.order);
    }
  }

  // Step 4 — the default harness on a different model tier, in a fresh
  // session, without tools, with a set budget. Where no other tier exists,
  // the same model, with the critic-diversity warning (F124-FR-037).
  const harness = input.defaultHarness;
  if (harness.supportsCritic) {
    const other = harness.modelTiers.find((tier) => tier.tier !== harness.proposerTier) ?? null;
    const model = other !== null ? other.model : (harness.modelTiers[0]?.model ?? harness.modelId);
    const first = diversityAgainstProposer(input, model, harness.providerId, steps[0] ?? "");
    const pick: CriticPick = {
      step: "default-model-tier",
      automatic: true,
      harness: harness.id,
      model,
      state: harness.state,
      form: harness.form,
      window: harness.windowTokens,
      windowSource: harness.windowSource,
      cap: null,
      diversity: first.diversity,
      sameModelWarning: first.sameModelWarning,
      runnersUp: [],
      notQualified,
      passedOver: [],
      table: { id: RANKING_TABLE_ID, version: RANKING_TABLE_VERSION, ruleIds: [] },
    };
    return {
      outcome: "picked",
      pick,
      planEntries: steps.map((phase) => planEntry(phase, harness.id, model, harness.form)),
      lines: launchLines([announcementLine(pick)], input.profile),
      event: criticSelectedEvent(pick),
    };
  }

  // No harness can play the critic: the launch is refused, with the reason
  // every candidate failed (F124-FR-037, F124-FR-035).
  const candidateReasons = [
    ...notQualified,
    ...input.discovered
      .filter((candidate) => !notQualified.some(({ harness }) => harness === candidate.id))
      .map((candidate) => ({ harness: candidate.id, reason: "role-unsupported" })),
  ];
  const list = candidateReasons.map(({ harness, reason }) => `${harness}: ${reason}`).join("; ");
  return {
    outcome: "refused",
    line:
      `[SPECSTRIDE-ROLES] the launch is refused: no harness can play the critic. ` +
      `The candidates: ${list}`,
    exitCode: input.surface === "launch" ? 4 : 3,
    reasons: candidateReasons,
  };
}

function finish(
  input: CriticOrderInput,
  winner: CriticOrderCandidate,
  step: Extract<StepOfTheCriticOrder, "gateway" | "discovered">,
  runnersUp: readonly CriticRunnerUp[],
  notQualified: readonly { readonly harness: string; readonly reason: string }[],
  warnings: readonly string[],
  ranked?: readonly RankingSignal[],
): CriticOrderPick {
  const perPhase = new Map<
    string,
    { diversity: CriticPick["diversity"]; sameModelWarning: boolean }
  >();
  for (const phase of input.phases) {
    perPhase.set(phase, diversityAgainstProposer(input, winner.modelId, winner.providerId, phase));
  }
  const first = perPhase.get(input.phases[0] ?? "")!;
  const pick: CriticPick = {
    step,
    automatic: true,
    harness: winner.id,
    model: winner.modelId,
    state: winner.state,
    form: winner.completionForm.value,
    window: winner.contextWindow?.tokens ?? null,
    windowSource: winner.contextWindow?.source ?? "unknown",
    cap: winner.costClass.value === "metered" ? input.capUsd : null,
    diversity: first.diversity,
    sameModelWarning: first.sameModelWarning,
    runnersUp: [...runnersUp],
    notQualified: [...notQualified],
    passedOver: [],
    table: {
      id: RANKING_TABLE_ID,
      version: RANKING_TABLE_VERSION,
      ruleIds: ranked === undefined ? [] : ruleIdsOf(ranked),
    },
  };
  const lines = [announcementLine(pick)];
  if (pick.sameModelWarning && input.warnSameModel) {
    // The critic-diversity warning; it never blocks the launch
    // (F124-FR-045).
    lines.push(diversityLine(pick.diversity, input.proposer.model, pick.model));
  }
  return {
    outcome: "picked",
    pick,
    planEntries: [
      ...input.phases.flatMap((phase) =>
        runnersUp.map((runnerUp) =>
          planEntry(phase, runnerUp.harness, runnerUp.model, "tool-less"),
        ),
      ),
    ],
    lines: launchLines(lines, input.profile),
    event: criticSelectedEvent(pick),
  };
}

/** Why a candidate lost, for the reading of the doctor (F124-FR-049). */
export type LostReason = { readonly harness: string; readonly reason: string };

/**
 * The evidence of the first call of an automatically picked critic
 * (F124-FR-048). The weaker proof of Principle IX (constitution v3.0.1,
 * CQ-182) applies where a TESTED harness adapter's stream carries no initial
 * record: an exact version pin, the flag set and the preflight, recorded on
 * every call as the weaker proof.
 */
export type FirstCallProof = {
  /** The initial record of the stream proved the form. */
  readonly proven: boolean;
  /** A tested harness adapter whose stream carries no initial record. */
  readonly testedAdapterWithoutInitialRecord: boolean;
  /** The exact version pin of the weaker proof. */
  readonly versionPinExact: boolean;
  /** The flag set of the weaker proof. */
  readonly flagSet: boolean;
  /** The preflight of the weaker proof. */
  readonly preflightOk: boolean;
};

/**
 * The pass-over rule at call time (F124-FR-041, F124-FR-048). A configured
 * critic is never passed over: it is refused (the result `refused`). A
 * candidate of the form read-only-tools is passed over when its harness
 * adapter cannot confirm the read denial of the withheld paths, or when the
 * worker root of parallel units is not empty after one sweep before the
 * call. A first call whose proof fails passes the candidate over and
 * produces no verdict; the weaker proof is believed.
 */
export function passOverReason(args: {
  readonly step: StepOfTheCriticOrder;
  readonly form: CriticCandidate["completionForm"]["value"];
  readonly readDenialConfirmed?: boolean;
  /** The worker root of parallel units is empty after one sweep. */
  readonly workerRootEmptyAfterOneSweep?: boolean;
  readonly firstCallProof?: FirstCallProof;
}):
  | { readonly passOver: false; readonly refused: boolean }
  | { readonly passOver: true; readonly reason: string } {
  // A configured critic is refused, never passed over (F124-FR-041).
  if (args.step === "configured") return { passOver: false, refused: true };
  if (args.form === "read-only-tools") {
    if (args.readDenialConfirmed === false) {
      return { passOver: true, reason: "read-denial-unconfirmed" };
    }
    if (args.workerRootEmptyAfterOneSweep === false) {
      return { passOver: true, reason: "worker-root-not-empty" };
    }
  }
  const proof = args.firstCallProof;
  if (proof !== undefined && !proof.proven) {
    // The weaker proof of Principle IX: a tested harness adapter whose
    // stream carries no initial record, with the exact version pin, the
    // flag set and the preflight — believed, recorded on every call.
    const weaker =
      proof.testedAdapterWithoutInitialRecord &&
      proof.versionPinExact &&
      proof.flagSet &&
      proof.preflightOk;
    if (!weaker) return { passOver: true, reason: "first-call-unproven" };
  }
  return { passOver: false, refused: false };
}
