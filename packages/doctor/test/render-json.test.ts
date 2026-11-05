/**
 * T020 (feature 112) — CT-112-125 (F112-FR-025): the `--json` output.
 *
 * One record of schema `specstride.doctor/1`, a stable order of keys, no
 * escape sequence, never a secret value, an account identifier or a token; the
 * evidence of every finding passes the redactor; and `registry`, `pick` and
 * `sources` are present when the checks that produce them ran. `--json` is
 * opt-in and is not limited by the token budget.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDoctorJson, renderJson, JSON_KEY_ORDER } from "../src/render/json.ts";
import { parseDoctorFlags } from "../src/runner/flags.ts";
import { isDoctorFindings } from "@specstride/contracts/records/doctor-findings";
import type { Finding } from "../src/registry/types.ts";

const CANARY_SECRET = "sk-ant-canary-9f2b7c";
const CANARY_ACCOUNT = "acct_1122334455";

function findingOf(id: string, severity: Finding["severity"]): Finding {
  return {
    id,
    severity,
    lb: false,
    message: `${id}: observed`,
    evidence: Object.freeze({ state: "set", secret: CANARY_SECRET, stdout: CANARY_SECRET }),
    remedy: `fix ${id}`,
  };
}

const INPUT = {
  at: "2026-10-17T10:00:00.000Z",
  host: "cli",
  audience: "personal" as const,
  exit: 0,
  findings: [findingOf("terms.audience", "info"), findingOf("critic.diversity", "warn")],
  // registry, pick and sources are objects of the schema, not arrays.
  registry: { checks: [{ id: "env.node", group: "env" }] },
  pick: { roles: [{ role: "proposer", harness: "claude" }] },
  sources: { logical: ["user:config"] },
};

test("CT-112-125: the record validates against specstride.doctor/1 with a stable key order", () => {
  const record = buildDoctorJson(INPUT);
  assert.equal(record["schema"], "specstride.doctor/1");
  assert.ok(isDoctorFindings(record));
  // The stable order of keys (F112-FR-025).
  assert.deepEqual(
    Object.keys(record).filter((k) => (record as Record<string, unknown>)[k] !== undefined),
    JSON_KEY_ORDER.filter((k) => (record as Record<string, unknown>)[k] !== undefined),
  );
  // Every finding carries the fields in their stable order too.
  const first = (record["findings"] as readonly Record<string, unknown>[])[0];
  assert.deepEqual(Object.keys(first), ["id", "severity", "lb", "message", "fix", "evidence"]);
});

test("CT-112-125: two runs of the same state give byte-identical JSON", () => {
  assert.equal(renderJson(INPUT), renderJson(INPUT));
});

test("CT-112-125: the output holds no escape sequence", () => {
  const out = renderJson(INPUT);
  assert.ok(!out.includes("\\u"), "the JSON holds a unicode escape sequence");
});

test("CT-112-125: the output never holds a secret or an account identifier", () => {
  const out = renderJson(INPUT);
  assert.ok(!out.includes(CANARY_SECRET), "the canary secret leaked into --json");
  assert.ok(!out.includes(CANARY_ACCOUNT), "an account identifier leaked into --json");
  for (const finding of (buildDoctorJson(INPUT) as { findings: readonly { evidence: string }[] })
    .findings) {
    // The evidence passed the redactor: a string, JSON-shaped, no raw output.
    assert.equal(typeof finding.evidence, "string");
    const evidence = JSON.parse(finding.evidence) as Record<string, unknown>;
    assert.ok(!("stdout" in evidence), "raw subprocess output must not survive the redactor");
    assert.ok(!("secret" in evidence), "a secret field must not survive the redactor");
  }
});

test("CT-112-125: registry, pick and sources are present when the checks that produce them ran", () => {
  const record = buildDoctorJson(INPUT);
  assert.ok(record["registry"] !== undefined);
  assert.ok(record["pick"] !== undefined);
  assert.ok(record["sources"] !== undefined);
  // And absent when no check produced them.
  const without = buildDoctorJson({
    ...INPUT,
    registry: undefined,
    pick: undefined,
    sources: undefined,
  });
  assert.equal("registry" in without, false);
  assert.equal("pick" in without, false);
  assert.equal("sources" in without, false);
});

test("CT-112-125: --json is opt-in and not limited by the token budget", () => {
  // The parser: without the flag, json is false.
  assert.equal(parseDoctorFlags(["--json"]).json, true);
  assert.equal(parseDoctorFlags([]).json, false);
  // A large record renders whole: no token budget is applied to --json.
  const many = buildDoctorJson({
    ...INPUT,
    findings: Array.from({ length: 200 }, (_v, i) => findingOf(`check.${String(i)}`, "info")),
  });
  assert.equal((many["findings"] as readonly unknown[]).length, 200);
});
