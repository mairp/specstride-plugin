/**
 * T159 — contract tests CT-100-184, CT-100-185 and CT-100-186 for the harness
 * descriptor, version 1 (annex C, §C.2): a valid sample passes, a different
 * major is refused, an unknown top-level key is refused and a key under `x-`
 * is ignored, every required field is required (F100-FR-084, F100-FR-085,
 * F100-FR-086).
 */
import test from "node:test";
import assert from "node:assert/strict";
import schema from "../schemas/harness-descriptor.schema.json" with { type: "json" };
import harnessTables from "../data/harness-tables.json" with { type: "json" };
import {
  ACCEPTED_DESCRIPTOR_VERSIONS,
  ACCEPTED_SOURCES,
  ANNEX_SECTION,
  AUTH_SCHEMES,
  AUTH_TIERS,
  AUTH_TIER_NEVER_VALID,
  COST_CLASSES,
  CREDENTIAL_IS_NEVER_STORED_OR_LOGGED,
  DESCRIPTOR_VERSION,
  DescriptorRefusedError,
  HARNESS_STATES,
  KNOWN_TOP_LEVEL_KEYS,
  LOGICAL_NAMES,
  MODEL_LIST_REQUEST_MAY_CARRY_THE_CREDENTIAL,
  PLACEHOLDERS,
  REDIRECTS_ARE_REFUSED,
  REQUIRED_BY_THE_ANNEX,
  SCHEMA_ID,
  UNVERIFIED_FACTS,
  VERIFIED_STATE,
  authTiersAreValid,
  ceilingIsDeclared,
  descriptorVersionFinding,
  descriptorVersionIsAccepted,
  endpointIsRefused,
  isAcceptedSource,
  isArgumentList,
  isHarnessDescriptor,
  isLoopback,
  isUnverified,
  parseCeiling,
  readHarnessDescriptor,
  secretMayBeSentTo,
  tryReadHarnessDescriptor,
  unknownPlaceholdersOf,
  unknownTopLevelKeysOf,
} from "../src/records/harness-descriptor.ts";
import { requiredOf, sampleOf } from "./samples.ts";
import { validate } from "../src/records/compile.ts";

/** A valid descriptor: every field the annex requires, and nothing else. */
function validDescriptor(): Record<string, unknown> {
  return {
    descriptorVersion: 1,
    id: "a-harness-1",
    kind: "cli",
    provider: { id: "a-provider", termsRef: null },
    detect: { vars: ["A_HARNESS_HOME"], executable: "a-harness", versionArgs: ["--version"] },
    auth: { tiers: [1, 2], credential: null },
    models: { default: "a-model", listIs: "declared", contextWindow: 200000 },
    roles: {
      proposer: { supported: true },
      critic: { supported: true, toolless: "flag", readOnlyTools: false, freshSession: true },
    },
    stream: { format: "jsonl", dialect: "prime-v3" },
    continuation: { supported: true, cacheTtlSec: 300 },
    failures: {},
    cost: { class: "subscription", prices: null },
    isolation: { envAllow: ["PATH", "HOME"] },
    containment: { ceiling: "C2" },
    memory: { native: false, switchOff: {} },
  };
}

test("CT-100-184: a valid sample of the harness descriptor passes (annex C, §C.2)", () => {
  assert.equal(SCHEMA_ID, "specstride.harness/1:descriptor");
  assert.equal(ANNEX_SECTION, "annex C, §C.2");
  assert.equal((schema as { "x-schema-id": string })["x-schema-id"], SCHEMA_ID);
  assert.deepEqual([...LOGICAL_NAMES], ["user:harness:<id>", "package:harness:<id>"]);

  const sample = validDescriptor();
  assert.ok(isHarnessDescriptor(sample));
  const record = readHarnessDescriptor(sample);
  assert.deepEqual(record, sample);
  assert.equal(tryReadHarnessDescriptor(sample).ok, true);

  // The sample built from the schema itself passes too, so that the sample of
  // this test cannot drift from the schema.
  const fromTheSchema = sampleOf(SCHEMA_ID);
  assert.ok(isHarnessDescriptor(fromTheSchema));

  // F100-FR-084 — the descriptor is data only: an argument list is a list and
  // never shell text, and its placeholders are the closed set of §C.2.
  assert.ok(isArgumentList(["--print", "{prompt}"]));
  assert.equal(isArgumentList("--print {prompt} | tee log"), false);
  assert.deepEqual(
    [...PLACEHOLDERS],
    [...(harnessTables as { placeholders: string[] }).placeholders],
  );
  assert.deepEqual(
    [...PLACEHOLDERS],
    [
      "{prompt}",
      "{promptFile}",
      "{workdir}",
      "{emptyTmp}",
      "{model}",
      "{sessionId}",
      "{file:<name>}",
    ],
  );
  assert.deepEqual([...unknownPlaceholdersOf(["{prompt}", "{file:plan.md}"])], []);
  assert.deepEqual([...unknownPlaceholdersOf(["{shell}"])], ["{shell}"]);
});

