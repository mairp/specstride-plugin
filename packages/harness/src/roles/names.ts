/**
 * T019 — how a role is named, and the rendered list of a role (F124-FR-026,
 * F124-FR-031).
 *
 * The critic is named by the key of row 36 of the `parity` profile, by its
 * as-is variable as an alias of that key, or by a flag. A name is never
 * refused while arguments are parsed: a bare name and a name with a
 * qualifier after a colon are both accepted here, and what the name names is
 * decided later, against the registry (F124-FR-028).
 *
 * Every list of the harnesses of a role that the product prints — a usage
 * text, a refusal, an error message — is rendered from the registry AT THAT
 * MOMENT, in the order of the registry, each entry in its as-is spelling,
 * joined by " | ". No such list is written by hand (F124-FR-031).
 *
 * This module is name-blind: it holds no harness name and no list of
 * harnesses (F124-SC-008). The registry is handed in by the caller.
 */

/** The row of annex X §X.7 that owns the configuration key of a role. */
export const ROLE_NAME_KEY_ROW = 36 as const;

/** The keys of row 36, one per role of Wave 1 (config-keys.json). */
export const ROLE_NAME_KEYS = {
  proposer: "roles.proposer.harness",
  critic: "roles.critic.harness",
} as const;

/** The as-is variable that aliases the row-36 key of the critic. */
export const CRITIC_NAME_VARIABLE = "SPECSTRIDE_CRITIC" as const;

/** The flag that names the critic for one launch (annex G §G.1). */
export const CRITIC_NAME_FLAG = "--critic" as const;

/** The separator of a rendered list (F124-FR-031). */
export const LIST_SEPARATOR = " | " as const;

/**
 * How a role's optional or required qualifier is spelled for one entry, as
 * the registry holds it (the baseline's registry: `none`, `optional` —
 * spelled `name[:label]` — or `required` — spelled `name:label`).
 */
export type QualifierForm = "none" | "optional" | "required";

/** The spelling facts one entry of the registry carries for one role. */
export type RoleSpelling = {
  readonly role: string;
  readonly form: QualifierForm;
  /** The label of the qualifier; present unless the form is `none`. */
  readonly label?: string;
};

/**
 * One entry of the registry, as the renderer and the resolver read it: the
 * id, the roles it supports, and the spelling per role. The informational
 * entries of the field `harnesses` never reach the plan (F124-FR-023); this
 * shape carries only what a name and a list need.
 */
export type NamedHarness = {
  readonly id: string;
  readonly roles: readonly string[];
  readonly spellings: readonly RoleSpelling[];
};

/** The spelling of one entry for one role, or null where it does not serve it. */
export function spellingOf(harness: NamedHarness, role: string): string | null {
  if (!harness.roles.includes(role)) return null;
  const spelling = harness.spellings.find((s) => s.role === role);
  if (spelling === undefined) return harness.id;
  if (spelling.form === "none") return harness.id;
  if (spelling.form === "optional") return `${harness.id}[:${spelling.label ?? ""}]`;
  return `${harness.id}:${spelling.label ?? ""}`;
}

/**
 * F124-FR-031 — the rendered list of the harnesses of one role, from the
 * registry at that moment, in the order of the registry, joined by " | ".
 * Never written by hand.
 */
export function renderRoleList(harnesses: readonly NamedHarness[], role: string): string {
  return harnesses
    .map((harness) => spellingOf(harness, role))
    .filter((spelling): spelling is string => spelling !== null)
    .join(LIST_SEPARATOR);
}

/**
 * A role name as the as-is spelling accepts it: a bare name, or a name with
 * a qualifier after a colon. Parsing NEVER refuses (F124-FR-026) — an empty
 * or malformed spec comes back as the bare text it is, and the refusal, if
 * any, happens later, against the registry.
 */
export type RoleNameSpec = {
  readonly name: string;
  readonly qualifier: string | null;
  readonly raw: string;
};

export function parseRoleName(spec: string): RoleNameSpec {
  const index = spec.indexOf(":");
  if (index < 0) return { name: spec, qualifier: null, raw: spec };
  return {
    name: spec.slice(0, index),
    qualifier: spec.slice(index + 1),
    raw: spec,
  };
}

/** Where a critic name came from (F124-FR-026). */
export type CriticNameSource = "flag" | "environment-variable" | "configuration";

/** A critic name with its source. */
export type CriticName = {
  readonly spec: RoleNameSpec;
  readonly source: CriticNameSource;
};

/** Why a selection of the critic in project configuration was ignored. */
export type IgnoredProjectSelection = {
  readonly key: string;
  readonly message: string;
};

export type CriticNameResolution = {
  /** The named critic, or null where nothing named one. */
  readonly criticName: CriticName | null;
  /** Present where project configuration named a critic that was ignored. */
  readonly ignoredProjectSelection: IgnoredProjectSelection | null;
};

/**
 * F124-FR-026 — the critic is named by a flag, by its as-is variable
 * `SPECSTRIDE_CRITIC` (an alias of the row-36 key), or by the key itself in
 * user configuration. A selection in PROJECT configuration is ignored, with
 * a message that names the key (a doctor warning is raised elsewhere, by the
 * doctor's own reader). The flag wins over the variable, the variable over
 * the user configuration.
 */
export function resolveCriticName(input: {
  readonly flag?: string | null;
  readonly variable?: string | null;
  readonly userConfiguration?: string | null;
  readonly projectConfiguration?: string | null;
}): CriticNameResolution {
  const ignoredProjectSelection: IgnoredProjectSelection | null =
    typeof input.projectConfiguration === "string" && input.projectConfiguration.length > 0
      ? {
          key: ROLE_NAME_KEYS.critic,
          message:
            `the selection of the critic in project configuration ` +
            `(${ROLE_NAME_KEYS.critic}=${input.projectConfiguration}) is ignored; ` +
            `name the critic with ${ROLE_NAME_KEYS.critic} in user configuration, ` +
            `with ${CRITIC_NAME_VARIABLE}, or with ${CRITIC_NAME_FLAG}`,
        }
      : null;

  if (typeof input.flag === "string" && input.flag.length > 0) {
    return {
      criticName: { spec: parseRoleName(input.flag), source: "flag" },
      ignoredProjectSelection,
    };
  }
  if (typeof input.variable === "string" && input.variable.length > 0) {
    return {
      criticName: { spec: parseRoleName(input.variable), source: "environment-variable" },
      ignoredProjectSelection,
    };
  }
  if (typeof input.userConfiguration === "string" && input.userConfiguration.length > 0) {
    return {
      criticName: { spec: parseRoleName(input.userConfiguration), source: "configuration" },
      ignoredProjectSelection,
    };
  }
  return { criticName: null, ignoredProjectSelection };
}
