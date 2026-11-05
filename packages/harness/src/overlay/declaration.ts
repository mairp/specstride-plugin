/**
 * T079 — the validation of an overlay declaration (F109-FR-030).
 *
 * A declaration that breaks one of the rules is refused with a configuration
 * error (result code 3). When the declarations cannot be read at all, the
 * table is empty, every entry has the scope `none`, and the operation
 * succeeds (F109-FR-030's last rule).
 */
import { readFileSync } from "node:fs";

/** The rules of a declaration, as the plan data of this feature carries them. */
const RULES: {
  keyPattern: string;
  fields: readonly string[];
  varPattern: string;
  reserved: { names: readonly string[]; prefixes: readonly string[] };
  seedFields: readonly string[];
  credentialWords: readonly string[];
} = JSON.parse(
  readFileSync(new URL("../../data/plan/overlay-rules.json", import.meta.url), "utf8"),
) as {
  keyPattern: string;
  fields: readonly string[];
  varPattern: string;
  reserved: { names: readonly string[]; prefixes: readonly string[] };
  seedFields: readonly string[];
  credentialWords: readonly string[];
};

/** The key pattern: the id of the entry without a qualifier. */
export const DECLARATION_KEY_PATTERN = new RegExp(RULES.keyPattern);
/** The only fields a declaration may carry. */
export const DECLARATION_FIELDS = RULES.fields;
/** The pattern of a declared variable name. */
export const DECLARATION_VAR_PATTERN = new RegExp(RULES.varPattern);
/** Reserved variable names and reserved prefixes. */
export const RESERVED_NAMES = RULES.reserved.names;
export const RESERVED_PREFIXES = RULES.reserved.prefixes;
/** The exact fields of a seed. */
export const SEED_FIELDS = RULES.seedFields;
/** The words that make a seed's content look like a credential. */
export const CREDENTIAL_WORDS = RULES.credentialWords;

/** A seed of a declaration: exactly a variable, a path and a content. */
export type OverlaySeed = {
  readonly var: string;
  readonly path: string;
  readonly content: string;
};

/** A declaration as the descriptor's `isolation.configHome` carries it. */
export type OverlayDeclarationData = {
  readonly vars?: readonly string[];
  readonly seeds?: readonly OverlaySeed[];
};

/** The entry the declaration is validated for. */
export type DeclarationEntry = {
  readonly id: string;
  readonly overlay?: OverlayDeclarationData | null;
  /**
   * False exactly where the harness adapter keeps an overlay of its own for
   * its configuration home (F109-FR-030): such an adapter refuses a
   * declaration for its entry.
   */
  readonly overlayDeclarable?: boolean;
};

/** A refusal of a declaration: a configuration error, result code 3. */
export type DeclarationRefusal = {
  readonly ok: false;
  readonly exit_code: 3;
  readonly error: string;
};

/** An accepted declaration, in the validated form the overlay uses. */
export type AcceptedDeclaration = {
  readonly ok: true;
  readonly key: string;
  readonly vars: readonly string[];
  readonly seeds: readonly OverlaySeed[];
};

export type DeclarationVerdict = AcceptedDeclaration | DeclarationRefusal;

function refuse(error: string): DeclarationRefusal {
  return { ok: false, exit_code: 3, error };
}

/** True when a seed's content looks like a credential (any case). */
export function looksLikeCredential(content: string): boolean {
  const lowered = content.toLowerCase();
  return CREDENTIAL_WORDS.some((word) => lowered.includes(word));
}

/** True when a seed's path leaves the directory of its variable. */
export function seedPathEscapes(path: string): boolean {
  if (path.startsWith("/")) return true;
  const parts = path.split("/");
  return parts.some((part) => part === "" || part === "." || part === "..");
}

/**
 * F109-FR-030 — validate the declaration of one entry. Every rule refusal is
 * a configuration error with the message naming what broke.
 */
export function validateDeclaration(entry: DeclarationEntry): DeclarationVerdict {
  if (entry.overlayDeclarable === false && entry.overlay != null) {
    return refuse(
      `overlay declaration: backend '${entry.id}' keeps an overlay of its own and refuses a declaration`,
    );
  }
  const key = entry.id;
  if (!DECLARATION_KEY_PATTERN.test(key)) {
    return refuse(
      `overlay declaration: the key '${key}' is not an entry id in lower-case letters and digits starting with a letter`,
    );
  }
  const overlay = entry.overlay as Record<string, unknown> | null | undefined;
  if (overlay == null) return refuse("overlay declaration: no declaration to validate");
  for (const field of Object.keys(overlay)) {
    if (!DECLARATION_FIELDS.includes(field)) {
      return refuse(
        `overlay declaration: unknown field '${field}'; only vars and seeds are allowed`,
      );
    }
  }
  const vars = (overlay.vars ?? []) as readonly string[];
  if (!Array.isArray(vars) || vars.length === 0) {
    return refuse("overlay declaration: vars must be a list that is not empty");
  }
  const seen = new Set<string>();
  for (const name of vars) {
    if (typeof name !== "string" || !DECLARATION_VAR_PATTERN.test(name)) {
      return refuse(
        `overlay declaration: the variable '${String(name)}' is not a name in upper-case letters, digits and underscores`,
      );
    }
    if (seen.has(name)) {
      return refuse(`overlay declaration: the variable '${name}' is declared twice`);
    }
    if (RESERVED_NAMES.includes(name)) {
      return refuse(`overlay declaration: the variable name '${name}' is reserved`);
    }
    const prefix = RESERVED_PREFIXES.find((one) => name.startsWith(one));
    if (prefix !== undefined) {
      return refuse(
        `overlay declaration: the variable name '${name}' starts with the reserved prefix '${prefix}'`,
      );
    }
    seen.add(name);
  }
  const seeds = (overlay.seeds ?? []) as readonly OverlaySeed[];
  const files = new Set<string>();
  for (const seed of seeds as readonly Record<string, unknown>[]) {
    for (const field of Object.keys(seed)) {
      if (!SEED_FIELDS.includes(field)) {
        return refuse(
          `overlay declaration: a seed carries the unknown field '${field}'; a seed has exactly var, path and content`,
        );
      }
    }
    const name = seed.var as string;
    if (!seen.has(name)) {
      return refuse(`overlay declaration: a seed names the undeclared variable '${String(name)}'`);
    }
    const path = seed.path as string;
    if (seedPathEscapes(path)) {
      return refuse(
        `overlay declaration: the seed path '${String(path)}' is not relative or leaves its directory`,
      );
    }
    const file = `${name}/${path}`;
    if (files.has(file)) {
      return refuse(
        `overlay declaration: two seeds name the same file '${path}' of the variable '${name}'`,
      );
    }
    files.add(file);
    if (looksLikeCredential(String(seed.content))) {
      return refuse(
        `overlay declaration: the content of the seed '${path}' of '${name}' looks like a credential`,
      );
    }
  }
  return { ok: true, key, vars: [...vars], seeds: seeds.map((seed) => ({ ...seed })) };
}

/**
 * F109-FR-030 — the declaration table of a run. Where the declarations
 * cannot be read, the table is empty and the operation succeeds: every entry
 * runs with the scope `none` and nothing of the overlay is used.
 */
export function declarationTable(
  entries: readonly DeclarationEntry[],
  read: () => readonly DeclarationEntry[] = () => entries,
): { readonly ok: true; readonly exit_code: 0; readonly table: readonly DeclarationEntry[] } {
  let table: readonly DeclarationEntry[];
  try {
    table = read();
  } catch {
    table = [];
  }
  return { ok: true, exit_code: 0, table };
}
