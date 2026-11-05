/**
 * T014 — the registry of EP-13, the lock and liveness provider
 * (F122-FR-019, F122-FR-020; annex F §F.5).
 *
 * Four behaviours, which the sibling registry of EP-17 shares and which
 * `../detach/registry.ts` builds from the same frame:
 *
 *   1. **register** one provider under its id;
 *   2. **resolve by id**;
 *   3. **refuse an unknown id with a configuration error** — exit 3, not a
 *      fallback. Row 277 of annex X §X.7 says an unknown lock provider is a
 *      configuration error, and the closed-set data of this feature repeats it
 *      (`lock-providers`, `"unknown": "configuration error (exit 3)"`). A
 *      registry that quietly fell back to the shipped provider would let a
 *      consumer believe a provider of theirs was in use;
 *   4. **read-only after launch** — once the launch has taken its providers,
 *      the set cannot change. A provider registered half way through a run
 *      would mean two runs of one launch disagreeing about what holds the
 *      lock.
 *
 * The registry is OPEN (row 277): it holds no list of providers of its own.
 * The shipped provider is REGISTERED like any other, by a later task, through
 * the same `register` call a consumer's provider would use.
 */
import { POINT_ID, EP, ANNEX_SECTION, type LockProvider } from "@specstride/contracts/ep/lock";
import {
  ExtensionRegistryClosedError,
  UnknownImplementationError,
  DuplicateImplementationError,
  createExtensionRegistry,
  type ExtensionRegistry,
} from "../registry-frame.ts";

export { POINT_ID, EP, ANNEX_SECTION };
export { ExtensionRegistryClosedError, UnknownImplementationError, DuplicateImplementationError };
export type { LockProvider };

/** The requirements this registry carries. */
export const LOCK_REGISTRY_REQUIREMENTS = ["F122-FR-019", "F122-FR-020"] as const;

/** Row 277 of annex X §X.7 — the set of lock providers is open. */
export const LOCK_REGISTRY_IS_OPEN = true as const;
export const LOCK_PROVIDERS_ROW = 277 as const;

/** The configuration key that names the provider in use (row 115). */
export const LOCK_PROVIDER_KEY = "runtime.lock.provider" as const;

/** The exit code of an unknown provider id: a configuration error. */
export const UNKNOWN_PROVIDER_EXIT_CODE = 3 as const;

/** The registry of EP-13. */
export type LockProviderRegistry = ExtensionRegistry<LockProvider>;

/**
 * Build an empty registry of lock providers. Every provider, the shipped one
 * included, arrives through `register`.
 */
export function createLockProviderRegistry(): LockProviderRegistry {
  return createExtensionRegistry<LockProvider>({
    pointId: POINT_ID,
    ep: EP,
    annexSection: ANNEX_SECTION,
    what: "lock and liveness provider",
    configurationKey: LOCK_PROVIDER_KEY,
    idOf: (provider) => provider.id,
  });
}
