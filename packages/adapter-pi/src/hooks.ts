/**
 * The code hooks of the pi adapter (T018, phase 3).
 *
 * Code exists only where the descriptor data cannot express the rule. Every
 * function here is pure unless its name says otherwise (`endPhaseAttempt`
 * removes a directory); none of them makes a model call, reads a credential
 * store, starts a login or writes the auth or trust state of pi.
 *
 * Hooks of this phase:
 *  - `detectPi` — charge-free detection: absolute path, version by the
 *    harness's own option, help must hold what the descriptor names; no
 *    model call, no credential read (F134-FR-002).
 *  - the version warnings of the tested adapter: outside the pinned range,
 *    and a change between two passes of one run (F134-FR-003).
 *  - `piContainment` — the ceiling C0 with the opt-in from USER configuration
 *    only; without it the launch of a proposer is refused, with the reason
 *    and a doctor line, and no pass starts; with it the record says
 *    `protection=detect` (F134-FR-008, CQ-183).
 *  - `piParallelUnitsDecision` — off unless `loop.parallel.allow_detect` in
 *    user configuration, with the reason stated (F134-FR-009, CQ-183).
 *  - `piPreflight` — the presence of the credential of the role, never its
 *    value; a missing credential fails BEFORE the first pass, naming what is
 *    missing (F134-FR-004).
 *  - `buildProposerInvocation` — the headless proposer call: print mode with
 *    the JSON output mode, the prompt on standard input, the working
 *    directory, the allow-list environment, the tool allow-list in the
 *    invocation record (F134-FR-011, F134-FR-012).
 *  - `mintSessionId`, `sessionDecision`, `endPhaseAttempt` — continuation by
 *    the exact minted id, a session directory per phase attempt removed at
 *    its end, the fresh-session cases, nothing kept under `parity`
 *    (F134-FR-013, F134-FR-014).
 *  - `homeDecision`, `removeOverlayHome` — the real home untouched at tier 1,
 *    a throwaway overlay home at tier 2, removed after the call, a killed
 *    pass included (F134-FR-015).
 *  - `telemetryEnv` — `PI_TELEMETRY=0` in the environment of every process,
 *    and the adapter never relies on the switch for correctness
 *    (F134-FR-016).
 *  - `proposerCustomisationsDecision` — auto-loaded context and native
 *    memory off by default, the opt-in `harnesses.pi.proposerCustomisations`
 *    from user configuration only, recorded per run (F134-FR-029).
 *
 * Hooks of phase 4 (User Story 2, pi as a critic that can take no action):
 *  - `piProjectLocalTrustDecision` — project-local resources untrusted for
 *    both roles; the approval option never passed, the explicit ignore flags
 *    passed, the print-mode default not relied on (F134-FR-017).
 *  - `piCriticFlagGuard` — the whole critic flag set held, no flag that
 *    allows a tool or a bypass, memory and context files off and recorded
 *    (F134-FR-018).
 *  - `piCriticProof` — the proof of the critic mode, a pure function of the
 *    initial record and the call record: initial-record proof, the weaker
 *    flags-and-pin proof, or `critic_not_toolless` with exit 3 and the stop
 *    reason `critic_config` (F134-FR-019).
 *  - `criticSessionClash` — no critic call shares a session id with a pass
 *    (F134-FR-020).
 *  - `criticFormsOffered`, `automaticCriticPick` — the tool-less form only,
 *    an automatic pick only as a tested adapter with the provider's row
 *    (F134-FR-021).
 *  - `contextWindowInUse`, `criticOfferedForModel` — the smaller of the two
 *    windows, no default for an unknown model (F134-FR-022).
 *  - `piCallIdentity`, `piDiversityResult`, `piDiversityDecision` — the
 *    provider and model of every call recorded; the critic-diversity warning
 *    raised and recorded for `same-model` and `unverified`, never blocking
 *    (F134-FR-030).
 *
 * Hooks of phase 5 (User Story 3, the subscription path is refused):
 *  - `piTermsDecision` — the row of the provider in use decides through the
 *    terms gate of EP-11; no provider, or no row, is unknown terms: usable
 *    when the consumer names pi, warned, never a default and never picked
 *    automatically; tier 3 ships refused for every provider and both
 *    audiences (F134-FR-005, F134-FR-006).
 *  - `piSubscriptionLoginRefusal` — the OAuth login of pi for a Claude
 *    subscription, and every login reusing a subscription token, is refused
 *    with the explanation and no process of pi starts (F134-FR-006).
 *  - `PI_NO_LOGIN_GUARANTEES` — the adapter never starts a login, never
 *    writes the auth file of pi and never sets or changes the trust of a
 *    project (F134-FR-007).
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  CONTAINMENT_OPT_IN_KEY,
  CRITIC_CONFIG_STOP_REASON,
  CRITIC_NOT_TOOLLESS,
  ENGINE_EXIT_CODE_OF_CRITIC_CONFIG,
  buildCallEnvironment,
  checkVersionStability,
  c0OptedIn,
  outsideRangeWarning,
  proveFirstForm,
  resolveRunLevel,
  versionInRange,
} from "@specstride/harness";
import { DIVERSITY_RESULTS_THAT_WARN } from "@specstride/contracts/ep/critic-strategy";
import {
  AUTH_TIER_3_SHIPS,
  noRowOutcome,
  type Audience,
  type AuthTier,
  type TermsDecision,
  type TermsRow,
} from "@specstride/contracts/ep/terms";
import { resultsOfTheDiversityTest } from "@specstride/contracts/enums/all-sets";
import { isAbsolute } from "node:path";
import {
  PI_DIALECT,
  PI_EXACT_PIN,
  PI_ID,
  PI_STREAM_FORMAT,
  PI_VERSION_RANGE,
  PI_VERIFIED_ON,
  criticFlagSet,
  envAllowListFor,
  providerKeyVar,
  toolAllowList,
} from "./descriptor.ts";

/** Where a configuration value came from; only `user-config` is accepted. */
export type ConfigOrigin = "user-config" | "env" | "flag" | "project-config";

/** One value of a configuration key, with where it was seen. */
export type SeenValue = { readonly value: unknown; readonly origin: ConfigOrigin };

/** The role of a call, as the seam names the two. */
export type CallRole = "proposer" | "critic";

