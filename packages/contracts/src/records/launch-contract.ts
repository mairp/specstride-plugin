/**
 * T196 — the type and the validator of the launch contract from
 * `schemas/launch-contract.schema.json` (annex G, §G.8; F100-FR-190,
 * F100-FR-191).
 *
 * Schema id `specstride.launch-contract/1`, logical name
 * `pipeline:<pipelineId>:contract`. The launch-contract commands of the CLI
 * write it, and only validation promotes. The runtime root, the pipeline stage
 * executor, learning (the binding) and the CLI read it. Content owner 107,
 * which may add fields to `inventory` and `configuration`.
 *
 * The schema is CLOSED: a top-level key it does not hold refuses the launch
 * contract, and a key under `x-` is ignored (F100-FR-190).
 */
import type { LaunchContract as Generated } from "./generated/launch-contract.ts";
import { readRecord, tryReadRecord, type RecordRefusedError } from "./validate.ts";
import { validate } from "./compile.ts";

/** The schema id this record carries in its field `schema` (F100-FR-048). */
export const SCHEMA_ID = "specstride.launch-contract/1" as const;

/** The logical name of the record (annex B, §B.5). */
export const LOGICAL_NAME = "pipeline:<pipelineId>:contract" as const;

/** The section of annex G that owns the field list. */
export const ANNEX_SECTION = "annex G, §G.8" as const;

/** The content owner of §G.8, and what it may add. */
export const CONTENT_OWNER = "107" as const;
export const OWNER_MAY_ADD_FIELDS_TO = ["inventory", "configuration"] as const;

/** The launch contract of one pipeline (annex G, §G.8). */
export type LaunchContract = Generated;

/** The two states of a launch contract (§G.8, `status`). */
export const STATUSES = ["draft", "validated"] as const;
export type LaunchContractStatus = (typeof STATUSES)[number];

/**
 * Read the record: the field `schema` is required, a different major is
 * refused with the message of the annex, every required field of §G.8 is
 * required, a top-level key the schema does not hold is refused, and a key
 * under `x-` is ignored (F100-FR-048, F100-FR-049, F100-FR-190).
 */
export function readLaunchContract(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): LaunchContract {
  return readRecord<LaunchContract>(logicalName, value);
}

/** `readLaunchContract` that returns a result instead of throwing. */
export function tryReadLaunchContract(
  value: unknown,
  logicalName: string = LOGICAL_NAME,
): { ok: true; record: LaunchContract } | { ok: false; error: RecordRefusedError } {
  return tryReadRecord<LaunchContract>(logicalName, value);
}

/** True when the value validates against `specstride.launch-contract/1`. */
export function isLaunchContract(value: unknown): value is LaunchContract {
  return validate<LaunchContract>(SCHEMA_ID, value).ok;
}

/* ------------------------------------------------------------------ *
 * F100-FR-190 — one schema is also the validator; only validation
 * promotes; the proof of promotion.
 * ------------------------------------------------------------------ */

/** F100-FR-190 — the schema of §G.8 is also the validator. */
export const THE_SCHEMA_IS_THE_VALIDATOR = true as const;

/** F100-FR-190 — a top-level key the schema does not hold refuses the record. */
export const AN_UNKNOWN_TOP_LEVEL_KEY_IS_REFUSED = true as const;
export const KEYS_UNDER_THIS_PREFIX_ARE_IGNORED = "x-" as const;

/** True where the key is one the closed schema ignores (a key under `x-`). */
export function keyIsIgnored(key: string): boolean {
  return key.startsWith(KEYS_UNDER_THIS_PREFIX_ARE_IGNORED);
}

/** The one act that promotes a launch contract (F100-FR-190). */
export const PROMOTED_ONLY_BY = "validation" as const;

/**
 * The proof of promotion (§G.8, `promotion`): the logical component that
 * promoted, and the hash of the canonical launch contract WITHOUT `status`
 * and `promotion`.
 */
export type PromotionProof = {
  /** The logical component that promoted (annex X §X.8, component names). */
  readonly by: string;
  /** The hash of the canonical launch contract without `status` and `promotion`. */
  readonly hash: string;
};

/** The fields the hash of the proof of promotion leaves out (§G.8). */
export const FIELDS_OUTSIDE_THE_PROMOTION_HASH = ["status", "promotion"] as const;

