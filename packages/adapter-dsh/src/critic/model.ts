/**
 * T044 (part 2) — the model reference of the critic and its throwaway home
 * (F130-FR-028).
 *
 * A model override of the critic is applied by the SAME rules as for the
 * proposer: the reference rules of F130-FR-012 (`invalid DSH model ref`
 * outside the character classes, `conflicting DSH providers` where the
 * provider differs) and the table of bare ids of F130-FR-013. The override is
 * applied through the throwaway home of F130-FR-014 — every entry of the real
 * home except the settings file linked, the new settings file with the block
 * `agent-default-model` first — which is removed after the call. The critic
 * model (`roles.critic.model`) comes first, the model of the proposer is its
 * fallback; the critic provider is preferred over the provider of the
 * proposer; the effort of the critic wins over the effort of the proposer.
 * A reference error of the critic fails the call as F130-FR-026 says.
 */
import {
  resolveDshModel,
  type BareModelRow,
  type ModelReference,
  type ModelResolution,
} from "../model/index.ts";
import { buildOverlay, type DshOverlay } from "../overlay/index.ts";

/** The input of the critic model resolution, with the proposer fallbacks. */
export type ResolveCriticModelInput = {
  /** The `--model` flag, where the engine hands one. */
  readonly flag?: string | null;
  /** `roles.critic.model` (F130-FR-022), used when the entry has no qualifier. */
  readonly setting?: string | null;
  /** The qualifier of the entry, `provider/model`. */
  readonly qualifier?: string | null;
  /** `roles.critic.provider`, preferred over the provider of the proposer. */
  readonly providerSetting?: string | null;
  /** Rows of `harnesses.dsh.modelProviders` (the SAME table as the proposer). */
  readonly modelProviders?: readonly BareModelRow[];
};

/**
 * F130-FR-028 — resolves the model of a critic call by the SAME rules as the
 * proposer's (`resolveDshModel`): the flag, then the critic model with the
 * proposer model as fallback, then the qualifier; the critic provider is
 * preferred over the proposer provider. `reference: null` means no override.
 */
export function resolveCriticModel(
  input: ResolveCriticModelInput = {},
  fallback: { readonly model?: string | null; readonly provider?: string | null } = {},
): ModelResolution {
  const setting = input.setting ?? fallback.model ?? null;
  const providerSetting = input.providerSetting ?? fallback.provider ?? null;
  return resolveDshModel({
    flag: input.flag ?? null,
    setting,
    qualifier: input.qualifier ?? null,
    providerSetting,
    modelProviders: input.modelProviders,
  });
}

/**
 * F130-FR-028 — builds the throwaway home of the critic call with the SAME
 * rules as the proposer's (`buildOverlay` of F130-FR-014), with the reasoning
 * effort of the critic added to the settings of the overlay. Removal after
 * the call is the caller's duty (also on a failed call).
 */
export function buildCriticOverlay(input: {
  readonly realHome: string | null;
  readonly reference: ModelReference;
  readonly effort?: string | null;
}): DshOverlay {
  return buildOverlay(input);
}
