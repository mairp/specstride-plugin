/**
 * T032 — the five doctor checks of the pi adapter (F134-FR-010), registered
 * as entries of the doctor registry of EP-14 `specstride.doctor/1`
 * (F100-FR-189; annex G §G.7).
 *
 * The five ids the requirement proposes (CQ-108: feature 112 confirms them),
 * in the order of the requirement:
 *
 *   `harness.pi.executable`    the executable is found (launch-blocking)
 *   `harness.pi.version`       the version is inside the pinned range (warn)
 *   `harness.pi.credential`    the credential REFERENCE is present — the
 *                              check names the reference, never its value
 *                              (launch-blocking)
 *   `harness.pi.containment`   the ceiling C0 and whether the opt-in stands
 *                              in user configuration (warn; the launch
 *                              refusal itself is the hook of F134-FR-008)
 *   `harness.pi.project-trust` the two settings that keep project-local
 *                              resources untrusted (warn)
 *
 * Guarantees of an implementation (§G.7): every check READS and NEVER
 * writes, makes no paid call, opens no credential store, reads no secret
 * value and keeps to the time limit and the output cap of the doctor. The
 * probes perform no input or output of their own: they judge the INJECTED
 * facts and return them, so the same checks run on fixtures and a finding
 * cannot carry a value it did not judge.
 *
 * Registration goes through the kernel call `registerDoctorCheck` (annex G
 * §G.7: "The registration call lives in the kernel package, so that a
 * package registers checks without importing the doctor"). This module
 * imports no doctor.
 */
import { registerDoctorCheck } from "@specstride/kernel";
import { CONTAINMENT_OPT_IN_KEY } from "@specstride/harness";
import type { DoctorCheck, Severity } from "@specstride/contracts/ep/doctor";
import { PI_EXACT_PIN, PI_VERIFIED_ON, PI_VERSION_RANGE } from "./descriptor.ts";

/**
 * The explicit ignore flags of F134-FR-017, as the project-trust check names
 * them: the settings that keep project-local resources untrusted.
 */
export const PI_DOCTOR_IGNORE_FLAGS: readonly string[] = Object.freeze([
  "--no-extensions",
  "--no-skills",
  "--no-context-files",
  "--no-prompt-templates",
]);

/** The prefix every check of this adapter carries (F134-FR-010). */
export const PI_DOCTOR_CHECK_PREFIX = "harness.pi." as const;

/** The five stable ids, in the order the requirement names them. */
export const PI_DOCTOR_CHECK_IDS: readonly string[] = Object.freeze([
  "harness.pi.executable",
  "harness.pi.version",
  "harness.pi.credential",
  "harness.pi.containment",
  "harness.pi.project-trust",
]);

/** The checks that refuse a launch when they fail: executable and credential. */
export const PI_DOCTOR_LAUNCH_CHECK_IDS: readonly string[] = Object.freeze([
  "harness.pi.executable",
  "harness.pi.credential",
]);

/**
 * T037 — every macOS statement of this adapter is `unverified` (ruling 67:
 * Linux and macOS are both first-class, but no macOS runner has run any
 * check of this feature). The doctor text states the mark where a finding
 * could rest on a macOS-only fact, and never states a macOS fact as held.
 */
export const MACOS_STATEMENT_UNVERIFIED: string =
  "macOS: unverified — no macOS runner has run this feature; the executable path, the " +
  "overlay modes and the absence of a sandbox of pi are held for Linux only (ruling 67)";

/**
 * T037 — the checks a macOS runner must pass before release. Recorded as
 * data so the verification record and the doctor name the same list; the
 * runner part itself is never run and never faked here (owner ruling of
 * 2026-09-30, see the verification record).
 */
export const MACOS_RUNNER_CHECKS: readonly string[] = Object.freeze([
  "harness.pi.executable — pi resolves by name on macOS (the descriptor names no path)",
  "harness.pi.version — `pi --version` answers inside >=0.80.6 <0.81 on macOS",
  "harness.pi.credential — the key reaches pi by environment on macOS, never by argument",
  "harness.pi.containment — a launch without the C0 opt-in is refused on macOS",
  "harness.pi.project-trust — the ignore flags and --no-approve hold on macOS argv parsing",
  "isolation.configHome — the overlay home (PI_CODING_AGENT_DIR) is created and removed on macOS",
  "session — a pass continues by the exact session id on macOS (CAP-4, out of band)",
  "telemetry — PI_TELEMETRY=0 silences the harness's own telemetry on macOS",
]);

/** The observed facts the five probes judge; everything arrives injected. */
export type PiDoctorObserved = {
  /** Whether the executable is found; the resolved path, where it is. */
  readonly present: boolean;
  readonly path: string | null;
  /** The version pi stated, or null where it stated none. */
  readonly version: string | null;
  /** Whether the version is inside the pinned range. */
  readonly inRange: boolean;
  /** Whether the credential REFERENCE of the role is present (never its value). */
  readonly credentialReferencePresent: boolean;
  /** The name of the credential reference (the variable, never a value). */
  readonly credentialReferenceName: string | null;
  /** Whether the C0 opt-in stands in user configuration. */
  readonly c0OptInHeld: boolean;
  /** Whether the two project-trust settings hold for the argv in force. */
  readonly projectTrustHolds: boolean;
};

