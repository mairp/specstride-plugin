// T058 (F116-FR-016) — the builder offered to a loop layer for its call point
// `contributeCriticInput` (annex D §D.1 of feature 100), through the engine.
// The layer returns the rows of the fact block, or `none`; the engine hands
// this surface over as one of the services of annex D §D.1 ("Inputs").
import { buildFactBlock, type FactBlock, type FactBlockInput } from "./build.ts";
export { buildFactBlock, type FactBlock, type FactBlockInput } from "./build.ts";
export * from "./tasks.ts";
export * from "./facts.ts";
export * from "./excluded.ts";

export interface CriticInput {
  /** The rows of the fact block, or `null` for `none` (§D.1, call point 6). */
  block: FactBlock | null;
}

/** The call point `contributeCriticInput`: the block, or `none`. */
export function contributeCriticInput(state: FactBlockInput): CriticInput {
  return { block: buildFactBlock(state) };
}

/** The services this feature offers at the call points of annex D §D.1. */
export const contributions = { contributeCriticInput } as const;