test("CT-100-184: a different major of the harness descriptor is refused (F100-FR-084)", () => {
  // The descriptor carries no field `schema`: its major is `descriptorVersion`
  // (annex C, §C.2). A version outside the accepted range is refused with a
  // doctor finding.
  assert.equal(DESCRIPTOR_VERSION, 1);
  assert.deepEqual([...ACCEPTED_DESCRIPTOR_VERSIONS], [1]);
  assert.equal(descriptorVersionIsAccepted(1), true);
  assert.equal(descriptorVersionIsAccepted(2), false);
  assert.equal(descriptorVersionIsAccepted("1"), false);

  assert.throws(
    () => readHarnessDescriptor({ ...validDescriptor(), descriptorVersion: 2 }),
    (err: unknown) => {
      assert.ok(err instanceof DescriptorRefusedError);
      assert.equal(err.reason, "descriptor-version");
      assert.notEqual(err.doctorFinding, undefined);
      assert.equal(err.doctorFinding?.severity, "fail");
      assert.equal(err.doctorFinding?.lb, true);
      assert.match(err.message, /descriptorVersion/);
      assert.match(err.message, /accepts 1/);
      return true;
    },
  );
  const refused = tryReadHarnessDescriptor({ ...validDescriptor(), descriptorVersion: 0 });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.reason, "descriptor-version");

  const finding = descriptorVersionFinding(2);
  assert.equal(finding.id, "harness.descriptor.version");
  assert.match(finding.evidence, /descriptorVersion=2/);

  // The schema id itself carries the major: a second major of the id is not a
  // schema of this package.
  const other = validate("specstride.harness/2:descriptor", validDescriptor());
  assert.equal(other.ok, false);
  if (!other.ok) assert.equal(other.errors[0]?.keyword, "different-major");
});

test("CT-100-184: an unknown top-level key is refused and a key under `x-` is ignored", () => {
  // The schema of §C.2 is closed, and says so.
  assert.equal((schema as { additionalProperties?: boolean }).additionalProperties, false);
  assert.notEqual((schema as { patternProperties?: object }).patternProperties, undefined);
  assert.match(
    String((schema as { "x-unknown-field": string })["x-unknown-field"]),
    /refused, except keys under x-/,
  );

  const withUnknown = { ...validDescriptor(), aKeyNoAnnexHolds: 1 };
  assert.deepEqual([...unknownTopLevelKeysOf(withUnknown)], ["aKeyNoAnnexHolds"]);
  assert.equal(isHarnessDescriptor(withUnknown), false);
  assert.throws(
    () => readHarnessDescriptor(withUnknown),
    (err: unknown) => {
      assert.ok(err instanceof DescriptorRefusedError);
      assert.equal(err.reason, "unknown-top-level-key");
      assert.match(err.message, /aKeyNoAnnexHolds/);
      return true;
    },
  );

  const withExtension = { ...validDescriptor(), "x-a-key-of-an-author": { any: "thing" } };
  assert.deepEqual([...unknownTopLevelKeysOf(withExtension)], []);
  assert.ok(isHarnessDescriptor(withExtension));
  assert.doesNotThrow(() => readHarnessDescriptor(withExtension));

  // The known keys are the fields of the annex.
  assert.ok(KNOWN_TOP_LEVEL_KEYS.includes("descriptorVersion"));
  assert.ok(KNOWN_TOP_LEVEL_KEYS.includes("containment"));
  assert.equal(KNOWN_TOP_LEVEL_KEYS.includes("aKeyNoAnnexHolds"), false);
});

test("CT-100-184: every required field of the harness descriptor is required", () => {
  const required = requiredOf(SCHEMA_ID);
  assert.ok(required.length > 0);
  for (const field of required) {
    const without: Record<string, unknown> = validDescriptor();
    delete without[field];
    assert.equal(isHarnessDescriptor(without), false, `${field} must be required`);
  }
  // The annex requires five further fields whose "Required" cell sits on a
  // nested field: `provider.id`, `auth.tiers`, `stream.format`,
  // `isolation.envAllow`, `containment.ceiling`. The validator requires the
  // parent of each.
  for (const field of REQUIRED_BY_THE_ANNEX) {
    const without: Record<string, unknown> = validDescriptor();
    delete without[field];
    assert.throws(
      () => readHarnessDescriptor(without),
      (err: unknown) => {
        assert.ok(err instanceof DescriptorRefusedError);
        assert.match(err.message, new RegExp(field));
        return true;
      },
      `${field} is required by annex C §C.2`,
    );
  }
  for (const parent of ["provider", "auth", "stream", "isolation", "containment"]) {
    assert.ok(REQUIRED_BY_THE_ANNEX.includes(parent as never), `${parent} is required`);
    assert.equal(
      required.includes(parent),
      false,
      `${parent} is required by the annex, not the schema`,
    );
  }
  // Each required field has a row of the annex: a meaning and a type in words.
  const properties = (
    schema as {
      properties: Record<
        string,
        { description?: string; "x-type-in-words"?: string; properties?: object }
      >;
    }
  ).properties;
  for (const field of REQUIRED_BY_THE_ANNEX) {
    assert.notEqual(properties[field], undefined, field);
    const row = properties[field] as { description?: string; properties?: object };
    // Either the field itself carries the row, or its sub-fields do.
    assert.ok(
      row.description !== undefined || row.properties !== undefined,
      `${field} has a row of annex C §C.2`,
    );
  }
});

