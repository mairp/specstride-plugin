// CT-125-5 (T072) — characterization of the terms rows (F125-FR-005,
// F125-FR-037): for each auth tier and audience the status of the row of
// Claude, the source, the access date and the `verifiedOn` date; the
// default of the audience `distributed` is auth tier 2; and the row of the
// SDK transport at auth tier 2 only. The rows are the facts handed to the
// terms gate of feature 147.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DISTRIBUTED_AUDIENCE_DEFAULT_AUTH_TIER,
  termsRows,
  termsRowsForTermsGate,
} from "../../src/index.ts";

const rowFor = (tier: number, audience: string) =>
  termsRows.rows.find(
    (row) =>
      row.authTier === tier &&
      (row.audience === audience ||
        (row.audience === "any" && (audience === "personal" || audience === "distributed"))),
  );

describe("CT-125-5 — the terms rows of Claude (F125-FR-005)", () => {
  it("auth tier 1 is `allowed` for the audience `personal`", () => {
    const row = rowFor(1, "personal");
    assert.ok(row);
    assert.equal(row!.status, "allowed");
    assert.equal(row!.provider, "anthropic");
    assert.match(row!.basis, /subscription/);
  });

  it("auth tier 1 is `personal-only` for the audience `distributed`", () => {
    const row = rowFor(1, "distributed");
    assert.ok(row);
    assert.equal(row!.status, "personal-only");
    assert.match(row!.basis, /personal use only/);
    assert.match(row!.basis, /warning/);
  });

  it("auth tier 2 is `allowed` for both audiences", () => {
    for (const audience of ["personal", "distributed"]) {
      const row = rowFor(2, audience);
      assert.ok(row, audience);
      assert.equal(row!.status, "allowed");
      assert.match(row!.basis, /API key authentication/);
    }
  });

  it("auth tier 3 is `refused`", () => {
    const row = rowFor(3, "personal");
    assert.ok(row);
    assert.equal(row!.status, "refused");
    assert.equal(row!.audience, "any");
    assert.match(row!.basis, /credentials or session tokens/);
  });

  it("every row states its source, its access date and an unverified `verifiedOn`", () => {
    assert.ok(termsRows.rows.length >= 6);
    for (const row of termsRows.rows) {
      assert.match(row.source, /R8v/);
      assert.equal(row.accessDate, "2026-09-29");
      assert.equal(row.verifiedOn, null); // documentation only (ruling 59)
    }
  });

  it("a row names the transport it applies to: subprocess at tiers 1 and 2, the SDK at tier 2 only", () => {
    assert.equal(rowFor(1, "personal")!.transport, "subprocess");
    const t2row = rowFor(2, "personal")!.transport;
    assert.ok(typeof t2row === "string" ? t2row === "subprocess" : t2row.includes("subprocess"));
    // The SDK transport carries a row of its own, refused at auth tier 1.
    const sdkRefused = termsRows.rows.find((row) => row.transport === "sdk-in-process");
    assert.ok(sdkRefused);
    assert.equal(sdkRefused!.authTier, 1);
    assert.equal(sdkRefused!.status, "refused");
    assert.match(sdkRefused!.basis, /ruling 70/);
    // And it appears in the tier-2 allowed rows.
    const t2 = rowFor(2, "personal")!.transport;
    assert.ok((t2 as readonly string[]).includes("sdk-in-process"));
  });

  it("the default of the audience `distributed` is auth tier 2", () => {
    assert.equal(DISTRIBUTED_AUDIENCE_DEFAULT_AUTH_TIER, 2);
    assert.equal(termsRows.sdkTransport["authTier"], 2);
  });

  it("the rows are handed to the terms file of feature 147 in the row shape the gate reads", () => {
    const handed = termsRowsForTermsGate();
    // `any` is expanded to one row per audience the gate reads.
    assert.ok(handed.length > termsRows.rows.length);
    for (const row of handed) {
      assert.ok(["personal", "distributed"].includes(row.audience));
      assert.ok(["allowed", "conditional", "personal-only", "refused"].includes(row.status));
      assert.ok([1, 2, 3].includes(row.authTier));
      assert.equal(row.verifiedOn, null);
      assert.notEqual(row.quotedSentence, "");
      assert.notEqual(row.source, "");
      assert.equal(row.accessDate, "2026-09-29");
    }
    // The tier/tier/audience matrix of the contract is covered.
    assert.ok(
      handed.some((r) => r.authTier === 1 && r.audience === "personal" && r.status === "allowed"),
    );
    assert.ok(
      handed.some(
        (r) => r.authTier === 1 && r.audience === "distributed" && r.status === "personal-only",
      ),
    );
    assert.ok(
      handed.some((r) => r.authTier === 2 && r.audience === "personal" && r.status === "allowed"),
    );
    assert.ok(
      handed.some(
        (r) => r.authTier === 2 && r.audience === "distributed" && r.status === "allowed",
      ),
    );
    assert.ok(handed.some((r) => r.authTier === 3 && r.status === "refused"));
    // The hand-over record names the owner of the terms file.
    const handover = (
      JSON.parse(
        readFileSync(new URL("../../data/terms-rows.json", import.meta.url), "utf8") as string,
      ) as Record<string, unknown>
    )["termsFileHandover"] as Record<string, unknown>;
    assert.match(String(handover["handedTo"]), /147/);
    assert.match(String(handover["handedTo"]), /terms-rows\.tsv/);
    assert.equal(handover["distributedAudienceDefaultAuthTier"], 2);
  });
});
