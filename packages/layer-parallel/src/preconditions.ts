/**
 * T042, T043 and T052 — the preconditions of the layer `parallel`, the
 * fallback reason each failing one announces, and what the registry is read
 * for (feature 142, F142-FR-002, F142-FR-003 and F142-FR-020; rules PU-02,
 * PU-18, PU-26, PU-40, PU-80; ruling P2; assumption CQ-183).
 *
 * T042 (F142-FR-002): the layer runs only stacked above `micro`. It is off for
 * the run, announced with its reason in the launch message and in the `[LOOP]`
 * line, when a precondition fails. The reasons are the closed set of row 60:
 * `classic`, `gate-not-executing`, `not-git`, `submodules`, `git-version`,
 * `harness`, `containment`, `no-group`. A failed precondition is a **fallback
 * and never an error**: the run completes as the same run with the option off.
 *
 * T043 (F142-FR-003, ruling P2, CQ-183): groups run only at containment C2 or
 * above. Below C2 the layer is off with the reason `containment`, unless the
 * consumer set `loop.parallel.allow_detect` **in user configuration**. With
 * that key set, groups may run at C0 and C1, and the run record and the
 * `[LOOP]` line say `protection=detect`. The environment, a flag and project
 * configuration must not set the key: a value from one of them is ignored,
 * with a launch message and a doctor warning.
 *
 * T052 (F142-FR-020, PU-40): `concurrentSessions` and the state of the harness
 * are read from the **registry** and from nowhere else. No rule of this
 * feature names a harness: a harness that was discovered or declared, or whose
 * capability is unverified, never runs a group, and the layer is off for the
 * run with the reason `harness`.
 *
 * The module is pure: it reads no file, starts no process and holds no handle.
 * Everything it decides on arrives as a value the engine read for it.
 */
import type { CapabilityValue, ContainmentLevel } from "@specstride/contracts/ep/harness";

import { FALLBACK_REASONS, isFallbackReason } from "./types.ts";
import type { FallbackReason } from "./types.ts";
import { STACKED_ABOVE, UNITS_KEY } from "./register.ts";

/* ================================================================== *
 * 1. The eight preconditions and their reasons (T042, F142-FR-002).
 * ================================================================== */

/**
 * The eight preconditions, in the order they are evaluated, each with the
 * fallback reason of row 60 it announces when it fails. The order is the order
 * of F142-FR-002: the cheapest and most general first, so that a run outside a
 * git work tree says `not-git` and not `harness`.
 */
export const PRECONDITIONS = Object.freeze([
  Object.freeze({
    reason: "classic" as const,
    says: "the loop strategy is not `micro`",
  }),
  Object.freeze({
    reason: "gate-not-executing" as const,
    says: "the verification gate does not execute",
  }),
  Object.freeze({
    reason: "not-git" as const,
    says: "the workspace is not inside a git work tree",
  }),
  Object.freeze({
    reason: "submodules" as const,
    says: "the workspace has submodules",
  }),
  Object.freeze({
    reason: "git-version" as const,
    says: "the installed git is older than what a snapshot needs",
  }),
  Object.freeze({
    reason: "harness" as const,
    says: "the harness adapter is not tested or declares no `concurrentSessions`",
  }),
  Object.freeze({
    reason: "containment" as const,
    says: "the harness cannot enforce containment C2 and `loop.parallel.allow_detect` is not set in user configuration",
  }),
  Object.freeze({
    reason: "no-group" as const,
    says: "the plan holds no group",
  }),
] as const);

/** One precondition, as `PRECONDITIONS` lists it. */
export type Precondition = (typeof PRECONDITIONS)[number];

/** The eight reasons, in the order the preconditions are evaluated. */
export const PRECONDITION_REASONS = Object.freeze(PRECONDITIONS.map((p) => p.reason));

/** The number of preconditions: eight, and row 60 holds exactly eight reasons. */
export const PRECONDITION_COUNT = 8 as const;

