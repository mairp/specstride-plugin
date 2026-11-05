/**
 * T096 — the three doctor checks of every harness (F109-FR-024).
 *
 * Every harness adapter — and the generic harness adapter for every
 * descriptor — registers three doctor checks with stable ids:
 *
 *   `harness.<id>.present`    whether the executable or the endpoint is present
 *   `harness.<id>.credential` whether the credential of the role is present
 *                             and not refused
 *   `harness.<id>.version-pin` whether the version is inside the pinned range;
 *                             for a harness that is not `tested` this check
 *                             reports that no pin exists
 *
 * The ids are derived from the harness id alone, so they are stable across
 * processes and runs; they are never renamed.
 *
 * No check makes a paid call and no check reads a secret VALUE: a probe
 * receives the observed facts injected (annex G, §G.7), and the evidence of a
 * finding names the credential — never its value.
 */
import type { DoctorCheck, DoctorFinding, Severity } from "@specstride/contracts/ep/doctor";
import { versionDoctorWarning } from "../versions/versions.ts";

/** The three kinds of check, in registration order (F109-FR-024). */
export const HARNESS_DOCTOR_CHECK_KINDS = ["present", "credential", "version-pin"] as const;
export type HarnessDoctorCheckKind = (typeof HARNESS_DOCTOR_CHECK_KINDS)[number];

/** The stable id of one check of one harness. */
export function harnessDoctorCheckId(harness: string, kind: HarnessDoctorCheckKind): string {
  return `harness.${harness}.${kind}`;
}

/** The stable ids of the three checks of one harness, in order. */
export function harnessDoctorCheckIds(harness: string): readonly string[] {
  return HARNESS_DOCTOR_CHECK_KINDS.map((kind) => harnessDoctorCheckId(harness, kind));
}

/**
 * The observed facts one harness's checks judge. Everything arrives injected:
 * a probe never runs the harness, never calls an endpoint and never reads a
 * credential value — presence is a `boolean`, the credential is named, and the
 * version is the string the harness itself states.
 */
export type HarnessDoctorFacts = {
  readonly harness: string;
  /** Whether the harness is a tested harness adapter. */
  readonly tested: boolean;
  /** Whether the executable (kind `cli`) or the endpoint (a completion kind) is present. */
  readonly present: boolean;
  /** Whether the credential of the role is present and not refused. */
  readonly credentialPresent: boolean;
  /** The NAME of the credential (an environment variable, a reference) — never its value. */
  readonly credentialName: string;
  /** What to fix when the credential is missing. */
  readonly credentialFix: string;
  /** The version the harness stated, or `null` where it states none. */
  readonly version: string | null;
  /** The pinned range, for a tested harness adapter. */
  readonly versionRange: string | null;
};

const PRESENT_TEMPLATE = "the harness is present and answers its version read";
const PRESENT_MISSING = "the executable or the endpoint of the harness is not present";
const CREDENTIAL_TEMPLATE = "the credential of the role is present";
const CREDENTIAL_MISSING = "the credential of the role is missing or refused";
const PIN_PRESENT = "the version is inside the pinned range of the tested harness adapter";
const PIN_NO_PIN = "the harness is not tested: no version pin exists for it";

/**
 * The three doctor checks of one harness, in the shape of annex G §G.7. The
 * probes read the injected facts only; none of them performs I/O.
 */