/** Map the adapter's origins onto the opt-in sources the seam accepts. */
function toOptInValues(
  seen: readonly SeenValue[],
): readonly { value: string; source: "user" | "environment" | "flag" | "project" }[] {
  return seen.map((one) => ({
    value: String(one.value),
    source:
      one.origin === "user-config"
        ? ("user" as const)
        : one.origin === "env"
          ? ("environment" as const)
          : one.origin === "flag"
            ? ("flag" as const)
            : ("project" as const),
  }));
}

// ---------------------------------------------------------------------------
// Detection and the version pin (F134-FR-002, F134-FR-003)
// ---------------------------------------------------------------------------

/** What detection reads, injected so detection itself stays charge-free. */
export type PiProbe = {
  /** The executable as found on the search path, or null. */
  readonly executable: string | null;
  /** The text of the version option (`pi --version`). */
  readonly version: string | null;
  /** The text of the help output. */
  readonly help: string;
};

/** The facts the descriptor names that help must hold. */
export const PI_HELP_MUST_CONTAIN: readonly string[] = [
  "--mode",
  "--no-session",
  "--session-id",
  "--tools",
];

/** The record detection produces (the `detect` operation's truth value). */
export type PiDetection =
  | {
      readonly present: true;
      readonly executable: string;
      readonly version: string | null;
      readonly versionInRange: boolean;
      readonly helpOk: boolean;
      readonly modelCall: false;
      readonly credentialRead: false;
    }
  | { readonly present: false; readonly reason: string };

/**
 * F134-FR-002 — detection is free of charge: the executable resolves to an
 * absolute path, the version is read by the harness's own version option,
 * the help text must hold what the descriptor names. No model call is made
 * and no credential is read; the adapter never installs, vendors or
 * downloads pi.
 */
export function detectPi(probe: PiProbe): PiDetection {
  if (probe.executable === null) {
    return { present: false, reason: "the executable 'pi' was not found on the search path" };
  }
  if (!isAbsolute(probe.executable)) {
    return { present: false, reason: "the executable did not resolve to an absolute path" };
  }
  const helpOk = PI_HELP_MUST_CONTAIN.every((name) => probe.help.includes(name));
  if (!helpOk) {
    return {
      present: false,
      reason: `the help text does not hold what the descriptor names (${PI_HELP_MUST_CONTAIN.join(", ")})`,
    };
  }
  const version =
    typeof probe.version === "string" && probe.version.trim() !== "" ? probe.version.trim() : null;
  return {
    present: true,
    executable: probe.executable,
    version,
    versionInRange: versionInRange(version, PI_VERSION_RANGE),
    helpOk: true,
    modelCall: false,
    credentialRead: false,
  };
}

/**
 * F134-FR-003 — the doctor's warning for an installed version outside the
 * pinned range; null when the version is inside it.
 */
export function piVersionWarning(version: string | null): string | null {
  if (versionInRange(version, PI_VERSION_RANGE)) return null;
  return outsideRangeWarning({ harness: PI_ID, version, range: PI_VERSION_RANGE });
}

/**
 * F134-FR-003 — the warning recorded when the version of pi changed between
 * two passes of one run; null when it did not change.
 */
export function piVersionChangeWarning(before: string | null, after: string | null): string | null {
  return checkVersionStability({ harness: PI_ID, before, after });
}

/** The range and date a tested adapter's record repeats (F134-FR-003). */
export const PI_VERSION_FACTS = Object.freeze({
  range: PI_VERSION_RANGE,
  verifiedOn: PI_VERIFIED_ON,
  provisional: true,
} as const);

// ---------------------------------------------------------------------------
// Containment and parallel units (F134-FR-008, F134-FR-009; CQ-183)
// ---------------------------------------------------------------------------

/** The doctor line a refused launch names (F134-FR-008). */
export function piContainmentDoctorLine(): string {
  return (
    `doctor: harness.pi.containment — the ceiling of '${PI_ID}' is C0 (no sandbox, no permission mode); ` +
    `set ${CONTAINMENT_OPT_IN_KEY}=C0 in the user configuration to opt in`
  );
}

/** The value the C0 opt-in key must carry, and where it may come from. */
export const PI_C0_OPT_IN = Object.freeze({
  key: CONTAINMENT_OPT_IN_KEY,
  value: "C0",
  acceptedFrom: "user-config",
} as const);

/** The containment record of one run of pi (F134-FR-008). */
export type PiContainment = {
  readonly ceiling: "C0";
  readonly provenance: string;
  readonly level: "C0";
  readonly protection: "detect";
};

/**
 * F134-FR-008 — resolve the containment of a run of pi. A proposer without
 * the opt-in in USER configuration is refused: the reason names the key, and
 * no pass starts. The same value from the environment, from a flag or from
 * project configuration is NOT accepted (CQ-183). With the opt-in the run
 * record says `protection=detect`.
 */
export function piContainment(input: {
  readonly role: CallRole;
  readonly optIns?: readonly SeenValue[];
}): PiContainment {
  resolveRunLevel({
    id: PI_ID,
    ceiling: { level: "C0", provenance: "adapter" as unknown as "declared" },
    offersC2: false,
    role: input.role,
    optInValues: toOptInValues(input.optIns ?? []),
  });
  return { ceiling: "C0", provenance: "adapter", level: "C0", protection: "detect" };
}

/** Whether the C0 opt-in stands, seen from user configuration only. */
export function c0OptInHeld(optIns: readonly SeenValue[]): boolean {
  return c0OptedIn(toOptInValues(optIns));
}

/** The parallel-units decision for pi as proposer (F134-FR-009). */
export type PiParallelDecision =
  | { readonly units: "off"; readonly reason: string }
  | { readonly units: "detect"; readonly reason: string; readonly allowedBy: "user-config" };

/** The key that alone unlocks parallel units, and where it is accepted from. */
export const PI_ALLOW_DETECT = Object.freeze({
  key: "loop.parallel.allow_detect",
  acceptedFrom: "user-config",
} as const);

/**
 * F134-FR-009 — parallel units stay off for pi as proposer unless the
 * consumer set `loop.parallel.allow_detect` in USER configuration only; the
 * reason is stated when the option is off, and `protection=detect` when on
 * (CQ-183). `concurrentSessions` of the descriptor stays null.
 */
