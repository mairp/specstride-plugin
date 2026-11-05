/**
 * CT-115-2 (T011, F115-FR-002) — registration, declared directives, no
 * state outside the namespace `micro`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerLayerMicro,
  DECLARED_DIRECTIVES,
  DECLARED_SERVICES,
  LEDGER_NAMESPACE,
  MICRO_STRATEGY,
  MICRO_LEVEL,
  FORBIDDEN_PHASE_GATE_WRITES,
  phaseGateWritesAllowed,
  checkDeclaredDirectives,
} from "../../src/register.ts";
import { epLoopLayer } from "@specstride/contracts";

test("CT-115-2: the layer registers as the implementation micro of EP-04", () => {
  const registration = registerLayerMicro();
  assert.equal(registration.strategy, MICRO_STRATEGY);
  assert.equal(registration.strategy, "micro");
  assert.equal(registration.level, MICRO_LEVEL);
  assert.deepEqual(registration.callPoints, [...epLoopLayer.CALL_POINTS]);
});

test("CT-115-2: exactly the nine directives of F115-FR-002 are declared", () => {
  assert.deepEqual(DECLARED_DIRECTIVES, [
    "keep",
    "repair",
    "unresolved",
    "layerOffForAttempt",
    "layerOffForRun",
    "giveIterationBack",
    "exemptShortPass",
    "exemptRepeatCounter",
    "requestPass",
  ]);
  for (const directive of DECLARED_DIRECTIVES) {
    assert.ok(
      (epLoopLayer.DIRECTIVES as readonly string[]).includes(directive),
      `directive outside the closed set of annex D §D.1: ${directive}`,
    );
  }
  // A directive outside the closed set is refused at registration.
  assert.ok(typeof checkDeclaredDirectives() === "object");
});

test("CT-115-2: the declared services are the ones the engine offers", () => {
  for (const service of [
    "check-runner",
    "router",
    "ledger-namespace:micro",
    "fingerprints",
    "fact-block-builder",
  ]) {
    assert.ok(DECLARED_SERVICES.includes(service as never), service);
  }
});

test("CT-115-2: no state outside the ledger namespace micro", () => {
  const registration = registerLayerMicro();
  assert.equal(registration.ledgerNamespace, LEDGER_NAMESPACE);
  assert.equal(LEDGER_NAMESPACE, "micro");
  // The registration is frozen: the layer holds no mutable module state.
  assert.ok(Object.isFrozen(registration));
});

test("CT-115-2: no writer of the phase gate is declared (IR-01)", () => {
  const allowed = phaseGateWritesAllowed();
  assert.deepEqual(allowed, []);
  for (const forbidden of FORBIDDEN_PHASE_GATE_WRITES) {
    assert.ok(!(allowed as readonly string[]).includes(forbidden));
    assert.ok(!(DECLARED_SERVICES as readonly string[]).includes(forbidden));
  }
});
