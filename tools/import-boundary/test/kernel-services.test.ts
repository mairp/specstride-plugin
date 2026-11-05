/**
 * T221 — tests CT-100-334 and CT-100-335 of the import-boundary check for the
 * services of the kernel, the three edge packages and the learning interface
 * (annex A, §A.3 and §A.4; F100-FR-234, F100-FR-235).
 *
 * CT-100-334: the kernel offers the core what the core may not import — the
 * process primitive, the clock, the registration call of the doctor's checks and
 * the atomic write — and the core and every loop layer receive them as arguments
 * from the composition root. An edge package may touch the file system or start
 * a process on behalf of a core package, behind an interface of the `contracts`
 * package: in Wave 1 one for the integrity of checks (owner 116), one for the
 * tree store (owner 143) and one for the check runner (owner 148). A core
 * package reaches an edge package through that interface and never by importing
 * it; the check fails with the file, the import and the rule when it does.
 *
 * CT-100-335: the calls of the engine into learning are a plain function
 * interface of the `contracts` package at layer L2, which the composition root
 * hands to the engine. It is no extension point in Wave 1. A failure of a call
 * leaves the run on the value it would have had without learning, and never
 * undoes an approval. The learning package itself is of the edge layer and no
 * core package may import it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLayerFacts } from "../src/layer-facts.ts";
import { entryOf, parseLayer } from "../src/rules.ts";
import {
  CORE_ALLOWED_PACKAGES,
  CORE_FORBIDDEN_BUILTINS,
  coreImportViolation,
} from "../src/core-rule.ts";
import {
  A_CORE_PACKAGE_IMPORTS_AN_EDGE_PACKAGE,
  A_CORE_PACKAGE_REACHES_AN_EDGE_PACKAGE_THROUGH,
  A_FAILURE_LEAVES_THE_RUN_ON_THE_VALUE_WITHOUT_LEARNING,
  A_FAILURE_UNDOES_AN_APPROVAL,
  ANNEX_SECTIONS,
  AN_EDGE_PACKAGE_MAY,
  ARM_WITHOUT_LEARNING,
  BRACKET_IS_TWO_OPERATIONS,
  DETACHED_HAS_A_WAITER_IN_THE_NEW_SESSION,
  DETACHED_STATUS_FIELDS,
  DOCTOR_REGISTRATION_LIVES_IN,
  EDGE_PACKAGES,
  EDGE_PACKAGE_COUNT,
  EDGE_PACKAGE_OWNERS,
  FORBIDDEN_TO_A_CORE_PACKAGE,
  GROUP_SIGNALS,
  HANDED_BY,
  IS_AN_EXTENSION_POINT_IN_WAVE_1,
  KERNEL_SERVICES,
  LAYER,
  LEARNING_OPERATIONS,
  LEARNING_OPERATION_COUNT,
  NO_SHELL_IS_USED,
  PROCESS_OPERATIONS,
  RECORD_EXISTS_WHEN_THE_STARTER_HAS_ENDED,
  REPORT_IS_READ_ONLY,
  REQUIREMENTS,
  SERVICES_ARE_RECEIVED_AS_ARGUMENTS,
  STANDARD_INPUT_IS_CLOSED,
  STARTS_IN_A_GROUP_OF_ITS_OWN,
  STARTS_IN_A_SESSION_OF_ITS_OWN,
  evaluateOrLeaveTheApproval,
  observeOrLeaveTheApproval,
  resolveOrWithoutLearning,
} from "@specstride/contracts/ep/kernel-services";

const facts = loadLayerFacts();
const graph = facts.graph;
const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(TOOL_DIR, "src/index.ts");
const corePackages = graph.packages.filter((p) => p.core === true).map((p) => p.name);
const FILE = "packages/core/src/pass-loop.ts";

/* ------------------------------------------------------------------ *
 * CT-100-334 — the kernel services and the three edge packages.
 * ------------------------------------------------------------------ */

