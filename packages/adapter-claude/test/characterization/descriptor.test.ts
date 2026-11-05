// CT-125-2 (T070) — characterization of the descriptor (F125-FR-002): the
// descriptor of `data/descriptor.json` validates against the descriptor
// schema of feature 100 at load (a broken descriptor throws
// `DescriptorRefusedError`, so a load that succeeds IS the validation), and
// every capability names its provenance or is null — no value is guessed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  descriptor,
  concurrentSessionsCapability,
  containmentCeiling,
  type TermsRow,
  termsRows,
} from "../../src/index.ts";

const RAW = JSON.parse(
  readFileSync(new URL("../../data/descriptor.json", import.meta.url), "utf8") as string,
) as Record<string, unknown>;

describe("CT-125-2 — the descriptor validates (F125-FR-002)", () => {
  it("validates against the descriptor schema of feature 100 at load", () => {
    // `descriptor` is produced by harnessDescriptor.readHarnessDescriptor,
    // which refuses anything the schema of `specstride.harness/1:descriptor`
    // does not accept; the import of this module therefore proves the
    // validation ran and passed.
    assert.equal(descriptor.descriptorVersion, 1);
    assert.equal(descriptor.id, "claude");
    assert.equal(descriptor.kind, "cli");
  });

  it("carries the provider and terms reference of Claude, and the auth tiers 1 and 2", () => {
    const provider = RAW.provider as { id: string; termsRef: string };
    assert.equal(provider.id, "anthropic");
    assert.equal(provider.termsRef, "anthropic");
    assert.deepEqual((RAW.auth as { tiers: number[] }).tiers.sort(), [1, 2]);
  });

  it("carries the two roles, with the critic's tool-less mechanism `flag` and `freshSession`", () => {
    const critic = (RAW.roles as Record<string, Record<string, unknown>>)["critic"];
    const toolless = critic["toolless"] as { mechanism: string; freshSession: boolean };
    assert.equal(toolless.mechanism, "flag");
    assert.equal(toolless.freshSession, true);
    assert.ok((RAW.roles as Record<string, unknown>)["proposer"]);
  });

  it("states the cost class per tier and keeps argument lists as lists, never shell text", () => {
    const cost = RAW.cost as { tier1: string; tier2: string };
    assert.equal(cost.tier1, "subscription");
    assert.equal(cost.tier2, "metered");
    // Every entry of the argument table is a list of arguments.
    const table = JSON.parse(
      readFileSync(new URL("../../data/argument-table.json", import.meta.url), "utf8") as string,
    ) as { profiles: Record<string, { entries?: readonly { argv: readonly string[] }[] }> };
    for (const entries of Object.values(table.profiles)) {
      for (const entry of entries.entries ?? []) assert.ok(Array.isArray(entry.argv));
    }
  });

  it("every capability names its provenance or is null", () => {
    // `concurrentSessions` is null with no guess, and the capability record
    // names what would decide it.
    assert.equal(RAW.concurrentSessions, null);
    assert.equal(RAW.spendLimit, null);
    const capability = concurrentSessionsCapability();
    assert.equal(capability.concurrentSessions, null);
    assert.equal(capability.status, "unverified");
    assert.match(capability.decidedBy, /capture-b-concurrent-sessions\.md/);
    // The containment ceiling names its provenance.
    const ceiling = containmentCeiling({ sandboxOfferedByPlatform: false });
    assert.match((RAW.containment as { ceiling: string }).ceiling, /adapter/);
    assert.equal(ceiling.provenance, "adapter");
  });

  it("states null — never a guess — for what the adapter has not established", () => {
    const telemetry = (RAW.telemetry as { off: { switch: string | null } }).off;
    assert.equal(telemetry.switch, null);
  });

  it("carries the version range with its verifiedOn date", () => {
    assert.equal(RAW.versionRange, ">=2.1.259 <=2.1.284");
    assert.equal(RAW.verifiedOn, "2026-09-29");
  });

  it("the terms reference of the descriptor agrees with the terms rows of the adapter", () => {
    for (const row of termsRows.rows as readonly TermsRow[]) {
      assert.equal(row.provider, "anthropic");
      assert.equal(row.verifiedOn, null);
    }
  });
});
