/**
 * T023 — the rule of the context window (F146-FR-016).
 *
 * The window of a model is taken in this order: the value the consumer
 * DECLARED, the value of the MODEL-LIST endpoint (the step `metadata`,
 * the source `gateway`), the table of the TESTED HARNESS ADAPTER (the
 * source `harness-adapter`), the CATALOGUE (the step `catalogue`, the
 * logical name `package:catalogue`).
 *
 * Where the declared window and the effective window (the window of the
 * first later source in this order that gives one) differ, the SMALLER is
 * used. A window from the catalogue is REDUCED by the safety margin of
 * row 89 (`critic.catalogueWindowMargin`, 20 per cent) before it is used.
 * A window no source gives stays NULL: there is NO DEFAULT WINDOW
 * (DV-106).
 */
import type { SourceOfDiscovery } from "./types.ts";

/** The requirement this module carries. */
export const WINDOW_RULE_REQUIREMENT = "F146-FR-016" as const;

/** The register row the margin comes from (row 89 of annex X §X.7). */
export const CATALOGUE_MARGIN_CONFIG_KEY = "critic.catalogueWindowMargin" as const;

/** The margin, 20 per cent (DV-049). The owner of the critic owns the key. */
export const CATALOGUE_WINDOW_MARGIN_PERCENT = 20 as const;

/**
 * The source a resolved window names. Every member of the closed set of
 * sources of discovery, plus `catalogue`: the catalogue is a step of the
 * ladder and a logical name, not one of the seven sources, and the record
 * says what is true — the window came from the catalogue.
 */
export type WindowSource = SourceOfDiscovery | "catalogue";

/** A resolved window: tokens, source, and whether the margin was applied. */
export type ResolvedWindow = {
  readonly tokens: number;
  readonly source: WindowSource;
  readonly marginApplied: boolean;
};

/** What the rule is handed: at most one value per source of the order. */
export type WindowInputs = {
  /** The value the consumer declared (the descriptor or the declaration). */
  readonly declared?: number | null;
  /** The value of the model-list endpoint (the step `metadata`). */
  readonly metadata?: number | null;
  /** The value of the table of the tested harness adapter. */
  readonly adapter?: number | null;
  /** The raw value of the catalogue; the margin is applied here, once. */
  readonly catalogue?: number | null;
  /** The margin in per cent; 20 by default (row 89). */
  readonly marginPercent?: number;
};

/** Reduce a catalogue window by the margin, rounded DOWN (never up). */
export function applyMargin(
  tokens: number,
  percent: number = CATALOGUE_WINDOW_MARGIN_PERCENT,
): number {
  return Math.floor((tokens * (100 - percent)) / 100);
}

/**
 * Resolve the window. Returns null where no source of the order gives a
 * window: no default is ever used (F146-FR-016).
 */
export function resolveWindow(input: WindowInputs): ResolvedWindow | null {
  const marginPercent = input.marginPercent ?? CATALOGUE_WINDOW_MARGIN_PERCENT;
  // The effective window: the first later source that gives one.
  if (input.metadata !== undefined && input.metadata !== null) {
    return smallerOfDeclared(input.declared, {
      tokens: input.metadata,
      source: "gateway",
      marginApplied: false,
    });
  }
  if (input.adapter !== undefined && input.adapter !== null) {
    return smallerOfDeclared(input.declared, {
      tokens: input.adapter,
      source: "harness-adapter",
      marginApplied: false,
    });
  }
  if (input.catalogue !== undefined && input.catalogue !== null) {
    return smallerOfDeclared(input.declared, {
      tokens: applyMargin(input.catalogue, marginPercent),
      source: "catalogue",
      marginApplied: true,
    });
  }
  // No later source: the declared window alone, where the consumer gave one.
  if (input.declared !== undefined && input.declared !== null) {
    return { tokens: input.declared, source: "declared", marginApplied: false };
  }
  return null;
}

/** Where the declared window and the effective one differ, the smaller wins. */
function smallerOfDeclared(
  declared: number | null | undefined,
  effective: ResolvedWindow,
): ResolvedWindow {
  if (declared === undefined || declared === null) return effective;
  if (declared < effective.tokens) {
    return { tokens: declared, source: "declared", marginApplied: false };
  }
  return effective;
}
