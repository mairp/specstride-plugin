/**
 * T021 — the doctor checks of the Codex adapter (F131-FR-006).
 *
 * Six checks, with the stable ids `harness.codex.*`:
 *
 *   `harness.codex.present`         the executable is found, with its path
 *   `harness.codex.credential`      login status at tier 1, or the key
 *                                   reference exists at tier 2
 *   `harness.codex.version-pin`     the version is inside the pinned range
 *   `harness.codex.sandbox`         whether the harness's sandbox can start
 *                                   on this machine, without a model call
 *   `harness.codex.read-denial`     the state of the read-denial confirmation
 *   `harness.codex.unverified-facts` one line that lists the facts still
 *                                   `unverified`
 *
 * Executable and credential are launch-blocking for a role in use; version,
 * sandbox, read denial and unverified facts are warnings. Every probe
 * receives its observed facts INJECTED: a check reads and never writes,
 * makes no paid call, reads no secret value and names the credential, never
 * its value.
 */

import type { DoctorCheck, Severity } from "@specstride/contracts/ep/doctor";
import { CODEX_KEY_VARIABLE } from "./preflight.ts";

/**
 * F131-FR-023 — the doctor states the exception of form (a) and its
 * residual risk, on the check that governs the form's use.
 */
export const FORM_A_DOCTOR_STATEMENT =
  "form (a) is a stated exception to Principles III and IX, limited to reading project files; residual risk: repository text reaches this critic without passing the grounding snapshot (ruling 57a; threat T-48); an unconfirmed read denial refuses the form" as const;

/** The stable ids of the six checks, in registration order. */
export const CODEX_DOCTOR_CHECK_IDS = [
  "harness.codex.present",
  "harness.codex.credential",
  "harness.codex.version-pin",
  "harness.codex.sandbox",
  "harness.codex.read-denial",
  "harness.codex.unverified-facts",
] as const;
export type CodexDoctorCheckId = (typeof CODEX_DOCTOR_CHECK_IDS)[number];

/** The observed facts the six probes judge; everything arrives injected. */
export type CodexDoctorFacts = {
  /** Whether the executable is found; the resolved path, where it is. */
  readonly present: boolean;
  readonly path: string | null;
  /** Whether the credential of the role is present (login or key reference). */
  readonly credentialPresent: boolean;
  /** The auth tier of the role; names the credential, never its value. */
  readonly tier: 1 | 2;
  /** The version the harness stated, or null where it states none. */
  readonly version: string | null;
  /** Whether the version is inside the pinned range. */
  readonly inRange: boolean;
  /** Whether the harness's sandbox can start on this machine, no model call. */
  readonly sandboxCanStart: boolean;
  /** Whether the read denial of F131-FR-019 is confirmed. */
  readonly readDenialConfirmed: boolean;
  /** The facts of this adapter that are still `unverified`. */
  readonly unverifiedFacts: readonly string[];
};

const MESSAGE_TEMPLATES: Readonly<Record<CodexDoctorCheckId, string>> = Object.freeze({
  "harness.codex.present": "the executable is found and its resolved path is recorded",
  "harness.codex.credential": "the credential of the role is present and not refused",
  "harness.codex.version-pin": "the version is inside the tested range; nothing is downloaded",
  "harness.codex.sandbox": "the sandbox of the harness can start on this machine",
  "harness.codex.read-denial": "the read denial of the read-only critic form is confirmed",
  "harness.codex.unverified-facts": "the unverified facts of this adapter, one line",
});

function factsOf(observed: unknown): CodexDoctorFacts {
  return observed as CodexDoctorFacts;
}

/**
 * The probe answers with the observed facts and NOTHING else: what a caller
 * adds to the injected record (a planted secret value, a flag) never comes
 * back, so a finding cannot carry a value it did not judge.
 */
