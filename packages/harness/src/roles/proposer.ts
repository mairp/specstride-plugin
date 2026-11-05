/**
 * T020 — the proposer guarantee and the default roles (F124-FR-024,
 * F124-FR-025, F124-FR-027).
 *
 * The guarantee: the proposer of every phase comes from one of FOUR sources —
 * a flag, the environment, the configuration, or the shipped default — and
 * the plan records which. Discovery NEVER sets or changes the proposer: no
 * input of this module is a discovery result, so no discovery result can
 * reach the proposer. When the proposer is absent the launch is refused, and
 * the refusal names the harnesses of the registry that support the role.
 *
 * The default: with no role named, the default harness of Wave 1 plays the
 * proposer and the critic on DIFFERENT model tiers. The default harness
 * itself is a fact of the resolved configuration handed in by the
 * composition root — this module holds no harness name (F124-SC-008).
 *
 * The model of a role has NO default in the product: where the consumer
 * names none, the plan records null, the harness uses the model of its own
 * configuration, and no model argument is passed (F124-FR-027).
 */
import type { SourceOfTheProposer } from "./types.ts";
import { renderRoleList, type NamedHarness } from "./names.ts";

/** The model tiers the default roles use — different, as F124-FR-025 asks. */
export const DEFAULT_PROPOSER_MODEL_TIER = "proposer" as const;
export const DEFAULT_CRITIC_MODEL_TIER = "critic" as const;

/** The label of each of the four sources, as the record spells it (row 181). */
export const SOURCES_OF_THE_PROPOSER = ["flag", "environment", "configuration", "default"] as const;

/** The state of the proposer after the four sources are asked. */
export type ProposerResolution = {
  readonly name: string;
  readonly source: SourceOfTheProposer;
  /** The model named for the proposer, or null (F124-FR-027). */
  readonly model: string | null;
};

/** A refusal of the launch, as role resolution ends it (F124-FR-035). */
export type RoleRefusal = {
  /** Why the launch was refused. */
  readonly reason: string;
  /** The line the refusal prints, naming what the consumer needs. */
  readonly line: string;
  /** `launch` ends 4; a foreground `run` ends 3 (F124-FR-035). */
  readonly exitCodeLaunch: 4;
  readonly exitCodeRun: 3;
};

/** Where the proposer's name and model are read from. */
export type ProposerInput = {
  /** The flag `--proposer`, when the consumer passed one. */
  readonly flag?: string | null;
  /** The as-is environment variable, when it is set. */
  readonly environment?: string | null;
  /** The row-36 key of the proposer in user configuration. */
  readonly configuration?: string | null;
  /** The model named for the proposer; null when none is (F124-FR-027). */
  readonly model?: string | null;
  /** The default harness of Wave 1, as the resolved configuration holds it. */
  readonly defaultHarness: string;
  /** The harnesses of the resolved registry (F124-FR-024). */
  readonly registry: readonly NamedHarness[];
};

/** Ask the four sources in order; the first that names one wins (F124-FR-024). */
export function sourceOfTheProposer(input: ProposerInput): {
  readonly spec: string | null;
  readonly source: SourceOfTheProposer | null;
} {
  if (typeof input.flag === "string" && input.flag.length > 0) {
    return { spec: input.flag, source: "flag" };
  }
  if (typeof input.environment === "string" && input.environment.length > 0) {
    return { spec: input.environment, source: "environment" };
  }
  if (typeof input.configuration === "string" && input.configuration.length > 0) {
    return { spec: input.configuration, source: "configuration" };
  }
  return { spec: input.defaultHarness, source: "default" };
}

/**
 * F124-FR-024 — the refusal of an absent proposer: the launch is refused and
 * the refusal NAMES the harnesses of the registry that support the role,
 * rendered as F124-FR-031 renders every list.
 */
export function absentProposerRefusal(input: ProposerInput): RoleRefusal {
  const list = renderRoleList(input.registry, "proposer");
  return {
    reason: "no-proposer",
    line:
      "[SPECSTRIDE-ROLES] the launch is refused: no harness can play the proposer. " +
      `The registry holds: ${list}`,
    exitCodeLaunch: 4,
    exitCodeRun: 3,
  };
}

/**
 * Resolve the proposer. The result is either a resolution — a name, its
 * source of the closed set, and the model or null — or the refusal of an
 * ABSENT proposer. The proposer is absent when no source names one: no flag,
 * no environment variable, no configuration key, and the shipped default
 * holds no harness that the registry gives the role — the refusal names the
 * harnesses that support the role (F124-FR-024). A name that no source of
 * the registry knows is NOT absent: it is carried to role resolution, which
 * owns the unknown-name switch (F124-FR-028).
 *
 * Discovery appears nowhere in the input: it can never set or change the
 * proposer (F124-FR-024).
 */
export function resolveProposer(input: ProposerInput):
  | { readonly ok: true; readonly proposer: ProposerResolution }
  | {
      readonly ok: false;
      readonly refusal: RoleRefusal;
    } {
  const { spec, source } = sourceOfTheProposer(input);
  if (spec === null || source === null || spec.length === 0) {
    return { ok: false, refusal: absentProposerRefusal(input) };
  }
  const supportsTheRole =
    source === "default"
      ? input.registry.some((harness) => harness.roles.includes("proposer") && harness.id === spec)
      : true;
  if (!supportsTheRole) {
    return { ok: false, refusal: absentProposerRefusal(input) };
  }
  return {
    ok: true,
    proposer: { name: spec, source, model: input.model ?? null },
  };
}

/**
 * F124-FR-025 — with no role named, the default harness plays the proposer
 * AND the critic, on different model tiers. The entries are per phase, so a
 * caller folds them into the plan it builds.
 */
export function defaultRoles(input: {
  readonly defaultHarness: string;
  readonly phases: readonly string[];
  readonly proposerModel?: string | null;
  readonly criticModel?: string | null;
}): readonly {
  readonly phase: string;
  readonly role: string;
  readonly harness: string;
  readonly model: string | null;
  readonly modelTier: string;
  readonly source: SourceOfTheProposer;
}[] {
  return input.phases.flatMap((phase) => [
    {
      phase,
      role: "proposer",
      harness: input.defaultHarness,
      model: input.proposerModel ?? null,
      modelTier: DEFAULT_PROPOSER_MODEL_TIER,
      source: "default" as SourceOfTheProposer,
    },
    {
      phase,
      role: "critic",
      harness: input.defaultHarness,
      model: input.criticModel ?? null,
      modelTier: DEFAULT_CRITIC_MODEL_TIER,
      source: "default" as SourceOfTheProposer,
    },
  ]);
}
