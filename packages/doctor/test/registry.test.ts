/**
 * T006 (feature 112) — CT-112-102 and CT-112-103 (F112-FR-002): the order of
 * running and of output (severity, then id; identical text on identical
 * state), and the registration rules: 19 groups, refusal of a foreign group
 * and of a duplicate id, read-only after launch, and registering a check
 * changes no core file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDoctorRegistry, RegistrationRefusedError } from "../src/registry/registry.ts";
import { GROUPS, type Check, type Severity } from "../src/registry/types.ts";
import { runDoctorChecks, makeProbeBag, orderFindings } from "../src/runner/run.ts";

/** A check of the given group and order that observes nothing. */
function checkOf(id: string, group: string, order: number, severity = "ok"): Check {
  return {
    id,
    group: group as Check["group"],
    lb: false,
    order,
    messageTemplate: `${id}: {state}`,
    fixHint: `fix ${id}`,
    severityRule: () => severity as Severity,
    probe: async () => ({ state: "unchanged" }),
  };
}

test("CT-112-102: checks run in registration order and findings render by severity, then id", async () => {
  const registry = createDoctorRegistry();
  // Registered out of order on purpose.
  registry.register(checkOf("gamma.one", "env", 30));
  registry.register(checkOf("alpha.one", "cli", 10));
  registry.register(checkOf("beta.one", "host", 20));
  assert.deepEqual(
    registry.registered().map((c) => c.id),
    ["alpha.one", "beta.one", "gamma.one"],
  );

  // The same state, three severities: the output is severity first, then id.
  const checks = [
    checkOf("b.warn", "env", 1, "warn"),
    checkOf("a.fail", "cli", 2, "fail"),
    checkOf("c.warn", "host", 3, "warn"),
    checkOf("d.ok", "bin", 4, "ok"),
  ];
  const result = await runDoctorChecks({ checks, bag: makeProbeBag() });
  assert.deepEqual(
    result.findings.map((f) => `${f.severity}:${f.id}`),
    ["fail:a.fail", "warn:b.warn", "warn:c.warn", "ok:d.ok"],
  );
  assert.deepEqual(orderFindings(result.findings), result.findings);
});

test("CT-112-103: identical state gives identical text", async () => {
  const checks = [checkOf("same.two", "env", 2), checkOf("same.one", "cli", 1)];
  const runOnce = () => runDoctorChecks({ checks, bag: makeProbeBag() });
  const first = await runOnce();
  const second = await runOnce();
  assert.equal(JSON.stringify(first.findings), JSON.stringify(second.findings));
});

test("registration: the 19 groups are all accepted, a foreign group is refused", () => {
  assert.equal(GROUPS.length, 19);
  const registry = createDoctorRegistry();
  for (const group of GROUPS) {
    registry.register(checkOf(`grp.${group}`, group, 1));
  }
  assert.equal(registry.registered().length, 19);
  assert.throws(
    () => registry.register(checkOf("rogue.one", "no-such-group" as Check["group"], 1)),
    (error: unknown) =>
      error instanceof RegistrationRefusedError && error.why.includes("not one of the 19 groups"),
  );
});

test("registration: a duplicate id is refused", () => {
  const registry = createDoctorRegistry();
  registry.register(checkOf("dup.one", "env", 1));
  assert.throws(
    () => registry.register(checkOf("dup.one", "cli", 2)),
    (error: unknown) => error instanceof RegistrationRefusedError && error.why.includes("once"),
  );
});

test("registration: the registry is read-only after launch", () => {
  const registry = createDoctorRegistry();
  registry.register(checkOf("launch.one", "env", 1));
  registry.seal();
  assert.equal(registry.sealed, true);
  assert.throws(
    () => registry.register(checkOf("launch.two", "env", 2)),
    (error: unknown) =>
      error instanceof RegistrationRefusedError && error.why.includes("read-only"),
  );
});

test("registration: registering a check changes no core file", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const coreFiles = [
    join(here, "../src/registry/registry.ts"),
    join(here, "../src/registry/types.ts"),
    join(here, "../data/check-catalogue.tsv"),
  ];
  const digestOf = (): string => {
    const hash = createHash("sha256");
    for (const path of coreFiles) hash.update(readFileSync(path));
    return hash.digest("hex");
  };
  const before = digestOf();
  const registry = createDoctorRegistry();
  registry.register(checkOf("fs.one", "env", 1));
  registry.register(checkOf("fs.two", "cli", 2));
  assert.equal(digestOf(), before);
});
