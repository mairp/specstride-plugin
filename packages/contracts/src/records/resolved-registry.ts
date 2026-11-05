/**
 * T168 — the type and the validator of the resolved registry and role plan
 * from `schemas/resolved-registry.schema.json` (annex C, §C.6; F100-FR-092,
 * F100-FR-093, F100-FR-094).
 *
 * Schema id `specstride.registry/1`, logical name `run:<runId>:registry`. The
 * CLI writes it at launch; the engine, quota and fallback handling, the doctor
 * and the digest read it. The critic order of §C.6 is the key `criticOrder` of
 * `data/harness-tables.json`.
 */
import harnessTables from "../../data/harness-tables.json" with { type: "json" };
import type { ResolvedRegistry as Generated } from "./generated/resolved-registry.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";
import { COMPLETION_FORMS, type CompletionForm } from "../enums/completion-forms.ts";
import { CONTAINMENT_LEVELS, type ContainmentLevel } from "../enums/containment.ts";
import { HARNESS_STATES, type HarnessState, type DescriptorOrigin } from "./harness-descriptor.ts";

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.registry/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "run:<runId>:registry" as const;

/** The section of annex C that owns the field list. */
export const ANNEX_SECTION = "annex C, §C.6" as const;

/** The content owner of §C.6. */
export const CONTENT_OWNER = "124" as const;

/* ------------------------------------------------------------------ *
 * The critic order (§C.6), from `data/harness-tables.json`.
 * ------------------------------------------------------------------ */

/** The four steps of the critic order, as row 180 of annex X §X.6 names them. */
export const CRITIC_ORDER_STEPS = [
  "configured",
  "gateway",
  "discovered",
  "default-model-tier",
] as const;
export type CriticOrderStep = (typeof CRITIC_ORDER_STEPS)[number];

type RawStep = { Step: string; Candidate: string };

/** One step of the critic order: its number, its id and the candidate. */
export type CriticOrderRow = {
  readonly step: number;
  readonly id: CriticOrderStep;
  readonly candidate: string;
};

const RAW_ORDER = (harnessTables as { criticOrder: RawStep[] }).criticOrder;

/** A `criticOrder` that is not the four steps of §C.6. */
export class CriticOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CriticOrderError";
  }
}

function criticOrderRows(): readonly CriticOrderRow[] {
  if (RAW_ORDER.length !== CRITIC_ORDER_STEPS.length) {
    throw new CriticOrderError(
      `the key \`criticOrder\` of \`data/harness-tables.json\` holds ${RAW_ORDER.length} ` +
        `steps; annex C §C.6 holds the ${CRITIC_ORDER_STEPS.length} steps of the critic ` +
        `order (F100-FR-093)`,
    );
  }
  return Object.freeze(
    RAW_ORDER.map((row, i) =>
      Object.freeze({
        step: Number(row.Step),
        id: CRITIC_ORDER_STEPS[i] as CriticOrderStep,
        candidate: row.Candidate,
      }),
    ),
  );
}

/** The four steps of the critic order, in order (§C.6). */
export const CRITIC_ORDER: readonly CriticOrderRow[] = criticOrderRows();

/**
 * F100-FR-093 — within step 3 every tool-less candidate stands before every
 * candidate with read-only tools, and a tested harness before an unverified
 * one.
 */
export const STEP_WITH_DISCOVERED_HARNESSES: CriticOrderStep = "discovered";
export const FORM_ORDER_WITHIN_THE_STEP: readonly CompletionForm[] = COMPLETION_FORMS;
export const STATE_ORDER_WITHIN_THE_STEP = ["tested", "locally-verified"] as const;

/**
 * F100-FR-093 — the rules of an automatic pick, as data: an unverified
 * harness of kind `cli` is never picked automatically; a harness whose terms
 * are unknown and that the consumer did not name is never a default and never
 * picked automatically, and is usable when the consumer names it with the
 * unknown-terms warning; an automatically picked critic on a metered endpoint
 * has a hard spending cap, announced at launch; the pick is announced,
 * recorded and shown in the digest.
 */
export const AUTOMATIC_PICK_RULES = Object.freeze({
  neverAnUnverifiedCliHarness: true as const,
  neverAHarnessWithUnknownTermsTheConsumerDidNotName: true as const,
  unknownTermsAreUsableWhenTheConsumerNamesThem: true as const,
  unknownTermsWarning: "unknown-terms" as const,
  meteredEndpointNeedsAHardSpendingCap: true as const,
  spendingCapIsAnnouncedAtLaunch: true as const,
  pickIsAnnounced: true as const,
  pickIsRecorded: true as const,
  pickIsShownInTheDigest: true as const,
});

