/**
 * T014 — unit test of the two registries: EP-13, the lock and liveness
 * provider, and EP-17, the detach strategy (F122-FR-002, F122-FR-019).
 *
 * The four behaviours T014 names are tested for BOTH points, because they are
 * the same four and a test of one would not prove the other:
 *
 *   1. register,
 *   2. resolve by id,
 *   3. refuse an unknown id with a configuration error — which must carry exit
 *      3 and must NOT be a quiet fall back to a default,
 *   4. read-only after launch.
 *
 * Plus the two things that are particular to each point: EP-17's refusal uses
 * the message the CONTRACT of feature 100 writes, and neither registry holds a
 * built-in implementation — both are open, so a fresh one is empty.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CONFIGURATION_ERROR_EXIT_CODE,
  DuplicateImplementationError,
  ExtensionRegistryClosedError,
  REGISTRY_IS_OPEN,
  REGISTRY_IS_READ_ONLY_AFTER_LAUNCH,
  SEALED_AT_LAUNCH,
  UnknownImplementationError,
} from "../../src/registry-frame.ts";
import {
  LOCK_PROVIDER_KEY,
  LOCK_PROVIDERS_ROW,
  POINT_ID as LOCK_POINT_ID,
  UNKNOWN_PROVIDER_EXIT_CODE,
  createLockProviderRegistry,
} from "../../src/lock/registry.ts";
import {
  DEFAULT_STRATEGY,
  DETACH_STRATEGIES_ROW,
  DETACH_STRATEGY_KEY,
  POINT_ID as DETACH_POINT_ID,
  STRATEGY_WITHOUT_DETACHING,
  UNKNOWN_STRATEGY_EXIT_CODE,
  UnknownStrategyError,
  WAVE_1_STRATEGIES,
  createDetachStrategyRegistry,
  unknownStrategyMessage,
} from "../../src/detach/registry.ts";
import type { LockProvider } from "@specstride/contracts/ep/lock";
import type { DetachStrategy } from "@specstride/contracts/ep/detach";

/** A provider that does nothing: the registry is the subject, not the provider. */
function stubProvider(id: string): LockProvider {
  const nope = (): never => {
    throw new Error("the stub provider of a registry test is never called");
  };
  return {
    id,
    acquire: nope,
    heartbeat: nope,
    release: nope,
    probe: nope,
    reclaim: nope,
    handDown: nope,
    verify: nope,
  };
}

