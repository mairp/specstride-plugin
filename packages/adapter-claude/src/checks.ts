/**
 * T074 — the doctor checks of the Claude harness adapter (F125-FR-006),
 * registered as entries of the doctor check registry of feature 100
 * (annex G §G.7, F100-FR-189) through the registration call of the kernel
 * (`registerDoctorCheck`).
 *
 * The ids are the ones F125-FR-006 proposes; they are stable and are never
 * renamed:
 *
 *   `harness.claude.bin`                  the executable and its path
 *   `harness.claude.auth`                 the credential of the role
 *   `harness.version.claude`              the version against the range
 *   `harness.claude.managed-settings`     administrator-managed settings
 *   `harness.claude.sandbox`              sandbox offered, user other than root
 *   `harness.claude.sdk`                  the state of the SDK transport
 *   `harness.claude.concurrent-sessions`  the state of the capability
 *
 * Guarantees of an implementation (§G.7): every probe READS and never
 * writes, makes no paid call, reads no secret value, opens no credential
 * store and performs no I/O at all — every observed fact arrives INJECTED in
 * `ClaudeDoctorFacts`, and the probe only shapes what the severity rule
 * judges. A login at auth tier 1 is established by an existence probe the
 * caller ran; the check sees the boolean, never the credential. A secret
 * reference is seen by NAME, never by value.
 */
import { registerDoctorCheck } from "@specstride/kernel";
import type { DoctorCheck, Severity } from "@specstride/contracts/ep/doctor";
import { SDK_AVAILABILITY_STATES, type SdkAvailability } from "./sdk/load.ts";

/** The seven stable ids, in registration order (F125-FR-006). */
export const CLAUDE_DOCTOR_CHECK_IDS = [
  "harness.claude.bin",
  "harness.claude.auth",
  "harness.version.claude",
  "harness.claude.managed-settings",
  "harness.claude.sandbox",
  "harness.claude.sdk",
  "harness.claude.concurrent-sessions",
] as const;
export type ClaudeDoctorCheckId = (typeof CLAUDE_DOCTOR_CHECK_IDS)[number];

/** The observed facts the checks judge; every one is injected, none is probed here. */
export type ClaudeDoctorFacts = {
  /** The executable and its path (F125-FR-001). */
  readonly bin: {
    /** Whether the executable resolved to an absolute path. */
    readonly present: boolean;
    readonly path: string | null;
    /** Why detection refused a placement, where it did. */
    readonly refusal: string | null;
    /** The warning for a path that changed since the last run (F100-FR-080). */
    readonly changedPathWarning: string | null;
    /** Whether Claude is used by a role of the launch (launch-blocking then). */
    readonly usedByARole: boolean;
  };
  /** The credential of the role (F125-FR-006). */
  readonly auth: {
    readonly tier: 1 | 2;
    /** Auth tier 1: that a login exists — an existence fact, never its value. */
    readonly loginPresent: boolean | null;
    /** Auth tier 2: that the secret reference exists, by NAME, never its value. */
    readonly secretReferenceName: string | null;
    /** How the login presence was established (no paid call, no network). */
    readonly loginEstablishedBy: string;
  };
  /** The version against the tested range (F125-FR-003). */
  readonly version: {
    /** The version the pass recorded; every pass records the version it ran. */
    readonly recorded: string | null;
    readonly inRange: boolean | null;
    /** A change of version between passes of one run is surfaced as a warning. */
    readonly changedBetweenPasses: boolean;
  };
  /** Administrator-managed settings, which still apply in the isolated mode. */
  readonly managedSettings: {
    readonly present: boolean;
    /** The path, as metadata; never a setting value. */
    readonly path: string | null;
  };
  /** The containment preconditions (F125-FR-019, F125-FR-012). */
  readonly sandbox: {
    /** Whether the operating system offers the sandbox for commands. */
    readonly offered: boolean;
    /** Whether the user is root (the bypass precondition requires not-root). */
    readonly userIsRoot: boolean;
  };
  /** The state of the transport that needs the SDK (F125-FR-036). */
  readonly sdk: {
    readonly availability: SdkAvailability;
    readonly version: string | null;
    /** The warning outside the range, where the loader produced one. */
    readonly warning: string | null;
  };
  /** The state of the capability `concurrentSessions` (F125-FR-019). */
  readonly concurrentSessions: {
    /** Null until capture B; never guessed. */
    readonly value: null;
    readonly status: "unverified";
  };
};

const isRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/** The cell of the observed facts a severity rule judges: the probe may
 * hand the whole `ClaudeDoctorFacts` or only the slice of one check. */
function cell(observed: unknown, key: string): Record<string, unknown> {
  const outer = isRecord(observed);
  const inner = isRecord(outer[key]);
  return Object.keys(inner).length > 0 ? inner : outer;
}

/**
 * The probe of every check: it receives the injected facts of the run under
 * `injected.claude` (or the facts the check was registered with) and returns
 * them untouched for the severity rule. It performs no I/O, no paid call and
 * reads no secret value: it is a pure function over data.
 */
function pureProbe(facts: ClaudeDoctorFacts) {
  return async (injected: Readonly<Record<string, unknown>> = {}): Promise<unknown> => {
    const observed = isRecord(injected["claude"]);
    return Object.keys(observed).length > 0
      ? observed
      : (facts as unknown as Record<string, unknown>);
  };
}

