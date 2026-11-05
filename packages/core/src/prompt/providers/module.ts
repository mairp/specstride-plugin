/**
 * T001 of feature 103 — the directory `prompt/providers` of
 * `@specstride/core` (`specs/103-proposer-pass/plan.md`, "Source Code
 * (repository root)").
 *
 * One provider per block of the proposer's prompt. A provider returns blocks
 * in the form of annex D §D.5 — id, bytes, hash, writer, `protected`, and
 * `stable` or `volatile` — and the assembler of the directory above
 * concatenates them. The registry of providers is an OPEN set: block ids are
 * open, while the block SETS are closed (row 121 of annex X §X.6).
 *
 * The providers `plan.md` assigns to this directory are listed in `PROVIDERS`
 * below; the phases after Setup write them.
 *
 * Boundary: `@specstride/contracts` and `@specstride/kernel` only
 * (F100-FR-012), and no writer of the phase gate (F103-FR-028) — the feedback
 * provider reads the critic's text as DATA and holds no writer of it.
 */
import type { PromptBlock } from "@specstride/contracts/ep/loop-layer";

/** The directory this module group occupies, relative to the repository root. */
export const DIRECTORY = "packages/core/src/prompt/providers" as const;

/** The feature that owns the module group. */
export const OWNER = "103" as const;

/** The providers `plan.md` names, in the order it lists them. */
export const PROVIDERS = [
  "spec-context",
  "index",
  "handoff",
  "feedback",
  "hint",
  "acceleration",
  "yield-schema",
  "layer-protocol",
  "plugin-protocol",
] as const;

/** The form every provider returns, as annex D §D.5 gives it. */
export type Block = PromptBlock;
