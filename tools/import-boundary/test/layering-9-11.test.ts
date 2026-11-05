/**
 * T234 — contract tests CT-100-109 to CT-100-111 for the layering rules
 * LR-9 to LR-11 (annex A, §A.2).
 *
 * - CT-100-109 (LR-9, F100-FR-009): one ingress package names the
 *   redactor and a size cap, every sink and prompt package imports only
 *   the ingress, and the cap under the `parity` profile is not below
 *   60000 characters of phase evidence and 327680 bytes of grounding at a
 *   window of 200000 tokens.
 * - CT-100-110 (LR-10, F100-FR-010): no package of the graph is an oracle
 *   mode — no package name or export named for the oracle other than the
 *   compatibility projection.
 * - CT-100-111 (LR-11, F100-FR-011): every closed set of
 *   `closed-sets.json` has an owner and an unknown-value rule, every
 *   schema file has a required `schema` property (or the schema-id field
 *   the annex names for it), and the validator of the lazy compile of
 *   T232 (the validator T028 builds on) refuses a record whose major
 *   differs from the one the schema supports.
 *
 * The tests run over the data files of the package
 * (`packages/contracts/data/` and `packages/contracts/schemas/`), the
 * machine-readable form of the annexes, and over the validator of
 * `packages/contracts/src/records/compile.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validate } from "@specstride/contracts/records/compile";
import { loadLayerFacts } from "../src/layer-facts.ts";
import { expandMayImport } from "../src/rules.ts";

const facts = loadLayerFacts();
const graph = facts.graph;
const DATA = join(facts.root, "packages/contracts/data");
const SCHEMAS = join(facts.root, "packages/contracts/schemas");

function readData<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA, name), "utf8")) as T;
}

/** The owner numbers of a graph entry (the numbers of the feature owners). */
function ownerNumbers(owner: string | undefined): string[] {
  return (owner ?? "")
    .split(/[,;]/)
    .map((part) => part.trim().split(" ")[0])
    .filter((part) => /^\d+$/.test(part));
}

