/**
 * The default registries validation asks (EP-19; F107-FR-014, F107-FR-016).
 *
 * The stage kinds and the precondition checks of the product, as the two open
 * registries of feature 123 hold them. Validation asks a registry, never a
 * switch over a name (annex F §F.7): a kind or a check no registry holds
 * makes the launch contract invalid (exit 20).
 */
import type { StageKindOperations } from "../kinds/registry.ts";
import { BUILTIN_CHECKS } from "../checks/builtin.ts";
import { SPECSTRIDE_STAGE_KIND } from "./draft/complete.ts";

/**
 * The stage kinds of the product. The launch contract of this feature writes
 * stages of the one kind `specstride`; the registry is open, and a host
 * package may register more through the composition root.
 */
export const DEFAULT_STAGE_KINDS: Readonly<Record<string, StageKindOperations>> = {
  [SPECSTRIDE_STAGE_KIND]: {
    validate: () => [],
    run: () => ({ exitCode: 0, signal: null, timedOut: false }),
    evaluate: async () => false,
  } as never,
};

/** The precondition and postcondition checks of the product (§R.3). */
export const DEFAULT_CHECKS = BUILTIN_CHECKS;
