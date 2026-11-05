/**
 * T056 — the doctor checks of the prime harness adapter
 * (F138-FR-006, F138-FR-007; user story 5).
 *
 * The adapter registers these checks with the doctor, each free of charge
 * and reading no secret value:
 *   executable-present (lb), version-in-range, launcher-present,
 *   credential-of-role (lb, per role in use), terms-unknown (warning),
 *   containment-opt-in (lb when prime is the proposer), critic-window-known.
 * The ids are of the form `harness.prime.<check>`. A check that times out is
 * a WARNING and never raises the code above that of a warning. The known
 * failure the adapter cannot detect (a model configuration that makes a
 * gateway reject the call, surfacing in prime as a misleading model error)
 * is classified by its words like any other error and is NOT guessed: the
 * doctor does not claim to check it, and no check here does.
 */
import type { DoctorCheck, Severity } from "@specstride/contracts/ep/doctor";
import { registerDoctorCheck } from "@specstride/kernel";
import { primeDescriptor } from "../descriptor/index.ts";
import { versionInRange } from "../detect/index.ts";
import { termsAreUnknown, UNKNOWN_TERMS_WARNING } from "../descriptor/tier.ts";
import {
  PRIME_CONTAINMENT_CEILING,
  c0OptInDecision,
  type OptInSource,
} from "../descriptor/containment.ts";
import type { PrimeRole } from "../environment/auth.ts";

/** The id form of every check of this adapter. */
export const PRIME_DOCTOR_ID_PREFIX = "harness.prime." as const;

/** One id of the form `harness.prime.<check>`. */
export function primeDoctorId(check: string): `${typeof PRIME_DOCTOR_ID_PREFIX}${string}` {
  return `${PRIME_DOCTOR_ID_PREFIX}${check}`;
}

/** The known failure the adapter cannot detect (F138-FR-007). */
export const KNOWN_UNDETECTABLE_FAILURE =
  "a model configuration that makes a gateway reject the call surfaces in " +
  "prime as a misleading model error; the adapter classifies such an error " +
  "by its words, as it classifies any other error, and does not guess a cause";

/** The observed value a probe hands its check's severity rule. */
export type PrimeProbeObservation = {
  readonly ok: boolean;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly timedOut?: boolean;
  readonly skipped?: boolean;
};

/** The default time limit of a probe, in milliseconds. */
export const PRIME_DOCTOR_TIMEOUT_MS = 2_000;

