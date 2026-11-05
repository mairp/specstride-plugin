/**
 * T067 — contract tests CT-100-307 for the canonical hasher (annex X, §X.5;
 * F100-FR-207). The hasher itself belongs to feature 104; feature 100 owns
 * the interface type and its operations.
 */
import test from "node:test";
import assert from "node:assert/strict";
import kernelOperations from "../data/kernel-operations.json" with { type: "json" };
import {
  A_FEATURE_BUILDS_ITS_OWN_RECORD_TEXT,
  ALGORITHM,
  BASELINE_RECORD_HASH_FORMS,
  CANONICAL_RECORD_TEXT_FORM,
  LINE_END_OF_THE_CANONICAL_RECORD_HASH,
  OPERATIONS_OVER_A_TEXT_THEIR_OWNER_FORMS,
  OPERATIONS_THE_HASHER_BUILDS,
  RECORD_HASH_FORMS,
  CLASSIFICATION_READS_A_FILE,
  EP_03_GAINS_AN_OPERATION,
  FEATURES_THAT_DECIDE_STALENESS,
  SOURCE_STATES,
  STALENESS_VERDICTS,
  WORD_FOR_THE_VALUE,
  hasherOperations,
  type CanonicalHasher,
} from "../src/ep/hasher.ts";

test("CT-100-307: the hasher offers the operations of §X.5 (F100-FR-207)", () => {
  const rows = (kernelOperations as { hasher: { Operation: string }[] }).hasher;
  assert.equal(hasherOperations.length, rows.length);
  assert.deepEqual(
    hasherOperations.map((o) => o.operation),
    rows.map((r) => r.Operation),
  );
  for (const operation of hasherOperations) {
    assert.notEqual(operation.input, "", `${operation.operation} states its input`);
    assert.notEqual(operation.output, "", `${operation.operation} states its output`);
  }
  // The six operations the annex names, as amended on 2026-09-30 (T301):
  // "Canonical record text" is an operation of its own beside the hash.
  const names = hasherOperations.map((o) => o.operation);
  assert.equal(hasherOperations.length, 6);
  assert.ok(names.includes("Content hash"));
  assert.ok(names.includes("Canonical record text"));
  assert.ok(names.includes("Task-list hash that ignores checkboxes"));
  assert.ok(names.includes("Canonical record hash"));
  assert.ok(names.some((n) => /Phase shape/.test(n)));
  assert.ok(names.some((n) => /staleness verdict/.test(n)));
  // There is one hashing scheme, and the word for such a value is "hash".
  assert.equal(ALGORITHM, "SHA-256");
  assert.equal(WORD_FOR_THE_VALUE, "hash");
  for (const operation of hasherOperations) {
    if (!/hash/i.test(operation.operation)) continue;
    assert.match(operation.output, /SHA-256|hash/, operation.operation);
  }
});

test("CT-100-307: the interface type carries every operation, and the classification is pure", () => {
  // A conforming implementation type-checks against the interface: the
  // compiler is the assertion, and this value proves it at run time too.
  const hasher: CanonicalHasher = {
    contentHash: () => "h",
    canonicalRecordText: () => "{}",
    taskListHashIgnoringCheckboxes: () => "h",
    canonicalRecordHash: () => "h",
    phaseShape: () => "s",
    obligationId: () => "o",
    unmetCriteriaSignature: () => "u",
    classifyStaleness: (readings) => ({
      sources: Object.fromEntries(
        readings.map((r) => [
          r.logicalName,
          r.hashNow === undefined
            ? ("unreadable" as const)
            : r.hashNow === r.recordedHash
              ? ("unchanged" as const)
              : ("changed" as const),
        ]),
      ),
      verdict: readings.every((r) => r.hashNow === r.recordedHash)
        ? ("fresh" as const)
        : ("stale" as const),
    }),
  };
  assert.deepEqual([...SOURCE_STATES], ["unchanged", "ticks-only", "changed", "unreadable"]);
  assert.deepEqual([...STALENESS_VERDICTS], ["fresh", "stale"]);
  const fresh = hasher.classifyStaleness([
    { logicalName: "spec", repositoryPath: "spec.md", recordedHash: "a", hashNow: "a" },
  ]);
  assert.equal(fresh.verdict, "fresh");
  assert.equal(fresh.sources["spec"], "unchanged");
  const stale = hasher.classifyStaleness([
    { logicalName: "spec", repositoryPath: "spec.md", recordedHash: "a", hashNow: "b" },
  ]);
  assert.equal(stale.verdict, "stale");
  assert.equal(stale.sources["spec"], "changed");
  const unreadable = hasher.classifyStaleness([
    { logicalName: "spec", repositoryPath: "spec.md", recordedHash: "a" },
  ]);
  assert.equal(unreadable.sources["spec"], "unreadable");
  // The classification reads no file, and EP-03 gains no operation.
  assert.equal(CLASSIFICATION_READS_A_FILE, false);
  assert.equal(EP_03_GAINS_AN_OPERATION, false);
  // Every feature that decides staleness calls it and does not reimplement it.
  assert.deepEqual([...FEATURES_THAT_DECIDE_STALENESS], ["102", "103", "104"]);
});

