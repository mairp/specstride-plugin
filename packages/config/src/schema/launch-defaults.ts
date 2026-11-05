/**
 * T009 — the launch defaults (F110-FR-005).
 *
 * The requirement states four things, and each is a named export here, read
 * from the catalogue rather than repeated beside it:
 *
 * 1. Where no role is named, the proposer and the critic are both Claude, on
 *    different model tiers (`roles.proposer.harness` has "the shipped default,
 *    Claude in Wave 1" and `roles.critic.model` "the harness default, on a model
 *    tier other than the proposer's").
 * 2. `verification.mode` is `required`.
 * 3. The proposer comes from a flag, the environment, a configuration file or the
 *    shipped default only — the layers the catalogue lists for
 *    `roles.proposer.harness` — and an absent proposer refuses the launch and
 *    names the discovered candidates.
 * 4. Lisa's defaults — one model for both roles, verification `off` — do not
 *    apply.
 *
 * The behaviour of the roles belongs to features 124 and 105; what this feature
 * owns, and what this module holds, is the spelling, the type, the class and the
 * layers of the keys the defaults stand in, and the refusal when the proposer is
 * absent. CT-110-105 (task T025) is the test of the requirement.
 */
import { catalogueEntry } from "./catalogue.ts";
import type { LayerCode } from "./types.ts";

/** The harness the product ships as the default of both roles in Wave 1. */
export const SHIPPED_HARNESS = "claude";

/** The key of each launch default F110-FR-005 names. */
export const LAUNCH_DEFAULT_KEYS = Object.freeze({
  proposerHarness: "roles.proposer.harness",
  proposerModel: "roles.proposer.model",
  criticHarness: "roles.critic.harness",
  criticModel: "roles.critic.model",
  verificationMode: "verification.mode",
} as const);

/** The default of `verification.mode` (F110-FR-005, second clause). */
export const VERIFICATION_MODE_DEFAULT = "required";

/**
 * The layers a proposer may come from: a flag, the environment, a configuration
 * file, or the shipped default. Read from the catalogue, so that the two cannot
 * disagree.
 */
export function proposerLayers(): readonly LayerCode[] {
  return catalogueEntry(LAUNCH_DEFAULT_KEYS.proposerHarness)?.layers ?? [];
}

/** True where the layer may name the proposer (F110-FR-005, third clause). */
export function proposerMayComeFrom(layer: LayerCode): boolean {
  return proposerLayers().includes(layer);
}

/**
 * Lisa's defaults, recorded so that the test can state what must NOT apply
 * (F110-FR-005, last sentence; divergences DV-004 and DV-043).
 */
export const LISA_DEFAULTS = Object.freeze({
  oneModelForBothRoles: true,
  verificationMode: "off",
} as const);

/** F110-FR-005, last sentence — Lisa's defaults never apply. */
export const LISA_DEFAULTS_APPLY = false as const;

/**
 * True where the two roles would run on one model tier, which the launch
 * defaults forbid where no role is named (F110-FR-005, first clause).
 */
export function rolesShareAModel(
  proposerModel: string | undefined,
  criticModel: string | undefined,
): boolean {
  return proposerModel !== undefined && criticModel !== undefined && proposerModel === criticModel;
}

/** A launch with no proposer (F110-FR-005, third clause). */
export class AbsentProposerError extends Error {
  readonly reason = "no-proposer" as const;
  /** The harnesses the discovery found, which the message names. */
  readonly candidates: readonly string[];
  constructor(candidates: readonly string[]) {
    super(
      `no proposer is named. The proposer comes from a flag, the environment, a ` +
        `configuration file or the shipped default only (\`${LAUNCH_DEFAULT_KEYS.proposerHarness}\`, ` +
        `layers \`${catalogueEntry(LAUNCH_DEFAULT_KEYS.proposerHarness)?.cells.layers ?? ""}\`)` +
        (candidates.length === 0
          ? ". No harness was discovered"
          : `. The discovered candidates are \`${candidates.join("`, `")}\``),
    );
    this.name = "AbsentProposerError";
    this.candidates = Object.freeze([...candidates]);
  }
}

/** The launch defaults, as F110-FR-005 states them, read from the catalogue. */
export interface LaunchDefaults {
  readonly proposerHarness: string;
  readonly criticHarness: string;
  /** The default of `verification.mode`. */
  readonly verificationMode: string;
  /** The cells of the catalogue the two model defaults state. */
  readonly proposerModel: string;
  readonly criticModel: string;
}

/**
 * The launch defaults where no role is named. The two harnesses are the shipped
 * default, Claude in Wave 1; the two model cells say that the critic's model lies
 * on a tier other than the proposer's; `verification.mode` is `required`.
 */
export function launchDefaults(): LaunchDefaults {
  const mode = catalogueEntry(LAUNCH_DEFAULT_KEYS.verificationMode);
  return Object.freeze({
    proposerHarness: SHIPPED_HARNESS,
    criticHarness: SHIPPED_HARNESS,
    verificationMode:
      mode?.default.kind === "value" ? String(mode.default.value) : VERIFICATION_MODE_DEFAULT,
    proposerModel: catalogueEntry(LAUNCH_DEFAULT_KEYS.proposerModel)?.cells.default ?? "",
    criticModel: catalogueEntry(LAUNCH_DEFAULT_KEYS.criticModel)?.cells.default ?? "",
  });
}

/** What the launch knows when it resolves the proposer (F110-FR-005). */
export interface ProposerRequest {
  /**
   * The value the eight ranks gave `roles.proposer.harness`, and the layer it
   * came from. `undefined` means no rank named a proposer.
   */
  readonly resolved?:
    { readonly value: unknown; readonly layer: LayerCode | "default" } | undefined;
  /** The harnesses the discovery found, which the refusal names. */
  readonly candidates?: readonly string[] | undefined;
  /** True where the shipped default applies; Wave 1 ships one (`SHIPPED_HARNESS`). */
  readonly shippedDefaultApplies?: boolean | undefined;
}

/** Where the proposer came from (F110-FR-005, third clause). */
export interface ResolvedProposer {
  readonly harness: string;
  readonly from: LayerCode | "default";
}

/**
 * F110-FR-005, third clause — the proposer comes from a flag, the environment,
 * a configuration file or the shipped default only. A value offered by a layer
 * the catalogue does not list for `roles.proposer.harness` is no proposer, and
 * an absent proposer refuses the launch and names the discovered candidates.
 */
export function resolveProposerHarness(request: ProposerRequest = {}): ResolvedProposer {
  const offered = request.resolved;
  if (
    offered !== undefined &&
    typeof offered.value === "string" &&
    offered.value !== "" &&
    (offered.layer === "default" || proposerMayComeFrom(offered.layer))
  ) {
    return Object.freeze({ harness: offered.value, from: offered.layer });
  }
  if (request.shippedDefaultApplies === true) {
    return Object.freeze({ harness: SHIPPED_HARNESS, from: "default" as const });
  }
  throw new AbsentProposerError(request.candidates ?? []);
}
