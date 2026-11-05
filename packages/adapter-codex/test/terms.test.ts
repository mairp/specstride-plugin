/**
 * T018 / CT-131-5 — the terms rows (F131-FR-005).
 *
 * Both audiences; auth tier 3 refused; the default auth tier of the audience
 * `distributed` is 2; the adapter handles no login token.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATH = join(PACKAGE, "data", "terms-rows.json");

type Row = {
  tier: number;
  audience?: string;
  status: string;
  default?: boolean;
  mark?: string;
  conditions?: string[];
};

function load(): {
  provider: string;
  rows: Row[];
  defaultAuthTier: { audience: string; tier: number };
  handlesLoginToken: boolean;
} {
  return JSON.parse(readFileSync(PATH, "utf8"));
}

test("CT-131-5: the rows cover both audiences at auth tiers 1 and 2", () => {
  const terms = load();
  assert.equal(terms.provider, "openai");
  for (const tier of [1, 2]) {
    for (const audience of ["personal", "distributed"]) {
      const row = terms.rows.find((r) => r.tier === tier && r.audience === audience);
      assert.ok(row !== undefined, `tier ${tier}, audience ${audience}`);
    }
  }
});

test("CT-131-5: tier 1 personal is conditional on the recorded conditions", () => {
  const terms = load();
  const row = terms.rows.find((r) => r.tier === 1 && r.audience === "personal");
  assert.equal(row?.status, "conditional");
  assert.deepEqual(row?.conditions, [
    "account holder's own trusted machine",
    "no public or untrusted environment",
    "no public or open-source CI",
    "the login is never copied by the product",
    "a limit signal is treated as a stop",
  ]);
});

test("CT-131-5: tier 1 distributed is personal-only, not a default, and marked", () => {
  const terms = load();
  const row = terms.rows.find((r) => r.tier === 1 && r.audience === "distributed");
  assert.equal(row?.status, "personal-only");
  assert.equal(row?.default, false);
  assert.equal(row?.mark, "personal use only");
});

test("CT-131-5: tier 2 is allowed for both audiences and is the distributed default", () => {
  const terms = load();
  for (const audience of ["personal", "distributed"]) {
    const row = terms.rows.find((r) => r.tier === 2 && r.audience === audience);
    assert.equal(row?.status, "allowed", audience);
  }
  assert.equal(terms.rows.find((r) => r.tier === 2 && r.audience === "distributed")?.default, true);
  assert.deepEqual(terms.defaultAuthTier, { audience: "distributed", tier: 2 });
  assert.ok(!terms.rows.some((r) => r.default === true && r.tier !== 2));
});

test("CT-131-5: auth tier 3 is refused — no `allowed` row exists at tier 3", () => {
  const terms = load();
  const tier3 = terms.rows.filter((r) => r.tier === 3);
  assert.ok(tier3.length > 0);
  for (const row of tier3) assert.equal(row.status, "refused");
  assert.ok(!terms.rows.some((r) => r.tier === 3 && r.status === "allowed"));
});

test("CT-131-5: the adapter handles no login token", () => {
  const terms = load();
  assert.equal(terms.handlesLoginToken, false);
  const text = readFileSync(PATH, "utf8");
  // No row records a handled token, a session token or a credential value.
  assert.ok(!/token.*handled|handled.*token/i.test(text.replace("handlesLoginToken", "")));
});