/** The least version of git a snapshot needs (PU-02 as R29v amends it, PU-80). */
export const GIT_VERSION_FLOOR = Object.freeze({ major: 2, minor: 38 } as const);

/** The containment a group needs, unless `allow_detect` is set (F142-FR-003). */
export const CONTAINMENT_NEEDED: ContainmentLevel = "C2";

/** The containment levels at which a group runs only with `allow_detect` set. */
export const CONTAINMENT_BELOW_WHAT_IS_NEEDED = Object.freeze(["C0", "C1"] as const);

/** The states of a harness in the registry; only `tested` may run a group (PU-40). */
export const HARNESS_STATES = Object.freeze([
  "tested",
  "declared",
  "discovered",
  "unverified",
] as const);
export type HarnessState = (typeof HARNESS_STATES)[number];

/** The only state of a harness that may run a group (F142-FR-020). */
export const HARNESS_STATE_THAT_MAY_RUN_A_GROUP: HarnessState = "tested";

/* ================================================================== *
 * 2. What the registry is read for (T052, F142-FR-020, PU-40).
 * ================================================================== */

/**
 * The entry of the proposer's harness adapter in the registry, as the engine
 * read it (F142-FR-020). The layer names no harness: it reads the **state** of
 * the adapter and the capability `concurrentSessions`, and nothing beside.
 */
export type HarnessRegistryEntry = {
  /** The state of the adapter in the registry: tested, declared, discovered, unverified. */
  readonly state: string;
  /**
   * The capability `concurrentSessions` of §C.1, exactly as the registry
   * carries it: a value with its provenance, or `undefined` where the adapter
   * declares none.
   */
  readonly concurrentSessions?: CapabilityValue<number>;
  /** The strongest containment the adapter can enforce (annex C §C.15). */
  readonly containmentCeiling?: ContainmentLevel;
  /** True where the adapter declares a process-level spending limit (PU-88). */
  readonly spendLimitDeclared?: boolean;
};

/** What `concurrentSessions` says, read from the registry and from nowhere else. */
export type ConcurrentSessionsReading = {
  /** True where the registry carries the capability with a value above 1. */
  readonly declared: boolean;
  /** The value, or `undefined` where the adapter declares none. */
  readonly value?: number;
  /** Where the value came from: the provenance the registry recorded. */
  readonly provenance?: string | null;
  /** The words the launch message uses. */
  readonly detail: string;
};

/**
 * Read `concurrentSessions` from the registry (T052, F142-FR-020).
 *
 * The capability is read as the registry carries it. A capability no run has
 * shown is reported `unverified` by F100-FR-077, and such a value declares
 * nothing here: `declared` is true only where the registry carries a value of
 * at least 2, because one session at a time is no concurrency.
 */
export function concurrentSessionsOf(entry: HarnessRegistryEntry): ConcurrentSessionsReading {
  const capability = entry.concurrentSessions;
  if (capability === undefined) {
    return Object.freeze({
      declared: false,
      detail: "the registry carries no capability `concurrentSessions` for the adapter",
    });
  }
  const value = capability.value;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 2) {
    return Object.freeze({
      declared: false,
      value: typeof value === "number" ? value : undefined,
      provenance: capability.provenance,
      detail: `the registry carries \`concurrentSessions\`=${String(value)}: fewer than 2 sessions is no concurrency`,
    });
  }
  return Object.freeze({
    declared: true,
    value,
    provenance: capability.provenance,
    detail: `the registry carries \`concurrentSessions\`=${value} with the provenance ${capability.provenance}`,
  });
}

/** The state of the harness, read from the registry (T052, F142-FR-020). */
export function harnessStateOf(entry: HarnessRegistryEntry): HarnessState | "unknown" {
  return (HARNESS_STATES as readonly string[]).includes(entry.state)
    ? (entry.state as HarnessState)
    : "unknown";
}

/** Whether the harness may run a group, and why not where it may not. */
export type HarnessReading = {
  readonly mayRunAGroup: boolean;
  readonly state: HarnessState | "unknown";
  readonly concurrentSessions: ConcurrentSessionsReading;
  readonly detail: string;
};