/* ------------------------------------------------------------------ *
 * T301 — §X.5 as amended on 2026-09-30: the operation "canonical record
 * text", the canonical record hash taken over that text with one line end,
 * and the obligation id and the signature of unmet criteria taken over the
 * text their owners form (F100-FR-207).
 * ------------------------------------------------------------------ */

test("CT-100-307: the canonical record text is an operation of its own (T301, F100-FR-207)", () => {
  const rows = (kernelOperations as { hasher: { Operation: string; Output: string }[] }).hasher;
  const text = rows.find((r) => r.Operation === "Canonical record text");
  assert.ok(text !== undefined, "§X.5 names the operation");
  // The four points of the cell, each pinned as data of the package.
  assert.match(text.Output, /sorted keys/);
  assert.match(text.Output, /compact separators/);
  assert.match(text.Output, /non-ASCII characters kept/);
  assert.match(text.Output, /no final line end/);
  assert.deepEqual(
    { ...CANONICAL_RECORD_TEXT_FORM },
    {
      sortedKeys: true,
      compactSeparators: true,
      nonAsciiKept: true,
      finalLineEnd: false,
    },
  );
  // The interface offers it, beside the hash, and the two are different values.
  const interfaceOperations = hasherOperations.map((o) => o.operation);
  assert.ok(interfaceOperations.includes("Canonical record text"));
  assert.ok(interfaceOperations.includes("Canonical record hash"));
});

test("CT-100-307: the canonical record hash is the content hash of that text with one line end", () => {
  const rows = (kernelOperations as { hasher: { Operation: string; Output: string }[] }).hasher;
  const hash = rows.find((r) => r.Operation === "Canonical record hash");
  assert.ok(hash !== undefined);
  assert.match(hash.Output, /content hash of the canonical record text with one line end/);
  assert.equal(LINE_END_OF_THE_CANONICAL_RECORD_HASH, "\n");
  // The two forms a porting feature must choose between (F100-FR-207).
  assert.deepEqual([...RECORD_HASH_FORMS], ["canonical-record-text", "canonical-record-hash"]);
  assert.equal(BASELINE_RECORD_HASH_FORMS["verification-plan"], "canonical-record-text");
  assert.equal(BASELINE_RECORD_HASH_FORMS["launch-contract"], "canonical-record-hash");
  // No feature builds a record text of its own.
  assert.equal(A_FEATURE_BUILDS_ITS_OWN_RECORD_TEXT, false);

  // A conforming implementation shows the relation: the hash is taken over the
  // text with one line end added, never over the text as it is.
  const hashed: string[] = [];
  const implementation: CanonicalHasher = {
    contentHash: (bytes) => {
      const asText = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8");
      hashed.push(asText);
      return `sha256(${asText})`;
    },
    canonicalRecordText: (record) => JSON.stringify(record, Object.keys({ a: 0, b: 0 }).sort()),
    taskListHashIgnoringCheckboxes: () => "h",
    canonicalRecordHash(record) {
      return this.contentHash(
        this.canonicalRecordText(record) + LINE_END_OF_THE_CANONICAL_RECORD_HASH,
      );
    },
    phaseShape: () => "0123456789abcdef",
    obligationId: (text) => `sha256(${text})`,
    unmetCriteriaSignature: (text) => `sha256(${text})`,
    classifyStaleness: () => ({ sources: {}, verdict: "fresh" }),
  };
  const record = { b: 2, a: 1 };
  const bare = implementation.canonicalRecordText(record);
  assert.ok(!bare.endsWith("\n"), "the text carries no final line end");
  const value = implementation.canonicalRecordHash(record);
  assert.equal(value, `sha256(${bare}\n)`);
  assert.deepEqual(hashed, [`${bare}\n`]);
  assert.notEqual(value, `sha256(${bare})`, "the two forms are different values");
});

test("CT-100-307: the obligation id and the signature are taken over their owner's text (T301)", () => {
  const rows = (kernelOperations as { hasher: { Operation: string; Output: string }[] }).hasher;
  const row = rows.find((r) => /Phase shape/.test(r.Operation));
  assert.ok(row !== undefined);
  assert.match(row.Output, /the hasher holds no rule of theirs/);
  // Only the phase shape is built by the hasher.
  assert.deepEqual([...OPERATIONS_THE_HASHER_BUILDS], ["phaseShape"]);
  assert.match(row.Output, /The phase shape is built by the hasher/);
  // The other two are taken over the text their owner forms.
  assert.deepEqual(
    { ...OPERATIONS_OVER_A_TEXT_THEIR_OWNER_FORMS },
    {
      obligationId: "107",
      unmetCriteriaSignature: "101",
    },
  );
  // The signature of both operations is a text, not a record: the hasher is
  // handed the text and holds no rule for forming it.
  const seen: string[] = [];
  const implementation: Pick<CanonicalHasher, "obligationId" | "unmetCriteriaSignature"> = {
    obligationId: (text) => {
      seen.push(text);
      return "o";
    },
    unmetCriteriaSignature: (text) => {
      seen.push(text);
      return "u";
    },
  };
  implementation.obligationId("the text feature 107 formed");
  implementation.unmetCriteriaSignature("the text feature 101 formed");
  assert.deepEqual(seen, ["the text feature 107 formed", "the text feature 101 formed"]);
});
