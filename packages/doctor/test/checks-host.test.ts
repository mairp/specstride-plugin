/**
 * T056 (feature 112) — CT-112-112 (F112-FR-012): the checks of group `host`.
 *
 * The host checks read existence and non-secret settings only, never the
 * contents of anything, and their probes are supplied by the host package: the
 * core catalogue names `host package` in the "probe supplied by" column for
 * every row of group `host`, and the core itself supplies no check of that
 * group. The ids, severities, messages and fixes are the catalogue's — a
 * host-registered check takes them from the row, and its probe reads existence
 * (`files.stat`) and non-secret settings, so that even a change of the file's
 * CONTENT, its metadata being equal, changes nothing the check says.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  envChecks,
  configChecks,
  termsChecks,
  runChecks,
  miscChecks,
  criticChecks,
  harnessChecksOf,
  createDoctorRegistry,
  makeFileMetadataReader,
  renderMessage,
} from "../src/index.ts";
import type { Check, ProbeBag } from "../src/registry/types.ts";
import { findingOf } from "./helpers.ts";

const CATALOGUE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "check-catalogue.tsv",
);

/** One parsed row of the catalogue: the fields CT-112-112 reads. */
type Row = {
  id: string;
  group: string;
  supplier: string;
  lb: string;
  message: string;
  fix: string;
};

/** Parse the catalogue file (tab separated, with its header row). */
export function catalogRows(path: string): readonly Row[] {
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "");
  return lines.slice(1).map((line) => {
    const [n, id, group, supplier, , lb, message, fix] = line.split("\t");
    void n;
    return {
      id: id ?? "",
      group: group ?? "",
      supplier: supplier ?? "",
      lb: lb ?? "",
      message: message ?? "",
      fix: fix ?? "",
    };
  });
}

/** Every check the core supplies (no per-harness entry, no host check). */
function coreChecks(): readonly Check[] {
  return [
    ...envChecks,
    ...configChecks,
    ...termsChecks,
    ...runChecks,
    ...miscChecks,
    ...criticChecks,
    ...harnessChecksOf([]),
  ];
}

test("CT-112-112: every catalogue row of group host is supplied by the host package", () => {
  const hostRows = catalogRows(CATALOGUE).filter((r) => r.group === "host");
  assert.deepEqual(
    hostRows.map((r) => r.id),
    ["host.plugin", "host.claudeFloor", "host.managedSettings", "host.bgIsolation"],
  );
  for (const row of hostRows) {
    assert.equal(row.supplier, "host package", `${row.id} is not supplied by the host package`);
  }
});

test("CT-112-112: the core registers no check of group host", () => {
  const registry = createDoctorRegistry();
  for (const check of coreChecks()) {
    assert.notEqual(check.group, "host", `${check.id} must not live in the core`);
    assert.ok(!check.id.startsWith("host."), `${check.id} must not live in the core`);
  }
  assert.equal(registry.registered().length, 0, "the core registers nothing on its own");
});

/** The sample probe of the host package: existence and non-secret settings only. */
function hostManagedSettingsProbe(bag: ProbeBag): Promise<Record<string, unknown>> {
  const settings = bag.config.values.get("host.managedSettings") as
    { path?: string; policyHook?: boolean } | undefined;
  // Existence only: a metadata read, never the content of the settings file.
  const meta = settings?.path === undefined ? undefined : bag.files.stat(settings.path);
  return Promise.resolve({
    exists: meta !== undefined,
    size: meta?.size,
    policyHook: settings?.policyHook ?? false,
  });
}

test("CT-112-112: a host check reads existence and non-secret settings, never content", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "specstride-112-host-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, "managed-settings.json");
  writeFileSync(settingsPath, JSON.stringify({ policy: { hooks: "none" } }), { mode: 0o600 });
  const check: Check = {
    id: "host.managedSettings",
    group: "host",
    lb: false,
    order: 9,
    messageTemplate: "managed settings {state}",
    fixHint: "review the policy; the harness adapter asserts the initial record",
    severityRule: (o) => ((o as { policyHook: boolean }).policyHook ? "warn" : "info"),
    probe: hostManagedSettingsProbe,
  };
  const entries: readonly [string, unknown][] = [
    ["host.managedSettings", { path: settingsPath, policyHook: false }],
  ];
  const overrides = { files: makeFileMetadataReader() };
  const first = await findingOf(check, entries, overrides);
  assert.equal(first.severity, "info");
  // The evidence holds no content field: only existence and the settings.
  assert.ok(!JSON.stringify(first.evidence).includes("hooks"), "content leaked into the evidence");
  // Change the CONTENT, keep the metadata: the check says exactly the same.
  const bytes = readFileSync(settingsPath).byteLength;
  writeFileSync(settingsPath, "x".repeat(bytes), { mode: 0o600 });
  const second = await findingOf(check, entries, overrides);
  assert.equal(second.severity, first.severity);
  assert.equal(second.message, first.message);
  assert.deepEqual(second.evidence, first.evidence);
});

test("CT-112-112: the message and fix of a host check are the catalogue's", () => {
  const row = catalogRows(CATALOGUE).find((r) => r.id === "host.claudeFloor");
  assert.ok(row !== undefined);
  // The row's own words, filled by the observed state through renderMessage,
  // inside the 200-byte cap; the row is not launch-blocking.
  const message = renderMessage(row.message, {
    host: "2.1.260",
    features: "userConfig options",
    floor: "2.1.271",
  });
  assert.ok(Buffer.byteLength(message, "utf8") <= 200);
  assert.ok(row.fix.length > 0 && Buffer.byteLength(row.fix, "utf8") <= 200);
  assert.equal(row.lb, "no");
});