/**
 * Whether the proposer's harness adapter may run a group (T052, F142-FR-020).
 *
 * Only a **tested** adapter that declares `concurrentSessions` may. An adapter
 * that was discovered or declared, or whose state the registry does not name,
 * may not; nor may a tested one that declares no `concurrentSessions`. Both
 * give the fallback reason `harness`.
 */
export function harnessReading(entry: HarnessRegistryEntry): HarnessReading {
  const state = harnessStateOf(entry);
  const concurrentSessions = concurrentSessionsOf(entry);
  if (state !== HARNESS_STATE_THAT_MAY_RUN_A_GROUP) {
    return Object.freeze({
      mayRunAGroup: false,
      state,
      concurrentSessions,
      detail: `the adapter is \`${state}\` in the registry and not \`tested\`: it never runs a group`,
    });
  }
  if (!concurrentSessions.declared) {
    return Object.freeze({
      mayRunAGroup: false,
      state,
      concurrentSessions,
      detail: concurrentSessions.detail,
    });
  }
  return Object.freeze({
    mayRunAGroup: true,
    state,
    concurrentSessions,
    detail: `the adapter is tested and ${concurrentSessions.detail}`,
  });
}

/* ================================================================== *
 * 3. Containment C2 and `loop.parallel.allow_detect` (T043, F142-FR-003).
 * ================================================================== */

/** The key of ruling P2, a widening key of annex X §X.2. */
export const ALLOW_DETECT_KEY = "loop.parallel.allow_detect" as const;

/** The only place the key is read from (CQ-183, F100-FR-112). */
export const ALLOW_DETECT_IS_READ_FROM = "user configuration" as const;

/** The places a value of the key is ignored from, each with a launch message. */
export const ALLOW_DETECT_IGNORED_FROM = Object.freeze([
  "environment",
  "flag",
  "projectConfiguration",
] as const);
export type AllowDetectIgnoredSource = (typeof ALLOW_DETECT_IGNORED_FROM)[number];

/** What the run record and the `[LOOP]` line say where a group runs below C2. */
export const PROTECTION_DETECT = "detect" as const;

/** What they say at C2 and above, where the sandbox is the control (PU-26). */
export const PROTECTION_SANDBOX = "sandbox" as const;

/** Where a value of `loop.parallel.allow_detect` was found. */
export type AllowDetectConfiguration = {
  readonly userConfiguration?: boolean;
  readonly environment?: boolean;
  readonly flag?: boolean;
  readonly projectConfiguration?: boolean;
};

/** What the key says, and what was ignored to say it (F142-FR-003, CQ-183). */
export type AllowDetectReading = {
  /** True only where user configuration set the key. */
  readonly inForce: boolean;
  /** The sources whose value was ignored, in the order of `ALLOW_DETECT_IGNORED_FROM`. */
  readonly ignored: readonly AllowDetectIgnoredSource[];
  /** One launch message per ignored source (F142-FR-003). */
  readonly launchMessages: readonly string[];
  /** One doctor warning per ignored source (F142-FR-003). */
  readonly doctorWarnings: readonly string[];
};

/**
 * Read `loop.parallel.allow_detect` (T043, F142-FR-003, ruling P2, CQ-183).
 *
 * The key is accepted from **user configuration only**. A value from the
 * environment, from a flag or from project configuration is ignored — it never
 * puts the key in force, whatever its rank in annex X §X.2 would otherwise be
 * — and each ignored source gets a launch message and a doctor warning. A
 * value in user configuration of `false` leaves the key out of force without
 * an ignored source: it was read and it said no.
 */
