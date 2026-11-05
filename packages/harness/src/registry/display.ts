/**
 * Spelling, display and the line for an unreadable registry (T029;
 * F109-FR-006).
 *
 * The spelling of an entry is `name` for the form `none`, `name[:label]` for
 * `optional` and `name:label` for `required`. The display of a role is one
 * line: the spellings of the entries that serve the role, joined with ` | `
 * in registry order (as at the baseline, `lib/backends.py`).
 *
 * When the registry cannot be read while help is printed, help shows the
 * as-is line `(backend list unavailable: could not run lib/backends.py; see
 * README "Configuration")` in compatibility output, a line of the same
 * meaning that names the registry in default output — and still succeeds.
 */
import {
  HarnessRegistry,
  RegistryUnreadableError,
  type RegistryEntry,
  type RegistryRole,
} from "./registry.ts";

/** The as-is line of compatibility output (the literal of the baseline). */
export const UNREADABLE_COMPAT_LINE =
  '(backend list unavailable: could not run lib/backends.py; see README "Configuration")';

/** The line of the same meaning that names the registry, for default output. */
export const UNREADABLE_DEFAULT_LINE =
  '(harness list unavailable: could not read the harness registry; see README "Configuration")';

/**
 * The spelling of one entry for one role. An entry that does not serve the
 * role has no spelling; the caller lists only servers.
 */
export function spelling(entry: RegistryEntry, role: RegistryRole): string | null {
  const served = entry.roles[role];
  if (!served?.served) return null;
  if (served.form === "none") return entry.id;
  if (served.form === "optional") return `${entry.id}[:${served.label}]`;
  return `${entry.id}:${served.label}`;
}

/**
 * The display of a role: one line, spellings joined with ` | `, registry
 * order.
 */
export function display(registry: HarnessRegistry, role: RegistryRole): string {
  const parts: string[] = [];
  for (const entry of registry.entries()) {
    const spelled = spelling(entry, role);
    if (spelled !== null) parts.push(spelled);
  }
  return parts.join(" | ");
}

/** The backend line of help for one role, reading the registry. */
export function helpLine(
  read: () => HarnessRegistry,
  role: RegistryRole,
): { ok: true; line: string } | { ok: false; line: string } {
  try {
    return { ok: true, line: display(read(), role) };
  } catch (error) {
    if (error instanceof RegistryUnreadableError)
      return { ok: false, line: UNREADABLE_DEFAULT_LINE };
    throw error;
  }
}

/**
 * The backend line of help as the compatibility projection prints it: the
 * as-is literal where the registry cannot be read, the display line where it
 * can. Help still succeeds in both cases (F109-FR-006).
 */
export function compatibilityHelpLine(
  read: () => HarnessRegistry,
  role: RegistryRole,
): { ok: true; line: string } | { ok: false; line: string } {
  try {
    return { ok: true, line: display(read(), role) };
  } catch (error) {
    if (error instanceof RegistryUnreadableError)
      return { ok: false, line: UNREADABLE_COMPAT_LINE };
    throw error;
  }
}