/** F100-FR-093 — an unverified harness of kind `cli` is never picked automatically. */
export function mayBePickedAutomatically(candidate: {
  readonly state: string;
  readonly kind: string;
  readonly termsKnown: boolean;
  readonly namedByTheConsumer: boolean;
  readonly contextWindowKnown?: boolean;
}): boolean {
  if (candidate.state !== "tested" && candidate.kind === "cli") return false;
  if (!candidate.termsKnown && !candidate.namedByTheConsumer) return false;
  if (candidate.contextWindowKnown === false) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * The roles (§C.6, F100-FR-094).
 * ------------------------------------------------------------------ */

/** The roles Wave 1 registers (§C.6). */
export const ROLES_OF_WAVE_1 = ["proposer", "critic"] as const;

/** The two roles that run under the critic-class and proposer rules (§C.6). */
export const ROLES_UNDER_THE_SAME_RULES = ["diagnostician", "accelerator"] as const;

/** F100-FR-094 — roles are an open registry: a role has these four facts. */
export const ROLE_FACTS = [
  "id",
  "capabilityLevelRequired",
  "independenceConstraints",
  "budgetKey",
] as const;

/** One entry of `roles` (§C.6, the field table). */
export type RoleEntry = {
  readonly id: string;
  /** `proposer` or `completion` (row 123 of annex X §X.6). */
  readonly capabilityLevelRequired: string;
  readonly independenceConstraints: readonly string[];
  readonly budgetKey: string;
};

/** F100-FR-094 — role resolution resolves every registered role. */
export function everyRoleIsResolved(
  registered: readonly string[],
  plan: Readonly<Record<string, unknown>>,
): boolean {
  return registered.every((role) =>
    Object.values(plan).some(
      (perPhase) =>
        typeof perPhase === "object" && perPhase !== null && role in (perPhase as object),
    ),
  );
}

/** A role whose four facts are all present (F100-FR-094). */
export function isRoleEntry(value: unknown): value is RoleEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return ROLE_FACTS.every((fact) => v[fact] !== undefined);
}

/* ------------------------------------------------------------------ *
 * The entries of the plan (§C.6).
 * ------------------------------------------------------------------ */

/** The facts one entry of `plan` carries (§C.6, the field table). */
export const PLAN_ENTRY_FACTS = [
  "harness",
  "model",
  "modelTier",
  "authTier",
  "transport",
  "form",
  "containment",
  "termsDecision",
] as const;

/** One entry of the plan: the primary, or a fallback the consumer opted into. */
export type PlanEntry = {
  readonly harness: string;
  readonly model: string;
  readonly modelTier: string;
  readonly authTier: number;
  readonly transport: string;
  /** The form of the `completion` level (§C.3). */
  readonly form: CompletionForm;
  readonly containment: ContainmentLevel;
  /** The decision of the terms gate with the row it rests on. */
  readonly termsDecision: { readonly decision: string; readonly row: string };
};

/** One harness of `harnesses` (§C.6, the field table). */
export type RegistryHarness = {
  readonly id: string;
  readonly state: HarnessState;
  readonly origin: DescriptorOrigin;
  readonly version: string | null;
  readonly descriptorHash: string;
  readonly resolvedPath: string | null;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly containmentCeiling: { readonly level: ContainmentLevel; readonly provenance: string };
  readonly sources: Readonly<Record<string, string>>;
};

/** How the critic was chosen (`criticPick` of §C.6). */
export type CriticPick = {
  readonly step: CriticOrderStep;
  readonly state: HarnessState;
  readonly window: number | null;
  readonly windowSource: string;
  readonly reason: string;
  readonly diversityWarningRaised: boolean;
};

/** The resolved registry and role plan (annex C, §C.6). */
export type ResolvedRegistry = Omit<
  Generated,
  "harnesses" | "roles" | "runnersUp" | "announced"
> & {
  readonly harnesses: readonly RegistryHarness[];
  readonly roles: readonly RoleEntry[];
  readonly runnersUp: readonly { readonly harness: string; readonly reason: string }[];
  readonly announced: readonly string[];
};

/* ------------------------------------------------------------------ *
 * The validator and the rules of resolution (F100-FR-092).
 * ------------------------------------------------------------------ */

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, and every required field of §C.6 is
 * required (F100-FR-048, F100-FR-049).
 */
export function readResolvedRegistry(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): ResolvedRegistry {
  return readRecord<ResolvedRegistry>(logicalName, value);
}

/** `readResolvedRegistry` that returns a result instead of throwing. */
export function tryReadResolvedRegistry(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: ResolvedRegistry } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<ResolvedRegistry>(logicalName, value);
}

/** True when the value validates against `specstride.registry/1`. */
export function isResolvedRegistry(value: unknown): value is ResolvedRegistry {
  return validate<ResolvedRegistry>(SCHEMA_ID, value).ok;
}

/**
 * F100-FR-092 — role resolution writes the record at launch, the engine walks
 * the plan, and a resolution never takes place after launch.
 */
export const WRITTEN_AT = "launch" as const;
export const WRITTEN_BY = "the CLI at launch" as const;
export const RESOLUTION_AFTER_LAUNCH = false as const;
export const ENGINE_WALKS_THE_PLAN = true as const;

/**
 * F100-FR-092 — a resume or relaunch reads the record and does not rank
 * again, unless the consumer asks by flag or the stored pick no longer exists.
 */
export const REASONS_TO_RANK_AGAIN = ["flag", "stored-pick-gone"] as const;
export type ReasonToRankAgain = (typeof REASONS_TO_RANK_AGAIN)[number];

export function ranksAgainOnResume(options: {
  readonly consumerAsksByFlag?: boolean;
  readonly storedPickStillExists?: boolean;
}): { readonly again: boolean; readonly reason?: ReasonToRankAgain } {
  if (options.consumerAsksByFlag === true) return { again: true, reason: "flag" };
  if (options.storedPickStillExists === false) return { again: true, reason: "stored-pick-gone" };
  return { again: false };
}

/** The states and levels the entries of the record may name. */
export { HARNESS_STATES, CONTAINMENT_LEVELS, COMPLETION_FORMS };