/** The record the proof of promotion is taken over: the contract without those two. */
export function canonicalForPromotion(
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if ((FIELDS_OUTSIDE_THE_PROMOTION_HASH as readonly string[]).includes(key)) continue;
    out[key] = record[key];
  }
  return out;
}

/** `promotion` is required with the status `validated` (§G.8). */
export function promotionIsRequired(status: string): boolean {
  return status === "validated";
}

/**
 * F100-FR-190 and the state transitions of data-model.md — `draft` is
 * promoted to `validated` by validation only, and a later validation that
 * fails sets it back to `draft`.
 */
export type PromotionOutcome =
  | { readonly status: "validated"; readonly promotion: PromotionProof }
  | { readonly status: "draft"; readonly refusal: LaunchContractRefusal };

/** Why a launch contract is refused, with the pipeline code of §G.8. */
export const REFUSALS = Object.freeze({
  "no-matching-proof-of-promotion": 20 as const,
  invalid: 20 as const,
  "sources-changed": 23 as const,
});
export type LaunchContractRefusal = keyof typeof REFUSALS;

/** The pipeline exit code of a refusal (F100-FR-190). */
export function exitCodeOfRefusal(refusal: LaunchContractRefusal): number {
  return REFUSALS[refusal];
}

/**
 * F100-FR-190 — `promote` only through validation: a validated launch contract
 * without a matching proof of promotion is refused with the pipeline code 20,
 * and one whose sources changed with 23.
 */
export function promote(input: {
  readonly record: Readonly<Record<string, unknown>>;
  readonly validates: boolean;
  readonly proof?: PromotionProof | undefined;
  readonly hashOfTheCanonicalRecord: string;
  readonly sourcesChanged?: boolean | undefined;
}): PromotionOutcome {
  if (input.sourcesChanged === true) {
    return Object.freeze({ status: "draft" as const, refusal: "sources-changed" as const });
  }
  if (!input.validates) {
    return Object.freeze({ status: "draft" as const, refusal: "invalid" as const });
  }
  if (input.proof === undefined || input.proof.hash !== input.hashOfTheCanonicalRecord) {
    return Object.freeze({
      status: "draft" as const,
      refusal: "no-matching-proof-of-promotion" as const,
    });
  }
  return Object.freeze({ status: "validated" as const, promotion: input.proof });
}

/**
 * F100-FR-190 — a validated launch contract is accepted only with a proof of
 * promotion whose hash matches the canonical record without `status` and
 * `promotion`.
 */
export function promotionIsProven(input: {
  readonly status: string;
  readonly promotion?: PromotionProof | undefined;
  readonly hashOfTheCanonicalRecord: string;
}): boolean {
  if (input.status !== "validated") return true;
  return input.promotion !== undefined && input.promotion.hash === input.hashOfTheCanonicalRecord;
}

/** The closed set of §X.6 that every finding of a validation carries (row 274). */
export const ERROR_CLASS_SET_ROW = 274 as const;
export const AN_UNKNOWN_ERROR_CLASS_FAILS_THE_BUILD = true as const;

/* ------------------------------------------------------------------ *
 * F100-FR-191 — the modes of the host skill `specstride-run`.
 * ------------------------------------------------------------------ */

/** The two modes of the host skill (F100-FR-191). */
export const HOST_SKILL = "specstride-run" as const;
export const MODES = ["run", "dry-run"] as const;
export type HostSkillMode = (typeof MODES)[number];

/** The host skill launches by default (F100-FR-191). */
export const DEFAULT_MODE: HostSkillMode = "run";

/** `dry-run` withholds the launch and prints the plan (F100-FR-191). */
export const DRY_RUN = Object.freeze({
  withholdsTheLaunch: true as const,
  printsThePlan: true as const,
});

/** The as-is mode names and what each maps to (F100-FR-191; the mode map of §X.8). */
export const MODE_MAP: Readonly<Record<string, HostSkillMode>> = Object.freeze({
  generate: "dry-run",
  run: "run",
  auto: "run",
});

/** The mode an as-is name maps to, or `undefined` for a name the map does not hold. */
export function modeOf(asIs: string): HostSkillMode | undefined {
  return MODE_MAP[asIs];
}

/** The row of §X.7 under which the modes are mapped through the mode map. */
export const PARITY_ROW = 37 as const;
