// CT for T011 (F125-FR-002, F125-FR-033) — the descriptor and the model data
// of the adapter, validated at load against the descriptor schema of
// feature 100 (`specstride.harness/1:descriptor`).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { harnessDescriptor } from "@specstride/contracts";
import {
  DATA_DIR,
  ModelsDataRefusedError,
  argumentTable,
  descriptor,
  models,
  validateModelsData,
} from "../../src/index.ts";

describe("T011 — descriptor.json validates at load against the schema of feature 100", () => {
  it("the loaded descriptor is the record the schema of feature 100 accepted", () => {
    assert.equal(descriptor.descriptorVersion, 1);
    assert.equal(descriptor.id, "claude");
    assert.equal(descriptor.kind, "cli");
    assert.deepEqual((descriptor.auth as { tiers: readonly number[] }).tiers, [1, 2]);
    assert.equal(harnessDescriptor.SCHEMA_ID, "specstride.harness/1:descriptor");
  });

  it("it validates again, read independently through the schema's own reader", () => {
    const record = harnessDescriptor.readHarnessDescriptor(descriptor);
    const provider = (record.provider ?? {}) as { id: string; termsRef: string };
    assert.equal(provider.id, "anthropic");
    assert.equal(provider.termsRef, "anthropic");
  });

  it("a descriptor that the schema refuses is refused at load", () => {
    assert.throws(
      () => harnessDescriptor.readHarnessDescriptor({ ...descriptor, descriptorVersion: 2 }),
      harnessDescriptor.DescriptorRefusedError,
    );
    assert.throws(
      () => harnessDescriptor.readHarnessDescriptor({ ...descriptor, unknownTopLevel: 1 }),
      harnessDescriptor.DescriptorRefusedError,
    );
  });

  it("the fields F125-FR-002 names are filled, and the unestablished ones are null", () => {
    // the critic's tool-less mechanism `flag` and its `freshSession`
    assert.deepEqual((descriptor.roles as { critic: { toolless: unknown } }).critic.toolless, {
      mechanism: "flag",
      freshSession: true,
    });
    // stream format of Claude's stream, read by the reader of feature 126
    assert.equal((descriptor.stream as { format: string }).format, "claude");
    // cost class subscription at tier 1, metered at tier 2
    assert.equal((descriptor.cost as Record<string, string>).tier1, "subscription");
    assert.equal((descriptor.cost as Record<string, string>).tier2, "metered");
    // containment ceiling with provenance `adapter` (F125-FR-019)
    assert.deepEqual(
      harnessDescriptor.parseCeiling((descriptor.containment as { ceiling: string }).ceiling),
      {
        level: "C1",
        provenance: "adapter",
      },
    );
    // memory switch (F125-FR-018)
    assert.equal(
      (descriptor.memory?.native as Record<string, unknown> | undefined)?.switch,
      "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
    );
    // null, not guessed
    assert.equal(descriptor.concurrentSessions, null);
    assert.equal(descriptor.spendLimit, null);
    assert.equal((descriptor.telemetry?.off as Record<string, unknown> | undefined)?.switch, null);
    // the environment allow-list of F125-FR-020 is on the descriptor
    assert.ok(
      (descriptor.isolation?.envAllow as readonly string[] | undefined)?.includes("TRACEPARENT"),
    );
    // version range with its verified-on date (F125-FR-003)
    assert.equal(descriptor.versionRange, ">=2.1.259 <=2.1.284");
    assert.equal(descriptor.verifiedOn, "2026-09-29");
    // the transports of F125-FR-034
    const transports = (descriptor.transports ?? []) as Array<{ id: string }>;
    assert.deepEqual(
      transports.map((t) => t.id),
      ["subprocess", "direct-call", "sdk-in-process"],
    );
  });

  it("the argument lists of the table are lists, never shell text", () => {
    const sections = [
      argumentTable.profiles.parity.entries,
      argumentTable.profiles.default.proposer.tier1,
      argumentTable.profiles.default.proposer.tier2,
      argumentTable.profiles.default.critic.tier1,
    ];
    for (const section of sections) {
      for (const entry of section) {
        assert.ok(Array.isArray(entry.argv), "an entry's argv is a list");
        assert.ok(
          entry.argv.every((a) => typeof a === "string"),
          "of strings, not shell text",
        );
      }
    }
  });

  it("models.json carries the ladder, the context windows and the default critic model", () => {
    assert.ok(models.ladder.length >= 2);
    const orders = models.ladder.map((r) => r.order);
    assert.deepEqual(
      orders,
      [...orders].sort((a, b) => a - b),
      "lowest first",
    );
    assert.ok(typeof models.contextWindows === "object");
    assert.equal(typeof models.defaultCriticModel, "string");
    // the default critic model sits on a tier different from the lowest rung
    assert.notEqual(models.defaultCriticModel, models.ladder[0].model);
  });

  it("a models file that is not ordered lowest first, or empty, is refused", () => {
    assert.throws(
      () => validateModelsData({ ...models, ladder: [...models.ladder].reverse() }),
      ModelsDataRefusedError,
    );
    assert.throws(() => validateModelsData({ ...models, ladder: [] }), ModelsDataRefusedError);
    assert.throws(
      () => validateModelsData({ ...models, effortLevels: ["fast"] }),
      ModelsDataRefusedError,
    );
  });

  it("the data files live in packages/adapter-claude/data/", () => {
    assert.ok(DATA_DIR.endsWith("data"), DATA_DIR);
    for (const name of ["descriptor.json", "models.json", "argument-table.json"]) {
      const parsed = JSON.parse(
        readFileSync(new URL(`../../data/${name}`, import.meta.url), "utf8"),
      );
      assert.equal(typeof parsed, "object", name);
    }
  });
});
