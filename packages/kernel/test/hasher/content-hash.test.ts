/**
 * T007 — unit tests of the content hash and of the two hashes whose rules
 * belong to their owners (annex X §X.5; F104-FR-021).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALGORITHM,
  HASHER_ANNEX_SECTION,
  HASHER_READS_A_FILE,
  HASHER_REQUIREMENT,
  HASHER_RULE_OWNER,
  canonicalHasher,
  contentHash,
  obligationId,
  unmetCriteriaSignature,
} from "../../src/hasher/index.ts";
import {
  CONTENT_HASH_OF_ABC,
  CONTENT_HASH_OF_A_NON_ASCII_TEXT,
  CONTENT_HASH_OF_THE_EMPTY_TEXT,
  CONTENT_HASH_OF_THE_TASK_LIST,
  TASK_LIST,
} from "./baseline.ts";

test("T007: the content hash equals the baseline's over a text", () => {
  assert.equal(contentHash(""), CONTENT_HASH_OF_THE_EMPTY_TEXT);
  assert.equal(contentHash("abc"), CONTENT_HASH_OF_ABC);
  assert.equal(contentHash(TASK_LIST), CONTENT_HASH_OF_THE_TASK_LIST);
});

test("T007: a text is taken as UTF-8, so non-ASCII characters hash as their bytes", () => {
  assert.equal(contentHash("phase — café ✓\n"), CONTENT_HASH_OF_A_NON_ASCII_TEXT);
  // The same input as bytes gives the same hash: "the bytes of a file, or a
  // text taken as UTF-8" is one operation and not two (annex X §X.5).
  const bytes = new TextEncoder().encode("phase — café ✓\n");
  assert.equal(contentHash(bytes), CONTENT_HASH_OF_A_NON_ASCII_TEXT);
});

test("T007: the content hash is lower-case hexadecimal SHA-256, and stable", () => {
  assert.equal(ALGORITHM, "SHA-256");
  const hash = contentHash("anything");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, contentHash("anything"), "stable across calls");
});

test("T007: the bytes of a file that is no text hash all the same", () => {
  // A binary file has no UTF-8 reading, but its content hash is the hash of
  // its bytes; only the hash that ignores checkboxes needs a decoding.
  const bytes = Uint8Array.from([0x00, 0xff, 0xfe, 0x80]);
  assert.match(contentHash(bytes), /^[0-9a-f]{64}$/);
});

test("T007: the obligation id and the signature of unmet criteria hash the text they are handed", () => {
  // The hasher holds no rule of feature 107's or feature 101's: it returns
  // the CONTENT HASH of the text each owner forms, and neither the prefix
  // `OBL-` nor the cut to twelve characters (annex X §X.5, amended
  // 2026-09-30; F104-FR-021).
  const text = "specs/104-spec-input/tasks.md\n29\nT007\nImplement the one hasher";
  assert.equal(obligationId(text), contentHash(text));
  assert.equal(unmetCriteriaSignature(text), contentHash(text));
  assert.doesNotMatch(obligationId(text), /^OBL-/);
  assert.equal(obligationId(text).length, 64, "not cut to twelve characters here");
});

test("T007: the module states its annex section, its requirement and its rule owner", () => {
  assert.equal(HASHER_ANNEX_SECTION, "annex X, §X.5");
  assert.equal(HASHER_REQUIREMENT, "F100-FR-207");
  assert.equal(HASHER_RULE_OWNER, "104");
  assert.equal(HASHER_READS_A_FILE, false);
});

test("T007: the canonical hasher is one value with every operation of §X.5", () => {
  // The value is typed `CanonicalHasher`, so the compiler already refuses a
  // missing operation; this pins that each one is the function above.
  assert.equal(canonicalHasher.contentHash, contentHash);
  assert.equal(canonicalHasher.obligationId, obligationId);
  assert.equal(canonicalHasher.unmetCriteriaSignature, unmetCriteriaSignature);
  assert.equal(Object.isFrozen(canonicalHasher), true);
});
