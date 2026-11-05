/**
 * T057 — the native-memory switch of a descriptor-driven harness and its
 * record (F109-FR-022).
 *
 * A descriptor declares whether the harness has native memory and how the
 * memory is switched off (the `native` flag and the `off` record of the
 * descriptor's `memory` member). The seam switches
 * it off for every critic-class call, and for the proposer unless the
 * consumer opted in in user configuration. A harness that has native memory
 * and cannot switch it off MUST NOT qualify as critic. The setting is
 * recorded per run.
 */
import type { RawDescriptor } from "../descriptor/loader.ts";

/** The roles a memory decision is made for. */
export type MemoryRole = "proposer" | "critic";

/** Why the memory is (or is not) switched off, for the record. */
export type MemoryRecord = {
  readonly harness: string;
  readonly role: MemoryRole;
  /** Whether the descriptor declares native memory at all. */
  readonly native: boolean;
  /** Whether the descriptor names a way to switch it off. */
  readonly canSwitchOff: boolean;
  /** What the seam does for this call. */
  readonly switchedOff: boolean;
  /** Where the decision comes from. */
  readonly source: "descriptor";
  /** Why: `critic-always`, `no-opt-in`, `opt-in`, `no-native-memory`, `cannot-switch-off`. */
  readonly reason:
    "critic-always" | "no-opt-in" | "opt-in" | "no-native-memory" | "cannot-switch-off";
};

export type MemoryDecision = MemoryRecord & {
  /** The variables that switch the memory off, for the environment of the call. */
  readonly env: Readonly<Record<string, string>>;
  /** A harness with native memory it cannot switch off is no critic. */
  readonly qualifiesAsCritic: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * F109-FR-022 — decide the native memory of one call. `userOptIn` is true
 * only where the consumer's USER configuration opts the proposer's native
 * memory in: never the environment, never a flag, never project
 * configuration (ruling 34, CQ-183).
 */
export function memoryDecision(
  descriptor: RawDescriptor,
  input: { readonly role: MemoryRole; readonly userOptIn?: boolean },
): MemoryDecision {
  const harness = typeof descriptor.id === "string" ? descriptor.id : "?";
  const memory = descriptor.memory;
  const native = isRecord(memory) && memory.native === true;
  const off =
    isRecord(memory) && isRecord((memory as { off?: unknown }).off)
      ? (memory as { off: Record<string, unknown> }).off
      : null;
  const canSwitchOff = off !== null && Object.keys(off).length > 0;

  if (!native) {
    return {
      harness,
      role: input.role,
      native: false,
      canSwitchOff: false,
      switchedOff: true,
      source: "descriptor",
      reason: "no-native-memory",
      env: {},
      qualifiesAsCritic: true,
    };
  }
  if (!canSwitchOff) {
    return {
      harness,
      role: input.role,
      native: true,
      canSwitchOff: false,
      switchedOff: false,
      source: "descriptor",
      reason: "cannot-switch-off",
      env: {},
      qualifiesAsCritic: false,
    };
  }
  const env: Record<string, string> = {};
  if (isRecord(off.env)) {
    for (const [name, value] of Object.entries(off.env)) {
      env[name] = typeof value === "string" ? value : String(value);
    }
  }
  if (input.role === "critic") {
    return {
      harness,
      role: "critic",
      native: true,
      canSwitchOff: true,
      switchedOff: true,
      source: "descriptor",
      reason: "critic-always",
      env,
      qualifiesAsCritic: true,
    };
  }
  if (input.userOptIn === true) {
    return {
      harness,
      role: "proposer",
      native: true,
      canSwitchOff: true,
      switchedOff: false,
      source: "descriptor",
      reason: "opt-in",
      env,
      qualifiesAsCritic: true,
    };
  }
  return {
    harness,
    role: "proposer",
    native: true,
    canSwitchOff: true,
    switchedOff: true,
    source: "descriptor",
    reason: "no-opt-in",
    env,
    qualifiesAsCritic: true,
  };
}
