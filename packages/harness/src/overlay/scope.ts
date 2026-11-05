/**
 * T081 — the resolution of the overlay scope and the start-up (F109-FR-031).
 *
 * The scope of an entry comes from the key `SPECSTRIDE_<NAME>_OVERLAY` whose
 * as-is form uses the upper-case id of the entry; an id whose upper-case form
 * is no valid variable name has no alias. The value is validated for every
 * entry: anything other than unset, empty, `pass` or `attempt` ends the run
 * with the as-is message and exit 3, before any phase attempt, before the
 * spec is resolved and before the lock is taken. An entry without a
 * declaration has the scope `none`; a valid explicit value set for it draws
 * the as-is warning line. An entry with a declaration has the value, or
 * `pass` when the value is unset or empty. The scope is resolved once,
 * before the first pass, together with the sweep and the validation of the
 * declarations.
 */
import { sweep } from "./sweep.ts";
import {
  declarationTable,
  validateDeclaration,
  type DeclarationEntry,
  type DeclarationRefusal,
} from "./declaration.ts";

/** The scope words of the configured overlay (row 88 of annex X §X.6). */
export const CONFIGURED_SCOPES = ["pass", "attempt"] as const;
export type ConfiguredScope = (typeof CONFIGURED_SCOPES)[number];

/** The scope of an entry without a declaration, and under `parity`. */
export const SCOPE_NONE = "none";
export type OverlayScope = ConfiguredScope | typeof SCOPE_NONE;

/** The as-is form of the scope variable of one entry. */
/** The id of an entry: `id` when present, else the declaration's `key`. */
function entryId(entry: DeclarationEntry): string {
  return entry.id ?? (entry as unknown as { key?: string }).key ?? "";
}

export function scopeVariableOf(id: string): string | null {
  const upper = id.toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(upper)) return null; // no alias: not a valid variable name
  return `SPECSTRIDE_${upper}_OVERLAY`;
}

/** The as-is message of an invalid scope value (F109-FR-031). */
export function invalidScopeMessage(variable: string, value: string): string {
  return `${variable}='${value}' is invalid; accepted values: pass, attempt`;
}

/** The as-is warning of an explicit scope without a declaration. */
export function noOverlayWarning(variable: string, id: string): string {
  return `specstride: warning: ${variable} is set but backend '${id}' has no overlay; ignoring it`;
}

/** The result record of the `scope` operation (F109-FR-034). */
export type ScopeResult = {
  readonly operation: "scope";
  readonly exit_code: 0 | 3;
  /** The resolved scope per entry id. */
  readonly scopes: Readonly<Record<string, OverlayScope>>;
  /** The lines the operation printed on standard error. */
  readonly stderr: readonly string[];
};

/**
 * F109-FR-031 — resolve the scope of every entry once, before the first
 * pass. `quiet` suppresses the warning of an explicit value without a
 * declaration (F109-FR-034: `scope` takes a quiet mode).
 */
export function resolveScopes(
  entries: readonly DeclarationEntry[],
  env: Readonly<Record<string, string | undefined>>,
  options: { readonly quiet?: boolean } = {},
): ScopeResult {
  const stderr: string[] = [];
  const scopes: Record<string, OverlayScope> = {};
  for (const entry of entries) {
    const variable =
      scopeVariableOf(entryId(entry)) ?? `SPECSTRIDE_${entryId(entry).toUpperCase()}_OVERLAY`;
    const raw = env[variable];
    const declared = entry.overlay != null && entry.overlayDeclarable !== false;
    if (raw === undefined || raw === "") {
      scopes[entryId(entry)] = declared ? "pass" : "none";
      continue;
    }
    if (!(CONFIGURED_SCOPES as readonly string[]).includes(raw)) {
      return {
        operation: "scope",
        exit_code: 3,
        scopes,
        stderr: [invalidScopeMessage(variable, raw)],
      };
    }
    if (!declared) {
      if (!options.quiet) stderr.push(noOverlayWarning(variable, entryId(entry)));
      scopes[entryId(entry)] = "none";
      continue;
    }
    scopes[entryId(entry)] = raw as OverlayScope;
  }
  return { operation: "scope", exit_code: 0, scopes, stderr };
}

/** The result record of the `startup` operation (F109-FR-034). */
export type StartupResult =
  | {
      readonly operation: "startup";
      readonly exit_code: 0;
      /** The scope word every entry resolved to, per entry id. */
      readonly scopes: Readonly<Record<string, OverlayScope>>;
      readonly stderr: readonly string[];
    }
  | {
      readonly operation: "startup";
      readonly exit_code: 1 | 3;
      readonly scopes: Readonly<Record<string, OverlayScope>>;
      readonly stderr: readonly string[];
      readonly reason: string;
    };

/**
 * F109-FR-031 / F109-FR-034 — the start-up: sweep the stale overlays of the
 * temporary directory, validate the declarations and resolve every scope,
 * once, before the first pass. Returns 3 for an invalid declaration or scope
 * value, with the error on standard error, and 1 for an internal failure.
 */
export function startup(
  entries: readonly DeclarationEntry[],
  env: Readonly<Record<string, string | undefined>>,
  options: {
    readonly quiet?: boolean;
    readonly tmpDir?: string;
  } = {},
): StartupResult {
  const stderr: string[] = [];
  // The sweep of F109-FR-035 runs with the resolution, once.
  try {
    const swept = sweep({ tmpDir: options.tmpDir });
    stderr.push(...swept.lines);
  } catch (cause) {
    return {
      operation: "startup",
      exit_code: 1,
      scopes: {},
      stderr,
      reason: `sweep failed: ${String(cause)}`,
    };
  }
  let table: readonly DeclarationEntry[];
  try {
    table = declarationTable(entries).table;
  } catch {
    table = entries;
  }
  for (const entry of table) {
    if (entry.overlay == null) continue;
    const verdict = validateDeclaration(entry);
    if (!verdict.ok) {
      const refusal = verdict as DeclarationRefusal;
      return {
        operation: "startup",
        exit_code: 3,
        scopes: {},
        stderr: [...stderr, refusal.error],
        reason: refusal.error,
      };
    }
  }
  const scopes = resolveScopes(table, env, { quiet: options.quiet });
  stderr.push(...scopes.stderr);
  if (scopes.exit_code !== 0) {
    return {
      operation: "startup",
      exit_code: 3,
      scopes: scopes.scopes,
      stderr,
      reason: scopes.stderr[0] ?? "invalid scope",
    };
  }
  return { operation: "startup", exit_code: 0, scopes: scopes.scopes, stderr };
}