/**
 * The seven checks of the Claude harness adapter (F125-FR-006), in the shape
 * of annex G §G.7: a stable id, a severity rule, the launch-blocking flag,
 * an order, a message template of at most 200 bytes and a fix hint.
 */
export function claudeDoctorChecks(facts: ClaudeDoctorFacts): readonly DoctorCheck[] {
  const bin: DoctorCheck = {
    id: "harness.claude.bin",
    severityRule: (observed: unknown): Severity => {
      const o = cell(observed, "bin");
      if (o.refusal !== undefined && o.refusal !== null) return "fail";
      if (o.present === true) return "ok";
      return o.usedByARole === false ? "warn" : "fail";
    },
    lb: true,
    order: 10,
    probe: pureProbe(facts),
    messageTemplate: "the claude executable is resolved to an absolute path on the search path",
    fixHint:
      "install Claude Code so that `claude` is on the search path outside the workspace and outside a world-writable directory",
  };

  const auth: DoctorCheck = {
    id: "harness.claude.auth",
    severityRule: (observed: unknown): Severity => {
      const o = cell(observed, "auth");
      if (o.tier === 2) return o.secretReferenceName ? "ok" : "fail";
      return o.loginPresent === true ? "ok" : o.loginPresent === null ? "warn" : "fail";
    },
    lb: true,
    order: 20,
    probe: pureProbe(facts),
    messageTemplate:
      "the credential of the role exists: a login at auth tier 1, a named secret reference at auth tier 2",
    fixHint:
      "sign in with `claude` for auth tier 1, or set the secret reference of the API key for auth tier 2; the value is never read",
  };

  const version: DoctorCheck = {
    id: "harness.version.claude",
    severityRule: (observed: unknown): Severity => {
      const o = cell(observed, "version");
      if (o.changedBetweenPasses === true) return "warn";
      if (o.inRange === true) return "ok";
      return "warn"; // outside the range is a warning, never a block (F125-FR-003)
    },
    lb: false,
    order: 30,
    probe: pureProbe(facts),
    messageTemplate: "the recorded version lies in the tested range 2.1.259 to 2.1.284",
    fixHint:
      "record the version every pass; a version outside the range warns and does not block, and nothing is downloaded to pin it",
  };

  const managedSettings: DoctorCheck = {
    id: "harness.claude.managed-settings",
    severityRule: (observed: unknown): Severity => {
      const o = cell(observed, "managedSettings");
      return o.present === true ? "info" : "ok";
    },
    lb: false,
    order: 40,
    probe: pureProbe(facts),
    messageTemplate:
      "administrator-managed settings are present and still apply inside the isolated mode",
    fixHint:
      "read the managed settings file the doctor names; the initial-record assertions remain the backstop",
  };

  const sandbox: DoctorCheck = {
    id: "harness.claude.sandbox",
    severityRule: (observed: unknown): Severity => {
      const o = cell(observed, "sandbox");
      return o.offered === true && o.userIsRoot === false ? "ok" : "warn";
    },
    lb: false,
    order: 50,
    probe: pureProbe(facts),
    messageTemplate:
      "the operating system offers the sandbox for commands and the user is other than root",
    fixHint:
      "run as a non-root user where the platform offers the command sandbox; this decides the containment ceiling and the bypass precondition",
  };

  const sdk: DoctorCheck = {
    id: "harness.claude.sdk",
    severityRule: (observed: unknown): Severity => {
      const o = cell(observed, "sdk");
      if (o.availability === "available") return o.warning ? "warn" : "ok";
      if (o.availability === "not-chosen") return "ok";
      return "warn";
    },
    lb: false,
    order: 60,
    probe: pureProbe(facts),
    messageTemplate: "the transport that needs the Agent SDK is in the state the loader reports",
    fixHint:
      "install the optional peer dependency in the consumer's own installation, or keep the subprocess transport; the product never installs it",
  };

  const concurrentSessions: DoctorCheck = {
    id: "harness.claude.concurrent-sessions",
    severityRule: (observed: unknown): Severity => {
      const o = cell(observed, "concurrentSessions");
      return o.value === null ? "info" : "ok";
    },
    lb: false,
    order: 70,
    probe: pureProbe(facts),
    messageTemplate:
      "the capability concurrentSessions is null (unverified) until fixture capture B decides it",
    fixHint:
      "run fixture capture B (packages/adapter-claude/test/fixtures/capture-b-concurrent-sessions.md); nothing is guessed meanwhile",
  };

  return [bin, auth, version, managedSettings, sandbox, sdk, concurrentSessions];
}

/**
 * Registers the seven checks of the harness adapter as entries of the doctor
 * check registry of feature 100 (annex G §G.7) through the kernel's
 * registration call. Idempotent per id: the kernel replaces a check
 * registered again under the same id.
 */
export function registerClaudeDoctorChecks(
  facts: ClaudeDoctorFacts,
): readonly ClaudeDoctorCheckId[] {
  for (const check of claudeDoctorChecks(facts)) registerDoctorCheck(check);
  return CLAUDE_DOCTOR_CHECK_IDS;
}

/** The availability states the SDK check reads (re-exported for the tests). */
export { SDK_AVAILABILITY_STATES };