/** A strategy that does nothing; its id lives in `describe()`, per the contract. */
function stubStrategy(id: string): DetachStrategy {
  return {
    available: () => ({ available: true, reason: "a stub of a registry test" }),
    start: () => Promise.reject(new Error("the stub strategy is never started")),
    describe: () => ({
      id,
      survives: { endOfTheParent: true, endOfTheHostSession: true, reboot: false },
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Both registries are open: nothing is built in.
 * ------------------------------------------------------------------ */

test("T014 — both registries are open, so a fresh one holds nothing", () => {
  assert.equal(REGISTRY_IS_OPEN, true);
  assert.deepEqual([...createLockProviderRegistry().ids], []);
  assert.deepEqual([...createDetachStrategyRegistry().ids], []);
  // The two strategies of Wave 1 are named by the contract and REGISTERED by a
  // later task; they are not inside the registry.
  assert.deepEqual([...WAVE_1_STRATEGIES], ["spawn-detached", "foreground"]);
  assert.equal(DEFAULT_STRATEGY, "spawn-detached");
  assert.equal(STRATEGY_WITHOUT_DETACHING, "foreground");
  assert.equal(DETACH_STRATEGIES_ROW, 24);
  assert.equal(LOCK_PROVIDERS_ROW, 277);
});

test("T014 — each registry knows its point and the key that names an implementation", () => {
  const lock = createLockProviderRegistry();
  assert.equal(lock.pointId, LOCK_POINT_ID);
  assert.equal(lock.pointId, "specstride.lock/1");
  assert.equal(lock.ep, "EP-13");
  assert.equal(lock.key, LOCK_PROVIDER_KEY);
  assert.equal(LOCK_PROVIDER_KEY, "runtime.lock.provider");

  const detach = createDetachStrategyRegistry();
  assert.equal(detach.pointId, DETACH_POINT_ID);
  assert.equal(detach.pointId, "specstride.detach/1");
  assert.equal(detach.ep, "EP-17");
  assert.equal(detach.key, DETACH_STRATEGY_KEY);
  assert.equal(DETACH_STRATEGY_KEY, "runtime.detach.strategy");
});

/* ------------------------------------------------------------------ *
 * 1 and 2. Register, and resolve by id.
 * ------------------------------------------------------------------ */

test("T014 — a lock provider is registered and resolved by its id", () => {
  const registry = createLockProviderRegistry();
  const shipped = stubProvider("specstride.directory-lock");
  registry.register(shipped);
  assert.deepEqual([...registry.ids], ["specstride.directory-lock"]);
  assert.equal(registry.has("specstride.directory-lock"), true);
  assert.equal(registry.find("specstride.directory-lock"), shipped);
  assert.equal(registry.resolve("specstride.directory-lock"), shipped);

  // A second, like a consumer's own, sits beside it in registration order.
  const theirs = stubProvider("acme.lock");
  registry.register(theirs);
  assert.deepEqual([...registry.ids], ["specstride.directory-lock", "acme.lock"]);
  assert.equal(registry.resolve("acme.lock"), theirs);
  assert.equal(registry.resolve("specstride.directory-lock"), shipped);
});

test("T014 — a detach strategy is registered under the id of its `describe()`", () => {
  const registry = createDetachStrategyRegistry();
  const spawn = stubStrategy("spawn-detached");
  const foreground = stubStrategy("foreground");
  registry.register(spawn);
  registry.register(foreground);
  assert.deepEqual([...registry.ids], ["spawn-detached", "foreground"]);
  assert.equal(registry.resolve("spawn-detached"), spawn);
  assert.equal(registry.resolve("foreground"), foreground);
  assert.equal(registry.find("foreground"), foreground);
  assert.equal(registry.has("spawn-detached"), true);
});

test("T014 — an id registered twice is refused, and the first one stays", () => {
  const lock = createLockProviderRegistry();
  const first = stubProvider("same-id");
  lock.register(first);
  assert.throws(() => lock.register(stubProvider("same-id")), DuplicateImplementationError);
  // The first is still the one that resolves: a registration never wins by
  // being later, because the behaviour of a launch would then depend on the
  // order its packages loaded.
  assert.equal(lock.resolve("same-id"), first);
  assert.deepEqual([...lock.ids], ["same-id"]);

  const detach = createDetachStrategyRegistry();
  const original = stubStrategy("foreground");
  detach.register(original);
  assert.throws(() => detach.register(stubStrategy("foreground")), DuplicateImplementationError);
  assert.equal(detach.resolve("foreground"), original);
});

test("T014 — an implementation with no id is refused", () => {
  const lock = createLockProviderRegistry();
  assert.throws(() => lock.register(stubProvider("")), /has no id/);
  const detach = createDetachStrategyRegistry();
  assert.throws(() => detach.register(stubStrategy("")), /has no id/);
});

/* ------------------------------------------------------------------ *
 * 3. An unknown id is a configuration error, exit 3 — never a
 *    fallback.
 * ------------------------------------------------------------------ */

test("T014 — an unknown lock provider id is a configuration error with exit 3", () => {
  const registry = createLockProviderRegistry();
  registry.register(stubProvider("specstride.directory-lock"));

  assert.equal(registry.find("acme.lock"), undefined);
  assert.equal(registry.has("acme.lock"), false);

  let thrown: unknown;
  try {
    registry.resolve("acme.lock");
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof UnknownImplementationError, "the refusal is not the typed error");
  const error = thrown as UnknownImplementationError;
  assert.equal(error.isConfigurationError, true);
  assert.equal(error.exitCode, 3);
  assert.equal(error.exitCode, CONFIGURATION_ERROR_EXIT_CODE);
  assert.equal(error.exitCode, UNKNOWN_PROVIDER_EXIT_CODE);
  assert.equal(error.id, "acme.lock");
  assert.equal(error.key, LOCK_PROVIDER_KEY);
  // The message names the configuration key and what IS registered, so the
  // consumer can see their typo.
  assert.match(error.message, /configuration error \(exit 3\)/);
  assert.match(error.message, /runtime\.lock\.provider/);
  assert.match(error.message, /specstride\.directory-lock/);
  assert.deepEqual([...error.registered], ["specstride.directory-lock"]);
});

test("T014 — an unknown id NEVER falls back to a registered implementation", () => {
  // The behaviour worth a test of its own: a registry that quietly fell back
  // would let a consumer believe a provider of theirs was in use.
  const lock = createLockProviderRegistry();
  const shipped = stubProvider("specstride.directory-lock");
  lock.register(shipped);
  assert.throws(() => lock.resolve("acme.lock"), UnknownImplementationError);
  assert.notEqual(lock.find("acme.lock"), shipped);

  const detach = createDetachStrategyRegistry();
  const spawn = stubStrategy("spawn-detached");
  detach.register(spawn);
  // Not even to the DEFAULT strategy the contract names.
  assert.equal(DEFAULT_STRATEGY, "spawn-detached");
  assert.throws(() => detach.resolve("their-strategy"), UnknownStrategyError);
  assert.notEqual(detach.find("their-strategy"), spawn);
});

test("T014 — the refusal of EP-17 uses the message the CONTRACT writes", () => {
  const registry = createDetachStrategyRegistry();
  registry.register(stubStrategy("spawn-detached"));

  let thrown: unknown;
  try {
    registry.resolve("their-strategy");
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof UnknownStrategyError);
  const error = thrown as UnknownStrategyError;
  assert.equal(error.isConfigurationError, true);
  assert.equal(error.exitCode, UNKNOWN_STRATEGY_EXIT_CODE);
  assert.equal(error.exitCode, 3);
  // The wording is the annex's and not this registry's: the contract's own
  // function produced the first part of it.
  assert.ok(
    error.message.startsWith(unknownStrategyMessage("their-strategy")),
    `the message does not begin with the contract's own:\n${error.message}`,
  );
  assert.match(error.message, /annex F, §F\.6/);
  assert.match(error.message, /runtime\.detach\.strategy/);
  assert.match(error.message, /spawn-detached/);
});

test("T014 — an unknown id in an EMPTY registry is still a configuration error", () => {
  assert.throws(
    () => createLockProviderRegistry().resolve("anything"),
    (error: unknown) => {
      assert.ok(error instanceof UnknownImplementationError);
      assert.match((error as Error).message, /\(none\)/);
      return true;
    },
  );
  assert.throws(
    () => createDetachStrategyRegistry().resolve("anything"),
    (error: unknown) => {
      assert.ok(error instanceof UnknownStrategyError);
      assert.match((error as Error).message, /\(none\)/);
      return true;
    },
  );
});

/* ------------------------------------------------------------------ *
 * 4. Read-only after launch.
 * ------------------------------------------------------------------ */

test("T014 — a registry is read-only once the launch has taken from it", () => {
  assert.equal(REGISTRY_IS_READ_ONLY_AFTER_LAUNCH, true);
  const registry = createLockProviderRegistry();
  registry.register(stubProvider("specstride.directory-lock"));
  assert.equal(registry.sealed, false);
  assert.equal(registry.sealedBecause, null);

  registry.seal();
  assert.equal(registry.sealed, true);
  assert.equal(registry.sealedBecause, SEALED_AT_LAUNCH);

  assert.throws(
    () => registry.register(stubProvider("late.lock")),
    ExtensionRegistryClosedError,
    "a provider was registered after the launch had taken its providers",
  );
  // What was already registered still resolves: sealing freezes the set, it
  // does not empty it.
  assert.deepEqual([...registry.ids], ["specstride.directory-lock"]);
  assert.notEqual(registry.resolve("specstride.directory-lock"), undefined);
  // And an unknown id is still the configuration error, not a closed error.
  assert.throws(() => registry.resolve("late.lock"), UnknownImplementationError);
});

test("T014 — the detach registry seals the same way, with the reason given", () => {
  const registry = createDetachStrategyRegistry();
  registry.register(stubStrategy("spawn-detached"));
  registry.seal("the launch record names the strategy in use");
  assert.equal(registry.sealed, true);
  assert.equal(registry.sealedBecause, "the launch record names the strategy in use");

  let thrown: unknown;
  try {
    registry.register(stubStrategy("foreground"));
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ExtensionRegistryClosedError);
  assert.match((thrown as Error).message, /the launch record names the strategy in use/);
  assert.match((thrown as Error).message, /read-only/);
  assert.equal((thrown as ExtensionRegistryClosedError).id, "foreground");
});

test("T014 — sealing twice keeps the FIRST reason", () => {
  const registry = createLockProviderRegistry();
  registry.seal("the first reason");
  registry.seal("a later reason");
  assert.equal(
    registry.sealedBecause,
    "the first reason",
    "a second seal overwrote the reason of the first, which would hide the real one",
  );
  assert.equal(registry.sealed, true);
});

test("T014 — a sealed registry cannot be reopened by any method it exposes", () => {
  const registry = createLockProviderRegistry();
  registry.register(stubProvider("one"));
  registry.seal();
  // The registry object is frozen, so `seal` cannot be replaced with a
  // no-op, and `register` cannot be swapped for one that ignores the seal.
  assert.equal(Object.isFrozen(registry), true);
  assert.throws(() => {
    (registry as unknown as Record<string, unknown>)["register"] = () => undefined;
  });
  assert.throws(() => registry.register(stubProvider("two")), ExtensionRegistryClosedError);
  assert.deepEqual([...registry.ids], ["one"]);
});

test("T014 — `ids` is a copy, so a caller cannot add to the set through it", () => {
  const registry = createLockProviderRegistry();
  registry.register(stubProvider("one"));
  const ids = registry.ids;
  assert.throws(() => (ids as string[]).push("two"));
  assert.deepEqual([...registry.ids], ["one"]);
  assert.equal(registry.has("two"), false);
});
