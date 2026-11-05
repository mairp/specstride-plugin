/**
 * T027 — the permission mode policy of the proposer (F130-FR-010).
 *
 * The mode is exported to the process (as `DSH_PERMISSION_MODE`) and STATED in
 * the record of every call — a record without the stated mode is malformed.
 * Defaults: `workspace-write` for the proposer (under `parity` and outside
 * it), `read-only` for the critic. The mode `danger-full-access` is used only
 * when the consumer opted in to containment C0 IN USER CONFIGURATION: the
 * environment, a flag and project configuration must not give it (ruling 34;
 * F100-FR-111). Without the opt-in, a configured `danger-full-access` is a
 * configuration error, not a mode. The mode is a contained mode of the
 * harness, never a claim of an operating-system sandbox (F100-FR-111).
 */

/** The proposer default (and the `parity` default). */
export const PROPOSER_PERMISSION_MODE = "workspace-write" as const;

/** The critic mode outside `parity`. */
export const CRITIC_PERMISSION_MODE = "read-only" as const;

/** The mode that needs the C0 opt-in from user configuration. */
export const FULL_ACCESS_MODE = "danger-full-access" as const;

/** The containment level whose user-configuration opt-in unlocks full access. */
export const C0_CONTAINMENT_LEVEL = "C0" as const;

/** Where a value may come from (ruling 34: the opt-in from user config only). */
export type ConfigOrigin = "user-config" | "env" | "flag" | "project-config";

/** The input of the policy: role, profile, and what the consumer stated. */
export type PermissionModeInput = {
  readonly role?: "proposer" | "critic";
  readonly profile?: string;
  /** A permission mode the consumer configured, with where it came from. */
  readonly configured?: { readonly mode: string; readonly origin: ConfigOrigin };
  /** The containment level the consumer opted into, with its origin. */
  readonly containmentLevel?: { readonly level: string; readonly origin: ConfigOrigin };
};

/** The outcome: a stated mode, or a configuration error. */
export type PermissionModeDecision =
  | { readonly ok: true; readonly mode: string; readonly stated: true }
  | { readonly ok: false; readonly error: string };

/**
 * Whether `danger-full-access` may be used: only with the C0 opt-in, and the
 * opt-in accepted from USER CONFIGURATION only (F130-FR-010, ruling 34).
 */
export function fullAccessOptIn(
  containmentLevel?: PermissionModeInput["containmentLevel"],
): boolean {
  return (
    containmentLevel !== undefined &&
    containmentLevel.level === C0_CONTAINMENT_LEVEL &&
    containmentLevel.origin === "user-config"
  );
}

/**
 * Resolves the permission mode (F130-FR-010). A configured mode stands, with
 * the full-access arm restricted to the user-configuration C0 opt-in; without
 * a configured value the defaults apply. The decision carries the mode
 * explicitly so a caller can STATE it in the record of the call.
 */
export function resolvePermissionMode(input: PermissionModeInput = {}): PermissionModeDecision {
  const role = input.role ?? "proposer";
  const parity = input.profile === "parity";
  if (input.configured !== undefined) {
    if (input.configured.mode === FULL_ACCESS_MODE) {
      if (input.configured.origin !== "user-config") {
        return {
          ok: false,
          error:
            `pass-loop: ${FULL_ACCESS_MODE} is accepted from user configuration only ` +
            `(got ${input.configured.origin}); ruling 34`,
        };
      }
      if (!fullAccessOptIn(input.containmentLevel)) {
        return {
          ok: false,
          error:
            `pass-loop: ${FULL_ACCESS_MODE} needs the containment C0 opt-in ` +
            `(${C0_CONTAINMENT_LEVEL}) in user configuration; without it the configured ` +
            `value is a configuration error`,
        };
      }
      return { ok: true, mode: FULL_ACCESS_MODE, stated: true };
    }
    return { ok: true, mode: input.configured.mode, stated: true };
  }
  const mode = parity
    ? PROPOSER_PERMISSION_MODE
    : role === "critic"
      ? CRITIC_PERMISSION_MODE
      : PROPOSER_PERMISSION_MODE;
  return { ok: true, mode, stated: true };
}

/**
 * The fragment a run record carries so the mode is STATED on every call
 * (F130-FR-010); the harness-side variable is named beside it.
 */
export function permissionModeStatement(mode: string): {
  readonly permissionMode: string;
  readonly env: "DSH_PERMISSION_MODE";
  readonly sandboxClaimed: false;
} {
  return { permissionMode: mode, env: "DSH_PERMISSION_MODE", sandboxClaimed: false };
}
