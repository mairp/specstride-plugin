/**
 * T021 — role resolution (F124-FR-020, F124-FR-023, F124-FR-028 to
 * F124-FR-036).
 *
 * Role resolution is a PURE FUNCTION of the resolved registry, the resolved
 * configuration and the decisions of the terms gate, and of nothing else.
 * The same inputs give the same role plan. It runs at launch; no loop layer,
 * no router and no model-tier escalation calls it or changes a role
 * (F124-FR-020) — a static test of the import graph proves that.
 *
 * It resolves every registered role for every phase, with the per-phase
 * settings of the consumer applied, and every entry of the plan holds
 * harness, model, model tier, auth tier, transport, form of the `completion`
 * level, containment level and the decision of the terms gate with the row
 * it rests on (F124-FR-023). No informational entry of the field
 * `harnesses` reaches the plan.
 *
 * The refusals: an unknown name refuses the launch with the rendered list of
 * the registry, unless the switch is off (F124-FR-028); with the switch off
 * the two as-is results are carried (F124-FR-029, F124-FR-030); a refused
 * primary of the terms gate refuses the launch (F124-FR-032); a failed
 * preflight of a primary refuses and names what is missing (F124-FR-034).
 * Every refusal ends `launch` with the outcome `refused` and exit 4, and a
 * foreground `run` with exit 3, and writes no run state (F124-FR-035).
 *
 * This module is name-blind (F124-SC-008): the registry, the default harness
 * and the names come in as data.
 */
import { renderRoleList, resolveCriticName, type NamedHarness } from "./names.ts";
import { resolveProposer, type ProposerResolution, type RoleRefusal } from "./proposer.ts";
import type { KindOfAPlanEntry, RolePlan, RolePlanEntry, SourceOfTheProposer } from "./types.ts";

/** The switch of F124-FR-028, row 90 of annex X §X.7: on by default. */
export const REFUSE_UNKNOWN_DEFAULT = true as const;
/** The row-90 key (config-keys.json). */
export const REFUSE_UNKNOWN_KEY = "roles.refuseUnknown" as const;

/** The pass result of an unknown proposer name, as the baseline carries it. */
export const UNKNOWN_BACKEND_PASS_RESULT = 127 as const;
/** The result of an unknown critic name: MALFORMED, never a configuration error (3). */
export const MALFORMED_CRITIC_RESULT = 10 as const;
export const CONFIGURATION_ERROR_RESULT = 3 as const;

/** F124-FR-029 — the as-is message of an unknown proposer name. */
export function unknownBackendMessage(name: string, list: string): string {
  return `unknown backend '${name}' (${list})`;
}

/** F124-FR-030 — the as-is message of an unknown critic name. */
export function unknownCriticProviderMessage(name: string, list: string): string {
  return `unknown SPECSTRIDE_CRITIC provider: ${name} (${list})`;
}

/** The decision of the terms gate for one entry, with the row it rests on. */
export type TermsDecision = {
  readonly decision: "allowed" | "refused" | "unknown";
  readonly row: string;
};

/** The terms gate, handed in by the composition root (F124-FR-032). */
export interface TermsGate {
  decide(harness: string, role: string, phase: string): TermsDecision;
}

/** What a preflight of one role reports (F124-FR-034). */
export type PreflightResult = { readonly ok: boolean; readonly missing?: readonly string[] };

/** The harness port's `preflight`, handed in by the composition root. */
export interface PreflightPort {
  check(harness: string, role: string): PreflightResult;
}

/** A fallback the consumer opted into (F124-FR-033). */
export type OptedInFallback = {
  readonly name: string;
  /** Only user configuration, the environment and flags are accepted. */
  readonly scope: "user" | "environment" | "flag" | "project";
};

/** The per-phase settings of the consumer for one phase and role. */
export type PerPhaseSettings = {
  readonly model?: string | null;
  readonly criticName?: string | null;
};

