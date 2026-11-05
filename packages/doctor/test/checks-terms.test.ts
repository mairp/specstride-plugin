/**
 * T028 (feature 112) — CT-112-116 (F112-FR-016; DV-048): the checks of the
 * group `terms`.
 *
 * The gate verdicts: refused (fail), conditional (warn), personal-only in the
 * audience `distributed` (warn), unknown (warn), allowed (info); stale terms
 * data over 30 days (warn); the audience in force shown with where it was set;
 * and a harness with unknown terms that the consumer named warns as well.
 * DV-048: the terms rules are stated once, by their owner, and the doctor
 * renders the verdict — it does not re-derive it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  termsGateCheck,
  termsStaleCheck,
  termsAudienceCheck,
  severityOfTermsRow,
  TERMS_STALE_DAYS,
} from "../src/checks/terms.ts";
import { severityOf, findingOf } from "./helpers.ts";

const DAY = 24 * 60 * 60 * 1000;

test("CT-112-116: the gate verdicts map to fail, warn and info", async () => {
  const row = (result: string, audience: "personal" | "distributed" = "personal") =>
    [["terms.row", { result, audience, tier: "1" }]] as [string, unknown][];
  // refused → fail (launch-blocking)
  assert.equal(await severityOf(termsGateCheck, row("refused")), "fail");
  assert.ok(termsGateCheck.lb, "terms.gate is launch-blocking");
  // conditional → warn
  assert.equal(await severityOf(termsGateCheck, row("conditional")), "warn");
  // personal-only in a distributed audience → warn
  assert.equal(await severityOf(termsGateCheck, row("personal-only", "distributed")), "warn");
  // personal-only in a personal audience is not the warned case
  assert.equal(await severityOf(termsGateCheck, row("personal-only", "personal")), "info");
  // unknown (no row) → warn
  assert.equal(
    await severityOf(termsGateCheck, [["terms.row", { result: "unknown", audience: "personal" }]]),
    "warn",
  );
  assert.equal(await severityOf(termsGateCheck, []), "warn");
  // allowed → info
  assert.equal(await severityOf(termsGateCheck, row("allowed")), "info");
  // The mapping, stated once by its owner (DV-048).
  assert.deepEqual(
    ["refused", "conditional", "personal-only", "unknown", "allowed"].map((r) =>
      severityOfTermsRow({ result: r as never, audience: "distributed" }),
    ),
    ["fail", "warn", "warn", "warn", "info"],
  );
});

test("CT-112-116: the finding names the tier, the audience and the verdict", async () => {
  const refused = await findingOf(termsGateCheck, [
    ["terms.row", { result: "refused", audience: "distributed", tier: "1" }],
  ]);
  assert.match(refused.message, /tier 1 audience=distributed: refused by the terms data/);
  const allowed = await findingOf(termsGateCheck, [
    ["terms.row", { result: "allowed", audience: "personal", tier: "2" }],
  ]);
  assert.match(allowed.message, /tier 2 audience=personal/);
});

test("CT-112-116: a harness with unknown terms that the consumer named warns", async () => {
  const finding = await findingOf(termsGateCheck, [
    ["terms.row", { result: "allowed", audience: "personal", tier: "2" }],
    ["terms.harnessUnknown", ["example-agent"]],
  ]);
  assert.equal(finding.severity, "warn");
  // redactEvidence stringifies an array value.
  assert.equal(finding.evidence["unknownHarnesses"], "[object]");
});

test("CT-112-116: terms data older than 30 days warns", async () => {
  assert.equal(TERMS_STALE_DAYS, 30);
  const now = Date.UTC(2026, 9, 17);
  assert.equal(
    await severityOf(termsStaleCheck, [
      ["terms.checkedAt", now - 45 * DAY],
      ["terms.now", now],
    ]),
    "warn",
  );
  // Exactly 30 days is not over 30 days.
  assert.equal(
    await severityOf(termsStaleCheck, [
      ["terms.checkedAt", now - 30 * DAY],
      ["terms.now", now],
    ]),
    "info",
  );
  // No terms data at all is not stale — it is unknown, never a failure.
  assert.equal(await severityOf(termsStaleCheck, []), "info");
});

test("CT-112-116: the audience in force is shown with where it was set", async () => {
  const audience = await findingOf(termsAudienceCheck, [
    ["terms.audience", "distributed"],
    ["terms.audienceSource", "user configuration"],
  ]);
  assert.equal(audience.severity, "info");
  assert.match(audience.message, /audience distributed \(user configuration\)/);
});
