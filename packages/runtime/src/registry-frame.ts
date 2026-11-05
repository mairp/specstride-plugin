/**
 * T014 — the frame both registries of this feature are built from: EP-13, the
 * lock and liveness provider (`lock/registry.ts`), and EP-17, the detach
 * strategy (`detach/registry.ts`).
 *
 * The two extension points are different; the four behaviours T014 asks for
 * are not:
 *
 *   1. **register** one implementation under its id;
 *   2. **resolve by id**;
 *   3. **refuse an unknown id with a CONFIGURATION ERROR** — exit 3. Both
 *      points say so in their own words: `unknownStrategyMessage` of the EP-17
 *      contract spells out "configuration error (exit 3)", and rows 24 and 277
 *      of annex X §X.7 say the same for either set. A registry never falls back
 *      to a default for an id it does not know, because a consumer who named a
 *      provider would then be running on a different one and be told nothing;
 *   4. **read-only after launch**. `seal()` is called once the launch has taken
 *      what it needs, and every later `register` throws. Two things make this
 *      worth a mechanism rather than a convention: a provider added mid-run
 *      would make two readers of one launch disagree about what holds the lock,
 *      and the launch record names the strategy in use, so the set it was
 *      chosen from has to be the set that stays.
 *
 * Both registries are OPEN: neither holds a list of its own. The shipped
 * provider and the two strategies of Wave 1 are registered through the same
 * `register` call a consumer's implementation would use.
 */

/** The exit code of an unknown id in configuration, for both points. */
export const CONFIGURATION_ERROR_EXIT_CODE = 3 as const;

/** What a registry is: open, and read-only once the launch has taken from it. */
export const REGISTRY_IS_OPEN = true as const;
export const REGISTRY_IS_READ_ONLY_AFTER_LAUNCH = true as const;

/** What a registry needs to know about the point it serves. */
export type ExtensionRegistryShape<T> = {
  readonly pointId: string;
  readonly ep: string;
  readonly annexSection: string;
  /** What an implementation of this point is called, in words. */
  readonly what: string;
  /** The configuration key that names which implementation is in use. */
  readonly configurationKey: string;
  /** The id of an implementation. */
  idOf(implementation: T): string;
};

/**
 * An id that no implementation is registered under. It is a CONFIGURATION
 * ERROR and carries exit 3: the caller does not have to decide what kind of
 * failure this is.
 */
export class UnknownImplementationError extends Error {
  readonly isConfigurationError = true as const;
  readonly exitCode = CONFIGURATION_ERROR_EXIT_CODE;
  readonly pointId: string;
  readonly id: string;
  readonly registered: readonly string[];
  readonly key: string;
  constructor(fields: {
    pointId: string;
    ep: string;
    annexSection: string;
    what: string;
    key: string;
    id: string;
    registered: readonly string[];
  }) {
    super(
      `configuration error (exit ${CONFIGURATION_ERROR_EXIT_CODE}): no ${fields.what} ` +
        `\`${fields.id}\` is registered for \`${fields.pointId}\` (${fields.ep}, ` +
        `${fields.annexSection}). The key \`${fields.key}\` names it; the registered ids are ` +
        `${fields.registered.length === 0 ? "(none)" : fields.registered.join(", ")}`,
    );
    this.name = "UnknownImplementationError";
    this.pointId = fields.pointId;
    this.id = fields.id;
    this.registered = Object.freeze([...fields.registered]);
    this.key = fields.key;
  }
}

/**
 * An id registered twice. The registration is refused and not silently won by
 * the later call: a registry that let one implementation replace another would
 * make the behaviour of a launch depend on the order its packages loaded.
 */
export class DuplicateImplementationError extends Error {
  readonly pointId: string;
  readonly id: string;
  constructor(fields: { pointId: string; what: string; id: string }) {
    super(
      `the ${fields.what} \`${fields.id}\` is already registered for ` +
        `\`${fields.pointId}\`; a registration never replaces another, because the behaviour ` +
        `of a launch would then depend on the order its packages loaded`,
    );
    this.name = "DuplicateImplementationError";
    this.pointId = fields.pointId;
    this.id = fields.id;
  }
}