export function piParallelUnitsDecision(allowDetect?: {
  readonly value: boolean;
  readonly origin: ConfigOrigin;
}): PiParallelDecision {
  if (allowDetect !== undefined && allowDetect.value && allowDetect.origin === "user-config") {
    return {
      units: "detect",
      reason: "loop.parallel.allow_detect set in user configuration at protection=detect",
      allowedBy: "user-config",
    };
  }
  const source = allowDetect === undefined || !allowDetect.value ? "unset" : allowDetect.origin;
  return {
    units: "off",
    reason:
      `containment C0 is protection=detect (pi has no sandbox and no permission mode) and ` +
      `loop.parallel.allow_detect is ${source} (accepted from user configuration only)`,
  };
}

// ---------------------------------------------------------------------------
// Credential preflight (F134-FR-004)
// ---------------------------------------------------------------------------

/** The refusal of a preflight: raised BEFORE the first pass, naming the gap. */
export class PiPreflightRefusedError extends Error {
  /** What is missing: the environment variable or the provider name. */
  public readonly missing: string;
  /** The stage; always before the first pass. */
  public readonly stage = "before-first-pass" as const;

  constructor(missing: string) {
    super(`preflight of pi failed before the first pass: ${missing} is missing`);
    this.name = "PiPreflightRefusedError";
    this.missing = missing;
  }
}

/**
 * F134-FR-004 — preflight reports whether the credential of the role is
 * present, never its value, without a paid call. A missing credential fails
 * before the first pass and names what is missing. The key reaches pi by
 * environment only: it is never an argument.
 */
export function piPreflight(input: {
  readonly role: CallRole;
  readonly provider: string | null | undefined;
  /** Whether the resolved value of the secret reference is present. */
  readonly credentialPresent: boolean;
}): { ok: true; checked: readonly string[] } {
  const keyVar = providerKeyVar(input.provider);
  if (keyVar === null) {
    throw new PiPreflightRefusedError(
      `the key variable of the provider '${input.provider ?? "(none stated)"}' (no row in the environment allow-list table)`,
    );
  }
  if (!input.credentialPresent) {
    throw new PiPreflightRefusedError(`the environment variable ${keyVar}`);
  }
  return { ok: true, checked: [keyVar] };
}

// ---------------------------------------------------------------------------
// The proposer invocation (F134-FR-011, F134-FR-012)
// ---------------------------------------------------------------------------

/** The telemetry environment of every process the adapter starts (F134-FR-016). */
export function telemetryEnv(): Readonly<Record<string, string>> {
  return { PI_TELEMETRY: "0" };
}

/** The argv of one proposer call (F134-FR-011); print mode, JSON, stdin. */
export function proposerArgv(input: {
  readonly model: string;
  readonly customisationsOn?: boolean;
  readonly session?: { readonly id: string; readonly dir: string } | null;
}): string[] {
  const argv = ["-p", "--mode", "json", "--tools", toolAllowList().join(",")];
  if (input.customisationsOn !== true) {
    argv.push("--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates");
  }
  argv.push("--no-approve", "--model", input.model);
  if (input.session !== null && input.session !== undefined) {
    argv.push("--session-id", input.session.id, "--session-dir", input.session.dir);
  } else {
    argv.push("--no-session");
  }
  return argv;
}

/** The invocation record of one proposer pass (F134-FR-011, F134-FR-012). */
export type PiInvocationRecord = {
  readonly harness: typeof PI_ID;
  readonly role: "proposer";
  readonly stream: typeof PI_STREAM_FORMAT;
  readonly dialect: typeof PI_DIALECT;
  readonly argv: readonly string[];
  /** The prompt travels on standard input, never as an argument. */
  readonly promptChannel: "stdin";
  readonly workdir: string;
  /** The names the environment was built from — the allow-list, nothing else. */
  readonly envAllowList: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** The tool allow-list of the pass, stated in the record (F134-FR-012). */
  readonly toolAllowList: readonly string[];
  readonly toolSelection: "allow-list";
  readonly sessionId: string | null;
  readonly sessionDir: string | null;
  readonly sessionKept: boolean;
  readonly home: { readonly mode: "real" | "overlay"; readonly home: string };
  readonly telemetry: Readonly<Record<string, string>>;
  /** The adapter never relies on the telemetry switch (F134-FR-016). */
  readonly telemetrySwitchReliedUpon: false;
  readonly containment: PiContainment;
  readonly parallelUnits: PiParallelDecision;
  readonly customisations: "off" | "on";
  readonly customisationsRecord: ReturnType<typeof proposerCustomisationsDecision>;
};

/** Input of `buildProposerInvocation` that the launch itself decides. */
export type ProposerLaunchInput = {
  readonly role?: "proposer";
  readonly workdir: string;
  readonly model: string;
  readonly provider: string | null | undefined;
  /** The resolved credential of the role, present or not (never logged). */
  readonly credentialPresent: boolean;
  /** The consumer's environment; read only through the allow-list. */
  readonly processEnv: Readonly<Record<string, string>>;
  readonly optIns?: readonly SeenValue[];
  readonly allowDetect?: { readonly value: boolean; readonly origin: ConfigOrigin };
  readonly customisationsOptIns?: readonly SeenValue[];
  readonly session?: { readonly id: string; readonly dir: string } | null;
  readonly home: { readonly mode: "real" | "overlay"; readonly home: string };
};

/**
 * F134-FR-011, F134-FR-012 — build the whole proposer call, refusing BEFORE
 * any pass: containment without the opt-in throws `ContainmentRefusedError`,
 * a missing credential throws `PiPreflightRefusedError` — in both cases no
 * pass starts. The environment is the allow-list and nothing else: the
 * credentials of the critic never enter it, and the key of the proposer
 * reaches pi by environment only, never as an argument.
 */
export function buildProposerInvocation(input: ProposerLaunchInput): PiInvocationRecord {
  const containment = piContainment({ role: "proposer", optIns: input.optIns });
  piPreflight({
    role: "proposer",
    provider: input.provider,
    credentialPresent: input.credentialPresent,
  });
  const customisationsRecord = proposerCustomisationsDecision({
    optIns: input.customisationsOptIns,
  });
  const envAllowList = envAllowListFor(input.provider);
  const keyVar = providerKeyVar(input.provider);
  const env = buildCallEnvironment({
    role: "proposer",
    envAllow: envAllowList,
    credentialVars: { proposer: keyVar === null ? [] : [keyVar], critic: [] },
    processEnv: input.processEnv,
    overlayHome: input.home.mode === "overlay" ? input.home.home : undefined,
  });
  // The harness's own switches are set by the adapter, not taken from the
  // consumer's environment.
  for (const [name, value] of Object.entries(telemetryEnv())) env[name] = value;
  const session = input.session ?? null;
  return Object.freeze({
    harness: PI_ID,
    role: "proposer",
    stream: PI_STREAM_FORMAT,
    dialect: PI_DIALECT,
    argv: proposerArgv({
      model: input.model,
      customisationsOn: customisationsRecord.customisations === "on",
      session,
    }),
    promptChannel: "stdin",
    workdir: input.workdir,
    envAllowList,
    env,
    toolAllowList: toolAllowList(),
    toolSelection: "allow-list",
    sessionId: session?.id ?? null,
    sessionDir: session?.dir ?? null,
    sessionKept: session !== null,
    home: input.home,
    telemetry: telemetryEnv(),
    telemetrySwitchReliedUpon: false,
    containment,
    parallelUnits: piParallelUnitsDecision(input.allowDetect),
    customisations: customisationsRecord.customisations,
    customisationsRecord,
  });
}

