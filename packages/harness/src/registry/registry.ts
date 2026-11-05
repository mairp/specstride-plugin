/**
 * The one harness registry (T025; F109-FR-001).
 *
 * There is exactly one registry. It holds tested harness adapters, bundled
 * harness descriptors, harnesses the consumer declared and harnesses that
 * discovery detected, each as one entry with a unique id. Help text, error
 * messages and every listing of harnesses read THIS module — no other list of
 * harness names exists (that is what CT-109-8 proves for the core).
 *
 * The registry order is the order of registration, which is the order of
 * display; the output is byte-stable only through it (as at the baseline,
 * `lib/backends.py`, "Registry order is display order").
 *
 * Under the `parity` profile the registry holds one entry for each stub
 * executable that is named after an as-is command, with the roles, the
 * qualifier form, the stream format and the overlay declaration that the
 * baseline gives that entry (as-is `REGISTRY` of `lib/backends.py`; no
 * shipped entry of the baseline sets `stream` or `overlay`). The stub
 * executables of feature 141 that are NOT as-is commands (`pi`,
 * `stub-harness`) hold no entry here.
 */
import { defaultTransportBinding, type TransportBinding } from "../transports/transports.ts";

/** The qualifier forms of an entry, per role (F109-FR-006, closed set). */
export const QUALIFIER_FORMS = ["none", "optional", "required"] as const;
export type QualifierForm = (typeof QUALIFIER_FORMS)[number];

/**
 * The roles the registry answers about. The set of roles is open and owned by
 * feature 124; the baseline serves exactly these two, so the registry knows
 * them by name and every other role is answered from the entries themselves.
 */
export const REGISTRY_ROLES = ["proposer", "critic"] as const;
export type RegistryRole = (typeof REGISTRY_ROLES)[number];

/** How one entry serves one role (F109-FR-006). */
export type EntryRole = {
  /** Whether the entry is offered for the role at all. */
  served: boolean;
  /** The qualifier form of the role. */
  form: QualifierForm;
  /** The label of the qualifier; null exactly where the form is `none`. */
  label: string | null;
};

/** The overlay declaration of an entry (F109-FR-030); null declares none. */
export type OverlayDeclaration = {
  vars: readonly string[];
  seeds: readonly string[];
};

/** One entry of the registry (the fields of data-model.md "Registry entry" that US1 reads). */
export type RegistryEntry = {
  /** Id of the harness: lower-case letters, digits, hyphens; unique. */
  id: string;
  /** `adapter`, `bundled`, `user`, `detected` — set by the loader of the source. */
  origin: "adapter" | "bundled" | "user" | "detected";
  /** Per role: served or not, the qualifier form and its label. */
  roles: Readonly<Record<string, EntryRole>>;
  /** Stream format, or null for raw text (F109-FR-007). */
  stream: string | null;
  /** The overlay declaration, or null for none (F109-FR-030). */
  overlay: OverlayDeclaration | null;
  /** Transports as a property of the entry (F109-FR-011). */
  transports: readonly TransportBinding[];
};

/** The role record of an entry that serves a role with the given qualifier. */
export function servingRole(form: QualifierForm, label: string | null = null): EntryRole {
  return { served: true, form, label: form === "none" ? null : label };
}

/** The role record of an entry that does not serve a role. */
export const NOT_SERVED: EntryRole = { served: false, form: "none", label: null };

function entry(input: {
  id: string;
  origin?: RegistryEntry["origin"];
  roles: Record<string, EntryRole>;
  stream?: string | null;
  overlay?: OverlayDeclaration | null;
}): RegistryEntry {
  const roles: Record<string, EntryRole> = {};
  for (const role of REGISTRY_ROLES) roles[role] = input.roles[role] ?? NOT_SERVED;
  return {
    id: input.id,
    origin: input.origin ?? "adapter",
    roles,
    stream: input.stream ?? null,
    overlay: input.overlay ?? null,
    transports: [defaultTransportBinding()],
  };
}

/**
 * The entries of the `parity` profile, in the baseline's registration order
 * (as-is `REGISTRY`, `lib/backends.py` at `9cab15d`): `dsh`, `claude`, `codex`,
 * `prime`. No baseline
 * entry names a stream format or declares an overlay.
 */
export function parityEntries(): RegistryEntry[] {
  return [
    entry({
      id: "dsh",
      roles: {
        proposer: servingRole("optional", "provider/model"),
        critic: servingRole("optional", "provider/model"),
      },
    }),
    entry({
      id: "claude",
      roles: { proposer: servingRole("none"), critic: servingRole("none") },
    }),
    entry({
      id: "codex",
      roles: { proposer: servingRole("none"), critic: servingRole("none") },
    }),
    entry({
      id: "prime",
      roles: {
        proposer: servingRole("optional", "variant"),
        critic: servingRole("optional", "variant"),
      },
    }),
  ];
}

/** Why a registry could not be read (F109-FR-006: the line of help). */
export class RegistryUnreadableError extends Error {
  public readonly cause_: unknown;

  constructor(cause?: unknown) {
    super("the harness registry could not be read");
    this.name = "RegistryUnreadableError";
    this.cause_ = cause;
  }
}

/**
 * The one registry. Entries keep the order of registration, which is the
 * order of display; a duplicate id fails the registration.
 */
export class HarnessRegistry {
  private readonly list: RegistryEntry[] = [];

  /** The profile the engine runs under; `parity` installs the stub entries. */
  public readonly profile: string | null;

  constructor(profile: string | null = null, entries: readonly RegistryEntry[] = []) {
    this.profile = profile;
    for (const one of entries) this.register(one);
  }

  /** Registers one entry at the end of the order; refuses a duplicate id. */
  register(one: RegistryEntry): void {
    if (this.find(one.id) !== null) {
      throw new Error(`harness registry: duplicate id: ${one.id}`);
    }
    this.list.push(one);
  }

  /** The entries in registration order. */
  entries(): readonly RegistryEntry[] {
    return this.list;
  }

  /** The entry named `id`, or null (bare names only — no qualifier here). */
  find(id: string): RegistryEntry | null {
    for (const one of this.list) if (one.id === id) return one;
    return null;
  }

  /** Names of the entries serving `role`, in registry order. */
  names(role: string): string[] {
    return this.list.filter((one) => one.roles[role]?.served).map((one) => one.id);
  }
}

/**
 * The registry a run reads. Under the `parity` profile the parity stub
 * entries are registered first, then everything the sources of the run
 * brought (adapters, bundled descriptors, declarations, detection) in that
 * order. A source that throws makes the registry unreadable, which help
 * reports with the as-is line (F109-FR-006) — the throw is never swallowed.
 */
export function createRegistry(options: {
  profile?: string | null;
  sources?: readonly (() => readonly RegistryEntry[])[];
}): HarnessRegistry {
  const registry = new HarnessRegistry(options.profile ?? null);
  if ((options.profile ?? null) === "parity") {
    for (const one of parityEntries()) registry.register(one);
  }
  for (const source of options.sources ?? []) {
    for (const one of source()) registry.register(one);
  }
  return registry;
}

/**
 * Reads a registry from a source that may fail. The failure surfaces as
 * `RegistryUnreadableError` — the shape help and the display line react to —
 * and never as a partial list.
 */
export function readRegistry(source: () => HarnessRegistry): HarnessRegistry {
  try {
    return source();
  } catch (error) {
    throw new RegistryUnreadableError(error);
  }
}
