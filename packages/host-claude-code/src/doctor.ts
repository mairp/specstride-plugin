/**
 * T022 — the `host.*` doctor checks of this plugin, registered in the doctor
 * registry of EP-14 (F113-FR-033), and the background isolation warning
 * (F113-FR-032).
 *
 * F113-FR-033: the plugin MUST register its host checks in the doctor registry
 * with the prefix `host.`, at least: CLI found, protocol supported, plugin
 * version equals package version, host hooks loaded, state root writable,
 * background isolation. NONE is a launch check except a missing CLI — so
 * `host.cli-found` alone carries `lb`.
 *
 * F113-FR-032: the host's own background job mode is considered and rejected
 * as the runtime, and the doctor MUST warn when it isolates the working tree —
 * which `host.background-isolation` does, always as a `warn`, never as a
 * launch refusal.
 *
 * The checks are the `DoctorCheck` shape of `@specstride/contracts/ep/doctor`
 * (annex G §G.7): every one reads and never writes, makes no paid call, reads
 * no secret value, and takes its observation from the INJECTED probes — the
 * plugin itself never probes the consumer's machine from inside a run.
 */
import {
  CLI_PROTOCOL_VERSION,
  HOST_SKILL_IDS,
  DOCTOR_SKILL_ID,
} from "@specstride/contracts/ep/host";
import type { DoctorCheck, DoctorRegistry, Severity } from "@specstride/contracts/ep/doctor";
import { HOOK_EVENT_IDS } from "./hooks.ts";
import { PLUGIN_PACKAGE_NAME, pluginVersion, PLUGIN_DIRECTORY } from "./packaging.ts";

/** The prefix every host check carries (F113-FR-033). */
export const HOST_CHECK_PREFIX = "host." as const;

/** The six check ids of F113-FR-033, in the order the requirement names them. */
export const HOST_CHECK_IDS: readonly string[] = Object.freeze([
  "host.cli-found",
  "host.protocol-supported",
  "host.plugin-version",
  "host.host-hooks-loaded",
  "host.state-root-writable",
  "host.background-isolation",
]);

/** The one launch check: a missing CLI. Every other check never blocks a launch. */
export const LAUNCH_CHECK_IDS: readonly string[] = Object.freeze(["host.cli-found"]);

/** The severity of a check nobody observed yet: a warning, never a failure. */
export const SEVERITY_WHEN_NOT_OBSERVED: Severity = "warn";

/**
 * The skill ids the `host.host-hooks-loaded` check reads the configuration
 * against, restated from the requirements so the message names the skills.
 */
export const SKILLS_THE_PLUGIN_SHIPS: readonly string[] = Object.freeze([
  ...HOST_SKILL_IDS,
  DOCTOR_SKILL_ID,
]);

/* -------------------------------------------------------------------------
 * F113-FR-032 — the background job mode and the isolation warning
 * ---------------------------------------------------------------------- */

/** F113-FR-032 — the host's background job mode is rejected as the runtime. */
export const BACKGROUND_JOB_MODE_REJECTED = true as const;

/** Why it is rejected (R3v C1): the host's `--exec` form exists and is used instead. */
export const BACKGROUND_JOB_MODE_REJECTED_BECAUSE =
  "the host's `--exec` form runs the CLI directly, so a background job would add a second " +
  "runtime the product does not control (R3v C1; F113-FR-032)";

/** The fact of the verification record the rejection rests on until T001 runs. */
export const BACKGROUND_ISOLATION_FACT = "background-session-isolation" as const;

/** The warning the doctor prints when the host isolates the working tree (F113-FR-032). */
export const BACKGROUND_ISOLATION_WARNING =
  "the host isolates the working tree of a background session: state written inside the " +
  "isolation does not reach the workspace, and Specstride does not use the host's background " +
  "job mode as its runtime";

/** True when an isolation observation must warn: always (F113-FR-032). */
export function isolationWarns(isolated: boolean): boolean {
  return isolated;
}

/* -------------------------------------------------------------------------
 * The six checks
 * ---------------------------------------------------------------------- */

/** A severity rule that fails on `false` and passes on `true`. */
function booleanSeverity(observed: unknown): Severity {
  if (observed === undefined || observed === null) return SEVERITY_WHEN_NOT_OBSERVED;
  return observed === true ? "ok" : "fail";
}

/** One `host.*` check, built once and frozen. */
function hostCheck(check: DoctorCheck): DoctorCheck {
  return Object.freeze(check);
}

/**
 * `host.cli-found` — the ONLY launch check of the six (F113-FR-033): a missing
 * CLI refuses the launch, because every command of the product is a line of
 * the CLI.
 */
export const CLI_FOUND_CHECK: DoctorCheck = hostCheck({
  id: "host.cli-found",
  severityRule: booleanSeverity,
  lb: true,
  order: 1,
  probe: (injected) => Promise.resolve(injected["cli-found"]),
  messageTemplate: "the Specstride CLI is {state} on this machine",
  fixHint:
    "install the CLI with `npm install -g @specstride/cli`, or run the doctor skill, which " +
    "prints the command and never runs it",
});

