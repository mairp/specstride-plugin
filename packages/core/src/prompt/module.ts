/**
 * T001 of feature 103 — the module group `prompt` of `@specstride/core`
 * (`specs/103-proposer-pass/plan.md`, "Source Code (repository root)").
 *
 * One assembler of the proposer's prompt, the two block sets (`current` and
 * `as-is`) in their fixed order, the byte budget, the cache-stable start, and
 * the per-source context policy carried over from Lisa. The block providers
 * live in `providers/` of this directory.
 *
 * The files `plan.md` assigns to this directory are listed in `FILES` below;
 * the phases after Setup write them.
 *
 * Boundary: `@specstride/contracts` and `@specstride/kernel` only
 * (F100-FR-012), and no writer of the phase gate (F103-FR-028).
 */
import { blockSetsOfAPromptProposerAndCritic } from "@specstride/contracts/enums/all-sets";

/** The directory this module group occupies, relative to the repository root. */
export const DIRECTORY = "packages/core/src/prompt" as const;

/** The feature that owns the module group. */
export const OWNER = "103" as const;

/** The files `plan.md` assigns to the directory, in the order it lists them. */
export const FILES = [
  "assembler.ts",
  "providers/",
  "as-is-set.ts",
  "current-set.ts",
  "context-policy.ts",
] as const;

/** The two block sets of the proposer's prompt (row 121 of annex X §X.6). */
export const BLOCK_SETS = blockSetsOfAPromptProposerAndCritic.members;
