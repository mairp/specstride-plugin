/**
 * T099 — the interface types of EP-02, the harness port, from
 * `contracts/extension-points/EP-02.harness.json` and annex C, §C.1
 * (F100-FR-076 to F100-FR-083).
 *
 * `specstride.harness/1`; the harness descriptor carries its own version
 * field, `descriptorVersion: 1` (§C.2). The core sees only this port and
 * never tests a harness name (F100-FR-023).
 */
import type { ImplementationClass } from "./extension-point.ts";

/** The id of the point (annex A, §A.4). */
export const POINT_ID = "specstride.harness/1" as const;
export const EP = "EP-02" as const;
export const ANNEX_SECTION = "annex C, §C.1" as const;
/** The descriptor has a version field of its own (§C.2). */
export const DESCRIPTOR_VERSION = 1 as const;

/** F100-FR-076 — the eight operations of the port, and no other. */
export const OPERATIONS = [
  "detect",
  "capabilities",
  "preflight",
  "startPass",
  "complete",
  "stop",
  "betweenPasses",
  "classify",
] as const;
export type HarnessOperation = (typeof OPERATIONS)[number];

/** F100-FR-076 — the two capability levels of a harness. */
export const CAPABILITY_LEVELS = ["proposer", "completion"] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

/** F100-FR-077 — the provenance every capability value carries, or null. */
export const CAPABILITY_PROVENANCE = ["declared", "probed", "adapter", "catalogue"] as const;
export type CapabilityProvenance = (typeof CAPABILITY_PROVENANCE)[number];

/** One capability value with its provenance; `null` where the value is unknown. */
export type CapabilityValue<T> = {
  readonly value: T | null;
  readonly provenance: CapabilityProvenance | null;
};

/** F100-FR-077 — a capability no run has shown is reported as `unverified`. */
export const UNSHOWN_CAPABILITY_REPORT = "unverified" as const;

/**
 * F100-FR-077 — where a declared and an effective context window differ, the
 * smaller is used.
 */
export function contextWindowInForce(
  declared: number | null,
  effective: number | null,
): number | null {
  if (declared === null) return effective;
  if (effective === null) return declared;
  return Math.min(declared, effective);
}

/** F100-FR-081 — the closed set of transports. */
export const TRANSPORTS = ["subprocess", "sdk-in-process", "direct-call"] as const;
export type Transport = (typeof TRANSPORTS)[number];

/** The containment levels a harness adapter may declare as its ceiling (§C.15). */
export const CONTAINMENT_LEVELS = ["C0", "C1", "C2", "C3"] as const;
export type ContainmentLevel = (typeof CONTAINMENT_LEVELS)[number];

/** The closed vocabulary of failures under "Errors" of §C.1. */
export const FAILURES = [
  "authentication_failed",
  "rate_limited",
  "quota_exhausted",
  "context_window_exceeded",
  "transport_failed",
  "agent_failure",
  "capability_absent",
  "critic_not_toolless",
] as const;
export type HarnessFailure = (typeof FAILURES)[number];

/** Unknown-value rule of §C.1: an unknown failure is `agent_failure`. */
export const FAILURE_WHEN_UNKNOWN: HarnessFailure = "agent_failure";

/** The one failure that halts the run: engine exit 3, stop reason `critic_config`. */
export const FAILURE_THAT_HALTS_THE_RUN: HarnessFailure = "critic_not_toolless";
export const HALT_EXIT_CODE = 3 as const;
export const HALT_STOP_REASON = "critic_config" as const;

/** The result of `detect` (§C.1, Outputs). */
export type DetectResult = {
  readonly present: boolean;
  readonly version: string | null;
  readonly configurationHomeExists: boolean;
};

/** The map of capabilities `capabilities` returns (§C.1, Outputs). */
export type Capabilities = {
  readonly containmentCeiling: CapabilityValue<ContainmentLevel>;
  readonly continuation: CapabilityValue<boolean>;
  readonly modelTierLadder: CapabilityValue<readonly string[]>;
  readonly usageSource: CapabilityValue<string>;
  readonly nativeMemorySwitch: CapabilityValue<string>;
  readonly toolLessMode: CapabilityValue<boolean>;
  readonly readOnlyCriticMode: CapabilityValue<boolean>;
  readonly contextWindow: CapabilityValue<number>;
  readonly concurrentSessions: CapabilityValue<number>;
  readonly processSpendingLimit: CapabilityValue<boolean>;
  readonly transports: CapabilityValue<readonly Transport[]>;
};

/** The session directive of `startPass` (§C.1, Inputs). */
export type SessionDirective =
  | { readonly kind: "fresh"; readonly sessionId?: string }
  | { readonly kind: "continue"; readonly sessionId: string };

/** The inputs of `startPass` (§C.1, Inputs). */
export type StartPassInput = {
  readonly promptReference: string;
  readonly workingDirectory: string;
  readonly session: SessionDirective;
  readonly model: string;
  readonly modelTierOrEffort: string;
  readonly containment: ContainmentLevel;
  readonly writeRoot: string;
  readonly environmentAllowList: readonly string[];
  readonly timeLimitMs: number;
  readonly traceParent?: string;
  readonly transport: Transport;
  /** Only where the harness adapter declares that capability. */
  readonly processSpendingLimit?: number;
};

/** The handle `startPass` returns (§C.1, Outputs). */
export type PassHandle = {
  readonly pid: number;
  readonly startTime: string;
  readonly stream: AsyncIterable<string>;
  readonly sessionId: string;
};

/** The form of the `completion` level (§C.3). */
export const COMPLETION_FORMS = ["tool-less", "read-only-tools"] as const;
export type CompletionForm = (typeof COMPLETION_FORMS)[number];

