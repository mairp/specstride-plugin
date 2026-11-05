/**
 * T040 — the six launch checks registered in the doctor registry (EP-14,
 * F123-FR-022).
 *
 * The launch checks are checks of the doctor registry with the
 * launch-blocking flag (`lb`) set and a fixed order, so that `launch` and the
 * doctor cannot disagree. The six checks of §R.5 come first (orders 1 to 6);
 * other launch-blocking checks that other packages register run after them.
 * The critic-diversity warning is never launch-blocking.
 */
import type { DoctorCheck, DoctorRegistry, Severity } from "@specstride/contracts/ep/doctor";
import {
  LAUNCH_CHECKS,
  LAUNCH_CHECK_REFUSALS,
  runLaunchChecks,
  type LaunchCheckContext,
  type LaunchCheckName,
} from "./checks.ts";

/** The id prefix of the launch checks of feature 123 in the doctor registry. */
export const LAUNCH_CHECK_ID_PREFIX = "pipeline.launch." as const;

/** The context a probe reads, carried through the doctor's injected record. */
export const LAUNCH_CONTEXT_KEY = "launchContext" as const;

/** The severities a launch check may report: a failure is `fail`, a pass `ok`. */
function severityOf(status: string): Severity {
  return status === "fail" ? "fail" : "ok";
}

/** The one probe body, shared by every check: run to (and through) this check. */
function probeOf(order: number) {
  return async (injected: Readonly<Record<string, unknown>>): Promise<unknown> => {
    const ctx = injected[LAUNCH_CONTEXT_KEY] as LaunchCheckContext | undefined;
    if (ctx === undefined) {
      throw new Error(`the launch check of order ${order} needs the launch context`);
    }
    const result = runLaunchChecks(ctx);
    return result.checks.find((check) => check.order === order) ?? null;
  };
}

/** The six checks of §R.5 as doctor checks: launch-blocking, fixed order. */
export function launchChecksOf123(): readonly DoctorCheck[] {
  return LAUNCH_CHECKS.map((spec) => {
    const name: LaunchCheckName = spec.name;
    return {
      id: `${LAUNCH_CHECK_ID_PREFIX}${name}`,
      severityRule: (observed: unknown) =>
        severityOf(
          observed !== null && typeof observed === "object" && "status" in observed
            ? String((observed as { status: unknown }).status)
            : "fail",
        ),
      lb: true,
      order: spec.order,
      probe: probeOf(spec.order),
      messageTemplate: `launch check ${name}: ${spec.reasons.join(", ")}`.slice(0, 200),
      fixHint: "fix the refusal the check names before launching",
    } satisfies DoctorCheck;
  });
}

/**
 * Register the six launch checks in a doctor registry. Returns the checks in
 * their fixed order, so that a caller can assert the registration.
 */
export function registerLaunchChecks(registry: DoctorRegistry): readonly DoctorCheck[] {
  const checks = launchChecksOf123();
  for (const check of checks) registry.register(check);
  return checks;
}

/** The 11 refusal reasons the registered checks may report. */
export const registeredRefusalReasons: readonly string[] = LAUNCH_CHECK_REFUSALS;

/**
 * T089 — the doctor check of the terminal tool (F123-FR-044).
 *
 * The `script` tool of the platform gives a `specstride` stage its terminal
 * (F123-FR-011); the product ships none. The check is registered like every
 * doctor check but is NOT launch-blocking (`lb: false`): a launch without
 * the tool is never refused, the run goes on through the pipe, and the
 * doctor reports a warning with the fix hint. The probe is injected — the
 * caller hands a function that answers whether the tool was found — so the
 * check writes nothing and touches no search path of its own.
 */
export const TERMINAL_TOOL_CHECK_ID = "pipeline.terminal-tool" as const;

/** The injected probe key: a function that answers whether the tool was found. */
export const TERMINAL_TOOL_PROBE_KEY = "terminalToolProbe" as const;

/** The observed values the probe of the terminal tool may return. */
export type TerminalToolObservation = "present" | "missing" | "not-probed";

/** The doctor check of the terminal tool: order 7, never launch-blocking. */
export function terminalToolCheck123(): DoctorCheck {
  return {
    id: TERMINAL_TOOL_CHECK_ID,
    severityRule: (observed: unknown) => (observed === "missing" ? "warn" : "ok"),
    lb: false,
    order: 7,
    probe: async (
      injected: Readonly<Record<string, unknown>>,
    ): Promise<TerminalToolObservation> => {
      const probe = injected[TERMINAL_TOOL_PROBE_KEY];
      if (typeof probe !== "function") return "not-probed";
      return (probe as () => boolean)() ? "present" : "missing";
    },
    messageTemplate: "terminal tool `script` not found; stage output runs through a pipe",
    fixHint:
      "install the terminal tool of the platform (`script`) to show stage output with colour",
  };
}

/** Register the terminal tool check in a doctor registry; returns the check. */
export function registerTerminalToolCheck(registry: DoctorRegistry): DoctorCheck {
  const check = terminalToolCheck123();
  registry.register(check);
  return check;
}
