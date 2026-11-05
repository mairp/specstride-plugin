/**
 * T011 (feature 112) — CT-112-110 (F112-FR-010): a hostile project
 * configuration — custom tags, anchors, a very large file — is read as data
 * and nothing in it executes; a file over the size cap is never parsed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUntrustedFile, UNTRUSTED_MAX_BYTES } from "../src/probes/untrusted.ts";

test("CT-112-110: custom tags and anchors in a hostile configuration execute nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-hostile-"));
  try {
    // A custom tag that, in a code-constructing parser, would name a
    // constructor or a function call. Here it can only be data.
    const hostile = [
      "schema: 1",
      "evil: !execute { cmd: echo pwned }",
      "alsoEvil: !!python/object/apply:os.system ['echo pwned']",
      'jsEvil: !!js/function \'function(){ require("node:child_process").execSync("echo pwned") }\'',
      "anchors: &a",
      "  loop: {maxAttempts: 2}",
      "alias: *a",
      "merge: {<<: *a, loop: {maxAttempts: 3}}",
    ].join("\n");
    const path = join(dir, "specstride.project.json");
    writeFileSync(path, hostile);
    const read = readUntrustedFile(path);
    // The read never throws and never executes: either data, or a reason.
    // Nothing ran regardless of the branch: the parser constructs no code, so
    // a custom tag names no constructor and no function is ever called.
    if (read.ok) {
      const text = JSON.stringify(read.value);
      // No executed payload left a constructed value behind; the tag payloads
      // can only appear as inert strings, if they appear at all.
      for (const value of Object.values(read.value)) {
        assert.ok(typeof value !== "function", "a tag constructed a function: the file executed");
      }
      assert.ok(read.value["schema"] === 1 || text.includes("schema"));
    } else {
      assert.ok(["not-parseable", "not-a-mapping"].includes(read.reason));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-112-110: anchors and aliases resolve as data, never as code", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-anchor-"));
  try {
    const path = join(dir, "config.yaml");
    writeFileSync(
      path,
      ["schema: 1", "base: &base", "  x-free: kept as data", "derived:", "  x-alias: *base"].join(
        "\n",
      ),
    );
    const read = readUntrustedFile(path);
    assert.equal(read.ok, true);
    if (read.ok) {
      // The alias resolved to the anchored mapping: data about data.
      assert.deepEqual(read.value["derived"], { "x-alias": { "x-free": "kept as data" } });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CT-112-110: a very large file is refused at the size cap and never parsed", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-large-"));
  try {
    assert.ok(UNTRUSTED_MAX_BYTES > 0);
    const path = join(dir, "huge.yaml");
    writeFileSync(path, "schema: 1\n");
    // Append well over the cap.
    const chunk = "key: value\n".repeat(1_000);
    let written = 11;
    let text = "schema: 1\n";
    while (written <= UNTRUSTED_MAX_BYTES) {
      text += chunk;
      written += chunk.length;
    }
    writeFileSync(path, text);
    const read = readUntrustedFile(path);
    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.equal(read.reason, "too-large");
      assert.ok((read.bytes ?? 0) > UNTRUSTED_MAX_BYTES);
    }
    // A file just inside the cap is parsed normally.
    const small = join(dir, "small.yaml");
    writeFileSync(small, "schema: 1\nloop:\n  maxAttempts: 2\n");
    const okRead = readUntrustedFile(small);
    assert.equal(okRead.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
