/**
 * T019 — the source `endpoint` (F146-FR-002, F146-FR-006): endpoints.
 *
 * An endpoint becomes a candidate BY THE PRESENCE of the credential
 * variable that its harness descriptor names — the presence question goes
 * to the guarded reader, and the value is never read here. The base
 * address comes from the harness descriptor; any user part of the address
 * is removed, and only scheme, host and path are kept and recorded. The
 * provider is the host of the endpoint (feature 100, annex X §X.9, threat
 * T-14).
 */
import type { GuardedReader } from "../guarded-reader.ts";
import { endpointAddressOf, makeCandidate } from "../candidate.ts";
import type { Candidate, CandidateFinding } from "../types.ts";
import type { LoadedDescriptor } from "../../descriptor/loader.ts";
import { descriptorHashOf } from "../../verify/verify.ts";
import { termsRefOf } from "./binary.ts";

/** The source this reader reads. */
export const ENDPOINT_SOURCE = "endpoint" as const;

/** The credential reference and the detect variables of a descriptor. */
type AuthFields = {
  readonly credential?: unknown;
};
type DetectFields = {
  readonly variables?: unknown;
};

/**
 * The address of an endpoint with the user part removed (F146-FR-006).
 * Exported for the characterization test: `http://user:secret@host/v1?q=1`
 * records as scheme `http`, host `host`, path `/v1` — and nothing of the
 * user part, and no query.
 */
export function addressOfDescriptor(descriptor: {
  readonly endpoint?: unknown;
}): ReturnType<typeof endpointAddressOf> {
  const endpoint: unknown = descriptor.endpoint;
  if (endpoint === null || typeof endpoint !== "object") return null;
  const baseUrl = (endpoint as { baseUrl?: unknown }).baseUrl;
  if (typeof baseUrl !== "string") return null;
  const holder = endpoint as { chatPath?: unknown; modelsPath?: unknown };
  const paths = [holder.chatPath, holder.modelsPath].filter(
    (path): path is string => typeof path === "string",
  );
  return endpointAddressOf(baseUrl, paths);
}

/** The credential variable name of a descriptor, or null. */
export function credentialVariableOf(descriptor: { readonly auth?: unknown }): string | null {
  const auth = descriptor.auth;
  if (auth === null || typeof auth !== "object") return null;
  const credential = (auth as AuthFields).credential;
  if (typeof credential !== "string") return null;
  // A reference of the form `env:<name>`; the name is what presence asks.
  const at = credential.indexOf(":");
  if (at < 0) return null;
  const scheme = credential.slice(0, at);
  if (scheme !== "env") return null;
  return credential.slice(at + 1);
}

/** The reader of the source `endpoint`. */
export async function readEndpointSource(deps: {
  readonly reader: GuardedReader;
  readonly descriptors: readonly LoadedDescriptor[];
}): Promise<{
  readonly candidates: readonly Candidate[];
  readonly findings: readonly CandidateFinding[];
}> {
  const candidates: Candidate[] = [];
  const findings: CandidateFinding[] = [];
  for (const entry of deps.descriptors) {
    const descriptor = entry.descriptor;
    const id = descriptor.id;
    if (typeof id !== "string") continue;
    const kind = String(descriptor.kind ?? "unknown");
    // A command-line harness is not an endpoint.
    if (kind === "cli") continue;
    const endpoint = addressOfDescriptor(descriptor as { readonly endpoint?: unknown });
    if (endpoint === null) continue;
    // The candidate exists BY THE PRESENCE of the credential variable the
    // descriptor names, or of the detect variable it names (the pin of the
    // conformance fixture of T002 fixes which detect variable that is). The
    // credential field stays `unprobed` unless the credential variable
    // itself was found present: the yes/no of the credential-presence step
    // of the ladder is not this source's to answer.
    const variable = credentialVariableOf(descriptor);
    let credential: Candidate["credential"] = "unprobed";
    let present = false;
    if (variable !== null) {
      const presence = await deps.reader.isVariableSet(variable);
      if (presence.outcome === "present") {
        present = true;
        credential = "yes";
      }
    }
    if (!present) {
      const detect = (descriptor.detect ?? {}) as DetectFields;
      const variables = Array.isArray(detect.variables) ? detect.variables : [];
      for (const name of variables) {
        if (typeof name !== "string") continue;
        const presence = await deps.reader.isVariableSet(name);
        if (presence.outcome === "present") {
          present = true;
          break;
        }
      }
    }
    if (!present) continue;
    candidates.push(
      makeCandidate({
        id,
        sources: [ENDPOINT_SOURCE],
        origin: descriptor.origin,
        kind,
        endpoint,
        provider: endpoint.host,
        descriptorHash: descriptorHashOf(descriptor),
        credential,
        termsRef: termsRefOf(descriptor),
      }),
    );
  }
  return { candidates, findings };
}