// ---------------------------------------------------------------------------
// Sessions: continuation, fresh cases, the per-attempt directory (FR-013/014)
// ---------------------------------------------------------------------------

/**
 * F134-FR-013 — the runtime MINTS the session id of a phase attempt;
 * continuation is by that exact id, never by "the most recent" session.
 */
export function mintSessionId(): string {
  return `pi-${randomUUID()}`;
}

/** The reasons a pass starts fresh, as F134-FR-014 lists them. */
export const FRESH_SESSION_REASONS: readonly string[] = [
  "cannot-continue",
  "new-phase-attempt",
  "relaunch",
  "watchdog-kill",
  "second-repair",
  "escalation",
  "config-change",
  "critic",
] as const;

/** The session decision of one pass (F134-FR-013, F134-FR-014). */
export type SessionDecision = {
  /** Whether a session is kept for a later pass of the same attempt. */
  readonly keepSession: boolean;
  readonly sessionId: string | null;
  readonly sessionDir: string | null;
  /** The argv fragment that carries the decision. */
  readonly argvSession: readonly string[];
  /** Why, for the record. */
  readonly reason: string;
};

/**
 * F134-FR-013, F134-FR-014 — a pass keeps a session ONLY when continuation
 * is on, a later pass of the same phase attempt can follow, and the profile
 * is not `parity`: every listed fresh case, and every pass under `parity`,
 * runs with no session kept (`--no-session`).
 */
export function sessionDecision(input: {
  readonly continuationOn: boolean;
  /** True where a later pass of this phase attempt can continue the session. */
  readonly aLaterPassCanContinue: boolean;
  readonly parityProfile?: boolean;
  readonly freshReason?: (typeof FRESH_SESSION_REASONS)[number];
  readonly mintedId?: string;
  readonly attemptSessionDir?: string | null;
}): SessionDecision {
  const keep =
    input.continuationOn &&
    input.aLaterPassCanContinue &&
    input.parityProfile !== true &&
    input.freshReason === undefined;
  if (keep) {
    const id = input.mintedId ?? mintSessionId();
    const dir = input.attemptSessionDir ?? null;
    if (dir === null) {
      throw new Error("a kept session needs the session directory of the phase attempt");
    }
    return {
      keepSession: true,
      sessionId: id,
      sessionDir: dir,
      argvSession: ["--session-id", id, "--session-dir", dir],
      reason: "the first pass of a phase attempt with continuation on, under the minted id",
    };
  }
  const reason =
    input.parityProfile === true
      ? "under the parity profile every pass runs with no session kept"
      : input.freshReason === undefined
        ? "no later pass of the phase attempt continues this pass"
        : `fresh session: ${input.freshReason}`;
  return {
    keepSession: false,
    sessionId: null,
    sessionDir: null,
    argvSession: ["--no-session"],
    reason,
  };
}

/**
 * F134-FR-013 — the session directory of one phase attempt is removed when
 * the phase attempt ends. Called at the end of the attempt whatever the
 * outcome; a directory that is already gone is fine.
 */
export function endPhaseAttempt(sessionDir: string | null | undefined): { removed: boolean } {
  if (sessionDir === null || sessionDir === undefined || sessionDir === "")
    return { removed: false };
  if (!existsSync(sessionDir)) return { removed: false };
  rmSync(sessionDir, { recursive: true, force: true });
  return { removed: !existsSync(sessionDir) };
}

// ---------------------------------------------------------------------------
// Home and overlay (F134-FR-015)
// ---------------------------------------------------------------------------

/** The home decision of one call (F134-FR-015). */
export type HomeDecision = {
  readonly mode: "real" | "overlay";
  readonly home: string;
  /** Tier 1: the run never writes the real home. */
  readonly neverWritten: boolean;
  /** Tier 2: the overlay is removed after the call, a killed pass included. */
  readonly removedAfterCall: boolean;
  /** The key travels by environment only: no auth file is copied between homes. */
  readonly credentialByEnvironmentOnly: true;
};

/**
 * F134-FR-015 — the real home at auth tier 1 (never written by the run); a
 * throwaway overlay home at tier 2, which redirects the agent directory and
 * the session directory of pi and seeds no credential.
 */
export function homeDecision(input: {
  readonly authTier: 1 | 2;
  readonly realHome: string;
  readonly overlayHome?: string | null;
}): HomeDecision {
  if (input.authTier === 1) {
    return {
      mode: "real",
      home: input.realHome,
      neverWritten: true,
      removedAfterCall: false,
      credentialByEnvironmentOnly: true,
    };
  }
  if (input.overlayHome === undefined || input.overlayHome === null || input.overlayHome === "") {
    throw new Error("an auth tier 2 call needs the throwaway overlay home");
  }
  return {
    mode: "overlay",
    home: input.overlayHome,
    neverWritten: false,
    removedAfterCall: true,
    credentialByEnvironmentOnly: true,
  };
}

/**
 * F134-FR-015 — remove the overlay home after the call, a killed pass
 * included: the caller runs this in the cleanup path whatever the outcome.
 */
export function removeOverlayHome(overlayHome: string): { removed: boolean } {
  rmSync(overlayHome, { recursive: true, force: true });
  return { removed: !existsSync(overlayHome) };
}

/** Kept for an overlay seeding check in a later phase; seeds stay empty. */
export const OVERLAY_SEEDS: readonly never[] = Object.freeze([]);

/** Copy nothing but the overlay skeleton; exported for the tier-2 tests. */
export function seedOverlayHome(from: string, to: string): void {
  cpSync(from, to, { recursive: true });
}

