/**
 * T058 — the doctor checks that probe the platform tools (plan.md, "Primary
 * Dependencies": *Platform tools outside npm: `ps`, and `sysctl` on macOS;
 * both are probed by doctor checks*; quickstart, "Prerequisites": *`ps` on the
 * search path; on macOS also `sysctl`*).
 *
 * Two tools, two checks, and a different answer on each platform.
 *
 * **`ps`.** On macOS it is how the start time of a process, the list of
 * processes of the user and the walk of children are read, because there is
 * no process file system (research D-6, D-8). On Linux the process file
 * system answers all three and `ps` is not needed, so its absence is `info`
 * and not a warning: a Linux host without `ps` works.
 *
 * **`sysctl`.** On macOS it is the boot identity, which is what tells a reused
 * process id from the one that was recorded (D-6, row P2 of the probe
 * decision table). Without it a probe that could have said `stale-owner-dead`
 * says `unknown` instead, and an unknown lock refuses a launch — so on macOS
 * the check IS launch-blocking. On Linux the tool is irrelevant and the check
 * reports `ok` without looking for it.
 *
 * WHY THE SEVERITY DEPENDS ON THE PLATFORM, and why that is not a loophole.
 * EP-14 guarantees that *the launch checks are exactly the `lb` subset, so the
 * doctor and a launch cannot disagree.* `lb` is a FIELD of a registered
 * check, so it cannot be computed per run; the resolution is that there are
 * two checks and the registration picks which one of the pair is registered
 * for this platform. `platformChecksFor(platform)` is that pick, and the
 * doctor on a Linux host never holds the macOS check at all.
 *
 * A check reads and never writes, makes no paid call and starts nothing but
 * the probe of the tool itself, with standard input closed (§G.7).
 */
import {
  MESSAGE_TEMPLATE_CAP_BYTES,
  type DoctorCheck,
  type DoctorRegistry,
  type Severity,
} from "@specstride/contracts/ep/doctor";
import { bootIdentity, platformIo, type PlatformIo } from "../procs/platform.ts";

/** The requirement and the plan line these checks carry. */
export const PLATFORM_CHECK_REQUIREMENTS = ["F122-FR-013", "F122-FR-025", "F122-FR-027"] as const;
export const PLATFORM_CHECK_SOURCE = 'plan.md, "Primary Dependencies"' as const;

/** The two tools outside npm that this feature uses. */
export const PLATFORM_TOOLS = ["ps", "sysctl"] as const;
export type PlatformTool = (typeof PLATFORM_TOOLS)[number];

/** The platform each tool is needed on. */
export const TOOL_IS_NEEDED_ON: Readonly<Record<PlatformTool, readonly string[]>> = Object.freeze({
  ps: Object.freeze(["darwin"]),
  sysctl: Object.freeze(["darwin"]),
});

/** The ids. A hyphen in the middle segment makes each a check id, never a key. */
export const PS_CHECK_ID = "runtime.platform-tools.ps" as const;
export const SYSCTL_CHECK_ID = "runtime.platform-tools.sysctl" as const;

/** Where in the doctor's order they run: just after the survivors. */
export const PLATFORM_CHECK_FIRST_ORDER = 238 as const;

/** The key the checks read the platform seam out of the injected probes under. */
export const PLATFORM_IO_PROBE_KEY = "platformIo" as const;

/** The arguments `ps` is probed with: the cheapest call that proves it works. */
export const PS_PROBE_ARGUMENTS: readonly string[] = Object.freeze(["-o", "pid=", "-p", "1"]);

/** One reading of a tool. */
export type ToolReading = {
  readonly tool: PlatformTool;
  readonly platform: string;
  /** True where the tool answered. */
  readonly answered: boolean;
  /** True where this platform needs the tool at all. */
  readonly needed: boolean;
  /** What it answered, trimmed and capped; never a path of the consumer. */
  readonly sample: string;
};

/** Read the seam out of the injected probes; the live platform by default. */
export function platformIoFrom(injected: Readonly<Record<string, unknown>>): PlatformIo {
  const value = injected[PLATFORM_IO_PROBE_KEY];
  return value === undefined ? platformIo : (value as PlatformIo);
}

/** Probe `ps`: it is asked for the id of process 1 and must answer something. */
export function probePs(injected: Readonly<Record<string, unknown>>): Promise<ToolReading> {
  const io = platformIoFrom(injected);
  const answer = io.runPs(PS_PROBE_ARGUMENTS);
  return Promise.resolve(
    Object.freeze({
      tool: "ps" as const,
      platform: io.platform,
      answered: answer !== null && answer.trim() !== "",
      needed: TOOL_IS_NEEDED_ON.ps.includes(io.platform),
      sample: (answer ?? "").trim().slice(0, 40),
    }),
  );
}