/** The inputs of `complete` (§C.1, Inputs). */
export type CompleteInput = {
  readonly prompt: string;
  readonly model: string;
  readonly outputCap: number;
  readonly budgetCap: number;
  readonly form: CompletionForm;
  /** For the tool-less form: an empty working directory. */
  readonly emptyWorkingDirectory?: string;
  /** For the form with read-only tools: the working tree and the withheld paths of §C.4. */
  readonly workingTree?: string;
  readonly withheldPaths?: readonly string[];
  /** The minted session id; every critic-class call is a fresh session. */
  readonly sessionId: string;
};

/** The facts of the initial record `complete` returns (§C.1, Outputs). */
export type InitialRecordFacts = {
  readonly tools: readonly string[];
  readonly sessionId: string;
  readonly sandboxMode: string | null;
  readonly networkState: string | null;
};

/** The output of `complete` (§C.1, Outputs). */
export type CompleteResult = {
  readonly reply: string;
  readonly usage: Readonly<Record<string, number>>;
  readonly initialRecord: InitialRecordFacts;
};

/** The three ways to stop a pass (§C.1, Inputs). */
export const STOP_KINDS = ["polite", "terminate", "kill"] as const;
export type StopKind = (typeof STOP_KINDS)[number];

/** The closed set `betweenPasses` returns (§C.1, Outputs). */
export type BetweenPassesOutcome =
  { readonly outcome: "continue" } | { readonly outcome: "stop"; readonly result: 4 | 7 };

/** The closed set of results of `betweenPasses`, as literals. */
export const BETWEEN_PASSES_OUTCOMES = ["continue", "stop:4", "stop:7"] as const;

/** What `classify` is handed (§C.1, Inputs). */
export type ClassifyInput = {
  readonly streamRecord?: unknown;
  readonly status?: { readonly code: number; readonly headers: Readonly<Record<string, string>> };
  readonly bodyCode?: string;
  readonly exitCode?: number;
  readonly errorText?: string;
};

/** The typed failure `classify` returns, which the quota classifier refines. */
export type TypedFailure = {
  readonly failure: HarnessFailure;
  readonly detail?: string;
};

/** The role a `preflight` is asked about. Roles are an open set (§C.1). */
export type Role = string;

/** The result of `preflight`: never a paid call (§C.1, Outputs). */
export type PreflightResult = {
  readonly credentialPresent: boolean;
  readonly refused: boolean;
  readonly reason?: string;
};

/**
 * F100-FR-076 — the harness port. An implementation of the class
 * `first-party` offers these eight operations; a descriptor-driven harness
 * runs on the generic harness adapter.
 */
export type HarnessPort = {
  detect(): Promise<DetectResult>;
  capabilities(detected: DetectResult): Promise<Capabilities>;
  preflight(role: Role): Promise<PreflightResult>;
  startPass(input: StartPassInput): Promise<PassHandle>;
  complete(input: CompleteInput): Promise<CompleteResult>;
  stop(handle: PassHandle, kind: StopKind): Promise<boolean>;
  betweenPasses(
    handle: PassHandle,
    result: unknown,
    workingDirectory: string,
  ): Promise<BetweenPassesOutcome>;
  classify(seen: ClassifyInput): TypedFailure;
};

/** The class of every Wave 1 implementation of this point (annex A, §A.4). */
export const WAVE_1_CLASS: ImplementationClass = "first-party";

/**
 * "Failure of an implementation" of §C.1, as data: the plainer path each
 * operation takes when the implementation fails.
 */
export const FAILURE_PATHS: Readonly<Record<HarnessOperation, string>> = Object.freeze({
  detect: "the harness is absent from the registry, with a doctor finding",
  capabilities: "the harness is absent from the registry, with a doctor finding",
  preflight: "for a role in use, the launch is refused",
  startPass: "a pass that ended with an error, by the existing breakers",
  complete: "no verdict; scored as the baseline scores a transport error of the critic",
  stop: "the caller falls back to the next stronger kind of stop",
  betweenPasses: "`continue`",
  classify: "`agent_failure`",
});

/** F100-FR-078 — where the proposer may come from, and nowhere else. */
export const PROPOSER_SOURCES = [
  "flag",
  "environment",
  "configuration",
  "shipped-default",
] as const;

/** F100-FR-078 — discovery never changes the proposer. */
export const DISCOVERY_CHANGES_THE_PROPOSER = false as const;

/** F100-FR-079 — the environment of every call is this allow-list and no more. */
export const ENVIRONMENT_ALLOW_LIST_HEADS = [
  "the search path",
  "the locale",
  "the home or its overlay",
  "the harness's own auth variables",
  "what the descriptor names",
] as const;

/** F100-FR-080 — an executable is refused where it lies in one of these places. */
export const EXECUTABLE_REFUSED_WHERE = [
  "inside the workspace",
  "in a directory that everyone may write",
] as const;

/** F100-FR-082 — harness-native memory per role. */
export const NATIVE_MEMORY_FOR_A_CRITIC_CLASS_CALL = "off" as const;
export const NATIVE_MEMORY_FOR_THE_PROPOSER_BY_DEFAULT = "off" as const;

/** F100-FR-083 — the eight occasions that each start a fresh session. */
export const OCCASIONS_OF_A_FRESH_SESSION = [
  "a new phase attempt",
  "a critic-class call",
  "a relaunch",
  "a kill by a watchdog",
  "the second repair of a unit",
  "an escalation",
  "a change of configuration",
  "the first pass of the main line after a parallel group was applied",
] as const;