const MESSAGE_TEMPLATES: Readonly<Record<string, string>> = Object.freeze({
  "harness.pi.executable": "the executable of pi is found and its resolved path is recorded",
  "harness.pi.version": `the version of pi is inside the tested range ${PI_VERSION_RANGE}`,
  "harness.pi.credential":
    "the credential reference of the role is present; the check names it, never its value",
  "harness.pi.containment":
    "the containment ceiling is C0 and the opt-in stands in the user configuration",
  "harness.pi.project-trust":
    "project-local resources stay untrusted: no approval option, no project trust, the ignore flags passed",
});

function factsOf(observed: unknown): PiDoctorObserved {
  return observed as PiDoctorObserved;
}

/**
 * The probe answers with the observed facts and NOTHING else: what a caller
 * adds to the injected record (a planted secret value, a flag) never comes
 * back, so a finding cannot carry a value it did not judge.
 */
function pickFacts(injected: Readonly<Record<string, unknown>>): PiDoctorObserved {
  return {
    present: injected.present === true,
    path: typeof injected.path === "string" ? injected.path : null,
    version: typeof injected.version === "string" ? injected.version : null,
    inRange: injected.inRange === true,
    credentialReferencePresent: injected.credentialReferencePresent === true,
    credentialReferenceName:
      typeof injected.credentialReferenceName === "string"
        ? injected.credentialReferenceName
        : null,
    c0OptInHeld: injected.c0OptInHeld === true,
    projectTrustHolds: injected.projectTrustHolds === true,
  };
}

/**
 * F134-FR-010 — the five checks of the adapter, in registration order. The
 * probes perform no input or output of their own; the evidence of a finding
 * names the reference and the path — never a value.
 */
export function piDoctorChecks(): readonly DoctorCheck[] {
  const checks: DoctorCheck[] = [
    {
      id: "harness.pi.executable",
      severityRule: (observed) => (factsOf(observed).present === true ? "ok" : "fail"),
      lb: true,
      order: 1,
      probe: async (injected) => pickFacts(injected),
      messageTemplate: MESSAGE_TEMPLATES["harness.pi.executable"] as string,
      fixHint: `install pi, or put it on the search path; pinned ${PI_EXACT_PIN}, verified-on ${PI_VERIFIED_ON}. ${MACOS_STATEMENT_UNVERIFIED}`,
    },
    {
      id: "harness.pi.version",
      severityRule: (observed): Severity => (factsOf(observed).inRange === true ? "ok" : "warn"),
      lb: false,
      order: 2,
      probe: async (injected) => pickFacts(injected),
      messageTemplate: MESSAGE_TEMPLATES["harness.pi.version"] as string,
      fixHint:
        "nothing is installed or downloaded to reach the pin; record the gap. " +
        MACOS_STATEMENT_UNVERIFIED,
    },
    {
      id: "harness.pi.credential",
      severityRule: (observed) =>
        factsOf(observed).credentialReferencePresent === true ? "ok" : "fail",
      lb: true,
      order: 3,
      probe: async (injected) => pickFacts(injected),
      messageTemplate: MESSAGE_TEMPLATES["harness.pi.credential"] as string,
      fixHint:
        "set the provider's key variable that the secret reference names, before the role " +
        "in use is launched; pi is never logged in and no auth file is read",
    },
    {
      id: "harness.pi.containment",
      severityRule: (observed): Severity =>
        factsOf(observed).c0OptInHeld === true ? "ok" : "warn",
      lb: false,
      order: 4,
      probe: async (injected) => pickFacts(injected),
      messageTemplate: MESSAGE_TEMPLATES["harness.pi.containment"] as string,
      fixHint: `set ${CONTAINMENT_OPT_IN_KEY}=C0 in the user configuration; the opt-in from the environment, a flag or project configuration is not accepted`,
    },
    {
      id: "harness.pi.project-trust",
      severityRule: (observed): Severity =>
        factsOf(observed).projectTrustHolds === true ? "ok" : "warn",
      lb: false,
      order: 5,
      probe: async (injected) => pickFacts(injected),
      messageTemplate: MESSAGE_TEMPLATES["harness.pi.project-trust"] as string,
      fixHint: `keep the two settings: the approval option is never passed and the ignore flags ${PI_DOCTOR_IGNORE_FLAGS.join(" ")} are passed by default`,
    },
  ];
  return checks;
}

/**
 * The registration call through EP-14 (F100-FR-189): registers the five
 * checks with the kernel's doctor registry and returns them, in the order
 * of the requirement. Idempotent per id (the kernel call replaces a check
 * already registered under the same id).
 */
export function registerPiDoctorChecks(
  register: (check: DoctorCheck) => void = registerDoctorCheck,
): readonly DoctorCheck[] {
  const checks = piDoctorChecks();
  for (const check of checks) register(check);
  return checks;
}

/** The one line that lists the facts still `unverified` (the doctor text). */
export function piUnverifiedFactsLine(facts: readonly string[]): string {
  return facts.length === 0 ? "none" : facts.join("; ");
}
