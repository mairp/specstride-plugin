/**
 * T005 (feature 112) — the finding, the check type and the probe bag of the
 * doctor (F112-FR-001; EP-14, `specstride.doctor/1`).
 *
 * The finding model is the one extracted from Lisa's doctor (research D-1):
 * id, severity, message, evidence, remedy. Feature 112 adds `lb`, so a
 * launch-blocking finding is recognisable in the output, and restates the
 * `DoctorCheck` of `@specstride/contracts/ep/doctor` with the one field the
 * registry adds: the `group` (F112-FR-002, row 134).
 *
 * Every probe a check may touch is a member of the probe bag and is injected:
 * the same check runs on a fixture of the test tree without the real machine
 * (F112-FR-001, last sentence). The bag is data; a check that reads the clock,
 * the file system, a subprocess, the network, the resolved registry, the
 * resolved configuration or the records of a run reads it from `bag` and from
 * nowhere else.
 */
import {
  SEVERITIES,
  SEVERITY_WHEN_UNKNOWN,
  MESSAGE_TEMPLATE_CAP_BYTES,
  type DoctorCheck,
  type Severity,
} from "@specstride/contracts/ep/doctor";
import { groupsOfADoctorCheck } from "@specstride/contracts/enums/all-sets";

export { SEVERITIES, SEVERITY_WHEN_UNKNOWN, MESSAGE_TEMPLATE_CAP_BYTES, groupsOfADoctorCheck };
export type { Severity, DoctorCheck } from "@specstride/contracts/ep/doctor";

/** Row 134 — the 19 groups of a doctor check. Another group is refused at registration. */
export type CheckGroup = (typeof groupsOfADoctorCheck.members)[number];
/** The 19 groups as a frozen array, for the refusal message and the tests. */
export const GROUPS: readonly CheckGroup[] = groupsOfADoctorCheck.members;

/**
 * One finding of the doctor — Lisa's model: id, severity, message, evidence,
 * remedy — with the `lb` flag of feature 112 (F112-FR-001). The evidence is
 * redacted before it reaches the finding; the remedy is the fix hint of the
 * check, filled with what the probe observed.
 */
export type Finding = {
  readonly id: string;
  readonly severity: Severity;
  readonly lb: boolean;
  readonly message: string;
  /** Redacted evidence, as data. Never a secret value, never an account id. */
  readonly evidence: Readonly<Record<string, unknown>>;
  /** The remedy: the fix hint of the check, rendered for the finding. */
  readonly remedy: string;
};

/**
 * One registered check (F112-FR-001): a stable dotted id (never renamed), one
 * group of the 19, the launch-blocking flag, an order, a severity rule, a
 * message template of at most 200 bytes, a fix hint, and a probe that receives
 * the injected probe bag.
 */
export type Check = DoctorCheck & {
  /** One of the 19 groups of row 134. Another group is refused at registration. */
  readonly group: CheckGroup;
};

/**
 * One entry of the resolved harness registry (EP-02 `specstride.harness/1`,
 * read, not owned): a tested harness adapter, a discovered harness, or one the
 * consumer declared (F112-FR-009). No check names a harness by name — every
 * per-harness entry is produced from entries of this shape (F112-FR-009).
 */
export type HarnessState = "tested" | "locally-verified" | "declared" | "detected";

export type HarnessEntry = {
  /** The logical id of the harness, as the registry resolved it. */
  readonly id: string;
  /** The state of the harness (`tested`, `locally-verified`, `declared`, `detected`). */
  readonly state: HarnessState;
  /** The roles the harness is selected for (proposer, critic, ...). */
  readonly roles?: readonly string[];
  /** The resolved path of the harness executable, when it was found. */
  readonly resolvedPath?: string;
  /** The installed version, when it could be read. */
  readonly version?: string;
  /** The tested version range of its conformance run. */
  readonly testedRange?: { readonly min?: string; readonly max?: string };
  /** The date of the last verified conformance run (ISO date). */
  readonly verifiedOn?: string;
  /** The capabilities the harness declares (window, ...). */
  readonly declaredCaps?: Readonly<Record<string, unknown>>;
  /** The capabilities a probe measured. */
  readonly probedCaps?: Readonly<Record<string, unknown>>;
  /** Tool ids the harness exposes that its critic disable list does not cover. */
  readonly uncoveredTools?: readonly string[];
};

/** The clock of the bag: monotonic-enough wall time, and a wait. */
export type ProbeClock = {
  readonly now: () => number;
  readonly wait: (ms: number) => Promise<void>;
};

/** What a subprocess the bag ran came back with. */
export type SubprocessResult = {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the probe was ended at its time limit. */
  readonly timedOut: boolean;
  /** True when the output was cut at the cap. */
  readonly truncated: boolean;
  /** True when `--quick` skipped the call: nothing ran. */
  readonly skipped?: boolean;
};

/**
 * The subprocess runner of the bag: stdin closed, a time limit, an output cap
 * and a process group that is ended (F112-FR-007). The bag's runner never
 * inherits the caller's streams.
 */
export type SubprocessRunner = {
  readonly run: (command: string, args: readonly string[]) => Promise<SubprocessResult>;
};

/** The network reader of the bag: GET only, redirects refused (research D-11). */
export type NetworkReader = {
  readonly get: (url: string) => Promise<{ readonly status: number; readonly body: string }>;
};

/** The file metadata reader of the bag: existence, size and mode, never content. */
export type FileMetadataReader = {
  readonly stat: (path: string) => { readonly size: number; readonly mode: number } | undefined;
};

/**
 * The probe bag (F112-FR-001): every probe a check touches, injected. `quick`
 * is the `--quick` mode: the runner skips the checks that would touch a
 * subprocess or the network (F112-FR-007).
 */
export type ProbeBag = {
  readonly clock: ProbeClock;
  readonly files: FileMetadataReader;
  readonly subprocess: SubprocessRunner;
  readonly network: NetworkReader;
  /** The resolved registry: the ids the registration surface holds. */
  readonly registry: {
    readonly ids: readonly string[];
    /** The resolved harness registry: the entries the per-harness checks read (F112-FR-009). */
    readonly harnesses?: readonly HarnessEntry[];
  };
  /** The resolved configuration, already loaded by the loader of feature 110. */
  readonly config: { readonly values: ReadonlyMap<string, unknown> };
  /** The records of the runs the doctor may read (annex B §B.5). */
  readonly runs: readonly unknown[];
  /** `--quick`: subprocess and network checks are skipped. */
  readonly quick: boolean;
  /** The probe time limit, in ms (default 5 s, R16 F2). */
  readonly timeLimitMs: number;
  /** The subprocess output cap, in bytes (default 64 KiB, R16 F2). */
  readonly outputCapBytes: number;
};