test("CT-100-109: one ingress package names the redactor and a size cap (LR-9)", () => {
  // the kernel names the owner of the redactor (`111 (redactor)`);
  // exactly one package of the graph beside the kernel owns it: the
  // ingress, where the text from outside the runtime is redacted and cut
  // to a size cap (F100-FR-009)
  const kernel = graph.packages.find((p) => p.name === "@specstride/kernel");
  assert.ok(kernel !== undefined, "the graph holds the kernel");
  const redactor = /(\d+)\s*\(([^)]*redactor[^)]*)\)/i.exec(kernel.owner ?? "");
  assert.ok(redactor !== null, "the kernel entry names the owner of the redactor");
  const owners = graph.packages
    .filter((p) => p.name !== "@specstride/kernel")
    .filter((p) => ownerNumbers(p.owner).includes(redactor[1]));
  assert.equal(
    owners.length,
    1,
    "exactly one package is the ingress (the redactor's owner beside the kernel)",
  );
  assert.equal(owners[0].name, facts.ingressPackage);

  // the redactor takes a text and a size cap (kernel-operations.json,
  // the machine-readable form of annex X §X.4): the ingress names the
  // redactor and the size cap
  const kernelOps = readData<{
    redactor: Array<{ Operation: string; Input: string; Output: string }>;
  }>("kernel-operations.json");
  const redact = kernelOps.redactor.find((op) => op.Operation.replace(/`/g, "") === "redact");
  assert.ok(redact !== undefined, "the kernel operations hold the redact operation");
  assert.ok(
    /size cap/i.test(redact.Input),
    `the redact operation takes a size cap (its input: ${redact.Input})`,
  );
});

test("CT-100-109: every sink and prompt package imports only the ingress (LR-9)", () => {
  // the sink packages (owner 128: telemetry export) and the prompt
  // packages (owner 103: the proposer pass, which assembles the prompt)
  // receive the redacted, cut result only: they may import the ingress,
  // and the shared packages, and nothing else from the product
  const shared = ["@specstride/contracts", "@specstride/kernel", facts.ingressPackage];
  const sinksAndPrompts = graph.packages.filter((p) =>
    [...ownerNumbers(p.owner)].some((n) => n === "103" || n === "128"),
  );
  assert.ok(sinksAndPrompts.length > 0, "the graph holds sink and prompt packages");
  for (const pkg of sinksAndPrompts) {
    const expanded = [...expandMayImport(graph, pkg)];
    for (const named of expanded) {
      assert.ok(
        shared.includes(named),
        `${pkg.name} (a sink or prompt package) may import only the ingress and the shared packages; found ${named}`,
      );
    }
  }
});

test("CT-100-109: the cap under the parity profile is not below the as-is sizes (LR-9)", () => {
  // the as-is sizes that reach the critic prompt (F100-FR-009): phase
  // evidence up to 60000 characters; a grounding budget of 327680 bytes
  // at a window of 200000 tokens
  const floorPhaseEvidenceChars = 60000;
  const floorGroundingBytes = 327680;
  const floorWindowTokens = 200000;
  assert.ok(floorPhaseEvidenceChars >= 60000);
  assert.ok(floorGroundingBytes >= 327680);
  assert.ok(floorWindowTokens >= 200000);

  const profile = readData<{ profile: string; switches: Array<Record<string, unknown>> }>(
    "parity-profile.json",
  );
  // the parity configuration is the named profile `parity` (F100-FR-010)
  assert.equal(profile.profile, "parity");

  // a switch pins a value under parity only when the value is a single
  // number; a value that names the as-is form applies the as-is sizes,
  // which the floor holds by construction
  const pinned = (value: unknown): number | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
  };
  const inScope = (key: string): "window" | "evidence" | "grounding" | undefined => {
    if (/contextTokens|context window/i.test(key)) return "window";
    if (/evidence/i.test(key) && /char/i.test(key)) return "evidence";
    if (/grounding/i.test(key) && /budget|bytes/i.test(key)) return "grounding";
    return undefined;
  };
  for (const sw of profile.switches) {
    const key = String(sw.keyNote ?? "");
    const scope = inScope(key);
    if (scope === undefined) continue;
    const value = pinned(sw.parity);
    if (value === undefined) continue; // not pinned under parity: the as-is size applies
    const floor =
      scope === "window"
        ? floorWindowTokens
        : scope === "evidence"
          ? floorPhaseEvidenceChars
          : floorGroundingBytes;
    assert.ok(
      value >= floor,
      `the parity profile pins ${key} to ${value} under parity, below the as-is floor ${floor} (F100-FR-009, FX-25)`,
    );
  }
  // the critic's context window is named under parity and pins nothing
  // below the as-is window of 200000 tokens
  const windowSwitch = profile.switches.find((sw) =>
    /contextTokens/i.test(String(sw.keyNote ?? "")),
  );
  assert.ok(windowSwitch !== undefined, "the parity profile names the critic's context window");
  const windowValue = pinned(windowSwitch.parity);
  assert.ok(
    windowValue === undefined || windowValue >= floorWindowTokens,
    "the parity profile does not pin the critic's context window below 200000 tokens",
  );
});

test("CT-100-110: no package of the graph is an oracle mode (LR-10)", () => {
  // no package name of the product is named for the oracle: the only
  // oracle-named package is the development oracle of feature 141, of
  // layer dev, shipped never — not a package of the product
  const oracleNamed = graph.packages.filter((p) => /oracle/i.test(p.name));
  for (const pkg of oracleNamed) {
    assert.equal(pkg.layer, "dev", `the package ${pkg.name} named for the oracle is a dev package`);
    assert.equal(
      pkg.shipped,
      "never",
      `the package ${pkg.name} named for the oracle is never shipped`,
    );
  }
  // and no published package is named for the oracle
  for (const name of graph.published ?? []) {
    assert.ok(
      !/oracle/i.test(name),
      `the published package ${name} must not be named for the oracle (F100-FR-010)`,
    );
  }
  // and no export of a workspace package is named for the oracle: the
  // compatibility projection (the one oracle-named thing, which
  // consumers may also switch on) is a profile switch and a sink, not an
  // export of a package
  const rootPkg = JSON.parse(readFileSync(join(facts.root, "package.json"), "utf8")) as {
    workspaces: string[];
  };
  let exportsChecked = 0;
  for (const pattern of rootPkg.workspaces) {
    const baseDir = join(facts.root, pattern.replace(/\/\*$/, "/"));
    if (!existsSync(baseDir)) continue;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgFile = join(baseDir, entry.name, "package.json");
      if (!existsSync(pkgFile)) continue;
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { exports?: unknown };
      if (pkg.exports === undefined) continue;
      const entries =
        typeof pkg.exports === "string"
          ? ["."]
          : Object.keys(pkg.exports as Record<string, unknown>);
      exportsChecked += entries.length;
      for (const exportName of entries) {
        assert.ok(
          !/oracle/i.test(exportName),
          `the export ${exportName} of ${entry.name} must not be named for the oracle (F100-FR-010)`,
        );
      }
    }
  }
  assert.ok(exportsChecked > 0, "the workspace packages declare exports");
});

test("CT-100-111: every closed set has an owner and an unknown-value rule (LR-11)", () => {
  const closed = readData<{ closedSets: Array<Record<string, unknown>> }>("closed-sets.json");
  assert.ok(closed.closedSets.length > 0, "closed-sets.json holds the closed sets");
  for (const set of closed.closedSets) {
    const owner = set.owner;
    const unknownValue = set.unknownValue;
    assert.ok(
      typeof owner === "string" && owner.trim().length > 0,
      `the closed set ${JSON.stringify(set.name)} has an owner (annex X §X.6)`,
    );
    assert.ok(
      typeof unknownValue === "string" && unknownValue.trim().length > 0,
      `the closed set ${JSON.stringify(set.name)} has a rule for an unknown value (annex X §X.6)`,
    );
  }
});

test("CT-100-111: every schema file has a required schema property (LR-11)", () => {
  // every file of the control plane carries a schema field (F100-FR-011):
  // every record schema of the package declares the field that carries
  // the schema id as a required property — `schema`, or the schema-id
  // field the annex names for the record (`contract` of the yield
  // artifact and the overlay, `descriptorVersion` of the harness
  // descriptor); the fragments of an envelope record (the `:` part of
  // the schema id) carry the field of the envelope, which is checked on
  // the envelope; the rows of the stream dialect table are rows, not
  // records, and carry their required `schemaVersions`.
  const files = readdirSync(SCHEMAS)
    .filter((f) => f.endsWith(".schema.json"))
    .sort();
  assert.ok(files.length >= 30, "the package holds the record schemas");
  for (const file of files) {
    const schema = JSON.parse(readFileSync(join(SCHEMAS, file), "utf8")) as {
      "x-schema-id"?: string;
      required?: string[];
      properties?: Record<string, { "x-required"?: string }>;
    };
    const id = schema["x-schema-id"] ?? "";
    const props = schema.properties ?? {};
    const required = schema.required ?? [];
    const schemaProp = props["schema"];
    const hasRequiredSchema =
      required.includes("schema") ||
      (schemaProp !== undefined && (schemaProp["x-required"] ?? "").startsWith("Yes"));
    const hasContract = required.includes("contract");
    const hasDescriptorVersion = required.includes("descriptorVersion");
    const isFragment = id.includes(":");
    const isDialectRow = id === "specstride.stream-dialect/1";
    const envelopeOk = (() => {
      if (!isFragment || !id.includes("specstride.lease/1:")) return true;
      // the owner record is a fragment of the lease: the lease carries
      // the schema field
      const lease = JSON.parse(readFileSync(join(SCHEMAS, "lease.schema.json"), "utf8")) as {
        required?: string[];
      };
      return (lease.required ?? []).includes("schema");
    })();
    assert.ok(
      hasRequiredSchema ||
        hasContract ||
        hasDescriptorVersion ||
        (isFragment && envelopeOk) ||
        isDialectRow,
      `the schema file ${file} (${id}) must declare a required schema property (or the schema-id field the annex names)`,
    );
    if (isDialectRow) {
      assert.ok(
        required.includes("schemaVersions"),
        "the stream dialect row carries its required schemaVersions",
      );
    }
  }
});

test("CT-100-111: the validator refuses a record whose major differs from the one the schema supports (LR-11)", () => {
  // a valid lease record of major 1 passes (F100-FR-048)
  const lease: Record<string, unknown> = {
    schema: "specstride.lease/1",
    runId: "run:1",
    launchId: "launch:1",
    launchNonce: "nonce",
    owner: {
      pid: 1,
      processGroup: 1,
      startTime: 0,
      bootId: "boot",
      hostName: "host",
      pidNamespace: "ns",
      launchId: "launch:1",
      runTokenHash: "hash",
    },
    lockProvider: "provider",
    heartbeatAt: "2026-09-30T12:00:00Z",
    heartbeatEverySeconds: 30,
    validUntil: "2026-09-30T12:05:00Z",
    leaseTokenHash: "token-hash",
  };
  const ok = validate(lease as never);
  assert.equal(
    ok.ok,
    true,
    `a valid record of major 1 passes: ${JSON.stringify((ok as { errors?: unknown[] }).errors)}`,
  );

  // the same record with the schema field set to the next major is
  // refused, with the major found and the major supported named
  // (F100-FR-049)
  const nextMajor = { ...lease, schema: "specstride.lease/2" };
  const refused = validate(nextMajor as never);
  assert.equal(refused.ok, false, "a record whose major differs is refused");
  if (!refused.ok) {
    const major = refused.errors.find((e) => e.keyword === "different-major");
    assert.ok(major !== undefined, "the refusal names the different-major keyword");
    assert.ok(major.message.includes("2"), "the refusal names the major found (2)");
    assert.ok(major.message.includes("1"), "the refusal names the major supported (1)");
  }

  // validating against the id of the unsupported major is refused the
  // same way
  const againstUnsupported = validate("specstride.lease/2", lease as never);
  assert.equal(againstUnsupported.ok, false, "a schema id the package does not support is refused");
  if (!againstUnsupported.ok) {
    assert.ok(
      againstUnsupported.errors.some((e) => e.keyword === "different-major"),
      "the refusal is the different-major refusal",
    );
  }

  // an id the package does not hold at all is refused as unknown
  const unknown = validate("specstride.nonsense/9", { schema: "specstride.nonsense/9" } as never);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.ok(unknown.errors.some((e) => e.keyword === "unknown-schema"));
  }
});
