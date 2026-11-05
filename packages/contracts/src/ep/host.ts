/**
 * T157 — the interface types of EP-01, the host port, from
 * `contracts/extension-points/EP-01.host.json` and annex H, §H.1
 * (F100-FR-193 to F100-FR-197).
 *
 * `specstride.host/1`. The other half of EP-01, the CLI protocol, is in annex
 * G §G.1 and carries its own integer, 1. A host offers the host skills of the
 * product as a thin layer over the CLI, inside a token budget.
 *
 * The capabilities and their fallbacks are read from
 * `data/host-capabilities.json`, so that the types and the table of the annex
 * cannot drift.
 */
import hostCapabilities from "../../data/host-capabilities.json" with { type: "json" };

export const POINT_ID = "specstride.host/1" as const;
export const EP = "EP-01" as const;
export const ANNEX_SECTION = "annex H, §H.1" as const;
/** The CLI protocol has its own integer (annex G, §G.1). */
export const CLI_PROTOCOL_VERSION = 1 as const;

/** F100-FR-193 — the five operations; `renderStatusHooks` is optional. */
export const OPERATIONS = [
  "describe",
  "renderSkill",
  "renderEntry",
  "renderStatusHooks",
  "evalDriver.run",
] as const;
export type HostOperation = (typeof OPERATIONS)[number];

/** The one optional operation (§H.1, Inputs). */
export const OPTIONAL_OPERATIONS: readonly HostOperation[] = Object.freeze(["renderStatusHooks"]);

/** The errors of §H.1. */
export const ERRORS = ["capability-absent", "budget-exceeded", "protocol-mismatch"] as const;
export type HostError = (typeof ERRORS)[number];

/** The line the shim of a host package prints on a protocol mismatch (§H.1). */
export const PROTOCOL_MISMATCH_LINE =
  "[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch" as const;
export const PROTOCOL_MISMATCH_EXIT_CODE = 4 as const;
/** The shim finds the executable through this variable, then the search path. */
export const EXECUTABLE_VARIABLE = "SPECSTRIDE_BIN" as const;

/** F100-FR-193 — the six capabilities of the table of §H.1. */
export const CAPABILITIES = [
  "hooks",
  "statusSurface",
  "background",
  "evals",
  "model",
  "stateRootWritable",
] as const;
export type HostCapability = (typeof CAPABILITIES)[number];

const BACKTICKED = /`([^`]+)`/;
type RawCapability = { Capability: string; Values: string; "Fallback when absent": string };

/** One row of the capability table of §H.1. */
export type CapabilityRow = {
  readonly capability: HostCapability;
  readonly values: string;
  readonly fallbackWhenAbsent: string;
};

/** The six rows of the capability table, in the order of the annex. */
export const capabilityRows: readonly CapabilityRow[] = Object.freeze(
  (hostCapabilities as { capabilities: RawCapability[] }).capabilities.map((row) =>
    Object.freeze({
      capability: (BACKTICKED.exec(row.Capability)?.[1] ?? row.Capability) as HostCapability,
      values: row.Values,
      fallbackWhenAbsent: row["Fallback when absent"],
    }),
  ),
);

/** F100-FR-193 — the declared fallback of an absent capability. */
export function fallbackOf(capability: HostCapability): string {
  const row = capabilityRows.find((r) => r.capability === capability);
  if (row === undefined) {
    throw new Error(`annex H §H.1 holds no capability \`${capability}\``);
  }
  return row.fallbackWhenAbsent;
}

/** What `describe` returns: the capabilities of the host (§H.1, Outputs). */
export type HostDescription = {
  /** The naming rule of skills and the cap of a description. */
  readonly skillNaming: { readonly rule: string; readonly descriptionCap: number };
  readonly hooks: readonly string[] | null;
  readonly background: string | null;
  readonly statusSurface: string | null;
  readonly evals: string | null;
  readonly packagingForm: string;
  readonly stateRootWritable: boolean;
  readonly model: boolean;
};