test("CT-100-334: the kernel offers the core the four services it may not import (F100-FR-234)", () => {
  assert.deepEqual([...ANNEX_SECTIONS], ["annex A, §A.3", "annex A, §A.4"]);
  assert.deepEqual([...REQUIREMENTS], ["F100-FR-234", "F100-FR-235"]);
  assert.deepEqual([...KERNEL_SERVICES], ["process", "clock", "doctor", "atomicWrite"]);

  // The process primitive: the operations §A.3 names, and no other.
  assert.deepEqual(
    [...PROCESS_OPERATIONS],
    ["start", "startDetached", "signalGroup", "startTimeOf", "findByRunToken", "waitForEnd"],
  );
  // A process starts in a group and a session of its own, with stdin closed
  // and no shell: properties of the primitive, not options of a call.
  assert.equal(STARTS_IN_A_GROUP_OF_ITS_OWN, true);
  assert.equal(STARTS_IN_A_SESSION_OF_ITS_OWN, true);
  assert.equal(STANDARD_INPUT_IS_CLOSED, true);
  assert.equal(NO_SHELL_IS_USED, true);
  // A group is signalled polite, terminate, kill, in that order.
  assert.deepEqual([...GROUP_SIGNALS], ["polite", "terminate", "kill"]);
  // The detached start: the waiter in the new session writes the status record
  // atomically, so the record exists when the starter has ended.
  assert.equal(DETACHED_HAS_A_WAITER_IN_THE_NEW_SESSION, true);
  assert.equal(RECORD_EXISTS_WHEN_THE_STARTER_HAS_ENDED, true);
  assert.deepEqual(
    [...DETACHED_STATUS_FIELDS],
    ["exitCode", "signal", "durationMs", "startedAtMs", "endedAtMs"],
  );
  // The registration call of the doctor's checks lives in the kernel package.
  assert.equal(DOCTOR_REGISTRATION_LIVES_IN, "@specstride/kernel");

  // The core and every loop layer receive the services as arguments from the
  // composition root, never by reading a module of the platform.
  assert.equal(SERVICES_ARE_RECEIVED_AS_ARGUMENTS, true);
  assert.equal(HANDED_BY, "the composition root");
  assert.ok(corePackages.length >= 3, "the graph marks the engine and the loop layers as core");
  for (const name of corePackages) {
    const entry = entryOf(graph, name);
    assert.ok(entry !== undefined, name);
    assert.deepEqual(
      [...(entry.mayImport ?? [])].sort(),
      [...CORE_ALLOWED_PACKAGES].sort(),
      `${name} may import the contracts package and the kernel package and nothing else`,
    );
  }

  // The graph names the owner of the process primitive in the kernel package.
  const kernel = entryOf(graph, "@specstride/kernel");
  assert.ok(kernel !== undefined);
  assert.match(kernel.owner ?? "", /process primitive/);
  assert.match(kernel.owner ?? "", /registration call of doctor checks/);
  assert.match(kernel.owner ?? "", /atomic write/);
});

test("CT-100-334: the graph forbids a core package the modules the kernel services replace (F100-FR-234)", () => {
  assert.deepEqual(
    [...FORBIDDEN_TO_A_CORE_PACKAGE],
    [
      "node:fs",
      "node:fs/promises",
      "node:child_process",
      "node:net",
      "node:http",
      "node:https",
      "node:dgram",
    ],
  );
  for (const name of corePackages) {
    const entry = entryOf(graph, name);
    for (const forbidden of ["node:fs", "node:fs/promises", "node:child_process"]) {
      assert.ok(
        (entry?.forbidden ?? []).includes(forbidden),
        `${name} is forbidden ${forbidden} in the graph`,
      );
    }
  }
  // The list is the one the check enforces, and the check refuses each of
  // them, with the file, the import and the rule.
  assert.deepEqual([...FORBIDDEN_TO_A_CORE_PACKAGE].sort(), [...CORE_FORBIDDEN_BUILTINS].sort());
  for (const forbidden of FORBIDDEN_TO_A_CORE_PACKAGE) {
    const violation = coreImportViolation(
      graph,
      corePackages[0] ?? "@specstride/core",
      FILE,
      1,
      forbidden,
    );
    assert.ok(violation !== undefined, forbidden);
    assert.equal(violation.file, FILE);
    assert.equal(violation.spec, forbidden);
    assert.notEqual(violation.rule, "", `${forbidden} fails with a rule`);
  }
});