/** Run one probe under the time limit; a timeout is an observation, not a throw. */
export async function runPrimeProbe(
  probe: (injected: Readonly<Record<string, unknown>>) => Promise<unknown>,
  injected: Readonly<Record<string, unknown>> = {},
  timeoutMs: number = PRIME_DOCTOR_TIMEOUT_MS,
): Promise<PrimeProbeObservation> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PrimeProbeObservation>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, timedOut: true, detail: { timeoutMs } }),
      timeoutMs,
    );
  });
  try {
    const value = await Promise.race([probe(injected), timeout]);
    if (value && typeof value === "object" && "ok" in (value as object)) {
      return value as PrimeProbeObservation;
    }
    return { ok: true, detail: {} };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The severity of one observation under one check's own rule. */
export function severityOf(check: DoctorCheck, observed: PrimeProbeObservation): Severity {
  // A timed-out check is a warning, never a code above a warning; a probe
  // that settled keeps its own rule's verdict.
  if (observed.timedOut) return "warn";
  return check.severityRule(observed);
}

/** The bag one probe of this adapter is handed (injected; never the machine). */
export type PrimeDoctorBag = {
  /** The resolved path of the agent executable, when found. */
  readonly executablePath?: string | null;
  /** The installed version, when it could be read. */
  readonly version?: string | null;
  /** The launcher path, when a variant is configured and it was found. */
  readonly launcherPath?: string | null;
  /** True when a variant is configured (the launcher check then applies). */
  readonly variantConfigured?: boolean;
  /** The credential state of each role: `present` or `unprobed` (never a value). */
  readonly credentialState?: Readonly<Record<PrimeRole, "present" | "unprobed" | "absent">>;
  /** Whether the consumer opted in to C0, and from where. */
  readonly optInSource?: OptInSource | null;
  /** True when prime is named as the proposer (the containment check is lb). */
  readonly primeIsProposer?: boolean;
  /** The known context window of the critic, when one is known. */
  readonly criticWindow?: number | null;
};

/** The version range the descriptor was verified on (the detect module judges it). */
export const PRIME_VERSION_RANGE: string = String(primeDescriptor.versionRange);

const ruleOk = (observed: unknown): Severity =>
  (observed as PrimeProbeObservation).ok ? "ok" : "warn";
const ruleFailWhenAbsent = (observed: unknown): Severity =>
  (observed as PrimeProbeObservation).ok ? "ok" : "fail";

/**
 * The checks of the prime adapter (F138-FR-006). The `lb` flags follow
 * CQ-150: executable, credential and containment (when prime is the
 * proposer) are launch-blocking; the others are not.
 */
export const primeDoctorChecks: readonly DoctorCheck[] = Object.freeze([
  {
    id: primeDoctorId("executable-present"),
    severityRule: ruleFailWhenAbsent,
    lb: true,
    order: 10,
    probe: (injected) =>
      Promise.resolve({
        ok: Boolean((injected as PrimeDoctorBag).executablePath),
        detail: { what: "the agent executable (the launcher is not probed for a version)" },
      }),
    messageTemplate: "the prime agent executable is present",
    fixHint: "install the prime agent executable, or name its path in the configuration",
  },
  {
    id: primeDoctorId("version-in-range"),
    severityRule: (observed) => {
      const o = observed as PrimeProbeObservation;
      if (!o.ok) return "fail";
      const version = String(o.detail?.version ?? "");
      return versionInRange(version, PRIME_VERSION_RANGE) ? "ok" : "warn";
    },
    lb: true,
    order: 20,
    probe: (injected) =>
      Promise.resolve({
        ok: typeof (injected as PrimeDoctorBag).version === "string",
        detail: { version: (injected as PrimeDoctorBag).version ?? null },
      }),
    messageTemplate: `the prime version is in the range ${PRIME_VERSION_RANGE}`,
    fixHint: `install a prime version in the range ${PRIME_VERSION_RANGE}`,
  },
  {
    id: primeDoctorId("launcher-present"),
    severityRule: ruleOk,
    lb: false,
    order: 30,
    probe: (injected) => {
      const bag = injected as PrimeDoctorBag;
      // Only applies when a variant is configured; otherwise the check is ok.
      if (!bag.variantConfigured) return Promise.resolve({ ok: true, detail: { applied: false } });
      return Promise.resolve({
        ok: Boolean(bag.launcherPath),
        detail: { applied: true, launcherPath: bag.launcherPath ?? null },
      });
    },
    messageTemplate: "the consumer's launcher is present for the configured variant",
    fixHint: "install the launcher the variant names, or drop the variant",
  },
  {
    id: primeDoctorId("credential-of-role"),
    severityRule: (observed) => {
      const o = observed as PrimeProbeObservation;
      const state = String(o.detail?.state ?? "absent");
      if (state === "absent") return "fail";
      return o.ok ? "ok" : "warn";
    },
    lb: true,
    order: 40,
    probe: (injected) => {
      const bag = injected as PrimeDoctorBag;
      const states = (bag.credentialState ?? {}) as Readonly<
        Record<PrimeRole, "present" | "unprobed" | "absent">
      >;
      const roles = Object.keys(states) as PrimeRole[];
      const absent = roles.filter((role) => (states[role] ?? "absent") === "absent");
      // `present` or `unprobed` are both fine; no secret value is read.
      return Promise.resolve({
        ok: absent.length === 0,
        detail: { state: absent.length === 0 ? "present-or-unprobed" : "absent", absent },
      });
    },
    messageTemplate: "the credential of each role in use exists or is unprobed",
    fixHint: "resolve the secret reference of the role that is missing its credential",
  },
  {
    id: primeDoctorId("terms-unknown"),
    severityRule: () => (termsAreUnknown() ? "warn" : "ok"),
    lb: false,
    order: 50,
    probe: () =>
      Promise.resolve({ ok: true, detail: { terms: termsAreUnknown() ? "unknown" : "known" } }),
    messageTemplate: UNKNOWN_TERMS_WARNING,
    fixHint: "read the harness's terms yourself; prime is usable only when named",
  },
  {
    id: primeDoctorId("containment-opt-in"),
    severityRule: (observed) => {
      const o = observed as PrimeProbeObservation;
      const detail = (o.detail ?? {}) as {
        optInSource?: OptInSource | null;
        primeIsProposer?: boolean;
      };
      const decision = c0OptInDecision(detail.optInSource ?? null);
      if (!decision.refused) return "ok";
      // Without the opt-in the proposer cannot run at all: launch-blocking.
      return detail.primeIsProposer === true ? "fail" : "warn";
    },
    lb: true,
    order: 60,
    probe: (injected) => {
      const bag = injected as PrimeDoctorBag;
      return Promise.resolve({
        ok: !c0OptInDecision(bag.optInSource ?? null).refused,
        detail: {
          ceiling: PRIME_CONTAINMENT_CEILING,
          optInSource: bag.optInSource ?? null,
          primeIsProposer: bag.primeIsProposer === true,
        },
      });
    },
    messageTemplate: `the containment ceiling is ${PRIME_CONTAINMENT_CEILING}; the opt-in state is reported`,
    fixHint: "add the opt-in to C0 in user configuration to run prime as proposer",
  },
  {
    id: primeDoctorId("critic-window-known"),
    severityRule: ruleOk,
    lb: false,
    order: 70,
    probe: (injected) => {
      const bag = injected as PrimeDoctorBag;
      const known = typeof bag.criticWindow === "number" && bag.criticWindow > 0;
      return Promise.resolve({ ok: known, detail: { criticWindow: bag.criticWindow ?? null } });
    },
    messageTemplate: "the context window of the prime critic is known",
    fixHint: "name the model's window in the configuration, or pick a model with a known window",
  },
]);

/**
 * Register the checks of this adapter with the doctor's registry (through
 * the kernel call, F100-FR-234). Idempotent per id.
 */
export function registerPrimeDoctorChecks(
  register: (check: DoctorCheck) => void = registerDoctorCheck,
): void {
  for (const check of primeDoctorChecks) register(check);
}

/** The ids of the checks, in the running order — what the doctor prints. */
export function primeDoctorCheckIds(): readonly string[] {
  return primeDoctorChecks.map((check) => check.id);
}

/** The `lb` subset, in the running order: what a launch runs. */
export function primeLaunchChecks(): readonly DoctorCheck[] {
  return primeDoctorChecks.filter((check) => check.lb);
}

/** One finding of this adapter's checks, as the doctor renders it. */
export type PrimeDoctorFinding = {
  readonly id: string;
  readonly severity: Severity;
  readonly lb: boolean;
  readonly message: string;
  readonly evidence: Readonly<Record<string, unknown>>;
};

/**
 * Run the checks of this adapter under one bag, each probe under the time
 * limit. A check that times out is a warning; no check ever raises the code
 * above that of a warning. No check reads a secret value.
 */
export async function runPrimeDoctorChecks(
  bag: PrimeDoctorBag = {},
  timeoutMs: number = PRIME_DOCTOR_TIMEOUT_MS,
): Promise<readonly PrimeDoctorFinding[]> {
  const findings: PrimeDoctorFinding[] = [];
  for (const check of primeDoctorChecks) {
    const observed = await runPrimeProbe(check.probe, bag, timeoutMs);
    findings.push({
      id: check.id,
      severity: severityOf(check, observed),
      lb: check.lb,
      message: check.messageTemplate,
      evidence: { ...(observed.detail ?? {}) },
    });
  }
  return findings;
}

/**
 * The known failure of F138-FR-007 is never a check of this adapter: the
 * doctor does not claim to check it. The tests read this predicate.
 */
export function doctorClaimsKnownFailure(): boolean {
  return primeDoctorChecks.some(
    (check) =>
      check.id.includes("model") ||
      check.messageTemplate.toLowerCase().includes("misleading") ||
      check.fixHint.toLowerCase().includes("misleading"),
  );
}

/**
 * The classification of the known failure is not guessed: it goes through
 * the same word classifier as any other error. This helper is the seam the
 * doctor hands a misleading model error to; it invents no cause of its own.
 */
export function classifyKnownFailureByWords<T>(input: {
  message: string;
  classify: (message: string) => T;
}): T {
  return input.classify(input.message);
}
