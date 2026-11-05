/**
 * T019 — the capability map (F109-FR-004).
 *
 * `capabilities` returns every capability of annex C §C.1 with its provenance
 * (`declared`, `probed`, `adapter`, `catalogue`) or null. The seam never
 * guesses a value. A capability that no run has shown is `unverified`. Where
 * a declared and an effective context window differ, the smaller is used.
 * `concurrentSessions` and the process-level spending limit are null unless a
 * TESTED harness adapter declares them. A harness that does not declare
 * continuation receives the session directive `fresh` on every pass.
 */

import { isTestedHarnessAdapter } from "../registry/unverified.ts";

/** The provenance closed set (row 33 of annex X §X.6). */
export const CAPABILITY_PROVENANCE = ["declared", "probed", "adapter", "catalogue"] as const;
export type CapabilityProvenance = (typeof CAPABILITY_PROVENANCE)[number];

/** The capabilities of annex C §C.1 the `capabilities` operation returns. */
export const CAPABILITY_NAMES = [
  "containmentCeiling",
  "continuation",
  "modelTierLadder",
  "usageSource",
  "memorySwitch",
  "toollessMode",
  "readOnlyCriticMode",
  "contextWindow",
  "concurrentSessions",
  "spendLimit",
  "transports",
] as const;
export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

/** One capability of the map: a value with its provenance, or null. */
export type Capability = {
  readonly value: unknown;
  readonly provenance: CapabilityProvenance | null;
  /** True where no run has shown the capability. */
  readonly unverified: boolean;
};

export type CapabilityMap = Readonly<Record<CapabilityName, Capability | null>>;

/** What the descriptor declares, as far as this module reads it. */
export type DeclaredCapabilities = {
  readonly origin?: string | null;
  readonly versionRange?: string | null;
  readonly verifiedOn?: string | null;
  readonly containmentCeiling?: { readonly level: string; readonly provenance?: string } | null;
  readonly continuation?: { readonly supported?: boolean } | null;
  readonly modelTierLadder?: readonly unknown[] | null;
  readonly usageSource?: unknown;
  readonly memory?: { readonly native?: boolean; readonly switchOff?: unknown } | null;
  readonly roles?: Readonly<Record<string, unknown>> | null;
  readonly models?: {
    readonly contextWindow?: { readonly tokens?: number; readonly source?: string } | null;
  } | null;
  readonly concurrentSessions?: { readonly value: boolean; readonly provenance?: string } | null;
  readonly spendLimit?: { readonly value: unknown; readonly provenance?: string } | null;
  readonly transports?: readonly unknown[] | null;
};

export type DetectionInput = {
  /** The capabilities a run has shown; the rest are `unverified`. */
  readonly shown?: readonly string[];
  /** The context window the run measured, where one was measured. */
  readonly effectiveContextWindowTokens?: number | null;
};

function provenanceOf(raw: unknown): CapabilityProvenance | null {
  // A provenance outside the closed set is read as null (row 33 of annex X §X.6).
  return typeof raw === "string" && (CAPABILITY_PROVENANCE as readonly string[]).includes(raw)
    ? (raw as CapabilityProvenance)
    : null;
}

function capability(
  value: unknown,
  rawProvenance: unknown,
  shown: readonly string[],
  name: CapabilityName,
): Capability | null {
  if (value === undefined || value === null) {
    return null;
  }
  return {
    value,
    provenance: provenanceOf(rawProvenance),
    unverified: !shown.includes(name),
  };
}

/** The session directive a harness receives on every pass (F109-FR-004). */
export type SessionDirective = "fresh" | "continue";

/**
 * A harness that does not declare continuation receives `fresh` on every
 * pass; the context is then carried through files.
 */
export function sessionDirectiveFor(
  descriptor: { readonly continuation?: { readonly supported?: boolean } | null } | null,
): SessionDirective {
  return descriptor?.continuation?.supported === true ? "continue" : "fresh";
}

