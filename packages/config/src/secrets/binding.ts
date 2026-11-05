/**
 * T032 — the bound host of a secret reference (F110-FR-033).
 *
 * "A secret MUST be sent only to the host it is bound to. The binding MUST be
 * made where the reference is declared: for a harness of an endpoint kind, the
 * host of the endpoint of the same entry; for a harness of kind `cli`, the
 * process of that harness only. `boundHost` MUST return that host, or null for
 * the second case. An endpoint that is not encrypted MUST be refused except on
 * the loopback address. The endpoint MUST come from user file, environment or
 * flag only."
 *
 * The binding is a property of the DECLARATION, not of the scheme: the same
 * `env:SPECSTRIDE_KEY` reference bound in two harness entries is two bindings.
 * So the table is built from the declarations and every resolver reads it
 * through `BoundHostLookup`.
 *
 * The three rules of the requirement's second half come from feature 100 and
 * are not restated here: `endpointIsRefused` (a plain endpoint is refused
 * except on the loopback address), `isLoopback` and `secretMayBeSentTo` are the
 * functions of `@specstride/contracts/records/harness-descriptor`, which
 * F100-FR-086 owns.
 */
import {
  CLI_KIND,
  ENDPOINT_KINDS,
  LOOPBACK_HOSTS,
  endpointIsRefused,
  isLoopback,
  secretMayBeSentTo,
} from "@specstride/contracts/records/harness-descriptor";

import type { LayerCode } from "../schema/types.ts";
import type { BoundHostLookup, SecretReference } from "./reference.ts";

export {
  CLI_KIND,
  ENDPOINT_KINDS,
  LOOPBACK_HOSTS,
  endpointIsRefused,
  isLoopback,
  secretMayBeSentTo,
};

/**
 * F110-FR-033, third sentence — `boundHost` of a harness of kind `cli` is
 * `null`: the credential is bound to the process of that harness only, and to
 * no host (assumption CQ-159).
 */
export const BOUND_HOST_OF_A_CLI_HARNESS = null;

/** What the binding of a harness of kind `cli` is, in words (CQ-159). */
export const CLI_BINDING = "the process of that harness only" as const;

/**
 * F110-FR-033, last sentence — the only layers an endpoint may come from. The
 * project file and the launch-contract pin are NOT among them, so a cloned
 * repository cannot point a credential at a host of its choosing.
 */
export const ENDPOINT_LAYERS: readonly LayerCode[] = Object.freeze(["F", "E", "U"]);

/** True where that layer may declare the endpoint of a harness entry. */
export function endpointLayerIsAllowed(layer: LayerCode): boolean {
  return ENDPOINT_LAYERS.includes(layer);
}

/** Why a binding was refused. */
export const BINDING_REFUSAL_REASONS = [
  "no-endpoint",
  "endpoint-layer-not-allowed",
  "endpoint-not-encrypted",
  "unknown-kind",
] as const;
export type BindingRefusalReason = (typeof BINDING_REFUSAL_REASONS)[number];

/**
 * Where a reference is declared: the key that holds it, and the harness entry
 * of the same declaration — its id, its kind, and, for an endpoint kind, the
 * endpoint and the layer the endpoint came from.
 */
export interface SecretDeclaration {
  /** The configuration key that holds the reference (`roles.critic.credential`). */
  readonly key: string;
  /** The reference as it was written. */
  readonly reference: SecretReference;
  /** The id of the harness entry of the same declaration. */
  readonly harnessId: string;
  /** The kind of that entry: an endpoint kind, or `cli`. */
  readonly kind: string;
  /** The endpoint of the SAME entry, for an endpoint kind. */
  readonly endpoint?: string | undefined;
  /** The layer the endpoint came from (F110-FR-033, last sentence). */
  readonly endpointLayer?: LayerCode | undefined;
}

/** What the binding of one declaration is. */
export interface BoundHostDecision {
  /** The host the secret may be sent to, or `null` for a `cli` harness. */
  readonly host: string | null;
  /** True where the declaration is refused and no secret may be sent at all. */
  readonly refused: boolean;
  /** Why it was refused. */
  readonly reason?: BindingRefusalReason | undefined;
  /** The refusal in words, naming the entry and the address. */
  readonly message?: string | undefined;
}

/** True for a kind of §C.2 to which an endpoint and an auth scheme apply. */
export function isEndpointKind(kind: string): boolean {
  return (ENDPOINT_KINDS as readonly string[]).includes(kind);
}

/**
 * F110-FR-033, second and third sentences — the binding of one declaration.
 *
 * For a harness of an endpoint kind: the host of the endpoint of the same
 * entry, refused when the entry declares none, when the endpoint came from a
 * layer that may not declare it, or when the address is plain and is not the
 * loopback address. For a harness of kind `cli`: `null`.
 */