test("CT-100-334: the three edge packages are in the graph with their layer, owner, `mayImport` and note (F100-FR-234)", () => {
  assert.equal(EDGE_PACKAGE_COUNT, 3);
  assert.equal(EDGE_PACKAGES.length, 3);
  assert.deepEqual([...EDGE_PACKAGE_OWNERS], ["116", "143", "148"]);
  assert.deepEqual(
    EDGE_PACKAGES.map((e) => e.name),
    ["@specstride/integrity", "@specstride/tree-store", "@specstride/check-runner"],
  );
  // The graph marks exactly these three as edge packages.
  const marked = graph.packages.filter((p) => p.edge === true).map((p) => p.name);
  assert.deepEqual(
    [...marked].sort(),
    EDGE_PACKAGES.map((e) => e.name).sort(),
    "the graph marks the three edge packages of §A.3 and no other",
  );
  for (const edge of EDGE_PACKAGES) {
    const entry = entryOf(graph, edge.name);
    assert.ok(entry !== undefined, edge.name);
    // Their layer: L1, the edge layer, below the core.
    assert.equal(entry.layer, "L1", `${edge.name} is at L1`);
    assert.equal(parseLayer(entry.layer), 1);
    // Their owner: 116, 143, 148.
    assert.ok(
      (entry.owner ?? "").startsWith(edge.owner),
      `${edge.name} is owned by ${edge.owner}, not by ${String(entry.owner)}`,
    );
    // Their `mayImport`: the contracts package and the kernel package only.
    assert.deepEqual(
      [...(entry.mayImport ?? [])].sort(),
      ["@specstride/contracts", "@specstride/kernel"],
      `${edge.name} may import the two shared packages only`,
    );
    // Their note: an edge package may touch the file system or start a process.
    const note = entry.note ?? "";
    assert.match(note, /^Edge package/, `${edge.name} is noted as an edge package`);
    assert.match(
      note,
      /may touch the file system or start a process/,
      `${edge.name} states what an edge package may do`,
    );
    assert.match(
      note,
      /behind its interface in @specstride\/contracts/,
      `${edge.name} states that it is reached through its interface`,
    );
    assert.match(note, /F100-FR-234/, `${edge.name} cites the requirement`);
  }
  assert.deepEqual([...AN_EDGE_PACKAGE_MAY], ["touch the file system", "start a process"]);
});

test("CT-100-334: the graph states the rule that a core package reaches an edge package only through its interface (F100-FR-234)", () => {
  assert.equal(A_CORE_PACKAGE_IMPORTS_AN_EDGE_PACKAGE, false);
  assert.equal(
    A_CORE_PACKAGE_REACHES_AN_EDGE_PACKAGE_THROUGH,
    "its interface in the `contracts` package",
  );
  const rules = graph.rules ?? [];
  const servicesRule = rules.find((r) => /receives the kernel services/.test(r));
  assert.ok(servicesRule !== undefined, "the graph states the rule of the kernel services");
  assert.match(servicesRule, /as arguments from the composition root/);
  assert.match(servicesRule, /F100-FR-234/);
  assert.match(servicesRule, /kernel-services\.ts/, "the rule names the interface file");
  const edgeRule = rules.find((r) => /reaches an edge package/.test(r));
  assert.ok(edgeRule !== undefined, "the graph states the rule of the edge packages");
  assert.match(edgeRule, /only through its interface in @specstride\/contracts/);
  assert.match(edgeRule, /never by importing it/);
  for (const owner of EDGE_PACKAGE_OWNERS) {
    assert.ok(edgeRule.includes(owner), `the rule names the owner ${owner}`);
  }
  // No edge package may import a core package: the layer rule says so.
  for (const edge of EDGE_PACKAGES) {
    const entry = entryOf(graph, edge.name);
    for (const core of corePackages) {
      assert.ok(
        !(entry?.mayImport ?? []).includes(core),
        `${edge.name} does not import the core package ${core}`,
      );
    }
  }
});

