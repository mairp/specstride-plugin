/**
 * T021 — the two passes of discovery, its switches and its result
 * (F146-FR-001, F146-FR-009, F146-FR-011, F146-FR-012).
 *
 * Discovery is a function from the environment to a list of candidates.
 * It has two passes: a PASSIVE pass, which makes no network request and
 * resolves no secret, and a METADATA pass, which makes free read-only
 * GET requests for candidates whose credential reference is known.
 * Discovery never calls a model, never makes a paid call, marks no
 * candidate a default and picks none for a role; every candidate carries
 * `termsRef` from its harness descriptor, null where the terms are
 * unknown (ruling P14).
 *
 * Discovery changes nothing: it writes no file, performs no login,
 * installs nothing and downloads nothing. Its result is the list that
 * enters the field `harnesses` of the resolved registry, which role
 * resolution writes at launch.
 */
import type { Candidate, CandidateFinding } from "./types.ts";
import { GuardedReader } from "./guarded-reader.ts";
import type { ProbeSpawn } from "./probes/runner.ts";
import type { MetadataTraceEntry } from "./metadata-client.ts";
import { MetadataClient } from "./metadata-client.ts";
import { applyPrecedence, type PrecedenceLoser } from "./precedence.ts";
import { loadBundledDescriptors } from "../descriptor/bundled.ts";
import type { LoadedDescriptor } from "../descriptor/loader.ts";
import type { SecretResolver } from "@specstride/contracts/ep/secret-resolver";
import type {
  DiscoveryPrinter,
  GatewayVariableInfo,
  HostEntryReader,
  MetadataFetch,
  RedactorPort,
  TestedAdapter,
} from "./discovery-deps.ts";
import { SHIPPED_TESTED_ADAPTERS, noHostEntries } from "./discovery-deps.ts";
import { readHarnessAdapterSource } from "./sources/harness-adapter.ts";
import { readBinarySource } from "./sources/binary.ts";
import { readConfigHomeSource, supportsCandidate } from "./sources/config-home.ts";
import { readHostSource } from "./sources/host.ts";
import { readEndpointSource } from "./sources/endpoint.ts";
import { readGatewaySource } from "./sources/gateway.ts";
import {
  readDeclaredSource,
  type ConsumerDeclaration,
  type ProjectConfiguration,
} from "./sources/declared.ts";

/** The requirement this module carries. */
export const DISCOVER_REQUIREMENT = "F146-FR-001" as const;

/** The two switches of discovery (F146-FR-012, rows 87 and 88 of §X.7). */
export type DiscoverySwitches = {
  /** `discovery.enabled` — discovery as a whole. */
  readonly discoveryEnabled: boolean;
  /** `discovery.online` — the metadata pass. */
  readonly metadataPassEnabled: boolean;
  /** True under the `parity` profile: both switches are off. */
  readonly parityProfile: boolean;
};

/**
 * The switches of a run. Under the `parity` profile BOTH are off (D-2):
 * a probe would call a stub outside a pass and change a compared surface.
 */
export function discoverySwitches(input: {
  readonly enabled?: boolean;
  readonly online?: boolean;
  /** The profile of the run, e.g. `parity`. */
  readonly profile?: string;
}): DiscoverySwitches {
  const parityProfile = input.profile === "parity";
  if (parityProfile) {
    return { discoveryEnabled: false, metadataPassEnabled: false, parityProfile: true };
  }
  return {
    discoveryEnabled: input.enabled ?? true,
    metadataPassEnabled: input.online ?? true,
    parityProfile: false,
  };
}

/** What a run of discovery answered. Discovery wrote nothing to make it. */
export type DiscoveryResult = {
  readonly candidates: readonly Candidate[];
  readonly findings: readonly CandidateFinding[];
  /** The launch messages the run produced, in the order they were printed. */
  readonly lines: readonly string[];
  /** The candidates that lost the precedence of F146-FR-011. */
  readonly losers: readonly PrecedenceLoser[];
  /** Which passes ran. */
  readonly passes: { readonly passive: boolean; readonly metadata: boolean };
  /** Every request the metadata pass made or refused. Never a credential. */
  readonly requests: readonly MetadataTraceEntry[];
};

/** The dependencies of a run, all handed in by the composition root. */
export type DiscoverDeps = {
  readonly resolver: SecretResolver;
  /** Another guarded reader, for a test; a fresh one by default. */
  readonly reader?: GuardedReader;
  /** Another process primitive for the probes, for a test. */
  readonly spawn?: ProbeSpawn;
  /** Another fetch for the metadata pass, for a test. */
  readonly fetch?: MetadataFetch;
  /** The redactor the resolved credential is registered with. */
  readonly redactor?: RedactorPort;
  /** Where a launch message goes; nothing is printed where it is absent. */
  readonly printer?: DiscoveryPrinter;
  /** The entries the host registers (F146-FR-005). */
  readonly hostEntries?: HostEntryReader;
  /** The tested harness adapters that ship. */
  readonly testedAdapters?: readonly TestedAdapter[];
  /** The entries the consumer declared, from the scopes that are accepted. */
  readonly declarations?: readonly ConsumerDeclaration[];
  /** Project configuration, which is ignored (F146-FR-010). */
  readonly projectConfig?: ProjectConfiguration;
  /** The gateway variables of the host: names and addresses, never values. */
  readonly gatewayVariables?: readonly GatewayVariableInfo[];
  /** Another set of harness descriptors, for a test; the bundled set by default. */
  readonly descriptors?: readonly LoadedDescriptor[];
  /** Run the version probes of the source `binary`; off in the passive pass. */
  readonly runVersionProbes?: boolean;
  /** The switches of the run; computed from the configuration by default. */
  readonly switches?: DiscoverySwitches;
};