/** A registration after the launch has taken its implementations (T014). */
export class ExtensionRegistryClosedError extends Error {
  readonly pointId: string;
  readonly id: string;
  readonly sealedBecause: string;
  constructor(fields: { pointId: string; what: string; id: string; sealedBecause: string }) {
    super(
      `the registry of \`${fields.pointId}\` is read-only: the ${fields.what} ` +
        `\`${fields.id}\` cannot be registered because ${fields.sealedBecause}. A registry is ` +
        `sealed once the launch has taken from it, so that every reader of the launch agrees ` +
        `about which implementation is in use (T014)`,
    );
    this.name = "ExtensionRegistryClosedError";
    this.pointId = fields.pointId;
    this.id = fields.id;
    this.sealedBecause = fields.sealedBecause;
  }
}

/** The registry of one extension point. */
export type ExtensionRegistry<T> = {
  readonly pointId: string;
  readonly ep: string;
  /** The configuration key that names which implementation is in use. */
  readonly key: string;
  /** Register one implementation under its own id. */
  register(implementation: T): void;
  /** The registered ids, in the order they were registered. */
  readonly ids: readonly string[];
  /** The implementation of an id, or `undefined` where none is registered. */
  find(id: string): T | undefined;
  /** True where an id is registered. */
  has(id: string): boolean;
  /**
   * The implementation of an id. An unknown id throws
   * `UnknownImplementationError`, which carries exit 3.
   */
  resolve(id: string): T;
  /** Make the registry read-only. Idempotent; the first reason is kept. */
  seal(because?: string): void;
  /** True once `seal` has been called. */
  readonly sealed: boolean;
  /** Why it was sealed, or `null` while it is still open. */
  readonly sealedBecause: string | null;
};

/** Why a registry is sealed, where the caller of `seal` names no reason. */
export const SEALED_AT_LAUNCH = "the launch has taken its implementations" as const;

/** Build an open registry for one extension point. */
export function createExtensionRegistry<T>(shape: ExtensionRegistryShape<T>): ExtensionRegistry<T> {
  const order: string[] = [];
  const byId = new Map<string, T>();
  let sealedBecause: string | null = null;

  return Object.freeze({
    pointId: shape.pointId,
    ep: shape.ep,
    key: shape.configurationKey,

    register(implementation: T): void {
      const id = shape.idOf(implementation);
      if (typeof id !== "string" || id.length === 0) {
        throw new Error(
          `a ${shape.what} offered to the registry of \`${shape.pointId}\` has no id; an ` +
            `implementation is registered under its own id and never anonymously`,
        );
      }
      if (sealedBecause !== null) {
        throw new ExtensionRegistryClosedError({
          pointId: shape.pointId,
          what: shape.what,
          id,
          sealedBecause,
        });
      }
      if (byId.has(id)) {
        throw new DuplicateImplementationError({ pointId: shape.pointId, what: shape.what, id });
      }
      byId.set(id, implementation);
      order.push(id);
    },

    get ids(): readonly string[] {
      return Object.freeze([...order]);
    },

    find(id: string): T | undefined {
      return byId.get(id);
    },

    has(id: string): boolean {
      return byId.has(id);
    },

    resolve(id: string): T {
      const found = byId.get(id);
      if (found === undefined) {
        throw new UnknownImplementationError({
          pointId: shape.pointId,
          ep: shape.ep,
          annexSection: shape.annexSection,
          what: shape.what,
          key: shape.configurationKey,
          id,
          registered: order,
        });
      }
      return found;
    },

    seal(because: string = SEALED_AT_LAUNCH): void {
      // Idempotent, and the FIRST reason is kept: a second seal is not a
      // different event, and a later reason would hide the real one.
      if (sealedBecause === null) sealedBecause = because;
    },

    get sealed(): boolean {
      return sealedBecause !== null;
    },

    get sealedBecause(): string | null {
      return sealedBecause;
    },
  });
}