/** `host.protocol-supported` — the CLI speaks the protocol the plugin was built for. */
export const PROTOCOL_SUPPORTED_CHECK: DoctorCheck = hostCheck({
  id: "host.protocol-supported",
  severityRule: (observed) => {
    if (observed === undefined || observed === null) return SEVERITY_WHEN_NOT_OBSERVED;
    return observed === CLI_PROTOCOL_VERSION ? "ok" : "fail";
  },
  lb: false,
  order: 2,
  probe: (injected) => Promise.resolve(injected["protocol"]),
  messageTemplate: "the CLI answered with protocol {state}",
  fixHint:
    "the shim prints the one refusal line with both protocol numbers and names the doctor; " +
    "run the doctor skill",
});

/** `host.plugin-version` — the plugin version equals the package version (F113-FR-030). */
export const PLUGIN_VERSION_CHECK: DoctorCheck = hostCheck({
  id: "host.plugin-version",
  severityRule: (observed) => {
    if (observed === undefined || observed === null) return SEVERITY_WHEN_NOT_OBSERVED;
    return observed === pluginVersion() ? "ok" : "fail";
  },
  lb: false,
  order: 3,
  probe: (injected) => Promise.resolve(injected["plugin-version"]),
  messageTemplate: `the installed plugin of ${PLUGIN_PACKAGE_NAME} reports version {state}`,
  fixHint: `reinstall ${PLUGIN_PACKAGE_NAME} so the plugin version matches the package version`,
});

/** `host.host-hooks-loaded` — the host loaded the configuration the plugin ships. */
export const HOST_HOOKS_LOADED_CHECK: DoctorCheck = hostCheck({
  id: "host.host-hooks-loaded",
  severityRule: booleanSeverity,
  lb: false,
  order: 4,
  probe: (injected) => Promise.resolve(injected["host-hooks-loaded"]),
  messageTemplate: `the host hook configuration for ${HOOK_EVENT_IDS.length} events is {state}`,
  fixHint:
    "run `claude plugin validate` on the plugin directory, or reinstall the plugin so the " +
    "hooks of the plugin directory are read again",
});

/** `host.state-root-writable` — the state root is writable (`unverified` until feature 122). */
export const STATE_ROOT_WRITABLE_CHECK: DoctorCheck = hostCheck({
  id: "host.state-root-writable",
  severityRule: (observed) => {
    if (observed === undefined || observed === null) return SEVERITY_WHEN_NOT_OBSERVED;
    if (observed === "unverified") return "warn";
    return observed === true ? "ok" : "fail";
  },
  lb: false,
  order: 5,
  probe: (injected) => Promise.resolve(injected["state-root-writable"]),
  messageTemplate: "the state root of the host is {state}",
  fixHint:
    "the product runs without a writable state root: the declared fallback applies until the " +
    "spike of feature 122 reports (F113-FR-028)",
});

/** `host.background-isolation` — the F113-FR-032 warning. Never a launch refusal. */
export const BACKGROUND_ISOLATION_CHECK: DoctorCheck = hostCheck({
  id: "host.background-isolation",
  severityRule: (observed) => {
    if (observed === undefined || observed === null) return SEVERITY_WHEN_NOT_OBSERVED;
    return observed === true ? "warn" : "ok";
  },
  lb: false,
  order: 6,
  probe: (injected) => Promise.resolve(injected["background-isolation"]),
  messageTemplate: BACKGROUND_ISOLATION_WARNING,
  fixHint:
    "run Specstride in the foreground session; the host's background job mode is not the " +
    "runtime of the product (F113-FR-032)",
});

/** The six checks of F113-FR-033, in the order of `HOST_CHECK_IDS`. */
export function hostDoctorChecks(): readonly DoctorCheck[] {
  return Object.freeze([
    CLI_FOUND_CHECK,
    PROTOCOL_SUPPORTED_CHECK,
    PLUGIN_VERSION_CHECK,
    HOST_HOOKS_LOADED_CHECK,
    STATE_ROOT_WRITABLE_CHECK,
    BACKGROUND_ISOLATION_CHECK,
  ]);
}

/**
 * The registration of F113-FR-033: every check of `hostDoctorChecks()` goes
 * into the given registry. The registry itself belongs to EP-14 (feature 112);
 * this module only registers into it, and nothing here approves a check —
 * approval is a verified record of the gate, never an inner check.
 */
export function registerHostChecks(registry: DoctorRegistry): readonly DoctorCheck[] {
  const checks = hostDoctorChecks();
  for (const check of checks) registry.register(check);
  return checks;
}

/** The checks of this module that are launch checks: exactly `LAUNCH_CHECK_IDS`. */
export function hostLaunchChecks(): readonly DoctorCheck[] {
  return hostDoctorChecks().filter((check) => check.lb);
}

/** True when an id is one of this plugin's checks. */
export function isHostCheck(id: string): boolean {
  return id.startsWith(HOST_CHECK_PREFIX) && HOST_CHECK_IDS.includes(id);
}

/** The directory of the plugin the checks describe, restated for the messages. */
export const CHECKED_PLUGIN_DIRECTORY: string = PLUGIN_DIRECTORY;
