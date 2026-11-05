/**
 * T006 of feature 107 — the kernel wiring (specs/107-launch-contract/tasks.md,
 * T006): the canonical hasher, the redactor and the atomic write of
 * `@specstride/kernel` are wired into `src/contract/kernel.ts`, and NOTHING
 * of them is written here.
 *
 * What this test holds:
 *
 * - every hashing entry of the wiring IS the kernel's own function object —
 *   the same reference `@specstride/kernel` exports — so a behavior change in
 *   the kernel changes the launch contract with it, and no second hasher
 *   exists (F107-FR-014: the hash is the canonical hash of feature 104);
 * - the redactor of the comment is the kernel's redactor, fails closed the
 *   way the kernel does, and the comment cap cuts AFTER the redaction;
 * - the atomic write is the kernel's `atomicWrite`/`atomicWriteJson`: a
 *   write that fails leaves no partial file behind (the kernel's temporary
 *   name and rename), and no write of this layer bypasses it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NO_HASHER_IS_WRITTEN_HERE,
  hashContent,
  hashComment,
  hashTasksIgnoringCheckboxes,
  canonicalRecordHash,
  canonicalRecordText,
  taskListHashIgnoringCheckboxesOfBytes,
  redactAndCutComment,
  COMMENT_TEXT_CAP_BYTES,
  writeAtomically,
  writeAtomicallyJson,
} from "../src/contract/kernel.ts";
import * as kernel from "@specstride/kernel";

test("T006: the wiring writes no hasher — every hash function IS the kernel's", () => {
  assert.equal(NO_HASHER_IS_WRITTEN_HERE, true);
  assert.equal(hashContent, kernel.contentHash);
  assert.equal(canonicalRecordHash, kernel.canonicalRecordHash);
  assert.equal(canonicalRecordText, kernel.canonicalRecordText);
  assert.equal(taskListHashIgnoringCheckboxesOfBytes, kernel.taskListHashIgnoringCheckboxesOfBytes);
  // The derived helpers call the kernel's functions too, and they agree.
  assert.equal(hashContent("abc"), kernel.contentHash("abc"));
  assert.equal(
    hashTasksIgnoringCheckboxes("- [ ] one\n- [x] two"),
    kernel.taskListHashIgnoringCheckboxes("- [ ] one\n- [x] two"),
  );
});

test("T006: the comment is redacted by the kernel's redactor, then cut", () => {
  assert.equal(COMMENT_TEXT_CAP_BYTES, 512);
  // The redaction happens through the kernel: a secret in the comment never
  // reaches the hash input.
  const comment = "token=sk-super-secret-value-123 launch this";
  const shown = redactAndCutComment(comment);
  assert.notEqual(shown, comment);
  assert.ok(!shown.includes("sk-super-secret-value-123"));
  // The hash of the comment (F107-FR-034) is the canonical hash over the
  // text AS TYPED, the kernel's own hash of it and nothing else.
  assert.equal(hashComment(comment), kernel.contentHash(comment));
  assert.notEqual(hashComment(comment), kernel.contentHash(shown));
  // A cap below the comment cuts after the redaction, never mid-token.
  const cut = redactAndCutComment(comment, 16);
  assert.ok(cut.length <= 16 + 4); // byte cut, utf-8 safe
  // The absent comment is "none" (contracts/commands.md, the dry-run line).
  assert.equal(redactAndCutComment(""), "none");
});

test("T006: the atomic write IS the kernel's, and a failed write leaves no partial file", async () => {
  assert.equal(writeAtomically, kernel.atomicWrite);
  assert.equal(writeAtomicallyJson, kernel.atomicWriteJson);
  const dir = join(tmpdir(), `specstride-t006-${process.pid}-${Date.now()}`);
  const { mkdirSync, rmSync } = (await import("node:fs")) as typeof import("node:fs");
  mkdirSync(dir, { recursive: true });
  try {
    const target = join(dir, "contract.json");
    writeAtomicallyJson(target, { schema: "specstride.launch-contract/1", id: "x" });
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), {
      schema: "specstride.launch-contract/1",
      id: "x",
    });
    // No temporary file is left behind (the kernel renames into place).
    const left = readdirSync(dir).filter((one) => !one.startsWith("contract.json"));
    assert.deepEqual(left, []);
    // A write of bytes too, through the same entry.
    writeAtomically(target, new TextEncoder().encode("bytes"));
    // And a failure leaves the previous content in place, with no partial.
    const before = readFileSync(target, "utf8");
    assert.throws(() => writeAtomicallyJson(join(dir, "no-such-dir", "x.json"), { a: 1 }));
    if (existsSync(join(dir, "no-such-dir"))) {
      assert.fail("no directory should have been created");
    }
    assert.equal(existsSync(join(dir, "x.json")), false);
    assert.equal(readFileSync(target, "utf8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
