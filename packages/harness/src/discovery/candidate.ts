/**
 * The builder of a candidate of discovery (T019; data-model.md).
 *
 * Discovery never guesses a value: a candidate holds only what a source
 * read, and every field a source did not read stays null (or `unprobed`
 * for the credential presence). The builder holds that rule in one place,
 * so no source reader can invent a default.
 */
import type { Candidate, EndpointAddress, SourceOfDiscovery, StateOfAHarness } from "./types.ts";

/** What a source reader knows of one harness before the merge. */
export type CandidateSeed = {
  readonly id: string;
  /** The source that found it; a member of the closed set row 178. */
  readonly sources: readonly SourceOfDiscovery[];
  /** The state; `detected` unless the source knows better (F146-FR-017). */
  readonly state?: StateOfAHarness;
  /** The origin of the harness descriptor (closed set 35 of feature 100). */
  readonly origin?: string;
  readonly kind?: string;
  readonly version?: string | null;
  readonly descriptorHash?: string | null;
  readonly resolvedPath?: string | null;
  readonly endpoint?: EndpointAddress | null;
  readonly provider?: string | null;
  readonly capabilities?: Readonly<Record<string, unknown>> | null;
  readonly window?: Candidate["window"];
  /** `yes`, `no` or `unprobed`; never a value (F146-FR-004). */
  readonly credential?: Candidate["credential"];
  /** `provider.termsRef` of the descriptor, or null where unknown. */
  readonly termsRef?: string | null;
  /** True only for an entry of the source `host` (F146-FR-005). */
  readonly informational?: boolean;
  readonly findings?: readonly Candidate["findings"][number][];
};

/**
 * Build a candidate. Every field the seed does not carry stays at its
 * nothing-value: null, `unprobed`, false or the empty list. Discovery
 * marks no candidate a default and picks none for a role: the record
 * holds no field that could carry such a marking.
 */
export function makeCandidate(seed: CandidateSeed): Candidate {
  return {
    id: seed.id,
    sources: [...seed.sources],
    state: seed.state ?? "detected",
    origin: seed.origin ?? "detected",
    kind: seed.kind ?? "unknown",
    version: seed.version ?? null,
    descriptorHash: seed.descriptorHash ?? null,
    resolvedPath: seed.resolvedPath ?? null,
    endpoint: seed.endpoint ?? null,
    provider: seed.provider ?? null,
    capabilities: (seed.capabilities as Candidate["capabilities"]) ?? null,
    window: seed.window ?? null,
    credential: seed.credential ?? "unprobed",
    termsRef: seed.termsRef ?? null,
    informational: seed.informational ?? false,
    findings: [...(seed.findings ?? [])],
  };
}

/**
 * The address of an endpoint with the user part removed (F146-FR-006):
 * only scheme, host and path are kept — never a user part, never a query.
 * Where the base address holds no path of its own, the path is the common
 * prefix of the paths the descriptor names, so the address stays the base.
 */
export function endpointAddressOf(
  base: string,
  namedPaths: readonly string[] = [],
): EndpointAddress | null {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }
  let path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  if (path === "" && namedPaths.length > 0) {
    path = commonPrefixOf(namedPaths.map((p) => p.replace(/\/+$/, "")));
  }
  return { scheme: parsed.protocol.replace(/:$/, ""), host: parsed.hostname, path: path || null };
}

/** The longest common prefix of path segments, or "" where there is none. */
export function commonPrefixOf(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  let segments = paths[0]!.split("/").filter((s) => s.length > 0);
  for (const path of paths.slice(1)) {
    const other = path.split("/").filter((s) => s.length > 0);
    let at = 0;
    while (at < segments.length && at < other.length && segments[at] === other[at]) at += 1;
    segments = segments.slice(0, at);
  }
  const joined = segments.join("/");
  return joined === "" ? "" : `/${joined}`;
}
