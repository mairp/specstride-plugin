/**
 * The shared fixture helpers of the role tests of feature 124 (phases 3 and
 * 4). A registry entry here is data, spelled as F124-FR-031 reads it; no
 * list of harnesses lives under `src/roles/` — the lists live in the tests,
 * as data of the registry.
 */
import type { NamedHarness } from "../../src/roles/names.ts";
import type { ResolvedRoleConfiguration } from "../../src/roles/resolve.ts";

/** One registry entry that serves the given roles with no qualifier. */
export function bare(id: string, ...roles: string[]): NamedHarness {
  return {
    id,
    roles,
    spellings: roles.map((role) => ({ role, form: "none" as const })),
  };
}

/** One registry entry whose qualifier for a role is optional (`id[:label]`). */
export function optional(id: string, label: string, ...roles: string[]): NamedHarness {
  return {
    id,
    roles,
    spellings: roles.map((role) => ({ role, form: "optional" as const, label })),
  };
}

/** One registry entry whose qualifier for a role is required (`id:label`). */
export function required(id: string, label: string, ...roles: string[]): NamedHarness {
  return {
    id,
    roles,
    spellings: roles.map((role) => ({ role, form: "required" as const, label })),
  };
}

/** A permissive terms gate: every entry allowed, on the named row. */
export function allowAll(row = "provider:local-stub") {
  return { decide: () => ({ decision: "allowed" as const, row }) };
}

/** A preflight that passes for every harness. */
export function preflightOk() {
  return { check: () => ({ ok: true }) };
}

/** A resolved configuration with no role named and no fallback opted into. */
export function configuration(
  overrides: {
    readonly phases?: readonly string[];
    readonly defaultHarness?: string;
  } & Partial<Omit<ResolvedRoleConfiguration, "phases" | "defaultHarness">> = {},
): ResolvedRoleConfiguration {
  const phases = overrides.phases ?? ["1"];
  return {
    phases,
    perPhase: overrides.perPhase ?? {},
    models: overrides.models ?? {},
    fallbacks: overrides.fallbacks ?? {},
    proposer: overrides.proposer ?? {},
    critic: overrides.critic ?? {},
    defaultHarness: overrides.defaultHarness ?? "default-harness",
    refuseUnknown: overrides.refuseUnknown,
  };
}
