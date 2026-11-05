/**
 * T013 — the accepted sources of a harness descriptor (F109-FR-015).
 *
 * A harness declaration, an endpoint and a secret reference MUST be accepted
 * from user configuration, the environment, flags and the product's bundled
 * data only. The same entry in PROJECT configuration MUST be ignored with a
 * launch message and a doctor warning, and MUST NOT change the registry.
 */

/** The sources a descriptor is accepted from (F109-FR-015). */
export const ACCEPTED_SOURCES = ["user-config", "environment", "flags", "bundled"] as const;
export type AcceptedSource = (typeof ACCEPTED_SOURCES)[number];

/** The only source project configuration may ever be: not accepted. */
export const REFUSED_SOURCE = "project-config" as const;

/** The keys of project configuration this feature knows and ignores. */
export const PROJECT_CONFIG_KEYS_IGNORED = ["harnesses", "endpoints", "secrets"] as const;

/** A doctor warning about an ignored project-configuration entry. */
export type DoctorWarning = {
  readonly severity: "warning";
  readonly check: "project-config-harness-entry";
  /** The launch message, as it is emitted at launch. */
  readonly message: string;
  readonly path: string;
};

/** One descriptor accepted from a source. */
export type AcceptedDescriptor = {
  readonly descriptor: unknown;
  readonly source: AcceptedSource;
};

/** What `collectDescriptors` returns. */
export type CollectedDescriptors = {
  /** What enters the registry; project configuration never does. */
  readonly accepted: readonly AcceptedDescriptor[];
  /** The project-configuration entries that were ignored. */
  readonly ignored: readonly DoctorWarning[];
};

/** The environment variable prefixes a harness declaration may arrive under. */
export const ENVIRONMENT_PREFIXES = ["SPECSTRIDE_HARNESS_"] as const;

function ignore(path: string, what: string, id: string): DoctorWarning {
  return {
    severity: "warning",
    check: "project-config-harness-entry",
    path,
    message: `ignored: ${what} "${id}" in project configuration (F109-FR-015); declare it in user configuration, the environment, a flag or bundled data`,
  };
}

/**
 * F109-FR-015 — collect the descriptors of the accepted sources and ignore
 * every harness declaration, endpoint and secret reference that project
 * configuration carries, each with a launch message and a doctor warning.
 */
export function collectDescriptors(input: {
  readonly userConfig?: readonly unknown[];
  readonly projectConfig?: Record<string, unknown> | undefined;
  readonly environment?: Readonly<Record<string, string>> | undefined;
  readonly flags?: readonly unknown[] | undefined;
  readonly bundled?: readonly unknown[] | undefined;
}): CollectedDescriptors {
  const accepted: AcceptedDescriptor[] = [];
  const ignored: DoctorWarning[] = [];

  for (const descriptor of input.userConfig ?? []) {
    accepted.push({ descriptor, source: "user-config" });
  }
  for (const descriptor of input.bundled ?? []) {
    accepted.push({ descriptor, source: "bundled" });
  }
  for (const descriptor of input.flags ?? []) {
    accepted.push({ descriptor, source: "flags" });
  }
  for (const [name, value] of Object.entries(input.environment ?? {})) {
    if (ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      accepted.push({ descriptor: value, source: "environment" });
    }
  }

  const project = input.projectConfig;
  if (project !== undefined) {
    for (const key of PROJECT_CONFIG_KEYS_IGNORED) {
      const value = project[key];
      if (value === undefined || value === null) {
        continue;
      }
      const what =
        key === "harnesses"
          ? "harness declaration"
          : key === "endpoints"
            ? "endpoint"
            : "secret reference";
      if (Array.isArray(value)) {
        for (const [index, entry] of value.entries()) {
          const id =
            typeof entry === "object" && entry !== null && "id" in entry
              ? String((entry as { id: unknown }).id)
              : String(index);
          ignored.push(ignore(`${key}[${index}]`, what, id));
        }
      } else {
        ignored.push(ignore(key, what, key));
      }
    }
  }

  return { accepted, ignored };
}