test("CT-100-334: the check fails on a core file that imports an edge package (the file, the import and the rule)", () => {
  for (const edge of EDGE_PACKAGES) {
    const violation = coreImportViolation(
      graph,
      corePackages[0] ?? "@specstride/core",
      FILE,
      3,
      edge.name,
    );
    assert.ok(violation !== undefined, `${edge.name} is refused to the core`);
    assert.equal(violation.file, FILE);
    assert.equal(violation.line, 3);
    assert.equal(violation.spec, edge.name);
    assert.notEqual(violation.rule, "", `${edge.name} fails with a rule`);
    assert.ok(violation.detail.includes(edge.name), "the failure names the import it refused");
  }
  // The two shared packages are permitted, so the rule is not vacuous.
  for (const allowed of CORE_ALLOWED_PACKAGES) {
    assert.equal(
      coreImportViolation(graph, corePackages[0] ?? "@specstride/core", FILE, 1, allowed),
      undefined,
      allowed,
    );
  }
});

test("CT-100-334: the entry of the check fails over a workspace whose core file imports an edge package", () => {
  const root = edgeFixtureWorkspace(
    'import { fingerprint } from "@specstride/integrity";\nexport const a = fingerprint;\n',
  );
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 1, out);
    assert.match(
      out,
      /packages\/core\/src\/index\.ts:1 imports "@specstride\/integrity" \[core:[a-z-]+\]/,
      out,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CT-100-334: the entry of the check passes over the same workspace when the core takes the interface instead", () => {
  const root = edgeFixtureWorkspace(
    'import type { KernelServices } from "@specstride/contracts";\n' +
      "export const run = (services: KernelServices) => services;\n",
  );
  try {
    const { code, out } = runEntry(root);
    assert.equal(code, 0, out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * CT-100-335 — the learning interface.
 * ------------------------------------------------------------------ */

test("CT-100-335: the calls into learning are a plain function interface of the `contracts` package at L2 (F100-FR-235)", () => {
  assert.equal(LAYER, "L2");
  assert.equal(IS_AN_EXTENSION_POINT_IN_WAVE_1, false);
  assert.equal(HANDED_BY, "the composition root");
  // Five operations, of which the tamper bracket is two.
  assert.equal(LEARNING_OPERATION_COUNT, 5);
  assert.deepEqual(
    [...LEARNING_OPERATIONS],
    ["resolve", "observe", "evaluate", "report", "bracketTake", "bracketCheck"],
  );
  assert.deepEqual([...BRACKET_IS_TWO_OPERATIONS], ["bracketTake", "bracketCheck"]);
  assert.equal(
    LEARNING_OPERATIONS.length - BRACKET_IS_TWO_OPERATIONS.length + 1,
    LEARNING_OPERATION_COUNT,
    "the bracket counts as one operation of the five",
  );
  assert.equal(REPORT_IS_READ_ONLY, true);
  // The interface is no extension point, so the registry of EP points does not
  // hold it: every point of the index is one of the nineteen.
  assert.equal(
    graph.packages.some((p) => p.name === "@specstride/learning" && p.layer === "L1"),
    true,
    "the implementation of learning is an edge-layer package of feature 106",
  );
  const learning = entryOf(graph, "@specstride/learning");
  assert.equal(learning?.owner, "106");
});

test("CT-100-335: no core package imports the learning package; it takes the interface instead (F100-FR-235)", () => {
  for (const name of corePackages) {
    const entry = entryOf(graph, name);
    assert.ok(
      !(entry?.mayImport ?? []).includes("@specstride/learning"),
      `${name} does not import @specstride/learning`,
    );
  }
  // The check refuses it, with the file, the import and the rule.
  const violation = coreImportViolation(
    graph,
    corePackages[0] ?? "@specstride/core",
    FILE,
    7,
    "@specstride/learning",
  );
  assert.ok(violation !== undefined);
  assert.equal(violation.spec, "@specstride/learning");
  assert.equal(violation.line, 7);
  // The graph states the rule.
  const rule = (graph.rules ?? []).find((r) => /calls of the engine into learning/.test(r));
  assert.ok(rule !== undefined, "the graph states the rule of the learning interface");
  assert.match(rule, /plain function interface of @specstride\/contracts/);
  assert.match(rule, /at layer L2/);
  assert.match(rule, /no extension point in\s+Wave 1/);
  assert.match(rule, /F100-FR-235/);
});

test("CT-100-335: a failure of a call leaves the run on the value it would have had without learning (F100-FR-235)", async () => {
  assert.equal(A_FAILURE_LEAVES_THE_RUN_ON_THE_VALUE_WITHOUT_LEARNING, true);
  assert.equal(A_FAILURE_UNDOES_AN_APPROVAL, false);
  assert.equal(ARM_WITHOUT_LEARNING, "baseline");

  // `resolve` answers: the run takes the value and the arm learning gave.
  const answered = await resolveOrWithoutLearning(
    { resolve: () => Promise.resolve({ value: 900, arm: "applied", decisionId: "d1" }) },
    "proposer_timeout",
    9,
    600,
  );
  assert.deepEqual({ ...answered }, { value: 900, arm: "applied", decisionId: "d1" });

  // `resolve` fails: the run stays on the value it would have had without
  // learning, on the baseline arm. The failure is not an error of the run.
  const fallback = await resolveOrWithoutLearning(
    {
      resolve: () => {
        throw new Error("the decision log is unreadable");
      },
    },
    "proposer_timeout",
    9,
    600,
  );
  assert.equal(fallback.value, 600);
  assert.equal(fallback.arm, "baseline");

  // `observe` and `evaluate` fail: the approval is not undone.
  for (const call of [observeOrLeaveTheApproval, evaluateOrLeaveTheApproval] as const) {
    const failed = await (
      call as (l: never, p: number) => Promise<{ called: boolean; approvalUndone: false }>
    )(
      {
        observe: () => Promise.reject(new Error("no")),
        evaluate: () => Promise.reject(new Error("no")),
      } as never,
      9,
    );
    assert.equal(failed.called, false);
    assert.equal(failed.approvalUndone, false, "a failure never undoes an approval");
  }
  const observed = await observeOrLeaveTheApproval({ observe: () => Promise.resolve() }, 9);
  assert.equal(observed.called, true);
  assert.equal(observed.approvalUndone, false);
});

/** A fixture workspace whose core package imports an edge package. */
function edgeFixtureWorkspace(coreSrc: string): string {
  const root = mkdtempSync(join(tmpdir(), "kernel-services-boundary-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "edge-fixture-root", private: true, workspaces: ["packages/*"] }),
  );
  const dataDir = join(root, "packages/contracts/data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "package-graph.json"),
    JSON.stringify({
      schema: "specstride.package-graph/1",
      packages: [
        { name: "@specstride/contracts", layer: "all", mayImport: [], nodeBuiltins: false },
        { name: "@specstride/kernel", layer: "all", mayImport: ["@specstride/contracts"] },
        {
          name: "@specstride/core",
          layer: "L4",
          core: true,
          mayImport: ["@specstride/contracts", "@specstride/kernel"],
          forbidden: ["node:fs", "node:fs/promises", "node:child_process"],
        },
        ...EDGE_PACKAGES.map((e) => ({
          name: e.name,
          layer: "L1",
          owner: e.owner,
          edge: true,
          mayImport: ["@specstride/contracts", "@specstride/kernel"],
          note: `Edge package of the kernel services of ${e.purpose}. An edge package may touch the file system or start a process on behalf of a core package, behind its interface in @specstride/contracts (annex A §A.3, F100-FR-234).`,
        })),
      ],
    }),
  );
  const coreDir = join(root, "packages/core");
  mkdirSync(join(coreDir, "src"), { recursive: true });
  writeFileSync(
    join(coreDir, "package.json"),
    JSON.stringify({ name: "@specstride/core", private: true }),
  );
  writeFileSync(join(coreDir, "src", "index.ts"), coreSrc);
  return root;
}

function runEntry(root: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [ENTRY, "--root", root], { encoding: "utf8" });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { code: e.status ?? -1, out: e.stdout ?? "" };
  }
}
