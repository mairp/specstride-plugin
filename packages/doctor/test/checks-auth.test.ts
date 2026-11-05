/**
 * T049 (feature 112) — CT-112-114 (F112-FR-014): the checks of the groups
 * `auth` and `model`.
 *
 * The credential of a role in use: present, missing, `unprobed`; the auth
 * tier and the billing mode in effect; the loud warning when an API key is in
 * effect; the reach of the configured model against the model list; the
 * context window; and the rule that no account identifier is ever printed.
 * No secret is read and no paid call is made: the status command and the
 * model list arrive through the injected probe bag.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authCheckFor,
  authTierCheckFor,
  modelReachCheckFor,
  modelWindowCheckFor,
} from "../src/checks/auth.ts";
import { findingOf, severityOf } from "./helpers.ts";
import type { ProbeBag } from "../src/registry/types.ts";

test("CT-112-114: auth.<id>.<role> reports present, missing and unprobed", async () => {
  const check = authCheckFor("harness-one", "proposer");
  assert.equal(check.lb, true, "auth.<id>.<role> is launch-blocking (row 17)");
  assert.equal(check.id, "auth.harness-one.proposer");
  // present at auth tier 1, via the status command of the harness
  assert.equal(
    await severityOf(
      check,
      [["auth.harness-one.proposer", { tier: 1, statusCommand: ["harness-one", "status"] }]],
      {
        subprocess: {
          run: () =>
            Promise.resolve({
              code: 0,
              signal: null,
              stdout: "logged in\n",
              stderr: "",
              timedOut: false,
              truncated: false,
            }),
        },
      } as Partial<ProbeBag>,
    ),
    "ok",
  );
  // missing: the status command says not logged in
  assert.equal(
    await severityOf(
      check,
      [["auth.harness-one.proposer", { tier: 1, statusCommand: ["harness-one", "status"] }]],
      {
        subprocess: {
          run: () =>
            Promise.resolve({
              code: 1,
              signal: null,
              stdout: "",
              stderr: "not logged in",
              timedOut: false,
              truncated: false,
            }),
        },
      } as Partial<ProbeBag>,
    ),
    "fail",
  );
  // a role in use with no credential fails
  assert.equal(
    await severityOf(check, [["auth.harness-one.proposer", { tier: 1, state: "missing" }]]),
    "fail",
  );
  // unprobed: no way exists (auth tier 2 without a query)
  assert.equal(
    await severityOf(check, [["auth.harness-one.proposer", { tier: 2, state: "unprobed" }]]),
    "info",
  );
  const unprobed = await findingOf(check, [
    ["auth.harness-one.proposer", { tier: 2, state: "unprobed" }],
  ]);
  assert.match(unprobed.message, /harness-one: proposer unprobed/);
  // auth tier 2: the presence of the secret reference is the probe.
  assert.equal(
    await severityOf(check, [["auth.harness-one.proposer", { tier: 2, state: "present" }]]),
    "ok",
  );
});

test("CT-112-114: auth.tier.<role> shows the tier and the billing mode, and warns loudly for an API key", async () => {
  const check = authTierCheckFor("proposer");
  // subscription: info
  assert.equal(
    await severityOf(check, [["auth.tier.proposer", { tier: 1, billingMode: "subscription" }]]),
    "info",
  );
  // API key in effect: warn, and loud — the message names it
  const keyFinding = await findingOf(check, [
    ["auth.tier.proposer", { tier: 2, billingMode: "api-key", apiKey: true, capUsd: 25 }],
  ]);
  assert.equal(keyFinding.severity, "warn");
  assert.match(keyFinding.message, /proposer: tier 2 api-key, cap \$25, API key in effect/);
  // The subscription finding shows the tier and the mode without the key text.
  const sub = await findingOf(check, [
    ["auth.tier.proposer", { tier: 1, billingMode: "subscription" }],
  ]);
  assert.match(sub.message, /proposer: tier 1 subscription/);
  assert.ok(!sub.message.includes("API key"));
});

test("CT-112-114: model.reach.<role> fails when the configured model is not served", async () => {
  const check = modelReachCheckFor("proposer");
  assert.equal(check.lb, true, "model.reach.<role> is launch-blocking (row 19)");
  // served through the free model list of the harness (GET through the bag)
  assert.equal(
    await severityOf(
      check,
      [
        [
          "model.reach.proposer",
          { model: "model-a", modelListUrl: "https://example.invalid/models" },
        ],
      ],
      {
        network: { get: () => Promise.resolve({ status: 200, body: "model-a\nmodel-b\n" }) },
      } as Partial<ProbeBag>,
    ),
    "ok",
  );
  // not served: fail
  assert.equal(
    await severityOf(
      check,
      [
        [
          "model.reach.proposer",
          { model: "model-z", modelListUrl: "https://example.invalid/models" },
        ],
      ],
      {
        network: { get: () => Promise.resolve({ status: 200, body: "model-a\nmodel-b\n" }) },
      } as Partial<ProbeBag>,
    ),
    "fail",
  );
  const notServed = await findingOf(
    check,
    [
      [
        "model.reach.proposer",
        { model: "model-z", modelListUrl: "https://example.invalid/models" },
      ],
    ],
    {
      network: { get: () => Promise.resolve({ status: 200, body: "model-a\n" }) },
    } as Partial<ProbeBag>,
  );
  assert.match(notServed.message, /model-z not in the model list/);
  // unprobed when no model list exists
  assert.equal(await severityOf(check, [["model.reach.proposer", { model: "model-a" }]]), "info");
});

test("CT-112-114: model.reach.<role> is skipped by --quick and --offline", async () => {
  const { runDoctorChecks, makeProbeBag } = await import("../src/runner/run.ts");
  const check = modelReachCheckFor("proposer");
  const entries = [["model.reach.proposer", { model: "model-a", served: false }]] as [
    string,
    unknown,
  ][];
  const config = { values: new Map(entries) };
  // --quick: the probe does not run, so no finding at all.
  const quick = await runDoctorChecks({
    checks: [check],
    bag: makeProbeBag({ quick: true, config }),
  });
  assert.deepEqual(
    quick.findings.filter((f) => f.id === check.id),
    [],
  );
  // --offline: likewise no finding.
  const offline = await runDoctorChecks({
    checks: [check],
    bag: makeProbeBag({
      config: { values: new Map([...entries, ["doctor.online", false]] as [string, unknown][]) },
    }),
  });
  assert.deepEqual(
    offline.findings.filter((f) => f.id === check.id),
    [],
  );
  // Without either, the same state is reported (fail).
  const online = await runDoctorChecks({ checks: [check], bag: makeProbeBag({ config }) });
  assert.equal(online.findings.find((f) => f.id === check.id)?.severity, "fail");
});

test("CT-112-114: model.window.<role> warns when the window is unknown for a critic candidate", async () => {
  const check = modelWindowCheckFor("critic");
  assert.equal(
    await severityOf(check, [["model.window.critic", { window: 200000, criticCandidate: true }]]),
    "ok",
  );
  assert.equal(
    await severityOf(check, [["model.window.critic", { criticCandidate: true }]]),
    "warn",
  );
  const finding = await findingOf(check, [["model.window.critic", { criticCandidate: true }]]);
  assert.match(finding.message, /window unknown: harness cannot be auto-picked as critic/);
  // Not a critic candidate and no window: no finding of its own.
  const { runDoctorChecks, makeProbeBag } = await import("../src/runner/run.ts");
  const none = await runDoctorChecks({
    checks: [modelWindowCheckFor("proposer")],
    bag: makeProbeBag(),
  });
  assert.deepEqual(
    none.findings.filter((f) => f.id === "model.window.proposer"),
    [],
  );
});

test("CT-112-114: no account identifier is ever printed", async () => {
  const finding = await findingOf(authTierCheckFor("proposer"), [
    [
      "auth.tier.proposer",
      { tier: 2, billingMode: "api-key", apiKey: true, accountId: "acct_9Z8Y7X6W" },
    ],
  ]);
  const whole = JSON.stringify(finding);
  assert.ok(!whole.includes("acct_9Z8Y7X6W"), "the account identifier never reaches the finding");
  assert.ok(!("accountId" in finding.evidence), "no accountId field in the evidence");
  assert.ok(!finding.message.includes("acct_"), "no account identifier in the message");
});
