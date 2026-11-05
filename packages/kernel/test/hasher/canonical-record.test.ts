/**
 * T007 — unit tests of the canonical record text and the canonical record
 * hash (annex X §X.5, rows "Canonical record text" and "Canonical record
 * hash", as amended on 2026-09-30; F104-FR-021).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LINE_END_OF_THE_CANONICAL_RECORD_HASH } from "@specstride/contracts/ep/hasher";
import { canonicalRecordHash, canonicalRecordText, contentHash } from "../../src/hasher/index.ts";
import {
  CANONICAL_HASH_OF_THE_EMPTY_RECORD,
  CANONICAL_HASH_OF_THE_RECORD,
  CANONICAL_TEXT_OF_THE_EMPTY_RECORD,
  CANONICAL_TEXT_OF_THE_RECORD,
  RECORD,
} from "./baseline.ts";

test("T007: the canonical record text sorts keys, is compact, and keeps non-ASCII", () => {
  assert.equal(canonicalRecordText(RECORD), CANONICAL_TEXT_OF_THE_RECORD);
  // Sorted keys: `a` before `b` before `c`, whatever the insertion order.
  assert.equal(canonicalRecordText({ c: [3, 2], b: 1, a: "café" }), CANONICAL_TEXT_OF_THE_RECORD);
  // Compact separators: no space after `,` or `:`.
  assert.doesNotMatch(canonicalRecordText(RECORD), /, |: /);
  // Non-ASCII kept, never escaped as `\uXXXX`.
  assert.ok(canonicalRecordText(RECORD).includes("café"));
  assert.doesNotMatch(canonicalRecordText(RECORD), /\\u00e9/);
  // No final line end.
  assert.doesNotMatch(canonicalRecordText(RECORD), /\n$/);
  assert.equal(canonicalRecordText({}), CANONICAL_TEXT_OF_THE_EMPTY_RECORD);
});

test("T007: the keys of a nested object are sorted too", () => {
  assert.equal(
    canonicalRecordText({ z: { d: 1, a: 2 }, a: [{ y: 1, x: 2 }] }),
    '{"a":[{"x":2,"y":1}],"z":{"a":2,"d":1}}',
  );
  // The order of a LIST is content and is never sorted.
  assert.equal(canonicalRecordText([3, 1, 2]), "[3,1,2]");
});

test("T007: the canonical record hash is the content hash of that text plus one line end", () => {
  assert.equal(LINE_END_OF_THE_CANONICAL_RECORD_HASH, "\n");
  assert.equal(canonicalRecordHash(RECORD), CANONICAL_HASH_OF_THE_RECORD);
  assert.equal(canonicalRecordHash({}), CANONICAL_HASH_OF_THE_EMPTY_RECORD);
  assert.equal(canonicalRecordHash(RECORD), contentHash(canonicalRecordText(RECORD) + "\n"));
});

test("T007: the two forms over one record are different values", () => {
  // F100-FR-207 makes every porting feature say which of the two a baseline
  // hashes: the verification plan of feature 105 hashes the TEXT as it is,
  // the launch contract of feature 107 the text with a final line end.
  assert.notEqual(contentHash(canonicalRecordText(RECORD)), canonicalRecordHash(RECORD));
});

test("T007: the text is stable across calls and over an equal record", () => {
  assert.equal(canonicalRecordText(RECORD), canonicalRecordText({ ...RECORD }));
  assert.equal(canonicalRecordHash(RECORD), canonicalRecordHash({ ...RECORD }));
});