/**
 * Run discovery. The passive pass makes no network request and resolves
 * no secret; the metadata pass makes GET requests for the model lists
 * only. With discovery off, only the tested harness adapters and the
 * entries the consumer declared are read, and no probe runs and no
 * request is made (F146-FR-012).
 */
export async function discover(deps: DiscoverDeps): Promise<DiscoveryResult> {
  const switches =
    deps.switches ??
    discoverySwitches({ enabled: true, online: true, profile: process.env.SPECSTRIDE_PROFILE });
  const reader = deps.reader ?? new GuardedReader({ secretResolver: deps.resolver });
  const descriptors = deps.descriptors ?? loadBundledDescriptors().entries;
  const findings: CandidateFinding[] = [];
  const lines: string[] = [];
  const print = (line: string): void => {
    lines.push(line);
    // The line is never printed under the `parity` profile (F146-FR-010).
    if (!switches.parityProfile) deps.printer?.(line);
  };

  // With discovery off, no probe runs and no request is made: only the
  // tested harness adapters and the entries the consumer declared are read.
  const passiveCandidates: Candidate[] = [];
  // The tested harness adapters are read even where discovery is off
  // (F146-FR-012): the list still holds them, and their detection runs the
  // same presence questions and nothing more.
  const adapters = await readHarnessAdapterSource({
    reader,
    adapters: deps.testedAdapters ?? SHIPPED_TESTED_ADAPTERS,
  });
  passiveCandidates.push(...adapters.candidates);
  if (switches.discoveryEnabled) {
    // The passive pass: no network request, no resolved secret.
    const binary = await readBinarySource({
      reader,
      descriptors,
      runVersionProbes: deps.runVersionProbes === true,
      spawn: deps.spawn,
    });
    passiveCandidates.push(...binary.candidates);
    findings.push(...binary.findings);
    const configHome = readConfigHomeSource({ reader, descriptors });
    const endpoints = await readEndpointSource({ reader, descriptors });
    passiveCandidates.push(...endpoints.candidates);
    // A configuration home that exists supports the candidate of its
    // descriptor; it never creates one and never ranks one (F146-FR-002).
    for (const support of configHome.supports) {
      if (!supportsCandidate(support)) continue;
      const candidate = passiveCandidates.find((entry) => entry.id === support.id);
      if (candidate !== undefined && !candidate.sources.includes("config-home")) {
        const mutable = candidate as unknown as { sources: string[] };
        mutable.sources = [...candidate.sources, "config-home"];
      }
    }
    const host = await readHostSource({ hostEntries: deps.hostEntries ?? noHostEntries });
    passiveCandidates.push(...host.candidates);
  }
  const declared = readDeclaredSource({
    declarations: deps.declarations ?? [],
    projectConfig: deps.projectConfig,
  });
  passiveCandidates.push(...declared.candidates);
  // The launch message of an ignored entry: one line, at most 200 bytes.
  // With discovery off nothing is printed, and under `parity` never.
  if (switches.discoveryEnabled) {
    for (const line of declared.lines) print(line);
  }
  findings.push(...declared.findings);

  // The metadata pass: free read-only GET requests, model lists only.
  const requests: MetadataTraceEntry[] = [];
  const metadataCandidates: Candidate[] = [];
  const metadataOn = switches.discoveryEnabled && switches.metadataPassEnabled;
  if (metadataOn) {
    const client = new MetadataClient({
      resolver: deps.resolver,
      fetch: deps.fetch,
      redactor: deps.redactor,
    });
    const gateways = await readGatewaySource({
      reader,
      descriptors,
      gatewayVariables: deps.gatewayVariables ?? [],
      declaredGateways: (deps.declarations ?? []).flatMap((declaration) =>
        declaration.kind === "gateway" && declaration.baseUrl !== undefined
          ? [
              {
                name: declaration.id,
                baseUrl: declaration.baseUrl,
                credentialReference: declaration.credentialReference ?? null,
              },
            ]
          : [],
      ),
      metadata: client,
      online: true,
    });
    metadataCandidates.push(...gateways.candidates);
    findings.push(...gateways.findings);
    requests.push(...client.trace);
  }

  const { candidates, losers } = applyPrecedence([...passiveCandidates, ...metadataCandidates]);
  return {
    candidates,
    findings,
    lines,
    losers,
    passes: { passive: true, metadata: metadataOn },
    requests,
  };
}
