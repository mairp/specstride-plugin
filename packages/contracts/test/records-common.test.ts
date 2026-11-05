/**
 * T027 — contract tests CT-100-148 to CT-100-152 for the common rules of
 * records (annex B, §B.4; F100-FR-048 to F100-FR-052). The two samples the
 * annex names are `schemas/lease.schema.json` and
 * `schemas/run-record.schema.json`; the `writer` column of `data/layout.json`
 * is read for the one-writer rule.
 */
import test from "node:test";
import assert from "node:assert/strict";
import layout from "../data/layout.json" with { type: "json" };
import leaseSchema from "../schemas/lease.schema.json" with { type: "json" };
import runRecordSchema from "../schemas/run-record.schema.json" with { type: "json" };
import {
  RecordRefusedError,
  majorOf,
  readRecord,
  refusalMessage,
  schemaIdOfLogicalName,
  tryReadRecord,
} from "../src/records/validate.ts";
import {
  appendProductVersion,
  copyRecord,
  holdsNoSecret,
  oneWriter,
  productVersionDifference,
  unknownFields,
  writersOf,
} from "../src/records/rules.ts";
import { sampleOf, withNextMajor } from "./samples.ts";

const LEASE = "run:<runId>:lease";
const RUN_RECORD = "run:<runId>:record";

test("CT-100-148: every record of §B.7 to §B.18 carries the field schema with its major (F100-FR-048)", () => {
  // The two samples the annex names.
  assert.equal((leaseSchema as { "x-schema-id": string })["x-schema-id"], "specstride.lease/1");
  assert.ok((leaseSchema as { required: string[] }).required.includes("schema"));
  assert.equal(
    (runRecordSchema as { "x-schema-id": string })["x-schema-id"],
    "specstride.run-state/1",
  );
  assert.ok((runRecordSchema as { required: string[] }).required.includes("schema"));
  assert.equal(schemaIdOfLogicalName[LEASE], "specstride.lease/1");
  assert.equal(majorOf("specstride.lease/1"), "1");
  // A record without the field is refused.
  const refused = tryReadRecord(LEASE, { runId: "r" });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.reason, "missing-schema");
});

test("CT-100-149: a reader refuses a different major with the logical name and both majors (F100-FR-049)", () => {
  const sample = sampleOf("specstride.lease/1");
  assert.doesNotThrow(() => readRecord(LEASE, sample));
  const next = withNextMajor("specstride.lease/1");
  const bumped = { ...sample, schema: next };
  assert.throws(
    () => readRecord(LEASE, bumped),
    (err: unknown) => {
      assert.ok(err instanceof RecordRefusedError);
      assert.equal(err.reason, "different-major");
      assert.equal(err.logicalName, LEASE);
      assert.equal(err.majorFound, "2");
      assert.equal(err.majorSupported, "1");
      assert.equal(err.message, refusalMessage(LEASE, "2", "1"));
      return true;
    },
  );
  // An unknown schema id is refused too.
  const unknown = tryReadRecord(LEASE, { schema: "nothing.at.all/1" });
  assert.equal(unknown.ok, false);
  // A reader ignores a field it does not know.
  assert.doesNotThrow(() => readRecord(LEASE, { ...sample, aFieldFromALaterWriter: 1 }));
  assert.deepEqual(unknownFields({ ...sample, extra: 1 }, Object.keys(sample)), ["extra"]);
  // A writer that copies keeps it (annex B, §B.4).
  const copied = copyRecord<Record<string, unknown>>({ ...sample, extra: 1 }, { runId: "r-2" });
  assert.equal(copied.extra, 1);
  assert.equal(copied.runId, "r-2");
});

test("CT-100-150: productVersions is one list and a difference is an event and a doctor finding (F100-FR-050)", () => {
  const properties = (runRecordSchema as { properties: Record<string, unknown> }).properties;
  assert.ok("productVersions" in properties, "the run record holds `productVersions`");
  let versions = appendProductVersion(undefined, "2.0.0");
  assert.deepEqual([...versions], ["2.0.0"]);
  assert.equal(productVersionDifference(versions)?.differs, false);
  versions = appendProductVersion(versions, "2.1.0");
  const difference = productVersionDifference(versions);
  assert.deepEqual([...versions], ["2.0.0", "2.1.0"]);
  assert.equal(difference?.startedWith, "2.0.0");
  assert.equal(difference?.now, "2.1.0");
  assert.equal(difference?.differs, true);
  assert.equal(difference?.event, "run.product-version-changed");
  assert.equal(difference?.shownByDoctor, true);
  assert.equal(productVersionDifference([]), undefined);
  assert.equal(schemaIdOfLogicalName[RUN_RECORD], "specstride.run-state/1");
});

test("CT-100-151: every state file has exactly one writing process (F100-FR-051)", () => {
  // The whole table of §B.5 holds no name with two concurrent writers.
  assert.deepEqual(
    oneWriter().map((f) => f.logicalName),
    [],
  );
  // The rule discriminates: a cell that names two processes with no occasion
  // is a finding.
  const bad = oneWriter([{ logicalName: "x:y", root: "control", writer: "CLI, engine" }]);
  assert.equal(bad.length, 1);
  assert.match(bad[0]?.message ?? "", /every state file has exactly one/);
  // "one file per writer" is the stated form of two writers each with a file.
  assert.deepEqual(
    oneWriter([
      {
        logicalName: "run:<runId>:procs",
        root: "control",
        writer: "Runtime root, engine (one file per writer)",
      },
    ]),
    [],
  );
  // The consumer is no process of the product.
  assert.deepEqual([...writersOf("Consumer, CLI on request")], ["CLI on request"]);
  // Every row of the real table names a writer.
  for (const row of (layout as { logicalNames: { logicalName: string; writer: string }[] })
    .logicalNames) {
    assert.notEqual(row.writer.trim(), "", `${row.logicalName} must name a writer`);
  }
});

test("CT-100-152: a record holds no secret value, no open nonce and no content (F100-FR-052)", () => {
  assert.deepEqual([...holdsNoSecret({ schema: "specstride.lease/1", launchNonceHash: "h" })], []);
  const findings = holdsNoSecret({
    critic: { apiKey: "sk-live-1" },
    launchNonce: "n-1",
    prompt: "the text of the prompt",
  });
  assert.deepEqual(
    findings.map((f) => [f.path, f.kind]),
    [
      ["/critic/apiKey", "secret-value"],
      ["/launchNonce", "open-nonce"],
      ["/prompt", "content"],
    ],
  );
  // What the annex asks for instead.
  assert.match(findings[0]?.asks ?? "", /the reference of the secret/);
  assert.match(findings[1]?.asks ?? "", /the hash of the nonce/);
  assert.match(findings[2]?.asks ?? "", /logical name of the content with its hash and size/);
  // A nonce whose call has returned is not a finding.
  assert.deepEqual([...holdsNoSecret({ launchNonce: "n-1" }, { openNonces: ["n-2"] })], []);
  // The allowed forms pass.
  assert.deepEqual(
    [...holdsNoSecret({ secretRef: "env:TOKEN", nonceHash: "h", promptHash: "h", promptSize: 10 })],
    [],
  );
});