/** The resolved configuration, as role resolution reads it (F124-FR-020). */
export type ResolvedRoleConfiguration = {
  readonly phases: readonly string[];
  readonly perPhase: Readonly<Record<string, Readonly<Record<string, PerPhaseSettings>>>>;
  readonly models: Readonly<Record<string, string | null>>;
  readonly fallbacks: Readonly<Record<string, readonly OptedInFallback[]>>;
  readonly proposer: {
    readonly flag?: string | null;
    readonly environment?: string | null;
    readonly configuration?: string | null;
  };
  readonly critic: {
    readonly flag?: string | null;
    readonly variable?: string | null;
    readonly userConfiguration?: string | null;
    readonly projectConfiguration?: string | null;
  };
  readonly defaultHarness: string;
  readonly refuseUnknown?: boolean;
};

/** Everything role resolution is a function of (F124-FR-020). */
export type RoleResolverInput = {
  readonly registry: readonly NamedHarness[];
  readonly roles: readonly string[];
  readonly configuration: ResolvedRoleConfiguration;
  readonly termsGate: TermsGate;
  readonly preflight: PreflightPort;
  /** `launch` refuses with 4; a foreground `run` refuses with 3 (F124-FR-035). */
  readonly surface: "launch" | "run";
};

/** One entry of the plan as the resolver produces it. */
export type ResolvedPlanEntry = RolePlanEntry & {
  readonly phase: string;
  readonly role: string;
};

/** One as-is result the plan carries when the switch is off. */
export type AsIsResult = {
  readonly role: string;
  readonly name: string;
  readonly message: string;
  readonly list: string;
  /** 127 for the proposer's passes; MALFORMED, 10, for the critic's call. */
  readonly result: number;
  readonly kind: "unknown-backend" | "unknown-critic-provider";
};

export type ResolvedRoles = {
  readonly outcome: "resolved";
  readonly plan: RolePlan;
  readonly entries: readonly ResolvedPlanEntry[];
  readonly proposer: ProposerResolution;
  readonly asIs: readonly AsIsResult[];
  /** Harnesses whose terms are unknown and that the consumer named (F124-FR-036). */
  readonly unknownTermsWarnings: readonly string[];
  /** A project-scope selection of the critic that was ignored (F124-FR-026). */
  readonly ignoredProjectSelection: { readonly key: string; readonly message: string } | null;
};

export type RefusedRoles = {
  readonly outcome: "refused";
  readonly refusals: readonly RoleRefusal[];
  /** 4 for `launch`, 3 for a foreground `run` (F124-FR-035). */
  readonly exitCode: 4 | 3;
  readonly stderr: readonly string[];
};

export type RoleResolution = ResolvedRoles | RefusedRoles;

function refusalOf(reason: string, line: string, surface: "launch" | "run"): RefusedRoles {
  return {
    outcome: "refused",
    refusals: [{ reason, line, exitCodeLaunch: 4, exitCodeRun: 3 }],
    exitCode: surface === "launch" ? 4 : 3,
    stderr: [line],
  };
}

/** True where the consumer NAMED the harness for the role (F124-FR-036). */
function namedByConsumer(
  consumerNamed: boolean,
  fallbackNames: readonly string[],
  harness: string,
): boolean {
  return consumerNamed || fallbackNames.includes(harness);
}

/**
 * The fallbacks the plan may hold: only the consumer's opt-ins from user
 * configuration, the environment and flags, in the consumer's order
 * (F124-FR-033). A project-scope opt-in is ignored; the product never adds a
 * fallback by itself.
 */
export function acceptedFallbacks(listed: readonly OptedInFallback[]): readonly OptedInFallback[] {
  return listed.filter((fallback) => fallback.scope !== "project");
}