test("CT-100-185: the four states of a harness and where a descriptor is accepted from", () => {
  // F100-FR-085 — a harness is in one of exactly four states.
  assert.deepEqual([...HARNESS_STATES], ["tested", "locally-verified", "declared", "detected"]);
  assert.equal(VERIFIED_STATE, "tested");
  for (const state of HARNESS_STATES) {
    assert.equal(isUnverified(state), state !== "tested", state);
  }
  // A harness that is not `tested` is unverified: no version pin, declared or
  // probed capabilities, auth tier 1 or 2 only, shown as unverified.
  assert.equal(UNVERIFIED_FACTS.hasNoVersionPin, true);
  assert.equal(UNVERIFIED_FACTS.capabilitiesAreDeclaredOrProbed, true);
  assert.deepEqual([...UNVERIFIED_FACTS.authTiers], [1, 2]);
  assert.equal(UNVERIFIED_FACTS.doctorShowsItAsUnverified, true);

  // The tiers of §C.2: 1, 2 or both; 3 is never valid.
  assert.deepEqual([...AUTH_TIERS], [1, 2]);
  assert.equal(AUTH_TIER_NEVER_VALID, 3);
  assert.equal(authTiersAreValid([1]), true);
  assert.equal(authTiersAreValid([1, 2]), true);
  assert.equal(authTiersAreValid([3]), false);
  assert.equal(authTiersAreValid([1, 3]), false);
  assert.equal(authTiersAreValid([]), false);

  // F100-FR-085 — a descriptor is accepted from these sources only, which are
  // the values of `origin` the loader sets.
  assert.deepEqual([...ACCEPTED_SOURCES], ["adapter", "bundled", "user", "detected"]);
  assert.deepEqual(
    [...ACCEPTED_SOURCES],
    (schema as { properties: { origin: { enum: string[] } } }).properties.origin.enum,
  );
  assert.ok(isAcceptedSource("bundled"));
  assert.equal(isAcceptedSource("a-place-of-its-own"), false);
  assert.equal(isHarnessDescriptor({ ...validDescriptor(), origin: "elsewhere" }), false);

  // The other closed columns of §C.2.
  assert.deepEqual([...AUTH_SCHEMES], ["bearer", "x-api-key", "none"]);
  assert.deepEqual([...COST_CLASSES], ["subscription", "metered", "local", "unknown"]);

  // A ceiling is a level WITH provenance (§C.15): a bare level is none.
  const bare = readHarnessDescriptor(validDescriptor());
  assert.equal(ceilingIsDeclared(bare), false);
  assert.equal(parseCeiling("C2"), undefined);
  const withProvenance = readHarnessDescriptor({
    ...validDescriptor(),
    containment: { ceiling: "C2 (declared)" },
  });
  assert.equal(ceilingIsDeclared(withProvenance), true);
  assert.deepEqual(parseCeiling("C2 (declared)"), { level: "C2", provenance: "declared" });
  assert.deepEqual(parseCeiling({ level: "C3", provenance: "verified" }), {
    level: "C3",
    provenance: "verified",
  });
  assert.equal(parseCeiling("C9 (declared)"), undefined);
});

test("CT-100-186: a secret goes only to its host, and a plain endpoint is refused", () => {
  // F100-FR-086 — a secret is sent only to the host it was declared for.
  assert.equal(secretMayBeSentTo("api.a-provider.example", "api.a-provider.example"), true);
  assert.equal(secretMayBeSentTo("api.a-provider.example", "API.A-Provider.example"), true);
  assert.equal(secretMayBeSentTo("api.a-provider.example", "api.another.example"), false);
  assert.equal(secretMayBeSentTo("", "api.a-provider.example"), false);

  // A plain, unencrypted endpoint is refused unless it is the loopback address.
  assert.equal(endpointIsRefused("https://api.a-provider.example/v1").refused, false);
  assert.equal(endpointIsRefused("http://127.0.0.1:8080/v1").refused, false);
  assert.equal(endpointIsRefused("http://localhost:8080/v1").refused, false);
  const plain = endpointIsRefused("http://api.a-provider.example/v1");
  assert.equal(plain.refused, true);
  assert.match(String(plain.reason), /plain and unencrypted/);
  assert.equal(endpointIsRefused("not-an-address").refused, true);
  assert.ok(isLoopback("::1"));
  assert.equal(isLoopback("10.0.0.1"), false);

  // Redirects are refused; a free read-only model list may carry the
  // credential, whose value is never stored and never logged.
  assert.equal(REDIRECTS_ARE_REFUSED, true);
  assert.equal(MODEL_LIST_REQUEST_MAY_CARRY_THE_CREDENTIAL, true);
  assert.equal(CREDENTIAL_IS_NEVER_STORED_OR_LOGGED, true);
});