// ---------------------------------------------------------------------------
// Customisations and native memory (F134-FR-029)
// ---------------------------------------------------------------------------

/** The opt-in key for pi's proposer customisations (row 131 of annex X §X.7). */
export const PI_CUSTOMISATIONS_KEY = "harnesses.pi.proposerCustomisations" as const;

/** The customisations decision of one proposer run (F134-FR-029). */
export type CustomisationsDecision = {
  readonly customisations: "off" | "on";
  readonly nativeMemory: "off" | "on";
  /** The flags that keep auto-loaded context off; empty where opted in. */
  readonly offFlags: readonly string[];
  readonly optIn: { readonly key: string; readonly origin: ConfigOrigin } | null;
  /** The opt-in is of the trust class widening. */
  readonly trustClass: "widening";
  /** Project configuration never turns it on. */
  readonly projectConfigIgnored: true;
  readonly recordedPerRun: true;
};

/**
 * F134-FR-029 — auto-loaded context (extensions, skills, context files,
 * prompt templates) and harness-native memory are off for the proposer by
 * default. The opt-in is accepted from USER configuration only — the same
 * value in project configuration is ignored — and is recorded per run.
 */
export function proposerCustomisationsDecision(input: {
  readonly optIns?: readonly SeenValue[];
}): CustomisationsDecision {
  const seen = input.optIns ?? [];
  const accepted = seen.find((one) => one.origin === "user-config" && one.value === true);
  const project = seen.find((one) => one.origin === "project-config" && one.value === true);
  if (accepted !== undefined) {
    return {
      customisations: "on",
      nativeMemory: "on",
      offFlags: [],
      optIn: { key: PI_CUSTOMISATIONS_KEY, origin: accepted.origin },
      trustClass: "widening",
      projectConfigIgnored: true,
      recordedPerRun: true,
    };
  }
  return {
    customisations: "off",
    nativeMemory: "off",
    offFlags: ["--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates"],
    optIn: project === undefined ? null : { key: PI_CUSTOMISATIONS_KEY, origin: "project-config" },
    trustClass: "widening",
    projectConfigIgnored: true,
    recordedPerRun: true,
  };
}

// ---------------------------------------------------------------------------
// The critic: trust, flag set, proof, sessions, pick, window, diversity
// (F134-FR-017 to F134-FR-022, F134-FR-030; T023, phase 4)
// ---------------------------------------------------------------------------

/** The result of the diversity test (row 183 of annex X §X.6). */
export type PiDiversityResult = (typeof resultsOfTheDiversityTest.members)[number];

/** The initial record of a pi stream, as the proof of the seam reads it. */
export type InitialRecord = {
  /** The tools the harness started with; empty for the tool-less form. */
  readonly tools?: readonly string[];
  /** The session id the harness ran in, when it reports one. */
  readonly sessionId?: string | null;
};

/** The typed failure of a refused critic call, and what the run does with it. */
export const PI_CRITIC_REFUSAL = Object.freeze({
  failure: CRITIC_NOT_TOOLLESS,
  stopReason: CRITIC_CONFIG_STOP_REASON,
  exitCode: ENGINE_EXIT_CODE_OF_CRITIC_CONFIG,
} as const);

/**
 * F134-FR-017 — project-local resources are UNTRUSTED for both roles: the
 * approval option is never passed, project trust is never set, the explicit
 * ignore flags are passed by default, and the print-mode default is not
 * relied on alone. Pure: it reads the descriptor tables and the argv given.
 */
export function piProjectLocalTrustDecision(input: { readonly argv: readonly string[] }): {
  readonly projectLocalResources: "untrusted";
  readonly approvalOptionPassed: false;
  readonly projectTrustSet: false;
  readonly explicitIgnorePassed: boolean;
  readonly printModeDefaultReliedUpon: false;
} {
  const approvalOptionPassed = input.argv.some((one) =>
    ["--approve", "--approval-mode", "--yolo", "--dangerously-skip-permissions"].includes(one),
  );
  if (approvalOptionPassed) {
    throw new Error("the approval option is never passed for either role (F134-FR-017)");
  }
  const explicitIgnorePassed = ["--no-extensions", "--no-skills", "--no-context-files"].every(
    (flag) => input.argv.includes(flag),
  );
  return Object.freeze({
    projectLocalResources: "untrusted",
    approvalOptionPassed: false,
    projectTrustSet: false,
    explicitIgnorePassed,
    printModeDefaultReliedUpon: false,
  });
}

/** The flags a critic argv must never carry: each allows a tool or a bypass. */
export const PI_CRITIC_FORBIDDEN_FLAGS: readonly string[] = Object.freeze([
  "--tools",
  "--approve",
  "--yolo",
  "--dangerously-skip-permissions",
  "--session",
  "--session-id",
  "--session-dir",
]);

/**
 * F134-FR-018 — the guard of the critic flag set: the argv of a critic call
 * holds the WHOLE flag set of the descriptor and no flag that allows a tool
 * or a bypass. Pure; it answers, it does not launch anything.
 */
export function piCriticFlagGuard(input: { readonly argv: readonly string[] }): {
  readonly holdsFullFlagSet: boolean;
  readonly missingFlags: readonly string[];
  readonly allowsToolOrBypass: false;
  readonly promptOnStdin: true;
  readonly emptyWorkdir: boolean;
} {
  const flagSet = criticFlagSet();
  const missingFlags = flagSet.filter((flag) => !input.argv.includes(flag));
  const forbidden = input.argv.filter((one) => PI_CRITIC_FORBIDDEN_FLAGS.includes(one));
  if (forbidden.length > 0) {
    throw new Error(
      `a critic path never receives a flag that allows a tool or a bypass: ${forbidden.join(", ")}`,
    );
  }
  return Object.freeze({
    holdsFullFlagSet: missingFlags.length === 0,
    missingFlags,
    allowsToolOrBypass: false,
    promptOnStdin: true,
    emptyWorkdir: input.argv.includes("-p") && input.argv.includes("--no-session"),
  });
}

/**
 * F134-FR-018 — harness-native memory and context files are off for EVERY
 * critic call, and the setting is recorded per call.
 */
export function criticMemoryDecision(): {
  readonly memory: "off";
  readonly contextFiles: "off";
  readonly extensions: "off";
  readonly skills: "off";
  readonly promptTemplates: "off";
  readonly recordedPerCall: true;
} {
  return Object.freeze({
    memory: "off",
    contextFiles: "off",
    extensions: "off",
    skills: "off",
    promptTemplates: "off",
    recordedPerCall: true,
  });
}