/** One skill source `renderSkill` is handed (§H.1, Inputs). */
export type SkillSource = {
  readonly logicalId: string;
  readonly body: string;
  readonly references: readonly { readonly path: string; readonly readWhen: string }[];
  readonly budget: number;
};

/** F100-FR-194 — the logical ids of the host skills, and the doctor skill. */
export const HOST_SKILL_IDS = ["specstride-run", "specstride-reverse"] as const;
export const DOCTOR_SKILL_ID = "specstride-doctor" as const;

/** One artifact a host package renders. */
export type HostArtifact = {
  readonly path: string;
  readonly bytes: number;
  readonly content: string;
};

/** One case of a suite of trigger cases, and its result (§H.1). */
export type TriggerCase = {
  readonly id: string;
  readonly prompt: string;
  readonly expected: string;
};
export type TriggerResult = {
  readonly id: string;
  readonly matched: boolean;
  readonly detail: string;
};

/** F100-FR-193 — the host port. */
export type HostPort = {
  describe(): HostDescription;
  renderSkill(source: SkillSource): HostArtifact;
  renderEntry(logicalId: string): string;
  /** Optional: shims that print the precomputed status line without starting the product. */
  renderStatusHooks?(statusLineLogicalName: string): readonly HostArtifact[];
  evalDriver: { run(suite: readonly TriggerCase[]): Promise<readonly TriggerResult[]> };
};

/** "Guarantees of the core" of §H.1, as data. */
export const CORE_GUARANTEES = [
  "every fact a host needs is a line of the CLI",
  "default output is terse and inside the budget; an unchanged state prints nothing on `wait`",
  "no run depends on a host hook, a monitor or a host process",
  "the logical ids of skills and commands are stable; their spelling is the host's",
  "the consumer's comment is stored with its hash before any repository text is printed",
] as const;

/** "Guarantees of an implementation" of §H.1, as data. */
export const IMPLEMENTATION_GUARANTEES = [
  "a host package reads no file of the product and names no path into the product's source or state",
  "it never installs or updates the CLI by itself: it detects, reports and prints the command",
  "it passes the consumer's comment verbatim",
  "it prints the digest verbatim",
  "it launches by invocation and withholds the launch only in the mode `dry-run`",
] as const;

/**
 * "Failure of an implementation" of §H.1 — the plainer path: each optional
 * capability has a declared fallback, and a host package that lacks the
 * capability uses it.
 */
export const FAILURE_PATH =
  "each optional capability has a declared fallback, and a host package that lacks the capability uses it" as const;
export const FAILURE_PATHS: Readonly<Record<HostOperation, string>> = Object.freeze({
  describe: FAILURE_PATH,
  renderSkill: FAILURE_PATH,
  renderEntry: FAILURE_PATH,
  renderStatusHooks: FAILURE_PATH,
  "evalDriver.run": FAILURE_PATH,
});

/**
 * Unknown-value rule of §H.1: an unknown capability in `describe` is ignored;
 * an unknown logical id of a skill or a command fails the build of the host
 * package.
 */
export function unknownCapabilityIsIgnored(capability: string): boolean {
  return !(CAPABILITIES as readonly string[]).includes(capability);
}
export function unknownLogicalIdMessage(logicalId: string): string {
  return (
    `the build of the host package fails: \`${logicalId}\` is no logical id of a ` +
    `skill or a command of the product (annex H, §H.1)`
  );
}

/** F100-FR-196 — invoking `specstride-run` is the consumer's consent to launch. */
export const INVOCATION_IS_CONSENT = true as const;
/** The comment steers the run and can bypass none of these. */
export const THE_COMMENT_CANNOT_BYPASS = ["a launch check", "the terms gate", "a budget"] as const;

/** F100-FR-197 — a host package never installs or updates the CLI unnoticed. */
export const INSTALLS_OR_UPDATES_THE_CLI = false as const;
