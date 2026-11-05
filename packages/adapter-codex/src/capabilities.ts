/**
 * The capabilities of the Codex adapter (F131-FR-004), as code hooks over the
 * descriptor data of `data/descriptor.json`.
 *
 * The map itself is the seam's (`buildCapabilityMap` of the harness port);
 * this module adds what only a tested harness adapter knows: the identity of
 * the provider and model for the diversity test, the cost class per auth
 * tier, and the `betweenPasses` directive, which returns `continue` —
 * the context is carried by continuation by session id.
 */

import { buildCapabilityMap } from "@specstride/harness";
import { PROVIDER_ID } from "./index.ts";
import { formARiskStatement } from "./critic-readonly.ts";

/** The capability map the seam builds, as this module returns it. */
export type CodexCapabilityMap = ReturnType<typeof buildCapabilityMap>;

/** What the detection input of the seam carries, as this module passes it. */
export type CodexDetectionInput = Parameters<typeof buildCapabilityMap>[1];

/** The shape of `data/descriptor.json` as the capability hooks read it. */
export type CodexDescriptor = {
  readonly id: string;
  readonly provider: { readonly id: string };
  readonly auth: { readonly tiers: readonly number[] };
  readonly cost?: { readonly classes?: Readonly<Record<string, string>> } | null;
  readonly containment?: { readonly ceiling?: string } | null;
  readonly continuation?: { readonly supported?: boolean } | null;
  readonly concurrentSessions?: unknown;
  readonly spendLimit?: unknown;
  readonly transports?: readonly string[];
  readonly versionRange?: string;
  readonly verifiedOn?: string;
  readonly [key: string]: unknown;
};

/** The directive `betweenPasses` returns on every pass (F131-FR-004). */
export const BETWEEN_PASSES_DIRECTIVE = "continue" as const;

/** The identity of a critic-class call, for the diversity test (FR-040). */
export type CriticIdentity = {
  readonly provider: string;
  /** The model id the call sends, or null where it sends none. */
  readonly model: string | null;
};

/** The identity of the provider, and of the model where configuration sets one. */
export function criticIdentity(model: string | null): CriticIdentity {
  return { provider: PROVIDER_ID, model };
}

/** The cost class at one auth tier: `subscription` at 1, `metered` at 2. */
export function costClassAtTier(
  descriptor: CodexDescriptor,
  tier: 1 | 2,
): "subscription" | "metered" {
  const fromDescriptor = descriptor.cost?.classes?.[String(tier)];
  if (fromDescriptor === "subscription" || fromDescriptor === "metered") return fromDescriptor;
  return tier === 1 ? "subscription" : "metered";
}

/**
 * F131-FR-004 — the capability map of the adapter. Every capability carries
 * its provenance or is null; `concurrentSessions`, the spending limit and the
 * model-tier ladder are null; a capability no run has shown is `unverified`.
 */
export function codexCapabilities(
  descriptor: CodexDescriptor,
  detection: CodexDetectionInput = {},
): CodexCapabilityMap {
  return buildCapabilityMap(
    {
      origin: "adapter",
      versionRange: descriptor.versionRange ?? null,
      verifiedOn: descriptor.verifiedOn ?? null,
      containmentCeiling: descriptor.containment?.ceiling
        ? { level: descriptor.containment.ceiling, provenance: "adapter" }
        : null,
      continuation: descriptor.continuation ?? null,
      modelTierLadder: null,
      usageSource: null,
      memory: (descriptor.memory as { native?: boolean; switchOff?: unknown } | null) ?? null,
      roles: (descriptor.roles as Record<string, unknown> | null) ?? null,
      models: null,
      // The data model fixes both to null: they are null in descriptor.json.
      concurrentSessions: null,
      spendLimit: null,
      transports: descriptor.transports ?? null,
    },
    detection,
  );
}

/**
 * F131-FR-023 — what `capabilities` reports for the form (a) critic: the
 * stated exception to Principles III and IX and its residual risk. The
 * report takes the descriptor's own statement where it carries one, so the
 * data and the code cannot drift apart unnoticed.
 */
export function criticFormARiskReport(descriptor: CodexDescriptor): {
  readonly form: "readonly-sandbox";
  readonly exception: string;
  readonly residualRisk: string;
  readonly ruling: string;
  readonly threat: string;
  readonly source: "descriptor" | "adapter";
} {
  const roles = descriptor.roles as
    { critic?: { forms?: Record<string, Record<string, unknown>> } } | undefined;
  const forms = roles?.critic?.forms?.["readonly-sandbox"];
  const statement = formARiskStatement();
  return {
    form: "readonly-sandbox",
    exception: typeof forms?.["exception"] === "string" ? forms["exception"] : statement.exception,
    residualRisk:
      typeof forms?.["residualRisk"] === "string" ? forms["residualRisk"] : statement.residualRisk,
    ruling: typeof forms?.["ruling"] === "string" ? forms["ruling"] : statement.ruling,
    threat: typeof forms?.["threat"] === "string" ? forms["threat"] : statement.threat,
    source: typeof forms?.["residualRisk"] === "string" ? "descriptor" : "adapter",
  };
}
