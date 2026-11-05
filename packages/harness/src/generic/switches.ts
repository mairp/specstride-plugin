/**
 * T055 — the telemetry switch of a descriptor-driven harness (F109-FR-021).
 *
 * Where a descriptor or a harness adapter names the switch for the harness's
 * own telemetry, EVERY process the seam starts for that harness must be
 * started with the telemetry switched off. The switch lives in the
 * descriptor's telemetry record for switching off, and comes in the two
 * forms the schema names: variables (the record's `env` member) and flags
 * (its `flags` member). The variables go into the environment of the
 * call; a flag can only take effect through the argument list the
 * descriptor itself declares, so the adapter records a flag-named switch as
 * present only where the descriptor's own argument list carries it — the
 * seam never adds a flag of its own (F109-FR-016: nothing added).
 */
import type { RawDescriptor } from "../descriptor/loader.ts";

/** The telemetry switch as the descriptor declares it. */
export type TelemetrySwitch = {
  /** Whether the descriptor names a switch at all. */
  readonly declared: boolean;
  /** The variables to set for every call of this harness. */
  readonly env: Readonly<Record<string, string>>;
  /** The flags the DECLARes itself in its argument list (never added here). */
  readonly flags: readonly string[];
  /** Flags the descriptor names that its own argument list does not carry. */
  readonly unappliedFlags: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * F109-FR-021 — read the telemetry switch of a descriptor. A descriptor
 * that names no switch gives `declared: false` and empty sets; the seam
 * then has nothing to switch and records exactly that.
 */
export function telemetrySwitch(descriptor: RawDescriptor): TelemetrySwitch {
  const telemetry = descriptor.telemetry;
  if (!isRecord(telemetry) || !isRecord(telemetry.off)) {
    return { declared: false, env: {}, flags: [], unappliedFlags: [] };
  }
  const off = telemetry.off;
  const env: Record<string, string> = {};
  if (isRecord(off.env)) {
    for (const [name, value] of Object.entries(off.env)) {
      env[name] = typeof value === "string" ? value : String(value);
    }
  }
  const flags = Array.isArray(off.flags)
    ? off.flags.filter((f): f is string => typeof f === "string")
    : [];
  return {
    declared: Object.keys(env).length > 0 || flags.length > 0,
    env,
    flags,
    unappliedFlags: [],
  };
}

/**
 * F109-FR-021 — the variables of the telemetry switch for one call, merged
 * over the environment the allow-list built. The switch never removes a
 * variable the allow-list carries; it sets the values the descriptor names.
 */
export function applyTelemetrySwitch(
  environment: Record<string, string>,
  telemetry: TelemetrySwitch,
): Record<string, string> {
  return { ...environment, ...telemetry.env };
}

/**
 * F109-FR-021 — reconcile the flag form with the argument list the
 * descriptor declares for a role. The seam adds nothing: a flag the
 * descriptor names but its own `invoke.<role>.args` does not carry is
 * reported as unapplied, so the doctor can show it and the run records it.
 */
export function reconcileTelemetryFlags(
  telemetry: TelemetrySwitch,
  args: readonly string[],
): TelemetrySwitch {
  const unappliedFlags = telemetry.flags.filter((flag) => !args.includes(flag));
  return { ...telemetry, unappliedFlags };
}
