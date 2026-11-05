/**
 * T040 — CT-109-11: transports (F109-FR-011).
 *
 * The closed set; a missing optional dependency makes one transport
 * unavailable with a doctor line and leaves the others as they are; the
 * choice comes from the consumer only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TRANSPORT,
  TRANSPORTS,
  availableTransports,
  chooseTransport,
  defaultTransportBinding,
  doctorLineFor,
  transportAvailable,
  type TransportBinding,
} from "../../src/transports/transports.ts";

function binding(transport: string, optionalDependency: string | null = null): TransportBinding {
  return {
    ...defaultTransportBinding(),
    transport: transport as TransportBinding["transport"],
    optionalDependency,
  };
}

test("CT-109-11: the set of transports is closed", () => {
  assert.deepEqual([...TRANSPORTS], ["subprocess", "sdk-in-process", "direct-call"]);
  assert.equal(DEFAULT_TRANSPORT, "subprocess");
});

test("CT-109-11: a transport is a property of an entry, with its own auth tier and terms row", () => {
  const b = defaultTransportBinding();
  assert.equal(b.transport, "subprocess");
  assert.equal(typeof b.authTier, "number");
  assert.ok("termsRow" in b);
});

test("CT-109-11: a missing optional dependency makes one transport unavailable, with a doctor line", () => {
  const sdk = { ...binding("sdk-in-process"), authTier: 2 as const, termsRow: "sdk" };
  sdk.optionalDependency = "@lisa/sdk";
  const bindings = [binding("subprocess"), sdk];
  const installed = (dependency: string) => dependency !== "@lisa/sdk";
  assert.equal(transportAvailable(sdk, installed), false);
  const got = availableTransports("lisa", bindings, installed);
  assert.deepEqual(
    got.available.map((b) => b.transport),
    ["subprocess"],
  );
  assert.deepEqual(got.doctorLines, [
    "lisa: transport sdk-in-process unavailable: the optional dependency @lisa/sdk is not installed",
  ]);
  // The other transport of the adapter is unchanged.
  assert.equal(transportAvailable(bindings[0], installed), true);
});

test("CT-109-11: the doctor line names the harness, the transport and the dependency", () => {
  const line = doctorLineFor("harness-x", { ...binding("direct-call", "@harness/client") });
  assert.match(line, /^harness-x: transport direct-call unavailable/);
  assert.match(line, /@harness\/client/);
});

test("CT-109-11: the choice comes from the consumer only — and there is no fallback", () => {
  const bindings = [binding("subprocess"), binding("direct-call")];
  // No choice: the default stands.
  assert.equal(chooseTransport("h", bindings, null).ok, true);
  // A consumer choice that the entry offers is honoured.
  assert.equal(chooseTransport("h", bindings, "direct-call").ok, true);
  // A choice outside the closed set is refused — not mapped to a default.
  const unknown = chooseTransport("h", bindings, "ssh");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.ok ? "" : unknown.reason, "unknown-transport");
  // A choice the entry does not offer is refused — never a fallback.
  const notOffered = chooseTransport("h", [binding("subprocess")], "direct-call");
  assert.equal(notOffered.ok, false);
  assert.equal(notOffered.ok ? "" : notOffered.reason, "not-offered");
});

test("CT-109-11: an unavailable choice is refused, never replaced by another transport", () => {
  const bindings = [binding("subprocess"), binding("sdk-in-process", "@lisa/sdk")];
  const installed = (dependency: string) => dependency !== "@lisa/sdk";
  const got = chooseTransport("lisa", bindings, "sdk-in-process", installed);
  assert.equal(got.ok, false);
  assert.equal(got.ok ? "" : got.reason, "unavailable");
  assert.match(got.ok ? "" : got.message, /unavailable/);
});
