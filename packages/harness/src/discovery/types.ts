/**
 * T008 — the type of a candidate of discovery, and the small types around
 * it (`specs/146-harness-discovery/data-model.md`).
 *
 * Discovery writes no record. Its result is a list of candidates, which
 * becomes the field `harnesses` of the resolved registry (feature 100,
 * annex C §C.6). Every value of a candidate carries its provenance or is
 * null: nothing is guessed.
 */
import type { Existence } from "@specstride/contracts/ep/secret-resolver";
import {
  sourcesOfDiscovery,
  statesOfAHarness,
  stepsOfTheProbeLadder,
} from "@specstride/contracts/enums/all-sets";

/** A source of discovery (row 178 of annex X §X.6). */
export type SourceOfDiscovery = (typeof sourcesOfDiscovery.members)[number];

/** A state of a harness (row 34). */
export type StateOfAHarness = (typeof statesOfAHarness.members)[number];

/** A step of the probe ladder (row 179). */
export type ProbeLadderStep = (typeof stepsOfTheProbeLadder.members)[number];

/**
 * The presence of a credential: `yes`, `no` or `unprobed` — never a value
 * (F146-FR-004). It is the `exists` of the secret resolver (§C.11).
 */
export type CredentialPresence = Existence;

/** Scheme, host and path; never a user part, never a query (F146-FR-006). */
export type EndpointAddress = {
  readonly scheme: string;
  readonly host: string;
  readonly path: string | null;
};

/** A doctor finding a probe left behind (F146-FR-014). */
export type CandidateFinding = {
  /** A stable code of the failure, e.g. `probe-time-limit`. */
  readonly code: string;
  /** What failed, in one line. */
  readonly message: string;
  /** The probe that failed, where the finding comes from a probe. */
  readonly probe?: string;
};

/** One value of `capabilities`: the value, with its provenance and step. */
export type CapabilityValue = {
  readonly value: string;
  /** Where the value was found. */
  readonly source: SourceOfDiscovery;
  /** The step of the probe ladder that read it. */
  readonly ladderStep: ProbeLadderStep;
};

/**
 * The context window of a model and where it came from (F146-FR-016).
 * The source is a member of the closed set of sources of discovery, or
 * `catalogue`: the catalogue is a step of the ladder and the logical name
 * `package:catalogue`, not one of the seven sources, and the record says
 * what is true.
 */
export type CatalogueSource = "catalogue";

export type WindowValue = {
  readonly tokens: number;
  /** The source the window was read from, with its precedence. */
  readonly source: SourceOfDiscovery | CatalogueSource;
  /** True where the safety margin of a catalogue value was applied. */
  readonly marginApplied: boolean;
};

/** A candidate: one entry of the future field `harnesses`. */
export type Candidate = {
  /** Harness id; unique in the resolved registry. */
  readonly id: string;
  /** The sources of discovery that found it; members of row 178. */
  readonly sources: readonly SourceOfDiscovery[];
  /** One of the four states (row 34). */
  readonly state: StateOfAHarness;
  /** Origin of the harness descriptor (closed set 35 of feature 100). */
  readonly origin: string;
  /** Kind of the harness descriptor; an open set. */
  readonly kind: string;
  /** Version the probe read, or null. */
  readonly version: string | null;
  /** Canonical record hash of the harness descriptor, or null. */
  readonly descriptorHash: string | null;
  /** Absolute path of the executable, or null. */
  readonly resolvedPath: string | null;
  /** Scheme, host and path; or null. Never a user part, never a query. */
  readonly endpoint: EndpointAddress | null;
  /** Identity: for an endpoint, the host of the endpoint. */
  readonly provider: string | null;
  /** Capability values, each with provenance and ladder step; or null. */
  readonly capabilities: Readonly<Record<string, CapabilityValue>> | null;
  /** The context window, with its source and its margin; or null. */
  readonly window: WindowValue | null;
  /** `yes`, `no` or `unprobed`; never a value. */
  readonly credential: CredentialPresence;
  /** `provider.termsRef` of the harness descriptor, or null where unknown. */
  readonly termsRef: string | null;
  /** True for an entry of the source `host`: never a candidate for a role. */
  readonly informational: boolean;
  /** Probe failures, as doctor findings. */
  readonly findings: readonly CandidateFinding[];
};
