/**
 * The five services of a loop layer of feature 115 at registration
 * (F115-FR-002; F103-FR-029's rule unchanged): the check runner, the router,
 * the layer's own ledger namespace, the fingerprints and the builder of the
 * fact block are each offered only where an implementation is handed, and a
 * layer that declared one the engine does not offer is refused — nothing
 * silently dropped. The core stays layer-agnostic (F103-FR-028): the probe
 * namespace below stands for whatever namespace a layer declared; the
 * wiring of the real layer is the CLI's test, not this one.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Directive, LoopLayer } from "@specstride/contracts/ep/loop-layer";

import { LoopLayerRegistry, offeredServices } from "../../src/layers/registry.ts";

/** The five services such a layer declares, as the registration reads them. */
const DECLARED = [
  "check-runner",
  "router",
  "ledger-namespace:probe",
  "fingerprints",
  "fact-block-builder",
] as const;

const ALL_IMPLEMENTATIONS = Object.freeze({
  "check-runner": { run: () => undefined },
  router: { route: () => undefined },
  ledgerNamespaces: { probe: { append: () => undefined } },
  fingerprints: { of: () => "" },
  "fact-block-builder": { build: () => [] },
});

const layerOf = (services: readonly string[]): LoopLayer =>
  ({
    registration: {
      id: "probe-layer",
      directives: ["keep", "repair"] as readonly Directive[],
      services,
      ledgerNamespace: "probe",
    },
  }) as unknown as LoopLayer;

test("with every implementation handed, all five services are offered and the layer registers", () => {
  assert.deepEqual(offeredServices(ALL_IMPLEMENTATIONS), [...DECLARED]);
  const registry = new LoopLayerRegistry();
  const outcome = registry.register(layerOf([...DECLARED]), {
    layerClass: "first-party",
    services: ALL_IMPLEMENTATIONS,
  });
  assert.equal(outcome.accepted, true);
  assert.deepEqual(outcome.accepted ? outcome.record.services : [], [...DECLARED]);
});

test("without the implementations, none of the five is offered and the layer is refused", () => {
  assert.deepEqual(offeredServices(), []);
  const outcome = new LoopLayerRegistry().register(layerOf([...DECLARED]), {
    layerClass: "first-party",
  });
  assert.equal(outcome.accepted, false);
  assert.match(
    outcome.accepted ? "" : outcome.message,
    /the engine offers no service `check-runner`/,
  );
});

test("a service whose implementation is missing alone refuses the layer, naming it", () => {
  const withoutTheRunner = Object.fromEntries(
    Object.entries(ALL_IMPLEMENTATIONS).filter(([name]) => name !== "check-runner"),
  );
  assert.ok(!offeredServices(withoutTheRunner).includes("check-runner"));
  const outcome = new LoopLayerRegistry().register(layerOf([...DECLARED]), {
    layerClass: "first-party",
    services: withoutTheRunner,
  });
  assert.equal(outcome.accepted, false);
  assert.match(
    outcome.accepted ? "" : outcome.message,
    /the engine offers no service `check-runner`/,
  );
});

test("a ledger namespace the engine holds no writer for is not offered, and the layer naming it is refused", () => {
  // The namespace list of the engine holds no writer under this name: the
  // prefixed service is not offered, and a layer that declared it is
  // refused naming it — the namespace name is the layer's word, and the
  // refusal repeats it (F103-FR-025, F103-FR-029).
  const withAnotherNamespace = {
    ...ALL_IMPLEMENTATIONS,
    ledgerNamespaces: { other: { append: () => undefined } },
  };
  assert.deepEqual(offeredServices(withAnotherNamespace).includes("ledger-namespace:probe"), false);
  const outcome = new LoopLayerRegistry().register(layerOf([...DECLARED]), {
    layerClass: "first-party",
    services: withAnotherNamespace,
  });
  assert.equal(outcome.accepted, false);
  assert.match(
    outcome.accepted ? "" : outcome.message,
    /the engine offers no service `ledger-namespace:probe`/,
  );
});