/** What the adapter knows of one critic call when it proves the mode. */
export type PiCriticCallFacts = {
  /** The session id the adapter minted for THIS critic call. */
  readonly mintedSessionId: string;
  /** The version of pi installed and used by the call, or null. */
  readonly installedVersion: string | null;
  /** Whether the preflight of the adapter passed for the critic role. */
  readonly preflightPassed: boolean;
  /** True: pi is a tested adapter (origin `adapter`, pinned, verified). */
  readonly tested?: boolean;
  /**
   * The flag set the call actually ran with, when the record of the call
   * states it; absent means the descriptor's first-form flag set is used.
   * An EMPTY set is stated absence: the weaker proof refuses it.
   */
  readonly flagSetUsed?: readonly string[];
};

/** The result of `piCriticProof`: the seam's proof plus the refusal facts. */
export type PiFirstFormProof =
  | {
      readonly accepted: true;
      readonly proofKind: "initial-record" | "pinned-configuration";
      readonly weakerProof: boolean;
      readonly sessionProofCase:
        "caller-minted-id" | "harness-given-id" | "no-session-in-the-initial-record";
      readonly sessionId: string;
    }
  | {
      readonly accepted: false;
      readonly reason: string;
      readonly failure: typeof CRITIC_NOT_TOOLLESS;
      /** The reply of a refused call is not read. */
      readonly replyRead: false;
      /** The run halts with this engine exit code. */
      readonly exitCode: 3;
      readonly stopReason: typeof CRITIC_CONFIG_STOP_REASON;
    };

/**
 * T023 (F134-FR-019, F109-FR-038, Principle IX v3.0.1) — the proof of the
 * critic mode of pi, a PURE function of the initial record of the stream and
 * the record of the call. Three outcomes:
 *
 *  - the initial record shows the minted identity and, where it states a tool
 *    list, an EMPTY one: the proof is `initial-record`, the call proceeds;
 *  - the initial record lists a tool: refused — `critic_not_toolless`, the run
 *    halts with exit 3 and the stop reason `critic_config`, the reply is never
 *    read;
 *  - the stream states no tool list: the weaker proof stands only with the
 *    EXACT version pin of the tested adapter (`0.80.6`, not merely a version
 *    inside the range), a passed preflight and the whole flag set in the call
 *    record — recorded as the weaker proof, per call. Any of the three
 *    missing is the same refusal.
 */
export function piCriticProof(input: {
  readonly initialRecord: InitialRecord | null;
  readonly call: PiCriticCallFacts;
}): PiFirstFormProof {
  const proof = proveFirstForm({
    fixed: { form: "tool-less", fixedBeforeCall: true },
    mintedSessionId: input.call.mintedSessionId,
    initialRecord: input.initialRecord,
    tested: input.call.tested ?? true,
    pinned: {
      pin: PI_EXACT_PIN,
      installedVersion: input.call.installedVersion ?? "",
      preflightPassed: input.call.preflightPassed,
      flagSet: input.call.flagSetUsed ?? criticFlagSet(),
    },
  });
  if (proof.accepted) return proof;
  return Object.freeze({
    ...proof,
    failure: CRITIC_NOT_TOOLLESS,
    exitCode: ENGINE_EXIT_CODE_OF_CRITIC_CONFIG as 3,
    stopReason: CRITIC_CONFIG_STOP_REASON,
  });
}

/**
 * F134-FR-020 — a critic call never shares a session with a pass: the id of
 * the critic is minted apart, and this check runs over the records of the
 * run. True means a clash was found and the run must refuse the record.
 */
export function criticSessionClash(
  criticSessionId: string,
  passSessionIds: readonly (string | null | undefined)[],
): boolean {
  return passSessionIds.some((one) => one !== null && one !== undefined && one === criticSessionId);
}

/** The forms of the critic pi offers (F134-FR-021): the tool-less one only. */
export function criticFormsOffered(): readonly ["tool-less"] {
  return ["tool-less"] as const;
}

/** Why pi is (or is not) picked automatically as the critic (F134-FR-021). */
export type AutomaticCriticPick = {
  readonly picked: boolean;
  readonly reason: string;
  /** True where the pick would need the hard spending cap and it is not set. */
  readonly hardCapRequired: boolean;
};

/**
 * F134-FR-021 — pi is picked automatically as critic ONLY as a tested
 * adapter, ONLY where the row of the provider in use allows it, never for a
 * provider whose terms are unknown, and on a metered provider only with the
 * hard spending cap of F100-FR-093.
 */
export function automaticCriticPick(input: {
  readonly tested: boolean;
  readonly providerRowAllows: boolean;
  readonly termsKnown: boolean;
  readonly metered?: boolean;
  readonly hardCapSet?: boolean;
}): AutomaticCriticPick {
  if (!input.tested) {
    return {
      picked: false,
      reason: "an automatic pick is open to a tested adapter only",
      hardCapRequired: false,
    };
  }
  if (!input.termsKnown) {
    return {
      picked: false,
      reason: "the terms of the provider are unknown: never picked automatically",
      hardCapRequired: false,
    };
  }
  if (!input.providerRowAllows) {
    return {
      picked: false,
      reason: "the row of the provider in use does not allow the pick",
      hardCapRequired: false,
    };
  }
  if (input.metered === true && input.hardCapSet !== true) {
    return {
      picked: false,
      reason: "a metered provider needs the hard spending cap of F100-FR-093",
      hardCapRequired: true,
    };
  }
  return {
    picked: true,
    reason: "tested adapter, the provider's row allows it, the terms are known",
    hardCapRequired: input.metered === true,
  };
}

/**
 * F134-FR-022 — the window in use is the SMALLER of the declared and the
 * effective value; there is NO default for a model with no known window, and
 * pi is not offered as critic on that model.
 */
export function contextWindowInUse(input: {
  readonly declared: number | null | undefined;
  readonly effective: number | null | undefined;
}): number | null {
  const declared = typeof input.declared === "number" && input.declared > 0 ? input.declared : null;
  const effective =
    typeof input.effective === "number" && input.effective > 0 ? input.effective : null;
  if (declared === null || effective === null) return null;
  return Math.min(declared, effective);
}

/** Whether the critic is offered on a model, from the window in use. */
export function criticOfferedForModel(windowInUse: number | null): boolean {
  return windowInUse !== null;
}