export function harnessDoctorChecks(facts: HarnessDoctorFacts): readonly DoctorCheck[] {
  const kindOf = (observed: unknown): Record<string, unknown> =>
    typeof observed === "object" && observed !== null ? (observed as Record<string, unknown>) : {};

  const present: DoctorCheck = {
    id: harnessDoctorCheckId(facts.harness, "present"),
    severityRule: (observed) => (kindOf(observed).present === true ? "ok" : "fail"),
    lb: true,
    order: 1,
    probe: async (injected) => ({
      present: injected.present ?? false,
      harness: facts.harness,
    }),
    messageTemplate: PRESENT_TEMPLATE,
    fixHint: "install the harness or correct the address of the endpoint in the descriptor",
  };

  const credential: DoctorCheck = {
    id: harnessDoctorCheckId(facts.harness, "credential"),
    severityRule: (observed) => (kindOf(observed).credentialPresent === true ? "ok" : "fail"),
    lb: true,
    order: 2,
    probe: async (injected) => ({
      // The NAME of the credential travels; no VALUE does.
      credentialPresent: injected.credentialPresent ?? false,
      credentialName: facts.credentialName,
    }),
    messageTemplate: CREDENTIAL_TEMPLATE,
    fixHint: facts.credentialFix,
  };

  const pin: DoctorCheck = {
    id: harnessDoctorCheckId(facts.harness, "version-pin"),
    severityRule: (observed) => {
      const o = kindOf(observed);
      if (o.tested !== true) return "info"; // no pin exists: reported, not failed
      return o.warning === null ? "ok" : "warn";
    },
    lb: false,
    order: 3,
    probe: async (_injected) => ({
      tested: facts.tested,
      version: facts.version,
      versionRange: facts.versionRange,
      warning: versionDoctorWarning({
        harness: facts.harness,
        tested: facts.tested,
        version: facts.version,
        range: facts.versionRange,
      }),
    }),
    messageTemplate: PIN_PRESENT,
    fixHint: "narrow the descriptor's versionRange to the version the verification proved",
  };

  return [present, credential, pin];
}

/**
 * Register the three checks of one harness with the doctor's registration
 * call (annex G, §G.7; the registry lives in the kernel). Idempotent: the
 * registry replaces a check with the same stable id. Returns the ids in
 * registration order.
 */
export function registerHarnessDoctorChecks(
  register: (check: DoctorCheck) => void,
  facts: HarnessDoctorFacts,
): readonly string[] {
  const checks = harnessDoctorChecks(facts);
  for (const check of checks) register(check);
  return checks.map((check) => check.id);
}

/** The finding of one run check (the outputs of §G.7). */
export function findingOf(check: DoctorCheck, observed: unknown, message?: string): DoctorFinding {
  const severity: Severity = check.severityRule(observed);
  return {
    id: check.id,
    severity,
    lb: check.lb,
    message:
      message ?? (severity === "ok" || severity === "info" ? check.messageTemplate : check.fixHint),
    fix: check.fixHint,
    evidence: evidenceOf(check, observed),
  };
}

/**
 * The redacted evidence of a finding: the harness id, the credential NAME and
 * the version — never the value of a credential (F109-FR-024).
 */
export function evidenceOf(check: DoctorCheck, observed: unknown): string {
  const o =
    typeof observed === "object" && observed !== null ? (observed as Record<string, unknown>) : {};
  const parts = [`harness=${String(o.harness ?? check.id.split(".")[1] ?? "?")}`];
  if (typeof o.credentialName === "string") parts.push(`credential=${o.credentialName}`);
  if ("version" in o) parts.push(`version=${o.version === null ? "none" : String(o.version)}`);
  if ("tested" in o) parts.push(`tested=${String(o.tested)}`);
  if ("present" in o) parts.push(`present=${String(o.present)}`);
  return parts.join(", ");
}

/**
 * Run the three checks of one harness against the injected facts and return
 * the three findings, in the stable order present, credential, version-pin.
 */
export async function runHarnessDoctorChecks(
  facts: HarnessDoctorFacts,
): Promise<readonly DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  for (const check of harnessDoctorChecks(facts)) {
    const observed = await check.probe({});
    findings.push(findingOf(check, observed, findingMessage(check, facts)));
  }
  return findings;
}

function findingMessage(check: DoctorCheck, facts: HarnessDoctorFacts): string {
  switch (check.id.split(".")[2]) {
    case "present":
      return facts.present ? PRESENT_TEMPLATE : PRESENT_MISSING;
    case "credential":
      return facts.credentialPresent
        ? CREDENTIAL_TEMPLATE
        : `${CREDENTIAL_MISSING} (${facts.credentialName})`;
    default:
      if (!facts.tested || facts.versionRange === null) return PIN_NO_PIN;
      return facts.version !== null &&
        versionDoctorWarning({
          harness: facts.harness,
          tested: facts.tested,
          version: facts.version,
          range: facts.versionRange,
        }) === null
        ? PIN_PRESENT
        : (versionDoctorWarning({
            harness: facts.harness,
            tested: facts.tested,
            version: facts.version,
            range: facts.versionRange,
          }) ?? PIN_PRESENT);
  }
}