export function boundHostOfDeclaration(declaration: SecretDeclaration): BoundHostDecision {
  if (declaration.kind === CLI_KIND) {
    return Object.freeze({ host: BOUND_HOST_OF_A_CLI_HARNESS, refused: false });
  }
  if (!isEndpointKind(declaration.kind)) {
    return Object.freeze({
      host: null,
      refused: true,
      reason: "unknown-kind" as const,
      message:
        `the harness entry \`${declaration.harnessId}\` of the key ` +
        `\`${declaration.key}\` has the kind \`${declaration.kind}\`, which is ` +
        `neither an endpoint kind (${ENDPOINT_KINDS.join(", ")}) nor \`${CLI_KIND}\`, ` +
        `so the host a secret may be sent to cannot be named (F110-FR-033)`,
    });
  }
  const endpoint = declaration.endpoint;
  if (endpoint === undefined || endpoint === "") {
    return Object.freeze({
      host: null,
      refused: true,
      reason: "no-endpoint" as const,
      message:
        `the harness entry \`${declaration.harnessId}\` of the key ` +
        `\`${declaration.key}\` is of the endpoint kind \`${declaration.kind}\` and ` +
        `declares no endpoint, so the secret is bound to no host (F110-FR-033)`,
    });
  }
  const layer = declaration.endpointLayer;
  if (layer !== undefined && !endpointLayerIsAllowed(layer)) {
    return Object.freeze({
      host: null,
      refused: true,
      reason: "endpoint-layer-not-allowed" as const,
      message:
        `the endpoint of the harness entry \`${declaration.harnessId}\` came from ` +
        `the layer \`${layer}\`; an endpoint may come from the user file, the ` +
        `environment or a flag only (${ENDPOINT_LAYERS.join(" ")}; F110-FR-033)`,
    });
  }
  const refusal = endpointIsRefused(endpoint);
  if (refusal.refused) {
    return Object.freeze({
      host: null,
      refused: true,
      reason: "endpoint-not-encrypted" as const,
      message:
        `the endpoint of the harness entry \`${declaration.harnessId}\` is refused: ` +
        `${refusal.reason ?? "the address is not accepted"} (F110-FR-033)`,
    });
  }
  return Object.freeze({ host: new URL(endpoint).hostname, refused: false });
}

/** One refused declaration, as the table reports it. */
export interface RefusedBinding {
  readonly key: string;
  readonly reference: SecretReference;
  readonly harnessId: string;
  readonly reason: BindingRefusalReason;
  readonly message: string;
}

/** The table of bindings a run was launched with (F110-FR-033). */
export interface SecretBindings extends BoundHostLookup {
  /** The declaration of a reference, or `undefined`. */
  declarationOf(reference: SecretReference): SecretDeclaration | undefined;
  /** The decision of a reference, or `undefined` where it was not declared. */
  decisionOf(reference: SecretReference): BoundHostDecision | undefined;
  /**
   * F110-FR-033, first sentence — true only where the reference is declared,
   * the declaration is not refused, and the host is the host it is bound to.
   * A reference bound to a process (`null`) may be sent to NO host.
   */
  mayBeSentTo(reference: SecretReference, host: string): boolean;
  /** Every declaration, in the order it was given. */
  readonly declarations: readonly SecretDeclaration[];
  /** Every refused declaration, for the launch messages. */
  readonly refusals: readonly RefusedBinding[];
}

/**
 * Build the table of bindings from the declarations of a launch. A reference
 * that two entries declare is refused as ambiguous rather than bound to the
 * first host: a secret that is bound to two hosts is bound to neither
 * (F110-FR-033, first sentence).
 */
export function createSecretBindings(declarations: readonly SecretDeclaration[]): SecretBindings {
  const byReference = new Map<string, SecretDeclaration>();
  const decisions = new Map<string, BoundHostDecision>();
  const refusals: RefusedBinding[] = [];
  const ambiguous = new Set<string>();

  for (const declaration of declarations) {
    const seen = byReference.get(declaration.reference);
    if (seen !== undefined && seen.harnessId !== declaration.harnessId) {
      ambiguous.add(declaration.reference);
      refusals.push(
        Object.freeze({
          key: declaration.key,
          reference: declaration.reference,
          harnessId: declaration.harnessId,
          reason: "unknown-kind" as const,
          message:
            `the reference \`${declaration.reference}\` is declared by the harness ` +
            `entries \`${seen.harnessId}\` and \`${declaration.harnessId}\`; a secret ` +
            `bound to two hosts is bound to neither (F110-FR-033)`,
        }),
      );
      continue;
    }
    byReference.set(declaration.reference, declaration);
    const decision = boundHostOfDeclaration(declaration);
    decisions.set(declaration.reference, decision);
    if (decision.refused) {
      refusals.push(
        Object.freeze({
          key: declaration.key,
          reference: declaration.reference,
          harnessId: declaration.harnessId,
          reason: decision.reason ?? "unknown-kind",
          message: decision.message ?? "the declaration is refused (F110-FR-033)",
        }),
      );
    }
  }

  return Object.freeze({
    hostOf(reference: SecretReference): string | null {
      if (ambiguous.has(reference)) return null;
      return decisions.get(reference)?.host ?? null;
    },
    declarationOf(reference: SecretReference): SecretDeclaration | undefined {
      return ambiguous.has(reference) ? undefined : byReference.get(reference);
    },
    decisionOf(reference: SecretReference): BoundHostDecision | undefined {
      return ambiguous.has(reference) ? undefined : decisions.get(reference);
    },
    mayBeSentTo(reference: SecretReference, host: string): boolean {
      if (ambiguous.has(reference)) return false;
      const decision = decisions.get(reference);
      if (decision === undefined || decision.refused) return false;
      if (decision.host === null) return false; // bound to a process, not a host
      return secretMayBeSentTo(decision.host, host);
    },
    declarations: Object.freeze([...declarations]),
    refusals: Object.freeze(refusals),
  });
}