function pickFacts(injected: Readonly<Record<string, unknown>>): CodexDoctorFacts {
  return {
    present: injected.present === true,
    path: typeof injected.path === "string" ? injected.path : null,
    credentialPresent: injected.credentialPresent === true,
    tier: injected.tier === 2 ? 2 : 1,
    version: typeof injected.version === "string" ? injected.version : null,
    inRange: injected.inRange === true,
    sandboxCanStart: injected.sandboxCanStart === true,
    readDenialConfirmed: injected.readDenialConfirmed === true,
    unverifiedFacts: Array.isArray(injected.unverifiedFacts)
      ? (injected.unverifiedFacts as readonly string[]).map(String)
      : [],
  };
}

/**
 * F131-FR-006 — the six doctor checks of the adapter, in registration order.
 * The probes perform no input or output of their own: they judge the injected
 * facts and record a finding. The evidence of a finding names the credential
 * and the path — never a value.
 */
export function codexDoctorChecks(): readonly DoctorCheck[] {
  const checks: DoctorCheck[] = [
    {
      id: "harness.codex.present",
      severityRule: (observed) => (factsOf(observed).present === true ? "ok" : "fail"),
      lb: true,
      order: 1,
      probe: async (injected) => pickFacts(injected),
      messageTemplate: MESSAGE_TEMPLATES["harness.codex.present"],
      fixHint: "install the harness CLI, or put it on the search path",
    },
    {
      id: "harness.codex.credential",
      severityRule: (observed) => (factsOf(observed).credentialPresent === true ? "ok" : "fail"),
      lb: true,
      order: 2,
      probe: async (injected) => pickFacts(injected),
      messageTemplate: MESSAGE_TEMPLATES["harness.codex.credential"],
      fixHint: "log the harness in, or set the key reference, before the role in use is launched",
    },
    {
      id: "harness.codex.version-pin",
      severityRule: (observed): Severity => (factsOf(observed).inRange === true ? "ok" : "warn"),
      lb: false,
      order: 3,
      probe: async (injected) => pickFacts(injected),
      messageTemplate: MESSAGE_TEMPLATES["harness.codex.version-pin"],
      fixHint: "nothing is installed or downloaded to reach the pin; record the gap",
    },
    {
      id: "harness.codex.sandbox",
      severityRule: (observed): Severity =>
        factsOf(observed).sandboxCanStart === true ? "ok" : "warn",
      lb: false,
      order: 4,
      probe: async (injected) => pickFacts(injected),
      messageTemplate: MESSAGE_TEMPLATES["harness.codex.sandbox"],
      fixHint: "a sandbox that cannot start refuses the sandboxed invocation shapes",
    },
    {
      id: "harness.codex.read-denial",
      severityRule: (observed): Severity =>
        factsOf(observed).readDenialConfirmed === true ? "ok" : "warn",
      lb: false,
      order: 5,
      probe: async (injected) => pickFacts(injected),
      messageTemplate: MESSAGE_TEMPLATES["harness.codex.read-denial"],
      fixHint: FORM_A_DOCTOR_STATEMENT,
    },
    {
      id: "harness.codex.unverified-facts",
      severityRule: (observed): Severity =>
        factsOf(observed).unverifiedFacts.length === 0 ? "ok" : "warn",
      lb: false,
      order: 6,
      probe: async (injected) => pickFacts(injected),
      messageTemplate: MESSAGE_TEMPLATES["harness.codex.unverified-facts"],
      fixHint: "run the check that settles each fact, then record its date and pin",
    },
  ];
  return checks;
}

/** The credential a finding may NAME at one tier — never its value. */
export function credentialNameForTier(tier: 1 | 2): string {
  return tier === 2 ? CODEX_KEY_VARIABLE : "the login of the consumer";
}

/** The one line that lists the facts still `unverified` (F131-FR-006). */
export function unverifiedFactsLine(facts: readonly string[]): string {
  return facts.length === 0 ? "none" : facts.join("; ");
}
