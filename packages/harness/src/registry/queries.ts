/**
 * The three queries of the registry (T027; F109-FR-005).
 *
 * The queries are internal operations that return a result record with the
 * field `exit_code` — they are NOT commands of the CLI (feature 100, annex G
 * §G.1; CQ in spec.md "Closed sets and queries"). The names query requires a
 * role and the role must be one of the role registry; a query that names an
 * unknown entry returns the code 1; the stream format of a known entry
 * returns the code 0, with an empty value where the entry names none.
 */
import { REGISTRY_ROLES, type HarnessRegistry, type RegistryRole } from "./registry.ts";
import { invocationModel } from "./invocation-model.ts";

/** The result record every query returns. */
export type QueryResult<T> = {
  exit_code: 0 | 1;
  /** What the query would print, one element per line; empty on a refusal. */
  lines: readonly string[];
  /** The value of the query, where it has one; null where it has none. */
  value: T | null;
  /** The refusal message, for stderr; empty on success. */
  stderr: string;
};

const ok = (lines: readonly string[], value: string | null): QueryResult<string> => ({
  exit_code: 0,
  lines,
  value,
  stderr: "",
});

function refused<T>(stderr: string): QueryResult<T> {
  // The value of a refused query is always null; the cast only tells the
  // generic caller that the value carries no T.
  return { exit_code: 1, lines: [], value: null, stderr } as QueryResult<T>;
}

/**
 * The names of the entries that serve `role`, one per line, in registry
 * order. The role is required and must be one of the role registry
 * (`proposer`, `critic`); anything else is a refusal with the code 1.
 */
export function queryNames(registry: HarnessRegistry, role: string | null): QueryResult<string> {
  if (role === null || role === "") {
    return refused(
      `backends.py names: error: argument --role is required: the role is one of ${REGISTRY_ROLES.join(", ")}`,
    );
  }
  if (!(REGISTRY_ROLES as readonly string[]).includes(role)) {
    return refused(
      `backends.py names: error: argument --role: invalid choice: ${role} (choose from ${REGISTRY_ROLES.join(", ")})`,
    );
  }
  return ok(registry.names(role), null);
}

/**
 * The stream format of one entry; empty where the entry names none (raw
 * text). An unknown entry gives the code 1; a known entry gives the code 0.
 */
export function queryStream(registry: HarnessRegistry, id: string | null): QueryResult<string> {
  const entry = id === null ? null : registry.find(id);
  if (entry === null) {
    return refused(`backends.py stream: unknown backend: ${id ?? ""}`);
  }
  return entry.stream === null ? ok([], null) : ok([entry.stream], entry.stream);
}

/**
 * The invocation model of a harness reference `id[:qualifier]` with an
 * optional explicit model (F109-FR-007; as-is `invocation_model_value`).
 * An unknown entry gives the code 1; a known entry gives the code 0, with an
 * empty value where no model is reported.
 */
export function queryInvocationModel(
  registry: HarnessRegistry,
  spec: string | null,
  model: string | null,
): QueryResult<string> {
  if (spec === null)
    return refused("backends.py invocation-model: error: argument --backend is required");
  const colon = spec.indexOf(":");
  const bare = colon === -1 ? spec : spec.slice(0, colon);
  if (registry.find(bare) === null) {
    return refused(`backends.py invocation-model: unknown backend: ${bare}`);
  }
  const value = invocationModel(registry, spec, model ?? "");
  return value === null ? ok([], null) : ok([value], value);
}

/** The role argument the queries accept, narrowed. */
export function isRegistryRole(role: string): role is RegistryRole {
  return (REGISTRY_ROLES as readonly string[]).includes(role);
}
