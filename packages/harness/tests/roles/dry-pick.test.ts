/**
 * T028 — CT-124-49 (F124-FR-049): the reading for the doctor.
 *
 * The reading gives the pick and the reason per losing candidate, and it
 * writes nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dryPick } from "../../src/roles/dry-pick.ts";
import { candidate, orderInput } from "./critic-fixtures.ts";

const input = () =>
  orderInput({
    discovered: [
      candidate({ id: "disc-a" }),
      candidate({
        id: "disc-b",
        modelId: "model-b",
        contextWindow: { tokens: 64000, source: "declared" },
      }),
      // Does not qualify: an unverified cli.
      candidate({ id: "disc-c", state: "declared", kind: "cli" }),
    ],
  });

test("CT-124-49 the reading gives the pick and the reason per losing candidate", () => {
  const reading = dryPick(input());
  assert.equal(reading.outcome, "picked");
  assert.equal(reading.wroteNothing, true);
  assert.equal(reading.pick?.harness, "disc-a");
  assert.equal(reading.pick?.step, "discovered");
  const reasons = new Map(reading.lost.map(({ harness, reason }) => [harness, reason]));
  assert.equal(reasons.size, reading.lost.length);
  assert.match(
    reasons.get("disc-b") ?? "",
    /^outranked:/,
    "a runner-up lost on a key of the ranking",
  );
  assert.equal(
    reasons.get("disc-c"),
    "unverified-cli",
    "a candidate that did not qualify carries its reason",
  );
});

test("CT-124-49 the same input gives the same reading, and the refusal names every reason", () => {
  assert.deepEqual(dryPick(input()), dryPick(input()));
  const refused = dryPick(
    orderInput({ defaultHarness: { ...orderInput().defaultHarness, supportsCritic: false } }),
  );
  assert.equal(refused.outcome, "refused");
  assert.equal(refused.pick, null);
  assert.equal(refused.wroteNothing, true);
  assert.match(refused.rendered, /SPECSTRIDE-ROLES/);
});

test("CT-124-49 the reading writes nothing: the module imports nothing that writes", () => {
  const text = readFileSync(new URL("../../src/roles/dry-pick.ts", import.meta.url), "utf8");
  assert.equal(/from\s+"node:fs"/.test(text), false, "no fs import");
  assert.equal(/atomicWrite|writeFile|appendFile|mkdir/.test(text), false, "no write");
});
