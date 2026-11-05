/**
 * T019 — the source `gateway` (F146-FR-002, F146-FR-007): gateways.
 *
 * A gateway is found by the presence of the gateway variables of the host,
 * by a harness descriptor that declares one, or by an entry the consumer
 * declared. Discovery queries ONLY its model list — never an endpoint of
 * the gateway that runs a request against a model. Every model the
 * gateway lists is ONE candidate, of an endpoint kind, to be called
 * through the generic harness adapter and never through the CLI of the
 * host.
 */
import type { GuardedReader } from "../guarded-reader.ts";
import { endpointAddressOf, makeCandidate } from "../candidate.ts";
import type { Candidate, CandidateFinding } from "../types.ts";
import { MetadataClient } from "../metadata-client.ts";
import type { LoadedDescriptor } from "../../descriptor/loader.ts";
import { termsRefOf } from "./binary.ts";

/** The source this reader reads. */
export const GATEWAY_SOURCE = "gateway" as const;

/** A gateway the host exposes through variables of the environment. */
export type GatewayVariable = {
  /** The NAME of the variable; the value is never read (F146-FR-004). */
  readonly name: string;
  /** The base address of the gateway, from the descriptor or the host config. */
  readonly baseUrl: string;
  /** The credential reference, or null where the gateway asks none. */
  readonly credentialReference?: string | null;
};

/** A gateway a harness descriptor declares. */
type DescriptorGateway = {
  readonly gateway?: unknown;
  readonly endpoint?: unknown;
  readonly auth?: unknown;
};

/** One gateway to ask, after the presence checks have passed. */
type GatewayToAsk = {
  readonly id: string;
  readonly baseUrl: string;
  readonly modelsPath: string;
  readonly credentialReference: string | null;
  readonly termsRef: string | null;
};

/** The reader of the source `gateway`. */
export async function readGatewaySource(deps: {
  readonly reader: GuardedReader;
  readonly descriptors: readonly LoadedDescriptor[];
  readonly gatewayVariables: readonly GatewayVariable[];
  readonly declaredGateways: readonly GatewayVariable[];
  /** The client of the metadata pass; the only way a request is made. */
  readonly metadata: MetadataClient;
  /** Whether the metadata pass is on; with it off, no request is made. */
  readonly online: boolean;
}): Promise<{
  readonly candidates: readonly Candidate[];
  readonly findings: readonly CandidateFinding[];
  /** How many model lists were asked. A gateway is asked for that only. */
  readonly modelListsAsked: number;
}> {
  const candidates: Candidate[] = [];
  const findings: CandidateFinding[] = [];
  let modelListsAsked = 0;
  const gateways: GatewayToAsk[] = [];

  // Gateways of the host, by the presence of the gateway variable: the
  // presence question only, never the value (F146-FR-004).
  for (const gateway of deps.gatewayVariables) {
    const presence = await deps.reader.isVariableSet(gateway.name);
    if (presence.outcome !== "present") continue;
    gateways.push({
      id: `gateway:${gateway.name.toLowerCase()}`,
      baseUrl: gateway.baseUrl,
      modelsPath: "/v1/models",
      credentialReference: gateway.credentialReference ?? null,
      termsRef: null,
    });
  }
  // Gateways a harness descriptor declares.
  for (const entry of deps.descriptors) {
    const descriptor = entry.descriptor as unknown as DescriptorGateway & {
      readonly id?: unknown;
    };
    if (descriptor.gateway === null || typeof descriptor.gateway !== "object") continue;
    const endpoint = descriptor.endpoint;
    const baseUrl =
      endpoint !== null && typeof endpoint === "object"
        ? (endpoint as { baseUrl?: unknown }).baseUrl
        : undefined;
    if (typeof baseUrl !== "string") continue;
    const modelsPath =
      endpoint !== null &&
      typeof endpoint === "object" &&
      typeof (endpoint as { modelsPath?: unknown }).modelsPath === "string"
        ? (endpoint as { modelsPath: string }).modelsPath
        : "/v1/models";
    const credential =
      descriptor.auth !== null && typeof descriptor.auth === "object"
        ? (descriptor.auth as { credential?: unknown }).credential
        : undefined;
    gateways.push({
      id: String(descriptor.id),
      baseUrl,
      modelsPath,
      credentialReference: typeof credential === "string" ? credential : null,
      termsRef: termsRefOf(descriptor as { readonly provider?: unknown }),
    });
  }
  // Gateways an entry the consumer declared.
  for (const gateway of deps.declaredGateways) {
    gateways.push({
      id: gateway.name,
      baseUrl: gateway.baseUrl,
      modelsPath: "/v1/models",
      credentialReference: gateway.credentialReference ?? null,
      termsRef: null,
    });
  }

  for (const gateway of gateways) {
    // One request per gateway: the model list, and nothing else. With the
    // metadata pass off, no request is made (F146-FR-012) and the gateway
    // yields no model candidates here.
    if (!deps.online) continue;
    const address = endpointAddressOf(gateway.baseUrl, [gateway.modelsPath]);
    if (address === null) {
      findings.push({
        code: "gateway-address-invalid",
        message: `the gateway ${gateway.id} holds no address that can be asked`,
      });
      continue;
    }
    const url = joinUrl(gateway.baseUrl, gateway.modelsPath);
    modelListsAsked += 1;
    const result = await deps.metadata.fetchModelList({
      url,
      credentialReference: gateway.credentialReference,
      // The host the harness descriptor names is the authority of the base
      // address: host and port, exactly what the request is sent to.
      allowedHost: new URL(gateway.baseUrl).host,
    });
    if (result.finding !== null) findings.push(result.finding);
    // Every model the gateway lists is ONE candidate, of an endpoint kind.
    for (const model of result.models) {
      candidates.push(
        makeCandidate({
          id: `${gateway.id}:${model}`,
          sources: [GATEWAY_SOURCE],
          origin: "detected",
          kind: "endpoint",
          endpoint: address,
          provider: address.host,
          credential:
            gateway.credentialReference !== null && result.outcome === "ok" ? "yes" : "unprobed",
          termsRef: gateway.termsRef,
        }),
      );
    }
  }
  return { candidates, findings, modelListsAsked };
}

/** Join a base address and a path, with the user part and query dropped. */
function joinUrl(base: string, path: string): string {
  const parsed = new URL(base);
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  const current = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = `${current}${path.startsWith("/") ? path : `/${path}`}`;
  return parsed.toString();
}
