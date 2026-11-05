/**
 * T153 — the interface types of EP-14, the doctor check registry, from
 * `contracts/extension-points/EP-14.doctor.json` and annex G, §G.7
 * (F100-FR-189).
 *
 * `specstride.doctor/1`. Every package registers checks of the consumer's
 * set-up, and the launch checks are the same tests as the doctor's: exactly
 * the checks whose flag `lb` is set.
 */
import type { DoctorFindings } from "../records/doctor-findings.ts";

export const POINT_ID = "specstride.doctor/1" as const;
export const EP = "EP-14" as const;
export const ANNEX_SECTION = "annex G, §G.7" as const;

/** F100-FR-189 — the one operation of the point. */
export const OPERATIONS = ["run"] as const;
export type DoctorOperation = (typeof OPERATIONS)[number];

/** The closed set of severities (§G.7). */
export const SEVERITIES = ["ok", "info", "warn", "fail"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Unknown-value rule of §G.7: a severity a reader does not know is read as `warn`. */
export const SEVERITY_WHEN_UNKNOWN: Severity = "warn";

/** The cap of a message template, in bytes (§G.7, Inputs). */
export const MESSAGE_TEMPLATE_CAP_BYTES = 200 as const;

/** One registered check (§G.7, Inputs). */
export type DoctorCheck = {
  /** A stable dotted id; ids are never renamed. */
  readonly id: string;
  readonly severityRule: (observed: unknown) => Severity;
  /** Launch-blocking. */
  readonly lb: boolean;
  readonly order: number;
  /** The probe receives injected probes. */
  probe(injected: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** At most 200 bytes. */
  readonly messageTemplate: string;
  readonly fixHint: string;
};

/** One finding of the doctor (§G.7, Outputs). */
export type DoctorFinding = {
  readonly id: string;
  readonly severity: Severity;
  readonly lb: boolean;
  readonly message: string;
  readonly fix: string;
  /** Redacted evidence. */
  readonly evidence: string;
};

/** The context and the flags `run` is handed (§G.7, Inputs). */
export type DoctorRunInput = {
  readonly context: Readonly<Record<string, unknown>>;
  readonly flags: Readonly<Record<string, unknown>>;
};

/** F100-FR-189 — the doctor: a registry of checks. */
export type DoctorRegistry = {
  register(check: DoctorCheck): void;
  registered(): readonly DoctorCheck[];
  run(input: DoctorRunInput): Promise<readonly DoctorFinding[]>;
};

/** F100-FR-189 — the launch checks are exactly the `lb` subset. */
export function launchChecks(checks: readonly DoctorCheck[]): readonly DoctorCheck[] {
  return Object.freeze([...checks].filter((c) => c.lb).sort((a, b) => a.order - b.order));
}

/** The `--json` output of the doctor follows the schema of §G.7. */
export type DoctorJson = DoctorFindings;
export const SCHEMA_ID = "specstride.doctor/1" as const;

/** "Guarantees of the core" of §G.7, as data. */
export const CORE_GUARANTEES = [
  "the launch checks are exactly the `lb` subset, so the doctor and a launch cannot disagree",
  "the critic-diversity warning is never `lb`",
  "the doctor never blocks a run by being unhealthy",
  "ids are never renamed",
] as const;

/** The critic-diversity warning is never launch-blocking (§G.7). */
export const CRITIC_DIVERSITY_WARNING_IS_LB = false as const;

/** "Guarantees of an implementation" of §G.7, as data. */
export const IMPLEMENTATION_GUARANTEES = [
  "a check reads and never writes",
  "makes no paid call",
  "reads no secret value",
  "opens no credential store",
  "closes standard input of every process it starts",
  "keeps to its time limit and its output cap",
] as const;

/** "Errors" of §G.7: a probe that times out gives this warning. */
export const PROBE_TIMED_OUT_MESSAGE = "probe timed out" as const;
/** A check that throws makes the doctor exit 1 and does nothing to a run. */
export const EXIT_WHEN_A_CHECK_THROWS = 1 as const;

/**
 * "Failure of an implementation" of §G.7 — the plainer path: the check's
 * finding is a warning with the message `probe timed out`, or the doctor
 * exits 1; a failing check of the `lb` subset at launch refuses the launch.
 */
export const FAILURE_PATH =
  "the check's finding is a warning with the message `probe timed out`, or the doctor exits 1; a failing check of the `lb` subset at launch refuses the launch" as const;
export const FAILURE_PATHS: Readonly<Record<DoctorOperation, string>> = Object.freeze({
  run: FAILURE_PATH,
});

/** Unknown-value rule of §G.7: an unknown check id in a filter is a usage error. */
export const UNKNOWN_CHECK_ID_IN_A_FILTER_EXIT_CODE = 3 as const;

/** The number of checks of the catalogue of feature 112 (§G.7, Wave 1). */
export const CATALOGUE_SIZE = 44 as const;

/** The six launch checks of the as-is supervisor, in this order (§G.7, Wave 1). */
export const AS_IS_LAUNCH_CHECKS = [
  "launcher-intact",
  "contract-validated",
  "authorized-root",
  "launcher-syntax",
  "launcher-dry-run",
  "run-directory-free",
] as const;

/** The form in which a harness adapter proposes the ids of its checks (§G.7). */
export const HARNESS_CHECK_ID_FORM = "harness.<id>.<check>" as const;

/** The registration call lives in the kernel package (§G.7, Wave 1). */
export const REGISTRATION_CALL_LIVES_IN = "@specstride/kernel" as const;
