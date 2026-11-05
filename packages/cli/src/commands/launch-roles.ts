/**
 * T022 — role resolution wired into `launch` and `run` (F124-FR-021,
 * F124-FR-035).
 *
 * The composition root hands in the three things role resolution is a
 * function of — the list of harnesses of the resolved registry, the resolved
 * configuration and the terms gate — and nothing else (F124-FR-020). The
 * wiring is thin: it calls `resolveRoles`, and on a refusal it ends `launch`
 * with the handshake outcome `refused` and exit 4, or a foreground `run`
 * with exit 3, and writes NO run state (F124-FR-035). On a resolution the
 * caller writes the record at `run:<runId>:registry` through the registry
 * writer of this feature.
 */
import {
  resolveRoles,
  refusalExitCode,
  type RoleResolution,
  type RoleResolverInput,
} from "../../../harness/src/roles/resolve.ts";
import type { ResolvedRegistry } from "../../../contracts/src/records/resolved-registry.ts";

export { resolveRoles, refusalExitCode };
export type { RoleResolution, RoleResolverInput };

/** The exit codes of a refusal (F124-FR-035). */
export const LAUNCH_REFUSED_EXIT = 4 as const;
export const RUN_REFUSED_EXIT = 3 as const;

/** The handshake outcome of a refused launch (F124-FR-035). */
export type RefusedHandshakeOutcome = {
  readonly outcome: "refused";
  readonly exitCode: 4;
  readonly stderr: readonly string[];
  /** No run state: the record is never written for a refused launch. */
  readonly wroteRunState: false;
};

/** The result of the wiring, per verb. */
export type LaunchRolesOutcome =
  | {
      readonly verb: "launch";
      readonly kind: "resolved";
      readonly resolution: Extract<RoleResolution, { outcome: "resolved" }>;
    }
  | {
      readonly verb: "launch";
      readonly kind: "refused";
      readonly handshake: RefusedHandshakeOutcome;
    }
  | {
      readonly verb: "run";
      readonly kind: "resolved";
      readonly resolution: Extract<RoleResolution, { outcome: "resolved" }>;
    }
  | {
      readonly verb: "run";
      readonly kind: "refused";
      readonly exitCode: 3;
      readonly stderr: readonly string[];
      readonly wroteRunState: false;
    };

/** What the composition root provides: the registry, the configuration, the gate. */
export type LaunchRolesDeps = {
  /** The resolved registry as the launch holds it (annex C §C.6). */
  readonly registry: {
    readonly harnesses: unknown;
    readonly roles: readonly { readonly id: string }[];
  };
  /** The resolved configuration (F124-FR-020). */
  readonly configuration: RoleResolverInput["configuration"];
  /** The terms gate (F124-FR-032). */
  readonly termsGate: RoleResolverInput["termsGate"];
  /** The harness port's preflight (F124-FR-034). */
  readonly preflight: RoleResolverInput["preflight"];
  /** Where the registry's name-and-role facts are read from. */
  readonly namedHarnesses: RoleResolverInput["registry"];
};

/**
 * The composition root's one call. `verb` is `launch` for the `launch`
 * command and `run` for a foreground `run`; it decides only the exit code of
 * a refusal — the resolution itself is the same pure function for both.
 */
export function resolveRolesForVerb(
  deps: LaunchRolesDeps,
  verb: "launch" | "run",
): LaunchRolesOutcome {
  const resolution = resolveRoles({
    registry: deps.namedHarnesses,
    roles: deps.registry.roles.map((role) => role.id),
    configuration: deps.configuration,
    termsGate: deps.termsGate,
    preflight: deps.preflight,
    surface: verb,
  });
  if (resolution.outcome === "refused") {
    if (verb === "launch") {
      return {
        verb,
        kind: "refused",
        handshake: {
          outcome: "refused",
          exitCode: LAUNCH_REFUSED_EXIT,
          stderr: resolution.stderr,
          wroteRunState: false,
        },
      };
    }
    return {
      verb,
      kind: "refused",
      exitCode: RUN_REFUSED_EXIT,
      stderr: resolution.stderr,
      wroteRunState: false,
    };
  }
  return { verb, kind: "resolved", resolution };
}

/**
 * The exit code the verb ends with, from a resolution computed elsewhere.
 * `0` where the resolution resolved.
 */
export function exitCodeFor(resolution: RoleResolution, verb: "launch" | "run"): 0 | 3 | 4 {
  return refusalExitCode(resolution, verb);
}

/**
 * True when the record at `run:<runId>:registry` may be written: only a
 * resolution writes the registry (F124-FR-021), a refusal never does
 * (F124-FR-035).
 */
export function mayWriteResolvedRegistry(resolution: RoleResolution): boolean {
  return resolution.outcome === "resolved";
}

/** The record a resolution writes, from the resolution and the launch's facts. */
export type RegistryWriteInput = {
  readonly runId: string;
  readonly stateRoot: string;
  readonly resolution: Extract<RoleResolution, { outcome: "resolved" }>;
};

/** A named input the writer accepts, kept as a type for the composition root. */
export type RegistryRecordInput = ResolvedRegistry;