/**
 * F109-FR-004 — build the capability map of one entry. Nothing is guessed:
 * a capability the descriptor does not declare is null.
 */
export function buildCapabilityMap(
  descriptor: DeclaredCapabilities | null,
  detection: DetectionInput = {},
): CapabilityMap {
  const shown = detection.shown ?? [];
  const nullMap: Record<CapabilityName, Capability | null> = {
    containmentCeiling: null,
    continuation: null,
    modelTierLadder: null,
    usageSource: null,
    memorySwitch: null,
    toollessMode: null,
    readOnlyCriticMode: null,
    contextWindow: null,
    concurrentSessions: null,
    spendLimit: null,
    transports: null,
  };
  if (descriptor === null) {
    return Object.freeze(nullMap);
  }

  const map: Record<CapabilityName, Capability | null> = { ...nullMap };
  map.containmentCeiling = capability(
    descriptor.containmentCeiling?.level,
    descriptor.containmentCeiling?.provenance,
    shown,
    "containmentCeiling",
  );
  map.continuation = capability(
    descriptor.continuation === null || descriptor.continuation === undefined
      ? null
      : descriptor.continuation.supported === true,
    "declared",
    shown,
    "continuation",
  );
  map.modelTierLadder = capability(
    descriptor.modelTierLadder ?? null,
    descriptor.modelTierLadder === undefined ? null : "declared",
    shown,
    "modelTierLadder",
  );
  map.usageSource = capability(
    descriptor.usageSource ?? null,
    descriptor.usageSource === undefined ? null : "declared",
    shown,
    "usageSource",
  );
  map.memorySwitch = capability(
    descriptor.memory?.switchOff ?? null,
    descriptor.memory?.switchOff === undefined ? null : "declared",
    shown,
    "memorySwitch",
  );

  const roles = descriptor.roles ?? {};
  map.toollessMode = capability(
    (roles as Record<string, { toolless?: unknown }>).critic?.toolless ?? null,
    (roles as Record<string, { toolless?: unknown }>).critic?.toolless === undefined
      ? null
      : "declared",
    shown,
    "toollessMode",
  );
  map.readOnlyCriticMode = capability(
    (roles as Record<string, { readOnlyTools?: unknown }>).critic?.readOnlyTools ?? null,
    (roles as Record<string, { readOnlyTools?: unknown }>).critic?.readOnlyTools === undefined
      ? null
      : "declared",
    shown,
    "readOnlyCriticMode",
  );

  // Where a declared and an effective context window differ, the smaller is used.
  const declaredWindow = descriptor.models?.contextWindow?.tokens;
  if (typeof declaredWindow === "number" && declaredWindow > 0) {
    const effective = detection.effectiveContextWindowTokens;
    const tokens =
      typeof effective === "number" && effective > 0
        ? Math.min(declaredWindow, effective)
        : declaredWindow;
    map.contextWindow = {
      value: { tokens, source: descriptor.models?.contextWindow?.source ?? "declared" },
      provenance: "declared",
      unverified: !shown.includes("contextWindow"),
    };
  }

  // `concurrentSessions` and the spending limit are null unless a TESTED
  // harness adapter declares them.
  const tested = isTestedHarnessAdapter(descriptor);
  map.concurrentSessions =
    tested && descriptor.concurrentSessions !== undefined && descriptor.concurrentSessions !== null
      ? capability(
          descriptor.concurrentSessions.value,
          descriptor.concurrentSessions.provenance,
          shown,
          "concurrentSessions",
        )
      : null;
  map.spendLimit =
    tested && descriptor.spendLimit !== undefined && descriptor.spendLimit !== null
      ? capability(
          descriptor.spendLimit.value,
          descriptor.spendLimit.provenance,
          shown,
          "spendLimit",
        )
      : null;

  map.transports = capability(
    descriptor.transports ?? null,
    descriptor.transports === undefined ? null : "declared",
    shown,
    "transports",
  );

  return Object.freeze(map);
}
