/**
 * T051 (feature 112) — CT-112-121 (F112-FR-021, F112-FR-033): the toolchains
 * a run detected and which of them have a pattern set.
 *
 * The toolchain check is registered by the content owner of EP-16 (the
 * package for the integrity of checks); its code lives in that package, not
 * in the doctor (F112-FR-033). This test registers a stub of it from outside
 * the doctor package through the same registry surface, and fixes what
 * feature 112 owns: the finding appears in the text output and in `--json`,
 * by exactly the same rules as a core check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Check, ProbeBag } from "../src/registry/types.ts";
import { runDoctorChecks, makeProbeBag } from "../src/runner/run.ts";
import { renderText } from "../src/render/text.ts";
import { renderJson } from "../src/render/json.ts";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * The stub of the toolchain check (EP-16's owner registers the real one; the
 * probe here reads only what a run detected, from the injected bag).
 */
const toolchainCheck: Check = {
  id: "toolchain.patterns",
  group: "config",
  lb: false,
  order: 46,
  messageTemplate: "{detectedText}",
  fixHint: "set a pattern for each toolchain a run detected",
  severityRule: (o: unknown) => {
    const s = o as { withoutPattern: readonly string[] };
    return s.withoutPattern.length > 0 ? "warn" : "ok";
  },
  probe: async (bag) => {
    const b = bag as unknown as ProbeBag;
    const state = b.config.values.get("toolchain.patterns") as
      { detected: readonly string[]; withPattern: readonly string[] } | undefined;
    if (state === undefined) return undefined;
    const withoutPattern = state.detected.filter((t) => !state.withPattern.includes(t));
    return {
      withoutPattern,
      detectedText:
        withoutPattern.length > 0
          ? `toolchains detected: ${state.detected.join(", ")}; without a pattern set: ${withoutPattern.join(", ")} (basic protection only)`
          : `toolchains detected: ${state.detected.join(", ")}; all have a pattern set`,
    };
  },
};

const SUBJECT = { host: "test-host", audience: "personal", proposer: "p", critic: "c" };

const STATE: [string, unknown][] = [
  ["toolchain.patterns", { detected: ["tsc", "eslint"], withPattern: ["tsc"] }],
];

test("CT-112-121: the registered toolchain finding appears in the text output", async () => {
  const result = await runDoctorChecks({
    checks: [toolchainCheck],
    bag: makeProbeBag({ config: { values: new Map(STATE) } }),
  });
  assert.equal(result.error, undefined);
  const finding = result.findings.find((f) => f.id === "toolchain.patterns");
  assert.ok(finding, "the check produced its finding");
  assert.equal(finding.severity, "warn");
  const text = renderText(result.findings, SUBJECT, 0);
  assert.match(text, /toolchain\.patterns/);
  assert.match(text, /eslint/);
  assert.match(text, /basic protection only/);
});

test("CT-112-121: the registered toolchain finding appears in --json", async () => {
  const result = await runDoctorChecks({
    checks: [toolchainCheck],
    bag: makeProbeBag({ config: { values: new Map(STATE) } }),
  });
  const json = renderJson({
    findings: result.findings,
    at: "2026-10-17T00:00:00Z",
    host: SUBJECT.host,
    audience: "personal",
    exit: 0,
  });
  assert.equal(JSON.parse(json).schema, "specstride.doctor/1");
  assert.match(json, /toolchain\.patterns/);
  assert.match(json, /eslint/);
  // A toolchain with every pattern set is ok, and ok is never printed.
  const allSet: [string, unknown][] = [
    ["toolchain.patterns", { detected: ["tsc"], withPattern: ["tsc"] }],
  ];
  const okRun = await runDoctorChecks({
    checks: [toolchainCheck],
    bag: makeProbeBag({ config: { values: new Map(allSet) } }),
  });
  const okJson = renderJson({
    findings: okRun.findings,
    at: "2026-10-17T00:00:00Z",
    host: SUBJECT.host,
    audience: "personal",
    exit: 0,
  });
  const okParsed = JSON.parse(okJson) as { findings: { id: string; severity: string }[] };
  assert.deepEqual(
    okParsed.findings.map((f) => [f.id, f.severity]),
    [["toolchain.patterns", "ok"]],
  );
});

test("CT-112-121: the toolchain check is a stub here — no file of it lives in the doctor package", async () => {
  // F112-FR-033: the code of the check lives in the package of the owner of
  // EP-16; the core catalogue of the doctor holds no row for it.
  const catalogue = await readFile(
    fileURLToPath(new URL("../data/check-catalogue.tsv", import.meta.url)),
    "utf8",
  );
  assert.ok(!catalogue.includes("toolchain."), "no toolchain row in the core catalogue");
  let thrown = false;
  try {
    await readFile(fileURLToPath(new URL("../src/checks/toolchain.ts", import.meta.url)), "utf8");
  } catch {
    thrown = true;
  }
  assert.ok(thrown, "packages/doctor/src/checks/toolchain.ts does not exist");
});