/**
 * Probe `sysctl`: it is asked through `bootIdentity`, which is the only thing
 * this feature uses it for. Asking it any other way would let the doctor pass
 * where the product fails.
 */
export function probeSysctl(injected: Readonly<Record<string, unknown>>): Promise<ToolReading> {
  const io = platformIoFrom(injected);
  const identity = io.platform === "darwin" ? bootIdentity(io) : null;
  return Promise.resolve(
    Object.freeze({
      tool: "sysctl" as const,
      platform: io.platform,
      answered: identity !== null,
      needed: TOOL_IS_NEEDED_ON.sysctl.includes(io.platform),
      // The boot identity is a number of the machine and names no consumer.
      sample: (identity ?? "").slice(0, 40),
    }),
  );
}

const reading = (observed: unknown): ToolReading | null =>
  (observed as ToolReading | undefined) ?? null;

/**
 * `ok` where the tool answered; `fail` where it is needed and did not; `info`
 * where it is not needed on this platform. "We could not look" is never `ok`.
 */
export function toolSeverity(observed: unknown): Severity {
  const r = reading(observed);
  if (r === null) return "warn";
  if (r.answered) return "ok";
  return r.needed ? "fail" : "info";
}

/** The evidence: the tool, the platform, and whether it answered. */
export function toolEvidence(observed: unknown): string {
  const r = reading(observed);
  if (r === null) return "the tool was not probed";
  return (
    `tool=${r.tool} platform=${r.platform} needed=${r.needed} answered=${r.answered}` +
    (r.sample === "" ? "" : ` sample="${r.sample}"`)
  );
}

export const PS_MESSAGE_TEMPLATE =
  `\`ps\` is how macOS answers the start time of a process, the processes of the user and the ` +
  `children of one; it is on the search path or this host cannot be read`;

export const SYSCTL_MESSAGE_TEMPLATE =
  `\`sysctl\` is how macOS answers the boot identity; without it a reused process id cannot be ` +
  `told apart and the lock probe says \`unknown\``;

export const PS_FIX_HINT = `put \`ps\` on the search path of the user that runs Specstride`;

export const SYSCTL_FIX_HINT = `put \`sysctl\` on the search path; it ships with macOS`;

/**
 * The checks, one per platform, as a pair. Only the one of the running
 * platform is registered: `lb` is a field and cannot be computed per run, so
 * the launch checks and the doctor's cannot disagree (EP-14).
 */
export const psCheckOnDarwin: DoctorCheck = Object.freeze({
  id: PS_CHECK_ID,
  severityRule: toolSeverity,
  lb: true,
  order: PLATFORM_CHECK_FIRST_ORDER,
  probe: probePs,
  messageTemplate: PS_MESSAGE_TEMPLATE,
  fixHint: PS_FIX_HINT,
});

export const psCheckElsewhere: DoctorCheck = Object.freeze({
  ...psCheckOnDarwin,
  lb: false,
});

export const sysctlCheckOnDarwin: DoctorCheck = Object.freeze({
  id: SYSCTL_CHECK_ID,
  severityRule: toolSeverity,
  lb: true,
  order: PLATFORM_CHECK_FIRST_ORDER + 1,
  probe: probeSysctl,
  messageTemplate: SYSCTL_MESSAGE_TEMPLATE,
  fixHint: SYSCTL_FIX_HINT,
});

export const sysctlCheckElsewhere: DoctorCheck = Object.freeze({
  ...sysctlCheckOnDarwin,
  lb: false,
});

/** The two checks this platform gets. */
export function platformChecksFor(platform: string = process.platform): readonly DoctorCheck[] {
  return platform === "darwin"
    ? Object.freeze([psCheckOnDarwin, sysctlCheckOnDarwin])
    : Object.freeze([psCheckElsewhere, sysctlCheckElsewhere]);
}

/** The evidence of a check, by id. */
export const EVIDENCE_OF: Readonly<Record<string, (observed: unknown) => string>> = Object.freeze({
  [PS_CHECK_ID]: toolEvidence,
  [SYSCTL_CHECK_ID]: toolEvidence,
});

// The cap of §G.7 is checked at load for both platforms' forms.
for (const one of [...platformChecksFor("darwin"), ...platformChecksFor("linux")]) {
  const bytes = Buffer.byteLength(one.messageTemplate, "utf8");
  if (bytes > MESSAGE_TEMPLATE_CAP_BYTES) {
    throw new Error(
      `the message template of the doctor check \`${one.id}\` is ${bytes} bytes and the cap ` +
        `of annex G §G.7 is ${MESSAGE_TEMPLATE_CAP_BYTES}`,
    );
  }
}

/** Register the two checks of the platform tools for this platform. */
export function registerPlatformChecks(
  registry: DoctorRegistry,
  platform: string = process.platform,
): readonly DoctorCheck[] {
  const checks = platformChecksFor(platform);
  for (const one of checks) registry.register(one);
  return checks;
}
