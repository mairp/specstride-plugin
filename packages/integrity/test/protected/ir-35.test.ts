// CT-116-135 (IR-35; F116-FR-003): scope of the fingerprint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, writeFile } from "./helpers.ts";
import { treeFingerprint } from "../../src/fingerprint/tree.ts";

test("IR-35 ignored paths are outside the scope and recorded as exclusions", async () => {
  const root = makeRepo({ "keep.ts": "k" });
  writeFile(root, "node_modules/pkg/index.js", "m");
  const fp = await treeFingerprint(root, { ignoredRoots: ["node_modules"] });
  assert.ok(fp.files.includes("keep.ts"));
  assert.ok(!fp.files.includes("node_modules/pkg/index.js"));
  assert.deepEqual(fp.exclusions.ignored, ["node_modules"]);
});

test("IR-35 the fingerprint covers an untracked non-ignored file", async () => {
  const root = makeRepo({});
  writeFile(root, "scratch.ts", "s");
  const fp = await treeFingerprint(root);
  assert.ok(fp.files.includes("scratch.ts"));
});