export function allowDetectReading(
  configuration: AllowDetectConfiguration = {},
): AllowDetectReading {
  const ignored: AllowDetectIgnoredSource[] = [];
  for (const source of ALLOW_DETECT_IGNORED_FROM) {
    if (configuration[source] !== undefined) ignored.push(source);
  }
  const wording: Readonly<Record<AllowDetectIgnoredSource, string>> = Object.freeze({
    environment: "the environment",
    flag: "a flag",
    projectConfiguration: "project configuration",
  });
  return Object.freeze({
    inForce: configuration.userConfiguration === true,
    ignored: Object.freeze(ignored),
    launchMessages: Object.freeze(
      ignored.map(
        (source) =>
          `${ALLOW_DETECT_KEY} from ${wording[source]} is ignored: the key is read from ${ALLOW_DETECT_IS_READ_FROM} only (F142-FR-003, CQ-183)`,
      ),
    ),
    doctorWarnings: Object.freeze(
      ignored.map(
        (source) =>
          `warning: ${ALLOW_DETECT_KEY} is set in ${wording[source]} and has no effect; set it in ${ALLOW_DETECT_IS_READ_FROM} to let groups run below ${CONTAINMENT_NEEDED}`,
      ),
    ),
  });
}

/** What containment says: whether a group may run, and what protection is recorded. */
export type ContainmentReading = {
  readonly mayRunAGroup: boolean;
  readonly containment: ContainmentLevel;
  /** `sandbox` at C2 and above; `detect` where `allow_detect` let a group run below it. */
  readonly protection: typeof PROTECTION_SANDBOX | typeof PROTECTION_DETECT;
  readonly allowDetect: AllowDetectReading;
  readonly detail: string;
};

/**
 * Whether the containment in force lets a group run, and what the run record
 * and the `[LOOP]` line say about protection (T043, F142-FR-003, PU-26).
 *
 * At C2 and above a group runs and the protection is the sandbox. At C0 and C1
 * a group runs only where `loop.parallel.allow_detect` is in force from user
 * configuration, and then the protection recorded is `detect`; otherwise the
 * layer is off for the run with the reason `containment`.
 */
export function containmentReading(
  containment: ContainmentLevel,
  configuration: AllowDetectConfiguration = {},
): ContainmentReading {
  const allowDetect = allowDetectReading(configuration);
  const belowWhatIsNeeded = (CONTAINMENT_BELOW_WHAT_IS_NEEDED as readonly string[]).includes(
    containment,
  );
  if (!belowWhatIsNeeded) {
    return Object.freeze({
      mayRunAGroup: true,
      containment,
      protection: PROTECTION_SANDBOX,
      allowDetect,
      detail: `containment is ${containment}, at or above ${CONTAINMENT_NEEDED}: the sandbox is the control`,
    });
  }
  if (allowDetect.inForce) {
    return Object.freeze({
      mayRunAGroup: true,
      containment,
      protection: PROTECTION_DETECT,
      allowDetect,
      detail: `containment is ${containment} and ${ALLOW_DETECT_KEY} is set in ${ALLOW_DETECT_IS_READ_FROM}: groups run and the run says protection=${PROTECTION_DETECT}`,
    });
  }
  return Object.freeze({
    mayRunAGroup: false,
    containment,
    protection: PROTECTION_SANDBOX,
    allowDetect,
    detail: `containment is ${containment}, below ${CONTAINMENT_NEEDED}, and ${ALLOW_DETECT_KEY} is not set in ${ALLOW_DETECT_IS_READ_FROM}`,
  });
}

/** The field the run record and the `[LOOP]` line carry (F142-FR-003). */
export function protectionField(reading: ContainmentReading): string {
  return `protection=${reading.protection}`;
}

/* ================================================================== *
 * 4. Evaluating the eight preconditions (T042, F142-FR-002).
 * ================================================================== */

/** What the engine read for the preconditions, by the view of the launch. */
export type PreconditionInputs = {
  /** The loop strategy that was resolved: only `micro` admits this layer. */
  readonly loopStrategy?: string;
  /** True where the verification gate executes (IR-34). */
  readonly gateExecutes?: boolean;
  /** True where the workspace is inside a git work tree (002 FR-048, PU-18). */
  readonly insideAGitWorkTree?: boolean;
  /** True where the workspace has submodules. */
  readonly submodules?: boolean;
  /** The installed git, as the engine read it. */
  readonly gitVersion?: { readonly major: number; readonly minor: number };
  /** The entry of the proposer's harness adapter in the registry (T052). */
  readonly harness?: HarnessRegistryEntry;
  /** The containment in force for a worker (annex C §C.15). */
  readonly containment?: ContainmentLevel;
  /** Where `loop.parallel.allow_detect` was found (T043). */
  readonly allowDetect?: AllowDetectConfiguration;
  /** The number of groups the plan holds, over every phase (F142-FR-002). */
  readonly groupsInThePlan?: number;
};

