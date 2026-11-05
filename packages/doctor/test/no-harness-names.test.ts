/**
 * T048 (feature 112) — CT-112-109 (F112-FR-009): no check enumerates
 * harnesses by name.
 *
 * The source of every check holds no harness name: the file is read here as
 * data and scanned. Every per-harness check id (`bin.<id>`, `harness.state.<id>`,
 * `harness.version.<id>`, `harness.caps.<id>`, `auth.<id>.<role>`) exists only
 * after it was produced from an entry of the resolved registry the probe bag
 * carries — including a discovered harness that no requirement names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { HarnessEntry } from "../src/registry/types.ts";
import { harnessChecksOf } from "../src/checks/harness.ts";
import { authCheckFor, modelReachCheckFor } from "../src/checks/auth.ts";
import { runDoctorChecks, makeProbeBag } from "../src/runner/run.ts";

/** The check sources of the doctor — the only places a check can live. */
const CHECK_SOURCES = [
  "../src/checks/harness.ts",
  "../src/checks/auth.ts",
  "../src/checks/env.ts",
  "../src/checks/config.ts",
  "../src/checks/terms.ts",
  "../src/checks/budget.ts",
  "../src/checks/run.ts",
  "../src/checks/misc.ts",
  "../src/checks/critic.ts",
];

/** Harness names that exist in the ecosystem; none may appear in a check. */
const HARNESS_NAMES = ["codex", "claude", "dsh", "gemini", "cursor", "example-agent"];

test("CT-112-109: no check source names a harness", async () => {
  for (const relative of CHECK_SOURCES) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const source = await readFile(path, "utf8");
    for (const name of HARNESS_NAMES) {
      assert.ok(
        !source.toLowerCase().includes(name),
        `${relative} must not name the harness \`${name}\` (F112-FR-009)`,
      );
    }
  }
});

test("CT-112-109: per-harness check ids exist only after a registry entry produced them", () => {
  const empty = harnessChecksOf([]);
  // With an empty resolved registry there is no per-harness entry at all.
  assert.deepEqual(
    empty.filter(
      (c) => c.id.startsWith("bin.") || /^harness\.(state|version|caps|denylist)\./.test(c.id),
    ),
    [],
  );
  // One entry of the resolved registry produces exactly its own entries.
  const one: readonly HarnessEntry[] = [{ id: "adapter-a", state: "tested" }];
  const built = harnessChecksOf(one);
  assert.deepEqual(
    built.map((c) => c.id),
    [
      "harness.discovered",
      "bin.adapter-a",
      "harness.state.adapter-a",
      "harness.version.adapter-a",
      "harness.caps.adapter-a",
      "harness.denylist.adapter-a",
    ],
  );
  // The auth entry of one harness and role, likewise produced, never named.
  assert.equal(authCheckFor("adapter-a", "proposer").id, "auth.adapter-a.proposer");
  assert.equal(modelReachCheckFor("proposer").id, "model.reach.proposer");
});

test("CT-112-109: a discovered harness no requirement names gets its entries from the registry", async () => {
  // `sample-discovered` names no requirement of the spec: it was detected.
  const entries: readonly HarnessEntry[] = [
    { id: "sample-tested", state: "tested", resolvedPath: "/usr/bin/sample-tested" },
    { id: "sample-discovered", state: "detected" },
  ];
  const checks = harnessChecksOf(entries);
  const result = await runDoctorChecks({
    checks,
    bag: makeProbeBag({ registry: { ids: [...entries.map((e) => e.id)], harnesses: entries } }),
  });
  assert.equal(result.error, undefined);
  const ids = result.findings.map((f) => f.id);
  for (const id of [
    "harness.discovered",
    "bin.sample-discovered",
    "harness.state.sample-discovered",
    "harness.version.sample-discovered",
    "harness.caps.sample-discovered",
    "harness.denylist.sample-discovered",
  ]) {
    assert.ok(ids.includes(id), `the discovered harness produced ${id}`);
  }
  const listed = result.findings.find((f) => f.id === "harness.discovered");
  assert.match(listed?.message ?? "", /sample-discovered unverified \(detected\)/);
});