/** The identity of one pi call, for the diversity test (F134-FR-030). */
export type PiCallIdentity = {
  readonly role: CallRole;
  /** The provider in use, from the descriptor's provider resolution. */
  readonly provider: string | null;
  /** The model id exactly as the call sends it. */
  readonly modelSent: string | null;
  /** The model the diversity test compares: the same id, trimmed. */
  readonly model: string | null;
};

/**
 * F134-FR-030 — the provider and the model of EVERY pi call are recorded so
 * that the diversity test can compare them.
 */
export function piCallIdentity(input: {
  readonly role: CallRole;
  readonly provider: string | null | undefined;
  readonly model: string | null | undefined;
}): PiCallIdentity {
  const provider =
    typeof input.provider === "string" && input.provider.trim() !== ""
      ? input.provider.trim()
      : null;
  const model =
    typeof input.model === "string" && input.model.trim() !== "" ? input.model.trim() : null;
  return Object.freeze({ role: input.role, provider, modelSent: model, model });
}

/**
 * F134-FR-030 — the diversity result for one pi call (the comparison of
 * F100-FR-024): `same-model` against a model that produced a pass,
 * `unverified` where either side is unknown, `same-provider` on a shared
 * provider with differing models, `diverse` otherwise.
 */
export function piDiversityResult(
  identity: PiCallIdentity,
  modelsThatProducedPasses: readonly (string | null | undefined)[],
  providersThatProducedPasses?: readonly (string | null | undefined)[],
): PiDiversityResult {
  const normalize = (model: string | null | undefined): string | null =>
    typeof model === "string" && model.trim().length > 0 ? model.trim().toLowerCase() : null;
  const critic = normalize(identity.model);
  if (critic === null) return "unverified";
  const passes = modelsThatProducedPasses.map(normalize);
  if (passes.some((one) => one === null)) return "unverified";
  if (passes.includes(critic)) return "same-model";
  const criticProvider = normalize(identity.provider);
  const passProviders = (providersThatProducedPasses ?? []).map(normalize);
  if (criticProvider !== null && passProviders.includes(criticProvider)) return "same-provider";
  return "diverse";
}

/**
 * F134-FR-030 — the critic-diversity decision of one pi critic call: the
 * warning is raised and RECORDED for `same-model` and for `unverified`, and
 * it NEVER blocks a run. A shared provider alone or a shared model tier alone
 * (`same-provider`) raises no warning.
 */
export function piDiversityDecision(
  identity: PiCallIdentity,
  modelsThatProducedPasses: readonly (string | null | undefined)[],
  providersThatProducedPasses?: readonly (string | null | undefined)[],
): {
  readonly diversity: PiDiversityResult;
  readonly warningRaised: boolean;
  readonly warningName: "critic-diversity warning";
  readonly recorded: true;
  readonly blocksRun: false;
} {
  const diversity = piDiversityResult(
    identity,
    modelsThatProducedPasses,
    providersThatProducedPasses,
  );
  return Object.freeze({
    diversity,
    warningRaised: (DIVERSITY_RESULTS_THAT_WARN as readonly string[]).includes(diversity),
    warningName: "critic-diversity warning",
    recorded: true,
    blocksRun: false,
  });
}

// ---------------------------------------------------------------------------
// The terms decision and the refusal of the subscription-login path
// (T025; F134-FR-005, F134-FR-006, F134-FR-007)
// ---------------------------------------------------------------------------

/** The input of the terms decision of one call of pi. */
export type PiTermsInput = {
  /** The provider in use; null when the consumer has not stated one. */
  readonly provider: string | null | undefined;
  /** The auth tier of the call: 1 or 2 for an API key, 3 for a login. */
  readonly authTier: AuthTier;
  /** The audience of the consumer's configuration. */
  readonly audience: Audience;
};

/** The decision of the terms gate plus what the adapter does with it. */
export type PiTermsDecision = TermsDecision & {
  /** A refused launch never starts a process of pi. */
  readonly startsProcess: boolean;
  /**
   * Unknown terms are usable when the consumer names pi, never a default and
   * never picked automatically (F134-FR-005; F147-FR-008).
   */
  readonly usableOnlyWhenConsumerNamesPi: boolean;
  /** Where in the launch the gate ran; a refusal precedes every pass. */
  readonly evaluatedAt: "launch" | "role-resolution" | "fallback-switch";
};

/**
 * The terms decision for one call of pi (F134-FR-005): the row of the
 * PROVIDER in use decides, evaluated by the gate of EP-11 `specstride.terms/1`
 * — pi holds no row of its own. The rows are the table of the terms gate
 * (the data of feature 147), handed in so this hook stays a pure function of
 * its inputs. Auth tier 3 ships refused for every provider and both
 * audiences. No provider, or no row for it: unknown terms — allowed with the
 * unknown-terms warning, never a default and never an automatic pick.
 */
export function piTermsDecision(
  input: PiTermsInput,
  rows: readonly TermsRow[] = [],
  evaluatedAt: PiTermsDecision["evaluatedAt"] = "launch",
): PiTermsDecision {
  if (input.authTier === 3) {
    const row =
      rows.find(
        (one) =>
          one.provider === input.provider && one.authTier === 3 && one.audience === input.audience,
      ) ?? null;
    return Object.freeze({
      decision: "refused",
      row,
      explanation: `tier 3 ships refused for every provider and both audiences (${AUTH_TIER_3_SHIPS}; F134-FR-006)`,
      startsProcess: false,
      usableOnlyWhenConsumerNamesPi: false,
      evaluatedAt,
    });
  }
  const row =
    input.provider === null || input.provider === undefined || input.provider.trim() === ""
      ? undefined
      : rows.find(
          (one) =>
            one.provider === input.provider &&
            one.authTier === input.authTier &&
            one.audience === input.audience,
        );
  if (row === undefined) {
    const unknown = noRowOutcome(input.authTier);
    return Object.freeze({
      ...unknown,
      startsProcess: unknown.decision !== "refused",
      usableOnlyWhenConsumerNamesPi: true,
      evaluatedAt,
    });
  }
  if (row.status === "refused") {
    return Object.freeze({
      decision: "refused",
      row,
      explanation: `the row of the provider ${input.provider} is refused (F134-FR-005)`,
      startsProcess: false,
      usableOnlyWhenConsumerNamesPi: false,
      evaluatedAt,
    });
  }
  if (row.status === "personal-only" && input.audience === "distributed") {
    return Object.freeze({
      decision: "refused",
      row,
      explanation: `the row of the provider ${input.provider} is personal-only; the audience is distributed (F134-FR-005)`,
      startsProcess: false,
      usableOnlyWhenConsumerNamesPi: false,
      evaluatedAt,
    });
  }
  return Object.freeze({
    decision: row.status === "conditional" ? "allowed-with-warning" : "allowed",
    row,
    explanation:
      row.status === "conditional"
        ? `the row of the provider ${input.provider} is conditional; the conditions of the row hold (F134-FR-005)`
        : `the row of the provider ${input.provider} decides: allowed (F134-FR-005)`,
    warning: row.status === "conditional" ? row.quotedSentence : undefined,
    startsProcess: true,
    usableOnlyWhenConsumerNamesPi: false,
    evaluatedAt,
  });
}

