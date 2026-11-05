/**
 * T040 (feature 112) — CT-112-131 and CT-112-115, the checks of the group
 * `critic` (F112-FR-031, F112-FR-015): the critic-diversity warning for the
 * results `same-model` and `unverified`, exit 0, launch not blocked; `info`
 * for `same-provider`; `ok` for `diverse`; two models of one model tier give
 * no finding of their own; an unknown result reads as `unverified`;
 * independence fails on an allow-all flag; autopick shows why each candidate
 * lost.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  criticDiversityCheck,
  criticIndependenceCheck,
  criticAutopickCheck,
  normalizeDiversityResult,
  severityOfDiversity,
} from "../src/checks/critic.ts";
import { findingOf, severityOf, bagWith } from "./helpers.ts";
import { exitCodeFor } from "../src/runner/exit.ts";
import { launchRefusal, launchSubset } from "../src/registry/launch-subset.ts";
import { runDoctorChecks } from "../src/runner/run.ts";
import type { Finding } from "../src/registry/types.ts";

const DIVERSITY: readonly string[] = [
  "diverse",
  "same-provider",
  "same-model",
  "unverified",
  "tier-shared",
];

test("CT-112-131: the critic-diversity warning fires for same-model and unverified, exits 0, blocks no launch", async () => {
  for (const result of ["same-model", "unverified"] as const) {
    const finding = await findingOf(criticDiversityCheck, [["critic.diversity.result", result]]);
    assert.equal(finding.severity, "warn", `${result} gives the warning`);
    assert.equal(finding.lb, false, "the warning is never launch-blocking");
    assert.match(finding.message, /critic-diversity warning/);
    // Exit 0: a warning is not a fail, and --strict is off.
    assert.equal(exitCodeFor([finding]), 0, `${result}: exit 0`);
    // The launch is not blocked: no lb fail, so no refusal.
    assert.equal(launchRefusal([finding]).refused, false, `${result}: the launch is not blocked`);
  }
});

test("CT-112-131: with --strict the warning exits 2 and still blocks no launch", async () => {
  const finding = await findingOf(criticDiversityCheck, [
    ["critic.diversity.result", "same-model"],
  ]);
  assert.equal(exitCodeFor([finding], { strict: true }), 2);
  assert.equal(
    launchRefusal([finding]).refused,
    false,
    "--strict never makes the warning blocking",
  );
});

test("CT-112-131: the check is never fail and never lb, whatever the result", async () => {
  assert.equal(criticDiversityCheck.lb, false, "F112-FR-031: no flag lb");
  for (const result of DIVERSITY) {
    const severity = await severityOf(criticDiversityCheck, [["critic.diversity.result", result]]);
    assert.notEqual(severity, "fail", `${result}: never fail`);
    assert.ok(["ok", "info", "warn"].includes(severity), `${result}: ${String(severity)}`);
  }
});

test("CT-112-115: same-provider informs; diverse is ok", async () => {
  assert.equal(
    await severityOf(criticDiversityCheck, [["critic.diversity.result", "same-provider"]]),
    "info",
  );
  assert.equal(
    await severityOf(criticDiversityCheck, [["critic.diversity.result", "diverse"]]),
    "ok",
  );
  const diverse = await findingOf(criticDiversityCheck, [["critic.diversity.result", "diverse"]]);
  assert.equal(diverse.severity, "ok");
  assert.equal(exitCodeFor([diverse]), 0);
});

test("CT-112-115: two models of one model tier give no finding of their own", async () => {
  // The diversity test read no result; the registry holds a shared model tier.
  // That is `diverse`, not a finding about the tier.
  const finding = await findingOf(criticDiversityCheck, [["critic.diversity.sharedTier", true]]);
  assert.equal(finding.severity, "ok", "a shared model tier alone is no warning");
  assert.equal(finding.evidence["result"], "diverse");
  assert.equal(finding.evidence["why"] as string, "none");
  // Where the diversity test did read a result, that result stands even on a
  // shared tier — two different models of one tier are `diverse`, or
  // `same-provider` where the provider is shared.
  assert.equal(
    await severityOf(criticDiversityCheck, [
      ["critic.diversity.sharedTier", true],
      ["critic.diversity.result", "same-provider"],
    ]),
    "info",
  );
});

test("CT-112-115: a result the doctor does not know reads as unverified, with the warning", async () => {
  assert.equal(normalizeDiversityResult("tier-shared"), "unverified");
  assert.equal(normalizeDiversityResult(undefined), "unverified");
  assert.equal(severityOfDiversity("unverified"), "warn");
  const finding = await findingOf(criticDiversityCheck, [
    ["critic.diversity.result", "tier-shared"],
  ]);
  assert.equal(finding.severity, "warn");
  assert.equal(finding.evidence["result"], "unverified");
  assert.match(finding.message, /unverified/);
});

test("CT-112-115: independence warns when the critic can call tools and fails on an allow-all flag", async () => {
  const allowAll = await findingOf(criticIndependenceCheck, [
    ["critic.independence", { canCallTools: true, allowsAllTools: true }],
  ]);
  assert.equal(allowAll.severity, "fail");
  assert.equal(allowAll.lb, true, "critic.independence is launch-blocking");
  assert.match(allowAll.message, /allows all tools/);
  // The allow-all flag alone, without the plain can-call form, still fails.
  assert.equal(
    await severityOf(criticIndependenceCheck, [["critic.independence", { allowsAllTools: true }]]),
    "fail",
  );
  const callable = await findingOf(criticIndependenceCheck, [
    ["critic.independence", { canCallTools: true }],
  ]);
  assert.equal(callable.severity, "warn");
  assert.match(callable.message, /critic can call tools/);
  assert.equal(launchRefusal([callable]).refused, false, "a warning refuses no launch");
  assert.equal(await severityOf(criticIndependenceCheck, [["critic.independence", {}]]), "ok");
});

test("CT-112-115: autopick shows the pick that would be made and why each candidate lost", async () => {
  const finding = await findingOf(criticAutopickCheck, [
    [
      "critic.autopick",
      {
        pick: "example/model",
        candidates: [
          { id: "harness-b", why: "context window unknown" },
          { id: "harness-c", why: "not declared for the critic role" },
        ],
      },
    ],
  ]);
  assert.equal(finding.severity, "info", "critic.autopick informs");
  assert.equal(finding.lb, false);
  assert.match(finding.message, /would pick: example\/model/);
  assert.match(finding.message, /harness-b \(context window unknown\)/);
  assert.match(finding.message, /harness-c \(not declared for the critic role\)/);
  // Without a plan, it still informs and names no candidate.
  const none = await findingOf(criticAutopickCheck, [["critic.autopick", {}]]);
  assert.equal(none.severity, "info");
  assert.match(none.message, /would pick: none/);
});

test("CT-112-131: the diversity warning is out of the launch subset and out of its findings", async () => {
  const checks = [criticDiversityCheck, criticIndependenceCheck, criticAutopickCheck];
  const subset = launchSubset(checks);
  assert.deepEqual(
    subset.map((c) => c.id),
    ["critic.independence"],
    "only the launch-blocking critic check is in the subset",
  );
  const run = await runDoctorChecks({
    checks,
    bag: bagWith([["critic.diversity.result", "same-model"]]),
  });
  const diversity: Finding | undefined = run.findings.find((f) => f.id === "critic.diversity");
  assert.equal(diversity?.severity, "warn");
  assert.equal(run.exit, 0, "a run whose only finding is the diversity warning exits 0");
  assert.equal(launchRefusal(run.findings).refused, false);
});
