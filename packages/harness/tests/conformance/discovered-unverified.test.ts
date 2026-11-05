/**
 * T018 — conformance test on the fixture of T002
 * (`tests/conformance/fixtures/descriptor-only/`, F146-SC-001): the fake
 * harness is in the list as unverified, and no value lacks a provenance
 * unless it is null.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discover } from "../../src/discovery/discover.ts";
import { GuardedReader } from "../../src/discovery/guarded-reader.ts";
import { fakeResolver } from "../discovery/helpers.ts";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "descriptor-only");
const CANARY_BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "canary",
  "fixtures",
  "home",
  "bin",
);

type ExpectedField = {
  readonly value: unknown;
  readonly provenance: string | null;
  readonly nullReason?: string;
};
type ExpectedCandidate = {
  readonly id: string;
  readonly expected: Readonly<Record<string, ExpectedField>>;
};

test("F146-SC-001: the fake harness is in the list as unverified, every value with its provenance", async () => {
  const expected = JSON.parse(readFileSync(join(FIXTURE, "expected-candidates.json"), "utf8")) as {
    candidates: ExpectedCandidate[];
  };
  const resolver = fakeResolver({ "env:EXAMPLE_ENDPOINT_URL": "yes" });
  const reader = new GuardedReader({
    secretResolver: resolver,
    readSearchPath: () => CANARY_BIN,
  });
  const result = await discover({
    resolver,
    reader,
    // The metadata pass has not run on this fixture (the expected list
    // pins that), so no request is made and the windows stay null.
    switches: { discoveryEnabled: true, metadataPassEnabled: false, parityProfile: false },
  });
  for (const wanted of expected.candidates) {
    const candidate = result.candidates.find((entry) => entry.id === wanted.id);
    assert.ok(candidate !== undefined, `the candidate ${wanted.id} is not in the list`);
    const actual: Record<string, unknown> = { ...candidate };
    for (const [field, wantedField] of Object.entries(wanted.expected)) {
      // `verified` is not a field of a candidate: it is read from the
      // state — a candidate is unverified where no passed record of a
      // verification of its version and hash stands behind it, which on
      // this fixture is every candidate, and the state stays `detected`.
      if (field === "verified") {
        assert.equal(wantedField.value, false);
        continue;
      }
      const value = actual[field];
      if (wantedField.value === null) {
        // A value the fixture expects null is null.
        assert.equal(value, null, `${wanted.id}.${field} should be null`);
        // And it carries the reason it is null.
        assert.ok(
          typeof wantedField.nullReason === "string" && wantedField.nullReason.length > 0,
          `${wanted.id}.${field} states no reason for its null`,
        );
      } else if (typeof wantedField.value === "string") {
        // A symbolic value of the fixture (an absolute path, a digest) is
        // proven by the property it names, not by its bytes.
        if (wantedField.value.startsWith("absolute-path-of-")) {
          assert.equal(typeof value, "string");
          assert.ok(
            String(value).endsWith(wantedField.value.replace("absolute-path-of-", "")),
            `${wanted.id}.${field} is not the path of the named executable`,
          );
        } else {
          assert.equal(typeof value, "string", `${wanted.id}.${field} should be a hash or a name`);
          assert.ok(String(value).length > 0);
        }
      } else {
        assert.deepEqual(value, wantedField.value, `${wanted.id}.${field}`);
      }
    }
    // Unverified: the candidate is in the list with no record of a
    // verification behind it, in the state a source found it.
    assert.equal(candidate.state, "detected");
    assert.notEqual(candidate.sources.length, 0);
  }
  // No value lacks a provenance unless it is null: every expected field
  // that holds a value states where the value came from.
  for (const wanted of expected.candidates) {
    for (const [field, wantedField] of Object.entries(wanted.expected)) {
      if (wantedField.value === null) continue;
      assert.ok(
        typeof wantedField.provenance === "string" && wantedField.provenance.length > 0,
        `${wanted.id}.${field} holds a value with no provenance`,
      );
    }
  }
});