/** Resolve one role for one phase, or produce the refusal that ends the launch. */
export function resolveRoles(input: RoleResolverInput): RoleResolution {
  const { registry, roles, configuration, termsGate, preflight, surface } = input;
  const refuseUnknown = configuration.refuseUnknown ?? REFUSE_UNKNOWN_DEFAULT;
  const entries: ResolvedPlanEntry[] = [];
  const asIs: AsIsResult[] = [];
  const unknownTermsWarnings: string[] = [];

  // The proposer: the guarantee of F124-FR-024.
  const proposerInput = {
    ...configuration.proposer,
    defaultHarness: configuration.defaultHarness,
    registry,
  };
  const proposer = resolveProposer(proposerInput);
  if (!proposer.ok) {
    return refusalOf(proposer.refusal.reason, proposer.refusal.line, surface);
  }

  // The critic: flag, as-is variable, user configuration; a project
  // selection is ignored with a message (F124-FR-026).
  const criticName = resolveCriticName(configuration.critic);
  const ignoredSelection = criticName.ignoredProjectSelection;

  for (const role of roles) {
    const fallbacks = acceptedFallbacks(configuration.fallbacks[role] ?? []);
    const fallbackNames = fallbacks.map((fallback) => fallback.name);
    // Whether the CONSUMER named a harness for this role (F124-FR-036): the
    // proposer by a source other than the default, the critic by any of its
    // three names. A default is not a naming.
    const consumerNamed =
      role === "proposer"
        ? proposer.proposer.source !== "default"
        : role === "critic"
          ? criticName.criticName !== null
          : false;

    let primaryName: string | null;
    let primarySource: SourceOfTheProposer;
    let primaryModel: string | null;
    if (role === "proposer") {
      primaryName = proposer.proposer.name;
      primarySource = proposer.proposer.source;
      primaryModel = proposer.proposer.model ?? configuration.models[role] ?? null;
    } else if (role === "critic") {
      const named = criticName.criticName;
      primaryName = named?.spec.name ?? configuration.defaultHarness;
      primarySource = (named?.source
        .replace("environment-variable", "environment")
        .replace("flag", "flag") ?? "default") as SourceOfTheProposer;
      primaryModel = configuration.models[role] ?? null;
    } else {
      primaryName = null;
      primarySource = "default";
      primaryModel = configuration.models[role] ?? null;
    }

    // F124-FR-028 — an unknown name refuses the launch with the rendered
    // list; with the switch off the as-is behaviour is carried instead.
    const supports = registry.filter((harness) => harness.roles.includes(role));
    const known = supports.some((harness) => harness.id === primaryName);
    const isDefault =
      role === "proposer" ? proposer.proposer.source === "default" : criticName.criticName === null;
    if (!known && !isDefault) {
      const list = renderRoleList(registry, role);
      if (refuseUnknown) {
        return refusalOf(
          "unknown-role-name",
          `[SPECSTRIDE-ROLES] the launch is refused: the ${role} '${primaryName}' ` +
            `is not in the registry. The registry holds: ${list}`,
          surface,
        );
      }
      // F124-FR-029 / F124-FR-030 — the two as-is results, spelled as the
      // baseline spells them, never as a configuration error.
      asIs.push(
        role === "critic"
          ? {
              role,
              name: primaryName ?? "",
              message: unknownCriticProviderMessage(primaryName ?? "", list),
              list,
              result: MALFORMED_CRITIC_RESULT,
              kind: "unknown-critic-provider",
            }
          : {
              role,
              name: primaryName ?? "",
              message: unknownBackendMessage(primaryName ?? "", list),
              list,
              result: UNKNOWN_BACKEND_PASS_RESULT,
              kind: "unknown-backend",
            },
      );
    }

    for (const phase of configuration.phases) {
      const perPhase = configuration.perPhase[phase]?.[role] ?? {};
      // An EXPLICIT null of a per-phase setting means "none is named in
      // this phase" and suppresses even the global model (F124-FR-027);
      // an absent key falls through to the next setting.
      const model = perPhase.model !== undefined ? perPhase.model : (primaryModel ?? null);

      // Every entry is asked to the terms gate, the fallbacks included
      // (F124-FR-032); a refused entry never enters the plan.
      const candidates = [
        { name: primaryName, kind: "primary" as KindOfAPlanEntry, regate: false },
        ...fallbackNames.map((name) => ({
          name,
          kind: "fallback" as KindOfAPlanEntry,
          regate: true,
        })),
      ].filter(
        (candidate): candidate is { name: string; kind: KindOfAPlanEntry; regate: boolean } =>
          typeof candidate.name === "string" && candidate.name.length > 0,
      );

      const kept: {
        name: string;
        kind: KindOfAPlanEntry;
        regate: boolean;
        terms: TermsDecision;
      }[] = [];
      for (const candidate of candidates) {
        const decision = termsGate.decide(candidate.name, role, phase);
        // F124-FR-036 — unknown terms are usable when the consumer named the
        // harness, with the warning, and never otherwise: never a default,
        // never an automatic critic, never a product-added fallback.
        if (decision.decision === "unknown") {
          const named = namedByConsumer(consumerNamed, fallbackNames, candidate.name);
          if (!named) continue;
          if (!unknownTermsWarnings.includes(candidate.name)) {
            unknownTermsWarnings.push(candidate.name);
          }
        }
        if (decision.decision === "refused") continue;
        kept.push({ ...candidate, terms: decision });
      }

      // A refused PRIMARY of a role refuses the launch (F124-FR-032).
      const primary = kept.find((candidate) => candidate.kind === "primary");
      if (primary === undefined && candidates[0] !== undefined) {
        const decision = termsGate.decide(candidates[0].name, role, phase);
        if (decision.decision === "refused") {
          return refusalOf(
            "terms-refused-primary",
            `[SPECSTRIDE-ROLES] the launch is refused: the terms gate refused ` +
              `${candidates[0].name} for the ${role} (row ${decision.row})`,
            surface,
          );
        }
      }
      if (primary === undefined) {
        return refusalOf(
          "no-primary",
          `[SPECSTRIDE-ROLES] the launch is refused: no harness can play the ` +
            `${role} in the phase ${phase}. The registry holds: ` +
            renderRoleList(registry, role),
          surface,
        );
      }

      // F124-FR-034 — the preflight of every role player is called. A failed
      // preflight of a primary refuses and names what is missing; of a
      // fallback or a runner-up it disqualifies the candidate.
      const fit: typeof kept = [];
      for (const candidate of kept) {
        const result = preflight.check(candidate.name, role);
        if (!result.ok && candidate.kind !== "primary") continue;
        if (!result.ok) {
          const missing = (result.missing ?? ["an unknown prerequisite"]).join(", ");
          return refusalOf(
            "preflight-failed",
            `[SPECSTRIDE-ROLES] the launch is refused: the preflight of ` +
              `${candidate.name} for the ${role} failed; missing: ${missing}`,
            surface,
          );
        }
        fit.push(candidate);
      }

      for (const candidate of fit) {
        entries.push({
          phase,
          role,
          harness: candidate.name,
          model,
          modelTier: role === "proposer" ? "proposer" : "critic",
          authTier: 1,
          transport: "cli",
          form: "tool-less",
          containment: "pass",
          source: candidate.kind === "primary" ? primarySource : "configuration",
          kind: candidate.kind,
          regate: candidate.regate,
          terms: { decision: candidate.terms.decision, row: candidate.terms.row },
        });
      }
    }
  }

  const plan: Record<string, Record<string, RolePlanEntry[]>> = {};
  for (const entry of entries) {
    const perPhase = (plan[entry.phase] ??= {});
    const list = perPhase[entry.role] ?? [];
    list.push({
      harness: entry.harness,
      model: entry.model,
      modelTier: entry.modelTier,
      authTier: entry.authTier,
      transport: entry.transport,
      form: entry.form,
      containment: entry.containment,
      source: entry.source,
      kind: entry.kind,
      regate: entry.regate,
      terms: entry.terms,
    });
    perPhase[entry.role] = list;
  }

  return {
    outcome: "resolved",
    plan,
    entries,
    proposer: proposer.proposer,
    asIs,
    unknownTermsWarnings,
    ignoredProjectSelection: ignoredSelection,
  };
}

/**
 * F124-FR-035 — the exit code of a refusal: `launch` ends 4 with the
 * handshake outcome `refused`; a foreground `run` ends 3.
 */
export function refusalExitCode(resolution: RoleResolution, surface: "launch" | "run"): 0 | 3 | 4 {
  if (resolution.outcome !== "refused") return 0;
  return surface === "launch" ? 4 : 3;
}

/** Nothing is written when the resolution refused: no run state at all. */
export function writesNoRunState(resolution: RoleResolution): boolean {
  return resolution.outcome === "refused";
}