/** The verdict of one precondition, with the words the launch message prints. */
export type PreconditionVerdict = {
  readonly reason: FallbackReason;
  readonly passed: boolean;
  readonly detail: string;
};

/** True where the git the engine read is older than the floor a snapshot needs. */
export function gitIsOlderThanTheFloor(version: {
  readonly major: number;
  readonly minor: number;
}): boolean {
  if (version.major !== GIT_VERSION_FLOOR.major) return version.major < GIT_VERSION_FLOOR.major;
  return version.minor < GIT_VERSION_FLOOR.minor;
}

/**
 * The verdict of every one of the eight preconditions, in the order of
 * `PRECONDITIONS` (T042, F142-FR-002).
 *
 * Every precondition is evaluated and recorded, whatever an earlier one said,
 * so that the launch message and the doctor can state them all; the fallback
 * the run takes is the **first** that failed (`fallbackOfThePreconditions`). A
 * fact the engine did not read is read as satisfied: the layer never invents a
 * fallback out of a missing reading.
 */
export function preconditionVerdicts(
  inputs: PreconditionInputs = {},
): readonly PreconditionVerdict[] {
  const strategy = inputs.loopStrategy;
  const harness = inputs.harness;
  const containment = inputs.containment ?? CONTAINMENT_NEEDED;
  const verdicts: PreconditionVerdict[] = [];

  const add = (reason: FallbackReason, passed: boolean, detail: string): void => {
    verdicts.push(Object.freeze({ reason, passed, detail }));
  };

  add(
    "classic",
    strategy === undefined || strategy === STACKED_ABOVE,
    strategy === undefined || strategy === STACKED_ABOVE
      ? `the loop strategy is \`${STACKED_ABOVE}\`: the layer stacks above it`
      : `the loop strategy is \`${strategy}\` and not \`${STACKED_ABOVE}\``,
  );
  add(
    "gate-not-executing",
    inputs.gateExecutes !== false,
    inputs.gateExecutes === false
      ? "the verification gate does not execute (IR-34)"
      : "the verification gate executes",
  );
  add(
    "not-git",
    inputs.insideAGitWorkTree !== false,
    inputs.insideAGitWorkTree === false
      ? "the workspace is not inside a git work tree (002 FR-048, PU-18)"
      : "the workspace is inside a git work tree",
  );
  add(
    "submodules",
    inputs.submodules !== true,
    inputs.submodules === true ? "the workspace has submodules" : "the workspace has no submodule",
  );
  const gitOld = inputs.gitVersion !== undefined && gitIsOlderThanTheFloor(inputs.gitVersion);
  add(
    "git-version",
    !gitOld,
    gitOld
      ? `the installed git is ${inputs.gitVersion?.major}.${inputs.gitVersion?.minor}, older than the ${GIT_VERSION_FLOOR.major}.${GIT_VERSION_FLOOR.minor} a snapshot needs`
      : "the installed git is new enough for a snapshot",
  );
  const harnessVerdict = harness === undefined ? undefined : harnessReading(harness);
  add(
    "harness",
    harnessVerdict === undefined || harnessVerdict.mayRunAGroup,
    harnessVerdict === undefined
      ? "no harness entry was read: the precondition is not evaluated"
      : harnessVerdict.detail,
  );
  const containmentVerdict = containmentReading(containment, inputs.allowDetect);
  add("containment", containmentVerdict.mayRunAGroup, containmentVerdict.detail);
  const groups = inputs.groupsInThePlan;
  add(
    "no-group",
    groups === undefined || groups > 0,
    groups === undefined
      ? "the plan was not computed yet: the precondition is not evaluated"
      : groups > 0
        ? `the plan holds ${groups} group(s)`
        : "the plan holds no group",
  );
  return Object.freeze(verdicts);
}

