/**
 * T030 (feature 112) — CT-112-117 (F112-FR-017): the checks of the groups
 * `quota` and `budget`.
 *
 * The pause state; the shared auth tier 1 window of a detached run and the
 * host session; the caps in force per role and per run and the billing mode;
 * an API key without a cap (warn); an automatically picked metered critic
 * without a cap (fail); and spend that cannot be measured, said so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quotaStateCheck,
  budgetCapsCheck,
  quotaSharedCheck,
  type QuotaObservation,
  type CapRow,
} from "../src/checks/budget.ts";
import { severityOf, findingOf } from "./helpers.ts";

test("CT-112-117: the quota state per role — info, warn near a threshold or paused, fail on credit", async () => {
  const state = (state: QuotaObservation["state"]): [string, unknown][] => [
    ["quota.states", [{ role: "proposer", state }]],
  ];
  assert.equal(await severityOf(quotaStateCheck("proposer"), []), "ok");
  assert.equal(await severityOf(quotaStateCheck("proposer"), state("ok")), "ok");
  assert.equal(await severityOf(quotaStateCheck("proposer"), state("near-threshold")), "warn");
  assert.equal(await severityOf(quotaStateCheck("proposer"), state("paused")), "warn");
  assert.equal(await severityOf(quotaStateCheck("proposer"), state("blocked-on-credit")), "fail");
  // No probe: the state comes from the records of the run, not from a call.
  const finding = await findingOf(quotaStateCheck("proposer"), [
    ["quota.states", [{ role: "proposer", state: "paused", until: "15:45" }]],
  ]);
  assert.match(finding.message, /proposer paused until 15:45/);
});

test("CT-112-117: a detached run and the host session sharing one window", async () => {
  assert.equal(await severityOf(quotaSharedCheck, [["quota.shared", true]]), "info");
  const shared = await findingOf(quotaSharedCheck, [["quota.shared", true]]);
  assert.match(shared.message, /detached run and this session share the window/);
  // Not shared: the check gives nothing above ok, which is never printed.
  assert.equal(await severityOf(quotaSharedCheck, [["quota.shared", false]]), "ok");
});

test("CT-112-117: the caps in force per role and per run, with the billing mode", async () => {
  const rows: CapRow[] = [
    { role: "proposer", cap: 25, costClass: "metered", spendMeasurable: true },
    { role: "critic", cap: 2, costClass: "subscription", spendMeasurable: true },
  ];
  const finding = await findingOf(budgetCapsCheck, [["budget.caps.roles", rows]]);
  assert.equal(finding.severity, "info");
  assert.match(finding.message, /run cap 25/);
  assert.equal(finding.evidence["apiKeyWithoutCap"], false);
});

test("CT-112-117: an API key without a cap warns; a metered auto-picked critic without a cap fails", async () => {
  assert.equal(
    await severityOf(budgetCapsCheck, [
      [
        "budget.caps.roles",
        [{ role: "proposer", cap: null, costClass: null, spendMeasurable: true }],
      ],
    ]),
    "warn",
  );
  assert.equal(
    await severityOf(budgetCapsCheck, [
      ["budget.caps.autopickCritic", { picked: true, metered: true, cap: null }],
    ]),
    "fail",
  );
  // An automatically picked metered critic WITH a hard cap is not a failure.
  assert.equal(
    await severityOf(budgetCapsCheck, [
      ["budget.caps.autopickCritic", { picked: true, metered: true, cap: 2 }],
    ]),
    "info",
  );
  // An automatically picked critic on a subscription endpoint is not either.
  assert.equal(
    await severityOf(budgetCapsCheck, [
      ["budget.caps.autopickCritic", { picked: true, metered: false, cap: null }],
    ]),
    "info",
  );
});

test("CT-112-117: spend that cannot be measured is said so", async () => {
  const finding = await findingOf(budgetCapsCheck, [
    [
      "budget.caps.roles",
      [{ role: "claude", cap: null, costClass: "subscription", spendMeasurable: false }],
    ],
  ]);
  assert.match(finding.message, /spend of one harness not measurable/);
  // redactEvidence stringifies an array value.
  assert.equal(finding.evidence["unmeasurable"], "[object]");
  assert.equal(finding.evidence["notMeasurable"], true);
});
