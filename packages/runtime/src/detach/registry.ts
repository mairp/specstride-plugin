/**
 * T014 — the registry of EP-17, the detach strategy (F122-FR-002; annex F
 * §F.6).
 *
 * The same four behaviours as the registry of EP-13 — register, resolve by id,
 * refuse an unknown id with a configuration error, read-only after launch —
 * over the other point, built from the shared frame in `../registry-frame.ts`.
 *
 * What is particular to EP-17 is the message of an unknown id: the CONTRACT of
 * feature 100 writes it (`unknownStrategyMessage`), and this registry uses that
 * function rather than composing a sentence of its own, so the wording a
 * consumer sees is the one the annex pinned. The exit code is the contract's
 * too (`UNKNOWN_STRATEGY_EXIT_CODE`, 3).
 *
 * Row 24 of annex X §X.7 makes this set open: Wave 1 ships `spawn-detached`
 * and `foreground`, and both are REGISTERED by a later task through the same
 * `register` call a consumer's strategy would use. Nothing here is built in —
 * `ids` of a fresh registry is empty, and the test of T014 reads it.
 */
import {
  POINT_ID,
  EP,
  ANNEX_SECTION,
  DEFAULT_STRATEGY,
  STRATEGY_WITHOUT_DETACHING,
  UNKNOWN_STRATEGY_EXIT_CODE,
  WAVE_1_STRATEGIES,
  unknownStrategyMessage,
  type DetachStrategy,
  type StrategyId,
} from "@specstride/contracts/ep/detach";
import {
  ExtensionRegistryClosedError,
  DuplicateImplementationError,
  UnknownImplementationError,
  createExtensionRegistry,
  type ExtensionRegistry,
} from "../registry-frame.ts";

export {
  POINT_ID,
  EP,
  ANNEX_SECTION,
  DEFAULT_STRATEGY,
  STRATEGY_WITHOUT_DETACHING,
  UNKNOWN_STRATEGY_EXIT_CODE,
  WAVE_1_STRATEGIES,
  unknownStrategyMessage,
};
export { ExtensionRegistryClosedError, DuplicateImplementationError, UnknownImplementationError };
export type { DetachStrategy, StrategyId };

/** The requirement this registry carries. */
export const DETACH_REGISTRY_REQUIREMENT = "F122-FR-002" as const;

/** Row 24 of annex X §X.7 — the set of detach strategies is open. */
export const DETACH_REGISTRY_IS_OPEN = true as const;
export const DETACH_STRATEGIES_ROW = 24 as const;

/** The configuration key that names the strategy in use (row 113). */
export const DETACH_STRATEGY_KEY = "runtime.detach.strategy" as const;

/**
 * A strategy carries its id in `describe()` and not as a field of its own, so
 * the registry asks for it the way the contract says a strategy answers.
 */
export function strategyIdOf(strategy: DetachStrategy): StrategyId {
  return strategy.describe().id;
}

/**
 * An unknown strategy id. It is a configuration error with exit 3, and its
 * message is the one the CONTRACT of feature 100 writes, not one composed
 * here.
 */
export class UnknownStrategyError extends Error {
  readonly isConfigurationError = true as const;
  readonly exitCode = UNKNOWN_STRATEGY_EXIT_CODE;
  readonly id: string;
  readonly registered: readonly string[];
  readonly key = DETACH_STRATEGY_KEY;
  constructor(id: string, registered: readonly string[]) {
    super(
      `${unknownStrategyMessage(id)}. The key \`${DETACH_STRATEGY_KEY}\` names it; the ` +
        `registered strategies are ` +
        `${registered.length === 0 ? "(none)" : registered.join(", ")}`,
    );
    this.name = "UnknownStrategyError";
    this.id = id;
    this.registered = Object.freeze([...registered]);
  }
}

/** The registry of EP-17. */
export type DetachStrategyRegistry = Omit<ExtensionRegistry<DetachStrategy>, "resolve"> & {
  /** The strategy of an id. An unknown id throws `UnknownStrategyError`. */
  resolve(id: string): DetachStrategy;
};

/**
 * Build an empty registry of detach strategies. The two strategies of Wave 1
 * arrive through `register`, like any other.
 */
export function createDetachStrategyRegistry(): DetachStrategyRegistry {
  const frame = createExtensionRegistry<DetachStrategy>({
    pointId: POINT_ID,
    ep: EP,
    annexSection: ANNEX_SECTION,
    what: "detach strategy",
    configurationKey: DETACH_STRATEGY_KEY,
    idOf: strategyIdOf,
  });
  return Object.freeze({
    get pointId(): string {
      return frame.pointId;
    },
    get ep(): string {
      return frame.ep;
    },
    get key(): string {
      return frame.key;
    },
    register: (strategy: DetachStrategy): void => frame.register(strategy),
    get ids(): readonly string[] {
      return frame.ids;
    },
    find: (id: string): DetachStrategy | undefined => frame.find(id),
    has: (id: string): boolean => frame.has(id),
    resolve(id: string): DetachStrategy {
      const found = frame.find(id);
      // The message of the contract, not one of this registry's own.
      if (found === undefined) throw new UnknownStrategyError(id, frame.ids);
      return found;
    },
    seal: (because?: string): void => frame.seal(because),
    get sealed(): boolean {
      return frame.sealed;
    },
    get sealedBecause(): string | null {
      return frame.sealedBecause;
    },
  });
}