/**
 * The outcome of the preconditions: the layer is on, or it is off for the run
 * with one reason of row 60 (F142-FR-002).
 *
 * A failed precondition is a **fallback and never an error**: `isAnError` is
 * `false` on every outcome, and the run completes as the same run with the
 * option off.
 */
export type PreconditionOutcome = {
  readonly on: boolean;
  readonly reason: FallbackReason | null;
  readonly verdicts: readonly PreconditionVerdict[];
  /** The line the launch message prints (F142-FR-002). */
  readonly launchMessage: string;
  /** The field the `[LOOP]` line carries, or `null` where the layer is on. */
  readonly loopLineField: string | null;
  /** A failed precondition is never an error. */
  readonly isAnError: false;
  /** The run completes as the same run with the option off. */
  readonly runCompletesAsWithTheOptionOff: true;
  /** `protection=sandbox` or `protection=detect` (F142-FR-003). */
  readonly protection: string;
  /** The launch messages of an ignored `loop.parallel.allow_detect` (F142-FR-003). */
  readonly launchMessages: readonly string[];
  /** The doctor warnings of an ignored `loop.parallel.allow_detect`. */
  readonly doctorWarnings: readonly string[];
};

/**
 * Evaluate the eight preconditions and announce the fallback reason
 * (T042, T043, T052; F142-FR-002, F142-FR-003, F142-FR-020).
 *
 * The reason announced is the first precondition of `PRECONDITIONS` that
 * failed, which is a member of the closed set of row 60. It goes into the
 * launch message and into the `[LOOP]` line as `parallel=off reason=<reason>`,
 * and the run carries on exactly as the same run with the option off: nothing
 * here is an error, no exit code changes and no stop reason is added
 * (F142-FR-004).
 */
export function evaluatePreconditions(inputs: PreconditionInputs = {}): PreconditionOutcome {
  const verdicts = preconditionVerdicts(inputs);
  const failed = verdicts.find((verdict) => !verdict.passed);
  const containment = containmentReading(
    inputs.containment ?? CONTAINMENT_NEEDED,
    inputs.allowDetect,
  );
  const reason = failed?.reason ?? null;
  return Object.freeze({
    on: reason === null,
    reason,
    verdicts,
    launchMessage:
      reason === null
        ? `${UNITS_KEY}=on: every precondition of the layer \`parallel\` holds`
        : `${UNITS_KEY}=on, but the layer \`parallel\` is off for the run: ${reason} — ${failed?.detail ?? ""}`,
    loopLineField: reason === null ? null : `parallel=off reason=${reason}`,
    isAnError: false,
    runCompletesAsWithTheOptionOff: true,
    protection: protectionField(containment),
    launchMessages: containment.allowDetect.launchMessages,
    doctorWarnings: containment.allowDetect.doctorWarnings,
  });
}

/** The first precondition that failed, as the reason of row 60, or `null`. */
export function fallbackOfThePreconditions(inputs: PreconditionInputs = {}): FallbackReason | null {
  return evaluatePreconditions(inputs).reason;
}

/**
 * The reason to print for a value that is no member of row 60: the unknown
 * value of the closed set is "shown as text; the layer is off"
 * (`data/closed-sets.json`). The layer is off either way.
 */
export function fallbackReasonAsPrinted(reason: string): string {
  return isFallbackReason(reason) ? reason : `${reason} (unknown reason: shown as text)`;
}

/** Every reason of row 60 is the reason of exactly one precondition (F142-FR-002). */
export function reasonsWithoutAPrecondition(): readonly FallbackReason[] {
  const covered = new Set<string>(PRECONDITION_REASONS);
  return Object.freeze(FALLBACK_REASONS.filter((reason) => !covered.has(reason)));
}