/** The input of the subscription-login refusal. */
export type PiSubscriptionLoginInput = {
  /** The provider whose subscription login path a configuration named. */
  readonly provider: string;
  /** The audience of the consumer's configuration. */
  readonly audience: Audience;
};

/** What the refusal of a subscription-login path states. */
export type PiSubscriptionLoginRefusal = {
  readonly decision: "refused";
  readonly explanation: string;
  /** No process of pi starts for a refused login path (F134-FR-006). */
  readonly startsProcess: false;
  /** The refusal happens at launch, before preflight and any pass. */
  readonly stage: "launch";
  /** The adapter never starts the login itself (F134-FR-007). */
  readonly loginStarted: false;
};

/**
 * The refusal of a subscription-login path of pi (T025; F134-FR-006): the
 * OAuth login for a Claude subscription — and every login that reuses the
 * subscription token of a provider whose row says so — is auth tier 3, and
 * tier 3 ships refused for both audiences. A configuration that names such a
 * path is refused with the explanation, and no process of pi starts.
 */
export function piSubscriptionLoginRefusal(
  input: PiSubscriptionLoginInput,
): PiSubscriptionLoginRefusal {
  return Object.freeze({
    decision: "refused" as const,
    explanation: `the ${input.provider} subscription login path of pi is auth tier 3, and tier 3 ships refused for both audiences (F134-FR-006; ruling 59)`,
    startsProcess: false as const,
    stage: "launch" as const,
    loginStarted: false as const,
  });
}

/** The no-login facts of the adapter (F134-FR-007), asserted by CT-134-7. */
export const PI_NO_LOGIN_GUARANTEES = Object.freeze({
  /** The adapter never starts a login of pi. */
  startsLogin: false,
  /** The adapter never writes the auth file of pi. */
  writesAuthFile: false,
  /** The adapter never sets or changes the trust of a project. */
  setsProjectTrust: false,
  /** An installed login or plugin is never a consent of the consumer. */
  installedLoginIsConsent: false,
});

// ---------------------------------------------------------------------------
// The hooks object the registration hands to the registry (T040)
// ---------------------------------------------------------------------------

/** The ids of the hooks this adapter ships, in registration order. */
export const PI_HOOK_IDS = [
  "detect",
  "version-pin",
  "containment",
  "parallel-units",
  "preflight",
  "proposer-invocation",
  "session",
  "home",
  "telemetry",
  "customisations",
  "critic-invocation",
  "critic-proof",
  "critic-diversity",
  "terms",
  "no-login",
] as const;

export type PiHookId = (typeof PI_HOOK_IDS)[number];

/** One hook entry: the id, the requirement it serves, the function. */
export type PiHookEntry = {
  readonly id: PiHookId;
  readonly serves: string;
  readonly run: (...args: readonly never[]) => unknown;
};

/** The hooks of the adapter, as the registry entry carries them. */
export const PI_HOOKS: readonly PiHookEntry[] = Object.freeze([
  { id: "detect", serves: "F134-FR-002", run: detectPi as unknown as () => unknown },
  { id: "version-pin", serves: "F134-FR-003", run: piVersionWarning as unknown as () => unknown },
  { id: "containment", serves: "F134-FR-008", run: piContainment as unknown as () => unknown },
  {
    id: "parallel-units",
    serves: "F134-FR-009",
    run: piParallelUnitsDecision as unknown as () => unknown,
  },
  { id: "preflight", serves: "F134-FR-004", run: piPreflight as unknown as () => unknown },
  {
    id: "proposer-invocation",
    serves: "F134-FR-011; F134-FR-012",
    run: buildProposerInvocation as unknown as () => unknown,
  },
  {
    id: "session",
    serves: "F134-FR-013; F134-FR-014",
    run: sessionDecision as unknown as () => unknown,
  },
  { id: "home", serves: "F134-FR-015", run: homeDecision as unknown as () => unknown },
  { id: "telemetry", serves: "F134-FR-016", run: telemetryEnv as unknown as () => unknown },
  {
    id: "customisations",
    serves: "F134-FR-029",
    run: proposerCustomisationsDecision as unknown as () => unknown,
  },
  {
    id: "critic-invocation",
    serves: "F134-FR-017; F134-FR-018; F134-FR-021; F134-FR-022",
    run: piCriticFlagGuard as unknown as () => unknown,
  },
  {
    id: "critic-proof",
    serves: "F134-FR-019; F134-FR-020",
    run: piCriticProof as unknown as () => unknown,
  },
  {
    id: "critic-diversity",
    serves: "F134-FR-030",
    run: piDiversityDecision as unknown as () => unknown,
  },
  {
    id: "terms",
    serves: "F134-FR-005; F134-FR-006",
    run: ((input: unknown, rows?: readonly TermsRow[], at?: PiTermsDecision["evaluatedAt"]) =>
      piTermsDecision(input as PiTermsInput, rows, at)) as unknown as () => unknown,
  },
  {
    id: "no-login",
    serves: "F134-FR-007",
    run: (() => PI_NO_LOGIN_GUARANTEES) as unknown as () => unknown,
  },
]);

/** The hook named `id`, or undefined. */
export function piHookOf(id: PiHookId): PiHookEntry | undefined {
  return PI_HOOKS.find((one) => one.id === id);
}

/** Re-exported for the registration record; the base allow-list of the seam. */
export { PI_BASE_ENV_ALLOW, PI_HARNESS_ENV_ALLOW } from "./descriptor.ts";
export { criticArgv, criticFlagSet } from "./descriptor.ts";
